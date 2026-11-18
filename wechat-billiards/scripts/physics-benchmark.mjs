// Run with `yarn physics:benchmark` (tsx) so the TypeScript core loads.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PHYSICS_TARGETS,
  runPhysicsBenchmark,
  validatePhysicsBenchmark,
} = require("../packages/core/src/physics-benchmark.ts");
const { GAME_PHYSICS, tunedMaxPower } = require("../packages/core/src/tuning.ts");

const benchmark = runPhysicsBenchmark();
const failures = validatePhysicsBenchmark(benchmark);

const pad = (value, width) => String(value).padEnd(width);
const num = (value, width, digits = 2) =>
  value === null ? pad("—", width) : pad(value.toFixed(digits), width);

console.log("欢畅台球 · 物理基准");
console.log(
  `参数 rolling=${GAME_PHYSICS.rollingFriction} sliding=${GAME_PHYSICS.slidingFriction} cushion=${GAME_PHYSICS.cushionRestitution} powerScale=${GAME_PHYSICS.powerScale}（满力初速 ${tunedMaxPower().toFixed(3)} m/s）`,
);
console.log("");
console.log(
  `${pad("力度", 8)}${pad("初速 m/s", 10)}${pad("行程 m", 10)}${pad("停表 s", 10)}${pad("撞库", 6)}${pad("撞库比", 8)}`,
);
for (const shot of benchmark.freeShots) {
  console.log(
    `${pad(`${Math.round(shot.power * 100)}%`, 8)}${num(shot.initialSpeed, 10, 3)}${num(shot.path, 10)}${num(shot.durationMs / 1000, 10)}${pad(shot.cushions, 6)}${num(shot.cushionRatio, 8, 3)}`,
  );
}
console.log("");
console.log("开球");
for (const breakShot of benchmark.breaks) {
  console.log(
    `  ${pad(breakShot.gameType, 10)}${num(breakShot.durationMs / 1000, 8)} s  ${pad(`${breakShot.potted} 球`, 8)}${breakShot.message ?? ""}`,
  );
}
console.log("");
console.log(
  `目标带：满力 ${PHYSICS_TARGETS.fullPathMin}–${PHYSICS_TARGETS.fullPathMax} m / ${PHYSICS_TARGETS.fullStopMin}–${PHYSICS_TARGETS.fullStopMax} s；10% ${PHYSICS_TARGETS.lightPathMin}–${PHYSICS_TARGETS.lightPathMax} m；撞库比 ${PHYSICS_TARGETS.cushionRatioMin}–${PHYSICS_TARGETS.cushionRatioMax}`,
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log("PASS 所有指标落在 P2 目标带内");
}
