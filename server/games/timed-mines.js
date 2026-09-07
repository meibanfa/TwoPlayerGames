"use strict";

const crypto = require("crypto");
const Logic = require("../../js/games/timed-mines-logic");

function createTimedMines(deps) {
  const { send, broadcast, sendError, placementMs, isRoomActive } = deps;

  function emptyBombs() {
    return new Map();
  }

  function newState(phase = "WAITING") {
    return {
      gameId: "timed-mines",
      phase,
      normalPlacements: [new Set(), new Set()],
      timedPlacements: [emptyBombs(), emptyBombs()],
      originalNormalPlacements: [null, null],
      originalTimedPlacements: [null, null],
      confirmed: [false, false],
      placementDeadline: null,
      positions: [...Logic.START_CELLS],
      scores: [0, 0],
      currentTurn: null,
      resumeTurn: null,
      pendingReentrySeats: [],
      turnCount: 0,
      activationUsed: false,
      settledSafeCells: new Set(),
      triggeredNormalCells: new Set(),
      triggeredNormalHistory: [],
      timedExplosionHistory: [],
      collectedTreasures: [],
      recentEvents: [],
      winner: null,
      finishOutcome: null,
      finishReason: null,
    };
  }

  function placementFor(state, seat) {
    return {
      normal: [...state.normalPlacements[seat]],
      timed: [...state.timedPlacements[seat].values()].map((bomb) => ({ number: bomb.number, cell: bomb.cell })).sort((a, b) => a.number - b.number),
    };
  }

  function bombStatuses(state) {
    return state.timedPlacements.flatMap((bombs, seat) => [...bombs.values()].map((bomb) => ({
      seat,
      number: bomb.number,
      status: bomb.status,
      remainingOpponentMoves: bomb.status === Logic.BOMB_STATUSES.ACTIVE ? bomb.remainingOpponentMoves : null,
    }))).sort((a, b) => a.seat - b.seat || a.number - b.number);
  }

  function finalReveal(state) {
    const sides = [0, 1].map((seat) => ({
      normal: [...(state.originalNormalPlacements[seat] || [])],
      timed: [...(state.originalTimedPlacements[seat] || new Map()).entries()].map(([number, cell]) => {
        const current = state.timedPlacements[seat].get(number);
        return { number, cell, status: current?.status || Logic.BOMB_STATUSES.UNACTIVATED, detonated: current?.status === Logic.BOMB_STATUSES.DETONATED };
      }).sort((a, b) => a.number - b.number),
    }));
    return {
      red: sides[0],
      green: sides[1],
      triggeredNormal: state.triggeredNormalHistory.map((entry) => ({ cell: entry.cell, owners: [...entry.owners] })),
      timedExplosions: state.timedExplosionHistory.map((entry) => ({ ...entry, affectedSeats: [...entry.affectedSeats] })),
    };
  }

  function publicState(room, seat) {
    const state = room.state;
    const output = {
      gameId: room.gameId,
      phase: state.phase,
      confirmed: [...state.confirmed],
      placementDeadline: state.placementDeadline,
      positions: [...state.positions],
      scores: [...state.scores],
      currentTurn: state.currentTurn,
      pendingReentrySeat: state.pendingReentrySeats[0] ?? null,
      turnCount: state.turnCount,
      maxTurns: Logic.MAX_TURNS,
      activationUsed: state.phase === "PLAYING" && state.currentTurn === seat ? state.activationUsed : false,
      treasures: [...Logic.TREASURE_CELLS],
      collectedTreasures: state.collectedTreasures.map((item) => ({ ...item })),
      settledSafeCells: [...state.settledSafeCells],
      triggeredNormalCells: [...state.triggeredNormalCells],
      bombStatuses: ["PLAYING", "REENTRY", "FINISHED"].includes(state.phase) ? bombStatuses(state) : [],
      publicExplosions: state.timedExplosionHistory.map((entry) => ({ ...entry, affectedSeats: [...entry.affectedSeats] })),
      recentEvents: state.recentEvents.map((entry) => ({ ...entry, affectedSeats: entry.affectedSeats ? [...entry.affectedSeats] : undefined, blastCells: entry.blastCells ? [...entry.blastCells] : undefined })),
      winner: state.winner,
      finishOutcome: state.finishOutcome,
      finishReason: state.finishReason,
    };
    if (state.phase === "PLACING" && !state.confirmed[seat]) output.placement = placementFor(state, seat);
    if (state.phase === "FINISHED") output.finalExplosiveReveal = finalReveal(state);
    return output;
  }

  function emitState(room, seat) { send(room.players[seat], "gameState", publicState(room, seat)); }
  function emitAll(room) { room.players.forEach((_, seat) => emitState(room, seat)); }

  function preserveOriginals(state) {
    state.originalNormalPlacements = state.originalNormalPlacements.map((placement, seat) => placement || new Set(state.normalPlacements[seat]));
    state.originalTimedPlacements = state.originalTimedPlacements.map((placement, seat) => placement || new Map([...state.timedPlacements[seat]].map(([number, bomb]) => [number, bomb.cell])));
  }

  function finish(room, winner, outcome, reason) {
    const state = room.state;
    if (state.phase === "FINISHED") return;
    preserveOriginals(state);
    clearTimeout(room.placementTimer);
    room.placementTimer = null;
    state.phase = "FINISHED";
    state.placementDeadline = null;
    state.currentTurn = null;
    state.resumeTurn = null;
    state.pendingReentrySeats = [];
    state.activationUsed = false;
    state.winner = winner;
    state.finishOutcome = outcome;
    state.finishReason = reason;
    broadcast(room, "gameFinished", { gameId: room.gameId, winner, finishOutcome: outcome, scores: [...state.scores], finishReason: reason, turnCount: state.turnCount });
    emitAll(room);
  }

  function finishByScores(room, reason) {
    const winner = Logic.winnerForScores(room.state.scores);
    finish(room, winner, winner === null ? Logic.FINISH_OUTCOMES.DRAW : Logic.FINISH_OUTCOMES.WINNER, reason);
  }

  function beginPlay(room) {
    const state = room.state;
    if (state.phase !== "PLACING" || !state.confirmed.every(Boolean)) return;
    clearTimeout(room.placementTimer);
    room.placementTimer = null;
    preserveOriginals(state);
    state.phase = "PLAYING";
    state.placementDeadline = null;
    state.currentTurn = crypto.randomInt(0, 2);
    state.activationUsed = false;
    state.recentEvents = [{ kind: "start", seat: state.currentTurn, text: `${room.names[state.currentTurn]} 先手` }];
    emitAll(room);
  }

  function validSeatPlacement(state, seat) { return Logic.validatePlacement(placementFor(state, seat)); }

  function handlePlacementTimeout(room, scheduledState) {
    if (!isRoomActive(room) || room.state !== scheduledState || scheduledState.phase !== "PLACING") return;
    scheduledState.normalPlacements.forEach((_, seat) => {
      if (!scheduledState.confirmed[seat] && validSeatPlacement(scheduledState, seat)) {
        scheduledState.originalNormalPlacements[seat] = new Set(scheduledState.normalPlacements[seat]);
        scheduledState.originalTimedPlacements[seat] = new Map([...scheduledState.timedPlacements[seat]].map(([number, bomb]) => [number, bomb.cell]));
        scheduledState.confirmed[seat] = true;
      }
    });
    const failed = [0, 1].filter((seat) => !scheduledState.confirmed[seat]);
    if (failed.length === 0) return beginPlay(room);
    if (failed.length === 2) return finish(room, null, Logic.FINISH_OUTCOMES.NO_WINNER, "双方未在规定时间内完成布置");
    finish(room, 1 - failed[0], Logic.FINISH_OUTCOMES.WINNER, `${room.names[failed[0]]} 未在规定时间内完成布置`);
  }

  function schedulePlacement(room) {
    clearTimeout(room.placementTimer);
    const scheduledState = room.state;
    room.placementTimer = setTimeout(() => handlePlacementTimeout(room, scheduledState), placementMs);
    room.placementTimer.unref?.();
  }

  function start(room) {
    room.state.phase = "PLACING";
    room.state.placementDeadline = Date.now() + placementMs;
    schedulePlacement(room);
  }

  function cellHasOwnExplosive(state, seat, cell, exceptTimedNumber = null) {
    return state.normalPlacements[seat].has(cell) || [...state.timedPlacements[seat].values()].some((bomb) => bomb.number !== exceptTimedNumber && bomb.cell === cell);
  }

  function placeExplosive(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "PLACING" || state.confirmed[seat] || !Logic.isLegalExplosiveCell(message.cell)) return sendError(ws, "这个位置现在不能布置爆炸物。");
    if (message.kind === "normal") {
      const mines = state.normalPlacements[seat];
      if (mines.has(message.cell)) mines.delete(message.cell);
      else if (cellHasOwnExplosive(state, seat, message.cell)) return sendError(ws, "自己的每个格子最多放置一个爆炸物。");
      else if (mines.size >= Logic.NORMAL_MINE_COUNT) return sendError(ws, "普通地雷最多只能放置 12 颗。");
      else mines.add(message.cell);
    } else if (message.kind === "timed" && Logic.isTimedBombNumber(message.number)) {
      const bombs = state.timedPlacements[seat];
      const existing = bombs.get(message.number);
      if (existing?.cell === message.cell) bombs.delete(message.number);
      else if (cellHasOwnExplosive(state, seat, message.cell, message.number)) return sendError(ws, "自己的每个格子最多放置一个爆炸物。");
      else bombs.set(message.number, { number: message.number, cell: message.cell, status: Logic.BOMB_STATUSES.UNACTIVATED, remainingOpponentMoves: null });
    } else return sendError(ws, "请选择有效的布置工具。");
    emitState(room, seat);
  }

  function confirmPlacement(room, ws) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "PLACING" || state.confirmed[seat] || !validSeatPlacement(state, seat)) return sendError(ws, "请先放满 12 颗普通地雷和 3 颗编号定时炸弹。");
    state.originalNormalPlacements[seat] = new Set(state.normalPlacements[seat]);
    state.originalTimedPlacements[seat] = new Map([...state.timedPlacements[seat]].map(([number, bomb]) => [number, bomb.cell]));
    state.confirmed[seat] = true;
    emitAll(room);
    if (state.confirmed.every(Boolean)) beginPlay(room);
  }

  function activateBomb(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "PLAYING" || state.currentTurn !== seat) return sendError(ws, "只能在自己的正常移动回合启动定时炸弹。");
    if ((Object.hasOwn(message, "owner") && message.owner !== seat) || (Object.hasOwn(message, "seat") && message.seat !== seat)) return sendError(ws, "只能启动自己的定时炸弹。");
    if (!Logic.isTimedBombNumber(message.number)) return sendError(ws, "定时炸弹编号无效。");
    const bomb = state.timedPlacements[seat].get(message.number);
    if (!Logic.canActivateBomb(bomb, state.activationUsed)) return sendError(ws, state.activationUsed ? "本回合最多启动一颗定时炸弹。" : "这颗定时炸弹不能再次启动。");
    bomb.status = Logic.BOMB_STATUSES.ACTIVE;
    bomb.remainingOpponentMoves = Logic.BOMB_COUNTDOWN_MOVES;
    state.activationUsed = true;
    state.recentEvents = [{ kind: "activation", seat, number: bomb.number, text: `${room.names[seat]} 启动了定时炸弹 #${bomb.number}` }];
    emitAll(room);
  }

  function returnPlayersToStart(state, seats) {
    const uniqueSeats = [...new Set(seats)].filter((seat) => [0, 1].includes(seat));
    uniqueSeats.forEach((seat) => { state.positions[seat] = null; });
    for (const seat of uniqueSeats) {
      if (state.positions[1 - seat] !== Logic.START_CELLS[seat]) state.positions[seat] = Logic.START_CELLS[seat];
      else if (!state.pendingReentrySeats.includes(seat)) state.pendingReentrySeats.push(seat);
    }
  }

  function completeNowAvailableReturns(state) {
    state.pendingReentrySeats = state.pendingReentrySeats.filter((seat) => {
      if (state.positions[1 - seat] === Logic.START_CELLS[seat]) return true;
      state.positions[seat] = Logic.START_CELLS[seat];
      return false;
    });
  }

  function applyDetonation(room, detonation) {
    const state = room.state;
    const affectedSeats = Logic.blastAffectedSeats(detonation.cell, state.positions);
    affectedSeats.forEach((seat) => { state.scores[seat] -= 5; });
    returnPlayersToStart(state, affectedSeats);
    const entry = { seat: detonation.owner, number: detonation.number, cell: detonation.cell, affectedSeats };
    state.timedExplosionHistory.push(entry);
    state.recentEvents.push({
      kind: "timed-explosion",
      ...entry,
      blastCells: Logic.blastCells(detonation.cell),
      text: affectedSeats.length ? `定时炸弹 #${detonation.number} 在 ${Logic.coordinate(detonation.cell)} 爆炸，${affectedSeats.map((seat) => room.names[seat]).join("、")} 各 -5 分` : `定时炸弹 #${detonation.number} 在 ${Logic.coordinate(detonation.cell)} 爆炸，无人受伤`,
    });
  }

  function advanceBombsAfterMove(room, movingSeat) {
    const state = room.state;
    const before = state.timedPlacements;
    const result = Logic.advanceBombCountdowns(before, movingSeat);
    state.timedPlacements = result.bombs.map((bombs) => new Map(bombs.map((bomb) => [bomb.number, bomb])));
    for (let owner = 0; owner < 2; owner++) {
      if (owner === movingSeat) continue;
      for (const bomb of state.timedPlacements[owner].values()) {
        const previous = before[owner].get(bomb.number);
        if (previous?.status === Logic.BOMB_STATUSES.ACTIVE && bomb.status === Logic.BOMB_STATUSES.ACTIVE && previous.remainingOpponentMoves !== bomb.remainingOpponentMoves) {
          state.recentEvents.push({ kind: "countdown", seat: owner, number: bomb.number, remainingOpponentMoves: bomb.remainingOpponentMoves, text: `${room.names[owner]} 的定时炸弹 #${bomb.number}：对手还需移动 ${bomb.remainingOpponentMoves} 次` });
        }
      }
    }
    result.detonations.forEach((detonation) => applyDetonation(room, detonation));
    completeNowAvailableReturns(state);
  }

  function move(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "PLAYING" || state.currentTurn !== seat || state.pendingReentrySeats.length) return sendError(ws, "现在不能移动。");
    if (!Logic.isLegalNormalMove(state.positions[seat], message.cell, state.positions[1 - seat])) return sendError(ws, "只能移动到相邻且未被占用的格子。");
    state.recentEvents = [];
    state.positions[seat] = message.cell;
    const normalOwners = state.normalPlacements.flatMap((mines, owner) => mines.has(message.cell) ? [owner] : []);
    const hit = Logic.resolveNormalMineHit({ normalMineSets: state.normalPlacements, scores: state.scores, seat, cell: message.cell });
    let treasureFinish = false;
    if (hit) {
      state.normalPlacements = hit.normalMineSets;
      state.scores = hit.scores;
      state.triggeredNormalCells.add(message.cell);
      state.triggeredNormalHistory.push({ cell: message.cell, owners: normalOwners });
      state.recentEvents.push({ kind: "normal-mine", seat, cell: message.cell, scoreDelta: -5, text: `踩到普通地雷，-5 分，返回起点` });
      returnPlayersToStart(state, [seat]);
    } else {
      const result = Logic.resolveNonMineCell({
        cell: message.cell,
        normalMineSets: state.normalPlacements,
        timedBombSets: state.timedPlacements,
        settledSafeCells: state.settledSafeCells,
        collectedTreasures: state.collectedTreasures,
      });
      state.scores[seat] += result.scoreDelta;
      if (result.settle) state.settledSafeCells.add(message.cell);
      if (result.kind === "treasure") {
        state.collectedTreasures.push({ cell: message.cell, seat, value: result.scoreDelta, order: result.treasureOrder });
        state.recentEvents.push({ kind: "treasure", seat, cell: message.cell, scoreDelta: result.scoreDelta, text: `发现第 ${result.treasureOrder} 个宝物，+${result.scoreDelta} 分` });
        treasureFinish = result.finish;
      } else if (["safe", "collected-treasure-safe"].includes(result.kind)) {
        state.recentEvents.push({ kind: "safe", seat, cell: message.cell, scoreDelta: result.scoreDelta, text: `周围爆炸物得分，+${result.scoreDelta} 分` });
      } else {
        state.recentEvents.push({ kind: result.kind, seat, cell: message.cell, scoreDelta: 0, text: "这个格子已经结算，不再得分" });
      }
    }

    state.turnCount += 1;
    if (treasureFinish) return finishByScores(room, "三个宝物均已找到");
    advanceBombsAfterMove(room, seat);
    if (Logic.reachedTurnLimit(state.turnCount)) return finishByScores(room, "已完成 70 个移动回合");

    const nextTurn = 1 - seat;
    state.activationUsed = false;
    if (state.pendingReentrySeats.length) {
      state.phase = "REENTRY";
      state.resumeTurn = nextTurn;
      state.currentTurn = state.pendingReentrySeats[0];
    } else {
      state.currentTurn = nextTurn;
    }
    emitAll(room);
  }

  function reenter(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "REENTRY" || state.pendingReentrySeats[0] !== seat || state.currentTurn !== seat) return sendError(ws, "现在不能选择重新入场位置。");
    if (!Logic.legalReentryCells(seat, state.positions[1 - seat]).includes(message.cell)) return sendError(ws, "请选择自己保护区内未被占用的其他格子。");
    state.positions[seat] = message.cell;
    state.pendingReentrySeats.shift();
    state.recentEvents = [{ kind: "reentry", seat, cell: message.cell, scoreDelta: 0, text: `${room.names[seat]} 已从保护区重新入场` }];
    if (state.pendingReentrySeats.length) state.currentTurn = state.pendingReentrySeats[0];
    else {
      state.phase = "PLAYING";
      state.currentTurn = state.resumeTurn;
      state.resumeTurn = null;
      state.activationUsed = false;
    }
    emitAll(room);
  }

  function handleAction(room, ws, message) {
    const forgedFields = ["score", "scores", "winner", "turnCount", "remainingOpponentMoves", "bombLocation", "mineHit"];
    if (forgedFields.some((field) => Object.hasOwn(message, field))) return sendError(ws, "操作包含不允许的权威状态字段。");
    if (message.action === "placeExplosive") return placeExplosive(room, ws, message);
    if (message.action === "confirmPlacement") return confirmPlacement(room, ws);
    if (message.action === "activateBomb") return activateBomb(room, ws, message);
    if (message.action === "move") return move(room, ws, message);
    if (message.action === "reenter") return reenter(room, ws, message);
    sendError(ws, "未知操作。");
  }

  function restart(room) {
    room.state = newState("PLACING");
    room.state.placementDeadline = Date.now() + placementMs;
    schedulePlacement(room);
    return { phase: "PLACING", placementDeadline: room.state.placementDeadline };
  }

  function clearTimers(room) { clearTimeout(room.placementTimer); }

  return { id: "timed-mines", Logic, newState, publicState, start, handleAction, restart, clearTimers, handlePlacementTimeout };
}

module.exports = createTimedMines;
