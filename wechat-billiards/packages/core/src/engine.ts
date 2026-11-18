import { Vector3 } from "three";
import { Ball, State } from "../../../third_party/billiards/src/model/ball";
import { Table } from "../../../third_party/billiards/src/model/table";
import {
  Outcome,
  OutcomeType,
} from "../../../third_party/billiards/src/model/outcome";
import { Rack } from "../../../third_party/billiards/src/utils/rack";
import { Respot } from "../../../third_party/billiards/src/utils/respot";
import { TableGeometry } from "../../../third_party/billiards/src/view/tablegeometry";
import { PocketGeometry } from "../../../third_party/billiards/src/view/pocketgeometry";
import { cueStrike } from "../../../third_party/billiards/src/model/physics/physics";
import {
  offCenterLimit,
  R,
  sete,
  setee,
} from "../../../third_party/billiards/src/model/physics/constants";
import { hashSnapshot } from "./hash";
import {
  CardRuleError,
  createCardState,
  defFor,
  effectApplies,
  expireCardEffects,
  mulberry32,
  shotModifiers,
} from "./cards";
import {
  tightenEightBallRack,
  tightenNineBallRack,
  tightenSnookerRack,
} from "./rack";
import { applyMatchTable, GAME_PHYSICS, STOP_SPEED, tunedMaxPower } from "./tuning";
import type {
  BallGroup,
  BallSnapshot,
  CardEvent,
  CardEffectKind,
  CardId,
  CardPlayRequest,
  CardPlayResult,
  CardState,
  CreateMatchOptions,
  GameType,
  MatchPhase,
  MatchSnapshot,
  PhysicsEvent,
  PlayerIndex,
  RuleEvent,
  ShotFrame,
  ShotInput,
  ShotModifiers,
  ShotResult,
  Vec3Data,
} from "./types";

export const PHYSICS_STEP = 0.001953125;
const MAX_SHOT_SECONDS = 90;
const FRAME_INTERVAL = 8;

/**
 * Shared settle rule. Called after every physics step on both the practice
 * client and the authoritative server, so a shot ends at the same frame.
 */
export function stopSlowBall(ball: Ball): boolean {
  if (!ball.onTable() || ball.vel.length() >= STOP_SPEED) return false;
  ball.setStationary();
  return true;
}

/**
 * Pure legality check used by the drag preview in both practice and online
 * matches. Keeping it snapshot-based means the client can turn the cue ball
 * red (and refuse the release) without waiting for an authoritative reply.
 */
export function cueBallPlacementLegal(
  snapshot: Pick<MatchSnapshot, "gameType" | "balls">,
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (
    Math.abs(x) > TableGeometry.tableX - R ||
    Math.abs(y) > TableGeometry.tableY - R
  )
    return false;
  if (snapshot.gameType === "snooker") {
    if (x > Rack.baulk || Math.hypot(x - Rack.baulk, y) > Rack.sixth)
      return false;
  }
  return !snapshot.balls.some(
    (ball) =>
      ball.id !== 0 &&
      ball.state !== "InPocket" &&
      Math.hypot(ball.pos[0] - x, ball.pos[1] - y) < 2 * R,
  );
}

/**
 * Snap a dropped cue ball to the closest legal spot. The search starts at the
 * requested point (clamped to the table / snooker D) and expands in rings, so
 * releasing over a cushion or another ball still leaves the cue in a playable
 * position instead of resetting to the previous one.
 */
export function nearestLegalCueBallPosition(
  snapshot: Pick<MatchSnapshot, "gameType" | "balls">,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const clearance = 0.0001;
  const maxX = TableGeometry.tableX - R - clearance;
  const maxY = TableGeometry.tableY - R - clearance;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const project = (px: number, py: number) => {
    let nx = Number.isFinite(px) ? clamp(px, -maxX, maxX) : 0;
    let ny = Number.isFinite(py) ? clamp(py, -maxY, maxY) : 0;
    if (snapshot.gameType === "snooker") {
      const baulk = Rack.baulk - clearance;
      const sixth = Rack.sixth - clearance;
      nx = Math.min(nx, baulk);
      const dx = nx - Rack.baulk;
      const dy = ny;
      const distance = Math.hypot(dx, dy);
      if (distance > sixth) {
        if (distance < 1e-9) {
          nx = baulk - sixth;
          ny = 0;
        } else {
          nx = Rack.baulk + (dx / distance) * sixth;
          ny = (dy / distance) * sixth;
        }
      }
    }
    return { x: nx, y: ny };
  };
  const legal = (px: number, py: number) => {
    if (Math.abs(px) > maxX || Math.abs(py) > maxY) return false;
    if (snapshot.gameType === "snooker") {
      if (px > Rack.baulk - clearance) return false;
      if (Math.hypot(px - Rack.baulk, py) > Rack.sixth - clearance)
        return false;
    }
    return !snapshot.balls.some(
      (ball) =>
        ball.id !== 0 &&
        ball.state !== "InPocket" &&
        Math.hypot(ball.pos[0] - px, ball.pos[1] - py) < 2 * R + clearance,
    );
  };

  const start = project(x, y);
  if (legal(start.x, start.y)) return start;

  const step = Math.max(0.006, R * 0.35);
  const maxRadius = Math.hypot(maxX, maxY) * 2 + step;
  for (let radius = step; radius <= maxRadius; radius += step) {
    const samples = Math.max(16, Math.ceil((2 * Math.PI * radius) / step));
    let best: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const candidate = project(
        start.x + Math.cos(angle) * radius,
        start.y + Math.sin(angle) * radius,
      );
      if (!legal(candidate.x, candidate.y)) continue;
      const distance = Math.hypot(
        candidate.x - start.x,
        candidate.y - start.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (best) return best;
  }
  return null;
}

(globalThis as { __BILLIARDS_HEADLESS__?: boolean }).__BILLIARDS_HEADLESS__ =
  true;

function cloneSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MatchSnapshot;
}

export function validateShotInput(
  input: ShotInput,
  spinLimit = offCenterLimit,
): string | null {
  if (!input || !Number.isFinite(input.angle)) return "击球角度无效";
  if (!Number.isFinite(input.power) || input.power <= 0 || input.power > 1) {
    return "击球力度必须在 0 到 1 之间";
  }
  if (!Number.isFinite(input.spinX) || !Number.isFinite(input.spinY)) {
    return "杆法偏移无效";
  }
  if (Math.hypot(input.spinX, input.spinY) > spinLimit + 0.0001) {
    return "杆法偏移超出母球范围";
  }
  if (
    !Number.isFinite(input.elevation) ||
    input.elevation < 0 ||
    input.elevation > Math.PI / 3
  ) {
    return "球杆仰角无效";
  }
  return null;
}

function normalisePlayerCount(value: number | undefined): number {
  if (!Number.isInteger(value)) return 2;
  return Math.max(2, Math.min(3, value as number));
}

function lowestColourOnTable(balls: BallSnapshot[]): number {
  const ids = balls
    .filter(
      (ball) =>
        ball.id >= 1 &&
        ball.id <= 6 &&
        ball.state !== "InPocket" &&
        ball.state !== "Falling",
    )
    .map((ball) => ball.id);
  return ids.length ? Math.min(...ids) : 1;
}

