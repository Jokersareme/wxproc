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
import { cueStrike } from "../../../third_party/billiards/src/model/physics/physics";
import {
  offCenterLimit,
  R,
} from "../../../third_party/billiards/src/model/physics/constants";
import { hashSnapshot } from "./hash";
import { applyMatchTable, tunedMaxPower } from "./tuning";
import type {
  BallGroup,
  BallSnapshot,
  CreateMatchOptions,
  MatchSnapshot,
  PhysicsEvent,
  PlayerIndex,
  RuleEvent,
  ShotFrame,
  ShotInput,
  ShotResult,
  Vec3Data,
} from "./types";

const PHYSICS_STEP = 0.001953125;
const MAX_SHOT_SECONDS = 90;
const FRAME_INTERVAL = 8;

(globalThis as { __BILLIARDS_HEADLESS__?: boolean }).__BILLIARDS_HEADLESS__ =
  true;

function cloneSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MatchSnapshot;
}

export function validateShotInput(input: ShotInput): string | null {
  if (!input || !Number.isFinite(input.angle)) return "击球角度无效";
  if (!Number.isFinite(input.power) || input.power <= 0 || input.power > 1) {
    return "击球力度必须在 0 到 1 之间";
  }
  if (!Number.isFinite(input.spinX) || !Number.isFinite(input.spinY)) {
    return "杆法偏移无效";
  }
  if (Math.hypot(input.spinX, input.spinY) > offCenterLimit + 0.0001) {
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

function otherPlayer(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
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
      this.state = cloneSnapshot(options as MatchSnapshot);
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
    this.state = {
      version: 1,
      gameType,
      phase: "aiming",
      canRepositionCue: false,
      practice: options.practice ?? false,
      currentPlayer: 0,
      players: options.playerNames ?? ["玩家 1", "玩家 2"],
      groups: ["open", "open"],
      scores: [0, 0],
      currentBreak: 0,
      shotNumber: 0,
      target: {
        targetIsRed: true,
        previousPotRed: false,
        freeBall: false,
        nominatedBall: null,
        respottedBlack: false,
      },
      balls: [],
      winner: null,
      endReason: null,
      lastMessage: null,
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

  shoot(
    rawInput: ShotInput,
    player: PlayerIndex = this.state.currentPlayer,
    collectFrames = false,
  ): ShotResult {
    const invalid = validateShotInput(rawInput);
    if (invalid) throw new Error(invalid);
    if (this.state.phase !== "aiming") throw new Error("当前不能击球");
    if (player !== this.state.currentPlayer) throw new Error("还未轮到你");
    if (!this.table.cueball.onTable()) throw new Error("请先摆放母球");

    this.state.canRepositionCue = false;
    this.configure();
    const input = normaliseShot(rawInput);
    const isBreak = this.state.shotNumber === 0;
    const frames: ShotFrame[] | undefined = collectFrames ? [] : undefined;
    this.state.phase = "shooting";
    this.state.lastMessage = null;
    this.table.outcome = [];
    this.table.time = 0;
    const strike = cueStrike(
      input.angle,
      input.power * tunedMaxPower(),
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
      if (steps % FRAME_INTERVAL === 0) this.captureFrame(frames);
    }
    this.captureFrame(frames);

    const outcomes = this.table.outcome;
    const events: PhysicsEvent[] = outcomes.map((outcome) => ({
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
    const ruleEvents = this.applyRules(outcomes, isBreak);
    this.state.shotNumber += 1;
    this.state.balls = this.serialiseBalls();
    this.captureFrame(frames);
    const snapshot = this.snapshot();
    return {
      input,
      events,
      ruleEvents,
      snapshot,
      stateHash: hashSnapshot(snapshot),
      durationMs: this.table.time,
      ...(frames ? { frames } : {}),
    };
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
    this.state.target.nominatedBall = ballId;
    this.state.lastMessage = `已提名${this.colourName(ballId)}为自由球`;
    return this.snapshot();
  }

  concede(player: PlayerIndex): MatchSnapshot {
    if (this.state.phase === "gameOver") return this.snapshot();
    this.state.winner = otherPlayer(player);
    this.state.endReason = "对手认输";
    this.state.lastMessage = this.state.endReason;
    this.state.phase = "gameOver";
    return this.snapshot();
  }

  legalTargetBallIds(): number[] {
    if (this.state.phase === "gameOver") return [];
    if (this.state.gameType === "nineball") {
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
    const next = this.table.balls.find(
      (b) => b.id >= 1 && b.id <= 6 && b.onTable(),
    );
    return next ? [next.id] : [];
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

  private applyRules(outcomes: Outcome[], isBreak: boolean): RuleEvent[] {
    if (this.state.gameType === "eightball") {
      return this.applyEightBall(outcomes, isBreak);
    }
    if (this.state.gameType === "nineball") {
      return this.applyNineBall(outcomes, isBreak);
    }
    return this.applySnooker(outcomes);
  }

  private applyEightBall(outcomes: Outcome[], isBreak: boolean): RuleEvent[] {
    const events: RuleEvent[] = [];
    const player = this.state.currentPlayer;
    const opponent = otherPlayer(player);
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
      this.state.currentBreak += objectPots.length;
      this.state.lastMessage = "开球黑八落袋，已重摆黑八";
      events.push({ type: "info", message: this.state.lastMessage });
      return events;
    }

    const ownRemaining = this.table.balls.some(
      (ball) => ball.onTable() && this.inGroup(ball, group),
    );
    if (eightPotted) {
      const legalWin = !foul && group !== "open" && !ownRemaining;
      return this.finish(
        legalWin ? player : opponent,
        legalWin ? "合法打进黑八" : "提前或犯规打进黑八",
        events,
      );
    }

    if (foul) {
      events.push({ type: "foul", player, reason: foul, penalty: 0 });
      this.state.lastMessage = `犯规：${foul}`;
      this.switchPlayer(events);
      this.giveBallInHand(events);
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
      this.state.scores[player] += objectPots.length;
      this.state.currentBreak += objectPots.length;
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
      this.switchPlayer(events);
      this.state.phase = "aiming";
    }
    return events;
  }

  private applyNineBall(outcomes: Outcome[], isBreak: boolean): RuleEvent[] {
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
    if (!foul && first && lowestBefore && first !== lowestBefore) {
      foul = "必须先碰台面最低号球";
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
      if (ninePotted) {
        this.respotBehind(nine);
        events.push({ type: "respot", ballIds: [nine.id] });
      }
      events.push({ type: "foul", player, reason: foul, penalty: 0 });
      this.state.lastMessage = `犯规：${foul}`;
      this.switchPlayer(events);
      this.giveBallInHand(events);
      return events;
    }
    if (ninePotted) {
      this.state.scores[player] += pots.filter((b) => b.id !== 0).length;
      return this.finish(player, "合法打进九号球", events);
    }
    const objectPots = pots.filter((ball) => ball.id !== 0).length;
    if (objectPots > 0) {
      this.state.scores[player] += objectPots;
      this.state.currentBreak += objectPots;
      this.state.phase = "aiming";
      this.state.lastMessage = "合法落袋，继续击球";
      events.push({
        type: "score",
        player,
        score: this.state.scores[player],
        currentBreak: this.state.currentBreak,
      });
    } else {
      this.switchPlayer(events);
      this.state.phase = "aiming";
    }
    return events;
  }

  private applySnooker(outcomes: Outcome[]): RuleEvent[] {
    const events: RuleEvent[] = [];
    const player = this.state.currentPlayer;
    const targetBefore = { ...this.state.target };
    const pots = Outcome.pots(outcomes);
    const objectPots = pots.filter((ball) => ball.id !== 0);
    const first = this.firstCueCollision(outcomes);
    const firstId = first?.id ?? -1;
    const coloursBefore = this.table.balls.filter(
      (ball) =>
        ball.id >= 1 && ball.id <= 6 && (ball.onTable() || pots.includes(ball)),
    );
    const nextColour = coloursBefore.sort((a, b) => a.id - b.id)[0]?.id ?? 6;
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
        points = targetBefore.targetIsRed
          ? 1
          : targetBefore.previousPotRed
            ? nominated
            : nextColour + 1;
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
      this.state.scores[otherPlayer(player)] += penalty;
      this.state.currentBreak = 0;
      this.state.lastMessage = `犯规：${foul}，罚 ${penalty} 分`;
      events.push({ type: "foul", player, reason: foul, penalty });
      this.switchPlayer(events);
      this.state.target.freeBall = this.isSnookered();
      this.state.target.nominatedBall = null;
      if (this.state.target.freeBall) {
        events.push({ type: "freeBall", player: this.state.currentPlayer });
        this.state.lastMessage += "；对手被斯诺克，可提名自由球";
      }
      if (whitePotted) this.giveBallInHand(events);
      else this.state.phase = "aiming";
      events.push({
        type: "score",
        player: otherPlayer(player),
        score: this.state.scores[otherPlayer(player)],
        currentBreak: 0,
      });
      return events;
    }

    this.state.target.freeBall = false;
    this.state.target.nominatedBall = null;
    if (legalPot) {
      this.respotBalls(respotIds);
      if (respotIds.length) events.push({ type: "respot", ballIds: respotIds });
      this.state.scores[player] += points;
      this.state.currentBreak += points;
      events.push({
        type: "score",
        player,
        score: this.state.scores[player],
        currentBreak: this.state.currentBreak,
      });
      if (nominated) {
        this.state.target = {
          ...targetBefore,
          freeBall: false,
          nominatedBall: null,
        };
      } else if (targetBefore.targetIsRed) {
        this.state.target.targetIsRed = false;
        this.state.target.previousPotRed = true;
      } else if (targetBefore.previousPotRed) {
        this.state.target.previousPotRed = false;
        this.state.target.targetIsRed = this.redsRemaining() > 0;
      } else {
        this.state.target.targetIsRed = false;
        this.state.target.previousPotRed = false;
      }

      const finalBlack =
        !targetBefore.targetIsRed &&
        !targetBefore.previousPotRed &&
        !nominated &&
        nextColour === 6;
      if (finalBlack) {
        if (this.state.scores[0] === this.state.scores[1]) {
          this.respotBalls([6]);
          this.state.target.respottedBlack = true;
          this.state.lastMessage = "比分相同，重摆黑球决胜";
          events.push({ type: "respot", ballIds: [6] });
          events.push({ type: "info", message: this.state.lastMessage });
          this.switchPlayer(events);
          this.giveBallInHand(events);
          return events;
        }
        const winner: PlayerIndex =
          this.state.scores[0] > this.state.scores[1] ? 0 : 1;
        return this.finish(winner, "黑球落袋，本局结束", events);
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

  private switchPlayer(events: RuleEvent[]) {
    this.state.currentPlayer = this.state.practice
      ? 0
      : otherPlayer(this.state.currentPlayer);
    this.state.currentBreak = 0;
    if (this.state.gameType === "snooker") {
      this.state.target.targetIsRed = this.redsRemaining() > 0;
      this.state.target.previousPotRed = false;
      this.state.target.freeBall = false;
      this.state.target.nominatedBall = null;
    }
    events.push({ type: "turn", player: this.state.currentPlayer });
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
    return !this.table.overlapsAny(target, this.table.cueball);
  }

  private colourName(id: number): string {
    return (
      ["", "黄球", "绿球", "棕球", "蓝球", "粉球", "黑球"][id] ?? `球 ${id}`
    );
  }
}
