/* Kiểm tra tích hợp: API tài khoản + đồng bộ hồ sơ (/api/register|login|logout|state). */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const PORT = 8799;
const HOST = "127.0.0.1";
// Dùng thư mục dữ liệu tạm để không đụng vào data thật.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tpg-acc-"));

function req(method, urlPath, { token, body } = {}) {
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

function log(ok, msg) { console.log((ok ? "\u2714 " : "\u2718 ") + msg); if (!ok) process.exitCode = 1; }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 700));
  try {
    // Đăng ký hợp lệ
    const reg = await req("POST", "/api/register", { body: { username: "alice", password: "secret123" } });
    log(reg.status === 200 && !!reg.json.token, "dang ky thanh cong tra ve token");
    const token = reg.json.token;

    // Đăng ký trùng tên -> lỗi
    const dup = await req("POST", "/api/register", { body: { username: "alice", password: "secret123" } });
    log(dup.status === 400 && dup.json.error === "username_taken", "dang ky trung ten bi tu choi");

    // Username không hợp lệ
    const bad = await req("POST", "/api/register", { body: { username: "ab", password: "secret123" } });
    log(bad.status === 400 && bad.json.error === "invalid_username", "username qua ngan bi tu choi");

    // Mật khẩu quá ngắn
    const badPw = await req("POST", "/api/register", { body: { username: "bobby", password: "123" } });
    log(badPw.status === 400 && badPw.json.error === "invalid_password", "mat khau qua ngan bi tu choi");

    // Đẩy state
    const put = await req("POST", "/api/state", { token, body: { state: { tpg_stats: "{\"gomoku\":{\"played\":3}}", tpg_avatar: "🦊", not_tpg: "bo qua" } } });
    log(put.status === 200 && put.json.ok, "day trang thai thanh cong");

    // Lấy state -> chỉ giữ khóa tpg_*
    const get = await req("GET", "/api/state", { token });
    log(get.status === 200 && get.json.state.tpg_avatar === "🦊", "lay trang thai giu khoa tpg_");
    log(get.json.state.not_tpg === undefined, "khoa khong phai tpg_ bi loai");

    // Không token -> 401
    const noAuth = await req("GET", "/api/state", {});
    log(noAuth.status === 401 && noAuth.json.error === "unauthorized", "khong token bi tu choi 401");

    // Đăng nhập sai mật khẩu
    const wrong = await req("POST", "/api/login", { body: { username: "alice", password: "wrongpass" } });
    log(wrong.status === 401 && wrong.json.error === "invalid_credentials", "dang nhap sai mat khau bi tu choi");

    // Đăng nhập đúng -> nhận lại state đã lưu
    const li = await req("POST", "/api/login", { body: { username: "alice", password: "secret123" } });
    log(li.status === 200 && li.json.state && li.json.state.tpg_avatar === "🦊", "dang nhap dung tra ve state da luu");
    const token2 = li.json.token;

    // Đăng xuất -> token cũ hết hiệu lực
    await req("POST", "/api/logout", { token: token2 });
    const after = await req("GET", "/api/state", { token: token2 });
    log(after.status === 401, "token sau khi dang xuat het hieu luc");
    // token đầu vẫn còn hiệu lực (phiên độc lập)
    const still = await req("GET", "/api/state", { token });
    log(still.status === 200, "phien khac van con hieu luc doc lap");

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
