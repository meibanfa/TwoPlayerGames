"use strict";
const { test, expect } = require("@playwright/test");

async function prepare(page) {
  await page.addInitScript(() => localStorage.setItem("tpg_onboarded", "1"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#gameGrid .game-card").first()).toBeVisible();
}

async function openOnlineHub(page) {
  await prepare(page);
  await page.locator("#openOnlineHubBtn").click();
  await expect(page.locator("#lobbyView")).toBeVisible();
}

async function dismissHelp(page) {
  await expect(page.locator("#helpOverlay")).toBeVisible();
  await page.locator("#helpOk").click();
  await expect(page.locator("#helpOverlay")).toBeHidden();
}

test("plays a complete local Tic-Tac-Toe game", async ({ page }) => {
  await prepare(page);
  await page.locator("#gameSearch").fill("Caro 3x3");
  await page.locator(".game-card", { hasText: "Caro 3x3" }).click();
  await page.locator("#detailPlayBtn").click();
  await page.locator("#modeLocal").click();
  await dismissHelp(page);

  const cells = page.locator(".ttt-cell");
  await expect(cells).toHaveCount(9);
  for (const index of [0, 3, 1, 4, 2]) await cells.nth(index).click();
  await expect(page.locator("#winOverlay")).toBeVisible();
});

test("syncs an online move and chat between two browsers", async ({ browser }) => {
  const hostContext = await browser.newContext({ serviceWorkers: "block" });
  const guestContext = await browser.newContext({ serviceWorkers: "block" });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await openOnlineHub(host);
    await host.locator("#createNameInput").fill("Host E2E");
    await host.locator("#lobbyGameSelect").selectOption("tictactoe");
    await host.locator("#createRoomBtn").click();
    await expect(host.locator("#roomCodeBox")).toBeVisible();
    const code = (await host.locator("#roomCodeVal").textContent()).trim();
    expect(code).toMatch(/^\d{4}$/);

    await openOnlineHub(guest);
    await guest.locator("#joinNameInput").fill("Guest E2E");
    await guest.locator("#joinCodeInput").fill(code);
    await guest.locator("#joinRoomBtn").click();
    await expect(host.locator("#gameView")).toBeVisible();
    await expect(guest.locator("#gameView")).toBeVisible();
    await Promise.all([dismissHelp(host), dismissHelp(guest)]);

    const hostCell = host.locator(".ttt-cell").nth(0);
    const guestCell = guest.locator(".ttt-cell").nth(0);
    await hostCell.click();
    if (await hostCell.locator("svg").count() === 0) await guestCell.click();
    await expect(hostCell.locator("svg")).toHaveCount(1);
    await expect(guestCell.locator("svg")).toHaveCount(1);

    await host.locator("#chatInput").fill("Xin chao tu E2E");
    await host.locator("#chatForm").evaluate((form) => form.requestSubmit());
    await expect(guest.locator("#chatMessages")).toContainText("Xin chao tu E2E");
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("registers, logs out, and signs back in", async ({ page }) => {
  await prepare(page);
  const username = `e2e_${Date.now().toString(36)}`;
  const password = "secure-e2e-password";

  await page.locator("#profileChip").click();
  await page.locator("#accUser").fill(username);
  await page.locator("#accPass").fill(password);
  await page.locator("#accRegisterBtn").click();
  await expect(page.locator("#accountSignedIn")).toBeVisible();
  await expect(page.locator("#accWho")).toHaveText(username);

  await page.locator("#accLogoutBtn").click();
  await expect(page.locator("#accountSignedOut")).toBeVisible();
  await page.locator("#accUser").fill(username);
  await page.locator("#accPass").fill(password);
  await page.locator("#accLoginBtn").click();
  await expect(page.locator("#accountSignedIn")).toBeVisible();
  await expect(page.locator("#accWho")).toHaveText(username);
});