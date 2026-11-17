import type {
  GameType,
  MatchSnapshot,
  PhysicsEvent,
  PlayerIndex,
  RuleEvent,
  ShotInput,
} from "@friend-billiards/core";

export type {
  GameType,
  MatchSnapshot,
  PhysicsEvent,
  PlayerIndex,
  RuleEvent,
  ShotInput,
} from "@friend-billiards/core";

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 64 * 1024;

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
      }
    | { type: "joinRoom"; roomCode: string; inviteToken: string }
    | { type: "ready"; roomCode: string; ready: boolean }
    | { type: "placeBall"; matchId: string; x: number; y: number }
    | { type: "nominateFreeBall"; matchId: string; ballId: number }
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
  predictionLevel: number;
  status: "waiting" | "playing" | "gameOver";
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
        snapshot: MatchSnapshot;
        stateHash: string;
        durationMs: number;
      }
    | { type: "opponent"; matchId: string; connected: boolean }
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

export function parseClientMessage(value: unknown): ClientMessage {
  if (!isObject(value)) throw new Error("消息必须是对象");
  if (value.protocolVersion !== PROTOCOL_VERSION)
    throw new Error("客户端协议版本不兼容");
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
      const predictionLevel =
        value.predictionLevel === undefined ? 1 : value.predictionLevel;
      if (
        !Number.isInteger(predictionLevel) ||
        (predictionLevel as number) < 1 ||
        (predictionLevel as number) > 5
      )
        throw new Error("预测线档位无效");
      return {
        ...base,
        type: "createRoom",
        gameType: value.gameType as GameType,
        predictionLevel: predictionLevel as number,
      };
    }
    case "joinRoom":
      if (
        !/^\d{6}$/.test(value.roomCode as string) ||
        !string(value.inviteToken, 128)
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
