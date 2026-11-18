import type { MatchSnapshot } from "@friend-billiards/core";
import {
  gutter,
  safeBottom,
  safeLeft,
  safeRight,
  safeTop,
  tableViewport,
} from "../layout";
import type { CameraMode, HudModel } from "../model";
import { colors, radius, typeScale, withAlpha } from "../theme";
import type { Ui } from "../widgets";
import {
  gameName,
  groupDots,
  playerSubline,
  targetLabel,
} from "../format";
import { SPIN_LIMIT } from "../../spin";

const SLIDER_TOP = 190;
const SLIDER_HEIGHT = 320;
const SLIDER_WIDTH = 44;
const SIDE_MARGIN = 24;
const SPIN_RADIUS = 120;

export function drawGame(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const snapshot = model.snapshot;
  if (!snapshot) return;
  const top = safeTop(layout);
  const margin = layout.compact ? 84 : 104;

  drawTopBar(ui, model, snapshot, top, margin);
  drawStatus(ui, model, snapshot);
  drawSliders(ui, model);
  drawActions(ui, model, snapshot);

  if (snapshot.phase === "gameOver") drawGameOver(ui, model, snapshot);
  if (model.spinOpen) drawSpinModal(ui, model);
  if (model.menuOpen) drawMenu(ui, model);
  if (model.confirm) drawConfirm(ui, model);
  if (model.eventLogOpen) drawEventLog(ui, model);
  if (model.roomOverlayOpen) drawRoomOverlay(ui, model);
  if (model.roomStatus === "starting") drawCountdown(ui, model);
  if (model.toast) ui.toast(model.toast, top + 150);
  if (model.foulFlashUntil && Date.now() < model.foulFlashUntil) {
    ui.context.save();
    ui.context.strokeStyle = withAlpha(colors.danger400, 0.65);
    ui.context.lineWidth = 6;
    ui.context.strokeRect(3, 3, layout.width - 6, layout.height - 6);
    ui.context.restore();
  }
}

function drawTopBar(
  ui: Ui,
  model: HudModel,
  snapshot: MatchSnapshot,
  top: number,
  margin: number,
) {
  const { layout } = ui;
  const cardHeight = 64;
  const cardWidth = layout.compact ? 300 : 360;
  ui.button("menu", "菜单", safeLeft(layout) + 16, top + 16, 56, 56, {
    ghost: true,
    fontSize: 14,
  });
  const soundX = layout.width - safeRight(layout) - 16 - 56;
  ui.button("sound", "音效", soundX, top + 16, 56, 56, {
    ghost: true,
    fontSize: 14,
  });
  if (!model.soundOn) {
    ui.context.strokeStyle = withAlpha(colors.danger400, 0.9);
    ui.context.lineWidth = 2;
    ui.context.beginPath();
    ui.context.moveTo(soundX + 16, top + 56);
    ui.context.lineTo(soundX + 40, top + 32);
    ui.context.stroke();
  }

  if (snapshot.practice) {
    const width = 520;
    const x = (layout.width - width) / 2;
    const remaining = snapshot.balls.filter(
      (ball) => ball.id !== 0 && ball.state !== "InPocket",
    ).length;
    const trial = model.trial;
    const detail = trial
      ? `${gameName(snapshot.gameType)} · 好友加入后自动开局 · 房间 ${model.roomCode ?? "------"}`
      : snapshot.gameType === "snooker"
        ? `${gameName(snapshot.gameType)} · 剩余 ${remaining} 球 · 单杆 ${snapshot.currentBreak} 分`
        : `${gameName(snapshot.gameType)} · 剩余 ${remaining} 球 · 连续 ${snapshot.currentBreak} 球`;
    ui.panel(
      x,
      top + 16,
      width,
      cardHeight,
      0.88,
      radius.card,
      colors.ink800,
      withAlpha(colors.brass300, 0.55),
    );
    ui.avatar(
      x + 18,
      top + 28,
      40,
      trial ? "试" : "练",
      colors.brass300,
      true,
    );
    ui.text(
      trial ? "试玩中" : "自由练习",
      x + 72,
      top + 38,
      22,
      colors.brass300,
      "left",
      700,
    );
    ui.text(detail, x + 72, top + 62, 15, colors.sage300, "left", 500, width - 100);
    ui.text(
      `第 ${snapshot.shotNumber + 1} 杆`,
      x + width - 18,
      top + 38,
      15,
      colors.brass300,
      "right",
      600,
    );
    return;
  }

  const leftX = margin;
  const rightX = layout.width - margin - cardWidth;
  const players = model.room?.players ?? [];
  [0, 1].forEach((index) => {
    const player = players.find((entry) => entry.playerIndex === index);
    const offline = player ? !player.connected : false;
    ui.playerCard({
      x: index === 0 ? leftX : rightX,
      y: top + 16,
      width: cardWidth,
      height: cardHeight,
      name: snapshot.players[index] ?? `玩家 ${index + 1}`,
      subline: playerSubline(snapshot, index as 0 | 1),
      avatarColor: [colors.player0, colors.player1][index] ?? colors.player1,
      active: snapshot.currentPlayer === index,
      offline,
      badge:
        snapshot.currentBreak > (snapshot.gameType === "snooker" ? 0 : 1)
          ? snapshot.gameType === "snooker"
            ? `单杆 ${snapshot.currentBreak}`
            : `连进 ${snapshot.currentBreak}`
          : undefined,
      dots: groupDots(snapshot, index as 0 | 1),
      thinking:
        snapshot.phase === "aiming" &&
        snapshot.currentPlayer !== model.playerIndex,
      thinkingLong: model.opponentWaitingSeconds > 20,
      pulse: (Date.now() % 1400) / 1400,
    });
  });

  ui.text(
    targetLabel(snapshot),
    layout.width / 2,
    top + 38,
    typeScale.body,
    colors.ivory100,
    "center",
    600,
    240,
  );
  ui.text(
    `第 ${snapshot.shotNumber + 1} 杆`,
    layout.width / 2,
    top + 61,
    14,
    colors.sage500,
    "center",
    500,
  );
}

