import type { Ball } from "../../../third_party/billiards/src/model/ball";
import { R } from "../../../third_party/billiards/src/model/physics/constants";
import { TableGeometry } from "../../../third_party/billiards/src/view/tablegeometry";
import { Rack } from "../../../third_party/billiards/src/utils/rack";

const BALL_GAP = 0.0001;

// Standard eight-ball triangle: 8 in the middle of row three, solid and
// stripe in the two back-row corners.
const RACK_LAYOUT = [
  1,
  2, 3,
  10, 8, 11,
  4, 12, 13, 5,
  9, 6, 14, 15, 7,
] as const;

export function tightenEightBallRack(balls: Ball[]) {
  const cueball = balls.find((ball) => ball.id === 0);
  if (cueball) {
    cueball.pos.copy(Rack.spot);
    cueball.vel.set(0, 0, 0);
    cueball.rvel.set(0, 0, 0);
  }
  const objects = new Map<number | undefined, Ball>(
    balls
      .filter((ball) => ball.id !== 0 && ball.label !== undefined)
      .map((ball) => [ball.label, ball] as const),
  );
  const spacing = 2 * R + BALL_GAP;
  const rowStep = Math.sqrt(3) * (spacing / 2);
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let slot = 0; slot <= row; slot += 1) {
      const ball = objects.get(RACK_LAYOUT[index]);
      if (ball) {
        ball.pos.set(
          TableGeometry.X / 2 + row * rowStep,
          (slot - row / 2) * spacing,
          0,
        );
        ball.vel.set(0, 0, 0);
        ball.rvel.set(0, 0, 0);
      }
      index += 1;
    }
  }
}

const NINE_BALL_ROWS = [[1], [2, 3], [4, 9, 5], [6, 7], [8]] as const;

function placeCueBall(balls: Ball[]) {
  const cueball = balls.find((ball) => ball.id === 0);
  if (!cueball) return;
  cueball.pos.copy(Rack.spot);
  cueball.vel.set(0, 0, 0);
  cueball.rvel.set(0, 0, 0);
}

export function tightenNineBallRack(balls: Ball[]) {
  placeCueBall(balls);
  const spacing = 2 * R + BALL_GAP;
  const rowStep = Math.sqrt(3) * (spacing / 2);
  const objects = new Map<number | undefined, Ball>(
    balls
      .filter((ball) => ball.id !== 0 && ball.label !== undefined)
      .map((ball) => [ball.label, ball] as const),
  );
  NINE_BALL_ROWS.forEach((labels, row) => {
    labels.forEach((label, slot) => {
      const ball = objects.get(label);
      if (!ball) return;
      ball.pos.set(
        TableGeometry.tableX / 2 + row * rowStep,
        (slot - (labels.length - 1) / 2) * spacing,
        0,
      );
      ball.vel.set(0, 0, 0);
      ball.rvel.set(0, 0, 0);
    });
  });
}

export function tightenSnookerRack(balls: Ball[]) {
  const cueball = balls.find((ball) => ball.id === 0);
  if (cueball) {
    cueball.pos.set(Rack.baulk, -TableGeometry.tableY / 8, 0);
    cueball.vel.set(0, 0, 0);
    cueball.rvel.set(0, 0, 0);
  }

  const colours = Rack.snookerColourPositions();
  for (let index = 0; index < colours.length; index += 1) {
    const ball = balls[index + 1];
    if (!ball) continue;
    ball.pos.copy(colours[index]);
    ball.vel.set(0, 0, 0);
    ball.rvel.set(0, 0, 0);
  }

  const spacing = 2 * R + BALL_GAP;
  const rowStep = Math.sqrt(3) * (spacing / 2);
  const reds = balls.slice(1 + colours.length);
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let slot = 0; slot <= row; slot += 1) {
      const ball = reds[index];
      if (ball && ball.onTable()) {
        ball.pos.set(
          TableGeometry.X / 2 + spacing + row * rowStep,
          (slot - row / 2) * spacing,
          0,
        );
        ball.vel.set(0, 0, 0);
        ball.rvel.set(0, 0, 0);
      }
      index += 1;
    }
  }
}

