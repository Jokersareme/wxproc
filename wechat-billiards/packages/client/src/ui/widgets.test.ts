import { computeLayout } from "./layout";
import { Ui } from "./widgets";

class FakeContext {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  globalAlpha = 1;
  font = "";
  textAlign = "left";
  textBaseline = "middle";
  shadowColor = "";
  shadowBlur = 0;
  shadowOffsetY = 0;
  globalCompositeOperation = "source-over";
  texts: { value: string; font: string; fill: string }[] = [];
  arcRadii: number[] = [];
  points: [number, number][] = [];

  save() {}
  restore() {}
  beginPath() {}
  moveTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, radius: number) {
    this.arcRadii.push(radius);
  }
  arc() {}
  closePath() {}
  fill() {}
  stroke() {}
  clearRect() {}
  fillRect() {}
  clip() {}
  setLineDash() {}
  createLinearGradient() {
    return { addColorStop() {} };
  }
  measureText(value: string) {
    return { width: value.length * 9 };
  }
  fillText(value: string, _x: number, _y: number) {
    this.texts.push({ value, font: this.font, fill: this.fillStyle });
  }
}

function setup() {
  const context = new FakeContext();
  const layout = computeLayout(1280, 720, 1);
  return { context, layout, ui: new Ui(context, layout) };
}

describe("ui widgets", () => {
  it("registers button hit areas", () => {
    const { ui } = setup();
    ui.button("start", "开始", 100, 200, 240, 60, { accent: true });
    expect(ui.buttons).toEqual([
      {
        id: "start",
        label: "开始",
        x: 100,
        y: 200,
        width: 240,
        height: 60,
        disabled: false,
        accent: true,
        danger: undefined,
      },
    ]);
  });

  it("draws pill controls with a fully rounded corner", () => {
    const { context, ui } = setup();
    ui.pill("toggle", "开", 20, 20, 100, 40, true);
    expect(context.arcRadii).toContain(20);
  });

  it("never renders button labels below 18px", () => {
    const { context, ui } = setup();
    ui.button("tiny", "菜单", 0, 0, 56, 56, { fontSize: 12 });
    expect(context.texts[0].font).toContain("18px");
  });

  it("clamps panel highlights to the panel bounds", () => {
    const { context, ui } = setup();
    ui.panel(100, 100, 200, 40, 0.8, 999, "#000");
    const xs = context.points
      .filter(([, y]) => y === 101)
      .map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...xs)).toBeLessThanOrEqual(300);
  });

  it("draws a modal with a full-screen mask and shadow", () => {
    const { context, ui } = setup();
    ui.modal({ x: 100, y: 80, width: 600, height: 400 });
    expect(ui.buttons[0]).toMatchObject({
      id: "modalMask",
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
    expect(context.shadowBlur).toBe(48);
    expect(context.shadowOffsetY).toBe(16);
  });

  it("registers one hit area per tab", () => {
    const { ui } = setup();
    ui.tabs(
      "quality",
      [
        { id: "high", label: "高" },
        { id: "medium", label: "中" },
        { id: "low", label: "低" },
      ],
      100,
      100,
      300,
      42,
      "high",
    );
    expect(ui.buttons.map((button) => button.id)).toEqual([
      "quality:high",
      "quality:medium",
      "quality:low",
    ]);
  });

  it("shrinks long labels to their container", () => {
    const { context, ui } = setup();
    ui.text("很长的一段文字", 0, 0, 22, "#fff", "left", 600, 20);
    expect(context.texts[0].font).toContain("12px");
  });

  it("wraps long status text into two lines with an ellipsis", () => {
    const { ui } = setup();
    const lines = ui.wrap("这是一段很长的状态文字用于测试换行", 60, 18, 500, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
});
