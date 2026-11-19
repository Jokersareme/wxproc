import {
  cueBallPlacementLegal,
  defFor,
  hashSnapshot,
  MatchEngine,
  nearestLegalCueBallPosition,
  shotModifiers,
  tableDimensions,
  type CardId,
  type CardInstance,
  type GameType,
  type MatchSnapshot,
  type PhysicsEvent,
  type PlayerIndex,
  type ShotInput,
} from "@friend-billiards/core";
import type { RoomState, ServerMessage } from "@friend-billiards/protocol";
import {
  dragAimAngle,
  isAimDrag,
  pointInRect,
} from "./aim";
import { GameAudio } from "./audio";
import { Hud, type HudModel } from "./hud";
import { NetworkClient } from "./network";
import type { ClientPlatform, TouchPoint } from "./platform";
import { TableRenderer } from "./renderer";
import { clientToDesign } from "./ui/layout";
import { menuMetrics } from "./ui/screens/game";
import {
  normalisePlaybackSpeed,
  playbackDuration,
  PLAYBACK_SPEEDS,
} from "./playback";
import { spinToCueOffset } from "./spin";
import {
  cameraModes,
  cameraViewsStorageKey,
  detectQuality,
  hintStorageKey,
  isCameraMode,
  isQualityTier,
  lastRoomStorageKey,
  motionStorageKey,
  mutedStorageKey,
  parseCameraViews,
  playbackSpeedStorageKey,
  qualityStorageKey,
  volumeStorageKey,
} from "./quality";
import { gameName } from "./ui/format";
import type {
  CameraMode,
  QualityTier,
} from "./ui/model";
import { motion } from "./ui/theme";

const R_BALL = tableDimensions().ballRadius;

export interface GameAppOptions {
  serverUrl: string;
  sourceUrl: string;
  autoConnect?: boolean;
}

type Gesture =
  | "aim"
  | "power"
  | "fineAim"
  | "spin"
  | "place"
  | "menuScroll"
  | null;

interface StoredRoom {
  roomCode: string;
  gameType: GameType;
}

export class GameApp {
  private readonly table: TableRenderer;
  private readonly hud: Hud;
  private readonly network: NetworkClient;
  private readonly audio: GameAudio;
  private model: HudModel;
  private engine?: MatchEngine;
  private snapshot?: MatchSnapshot;
  private room?: RoomState;
  private userId = "";
  private playerIndex: PlayerIndex = 0;
  private angle = 0;
  private gesture: Gesture = null;
  private lastPoint?: TouchPoint;
  private aimStartPoint?: TouchPoint;
  private aimMoved = false;
  private lastPlacementLegal?: boolean;
  private homeSheetStartedAt?: number;
  private animating = false;
  private onlineMatch = false;
  private practicePredictionLevel = 0;
  private practiceCameraViews: CameraMode[];
  private practicePlaybackSpeed: number;
  private pendingInvitation?: { roomCode: string; inviteToken: string };
  private pendingCreate?: {
    gameType: GameType;
    mode: "classic" | "cards" | "threeSnooker";
    cardCount: number;
  };
  private toastTimer?: ReturnType<typeof setTimeout>;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private sharing = false;
  private countdownSyncSent = false;
  private lastCountdownSecond?: number;
  private serverTimeOffset = 0;
  private lastRoom?: StoredRoom;
  private hintSeen: boolean;
  private reduceMotion: boolean;
  private quality: QualityTier;
  private cameraMode: CameraMode = "top";
  private opponentTurnStartedAt?: number;
  private lastPulseRedraw = 0;
  private lastCameraMoving = false;
  private lastLoggedMessage = "";
  private foulFlashTimer?: ReturnType<typeof setTimeout>;
  private menuPendingAction?: string;
  private menuStartY = 0;
  private menuStartScroll = 0;
  private menuMoved = false;
  private practiceCardCount = 3;
  private lastPredictionApplied = -1;
  private lastSpinLimit = -1;

  constructor(
    private readonly platform: ClientPlatform,
    options: GameAppOptions,
  ) {
    this.quality = detectQuality(platform);
    this.hintSeen = platform.getStorage(hintStorageKey) === "1";
    this.reduceMotion = platform.getStorage(motionStorageKey) === "1";
    this.lastRoom = this.readLastRoom();
    const cameraViews = parseCameraViews(
      platform.getStorage(cameraViewsStorageKey),
    );
    this.practiceCameraViews = [...cameraViews];
    this.practicePlaybackSpeed = normalisePlaybackSpeed(
      Number(platform.getStorage(playbackSpeedStorageKey)),
    );
    this.cameraMode = cameraViews[0];
    const muted = platform.getStorage(mutedStorageKey) === "1";
    const volume = Number(platform.getStorage(volumeStorageKey));
    const initialVolume = Number.isFinite(volume) && volume > 0 ? volume : 0.8;
    if (!platform.getStorage(volumeStorageKey))
      platform.setStorage(volumeStorageKey, String(initialVolume));
    this.audio = new GameAudio(platform, {
      muted,
      volume: initialVolume,
    });
    this.audio.setVolume(initialVolume);
    this.table = new TableRenderer(platform, { quality: this.quality });
    this.table.setReduceMotion(this.reduceMotion);
    this.hud = new Hud(platform, this.table.renderer);
    this.model = {
      screen: "home",
      power: 0.5,
      spinX: 0,
      spinY: 0,
      fineAimOffset: 0,
      canShoot: false,
      animating: false,
      canSkip: false,
      playbackSpeed: this.practicePlaybackSpeed,
      online: false,
      sourceUrl: options.sourceUrl,
      message: undefined,
      menuOpen: false,
      menuScroll: 0,
      spinOpen: false,
      soundOn: !muted,
      createPredictionLevel: 0,
      createPlaybackSpeed: this.practicePlaybackSpeed,
      createCameraViews: [...this.practiceCameraViews],
      predictionLevel: 0,
      practicePredictionLevel: 0,
      practiceMode: false,
      creating: false,
      confirm: null,
      homeSheet: null,
      homeSheetProgress: 1,
      homeGameType: "eightball",
      roomStatus: "trial",
      roomMode: "classic",
      trial: false,
      countdownEnd: null,
      roomOverlayOpen: false,
      settingsOpen: false,
      cameraMode: this.cameraMode,
      cameraViews,
      cameraMoving: false,
      roomSettingsOpen: false,
      reduceMotion: this.reduceMotion,
      quality: this.quality,
      showHint: !this.hintSeen,
      continueRoom: this.lastRoom,
      opponentWaitingSeconds: 0,
      eventLog: [],
      eventLogOpen: false,
      foulFlashUntil: undefined,
      cardHandOpen: false,
      spinLimit: 0.45,
      createMode: "classic",
      createCardCount: 3,
      practiceCardCount: 3,
    };
    this.network = new NetworkClient(platform, options.serverUrl, {
      onMessage: (message) => this.onMessage(message),
      onOnline: (online, message) => {
        this.model.online = online;
        if (!online) {
          this.model.creating = false;
          this.pendingCreate = undefined;
        }
        if (online && this.pendingInvitation) {
          const invitation = this.pendingInvitation;
          this.pendingInvitation = undefined;
          this.joinRoom(invitation.roomCode, invitation.inviteToken);
        }
        if (online && this.pendingCreate) {
          const pending = this.pendingCreate;
          this.pendingCreate = undefined;
          this.createRoom(pending.gameType, pending.mode, pending.cardCount);
        }
        if (this.model.screen === "friend") this.model.message = message;
        this.redraw();
      },
    });
    this.showHomeTable();
  }

