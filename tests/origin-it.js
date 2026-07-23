/* Kiểm tra origin allowlist: origin lạ bị từ chối, không-origin & cùng-host được chấp nhận. */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const WebSocket = require("ws");

const PORT = 8798;
const URL = `ws://127.0.0.1:${PORT}`;

function tryOpen(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL, { headers });
    ws.on("open", () => { ws.close(); resolve(true); });
    ws.on("error", () => resolve(false));
    ws.on("unexpected-response", () => resolve(false));
  });
}
function log(ok, msg) { console.log((ok ? "\u2714 " : "\u2718 ") + msg); if (!ok) process.exitCode = 1; }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), ALLOWED_ORIGINS: "https://good.example" },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 700));
  try {
    log(await tryOpen({}), "khong co Origin (client thuan) duoc chap nhan");
    log(await tryOpen({ Origin: `http://127.0.0.1:${PORT}` }), "cung host duoc chap nhan");
    log(await tryOpen({ Origin: "https://good.example" }), "origin trong allowlist duoc chap nhan");
    log(!(await tryOpen({ Origin: "http://localhost:3000", Host: "game.example" })), "localhost origin khong duoc vuot allowlist cua host public");
    log(!(await tryOpen({ Origin: "https://evil.example" })), "origin la bi tu choi");
    console.log(process.exitCode ? "FAIL" : "ALL PASS");
  } catch (e) {
    console.error("ERR", e.message);
    process.exitCode = 1;
  } finally {
    srv.kill();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
