"use strict";

const crypto = require("crypto");
const Logic = require("../../js/games/forgotten-mines-logic");

function createForgottenMines(deps) {
  const { send, broadcast, sendError, placementMs, isRoomActive } = deps;

  function newState(phase = "WAITING") {
    return {
      gameId: "forgotten-mines",
      phase,
      placements: [new Set(), new Set()],
      confirmed: [false, false],
      placementDeadline: null,
      positions: [...Logic.START_CELLS],
      scores: [0, 0],
      currentTurn: null,
      pendingReentrySeat: null,
      exhaustedSafeCells: new Set(),
      detonatedCells: new Set(),
      collectedTreasures: [],
      latestEvent: null,
      winner: null,
      finishOutcome: null,
      finishReason: null,
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
      pendingReentrySeat: state.pendingReentrySeat,
      treasures: [...Logic.TREASURE_CELLS],
      collectedTreasures: state.collectedTreasures.map((item) => ({ ...item })),
      exhaustedSafeCells: [...state.exhaustedSafeCells],
      detonatedCells: [...state.detonatedCells],
      latestEvent: state.latestEvent ? { ...state.latestEvent } : null,
      winner: state.winner,
      finishOutcome: state.finishOutcome,
      finishReason: state.finishReason,
    };
    if (state.phase === "PLACING" && !state.confirmed[seat]) output.placement = [...state.placements[seat]];
    return output;
  }

  function emitState(room, seat) { send(room.players[seat], "gameState", publicState(room, seat)); }
  function emitAll(room) { room.players.forEach((_, seat) => emitState(room, seat)); }

  function finish(room, winner, outcome, reason) {
    const state = room.state;
    if (state.phase === "FINISHED") return;
    clearTimeout(room.placementTimer);
    room.placementTimer = null;
    state.phase = "FINISHED";
    state.placementDeadline = null;
    state.currentTurn = null;
    state.pendingReentrySeat = null;
    state.winner = winner;
    state.finishOutcome = outcome;
    state.finishReason = reason;
    broadcast(room, "gameFinished", { gameId: room.gameId, winner, finishOutcome: outcome, scores: [...state.scores], finishReason: reason });
    emitAll(room);
  }

  function beginPlay(room) {
    const state = room.state;
    if (state.phase !== "PLACING" || !state.confirmed.every(Boolean)) return;
    clearTimeout(room.placementTimer);
    room.placementTimer = null;
    state.phase = "PLAYING";
    state.placementDeadline = null;
    state.currentTurn = crypto.randomInt(0, 2);
    state.latestEvent = { kind: "start", seat: state.currentTurn, text: `${room.names[state.currentTurn]} 先手` };
    emitAll(room);
  }

  function handlePlacementTimeout(room, scheduledState) {
    if (!isRoomActive(room) || room.state !== scheduledState || scheduledState.phase !== "PLACING") return;
    scheduledState.placements.forEach((placement, seat) => {
      if (!scheduledState.confirmed[seat] && Logic.validatePlacement([...placement])) scheduledState.confirmed[seat] = true;
    });
    const failed = [0, 1].filter((seat) => !scheduledState.confirmed[seat]);
    if (failed.length === 0) return beginPlay(room);
    if (failed.length === 2) return finish(room, null, Logic.FINISH_OUTCOMES.NO_WINNER, "双方未在规定时间内完成布雷");
    finish(room, 1 - failed[0], Logic.FINISH_OUTCOMES.WINNER, `${room.names[failed[0]]} 未在规定时间内完成布雷`);
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

  function toggleMine(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "PLACING" || state.confirmed[seat] || !Logic.isLegalMineCell(message.cell)) return sendError(ws, "这个位置不能布雷。");
    const placement = state.placements[seat];
    if (placement.has(message.cell)) placement.delete(message.cell);
    else if (placement.size >= Logic.MINE_COUNT) return sendError(ws, "最多只能埋 15 颗雷。");
    else placement.add(message.cell);
    send(ws, "gameState", publicState(room, seat));
  }

  function confirmPlacement(room, ws) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "PLACING" || state.confirmed[seat] || !Logic.validatePlacement([...state.placements[seat]])) return sendError(ws, "请先在合法位置埋满 15 颗雷。");
    state.confirmed[seat] = true;
    emitAll(room);
    if (state.confirmed.every(Boolean)) beginPlay(room);
  }

  function finishTreasureGame(room) {
    const state = room.state;
    const winner = Logic.winnerForScores(state.scores);
    const outcome = winner === null ? Logic.FINISH_OUTCOMES.DRAW : Logic.FINISH_OUTCOMES.WINNER;
    finish(room, winner, outcome, "三个宝物均已找到");
  }

  function move(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "PLAYING" || state.currentTurn !== seat || state.pendingReentrySeat !== null) return sendError(ws, "现在不能移动。");
    if (!Logic.isLegalNormalMove(state.positions[seat], message.cell, state.positions[1 - seat])) return sendError(ws, "只能移动到相邻且未被占用的格子。");
    state.positions[seat] = message.cell;
    const hit = Logic.resolveMineHit({ mineSets: state.placements, scores: state.scores, seat, cell: message.cell });
    if (hit) {
      state.placements = hit.mineSets;
      state.scores = hit.scores;
      state.positions[seat] = null;
      state.phase = "REENTRY";
      state.pendingReentrySeat = seat;
      state.detonatedCells.add(message.cell);
      state.latestEvent = { kind: "mine", seat, cell: message.cell, scoreDelta: -5, text: "踩到地雷，-5 分，请从起点旁重新选择一格" };
      emitAll(room);
      return;
    }

    const result = Logic.resolveSafeCell({
      cell: message.cell,
      mineSets: state.placements,
      exhaustedSafeCells: state.exhaustedSafeCells,
      collectedTreasures: state.collectedTreasures,
    });
    state.scores[seat] += result.scoreDelta;
    if (result.exhaust) state.exhaustedSafeCells.add(message.cell);
    if (result.kind === "treasure") {
      state.collectedTreasures.push({ cell: message.cell, seat, value: result.scoreDelta, order: result.treasureOrder });
      state.latestEvent = { kind: "treasure", seat, cell: message.cell, scoreDelta: result.scoreDelta, text: `发现第 ${result.treasureOrder} 个宝物，+${result.scoreDelta} 分` };
    } else if (result.kind === "safe") {
      state.latestEvent = { kind: "safe", seat, cell: message.cell, scoreDelta: result.scoreDelta, text: `周围共有 ${result.scoreDelta} 颗地雷，+${result.scoreDelta} 分` };
    } else {
      state.latestEvent = { kind: result.kind, seat, cell: message.cell, scoreDelta: 0, text: result.kind === "exhausted" ? "这个格子已经结算，不再得分" : "宝物已经被找到，本次不再得分" };
    }
    if (result.finish) return finishTreasureGame(room);
    state.currentTurn = 1 - seat;
    emitAll(room);
  }

  function reenter(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    if (state.phase !== "REENTRY" || state.pendingReentrySeat !== seat || state.currentTurn !== seat) return sendError(ws, "现在不能选择重新入场位置。");
    const result = Logic.resolveReentry({ seat, cell: message.cell, opponentCell: state.positions[1 - seat] });
    if (!result) return sendError(ws, "请选择起点旁未被占用的保护格。");
    state.positions[seat] = result.position;
    state.pendingReentrySeat = null;
    state.phase = "PLAYING";
    state.currentTurn = 1 - seat;
    state.latestEvent = { kind: "reentry", seat, cell: result.position, scoreDelta: 0, text: `${room.names[seat]} 已重新入场` };
    emitAll(room);
  }

  function handleAction(room, ws, message) {
    if (message.action === "toggleMine") return toggleMine(room, ws, message);
    if (message.action === "confirmPlacement") return confirmPlacement(room, ws);
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

  return { id: "forgotten-mines", Logic, newState, publicState, start, handleAction, restart, clearTimers, handlePlacementTimeout };
}

module.exports = createForgottenMines;