function drawStatus(ui: Ui, model: HudModel, snapshot: MatchSnapshot) {
  const status =
    model.roomStatus === "starting"
      ? "对局即将开始 · 3 秒后开局"
      : model.trial && !model.animating
        ? `试玩中 · 好友加入后自动开局 · 房间 ${model.roomCode ?? "------"}`
        : (model.cameraMoving ? "镜头切换中" : model.message) ??
          (snapshot.phase === "ballInHand"
            ? "自由球：拖动白球到合法位置"
            : snapshot.canRepositionCue
              ? "任意球：可拖动白球调整，或点击台面瞄准"
              : (snapshot.lastMessage ?? "单击台面瞄准，拖动调力度"));
  const view = tableViewport(ui.layout);
  const tableBottom = view.y + view.height;
  const y = Math.max(
    tableBottom + 10,
    ui.layout.height - safeBottom(ui.layout) - 52,
  );
  const width = Math.min(760, ui.layout.width - 264);
  ui.statusBar(status, statusTone(status, snapshot), y, width, "eventLog");
  if (model.canSkip) {
    ui.button(
      "skipShot",
      "跳过",
      Math.min(
        ui.layout.width - safeRight(ui.layout) - 100,
        ui.layout.width / 2 + width / 2 + 12,
      ),
      y,
      88,
      40,
      { ghost: true, fontSize: 15 },
    );
  } else if (model.trial) {
    ui.button(
      "roomOverlay",
      "邀请",
      Math.min(
        ui.layout.width - safeRight(ui.layout) - 100,
        ui.layout.width / 2 + width / 2 + 12,
      ),
      y,
      88,
      40,
      { accent: true, fontSize: 15 },
    );
  }
}

function statusTone(status: string, snapshot: MatchSnapshot) {
  if (status === "镜头切换中") return colors.brass300;
  if (status.startsWith("犯规")) return colors.danger400;
  if (status.includes("进球") || status.includes("落袋")) return colors.success400;
  if (snapshot.target.freeBall || status.includes("自由球")) return colors.info400;
  if (status.includes("轮到")) return colors.brass300;
  return colors.sage300;
}

