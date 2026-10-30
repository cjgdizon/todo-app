# Obsidian Today Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the web PWA and the Expo app from "Calm minimal" (sage, Inter) to "Obsidian Today": platinum accent, pure white light mode, obsidian dark mode, Fraunces headings, a Next up card, and the completion, swipe and end-of-day motion.

**Architecture:** Colors flow from one source, `packages/ui-tokens/src/tokens.ts` (web CSS is generated from it, mobile imports it), so the palette change is a token edit plus the existing contrast test. Two small pure selectors in `@todo/data` feed a shared "Next up" card and progress line on the Today screen of both apps. Fonts, glass and motion are per-platform.

**Tech Stack:** Next 16, Tailwind 4, `next/font/google`, Expo 58 / React Native 0.88 (`expo-font`, `@expo-google-fonts/*`, `expo-haptics`), Vitest, Playwright.

**Spec:** `design/obsidian-today-final.html` is the visual reference (light and dark Today screens). The values below are copied from it and win over the older `design/obsidian-today-spec.html`, which still shows verdigris and must not be committed.

## Global Constraints

- Change `DESIGN.md` first, then `tokens.ts`, then code (project rule in `CLAUDE.md`).
- Light mode: bg `#FFFFFF`, surface `#FAFBFC`, text `#151A20`, text-muted `#566069`, accent `#4A5565`, accent-strong `#3B4553`, on-accent `#F5F7FA`, danger `#A83A2E`, warning `#8A5F0C`.
- Dark mode: bg `#0C0D0F`, surface `#17191C`, text `#ECEDEF`, text-muted `#A6ABB2`, accent `#B9C0CC`, accent-strong `#DDE2EA`, on-accent `#0E1116`, danger `#E5877D`, warning `#E0B35A`.
- Tokens with no value in the mock (my call, tune them in Task 1 until the contrast test passes): `surface-subtle` light `#F2F4F6` / dark `#1F2225`, `border` light `#E3E4E4` / dark `#2A2D31`, `accent-subtle` light `#E9ECF1` / dark `#1E2228`, `focus-ring` = `accent-strong`. `priority-1` = `danger`, `priority-2` = `warning`, `priority-3` unchanged.
- WCAG 2.2 AA must still hold for every pair in `tokens.test.ts`. Never color alone: P1 keeps its flag icon and "P1" text.
- Fonts: Fraunces 300 and 400 for headings, Hanken Grotesk 400, 500 and 600 for everything else. Sentence case, no all-caps labels.
- Type scale (size/line): display 44/46, focus time 48/48, title 28/34, heading 21/26, section 18/24 (Fraunces); task 16/22 (500), body 15/22, meta 13/18, tab label 12/16 (Hanken Grotesk).
- Motion: ring fill 120 ms; check draw 160 ms after 40 ms; title strike 220 ms after 80 ms; row closes 180 ms after 600 ms; Undo toast 5 s; swipe threshold 96 px with 0.35 resistance beyond it and a 180 ms settle with no overshoot; end-of-day cross-fade 600 ms. Reduced motion means instant state changes.
- Glass: fill 6% white (dark) / 72% white (light), 22 px blur, 1 px edge. Used only for the Next up card, the tab dock and sheets.
- No new hosted-database changes. No `any`. One milestone per PR.

## Review Focus

- A task due today with no time (all-day) must never appear as the Next up card. Test in Task 3.
- Every task done: card absent, progress full, header says "Nothing left today". Test in Task 3 and Task 4.
- No tasks due today at all: no card, no progress line, the existing empty message stays. Test in Task 3.
- A task completed by Undo must return the card and progress to the earlier state. Test in Task 4.
- Light text on the platinum accent in light mode, and muted text on `surface-subtle`, are the likeliest contrast failures. Test in Task 1.

---

### Task 1: New palette and DESIGN.md

**Files:**
- Modify: `DESIGN.md`, `packages/ui-tokens/src/tokens.ts`, `packages/ui-tokens/src/tokens.test.ts`, `packages/ui-tokens/tokens.css` (generated)
- Create: `design/obsidian-today-final.html` (committed as the visual reference)

