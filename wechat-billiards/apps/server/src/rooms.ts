import { randomBytes, randomInt } from "node:crypto";
import {
  hashSnapshot,
  MatchEngine,
  type GameType,
  type PlayerIndex,
} from "@friend-billiards/core";
import {
  DEFAULT_ROOM_PLAYBACK_SPEED,
  PROTOCOL_VERSION,
  ProtocolError,
  ROOM_CAMERA_VIEWS,
  ROOM_PLAYBACK_SPEEDS,
  type ClientMessage,
  type RoomCameraView,
  type RoomMode,
  type RoomState,
  type ServerMessage,
} from "@friend-billiards/protocol";
import type {
  RoomRecord,
  RoomRepository,
  StoredCardMessage,
  StoredShot,
} from "./repository";

export interface SocketLike {
  send(data: string): void;
}

export interface ClientContext {
  socket: SocketLike;
  userId: string;
  displayName: string;
}

interface ActiveRoom {
  record: RoomRecord;
  engine: MatchEngine;
  sockets: Map<string, SocketLike>;
  shots: Map<string, StoredShot>;
  cards: Map<string, StoredCardMessage>;
  timer?: ReturnType<typeof setTimeout>;
}

const TRIAL_OPPONENT = "试玩";
const START_COUNTDOWN_MS = 3000;

function cardSeed(key: string, frame: number): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash ^ Math.imul(frame + 1, 2654435761)) >>> 0;
}

function send(socket: SocketLike, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}

function normalisePredictionLevel(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
}

function normalisePlaybackSpeed(value: number | undefined): number {
  return (ROOM_PLAYBACK_SPEEDS as readonly number[]).includes(value)
    ? value
    : DEFAULT_ROOM_PLAYBACK_SPEED;
}

function normaliseCameraViews(value: unknown): RoomCameraView[] {
  const selected = Array.isArray(value)
    ? ROOM_CAMERA_VIEWS.filter((view) => value.includes(view))
    : [];
  return selected.length > 0 ? selected : [...ROOM_CAMERA_VIEWS];
}

function normaliseMode(value: RoomMode | undefined): RoomMode {
  return value === "cards" || value === "threeSnooker" ? value : "classic";
}

function normaliseStatus(value: string | undefined): RoomRecord["status"] {
  if (value === "starting" || value === "playing" || value === "gameOver")
    return value;
  if (value === "waiting") return "trial";
  return "trial";
}

function normaliseRecord(record: RoomRecord) {
  record.predictionLevel = normalisePredictionLevel(record.predictionLevel ?? 0);
  record.playbackSpeed = normalisePlaybackSpeed(record.playbackSpeed);
  record.cameraViews = normaliseCameraViews(record.cameraViews);
  record.mode = normaliseMode(record.mode);
  record.cardCount =
    record.mode === "cards"
      ? Math.max(0, Math.min(6, Math.floor(record.cardCount ?? 0)))
      : 0;
  record.maxPlayers = record.mode === "threeSnooker" ? 3 : 2;
  record.playerCount = record.players.length;
  record.status = normaliseStatus(record.status as unknown as string);
  record.startAt =
    record.status === "starting" ? (record.startAt ?? null) : null;
  record.frameIndex = record.frameIndex ?? 0;
  record.rematchUserIds = record.rematchUserIds ?? [];
  record.shots = record.shots ?? [];
  record.cardMessages = record.cardMessages ?? [];
  record.players.forEach((player, index) => {
    player.playerIndex = Number.isInteger(player.playerIndex)
      ? player.playerIndex
      : index;
    player.ready = player.ready ?? false;
  });
}

export class RoomService {
  private readonly rooms = new Map<string, ActiveRoom>();
  private readonly matches = new Map<string, string>();
  private readonly currentRooms = new Map<string, string>();
  private readonly pendingSaves = new Set<Promise<void>>();

  constructor(private readonly repository: RoomRepository) {}

  async restore() {
    const records = await this.repository.list();
    for (const record of records) {
      try {
        normaliseRecord(record);
        const room = this.install(record);
        if (record.status === "starting") {
          if (record.startAt === null || record.startAt <= Date.now()) {
            await this.enterPlaying(room);
          } else {
            this.scheduleStart(room);
          }
        } else if (record.status === "trial") {
          if (record.players.length >= record.maxPlayers) {
            await this.beginMatch(room);
          } else if (
            record.mode === "threeSnooker" &&
            record.players.length === 2
          ) {
            await this.beginWarmup(room);
          } else if (!room.engine.state.practice) {
            await this.revertToTrial(room);
          }
        }
      } catch (error) {
        console.error("无法恢复房间", {
          roomCode: record.roomCode,
          error: String(error),
        });
      }
    }
  }

