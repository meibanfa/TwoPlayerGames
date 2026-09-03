# Render 单实例部署

互坑扫雷的房间和隐藏棋盘保存在 Node.js 进程内存中，因此必须部署为一个实例。不要开启自动扩缩容或增加实例数，也不需要数据库、Redis 或持久磁盘。

## 创建服务

1. 登录 Render，选择 **New → Blueprint**。
2. 连接 `meibanfa/TwoPlayerGames`，让 Render 读取根目录的 `render.yaml`。
3. 确认服务类型为 Web Service、实例数为 1、健康检查为 `/health`。
4. 首次公开试玩分支可临时选择待测功能分支；正式更新应使用 `main`。
5. 等待构建和健康检查通过，再访问 Render 提供的 HTTPS 地址。

也可以使用 [Render Blueprint](https://render.com/deploy?repo=https://github.com/meibanfa/TwoPlayerGames) 创建服务。创建服务需要 Render 账户授权；不要把 API key 或 deploy hook 写入仓库。

## 运行模型

- Render 提供 HTTPS，并把同一公网端口上的 WSS 连接转发给 Node.js。
- 服务监听平台注入的 `PORT`，默认监听地址为 `0.0.0.0`。
- `/health` 返回进程状态、运行时间和当前房间数量。
- 服务端每 30 秒发送 WebSocket ping；浏览器断线后按现有 token 流程重连。
- Render 发送 `SIGTERM` 时，服务器停止接收新连接、关闭 WebSocket，并清理房间计时器。

## 限制

进程重启、重新部署或免费实例休眠会清空所有房间。正在进行的对局无法跨进程重启恢复。这是当前单实例、无数据库 MVP 的明确限制。Render 免费实例闲置后可能休眠，第一次访问需要等待冷启动。

发布后检查：

```bash
curl -fsS https://<service>.onrender.com/health
```

健康响应成功后，使用两个独立浏览器/设备完成创建房间、加入、整局游戏、断线重连和再来一局。
