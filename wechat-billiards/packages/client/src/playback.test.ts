import {
  DEFAULT_PLAYBACK_SPEED,
  playbackDuration,
  PLAYBACK_SPEEDS,
} from "./playback";

describe("shot playback timing", () => {
  it("plays at 1.15x by default", () => {
    expect(DEFAULT_PLAYBACK_SPEED).toBe(1.15);
    expect(playbackDuration(2300, DEFAULT_PLAYBACK_SPEED)).toBeCloseTo(
      2000,
      6,
    );
  });

  it("offers 1.5x and 2x without touching simulated time", () => {
    expect([...PLAYBACK_SPEEDS]).toEqual([1.15, 1.5, 2]);
    expect(playbackDuration(3000, 1.5)).toBeCloseTo(2000, 6);
    expect(playbackDuration(3000, 2)).toBeCloseTo(1500, 6);
  });

  it("keeps very short and very long shots bounded", () => {
    expect(playbackDuration(50, 2)).toBe(400);
    expect(playbackDuration(60_000, 1)).toBe(12000);
  });
});
