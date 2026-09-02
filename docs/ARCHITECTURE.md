# 双人小游戏架构

## 平台

`index.html` 是简体中文单页外壳，`js/main.js` 管理首页、创建/加入房间、游戏挂载和网络事件。`js/registry.js` 提供可扩展的 `GameRegistry`；每个未来游戏在 `js/games/` 自注册。`styles.css` 提供桌面和移动端布局。

## 房间协议

客户端发送 `create`、`join`、`gameAction`、`restart`、`rejoin` 和 `leave`。服务器保留房间码、席位 token、玩家名及 45 秒重连宽限期。`restart` 需要双方同意，并建立全新的状态。

## MinesweeperDuel 权威状态

`js/games/minesweeper-duel-logic.js` 是无 DOM 的规则模块：邻居计算、数字、零区 BFS、布雷校验和完成检测。`js/games/minesweeper-duel.js` 只渲染服务器返回的信息。

服务器把 A 的布雷作为 B 的棋盘，把 B 的布雷作为 A 的棋盘。布雷阶段只回传布雷者自己的临时布雷；扫雷阶段只回传请求者翻开的格子、数字、自己旗子和双方进度。完整雷区永远不会进入对手的状态、重连 payload 或广播消息。所有坐标、阶段、旗子、罚时和胜负均由服务器校验和记录。

## 扩展规则

新增隐藏信息游戏时，先提取纯逻辑，再在 `server.js` 添加专用 action handler；除非信息本来就是公开的，不要使用旧的无脑 `move` relay。新增协议必须覆盖非法 action、重连和信息泄漏测试。
