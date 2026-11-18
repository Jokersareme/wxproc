import type { PhysicsEvent } from "@friend-billiards/core";
import type { ClientPlatform, PlatformSound } from "./platform";

const soundNames = [
  "cue",
  "ballcollision",
  "cushion",
  "pot",
  "success",
];

export class GameAudio {
  private readonly player: PlatformSound;
  private muted: boolean;
  private volume: number;
  private preloaded = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    platform: ClientPlatform,
    options: { muted?: boolean; volume?: number } = {},
  ) {
    this.player = platform.createSound();
    this.muted = options.muted ?? false;
    this.volume = options.volume ?? 0.8;
    this.player.setMuted(this.muted);
  }

  preload() {
    if (this.preloaded) return Promise.resolve();
    this.preloaded = true;
    return this.player.preload(soundNames);
  }

  unlock() {
    void this.preload();
  }

  playCue(power: number) {
    this.play("cue", 0.4 + Math.max(0, Math.min(1, power)) * 0.6);
  }

  playCollision(speed: number) {
    this.play("ballcollision", 0.45 + Math.min(1, speed / 4) * 0.45);
  }

  playCushion(speed: number) {
    this.play("cushion", 0.4 + Math.min(1, speed / 4) * 0.4);
  }

  playPot() {
    this.play("pot", 0.7);
  }

  playSuccess() {
    this.play("success", 0.8);
  }

  playUi(kind: "tap" | "open" | "close" | "error" | "countdown") {
    if (this.muted) return;
    this.player.tone(kind);
  }

  playEvents(events: PhysicsEvent[], totalMs: number, wallMs: number) {
    const total = Math.max(1, totalMs);
    const wall = Math.max(1, wallMs);
    let collisions = 0;
    let cushions = 0;
    events.forEach((event) => {
      if (event.type === "collision" && ++collisions > 24) return;
      if (event.type === "cushion" && ++cushions > 12) return;
      const delay = Math.min(wall, (event.timestamp / total) * wall);
      const timer = setTimeout(() => {
        this.timers = this.timers.filter((entry) => entry !== timer);
        if (event.type === "collision") this.playCollision(event.incidentSpeed);
        else if (event.type === "cushion") this.playCushion(event.incidentSpeed);
        else if (event.type === "pot") this.playPot();
      }, delay);
      this.timers.push(timer);
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.player.setMuted(muted);
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
  }

  dispose() {
    this.timers.splice(0).forEach((timer) => clearTimeout(timer));
    this.player.dispose();
  }

  private play(name: string, volume: number) {
    if (this.muted) return;
    this.player.play(name, volume * this.volume);
  }
}
