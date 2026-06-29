# Interests & Priority Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a user's chosen interests the dominant driver of mail priority, surfaced in the Important tab, using a DB-backed interest catalog and read-time matching (no per-user re-extraction).

**Architecture:** A new `interest_catalog` table feeds both the extraction prompt and a Settings/onboarding multi-select. Extraction tags each email (user-blind) with catalog slugs stored on `events.interest_tags`. At read time, `calculate_priority` blends intrinsic importance with interest-overlap relevance. The Important inbox tab already filters on the resulting `personalized_priority`, so it benefits automatically.

**Tech Stack:** FastAPI + Supabase (Postgres) Python backend (pytest); Vite + React + motion frontend (verified via `npm run build`); Gemini structured extraction.

## Global Constraints

- **No AI/model references** in code, comments, strings, or commit messages (copy verbatim rule).
- **Keep code minimal** (YAGNI); log any dev/test/extra additions in `docs/PRODUCTION_CLEANUP.md`.
- **Repo path contains a space** (`KRNL -V3`) — quote it in shell commands.
- **Run backend commands from `backend/`**; pytest is installed system-wide (no venv).
- **Important threshold = 60.0**, shared by the Important tab and (future) notifications.
- **Priority formula:** `0.4·importance + 0.6·relevance`; relevance grade `{0→0, 1→60, ≥2→100}`; if the user has no interests, `priority = importance`.
- Slugs are the canonical key stored everywhere (`events.interest_tags`, `profiles.interest_slugs`). Seed catalog labels: Internships, Placements, Hackathons, Research & Projects, Competitions, Cultural, Sports, Workshops & Talks, Scholarships & Funding, Clubs & Tech Teams, Entrepreneurship.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/migrations/interests_priority_migration.sql` | Create `interest_catalog` (+seed), add `events.interest_tags`, `profiles.interest_slugs` |
| `backend/app/services/interests.py` (new) | Fetch active catalog + build a label/slug→slug lookup (shared by endpoint + extraction) |
| `backend/app/api/v1/endpoints/interests.py` (new) | `GET /interests/catalog` |
| `backend/app/main.py` | Register the interests router |
| `backend/app/api/v1/endpoints/events.py` | Rewrite `calculate_priority`; read `interest_slugs`; map `interest_tags` |
| `backend/app/schemas/event.py` | Add `interest_tags` to `EventResponse` |
| `backend/app/services/ingestion.py` | Add `interest_tags` to schema + prompt; `normalize_interest_tags` |
| `backend/app/tasks/sync_task.py` | Fetch catalog once; pass labels to extraction; store normalized `interest_tags` |
| `backend/app/schemas/profile.py` | `interest_slugs` on update/response; relax `interests` to optional |
| `backend/app/api/v1/endpoints/profile.py` | Persist + return `interest_slugs` |
| `frontend/src/app/components/InboxScreen.tsx` | Important-tab threshold 70→60 |
| `frontend/src/app/components/SettingsScreen.tsx` | Replace hardcoded "Career Track" with catalog-backed interest picker |
| `frontend/src/app/components/OnboardingInterests.tsx` (new) | First-login interest picker |
| `frontend/src/app/App.tsx` | Gate onboarding when `interest_slugs` empty |

---

## Task 1: Database migration (catalog + columns)

**Files:**
- Create: `backend/migrations/interests_priority_migration.sql`

**Interfaces:**
- Produces: table `interest_catalog(slug text pk, label text, active bool, sort_order int)`; column `events.interest_tags jsonb`; column `profiles.interest_slugs jsonb`.

- [ ] **Step 1: Write the migration SQL**

Create `backend/migrations/interests_priority_migration.sql`:

```sql
-- Interest catalog: source of truth for extraction tags + the Settings dropdown.
create table if not exists interest_catalog (
    slug text primary key,
    label text not null,
    active boolean not null default true,
    sort_order integer not null default 0
);

insert into interest_catalog (slug, label, sort_order) values
    ('internships',        'Internships',          10),
    ('placements',         'Placements',           20),
    ('hackathons',         'Hackathons',           30),
    ('research-projects',  'Research & Projects',  40),
    ('competitions',       'Competitions',         50),
    ('cultural',           'Cultural',             60),
    ('sports',             'Sports',               70),
    ('workshops-talks',    'Workshops & Talks',    80),
    ('scholarships-funding','Scholarships & Funding',90),
    ('clubs-tech-teams',   'Clubs & Tech Teams',   100),
    ('entrepreneurship',   'Entrepreneurship',     110)