function migrateSnapshot(raw: MatchSnapshot): MatchSnapshot {
  const legacy = raw as unknown as {
    version: number;
    gameType: GameType;
    phase: MatchPhase;
    canRepositionCue: boolean;
    practice: boolean;
    playerCount?: number;
    currentPlayer: PlayerIndex;
    players?: string[];
    groups?: BallGroup[];
    scores?: number[];
    eliminated?: boolean[];
    ranking?: PlayerIndex[];
    currentBreak: number;
    bestBreak?: number[];
    pots?: number[];
    shotNumber: number;
    target?: Partial<MatchSnapshot["target"]>;
    balls?: BallSnapshot[];
    winner: PlayerIndex | null;
    endReason: string | null;
    lastMessage: string | null;
    cards?: CardState | null;
  };
  const names = Array.isArray(legacy.players)
    ? legacy.players
    : ["玩家 1", "玩家 2"];
  const playerCount =
    legacy.version === 1
      ? names.length
      : normalisePlayerCount(legacy.playerCount ?? names.length);
  const players = Array.from(
    { length: playerCount },
    (_, index) => names[index] ?? `玩家 ${index + 1}`,
  );
  const snapshot: MatchSnapshot = {
    ...legacy,
    version: 2,
    playerCount,
    players,
    groups: players.map((_, index) => legacy.groups?.[index] ?? "open"),
    scores: players.map((_, index) => legacy.scores?.[index] ?? 0),
    eliminated: players.map((_, index) => legacy.eliminated?.[index] ?? false),
    ranking: [...(legacy.ranking ?? [])],
    bestBreak: players.map((_, index) => legacy.bestBreak?.[index] ?? 0),
    pots: players.map((_, index) => legacy.pots?.[index] ?? 0),
    balls: legacy.balls ?? [],
    cards: legacy.cards ?? null,
    target: {
      targetIsRed: legacy.target?.targetIsRed ?? true,
      previousPotRed: legacy.target?.previousPotRed ?? false,
      freeBall: legacy.target?.freeBall ?? false,
      nominatedBall: legacy.target?.nominatedBall ?? null,
      respottedBlack: legacy.target?.respottedBlack ?? false,
      nextColour:
        legacy.target?.nextColour ?? lowestColourOnTable(legacy.balls ?? []),
    },
  };
  return snapshot;
}

function vectorData(vector: Vector3): Vec3Data {
  return [vector.x, vector.y, vector.z];
}

function normaliseShot(input: ShotInput): ShotInput {
  return {
    angle: Math.fround(input.angle),
    power: Math.fround(input.power),
    spinX: Math.fround(input.spinX),
    spinY: Math.fround(input.spinY),
    elevation: Math.fround(input.elevation),
  };
}

export class MatchEngine {
  readonly table: Table;
  state: MatchSnapshot;

  constructor(options: CreateMatchOptions | MatchSnapshot) {
    if ("gameType" in options && "version" in options) {
      this.state = migrateSnapshot(cloneSnapshot(options as MatchSnapshot));
      this.state.canRepositionCue =
        options.canRepositionCue ?? options.phase === "ballInHand";
      this.configure();
      Ball.id = 0;
      const balls = this.state.balls.map((data) => {
        const ball = new Ball(
          new Vector3(...data.pos),
          undefined,
          data.label ?? undefined,
        );
        ball.vel.set(...data.vel);
        ball.rvel.set(...data.rvel);
        ball.state = data.state as State;
        return ball;
      });
      this.table = new Table(balls);
      return;
    }

    const gameType = options.gameType;
    this.configure(gameType);
    Ball.id = 0;
    const balls =
      gameType === "eightball"
        ? Rack.eightBall()
        : gameType === "nineball"
          ? Rack.diamond()
          : Rack.snooker();
    this.table = new Table(balls);
    if (gameType === "eightball") tightenEightBallRack(balls);
    if (gameType === "nineball") tightenNineBallRack(balls);
    if (gameType === "snooker") tightenSnookerRack(balls);
    const playerCount = normalisePlayerCount(
      options.playerCount ?? options.playerNames?.length ?? 2,
    );
    const players = Array.from(
      { length: playerCount },
      (_, index) => options.playerNames?.[index] ?? `玩家 ${index + 1}`,
    );
    const cardMode = options.mode === "cards";
    const cardCount = cardMode
      ? Math.max(0, Math.min(6, Math.floor(options.cardCount ?? 3)))
      : 0;
    const seed = (options.seed ?? 0x51ed270b) >>> 0;
    const startingPlayer = Math.max(
      0,
      Math.min(
        playerCount - 1,
        Number.isInteger(options.startingPlayer)
          ? (options.startingPlayer as number)
          : 0,
      ),
    );
    this.state = {
      version: 2,
      gameType,
      phase: "aiming",
      canRepositionCue: true,
      practice: options.practice ?? false,
      playerCount,
      currentPlayer: startingPlayer,
      players,
      groups: players.map(() => "open"),
      scores: players.map(() => 0),
      eliminated: players.map(() => false),
      ranking: [],
      currentBreak: 0,
      bestBreak: players.map(() => 0),
      pots: players.map(() => 0),
      shotNumber: 0,
      target: {
        targetIsRed: true,
        previousPotRed: false,
        freeBall: false,
        nominatedBall: null,
        respottedBlack: false,
        nextColour: 1,
      },
      balls: [],
      winner: null,
      endReason: null,
      lastMessage: null,
      cards: cardMode
        ? createCardState(
            playerCount,
            cardCount,
            gameType,
            seed,
            options.practice ?? false,
          )
        : null,
    };
    this.state.balls = this.serialiseBalls();
  }

  static restore(snapshot: MatchSnapshot): MatchEngine {
    return new MatchEngine(snapshot);
  }

  snapshot(): MatchSnapshot {
    this.state.balls = this.serialiseBalls();
    return cloneSnapshot(this.state);
  }

  stateHash(): string {
    return hashSnapshot(this.snapshot());
  }

  private cardEvents: CardEvent[] = [];

  shoot(
    rawInput: ShotInput,
    player: PlayerIndex = this.state.currentPlayer,
    collectFrames = false,
  ): ShotResult {
    const modifiers = shotModifiers(this.state.cards, player);
    const effectiveRaw = modifiers.spinForcedZero
      ? { ...rawInput, spinX: 0, spinY: 0 }
      : rawInput;
    const invalid = validateShotInput(
      effectiveRaw,
      modifiers.spinForcedZero ? offCenterLimit : modifiers.spinLimit,
    );
    if (invalid) throw new Error(invalid);
    if (this.state.phase !== "aiming") throw new Error("当前不能击球");
    if (player !== this.state.currentPlayer) throw new Error("还未轮到你");
    if (!this.table.cueball.onTable()) throw new Error("请先摆放母球");

    this.state.canRepositionCue = false;
    this.configure();
    const restoreCushion = GAME_PHYSICS.cushionRestitution;
    const input = normaliseShot(effectiveRaw);
    const isBreak = this.state.shotNumber === 0;
    const frames: ShotFrame[] | undefined = collectFrames ? [] : undefined;
    this.cardEvents = [];
    this.state.phase = "shooting";
    this.state.lastMessage = null;
    this.table.outcome = [];
    this.table.time = 0;
    let ruleEvents: RuleEvent[];
    let physicsEvents: PhysicsEvent[];
    try {
      if (modifiers.cushionScale !== 1) {
        const cushion = restoreCushion * modifiers.cushionScale;
        setee(cushion);
        sete(cushion);
      }
      const strike = cueStrike(
        input.angle,
        input.power * modifiers.powerScale * tunedMaxPower(),
        new Vector3(input.spinX, input.spinY, 0),
        input.elevation,
      );
      this.table.cueball.state = State.Sliding;
      this.table.cueball.vel.copy(strike.vel);
      this.table.cueball.rvel.copy(strike.rvel);
      this.captureFrame(frames);

      const maximumSteps = Math.ceil(MAX_SHOT_SECONDS / PHYSICS_STEP);
      let steps = 0;
      while (!this.table.allStationary()) {
        if (++steps > maximumSteps) {
          this.table.halt();
          throw new Error("击球模拟超过时限，已中止");
        }
        this.table.advance(PHYSICS_STEP);
        this.settleSlowBalls();
        if (steps % FRAME_INTERVAL === 0) this.captureFrame(frames);
      }
      this.captureFrame(frames);

      const outcomes = this.table.outcome;
      physicsEvents = outcomes.map((outcome) => ({
        type:
          outcome.type === OutcomeType.Pot
            ? "pot"
            : outcome.type === OutcomeType.Cushion
              ? "cushion"
              : "collision",
        timestamp: outcome.timestamp,
        ballA: outcome.ballA!.id,
        ballB: outcome.ballB?.id ?? null,
        incidentSpeed: outcome.incidentSpeed,
        ...(outcome.cushion ? { cushion: outcome.cushion } : {}),
      }));
      ruleEvents = this.applyRules(outcomes, isBreak, modifiers);
      this.state.shotNumber += 1;
      this.state.balls = this.serialiseBalls();
      this.captureFrame(frames);
    } finally {
      setee(restoreCushion);
      sete(restoreCushion);
      expireCardEffects(this.state.cards, "afterShot", player);
      this.state.balls = this.serialiseBalls();
    }
    const snapshot = this.snapshot();
    return {
      input,
      events: physicsEvents,
      ruleEvents,
      cardEvents: [...this.cardEvents],
      snapshot,
      stateHash: hashSnapshot(snapshot),
      durationMs: this.table.time,
      ...(frames ? { frames } : {}),
    };
  }

