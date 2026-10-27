/**
 * The `state` value of an OAuth sign-in: it travels to Google and comes back unchanged, and it is
 * the only thing that ties the returning browser to the person who started the flow (the return
 * request carries no login). So it is signed with a server secret, expires after ten minutes, and
 * is different every time. Anything altered, expired or signed with another secret is refused.
 */

const TTL_MS = 10 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const NONCE_BYTES = 16;
const encoder = new TextEncoder();

export interface OAuthStatePayload {
  userId: string;
  workspaceId: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signOAuthState(payload: OAuthStatePayload, secret: string, now: Date): Promise<string> {
  if (secret.length < MIN_SECRET_LENGTH) throw new RangeError(`The state secret must be at least ${MIN_SECRET_LENGTH} characters`);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const body = toBase64Url(
    encoder.encode(JSON.stringify({ u: payload.userId, w: payload.workspaceId, e: now.getTime() + TTL_MS, n: toBase64Url(nonce) })),
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** Who the state was made for, or null if it is forged, altered, expired or malformed. */
export async function verifyOAuthState(state: string, secret: string, now: Date): Promise<OAuthStatePayload | null> {
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  try {
    // `verify` compares in constant time.
    const genuine = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromBase64Url(signature), encoder.encode(body));
    if (!genuine) return null;
    const data: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (typeof data !== "object" || data === null) return null;
    const { u, w, e } = data as Record<string, unknown>;
    if (typeof u !== "string" || typeof w !== "string" || typeof e !== "number") return null;
    return now.getTime() <= e ? { userId: u, workspaceId: w } : null;
  } catch {
    return null; // not valid base64 or JSON
  }
}