on conflict (slug) do nothing;

-- Per-email catalog slugs, written at extraction time.
alter table events add column if not exists interest_tags jsonb default '[]'::jsonb;

-- Per-user selected catalog slugs.
alter table profiles add column if not exists interest_slugs jsonb default '[]'::jsonb;
```

- [ ] **Step 2: Apply it in the Supabase SQL Editor**

Paste the file contents into Supabase → SQL Editor → Run. (Project convention: migrations are applied manually.)

- [ ] **Step 3: Verify**

Run in the SQL Editor:
```sql
select count(*) from interest_catalog where active;            -- expect 11
select column_name from information_schema.columns
  where table_name='events' and column_name='interest_tags';   -- 1 row
select column_name from information_schema.columns
  where table_name='profiles' and column_name='interest_slugs';-- 1 row
```
Expected: 11, and one row each for the two columns.

- [ ] **Step 4: Commit**

```bash
cd "/home/CodeAcc2007/Coding/Projects/KRNL -V3"
git add backend/migrations/interests_priority_migration.sql
git commit -m "Add interests/priority migration: catalog table + interest_tags/interest_slugs columns"
```

---

## Task 2: Catalog service + `GET /interests/catalog`

**Files:**
- Create: `backend/app/services/interests.py`
- Create: `backend/app/api/v1/endpoints/interests.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_interests_catalog.py`

**Interfaces:**
- Consumes: `app.core.security.supabase`, `get_current_user`.
- Produces:
  - `fetch_active_catalog(client) -> list[dict]` — rows `{"slug","label"}` ordered by `sort_order`.
  - `build_catalog_lookup(catalog: list[dict]) -> dict[str,str]` — lowercased label **and** slug → canonical slug.
  - `GET /api/v1/interests/catalog` → `[{"slug","label"}, ...]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_interests_catalog.py`:

```python
"""Catalog service helpers: shape + lookup building."""
from app.services.interests import build_catalog_lookup


def test_lookup_maps_label_and_slug_case_insensitively():
    catalog = [{"slug": "hackathons", "label": "Hackathons"},
               {"slug": "research-projects", "label": "Research & Projects"}]
    lookup = build_catalog_lookup(catalog)
    assert lookup["hackathons"] == "hackathons"          # slug key
    assert lookup["research & projects"] == "research-projects"  # label key, lowered
    assert lookup["HACKATHONS".lower()] == "hackathons"
    assert "unknown" not in lookup
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_interests_catalog.py -v`
Expected: FAIL with `ModuleNotFoundError: app.services.interests`.

- [ ] **Step 3: Write the service**

Create `backend/app/services/interests.py`:

```python
"""Interest catalog access shared by the API and extraction."""
from typing import List, Dict


def fetch_active_catalog(client) -> List[dict]:
    """Active catalog rows as [{'slug','label'}], ordered by sort_order. [] on error."""
    try:
        res = (
            client.table("interest_catalog")
            .select("slug,label,sort_order")
            .eq("active", True)
            .order("sort_order")
            .execute()
        )
        return [{"slug": r["slug"], "label": r["label"]} for r in (res.data or [])]
    except Exception:
        return []


def build_catalog_lookup(catalog: List[dict]) -> Dict[str, str]:
    """Map lowercased label AND slug to the canonical slug, for tolerant matching."""
    lookup: Dict[str, str] = {}
    for row in catalog:
        slug = row["slug"]
        lookup[slug.lower()] = slug
        lookup[row["label"].lower()] = slug
    return lookup
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_interests_catalog.py -v`
Expected: PASS.

- [ ] **Step 5: Write the endpoint**

Create `backend/app/api/v1/endpoints/interests.py`:

```python
from fastapi import APIRouter, Depends
from app.core.security import get_current_user, supabase
from app.services.interests import fetch_active_catalog

router = APIRouter()


@router.get("/interests/catalog")
def get_interest_catalog(current_user: dict = Depends(get_current_user)):
    """Active interest catalog for the Settings/onboarding picker."""
    return fetch_active_catalog(supabase)
```

- [ ] **Step 6: Register the router**

In `backend/app/main.py`, add an import alongside the others (after the `deletion_router` import line):

```python
from app.api.v1.endpoints.interests import router as interests_router
```

and an include alongside the others (after the `deletion_router` include line):

```python
app.include_router(interests_router, prefix="/api/v1")
```

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS (existing suite + the new test).

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/interests.py backend/app/api/v1/endpoints/interests.py backend/app/main.py backend/tests/test_interests_catalog.py
git commit -m "Add interest catalog service + GET /interests/catalog"
```

