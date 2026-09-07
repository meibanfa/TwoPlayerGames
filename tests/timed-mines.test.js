"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/games/timed-mines-logic");

function validPlacement() {
  const legal = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter(L.isLegalExplosiveCell);
  return {
    normal: legal.slice(0, L.NORMAL_MINE_COUNT),
    timed: L.TIMED_BOMB_NUMBERS.map((number, index) => ({ number, cell: legal[L.NORMAL_MINE_COUNT + index] })),
  };
}

test("timed mines uses the established board coordinates and exact protected zones", () => {
  assert.equal(L.BOARD_ROWS, 11);
  assert.equal(L.BOARD_COLS, 11);
  assert.equal(L.coordinate(0), "a1");
  assert.equal(L.coordinate(10), "a11");
  assert.equal(L.coordinate(60), "f6");
  assert.equal(L.coordinate(110), "k1");
  assert.equal(L.coordinate(120), "k11");
  assert.equal(L.parseCoordinate("K11"), 120);
  assert.equal(L.parseCoordinate("l1"), null);
  assert.deepEqual(L.START_CELLS, [10, 110]);
  assert.deepEqual(L.TREASURE_CELLS, [0, 60, 120]);
  assert.deepEqual(L.PROTECTED_HOME_CELLS, [[9, 10, 20, 21], [99, 100, 110, 111]]);
  assert.deepEqual(L.neighbors(0).sort((a, b) => a - b), [1, 11, 12]);
  assert.deepEqual(L.blastCells(0), [0, 1, 11, 12]);
  assert.equal(L.blastCells(60).length, 9);
});

test("placement requires exactly twelve normal mines and numbered timed bombs on distinct legal cells", () => {
  const placement = validPlacement();
  assert.equal(L.validatePlacement(placement), true);
  for (const cell of L.FORBIDDEN_EXPLOSIVE_CELLS) assert.equal(L.isLegalExplosiveCell(cell), false, L.coordinate(cell));
  assert.equal(L.isLegalExplosiveCell(1), true, "explosives may be adjacent to treasure a1");
  assert.equal(L.validatePlacement({ ...placement, normal: placement.normal.slice(1) }), false);
  assert.equal(L.validatePlacement({ ...placement, timed: placement.timed.slice(1) }), false);
  assert.equal(L.validatePlacement({ ...placement, timed: placement.timed.map((bomb) => ({ ...bomb, number: 1 })) }), false);
  assert.equal(L.validatePlacement({ ...placement, timed: placement.timed.map((bomb, index) => index === 0 ? { ...bomb, cell: placement.normal[0] } : bomb) }), false);
  assert.equal(L.validatePlacement({ ...placement, normal: placement.normal.map((cell, index) => index === 0 ? L.START_CELLS[0] : cell) }), false);
});

test("movement is one Chebyshev step and protected reentry excludes the exact occupied start", () => {
  assert.equal(L.isLegalNormalMove(60, 48, 0), true);
  assert.equal(L.isLegalNormalMove(60, 61, 61), false);
  assert.equal(L.isLegalNormalMove(60, 60, 0), false);
  assert.equal(L.isLegalNormalMove(60, 62, 0), false);
  assert.deepEqual(L.legalReentryCells(0, 20).sort((a, b) => a - b), [9, 21]);
});

test("weighted neighbor score counts both owners and gives timed bombs weight two", () => {
  const normal = [new Set([1, 11, 12]), new Set([1])];
  const timed = [
    [{ number: 1, cell: 11, status: L.BOMB_STATUSES.UNACTIVATED }, { number: 2, cell: 20, status: L.BOMB_STATUSES.DETONATED }],
    [{ number: 1, cell: 12, status: L.BOMB_STATUSES.ACTIVE, remainingOpponentMoves: 1 }],
  ];
  assert.equal(L.normalMineCountAt(normal, 1), 2);
  assert.equal(L.existingTimedBombCountAt(timed, 11), 1);
  assert.equal(L.weightedNeighborScore(normal, timed, 0), 8, "four normal contributions plus two existing timed bombs");
});

test("safe squares settle globally once and stepping on a timed bomb is harmless", () => {
  const normal = [new Set([12]), new Set()];
  const timed = [[{ number: 1, cell: 1, status: L.BOMB_STATUSES.UNACTIVATED }], []];
  const settled = new Set();
  const timedCell = L.resolveNonMineCell({ cell: 1, normalMineSets: normal, timedBombSets: timed, settledSafeCells: settled, collectedTreasures: [] });
  assert.equal(timedCell.kind, "safe");
  assert.equal(timedCell.scoreDelta, 1, "the timed bomb on the destination does not trigger or count itself");
  settled.add(1);
  assert.deepEqual(L.resolveNonMineCell({ cell: 1, normalMineSets: normal, timedBombSets: timed, settledSafeCells: settled, collectedTreasures: [] }), { kind: "settled", scoreDelta: 0, settle: false, finish: false });
  assert.equal(timed[0][0].status, L.BOMB_STATUSES.UNACTIVATED);
});

