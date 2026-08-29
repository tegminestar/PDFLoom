import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { RecentFileEntry } from "../types";

interface RecentRecord extends RecentFileEntry {
  /** Structured-cloneable; only ever populated on browsers with File System Access support. */
  handle: FileSystemFileHandle | null;
}

interface LoomDB extends DBSchema {
  recents: {
    key: string;
    value: RecentRecord;
    indexes: { "by-lastOpenedAt": number };
  };
}

const DB_NAME = "pdfloom";
const DB_VERSION = 1;
const MAX_RECENTS = 20;

let dbPromise: Promise<IDBPDatabase<LoomDB>> | null = null;

function getDb(): Promise<IDBPDatabase<LoomDB>> {
  dbPromise ??= openDB<LoomDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore("recents", { keyPath: "id" });
      store.createIndex("by-lastOpenedAt", "lastOpenedAt");
    },
  });
  return dbPromise;
}

export const recentsStore = {
  async list(): Promise<RecentFileEntry[]> {
    const db = await getDb();
    const all = await db.getAllFromIndex("recents", "by-lastOpenedAt");
    return all
      .map(({ handle: _handle, ...entry }) => entry)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  },

  async record(entry: RecentFileEntry, handle: FileSystemFileHandle | null): Promise<void> {
    const db = await getDb();
    await db.put("recents", { ...entry, handle });

    const all = await db.getAllFromIndex("recents", "by-lastOpenedAt");
    if (all.length > MAX_RECENTS) {
      const excess = all.sort((a, b) => a.lastOpenedAt - b.lastOpenedAt).slice(0, all.length - MAX_RECENTS);
      const tx = db.transaction("recents", "readwrite");
      await Promise.all(excess.map((item) => tx.store.delete(item.id)));
      await tx.done;
    }
  },

  async getHandle(id: string): Promise<FileSystemFileHandle | null> {
    const db = await getDb();
    const record = await db.get("recents", id);
    return record?.handle ?? null;
  },

  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.delete("recents", id);
  },

  async clear(): Promise<void> {
    const db = await getDb();
    await db.clear("recents");
  },
};
