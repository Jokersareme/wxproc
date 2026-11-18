export const DESIGN_HEIGHT = 720;
export const TABLE_ASPECT = 2;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Layout {
  screenWidth: number;
  screenHeight: number;
  scale: number;
  width: number;
  height: number;
  pixelRatio: number;
  safe: Insets;
  /** WeChat capsule button in design units; undefined on other platforms. */
  menu?: Rect;
  compact: boolean;
  wide: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function computeLayout(
  screenWidth: number,
  screenHeight: number,
  devicePixelRatio = 1,
  safeScreen: Partial<Insets> = {},
  menuScreen?: { left: number; top: number; width: number; height: number },
): Layout {
  const width = Math.max(1, screenWidth);
  const height = Math.max(1, screenHeight);
  const scale = height / DESIGN_HEIGHT;
  const designWidth = width / scale;
  const pixelRatio = clamp((height / DESIGN_HEIGHT) * devicePixelRatio, 1, 2);
  const inset = (value: number | undefined) =>
    Math.max(0, (value ?? 0) / scale);
  const menu =
    menuScreen && menuScreen.width > 0 && menuScreen.height > 0
      ? {
          x: Math.max(0, menuScreen.left / scale),
          y: Math.max(0, menuScreen.top / scale),
          width: menuScreen.width / scale,
          height: menuScreen.height / scale,
        }
      : undefined;
  return {
    screenWidth: width,
    screenHeight: height,
    scale,
    width: designWidth,
    height: DESIGN_HEIGHT,
    pixelRatio,
    safe: {
      top: inset(safeScreen.top),
      right: inset(safeScreen.right),
      bottom: inset(safeScreen.bottom),
      left: inset(safeScreen.left),
    },
    menu,
    compact: designWidth < 1100,
    wide: designWidth > 1450,
  };
}

function sameMenu(a?: Rect, b?: Rect) {
  if (!a || !b) return !a && !b;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export function sameLayout(a: Layout, b: Layout) {
  return (
    Math.abs(a.screenWidth - b.screenWidth) < 0.5 &&
    Math.abs(a.screenHeight - b.screenHeight) < 0.5 &&
    Math.abs(a.pixelRatio - b.pixelRatio) < 0.001 &&
    Math.abs(a.safe.top - b.safe.top) < 0.5 &&
    Math.abs(a.safe.right - b.safe.right) < 0.5 &&
    Math.abs(a.safe.bottom - b.safe.bottom) < 0.5 &&
    Math.abs(a.safe.left - b.safe.left) < 0.5 &&
    sameMenu(a.menu, b.menu)
  );
}

export function clientToDesign(
  x: number,
  y: number,
  layout: Layout,
): { x: number; y: number } {
  return {
    x: (x / layout.screenWidth) * layout.width,
    y: (y / layout.screenHeight) * layout.height,
  };
}

export function fitRect(aspect: number, available: Rect): Rect {
  const width = Math.min(available.width, available.height * aspect);
  const height = width / aspect;
  return {
    x: available.x + (available.width - width) / 2,
    y: available.y + (available.height - height) / 2,
    width,
    height,
  };
}

export function tableViewport(
  layout: Layout,
  options: { cards?: boolean; players?: number } = {},
): Rect {
  const players = options.players ?? 2;
  const side = layout.wide ? 48 : layout.compact ? 88 : 100;
  const top = options.cards ? 128 : players === 3 ? 112 : 80;
  const bottom = 56;
  const height = options.cards ? 400 : layout.height - top - bottom;
  return fitRect(TABLE_ASPECT, {
    x: layout.safe.left + side,
    y: layout.safe.top + top,
    width: layout.width - side * 2 - layout.safe.left - layout.safe.right,
    height: Math.min(height, layout.height - top - bottom),
  });
}

export function homeVisualViewport(layout: Layout): Rect {
  return {
    x: layout.width * 0.34,
    y: 0,
    width: layout.width * 0.66,
    height: layout.height,
  };
}

export function roomTableViewport(layout: Layout): Rect {
  const margin = layout.compact ? 40 : 72;
  return {
    x: margin,
    y: 250,
    width: layout.width - margin * 2,
    height: 330,
  };
}

export function gutter(layout: Layout) {
  return layout.compact ? 40 : 72;
}

export function safeTop(layout: Layout) {
  return layout.safe.top > 0 ? Math.max(layout.safe.top, 44) : 0;
}

export function safeBottom(layout: Layout) {
  return layout.safe.bottom > 0 ? Math.max(layout.safe.bottom, 34) : 0;
}

export function safeLeft(layout: Layout) {
  return layout.safe.left > 0 ? Math.max(layout.safe.left, 44) : 0;
}

export function safeRight(layout: Layout) {
  return layout.safe.right > 0 ? Math.max(layout.safe.right, 44) : 0;
}
