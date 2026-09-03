# 参与贡献

感谢参与“双人小游戏”。开始前请阅读 [AGENTS.md](AGENTS.md) 与 [架构说明](docs/ARCHITECTURE.md)。

## 本地开发

```bash
npm ci
npm start
npm run verify
```

要求 Node.js 20+。首次运行浏览器测试前执行 `npx playwright install --with-deps chromium`。

## 提交流程

从里程碑基线创建功能分支，使用 `feat:`、`fix:`、`test:`、`docs:`、`refactor:` 等简短前缀形成聚焦提交。完成全部范围后运行 `npm run verify`，再以原始基线执行独立审查：

```bash
npm run review -- --base <milestone-base>
```

修复有效的 P0/P1/P2 问题并重复验证与新审查，直到 PASS 后再推送一个分支并创建一个 PR。不要自动合并。

## 新游戏要求

客户端游戏通过 `GameRegistry` 注册，服务端在 `server/games/` 使用独立权威处理器。隐藏信息不得由客户端决定或进入未授权的状态、重连 payload、DOM、存储或日志。所有用户界面保持简体中文；房间流程必须用两个真实 WebSocket 客户端和两个独立浏览器上下文测试。

贡献内容按项目 MIT 许可证发布。