  async handle(context: ClientContext, message: ClientMessage) {
    switch (message.type) {
      case "createRoom":
        return this.createRoom(
          context,
          message.gameType,
          message.predictionLevel,
          message.mode,
          message.cardCount,
          message.playbackSpeed,
          message.cameraViews,
        );
      case "joinRoom":
        return this.joinRoom(context, message.roomCode, message.inviteToken);
      case "ready":
        return this.ready(context, message.roomCode);
      case "updateRoomSettings":
        return this.updateRoomSettings(context, message.matchId, message);
      case "placeBall":
        return this.placeBall(context, message.matchId, message.x, message.y);
      case "nominateFreeBall":
        return this.nominate(context, message.matchId, message.ballId);
      case "playCard":
        return this.playCard(context, message);
      case "shoot":
        return this.shoot(
          context,
          message.matchId,
          message.shotId,
          message.input,
        );
      case "sync":
        return this.sync(context, message.matchId);
      case "rematch":
        return this.rematch(context, message.matchId);
      case "concede":
        return this.concede(context, message.matchId);
      case "leave":
        return this.leave(context, message.matchId);
      case "ping":
        return send(context.socket, {
          ...this.base(message),
          type: "pong",
          nonce: message.nonce,
          serverTime: Date.now(),
        });
      default:
        throw new Error("请先登录");
    }
  }

  disconnect(socket: SocketLike) {
    for (const room of this.rooms.values()) {
      for (const [userId, connectedSocket] of room.sockets) {
        if (connectedSocket !== socket) continue;
        room.sockets.delete(userId);
        const player = room.record.players.find(
          (candidate) => candidate.userId === userId,
        );
        if (player) player.ready = false;
        this.broadcast(room, {
          protocolVersion: PROTOCOL_VERSION,
          type: "opponent",
          matchId: room.record.matchId,
          connected: false,
          ...(player ? { player: player.playerIndex } : {}),
        });
        this.broadcastRoom(room);
        if (room.record.mode === "threeSnooker") {
          if (room.record.status === "starting") {
            if (room.record.players.length === 2)
              this.fire(this.beginWarmup(room), "回退热身失败");
            else this.fire(this.revertToTrial(room), "回退试玩失败");
          }
        } else if (
          room.record.status === "starting" ||
          (room.record.status === "trial" && !room.engine.state.practice)
        ) {
          this.fire(this.revertToTrial(room), "回退试玩失败");
        }
        this.fire(this.save(room), "保存离线房间失败");
      }
    }
  }

  async flush() {
    while (this.pendingSaves.size > 0)
      await Promise.all([...this.pendingSaves]);
  }

  roomCount() {
    return this.rooms.size;
  }

