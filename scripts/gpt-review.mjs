#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL("../", import.meta.url).pathname);
const REVIEW_DIR = path.join(ROOT, ".review");
const SCHEMA = path.join(REVIEW_DIR, "review-schema.json");
const TIMEOUT_MS = Number(process.env.CODEX_REVIEW_TIMEOUT_MS) || 180_000;

function git(args, allowFailure = false) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", allowFailure ? "pipe" : "pipe"] }).trim(); }
  catch (err) { if (allowFailure) return ""; throw new Error(`git ${args.join(" ")} failed: ${err.stderr || err.message}`); }
}
function parseArgs(argv) { const out = { base: null, commit: null, workingTree: false }; for (let i = 0; i < argv.length; i++) { if (argv[i] === "--base") out.base = argv[++i]; else if (argv[i] === "--commit") out.commit = argv[++i]; else if (argv[i] === "--working-tree") out.workingTree = true; else if (argv[i] === "--help") out.help = true; else throw new Error(`Unknown option: ${argv[i]}`); } return out; }
function defaultBase() { for (const candidate of ["origin/main", "main", "master"]) if (git(["rev-parse", "--verify", candidate], true)) return candidate; return git(["rev-parse", "--verify", "HEAD~1"], true) || null; }
function scope(options) {
  const base = options.base || defaultBase();
  const head = git(["rev-parse", "HEAD"]);
  const baseSha = base ? git(["rev-parse", base], true) : "";
  let range = null;
  if (options.commit) { const parent = git(["rev-parse", "--verify", `${options.commit}^`], true); range = parent ? `${parent}..${options.commit}` : options.commit; }
  else if (!options.workingTree && base) range = `${base}...HEAD`;
  const names = new Set();
  if (range) git(["diff", "--name-only", range], true).split("\n").filter(Boolean).forEach((f) => names.add(f));
  if (!options.commit) git(["diff", "--name-only", "HEAD"], true).split("\n").filter(Boolean).forEach((f) => names.add(f));
  git(["ls-files", "--others", "--exclude-standard"], true).split("\n").filter(Boolean).forEach((f) => names.add(f));
  const stat = range ? git(["diff", "--stat", range], true) : git(["diff", "--stat", "HEAD"], true);
  const files = [...names].sort();
  if (!options.commit && !options.workingTree && baseSha === head && files.length === 0) throw new Error("No reviewable diff detected. Specify --base <commit> or use --working-tree.");
  return { base, baseSha, head, range, commitCount: range ? Number(git(["rev-list", "--count", range], true) || 0) : 0, files, stat };
}
function runCodex(prompt, mode, schemaPath = null) {
  const output = path.join(os.tmpdir(), `codex-review-${process.pid}-${Date.now()}.json`);
  const args = ["exec", "--ephemeral", "--sandbox", mode, "--ignore-user-config", "--ignore-rules", "--color", "never", "--output-last-message", output, "-C", ROOT];
  if (schemaPath) args.push("--output-schema", schemaPath);
  if (process.env.CODEX_REVIEW_MODEL && mode === "read-only") args.push("--model", process.env.CODEX_REVIEW_MODEL);
  if (process.env.CODEX_FIX_MODEL && mode === "workspace-write") args.push("--model", process.env.CODEX_FIX_MODEL);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEX_BIN || "codex", args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CODEX_DISABLE_PROMPT_INJECTION: "1" } });
    let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 2000); reject(new Error(`Codex ${mode} subprocess timed out after ${TIMEOUT_MS}ms`)); }, TIMEOUT_MS);
    child.on("error", (err) => { clearTimeout(timer); reject(new Error(`Unable to launch Codex: ${err.message}`)); });
    child.on("close", (exitCode) => { clearTimeout(timer); if (exitCode !== 0) return reject(new Error(`Codex ${mode} exited ${exitCode}: ${stderr.trim() || "no diagnostic output"}`)); try { const text = fs.readFileSync(output, "utf8"); fs.unlinkSync(output); resolve(text); } catch (err) { reject(new Error(`Codex produced no readable final message: ${err.message}`)); } });
    child.stdin.end(prompt);
  });
}
function validateReview(value) {
  const rootKeys = ["verdict", "summary", "findings", "verification_notes"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !rootKeys.includes(key)) || !["PASS", "BLOCK"].includes(value.verdict) || typeof value.summary !== "string" || !Array.isArray(value.findings) || !Array.isArray(value.verification_notes) || value.verification_notes.some((note) => typeof note !== "string")) throw new Error("review output must match the strict top-level schema");
  const ids = new Set();
  for (const f of value.findings) {
    const required = ["id", "severity", "confidence", "title", "file", "line_start", "line_end", "category", "problem", "evidence", "failure_scenario", "fix_instruction", "suggested_test"];
    if (!f || typeof f !== "object" || Object.keys(f).some((key) => !required.includes(key)) || required.some((key) => f[key] === undefined || f[key] === null || f[key] === "")) throw new Error(`finding is missing a required field or has an unknown field: ${JSON.stringify(f)}`);
    if (!/^R\d{3,}$/.test(f.id) || ids.has(f.id)) throw new Error(`invalid or duplicate finding id: ${f.id}`); ids.add(f.id);
    if (!["P0", "P1", "P2", "P3"].includes(f.severity) || typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1 || !Number.isInteger(f.line_start) || !Number.isInteger(f.line_end) || f.line_end < f.line_start || ["title", "file", "category", "problem", "evidence", "failure_scenario", "fix_instruction", "suggested_test"].some((key) => typeof f[key] !== "string")) throw new Error(`invalid finding metadata: ${f.id}`);
  }
  const blocking = value.findings.some((f) => ["P0", "P1", "P2"].includes(f.severity));
  if (blocking !== (value.verdict === "BLOCK")) throw new Error(`verdict does not match blocking findings (verdict=${value.verdict})`);
  return value;
}
function parseStructured(text) { try { return validateReview(JSON.parse(text)); } catch (first) { throw new Error(`Codex returned invalid structured review JSON: ${first.message}`); } }
function markdown(review, info) {
  const lines = ["# GPT Code Review", "", `Verdict: ${review.verdict}`, `Base: ${info.baseSha || info.base || "none"}`, `Head: ${info.head || "working tree"}`, `Commits covered: ${info.commitCount || 0}`, `Changed files: ${info.files.length}`, `Scope: ${info.range || "working tree"}`, "", review.summary, ""];
  if (!review.findings.length) lines.push("No findings.");
  for (const f of review.findings) lines.push(`## ${f.severity} — ${f.title}`, "", `**${f.file}:${f.line_start}-${f.line_end}** · confidence ${f.confidence}`, "", `**Problem:** ${f.problem}`, "", `**Evidence:** ${f.evidence}`, "", `**Failure scenario:** ${f.failure_scenario}`, "", `**Required fix:** ${f.fix_instruction}`, "", `**Suggested test:** ${f.suggested_test}`, "");
  if (review.verification_notes.length) lines.push("## Verification notes", "", ...review.verification_notes.map((note) => `- ${note}`));
  return lines.join("\n");
}
export { parseStructured, scope, runCodex, validateReview };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log("Usage: npm run review -- [--base <ref>] [--commit <sha>] [--working-tree]"); process.exit(0); }
    const info = scope(options);
    console.log(`Review base: ${info.baseSha || info.base || "none"}\nReview head: ${info.head}\nCommits covered: ${info.commitCount}\nChanged files: ${info.files.length}`);
    const prompt = `Read .review/REVIEWER.md and follow it exactly. Review this repository as an independent fresh-context reviewer. Selected base: ${info.baseSha || info.base || "none (no reliable local base)"}. Selected head: ${info.head}. Selected range: ${info.range || "working tree plus untracked files"}. Commits covered: ${info.commitCount}. Changed files: ${info.files.join(", ") || "(none detected; inspect current implementation)"}. Diff summary:\n${info.stat || "(no diff summary available)"}\nIMPORTANT: this candidate includes staged and/or unstaged changes. Before making any finding, inspect the live file with git diff HEAD, git diff --cached, and direct file reads. Do not report a defect already fixed in the current index or working tree merely because it exists in the historical base range. Available validation: npm run lint, npm test, npm run test:e2e, npm run verify. Inspect the actual repository and Git diff yourself; do not rely on this metadata or any implementation summary. Output only the schema JSON.`;
    let review;
    try { review = parseStructured(await runCodex(prompt, "read-only", SCHEMA)); }
    catch { review = parseStructured(await runCodex(`${prompt}\nYour previous response was malformed. Return only valid JSON matching the schema, with no prose or code fence.`, "read-only", SCHEMA)); }
    fs.mkdirSync(REVIEW_DIR, { recursive: true }); fs.writeFileSync(path.join(REVIEW_DIR, "latest.json"), `${JSON.stringify(review, null, 2)}\n`); fs.writeFileSync(path.join(REVIEW_DIR, "latest.md"), markdown(review, info));
    const counts = ["P0", "P1", "P2", "P3"].map((s) => `${s}=${review.findings.filter((f) => f.severity === s).length}`).join(" "); console.log(`${review.verdict}: ${review.findings.length} findings (${counts})`); process.exit(review.verdict === "BLOCK" ? 2 : 0);
  } catch (err) { console.error(`Review failed: ${err.message}`); process.exit(1); }
}
