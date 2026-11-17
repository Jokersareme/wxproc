import * as THREE from "three";
import type { MatchSnapshot } from "@friend-billiards/core";
import type { RoomState } from "@friend-billiards/protocol";
import type { ClientPlatform } from "./platform";

const WIDTH = 1280;
const HEIGHT = 720;
const SLIDER_TOP = 190;
const SLIDER_HEIGHT = 320;
const FINE_AIM_TRAVEL = SLIDER_HEIGHT / 2;
const SPIN_MODAL_X = 640;
const SPIN_MODAL_Y = 380;
const SPIN_MODAL_RADIUS = 120;
const SPIN_LIMIT = 0.42;

export interface HudModel {
  screen: "home" | "friend" | "room" | "game" | "license";
  title?: string;
  message?: string;
  snapshot?: MatchSnapshot;
  room?: RoomState;
  roomCode?: string;
  playerIndex?: number;
  power: number;
  spinX: number;
  spinY: number;
  fineAimOffset: number;
  canShoot: boolean;
  online: boolean;
  sourceUrl: string;
  menuOpen: boolean;
  spinOpen: boolean;
  soundOn: boolean;
  createPredictionLevel: number;
  predictionLevel: number;
  practicePredictionLevel: number;
  practiceMode: boolean;
}

interface Button {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  disabled?: boolean;
  accent?: boolean;
}

export class Hud {
  private readonly canvas: any;
  private readonly context: any;
  private readonly texture: THREE.CanvasTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(
    0,
    WIDTH,
    HEIGHT,
    0,
    -10,
    10,
  );
  private buttons: Button[] = [];

