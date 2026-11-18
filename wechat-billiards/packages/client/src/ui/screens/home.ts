import type { GameType } from "@friend-billiards/core";
import { gutter, safeBottom, safeTop } from "../layout";
import type { HudModel } from "../model";
import { colors, radius, typeScale, withAlpha } from "../theme";
import type { Ui } from "../widgets";
import { gameName } from "../format";

const CLIENT_VERSION = "v0.4.0";

interface Card {
  id: string;
  glyph: string;
  title: string;
  subtitle: string;
  locked?: boolean;
}

const homeCards: Card[] = [
  {
    id: "homeClassic",
    glyph: "8",
    title: "经典对战",
    subtitle: "黑八 / 九球 / 斯诺克",
  },
  {
    id: "homeCards",
    glyph: "卡",
    title: "道具模式",
    subtitle: "开局 3 张卡 · 每回合 1 张",
  },
  {
    id: "homeThree",
    glyph: "3",
    title: "三人斯诺克",
    subtitle: "3 人轮转 · 首期斯诺克",
  },
  {
    id: "homePractice",
    glyph: "练",
    title: "单人练习",
    subtitle: "自由摆球 · 即时开局",
  },
];

export function drawHome(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const margin = gutter(layout);
  const top = safeTop(layout);
  const bottom = safeBottom(layout);
  drawHomeBackdrop(ui);

  const logoY = top + 92;
  ui.context.save();
  ui.context.shadowColor = withAlpha(colors.brass400, 0.3);
  ui.context.shadowBlur = 20;
  ui.text("欢畅台球", margin, logoY, typeScale.display, colors.ivory100, "left", 700);
  ui.context.restore();
  ui.context.strokeStyle = withAlpha(colors.brass400, 0.9);
  ui.context.lineWidth = 2;
  ui.context.beginPath();
  ui.context.moveTo(margin + 2, logoY + 34);
  ui.context.lineTo(margin + 150, logoY + 34);
  ui.context.stroke();
  ui.text(
    "3D 物理 · 好友同房 · 公平判定",
    margin + 2,
    logoY + 62,
    20,
    colors.sage300,
  );

  const settingsSize = 48;
  const settingsY = top + 12;
  const settingsX = margin;
  ui.button("settings", "设置", settingsX, settingsY, settingsSize, settingsSize, {
    ghost: true,
    fontSize: 15,
  });
  const onlineX = settingsX + settingsSize + 12;
  const onlineWidth = Math.min(
    layout.compact ? 150 : 180,
    layout.width - margin - onlineX,
  );
  ui.panel(
    onlineX,
    settingsY + 4,
    onlineWidth,
    40,
    0.78,
    radius.pill,
    colors.ink800,
    model.online
      ? withAlpha(colors.success400, 0.4)
      : withAlpha(colors.sage500, 0.3),
  );
  ui.dot(
    onlineX + 18,
    settingsY + 24,
    5,
    model.online ? colors.success400 : colors.sage500,
  );
  ui.text(
    model.online ? "联机可用" : "离线，仅练习",
    onlineX + 32,
    settingsY + 25,
    14,
    model.online ? colors.success400 : colors.sage300,
    "left",
    600,
    onlineWidth - 40,
  );
  ui.buttons.push({
    id: "online",
    label: "在线状态",
    x: onlineX,
    y: settingsY,
    width: onlineWidth,
    height: 44,
  });
  if (!model.online && model.message)
    ui.text(
      model.message,
      layout.width - margin,
      settingsY + 56,
      13,
      withAlpha(colors.danger400, 0.9),
      "right",
      500,
      300,
    );

  const cardsTop = top + 238;
  if (model.continueRoom) {
    const width = 250;
    ui.panel(
      margin,
      cardsTop - 46,
      width,
      36,
      0.86,
      radius.pill,
      colors.ink800,
      withAlpha(colors.brass400, 0.45),
    );
    ui.dot(margin + 18, cardsTop - 28, 4, colors.brass300);
    ui.text(
      `继续房间 ${model.continueRoom.roomCode}`,
      margin + 30,
      cardsTop - 27,
      15,
      colors.brass300,
      "left",
      600,
      width - 40,
    );
    ui.buttons.push({
      id: "continueRoom",
      label: "继续房间",
      x: margin,
      y: cardsTop - 46,
      width,
      height: 36,
    });
  }

  const gap = 16;
  const cardWidth = layout.compact
    ? (layout.width - margin * 2 - gap) / 2
    : 264;
  const cardHeight = layout.compact ? 116 : 132;
  homeCards.forEach((card, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + column * (cardWidth + gap);
    const y = cardsTop + row * (cardHeight + gap);
    drawHomeCard(ui, card, x, y, cardWidth, cardHeight);
  });

  const buttonWidth = layout.compact ? 480 : 360;
  const baseY = layout.height - bottom - 148;
  ui.button("friend", "创建 / 加入好友房", margin, baseY, buttonWidth, 68, {
    accent: true,
    fontSize: 22,
  });
  const pillsY = baseY + 12;
  const rulesX = margin + buttonWidth + 16;
  ui.button("rules", "规则", rulesX, pillsY, 120, 44, {
    ghost: true,
    fontSize: 18,
  });
  ui.button("about", "关于", rulesX + 128, pillsY, 100, 44, {
    ghost: true,
    fontSize: 18,
  });

  ui.text(
    "一杆一世界",
    layout.width - margin - 4,
    layout.height - bottom - 42,
    22,
    withAlpha(colors.brass300, 0.65),
    "right",
    600,
  );
  ui.text(
    CLIENT_VERSION,
    layout.width - margin,
    layout.height - bottom - 18,
    typeScale.micro,
    colors.sage500,
    "right",
  );

  if (model.homeSheet) drawHomeSheet(ui, model);
  if (model.settingsOpen) drawSettings(ui, model);
  if (model.showHint) drawHint(ui);
}