function drawSliders(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const left = safeLeft(layout) + SIDE_MARGIN;
  const right = layout.width - safeRight(layout) - SIDE_MARGIN - SLIDER_WIDTH;
  ui.text("力度", left + 22, SLIDER_TOP - 22, 16, colors.sage300, "center", 600);
  ui.powerSlider(
    "power",
    left,
    SLIDER_TOP,
    SLIDER_WIDTH,
    SLIDER_HEIGHT,
    model.power,
    !model.canShoot,
  );
  ui.text("微调", right + 22, SLIDER_TOP - 22, 16, colors.sage300, "center", 600);
  ui.fineAimSlider(
    "fineAim",
    right,
    SLIDER_TOP,
    SLIDER_WIDTH,
    SLIDER_HEIGHT,
    model.fineAimOffset,
    !model.canShoot,
  );
}

function drawActions(ui: Ui, model: HudModel, snapshot: MatchSnapshot) {
  const { layout } = ui;
  const bottom = safeBottom(layout);
  const shootWidth = 128;
  const shootX =
    layout.width - safeRight(layout) - 40 - shootWidth;
  const shootY = layout.height - bottom - 130;
  ui.text(
    `${Math.round(model.power * 100)}%`,
    shootX + shootWidth,
    shootY - 14,
    15,
    colors.sage300,
    "right",
    600,
  );
  const label =
    model.roomStatus === "starting"
      ? "即将开始"
      : snapshot.phase === "ballInHand"
        ? "先摆母球"
        : model.animating
          ? "击球中…"
          : !model.canShoot
            ? "等待对手"
            : "击球";
  ui.button("shoot", label, shootX, shootY, shootWidth, 64, {
    accent: model.canShoot,
    disabled: !model.canShoot,
    fontSize: 22,
  });

  ui.button("spinButton", "杆法", safeLeft(layout) + 24, layout.height - bottom - 96, 96, 48, {
    ghost: true,
    fontSize: 16,
  });
  if (Math.abs(model.spinX) > 0.005 || Math.abs(model.spinY) > 0.005) {
    ui.dot(
      safeLeft(layout) + 24 + 84,
      layout.height - bottom - 96 + 12,
      5,
      colors.brass300,
    );
  }
  if (snapshot.target.freeBall && !snapshot.target.nominatedBall) {
    ui.button(
      "nominate",
      "提名自由球",
      layout.width / 2 - 108,
      layout.height - bottom - 130,
      216,
      48,
      { ghost: true, fontSize: 16 },
    );
  }
}

function drawGameOver(ui: Ui, model: HudModel, snapshot: MatchSnapshot) {
  const { layout } = ui;
  const width = Math.min(640, layout.width - 80);
  const height = 360;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.panel(x, y, width, height, 0.97, radius.card, colors.ink900, withAlpha(colors.brass400, 0.4));
  ui.text("本局结束", layout.width / 2, y + 54, typeScale.h1, colors.brass300, "center", 700);
  if (snapshot.practice) {
    ui.text("本局完成", layout.width / 2, y + 118, 30, colors.ivory100, "center", 700);
    ui.text(
      `共 ${snapshot.shotNumber} 杆 · 可重新摆球继续练习`,
      layout.width / 2,
      y + 160,
      17,
      colors.sage300,
      "center",
      500,
      width - 60,
    );
    ui.button("restart", "重新摆球", x + 64, y + 220, 240, 60, {
      accent: true,
    });
    ui.button("exit", "返回大厅", x + width - 304, y + 220, 240, 60, {
      ghost: true,
    });
    return;
  }
  const winnerName = snapshot.players[snapshot.winner ?? 0];
  const winner =
    snapshot.winner === null
      ? "对局已结束"
      : snapshot.winner === model.playerIndex
        ? "你赢了"
        : `${winnerName} 获胜`;
  ui.text(winner, layout.width / 2, y + 122, 36, colors.ivory100, "center", 700);
  ui.text(
    snapshot.endReason ?? "",
    layout.width / 2,
    y + 160,
    17,
    colors.sage300,
    "center",
    500,
    width - 60,
  );
  ui.text(
    `比分 ${snapshot.scores[0]} : ${snapshot.scores[1]} · 本局共 ${snapshot.shotNumber} 杆`,
    layout.width / 2,
    y + 192,
    15,
    colors.sage500,
    "center",
    500,
  );
  ui.button(
    "rematch",
    model.online ? "再来一局" : "重新开局",
    x + 64,
    y + 240,
    240,
    60,
    { accent: true },
  );
  ui.button("exit", "返回大厅", x + width - 304, y + 240, 240, 60, {
    ghost: true,
  });
}

