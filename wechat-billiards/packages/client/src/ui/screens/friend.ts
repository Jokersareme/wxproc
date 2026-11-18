import type { GameType } from "@friend-billiards/core";
import { gutter, safeBottom, safeTop } from "../layout";
import type { HudModel } from "../model";
import { colors, radius, typeScale, withAlpha } from "../theme";
import type { Ui } from "../widgets";
import { gameName } from "../format";

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
    layout.width - margin * 2,
  );

  ui.text("创建房间", margin, top + 214, 18, colors.brass300, "left", 600);
  const gap = 16;
  const cardWidth = (layout.width - margin * 2 - gap * 2) / 3;
  const cardHeight = 96;
  const gameTypes: GameType[] = ["eightball", "nineball", "snooker"];
  gameTypes.forEach((gameType, index) => {
    const x = margin + index * (cardWidth + gap);
    const disabled = !model.online || model.creating;
    ui.button(
      `create:${gameType}`,
      model.creating ? "创建中…" : `创建${gameName(gameType)}房`,
      x,
      top + 238,
      cardWidth,
      cardHeight,
      {
        disabled,
        fontSize: 20,
      },
    );
  });

  ui.text("预测线", margin, top + 376, 18, colors.brass300, "left", 600);
  ui.text(
    "0 档关闭，1–5 档距离递增；联机时由房主设置",
    margin + 82,
    top + 376,
    15,
    colors.sage500,
    "left",
    500,
    layout.width - margin * 2 - 82,
  );
  const levelWidth = 78;
  for (let level = 0; level <= 5; level += 1) {
    ui.pill(
      `prediction:${level}`,
      level === 0 ? "关闭" : `${level} 档`,
      margin + level * (levelWidth + 8),
      top + 398,
      levelWidth,
      44,
      model.createPredictionLevel === level,
    );
  }

  ui.panel(
    margin,
    top + 474,
    layout.width - margin * 2,
    96,
    0.82,
    radius.card,
    colors.ink800,
    withAlpha(colors.sage300, 0.18),
  );
  ui.text("已有房间码？", margin + 24, top + 506, 18, colors.ivory100, "left", 600);
  ui.text(
    "输入六位数字，或粘贴好友发来的邀请链接",
    margin + 24,
    top + 536,
    15,
    colors.sage300,
  );
  ui.button(
    "join",
    "输入房间码加入",
    layout.width - margin - 264,
    top + 494,
    240,
    56,
    { accent: true, fontSize: 18 },
  );

  ui.button("back", "返回大厅", margin, layout.height - bottom - 76, 220, 56, {
    ghost: true,
    fontSize: 18,
  });
  if (model.message)
    ui.text(
      model.message,
      margin + 244,
      layout.height - bottom - 48,
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