function drawHomeBackdrop(ui: Ui) {
  const { layout } = ui;
  const context = ui.context;
  if (layout.compact) {
    const compact = context.createLinearGradient(0, 0, 0, layout.height);
    compact.addColorStop(0, colors.ink900);
    compact.addColorStop(0.55, colors.ink800);
    compact.addColorStop(1, colors.ink950);
    context.fillStyle = compact;
    context.fillRect(0, 0, layout.width, layout.height);
    context.fillStyle = withAlpha(colors.felt600, 0.1);
    context.beginPath();
    context.arc(layout.width * 0.94, -60, 280, 0, Math.PI * 2);
    context.fill();
    return;
  }
  const solidRight = Math.min(660, layout.width * 0.52);
  context.fillStyle = withAlpha(colors.ink950, 0.99);
  context.fillRect(0, 0, solidRight, layout.height);
  const gradient = context.createLinearGradient(
    solidRight,
    0,
    solidRight + 160,
    0,
  );
  gradient.addColorStop(0, withAlpha(colors.ink950, 0.99));
  gradient.addColorStop(0.55, withAlpha(colors.ink950, 0.72));
  gradient.addColorStop(1, withAlpha(colors.ink950, 0));
  context.fillStyle = gradient;
  context.fillRect(solidRight, 0, 160, layout.height);
  const bottom = context.createLinearGradient(0, layout.height - 140, 0, layout.height);
  bottom.addColorStop(0, withAlpha(colors.ink950, 0));
  bottom.addColorStop(1, withAlpha(colors.ink950, 0.92));
  context.fillStyle = bottom;
  context.fillRect(0, layout.height - 140, layout.width, 140);
}

