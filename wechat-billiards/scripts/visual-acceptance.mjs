import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const allSizes = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "2340x1080", width: 2340, height: 1080 },
  { name: "2532x1170", width: 2532, height: 1170 },
  { name: "960x720", width: 960, height: 720 },
];
const requestedSizes = process.env.VISUAL_SIZES?.split(",").filter(Boolean);
const sizes = requestedSizes?.length
  ? allSizes.filter((size) => requestedSizes.includes(size.name))
  : allSizes;
const outputDir = "artifacts/visual";
const chromePort = 9223;
const appPort = 8080;
const devPort = 8081;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipRoom = process.env.VISUAL_SKIP_ROOM === "1";
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-pid, "SIGTERM");
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

async function waitForHttp(url, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error(`等待 ${url} 超时`);
}

function waitSocketMessage(socket, predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      seen.push(message);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`等待 WebSocket 消息超时：${JSON.stringify(seen)}`));
    }, timeout);
    socket.on("message", onMessage);
  });
}

async function joinGuest(roomCode, inviteToken) {
  const socket = new WebSocket(`ws://127.0.0.1:${appPort}/ws`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const session = waitSocketMessage(socket, (m) => m.type === "session");
  socket.send(
    JSON.stringify({
      protocolVersion: 2,
      type: "login",
      code: "visual-guest",
      displayName: "访客",
    }),
  );
  await session;
  const starting = waitSocketMessage(
    socket,
    (m) => m.type === "room" && m.room.status === "starting",
  );
  socket.send(
    JSON.stringify({
      protocolVersion: 2,
      type: "joinRoom",
      roomCode,
      inviteToken,
    }),
  );
  await starting;
  return socket;
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails);
    }
  });
  const call = (method, params = {}) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { socket, call, exceptions };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  process.env.NODE_ENV = "test";
  process.env.ROOM_STORE_PATH = join(outputDir, "rooms.json");
  const { createApp } = require("../apps/server/dist/index.cjs");
  const app = await createApp();
  await app.listen(appPort, "127.0.0.1");

  const devServer = spawn("corepack", ["yarn", "dev:web"], {
    cwd: process.cwd(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  devServer.stdout.on("data", (data) => {
    const text = String(data);
    if (text.includes("compiled")) process.stdout.write(`[web] ${text}`);
  });
  devServer.stderr.on("data", (data) =>
    process.stderr.write(`[web] ${data}`),
  );
  await waitForHttp(`http://127.0.0.1:${devPort}`);

  const executable = chromePath();
  if (!executable) throw new Error("未找到 Chrome/Edge，可设置 CHROME_PATH");
  const profile = await mkdtemp(join(tmpdir(), "billiards-visual-"));
  const chrome = spawn(
    executable,
    [
      "--headless=new",
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--window-size=1280,720",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cdp;
  try {
    await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`);
    const target = await fetch(
      `http://127.0.0.1:${chromePort}/json/new?about:blank`,
      { method: "PUT" },
    ).then((response) => response.json());
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");

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
    const waitFor = async (expression, timeout = 10000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        try {
          if (await evaluate(expression)) return;
        } catch {
          /* page is loading */
        }
        await sleep(150);
      }
      throw new Error(`等待表达式超时：${expression}`);
    };
    const click = async (x, y) => {
      await cdp.call("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await cdp.call("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    };
    const clickButton = async (id) => {
      const point = await evaluate(
        `(()=>{const b=billiards.hud.buttons.filter(b=>b.id===${JSON.stringify(id)}&&!b.disabled)[0];if(!b)return null;const l=billiards.hud.layout;return {x:(b.x+b.width/2)*(innerWidth/l.width),y:(b.y+b.height/2)*(innerHeight/l.height)};})()`,
      );
      if (!point) throw new Error(`找不到可点击按钮：${id}`);
      await click(point.x, point.y);
      await sleep(350);
    };
    const screenshot = async (name) => {
      const result = await cdp.call("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const path = join(outputDir, `${name}.png`);
      await writeFile(path, Buffer.from(result.data, "base64"));
      console.log(`截图 ${path}`);
    };
    const reload = async (width, height) => {
      await cdp.call("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await cdp.call("Page.navigate", {
        url: `http://127.0.0.1:${devPort}/`,
      });
      await waitFor(
        "typeof billiards !== 'undefined' && billiards.hud && billiards.model",
      );
      await sleep(1200);
      if (await evaluate("billiards.model.showHint")) {
        await clickButton("dismissHint");
        await sleep(300);
      }
    };

    for (const size of sizes) {
      console.log(`尺寸 ${size.name}`);
      await reload(size.width, size.height);
      await screenshot(`${size.name}-home`);
      await clickButton("homeClassic");
      await sleep(300);
      await screenshot(`${size.name}-home-sheet`);
      await clickButton("homeClose");
      await clickButton("homeCards");
      await sleep(300);
      await screenshot(`${size.name}-home-cards`);
      await clickButton("homeClose");
      await clickButton("homeThree");
      await sleep(300);
      await screenshot(`${size.name}-home-three`);
      await clickButton("homeClose");
      await clickButton("settings");
      await sleep(300);
      await screenshot(`${size.name}-home-settings`);
      await clickButton("settingsClose");
      await clickButton("friend");
      await waitFor("billiards.model.screen === 'friend'");
      await sleep(500);
      await screenshot(`${size.name}-friend`);
      await clickButton("back");
      await waitFor("billiards.model.screen === 'home'");
      await sleep(300);

      await evaluate(
        "localStorage.setItem('billiards.lastRoom', JSON.stringify({roomCode:'123456',gameType:'eightball'}))",
      );
      await reload(size.width, size.height);
      await sleep(300);
      await screenshot(`${size.name}-home-continue`);
      await evaluate("localStorage.removeItem('billiards.lastRoom')");

      await clickButton("homePractice");
      await clickButton("homeStart");
      await waitFor("billiards.model.screen === 'game'");
      await sleep(900);
      await screenshot(`${size.name}-game-top`);
      const hudBefore = await evaluate("billiards.hud.texture.version");
      await sleep(700);
      const hudAfter = await evaluate("billiards.hud.texture.version");
      console.log(`${size.name} HUD 静态纹理版本：${hudBefore} -> ${hudAfter}`);
      await evaluate(
        "billiards.model.message='自由球：拖动白球到合法位置，或点击台面选择目标球；犯规后对手获得自由球并在任意位置摆放母球。若白球贴库，系统会自动将其移出库边并提示可用角度；同时状态条会保留最近二十条事件记录，方便复盘。'; billiards.redraw();",
      );
      await sleep(250);
      await screenshot(`${size.name}-game-status`);
      await clickButton("eventLog");
      await sleep(250);
      await screenshot(`${size.name}-game-eventlog`);
      await clickButton("closeModal");
      await evaluate("billiards.model.message=undefined; billiards.redraw();");

      await clickButton("menu");
      await sleep(300);
      await screenshot(`${size.name}-game-menu`);
      await clickButton("roomSettings");
      await sleep(300);
      await screenshot(`${size.name}-game-roomsettings`);
      await clickButton("quality:low");
      await sleep(600);
      await screenshot(`${size.name}-game-quality-low`);
      await clickButton("quality:high");
      await sleep(300);
      await clickButton("closeModal");
      await clickButton("spinButton");
      await sleep(300);
      await screenshot(`${size.name}-game-spin`);
      await clickButton("closeModal");

      await clickButton("menu");
      await clickButton("roomSettings");
      await clickButton("cameraView:follow");
      await clickButton("closeModal");
      await sleep(900);
      await screenshot(`${size.name}-game-follow`);

      await clickButton("menu");
      await clickButton("roomSettings");
      await clickButton("cameraView:overview");
      await clickButton("closeModal");
      await sleep(900);
      await screenshot(`${size.name}-game-overview`);
      await evaluate(
        "(()=>{const s=billiards.snapshot;if(!s)return;billiards.snapshot={...s,practice:false,players:['你','好友'],groups:['solids','stripes'],currentPlayer:0};billiards.model.practiceMode=false;billiards.redraw();})()",
      );
      await sleep(300);
      await screenshot(`${size.name}-game-2p`);

      await evaluate(
        "(()=>{const s=billiards.snapshot;if(!s)return;billiards.snapshot={...s,gameType:'snooker',playerCount:3,players:['甲','乙','丙'],scores:[10,8,4],bestBreak:[10,8,4],pots:[3,2,1],eliminated:[false,false,false],currentPlayer:1,groups:['open','open','open'],cards:null,winner:null,phase:'aiming',target:{targetIsRed:true,previousPotRed:false,freeBall:false,nominatedBall:null,respottedBlack:false,nextColour:1}};billiards.model.practiceMode=false;billiards.redraw();})()",
      );
      await sleep(300);
      await screenshot(`${size.name}-game-3p`);
      await evaluate(
        "(()=>{const s=billiards.snapshot;if(!s)return;billiards.snapshot={...s,phase:'gameOver',winner:0,ranking:[0,1,2],endReason:'黑球落袋，本局结束'};billiards.redraw();})()",
      );
      await sleep(300);
      await screenshot(`${size.name}-game-3p-over`);

      await reload(size.width, size.height);
      await clickButton("homeCards");
      await sleep(300);
      await clickButton("homeStart");
      await waitFor("billiards.model.screen === 'game' && billiards.snapshot?.cards?.enabled");
      await sleep(700);
      await screenshot(`${size.name}-game-cards`);
      await clickButton("menu");
      await sleep(300);
      await screenshot(`${size.name}-game-cards-menu`);
      await clickButton("closeModal");
      await evaluate(
        "(()=>{const s=billiards.snapshot;if(!s)return;billiards.model.online=true;billiards.model.practiceMode=false;billiards.model.roomMode='cards';billiards.snapshot={...s,practice:false,players:['你','好友']};billiards.redraw();})()",
      );
      await sleep(300);
      await screenshot(`${size.name}-game-cards-online`);
      const cardPoint = await evaluate(
        "(()=>{const b=billiards.hud.buttons.find(b=>b.id.startsWith('card:'));if(!b)return null;const l=billiards.hud.layout;return {x:(b.x+b.width/2)*(innerWidth/l.width),y:(b.y+b.height/2)*(innerHeight/l.height)};})()",
      );
      if (cardPoint) {
        await click(cardPoint.x, cardPoint.y);
        await sleep(300);
        await screenshot(`${size.name}-game-card-detail`);
        await clickButton("cardCancel");
      }

      await evaluate(
        "(()=>{const s=billiards.snapshot;if(!s)return;billiards.snapshot={...s,cards:null,playerCount:2,players:['你','好友'],groups:['solids','stripes'],phase:'gameOver',winner:0,endReason:'对手认输',scores:[1,0]};billiards.model.practiceMode=false;billiards.model.online=true;billiards.redraw();})()",
      );
      await sleep(300);
      await screenshot(`${size.name}-game-over`);

      await reload(size.width, size.height);
      await clickButton("about");
      await sleep(300);
      await screenshot(`${size.name}-license`);

      if (!skipRoom) {
        await reload(size.width, size.height);
        await clickButton("friend");
        await waitFor("billiards.model.screen === 'friend'");
        await waitFor("billiards.model.online === true", 12000);
        await sleep(300);
        await clickButton("create:eightball");
        await waitFor(
          "billiards.model.screen === 'game' && billiards.model.trial === true",
          12000,
        );
        await sleep(900);
        await screenshot(`${size.name}-trial`);
        await clickButton("roomOverlay");
        await sleep(300);
        await screenshot(`${size.name}-trial-room`);
        await clickButton("closeRoomOverlay");
        const roomCode = await evaluate("billiards.room.roomCode");
        const inviteToken = await evaluate("billiards.room.inviteToken");
        const guest = await joinGuest(roomCode, inviteToken);
        await waitFor("billiards.model.roomStatus === 'starting'", 8000);
        await sleep(350);
        await screenshot(`${size.name}-starting`);
        await waitFor("billiards.model.roomStatus === 'playing'", 6000);
        await sleep(500);
        await screenshot(`${size.name}-playing`);
        guest.close();
        await sleep(300);
      }
    }

    if (cdp.exceptions.length > 0)
      throw new Error(
        `页面出现异常：${JSON.stringify(cdp.exceptions.slice(0, 3))}`,
      );
    console.log(
      `视觉验收截图完成：${sizes.length * (skipRoom ? 25 : 29)} 张，输出 ${outputDir}`,
    );
  } finally {
    cdp?.socket.close();
    killTree(chrome.pid);
    killTree(devServer.pid);
    await app.close().catch(() => {});
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    await sleep(300);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
