"use strict";

const crypto = require("crypto");
const Logic = require("../../js/games/minesweeper-duel-logic");

function createMinesweeperDuel(deps) {
  const { send, broadcast, sendError, placementMs, finishWindowMs, isRoomActive } = deps;

  function validCell(value) {
    return Number.isInteger(value) && value >= 0 && value < Logic.BOARD_ROWS * Logic.BOARD_COLS;
  }

  function newState(phase = "WAITING") {
    return {
      phase,
      placements: [new Set(), new Set()],
      ready: [false, false],
      boards: [null, null],
      counts: [null, null],
      revealed: [new Set(), new Set()],
      flags: [new Set(), new Set()],
      mineHits: [new Set(), new Set()],
      mistakes: [0, 0],
      penalty: [0, 0],
      placementDeadline: null,
      sweepStartedAt: null,
      completedAt: [null, null],
      winner: null,
      summary: null,
    };
  }

  function safeRevealCount(state, seat) {
    return [...state.revealed[seat]].filter((cell) => !state.mineHits[seat].has(cell)).length;
  }

  function finishSummary(state) {
    const effective = state.completedAt.map((at, seat) => at === null ? null : at - state.sweepStartedAt + state.penalty[seat]);
    return state.mistakes.map((mistakes, seat) => ({
      mistakes,
      penalty: state.penalty[seat],
      elapsed: state.completedAt[seat] === null ? null : state.completedAt[seat] - state.sweepStartedAt,
      effectiveTime: effective[seat],
    }));
  }

  function publicState(room, seat) {
    const state = room.state;
    const output = {
      gameId: room.gameId,
      phase: state.phase,
      placement: [...state.placements[seat]],
      ready: state.ready[seat],
      revealed: [...state.revealed[seat]].map((cell) => ({
        cell,
        mine: state.mineHits[seat].has(cell),
        count: state.mineHits[seat].has(cell) ? null : state.counts[seat]?.[cell] ?? 0,
      })),
      flags: [...state.flags[seat]],
      mistakes: state.mistakes[seat],
      penalty: state.penalty[seat],
      progress: [safeRevealCount(state, seat), safeRevealCount(state, 1 - seat)],
      total: Logic.BOARD_ROWS * Logic.BOARD_COLS - Logic.MINE_COUNT,
      placementDeadline: state.placementDeadline,
      sweepStartedAt: state.sweepStartedAt,
      winner: state.winner,
    };
    if (state.phase === "FINISHED") {
      output.boards = state.boards.map((board) => [...board]);
      output.summary = state.summary || finishSummary(state);
    }
    return output;
  }

  function emitState(room, seat) {
    send(room.players[seat], "gameState", publicState(room, seat));
  }

  function emitProgress(room) {
    room.players.forEach((player, seat) => send(player, "progress", {
      gameId: room.gameId,
      mine: safeRevealCount(room.state, seat),
      opponent: safeRevealCount(room.state, 1 - seat),
      total: Logic.BOARD_ROWS * Logic.BOARD_COLS - Logic.MINE_COUNT,
      opponentMistakes: room.state.mistakes[1 - seat],
    }));
  }

  function beginSweep(room) {
    const state = room.state;
    state.phase = "SWEEPING";
    state.sweepStartedAt = Date.now();
    state.placementDeadline = null;
    state.boards = [new Set(state.placements[1]), new Set(state.placements[0])];
    state.counts = state.boards.map((board) => Logic.mineCounts([...board]));
    room.players.forEach((_, seat) => emitState(room, seat));
    emitProgress(room);
  }

  function autoPlacement(room, scheduledState = room.state) {
    if (!isRoomActive(room) || room.state !== scheduledState || scheduledState.phase !== "PLACING") return;
    const state = scheduledState;
    state.placements.forEach((set, seat) => {
      while (set.size < Logic.MINE_COUNT) set.add(crypto.randomInt(0, Logic.BOARD_ROWS * Logic.BOARD_COLS));
      state.ready[seat] = true;
    });
    beginSweep(room);
  }

  function schedulePlacement(room) {
    clearTimeout(room.placementTimer);
    const scheduledState = room.state;
    room.placementTimer = setTimeout(() => autoPlacement(room, scheduledState), placementMs);
    room.placementTimer.unref?.();
  }

  function start(room) {
    room.state.phase = "PLACING";
    room.state.placementDeadline = Date.now() + placementMs;
    schedulePlacement(room);
  }

  function finalize(room) {
    const state = room.state;
    if (state.phase === "FINISHED") return;
    const effective = state.completedAt.map((at, seat) => at === null ? Infinity : at - state.sweepStartedAt + state.penalty[seat]);
    state.phase = "FINISHED";
    state.finishedAt = Date.now();
    state.winner = effective[0] === effective[1] ? null : (effective[0] < effective[1] ? 0 : 1);
    state.summary = finishSummary(state);
    broadcast(room, "gameFinished", {
      gameId: room.gameId,
      winner: state.winner,
      boards: state.boards.map((board) => [...board]),
      summary: state.summary,
    });
    room.players.forEach((_, seat) => emitState(room, seat));
  }

  function finish(room, seat) {
    const state = room.state;
    if (state.phase !== "SWEEPING" || state.completedAt[seat] !== null || !Logic.isComplete(state.revealed[seat], state.boards[seat])) return;
    state.completedAt[seat] = Date.now();
    send(room.players[seat], "playerFinished", { gameId: room.gameId });
    if (state.completedAt[0] !== null && state.completedAt[1] !== null) {
      clearTimeout(room.finishTimer);
      finalize(room);
      return;
    }
    clearTimeout(room.finishTimer);
    const scheduledState = state;
    room.finishTimer = setTimeout(() => {
      if (isRoomActive(room) && room.state === scheduledState) finalize(room);
    }, finishWindowMs);
    room.finishTimer.unref?.();
  }

  function handleAction(room, ws, message) {
    const seat = ws.seat;
    const state = room.state;
    const action = message.action;
    if (state.phase === "WAITING") return sendError(ws, "请等待好友加入。");
    if (state.phase === "PLACING") {
      if (action === "place") {
        if (!validCell(message.cell) || state.ready[seat]) return sendError(ws, "无法修改布雷。");
        const placement = state.placements[seat];
        if (placement.has(message.cell)) placement.delete(message.cell);
        else if (placement.size >= Logic.MINE_COUNT) return sendError(ws, "最多只能埋 15 颗雷。");
        else placement.add(message.cell);
        return send(ws, "placementState", { gameId: room.gameId, count: placement.size, placement: [...placement] });
      }
      if (action === "ready") {
        if (state.placements[seat].size !== Logic.MINE_COUNT || state.ready[seat]) return sendError(ws, "请先埋满 15 颗雷。");
        state.ready[seat] = true;
        send(ws, "placementLocked", { gameId: room.gameId });
        broadcast(room, "placementProgress", { gameId: room.gameId, ready: state.ready });
        if (state.ready.every(Boolean)) beginSweep(room);
        return;
      }
      return;
    }
    if (state.phase !== "SWEEPING" || state.completedAt[seat] !== null || !validCell(message.cell)) return sendError(ws, "当前不能进行这个操作。");
    if (action === "flag") {
      if (state.revealed[seat].has(message.cell)) return sendError(ws, "这个格子已经翻开。");
      if (state.flags[seat].has(message.cell)) state.flags[seat].delete(message.cell);
      else state.flags[seat].add(message.cell);
      emitState(room, seat);
      return;
    }
    if (action === "reveal") {
      if (state.revealed[seat].has(message.cell) || state.flags[seat].has(message.cell)) return sendError(ws, "请先取消旗子。");
      const board = state.boards[seat];
      if (board.has(message.cell)) {
        state.revealed[seat].add(message.cell);
        state.mineHits[seat].add(message.cell);
        state.mistakes[seat]++;
        state.penalty[seat] += 10_000;
        send(ws, "revealResult", { gameId: room.gameId, cells: [{ cell: message.cell, mine: true }], mistakes: state.mistakes[seat], penalty: state.penalty[seat] });
      } else {
        const cells = Logic.floodReveal([...board], message.cell, [...state.revealed[seat], ...state.flags[seat]]);
        cells.forEach((cell) => state.revealed[seat].add(cell.cell));
        send(ws, "revealResult", { gameId: room.gameId, cells });
      }
      emitProgress(room);
      finish(room, seat);
      return;
    }
    sendError(ws, "未知操作。");
  }

  function restart(room) {
    room.state = newState("PLACING");
    room.state.placementDeadline = Date.now() + placementMs;
    clearTimeout(room.finishTimer);
    schedulePlacement(room);
    return { phase: "PLACING", placementDeadline: room.state.placementDeadline };
  }

  return { id: "minesweeper-duel", Logic, newState, publicState, start, handleAction, restart, finalize };
}

module.exports = createMinesweeperDuel;
