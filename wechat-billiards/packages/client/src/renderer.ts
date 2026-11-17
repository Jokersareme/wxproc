import * as THREE from "three";
import type {
  BallSnapshot,
  MatchSnapshot,
  ShotFrame,
} from "@friend-billiards/core";
import { tableDimensions } from "@friend-billiards/core";
import type { ClientPlatform } from "./platform";

const poolColours = [
  "#f4f1df",
  "#ebc51b",
  "#2462bd",
  "#c8332c",
  "#743b93",
  "#e57724",
  "#23804c",
  "#782a26",
  "#16191d",
  "#ebc51b",
  "#2462bd",
  "#c8332c",
  "#743b93",
  "#e57724",
  "#23804c",
  "#782a26",
];
const snookerColours = [
  "#f4f1df",
  "#e4c923",
  "#2a874f",
  "#91502d",
  "#2765ac",
  "#e69aae",
  "#17191c",
];

function ballColour(ball: BallSnapshot, gameType: string): string {
  if (gameType === "snooker")
    return ball.id >= 7 ? "#c62929" : (snookerColours[ball.id] ?? "#ffffff");
  return poolColours[ball.label ?? 0] ?? "#ffffff";
}

export class TableRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.01, 100);
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly tableGroup = new THREE.Group();
  private readonly cueGroup = new THREE.Group();
  private readonly aimGeometry = new THREE.BufferGeometry();
  private readonly aimLine: THREE.Line;
  private snapshot?: MatchSnapshot;
  private angle = 0;
  private power = 0.5;
  private topView = false;
  private animation?: {
    frames: ShotFrame[];
    started: number;
    duration: number;
  };
  private currentGameType = "eightball";

  constructor(private readonly platform: ClientPlatform) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: platform.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(platform.pixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color("#071c18");
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.tableGroup, this.cueGroup);
    this.aimLine = new THREE.Line(
      this.aimGeometry,
      new THREE.LineBasicMaterial({
        color: 0xf8f2ce,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.scene.add(this.aimLine);
    this.buildLights();
    this.buildTable();
    this.buildCue();
    this.resize();
  }

  resize() {
    const { width, height, pixelRatio } = this.platform;
    this.renderer.setPixelRatio(Math.min(pixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.updateCamera();
  }

  setTopView(value: boolean) {
    this.topView = value;
    this.updateCamera();
  }

  toggleCamera() {
    this.setTopView(!this.topView);
  }

  setAim(angle: number, power: number) {
    this.angle = angle;
    this.power = power;
    this.updateAim();
  }

  sync(snapshot: MatchSnapshot) {
    const gameChanged =
      !this.snapshot || this.snapshot.gameType !== snapshot.gameType;
    this.snapshot = snapshot;
    this.currentGameType = snapshot.gameType;
    if (gameChanged) this.rebuildBalls(snapshot);
    snapshot.balls.forEach((ball) => this.updateBall(ball));
    this.updateAim();
  }

  animate(frames: ShotFrame[], finalSnapshot: MatchSnapshot, done: () => void) {
    this.animation = {
      frames,
      started: Date.now(),
      duration: Math.max(400, Math.min(12000, frames.at(-1)?.time ?? 500)),
    };
    this.aimLine.visible = false;
    this.cueGroup.visible = false;
    const tick = () => {
      if (!this.animation) {
        this.sync(finalSnapshot);
        done();
        return;
      }
      const animation = this.animation;
      const elapsed = Date.now() - animation.started;
      const time =
        ((elapsed / 1000) * (animation.frames.at(-1)?.time ?? 1)) /
        (animation.duration / 1000);
      const nextIndex = animation.frames.findIndex(
        (frame) => frame.time >= time,
      );
      if (nextIndex < 0) {
        this.animation = undefined;
        this.sync(finalSnapshot);
        done();
        return;
      }
      const next = animation.frames[nextIndex];
      const previous = animation.frames[Math.max(0, nextIndex - 1)];
      const alpha =
        next.time === previous.time
          ? 1
          : (time - previous.time) / (next.time - previous.time);
      next.balls.forEach((ball, index) => {
        const before = previous.balls[index];
        const mesh = this.ballMeshes[ball.id];
        if (!mesh || !before) return;
        mesh.visible = ball.state !== "InPocket";
        mesh.position.set(
          before.pos[0] + (ball.pos[0] - before.pos[0]) * alpha,
          before.pos[1] + (ball.pos[1] - before.pos[1]) * alpha,
          before.pos[2] +
            (ball.pos[2] - before.pos[2]) * alpha +
            tableDimensions().ballRadius,
        );
        mesh.rotation.x += 0.04;
        mesh.rotation.y += 0.025;
      });
      this.platform.requestAnimationFrame(tick);
    };
    tick();
  }

  cancelAnimation() {
    this.animation = undefined;
    if (this.snapshot) this.sync(this.snapshot);
  }

  screenToTable(x: number, y: number): { x: number; y: number } {
    const rect = this.platform.canvas.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: this.platform.width,
      height: this.platform.height,
    };
    const pointer = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      target,
    );
    return { x: target.x, y: target.y };
  }

  render() {
    this.renderer.autoClear = false;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  private buildLights() {
    const ambient = new THREE.HemisphereLight(0xe8fff4, 0x13241d, 1.8);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-1.5, -1, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8d8ff, 1.2);
    fill.position.set(2, 1, 2);
    this.scene.add(fill);
  }

  private buildTable() {
    this.tableGroup.clear();
    const d = tableDimensions();
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(
        d.outerHalfWidth * 2,
        d.outerHalfHeight * 2,
        d.ballRadius * 0.45,
      ),
      new THREE.MeshStandardMaterial({
        color: 0x087552,
        roughness: 0.9,
        metalness: 0,
      }),
    );
    cloth.position.z = -d.ballRadius * 0.25;
    cloth.receiveShadow = true;
    this.tableGroup.add(cloth);
    const wood = new THREE.MeshStandardMaterial({
      color: 0x4c2415,
      roughness: 0.42,
      metalness: 0.08,
    });
    const railHeight = d.ballRadius * 1.1;
    const railWidth = d.ballRadius * 2.8;
    const horizontal = new THREE.BoxGeometry(
      d.outerHalfWidth * 2 + railWidth * 2,
      railWidth,
      railHeight,
    );
    const vertical = new THREE.BoxGeometry(
      railWidth,
      d.outerHalfHeight * 2,
      railHeight,
    );
    [-1, 1].forEach((side) => {
      const top = new THREE.Mesh(horizontal, wood);
      top.position.set(
        0,
        side * (d.outerHalfHeight + railWidth / 2),
        railHeight / 2,
      );
      this.tableGroup.add(top);
      const end = new THREE.Mesh(vertical, wood);
      end.position.set(
        side * (d.outerHalfWidth + railWidth / 2),
        0,
        railHeight / 2,
      );
      this.tableGroup.add(end);
    });
    const pocketMaterial = new THREE.MeshStandardMaterial({
      color: 0x010303,
      roughness: 1,
    });
    const pocketRadius = d.ballRadius * 1.75;
    const pockets = [
      [-d.outerHalfWidth, -d.outerHalfHeight],
      [0, -d.outerHalfHeight],
      [d.outerHalfWidth, -d.outerHalfHeight],
      [-d.outerHalfWidth, d.outerHalfHeight],
      [0, d.outerHalfHeight],
      [d.outerHalfWidth, d.outerHalfHeight],
    ];
    pockets.forEach(([x, y]) => {
      const pocket = new THREE.Mesh(
        new THREE.CylinderGeometry(
          pocketRadius,
          pocketRadius * 0.85,
          0.035,
          32,
        ),
        pocketMaterial,
      );
      pocket.rotation.x = Math.PI / 2;
      pocket.position.set(x, y, 0.005);
      this.tableGroup.add(pocket);
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x071c18, roughness: 1 }),
    );
    floor.position.z = -0.16;
    floor.receiveShadow = true;
    this.tableGroup.add(floor);
  }

  private buildCue() {
    this.cueGroup.clear();
    const d = tableDimensions();
    const length = d.halfWidth * 1.1;
    const cue = new THREE.Mesh(
      new THREE.CylinderGeometry(
        d.ballRadius * 0.11,
        d.ballRadius * 0.26,
        length,
        16,
      ),
      new THREE.MeshStandardMaterial({ color: 0xb9884d, roughness: 0.38 }),
    );
    cue.rotation.z = Math.PI / 2;
    cue.position.x = -length / 2 - d.ballRadius * 1.6;
    this.cueGroup.add(cue);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(
        d.ballRadius * 0.115,
        d.ballRadius * 0.115,
        d.ballRadius * 0.35,
        16,
      ),
      new THREE.MeshStandardMaterial({ color: 0x326c86, roughness: 0.7 }),
    );
    tip.rotation.z = Math.PI / 2;
    tip.position.x = -d.ballRadius * 1.55;
    this.cueGroup.add(tip);
  }

  private rebuildBalls(snapshot: MatchSnapshot) {
    this.ballMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((material) => {
        const map = (material as THREE.MeshStandardMaterial).map;
        map?.dispose();
        material.dispose();
      });
    });
    this.ballMeshes.length = 0;
    const radius = tableDimensions().ballRadius;
    snapshot.balls.forEach((ball) => {
      const texture = this.createBallTexture(ball, snapshot.gameType);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 32, 24),
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.22,
          metalness: 0.02,
        }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.ballMeshes[ball.id] = mesh;
      this.scene.add(mesh);
    });
    this.buildTable();
  }

  private createBallTexture(ball: BallSnapshot, gameType: string) {
    const canvas = this.platform.createCanvas(256, 128);
    const context = canvas.getContext("2d");
    const colour = ballColour(ball, gameType);
    const striped = gameType !== "snooker" && (ball.label ?? 0) >= 9;
    context.fillStyle = striped ? "#f4f1df" : colour;
    context.fillRect(0, 0, 256, 128);
    if (striped) {
      context.fillStyle = colour;
      context.fillRect(0, 32, 256, 64);
    }
    if (gameType !== "snooker" && ball.id !== 0) {
      [64, 192].forEach((x) => {
        context.fillStyle = "#f8f6e9";
        context.beginPath();
        context.arc(x, 64, 22, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#141719";
        context.font = "bold 28px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(ball.label), x, 65);
      });
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private updateBall(ball: BallSnapshot) {
    const mesh = this.ballMeshes[ball.id];
    if (!mesh) return;
    mesh.visible = ball.state !== "InPocket";
    mesh.position.set(
      ball.pos[0],
      ball.pos[1],
      ball.pos[2] + tableDimensions().ballRadius,
    );
  }

  private updateAim() {
    if (!this.snapshot || this.snapshot.phase !== "aiming" || this.animation) {
      this.aimLine.visible = false;
      this.cueGroup.visible = false;
      return;
    }
    const cue = this.snapshot.balls[0];
    const d = tableDimensions();
    const direction = new THREE.Vector3(
      Math.cos(this.angle),
      Math.sin(this.angle),
      0,
    );
    const start = new THREE.Vector3(
      cue.pos[0],
      cue.pos[1],
      d.ballRadius * 1.05,
    );
    let distance = 6;
    for (const ball of this.snapshot.balls) {
      if (ball.id === 0 || ball.state === "InPocket") continue;
      const relative = new THREE.Vector3(ball.pos[0], ball.pos[1], start.z).sub(
        start,
      );
      const projection = relative.dot(direction);
      if (projection <= 0) continue;
      const perpendicular = relative
        .clone()
        .addScaledVector(direction, -projection)
        .length();
      if (perpendicular <= d.ballRadius * 2)
        distance = Math.min(distance, projection);
    }
    const end = start.clone().addScaledVector(direction, distance);
    this.aimGeometry.setFromPoints([start, end]);
    this.aimGeometry.computeBoundingSphere();
    this.aimLine.visible = true;
    this.cueGroup.visible = true;
    this.cueGroup.position.copy(start);
    this.cueGroup.rotation.z = this.angle;
    this.cueGroup.position.addScaledVector(direction, -0.02 * this.power);
  }

  private updateCamera() {
    const aspectCompensation = Math.max(
      1,
      1.35 / Math.max(0.5, this.camera.aspect),
    );
    if (this.topView) {
      const dimensions = tableDimensions();
      const halfFovTangent = Math.tan(
        THREE.MathUtils.degToRad(this.camera.fov / 2),
      );
      const fitHeight = dimensions.outerHalfHeight / halfFovTangent;
      const fitWidth =
        dimensions.outerHalfWidth /
        (halfFovTangent * this.camera.aspect);
      const distance = Math.max(fitHeight, fitWidth) * 1.25;
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(0, 0, distance);
      this.camera.lookAt(0, 0, 0);
    } else {
      this.camera.up.set(0, 0, 1);
      this.camera.position.set(
        0,
        -2.65 * aspectCompensation,
        2.65 * aspectCompensation,
      );
      this.camera.lookAt(0, 0.08, 0);
    }
    this.camera.updateProjectionMatrix();
    this.updateAim();
  }
}
