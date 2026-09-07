"use strict";

process.env.RECONNECT_GRACE_MS = "500";
process.env.TIMED_MINES_PLACEMENT_MS = "60000";

const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { server, rooms, gameHandlers } = require("../server");
const L = require("../js/games/timed-mines-logic");

function next(ws, type, predicate = () => true, timeout = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", onMessage); reject(new Error(`timeout ${type}`)); }, timeout);
    function onMessage(raw) {
      const message = JSON.parse(raw);
      if (message.type === type && predicate(message)) { clearTimeout(timer); ws.off("message", onMessage); resolve(message); }
    }
    ws.on("message", onMessage);
  });
}
function open(url, frames = []) {
  const ws = new WebSocket(url);
  ws.on("message", (raw) => frames.push(JSON.parse(raw)));
  return new Promise((resolve, reject) => { ws.once("open", () => resolve(ws)); ws.once("error", reject); });
}
function send(ws, type, payload = {}) { ws.send(JSON.stringify({ type, ...payload })); }
function close(ws) { return new Promise((resolve) => { if (!ws || ws.readyState === WebSocket.CLOSED) return resolve(); ws.once("close", resolve); ws.close(); }); }
function assertNoHiddenState(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  const forbidden = ["normalPlacements", "timedPlacements", "originalNormalPlacements", "originalTimedPlacements", "finalExplosiveReveal"];
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.includes(key), false, `${path}.${key} leaked hidden state`);
    assertNoHiddenState(child, `${path}.${key}`);
  }
}
function assertBombStatusesHaveNoCells(state) {
  for (const bomb of state.bombStatuses || []) assert.equal(Object.hasOwn(bomb, "cell"), false, "countdown status leaked a bomb cell");
}
async function createAndJoin(url, names = ["红方", "绿方"], frames = [[], []]) {
  const a = await open(url, frames[0]);
  const b = await open(url, frames[1]);
  const createdP = next(a, "created");
  const waitingP = next(a, "roomState");
  send(a, "create", { gameId: "timed-mines", playerName: names[0] });
  const created = await createdP;
  assert.equal((await waitingP).gameId, "timed-mines");
  const starts = [next(a, "start"), next(b, "start")];
  const states = [next(a, "gameState"), next(b, "gameState")];
  send(b, "join", { code: created.code, playerName: names[1] });
  return { a, b, created, starts: await Promise.all(starts), initialStates: await Promise.all(states), frames };
}
async function place(ws, placement) {
  for (const cell of placement.normal) {
    const state = next(ws, "gameState");
    send(ws, "gameAction", { action: "placeExplosive", kind: "normal", cell });
    await state;
  }
  for (const bomb of placement.timed) {
    const state = next(ws, "gameState");
    send(ws, "gameAction", { action: "placeExplosive", kind: "timed", number: bomb.number, cell: bomb.cell });
    await state;
  }
}
async function leaveAll(...sockets) {
  for (const ws of sockets) if (ws?.readyState === WebSocket.OPEN) send(ws, "leave");
  await Promise.all(sockets.map(close));
}

