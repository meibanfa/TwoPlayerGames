"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const Logic = require("./js/games/minesweeper-duel-logic");

const configuredPort = process.env.PORT === undefined ? 8777 : Number(process.env.PORT);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) throw new Error("PORT must be an integer between 1 and 65535");
const PORT = configuredPort;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(__dirname);
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 45_000;
const PLACEMENT_MS = Number(process.env.PLACEMENT_MS) || 45_000;
const MAX_MESSAGE_BYTES = 12_000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 1_000;
const CREATE_LIMIT = Number(process.env.CREATE_LIMIT) || 12;
const CREATE_WINDOW_MS = Number(process.env.CREATE_WINDOW_MS) || 60_000;
const WAITING_ROOM_TTL_MS = Number(process.env.WAITING_ROOM_TTL_MS) || 5 * 60_000;
const FINISH_WINDOW_MS = Number(process.env.FINISH_WINDOW_MS) || 5_000;
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS) || 30_000;
const rooms = new Map();
const ipCreates = new Map();
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function send(ws, type, payload = {}) { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload })); }
function broadcast(room, type, payload = {}) { room.players.forEach((p) => send(p, type, payload)); }
function makeCode() { for (let i = 0; i < 10_000; i++) { const value = String(crypto.randomInt(1000, 10000)); if (!rooms.has(value)) return value; } return null; }
function makeToken() { return crypto.randomBytes(24).toString("base64url"); }
// eslint-disable-next-line no-control-regex -- strip control characters from player names
function cleanName(value, fallback) { return String(value || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24) || fallback; }
function roomFor(ws) { return ws.roomCode ? rooms.get(ws.roomCode) : null; }
function validCell(v) { return Number.isInteger(v) && v >= 0 && v < Logic.BOARD_ROWS * Logic.BOARD_COLS; }
function safeRevealCount(p, seat) { return [...p.revealed[seat]].filter((cell) => !p.mineHits[seat].has(cell)).length; }
function sendError(ws, message) { send(ws, "error", { message }); }
function newState(phase = "WAITING") { return { phase, placements: [new Set(), new Set()], ready: [false, false], boards: [null, null], counts: [null, null], revealed: [new Set(), new Set()], flags: [new Set(), new Set()], mineHits: [new Set(), new Set()], mistakes: [0, 0], penalty: [0, 0], placementDeadline: null, sweepStartedAt: null, completedAt: [null, null], winner: null, summary: null }; }
function finishSummary(p) { const effective = p.completedAt.map((at, i) => at === null ? null : at - p.sweepStartedAt + p.penalty[i]); return p.mistakes.map((mistakes, i) => ({ mistakes, penalty: p.penalty[i], elapsed: p.completedAt[i] === null ? null : p.completedAt[i] - p.sweepStartedAt, effectiveTime: effective[i] })); }
function publicState(room, seat) {
  const p = room.state;
  const state = { phase: p.phase, placement: [...p.placements[seat]], ready: p.ready[seat], revealed: [...p.revealed[seat]].map((cell) => ({ cell, mine: p.mineHits[seat].has(cell), count: p.mineHits[seat].has(cell) ? null : p.counts[seat]?.[cell] ?? 0 })), flags: [...p.flags[seat]], mistakes: p.mistakes[seat], penalty: p.penalty[seat], progress: [safeRevealCount(p, seat), safeRevealCount(p, 1 - seat)], total: Logic.BOARD_ROWS * Logic.BOARD_COLS - Logic.MINE_COUNT, placementDeadline: p.placementDeadline, sweepStartedAt: p.sweepStartedAt, winner: p.winner };
  if (p.phase === "FINISHED") { state.boards = p.boards.map((board) => [...board]); state.summary = p.summary || finishSummary(p); }
  return state;
}
function emitState(room, seat) { send(room.players[seat], "gameState", publicState(room, seat)); }
function emitProgress(room) { room.players.forEach((p, seat) => send(p, "progress", { mine: safeRevealCount(room.state, seat), opponent: safeRevealCount(room.state, 1 - seat), total: Logic.BOARD_ROWS * Logic.BOARD_COLS - Logic.MINE_COUNT, opponentMistakes: room.state.mistakes[1 - seat] })); }
function beginSweep(room) { const p = room.state; p.phase = "SWEEPING"; p.sweepStartedAt = Date.now(); p.placementDeadline = null; p.boards = [new Set(p.placements[1]), new Set(p.placements[0])]; p.counts = p.boards.map((b) => Logic.mineCounts([...b])); room.players.forEach((_, seat) => emitState(room, seat)); emitProgress(room); }
function autoPlacement(room) { const p = room.state; if (p.phase !== "PLACING") return; p.placements.forEach((set, seat) => { while (set.size < Logic.MINE_COUNT) set.add(crypto.randomInt(0, Logic.BOARD_ROWS * Logic.BOARD_COLS)); p.ready[seat] = true; }); beginSweep(room); }
function finalize(room) { const p = room.state; if (p.phase === "FINISHED") return; const effective = p.completedAt.map((at, i) => at === null ? Infinity : at - p.sweepStartedAt + p.penalty[i]); p.phase = "FINISHED"; p.finishedAt = Date.now(); p.winner = effective[0] === effective[1] ? null : (effective[0] < effective[1] ? 0 : 1); p.summary = finishSummary(p); broadcast(room, "gameFinished", { winner: p.winner, boards: p.boards.map((b) => [...b]), summary: p.summary }); room.players.forEach((_, i) => emitState(room, i)); }
function finish(room, seat) { const p = room.state; if (p.phase !== "SWEEPING" || p.completedAt[seat] !== null || !Logic.isComplete(p.revealed[seat], p.boards[seat])) return; p.completedAt[seat] = Date.now(); send(room.players[seat], "playerFinished", {}); if (p.completedAt[0] !== null && p.completedAt[1] !== null) { clearTimeout(room.finishTimer); return finalize(room); } room.finishTimer = setTimeout(() => finalize(room), FINISH_WINDOW_MS); }
function handleAction(room, ws, msg) {
  const seat = ws.seat, p = room.state, action = msg.action;
  if (p.phase === "WAITING") return sendError(ws, "请等待好友加入。");
  if (p.phase === "PLACING") {
    if (action === "place") { if (!validCell(msg.cell) || p.ready[seat]) return sendError(ws, "无法修改布雷。"); const set = p.placements[seat]; if (set.has(msg.cell)) set.delete(msg.cell); else if (set.size >= Logic.MINE_COUNT) return sendError(ws, "最多只能埋 15 颗雷。"); else set.add(msg.cell); return send(ws, "placementState", { count: set.size, placement: [...set] }); }
    if (action === "ready") { if (p.placements[seat].size !== Logic.MINE_COUNT || p.ready[seat]) return sendError(ws, "请先埋满 15 颗雷。"); p.ready[seat] = true; send(ws, "placementLocked", {}); broadcast(room, "placementProgress", { ready: p.ready }); if (p.ready.every(Boolean)) beginSweep(room); return; }
    return;
  }
  if (p.phase !== "SWEEPING" || p.completedAt[seat] !== null || !validCell(msg.cell)) return sendError(ws, "当前不能进行这个操作。");
  if (action === "flag") { if (p.revealed[seat].has(msg.cell)) return sendError(ws, "这个格子已经翻开。"); if (p.flags[seat].has(msg.cell)) p.flags[seat].delete(msg.cell); else p.flags[seat].add(msg.cell); return emitState(room, seat); }
  if (action === "reveal") { if (p.revealed[seat].has(msg.cell) || p.flags[seat].has(msg.cell)) return sendError(ws, "请先取消旗子。"); const board = p.boards[seat]; if (board.has(msg.cell)) { p.revealed[seat].add(msg.cell); p.mineHits[seat].add(msg.cell); p.mistakes[seat]++; p.penalty[seat] += 10_000; send(ws, "revealResult", { cells: [{ cell: msg.cell, mine: true }], mistakes: p.mistakes[seat], penalty: p.penalty[seat] }); } else { const cells = Logic.floodReveal([...board], msg.cell, [...p.revealed[seat], ...p.flags[seat]]); cells.forEach((x) => p.revealed[seat].add(x.cell)); send(ws, "revealResult", { cells }); } emitProgress(room); finish(room, seat); return; }
  sendError(ws, "未知操作。");
}
function disconnect(ws) { const room = roomFor(ws); if (!room || room.players[ws.seat] !== ws) return; room.players[ws.seat] = null; ws.roomCode = null; send(room.players[1 - ws.seat], "opponentDisconnected", {}); clearTimeout(room.dcTimers[ws.seat]); room.dcTimers[ws.seat] = setTimeout(() => { if (rooms.get(room.code) === room && !room.players[ws.seat]) { clearTimeout(room.placementTimer); clearTimeout(room.finishTimer); const remaining = room.players[1 - ws.seat]; if (remaining) { sendError(remaining, "对手未能及时重连，房间已结束。"); remaining.roomCode = null; remaining.seat = null; } rooms.delete(room.code); } }, RECONNECT_GRACE_MS); }
function removeMembership(ws) { const room = roomFor(ws); if (!room || room.players[ws.seat] !== ws) { ws.roomCode = null; ws.seat = null; return; } const seat = ws.seat, remaining = room.players[1 - seat]; room.players[seat] = null; clearTimeout(room.dcTimers[seat]); clearTimeout(room.waitingTimer); clearTimeout(room.placementTimer); clearTimeout(room.finishTimer); if (remaining) { sendError(remaining, "对手已离开房间。"); remaining.roomCode = null; remaining.seat = null; } rooms.delete(room.code); ws.roomCode = null; ws.seat = null; }
function allowCreate(ws) { const now = Date.now(); ws.createTimes = (ws.createTimes || []).filter((at) => now - at < CREATE_WINDOW_MS); const ip = ws.clientIp; const ipTimes = (ipCreates.get(ip) || []).filter((at) => now - at < CREATE_WINDOW_MS); if (ws.createTimes.length >= CREATE_LIMIT || ipTimes.length >= CREATE_LIMIT) return false; ws.createTimes.push(now); ipTimes.push(now); ipCreates.set(ip, ipTimes); return true; }

