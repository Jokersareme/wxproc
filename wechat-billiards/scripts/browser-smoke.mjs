import { writeFile } from "node:fs/promises";
import WebSocket from "ws";

const pages = await fetch("http://127.0.0.1:9222/json/list").then((response) =>
  response.json(),
);
const page = pages.find((candidate) =>
  candidate.url.startsWith("http://127.0.0.1:8081"),
);
if (!page) throw new Error("未找到浏览器预览页面");
const socket = new WebSocket(page.webSocketDebuggerUrl);
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
  if (message.method === "Runtime.exceptionThrown")
    exceptions.push(message.params.exceptionDetails);
});
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function click(x, y) {
  await cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function screenshot(path) {
  const result = await cdp("Page.captureScreenshot", { format: "png" });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

try {
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp("Page.reload", { ignoreCache: true });
  await sleep(5000);
  const diagnostic = await evaluate(
    "({action: billiards.hud.hit(245,326,1280,720), element: document.elementFromPoint(245,326)?.outerHTML, size: [billiards.platform.width,billiards.platform.height]})",
  );
  console.log("before-click", diagnostic);
  await screenshot("artifacts/browser-before-click.png");
  await click(245, 326);
  await sleep(2000);
  const table = await evaluate(
    "({screen: billiards.model.screen, balls: billiards.snapshot?.balls.length, canShoot: billiards.model.canShoot})",
  );
  if (table?.screen !== "game" || table?.balls !== 16 || !table?.canShoot)
    throw new Error(
      `黑八练习未正确进入：${JSON.stringify({ table, diagnostic })}`,
    );
  await screenshot("artifacts/eightball-aim.png");
  await click(918, 640);
  const deadline = Date.now() + 25000;
  let state;
  do {
    await sleep(500);
    state = await evaluate(
      "({shotNumber: billiards.snapshot?.shotNumber, animating: billiards.animating, message: billiards.model.message})",
    );
    if (Date.now() > deadline)
      throw new Error(`击球动画未结束：${JSON.stringify(state)}`);
  } while (state?.animating || state?.shotNumber !== 1);
  await screenshot("artifacts/eightball-after-shot.png");
  if (exceptions.length)
    throw new Error(`浏览器异常：${JSON.stringify(exceptions)}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        table,
        shot: state,
        screenshots: [
          "artifacts/eightball-aim.png",
          "artifacts/eightball-after-shot.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  socket.close();
}
