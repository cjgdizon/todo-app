import * as rruleModule from "rrule";
import type { Options, RRule as RRuleInstance } from "rrule";

/**
 * rrule ships a UMD bundle as `main` and an ESM build as `module`, with no
 * `exports` map. Bundlers (Vite, Turbopack, Metro) use the ESM build and expose
 * `RRule` as a named export. Plain Node and Deno load the UMD bundle and expose it
 * only under `default`, so `import { RRule } from "rrule"` is `undefined` there.
 * Resolve it once here so the rest of the package works in every runtime.
 */
type RRuleExports = typeof rruleModule;
const lib: RRuleExports =
  "RRule" in rruleModule
    ? rruleModule
    : (rruleModule as unknown as { default: RRuleExports }).default;

export const RRule = lib.RRule;
export type RRule = RRuleInstance;
export type { Options };
