# 欢畅台球工作记录

更新时间：2026-11-17

## 1. 当前状态

工程已经完成本地可玩、权威服务器云端部署、微信开发者工具登录及云端建房验证。当前尚未完成双微信客户端完整对局验收，也没有正式发布。

下一步是上传并设置最新体验版，由两个不同微信号通过分享邀请进入同一房间，验证准备、击球、比分、断线重连和再来一局。

## 2. 名称与配置

| 项目 | 当前值 |
| --- | --- |
| 游戏中文名 | 欢畅台球 |
| 小游戏 AppID | `wx0514d6d8dc01e758` |
| 云托管服务名 | `hc-billiards` |
| 云环境 ID | `cloud1-d9gpsduw019b04ff0` |
| 数据库集合 | `billiards_rooms` |
| 源码目录 | `D:/GS/AI_WORK/KIMI/others/game/wxproc/wechat-billiards` |
| 公开仓库 | `https://github.com/Jokersareme/wxproc` |
| 当前游戏代码提交 | `f5dfa4205ede3a49829bfbb400351ea2823feb57` |
| 当前代码对应源码 | `https://github.com/Jokersareme/wxproc/tree/f5dfa4205ede3a49829bfbb400351ea2823feb57/wechat-billiards` |

`friend-billiards` 是早期内部工程和产物名称，`wechat-billiards` 是源码目录名，`hc-billiards` 是云服务名。三者用途不同，不影响运行。客户端和云端的 `hc-billiards` 服务名已经一致。

`wxproc` 已初始化为独立 Git 仓库，用于以后存放其他微信小程序或小游戏。它不是上层 `KIMI` 仓库的一部分，不要推送上层目录。

## 3. 已实现功能

- 黑八、九球、15 红球斯诺克和单人练习。
- 固定 `1/512` 秒物理步长、犯规、自由球、重摆、计分、胜负及确定性快照哈希。
- Three.js 球桌、球号和花色、球杆、瞄准线、击球动画、触摸力度及杆法。
- 真实贯穿袋口、袋腔、皮革袋唇、分段库边和圆角袋角。
- 3D 倾斜视角与 2D 俯视切换；横屏 2D 球台长边水平，独立视口避开顶部、底部和两侧控件。
- 左侧竖向力度条、右侧竖向瞄准微调滑轮；单击台面直接瞄准，拖动时方向跟随手指。
- 球体按实际位移滚动，静止球不再自转。
- 自由球可连续拖动白球调整，权威快照保留重摆资格并兼容旧快照，实际击球后清除。
- 二人好友房、六位房间码、随机邀请令牌、准备、认输、双方再来一局。
- 服务端权威击球、幂等重试、断线座位保留、重连和 CloudBase 房间持久化。
- 微信登录、云托管 WebSocket、分享邀请、存储、振动和合成击球音效。
- GPL-3.0 许可证、第三方声明和固定版本公开源码链接。

斯诺克自动 miss/裁判复位没有实现，文档和游戏内需要继续明确这一边界。项目不是腾讯产品，不包含腾讯商标、美术、音频或私有协议，不应宣称与腾讯桌球逐像素或全部运营功能一致。

## 4. 云端部署状态

CloudBase 官方插件已安装到 Kimi Code，新的会话可以加载插件工具。当前会话使用 CloudBase CLI 3.9.3，已登录并选中上述云环境。

云托管服务配置：

- 服务名：`hc-billiards`
- 容器端口：`8080`
- 健康检查：`GET /health`
- WebSocket：`/ws`
- CPU / 内存：1 核 / 2 GB
- 最小 / 最大实例：1 / 1
- 运行方式：固定单实例持续运行
- 环境变量：`NODE_ENV`、`PORT`、`WX_APP_ID`、`WX_APP_SECRET`、`CLOUDBASE_ENV_ID`
- 已开启 `CLOUDBASE_APIKEY` 注入，供服务端 Node SDK 访问数据库

数据库集合 `billiards_rooms` 已创建，权限已设置为 `ADMINONLY`，客户端不能直接读写房间和比分。

健康地址：

