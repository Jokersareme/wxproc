import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await mkdir("release", { recursive: true });
const output = "release/friend-billiards-corresponding-source.tar.gz";
const result = spawnSync(
  "tar",
  [
    "-czf",
    output,
    "--exclude=.git",
    "--exclude=node_modules",
    "--exclude=.yarn",
    "--exclude=.pnp.cjs",
    "--exclude=.pnp.loader.mjs",
    "--exclude=dist",
    "--exclude=release",
    "--exclude=coverage",
    "--exclude=artifacts",
    "--exclude=apps/server/data/rooms.json",
    "--exclude=.env",
    ".",
  ],
  { stdio: "inherit", shell: false },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Corresponding source archive written to ${output}`);
console.log(
  "Publish the complete archive or the equivalent public source repository before distribution.",
);
