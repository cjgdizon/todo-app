/* global self, caches, fetch, Request, Response, URL */
// Service worker: lets the app open and run without a connection.
//  - /_next/static files never change for a given URL: served from the cache first.
//  - Page loads (navigations) go to the network first and fall back to the last copy, so a
//    reload offline still opens the app. The pages hold no user data (that is fetched by the
//    app from Supabase and kept in IndexedDB), and redirects such as "sign in first" are never kept.
//  - Everything else (Supabase, auth, other origins) is left alone.
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const MAX_STATIC_ENTRIES = 600;
const OFFLINE_PAGE =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Offline</title><body style=\"font:16px system-ui;padding:2rem;max-width:32rem;margin:auto\">" +
  "<h1>You're offline</h1><p>This page hasn't been saved on this device yet. Reconnect and open it once.</p>";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== STATIC && key !== PAGES) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** Keeps the static cache from growing with every deploy: drops the oldest entries past the limit. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) await cache.delete(key);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

const pageKey = (url) => new Request(url.origin + url.pathname);

async function networkFirstPage(request) {
  const url = new URL(request.url);
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) await cache.put(pageKey(url), response.clone());
    return response;
  } catch {
    return (
      (await cache.match(pageKey(url))) ??
      new Response(OFFLINE_PAGE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate" && !url.pathname.startsWith("/auth")) {
    event.respondWith(networkFirstPage(request));
  }
});

/** Saves pages and the scripts they load ahead of time, so routes not yet visited also open offline. */
async function warm(paths) {
  const pages = await caches.open(PAGES);
  const assets = await caches.open(STATIC);
  for (const path of paths) {
    try {
      const url = new URL(path, self.location.origin);
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok || response.redirected) continue;
      await pages.put(pageKey(url), response.clone());
      const html = await response.text();
      const files = new Set(html.match(/\/_next\/static\/[^"'\\\s)<>]+/g) ?? []);
      for (const file of files) {
        if (!(await assets.match(file))) {
          const asset = await fetch(file);
          if (asset.ok) await assets.put(file, asset);
        }
      }
    } catch {
      // Offline or a failing page: skip it, it is only a head start.
    }
  }
  await trim(assets);
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "warm" && Array.isArray(event.data.paths)) {
    event.waitUntil(warm(event.data.paths));
  }
});
