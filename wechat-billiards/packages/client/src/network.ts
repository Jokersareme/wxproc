import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@friend-billiards/protocol";
import type { ClientPlatform, PlatformSocket } from "./platform";

type WithoutVersion<T> = T extends unknown ? Omit<T, "protocolVersion"> : never;
type ClientMessageInput = WithoutVersion<ClientMessage>;

export interface NetworkEvents {
  onMessage(message: ServerMessage): void;
  onOnline(online: boolean, message?: string): void;
}

export class NetworkClient {
  private socket?: PlatformSocket;
  private sessionToken = "";
  private userCode = "";
  private displayName = "";
  private closed = false;
  private connected = false;
  private reconnectAttempts = 0;

  constructor(
    private readonly platform: ClientPlatform,
    private readonly url: string,
    private readonly events: NetworkEvents,
  ) {
    this.sessionToken = platform.getStorage("billiards.session");
  }

  async connect() {
    this.closed = false;
    if (!this.userCode) {
      const login = await this.platform.login();
      this.userCode = login.code;
      this.displayName = login.displayName ?? "";
    }
    const socket = await this.platform.openSocket(this.url);
    this.socket = socket;
    socket.onOpen(() => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.send({
        type: "login",
        ...(this.sessionToken
          ? { token: this.sessionToken }
          : { code: this.userCode }),
        ...(this.displayName ? { displayName: this.displayName } : {}),
      });
    });
    socket.onMessage((data) => {
      const message = JSON.parse(data) as ServerMessage;
      if (message.type === "session") {
        this.sessionToken = message.sessionToken;
        this.platform.setStorage("billiards.session", this.sessionToken);
        this.events.onOnline(true);
      }
      if (message.type === "error" && message.code === "AUTH_EXPIRED") {
        this.sessionToken = "";
        this.platform.setStorage("billiards.session", "");
        this.send({
          type: "login",
          code: this.userCode,
          displayName: this.displayName,
        });
        return;
      }
      this.events.onMessage(message);
    });
    socket.onError(() => this.events.onOnline(false, "联机连接异常"));
    socket.onClose(() => {
      this.connected = false;
      this.events.onOnline(false, "连接已断开，正在重连");
      if (!this.closed) {
        const delay = Math.min(10000, 500 * 2 ** this.reconnectAttempts++);
        setTimeout(() => void this.connect().catch(() => undefined), delay);
      }
    });
  }

  send(message: ClientMessageInput) {
    this.socket?.send(
      JSON.stringify({ ...message, protocolVersion: PROTOCOL_VERSION }),
    );
  }

  close() {
    this.closed = true;
    this.connected = false;
    this.socket?.close();
  }

  get isOnline() {
    return this.connected && Boolean(this.sessionToken);
  }
}
