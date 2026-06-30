# Session 2026-06-30 — Interests & priority redesign (brainstorm → spec → plan → build) + deployment strategy

Branch: **`redesign`**. Everything committed. Subagent-driven execution.

## Shipped — interests & priority redesign (commits 5578beb..c519a9a, + b47cd76)

Catalog-backed interests drive a relevance-led priority. Spec + plan in `docs/superpowers/`
(`specs/2026-06-30-interests-priority-redesign-design.md`, `plans/2026-06-30-interests-priority-redesign.md`).

| Commit | What |
|---|---|
| `5578beb` | Migration: `interest_catalog` table (11 seed) + `events.interest_tags` + `profiles.interest_slugs` |
| `33b0606` | Catalog service (`app/services/interests.py`) + `GET /interests/catalog` |
| `8304c06` | `calculate_priority` rewrite (relevance-led blend) + read `interest_slugs` + `interest_tags` on EventResponse |
| `1173bc2` | Catalog-aware extraction → store normalized slugs in `events.interest_tags` |
| `7d276f0` | Profile API persists + validates `interest_slugs` (old `interests` → Optional) |
| `807d2a8` | Important-tab threshold 70→60 |
| `f9cdf41` | Settings interest picker (replaced dead "Career Track") |
| `7f2d01d` | First-login onboarding interest gate (App.tsx) |
| `c519a9a` | Docs (PROJECT_LOG, PRODUCTION_CLEANUP, plan) |
| `b47cd76` | Compliance: reworded AI-reference fallback string |

**Design decisions (locked):** fixed catalog matched at read-time (not per-user extraction); DB-table catalog
(add a row, no redeploy); priority = `0.4·importance + 0.6·relevance`, relevance grade {0,60,100},
importance-only when no interests, cap 100; `IMPORTANT_THRESHOLD=60` shared (Important tab + future
notifications); inbox tabs/category kept separate; interests picked at onboarding + editable in Settings.
**Slug is the one key end-to-end** (catalog→extraction→interest_tags ∩ interest_slugs→UI).

**Tests:** 64 backend passing; frontend builds clean. Final whole-branch review (opus) = **Ready/merge** —
slug contract coherent, schema/code aligned, degrades safely before migration, no Critical/Important introduced.
Mid-run caught a plan bug (a priority test asserted an unreachable 100.0 → fixed test input to importance 100).

## ⚠️ Pending / open

- **MANUAL: run `backend/migrations/interests_priority_migration.sql` in Supabase** — until then the feature
  degrades to importance-only/empty pickers (no crash).
- **Bug (deferred):** "page is not loading properly" — reported at session end, not yet diagnosed. Fix next session.
- **Deferred Minors (PRODUCTION_CLEANUP):** `IMPORTANT_THRESHOLD` backend-dead vs frontend hardcoded 60 (unify
  when notifications land); `res.ok` not checked on interest-save POST (self-corrects next mount).

## Deployment strategy (discussed, not built)

Stack to host: FastAPI API + Celery worker **+ beat (`-B`)** + Redis; Supabase (Postgres) & Qdrant Cloud already free-hosted; Gemini free tier; static React PWA frontend.

- **Recommended free pilot:** Oracle Cloud "Always Free" ARM VM (4-core/24 GB, always-on) running `docker-compose` (API+worker+beat+Redis+Caddy auto-HTTPS) → one stable domain (ends cloudflared churn). Frontend → Cloudflare Pages (free).
- **Easiest paid:** Railway (API+worker+Redis from repo) ~$5–10/mo + Vercel/Pages frontend.
- **Hostinger:** shared hosting ❌ (no always-on Python); **VPS ~$5–8/mo** ✅ (same as Oracle, easier setup).
- **AWS:** ~$15–25/mo, no lasting free tier; only if AWS specifically wanted. Vercel = frontend only (serverless, can't run worker/beat).
- **Go-live checklist:** apply migrations; real domain; revert LAN IPs + `*.trycloudflare.com` from CORS/Supabase; lock `ALLOWED_ORIGINS`; `DEBUG=False`; secrets→host env; run worker with `-B`.
- **Scale path:** ~45-user ceiling on shared Gemini key/1 worker → paid Gemini + raise concurrency (needs ADR-0001 keyed-rate-gate seam) → managed Redis/Postgres. All additive.

## Promo (drafted, in chat)

Selling points + taglines + a paste-ready product-context brief for content/video agents were produced this
session (edge over webmail + over "Gmail wrapper"; demo flow). Taglines: "Your inbox, finally on your side." /
"Every deadline. Every opportunity. None of the noise." Tone: clean/premium, outcome-focused, no tech/model mentions.

## Resume checklist next session
1. Apply the interests migration in Supabase.
2. Diagnose the "page not loading properly" bug.
3. Then: notifications (reads new priority ≥60) → deploy (pick Oracle Free VM or Hostinger VPS).
