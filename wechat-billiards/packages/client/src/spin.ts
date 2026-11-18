import { offCenterLimit } from "../../../third_party/billiards/src/model/physics/constants";

/**
 * The spin pad is screen-oriented: x grows to the right, y grows downward.
 * The physics module expects the cue-face offset in its own signed frame:
 * lateral +x is left english, vertical +y is follow. Keep the single
 * conversion here so the local prediction and the networked shot cannot drift.
 */
export const SPIN_LIMIT = offCenterLimit;

export function clampSpin(x: number, y: number): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const length = Math.hypot(safeX, safeY);
  if (length <= SPIN_LIMIT || length < 1e-9) {
    return { x: safeX, y: safeY };
  }
  const scale = SPIN_LIMIT / length;
  return { x: safeX * scale, y: safeY * scale };
}

export function spinToCueOffset(
  spinX: number,
  spinY: number,
): { x: number; y: number } {
  const spin = clampSpin(spinX, spinY);
  return { x: -spin.x, y: -spin.y };
}
