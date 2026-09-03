#!/usr/bin/env node
"use strict";

const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function waitForStartup(child, port) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("E2E 服务器启动超时。")), 30_000);
    const finish = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
    child.once("exit", (code) => finish(new Error(`E2E 服务器提前退出（${code}）。`)));
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (String(chunk).includes(`listening on 127.0.0.1:${port}`)) finish();
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => signal ? reject(new Error(`Playwright 被信号 ${signal} 终止。`)) : resolve(code ?? 1));
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

(async () => {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    process.exitCode = await run(process.execPath, [path.join(ROOT, "node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)], process.env);
    return;
  }
  const port = await freePort();
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    RECONNECT_GRACE_MS: process.env.RECONNECT_GRACE_MS || "4000",
    FORGOTTEN_MINES_PLACEMENT_MS: process.env.FORGOTTEN_MINES_PLACEMENT_MS || "600000",
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${port}`,
    PLAYWRIGHT_LOCAL_RUN: "1",
  };
  const server = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await waitForStartup(server, port);
    process.exitCode = await run(process.execPath, [path.join(ROOT, "node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)], env);
  } finally {
    await stop(server);
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
