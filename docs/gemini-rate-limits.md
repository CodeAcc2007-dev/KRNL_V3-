# Gemini rate limits & real sync capacity

_Source: Google AI Studio dashboard, project "KRNL Production", observed 2026-06-23
(free tier, billing NOT enabled). These are the hard numbers everything else must respect._

## Actual limits

| Model | Used for | RPM | TPM | **RPD (per day)** |
|---|---|---:|---:|---:|
| **Gemini 2.5 Flash** | sync extraction · Ask KRNL answers · deadline-extension confirm | **5** | 250K | **20** |
| Gemini Embedding 1 | every embedding (sync chunks, queries, matching) | 100 | 30K | 1000 |

Observed peak over 1 day: **Flash `22 / 20` RPD → exceeded → `429 RESOURCE_EXHAUSTED`**.
Embedding peaked at `65 / 1000` — never close.

## The binding constraint: Flash = 20 calls/DAY

This is the single most important fact about the system on the free tier.

**Flash calls per operation:**
| Operation | Flash calls | Embedding calls |
|---|---:|---:|
| Sync a normal email | 1 (extract) | 1 |
| Sync a deadline-extension email | 2 (extract + confirm) | 2 |
| Ask KRNL query | 1 (answer) | 1 |

So **all of it draws from the same 20 Flash/day**: sync extractions + deadline confirms +
Ask KRNL answers, across **every user on the shared key**. Embedding (1000/day) is never the
limit.

**Implication:** on the free shared key you can process **~20 emails per day, total** — and
that's *before* any Ask KRNL usage, which eats the same budget. We blew through it with a
handful of test syncs (each = 10 emails = 10 Flash calls).

## The 13s throttle is for RPM, not the real wall

`sleep(13)` ≈ 4.6 calls/min, which keeps us under **Flash RPM = 5**. That's correct and
still needed. But it does **nothing** for the **daily** cap — 20 calls is 20 calls whether
spread over a minute or a day. **Tuning the sleep down does not buy more daily throughput.**
(This corrects the earlier framing in [sync-performance.md](sync-performance.md): the throttle
is the per-minute pacer; RPD=20 is the ceiling.)

## Capacity — corrected

The old DEVELOPMENT_PLAN estimate ("~45 users in a 3-hour window") assumed RPM was the
limit. With **RPD = 20**, the real free-tier ceiling is:

- **~20 email extractions per day, shared across all users and all Ask KRNL queries.**
- Not viable for more than light single-developer testing.

## Consequence already visible in the data

- **35 of 53 events** are stored as `category="General"` /
  `raw_summary="Failed to run AI feature extraction on this email."` — these are 429
  fallbacks, not real extractions.
- **Design flaw:** a failed (429) extraction is still **inserted with its `message_id`**, so
  the dedup treats it as "already synced" and **never retries it** — the garbage is permanent
  even after quota resets. (See fix #3 below.)

## Recommendations

1. **Enable billing (Tier 1).** The dashboard's own message ("Set up billing to increase your
   limits") is the fix — it raises Flash RPD by orders of magnitude (check the new numbers in
   the console after enabling). **Required for any real testing or production.** At this
   volume the actual token cost is tiny.
2. **BYOK ([ADR 0001](decisions/0001-gemini-key-strategy.md))** isolates quota *per user*, but
   each *free* key is still 20 RPD — it fixes multi-user fairness, **not** single-user
   throughput. Only billing raises the per-key ceiling.
3. **Quota-resilience (do regardless of tier):**
   - **Don't store failed (429) extractions** — skip the email so the next sync/day retries
     it. Makes "process all mail" actually true.
   - **Add 429 backoff/retry** around the Flash call.
   - **Be frugal:** skip extraction for obvious noise senders (login alerts, etc.) to conserve
     the daily budget.
   - **Re-extraction script** for the 35 already-failed rows (run when quota is available).
4. **Mind the split:** Ask KRNL answers draw from the same 20/day — heavy querying starves
   sync, and vice-versa. On the free tier, budget consciously.

## Reset timing

Free-tier daily quota resets at **midnight US-Pacific (~12:30 PM IST)**. Until then, every
Flash call 429s and extraction falls back to "General/Failed".
