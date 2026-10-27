/** A comment can mention at most this many people. The database enforces the same limit. */
export const MAX_MENTIONS = 20;

const MIN_NAME_LENGTH = 2;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export interface Mentionable {
  userId: string;
  displayName: string;
}

/** A stretch of a comment: plain text, or an `@Name` that refers to a member. */
export interface MentionPart {
  text: string;
  userId?: string;
}

/**
 * Cuts a comment into plain text and `@Name` mentions of the given members. An `@` counts only at
 * the start of a word, the whole name must follow (the longest matching name wins, case ignored)
 * and it must end the word, so `x@Ana.com` and `@Anabel` mention nobody. Every character of the
 * comment ends up in exactly one part.
 */
export function splitMentions(body: string, members: readonly Mentionable[]): MentionPart[] {
  const candidates = members
    .map((member) => ({ userId: member.userId, name: member.displayName.trim().toLowerCase() }))
    .filter((candidate) => candidate.name.length >= MIN_NAME_LENGTH)
    .sort((a, b) => b.name.length - a.name.length);
  const lower = body.toLowerCase();

  const parts: MentionPart[] = [];
  let plainFrom = 0;
  let i = 0;
  while (i < body.length) {
    const startsWord = i === 0 || !WORD_CHAR.test(body.charAt(i - 1));
    const match =
      body.charAt(i) === "@" && startsWord
        ? candidates.find((candidate) => {
            const end = i + 1 + candidate.name.length;
            return lower.startsWith(candidate.name, i + 1) && (end >= body.length || !WORD_CHAR.test(body.charAt(end)));
          })
        : undefined;
    if (!match) {
      i += 1;
      continue;
    }
    if (i > plainFrom) parts.push({ text: body.slice(plainFrom, i) });
    const end = i + 1 + match.name.length;
    parts.push({ text: body.slice(i, end), userId: match.userId });
    plainFrom = end;
    i = end;
  }
  if (plainFrom < body.length) parts.push({ text: body.slice(plainFrom) });
  return parts;
}

/** The members a comment mentions, each once, in order of appearance (at most {@link MAX_MENTIONS}). */
export function findMentions(body: string, members: readonly Mentionable[]): string[] {
  const ids = new Set<string>();
  for (const part of splitMentions(body, members)) if (part.userId) ids.add(part.userId);
  return [...ids].slice(0, MAX_MENTIONS);
}
