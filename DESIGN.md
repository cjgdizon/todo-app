# Design direction: Calm minimal

The app should feel like a quiet desk: nothing shouts, nothing blinks, the task in front of you is the loudest thing on screen. Read this before writing any UI. Tokens below are the source of truth for `packages/ui-tokens`; web (Tailwind/shadcn) and mobile (NativeWind) consume the same values.

## Principles
1. **Content first.** Tasks are the interface. Chrome (borders, icons, toolbars) is faint until you need it.
2. **One accent, used sparingly.** Sage green marks the single primary action and the current selection. Everything else is neutral.
3. **Quiet by default, clear on demand.** Secondary actions (edit, snooze, drag handle) appear on hover/focus on web and via swipe on mobile, but stay reachable by keyboard and screen reader.
4. **Space over lines.** Separate with whitespace and subtle surface shifts before reaching for borders or shadows.
5. **Instant and gentle.** Local actions are optimistic (no spinners). Motion is short, eased, and never required to understand state.
6. **Never rely on color alone.** Priority, overdue and error states always carry an icon or text label too.

## Color tokens
Defined as CSS variables on web (`:root`, `[data-theme="dark"]`) and a plain object for React Native. Theme follows the system by default, with a manual override.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FAFAF8` | `#121413` | App background |
| `surface` | `#FFFFFF` | `#1A1D1B` | Cards, drawer, popovers |
| `surface-subtle` | `#F4F4F1` | `#212522` | Hover rows, inputs, sidebar |
| `border` | `#E6E5E0` | `#2A2E2B` | Hairlines (1px), only where needed |
| `text` | `#1F2421` | `#E8EAE6` | Primary text |
| `text-muted` | `#5F655F` | `#A1A8A1` | Secondary text, metadata |
| `accent` | `#3F7D6B` | `#6FB5A0` | Primary button, checkbox fill, selection |
| `accent-strong` | `#2F6354` | `#8CCBB7` | Accent text and links (higher contrast) |
| `accent-subtle` | `#E4F0EC` | `#1E2F29` | Selected row background |
| `danger` | `#B3382C` | `#E5877D` | Destructive actions, errors |
| `warning` | `#9A6A12` | `#E0B35A` | Overdue, sync conflicts |
| `success` | `#3F7D6B` | `#6FB5A0` | Same as accent; completion is not a separate hue |
| `focus-ring` | `#2F6354` | `#8CCBB7` | 2px outline, 2px offset, always visible on keyboard focus |

**Priority** (always shown with a flag icon + "P1"–"P4" label, never color only):
`P1 #B3382C` terracotta, `P2 #9A6A12` amber, `P3 #3F6F9E` slate blue, `P4` uses `text-muted`.

Contrast targets (WCAG 2.2 AA): body text 4.5:1, large text and UI boundaries 3:1. These hex values were chosen to meet them but **must be verified with a contrast checker when `ui-tokens` is built (M2)**; adjust the value, not the target.

## Typography
- **Family:** Inter, with system-ui fallback. Load only weights 400, 500, 600.
- **Numbers:** `font-variant-numeric: tabular-nums` for dates, counts, durations.
- **Scale** (size / line-height): `xs 12/16`, `sm 14/20` (task metadata), `base 16/24` (task titles, body), `lg 20/28` (view headings), `xl 28/36` (page title, used rarely).
- Weights: 400 body, 500 task titles and buttons, 600 headings. No bold paragraphs, no all-caps labels, no letter-spacing tricks.
- Completed tasks: `text-muted` plus line-through at 60% opacity; still readable.

## Spacing, shape, elevation
- **Spacing:** 4px base. Allowed steps: 4, 8, 12, 16, 24, 32, 48. Task row vertical padding 12px; content max width 720px on web, centered.
- **Radius:** `sm 6px` (inputs, chips), `md 10px` (cards, buttons), `lg 16px` (drawers, dialogs). No pill buttons except tags.
- **Elevation:** flat by default. Only popovers, dialogs, and the command palette get a shadow: `0 8px 24px rgb(0 0 0 / 0.08)` light, `0 8px 24px rgb(0 0 0 / 0.4)` dark. Prefer a `border` hairline over shadow for cards.
- **Touch targets:** at least 44×44px on mobile (visual size can be smaller if the hit area is padded). 32px minimum on desktop.