  start() {
    this.platform.onTouchStart((point) => this.touchStart(point));
    this.platform.onTouchMove((point) => this.touchMove(point));
    this.platform.onTouchEnd((point) => this.touchEnd(point));
    this.platform.onResize(() => {
      this.table.resize();
      this.redraw();
    });
    this.redraw();
    const loop = (time: number) => {
      this.table.render();
      this.hud.render();
      const stamp = Number.isFinite(time) ? time : Date.now();
      if (this.model.homeSheet && this.model.homeSheetProgress < 1) {
        if (!this.homeSheetStartedAt) this.homeSheetStartedAt = Date.now();
        const next = Math.min(
          1,
          (Date.now() - this.homeSheetStartedAt) / motion.panel,
        );
        if (next !== this.model.homeSheetProgress) {
          this.model.homeSheetProgress = next;
          this.redraw();
        }
      }
      if (
        this.model.screen === "game" &&
        this.onlineMatch &&
        this.snapshot?.phase === "aiming" &&
        this.snapshot.currentPlayer !== this.playerIndex &&
        stamp - this.lastPulseRedraw > 500
      ) {
        this.lastPulseRedraw = stamp;
        this.redraw();
      }
      const moving = this.table.cameraMoving;
      if (moving !== this.lastCameraMoving) {
        this.lastCameraMoving = moving;
        this.redraw();
      }
      this.platform.requestAnimationFrame(loop);
    };
    this.platform.requestAnimationFrame(loop);
  }

  connect() {
    return this.network.connect().catch((error) => {
      this.model.online = false;
      this.model.message = `联机不可用：${error.message ?? "请稍后重试"}`;
      this.redraw();
    });
  }

  joinInvitation(roomCode: string, inviteToken: string) {
    this.pendingInvitation = { roomCode, inviteToken };
    this.model.screen = "friend";
    if (this.model.online) {
      this.pendingInvitation = undefined;
      this.joinRoom(roomCode, inviteToken);
    } else {
      void this.connect();
    }
    this.redraw();
  }

  private redraw() {
    if (
      this.snapshot?.canRepositionCue &&
      this.model.message === this.snapshot.lastMessage
    )
      this.model.message = undefined;
    this.model.snapshot = this.snapshot;
    this.model.room = this.room;
    this.model.roomCode = this.room?.roomCode;
    this.model.playerIndex = this.playerIndex;
    this.model.roomStatus = this.room?.status ?? "trial";
    this.model.roomMode = this.room?.mode ?? "classic";
    this.model.trial =
      this.room?.status === "trial" && Boolean(this.snapshot?.practice);
    this.model.animating = this.animating;
    this.model.canSkip = this.table.isAnimating();
    this.model.cameraMode = this.cameraMode;
    this.model.cameraMoving = this.table.cameraMoving;
    this.model.quality = this.quality;
    this.model.reduceMotion = this.reduceMotion;
    this.model.continueRoom =
      this.model.screen === "home" ? this.lastRoom : undefined;
    this.model.opponentWaitingSeconds = this.opponentTurnStartedAt
      ? Math.max(
          0,
          Math.floor((Date.now() - this.opponentTurnStartedAt) / 1000),
        )
      : 0;
    this.table.setTableMode(
      Boolean(this.snapshot?.cards?.enabled),
      this.snapshot?.playerCount ?? 2,
      Boolean(this.snapshot?.practice),
    );
    const modifiers = shotModifiers(
      this.snapshot?.cards ?? null,
      this.snapshot?.currentPlayer ?? 0,
    );
    this.model.spinLimit = modifiers.spinLimit;
    const basePrediction = this.onlineMatch
      ? this.model.predictionLevel
      : this.practicePredictionLevel;
    const effectivePrediction = this.snapshot?.cards?.enabled
      ? Math.min(5, basePrediction + modifiers.predictionBonus)
      : basePrediction;
    if (effectivePrediction !== this.lastPredictionApplied) {
      this.lastPredictionApplied = effectivePrediction;
      this.table.setPredictionLevel(effectivePrediction);
    }
    this.model.canShoot = Boolean(
      this.snapshot &&
      this.snapshot.phase === "aiming" &&
      !this.animating &&
      !this.table.cameraMoving &&
      !this.model.cardTargetUid &&
      this.room?.status !== "starting" &&
      (!this.onlineMatch || this.snapshot.currentPlayer === this.playerIndex),
    );
    if (this.model.screen === "game") {
      const status = this.model.message ?? this.snapshot?.lastMessage;
      if (status && status !== this.lastLoggedMessage) {
        this.lastLoggedMessage = status;
        if (!status.startsWith("击球进行中") && !status.startsWith("等待服务器判定")) {
          this.model.eventLog.push({ at: Date.now(), text: status });
          if (this.model.eventLog.length > 20)
            this.model.eventLog.splice(0, this.model.eventLog.length - 20);
        }
        if (status.startsWith("犯规")) {
          this.model.foulFlashUntil = Date.now() + 400;
          if (this.foulFlashTimer) clearTimeout(this.foulFlashTimer);
          this.foulFlashTimer = setTimeout(() => {
            this.model.foulFlashUntil = undefined;
            this.redraw();
          }, 420);
        }
      }
    }
    this.hud.updatePointerSize(this.platform.width, this.platform.height);
    this.hud.draw(this.model);
  }

  private touchStart(point: TouchPoint) {
    this.audio.unlock();
    this.lastPoint = point;
    this.hud.updatePointerSize(this.platform.width, this.platform.height);
    const action = this.hud.hit(
      point.x,
      point.y,
      this.platform.width,
      this.platform.height,
    );
    if (action === "spinPad") {
      this.gesture = "spin";
      this.touchMove(point);
      return;
    }
    if (action === "power" || action === "fineAim") {
      this.gesture = action;
      this.touchMove(point);
      return;
    }
    if (this.menuHandlesTouch()) {
      const design = clientToDesign(point.x, point.y, this.hud.layout);
      const metrics = menuMetrics(
        this.hud.layout,
        this.model.roomSettingsOpen,
        this.practiceCardsVisible(),
      );
      if (design.y >= metrics.y) {
        this.gesture = "menuScroll";
        this.menuStartY = point.y;
        this.menuStartScroll = this.model.menuScroll;
        this.menuMoved = false;
        this.menuPendingAction =
          action && action !== "modalMask" ? action : undefined;
        this.lastPoint = point;
        return;
      }
      this.closeModals();
      this.redraw();
      return;
    }
    if (action) {
      void this.action(action);
      return;
    }
    if (this.model.cardTargetUid && this.model.screen === "game") {
      this.cardTargetTouch(point);
      return;
    }
    if (this.model.homeSheet) {
      this.model.homeSheet = null;
      this.homeSheetStartedAt = undefined;
      this.model.homeSheetProgress = 1;
      this.redraw();
      return;
    }
    if (this.model.settingsOpen) {
      this.model.settingsOpen = false;
      this.redraw();
      return;
    }
    if (
      this.model.menuOpen ||
      this.model.spinOpen ||
      this.model.confirm ||
      this.model.eventLogOpen ||
      this.model.roomOverlayOpen
    ) {
      this.closeModals();
      this.redraw();
      return;
    }
    if (this.room?.status === "starting") return;
    if (this.model.screen !== "game" || this.animating || !this.snapshot)
      return;
    const myTurn =
      !this.onlineMatch || this.snapshot.currentPlayer === this.playerIndex;
    if (!myTurn) return;
    if (this.snapshot.phase === "ballInHand") {
      this.gesture = "place";
      this.lastPlacementLegal = undefined;
      this.touchMove(point);
    } else if (this.snapshot.phase === "aiming") {
      const position = this.table.screenToTable(point.x, point.y);
      const cue = this.snapshot.balls[0];
      const nearCue =
        Math.hypot(position.x - cue.pos[0], position.y - cue.pos[1]) <
        tableDimensions().ballRadius * 3;
      this.gesture =
        this.snapshot.canRepositionCue && nearCue ? "place" : "aim";
      if (this.gesture === "aim") {
        const design = clientToDesign(point.x, point.y, this.hud.layout);
        if (!pointInRect(design, this.table.tableViewport())) {
          this.gesture = null;
          return;
        }
        this.aimStartPoint = point;
        this.aimMoved = false;
      } else {
        this.lastPlacementLegal = undefined;
        this.touchMove(point);
      }
    }
  }