---

## Task 3: Rewrite `calculate_priority` (relevance-led blend)

**Files:**
- Modify: `backend/app/api/v1/endpoints/events.py` (`calculate_priority` ~25-42, `_get_user_interests` ~84-93, `_to_event_response` ~95-119)
- Modify: `backend/app/schemas/event.py` (add `interest_tags`)
- Test: `backend/tests/test_priority.py` (new); update `backend/tests/test_event_response.py`

**Interfaces:**
- Consumes: `parse_tags` (events.py), event row dict with `importance_score` (0–1 or 0–100) and `interest_tags`, user interest slug list.
- Produces:
  - `IMPORTANT_THRESHOLD = 60.0` (module constant).
  - `calculate_priority(event: dict, user_interests: List[str]) -> float` — blend per Global Constraints.
  - `_get_user_interests(user_id) -> List[str]` reads `profiles.interest_slugs`.
  - `EventResponse.interest_tags: Any`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_priority.py`:

```python
"""calculate_priority: relevance-led blend with importance-only fallback."""
from app.api.v1.endpoints.events import calculate_priority, IMPORTANT_THRESHOLD


def _ev(importance, interest_tags):
    return {"importance_score": importance, "interest_tags": interest_tags}


def test_no_user_interests_falls_back_to_importance():
    # importance 0.8 -> 80; no interests selected -> importance only
    assert calculate_priority(_ev(0.8, ["hackathons"]), []) == 80.0


def test_single_match_blends_60_relevance():
    # 0.4*80 + 0.6*60 = 68.0
    assert calculate_priority(_ev(0.8, ["hackathons"]), ["hackathons"]) == 68.0


def test_two_matches_max_relevance():
    # 0.4*80 + 0.6*100 = 92.0
    assert calculate_priority(_ev(0.8, ["hackathons", "sports"]),
                              ["hackathons", "sports"]) == 92.0


def test_interests_set_but_no_overlap():
    # relevance 0 -> 0.4*80 + 0 = 32.0  (NOT the importance-only fallback)
    assert calculate_priority(_ev(0.8, ["hackathons"]), ["finance"]) == 32.0


def test_already_scaled_importance_and_cap():
    # importance stored as 0-100 int; 2+ matches -> cap at 100
    assert calculate_priority(_ev(95, ["a", "b"]), ["a", "b"]) == 100.0


def test_threshold_constant_is_60():
    assert IMPORTANT_THRESHOLD == 60.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_priority.py -v`
Expected: FAIL (`ImportError: IMPORTANT_THRESHOLD`).

- [ ] **Step 3: Rewrite `calculate_priority` + `_get_user_interests`**

In `backend/app/api/v1/endpoints/events.py`, replace the `calculate_priority` function (lines ~25-42) with:

```python
IMPORTANT_THRESHOLD = 60.0


def _grade_relevance(match_count: int) -> float:
    """Graded interest overlap: 0 -> 0, 1 -> 60, 2+ -> 100."""
    if match_count <= 0:
        return 0.0
    if match_count == 1:
        return 60.0
    return 100.0


def calculate_priority(event: dict, user_interests: List[str]) -> float:
    """
    Personalized priority (0-100), relevance-led blend.
    importance = importance_score scaled to 0-100.
    If the user has interests: 0.4*importance + 0.6*relevance.
    If not: importance only (graceful fallback).
    """
    importance = float(event.get("importance_score") or 0.0)
    importance = importance * 100.0 if importance <= 1.0 else importance
    importance = min(importance, 100.0)

    if not user_interests:
        return round(importance, 1)

    event_slugs = {s.lower() for s in parse_tags(event.get("interest_tags"))}
    interest_set = {s.lower() for s in user_interests}
    relevance = _grade_relevance(len(event_slugs & interest_set))
    return round(min(0.4 * importance + 0.6 * relevance, 100.0), 1)
```

Then replace the body of `_get_user_interests` (lines ~84-93) so it reads the new column:

```python
def _get_user_interests(user_id: str) -> List[str]:
    """Fetch the user's selected interest slugs; [] on any error."""
    try:
        res = supabase.table("profiles").select("interest_slugs").eq("id", user_id).execute()
        if res.data:
            return parse_tags(res.data[0].get("interest_slugs"))
    except Exception:
        pass
    return []
