import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStructured, validateReview } from "../scripts/gpt-review.mjs";

const pass = { verdict: "PASS", summary: "clean", findings: [], verification_notes: [] };
test("review schema accepts PASS without findings", () => { assert.deepEqual(parseStructured(JSON.stringify(pass)), pass); });
test("review validation rejects PASS with blocking findings", () => { assert.throws(() => validateReview({ ...pass, findings: [{ id: "R001", severity: "P1", confidence: 0.9, title: "x", file: "x", line_start: 1, line_end: 1, category: "security", problem: "x", evidence: "x", failure_scenario: "x", fix_instruction: "x", suggested_test: "x" }] })); });
test("review validation requires BLOCK for P2 findings", () => { const finding = { id: "R001", severity: "P2", confidence: 0.9, title: "x", file: "x", line_start: 1, line_end: 1, category: "correctness", problem: "x", evidence: "x", failure_scenario: "x", fix_instruction: "x", suggested_test: "x" }; assert.equal(validateReview({ verdict: "BLOCK", summary: "issue", findings: [finding], verification_notes: [] }).findings.length, 1); });
