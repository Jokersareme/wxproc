import { offCenterLimit } from "../../../third_party/billiards/src/model/physics/constants";

/**
 * The spin pad is screen-oriented: x grows to the right, y grows downward.
 * The physics module expects the cue-face offset in its own signed frame:
 * lateral +x is left english, vertical +y is follow. Keep the single
 * conversion here so the local prediction and the networked shot cannot drift.
 */
export const SPIN_LIMIT = offCenterLimit;

export function clampSpin(
  x: number,
  y: number,
  limit = SPIN_LIMIT,
): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const max = Math.max(SPIN_LIMIT, Math.min(0.65, limit));
  const length = Math.hypot(safeX, safeY);
  if (length <= max || length < 1e-9) {
    return { x: safeX, y: safeY };
  }
  const scale = max / length;
  return { x: safeX * scale, y: safeY * scale };
}

export function spinToCueOffset(
  spinX: number,
  spinY: number,
  limit = SPIN_LIMIT,
): { x: number; y: number } {
  const spin = clampSpin(spinX, spinY, limit);
  return { x: -spin.x, y: -spin.y };
}
