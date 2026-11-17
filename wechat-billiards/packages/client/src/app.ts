import {
  hashSnapshot,
  MatchEngine,
  tableDimensions,
  type GameType,
  type MatchSnapshot,
  type PlayerIndex,
  type ShotInput,
} from "@friend-billiards/core";
import type { RoomState, ServerMessage } from "@friend-billiards/protocol";
import { Hud, type HudModel } from "./hud";
import { NetworkClient } from "./network";
import type { ClientPlatform, TouchPoint } from "./platform";
import { TableRenderer } from "./renderer";

export interface GameAppOptions {
  serverUrl: string;
  sourceUrl: string;
  autoConnect?: boolean;
}

type Gesture = "aim" | "power" | "fineAim" | "spin" | "place" | null;

export class GameApp {
  private readonly table: TableRenderer;
  private readonly hud: Hud;
  private readonly network: NetworkClient;
  private model: HudModel;
  private engine?: MatchEngine;
  private snapshot?: MatchSnapshot;
  private room?: RoomState;
  private userId = "";
  private playerIndex: PlayerIndex = 0;
  private angle = 0;
  private gesture: Gesture = null;
  private lastPoint?: TouchPoint;
  private animating = false;
  private onlineMatch = false;
  private sound = true;
  private practicePredictionLevel = 0;
  private pendingInvitation?: { roomCode: string; inviteToken: string };