function drawHomeCard(
  ui: Ui,
  card: Card,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ui.context.save();
  if (card.locked) ui.context.globalAlpha = 0.52;
  ui.panel(
    x,
    y,
    width,
    height,
    0.9,
    radius.card,
    colors.ink800,
    withAlpha(colors.ivory100, 0.12),
  );
  const icon = 40;
  ui.panel(
    x + 18,
    y + (height - icon) / 2 - 6,
    icon,
    icon,
    0.9,
    radius.control,
    colors.felt800,
    withAlpha(colors.sage300, 0.3),
  );
  ui.text(
    card.glyph,
    x + 18 + icon / 2,
    y + (height - icon) / 2 + 15,
    22,
    colors.brass300,
    "center",
    700,
  );
  const textX = x + 18 + icon + 14;
  ui.text(
    card.title,
    textX,
    y + height / 2 - 14,
    24,
    colors.ivory100,
    "left",
    700,
    width - (textX - x) - 16,
  );
  ui.text(
    card.subtitle,
    textX,
    y + height / 2 + 16,
    15,
    card.locked ? colors.sage500 : colors.sage300,
    "left",
    500,
    width - (textX - x) - 16,
  );
  ui.text(
    "→",
    x + width - 18,
    y + height - 22,
    20,
    card.locked ? colors.sage500 : colors.brass300,
    "right",
    600,
  );
  ui.context.restore();
  ui.buttons.push({
    id: card.id,
    label: card.title,
    x,
    y,
    width,
    height,
  });
}

