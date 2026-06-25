# Deadline-extension Intelligence on Redis Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the email sync for real on Redis/Celery and auto-merge deadline-extension emails into their original event (forward-only, logged), showing the update email in the inbox.

**Architecture:** A minimal Docker Redis + Celery worker make the async sync path real. A new `app/services/event_merge.py` matches an update email to an existing event (Qdrant embedding shortlist + Gemini yes/no confirm) and, if the new deadline is strictly later, updates the original event's `deadline` + `deadline_history`. The update email is still inserted as its own inbox row with `deadline = NULL`. Frontend surfaces a "Deadline extended" badge and an "Update" tag.

**Tech Stack:** FastAPI, Supabase (Postgres via supabase-py), Qdrant, Celery + Redis, Gemini (google-genai), Vite/React, pytest.

## Global Constraints

- **No AI/model references** in code, comments, user-facing strings, or commit messages (no `Co-Authored-By` AI trailer).
- **Minimal code** — smallest change that works; no speculative abstractions.
- **Track dev/test/extra additions** in `docs/PRODUCTION_CLEANUP.md` (what / where / why / action).
- Repo path contains a space (`KRNL -V3`) — quote it in shell.
- Python deps are system-wide (no venv). Run backend commands from `backend/`.
- Migrations are plain SQL run manually in the Supabase SQL Editor; files live in `backend/migrations/`.
- The Phase 1 migration (`message_id`, `deadline_history jsonb DEFAULT '[]'`, `last_update_type`) is ALREADY applied.

---

### Task 1: Redis broker via Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Modify: `docs/PRODUCTION_CLEANUP.md`

**Interfaces:**
- Produces: a Redis broker reachable at `redis://localhost:6379/0` (matches `settings.REDIS_URL`).

- [ ] **Step 1: Create the compose file**

`docker-compose.yml`:
```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: krnl-redis
    ports:
      - "6379:6379"
    restart: unless-stopped
```

- [ ] **Step 2: Start Redis and verify**

Run:
```bash
cd "/home/CodeAcc2007/Coding/Projects/KRNL -V3" && docker compose up -d && docker exec krnl-redis redis-cli ping
```
Expected: `PONG`

- [ ] **Step 3: Verify Celery can reach the broker**

Run (from `backend/`):
```bash
python -c "from app.core.celery_app import celery_app; print(celery_app.control.ping(timeout=1))"
```
Expected: `[]` (no workers yet) printed without a connection error. A connection error means Redis isn't reachable — fix before continuing.

- [ ] **Step 4: Note the dev-only worker run command in the cleanup tracker**

Add a row to the "Test / dev scaffolding" table in `docs/PRODUCTION_CLEANUP.md`:
```markdown
| docker-compose.yml (local Redis) | repo root | local broker for dev/testing | Prod uses a managed Redis via REDIS_URL; compose is dev-only |
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docs/PRODUCTION_CLEANUP.md
git commit -m "Add local Redis via docker-compose for real sync testing"
```

---

### Task 2: Forward-only deadline decision (pure, TDD)

**Files:**
- Create: `backend/app/services/event_merge.py`
- Test: `backend/tests/test_event_merge.py`

**Interfaces:**
- Produces:
  - `parse_deadline(value: Optional[str]) -> Optional[datetime]`
  - `should_apply_extension(current: Optional[str], new: Optional[str]) -> bool`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_event_merge.py`:
```python
from app.services.event_merge import parse_deadline, should_apply_extension


def test_parse_handles_date_only_and_datetime_and_iso_t():
    assert parse_deadline("2026-06-20") is not None
    assert parse_deadline("2026-06-20 18:00:00") is not None
    assert parse_deadline("2026-06-20T18:00:00.123Z") is not None
    assert parse_deadline(None) is None
    assert parse_deadline("not a date") is None


def test_apply_only_when_new_is_strictly_later():
    assert should_apply_extension("2026-06-10", "2026-06-20") is True
    assert should_apply_extension("2026-06-20", "2026-06-10") is False
    assert should_apply_extension("2026-06-20", "2026-06-20") is False


def test_apply_false_when_either_side_unparseable_or_missing():
    assert should_apply_extension(None, "2026-06-20") is False
    assert should_apply_extension("2026-06-10", None) is False
    assert should_apply_extension("2026-06-10", "garbage") is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_event_merge.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.event_merge'`