function drawSpinModal(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const centerX = layout.width / 2;
  const panelX = centerX - 260;
  const panelY = 120;
  ui.modal(
    { x: panelX, y: panelY, width: 520, height: 480 },
    { opacity: 0.98, stroke: withAlpha(colors.ivory100, 0.16) },
  );
  ui.text("杆法", centerX, 168, 30, colors.brass300, "center", 700);
  ui.text(
    "拖动白点调整击球点，关闭后生效",
    centerX,
    206,
    17,
    colors.sage300,
    "center",
    500,
  );
  const discY = 360;
  ui.context.strokeStyle = colors.ivory100;
  ui.context.lineWidth = 3;
  ui.context.beginPath();
  ui.context.arc(centerX, discY, SPIN_RADIUS, 0, Math.PI * 2);
  ui.context.stroke();
  ui.context.strokeStyle = withAlpha(colors.ivory100, 0.35);
  ui.context.lineWidth = 1;
  ui.context.beginPath();
  ui.context.moveTo(centerX - SPIN_RADIUS, discY);
  ui.context.lineTo(centerX + SPIN_RADIUS, discY);
  ui.context.moveTo(centerX, discY - SPIN_RADIUS);
  ui.context.lineTo(centerX, discY + SPIN_RADIUS);
  ui.context.stroke();
  ui.dot(
    centerX + (model.spinX / SPIN_LIMIT) * SPIN_RADIUS,
    discY + (model.spinY / SPIN_LIMIT) * SPIN_RADIUS,
    12,
    colors.ivory100,
  );
  ui.buttons.push({
    id: "spinPad",
    label: "",
    x: centerX - SPIN_RADIUS,
    y: discY - SPIN_RADIUS,
    width: SPIN_RADIUS * 2,
    height: SPIN_RADIUS * 2,
  });
  const vertical = -model.spinY;
  ui.text(
    Math.abs(vertical) < 0.005
      ? "中杆"
      : vertical > 0
        ? `高杆 ${vertical.toFixed(2)}`
        : `低杆 ${(-vertical).toFixed(2)}`,
    centerX + 142,
    discY - 14,
    15,
    colors.sage300,
    "left",
    600,
  );
  ui.text(
    Math.abs(model.spinX) < 0.005
      ? "无塞"
      : model.spinX > 0
        ? `右塞 ${model.spinX.toFixed(2)}`
        : `左塞 ${(-model.spinX).toFixed(2)}`,
    centerX + 142,
    discY + 14,
    15,
    colors.sage300,
    "left",
    600,
  );
  const presets: [string, string, number, number][] = [
    ["center", "中杆", 0, 0],
    ["high", "高杆", 0, -0.3],
    ["low", "低杆", 0, 0.3],
    ["left", "左塞", -0.3, 0],
    ["right", "右塞", 0.3, 0],
  ];
  const presetWidth = 48;
  const presetGap = 10;
  const startX =
    centerX - (presetWidth * presets.length + presetGap * (presets.length - 1)) / 2;
  presets.forEach(([id, label], index) =>
    ui.button(
      `spinPreset:${id}`,
      label,
      startX + index * (presetWidth + presetGap),
      490,
      presetWidth,
      40,
      { ghost: true, fontSize: 15 },
    ),
  );
  ui.button("closeModal", "关闭", centerX - 80, 548, 160, 48, {
    accent: true,
    fontSize: 18,
  });
}