  private async createRoom(
    context: ClientContext,
    gameType: GameType,
    predictionLevel: number,
    modeValue?: RoomMode,
    cardCountValue?: number,
    playbackSpeedValue?: number,
    cameraViewsValue?: RoomCameraView[],
  ) {
    await this.leaveCurrentRoom(context);
    let roomCode: string;
    do roomCode = String(randomInt(1000000)).padStart(6, "0");
    while (this.rooms.has(roomCode));
    const inviteToken = randomBytes(24).toString("base64url");
    const matchId = randomBytes(12).toString("base64url");
    const mode = normaliseMode(modeValue);
    const cardCount =
      mode === "cards"
        ? Math.max(0, Math.min(6, Math.floor(cardCountValue ?? 3)))
        : 0;
    const trial = new MatchEngine({
      gameType,
      playerNames: [context.displayName, TRIAL_OPPONENT],
      practice: true,
      playerCount: 2,
      mode: mode === "cards" ? "cards" : "classic",
      cardCount,
      seed: cardSeed(matchId, 0),
    });
    const snapshot = trial.snapshot();
    const record: RoomRecord = {
      roomCode,
      inviteToken,
      matchId,
      gameType,
      predictionLevel: normalisePredictionLevel(predictionLevel),
      playbackSpeed: normalisePlaybackSpeed(playbackSpeedValue),
      cameraViews: normaliseCameraViews(cameraViewsValue),
      mode,
      cardCount,
      maxPlayers: mode === "threeSnooker" ? 3 : 2,
      playerCount: 1,
      status: "trial",
      startAt: null,
      frameIndex: 0,
      players: [
        {
          userId: context.userId,
          displayName: context.displayName,
          playerIndex: 0,
          ready: true,
        },
      ],
      snapshot,
      stateHash: hashSnapshot(snapshot),
      seq: 0,
      rematchUserIds: [],
      shots: [],
      cardMessages: [],
      updatedAt: Date.now(),
    };
    const room = this.install(record);
    room.sockets.set(context.userId, context.socket);
    this.currentRooms.set(context.userId, roomCode);
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async joinRoom(
    context: ClientContext,
    roomCode: string,
    inviteToken: string,
  ) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error("房间不存在或已结束");
    if (inviteToken && room.record.inviteToken !== inviteToken)
      throw new Error("邀请已失效，请手动输入房间码");
    const existing = room.record.players.find(
      (player) => player.userId === context.userId,
    );
    if (!existing) {
      if (room.record.status === "gameOver")
        throw new ProtocolError(
          "ROOM_FINISHED",
          "本局已结束，请让房主再来一局",
        );
      if (room.record.players.length >= room.record.maxPlayers)
        throw new ProtocolError(
          "ROOM_FULL",
          `房间已满（${room.record.maxPlayers}/${room.record.maxPlayers}）`,
        );
      if (room.record.status !== "trial")
        throw new Error("对局已经开始，无法加入");
    }
    await this.leaveCurrentRoom(context, roomCode);
    let joinedIndex = existing?.playerIndex;
    if (existing) {
      existing.displayName = context.displayName;
      if (room.record.status === "starting" && room.record.startAt !== null)
        this.scheduleStart(room);
    } else {
      const used = new Set(
        room.record.players.map((player) => player.playerIndex),
      );
      let playerIndex = 0;
      while (used.has(playerIndex)) playerIndex += 1;
      joinedIndex = playerIndex;
      room.record.players.push({
        userId: context.userId,
        displayName: context.displayName,
        playerIndex,
        ready: true,
      });
      room.record.players.sort((a, b) => a.playerIndex - b.playerIndex);
      room.record.playerCount = room.record.players.length;
    }
    room.sockets.set(context.userId, context.socket);
    this.currentRooms.set(context.userId, roomCode);
    await this.save(room);
    this.broadcast(room, {
      protocolVersion: PROTOCOL_VERSION,
      type: "opponent",
      matchId: room.record.matchId,
      connected: true,
      ...(joinedIndex === undefined ? {} : { player: joinedIndex }),
    });
    this.broadcastRoom(room);

    if (room.record.status === "trial") {
      if (
        room.record.players.length >= room.record.maxPlayers &&
        room.record.players.every((player) => room.sockets.has(player.userId))
      ) {
        await this.beginMatch(room);
      } else if (
        room.record.mode === "threeSnooker" &&
        room.record.players.length === 2
      ) {
        await this.beginWarmup(room);
      }
    }
  }