```

- [ ] **Step 4: Add `interest_tags` to the response mapping + schema**

In `backend/app/schemas/event.py`, add inside `EventResponse` (after the `tags` line):

```python
    interest_tags: Any = None
```

In `backend/app/api/v1/endpoints/events.py`, inside `_to_event_response` (after the `tags=parse_tags(...)` line ~104), add:

```python
        interest_tags=parse_tags(row.get("interest_tags")),
```

- [ ] **Step 5: Update the existing event-response test for the new formula**

In `backend/tests/test_event_response.py`, add `"interest_tags": ["hackathons"]` to `SAMPLE_ROW` (after the `"tags"` line), then replace `test_interest_match_boosts_priority` with:

```python
def test_priority_uses_interest_overlap():
    # importance 0.8 -> 80; one interest_tag match -> 0.4*80 + 0.6*60 = 68
    matched = _to_event_response(SAMPLE_ROW, ["hackathons"])
    assert matched.personalized_priority == 68.0
    # interests set but no overlap -> 0.4*80 = 32
    miss = _to_event_response(SAMPLE_ROW, ["finance"])
    assert miss.personalized_priority == 32.0
    # no interests selected -> importance only -> 80
    none = _to_event_response(SAMPLE_ROW, [])
    assert none.personalized_priority == 80.0
    assert matched.interest_tags == ["hackathons"]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_priority.py tests/test_event_response.py -v`
Expected: PASS.

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/v1/endpoints/events.py backend/app/schemas/event.py backend/tests/test_priority.py backend/tests/test_event_response.py
git commit -m "Rewrite calculate_priority as relevance-led blend; read interest_slugs"
```

---

## Task 4: Catalog-aware extraction + storage

**Files:**
- Modify: `backend/app/services/ingestion.py` (`EmailExtractionModel` ~24-34, `extract_event_intelligence` ~86-125)
- Modify: `backend/app/tasks/sync_task.py` (catalog fetch + `event_data` ~138-155)
- Test: `backend/tests/test_extraction.py` (extend)

**Interfaces:**
- Consumes: `fetch_active_catalog`, `build_catalog_lookup` (Task 2); `parse_tags`.
- Produces:
  - `EmailExtractionModel.interest_tags: List[str]`.
  - `extract_event_intelligence(subject, body, msg_date, interest_labels: Optional[List[str]] = None) -> dict` (fallback dict includes `interest_tags: []`).
  - `normalize_interest_tags(raw_tags, catalog_lookup) -> List[str]` (canonical slugs, dedup, unknowns dropped).
  - `event_data["interest_tags"]` populated in `sync_task`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_extraction.py`, append:

```python
def test_model_exposes_interest_tags():
    assert "interest_tags" in ingestion.EmailExtractionModel.model_fields


def test_fallback_extraction_includes_interest_tags():
    with patch.object(ingestion.genai_client.models, "generate_content", side_effect=RuntimeError("boom")):
        out = ingestion.extract_event_intelligence("subj", "body", "2026-06-22")
    assert out["interest_tags"] == []


def test_normalize_interest_tags_maps_to_slugs_and_drops_unknown():
    lookup = {"hackathons": "hackathons", "research & projects": "research-projects"}
    out = ingestion.normalize_interest_tags(
        ["Hackathons", "Research & Projects", "Quidditch", "hackathons"], lookup)
    assert out == ["hackathons", "research-projects"]  # mapped, deduped, unknown dropped
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_extraction.py -v`
Expected: FAIL (`interest_tags` not in fields / `normalize_interest_tags` undefined).

- [ ] **Step 3: Add the schema field**

In `backend/app/services/ingestion.py`, add to `EmailExtractionModel` (after the `tags` field ~29):

```python
    interest_tags: List[str] = Field(default_factory=list, description="Subset of the provided interest field list that this email is relevant to; empty if none apply")
```

- [ ] **Step 4: Add `normalize_interest_tags` and thread `interest_labels` through extraction**

In `backend/app/services/ingestion.py`, add near the top (after imports):

```python
def normalize_interest_tags(raw_tags, catalog_lookup: dict) -> list:
    """Map model-returned labels/slugs to canonical catalog slugs; dedup; drop unknowns."""
    out = []
    for t in raw_tags or []:
        slug = catalog_lookup.get(str(t).strip().lower())
        if slug and slug not in out:
            out.append(slug)
    return out