const cameraOptions: { id: CameraMode; label: string }[] = [
  { id: "top", label: "2D 俯视" },
  { id: "follow", label: "3D 跟杆" },
  { id: "overview", label: "3D 总览" },
];

function cameraLabel(mode: CameraMode) {
  return cameraOptions.find((option) => option.id === mode)?.label ?? "2D 俯视";
}

function drawMenu(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const margin = gutter(layout);
  const expanded = model.roomSettingsOpen;
  const height = expanded ? 640 : 432;
  const y = layout.height - height;
  ui.modal(
    { x: 0, y, width: layout.width, height },
    {
      radius: 0,
      opacity: 0.985,
      stroke: withAlpha(colors.ivory100, 0.14),
    },
  );
  ui.drawerHandle(0, y, layout.width);
  ui.text("菜单", margin, y + 46, typeScale.h2, colors.ivory100, "left", 700);

  drawRoomSettings(ui, model, margin, y + 78, layout.width - margin * 2, expanded);

  const rowY = y + (expanded ? 330 : 152);
  const rowX = layout.width - margin - 120;
  ui.text("音效", margin, rowY, 17, colors.ivory100, "left", 600);
  ui.pill("sound", model.soundOn ? "开" : "关", rowX, rowY - 20, 120, 38, model.soundOn);

  ui.text("减少动态效果", margin, rowY + 52, 17, colors.ivory100, "left", 600);
  ui.pill(
    "motion",
    model.reduceMotion ? "开" : "关",
    rowX,
    rowY + 32,
    120,
    38,
    model.reduceMotion,
  );

  ui.text("画质", margin, rowY + 104, 17, colors.ivory100, "left", 600);
  ui.tabs(
    "quality",
    [
      { id: "high", label: "高" },
      { id: "medium", label: "中" },
      { id: "low", label: "低" },
    ],
    rowX - 120,
    rowY + 84,
    240,
    38,
    model.quality,
  );

  ui.text("快速播放", margin, rowY + 156, 17, colors.ivory100, "left", 600);
  ui.tabs(
    "playback",
    [
      { id: "1.15", label: "1.15×" },
      { id: "1.5", label: "1.5×" },
      { id: "2", label: "2×" },
    ],
    rowX - 120,
    rowY + 136,
    240,
    38,
    String(model.playbackSpeed),
  );

  const actionY = y + height - 58;
  ui.button("license", "规则", margin, actionY - 40, 88, 36, {
    ghost: true,
    fontSize: 15,
  });

  if (model.trial) {
    ui.button("restart", "重新摆球", margin, actionY, 140, 46, {
      ghost: true,
      fontSize: 16,
    });
    ui.button("leave", "离开房间", margin + 152, actionY, 140, 46, {
      danger: true,
      fontSize: 16,
    });
  } else if (model.practiceMode) {
    ui.button("restart", "重新摆球", margin, actionY, 140, 46, {
      ghost: true,
      fontSize: 16,
    });
    ui.button("exit", "退出对局", margin + 152, actionY, 140, 46, {
      danger: true,
      fontSize: 16,
    });
  } else {
    ui.button("concede", "认输", margin, actionY, 120, 46, {
      danger: true,
      fontSize: 16,
    });
    ui.button("exit", "退出对局", margin + 132, actionY, 140, 46, {
      danger: true,
      fontSize: 16,
    });
  }
  ui.button(
    "closeModal",
    "返回台面",
    layout.width - margin - 200,
    actionY,
    200,
    48,
    { accent: true, fontSize: 18 },
  );
}

