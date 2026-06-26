# Session 2026-06-26 — Frontend bugfixes, mobile fixes, redesign (in progress)

## Summary

Fixed three+ frontend bugs, made the PWA work on a physical phone, then started a full
frontend **redesign** (dark-refined, single blue accent, Apple-Mail/Gmail-inspired). Redesign
is on its own branch and is **partially done** — resume there next session.

## Branch / rollback state

- **`redesign`** — current working branch (all redesign work here).
- **`pre-redesign-backup`** — snapshot of the app BEFORE the redesign (today's bugfixes
  included). Restore the old look with `git checkout pre-redesign-backup`.
- **`phase-1-quota-data-integrity`** — prior feature branch (now also holds the committed
  bugfixes; `pre-redesign-backup` was branched from here).
- `main` — still Initial commit (rollback point).

## Done & committed

### Bugfixes (on `phase-1-quota-data-integrity`, commit `e02090f`)
1. **"Full Message" not scrollable / clipped** — the detail scroll container is a flex column;
   the Full Message card has `overflow:hidden`, so flexbox shrank it and clipped the ~3200px
   body to ~120px, and the scroller never overflowed. Fix: `min-h-0` on the scroller +
   `flexShrink:0` on the card (`EmailDetailScreen.tsx`). It was never data/cache.
2. **Removed Register Now** button (links below already cover it).
3. **Category tabs not populating** — tabs matched labels literally vs the real categories
   (Academic/Career/Cultural/Technical/General). Fix: tab→category mapping in `InboxScreen.tsx`
   (Opportunities = Career+Technical, Announcements = General+Security), updated the hardcoded
   defaults, and updated the stored `profiles.inbox_tabs` (DB value was overriding the code).
4. **Mobile black screen** — phone-frame used `height:100%` under a `min-h-screen` parent →
   collapsed to 0 (children are `absolute`). Fix: `100dvh` (`App.tsx`).
5. **Whole-page scroll + top/bottom black gaps on mobile** — `min-h-screen` (100vh) vs frame
   `100dvh` mismatch. Fix: lock body scroll on mobile + outer wrapper `100dvh`
   (`index.css`, `App.tsx`).
6. **Top status-bar dead space** — 48px spacer (for the desktop mock clock) stayed on mobile.
   Fix: `--status-bar-pad` CSS var = `calc(env(safe-area-inset-top) + 16px)` on mobile, applied
   to all 5 screens.

### Mobile bring-up (dev-only — see PRODUCTION_CLEANUP.md)
- Servers bound to `0.0.0.0`; `VITE_API_URL` → LAN IP; `ALLOWED_ORIGINS` += LAN IPs; Supabase
  Site URL + redirect URLs set to LAN IP (fixed OAuth `bad_oauth_state` + CORS black screen).
- Phone URL: **http://192.168.10.9:5173** (API at `:8000`). LAN IP may change between sessions.

### Redesign (on `redesign`, commits `4e04d71` → `ae9568a`)
- Spec: `docs/superpowers/specs/2026-06-26-frontend-redesign-design.md`.
- **Tokens** (`frontend/src/styles/tokens.css`): neutral dark `--bg #0a0a0b`, `--surface`,
  hairline `--border`, text 3-tier, single blue `--accent #3b82f6`, system font. Tweak the
  whole app from here. Imported in `styles/index.css`.
- **Inbox** (`InboxScreen.tsx`): Gmail-style rows (neutral avatar, bold subject, 1-line
  preview, time + High-priority dot, quiet metadata line), clean blue-pill tabs (no Star),
  blue avatar. No gradients/glows/sparkles.
- **Bottom nav** (`BottomNav.tsx` + wrapper in `App.tsx`): floating, rounded (28px), frosted
  translucent (`blur(28px)`, `rgba(20,20,22,0.85)`), slim. Items: Inbox · Ask · Deadlines.
  Removed the purple gradient sparkle FAB.
- **Email Detail** (`EmailDetailScreen.tsx`): single full title (no double truncation), header
  = back + priority pill, de-boxed facts (deadline = red icon+text row, venue = gray row),
  quiet `#tag` tags, color-coded category pill (Academic blue / Career green / Cultural pink /
  Technical cyan / Security amber), "Summary" (renamed from "AI Summary", sparkle removed per
  no-AI-refs rule), type-based link icons (WhatsApp green glyph, Google Forms purple, Docs
  blue, web blue). **Browser/device Back now closes the detail** (History API: pushState on
  open, popstate → onBack; in-app back calls `history.back()`).

## NOT done — resume here next session

Remaining redesign screens (palette token-mapped via script, but need structural polish +
screenshot pass):
- **Ask KRNL** (`AskKrnlScreen.tsx`) — also fix literal `*markdown*` rendering in messages and
  the "Hi! I'm KRNL" greeting wording.
- **Deadlines** (`DeadlinesScreen.tsx`) — remove leftover glow box-shadows on the urgency dots
  (`0 0 8px rgba(...)`), fix raw `this_week`/`tomorrow` label casing → "This Week"/"Tomorrow".
- **Settings** (`SettingsScreen.tsx`) — green gradient on the Google-account avatar (line ~321)
  to flatten; verify the System section isn't hidden behind the floating nav (add bottom pad).
- **Login** (`LoginScreen.tsx`) — verify in the new tokens.

Then: Ask KRNL output quality/alignment (deferred feature task), and the original open issue A
(`query.py` drops structured deadline from LLM context).

## How to resume

1. Start Redis (if testing sync): `podman start krnl-redis`; worker:
   `cd backend && celery -A app.core.celery_app worker --concurrency=1 --loglevel=info`.
2. Backend: `cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`.
3. Frontend (LAN): `cd frontend && VITE_API_URL=http://<LAN-IP>:8000 npm run dev -- --host`.
4. `git checkout redesign`. Verify at a 390px viewport. Continue with Deadlines/Ask KRNL.
