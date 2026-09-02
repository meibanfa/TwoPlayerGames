"use strict";

const BOARD_ROWS = 9;
const BOARD_COLS = 9;
const MINE_COUNT = 15;

function index(row, col) { return row * BOARD_COLS + col; }
function inBounds(row, col) {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}
function neighbors(row, col) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if ((dr || dc) && inBounds(row + dr, col + dc)) out.push([row + dr, col + dc]);
  }
  return out;
}
function validatePlacement(cells) {
  return Array.isArray(cells) && cells.length === MINE_COUNT &&
    new Set(cells).size === MINE_COUNT && cells.every((n) => Number.isInteger(n) && n >= 0 && n < BOARD_ROWS * BOARD_COLS);
}
function mineCounts(mines) {
  const mineSet = new Set(mines);
  return Array.from({ length: BOARD_ROWS * BOARD_COLS }, (_, i) => {
    const row = Math.floor(i / BOARD_COLS), col = i % BOARD_COLS;
    return neighbors(row, col).reduce((n, [r, c]) => n + (mineSet.has(index(r, c)) ? 1 : 0), 0);
  });
}
function floodReveal(mines, start, revealed = []) {
  const mineSet = new Set(mines), seen = new Set(revealed), counts = mineCounts(mines);
  if (!Number.isInteger(start) || start < 0 || start >= BOARD_ROWS * BOARD_COLS || mineSet.has(start) || seen.has(start)) return [];
  const queue = [start], added = [];
  while (queue.length) {
    const cell = queue.shift();
    if (seen.has(cell) || mineSet.has(cell)) continue;
    seen.add(cell); added.push({ cell, count: counts[cell] });
    if (counts[cell] === 0) {
      const row = Math.floor(cell / BOARD_COLS), col = cell % BOARD_COLS;
      for (const [r, c] of neighbors(row, col)) {
        const next = index(r, c);
        if (!seen.has(next) && !mineSet.has(next)) queue.push(next);
      }
    }
  }
  return added;
}
function isComplete(revealed, mines) {
  const mineSet = new Set(mines);
  return new Set(revealed).size - [...new Set(revealed)].filter((cell) => mineSet.has(cell)).length >= BOARD_ROWS * BOARD_COLS - mineSet.size;
}

const api = { BOARD_ROWS, BOARD_COLS, MINE_COUNT, index, inBounds, neighbors, validatePlacement, mineCounts, floodReveal, isComplete };
if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.MinesweeperDuelLogic = api;
