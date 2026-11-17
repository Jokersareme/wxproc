import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import cloudbase from "@cloudbase/node-sdk";
import type { GameType, MatchSnapshot } from "@friend-billiards/core";
import type { PlayerIndex, ServerMessage } from "@friend-billiards/protocol";

export interface StoredPlayer {
  userId: string;
  displayName: string;
  playerIndex: PlayerIndex;
  ready: boolean;
}

export interface StoredShot {
  shotId: string;
  player: PlayerIndex;
  inputJson: string;
  message: Extract<ServerMessage, { type: "shot" }>;
}

export interface RoomRecord {
  roomCode: string;
  inviteToken: string;
  matchId: string;
  gameType: GameType;
  status: "waiting" | "playing" | "gameOver";
  players: StoredPlayer[];
  snapshot: MatchSnapshot;
  stateHash: string;
  seq: number;
  rematchUserIds: string[];
  shots: StoredShot[];
  updatedAt: number;
}

export interface RoomRepository {
  save(record: RoomRecord): Promise<void>;
  remove(roomCode: string): Promise<void>;
  list(): Promise<RoomRecord[]>;
}

export class MemoryRoomRepository implements RoomRepository {
  readonly records = new Map<string, RoomRecord>();

  async save(record: RoomRecord) {
    this.records.set(record.roomCode, JSON.parse(JSON.stringify(record)));
  }

  async remove(roomCode: string) {
    this.records.delete(roomCode);
  }

  async list() {
    return [...this.records.values()].map((record) =>
      JSON.parse(JSON.stringify(record)),
    );
  }
}

export class FileRoomRepository implements RoomRepository {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async read(): Promise<Record<string, RoomRecord>> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error: any) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.writes.then(operation, operation);
    this.writes = result.catch(() => {});
    return result;
  }

  async save(record: RoomRecord) {
    const snapshot = JSON.parse(JSON.stringify(record)) as RoomRecord;
    await this.enqueue(async () => {
      const records = await this.read();
      records[record.roomCode] = snapshot;
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
      await rename(temporary, this.filePath);
    });
  }

  async remove(roomCode: string) {
    await this.enqueue(async () => {
      const records = await this.read();
      delete records[roomCode];
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(records), { mode: 0o600 });
    });
  }

  async list() {
    await this.writes;
    return Object.values(await this.read());
  }
}

export class CloudBaseRoomRepository implements RoomRepository {
  private readonly collection: any;

  constructor(envId: string) {
    const app = cloudbase.init({ env: envId });
    this.collection = app.database().collection("billiards_rooms");
  }

  async save(record: RoomRecord) {
    const existing = await this.collection
      .where({ roomCode: record.roomCode })
      .get();
    if (existing.data?.length) {
      await this.collection
        .where({ roomCode: record.roomCode })
        .update({ ...record });
    } else {
      await this.collection.add({ ...record, _id: record.roomCode });
    }
  }

  async remove(roomCode: string) {
    await this.collection.doc(roomCode).remove();
  }

  async list(): Promise<RoomRecord[]> {
    const result = await this.collection.limit(100).get();
    return result.data ?? [];
  }
}

export function createRepository(): RoomRepository {
  if (process.env.CLOUDBASE_ENV_ID) {
    return new CloudBaseRoomRepository(process.env.CLOUDBASE_ENV_ID);
  }
  return new FileRoomRepository(
    process.env.ROOM_STORE_PATH ?? "apps/server/data/rooms.json",
  );
}
