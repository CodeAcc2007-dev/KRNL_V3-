# Production Readiness & Debloat Audit

> **Cross-session tracker.** Goal: remove bloat (YAGNI) and make KRNL V3 production-ready
> **without changing end-product behavior.** Recon-first: understand before editing. Each finding
> is a checkbox so progress survives across sessions. Append to the Session Log on every session.

## How to use this doc

1. Pick an **unchecked** finding from the backlog below (respect ordering — safest/highest-value first).
2. Re-verify it still holds (code moves) before acting.
3. Make the change on a branch, **verify the gate** (below), then check the box and note the commit.
4. Add a Session Log entry.

## Standing constraints (do not violate while debloating)

- **Do not change end-product behavior.** This is cleanup, not a feature change. If a change alters
  behavior, it's out of scope for this audit (track separately).
- **Verification gate after every change batch:** backend `cd backend && pytest -q` must stay green
  (49 tests as of 2026-06-29); frontend `cd frontend && npm run build` must succeed (compiler proves
  no dangling imports). Never check a box without the gate passing.
- **Laptop/desktop view is a planned future feature.** The app is mobile-only today (no responsive
  code exists). Deleted `ui/` scaffold is **regenerable on demand** (`npx shadcn add <name>`), so
  removing it now does NOT block the desktop view — that work will re-add the *specific* primitives it
  needs, intentionally. Do not retain unused scaffold "in case desktop wants it" (that's the YAGNI
  violation being removed).
- **No AI/model references** in code, comments, strings, commits (standing project rule).
- **TDD** for any change that touches behavior; pure deletions of unused code just need the gate.

## Methodology

- Frontend "used" = imported (transitively) from the real entry path `main.tsx → App.tsx → screens`.
  Verified via import grep: the only external imports across all real app files are `react`,
  `react-dom`, `motion/react`, `lucide-react`, `@supabase/supabase-js`. **No app file imports any
  `ui/` component** (grep returned zero matches 2026-06-29).
- Dependency removal is **compiler-verified**: remove from package.json, run `npm run build` +
  typecheck; restore anything that breaks. Let the build prove deadness rather than guessing.

---

## A. Frontend — CONFIRMED dead code (high confidence, low risk)

Real app = 13 files (`App.tsx`, `main.tsx`, screens Inbox/Deadlines/AskKrnl/EmailDetail/Login/Settings,
`BottomNav`, `utils/api.ts`, `utils/supabase.ts`, `lib/api.ts`, 6 CSS). Total frontend src = 8,552 lines;
the items below are the large majority of it.

