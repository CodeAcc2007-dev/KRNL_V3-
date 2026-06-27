# Ask KRNL Accuracy & Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ask KRNL reliably enumerate every event the task view shows, state exact deadline/venue/links, and reason about "this week"/"next 7 days" against the real current date — with no extra LLM round-trip.

**Architecture:** On each query, build a single numbered "source set" by merging (a) the upcoming-deadline agenda pulled straight from the events table (recall) with (b) event-deduped hybrid-retrieval chunks (detail), inject today-in-IST into the prompt, and map citations over the merged set. Add cache invalidation on sync so stale answers don't replay. Pure helpers live in small focused modules and are unit-tested; the endpoint wires them together.

**Tech Stack:** Python 3, FastAPI, Supabase client, Qdrant client, Redis, pytest. Frontend: React + TypeScript (Vite).

## Global Constraints

- No AI/model references in code, comments, strings, or commit messages (say "Summary", not "AI Summary"). Verbatim rule from PROJECT_LOG.
- Keep code minimal; do not refactor unrelated code.
- Log any dev/test/extra addition in `docs/PRODUCTION_CLEANUP.md` only if it is dev-only; production code needs no entry.
- Run all backend commands and tests from the `backend/` directory. The repo path contains a space (`KRNL -V3`) — quote it in shells.
- pytest is installed system-wide; Python deps are system-wide (no venv).
- Gemini model id stays `gemini-3.1-flash-lite`; do NOT add any new LLM call.
- "Today in IST" must be computed the same way as `get_urgency_label` in `backend/app/api/v1/endpoints/events.py` (UTC now + 5:30, compare by date) so Ask KRNL and the task view agree.

---

### Task 1: Date utilities

**Files:**
- Create: `backend/app/utils/dates.py`
- Test: `backend/tests/test_dates.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ist_today(now_utc: datetime | None = None) -> datetime.date`
  - `today_anchor(now_utc: datetime | None = None) -> str` (e.g. `"Sunday, 2026-06-28"`)
  - `parse_deadline_date(deadline_str: str | None) -> datetime.date | None`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dates.py
"""Tests for IST date helpers shared by Ask KRNL retrieval/answering."""
from datetime import datetime, timezone, date
from app.utils.dates import ist_today, today_anchor, parse_deadline_date


def test_ist_today_rolls_forward_past_utc_evening():
    # 2026-06-27 19:00 UTC -> 00:30 IST next day
    assert ist_today(datetime(2026, 6, 27, 19, 0, tzinfo=timezone.utc)) == date(2026, 6, 28)


def test_ist_today_stays_same_day_before_boundary():
    # 2026-06-27 18:00 UTC -> 23:30 IST same day
    assert ist_today(datetime(2026, 6, 27, 18, 0, tzinfo=timezone.utc)) == date(2026, 6, 27)


def test_today_anchor_formats_weekday_and_date():
    assert today_anchor(datetime(2026, 6, 27, 19, 0, tzinfo=timezone.utc)) == "Sunday, 2026-06-28"


def test_parse_deadline_date_handles_date_only():
    assert parse_deadline_date("2026-06-25") == date(2026, 6, 25)


def test_parse_deadline_date_handles_timestamp_variants():
    assert parse_deadline_date("2026-06-25 14:30:00") == date(2026, 6, 25)
    assert parse_deadline_date("2026-06-25T14:30:00Z") == date(2026, 6, 25)
    assert parse_deadline_date("2026-06-25 14:30:00.123") == date(2026, 6, 25)


def test_parse_deadline_date_returns_none_on_bad_input():
    assert parse_deadline_date(None) is None
    assert parse_deadline_date("") is None
    assert parse_deadline_date("not a date") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_dates.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.utils.dates'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/utils/dates.py
"""Shared IST date helpers (UTC + 05:30, compared by calendar date)."""
from datetime import datetime, timezone, timedelta, date

IST_OFFSET = timedelta(hours=5, minutes=30)


def ist_today(now_utc: datetime | None = None) -> date:
    now_utc = now_utc or datetime.now(timezone.utc)
    return (now_utc + IST_OFFSET).date()


def today_anchor(now_utc: datetime | None = None) -> str:
    return ist_today(now_utc).strftime("%A, %Y-%m-%d")


