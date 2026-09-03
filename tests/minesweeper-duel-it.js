"use strict";
const assert = require("node:assert/strict");
const { server } = require("../server");
const WebSocket = require("ws");
function next(ws, type) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`timeout ${type}`)), 3000); ws.on("message", function on(raw) { const m = JSON.parse(raw); if (m.type === type) { clearTimeout(t); ws.off("message", on); resolve(m); } }); }); }
async function open(ws) { await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); }); }
(async () => {
  const listener = await new Promise((resolve) => { const s = server.listen(0, "127.0.0.1", () => resolve(s)); });
  const port = listener.address().port, a = new WebSocket(`ws://127.0.0.1:${port}`), b = new WebSocket(`ws://127.0.0.1:${port}`); await Promise.all([open(a), open(b)]);
  const made = next(a, "created"), waiting = next(a, "roomState"); a.send(JSON.stringify({ type: "create", gameId: "minesweeper-duel", playerName: "甲" })); const room = await made;
  assert.equal((await waiting).phase, "WAITING"); const waitingAction = next(a, "error"); a.send(JSON.stringify({ type: "gameAction", action: "place", cell: 0 })); assert.match((await waitingAction).message, /等待好友/);
  const starts = [next(a, "start"), next(b, "start")]; b.send(JSON.stringify({ type: "join", code: room.code, playerName: "乙" })); const [startA, startB] = await Promise.all(starts);
  assert.equal(typeof startA.token, "string"); assert.ok(startA.token); assert.equal(typeof startB.token, "string"); assert.ok(startB.token); assert.notEqual(startA.token, startB.token);
  for (const cell of Array.from({ length: 15 }, (_, i) => i)) a.send(JSON.stringify({ type: "gameAction", action: "place", cell }));
  for (const cell of Array.from({ length: 15 }, (_, i) => i + 20)) b.send(JSON.stringify({ type: "gameAction", action: "place", cell }));
  const sweep = next(a, "gameState"); a.send(JSON.stringify({ type: "gameAction", action: "ready" })); b.send(JSON.stringify({ type: "gameAction", action: "ready" })); const state = await sweep;
  assert.equal(state.phase, "SWEEPING"); assert.deepEqual(state.placement, Array.from({ length: 15 }, (_, i) => i)); assert.equal(state.boards, undefined, "hidden board leaked");
  const hitP = next(a, "revealResult"); a.send(JSON.stringify({ type: "gameAction", action: "reveal", cell: 20 })); const hit = await hitP; assert.equal(hit.cells[0].mine, true); assert.equal(hit.penalty, 10000);
  const duplicate = next(a, "error"); a.send(JSON.stringify({ type: "gameAction", action: "reveal", cell: 20 })); assert.match((await duplicate).message, /取消旗子|已翻开/);
  const disconnected = next(a, "opponentDisconnected"); b.close(); await disconnected;
  const attacker = new WebSocket(`ws://127.0.0.1:${port}`); await open(attacker);
  for (const token of [null, undefined, "incorrect-token"]) {
    const rejected = next(attacker, "error"); const attempt = { type: "rejoin", code: room.code, seat: 1 }; if (token !== undefined) attempt.token = token; attacker.send(JSON.stringify(attempt)); assert.match((await rejected).message, /重连失败/);
  }
  const guest = new WebSocket(`ws://127.0.0.1:${port}`); await open(guest); const rejoined = next(guest, "rejoined"); guest.send(JSON.stringify({ type: "rejoin", code: room.code, seat: 1, token: startB.token })); const restored = await rejoined; assert.equal(restored.seat, 1); assert.equal(restored.state.phase, "SWEEPING");
  const c = new WebSocket(`ws://127.0.0.1:${port}`), d = new WebSocket(`ws://127.0.0.1:${port}`); await Promise.all([open(c), open(d)]); const made2 = next(c, "created"); c.send(JSON.stringify({ type: "create", gameId: "minesweeper-duel", playerName: "丙" })); const room2 = await made2; const starts2 = [next(c, "start"), next(d, "start")]; d.send(JSON.stringify({ type: "join", code: room2.code, playerName: "丁" })); await Promise.all(starts2); for (let cell = 0; cell < 15; cell++) c.send(JSON.stringify({ type: "gameAction", action: "place", cell })); for (let cell = 20; cell < 35; cell++) d.send(JSON.stringify({ type: "gameAction", action: "place", cell })); const sweeping2 = next(c, "gameState"); c.send(JSON.stringify({ type: "gameAction", action: "ready" })); d.send(JSON.stringify({ type: "gameAction", action: "ready" })); await sweeping2;
  const hit2 = next(c, "revealResult"); c.send(JSON.stringify({ type: "gameAction", action: "reveal", cell: 20 })); assert.equal((await hit2).penalty, 10_000); const cFinished = next(c, "playerFinished"); for (let cell = 0; cell < 81; cell++) if (cell < 20 || cell >= 35) c.send(JSON.stringify({ type: "gameAction", action: "reveal", cell })); await cFinished; const cDisconnected = next(d, "opponentDisconnected"); c.close(); await cDisconnected; const finished2 = next(d, "gameFinished"); for (let cell = 15; cell < 81; cell++) d.send(JSON.stringify({ type: "gameAction", action: "reveal", cell })); assert.equal((await finished2).winner, 1, "connected player should beat the disconnected penalized finisher");
  a.close(); attacker.close(); guest.close(); d.close(); listener.close(); console.log("ok online: authoritative hidden-board and reconnect flow"); process.exit(0);
})().catch((err) => { console.error(err); process.exitCode = 1; });
