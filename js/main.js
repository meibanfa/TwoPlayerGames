(function () {
  const SESSION_KEY = "two-player-games-session";
  const LEGACY_SESSION_KEY = "minesweeper-duel-session";
  const $ = (id) => document.getElementById(id);
  const views = [$('homeView'), $('lobbyView'), $('gameView')];
  let game = null;
  let room = null;
  let selectedGameId = GameRegistry.all()[0]?.id || null;

  try {
    room = JSON.parse(localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_SESSION_KEY) || "null");
    if (room && !room.gameId) room.gameId = "minesweeper-duel";
    if (room?.gameId) selectedGameId = room.gameId;
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    room = null;
  }

  function show(view) { views.forEach((item) => item.classList.toggle("hidden", item !== view)); }
  function message(text) { $("lobbyMessage").textContent = text || ""; }
  function config(gameId = selectedGameId) { return GameRegistry.get(gameId); }
  function setLobbyReady(ready) { document.querySelectorAll("#createForm button, #joinForm button").forEach((button) => { button.disabled = !ready; }); }
  function connect() { return Net.connect().catch(() => { message("连接服务器失败，请稍后再试。"); throw new Error("connect failed"); }); }
  function sendAction(payload) { Net.send("gameAction", payload); }

  function renderCards() {
    const container = $("gameCards");
    container.replaceChildren(...GameRegistry.all().map((entry) => {
      const card = document.createElement("article");
      card.className = "game-card";
      card.innerHTML = `<div class="game-icon" aria-hidden="true">${entry.icon}</div><div><h2>${entry.name}</h2><p>${entry.description}</p></div><button class="btn primary" type="button">开始游戏</button>`;
      card.querySelector("button").addEventListener("click", () => openLobby(entry.id));
      return card;
    }));
  }

  function updateGameText(gameId) {
    const entry = config(gameId);
    if (!entry) return false;
    selectedGameId = entry.id;
    $("lobbyGameTitle").textContent = entry.name;
    $("lobbyGameDescription").textContent = entry.description;
    $("activeGameTitle").textContent = entry.name;
    $("rulesTitle").textContent = `${entry.name}怎么玩`;
    $("rulesContent").replaceChildren(...entry.howTo.map((text) => { const paragraph = document.createElement("p"); paragraph.textContent = text; return paragraph; }));
    return true;
  }

  async function openLobby(gameId) {
    if (!updateGameText(gameId)) return;
    show($("lobbyView"));
    setLobbyReady(false);
    message("正在连接服务器…");
    try { await connect(); message(""); setLobbyReady(true); } catch { setLobbyReady(false); }
  }

  function mount(gameId, seat, phase, playerNames) {
    const entry = config(gameId);
    if (!entry) { returnToLobby("房间使用了当前版本不支持的游戏。"); return false; }
    updateGameText(gameId);
    game?.destroy?.();
    game = entry.create({ boardEl: $("gameMount"), sendGameAction: sendAction, seat, phase, playerNames });
    return true;
  }

  function saveRoom(messageValue) {
    room = {
      code: messageValue.code ?? room?.code,
      seat: messageValue.seat ?? room?.seat,
      token: messageValue.token || room?.token,
      gameId: messageValue.gameId || room?.gameId,
      playerNames: messageValue.playerNames || room?.playerNames,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(room));
  }

  function clearRoom() {
    room = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  }

  function returnToLobby(reason) {
    const gameId = room?.gameId || selectedGameId;
    clearRoom();
    game?.destroy?.();
    game = null;
    $("restartBtn").classList.add("hidden");
    updateGameText(gameId);
    show($("lobbyView"));
    message(reason);
  }

  function showRoom(messageValue, phase) {
    const gameId = messageValue.gameId || room?.gameId;
    const names = messageValue.playerNames || room?.playerNames;
    const seat = messageValue.seat ?? room?.seat;
    if (!mount(gameId, seat, phase, names)) return;
    const name = names?.[seat] || "玩家";
    $("roomLabel").textContent = `房间码：${messageValue.code || room?.code}（${name}）`;
    show($("gameView"));
  }

  function handleStart(messageValue) {
    saveRoom(messageValue);
    showRoom(messageValue, messageValue.phase);
    game?.receive({ type: "gameState", phase: messageValue.phase, placementDeadline: messageValue.placementDeadline });
  }

  renderCards();
  updateGameText(selectedGameId);
  $("backHomeBtn").addEventListener("click", () => show($("homeView")));
  $("createForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!Net.isOpen()) return message("服务器尚未连接，请稍后再试。");
    Net.send("create", { gameId: selectedGameId, playerName: $("createName").value });
    message("正在创建房间…");
  });
  $("joinForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!Net.isOpen()) return message("服务器尚未连接，请稍后再试。");
    Net.send("join", { code: $("roomCode").value, playerName: $("joinName").value });
    message("正在加入房间…");
  });
  $("leaveBtn").addEventListener("click", () => {
    Net.send("leave");
    Net.disconnect();
    game?.destroy?.();
    game = null;
    clearRoom();
    show($("homeView"));
  });
  $("rulesBtn").addEventListener("click", () => $("rulesDialog").showModal());
  $("closeRules").addEventListener("click", () => $("rulesDialog").close());
  $("restartBtn").addEventListener("click", () => Net.send("restart"));

  Net.on("created", (messageValue) => { saveRoom(messageValue); showRoom(messageValue, "WAITING"); });
  Net.on("start", handleStart);
  Net.on("rejoined", (messageValue) => {
    saveRoom(messageValue);
    if (!showRoom(messageValue, messageValue.state?.phase)) return;
    game.receive({ type: "gameState", ...messageValue.state });
    if (messageValue.state?.phase === "FINISHED") $("restartBtn").classList.remove("hidden");
  });
  Net.on("netup", () => {
    setLobbyReady(true);
    if (room?.code && room?.token) Net.send("rejoin", { code: room.code, seat: room.seat, token: room.token });
  });
  Net.on("netdown", () => setLobbyReady(false));
  Net.on("gameFinished", () => $("restartBtn").classList.remove("hidden"));
  Net.on("restart", (messageValue) => {
    $("restartBtn").classList.add("hidden");
    const gameId = messageValue.gameId || room?.gameId;
    mount(gameId, room.seat, messageValue.phase, room.playerNames);
  });
  Net.on("error", (messageValue) => {
    if (/^(重连失败|对手未能及时重连|房间等待超时|对手已离开房间)/.test(String(messageValue.message || ""))) returnToLobby(messageValue.message);
    else message(messageValue.message);
  });
  Net.onAny((type, messageValue) => {
    if (!game || ["created", "start", "rejoined", "error"].includes(type)) return;
    if (messageValue?.gameId && room?.gameId && messageValue.gameId !== room.gameId) return;
    game.receive?.({ type, ...messageValue });
  });

  if (room?.code && room?.token) { show($("gameView")); connect().catch(() => show($("homeView"))); }
})();
