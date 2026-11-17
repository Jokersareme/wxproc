import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@friend-billiards/protocol";
import { AuthService } from "./auth";
import { createRepository, type RoomRepository } from "./repository";
import { RoomService, type ClientContext } from "./rooms";

interface AppOptions {
  repository?: RoomRepository;
  auth?: AuthService;
}

interface ConnectionState {
  userId?: string;
  displayName?: string;
  messages: number[];
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
}

export async function createApp(options: AppOptions = {}) {
  const repository = options.repository ?? createRepository();
  const auth = options.auth ?? new AuthService();
  const rooms = new RoomService(repository);
  await rooms.restore();
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          rooms: rooms.roomCount(),
          uptime: Math.floor(process.uptime()),
        }),
      );
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("friend-billiards authoritative server");
      return;
    }
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: MAX_MESSAGE_BYTES,
  });

  wss.on("connection", (socket) => {
    const state: ConnectionState = { messages: [] };
    socket.on("message", async (raw) => {
      const now = Date.now();
      state.messages = state.messages.filter((time) => now - time < 10000);
      if (state.messages.length >= 60) {
        return send(socket, {
          protocolVersion: PROTOCOL_VERSION,
          type: "error",
          code: "RATE_LIMIT",
          message: "消息过于频繁，请稍后重试",
        });
      }
      state.messages.push(now);
      let requestId: string | undefined;
      try {
        const parsed = parseClientMessage(JSON.parse(raw.toString()));
        requestId = parsed.requestId;
        if (parsed.type === "login") {
          try {
            const user = await auth.login(parsed);
            state.userId = user.userId;
            state.displayName = user.displayName;
            send(socket, {
              protocolVersion: PROTOCOL_VERSION,
              ...(requestId ? { requestId } : {}),
              type: "session",
              userId: user.userId,
              sessionToken: user.sessionToken,
              expiresAt: user.expiresAt,
            });
          } catch (error: any) {
            send(socket, {
              protocolVersion: PROTOCOL_VERSION,
              ...(requestId ? { requestId } : {}),
              type: "error",
              code: parsed.token ? "AUTH_EXPIRED" : "AUTH_FAILED",
              message: error.message,
            });
          }
          return;
        }
        if (!state.userId || !state.displayName) {
          return send(socket, {
            protocolVersion: PROTOCOL_VERSION,
            ...(requestId ? { requestId } : {}),
            type: "error",
            code: "AUTH_REQUIRED",
            message: "请先登录",
          });
        }
        const context: ClientContext = {
          socket,
          userId: state.userId,
          displayName: state.displayName,
        };
        await rooms.handle(context, parsed);
      } catch (error: any) {
        send(socket, {
          protocolVersion: PROTOCOL_VERSION,
          ...(requestId ? { requestId } : {}),
          type: "error",
          code: "BAD_REQUEST",
          message: String(error.message ?? error).slice(0, 180),
        });
      }
    });
    socket.on("close", () => rooms.disconnect(socket));
    socket.on("error", () => rooms.disconnect(socket));
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket: any) => {
      if (socket.isAlive === false) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
      socket.once("pong", () => {
        socket.isAlive = true;
      });
    });
  }, 30000);

  return {
    server,
    wss,
    rooms,
    auth,
    listen(port: number, host = "0.0.0.0") {
      return new Promise<void>((resolve) => server.listen(port, host, resolve));
    },
    async close() {
      clearInterval(heartbeat);
      wss.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await rooms.flush();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function start() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port);
  console.log(`friend-billiards server listening on ${port}`);
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return app;
}

if (require.main === module) {
  start().catch((error) => {
    console.error("server startup failed", error);
    process.exit(1);
  });
}