test("normal mine hit removes all normal mines at the destination but leaves timed bombs alone", () => {
  const normal = [new Set([12, 13]), new Set([12, 14])];
  const timed = [[{ number: 1, cell: 12, status: L.BOMB_STATUSES.ACTIVE, remainingOpponentMoves: 2 }], []];
  const result = L.resolveNormalMineHit({ normalMineSets: normal, scores: [0, 7], seat: 0, cell: 12 });
  assert.deepEqual(result.scores, [-5, 7]);
  assert.equal(result.normalMineSets[0].has(12), false);
  assert.equal(result.normalMineSets[1].has(12), false);
  assert.equal(result.normalMineSets[0].has(13), true);
  assert.equal(timed[0][0].cell, 12);
  assert.equal(timed[0][0].status, L.BOMB_STATUSES.ACTIVE);
});

test("treasures score fifteen, twenty, twenty-five and the third finishes immediately", () => {
  const args = { normalMineSets: [new Set(), new Set()], timedBombSets: [[], []], settledSafeCells: new Set() };
  const first = L.resolveNonMineCell({ ...args, cell: 0, collectedTreasures: [] });
  const second = L.resolveNonMineCell({ ...args, cell: 60, collectedTreasures: [{ cell: 0 }] });
  const third = L.resolveNonMineCell({ ...args, cell: 120, collectedTreasures: [{ cell: 0 }, { cell: 60 }] });
  assert.deepEqual([first.scoreDelta, second.scoreDelta, third.scoreDelta], [15, 20, 25]);
  assert.equal(first.settle, false);
  assert.equal(third.finish, true);
  const revisit = L.resolveNonMineCell({ ...args, cell: 0, collectedTreasures: [{ cell: 0 }] });
  assert.equal(revisit.kind, "collected-treasure-safe");
  assert.equal(revisit.settle, true, "a later visit may settle neighbor score after the treasure reward visit");
});

test("activation eligibility permits one fresh owned bomb per normal turn", () => {
  const fresh = { number: 2, status: L.BOMB_STATUSES.UNACTIVATED };
  assert.equal(L.canActivateBomb(fresh, false), true);
  assert.equal(L.canActivateBomb(fresh, true), false);
  assert.equal(L.canActivateBomb({ ...fresh, number: 9 }, false), false);
  assert.equal(L.canActivateBomb({ ...fresh, status: L.BOMB_STATUSES.ACTIVE }, false), false);
  assert.equal(L.canActivateBomb({ ...fresh, status: L.BOMB_STATUSES.DETONATED }, false), false);
});

test("countdown advances only on the owner's opponent moves and detonates after exactly two", () => {
  const bombs = [[{ number: 2, cell: 50, status: L.BOMB_STATUSES.ACTIVE, remainingOpponentMoves: 2 }], []];
  const ownerMove = L.advanceBombCountdowns(bombs, 0);
  assert.equal(ownerMove.bombs[0][0].remainingOpponentMoves, 2);
  assert.deepEqual(ownerMove.detonations, []);
  const opponentOne = L.advanceBombCountdowns(ownerMove.bombs, 1);
  assert.equal(opponentOne.bombs[0][0].remainingOpponentMoves, 1);
  assert.deepEqual(opponentOne.detonations, []);
  const ownerAgain = L.advanceBombCountdowns(opponentOne.bombs, 0);
  const opponentTwo = L.advanceBombCountdowns(ownerAgain.bombs, 1);
  assert.equal(opponentTwo.bombs[0][0].status, L.BOMB_STATUSES.DETONATED);
  assert.deepEqual(opponentTwo.detonations, [{ owner: 0, number: 2, cell: 50 }]);
});

test("blast geometry clips edges and respects each player's own-zone immunity", () => {
  assert.deepEqual(L.blastCells(10), [9, 10, 20, 21]);
  assert.equal(L.isBlastImmune(0, 9), true);
  assert.equal(L.isBlastImmune(1, 9), false);
  assert.deepEqual(L.blastAffectedSeats(10, [9, 20]), [1], "red is immune in red home while green is not");
  assert.deepEqual(L.blastAffectedSeats(60, [49, 71]), [0, 1]);
});

test("countdown calculation does not mutate or remove unrelated explosives", () => {
  const normal = [new Set([49]), new Set([50])];
  const bombs = [
    [{ number: 1, cell: 60, status: L.BOMB_STATUSES.ACTIVE, remainingOpponentMoves: 1 }, { number: 2, cell: 61, status: L.BOMB_STATUSES.ACTIVE, remainingOpponentMoves: 2 }],
    [{ number: 1, cell: 60, status: L.BOMB_STATUSES.UNACTIVATED }],
  ];
  const result = L.advanceBombCountdowns(bombs, 1);
  assert.equal(result.bombs[0][0].status, L.BOMB_STATUSES.DETONATED);
  assert.equal(result.bombs[0][1].status, L.BOMB_STATUSES.ACTIVE);
  assert.equal(result.bombs[1][0].status, L.BOMB_STATUSES.UNACTIVATED);
  assert.deepEqual(normal.map((set) => [...set]), [[49], [50]]);
  assert.equal(bombs[0][0].status, L.BOMB_STATUSES.ACTIVE, "input bomb state was not mutated");
});

test("turn limit and structured winner logic handle wins and ties", () => {
  assert.equal(L.reachedTurnLimit(69), false);
  assert.equal(L.reachedTurnLimit(70), true);
  assert.equal(L.winnerForScores([5, 5]), null);
  assert.equal(L.winnerForScores([-5, -2]), 1);
  assert.deepEqual(L.FINISH_OUTCOMES, { WINNER: "WINNER", DRAW: "DRAW", NO_WINNER: "NO_WINNER" });
});