```text
https://hc-billiards-349228-8-1534449846.sh.run.tcloudbase.com/health
```

云端服务当前设计为单权威副本，不能直接增加实例。需要扩容时必须先实现跨实例房间迁移、锁和消息一致性。

## 5. 已实际验证

### 本地工程

- `corepack yarn lint`：通过。
- `corepack yarn test`：4 个测试套件、30 项测试全部通过。
- `corepack yarn test:e2e`：真实双 WebSocket 客户端的健康、登录、建房、准备、回合权限、双端击球、幂等、自由球重复摆放、服务重启恢复及认输全部通过。
- `corepack yarn build`：服务器、浏览器和微信端完整构建通过。
- 上游 `tailuge/billiards` 固定 commit 为 `8aeb1dee14e7dccf71b47cdf6f68fc33e5f6459b`；此前上游 lint、98 个测试套件及 871 项测试通过。

### 浏览器与横向俯视

使用真实 Chrome/WebGL 进入黑八练习、切换 2D、操作两侧滑条并执行实际击球：

- 16 球正常显示，击球序号、动画和原 3D 视角正常。
- 2D 独立视口中心 `screenToTable` 映射为 `(0, 0)`，球台不进入上下菜单及两侧控制区。
- 单击和拖动后的实际角度均与“白球到触点”的期望角度完全一致。
- 左侧力度调整到 75%，右侧微调增加 `0.032` 弧度，最终击球输入使用相同力度和角度。
- 最近一次验收有 3 颗静止球，四元数变化均为 0；13 颗移动球按位移产生滚动。
- 通过真实拖动连续把白球放到 `(-0.45, 0.12)` 和 `(-0.6, -0.08)`，随后点击其他位置只瞄准、不移动白球；任意球提示保持显示。

验收截图：`artifacts/eightball-top-horizontal.png`、`artifacts/eightball-ball-in-hand.png`、`artifacts/eightball-table-3d.png`。

### 微信与云端

- 微信开发者工具正式 AppID 导入成功。
- 初次云连接出现 `t.onOpen is not a function` 和错误默认 WebSocket 地址。
- 已按官方接口修复：`connectContainer` 传入 `config.env`、`service`、`path`，并 `await` 取出 `socketTask`。
- 修复后开发者工具没有红色连接错误，微信登录和好友房页面正常。
- 黑八房间创建成功。
- 云端健康检查当时返回 `rooms: 1`。
- 数据库房间计数当时为 1，证明云端登录、WebSocket 和数据库写入链路已打通。
- `0.1.1` 真机首次击球出现 `n.connect(...).connect is not a function`。微信真机的音频节点 `connect()` 不能像浏览器一样链式调用，已在提交 `2ae5939` 中改为分别连接振荡器、增益节点和输出节点。
- 修复后 lint、规则测试及微信端生产构建通过，用户随后已能进入击球并反馈球体滚动和界面问题。

开发者工具仍有黄色提示：Three.js 多实例及 `PCFSoftShadowMap` 自动回退到 `PCFShadowMap`。它们不是当前阻断错误，后续可优化。

## 6. 体验版状态

- `0.1.0` 曾上传并设置为体验版；体验版二维码当时显示在 2026-11-24 前有效。
- `0.1.1` 已能在真机进入游戏，但首次击球存在上述音频报错。
- `0.1.2` 修复真机音频报错，公开源码已推送。
- `0.1.3` 包含袋口、2D 视口、两侧滑条、瞄准、真实滚动及自由球重复摆放改进，客户端和源码归档已构建，提交 `f5dfa42` 已推送。
- `0.1.3` 尚未上传或重新设为体验版。云端打包部署任务被用户停止，新版权威自由球状态尚未部署；云端同步前不能进行新版双微信联机验收。
- 朋友是否已正确加入“体验成员”尚未最终确认。项目成员的运营者、开发者或数据分析权限不应仅为了试玩而开放。
- 尚未完成两个微信号通过分享卡片加入、双方准备和交替击球验证。
- 尚未提交审核或正式发布。

## 7. 密钥安全事项

