// The only code that talks to Google. Every address can be overridden from the environment so a
// local test can point it at a stand-in server; in production the defaults are used. Nothing here
// logs tokens, event text or response bodies: only status codes.
import { z } from "zod";
import type { CalendarPort, ChangedEvent } from "@todo/core/calendar-engine";
import type { GoogleEvent } from "@todo/core/calendar-sync";

export const GOOGLE = {
  api: Deno.env.get("GOOGLE_API_BASE") ?? "https://www.googleapis.com/calendar/v3",
  token: Deno.env.get("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token",
  revoke: Deno.env.get("GOOGLE_REVOKE_URL") ?? "https://oauth2.googleapis.com/revoke",
  auth: Deno.env.get("GOOGLE_AUTH_URL") ?? "https://accounts.google.com/o/oauth2/v2/auth",
};
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 250;
const MAX_PAGES = 20;

/** A Google request that failed. Carries the status code only. */
export class GoogleError extends Error {
  constructor(readonly status: number) {
    super(`Google answered ${status}`);
    this.name = "GoogleError";
  }
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set");
  return { clientId, clientSecret };
}

const tokenResponse = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional() });

async function tokenRequest(form: Record<string, string>): Promise<Response> {
  return await fetch(GOOGLE.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** A short-lived access token for a saved refresh token, or "revoked" when Google no longer honours it. */
export async function refreshAccessToken(refreshToken: string): Promise<string | "revoked"> {
  const { clientId, clientSecret } = clientCredentials();
  const response = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (response.status === 400 || response.status === 401) {
    const body = await response.json().catch(() => null);
    if (body && typeof body === "object" && (body as { error?: unknown }).error === "invalid_grant") return "revoked";
  }
  if (!response.ok) throw new GoogleError(response.status);
  return tokenResponse.parse(await response.json()).access_token;
}

/** Swaps the one-time code from the consent screen for tokens. Needs a refresh token to be useful. */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { clientId, clientSecret } = clientCredentials();
  const response = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!response.ok) throw new GoogleError(response.status);
  const parsed = tokenResponse.parse(await response.json());
  if (!parsed.refresh_token) throw new Error("Google did not return a refresh token");
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token };
}

/** Tells Google to forget a grant. Best effort: a failure here must not block disconnecting. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(GOOGLE.revoke, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);
}

function api(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GOOGLE.api}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const when = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
const eventResource = z.object({
  id: z.string().min(1),
  etag: z.string().optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  start: when.optional(),
  end: when.optional(),
  recurrence: z.array(z.string()).optional(),
  extendedProperties: z.object({ private: z.record(z.string()).optional() }).optional(),
});
const eventPage = z.object({
  items: z.array(eventResource).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

/** A dedicated calendar for the tasks, so they stay apart from the person's own events. */
export async function createTasksCalendar(accessToken: string, timeZone: string): Promise<string> {
  const response = await api(accessToken, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: "Tasks", description: "Tasks from your to-do app", timeZone }),
  });
  if (!response.ok) throw new GoogleError(response.status);
  return z.object({ id: z.string().min(1) }).parse(await response.json()).id;
}

/** One person's calendar as the sync engine sees it. */
export function calendarPort(accessToken: string, calendarId: string): CalendarPort {
  const events = `/calendars/${encodeURIComponent(calendarId)}/events`;

  return {
    async createEvent(event: GoogleEvent) {
      const response = await api(accessToken, events, { method: "POST", body: JSON.stringify(event) });
      if (!response.ok) throw new GoogleError(response.status);
      const created = eventResource.parse(await response.json());
      return { id: created.id, etag: created.etag ?? "" };
    },

    async updateEvent(eventId: string, event: GoogleEvent) {
      const response = await api(accessToken, `${events}/${encodeURIComponent(eventId)}`, {
        method: "PUT",
        body: JSON.stringify(event),
      });
      if (response.status === 404 || response.status === 410) return "gone" as const;
      if (!response.ok) throw new GoogleError(response.status);
      return { etag: eventResource.parse(await response.json()).etag ?? "" };
    },

    async deleteEvent(eventId: string) {
      const response = await api(accessToken, `${events}/${encodeURIComponent(eventId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404 && response.status !== 410) throw new GoogleError(response.status);
    },

    async listChanges(syncToken: string | null) {
      const collected: ChangedEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ showDeleted: "true", maxResults: String(PAGE_SIZE) });
        if (syncToken) query.set("syncToken", syncToken);
        if (pageToken) query.set("pageToken", pageToken);
        const response = await api(accessToken, `${events}?${query}`);
        if (response.status === 410) return "token-expired" as const;
        if (!response.ok) throw new GoogleError(response.status);
        const parsed = eventPage.parse(await response.json());
        for (const item of parsed.items) collected.push({ ...item, etag: item.etag ?? "" });
        if (parsed.nextPageToken) {
          pageToken = parsed.nextPageToken;
          continue;
        }
        if (!parsed.nextSyncToken) throw new Error("Google did not return a sync token");
        return { events: collected, nextSyncToken: parsed.nextSyncToken };
      }
      throw new Error("The calendar has too many changes to read at once");
    },
  };
}
