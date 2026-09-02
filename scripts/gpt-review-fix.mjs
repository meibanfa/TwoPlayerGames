#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCodex, validateReview } from "./gpt-review.mjs";

const ROOT = path.resolve(new URL("../", import.meta.url).pathname);
const reportPath = path.join(ROOT, ".review", "latest.json");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!fs.existsSync(reportPath)) throw new Error(".review/latest.json does not exist; run npm run review first");
    const review = validateReview(JSON.parse(fs.readFileSync(reportPath, "utf8")));
    if (review.verdict === "PASS") { console.log("Review is PASS; no fixes required."); process.exit(0); }
    const prompt = `Read .review/FIXER.md and follow it exactly. Read .review/latest.json, AGENTS.md, the original changed code, and relevant tests. Verify each P0/P1/P2 finding against the repository before editing. Fix valid findings, add focused regression tests, and run relevant validation. Do not overwrite .review/latest.json or .review/latest.md. Findings are:\n${JSON.stringify(review, null, 2)}\nWork only in this repository and report what you changed, tests run, and any findings you rejected.`;
    const output = await runCodex(prompt, "workspace-write");
    console.log(output.trim() || "Fixer completed.");
  } catch (err) { console.error(`Review fixer failed: ${err.message}`); process.exit(1); }
}
