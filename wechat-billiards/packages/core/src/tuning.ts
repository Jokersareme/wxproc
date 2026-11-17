import {
  maxPower,
  setee,
  setmu,
  setmuS,
} from "../../../third_party/billiards/src/model/physics/constants";
import { TableConfig } from "../../../third_party/billiards/src/view/tableconfig";
import type { GameType } from "./types";

/**
 * Shared feel tuning for this game. `TableConfig.apply` resets the rolling
 * friction from the upstream table definition, so every configuration must be
 * applied after it, on both the client and the authoritative server.
 */
export const GAME_PHYSICS = Object.freeze({
  rollingFriction: 0.012,
  slidingFriction: 0.18,
  cushionRestitution: 0.6,
  powerScale: 0.66,
});

export function applyMatchTable(
  gameType: GameType,
  tableSize = gameType === "snooker" ? 12 : 10,
) {
  TableConfig.apply(gameType, tableSize);
  setmu(GAME_PHYSICS.rollingFriction);
  setmuS(GAME_PHYSICS.slidingFriction);
  setee(GAME_PHYSICS.cushionRestitution);
}

export function tunedMaxPower(): number {
  return maxPower * GAME_PHYSICS.powerScale;
}
