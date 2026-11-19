import { Vector3 } from "three";
import { Ball, State } from "../../../third_party/billiards/src/model/ball";
import { Table } from "../../../third_party/billiards/src/model/table";
import { OutcomeType } from "../../../third_party/billiards/src/model/outcome";
import { R } from "../../../third_party/billiards/src/model/physics/constants";
import { Knuckle } from "../../../third_party/billiards/src/model/physics/knuckle";
import { cueStrike } from "../../../third_party/billiards/src/model/physics/physics";
import { PocketGeometry } from "../../../third_party/billiards/src/view/pocketgeometry";
import { MatchEngine, PHYSICS_STEP } from "./engine";
import { applyMatchTable, tunedMaxPower } from "./tuning";
import type { GameType } from "./types";

export const PHYSICS_TARGETS = Object.freeze({
  fullPathMin: 5.5,
  fullPathMax: 7.0,
  fullStopMin: 6.5,
  fullStopMax: 8.5,
  lightPathMin: 0.3,
  lightPathMax: 0.6,
  cushionRatioMin: 0.7,
  cushionRatioMax: 0.76,
});

const FREE_START = { x: -0.6, y: 0.3 };
const FREE_MAX_SECONDS = 120;

export interface FreeShotMetric {
  power: number;
  initialSpeed: number;
  path: number;
  durationMs: number;
  cushions: number;
  cushionRatio: number | null;
}

export interface BreakMetric {
  gameType: GameType;
  durationMs: number;
  potted: number;
  message: string | null;
}

export interface PhysicsBenchmark {
  freeShots: FreeShotMetric[];
  cushionRatio: number | null;
  knuckleRatio: number;
  breaks: BreakMetric[];
}

export function runKnuckleBounce(): number {
  applyMatchTable("eightball", 10);
  const knuckle = PocketGeometry.pockets.pocketS.knuckleSE as Knuckle;
  const ball = new Ball(
    knuckle.pos.clone().add(new Vector3(0, -(R + knuckle.radius), 0)),
  );
  ball.vel.set(0, 1, 0);
  const incidentSpeed = ball.vel.length();
  knuckle.bounce(ball);
  return ball.vel.length() / incidentSpeed;
}

export function runFreeShot(power: number): FreeShotMetric {
  applyMatchTable("eightball", 10);
  const ball = new Ball(new Vector3(FREE_START.x, FREE_START.y, 0));
  const table = new Table([ball]);
  const strike = cueStrike(0, power * tunedMaxPower(), new Vector3(0, 0, 0), 0);
  ball.state = State.Sliding;
  ball.vel.copy(strike.vel);
  ball.rvel.copy(strike.rvel);

  let path = 0;
  let cushions = 0;
  let cushionRatio: number | null = null;
  let steps = 0;
  const maxSteps = Math.ceil(FREE_MAX_SECONDS / PHYSICS_STEP);
  const previous = new Vector3();

  while (!table.allStationary() && steps < maxSteps) {
    previous.copy(ball.pos);
    const speedBefore = ball.vel.length();
    table.advance(PHYSICS_STEP);
    path += ball.pos.distanceTo(previous);
    const hitCushion = table.outcome.some(
      (outcome) => outcome.type === OutcomeType.Cushion,
    );
    if (hitCushion) {
      cushions += 1;
      if (cushionRatio === null && speedBefore > 0) {
        cushionRatio = ball.vel.length() / speedBefore;
      }
    }
    table.outcome.length = 0;
    steps += 1;
  }

  return {
    power,
    initialSpeed: strike.vel.length(),
    path,
    durationMs: table.time,
    cushions,
    cushionRatio,
  };
}

export function runBreak(gameType: GameType): BreakMetric {
  const engine = new MatchEngine({
    gameType,
    playerNames: ["你", "好友"],
    practice: true,
  });
  const result = engine.shoot({
    angle: 0,
    power: 1,
    spinX: 0,
    spinY: 0,
    elevation: 0,
  });
  return {
    gameType,
    durationMs: result.durationMs,
    potted: result.events.filter((event) => event.type === "pot").length,
    message: result.snapshot.lastMessage,
  };
}

export function runPhysicsBenchmark(): PhysicsBenchmark {
  const freeShots = [1, 0.5, 0.2, 0.1].map((power) => runFreeShot(power));
  return {
    freeShots,
    cushionRatio: freeShots[0].cushionRatio,
    knuckleRatio: runKnuckleBounce(),
    breaks: (["eightball", "nineball", "snooker"] as const).map((gameType) =>
      runBreak(gameType),
    ),
  };
}

export function validatePhysicsBenchmark(
  benchmark: PhysicsBenchmark,
): string[] {
  const failures: string[] = [];
  const full = benchmark.freeShots.find((shot) => shot.power === 1);
  const light = benchmark.freeShots.find((shot) => shot.power === 0.1);
  if (!full || !light) return ["基准数据缺少满力或 10% 力度样本"];

  if (full.path < PHYSICS_TARGETS.fullPathMin || full.path > PHYSICS_TARGETS.fullPathMax) {
    failures.push(
      `满力行程 ${full.path.toFixed(2)}m 不在 ${PHYSICS_TARGETS.fullPathMin}–${PHYSICS_TARGETS.fullPathMax}m`,
    );
  }
  const fullSeconds = full.durationMs / 1000;
  if (
    fullSeconds < PHYSICS_TARGETS.fullStopMin ||
    fullSeconds > PHYSICS_TARGETS.fullStopMax
  ) {
    failures.push(
      `满力停表 ${fullSeconds.toFixed(2)}s 不在 ${PHYSICS_TARGETS.fullStopMin}–${PHYSICS_TARGETS.fullStopMax}s`,
    );
  }
  if (light.path < PHYSICS_TARGETS.lightPathMin || light.path > PHYSICS_TARGETS.lightPathMax) {
    failures.push(
      `10% 力度行程 ${light.path.toFixed(2)}m 不在 ${PHYSICS_TARGETS.lightPathMin}–${PHYSICS_TARGETS.lightPathMax}m`,
    );
  }
  if (
    benchmark.cushionRatio === null ||
    benchmark.cushionRatio < PHYSICS_TARGETS.cushionRatioMin ||
    benchmark.cushionRatio > PHYSICS_TARGETS.cushionRatioMax
  ) {
    failures.push(
      `撞库出/入比 ${benchmark.cushionRatio === null ? "未测到" : benchmark.cushionRatio.toFixed(3)} 不在 ${PHYSICS_TARGETS.cushionRatioMin}–${PHYSICS_TARGETS.cushionRatioMax}`,
    );
  }
  if (
    benchmark.knuckleRatio < PHYSICS_TARGETS.cushionRatioMin ||
    benchmark.knuckleRatio > PHYSICS_TARGETS.cushionRatioMax
  ) {
    failures.push(
      `袋角正碰出/入比 ${benchmark.knuckleRatio.toFixed(3)} 不在 ${PHYSICS_TARGETS.cushionRatioMin}–${PHYSICS_TARGETS.cushionRatioMax}`,
    );
  }
  return failures;
}
