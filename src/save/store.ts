import { upgrade, type ChunkRecord, type PlayerRecord, type WorldMeta } from "./format.js";

const DATABASE = "craft";
const WORLDS = "worlds";
const PLAYERS = "players";
const CHUNKS = "chunks";

/** Everything saved of one world. */
export interface WorldData {
  meta: WorldMeta;
  player: PlayerRecord | null;
  chunks: ChunkRecord[];
}

/** What one save writes, in one transaction: all of it or nothing. */
export interface SaveBatch {
  meta: WorldMeta;
  player?: PlayerRecord;
  chunks: ChunkRecord[];
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

/** Keys of all chunks of a world: [world, cx, cz] from the lowest to the highest numbers. */
function worldChunks(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id, -Infinity, -Infinity], [id, Infinity, Infinity]);
}

/**
 * The worlds kept in this browser, in IndexedDB: their metadata, the player and every generated chunk.
 * Records are upgraded to the current format as they are read.
 */
export class WorldStore {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(name: string = DATABASE): Promise<WorldStore> {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore(WORLDS, { keyPath: "id" });
      db.createObjectStore(PLAYERS, { keyPath: "world" });
      db.createObjectStore(CHUNKS, { keyPath: ["world", "cx", "cz"] });
    };
    return new WorldStore(await request(open));
  }

  close(): void {
    this.db.close();
  }

  /** Every world, the most recently played first. */
  async listWorlds(): Promise<WorldMeta[]> {
    const all = await request(this.db.transaction(WORLDS).objectStore(WORLDS).getAll());
    return (all as WorldMeta[]).map((m) => upgrade("world", m)).sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async getWorld(id: string): Promise<WorldMeta | null> {
    const meta = (await request(this.db.transaction(WORLDS).objectStore(WORLDS).get(id))) as WorldMeta | undefined;
    return meta ? upgrade("world", meta) : null;
  }

  async putWorld(meta: WorldMeta): Promise<void> {
    const tx = this.db.transaction(WORLDS, "readwrite");
    tx.objectStore(WORLDS).put(meta);
    await finished(tx);
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    const player = (await request(this.db.transaction(PLAYERS).objectStore(PLAYERS).get(id))) as PlayerRecord | undefined;
    return player ? upgrade("player", player) : null;
  }

  /** The positions of a world's saved chunks. */
  async chunkKeys(id: string): Promise<Array<[number, number]>> {
    const keys = await request(this.db.transaction(CHUNKS).objectStore(CHUNKS).getAllKeys(worldChunks(id)));
    return keys.map((k) => {
      const [, cx, cz] = k as [string, number, number];
      return [cx, cz];
    });
  }

  /** A saved chunk as it is stored (readChunkRecord upgrades and decodes it). */
  async getChunk(id: string, cx: number, cz: number): Promise<ChunkRecord | null> {
    const record = await request(this.db.transaction(CHUNKS).objectStore(CHUNKS).get([id, cx, cz]));
    return (record as ChunkRecord | undefined) ?? null;
  }

  /** Writes a save: the metadata, maybe the player, and chunks, all in one transaction. */
  async save(batch: SaveBatch): Promise<void> {
    const tx = this.db.transaction([WORLDS, PLAYERS, CHUNKS], "readwrite");
    tx.objectStore(WORLDS).put(batch.meta);
    if (batch.player) tx.objectStore(PLAYERS).put(batch.player);
    const chunks = tx.objectStore(CHUNKS);
    for (const c of batch.chunks) chunks.put(c);
    await finished(tx);
  }

  async deleteWorld(id: string): Promise<void> {
    const tx = this.db.transaction([WORLDS, PLAYERS, CHUNKS], "readwrite");
    tx.objectStore(WORLDS).delete(id);
    tx.objectStore(PLAYERS).delete(id);
    tx.objectStore(CHUNKS).delete(worldChunks(id));
    await finished(tx);
  }

  /** Everything saved of a world, upgraded (for exporting and copying). */
  async readWorld(id: string): Promise<WorldData | null> {
    const tx = this.db.transaction([WORLDS, PLAYERS, CHUNKS]);
    const [meta, player, chunks] = await Promise.all([
      request(tx.objectStore(WORLDS).get(id)) as Promise<WorldMeta | undefined>,
      request(tx.objectStore(PLAYERS).get(id)) as Promise<PlayerRecord | undefined>,
      request(tx.objectStore(CHUNKS).getAll(worldChunks(id))) as Promise<ChunkRecord[]>,
    ]);
    if (!meta) return null;
    return {
      meta: upgrade("world", meta),
      player: player ? upgrade("player", player) : null,
      chunks: chunks.map((c) => upgrade("chunk", c)),
    };
  }

  /** Stores a whole world under the id in its metadata (an import or a copy), in one transaction. */
  async writeWorld(data: WorldData): Promise<void> {
    const id = data.meta.id;
    await this.save({
      meta: data.meta,
      player: data.player ? { ...data.player, world: id } : undefined,
      chunks: data.chunks.map((c) => ({ ...c, world: id })),
    });
  }

  /** Copies a world under a new id and name. */
  async duplicateWorld(id: string, copy: { id: string; name: string; created: number }): Promise<WorldMeta | null> {
    const data = await this.readWorld(id);
    if (!data) return null;
    const meta: WorldMeta = { ...data.meta, ...copy, lastPlayed: copy.created };
    await this.writeWorld({ ...data, meta });
    return meta;
  }
}
