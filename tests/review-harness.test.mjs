import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_MODEL, codexModel, parseStructured, validateReview } from "../scripts/gpt-review.mjs";

const pass = { verdict: "PASS", summary: "clean", findings: [], verification_notes: [] };
test("reviewer and fixer default to GPT-6 Astra", () => {
  assert.equal(DEFAULT_CODEX_MODEL, "gpt-6-astra");
  assert.equal(codexModel("read-only", {}), DEFAULT_CODEX_MODEL);
  assert.equal(codexModel("workspace-write", {}), DEFAULT_CODEX_MODEL);
});
test("reviewer and fixer model overrides remain independent", () => {
  const environment = { CODEX_REVIEW_MODEL: "review-model", CODEX_FIX_MODEL: "fix-model" };
  assert.equal(codexModel("read-only", environment), "review-model");
  assert.equal(codexModel("workspace-write", environment), "fix-model");
});
test("review schema accepts PASS without findings", () => { assert.deepEqual(parseStructured(JSON.stringify(pass)), pass); });
test("review validation rejects PASS with blocking findings", () => { assert.throws(() => validateReview({ ...pass, findings: [{ id: "R001", severity: "P1", confidence: 0.9, title: "x", file: "x", line_start: 1, line_end: 1, category: "security", problem: "x", evidence: "x", failure_scenario: "x", fix_instruction: "x", suggested_test: "x" }] })); });
test("review validation requires BLOCK for P2 findings", () => { const finding = { id: "R001", severity: "P2", confidence: 0.9, title: "x", file: "x", line_start: 1, line_end: 1, category: "correctness", problem: "x", evidence: "x", failure_scenario: "x", fix_instruction: "x", suggested_test: "x" }; assert.equal(validateReview({ verdict: "BLOCK", summary: "issue", findings: [finding], verification_notes: [] }).findings.length, 1); });
