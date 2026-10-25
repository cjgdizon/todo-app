/**
 * Where sign-in may send someone afterwards. An allow-list of one: the invite page with a token,
 * so an invite link survives the sign-in redirect. Anything else is refused, which keeps `next`
 * from ever becoming an open redirect.
 */
const TOKEN = "[A-Za-z0-9]{1,128}";
const INVITE_TOKEN = new RegExp(`^${TOKEN}$`);
const INVITE_PATH = new RegExp(`^/join\\?token=${TOKEN}$`);

export const isInviteToken = (value: string | null): value is string => value !== null && INVITE_TOKEN.test(value);

export function safeNext(value: string | null): string | null {
  return value !== null && INVITE_PATH.test(value) ? value : null;
}

/** The link an admin shares. The token is shown once; only its hash is stored. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/join?token=${encodeURIComponent(token)}`;
}
