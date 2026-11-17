export interface Point2 {
  x: number;
  y: number;
}

export interface PredictionBall {
  id: number;
  pos: [number, number, number];
  state: string;
}

export interface FirstBallPrediction {
  ballId: number;
  contact: Point2;
  normal: Point2;
  tangent: Point2 | null;
}

export function maxPredictionLength(outerHalfWidth: number): number {
  return (2 * outerHalfWidth) / 3;
}

export function predictionLengthForLevel(
  level: number,
  outerHalfWidth: number,
): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const steps = Math.min(5, Math.floor(level));
  return (maxPredictionLength(outerHalfWidth) * steps) / 5;
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
    normal,
    tangent:
      tangentLength < 1e-6
        ? null
        : { x: tangent.x / tangentLength, y: tangent.y / tangentLength },
  };
}

export function predictionSegments(
  prediction: FirstBallPrediction,
  length: number,
): { normal: [Point2, Point2]; tangent: [Point2, Point2] | null } {
  return {
    normal: [
      prediction.contact,
      {
        x: prediction.contact.x + prediction.normal.x * length,
        y: prediction.contact.y + prediction.normal.y * length,
      },
    ],
    tangent: prediction.tangent
      ? [
          prediction.contact,
          {
            x: prediction.contact.x + prediction.tangent.x * length,
            y: prediction.contact.y + prediction.tangent.y * length,
          },
        ]
      : null,
  };
}
