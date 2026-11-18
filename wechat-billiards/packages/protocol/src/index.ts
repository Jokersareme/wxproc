import type {
  CardEvent,
  CardId,
  GameType,
  MatchSnapshot,
  PhysicsEvent,
  PlayerIndex,
  RuleEvent,
  ShotInput,
} from "@friend-billiards/core";

export type {
  CardEvent,
  CardId,
  GameType,
  MatchSnapshot,
  PhysicsEvent,
  PlayerIndex,
  RuleEvent,
  ShotInput,
} from "@friend-billiards/core";


export const PROTOCOL_VERSION = 2;
export const MAX_MESSAGE_BYTES = 64 * 1024;

export type RoomMode = "classic" | "cards" | "threeSnooker";
export type RoomStatus = "trial" | "starting" | "playing" | "gameOver";
export type RoomCameraView = "top" | "follow" | "overview";
export const ROOM_CAMERA_VIEWS: RoomCameraView[] = [
  "top",
  "follow",
  "overview",
];
export const ROOM_PLAYBACK_SPEEDS = [1.15, 1.5, 2] as const;
export const DEFAULT_ROOM_PLAYBACK_SPEED = ROOM_PLAYBACK_SPEEDS[0];

export class ProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

interface BaseMessage {
  protocolVersion: number;
  requestId?: string;
}

export type ClientMessage = BaseMessage &
  (
    | { type: "login"; code?: string; token?: string; displayName?: string }
    | {
        type: "createRoom";
        gameType: GameType;
        predictionLevel: number;
        playbackSpeed?: number;
        cameraViews?: RoomCameraView[];
        mode?: RoomMode;
        cardCount?: number;
      }
    | { type: "joinRoom"; roomCode: string; inviteToken: string }
    | { type: "ready"; roomCode: string; ready: boolean }
    | {
        type: "updateRoomSettings";
        matchId: string;
        predictionLevel?: number;
        playbackSpeed?: number;
        cameraViews?: RoomCameraView[];
      }
    | { type: "placeBall"; matchId: string; x: number; y: number }
    | { type: "nominateFreeBall"; matchId: string; ballId: number }
    | {
        type: "playCard";
        matchId: string;
        cardUid: string;
        targetBallId?: number;
        targetPos?: { x: number; y: number };
        targetEffectId?: string;
      }
    | { type: "shoot"; matchId: string; shotId: string; input: ShotInput }
    | { type: "sync"; matchId: string }
    | { type: "rematch"; matchId: string }
    | { type: "concede"; matchId: string }
    | { type: "leave"; matchId: string }
    | { type: "ping"; nonce?: number }
  );

export interface RoomPlayer {
  userId: string;
  displayName: string;
  playerIndex: PlayerIndex;
  connected: boolean;
  ready: boolean;
}

export interface RoomState {
  roomCode: string;
  inviteToken: string;
  matchId: string;
  gameType: GameType;
  mode: RoomMode;
  cardCount: number;
  predictionLevel: number;
  playbackSpeed: number;
  cameraViews: RoomCameraView[];
  status: RoomStatus;
  hostPlayerIndex: PlayerIndex;
  playerCount: number;
  maxPlayers: 2 | 3;
  startAt: number | null;
  players: RoomPlayer[];
  rematchUserIds: string[];
  seq: number;
}

export type ServerMessage = BaseMessage &
  (
    | {
        type: "session";
        userId: string;
        sessionToken: string;
        expiresAt: number;
        serverTime: number;
      }
    | {
        type: "room";
        room: RoomState;
        snapshot: MatchSnapshot;
        stateHash: string;
      }
    | {
        type: "shot";
        room: RoomState;
        matchId: string;
        seq: number;
        shotId: string;
        player: PlayerIndex;
        preSnapshot: MatchSnapshot;
        input: ShotInput;
        events: PhysicsEvent[];
        ruleEvents: RuleEvent[];
        cardEvents?: CardEvent[];
        snapshot: MatchSnapshot;
        stateHash: string;
        durationMs: number;
      }
    | {
        type: "card";
        room: RoomState;
        matchId: string;
        seq: number;
        player: PlayerIndex;
        cardUid: string;
        cardId: CardId;
        targetBallId: number | null;
        targetPos: { x: number; y: number } | null;
        targetEffectId: string | null;
        events: CardEvent[];
        snapshot: MatchSnapshot;
        stateHash: string;
      }
    | {
        type: "opponent";
        matchId: string;
        connected: boolean;
        player?: PlayerIndex;
      }
    | { type: "roomClosed"; matchId: string; reason: string }
    | { type: "pong"; nonce?: number; serverTime: number }
    | { type: "error"; code: string; message: string }
  );

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validShot(value: unknown): value is ShotInput {
  if (!isObject(value)) return false;
  return ["angle", "power", "spinX", "spinY", "elevation"].every((key) =>
    finite(value[key]),
  );
}

function validPlaybackSpeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    (ROOM_PLAYBACK_SPEEDS as readonly number[]).includes(value)
  );
}

function validCameraViews(value: unknown): value is RoomCameraView[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= ROOM_CAMERA_VIEWS.length &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        ROOM_CAMERA_VIEWS.includes(entry as RoomCameraView),
    ) &&
    new Set(value).size === value.length
  );
}

export function parseClientMessage(value: unknown): ClientMessage {
  if (!isObject(value)) throw new Error("消息必须是对象");
  if (value.protocolVersion !== PROTOCOL_VERSION)
    throw new ProtocolError("PROTOCOL_VERSION", "请更新到最新版本");
  if (value.requestId !== undefined && !string(value.requestId, 64))
    throw new Error("请求 ID 无效");
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    ...(value.requestId ? { requestId: value.requestId as string } : {}),
  };
  switch (value.type) {
    case "login":
      if (!string(value.code, 256) && !string(value.token, 256))
        throw new Error("缺少登录凭证");
      if (value.displayName !== undefined && !string(value.displayName, 24))
        throw new Error("昵称无效");
      return {
        ...base,
        type: "login",
        code: value.code as string | undefined,
        token: value.token as string | undefined,
        displayName: value.displayName as string | undefined,
      };
    case "createRoom": {
      if (
        !["eightball", "nineball", "snooker"].includes(value.gameType as string)
      )
        throw new Error("玩法无效");
      const mode = (value.mode ?? "classic") as RoomMode;
      if (!["classic", "cards", "threeSnooker"].includes(mode))
        throw new Error("房间模式无效");
      if (mode === "threeSnooker" && value.gameType !== "snooker")
        throw new Error("三人模式只支持斯诺克");
      const predictionLevel =
        value.predictionLevel === undefined ? 0 : value.predictionLevel;
      if (
        !Number.isInteger(predictionLevel) ||
        (predictionLevel as number) < 0 ||
        (predictionLevel as number) > 5
      )
        throw new Error("预测线档位无效");
      const playbackSpeed =
        value.playbackSpeed === undefined
          ? DEFAULT_ROOM_PLAYBACK_SPEED
          : value.playbackSpeed;
      if (!validPlaybackSpeed(playbackSpeed))
        throw new Error("快速播放档位无效");
      const cameraViews =
        value.cameraViews === undefined
          ? [...ROOM_CAMERA_VIEWS]
          : value.cameraViews;
      if (!validCameraViews(cameraViews)) throw new Error("视角设置无效");
      const requestedCards =
        value.cardCount === undefined
          ? mode === "cards"
            ? 3
            : 0
          : value.cardCount;
      if (
        !Number.isInteger(requestedCards) ||
        (requestedCards as number) < 0 ||
        (requestedCards as number) > 6
      )
        throw new Error("卡牌数量无效");
      return {
        ...base,
        type: "createRoom",
        gameType: value.gameType as GameType,
        predictionLevel: predictionLevel as number,
        playbackSpeed,
        cameraViews: cameraViews as RoomCameraView[],
        mode,
        cardCount: mode === "cards" ? (requestedCards as number) : 0,
      };
    }
    case "joinRoom":
      if (
        !/^\d{6}$/.test(value.roomCode as string) ||
        typeof value.inviteToken !== "string" ||
        value.inviteToken.length > 128
      )
        throw new Error("房间邀请无效");
      return {
        ...base,
        type: "joinRoom",
        roomCode: value.roomCode as string,
        inviteToken: value.inviteToken as string,
      };
    case "ready":
      if (
        !/^\d{6}$/.test(value.roomCode as string) ||
        typeof value.ready !== "boolean"
      )
        throw new Error("准备消息无效");
      return {
        ...base,
        type: "ready",
        roomCode: value.roomCode as string,
        ready: value.ready,
      };
    case "updateRoomSettings": {
      if (!string(value.matchId, 64)) throw new Error("房间设置消息无效");
      const hasPrediction = value.predictionLevel !== undefined;
      const hasPlayback = value.playbackSpeed !== undefined;
      const hasViews = value.cameraViews !== undefined;
      if (!hasPrediction && !hasPlayback && !hasViews)
        throw new Error("房间设置没有变化");
      if (hasPrediction) {
        const level = value.predictionLevel;
        if (!Number.isInteger(level) || (level as number) < 0 || (level as number) > 5)
          throw new Error("预测线档位无效");
      }
      if (hasPlayback && !validPlaybackSpeed(value.playbackSpeed))
        throw new Error("快速播放档位无效");
      if (hasViews && !validCameraViews(value.cameraViews))
        throw new Error("视角设置无效");
      return {
        ...base,
        type: "updateRoomSettings",
        matchId: value.matchId,
        ...(hasPrediction
          ? { predictionLevel: value.predictionLevel as number }
          : {}),
        ...(hasPlayback
          ? { playbackSpeed: value.playbackSpeed as number }
          : {}),
        ...(hasViews
          ? { cameraViews: value.cameraViews as RoomCameraView[] }
          : {}),
      };
    }
    case "placeBall":
      if (!string(value.matchId, 64) || !finite(value.x) || !finite(value.y))
        throw new Error("母球摆放消息无效");
      return {
        ...base,
        type: "placeBall",
        matchId: value.matchId,
        x: value.x,
        y: value.y,
      };
    case "nominateFreeBall":
      if (!string(value.matchId, 64) || !Number.isInteger(value.ballId))
        throw new Error("自由球消息无效");
      return {
        ...base,
        type: "nominateFreeBall",
        matchId: value.matchId,
        ballId: value.ballId as number,
      };
    case "playCard": {
      if (!string(value.matchId, 64) || !string(value.cardUid, 96))
        throw new Error("卡牌消息无效");
      if (
        value.targetBallId !== undefined &&
        (!Number.isInteger(value.targetBallId) ||
          (value.targetBallId as number) < 0)
      )
        throw new Error("卡牌目标球无效");
      if (value.targetPos !== undefined) {
        if (
          !isObject(value.targetPos) ||
          !finite(value.targetPos.x) ||
          !finite(value.targetPos.y)
        )
          throw new Error("卡牌目标位置无效");
      }
      if (
        value.targetEffectId !== undefined &&
        !string(value.targetEffectId, 120)
      )
        throw new Error("卡牌目标效果无效");
      return {
        ...base,
        type: "playCard",
        matchId: value.matchId,
        cardUid: value.cardUid,
        ...(value.targetBallId !== undefined
          ? { targetBallId: value.targetBallId as number }
          : {}),
        ...(value.targetPos !== undefined
          ? {
              targetPos: {
                x: (value.targetPos as any).x,
                y: (value.targetPos as any).y,
              },
            }
          : {}),
        ...(value.targetEffectId !== undefined
          ? { targetEffectId: value.targetEffectId as string }
          : {}),
      };
    }
    case "shoot":
      if (
        !string(value.matchId, 64) ||
        !string(value.shotId, 64) ||
        !validShot(value.input)
      )
        throw new Error("击球消息无效");
      return {
        ...base,
        type: "shoot",
        matchId: value.matchId,
        shotId: value.shotId,
        input: value.input,
      };
    case "sync":
    case "rematch":
    case "concede":
    case "leave":
      if (!string(value.matchId, 64)) throw new Error("对局 ID 无效");
      return { ...base, type: value.type, matchId: value.matchId };
    case "ping":
      if (value.nonce !== undefined && !finite(value.nonce))
        throw new Error("心跳消息无效");
      return {
        ...base,
        type: "ping",
        nonce: value.nonce as number | undefined,
      };
    default:
      throw new Error("未知消息类型");
  }
}
