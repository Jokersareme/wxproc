import {
  defFor,
  effectExpiryLabel,
  effectKindLabel,
  type CardId,
  type MatchSnapshot,
} from "@friend-billiards/core";
import {
  gutter,
  safeBottom,
  safeLeft,
  safeRight,
  safeTop,
  tableViewport,
  type Layout,
} from "../layout";
import type { CameraMode, HudModel } from "../model";
import { colors, radius, typeScale, withAlpha } from "../theme";
import type { Ui } from "../widgets";
import {
  gameName,
  groupDots,
  playerSubline,
  targetBrief,
  targetLabel,
} from "../format";
import { SPIN_LIMIT } from "../../spin";

const SLIDER_TOP = 190;
const SLIDER_HEIGHT = 320;
const SLIDER_WIDTH = 44;
const SIDE_MARGIN = 24;
const FINE_SIDE_MARGIN = 64;
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
  if (snapshot.phase !== "gameOver" && model.cardHandOpen)
    drawCardHand(ui, model, snapshot);

  if (snapshot.phase === "gameOver") drawGameOver(ui, model, snapshot);
  if (model.spinOpen) drawSpinModal(ui, model);
  if (model.menuOpen) drawMenu(ui, model);
  if (model.confirm) drawConfirm(ui, model);
  if (model.eventLogOpen) drawEventLog(ui, model);
  if (model.roomOverlayOpen) drawRoomOverlay(ui, model);
  if (model.cardDetailUid) drawCardDetail(ui, model, snapshot);
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
  const left = safeLeft(layout);
  ui.button("menu", "菜单", left + 16, top + 16, 56, 56, {
    ghost: true,
    fontSize: 14,
  });
  const soundX = left + 80;
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
    const width = 460;
    const height = 52;
    const x = (layout.width - width) / 2;
    const remaining = snapshot.balls.filter(
      (ball) => ball.id !== 0 && ball.state !== "InPocket",
    ).length;
    const trial = model.trial;
    const target =
      snapshot.gameType === "snooker" && snapshot.target.freeBall
        ? targetLabel(snapshot)
        : `目标：${targetBrief(snapshot)}`;
    const detail = trial
      ? `${gameName(snapshot.gameType)} · ${target} · 房间 ${model.roomCode ?? "------"}`
      : snapshot.gameType === "snooker"
        ? `${gameName(snapshot.gameType)} · ${target} · 单杆 ${snapshot.currentBreak} 分`
        : `${gameName(snapshot.gameType)} · ${target} · 剩余 ${remaining} 球`;
    ui.panel(
      x,
      top + 10,
      width,
      height,
      0.88,
      radius.card,
      colors.ink800,
      withAlpha(colors.brass300, 0.55),
    );
    ui.avatar(
      x + 14,
      top + 19,
      34,
      trial ? "试" : "练",
      colors.brass300,
      true,
    );
    ui.text(
      trial ? "试玩中" : "自由练习",
      x + 60,
      top + 27,
      20,
      colors.brass300,
      "left",
      700,
    );
    ui.text(detail, x + 60, top + 44, 14, colors.sage300, "left", 500, width - 150);
    ui.text(
      `第 ${snapshot.shotNumber + 1} 杆`,
      x + width - 14,
      top + 27,
      14,
      colors.brass300,
      "right",
      600,
    );
    return;
  }

  if (snapshot.playerCount >= 3) {
    drawThreePlayerBar(ui, model, snapshot, top, margin);
    return;
  }

  const leftX = Math.max(margin, safeLeft(layout) + 144);
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

  const gapLeft = leftX + cardWidth;
  const gapRight = rightX;
  const centerX = (gapLeft + gapRight) / 2;
  const gapWidth = Math.max(80, gapRight - gapLeft - 12);
  if (!snapshot.cards?.enabled) {
    ui.text(
      targetLabel(snapshot),
      centerX,
      top + 38,
      layout.compact ? 15 : typeScale.body,
      colors.ivory100,
      "center",
      600,
      gapWidth,
    );
    ui.text(
      `第 ${snapshot.shotNumber + 1} 杆`,
      centerX,
      top + 61,
      14,
      colors.sage500,
      "center",
      500,
    );
  } else {
    ui.text(
      `${targetLabel(snapshot)} · 第 ${snapshot.shotNumber + 1} 杆`,
      layout.width / 2,
      top + 94,
      layout.compact ? 15 : typeScale.body,
      colors.ivory100,
      "center",
      600,
      layout.width - margin * 2,
    );
    drawEffectRow(ui, snapshot, 0, leftX + 10, top + 106, cardWidth - 20);
    drawEffectRow(ui, snapshot, 1, rightX + 10, top + 106, cardWidth - 20);
    const opponent = 1 - (model.playerIndex ?? 0);
    const hand = snapshot.cards.hands[opponent] ?? [];
    hand.slice(0, 8).forEach((card, index) => {
      const x = rightX + cardWidth - 26 - index * 22;
      ui.panel(
        x,
        top + 102,
        20,
        24,
        0.92,
        radius.control,
        colors.ink900,
        withAlpha(cardRarityColor(card.cardId), 0.7),
      );
      ui.text(
        defFor(card.cardId).glyph,
        x + 10,
        top + 119,
        13,
        cardRarityColor(card.cardId),
        "center",
        700,
      );
    });
  }
}