function drawHomeSheet(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const mode = model.homeSheet ?? "classic";
  const height = mode === "cards" || mode === "three" ? 380 : 300;
  const progress = Math.max(0, Math.min(1, model.homeSheetProgress ?? 1));
  const eased = 1 - Math.pow(1 - progress, 3);
  const y = layout.height - height * eased;
  ui.modal(
    { x: 0, y, width: layout.width, height },
    {
      maskId: "homeSheetMask",
      radius: 0,
      opacity: 0.985,
      stroke: withAlpha(colors.ivory100, 0.14),
    },
  );
  ui.drawerHandle(0, y, layout.width);
  const title =
    mode === "practice"
      ? "单人练习"
      : mode === "cards"
        ? "道具模式"
        : mode === "three"
          ? "三人斯诺克"
          : "经典对战";
  ui.text(title, layout.width / 2, y + 44, typeScale.h2, colors.ivory100, "center", 700);
  ui.text(
    mode === "practice"
      ? "选择玩法后直接开局，可随时重新摆球"
      : mode === "cards"
        ? "每回合最多 1 张卡；明牌、无隐藏随机"
        : mode === "three"
          ? "3 名玩家固定轮转，犯规罚给下一家"
          : "选择玩法，开始练习或创建好友房",
    layout.width / 2,
    y + 76,
    15,
    colors.sage300,
    "center",
    500,
    layout.width - 80,
  );

  if (mode === "three") {
    ui.panel(
      layout.width / 2 - 270,
      y + 104,
      540,
      86,
      0.62,
      radius.card,
      colors.ink800,
      withAlpha(colors.sage300, 0.18),
    );
    ui.text(
      "座位 0 → 1 → 2 轮转 · 分数相同按单杆、进球数排名",
      layout.width / 2,
      y + 138,
      16,
      colors.ivory100,
      "center",
      600,
      500,
    );
    ui.text(
      "三人房需 3 人齐后自动开局；中间退出会跳过其回合",
      layout.width / 2,
      y + 168,
      14,
      colors.sage300,
      "center",
      500,
      500,
    );
    ui.button("homeCreate", "创建三人房", layout.width / 2 - 180, y + 210, 360, 60, {
      accent: true,
    });
    ui.button("homeClose", "返回", layout.width / 2 - 70, y + 326, 140, 36, {
      ghost: true,
      fontSize: 18,
    });
    return;
  }

  const gameTypes: GameType[] = ["eightball", "nineball", "snooker"];
  const pillWidth = 150;
  const gap = 16;
  const startX = (layout.width - pillWidth * 3 - gap * 2) / 2;
  gameTypes.forEach((gameType, index) => {
    ui.pill(
      `homeGame:${gameType}`,
      gameName(gameType),
      startX + index * (pillWidth + gap),
      y + 102,
      pillWidth,
      48,
      model.homeGameType === gameType,
    );
  });

  if (mode === "cards") {
    ui.text("手牌数量", startX, y + 184, 15, colors.sage300, "left", 600);
    const counts = [0, 1, 2, 3, 4, 5, 6];
    const countWidth = 46;
    const countGap = 10;
    const countX =
      layout.width / 2 - (countWidth * counts.length + countGap * (counts.length - 1)) / 2;
    counts.forEach((count, index) => {
      ui.pill(
        `createCardCount:${count}`,
        String(count),
        countX + index * (countWidth + countGap),
        y + 168,
        countWidth,
        38,
        model.createCardCount === count,
      );
    });
    ui.text(
      model.createCardCount === 0
        ? "0 张 = 关闭卡牌，等价经典模式"
        : "双方开局各发 N 张明牌，每回合最多用 1 张",
      layout.width / 2,
      y + 226,
      14,
      colors.sage500,
      "center",
      500,
      layout.width - 90,
    );
    ui.button("homeStart", "开始练习", layout.width / 2 - 286, y + 252, 270, 60, {
      accent: true,
    });
    ui.button("homeCreate", "创建好友房", layout.width / 2 + 16, y + 252, 270, 60);
    ui.button("homeClose", "返回", layout.width / 2 - 70, y + 326, 140, 36, {
      ghost: true,
      fontSize: 18,
    });
    return;
  }

  if (mode === "practice") {
    ui.button("homeStart", "开始练习", layout.width / 2 - 180, y + 182, 360, 60, {
      accent: true,
    });
  } else {
    ui.button("homeStart", "开始练习", layout.width / 2 - 286, y + 182, 270, 60, {
      accent: true,
    });
    ui.button("homeCreate", "创建好友房", layout.width / 2 + 16, y + 182, 270, 60);
  }
  ui.button("homeClose", "返回", layout.width / 2 - 70, y + 254, 140, 36, {
    ghost: true,
    fontSize: 18,
  });
}
function drawSettings(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const width = Math.min(520, layout.width - 80);
  const height = 420;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.modal(
    { x, y, width, height },
    { maskId: "settingsMask", stroke: withAlpha(colors.ivory100, 0.16) },
  );
  ui.text("设置", layout.width / 2, y + 46, typeScale.h2, colors.ivory100, "center", 700);

  const rowX = x + 32;
  const rowWidth = width - 64;
  const rowY = y + 92;
  ui.text("音效", rowX, rowY, 18, colors.ivory100, "left", 600);
  ui.pill("sound", model.soundOn ? "开" : "关", rowX + rowWidth - 100, rowY - 20, 100, 40, model.soundOn);

  ui.text("减少动态效果", rowX, rowY + 58, 18, colors.ivory100, "left", 600);
  ui.pill(
    "motion",
    model.reduceMotion ? "开" : "关",
    rowX + rowWidth - 100,
    rowY + 38,
    100,
    40,
    model.reduceMotion,
  );

  ui.text("画质", rowX, rowY + 124, 18, colors.ivory100, "left", 600);
  ui.tabs(
    "quality",
    [
      { id: "high", label: "高" },
      { id: "medium", label: "中" },
      { id: "low", label: "低" },
    ],
    rowX + rowWidth - 264,
    rowY + 104,
    264,
    42,
    model.quality,
  );

  ui.button("license", "关于与许可", rowX, y + height - 96, 200, 44, {
    ghost: true,
    fontSize: 16,
  });
  ui.button("settingsClose", "关闭", x + width - 212, y + height - 96, 180, 44, {
    accent: true,
    fontSize: 18,
  });
}

function drawHint(ui: Ui) {
  const { layout } = ui;
  const width = Math.min(580, layout.width - 80);
  const height = 340;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.modal(
    { x, y, width, height },
    { maskId: "hintMask", stroke: withAlpha(colors.brass400, 0.4) },
  );
  ui.text("新手提示", layout.width / 2, y + 50, typeScale.h2, colors.brass300, "center", 700);
  const lines = [
    ["瞄准", "单击台面瞄准，拖动可以粗调方向"],
    ["力度", "拖动左侧力度条，松手前可上下调整"],
    ["微调", "右侧微调条修正角度，幅度 ±6°"],
  ];
  lines.forEach(([title, text], index) => {
    const lineY = y + 108 + index * 64;
    ui.dot(x + 48, lineY, 4, colors.brass300);
    ui.text(title, x + 64, lineY, 18, colors.ivory100, "left", 700);
    ui.text(text, x + 110, lineY, 16, colors.sage300, "left", 500, width - 150);
  });
  ui.button("dismissHint", "知道了", layout.width / 2 - 110, y + height - 72, 220, 48, {
    accent: true,
    fontSize: 18,
  });
}
