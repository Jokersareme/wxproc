import { MatchEngine } from "./engine";
import { Outcome } from "../../../third_party/billiards/src/model/outcome";
import { Ball, State } from "../../../third_party/billiards/src/model/ball";

function pot(engine: MatchEngine, ball: Ball): Outcome[] {
  ball.state = State.InPocket;
  return [
    Outcome.collision(engine.table.cueball, ball, 1, 0),
    Outcome.pot(ball, 1, 1),
  ];
}

function clearGroup(engine: MatchEngine, minimum: number, maximum: number) {
  engine.table.balls.forEach((ball) => {
    if ((ball.label ?? 0) >= minimum && (ball.label ?? 0) <= maximum) {
      ball.state = State.InPocket;
    }
  });
}

describe("rule boundaries", () => {
  it("wins eight-ball after clearing the assigned group", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    engine.state.groups = ["solids", "stripes"];
    clearGroup(engine, 1, 7);
    (engine as any).applyEightBall(pot(engine, engine.table.balls[8]), false);
    expect(engine.state.winner).toBe(0);
    expect(engine.state.phase).toBe("gameOver");
  });

  it("loses when black eight is potted before the group is clear", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    engine.state.groups = ["solids", "stripes"];
    (engine as any).applyEightBall(pot(engine, engine.table.balls[8]), false);
    expect(engine.state.winner).toBe(1);
  });

  it("respots nine after a foul instead of awarding a win", () => {
    const engine = new MatchEngine({ gameType: "nineball" });
    const nine = engine.table.balls[9];
    const outcomes = pot(engine, nine);
    outcomes.push(Outcome.pot(engine.table.cueball, 1, 2));
    (engine as any).applyNineBall(outcomes, false);
    expect(engine.state.phase).toBe("ballInHand");
    expect(engine.state.winner).toBeNull();
    expect(nine.onTable()).toBe(true);
  });

  it("respots the colour after a red and preserves the break", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    engine.state.target.targetIsRed = false;
    engine.state.target.previousPotRed = true;
    const blue = engine.table.balls[4];
    (engine as any).applySnooker(pot(engine, blue));
    expect(engine.state.scores[0]).toBe(5);
    expect(engine.state.currentBreak).toBe(5);
    expect(blue.onTable()).toBe(true);
    expect(engine.state.target.targetIsRed).toBe(true);
  });

  it("ends a snooker frame on the final black and compares scores", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    engine.state.target.targetIsRed = false;
    engine.state.target.previousPotRed = false;
    engine.state.scores = [10, 5];
    engine.table.balls.forEach((ball) => {
      if (ball.id !== 0 && ball.id !== 6) ball.state = State.InPocket;
    });
    (engine as any).applySnooker(pot(engine, engine.table.balls[6]));
    expect(engine.state.scores[0]).toBe(17);
    expect(engine.state.winner).toBe(0);
    expect(engine.state.phase).toBe("gameOver");
  });

  it("allows a nominated colour only while a snooker free ball is active", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    expect(() => engine.nominateFreeBall(4)).toThrow();
    engine.state.target.freeBall = true;
    engine.nominateFreeBall(4);
    expect(engine.state.target.nominatedBall).toBe(4);
    expect(engine.legalTargetBallIds()).toEqual([4]);
  });

  it("accepts a legal cue-ball placement and resumes aiming", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    engine.state.phase = "ballInHand";
    engine.placeCueBall(-0.5, 0);
    expect(engine.state.phase).toBe("aiming");
    expect(engine.table.cueball.pos.x).toBe(-0.5);
  });
});
