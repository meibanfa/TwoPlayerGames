/* Kiểm tra tích hợp: matchmaking "Tìm trận nhanh" (queue / unqueue / matched). */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const WebSocket = require("ws");

const PORT = 8802;
const URL = `ws://127.0.0.1:${PORT}`;

function open() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
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
// Chờ một khoảng để chắc chắn KHÔNG có message loại `type` tới.
function expectNo(ws, type, ms) {
  return new Promise((res) => {
    let got = false;
    const on = (raw) => { let m; try { m = JSON.parse(raw); } catch { return; } if (m.type === type) got = true; };
    ws.on("message", on);
    setTimeout(() => { ws.off("message", on); res(!got); }, ms);
  });
}
function log(ok, msg) { console.log((ok ? "\u2714 " : "\u2718 ") + msg); if (!ok) process.exitCode = 1; }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 700));
  try {
    // A vào hàng chờ tictactoe -> nhận "queued", chưa ghép.
    const a = await open();
    a.send(JSON.stringify({ type: "queue", gameId: "tictactoe", playerName: "Alice" }));
    const q = await next(a, "queued");
    log(q.gameId === "tictactoe", "nguoi dau vao hang cho nhan queued");

    // B vào hàng chờ CÙNG game -> cả hai được ghép (matched + start).
    const b = await open();
    const matchedA = next(a, "matched");
    b.send(JSON.stringify({ type: "queue", gameId: "tictactoe", playerName: "Bob" }));
    const mB = await next(b, "matched");
    const mA = await matchedA;
    log(mA.code === mB.code && !!mA.code, "hai nguoi cung game duoc ghep chung phong");
    log(mA.seat === 0 && mB.seat === 1, "ghe duoc gan 0 va 1");
    log(mA.gameId === "tictactoe" && mB.gameId === "tictactoe", "matched dung game");
    log(mA.ranked === false, "hai khach chua dang nhap -> ranked=false");
    log(!!mA.token && !!mB.token && mA.token !== mB.token, "moi ben co token phien rieng");

    // Nước đi relay được sau khi ghép (phòng hoạt động bình thường).
    const moveB = next(b, "move");
    a.send(JSON.stringify({ type: "move", move: { cell: 4 } }));
    const mv = await moveB;
    log(mv.move && mv.move.cell === 4, "nuoc di relay duoc trong phong da ghep");

    // Người chờ khác game KHÔNG bị ghép nhầm.
    const c = await open();
    c.send(JSON.stringify({ type: "queue", gameId: "gomoku", playerName: "Carol" }));
    await next(c, "queued");
    const d = await open();
    d.send(JSON.stringify({ type: "queue", gameId: "checkers", playerName: "Dave" }));
    await next(d, "queued");
    const noMatchC = await expectNo(c, "matched", 500);
    log(noMatchC, "nguoi cho khac game khong bi ghep nham");

    // Hủy tìm: C unqueue -> nhận unqueued; sau đó E vào gomoku cũng không ghép với C.
    c.send(JSON.stringify({ type: "unqueue" }));
    await next(c, "unqueued");
    const e = await open();
    e.send(JSON.stringify({ type: "queue", gameId: "gomoku", playerName: "Eve" }));
    await next(e, "queued");
    const cNoMatch = await expectNo(c, "matched", 500);
    log(cNoMatch, "sau khi huy, khong con bi ghep");

    [a, b, c, d, e].forEach((w) => w.close());
    console.log(process.exitCode ? "FAIL" : "ALL PASS");
  } catch (err) {
    console.error("ERR", err.message);
    process.exitCode = 1;
  } finally {
    srv.kill();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
