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
| F1 | `src/app/components/ui/` — 48 shadcn primitives (sidebar 726, chart 353, menubar, context-menu, carousel, pagination, breadcrumb, navigation-menu, command, table, …) | No app file imports any `ui/` component (grep = 0). They only import each other. | None — fully unimported; regenerable via shadcn CLI | Delete the `ui/` directory | [ ] |
| F2 | `src/app/components/figma/ImageWithFallback.tsx` | Not imported by any app file | None | Delete | [ ] |
| F3 | ~50 of 57 npm `dependencies` unused (MUI, @emotion/*, all @radix-ui/*, recharts, embla-carousel, react-slick, react-dnd*, react-popper/@popperjs, canvas-confetti, input-otp, cmdk, vaul, react-day-picker, react-resizable-panels, react-hook-form, next-themes, react-router, react-responsive-masonry, sonner, date-fns, cva/clsx/tailwind-merge, tw-animate-css …) | Only react/react-dom/motion/lucide/@supabase used by app code; the rest are pulled in only by the dead `ui/` folder | None **after F1** | After F1, remove deps; `npm run build` must pass; restore any the build still needs (e.g. tailwind/vite build-time) | [ ] |
| F4 | `src/app/lib/api.ts` is a thin wrapper that just calls `utils/api.ts` `apiFetch` + `.json()` | 10-line indirection; both `apiCall` and `apiFetch` exist | Low — used by some screens | Verify call sites, collapse to one helper if clean | [ ] |
| F5 | 6 CSS files (`fonts, globals, index, tailwind, theme, tokens`) — possible overlap | Not yet reviewed; `tokens.css` is the live design-token source per project notes | Medium — CSS deletion can break styling | Review import chain; merge/prune only what's provably unused. **Lower priority.** | [ ] |
| F6 | Hardcoded demo fallback lists (Deadlines ~L50-88, Inbox ~L112-139) render fake data when API fails | Already flagged in PRODUCTION_CLEANUP.md | Medium — user-visible if API fails | Replace with honest empty state before prod | [ ] |

**Estimated removal from A: ~6,000+ frontend lines and ~50 dependencies, zero behavior change.**

---

## B. Backend — PENDING deep review (seeded from docs; verify before acting)

Backend is lean (2,352 lines). No mass-bloat like the frontend. Seeded candidates to confirm by reading
each file — **none actioned yet:**

| ID | Candidate | Source / why | Status |
|----|-----------|--------------|--------|
| B1 | Failed (429) extraction is still stored + dedup'd → never retried | Documented flaw (gemini-rate-limits.md). Behavior bug, borderline scope — track but likely separate from pure debloat | [ ] verify |
| B2 | `events` rows store both `raw_body` (original) and `full_body` (cleaned) | Possible redundancy; confirm both are read somewhere before touching | [ ] verify |
| B3 | Synchronous sync fallback + `max_emails=3` path in `sync.py` | Dev-only per PRODUCTION_CLEANUP; once async is the real path, make dev-only/remove | [ ] verify |
| B4 | `test_connection.py` at `backend/` root | Smoke script; move to tests/ or remove (PRODUCTION_CLEANUP) | [ ] verify |
| B5 | Per-file dead code / unused imports across 27 backend modules | Not yet read line-by-line this session | [ ] read events.py, sync_task.py, ingestion.py, retrieval.py, services/* |
| B6 | `datetime.utcnow()` deprecation warnings (event_merge.py et al.) | Pytest warnings; tidy to `datetime.now(UTC)` | [ ] verify |

---

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
  backlog (B1–B6). Next session: confirm F1 by deleting `ui/` on a branch + `npm run build`, then F3
  dependency prune.
