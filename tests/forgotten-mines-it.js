"use strict";

process.env.RECONNECT_GRACE_MS = "500";
process.env.FORGOTTEN_MINES_PLACEMENT_MS = "60000";

const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { server, rooms, gameHandlers } = require("../server");
const L = require("../js/games/forgotten-mines-logic");

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
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assertNoPlacement(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.notEqual(key, "placement", `${path}.${key} leaked a placement`);
    assert.notEqual(key, "placements", `${path}.${key} leaked placements`);
    assert.notEqual(key, "mineSets", `${path}.${key} leaked mine sets`);
    assertNoPlacement(child, `${path}.${key}`);
  }
}
async function createAndJoin(url, gameId, names = ["甲", "乙"], frames = [[], []]) {
  const a = await open(url, frames[0]);
  const b = await open(url, frames[1]);
  const createdP = next(a, "created");
  const waitingP = next(a, "roomState");
  send(a, "create", { gameId, playerName: names[0] });
  const created = await createdP;
  assert.equal(created.gameId, gameId);
  assert.equal((await waitingP).gameId, gameId);
  const starts = [next(a, "start"), next(b, "start")];
  send(b, "join", { code: created.code, playerName: names[1] });
  const [startA, startB] = await Promise.all(starts);
  assert.equal(startA.gameId, gameId);
  assert.equal(startB.gameId, gameId);
  return { a, b, created, starts: [startA, startB], frames };
}
async function toggleMany(ws, cells) {
  for (const cell of cells) {
    const state = next(ws, "gameState");
    send(ws, "gameAction", { action: "toggleMine", cell });
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
    const unsupported = await open(url); live.push(unsupported);
    const unsupportedError = next(unsupported, "error");
    send(unsupported, "create", { gameId: "missing-game", playerName: "攻击者" });
    assert.match((await unsupportedError).message, /不支持/);

    const minesRoom = await createAndJoin(url, "minesweeper-duel", ["扫雷甲", "扫雷乙"]); live.push(minesRoom.a, minesRoom.b);
    const forgottenFrames = [[], []];
    const match = await createAndJoin(url, "forgotten-mines", ["红方", "绿方"], forgottenFrames); live.push(match.a, match.b);
    assert.notEqual(minesRoom.created.code, match.created.code);
    assert.equal(rooms.get(match.created.code).gameId, "forgotten-mines");

    const invalidReady = next(match.a, "error");
    send(match.a, "gameAction", { action: "confirmPlacement", score: 999, winner: 0 });
    assert.match((await invalidReady).message, /15/);
    const legal = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter(L.isLegalMineCell);
    const sharedPlacement = [30, 88, ...legal.filter((cell) => ![30, 88].includes(cell)).slice(0, 13)];
    await toggleMany(match.a, sharedPlacement);
    await toggleMany(match.b, sharedPlacement);

    const lockA = next(match.a, "gameState", (message) => message.confirmed?.[0] === true);
    send(match.a, "gameAction", { action: "confirmPlacement" });
    const lockedA = await lockA;
    assert.equal(lockedA.placement, undefined, "confirmed player retained their own mines");
    const editAfterLock = next(match.a, "error");
    send(match.a, "gameAction", { action: "toggleMine", cell: legal[20] });
    assert.match((await editAfterLock).message, /不能布雷|不能/);

    const oldA = match.a;
    await close(oldA);
    const rejoinedA = await open(url, forgottenFrames[0]); live.push(rejoinedA);
    const restoredAP = next(rejoinedA, "rejoined");
    send(rejoinedA, "rejoin", { code: match.created.code, seat: 0, token: match.starts[0].token });
    const restoredA = await restoredAP;
    assert.equal(restoredA.gameId, "forgotten-mines");
    assert.equal(restoredA.state.placement, undefined);
    assertNoPlacement(restoredA.state);
    match.a = rejoinedA;

    const oldB = match.b;
    await close(oldB);
    const rejoinedB = await open(url, forgottenFrames[1]); live.push(rejoinedB);
    const restoredBP = next(rejoinedB, "rejoined");
    send(rejoinedB, "rejoin", { code: match.created.code, seat: 1, token: match.starts[1].token });
    const restoredB = await restoredBP;
    assert.deepEqual(new Set(restoredB.state.placement), new Set(sharedPlacement), "unconfirmed player did not recover only their placement");
    match.b = rejoinedB;

    const playingStates = [next(match.a, "gameState", (message) => message.phase === "PLAYING"), next(match.b, "gameState", (message) => message.phase === "PLAYING")];
    send(match.b, "gameAction", { action: "confirmPlacement", position: 60, score: 999 });
    const [playingA, playingB] = await Promise.all(playingStates);
    for (const state of [playingA, playingB]) { assertNoPlacement(state); assert.equal([0, 1].includes(state.currentTurn), true); }
    assert.deepEqual(playingA.positions, playingB.positions);
    assert.deepEqual(playingA.scores, playingB.scores);

    const room = rooms.get(match.created.code);
    const sockets = [match.a, match.b];
    const first = room.state.currentTurn;
    const second = 1 - first;
    const safeSteps = first === 0 ? [20, 99] : [99, 20];
    const playingSocket = sockets[second];
    await close(playingSocket);
    const playingRestored = await open(url, forgottenFrames[second]); live.push(playingRestored);
    const playingRejoinP = next(playingRestored, "rejoined");
    send(playingRestored, "rejoin", { code: room.code, seat: second, token: match.starts[second].token });
    const playingRejoin = await playingRejoinP;
    assert.equal(playingRejoin.state.phase, "PLAYING");
    assertNoPlacement(playingRejoin.state);
    sockets[second] = playingRestored;
    if (second === 0) match.a = playingRestored; else match.b = playingRestored;
    const safeState1 = next(sockets[second], "gameState", (message) => message.currentTurn === second);
    send(sockets[first], "gameAction", { action: "move", cell: safeSteps[0], score: 500, currentTurn: first });
    await safeState1;
    const repeated = next(sockets[first], "error");
    send(sockets[first], "gameAction", { action: "move", cell: safeSteps[0] });
    assert.match((await repeated).message, /不能移动/);
    const safeState2 = next(sockets[first], "gameState", (message) => message.currentTurn === first);
    send(sockets[second], "gameAction", { action: "move", cell: safeSteps[1] });
    await safeState2;

    const mineCell = first === 0 ? 30 : 88;
    const scoreBeforeMine = room.state.scores[first];
    const reentryStates = [next(sockets[0], "gameState", (message) => message.phase === "REENTRY"), next(sockets[1], "gameState", (message) => message.phase === "REENTRY")];
    send(sockets[first], "gameAction", { action: "move", cell: mineCell, score: 1000, result: "safe" });
    const reentry = await Promise.all(reentryStates);
    assert.equal(reentry[0].scores[first], scoreBeforeMine - 5);
    assert.equal(reentry[0].latestEvent.text.includes("-5"), true);
    reentry.forEach(assertNoPlacement);
    assert.equal(room.state.placements[0].has(mineCell), false);
    assert.equal(room.state.placements[1].has(mineCell), false);

    const wrongReentry = next(sockets[second], "error");
    send(sockets[second], "gameAction", { action: "reenter", cell: L.legalReentryCells(second, room.state.positions[first])[0] });
    assert.match((await wrongReentry).message, /不能选择/);
    const actorBeforeReconnect = sockets[first];
    await close(actorBeforeReconnect);
    const actorRestored = await open(url, forgottenFrames[first]); live.push(actorRestored);
    const actorRejoinP = next(actorRestored, "rejoined");
    send(actorRestored, "rejoin", { code: room.code, seat: first, token: match.starts[first].token });
    const actorRejoin = await actorRejoinP;
    assert.equal(actorRejoin.state.phase, "REENTRY");
    assertNoPlacement(actorRejoin.state);
    sockets[first] = actorRestored;
    if (first === 0) match.a = actorRestored; else match.b = actorRestored;
    const reentryCell = L.legalReentryCells(first, room.state.positions[second]).find((cell) => !room.state.exhaustedSafeCells.has(cell));
    const afterReentry = next(sockets[second], "gameState", (message) => message.phase === "PLAYING" && message.currentTurn === second);
    send(sockets[first], "gameAction", { action: "reenter", cell: reentryCell, score: 999 });
    const reentered = await afterReentry;
    assert.equal(reentered.exhaustedSafeCells.includes(reentryCell), false);

    room.state.currentTurn = second;
    room.state.positions[second] = 108;
    room.state.positions[first] = L.START_CELLS[first];
    room.state.collectedTreasures = [{ cell: 0, seat: first, value: 10, order: 1 }, { cell: 60, seat: second, value: 15, order: 2 }];
    room.state.scores = [20, 20];
    const finishedMessages = [next(sockets[0], "gameFinished"), next(sockets[1], "gameFinished")];
    send(sockets[second], "gameAction", { action: "move", cell: 120, winner: first, score: -999 });
    const terminal = await Promise.all(finishedMessages);
    assert.equal(terminal[0].winner, second);
    assert.deepEqual(terminal[0].scores, terminal[1].scores);
    terminal.forEach(assertNoPlacement);
    assert.equal(room.state.phase, "FINISHED");

    const restartA = next(sockets[0], "restart");
    const restartB = next(sockets[1], "restart");
    send(sockets[0], "restart");
    send(sockets[0], "restart");
    send(sockets[1], "restart");
    const restarts = await Promise.all([restartA, restartB]);
    assert.equal(restarts[0].gameId, "forgotten-mines");
    assert.equal(room.state.phase, "PLACING");
    assert.deepEqual(room.state.scores, [0, 0]);
    assert.equal(room.state.placements[0].size, 0);
    assert.equal(room.state.exhaustedSafeCells.size, 0);
    assert.equal(room.state.collectedTreasures.length, 0);

    const timeoutMatch = await createAndJoin(url, "forgotten-mines", ["超时甲", "超时乙"]); live.push(timeoutMatch.a, timeoutMatch.b);
    const timeoutRoom = rooms.get(timeoutMatch.created.code);
    timeoutRoom.state.placements[0] = new Set(sharedPlacement);
    timeoutRoom.state.placements[1] = new Set(sharedPlacement.slice(0, 7));
    const timeoutFinished = next(timeoutMatch.a, "gameFinished");
    gameHandlers.get("forgotten-mines").handlePlacementTimeout(timeoutRoom, timeoutRoom.state);
    const timeoutResult = await timeoutFinished;
    assert.equal(timeoutResult.winner, 0);
    assert.equal(timeoutRoom.state.placements[0].size, 15);
    assert.equal(timeoutRoom.state.placements[1].size, 7);
    assertNoPlacement(timeoutResult);

    const bothFail = await createAndJoin(url, "forgotten-mines", ["空甲", "空乙"]); live.push(bothFail.a, bothFail.b);
    const bothFailRoom = rooms.get(bothFail.created.code);
    const noWinner = next(bothFail.a, "gameFinished");
    gameHandlers.get("forgotten-mines").handlePlacementTimeout(bothFailRoom, bothFailRoom.state);
    assert.equal((await noWinner).winner, null);

    const bothReady = await createAndJoin(url, "forgotten-mines", ["自动甲", "自动乙"]); live.push(bothReady.a, bothReady.b);
    const bothReadyRoom = rooms.get(bothReady.created.code);
    bothReadyRoom.state.placements = [new Set(sharedPlacement), new Set(sharedPlacement)];
    const autoStarted = next(bothReady.a, "gameState", (message) => message.phase === "PLAYING");
    gameHandlers.get("forgotten-mines").handlePlacementTimeout(bothReadyRoom, bothReadyRoom.state);
    await autoStarted;
    assert.deepEqual(bothReadyRoom.state.confirmed, [true, true]);
    const staleState = bothReadyRoom.state;
    gameHandlers.get("forgotten-mines").restart(bothReadyRoom);
    gameHandlers.get("forgotten-mines").handlePlacementTimeout(bothReadyRoom, staleState);
    assert.equal(bothReadyRoom.state.phase, "PLACING", "stale timer mutated a restarted match");
    assert.deepEqual(bothReadyRoom.state.confirmed, [false, false]);

    const expiring = await createAndJoin(url, "forgotten-mines", ["留守者", "离线者"]); live.push(expiring.a, expiring.b);
    const expiredCode = expiring.created.code;
    const disconnected = next(expiring.a, "opponentDisconnected");
    await close(expiring.b);
    await disconnected;
    const expired = next(expiring.a, "error", (message) => /未能及时重连/.test(message.message), 1_500);
    await expired;
    await wait(20);
    assert.equal(rooms.has(expiredCode), false);
    assert.equal(expiring.a.roomCode, undefined);

    const postConfirmFrames = forgottenFrames.flat().filter((message) => ["PLAYING", "REENTRY", "FINISHED"].includes(message.phase) || message.type === "gameFinished");
    postConfirmFrames.forEach(assertNoPlacement);
    await leaveAll(unsupported, minesRoom.a, minesRoom.b, match.a, match.b, timeoutMatch.a, timeoutMatch.b, bothFail.a, bothFail.b, bothReady.a, bothReady.b, expiring.a);
    console.log("ok online: multi-game forgotten-mines authority, secrecy, timeout, reconnect, and restart");
  } finally {
    await Promise.allSettled(live.map(close));
    for (const room of rooms.values()) room.players.forEach((player) => { if (player?.readyState === WebSocket.OPEN) send(player, "leave"); });
    await new Promise((resolve) => listener.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