**Interfaces:**
- Produces: `colors.light` / `colors.dark` with the same `ColorName` keys as today, new values from Global Constraints. Nothing else in the repo changes shape.

- [ ] **Step 1: Rewrite `DESIGN.md`** to the Obsidian Today direction: principles (next task loudest, glass floats and list lies flat, serif for meaning and sans for work, restraint), the color table from Global Constraints, the type scale, the glass recipe and the motion list. Keep the sections Accessibility, Voice and copy, and Do / Don't.
- [ ] **Step 2: Add the failing test** in `tokens.test.ts`: add the contrast pair `["text-muted","accent-subtle",4.5]` to the existing list, and assert `colors.light.bg === "#ffffff"` and `colors.dark.accent === "#b9c0cc"`.
- [ ] **Step 3: Run** `pnpm --filter @todo/ui-tokens test`. Expected: FAIL on the two value assertions.
- [ ] **Step 4: Replace the values in `tokens.ts`** (lowercase hex, as the file does today). Adjust only the "my call" tokens until every contrast pair passes.
- [ ] **Step 5: Regenerate and run** `pnpm --filter @todo/ui-tokens generate` then `pnpm --filter @todo/ui-tokens test`. Expected: PASS, including "tokens.css is the committed output".
- [ ] **Step 6: Commit** `git add DESIGN.md packages/ui-tokens design/obsidian-today-final.html` with `feat(design): obsidian today palette`.

### Task 2: Fonts and headings on web

**Files:**
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`

**Interfaces:**
- Produces: CSS variables `--font-serif` and `--font-sans`; every `h1`, `h2`, `h3` renders in Fraunces weight 300 (400 for `h3`).

- [ ] **Step 1: In `layout.tsx`** replace `Inter` with `Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["300","400"] })` and `Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], weight: ["400","500","600"] })`, and put both variables on `<html>`.
- [ ] **Step 2: In `globals.css`** set `--font-sans: var(--font-hanken), system-ui, sans-serif;`, add `--font-serif: var(--font-fraunces), Georgia, serif;` to the `@theme inline` block, and add a base rule `h1, h2 { font-family: var(--font-serif); font-weight: 300; letter-spacing: -0.01em; } h3 { font-family: var(--font-serif); font-weight: 400; }`.
- [ ] **Step 3: Run** `pnpm --filter @todo/web build:e2e` then `pnpm --filter @todo/web typecheck`. Expected: both succeed. The font fetch has failed once before in CI; if it recurs, bundle the font files in the repo instead.
- [ ] **Step 4: Commit** `feat(web): fraunces headings, hanken grotesk body`.

### Task 3: Next up and progress selectors

**Files:**
- Modify: `packages/data/src/views.ts`, `packages/data/src/index.ts` (export)
- Test: `packages/data/src/views.test.ts`

**Interfaces:**
- Produces: `nextUpTask(tasks: readonly Task[], ctx: ViewContext): Task | null` and `todayProgress(tasks: readonly Task[], ctx: ViewContext): { done: number; total: number }`.
- Rules (my call): Next up is the earliest open task whose `dueBucket` is `"today"` and whose `dueAllDay` is false and whose `dueAt` is at or after now; if none, the earliest open timed task due today; otherwise `null`. Progress `total` is open tasks bucketed `"today"` or `"overdue"` plus tasks whose `completedAt` falls on today in `ctx`'s time zone; `done` is the second group.

- [ ] **Step 1: Write failing tests** named `nextUpTask picks the earliest timed task still ahead today`, `nextUpTask ignores all-day tasks`, `nextUpTask falls back to the earliest timed task already past`, `nextUpTask returns null when nothing is due today`, `todayProgress counts done today against open today and overdue`, `todayProgress is 0 of 0 with nothing due`. Use the existing task fixture helpers in `views.test.ts`.
- [ ] **Step 2: Run** `pnpm --filter @todo/data test -- views`. Expected: FAIL with the two functions not exported.
- [ ] **Step 3: Implement both** in `views.ts` using `dueBucket` and the same ordering as `byUrgency`; reuse `ctx` for the "completed today" check through the helper `dueBucket` already uses.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm --filter @todo/data typecheck`.
- [ ] **Step 5: Commit** `feat(data): next up task and today progress`.

