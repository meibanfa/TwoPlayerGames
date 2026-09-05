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
function hasKey(value, wanted) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => wanted.includes(key) || hasKey(child, wanted));
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
async function publicBoardState(page) {
  return page.evaluate(() => ({
    pawns: [...document.querySelectorAll(".forgotten-cell")].flatMap((cell, index) => cell.querySelector(".pawn") ? [{ index, kind: cell.querySelector(".pawn").classList.contains("red-pawn") ? "red" : "green" }] : []),
    treasures: [...document.querySelectorAll(".forgotten-cell")].flatMap((cell, index) => cell.querySelector(".treasure-marker") ? [{ index, collected: cell.querySelector(".treasure-marker").classList.contains("treasure-collected") }] : []),
    legal: [...document.querySelectorAll(".forgotten-cell")].flatMap((cell, index) => cell.classList.contains("legal-move") ? [index] : []),
    turn: document.querySelector(".turn").textContent,
  }));
}
function stepToward(from, target) {
  const source = L.rowCol(from), destination = L.rowCol(target);
  return L.index(source.row + Math.sign(destination.row - source.row), source.col + Math.sign(destination.col - source.col));
}

test("two browsers complete forgotten mines without exposing hidden layouts", async ({ browser }) => {
  test.setTimeout(60_000);
  const aContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const bContext = await browser.newContext({ serviceWorkers: "block" });
  const a = await aContext.newPage();
  const b = await bContext.newPage();
  await captureServerFrames(a);
  await captureServerFrames(b);
  const routeCells = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20, 21, 24, 36, 48, 60, 72, 84, 96, 99, 100, 108, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120]);
  const candidates = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter((cell) => L.isLegalMineCell(cell) && !routeCells.has(cell) && ![30, 88].includes(cell));
  const placementA = [30, 88, ...candidates.slice(0, 13)];
  const placementB = [30, 88, ...candidates.slice(20, 33)];
  try {
    await create(a, "红方测试");
    const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0];
    await join(b, code, "绿方测试");
    await expect(a.locator(".forgotten-cell").first()).toHaveAttribute("aria-label", /a1/);
    expect(await a.locator(".forgotten-board").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    for (const page of [a, b]) {
      await expect(page.locator(".red-start-marker")).toHaveCount(1);
      await expect(page.locator(".green-start-marker")).toHaveCount(1);
      await expect(page.locator(".treasure-uncollected")).toHaveCount(3);
      await expect(page.locator(".forgotten-cell").nth(0)).toHaveClass(/treasure/);
      await expect(page.locator(".forgotten-cell").nth(60)).toHaveClass(/treasure/);
      await expect(page.locator(".forgotten-cell").nth(120)).toHaveClass(/treasure/);
    }

    await place(a, placementA);
    await a.locator(".confirm").click();
    await expect(a.locator(".forgotten-board")).toBeVisible();
    await expect(a.locator(".forgotten-status")).toContainText("忘掉雷图");
    await expect(a.locator(".mine-preview")).toHaveCount(0);
    await expect(a.locator(".final-mine")).toHaveCount(0);
    await expect(a.locator(".red-start-marker")).toHaveCount(1);
    await expect(a.locator(".green-start-marker")).toHaveCount(1);
    await expect(a.locator(".treasure-uncollected")).toHaveCount(3);
    await place(b, placementB);
    await b.locator(".confirm").click();
    await expect(a.locator(".forgotten-phase")).toHaveText("寻宝阶段");
    await expect(b.locator(".forgotten-phase")).toHaveText("寻宝阶段");
    await expect(a.locator(".mine-preview")).toHaveCount(0);
    await expect(b.locator(".mine-preview")).toHaveCount(0);
    await expect(a.locator(".final-mine")).toHaveCount(0);
    await expect(b.locator(".final-mine")).toHaveCount(0);
    for (const page of [a, b]) {
      await expect(page.locator(".red-pawn")).toHaveCount(1);
      await expect(page.locator(".green-pawn")).toHaveCount(1);
      await expect(page.locator(".forgotten-cell").nth(L.START_CELLS[0]).locator(".red-pawn")).toHaveCount(1);
      await expect(page.locator(".forgotten-cell").nth(L.START_CELLS[1]).locator(".green-pawn")).toHaveCount(1);
      await expect(page.locator(".red-start-marker")).toHaveCount(1);
      await expect(page.locator(".green-start-marker")).toHaveCount(1);
      await expect(page.locator(".treasure-uncollected")).toHaveCount(3);
      await expect(page.locator(".legal-move")).toHaveCount(3);
    }

    const first = (await a.locator(".turn").textContent()).includes("红方测试") ? 0 : 1;
    const second = 1 - first;
    const pages = [a, b];
    const positions = [...L.START_CELLS];
    const prep = [20, 99];
    const mine = [30, 88];
    const reentry = [21, 100];
    await expect(pages[first].locator(".forgotten-cell:enabled")).toHaveCount(3);
    await expect(pages[second].locator(".forgotten-cell:enabled")).toHaveCount(0);
    await expect(pages[first].locator(".turn")).toContainText(first === 0 ? "🔴 红方回合" : "🟢 绿方回合");
    await expect(pages[first].locator(".forgotten-status")).toHaveText("轮到你了，请移动一格");
    await expect(pages[second].locator(".forgotten-status")).toHaveText("等待对手移动");
    for (const destination of [first === 0 ? 30 : 88, first === 0 ? 0 : 120]) {
      await expect(pages[first].locator(".forgotten-cell").nth(destination)).toBeDisabled();
      await expect(pages[first].locator(".forgotten-cell").nth(destination)).not.toHaveClass(/legal-move/);
    }
    await move(pages[first], prep[first]); positions[first] = prep[first];
    expect(L.neighbors(L.START_CELLS[first])).toContain(prep[first]);
    for (const page of pages) {
      await expect(page.locator(".forgotten-cell").nth(prep[first]).locator(first === 0 ? ".red-pawn" : ".green-pawn")).toHaveCount(1);
      await expect(page.locator(".forgotten-cell").nth(L.START_CELLS[first]).locator(first === 0 ? ".red-pawn" : ".green-pawn")).toHaveCount(0);
      await expect(page.locator(".forgotten-cell").nth(L.START_CELLS[first]).locator(first === 0 ? ".red-start-marker" : ".green-start-marker")).toHaveCount(1);
    }
    await expect(pages[second].locator(".turn")).toContainText(second === 0 ? "红方测试" : "绿方测试");
    await expect(pages[second].locator(".forgotten-cell:enabled")).toHaveCount(3);
    await expect(pages[first].locator(".forgotten-cell:enabled")).toHaveCount(0);
    expect(await publicBoardState(a)).toEqual(await publicBoardState(b));
    await expect(pages[first].locator(".forgotten-event")).toContainText("周围共有");
    await move(pages[second], prep[second]); positions[second] = prep[second];
    await move(pages[first], mine[first]); positions[first] = null;
    await expect(pages[first].locator(".forgotten-phase")).toHaveText("重新入场");
    await expect(pages[first].locator(".forgotten-event")).toContainText("踩到地雷，-5 分");
    for (const page of pages) {
      await expect(page.locator(".forgotten-board")).toBeVisible();
      await expect(page.locator(first === 0 ? ".red-pawn" : ".green-pawn")).toHaveCount(0);
      await expect(page.locator(first === 0 ? ".red-start-marker" : ".green-start-marker")).toHaveCount(1);
      await expect(page.locator(".legal-move")).toHaveCount(3);
      await expect(page.locator(".final-mine")).toHaveCount(0);
    }
    await expect(pages[first].locator(".forgotten-cell:enabled")).toHaveCount(3);
    await expect(pages[second].locator(".forgotten-cell:enabled")).toHaveCount(0);
    await move(pages[first], reentry[first]); positions[first] = reentry[first];
    await expect(pages[first].locator(".forgotten-phase")).toHaveText("寻宝阶段");
    await expect(pages[second].locator(".turn")).toContainText(second === 0 ? "红方测试" : "绿方测试");

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
    await expect(a.locator(".treasure-collected")).toHaveCount(3);
    await expect(b.locator(".treasure-collected")).toHaveCount(3);
    await expect(a.locator(".forgotten-result")).toContainText("三个宝物均已找到");
    await expect(a.locator(".forgotten-result")).toContainText("完整雷图已公开");
    const aResult = await a.locator(".forgotten-result").textContent();
    const bResult = await b.locator(".forgotten-result").textContent();
    expect(aResult.match(/最终比分 (-?\d+) : (-?\d+)/)?.slice(1)).toEqual(bResult.match(/最终比分 (-?\d+) : (-?\d+)/)?.slice(1));

    for (const page of [a, b]) {
      await expect(page.locator(".final-mine-legend")).toBeVisible();
      await expect(page.locator(".red-final-mine.final-mine")).toHaveCount(15);
      await expect(page.locator(".green-final-mine.final-mine")).toHaveCount(15);
      await expect(page.locator(".overlap-final-mine")).toHaveCount(2);
      await expect(page.locator(".detonated-final-cell")).toHaveCount(1);
      await expect(page.locator(".detonated-final-mine")).toHaveCount(2);
      await expect(page.locator(".final-explosion")).toHaveCount(1);
      await expect(page.locator(".forgotten-cell").nth(mine[first]).locator(".red-final-mine.final-mine")).toHaveCount(1);
      await expect(page.locator(".forgotten-cell").nth(mine[first]).locator(".green-final-mine.final-mine")).toHaveCount(1);
      await expect(page.locator(".forgotten-cell").nth(mine[second])).not.toHaveClass(/detonated-final-cell/);
    }

    const browserData = await b.evaluate(() => {
      const parseStorage = (storage) => Object.values(storage).map((value) => { try { return JSON.parse(value); } catch { return value; } });
      const mineCells = [...document.querySelectorAll(".forgotten-cell")].flatMap((cell, index) => cell.textContent.includes("💣") || cell.classList.contains("mine-preview") ? [index] : []);
      const exposedStateGlobals = ["__GAME_STATE__", "gameState", "mineMap", "placementState"].flatMap((key) => Object.prototype.hasOwnProperty.call(window, key) ? [{ key, value: window[key] }] : []);
      return { frames: window.__TEST_WS_FRAMES__, local: parseStorage(localStorage), session: parseStorage(sessionStorage), mineCells, exposedStateGlobals };
    });
    expect(browserData.frames.length).toBeGreaterThan(0);
    const preFinishedFrames = browserData.frames.filter((payload) => payload.phase !== "FINISHED");
    expect(preFinishedFrames.some((payload) => containsMineSet(payload, placementA))).toBe(false);
    const afterGreenConfirmation = preFinishedFrames.filter((payload) => payload.phase !== "PLACING" || payload.confirmed?.[1] === true);
    expect(afterGreenConfirmation.some((payload) => containsMineSet(payload, placementB))).toBe(false);
    expect(preFinishedFrames.some((payload) => hasKey(payload, ["finalMineReveal", "originalPlacements", "detonatedMineHistory"]))).toBe(false);
    const finishedFrame = browserData.frames.find((payload) => payload.type === "gameState" && payload.phase === "FINISHED");
    expect(new Set(finishedFrame.finalMineReveal.red)).toEqual(new Set(placementA));
    expect(new Set(finishedFrame.finalMineReveal.green)).toEqual(new Set(placementB));
    expect(finishedFrame.finalMineReveal.detonated).toEqual([{ cell: mine[first], owners: [0, 1] }]);
    expect(containsMineSet(browserData.local, placementA)).toBe(false);
    expect(containsMineSet(browserData.session, placementA)).toBe(false);
    expect(new Set(browserData.mineCells)).toEqual(new Set([...placementA, ...placementB]));
    expect(browserData.exposedStateGlobals).toEqual([]);

    await a.reload();
    await expect(a.locator(".forgotten-phase")).toHaveText("比赛结束");
    await expect(a.locator(".red-final-mine.final-mine")).toHaveCount(15);
    await expect(a.locator(".green-final-mine.final-mine")).toHaveCount(15);
    await expect(a.locator(".detonated-final-mine")).toHaveCount(2);
    await expect(a.locator(".forgotten-result")).toContainText("完整雷图已公开");
  } finally {
    await aContext.close();
    await bContext.close();
  }
});

