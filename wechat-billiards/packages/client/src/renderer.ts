import * as THREE from "three";
import type {
  BallSnapshot,
  MatchSnapshot,
  ShotFrame,
} from "@friend-billiards/core";
import { tableDimensions } from "@friend-billiards/core";
import { Rack } from "../../../third_party/billiards/src/utils/rack";
import type { ClientPlatform } from "./platform";
import {
  predictFirstBall,
  predictionLengthForLevel,
  predictionSegments,
  type Point2,
} from "./prediction";

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
  private readonly predictionNormalGeometry = new THREE.BufferGeometry();
  private readonly predictionTangentGeometry = new THREE.BufferGeometry();
  private readonly predictionNormalLine: THREE.Line;
  private readonly predictionTangentLine: THREE.Line;
  private predictionLevel = 0;
  private predictionDebug: {
    normal: [Point2, Point2] | null;
    tangent: Point2[] | null;
  } = { normal: null, tangent: null };
  private snapshot?: MatchSnapshot;
  private angle = 0;
  private power = 0.5;
  private spinX = 0;
  private spinY = 0;
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
    this.predictionNormalLine = new THREE.Line(
      this.predictionNormalGeometry,
      new THREE.LineBasicMaterial({
        color: 0xffc766,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.predictionTangentLine = new THREE.Line(
      this.predictionTangentGeometry,
      new THREE.LineBasicMaterial({
        color: 0x86e5ff,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.predictionNormalLine.visible = false;
    this.predictionTangentLine.visible = false;
    this.scene.add(this.predictionNormalLine, this.predictionTangentLine);
    this.buildLights();
    this.buildTable();
    this.buildCue();
    this.resize();
  }

  resize() {
    const { width, height, pixelRatio } = this.platform;
    this.renderer.setPixelRatio(Math.min(pixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.updateCamera();
  }

  setTopView(value: boolean) {
    this.topView = value;
    this.updateCamera();
  }

  private tableViewport() {
    const { width, height } = this.platform;
    if (!this.topView) return { x: 0, y: 0, width, height };
    const left = (width * 120) / 1280;
    const right = (width * 120) / 1280;
    const top = (height * 84) / 720;
    const bottom = (height * 50) / 720;
    return {
      x: left,
      y: top,
      width: Math.max(1, width - left - right),
      height: Math.max(1, height - top - bottom),
    };
  }

  toggleCamera() {
    this.setTopView(!this.topView);
  }

  setAim(angle: number, power: number, spinX = 0, spinY = 0) {
    this.angle = angle;
    this.power = power;
    this.spinX = spinX;
    this.spinY = spinY;
    this.updateAim();
  }

  setPredictionLevel(level: number) {
    this.predictionLevel = Math.max(0, Math.min(5, Math.floor(level) || 0));
    this.updateAim();
  }

  predictionSegments() {
    return {
      level: this.predictionLevel,
      normal: this.predictionDebug.normal,
      tangent: this.predictionDebug.tangent,
    };
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
    this.hidePrediction();
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
        const x = before.pos[0] + (ball.pos[0] - before.pos[0]) * alpha;
        const y = before.pos[1] + (ball.pos[1] - before.pos[1]) * alpha;
        const z =
          before.pos[2] +
          (ball.pos[2] - before.pos[2]) * alpha +
          tableDimensions().ballRadius;
        const dx = x - mesh.position.x;
        const dy = y - mesh.position.y;
        const distance = Math.hypot(dx, dy);
        mesh.position.set(x, y, z);
        if (distance > 0.0000001 && ball.state !== "InPocket") {
          const axis = new THREE.Vector3(-dy, dx, 0).normalize();
          mesh.rotateOnWorldAxis(
            axis,
            distance / tableDimensions().ballRadius,
          );
        }
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
    const viewport = this.tableViewport();
    const canvasX =
      ((x - rect.left) * this.platform.width) / Math.max(1, rect.width);
    const canvasY =
      ((y - rect.top) * this.platform.height) / Math.max(1, rect.height);
    const pointer = new THREE.Vector2(
      ((canvasX - viewport.x) / viewport.width) * 2 - 1,
      -((canvasY - viewport.y) / viewport.height) * 2 + 1,
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
    const { width, height } = this.platform;
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.clear();
    if (this.topView) {
      const viewport = this.tableViewport();
      const bottom = height - viewport.y - viewport.height;
      this.renderer.setViewport(
        viewport.x,
        bottom,
        viewport.width,
        viewport.height,
      );
      this.renderer.setScissor(viewport.x, bottom, viewport.width, viewport.height);
      this.renderer.setScissorTest(true);
    }
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
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
    const pocketRadius = d.ballRadius * 1.75;
    const pockets = [
      [-d.outerHalfWidth, -d.outerHalfHeight],
      [0, -d.outerHalfHeight],
      [d.outerHalfWidth, -d.outerHalfHeight],
      [-d.outerHalfWidth, d.outerHalfHeight],
      [0, d.outerHalfHeight],
      [d.outerHalfWidth, d.outerHalfHeight],
    ];
    const clothShape = new THREE.Shape();
    clothShape.moveTo(-d.outerHalfWidth, -d.outerHalfHeight);
    clothShape.lineTo(d.outerHalfWidth, -d.outerHalfHeight);
    clothShape.lineTo(d.outerHalfWidth, d.outerHalfHeight);
    clothShape.lineTo(-d.outerHalfWidth, d.outerHalfHeight);
    clothShape.closePath();
    pockets.forEach(([x, y]) => {
      const hole = new THREE.Path();
      hole.absarc(x, y, pocketRadius, 0, Math.PI * 2, true);
      clothShape.holes.push(hole);
    });
    const clothDepth = d.ballRadius * 0.45;
    const cloth = new THREE.Mesh(
      new THREE.ExtrudeGeometry(clothShape, {
        depth: clothDepth,
        bevelEnabled: false,
        curveSegments: 32,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x087552,
        roughness: 0.9,
        metalness: 0,
      }),
    );
    cloth.position.z = -clothDepth;
    cloth.receiveShadow = true;
    this.tableGroup.add(cloth);

    const pocketMaterial = new THREE.MeshStandardMaterial({
      color: 0x010303,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const cupDepth = d.ballRadius * 3.2;
    pockets.forEach(([x, y]) => {
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(
          pocketRadius * 0.98,
          pocketRadius * 0.76,
          cupDepth,
          40,
          1,
          true,
        ),
        pocketMaterial,
      );
      cup.rotation.x = Math.PI / 2;
      cup.position.set(x, y, -cupDepth / 2);
      cup.receiveShadow = true;
      this.tableGroup.add(cup);
      const bottom = new THREE.Mesh(
        new THREE.CircleGeometry(pocketRadius * 0.77, 40),
        pocketMaterial,
      );
      bottom.position.set(x, y, -cupDepth);
      this.tableGroup.add(bottom);
    });
    this.buildSnookerMarkings();

    const wood = new THREE.MeshStandardMaterial({
      color: 0x4c2415,
      roughness: 0.42,
      metalness: 0.08,
    });
    const cushion = new THREE.MeshStandardMaterial({
      color: 0x075c41,
      roughness: 0.78,
    });
    const railHeight = d.ballRadius * 1.1;
    const railWidth = d.ballRadius * 2.8;
    const cushionWidth = railWidth * 0.32;
    const cornerGap = pocketRadius * 1.03;
    const sideGap = pocketRadius * 0.9;
    const horizontalLength = d.outerHalfWidth - cornerGap - sideGap;
    const horizontalCenter = (d.outerHalfWidth - cornerGap + sideGap) / 2;
    const verticalLength = (d.outerHalfHeight - cornerGap) * 2;
    const horizontalRail = new THREE.BoxGeometry(
      horizontalLength,
      railWidth,
      railHeight,
    );
    const horizontalCushion = new THREE.BoxGeometry(
      horizontalLength,
      cushionWidth,
      railHeight * 0.72,
    );
    const verticalRail = new THREE.BoxGeometry(
      railWidth,
      verticalLength,
      railHeight,
    );
    const verticalCushion = new THREE.BoxGeometry(
      cushionWidth,
      verticalLength,
      railHeight * 0.72,
    );
    const jawGeometry = new THREE.SphereGeometry(
      pocketRadius * 0.34,
      20,
      12,
    );

    [-1, 1].forEach((side) => {
      [-1, 1].forEach((segment) => {
        const x = segment * horizontalCenter;
        const y = side * (d.outerHalfHeight + railWidth / 2);
        const rail = new THREE.Mesh(horizontalRail, wood);
        rail.position.set(x, y, railHeight / 2);
        rail.castShadow = true;
        rail.receiveShadow = true;
        this.tableGroup.add(rail);
        const rubber = new THREE.Mesh(horizontalCushion, cushion);
        rubber.position.set(
          x,
          side * (d.outerHalfHeight - cushionWidth * 0.15),
          railHeight * 0.4,
        );
        rubber.receiveShadow = true;
        this.tableGroup.add(rubber);
        [-1, 1].forEach((end) => {
          const jaw = new THREE.Mesh(jawGeometry, cushion);
          jaw.scale.set(1.35, 0.8, 0.72);
          jaw.position.set(
            x + end * horizontalLength / 2,
            side * (d.outerHalfHeight - cushionWidth * 0.1),
            railHeight * 0.4,
          );
          jaw.castShadow = true;
          this.tableGroup.add(jaw);
        });
      });

      const endRail = new THREE.Mesh(verticalRail, wood);
      endRail.position.set(
        side * (d.outerHalfWidth + railWidth / 2),
        0,
        railHeight / 2,
      );
      endRail.castShadow = true;
      endRail.receiveShadow = true;
      this.tableGroup.add(endRail);
      const endCushion = new THREE.Mesh(verticalCushion, cushion);
      endCushion.position.set(
        side * (d.outerHalfWidth - cushionWidth * 0.15),
        0,
        railHeight * 0.4,
      );
      endCushion.receiveShadow = true;
      this.tableGroup.add(endCushion);
      [-1, 1].forEach((end) => {
        const jaw = new THREE.Mesh(jawGeometry, cushion);
        jaw.scale.set(0.8, 1.35, 0.72);
        jaw.position.set(
          side * (d.outerHalfWidth - cushionWidth * 0.1),
          end * verticalLength / 2,
          railHeight * 0.4,
        );
        jaw.castShadow = true;
        this.tableGroup.add(jaw);
      });
    });

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x071c18, roughness: 1 }),
    );
    floor.position.z = -0.16;
    floor.receiveShadow = true;
    this.tableGroup.add(floor);
  }

  private buildSnookerMarkings() {
    if (this.currentGameType !== "snooker") return;
    const d = tableDimensions();
    const height = d.ballRadius * 0.06;
    const material = new THREE.LineBasicMaterial({
      color: 0xd9eadf,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const baulk = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(Rack.baulk, -d.halfHeight, height),
        new THREE.Vector3(Rack.baulk, d.halfHeight, height),
      ]),
      material,
    );
    this.tableGroup.add(baulk);

    const arc: THREE.Vector3[] = [];
    for (let index = 0; index <= 48; index += 1) {
      const angle = Math.PI / 2 + (index / 48) * Math.PI;
      arc.push(
        new THREE.Vector3(
          Rack.baulk + Math.cos(angle) * Rack.sixth,
          Math.sin(angle) * Rack.sixth,
          height,
        ),
      );
    }
    this.tableGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), material),
    );

    const spotMaterial = new THREE.MeshBasicMaterial({
      color: 0xd9eadf,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    Rack.snookerColourPositions().forEach((position) => {
      const spot = new THREE.Mesh(
        new THREE.CircleGeometry(d.ballRadius * 0.16, 16),
        spotMaterial,
      );
      spot.position.set(position.x, position.y, height);
      this.tableGroup.add(spot);
    });
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
      this.hidePrediction();
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
    this.updatePrediction(
      { x: cue.pos[0], y: cue.pos[1] },
      { x: direction.x, y: direction.y },
      start.z,
      d,
    );
  }

  private updatePrediction(
    cue: Point2,
    direction: Point2,
    height: number,
    dimensions: ReturnType<typeof tableDimensions>,
  ) {
    const length = predictionLengthForLevel(
      this.predictionLevel,
      dimensions.outerHalfWidth,
      this.power,
    );
    const prediction = this.snapshot
      ? predictFirstBall(
          cue,
          direction,
          this.snapshot.balls,
          dimensions.ballRadius,
          length,
        )
      : null;
    if (!prediction) {
      this.hidePrediction();
      return;
    }
    const segments = predictionSegments(prediction, length, {
      power: this.power,
      spinX: this.spinX,
      spinY: this.spinY,
    });
    const toPoint = (point: Point2) =>
      new THREE.Vector3(point.x, point.y, height);
    this.predictionNormalGeometry.setFromPoints([
      toPoint(segments.normal[0]),
      toPoint(segments.normal[1]),
    ]);
    this.predictionNormalGeometry.computeBoundingSphere();
    this.predictionNormalLine.visible = true;
    if (segments.tangent) {
      const points = segments.tangent.map(toPoint);
      if (points.length > 2) {
        const start = points[0];
        const initial = points[1].clone().sub(start).normalize();
        const control = start.clone().addScaledVector(initial, length * 0.35);
        const curve = new THREE.QuadraticBezierCurve3(
          start,
          control,
          points.at(-1)!,
        );
        this.predictionTangentGeometry.setFromPoints(curve.getPoints(32));
      } else {
        this.predictionTangentGeometry.setFromPoints(points);
      }
      this.predictionTangentGeometry.computeBoundingSphere();
      this.predictionTangentLine.visible = true;
    } else {
      this.predictionTangentLine.visible = false;
    }
    this.predictionDebug = segments;
  }

  private hidePrediction() {
    this.predictionNormalLine.visible = false;
    this.predictionTangentLine.visible = false;
    this.predictionDebug = { normal: null, tangent: null };
  }

  private updateCamera() {
    const viewport = this.tableViewport();
    this.camera.aspect = viewport.width / Math.max(1, viewport.height);
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
      const distance = Math.max(fitHeight, fitWidth) * 1.06;
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(0, 0, distance);
      this.camera.lookAt(0, 0, 0);
    } else {
      this.camera.up.set(0, 0, 1);
      this.camera.position.set(
        0,
        -2.15 * aspectCompensation,
        2.15 * aspectCompensation,
      );
      this.camera.lookAt(0, 0.08, 0);
    }
    this.camera.updateProjectionMatrix();
    this.updateAim();
  }
}
