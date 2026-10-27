/* global URL, URLSearchParams */
// A stand-in for the parts of Google the calendar sync uses (OAuth token endpoint and the Calendar
// events API), for local checks only. It keeps events in memory and a change log behind sync tokens,
// like the real thing: our own writes show up in the change feed with their new etag.
import { createServer } from "node:http";

export function startMockGoogle(port) {
  let seq = 0;
  const events = new Map();
  const log = []; // { seq, id }
  const requests = [];

  const touch = (id, event) => {
    seq += 1;
    const stored = { ...event, id, etag: `"etag-${seq}"` };
    events.set(id, stored);
    log.push({ seq, id });
    return stored;
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
    });
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const body = await readBody(req);
    requests.push(`${req.method} ${url.pathname}`);

    if (url.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("refresh_token") === "revoked-token") return send(res, 400, { error: "invalid_grant" });
      return send(res, 200, { access_token: "mock-access-token", expires_in: 3600 });
    }

    // Test controls: what the person does in Google itself.
    if (url.pathname === "/_state") return send(res, 200, [...events.values()]);
    if (url.pathname.startsWith("/_edit/")) {
      const id = decodeURIComponent(url.pathname.slice("/_edit/".length));
      return send(res, 200, touch(id, { ...events.get(id), ...JSON.parse(body) }));
    }
    if (url.pathname.startsWith("/_requests")) return send(res, 200, requests.splice(0));

    if (req.headers.authorization !== "Bearer mock-access-token") return send(res, 401, { error: "unauthorized" });
    const match = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (!match) return send(res, 404, { error: "not found" });
    const id = match[2] ? decodeURIComponent(match[2]) : null;

    if (req.method === "POST" && !id) return send(res, 200, touch(`evt${seq + 1}`, JSON.parse(body)));
    if (req.method === "PUT" && id) {
      if (!events.has(id) || events.get(id).status === "cancelled") return send(res, 404, { error: "gone" });
      return send(res, 200, touch(id, JSON.parse(body)));
    }
    if (req.method === "DELETE" && id) {
      if (!events.has(id)) return send(res, 404, { error: "gone" });
      touch(id, { status: "cancelled" });
      return send(res, 204);
    }
    if (req.method === "GET" && !id) {
      const token = url.searchParams.get("syncToken");
      if (token === "expired") return send(res, 410, { error: "sync token expired" });
      const since = token ? Number(token.replace("sync-", "")) : 0;
      const ids = [...new Set(log.filter((entry) => entry.seq > since).map((entry) => entry.id))];
      const items = ids.map((eventId) => events.get(eventId)).filter((event) => token || event.status !== "cancelled");
      return send(res, 200, { items, nextSyncToken: `sync-${seq}` });
    }
    return send(res, 405, { error: "method not allowed" });
  });

  return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve({ server, events })));
}
