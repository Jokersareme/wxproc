import type { ClientPlatform } from "./platform";
import type { CameraMode, QualityTier } from "./ui/model";

export const qualityStorageKey = "billiards.quality";
export const mutedStorageKey = "billiards.muted";
export const volumeStorageKey = "billiards.volume";
export const motionStorageKey = "billiards.reduceMotion";
export const hintStorageKey = "billiards.hintSeen";
export const lastRoomStorageKey = "billiards.lastRoom";
export const cameraViewsStorageKey = "billiards.cameraViews";

export const cameraModes: CameraMode[] = ["top", "follow", "overview"];

export function isQualityTier(value: string): value is QualityTier {
  return value === "high" || value === "medium" || value === "low";
}

export function isCameraMode(value: string): value is CameraMode {
  return value === "top" || value === "follow" || value === "overview";
}

export function parseCameraViews(value: string): CameraMode[] {
  const selected = value.split(",").filter(isCameraMode);
  const ordered = cameraModes.filter((mode) => selected.includes(mode));
  return ordered.length > 0 ? ordered : [...cameraModes];
}

export function detectQuality(platform: ClientPlatform): QualityTier {
  const stored = platform.getStorage(qualityStorageKey);
  if (isQualityTier(stored)) return stored;
  const benchmark = platform.benchmarkLevel;
  if (benchmark !== undefined && benchmark >= 0) {
    if (benchmark >= 25) return "high";
    if (benchmark >= 12) return "medium";
    return "low";
  }
  if (platform.pixelRatio >= 2 && platform.height >= 800) return "high";
  if (platform.pixelRatio <= 1 && platform.width <= 900) return "low";
  return "medium";
}
