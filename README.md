# 双人小游戏

和朋友开个房间，来一局。

当前唯一游戏是 **互坑扫雷**：两位玩家分别为对手埋下 15 颗雷，交换地图后同时扫雷。没有第一步保护；踩雷不会出局，但会增加 10 秒罚时。完成后服务器会保留短暂结算窗口，并按有效用时（扫雷用时加罚时）判定胜负。

## 本地运行

要求 Node.js 20+。

```bash
npm ci
npm start
# 打开 http://localhost:8777
```

`npm test` 运行 smoke、纯逻辑和 WebSocket 权威状态测试；`npm run lint` 运行 ESLint；`npm run test:e2e` 运行 Playwright（需要 `npx playwright install chromium`）；`npm run verify` 依次运行 lint、Node 测试和浏览器测试。

## 架构

浏览器使用原生 HTML/CSS/JavaScript。`js/registry.js` 保留可扩展的游戏注册表，游戏模块位于 `js/games/`。`server.js` 提供静态文件、房间码、重连、重新开始和 `gameAction` 协议。

互坑扫雷不使用旧游戏的确定性 move relay：服务器保存双方布雷、揭示、旗子、罚时和阶段时间。客户端只提交布雷/插旗/翻格意图，服务器只返回该玩家获知的数字、已揭示格和进度，因此对手雷坐标不会出现在 WebSocket payload 或重连状态中，直到比赛结束。断线后房间保留 45 秒，计时继续；刷新会使用会话 token 重连，不会重置罚时或服务器时间戳。

## 添加未来游戏

创建 `js/games/<id>.js`，调用 `GameRegistry.register({ id, name, description, howTo, create })`，在 `index.html` 按 `registry → logic → game → net → main` 顺序加载，并在服务器明确处理任何隐藏信息。为纯规则新增 `tests/*.test.js`，为房间流程新增 `tests/*-it.js`。保持界面为简体中文、移动端可用，并先阅读 `docs/ARCHITECTURE.md`。

## 许可证

MIT，保留原项目署名。