  private touchMove(point: TouchPoint) {
    if (!this.gesture) return;
    let redraw = true;
    if (this.gesture === "power") {
      this.model.power = this.hud.powerAt(point.y);
      this.syncAim();
    } else if (this.gesture === "fineAim" && this.lastPoint) {
      const delta =
        (point.y - this.lastPoint.y) *
        (this.hud.layout.height / this.platform.height);
      this.angle += delta * 0.00025;
      this.model.fineAimOffset = Math.max(
        -1,
        Math.min(1, this.model.fineAimOffset + delta / 185),
      );
      this.syncAim();
    } else if (this.gesture === "spin") {
      const spin = this.hud.spinAt(point.x, point.y, this.model.spinLimit);
      this.model.spinX = spin.x;
      this.model.spinY = spin.y;
      this.syncAim();
    } else if (this.gesture === "menuScroll") {
      const scale = this.hud.layout.height / this.platform.height;
      const delta = (point.y - this.menuStartY) * scale;
      const metrics = menuMetrics(
        this.hud.layout,
        this.model.roomSettingsOpen,
        this.practiceCardsVisible(),
      );
      this.model.menuScroll = Math.max(
        0,
        Math.min(metrics.maxScroll, this.menuStartScroll - delta),
      );
      if (Math.abs(delta) > 8) this.menuMoved = true;
    } else if (
      this.gesture === "aim" &&
      this.aimStartPoint &&
      this.lastPoint
    ) {
      this.aimMoved ||= isAimDrag(
        this.aimStartPoint,
        point,
        1 / this.hud.layout.scale,
      );
      if (this.aimMoved) {
        this.angle = dragAimAngle(
          this.angle,
          this.lastPoint,
          point,
          1 / this.hud.layout.scale,
        );
        this.syncAim();
      } else {
        redraw = false;
      }
    } else if (this.gesture === "place" && this.snapshot) {
      const position = this.table.screenToTable(point.x, point.y);
      const legal = cueBallPlacementLegal(
        this.snapshot,
        position.x,
        position.y,
      );
      this.table.previewCueBall(position.x, position.y, legal);
      if (legal === this.lastPlacementLegal) {
        redraw = false;
      } else {
        this.lastPlacementLegal = legal;
        this.model.message = legal
          ? "自由球：拖动白球到合法位置"
          : "此处不能放球，松手会移到最近的合法位置";
      }
    }
    this.lastPoint = point;
    if (redraw) this.redraw();
  }

  private touchEnd(point: TouchPoint) {
    if (this.gesture === "menuScroll") {
      const pending = this.menuPendingAction;
      const moved = this.menuMoved;
      this.gesture = null;
      this.lastPoint = undefined;
      this.menuPendingAction = undefined;
      this.menuMoved = false;
      if (!moved && pending) void this.action(pending);
      return;
    }
    if (this.gesture === "aim" && this.aimStartPoint && !this.aimMoved) {
      this.aimAt(point);
    }
    if (this.gesture === "place" && this.snapshot) {
      const dropped = this.table.screenToTable(point.x, point.y);
      const snapped = cueBallPlacementLegal(
        this.snapshot,
        dropped.x,
        dropped.y,
      )
        ? undefined
        : nearestLegalCueBallPosition(
            this.snapshot,
            dropped.x,
            dropped.y,
          );
      const position = snapped ?? dropped;
      if (
        !cueBallPlacementLegal(this.snapshot, position.x, position.y)
      ) {
        this.model.message = "此处不能放球，请换一个位置";
        this.audio.playUi("error");
        this.platform.vibrate("medium");
        this.table.sync(this.snapshot);
      } else {
        try {
          if (this.onlineMatch && this.room) {
            this.network.send({
              type: "placeBall",
              matchId: this.room.matchId,
              x: position.x,
              y: position.y,
            });
            this.table.sync(this.snapshot);
          } else if (this.engine) {
            this.snapshot = this.engine.placeCueBall(
              position.x,
              position.y,
              this.playerIndex,
            );
            this.table.sync(this.snapshot);
          }
          if (snapped) {
            this.model.message = "已移到最近的合法位置";
          } else if (!this.onlineMatch) {
            this.model.message = this.snapshot.lastMessage ?? undefined;
          }
        } catch (error: any) {
          this.model.message = error.message;
          this.audio.playUi("error");
          this.table.sync(this.snapshot);
        }
      }
    }
    this.gesture = null;
    this.lastPoint = undefined;
    this.aimStartPoint = undefined;
    this.aimMoved = false;
    this.lastPlacementLegal = undefined;
    this.model.fineAimOffset = 0;
    this.redraw();
  }

  private aimAt(point: TouchPoint) {
    if (!this.snapshot) return;
    const position = this.table.screenToTable(point.x, point.y);
    const cue = this.snapshot.balls[0];
    const dx = position.x - cue.pos[0];
    const dy = position.y - cue.pos[1];
    if (Math.hypot(dx, dy) < 0.0001) return;
    this.angle = Math.atan2(dy, dx);
    this.syncAim();
  }

  private syncAim() {
    this.table.setAim(
      this.angle,
      this.model.power,
      this.model.spinX,
      this.model.spinY,
    );
  }

