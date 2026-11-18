# 验收清单

## 自动化

```bash
corepack yarn lint
corepack yarn test
corepack yarn test:protocol
corepack yarn test:e2e
corepack yarn build
```

`test:e2e` 会真实启动 WebSocket 服务并连接两个/三个客户端，验证登录、建房、加入、准备、越权拒绝、双端状态、幂等重试、服务重启恢复、认输、卡牌发牌/出牌/回合限制、三人热身/开局/轮转/退出排名。

真实 Chrome/WebGL 验收时，先启动本地服务、`dev:web` 和带 `--remote-debugging-port=9222` 的 Chrome，再运行 `node scripts/browser-smoke.mjs`。脚本会实际点击黑八练习和击球，检查 16 球与击球序号，并输出 `artifacts/eightball-aim.png`、`artifacts/eightball-after-shot.png`。该脚本用于回归 HUD 清空 3D 颜色缓冲等纯编译无法发现的问题。

## 道具模式与三人模式（0.4.0）

- `packages/core/src/cards.test.ts`：18 张卡的玩法过滤、发牌确定性、效果聚合与上限、本杆/回合过期、护盾、续命、移球、红球雨、号令、复制、无效目标不消耗。
- `apps/server/src/rooms.test.ts`：卡牌房发牌与双端广播、同回合第二张拒绝、三人房 1→2→3 人状态迁移、轮转、退出后继续、结算排名。
- `test:e2e`：`cards-deal-play`、`cards-turn-limit`、`three-warmup`、`three-start-rotation`、`three-exit-ranking`。
- 视觉验收：`artifacts/visual/` 下每个尺寸新增 `home-cards`、`home-three`、`game-3p`、`game-3p-over`、`game-cards`、`game-cards-online`、`game-card-detail`、`game-cards-menu`。

手工重点：

- [ ] 双人道具黑八/九球/斯诺克各完成一局；每张卡至少使用一次。
- [ ] 无效目标、对手无手牌、无可移除效果时卡牌退回，不消耗回合。
- [ ] 手牌 0/3/6 张布局不遮挡击球按钮；详情文字可读；对手明牌可见。
- [ ] 三人斯诺克完整一局：三卡轮转、犯规罚下一家、并列排名、退出/断线等待、再来一局。
- [ ] 第 3 人在倒计时内退出时回到两人热身；第 2 人退出时回到房主试玩。

## 微信开发者工具

- [ ] 使用游戏类目 AppID 导入 `apps/minigame/`，编译无错误。
- [ ] 黑八、九球、斯诺克均显示完整球桌和正确球数。
- [ ] 触摸瞄准、力度、杆法、自由球、视角切换可用，没有明显坐标偏移。
- [ ] 云登录、建房、准备、击球、结算、再来一局可用。
- [ ] 控制台无 AppSecret、session_key、登录 code 或会话令牌。

## 两台真机

至少一台 iOS 和一台 Android，使用两个微信体验账号：

- [ ] A 建房并分享，B 从微信卡片直接进入同一房间。
- [ ] 双方准备后交替完成一整局黑八，球的位置、回合、犯规和胜负一致。
- [ ] 完成九球合法九号球获胜、犯规重摆，以及斯诺克红彩得分、罚分、彩球复位关键残局。
- [ ] 自由球不能重叠或越界；斯诺克只能在 D 区摆放。
- [ ] 一方切后台、锁屏、断 Wi-Fi 后恢复，座位保留且全量状态一致。
- [ ] 双方确认再来一局，比分和球桌重置。
- [ ] 卡牌房验证发牌、出牌、效果过期和双端哈希一致。
- [ ] 三人斯诺克验证三端分数、轮转、退出排名和房主转移。
- [ ] 音效、静音、振动、横屏和不同宽高比正常。
- [ ] 中低性能设备斯诺克 22 球场景保持可玩；记录帧率、内存和包体，必要时降低阴影/分辨率档位。
- [ ] 关闭开发者工具“不校验请求域名/TLS”后，云托管链路仍正常。

## 发布阻断项

任何双端比分不一致、击球重复结算、断线丢局、分享无法进入、正式登录失败或许可地址无效都不能视为发布完成。云部署、双真机和上传提审需要正式 AppID 与账号权限，不能用本地自动化结果替代。
