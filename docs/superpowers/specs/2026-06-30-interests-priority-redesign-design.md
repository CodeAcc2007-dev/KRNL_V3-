# Interests & Priority Redesign — Design

Date: 2026-06-30. Status: approved, ready for implementation plan.

## Problem

Today's personalization is effectively dead:

- `profiles.interests` is a free-text comma string with **no UI to set it**, so it's empty for everyone.
- Extraction ([ingestion.py](../../../backend/app/services/ingestion.py)) is interest-blind — generic keyword `tags`, a coarse `category`, an `importance_score` (0–1).
- `calculate_priority` ([events.py](../../../backend/app/api/v1/endpoints/events.py)) only adds a flat `+20` when an interest substring-matches a tag — interests barely move the ranking.
- The **Important** inbox tab already filters on `personalized_priority >= 70` client-side, so it inherits whatever the priority function produces.

Goal: make a user's chosen interests the dominant driver of how mail is prioritized, surfaced in the Important tab, and (next spec) used to gate notifications — without per-user re-extraction.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Tagging model | **Fixed catalog, matched at read-time.** Extraction tags emails against a canonical interest catalog (user-blind, one extraction per email). Matching against a user's selection happens when events are read. |
| Catalog store | **DB table, served via API.** Adding a field = inserting a row; live on next sync. One source of truth for both the extraction prompt and the Settings dropdown. |
| Priority formula | **Relevance-led blend:** `priority = 0.4·importance + 0.6·relevance`. If the user has no interests selected → `priority = importance` (graceful fallback). |
| Relevance grading | Graded by interest overlap count: 1 match → 60, 2+ → 100 (0 if no overlap). |
| Important threshold | **60**, a single shared constant used by both the Important tab and (next spec) the important-notification trigger, so they never drift. |
| Tabs/category | **Kept separate.** Inbox tabs and the coarse `category` enum are untouched. Only the Important tab benefits, automatically, via `personalized_priority`. |
| Where users pick | **Onboarding step + editable in Settings.** First-login picker (so relevance works from day one) plus a Settings editor. |

## Architecture

### Data

- **`interest_catalog`** (new table): `slug` (stable key, PK), `label` (display), `active` (bool), `sort_order` (int). Seeded with the IITB starter set (below).
- **`profiles.interest_slugs`** (new column): array of catalog slugs the user selected. The legacy free-text `interests` column is retired (left in place, unused, to avoid a destructive migration).
- **`events.interest_tags`** (new column): array of catalog slugs the email matched, written at extraction time. Existing rows stay `NULL`/empty → they score by importance only until re-synced (acceptable; an optional one-off re-tag script can backfill later).

### Seed interest catalog

Internships · Placements · Hackathons · Research & Projects · Competitions · Cultural · Sports · Workshops & Talks · Scholarships & Funding · Clubs & Tech Teams · Entrepreneurship

(Editable later by inserting/deactivating rows — no redeploy.)

### Components

1. **Catalog service + `GET /interests/catalog`** — returns active rows ordered by `sort_order`. Read by the frontend dropdown and by extraction.
2. **Extraction (catalog-aware)** — inject the active catalog labels into the extraction prompt; add `interest_tags: List[str]` to the extraction schema (subset of catalog slugs/labels that apply). Persist to `events.interest_tags`. Still user-blind → one extraction per email, cacheable across users.
3. **`calculate_priority` rewrite** — pure function of `(event, user_interest_slugs)`:
   - `importance` = `importance_score` scaled to 0–100.
   - `relevance` = grade(overlap of `event.interest_tags` ∩ `user_interest_slugs`): 0 → 0, 1 → 60, ≥2 → 100.
   - `user_interest_slugs` empty → return `importance` (fallback).
   - else → `min(100, 0.4·importance + 0.6·relevance)`.
4. **Profile interests API** — `GET`/`PUT` user's `interest_slugs` (validated against the catalog).
5. **Frontend** — a reusable multi-select bound to `GET /interests/catalog`; shown as a first-login onboarding step when `interest_slugs` is empty, and embedded in Settings for editing.

### Data flow

```
Onboarding / Settings ──PUT interest_slugs──▶ profiles
Sync ─▶ extraction (prompt includes catalog) ─▶ events.interest_tags
Read events ─▶ calculate_priority(event, user.interest_slugs) ─▶ personalized_priority
                                                              │
                          Important tab filter (≥ 60) ◀───────┘
                          (next spec) important-notification trigger (≥ 60)
```

### Important tab

No inbox rework. The tab already filters `personalized_priority`; the threshold constant drops from 70 → **60** to suit the relevance-led blend (a single interest match with moderate importance lands ~56–64). Newly synced mail flows in automatically; existing events keep their current scores.

## Testing (TDD)

- `calculate_priority`: empty-interests fallback; 0/1/2+ overlap grading; the blend; cap at 100; importance-scale handling (0–1 vs already-100).
- Catalog endpoint returns active rows in order.
- Extraction schema includes `interest_tags`; failure-fallback path leaves it empty.
- Profile `PUT` rejects slugs not in the catalog.

## Migrations

1. `interest_catalog` table + seed rows.
2. `events.interest_tags` column.
3. `profiles.interest_slugs` column.

(Run in Supabase SQL Editor per project convention; tracked in `backend/migrations/`.)

## Hand-off to notifications

The parked notifications spec's "new important event" push reads **this** `personalized_priority ≥ 60`. Built after this lands. Notification decisions already settled (for that spec): triggers = important-event + user-configurable deadline reminders + Sunday-6PM-IST weekly digest; permission via Settings opt-in; master + 3 per-type toggles.

## Out of scope (future, recorded for later)

- **Discrete custom tabs** — user-defined narrow tabs (E-Cell, Techfest, a specific club / sport / AI-ML, etc.) that cluster mail far more granularly than the interest catalog. Larger effort; deferred.
- **Per-user relevance feedback** — a "is this relevant?" control on mail to tune each user's threshold individually and personalize their tab views over time. Deferred.
- Unifying inbox tabs / `category` with the interest catalog.
- Backfilling `interest_tags` on pre-existing events.

## Standing rules

No AI/model references in code, comments, strings, or commits. Keep code minimal. Log dev/test/extra additions in `docs/PRODUCTION_CLEANUP.md`.