```

Change the `extract_event_intelligence` signature and prompt. Replace the signature line and the prompt assembly (lines ~86-100) with:

```python
def extract_event_intelligence(subject: str, body: str, msg_date: str,
                               interest_labels: Optional[List[str]] = None) -> dict:
    """
    Structured event details extraction.
    """
    clean_body = clean_email_body(body)
    interest_line = ""
    if interest_labels:
        interest_line = (
            "From this list of interest fields, set interest_tags to the ones this email "
            f"is genuinely relevant to (use the exact names, omit if none apply): "
            f"{', '.join(interest_labels)}.\n\n"
        )
    prompt = (
        "Analyze the email Subject and Body provided below. Extract the key metadata "
        "and details in structured JSON format according to the schema.\n"
        f"This email was received on {msg_date}. Resolve every date relative to that "
        "received date: if the year is not stated, infer it from the received date "
        "(events are upcoming or very recent, never years in the past). When the email "
        "states a specific time of day, include it in the deadline as HH:MM:SS; if no "
        "time is given, output the date only (YYYY-MM-DD).\n\n"
        f"{interest_line}"
        f"Subject: {subject}\n\nBody:\n{clean_body}"
    )
```

Confirm `Optional` and `List` are imported at the top of `ingestion.py` (the schema already uses both via `typing`). If `Optional` is not imported, add it to the existing `from typing import ...` line.

In the fallback dict (the `except` branch, ~115-125), add the key:

```python
            "interest_tags": [],
```

- [ ] **Step 5: Store `interest_tags` in sync_task**

In `backend/app/tasks/sync_task.py`:

First add the import near the top (with the other `app.services` imports):

```python
from app.services.interests import fetch_active_catalog, build_catalog_lookup
```

Then, once per sync run, fetch the catalog before the per-email loop. Locate the account fetch (~line 40) and add right after it (before the email loop begins):

```python
        catalog = fetch_active_catalog(supabase_service)
        interest_labels = [c["label"] for c in catalog]
        catalog_lookup = build_catalog_lookup(catalog)
```

Find the call to `extract_event_intelligence(...)` in the loop and pass the labels, e.g.:

```python
                extracted = extract_event_intelligence(subject, body, msg_date, interest_labels)
```

(If the existing call uses different argument names, keep them and append `interest_labels` as the 4th positional argument.)

Then in `event_data` (~138-155), add the normalized slugs after the `tags` line:

```python
                    "interest_tags": normalize_interest_tags(extracted.get("interest_tags"), catalog_lookup),
```

Ensure `normalize_interest_tags` is imported from `app.services.ingestion` at the top of `sync_task.py` (the file already imports `extract_event_intelligence`/`clean_email_body` from there — add `normalize_interest_tags` to that import).

- [ ] **Step 6: Run extraction tests + full suite**

Run: `cd backend && python -m pytest tests/test_extraction.py -v && python -m pytest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/ingestion.py backend/app/tasks/sync_task.py backend/tests/test_extraction.py
git commit -m "Tag emails against interest catalog during extraction; store interest_tags"
```

---

## Task 5: Profile API — persist `interest_slugs`

**Files:**
- Modify: `backend/app/schemas/profile.py`
- Modify: `backend/app/api/v1/endpoints/profile.py` (get ~42-48, post ~83-89; validation)
- Test: `backend/tests/test_profile_interests.py` (new)

**Interfaces:**
- Consumes: `fetch_active_catalog` (Task 2) for slug validation.
- Produces:
  - `ProfileUpdate.interest_slugs: Optional[List[str]]`; `interests` relaxed to `Optional[str]`.
  - `ProfileResponse.interest_slugs: List[str]`.
  - `_valid_slugs(requested, catalog) -> List[str]` filter helper in `profile.py`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_profile_interests.py`:

```python
"""Profile interest_slugs are validated against the catalog before persisting."""
from app.api.v1.endpoints.profile import _valid_slugs


def test_valid_slugs_keeps_known_drops_unknown():
    catalog = [{"slug": "hackathons", "label": "Hackathons"},
               {"slug": "sports", "label": "Sports"}]
    assert _valid_slugs(["hackathons", "sports", "ponies"], catalog) == ["hackathons", "sports"]


def test_valid_slugs_handles_none():
    assert _valid_slugs(None, [{"slug": "hackathons", "label": "Hackathons"}]) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_profile_interests.py -v`