def parse_deadline_date(deadline_str: str | None) -> date | None:
    if not deadline_str:
        return None
    clean = deadline_str.replace("Z", "").replace("T", " ").split(".")[0]
    try:
        return datetime.strptime(clean, "%Y-%m-%d %H:%M:%S").date()
    except Exception:
        try:
            return datetime.strptime(clean.split()[0], "%Y-%m-%d").date()
        except Exception:
            return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_dates.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/utils/dates.py backend/tests/test_dates.py
git commit -m "Add shared IST date helpers for Ask KRNL"
```

---

### Task 2: Upcoming-deadline agenda in retrieval

**Files:**
- Modify: `backend/app/services/retrieval.py`
- Test: `backend/tests/test_agenda.py`

**Interfaces:**
- Consumes: `app.utils.dates.ist_today`, `app.utils.dates.parse_deadline_date`.
- Produces:
  - `_select_upcoming(rows: list[dict], today: date, grace_days: int = 1) -> list[dict]` (pure; filters out deadlines older than `today - grace_days`, sorts ascending by deadline string, maps each row to `{"event_id": str, "display_name": str, "deadline": str|None, "venue": str|None, "category": str}`).
  - `get_upcoming_agenda(user_id: str, grace_days: int = 1, limit: int = 25) -> list[dict]` (fetches deadline-bearing events for the user, then returns the soonest `limit` upcoming items from `_select_upcoming(...)`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agenda.py
"""Tests for the structured upcoming-deadline agenda used by Ask KRNL."""
from datetime import date
from app.services.retrieval import _select_upcoming


def _row(id, name, deadline, venue="V", category="General"):
    return {"id": id, "display_name": name, "deadline": deadline,
            "venue": venue, "category": category}


def test_drops_deadlines_before_grace_window():
    today = date(2026, 6, 28)
    rows = [
        _row(1, "Past", "2026-06-25"),       # 3 days past -> dropped (grace 1)
        _row(2, "Future", "2026-07-01"),     # kept
    ]
    out = _select_upcoming(rows, today, grace_days=1)
    names = [o["display_name"] for o in out]
    assert names == ["Future"]


def test_keeps_yesterday_within_grace():
    today = date(2026, 6, 28)
    rows = [_row(1, "Yesterday", "2026-06-27")]
    out = _select_upcoming(rows, today, grace_days=1)
    assert [o["display_name"] for o in out] == ["Yesterday"]


def test_sorts_ascending_by_deadline():
    today = date(2026, 6, 28)
    rows = [
        _row(1, "Later", "2026-07-10"),
        _row(2, "Sooner", "2026-06-30"),
    ]
    out = _select_upcoming(rows, today, grace_days=1)
    assert [o["display_name"] for o in out] == ["Sooner", "Later"]


def test_maps_compact_shape_with_string_event_id():
    today = date(2026, 6, 28)
    out = _select_upcoming([_row(7, "X", "2026-06-30", venue="Room 1",
                                 category="Academic")], today)
    assert out[0] == {"event_id": "7", "display_name": "X",
                      "deadline": "2026-06-30", "venue": "Room 1",
                      "category": "Academic"}


def test_skips_rows_with_unparseable_deadline():
    today = date(2026, 6, 28)
    rows = [_row(1, "Bad", "garbage"), _row(2, "Good", "2026-06-30")]
    out = _select_upcoming(rows, today)
    assert [o["display_name"] for o in out] == ["Good"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_agenda.py -v`
Expected: FAIL with `ImportError: cannot import name '_select_upcoming'`

- [ ] **Step 3: Write minimal implementation**

Add the import near the top of `backend/app/services/retrieval.py` (after the existing imports):

```python
from datetime import date, timedelta
from app.utils.dates import ist_today, parse_deadline_date
```

Add these functions to `backend/app/services/retrieval.py` (after `hybrid_retrieval`):