  constructor(
    platform: ClientPlatform,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.canvas = platform.createCanvas(WIDTH, HEIGHT);
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
    });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, HEIGHT),
      material,
    );
    plane.position.set(WIDTH / 2, HEIGHT / 2, 0);
    this.scene.add(plane);
  }

  draw(model: HudModel) {
    this.buttons = [];
    this.context.clearRect(0, 0, WIDTH, HEIGHT);
    if (model.screen !== "game") this.drawBackdrop();
    if (model.screen === "home") this.drawHome(model);
    if (model.screen === "friend") this.drawFriend(model);
    if (model.screen === "room") this.drawRoom(model);
    if (model.screen === "game") this.drawGame(model);
    if (model.screen === "license") this.drawLicense(model);
    this.texture.needsUpdate = true;
  }

  render() {
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  hit(
    x: number,
    y: number,
    screenWidth: number,
    screenHeight: number,
  ): string | null {
    const logicalX = (x / screenWidth) * WIDTH;
    const logicalY = (y / screenHeight) * HEIGHT;
    const button = [...this.buttons]
      .reverse()
      .find(
        (candidate) =>
          logicalX >= candidate.x &&
          logicalX <= candidate.x + candidate.width &&
          logicalY >= candidate.y &&
          logicalY <= candidate.y + candidate.height,
      );
    return button && !button.disabled ? button.id : null;
  }

  powerAt(y: number): number {
    const logicalY = (y / (this.lastScreenHeight || HEIGHT)) * HEIGHT;
    return Math.max(
      0.03,
      Math.min(1, 1 - (logicalY - SLIDER_TOP) / SLIDER_HEIGHT),
    );
  }

  spinAt(x: number, y: number): { x: number; y: number } {
    const logicalX = (x / (this.lastScreenWidth || WIDTH)) * WIDTH;
    const logicalY = (y / (this.lastScreenHeight || HEIGHT)) * HEIGHT;
    let spinX = (logicalX - SPIN_MODAL_X) / SPIN_MODAL_RADIUS;
    let spinY = (logicalY - SPIN_MODAL_Y) / SPIN_MODAL_RADIUS;
    const length = Math.hypot(spinX, spinY);
    if (length > 1) {
      spinX /= length;
      spinY /= length;
    }
    return { x: spinX * SPIN_LIMIT, y: spinY * SPIN_LIMIT };
  }

  private lastScreenWidth = WIDTH;
  private lastScreenHeight = HEIGHT;

  updatePointerSize(width: number, height: number) {
    this.lastScreenWidth = width;
    this.lastScreenHeight = height;
  }

  private drawBackdrop() {
    const gradient = this.context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, "#071d1a");
    gradient.addColorStop(1, "#102f2a");
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, WIDTH, HEIGHT);
    this.context.fillStyle = "rgba(30, 156, 111, 0.10)";
    this.context.beginPath();
    this.context.arc(1040, 120, 350, 0, Math.PI * 2);
    this.context.fill();
    this.context.fillStyle = "rgba(255,255,255,0.035)";
    for (let i = 0; i < 12; i++) {
      this.context.beginPath();
      this.context.arc(
        900 + (i % 4) * 80,
        430 + Math.floor(i / 4) * 80,
        25,
        0,
        Math.PI * 2,
      );
      this.context.fill();
    }
  }

  private drawHome(model: HudModel) {
    this.text("欢畅台球", 92, 128, 62, "#f4d99b", "left", true);
    this.text("3D 物理 · 好友同房 · 公平判定", 96, 180, 25, "#b7d7cb");
    this.text(
      model.online ? "联机服务已连接" : "练习可离线游玩，好友房需要连接服务",
      96,
      232,
      20,
      model.online ? "#77dfa7" : "#9db7af",
    );
    this.button("practice:eightball", "黑八练习", 96, 290, 300, 72, true);
    this.button("practice:nineball", "九球练习", 96, 382, 300, 72);
    this.button("practice:snooker", "斯诺克练习", 96, 474, 300, 72);
    this.button("friend", "好友联机", 446, 290, 300, 128, true);
    this.button("license", "规则与开源许可", 446, 446, 300, 64);
    this.button(
      "sound",
      model.soundOn ? "音效：开" : "音效：关",
      446,
      530,
      300,
      56,
    );
    this.text("原创界面，不含腾讯名称、素材或私有服务", 96, 650, 18, "#759b8e");
  }

  private drawFriend(model: HudModel) {
    this.text("好友联机", 88, 110, 48, "#f4d99b", "left", true);
    this.text(
      model.online ? "选择玩法建房，或输入好友的邀请信息" : "正在连接联机服务…",
      92,
      158,
      22,
      "#b7d7cb",
    );
    this.button(
      "create:eightball",
      "创建黑八房",
      92,
      204,
      300,
      72,
      true,
      !model.online,
    );
    this.button(
      "create:nineball",
      "创建九球房",
      418,
      204,
      300,
      72,
      false,
      !model.online,
    );
    this.button(
      "create:snooker",
      "创建斯诺克房",
      744,
      204,
      300,
      72,
      false,
      !model.online,
    );
    this.text("预测线", 92, 326, 22, "#d4e9df", "left", true);
    this.button(
      "prediction:toggle",
      model.createPredictionLevel > 0 ? "已开启" : "已关闭",
      190,
      300,
      150,
      52,
      model.createPredictionLevel > 0,
    );
    for (let level = 0; level <= 5; level += 1) {
      this.button(
        `prediction:${level}`,
        level === 0 ? "关闭" : `${level} 档`,
        360 + level * 94,
        300,
        84,
        52,
        model.createPredictionLevel === level,
      );
    }
    this.text(
      "0 档关闭，1–5 档距离递增；仅显示首颗碰撞球方向",
      360,
      286,
      18,
      "#9db7af",
    );
    this.button("join", "使用房间码 / 邀请令牌加入", 92, 384, 464, 72);
    this.button("back", "返回大厅", 92, 572, 220, 58);
    if (model.message) this.text(model.message, 92, 500, 21, "#edb6a5");
  }

  private drawRoom(model: HudModel) {
    this.text("好友房", 88, 106, 46, "#f4d99b", "left", true);
    this.text(
      `房间码：${model.roomCode ?? "------"}`,
      92,
      192,
      40,
      "#ffffff",
      "left",
      true,
    );
    this.text(
      "把邀请分享给微信好友；好友进入后双方准备开局",
      92,
      238,
      21,
      "#b7d7cb",
    );
    this.text(
      `预测线：${this.predictionName(model.room?.predictionLevel)}`,
      92,
      268,
      20,
      "#f4d99b",
    );
    const players = model.room?.players ?? [];
    players.forEach((player, index) => {
      this.panel(92, 290 + index * 104, 660, 82);
      this.text(
        `${index + 1}. ${player.displayName}`,
        120,
        344 + index * 104,
        26,
        "#ffffff",
      );
      this.text(
        player.connected
          ? player.ready
            ? "已准备"
            : "在线"
          : "离线，座位保留",
        690,
        344 + index * 104,
        20,
        player.connected ? "#77dfa7" : "#edb6a5",
        "right",
      );
    });
    this.button("share", "分享邀请", 806, 290, 270, 82, true);
    const me = players.find(
      (player) => player.playerIndex === model.playerIndex,
    );
    this.button(
      "ready",
      me?.ready ? "取消准备" : "准备开局",
      806,
      396,
      270,
      82,
      false,
      players.length < 2,
    );
    this.button("leave", "离开房间", 92, 584, 220, 58);
    if (model.message) this.text(model.message, 360, 616, 21, "#f4d99b");
  }

  private drawGame(model: HudModel) {
    const snapshot = model.snapshot;
    if (!snapshot) return;
    this.panel(16, 16, 1248, 82, 0.76);
    this.button("menu", "菜单", 30, 30, 96, 52);
    const leftGroup =
      snapshot.gameType === "eightball"
        ? this.groupName(snapshot.groups[0])
        : `${snapshot.scores[0]} 分`;
    const rightGroup =
      snapshot.gameType === "eightball"
        ? this.groupName(snapshot.groups[1])
        : `${snapshot.scores[1]} 分`;
    this.text(
      snapshot.players[0],
      148,
      51,
      24,
      snapshot.currentPlayer === 0 ? "#f4d99b" : "#ffffff",
      "left",
      true,
    );
    this.text(leftGroup, 148, 80, 18, "#9ed8c1");
    this.text(
      snapshot.players[1],
      786,
      51,
      24,
      snapshot.currentPlayer === 1 ? "#f4d99b" : "#ffffff",
      "right",
      true,
    );
    this.text(rightGroup, 786, 80, 18, "#9ed8c1", "right");
    const target =
      snapshot.gameType === "snooker"
        ? this.snookerTarget(snapshot)
        : `第 ${snapshot.shotNumber + 1} 杆`;
    this.text(target, 420, 63, 19, "#d4e9df");
    this.button("spinButton", "杆法", 32, 632, 110, 56);

    const sliderBottom = SLIDER_TOP + SLIDER_HEIGHT;
    const powerY = sliderBottom - model.power * SLIDER_HEIGHT;
    this.text("力度", 63, 164, 18, "#b7d7cb", "center");
    this.panel(50, SLIDER_TOP, 26, SLIDER_HEIGHT, 0.8);
    this.context.fillStyle = "#e5b85d";
    this.context.fillRect(50, powerY, 26, sliderBottom - powerY);
    this.context.fillStyle = "#ffffff";
    this.context.fillRect(40, powerY - 4, 46, 8);
    this.text(`${Math.round(model.power * 100)}%`, 63, 540, 20, "#ffffff", "center");
    this.buttons.push({
      id: "power",
      label: "",
      x: 28,
      y: SLIDER_TOP - 12,
      width: 72,
      height: SLIDER_HEIGHT + 24,
      disabled: !model.canShoot,
    });

    const fineAimY =
      SLIDER_TOP + FINE_AIM_TRAVEL + model.fineAimOffset * FINE_AIM_TRAVEL;
    this.text("微调", 1209, 164, 18, "#b7d7cb", "center");
    this.panel(1196, SLIDER_TOP, 26, SLIDER_HEIGHT, 0.8);
    this.context.fillStyle = "rgba(158, 216, 193, 0.45)";
    this.context.fillRect(1207, SLIDER_TOP + 8, 4, SLIDER_HEIGHT - 16);
    this.context.fillStyle = "#f4d99b";
    this.context.fillRect(1185, fineAimY - 4, 48, 8);
    this.text("+", 1209, SLIDER_TOP + 18, 18, "#ffffff", "center");
    this.text("−", 1209, sliderBottom - 18, 18, "#ffffff", "center");
    this.buttons.push({
      id: "fineAim",
      label: "",
      x: 1172,
      y: SLIDER_TOP - 12,
      width: 74,
      height: SLIDER_HEIGHT + 24,
      disabled: !model.canShoot,
    });

    this.button(
      "shoot",
      snapshot.phase === "ballInHand" ? "先摆母球" : "击球",
      1112,
      SLIDER_TOP + SLIDER_HEIGHT + 18,
      138,
      76,
      true,
      !model.canShoot,
    );
    if (snapshot.target.freeBall && !snapshot.target.nominatedBall) {
      this.button("nominate", "提名自由球", 780, 514, 216, 56);
    }
    const status =
      model.message ??
      (snapshot.phase === "ballInHand"
        ? "任意球：拖动白球到合法位置"
        : snapshot.canRepositionCue
          ? "任意球：可拖动白球调整，或点击台面瞄准"
          : (snapshot.lastMessage ??
            "单击台面瞄准，拖动粗瞄，右侧微调"));
    this.panel(280, 112, 720, 48, 0.62);
    this.text(status, 640, 144, 19, "#f1e5bd", "center");
    if (snapshot.phase === "gameOver") this.drawGameOver(model);
    if (model.spinOpen) this.drawSpinModal(model);
    if (model.menuOpen) this.drawMenuModal(model);
  }

  private drawMask() {
    this.context.fillStyle = "rgba(0, 0, 0, 0.62)";
    this.context.fillRect(0, 0, WIDTH, HEIGHT);
    this.buttons.push({
      id: "modalMask",
      label: "",
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
    });
  }

  private drawMenuModal(model: HudModel) {
    this.drawMask();
    this.panel(340, 120, 600, 500, 0.97);
    this.text("菜单", 640, 164, 32, "#f4d99b", "center", true);
    this.button("camera", "切换视角（2D / 3D）", 410, 190, 460, 52);
    this.button(
      "sound",
      model.soundOn ? "音效：开" : "音效：关",
      410,
      250,
      460,
      52,
    );
    if (model.practiceMode) {
      this.text(
        "预测线（单机练习，即时生效）",
        640,
        324,
        18,
        "#b7d7cb",
        "center",
      );
      for (let level = 0; level <= 5; level += 1) {
        this.button(
          `practicePrediction:${level}`,
          level === 0 ? "关闭" : `${level} 档`,
          368 + level * 92,
          340,
          84,
          48,
          model.practicePredictionLevel === level,
        );
      }
      this.button("exit", "退出对局", 410, 402, 460, 52, true);
      this.button("closeModal", "返回台面", 410, 464, 460, 44);
    } else {
      this.text(
        `预测线：${this.predictionName(model.predictionLevel)}（房间设置）`,
        640,
        330,
        20,
        "#f4d99b",
        "center",
      );
      this.button("exit", "退出对局", 410, 384, 460, 54, true);
      this.button("closeModal", "返回台面", 410, 450, 460, 46);
    }
  }

  private drawSpinModal(model: HudModel) {
    this.drawMask();
    this.panel(390, 210, 500, 360, 0.97);
    this.text("杆法", 640, 252, 30, "#f4d99b", "center", true);
    this.text("拖动白点调整击球点，关闭后生效", 640, 288, 18, "#b7d7cb", "center");
    this.context.strokeStyle = "#d8eee4";
    this.context.lineWidth = 3;
    this.context.beginPath();
    this.context.arc(
      SPIN_MODAL_X,
      SPIN_MODAL_Y,
      SPIN_MODAL_RADIUS,
      0,
      Math.PI * 2,
    );
    this.context.stroke();
    this.context.strokeStyle = "rgba(216, 238, 228, 0.35)";
    this.context.lineWidth = 1;
    this.context.beginPath();
    this.context.moveTo(SPIN_MODAL_X - SPIN_MODAL_RADIUS, SPIN_MODAL_Y);
    this.context.lineTo(SPIN_MODAL_X + SPIN_MODAL_RADIUS, SPIN_MODAL_Y);
    this.context.moveTo(SPIN_MODAL_X, SPIN_MODAL_Y - SPIN_MODAL_RADIUS);
    this.context.lineTo(SPIN_MODAL_X, SPIN_MODAL_Y + SPIN_MODAL_RADIUS);
    this.context.stroke();
    this.context.fillStyle = "#e9f4ee";
    this.context.beginPath();
    this.context.arc(
      SPIN_MODAL_X + (model.spinX / SPIN_LIMIT) * SPIN_MODAL_RADIUS,
      SPIN_MODAL_Y + (model.spinY / SPIN_LIMIT) * SPIN_MODAL_RADIUS,
      10,
      0,
      Math.PI * 2,
    );
    this.context.fill();
    this.buttons.push({
      id: "spinPad",
      label: "",
      x: SPIN_MODAL_X - SPIN_MODAL_RADIUS,
      y: SPIN_MODAL_Y - SPIN_MODAL_RADIUS,
      width: SPIN_MODAL_RADIUS * 2,
      height: SPIN_MODAL_RADIUS * 2,
    });
    this.button("closeModal", "关闭", 560, 492, 160, 48);
  }

  private drawGameOver(model: HudModel) {
    const snapshot = model.snapshot!;
    this.panel(330, 210, 620, 300, 0.94);
    this.text("本局结束", 640, 276, 40, "#f4d99b", "center", true);
    const winner =
      snapshot.winner === null
        ? "对局已结束"
        : `${snapshot.players[snapshot.winner]} 获胜`;
    this.text(winner, 640, 340, 30, "#ffffff", "center");
    this.text(snapshot.endReason ?? "", 640, 382, 20, "#b7d7cb", "center");
    this.button(
      model.online ? "rematch" : "restart",
      model.online ? "再来一局" : "重新开局",
      424,
      424,
      200,
      60,
      true,
    );
    this.button("exit", "返回大厅", 656, 424, 200, 60);
  }

  private drawLicense(model: HudModel) {
    this.text("玩法与开源许可", 78, 90, 40, "#f4d99b", "left", true);
    const lines = [
      "黑八：开球后开放球局，合法落袋确定全色/花色；先碰错误球、无球碰库或母球落袋为犯规。",
      "九球：每杆先碰最低号球，合法打进九号球获胜；犯规时九号球重摆，对手获得自由球。",
      "斯诺克：15 红球，红彩交替后按黄绿棕蓝粉黑清彩；犯规罚 4–7 分，彩球按规则复位。",
      "自由球采用几何遮挡检测；裁判裁量的 miss/复位不重放在本版不作为自动规则。",
      "本项目使用 tailuge/billiards 的 GPLv3 物理与规则算法，并包含修改及新增代码。",
      "完整 GPLv3 文本随源码提供。对应源码地址：",
      model.sourceUrl || "发布前必须配置真实公开源码地址",
      "不使用腾讯商标、美术、音频或私有协议；规则细节以本页和实际对局为准。",
    ];
    lines.forEach((line, index) =>
      this.text(
        line,
        82,
        158 + index * 48,
        20,
        index >= 4 ? "#a9cfc0" : "#e1eee8",
      ),
    );
    this.button(
      "copySource",
      "复制源码地址",
      82,
      574,
      250,
      58,
      false,
      !model.sourceUrl,
    );
    this.button("back", "返回", 360, 574, 180, 58);
  }

  private panel(
    x: number,
    y: number,
    width: number,
    height: number,
    opacity = 0.48,
  ) {
    this.context.fillStyle = `rgba(3, 18, 16, ${opacity})`;
    this.context.fillRect(x, y, width, height);
    this.context.strokeStyle = "rgba(186, 225, 207, 0.16)";
    this.context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  }

  private button(
    id: string,
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    accent = false,
    disabled = false,
  ) {
    this.context.fillStyle = disabled
      ? "rgba(83,100,94,0.55)"
      : accent
        ? "#b98942"
        : "rgba(22, 91, 70, 0.92)";
    this.context.fillRect(x, y, width, height);
    this.context.strokeStyle = disabled
      ? "rgba(255,255,255,0.08)"
      : accent
        ? "#f0d79e"
        : "rgba(162,220,192,0.38)";
    this.context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    this.text(
      label,
      x + width / 2,
      y + height / 2 + 2,
      23,
      disabled ? "#a3afa9" : "#ffffff",
      "center",
      true,
    );
    this.buttons.push({ id, label, x, y, width, height, accent, disabled });
  }

  private text(
    text: string,
    x: number,
    y: number,
    size: number,
    colour: string,
    align = "left",
    bold = false,
  ) {
    this.context.fillStyle = colour;
    this.context.font = `${bold ? "bold " : ""}${size}px sans-serif`;
    this.context.textAlign = align;
    this.context.textBaseline = "middle";
    this.context.fillText(text, x, y);
  }

  private predictionName(level?: number): string {
    if (level === undefined || level <= 0) return "关闭";
    return `${level} 档`;
  }

  private groupName(group: string): string {
    return group === "solids"
      ? "全色球"
      : group === "stripes"
        ? "花色球"
        : "开放球局";
  }

  private snookerTarget(snapshot: MatchSnapshot): string {
    if (snapshot.target.freeBall)
      return snapshot.target.nominatedBall ? "自由球已提名" : "请提名自由球";
    if (snapshot.target.targetIsRed) return "目标：红球";
    if (snapshot.target.previousPotRed) return "目标：任意彩球";
    return "按顺序清彩";
  }
}
