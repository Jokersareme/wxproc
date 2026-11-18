import {
  colors,
  font,
  motion,
  radius,
  space,
  surface,
  typeScale,
  withAlpha,
} from "./theme";

describe("design tokens", () => {
  it("matches the 3.1 palette", () => {
    expect(colors.ink950).toBe("#030B09");
    expect(colors.ink900).toBe("#04110E");
    expect(colors.ink800).toBe("#071C18");
    expect(colors.felt800).toBe("#064534");
    expect(colors.felt700).toBe("#0B5A43");
    expect(colors.felt600).toBe("#0F7A5A");
    expect(colors.brass500).toBe("#A97B3F");
    expect(colors.brass400).toBe("#C9A15A");
    expect(colors.brass300).toBe("#E4C07A");
    expect(colors.ivory100).toBe("#F6F0DF");
    expect(colors.sage300).toBe("#9ED8C1");
    expect(colors.sage500).toBe("#5E8F7C");
    expect(colors.danger400).toBe("#E07A5F");
    expect(colors.success400).toBe("#77DFA7");
    expect(colors.info400).toBe("#86E5FF");
  });

  it("keeps the type scale inside the spec ranges", () => {
    expect(typeScale.display).toBeGreaterThanOrEqual(56);
    expect(typeScale.display).toBeLessThanOrEqual(64);
    expect(typeScale.h1).toBeGreaterThanOrEqual(36);
    expect(typeScale.h2).toBeGreaterThanOrEqual(26);
    expect(typeScale.title).toBeGreaterThanOrEqual(22);
    expect(typeScale.body).toBeGreaterThanOrEqual(18);
    expect(typeScale.caption).toBeGreaterThanOrEqual(15);
    expect(typeScale.micro).toBeGreaterThanOrEqual(13);
  });

  it("uses the 4px spacing grid and the 3.1 radius scale", () => {
    Object.values(space).forEach((value) => expect(value % 4).toBe(0));
    expect(radius).toEqual({ control: 8, panel: 12, card: 16, pill: 999 });
  });

  it("exposes the 3.1.4 motion durations", () => {
    expect(motion).toEqual({
      press: 90,
      panel: 240,
      page: 320,
      camera: 400,
      card: 520,
      victory: 800,
    });
  });

  it("builds canvas fonts from the CJK stack", () => {
    expect(font(19, 500)).toContain("500 19px");
    expect(font(19)).toContain("PingFang SC");
    expect(font(19)).toContain("Microsoft YaHei");
  });

  it("converts hex colors to rgba", () => {
    expect(withAlpha(colors.ink950, 0.62)).toBe("rgba(3, 11, 9, 0.62)");
    expect(withAlpha(colors.ivory100, 0.12)).toBe(
      "rgba(246, 240, 223, 0.12)",
    );
  });

  it("derives surface tones from the palette", () => {
    expect(surface.room).toBe("#061A16");
    expect(surface.button).toBe("rgba(11, 90, 67, 0.92)");
    expect(surface.buttonGhost).toBe("rgba(7, 28, 24, 0.42)");
    expect(surface.mask).toBe("rgba(3, 11, 9, 0.62)");
  });
});
