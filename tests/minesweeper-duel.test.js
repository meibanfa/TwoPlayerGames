"use strict";
const { test } = require("node:test"); const assert = require("node:assert/strict"); const L = require("../js/games/minesweeper-duel-logic");
test("neighbor counts include corners and edges", () => { const counts = L.mineCounts([0, 1, 9]); assert.equal(counts[0], 2); assert.equal(counts[10], 3); });
test("zero flood reveal expands safe cells but never mines", () => { const cells = L.floodReveal([80], 0); assert.ok(cells.some((x) => x.cell === 0 && x.count === 0)); assert.ok(cells.every((x) => x.cell !== 80)); });
test("zero flood reveal keeps flagged cells protected", () => { const cells = L.floodReveal([80], 0, [1]); assert.equal(cells.some((x) => x.cell === 1), false); });
test("completion requires every safe cell, not flags", () => { assert.equal(L.isComplete(Array.from({ length: 66 }, (_, i) => i), Array.from({ length: 15 }, (_, i) => i + 66)), true); assert.equal(L.isComplete([0], [1]), false); });
test("placement requires exactly fifteen unique valid cells", () => { assert.equal(L.validatePlacement(Array.from({ length: 15 }, (_, i) => i)), true); assert.equal(L.validatePlacement([0, 0, ...Array.from({ length: 13 }, (_, i) => i + 1)]), false); });
