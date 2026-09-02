(function () {
  const L = window.MinesweeperDuelLogic;
  const copy = (value) => Array.isArray(value) ? value.slice() : [];

  function create(ctx) {
    const root = document.createElement("section");
    root.className = "duel-game";
    root.innerHTML = `<div class="duel-phase"></div><p class="duel-subtitle"></p><div class="duel-stats"></div><div class="duel-board" role="grid"></div><div class="duel-actions"><button class="btn flag-mode" type="button">🚩 插旗</button><button class="btn ready" type="button">完成布雷</button></div><p class="duel-message"></p>`;
    ctx.boardEl.appendChild(root);
    const phaseEl = root.querySelector(".duel-phase"), subtitleEl = root.querySelector(".duel-subtitle"), statsEl = root.querySelector(".duel-stats"), boardEl = root.querySelector(".duel-board"), actions = root.querySelector(".duel-actions"), readyBtn = root.querySelector(".ready"), flagBtn = root.querySelector(".flag-mode"), messageEl = root.querySelector(".duel-message");
    const cells = [];
    let phase = "PLACING", placement = new Set(), revealed = new Map(), flags = new Set(), finalBoards = null, mistakes = 0, penalty = 0, progress = null, flagMode = false;
    for (let i = 0; i < L.BOARD_ROWS * L.BOARD_COLS; i++) {
      const cell = document.createElement("button"); cell.type = "button"; cell.className = "duel-cell"; cell.setAttribute("role", "gridcell");
      cell.addEventListener("click", () => ctx.sendGameAction({ action: phase === "PLACING" ? "place" : (flagMode ? "flag" : "reveal"), cell: i }));
      cell.addEventListener("contextmenu", (e) => { e.preventDefault(); ctx.sendGameAction({ action: "flag", cell: i }); });
      boardEl.appendChild(cell); cells.push(cell);
    }
    flagBtn.addEventListener("click", () => { flagMode = !flagMode; flagBtn.classList.toggle("active", flagMode); });
    readyBtn.addEventListener("click", () => ctx.sendGameAction({ action: "ready" }));

    function render() {
      phaseEl.textContent = phase === "PLACING" ? "布雷阶段" : phase === "SWEEPING" ? "扫雷阶段" : phase === "FINISHED" ? "比赛结束" : "等待好友";
      subtitleEl.textContent = phase === "PLACING" ? "在棋盘上为对手埋下 15 颗雷。" : phase === "SWEEPING" ? "这是对手为你准备的雷区。" : "和朋友开个房间，来一局。";
      statsEl.textContent = phase === "PLACING" ? `已埋：${placement.size} / ${L.MINE_COUNT}` : `你的进度：${progress ? progress[0] : revealed.size} / ${L.BOARD_ROWS * L.BOARD_COLS - L.MINE_COUNT} 失误：${mistakes} 罚时：${penalty / 1000} 秒`;
      actions.classList.toggle("hidden", phase !== "PLACING" && phase !== "SWEEPING"); readyBtn.classList.toggle("hidden", phase !== "PLACING"); flagBtn.classList.toggle("hidden", phase !== "SWEEPING"); readyBtn.disabled = placement.size !== L.MINE_COUNT;
      cells.forEach((el, i) => { el.className = "duel-cell"; el.textContent = ""; if (phase === "PLACING" && placement.has(i)) { el.classList.add("mine-preview"); el.textContent = "💣"; } else if (revealed.has(i)) { el.classList.add("revealed"); el.textContent = revealed.get(i) === "mine" ? "💣" : String(revealed.get(i)); } else if (flags.has(i)) { el.classList.add("flagged"); el.textContent = "🚩"; } else if (phase === "FINISHED" && finalBoards) { el.classList.add("revealed"); if (finalBoards.includes(i)) { el.textContent = "💣"; el.classList.add("mine-preview"); } } });
    }
    function receive(msg) {
      if (msg.phase) phase = msg.phase;
      if (msg.placement) placement = new Set(msg.placement);
      if (msg.revealedSnapshot) revealed = new Map(msg.revealedSnapshot.map((x) => [x.cell, x.mine ? "mine" : x.count]));
      if (msg.revealedDelta) msg.revealedDelta.forEach((x) => revealed.set(x.cell, x.mine ? "mine" : x.count));
      if (msg.flags) flags = new Set(msg.flags);
      if (msg.boards) finalBoards = msg.boards[ctx.seat] || [];
      if (msg.mistakes !== undefined) mistakes = msg.mistakes;
      if (msg.penalty !== undefined) penalty = msg.penalty;
      if (msg.progress) progress = msg.progress;
      if (msg.message) messageEl.textContent = msg.message;
      if (msg.result) messageEl.textContent = msg.result;
      render();
    }
    render();
    return { receive, destroy() { root.remove(); }, getPlacement() { return copy([...placement]); } };
  }
  window.GameRegistry.register({ id: "minesweeper-duel", name: "互坑扫雷", description: "你埋雷，我来扫。双人实时心理博弈。", howTo: ["轮流为对手埋下 15 颗雷，再同时扫雷。", "数字表示周围八格的地雷数量；踩雷会增加 10 秒罚时。"], create });
})();
