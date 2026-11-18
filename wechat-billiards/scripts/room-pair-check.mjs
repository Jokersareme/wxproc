/* eslint-disable no-empty */
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const out = "artifacts/visual";
const chromePort = 9224;
const appPort = 8080;
const devPort = 8081;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-pid, "SIGTERM");
}
function chromePath() {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => p && existsSync(p));
}
async function waitForHttp(url, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`timeout ${url}`);
}
async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((res, rej) => {
    socket.once("open", res);
    socket.once("error", rej);
  });
  let seq = 0;
  const pending = new Map();
  socket.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });
  const call = (method, params = {}) => {
    const id = ++seq;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { socket, call };
}

await mkdir(out, { recursive: true });
process.env.NODE_ENV = "test";
process.env.ROOM_STORE_PATH = join(out, "rooms-pair.json");
const { createApp } = require("../apps/server/dist/index.cjs");
const app = await createApp();
await app.listen(appPort, "127.0.0.1");
const devServer = spawn("corepack", ["yarn", "dev:web"], {
  cwd: process.cwd(),
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});
devServer.stderr.on("data", (d) => process.stderr.write(`[web] ${d}`));
await waitForHttp(`http://127.0.0.1:${devPort}`);
const profile = await mkdtemp(join(tmpdir(), "billiards-pair-"));
const chrome = spawn(
  chromePath(),
  [
    "--headless=new",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1280,720",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const pages = [];
try {
  await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`);
  for (let i = 0; i < 2; i += 1) {
    const target = await fetch(
      `http://127.0.0.1:${chromePort}/json/new?about:blank`,
      { method: "PUT" },
    ).then((r) => r.json());
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const evaluate = async (expression) => {
      const result = await cdp.call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async (expression, timeout = 20000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        try {
          if (await evaluate(expression)) return;
        } catch {}
        await sleep(150);
      }
      throw new Error(`wait timeout ${expression}`);
    };
    const clickButton = async (id) => {
      const point = await evaluate(
        `(()=>{const b=billiards.hud.buttons.filter(b=>b.id===${JSON.stringify(id)}&&!b.disabled)[0];if(!b)return null;const l=billiards.hud.layout;return {x:(b.x+b.width/2)*(innerWidth/l.width),y:(b.y+b.height/2)*(innerHeight/l.height)};})()`,
      );
      if (!point) throw new Error(`no button ${id}`);
      await cdp.call("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: point.x,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
      await cdp.call("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
      await sleep(400);
    };
    const shot = async (name) => {
      const result = await cdp.call("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      await writeFile(
        join(out, `${name}.png`),
        Buffer.from(result.data, "base64"),
      );
      console.log("shot", name);
    };
    await cdp.call("Page.navigate", {
      url: `http://${i === 0 ? "127.0.0.1" : "localhost"}:${devPort}/`,
    });
    await waitFor("!!(window.billiards && window.billiards.hud)");
    await sleep(1200);
    if (await evaluate("billiards.model.showHint")) {
      await clickButton("dismissHint");
    }
    pages.push({ cdp, evaluate, waitFor, clickButton, shot });
  }

  const [a, b] = pages;
  await a.clickButton("friend");
  await a.waitFor("billiards.model.online === true", 15000);
  await a.clickButton("create:eightball");
  await a.waitFor(
    "billiards.model.screen === 'game' && billiards.model.trial === true",
    15000,
  );
  const code = await a.evaluate("billiards.room.roomCode");
  console.log("room code", code);
  await a.shot("debug-pair-trial-a");
  await b.clickButton("friend");
  await b.waitFor("billiards.model.online === true", 15000);
  await b.evaluate(
    `billiards.joinRoom(${JSON.stringify(code)}, ""), true`,
  );
  await a.waitFor("billiards.model.roomStatus === 'starting'", 15000);
  await b.waitFor("billiards.model.roomStatus === 'starting'", 15000);
  await a.waitFor("billiards.room.players.length === 2", 15000);
  await b.waitFor("billiards.room.players.length === 2", 15000);
  await sleep(600);
  await a.shot("debug-pair-starting-a");
  await b.shot("debug-pair-starting-b");
  console.log(
    "starting a",
    await a.evaluate(
      "JSON.stringify({screen:billiards.model.screen,status:billiards.room.status,players:billiards.room.players.map(p=>({name:p.displayName,connected:p.connected}))})",
    ),
  );
  await a.waitFor("billiards.model.roomStatus === 'playing'", 8000);
  await b.waitFor("billiards.model.roomStatus === 'playing'", 8000);
  await sleep(800);
  await a.shot("debug-pair-game-a");
  await b.shot("debug-pair-game-b");
  console.log(
    "game a",
    await a.evaluate(
      "JSON.stringify({screen:billiards.model.screen,playerIndex:billiards.playerIndex,current:billiards.snapshot.currentPlayer,players:billiards.snapshot.players,displayMode:billiards.table.displayMode,cameraMode:billiards.table.cameraMode,transition:!!billiards.table.cameraTransition,presentation:billiards.table.presentation,camera:billiards.table.camera.type,active:billiards.table.activeCamera().type,activePos:billiards.table.activeCamera().position.toArray(),activeZoom:billiards.table.activeCamera().zoom,pos:billiards.table.camera.position.toArray(),fov:billiards.table.camera.fov})",
    ),
  );
  console.log(
    "game b",
    await b.evaluate(
      "JSON.stringify({screen:billiards.model.screen,playerIndex:billiards.playerIndex,current:billiards.snapshot.currentPlayer,players:billiards.snapshot.players})",
    ),
  );
} finally {
  pages.forEach((p) => p.cdp.socket.close());
  killTree(chrome.pid);
  killTree(devServer.pid);
  await app.close().catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await sleep(300);
}
process.exit(0);
