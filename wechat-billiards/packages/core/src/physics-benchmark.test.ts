import { R } from "../../../third_party/billiards/src/model/physics/constants";
import { PocketGeometry } from "../../../third_party/billiards/src/view/pocketgeometry";
import {
  PHYSICS_TARGETS,
  runPhysicsBenchmark,
  validatePhysicsBenchmark,
} from "./physics-benchmark";
import { applyMatchTable, GAME_PHYSICS } from "./tuning";

describe("physics benchmark", () => {
  it("keeps the tuned feel inside the P2 target bands", () => {
    const benchmark = runPhysicsBenchmark();
    expect(validatePhysicsBenchmark(benchmark)).toEqual([]);

    const full = benchmark.freeShots.find((shot) => shot.power === 1);
    expect(full?.path).toBeGreaterThanOrEqual(PHYSICS_TARGETS.fullPathMin);
    expect(full?.path).toBeLessThanOrEqual(PHYSICS_TARGETS.fullPathMax);
    expect(benchmark.knuckleRatio).toBeCloseTo(
      GAME_PHYSICS.cushionRestitution,
      10,
    );
  }, 30000);

  it("scales all four physical corner pockets without changing middle pockets", () => {
    applyMatchTable("eightball");
    applyMatchTable("eightball");
    expect(PocketGeometry.cornerRadius).toBeCloseTo(
      2.2 * R * GAME_PHYSICS.cornerPocketScale,
      10,
    );
    expect(PocketGeometry.middleRadius).toBeCloseTo(1.8 * R, 10);
    for (const name of ["pocketNW", "pocketNE", "pocketSE", "pocketSW"]) {
      expect(PocketGeometry.pockets[name].pocket.radius).toBeCloseTo(
        PocketGeometry.cornerRadius,
        10,
      );
    }
  });
});
