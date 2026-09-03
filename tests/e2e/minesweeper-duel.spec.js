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
    await a.locator(".duel-cell").nth(19).click(); await expect(a.locator(".duel-cell").nth(19)).toHaveText(/^[0-8]$/); await a.locator(".flag-mode").click(); await a.locator(".duel-cell").nth(40).click(); await expect(a.locator(".duel-cell").nth(40)).toHaveText("🚩"); await a.locator(".duel-cell").nth(40).click();
    await a.locator(".flag-mode").click(); await a.locator(".duel-cell").nth(20).click(); await expect(a.locator(".duel-stats")).toContainText("你的进度"); await expect(a.locator(".duel-stats")).toContainText("罚时：10 秒");
    for (let i = 0; i < 81; i++) if (!Array.from({ length: 15 }, (_, n) => n + 20).includes(i)) await a.locator(".duel-cell").nth(i).click();
    await expect(a.locator(".duel-message")).toContainText("你赢了"); await expect(a.locator(".final-board")).toHaveCount(2); await expect(a.locator(".final-board .mine-preview")).toHaveCount(30);
    await expect(a.locator(".final-board").nth(0).locator("h3")).toHaveText("你扫的雷区"); await expect(a.locator(".final-board").nth(1).locator("h3")).toHaveText("你给对手埋的雷区");
    expect(await a.locator(".final-board").nth(0).locator(".mine-preview").evaluateAll((nodes) => nodes.map((node) => Array.from(node.parentElement.children).indexOf(node)))).toEqual(Array.from({ length: 15 }, (_, i) => i + 20));
    expect(await a.locator(".final-board").nth(1).locator(".mine-preview").evaluateAll((nodes) => nodes.map((node) => Array.from(node.parentElement.children).indexOf(node)))).toEqual(Array.from({ length: 15 }, (_, i) => i));
    await a.locator("#restartBtn").click(); await b.locator("#restartBtn").click(); await expect(a.locator(".duel-phase")).toHaveText("布雷阶段"); await expect(a.locator(".duel-stats")).toContainText("已埋：0 / 15");
  } finally { await aContext.close(); await bContext.close(); }
});

test("sweeping browser never receives opponent placement coordinates", async ({ browser }) => {
  const aContext = await browser.newContext({ serviceWorkers: "block" }); const bContext = await browser.newContext({ serviceWorkers: "block" }); const a = await aContext.newPage(); const b = await bContext.newPage(); const frames = []; b.on("websocket", (socket) => socket.on("framereceived", (frame) => { try { frames.push(JSON.parse(String(frame))); } catch {} }));
  const secret = Array.from({ length: 15 }, (_, i) => i);
  const sameCoordinates = (values) => values.length === secret.length && new Set(values).size === secret.length && values.every((cell) => secret.includes(cell));
  const containsSecret = (value) => { if (Array.isArray(value)) { const coordinates = value.map((item) => typeof item === "number" ? item : item?.cell).filter(Number.isInteger); return sameCoordinates(coordinates) || value.some(containsSecret); } return value && typeof value === "object" && Object.values(value).some(containsSecret); };
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, secret); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await expect(b.locator(".duel-phase")).toHaveText("扫雷阶段"); const browserData = await b.evaluate(() => ({ html: document.documentElement.outerHTML, local: Object.values(localStorage).map((value) => JSON.parse(value)), session: Object.values(sessionStorage).map((value) => JSON.parse(value)) })); expect(frames.some(containsSecret)).toBe(false); expect(containsSecret(browserData)).toBe(false); } finally { await aContext.close(); await bContext.close(); }
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
  try { await create(a, "甲"); const code = (await a.locator("#roomLabel").textContent()).match(/\d{4}/)[0]; await join(b, code, "乙"); await place(a, Array.from({ length: 15 }, (_, i) => i)); await place(b, Array.from({ length: 15 }, (_, i) => i + 20)); await b.locator(".duel-cell").nth(19).click(); await expect(b.locator(".duel-cell").nth(19)).toHaveText(/^[0-8]$/); await b.reload(); await expect(b.locator("#gameView")).toBeVisible(); await expect(b.locator(".duel-cell").nth(19)).toHaveText(/^[0-8]$/);  } finally { await aContext.close(); await bContext.close(); }
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