function drawThreePlayerBar(
  ui: Ui,
  model: HudModel,
  snapshot: MatchSnapshot,
  top: number,
  margin: number,
) {
  const { layout } = ui;
  const gap = 12;
  const left = Math.max(margin, safeLeft(layout) + 144);
  const right = layout.width - margin;
  const width = (right - left - gap * 2) / 3;
  const players = model.room?.players ?? [];
  for (let index = 0; index < 3; index += 1) {
    const player = players.find((entry) => entry.playerIndex === index);
    const eliminated = snapshot.eliminated[index] ?? false;
    const offline = player ? !player.connected : false;
    const x = left + index * (width + gap);
    ui.playerCard({
      x,
      y: top + 12,
      width,
      height: 64,
      name: snapshot.players[index] ?? `玩家 ${index + 1}`,
      subline: eliminated
        ? "已退出"
        : `${snapshot.scores[index] ?? 0} 分 · 最高 ${snapshot.bestBreak[index] ?? 0}`,
      avatarColor:
        [colors.player0, colors.player1, colors.player2][index] ??
        colors.player1,
      active: snapshot.currentPlayer === index && !eliminated,
      offline: offline || eliminated,
      badge:
        snapshot.currentPlayer === index && snapshot.currentBreak > 0
          ? `单杆 ${snapshot.currentBreak}`
          : undefined,
      pulse: (Date.now() % 1400) / 1400,
    });
  }
  ui.text(
    targetLabel(snapshot),
    layout.width / 2,
    top + 90,
    layout.compact ? 15 : typeScale.body,
    colors.ivory100,
    "center",
    600,
    layout.width - margin * 2,
  );
  ui.text(
    `轮次 ${snapshot.currentPlayer + 1}/3 · 第 ${snapshot.shotNumber + 1} 杆`,
    layout.width / 2,
    top + 108,
    13,
    colors.sage500,
    "center",
    500,
  );
}

function cardRarityColor(cardId: CardId) {
  const rarity = defFor(cardId).rarity;
  return rarity === "epic"
    ? colors.brass300
    : rarity === "rare"
      ? colors.info400
      : colors.sage300;
}

