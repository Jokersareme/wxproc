import { MatchEngine } from "./engine";
import { R } from "../../../third_party/billiards/src/model/physics/constants";
import { TableGeometry } from "../../../third_party/billiards/src/view/tablegeometry";
import { Rack } from "../../../third_party/billiards/src/utils/rack";

const spacing = 2 * R + 0.0001;
const rowStep = (Math.sqrt(3) * spacing) / 2;

describe("rack tightening", () => {
  it("places the nine-ball diamond on a tight lattice with nine in the middle", () => {
    const engine = new MatchEngine({ gameType: "nineball", practice: true });
    const cue = engine.table.cueball;
    expect(cue.pos.x).toBeCloseTo(Rack.spot.x, 10);
    expect(cue.pos.y).toBeCloseTo(0, 10);

    const one = engine.table.balls.find((ball) => ball.label === 1)!;
    expect(one.pos.x).toBeCloseTo(TableGeometry.tableX / 2, 10);
    expect(one.pos.y).toBeCloseTo(0, 10);

    const nine = engine.table.balls.find((ball) => ball.label === 9)!;
    expect(nine.pos.x).toBeCloseTo(TableGeometry.tableX / 2 + 2 * rowStep, 10);
    expect(nine.pos.y).toBeCloseTo(0, 10);

    const two = engine.table.balls.find((ball) => ball.label === 2)!;
    const three = engine.table.balls.find((ball) => ball.label === 3)!;
    expect(
      Math.hypot(two.pos.x - three.pos.x, two.pos.y - three.pos.y),
    ).toBeCloseTo(spacing, 10);
  });

  it("places snooker colours on their spots and reds in a tight triangle", () => {
    const engine = new MatchEngine({ gameType: "snooker", practice: true });
    const balls = engine.table.balls;
    const cue = balls[0];
    expect(cue.pos.x).toBeCloseTo(Rack.baulk, 10);
    expect(cue.pos.y).toBeCloseTo(-TableGeometry.tableY / 8, 10);

    const colors = Rack.snookerColourPositions();
    colors.forEach((spot, index) => {
      expect(balls[index + 1].pos.x).toBeCloseTo(spot.x, 10);
      expect(balls[index + 1].pos.y).toBeCloseTo(spot.y, 10);
    });

    const reds = balls.slice(7);
    expect(reds).toHaveLength(15);
    expect(reds.every((ball) => ball.onTable())).toBe(true);
    expect(reds[0].pos.x).toBeCloseTo(TableGeometry.X / 2 + spacing, 10);
    expect(reds[0].pos.y).toBeCloseTo(0, 10);
    expect(reds[1].pos.x).toBeCloseTo(
      TableGeometry.X / 2 + spacing + rowStep,
      10,
    );
    expect(
      Math.hypot(reds[1].pos.x - reds[2].pos.x, reds[1].pos.y - reds[2].pos.y),
    ).toBeCloseTo(spacing, 10);
  });
});