  cueBallPositionLegal(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return this.isCueBallPositionLegal(
      new Vector3(Math.fround(x), Math.fround(y), 0),
    );
  }

  placeCueBall(x: number, y: number, player = this.state.currentPlayer) {
    const canPlace =
      this.state.phase === "ballInHand" ||
      (this.state.phase === "aiming" && this.state.canRepositionCue);
    if (!canPlace) throw new Error("当前没有自由球");
    if (player !== this.state.currentPlayer) throw new Error("还未轮到你");
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("母球位置无效");
    this.configure();
    const target = new Vector3(Math.fround(x), Math.fround(y), 0);
    if (!this.isCueBallPositionLegal(target)) {
      throw new Error("母球不能与其他球重叠或超出允许区域");
    }
    const cueball = this.table.cueball;
    cueball.pos.copy(target);
    cueball.vel.set(0, 0, 0);
    cueball.rvel.set(0, 0, 0);
    cueball.state = State.Stationary;
    this.state.phase = "aiming";
    this.state.canRepositionCue = true;
    this.state.lastMessage = "任意球：母球已摆放，可继续拖动调整";
    return this.snapshot();
  }

  nominateFreeBall(ballId: number, player = this.state.currentPlayer) {
    if (this.state.gameType !== "snooker" || !this.state.target.freeBall) {
      throw new Error("当前没有自由球提名");
    }
    if (player !== this.state.currentPlayer) throw new Error("还未轮到你");
    if (!Number.isInteger(ballId) || ballId < 1 || ballId > 6) {
      throw new Error("自由球必须提名为彩球");
    }
    const ball = this.table.balls[ballId];
    if (!ball?.onTable()) throw new Error("提名的彩球不在台面");
    if (
      !this.state.target.targetIsRed &&
      !this.state.target.previousPotRed &&
      ballId === this.state.target.nextColour
    )
      throw new Error("不能提名当前目标球");
    this.state.target.nominatedBall = ballId;
    this.state.lastMessage = `已提名${this.colourName(ballId)}为自由球`;
    return this.snapshot();
  }

  playCard(
    player: PlayerIndex,
    request: CardPlayRequest,
  ): CardPlayResult {
    const cards = this.state.cards;
    if (!cards?.enabled || !request?.cardUid)
      throw new CardRuleError("CARD_NOT_FOUND", "这张牌不在你手里");
    if (this.state.phase !== "aiming")
      throw new CardRuleError("CARD_NOT_YOUR_TURN", "现在不能使用卡牌");
    if (player !== this.state.currentPlayer)
      throw new CardRuleError("CARD_NOT_YOUR_TURN", "还没轮到你");
    if (
      cards.active.some(
        (effect) =>
          effect.kind === "silence" &&
          effect.target === player &&
          effect.owner !== player,
      )
    )
      throw new CardRuleError("CARD_SILENCED", "你被沉默，下回合不能出牌");
    if (cards.playedThisTurn)
      throw new CardRuleError("CARD_ALREADY_PLAYED", "本回合已经用过卡牌");
    const hand = cards.hands[player] ?? [];
    const index = hand.findIndex((card) => card.uid === request.cardUid);
    if (index < 0)
      throw new CardRuleError("CARD_NOT_FOUND", "这张牌不在你手里");
    const instance = hand[index];
    const definition = defFor(instance.cardId);
    if (!definition.modes.includes(this.state.gameType))
      throw new CardRuleError("CARD_MODE_INVALID", "当前玩法不能使用这张牌");

    const events: CardEvent[] = [];
    const targetBallId =
      Number.isInteger(request.targetBallId) && request.targetBallId! >= 0
        ? (request.targetBallId as number)
        : null;
    const targetPos =
      request.targetPos &&
      Number.isFinite(request.targetPos.x) &&
      Number.isFinite(request.targetPos.y)
        ? {
            x: Math.fround(request.targetPos.x),
            y: Math.fround(request.targetPos.y),
          }
        : null;
    const targetEffectId =
      typeof request.targetEffectId === "string" &&
      request.targetEffectId.length > 0
        ? request.targetEffectId
        : null;

    hand.splice(index, 1);
    try {
      this.applyCardEffect(
        cards,
        player,
        instance.cardId,
        targetBallId,
        targetPos,
        targetEffectId,
        events,
      );
    } catch (error) {
      hand.splice(index, 0, instance);
      throw error;
    }
    cards.used[player].push(instance.cardId);
    cards.lastPlayed[player] = instance.cardId;
    cards.discard.push(instance.cardId);
    cards.playedThisTurn = true;
    this.state.lastMessage = `已使用${definition.name}`;
    this.state.balls = this.serialiseBalls();
    events.unshift({ type: "played", cardId: instance.cardId, player });
    const snapshot = this.snapshot();
    return {
      snapshot,
      events,
      cardId: instance.cardId,
      targetBallId,
      targetPos,
      targetEffectId,
    };
  }