function drawEffectRow(
  ui: Ui,
  snapshot: MatchSnapshot,
  player: number,
  x: number,
  y: number,
  width: number,
) {
  const cards = snapshot.cards;
  if (!cards?.enabled) return;
  const effects = cards.active.filter(
    (effect) =>
      effect.target === player ||
      (effect.target === null && effect.owner === player),
  );
  if (effects.length === 0) return;
  let cursor = x;
  effects.slice(0, 4).forEach((effect) => {
    const label = `${effectKindLabel(effect.kind)}·${effectExpiryLabel(effect)}`;
    const pillWidth = Math.min(120, ui.measure(label, 11, 600) + 14);
    if (cursor + pillWidth > x + width) return;
    ui.panel(
      cursor,
      y,
      pillWidth,
      20,
      0.72,
      radius.pill,
      colors.ink900,
      withAlpha(effect.owner === player ? colors.brass300 : colors.danger400, 0.5),
    );
    ui.text(
      label,
      cursor + pillWidth / 2,
      y + 14,
      11,
      effect.owner === player ? colors.brass300 : colors.danger400,
      "center",
      600,
      pillWidth - 4,
    );
    cursor += pillWidth + 6;
  });
}

function drawStatus(ui: Ui, model: HudModel, snapshot: MatchSnapshot) {
  const waitingSeat = model.room?.players.find(
    (player) =>
      player.playerIndex === snapshot.currentPlayer && !player.connected,
  );
  const status =
    model.roomStatus === "playing" && waitingSeat
      ? `等待 ${waitingSeat.displayName} 重连`
      : model.roomStatus === "starting"
      ? "对局即将开始 · 3 秒后开局"
      : model.roomStatus === "trial" &&
          model.roomMode === "threeSnooker" &&
          (model.room?.players.length ?? 0) < 3
        ? `三人斯诺克 · 等待第三位玩家 · 房间 ${model.roomCode ?? "------"}`
        : model.trial && !model.animating
          ? `试玩中 · 好友加入后自动开局 · 房间 ${model.roomCode ?? "------"}`
        : (model.cameraMoving ? "镜头切换中" : model.message) ??
          (snapshot.phase === "ballInHand"
            ? "自由球：拖动白球到合法位置"
            : snapshot.canRepositionCue
              ? "任意球：可拖动白球调整，或点击台面瞄准"
              : (snapshot.lastMessage ?? "单击台面瞄准，拖动调力度"));
  const view = tableViewport(ui.layout, {
    cards: Boolean(snapshot.cards?.enabled),
    players: snapshot.playerCount,
  });
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
  const right =
    layout.width - safeRight(layout) - FINE_SIDE_MARGIN - SLIDER_WIDTH;
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
  if (snapshot.cards?.enabled) {
    ui.button(
      "cardHand",
      `卡牌 · ${cardHandCount(snapshot, model)}`,
      layout.width / 2 - 64,
      layout.height - bottom - 96,
      128,
      48,
      { ghost: true, fontSize: 16 },
    );
  }
  if (snapshot.target.freeBall && !snapshot.target.nominatedBall) {
    ui.button(
      "nominate",
      "提名自由球",
      layout.width / 2 - 108,
      snapshot.cards?.enabled
        ? layout.height - bottom - 152
        : layout.height - bottom - 130,
      216,
      48,
      { ghost: true, fontSize: 16 },
    );
  }
}

function cardHandCount(snapshot: MatchSnapshot, model: HudModel) {
  const cards = snapshot.cards;
  if (!cards?.enabled) return 0;
  const player = model.playerIndex ?? snapshot.currentPlayer;
  return cards.hands[player]?.length ?? 0;
}

