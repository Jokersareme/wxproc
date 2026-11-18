import type { RoomPlayer } from "@friend-billiards/protocol";
import { gutter, roomTableViewport, safeBottom, safeTop } from "../layout";
import type { HudModel } from "../model";
import { colors, radius, surface, withAlpha } from "../theme";
import type { Ui } from "../widgets";
import { gameName, predictionName } from "../format";

export function drawRoom(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const margin = gutter(layout);
  const top = safeTop(layout);
  const bottom = safeBottom(layout);
  drawRoomBackdrop(ui);

  ui.button("back", "← 返回", margin, top + 18, 64, 44, {
    ghost: true,
    fontSize: 15,
  });
  const titleX = margin + 84;
  ui.text("好友房", titleX, top + 40, 24, colors.sage300, "left", 700);
  const labelWidth = ui.measure("好友房", 24, 700);
  ui.monoText(
    model.roomCode ?? "------",
    titleX + labelWidth + 12,
    top + 41,
    40,
    colors.ivory100,
    "left",
    700,
  );
  const codeWidth = 6 * 24;
  ui.button(
    "copyCode",
    "复制",
    titleX + labelWidth + 12 + codeWidth + 12,
    top + 20,
    88,
    40,
    { ghost: true, fontSize: 14 },
  );

  const modeName =
    model.room?.mode === "cards"
      ? "卡牌"
      : model.room?.mode === "threeSnooker"
        ? "三人斯诺克"
        : "经典";
  const pills = [
    `玩法 ${gameName(model.room?.gameType ?? "eightball")}`,
    `模式 ${modeName}`,
    `预测线 ${predictionName(model.room?.predictionLevel)}`,
    `人数 ${model.room?.players.length ?? 0}/${model.room?.maxPlayers ?? 2}`,
  ];
  let pillX = margin;
  pills.forEach((label) => {
    const width = Math.max(110, ui.measure(label, 16, 500) + 30);
    ui.panel(
      pillX,
      top + 80,
      width,
      34,
      0.78,
      radius.pill,
      colors.ink800,
      withAlpha(colors.sage300, 0.18),
    );
    ui.text(label, pillX + width / 2, top + 98, 16, colors.sage300, "center", 500);
    pillX += width + 10;
  });

  const gap = 20;
  const seatWidth = Math.min(420, (layout.width - margin * 2 - gap) / 2);
  const seatHeight = 96;
  const seatY = top + 134;
  const leftSeatX = margin;
  const rightSeatX = layout.width - margin - seatWidth;
  drawSeat(ui, model, model.room?.players[0], leftSeatX, seatY, seatWidth, seatHeight, 0);
  drawSeat(ui, model, model.room?.players[1], rightSeatX, seatY, seatWidth, seatHeight, 1);

  const waiting = (model.room?.players.length ?? 0) < 2;
  const hintY = layout.height - bottom - 142;
  if (model.message)
    ui.text(
      model.message,
      layout.width / 2,
      hintY,
      18,
      model.message.includes("离线") || model.message.includes("失败")
        ? colors.danger400
        : colors.brass300,
      "center",
      600,
      layout.width - margin * 2,
    );
  else
    ui.text(
      waiting ? "等待好友加入…" : "好友已加入，双方准备后开局",
      layout.width / 2,
      hintY,
      18,
      waiting ? colors.sage300 : colors.brass300,
      "center",
      600,
    );
  ui.text(
    waiting
      ? "分享邀请或让好友输入房间码加入"
      : "双方都准备后开始正式对局",
    layout.width / 2,
    hintY + 28,
    15,
    colors.sage500,
    "center",
    500,
    layout.width - margin * 2,
  );

  const buttonY = layout.height - bottom - 86;
  ui.button("leave", "离开房间", margin, buttonY, 200, 56, {
    danger: true,
    fontSize: 18,
  });
  const me = model.room?.players.find(
    (player) => player.playerIndex === model.playerIndex,
  );
  ui.button(
    "ready",
    me?.ready ? "取消准备" : "准备开局",
    layout.width / 2 - 120,
    buttonY,
    240,
    56,
    {
      accent: !waiting && !me?.ready,
      ghost: waiting || Boolean(me?.ready),
      disabled: waiting,
      fontSize: 18,
    },
  );
  ui.button(
    "share",
    "分享邀请",
    layout.width - margin - 200,
    buttonY,
    200,
    56,
    { accent: waiting, ghost: !waiting, fontSize: 18 },
  );
}

