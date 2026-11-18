export const colors = {
  ink950: "#030B09",
  ink900: "#04110E",
  ink800: "#071C18",
  felt800: "#064534",
  felt700: "#0B5A43",
  felt600: "#0F7A5A",
  brass500: "#A97B3F",
  brass400: "#C9A15A",
  brass300: "#E4C07A",
  ivory100: "#F6F0DF",
  sage300: "#9ED8C1",
  sage500: "#5E8F7C",
  danger900: "#3A1814",
  danger400: "#E07A5F",
  danger200: "#F2B3A1",
  success400: "#77DFA7",
  info400: "#86E5FF",
  player0: "#5ED0C8",
  player1: "#E4B15A",
  player2: "#E07A5F",
} as const;

export const typeScale = {
  display: 60,
  h1: 40,
  h2: 28,
  title: 24,
  body: 19,
  caption: 16,
  micro: 13,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  control: 8,
  panel: 12,
  card: 16,
  pill: 999,
} as const;

export const motion = {
  press: 90,
  panel: 240,
  page: 320,
  camera: 400,
  card: 520,
  victory: 800,
} as const;

export const fontStack =
  '-apple-system, "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

export const monoFontStack =
  '"SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, "PingFang SC", monospace';

export function font(size: number, weight: number | string = 500) {
  return `${weight} ${size}px ${fontStack}`;
}

export function monoFont(size: number, weight: number | string = 500) {
  return `${weight} ${size}px ${monoFontStack}`;
}

export function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export const surface = {
  room: "#061A16",
  button: withAlpha(colors.felt700, 0.92),
  buttonGhost: withAlpha(colors.ink800, 0.42),
  buttonDanger: withAlpha(colors.danger900, 0.92),
  mask: withAlpha(colors.ink950, 0.62),
  line: withAlpha(colors.ivory100, 0.12),
  lineStrong: withAlpha(colors.ivory100, 0.16),
} as const;

export const shadow = {
  panel: { color: "rgba(0, 0, 0, 0.35)", blur: 24, offsetY: 8 },
  modal: { color: "rgba(0, 0, 0, 0.5)", blur: 48, offsetY: 16 },
} as const;