  private async beginWarmup(room: ActiveRoom) {
    const players = [...room.record.players].sort(
      (a, b) => a.playerIndex - b.playerIndex,
    );
    room.engine = new MatchEngine({
      gameType: room.record.gameType,
      playerNames: players.map((player) => player.displayName),
      playerCount: players.length,
      practice: false,
    });
    room.record.snapshot = room.engine.snapshot();
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.status = "trial";
    room.record.startAt = null;
    room.record.shots = [];
    room.record.cardMessages = [];
    room.record.rematchUserIds = [];
    room.record.seq += 1;
    room.shots.clear();
    room.cards.clear();
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async ready(context: ClientContext, roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error("房间不存在");
    if (
      !room.record.players.some((player) => player.userId === context.userId)
    )
      throw new Error("你不在该房间");
    room.sockets.set(context.userId, context.socket);
    this.broadcastRoom(room);
  }

  private async updateRoomSettings(
    context: ClientContext,
    matchId: string,
    message: Extract<ClientMessage, { type: "updateRoomSettings" }>,
  ) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    if (!this.isHost(room, playerIndex))
      throw new ProtocolError("HOST_ONLY", "只有房主可以修改房间设置");
    if (message.predictionLevel !== undefined)
      room.record.predictionLevel = normalisePredictionLevel(
        message.predictionLevel,
      );
    if (message.playbackSpeed !== undefined)
      room.record.playbackSpeed = normalisePlaybackSpeed(
        message.playbackSpeed,
      );
    if (message.cameraViews !== undefined)
      room.record.cameraViews = normaliseCameraViews(message.cameraViews);
    room.record.seq += 1;
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async beginMatch(room: ActiveRoom) {
    this.clearTimer(room);
    const players = [...room.record.players].sort(
      (a, b) => a.playerIndex - b.playerIndex,
    );
    const cardMode = room.record.mode === "cards";
    room.engine = new MatchEngine({
      gameType: room.record.gameType,
      playerNames: players.map((player) => player.displayName),
      playerCount: room.record.maxPlayers,
      practice: false,
      mode: cardMode ? "cards" : "classic",
      cardCount: cardMode ? room.record.cardCount : 0,
      seed: cardSeed(room.record.matchId, room.record.frameIndex),
      startingPlayer:
        room.record.mode === "threeSnooker"
          ? room.record.frameIndex % room.record.maxPlayers
          : 0,
    });
    room.record.snapshot = room.engine.snapshot();
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.status = "starting";
    room.record.startAt = Date.now() + START_COUNTDOWN_MS;
    room.record.playerCount = players.length;
    room.record.shots = [];
    room.record.cardMessages = [];
    room.record.rematchUserIds = [];
    room.record.seq += 1;
    room.shots.clear();
    room.cards.clear();
    await this.save(room);
    this.scheduleStart(room);
    this.broadcastRoom(room);
  }

  private scheduleStart(room: ActiveRoom) {
    this.clearTimer(room);
    const delay = Math.max(
      0,
      (room.record.startAt ?? Date.now()) - Date.now(),
    );
    room.timer = setTimeout(() => {
      this.fire(this.finishStart(room), "开启正式局失败");
    }, delay);
  }

  private async finishStart(room: ActiveRoom) {
    room.timer = undefined;
    if (room.record.status !== "starting") return;
    const connected = room.record.players.filter((player) =>
      room.sockets.has(player.userId),
    ).length;
    if (
      room.record.playerCount < room.record.maxPlayers ||
      connected < room.record.maxPlayers
    ) {
      if (
        room.record.mode === "threeSnooker" &&
        room.record.players.length >= 2
      )
        await this.beginWarmup(room);
      else await this.revertToTrial(room);
      return;
    }
    await this.enterPlaying(room);
  }

  private async enterPlaying(room: ActiveRoom) {
    this.clearTimer(room);
    room.record.status = "playing";
    room.record.startAt = null;
    room.record.frameIndex += 1;
    room.record.seq += 1;
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async revertToTrial(room: ActiveRoom) {
    this.clearTimer(room);
    const host = [...room.record.players].sort(
      (a, b) => a.playerIndex - b.playerIndex,
    )[0];
    const cardMode = room.record.mode === "cards";
    room.engine = new MatchEngine({
      gameType: room.record.gameType,
      playerNames: [host?.displayName ?? "房主", TRIAL_OPPONENT],
      practice: true,
      playerCount: 2,
      mode: cardMode ? "cards" : "classic",
      cardCount: cardMode ? room.record.cardCount : 0,
      seed: cardSeed(room.record.matchId, room.record.frameIndex + 1000),
    });
    room.record.snapshot = room.engine.snapshot();
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.status = "trial";
    room.record.startAt = null;
    room.record.cardMessages = [];
    room.record.rematchUserIds = [];
    room.record.seq += 1;
    room.shots.clear();
    room.cards.clear();
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async placeBall(
    context: ClientContext,
    matchId: string,
    x: number,
    y: number,
  ) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    this.assertCanAct(room, playerIndex);
    room.record.snapshot = room.engine.placeCueBall(x, y, playerIndex);
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.seq += 1;
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async nominate(
    context: ClientContext,
    matchId: string,
    ballId: number,
  ) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    this.assertCanAct(room, playerIndex);
    room.record.snapshot = room.engine.nominateFreeBall(ballId, playerIndex);
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.seq += 1;
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async playCard(
    context: ClientContext,
    request: Extract<ClientMessage, { type: "playCard" }>,
  ) {
    const { room, playerIndex } = this.memberRoom(
      context,
      request.matchId,
    );
    const cached = room.cards.get(request.cardUid);
    if (cached) {
      if (cached.player !== playerIndex)
        throw new ProtocolError("CARD_NOT_FOUND", "这张牌不在你手里");
      send(context.socket, cached.message);
      return;
    }
    this.assertCanAct(room, playerIndex);
    const result = room.engine.playCard(playerIndex, {
      cardUid: request.cardUid,
      ...(request.targetBallId !== undefined
        ? { targetBallId: request.targetBallId }
        : {}),
      ...(request.targetPos ? { targetPos: request.targetPos } : {}),
      ...(request.targetEffectId
        ? { targetEffectId: request.targetEffectId }
        : {}),
    });
    room.record.snapshot = result.snapshot;
    const stateHash = hashSnapshot(result.snapshot);
    room.record.stateHash = stateHash;
    room.record.seq += 1;
    const message: Extract<ServerMessage, { type: "card" }> = {
      protocolVersion: PROTOCOL_VERSION,
      type: "card",
      room: this.roomState(room),
      matchId: room.record.matchId,
      seq: room.record.seq,
      player: playerIndex,
      cardUid: request.cardUid,
      cardId: result.cardId,
      targetBallId: result.targetBallId,
      targetPos: result.targetPos,
      targetEffectId: result.targetEffectId,
      events: result.events,
      snapshot: result.snapshot,
      stateHash,
    };
    const stored: StoredCardMessage = {
      cardUid: request.cardUid,
      player: playerIndex,
      message,
    };
    room.record.cardMessages.push(stored);
    if (room.record.cardMessages.length > 50)
      room.record.cardMessages.splice(
        0,
        room.record.cardMessages.length - 50,
      );
    room.cards.set(request.cardUid, stored);
    await this.save(room);
    if (room.record.status === "trial" && room.engine.state.practice)
      send(context.socket, message);
    else this.broadcast(room, message);
  }

  private async shoot(
    context: ClientContext,
    matchId: string,
    shotId: string,
    input: any,
  ) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    const inputJson = JSON.stringify(input);
    const duplicate = room.shots.get(shotId);
    if (duplicate) {
      if (duplicate.player !== playerIndex || duplicate.inputJson !== inputJson)
        throw new Error("击球 ID 已被其他参数使用");
      return send(context.socket, duplicate.message);
    }
    this.assertCanAct(room, playerIndex);
    const trial = room.record.status === "trial";
    const practiceTrial = trial && room.engine.state.practice;
    const preSnapshot = room.engine.snapshot();
    const result = room.engine.shoot(input, playerIndex);
    room.record.snapshot = result.snapshot;
    room.record.stateHash = result.stateHash;
    if (!trial) {
      room.record.status =
        result.snapshot.phase === "gameOver" ? "gameOver" : "playing";
    }
    room.record.seq += 1;
    const roomState = this.roomState(room);
    const message: Extract<ServerMessage, { type: "shot" }> = {
      protocolVersion: PROTOCOL_VERSION,
      type: "shot",
      room: roomState,
      matchId,
      seq: room.record.seq,
      shotId,
      player: playerIndex,
      preSnapshot,
      input: result.input,
      events: result.events,
      ruleEvents: result.ruleEvents,
      cardEvents: result.cardEvents,
      snapshot: result.snapshot,
      stateHash: result.stateHash,
      durationMs: result.durationMs,
    };
    if (practiceTrial) {
      await this.save(room);
      send(context.socket, message);
      return;
    }
    if (trial) {
      await this.save(room);
      this.broadcast(room, message);
      return;
    }
    const storedShot = { shotId, player: playerIndex, inputJson, message };
    room.record.shots.push(storedShot);
    room.shots.set(shotId, storedShot);
    await this.save(room);
    this.broadcast(room, message);
  }

  private async sync(context: ClientContext, matchId: string) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    room.sockets.set(context.userId, context.socket);
    this.currentRooms.set(context.userId, room.record.roomCode);
    this.broadcast(room, {
      protocolVersion: PROTOCOL_VERSION,
      type: "opponent",
      matchId,
      connected: true,
      player: playerIndex,
    });
    this.broadcastRoom(room, context.socket);
    room.record.players
      .filter((player) => player.playerIndex !== playerIndex)
      .forEach((opponent) =>
        send(context.socket, {
          protocolVersion: PROTOCOL_VERSION,
          type: "opponent",
          matchId,
          connected: room.sockets.has(opponent.userId),
          player: opponent.playerIndex,
        }),
      );
    if (
      room.record.status === "trial" &&
      room.record.players.length >= room.record.maxPlayers &&
      room.record.players.every((player) => room.sockets.has(player.userId))
    ) {
      await this.beginMatch(room);
    }
  }

  private async rematch(context: ClientContext, matchId: string) {
    const { room } = this.memberRoom(context, matchId);
    if (room.record.status === "trial") {
      if (
        room.record.mode === "threeSnooker" &&
        room.record.players.length === 2
      )
        await this.beginWarmup(room);
      else await this.revertToTrial(room);
      return;
    }
    if (room.record.status !== "gameOver") throw new Error("本局尚未结束");
    if (!room.record.rematchUserIds.includes(context.userId))
      room.record.rematchUserIds.push(context.userId);
    if (
      room.record.mode === "threeSnooker" &&
      room.record.players.length < room.record.maxPlayers
    ) {
      if (room.record.players.length === 2) await this.beginWarmup(room);
      else await this.revertToTrial(room);
      return;
    }
    const online = room.record.players.filter(
      (player) =>
        room.sockets.has(player.userId) &&
        (room.record.mode !== "threeSnooker" ||
          !room.engine.state.eliminated[player.playerIndex]),
    );
    if (
      online.length > 0 &&
      online.every((player) =>
        room.record.rematchUserIds.includes(player.userId),
      )
    ) {
      await this.beginMatch(room);
      return;
    }
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async concede(context: ClientContext, matchId: string) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    if (room.record.status !== "playing")
      throw new Error("房间尚未开始或已经结束");
    room.record.snapshot = room.engine.concede(playerIndex);
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.status =
      room.record.snapshot.phase === "gameOver" ? "gameOver" : "playing";
    room.record.seq += 1;
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async leave(context: ClientContext, matchId: string) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    const three = room.record.mode === "threeSnooker";
    const wasHost = this.isHost(room, playerIndex);
    room.record.players = room.record.players.filter(
      (player) => player.userId !== context.userId,
    );
    room.record.playerCount = room.record.players.length;
    room.sockets.delete(context.userId);
    this.currentRooms.delete(context.userId);
    room.record.seq += 1;

    if (three) {
      if (room.record.players.length === 0) {
        this.clearTimer(room);
        this.removeRoom(room);
        await this.repository.remove(room.record.roomCode);
        return;
      }
      if (room.record.status === "playing") {
        room.record.snapshot = room.engine.concede(playerIndex);
        room.record.stateHash = hashSnapshot(room.record.snapshot);
        room.record.status =
          room.record.snapshot.phase === "gameOver" ? "gameOver" : "playing";
        await this.save(room);
        this.broadcastRoom(room);
        return;
      }
      this.clearTimer(room);
      if (room.record.players.length === 2) await this.beginWarmup(room);
      else await this.revertToTrial(room);
      return;
    }

    const countdownOrTrial =
      room.record.status === "trial" || room.record.status === "starting";
    if (countdownOrTrial && !wasHost) {
      await this.revertToTrial(room);
      return;
    }
    this.clearTimer(room);
    this.broadcast(room, {
      protocolVersion: PROTOCOL_VERSION,
      type: "roomClosed",
      matchId,
      reason: wasHost ? "房主离开，房间已关闭" : "好友离开，房间已关闭",
    });
    this.removeRoom(room);
    await this.repository.remove(room.record.roomCode);
  }

  private memberRoom(
    context: ClientContext,
    matchId: string,
  ): { room: ActiveRoom; playerIndex: PlayerIndex } {
    const roomCode = this.matches.get(matchId);
    const room = roomCode ? this.rooms.get(roomCode) : undefined;
    if (!room) throw new Error("对局不存在或已关闭");
    const player = room.record.players.find(
      (candidate) => candidate.userId === context.userId,
    );
    if (!player) throw new Error("你不是该对局玩家");
    return { room, playerIndex: player.playerIndex };
  }

  private assertCanAct(room: ActiveRoom, playerIndex: PlayerIndex) {
    if (room.record.status === "starting")
      throw new ProtocolError("MATCH_STARTING", "对局即将开始");
    if (room.record.status === "gameOver")
      throw new Error("本局已结束");
    if (
      room.record.status === "trial" &&
      room.engine.state.practice &&
      !this.isHost(room, playerIndex)
    )
      throw new ProtocolError("MATCH_NOT_TRIAL", "等待房主试玩结束");
    if (room.engine.state.eliminated[playerIndex])
      throw new ProtocolError("PLAYER_ELIMINATED", "你已退出本局");
    if (room.engine.state.currentPlayer !== playerIndex)
      throw new Error("还未轮到你");
  }

  private hostPlayerIndex(room: ActiveRoom): PlayerIndex {
    if (room.record.players.length === 0) return 0;
    return room.record.players.reduce(
      (best, player) => Math.min(best, player.playerIndex),
      Number.POSITIVE_INFINITY,
    );
  }

  private isHost(room: ActiveRoom, playerIndex: PlayerIndex): boolean {
    return this.hostPlayerIndex(room) === playerIndex;
  }

  private roomState(room: ActiveRoom): RoomState {
    return {
      roomCode: room.record.roomCode,
      inviteToken: room.record.inviteToken,
      matchId: room.record.matchId,
      gameType: room.record.gameType,
      mode: room.record.mode,
      cardCount: room.record.cardCount,
      predictionLevel: room.record.predictionLevel,
      playbackSpeed: room.record.playbackSpeed,
      cameraViews: [...room.record.cameraViews],
      status: room.record.status,
      hostPlayerIndex: this.hostPlayerIndex(room),
      playerCount: room.record.playerCount,
      maxPlayers: room.record.maxPlayers,
      startAt: room.record.startAt,
      players: room.record.players.map((player) => ({
        ...player,
        connected: room.sockets.has(player.userId),
      })),
      rematchUserIds: [...room.record.rematchUserIds],
      seq: room.record.seq,
    };
  }

  private broadcastRoom(room: ActiveRoom, only?: SocketLike) {
    const message: ServerMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: "room",
      room: this.roomState(room),
      snapshot: room.record.snapshot,
      stateHash: room.record.stateHash,
    };
    if (only) send(only, message);
    else this.broadcast(room, message);
  }

