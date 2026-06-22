# Sync performance — where the time goes

_Measured 2026-06-23, warm worker, single connected account._

## TL;DR

A sync spends **~73% of its time asleep on purpose.** The bottleneck is the
hard-coded `time.sleep(13)` between emails (the Gemini rate-limit throttle), **not**
your laptop, network bandwidth, or local compute. Your machine is idle the whole time.

So "faster sync" is a config/tuning question (throttle + region + tier), not a hardware one.

## Measured per-email cost (warm)

| Phase | Median | What it is |
|---|---:|---|
| Gemini extraction | 3.5s | 1 `generate_content` call (gemini-2.5-flash), structured JSON |
| Gemini embedding | 0.6s | 1 batched `embed_content` call (already batched per email) |
| Qdrant upsert/query | ~0.2s | vector store roundtrip (eu-west-1) — see "cold" note below |
| Supabase insert/select | ~0.4s | Postgres roundtrip |
| **`sleep(13)`** | **13.0s** | **artificial throttle, [sync_task.py](../backend/app/tasks/sync_task.py)** |
| **Per email total** | **~18s** | |

**Cold-start penalties (one-time, not per email):**
- Worker boot imports the ingestion chain → Qdrant `get_collections()` init: **5–19s** once.
- First Qdrant call after idle: **5–19s** (eu-west-1 is far from an India laptop). This is
  why we set `timeout=60` on the client. Warm calls are ~0.2s.
- IMAP fetch of the batch: ~2s once.

## The math

| Emails (new) | Time | Throttle share |
|---:|---:|---:|
| 1 | ~18s | 13s (72%) |
| 10 | **~180s (3 min)** | 130s (72%) |
| 15 | ~270s (4.5 min) | 195s |

If the `sleep` were removed entirely: 10 emails ≈ **~49s** (but risks Gemini 429s — see below).
If tuned to `sleep(4)`: 10 emails ≈ **~89s**.

## Why the throttle exists (don't just delete it)

One **shared Gemini free-tier key** serves all users. Each email = **2 model calls**
(1 extraction on `gemini-2.5-flash` + 1 embedding on `gemini-embedding-001` — separate
quotas). Free-tier limits are per-minute (RPM) and per-day (RPD). With many users syncing
at once, parallel calls blow the RPM and everything 429s. `worker_concurrency=1` + the sleep
serialize **all** AI calls into one global pace so that can't happen.

The `13` was picked conservatively. **It is the single biggest lever** and is almost
certainly tunable down — extraction and embedding hit *different* models with *different*
quotas, so the real ceiling is likely the extraction model's RPM alone, not both combined.

## Options to go faster (ranked by value / effort)

1. **Tune the sleep to the real RPM (biggest win, free, low effort).**
   Look up the *current* free-tier RPM for `gemini-2.5-flash`. If it's ~15 RPM, one
   extraction call needs ~4s spacing, so `sleep(4–6)` is safe → **10 emails in ~1.5 min
   instead of 3.** Make it a config value (e.g. `GEMINI_SYNC_DELAY_SECONDS`) instead of a
   magic number, so dev (1 user) can run fast and prod can stay conservative.

2. **Behaviour change: target = 10 NEW, not a cap of 10 fetched.** (See next section.)
   Doesn't speed per-email, but stops a sync from "wasting" its budget on already-synced
   mail — you get 10 useful results instead of "4 new, 3 skipped, done."

3. **Move Qdrant closer / warm it.** eu-west-1 from India gives 5–19s cold calls. A region
   nearer India (or a keep-alive ping) removes the worst spikes. Low priority (warm calls
   are fine), but it's the only *network* bottleneck.

4. **Raise concurrency once on a paid Gemini tier.** Paid = higher RPM → drop the sleep and
   set `worker_concurrency` > 1. Pure config change, no rewrite (the design anticipates this).

5. **Fewer model calls per email.** E.g. skip embedding for trivially short/non-event mail,
   or skip extraction for known-noise senders (login alerts). Cuts the 3.5s extraction on a
   fraction of emails.

**Not worth it:** a faster laptop, more RAM, threads — the CPU is idle during the sleep and
the network roundtrips are small. Hardware is not the constraint.

## The "target = 10 new" change

**Today** ([sync_task.py](../backend/app/tasks/sync_task.py)): fetch is capped first
(`messages = messages[:max_emails]`), *then* dedup skips already-synced ones inside the loop.
So `max_emails=10` can yield only 4 new (6 were dups) — the cap counts dups.

**Wanted:** keep going until **10 newly-ingested** emails, skipping (not counting) dups.

Sketch (one loop change, no new infra):
- Fetch a larger window (e.g. newest 40, or all in the `date_gte` window), newest-first.
- Loop; `continue` on dups (don't count them); increment a counter only on a real insert.
- `break` once the counter hits the target (default 10).
- Cap total *fetched/scanned* (e.g. 60) so a mailbox of all-dups can't loop forever.

Trade-off: a sync that finds few new emails will scan more messages (cheap — dup check is a
set lookup, no Gemini call), but every *processed* email still pays the ~18s. So "10 new"
worst case ≈ 10 × 18s regardless; best case (few new) returns fast.

## How to watch a real sync

With the worker running, tail its log during a sync:
```
tail -f /tmp/krnl-worker.log
```
You'll see `Processing email N/M` lines ~13s apart, `Skipping already-ingested …` for dups,
and `Email sync completed … Processed X, skipped Y`.
