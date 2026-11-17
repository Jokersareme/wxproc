import { randomBytes, randomInt } from "node:crypto";
import {
  hashSnapshot,
  MatchEngine,
  type GameType,
  type PlayerIndex,
} from "@friend-billiards/core";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type RoomState,
  type ServerMessage,
} from "@friend-billiards/protocol";
import type { RoomRecord, RoomRepository, StoredShot } from "./repository";

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
}

function send(socket: SocketLike, message: ServerMessage) {
  socket.send(JSON.stringify(message));
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
        this.install(record);
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
        return this.createRoom(context, message.gameType);
      case "joinRoom":
        return this.joinRoom(context, message.roomCode, message.inviteToken);
      case "ready":
        return this.ready(context, message.roomCode, message.ready);
      case "placeBall":
        return this.placeBall(context, message.matchId, message.x, message.y);
      case "nominateFreeBall":
        return this.nominate(context, message.matchId, message.ballId);
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
        this.broadcast(room, {
          protocolVersion: PROTOCOL_VERSION,
          type: "opponent",
          matchId: room.record.matchId,
          connected: false,
        });
        this.broadcastRoom(room);
        if (player) player.ready = false;
        const saving = this.save(room);
        this.pendingSaves.add(saving);
        saving.then(
          () => this.pendingSaves.delete(saving),
          () => this.pendingSaves.delete(saving),
        );
      }
    }
  }

  async flush() {
    await Promise.all([...this.pendingSaves]);
  }

  roomCount() {
    return this.rooms.size;
  }

  private async createRoom(context: ClientContext, gameType: GameType) {
    await this.leaveCurrentRoom(context);
    let roomCode: string;
    do roomCode = String(randomInt(1000000)).padStart(6, "0");
    while (this.rooms.has(roomCode));
    const inviteToken = randomBytes(24).toString("base64url");
    const matchId = randomBytes(12).toString("base64url");
    const engine = new MatchEngine({
      gameType,
      playerNames: [context.displayName, "等待好友"],
    });
    const snapshot = engine.snapshot();
    const record: RoomRecord = {
      roomCode,
      inviteToken,
      matchId,
      gameType,
      status: "waiting",
      players: [
        {
          userId: context.userId,
          displayName: context.displayName,
          playerIndex: 0,
          ready: false,
        },
      ],
      snapshot,
      stateHash: hashSnapshot(snapshot),
      seq: 0,
      rematchUserIds: [],
      shots: [],
      updatedAt: Date.now(),
    };
    const room = this.install(record);
    room.sockets.set(context.userId, context.socket);
    this.currentRooms.set(context.userId, roomCode);
    await this.save(room);
    this.broadcastRoom(room, context.socket);
  }

  private async joinRoom(
    context: ClientContext,
    roomCode: string,
    inviteToken: string,
  ) {
    const room = this.rooms.get(roomCode);
    if (!room || room.record.inviteToken !== inviteToken)
      throw new Error("房间不存在或邀请令牌错误");
    const existing = room.record.players.find(
      (player) => player.userId === context.userId,
    );
    if (!existing && room.record.players.length >= 2)
      throw new Error("房间已有两名玩家");
    await this.leaveCurrentRoom(context, roomCode);
    if (existing) {
      existing.displayName = context.displayName;
    } else {
      room.record.players.push({
        userId: context.userId,
        displayName: context.displayName,
        playerIndex: 1,
        ready: false,
      });
      room.record.players.sort((a, b) => a.playerIndex - b.playerIndex);
      room.engine.state.players[1] = context.displayName;
      room.record.snapshot = room.engine.snapshot();
      room.record.stateHash = hashSnapshot(room.record.snapshot);
    }
    room.sockets.set(context.userId, context.socket);
    this.currentRooms.set(context.userId, roomCode);
    await this.save(room);
    this.broadcast(room, {
      protocolVersion: PROTOCOL_VERSION,
      type: "opponent",
      matchId: room.record.matchId,
      connected: true,
    });
    this.broadcastRoom(room);
  }

  private async ready(
    context: ClientContext,
    roomCode: string,
    ready: boolean,
  ) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error("房间不存在");
    const player = room.record.players.find(
      (candidate) => candidate.userId === context.userId,
    );
    if (!player) throw new Error("你不在该房间");
    if (room.record.status !== "waiting") throw new Error("对局已经开始");
    player.ready = ready;
    if (
      room.record.players.length === 2 &&
      room.record.players.every((candidate) => candidate.ready)
    ) {
      room.record.status = "playing";
      room.record.seq += 1;
    }
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
    this.assertPlaying(room, playerIndex);
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
    this.assertPlaying(room, playerIndex);
    room.record.snapshot = room.engine.nominateFreeBall(ballId, playerIndex);
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.seq += 1;
    await this.save(room);
    this.broadcastRoom(room);
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
    this.assertPlaying(room, playerIndex);
    const preSnapshot = room.engine.snapshot();
    const result = room.engine.shoot(input, playerIndex);
    room.record.snapshot = result.snapshot;
    room.record.stateHash = result.stateHash;
    room.record.status =
      result.snapshot.phase === "gameOver" ? "gameOver" : "playing";
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
      snapshot: result.snapshot,
      stateHash: result.stateHash,
      durationMs: result.durationMs,
    };
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
    });
    this.broadcastRoom(room, context.socket);
    const opponent = room.record.players.find(
      (player) => player.playerIndex !== playerIndex,
    );
    if (opponent) {
      send(context.socket, {
        protocolVersion: PROTOCOL_VERSION,
        type: "opponent",
        matchId,
        connected: room.sockets.has(opponent.userId),
      });
    }
  }

  private async rematch(context: ClientContext, matchId: string) {
    const { room } = this.memberRoom(context, matchId);
    if (room.record.status !== "gameOver") throw new Error("本局尚未结束");
    if (!room.record.rematchUserIds.includes(context.userId))
      room.record.rematchUserIds.push(context.userId);
    if (room.record.rematchUserIds.length === 2) {
      room.engine = new MatchEngine({
        gameType: room.record.gameType,
        playerNames: [
          room.record.players[0].displayName,
          room.record.players[1].displayName,
        ],
      });
      room.record.snapshot = room.engine.snapshot();
      room.record.stateHash = room.engine.stateHash();
      room.record.status = "playing";
      room.record.rematchUserIds = [];
      room.record.shots = [];
      room.shots.clear();
      room.record.seq += 1;
    }
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async concede(context: ClientContext, matchId: string) {
    const { room, playerIndex } = this.memberRoom(context, matchId);
    this.assertPlaying(room, playerIndex);
    room.record.snapshot = room.engine.concede(playerIndex);
    room.record.stateHash = hashSnapshot(room.record.snapshot);
    room.record.status = "gameOver";
    room.record.seq += 1;
    await this.save(room);
    this.broadcastRoom(room);
  }

  private async leave(context: ClientContext, matchId: string) {
    const { room } = this.memberRoom(context, matchId);
    this.broadcast(room, {
      protocolVersion: PROTOCOL_VERSION,
      type: "roomClosed",
      matchId,
      reason: "有玩家离开，房间已关闭",
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

  private assertPlaying(room: ActiveRoom, playerIndex: PlayerIndex) {
    if (room.record.status !== "playing")
      throw new Error("房间尚未开始或已经结束");
    if (room.record.players.length !== 2) throw new Error("等待好友加入");
    if (room.engine.state.currentPlayer !== playerIndex)
      throw new Error("还未轮到你");
  }

  private roomState(room: ActiveRoom): RoomState {
    return {
      roomCode: room.record.roomCode,
      inviteToken: room.record.inviteToken,
      matchId: room.record.matchId,
      gameType: room.record.gameType,
      status: room.record.status,
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
    const engine = MatchEngine.restore(record.snapshot);
    const room: ActiveRoom = {
      record,
      engine,
      sockets: new Map(),
      shots: new Map(record.shots.map((shot) => [shot.shotId, shot])),
    };
    this.rooms.set(record.roomCode, room);
    this.matches.set(record.matchId, record.roomCode);
    return room;
  }

  private async save(room: ActiveRoom) {
    room.record.snapshot = room.engine.snapshot();
    room.record.stateHash = hashSnapshot(room.record.snapshot);
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
