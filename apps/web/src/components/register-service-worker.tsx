"use client";

import { useEffect } from "react";

// The pages a signed-in user is likely to open; saved ahead so they also load offline.
const WARM_PATHS = ["/inbox", "/today", "/upcoming", "/calendar", "/search", "/settings"];

/** Registers the offline service worker (production builds only: dev mode recompiles pages constantly). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => registration.active?.postMessage({ type: "warm", paths: WARM_PATHS }))
      .catch(() => undefined); // The app works the same without it, only not offline.
  }, []);
  return null;
}
