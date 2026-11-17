# 云托管部署

## 1. 准备账号

1. 在微信公众平台注册小程序账号，一级类目选择“游戏”。该选择不能后改。
2. 完成当前页面要求的主体、管理员和认证流程，在后台获取正式 AppID。
3. 安装稳定版微信开发者工具，以管理员微信扫码。
4. 在开发者工具点击“云开发”，创建开发环境和生产环境，记录各自 EnvID。测试号不能用于正式云部署和发布。

## 2. 部署权威服务

在云托管控制台新建服务，名称使用 `hc-billiards`，代码来源选择本仓库的 `apps/server/Dockerfile`（构建上下文为仓库根目录）。容器监听 `8080`，健康检查为 `GET /health`，WebSocket 路径为 `/ws`。

配置环境变量：

| 变量 | 值 |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `WX_APP_ID` | 游戏类目 AppID |
| `WX_APP_SECRET` | 仅在云控制台设置的 AppSecret |
| `CLOUDBASE_ENV_ID` | 与客户端相同的云环境 ID |

将最小/最大实例数均设为 **1**，启用适合单实例的发布策略。不要在未实现分布式锁前增加副本。

数据库集合名为 `billiards_rooms`，只允许服务端通过 CloudBase SDK 访问，不向客户端开放写权限。服务启动会读取房间快照；每次击球后保存对局、事件和幂等记录。集合需要定期清理长期无人房间，清理策略上线前由运营者确定。

本地 Docker 验证命令（本机安装 Docker 时）：

```bash
docker build -f apps/server/Dockerfile -t friend-billiards .
docker run --rm -p 8080:8080 \
  -e WX_APP_ID=your-appid \
  -e WX_APP_SECRET=your-secret \
  -e CLOUDBASE_ENV_ID=your-env \
  friend-billiards
curl http://localhost:8080/health
```

没有正式微信凭证时不要以 `ALLOW_LOCAL_AUTH=true` 部署生产环境。本地开发可使用默认 LocalIdentityProvider。

## 3. 构建微信端

```bash
export CLOUDBASE_ENV_ID="你的开发环境 ID"
export CLOUDBASE_SERVICE="hc-billiards"
export SOURCE_URL="https://你的公开源码仓库/对应版本"
corepack yarn build:minigame
```

将 `apps/minigame/project.config.json` 的 `appid` 改为正式小游戏 AppID，再导入 `apps/minigame/`。本地无云环境时，构建会使用 `LOCAL_SERVER_URL`（默认 `ws://127.0.0.1:8080/ws`）。真机不能使用电脑的 `127.0.0.1`，需改为开发机局域网 IP，并在调试阶段按微信要求处理网络安全设置。

`wx.cloud.connectContainer` 走微信云托管通道，不需要自行配置普通 WSS 域名。生产环境仍应关闭“开发环境不校验域名/TLS”做一次完整验证。

## 4. 验证

1. 检查 `/health` 返回 `ok: true`。
2. 两个微信号进入体验版，一人建房并分享，另一人从卡片进入。
3. 双方准备，完成击球、犯规、自由球、结算和再来一局。
4. 一方切后台、断网再恢复，确认座位和快照恢复。
5. 重启云托管实例，确认最近落定对局可恢复。正在传输中的非法或重复消息不得改变比分。