function drawCardHand(
  ui: Ui,
  model: HudModel,
  snapshot: MatchSnapshot,
) {
  const cards = snapshot.cards;
  if (!cards?.enabled) return;
  const player = model.playerIndex ?? snapshot.currentPlayer;
  const hand = cards.hands[player] ?? [];
  if (hand.length === 0) return;
  const { layout } = ui;
  const cardWidth = 96;
  const cardHeight = 132;
  const overlap = hand.length <= 5 ? 28 : hand.length >= 7 ? 46 : 36;
  const step = cardWidth - overlap;
  const total = cardWidth + (hand.length - 1) * step;
  const startX = (layout.width - total) / 2;
  const baseY =
    layout.height - safeBottom(layout) - 18 - cardHeight;
  ui.mask();
  ui.panel(
    startX - 12,
    baseY - 10,
    total + 24,
    cardHeight + 18,
    0.72,
    radius.card,
    colors.ink900,
    withAlpha(colors.brass400, 0.25),
  );
  const myTurn =
    !model.online ||
    snapshot.currentPlayer === (model.playerIndex ?? snapshot.currentPlayer);
  const silenced = cards.active.some(
    (effect) =>
      effect.kind === "silence" &&
      effect.target === player &&
      effect.owner !== player,
  );
  hand.forEach((card, index) => {
    const definition = defFor(card.cardId);
    const selected = model.cardDetailUid === card.uid;
    const x = startX + index * step;
    const y = baseY - (selected ? 14 : 0);
    const blocked = !myTurn || cards.playedThisTurn || silenced;
    ui.context.save();
    if (blocked) ui.context.globalAlpha = 0.5;
    ui.panel(
      x,
      y,
      cardWidth,
      cardHeight,
      0.97,
      radius.card,
      colors.ink800,
      selected
        ? colors.brass300
        : withAlpha(cardRarityColor(card.cardId), 0.55),
    );
    ui.context.fillStyle = cardRarityColor(card.cardId);
    ui.context.fillRect(x + 1, y + 1, cardWidth - 2, 5);
    ui.context.fillStyle = withAlpha(colors.ink900, 0.72);
    ui.context.beginPath();
    ui.context.arc(x + cardWidth / 2, y + 44, 22, 0, Math.PI * 2);
    ui.context.fill();
    ui.text(
      definition.glyph,
      x + cardWidth / 2,
      y + 53,
      24,
      cardRarityColor(card.cardId),
      "center",
      700,
    );
    ui.text(definition.name, x + cardWidth / 2, y + 82, 16, colors.ivory100, "center", 700, cardWidth - 8);
    const lines = ui.wrap(definition.short, cardWidth - 12, 11, 500, 2);
    lines.forEach((line, lineIndex) =>
      ui.text(
        line,
        x + cardWidth / 2,
        y + 102 + lineIndex * 14,
        11,
        colors.sage300,
        "center",
        500,
        cardWidth - 8,
      ),
    );
    ui.text(
      "1/回合",
      x + cardWidth - 6,
      y + 16,
      9,
      colors.sage500,
      "right",
      600,
    );
    ui.context.restore();
    ui.buttons.push({
      id: `card:${card.uid}`,
      label: definition.name,
      x,
      y,
      width: cardWidth,
      height: cardHeight,
    });
  });
  if (cards.playedThisTurn)
    ui.text(
      "本回合已使用卡牌",
      layout.width / 2,
      baseY - 20,
      13,
      colors.brass300,
      "center",
      600,
    );
}

