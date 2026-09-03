"use strict";
/* global document, window */

const { test, expect } = require("@playwright/test");
const L = require("../../js/games/forgotten-mines-logic");

function coordinateSets(value, key = "", found = []) {
  if (Array.isArray(value)) {
    if (/(mine|placement|board|cells)/i.test(key)) {
      const cells = value.map((item) => Number.isInteger(item) ? item : item && Number.isInteger(item.cell) ? item.cell : null).filter(Number.isInteger);
      if (cells.length) found.push(cells);
    }
    value.forEach((item) => coordinateSets(item, key, found));
  } else if (value && typeof value === "object") Object.entries(value).forEach(([childKey, child]) => coordinateSets(child, childKey, found));
  return found;
}
function containsMineSet(value, mines) {
  return coordinateSets(value).some((cells) => { const set = new Set(cells); return mines.every((cell) => set.has(cell)); });
}
async function captureServerFrames(page) {
  await page.addInitScript(() => {
    window.__TEST_WS_FRAMES__ = [];
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => { try { window.__TEST_WS_FRAMES__.push(JSON.parse(event.data)); } catch {} });
      }
    };
  });
}
async function chooseGame(page) {
  await page.goto("/");
  const card = page.locator(".game-card").filter({ hasText: "遗忘的地雷" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.locator("#lobbyGameTitle")).toHaveText("遗忘的地雷");
}
async function create(page, name) {
  await chooseGame(page);
  await page.locator("#createName").fill(name);
  await page.locator("#createForm button").click();
  await expect(page.locator(".forgotten-phase")).toHaveText("等待好友");
}
async function join(page, code, name) {
  await chooseGame(page);
  await page.locator("#joinName").fill(name);
  await page.locator("#roomCode").fill(code);
  await page.locator("#joinForm button").click();
  await expect(page.locator(".forgotten-phase")).toHaveText("布雷阶段");
}
async function place(page, cells) {
  for (const cell of cells) await page.locator(".forgotten-cell").nth(cell).click();
  await expect(page.locator(".forgotten-meta")).toContainText("剩余地雷：0 / 15");
}
async function move(page, cell) {
  await page.locator(".forgotten-cell").nth(cell).click();
}
function stepToward(from, target) {
  const source = L.rowCol(from), destination = L.rowCol(target);
  return L.index(source.row + Math.sign(destination.row - source.row), source.col + Math.sign(destination.col - source.col));
}

test("two browsers complete forgotten mines without exposing hidden layouts", async ({ browser }) => {
  const aContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const bContext = await browser.newContext({ serviceWorkers: "block" });
  const a = await aContext.newPage();
  const b = await bContext.newPage();
  await captureServerFrames(b);
  const routeCells = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20, 21, 24, 36, 48, 60, 72, 84, 96, 99, 100, 108, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120]);
  const candidates = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter((cell) => L.isLegalMineCell(cell) && !routeCells.has(cell) && ![30, 88].includes(cell));
  const placementA = [30, ...candidates.slice(0, 14)];
  const placementB = [88, ...candidates.slice(20, 34)];
  try {
    await create(a, "红方测试");
    const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0];
    await join(b, code, "绿方测试");
    await expect(a.locator(".forgotten-cell").first()).toHaveAttribute("aria-label", /a1/);
    expect(await a.locator(".forgotten-board").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);

    await place(a, placementA);
    await a.locator(".confirm").click();
    await expect(a.locator(".forgotten-board")).toBeHidden();
    await expect(a.locator(".forgotten-status")).toContainText("忘掉雷图");
    await place(b, placementB);
    await b.locator(".confirm").click();
    await expect(a.locator(".forgotten-phase")).toHaveText("寻宝阶段");
    await expect(b.locator(".forgotten-phase")).toHaveText("寻宝阶段");
    await expect(a.locator(".mine-preview")).toHaveCount(0);
    await expect(b.locator(".mine-preview")).toHaveCount(0);

    const first = (await a.locator(".turn").textContent()).includes("红方测试") ? 0 : 1;
    const second = 1 - first;
    const pages = [a, b];
    const positions = [...L.START_CELLS];
    const prep = [20, 99];
    const mine = [30, 88];
    const reentry = [21, 100];
    await move(pages[first], prep[first]); positions[first] = prep[first];
    await expect(pages[second].locator(".turn")).toContainText(second === 0 ? "红方测试" : "绿方测试");
    await expect(pages[first].locator(".forgotten-event")).toContainText("周围共有");
    await move(pages[second], prep[second]); positions[second] = prep[second];
    await move(pages[first], mine[first]); positions[first] = L.START_CELLS[first];
    await expect(pages[first].locator(".forgotten-phase")).toHaveText("重新入场");
    await expect(pages[first].locator(".forgotten-event")).toContainText("踩到地雷，-5 分");
    await move(pages[first], reentry[first]); positions[first] = reentry[first];
    await expect(pages[first].locator(".forgotten-phase")).toHaveText("寻宝阶段");

    await move(pages[second], L.START_CELLS[second]); positions[second] = L.START_CELLS[second];
    await move(pages[first], prep[first]); positions[first] = prep[first];
    await expect(pages[first].locator(".forgotten-event")).toContainText("已经结算");

    const cornerTargets = [0, 120];
    const collected = [false, false];
    for (let turn = 0; turn < 40; turn++) {
      if (await a.locator(".forgotten-result").isVisible()) break;
      const turnText = await a.locator(".turn").textContent();
      const seat = turnText.includes("红方测试") ? 0 : 1;
      const corner = cornerTargets[seat];
      if (!collected[seat] && positions[seat] === corner) collected[seat] = true;
      const target = collected[seat] ? 60 : corner;
      const destination = stepToward(positions[seat], target);
      await move(pages[seat], destination);
      positions[seat] = destination;
      if (destination === corner) collected[seat] = true;
      await expect.poll(async () => (await a.locator(".forgotten-result").isVisible()) || (await a.locator(".turn").textContent()) !== turnText).toBe(true);
    }
    await expect(a.locator(".forgotten-result")).toBeVisible();
    await expect(b.locator(".forgotten-result")).toBeVisible();
    await expect(a.locator(".forgotten-result")).toContainText("三个宝物均已找到");
    const aResult = await a.locator(".forgotten-result").textContent();
    const bResult = await b.locator(".forgotten-result").textContent();
    expect(aResult.match(/最终比分 (-?\d+) : (-?\d+)/)?.slice(1)).toEqual(bResult.match(/最终比分 (-?\d+) : (-?\d+)/)?.slice(1));

    const browserData = await b.evaluate(() => {
      const parseStorage = (storage) => Object.values(storage).map((value) => { try { return JSON.parse(value); } catch { return value; } });
      const mineCells = [...document.querySelectorAll(".forgotten-cell")].flatMap((cell, index) => cell.textContent.includes("💣") || cell.classList.contains("mine-preview") ? [index] : []);
      const exposedStateGlobals = ["__GAME_STATE__", "gameState", "mineMap", "placementState"].flatMap((key) => Object.prototype.hasOwnProperty.call(window, key) ? [{ key, value: window[key] }] : []);
      return { frames: window.__TEST_WS_FRAMES__, local: parseStorage(localStorage), session: parseStorage(sessionStorage), mineCells, exposedStateGlobals };
    });
    expect(browserData.frames.length).toBeGreaterThan(0);
    expect(browserData.frames.some((payload) => containsMineSet(payload, placementA))).toBe(false);
    expect(containsMineSet(browserData.local, placementA)).toBe(false);
    expect(containsMineSet(browserData.session, placementA)).toBe(false);
    expect(browserData.mineCells).toEqual([]);
    expect(browserData.exposedStateGlobals).toEqual([]);
  } finally {
    await aContext.close();
    await bContext.close();
  }
});
