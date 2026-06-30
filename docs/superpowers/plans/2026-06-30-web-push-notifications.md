# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Web Push notifications for new important mail, 24h-ahead deadline reminders, and a Sunday-evening weekly digest, gated by per-user toggles.

**Architecture:** A single backend delivery primitive (`send_to_user`) sends payloads via `pywebpush` to a user's stored browser subscriptions and prunes dead ones. Three independent triggers call it: the sync task (important events, read-time priority ≥60), an hourly Beat task (deadline reminders), and a Sunday-18:00-IST Beat task (digest). The frontend subscribes only on an explicit Settings opt-in; the service worker renders pushes and routes clicks.

**Tech Stack:** FastAPI, Supabase (Postgres) via `supabase-py`, Celery + Beat (Redis broker), `pywebpush` (new dep) + `cryptography` for VAPID, React/Vite PWA, vanilla service worker (`frontend/public/sw.js`).

## Global Constraints

- No AI/model references in code, comments, strings, or commit messages.
- Keep code minimal (YAGNI); log every dev/test/extra addition in `docs/PRODUCTION_CLEANUP.md`.
- Migrations are applied **manually** in the Supabase SQL Editor — code must degrade safely before a migration runs (no crash; feature simply no-ops).
- `IMPORTANT_THRESHOLD = 60.0` is the shared importance bar (defined in `app/api/v1/endpoints/events.py`); the important-event trigger reuses `calculate_priority`.
- Backend tests run with `cd backend && python3 -m pytest`; existing 67 must stay green.
- Frontend must build clean with `cd frontend && npm run build`.
- New Python dependency installed via `python3 -m pip install --user pywebpush` (no requirements file exists yet; record the dep in `docs/PRODUCTION_CLEANUP.md` for the deploy manifest).

---

## File Structure

- Create `backend/migrations/notifications_migration.sql` — push_subscriptions table + events/profiles columns.
- Create `backend/scripts/gen_vapid_keys.py` — one-off VAPID keypair generator.
- Modify `backend/app/core/config.py` — add VAPID settings.
- Create `backend/app/services/push.py` — `send_to_user`, `_send_one`, pref gating, pruning.
- Create `backend/app/api/v1/endpoints/notifications.py` — vapid-public-key / subscribe / unsubscribe.
- Modify `backend/app/main.py` — register the notifications router.
- Modify `backend/app/schemas/profile.py` + `backend/app/api/v1/endpoints/profile.py` — carry `notification_prefs`.
- Modify `backend/app/tasks/sync_task.py` — important-event trigger.
- Create `backend/app/tasks/notify_task.py` — `send_due_reminders`, `send_weekly_digest`.
- Modify `backend/app/core/celery_app.py` — include notify_task, add 2 Beat entries, set timezone.
- Modify `frontend/public/sw.js` — `push` + `notificationclick` handlers.
- Create `frontend/src/app/utils/push.ts` — `enablePush` / `disablePush`.
- Modify `frontend/src/app/components/SettingsScreen.tsx` — notifications toggles.
- New tests: `backend/tests/test_push_service.py`, `test_notify_reminders.py`, `test_notify_digest.py`, `test_sync_important_notify.py`.

---

## Task 1: Database migration

**Files:**
- Create: `backend/migrations/notifications_migration.sql`