function drawCardDetail(
  ui: Ui,
  model: HudModel,
  snapshot: MatchSnapshot,
) {
  const cards = snapshot.cards;
  const uid = model.cardDetailUid;
  if (!cards?.enabled || !uid) return;
  const player = model.playerIndex ?? snapshot.currentPlayer;
  const card = (cards.hands[player] ?? []).find(
    (entry) => entry.uid === uid,
  );
  if (!card) return;
  const definition = defFor(card.cardId);
  const { layout } = ui;
  const width = Math.min(580, layout.width - 60);
  const height = 340;
  const x = (layout.width - width) / 2;
  const y = layout.height - height - 12;
  ui.modal(
    { x, y, width, height },
    { opacity: 0.99, stroke: withAlpha(colors.brass400, 0.45) },
  );
  ui.text(definition.name, x + 28, y + 46, 28, colors.brass300, "left", 700);
  const rarity =
    definition.rarity === "epic"
      ? "史诗"
      : definition.rarity === "rare"
        ? "稀有"
        : "普通";
  ui.text(
    `${rarity} · ${definition.modes.map(gameName).join(" / ")} · 每回合 1 张`,
    x + width - 28,
    y + 44,
    14,
    colors.sage300,
    "right",
    500,
    width - 220,
  );
  ui.divider(x + 28, y + 68, width - 56);
  const lines = ui.wrap(definition.description, width - 56, 17, 500, 4);
  lines.forEach((line, index) =>
    ui.text(
      line,
      x + 28,
      y + 100 + index * 24,
      17,
      colors.ivory100,
      "left",
      500,
      width - 56,
    ),
  );
  ui.text(
    definition.target === "objectBall"
      ? "目标：选择一颗球" + (definition.id === "shuffle" ? "，再选择落点" : "")
      : definition.target === "effect"
        ? "目标：选择一个对手效果"
        : "目标：无需选择",
    x + 28,
    y + 196,
    14,
    colors.sage500,
    "left",
    500,
    width - 56,
  );
  if (model.cardEffectPick) {
    const effects = cards.active.filter(
      (effect) => effect.owner !== player,
    );
    if (effects.length === 0)
      ui.text(
        "对手没有可移除的效果",
        x + 28,
        y + 236,
        15,
        colors.sage300,
        "left",
        500,
      );
    effects.slice(0, 4).forEach((effect, index) => {
      const buttonWidth = (width - 56 - 12) / 2;
      const column = index % 2;
      const row = Math.floor(index / 2);
      ui.button(
        `cardEffect:${effect.effectId}`,
        `${effectKindLabel(effect.kind)} · ${effectExpiryLabel(effect)}`,
        x + 28 + column * (buttonWidth + 12),
        y + 220 + row * 44,
        buttonWidth,
        38,
        { ghost: true, fontSize: 14 },
      );
    });
  } else {
    ui.button("cardUse", "使用", x + 28, y + height - 64, 220, 48, {
      accent: true,
      fontSize: 18,
    });
  }
  ui.button(
    "cardCancel",
    "取消",
    x + width - 208,
    y + height - 64,
    180,
    48,
    { ghost: true, fontSize: 18 },
  );
}

