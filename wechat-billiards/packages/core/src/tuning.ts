import {
  maxPower,
  sete,
  setee,
  setmu,
  setmuS,
} from "../../../third_party/billiards/src/model/physics/constants";
import { PocketGeometry } from "../../../third_party/billiards/src/view/pocketgeometry";
import { TableConfig } from "../../../third_party/billiards/src/view/tableconfig";
import type { GameType } from "./types";

/**
 * Shared feel tuning for this game. The upstream physics module holds live
 * constants, so every configuration must be applied after table geometry is
 * set, on both the client and the authoritative server.
 *
 * The default cushion model is `bounceHanBlend`, which reads the Han
 * restitution `e`; `setee` only covers the optional Mathavan model. Both get
 * the same value so a model switch cannot silently change the feel.
 */
/**
 * A ball slower than this is treated as stopped. The upstream friction model
 * already halts exactly at zero; this trims the imperceptible tail so both
 * ends agree on when a shot is over.
 */
export const STOP_SPEED = 0.015;

export const GAME_PHYSICS = Object.freeze({
  rollingFriction: 0.018,
  slidingFriction: 0.2,
  cushionRestitution: 0.73,
  powerScale: 0.76,
  cornerPocketScale: 0.85,
});

export function applyMatchTable(
  gameType: GameType,
  tableSize = gameType === "snooker" ? 12 : 10,
) {
  TableConfig.apply(gameType, tableSize);
  PocketGeometry.cornerRadius *= GAME_PHYSICS.cornerPocketScale;
  for (const name of ["pocketNW", "pocketNE", "pocketSE", "pocketSW"]) {
    PocketGeometry.pockets[name].pocket.radius = PocketGeometry.cornerRadius;
  }
  setmu(GAME_PHYSICS.rollingFriction);
  setmuS(GAME_PHYSICS.slidingFriction);
  setee(GAME_PHYSICS.cushionRestitution);
  sete(GAME_PHYSICS.cushionRestitution);
}

export function tunedMaxPower(): number {
  return maxPower * GAME_PHYSICS.powerScale;
}