查询云托管详情时，CLI 原样输出了环境变量，其中包含 AppSecret 和 API Key。用户已决定暂时不轮换。

这并不代表风险为零：这些凭据仍有效，能访问完整会话工具日志的人可能利用它们。不要分享完整会话或工具日志，正式发布前仍应轮换 AppSecret 和 API Key。

任何密钥值都不得写入本文档、客户端、GitHub 或源码归档。公开仓库推送前已检查暂存文件，没有发现密钥文件、本地房间数据、构建产物或依赖缓存。

## 8. 当前构建产物

以下产物均被 Git 忽略，不会上传到公开仓库：

- 微信端：`apps/minigame/dist/game.js`
- 浏览器端：`apps/web-preview/dist/game.js`
- 服务端：`apps/server/dist/index.cjs`
- 对应源码归档：`release/friend-billiards-corresponding-source.tar.gz`
- 云托管部署包：`release/friend-billiards-cloudrun.zip`（上一版；新版打包任务已停止，不能当作 `0.1.3` 部署包）

云托管上传页面要求 ZIP 根目录存在 `Dockerfile`。上一版部署 ZIP 已在根目录加入与 `apps/server/Dockerfile` 相同的文件，原始工程结构不变。

当前微信端构建使用云环境 `cloud1-d9gpsduw019b04ff0`、服务 `hc-billiards` 和提交 `f5dfa42` 的公开源码链接，已检查不包含 AppSecret 或 API Key。

## 9. 下一步操作

1. 经用户确认后重新打包并部署 `f5dfa42` 云端服务，保留现有环境变量和单实例配置，再检查健康接口。
2. 在微信开发者工具中上传 `0.1.3`，备注“优化袋口、2D布局、两侧滑条、触摸瞄准和自由球”，并在公众平台重新设为体验版。
3. 两台手机都使用最新体验版；先检查袋口、2D 遮挡、左侧力度、右侧微调、单击/拖动瞄准、静止球和重复摆球。
4. 确认朋友已加入体验成员，而不是仅获得项目管理权限。
5. 使用两部手机和两个不同微信号；也可使用开发者工具加朋友手机，但身份必须不同。
6. 最新体验版中创建黑八房，通过真实微信分享卡片邀请朋友。
7. 双方准备，各自完成击球，检查球的位置、回合、犯规和比分是否一致。
8. 验证切后台、断网恢复、房间座位保留及全量状态一致。
9. 验证认输、双方再来一局、九球和斯诺克关键规则。
10. 至少完成一台 iOS 和一台 Android 测试后再决定是否提审。
11. 发布前补齐小程序基础信息、备案、隐私说明、名称、头像、简介和所需资质。
12. 正式发布前建议轮换此前输出的密钥，并复核数据库和云托管访问权限。

## 10. 常用命令

在 `wechat-billiards` 目录运行：

```bash
corepack yarn lint
corepack yarn test
corepack yarn test:protocol
corepack yarn test:e2e
corepack yarn build
```

构建当前云端微信端：

```bash
export CLOUDBASE_ENV_ID="cloud1-d9gpsduw019b04ff0"
export CLOUDBASE_SERVICE="hc-billiards"
export SOURCE_URL="https://github.com/Jokersareme/wxproc/tree/f5dfa4205ede3a49829bfbb400351ea2823feb57/wechat-billiards"
corepack yarn build:minigame
corepack yarn source:archive
```

以后代码提交变化时，`SOURCE_URL` 必须更新为新的对应提交，公开仓库应先成功推送，再上传体验版。

查询健康状态：

```bash
curl -fsS https://hc-billiards-349228-8-1534449846.sh.run.tcloudbase.com/health
```

## 11. 协作约定

- 不使用子代理。
- 用户明确要求不使用 KimiCU；后续只使用终端和文件工具，不点击、截图或控制桌面窗口。
- 所有项目文件放在 `wxproc/wechat-billiards`，其他小游戏可放在 `wxproc` 的独立子目录。
- Git 提交和推送只针对 `wxproc` 独立仓库，不操作上层 `KIMI` 仓库。
- 未经用户明确操作，不声称已上传体验版、完成双真机验收或正式发布。
