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

    // Self-heals rows left over from before record() deduped by name+size
    // (every reopen of the same file used to add a new row instead of
    // updating one) — keep only the most-recently-opened row per file.
    const seen = new Map<string, RecentRecord>();
    const stale: string[] = [];
    for (const record of [...all].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)) {
      const key = `${record.name}::${record.sizeBytes}`;
      if (seen.has(key)) stale.push(record.id);
      else seen.set(key, record);
    }
    if (stale.length > 0) {
      const tx = db.transaction("recents", "readwrite");
      await Promise.all(stale.map((id) => tx.store.delete(id)));
      await tx.done;
    }

    return [...seen.values()]
      .map(({ handle: _handle, ...entry }) => entry)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  },

  async record(entry: RecentFileEntry, handle: FileSystemFileHandle | null): Promise<void> {
    const db = await getDb();

    // `entry.id` is a fresh id per file-*open* (deliberately — see
    // ensureDocumentText.ts, which relies on it changing to detect a
    // document switch mid-operation), not a stable file identity. Without
    // this, reopening the same file repeatedly added a new row every time
    // instead of updating the one already there — name+size is an
    // imperfect but practical stand-in for "the same file" in a sandboxed
    // browser with no persistent file paths to key off of.
    const existingForSameFile = await db.getAllFromIndex("recents", "by-lastOpenedAt");
    const duplicate = existingForSameFile.find((r) => r.name === entry.name && r.sizeBytes === entry.sizeBytes && r.id !== entry.id);
    if (duplicate) await db.delete("recents", duplicate.id);

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
