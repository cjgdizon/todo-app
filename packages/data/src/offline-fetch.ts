/**
 * A `fetch` for the Supabase client that keeps edits made without a connection.
 *
 * A write that cannot reach the server is stored (in order) and answered as if it had
 * been saved, so the optimistic update the hooks already made stands. Stored writes are
 * replayed when `flush()` runs (the app calls it when the browser is back online), and a
 * read waits for them first so it can never bring back rows older than the user's edits.
 *
 * Only PostgREST writes that ask for no rows back are kept (no `Prefer: return=representation`;
 * PostgREST's default is to return nothing): the caller has nothing to read from the answer.
 * Everything else (reads, auth, rpc, writes that return rows) behaves as normal and fails like
 * a normal request.
 *
 * Replays are safe to repeat: updates set the same values again and inserts carry
 * client-made ids, so an insert that already landed answers 409 on its primary key.
 * Conflicts are last-write-wins per row; the database trigger bumps `version`.
 */

export interface OfflineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RejectedWrite {
  url: string;
  method: string;
  status: number;
}

export interface OfflineState {
  pending: number;
  flushing: boolean;
}

export interface OfflineFetchOptions {
  fetch: typeof fetch;
  /** shortcut: localStorage is synchronous and about 5 MB, which holds thousands of edits; move to IndexedDB if that stops being true. */
  storage: OfflineStorage;
  storageKey: string;
  /** The current access token, read at replay time because the one saved with a write may have expired. */
  getAccessToken: () => Promise<string | null>;
  isOnline?: () => boolean;
  /** A replayed write the server refused for good (it is dropped; the caller should refetch and tell the user). */
  onRejected?: (write: RejectedWrite) => void;
  /** Stored edits touched rows that changed on the server while this device was offline (the edits still win). */
  onConflict?: (conflict: { table: string; count: number }) => void;
  maxEntries?: number;
  now?: () => number;
}

export interface OfflineFetch {
  fetch: typeof fetch;
  /** Sends the stored writes, oldest first. Stops (keeping the rest) when the server cannot be reached. */
  flush(): Promise<void>;
  pending(): number;
  subscribe(listener: (state: OfflineState) => void): () => void;
  /** Ties the stored writes to a user; another user's writes are discarded, never sent. */
  bindUser(userId: string | null): void;
  clear(): void;
}

interface Entry {
  url: string;
  method: string;
  headers: [string, string][];
  body: string | null;
  /** When the user made the edit (device clock), to tell which later changes are "meanwhile". */
  at: number;
  /** Whether the server was already asked about changes made meanwhile (once per edit). */
  checked: boolean;
}

interface Stored {
  owner: string | null;
  entries: Entry[];
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const DEFAULT_MAX_ENTRIES = 2000;
// Status codes that mean "try again later", not "this write is wrong".
const RETRY_LATER = (status: number) => status >= 500 || status === 429 || status === 408 || status === 401;

function isRest(url: URL): boolean {
  return url.pathname.startsWith("/rest/v1/") && !url.pathname.startsWith("/rest/v1/rpc/");
}

function load(storage: OfflineStorage, key: string): Stored {
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      if (Array.isArray(parsed.entries)) return { owner: parsed.owner ?? null, entries: parsed.entries };
    }
  } catch {
    // Corrupt or unreadable: start empty.
  }
  return { owner: null, entries: [] };
}

