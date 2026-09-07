"use strict";

(function () {

const BOARD_ROWS = 11;
const BOARD_COLS = 11;
const CELL_COUNT = BOARD_ROWS * BOARD_COLS;
const NORMAL_MINE_COUNT = 12;
const TIMED_BOMB_NUMBERS = Object.freeze([1, 2, 3]);
const MAX_TURNS = 70;
const BOMB_COUNTDOWN_MOVES = 2;
const FINISH_OUTCOMES = Object.freeze({
  WINNER: "WINNER",
  DRAW: "DRAW",
  NO_WINNER: "NO_WINNER",
});
const BOMB_STATUSES = Object.freeze({
  UNACTIVATED: "UNACTIVATED",
  ACTIVE: "ACTIVE",
  DETONATED: "DETONATED",
});
const START_CELLS = Object.freeze([10, 110]);
const TREASURE_CELLS = Object.freeze([0, 60, 120]);
const PROTECTED_HOME_CELLS = Object.freeze([
  Object.freeze([9, 10, 20, 21]),
  Object.freeze([99, 100, 110, 111]),
]);
const FORBIDDEN_EXPLOSIVE_CELLS = Object.freeze([...new Set([...TREASURE_CELLS, ...PROTECTED_HOME_CELLS.flat()])]);

function index(row, col) { return row * BOARD_COLS + col; }
function rowCol(cell) { return { row: Math.floor(cell / BOARD_COLS), col: cell % BOARD_COLS }; }
function isCell(cell) { return Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT; }
function inBounds(row, col) { return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS; }
function coordinate(cell) {
  if (!isCell(cell)) return null;
  const { row, col } = rowCol(cell);
  return `${String.fromCharCode(97 + row)}${col + 1}`;
}
function parseCoordinate(value) {
  const match = /^([a-k])(1[01]|[1-9])$/i.exec(String(value || "").trim());
  if (!match) return null;
  return index(match[1].toLowerCase().charCodeAt(0) - 97, Number(match[2]) - 1);
}
function neighbors(cell) {
  if (!isCell(cell)) return [];
  const { row, col } = rowCol(cell);
  const output = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if ((dr || dc) && inBounds(row + dr, col + dc)) output.push(index(row + dr, col + dc));
  }
  return output;
}
function blastCells(cell) { return isCell(cell) ? [cell, ...neighbors(cell)].sort((a, b) => a - b) : []; }
function isProtectedCell(cell) { return FORBIDDEN_EXPLOSIVE_CELLS.includes(cell); }
function isLegalExplosiveCell(cell) { return isCell(cell) && !isProtectedCell(cell); }
function isTimedBombNumber(number) { return TIMED_BOMB_NUMBERS.includes(number); }
function timedEntries(value) {
  if (value instanceof Map) return [...value.entries()].map(([number, bomb]) => typeof bomb === "number" ? { number, cell: bomb } : { number, ...bomb });
  return Array.isArray(value) ? value : [];
}
function validatePlacement(placement) {
  if (!placement || !Array.isArray(placement.normal) || placement.normal.length !== NORMAL_MINE_COUNT || new Set(placement.normal).size !== NORMAL_MINE_COUNT) return false;
  const timed = timedEntries(placement.timed);
  if (timed.length !== TIMED_BOMB_NUMBERS.length) return false;
  const numbers = timed.map((bomb) => bomb.number);
  const cells = timed.map((bomb) => bomb.cell);
  return new Set(numbers).size === TIMED_BOMB_NUMBERS.length && TIMED_BOMB_NUMBERS.every((number) => numbers.includes(number)) &&
    new Set(cells).size === TIMED_BOMB_NUMBERS.length && [...placement.normal, ...cells].every(isLegalExplosiveCell) &&
    new Set([...placement.normal, ...cells]).size === NORMAL_MINE_COUNT + TIMED_BOMB_NUMBERS.length;
}
function isLegalNormalMove(from, to, opponentCell) {
  if (!isCell(from) || !isCell(to) || to === from || to === opponentCell) return false;
  const source = rowCol(from), destination = rowCol(to);
  return Math.max(Math.abs(destination.row - source.row), Math.abs(destination.col - source.col)) === 1;
}
function legalReentryCells(seat, opponentCell) {
  if (![0, 1].includes(seat)) return [];
  return PROTECTED_HOME_CELLS[seat].filter((cell) => cell !== START_CELLS[seat] && cell !== opponentCell);
}
function normalMineCountAt(normalMineSets, cell) {
  if (!Array.isArray(normalMineSets) || !isCell(cell)) return 0;
  return normalMineSets.reduce((total, mines) => total + (mines instanceof Set ? mines.has(cell) : new Set(mines || []).has(cell) ? 1 : 0), 0);
}
function existingTimedBombCountAt(timedBombSets, cell) {
  if (!Array.isArray(timedBombSets) || !isCell(cell)) return 0;
  return timedBombSets.reduce((total, bombs) => total + timedEntries(bombs).filter((bomb) => bomb.cell === cell && bomb.status !== BOMB_STATUSES.DETONATED).length, 0);
}
function weightedNeighborScore(normalMineSets, timedBombSets, cell) {
  return neighbors(cell).reduce((total, neighbor) => total + normalMineCountAt(normalMineSets, neighbor) + 2 * existingTimedBombCountAt(timedBombSets, neighbor), 0);
}
function treasureBonus(order) { return [15, 20, 25][order] ?? 0; }
function resolveNormalMineHit({ normalMineSets, scores, seat, cell }) {
  if (normalMineCountAt(normalMineSets, cell) === 0) return null;
  return {
    normalMineSets: normalMineSets.map((mines) => new Set([...mines].filter((mine) => mine !== cell))),
    scores: scores.map((score, indexValue) => indexValue === seat ? score - 5 : score),
    scoreDelta: -5,
  };
}
function resolveNonMineCell({ cell, normalMineSets, timedBombSets, settledSafeCells, collectedTreasures }) {
  const treasureIndex = TREASURE_CELLS.indexOf(cell);
  const collected = collectedTreasures.some((entry) => (typeof entry === "number" ? entry : entry.cell) === cell);
  if (treasureIndex !== -1 && !collected) {
    const order = collectedTreasures.length;
    return { kind: "treasure", scoreDelta: treasureBonus(order), treasureOrder: order + 1, settle: false, finish: order === TREASURE_CELLS.length - 1 };
  }
  if (settledSafeCells.has(cell)) return { kind: collected ? "collected-treasure" : "settled", scoreDelta: 0, settle: false, finish: false };
  return { kind: collected ? "collected-treasure-safe" : "safe", scoreDelta: weightedNeighborScore(normalMineSets, timedBombSets, cell), settle: true, finish: false };
}
function canActivateBomb(bomb, activationUsed) {
  return !activationUsed && Boolean(bomb) && isTimedBombNumber(bomb.number) && bomb.status === BOMB_STATUSES.UNACTIVATED;
}
function advanceBombCountdowns(timedBombSets, movingSeat) {
  const detonations = [];
  const bombs = timedBombSets.map((ownerBombs, owner) => timedEntries(ownerBombs).map((bomb) => {
    const next = { ...bomb };
    if (owner !== movingSeat && next.status === BOMB_STATUSES.ACTIVE) {
      next.remainingOpponentMoves -= 1;
      if (next.remainingOpponentMoves <= 0) {
        next.remainingOpponentMoves = 0;
        next.status = BOMB_STATUSES.DETONATED;
        detonations.push({ owner, number: next.number, cell: next.cell });
      }
    }
    return next;
  }));
  detonations.sort((a, b) => a.owner - b.owner || a.number - b.number);
  return { bombs, detonations };
}
function isBlastImmune(seat, cell) { return [0, 1].includes(seat) && PROTECTED_HOME_CELLS[seat].includes(cell); }
function blastAffectedSeats(center, positions) {
  const area = new Set(blastCells(center));
  return positions.flatMap((cell, seat) => isCell(cell) && area.has(cell) && !isBlastImmune(seat, cell) ? [seat] : []);
}
function reachedTurnLimit(turnCount) { return Number.isInteger(turnCount) && turnCount >= MAX_TURNS; }
function winnerForScores(scores) { return scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1; }

const api = {
  BOARD_ROWS,
  BOARD_COLS,
  CELL_COUNT,
  NORMAL_MINE_COUNT,
  TIMED_BOMB_NUMBERS,
  MAX_TURNS,
  BOMB_COUNTDOWN_MOVES,
  FINISH_OUTCOMES,
  BOMB_STATUSES,
  START_CELLS,
  TREASURE_CELLS,
  PROTECTED_HOME_CELLS,
  FORBIDDEN_EXPLOSIVE_CELLS,
  index,
  rowCol,
  isCell,
  inBounds,
  coordinate,
  parseCoordinate,
  neighbors,
  blastCells,
  isProtectedCell,
  isLegalExplosiveCell,
  isTimedBombNumber,
  validatePlacement,
  isLegalNormalMove,
  legalReentryCells,
  normalMineCountAt,
  existingTimedBombCountAt,
  weightedNeighborScore,
  treasureBonus,
  resolveNormalMineHit,
  resolveNonMineCell,
  canActivateBomb,
  advanceBombCountdowns,
  isBlastImmune,
  blastAffectedSeats,
  reachedTurnLimit,
  winnerForScores,
};
if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.TimedMinesLogic = api;
})();
