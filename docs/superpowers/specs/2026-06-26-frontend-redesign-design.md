# KRNL Frontend Redesign — Design Spec

_Date: 2026-06-26 · Branch: `redesign` · Rollback: `pre-redesign-backup`_

## Goal

Remove the "AI-generated app" feel (dark blue-black + purple gradients + glow shadows +
Sparkles + bubbly radii) and move to a **clean, minimal, dark-refined** look inspired by
**Apple Mail / Gmail** structure with a **single flat blue accent**. Re-skin every screen and
fix a few genuinely weak mobile layouts. No decorative elements — everything must be functional.

## Constraints

- **Backup kept** (`pre-redesign-backup` branch) — must remain restorable.
- **No overdesign:** do not add buttons/elements that don't already have a function.
- **Functional-only, minimal code** (project standing rule). No AI/model references.

## Visual system (central tokens)

All values live in one tokens file (CSS variables) so the whole app shifts from one place.

| Token | Old (AI look) | New |
|---|---|---|
| `--bg` base | `#08090a` (blue-black) | `#0a0a0b` (true neutral) |
| `--surface` card | `#1c1c21` + glow shadow | `#161617`, hairline border, no shadow |
| `--border` | mixed | `rgba(255,255,255,0.07)` hairline |
| `--text` | mixed grays | `#f4f4f5` primary · `#a1a1aa` secondary · `#71717a` tertiary |
| `--accent` | indigo `#6366f1` + gradients + glow | flat blue `#3b82f6` (no gradient/glow) |
| font | browser default | system stack (`-apple-system, "Segoe UI", Roboto, …`) |
| radius | 16–44px | 10–12px (cards/controls); floating bar slightly larger |

**Removed globally:** purple gradients, glow/box-shadows, `Sparkles` decoration, bubbly radii.

## Re-skin rules (all screens)

- Flat surfaces + 1px hairline border instead of gradient/glow cards.
- Accent (blue) used **only** for: active tab, links, primary action, unread dot. Everything
  else neutral gray.
- Consistent 4px spacing scale; Apple-Mail-style generous row rhythm.

## Weak-layout fixes

- **Email rows (Inbox):** Gmail-style — circular sender avatar, source/sender line + bold
  subject + 1-line preview, timestamp top-right, category/urgency as quiet text (not loud
  chips). Denser and more scannable.
- **Bottom nav:** **floating, translucent bar** (Apple-style, *not* heavy liquid-glass):
  detached with side margins + gap above the home-indicator safe area, semi-transparent dark
  fill + light backdrop-blur + hairline border. Items: Inbox · Ask KRNL · Deadlines, flat,
  blue when active. The purple gradient sparkle FAB is removed; Ask KRNL is a normal bar item.
- **Deadlines cards:** fix raw `this_week` / `tomorrow` labels → "This Week" / "Tomorrow";
  flatten styling.
- **Settings:** Apple-style grouped list with hairline dividers; fixes the
  content-hidden-behind-nav overlap (proper bottom padding).

## Rollout order

1. Backup branch (done) → 2. tokens file → 3. **Inbox** (prototype, screenshot for approval)
→ 4. Email Detail → 5. Ask KRNL → 6. Deadlines → 7. Settings → 8. Login.

## Validation

Build the real screen, screenshot at a 390px mobile viewport, get user approval before moving
to the next screen. Reference: Apple Mail / Gmail (structure & restraint), dark-skinned.
