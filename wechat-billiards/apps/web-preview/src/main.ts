import {
  GameApp,
  type ClientPlatform,
  type PlatformSocket,
  type TouchPoint,
} from "@friend-billiards/client";

declare const __SOURCE_URL__: string;

class WebPlatform implements ClientPlatform {
  readonly canvas = document.getElementById("game") as HTMLCanvasElement;
  private touchHandler?: {
    start: (point: TouchPoint) => void;
    move: (point: TouchPoint) => void;
    end: (point: TouchPoint) => void;
  };

  get width() {
    return window.innerWidth;
  }
  get height() {
    return window.innerHeight;
  }
  get pixelRatio() {
    return window.devicePixelRatio || 1;
  }

  constructor() {
    this.canvas.style.touchAction = "none";
    const point = (event: PointerEvent): TouchPoint => ({
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.touchHandler?.start(point(event));
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (event.buttons) this.touchHandler?.move(point(event));
    });
    const end = (event: PointerEvent) => this.touchHandler?.end(point(event));
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("contextmenu", (event) =>
      event.preventDefault(),
    );
  }

  createCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  onTouchStart(callback: (point: TouchPoint) => void) {
    this.handlers().start = callback;
  }
  onTouchMove(callback: (point: TouchPoint) => void) {
    this.handlers().move = callback;
  }
  onTouchEnd(callback: (point: TouchPoint) => void) {
    this.handlers().end = callback;
  }
  onResize(callback: () => void) {
    window.addEventListener("resize", callback);
  }
  requestAnimationFrame(callback: (time: number) => void) {
    return window.requestAnimationFrame(callback);
  }

  async openSocket(url: string): Promise<PlatformSocket> {
    const socket = new WebSocket(url);
    return {
      send: (data) => socket.send(data),
      close: () => socket.close(),
      onOpen: (callback) => socket.addEventListener("open", callback),
      onMessage: (callback) =>
        socket.addEventListener("message", (event) =>
          callback(String(event.data)),
        ),
      onClose: (callback) => socket.addEventListener("close", callback),
      onError: (callback) => socket.addEventListener("error", callback),
    };
  }

  async login() {
    let code = this.getStorage("billiards.devCode");
    if (!code) {
      code = `web-${crypto.randomUUID()}`;
      this.setStorage("billiards.devCode", code);
    }
    return { code, displayName: "本地球友" };
  }

  async prompt(title: string, placeholder = "") {
    return window.prompt(title, placeholder);
  }

  async share(invitation: {
    title: string;
    roomCode: string;
    inviteToken: string;
  }) {
    const url = new URL(window.location.href);
    url.search = `?roomCode=${invitation.roomCode}&inviteToken=${encodeURIComponent(invitation.inviteToken)}`;
    await navigator.clipboard?.writeText(url.toString());
    window.alert(`${invitation.title}\n邀请地址已复制：\n${url}`);
  }

  getStorage(key: string) {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }
  setStorage(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  }
  playHit(strength: number) {
    const AudioContextClass =
      window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 140 + strength * 160;
    gain.gain.setValueAtTime(0.055, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.075);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => void context.close();
  }
  vibrate() {
    navigator.vibrate?.(25);
  }

  private handlers() {
    if (!this.touchHandler)
      this.touchHandler = { start: () => {}, move: () => {}, end: () => {} };
    return this.touchHandler;
  }
}

const platform = new WebPlatform();
const protocol = location.protocol === "https:" ? "wss" : "ws";
const app = new GameApp(platform, {
  serverUrl: `${protocol}://${location.host}/ws`,
  sourceUrl: __SOURCE_URL__,
});
app.start();
const query = new URLSearchParams(location.search);
if (query.get("roomCode") && query.get("inviteToken")) {
  app.joinInvitation(query.get("roomCode")!, query.get("inviteToken")!);
}
(window as any).billiards = app;
