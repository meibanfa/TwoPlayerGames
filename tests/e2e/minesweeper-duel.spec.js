"use strict";
/* global document, window */
const { test, expect } = require("@playwright/test");

async function home(page) { await page.goto("/"); await page.locator(".game-card").filter({ hasText: "互坑扫雷" }).getByRole("button", { name: "开始游戏" }).click(); }
async function create(page, name) { await home(page); await page.locator("#createName").fill(name); await page.locator("#createForm button").click(); await expect(page.locator("#gameView")).toBeVisible(); await expect(page.locator(".duel-phase")).toHaveText("等待好友"); }
async function join(page, code, name) { await home(page); await page.locator("#joinName").fill(name); await page.locator("#roomCode").fill(code); await page.locator("#joinForm button").click(); await expect(page.locator("#gameView")).toBeVisible(); }
async function place(page, cells) { for (const cell of cells) await page.locator(".duel-cell").nth(cell).click(); await expect(page.locator(".duel-stats")).toContainText("15 / 15"); await page.locator(".ready").click(); }
function coordinateSets(value, key = "", found = []) {
  if (Array.isArray(value)) {
    if (/(board|mine|placement|cell|reveal|flag)/i.test(key)) {
      const cells = value.map((item) => Number.isInteger(item) ? item : item && Number.isInteger(item.cell) ? item.cell : null).filter(Number.isInteger);
      if (cells.length) found.push(cells);
    }
    value.forEach((item) => coordinateSets(item, key, found));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, child]) => coordinateSets(child, childKey, found));
  }
  return found;
}
function containsMineSet(value, mines) { return coordinateSets(value).some((cells) => { const unique = new Set(cells); return mines.every((cell) => unique.has(cell)); }); }
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

test("two browsers play a deterministic match and rematch", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); let b = await bContext.newPage();
  try {
    await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await expect(a.locator(".duel-phase")).toHaveText("布雷阶段");
    await place(a, Array.from({ length: 15 }, (_, i) => i)); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await expect(a.locator(".duel-phase")).toHaveText("扫雷阶段"); await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段");
    await a.locator(".duel-cell").nth(19).click(); await expect(a.locator(".duel-cell").nth(19)).toHaveText(/^[0-8]$/); await a.locator(".flag-mode").click(); await a.locator(".duel-cell").nth(40).click(); await expect(a.locator(".duel-cell").nth(40)).toHaveText("🚩"); await a.locator(".duel-cell").nth(40).click();
    await a.locator(".flag-mode").click(); await a.locator(".duel-cell").nth(20).click(); await expect(a.locator(".duel-stats")).toContainText("你的进度"); await expect(a.locator(".duel-stats")).toContainText("罚时：10 秒");
    for (let i = 0; i < 81; i++) if (!Array.from({ length: 15 }, (_, n) => n + 20).includes(i)) await a.locator(".duel-cell").nth(i).click();
    await expect(a.locator(".duel-message")).toContainText("你赢了"); await expect(a.locator(".final-board")).toHaveCount(2); await expect(a.locator(".final-board .mine-preview")).toHaveCount(30);
    await expect(a.locator(".final-board").nth(0).locator("h3")).toHaveText("你扫的雷区"); await expect(a.locator(".final-board").nth(1).locator("h3")).toHaveText("你给对手埋的雷区");
    expect(await a.locator(".final-board").nth(0).locator(".mine-preview").evaluateAll((nodes) => nodes.map((node) => Array.from(node.parentElement.children).indexOf(node)))).toEqual(Array.from({ length: 15 }, (_, i) => i + 20));
    expect(await a.locator(".final-board").nth(1).locator(".mine-preview").evaluateAll((nodes) => nodes.map((node) => Array.from(node.parentElement.children).indexOf(node)))).toEqual(Array.from({ length: 15 }, (_, i) => i));
    const resultText = await a.locator(".duel-message").textContent(); await b.close(); await expect(a.locator(".duel-message")).toContainText("对手暂时断开"); b = await bContext.newPage(); await b.goto("/"); await expect(b.locator("#gameView")).toBeVisible(); await expect(a.locator(".duel-message")).toHaveText(resultText);
    await a.locator("#restartBtn").click(); await b.locator("#restartBtn").click(); await expect(a.locator(".duel-phase")).toHaveText("布雷阶段"); await expect(a.locator(".duel-stats")).toContainText("已埋：0 / 15");
  } finally { await aContext.close(); await bContext.close(); }
});

