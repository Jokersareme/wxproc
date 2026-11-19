import {
  AIM_DRAG_RADIANS_PER_PIXEL,
  AIM_TAP_TOLERANCE,
  dragAimAngle,
  isAimDrag,
  pointInRect,
} from "./aim";

const point = (x: number, y: number) => ({ id: 0, x, y });

describe("aim gestures", () => {
  it("accepts only gestures that start inside the table viewport", () => {
    const rect = { x: 100, y: 80, width: 1080, height: 540 };
    expect(pointInRect({ x: 100, y: 80 }, rect)).toBe(true);
    expect(pointInRect({ x: 99, y: 80 }, rect)).toBe(false);
    expect(pointInRect({ x: 500, y: 621 }, rect)).toBe(false);
  });

  it("distinguishes taps from drags in design coordinates", () => {
    expect(isAimDrag(point(10, 10), point(18, 10), 1)).toBe(false);
    expect(isAimDrag(point(10, 10), point(10, 19), 1)).toBe(true);
    expect(isAimDrag(point(10, 10), point(14, 10), 2)).toBe(false);
    expect(AIM_TAP_TOLERANCE).toBe(8);
  });

  it("accumulates horizontal movement relative to the current angle", () => {
    const start = point(100, 200);
    const next = point(140, 220);
    expect(dragAimAngle(0.5, start, next, 1.5)).toBeCloseTo(
      0.5 + 60 * AIM_DRAG_RADIANS_PER_PIXEL,
    );
    expect(dragAimAngle(0.5, next, start, 1.5)).toBeCloseTo(
      0.5 - 60 * AIM_DRAG_RADIANS_PER_PIXEL,
    );
  });
});