test("terminal board distinguishes ownership, overlap, and detonation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const boardEl = document.createElement("div");
    boardEl.id = "terminal-reveal-fixture";
    document.body.appendChild(boardEl);
    const game = window.GameRegistry.get("forgotten-mines").create({ boardEl, sendGameAction() {}, seat: 0, phase: "FINISHED", playerNames: ["甲", "乙"] });
    game.receive({
      type: "gameState",
      phase: "FINISHED",
      winner: 0,
      finishOutcome: "WINNER",
      finishReason: "三个宝物均已找到",
      scores: [30, 20],
      positions: [9, 111],
      collectedTreasures: [{ cell: 0, seat: 0, value: 10, order: 1 }, { cell: 60, seat: 1, value: 15, order: 2 }, { cell: 120, seat: 0, value: 20, order: 3 }],
      exhaustedSafeCells: [9],
      detonatedCells: [12, 13],
      finalMineReveal: {
        red: [12, 13, 15],
        green: [12, 14, 16],
        detonated: [{ cell: 12, owners: [0, 1] }, { cell: 13, owners: [0] }],
      },
    });
  });
  const fixture = page.locator("#terminal-reveal-fixture");
  await expect(fixture.locator(".forgotten-cell").nth(12).locator(".red-final-mine.final-mine")).toHaveClass(/detonated-final-mine/);
  await expect(fixture.locator(".forgotten-cell").nth(12).locator(".green-final-mine.final-mine")).toHaveClass(/detonated-final-mine/);
  await expect(fixture.locator(".forgotten-cell").nth(12).locator(".overlap-final-mine")).toHaveCount(1);
  await expect(fixture.locator(".forgotten-cell").nth(13).locator(".red-final-mine.final-mine")).toHaveClass(/detonated-final-mine/);
  await expect(fixture.locator(".forgotten-cell").nth(14).locator(".green-final-mine.final-mine")).not.toHaveClass(/detonated-final-mine/);
  await expect(fixture.locator(".forgotten-cell").nth(15).locator(".red-final-mine.final-mine")).not.toHaveClass(/detonated-final-mine/);
  await expect(fixture.locator(".forgotten-cell").nth(16).locator(".green-final-mine.final-mine")).not.toHaveClass(/detonated-final-mine/);
  await expect(fixture.locator(".final-mine-legend")).toContainText("双方重叠地雷");
  await expect(fixture.locator(".final-mine-legend")).toContainText("已踩爆地雷");
});