function drawGameOver(ui: Ui, model: HudModel, snapshot: MatchSnapshot) {
  if (snapshot.playerCount >= 3) {
    drawThreeGameOver(ui, model, snapshot);
    return;
  }
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

function drawThreeGameOver(
  ui: Ui,
  model: HudModel,
  snapshot: MatchSnapshot,
) {
  const { layout } = ui;
  const width = Math.min(760, layout.width - 60);
  const height = 440;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ui.panel(
    x,
    y,
    width,
    height,
    0.97,
    radius.card,
    colors.ink900,
    withAlpha(colors.brass400, 0.45),
  );
  ui.text(
    "本局结束",
    layout.width / 2,
    y + 46,
    typeScale.h1,
    colors.brass300,
    "center",
    700,
  );
  const title =
    snapshot.winner === null
      ? "并列第一"
      : snapshot.winner === model.playerIndex
        ? "你赢了"
        : `${snapshot.players[snapshot.winner]} 获胜`;
  ui.text(title, layout.width / 2, y + 96, 30, colors.ivory100, "center", 700);
  ui.text(
    snapshot.endReason ?? "",
    layout.width / 2,
    y + 132,
    15,
    colors.sage300,
    "center",
    500,
    width - 60,
  );
  const key = (index: number) =>
    `${snapshot.scores[index] ?? 0}:${snapshot.bestBreak[index] ?? 0}:${snapshot.pots[index] ?? 0}`;
  const order =
    snapshot.ranking.length > 0
      ? snapshot.ranking
      : snapshot.players.map((_, index) => index);
  let rank = 0;
  let previous = "";
  order.forEach((index, row) => {
    const rowY = y + 160 + row * 58;
    const eliminated = snapshot.eliminated[index] ?? false;
    let label = `${row + 1}`;
    if (!eliminated) {
      if (key(index) !== previous) rank = row + 1;
      previous = key(index);
      label = `${rank}`;
    }
    ui.panel(
      x + 32,
      rowY,
      width - 64,
      50,
      0.62,
      radius.card,
      colors.ink800,
      withAlpha(
        !eliminated && row === 0 ? colors.brass300 : colors.sage500,
        0.28,
      ),
    );
    ui.text(
      eliminated ? "—" : label,
      x + 60,
      rowY + 31,
      20,
      !eliminated && row === 0 ? colors.brass300 : colors.sage300,
      "center",
      700,
    );
    ui.text(
      snapshot.players[index] ?? `玩家 ${index + 1}`,
      x + 92,
      rowY + 31,
      19,
      eliminated ? withAlpha(colors.ivory100, 0.45) : colors.ivory100,
      "left",
      700,
      width * 0.3,
    );
    ui.text(
      eliminated
        ? "已退出"
        : `${snapshot.scores[index] ?? 0} 分 · 单杆 ${snapshot.bestBreak[index] ?? 0} · 进球 ${snapshot.pots[index] ?? 0}`,
      x + width - 60,
      rowY + 31,
      16,
      eliminated ? colors.danger400 : colors.sage300,
      "right",
      600,
      width * 0.5,
    );
  });
  ui.button(
    "rematch",
    model.online ? "再来一局" : "重新开局",
    x + 56,
    y + height - 76,
    240,
    56,
    { accent: true },
  );
  ui.button(
    "exit",
    "返回大厅",
    x + width - 296,
    y + height - 76,
    240,
    56,
    { ghost: true },
  );
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
  const spinReach = Math.max(SPIN_LIMIT, model.spinLimit || SPIN_LIMIT);
  ui.dot(
    centerX + (model.spinX / spinReach) * SPIN_RADIUS,
    discY + (model.spinY / spinReach) * SPIN_RADIUS,
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

const playbackOptions = [
  { id: "1.15", label: "1.15×" },
  { id: "1.5", label: "1.5×" },
  { id: "2", label: "2×" },
];

function playbackLabel(speed: number) {
  return `${speed}×`;
}

const MENU_ROW = 50;
const ROOM_SETTINGS_COLLAPSED = 44;
const ROOM_SETTINGS_EXPANDED = 268;

export interface MenuMetrics {
  y: number;
  height: number;
  contentTop: number;
  contentBottom: number;
  maxScroll: number;
}

function menuContentHeight(expanded: boolean, cardsRow = false) {
  return (
    8 +
    (expanded ? ROOM_SETTINGS_EXPANDED : ROOM_SETTINGS_COLLAPSED) +
    12 +
    MENU_ROW * 3 +
    (cardsRow ? MENU_ROW : 0) +
    16 +
    1 +
    14 +
    36 +
    12 +
    46 +
    24 +
    12
  );
}

export function menuMetrics(
  layout: Layout,
  expanded: boolean,
  cardsRow = false,
): MenuMetrics {
  const height = Math.min(
    expanded ? 620 : cardsRow ? 580 : 520,
    layout.height - 64,
  );
  const y = layout.height - height;
  const contentTop = y + 74;
  const contentBottom = y + height - 72;
  const view = Math.max(1, contentBottom - contentTop);
  return {
    y,
    height,
    contentTop,
    contentBottom,
    maxScroll: Math.max(
      0,
      menuContentHeight(expanded, cardsRow) - view,
    ),
  };
}

function drawMenu(ui: Ui, model: HudModel) {
  const { layout } = ui;
  const margin = gutter(layout);
  const expanded = model.roomSettingsOpen;
  const cardsRow = Boolean(
    !model.online && model.practiceMode && model.snapshot?.cards?.enabled,
  );
  const metrics = menuMetrics(layout, expanded, cardsRow);
  const scroll = Math.max(0, Math.min(metrics.maxScroll, model.menuScroll));
  ui.modal(
    { x: 0, y: metrics.y, width: layout.width, height: metrics.height },
    {
      radius: 0,
      opacity: 0.985,
      stroke: withAlpha(colors.ivory100, 0.14),
    },
  );
  ui.drawerHandle(0, metrics.y, layout.width);
  ui.text("菜单", margin, metrics.y + 46, typeScale.h2, colors.ivory100, "left", 700);
  ui.text(
    "上下拖动浏览",
    layout.width - margin,
    metrics.y + 48,
    13,
    colors.sage500,
    "right",
    500,
  );
  ui.divider(0, metrics.contentTop - 2, layout.width);

  const firstButton = ui.buttons.length;
  ui.save();
  ui.context.beginPath();
  ui.context.rect(
    0,
    metrics.contentTop,
    layout.width,
    metrics.contentBottom - metrics.contentTop,
  );
  ui.context.clip();

  let y = metrics.contentTop + 8 - scroll;
  drawRoomSettings(ui, model, margin, y, layout.width - margin * 2, expanded);
  y += expanded ? ROOM_SETTINGS_EXPANDED : ROOM_SETTINGS_COLLAPSED;
  y += 12;

  const rowX = layout.width - margin - 120;
  if (cardsRow) {
    ui.text("手牌数量", margin, y + 25, 17, colors.ivory100, "left", 600);
    for (let count = 0; count <= 6; count += 1) {
      ui.pill(
        `practiceCardCount:${count}`,
        String(count),
        layout.width - margin - (7 - count) * 54,
        y + 4,
        46,
        38,
        model.practiceCardCount === count,
      );
    }
    y += MENU_ROW;
  }
  ui.text("音效", margin, y + 25, 17, colors.ivory100, "left", 600);
  ui.pill("sound", model.soundOn ? "开" : "关", rowX, y + 4, 120, 38, model.soundOn);
  y += MENU_ROW;

  ui.text("减少动态效果", margin, y + 25, 17, colors.ivory100, "left", 600);
  ui.pill(
    "motion",
    model.reduceMotion ? "开" : "关",
    rowX,
    y + 4,
    120,
    38,
    model.reduceMotion,
  );
  y += MENU_ROW;

  ui.text("画质", margin, y + 25, 17, colors.ivory100, "left", 600);
  ui.tabs(
    "quality",
    [
      { id: "high", label: "高" },
      { id: "medium", label: "中" },
      { id: "low", label: "低" },
    ],
    rowX - 120,
    y + 4,
    240,
    38,
    model.quality,
  );
  y += MENU_ROW;

  y += 16;
  ui.divider(margin, y, layout.width - margin * 2);
  y += 14;
  ui.button("license", "规则", margin, y, 88, 36, {
    ghost: true,
    fontSize: 15,
  });
  y += 48;

  if (model.trial) {
    ui.button("restart", "重新摆球", margin, y, 140, 46, {
      ghost: true,
      fontSize: 16,
    });
    ui.button("leave", "离开房间", margin + 152, y, 140, 46, {
      danger: true,
      fontSize: 16,
    });
  } else if (model.practiceMode) {
    ui.button("restart", "重新摆球", margin, y, 140, 46, {
      ghost: true,
      fontSize: 16,
    });
    ui.button("exit", "退出对局", margin + 152, y, 140, 46, {
      danger: true,
      fontSize: 16,
    });
  } else {
    ui.button(
      "concede",
      (model.snapshot?.playerCount ?? 2) >= 3 ? "退出本局" : "认输",
      margin,
      y,
      120,
      46,
      {
        danger: true,
        fontSize: 16,
      },
    );
    ui.button("exit", "退出对局", margin + 132, y, 140, 46, {
      danger: true,
      fontSize: 16,
    });
  }
  ui.text(
    model.practiceMode
      ? "练习设置仅本机生效 · 上下拖动查看更多"
      : "房间设置由房主决定，全员同步 · 上下拖动查看更多",
    margin,
    y + 62,
    13,
    colors.sage500,
    "left",
    500,
  );

  for (let index = ui.buttons.length - 1; index >= firstButton; index -= 1) {
    const button = ui.buttons[index];
    if (
      button.y + button.height < metrics.contentTop ||
      button.y > metrics.contentBottom
    ) {
      ui.buttons.splice(index, 1);
    } else {
      button.clipTop = metrics.contentTop;
      button.clipBottom = metrics.contentBottom;
    }
  }
  ui.restore();

  if (metrics.maxScroll > 0) {
    const trackTop = metrics.contentTop + 8;
    const trackHeight = metrics.contentBottom - metrics.contentTop - 16;
    const thumbHeight = Math.max(
      40,
      trackHeight *
        (1 - metrics.maxScroll / menuContentHeight(expanded, cardsRow)),
    );
    const thumbTop =
      trackTop +
      (trackHeight - thumbHeight) *
        (scroll / Math.max(1, metrics.maxScroll));
    ui.context.fillStyle = withAlpha(colors.ivory100, 0.14);
    ui.path(layout.width - 6, trackTop, 3, trackHeight, 2);
    ui.context.fill();
    ui.context.fillStyle = withAlpha(colors.brass300, 0.6);
    ui.path(layout.width - 7, thumbTop, 4, thumbHeight, 2);
    ui.context.fill();
  }

  ui.context.fillStyle = withAlpha(colors.ink900, 0.99);
  ui.context.fillRect(
    0,
    metrics.contentBottom,
    layout.width,
    metrics.height - (metrics.contentBottom - metrics.y),
  );
  ui.divider(0, metrics.contentBottom, layout.width);
  ui.button(
    "closeModal",
    "返回台面",
    layout.width - margin - 200,
    metrics.y + metrics.height - 62,
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
  const online = !model.practiceMode && Boolean(model.room);
  const host =
    online &&
    (model.room?.hostPlayerIndex ?? 0) === (model.playerIndex ?? 0);
  const editable = !online || host;
  const aimLevel = model.practiceMode
    ? model.practicePredictionLevel
    : model.predictionLevel;
  const aim = aimLevel > 0 ? `${aimLevel} 档` : "关闭";
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
  ui.text(
    `当前 ${cameraLabel(model.cameraMode)} · 辅助线 ${aim} · ${playbackLabel(model.playbackSpeed)}`,
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

  const pillX = x + 92;
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
    online
      ? host
        ? "点选切换或隐藏视角，修改后全员同步"
        : "房主设置的可用视角，点选切换当前视角"
      : "点选切换视角；再点当前项可隐藏，至少保留一个",
    pillX,
    viewY + 58,
    13,
    colors.sage500,
    "left",
    500,
    width - (pillX - x) - 16,
  );

  const aimY = viewY + 82;
  ui.text("辅助线", x + 16, aimY + 19, 15, colors.ivory100, "left", 600);
  if (editable) {
    const prefix = model.practiceMode ? "practicePrediction" : "roomPrediction";
    const selected = model.practiceMode
      ? model.practicePredictionLevel
      : model.predictionLevel;
    for (let level = 0; level <= 5; level += 1) {
      ui.pill(
        `${prefix}:${level}`,
        level === 0 ? "关闭" : `${level} 档`,
        pillX + level * 58,
        aimY,
        52,
        38,
        selected === level,
      );
    }
  } else {
    ui.text(
      `${aim}（房主设置）`,
      pillX,
      aimY + 19,
      15,
      colors.sage500,
      "left",
      500,
    );
  }

  const speedY = aimY + 54;
  ui.text("快速播放", x + 16, speedY + 19, 15, colors.ivory100, "left", 600);
  if (editable) {
    playbackOptions.forEach((option, index) => {
      ui.pill(
        `playback:${option.id}`,
        option.label,
        pillX + index * 78,
        speedY,
        72,
        38,
        String(model.playbackSpeed) === option.id,
      );
    });
  } else {
    ui.text(
      `${playbackLabel(model.playbackSpeed)}（房主设置）`,
      pillX,
      speedY + 19,
      15,
      colors.sage500,
      "left",
      500,
    );
  }
  ui.text(
    online
      ? host
        ? "房主修改后立即同步到房间内所有玩家"
        : "由房主决定并同步，当前为只读"
      : "练习设置仅本机生效",
    x + 16,
    speedY + 52,
    13,
    colors.sage500,
    "left",
    500,
    width - 32,
  );
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
    model.room?.mode === "threeSnooker"
      ? "三人已到齐，准备开局"
      : "好友已加入，准备开局",
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
    `${gameName(room?.gameType ?? "eightball")} · ${mode}${room?.mode === "cards" ? ` ${room.cardCount} 张` : ""} · ${room?.players.length ?? 1}/${room?.maxPlayers ?? 2}`,
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