```python
def _select_upcoming(rows: list[dict], today: date, grace_days: int = 1) -> list[dict]:
    """Filter deadline rows to upcoming (>= today - grace_days), sorted ascending."""
    cutoff = today - timedelta(days=grace_days)
    kept = []
    for row in rows:
        deadline_str = row.get("deadline")
        d = parse_deadline_date(deadline_str)
        if d is None or d < cutoff:
            continue
        kept.append((deadline_str, row))
    kept.sort(key=lambda pair: pair[0] or "")
    return [
        {
            "event_id": str(row.get("id")),
            "display_name": row.get("display_name") or "Unknown Event",
            "deadline": row.get("deadline"),
            "venue": row.get("venue"),
            "category": row.get("category") or "General",
        }
        for _, row in kept
    ]


def get_upcoming_agenda(user_id: str, grace_days: int = 1, limit: int = 25) -> list[dict]:
    """Pull deadline-bearing events for the user (same source as the task view)
    and return the soonest `limit` upcoming agenda items."""
    try:
        res = (
            supabase.table("events")
            .select("*")
            .eq("user_id", user_id)
            .not_.is_("deadline", "null")
            .execute()
        )
        rows = res.data or []
    except Exception as e:
        logger.error(f"Failed to fetch agenda in get_upcoming_agenda: {e}")
        return []
    return _select_upcoming(rows, ist_today(), grace_days=grace_days)[:limit]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_agenda.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/retrieval.py backend/tests/test_agenda.py
git commit -m "Add upcoming-deadline agenda to retrieval"
```

---

### Task 3: Dedupe vector results by event

**Files:**
- Modify: `backend/app/services/retrieval.py`
- Test: `backend/tests/test_dedupe_vector.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `dedupe_vector_docs(vector_docs: list[tuple[str, str]]) -> list[tuple[str, str]]` (keeps the first `(event_id, text)` seen per `event_id`, preserving order). Wired into `hybrid_retrieval` so vector results are deduped before RRF.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dedupe_vector.py
"""Vector chunks must collapse to one entry per event before fusion."""
from app.services.retrieval import dedupe_vector_docs


def test_keeps_first_chunk_per_event_in_order():
    docs = [("5", "chunk a"), ("5", "chunk b"), ("9", "chunk c")]
    assert dedupe_vector_docs(docs) == [("5", "chunk a"), ("9", "chunk c")]


def test_empty_input():
    assert dedupe_vector_docs([]) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_dedupe_vector.py -v`
Expected: FAIL with `ImportError: cannot import name 'dedupe_vector_docs'`

- [ ] **Step 3: Write minimal implementation**

Add to `backend/app/services/retrieval.py`:

```python
def dedupe_vector_docs(vector_docs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Keep the highest-ranked chunk per event_id (first occurrence wins)."""
    seen = set()
    out = []
    for eid, txt in vector_docs:
        if eid in seen:
            continue
        seen.add(eid)
        out.append((eid, txt))
    return out
```

Wire it into `hybrid_retrieval`: in the existing body, right after the loop that builds `vector_docs` (the block that appends `(eid, txt)` tuples), add:

```python
    vector_docs = dedupe_vector_docs(vector_docs)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_dedupe_vector.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full retrieval-adjacent suite to confirm no regressions**

Run: `cd backend && pytest tests/test_dates.py tests/test_agenda.py tests/test_dedupe_vector.py -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/retrieval.py backend/tests/test_dedupe_vector.py
git commit -m "Dedupe vector retrieval results by event"
```

---

### Task 4: Answer-context builder (source set, rendering, citations)

**Files:**
- Create: `backend/app/services/answer_context.py`
- Test: `backend/tests/test_answer_context.py`

**Interfaces:**
- Consumes: `app.utils.dates.today_anchor`.
- Produces:
  - `SYSTEM_PROMPT: str`
  - `build_source_set(agenda: list[dict], rag_docs: list[dict], max_rag_extra: int = 5) -> list[dict]` — merges agenda (recall) with RAG docs (detail) keyed by `event_id`; agenda-first order; RAG-only events appended up to `max_rag_extra`; each source is `{"index": int, "event_id": str, "display_name": str, "deadline": str|None, "venue": str|None, "category": str, "links": list, "body": str}`; `index` is 1-based.
  - `render_context(sources: list[dict], anchor: str) -> str` — the user-prompt context block, beginning with the today anchor.
  - `to_superscript(n: int) -> str` — digit-wise unicode superscript (`12 -> "¹²"`).
  - `map_citations(answer_text: str, sources: list[dict]) -> tuple[str, list[dict]]` — replaces each `[n]` the model used with its superscript and returns citations `[{"id": int, "label": str, "event_id": int}]` for referenced sources only.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_answer_context.py
"""Tests for Ask KRNL source-set construction, rendering, and citations."""
from app.services.answer_context import (
    build_source_set, render_context, to_superscript, map_citations,
)


def _agenda(eid, name, deadline):
    return {"event_id": str(eid), "display_name": name, "deadline": deadline,
            "venue": "Room 1", "category": "Academic"}


def _rag(eid, name, text, links=None):
    return {"event_id": str(eid), "display_name": name, "text": text,
            "category": "General", "deadline": None, "venue": None,
            "links": links or [], "importance_score": 0.5}


def test_build_merges_rag_body_into_matching_agenda_event():
    agenda = [_agenda(5, "Quiz", "2026-06-30")]
    rag = [_rag(5, "Quiz", "Full body of quiz email", links=["http://x"])]
    sources = build_source_set(agenda, rag)
    assert len(sources) == 1
    s = sources[0]
    assert s["index"] == 1
    assert s["event_id"] == "5"
    assert s["body"] == "Full body of quiz email"
    assert s["links"] == ["http://x"]
    assert s["deadline"] == "2026-06-30"  # structured field preserved from agenda


def test_build_appends_rag_only_events_after_agenda():
    agenda = [_agenda(5, "Quiz", "2026-06-30")]
    rag = [_rag(9, "Policy", "Body about a policy")]
    sources = build_source_set(agenda, rag)
    assert [s["event_id"] for s in sources] == ["5", "9"]
    assert [s["index"] for s in sources] == [1, 2]


def test_build_caps_rag_only_extras():
    agenda = []
    rag = [_rag(i, f"E{i}", f"body {i}") for i in range(1, 9)]  # 8 RAG-only
    sources = build_source_set(agenda, rag, max_rag_extra=5)
    assert len(sources) == 5


def test_build_agenda_only_event_has_empty_body():
    sources = build_source_set([_agenda(5, "Quiz", "2026-06-30")], [])
    assert sources[0]["body"] == ""


def test_render_context_starts_with_today_anchor_and_lists_sources():
    sources = build_source_set([_agenda(5, "Quiz", "2026-06-30")], [])
    out = render_context(sources, "Sunday, 2026-06-28")
    assert out.startswith("Today is Sunday, 2026-06-28 (IST).")
    assert "[1]" in out
    assert "Quiz" in out
    assert "2026-06-30" in out


def test_to_superscript_multi_digit():
    assert to_superscript(1) == "¹"
    assert to_superscript(12) == "¹²"


def test_map_citations_resolves_agenda_only_event():
    sources = build_source_set([_agenda(5, "Quiz", "2026-06-30")], [])
    text, cites = map_citations("The quiz is on 2026-06-30 [1].", sources)
    assert "¹" in text and "[1]" not in text
    assert cites == [{"id": 1, "label": "Quiz", "event_id": 5}]


def test_map_citations_ignores_unreferenced_sources():
    sources = build_source_set(
        [_agenda(5, "Quiz", "2026-06-30"), _agenda(6, "Talk", "2026-07-01")], [])
    text, cites = map_citations("Only the quiz matters [1].", sources)
    assert [c["event_id"] for c in cites] == [5]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_answer_context.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.answer_context'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/answer_context.py
"""Builds the numbered source set, context string, and citations for Ask KRNL."""

SYSTEM_PROMPT = (
    "You are KRNL's assistant for an IIT Bombay student. Answer ONLY using the "
    "provided event sources. The context begins with today's date; treat any "
    "deadline before today as past and never describe a past deadline as "
    "upcoming. For questions about what is due or happening over a period "
    "(\"this week\", \"next 7 days\"), enumerate EVERY provided event whose "
    "deadline falls in that window and omit none. State exact dates and venues "
    "as given. If the sources do not contain the answer, say you do not know. "
    "Never invent links. Cite each statement with the source's bracket number, "
    "e.g. [1], [2]."
)


def build_source_set(agenda: list[dict], rag_docs: list[dict],
                     max_rag_extra: int = 5) -> list[dict]:
    by_event: dict[str, dict] = {}
    order: list[str] = []

    for item in agenda:
        eid = str(item.get("event_id"))
        by_event[eid] = {
            "event_id": eid,
            "display_name": item.get("display_name") or "Unknown Event",
            "deadline": item.get("deadline"),
            "venue": item.get("venue"),
            "category": item.get("category") or "General",
            "links": [],
            "body": "",
        }
        order.append(eid)

    extras = 0
    for doc in rag_docs:
        eid = str(doc.get("event_id"))
        body = doc.get("text") or ""
        if eid in by_event:
            src = by_event[eid]
            if not src["body"]:
                src["body"] = body
            if not src["links"]:
                src["links"] = doc.get("links") or []
            continue
        if extras >= max_rag_extra:
            continue
        by_event[eid] = {
            "event_id": eid,
            "display_name": doc.get("display_name") or "Unknown Event",
            "deadline": doc.get("deadline"),
            "venue": doc.get("venue"),
            "category": doc.get("category") or "General",
            "links": doc.get("links") or [],
            "body": body,
        }
        order.append(eid)
        extras += 1

    sources = []
    for idx, eid in enumerate(order, start=1):
        src = by_event[eid]
        src["index"] = idx
        sources.append(src)
    return sources


def render_context(sources: list[dict], anchor: str) -> str:
    lines = [f"Today is {anchor} (IST).", "", "Event sources:"]
    for s in sources:
        lines.append(f"[{s['index']}] {s['display_name']}")
        lines.append(
            f"    Deadline: {s['deadline'] or 'none'} | "
            f"Venue: {s['venue'] or 'none'} | Category: {s['category']}"
        )
        if s["links"]:
            lines.append(f"    Links: {', '.join(s['links'])}")
        if s["body"]:
            lines.append(f"    Details: {s['body']}")
    return "\n".join(lines)


_SUPERSCRIPT_DIGITS = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
}


def to_superscript(n: int) -> str:
    return "".join(_SUPERSCRIPT_DIGITS[d] for d in str(n))


def map_citations(answer_text: str, sources: list[dict]) -> tuple[str, list[dict]]:
    citations = []
    for s in sources:
        idx = s["index"]
        bracket = f"[{idx}]"
        if bracket in answer_text:
            answer_text = answer_text.replace(bracket, to_superscript(idx))
            try:
                event_id_val = int(s["event_id"])
            except (ValueError, TypeError):
                event_id_val = 0
            citations.append({
                "id": idx,
                "label": s["display_name"],
                "event_id": event_id_val,
            })
    return answer_text, citations
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_answer_context.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/answer_context.py backend/tests/test_answer_context.py
git commit -m "Add Ask KRNL answer-context builder and citation mapping"
```