  private async action(action: string) {
    this.platform.vibrate("light");
    this.audio.playUi("tap");
    if (action.startsWith("practice:")) {
      this.startPractice(action.split(":")[1] as GameType);
      return;
    }
    if (action === "cardHand") {
      if (this.cardHand().length === 0) {
        this.showToast("当前没有可用卡牌");
        return;
      }
      this.model.cardHandOpen = !this.model.cardHandOpen;
      this.audio.playUi(this.model.cardHandOpen ? "open" : "close");
      this.redraw();
      return;
    }
    if (action.startsWith("card:")) {
      this.openCard(action.slice("card:".length));
      return;
    }
    if (action === "cardUse") {
      this.useCard();
    } else if (action === "cardCancel") {
      this.closeCardUi();
    } else if (action.startsWith("cardEffect:")) {
      this.playCard({ targetEffectId: action.slice("cardEffect:".length) });
    } else if (action.startsWith("practiceCardCount:")) {
      const count = Math.max(
        0,
        Math.min(6, Number(action.split(":")[1]) || 0),
      );
      this.practiceCardCount = count;
      this.model.practiceCardCount = count;
      if (!this.onlineMatch && this.snapshot?.cards)
        this.startPractice(this.snapshot.gameType, "cards", count);
    } else if (action.startsWith("createMode:")) {
      const mode = action.split(":")[1];
      if (
        mode === "classic" ||
        mode === "cards" ||
        mode === "threeSnooker"
      ) {
        this.model.createMode = mode;
        if (mode === "threeSnooker") this.model.homeGameType = "snooker";
      }
    } else if (action.startsWith("createCardCount:")) {
      this.model.createCardCount = Math.max(
        0,
        Math.min(6, Number(action.split(":")[1]) || 0),
      );
    } else if (action.startsWith("create:")) {
      this.createRoom(action.split(":")[1] as GameType);
    } else if (action === "prediction:toggle") {
      this.model.createPredictionLevel =
        this.model.createPredictionLevel > 0 ? 0 : 3;
    } else if (action.startsWith("prediction:")) {
      this.model.createPredictionLevel = Number(action.split(":")[1]);
    } else if (action.startsWith("createPlayback:")) {
      this.model.createPlaybackSpeed = normalisePlaybackSpeed(
        Number(action.split(":")[1]),
      );
    } else if (action.startsWith("createCameraView:")) {
      const mode = action.split(":")[1];
      if (isCameraMode(mode)) {
        const views = this.model.createCameraViews;
        if (views.includes(mode)) {
          if (views.length === 1) this.showToast("至少保留一个视角");
          else
            this.model.createCameraViews = views.filter(
              (entry) => entry !== mode,
            );
        } else {
          this.model.createCameraViews = cameraModes.filter(
            (entry) => entry === mode || views.includes(entry),
          );
        }
      }
    } else if (action.startsWith("roomPrediction:")) {
      const level = Math.max(
        0,
        Math.min(5, Number(action.split(":")[1]) || 0),
      );
      this.updateRoomSettings({ predictionLevel: level });
    } else if (action.startsWith("practicePrediction:")) {
      const level = Math.max(
        0,
        Math.min(5, Number(action.split(":")[1]) || 0),
      );
      this.practicePredictionLevel = level;
      this.model.practicePredictionLevel = level;
      if (!this.onlineMatch && this.model.screen === "game") {
        this.model.predictionLevel = level;
        this.table.setPredictionLevel(level);
      }
    } else if (action === "friend") {
      this.model.screen = "friend";
      this.model.message = undefined;
      this.table.setPresentation("hidden");
      void this.connect();
    } else if (action === "join") {
      const roomInput = await this.platform.prompt(
        "输入六位房间码",
        "例如 123456；也可粘贴邀请链接",
      );
      if (!roomInput) return;
      const trimmed = roomInput.trim();
      const query = new URLSearchParams(
        trimmed.includes("=") ? trimmed.replace(/^\?/, "") : "",
      );
      const roomCode = (query.get("roomCode") ?? trimmed).trim();
      const inviteToken = (query.get("inviteToken") ?? "").trim();
      this.joinRoom(roomCode, inviteToken);
    } else if (action === "share" && this.room) {
      if (this.sharing) return;
      this.sharing = true;
      try {
        await this.platform.share({
          title: `来打一局${gameName(this.room.gameType)}，房间 ${this.room.roomCode}`,
          roomCode: this.room.roomCode,
          inviteToken: this.room.inviteToken,
        });
      } finally {
        this.sharing = false;
      }
    } else if (action === "copyCode" && this.room) {
      await this.platform.copyText(this.room.roomCode);
      this.showToast("房间码已复制");
    } else if (action === "ready" && this.room) {
      const me = this.room.players.find(
        (player) => player.playerIndex === this.playerIndex,
      );
      this.network.send({
        type: "ready",
        roomCode: this.room.roomCode,
        ready: !me?.ready,
      });
    } else if (action === "leave") {
      this.leaveRoom();
      this.goHome();
    } else if (action === "back") {
      if (this.room) this.leaveRoom();
      this.goHome();
    } else if (action === "exit") {
      if (this.snapshot?.phase === "gameOver") {
        if (this.onlineMatch && this.room) this.leaveRoom();
        this.goHome();
      } else {
        this.model.confirm = {
          action: "exitConfirm",
          text:
            this.onlineMatch && this.room
              ? "退出将离开房间，好友会收到通知"
              : "确认退出练习？",
        };
      }
    } else if (action === "concede") {
      if (this.onlineMatch && this.room)
        this.model.confirm = {
          action: "concedeConfirm",
          text:
            (this.snapshot?.playerCount ?? 2) >= 3
              ? "确认退出本局？将跳过你的回合"
              : "确认认输？本局判负",
        };
    } else if (action === "concedeConfirm") {
      this.model.confirm = null;
      if (this.onlineMatch && this.room) {
        this.network.send({ type: "concede", matchId: this.room.matchId });
        this.model.message = "已认输，等待结算";
      }
    } else if (action === "confirmYes") {
      const confirmed = this.model.confirm?.action;
      this.model.confirm = null;
      if (confirmed) await this.action(confirmed);
      return;
    } else if (action === "exitConfirm") {
      this.model.confirm = null;
      if (this.onlineMatch && this.room) this.leaveRoom();
      this.goHome();
    } else if (action === "confirmNo") {
      this.model.confirm = null;
    } else if (action === "menu") {
      this.model.menuOpen = true;
      this.model.menuScroll = 0;
      this.audio.playUi("open");
    } else if (action === "spinButton") {
      this.model.spinOpen = true;
      this.audio.playUi("open");
    } else if (action.startsWith("spinPreset:")) {
      const values: Record<string, [number, number]> = {
        center: [0, 0],
        high: [0, -0.3],
        low: [0, 0.3],
        left: [-0.3, 0],
        right: [0.3, 0],
      };
      const value = values[action.split(":")[1]];
      if (value) {
        this.model.spinX = value[0];
        this.model.spinY = value[1];
        this.syncAim();
      }
    } else if (action.startsWith("playback:")) {
      const speed = Number(action.split(":")[1]);
      if ((PLAYBACK_SPEEDS as readonly number[]).includes(speed)) {
        if (this.canEditRoomSettings()) {
          this.updateRoomSettings({ playbackSpeed: speed });
        } else if (!this.onlineMatch) {
          this.practicePlaybackSpeed = speed;
          this.model.playbackSpeed = speed;
          this.platform.setStorage(playbackSpeedStorageKey, String(speed));
        }
      }
    } else if (action === "skipShot") {
      this.table.skipAnimation();
    } else if (action === "modalMask" || action === "closeModal") {
      this.closeModals();
      this.audio.playUi("close");
    } else if (action === "homeSheetMask" || action === "homeClose") {
      this.model.homeSheet = null;
      this.homeSheetStartedAt = undefined;
      this.model.homeSheetProgress = 1;
      this.audio.playUi("close");
    } else if (
      action === "settingsMask" ||
      action === "settingsClose"
    ) {
      this.model.settingsOpen = false;
      this.audio.playUi("close");
    } else if (action === "settings") {
      this.model.settingsOpen = true;
      this.audio.playUi("open");
    } else if (action === "online") {
      if (this.model.online) this.showToast("联机正常");
      else {
        this.model.message = "正在重连…";
        void this.connect();
      }
    } else if (action === "homeClassic") {
      this.model.homeSheet = "classic";
      this.homeSheetStartedAt = this.reduceMotion ? undefined : Date.now();
      this.model.homeSheetProgress = this.reduceMotion ? 1 : 0;
      this.audio.playUi("open");
    } else if (action === "homePractice") {
      this.model.homeSheet = "practice";
      this.homeSheetStartedAt = this.reduceMotion ? undefined : Date.now();
      this.model.homeSheetProgress = this.reduceMotion ? 1 : 0;
      this.audio.playUi("open");
    } else if (action === "homeCards") {
      this.model.homeSheet = "cards";
      this.model.homeGameType = "eightball";
      this.homeSheetStartedAt = this.reduceMotion ? undefined : Date.now();
      this.model.homeSheetProgress = this.reduceMotion ? 1 : 0;
      this.audio.playUi("open");
    } else if (action === "homeThree") {
      this.model.homeSheet = "three";
      this.model.homeGameType = "snooker";
      this.homeSheetStartedAt = this.reduceMotion ? undefined : Date.now();
      this.model.homeSheetProgress = this.reduceMotion ? 1 : 0;
      this.audio.playUi("open");
    } else if (action.startsWith("homeGame:")) {
      this.model.homeGameType = action.split(":")[1] as GameType;
    } else if (action === "homeStart") {
      const gameType = this.model.homeGameType;
      const sheet = this.model.homeSheet;
      this.model.homeSheet = null;
      this.homeSheetStartedAt = undefined;
      this.model.homeSheetProgress = 1;
      if (sheet === "cards")
        this.startPractice(gameType, "cards", this.model.createCardCount);
      else this.startPractice(gameType);
    } else if (action === "homeCreate") {
      const sheet = this.model.homeSheet;
      this.model.homeSheet = null;
      this.homeSheetStartedAt = undefined;
      this.model.homeSheetProgress = 1;
      if (sheet === "three") this.createRoom("snooker", "threeSnooker", 0);
      else if (sheet === "cards")
        this.createRoom(
          this.model.homeGameType,
          "cards",
          this.model.createCardCount,
        );
      else this.createRoom(this.model.homeGameType);
    } else if (action === "continueRoom" && this.lastRoom) {
      if (this.model.online) this.joinRoom(this.lastRoom.roomCode, "");
      else {
        this.pendingInvitation = {
          roomCode: this.lastRoom.roomCode,
          inviteToken: "",
        };
        void this.connect();
      }
    } else if (action === "dismissHint") {
      this.hintSeen = true;
      this.model.showHint = false;
      this.platform.setStorage(hintStorageKey, "1");
      this.audio.playUi("close");
    } else if (action === "roomSettings") {
      this.model.roomSettingsOpen = !this.model.roomSettingsOpen;
      this.model.menuScroll = 0;
      this.audio.playUi(this.model.roomSettingsOpen ? "open" : "close");
    } else if (action.startsWith("cameraView:")) {
      this.toggleCameraView(action.split(":")[1] as CameraMode);
    } else if (action === "camera") {
      const order = this.model.cameraViews;
      const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
      this.setCameraMode(next);
    } else if (action.startsWith("camera:")) {
      this.setCameraMode(action.split(":")[1] as CameraMode);
    } else if (action === "sound") {
      const on = !this.model.soundOn;
      this.model.soundOn = on;
      this.audio.setMuted(!on);
      this.platform.setStorage(mutedStorageKey, on ? "0" : "1");
      this.showToast(on ? "音效已开启" : "音效已关闭");
    } else if (action === "motion") {
      this.reduceMotion = !this.reduceMotion;
      this.table.setReduceMotion(this.reduceMotion);
      this.model.reduceMotion = this.reduceMotion;
      this.platform.setStorage(motionStorageKey, this.reduceMotion ? "1" : "0");
      this.showToast(this.reduceMotion ? "已减少动态效果" : "已恢复动态效果");
    } else if (action.startsWith("quality:")) {
      const tier = action.split(":")[1];
      if (isQualityTier(tier)) {
        this.quality = tier;
        this.model.quality = tier;
        this.platform.setStorage(qualityStorageKey, tier);
        this.table.setQuality(tier);
        this.showToast(`画质：${tier === "high" ? "高" : tier === "medium" ? "中" : "低"}`);
      }
    } else if (action === "eventLog") {
      this.model.eventLogOpen = true;
      this.audio.playUi("open");
    } else if (action === "roomOverlay") {
      this.model.roomOverlayOpen = true;
      this.audio.playUi("open");
    } else if (action === "closeRoomOverlay") {
      this.model.roomOverlayOpen = false;
      this.audio.playUi("close");
    } else if (action === "shoot") {
      this.shoot();
    } else if (action === "restart" && this.snapshot) {
      if (this.onlineMatch && this.room?.status === "trial") {
        this.network.send({
          type: "rematch",
          matchId: this.room.matchId,
        });
        this.model.message = "正在重新摆球…";
      } else {
        this.startPractice(
          this.snapshot.gameType,
          this.snapshot.cards?.enabled ? "cards" : "classic",
          this.model.practiceCardCount,
        );
      }
    } else if (action === "rematch" && this.room) {
      this.network.send({ type: "rematch", matchId: this.room.matchId });
      this.model.message = "已确认再来一局，等待对手";
    } else if (action === "nominate" && this.snapshot) {
      const snapshot = this.snapshot;
      const current = snapshot.target.nominatedBall ?? 0;
      const candidates = [1, 2, 3, 4, 5, 6].filter((ballId) => {
        const ball = snapshot.balls[ballId];
        const isCurrentTarget =
          !snapshot.target.targetIsRed &&
          !snapshot.target.previousPotRed &&
          ballId === snapshot.target.nextColour;
        return ball && ball.state !== "InPocket" && !isCurrentTarget;
      });
      if (candidates.length === 0) return this.showToast("当前没有可提名的彩球");
      const index = candidates.indexOf(current);
      const ballId = candidates[(index + 1) % candidates.length];
      if (this.onlineMatch && this.room) {
        this.network.send({
          type: "nominateFreeBall",
          matchId: this.room.matchId,
          ballId,
        });
      } else if (this.engine) {
        try {
          this.snapshot = this.engine.nominateFreeBall(ballId, this.playerIndex);
          this.table.sync(this.snapshot);
          this.model.message = this.snapshot.lastMessage ?? undefined;
          this.showToast(this.model.message);
        } catch (error: any) {
          this.model.message = error.message;
          this.audio.playUi("error");
        }
      }
    } else if (
      action === "license" ||
      action === "rules" ||
      action === "about"
    ) {
      this.model.screen = "license";
      this.closeModals();
      this.model.settingsOpen = false;
      this.table.setPresentation("hidden");
    } else if (action === "copySource") {
      await this.platform.prompt("对应源码地址", this.model.sourceUrl);
    }
    this.redraw();
  }