### Task 4: Web Today screen: Next up card, progress, end of day

**Files:**
- Create: `apps/web/src/components/next-up-card.tsx`
- Modify: `apps/web/src/components/view-screens.tsx` (Today only), `apps/web/src/app/globals.css` (`.glass` utility)
- Test: `apps/web/e2e/today.spec.ts`

**Interfaces:**
- Consumes: `nextUpTask`, `todayProgress` from Task 3; the existing task completion hook used by `task-row.tsx`.
- Produces: `NextUpCard({ task, onComplete }: { task: Task; onComplete: (id: string) => void })`, rendered above the Today list, plus a progress line (`role="progressbar"`, label "N of M done") and, when `done === total && total > 0`, a heading line "Nothing left today" that cross-fades in over 600 ms.

- [ ] **Step 1: Write the failing e2e** `today shows next up, progress and the finished state`: sign up through the real form, add two tasks due today with times, expect the card to show the earlier one, complete it, expect the card to switch to the second and the progress to read "1 of 2 done", complete the second, expect "Nothing left today" and no card. Then Undo and expect the card back (Review Focus 4).
- [ ] **Step 2: Run** `pnpm --filter @todo/web e2e -- today`. Expected: FAIL (no card). Needs `pnpm db:start`.
- [ ] **Step 3: Add a `.glass` class** in `globals.css` using Global Constraints values, with `@supports not (backdrop-filter: blur(1px))` falling back to `var(--surface)`.
- [ ] **Step 4: Build `NextUpCard`** per the spec screen: "Next up" small label, the due time in Fraunces 300 at 48/48 in `accent-strong`, the title in Fraunces 400 21/26, a P1 flag with text when priority is 1, project name, and the checkbox on the right. Wire it into the Today branch of `view-screens.tsx` only.
- [ ] **Step 5: Run** the e2e again and `pnpm --filter @todo/web typecheck && pnpm --filter @todo/web lint`. Expected: PASS, and the axe scans in `e2e/` stay green.
- [ ] **Step 6: Commit** `feat(web): next up card, progress line and finished state`.

### Task 5: Web completion motion

**Files:**
- Modify: `apps/web/src/components/task-row.tsx`, `apps/web/src/app/globals.css`
- Test: `apps/web/e2e/today.spec.ts` (extend)

**Interfaces:**
- Produces: on completion the checkbox ring fills (120 ms), its check mark draws (160 ms after 40 ms), the title strikes left to right (220 ms after 80 ms), then the existing `row-leave` animation runs after 600 ms.

- [ ] **Step 1: Add the failing assertion** to `today.spec.ts`: after clicking a checkbox, the row has `data-completing="true"` and the title's computed `background-size` reaches `100%`; with `reducedMotion: "reduce"` set in the context, the same state is reached with no animation delay.
- [ ] **Step 2: Run** the spec. Expected: FAIL on the missing attribute.
- [ ] **Step 3: Implement** with CSS only: a stroke-dash check mark and a `background-size` transition on the title, driven by the row's existing "completing" state. Reuse the `--ease-*` tokens; the 40, 80 and 220 ms values are written as literals in `globals.css`, as listed in Global Constraints.
- [ ] **Step 4: Run** the spec and `pnpm --filter @todo/web lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): completion motion`.

