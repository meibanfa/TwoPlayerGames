(function () {
  const L = window.TimedMinesLogic;

  function create(ctx) {
    const root = document.createElement("section");
    root.className = "timed-game";
    root.innerHTML = `<div class="timed-phase"></div><p class="timed-status" aria-live="polite"></p><div class="timed-scoreboard"><div class="score red"><span class="name"></span><strong>0</strong></div><div class="turn" aria-live="polite"></div><div class="score green"><span class="name"></span><strong>0</strong></div></div><div class="timed-meta"></div><div class="timed-legend"><span>🔴 红方棋子</span><span>🟢 绿方棋子</span><span>💎 未收集宝物</span><span>◇ 已收集宝物</span><span>💥 普通雷已触发</span><span>🕒 定时炸弹爆炸点</span><span>✓ 已结算</span><span>走 可移动</span></div><div class="timed-placement-tools" aria-label="爆炸物布置工具"><button type="button" data-tool="normal">普通地雷</button><button type="button" data-tool="timed-1">定时炸弹 #1</button><button type="button" data-tool="timed-2">定时炸弹 #2</button><button type="button" data-tool="timed-3">定时炸弹 #3</button></div><div class="timed-placement-counts"></div><div class="timed-bomb-panels hidden"><section><h3>我的定时炸弹</h3><div class="own-bombs"></div></section><section><h3>对手定时炸弹</h3><div class="opponent-bombs"></div></section></div><div class="timed-final-legend hidden"><span><b class="red-final-normal">红💣</b> 红方普通雷</span><span><b class="green-final-normal">绿💣</b> 绿方普通雷</span><span><b class="red-final-timed">红⏱#</b> 红方定时炸弹</span><span><b class="green-final-timed">绿⏱#</b> 绿方定时炸弹</span><span><b class="triggered-final">💥</b> 踩爆</span><span><b class="detonated-timed-final">🕒</b> 已定时爆炸</span></div><div class="timed-board" role="grid" aria-label="定时炸弹扫雷公共棋盘"></div><div class="timed-actions"><button class="btn timed-confirm" type="button">确认布置</button></div><p class="timed-warning">确认后所有爆炸物位置会立即消失，请记住三颗编号炸弹的位置。</p><div class="timed-events" aria-live="polite"></div><div class="timed-result hidden"></div><p class="timed-connection"></p>`;
    ctx.boardEl.appendChild(root);
    const phaseEl = root.querySelector(".timed-phase");
    const statusEl = root.querySelector(".timed-status");
    const boardEl = root.querySelector(".timed-board");
    const metaEl = root.querySelector(".timed-meta");
    const turnEl = root.querySelector(".turn");
    const scoreEls = root.querySelectorAll(".score strong");
    const nameEls = root.querySelectorAll(".score .name");
    const placementToolsEl = root.querySelector(".timed-placement-tools");
    const toolButtons = [...placementToolsEl.querySelectorAll("button")];
    const placementCountsEl = root.querySelector(".timed-placement-counts");
    const bombPanelsEl = root.querySelector(".timed-bomb-panels");
    const ownBombsEl = root.querySelector(".own-bombs");
    const opponentBombsEl = root.querySelector(".opponent-bombs");
    const confirmBtn = root.querySelector(".timed-confirm");
    const actionsEl = root.querySelector(".timed-actions");
    const warningEl = root.querySelector(".timed-warning");
    const eventsEl = root.querySelector(".timed-events");
    const resultEl = root.querySelector(".timed-result");
    const finalLegendEl = root.querySelector(".timed-final-legend");
    const connectionEl = root.querySelector(".timed-connection");
    const cells = [];
    let phase = ctx.phase || "WAITING";
    let placement = { normal: new Set(), timed: new Map() };
    let selectedTool = "normal";
    let confirmed = [false, false];
    let placementDeadline = null;
    let positions = [...L.START_CELLS];
    let scores = [0, 0];
    let currentTurn = null;
    let pendingReentrySeat = null;
    let turnCount = 0;
    let activationUsed = false;
    let collectedTreasures = [];
    let settledSafeCells = new Set();
    let triggeredNormalCells = new Set();
    let bombStatuses = [];
    let publicExplosions = [];
    let recentEvents = [];
    let winner = null;
    let finishOutcome = null;
    let finishReason = null;
    let finalExplosiveReveal = null;
    let connectionMessage = "";

    nameEls[0].textContent = `${ctx.playerNames?.[0] || "玩家 A"}（红方）`;
    nameEls[1].textContent = `${ctx.playerNames?.[1] || "玩家 B"}（绿方）`;
    for (let cell = 0; cell < L.CELL_COUNT; cell++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "timed-cell";
      button.setAttribute("role", "gridcell");
      button.addEventListener("click", () => activateCell(cell));
      boardEl.appendChild(button);
      cells.push(button);
    }
    toolButtons.forEach((button) => button.addEventListener("click", () => { selectedTool = button.dataset.tool; render(); }));
    confirmBtn.addEventListener("click", () => ctx.sendGameAction({ action: "confirmPlacement" }));

    function legalDestination(cell) {
      if (phase === "PLAYING" && [0, 1].includes(currentTurn)) return L.isLegalNormalMove(positions[currentTurn], cell, positions[1 - currentTurn]);
      if (phase === "REENTRY" && [0, 1].includes(pendingReentrySeat)) return L.legalReentryCells(pendingReentrySeat, positions[1 - pendingReentrySeat]).includes(cell);
      return false;
    }
    function legalAction(cell) {
      if (phase === "PLACING") return !confirmed[ctx.seat] && L.isLegalExplosiveCell(cell);
      if (phase === "PLAYING") return currentTurn === ctx.seat && legalDestination(cell);
      if (phase === "REENTRY") return pendingReentrySeat === ctx.seat && legalDestination(cell);
      return false;
    }
    function activateCell(cell) {
      if (!legalAction(cell)) return;
      if (phase === "PLACING") {
        if (selectedTool === "normal") ctx.sendGameAction({ action: "placeExplosive", kind: "normal", cell });
        else ctx.sendGameAction({ action: "placeExplosive", kind: "timed", number: Number(selectedTool.split("-")[1]), cell });
      } else if (phase === "REENTRY") ctx.sendGameAction({ action: "reenter", cell });
      else ctx.sendGameAction({ action: "move", cell });
    }
    function phaseLabel() {
      if (phase === "WAITING") return "等待好友";
      if (phase === "PLACING") return "布置阶段";
      if (phase === "REENTRY") return "重新入场";
      if (phase === "PLAYING") return "寻宝阶段";
      return "比赛结束";
    }
    function statusText() {
      if (phase === "WAITING") return "创建房间后，把房间码发给好友。";
      if (phase === "PLACING") return confirmed[ctx.seat] ? "已确认并忘掉所有位置，等待对手完成布置…" : "布置 12 颗普通地雷和三颗编号定时炸弹。";
      if (phase === "REENTRY") return pendingReentrySeat === ctx.seat ? "起点被对手占用，请从自己的保护区选择另一格入场。" : "对手正在从保护区重新入场。";
      if (phase === "PLAYING") return currentTurn === ctx.seat ? "轮到你了：可先启动一颗炸弹，然后必须移动一格" : "等待对手移动";
      return finishReason || "比赛结束";
    }
    function finalPiecesAt(cell) {
      if (!finalExplosiveReveal) return [];
      const output = [];
      [[0, finalExplosiveReveal.red], [1, finalExplosiveReveal.green]].forEach(([seat, side]) => {
        const normalTriggered = finalExplosiveReveal.triggeredNormal.some((entry) => entry.cell === cell && entry.owners.includes(seat));
        if (side.normal.includes(cell)) output.push({ seat, kind: "normal", triggered: normalTriggered });
        const timed = side.timed.find((bomb) => bomb.cell === cell);
        if (timed) output.push({ seat, kind: "timed", number: timed.number, detonated: timed.detonated });
      });
      return output;
    }
    function cellPresentation(cell) {
      const markers = [];
      const labels = [];
      if (cell === L.START_CELLS[0]) { markers.push('<span class="home-marker red-start-marker">🔴起</span>'); labels.push("红方起点"); }
      else if (L.PROTECTED_HOME_CELLS[0].includes(cell)) { markers.push('<span class="home-marker red-protected-marker">红护</span>'); labels.push("红方保护区"); }
      if (cell === L.START_CELLS[1]) { markers.push('<span class="home-marker green-start-marker">🟢起</span>'); labels.push("绿方起点"); }
      else if (L.PROTECTED_HOME_CELLS[1].includes(cell)) { markers.push('<span class="home-marker green-protected-marker">绿护</span>'); labels.push("绿方保护区"); }
      const collected = collectedTreasures.some((item) => item.cell === cell);
      if (L.TREASURE_CELLS.includes(cell)) {
        markers.push(`<span class="treasure-marker ${collected ? "treasure-collected" : "treasure-uncollected"}">${collected ? "◇" : "💎"}</span>`);
        labels.push(collected ? "已收集宝物" : "未收集宝物");
      }
      positions.forEach((position, seat) => {
        if (L.isCell(position) && position === cell) {
          markers.push(`<span class="pawn ${seat === 0 ? "red-pawn" : "green-pawn"}">${seat === 0 ? "🔴" : "🟢"}</span>`);
          labels.push(seat === 0 ? "红方棋子" : "绿方棋子");
        }
      });
      if (phase === "FINISHED" && finalExplosiveReveal) {
        const pieces = finalPiecesAt(cell);
        if (pieces.length) {
          markers.push(`<span class="timed-final-stack${pieces.length > 1 ? " timed-overlap" : ""}">${pieces.map((piece) => {
            if (piece.kind === "normal") return `<span class="timed-final-piece ${piece.seat === 0 ? "red-final-normal" : "green-final-normal"}${piece.triggered ? " triggered-final" : ""}">${piece.seat === 0 ? "红" : "绿"}💣${piece.triggered ? "💥" : ""}</span>`;
            return `<span class="timed-final-piece ${piece.seat === 0 ? "red-final-timed" : "green-final-timed"}${piece.detonated ? " detonated-timed-final" : ""}">${piece.seat === 0 ? "红" : "绿"}⏱${piece.number}${piece.detonated ? "🕒" : ""}</span>`;
          }).join("")}</span>`);
          labels.push(...pieces.map((piece) => `${piece.seat === 0 ? "红方" : "绿方"}${piece.kind === "normal" ? `普通地雷${piece.triggered ? "，已踩爆" : "，未触发"}` : `定时炸弹 #${piece.number}${piece.detonated ? "，已爆炸" : "，未爆炸"}`}`));
        }
      } else if (phase === "PLACING" && !confirmed[ctx.seat]) {
        if (placement.normal.has(cell)) { markers.push('<span class="state-marker normal-preview">💣</span>'); labels.push("你的普通地雷"); }
        const timed = [...placement.timed.entries()].find(([, timedCell]) => timedCell === cell);
        if (timed) { markers.push(`<span class="state-marker timed-preview">⏱${timed[0]}</span>`); labels.push(`你的定时炸弹 #${timed[0]}`); }
      } else if (triggeredNormalCells.has(cell)) { markers.push('<span class="state-marker normal-triggered-marker">💥</span>'); labels.push("普通地雷已触发"); }
      if (phase !== "FINISHED") {
        const explosion = publicExplosions.find((entry) => entry.cell === cell);
        if (explosion) { markers.push(`<span class="explosion-center-marker">🕒${explosion.number}</span>`); labels.push(`公开的定时炸弹 #${explosion.number} 爆炸点`); }
      }
      return { html: markers.join(""), labels };
    }
    function bombStatusText(bomb) {
      if (!bomb || bomb.status === L.BOMB_STATUSES.UNACTIVATED) return "未启动";
      if (bomb.status === L.BOMB_STATUSES.ACTIVE) return `倒计时：对手还需移动 ${bomb.remainingOpponentMoves} 次`;
      return "已爆炸";
    }
    function renderBombList(container, seat, own) {
      container.replaceChildren(...L.TIMED_BOMB_NUMBERS.map((number) => {
        const bomb = bombStatuses.find((entry) => entry.seat === seat && entry.number === number);
        const row = document.createElement("div");
        row.className = "timed-bomb-row";
        const label = document.createElement("span");
        label.textContent = `#${number} ${bombStatusText(bomb)}`;
        row.appendChild(label);
        if (own && phase === "PLAYING" && currentTurn === ctx.seat && !activationUsed && bomb?.status === L.BOMB_STATUSES.UNACTIVATED) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn bomb-activate";
          button.textContent = "启动";
          button.addEventListener("click", () => ctx.sendGameAction({ action: "activateBomb", number }));
          row.appendChild(button);
        }
        return row;
      }));
    }
    function render() {
      const now = Date.now();
      phaseEl.textContent = phaseLabel();
      statusEl.textContent = statusText();
      scoreEls[0].textContent = scores[0];
      scoreEls[1].textContent = scores[1];
      if (["PLAYING", "REENTRY"].includes(phase) && [0, 1].includes(currentTurn)) {
        turnEl.textContent = `${currentTurn === 0 ? "🔴 红方回合" : "🟢 绿方回合"} · ${ctx.playerNames?.[currentTurn] || `玩家 ${currentTurn + 1}`}`;
        turnEl.className = `turn ${currentTurn === 0 ? "red-turn" : "green-turn"}`;
      } else { turnEl.textContent = ""; turnEl.className = "turn"; }
      const nextBonus = L.treasureBonus(collectedTreasures.length);
      if (phase === "PLACING") {
        const seconds = Math.max(0, Math.ceil(((placementDeadline || now) - now) / 1_000));
        metaEl.textContent = confirmed[ctx.seat] ? `对手状态：${confirmed[1 - ctx.seat] ? "已确认" : "布置中"}` : `布雷剩余时间 ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      } else if (["PLAYING", "REENTRY"].includes(phase)) metaEl.textContent = `回合 ${turnCount} / ${L.MAX_TURNS} · 宝物 ${collectedTreasures.length} / 3 · 下一个宝物 +${nextBonus} 分`;
      else if (phase === "FINISHED") metaEl.textContent = `完成移动 ${turnCount} / ${L.MAX_TURNS}`;
      else metaEl.textContent = "";
      const placing = phase === "PLACING" && !confirmed[ctx.seat];
      placementToolsEl.classList.toggle("hidden", !placing);
      placementCountsEl.classList.toggle("hidden", !placing);
      actionsEl.classList.toggle("hidden", !placing);
      warningEl.classList.toggle("hidden", !placing);
      placementCountsEl.textContent = `普通地雷 ${placement.normal.size} / ${L.NORMAL_MINE_COUNT} · 定时炸弹 ${placement.timed.size} / ${L.TIMED_BOMB_NUMBERS.length}`;
      toolButtons.forEach((button) => {
        button.classList.toggle("selected", button.dataset.tool === selectedTool);
        if (button.dataset.tool.startsWith("timed-")) {
          const number = Number(button.dataset.tool.split("-")[1]);
          button.classList.toggle("placed", placement.timed.has(number));
        }
      });
      confirmBtn.disabled = placement.normal.size !== L.NORMAL_MINE_COUNT || placement.timed.size !== L.TIMED_BOMB_NUMBERS.length;
      bombPanelsEl.classList.toggle("hidden", !["PLAYING", "REENTRY"].includes(phase));
      if (["PLAYING", "REENTRY"].includes(phase)) {
        renderBombList(ownBombsEl, ctx.seat, true);
        renderBombList(opponentBombsEl, 1 - ctx.seat, false);
      }
      const activeBlastCells = new Set(recentEvents.filter((event) => event.kind === "timed-explosion").flatMap((event) => event.blastCells || []));
      cells.forEach((button, cell) => {
        button.className = "timed-cell";
        const coordinate = L.coordinate(cell);
        const presentation = cellPresentation(cell);
        if (legalDestination(cell)) presentation.labels.push("可移动目的地");
        button.innerHTML = `<span class="coord">${coordinate}</span>${presentation.html}`;
        button.setAttribute("aria-label", `${coordinate}，${presentation.labels.join("，") || "普通格"}`);
        button.disabled = !legalAction(cell);
        if (L.PROTECTED_HOME_CELLS[0].includes(cell)) button.classList.add("red-home");
        if (L.PROTECTED_HOME_CELLS[1].includes(cell)) button.classList.add("green-home");
        if (L.START_CELLS.includes(cell)) button.classList.add("start-cell");
        if (L.TREASURE_CELLS.includes(cell)) button.classList.add("treasure");
        if (L.FORBIDDEN_EXPLOSIVE_CELLS.includes(cell)) button.classList.add("forbidden-placement");
        if (settledSafeCells.has(cell)) button.classList.add("settled");
        if (triggeredNormalCells.has(cell)) button.classList.add("normal-triggered");
        if (legalDestination(cell)) button.classList.add("legal-move");
        if (activeBlastCells.has(cell)) button.classList.add("blast-active");
      });
      eventsEl.replaceChildren(...recentEvents.map((event) => {
        const paragraph = document.createElement("p");
        paragraph.className = `timed-event event-${event.kind}`;
        paragraph.textContent = event.text;
        return paragraph;
      }));
      connectionEl.textContent = connectionMessage;
      finalLegendEl.classList.toggle("hidden", phase !== "FINISHED" || !finalExplosiveReveal);
      resultEl.classList.toggle("hidden", phase !== "FINISHED");
      if (phase === "FINISHED") {
        let result = "比赛结束";
        if (finishOutcome === L.FINISH_OUTCOMES.NO_WINNER) result = "无胜者";
        else if (finishOutcome === L.FINISH_OUTCOMES.DRAW) result = "平局";
        else if (finishOutcome === L.FINISH_OUTCOMES.WINNER) result = winner === ctx.seat ? "🏆 你赢了！" : "这局是对手赢了";
        resultEl.textContent = `${result} · 最终比分 ${scores[0]} : ${scores[1]} · ${finishReason || ""} · 完整爆炸物地图已公开，可复盘本局。`;
      }
    }
    function receive(message) {
      if (message.type === "actionError") recentEvents = [{ kind: "error", text: message.message || "操作失败，请重试。" }];
      if (message.type === "opponentDisconnected") connectionMessage = "对手暂时断开，等待重新连接…";
      if (message.type === "opponentReconnected") connectionMessage = "";
      if (message.type === "netretry") connectionMessage = "正在重新连接…";
      if (message.type === "restart") {
        phase = "PLACING";
        placement = { normal: new Set(), timed: new Map() };
        selectedTool = "normal";
        confirmed = [false, false];
        positions = [...L.START_CELLS];
        scores = [0, 0];
        currentTurn = null;
        pendingReentrySeat = null;
        turnCount = 0;
        activationUsed = false;
        collectedTreasures = [];
        settledSafeCells = new Set();
        triggeredNormalCells = new Set();
        bombStatuses = [];
        publicExplosions = [];
        recentEvents = [];
        winner = null;
        finishOutcome = null;
        finishReason = null;
        finalExplosiveReveal = null;
        placementDeadline = message.placementDeadline;
      }
      if (["gameState", "roomState", "gameFinished"].includes(message.type)) {
        if (message.phase) phase = message.phase;
        if (Object.hasOwn(message, "placement")) placement = {
          normal: new Set(message.placement?.normal || []),
          timed: new Map((message.placement?.timed || []).map((bomb) => [bomb.number, bomb.cell])),
        };
        else if (phase !== "PLACING" || message.confirmed?.[ctx.seat]) placement = { normal: new Set(), timed: new Map() };
        if (message.confirmed) confirmed = [...message.confirmed];
        if (message.placementDeadline !== undefined) placementDeadline = message.placementDeadline;
        if (message.positions) positions = [...message.positions];
        if (message.scores) scores = [...message.scores];
        if (message.currentTurn !== undefined) currentTurn = message.currentTurn;
        if (message.pendingReentrySeat !== undefined) pendingReentrySeat = message.pendingReentrySeat;
        if (message.turnCount !== undefined) turnCount = message.turnCount;
        if (message.activationUsed !== undefined) activationUsed = message.activationUsed;
        if (message.collectedTreasures) collectedTreasures = message.collectedTreasures.map((item) => ({ ...item }));
        if (message.settledSafeCells) settledSafeCells = new Set(message.settledSafeCells);
        if (message.triggeredNormalCells) triggeredNormalCells = new Set(message.triggeredNormalCells);
        if (message.bombStatuses) bombStatuses = message.bombStatuses.map((bomb) => ({ ...bomb }));
        if (message.publicExplosions) publicExplosions = message.publicExplosions.map((entry) => ({ ...entry, affectedSeats: [...entry.affectedSeats] }));
        if (message.recentEvents) recentEvents = message.recentEvents.map((entry) => ({ ...entry, affectedSeats: entry.affectedSeats ? [...entry.affectedSeats] : undefined, blastCells: entry.blastCells ? [...entry.blastCells] : undefined }));
        if (message.winner !== undefined) winner = message.winner;
        if (message.finishOutcome !== undefined) finishOutcome = message.finishOutcome;
        if (message.finishReason !== undefined) finishReason = message.finishReason;
        if (message.finalExplosiveReveal !== undefined) finalExplosiveReveal = message.finalExplosiveReveal ? {
          red: { normal: [...message.finalExplosiveReveal.red.normal], timed: message.finalExplosiveReveal.red.timed.map((bomb) => ({ ...bomb })) },
          green: { normal: [...message.finalExplosiveReveal.green.normal], timed: message.finalExplosiveReveal.green.timed.map((bomb) => ({ ...bomb })) },
          triggeredNormal: message.finalExplosiveReveal.triggeredNormal.map((entry) => ({ cell: entry.cell, owners: [...entry.owners] })),
          timedExplosions: message.finalExplosiveReveal.timedExplosions.map((entry) => ({ ...entry, affectedSeats: [...entry.affectedSeats] })),
        } : null;
      }
      render();
    }
    const timer = setInterval(() => { if (phase === "PLACING") render(); }, 1_000);
    render();
    return { receive, destroy() { clearInterval(timer); root.remove(); } };
  }

  window.GameRegistry.register({
    id: "timed-mines",
    name: "定时炸弹扫雷",
    icon: "⏱️",
    description: "埋下地雷和三枚定时炸弹，在看不见雷图的棋盘上争夺宝物。",
    howTo: [
      "双方在 11×11 公共棋盘各放置 12 颗普通地雷，以及编号为 #1、#2、#3 的三颗定时炸弹。确认后位置全部隐藏，请凭记忆行动。",
      "每回合向八个方向移动一格。踩普通雷扣 5 分并返回起点；新安全格按周围普通雷每颗 1 分、尚未爆炸的定时炸弹每颗 2 分结算，全局只结算一次。",
      "自己的正常回合可免费启动至多一颗未启动炸弹，随后仍须移动。炸弹在对手完成两次移动后爆炸，波及中心和周围八格；自己保护区内的棋子免疫爆炸。",
      "三个宝物依次奖励 15、20、25 分，第三个宝物立即结束比赛；否则第 70 次移动及其爆炸结算后结束。高分获胜，同分为平局，终局公开完整爆炸物地图。",
    ],
    create,
  });
})();
