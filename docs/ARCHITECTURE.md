# 双人小游戏架构

## 平台壳与注册表

`index.html` 是简体中文单页外壳。每个 `js/games/<id>.js` 向 `GameRegistry` 注册 `id`、名称、图标、说明、规则和 `create()`；`js/main.js` 从注册表渲染首页卡片，并按房间的权威 `gameId` 挂载客户端。`js/net.js` 只负责 WebSocket 与重连。

浏览器会话使用 `two-player-games-session`，仅包含 `code`、`seat`、`token`、`gameId` 和玩家名，不包含任何游戏棋盘或雷坐标。

## 通用房间协议

客户端通用消息：

- `create { gameId, playerName }`
- `join { code, playerName }`
- `rejoin { code, seat, token }`
- `gameAction { action, ...intent }`
- `restart`、`leave`

服务器的 `created`、`start`、`rejoined`、`restart` 与游戏状态均携带房间 `gameId`。房间保存权威游戏 ID；加入者在客户端选择的卡片不能改变它。`server.js` 管理房间码、席位 token、45 秒重连宽限、等待房间清理、限制与双票重开，并把 `gameAction` 分派给 `server/games/` 的对应处理器。不支持的 ID 会被拒绝。

每个处理器实现全新状态、开局、动作、重开及按席位 `publicState()`。禁止直接序列化房间或权威状态。重开保留房间和身份，但调用同一个游戏处理器建立全新状态。

## 游戏权威边界

互坑扫雷的纯规则位于 `js/games/minesweeper-duel-logic.js`，服务器处理器位于 `server/games/minesweeper-duel.js`。服务器保存交换后的雷区、揭示、旗子、罚时和时间戳；终局前按席位只返回合法揭示的信息。

遗忘的地雷的纯规则位于 `js/games/forgotten-mines-logic.js`，权威状态机位于 `server/games/forgotten-mines.js`。客户端只能切换本人未确认的雷、确认、请求移动或选择重入。服务器计算命中、动态邻雷分、宝物、位置、回合、分数和终局。确认后该玩家的公开状态不再包含本人雷图；任何阶段都不包含对手雷图，终局也不披露完整布局。

## 状态与清理

通用房间先处于 `WAITING`，第二人加入后由游戏处理器进入其布雷阶段。互坑扫雷为 `PLACING → SWEEPING → FINISHED`；遗忘的地雷为 `PLACING → PLAYING ↔ REENTRY → FINISHED`。断线计时继续，房间在宽限期内保留；到期会通知仍在线玩家、清理全部计时器并删除房间。所有计时器回调都必须验证房间和状态仍是创建它们时的对象，避免旧回调污染重开或已删除房间。

## 测试边界

纯逻辑使用 `node:test`。在线集成以两个真实 WebSocket 客户端检查身份、阶段、伪造动作、超时、重连、重开和结构化隐藏信息。Playwright 使用两个独立浏览器上下文走真实 UI 与 WebSocket，不使用生产调试后门。