- [ ] **Step 3: Write minimal implementation**

`backend/app/services/event_merge.py`:
```python
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger("uvicorn.error")


def parse_deadline(value: Optional[str]) -> Optional[datetime]:
    """Parse a stored deadline string (date or datetime) into a datetime, else None."""
    if not value:
        return None
    s = str(value).replace("Z", "").replace("T", " ").split(".")[0].strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def should_apply_extension(current: Optional[str], new: Optional[str]) -> bool:
    """Forward-only guard: true only when both parse and `new` is strictly later."""
    c = parse_deadline(current)
    n = parse_deadline(new)
    if c is None or n is None:
        return False
    return n > c
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_event_merge.py -q`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/event_merge.py backend/tests/test_event_merge.py
git commit -m "Add forward-only deadline decision helpers"
```

---

### Task 3: Match an update email to an existing event

**Files:**
- Modify: `backend/app/services/event_merge.py`
- Test: `backend/tests/test_event_merge.py`

**Interfaces:**
- Consumes: `generate_embeddings`, `qdrant_client` from `app.services.ingestion`; `supabase_service` is passed in.
- Produces:
  - `confirm_same_event(email_text: str, event: dict) -> bool`
  - `find_matching_event(user_id: str, email_text: str, supabase, limit: int = 3) -> Optional[dict]`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_event_merge.py`:
```python
import types as pytypes
from unittest.mock import patch, MagicMock
from app.services import event_merge


def _qpoint(event_id):
    return pytypes.SimpleNamespace(payload={"event_id": str(event_id)})


def test_find_matching_returns_confirmed_active_event():
    # Qdrant returns candidate event_id 11; supabase returns it with a future deadline.
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value = \
        pytypes.SimpleNamespace(data=[{"id": 11, "display_name": "SSoC 2026", "deadline": "2999-01-01"}])
    with patch.object(event_merge, "generate_embeddings", return_value=[0.0] * 768), \
         patch.object(event_merge.qdrant_client, "query_points",
                      return_value=pytypes.SimpleNamespace(points=[_qpoint(11)])), \
         patch.object(event_merge, "confirm_same_event", return_value=True):
        match = event_merge.find_matching_event("user-1", "deadline extended", fake_sb)
    assert match is not None and match["id"] == 11


def test_find_matching_returns_none_when_llm_declines():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value = \
        pytypes.SimpleNamespace(data=[{"id": 11, "display_name": "SSoC 2026", "deadline": "2999-01-01"}])
    with patch.object(event_merge, "generate_embeddings", return_value=[0.0] * 768), \
         patch.object(event_merge.qdrant_client, "query_points",
                      return_value=pytypes.SimpleNamespace(points=[_qpoint(11)])), \
         patch.object(event_merge, "confirm_same_event", return_value=False):
        assert event_merge.find_matching_event("user-1", "x", fake_sb) is None


def test_find_matching_returns_none_when_no_candidates():
    fake_sb = MagicMock()
    with patch.object(event_merge, "generate_embeddings", return_value=[0.0] * 768), \
         patch.object(event_merge.qdrant_client, "query_points",
                      return_value=pytypes.SimpleNamespace(points=[])):
        assert event_merge.find_matching_event("user-1", "x", fake_sb) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_event_merge.py -q`
Expected: FAIL — `AttributeError: module 'app.services.event_merge' has no attribute 'find_matching_event'` (and `qdrant_client`, `generate_embeddings`, `confirm_same_event`).

- [ ] **Step 3: Write minimal implementation**

Add to the top imports of `backend/app/services/event_merge.py`:
```python
from google.genai import types
from qdrant_client.http import models as qdrant_models
from app.services.ingestion import generate_embeddings, qdrant_client, genai_client
```