  private practiceCardsVisible() {
    return Boolean(
      !this.onlineMatch &&
        this.model.practiceMode &&
        this.snapshot?.cards?.enabled,
    );
  }

  private cardHand(): CardInstance[] {
    const cards = this.snapshot?.cards;
    if (!cards?.enabled) return [];
    const player = this.onlineMatch
      ? this.playerIndex
      : (this.snapshot?.currentPlayer ?? 0);
    return cards.hands[player] ?? [];
  }

  private openCard(uid: string) {
    const snapshot = this.snapshot;
    const cards = snapshot?.cards;
    if (!snapshot || !cards?.enabled) return;
    if (this.onlineMatch) {
      if (this.model.roomStatus !== "playing" && this.model.roomStatus !== "trial")
        return this.showToast("对局开始后才能使用卡牌");
      if (snapshot.currentPlayer !== this.playerIndex)
        return this.showToast("轮到你时才能使用");
    }
    if (cards.playedThisTurn) return this.showToast("本回合已经用过卡牌");
    if (
      cards.active.some(
        (effect) =>
          effect.kind === "silence" &&
          effect.target ===
            (this.onlineMatch ? this.playerIndex : snapshot.currentPlayer) &&
          effect.owner !==
            (this.onlineMatch ? this.playerIndex : snapshot.currentPlayer),
      )
    )
      return this.showToast("你被沉默，下回合不能出牌");
    if (!this.cardHand().some((card) => card.uid === uid)) return;
    this.model.cardDetailUid = uid;
    this.model.cardEffectPick = false;
    this.audio.playUi("open");
    this.redraw();
  }

  private useCard() {
    const uid = this.model.cardDetailUid;
    if (!uid) return;
    const card = this.cardHand().find((entry) => entry.uid === uid);
    if (!card) return this.closeCardUi();
    const definition = defFor(card.cardId);
    if (definition.target === "effect") {
      this.model.cardEffectPick = true;
    } else if (definition.target === "objectBall") {
      this.model.cardTargetUid = uid;
      this.model.cardDetailUid = undefined;
      this.model.cardTargetBallId = undefined;
      this.model.message =
        definition.id === "command"
          ? "号令：点击台面选择本杆首碰球"
          : "移形换位：点击台面选择要移动的球";
    } else {
      this.playCard({});
    }
    this.redraw();
  }

