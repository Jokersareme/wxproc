import { copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

function run(script) {
  const result = spawnSync(script, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("corepack yarn build:server");
run("corepack yarn build:web");
run("corepack yarn build:minigame");
await mkdir("apps/minigame/licenses", { recursive: true });
await copyFile("LICENSE", "apps/minigame/licenses/GPL-3.0.txt");
await copyFile(
  "THIRD_PARTY_NOTICES.md",
  "apps/minigame/licenses/THIRD_PARTY_NOTICES.md",
);
console.log("Server, browser preview and WeChat mini game builds completed.");