### Task 6: Mobile fonts, glass fallback and Today screen

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/lib/theme.ts`, `apps/mobile/src/app/(tabs)/today.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/components/task-list.tsx`
- Create: `apps/mobile/src/components/next-up-card.tsx`
- Test: `apps/mobile/src/components/next-up-card.test.tsx` if the package already has a React Native test setup; otherwise a Maestro flow in `apps/mobile/.maestro/today.yaml`.

**Interfaces:**
- Consumes: Task 3 selectors, `useTheme()` from `theme.ts`.
- Produces: `fonts = { serifLight, serif, sans, sansMedium, sansSemibold }` exported from `theme.ts` (PostScript names from `@expo-google-fonts/fraunces` and `@expo-google-fonts/hanken-grotesk`); `NextUpCard` with the same props and look as web; tab bar styled as the rounded dock.

- [ ] **Step 1: Install** `pnpm --filter @todo/mobile add @expo-google-fonts/fraunces @expo-google-fonts/hanken-grotesk expo-font` (use `npx expo install` for `expo-font` so the version matches Expo 58).
- [ ] **Step 2: Load the fonts** with `useFonts` in `_layout.tsx` and keep the splash screen visible until they load.
- [ ] **Step 3: Build `NextUpCard`** and the progress line in the Today screen. Glass is a solid `surface` fill with the 1 px edge on mobile for now (my call: `expo-blur` is not installed; revisit after the first device check).
- [ ] **Step 4: Restyle the tab bar** in `(tabs)/_layout.tsx` as the rounded dock with the active tab in `accent-strong`, keeping labels visible and the 48 dp touch targets.
- [ ] **Step 5: Run** `pnpm --filter @todo/mobile typecheck && pnpm --filter @todo/mobile build`. Expected: both succeed (the build is the Android bundle compile check).
- [ ] **Step 6: Commit** `feat(mobile): fraunces and hanken grotesk, next up card, dock tab bar`.

### Task 7: Mobile haptics and swipe feel

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/src/components/swipe-row.tsx`, `apps/mobile/src/components/task-row.tsx`
- Create: `apps/mobile/src/lib/haptics.ts`

**Interfaces:**
- Produces: `completionTap(): void` (light impact) and `thresholdTick(): void` (selection feedback), both swallowing errors so a device without haptics does nothing.

- [ ] **Step 1: Install** with `npx expo install expo-haptics` inside `apps/mobile`.
- [ ] **Step 2: Implement `haptics.ts`** with the two functions above.
- [ ] **Step 3: Call `completionTap`** when a task is completed, and `thresholdTick` once per drag when the swipe passes 96 px (reset when it drops back under), with 0.35 resistance past 96 px and a 180 ms settle to zero on release in `swipe-row.tsx`. Every swipe action stays reachable as an accessibility action.
- [ ] **Step 4: Run** `pnpm --filter @todo/mobile typecheck && pnpm --filter @todo/mobile build`. Expected: both succeed.
- [ ] **Step 5: Commit** `feat(mobile): haptics and swipe resistance`.

### Task 8: Icons, manifest and splash

**Files:**
- Modify: `apps/web/src/app/manifest.ts:12-13`, `apps/web/src/app/icon.tsx:21,26`, `apps/mobile/app.json:17,30`

**Interfaces:**
- Produces: PWA `background_color` `#ffffff`, `theme_color` `#0C0D0F`; icon with platinum `#B9C0CC` check on obsidian `#0C0D0F`; mobile splash background `#FFFFFF`, adaptive icon background `#0C0D0F`.

- [ ] **Step 1: Edit the four values** above to the colors in Interfaces.
- [ ] **Step 2: Run** `pnpm --filter @todo/web build:e2e` and open `/manifest.webmanifest`. Expected: the new colors and a 200 for `/icon/...`.
- [ ] **Step 3: Commit** `feat: obsidian today icon and splash colors`.

### Task 9: Full verification and release

- [ ] **Step 1: Run** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: all green.
- [ ] **Step 2: Run the whole e2e** with `pnpm db:start` up (Sonnet subagent, per your routing rule). Expected: all pass, including the axe scans in both themes.
- [ ] **Step 3: Check by eye** on web in light and dark, at 320 px and at 200% text size, with reduced motion on and off. Check mobile in Expo Go on a real device (not yet verified for any mobile work).
- [ ] **Step 4: Open one PR** `feat: obsidian today look` from a branch. Haiku subagent checks CI. Merging to `main` deploys the web app to Vercel. Hosted Supabase is untouched.