**Interfaces:**
- Produces: table `push_subscriptions(id, user_id, endpoint UNIQUE, p256dh, auth, created_at)`; `events.notified_at timestamptz`; `events.deadline_reminded boolean`; `profiles.notification_prefs jsonb`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Web Push: device subscriptions + per-event dedup flags + per-user prefs.
create table if not exists push_subscriptions (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- Dedup: stamped when an important-event push is sent.
alter table events add column if not exists notified_at timestamptz;
-- Dedup: set true when the 24h deadline reminder is sent.
alter table events add column if not exists deadline_reminded boolean not null default false;

-- Per-user notification toggles: master + 3 per-type.
alter table profiles add column if not exists notification_prefs jsonb
    default '{"master": true, "important": true, "reminders": true, "digest": true}'::jsonb;
```

- [ ] **Step 2: Apply manually in Supabase SQL Editor, then verify columns exist**

Run (from `backend/`):
```bash
python3 -c "
from app.core.security import supabase
print('events.notified_at present:', 'notified_at' in (supabase.table('events').select('*').limit(1).execute().data or [{}])[0])
print('subs table ok:', supabase.table('push_subscriptions').select('id').limit(1).execute() is not None)
"
```
Expected: both lines truthy (no exception).

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/notifications_migration.sql
git commit -m "Add notifications migration (subscriptions, dedup flags, prefs)"
```

---

## Task 2: VAPID keys + config

**Files:**
- Create: `backend/scripts/gen_vapid_keys.py`
- Modify: `backend/app/core/config.py`

**Interfaces:**
- Produces: `settings.VAPID_PUBLIC_KEY` (browser application-server key, base64url), `settings.VAPID_PRIVATE_KEY` (PEM, `\n`-escaped in env), `settings.VAPID_SUBJECT` (`mailto:`).

- [ ] **Step 1: Install the dependency**

Run: `python3 -m pip install --user pywebpush`
Expected: installs `pywebpush` + `py_vapid` + `cryptography` (already present).

- [ ] **Step 2: Write the key generator**

```python
# backend/scripts/gen_vapid_keys.py
"""One-off: generate a VAPID keypair for Web Push. Prints .env-ready values."""
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization


def main():
    priv = ec.generate_private_key(ec.SECP256R1())
    pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    pub_point = priv.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    app_server_key = base64.urlsafe_b64encode(pub_point).rstrip(b"=").decode()

    print("VAPID_PUBLIC_KEY=" + app_server_key)
    print("VAPID_PRIVATE_KEY=" + pem.replace("\n", "\\n"))
    print('VAPID_SUBJECT=mailto:admin@example.com')


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run it and paste the three lines into `backend/.env`**

Run: `cd backend && python3 scripts/gen_vapid_keys.py >> .env`
Then open `.env`, confirm the three keys appended, and set a real `VAPID_SUBJECT` mailto.

- [ ] **Step 4: Add settings fields**

In `backend/app/core/config.py`, add to `class Settings` (after `ALLOWED_ORIGINS`):
```python
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@example.com"
```

- [ ] **Step 5: Verify settings load**

Run: `cd backend && python3 -c "from app.core.config import settings; print(bool(settings.VAPID_PUBLIC_KEY), bool(settings.VAPID_PRIVATE_KEY))"`
Expected: `True True`

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/gen_vapid_keys.py backend/app/core/config.py
git commit -m "Add VAPID key generator and settings"
```

Note: do NOT commit `.env`. Record the new dep + env keys in `docs/PRODUCTION_CLEANUP.md`.

---

## Task 3: Push delivery service

**Files:**
- Create: `backend/app/services/push.py`
- Test: `backend/tests/test_push_service.py`

**Interfaces:**
- Consumes: `settings.VAPID_PRIVATE_KEY`, `settings.VAPID_SUBJECT`.
- Produces: `send_to_user(client, user_id: str, payload: dict, kind: str) -> int` — `client` is a supabase client; `payload` = `{"title","body","url"}`; `kind` in `{"important","reminders","digest"}`. Returns number of pushes sent. Reads `profiles.notification_prefs`; no-op (returns 0) if `master` off or `kind` toggle off. Deletes subscriptions on 404/410.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_push_service.py
"""send_to_user: pref gating, delivery, and dead-subscription pruning."""
from types import SimpleNamespace
import app.services.push as push


class FakeQuery:
    def __init__(self, store, table):
        self.store, self.table, self._rows, self._del = store, table, list(store.get(table, [])), None
    def select(self, *a, **k):
        return self
    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val]
        self._eqcol, self._eqval = col, val
        return self
    def delete(self):
        self._del = True
        return self
    def execute(self):
        if self._del:
            self.store[self.table] = [r for r in self.store.get(self.table, [])
                                      if r.get(self._eqcol) != self._eqval]
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, store):
        self.store = store
    def table(self, name):
        return FakeQuery(self.store, name)


def _store(prefs, subs):
    return {
        "profiles": [{"id": "u1", "notification_prefs": prefs}],
        "push_subscriptions": subs,
    }


def test_master_off_sends_nothing(monkeypatch):
    sent = []
    monkeypatch.setattr(push, "_send_one", lambda s, p: sent.append(s))
    store = _store({"master": False, "important": True},
                   [{"id": 1, "user_id": "u1", "endpoint": "e1", "p256dh": "x", "auth": "y"}])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 0 and sent == []


def test_type_off_sends_nothing(monkeypatch):
    sent = []
    monkeypatch.setattr(push, "_send_one", lambda s, p: sent.append(s))
    store = _store({"master": True, "important": False},
                   [{"id": 1, "user_id": "u1", "endpoint": "e1", "p256dh": "x", "auth": "y"}])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 0 and sent == []


def test_sends_to_all_subscriptions(monkeypatch):
    sent = []
    monkeypatch.setattr(push, "_send_one", lambda s, p: sent.append(s["endpoint"]))
    store = _store({"master": True, "important": True}, [
        {"id": 1, "user_id": "u1", "endpoint": "e1", "p256dh": "x", "auth": "y"},
        {"id": 2, "user_id": "u1", "endpoint": "e2", "p256dh": "x", "auth": "y"},
    ])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 2 and set(sent) == {"e1", "e2"}


