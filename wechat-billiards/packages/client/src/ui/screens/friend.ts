import type { GameType } from "@friend-billiards/core";
import { gutter, safeBottom, safeTop } from "../layout";
import type { CameraMode, HudModel } from "../model";
import { colors, radius, typeScale, withAlpha } from "../theme";
import type { Ui } from "../widgets";
import { gameName } from "../format";

const createCameraOptions: { id: CameraMode; label: string }[] = [
  { id: "top", label: "2D 俯视" },
  { id: "follow", label: "3D 跟杆" },
  { id: "overview", label: "3D 总览" },
];
const createPlaybackOptions = [
  { id: "1.15", label: "1.15×" },
  { id: "1.5", label: "1.5×" },
  { id: "2", label: "2×" },
];

export function drawFriend(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const margin = gutter(layout);
  const top = safeTop(layout);
  const bottom = safeBottom(layout);
  drawBackdrop(ui);

  ui.button("back", "← 返回", margin, top + 28, 100, 44, {
    ghost: true,
    fontSize: 16,
  });
  ui.text("好友联机", margin, top + 112, typeScale.h1, colors.ivory100, "left", 700);
  ui.text(
    model.online
      ? "联机可用 · 选择玩法建房，或输入六位房间码加入"
      : "离线 · 正在连接联机服务…",
    margin,
    top + 156,
    18,
    model.online ? colors.sage300 : withAlpha(colors.danger400, 0.9),
    "left",
    500,
    layout.width - margin * 2 - 280,
  );
  ui.button(
    "join",
    "输入房间码加入",
    layout.width - margin - 250,
    top + 102,
    250,
    56,
    { accent: true, fontSize: 18 },
  );

  ui.text("创建房间", margin, top + 188, 18, colors.brass300, "left", 600);
  const modeOptions = [
    { id: "classic", label: "经典" },
    { id: "cards", label: "道具" },
    { id: "threeSnooker", label: "三人" },
  ];
  modeOptions.forEach((option, index) => {
    ui.pill(
      `createMode:${option.id}`,
      option.label,
      layout.width - margin - (3 - index) * 86,
      top + 172,
      78,
      38,
      model.createMode === option.id,
    );
  });

  const cardWidth = (layout.width - margin * 2 - 32) / 3;
  if (model.createMode === "threeSnooker") {
    ui.button(
      "create:snooker",
      model.creating ? "创建中…" : "创建三人斯诺克房",
      margin,
      top + 216,
      layout.width - margin * 2,
      84,
      { disabled: !model.online || model.creating, fontSize: 20 },
    );
  } else {
    const gameTypes: GameType[] = ["eightball", "nineball", "snooker"];
    gameTypes.forEach((gameType, index) => {
      const x = margin + index * (cardWidth + 16);
      const disabled = !model.online || model.creating;
      ui.button(
        `create:${gameType}`,
        model.creating
          ? "创建中…"
          : `创建${gameName(gameType)}房`,
        x,
        top + 216,
        cardWidth,
        84,
        { disabled, fontSize: 20 },
      );
    });
  }

  if (model.createMode === "cards") {
    ui.text("手牌数量", margin, top + 330, 15, colors.sage300, "left", 600);
    const counts = [0, 1, 2, 3, 4, 5, 6];
    counts.forEach((count, index) => {
      ui.pill(
        `createCardCount:${count}`,
        String(count),
        margin + 96 + index * 56,
        top + 312,
        48,
        38,
        model.createCardCount === count,
      );
    });
    ui.text(
      model.createCardCount === 0
        ? "0 张 = 关闭卡牌，等价经典模式"
        : "双方各发 N 张明牌，每回合最多 1 张",
      margin + 96 + counts.length * 56 + 8,
      top + 330,
      14,
      colors.sage500,
      "left",
      500,
      layout.width - margin * 2 - 96 - counts.length * 56 - 8,
    );
  }

  const settingsY = top + 366;
  const settingsWidth = layout.width - margin * 2;
  ui.panel(
    margin,
    settingsY,
    settingsWidth,
    176,
    0.82,
    radius.card,
    colors.ink800,
    withAlpha(colors.sage300, 0.18),
  );
  ui.text("房间设置", margin + 20, settingsY + 24, 17, colors.ivory100, "left", 600);
  ui.text(
    "房主决定 · 加入后自动同步",
    margin + settingsWidth - 20,
    settingsY + 24,
    14,
    colors.sage500,
    "right",
    500,
    settingsWidth - 150,
  );

  const rowLabelX = margin + 20;
  const rowPillX = margin + 96;
  ui.text("预测线", rowLabelX, settingsY + 62, 15, colors.ivory100, "left", 600);
  for (let level = 0; level <= 5; level += 1) {
    ui.pill(
      `prediction:${level}`,
      level === 0 ? "关闭" : `${level} 档`,
      rowPillX + level * 58,
      settingsY + 44,
      52,
      38,
      model.createPredictionLevel === level,
    );
  }

  ui.text("快速播放", rowLabelX, settingsY + 108, 15, colors.ivory100, "left", 600);
  createPlaybackOptions.forEach((option, index) => {
    ui.pill(
      `createPlayback:${option.id}`,
      option.label,
      rowPillX + index * 78,
      settingsY + 90,
      72,
      38,
      String(model.createPlaybackSpeed) === option.id,
    );
  });

  ui.text("可用视角", rowLabelX, settingsY + 154, 15, colors.ivory100, "left", 600);
  createCameraOptions.forEach((option, index) => {
    ui.pill(
      `createCameraView:${option.id}`,
      option.label,
      rowPillX + index * 112,
      settingsY + 136,
      104,
      38,
      model.createCameraViews.includes(option.id),
    );
  });
  ui.text(
    model.createMode === "threeSnooker"
      ? "三人房固定 3 个座位，第三人加入后 3 秒自动开局"
      : "房间码加入自动带邀请令牌，无需再次输入",
    margin,
    settingsY + 204,
    13,
    colors.sage500,
    "left",
    500,
    settingsWidth,
  );

  ui.button("back", "返回大厅", margin, layout.height - bottom - 70, 220, 56, {
    ghost: true,
    fontSize: 18,
  });
  if (model.message)
    ui.text(
      model.message,
      margin + 244,
      layout.height - bottom - 42,
      17,
      model.message.includes("失败") || model.message.includes("不存在")
        ? colors.danger400
        : colors.brass300,
      "left",
      600,
      layout.width - margin * 2 - 244,
    );
}
function drawBackdrop(ui: Ui) {
  const { layout } = ui;
  const context = ui.context;
  const gradient = context.createLinearGradient(0, 0, 0, layout.height);
  gradient.addColorStop(0, colors.ink900);
  gradient.addColorStop(0.55, colors.ink800);
  gradient.addColorStop(1, colors.ink950);
  context.fillStyle = gradient;
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = withAlpha(colors.felt600, 0.08);
  context.beginPath();
  context.arc(layout.width * 0.86, layout.height * 0.18, 280, 0, Math.PI * 2);
  context.fill();
}