  private broadcast(room: ActiveRoom, message: ServerMessage) {
    room.sockets.forEach((socket) => send(socket, message));
  }

  private install(record: RoomRecord): ActiveRoom {
    normaliseRecord(record);
    const engine = MatchEngine.restore(record.snapshot);
    record.snapshot = engine.snapshot();
    record.stateHash = hashSnapshot(record.snapshot);
    const room: ActiveRoom = {
      record,
      engine,
      sockets: new Map(),
      shots: new Map(record.shots.map((shot) => [shot.shotId, shot])),
      cards: new Map(
        record.cardMessages.map((entry) => [entry.cardUid, entry]),
      ),
    };
    this.rooms.set(record.roomCode, room);
    this.matches.set(record.matchId, record.roomCode);
    return room;
  }

  private clearTimer(room: ActiveRoom) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = undefined;
  }

  private fire(promise: Promise<unknown>, label: string) {
    promise.catch((error) => console.error(label, String(error)));
  }

  private async save(room: ActiveRoom) {
    const saving = this.persist(room);
    this.pendingSaves.add(saving);
    try {
      await saving;
    } finally {
      this.pendingSaves.delete(saving);
    }
  }

  private async persist(room: ActiveRoom) {
    room.record.snapshot = room.engine.snapshot();
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.playerCount = room.record.players.length;
    room.record.updatedAt = Date.now();
    await this.repository.save(room.record);
  }

  private async leaveCurrentRoom(
    context: ClientContext,
    exceptRoomCode?: string,
  ) {
    const current = this.currentRooms.get(context.userId);
    if (!current || current === exceptRoomCode) return;
    const room = this.rooms.get(current);
    if (room) {
      this.clearTimer(room);
      this.broadcast(room, {
        protocolVersion: PROTOCOL_VERSION,
        type: "roomClosed",
        matchId: room.record.matchId,
        reason: "玩家进入了其他房间",
      });
      this.removeRoom(room);
      await this.repository.remove(current);
    }
  }

  private removeRoom(room: ActiveRoom) {
    this.clearTimer(room);
    room.record.players.forEach((player) =>
      this.currentRooms.delete(player.userId),
    );
    this.rooms.delete(room.record.roomCode);
    this.matches.delete(room.record.matchId);
  }

  private base(message: ClientMessage) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ...(message.requestId ? { requestId: message.requestId } : {}),
    };
  }
}