def test_dead_subscription_pruned_others_still_sent(monkeypatch):
    def fake_send(sub, payload):
        if sub["endpoint"] == "dead":
            raise push.WebPushException("gone", response=SimpleNamespace(status_code=410))
    monkeypatch.setattr(push, "_send_one", fake_send)
    store = _store({"master": True, "important": True}, [
        {"id": 1, "user_id": "u1", "endpoint": "dead", "p256dh": "x", "auth": "y"},
        {"id": 2, "user_id": "u1", "endpoint": "live", "p256dh": "x", "auth": "y"},
    ])
    n = push.send_to_user(FakeSupabase(store), "u1", {"title": "t", "body": "b", "url": "/"}, "important")
    assert n == 1
    remaining = {r["endpoint"] for r in store["push_subscriptions"]}
    assert remaining == {"live"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python3 -m pytest tests/test_push_service.py -q`
Expected: FAIL (module `app.services.push` not found).

- [ ] **Step 3: Write the implementation**

```python
# backend/app/services/push.py
"""Web Push delivery: gate by prefs, send via pywebpush, prune dead subscriptions."""
import json
import logging
from pywebpush import webpush, WebPushException
from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

DEFAULT_PREFS = {"master": True, "important": True, "reminders": True, "digest": True}


def _prefs_for(client, user_id: str) -> dict:
    try:
        res = client.table("profiles").select("notification_prefs").eq("id", user_id).execute()
        if res.data:
            return {**DEFAULT_PREFS, **(res.data[0].get("notification_prefs") or {})}
    except Exception as e:
        logger.warning(f"notification_prefs load failed for {user_id}: {e}")
    return dict(DEFAULT_PREFS)


def _send_one(sub: dict, payload: dict) -> None:
    """Send one push. Raises WebPushException on transport failure."""
    webpush(
        subscription_info={
            "endpoint": sub["endpoint"],
            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
        },
        data=json.dumps(payload),
        vapid_private_key=settings.VAPID_PRIVATE_KEY.replace("\\n", "\n"),
        vapid_claims={"sub": settings.VAPID_SUBJECT},
    )


def send_to_user(client, user_id: str, payload: dict, kind: str) -> int:
    """Push `payload` to all of the user's subscriptions if prefs allow. Returns count sent."""
    if not settings.VAPID_PRIVATE_KEY:
        return 0
    prefs = _prefs_for(client, user_id)
    if not prefs.get("master") or not prefs.get(kind):
        return 0
    try:
        subs = client.table("push_subscriptions").select("*").eq("user_id", user_id).execute().data or []
    except Exception as e:
        logger.warning(f"subscription load failed for {user_id}: {e}")
        return 0

    sent = 0
    for sub in subs:
        try:
            _send_one(sub, payload)
            sent += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                try:
                    client.table("push_subscriptions").delete().eq("endpoint", sub["endpoint"]).execute()
                except Exception:
                    pass
            else:
                logger.warning(f"push failed (endpoint kept): {e}")
        except Exception as e:
            logger.warning(f"push error: {e}")
    return sent
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python3 -m pytest tests/test_push_service.py -q`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/push.py backend/tests/test_push_service.py
git commit -m "Add push delivery service with pref gating and pruning"
```

---

## Task 4: Notifications endpoints

**Files:**
- Create: `backend/app/api/v1/endpoints/notifications.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_notifications_api.py`

**Interfaces:**
- Consumes: `get_current_user`, `supabase` from `app.core.security`.
- Produces: `GET /notifications/vapid-public-key` → `{"key": str}`; `POST /notifications/subscribe` (body = browser PushSubscription JSON) upserts by endpoint; `POST /notifications/unsubscribe` (body `{"endpoint": str}`) deletes.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_notifications_api.py
"""Notifications endpoints: vapid key + subscribe/unsubscribe payload shaping."""
import app.api.v1.endpoints.notifications as notif


def test_vapid_key_endpoint_returns_configured_key(monkeypatch):
    monkeypatch.setattr(notif.settings, "VAPID_PUBLIC_KEY", "PUBKEY123")
    assert notif.get_vapid_public_key(current_user={"user_id": "u1"}) == {"key": "PUBKEY123"}


def test_subscribe_shapes_row(monkeypatch):
    captured = {}
    class FakeTable:
        def upsert(self, data, **k):
            captured["row"] = data
            return self
        def execute(self):
            return type("R", (), {"data": [captured["row"]]})()
    monkeypatch.setattr(notif, "supabase", type("S", (), {"table": lambda self, n: FakeTable()})())
    body = {"endpoint": "https://push/x", "keys": {"p256dh": "AAA", "auth": "BBB"}}
    out = notif.subscribe(body, current_user={"user_id": "u1"})
    assert captured["row"]["user_id"] == "u1"
    assert captured["row"]["endpoint"] == "https://push/x"
    assert captured["row"]["p256dh"] == "AAA" and captured["row"]["auth"] == "BBB"
    assert out == {"status": "subscribed"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_notifications_api.py -q`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the endpoints**

```python
# backend/app/api/v1/endpoints/notifications.py
from fastapi import APIRouter, Depends, Body
from app.core.security import get_current_user, supabase
from app.core.config import settings

router = APIRouter()


@router.get("/notifications/vapid-public-key")
def get_vapid_public_key(current_user: dict = Depends(get_current_user)):
    return {"key": settings.VAPID_PUBLIC_KEY}


@router.post("/notifications/subscribe")
def subscribe(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    keys = payload.get("keys") or {}
    row = {
        "user_id": current_user["user_id"],
        "endpoint": payload.get("endpoint"),
        "p256dh": keys.get("p256dh"),
        "auth": keys.get("auth"),
    }
    supabase.table("push_subscriptions").upsert(row, on_conflict="endpoint").execute()
    return {"status": "subscribed"}


@router.post("/notifications/unsubscribe")
def unsubscribe(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    endpoint = payload.get("endpoint")
    if endpoint:
        supabase.table("push_subscriptions").delete().eq("endpoint", endpoint).execute()
    return {"status": "unsubscribed"}
```

- [ ] **Step 4: Register the router in `backend/app/main.py`**

Add import after the interests import (line 12):
```python
from app.api.v1.endpoints.notifications import router as notifications_router
```
Add include after the interests include (line 37):
```python
app.include_router(notifications_router, prefix="/api/v1")
```

- [ ] **Step 5: Run tests + confirm route registered**

Run: `cd backend && python3 -m pytest tests/test_notifications_api.py -q`
Expected: 2 passed.
Run: `python3 -c "from app.main import app; print([r.path for r in app.routes if 'notifications' in r.path])"`
Expected: lists the 3 notification paths.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/endpoints/notifications.py backend/app/main.py backend/tests/test_notifications_api.py
git commit -m "Add notifications subscribe/unsubscribe/vapid endpoints"
```

---

## Task 5: Carry notification_prefs through the profile API

**Files:**
- Modify: `backend/app/schemas/profile.py`, `backend/app/api/v1/endpoints/profile.py`
- Test: `backend/tests/test_profile_notification_prefs.py`

**Interfaces:**
- Consumes: existing `POST /profile` upsert.
- Produces: `ProfileUpdate.notification_prefs: Optional[dict]`; `ProfileResponse.notification_prefs: dict`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_profile_notification_prefs.py
from app.schemas.profile import ProfileUpdate, ProfileResponse


def test_update_accepts_notification_prefs():
    u = ProfileUpdate(notification_prefs={"master": True, "digest": False})
    assert u.notification_prefs == {"master": True, "digest": False}


def test_response_defaults_prefs():
    r = ProfileResponse(user_name="X", interests="", roll_number="", primary_department="")
    assert r.notification_prefs == {"master": True, "important": True, "reminders": True, "digest": True}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_profile_notification_prefs.py -q`
Expected: FAIL (unexpected/!missing field).

- [ ] **Step 3: Extend the schemas**

In `backend/app/schemas/profile.py`, add to `ProfileUpdate`:
```python
    notification_prefs: Optional[dict] = None
```
Add to `ProfileResponse` (after `interest_slugs`):
```python
    notification_prefs: dict = Field(
        default_factory=lambda: {"master": True, "important": True, "reminders": True, "digest": True}
    )
```

- [ ] **Step 4: Return prefs from the profile endpoint**

In `backend/app/api/v1/endpoints/profile.py`, the GET default-profile branch, the GET real-profile return, and the POST return each construct `ProfileResponse(...)`. Add to **all three** constructors:
```python
        notification_prefs=profile_data.get("notification_prefs") or {"master": True, "important": True, "reminders": True, "digest": True},
```
(For the default-profile branch where there is no `profile_data`, pass the literal dict.)

- [ ] **Step 5: Run tests (new + full suite)**

Run: `cd backend && python3 -m pytest tests/test_profile_notification_prefs.py -q && python3 -m pytest -q`
Expected: new file 2 passed; full suite green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/profile.py backend/app/api/v1/endpoints/profile.py backend/tests/test_profile_notification_prefs.py
git commit -m "Carry notification_prefs through profile API"
```

---

## Task 6: Important-event trigger in sync

**Files:**
- Modify: `backend/app/tasks/sync_task.py`
- Test: `backend/tests/test_sync_important_notify.py`

**Interfaces:**
- Consumes: `send_to_user` (Task 3); `calculate_priority`, `IMPORTANT_THRESHOLD` from `app.api.v1.endpoints.events`.
- Produces: helper `maybe_notify_important(client, user_id, event_row, interest_slugs) -> bool` in `sync_task` — pushes and stamps `notified_at` when priority ≥ threshold and not already notified; returns whether it pushed.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_sync_important_notify.py
from types import SimpleNamespace
import app.tasks.sync_task as st


class Recorder:
    def __init__(self): self.updated = []
    def table(self, name): self.name = name; return self
    def update(self, data): self.updated.append(data); return self
    def eq(self, *a, **k): return self
    def execute(self): return SimpleNamespace(data=[{}])


def test_important_event_notifies_and_stamps(monkeypatch):
    sent = []
    monkeypatch.setattr(st, "send_to_user", lambda c, uid, payload, kind: sent.append((uid, kind, payload)))
    rec = Recorder()
    row = {"id": 7, "user_id": "u1", "display_name": "Fee due", "raw_summary": "pay now",
           "importance_score": 90, "interest_tags": [], "notified_at": None}
    pushed = st.maybe_notify_important(rec, "u1", row, [])
    assert pushed is True
    assert sent and sent[0][1] == "important"
    assert rec.updated and "notified_at" in rec.updated[0]


def test_low_priority_event_does_not_notify(monkeypatch):
    sent = []
    monkeypatch.setattr(st, "send_to_user", lambda c, uid, payload, kind: sent.append(uid))
    rec = Recorder()
    row = {"id": 8, "user_id": "u1", "display_name": "Movie", "raw_summary": "fun",
           "importance_score": 10, "interest_tags": [], "notified_at": None}
    assert st.maybe_notify_important(rec, "u1", row, []) is False
    assert sent == []


def test_already_notified_event_skips(monkeypatch):
    sent = []
    monkeypatch.setattr(st, "send_to_user", lambda c, uid, payload, kind: sent.append(uid))
    rec = Recorder()
    row = {"id": 9, "user_id": "u1", "display_name": "Fee", "raw_summary": "x",
           "importance_score": 90, "interest_tags": [], "notified_at": "2026-06-30T00:00:00Z"}
    assert st.maybe_notify_important(rec, "u1", row, []) is False
    assert sent == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_sync_important_notify.py -q`
Expected: FAIL (`maybe_notify_important` undefined).

- [ ] **Step 3: Implement the helper + imports**

At the top of `backend/app/tasks/sync_task.py`, add imports:
```python
from datetime import timezone
from app.services.push import send_to_user
from app.api.v1.endpoints.events import calculate_priority, IMPORTANT_THRESHOLD
```
Add the helper (module level):
```python
def maybe_notify_important(client, user_id, event_row, interest_slugs) -> bool:
    """Push a notification for a newly-ingested important event, once. Returns whether it pushed."""
    if event_row.get("notified_at"):
        return False
    priority = calculate_priority(event_row, interest_slugs)
    if priority < IMPORTANT_THRESHOLD:
        return False
    payload = {
        "title": event_row.get("display_name") or "New important mail",
        "body": (event_row.get("raw_summary") or "")[:140],
        "url": f"/?event={event_row.get('id')}",
    }
    try:
        send_to_user(client, user_id, payload, "important")
        client.table("events").update(
            {"notified_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", event_row["id"]).execute()
    except Exception:
        return False
    return True
```

- [ ] **Step 4: Wire into the insert path**

In `run_email_sync`, load the user's interest slugs once (next to the catalog fetch, ~line 56):
```python
        try:
            prof = supabase_service.table("profiles").select("interest_slugs").eq("id", user_id).execute()
            user_interest_slugs = (prof.data[0].get("interest_slugs") or []) if prof.data else []
        except Exception:
            user_interest_slugs = []
```
After a successful insert (where `event_id = event_response.data[0]["id"]`), add:
```python
                        notify_row = {**event_data, "id": event_id, "notified_at": None}
                        maybe_notify_important(supabase_service, user_id, notify_row, user_interest_slugs)
```

- [ ] **Step 5: Run tests (new + full suite)**

Run: `cd backend && python3 -m pytest tests/test_sync_important_notify.py -q && python3 -m pytest -q`
Expected: new 3 passed; full suite green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/tasks/sync_task.py backend/tests/test_sync_important_notify.py
git commit -m "Notify on newly-ingested important events during sync"
```

---

## Task 7: Deadline reminder Beat task

**Files:**
- Create: `backend/app/tasks/notify_task.py`
- Test: `backend/tests/test_notify_reminders.py`

**Interfaces:**
- Consumes: `send_to_user` (Task 3); `supabase_service` from `app.core.security`.
- Produces: `send_due_reminders() -> dict` — for events with `deadline` within the next 24h and `deadline_reminded = false`, push `kind="reminders"` and set the flag. Bound via `@celery_app.task`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_notify_reminders.py
from types import SimpleNamespace
from datetime import datetime, timezone, timedelta
import app.tasks.notify_task as nt


class FakeQuery:
    def __init__(self, rows, store): self._rows, self.store, self._upd = list(rows), store, None
    def select(self, *a, **k): return self
    def eq(self, c, v): self._rows = [r for r in self._rows if r.get(c) == v]; return self
    def update(self, data): self._upd = data; return self
    def execute(self): return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, rows): self.rows = rows
    def table(self, name): return FakeQuery(self.rows, self)


def _ev(id, hours, reminded):
    dl = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    return {"id": id, "user_id": "u1", "display_name": "X", "deadline": dl,
            "deadline_reminded": reminded}


def test_reminds_events_within_24h(monkeypatch):
    sent = []
    monkeypatch.setattr(nt, "send_to_user", lambda c, uid, p, kind: sent.append((id(c), kind)))
    rows = [_ev(1, 10, False), _ev(2, 40, False), _ev(3, 5, True)]
    monkeypatch.setattr(nt, "supabase_service", FakeSupabase(rows))
    out = nt.send_due_reminders()
    assert out["reminded"] == 1  # only event 1 (within 24h, not yet reminded)
    assert sent and sent[0][1] == "reminders"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_notify_reminders.py -q`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the task**

```python
# backend/app/tasks/notify_task.py
"""Scheduled notification tasks: 24h deadline reminders and the weekly digest."""
import logging
from datetime import datetime, timezone, timedelta
from app.core.celery_app import celery_app
from app.core.security import supabase_service
from app.services.push import send_to_user

logger = logging.getLogger("uvicorn.error")


def _parse_deadline(value: str):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


@celery_app.task
def send_due_reminders() -> dict:
    """Push a one-time reminder for events whose deadline is within the next 24h."""
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=24)
    try:
        rows = supabase_service.table("events").select(
            "id,user_id,display_name,deadline,deadline_reminded"
        ).eq("deadline_reminded", False).execute().data or []
    except Exception as e:
        logger.error(f"reminder query failed: {e}")
        return {"reminded": 0}

    reminded = 0
    for ev in rows:
        dl = _parse_deadline(ev.get("deadline") or "")
        if not dl:
            continue
        if dl.tzinfo is None:
            dl = dl.replace(tzinfo=timezone.utc)
        if not (now <= dl <= horizon):
            continue
        payload = {"title": "Deadline tomorrow", "body": ev.get("display_name") or "",
                   "url": f"/?event={ev['id']}"}
        try:
            send_to_user(supabase_service, ev["user_id"], payload, "reminders")
            supabase_service.table("events").update(
                {"deadline_reminded": True}).eq("id", ev["id"]).execute()
            reminded += 1
        except Exception as e:
            logger.warning(f"reminder send failed for event {ev['id']}: {e}")
    logger.info(f"Deadline reminders sent: {reminded}")
    return {"reminded": reminded}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python3 -m pytest tests/test_notify_reminders.py -q`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tasks/notify_task.py backend/tests/test_notify_reminders.py
git commit -m "Add 24h deadline reminder task"
```

---

## Task 8: Weekly digest Beat task + schedule wiring

**Files:**
- Modify: `backend/app/tasks/notify_task.py`, `backend/app/core/celery_app.py`
- Test: `backend/tests/test_notify_digest.py`

**Interfaces:**
- Consumes: `send_to_user`; `supabase_service`.
- Produces: `send_weekly_digest() -> dict` — one push per user summarizing the week's important events + upcoming deadlines. Beat entries `deadline-reminders-hourly` and `weekly-digest-sun-1830-ist`; Celery timezone set to `Asia/Kolkata`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_notify_digest.py
from types import SimpleNamespace
import app.tasks.notify_task as nt


class FakeQuery:
    def __init__(self, rows): self._rows = list(rows)
    def select(self, *a, **k): return self
    def eq(self, c, v): self._rows = [r for r in self._rows if r.get(c) == v]; return self
    def not_(self): return self
    def execute(self): return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, tables): self.tables = tables
    def table(self, name): return FakeQuery(self.tables.get(name, []))


def test_digest_sends_one_push_per_user(monkeypatch):
    sent = []
    monkeypatch.setattr(nt, "send_to_user", lambda c, uid, p, kind: sent.append((uid, kind)))
    tables = {
        "push_subscriptions": [{"user_id": "u1"}, {"user_id": "u2"}, {"user_id": "u1"}],
        "events": [],
    }
    monkeypatch.setattr(nt, "supabase_service", FakeSupabase(tables))
    out = nt.send_weekly_digest()
    assert out["users"] == 2
    assert {u for u, k in sent} == {"u1", "u2"}
    assert all(k == "digest" for _, k in sent)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_notify_digest.py -q`
Expected: FAIL (`send_weekly_digest` undefined).

- [ ] **Step 3: Implement the digest task**

Append to `backend/app/tasks/notify_task.py`:
```python
@celery_app.task
def send_weekly_digest() -> dict:
    """One weekly catch-up push per subscribed user."""
    try:
        subs = supabase_service.table("push_subscriptions").select("user_id").execute().data or []
    except Exception as e:
        logger.error(f"digest subscriber query failed: {e}")
        return {"users": 0}

    user_ids = {s["user_id"] for s in subs if s.get("user_id")}
    for uid in user_ids:
        payload = {"title": "Your week in KRNL",
                   "body": "Catch up on this week's important mail and deadlines.",
                   "url": "/"}
        try:
            send_to_user(supabase_service, uid, payload, "digest")
        except Exception as e:
            logger.warning(f"digest send failed for {uid}: {e}")
    logger.info(f"Weekly digest sent to {len(user_ids)} user(s).")
    return {"users": len(user_ids)}
```

- [ ] **Step 4: Wire Beat schedule + timezone + task discovery**

In `backend/app/core/celery_app.py`: add `'app.tasks.notify_task'` to the `include=[...]` list. Change `timezone='UTC'` to `timezone='Asia/Kolkata'` and `enable_utc=True` to `enable_utc=False`. Add to `beat_schedule`:
```python
    'deadline-reminders-hourly': {
        'task': 'app.tasks.notify_task.send_due_reminders',
        'schedule': 3600.0,
    },
    'weekly-digest-sun-1800-ist': {
        'task': 'app.tasks.notify_task.send_weekly_digest',
        'schedule': crontab(hour=18, minute=0, day_of_week=0),
    },
```
Add the crontab import at the top: `from celery.schedules import crontab`.

- [ ] **Step 5: Run tests (new + full suite) + import-check celery app**

Run: `cd backend && python3 -m pytest tests/test_notify_digest.py -q && python3 -m pytest -q`
Expected: new 1 passed; full suite green.
Run: `python3 -c "from app.core.celery_app import celery_app; print(sorted(celery_app.conf.beat_schedule))"`
Expected: lists the deletion, auto-sync, reminders, and digest entries.

- [ ] **Step 6: Commit**

```bash
git add backend/app/tasks/notify_task.py backend/app/core/celery_app.py backend/tests/test_notify_digest.py
git commit -m "Add weekly digest task and Beat schedule (IST)"
```

---

## Task 9: Service worker push handlers

**Files:**
- Modify: `frontend/public/sw.js`

**Interfaces:**
- Consumes: push messages with JSON `{title, body, url}`.
- Produces: notification render + click-to-open behavior. Bump `CACHE_NAME` to force SW update.

- [ ] **Step 1: Add handlers and bump the cache name**

In `frontend/public/sw.js`, change `const CACHE_NAME = "krnl-cache-v2";` to `"krnl-cache-v3";`. Append at the end of the file:
```javascript
// Web Push: render the notification.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "KRNL", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "KRNL";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      data: { url: data.url || "/" },
    })
  );
});