## Motion
- **Durations:** 120ms (hover, focus), 180ms (open/close, reorder settle), 240ms (page/drawer). Nothing longer.
- **Easing:** `cubic-bezier(0.2, 0, 0, 1)` for entering, `cubic-bezier(0.4, 0, 1, 1)` for leaving.
- **Signature moment:** completing a task fills the checkbox, strikes the title, and fades the row out after 600ms with an Undo toast. That is the only "delight" animation.
- **Reduced motion:** with `prefers-reduced-motion`, replace movement with instant state change or a simple opacity fade.
- No bouncing, parallax, confetti, or looping animation.

## Layout
- **Web (≥1024px):** left sidebar (240px, collapsible) with Inbox, Today, Upcoming, Projects, Labels; main list; task detail opens as a right drawer (420px). Command palette on `Ctrl/Cmd+K`.
- **Tablet:** sidebar collapses to an icon rail; detail is a drawer.
- **Mobile:** bottom tab bar (Inbox, Today, Upcoming, Projects); a single floating **Add** button (the one filled accent control on the screen); task detail is a full-height sheet.
- **Empty states:** one line of calm copy, one action. No illustrations required.

## Components (build once, mirror on both platforms)
Button (primary / quiet / destructive), Checkbox (the animated completion), TaskRow, TaskDetail, QuickAdd, CommandPalette, Select, DatePicker, Tag, Toast (with Undo), Skeleton, EmptyState, Switch (used for the Google Calendar sync toggle), Dialog.

- **TaskRow:** `[checkbox] Title` on the first line; due date, project, and labels in `sm text-muted` beneath. Overdue date uses `warning` plus a clock icon. Drag handle and overflow menu appear on hover/focus.
- **Buttons:** only one `primary` per view. Everything else is `quiet` (text + hover surface). Destructive confirms via Undo toast when reversible, dialog when not.
- **Forms:** labels always visible above fields (no placeholder-only labels), inline error text in `danger` with an icon, never only a red border.
- **Settings → Google Calendar:** a `Switch` (default off) with a plain-language line about what is shared, connection status, last-synced time, and a "Reconnect" action on error. Turning it off asks "Keep or remove events already created?" in a dialog.

## Voice and copy
Plain, short sentences. Say what happened and what to do next: "Couldn't sync. We'll retry when you're back online." No exclamation marks, no emoji in UI chrome, no guilt-based streak or overdue language ("3 things are past due", not "You're falling behind").

## Accessibility (WCAG 2.2 AA)
- Every interactive element reachable and operable by keyboard; visible focus ring on all of them.
- Drag-and-drop reordering has a keyboard alternative (`Alt+↑/↓`) and a "Move to…" menu.
- Form controls have programmatic labels; toasts use `role="status"` (Undo remains focusable); dialogs trap focus and restore it on close.
- Text scales to 200% without loss; layout works at 320px width.
- Test with a screen reader (NVDA on web, VoiceOver/TalkBack on mobile) at each milestone.

## Do / Don't
| Do | Don't |
|---|---|
| Use neutral surfaces and let the accent mark just one thing | Add a second accent color or gradients |
| Separate with spacing, then hairlines | Stack cards with heavy shadows |
| Show metadata in muted small text | Badge everything in bright pills |
| Keep copy factual and brief | Use urgency, streak shaming, or cheerful filler |
| Animate completion and drawers only | Add decorative or looping animation |

## Implementation notes
- Tokens live in `packages/ui-tokens` as a single TypeScript module exporting the table above (light and dark), plus a generated CSS-variables file for web.
- shadcn/ui components are restyled to these tokens, not used with their defaults.
- Changes to this direction go through an update to this file first, then to the tokens.
