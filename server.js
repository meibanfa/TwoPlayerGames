"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const createMinesweeperDuel = require("./server/games/minesweeper-duel");
const createForgottenMines = require("./server/games/forgotten-mines");

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
const FORGOTTEN_MINES_PLACEMENT_MS = Number(process.env.FORGOTTEN_MINES_PLACEMENT_MS) || 600_000;
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS) || 30_000;
const rooms = new Map();
const ipCreates = new Map();
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function send(ws, type, payload = {}) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}
function broadcast(room, type, payload = {}) { room.players.forEach((player) => send(player, type, payload)); }
function sendError(ws, message) { send(ws, "error", { message }); }

const gameHandlers = new Map();
function registerGame(handler) {
  if (!handler || !handler.id || gameHandlers.has(handler.id)) throw new Error("invalid or duplicate server game handler");
  gameHandlers.set(handler.id, handler);
}
registerGame(createMinesweeperDuel({ send, broadcast, sendError, placementMs: PLACEMENT_MS, finishWindowMs: FINISH_WINDOW_MS }));
registerGame(createForgottenMines({ send, broadcast, sendError, placementMs: FORGOTTEN_MINES_PLACEMENT_MS, isRoomActive: (room) => rooms.get(room.code) === room }));

function makeCode() {
  for (let i = 0; i < 10_000; i++) {
    const value = String(crypto.randomInt(1000, 10_000));
    if (!rooms.has(value)) return value;
  }
  return null;
}
function makeToken() { return crypto.randomBytes(24).toString("base64url"); }
// eslint-disable-next-line no-control-regex -- strip control characters from player names
function cleanName(value, fallback) { return String(value || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24) || fallback; }
function roomFor(ws) { return ws.roomCode ? rooms.get(ws.roomCode) : null; }
function handlerFor(room) { return room ? gameHandlers.get(room.gameId) : null; }
function clearRoomTimers(room) {
  clearTimeout(room.waitingTimer);
  clearTimeout(room.placementTimer);
  clearTimeout(room.finishTimer);
  room.dcTimers.forEach(clearTimeout);
  handlerFor(room)?.clearTimers?.(room);
}
function deleteRoom(room) {
  if (!room || rooms.get(room.code) !== room) return;
  clearRoomTimers(room);
  rooms.delete(room.code);
}
function removeMembership(ws) {
  const room = roomFor(ws);
  if (!room || room.players[ws.seat] !== ws) { ws.roomCode = null; ws.seat = null; return; }
  const seat = ws.seat;
  const remaining = room.players[1 - seat];
  room.players[seat] = null;
  if (remaining) { sendError(remaining, "对手已离开房间。"); remaining.roomCode = null; remaining.seat = null; }
  deleteRoom(room);
  ws.roomCode = null;
  ws.seat = null;
}
function disconnect(ws) {
  const room = roomFor(ws);
  if (!room || room.players[ws.seat] !== ws) return;
  const seat = ws.seat;
  room.players[seat] = null;
  ws.roomCode = null;
  ws.seat = null;
  send(room.players[1 - seat], "opponentDisconnected", { gameId: room.gameId });
  clearTimeout(room.dcTimers[seat]);
  room.dcTimers[seat] = setTimeout(() => {
    if (rooms.get(room.code) !== room || room.players[seat]) return;
    const remaining = room.players[1 - seat];
    if (remaining) { sendError(remaining, "对手未能及时重连，房间已结束。"); remaining.roomCode = null; remaining.seat = null; }
    deleteRoom(room);
  }, RECONNECT_GRACE_MS);
  room.dcTimers[seat].unref?.();
}
function allowCreate(ws) {
  const now = Date.now();
  ws.createTimes = (ws.createTimes || []).filter((at) => now - at < CREATE_WINDOW_MS);
  const ip = ws.clientIp;
  const ipTimes = (ipCreates.get(ip) || []).filter((at) => now - at < CREATE_WINDOW_MS);
  if (ws.createTimes.length >= CREATE_LIMIT || ipTimes.length >= CREATE_LIMIT) return false;
  ws.createTimes.push(now);
  ipTimes.push(now);
  ipCreates.set(ip, ipTimes);
  return true;
}