function drawSeat(
  ui: Ui,
  model: HudModel,
  player: RoomPlayer | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  index: number,
) {
  if (!player) {
    ui.panel(
      x,
      y,
      width,
      height,
      0.38,
      radius.card,
      colors.ink800,
      withAlpha(colors.sage300, 0.2),
    );
    ui.context.save();
    ui.context.setLineDash?.([6, 6]);
    ui.path(x, y, width, height, radius.card);
    ui.context.strokeStyle = withAlpha(colors.sage300, 0.28);
    ui.context.stroke();
    ui.context.restore();
    ui.text(
      "等待好友加入…",
      x + 24,
      y + 40,
      20,
      colors.sage300,
      "left",
      600,
      width - 40,
    );
    ui.text(
      "分享邀请或输入房间码",
      x + 24,
      y + 68,
      15,
      colors.sage500,
      "left",
      500,
      width - 40,
    );
    ui.dot(x + width - 28, y + 28, 5, withAlpha(colors.sage500, 0.6));
    return;
  }
  const me = player.playerIndex === model.playerIndex;
  const active = player.connected;
  ui.panel(
    x,
    y,
    width,
    height,
    0.88,
    radius.card,
    colors.ink800,
    active
      ? me
        ? withAlpha(colors.brass300, 0.55)
        : withAlpha(colors.sage300, 0.25)
      : withAlpha(colors.danger400, 0.35),
  );
  const avatarColor = me
    ? colors.brass300
    : [colors.player0, colors.player1, colors.player2][index] ?? colors.player1;
  ui.avatar(x + 24, y + (height - 44) / 2, 44, player.displayName, avatarColor, active);
  ui.text(
    player.displayName,
    x + 84,
    y + 34,
    22,
    active ? colors.ivory100 : withAlpha(colors.ivory100, 0.55),
    "left",
    700,
    width - 110,
  );
  const tags = [
    index === 0 ? "房主" : "好友",
    me ? "你" : "",
    player.connected ? "" : "离线",
    player.ready ? "已准备" : "未准备",
  ].filter(Boolean);
  ui.text(
    tags.join(" · "),
    x + 84,
    y + 64,
    15,
    player.connected
      ? player.ready
        ? colors.success400
        : colors.sage300
      : colors.danger400,
    "left",
    500,
    width - 110,
  );
  ui.dot(
    x + width - 26,
    y + 26,
    5,
    player.connected ? colors.success400 : colors.sage500,
  );
}

function drawRoomBackdrop(ui: Ui) {
  const { layout } = ui;
  const context = ui.context;
  const background = context.createLinearGradient(0, 0, 0, layout.height);
  background.addColorStop(0, colors.ink900);
  background.addColorStop(0.28, surface.room);
  background.addColorStop(0.78, surface.room);
  background.addColorStop(1, colors.ink950);
  context.fillStyle = background;
  context.fillRect(0, 0, layout.width, layout.height);

  const table = roomTableViewport(layout);
  const previewWidth = Math.min(780, table.width * 0.72);
  const previewHeight = table.height - 60;
  const preview = {
    x: table.x + (table.width - previewWidth) / 2,
    y: table.y + 40,
    width: previewWidth,
    height: previewHeight,
  };
  const feather = 40;
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "rgba(0, 0, 0, 1)";
  context.fillRect(
    preview.x + feather,
    preview.y + feather,
    preview.width - feather * 2,
    preview.height - feather * 2,
  );
  const featherTop = context.createLinearGradient(
    0,
    preview.y,
    0,
    preview.y + feather,
  );
  featherTop.addColorStop(0, "rgba(0, 0, 0, 0)");
  featherTop.addColorStop(1, "rgba(0, 0, 0, 1)");
  context.fillStyle = featherTop;
  context.fillRect(preview.x, preview.y, preview.width, feather);
  const featherBottom = context.createLinearGradient(
    0,
    preview.y + preview.height - feather,
    0,
    preview.y + preview.height,
  );
  featherBottom.addColorStop(0, "rgba(0, 0, 0, 1)");
  featherBottom.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = featherBottom;
  context.fillRect(
    preview.x,
    preview.y + preview.height - feather,
    preview.width,
    feather,
  );
  const featherLeft = context.createLinearGradient(
    preview.x,
    0,
    preview.x + feather,
    0,
  );
  featherLeft.addColorStop(0, "rgba(0, 0, 0, 0)");
  featherLeft.addColorStop(1, "rgba(0, 0, 0, 1)");
  context.fillStyle = featherLeft;
  context.fillRect(preview.x, preview.y, feather, preview.height);
  const featherRight = context.createLinearGradient(
    preview.x + preview.width - feather,
    0,
    preview.x + preview.width,
    0,
  );
  featherRight.addColorStop(0, "rgba(0, 0, 0, 1)");
  featherRight.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = featherRight;
  context.fillRect(
    preview.x + preview.width - feather,
    preview.y,
    feather,
    preview.height,
  );
  context.restore();
  const topGradient = context.createLinearGradient(0, 0, 0, 260);
  topGradient.addColorStop(0, withAlpha(colors.ink950, 0.98));
  topGradient.addColorStop(0.7, withAlpha(colors.ink950, 0.82));
  topGradient.addColorStop(1, withAlpha(colors.ink950, 0));
  context.fillStyle = topGradient;
  context.fillRect(0, 0, layout.width, 260);
  const topBlend = context.createLinearGradient(
    0,
    preview.y,
    0,
    preview.y + 50,
  );
  topBlend.addColorStop(0, withAlpha(surface.room, 0.9));
  topBlend.addColorStop(1, withAlpha(surface.room, 0));
  context.fillStyle = topBlend;
  context.fillRect(preview.x, preview.y, preview.width, 50);
  const bottomBlend = context.createLinearGradient(
    0,
    preview.y + preview.height - 50,
    0,
    preview.y + preview.height,
  );
  bottomBlend.addColorStop(0, withAlpha(surface.room, 0));
  bottomBlend.addColorStop(1, withAlpha(surface.room, 0.9));
  context.fillStyle = bottomBlend;
  context.fillRect(
    preview.x,
    preview.y + preview.height - 50,
    preview.width,
    50,
  );
  const bottomGradient = context.createLinearGradient(
    0,
    layout.height - 240,
    0,
    layout.height,
  );
  bottomGradient.addColorStop(0, withAlpha(colors.ink950, 0));
  bottomGradient.addColorStop(0.55, withAlpha(colors.ink950, 0.82));
  bottomGradient.addColorStop(1, withAlpha(colors.ink950, 0.98));
  context.fillStyle = bottomGradient;
  context.fillRect(0, layout.height - 240, layout.width, 240);
}

export function roomTableAvailable(model: HudModel) {
  return Boolean(model.room && model.snapshot);
}
