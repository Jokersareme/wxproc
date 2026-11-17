import { createRequire } from "node:module";
import { unlink } from "node:fs/promises";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const storePath = "apps/server/data/e2e-rooms.json";
process.env.ROOM_STORE_PATH = storePath;
process.env.NODE_ENV = "test";
await unlink(storePath).catch(() => {});
const { createApp } = require("../apps/server/dist/index.cjs");

class Client {
  messages = [];
  waiters = [];

  async connect(port) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      this.waiters = this.waiters.filter((waiter) => {
        if (!waiter.predicate(message)) return true;
        waiter.resolve(message);
        return false;
      });
    });
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify({ ...message, protocolVersion: 1 }));
  }

  wait(predicate, start = 0, timeout = 10000) {
    const existing = this.messages.slice(start).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `等待服务器消息超时：${predicate}；已收到 ${JSON.stringify(this.messages.slice(start))}`,
            ),
          ),
        timeout,
      );
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  request(message, predicate) {
    const start = this.messages.length;
    this.send(message);
    return this.wait(predicate, start);
  }

  async login(code, token) {
    const message = await this.request(
      { type: "login", ...(token ? { token } : { code }), displayName: code },
      (m) => m.type === "session",
    );
    this.token = message.sessionToken;
    this.userId = message.userId;
    return message;
  }

  close() {
    this.socket?.close();
  }
}

let app;
try {
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const port = app.server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/health`).then(
    (response) => response.json(),
  );
  if (!health.ok) throw new Error("健康检查失败");

  const host = new Client();
  const guest = new Client();
  await host.connect(port);
  await guest.connect(port);
  await host.login("e2e-host");
  await guest.login("e2e-guest");

  const created = await host.request(
    { type: "createRoom", gameType: "eightball" },
    (m) => m.type === "room",
  );
  const { roomCode, inviteToken, matchId } = created.room;
  await guest.request(
    { type: "joinRoom", roomCode, inviteToken },
    (m) => m.type === "room" && m.room.players.length === 2,
  );
  await host.request(
    { type: "ready", roomCode, ready: true },
    (m) => m.type === "room",
  );
  const playing = await guest.request(
    { type: "ready", roomCode, ready: true },
    (m) => m.type === "room" && m.room.status === "playing",
  );
  if (playing.snapshot.currentPlayer !== 0) throw new Error("开局玩家错误");

  const rejected = await guest.request(
    {
      type: "shoot",
      matchId,
      shotId: "out-of-turn",
      input: { angle: 0, power: 0.3, spinX: 0, spinY: 0, elevation: 0 },
    },
    (m) => m.type === "error",
  );
  if (!rejected.message.includes("还未轮到你"))
    throw new Error("服务器未拒绝越权击球");

  const command = {
    type: "shoot",
    matchId,
    shotId: "e2e-shot-1",
    input: { angle: 0, power: 0.3, spinX: 0, spinY: 0, elevation: 0 },
  };
  const hostShotStart = host.messages.length;
  const guestShotStart = guest.messages.length;
  host.send(command);
  const hostShot = await host.wait((m) => m.type === "shot", hostShotStart);
  const guestShot = await guest.wait((m) => m.type === "shot", guestShotStart);
  if (
    hostShot.stateHash !== guestShot.stateHash ||
    hostShot.snapshot.shotNumber !== 1
  )
    throw new Error("双客户端击球状态不一致");

  const retryStart = host.messages.length;
  host.send(command);
  const retry = await host.wait((m) => m.type === "shot", retryStart);
  if (retry.stateHash !== hostShot.stateHash || retry.seq !== hostShot.seq)
    throw new Error("幂等重试返回了新对局状态");
  if (
    hostShot.snapshot.phase !== "ballInHand" ||
    !hostShot.snapshot.canRepositionCue
  )
    throw new Error("验收杆未产生自由球");

  const firstPlacement = await guest.request(
    { type: "placeBall", matchId, x: -0.5, y: 0 },
    (m) => m.type === "room" && m.snapshot.phase === "aiming",
  );
  if (!firstPlacement.snapshot.canRepositionCue)
    throw new Error("首次摆放后自由球资格被提前清除");
  const hostPlacementStart = host.messages.length;
  const secondPlacement = await guest.request(
    { type: "placeBall", matchId, x: -0.55, y: 0.05 },
    (m) =>
      m.type === "room" &&
      m.snapshot.phase === "aiming" &&
      Math.abs(m.snapshot.balls[0].pos[0] + 0.55) < 0.00001,
  );
  if (!secondPlacement.snapshot.canRepositionCue)
    throw new Error("重复摆放后自由球资格丢失");
  const secondPlacementOnHost = await host.wait(
    (m) => m.type === "room" && m.seq === secondPlacement.seq,
    hostPlacementStart,
  );
  if (secondPlacementOnHost.stateHash !== secondPlacement.stateHash)
    throw new Error("双客户端重复摆球状态不一致");

  host.close();
  guest.close();
  await app.close();
  app = undefined;

  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const restartedPort = app.server.address().port;
  const reconnected = new Client();
  await reconnected.connect(restartedPort);
  await reconnected.login("e2e-host");
  const restored = await reconnected.request(
    { type: "sync", matchId },
    (m) => m.type === "room",
  );
  if (
    restored.stateHash !== secondPlacement.stateHash ||
    restored.snapshot.shotNumber !== 1 ||
    !restored.snapshot.canRepositionCue
  )
    throw new Error("服务重启后未恢复权威快照或自由球资格");

  const reconnectedGuest = new Client();
  await reconnectedGuest.connect(restartedPort);
  await reconnectedGuest.login("e2e-guest");
  await reconnectedGuest.request(
    { type: "sync", matchId },
    (m) => m.type === "room",
  );

  const current = restored.snapshot.currentPlayer;
  const concedingClient = current === 0 ? reconnected : reconnectedGuest;
  const rematchStart = concedingClient.messages.length;
  concedingClient.send({ type: "concede", matchId });
  const ended = await concedingClient.wait(
    (m) => m.type === "room" && m.room.status === "gameOver",
    rematchStart,
  );
  if (ended.snapshot.winner === current) throw new Error("认输胜负判定错误");

  reconnected.close();
  reconnectedGuest.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "health",
          "login",
          "create",
          "join",
          "ready",
          "turn-authority",
          "dual-shot",
          "idempotency",
          "repeat-ball-in-hand",
          "restart-restore",
          "concede",
        ],
        stateHash: secondPlacement.stateHash,
      },
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  await unlink(storePath).catch(() => {});
}
