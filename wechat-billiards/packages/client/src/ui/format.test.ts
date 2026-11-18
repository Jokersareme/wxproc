import type { MatchSnapshot, SnookerTarget } from "@friend-billiards/core";
import { targetBrief, targetLabel } from "./format";

function ball(label: number, state = "OnTable"): MatchSnapshot["balls"][number] {
  return {
    id: label,
    label,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    rvel: [0, 0, 0],
    state,
  };
}

function snookerTarget(overrides: Partial<SnookerTarget> = {}): SnookerTarget {
  return {
    targetIsRed: false,
    previousPotRed: false,
    freeBall: false,
    nominatedBall: null,
    respottedBlack: false,
    nextColour: 1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    version: 2,
    gameType: "eightball",
    phase: "aiming",
    canRepositionCue: false,
    practice: true,
    playerCount: 2,
    currentPlayer: 0,
    players: ["甲", "乙"],
    groups: ["open", "open"],
    scores: [0, 0],
    eliminated: [false, false],
    ranking: [],
    currentBreak: 0,
    shotNumber: 0,
    target: snookerTarget(),
    balls: [ball(0), ball(8)],
    winner: null,
    endReason: null,
    lastMessage: null,
    ...overrides,
  };
}

describe("turn target hints", () => {
  it("says any ball is legal while the eight-ball table is open", () => {
    expect(targetBrief(snapshot())).toBe("任意球");
    expect(targetLabel(snapshot())).toBe("目标：任意球（先进定色）");
  });

  it("names the assigned eight-ball group", () => {
    const state = snapshot({
      groups: ["solids", "open"],
      balls: [ball(0), ball(1), ball(2), ball(8)],
    });
    expect(targetBrief(state)).toBe("全色球");
    expect(targetLabel(state)).toBe("目标：全色球");
  });

  it("switches to the eight ball after clearing the group", () => {
    const state = snapshot({
      groups: ["stripes", "open"],
      balls: [
        ball(0),
        ...[1, 2, 3, 4, 5, 6, 7].map((label) => ball(label, "InPocket")),
        ball(8),
      ],
    });
    expect(targetBrief(state)).toBe("黑 8");
    expect(targetLabel(state)).toBe("目标：黑 8");
  });

  it("names the lowest nine-ball", () => {
    const state = snapshot({
      gameType: "nineball",
      balls: [ball(0), ball(2), ball(5), ball(9)],
    });
    expect(targetBrief(state)).toBe("2 号球");
    expect(targetLabel(state)).toBe("目标：2 号球");
  });

  it("names the next snooker colour instead of a generic sequence hint", () => {
    const state = snapshot({
      gameType: "snooker",
      target: snookerTarget({ nextColour: 3 }),
    });
    expect(targetBrief(state)).toBe("棕球");
    expect(targetLabel(state)).toBe("目标：棕球");
  });

  it("names red and any-colour snooker phases", () => {
    const red = snapshot({
      gameType: "snooker",
      target: snookerTarget({ targetIsRed: true }),
    });
    expect(targetLabel(red)).toBe("目标：红球");
    const anyColour = snapshot({
      gameType: "snooker",
      target: snookerTarget({ previousPotRed: true }),
    });
    expect(targetLabel(anyColour)).toBe("目标：任意彩球");
  });

  it("shows free-ball nomination state", () => {
    const pending = snapshot({
      gameType: "snooker",
      target: snookerTarget({ freeBall: true }),
    });
    expect(targetLabel(pending)).toBe("自由球：请提名");
    const nominated = snapshot({
      gameType: "snooker",
      target: snookerTarget({ freeBall: true, nominatedBall: 5 }),
    });
    expect(targetLabel(nominated)).toBe("自由球：粉球");
  });

  it("marks the respotted black decider", () => {
    const state = snapshot({
      gameType: "snooker",
      target: snookerTarget({ respottedBlack: true, nextColour: 6 }),
    });
    expect(targetLabel(state)).toBe("目标：黑球（重摆决胜）");
  });
});
