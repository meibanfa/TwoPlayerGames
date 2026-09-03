(function () {
  const L = window.ForgottenMinesLogic;

  function create(ctx) {
    const root = document.createElement("section");
    root.className = "forgotten-game";
    root.innerHTML = `<div class="forgotten-phase"></div><p class="forgotten-status" aria-live="polite"></p><div class="forgotten-scoreboard"><div class="score red"><span class="name"></span><strong>0</strong></div><div class="turn"></div><div class="score green"><span class="name"></span><strong>0</strong></div></div><div class="forgotten-meta"></div><div class="forgotten-board" role="grid" aria-label="遗忘的地雷棋盘"></div><div class="forgotten-actions"><button class="btn confirm" type="button">确认布雷</button></div><p class="forgotten-warning">确认后雷图会立即消失，请先记住关键位置。</p><p class="forgotten-event" aria-live="polite"></p><div class="forgotten-result hidden"></div><p class="forgotten-connection"></p>`;
    ctx.boardEl.appendChild(root);
    const phaseEl = root.querySelector(".forgotten-phase");
    const statusEl = root.querySelector(".forgotten-status");
    const boardEl = root.querySelector(".forgotten-board");
    const metaEl = root.querySelector(".forgotten-meta");
    const turnEl = root.querySelector(".turn");
    const scoreEls = root.querySelectorAll(".score strong");
    const nameEls = root.querySelectorAll(".score .name");
    const confirmBtn = root.querySelector(".confirm");
    const actionsEl = root.querySelector(".forgotten-actions");
    const warningEl = root.querySelector(".forgotten-warning");
    const eventEl = root.querySelector(".forgotten-event");
    const resultEl = root.querySelector(".forgotten-result");
    const connectionEl = root.querySelector(".forgotten-connection");
    const cells = [];
    let phase = ctx.phase || "WAITING";
    let placement = new Set();
    let confirmed = [false, false];
    let placementDeadline = null;
    let positions = [...L.START_CELLS];
    let scores = [0, 0];
    let currentTurn = null;
    let pendingReentrySeat = null;
    let collectedTreasures = [];
    let exhaustedSafeCells = new Set();
    let detonatedCells = new Set();
    let latestEvent = null;
    let winner = null;
    let finishReason = null;
    let connectionMessage = "";

    nameEls[0].textContent = `${ctx.playerNames?.[0] || "玩家 A"}（红方）`;
    nameEls[1].textContent = `${ctx.playerNames?.[1] || "玩家 B"}（绿方）`;
    for (let cell = 0; cell < L.CELL_COUNT; cell++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "forgotten-cell";
      button.setAttribute("role", "gridcell");
      button.addEventListener("click", () => activate(cell));
      boardEl.appendChild(button);
      cells.push(button);
    }
    confirmBtn.addEventListener("click", () => ctx.sendGameAction({ action: "confirmPlacement" }));

    function legalAction(cell) {
      if (phase === "PLACING") return !confirmed[ctx.seat] && L.isLegalMineCell(cell);
      if (phase === "PLAYING") return currentTurn === ctx.seat && L.isLegalNormalMove(positions[ctx.seat], cell, positions[1 - ctx.seat]);
      if (phase === "REENTRY") return pendingReentrySeat === ctx.seat && L.legalReentryCells(ctx.seat, positions[1 - ctx.seat]).includes(cell);
      return false;
    }
    function activate(cell) {
      if (!legalAction(cell)) return;
      if (phase === "PLACING") ctx.sendGameAction({ action: "toggleMine", cell });
      else if (phase === "REENTRY") ctx.sendGameAction({ action: "reenter", cell });
      else ctx.sendGameAction({ action: "move", cell });
    }
    function phaseLabel() {
      if (phase === "WAITING") return "等待好友";
      if (phase === "PLACING") return "布雷阶段";
      if (phase === "REENTRY") return "重新入场";
      if (phase === "PLAYING") return "寻宝阶段";
      return "比赛结束";
    }
    function statusText() {
      if (phase === "WAITING") return "创建房间后，把房间码发给好友。";
      if (phase === "PLACING") return confirmed[ctx.seat] ? "已确认并忘掉雷图，等待对手完成布雷…" : "在合法位置埋下 15 颗雷，然后记住它们。";
      if (phase === "REENTRY") return pendingReentrySeat === ctx.seat ? "踩雷后，请从自己起点旁选择一个保护格重新入场。" : "对手正在重新选择起点位置。";
      if (phase === "PLAYING") return currentTurn === ctx.seat ? "轮到你了" : "等待对手行动";
      return finishReason || "比赛结束";
    }
    function cellContents(cell) {
      const markers = [];
      positions.forEach((position, seat) => { if (L.isCell(position) && position === cell) markers.push(seat === 0 ? "🔴" : "🟢"); });
      const treasure = L.TREASURE_CELLS.includes(cell);
      const collected = collectedTreasures.some((item) => item.cell === cell);
      if (treasure) markers.push(collected ? "📭" : "🎁");
      if (phase === "PLACING" && !confirmed[ctx.seat] && placement.has(cell)) markers.push("💣");
      else if (detonatedCells.has(cell)) markers.push("💥");
      else if (exhaustedSafeCells.has(cell)) markers.push("✓");
      return markers.join("");
    }
    function render() {
      const now = Date.now();
      phaseEl.textContent = phaseLabel();
      statusEl.textContent = statusText();
      scoreEls[0].textContent = scores[0];
      scoreEls[1].textContent = scores[1];
      turnEl.textContent = phase === "PLAYING" || phase === "REENTRY" ? `当前：${ctx.playerNames?.[currentTurn] || `玩家 ${currentTurn + 1}`}` : "";
      const nextBonus = L.treasureBonus(collectedTreasures.length);
      if (phase === "PLACING") {
        const seconds = Math.max(0, Math.ceil(((placementDeadline || now) - now) / 1_000));
        metaEl.textContent = confirmed[ctx.seat] ? `对手状态：${confirmed[1 - ctx.seat] ? "已确认" : "布雷中"}` : `剩余地雷：${L.MINE_COUNT - placement.size} / ${L.MINE_COUNT} · 剩余时间：${seconds} 秒`;
      } else if (["PLAYING", "REENTRY"].includes(phase)) metaEl.textContent = `已找到宝物：${collectedTreasures.length} / 3 · 下一个宝物：+${nextBonus} 分`;
      else metaEl.textContent = "";
      boardEl.classList.toggle("hidden", phase === "PLACING" && confirmed[ctx.seat]);
      actionsEl.classList.toggle("hidden", phase !== "PLACING" || confirmed[ctx.seat]);
      warningEl.classList.toggle("hidden", phase !== "PLACING" || confirmed[ctx.seat]);
      confirmBtn.disabled = placement.size !== L.MINE_COUNT || confirmed[ctx.seat];
      cells.forEach((button, cell) => {
        button.className = "forgotten-cell";
        const coordinate = L.coordinate(cell);
        const contents = cellContents(cell);
        button.innerHTML = `<span class="coord">${coordinate}</span><span class="marker">${contents}</span>`;
        button.setAttribute("aria-label", `${coordinate}${contents ? `，${contents}` : "，空格"}`);
        button.disabled = !legalAction(cell);
        if (L.PROTECTED_HOME_CELLS[0].includes(cell)) button.classList.add("red-home");
        if (L.PROTECTED_HOME_CELLS[1].includes(cell)) button.classList.add("green-home");
        if (L.TREASURE_CELLS.includes(cell)) button.classList.add("treasure");
        if (placement.has(cell) && phase === "PLACING" && !confirmed[ctx.seat]) button.classList.add("mine-preview");
        if (exhaustedSafeCells.has(cell)) button.classList.add("exhausted");
        if (detonatedCells.has(cell)) button.classList.add("detonated");
        if (legalAction(cell) && phase !== "PLACING") button.classList.add("legal-move");
      });
      eventEl.textContent = latestEvent?.text || "";
      connectionEl.textContent = connectionMessage;
      resultEl.classList.toggle("hidden", phase !== "FINISHED");
      if (phase === "FINISHED") {
        const result = winner === null ? "平局" : winner === ctx.seat ? "🏆 你赢了！" : "这局是对手赢了";
        resultEl.textContent = `${result} · 最终比分 ${scores[0]} : ${scores[1]} · ${finishReason || ""}`;
      }
    }
    function receive(message) {
      if (message.type === "actionError") latestEvent = { kind: "error", text: message.message || "操作失败，请重试。" };
      if (message.type === "opponentDisconnected") connectionMessage = "对手暂时断开，等待重新连接…";
      if (message.type === "opponentReconnected") connectionMessage = "";
      if (message.type === "netretry") connectionMessage = "正在重新连接…";
      if (message.type === "restart") {
        phase = "PLACING";
        placement = new Set();
        confirmed = [false, false];
        positions = [...L.START_CELLS];
        scores = [0, 0];
        currentTurn = null;
        pendingReentrySeat = null;
        collectedTreasures = [];
        exhaustedSafeCells = new Set();
        detonatedCells = new Set();
        latestEvent = null;
        winner = null;
        finishReason = null;
        placementDeadline = message.placementDeadline;
      }
      if (["gameState", "roomState", "gameFinished"].includes(message.type)) {
        if (message.phase) phase = message.phase;
        if (Object.prototype.hasOwnProperty.call(message, "placement")) placement = new Set(message.placement || []);
        else if (phase !== "PLACING" || message.confirmed?.[ctx.seat]) placement.clear();
        if (message.confirmed) confirmed = [...message.confirmed];
        if (message.placementDeadline !== undefined) placementDeadline = message.placementDeadline;
        if (message.positions) positions = [...message.positions];
        if (message.scores) scores = [...message.scores];
        if (message.currentTurn !== undefined) currentTurn = message.currentTurn;
        if (message.pendingReentrySeat !== undefined) pendingReentrySeat = message.pendingReentrySeat;
        if (message.collectedTreasures) collectedTreasures = message.collectedTreasures.map((item) => ({ ...item }));
        if (message.exhaustedSafeCells) exhaustedSafeCells = new Set(message.exhaustedSafeCells);
        if (message.detonatedCells) detonatedCells = new Set(message.detonatedCells);
        if (message.latestEvent !== undefined) latestEvent = message.latestEvent;
        if (message.winner !== undefined) winner = message.winner;
        if (message.finishReason !== undefined) finishReason = message.finishReason;
      }
      render();
    }
    const timer = setInterval(() => { if (phase === "PLACING") render(); }, 1_000);
    render();
    return { receive, destroy() { clearInterval(timer); root.remove(); } };
  }

  window.GameRegistry.register({
    id: "forgotten-mines",
    name: "遗忘的地雷",
    icon: "🧭",
    description: "埋下地雷，再凭记忆寻宝得分。",
    howTo: [
      "双方在 11×11 棋盘各埋 15 颗雷，可以把雷埋在同一格。确认后雷图会立即消失，请凭记忆行动。",
      "轮到你时可向八个方向移动一格。新安全格按周围剩余地雷总数得分；安全格全局只结算一次，宝物依次奖励 10、15、20 分。",
      "踩雷扣 5 分，所有该格地雷都会消失。你的棋子会暂时离开棋盘，并必须从起点旁选择保护格重新入场；重入不结算格子。",
      "第三个宝物被找到后立即结束，分数更高者获胜，同分为平局。比赛结束也不会公开完整雷图。",
    ],
    create,
  });
})();
