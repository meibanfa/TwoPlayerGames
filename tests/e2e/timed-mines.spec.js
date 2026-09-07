"use strict";
/* global document, window */

const { test, expect } = require("@playwright/test");
const L = require("../../js/games/timed-mines-logic");

async function captureFrames(page) {
  await page.addInitScript(() => {
    window.__TIMED_TEST_FRAMES__ = [];
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => { try { window.__TIMED_TEST_FRAMES__.push(JSON.parse(event.data)); } catch {} });
      }
    };
  });
}
async function chooseGame(page) {
  await page.goto("/");
  const card = page.locator(".game-card").filter({ hasText: "定时炸弹扫雷" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("埋下地雷和三枚定时炸弹");
  await card.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.locator("#lobbyGameTitle")).toHaveText("定时炸弹扫雷");
}
async function create(page, name) {
  await chooseGame(page);
  await page.locator("#createName").fill(name);
  await page.locator("#createForm button").click();
  await expect(page.locator(".timed-phase")).toHaveText("等待好友");
}
async function join(page, code, name) {
  await chooseGame(page);
  await page.locator("#joinName").fill(name);
  await page.locator("#roomCode").fill(code);
  await page.locator("#joinForm button").click();
  await expect(page.locator(".timed-phase")).toHaveText("布置阶段");
}
async function place(page, placement) {
  await page.locator('[data-tool="normal"]').click();
  for (const cell of placement.normal) await page.locator(".timed-cell").nth(cell).click();
  for (const bomb of placement.timed) {
    await page.locator(`[data-tool="timed-${bomb.number}"]`).click();
    await page.locator(".timed-cell").nth(bomb.cell).click();
  }
  await expect(page.locator(".timed-placement-counts")).toHaveText("普通地雷 12 / 12 · 定时炸弹 3 / 3");
}

test("two browsers place, forget, move, activate, and observe a public countdown", async ({ browser }) => {
  test.setTimeout(60_000);
  const aContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const bContext = await browser.newContext({ serviceWorkers: "block" });
  const a = await aContext.newPage();
  const b = await bContext.newPage();
  await captureFrames(a);
  await captureFrames(b);
  const reserved = new Set([20, 21, 40, 50, 70, 99, 100, 41, 51, 71]);
  const legal = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter((cell) => L.isLegalExplosiveCell(cell) && !reserved.has(cell));
  const placements = [
    { normal: legal.slice(0, 12), timed: [{ number: 1, cell: 40 }, { number: 2, cell: 50 }, { number: 3, cell: 70 }] },
    { normal: legal.slice(20, 32), timed: [{ number: 1, cell: 41 }, { number: 2, cell: 51 }, { number: 3, cell: 71 }] },
  ];
  try {
    await create(a, "红方计时");
    const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0];
    await join(b, code, "绿方计时");
    for (const page of [a, b]) {
      await expect(page.locator(".timed-cell")).toHaveCount(121);
      await expect(page.locator(".forbidden-placement")).toHaveCount(L.FORBIDDEN_EXPLOSIVE_CELLS.length);
      await expect(page.locator(".treasure-uncollected")).toHaveCount(3);
      await expect(page.locator(".timed-placement-tools button")).toHaveCount(4);
      await expect(page.locator(".timed-meta")).toContainText(/布雷剩余时间 \d{2}:\d{2}/);
    }
    expect(await a.locator(".timed-board").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);

    await place(a, placements[0]);
    await a.locator(".timed-confirm").click();
    await expect(a.locator(".normal-preview")).toHaveCount(0);
    await expect(a.locator(".timed-preview")).toHaveCount(0);
    await expect(a.locator(".timed-status")).toContainText("忘掉所有位置");
    await place(b, placements[1]);
    await b.locator(".timed-confirm").click();
    for (const page of [a, b]) {
      await expect(page.locator(".timed-phase")).toHaveText("寻宝阶段");
      await expect(page.locator(".normal-preview")).toHaveCount(0);
      await expect(page.locator(".timed-preview")).toHaveCount(0);
      await expect(page.locator(".own-bombs .timed-bomb-row")).toHaveCount(3);
      await expect(page.locator(".opponent-bombs .timed-bomb-row")).toHaveCount(3);
      await expect(page.locator(".timed-meta")).toContainText("回合 0 / 70");
    }
    await Promise.all([a.evaluate(() => { window.__TIMED_TEST_FRAMES__ = []; }), b.evaluate(() => { window.__TIMED_TEST_FRAMES__ = []; })]);

    const turnText = await a.locator(".turn").textContent();
    const first = turnText.includes("红方计时") ? 0 : 1;
    const second = 1 - first;
    const pages = [a, b];
    await expect(pages[first].locator(".own-bombs .bomb-activate")).toHaveCount(3);
    await expect(pages[second].locator(".own-bombs .bomb-activate")).toHaveCount(0);
    await pages[first].locator(".own-bombs .timed-bomb-row").first().getByRole("button", { name: "启动" }).click();
    for (let viewer = 0; viewer < pages.length; viewer++) {
      const page = pages[viewer];
      await expect(page.locator(".timed-events")).toContainText("启动了定时炸弹 #1");
      await expect(page.locator(viewer === first ? ".own-bombs" : ".opponent-bombs")).toContainText("#1 倒计时：对手还需移动 2 次");
    }
    await expect(pages[first].locator(".own-bombs .bomb-activate")).toHaveCount(0);

    const firstMove = first === 0 ? 20 : 100;
    const secondMove = second === 0 ? 20 : 100;
    await pages[first].locator(".timed-cell").nth(firstMove).click();
    await expect(pages[second].locator(".own-bombs .bomb-activate")).toHaveCount(3);
    await expect(a.locator(".timed-meta")).toContainText("回合 1 / 70");
    await pages[second].locator(".timed-cell").nth(secondMove).click();
    for (let viewer = 0; viewer < pages.length; viewer++) {
      const page = pages[viewer];
      await expect(page.locator(viewer === first ? ".own-bombs" : ".opponent-bombs")).toContainText("#1 倒计时：对手还需移动 1 次");
      await expect(page.locator(".timed-meta")).toContainText("回合 2 / 70");
    }

    const postConfirmation = await Promise.all(pages.map((page) => page.evaluate(() => ({
      frames: window.__TIMED_TEST_FRAMES__,
      storage: [...Object.values(localStorage), ...Object.values(sessionStorage)],
      previewText: document.querySelector(".timed-board").textContent,
    }))));
    postConfirmation.forEach((data, seat) => {
      const serialized = JSON.stringify(data.frames);
      for (const bomb of placements[seat].timed) expect(serialized).not.toContain(`"cell":${bomb.cell}`);
      for (const bomb of placements[1 - seat].timed) expect(serialized).not.toContain(`"cell":${bomb.cell}`);
      expect(JSON.stringify(data.storage)).not.toContain("timedPlacements");
      expect(data.previewText).not.toContain("⏱1");
    });
  } finally {
    await aContext.close();
    await bContext.close();
  }
});

