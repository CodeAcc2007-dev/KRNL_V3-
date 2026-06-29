# Session 2026-06-29 — Phase 3/4, full debloat, PWA fixes, notifications design (in progress)

Long session. Branch: **`redesign`**. Everything below is committed unless noted.

## Shipped (commits, newest first)

| Commit | What |
|---|---|
| `78e84af` | **SW deploy-safe** — rewrote `public/sw.js`: navigation = network-first (fixes the stale-cache **black screen** after rebuilds), assets cache-first, cache bumped v2, dropped dev `/src/*` precache |
| `1f21d64` | **PWA auth fix** — Supabase `flowType: "pkce"` + `persistSession`/`detectSessionInUrl`; manifest `scope:"/"` + `id:"/"` (fixes installed-PWA URL bar + session lost on kill) |
| `ac95ab2` | **Settings "Install KRNL" button** — surfaces held `beforeinstallprompt`; App passes `canInstall`/`onInstall`. Android/Chrome only (iOS can't) |
| `29a1782` | **New app icon** — K-with-envelope-flap mark → 192/512 PNGs (manifest + apple-touch-icon) + favicon; dropped "AI" wording from meta description |
| `b64a020`,`042e1fe`,`f2b21e0`,`a22942e` | Debloat tracker updates |
| `4f10d22` | **B7** — events.py DRY: extracted `_to_event_response` + `_get_user_interests` (265→191 ln), 3 TDD tests, 52 suite green |
| `eebffd4` | **F7+B4** — added `@types/react@18`; deleted `test_connection.py` (had a hardcoded **stale** credential — NOT the active Gemini key; in git history, rotate if ever real) |
| `24c7797` | **F4** — removed dead `supabase` re-export from lib/api (kept both api helpers — distinct contracts) |
| `3dfc7e7` | **F3** — pruned npm deps **57→4** (motion, lucide-react, @supabase/supabase-js, tw-animate-css); byte-identical build |
| `0d016fb` | **F1+F2** — deleted unused `components/ui/` (48 shadcn files) + figma helper = **5,137 lines**; JS bundle byte-identical, CSS 95→27 kB |
| `bbd6ac9` | Debloat audit tracker created |
| `7d0d821` | **Phase 3 auto-sync** — `dispatch_all_syncs` Beat task every 15 min; throttle 13s→6s (flash-lite 15 RPM); per-run cap spreads cold-start backlog |
| `21c8c35` | **Phase 4 security** — auth on `/sync/status`; rate-limit `/sync/trigger` (new `app/core/rate_limit.py`, 1/user/min, fail-open) |
| `5ecb4ca` | Ask KRNL: wrap long URLs (`overflowWrap:anywhere`) — fixed sideways scroll |

## Debloat — DONE (tracker: docs/PRODUCTION_READINESS_AUDIT.md)

Frontend went 8,552→~3,400 src lines, 57→4 deps. Backend was already lean; only B7 found.
**Conclusion reached: debloat is finished** — remaining tracker items (F5 CSS, F6 demo-fallbacks,
B1 failed-extraction-retry, B2 raw_body, B3 dev sync fallback, B6 utcnow) are behavior-touching or
low-priority, NOT bloat. Do F6/B1 as pre-pilot product hardening, with TDD, not as "debloat".

## Data op

Deleted **35 failed-extraction rows** (`raw_summary="Failed to run AI feature extraction…"`) + 42 orphan
Qdrant vectors from the user's account (91→56 events). User chose "delete, no re-sync".

## Live testing setup (dev-only, ephemeral)

PWA install + notifications need HTTPS, so **two cloudflared quick tunnels** (binary at `~/.local/bin/cloudflared`):
frontend (vite preview :4173, prod build so SW registers) + backend (:8000). `VITE_API_URL`=backend tunnel,
CORS allows frontend tunnel (both gitignored `.env`). Vite preview blocks unknown hosts → frontend tunnel
uses `--http-host-header localhost:4173 --protocol http2`. **Supabase: added redirect wildcard
`https://*.trycloudflare.com/**`** so OAuth survives URL changes (Site URL must be a current reachable URL).
**Sandbox quirk:** its local DNS NXDOMAINs new tunnel hosts (works via public DNS / phone). All tracked in
PRODUCTION_CLEANUP.md "Dev-only HTTPS tunnel" section — revert before prod. **URLs change every reboot/
restart** (full re-bringup needed: start redis/backend/worker → backend tunnel → set VITE_API_URL → build →
preview → frontend tunnel → set CORS → restart backend → update Supabase Site URL).

Android PWA confirmed WORKING this session: install + login persists + standalone (no URL bar) + no black screen.

## Notifications — DESIGN IN PROGRESS (do NOT implement yet — brainstorming gate)

Feature = Web Push (service worker + VAPID + `pywebpush` + subscription table + trigger rules + permission UX).
iOS needs installed PWA 16.4+ (user has Android only for now). **Decisions so far:**
- **Triggers (3):** (1) new **important** event on sync, (2) **deadline reminders** (time-based, ahead of due),
  (3) **weekly digest** (not daily).
- **"Important" basis:** reuse existing `calculate_priority()` (importance_score×100 + 20 if tag matches user
  interests); notify when ≥ threshold (~60, tunable). No new model.
- **Open questions:** reminder lead time(s); permission-prompt UX/timing; per-user toggles; digest day/time;
  exact threshold + category gating.
Next: finish brainstorm → spec in docs/superpowers/specs/ → writing-plans → build. **Then deployment** (which
also ends the tunnel churn with a stable URL).

## Resume checklist next session
1. Re-bring-up the stack + tunnels (see Live testing setup) if testing on phone.
2. Continue notifications brainstorm from the open questions above.
3. After notifications: deployment (Phase 2 host + Phase 4 secrets/CORS lock + revert dev-only items).
