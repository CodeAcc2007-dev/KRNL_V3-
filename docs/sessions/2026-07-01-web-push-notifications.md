# Session 2026-07-01 — Web Push notifications (brainstorm → spec → plan → subagent build) + Important-tab/interests fixes

Branch: **`redesign`**. Everything committed. Subagent-driven execution.

## Earlier in session — interests/Important-tab fixes (pre-notifications)

- **Empty interest picker** root-caused: backend uvicorn was started without `--reload`, so it never
  loaded the `/interests/catalog` route added the prior session → 404 → empty picker. Restarted with
  `--reload`. Catalog grown to **21 interests** (added AI/ML, Data Science, Product Management,
  Consulting, Management, Finance, Photography, Art & Design, Quant/Trading, Core Engineering).
- **Important tab empty / consequential mail buried** — boost-only priority rework
  (`max(importance, blend)`) + consequence floor (fee/payment/account signals → importance ≥75) +
  non-empty top-up (show ≥60, top up to 5 above floor 25). Read-time, works on existing mail.
  See [important-tab-consequential-mail spec](../superpowers/specs/2026-06-30-important-tab-consequential-mail-design.md).
- **`/events` payload trim** — list endpoints now omit `full_body`/`raw_body` (loaded lazily by the
  detail endpoint). EmailDetail renders venue/deadline/links instantly from preview data (no fetch wait).

## Shipped — Web Push notifications (commits 12c11ac..f6f2462)

Spec + plan in `docs/superpowers/` (`specs/2026-06-30-web-push-notifications-design.md`,
`plans/2026-06-30-web-push-notifications.md`). Subagent-driven: 11 tasks, fresh implementer + task
reviewer each, final whole-feature review (opus).

| Area | What |
|---|---|
| Migration | `push_subscriptions` table + `events.notified_at`/`deadline_reminded` + `profiles.notification_prefs` jsonb |
| Config | VAPID keypair (`gen_vapid_keys.py` → `.env`); `pywebpush` runtime dep; `Settings.VAPID_*` |
| Delivery | `app/services/push.py` `send_to_user(client,user_id,payload,kind)` — pref-gate (master + per-kind) → send via pywebpush → prune dead subs on 404/410 |
| Endpoints | `GET /notifications/vapid-public-key`, `POST /notifications/subscribe` (upsert by endpoint, 400 on missing), `POST /notifications/unsubscribe` |
| Prefs | `notification_prefs` carried through `POST /profile` (master + important/reminders/digest) |
| Trigger 1 | important event on sync — `maybe_notify_important`, priority ≥ `IMPORTANT_THRESHOLD` (60, reuses `calculate_priority`), dedup via `notified_at` |
| Trigger 2 | 24h deadline reminder — hourly Beat `send_due_reminders`, dedup via `deadline_reminded` |
| Trigger 3 | weekly digest — Beat Sun 18:00 IST `send_weekly_digest` (celery tz `Asia/Kolkata`, `enable_utc=False`) |
| Frontend | `sw.js` push + notificationclick handlers (CACHE v3); `utils/push.ts` enable/disablePush; Settings opt-in toggles |

**Design decisions (locked in brainstorm):** triggers = important-event + 24h reminder + weekly digest;
"important" reuses `calculate_priority ≥ 60`; permission via Settings opt-in only; master + 3 per-type
toggles; dedup via per-event flags.

**Final review (opus) — Ready/with-fixes; fixes applied (f6f2462):**
- **Critical:** deadline reminder window compared naive **IST** wall-clock deadlines against UTC (5.5h
  skew). Fixed: parse deadlines as IST, compute the 24h window in IST. Test rebuilt with naive-IST
  deadlines incl. a 20h boundary the old bug skipped.
- Reminder query now filters `deadline IS NOT NULL` (bounded hourly scan).
- `enablePush` drops a prior subscription before re-subscribing (avoids `InvalidStateError` on VAPID
  key rotation) and returns false on any failure.

**Tests:** 85 backend passing; frontend builds clean. No AI/model references.

## Verified live (2026-07-01)
Migration applied in dev Supabase. Redis (podman) + API (`--reload`) + worker (`-B`) restarted;
`/notifications/vapid-public-key` responds, both Beat tasks registered, schedule active.

## Resume checklist next session
1. Real-device push test over the HTTPS cloudflared tunnel on the installed Android PWA.
2. **Deploy** (Oracle Free VM or Hostinger VPS) — stable HTTPS URL ends tunnel churn; apply both
   migrations in the prod project; fresh VAPID keys; lock CORS / `DEBUG=False`; run worker with `-B`.
3. Optional cleanups (PRODUCTION_CLEANUP): Settings badge-style helper; unify the two Supabase clients.
