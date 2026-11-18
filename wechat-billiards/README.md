# 欢畅台球

微信小游戏 3D 台球工程，支持黑八、九球、斯诺克、单人练习、双人好友房、道具模式（18 张卡）和三人斯诺克。客户端与权威服务器共享确定性物理及规则核心，服务端负责回合、犯规、计分、卡牌结算和胜负。

本项目修改并复用了 `tailuge/billiards`，整体采用 GPL-3.0-only。它不是腾讯产品，不包含腾讯商标、美术、音频或私有协议。

## 玩法与模式

- 经典对战：黑八、九球、斯诺克；建好友房后先试玩，好友到齐 3 秒倒计时开局。
- 道具模式：建房时选择玩法与手牌数 0–6（默认 3）；明牌、每回合最多 1 张，效果写入权威快照。
- 三人斯诺克：固定 3 座轮转，犯规罚下一家，按总分/单杆/进球数排名；仅斯诺克。
- 单人练习：自由摆球、即时重开；道具练习可调手牌数并重新发牌。

详细规则见 `docs/RULES.md`。

## 本地启动

要求 Node.js 24、Corepack、Git Bash（Windows）或兼容 shell。

```bash
corepack enable
corepack yarn install
corepack yarn dev:server
```

另开终端：

```bash
corepack yarn dev:web
```

打开 `http://localhost:8081`。浏览器预览只用于开发，不代替微信开发者工具和真机验收。

## 构建与验证

```bash
corepack yarn lint
corepack yarn test
corepack yarn test:protocol
corepack yarn test:e2e
corepack yarn build
corepack yarn source:archive
```

- 浏览器输出：`apps/web-preview/dist/`
- 微信小游戏项目：`apps/minigame/`，先构建再用微信开发者工具导入。
- 服务端输出及容器入口：`apps/server/dist/index.cjs`、`apps/server/Dockerfile`
- 对应源码归档：`release/friend-billiards-corresponding-source.tar.gz`

## 微信配置

开发构建默认使用测试号和本机服务。正式构建前设置：

```bash
export CLOUDBASE_ENV_ID="你的环境 ID"
export CLOUDBASE_SERVICE="hc-billiards"
export SOURCE_URL="你的真实公开对应源码地址"
export LOCAL_SERVER_URL="ws://开发机局域网IP:8080/ws"
corepack yarn build:minigame
```

把 `apps/minigame/project.config.json` 的 `appid` 改为**游戏类目**的正式 AppID，或使用开发者工具导入时选择该 AppID。云托管服务端配置 `WX_APP_ID`、`WX_APP_SECRET`、`CLOUDBASE_ENV_ID`；密钥不得写入客户端或仓库。

详细步骤见：

- `docs/DEPLOYMENT.md`：云托管、数据库和本地联机。
- `docs/PUBLISHING.md`：体验版、资质、GPL 对应源码和提审。
- `docs/RULES.md`：已实现规则及 miss 等边界。
- `docs/PRIVACY.md`：登录标识、会话和房间数据说明。
- `docs/TESTING.md`：自动化与双真机验收清单。
- `UPSTREAM.md`：固定上游 commit 与修改范围。

## 联机安全模型

客户端仅提交瞄准、力度、杆法和母球位置。服务器执行同一物理核心后广播事件及快照；客户端重放并校验状态哈希。击球以唯一 `shotId` 幂等处理，房间使用六位码与随机邀请令牌，断线后保留座位并同步全量状态。

当前云部署设计为**单权威副本**，不要直接扩成多副本。需要扩容时必须先实现跨实例房间迁移、锁和消息一致性。
