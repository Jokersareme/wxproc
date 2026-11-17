import * as THREE from "three";
import type { MatchSnapshot } from "@friend-billiards/core";
import type { RoomState } from "@friend-billiards/protocol";
import type { ClientPlatform } from "./platform";

const WIDTH = 1280;
const HEIGHT = 720;

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
  canShoot: boolean;
  online: boolean;
  sourceUrl: string;
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

  powerAt(x: number): number {
    const logicalX = (x / (this.lastScreenWidth || WIDTH)) * WIDTH;
    return Math.max(0.03, Math.min(1, (logicalX - 350) / 400));
  }

  spinAt(x: number, y: number): { x: number; y: number } {
    const logicalX = (x / (this.lastScreenWidth || WIDTH)) * WIDTH;
    const logicalY = (y / (this.lastScreenHeight || HEIGHT)) * HEIGHT;
    let spinX = (logicalX - 202) / 54;
    let spinY = (logicalY - 626) / 54;
    const length = Math.hypot(spinX, spinY);
    if (length > 1) {
      spinX /= length;
      spinY /= length;
    }
    return { x: spinX * 0.42, y: spinY * 0.42 };
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
      model.message === "sound:on" ? "音效：开" : "音效：关",
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
      220,
      300,
      76,
      true,
      !model.online,
    );
    this.button(
      "create:nineball",
      "创建九球房",
      418,
      220,
      300,
      76,
      false,
      !model.online,
    );
    this.button(
      "create:snooker",
      "创建斯诺克房",
      744,
      220,
      300,
      76,
      false,
      !model.online,
    );
    this.button("join", "使用房间码 / 邀请令牌加入", 92, 344, 464, 76);
    this.button("back", "返回大厅", 92, 572, 220, 58);
    if (model.message) this.text(model.message, 92, 478, 21, "#edb6a5");
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
      44,
      51,
      24,
      snapshot.currentPlayer === 0 ? "#f4d99b" : "#ffffff",
      "left",
      true,
    );
    this.text(leftGroup, 44, 80, 18, "#9ed8c1");
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
    this.button("exit", "退出", 1126, 30, 108, 52);
    this.button("camera", "视角", 1034, 624, 90, 56);
    this.button("sound", "音效", 1136, 624, 90, 56);
    this.panel(24, 560, 232, 138, 0.68);
    this.text("杆法", 42, 590, 18, "#b7d7cb");
    this.context.strokeStyle = "#d8eee4";
    this.context.lineWidth = 3;
    this.context.beginPath();
    this.context.arc(202, 626, 54, 0, Math.PI * 2);
    this.context.stroke();
    this.context.fillStyle = "#e9f4ee";
    this.context.beginPath();
    this.context.arc(
      202 + (model.spinX / 0.42) * 54,
      626 + (model.spinY / 0.42) * 54,
      8,
      0,
      Math.PI * 2,
    );
    this.context.fill();
    this.buttons.push({
      id: "spin",
      label: "",
      x: 142,
      y: 566,
      width: 120,
      height: 120,
    });
    this.text("力度", 304, 596, 18, "#b7d7cb");
    this.panel(350, 626, 400, 24, 0.8);
    this.context.fillStyle = "#e5b85d";
    this.context.fillRect(350, 626, 400 * model.power, 24);
    this.context.fillStyle = "#ffffff";
    this.context.fillRect(350 + 400 * model.power - 3, 616, 6, 44);
    this.buttons.push({
      id: "power",
      label: "",
      x: 330,
      y: 596,
      width: 440,
      height: 86,
    });
    this.text(`${Math.round(model.power * 100)}%`, 766, 647, 20, "#ffffff");
    this.button(
      "shoot",
      snapshot.phase === "ballInHand" ? "先摆母球" : "击球",
      842,
      600,
      154,
      82,
      true,
      !model.canShoot,
    );
    if (snapshot.target.freeBall && !snapshot.target.nominatedBall) {
      this.button("nominate", "提名自由球", 780, 514, 216, 56);
    }
    const status =
      model.message ??
      snapshot.lastMessage ??
      (snapshot.phase === "ballInHand"
        ? "拖动母球到合法位置"
        : "拖动台面瞄准，调整力度和杆法");
    this.panel(304, 112, 672, 48, 0.62);
    this.text(status, 640, 144, 19, "#f1e5bd", "center");
    if (snapshot.phase === "gameOver") this.drawGameOver(model);
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