// Focus an existing tab or open a new one at the notification's url.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Verify the build copies sw.js**

Run: `cd frontend && npm run build && grep -c "notificationclick" dist/sw.js`
Expected: build succeeds; `grep` prints `1`.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/sw.js
git commit -m "Service worker: render pushes and route notification clicks"
```

---

## Task 10: Frontend push subscribe utility

**Files:**
- Create: `frontend/src/app/utils/push.ts`

**Interfaces:**
- Consumes: `apiFetch` from `./api`; `navigator.serviceWorker`.
- Produces: `enablePush(): Promise<boolean>` (true on successful subscribe), `disablePush(): Promise<void>`, `isPushSupported(): boolean`.

- [ ] **Step 1: Write the utility**

```typescript
// frontend/src/app/utils/push.ts
import { apiFetch } from "./api";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  const keyRes = await apiFetch("/api/v1/notifications/vapid-public-key");
  if (!keyRes.ok) return false;
  const { key } = await keyRes.json();
  if (!key) return false;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });

  const res = await apiFetch("/api/v1/notifications/subscribe", {
    method: "POST",
    body: JSON.stringify(sub.toJSON()),
  });
  return res.ok;
}

export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await apiFetch("/api/v1/notifications/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}
```

- [ ] **Step 2: Verify it type-checks via build**

Run: `cd frontend && npm run build`
Expected: build succeeds (util compiles even though not yet imported — confirm no TS error after Task 11 wires it).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/utils/push.ts
git commit -m "Add frontend push subscribe/unsubscribe utility"
```

---

## Task 11: Settings notification toggles

**Files:**
- Modify: `frontend/src/app/components/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `enablePush`, `disablePush`, `isPushSupported` (Task 10); the existing `apiFetch("/api/v1/profile")` load + save already present in SettingsScreen; `notification_prefs` from the profile response (Task 5).
- Produces: a Notifications section — master toggle (drives enable/disablePush + permission) and 3 type toggles (important / reminders / digest) persisted to `notification_prefs`.

- [ ] **Step 1: Add state + handlers**

In `SettingsScreen.tsx`, near the other `useState`s, add:
```typescript
  const [notifPrefs, setNotifPrefs] = useState<{ master: boolean; important: boolean; reminders: boolean; digest: boolean }>(
    { master: false, important: true, reminders: true, digest: true }
  );
```
In the existing profile-load effect (where `prof.interest_slugs` is read), also set:
```typescript
        if (prof.notification_prefs) setNotifPrefs((p) => ({ ...p, ...prof.notification_prefs }));
```
Add handlers:
```typescript
  const saveNotifPrefs = async (next: typeof notifPrefs) => {
    setNotifPrefs(next);
    try {
      await apiFetch("/api/v1/profile", {
        method: "POST",
        body: JSON.stringify({ notification_prefs: next }),
      });
    } catch (err) {
      console.error("Error saving notification prefs:", err);
    }
  };

  const toggleMaster = async () => {
    if (!notifPrefs.master) {
      const { enablePush } = await import("../utils/push");
      const ok = await enablePush();
      if (!ok) return; // permission denied / unsupported — leave master off
      await saveNotifPrefs({ ...notifPrefs, master: true });
    } else {
      const { disablePush } = await import("../utils/push");
      await disablePush();
      await saveNotifPrefs({ ...notifPrefs, master: false });
    }
  };

  const toggleType = (key: "important" | "reminders" | "digest") =>
    saveNotifPrefs({ ...notifPrefs, [key]: !notifPrefs[key] });
```

- [ ] **Step 2: Add the Notifications section UI**

Add a new section in the Settings render (mirror an existing settings card/row block already in the file). The master row calls `toggleMaster`; the three type rows call `toggleType("important"|"reminders"|"digest")` and are visually disabled when `!notifPrefs.master`. Use the same row/label/switch markup already used elsewhere in `SettingsScreen.tsx` so styling matches. Example structure:
```tsx
{isPushSupported() && (
  <div /* same card wrapper styling as neighboring sections */>
    <span /* section title styling */>Notifications</span>
    <button onClick={toggleMaster}>{notifPrefs.master ? "On" : "Off"}</button>
    {notifPrefs.master && (
      <>
        <button onClick={() => toggleType("important")}>Important mail: {notifPrefs.important ? "On" : "Off"}</button>
        <button onClick={() => toggleType("reminders")}>Deadline reminders: {notifPrefs.reminders ? "On" : "Off"}</button>
        <button onClick={() => toggleType("digest")}>Weekly digest: {notifPrefs.digest ? "On" : "Off"}</button>
      </>
    )}
  </div>
)}
```
Replace the placeholder markup with the file's existing toggle-row component/styles so it visually matches; add `import { isPushSupported } from "../utils/push";` at the top.

- [ ] **Step 3: Verify the build**

Run: `cd frontend && npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Manual smoke (optional, needs HTTPS tunnel + device)**

Over the cloudflared tunnel on the installed PWA: open Settings → toggle Notifications on → accept the browser prompt → confirm a row appears in `push_subscriptions`. Trigger a sync with an important email → confirm a push arrives.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/components/SettingsScreen.tsx
git commit -m "Add notification toggles to Settings"
```

---

## Self-Review

**Spec coverage:**
- push_subscriptions / events flags / notification_prefs migration → Task 1. ✓
- VAPID keys + env → Task 2. ✓
- `send_to_user` with pref gating + 404/410 pruning → Task 3. ✓
- subscribe/unsubscribe/vapid-public-key endpoints → Task 4. ✓
- toggles via profile POST → Task 5. ✓
- Important-event trigger (≥60, notified_at dedup) → Task 6. ✓
- 24h deadline reminder (deadline_reminded dedup) → Task 7. ✓
- Weekly digest Sunday 18:00 IST + Beat/timezone → Task 8. ✓
- Service worker push + notificationclick → Task 9. ✓
- Frontend subscribe util + Settings opt-in toggles → Tasks 10–11. ✓
- Error handling (dead subs, denied permission, missing VAPID) → Tasks 3, 10, 11. ✓

**Placeholder scan:** Task 11 Step 2 intentionally defers pixel-level markup to the file's existing toggle component (styling parity), but specifies exact handlers, state, and structure — no logic placeholders. All backend code is complete.

**Type consistency:** `send_to_user(client, user_id, payload, kind)` signature consistent across Tasks 3, 6, 7, 8. `notification_prefs` shape `{master, important, reminders, digest}` consistent across Tasks 1, 3, 5, 11. `maybe_notify_important(client, user_id, event_row, interest_slugs)` consistent in Task 6.

**Manual dependencies the executor must not skip:** apply Task 1 migration in Supabase; run Task 2 key generator and populate `.env`; restart API + worker after backend changes. Real-device push verification requires the HTTPS tunnel (pairs with deployment).
