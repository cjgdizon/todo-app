// Must be the first import of the app. Gives React Native a synchronous `localStorage` (backed by
// SQLite, so it survives restarts) for the session, the offline write queue and the saved cache,
// and the `crypto.randomUUID` the data hooks use for client-made ids (Hermes has none).
import "expo-sqlite/localStorage/install";
import * as ExpoCrypto from "expo-crypto";

const existing: Partial<Crypto> = globalThis.crypto ?? {};
if (typeof existing.randomUUID !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      ...existing,
      randomUUID: ExpoCrypto.randomUUID,
      getRandomValues: existing.getRandomValues ?? ExpoCrypto.getRandomValues,
    },
  });
}