(async () => {
  const listener = await new Promise((resolve) => { const instance = server.listen(0, "127.0.0.1", () => resolve(instance)); });
  const url = `ws://127.0.0.1:${listener.address().port}`;
  const live = [];
  try {
    const frames = [[], []];
    const match = await createAndJoin(url, ["红方", "绿方"], frames); live.push(match.a, match.b);
    const sockets = [match.a, match.b];
    const room = rooms.get(match.created.code);
    assert.equal(room.gameId, "timed-mines");
    match.initialStates.forEach((state, seat) => {
      assert.equal(state.phase, "PLACING");
      assert.deepEqual(state.placement, { normal: [], timed: [] });
      assert.deepEqual(state.positions, L.START_CELLS);
      assert.deepEqual(state.treasures, L.TREASURE_CELLS);
      assert.equal(state.confirmed[seat], false);
      assertNoHiddenState({ ...state, placement: undefined });
    });

    const illegalConfirm = next(match.a, "error");
    send(match.a, "gameAction", { action: "confirmPlacement" });
    assert.match((await illegalConfirm).message, /12.*3/);

    const reserved = new Set([20, 21, 40, 41, 49, 50, 51, 60, 61, 62, 70, 71, 100]);
    const candidates = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter((cell) => L.isLegalExplosiveCell(cell) && !reserved.has(cell) && ![30, 41, 42].includes(cell));
    const redPlacement = { normal: [30, 41, ...candidates.slice(0, 10)], timed: [{ number: 1, cell: 40 }, { number: 2, cell: 50 }, { number: 3, cell: 70 }] };
    const greenPlacement = { normal: [30, 42, ...candidates.slice(15, 25)], timed: [{ number: 1, cell: 40 }, { number: 2, cell: 51 }, { number: 3, cell: 41 }] };
    await place(match.a, redPlacement);
    await place(match.b, greenPlacement);

    const lockedAStates = [next(match.a, "gameState", (state) => state.confirmed?.[0]), next(match.b, "gameState", (state) => state.confirmed?.[0])];
    send(match.a, "gameAction", { action: "confirmPlacement" });
    const [lockedA, opponentView] = await Promise.all(lockedAStates);
    assert.equal(lockedA.placement, undefined, "confirmed owner retained their placement");
    assert.deepEqual(opponentView.placement, greenPlacement, "unconfirmed opponent did not retain only their placement");
    assert.equal(JSON.stringify(opponentView).includes("\"cell\":50"), false, "opponent received red timed bomb coordinate");

    const oldA = match.a;
    await close(oldA);
    const restoredA = await open(url, frames[0]); live.push(restoredA);
    const rejoinedA = next(restoredA, "rejoined");
    send(restoredA, "rejoin", { code: room.code, seat: 0, token: match.starts[0].token });
    const restoredPlacementState = (await rejoinedA).state;
    assert.equal(restoredPlacementState.placement, undefined);
    assertNoHiddenState(restoredPlacementState);
    sockets[0] = restoredA;
    match.a = restoredA;

    const playingStates = [next(sockets[0], "gameState", (state) => state.phase === "PLAYING"), next(sockets[1], "gameState", (state) => state.phase === "PLAYING")];
    send(sockets[1], "gameAction", { action: "confirmPlacement" });
    const playing = await Promise.all(playingStates);
    playing.forEach((state) => {
      assertNoHiddenState(state);
      assertBombStatusesHaveNoCells(state);
      assert.equal(state.bombStatuses.length, 6);
      assert.equal(state.turnCount, 0);
    });

    room.state.currentTurn = 0;
    room.state.positions = [...L.START_CELLS];
    const outsideTurn = next(sockets[1], "error");
    send(sockets[1], "gameAction", { action: "activateBomb", number: 1 });
    assert.match((await outsideTurn).message, /自己的正常移动回合/);
    const forgedOwner = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "activateBomb", owner: 1, number: 1 });
    assert.match((await forgedOwner).message, /自己的定时炸弹/);
    const forgedNumber = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "activateBomb", number: 4 });
    assert.match((await forgedNumber).message, /编号无效/);
    const forgedScore = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "move", cell: 20, score: 999 });
    assert.match((await forgedScore).message, /权威状态字段/);
    assert.deepEqual(room.state.scores, [0, 0]);
    assert.deepEqual(room.state.positions, L.START_CELLS);

    const beforeForgedLocation = {
      bombStatus: room.state.timedPlacements[0].get(2).status,
      activationUsed: room.state.activationUsed,
      scores: [...room.state.scores],
      positions: [...room.state.positions],
      turnCount: room.state.turnCount,
    };
    const forgedLocation = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "activateBomb", number: 2, bombLocation: 50 });
    assert.match((await forgedLocation).message, /权威状态字段/);
    assert.deepEqual({
      bombStatus: room.state.timedPlacements[0].get(2).status,
      activationUsed: room.state.activationUsed,
      scores: room.state.scores,
      positions: room.state.positions,
      turnCount: room.state.turnCount,
    }, beforeForgedLocation);
    assert.equal(room.state.timedPlacements[0].get(2).status, L.BOMB_STATUSES.UNACTIVATED);
    assert.equal(room.state.activationUsed, false);

    const activatedStates = sockets.map((socket) => next(socket, "gameState", (state) => state.recentEvents?.some((event) => event.kind === "activation")));
    send(sockets[0], "gameAction", { action: "activateBomb", number: 2 });
    const activated = await Promise.all(activatedStates);
    activated.forEach((state) => {
      assertBombStatusesHaveNoCells(state);
      assert.equal(state.recentEvents[0].number, 2);
      assert.equal(Object.hasOwn(state.recentEvents[0], "cell"), false);
      assert.equal(JSON.stringify(state).includes("\"cell\":50"), false);
    });
    const secondActivation = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "activateBomb", number: 1 });
    assert.match((await secondActivation).message, /最多启动一颗/);

    const afterRedMove = next(sockets[1], "gameState", (state) => state.currentTurn === 1 && state.turnCount === 1);
    send(sockets[0], "gameAction", { action: "move", cell: 20 });
    const redMoved = await afterRedMove;
    assert.equal(redMoved.bombStatuses.find((bomb) => bomb.seat === 0 && bomb.number === 2).remainingOpponentMoves, 2);
    const duplicateMove = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "move", cell: 21 });
    assert.match((await duplicateMove).message, /不能移动/);

    await close(sockets[0]);
    const gameplayA = await open(url, frames[0]); live.push(gameplayA);
    const gameplayRejoinP = next(gameplayA, "rejoined");
    send(gameplayA, "rejoin", { code: room.code, seat: 0, token: match.starts[0].token });
    const gameplayRejoin = await gameplayRejoinP;
    assertNoHiddenState(gameplayRejoin.state);
    assertBombStatusesHaveNoCells(gameplayRejoin.state);
    assert.equal(gameplayRejoin.state.bombStatuses.find((bomb) => bomb.seat === 0 && bomb.number === 2).remainingOpponentMoves, 2);
    assert.equal(JSON.stringify(gameplayRejoin.state).includes("\"cell\":50"), false);
    sockets[0] = gameplayA;
    match.a = gameplayA;

    const afterGreenMove = next(sockets[0], "gameState", (state) => state.currentTurn === 0 && state.turnCount === 2);
    send(sockets[1], "gameAction", { action: "move", cell: 100 });
    const greenMoved = await afterGreenMove;
    assert.equal(greenMoved.bombStatuses.find((bomb) => bomb.seat === 0 && bomb.number === 2).remainingOpponentMoves, 1);
    const activeAgain = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "activateBomb", number: 2 });
    assert.match((await activeAgain).message, /不能再次启动/);
    const afterRedAgain = next(sockets[1], "gameState", (state) => state.currentTurn === 1 && state.turnCount === 3);
    send(sockets[0], "gameAction", { action: "move", cell: 21 });
    await afterRedAgain;

    room.state.positions = [49, 61];
    room.state.currentTurn = 1;
    const normalsBeforeBlast = room.state.normalPlacements.map((mines) => [...mines].sort((a, b) => a - b));
    const scoreBeforeBlast = [...room.state.scores];
    const explodedStates = sockets.map((socket) => next(socket, "gameState", (state) => state.publicExplosions?.length === 1));
    send(sockets[1], "gameAction", { action: "move", cell: 60 });
    const exploded = await Promise.all(explodedStates);
    assert.equal(room.state.timedPlacements[0].get(2).status, L.BOMB_STATUSES.DETONATED);
    assert.deepEqual(room.state.normalPlacements.map((mines) => [...mines].sort((a, b) => a - b)), normalsBeforeBlast, "blast removed normal mines");
    assert.equal(room.state.timedPlacements[0].get(1).status, L.BOMB_STATUSES.UNACTIVATED, "blast triggered another timed bomb");
    assert.equal(room.state.timedPlacements[1].get(2).status, L.BOMB_STATUSES.UNACTIVATED, "blast removed opponent timed bomb");
    assert.deepEqual(room.state.positions, L.START_CELLS);
    assert.equal(room.state.scores[0], scoreBeforeBlast[0] - 5);
    assert.equal(room.state.scores[1], scoreBeforeBlast[1] + 15 - 5);
    exploded.forEach((state) => {
      const event = state.recentEvents.find((entry) => entry.kind === "timed-explosion");
      assert.equal(event.cell, 50);
      assert.deepEqual(event.affectedSeats, [0, 1]);
      assert.deepEqual(event.blastCells, L.blastCells(50));
      assertBombStatusesHaveNoCells(state);
    });

    room.state.currentTurn = 0;
    const explodedActivation = next(sockets[0], "error");
    send(sockets[0], "gameAction", { action: "activateBomb", number: 2 });
    assert.match((await explodedActivation).message, /不能再次启动/);

    room.state.positions = [40, 100];
    room.state.currentTurn = 0;
    room.state.turnCount = 69;
    room.state.activationUsed = false;
    const terminalStates = sockets.map((socket) => next(socket, "gameState", (state) => state.phase === "FINISHED"));
    send(sockets[0], "gameAction", { action: "move", cell: 41 });
    const terminal = await Promise.all(terminalStates);
    assert.equal(room.state.turnCount, 70);
    assert.equal(room.state.normalPlacements[0].has(41), false);
    assert.equal(room.state.timedPlacements[1].get(3).cell, 41, "normal mine hit consumed co-located timed bomb");
    assert.equal(room.state.timedPlacements[1].get(3).status, L.BOMB_STATUSES.UNACTIVATED);
    terminal.forEach((state) => {
      assert.equal(state.finishReason, "已完成 70 个移动回合");
      assert.ok(state.finalExplosiveReveal);
      assert.deepEqual([...state.finalExplosiveReveal.red.normal].sort((a, b) => a - b), [...redPlacement.normal].sort((a, b) => a - b));
      assert.deepEqual(state.finalExplosiveReveal.green.timed.map((bomb) => ({ number: bomb.number, cell: bomb.cell })), greenPlacement.timed);
      assert.equal(state.finalExplosiveReveal.red.timed.find((bomb) => bomb.number === 2).detonated, true);
      assert.deepEqual(state.finalExplosiveReveal.triggeredNormal.at(-1), { cell: 41, owners: [0] });
    });

    await close(sockets[1]);
    const terminalB = await open(url, frames[1]); live.push(terminalB);
    const terminalRejoinP = next(terminalB, "rejoined");
    send(terminalB, "rejoin", { code: room.code, seat: 1, token: match.starts[1].token });
    const terminalRejoin = await terminalRejoinP;
    assert.deepEqual(terminalRejoin.state.finalExplosiveReveal, terminal[1].finalExplosiveReveal);
    sockets[1] = terminalB;
    match.b = terminalB;

    const oldState = room.state;
    const restarts = sockets.map((socket) => next(socket, "restart"));
    send(sockets[0], "restart");
    send(sockets[1], "restart");
    await Promise.all(restarts);
    assert.equal(room.state.phase, "PLACING");
    assert.deepEqual(room.state.originalNormalPlacements, [null, null]);
    assert.deepEqual(room.state.originalTimedPlacements, [null, null]);
    assert.equal(room.state.timedExplosionHistory.length, 0);
    assert.equal(room.state.turnCount, 0);
    gameHandlers.get("timed-mines").handlePlacementTimeout(room, oldState);
    assert.equal(room.state.phase, "PLACING", "stale placement callback mutated restart state");

    const treasureMatch = await createAndJoin(url, ["寻宝甲", "寻宝乙"]); live.push(treasureMatch.a, treasureMatch.b);
    const treasureRoom = rooms.get(treasureMatch.created.code);
    treasureRoom.state.phase = "PLAYING";
    treasureRoom.state.confirmed = [true, true];
    treasureRoom.state.placementDeadline = null;
    clearTimeout(treasureRoom.placementTimer);
    treasureRoom.state.normalPlacements = [new Set(), new Set()];
    treasureRoom.state.originalNormalPlacements = [new Set(), new Set()];
    treasureRoom.state.timedPlacements = [
      new Map([[1, { number: 1, cell: 109, status: L.BOMB_STATUSES.ACTIVE, remainingOpponentMoves: 1 }]]),
      new Map(),
    ];
    treasureRoom.state.originalTimedPlacements = [new Map([[1, 109]]), new Map()];
    treasureRoom.state.positions = [0, 119];
    treasureRoom.state.currentTurn = 1;
    treasureRoom.state.turnCount = 69;
    treasureRoom.state.scores = [15, 20];
    treasureRoom.state.collectedTreasures = [{ cell: 0, seat: 0, value: 15, order: 1 }, { cell: 60, seat: 1, value: 20, order: 2 }];
    const treasureFinished = next(treasureMatch.a, "gameState", (state) => state.phase === "FINISHED");
    send(treasureMatch.b, "gameAction", { action: "move", cell: 120 });
    const treasureTerminal = await treasureFinished;
    assert.equal(treasureRoom.state.turnCount, 70);
    assert.equal(treasureRoom.state.timedPlacements[0].get(1).status, L.BOMB_STATUSES.ACTIVE, "pending blast ran after third treasure");
    assert.equal(treasureRoom.state.timedExplosionHistory.length, 0);
    assert.equal(treasureTerminal.finishReason, "三个宝物均已找到");
    assert.deepEqual(treasureTerminal.scores, [15, 45]);

    const immunityMatch = await createAndJoin(url, ["免疫甲", "受伤乙"]); live.push(immunityMatch.a, immunityMatch.b);
    const immunityRoom = rooms.get(immunityMatch.created.code);
    clearTimeout(immunityRoom.placementTimer);
    immunityRoom.state.phase = "PLAYING";
    immunityRoom.state.confirmed = [true, true];
    immunityRoom.state.placementDeadline = null;
    immunityRoom.state.normalPlacements = [new Set(), new Set()];
    immunityRoom.state.originalNormalPlacements = [new Set(), new Set()];
    immunityRoom.state.timedPlacements = [
      new Map([[1, { number: 1, cell: 19, status: L.BOMB_STATUSES.ACTIVE, remainingOpponentMoves: 1 }]]),
      new Map(),
    ];
    immunityRoom.state.originalTimedPlacements = [new Map([[1, 19]]), new Map()];
    immunityRoom.state.positions = [9, 7];
    immunityRoom.state.scores = [6, 6];
    immunityRoom.state.currentTurn = 1;
    immunityRoom.state.turnCount = 68;
    const immunityState = next(immunityMatch.a, "gameState", (state) => state.publicExplosions?.length === 1);
    send(immunityMatch.b, "gameAction", { action: "move", cell: 8 });
    const immunityResult = await immunityState;
    assert.deepEqual(immunityRoom.state.scores, [6, 3], "green earns 2 neighbor points before taking the 5-point blast penalty while red remains immune");
    assert.deepEqual(immunityRoom.state.positions, [9, L.START_CELLS[1]]);
    assert.deepEqual(immunityResult.publicExplosions[0].affectedSeats, [1]);

    immunityRoom.state.normalPlacements[0].add(21);
    immunityRoom.state.originalNormalPlacements[0].add(21);
    immunityRoom.state.positions = [20, L.START_CELLS[0]];
    immunityRoom.state.currentTurn = 0;
    immunityRoom.state.turnCount = 20;
    const turnsBeforeReentry = immunityRoom.state.turnCount;
    const collisionState = next(immunityMatch.a, "gameState", (state) => state.phase === "REENTRY");
    send(immunityMatch.a, "gameAction", { action: "move", cell: 21 });
    const collision = await collisionState;
    assert.deepEqual(collision.positions, [null, L.START_CELLS[0]]);
    assert.equal(collision.pendingReentrySeat, 0);
    assert.equal(immunityRoom.state.turnCount, turnsBeforeReentry + 1);
    const afterReentry = next(immunityMatch.a, "gameState", (state) => state.phase === "PLAYING");
    send(immunityMatch.a, "gameAction", { action: "reenter", cell: 9 });
    await afterReentry;
    assert.equal(immunityRoom.state.turnCount, turnsBeforeReentry + 1, "reentry incremented the movement counter");
    assert.deepEqual(immunityRoom.state.positions, [9, L.START_CELLS[0]]);

    immunityRoom.state.positions = [20, 100];
    immunityRoom.state.currentTurn = 0;
    immunityRoom.state.turnCount = 69;
    immunityRoom.state.scores = [4, 4];
    const tieFinished = next(immunityMatch.a, "gameState", (state) => state.phase === "FINISHED");
    send(immunityMatch.a, "gameAction", { action: "move", cell: 21 });
    const tieResult = await tieFinished;
    assert.equal(tieResult.finishOutcome, L.FINISH_OUTCOMES.DRAW);
    assert.equal(tieResult.winner, null);
    assert.deepEqual(tieResult.scores, [4, 4]);

    const timeoutMatch = await createAndJoin(url, ["超时甲", "超时乙"]); live.push(timeoutMatch.a, timeoutMatch.b);
    const timeoutRoom = rooms.get(timeoutMatch.created.code);
    timeoutRoom.state.normalPlacements[0] = new Set(redPlacement.normal);
    timeoutRoom.state.timedPlacements[0] = new Map(redPlacement.timed.map((bomb) => [bomb.number, { ...bomb, status: L.BOMB_STATUSES.UNACTIVATED, remainingOpponentMoves: null }]));
    timeoutRoom.state.normalPlacements[1] = new Set(greenPlacement.normal.slice(0, 5));
    const timeoutFinished = next(timeoutMatch.a, "gameFinished");
    await close(timeoutMatch.b);
    gameHandlers.get("timed-mines").handlePlacementTimeout(timeoutRoom, timeoutRoom.state);
    const timeoutResult = await timeoutFinished;
    assert.equal(timeoutResult.winner, 0);
    assert.equal(timeoutResult.finishOutcome, L.FINISH_OUTCOMES.WINNER);
    assert.equal(timeoutRoom.state.confirmed[0], true);
    assert.equal(timeoutRoom.state.confirmed[1], false);
    assertNoHiddenState(timeoutResult);

    const preFinished = frames.flat().filter((frame) => frame.phase !== "FINISHED" && frame.state?.phase !== "FINISHED");
    preFinished.forEach((frame) => {
      if (frame.phase !== "PLACING" || frame.confirmed?.[0]) assertNoHiddenState(frame);
      assertBombStatusesHaveNoCells(frame);
    });
    await leaveAll(match.a, match.b, treasureMatch.a, treasureMatch.b, immunityMatch.a, immunityMatch.b, timeoutMatch.a);
    console.log("ok online: timed mines authority, countdown, explosions, secrecy, reconnect, restart, and terminal rules");
  } finally {
    await Promise.allSettled(live.map(close));
    for (const room of rooms.values()) room.players.forEach((player) => { if (player?.readyState === WebSocket.OPEN) send(player, "leave"); });
    await new Promise((resolve) => listener.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
