import {
  GameApp,
  type ClientPlatform,
  type PlatformSocket,
  type ShareInvitation,
  type TouchPoint,
} from "@friend-billiards/client";

declare const wx: any;
declare const __CLOUD_ENV_ID__: string;
declare const __CLOUD_SERVICE__: string;
declare const __SOURCE_URL__: string;
declare const __LOCAL_SERVER_URL__: string;

class WeChatPlatform implements ClientPlatform {
  readonly canvas = wx.createCanvas();
  private readonly info = wx.getWindowInfo?.() ?? wx.getSystemInfoSync();
  private invitation?: ShareInvitation;

  get width() {
    return this.info.windowWidth;
  }
  get height() {
    return this.info.windowHeight;
  }
  get pixelRatio() {
    return this.info.pixelRatio || 1;
  }

  createCanvas(width: number, height: number) {
    const canvas = wx.createCanvas();
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  onTouchStart(callback: (point: TouchPoint) => void) {
    wx.onTouchStart((event: any) => callback(this.point(event)));
  }
  onTouchMove(callback: (point: TouchPoint) => void) {
    wx.onTouchMove((event: any) => callback(this.point(event)));
  }
  onTouchEnd(callback: (point: TouchPoint) => void) {
    wx.onTouchEnd((event: any) => callback(this.point(event, true)));
  }
  onResize(callback: () => void) {
    wx.onWindowResize?.(callback);
  }
  requestAnimationFrame(callback: (time: number) => void) {
    return (globalThis as any).requestAnimationFrame(callback);
  }

  async openSocket(url: string): Promise<PlatformSocket> {
    const cloud = url.startsWith("cloud://");
    const task = cloud
      ? (
          await wx.cloud.connectContainer({
            config: { env: __CLOUD_ENV_ID__ },
            service: url.slice("cloud://".length),
            path: "/ws",
          })
        ).socketTask
      : wx.connectSocket({ url });
    if (!task) throw new Error("云托管未返回 WebSocket 连接");
    return {
      send: (data) => task.send({ data }),
      close: () => task.close(),
      onOpen: (callback) => task.onOpen(callback),
      onMessage: (callback) =>
        task.onMessage((event: any) => callback(String(event.data))),
      onClose: (callback) => task.onClose(callback),
      onError: (callback) => task.onError(callback),
    };
  }

  login(): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (result: any) =>
          result.code
            ? resolve({ code: result.code })
            : reject(new Error("微信登录未返回 code")),
        fail: () => reject(new Error("微信登录失败")),
      });
    });
  }

  prompt(title: string, placeholder = ""): Promise<string | null> {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        placeholderText: placeholder,
        editable: true,
        confirmText: "确定",
        success: (result: any) =>
          resolve(result.confirm ? (result.content ?? placeholder) : null),
        fail: () => resolve(null),
      });
    });
  }

  async share(invitation: ShareInvitation) {
    this.invitation = invitation;
    wx.shareAppMessage({
      title: invitation.title,
      query: `roomCode=${invitation.roomCode}&inviteToken=${encodeURIComponent(invitation.inviteToken)}`,
    });
  }

  getStorage(key: string) {
    try {
      return wx.getStorageSync(key) || "";
    } catch {
      return "";
    }
  }
  setStorage(key: string, value: string) {
    try {
      wx.setStorageSync(key, value);
    } catch {
      /* storage full */
    }
  }
  playHit(strength: number) {
    const context = wx.createWebAudioContext?.();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 140 + strength * 160;
    gain.gain.setValueAtTime(0.055, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.075);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => context.close?.();
  }
  vibrate() {
    wx.vibrateShort?.({ type: "light" });
  }

  defaultShare() {
    return this.invitation
      ? {
          title: this.invitation.title,
          query: `roomCode=${this.invitation.roomCode}&inviteToken=${encodeURIComponent(this.invitation.inviteToken)}`,
        }
      : { title: "欢畅台球：来打一局吧" };
  }

  private point(event: any, changed = false): TouchPoint {
    const touches = changed ? event.changedTouches : event.touches;
    const touch = touches?.[0] ?? event;
    return {
      id: touch.identifier ?? 0,
      x: touch.clientX ?? touch.x,
      y: touch.clientY ?? touch.y,
    };
  }
}

if (__CLOUD_ENV_ID__) {
  wx.cloud?.init({ env: __CLOUD_ENV_ID__, traceUser: true });
}
const platform = new WeChatPlatform();
const app = new GameApp(platform, {
  serverUrl: __CLOUD_ENV_ID__
    ? `cloud://${__CLOUD_SERVICE__}`
    : __LOCAL_SERVER_URL__,
  sourceUrl: __SOURCE_URL__,
});
app.start();

function acceptInvitation(options: any) {
  const query = options?.query ?? {};
  if (query.roomCode && query.inviteToken)
    app.joinInvitation(query.roomCode, query.inviteToken);
}
acceptInvitation(wx.getLaunchOptionsSync?.());
wx.onShow?.(acceptInvitation);
wx.onShareAppMessage?.(() => platform.defaultShare());
(globalThis as any).billiards = app;
