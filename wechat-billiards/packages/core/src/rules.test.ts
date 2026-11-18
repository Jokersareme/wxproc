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
    engine.state.target.nextColour = 6;
    engine.state.scores = [10, 5];
    engine.table.balls.forEach((ball) => {
      if (ball.id !== 0 && ball.id !== 6) ball.state = State.InPocket;
    });
    (engine as any).applySnooker(pot(engine, engine.table.balls[6]));
    expect(engine.state.scores[0]).toBe(17);
    expect(engine.state.winner).toBe(0);
    expect(engine.state.phase).toBe("gameOver");
  });

  it("scores one and moves to a colour after a red-phase free ball", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    engine.state.target.freeBall = true;
    engine.state.target.nominatedBall = 4;
    const blue = engine.table.balls[4];
    (engine as any).applySnooker(pot(engine, blue));
    expect(engine.state.scores[0]).toBe(1);
    expect(engine.state.target.targetIsRed).toBe(false);
    expect(engine.state.target.previousPotRed).toBe(true);
    expect(engine.state.target.freeBall).toBe(false);
    expect(engine.state.target.nominatedBall).toBeNull();
    expect(blue.onTable()).toBe(true);
  });

  it("scores the on-colour value and returns to reds after a colour-phase free ball", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    engine.state.target.targetIsRed = false;
    engine.state.target.previousPotRed = true;
    engine.state.target.nextColour = 4;
    engine.state.target.freeBall = true;
    engine.state.target.nominatedBall = 2;
    const yellow = engine.table.balls[2];
    (engine as any).applySnooker(pot(engine, yellow));
    expect(engine.state.scores[0]).toBe(5);
    expect(engine.state.target.previousPotRed).toBe(false);
    expect(engine.state.target.targetIsRed).toBe(true);
    expect(yellow.onTable()).toBe(true);
  });

  it("advances the colour sequence after a free ball with no reds left", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    engine.table.balls.forEach((ball) => {
      if (ball.id >= 7) ball.state = State.InPocket;
    });
    engine.state.target.targetIsRed = false;
    engine.state.target.previousPotRed = false;
    engine.state.target.nextColour = 1;
    engine.state.target.freeBall = true;
    engine.state.target.nominatedBall = 4;
    const blue = engine.table.balls[4];
    (engine as any).applySnooker(pot(engine, blue));
    expect(engine.state.scores[0]).toBe(2);
    expect(engine.state.target.targetIsRed).toBe(false);
    expect(engine.state.target.previousPotRed).toBe(false);
    expect(engine.state.target.nextColour).toBe(2);
    expect(blue.onTable()).toBe(true);
  });

  it("loses the frame on a foul during the respotted black", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    engine.state.target.targetIsRed = false;
    engine.state.target.previousPotRed = false;
    engine.state.target.nextColour = 6;
    engine.state.target.respottedBlack = true;
    const yellow = engine.table.balls[1];
    (engine as any).applySnooker([
      Outcome.collision(engine.table.cueball, yellow, 1, 0),
    ]);
    expect(engine.state.phase).toBe("gameOver");
    expect(engine.state.winner).toBe(1);
    expect(engine.state.endReason).toContain("重摆黑球");
  });

  it("rejects nominating the colour that is currently on", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    engine.state.target.targetIsRed = false;
    engine.state.target.previousPotRed = false;
    engine.state.target.freeBall = true;
    engine.state.target.nextColour = 4;
    expect(() => engine.nominateFreeBall(4)).toThrow("当前目标球");
    expect(() => engine.nominateFreeBall(2)).not.toThrow();
  });

  it("allows a nominated colour only while a snooker free ball is active", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    expect(() => engine.nominateFreeBall(4)).toThrow();
    engine.state.target.freeBall = true;
    engine.nominateFreeBall(4);
    expect(engine.state.target.nominatedBall).toBe(4);
    expect(engine.legalTargetBallIds()).toEqual([4]);
  });

  it("accepts repeated cue-ball placement during ball in hand and after restore", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    engine.state.phase = "ballInHand";
    engine.state.canRepositionCue = true;
    const placed = engine.placeCueBall(-0.5, 0);
    expect(placed.phase).toBe("aiming");
    expect(placed.canRepositionCue).toBe(true);
    expect(placed.lastMessage).toContain("任意球");

    const restored = MatchEngine.restore(placed);
    const repositioned = restored.placeCueBall(-0.55, 0.05);
    expect(repositioned.canRepositionCue).toBe(true);
    expect(restored.table.cueball.pos.x).toBeCloseTo(-0.55, 6);
    expect(restored.table.cueball.pos.y).toBeCloseTo(0.05, 6);
    expect(() => restored.placeCueBall(20, 20)).toThrow("超出允许区域");
    expect(restored.state.canRepositionCue).toBe(true);

    restored.state.shotNumber = 1;
    restored.placeCueBall(0.6, 0);
    const shot = restored.shoot({
      angle: 0,
      power: 1,
      spinX: 0,
      spinY: 0,
      elevation: 0,
    });
    expect(shot.snapshot.canRepositionCue).toBe(false);
    expect(() => restored.placeCueBall(-0.4, 0)).toThrow("当前没有自由球");
  });

  it("allows cue-ball repositioning before the opening shot", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    expect(engine.state.canRepositionCue).toBe(true);
    expect(() => engine.placeCueBall(-0.5, 0)).not.toThrow();
  });

  it("restores ball in hand from a legacy snapshot", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    const legacy = engine.snapshot() as any;
    legacy.phase = "ballInHand";
    delete legacy.canRepositionCue;
    expect(MatchEngine.restore(legacy).state.canRepositionCue).toBe(true);
  });
});
