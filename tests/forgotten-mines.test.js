"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/games/forgotten-mines-logic");

test("board constants, starts, treasures, and protected homes are exact", () => {
  assert.equal(L.BOARD_ROWS, 11);
  assert.equal(L.BOARD_COLS, 11);
  assert.equal(L.MINE_COUNT, 15);
  assert.deepEqual(L.START_CELLS, [10, 110]);
  assert.deepEqual(L.TREASURE_CELLS, [0, 60, 120]);
  assert.deepEqual(L.PROTECTED_HOME_CELLS, [[9, 10, 20, 21], [99, 100, 110, 111]]);
});

test("coordinates and eight-neighborhood handle corners and center", () => {
  assert.equal(L.coordinate(0), "a1");
  assert.equal(L.coordinate(60), "f6");
  assert.equal(L.coordinate(120), "k11");
  assert.equal(L.parseCoordinate("A11"), 10);
  assert.equal(L.parseCoordinate("k1"), 110);
  assert.equal(L.parseCoordinate("l1"), null);
  assert.deepEqual(L.neighbors(0).sort((a, b) => a - b), [1, 11, 12]);
  assert.equal(L.neighbors(60).length, 8);
});

test("normal movement is one Chebyshev step and cannot collide", () => {
  assert.equal(L.isLegalNormalMove(60, 48, 0), true);
  assert.equal(L.isLegalNormalMove(null, 48, 0), false);
  assert.equal(L.isLegalNormalMove(60, 61, 61), false);
  assert.equal(L.isLegalNormalMove(60, 60, 0), false);
  assert.equal(L.isLegalNormalMove(60, 62, 0), false);
  assert.equal(L.isLegalNormalMove(0, 120, 10), false);
});

test("placement rejects starts, protected homes and treasures and requires fifteen unique cells", () => {
  for (const cell of L.FORBIDDEN_MINE_CELLS) assert.equal(L.isLegalMineCell(cell), false, L.coordinate(cell));
  const valid = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter(L.isLegalMineCell).slice(0, 15);
  assert.equal(L.validatePlacement(valid), true);
  assert.equal(L.validatePlacement([...valid.slice(0, 14), valid[0]]), false);
  assert.equal(L.validatePlacement(valid.slice(0, 14)), false);
});

test("one mine per owner is represented by sets while overlap counts twice", () => {
  const mineSets = [new Set([12]), new Set([12])];
  mineSets[0].add(12);
  assert.equal(mineSets[0].size, 1);
  assert.equal(L.mineCountAt(mineSets, 12), 2);
  assert.equal(L.adjacentMineCount(mineSets, 0), 2);
  assert.equal(L.adjacentMineCount(mineSets, 12), 0, "destination itself is not adjacent");
});

test("fresh safe cells score dynamically once, including zero", () => {
  const exhausted = new Set();
  const first = L.resolveSafeCell({ cell: 50, mineSets: [new Set(), new Set()], exhaustedSafeCells: exhausted, collectedTreasures: [] });
  assert.deepEqual(first, { kind: "safe", scoreDelta: 0, exhaust: true, finish: false });
  exhausted.add(50);
  const revisit = L.resolveSafeCell({ cell: 50, mineSets: [new Set([49]), new Set()], exhaustedSafeCells: exhausted, collectedTreasures: [] });
  assert.deepEqual(revisit, { kind: "exhausted", scoreDelta: 0, exhaust: false, finish: false });
});

test("mine hit subtracts five, may go negative, removes overlapping mines and enters re-entry", () => {
  const result = L.resolveMineHit({ mineSets: [new Set([12, 13]), new Set([12, 14])], scores: [0, 7], seat: 0, cell: 12 });
  assert.deepEqual(result.scores, [-5, 7]);
  assert.equal(result.mineSets[0].has(12), false);
  assert.equal(result.mineSets[1].has(12), false);
  assert.equal(result.mineSets[0].has(13), true);
  assert.equal(result.pendingReentrySeat, 0);
});

test("detonated cells and removed neighbors affect later unresolved scoring", () => {
  const before = L.resolveSafeCell({ cell: 1, mineSets: [new Set([12]), new Set()], exhaustedSafeCells: new Set(), collectedTreasures: [] });
  const hit = L.resolveMineHit({ mineSets: [new Set([12]), new Set()], scores: [0, 0], seat: 0, cell: 12 });
  const detonatedLater = L.resolveSafeCell({ cell: 12, mineSets: hit.mineSets, exhaustedSafeCells: new Set(), collectedTreasures: [] });
  const nearbyLater = L.resolveSafeCell({ cell: 1, mineSets: hit.mineSets, exhaustedSafeCells: new Set(), collectedTreasures: [] });
  assert.equal(detonatedLater.kind, "safe");
  assert.equal(before.scoreDelta, 1);
  assert.equal(nearbyLater.scoreDelta, 0);
});

test("re-entry is limited to home neighbors and never scores or exhausts", () => {
  assert.deepEqual(L.legalReentryCells(0, 20).sort((a, b) => a - b), [9, 21]);
  assert.deepEqual(L.resolveReentry({ seat: 0, cell: 9, opponentCell: 20 }), { position: 9, scoreDelta: 0, exhaust: false });
  assert.equal(L.resolveReentry({ seat: 0, cell: 8, opponentCell: 20 }), null);
});

test("treasures award 10, 15, 20 without adjacent points and third ends immediately", () => {
  const mines = [new Set([1]), new Set([11])];
  const first = L.resolveSafeCell({ cell: 0, mineSets: mines, exhaustedSafeCells: new Set(), collectedTreasures: [] });
  const second = L.resolveSafeCell({ cell: 60, mineSets: mines, exhaustedSafeCells: new Set(), collectedTreasures: [{ cell: 0 }] });
  const third = L.resolveSafeCell({ cell: 120, mineSets: mines, exhaustedSafeCells: new Set(), collectedTreasures: [{ cell: 0 }, { cell: 60 }] });
  assert.equal(first.scoreDelta, 10);
  assert.equal(second.scoreDelta, 15);
  assert.equal(third.scoreDelta, 20);
  assert.equal(third.finish, true);
  assert.equal(L.resolveSafeCell({ cell: 0, mineSets: mines, exhaustedSafeCells: new Set(), collectedTreasures: [{ cell: 0 }] }).scoreDelta, 0);
});

test("equal final scores draw and higher score wins", () => {
  assert.equal(L.winnerForScores([12, 12]), null);
  assert.equal(L.winnerForScores([-5, -2]), 1);
});
