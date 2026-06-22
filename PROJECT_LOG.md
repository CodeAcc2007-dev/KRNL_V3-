# KRNL V3 — Project Log

_Single entry point. Open this first. Detail lives in [`docs/`](docs/)._

KRNL V3 = IITB student email-intelligence PWA. Backend FastAPI + Supabase (Postgres) +
Qdrant (vectors) + Redis/Celery (sync queue) + Gemini (free tier; extraction + embeddings).
Frontend Vite + React PWA. Email sync via IMAP (`imap.iitb.ac.in`), credentials encrypted
at rest.

## Where things are

| What | Path |
|---|---|
| Phased plan + progress log | [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) |
| Design specs (per feature, dated) | [docs/specs/](docs/specs/) |
| Session logs (dated context/ref) | [docs/sessions/](docs/sessions/) |
| Production-cleanup tracker | [docs/PRODUCTION_CLEANUP.md](docs/PRODUCTION_CLEANUP.md) |
| UI audit | [docs/audit/](docs/audit/) |
| DB migrations (run manually in Supabase SQL Editor) | [backend/migrations/](backend/migrations/) |
| Ops scripts | [backend/scripts/](backend/scripts/) |
| Tests | [backend/tests/](backend/tests/) |

## Status at a glance

- **Branch:** `phase-1-quota-data-integrity` (main = Initial commit, kept as rollback point).
- **Done:** Phase 0 (broken-now fixes), Phase 1 (message_id dedup, batch embeddings,
  is_update/update_type), duplicate cleanup applied (13 clean rows, 0 orphaned vectors).
- **Next up:** deadline-extension intelligence on real Redis sync — spec approved, see
  [docs/specs/2026-06-22-deadline-extension-sync-design.md](docs/specs/2026-06-22-deadline-extension-sync-design.md).
- **Later:** Phase 3 auto-sync (Celery Beat), Phase 4 security, Phase 5 UX polish.

## Issues tracker

| # | Issue | Status | Detail |
|---|---|---|---|
| A | Ask KRNL can't answer deadline questions (`query.py` drops structured `deadline` from LLM context) | OPEN | DEVELOPMENT_PLAN → "NEW open issues 2026-06-22" |
| B | Internship email re-duplicates on re-sync | RESOLVED 2026-06-22 | Phase 1 message_id dedup + cleanup; see [session](docs/sessions/2026-06-22-phase1-dedup-and-planning.md) |
| — | "Full Message" collapsible shows on only 1 mail | OPEN (investigate) | DEVELOPMENT_PLAN progress log |

## How to proceed (next session)

1. Stand up Redis (Docker) + Celery worker; run a real 10–15 email sync (see the deadline
   spec, Sections 2–3).
2. Build deadline-extension merge (`app/services/event_merge.py`) + frontend badges.
3. After the next sync, re-run `cleanup_duplicates.py --apply` once to clear the one-time
   residual dup of legacy rows (NULL `message_id`).
4. Then tackle Issue A (Ask KRNL deadlines).

## Standing rules

No AI/model references in code, comments, strings, or commits. Keep code minimal
(optimize later on request). Log every dev/test/extra addition in
[docs/PRODUCTION_CLEANUP.md](docs/PRODUCTION_CLEANUP.md).