function drawRoomSettings(
  ui: Ui,
  model: HudModel,
  x: number,
  y: number,
  width: number,
  expanded: boolean,
) {
  ui.panel(
    x,
    y,
    width,
    44,
    0.55,
    radius.card,
    colors.ink800,
    withAlpha(colors.sage300, 0.2),
  );
  ui.text("房间设置", x + 16, y + 23, 17, colors.ivory100, "left", 600);
  const aimLevel = model.practiceMode
    ? model.practicePredictionLevel
    : model.predictionLevel;
  const aim = aimLevel > 0 ? `${aimLevel} 档` : "关闭";
  ui.text(
    `当前 ${cameraLabel(model.cameraMode)} · 辅助线 ${aim}`,
    x + width - 60,
    y + 23,
    14,
    colors.sage300,
    "right",
    500,
    width - 180,
  );
  ui.text(
    expanded ? "收起" : "展开",
    x + width - 16,
    y + 23,
    14,
    colors.brass300,
    "right",
    600,
  );
  ui.buttons.push({
    id: "roomSettings",
    label: "",
    x,
    y,
    width,
    height: 44,
  });
  if (!expanded) return;

  const pillX = x + 68;
  const viewY = y + 54;
  ui.text("视角", x + 16, viewY + 19, 15, colors.ivory100, "left", 600);
  cameraOptions.forEach((option, index) => {
    const px = pillX + index * 124;
    const allowed = model.cameraViews.includes(option.id);
    ui.pill(
      `cameraView:${option.id}`,
      option.label,
      px,
      viewY,
      116,
      38,
      allowed,
    );
    if (allowed && model.cameraMode === option.id) {
      ui.context.fillStyle = colors.brass300;
      ui.context.fillRect(px + 18, viewY + 41, 80, 3);
    }
  });
  ui.text(
    "点选切换视角；再点当前项可隐藏，至少保留一个",
    pillX,
    viewY + 58,
    13,
    colors.sage500,
    "left",
    500,
    width - (pillX - x) - 16,
  );

  const aimY = viewY + 122;
  ui.text("辅助线", x + 16, aimY + 19, 15, colors.ivory100, "left", 600);
  if (model.practiceMode) {
    for (let level = 0; level <= 5; level += 1) {
      ui.pill(
        `practicePrediction:${level}`,
        level === 0 ? "关闭" : `${level} 档`,
        pillX + level * 58,
        aimY,
        52,
        38,
        model.practicePredictionLevel === level,
      );
    }
  } else {
    ui.text(
      `${aim}（房间设置）`,
      pillX,
      aimY + 19,
      15,
      colors.sage500,
      "left",
      500,
    );
  }
}

function drawCountdown(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const remaining = model.countdownEnd
    ? Math.max(0, (model.countdownEnd - Date.now()) / 1000)
    : 0;
  const label =
    remaining > 0.05 ? String(Math.ceil(remaining)) : "开始！";
  const size = label === "开始！" ? 56 : 96;
  const width = label === "开始！" ? 300 : 170;
  const height = 170;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.panel(
    x,
    y,
    width,
    height,
    0.86,
    radius.card,
    colors.ink950,
    withAlpha(colors.brass300, 0.55),
  );
  ui.text(
    label,
    layout.width / 2,
    y + height / 2 + size * 0.36,
    size,
    colors.brass300,
    "center",
    800,
  );
  ui.text(
    "好友已加入，准备开局",
    layout.width / 2,
    y + height + 26,
    16,
    colors.sage300,
    "center",
    600,
  );
}

const roomModeNames: Record<string, string> = {
  classic: "经典",
  cards: "卡牌",
  threeSnooker: "三人斯诺克",
};

