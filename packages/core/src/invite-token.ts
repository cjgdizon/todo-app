// A real invite code is 64 characters; anything much shorter is not one, which keeps a stray word
// from being taken for a code. The server is the judge of whether a code is valid.
const CODE = "[A-Za-z0-9]{20,128}";
const BARE = new RegExp(`^${CODE}$`);
const IN_LINK = new RegExp(`[?&]token=(${CODE})(?![A-Za-z0-9])`);

/** The invite code in what a person pasted: the bare code, or a whole invite link (even inside a message). */
export function inviteTokenFrom(text: string): string | null {
  const trimmed = text.trim();
  if (BARE.test(trimmed)) return trimmed;
  return IN_LINK.exec(trimmed)?.[1] ?? null;
}
