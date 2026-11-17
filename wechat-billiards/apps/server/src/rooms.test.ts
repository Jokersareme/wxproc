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

async function createPlayingRoom(
  service: RoomService,
  predictionLevel = 1,
) {
  const host = context("host", "房主");
  const guest = context("guest", "球友");
  await service.handle(host.context, {
    protocolVersion: 1,
    type: "createRoom",
    gameType: "eightball",
    predictionLevel,
  });
  const room = host.socket.last("room").room;
  await service.handle(guest.context, {
    protocolVersion: 1,
    type: "joinRoom",
    roomCode: room.roomCode,
    inviteToken: room.inviteToken,
  });
  await service.handle(host.context, {
    protocolVersion: 1,
    type: "ready",
    roomCode: room.roomCode,
    ready: true,
  });
  await service.handle(guest.context, {
    protocolVersion: 1,
    type: "ready",
    roomCode: room.roomCode,
    ready: true,
  });
  return { host, guest, room: host.socket.last("room").room };
}

describe("authoritative room service", () => {
  it("runs a two-player room and rejects out-of-turn shots", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createPlayingRoom(service);
    expect(room.status).toBe("playing");
    await expect(
      service.handle(guest.context, {
        protocolVersion: 1,
        type: "shoot",
        matchId: room.matchId,
        shotId: "bad-turn",
        input: shotInput,
      }),
    ).rejects.toThrow("还未轮到你");
    await service.handle(host.context, {
      protocolVersion: 1,
      type: "shoot",
      matchId: room.matchId,
      shotId: "shot-1",
      input: shotInput,
    });
    const shot = host.socket.last("shot");
    expect(shot.preSnapshot.shotNumber).toBe(0);
    expect(shot.snapshot.shotNumber).toBe(1);
    expect(guest.socket.last("shot").stateHash).toBe(shot.stateHash);
  });

  it("returns the cached result for an idempotent retry and rejects parameter reuse", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, room } = await createPlayingRoom(service);
    const command = {
      protocolVersion: 1,
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
    const restored = new RoomService(repository);
    await restored.restore();
    const reconnect = context("host", "房主");
    await restored.handle(reconnect.context, {
      protocolVersion: 1,
      type: "sync",
      matchId: room.matchId,
    });
    const state = reconnect.socket.last("room");
    expect(state.room.matchId).toBe(room.matchId);
    expect(state.snapshot.balls).toHaveLength(16);
    expect(
      state.room.players.find((player: any) => player.userId === "host")
        .connected,
    ).toBe(true);
  });

  it("requires both players to confirm a rematch", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const { host, guest, room } = await createPlayingRoom(service);
    await service.handle(host.context, {
      protocolVersion: 1,
      type: "concede",
      matchId: room.matchId,
    });
    await service.handle(host.context, {
      protocolVersion: 1,
      type: "rematch",
      matchId: room.matchId,
    });
    expect(host.socket.last("room").room.status).toBe("gameOver");
    await service.handle(guest.context, {
      protocolVersion: 1,
      type: "rematch",
      matchId: room.matchId,
    });
    expect(host.socket.last("room").room.status).toBe("playing");
    expect(host.socket.last("room").snapshot.shotNumber).toBe(0);
    expect(host.socket.last("room").snapshot.scores).toEqual([0, 0]);
  });

  it("keeps the prediction level across join, broadcast, rematch and restart", async () => {
    const repository = new MemoryRoomRepository();
    const service = new RoomService(repository);
    const { host, guest, room } = await createPlayingRoom(service, 4);
    expect(room.predictionLevel).toBe(4);
    expect(guest.socket.last("room").room.predictionLevel).toBe(4);

    await service.handle(host.context, {
      protocolVersion: 1,
      type: "concede",
      matchId: room.matchId,
    });
    await service.handle(host.context, {
      protocolVersion: 1,
      type: "rematch",
      matchId: room.matchId,
    });
    await service.handle(guest.context, {
      protocolVersion: 1,
      type: "rematch",
      matchId: room.matchId,
    });
    expect(host.socket.last("room").room.predictionLevel).toBe(4);

    const restoredService = new RoomService(repository);
    await restoredService.restore();
    const reconnect = context("host", "房主");
    await restoredService.handle(reconnect.context, {
      protocolVersion: 1,
      type: "sync",
      matchId: room.matchId,
    });
    expect(reconnect.socket.last("room").room.predictionLevel).toBe(4);
  });

  it("defaults old rooms without a prediction level to level 1", async () => {
    const repository = new MemoryRoomRepository();
    const service = new RoomService(repository);
    const { room } = await createPlayingRoom(service);
    for (const record of repository.records.values()) {
      delete (record as any).predictionLevel;
    }
    const restoredService = new RoomService(repository);
    await restoredService.restore();
    const socket = context("host");
    await restoredService.handle(socket.context, {
      protocolVersion: 1,
      type: "sync",
      matchId: room.matchId,
    });
    expect(socket.socket.last("room").room.predictionLevel).toBe(1);
  });

  it("rejects a wrong invite token", async () => {
    const service = new RoomService(new MemoryRoomRepository());
    const host = context("host");
    await service.handle(host.context, {
      protocolVersion: PROTOCOL_VERSION,
      type: "createRoom",
      gameType: "snooker",
      predictionLevel: 1,
    });
    const room = host.socket.last("room").room;
    const guest = context("guest");
    await expect(
      service.handle(guest.context, {
        protocolVersion: 1,
        type: "joinRoom",
        roomCode: room.roomCode,
        inviteToken: "wrong",
      }),
    ).rejects.toThrow("邀请令牌");
  });
});