  private closeCardUi() {
    this.model.cardHandOpen = false;
    this.model.cardDetailUid = undefined;
    this.model.cardTargetUid = undefined;
    this.model.cardTargetBallId = undefined;
    this.model.cardEffectPick = false;
  }

  private playCard(extra: {
    targetBallId?: number;
    targetPos?: { x: number; y: number };
    targetEffectId?: string;
  }) {
    const uid = this.model.cardDetailUid ?? this.model.cardTargetUid;
    if (!uid || !this.snapshot?.cards) return;
    this.closeCardUi();
    if (this.onlineMatch && this.room) {
      this.network.send({
        type: "playCard",
        matchId: this.room.matchId,
        cardUid: uid,
        ...extra,
      });
      this.model.message = "等待卡牌结算…";
    } else if (this.engine) {
      try {
        const result = this.engine.playCard(
          this.snapshot.currentPlayer,
          { cardUid: uid, ...extra },
        );
        this.snapshot = result.snapshot;
        this.table.sync(result.snapshot);
        this.model.message = result.snapshot.lastMessage ?? undefined;
        this.showToast(result.snapshot.lastMessage ?? undefined);
        this.audio.playUi("open");
      } catch (error: any) {
        this.model.message = error.message;
        this.audio.playUi("error");
      }
    }
    this.redraw();
  }

  private cardTargetTouch(point: TouchPoint) {
    const uid = this.model.cardTargetUid;
    const snapshot = this.snapshot;
    if (!uid || !snapshot) return;
    const card = this.cardHand().find((entry) => entry.uid === uid);
    if (!card) return this.closeCardUi();
    const definition = defFor(card.cardId);
    const position = this.table.screenToTable(point.x, point.y);
    if (definition.id === "shuffle") {
      if (this.model.cardTargetBallId === undefined) {
        const ballId = this.ballAt(position);
        if (ballId === null)
          return this.showToast("请点击一颗台面上的球");
        this.model.cardTargetBallId = ballId;
        this.model.message = "已选球，点击台面选择落点";
        this.redraw();
        return;
      }
      this.playCard({
        targetBallId: this.model.cardTargetBallId,
        targetPos: position,
      });
      return;
    }
    const ballId = this.ballAt(position);
    if (ballId === null) return this.showToast("请点击一颗台面上的球");
    this.playCard({ targetBallId: ballId });
  }

  private ballAt(position: { x: number; y: number }): number | null {
    if (!this.snapshot) return null;
    let best: number | null = null;
    let bestDistance = R_BALL * 3;
    for (const ball of this.snapshot.balls) {
      if (ball.id === 0 || ball.state === "InPocket") continue;
      const distance = Math.hypot(
        ball.pos[0] - position.x,
        ball.pos[1] - position.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = ball.id;
      }
    }
    return best;
  }

  private canEditRoomSettings() {
    return (
      this.onlineMatch &&
      Boolean(this.room) &&
      (this.room?.hostPlayerIndex ?? 0) === this.playerIndex
    );
  }

  private updateRoomSettings(patch: {
    predictionLevel?: number;
    playbackSpeed?: number;
    cameraViews?: CameraMode[];
  }) {
    if (!this.room) return;
    if (!this.canEditRoomSettings()) {
      this.showToast("只有房主可以修改房间设置");
      return;
    }
    if (patch.predictionLevel !== undefined) {
      this.model.predictionLevel = patch.predictionLevel;
      this.table.setPredictionLevel(patch.predictionLevel);
    }
    if (patch.playbackSpeed !== undefined)
      this.model.playbackSpeed = patch.playbackSpeed;
    if (patch.cameraViews) {
      this.model.cameraViews = cameraModes.filter((mode) =>
        patch.cameraViews!.includes(mode),
      );
      if (!this.model.cameraViews.includes(this.cameraMode))
        this.setCameraMode(this.model.cameraViews[0]);
    }
    this.network.send({
      type: "updateRoomSettings",
      matchId: this.room.matchId,
      ...patch,
    });
    this.redraw();
  }

  private applyRoomSettings(room: RoomState) {
    this.model.predictionLevel = room.predictionLevel ?? 0;
    this.table.setPredictionLevel(this.model.predictionLevel);
    this.model.playbackSpeed = normalisePlaybackSpeed(room.playbackSpeed);
    const views = cameraModes.filter((mode) =>
      (room.cameraViews ?? []).includes(mode),
    );
    this.model.cameraViews = views.length ? views : [...cameraModes];
    if (!this.model.cameraViews.includes(this.cameraMode))
      this.setCameraMode(this.model.cameraViews[0]);
  }

  private setCameraMode(mode: CameraMode) {
    const allowed = this.model.cameraViews;
    const next = allowed.includes(mode) ? mode : (allowed[0] ?? "top");
    this.cameraMode = next;
    this.model.cameraMode = next;
    this.table.setCameraMode(next);
    this.redraw();
  }

  private toggleCameraView(mode: CameraMode) {
    if (!isCameraMode(mode)) return;
    if (this.onlineMatch) {
      if (!this.canEditRoomSettings()) {
        if (this.model.cameraViews.includes(mode)) this.setCameraMode(mode);
        else this.showToast("房主未开放该视角");
        return;
      }
      const allowed = this.model.cameraViews;
      if (!allowed.includes(mode)) {
        this.updateRoomSettings({
          cameraViews: cameraModes.filter(
            (entry) => entry === mode || allowed.includes(entry),
          ),
        });
        this.setCameraMode(mode);
        return;
      }
      if (this.cameraMode !== mode) {
        this.setCameraMode(mode);
        return;
      }
      if (allowed.length === 1) {
        this.showToast("至少保留一个视角");
        return;
      }
      const next = allowed.filter((entry) => entry !== mode);
      this.updateRoomSettings({ cameraViews: next });
      this.setCameraMode(next[0]);
      return;
    }
    const allowed = this.model.cameraViews;
    if (!allowed.includes(mode)) {
      this.setCameraViews([...allowed, mode]);
      this.setCameraMode(mode);
      return;
    }
    if (this.cameraMode !== mode) {
      this.setCameraMode(mode);
      return;
    }
    if (allowed.length === 1) {
      this.showToast("至少保留一个视角");
      return;
    }
    const next = allowed.filter((entry) => entry !== mode);
    this.setCameraViews(next);
    this.setCameraMode(next[0]);
  }

  private setCameraViews(views: CameraMode[]) {
    this.practiceCameraViews = cameraModes.filter((mode) =>
      views.includes(mode),
    );
    this.model.cameraViews = [...this.practiceCameraViews];
    this.platform.setStorage(
      cameraViewsStorageKey,
      this.model.cameraViews.join(","),
    );
    this.redraw();
  }

  private createRoom(
    gameType: GameType,
    mode: "classic" | "cards" | "threeSnooker" = this.model.createMode,
    cardCount = this.model.createCardCount,
  ) {
    if (this.model.creating) return;
    if (!this.model.online) {
      this.pendingCreate = { gameType, mode, cardCount };
      this.model.message = "正在连接联机服务…";
      void this.connect();
      return;
    }
    this.model.creating = true;
    this.model.message = "正在创建房间…";
    this.network.send({
      type: "createRoom",
      gameType: mode === "threeSnooker" ? "snooker" : gameType,
      predictionLevel: this.model.createPredictionLevel,
      playbackSpeed: this.model.createPlaybackSpeed,
      cameraViews: this.model.createCameraViews,
      mode,
      cardCount: mode === "cards" ? cardCount : 0,
    });
    this.redraw();
  }