Expected: FAIL (`ImportError: _valid_slugs`).

- [ ] **Step 3: Update the schemas**

In `backend/app/schemas/profile.py`, change `ProfileUpdate` so `interests` is optional and add `interest_slugs`:

```python
class ProfileUpdate(BaseModel):
    user_name: Optional[str] = None
    interests: Optional[str] = None
    roll_number: Optional[str] = None
    primary_department: Optional[str] = None
    inbox_tabs: Optional[List[str]] = None
    interest_slugs: Optional[List[str]] = None
```

And add to `ProfileResponse`:

```python
    interest_slugs: List[str] = Field(default_factory=list)
```

- [ ] **Step 4: Add the validator and wire it into the endpoints**

In `backend/app/api/v1/endpoints/profile.py`, add the import and helper near the top (after `DEFAULT_TABS`):

```python
from app.services.interests import fetch_active_catalog


def _valid_slugs(requested, catalog) -> list:
    """Keep only requested slugs present in the catalog; [] if none/None."""
    allowed = {c["slug"] for c in catalog}
    return [s for s in (requested or []) if s in allowed]
```

In `update_profile`, after `data = payload.model_dump(exclude_unset=True)` (~line 60), validate any provided slugs:

```python
    if "interest_slugs" in data:
        data["interest_slugs"] = _valid_slugs(data["interest_slugs"], fetch_active_catalog(supabase))
```

In both `get_profile` and `update_profile`, add `interest_slugs` to every `ProfileResponse(...)` return (there are three: the default-profile return ~28, the get return ~42, the post return ~83). For the DB-backed returns add:

```python
        interest_slugs=profile_data.get("interest_slugs") or [],
```

For the default-profile return (no row), add `interest_slugs=[]`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_profile_interests.py -v`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/profile.py backend/app/api/v1/endpoints/profile.py backend/tests/test_profile_interests.py
git commit -m "Persist + validate profile interest_slugs against the catalog"
```

---

## Task 6: Important-tab threshold 70 → 60

**Files:**
- Modify: `frontend/src/app/components/InboxScreen.tsx` (~197-199)

**Interfaces:**
- Consumes: `EventLite.personalized_priority`.
- Produces: Important tab filters `>= 60`.

- [ ] **Step 1: Make the change**

In `frontend/src/app/components/InboxScreen.tsx`, find:

```tsx
    if (tabLower === "important") {
      // Show high importance or high priority items
      return ev.personalized_priority && ev.personalized_priority >= 70;
    }
```

Replace `70` with `60` and update the comment:

```tsx
    if (tabLower === "important") {
      // Mail the priority score marks important (shared threshold with notifications)
      return ev.personalized_priority && ev.personalized_priority >= 60;
    }
```

- [ ] **Step 2: Build to verify the frontend compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no TS/bundler errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/InboxScreen.tsx
git commit -m "Lower Important-tab threshold to 60 for relevance-led priority"
```

---

## Task 7: Settings interest picker (catalog-backed, persisted)

**Files:**
- Modify: `frontend/src/app/components/SettingsScreen.tsx` (imports ~1-7; replace `tracks`/`selectedTracks` state ~7,52,230-234; replace "Career Track" section ~451-482)

**Interfaces:**
- Consumes: `GET /api/v1/interests/catalog` → `{slug,label}[]`; `GET /api/v1/profile` → `{interest_slugs}`; `POST /api/v1/profile` with `{interest_slugs}`.
- Produces: persisted interest selection editable from Settings.

- [ ] **Step 1: Remove the hardcoded tracks constant**

In `frontend/src/app/components/SettingsScreen.tsx`, delete line 7:

```tsx
const tracks = ["Software", "Quant", "Research", "Core", "Design", "Finance"];
```

- [ ] **Step 2: Replace the local track state with catalog + selection state**

Replace line 52:

```tsx
  const [selectedTracks, setSelectedTracks] = useState<string[]>(["Software", "Research"]);
