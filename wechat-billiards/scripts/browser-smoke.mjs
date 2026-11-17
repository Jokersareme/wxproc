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
async function drag(fromX, fromY, toX, toY) {
  await cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: fromX,
    y: fromY,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 8; step += 1) {
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: fromX + ((toX - fromX) * step) / 8,
      y: fromY + ((toY - fromY) * step) / 8,
      button: "left",
      buttons: 1,
    });
    await sleep(25);
  }
  await cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: toX,
    y: toY,
    button: "left",
    buttons: 0,
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
  await click(1078, 650);
  await sleep(500);
  const viewport = await evaluate(
    "({centre: billiards.table.screenToTable(640,355), topView: billiards.table.topView, aspect: billiards.table.camera.aspect})",
  );
  if (
    !viewport?.topView ||
    Math.abs(viewport.centre.x) > 0.000001 ||
    Math.abs(viewport.centre.y) > 0.000001
  )
    throw new Error(`2D 独立视口映射错误：${JSON.stringify(viewport)}`);
  await screenshot("artifacts/eightball-top-horizontal.png");

  await click(640, 355);
  const clickAim = await evaluate(
    "(()=>{const p=billiards.table.screenToTable(640,355);const c=billiards.snapshot.balls[0];return {actual:billiards.angle,expected:Math.atan2(p.y-c.pos[1],p.x-c.pos[0])};})()",
  );
  if (Math.abs(clickAim.actual - clickAim.expected) > 0.000001)
    throw new Error(`单击瞄准错误：${JSON.stringify(clickAim)}`);

  await drag(640, 355, 700, 400);
  const dragAim = await evaluate(
    "(()=>{const p=billiards.table.screenToTable(700,400);const c=billiards.snapshot.balls[0];return {actual:billiards.angle,expected:Math.atan2(p.y-c.pos[1],p.x-c.pos[0])};})()",
  );
  if (Math.abs(dragAim.actual - dragAim.expected) > 0.000001)
    throw new Error(`拖动瞄准错误：${JSON.stringify(dragAim)}`);

  await drag(63, 350, 63, 270);
  const power = await evaluate("billiards.model.power");
  if (Math.abs(power - 0.75) > 0.000001)
    throw new Error(`左侧力度条映射错误：${power}`);

  const fineBefore = await evaluate("billiards.angle");
  await drag(1210, 350, 1210, 390);
  const fineAfter = await evaluate(
    "({angle: billiards.angle, offset: billiards.model.fineAimOffset})",
  );
  if (
    Math.abs(fineAfter.angle - fineBefore - 0.032) > 0.000001 ||
    fineAfter.offset !== 0
  )
    throw new Error(
      `右侧微调滑轮错误：${JSON.stringify({ fineBefore, fineAfter })}`,
    );

  await evaluate(
    "(()=>{billiards.__rollingBefore={positions:billiards.snapshot.balls.map(b=>[...b.pos]),rotations:billiards.table.ballMeshes.map(m=>m.quaternion.toArray())};billiards.__shotInput=null;const original=billiards.engine.shoot.bind(billiards.engine);billiards.engine.shoot=(input,...args)=>{billiards.__shotInput={...input};return original(input,...args);};})()",
  );
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

  const rolling = await evaluate(
    "(()=>{const before=billiards.__rollingBefore;const after=billiards.snapshot.balls;let stationary=0;let stationaryChanged=0;let moved=0;let movedChanged=0;after.forEach((ball,i)=>{const distance=Math.hypot(...ball.pos.map((v,axis)=>v-before.positions[i][axis]));const rotation=Math.max(...billiards.table.ballMeshes[i].quaternion.toArray().map((v,axis)=>Math.abs(v-before.rotations[i][axis])));if(distance<0.00000001){stationary+=1;if(rotation>0.00000001)stationaryChanged+=1;}else{moved+=1;if(rotation>0.00000001)movedChanged+=1;}});return {stationary,stationaryChanged,moved,movedChanged,shotInput:billiards.__shotInput,angle:billiards.angle,power:billiards.model.power};})()",
  );
  if (
    !rolling ||
    rolling.stationary < 1 ||
    rolling.stationaryChanged !== 0 ||
    rolling.moved < 1 ||
    rolling.movedChanged < 1
  )
    throw new Error(`球体滚动验证失败：${JSON.stringify(rolling)}`);
  if (
    Math.abs(rolling.shotInput.angle - rolling.angle) > 0.000001 ||
    Math.abs(rolling.shotInput.power - rolling.power) > 0.000001
  )
    throw new Error(`滑条未应用到击球：${JSON.stringify(rolling)}`);

  await screenshot("artifacts/eightball-after-shot.png");
  await evaluate(
    "(()=>{const toScreen=(x,y)=>{const point=billiards.table.ballMeshes[0].position.clone();point.set(x,y,0).project(billiards.table.camera);const view=billiards.table.tableViewport();return {x:view.x+(point.x+1)*view.width/2,y:view.y+(1-point.y)*view.height/2};};billiards.__tableToScreen=toScreen;billiards.__cueScreen=()=>{const p=billiards.snapshot.balls[0].pos;return toScreen(p[0],p[1]);};})()",
  );
  const freeBallPhase = await evaluate("billiards.snapshot.phase");
  if (freeBallPhase !== "ballInHand")
    throw new Error(`验收杆未产生预期自由球：${freeBallPhase}`);

  const firstTarget = await evaluate(
    "({cue:billiards.__cueScreen(),target:billiards.__tableToScreen(-0.45,0.12)})",
  );
  await drag(
    firstTarget.cue.x,
    firstTarget.cue.y,
    firstTarget.target.x,
    firstTarget.target.y,
  );
  const firstPlacement = await evaluate(
    "({phase:billiards.snapshot.phase,canReposition:billiards.snapshot.canRepositionCue,pos:billiards.snapshot.balls[0].pos})",
  );
  if (
    firstPlacement.phase !== "aiming" ||
    !firstPlacement.canReposition ||
    Math.abs(firstPlacement.pos[0] + 0.45) > 0.00001 ||
    Math.abs(firstPlacement.pos[1] - 0.12) > 0.00001
  )
    throw new Error(`首次自由球摆放失败：${JSON.stringify(firstPlacement)}`);

  const secondTarget = await evaluate(
    "({cue:billiards.__cueScreen(),target:billiards.__tableToScreen(-0.6,-0.08)})",
  );
  await drag(
    secondTarget.cue.x,
    secondTarget.cue.y,
    secondTarget.target.x,
    secondTarget.target.y,
  );
  const secondPlacement = await evaluate(
    "({phase:billiards.snapshot.phase,canReposition:billiards.snapshot.canRepositionCue,pos:billiards.snapshot.balls[0].pos})",
  );
  if (
    secondPlacement.phase !== "aiming" ||
    !secondPlacement.canReposition ||
    Math.abs(secondPlacement.pos[0] + 0.6) > 0.00001 ||
    Math.abs(secondPlacement.pos[1] + 0.08) > 0.00001
  )
    throw new Error(`重复自由球摆放失败：${JSON.stringify(secondPlacement)}`);

  await click(640, 355);
  const aimAfterPlacement = await evaluate(
    "({pos:billiards.snapshot.balls[0].pos,gesture:billiards.gesture})",
  );
  if (
    Math.abs(aimAfterPlacement.pos[0] + 0.6) > 0.00001 ||
    Math.abs(aimAfterPlacement.pos[1] + 0.08) > 0.00001 ||
    aimAfterPlacement.gesture !== null
  )
    throw new Error(`自由球摆放后瞄准冲突：${JSON.stringify(aimAfterPlacement)}`);
  await screenshot("artifacts/eightball-ball-in-hand.png");

  await click(1078, 650);
  await sleep(500);
  await screenshot("artifacts/eightball-table-3d.png");
  if (exceptions.length)
    throw new Error(`浏览器异常：${JSON.stringify(exceptions)}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        table,
        viewport,
        clickAim,
        dragAim,
        power,
        fineAim: { before: fineBefore, ...fineAfter },
        rolling,
        firstPlacement,
        secondPlacement,
        aimAfterPlacement,
        shot: state,
        screenshots: [
          "artifacts/eightball-aim.png",
          "artifacts/eightball-top-horizontal.png",
          "artifacts/eightball-after-shot.png",
          "artifacts/eightball-ball-in-hand.png",
          "artifacts/eightball-table-3d.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  socket.close();
}