  private startPractice(
    gameType: GameType,
    mode: "classic" | "cards" = "classic",
    cardCount = this.practiceCardCount,
  ) {
    this.onlineMatch = false;
    this.room = undefined;
    this.playerIndex = 0;
    if (mode === "cards") {
      this.practiceCardCount = cardCount;
      this.model.practiceCardCount = cardCount;
    }
    this.engine = new MatchEngine({
      gameType,
      playerNames: ["你", "试玩"],
      practice: true,
      mode,
      cardCount,
      seed: (Date.now() & 0x7fffffff) >>> 0,
    });
    this.snapshot = this.engine.snapshot();
    this.model.screen = "game";
    this.model.message = "自由练习：犯规后仍可摆放母球继续";
    this.animating = false;
    this.angle = 0;
    this.model.spinX = 0;
    this.model.spinY = 0;
    this.model.predictionLevel = this.practicePredictionLevel;
    this.model.practicePredictionLevel = this.practicePredictionLevel;
    this.model.cameraViews = [...this.practiceCameraViews];
    this.model.playbackSpeed = this.practicePlaybackSpeed;
    this.model.practiceMode = true;
    this.model.homeSheet = null;
    this.homeSheetStartedAt = undefined;
    this.model.homeSheetProgress = 1;
    this.opponentTurnStartedAt = undefined;
    this.model.eventLog = [];
    this.model.eventLogOpen = false;
    this.lastLoggedMessage = "";
    this.closeModals();
    this.closeCardUi();
    this.lastPredictionApplied = -1;
    this.table.setPresentation("game");
    this.table.setPredictionLevel(this.practicePredictionLevel);
    this.setCameraMode("top");
    this.table.sync(this.snapshot);
    this.syncAim();
    this.redraw();
  }

  private shoot() {
    if (!this.snapshot || !this.model.canShoot) return;
    const modifiers = shotModifiers(
      this.snapshot.cards,
      this.snapshot.currentPlayer,
    );
    const offset = modifiers.spinForcedZero
      ? { x: 0, y: 0 }
      : spinToCueOffset(
          this.model.spinX,
          this.model.spinY,
          modifiers.spinLimit,
        );
    const input: ShotInput = {
      angle: this.angle,
      power: this.model.power,
      spinX: offset.x,
      spinY: offset.y,
      elevation: 0,
    };
    this.model.spinX = 0;
    this.model.spinY = 0;
    this.syncAim();
    if (this.onlineMatch && this.room) {
      this.animating = true;
      this.model.message = "等待服务器判定…";
      this.network.send({
        type: "shoot",
        matchId: this.room.matchId,
        shotId: this.newId(),
        input,
      });
    } else if (this.engine) {
      try {
        const result = this.engine.shoot(input, this.playerIndex, true);
        this.playShot(
          result.frames ?? [],
          result.snapshot,
          result.stateHash,
          result.ruleEvents,
          result.events,
        );
      } catch (error: any) {
        this.model.message = error.message;
        this.audio.playUi("error");
      }
    }
    this.redraw();
  }

  private playShot(
    frames: any[],
    snapshot: MatchSnapshot,
    expectedHash: string,
    ruleEvents: any[],
    physicsEvents: PhysicsEvent[] = [],
    cardEvents: { type: string; cardId?: CardId }[] = [],
  ) {
    const previousPlayer = this.snapshot?.currentPlayer;
    this.animating = true;
    this.model.message = "击球进行中";
    this.audio.playCue(this.model.power);
    const total = frames.at(-1)?.time ?? 1000;
    const speed = this.model.playbackSpeed;
    const wall = playbackDuration(total, speed);
    this.audio.playEvents(physicsEvents, total, wall);
    this.table.animate(frames, snapshot, speed, () => {
      this.snapshot = snapshot;
      this.animating = false;
      this.model.message = snapshot.lastMessage;
      if (
        this.onlineMatch &&
        previousPlayer !== undefined &&
        previousPlayer !== snapshot.currentPlayer &&
        snapshot.currentPlayer === this.playerIndex
      )
        this.showToast("轮到你了");
      else this.showToast(snapshot.lastMessage);
      this.table.sync(snapshot);
      const foul = ruleEvents.some((event) => event.type === "foul");
      const gameOver = ruleEvents.some((event) => event.type === "gameOver");
      const secondLife = cardEvents.some((event) => event.type === "secondLife");
      const shieldUsed = cardEvents.some((event) => event.type === "shieldUsed");
      if (shieldUsed) this.showToast("护盾抵消了这次犯规");
      if (secondLife) this.showToast("续命生效：黑八已重摆");
      if (physicsEvents.some((event) => event.type === "pot"))
        this.platform.vibrate("light");
      if (foul) {
        this.audio.playUi("error");
        this.platform.vibrate("medium");
      }
      if (gameOver) {
        if (snapshot.winner === this.playerIndex) {
          this.audio.playSuccess();
          this.platform.vibrate("success");
        } else this.platform.vibrate("heavy");
      }
      if (hashSnapshot(snapshot) !== expectedHash) {
        this.model.message = "状态校验失败，正在重新同步";
        if (this.room)
          this.network.send({ type: "sync", matchId: this.room.matchId });
      }
      this.opponentTurnStartedAt =
        this.onlineMatch && snapshot.currentPlayer !== this.playerIndex
          ? Date.now()
          : undefined;
      this.redraw();
    });
    this.redraw();
  }

  private startCountdown() {
    this.stopCountdown();
    this.countdownSyncSent = false;
    this.lastCountdownSecond = undefined;
    this.countdownTimer = setInterval(() => {
      const end = this.model.countdownEnd;
      if (end === null) {
        this.stopCountdown();
        return;
      }
      const remaining = end - Date.now();
      const second = Math.ceil(remaining / 1000);
      if (second === 1 && this.lastCountdownSecond !== 1)
        this.platform.vibrate("light");
      this.lastCountdownSecond = second;
      if (remaining <= -3000 && !this.countdownSyncSent) {
        this.countdownSyncSent = true;
        if (this.room)
          this.network.send({ type: "sync", matchId: this.room.matchId });
        this.stopCountdown();
      }
      this.redraw();
    }, 100);
  }

