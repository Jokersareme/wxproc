import {
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@friend-billiards/protocol";
import { MemoryRoomRepository } from "./repository";
import { RoomService, type ClientContext, type SocketLike } from "./rooms";

class FakeSocket implements SocketLike {
  messages: ServerMessage[] = [];
  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
  last(type: string) {
    return [...this.messages]
      .reverse()
      .find((message) => message.type === type) as any;
  }
}

function context(
  id: string,
  name = id,
): { context: ClientContext; socket: FakeSocket } {
  const socket = new FakeSocket();
  return { context: { socket, userId: id, displayName: name }, socket };
}

const shotInput = { angle: 0, power: 0.3, spinX: 0, spinY: 0, elevation: 0 };

async function createTrialRoom(
  service: RoomService,
  predictionLevel = 0,
  mode: "classic" | "cards" | "threeSnooker" = "classic",
) {
  const host = context("host", "房主");
  await service.handle(host.context, {
    protocolVersion: PROTOCOL_VERSION,
    type: "createRoom",
    gameType: mode === "threeSnooker" ? "snooker" : "eightball",
    predictionLevel,
    mode,
    cardCount: mode === "cards" ? 3 : 0,
  });
  return { host, room: host.socket.last("room").room };
}

async function createStartingRoom(service: RoomService) {
  const { host, room } = await createTrialRoom(service);
  const guest = context("guest", "球友");
  await service.handle(guest.context, {
    protocolVersion: PROTOCOL_VERSION,
    type: "joinRoom",
    roomCode: room.roomCode,
    inviteToken: room.inviteToken,
  });
  return { host, guest, room: host.socket.last("room").room };
}

async function createPlayingRoom(
  service: RoomService,
  predictionLevel = 0,
) {
  const created = await createTrialRoom(service, predictionLevel);
  const guest = context("guest", "球友");
  await service.handle(guest.context, {
    protocolVersion: PROTOCOL_VERSION,
    type: "joinRoom",
    roomCode: created.room.roomCode,
    inviteToken: created.room.inviteToken,
  });
  await jest.advanceTimersByTimeAsync(3000);
  return {
    host: created.host,
    guest,
    room: created.host.socket.last("room").room,
  };
}

describe("authoritative room service", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("creates a trial room and lets the host shoot without recording a formal shot", async () => {
    const repository = new MemoryRoomRepository();
    const service = new RoomService(repository);
    const { host, room } = await createTrialRoom(service);
    expect(room.status).toBe("trial");
    expect(room.playerCount).toBe(1);
    expect(room.mode).toBe("classic");
    expect(room.maxPlayers).toBe(2);

    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "shoot",
      matchId: room.matchId,
      shotId: "trial-1",
      input: shotInput,
    });
    const shot = host.socket.last("shot");
    expect(shot.room.status).toBe("trial");
    expect(shot.snapshot.shotNumber).toBe(1);
    expect(repository.records.get(room.roomCode)!.shots).toHaveLength(0);
  });

  it("resets the table, locks input for three seconds, then starts the match", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createStartingRoom(service);
    expect(room.status).toBe("starting");
    expect(room.startAt).toBeGreaterThan(Date.now());
    expect(host.socket.last("room").snapshot.shotNumber).toBe(0);
    expect(host.socket.last("room").snapshot.scores).toEqual([0, 0]);

    await expect(
      service.handle(host.context, {
        protocolVersion: PROTOCOL_VERSION,
        type: "shoot",
        matchId: room.matchId,
        shotId: "early",
        input: shotInput,
      }),
    ).rejects.toMatchObject({ code: "MATCH_STARTING" });

    await jest.advanceTimersByTimeAsync(3000);
    expect(host.socket.last("room").room.status).toBe("playing");
    expect(guest.socket.last("room").room.status).toBe("playing");

    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "shoot",
      matchId: room.matchId,
      shotId: "shot-1",
      input: shotInput,
    });
    const shot = host.socket.last("shot");
    expect(shot.snapshot.shotNumber).toBe(1);
    expect(guest.socket.last("shot").stateHash).toBe(shot.stateHash);
  });

  it("returns to trial when the joiner leaves during the countdown", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createStartingRoom(service);
    await service.handle(guest.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "leave",
      matchId: room.matchId,
    });
    expect(host.socket.last("room").room.status).toBe("trial");
    expect(host.socket.last("room").room.playerCount).toBe(1);
    expect(host.socket.last("room").snapshot.practice).toBe(true);
    expect(guest.socket.last("roomClosed")).toBeUndefined();
  });

  it("returns the cached result for an idempotent retry and rejects parameter reuse", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, room } = await createPlayingRoom(service);
    const command = {
      protocolVersion: PROTOCOL_VERSION,
      type: "shoot" as const,
      matchId: room.matchId,
      shotId: "same-shot",
      input: shotInput,
    };
    await service.handle(host.context, command);
    const seq = host.socket.last("shot").seq;
    const count = host.socket.messages.length;
    await service.handle(host.context, command);
    expect(host.socket.last("shot").seq).toBe(seq);
    expect(host.socket.messages.length).toBe(count + 1);
    await expect(
      service.handle(host.context, {
        ...command,
        input: { ...shotInput, power: 0.9 },
      }),
    ).rejects.toThrow("击球 ID");
  });

  it("restores a disconnected seat and full snapshot from persistence", async () => {
    const repository = new MemoryRoomRepository();
    const first = new RoomService(repository);
    const { host, room } = await createPlayingRoom(first);
    first.disconnect(host.socket);
    jest.clearAllTimers();
    const restored = new RoomService(repository);
    await restored.restore();
    const reconnect = context("host", "房主");
    await restored.handle(reconnect.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "sync",
      matchId: room.matchId,
    });
    const state = reconnect.socket.last("room");
    expect(state.room.matchId).toBe(room.matchId);
    expect(state.room.status).toBe("playing");
    expect(state.snapshot.balls).toHaveLength(16);
    expect(
      state.room.players.find((player: any) => player.userId === "host")
        .connected,
    ).toBe(true);
  });

  it("restores a trial room and an in-flight countdown", async () => {
    const trialRepository = new MemoryRoomRepository();
    const trialService = new RoomService(trialRepository);
    const trial = await createTrialRoom(trialService);
    jest.clearAllTimers();
    const trialRestore = new RoomService(trialRepository);
    await trialRestore.restore();
    const trialSocket = context("host", "房主");
    await trialRestore.handle(trialSocket.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "sync",
      matchId: trial.room.matchId,
    });
    expect(trialSocket.socket.last("room").room.status).toBe("trial");
    expect(trialSocket.socket.last("room").snapshot.practice).toBe(true);

    const repository = new MemoryRoomRepository();
    const first = new RoomService(repository);
    const starting = await createStartingRoom(first);
    jest.clearAllTimers();
    const startingRestore = new RoomService(repository);
    await startingRestore.restore();
    const startSocket = context("host", "房主");
    await startingRestore.handle(startSocket.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "sync",
      matchId: starting.room.matchId,
    });
    expect(startSocket.socket.last("room").room.status).toBe("starting");
    await jest.advanceTimersByTimeAsync(3000);
    expect(startSocket.socket.last("room").room.status).toBe("playing");
  });

  it("starts immediately when a restored countdown is already past", async () => {
    const repository = new MemoryRoomRepository();
    const service = new RoomService(repository);
    const { room } = await createStartingRoom(service);
    jest.clearAllTimers();
    const record = repository.records.get(room.roomCode)!;
    record.startAt = Date.now() - 1000;
    await repository.save(record);
    const restored = new RoomService(repository);
    await restored.restore();
    const socket = context("host", "房主");
    await restored.handle(socket.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "sync",
      matchId: room.matchId,
    });
    expect(socket.socket.last("room").room.status).toBe("playing");
  });

  it("requires both players to confirm a rematch and runs the countdown again", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createPlayingRoom(service);
    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "concede",
      matchId: room.matchId,
    });
    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "rematch",
      matchId: room.matchId,
    });
    expect(host.socket.last("room").room.status).toBe("gameOver");
    await service.handle(guest.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "rematch",
      matchId: room.matchId,
    });
    expect(host.socket.last("room").room.status).toBe("starting");
    await jest.advanceTimersByTimeAsync(3000);
    expect(host.socket.last("room").room.status).toBe("playing");
    expect(host.socket.last("room").snapshot.shotNumber).toBe(0);
    expect(host.socket.last("room").snapshot.scores).toEqual([0, 0]);
  });

  it("allows either player to concede on any turn", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createPlayingRoom(service);
    await service.handle(guest.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "concede",
      matchId: room.matchId,
    });
    expect(guest.socket.last("room").room.status).toBe("gameOver");
    expect(host.socket.last("room").snapshot.winner).toBe(0);
    expect(host.socket.last("room").snapshot.endReason).toContain("认输");
  });

  it("keeps the prediction level across join, rematch and restart", async () => {
    const repository = new MemoryRoomRepository();
    const service = new RoomService(repository);
    const { host, guest, room } = await createPlayingRoom(service, 4);
    expect(room.predictionLevel).toBe(4);
    expect(guest.socket.last("room").room.predictionLevel).toBe(4);

    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "concede",
      matchId: room.matchId,
    });
    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "rematch",
      matchId: room.matchId,
    });
    await service.handle(guest.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "rematch",
      matchId: room.matchId,
    });
    expect(host.socket.last("room").room.predictionLevel).toBe(4);

    jest.clearAllTimers();
    const restoredService = new RoomService(repository);
    await restoredService.restore();
    const reconnect = context("host", "房主");
    await restoredService.handle(reconnect.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "sync",
      matchId: room.matchId,
    });
    expect(reconnect.socket.last("room").room.predictionLevel).toBe(4);
  });

  it("lets only the host change room settings and syncs them to guests", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createStartingRoom(service);
    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "updateRoomSettings",
      matchId: room.matchId,
      predictionLevel: 2,
      playbackSpeed: 2,
      cameraViews: ["follow", "overview"],
    });
    for (const socket of [host.socket, guest.socket]) {
      const state = socket.last("room").room;
      expect(state.predictionLevel).toBe(2);
      expect(state.playbackSpeed).toBe(2);
      expect(state.cameraViews).toEqual(["follow", "overview"]);
    }
    await expect(
      service.handle(guest.context, {
        protocolVersion: PROTOCOL_VERSION,
        type: "updateRoomSettings",
        matchId: room.matchId,
        playbackSpeed: 1.5,
      }),
    ).rejects.toThrow("只有房主");
  });

  it("normalises old records and promotes a full waiting room to starting", async () => {
    const repository = new MemoryRoomRepository();
    const service = new RoomService(repository);
    const { room } = await createTrialRoom(service);
    jest.clearAllTimers();
    const record = repository.records.get(room.roomCode)!;
    delete (record as any).predictionLevel;
    delete (record as any).playbackSpeed;
    delete (record as any).cameraViews;
    delete (record as any).mode;
    delete (record as any).cardCount;
    delete (record as any).maxPlayers;
    delete (record as any).playerCount;
    delete (record as any).startAt;
    delete (record as any).frameIndex;
    (record as any).status = "waiting";
    record.players.push({
      userId: "guest",
      displayName: "旧好友",
      playerIndex: 1,
      ready: true,
    });
    await repository.save(record);

    const restored = new RoomService(repository);
    await restored.restore();
    const socket = context("host", "房主");
    await restored.handle(socket.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "sync",
      matchId: room.matchId,
    });
    const state = socket.socket.last("room");
    expect(state.room.predictionLevel).toBe(0);
    expect(state.room.playbackSpeed).toBe(1.15);
    expect(state.room.cameraViews).toEqual(["top", "follow", "overview"]);
    expect(state.room.mode).toBe("classic");
    expect(state.room.maxPlayers).toBe(2);
    expect(state.room.status).toBe("starting");
  });

  it("rejects a wrong invite token and accepts a six-digit code", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { room } = await createTrialRoom(service);
    const guest = context("guest");
    await expect(
      service.handle(guest.context, {
        protocolVersion: PROTOCOL_VERSION,
        type: "joinRoom",
        roomCode: room.roomCode,
        inviteToken: "wrong",
      }),
    ).rejects.toThrow("邀请已失效");
    await service.handle(guest.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "joinRoom",
      roomCode: room.roomCode,
      inviteToken: "",
    });
    expect(guest.socket.last("room").room.playerCount).toBe(2);
    expect(guest.socket.last("room").room.status).toBe("starting");
  });

  it("reports a full room and a finished room with stable codes", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createPlayingRoom(service);
    const fourth = context("fourth");
    await expect(
      service.handle(fourth.context, {
        protocolVersion: PROTOCOL_VERSION,
        type: "joinRoom",
        roomCode: room.roomCode,
        inviteToken: "",
      }),
    ).rejects.toMatchObject({ code: "ROOM_FULL" });

    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "concede",
      matchId: room.matchId,
    });
    await expect(
      service.handle(fourth.context, {
        protocolVersion: PROTOCOL_VERSION,
        type: "joinRoom",
        roomCode: room.roomCode,
        inviteToken: "",
      }),
    ).rejects.toMatchObject({ code: "ROOM_FINISHED" });
    expect(guest.socket.last("room").room.status).toBe("gameOver");
  });

  it("accepts the deprecated ready message without changing the room", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, room } = await createTrialRoom(service);
    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "ready",
      roomCode: room.roomCode,
      ready: true,
    });
    expect(host.socket.last("room").room.status).toBe("trial");
  });

  it("warms up a three-player room with two seats before starting", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, room } = await createTrialRoom(service, 0, "threeSnooker");
    const guest = context("guest", "球友");
    await service.handle(guest.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "joinRoom",
      roomCode: room.roomCode,
      inviteToken: room.inviteToken,
    });
    const warmup = guest.socket.last("room");
    expect(warmup.room.status).toBe("trial");
    expect(warmup.room.playerCount).toBe(2);
    expect(warmup.snapshot.practice).toBe(false);
    expect(warmup.snapshot.playerCount).toBe(2);

    await expect(
      service.handle(guest.context, {
        protocolVersion: PROTOCOL_VERSION,
        type: "shoot",
        matchId: room.matchId,
        shotId: "warmup-wrong-turn",
        input: shotInput,
      }),
    ).rejects.toThrow("还未轮到你");
    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "shoot",
      matchId: room.matchId,
      shotId: "warmup-shot",
      input: shotInput,
    });
    expect(guest.socket.last("shot")).toBeTruthy();

    const third = context("third", "第三人");
    await service.handle(third.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "joinRoom",
      roomCode: room.roomCode,
      inviteToken: room.inviteToken,
    });
    const starting = host.socket.last("room");
    expect(starting.room.status).toBe("starting");
    expect(starting.room.playerCount).toBe(3);
    expect(starting.snapshot.playerCount).toBe(3);
  });

  it("creates card and three-player rooms with their limits", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const cards = await createTrialRoom(service, 0, "cards");
    expect(cards.room.mode).toBe("cards");
    expect(cards.room.cardCount).toBe(3);
    expect(cards.room.maxPlayers).toBe(2);

    const three = await createTrialRoom(service, 0, "threeSnooker");
    expect(three.room.mode).toBe("threeSnooker");
    expect(three.room.maxPlayers).toBe(3);
    expect(three.room.gameType).toBe("snooker");
  });
});