function createRoom(ws, message) {
  const handler = gameHandlers.get(message.gameId);
  if (!handler) return sendError(ws, "不支持这个游戏。");
  if (!allowCreate(ws)) return sendError(ws, "创建房间过于频繁，请稍后再试。");
  removeMembership(ws);
  if (rooms.size >= MAX_ROOMS) return sendError(ws, "房间数量已达上限，请稍后再试。");
  const code = makeCode();
  if (!code) return sendError(ws, "暂时无法创建房间，请稍后再试。");
  const room = {
    code,
    gameId: handler.id,
    players: [ws, null],
    names: [cleanName(message.playerName, "玩家 1"), null],
    tokens: [makeToken(), null],
    dcTimers: [null, null],
    state: handler.newState(),
  };
  rooms.set(room.code, room);
  room.waitingTimer = setTimeout(() => {
    if (rooms.get(room.code) === room && !room.players[1]) { sendError(room.players[0], "房间等待超时，请重新创建。"); removeMembership(room.players[0]); }
  }, WAITING_ROOM_TTL_MS);
  room.waitingTimer.unref?.();
  ws.roomCode = room.code;
  ws.seat = 0;
  send(ws, "created", { code: room.code, token: room.tokens[0], gameId: room.gameId, seat: 0, playerNames: room.names });
  send(ws, "roomState", { gameId: room.gameId, phase: "WAITING" });
}
function joinRoom(ws, message) {
  const room = rooms.get(String(message.code || ""));
  if (!room || room.players[1] || room.tokens[1] || !room.players[0] || room.players[0] === ws) return sendError(ws, "房间不存在、已满或房主正在重连。");
  const handler = handlerFor(room);
  if (!handler) return sendError(ws, "房间游戏不可用。");
  removeMembership(ws);
  clearTimeout(room.waitingTimer);
  room.players[1] = ws;
  room.names[1] = cleanName(message.playerName, "玩家 2");
  room.tokens[1] = makeToken();
  ws.roomCode = room.code;
  ws.seat = 1;
  handler.start(room);
  room.players.forEach((player, seat) => send(player, "start", {
    code: room.code,
    gameId: room.gameId,
    seat,
    playerNames: room.names,
    phase: room.state.phase,
    token: room.tokens[seat],
    placementDeadline: room.state.placementDeadline,
  }));
}
function restartRoom(ws) {
  const room = roomFor(ws);
  const handler = handlerFor(room);
  if (!room || !handler || room.state.phase !== "FINISHED") return sendError(ws, "当前不能再来一局。");
  room.restartVotes ||= new Set();
  room.restartVotes.add(ws.seat);
  if (room.restartVotes.size !== 2) return send(ws, "restartPending", { gameId: room.gameId });
  clearRoomTimers(room);
  room.restartVotes.clear();
  const state = handler.restart(room);
  broadcast(room, "restart", { gameId: room.gameId, ...state });
}
function rejoinRoom(ws, message) {
  const room = rooms.get(String(message.code || ""));
  const seat = Number(message.seat);
  const token = message.token;
  const currentRoom = roomFor(ws);
  if (currentRoom && (currentRoom !== room || ws.seat !== seat)) return sendError(ws, "重连失败，请先离开当前房间。");
  if (!room || ![0, 1].includes(seat) || typeof token !== "string" || !token || typeof room.tokens[seat] !== "string" || !room.tokens[seat] || token !== room.tokens[seat]) return sendError(ws, "重连失败，房间已失效。");
  const handler = handlerFor(room);
  if (!handler) return sendError(ws, "重连失败，房间游戏不可用。");
  if (room.players[seat] && room.players[seat] !== ws) { room.players[seat].roomCode = null; room.players[seat].seat = null; }
  room.players[seat] = ws;
  ws.roomCode = room.code;
  ws.seat = seat;
  clearTimeout(room.dcTimers[seat]);
  room.dcTimers[seat] = null;
  send(ws, "rejoined", { code: room.code, gameId: room.gameId, seat, playerNames: room.names, state: handler.publicState(room, seat) });
  send(room.players[1 - seat], "opponentReconnected", { gameId: room.gameId });
}

const PUBLIC_FILES = new Set(["index.html", "styles.css", "js/main.js", "js/net.js", "js/registry.js", "js/games/minesweeper-duel.js", "js/games/minesweeper-duel-logic.js", "js/games/forgotten-mines.js", "js/games/forgotten-mines-logic.js"]);
const server = http.createServer((req, res) => {
  let requested;
  try { requested = decodeURIComponent((req.url || "/").split("?")[0]); } catch { res.writeHead(400); res.end("Bad Request"); return; }
  if (requested === "/health") { res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" }); res.end(JSON.stringify({ ok: true, uptimeSeconds: Math.floor(process.uptime()), rooms: rooms.size })); return; }
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  if (!PUBLIC_FILES.has(relative)) { res.writeHead(404); res.end("Not Found"); return; }
  const file = path.resolve(ROOT, relative);
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end("Not Found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });
let startupComplete = false;
server.on("error", (error) => { console.error(`[server] http error: ${error.stack || error.message}`); if (require.main === module && !startupComplete) process.exitCode = 1; });
wss.on("error", (error) => console.error(`[server] websocket error: ${error.stack || error.message}`));
const heartbeat = setInterval(() => { wss.clients.forEach((client) => { if (client.isAlive === false) return client.terminate(); client.isAlive = false; client.ping(); }); }, WS_HEARTBEAT_MS);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));
wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return ws.close(1008, "origin");
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.clientIp = req.socket.remoteAddress || "unknown";
  ws.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw); } catch { sendError(ws, "消息格式无效。"); return; }
    if (message === null || typeof message !== "object" || Array.isArray(message)) return sendError(ws, "消息格式无效。");
    if (message.type === "create") return createRoom(ws, message);
    if (message.type === "join") return joinRoom(ws, message);
    if (message.type === "gameAction") {
      const room = roomFor(ws);
      const handler = handlerFor(room);
      if (!room || !handler || ![0, 1].includes(ws.seat)) return sendError(ws, "你不在房间中。");
      return handler.handleAction(room, ws, message);
    }
    if (message.type === "restart") return restartRoom(ws);
    if (message.type === "rejoin") return rejoinRoom(ws, message);
    if (message.type === "leave") removeMembership(ws);
  });
  ws.on("close", () => disconnect(ws));
});

if (require.main === module) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] received ${signal}; shutting down`);
    const deadline = setTimeout(() => { console.error("[server] shutdown timed out"); process.exit(1); }, 10_000);
    deadline.unref();
    rooms.forEach(clearRoomTimers);
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

module.exports = { server, rooms, gameHandlers };
