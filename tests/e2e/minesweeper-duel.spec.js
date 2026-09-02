"use strict";
/* global document, window */
const { test, expect } = require("@playwright/test");

async function home(page) { await page.goto("/"); await page.getByRole("button", { name: "开始游戏" }).click(); }
async function create(page, name) { await home(page); await page.locator("#createName").fill(name); await page.locator("#createForm button").click(); await expect(page.locator("#gameView")).toBeVisible(); await expect(page.locator(".duel-phase")).toHaveText("等待好友"); }
async function join(page, code, name) { await home(page); await page.locator("#joinName").fill(name); await page.locator("#roomCode").fill(code); await page.locator("#joinForm button").click(); await expect(page.locator("#gameView")).toBeVisible(); }
async function place(page, cells) { for (const cell of cells) await page.locator(".duel-cell").nth(cell).click(); await expect(page.locator(".duel-stats")).toContainText("15 / 15"); await page.locator(".ready").click(); }

test("two browsers play a deterministic match and rematch", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try {
    await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await expect(a.locator(".duel-phase")).toHaveText("布雷阶段");
    await place(a, Array.from({ length: 15 }, (_, i) => i)); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await expect(a.locator(".duel-phase")).toHaveText("扫雷阶段"); await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段");
    await a.locator(".duel-cell").nth(19).click(); await expect(a.locator(".duel-cell").nth(19)).toHaveText("1"); await a.locator(".flag-mode").click(); await a.locator(".duel-cell").nth(40).click(); await expect(a.locator(".duel-cell").nth(40)).toHaveText("🚩"); await a.locator(".duel-cell").nth(40).click();
    await a.locator(".flag-mode").click(); await a.locator(".duel-cell").nth(20).click(); await expect(a.locator(".duel-stats")).toContainText("你的进度"); await expect(a.locator(".duel-stats")).toContainText("罚时：10 秒");
    await a.locator(".flag-mode").click();
    for (let i = 0; i < 81; i++) if (!Array.from({ length: 15 }, (_, n) => n + 20).includes(i)) await a.locator(".duel-cell").nth(i).click();
    await expect(a.locator(".duel-message")).toContainText("你赢了"); await expect(a.locator(".mine-preview")).toHaveCount(15);
    await a.locator("#restartBtn").click(); await b.locator("#restartBtn").click(); await expect(a.locator(".duel-phase")).toHaveText("布雷阶段"); await expect(a.locator(".duel-stats")).toHaveText("已埋：0 / 15");
  } finally { await aContext.close(); await bContext.close(); }
});

test("sweeping browser never receives opponent placement coordinates", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage(); const frames = []; b.on("websocket", (socket) => socket.on("framereceived", (frame) => frames.push(String(frame))));
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, Array.from({ length: 15 }, (_, i) => i)); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段"); const browserData = await b.evaluate(() => ({ html: document.documentElement.outerHTML, local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) })); expect(browserData.html).not.toContain("0,1,2,3,4,5,6,7,8,9,10,11,12,13,14"); expect(browserData.local + browserData.session).not.toContain("0,1,2,3,4,5,6,7,8,9,10,11,12,13,14"); expect(frames.some((frame) => frame.includes("0,1,2,3,4,5,6,7,8,9,10,11,12,13,14"))).toBe(false); } finally { await aContext.close(); await bContext.close(); }
});

test("mobile flag mode fits the board and toggles a flag", async ({ browser }) => {
  const aContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); const bContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await expect(a.locator(".duel-board")).toBeVisible(); expect(await a.locator(".duel-board").evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true); await a.locator(".duel-cell").nth(0).click(); await a.locator(".flag-mode").click(); } finally { await aContext.close(); await bContext.close(); }
});

test("refresh reconnects the same seat without leaking the opponent board", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); for (const cell of [0, 1, 2]) await a.locator(".duel-cell").nth(cell).click(); await expect(a.locator(".duel-stats")).toContainText("3 / 15"); await a.reload(); await expect(a.locator("#gameView")).toBeVisible(); await expect(a.locator(".duel-stats")).toContainText("3 / 15"); await expect(b.locator(".duel-phase")).toHaveText("布雷阶段"); } finally { await aContext.close(); await bContext.close(); }
});

test("guest refresh reconnects with its own credential and restores the server snapshot", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage();
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, Array.from({ length: 15 }, (_, i) => i)); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await b.locator(".duel-cell").nth(19).click(); await expect(b.locator(".duel-cell").nth(19)).toHaveText("1"); await b.evaluate(() => window.Net.emit("revealResult", { cells: [{ cell: 40, count: 8 }] })); await expect(b.locator(".duel-cell").nth(40)).toHaveText("8"); await b.reload(); await expect(b.locator("#gameView")).toBeVisible(); await expect(b.locator(".duel-cell").nth(19)).toHaveText("1"); await expect(b.locator(".duel-cell").nth(40)).toHaveText(""); } finally { await aContext.close(); await bContext.close(); }
});