function drawRoomOverlay(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const width = Math.min(560, layout.width - 80);
  const height = 420;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.modal(
    { x, y, width, height },
    { opacity: 0.98, stroke: withAlpha(colors.brass400, 0.4) },
  );
  ui.text(
    `房间 ${model.roomCode ?? "------"}`,
    layout.width / 2,
    y + 46,
    typeScale.h2,
    colors.brass300,
    "center",
    700,
  );
  const room = model.room;
  const mode = roomModeNames[room?.mode ?? model.roomMode] ?? "经典";
  ui.text(
    `${gameName(room?.gameType ?? "eightball")} · ${mode} · ${room?.players.length ?? 1}/${room?.maxPlayers ?? 2}`,
    layout.width / 2,
    y + 80,
    16,
    colors.sage300,
    "center",
    500,
  );

  const seats = room?.players ?? [];
  for (let index = 0; index < (room?.maxPlayers ?? 2); index += 1) {
    const player = seats.find((seat) => seat.playerIndex === index);
    const rowY = y + 112 + index * 58;
    ui.panel(
      x + 28,
      rowY,
      width - 56,
      48,
      0.5,
      radius.card,
      colors.ink800,
      withAlpha(player ? colors.brass300 : colors.sage500, 0.25),
    );
    ui.dot(x + 50, rowY + 24, 6, player?.connected ? colors.success400 : colors.sage500);
    ui.text(
      player ? player.displayName : "等待好友加入",
      x + 66,
      rowY + 29,
      17,
      player ? colors.ivory100 : colors.sage500,
      "left",
      600,
    );
    if (player)
      ui.text(
        player.playerIndex === 0 ? "房主" : `座位 ${player.playerIndex + 1}`,
        x + width - 44,
        rowY + 29,
        14,
        colors.sage300,
        "right",
        500,
      );
  }

  const buttonY = y + height - 132;
  ui.button("copyCode", "复制房间码", x + 28, buttonY, 150, 46, {
    ghost: true,
    fontSize: 15,
  });
  ui.button("share", "分享邀请", x + 188, buttonY, 150, 46, {
    accent: true,
    fontSize: 15,
  });
  ui.button("leave", "离开房间", x + 348, buttonY, 150, 46, {
    danger: true,
    fontSize: 15,
  });
  ui.button(
    "closeRoomOverlay",
    "关闭",
    layout.width / 2 - 90,
    y + height - 66,
    180,
    44,
    { ghost: true, fontSize: 16 },
  );
}

function drawConfirm(ui: Ui, model: HudModel) {
  if (!model.confirm) return;
  const { layout } = ui;
  const width = 460;
  const height = 220;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.modal(
    { x, y, width, height },
    { stroke: withAlpha(colors.brass400, 0.35) },
  );
  ui.text("确认", layout.width / 2, y + 42, typeScale.h2, colors.brass300, "center", 700);
  const lines = ui.wrap(model.confirm.text, width - 64, 17, 500, 2);
  lines.forEach((line, index) =>
    ui.text(
      line,
      layout.width / 2,
      y + 92 + index * 24,
      17,
      colors.ivory100,
      "center",
      500,
    ),
  );
  ui.button("confirmYes", "确认", x + 48, y + 146, 170, 48, {
    accent: true,
    fontSize: 17,
  });
  ui.button("confirmNo", "取消", x + width - 218, y + 146, 170, 48, {
    ghost: true,
    fontSize: 17,
  });
}

function drawEventLog(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const width = Math.min(840, layout.width - 48);
  const height = Math.min(560, layout.height - 80);
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.modal(
    { x, y, width, height },
    { stroke: withAlpha(colors.ivory100, 0.16) },
  );
  ui.text("事件记录", x + 28, y + 40, 26, colors.brass300, "left", 700);
  ui.text(
    `最近 ${model.eventLog.length} 条`,
    x + width - 28,
    y + 42,
    14,
    colors.sage500,
    "right",
    500,
  );
  ui.divider(x + 28, y + 64, width - 56);
  const rows = model.eventLog.slice(-20);
  if (rows.length === 0)
    ui.text(
      "暂无事件",
      layout.width / 2,
      y + height / 2,
      16,
      colors.sage500,
      "center",
      500,
    );
  rows.forEach((entry, index) => {
    const rowY = y + 92 + index * 21;
    ui.monoText(logTime(entry.at), x + 28, rowY, 12, colors.sage500, "left", 500);
    const line = ui.wrap(entry.text, width - 136, 14, 500, 1)[0] ?? "";
    ui.text(
      line,
      x + 108,
      rowY,
      14,
      colors.ivory100,
      "left",
      500,
      width - 136,
    );
  });
  ui.button("closeModal", "关闭", layout.width / 2 - 90, y + height - 60, 180, 44, {
    accent: true,
    fontSize: 17,
  });
}

function logTime(at: number) {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
