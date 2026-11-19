import {
  clientToDesign,
  computeLayout,
  fitRect,
  tableViewport,
} from "./layout";

describe("responsive layout", () => {
  it("keeps 1280x720 as the design baseline", () => {
    const layout = computeLayout(1280, 720, 1);
    expect(layout.scale).toBe(1);
    expect(layout.width).toBe(1280);
    expect(layout.height).toBe(720);
    expect(layout.pixelRatio).toBe(1);
    expect(layout.compact).toBe(false);
    expect(layout.wide).toBe(false);
  });

  it("expands design width on tall phones instead of stretching", () => {
    const layout = computeLayout(2340, 1080, 1);
    expect(layout.scale).toBeCloseTo(1.5, 10);
    expect(layout.width).toBeCloseTo(1560, 10);
    expect(layout.pixelRatio).toBeCloseTo(1.5, 10);
    expect(layout.compact).toBe(false);
    expect(layout.wide).toBe(true);
  });

  it("marks 4:3 screens as compact", () => {
    const layout = computeLayout(960, 720, 1);
    expect(layout.width).toBe(960);
    expect(layout.compact).toBe(true);
  });

  it("clamps the hud pixel ratio to 1..2", () => {
    expect(computeLayout(390, 844, 3).pixelRatio).toBeCloseTo(2, 10);
    expect(computeLayout(1920, 1080, 1).pixelRatio).toBeCloseTo(1.5, 10);
  });

  it("converts safe area insets into design coordinates", () => {
    const layout = computeLayout(2340, 1080, 1, {
      top: 0,
      right: 132,
      bottom: 63,
      left: 132,
    });
    expect(layout.safe.right).toBeCloseTo(88, 10);
    expect(layout.safe.bottom).toBeCloseTo(42, 10);
  });

  it("converts the WeChat capsule button into design coordinates", () => {
    const layout = computeLayout(2340, 1080, 1, {}, {
      left: 2100,
      top: 30,
      width: 132,
      height: 48,
    });
    expect(layout.menu?.x).toBeCloseTo(1400, 10);
    expect(layout.menu?.y).toBeCloseTo(20, 10);
    expect(layout.menu?.width).toBeCloseTo(88, 10);
    expect(layout.menu?.height).toBeCloseTo(32, 10);
  });

  it("maps client points through the current design width", () => {
    const layout = computeLayout(2340, 1080, 1);
    const point = clientToDesign(1170, 540, layout);
    expect(point.x).toBeCloseTo(780, 10);
    expect(point.y).toBeCloseTo(360, 10);
  });

  it("fits the table without distorting its aspect", () => {
    const rect = fitRect(2, { x: 100, y: 100, width: 900, height: 300 });
    expect(rect.width).toBe(600);
    expect(rect.height).toBe(300);
    expect(rect.x).toBe(250);
    expect(rect.y).toBe(100);
  });

  it("keeps the game table inside the 2-player viewport", () => {
    const layout = computeLayout(1280, 720, 1);
    const rect = tableViewport(layout);
    expect(rect.x).toBeCloseTo(100, 10);
    expect(rect.y).toBeCloseTo(102, 10);
    expect(rect.width).toBeCloseTo(1080, 10);
    expect(rect.height).toBeCloseTo(540, 10);
  });

  it("uses the available height in cards mode without a permanent hand tray", () => {
    const layout = computeLayout(1280, 720, 1);
    const rect = tableViewport(layout, { cards: true });
    expect(rect.y).toBeCloseTo(128, 10);
    expect(rect.width).toBeCloseTo(1072, 10);
    expect(rect.height).toBeCloseTo(536, 10);
    expect(rect.height).toBeGreaterThan(400);
  });
});
