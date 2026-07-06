/* ============================================================
   Accounts: lưu tài khoản + trạng thái người chơi (server-side).
   - Zero dependency: dùng file JSON ghi atomic (temp + rename).
   - Mật khẩu băm bằng scrypt + salt ngẫu nhiên.
   - Token phiên sinh bằng crypto, lưu ở dạng băm (không lưu token thô).
   Dùng cho đồng bộ hồ sơ/thống kê giữa nhiều thiết bị và làm nền
   cho bảng xếp hạng / ELO online về sau.
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "accounts.json");

// ---------- Giới hạn ----------
const MAX_STATE_BYTES = 512 * 1024; // trần kích thước blob trạng thái mỗi user (512KB)
const MAX_TOKENS_PER_USER = 5;      // số phiên đăng nhập đồng thời giữ lại
const SCRYPT_KEYLEN = 32;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;

// ---------- Nạp / lưu (ghi tuần tự, atomic) ----------
let db = { users: {} };
let loaded = false;
let writeChain = Promise.resolve();

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.users) db = parsed;
  } catch { /* file chưa tồn tại -> dùng db rỗng */ }
}

// Ghi atomic: viết ra file tạm rồi rename (tránh hỏng file khi ghi dở).
function persist() {
  ensureDir();
  const snapshot = JSON.stringify(db);
  writeChain = writeChain.then(
    () => new Promise((resolve) => {
      const tmp = DB_FILE + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
      fs.writeFile(tmp, snapshot, (err) => {
        if (err) { resolve(); return; }
        fs.rename(tmp, DB_FILE, () => resolve());
      });
    }),
  );
  return writeChain;
}

// ---------- Băm mật khẩu / token ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
}
function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function timingEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- Kiểm tra đầu vào ----------
function validUsername(u) { return typeof u === "string" && USERNAME_RE.test(u); }
function validPassword(p) {
  return typeof p === "string" && p.length >= MIN_PASSWORD && p.length <= MAX_PASSWORD;
}
function stateBytes(state) {
  try { return Buffer.byteLength(JSON.stringify(state), "utf8"); } catch { return Infinity; }
}
// Chỉ chấp nhận blob trạng thái dạng { "tpg_xxx": "chuỗi", ... }.
function cleanState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const out = {};
  for (const k of Object.keys(state)) {
    if (k.indexOf("tpg_") === 0 && typeof state[k] === "string") out[k] = state[k];
  }
  return out;
}

// ---------- API nghiệp vụ ----------
function register(username, password) {
  load();
  if (!validUsername(username)) return { error: "invalid_username" };
  if (!validPassword(password)) return { error: "invalid_password" };
  const key = username.toLowerCase();
  if (db.users[key]) return { error: "username_taken" };
  const salt = crypto.randomBytes(16).toString("hex");
  const token = makeToken();
  db.users[key] = {
    username,
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
    tokens: [{ h: hashToken(token), createdAt: Date.now() }],
    state: {},
    stateUpdatedAt: 0,
  };
  persist();
  return { token, username };
}

function login(username, password) {
  load();
  if (typeof username !== "string" || typeof password !== "string") return { error: "invalid_credentials" };
  const user = db.users[username.toLowerCase()];
  if (!user) return { error: "invalid_credentials" };
  const candidate = hashPassword(password, user.salt);
  if (!timingEqual(candidate, user.hash)) return { error: "invalid_credentials" };
  const token = makeToken();
  user.tokens = user.tokens || [];
  user.tokens.push({ h: hashToken(token), createdAt: Date.now() });
  if (user.tokens.length > MAX_TOKENS_PER_USER) user.tokens = user.tokens.slice(-MAX_TOKENS_PER_USER);
  persist();
  return { token, username: user.username, state: user.state || {}, stateUpdatedAt: user.stateUpdatedAt || 0 };
}

// Tìm user theo token phiên (so khớp băm).
function userByToken(token) {
  load();
  if (!token || typeof token !== "string") return null;
  const h = hashToken(token);
  for (const key of Object.keys(db.users)) {
    const u = db.users[key];
    if (u.tokens && u.tokens.some((t) => t.h === h)) return u;
  }
  return null;
}

function logout(token) {
  const u = userByToken(token);
  if (!u) return { ok: true };
  const h = hashToken(token);
  u.tokens = (u.tokens || []).filter((t) => t.h !== h);
  persist();
  return { ok: true };
}

function getState(token) {
  const u = userByToken(token);
  if (!u) return { error: "unauthorized" };
  return { state: u.state || {}, stateUpdatedAt: u.stateUpdatedAt || 0, username: u.username };
}

function putState(token, state) {
  const u = userByToken(token);
  if (!u) return { error: "unauthorized" };
  const clean = cleanState(state);
  if (!clean) return { error: "invalid_state" };
  if (stateBytes(clean) > MAX_STATE_BYTES) return { error: "state_too_large" };
  u.state = clean;
  u.stateUpdatedAt = Date.now();
  persist();
  return { ok: true, stateUpdatedAt: u.stateUpdatedAt };
}

// Cho test: đặt lại trạng thái trong bộ nhớ (không đụng file).
function _reset() { db = { users: {} }; loaded = true; }

module.exports = {
  register, login, logout, getState, putState, userByToken,
  validUsername, validPassword,
  MAX_STATE_BYTES, MIN_PASSWORD,
  _reset, _file: DB_FILE,
};