Add these functions to `backend/app/services/event_merge.py`:
```python
def confirm_same_event(email_text: str, event: dict) -> bool:
    """Ask Gemini yes/no whether the email updates the given event."""
    prompt = (
        "Does the following email provide an update (e.g. a new deadline) for the event "
        f"named \"{event.get('display_name')}\"? Answer with only YES or NO.\n\n"
        f"Email:\n{email_text[:2000]}"
    )
    try:
        resp = genai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.0),
        )
        return (resp.text or "").strip().upper().startswith("YES")
    except Exception as e:
        logger.error(f"confirm_same_event failed: {e}")
        return False


def find_matching_event(user_id: str, email_text: str, supabase, limit: int = 3) -> Optional[dict]:
    """Find the existing active event an update email refers to, or None.

    Embedding shortlist via Qdrant -> active events from Supabase -> LLM yes/no confirm.
    """
    try:
        vector = generate_embeddings(email_text)
    except Exception as e:
        logger.error(f"find_matching_event embedding failed: {e}")
        return None

    try:
        res = qdrant_client.query_points(
            collection_name="krnl_email_chunks",
            query=vector,
            query_filter=qdrant_models.Filter(must=[
                qdrant_models.FieldCondition(
                    key="user_id", match=qdrant_models.MatchValue(value=user_id)
                )
            ]),
            limit=limit * 2,
        )
        points = res.points
    except Exception as e:
        logger.error(f"find_matching_event qdrant search failed: {e}")
        return None

    # Ordered, de-duplicated candidate event_ids.
    candidate_ids: list[int] = []
    for p in points:
        eid = (p.payload or {}).get("event_id")
        try:
            eid_int = int(eid)
        except (TypeError, ValueError):
            continue
        if eid_int not in candidate_ids:
            candidate_ids.append(eid_int)
        if len(candidate_ids) >= limit:
            break
    if not candidate_ids:
        return None

    try:
        rows = supabase.table("events").select("*").in_("id", candidate_ids).eq("user_id", user_id).execute().data or []
    except Exception as e:
        logger.error(f"find_matching_event supabase fetch failed: {e}")
        return None

    today = datetime.utcnow()
    by_id = {r["id"]: r for r in rows}
    for eid in candidate_ids:  # preserve Qdrant rank order
        event = by_id.get(eid)
        if not event:
            continue
        dl = parse_deadline(event.get("deadline"))
        if dl is None or dl < today:  # active = future deadline
            continue
        if confirm_same_event(email_text, event):
            return event
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_event_merge.py -q`
Expected: PASS (all event_merge tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/event_merge.py backend/tests/test_event_merge.py
git commit -m "Add event matching (embedding shortlist + LLM confirm)"
```

---

### Task 4: Apply the extension to the original event

**Files:**
- Modify: `backend/app/services/event_merge.py`
- Test: `backend/tests/test_event_merge.py`

**Interfaces:**
- Produces: `apply_extension(event: dict, new_deadline: str, update_type: Optional[str], message_id: str, supabase) -> None`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_event_merge.py`:
```python
def test_apply_extension_updates_event_and_appends_history():
    fake_sb = MagicMock()
    captured = {}

    def fake_update(payload):
        captured["payload"] = payload
        return MagicMock(eq=lambda *a, **k: MagicMock(execute=lambda: None))

    fake_sb.table.return_value.update.side_effect = fake_update
    event = {"id": 11, "deadline": "2026-06-10", "deadline_history": []}

    event_merge.apply_extension(event, "2026-06-20", "deadline_extension", "msg-1", fake_sb)

    p = captured["payload"]
    assert p["deadline"] == "2026-06-20"
    assert p["last_update_type"] == "deadline_extension"
    assert len(p["deadline_history"]) == 1
    assert p["deadline_history"][0]["old"] == "2026-06-10"
    assert p["deadline_history"][0]["new"] == "2026-06-20"
    assert p["deadline_history"][0]["message_id"] == "msg-1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_event_merge.py::test_apply_extension_updates_event_and_appends_history -q`
Expected: FAIL — `AttributeError: ... has no attribute 'apply_extension'`

- [ ] **Step 3: Write minimal implementation**

Add to `backend/app/services/event_merge.py`:
```python
def apply_extension(event: dict, new_deadline: str, update_type: Optional[str],
                    message_id: str, supabase) -> None:
    """Move the original event's deadline forward and record the change."""
    history = list(event.get("deadline_history") or [])
    history.append({
        "old": event.get("deadline"),
        "new": new_deadline,
        "message_id": message_id,
        "at": datetime.utcnow().isoformat(),
    })
    supabase.table("events").update({
        "deadline": new_deadline,
        "deadline_history": history,
        "last_update_type": update_type,
    }).eq("id", event["id"]).execute()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_event_merge.py -q`
Expected: PASS (all event_merge tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/event_merge.py backend/tests/test_event_merge.py
git commit -m "Add apply_extension to move deadline forward with history"
```

---

### Task 5: Wire the merge into the sync task

**Files:**
- Modify: `backend/app/tasks/sync_task.py`

**Interfaces:**
- Consumes: `find_matching_event`, `should_apply_extension`, `apply_extension` from `app.services.event_merge`.

- [ ] **Step 1: Add the import**

In `backend/app/tasks/sync_task.py`, below the existing `from app.utils.dedup import get_message_id` line, add:
```python
from app.services.event_merge import find_matching_event, should_apply_extension, apply_extension
```

- [ ] **Step 2: Add the merge branch**

In `backend/app/tasks/sync_task.py`, find the block that builds `event_data` (the `extracted = extract_event_intelligence(...)` result is already available, and `message_id` is in scope). Immediately AFTER `extracted = extract_event_intelligence(subject, body, msg_date)` and BEFORE `event_data = {` is built, insert:
```python
                # Deadline-extension merge: if this email updates an event we already
                # have, move that event's deadline forward and show this email in the
                # inbox without its own deadline (so it doesn't double-list in Deadlines).
                matched_event = None
                if extracted.get("is_update") and extracted.get("update_type") == "deadline_extension" \
                        and extracted.get("deadline"):
                    try:
                        matched_event = find_matching_event(user_id, clean_email_body(body), supabase_service)
                    except Exception as e:
                        logger.error(f"Deadline-extension matching failed: {e}")
                    if matched_event and should_apply_extension(matched_event.get("deadline"), extracted.get("deadline")):
                        try:
                            apply_extension(matched_event, extracted.get("deadline"),
                                            extracted.get("update_type"), message_id, supabase_service)
                            logger.info(f"Applied deadline extension to event {matched_event['id']} "
                                        f"({matched_event.get('deadline')} -> {extracted.get('deadline')})")
                        except Exception as e:
                            logger.error(f"Failed to apply deadline extension: {e}")
```

- [ ] **Step 3: Null the deadline on the inbox row when matched**

In the same file, the `event_data` dict has `"deadline": extracted.get("deadline"),`. Replace that single line with:
```python
                    "deadline": None if matched_event else extracted.get("deadline"),
```

- [ ] **Step 4: Verify import + syntax**

Run: `cd backend && python -c "from app.tasks import sync_task; print('sync_task import OK')"`
Expected: `sync_task import OK`

- [ ] **Step 5: Run the full backend test suite (no regressions)**

Run: `cd backend && python -m pytest tests/ -q`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/tasks/sync_task.py
git commit -m "Wire deadline-extension merge into email sync"
```

---

### Task 6: Surface new fields in the API response

**Files:**
- Modify: `backend/app/schemas/event.py`
- Modify: `backend/app/api/v1/endpoints/events.py` (three `EventResponse(...)` construction sites)

**Interfaces:**
- Produces: `EventResponse` with `deadline_history: list` and `last_update_type: Optional[str]`.

- [ ] **Step 1: Add fields to the schema**

In `backend/app/schemas/event.py`, inside `class EventResponse`, after the `urgency_label` line add:
```python
    deadline_history: Optional[List[Any]] = None
    last_update_type: Optional[str] = None
```

- [ ] **Step 2: Pass the fields in `get_events`**

In `backend/app/api/v1/endpoints/events.py`, in the `get_events` function's `EventResponse(` call, after `urgency_label=urgency` add:
```python
            deadline_history=row.get("deadline_history") or [],
            last_update_type=row.get("last_update_type"),
```

- [ ] **Step 3: Pass the fields in `get_deadlines`**

In the same file, in `get_deadlines`'s `EventResponse(` call, after `urgency_label=urgency` add the same two lines:
```python
            deadline_history=row.get("deadline_history") or [],
            last_update_type=row.get("last_update_type"),
```

- [ ] **Step 4: Pass the fields in `get_event_detail`**

In the same file, in `get_event_detail`'s `EventResponse(` call, after `urgency_label=urgency` add the same two lines:
```python
            deadline_history=row.get("deadline_history") or [],
            last_update_type=row.get("last_update_type"),
```

- [ ] **Step 5: Verify import + syntax**

Run: `cd backend && python -c "from app.api.v1.endpoints import events; from app.schemas.event import EventResponse; print('events api OK')"`
Expected: `events api OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/event.py backend/app/api/v1/endpoints/events.py
git commit -m "Expose deadline_history and last_update_type in events API"
```

---

### Task 7: Deadlines "Deadline extended" badge (frontend)

**Files:**
- Modify: `frontend/src/app/components/DeadlinesScreen.tsx`
- Modify: `docs/PRODUCTION_CLEANUP.md`

**Interfaces:**
- Consumes: `deadline_history` on each deadline item from `GET /api/v1/deadlines`.

- [ ] **Step 1: Extend the EventItem interface**

In `frontend/src/app/components/DeadlinesScreen.tsx`, in the `interface EventItem {` block, add:
```typescript
  deadline_history?: Array<{ old?: string; new?: string }>;
```

- [ ] **Step 2: Render the badge next to the event name**

In the same file, find where `{item.display_name}` is rendered (around line 421). Immediately after that element, add:
```tsx
{item.deadline_history && item.deadline_history.length > 0 && (
  <span
    style={{
      marginLeft: 6,
      fontSize: 10,
      color: "#fbbf24",
      background: "rgba(245,158,11,0.15)",
      borderRadius: 4,
      padding: "1px 6px",
    }}
  >
    Deadline extended
  </span>
)}
```

- [ ] **Step 3: Note the mock fallback in the cleanup tracker**

Add a row to the "Mock / placeholder data" table in `docs/PRODUCTION_CLEANUP.md`:
```markdown
| Hardcoded deadline fallback list | DeadlinesScreen.tsx (~lines 50-88) | shows demo data when /deadlines fails | Remove before prod or replace with empty state |
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && npx tsc --noEmit`
Expected: no type errors related to `DeadlinesScreen.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/components/DeadlinesScreen.tsx docs/PRODUCTION_CLEANUP.md
git commit -m "Show deadline-extended badge in Deadlines view"
```

---

### Task 8: Inbox "Update" tag (frontend)

**Files:**
- Modify: `frontend/src/app/components/InboxScreen.tsx`
- Modify: `docs/PRODUCTION_CLEANUP.md`

**Interfaces:**
- Consumes: `last_update_type` on each event item from `GET /api/v1/events`.

- [ ] **Step 1: Extend the EventItem interface**

In `frontend/src/app/components/InboxScreen.tsx`, in the `interface EventItem {` block, add:
```typescript
  last_update_type?: string | null;
```

- [ ] **Step 2: Render an "Update" tag in the metadata group**

In the same file, find the metadata icon group (the `{/* Time */}` span around line 378). Immediately after the time `<span>...</span>`, add:
```tsx
{email.last_update_type && (
  <span
    style={{
      fontSize: 10,
      color: "#60a5fa",
      background: "rgba(59,130,246,0.15)",
      borderRadius: 4,
      padding: "1px 6px",
    }}
  >
    Update
  </span>
)}
```

- [ ] **Step 3: Note the mock fallback in the cleanup tracker**

Add a row to the "Mock / placeholder data" table in `docs/PRODUCTION_CLEANUP.md`:
```markdown
| Hardcoded inbox fallback list | InboxScreen.tsx (~lines 112-139) | shows demo data when /events fails | Remove before prod or replace with empty state |
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && npx tsc --noEmit`
Expected: no type errors related to `InboxScreen.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/components/InboxScreen.tsx docs/PRODUCTION_CLEANUP.md
git commit -m "Show Update tag on inbox items with an update type"
```

---

### Task 9: Qdrant health check + end-to-end verification

**Files:**
- Create: `backend/scripts/qdrant_healthcheck.py`
- Modify: `docs/PRODUCTION_CLEANUP.md`

**Interfaces:**
- Produces: a script that confirms vector search returns candidates for the test user.

- [ ] **Step 1: Write the health-check script**

`backend/scripts/qdrant_healthcheck.py`:
```python
"""Confirm Qdrant vector search returns candidates for a user (ops/diagnostic)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client
from app.core.config import settings
from app.services.event_merge import find_matching_event

sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
row = sb.table("events").select("user_id, display_name").limit(1).execute().data
if not row:
    print("No events to test against.")
    sys.exit(0)

user_id = row[0]["user_id"]
name = row[0]["display_name"]
match = find_matching_event(user_id, f"update regarding {name}", sb)
print(f"Search for '{name}' -> match: {match['display_name'] if match else None}")
```

- [ ] **Step 2: Run the health check**

Run: `cd backend && python scripts/qdrant_healthcheck.py`
Expected: prints a line; a non-error run confirms embedding + Qdrant search + Supabase fetch all work end-to-end. (A `None` match is acceptable — it means the LLM declined; an exception means Qdrant/embeddings are broken and must be fixed.)

- [ ] **Step 3: Start the Celery worker (separate terminal)**

Run (from `backend/`):
```bash
celery -A app.core.celery_app worker --concurrency=1 --loglevel=info
```
Leave it running. Add a row to `docs/PRODUCTION_CLEANUP.md` "Test / dev scaffolding":
```markdown
| backend/scripts/qdrant_healthcheck.py | backend/scripts/ | diagnostic | Keep as ops tool, not on a request path |
```

- [ ] **Step 4: Clear last_synced_at and trigger a 15-email sync**

Run (from `backend/`):
```bash
python -c "
from supabase import create_client
from app.core.config import settings
from app.tasks.sync_task import run_email_sync
sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
acc = sb.table('connected_accounts').select('id, user_id').eq('connection_status','connected').execute().data[0]
sb.table('connected_accounts').update({'last_synced_at': None}).eq('id', acc['id']).execute()
run_email_sync.delay(acc['user_id'], acc['id'], 15)
print('Dispatched 15-email sync for', acc['user_id'])
"
```
Expected: `Dispatched ...`. Watch the worker log: it should process emails, log `Skipping already-ingested ...` for dupes, and (if an extension email is present) `Applied deadline extension to event ...`.

- [ ] **Step 5: Verify final data state**

Run: `cd backend && python scripts/cleanup_duplicates.py`
Expected: a dry-run report. If it lists the one-time residual legacy dup, run `python scripts/cleanup_duplicates.py --apply` once more, then re-run the dry-run to confirm `No duplicates found.`

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/qdrant_healthcheck.py docs/PRODUCTION_CLEANUP.md
git commit -m "Add Qdrant health-check script and E2E sync verification"
```

---

### Task 10: Update project docs

**Files:**
- Modify: `docs/DEVELOPMENT_PLAN.md`
- Modify: `PROJECT_LOG.md`
- Create: `docs/sessions/2026-06-22-deadline-extension-build.md`

- [ ] **Step 1: Mark Phase 1.5 + Redis done in the plan**

In `docs/DEVELOPMENT_PLAN.md`, under the progress log, add a short "Phase 1.5 + Redis — DONE" entry summarizing: Docker Redis + Celery worker live; `event_merge.py` (match + forward-only apply); inbox Update tag + Deadlines badge; E2E sync verified.

- [ ] **Step 2: Update the status + issues tracker in PROJECT_LOG.md**

In `PROJECT_LOG.md`, move "deadline-extension" from "Next up" to "Done", and set the next focus to Issue A (Ask KRNL deadlines).

- [ ] **Step 3: Write the session log**

Create `docs/sessions/2026-06-22-deadline-extension-build.md` summarizing what was built, decisions, and how to proceed (mirror the style of the existing session logs).

- [ ] **Step 4: Commit**

```bash
git add docs/DEVELOPMENT_PLAN.md PROJECT_LOG.md docs/sessions/2026-06-22-deadline-extension-build.md
git commit -m "Update docs: deadline-extension build complete"
```

---

## Notes for the implementer

- **Why pure helpers are split out:** `parse_deadline` / `should_apply_extension` are the only logic with branching correctness concerns, so they get real unit tests. The I/O wrappers (`find_matching_event`, `apply_extension`) are tested with mocks and proven for real by the Task 9 E2E run — the 13s Gemini throttle makes large automated integration suites impractical.
- **Concurrency stays 1** (`worker_concurrency=1`) — it's the deliberate global Gemini pacer, not a perf bug. Do not raise it.
- **Forward-only is intentional:** a reminder or mis-match must never pull a deadline earlier. If `should_apply_extension` returns False, we still insert the email row (with `deadline = None` when an event matched) so it's visible.
