(function () {
  const L = window.MinesweeperDuelLogic;
  const copy = (value) => Array.isArray(value) ? value.slice() : [];

  function create(ctx) {
    const root = document.createElement("section");
    root.className = "duel-game";
    root.innerHTML = `<div class="duel-phase"></div><p class="duel-subtitle"></p><div class="duel-stats"></div><div class="duel-board" role="grid"></div><div class="duel-actions"><button class="btn flag-mode" type="button">🚩 插旗</button><button class="btn ready" type="button">完成布雷</button></div><div class="final-boards hidden"></div><p class="duel-message"></p>`;
    ctx.boardEl.appendChild(root);
    const phaseEl = root.querySelector(".duel-phase"), subtitleEl = root.querySelector(".duel-subtitle"), statsEl = root.querySelector(".duel-stats"), boardEl = root.querySelector(".duel-board"), actions = root.querySelector(".duel-actions"), readyBtn = root.querySelector(".ready"), flagBtn = root.querySelector(".flag-mode"), finalEl = root.querySelector(".final-boards"), messageEl = root.querySelector(".duel-message");
    const cells = [];
    let phase = ctx.phase || "PLACING", placement = new Set(), revealed = new Map(), flags = new Set(), finalBoards = null, mistakes = 0, penalty = 0, progress = null, flagMode = false, placementDeadline = null, sweepStartedAt = null, summary = null, ready = false, message = "", result = "", connectionMessage = "";
    for (let i = 0; i < L.BOARD_ROWS * L.BOARD_COLS; i++) {
      const cell = document.createElement("button"); cell.type = "button"; cell.className = "duel-cell"; cell.setAttribute("role", "gridcell");
      cell.addEventListener("click", () => { if (!(phase === "PLACING" && ready)) ctx.sendGameAction({ action: phase === "PLACING" ? "place" : (flagMode ? "flag" : "reveal"), cell: i }); });
      cell.addEventListener("contextmenu", (e) => { e.preventDefault(); ctx.sendGameAction({ action: "flag", cell: i }); });
      boardEl.appendChild(cell); cells.push(cell);
    }
    flagBtn.addEventListener("click", () => { flagMode = !flagMode; flagBtn.classList.toggle("active", flagMode); });
    readyBtn.addEventListener("click", () => ctx.sendGameAction({ action: "ready" }));

    function render() {
      phaseEl.textContent = phase === "PLACING" ? "布雷阶段" : phase === "SWEEPING" ? "扫雷阶段" : phase === "FINISHED" ? "比赛结束" : "等待好友";
      subtitleEl.textContent = phase === "PLACING" ? (ready ? "等待对手完成布雷…" : "在棋盘上为对手埋下 15 颗雷。") : phase === "SWEEPING" ? "这是对手为你准备的雷区。" : "和朋友开个房间，来一局。";
      const now = Date.now();
      const elapsed = phase === "FINISHED" && summary ? summary[ctx.seat].elapsed : Math.max(0, now - sweepStartedAt || 0);
      const timer = phase === "PLACING" ? `剩余时间：${Math.max(0, Math.ceil((placementDeadline - now) / 1000) || 0)} 秒` : phase === "SWEEPING" || phase === "FINISHED" ? `用时：${formatTime(elapsed)}` : "";
      statsEl.textContent = phase === "PLACING" ? `已埋：${placement.size} / ${L.MINE_COUNT} ${timer}` : `你的进度：${progress ? progress[0] : revealed.size} / ${L.BOARD_ROWS * L.BOARD_COLS - L.MINE_COUNT} ${timer} 失误：${mistakes} 罚时：${penalty / 1000} 秒`;
      actions.classList.toggle("hidden", (phase !== "PLACING" && phase !== "SWEEPING") || (phase === "PLACING" && ready)); readyBtn.classList.toggle("hidden", phase !== "PLACING"); flagBtn.classList.toggle("hidden", phase !== "SWEEPING"); readyBtn.disabled = placement.size !== L.MINE_COUNT || ready;
      boardEl.classList.toggle("hidden", phase === "FINISHED");
      cells.forEach((el, i) => { el.className = "duel-cell"; el.textContent = ""; if (phase === "PLACING" && placement.has(i)) { el.classList.add("mine-preview"); el.textContent = "💣"; } else if (revealed.has(i)) { el.classList.add("revealed"); el.textContent = revealed.get(i) === "mine" ? "💣" : String(revealed.get(i)); } else if (flags.has(i)) { el.classList.add("flagged"); el.textContent = "🚩"; } else if (phase === "FINISHED" && finalBoards) { el.classList.add("revealed"); if (finalBoards.includes(i)) { el.textContent = "💣"; el.classList.add("mine-preview"); } } });
      finalEl.classList.toggle("hidden", phase !== "FINISHED" || !finalBoards);
      if (phase === "FINISHED" && finalBoards) finalEl.innerHTML = [["你扫的雷区", finalBoards[ctx.seat]], ["你给对手埋的雷区", finalBoards[1 - ctx.seat]]].map(([title, mines]) => `<section class="final-board"><h3>${title}</h3><div class="duel-board final-grid">${Array.from({ length: L.BOARD_ROWS * L.BOARD_COLS }, (_, i) => `<span class="duel-cell revealed${mines.includes(i) ? " mine-preview" : ""}">${mines.includes(i) ? "💣" : ""}</span>`).join("")}</div></section>`).join("");
      const resultSummary = phase === "FINISHED" && summary ? `${result} 你的实际用时：${formatTime(summary[ctx.seat].elapsed)}，罚时：${summary[ctx.seat].penalty / 1000} 秒，失误：${summary[ctx.seat].mistakes}，有效用时：${formatTime(summary[ctx.seat].effectiveTime)}。对手实际用时：${formatTime(summary[1 - ctx.seat].elapsed)}，罚时：${summary[1 - ctx.seat].penalty / 1000} 秒，失误：${summary[1 - ctx.seat].mistakes}，有效用时：${formatTime(summary[1 - ctx.seat].effectiveTime)}。` : message;
      messageEl.textContent = connectionMessage || resultSummary;
    }
    function receive(msg) {
      if (msg.type === "placementState") msg = { ...msg, phase: "PLACING" };
      if (msg.type === "placementLocked") msg = { ...msg, phase: "PLACING", ready: true, message: "等待对手完成布雷…" };
      if (msg.type === "placementProgress") msg = { ...msg, phase: "PLACING", ready: msg.ready?.[ctx.seat] };
      if (msg.type === "revealResult") msg = { ...msg, phase: "SWEEPING", revealedDelta: msg.cells };
      if (msg.type === "progress") msg = { ...msg, progress: [msg.mine, msg.opponent] };
      if (msg.type === "gameState" && msg.revealed) msg = { ...msg, revealedSnapshot: msg.revealed };
      if (msg.type === "gameFinished") msg = { ...msg, phase: "FINISHED", result: msg.winner === null ? "平局" : msg.winner === ctx.seat ? "🏆 你赢了！" : "这局是对手赢了" };
      if (msg.type === "restart") msg = { ...msg, phase: "PLACING" };
      if (msg.type === "opponentDisconnected") msg = { ...msg, connectionMessage: "对手暂时断开，等待重新连接…" };
      if (msg.type === "opponentReconnected") msg = { ...msg, connectionMessage: "" };
      if (msg.type === "netretry") msg = { ...msg, connectionMessage: "正在重新连接…" };
      const previousPhase = phase;
      if (msg.phase) phase = msg.phase;
      if (msg.placement) placement = new Set(msg.placement);
      if (msg.placementDeadline !== undefined) placementDeadline = msg.placementDeadline;
      if (msg.sweepStartedAt !== undefined) sweepStartedAt = msg.sweepStartedAt;
      if (msg.summary) summary = msg.summary;
      if (msg.revealedSnapshot) revealed = new Map(msg.revealedSnapshot.map((x) => [x.cell, x.mine ? "mine" : x.count]));
      if (msg.revealedDelta) msg.revealedDelta.forEach((x) => revealed.set(x.cell, x.mine ? "mine" : x.count));
      if (msg.flags) flags = new Set(msg.flags);
      if (msg.ready !== undefined) ready = msg.ready;
      if (msg.boards) finalBoards = msg.boards;
      if (msg.mistakes !== undefined) mistakes = msg.mistakes;
      if (msg.penalty !== undefined) penalty = msg.penalty;
      if (msg.progress) progress = msg.progress;
      if (Object.prototype.hasOwnProperty.call(msg, "message")) message = msg.message || "";
      if (Object.prototype.hasOwnProperty.call(msg, "connectionMessage")) connectionMessage = msg.connectionMessage || "";
      if (previousPhase === "PLACING" && phase === "SWEEPING") message = "";
      if (msg.result) result = msg.result;
      render();
    }
    const tick = setInterval(() => { if (phase === "PLACING" || phase === "SWEEPING") render(); }, 1_000);
    render();
    return { receive, destroy() { clearInterval(tick); root.remove(); }, getPlacement() { return copy([...placement]); } };
  }
  function formatTime(ms) { if (ms === null || ms === undefined) return "未完成"; const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
  window.GameRegistry.register({ id: "minesweeper-duel", name: "互坑扫雷", icon: "💣", description: "你埋雷，我来扫。双人实时心理博弈。", howTo: ["第一阶段，你需要在棋盘中埋下 15 颗雷，这张地图会交给你的对手。双方布雷完成后交换地图，同时开始扫雷。", "数字表示周围 8 个格子中的地雷数量。这里没有第一步保护；踩雷不会立刻出局，但会增加 10 秒罚时。", "清空所有安全格会记录完成时间。有效用时等于实际扫雷用时加罚时，有效用时更低者获胜。"], create });
})();
