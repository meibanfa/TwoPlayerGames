"use strict";

const BOARD_ROWS = 11;
const BOARD_COLS = 11;
const CELL_COUNT = BOARD_ROWS * BOARD_COLS;
const MINE_COUNT = 15;
const START_CELLS = Object.freeze([10, 110]);
const TREASURE_CELLS = Object.freeze([0, 60, 120]);
const PROTECTED_HOME_CELLS = Object.freeze([
  Object.freeze([9, 10, 20, 21]),
  Object.freeze([99, 100, 110, 111]),
]);
const FORBIDDEN_MINE_CELLS = Object.freeze([...new Set([...TREASURE_CELLS, ...PROTECTED_HOME_CELLS.flat()])]);

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
function isProtectedCell(cell) { return FORBIDDEN_MINE_CELLS.includes(cell); }
function isLegalMineCell(cell) { return isCell(cell) && !isProtectedCell(cell); }
function validatePlacement(cells) {
  return Array.isArray(cells) && cells.length === MINE_COUNT && new Set(cells).size === MINE_COUNT && cells.every(isLegalMineCell);
}
function isLegalNormalMove(from, to, opponentCell) {
  if (!isCell(from) || !isCell(to) || to === from || to === opponentCell) return false;
  const source = rowCol(from), destination = rowCol(to);
  return Math.max(Math.abs(destination.row - source.row), Math.abs(destination.col - source.col)) === 1;
}
function legalReentryCells(seat, opponentCell) {
  if (![0, 1].includes(seat)) return [];
  return neighbors(START_CELLS[seat]).filter((cell) => cell !== opponentCell);
}
function mineCountAt(mineSets, cell) {
  if (!Array.isArray(mineSets) || !isCell(cell)) return 0;
  return mineSets.reduce((total, mines) => total + (mines instanceof Set ? mines.has(cell) : new Set(mines || []).has(cell) ? 1 : 0), 0);
}
function adjacentMineCount(mineSets, cell) {
  return neighbors(cell).reduce((total, neighbor) => total + mineCountAt(mineSets, neighbor), 0);
}
function treasureBonus(order) { return [10, 15, 20][order] ?? 0; }
function resolveMineHit({ mineSets, scores, seat, cell }) {
  if (mineCountAt(mineSets, cell) === 0) return null;
  return {
    mineSets: mineSets.map((mines) => new Set([...mines].filter((mine) => mine !== cell))),
    scores: scores.map((score, indexValue) => indexValue === seat ? score - 5 : score),
    scoreDelta: -5,
    pendingReentrySeat: seat,
  };
}
function resolveSafeCell({ cell, mineSets, exhaustedSafeCells, collectedTreasures }) {
  const treasureIndex = TREASURE_CELLS.indexOf(cell);
  if (treasureIndex !== -1) {
    const collected = collectedTreasures.some((entry) => (typeof entry === "number" ? entry : entry.cell) === cell);
    if (collected) return { kind: "collected-treasure", scoreDelta: 0, exhaust: false, finish: false };
    const order = collectedTreasures.length;
    return { kind: "treasure", scoreDelta: treasureBonus(order), treasureOrder: order + 1, exhaust: false, finish: order === TREASURE_CELLS.length - 1 };
  }
  if (exhaustedSafeCells.has(cell)) return { kind: "exhausted", scoreDelta: 0, exhaust: false, finish: false };
  return { kind: "safe", scoreDelta: adjacentMineCount(mineSets, cell), exhaust: true, finish: false };
}
function resolveReentry({ seat, cell, opponentCell }) {
  return legalReentryCells(seat, opponentCell).includes(cell) ? { position: cell, scoreDelta: 0, exhaust: false } : null;
}
function winnerForScores(scores) { return scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1; }

const api = {
  BOARD_ROWS,
  BOARD_COLS,
  CELL_COUNT,
  MINE_COUNT,
  START_CELLS,
  TREASURE_CELLS,
  PROTECTED_HOME_CELLS,
  FORBIDDEN_MINE_CELLS,
  index,
  rowCol,
  isCell,
  inBounds,
  coordinate,
  parseCoordinate,
  neighbors,
  isProtectedCell,
  isLegalMineCell,
  validatePlacement,
  isLegalNormalMove,
  legalReentryCells,
  mineCountAt,
  adjacentMineCount,
  treasureBonus,
  resolveMineHit,
  resolveSafeCell,
  resolveReentry,
  winnerForScores,
};
if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.ForgottenMinesLogic = api;