  private applyCardEffect(
    cards: CardState,
    player: PlayerIndex,
    cardId: CardId,
    targetBallId: number | null,
    targetPos: { x: number; y: number } | null,
    targetEffectId: string | null,
    events: CardEvent[],
  ) {
    const opponent = this.nextActivePlayer(player);
    switch (cardId) {
      case "eagle_eye":
        this.addEffect(cards, cardId, player, null, "predictionBonus", 2, "shot", events);
        break;
      case "cannon":
        this.addEffect(cards, cardId, player, null, "powerScale", 1.2, "shot", events);
        break;
      case "feather":
        this.addEffect(cards, cardId, player, null, "powerScale", 0.65, "shot", events);
        this.addEffect(cards, cardId, player, null, "predictionBonus", 1, "shot", events);
        break;
      case "deep_spin":
        this.addEffect(cards, cardId, player, null, "spinLimit", 0.65, "shot", events);
        break;
      case "silence":
        this.addEffect(cards, cardId, player, opponent, "silence", 1, "targetTurn", events);
        break;
      case "shield":
        this.addEffect(cards, cardId, player, null, "shield", 1, "frame", events);
        break;
      case "shuffle": {
        if (targetBallId === null || !targetPos)
          throw new CardRuleError("CARD_TARGET_INVALID", "请选择一颗球和落点");
        const ball = this.table.balls[targetBallId];
        if (!ball?.onTable() || ball.id === 0)
          throw new CardRuleError("CARD_TARGET_INVALID", "请选择一颗台面上的球");
        if (this.isKeyBall(ball))
          throw new CardRuleError("CARD_TARGET_INVALID", "关键球不能移动");
        const from: [number, number] = [ball.pos.x, ball.pos.y];
        if (Math.hypot(targetPos.x - from[0], targetPos.y - from[1]) > 1.5 * R + 1e-6)
          throw new CardRuleError("CARD_TARGET_INVALID", "最多移动 1.5 个球半径");
        if (!this.isObjectBallPositionLegal(ball, targetPos.x, targetPos.y))
          throw new CardRuleError("CARD_TARGET_INVALID", "这个位置不能放球");
        ball.pos.set(targetPos.x, targetPos.y, 0);
        ball.vel.set(0, 0, 0);
        ball.rvel.set(0, 0, 0);
        ball.state = State.Stationary;
        events.push({
          type: "ballMoved",
          ballId: ball.id,
          from,
          to: [targetPos.x, targetPos.y],
        });
        break;
      }
      case "swap_hand": {
        if ((cards.hands[player]?.length ?? 0) === 0)
          throw new CardRuleError("CARD_NO_TARGET", "没有可交换的手牌");
        const opponents = this.state.players
          .map((_, index) => index)
          .filter(
            (index) => index !== player && (cards.hands[index]?.length ?? 0) > 0,
          );
        if (opponents.length === 0)
          throw new CardRuleError("CARD_OPPONENT_EMPTY", "对手没有手牌");
        const other =
          opponents[Math.floor(this.nextRandom(cards) * opponents.length)];
        const mine = cards.hands[player];
        const theirs = cards.hands[other];
        const mineIndex = Math.floor(this.nextRandom(cards) * mine.length);
        const theirIndex = Math.floor(this.nextRandom(cards) * theirs.length);
        [mine[mineIndex], theirs[theirIndex]] = [
          theirs[theirIndex],
          mine[mineIndex],
        ];
        events.push({ type: "handChanged", player, count: mine.length });
        events.push({ type: "handChanged", player: other, count: theirs.length });
        break;
      }
      case "dispel": {
        if (!targetEffectId)
          throw new CardRuleError("CARD_NO_EFFECT", "请选择要移除的效果");
        const effect = cards.active.find(
          (candidate) =>
            candidate.effectId === targetEffectId &&
            candidate.owner !== player &&
            candidate.owner !== undefined,
        );
        if (!effect)
          throw new CardRuleError("CARD_NO_EFFECT", "没有可移除的效果");
        cards.active = cards.active.filter(
          (candidate) => candidate.effectId !== targetEffectId,
        );
        events.push({ type: "effectRemoved", effectId: targetEffectId });
        break;
      }
      case "spring":
        this.addEffect(cards, cardId, player, null, "cushionScale", 1.15, "shot", events);
        break;
      case "bonus_ball":
        this.addEffect(cards, cardId, player, null, "bonusPerPot", 1, "shot", events);
        break;
      case "copy": {
        const last = cards.lastPlayed[opponent];
        if (!last)
          throw new CardRuleError("CARD_NO_TARGET", "对手还没有使用过卡牌");
        const uid = `${cards.dealSeed}-copy-${player}-${cards.hands[player].length}-${this.state.shotNumber}`;
        cards.hands[player].push({ uid, cardId: last });
        events.push({
          type: "handChanged",
          player,
          count: cards.hands[player].length,
        });
        break;
      }
      case "freeze":
        this.addEffect(cards, cardId, player, opponent, "freeze", 1, "targetShot", events);
        break;
      case "steal": {
        const opponents = this.state.players
          .map((_, index) => index)
          .filter(
            (index) => index !== player && (cards.hands[index]?.length ?? 0) > 0,
          );
        if (opponents.length === 0)
          throw new CardRuleError("CARD_OPPONENT_EMPTY", "对手没有手牌");
        const other =
          opponents[Math.floor(this.nextRandom(cards) * opponents.length)];
        const hand = cards.hands[other];
        const index = Math.floor(this.nextRandom(cards) * hand.length);
        const [stolen] = hand.splice(index, 1);
        cards.hands[player].push(stolen);
        events.push({ type: "handChanged", player: other, count: hand.length });
        events.push({
          type: "handChanged",
          player,
          count: cards.hands[player].length,
        });
        break;
      }
      case "second_life":
        this.addEffect(cards, cardId, player, null, "secondLife", 1, "frame", events);
        break;
      case "double":
        this.addEffect(cards, cardId, player, null, "scoreMultiplier", 2, "shot", events);
        break;
      case "command": {
        if (targetBallId === null)
          throw new CardRuleError("CARD_NO_TARGET", "请选择一颗球");
        const ball = this.table.balls[targetBallId];
        if (!ball?.onTable() || ball.id === 0)
          throw new CardRuleError("CARD_TARGET_INVALID", "请选择一颗台面上的球");
        this.addEffect(
          cards,
          cardId,
          player,
          null,
          "commandBall",
          targetBallId,
          "shot",
          events,
        );
        break;
      }
      case "red_rain": {
        if (this.state.gameType !== "snooker" || !this.state.target.targetIsRed)
          throw new CardRuleError("CARD_MODE_INVALID", "只有红球阶段可以使用");
        const potted = this.table.balls.filter(
          (ball) => ball.id >= 7 && !ball.onTable(),
        );
        if (potted.length === 0)
          throw new CardRuleError("CARD_NO_TARGET", "台面没有可放回的红球");
        const ids: number[] = [];
        for (const red of potted.slice(0, 2)) {
          const spot = this.nextRedSpot();
          if (!spot) break;
          red.pos.copy(spot);
          red.vel.set(0, 0, 0);
          red.rvel.set(0, 0, 0);
          red.pos.z = 0;
          red.state = State.Stationary;
          ids.push(red.id);
        }
        events.push({ type: "redsRespot", ballIds: ids });
        break;
      }
      default:
        throw new CardRuleError("CARD_MODE_INVALID", "当前玩法不能使用这张牌");
    }
  }

  private addEffect(
    cards: CardState,
    cardId: CardId,
    owner: PlayerIndex,
    target: PlayerIndex | null,
    kind: CardEffectKind,
    value: number,
    expires: "shot" | "targetShot" | "targetTurn" | "frame",
    events: CardEvent[],
  ) {
    const effectId = `${cardId}:${owner}:${this.state.shotNumber}:${cards.active.length}`;
    cards.active.push({
      effectId,
      cardId,
      owner,
      target,
      kind,
      value,
      expires,
      createdSeq: this.state.shotNumber,
    });
    events.push({ type: "effectApplied", effectId, kind, target });
  }

  private nextRandom(cards: CardState): number {
    const random = mulberry32(cards.rngSeed);
    const value = random();
    cards.rngSeed = (Math.floor(value * 4294967296) ^ (cards.rngSeed + 0x6d2b79f5)) >>> 0;
    return value;
  }

  private isKeyBall(ball: Ball): boolean {
    if (ball.id === 0) return true;
    if (this.state.gameType === "eightball") return ball.label === 8;
    if (this.state.gameType === "nineball") return ball.label === 9;
    return ball.id === 6;
  }