test("terminal review distinguishes normal and numbered timed explosives", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const boardEl = document.createElement("div");
    boardEl.id = "timed-terminal-fixture";
    document.body.appendChild(boardEl);
    const game = window.GameRegistry.get("timed-mines").create({ boardEl, sendGameAction() {}, seat: 0, phase: "FINISHED", playerNames: ["甲", "乙"] });
    game.receive({
      type: "gameState",
      phase: "FINISHED",
      scores: [40, 35],
      winner: 0,
      finishOutcome: "WINNER",
      finishReason: "已完成 70 个移动回合",
      turnCount: 70,
      positions: [10, 110],
      finalExplosiveReveal: {
        red: { normal: [12, 13], timed: [{ number: 1, cell: 14, status: "DETONATED", detonated: true }, { number: 2, cell: 15, status: "UNACTIVATED", detonated: false }] },
        green: { normal: [12, 16], timed: [{ number: 1, cell: 14, status: "UNACTIVATED", detonated: false }, { number: 3, cell: 17, status: "ACTIVE", detonated: false }] },
        triggeredNormal: [{ cell: 12, owners: [0, 1] }],
        timedExplosions: [{ seat: 0, number: 1, cell: 14, affectedSeats: [1] }],
      },
    });
  });
  const fixture = page.locator("#timed-terminal-fixture");
  await expect(fixture.locator(".timed-result")).toContainText("完整爆炸物地图已公开");
  await expect(fixture.locator(".timed-cell").nth(12).locator(".timed-final-piece")).toHaveCount(2);
  await expect(fixture.locator(".timed-cell").nth(12).locator(".triggered-final")).toHaveCount(2);
  await expect(fixture.locator(".timed-cell").nth(14).locator(".timed-final-piece")).toHaveCount(2);
  await expect(fixture.locator(".timed-cell").nth(14).locator(".detonated-timed-final")).toHaveCount(1);
  await expect(fixture.locator(".timed-final-legend")).toContainText("红方定时炸弹");
  await expect(fixture.locator(".timed-final-legend")).toContainText("已定时爆炸");
});

test("home excludes the removed duel game and clears its stale session", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".game-card")).toHaveCount(2);
  await expect(page.locator(".game-card").filter({ hasText: "互坑扫雷" })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("two-player-games-session", JSON.stringify({ code: "1234", seat: 0, token: "old-token", gameId: "minesweeper-duel" })));
  await page.reload();
  await expect(page.locator("#homeView")).toBeVisible();
  await expect(page.locator(".game-card")).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem("two-player-games-session"))).toBeNull();
});
