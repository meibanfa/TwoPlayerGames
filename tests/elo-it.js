/* Kiểm tra tích hợp: ELO + bảng xếp hạng online.
   - Hai tài khoản đăng nhập, tạo/vào phòng kèm auth token.
   - Cả hai báo kết quả khớp -> server tính ELO, gửi "rated".
   - Kiểm tra /api/leaderboard và /api/rating phản ánh kết quả. */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");

const PORT = 8801;
const HOST = "127.0.0.1";
const WS_URL = `ws://${HOST}:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tpg-elo-"));

function httpReq(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    if (token) headers["Authorization"] = "Bearer " + token;
    const r = http.request({ host: HOST, port: PORT, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json = {};
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function open() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => res(ws));
    ws.on("error", rej);
  });
}
function next(ws, type) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("timeout " + type)), 3000);
    const on = (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === type) { clearTimeout(to); ws.off("message", on); res(m); }
    };
    ws.on("message", on);
  });
}
function log(ok, msg) { console.log((ok ? "\u2714 " : "\u2718 ") + msg); if (!ok) process.exitCode = 1; }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 700));
  try {
    // Đăng ký hai tài khoản
    const rA = await httpReq("POST", "/api/register", { body: { username: "alice", password: "secret123" } });
    const rB = await httpReq("POST", "/api/register", { body: { username: "bob", password: "secret123" } });
    const tokenA = rA.json.token;
    const tokenB = rB.json.token;
    log(!!tokenA && !!tokenB, "dang ky hai tai khoan");

    // A tạo phòng (kèm auth), B vào (kèm auth)
    const a = await open();
    a.send(JSON.stringify({ type: "create", gameId: "tictactoe", playerName: "Alice", auth: tokenA }));
    const created = await next(a, "created");
    const code = created.code;

    const b = await open();
    const startA = next(a, "start");
    b.send(JSON.stringify({ type: "join", code, playerName: "Bob", auth: tokenB }));
    const joined = await next(b, "joined");
    const sA = await startA;
    log(joined.ranked === true && sA.ranked === true, "phong co ca hai dang nhap -> ranked=true");

    // Xác định ghế: seat0 = firstSeat. A là chủ (roomSeat 0), B roomSeat 1.
    // Cho A thắng: A báo "win", B báo "lose".
    const ratedA = next(a, "rated");
    const ratedB = next(b, "rated");
    a.send(JSON.stringify({ type: "reportResult", outcome: "win", round: 1 }));
    b.send(JSON.stringify({ type: "reportResult", outcome: "lose", round: 1 }));
    const rgA = await ratedA;
    const rgB = await ratedB;
    log(rgA.result === "win" && rgB.result === "lose", "ket qua khop -> A win, B lose");
    log(rgA.game > 1200 && rgB.game < 1200, "ELO A tang tren 1200, B giam duoi 1200");
    log(rgA.delta > 0 && rgB.delta < 0, "delta A duong, B am");

    // Bảng xếp hạng theo game tictactoe
    const lb = await httpReq("GET", "/api/leaderboard?game=tictactoe&limit=10");
    const names = lb.json.rows.map((r) => r.username);
    log(names.includes("alice") && names.includes("bob"), "leaderboard tictactoe co ca hai");
    log(lb.json.rows[0].username === "alice", "alice dan dau (ELO cao hon)");

    // Rating cá nhân của B
    const ratingB = await httpReq("GET", "/api/rating", { token: tokenB });
    log(ratingB.json.losses === 1 && ratingB.json.played === 1, "rating cua B: 1 thua / 1 van");

    // Báo cáo mâu thuẫn KHÔNG tính điểm: chơi lại, cả hai đều báo "win".
    const restartA = next(a, "restart");
    a.send(JSON.stringify({ type: "restart" }));
    b.send(JSON.stringify({ type: "restart" }));
    await restartA;
    a.send(JSON.stringify({ type: "reportResult", outcome: "win", round: 2 }));
    b.send(JSON.stringify({ type: "reportResult", outcome: "win", round: 2 }));
    // Chờ một chút, đảm bảo không có "rated" và điểm không đổi.
    await new Promise((r) => setTimeout(r, 400));
    const ratingB2 = await httpReq("GET", "/api/rating", { token: tokenB });
    log(ratingB2.json.played === 1, "bao cao mau thuan khong tinh them van");

    [a, b].forEach((w) => w.close());
    console.log(process.exitCode ? "FAIL" : "ALL PASS");
  } catch (e) {
    console.error("ERR", e.message);
    process.exitCode = 1;
  } finally {
    srv.kill();
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