---

### Task 5: Wire the query endpoint to the new pipeline

**Files:**
- Modify: `backend/app/api/v1/endpoints/query.py`

**Interfaces:**
- Consumes: `hybrid_retrieval`, `get_upcoming_agenda` (Task 2), `build_source_set`/`render_context`/`map_citations`/`SYSTEM_PROMPT` (Task 4), `today_anchor` (Task 1), existing `get_semantic_cache`/`set_semantic_cache`, `genai_client`.
- Produces: unchanged `QueryResponse` shape (`answer`, `citations`).

This task has no unit test (it makes a live model call); it is verified by a smoke run in Step 4. Keep the cache check, the empty-context fallback, and the response model exactly as today.

- [ ] **Step 1: Replace the retrieval/context/answer section of `query_ai_assistant`**

In `backend/app/api/v1/endpoints/query.py`, update the imports block (top of file) to:

```python
import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from google.genai import types
from app.core.security import get_current_user
from app.services.retrieval import hybrid_retrieval, get_upcoming_agenda
from app.services.semantic_cache import get_semantic_cache, set_semantic_cache
from app.services.answer_context import (
    SYSTEM_PROMPT, build_source_set, render_context, map_citations,
)
from app.utils.dates import today_anchor
from app.services.ingestion import genai_client
```

Replace everything from `# 2. Cache Miss: Perform Hybrid Retrieval` down to the end of the function with:

```python
    # 2. Cache miss: gather the upcoming agenda (recall) + retrieval detail.
    agenda = get_upcoming_agenda(user_id)
    rag_docs = hybrid_retrieval(query_text, user_id, limit=5)

    sources = build_source_set(agenda, rag_docs)
    if not sources:
        return QueryResponse(
            answer="I couldn't find any relevant emails or events in your KRNL inbox to answer this query.",
            citations=[],
        )

    context_str = render_context(sources, today_anchor())
    user_prompt = f"{context_str}\n\nUser question: {query_text}"

    # 3. Generate the answer.
    try:
        response = genai_client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.2,
            ),
        )
        answer_text = response.text or ""
    except Exception as e:
        logger.error(f"Assistant generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Assistant service failed: {str(e)}")

    # 4. Map citations over the unified source set.
    answer_text, citations = map_citations(answer_text, sources)

    # 5. Save back to the cache.
    set_semantic_cache(user_id, query_text, answer_text, citations)

    return QueryResponse(
        answer=answer_text,
        citations=[Citation(**c) for c in citations],
    )
```

Delete the now-unused `import re` if present and the old superscript dict block (it is fully replaced by `map_citations`).

- [ ] **Step 2: Confirm the module imports cleanly**

Run: `cd backend && python -c "import app.api.v1.endpoints.query"`
Expected: no output, exit 0.

- [ ] **Step 3: Run the full backend test suite (no regressions)**

Run: `cd backend && pytest -q`
Expected: PASS (all existing + new tests).

- [ ] **Step 4: Smoke-test the live endpoint**

Ensure Redis, the backend (`uvicorn app.main:app --port 8000`), and the events data are available. With a valid auth token in `$TOKEN`, ask a relative-time question:

Run:
```bash
curl -s -X POST http://localhost:8000/api/v1/query \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"what is due this week?"}' | python -m json.tool
```
Expected: the answer lists only events with deadlines on/after today (no past June dates as "upcoming"), reflects events visible in the task view, and `citations` map to real `event_id`s. If a previous run cached a stale answer, clear it first: `podman exec krnl-redis redis-cli --scan --pattern 'cache:*' | xargs -r podman exec krnl-redis redis-cli del`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/endpoints/query.py
git commit -m "Wire Ask KRNL to agenda + enriched context with today anchor"
```

---

### Task 6: Invalidate the query cache on new email

**Files:**
- Modify: `backend/app/services/semantic_cache.py`
- Modify: `backend/app/tasks/sync_task.py`
- Test: `backend/tests/test_cache_invalidation.py`

**Interfaces:**
- Consumes: module-level `redis_client` in `semantic_cache.py`.
- Produces: `invalidate_user_cache(user_id: str) -> int` (deletes all `cache:{user_id}:*` keys, returns the count deleted). Called from `sync_task.run_email_sync` when `emails_processed > 0`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cache_invalidation.py
"""invalidate_user_cache must delete only the target user's cached answers."""
import app.services.semantic_cache as sc


class FakeRedis:
    def __init__(self):
        self.store = {}

    def keys(self, pattern):
        prefix = pattern.rstrip("*")
        return [k for k in self.store if k.startswith(prefix)]

    def delete(self, *keys):
        n = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                n += 1
        return n


def test_deletes_only_target_user_keys(monkeypatch):
    fake = FakeRedis()
    fake.store = {
        "cache:userA:q1": "x",
        "cache:userA:q2": "y",
        "cache:userB:q1": "z",
    }
    monkeypatch.setattr(sc, "redis_client", fake)

    deleted = sc.invalidate_user_cache("userA")

    assert deleted == 2
    assert set(fake.store) == {"cache:userB:q1"}


def test_no_keys_is_a_noop(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(sc, "redis_client", fake)
    assert sc.invalidate_user_cache("ghost") == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_cache_invalidation.py -v`
Expected: FAIL with `AttributeError: module 'app.services.semantic_cache' has no attribute 'invalidate_user_cache'`

- [ ] **Step 3: Write minimal implementation**

Add to `backend/app/services/semantic_cache.py`:

```python
def invalidate_user_cache(user_id: str) -> int:
    """Delete all cached query answers for a user (call after a sync ingests new events)."""
    try:
        keys = redis_client.keys(f"cache:{user_id}:*")
        if not keys:
            return 0
        return redis_client.delete(*keys)
    except Exception as e:
        logger.error(f"Failed to invalidate semantic cache for {user_id}: {e}")
        return 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_cache_invalidation.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Call it from the sync task**

In `backend/app/tasks/sync_task.py`, add the import near the other service imports:

```python
from app.services.semantic_cache import invalidate_user_cache
```

Find the success-logging line near the end of `run_email_sync`:

```python
        logger.info(f"Email sync completed successfully. Processed {emails_processed}, skipped {emails_skipped} (already ingested).")
```

Immediately before it, insert:

```python
        if emails_processed > 0:
            invalidate_user_cache(user_id)
```

- [ ] **Step 6: Confirm the sync module imports cleanly**

Run: `cd backend && python -c "import app.tasks.sync_task"`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/semantic_cache.py backend/app/tasks/sync_task.py backend/tests/test_cache_invalidation.py
git commit -m "Invalidate Ask KRNL cache when a sync ingests new events"
```

---

### Task 7: Render multi-digit citations in the frontend

**Files:**
- Modify: `frontend/src/app/components/AskKrnlScreen.tsx`

**Interfaces:**
- Consumes: superscript citation markers emitted by the backend (`map_citations`, Task 4), now any index (`¹`…`⁹`, `¹⁰`, `¹¹`, …).
- Produces: no API change; the renderer must parse runs of superscript digits back to a number and link to `citations[n-1]`.

The frontend has no test runner; verify via build + visual check. The current code (around lines 33 and 44-45 of `AskKrnlScreen.tsx`) only recognizes `¹`–`⁵` via a hardcoded split regex and a manual ternary. Replace both with superscript-run handling.

- [ ] **Step 1: Read the current renderer block**

Open `frontend/src/app/components/AskKrnlScreen.tsx` and locate the line that splits on `(\*\*[^*]+\*\*|¹|²|³|⁴|⁵)` and the block that checks `["¹","²","³","⁴","⁵"].includes(part)` and derives `num` via the ternary. You will replace these so any number of superscript digits is treated as one citation marker.

- [ ] **Step 2: Update the split regex**

Change the split so a run of one-or-more superscript digits is one token:

```tsx
    const parts = line.split(/(\*\*[^*]+\*\*|[¹²³⁰⁴-⁹]+)/g);
```

- [ ] **Step 3: Update the marker detection + number parsing**

Replace the `if (["¹","²","³","⁴","⁵"].includes(part)) { const num = ... }` block with a superscript-run parser:

```tsx
          const superMap: Record<string, string> = {
            "⁰": "0", "¹": "1", "²": "2", "³": "3",
            "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7",
            "⁸": "8", "⁹": "9",
          };
          const isSuper = part.length > 0 && [...part].every((ch) => ch in superMap);
          if (isSuper) {
            const num = parseInt([...part].map((ch) => superMap[ch]).join(""), 10);
```

Keep the existing body that uses `num` to look up the citation and render the tappable marker (it already maps `num` to a citation). Ensure the citation lookup uses `num - 1` against the `citations` array (or `id === num`) exactly as the current code does — do not change that linkage, only how `num` is derived.

- [ ] **Step 4: Build to verify no type/compile errors**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Visual check**

With the full stack running, open `http://localhost:5173/`, go to Ask KRNL, ask "what is due in the next 7 days?", and confirm the answer renders superscript citation markers (including any beyond 5) as tappable chips that open the right event. (Use the screenshot/visual path from the run skill.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/AskKrnlScreen.tsx
git commit -m "Render multi-digit Ask KRNL citation markers"
```

---

## Final verification

- [ ] Run the whole backend suite: `cd backend && pytest -q` — all green.
- [ ] Build the frontend: `cd frontend && npm run build` — succeeds.
- [ ] Live check against today's date: clear the cache, ask "what is due this week?" and "what's due in the next 7 days?", and confirm answers exclude past deadlines, include every upcoming task-view event in the window, state exact dates/venues, and cite real events.
- [ ] Update `PROJECT_LOG.md` Issues tracker: mark Issue A RESOLVED with a one-line summary and link to this plan.
