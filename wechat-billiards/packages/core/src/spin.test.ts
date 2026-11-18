import { MatchEngine } from "./engine";
import { State } from "../../../third_party/billiards/src/model/ball";
import type { MatchSnapshot } from "./types";

function ball(snapshot: MatchSnapshot, id: number) {
  const found = snapshot.balls.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ball ${id}`);
  return found;
}

function twoBallTable() {
  const engine = new MatchEngine({ gameType: "eightball", practice: true });
  for (const candidate of engine.table.balls) {
    if (candidate.id !== 0 && candidate.id !== 1) {
      candidate.state = State.InPocket;
      candidate.pos.set(0, 0, -1);
    }
  }
  engine.table.cueball.pos.set(-0.4, 0, 0);
  engine.table.cueball.vel.set(0, 0, 0);
  engine.table.cueball.rvel.set(0, 0, 0);
  const object = engine.table.balls.find((candidate) => candidate.id === 1);
  if (!object) throw new Error("missing object ball");
  object.pos.set(0, 0, 0);
  engine.state.shotNumber = 1;
  return engine;
}

function cushionTable() {
  const engine = new MatchEngine({ gameType: "eightball", practice: true });
  for (const candidate of engine.table.balls) {
    if (candidate.id !== 0) {
      candidate.state = State.InPocket;
      candidate.pos.set(0, 0, -1);
    }
  }
  engine.table.cueball.pos.set(-0.9, 0, 0);
  engine.table.cueball.vel.set(0, 0, 0);
  engine.table.cueball.rvel.set(0, 0, 0);
  engine.state.shotNumber = 1;
  return engine;
}

describe("cue offset direction", () => {
  it("follows through with a positive vertical offset and draws with a negative one", () => {
    const shoot = (spinY: number) =>
      ball(
        twoBallTable().shoot(
          { angle: 0, power: 0.35, spinX: 0, spinY, elevation: 0 },
          0,
        ).snapshot,
        0,
      ).pos[0];

    const follow = shoot(0.45);
    const stun = shoot(0);
    const draw = shoot(-0.45);
    expect(follow).toBeGreaterThan(stun);
    expect(stun).toBeGreaterThan(draw);
    expect(draw).toBeLessThan(0);
  });

  it("sends a cue ball rebounding right with a negative lateral offset", () => {
    const rebound = (spinX: number) =>
      ball(
        cushionTable().shoot(
          { angle: 0, power: 0.6, spinX, spinY: 0, elevation: 0 },
          0,
        ).snapshot,
        0,
      ).pos[1];

    expect(rebound(-0.3)).toBeLessThan(-0.1);
    expect(rebound(0.3)).toBeGreaterThan(0.1);
    expect(Math.abs(rebound(0))).toBeLessThan(0.05);
  });
});
