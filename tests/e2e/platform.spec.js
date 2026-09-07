"use strict";
const { test, expect } = require("@playwright/test");
const L = require("../../js/games/forgotten-mines-logic");

async function chooseForgotten(page) {
  await page.goto("/");
  await page.locator(".game-card").filter({ hasText: "遗忘的地雷" }).getByRole("button", { name: "开始游戏" }).click();
  await expect(page.locator("#lobbyGameTitle")).toHaveText("遗忘的地雷");
}
async function create(page, name) {
  await chooseForgotten(page);
  await page.locator("#createName").fill(name);
  await page.locator("#createForm button").click();
  await expect(page.locator(".forgotten-phase")).toHaveText("等待好友");
  return (await page.locator("#roomLabel").textContent()).match(/\d{4}/)[0];
}
async function join(page, code, name) {
  await chooseForgotten(page);
  await page.locator("#joinName").fill(name);
  await page.locator("#roomCode").fill(code);
  await page.locator("#joinForm button").click();
  await expect(page.locator(".forgotten-phase")).toHaveText("布雷阶段");
}
async function pair(browser, names) {
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: "block" }), browser.newContext({ serviceWorkers: "block" })]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const code = await create(pages[0], names[0]);
  await join(pages[1], code, names[1]);
  return { contexts, pages, code };
}
async function place(page, cells) {
  for (const cell of cells) await page.locator(".forgotten-cell").nth(cell).click();
  await page.locator(".confirm").click();
}
function stepToward(from, target) {
  const source = L.rowCol(from), destination = L.rowCol(target);
  return L.index(source.row + Math.sign(destination.row - source.row), source.col + Math.sign(destination.col - source.col));
}

test("homepage initializes when browser storage APIs throw SecurityError", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.addInitScript(() => {
    const inaccessible = () => { throw new DOMException("Storage is unavailable", "SecurityError"); };
    Object.defineProperties(Storage.prototype, {
      getItem: { configurable: true, value: inaccessible },
      setItem: { configurable: true, value: inaccessible },
      removeItem: { configurable: true, value: inaccessible },
    });
  });
  await page.goto("/");
  await expect(page.locator("#homeView")).toBeVisible();
  await expect(page.locator(".game-card")).toHaveCount(2);
  await page.locator(".game-card").filter({ hasText: "遗忘的地雷" }).getByRole("button", { name: "开始游戏" }).click();
  await expect(page.locator("#lobbyView")).toBeVisible();
  await expect(page.locator("#lobbyGameTitle")).toHaveText("遗忘的地雷");
  expect(pageErrors).toEqual([]);
});

test("refresh restores the same active seat and opponent leave returns a usable lobby", async ({ browser }) => {
  const fixture = await pair(browser, ["刷新甲", "离开乙"]);
  try {
    const [a, b] = fixture.pages;
    for (const cell of [1, 2, 3]) await a.locator(".forgotten-cell").nth(cell).click();
    await expect(a.locator(".forgotten-meta")).toContainText("剩余地雷：12 / 15");
    await a.reload();
    await expect(a.locator("#gameView")).toBeVisible();
    await expect(a.locator("#roomLabel")).toContainText(`房间码：${fixture.code}（刷新甲）`);
    await expect(a.locator(".forgotten-phase")).toHaveText("布雷阶段");
    await expect(a.locator(".forgotten-meta")).toContainText("剩余地雷：12 / 15");
    await expect(a.locator(".mine-preview")).toHaveCount(3);

    await b.locator("#leaveBtn").click();
    await expect(a.locator("#lobbyView")).toBeVisible();
    await expect(a.locator("#lobbyMessage")).toContainText("对手已离开房间");
    await expect(a.locator("#createForm button")).toBeEnabled();
  } finally {
    await Promise.all(fixture.contexts.map((context) => context.close()));
  }
});

test("reconnect grace expiration returns the remaining player to a usable lobby", async ({ browser }) => {
  test.setTimeout(15_000);
  const fixture = await pair(browser, ["留守甲", "离线乙"]);
  try {
    const [a, b] = fixture.pages;
    await b.close();
    await expect(a.locator(".forgotten-connection")).toContainText("对手暂时断开");
    await expect(a.locator("#lobbyView")).toBeVisible({ timeout: 8_000 });
    await expect(a.locator("#lobbyMessage")).toContainText("对手未能及时重连");
    await expect(a.locator("#createForm button")).toBeEnabled();
  } finally {
    await Promise.all(fixture.contexts.map((context) => context.close()));
  }
});

test("both restart votes mount a fresh game after a completed match", async ({ browser }) => {
  test.setTimeout(60_000);
  const fixture = await pair(browser, ["重开甲", "重开乙"]);
  try {
    const pages = fixture.pages;
    const route = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24, 36, 48, 60, 72, 84, 96, 108, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120]);
    const mines = Array.from({ length: L.CELL_COUNT }, (_, cell) => cell).filter((cell) => L.isLegalMineCell(cell) && !route.has(cell)).slice(0, L.MINE_COUNT);
    await place(pages[0], mines);
    await place(pages[1], mines);
    await expect(pages[0].locator(".forgotten-phase")).toHaveText("寻宝阶段");

    const positions = [...L.START_CELLS];
    const cornerTreasures = [0, 120];
    const collectedCorner = [false, false];
    for (let moveCount = 0; moveCount < 40; moveCount++) {
      if (await pages[0].locator(".forgotten-result").isVisible()) break;
      const turnText = await pages[0].locator(".turn").textContent();
      const seat = turnText.includes("重开甲") ? 0 : 1;
      const target = collectedCorner[seat] ? 60 : cornerTreasures[seat];
      const destination = stepToward(positions[seat], target);
      await pages[seat].locator(".forgotten-cell").nth(destination).click();
      positions[seat] = destination;
      if (destination === cornerTreasures[seat]) collectedCorner[seat] = true;
      await expect.poll(async () => (await pages[0].locator(".forgotten-result").isVisible()) || (await pages[0].locator(".turn").textContent()) !== turnText).toBe(true);
    }
    await expect(pages[0].locator(".forgotten-result")).toBeVisible();
    await expect(pages[1].locator(".forgotten-result")).toBeVisible();

    await pages[0].locator("#restartBtn").click();
    await pages[1].locator("#restartBtn").click();
    for (const page of pages) {
      await expect(page.locator(".forgotten-phase")).toHaveText("布雷阶段");
      await expect(page.locator(".forgotten-meta")).toContainText("剩余地雷：15 / 15");
      await expect(page.locator(".mine-preview")).toHaveCount(0);
      await expect(page.locator("#roomLabel")).toContainText(fixture.code);
    }
    await pages[0].locator(".forgotten-cell").nth(mines[0]).click();
    await expect(pages[0].locator(".forgotten-meta")).toContainText("剩余地雷：14 / 15");
  } finally {
    await Promise.all(fixture.contexts.map((context) => context.close()));
  }
});