  constructor(
    private readonly platform: ClientPlatform,
    options: GameAppOptions,
  ) {
    this.table = new TableRenderer(platform);
    this.hud = new Hud(platform, this.table.renderer);
    this.model = {
      screen: "home",
      power: 0.5,
      spinX: 0,
      spinY: 0,
      fineAimOffset: 0,
      canShoot: false,
      online: false,
      sourceUrl: options.sourceUrl,
      message: this.sound ? "sound:on" : "sound:off",
      menuOpen: false,
      spinOpen: false,
      soundOn: this.sound,
      createPredictionLevel: 0,
      predictionLevel: 0,
      practicePredictionLevel: 0,
      practiceMode: false,
    };
    this.network = new NetworkClient(platform, options.serverUrl, {
      onMessage: (message) => this.onMessage(message),
      onOnline: (online, message) => {
        this.model.online = online;
        if (this.model.screen === "friend") this.model.message = message;
        if (online && this.pendingInvitation) {
          const invitation = this.pendingInvitation;
          this.pendingInvitation = undefined;
          this.joinRoom(invitation.roomCode, invitation.inviteToken);
        }
        this.redraw();
      },
    });
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
    const loop = () => {
      this.table.render();
      this.hud.render();
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
    this.model.canShoot = Boolean(
      this.snapshot &&
      this.snapshot.phase === "aiming" &&
      !this.animating &&
      (!this.onlineMatch || this.snapshot.currentPlayer === this.playerIndex),
    );
    this.hud.updatePointerSize(this.platform.width, this.platform.height);
    this.hud.draw(this.model);
  }

  private touchStart(point: TouchPoint) {
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
    if (action) {
      void this.action(action);
      return;
    }
    if (this.model.menuOpen || this.model.spinOpen) {
      this.closeModals();
      this.redraw();
      return;
    }
    if (this.model.screen !== "game" || this.animating || !this.snapshot)
      return;
    const myTurn =
      !this.onlineMatch || this.snapshot.currentPlayer === this.playerIndex;
    if (!myTurn) return;
    if (this.snapshot.phase === "ballInHand") {
      this.gesture = "place";
      this.touchMove(point);
    } else if (this.snapshot.phase === "aiming") {
      const position = this.table.screenToTable(point.x, point.y);
      const cue = this.snapshot.balls[0];
      const nearCue =
        Math.hypot(position.x - cue.pos[0], position.y - cue.pos[1]) <
        tableDimensions().ballRadius * 3;
      this.gesture =
        this.snapshot.canRepositionCue && nearCue ? "place" : "aim";
      if (this.gesture === "aim") this.aimAt(point);
      else this.touchMove(point);
    }
  }

  private touchMove(point: TouchPoint) {
    if (!this.gesture) return;
    if (this.gesture === "power") {
      this.model.power = this.hud.powerAt(point.y);
    } else if (this.gesture === "fineAim" && this.lastPoint) {
      const delta = ((point.y - this.lastPoint.y) * 720) / this.platform.height;
      this.angle += delta * 0.0008;
      this.model.fineAimOffset = Math.max(
        -1,
        Math.min(1, this.model.fineAimOffset + delta / 160),
      );
      this.table.setAim(this.angle, this.model.power);
    } else if (this.gesture === "spin") {
      const spin = this.hud.spinAt(point.x, point.y);
      this.model.spinX = spin.x;
      this.model.spinY = spin.y;
    } else if (this.gesture === "aim") {
      this.aimAt(point);
    } else if (this.gesture === "place" && this.snapshot) {
      const position = this.table.screenToTable(point.x, point.y);
      const preview = JSON.parse(
        JSON.stringify(this.snapshot),
      ) as MatchSnapshot;
      preview.balls[0].pos = [position.x, position.y, 0];
      preview.balls[0].state = "Stationary";
      this.table.sync(preview);
    }
    this.lastPoint = point;
    this.redraw();
  }

  private touchEnd(point: TouchPoint) {
    if (this.gesture === "place" && this.snapshot && this.engine) {
      const position = this.table.screenToTable(point.x, point.y);
      try {
        if (this.onlineMatch && this.room) {
          this.network.send({
            type: "placeBall",
            matchId: this.room.matchId,
            x: position.x,
            y: position.y,
          });
        } else {
          this.snapshot = this.engine.placeCueBall(
            position.x,
            position.y,
            this.playerIndex,
          );
          this.model.message = this.snapshot.lastMessage ?? undefined;
          this.table.sync(this.snapshot);
        }
      } catch (error: any) {
        this.model.message = error.message;
        this.table.sync(this.snapshot);
      }
    }
    this.gesture = null;
    this.lastPoint = undefined;
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
    this.table.setAim(this.angle, this.model.power);
  }

  private async action(action: string) {
    if (action.startsWith("practice:")) {
      this.startPractice(action.split(":")[1] as GameType);
      return;
    }
    if (action.startsWith("create:")) {
      this.network.send({
        type: "createRoom",
        gameType: action.split(":")[1] as GameType,
        predictionLevel: this.model.createPredictionLevel,
      });
      this.model.message = "正在创建房间…";
    } else if (action === "prediction:toggle") {
      this.model.createPredictionLevel =
        this.model.createPredictionLevel > 0 ? 0 : 3;
    } else if (action.startsWith("prediction:")) {
      this.model.createPredictionLevel = Number(action.split(":")[1]);
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
      void this.connect();
    } else if (action === "join") {
      const roomInput = await this.platform.prompt(
        "输入房间码或完整邀请参数",
        "例如 123456",
      );
      if (!roomInput) return;
      const query = new URLSearchParams(
        roomInput.includes("=") ? roomInput.replace(/^\?/, "") : "",
      );
      const roomCode = query.get("roomCode") ?? roomInput.trim();
      let inviteToken = query.get("inviteToken") ?? "";
      if (!inviteToken)
        inviteToken =
          (await this.platform.prompt(
            "输入邀请令牌",
            "好友分享链接中的 inviteToken",
          )) ?? "";
      if (roomCode && inviteToken)
        this.joinRoom(roomCode.trim(), inviteToken.trim());
    } else if (action === "share" && this.room) {
      await this.platform.share({
        title: `来和我打一局${this.gameName(this.room.gameType)}`,
        roomCode: this.room.roomCode,
        inviteToken: this.room.inviteToken,
      });
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
      if (this.room)
        this.network.send({ type: "leave", matchId: this.room.matchId });
      this.goHome();
    } else if (action === "back" || action === "exit") {
      if (action === "exit" && this.onlineMatch && this.room)
        this.network.send({ type: "leave", matchId: this.room.matchId });
      this.goHome();
    } else if (action === "menu") {
      this.model.menuOpen = true;
    } else if (action === "spinButton") {
      this.model.spinOpen = true;
    } else if (action === "modalMask" || action === "closeModal") {
      this.closeModals();
    } else if (action === "camera") {
      this.table.toggleCamera();
    } else if (action === "sound") {
      this.sound = !this.sound;
      this.model.soundOn = this.sound;
      this.model.message = this.sound ? "sound:on" : "sound:off";
      if (this.model.screen === "game")
        this.model.message = this.sound ? "音效已开启" : "音效已关闭";
    } else if (action === "shoot") {
      this.shoot();
    } else if (action === "restart" && this.snapshot) {
      this.startPractice(this.snapshot.gameType);
    } else if (action === "rematch" && this.room) {
      this.network.send({ type: "rematch", matchId: this.room.matchId });
      this.model.message = "已确认再来一局，等待对手";
    } else if (action === "nominate" && this.room && this.snapshot) {
      const current = this.snapshot.target.nominatedBall ?? 0;
      this.network.send({
        type: "nominateFreeBall",
        matchId: this.room.matchId,
        ballId: (current % 6) + 1,
      });
    } else if (action === "license") {
      this.model.screen = "license";
    } else if (action === "copySource") {
      await this.platform.prompt("对应源码地址", this.model.sourceUrl);
    }
    this.redraw();
  }

  private startPractice(gameType: GameType) {
    this.onlineMatch = false;
    this.room = undefined;
    this.playerIndex = 0;
    this.engine = new MatchEngine({
      gameType,
      playerNames: ["你", "练习对手"],
      practice: true,
    });
    this.snapshot = this.engine.snapshot();
    this.model.screen = "game";
    this.model.message = "单人练习：犯规后仍可摆放母球继续";
    this.animating = false;
    this.angle = 0;
    this.model.spinX = 0;
    this.model.spinY = 0;
    this.model.predictionLevel = this.practicePredictionLevel;
    this.model.practicePredictionLevel = this.practicePredictionLevel;
    this.model.practiceMode = true;
    this.closeModals();
    this.table.setPredictionLevel(this.practicePredictionLevel);
    this.table.setTopView(true);
    this.table.sync(this.snapshot);
    this.table.setAim(this.angle, this.model.power);
    this.redraw();
  }

  private shoot() {
    if (!this.snapshot || !this.model.canShoot) return;
    const input: ShotInput = {
      angle: this.angle,
      power: this.model.power,
      spinX: -this.model.spinX,
      spinY: -this.model.spinY,
      elevation: 0,
    };
    this.model.spinX = 0;
    this.model.spinY = 0;
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
        );
      } catch (error: any) {
        this.model.message = error.message;
      }
    }
    this.redraw();
  }

  private playShot(
    frames: any[],
    snapshot: MatchSnapshot,
    expectedHash: string,
    ruleEvents: any[],
  ) {
    this.animating = true;
    this.model.message = "击球进行中";
    if (this.sound) this.platform.playHit(this.model.power);
    this.table.animate(frames, snapshot, () => {
      this.snapshot = snapshot;
      this.animating = false;
      this.model.message = snapshot.lastMessage;
      this.table.sync(snapshot);
      if (ruleEvents.some((event) => event.type === "gameOver") && this.sound)
        this.platform.vibrate();
      if (hashSnapshot(snapshot) !== expectedHash) {
        this.model.message = "状态校验失败，正在重新同步";
        if (this.room)
          this.network.send({ type: "sync", matchId: this.room.matchId });
      }
      this.redraw();
    });
    this.redraw();
  }

  private onMessage(message: ServerMessage) {
    if (message.type === "session") {
      this.userId = message.userId;
      if (this.room)
        this.network.send({ type: "sync", matchId: this.room.matchId });
      return;
    }
    if (message.type === "room") {
      const previousRoomStatus = this.room?.status;
      const enteringGame =
        message.room.status === "playing" &&
        (this.model.screen !== "game" ||
          previousRoomStatus === "waiting" ||
          previousRoomStatus === "gameOver");
      this.room = message.room;
      this.snapshot = message.snapshot;
      this.onlineMatch = true;
      this.playerIndex =
        message.room.players.find((player) => player.userId === this.userId)
          ?.playerIndex ?? 0;
      this.engine = MatchEngine.restore(message.snapshot);
      this.animating = false;
      if (message.room.status === "waiting") this.model.screen = "room";
      else this.model.screen = "game";
      this.model.message = message.snapshot.lastMessage;
      this.model.practiceMode = false;
      this.model.predictionLevel = message.room.predictionLevel ?? 0;
      this.table.setPredictionLevel(this.model.predictionLevel);
      if (enteringGame) {
        this.model.spinX = 0;
        this.model.spinY = 0;
        this.closeModals();
        this.table.setTopView(true);
      }
      this.table.sync(message.snapshot);
      this.table.setAim(this.angle, this.model.power);
    } else if (message.type === "shot") {
      this.room = message.room;
      this.onlineMatch = true;
      this.model.screen = "game";
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
          );
        }
      } catch (error: any) {
        this.animating = false;
        this.network.send({ type: "sync", matchId: message.matchId });
        this.model.message = `同步失败：${error.message}`;
      }
    } else if (message.type === "opponent" && this.room) {
      const opponent = this.room.players.find(
        (player) => player.playerIndex !== this.playerIndex,
      );
      if (opponent) opponent.connected = message.connected;
      this.model.message = message.connected
        ? "对手已重新连接"
        : "对手离线，座位已保留";
    } else if (message.type === "roomClosed") {
      this.goHome();
      this.model.message = message.reason;
    } else if (message.type === "error") {
      this.animating = false;
      this.model.message = message.message;
    }
    this.redraw();
  }

  private joinRoom(roomCode: string, inviteToken: string) {
    if (!/^\d{6}$/.test(roomCode)) {
      this.model.message = "房间码必须是六位数字";
      return;
    }
    this.network.send({ type: "joinRoom", roomCode, inviteToken });
    this.model.message = "正在加入房间…";
  }

  private closeModals() {
    this.model.menuOpen = false;
    this.model.spinOpen = false;
  }

  private goHome() {
    this.onlineMatch = false;
    this.room = undefined;
    this.snapshot = undefined;
    this.engine = undefined;
    this.animating = false;
    this.model.screen = "home";
    this.model.message = this.sound ? "sound:on" : "sound:off";
    this.model.predictionLevel = 0;
    this.model.practiceMode = false;
    this.model.spinX = 0;
    this.model.spinY = 0;
    this.closeModals();
    this.table.setPredictionLevel(0);
    this.table.cancelAnimation();
  }

  private newId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  private gameName(gameType: GameType): string {
    return gameType === "eightball"
      ? "黑八"
      : gameType === "nineball"
        ? "九球"
        : "斯诺克";
  }
}
