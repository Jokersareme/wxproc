import { Vector3 } from "three";
import {
  cueBallPlacementLegal,
  MatchEngine,
  nearestLegalCueBallPosition,
  stopSlowBall,
  validateShotInput,
} from "./engine";
import { Outcome } from "../../../third_party/billiards/src/model/outcome";
import { Ball, State } from "../../../third_party/billiards/src/model/ball";
import { Rack } from "../../../third_party/billiards/src/utils/rack";
import {
  e as hanRestitution,
  ee,
  maxPower,
  mu,
  muS,
} from "../../../third_party/billiards/src/model/physics/constants";
import { GAME_PHYSICS, STOP_SPEED, tunedMaxPower } from "./tuning";
import { ShotInput } from "./types";

const straightShot: ShotInput = {
  angle: 0,
  power: 0.55,
  spinX: 0,
  spinY: 0,
  elevation: 0,
};

function pocketOtherBalls(engine: MatchEngine, keep: number[]) {
  engine.table.balls.forEach((ball) => {
    if (ball.id !== 0 && !keep.includes(ball.id)) {
      ball.state = State.InPocket;
      ball.pos.set(0, 0, -1);
    }
  });
}

describe("MatchEngine", () => {
  it.each([
    ["eightball", 16],
    ["nineball", 10],
    ["snooker", 22],
  ] as const)("creates a %s rack", (gameType, count) => {
    const engine = new MatchEngine({ gameType, practice: true });
    expect(engine.table.balls).toHaveLength(count);
    expect(engine.snapshot().phase).toBe("aiming");
  });

  it("scatters at least four object balls on a full-power eight-ball break", () => {
    const engine = new MatchEngine({ gameType: "eightball", practice: true });
    const result = engine.shoot({ ...straightShot, power: 1 }, 0);
    const objectCushions = new Set(
      result.events
        .filter((event) => event.type === "cushion" && event.ballA !== 0)
        .map((event) => event.ballA),
    );
    expect(objectCushions.size).toBeGreaterThanOrEqual(4);
    expect(result.ruleEvents.some((event) => event.type === "foul")).toBe(false);
  });

  it.each(["eightball", "nineball", "snooker"] as const)(
    "applies the shared physics tuning for %s before and after a shot",
    (gameType) => {
      const engine = new MatchEngine({ gameType, practice: true });
      expect(mu).toBe(GAME_PHYSICS.rollingFriction);
      expect(muS).toBe(GAME_PHYSICS.slidingFriction);
      expect(ee).toBe(GAME_PHYSICS.cushionRestitution);
      expect(hanRestitution).toBe(GAME_PHYSICS.cushionRestitution);
      expect(tunedMaxPower()).toBeCloseTo(maxPower * GAME_PHYSICS.powerScale, 10);
      engine.shoot({ ...straightShot, power: 0.1 }, 0);
      expect(mu).toBe(GAME_PHYSICS.rollingFriction);
      expect(muS).toBe(GAME_PHYSICS.slidingFriction);
      expect(ee).toBe(GAME_PHYSICS.cushionRestitution);
      expect(hanRestitution).toBe(GAME_PHYSICS.cushionRestitution);
    },
  );

  it("migrates a v1 snapshot into the v2 player arrays", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    const legacy = engine.snapshot() as any;
    legacy.version = 1;
    delete legacy.playerCount;
    delete legacy.eliminated;
    delete legacy.ranking;
    delete legacy.target.nextColour;
    const restored = MatchEngine.restore(legacy);
    expect(restored.state.version).toBe(2);
    expect(restored.state.playerCount).toBe(2);
    expect(restored.state.players).toHaveLength(2);
    expect(restored.state.groups).toHaveLength(2);
    expect(restored.state.scores).toHaveLength(2);
    expect(restored.state.eliminated).toEqual([false, false]);
    expect(restored.state.ranking).toEqual([]);
    expect(restored.state.target.nextColour).toBeGreaterThanOrEqual(1);
  });

  it("cycles through three players and skips eliminated seats", () => {
    const engine = new MatchEngine({
      gameType: "snooker",
      playerCount: 3,
      playerNames: ["甲", "乙", "丙"],
    });
    expect(engine.state.playerCount).toBe(3);
    const switchPlayer = (engine as any).switchPlayer.bind(engine);
    switchPlayer([]);
    expect(engine.state.currentPlayer).toBe(1);
    switchPlayer([]);
    expect(engine.state.currentPlayer).toBe(2);
    switchPlayer([]);
    expect(engine.state.currentPlayer).toBe(0);
    engine.state.eliminated[1] = true;
    switchPlayer([]);
    expect(engine.state.currentPlayer).toBe(2);
    switchPlayer([]);
    expect(engine.state.currentPlayer).toBe(0);
  });

  it("settles balls below the shared stop speed", () => {
    const slow = new Ball(new Vector3(0, 0, 0));
    slow.state = State.Rolling;
    slow.vel.set(STOP_SPEED - 0.001, 0, 0);
    slow.rvel.set(2, 0, 0);
    expect(stopSlowBall(slow)).toBe(true);
    expect(slow.state).toBe(State.Stationary);
    expect(slow.vel.length()).toBe(0);
    expect(slow.rvel.length()).toBe(0);

    const moving = new Ball(new Vector3(0, 0, 0));
    moving.state = State.Rolling;
    moving.vel.set(STOP_SPEED, 0, 0);
    expect(stopSlowBall(moving)).toBe(false);
    expect(moving.state).toBe(State.Rolling);
  });

  it("rejects invalid power and excessive spin", () => {
    expect(validateShotInput({ ...straightShot, power: 0 })).toBeTruthy();
    expect(
      validateShotInput({ ...straightShot, spinX: 0.4, spinY: 0.4 }),
    ).toBeTruthy();
    expect(
      validateShotInput({ ...straightShot, spinX: 0.2, spinY: 0.1 }),
    ).toBeNull();
  });

  it("reproduces an eight-ball shot and animation from the same snapshot", () => {
    const initial = new MatchEngine({ gameType: "eightball", practice: true });
    const snapshot = initial.snapshot();
    const a = MatchEngine.restore(snapshot).shoot(straightShot, 0, true);
    const b = MatchEngine.restore(snapshot).shoot(straightShot, 0, true);
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.events).toEqual(b.events);
    expect(a.frames!.length).toBeGreaterThan(10);
    expect(a.frames).toEqual(b.frames);
    expect(
      a.snapshot.balls.every((ball) => ball.vel.every((v) => v === 0)),
    ).toBe(true);
  });

  it("reproduces a legal snooker opening shot", () => {
    const initial = new MatchEngine({ gameType: "snooker", practice: true });
    const result = initial.shoot({ ...straightShot, power: 0.35 }, 0);
    expect(result.events.some((event) => event.type === "collision")).toBe(
      true,
    );
    expect(
      result.ruleEvents.every(
        (event) => event.type !== "foul" || event.penalty >= 4,
      ),
    ).toBe(true);
    expect(result.snapshot.shotNumber).toBe(1);
  });

  it("gives ball in hand after an eight-ball no-contact foul", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    const result = engine.shoot(
      { ...straightShot, angle: Math.PI, power: 0.2 },
      0,
    );
    expect(result.ruleEvents.some((event) => event.type === "foul")).toBe(true);
    expect(result.snapshot.phase).toBe("ballInHand");
    expect(result.snapshot.currentPlayer).toBe(1);
  });

  it("enforces the lowest ball first in nine-ball", () => {
    const engine = new MatchEngine({ gameType: "nineball" });
    pocketOtherBalls(engine, [1, 9]);
    const cue = engine.table.cueball;
    const one = engine.table.balls[1];
    const nine = engine.table.balls[9];
    cue.pos.set(0, 0, 0);
    nine.pos.set(0.3, 0, 0);
    one.pos.set(-0.5, 0, 0);
    const result = engine.shoot({ ...straightShot, power: 0.15 }, 0);
    expect(result.ruleEvents.some((event) => event.type === "foul")).toBe(true);
    expect(result.snapshot.phase).toBe("ballInHand");
  });

  it("assigns eight-ball groups after the break", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    const solid = engine.table.balls[1];
    solid.state = State.InPocket;
    const outcomes = [
      Outcome.collision(engine.table.cueball, solid, 1, 0),
      Outcome.pot(solid, 1, 1),
    ];
    const events = (engine as any).applyEightBall(outcomes, false);
    expect(engine.state.groups).toEqual(["solids", "stripes"]);
    expect(events.some((event: any) => event.type === "groups")).toBe(true);
  });

  it("announces a legal eight-ball break with no pot", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    const cue = engine.table.cueball;
    const objectBalls = engine.table.balls.filter((ball) => ball.id !== 0);
    const outcomes = [
      Outcome.collision(cue, objectBalls[0], 1, 0),
      ...objectBalls.slice(0, 4).map((ball, index) =>
        Outcome.cushion(ball, 1, index + 1),
      ),
    ];
    const events = (engine as any).applyEightBall(outcomes, true);
    expect(engine.state.lastMessage).toBe("开球有效，交换击球权");
    expect(events.some((event: any) => event.type === "turn")).toBe(true);
  });

  it("scores a snooker red and then requires a colour", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    const red = engine.table.balls[7];
    red.state = State.InPocket;
    const outcomes = [
      Outcome.collision(engine.table.cueball, red, 1, 0),
      Outcome.pot(red, 1, 1),
    ];
    (engine as any).applySnooker(outcomes);
    expect(engine.state.scores[0]).toBe(1);
    expect(engine.state.target.previousPotRed).toBe(true);
    expect(engine.state.target.targetIsRed).toBe(false);
  });

  it("awards at least the blue value for a snooker foul", () => {
    const engine = new MatchEngine({ gameType: "snooker" });
    const blue = engine.table.balls[4];
    const outcomes = [Outcome.collision(engine.table.cueball, blue, 1, 0)];
    (engine as any).applySnooker(outcomes);
    expect(engine.state.scores[1]).toBe(5);
    expect(engine.state.currentPlayer).toBe(1);
  });

  it("wins nine-ball only on a legal nine pot", () => {
    const engine = new MatchEngine({ gameType: "nineball" });
    pocketOtherBalls(engine, [9]);
    const nine = engine.table.balls[9];
    nine.state = State.InPocket;
    const outcomes = [
      Outcome.collision(engine.table.cueball, nine, 1, 0),
      Outcome.pot(nine, 1, 1),
    ];
    (engine as any).applyNineBall(outcomes, false);
    expect(engine.state.phase).toBe("gameOver");
    expect(engine.state.winner).toBe(0);
  });

  it("validates free-ball cue placement against overlaps", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    engine.state.phase = "ballInHand";
    const occupied = engine.table.balls[1].pos;
    expect(() => engine.placeCueBall(occupied.x, occupied.y)).toThrow();
  });

  it("previews placement legality from a snapshot on both ends", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    const snapshot = engine.snapshot();
    const occupied = snapshot.balls[1].pos;
    expect(cueBallPlacementLegal(snapshot, occupied[0], occupied[1])).toBe(
      false,
    );
    expect(cueBallPlacementLegal(snapshot, 10, 0)).toBe(false);
    expect(cueBallPlacementLegal(snapshot, Number.NaN, 0)).toBe(false);
    expect(cueBallPlacementLegal(snapshot, 0, 0)).toBe(true);

    snapshot.balls[1].state = "InPocket";
    expect(cueBallPlacementLegal(snapshot, occupied[0], occupied[1])).toBe(
      true,
    );

    const snooker = new MatchEngine({ gameType: "snooker" }).snapshot();
    expect(cueBallPlacementLegal(snooker, Rack.baulk + 0.05, 0)).toBe(false);
    expect(cueBallPlacementLegal(snooker, Rack.baulk - 0.1, 0.1)).toBe(true);
  });

  it("snaps an illegal cue-ball drop to the nearest legal spot", () => {
    const engine = new MatchEngine({ gameType: "eightball" });
    const snapshot = engine.snapshot();
    expect(nearestLegalCueBallPosition(snapshot, 0, 0)).toEqual({ x: 0, y: 0 });

    const occupied = snapshot.balls[1].pos;
    const overBall = nearestLegalCueBallPosition(
      snapshot,
      occupied[0] + 0.005,
      occupied[1],
    );
    expect(overBall).not.toBeNull();
    expect(
      cueBallPlacementLegal(snapshot, overBall!.x, overBall!.y),
    ).toBe(true);

    const outside = nearestLegalCueBallPosition(snapshot, 10, 0);
    expect(outside).not.toBeNull();
    expect(
      cueBallPlacementLegal(snapshot, outside!.x, outside!.y),
    ).toBe(true);

    const snooker = new MatchEngine({ gameType: "snooker" }).snapshot();
    const inD = nearestLegalCueBallPosition(snooker, Rack.baulk + 0.2, 0.2);
    expect(inD).not.toBeNull();
    expect(cueBallPlacementLegal(snooker, inD!.x, inD!.y)).toBe(true);
    expect(inD!.x).toBeLessThanOrEqual(Rack.baulk);
  });
});