test("terminal results distinguish a treasure draw from no-winner timeout and reconnect", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(() => {
    const render = (state) => {
      const boardEl = document.createElement("div");
      document.body.appendChild(boardEl);
      const game = window.GameRegistry.get("forgotten-mines").create({ boardEl, sendGameAction() {}, seat: 0, phase: "FINISHED", playerNames: ["甲", "乙"] });
      game.receive({ type: "gameState", ...state });
      const text = boardEl.querySelector(".forgotten-result").textContent;
      game.destroy();
      return text;
    };
    const common = { phase: "FINISHED", winner: null, scores: [25, 25], positions: [0, 120] };
    return {
      draw: render({ ...common, finishOutcome: "DRAW", finishReason: "三个宝物均已找到" }),
      timeout: render({ ...common, scores: [0, 0], finishOutcome: "NO_WINNER", finishReason: "双方未在规定时间内完成布雷" }),
      rejoinedTimeout: render({ ...common, scores: [0, 0], finishOutcome: "NO_WINNER", finishReason: "双方未在规定时间内完成布雷" }),
    };
  });
  expect(results.draw).toContain("平局");
  expect(results.draw).toContain("最终比分 25 : 25");
  expect(results.draw).toContain("三个宝物均已找到");
  expect(results.timeout).toContain("无胜者");
  expect(results.timeout).not.toContain("平局");
  expect(results.rejoinedTimeout).toContain("无胜者");
});
