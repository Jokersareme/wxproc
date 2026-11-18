import * as THREE from "three";
import {
  clientToDesign,
  computeLayout,
  sameLayout,
  type Layout,
} from "./ui/layout";
import type { HudModel } from "./ui/model";
import type { UiButton } from "./ui/widgets";
import { Ui } from "./ui/widgets";
import { drawHome } from "./ui/screens/home";
import { drawFriend } from "./ui/screens/friend";
import { drawRoom } from "./ui/screens/room";
import { drawGame } from "./ui/screens/game";
import { drawLicense } from "./ui/screens/license";
import type { ClientPlatform } from "./platform";
import { clampSpin, SPIN_LIMIT } from "./spin";

const SLIDER_TOP = 190;
const SLIDER_HEIGHT = 370;
const SPIN_RADIUS = 120;

export type { HudModel } from "./ui/model";

export class Hud {
  readonly layout: Layout;
  readonly canvas: any;
  readonly context: any;
  buttons: UiButton[] = [];
  private readonly texture: THREE.CanvasTexture;
  private readonly plane: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(
    private readonly platform: ClientPlatform,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.layout = this.measure();
    this.canvas = platform.createCanvas(
      Math.max(1, Math.round(this.layout.width * this.layout.pixelRatio)),
      Math.max(1, Math.round(this.layout.height * this.layout.pixelRatio)),
    );
    this.context = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.layout.width, this.layout.height),
      this.material,
    );
    this.plane.position.set(this.layout.width / 2, this.layout.height / 2, 0);
    this.scene.add(this.plane);
    this.camera = new THREE.OrthographicCamera(
      0,
      this.layout.width,
      this.layout.height,
      0,
      -10,
      10,
    );
  }

  draw(model: HudModel) {
    this.setScreenSize(this.platform.width, this.platform.height);
    const ui = new Ui(this.context, this.layout);
    this.context.setTransform?.(
      this.layout.pixelRatio,
      0,
      0,
      this.layout.pixelRatio,
      0,
      0,
    );
    this.context.clearRect(0, 0, this.layout.width, this.layout.height);
    if (model.screen === "home") drawHome(ui, model);
    if (model.screen === "friend") drawFriend(ui, model);
    if (model.screen === "room") drawRoom(ui, model);
    if (model.screen === "game") drawGame(ui, model);
    if (model.screen === "license") drawLicense(ui, model);
    if (model.toast && model.screen !== "game")
      ui.toast(model.toast, 150 + this.layout.safe.top);
    this.buttons = ui.buttons;
    this.texture.needsUpdate = true;
  }

  render() {
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  hit(
    x: number,
    y: number,
    screenWidth = this.layout.screenWidth,
    screenHeight = this.layout.screenHeight,
  ): string | null {
    if (
      Math.abs(screenWidth - this.layout.screenWidth) > 0.5 ||
      Math.abs(screenHeight - this.layout.screenHeight) > 0.5
    )
      this.setScreenSize(screenWidth, screenHeight);
    const point = clientToDesign(x, y, this.layout);
    const button = [...this.buttons]
      .reverse()
      .find(
        (candidate) =>
          point.x >= candidate.x &&
          point.x <= candidate.x + candidate.width &&
          point.y >= candidate.y &&
          point.y <= candidate.y + candidate.height,
      );
    return button && !button.disabled ? button.id : null;
  }

  powerAt(y: number): number {
    const point = clientToDesign(
      0,
      y,
      this.layout,
    );
    return Math.max(
      0.03,
      Math.min(1, 1 - (point.y - SLIDER_TOP) / SLIDER_HEIGHT),
    );
  }

  spinAt(x: number, y: number): { x: number; y: number } {
    const point = clientToDesign(x, y, this.layout);
    return clampSpin(
      ((point.x - this.layout.width / 2) / SPIN_RADIUS) * SPIN_LIMIT,
      ((point.y - 360) / SPIN_RADIUS) * SPIN_LIMIT,
    );
  }

  updatePointerSize(width: number, height: number) {
    this.setScreenSize(width, height);
  }

  private setScreenSize(width: number, height: number) {
    const next = computeLayout(
      width,
      height,
      this.platform.pixelRatio,
      this.platform.safeArea,
      this.platform.menuButton,
    );
    if (sameLayout(next, this.layout) && this.layout.width === next.width) return;
    Object.assign(this.layout, next);
    const pixelWidth = Math.max(1, Math.round(next.width * next.pixelRatio));
    const pixelHeight = Math.max(
      1,
      Math.round(next.height * next.pixelRatio),
    );
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.plane.geometry.dispose();
    this.plane.geometry = new THREE.PlaneGeometry(next.width, next.height);
    this.plane.position.set(next.width / 2, next.height / 2, 0);
    this.camera.right = next.width;
    this.camera.top = next.height;
    this.camera.updateProjectionMatrix();
    this.texture.needsUpdate = true;
  }

  private measure() {
    return computeLayout(
      this.platform.width,
      this.platform.height,
      this.platform.pixelRatio,
      this.platform.safeArea,
      this.platform.menuButton,
    );
  }
}