```

with:

```tsx
  const [catalog, setCatalog] = useState<{ slug: string; label: string }[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
```

- [ ] **Step 3: Fetch catalog + current selection on mount**

Inside the existing `useEffect` that runs `fetchAccounts()` (the `supabase.auth.getSession().then(...)` block ~120-127), add a call `loadInterests();` next to `fetchAccounts();`. Then add this function next to `fetchAccounts` (~100):

```tsx
  const loadInterests = async () => {
    try {
      const [catRes, profRes] = await Promise.all([
        apiFetch("/api/v1/interests/catalog"),
        apiFetch("/api/v1/profile"),
      ]);
      if (catRes.ok) setCatalog(await catRes.json());
      if (profRes.ok) {
        const prof = await profRes.json();
        setSelectedSlugs(prof.interest_slugs || []);
      }
    } catch (err) {
      console.error("Error loading interests:", err);
    }
  };
```

- [ ] **Step 4: Replace the toggle handler to persist on change**

Replace `toggleTrack` (~230-234) with:

```tsx
  const toggleInterest = async (slug: string) => {
    const next = selectedSlugs.includes(slug)
      ? selectedSlugs.filter((s) => s !== slug)
      : [...selectedSlugs, slug];
    setSelectedSlugs(next);
    try {
      await apiFetch("/api/v1/profile", {
        method: "POST",
        body: JSON.stringify({ interest_slugs: next }),
      });
    } catch (err) {
      console.error("Error saving interests:", err);
    }
  };
```

- [ ] **Step 5: Replace the "Career Track" section**

Replace the entire "Career Track" block (~451-482) with:

```tsx
        {/* ─── Interests ─── */}
        <div className="mb-6">
          <span style={sectionLabel} className="block mb-2.5">Interests</span>
          <div style={{ ...groupCard, padding: 16 }}>
            <p style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              Pick what you care about. KRNL surfaces matching mail higher and into your Important tab.
            </p>
            <div className="flex flex-wrap gap-2">
              {catalog.map((item) => {
                const active = selectedSlugs.includes(item.slug);
                return (
                  <motion.button
                    key={item.slug}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => toggleInterest(item.slug)}
                    className="px-3.5 py-1.5"
                    style={{
                      borderRadius: 9,
                      background: active ? "var(--accent-weak)" : "transparent",
                      border: active ? "1px solid transparent" : "1px solid var(--border)",
                      color: active ? "var(--accent)" : "var(--text-3)",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {item.label}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
```

- [ ] **Step 6: Build to verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds with no unused-symbol errors (the old `tracks`/`selectedTracks`/`toggleTrack` are fully removed).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/components/SettingsScreen.tsx
git commit -m "Replace hardcoded Career Track with catalog-backed interest picker"
```

---

## Task 8: First-login onboarding interest picker

**Files:**
- Create: `frontend/src/app/components/OnboardingInterests.tsx`
- Modify: `frontend/src/app/App.tsx` (imports; onboarding gate inside the `session` branch ~170-295)

**Interfaces:**
- Consumes: `GET /api/v1/interests/catalog`, `GET /api/v1/profile`, `POST /api/v1/profile`.
- Produces: `<OnboardingInterests onDone={() => void} />`; App shows it when `interest_slugs` is empty.

- [ ] **Step 1: Create the onboarding component**

Create `frontend/src/app/components/OnboardingInterests.tsx`:

```tsx
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { apiFetch } from "../utils/api";

export function OnboardingInterests({ onDone }: { onDone: () => void }) {
  const [catalog, setCatalog] = useState<{ slug: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/v1/interests/catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch((err) => console.error("Error loading catalog:", err));
  }, []);

  const toggle = (slug: string) =>
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/v1/profile", {
        method: "POST",
        body: JSON.stringify({ interest_slugs: selected }),
      });
      onDone();
    } catch (err) {
      console.error("Error saving interests:", err);
      onDone(); // don't trap the user if the save fails
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      <div style={{ paddingTop: "var(--status-bar-pad)" }} className="px-5 pt-6">
        <span style={{ color: "var(--text)", fontSize: 22, fontWeight: 700, display: "block" }}>
          What are you into?
        </span>
        <span style={{ color: "var(--text-3)", fontSize: 14, marginTop: 4, display: "block" }}>
          Pick a few. KRNL uses these to surface the mail that matters to you.
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 mt-6" style={{ scrollbarWidth: "none" }}>
        <div className="flex flex-wrap gap-2.5">
          {catalog.map((item) => {
            const active = selected.includes(item.slug);
            return (
              <motion.button
                key={item.slug}
                whileTap={{ scale: 0.93 }}
                onClick={() => toggle(item.slug)}
                className="px-4 py-2"
                style={{
                  borderRadius: 10,
                  background: active ? "var(--accent-weak)" : "transparent",
                  border: active ? "1px solid transparent" : "1px solid var(--border)",
                  color: active ? "var(--accent)" : "var(--text-3)",
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {item.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="px-5 pb-8 pt-4">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={save}
          disabled={saving}
          className="w-full py-3.5"
          style={{
            background: "var(--accent)",
            borderRadius: 12,
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : selected.length ? "Continue" : "Skip for now"}
        </motion.button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Import it and add onboarding state in App.tsx**

In `frontend/src/app/App.tsx`, add the import beside the other component imports (~8):

```tsx
import { OnboardingInterests } from "./components/OnboardingInterests";
```

Add state near the other `useState` hooks (~26):

```tsx
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
```

- [ ] **Step 3: Check the profile once a session exists**

In the same file, add an effect after the existing auth effect (after the `useEffect` that sets the session, ~85):

```tsx
  useEffect(() => {
    if (!session) {
      setOnboardingChecked(false);
      setNeedsOnboarding(false);
      return;
    }
    apiFetch("/api/v1/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((prof) => {
        setNeedsOnboarding(!!prof && (prof.interest_slugs || []).length === 0);
      })
      .catch((err) => console.error("Error checking onboarding:", err))
      .finally(() => setOnboardingChecked(true));
  }, [session]);
```

(`apiFetch` is already imported in App.tsx via the components; if not present, add `import { apiFetch } from "./utils/api";`.)

- [ ] **Step 4: Render the gate**

In the `session` branch, wrap the main UI so onboarding shows first. Find the start of the authenticated content (the `) : (` opening the `<>` at ~170) and immediately inside the `<>`, add a guarded early block. Concretely, replace:

```tsx
        ) : (
          <>
            {/* Status bar notch area (Desktop frame only) */}
```

with:

```tsx
        ) : onboardingChecked && needsOnboarding ? (
          <OnboardingInterests onDone={() => setNeedsOnboarding(false)} />
        ) : (
          <>
            {/* Status bar notch area (Desktop frame only) */}
```

- [ ] **Step 5: Build to verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/OnboardingInterests.tsx frontend/src/app/App.tsx
git commit -m "Add first-login interest onboarding gate"
```

---

## Task 9: Docs + cleanup tracking

**Files:**
- Modify: `PROJECT_LOG.md`, `docs/PRODUCTION_CLEANUP.md`, `memory/krnl-v3-status.md`

- [ ] **Step 1: Update PROJECT_LOG status + cleanup notes**

Add a 2026-06-30 status line to `PROJECT_LOG.md` pointing at the spec/plan, and in `docs/PRODUCTION_CLEANUP.md` note that the migration `interests_priority_migration.sql` must be run in Supabase before this feature works in any environment (manual migration). No dev-only scaffolding is introduced.

- [ ] **Step 2: Commit**

```bash
git add PROJECT_LOG.md docs/PRODUCTION_CLEANUP.md
git commit -m "Document interests/priority redesign; flag migration as a manual deploy step"
```

---

## Self-Review

**Spec coverage:**
- Fixed catalog, read-time match → Tasks 1,2,3,4. ✓
- DB-table catalog served via API → Tasks 1,2. ✓
- `interest_slugs` on profile, retire free-text `interests` (left in place, relaxed to optional) → Tasks 1,5. ✓
- `events.interest_tags` via catalog-aware extraction → Tasks 1,4. ✓
- Relevance-led blend `0.4/0.6`, grade `{0,60,100}`, importance-only fallback → Task 3. ✓
- Threshold 60 shared (Important tab now; notifications next spec) → Tasks 3 (`IMPORTANT_THRESHOLD`), 6 (inbox). ✓
- Onboarding + Settings picker → Tasks 7,8. ✓
- Tabs/category untouched → only the Important threshold changes (Task 6). ✓
- Out-of-scope (custom tabs, per-user feedback, backfill, unification) → not implemented, recorded in spec. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `interest_slugs` (profile), `interest_tags` (events) used consistently; `IMPORTANT_THRESHOLD` defined once in events.py; `fetch_active_catalog`/`build_catalog_lookup`/`normalize_interest_tags` signatures match across Tasks 2/4/5; catalog item shape `{slug,label}` consistent in backend + both frontend pickers. ✓

**Migration dependency:** Tasks 3–8 assume Task 1's columns exist. Backend defaults (`parse_tags` of a missing column → `[]`, `_valid_slugs(None) → []`) keep code safe even before the migration runs, but real behavior needs Task 1 applied. Flagged in Task 9.
