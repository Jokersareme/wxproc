import {
  GameApp,
  type ClientPlatform,
  type PlatformInsets,
  type PlatformSocket,
  type PlatformSound,
  type TouchPoint,
} from "@friend-billiards/client";

declare const __SOURCE_URL__: string;

class WebSound implements PlatformSound {
  private context?: AudioContext;
  private master?: GainNode;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly active: AudioBufferSourceNode[] = [];
  private muted = false;

  async preload(names: string[]) {
    await Promise.all(names.map((name) => this.load(name)));
  }

  play(name: string, volume: number) {
    if (this.muted) return;
    const context = this.ensureContext();
    const buffer = this.buffers.get(name);
    if (!buffer) {
      if (this.failed.has(name)) return;
      void this.load(name).then(() => {
        if (this.buffers.has(name)) this.play(name, volume);
      });
      return;
    }
    if (this.active.length >= 6) this.active.shift()?.stop();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain);
    gain.connect(this.master!);
    source.onended = () => {
      const index = this.active.indexOf(source);
      if (index >= 0) this.active.splice(index, 1);
    };
    this.active.push(source);
    source.start();
  }

  tone(kind: "tap" | "open" | "close" | "error" | "countdown") {
    if (this.muted) return;
    const context = this.ensureContext();
    const spec = {
      tap: { frequency: 660, duration: 0.05, type: "sine" as OscillatorType },
      open: { frequency: 480, duration: 0.09, type: "sine" as OscillatorType },
      close: { frequency: 320, duration: 0.08, type: "sine" as OscillatorType },
      error: { frequency: 180, duration: 0.16, type: "square" as OscillatorType },
      countdown: {
        frequency: 880,
        duration: 0.08,
        type: "triangle" as OscillatorType,
      },
    }[kind];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = spec.type;
    oscillator.frequency.value = spec.frequency;
    gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      context.currentTime + spec.duration,
    );
    oscillator.connect(gain);
    gain.connect(this.master!);
    oscillator.start();
    oscillator.stop(context.currentTime + spec.duration);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.active.splice(0).forEach((source) => source.stop());
  }

  dispose() {
    this.active.splice(0).forEach((source) => source.stop());
    void this.context?.close();
    this.context = undefined;
  }

  private ensureContext() {
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext ?? (window as any).webkitAudioContext;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  private async load(name: string) {
    if (this.buffers.has(name)) return;
    const pending = this.loading.get(name);
    if (pending) return pending;
    const task = (async () => {
      try {
        const response = await fetch(`/sounds/${name}.ogg`);
        if (!response.ok) {
          this.failed.add(name);
          return;
        }
        const data = await response.arrayBuffer();
        const buffer = await this.ensureContext().decodeAudioData(data);
        this.buffers.set(name, buffer);
      } catch {
        this.failed.add(name);
        /* sound is optional */
      } finally {
        this.loading.delete(name);
      }
    })();
    this.loading.set(name, task);
    return task;
  }
}

class WebPlatform implements ClientPlatform {
  readonly canvas = document.getElementById("game") as HTMLCanvasElement;
  readonly safeArea: PlatformInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly sound = new WebSound();
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

  async copyText(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      window.prompt("复制房间码", text);
    }
  }

  createSound() {
    return this.sound;
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
  vibrate(kind: "light" | "medium" | "heavy" | "success" = "light") {
    const pattern =
      kind === "success"
        ? [30, 40, 60]
        : kind === "medium"
          ? 40
          : kind === "heavy"
            ? 60
            : 10;
    navigator.vibrate?.(pattern);
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