test("sweeping browser never receives opponent placement coordinates", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage(); await captureServerFrames(b);
  const secret = Array.from({ length: 15 }, (_, i) => i);
  try {
    await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, secret); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段");
    const browserData = await b.evaluate(() => {
      const parse = (storage) => Object.values(storage).map((value) => { try { return JSON.parse(value); } catch { return value; } });
      const exposedMineCells = [...document.querySelectorAll("#gameMount .duel-board:not(.final-grid) .duel-cell")].flatMap((cell, index) => {
        const attributes = [...cell.attributes].filter((attribute) => /^(data-|aria-)/.test(attribute.name)).map((attribute) => `${attribute.name}=${attribute.value}`);
        return cell.textContent.includes("💣") || cell.classList.contains("mine-preview") || attributes.some((attribute) => /mine|bomb/i.test(attribute)) ? [index] : [];
      });
      return { frames: window.__TEST_WS_FRAMES__, local: parse(localStorage), session: parse(sessionStorage), exposedMineCells };
    });
    expect(browserData.frames.length).toBeGreaterThan(0);
    expect(browserData.frames.some((payload) => containsMineSet(payload, secret))).toBe(false);
    expect(containsMineSet(browserData.local, secret)).toBe(false);
    expect(containsMineSet(browserData.session, secret)).toBe(false);
    expect(browserData.exposedMineCells.some((cell) => secret.includes(cell))).toBe(false);
    await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段");
  } finally { await aContext.close(); await bContext.close(); }
});

test("mobile flag mode fits the board and toggles a flag", async ({ browser }) => {
  const aContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); const bContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, Array.from({ length: 15 }, (_, i) => i)); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); expect(await a.locator(".duel-board").evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true); await a.locator(".flag-mode").click(); await a.locator(".duel-cell").nth(40).click(); await expect(a.locator(".duel-cell").nth(40)).toHaveText("🚩"); await a.locator(".duel-cell").nth(40).click(); await expect(a.locator(".duel-cell").nth(40)).toHaveText(""); } finally { await aContext.close(); await bContext.close(); }
});

test("refresh reconnects the same seat without leaking the opponent board", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); for (const cell of [0, 1, 2]) await a.locator(".duel-cell").nth(cell).click(); await expect(a.locator(".duel-stats")).toContainText("3 / 15"); await a.reload(); await expect(a.locator("#gameView")).toBeVisible(); await expect(a.locator(".duel-stats")).toContainText("3 / 15"); await expect(b.locator(".duel-phase")).toHaveText("布雷阶段"); } finally { await aContext.close(); await bContext.close(); }
});

test("guest refresh reconnects with its own credential and restores the server snapshot", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, Array.from({ length: 15 }, (_, i) => i)); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段"); await b.locator(".duel-cell").nth(19).click(); await expect(b.locator(".duel-cell").nth(19)).toHaveText(/^[0-8]$/); await b.reload(); await expect(b.locator("#gameView")).toBeVisible(); await expect(b.locator(".duel-cell").nth(19)).toHaveText(/^[0-8]$/);  } finally { await aContext.close(); await bContext.close(); }
});

test("placement reconnect keeps the unready player editable and the ready player locked", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, Array.from({ length: 15 }, (_, i) => i)); for (const cell of [20, 21, 22, 23, 24, 25]) await b.locator(".duel-cell").nth(cell).click(); await a.reload(); await expect(a.locator(".duel-phase")).toHaveText("布雷阶段"); await expect(a.locator(".duel-subtitle")).toContainText("等待对手"); await expect(a.locator(".duel-actions")).toHaveClass(/hidden/); await b.reload(); await expect(b.locator(".duel-phase")).toHaveText("布雷阶段"); await expect(b.locator(".duel-stats")).toContainText("6 / 15"); for (const cell of Array.from({ length: 9 }, (_, i) => i + 26)) await b.locator(".duel-cell").nth(cell).click(); await b.locator(".ready").click(); await expect(a.locator(".duel-phase")).toHaveText("扫雷阶段"); await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段"); await expect(a.locator(".duel-message")).toHaveText(""); } finally { await aContext.close(); await bContext.close(); }
});

test("opponent reconnect clears the temporary disconnect message", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); let b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await b.close(); await expect(a.locator(".duel-message")).toContainText("对手暂时断开"); b = await bContext.newPage(); await b.goto("/"); await expect(b.locator("#gameView")).toBeVisible(); await expect(a.locator(".duel-message")).toHaveText(""); } finally { await aContext.close(); await bContext.close(); }
});

test("terminal room errors return the remaining player to a usable lobby", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await b.locator("#leaveBtn").click(); await expect(a.locator("#lobbyView")).toBeVisible(); await expect(a.locator("#lobbyMessage")).toContainText("对手已离开房间"); await expect(a.locator("#createForm button")).toBeEnabled(); await a.locator("#createName").fill("甲"); await a.locator("#createForm button").click(); await expect(a.locator("#gameView")).toBeVisible(); } finally { await aContext.close(); await bContext.close(); }
});

test("reconnect grace expiry explains the failure and frees the lobby", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await b.close(); await expect(a.locator(".duel-message")).toContainText("对手暂时断开"); await expect(a.locator("#lobbyView")).toBeVisible({ timeout: 7_000 }); await expect(a.locator("#lobbyMessage")).toContainText("对手未能及时重连"); await expect(a.locator("#createForm button")).toBeEnabled(); } finally { await aContext.close(); await bContext.close(); }
});