export function createOfflineFetch(options: OfflineFetchOptions): OfflineFetch {
  const { storage, storageKey, getAccessToken, onRejected, onConflict } = options;
  const now = options.now ?? Date.now;
  const real = options.fetch;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const isOnline = options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);

  const stored = load(storage, storageKey);
  let flushing: Promise<void> | null = null;
  const listeners = new Set<(state: OfflineState) => void>();

  const state = (): OfflineState => ({ pending: stored.entries.length, flushing: flushing !== null });
  const commit = () => {
    try {
      if (stored.entries.length === 0 && stored.owner === null) storage.removeItem(storageKey);
      else storage.setItem(storageKey, JSON.stringify(stored));
    } catch {
      // Storage full or blocked: the writes stay queued in memory until the page closes.
    }
    for (const listener of listeners) listener(state());
  };

  const enqueue = (entry: Entry): Response => {
    if (stored.entries.length >= maxEntries) {
      throw new Error("Too many unsynced changes. Reconnect so they can be saved.");
    }
    stored.entries.push(entry);
    commit();
    return new Response(null, { status: entry.method === "POST" ? 201 : 204, headers: { "x-offline-queued": "1" } });
  };

  /**
   * Best effort: asks the server whether the rows an edit targets changed since it was made, by
   * anyone (another member, or this user's other device). Every edit is asked about before the
   * first one is sent, so this device's own replays never count as "meanwhile".
   * shortcut: compares the device clock with the server's `updated_at`, so a badly wrong clock gives a wrong answer; upgrade to a base version per edit if that matters.
   */
  async function checkConflicts(token: string): Promise<void> {
    let found = 0;
    let table = "";
    for (const entry of stored.entries) {
      if (entry.checked) continue;
      entry.checked = true;
      const target = new URL(entry.url);
      const ids = target.searchParams.get("id");
      if (entry.method !== "PATCH" || !ids) continue;
      const check = new URL(target.pathname, target.origin);
      check.searchParams.set("select", "id");
      check.searchParams.set("id", ids);
      check.searchParams.set("updated_at", `gt.${new Date(entry.at).toISOString()}`);
      const headers = new Headers(entry.headers);
      headers.set("authorization", `Bearer ${token}`);
      try {
        const response = await real(check.toString(), { method: "GET", headers });
        const rows: unknown = response.ok ? await response.json() : [];
        if (Array.isArray(rows) && rows.length > 0) {
          found += rows.length;
          table = target.pathname.split("/").pop() ?? "";
        }
      } catch {
        // The edit itself is sent next and handles an unreachable server.
      }
    }
    commit();
    if (found > 0) onConflict?.({ table, count: found });
  }

  async function replay(): Promise<void> {
    while (stored.entries.length > 0) {
      const entry = stored.entries[0]!;
      const token = await getAccessToken();
      if (!token) return;
      if (onConflict && stored.entries.some((e) => !e.checked)) await checkConflicts(token);
      const headers = new Headers(entry.headers);
      headers.set("authorization", `Bearer ${token}`);

      let response: Response;
      try {
        response = await real(entry.url, { method: entry.method, headers, body: entry.body });
      } catch {
        return; // still unreachable
      }
      if (RETRY_LATER(response.status)) return;

      if (!response.ok) {
        const alreadyThere = response.status === 409 && (await response.text()).includes("_pkey");
        if (!alreadyThere) onRejected?.({ url: entry.url, method: entry.method, status: response.status });
      }
      stored.entries.shift();
      commit();
    }
  }

  const flush = (): Promise<void> => {
    if (!flushing) {
      flushing = replay().finally(() => {
        flushing = null;
        commit();
      });
      for (const listener of listeners) listener(state());
    }
    return flushing;
  };

  const offlineFetch: typeof fetch = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : null;
    if (!url || !isRest(url)) return real(input, init);

    if (!WRITE_METHODS.has(method)) {
      if (stored.entries.length > 0) {
        await flush();
        // Rows read now would predate the user's edits and wipe them from the screen.
        if (stored.entries.length > 0) throw new TypeError("Offline changes have not been saved yet");
      }
      return real(input, init);
    }

    const headers = new Headers(init?.headers);
    const prefer = headers.get("prefer") ?? "";
    const wantsRows = prefer.includes("return=") && !prefer.includes("return=minimal");
    if (wantsRows || typeof (init?.body ?? "") !== "string") return real(input, init);

    const kept: [string, string][] = [];
    headers.forEach((value, name) => {
      if (name !== "authorization") kept.push([name, value]);
    });
    const entry: Entry = {
      url: url.toString(),
      method,
      headers: kept,
      body: typeof init?.body === "string" ? init.body : null,
      at: now(),
      checked: false,
    };
    // Behind older stored writes, this one must wait its turn.
    if (stored.entries.length > 0 || !isOnline()) {
      // Made while online (just queued behind older edits): nothing could have changed meanwhile.
      if (isOnline()) entry.checked = true;
      const response = enqueue(entry);
      if (isOnline()) void flush();
      return response;
    }
    try {
      return await real(input, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return enqueue(entry);
    }
  };

  return {
    fetch: offlineFetch,
    flush,
    pending: () => stored.entries.length,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    bindUser(userId) {
      if (stored.owner !== userId) {
        stored.entries = [];
        stored.owner = userId;
        commit();
      }
    },
    clear() {
      stored.entries = [];
      stored.owner = null;
      commit();
    },
  };
}
