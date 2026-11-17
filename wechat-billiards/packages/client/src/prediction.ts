import { Vector3 } from "three";
import { PHYSICS_STEP, tunedMaxPower } from "@friend-billiards/core";
import { Ball, State } from "../../../third_party/billiards/src/model/ball";
import { Collision } from "../../../third_party/billiards/src/model/physics/collision";
import { cueStrike } from "../../../third_party/billiards/src/model/physics/physics";

export interface Point2 {
  x: number;
  y: number;
}

export interface PredictionBall {
  id: number;
  pos: [number, number, number];
  state: string;
}

export interface PredictionStroke {
  power: number;
  spinX: number;
  spinY: number;
}

export interface FirstBallPrediction {
  ballId: number;
  contact: Point2;
  cueStart: Point2;
  objectCenter: Point2;
  incoming: Point2;
  normal: Point2;
  tangent: Point2 | null;
}

export function maxPredictionLength(outerHalfWidth: number): number {
  return (2 * outerHalfWidth) / 3;
}

export function predictionLengthForLevel(
  level: number,
  outerHalfWidth: number,
  power = 1,
): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const steps = Math.min(5, Math.floor(level));
  const strength = Number.isFinite(power)
    ? Math.max(0, Math.min(1, power))
    : 1;
  return (
    (maxPredictionLength(outerHalfWidth) * steps * (0.35 + 0.65 * strength)) / 5
  );
}

/**
 * Geometric first-ball prediction. The cue ball is treated as a point travelling
 * along `direction`; contact happens when its centre is two radii away from the
 * object ball centre. No cushions, spin or later balls are simulated.
 */
export function predictFirstBall(
  cue: Point2,
  direction: Point2,
  balls: PredictionBall[],
  radius: number,
  length: number,
): FirstBallPrediction | null {
  if (length <= 0) return null;
  const directionLength = Math.hypot(direction.x, direction.y);
  if (directionLength < 1e-9) return null;
  const unit = { x: direction.x / directionLength, y: direction.y / directionLength };
  const collisionDistance = radius * 2;
  let first: PredictionBall | null = null;
  let firstTravel = Infinity;
  for (const ball of balls) {
    if (ball.id === 0 || ball.state === "InPocket") continue;
    const relative = { x: ball.pos[0] - cue.x, y: ball.pos[1] - cue.y };
    const projection = relative.x * unit.x + relative.y * unit.y;
    if (projection <= 0) continue;
    const perpendicular = Math.abs(relative.x * unit.y - relative.y * unit.x);
    if (perpendicular > collisionDistance + 1e-9) continue;
    const offset = Math.sqrt(
      Math.max(0, collisionDistance ** 2 - perpendicular ** 2),
    );
    const travel = projection - offset;
    if (travel < 0) continue;
    if (travel < firstTravel) {
      firstTravel = travel;
      first = ball;
    }
  }
  if (!first) return null;
  const contact = {
    x: cue.x + unit.x * firstTravel,
    y: cue.y + unit.y * firstTravel,
  };
  const normalLength = Math.hypot(
    first.pos[0] - contact.x,
    first.pos[1] - contact.y,
  );
  if (normalLength < 1e-9) return null;
  const normal = {
    x: (first.pos[0] - contact.x) / normalLength,
    y: (first.pos[1] - contact.y) / normalLength,
  };
  const dot = unit.x * normal.x + unit.y * normal.y;
  const tangent = { x: unit.x - normal.x * dot, y: unit.y - normal.y * dot };
  const tangentLength = Math.hypot(tangent.x, tangent.y);
  return {
    ballId: first.id,
    contact,
    cueStart: { x: cue.x, y: cue.y },
    objectCenter: { x: first.pos[0], y: first.pos[1] },
    incoming: unit,
    normal,
    tangent:
      tangentLength < 1e-6
        ? null
        : { x: tangent.x / tangentLength, y: tangent.y / tangentLength },
  };
}

function physicalCuePath(
  prediction: FirstBallPrediction,
  length: number,
  stroke: PredictionStroke,
): Point2[] | null {
  const strike = cueStrike(
    Math.atan2(prediction.incoming.y, prediction.incoming.x),
    stroke.power * tunedMaxPower(),
    new Vector3(-stroke.spinX, -stroke.spinY, 0),
  );
  const cue = new Ball(
    new Vector3(prediction.cueStart.x, prediction.cueStart.y, 0),
  );
  const object = new Ball(
    new Vector3(prediction.objectCenter.x, prediction.objectCenter.y, 0),
  );
  cue.vel.copy(strike.vel);
  cue.rvel.copy(strike.rvel);
  cue.state = State.Sliding;

  let collided = false;
  let offset = { x: 0, y: 0 };
  let previous = prediction.contact;
  let travelled = 0;
  let postCollisionSteps = 0;
  const path: Point2[] = [];
  const maximumSteps = Math.ceil(45 / PHYSICS_STEP);
  for (let step = 0; step < maximumSteps; step += 1) {
    if (!collided && Collision.willCollide(cue, object, PHYSICS_STEP)) {
      Collision.collide(cue, object);
      collided = true;
      offset = {
        x: prediction.contact.x - cue.pos.x,
        y: prediction.contact.y - cue.pos.y,
      };
      path.push(prediction.contact);
      continue;
    }

    cue.update(PHYSICS_STEP);
    cue.fround();
    if (!collided) {
      if (!cue.inMotion()) return null;
      continue;
    }

    postCollisionSteps += 1;
    if (Math.hypot(cue.vel.x, cue.vel.y) < 0.008) return path;
    if (postCollisionSteps % 8 !== 0 && cue.inMotion()) continue;
    const current = {
      x: cue.pos.x + offset.x,
      y: cue.pos.y + offset.y,
    };
    const segment = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    if (segment > 1e-9) {
      if (travelled + segment >= length) {
        const alpha = (length - travelled) / segment;
        path.push({
          x: previous.x + (current.x - previous.x) * alpha,
          y: previous.y + (current.y - previous.y) * alpha,
        });
        return path;
      }
      path.push(current);
      travelled += segment;
      previous = current;
    }
    if (!cue.inMotion()) return path;
  }
  return path.length > 1 ? path : null;
}

export function predictionSegments(
  prediction: FirstBallPrediction,
  length: number,
  stroke?: PredictionStroke,
): { normal: [Point2, Point2]; tangent: Point2[] | null } {
  const impact = Math.max(
    0,
    Math.min(
      1,
      prediction.incoming.x * prediction.normal.x +
        prediction.incoming.y * prediction.normal.y,
    ),
  );
  const normalLength = length * (0.25 + 0.75 * impact);
  const cueLength = length * (1 - 0.5 * impact);
  const geometricPath = prediction.tangent
    ? [
        prediction.contact,
        {
          x: prediction.contact.x + prediction.tangent.x * cueLength,
          y: prediction.contact.y + prediction.tangent.y * cueLength,
        },
      ]
    : null;
  return {
    normal: [
      prediction.contact,
      {
        x: prediction.contact.x + prediction.normal.x * normalLength,
        y: prediction.contact.y + prediction.normal.y * normalLength,
      },
    ],
    tangent: stroke
      ? (physicalCuePath(prediction, cueLength, stroke) ?? geometricPath)
      : geometricPath,
  };
}
