(function () {
  const $ = (id) => document.getElementById(id), views = [$('homeView'), $('lobbyView'), $('gameView')];
  let game, room = null;
  try { room = JSON.parse(localStorage.getItem("minesweeper-duel-session") || "null"); } catch { room = null; }
  function show(view) { views.forEach((v) => v.classList.toggle("hidden", v !== view)); }
  function message(text) { $("lobbyMessage").textContent = text || ""; }
  function connect() { return Net.connect().catch(() => { message("连接服务器失败，请稍后再试。"); throw new Error("connect failed"); }); }
  function sendAction(payload) { Net.send("gameAction", payload); }
  function mount(seat, phase) { const cfg = GameRegistry.get("minesweeper-duel"); game?.destroy?.(); game = cfg.create({ boardEl: $("gameMount"), sendGameAction: sendAction, seat, phase }); }
  function saveRoom(m) { room = { ...room, code: m.code, seat: m.seat, token: m.token || room?.token, playerNames: m.playerNames || room?.playerNames }; localStorage.setItem("minesweeper-duel-session", JSON.stringify(room)); }
  function showRoom(m, phase) { const name = (m.playerNames || room?.playerNames)?.[m.seat] || "玩家 1"; $("roomLabel").textContent = `房间码：${m.code}（${name}）`; show($("gameView")); mount(m.seat, phase); game.receive({ phase, placementDeadline: m.placementDeadline }); }
  function restoreFinished(state) { if (state?.phase !== "FINISHED") return; game?.receive({ phase: "FINISHED", boards: state.boards, result: state.winner === null ? "平局" : state.winner === room?.seat ? "🏆 你赢了！" : "这局是对手赢了" }); $("restartBtn").classList.remove("hidden"); }
  function handleStart(m) { saveRoom(m); showRoom(m, m.phase); }
  $("startBtn").addEventListener("click", async () => { show($("lobbyView")); await connect(); });
  $("backHomeBtn").addEventListener("click", () => show($("homeView")));
  $("createForm").addEventListener("submit", (e) => { e.preventDefault(); Net.send("create", { gameId: "minesweeper-duel", playerName: $("createName").value }); message("正在创建房间…"); });
  $("joinForm").addEventListener("submit", (e) => { e.preventDefault(); Net.send("join", { code: $("roomCode").value, playerName: $("joinName").value }); message("正在加入房间…"); });
  $("leaveBtn").addEventListener("click", () => { Net.send("leave"); Net.disconnect(); game?.destroy?.(); room = null; localStorage.removeItem("minesweeper-duel-session"); show($("homeView")); });
  $("rulesBtn").addEventListener("click", () => $("rulesDialog").showModal()); $("closeRules").addEventListener("click", () => $("rulesDialog").close());
  $("restartBtn").addEventListener("click", () => Net.send("restart"));
  Net.on("created", (m) => { saveRoom(m); showRoom(m, "WAITING"); }); Net.on("roomState", (m) => game?.receive(m)); Net.on("start", handleStart); Net.on("rejoined", (m) => { saveRoom(m); showRoom(m, m.state?.phase); game.receive({ ...m.state, revealedSnapshot: m.state?.revealed }); restoreFinished(m.state); }); Net.on("netup", () => { if (room?.code && room?.token) Net.send("rejoin", { code: room.code, seat: room.seat, token: room.token }); });
  Net.on("gameState", (m) => game?.receive({ ...m, revealedSnapshot: m.revealed })); Net.on("placementState", (m) => game?.receive({ placement: m.placement, phase: "PLACING" })); Net.on("placementLocked", () => game?.receive({ phase: "WAITING_FOR_READY", message: "等待对手完成布雷…" })); Net.on("placementProgress", (m) => { if (m.ready[room?.seat]) game?.receive({ phase: "WAITING_FOR_READY", message: "等待对手完成布雷…" }); }); Net.on("revealResult", (m) => game?.receive({ revealedDelta: m.cells, mistakes: m.mistakes, penalty: m.penalty, phase: "SWEEPING" })); Net.on("progress", (m) => { $("opponentProgress").textContent = `你的进度：${m.mine} / ${m.total} 对手进度：${m.opponent} / ${m.total} 对手失误：${m.opponentMistakes}`; game?.receive({ progress: [m.mine, m.opponent] }); }); Net.on("gameFinished", (m) => { game?.receive({ phase: "FINISHED", boards: m.boards, result: m.winner === null ? "平局" : m.winner === room?.seat ? "🏆 你赢了！" : "这局是对手赢了" }); $("restartBtn").classList.remove("hidden"); }); Net.on("restart", (m) => { $("restartBtn").classList.add("hidden"); mount(room.seat, "PLACING"); game.receive({ phase: "PLACING", placementDeadline: m.placementDeadline }); }); Net.on("error", (m) => { message(m.message); if (String(m.message || "").startsWith("重连失败")) { room = null; localStorage.removeItem("minesweeper-duel-session"); game?.destroy?.(); show($("homeView")); } }); Net.on("opponentDisconnected", () => game?.receive({ message: "对手暂时断开，等待重新连接…" })); Net.on("netretry", () => game?.receive({ message: "正在重新连接…" }));
  if (room?.code && room?.token) { show($("gameView")); connect().catch(() => show($("homeView"))); }
})();
