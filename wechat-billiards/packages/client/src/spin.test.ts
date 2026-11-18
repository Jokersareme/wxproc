import { clampSpin, spinToCueOffset, SPIN_LIMIT } from "./spin";

describe("spin pad mapping", () => {
  it("clamps the strike point to the cue-ball face radius", () => {
    const clamped = clampSpin(0.9, 1.2);
    expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(SPIN_LIMIT, 10);
    expect(clamped.x).toBeGreaterThan(0);
    expect(clamped.y).toBeGreaterThan(0);
  });

  it("preserves a strike point that is already inside the limit", () => {
    expect(clampSpin(-0.2, 0.1)).toEqual({ x: -0.2, y: 0.1 });
    expect(SPIN_LIMIT).toBe(0.45);
  });

  it("maps screen-right to right english and screen-up to follow", () => {
    const check = (spinX: number, spinY: number, x: number, y: number) => {
      const offset = spinToCueOffset(spinX, spinY);
      expect(offset.x).toBeCloseTo(x, 10);
      expect(offset.y).toBeCloseTo(y, 10);
    };
    check(0.3, 0, -0.3, 0);
    check(-0.3, 0, 0.3, 0);
    check(0, -0.3, 0, 0.3);
    check(0, 0.3, 0, -0.3);
  });

  it("never sends a diagonal strike beyond the shared offset limit", () => {
    const offset = spinToCueOffset(1, 1);
    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(SPIN_LIMIT, 10);
  });
});
