export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

export interface ShareInvitation {
  title: string;
  roomCode: string;
  inviteToken: string;
}

export interface PlatformInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlatformRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface PlatformSound {
  preload(names: string[]): Promise<void>;
  play(name: string, volume: number): void;
  tone(kind: "tap" | "open" | "close" | "error" | "countdown"): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export interface PlatformSocket {
  send(data: string): void;
  close(): void;
  onOpen(callback: () => void): void;
  onMessage(callback: (data: string) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (error: unknown) => void): void;
}

export interface ClientPlatform {
  readonly canvas: any;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly safeArea: PlatformInsets;
  /** WeChat capsule button in CSS pixels; other platforms leave it undefined. */
  readonly menuButton?: PlatformRect;
  readonly benchmarkLevel?: number;
  createCanvas(width: number, height: number): any;
  onTouchStart(callback: (point: TouchPoint) => void): void;
  onTouchMove(callback: (point: TouchPoint) => void): void;
  onTouchEnd(callback: (point: TouchPoint) => void): void;
  onResize(callback: () => void): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  openSocket(url: string): Promise<PlatformSocket>;
  login(): Promise<{ code: string; displayName?: string }>;
  prompt(title: string, placeholder?: string): Promise<string | null>;
  share(invitation: ShareInvitation): Promise<void>;
  copyText(text: string): Promise<void> | void;
  getStorage(key: string): string;
  setStorage(key: string, value: string): void;
  createSound(): PlatformSound;
  playHit(strength: number): void;
  vibrate(kind?: "light" | "medium" | "heavy" | "success"): void;
}