  private stopCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = undefined;
  }

  private showToast(message?: string | null) {
    if (!message) return;
    this.model.toast = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.model.toast = undefined;
      this.redraw();
    }, 1200);
  }

  private onMessage(message: ServerMessage) {
    if (message.type === "session") {
      this.userId = message.userId;
      this.serverTimeOffset = message.serverTime - Date.now();
      if (this.room)
        this.network.send({ type: "sync", matchId: this.room.matchId });
      return;
    }
    if (message.type === "room") {
      const previousStatus = this.room?.status;
      const enteringGame =
        message.room.status !== previousStatus ||
        this.model.screen !== "game";
      this.table.cancelAnimation();
      this.animating = false;
      this.room = message.room;
      this.snapshot = message.snapshot;
      this.model.creating = false;
      this.onlineMatch = true;
      this.playerIndex =
        message.room.players.find((player) => player.userId === this.userId)
          ?.playerIndex ?? 0;
      this.engine = MatchEngine.restore(message.snapshot);
      this.model.screen = "game";
      this.model.roomStatus = message.room.status;
      this.model.roomMode = message.room.mode;
      this.model.trial =
        message.room.status === "trial" && message.snapshot.practice;
      this.model.countdownEnd =
        message.room.status === "starting" && message.room.startAt !== null
          ? message.room.startAt - this.serverTimeOffset
          : null;
      this.model.message = message.snapshot.lastMessage;
      this.model.practiceMode =
        message.room.status === "trial" && message.snapshot.practice;
      this.applyRoomSettings(message.room);
      this.saveLastRoom(message.room);
      this.table.setPresentation("game");
      if (enteringGame) {
        this.model.spinX = 0;
        this.model.spinY = 0;
        this.model.eventLog = [];
        this.model.eventLogOpen = false;
        this.model.roomOverlayOpen = false;
        this.lastLoggedMessage = "";
        this.closeModals();
        this.setCameraMode("top");
        this.countdownSyncSent = false;
      }
      if (message.room.status === "starting") {
        this.closeModals();
        this.startCountdown();
        if (previousStatus !== "starting")
          this.showToast("好友已加入，3 秒后开局");
      } else {
        this.stopCountdown();
        if (
          message.room.status === "playing" &&
          previousStatus === "starting"
        )
          this.showToast("对局开始");
      }
      this.opponentTurnStartedAt =
        message.snapshot.currentPlayer !== this.playerIndex
          ? Date.now()
          : undefined;
      this.table.sync(message.snapshot);
      this.syncAim();
      this.redraw();
    } else if (message.type === "shot") {
      this.room = message.room;
      this.onlineMatch = true;
      this.model.screen = "game";
      this.model.roomStatus = message.room.status;
      this.model.trial =
        message.room.status === "trial" && message.snapshot.practice;
      this.model.countdownEnd = null;
      this.applyRoomSettings(message.room);
      this.table.setPresentation("game");
      try {
        const engine = MatchEngine.restore(message.preSnapshot);
        const result = engine.shoot(message.input, message.player, true);
        if (result.stateHash !== message.stateHash) {
          this.animating = false;
          this.network.send({ type: "sync", matchId: message.matchId });
          this.model.message = "两端物理结果不一致，已请求同步";
        } else {
          this.engine = engine;
          this.playShot(
            result.frames ?? [],
            message.snapshot,
            message.stateHash,
            message.ruleEvents,
            message.events,
            message.cardEvents ?? [],
          );
        }
      } catch (error: any) {
        this.animating = false;
        this.network.send({ type: "sync", matchId: message.matchId });
        this.model.message = `同步失败：${error.message}`;
      }
    } else if (message.type === "card") {
      this.room = message.room;
      this.onlineMatch = true;
      this.model.screen = "game";
      this.playerIndex =
        message.room.players.find((player) => player.userId === this.userId)
          ?.playerIndex ?? this.playerIndex;
      this.snapshot = message.snapshot;
      this.engine = MatchEngine.restore(message.snapshot);
      this.model.roomStatus = message.room.status;
      this.applyRoomSettings(message.room);
      this.table.setPresentation("game");
      this.table.sync(message.snapshot);
      this.syncAim();
      this.closeCardUi();
      const definition = defFor(message.cardId);
      this.model.message =
        message.snapshot.lastMessage ?? `已使用${definition.name}`;
      this.showToast(`${definition.name}！`);
      this.audio.playUi("open");
      this.redraw();
    } else if (message.type === "opponent" && this.room) {
      const opponent = this.room.players.find(
        (player) =>
          message.player === undefined
            ? player.playerIndex !== this.playerIndex
            : player.playerIndex === message.player,
      );
      if (opponent) {
        opponent.connected = message.connected;
        this.model.message = message.connected
          ? `${opponent.displayName} 已重新连接`
          : `${opponent.displayName} 离线，座位已保留`;
        this.showToast(this.model.message);
      }
    } else if (message.type === "roomClosed") {
      this.clearLastRoom();
      this.goHome();
      this.model.message = message.reason;
      this.showToast(message.reason);
    } else if (message.type === "error") {
      this.animating = false;
      this.model.creating = false;
      this.model.message = message.message;
      this.audio.playUi("error");
    }
    this.redraw();
  }

  private joinRoom(roomCode: string, inviteToken: string) {
    if (!/^\d{6}$/.test(roomCode)) {
      this.model.message = "房间码必须是六位数字";
      this.audio.playUi("error");
      return;
    }
    this.network.send({ type: "joinRoom", roomCode, inviteToken });
    this.model.message = "正在加入房间…";
  }

  private closeModals() {
    this.model.menuOpen = false;
    this.model.menuScroll = 0;
    this.model.spinOpen = false;
    this.model.confirm = null;
    this.model.eventLogOpen = false;
    this.model.roomSettingsOpen = false;
    this.model.roomOverlayOpen = false;
    this.closeCardUi();
  }

  private menuHandlesTouch() {
    return Boolean(
      this.model.menuOpen &&
      !this.model.spinOpen &&
      !this.model.confirm &&
      !this.model.eventLogOpen &&
      !this.model.roomOverlayOpen,
    );
  }

  private leaveRoom() {
    if (this.room)
      this.network.send({ type: "leave", matchId: this.room.matchId });
    this.clearLastRoom();
  }

  private goHome() {
    this.stopCountdown();
    this.onlineMatch = false;
    this.room = undefined;
    this.model.roomStatus = "trial";
    this.model.trial = false;
    this.model.countdownEnd = null;
    this.model.roomOverlayOpen = false;
    this.snapshot = undefined;
    this.engine = undefined;
    this.animating = false;
    this.model.screen = "home";
    this.model.message = undefined;
    this.model.toast = undefined;
    this.model.creating = false;
    this.model.practiceMode = false;
    this.model.predictionLevel = 0;
    this.model.cameraViews = [...this.practiceCameraViews];
    this.model.playbackSpeed = this.practicePlaybackSpeed;
    this.model.spinX = 0;
    this.model.spinY = 0;
    this.model.showHint = false;
    this.opponentTurnStartedAt = undefined;
    this.model.eventLog = [];
    this.model.eventLogOpen = false;
    this.lastLoggedMessage = "";
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.closeModals();
    this.model.homeSheet = null;
    this.homeSheetStartedAt = undefined;
    this.model.homeSheetProgress = 1;
    this.model.settingsOpen = false;
    this.closeCardUi();
    this.table.setPredictionLevel(0);
    this.table.cancelAnimation();
    this.showHomeTable();
    this.redraw();
  }

  private showHomeTable() {
    const demo = new MatchEngine({
      gameType: this.lastRoom?.gameType ?? "eightball",
      playerNames: ["你", "好友"],
      practice: true,
    });
    this.table.sync(demo.snapshot());
    this.table.setPresentation("home");
    this.cameraMode = this.model.cameraViews[0] ?? "top";
    this.model.cameraMode = this.cameraMode;
  }

  private saveLastRoom(room: RoomState) {
    if (room.status === "gameOver") return;
    this.lastRoom = { roomCode: room.roomCode, gameType: room.gameType };
    this.platform.setStorage(
      lastRoomStorageKey,
      JSON.stringify(this.lastRoom),
    );
  }

  private readLastRoom(): StoredRoom | undefined {
    try {
      const value = JSON.parse(
        this.platform.getStorage(lastRoomStorageKey) || "null",
      );
      if (
        value &&
        typeof value.roomCode === "string" &&
        /^\d{6}$/.test(value.roomCode) &&
        (value.gameType === "eightball" ||
          value.gameType === "nineball" ||
          value.gameType === "snooker")
      )
        return { roomCode: value.roomCode, gameType: value.gameType };
    } catch {
      /* ignore corrupt storage */
    }
    return undefined;
  }

  private clearLastRoom() {
    this.lastRoom = undefined;
    this.model.continueRoom = undefined;
    this.platform.setStorage(lastRoomStorageKey, "");
  }

  private newId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }
}
