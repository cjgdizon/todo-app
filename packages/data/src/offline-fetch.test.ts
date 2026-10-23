import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOfflineFetch, type OfflineFetch } from "./offline-fetch.ts";

const REST = "http://localhost:54321/rest/v1";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const networkError = () => new TypeError("Failed to fetch");
const write = (offline: OfflineFetch, path: string, body: unknown, method = "PATCH") =>
  offline.fetch(`${REST}/${path}`, {
    method,
    headers: { apikey: "key", authorization: "Bearer old", prefer: "return=minimal", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("offline fetch", () => {
  let storage: ReturnType<typeof memoryStorage>;
  let real: ReturnType<typeof vi.fn<typeof fetch>>;
  let online: boolean;
  const rejected = vi.fn();

  const make = () =>
    createOfflineFetch({
      fetch: real,
      storage,
      storageKey: "outbox",
      getAccessToken: async () => "fresh",
      isOnline: () => online,
      onRejected: rejected,
    });

  beforeEach(() => {
    storage = memoryStorage();
    online = true;
    rejected.mockReset();
    real = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  });

  it("passes reads and online writes straight through", async () => {
    const offline = make();
    await offline.fetch(`${REST}/tasks?select=id`);
    const response = await write(offline, "tasks?id=eq.1", { priority: 1 });
    expect(response.status).toBe(204);
    expect(real).toHaveBeenCalledTimes(2);
    expect(offline.pending()).toBe(0);
  });

  it("queues a write that cannot reach the server and answers as if it was saved", async () => {
    real.mockRejectedValueOnce(networkError());
    const offline = make();
    const response = await write(offline, "tasks", { id: "1" }, "POST");
    expect(response.status).toBe(201);
    expect(response.headers.get("x-offline-queued")).toBe("1");
    expect(offline.pending()).toBe(1);
  });

  it("does not even try the network while the browser says it is offline", async () => {
    online = false;
    const offline = make();
    const response = await write(offline, "tasks?id=eq.1", { priority: 2 });
    expect(response.status).toBe(204);
    expect(real).not.toHaveBeenCalled();
    expect(offline.pending()).toBe(1);
  });

  it("replays queued writes in order with a fresh access token, then is empty", async () => {
    online = false;
    const offline = make();
    await write(offline, "tasks", { id: "1" }, "POST");
    await write(offline, "tasks?id=eq.1", { title: "b" });
    online = true;
    await offline.flush();

    expect(offline.pending()).toBe(0);
    const calls = real.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: init?.method,
      body: init?.body,
      auth: new Headers(init?.headers).get("authorization"),
    }));
    expect(calls).toEqual([
      { url: `${REST}/tasks`, method: "POST", body: '{"id":"1"}', auth: "Bearer fresh" },
      { url: `${REST}/tasks?id=eq.1`, method: "PATCH", body: '{"title":"b"}', auth: "Bearer fresh" },
    ]);
  });

  it("keeps new writes behind older queued ones", async () => {
    online = false;
    const offline = make();
    await write(offline, "tasks?id=eq.1", { title: "a" });
    online = true;
    real.mockRejectedValue(networkError());
    await write(offline, "tasks?id=eq.1", { title: "b" });
    expect(offline.pending()).toBe(2);
  });

  it("makes a read wait for queued writes so it never returns stale rows", async () => {
    online = false;
    const offline = make();
    await write(offline, "tasks?id=eq.1", { title: "a" });
    online = true;
    await offline.fetch(`${REST}/tasks?select=id`);
    expect(real.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["PATCH", "GET"]);
  });

  it("stops at the first network failure and keeps everything left", async () => {
    online = false;
    const offline = make();
    await write(offline, "tasks?id=eq.1", { title: "a" });
    await write(offline, "tasks?id=eq.2", { title: "b" });
    online = true;
    real.mockRejectedValue(networkError());
    await offline.flush();
    expect(offline.pending()).toBe(2);
  });

  it("keeps the queue on server errors and expired tokens, to try again later", async () => {
    online = false;
    const offline = make();
    await write(offline, "tasks?id=eq.1", { title: "a" });
    online = true;
    for (const status of [500, 503, 429, 401]) {
      real.mockResolvedValueOnce(new Response(null, { status }));
      await offline.flush();
      expect(offline.pending()).toBe(1);
    }
    await offline.flush();
    expect(offline.pending()).toBe(0);
  });

  it("drops a write the server refuses, reports it and carries on", async () => {
    online = false;
    const offline = make();
    await write(offline, "tasks?id=eq.1", { title: "bad" });
    await write(offline, "tasks?id=eq.2", { title: "good" });
    online = true;
    real.mockResolvedValueOnce(new Response('{"message":"denied"}', { status: 403 }));
    await offline.flush();
    expect(offline.pending()).toBe(0);
    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", status: 403 }));
    expect(real).toHaveBeenCalledTimes(2);
  });

  it("treats a replayed insert that already exists as done, but other conflicts as refused", async () => {
    online = false;
    const offline = make();
    await write(offline, "tasks", { id: "1" }, "POST");
    await write(offline, "labels", { id: "2" }, "POST");
    online = true;
    real
      .mockResolvedValueOnce(
        new Response('{"message":"duplicate key value violates unique constraint \\"tasks_pkey\\""}', { status: 409 }),
      )
      .mockResolvedValueOnce(
        new Response('{"message":"duplicate key value violates unique constraint \\"labels_name_key\\""}', {
          status: 409,
        }),
      );
    await offline.flush();
    expect(offline.pending()).toBe(0);
    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  });

  it("also keeps writes that say nothing about rows, which is what the Supabase client sends by default", async () => {
    online = false;
    const offline = make();
    const response = await offline.fetch(`${REST}/tasks?id=eq.1`, { method: "PATCH", body: "{}" });
    expect(response.status).toBe(204);
    expect(offline.pending()).toBe(1);
  });

  it("does not queue what it cannot answer for: reads, auth calls, writes that return rows, aborts", async () => {
    const offline = make();
    real.mockRejectedValue(networkError());
    await expect(offline.fetch(`${REST}/tasks?select=id`)).rejects.toThrow("Failed to fetch");
    await expect(
      offline.fetch("http://localhost:54321/auth/v1/token", { method: "POST", headers: { prefer: "return=minimal" } }),
    ).rejects.toThrow("Failed to fetch");
    await expect(
      offline.fetch(`${REST}/tasks?id=eq.1`, { method: "PATCH", headers: { prefer: "return=representation" }, body: "{}" }),
    ).rejects.toThrow("Failed to fetch");
    await expect(
      offline.fetch(`${REST}/rpc/move_project`, { method: "POST", headers: { prefer: "return=minimal" }, body: "{}" }),
    ).rejects.toThrow("Failed to fetch");

    const aborted = new DOMException("aborted", "AbortError");
    real.mockRejectedValue(aborted);
    await expect(write(offline, "tasks?id=eq.1", {})).rejects.toBe(aborted);
    expect(offline.pending()).toBe(0);
  });

  it("survives a reload: a new instance picks the queue up from storage", async () => {
    online = false;
    const first = make();
    first.bindUser("user-a");
    await write(first, "tasks?id=eq.1", { title: "a" });

    const second = make();
    second.bindUser("user-a");
    expect(second.pending()).toBe(1);
    online = true;
    await second.flush();
    expect(second.pending()).toBe(0);
  });

  it("discards another user's queue instead of sending it as the new user", async () => {
    online = false;
    const first = make();
    first.bindUser("user-a");
    await write(first, "tasks?id=eq.1", { title: "a" });

    const second = make();
    second.bindUser("user-b");
    expect(second.pending()).toBe(0);
  });

  describe("edited elsewhere", () => {
    const conflicts = vi.fn();
    const makeBound = () =>
      createOfflineFetch({
        fetch: real,
        storage,
        storageKey: "outbox",
        getAccessToken: async () => "fresh",
        isOnline: () => online,
        onConflict: conflicts,
        now: () => Date.UTC(2026, 9, 21, 12, 0, 0),
      });

    beforeEach(() => conflicts.mockReset());

    it("reports a queued edit when the row changed meanwhile (another member or device), and still saves it", async () => {
      online = false;
      const offline = makeBound();
      offline.bindUser("me");
      await write(offline, "tasks?id=in.(1,2)", { priority: 1 });
      online = true;
      real.mockResolvedValueOnce(new Response('[{"id":"2"}]', { status: 200 }));
      await offline.flush();

      const [checkUrl] = real.mock.calls[0]!;
      const check = new URL(String(checkUrl));
      expect(check.pathname).toBe("/rest/v1/tasks");
      expect(check.searchParams.get("id")).toBe("in.(1,2)");
      expect(check.searchParams.has("updated_by")).toBe(false);
      expect(check.searchParams.get("updated_at")).toBe("gt.2026-10-21T12:00:00.000Z");
      expect(conflicts).toHaveBeenCalledWith({ table: "tasks", count: 1 });
      expect(real.mock.calls[1]![1]?.method).toBe("PATCH");
      expect(offline.pending()).toBe(0);
    });

    it("stays quiet when nobody else touched the row, or the check itself fails", async () => {
      online = false;
      const offline = makeBound();
      offline.bindUser("me");
      await write(offline, "tasks?id=eq.1", { priority: 1 });
      await write(offline, "tasks?id=eq.2", { priority: 1 });
      online = true;
      real
        .mockResolvedValueOnce(new Response("[]", { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockRejectedValueOnce(networkError());
      await offline.flush();
      expect(conflicts).not.toHaveBeenCalled();
    });

    it("asks about every stored edit before sending the first, so its own replays never count", async () => {
      online = false;
      const offline = makeBound();
      await write(offline, "tasks?id=eq.1", { priority: 1 });
      await write(offline, "tasks?id=eq.1", { priority: 2 });
      online = true;
      real.mockImplementation(async (_url, init) =>
        init?.method === "GET" ? new Response("[]", { status: 200 }) : new Response(null, { status: 204 }),
      );
      await offline.flush();
      expect(real.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET", "PATCH", "PATCH"]);
    });

    it("does not look for conflicts on edits queued while online behind older ones", async () => {
      online = false;
      const offline = makeBound();
      await write(offline, "tasks?id=eq.1", { priority: 1 }); // made offline: checked once
      online = true;
      real.mockRejectedValue(networkError());
      await write(offline, "tasks?id=eq.2", { priority: 2 }); // made online behind the first: not checked
      await offline.flush();
      await offline.flush();
      const gets = real.mock.calls.filter(([, init]) => init?.method === "GET");
      expect(gets).toHaveLength(1);
      expect(String(gets[0]![0])).toContain("id=eq.1");
    });

    it("does not look for conflicts on inserts", async () => {
      online = false;
      const offline = makeBound();
      offline.bindUser("me");
      await write(offline, "tasks", { id: "1" }, "POST");
      online = true;
      await offline.flush();
      expect(real).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses to grow without bound", async () => {
    online = false;
    const offline = createOfflineFetch({
      fetch: real,
      storage,
      storageKey: "outbox",
      getAccessToken: async () => "t",
      isOnline: () => online,
      maxEntries: 2,
    });
    await write(offline, "tasks?id=eq.1", {});
    await write(offline, "tasks?id=eq.2", {});
    await expect(write(offline, "tasks?id=eq.3", {})).rejects.toThrow(/too many/i);
  });

  it("tells subscribers when the queue changes", async () => {
    online = false;
    const offline = make();
    const states: number[] = [];
    offline.subscribe((state) => states.push(state.pending));
    await write(offline, "tasks?id=eq.1", {});
    online = true;
    await offline.flush();
    expect(states).toContain(1);
    expect(states.at(-1)).toBe(0);
  });

  it("starts empty when the stored queue is corrupt", () => {
    storage.setItem("outbox", "{not json");
    expect(make().pending()).toBe(0);
  });
});
