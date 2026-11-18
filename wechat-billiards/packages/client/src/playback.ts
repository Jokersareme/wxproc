export const DEFAULT_PLAYBACK_SPEED = 1.15;
export const PLAYBACK_SPEEDS = [1.15, 1.5, 2] as const;

export function playbackDuration(totalMs: number, speed: number): number {
  const safeSpeed =
    Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_PLAYBACK_SPEED;
  const simulated = Number.isFinite(totalMs) ? Math.max(0, totalMs) : 0;
  return Math.max(400, Math.min(12000, simulated / safeSpeed));
}
