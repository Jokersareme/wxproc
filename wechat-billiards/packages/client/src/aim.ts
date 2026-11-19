import type { TouchPoint } from "./platform";
import type { Rect } from "./ui/layout";

export const AIM_TAP_TOLERANCE = 8;
export const AIM_DRAG_RADIANS_PER_PIXEL = 0.003;

export function pointInRect(point: { x: number; y: number }, rect: Rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function isAimDrag(
  start: TouchPoint,
  current: TouchPoint,
  designUnitsPerPixel: number,
) {
  const dx = (current.x - start.x) * designUnitsPerPixel;
  const dy = (current.y - start.y) * designUnitsPerPixel;
  return Math.hypot(dx, dy) > AIM_TAP_TOLERANCE;
}

export function dragAimAngle(
  angle: number,
  previous: TouchPoint,
  current: TouchPoint,
  designUnitsPerPixel: number,
) {
  return (
    angle +
    (current.x - previous.x) * designUnitsPerPixel * AIM_DRAG_RADIANS_PER_PIXEL
  );
}
