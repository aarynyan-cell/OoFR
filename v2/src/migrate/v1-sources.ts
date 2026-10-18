// Reads OoFR 1.0's saved data on this device. Strictly read-only:
//  - 1.0 1.0.0 keeps its state in localStorage ("oofr.app.v1");
//  - the 1.0 refactor keeps it in IndexedDB "oofr-state" (store "kv", value
//    { savedAt, json }), with localStorage marking when its copy is newer;
//  - recordings are Blobs in IndexedDB "oofr-audio" (store "recordings", keyed by mediaKey).
// Opening a database that does not exist would create an empty one, which 1.0
// would then fail to set up; openExisting() aborts in that case instead.

export const V1_STATE_KEY = "oofr.app.v1";
export const V1_LEGACY_NEWER_KEY = "oofr.state.legacy-newer";
export const V1_STATE_DB = "oofr-state";
export const V1_STATE_STORE = "kv";
export const V1_AUDIO_DB = "oofr-audio";
export const V1_AUDIO_STORE = "recordings";

export interface V1Environment {
  indexedDB?: IDBFactory;
  localStorage?: Pick<Storage, "getItem">;
}

export type V1StateRead =
  | { status: "none" }
  | { status: "found"; raw: unknown; from: "indexeddb" | "localstorage" }
  | { status: "unreadable"; from: "indexeddb" | "localstorage"; error: string };

function defaultEnvironment(): V1Environment {
  let localStorage: Storage | undefined;
  try {
    localStorage = globalThis.localStorage;
  } catch {
    localStorage = undefined;
  }
  return { indexedDB: globalThis.indexedDB, localStorage };
}

export function openExisting(factory: IDBFactory, name: string, timeoutMs = 4000): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: IDBDatabase | null) => {
      if (settled) {
        value?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name);
    } catch {
      done(null);
      return;
    }
    request.onupgradeneeded = (event) => {
      // oldVersion 0 means the database did not exist: undo the creation.
      if (event.oldVersion === 0) request.transaction?.abort();
    };
    request.onsuccess = () => done(request.result);
    request.onerror = (event) => {
      event.preventDefault?.();
      done(null);
    };
    request.onblocked = () => done(null);
  });
}

function getValue<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) {
      resolve(undefined);
      return;
    }
    try {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

interface StateRecord {
  savedAt?: string;
  json?: string;
}

export async function readV1State(env: V1Environment = defaultEnvironment()): Promise<V1StateRead> {
  let record: StateRecord | undefined;
  if (env.indexedDB) {
    const db = await openExisting(env.indexedDB, V1_STATE_DB);
    if (db) {
      record = await getValue<StateRecord>(db, V1_STATE_STORE, V1_STATE_KEY);
      db.close();
    }
  }
  const local = safeGet(env.localStorage, V1_STATE_KEY);
  const marker = safeGet(env.localStorage, V1_LEGACY_NEWER_KEY);
  const localIsNewer = Boolean(local) && Boolean(marker) && (!record?.savedAt || String(marker) > record.savedAt);

  if (record?.json && !localIsNewer) return parse(record.json, "indexeddb");
  if (local) return parse(local, "localstorage");
  return { status: "none" };
}

function safeGet(storage: V1Environment["localStorage"], key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function parse(text: string, from: "indexeddb" | "localstorage"): V1StateRead {
  try {
    return { status: "found", raw: JSON.parse(text), from };
  } catch (error) {
    return { status: "unreadable", from, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readV1Recordings(keys: string[], env: V1Environment = defaultEnvironment()): Promise<Map<string, Blob>> {
  const blobs = new Map<string, Blob>();
  if (!keys.length || !env.indexedDB) return blobs;
  const db = await openExisting(env.indexedDB, V1_AUDIO_DB);
  if (!db) return blobs;
  try {
    for (const key of keys) {
      const value = await getValue<unknown>(db, V1_AUDIO_STORE, key);
      if (value instanceof Blob && value.size > 0) blobs.set(key, value);
    }
  } finally {
    db.close();
  }
  return blobs;
}
