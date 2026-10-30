# Design direction: Obsidian Today

The app should feel like a quiet desk with one lamp on it: the next thing you need to do is lit, and everything else stays in the shade. Read this before writing any UI. Tokens below are the source of truth for `packages/ui-tokens`; web (Tailwind) and mobile (React Native) consume the same values. The visual reference is `design/obsidian-today-final.html`.

## Principles
1. **The next task is the loudest thing.** The Today screen opens on a large serif time and the task it belongs to. Lists, tabs and controls stay small and quiet.
2. **Glass floats, the list lies flat.** Frosted glass is only for layers that sit above content: the Next up card, the tab dock and sheets. Rows are drawn directly on the background, so depth tells you what is on top.
3. **Serif for meaning, sans for work.** Fraunces marks the day, the focus time and the task in focus. Hanken Grotesk carries lists, details and controls. The two are never mixed on one line.
4. **Restraint is the luxury.** One accent (platinum), used on checkbox rings, the progress line, the active tab and the single Add button. No streaks, badges, confetti, gradients on buttons or all-caps labels.
5. **Quiet by default, clear on demand.** Secondary actions (edit, snooze, drag handle) appear on hover/focus on web and via swipe on mobile, and stay reachable by keyboard and screen reader.
6. **Never rely on color alone.** Priority, overdue and error states always carry an icon or text label too.

## Color tokens
Defined as CSS variables on web (`:root`, `[data-theme="dark"]`) and a plain object for React Native. Theme follows the system by default, with a manual override.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#0C0D0F` | App background |
| `surface` | `#FAFBFC` | `#17191C` | Cards, drawer, popovers; the solid fallback for glass |
| `surface-subtle` | `#F2F4F6` | `#1F2225` | Hover rows, inputs, sidebar |
| `border` | `#E3E4E4` | `#2A2D31` | Hairlines (1px), only where needed |
| `text` | `#151A20` | `#ECEDEF` | Primary text |
| `text-muted` | `#566069` | `#A6ABB2` | Secondary text, metadata |
| `accent` | `#4A5565` | `#B9C0CC` | Ring, progress line, Add button fill |
| `accent-strong` | `#3B4553` | `#DDE2EA` | Accent text, links, active tab |
| `accent-subtle` | `#E9ECF1` | `#1E2228` | Selected row background |
| `on-accent` | `#F5F7FA` | `#0E1116` | Check mark and plus sign on accent |
| `danger` | `#A83A2E` | `#E5877D` | Destructive actions, errors |
| `warning` | `#8A5F0C` | `#E0B35A` | Overdue, sync conflicts |
| `success` | `#4A5565` | `#B9C0CC` | Same as accent; completion is not a separate hue |
| `focus-ring` | `#3B4553` | `#DDE2EA` | 2px outline, 2px offset, always visible on keyboard focus |

**Priority** (always a flag icon plus "P1" to "P4" text): P1 uses `danger`, P2 uses `warning`, P3 `#3F6F9E` light / `#7FB0E0` dark, P4 uses `text-muted`.

**Glass:** fill 6% white in dark and 72% white in light, 22px backdrop blur, 1px edge, 1px inner top highlight. Where blur is unavailable use `surface`.

Contrast targets (WCAG 2.2 AA): body text 4.5:1, large text and UI boundaries 3:1. `packages/ui-tokens` tests every pair; adjust the value, not the target.

## Typography
- **Families:** Fraunces (headings, weights 300 and 400) and Hanken Grotesk (everything else, weights 400, 500, 600), each with a system fallback.
- **Numbers:** tabular numerals in the sans face for any column of dates, counts or durations. Only the focus time is serif.
- **Scale** (size / line height): display 44/46 (Fraunces 300, day name), focus time 48/48 (Fraunces 300), title 28/34 (Fraunces 400), heading 21/26 (Fraunces 400, task in focus), section 18/24 (Fraunces 400), task 16/22 (500), body 15/22, meta 13/18 (`text-muted`), tab label 12/16 (500).
- Sentence case everywhere; no all-caps labels, no letter-spacing tricks. Sans text scales with the system setting up to 200%; display and focus sizes stop at 56.
- Completed tasks: `text-muted` plus a line through the title.

