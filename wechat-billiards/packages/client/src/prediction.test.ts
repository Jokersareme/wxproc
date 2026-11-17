import {
  maxPredictionLength,
  predictFirstBall,
  predictionLengthForLevel,
  predictionSegments,
  type PredictionBall,
} from "./prediction";

(globalThis as { __BILLIARDS_HEADLESS__?: boolean }).__BILLIARDS_HEADLESS__ =
  true;

const radius = 0.03275;
const collisionDistance = radius * 2;

function ball(id: number, x: number, y: number): PredictionBall {
  return { id, pos: [x, y, 0], state: "Stationary" };
}

describe("prediction geometry", () => {
  it("selects the first ball along the aim direction", () => {
    const prediction = predictFirstBall(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      [ball(3, 1, 0), ball(2, 0.5, 0), ball(4, -0.4, 0)],
      radius,
      1,
    );
    expect(prediction?.ballId).toBe(2);
    expect(prediction?.contact.x).toBeCloseTo(0.5 - collisionDistance, 10);
    expect(prediction?.contact.y).toBeCloseTo(0, 10);
  });

  it("treats a straight shot as pure normal travel without a tangent", () => {
    const prediction = predictFirstBall(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      [ball(1, 1, 0)],
      radius,
      1,
    );
    expect(prediction).not.toBeNull();
    expect(prediction?.contact.x).toBeCloseTo(1 - collisionDistance, 10);
    expect(prediction?.contact.y).toBeCloseTo(0, 10);
    expect(prediction?.normal.x).toBeCloseTo(1, 10);
    expect(prediction?.normal.y).toBeCloseTo(0, 10);
    expect(prediction?.tangent).toBeNull();
  });

  it("computes the oblique contact, normal and tangent independently", () => {
    const target = { x: 1, y: 0.03 };
    const perpendicular = target.y;
    const offset = Math.sqrt(collisionDistance ** 2 - perpendicular ** 2);
    const travel = target.x - offset;
    const expectedContact = { x: travel, y: 0 };
    const normalDx = target.x - expectedContact.x;
    const normalDy = target.y - expectedContact.y;
    const normalLength = Math.hypot(normalDx, normalDy);
    const expectedNormal = {
      x: normalDx / normalLength,
      y: normalDy / normalLength,
    };

    const prediction = predictFirstBall(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      [ball(1, target.x, target.y)],
      radius,
      1,
    )!;
    expect(prediction).not.toBeNull();
    expect(prediction.contact.x).toBeCloseTo(expectedContact.x, 10);
    expect(prediction.contact.y).toBeCloseTo(expectedContact.y, 10);
    expect(prediction.normal.x).toBeCloseTo(expectedNormal.x, 10);
    expect(prediction.normal.y).toBeCloseTo(expectedNormal.y, 10);

    const centreDistance = Math.hypot(
      target.x - prediction.contact.x,
      target.y - prediction.contact.y,
    );
    expect(centreDistance).toBeCloseTo(collisionDistance, 10);
    expect(normalLength).toBeCloseTo(collisionDistance, 10);

    expect(prediction.tangent).not.toBeNull();
    expect(
      prediction.normal.x ** 2 + prediction.normal.y ** 2,
    ).toBeCloseTo(1, 10);
    expect(
      prediction.tangent!.x ** 2 + prediction.tangent!.y ** 2,
    ).toBeCloseTo(1, 10);
    const dot =
      prediction.normal.x * prediction.tangent!.x +
      prediction.normal.y * prediction.tangent!.y;
    expect(dot).toBeCloseTo(0, 10);
    expect(prediction.tangent!.y).toBeLessThan(0);

    const segments = predictionSegments(prediction, 1);
    expect(segments.normal[1].x).toBeCloseTo(
      prediction.contact.x +
        prediction.normal.x *
          (0.25 +
            0.75 *
              (prediction.incoming.x * prediction.normal.x +
                prediction.incoming.y * prediction.normal.y)),
      10,
    );
    expect(segments.tangent).not.toBeNull();
  });

  it("simulates rolling before contact and the physical cue trajectory", () => {
    const prediction = predictFirstBall(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      [ball(1, 1, 0.03)],
      radius,
      1,
    )!;
    const segments = predictionSegments(prediction, 1, {
      power: 0.5,
      spinX: 0,
      spinY: 0,
    });
    expect(segments.tangent).not.toBeNull();
    const points = segments.tangent!;
    expect(points.length).toBeGreaterThan(2);
    const last = points.at(-1)!;
    const direction = {
      x: last.x - prediction.contact.x,
      y: last.y - prediction.contact.y,
    };
    const magnitude = Math.hypot(direction.x, direction.y);
    expect(magnitude).toBeGreaterThan(0);
    const forward =
      (direction.x * prediction.normal.x +
        direction.y * prediction.normal.y) /
      magnitude;
    expect(forward).toBeGreaterThan(0);
    expect(segments.normal[1].x).toBeCloseTo(
      prediction.contact.x +
        prediction.normal.x *
          (0.25 +
            0.75 *
              (prediction.incoming.x * prediction.normal.x +
                prediction.incoming.y * prediction.normal.y)),
      10,
    );
  });

  it("ignores overlapping balls, pocketed balls and misses", () => {
    expect(
      predictFirstBall(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        [ball(1, radius, 0)],
        radius,
        1,
      ),
    ).toBeNull();
    expect(
      predictFirstBall(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        [{ ...ball(1, 1, 0), state: "InPocket" }],
        radius,
        1,
      ),
    ).toBeNull();
    expect(
      predictFirstBall(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        [ball(1, 1, 0.5)],
        radius,
        1,
      ),
    ).toBeNull();
  });

  it("maps levels 0-5 to off plus fifth steps of a third of the table", () => {
    const outerHalfWidth = 1.5;
    const maximum = maxPredictionLength(outerHalfWidth);
    expect(maximum).toBeCloseTo(1, 10);
    expect(predictionLengthForLevel(0, outerHalfWidth)).toBe(0);
    for (let level = 1; level <= 5; level += 1)
      expect(predictionLengthForLevel(level, outerHalfWidth)).toBeCloseTo(
        (maximum * level) / 5,
        10,
      );
  });

  it("keeps low-power lines visible and increases their length with power", () => {
    const low = predictionLengthForLevel(1, 1.5, 0.03);
    const high = predictionLengthForLevel(1, 1.5, 1);
    expect(low).toBeCloseTo((1 / 5) * (0.35 + 0.65 * 0.03), 10);
    expect(high).toBeGreaterThan(low);
  });
});
