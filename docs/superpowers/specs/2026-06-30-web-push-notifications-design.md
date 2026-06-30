# Web Push notifications — design (2026-06-30)

## Problem / goal

KRNL surfaces important mail and deadlines in-app, but a student only benefits if they open
the app. Web Push lets KRNL proactively notify (installed PWA) about the things that carry
consequences — new important mail, an imminent deadline, and a weekly catch-up — reusing the
existing priority model so the notification bar matches the Important tab.

Foundation already exists: PWA manifest + a hand-written service worker
(`frontend/public/sw.js`) registered in `frontend/src/main.tsx`. No push code yet.

## Decisions (locked in brainstorm)

- **Triggers (3):** (1) new important event on sync, (2) deadline reminder **24h before** (single
  lead), (3) **weekly digest, Sunday 18:00 IST**.
- **"Important" basis:** reuse `calculate_priority()` ≥ `IMPORTANT_THRESHOLD` (60) — the
  boost-only + consequence-floor version. No separate notification scoring.
- **Permission UX:** requested **only** when the user enables the Settings notifications toggle
  (explicit opt-in). No auto-prompt.
- **Toggles:** master + 3 per-type (important / reminders / digest), stored in
  `profiles.notification_prefs` jsonb.
- **Dedup:** `events.notified_at` timestamp for important pushes; `events.deadline_reminded`
  boolean for the 24h reminder. Digest needs no dedup (scheduled).

## Data model (one migration)

```sql
create table if not exists push_subscriptions (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table events add column if not exists notified_at timestamptz;
alter table events add column if not exists deadline_reminded boolean not null default false;

alter table profiles add column if not exists notification_prefs jsonb
    default '{"master": true, "important": true, "reminders": true, "digest": true}'::jsonb;
```

`endpoint unique` so re-subscribing the same browser upserts rather than duplicating. One row
per device/browser; a user may have several.

## Components / boundaries

The three triggers share one delivery primitive, keeping trigger logic separate from transport.

- **`app/services/push.py`**
  - `send_to_user(user_id, payload, kind) -> int` — loads the user's `notification_prefs`;
    returns 0 immediately if `master` is off or the per-`kind` toggle is off. Otherwise loads
    `push_subscriptions`, sends each via `pywebpush`, and **deletes any subscription** that
    returns 404/410 (gone). Returns count sent.
  - `_send_one(sub, payload)` — single `pywebpush` call with the VAPID private key; raises on
    transport error so `send_to_user` can prune. Mockable in isolation for tests.
  - `payload` is a small dict `{title, body, url}` serialized to JSON.
- **`app/api/v1/endpoints/notifications.py`**
  - `GET /notifications/vapid-public-key` → `{ "key": <urlsafe base64 public key> }`. Served
    from backend so the frontend needs no rebuild to learn the key.
  - `POST /notifications/subscribe` → body = the browser `PushSubscription` JSON; upsert into
    `push_subscriptions` by `endpoint`.
  - `POST /notifications/unsubscribe` → body = `{endpoint}`; delete that row.
  - Toggle changes ride the **existing** `POST /profile` alongside `interest_slugs` (extend it to
    accept `notification_prefs`); no new toggle endpoint.
- **VAPID keys** — generated once (script or one-off), stored as `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (a `mailto:`) in backend settings/env.

## Triggers

1. **Important event (in `app/tasks/sync_task.py`)** — after a new event row is stored, compute
   `calculate_priority(row, user_interest_slugs)`. If `>= IMPORTANT_THRESHOLD`, `notified_at IS
   NULL`, fire `send_to_user(user_id, {title: display_name, body: raw_summary, url:
   "/?event=<id>"}, kind="important")`, then set `notified_at = now()`. Updates/dedup-skips don't
   notify. The sync task already loads the catalog; it additionally reads the user's
   `interest_slugs` once per run.
2. **Deadline reminder (new Beat task, hourly)** — `send_due_reminders()`: select events with
   `deadline` between now and now+24h, `deadline_reminded = false`; for each, `send_to_user(...,
   kind="reminders")` then set `deadline_reminded = true`. Hourly cadence means a reminder fires
   within an hour of crossing the 24h-out mark — acceptable for a day-ahead nudge.
3. **Weekly digest (new Beat task, Sunday 18:00 IST)** — `send_weekly_digest()`: for each user
   with the `digest` toggle on, summarize the week's important events + upcoming deadlines into one
   push (`kind="digest"`). Beat schedule expressed in the worker's timezone (set Celery timezone to
   `Asia/Kolkata`, or compute the UTC equivalent 12:30 UTC).

Beat schedule entries live alongside the existing auto-sync in `app/core/celery_app.py`.

## Frontend

- **`utils/push.ts`**
  - `enablePush()` — `Notification.requestPermission()`; if granted, fetch the VAPID public key,
    `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, POST the
    subscription to `/notifications/subscribe`.
  - `disablePush()` — unsubscribe locally + POST `/notifications/unsubscribe`.
- **Settings** — a master "Notifications" toggle that drives enable/disablePush, plus 3 type
  toggles persisted to `notification_prefs` via the profile POST. Type toggles are disabled/hidden
  until the master is on.
- **`frontend/public/sw.js`** — add:
  - `push` listener → `self.registration.showNotification(title, { body, data: { url } })`.
  - `notificationclick` listener → focus an existing client or `clients.openWindow(url)`.

## Error handling

- Dead subscriptions (404/410) are pruned in `send_to_user`; other transport errors are logged and
  skipped (one bad sub never blocks the rest).
- Permission denied / unsupported browser → `enablePush()` returns false; Settings shows the master
  toggle off and a short "not available / blocked" note. iOS requires an installed PWA on 16.4+.
- Missing VAPID env → endpoints/services log and no-op rather than 500.

## Testing

- `send_to_user`: master-off and type-off short-circuit (no transport calls); a 410 from one sub
  deletes that row and still sends the rest; payload shape correct. `pywebpush` mocked.
- Important trigger: pushes only when priority ≥ 60 **and** `notified_at IS NULL`; stamps
  `notified_at`; a re-run does not re-push.
- Reminder trigger: selects only events in the 24h window with `deadline_reminded = false`; sets the
  flag; outside-window/already-reminded events are skipped.
- Digest: selects the right events per user; respects the `digest` toggle.
- Existing backend suite stays green.

## YAGNI deferrals

No quiet hours, no per-user custom lead times, no multiple reminder leads, no notification action
buttons/rich media, no daily digest, no in-app notification center/history. All additive later.

## Out of scope

- Deployment (separate; gives the stable HTTPS URL that ends tunnel churn and is required for
  real-device push testing).
- Unifying `IMPORTANT_THRESHOLD` backend/frontend (tracked in PRODUCTION_CLEANUP).
