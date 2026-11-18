import * as THREE from "three";
import type {
  BallSnapshot,
  MatchSnapshot,
  PhysicsEvent,
  ShotFrame,
} from "@friend-billiards/core";
import { tableDimensions } from "@friend-billiards/core";
import { Rack } from "../../../third_party/billiards/src/utils/rack";
import { PocketGeometry } from "../../../third_party/billiards/src/view/pocketgeometry";
import type { ClientPlatform } from "./platform";
import {
  computeLayout,
  homeVisualViewport,
  roomTableViewport,
  tableViewport as designTableViewport,
  type Layout,
  type Rect,
} from "./ui/layout";
import type { CameraMode, QualityTier } from "./ui/model";
import {
  DEFAULT_PLAYBACK_SPEED,
  playbackDuration,
} from "./playback";
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

export type Presentation = "home" | "room" | "game" | "hidden";

interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  widthSegments: number;
  heightSegments: number;
}

const qualitySettings: Record<QualityTier, QualitySettings> = {
  high: {
    pixelRatio: 2,
    shadows: true,
    shadowSize: 2048,
    widthSegments: 32,
    heightSegments: 24,
  },
  medium: {
    pixelRatio: 1.5,
    shadows: true,
    shadowSize: 1024,
    widthSegments: 24,
    heightSegments: 18,
  },
  low: {
    pixelRatio: 1.25,
    shadows: false,
    shadowSize: 512,
    widthSegments: 16,
    heightSegments: 12,
  },
};

interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
}

interface CameraTransition {
  from: CameraPose;
  started: number;
  duration: number;
}