const PUBLIC_FILES = new Set(["index.html", "styles.css", "js/main.js", "js/net.js", "js/registry.js", "js/games/minesweeper-duel.js", "js/games/minesweeper-duel-logic.js"]);
const server = http.createServer((req, res) => { let requested; try { requested = decodeURIComponent((req.url || "/").split("?")[0]); } catch { res.writeHead(400); return res.end("Bad Request"); } if (requested === "/health") { res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" }); return res.end(JSON.stringify({ ok: true, uptimeSeconds: Math.floor(process.uptime()), rooms: rooms.size })); } const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, ""); if (!PUBLIC_FILES.has(relative)) { res.writeHead(404); return res.end("Not Found"); } const file = path.resolve(ROOT, relative); fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end("Not Found"); } res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" }); res.end(data); }); });
const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });
let startupComplete = false;
server.on("error", (error) => { console.error(`[server] http error: ${error.stack || error.message}`); if (require.main === module && !startupComplete) process.exitCode = 1; });
wss.on("error", (error) => console.error(`[server] websocket error: ${error.stack || error.message}`));
const heartbeat = setInterval(() => { wss.clients.forEach((client) => { if (client.isAlive === false) return client.terminate(); client.isAlive = false; client.ping(); }); }, WS_HEARTBEAT_MS);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));
wss.on("connection", (ws, req) => { const origin = req.headers.origin; if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return ws.close(1008, "origin"); ws.isAlive = true; ws.on("pong", () => { ws.isAlive = true; }); ws.clientIp = req.socket.remoteAddress || "unknown"; ws.on("message", (raw) => { let msg; try { msg = JSON.parse(raw); } catch { return sendError(ws, "消息格式无效。"); }
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return sendError(ws, "消息格式无效。");
  if (msg.type === "create") { if (msg.gameId !== "minesweeper-duel") return sendError(ws, "当前只开放互坑扫雷。"); if (!allowCreate(ws)) return sendError(ws, "创建房间过于频繁，请稍后再试。"); removeMembership(ws); if (rooms.size >= MAX_ROOMS) return sendError(ws, "房间数量已达上限，请稍后再试。"); const code = makeCode(); if (!code) return sendError(ws, "暂时无法创建房间，请稍后再试。"); const room = { code, players: [ws, null], names: [cleanName(msg.playerName, "玩家 1"), null], tokens: [makeToken(), null], dcTimers: [null, null], state: newState() }; rooms.set(room.code, room); room.waitingTimer = setTimeout(() => { if (rooms.get(room.code) === room && !room.players[1]) { send(room.players[0], "error", { message: "房间等待超时，请重新创建。" }); removeMembership(room.players[0]); } }, WAITING_ROOM_TTL_MS); room.waitingTimer.unref?.(); ws.roomCode = room.code; ws.seat = 0; send(ws, "created", { code: room.code, token: room.tokens[0], gameId: "minesweeper-duel", seat: 0, playerNames: room.names }); send(ws, "roomState", { phase: "WAITING" }); return; }
  if (msg.type === "join") { const room = rooms.get(String(msg.code || "")); if (!room || room.players[1] || room.tokens[1] || !room.players[0] || room.players[0] === ws) return sendError(ws, "房间不存在、已满或房主正在重连。"); removeMembership(ws); clearTimeout(room.waitingTimer); room.players[1] = ws; room.names[1] = cleanName(msg.playerName, "玩家 2"); room.tokens[1] = makeToken(); ws.roomCode = room.code; ws.seat = 1; room.state.phase = "PLACING"; room.state.placementDeadline = Date.now() + PLACEMENT_MS; room.players.forEach((p, seat) => send(p, "start", { code: room.code, gameId: "minesweeper-duel", seat, playerNames: room.names, phase: "PLACING", token: room.tokens[seat], placementDeadline: room.state.placementDeadline })); room.placementTimer = setTimeout(() => autoPlacement(room), PLACEMENT_MS); return; }
  if (msg.type === "gameAction") { const room = roomFor(ws); if (!room || ![0, 1].includes(ws.seat)) return sendError(ws, "你不在房间中。"); return handleAction(room, ws, msg); }
  if (msg.type === "restart") { const room = roomFor(ws); if (!room || room.state.phase !== "FINISHED") return sendError(ws, "当前不能再来一局。"); room.restartVotes ||= new Set(); room.restartVotes.add(ws.seat); if (room.restartVotes.size === 2) { room.state = newState("PLACING"); room.state.placementDeadline = Date.now() + PLACEMENT_MS; room.restartVotes.clear(); clearTimeout(room.placementTimer); clearTimeout(room.finishTimer); room.placementTimer = setTimeout(() => autoPlacement(room), PLACEMENT_MS); broadcast(room, "restart", { phase: "PLACING", placementDeadline: room.state.placementDeadline }); } else send(ws, "restartPending", {}); return; }
  if (msg.type === "rejoin") { const room = rooms.get(String(msg.code || "")), seat = Number(msg.seat), token = msg.token, currentRoom = roomFor(ws); if (currentRoom && (currentRoom !== room || ws.seat !== seat)) return sendError(ws, "重连失败，请先离开当前房间。"); if (!room || ![0, 1].includes(seat) || typeof token !== "string" || !token || typeof room.tokens[seat] !== "string" || !room.tokens[seat] || token !== room.tokens[seat] ) return sendError(ws, "重连失败，房间已失效。"); if (room.players[seat] && room.players[seat] !== ws) room.players[seat].roomCode = null; room.players[seat] = ws; ws.roomCode = room.code; ws.seat = seat; clearTimeout(room.dcTimers[seat]); send(ws, "rejoined", { code: room.code, gameId: "minesweeper-duel", seat, playerNames: room.names, state: publicState(room, seat) }); send(room.players[1 - seat], "opponentReconnected", {}); return; }
  if (msg.type === "leave") { removeMembership(ws); }
 }); ws.on("close", () => disconnect(ws)); });

if (require.main === module) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] received ${signal}; shutting down`);
    const deadline = setTimeout(() => { console.error("[server] shutdown timed out"); process.exit(1); }, 10_000);
    deadline.unref();
    rooms.forEach((room) => {
      clearTimeout(room.waitingTimer);
      clearTimeout(room.placementTimer);
      clearTimeout(room.finishTimer);
      room.dcTimers.forEach(clearTimeout);
    });
    clearInterval(heartbeat);
    wss.clients.forEach((client) => client.close(1012, "server restart"));
    server.close((error) => {
      clearTimeout(deadline);
      if (error) { console.error(`[server] shutdown error: ${error.stack || error.message}`); process.exit(1); }
      console.log("[server] shutdown complete");
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  server.listen(PORT, HOST, () => { startupComplete = true; console.log(`[server] 双人小游戏 listening on ${HOST}:${PORT} (${process.env.NODE_ENV || "development"})`); });
}
module.exports = { server, rooms, Logic, finish };
