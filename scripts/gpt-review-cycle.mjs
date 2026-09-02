#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { validateReview } from "./gpt-review.mjs";

const ROOT = path.resolve(new URL("../", import.meta.url).pathname);
const maxRounds = Math.max(1, Math.min(3, Number(process.env.MAX_REVIEW_ROUNDS) || 2));
function command(args) { return new Promise((resolve) => { const child = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit", env: process.env }); child.on("close", (code) => resolve(code ?? 1)); child.on("error", () => resolve(1)); }); }
async function verify() { return new Promise((resolve) => { const npm = process.platform === "win32" ? "npm.cmd" : "npm"; const child = spawn(npm, ["run", "verify"], { cwd: ROOT, stdio: "inherit", env: process.env }); child.on("close", (code) => resolve(code ?? 1)); child.on("error", () => resolve(1)); }); }
for (let round = 1; round <= maxRounds; round++) {
  if (round === 1) { const code = await verify(); if (code !== 0) { console.error("Cycle stopped: deterministic verification failed before review."); process.exit(1); } }
  const reviewCode = await command(["scripts/gpt-review.mjs"]);
  if (reviewCode === 1) process.exit(1);
  let review; try { review = validateReview(JSON.parse(fs.readFileSync(path.join(ROOT, ".review", "latest.json"), "utf8"))); } catch (err) { console.error(`Cycle could not read review report: ${err.message}`); process.exit(1); }
  console.log(`Round ${round}: ${review.verdict} — ${review.findings.length} findings`);
  if (review.verdict === "PASS") process.exit(0);
  if (round === maxRounds) { console.error(`Review remains BLOCK after ${maxRounds} rounds.`); process.exit(1); }
  const fixCode = await command(["scripts/gpt-review-fix.mjs"]); if (fixCode !== 0) process.exit(1);
  const afterFix = await verify(); if (afterFix !== 0) { console.error("Cycle stopped: verification failed after fixer."); process.exit(1); }
}