  private isObjectBallPositionLegal(
    ball: Ball,
    x: number,
    y: number,
  ): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (
      Math.abs(x) > TableGeometry.tableX - R ||
      Math.abs(y) > TableGeometry.tableY - R
    )
      return false;
    if (this.table.balls.some(
      (other) =>
        other !== ball &&
        other.onTable() &&
        Math.hypot(other.pos.x - x, other.pos.y - y) < 2 * R,
    ))
      return false;
    return PocketGeometry.pocketCenters.every((center, index) => {
      const radius =
        index === 2 || index === 3
          ? PocketGeometry.middleRadius
          : PocketGeometry.cornerRadius;
      return Math.hypot(center.pos.x - x, center.pos.y - y) > radius + R;
    });
  }

  private nextRedSpot(): Vector3 | null {
    const step = R / 2;
    for (
      let x = TableGeometry.tableX * 0.75;
      x >= -TableGeometry.tableX * 0.5;
      x -= step
    ) {
      const spot = new Vector3(x, 0, 0);
      if (
        this.table.balls.some(
          (ball) =>
            ball.onTable() &&
            ball.pos.distanceTo(spot) < 2 * R,
        )
      )
        continue;
      if (
        PocketGeometry.pocketCenters.some((center, index) => {
          const radius =
            index === 2 || index === 3
              ? PocketGeometry.middleRadius
              : PocketGeometry.cornerRadius;
          return Math.hypot(center.pos.x - x, center.pos.y) < radius + R;
        })
      )
        continue;
      return spot;
    }
    return null;
  }

  concede(player: PlayerIndex): MatchSnapshot {
    if (this.state.phase === "gameOver") return this.snapshot();
    if (player < 0 || player >= this.state.playerCount)
      throw new Error("玩家编号无效");
    this.state.eliminated[player] = true;
    const remaining = Array.from(
      { length: this.state.playerCount },
      (_, index) => index,
    ).filter((index) => !this.state.eliminated[index]);
    if (remaining.length <= 1) {
      this.finish(
        remaining[0] ?? this.nextActivePlayer(player),
        this.state.playerCount >= 3 ? "其他玩家已退出" : "对手认输",
        [],
      );
    } else {
      if (this.state.currentPlayer === player)
        this.state.currentPlayer = this.nextActivePlayer(player);
      this.state.currentBreak = 0;
      this.state.phase = "aiming";
      this.state.canRepositionCue = true;
      this.state.lastMessage = `${this.state.players[player] ?? `玩家 ${player + 1}`} 已退出，继续对局`;
    }
    return this.snapshot();
  }

  legalTargetBallIds(): number[] {
    if (this.state.phase === "gameOver") return [];
    if (this.state.gameType === "nineball") {
      const command = this.state.cards?.active.find(
        (effect) =>
          effect.kind === "commandBall" &&
          effect.owner === this.state.currentPlayer,
      );
      if (command) return [Math.round(command.value)];
      const lowest = this.table.balls
        .filter((ball) => ball.id !== 0 && ball.onTable())
        .sort((a, b) => (a.label ?? 99) - (b.label ?? 99))[0];
      return lowest ? [lowest.id] : [];
    }
    if (this.state.gameType === "eightball") {
      const group = this.state.groups[this.state.currentPlayer];
      const candidates = this.table.balls.filter(
        (ball) => ball.id !== 0 && ball.onTable(),
      );
      if (group === "open")
        return candidates.filter((b) => b.label !== 8).map((b) => b.id);
      const own = candidates.filter((ball) => this.inGroup(ball, group));
      return (own.length ? own : candidates.filter((b) => b.label === 8)).map(
        (b) => b.id,
      );
    }
    if (this.state.target.freeBall && this.state.target.nominatedBall) {
      return [this.state.target.nominatedBall];
    }
    if (this.state.target.targetIsRed) {
      return this.table.balls
        .filter((b) => b.id >= 7 && b.onTable())
        .map((b) => b.id);
    }
    if (this.state.target.previousPotRed) {
      return this.table.balls
        .filter((b) => b.id >= 1 && b.id <= 6 && b.onTable())
        .map((b) => b.id);
    }
    const next = this.state.target.nextColour;
    return this.table.balls[next]?.onTable() ? [next] : [];
  }

  private configure(gameType = this.state?.gameType) {
    applyMatchTable(gameType);
  }

  private serialiseBalls(): BallSnapshot[] {
    return this.table.balls.map((ball) => ({
      id: ball.id,
      label: ball.label ?? null,
      pos: vectorData(ball.pos),
      vel: vectorData(ball.vel),
      rvel: vectorData(ball.rvel),
      state: ball.state,
    }));
  }

  private settleSlowBalls() {
    for (const ball of this.table.balls) stopSlowBall(ball);
  }

  private captureFrame(frames?: ShotFrame[]) {
    if (!frames) return;
    const last = frames[frames.length - 1];
    if (last && Math.abs(last.time - this.table.time) < 0.01) return;
    frames.push({
      time: this.table.time,
      balls: this.table.balls.map((ball) => ({
        id: ball.id,
        pos: vectorData(ball.pos),
        state: ball.state,
      })),
    });
  }

  private applyRules(
    outcomes: Outcome[],
    isBreak: boolean,
    modifiers: ShotModifiers,
  ): RuleEvent[] {
    if (this.state.gameType === "eightball") {
      return this.applyEightBall(outcomes, isBreak);
    }
    if (this.state.gameType === "nineball") {
      return this.applyNineBall(outcomes, isBreak, modifiers);
    }
    return this.applySnooker(outcomes, modifiers);
  }

  private applyEightBall(outcomes: Outcome[], isBreak: boolean): RuleEvent[] {
    const events: RuleEvent[] = [];
    const player = this.state.currentPlayer;
    const opponent = this.nextActivePlayer(player);
    const pots = Outcome.pots(outcomes);
    const objectPots = pots.filter((ball) => ball.id !== 0 && ball.label !== 8);
    const eightPotted = pots.some((ball) => ball.label === 8);
    const group = this.state.groups[player];
    const first = this.firstCueCollision(outcomes);
    let foul = this.commonFoul(outcomes, first);
    const ownBefore = this.table.balls.filter(
      (ball) =>
        (ball.onTable() || pots.includes(ball)) && this.inGroup(ball, group),
    );

    if (!foul && first) {
      if (group === "open" && first.label === 8) foul = "开放球局不能先碰黑八";
      if (group !== "open") {
        if (ownBefore.length > 0 && !this.inGroup(first, group)) {
          foul = "首碰球不属于你的球组";
        } else if (ownBefore.length === 0 && first.label !== 8) {
          foul = "你的球组已清完，必须先碰黑八";
        }
      }
    }
    if (!foul && isBreak && pots.length === 0) {
      const objectCushions = new Set(
        outcomes
          .filter((o) => o.type === OutcomeType.Cushion && o.ballA?.id !== 0)
          .map((o) => o.ballA!.id),
      );
      if (objectCushions.size < 4) foul = "开球未落袋时至少四颗目标球需碰库";
    }

    if (isBreak && eightPotted && !foul) {
      const eight = this.table.balls.find((ball) => ball.label === 8)!;
      this.respotBehind(eight);
      events.push({ type: "respot", ballIds: [eight.id] });
      this.state.phase = "aiming";
      this.addScore(player, objectPots.length, objectPots.length);
      this.state.lastMessage = "开球黑八落袋，已重摆黑八";
      events.push({ type: "info", message: this.state.lastMessage });
      return events;
    }

    const ownRemaining = this.table.balls.some(
      (ball) => ball.onTable() && this.inGroup(ball, group),
    );
    if (eightPotted) {
      const legalWin = !foul && group !== "open" && !ownRemaining;
      if (!legalWin && this.consumeEffect(player, "secondLife")) {
        const eight = this.table.balls.find((ball) => ball.label === 8)!;
        this.cardEvents.push({
          type: "secondLife",
          player,
          ballId: eight.id,
        });
        this.respotBehind(eight);
        events.push({ type: "respot", ballIds: [eight.id] });
        events.push({ type: "info", message: "续命生效：黑八已重摆" });
        this.state.lastMessage = "续命生效：黑八已重摆，交换击球权";
        this.switchPlayer(events);
        if (Outcome.isCueBallPotted(this.table.cueball, outcomes))
          this.giveBallInHand(events);
        else this.state.phase = "aiming";
        return events;
      }
      return this.finish(
        legalWin ? player : opponent,
        legalWin ? "合法打进黑八" : "提前或犯规打进黑八",
        events,
      );
    }

    if (foul) {
      const shielded = this.consumeEffect(player, "shield");
      if (shielded) this.cardEvents.push({ type: "shieldUsed", player });
      const whitePotted = Outcome.isCueBallPotted(this.table.cueball, outcomes);
      events.push({ type: "foul", player, reason: foul, penalty: 0 });
      this.state.lastMessage = shielded
        ? `犯规：${foul}（护盾抵消）`
        : `犯规：${foul}`;
      this.switchPlayer(events);
      if (shielded) {
        if (whitePotted) this.placeCueAtBreak();
        this.state.phase = "aiming";
      } else {
        this.giveBallInHand(events);
      }
      return events;
    }

    if (group === "open" && !isBreak && objectPots.length > 0) {
      const solids = objectPots.some(
        (ball) => ball.label! >= 1 && ball.label! <= 7,
      );
      const stripes = objectPots.some(
        (ball) => ball.label! >= 9 && ball.label! <= 15,
      );
      if (solids !== stripes) {
        this.state.groups[player] = solids ? "solids" : "stripes";
        this.state.groups[opponent] = solids ? "stripes" : "solids";
        events.push({ type: "groups", groups: [...this.state.groups] });
      }
    }

    if (objectPots.length > 0) {
      this.addScore(player, objectPots.length, objectPots.length);
      events.push({
        type: "score",
        player,
        score: this.state.scores[player],
        currentBreak: this.state.currentBreak,
      });
    }
    const ownPotted = objectPots.some((ball) => this.inGroup(ball, group));
    if (objectPots.length > 0 && (group === "open" || ownPotted)) {
      this.state.phase = "aiming";
      this.state.lastMessage = "合法落袋，继续击球";
    } else {
      this.state.lastMessage = isBreak
        ? "开球有效，交换击球权"
        : "交换击球权";
      this.switchPlayer(events);
      this.state.phase = "aiming";
    }
    return events;
  }

  private applyNineBall(
    outcomes: Outcome[],
    isBreak: boolean,
    modifiers: ShotModifiers = shotModifiers(
      this.state.cards,
      this.state.currentPlayer,
    ),
  ): RuleEvent[] {
    const events: RuleEvent[] = [];
    const player = this.state.currentPlayer;
    const pots = Outcome.pots(outcomes);
    const first = this.firstCueCollision(outcomes);
    let foul = this.commonFoul(outcomes, first);
    const lowestBefore = this.table.balls
      .filter(
        (ball) => ball.id !== 0 && (ball.onTable() || pots.includes(ball)),
      )
      .sort((a, b) => (a.label ?? 99) - (b.label ?? 99))[0];
    const requiredFirst = modifiers.commandBallId ?? lowestBefore?.id ?? null;
    if (!foul && first && requiredFirst !== null && first.id !== requiredFirst) {
      foul =
        modifiers.commandBallId !== null
          ? "本杆必须先碰号令指定的球"
          : "必须先碰台面最低号球";
    }
    if (!foul && isBreak && pots.length === 0) {
      const objectCushions = new Set(
        outcomes
          .filter((o) => o.type === OutcomeType.Cushion && o.ballA?.id !== 0)
          .map((o) => o.ballA!.id),
      );
      if (objectCushions.size < 4) foul = "开球未落袋时至少四颗目标球需碰库";
    }
    const nine = this.table.balls.find((ball) => ball.label === 9)!;
    const ninePotted = pots.includes(nine);
    if (foul) {
      const shielded = this.consumeEffect(player, "shield");
      if (shielded) this.cardEvents.push({ type: "shieldUsed", player });
      const whitePotted = Outcome.isCueBallPotted(this.table.cueball, outcomes);
      if (ninePotted) {
        this.respotBehind(nine);
        events.push({ type: "respot", ballIds: [nine.id] });
      }
      events.push({ type: "foul", player, reason: foul, penalty: 0 });
      this.state.lastMessage = shielded
        ? `犯规：${foul}（护盾抵消）`
        : `犯规：${foul}`;
      this.switchPlayer(events);
      if (shielded) {
        if (whitePotted) this.placeCueAtBreak();
        this.state.phase = "aiming";
      } else {
        this.giveBallInHand(events);
      }
      return events;
    }
    const pottedCount = pots.filter((ball) => ball.id !== 0).length;
    if (ninePotted) {
      const points = pottedCount + modifiers.bonusPerPot * pottedCount;
      this.addScore(player, points, pottedCount);
      return this.finish(player, "合法打进九号球", events);
    }
    if (pottedCount > 0) {
      const points = pottedCount + modifiers.bonusPerPot * pottedCount;
      this.addScore(player, points, pottedCount);
      this.state.phase = "aiming";
      this.state.lastMessage = "合法落袋，继续击球";
      events.push({
        type: "score",
        player,
        score: this.state.scores[player],
        currentBreak: this.state.currentBreak,
      });
    } else {
      this.state.lastMessage = isBreak
        ? "开球有效，交换击球权"
        : "交换击球权";
      this.switchPlayer(events);
      this.state.phase = "aiming";
    }
    return events;
  }

  private applySnooker(
    outcomes: Outcome[],
    modifiers: ShotModifiers = shotModifiers(
      this.state.cards,
      this.state.currentPlayer,
    ),
  ): RuleEvent[] {
    const events: RuleEvent[] = [];
    const player = this.state.currentPlayer;
    const opponent = this.nextActivePlayer(player);
    const targetBefore = { ...this.state.target };
    const pots = Outcome.pots(outcomes);
    const objectPots = pots.filter((ball) => ball.id !== 0);
    const first = this.firstCueCollision(outcomes);
    const firstId = first?.id ?? -1;
    const nextColour = targetBefore.nextColour;
    const nominated = targetBefore.freeBall ? targetBefore.nominatedBall : null;
    let legalFirst: boolean;
    if (nominated) legalFirst = firstId === nominated;
    else if (targetBefore.targetIsRed) legalFirst = firstId >= 7;
    else if (targetBefore.previousPotRed)
      legalFirst = firstId >= 1 && firstId <= 6;
    else legalFirst = firstId === nextColour;

    const whitePotted = Outcome.isCueBallPotted(this.table.cueball, outcomes);
    let foul = whitePotted
      ? "母球落袋"
      : !first
        ? "未碰到目标球"
        : !legalFirst
          ? "首碰球错误"
          : null;
    let legalPot = false;
    let points = 0;
    let respotIds: number[] = [];

    if (!foul && nominated) {
      if (objectPots.length === 0) {
        legalPot = false;
      } else if (objectPots.length === 1 && objectPots[0].id === nominated) {
        legalPot = true;
        points = targetBefore.targetIsRed ? 1 : nextColour + 1;
        respotIds = [nominated];
      } else {
        foul = "自由球击球出现额外落袋";
      }
    } else if (!foul && targetBefore.targetIsRed) {
      if (objectPots.length > 0 && objectPots.every((ball) => ball.id >= 7)) {
        legalPot = true;
        points = objectPots.length;
      } else if (objectPots.length > 0) {
        foul = "红球回合打进了彩球";
      }
    } else if (!foul && targetBefore.previousPotRed) {
      if (
        objectPots.length === 1 &&
        objectPots[0].id === firstId &&
        firstId >= 1 &&
        firstId <= 6
      ) {
        legalPot = true;
        points = firstId + 1;
        respotIds = [firstId];
      } else if (objectPots.length > 0) {
        foul = "红球后的彩球落袋无效";
      }
    } else if (!foul) {
      if (objectPots.length === 1 && objectPots[0].id === nextColour) {
        legalPot = true;
        points = nextColour + 1;
      } else if (objectPots.length > 0) {
        foul = "未按黄绿棕蓝粉黑顺序清彩";
      }
    }

    if (foul) {
      if (targetBefore.respottedBlack) {
        this.state.lastMessage = `重摆黑球阶段犯规：${foul}`;
        events.push({ type: "foul", player, reason: foul, penalty: 7 });
        return this.finish(opponent, "重摆黑球阶段犯规，本局结束", events);
      }
      const shielded = this.consumeEffect(player, "shield");
      if (shielded) this.cardEvents.push({ type: "shieldUsed", player });
      const penalty = Math.max(
        4,
        targetBefore.targetIsRed
          ? 4
          : targetBefore.previousPotRed
            ? 4
            : nextColour + 1,
        firstId >= 1 && firstId <= 6 ? firstId + 1 : 4,
        ...objectPots.map((ball) =>
          ball.id >= 1 && ball.id <= 6 ? ball.id + 1 : 4,
        ),
      );
      respotIds = objectPots
        .filter((ball) => ball.id >= 1 && ball.id <= 6)
        .map((ball) => ball.id);
      this.respotBalls(respotIds);
      if (respotIds.length) events.push({ type: "respot", ballIds: respotIds });
      if (!shielded) this.state.scores[opponent] += penalty;
      this.state.currentBreak = 0;
      this.state.lastMessage = shielded
        ? `犯规：${foul}（护盾抵消）`
        : this.state.practice
          ? `犯规：${foul}`
          : `犯规：${foul}，罚 ${penalty} 分`;
      events.push({
        type: "foul",
        player,
        reason: foul,
        penalty: shielded ? 0 : penalty,
      });
      this.switchPlayer(events);
      this.state.target.freeBall = !shielded && this.isSnookered();
      this.state.target.nominatedBall = null;
      if (this.state.target.freeBall) {
        events.push({ type: "freeBall", player: this.state.currentPlayer });
        this.state.lastMessage += this.state.practice
          ? "；可提名自由球"
          : "；对手被斯诺克，可提名自由球";
      }
      if (whitePotted) this.giveBallInHand(events);
      else this.state.phase = "aiming";
      events.push({
        type: "score",
        player: opponent,
        score: this.state.scores[opponent],
        currentBreak: 0,
      });
      return events;
    }

    this.state.target.freeBall = false;
    this.state.target.nominatedBall = null;
    if (legalPot) {
      this.respotBalls(respotIds);
      if (respotIds.length) events.push({ type: "respot", ballIds: respotIds });
      const scored =
        Math.round(points * modifiers.scoreMultiplier) +
        modifiers.bonusPerPot * objectPots.length;
      this.addScore(player, scored, objectPots.length);
      events.push({
        type: "score",
        player,
        score: this.state.scores[player],
        currentBreak: this.state.currentBreak,
      });
      const finalBlack =
        !targetBefore.targetIsRed &&
        !targetBefore.previousPotRed &&
        nextColour === 6;
      if (nominated) {
        this.state.target.freeBall = false;
        this.state.target.nominatedBall = null;
        if (targetBefore.targetIsRed) {
          this.state.target.targetIsRed = false;
          this.state.target.previousPotRed = true;
        } else if (targetBefore.previousPotRed) {
          this.state.target.previousPotRed = false;
          this.state.target.targetIsRed = this.redsRemaining() > 0;
          if (!this.state.target.targetIsRed)
            this.state.target.nextColour = 1;
        } else {
          this.state.target.targetIsRed = false;
          this.state.target.previousPotRed = false;
          this.state.target.nextColour = Math.min(
            7,
            targetBefore.nextColour + 1,
          );
        }
      } else if (targetBefore.targetIsRed) {
        this.state.target.targetIsRed = false;
        this.state.target.previousPotRed = true;
      } else if (targetBefore.previousPotRed) {
        this.state.target.previousPotRed = false;
        this.state.target.targetIsRed = this.redsRemaining() > 0;
        if (!this.state.target.targetIsRed)
          this.state.target.nextColour = 1;
      } else {
        this.state.target.targetIsRed = false;
        this.state.target.previousPotRed = false;
        this.state.target.nextColour = Math.min(
          7,
          targetBefore.nextColour + 1,
        );
      }

      if (finalBlack) {
        if (targetBefore.respottedBlack) {
          this.state.target.respottedBlack = false;
          return this.finish(player, "重摆黑球落袋，本局结束", events);
        }
        if (this.state.playerCount >= 3)
          return this.finishByRanking("黑球落袋，本局结束", events);
        const highest = this.state.scores.reduce(
          (best, score, index) =>
            score > this.state.scores[best] ? index : best,
          0,
        );
        const tied = this.state.scores.every(
          (score) => score === this.state.scores[0],
        );
        if (tied) {
          this.respotBalls([6]);
          this.state.target.respottedBlack = true;
          this.state.target.targetIsRed = false;
          this.state.target.previousPotRed = false;
          this.state.target.nextColour = 6;
          this.state.lastMessage = "比分相同，重摆黑球决胜";
          events.push({ type: "respot", ballIds: [6] });
          events.push({ type: "info", message: this.state.lastMessage });
          this.switchPlayer(events);
          this.giveBallInHand(events);
          return events;
        }
        return this.finish(highest, "黑球落袋，本局结束", events);
      }
      this.state.phase = "aiming";
      this.state.lastMessage = `得分 +${points}，继续击球`;
      return events;
    }

    this.switchPlayer(events);
    this.state.phase = "aiming";
    this.state.lastMessage = "未得分，交换击球权";
    return events;
  }

  private commonFoul(
    outcomes: Outcome[],
    first: Ball | undefined,
  ): string | null {
    if (Outcome.isCueBallPotted(this.table.cueball, outcomes))
      return "母球落袋";
    if (!first) return "母球未碰到目标球";
    if (Outcome.potCount(outcomes) === 0) {
      const collision = outcomes.find(
        (o) =>
          o.type === OutcomeType.Collision &&
          (o.ballA === this.table.cueball || o.ballB === this.table.cueball),
      );
      const collisionIndex = collision ? outcomes.indexOf(collision) : -1;
      const cushionAfter = outcomes
        .slice(collisionIndex + 1)
        .some((o) => o.type === OutcomeType.Cushion);
      if (!cushionAfter) return "碰球后无球落袋或碰库";
    }
    return null;
  }

  private firstCueCollision(outcomes: Outcome[]): Ball | undefined {
    Outcome.cueBallFirst(this.table.cueball, outcomes);
    const collision = outcomes.find(
      (outcome) =>
        outcome.type === OutcomeType.Collision &&
        outcome.ballA === this.table.cueball,
    );
    return collision?.ballB ?? undefined;
  }

  private inGroup(ball: Ball, group: BallGroup): boolean {
    if (group === "solids")
      return (ball.label ?? 0) >= 1 && (ball.label ?? 0) <= 7;
    if (group === "stripes")
      return (ball.label ?? 0) >= 9 && (ball.label ?? 0) <= 15;
    return false;
  }

  private nextActivePlayer(from: PlayerIndex): PlayerIndex {
    for (let step = 1; step <= this.state.playerCount; step += 1) {
      const candidate = (from + step) % this.state.playerCount;
      if (!this.state.eliminated[candidate]) return candidate;
    }
    return from;
  }

  private switchPlayer(events: RuleEvent[]) {
    const ending = this.state.currentPlayer;
    this.state.currentPlayer = this.state.practice
      ? 0
      : this.nextActivePlayer(ending);
    this.state.currentBreak = 0;
    expireCardEffects(this.state.cards, "afterTurn", ending);
    if (this.state.cards) this.state.cards.playedThisTurn = false;
    if (this.state.gameType === "snooker") {
      this.state.target.targetIsRed = this.redsRemaining() > 0;
      this.state.target.previousPotRed = false;
      this.state.target.freeBall = false;
      this.state.target.nominatedBall = null;
    }
    events.push({ type: "turn", player: this.state.currentPlayer });
  }

  private placeCueAtBreak() {
    const cueball = this.table.cueball;
    cueball.vel.set(0, 0, 0);
    cueball.rvel.set(0, 0, 0);
    cueball.pos.copy(Rack.spot);
    cueball.pos.z = 0;
    cueball.state = State.Stationary;
  }

  private addScore(player: PlayerIndex, points: number, potted: number) {
    this.state.scores[player] += points;
    this.state.currentBreak += points;
    this.state.bestBreak[player] = Math.max(
      this.state.bestBreak[player] ?? 0,
      this.state.currentBreak,
    );
    this.state.pots[player] = (this.state.pots[player] ?? 0) + potted;
  }

  private consumeEffect(
    player: PlayerIndex,
    kind: CardEffectKind,
  ): boolean {
    const cards = this.state.cards;
    if (!cards?.enabled) return false;
    const index = cards.active.findIndex(
      (effect) =>
        effect.kind === kind &&
        effect.owner === player &&
        effectApplies(effect, player),
    );
    if (index < 0) return false;
    cards.active.splice(index, 1);
    return true;
  }

  private sameResult(a: PlayerIndex, b: PlayerIndex): boolean {
    return (
      this.state.scores[a] === this.state.scores[b] &&
      (this.state.bestBreak[a] ?? 0) === (this.state.bestBreak[b] ?? 0) &&
      (this.state.pots[a] ?? 0) === (this.state.pots[b] ?? 0)
    );
  }

  private rankPlayers(): PlayerIndex[] {
    const active = Array.from(
      { length: this.state.playerCount },
      (_, index) => index,
    ).filter((index) => !this.state.eliminated[index]);
    const eliminated = Array.from(
      { length: this.state.playerCount },
      (_, index) => index,
    ).filter((index) => this.state.eliminated[index]);
    return [...active, ...eliminated].sort(
      (a, b) =>
        Number(this.state.eliminated[a]) - Number(this.state.eliminated[b]) ||
        this.state.scores[b] - this.state.scores[a] ||
        (this.state.bestBreak[b] ?? 0) - (this.state.bestBreak[a] ?? 0) ||
        (this.state.pots[b] ?? 0) - (this.state.pots[a] ?? 0) ||
        a - b,
    );
  }

  private finishByRanking(reason: string, events: RuleEvent[]): RuleEvent[] {
    const ranking = this.rankPlayers();
    const active = ranking.filter((index) => !this.state.eliminated[index]);
    const top = active[0];
    const tied =
      top !== undefined &&
      active.length > 1 &&
      this.sameResult(top, active[1]);
    const winner = top === undefined ? null : tied ? null : top;
    this.state.winner = winner;
    this.state.ranking = ranking;
    this.state.endReason = tied ? `${reason}（并列第一）` : reason;
    this.state.lastMessage = this.state.endReason;
    this.state.phase = "gameOver";
    this.state.canRepositionCue = false;
    events.push({
      type: "gameOver",
      winner,
      reason: this.state.endReason,
    });
    return events;
  }

  private giveBallInHand(events: RuleEvent[]) {
    const cueball = this.table.cueball;
    cueball.vel.set(0, 0, 0);
    cueball.rvel.set(0, 0, 0);
    cueball.state = State.Stationary;
    if (this.state.gameType === "snooker")
      cueball.pos.copy(Respot.snookerD(this.table));
    else if (!cueball.onTable() || cueball.pos.z < 0)
      cueball.pos.copy(Rack.spot);
    cueball.pos.z = 0;
    cueball.state = State.Stationary;
    this.state.phase = "ballInHand";
    this.state.canRepositionCue = true;
    events.push({ type: "ballInHand", player: this.state.currentPlayer });
  }

  private finish(
    winner: PlayerIndex,
    reason: string,
    events: RuleEvent[],
  ): RuleEvent[] {
    this.state.winner = winner;
    this.state.endReason = reason;
    this.state.lastMessage = reason;
    this.state.phase = "gameOver";
    this.state.canRepositionCue = false;
    this.state.ranking = [
      winner,
      ...this.rankPlayers().filter((index) => index !== winner),
    ];
    events.push({ type: "gameOver", winner, reason });
    return events;
  }

  private respotBehind(ball: Ball) {
    Respot.respotBehind(
      new Vector3(TableGeometry.tableX / 2, 0, 0),
      ball,
      this.table,
    );
    ball.vel.set(0, 0, 0);
    ball.rvel.set(0, 0, 0);
    ball.pos.z = 0;
    ball.state = State.Stationary;
  }

  private respotBalls(ids: number[]) {
    ids.forEach((id) => {
      const ball = this.table.balls[id];
      if (!ball) return;
      Respot.respot(ball, this.table);
      ball.vel.set(0, 0, 0);
      ball.rvel.set(0, 0, 0);
      ball.pos.z = 0;
      ball.state = State.Stationary;
    });
  }

  private redsRemaining(): number {
    return this.table.balls.filter((ball) => ball.id >= 7 && ball.onTable())
      .length;
  }

  private isSnookered(): boolean {
    const targetIds = this.legalTargetBallIds();
    if (targetIds.length === 0 || !this.table.cueball.onTable()) return false;
    return targetIds.every((id) => {
      const target = this.table.balls[id];
      const direction = target.pos.clone().sub(this.table.cueball.pos).setZ(0);
      if (direction.lengthSq() === 0) return true;
      const side = new Vector3(-direction.y, direction.x, 0)
        .normalize()
        .multiplyScalar(R * 1.02);
      const left = this.pathClear(
        this.table.cueball.pos,
        target.pos.clone().add(side),
        target.id,
      );
      const right = this.pathClear(
        this.table.cueball.pos,
        target.pos.clone().sub(side),
        target.id,
      );
      return !left && !right;
    });
  }

  private pathClear(from: Vector3, to: Vector3, targetId: number): boolean {
    const segment = to.clone().sub(from);
    const lengthSq = segment.lengthSq();
    return this.table.balls.every((ball) => {
      if (ball.id === 0 || ball.id === targetId || !ball.onTable()) return true;
      const relative = ball.pos.clone().sub(from);
      const t = Math.max(0, Math.min(1, relative.dot(segment) / lengthSq));
      const nearest = from.clone().addScaledVector(segment, t);
      return nearest.distanceTo(ball.pos) >= 2 * R;
    });
  }

  private isCueBallPositionLegal(target: Vector3): boolean {
    if (
      Math.abs(target.x) > TableGeometry.tableX - R ||
      Math.abs(target.y) > TableGeometry.tableY - R
    )
      return false;
    if (this.state.gameType === "snooker") {
      const centre = new Vector3(Rack.baulk, 0, 0);
      if (target.x > Rack.baulk || target.distanceTo(centre) > Rack.sixth)
        return false;
    }
    return !this.table.balls.some(
      (ball) =>
        ball !== this.table.cueball &&
        ball.onTable() &&
        ball.pos.distanceTo(target) < 2 * R,
    );
  }

  private colourName(id: number): string {
    return (
      ["", "黄球", "绿球", "棕球", "蓝球", "粉球", "黑球"][id] ?? `球 ${id}`
    );
  }
}