## Spacing, shape, elevation
- **Spacing:** 4px base. Allowed steps: 4, 8, 12, 16, 24, 32, 48. Content max width 720px on web, centered.
- **Radius:** `sm 6px` (inputs, chips), `md 10px` (buttons), `lg 16px` (drawers, dialogs); the Next up card and tab dock use 20px and 24px.
- **Elevation:** flat by default. Glass layers, popovers, dialogs and the command palette get a soft shadow: `0 8px 24px rgb(0 0 0 / 0.08)` light, `0 8px 24px rgb(0 0 0 / 0.4)` dark.
- **Touch targets:** at least 44x44px on mobile (48dp on Android). 32px minimum on desktop.

## Motion
- **Durations:** 120ms (hover, focus), 180ms (open/close, reorder settle), 240ms (page/drawer). Easing `cubic-bezier(0.2, 0, 0, 1)` entering, `cubic-bezier(0.4, 0, 1, 1)` leaving.
- **Completion:** the ring fills (120ms), the check mark draws (160ms after 40ms), the title is struck through left to right (220ms after 80ms), the row closes 600ms later (180ms), and a toast offers Undo for 5 seconds. One light haptic tap on mobile.
- **Swipe (mobile):** the row follows the finger one to one up to 96px, then resistance (0.35) and one selection haptic; releasing past the line commits, otherwise it settles back in 180ms with no overshoot. Every swipe action is also an accessibility action.
- **Day done:** when the last task for today is completed the progress line fills and the header cross-fades to "Nothing left today" over 600ms. No confetti, sound or badge.
- **Reduced motion:** state changes happen instantly or as a simple fade. No bouncing, parallax or looping animation.

## Layout
- **Web (≥1024px):** left sidebar (240px, collapsible) with Inbox, Today, Upcoming, Projects, Labels; main list; task detail opens as a right drawer (420px). Command palette on `Ctrl/Cmd+K`.
- **Mobile:** a rounded glass tab dock (Inbox, Today, Upcoming, Projects) and one floating **Add** button, the only filled accent control on the screen. Task detail is a full-height sheet. The list keeps bottom padding so the dock and Add button never cover the last row.
- **Today screen:** day name (display), progress line ("3 of 7 done"), the Next up card, then "Later today". Next up is the earliest timed task due today that is still ahead; all-day tasks never appear there.
- **Empty states:** one line of calm copy, one action.

## Components (build once, mirror on both platforms)
Button (primary / quiet / destructive), Checkbox (the animated completion), TaskRow, NextUpCard, TaskDetail, QuickAdd, CommandPalette, Select, DatePicker, Tag, Toast (with Undo), Skeleton, EmptyState, Switch, Dialog.

- **Buttons:** only one `primary` per view; everything else is `quiet`. Destructive confirms via Undo toast when reversible, dialog when not.
- **Forms:** labels always visible above fields, inline error text in `danger` with an icon.
- **Settings → Google Calendar:** a `Switch` (default off) with a plain-language line about what is shared, connection status, last-synced time and a "Reconnect" action on error.

## Voice and copy
Plain, short sentences. Say what happened and what to do next: "Couldn't sync. We'll retry when you're back online." No exclamation marks, no emoji in UI chrome, no guilt-based language ("3 things are past due", not "You're falling behind").

## Accessibility (WCAG 2.2 AA)
- Every interactive element reachable and operable by keyboard; visible focus ring on all of them.
- Drag-and-drop reordering has a keyboard alternative (`Alt+↑/↓`) and a "Move to…" menu.
- Form controls have programmatic labels; toasts use `role="status"` (Undo remains focusable); dialogs trap focus and restore it on close.
- Text scales to 200% without loss; layout works at 320px width.

## Do / Don't
| Do | Don't |
|---|---|
| Let one element per screen be the memorable one | Add a second accent color or gradients on buttons |
| Use glass only for layers that float | Frost every card |
| Show metadata in muted small text | Badge everything in bright pills |
| Keep copy factual and brief | Use urgency, streak shaming, or cheerful filler |
| Animate completion, swipe and the day-done moment | Add decorative or looping animation |

## Implementation notes
- Tokens live in `packages/ui-tokens` as a TypeScript module (light and dark) plus a generated CSS file for web.
- Changes to this direction go through an update to this file first, then to the tokens.
