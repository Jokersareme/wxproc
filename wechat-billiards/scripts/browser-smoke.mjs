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
async function buttonCentre(id) {
  return evaluate(
    `(()=>{const b=billiards.hud.buttons.find(c=>c.id===${JSON.stringify(id)});return b?{x:b.x+b.width/2,y:b.y+b.height/2}:null;})()`,
  );
}

const TABLE_CENTRE = { x: 640, y: 405 };
const SPIN_BUTTON = { x: 87, y: 660 };
const SHOOT_BUTTON = { x: 1181, y: 558 };
const MENU_BUTTON = { x: 78, y: 56 };

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

  const layout = await evaluate(
    "(()=>{const v=billiards.table.tableViewport();const hud=billiards.hud;return {topView:billiards.table.topView,viewport:v,viewportBottom:720-(v.y+v.height),exitTop:hud.buttons.some(b=>b.id==='exit'&&b.y<100),bottomCamera:hud.buttons.some(b=>b.id==='camera'&&b.y>600),bottomSound:hud.buttons.some(b=>b.id==='sound'&&b.y>600),shoot:hud.hit(1181,558,1280,720),menu:hud.hit(78,56,1280,720),spin:hud.hit(87,660,1280,720)};})()",
  );
  if (!layout?.topView) throw new Error("练习开局未默认进入 2D");
  if (Math.abs(layout.viewportBottom - 80) > 0.000001)
    throw new Error(`2D 视口底边未缩小到 80：${JSON.stringify(layout)}`);
  if (layout.exitTop || layout.bottomCamera || layout.bottomSound)
    throw new Error(`底部/右上控件未移除：${JSON.stringify(layout)}`);
  if (
    layout.shoot !== "shoot" ||
    layout.menu !== "menu" ||
    layout.spin !== "spinButton"
  )
    throw new Error(`新按钮位置错误：${JSON.stringify(layout)}`);
  await screenshot("artifacts/eightball-aim.png");

  const viewport = await evaluate(
    "({centre: billiards.table.screenToTable(640,405), topView: billiards.table.topView, aspect: billiards.table.camera.aspect})",
  );
  if (
    !viewport?.topView ||
    Math.abs(viewport.centre.x) > 0.000001 ||
    Math.abs(viewport.centre.y) > 0.000001
  )
    throw new Error(`2D 独立视口映射错误：${JSON.stringify(viewport)}`);
  await screenshot("artifacts/eightball-top-horizontal.png");

  await click(TABLE_CENTRE.x, TABLE_CENTRE.y);
  const clickAim = await evaluate(
    "(()=>{const p=billiards.table.screenToTable(640,405);const c=billiards.snapshot.balls[0];return {actual:billiards.angle,expected:Math.atan2(p.y-c.pos[1],p.x-c.pos[0])};})()",
  );
  if (Math.abs(clickAim.actual - clickAim.expected) > 0.000001)
    throw new Error(`单击瞄准错误：${JSON.stringify(clickAim)}`);

  await drag(640, 405, 700, 450);
  const dragAim = await evaluate(
    "(()=>{const p=billiards.table.screenToTable(700,450);const c=billiards.snapshot.balls[0];return {actual:billiards.angle,expected:Math.atan2(p.y-c.pos[1],p.x-c.pos[0])};})()",
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

  await click(SPIN_BUTTON.x, SPIN_BUTTON.y);
  await sleep(200);
  const spinModal = await evaluate(
    "({open:billiards.model.spinOpen, mask:billiards.hud.hit(200,300,1280,720), pad:billiards.hud.hit(640,380,1280,720)})",
  );
  if (!spinModal?.open || spinModal.mask !== "modalMask" || spinModal.pad !== "spinPad")
    throw new Error(`杆法弹窗未阻止下层触摸：${JSON.stringify(spinModal)}`);
  await drag(640, 380, 700, 430);
  const spin = await evaluate(
    "({x:billiards.model.spinX,y:billiards.model.spinY})",
  );
  if (!(spin.x > 0.05) || !(spin.y > 0.05))
    throw new Error(`杆法弹窗拖动无效：${JSON.stringify(spin)}`);
  await screenshot("artifacts/eightball-spin-modal.png");
  await click(640, 516);
  const spinClosed = await evaluate(
    "({open:billiards.model.spinOpen,x:billiards.model.spinX,y:billiards.model.spinY})",
  );
  if (spinClosed.open)
    throw new Error(`杆法弹窗未关闭：${JSON.stringify(spinClosed)}`);

  await evaluate(
    "(()=>{billiards.__rollingBefore={positions:billiards.snapshot.balls.map(b=>[...b.pos]),rotations:billiards.table.ballMeshes.map(m=>m.quaternion.toArray())};billiards.__shotInput=null;const original=billiards.engine.shoot.bind(billiards.engine);billiards.engine.shoot=(input,...args)=>{billiards.__shotInput={...input};return original(input,...args);};})()",
  );
  await click(SHOOT_BUTTON.x, SHOOT_BUTTON.y);
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
    "(()=>{const before=billiards.__rollingBefore;const after=billiards.snapshot.balls;let stationary=0;let stationaryChanged=0;let moved=0;let movedChanged=0;after.forEach((ball,i)=>{const distance=Math.hypot(...ball.pos.map((v,axis)=>v-before.positions[i][axis]));const rotation=Math.max(...billiards.table.ballMeshes[i].quaternion.toArray().map((v,axis)=>Math.abs(v-before.rotations[i][axis])));if(distance<0.00000001){stationary+=1;if(rotation>0.00000001)stationaryChanged+=1;}else{moved+=1;if(rotation>0.00000001)movedChanged+=1;}});return {stationary,stationaryChanged,moved,movedChanged,shotInput:billiards.__shotInput,angle:billiards.angle,power:billiards.model.power,spinX:billiards.model.spinX,spinY:billiards.model.spinY};})()",
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
  if (
    Math.abs(rolling.shotInput.spinX + spin.x) > 0.000001 ||
    Math.abs(rolling.shotInput.spinY + spin.y) > 0.000001 ||
    rolling.shotInput.spinX >= 0 ||
    rolling.shotInput.spinY >= 0 ||
    rolling.spinX !== 0 ||
    rolling.spinY !== 0
  )
    throw new Error(
      `显示杆法与物理输入符号未取反或击球后未归中：${JSON.stringify({ spin, rolling })}`,
    );
  await screenshot("artifacts/eightball-after-shot.png");

  const freeBallPhase = await evaluate(
    "(()=>{const engine=billiards.engine;engine.state.phase='ballInHand';engine.state.canRepositionCue=true;billiards.snapshot=engine.snapshot();billiards.table.sync(billiards.snapshot);billiards.redraw();return billiards.snapshot.phase;})()",
  );
  if (freeBallPhase !== "ballInHand")
    throw new Error(`无法显式建立自由球状态：${freeBallPhase}`);

  await evaluate(
    "(()=>{const toScreen=(x,y)=>{const point=billiards.table.ballMeshes[0].position.clone();point.set(x,y,0).project(billiards.table.camera);const view=billiards.table.tableViewport();return {x:view.x+(point.x+1)*view.width/2,y:view.y+(1-point.y)*view.height/2};};billiards.__tableToScreen=toScreen;billiards.__cueScreen=()=>{const p=billiards.snapshot.balls[0].pos;return toScreen(p[0],p[1]);};})()",
  );

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

  await click(TABLE_CENTRE.x, TABLE_CENTRE.y);
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

  const prediction = await evaluate(
    "(()=>{const cue=billiards.snapshot.balls[0].pos;const target=billiards.snapshot.balls.find(b=>b.id!==0&&b.state!=='InPocket');const dx=target.pos[0]-cue[0];const dy=target.pos[1]-cue[1];const radius=billiards.table.ballMeshes[1].geometry.parameters.radius;const base=Math.atan2(dy,dx);const angle=base+Math.asin((radius*0.8)/Math.hypot(dx,dy));const max=2*(radius*44)/3;const length=(segment)=>segment?Math.hypot(segment[1].x-segment[0].x,segment[1].y-segment[0].y):0;const points=(geometry)=>geometry.attributes.position?.count??0;const state=()=>{const segments=billiards.table.predictionSegments();return {normalVisible:billiards.table.predictionNormalLine.visible,tangentVisible:billiards.table.predictionTangentLine.visible,normalPoints:points(billiards.table.predictionNormalGeometry),tangentPoints:points(billiards.table.predictionTangentGeometry),debugNormal:segments.normal,debugTangent:segments.tangent};};billiards.table.setPredictionLevel(5);billiards.table.setAim(angle,0.5);const five=billiards.table.predictionSegments();const fiveState=state();billiards.table.setPredictionLevel(3);const three=billiards.table.predictionSegments();const threeState=state();billiards.table.setPredictionLevel(1);const one=billiards.table.predictionSegments();const oneState=state();billiards.table.setPredictionLevel(0);const zero=billiards.table.predictionSegments();const zeroState=state();billiards.table.setPredictionLevel(5);const fiveAgainState=state();billiards.table.setAim(base,0.5);const straightState=state();const straightTangent=billiards.table.predictionSegments().tangent;billiards.table.setAim(angle,0.5);const obliqueAgainState=state();return {max,fiveNormal:length(five.normal),fiveTangent:length(five.tangent),threeNormal:length(three.normal),oneNormal:length(one.normal),zeroNormal:zero.normal,fiveState,threeState,oneState,zeroState,fiveAgainState,straightState,straightTangent,obliqueAgainState};})()",
  );
  if (
    !prediction ||
    Math.abs(prediction.fiveNormal - prediction.max) > 0.00001 ||
    Math.abs(prediction.threeNormal - (prediction.max * 3) / 5) > 0.00001 ||
    Math.abs(prediction.oneNormal - prediction.max / 5) > 0.00001 ||
    prediction.zeroNormal !== null
  )
    throw new Error(`预测线档位长度错误：${JSON.stringify(prediction)}`);
  if (prediction.fiveTangent <= 0)
    throw new Error(`预测线未绘制母球切线：${JSON.stringify(prediction)}`);
  await sleep(500);
  const predictionVisibility = await evaluate(
    "({normal:billiards.table.predictionNormalLine.visible,tangent:billiards.table.predictionTangentLine.visible,normalPoints:billiards.table.predictionNormalGeometry.attributes.position.count,tangentPoints:billiards.table.predictionTangentGeometry.attributes.position.count})",
  );
  if (
    !predictionVisibility.normal ||
    !predictionVisibility.tangent ||
    predictionVisibility.normalPoints !== 2 ||
    predictionVisibility.tangentPoints !== 2
  )
    throw new Error(`预测线实际渲染状态错误：${JSON.stringify(predictionVisibility)}`);
  if (
    !prediction.fiveState.normalVisible ||
    !prediction.fiveState.tangentVisible ||
    prediction.fiveState.normalPoints !== 2 ||
    prediction.fiveState.tangentPoints !== 2 ||
    !prediction.threeState.normalVisible ||
    !prediction.threeState.tangentVisible ||
    prediction.threeState.normalPoints !== 2 ||
    prediction.threeState.tangentPoints !== 2 ||
    !prediction.oneState.normalVisible ||
    !prediction.oneState.tangentVisible ||
    prediction.oneState.normalPoints !== 2 ||
    prediction.oneState.tangentPoints !== 2
  )
    throw new Error(
      `预测线切换档位后几何丢失：${JSON.stringify(prediction)}`,
    );
  if (
    prediction.zeroState.normalVisible ||
    prediction.zeroState.tangentVisible ||
    prediction.zeroState.debugNormal !== null ||
    prediction.zeroState.debugTangent !== null ||
    prediction.zeroState.normalPoints !== 2 ||
    prediction.zeroState.tangentPoints !== 2
  )
    throw new Error(`预测线 0 档未隐藏：${JSON.stringify(prediction.zeroState)}`);
  if (
    !prediction.fiveAgainState.normalVisible ||
    !prediction.fiveAgainState.tangentVisible ||
    prediction.fiveAgainState.normalPoints !== 2 ||
    prediction.fiveAgainState.tangentPoints !== 2 ||
    prediction.fiveAgainState.debugNormal === null ||
    prediction.fiveAgainState.debugTangent === null
  )
    throw new Error(
      `预测线 0 档后无法恢复 5 档：${JSON.stringify(prediction.fiveAgainState)}`,
    );
  if (
    !prediction.straightState.normalVisible ||
    prediction.straightState.tangentVisible ||
    prediction.straightState.normalPoints !== 2 ||
    prediction.straightState.debugTangent !== null ||
    prediction.straightTangent !== null
  )
    throw new Error(
      `直球切线未正确隐藏：${JSON.stringify(prediction.straightState)}`,
    );
  if (
    !prediction.obliqueAgainState.tangentVisible ||
    !prediction.obliqueAgainState.normalVisible ||
    prediction.obliqueAgainState.normalPoints !== 2 ||
    prediction.obliqueAgainState.tangentPoints !== 2 ||
    prediction.obliqueAgainState.debugTangent === null
  )
    throw new Error(
      `直球后斜切预测线无法恢复：${JSON.stringify(prediction.obliqueAgainState)}`,
    );
  await screenshot("artifacts/eightball-prediction.png");

  const menuBefore = await evaluate(
    "({angle:billiards.angle,open:billiards.model.menuOpen})",
  );
  await click(MENU_BUTTON.x, MENU_BUTTON.y);
  await sleep(200);
  const menuOpen = await evaluate(
    "({open:billiards.model.menuOpen,mask:billiards.hud.hit(100,300,1280,720),camera:billiards.hud.hit(640,223,1280,720)})",
  );
  if (!menuOpen?.open || menuOpen.mask !== "modalMask" || menuOpen.camera !== "camera")
    throw new Error(`菜单弹窗未阻止下层触摸：${JSON.stringify(menuOpen)}`);
  await click(100, 300);
  const menuBlocked = await evaluate(
    "({open:billiards.model.menuOpen,angle:billiards.angle})",
  );
  if (menuBlocked.open || Math.abs(menuBlocked.angle - menuBefore.angle) > 0.000001)
    throw new Error(`菜单遮罩未拦截台面手势：${JSON.stringify(menuBlocked)}`);

  await click(MENU_BUTTON.x, MENU_BUTTON.y);
  await sleep(150);
  const practiceButtons = await evaluate(
    "billiards.hud.buttons.filter(b=>b.id.startsWith('practicePrediction:')).map(b=>({id:b.id,x:b.x+b.width/2,y:b.y+b.height/2}))",
  );
  if (practiceButtons?.length !== 6)
    throw new Error(
      `单机菜单未显示六个预测档位：${JSON.stringify(practiceButtons)}`,
    );
  const practiceLevels = [];
  for (const button of practiceButtons) {
    const level = Number(button.id.split(":")[1]);
    await click(button.x, button.y);
    await sleep(80);
    const current = await evaluate(
      "({preference:billiards.model.practicePredictionLevel,table:billiards.table.predictionLevel,normal:billiards.table.predictionSegments().normal,tangent:billiards.table.predictionSegments().tangent})",
    );
    if (current.preference !== level || current.table !== level)
      throw new Error(
        `单机预测 ${level} 档未即时生效：${JSON.stringify(current)}`,
      );
    if (
      level === 0
        ? current.normal !== null || current.tangent !== null
        : current.normal === null
    )
      throw new Error(
        `单机预测 ${level} 档可见性错误：${JSON.stringify(current)}`,
      );
    practiceLevels.push({ level, ...current });
  }
  const threeButton = practiceButtons.find(
    (button) => button.id === "practicePrediction:3",
  );
  await click(threeButton.x, threeButton.y);
  await sleep(120);
  const practiceImmediate = await evaluate(
    "({preference:billiards.model.practicePredictionLevel,table:billiards.table.predictionLevel,open:billiards.model.menuOpen,normal:billiards.table.predictionSegments().normal})",
  );
  if (
    practiceImmediate.preference !== 3 ||
    practiceImmediate.table !== 3 ||
    !practiceImmediate.open ||
    practiceImmediate.normal === null
  )
    throw new Error(
      `单机预测偏好即时生效失败：${JSON.stringify(practiceImmediate)}`,
    );
  await screenshot("artifacts/eightball-practice-prediction-menu.png");

  const cameraButton = await buttonCentre("camera");
  await click(cameraButton.x, cameraButton.y);
  await sleep(500);
  const camera = await evaluate(
    "({topView:billiards.table.topView, open:billiards.model.menuOpen})",
  );
  if (camera.topView || !camera.open)
    throw new Error(`菜单视角切换失败：${JSON.stringify(camera)}`);
  await screenshot("artifacts/eightball-menu.png");
  const closeButton = await buttonCentre("closeModal");
  await click(closeButton.x, closeButton.y);
  const menuClosed = await evaluate("billiards.model.menuOpen");
  if (menuClosed) throw new Error("菜单未关闭");
  await screenshot("artifacts/eightball-table-3d.png");

  await click(MENU_BUTTON.x, MENU_BUTTON.y);
  await sleep(150);
  const cameraButton2 = await buttonCentre("camera");
  await click(cameraButton2.x, cameraButton2.y);
  await sleep(500);
  const closeButton2 = await buttonCentre("closeModal");
  await click(closeButton2.x, closeButton2.y);
  const back2d = await evaluate("billiards.table.topView");
  if (!back2d) throw new Error("未切回 2D");

  await click(MENU_BUTTON.x, MENU_BUTTON.y);
  await sleep(150);
  const exitButton = await buttonCentre("exit");
  await click(exitButton.x, exitButton.y);
  await sleep(500);
  const lobby = await evaluate("billiards.model.screen");
  if (lobby !== "home") throw new Error(`退出对局未回到大厅：${lobby}`);
  await click(245, 326);
  await sleep(2000);
  const restoredPractice = await evaluate(
    "({screen:billiards.model.screen,topView:billiards.table.topView,preference:billiards.model.practicePredictionLevel,table:billiards.table.predictionLevel,practiceMode:billiards.model.practiceMode,balls:billiards.snapshot?.balls.length})",
  );
  if (
    restoredPractice.screen !== "game" ||
    !restoredPractice.topView ||
    !restoredPractice.practiceMode ||
    restoredPractice.balls !== 16 ||
    restoredPractice.preference !== 3 ||
    restoredPractice.table !== 3
  )
    throw new Error(
      `新建练习未恢复预测偏好：${JSON.stringify(restoredPractice)}`,
    );
  await screenshot("artifacts/eightball-practice-restored.png");

  if (exceptions.length)
    throw new Error(`浏览器异常：${JSON.stringify(exceptions)}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        table,
        layout,
        viewport,
        clickAim,
        dragAim,
        power,
        fineAim: { before: fineBefore, ...fineAfter },
        spinModal,
        spin,
        spinClosed,
        rolling,
        firstPlacement,
        secondPlacement,
        aimAfterPlacement,
        prediction,
        menuOpen,
        menuBlocked,
        practiceLevels,
        practiceImmediate,
        camera,
        restoredPractice,
        shot: state,
        screenshots: [
          "artifacts/eightball-aim.png",
          "artifacts/eightball-spin-modal.png",
          "artifacts/eightball-top-horizontal.png",
          "artifacts/eightball-after-shot.png",
          "artifacts/eightball-ball-in-hand.png",
          "artifacts/eightball-prediction.png",
          "artifacts/eightball-practice-prediction-menu.png",
          "artifacts/eightball-menu.png",
          "artifacts/eightball-table-3d.png",
          "artifacts/eightball-practice-restored.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  socket.close();
}