| ID | Finding | Evidence | Risk to product | Action | Status |
|----|---------|----------|-----------------|--------|--------|
| F1 | `src/app/components/ui/` — 48 shadcn primitives | No app file imports any `ui/` component (grep = 0). | None — fully unimported; regenerable via shadcn CLI | **DONE `0d016fb`** — deleted; build OK, JS bundle byte-identical, CSS 95→27 kB | [x] |
| F2 | `src/app/components/figma/ImageWithFallback.tsx` | Not imported by any app file | None | **DONE `0d016fb`** — deleted | [x] |
| F3 | 53 of 57 npm `dependencies` unused (MUI, @emotion/*, all @radix-ui/*, recharts, embla-carousel, react-slick, react-dnd*, react-popper/@popperjs, canvas-confetti, input-otp, cmdk, vaul, react-day-picker, react-resizable-panels, react-hook-form, next-themes, react-router, react-responsive-masonry, sonner, date-fns, cva/clsx/tailwind-merge, @supabase/ssr …) | Pulled in only by the dead `ui/` folder | None after F1 | **DONE `3dfc7e7`** — deps 57→4 (motion, lucide-react, @supabase/supabase-js, tw-animate-css); build byte-identical. KEPT tw-animate-css (CSS @import) | [x] |
| F4 | Two api helpers (`lib/api.ts` `apiCall`, `utils/api.ts` `apiFetch`) | Reviewed call sites: distinct contracts (parsed-JSON-or-throw vs raw `Response`); both justified. Only the `supabase` re-export in lib/api was dead. | Low | **DONE `24c7797`** — removed dead re-export; KEPT both helpers (not bloat) | [x] |
| F7 | No `@types/react` / `@types/react-dom` installed | IDE flagged every JSX line | None | **DONE `eebffd4`** — added `@types/react@18` + `@types/react-dom@18` devDeps | [x] |
| F5 | 6 CSS files (`fonts, globals, index, tailwind, theme, tokens`) — possible overlap | Not yet reviewed; `tokens.css` is the live design-token source per project notes | Medium — CSS deletion can break styling | Review import chain; merge/prune only what's provably unused. **Lower priority.** | [ ] |
| F6 | Hardcoded demo fallback lists (Deadlines ~L50-88, Inbox ~L112-139) render fake data when API fails | Already flagged in PRODUCTION_CLEANUP.md | Medium — user-visible if API fails | Replace with honest empty state before prod | [ ] |

**Phase 1 (F1–F3) DONE 2026-06-29:** removed 5,137 lines + 53 deps, build verified byte-identical.
Remaining in A: F4 (api helper), F5 (CSS, low priority), F6 (demo fallbacks — behavior change, do deliberately).

---

## B. Backend — PENDING deep review (seeded from docs; verify before acting)

Backend is lean (2,352 lines). No mass-bloat like the frontend. B5 deep-read done 2026-06-29; the only
structural finding is B7 (events.py duplication). The rest are small/behavior-touching:

| ID | Candidate | Source / why | Status |
|----|-----------|--------------|--------|
| B1 | Failed (429) extraction is still stored + dedup'd → never retried | Documented flaw (gemini-rate-limits.md). Behavior bug, borderline scope — track but likely separate from pure debloat | [ ] verify |
| B2 | `events` rows store both `raw_body` (original) and `full_body` (cleaned) | **Reviewed:** `raw_body` IS used — EmailDetailScreen falls back to it when `full_body` is empty. Minor *storage* redundancy, not dead code. Low priority; behavior+schema-touching | [ ] low-pri |
| B3 | Synchronous sync fallback + `max_emails=3` path in `sync.py` | Dev-only per PRODUCTION_CLEANUP; once async is the real path, make dev-only/remove | [ ] verify |
| B4 | `test_connection.py` at `backend/` root | **DONE `eebffd4`** — deleted (standalone script, ran IMAP at import, had a **hardcoded credential** → see Security note below) | [x] |
| B5 | Per-file dead code / unused imports across backend modules | **DONE (read 2026-06-29):** events.py, sync_task.py, ingestion.py, retrieval.py all reviewed. retrieval/ingestion/sync_task clean (all imports used, no dead fns). Only finding → **B7** below. | [x] |
| B6 | `datetime.utcnow()` deprecation warnings (event_merge.py et al.) | **RECLASSIFIED: NOT a safe quick win.** `event_merge.py:102` compares utcnow() vs naive deadlines; the `.isoformat()` calls would change stored string format (`+00:00`). Switching to aware would BREAK behavior. Defer; warnings are harmless | [ ] defer (behavior) |
| **B7** | events.py: `EventResponse(...)` + interests fetch each duplicated 3× | **DONE `4f10d22`** (TDD) — extracted `_to_event_response` + `_get_user_interests`; events.py 265→191 ln; 3 tests pin mapping; 52 suite green; backend restarted clean | [x] |

---

## ⚠️ Security note (found during B4, 2026-06-29)

The deleted `backend/test_connection.py` contained a **hardcoded API key**
(`AIzaSy…`) and a hardcoded LDAP user. The file is gone from the working tree but
**remains in git history**. If that key is real/active, **rotate it** in Google AI
Studio. (Separately: `backend/.env` real secrets should move to host secrets before
prod — already tracked in PRODUCTION_CLEANUP.)

## C. Verification gate (run after EVERY change batch)

```
cd backend && pytest -q              # expect: all green (49 as of 2026-06-29)
cd frontend && npm run build         # expect: build succeeds, no dangling imports
```

If either fails, the change is not done. Do not check the box.

---

## Session Log

- **2026-06-29 (recon):** Built the grasp; no code changed. Inventoried backend (2,352 ln, lean) and
  frontend (8,552 ln). Proved via import-grep that the real app imports only react/react-dom/motion/
  lucide/@supabase and that **no app file imports any `ui/` component** → headline finding F1–F3
  (delete `ui/`, figma, prune ~50 deps). Created this tracker. Backend left as PENDING deep-review
  backlog (B1–B6).
- **2026-06-29 (Phase 1 execution):** Did F1+F2+F3. Deleted `ui/` (48) + figma helper → `0d016fb`
  (5,137 deletions; build OK, JS byte-identical, CSS 95→27 kB). Pruned deps 57→4 → `3dfc7e7`
  (byte-identical build). Gate (`npm run build`) green throughout; no behavior change. **Next:** F4
  (collapse `lib/api.ts`/`utils/api.ts`), then backend deep-read (B5) — read events.py, sync_task.py,
  ingestion.py, retrieval.py for dead code; F6 + B1–B3 are behavior-touching, do deliberately with TDD.
- **2026-06-29 (Phase 2 — safe):** F4 reviewed — kept both api helpers (distinct contracts), removed only
  the dead `supabase` re-export from lib/api → `24c7797` (build OK). B5 deep-read done: retrieval.py,
  ingestion.py, sync_task.py all clean (every import used, no dead fns/raw_body is a live fallback). One
  finding: **B7** — events.py duplicates the `EventResponse` mapping 3× and interests fetch 3× (~70 lines).
  Logged F7 (@types/react missing). **Next:** Phase 3 (behavior-touching, TDD): B7 DRY refactor (write
  endpoint tests first), then F6 (demo-fallback → empty state), B1 (failed-extraction retry), B3 (dev
  fallback). Quick wins available anytime: F7 (@types add), B4 (move test_connection.py), B6 (utcnow).
- **2026-06-29 (Phase 3 start):** F7 done (@types/react@18) `eebffd4`; B4 done (deleted test_connection.py;
  flagged its hardcoded key — see Security note) `eebffd4`; **B7 done via TDD** `4f10d22` (events.py 265→191,
  shared `_to_event_response`/`_get_user_interests`, 3 tests, 52 green, backend restarted clean). B6
  reclassified as behavior-touching → deferred. Gitignored celerybeat-schedule runtime files. **Remaining:**
  F5 (CSS, low), F6 (demo fallbacks → empty state, behavior), B1 (failed-extraction retry, behavior),
  B2 (raw_body storage, low), B3 (dev sync fallback), B6 (utcnow, deferred). All remaining are
  behavior-touching or low-priority — next session do F6/B1/B3 with TDD + explicit go-ahead.
