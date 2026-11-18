import {
  PHYSICS_TARGETS,
  runPhysicsBenchmark,
  validatePhysicsBenchmark,
} from "./physics-benchmark";

describe("physics benchmark", () => {
  it("keeps the tuned feel inside the P2 target bands", () => {
    const benchmark = runPhysicsBenchmark();
    expect(validatePhysicsBenchmark(benchmark)).toEqual([]);

    const full = benchmark.freeShots.find((shot) => shot.power === 1);
    expect(full?.path).toBeGreaterThanOrEqual(PHYSICS_TARGETS.fullPathMin);
    expect(full?.path).toBeLessThanOrEqual(PHYSICS_TARGETS.fullPathMax);
  }, 30000);
});