function ballColour(ball: BallSnapshot, gameType: string): string {
  if (gameType === "snooker")
    return ball.id >= 7 ? "#c62929" : (snookerColours[ball.id] ?? "#ffffff");
  return poolColours[ball.label ?? 0] ?? "#ffffff";
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function easeInOut(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export class TableRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly topCamera: THREE.OrthographicCamera;
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly ballShadows: THREE.Mesh[] = [];
  private readonly tableGroup = new THREE.Group();
  private readonly cueGroup = new THREE.Group();
  private readonly aimGeometry = new THREE.BufferGeometry();
  private readonly aimLine: THREE.Line;
  private readonly predictionNormalGeometry = new THREE.BufferGeometry();
  private readonly predictionTangentGeometry = new THREE.BufferGeometry();
  private readonly predictionNormalLine: THREE.Line;
  private readonly predictionTangentLine: THREE.Line;
  private readonly ghostBall: THREE.Mesh;
  private readonly targetRing: THREE.Mesh;
  private readonly ballTextureCache = new Map<string, THREE.CanvasTexture>();
  private readonly envMap: THREE.Texture;
  private readonly shadowTexture: THREE.CanvasTexture;
  private readonly spotLight: THREE.SpotLight;
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
  private topView = true;
  private cameraMode: CameraMode = "top";
  private displayMode: CameraMode = "top";
  private presentation: Presentation = "hidden";
  private quality: QualityTier;
  private layout: Layout;
  private reduceMotion = false;
  private animation?: {
    frames: ShotFrame[];
    started: number;
    duration: number;
    finalSnapshot: MatchSnapshot;
    done: () => void;
  };
  private currentGameType = "eightball";
  private dirty = true;
  private cameraTransition?: CameraTransition;
  private smoothedPosition = new THREE.Vector3();
  private smoothedTarget = new THREE.Vector3();
  private smoothedQuaternion = new THREE.Quaternion();
  private hasSmoothed = false;
  private followKickStarted = 0;
  private followKickUntil = 0;
  private lastCameraUpdate = now();
  private readonly potStarted = new Map<number, number>();
  private ballGeometry?: THREE.SphereGeometry;
  private readonly environmentGroup = new THREE.Group();

  constructor(
    private readonly platform: ClientPlatform,
    options: { quality?: QualityTier } = {},
  ) {
    this.quality = options.quality ?? "medium";
    this.layout = computeLayout(
      platform.width,
      platform.height,
      platform.pixelRatio,
      platform.safeArea,
      platform.menuButton,
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas: platform.canvas,
      antialias: this.quality !== "low",
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x22372f, 1);
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.01, 100);
    this.camera.up.set(0, 0, 1);
    this.topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    this.topCamera.up.set(0, 1, 0);
    this.envMap = this.buildEnvironment();
    this.shadowTexture = this.buildShadowTexture();
    this.scene.add(this.tableGroup, this.cueGroup);
    this.aimLine = new THREE.Line(
      this.aimGeometry,
      new THREE.LineBasicMaterial({
        color: 0xf6f0df,
        transparent: true,
        opacity: 0.6,
      }),
    );
    this.scene.add(this.aimLine);
    const predictionMaterial = (color: number) =>
      new THREE.LineBasicMaterial({
        color,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    this.predictionNormalLine = new THREE.Line(
      this.predictionNormalGeometry,
      predictionMaterial(0xe4c07a),
    );
    this.predictionTangentLine = new THREE.Line(
      this.predictionTangentGeometry,
      predictionMaterial(0x86e5ff),
    );
    this.predictionNormalLine.visible = false;
    this.predictionTangentLine.visible = false;
    this.scene.add(this.predictionNormalLine, this.predictionTangentLine);
    this.ghostBall = new THREE.Mesh(
      new THREE.RingGeometry(
        tableDimensions().ballRadius * 0.92,
        tableDimensions().ballRadius * 1.08,
        32,
      ),
      new THREE.MeshBasicMaterial({
        color: 0xe4c07a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.ghostBall.visible = false;
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(
        tableDimensions().ballRadius * 1.12,
        tableDimensions().ballRadius * 1.23,
        40,
      ),
      new THREE.MeshBasicMaterial({
        color: 0xe4c07a,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.targetRing.visible = false;
    this.scene.add(this.ghostBall, this.targetRing);
    this.spotLight = this.buildLights();
    this.buildTable();
    this.buildCue();
    this.buildRoom();
    this.applyQuality();
    this.setPresentation("home");
    this.resize();
  }

  get topViewValue() {
    return this.cameraMode === "top";
  }

  get cameraMoving() {
    return Boolean(this.cameraTransition);
  }

  resize() {
    this.layout = computeLayout(
      this.platform.width,
      this.platform.height,
      this.platform.pixelRatio,
      this.platform.safeArea,
      this.platform.menuButton,
    );
    this.renderer.setPixelRatio(this.effectivePixelRatio());
    this.renderer.setSize(this.platform.width, this.platform.height, false);
    this.updateCamera(true);
    this.requestRender();
  }

  setQuality(tier: QualityTier) {
    if (this.quality === tier) return;
    this.quality = tier;
    this.applyQuality();
    if (this.snapshot) this.rebuildBalls(this.snapshot);
    this.resize();
  }

  setReduceMotion(value: boolean) {
    this.reduceMotion = value;
    this.requestRender();
  }

  setPresentation(presentation: Presentation) {
    if (this.presentation === presentation) return;
    this.presentation = presentation;
    this.environmentGroup.visible =
      presentation !== "room" && presentation !== "hidden";
    this.cameraTransition = undefined;
    this.hasSmoothed = false;
    this.requestRender();
  }

  setCameraMode(mode: CameraMode) {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    this.topView = mode === "top";
    this.startCameraTransition();
    this.requestRender();
  }

  setTopView(value: boolean) {
    this.setCameraMode(value ? "top" : "overview");
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
    this.requestRender();
  }

  previewCueBall(x: number, y: number, legal: boolean) {
    const mesh = this.ballMeshes[0];
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(x, y, tableDimensions().ballRadius);
    const material = mesh.material as THREE.MeshPhysicalMaterial;
    material.color.set(legal ? 0xffffff : 0xff6b5a);
    const shadow = this.ballShadows[0];
    if (shadow) {
      shadow.visible = true;
      shadow.position.set(x, y, 0.0015);
    }
    this.requestRender();
  }

  animate(
    frames: ShotFrame[],
    finalSnapshot: MatchSnapshot,
    speed = DEFAULT_PLAYBACK_SPEED,
    done: () => void,
  ) {
    const started = now();
    const duration = playbackDuration(frames.at(-1)?.time ?? 500, speed);
    this.animation = {
      frames,
      started,
      duration,
      finalSnapshot,
      done,
    };
    this.followKickStarted = started;
    this.followKickUntil = started + duration + 400;
    this.aimLine.visible = false;
    this.cueGroup.visible = false;
    this.hidePrediction();
    const finish = () => {
      const animation = this.animation;
      if (!animation) return;
      this.animation = undefined;
      this.sync(animation.finalSnapshot);
      animation.done();
    };
    const tick = () => {
      const animation = this.animation;
      if (!animation) return;
      const elapsed = now() - animation.started;
      if (elapsed >= animation.duration) {
        finish();
        return;
      }
      const time =
        ((elapsed / 1000) * (animation.frames.at(-1)?.time ?? 1)) /
        (animation.duration / 1000);
      const nextIndex = animation.frames.findIndex(
        (frame) => frame.time >= time,
      );
      if (nextIndex < 0) {
        finish();
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
        const x = before.pos[0] + (ball.pos[0] - before.pos[0]) * alpha;
        const y = before.pos[1] + (ball.pos[1] - before.pos[1]) * alpha;
        const z =
          before.pos[2] +
          (ball.pos[2] - before.pos[2]) * alpha +
          tableDimensions().ballRadius;
        if (ball.state === "InPocket") {
          const started = this.potStarted.get(ball.id) ?? now();
          this.potStarted.set(ball.id, started);
          const progress = Math.min(1, (now() - started) / 220);
          mesh.visible = progress < 1;
          mesh.scale.setScalar(1 - progress * 0.4);
          const material = mesh.material as THREE.MeshPhysicalMaterial;
          material.transparent = true;
          material.opacity = 1 - progress;
          const shadow = this.ballShadows[ball.id];
          if (shadow) shadow.visible = false;
        } else {
          this.potStarted.delete(ball.id);
          mesh.visible = true;
          mesh.scale.setScalar(1);
          const material = mesh.material as THREE.MeshPhysicalMaterial;
          material.opacity = 1;
          const shadow = this.ballShadows[ball.id];
          if (shadow) {
            shadow.visible = true;
            shadow.position.set(x, y, 0.0015);
          }
        }
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
      this.requestRender();
      this.platform.requestAnimationFrame(tick);
    };
    tick();
  }

  isAnimating() {
    return Boolean(this.animation);
  }

  skipAnimation() {
    const animation = this.animation;
    if (!animation) return;
    this.animation = undefined;
    this.sync(animation.finalSnapshot);
    animation.done();
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
    const canvasX =
      ((x - rect.left) * this.platform.width) / Math.max(1, rect.width);
    const canvasY =
      ((y - rect.top) * this.platform.height) / Math.max(1, rect.height);
    const viewport = this.viewportScreen();
    const pointer = new THREE.Vector2(
      ((canvasX - viewport.x) / viewport.width) * 2 - 1,
      -((canvasY - viewport.y) / viewport.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.activeCamera());
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      target,
    );
    return { x: target.x, y: target.y };
  }

  tableViewport(): Rect {
    return designTableViewport(this.layout);
  }

  requestRender() {
    this.dirty = true;
  }

  render() {
    if (this.presentation === "hidden") return;
    this.updateCamera(false);
    if (this.targetRing.visible) {
      const pulse = (Math.sin((now() / 1200) * Math.PI * 2) + 1) / 2;
      this.targetRing.scale.setScalar(1 + pulse * 0.06);
      (this.targetRing.material as THREE.MeshBasicMaterial).opacity =
        0.6 + pulse * 0.3;
    }
    const viewport = this.viewportScreen();
    this.renderer.setClearColor(
      this.presentation === "room" ? 0x061a16 : 0x22372f,
      1,
    );
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(
      0,
      0,
      this.platform.width,
      this.platform.height,
    );
    this.renderer.clear();
    if (viewport.width > 1 && viewport.height > 1) {
      const bottom =
        this.platform.height - viewport.y - viewport.height;
      this.renderer.setViewport(
        viewport.x,
        bottom,
        viewport.width,
        viewport.height,
      );
      this.renderer.setScissor(
        viewport.x,
        bottom,
        viewport.width,
        viewport.height,
      );
      this.renderer.setScissorTest(true);
      this.renderer.render(this.scene, this.activeCamera());
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(
      0,
      0,
      this.platform.width,
      this.platform.height,
    );
    this.dirty = false;
  }

  private activeCamera(): THREE.Camera {
    if (this.presentation === "home" || this.presentation === "room")
      return this.camera;
    return this.cameraTransition || this.displayMode !== "top"
      ? this.camera
      : this.topCamera;
  }

  private effectivePixelRatio() {
    const limit = qualitySettings[this.quality].pixelRatio;
    return Math.min(this.platform.pixelRatio, limit);
  }

  private applyQuality() {
    const settings = qualitySettings[this.quality];
    this.renderer.setPixelRatio(this.effectivePixelRatio());
    this.renderer.shadowMap.enabled = settings.shadows;
    this.spotLight.castShadow = settings.shadows;
    if (this.spotLight.shadow.map) {
      this.spotLight.shadow.map.dispose();
      this.spotLight.shadow.map = null;
    }
    this.spotLight.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  }

  private buildEnvironment() {
    const canvas = this.platform.createCanvas(256, 128);
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, "#1b2b2a");
    gradient.addColorStop(0.45, "#0a1714");
    gradient.addColorStop(1, "#020605");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 128);
    context.fillStyle = "rgba(255, 231, 194, 0.9)";
    context.beginPath();
    context.arc(64, 34, 14, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(184, 216, 255, 0.35)";
    context.beginPath();
    context.arc(196, 52, 10, 0, Math.PI * 2);
    context.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    const generator = new THREE.PMREMGenerator(this.renderer);
    const environment = generator.fromEquirectangular(texture).texture;
    generator.dispose();
    texture.dispose();
    return environment;
  }

  private buildShadowTexture() {
    const canvas = this.platform.createCanvas(64, 64);
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.28)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private buildLights() {
    const ambient = new THREE.HemisphereLight(0xe8fff4, 0x13241d, 0.6);
    this.scene.add(ambient);
    const key = new THREE.SpotLight(0xffe7c2, 14, 0, 0.7, 0.4, 1);
    key.position.set(0, 0, 2.2);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 4;
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xb8d8ff, 0.8);
    fill.position.set(2, 1, 2);
    this.scene.add(fill);
    return key;
  }

  private buildTable() {
    this.disposeGroup(this.tableGroup);
    const d = tableDimensions();
    const pockets = PocketGeometry.pocketCenters.map((center) => ({
      x: center.pos.x,
      y: center.pos.y,
      radius: center.radius,
    }));
    const feltTexture = this.buildFeltTexture();
    const clothMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: feltTexture,
      bumpMap: feltTexture,
      bumpScale: 0.002,
      alphaMap: this.buildClothAlpha(pockets),
      alphaTest: 0.5,
      roughness: 0.82,
      sheen: 0.35,
      sheenColor: new THREE.Color(0x0f7a5a),
      metalness: 0,
    });
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(
        d.outerHalfWidth * 2,
        d.outerHalfHeight * 2,
      ),
      clothMaterial,
    );
    cloth.position.z = 0.001;
    cloth.receiveShadow = true;
    this.tableGroup.add(cloth);

    const frameWidth = d.outerHalfWidth + d.ballRadius * 3.2;
    const frameHeight = d.outerHalfHeight + d.ballRadius * 3.2;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(frameWidth * 2, frameHeight * 2, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0x4a2417,
        roughness: 0.35,
        metalness: 0.05,
      }),
    );
    frame.position.z = -0.09;
    frame.receiveShadow = true;
    this.tableGroup.add(frame);

    const legMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a1c12,
      roughness: 0.42,
    });
    const legGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.55);
    [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ].forEach(([sx, sy]) => {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      leg.position.set(
        sx * (frameWidth - 0.12),
        sy * (frameHeight - 0.12),
        -0.405,
      );
      leg.castShadow = true;
      this.tableGroup.add(leg);
    });

    const floorShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2.0),
      new THREE.MeshBasicMaterial({
        map: this.shadowTexture,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    floorShadow.position.z = -0.675;
    this.tableGroup.add(floorShadow);

    const pocketMaterial = new THREE.MeshStandardMaterial({
      color: 0x010303,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const cupDepth = d.ballRadius * 3.2;
    pockets.forEach(({ x, y, radius }) => {
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(
          radius * 0.98,
          radius * 0.76,
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
        new THREE.CircleGeometry(radius * 0.77, 40),
        pocketMaterial,
      );
      bottom.position.set(x, y, -cupDepth);
      this.tableGroup.add(bottom);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.96, d.ballRadius * 0.05, 8, 36),
        new THREE.MeshStandardMaterial({
          color: 0x1b120d,
          roughness: 0.5,
          metalness: 0.3,
        }),
      );
      ring.position.set(x, y, -d.ballRadius * 0.02);
      this.tableGroup.add(ring);
      const net = new THREE.Mesh(
        new THREE.ConeGeometry(radius * 0.94, cupDepth * 0.8, 20, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x050807,
          roughness: 1,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
        }),
      );
      net.rotation.x = Math.PI / 2;
      net.position.set(x, y, -cupDepth * 0.5);
      this.tableGroup.add(net);
    });

    const mouthMaterial = new THREE.MeshBasicMaterial({
      color: 0x010303,
      side: THREE.DoubleSide,
    });
    const rimMaterial = new THREE.MeshBasicMaterial({
      color: 0x1b120d,
      side: THREE.DoubleSide,
    });
    pockets.forEach(({ x, y, radius }) => {
      const mouth = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.92, 36),
        mouthMaterial,
      );
      mouth.position.set(x, y, 0.0035);
      this.tableGroup.add(mouth);
      if (Math.abs(x) < d.ballRadius) {
        const gap = new THREE.Mesh(
          new THREE.PlaneGeometry(radius * 2.04, d.ballRadius * 2.9),
          mouthMaterial,
        );
        gap.position.set(
          x,
          y + Math.sign(y) * d.ballRadius * 1.45,
          0.0038,
        );
        this.tableGroup.add(gap);
      }
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.92, radius * 1.03, 36),
        rimMaterial,
      );
      rim.position.set(x, y, 0.0045);
      this.tableGroup.add(rim);
    });
    this.buildSnookerMarkings();

    const wood = new THREE.MeshStandardMaterial({
      color: 0x5a3120,
      roughness: 0.35,
      metalness: 0.08,
    });
    const cushion = new THREE.MeshPhysicalMaterial({
      color: 0x075c41,
      roughness: 0.8,
      clearcoat: 0.12,
      clearcoatRoughness: 0.6,
    });
    const railHeight = d.ballRadius * 1.1;
    const railWidth = d.ballRadius * 2.8;
    const cushionWidth = railWidth * 0.32;
    const cornerGap = PocketGeometry.cornerRadius * 1.03;
    const sideGap = PocketGeometry.middleRadius * 0.9;
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
    const jawGeometry = new THREE.BoxGeometry(
      PocketGeometry.cornerRadius * 0.7,
      cushionWidth * 0.82,
      railHeight * 0.72,
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
          jaw.position.set(
            x + (end * horizontalLength) / 2,
            side * (d.outerHalfHeight - cushionWidth * 0.1),
            railHeight * 0.4,
          );
          jaw.rotation.z = (Math.PI / 4) * side * end;
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
        jaw.position.set(
          side * (d.outerHalfWidth - cushionWidth * 0.1),
          (end * verticalLength) / 2,
          railHeight * 0.4,
        );
        jaw.rotation.z = (Math.PI / 4) * side * end;
        jaw.castShadow = true;
        this.tableGroup.add(jaw);
      });
    });
    this.buildSights(railHeight, railWidth);
  }

  private buildRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 12),
      new THREE.MeshStandardMaterial({
        map: this.buildFloorTexture(),
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0,
        emissive: new THREE.Color(0x35220f),
        emissiveIntensity: 0.7,
      }),
    );
    floor.position.set(0, 0, -0.68);
    floor.receiveShadow = true;
    this.environmentGroup.add(floor);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 3.6),
      new THREE.MeshStandardMaterial({
        color: 0x355246,
        roughness: 0.92,
        metalness: 0,
        emissive: new THREE.Color(0x122019),
        emissiveIntensity: 0.6,
      }),
    );
    wall.rotation.x = Math.PI / 2;
    wall.position.set(0, 2.7, 1.1);
    wall.receiveShadow = true;
    this.environmentGroup.add(wall);

    const stripMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a2418,
      roughness: 0.55,
    });
    for (let x = -7.2; x <= 7.2; x += 1.2) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.04, 3.4),
        stripMaterial,
      );
      strip.position.set(x, 2.66, 1.1);
      this.environmentGroup.add(strip);
    }

    const lampMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      toneMapped: false,
    });
    [-3.2, 3.2].forEach((x) => {
      const lamp = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.2),
        lampMaterial,
      );
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(x, 2.62, 1.15);
      this.environmentGroup.add(lamp);
      const light = new THREE.PointLight(0xffd9a0, 1, 8, 2);
      light.position.set(x, 2.3, 1.4);
      this.environmentGroup.add(light);
    });

    this.scene.add(this.environmentGroup);
  }

  private buildFloorTexture() {
    const canvas = this.platform.createCanvas(256, 256);
    const context = canvas.getContext("2d");
    context.fillStyle = "#4a3325";
    context.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      context.fillStyle = y % 64 === 0 ? "#604334" : "#543a2a";
      context.fillRect(0, y, 256, 30);
      context.fillStyle = "#2c1c13";
      context.fillRect(0, y + 30, 256, 2);
    }
    for (let index = 0; index < 320; index += 1) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      context.fillStyle = `rgba(255, 226, 190, ${0.015 + Math.random() * 0.03})`;
      context.fillRect(x, y, 1 + Math.random() * 18, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 4);
    return texture;
  }

  private buildFeltTexture() {
    const canvas = this.platform.createCanvas(512, 512);
    const context = canvas.getContext("2d");
    context.fillStyle = "#0b5a43";
    context.fillRect(0, 0, 512, 512);
    const image = context.getImageData(0, 0, 512, 512);
    for (let index = 0; index < image.data.length; index += 4) {
      const noise = (Math.random() - 0.5) * 10;
      image.data[index] = Math.max(0, image.data[index] + noise);
      image.data[index + 1] = Math.max(0, image.data[index + 1] + noise);
      image.data[index + 2] = Math.max(0, image.data[index + 2] + noise);
    }
    context.putImageData(image, 0, 0);
    context.strokeStyle = "rgba(4, 52, 38, 0.22)";
    for (let y = 0; y < 512; y += 4) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(512, y + 0.5);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 8);
    return texture;
  }

  private buildClothAlpha(
    pockets: { x: number; y: number; radius: number }[],
  ) {
    const width = 1024;
    const height = 512;
    const canvas = this.platform.createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const d = tableDimensions();
    context.fillStyle = "#000000";
    pockets.forEach(({ x, y, radius }) => {
      const u = (x + d.outerHalfWidth) / (d.outerHalfWidth * 2);
      const v = (y + d.outerHalfHeight) / (d.outerHalfHeight * 2);
      context.beginPath();
      context.ellipse(
        u * width,
        (1 - v) * height,
        (radius / (d.outerHalfWidth * 2)) * width,
        (radius / (d.outerHalfHeight * 2)) * height,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = true;
    return texture;
  }

  private buildSights(railHeight: number, railWidth: number) {
    const d = tableDimensions();
    const material = new THREE.MeshBasicMaterial({
      color: 0xf6f0df,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(
      d.ballRadius * 0.16,
      d.ballRadius * 0.16,
    );
    const add = (x: number, y: number) => {
      const sight = new THREE.Mesh(geometry, material);
      sight.position.set(x, y, railHeight + 0.002);
      sight.rotation.z = Math.PI / 4;
      this.tableGroup.add(sight);
    };
    [-1, 1].forEach((side) => {
      [-0.5, -0.25, 0.25, 0.5].forEach((fraction) => {
        add(
          side * d.outerHalfWidth * fraction,
          side * (d.outerHalfHeight + railWidth * 0.5),
        );
      });
      add(
        side * (d.outerHalfWidth + railWidth * 0.5),
        side * d.outerHalfHeight * 0,
      );
    });
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
    this.disposeGroup(this.cueGroup);
    const d = tableDimensions();
    const length = 1.45;
    const shaft = new THREE.Group();
    shaft.position.x = -d.ballRadius * 1.5;
    shaft.rotation.y = 0.008;
    this.cueGroup.add(shaft);
    const cue = new THREE.Mesh(
      new THREE.CylinderGeometry(
        d.ballRadius * 0.09,
        d.ballRadius * 0.22,
        length,
        16,
      ),
      new THREE.MeshStandardMaterial({ color: 0xb9884d, roughness: 0.38 }),
    );
    cue.rotation.z = Math.PI / 2;
    cue.position.x = -length / 2;
    shaft.add(cue);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(
        d.ballRadius * 0.095,
        d.ballRadius * 0.095,
        d.ballRadius * 0.3,
        16,
      ),
      new THREE.MeshStandardMaterial({ color: 0x326c86, roughness: 0.7 }),
    );
    tip.rotation.z = Math.PI / 2;
    shaft.add(tip);
  }

  private rebuildBalls(snapshot: MatchSnapshot) {
    this.ballMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      const material = mesh.material as THREE.MeshPhysicalMaterial;
      material.dispose();
    });
    this.ballShadows.forEach((mesh) => {
      this.scene.remove(mesh);
      (mesh.material as THREE.MeshBasicMaterial).dispose();
    });
    this.ballMeshes.length = 0;
    this.ballShadows.length = 0;
    this.ballGeometry?.dispose();
    const d = tableDimensions();
    const settings = qualitySettings[this.quality];
    const geometry = new THREE.SphereGeometry(
      d.ballRadius,
      settings.widthSegments,
      settings.heightSegments,
    );
    this.ballGeometry = geometry;
    snapshot.balls.forEach((ball) => {
      const material = new THREE.MeshPhysicalMaterial({
        map: this.ballTexture(ball, snapshot.gameType),
        roughness: 0.18,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMap: this.envMap,
        envMapIntensity: 0.7,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.ballMeshes[ball.id] = mesh;
      this.scene.add(mesh);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(d.ballRadius * 2.8, d.ballRadius * 2.8),
        new THREE.MeshBasicMaterial({
          map: this.shadowTexture,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      );
      shadow.visible = false;
      this.ballShadows[ball.id] = shadow;
      this.scene.add(shadow);
    });
    this.buildTable();
  }

  private ballTexture(ball: BallSnapshot, gameType: string) {
    const key = `${gameType}:${ball.label ?? 0}:${ball.id >= 7 ? "red" : "normal"}`;
    const cached = this.ballTextureCache.get(key);
    if (cached) return cached;
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
    this.ballTextureCache.set(key, texture);
    return texture;
  }

  private updateBall(ball: BallSnapshot) {
    const mesh = this.ballMeshes[ball.id];
    if (!mesh) return;
    mesh.visible = ball.state !== "InPocket";
    mesh.scale.setScalar(1);
    const material = mesh.material as THREE.MeshPhysicalMaterial;
    material.opacity = 1;
    material.color.set(0xffffff);
    mesh.position.set(
      ball.pos[0],
      ball.pos[1],
      ball.pos[2] + tableDimensions().ballRadius,
    );
    const shadow = this.ballShadows[ball.id];
    if (shadow) {
      shadow.visible = ball.state !== "InPocket";
      shadow.position.set(ball.pos[0], ball.pos[1], 0.0015);
    }
  }

  private updateAim() {
    if (
      !this.snapshot ||
      this.snapshot.phase !== "aiming" ||
      this.animation ||
      this.presentation !== "game"
    ) {
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
    const boundaryDistances = [
      direction.x > 1e-6
        ? (d.halfWidth - d.ballRadius - start.x) / direction.x
        : direction.x < -1e-6
          ? (-d.halfWidth + d.ballRadius - start.x) / direction.x
          : Number.POSITIVE_INFINITY,
      direction.y > 1e-6
        ? (d.halfHeight - d.ballRadius - start.y) / direction.y
        : direction.y < -1e-6
          ? (-d.halfHeight + d.ballRadius - start.y) / direction.y
          : Number.POSITIVE_INFINITY,
    ].filter((value) => value > 0);
    distance = Math.min(distance, 6, ...boundaryDistances);
    const end = start.clone().addScaledVector(direction, distance);
    this.aimGeometry.setFromPoints([start, end]);
    this.aimGeometry.computeBoundingSphere();
    this.aimLine.visible = true;
    this.cueGroup.visible = true;
    this.cueGroup.position.copy(start);
    this.cueGroup.rotation.z = this.angle;
    const pullback = this.power * 0.12;
    this.cueGroup.position.addScaledVector(direction, -pullback);
    this.updatePrediction(
      { x: cue.pos[0], y: cue.pos[1] },
      { x: direction.x, y: direction.y },
      start.z,
      d,
    );
    this.requestRender();
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
    const segments = predictionSegments(
      prediction,
      length,
      {
        power: this.power,
        spinX: this.spinX,
        spinY: this.spinY,
      },
      { halfWidth: dimensions.halfWidth, halfHeight: dimensions.halfHeight },
    );
    const toPoint = (point: Point2) =>
      new THREE.Vector3(point.x, point.y, height);
    this.predictionNormalGeometry.setFromPoints([
      toPoint(segments.normal[0]),
      toPoint(segments.normal[1]),
    ]);
    this.fadePredictionLine(this.predictionNormalGeometry, 0xe4c07a);
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
      this.fadePredictionLine(this.predictionTangentGeometry, 0x86e5ff);
      this.predictionTangentGeometry.computeBoundingSphere();
      this.predictionTangentLine.visible = true;
    } else {
      this.predictionTangentLine.visible = false;
    }
    this.ghostBall.visible = true;
    this.ghostBall.position.set(
      prediction.contact.x,
      prediction.contact.y,
      height,
    );
    this.targetRing.visible = true;
    this.targetRing.position.set(
      prediction.objectCenter.x,
      prediction.objectCenter.y,
      height,
    );
    this.predictionDebug = segments;
  }

  /**
   * Prediction materials are additive, so fading the vertex colour towards
   * black fades the line into the cloth without needing per-vertex alpha.
   */
  private fadePredictionLine(geometry: THREE.BufferGeometry, color: number) {
    const position = geometry.getAttribute("position");
    const count = position?.count ?? 0;
    const base = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const progress = count <= 1 ? 0 : index / (count - 1);
      const strength = 1 - 0.82 * progress;
      colors[index * 3] = base.r * strength;
      colors[index * 3 + 1] = base.g * strength;
      colors[index * 3 + 2] = base.b * strength;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  private hidePrediction() {
    this.predictionNormalLine.visible = false;
    this.predictionTangentLine.visible = false;
    this.ghostBall.visible = false;
    this.targetRing.visible = false;
    this.predictionDebug = { normal: null, tangent: null };
  }

  private viewportDesign(): Rect {
    if (this.presentation === "home")
      return homeVisualViewport(this.layout);
    if (this.presentation === "room")
      return roomTableViewport(this.layout);
    if (this.presentation === "game") return designTableViewport(this.layout);
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  private viewportScreen(): Rect {
    const rect = this.viewportDesign();
    const scale = this.layout.scale;
    return {
      x: rect.x * scale,
      y: rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    };
  }

  private startCameraTransition() {
    const from = this.currentPose();
    this.cameraTransition = {
      from,
      started: now(),
      duration: this.reduceMotion ? 1 : 400,
    };
    this.hasSmoothed = false;
  }

  private currentPose(): CameraPose {
    if (this.cameraTransition) {
      return {
        position: this.camera.position.clone(),
        target: this.camera.position
          .clone()
          .add(
            new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion),
          ),
        up: new THREE.Vector3(0, 0, 1),
        fov: this.camera.fov,
      };
    }
    return this.poseFor(this.displayMode);
  }

  private poseFor(mode: CameraMode): CameraPose {
    if (mode === "top") {
      return {
        position: new THREE.Vector3(0, 0, 10),
        target: new THREE.Vector3(0, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
        fov: 42,
      };
    }
    const d = tableDimensions();
    if (mode === "follow" && this.snapshot?.phase === "aiming" && !this.animation) {
      const cue = this.snapshot.balls[0];
      const direction = new THREE.Vector3(
        Math.cos(this.angle),
        Math.sin(this.angle),
        0,
      );
      const kick = this.followKick();
      return {
        position: new THREE.Vector3(
          cue.pos[0] - direction.x * (1.05 - 0.1 * kick),
          cue.pos[1] - direction.y * (1.05 - 0.1 * kick),
          0.58 - 0.04 * kick,
        ),
        target: new THREE.Vector3(
          cue.pos[0] + direction.x * 1.0,
          cue.pos[1] + direction.y * 1.0,
          d.ballRadius * 0.6 - 0.02 * kick,
        ),
        up: new THREE.Vector3(0, 0, 1),
        fov: 38,
      };
    }
    const viewport = this.viewportDesign();
    const aspect = Math.max(0.5, viewport.width / Math.max(1, viewport.height));
    const compensation = Math.max(1, 1.55 / aspect);
    if (this.presentation === "home") {
      const orbit = Math.sin(now() / 20000 * Math.PI * 2) * 0.052;
      return {
        position: new THREE.Vector3(
          Math.sin(orbit) * 4.4,
          -4.4 * Math.cos(orbit),
          2.8,
        ),
        target: new THREE.Vector3(0, 0, 0.02),
        up: new THREE.Vector3(0, 0, 1),
        fov: 32,
      };
    }
    if (this.presentation === "room") {
      const orbit = Math.sin(now() / 24000 * Math.PI * 2) * 0.035;
      return {
        position: new THREE.Vector3(
          Math.sin(orbit) * 2.9,
          -2.9 * Math.cos(orbit),
          1.95,
        ),
        target: new THREE.Vector3(0, 0, 0),
        up: new THREE.Vector3(0, 0, 1),
        fov: 32,
      };
    }
    return {
      position: new THREE.Vector3(
        0,
        -2.0 * compensation,
        1.9 * compensation,
      ),
      target: new THREE.Vector3(0, 0.06, 0),
      up: new THREE.Vector3(0, 0, 1),
      fov: 42,
    };
  }

  private updateCamera(force: boolean) {
    const time = now();
    const dt = Math.min(0.05, Math.max(0, (time - this.lastCameraUpdate) / 1000));
    this.lastCameraUpdate = time;
    if (this.presentation === "hidden") return;

    if (this.cameraTransition) {
      const progress =
        (time - this.cameraTransition.started) /
        this.cameraTransition.duration;
      const eased = easeInOut(progress);
      const to = this.poseFor(this.cameraMode);
      const pose = this.lerpPose(this.cameraTransition.from, to, eased);
      this.applyPose(this.camera, pose);
      if (progress >= 1) {
        this.cameraTransition = undefined;
        this.displayMode = this.cameraMode;
        this.hasSmoothed = false;
        this.updateCamera(true);
      }
      this.dirty = true;
      return;
    }

    if (this.presentation === "home" || this.presentation === "room") {
      const pose =
        this.presentation === "home"
          ? this.poseForHome()
          : this.poseForRoom();
      this.applyPose(this.camera, pose);
      this.dirty = true;
      return;
    }

    if (this.displayMode === "top") {
      this.updateTopFrustum();
      this.topCamera.position.set(0, 0, 10);
      this.topCamera.lookAt(0, 0, 0);
      this.topCamera.updateMatrixWorld();
      this.cameraTransition = undefined;
      return;
    }

    const pose = this.poseFor(this.displayMode);
    if (!this.hasSmoothed || force) {
      this.smoothedPosition.copy(pose.position);
      this.smoothedTarget.copy(pose.target);
      const quaternion = this.lookQuaternion(pose);
      this.smoothedQuaternion.copy(quaternion);
      this.hasSmoothed = true;
    } else {
      const factor = 1 - Math.exp(-dt / 0.15);
      this.smoothedPosition.lerp(pose.position, factor);
      this.smoothedTarget.lerp(pose.target, factor);
      const quaternion = this.lookQuaternion(pose);
      this.smoothedQuaternion.slerp(quaternion, factor);
    }
    this.camera.position.copy(this.smoothedPosition);
    this.camera.quaternion.copy(this.smoothedQuaternion);
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.dirty = true;
  }

  private followKick() {
    if (this.reduceMotion) return 0;
    const time = now();
    if (!this.followKickUntil || time >= this.followKickUntil) return 0;
    const ramp = Math.min(1, (time - this.followKickStarted) / 120);
    const fade = Math.min(1, (this.followKickUntil - time) / 400);
    return Math.max(0, ramp * fade);
  }

  private poseForHome() {
    const orbit = this.reduceMotion
      ? 0
      : Math.sin((now() / 20000) * Math.PI * 2) * 0.052;
    return {
      position: new THREE.Vector3(
        Math.sin(orbit) * 4.4,
        -4.4 * Math.cos(orbit),
        2.8,
      ),
      target: new THREE.Vector3(0, 0, 0.02),
      up: new THREE.Vector3(0, 0, 1),
      fov: 32,
    };
  }

  private poseForRoom() {
    const orbit = this.reduceMotion
      ? 0
      : Math.sin((now() / 24000) * Math.PI * 2) * 0.035;
    return {
      position: new THREE.Vector3(
        Math.sin(orbit) * 2.9,
        -2.9 * Math.cos(orbit),
        1.95,
      ),
      target: new THREE.Vector3(0, 0, 0),
      up: new THREE.Vector3(0, 0, 1),
      fov: 32,
    };
  }

  private lookQuaternion(pose: CameraPose) {
    const matrix = new THREE.Matrix4();
    matrix.lookAt(pose.position, pose.target, pose.up);
    return new THREE.Quaternion().setFromRotationMatrix(matrix);
  }

  private applyPose(camera: THREE.PerspectiveCamera, pose: CameraPose) {
    camera.position.copy(pose.position);
    camera.quaternion.copy(this.lookQuaternion(pose));
    camera.up.copy(pose.up);
    camera.fov = pose.fov;
    camera.aspect = Math.max(
      0.5,
      this.viewportDesign().width / Math.max(1, this.viewportDesign().height),
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  private lerpPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
    return {
      position: from.position.clone().lerp(to.position, t),
      target: from.target.clone().lerp(to.target, t),
      up: from.up.clone().lerp(to.up, t).normalize(),
      fov: from.fov + (to.fov - from.fov) * t,
    };
  }

  private updateTopFrustum() {
    const viewport = this.viewportDesign();
    const aspect = Math.max(0.5, viewport.width / Math.max(1, viewport.height));
    const d = tableDimensions();
    let halfHeight = d.outerHalfHeight / 0.88;
    let halfWidth = halfHeight * aspect;
    if (halfWidth < d.outerHalfWidth / 0.88) {
      halfWidth = d.outerHalfWidth / 0.88;
      halfHeight = halfWidth / aspect;
    }
    this.topCamera.left = -halfWidth;
    this.topCamera.right = halfWidth;
    this.topCamera.top = halfHeight;
    this.topCamera.bottom = -halfHeight;
    this.topCamera.near = 0.01;
    this.topCamera.far = 100;
    this.topCamera.updateProjectionMatrix();
  }

  private disposeGroup(group: THREE.Group) {
    group.children.slice().forEach((child) => {
      group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((material) => material?.dispose?.());
    });
  }
}

export type { PhysicsEvent };
