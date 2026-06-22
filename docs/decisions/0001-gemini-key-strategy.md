# ADR 0001 — Gemini API key strategy (shared vs. bring-your-own-key)

- **Status:** Proposed (recommended)
- **Date:** 2026-06-23
- **Deciders:** project owner
- **Related:** [sync-flow.md](../sync-flow.md) §6, [sync-performance.md](../sync-performance.md)

## Context

All AI calls (extraction + embeddings + Ask KRNL) currently flow through **one shared
Gemini free-tier key** (`settings.GEMINI_API_KEY`). Because the key's rate limit (RPM/RPD)
is shared by every user, the whole sync pipeline is forced to serialize: `worker_concurrency=1`
plus a `sleep(13)` between emails act as one global pacer. That throttle is ~73% of sync
time and caps capacity at roughly ~45 users / 3-hour window.

The question: should each user supply **their own** Gemini key so their processing runs on
their own quota?

## Options

### A. Shared key (status quo)
One key for everyone; global throttle.
- ➕ Zero onboarding friction; central control of quota/cost.
- ➖ Hard scaling ceiling; one heavy user starves others; you pay all Gemini cost.

### B. Mandatory bring-your-own-key (BYOK)
Every user must paste their own Gemini key before sync works.
- ➕ Per-user quota isolation → no cross-user 429s; concurrency bounded by infra, not the key;
  you pay ~no Gemini cost.
- ➖ **Hard onboarding wall** (Google AI Studio → make key → paste) — likely kills adoption for
  a casual student PWA. One more high-value secret to store per user.

### C. Hybrid — optional BYOK + shared fallback  ✅ recommended
Default users run on the shared throttled pool; users who add their own key get isolated
quota, run concurrently, and bypass the shared throttle.
- ➕ Keeps frictionless onboarding **and** removes the ceiling for power users / your own
  testing; migration-friendly (existing users simply stay on the shared pool — no backfill);
  natural fairness/monetization lever later.
- ➖ Two code paths to maintain (shared bucket vs. per-key bucket).

## Decision

Adopt **Option C (hybrid)** as the scaling path. For the **initial launch, ship on the
shared key (A)** — but **build the seams now** (see below) so enabling BYOK later is a
feature-flag flip, not a core refactor.

Rationale: BYOK does **not** speed up a single user's sync (their own free key still has
~10–15 RPM, so ~3 min for 15 emails) — it removes *cross-user contention*. That's a scaling
win, not a latency win, so it's correct to defer the user-facing feature until scale demands
it, while paying the small upfront cost to keep the door open.

## Consequences / what it takes to build

| Piece | Effort | Notes |
|---|---|---|
| `encrypted_gemini_key` column (nullable) | small | Reuse existing `encrypt_token`/`decrypt_token` (same as IMAP password) |
| Settings UI: optional key + validation | small | One cheap validation call on save; clear "invalid / quota exhausted" message |
| **De-globalize the Gemini client** | **medium (the real work)** | `genai_client` is a module singleton today; BYOK needs a client built **per task** from the user's key, threaded through `extract_event_intelligence`, `generate_embeddings_batch`, `find_matching_event`, `confirm_same_event`, and the `query`/`retrieval` (Ask KRNL) path |
| Throttle → per-key | small–medium | Global gate becomes a token bucket **keyed by user/key**; shared-key users share one bucket, BYOK users each get their own |
| Error isolation | small | A bad/expired key fails only that user's sync |

## ⚠️ Retrofitting AFTER deployment / when scaling — flagged costs

The cheap parts stay cheap later; the expensive part gets **riskier**, not bigger. What
hurts if you add BYOK *after* launch:

1. **De-globalizing the client touches production-critical paths.** The client singleton is
   used by sync **and** Ask KRNL. Refactoring it in a live system risks regressing both at
   once. → **Mitigation now (cheap):** thread a `gemini_client` (or `api_key`) argument
   through the AI call chain *today*, defaulting to the shared client. Then BYOK is "pass a
   different client," not "rewrite the call path." This single seam is the difference between
   a 1-day change and a risky multi-day refactor later.

2. **The throttle must become per-key, and that's a hot path.** If you've already raised
   `worker_concurrency` in production behind a global rate-gate (required for >1 anyway —
   see [sync-flow.md](../sync-flow.md) §6), switching to per-key buckets changes a
   load-bearing component. → **Mitigation now:** key the rate-gate by an identifier from day
   one (default `"shared"`); BYOK just supplies a different key for the bucket.

3. **Horizontal scaling forces a shared limiter regardless of BYOK.** The per-task
   `sleep(13)` does **not** coordinate across worker *nodes*. The moment you scale to >1
   worker process or >1 machine, you need a **Redis-based global rate limiter** anyway. BYOK
   then layers cleanly on top as per-key buckets. → Build the Redis token-bucket *before*
   scaling; BYOK reuses it.

4. **Migration is the easy part.** Adding a nullable `encrypted_gemini_key` to a live DB is
   backward-compatible; existing users keep working on the shared pool with **no backfill**.
   Hybrid was chosen partly for this.

5. **New operational surface at scale:** per-key usage/error monitoring (a wave of users with
   exhausted free keys = many failures), secret rotation for the new credential, and loss of
   central quota visibility. Cheaper to instrument before you have thousands of keys than to
   bolt on reactively.

**Bottom line:** the column + UI can wait. The two **seams** — (a) a `gemini_client` argument
through the AI call chain, and (b) a keyed Redis rate-gate — should be put in **before/at
deployment even while staying on the shared key**, because they are what make BYOK (and
concurrency, and horizontal scale) a configuration change later instead of a risky retrofit.

## Status / next step

No code changes yet. If accepted, the first concrete step is the low-risk seam work
(client-argument threading + keyed rate-gate, both defaulting to "shared") — independent of
whether BYOK is ever exposed to users.
