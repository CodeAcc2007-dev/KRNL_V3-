# Important tab: consequential mail + never-eerily-empty — design (2026-06-30)

## Problem

Two coupled defects in the Important tab:

1. **Interests bury importance.** After a user selects interests, priority becomes
   `0.4·importance + 0.6·relevance`. An email that matches no interest has relevance 0,
   so its max possible priority is `0.4·100 = 40` — below the `IMPORTANT_THRESHOLD` of 60.
   Critical admin/academic mail (fees, payments, account issues) is therefore *suppressed*
   precisely because it isn't a selected interest. Existing emails were extracted before the
   interest catalog existed, so they carry no `interest_tags` at all → relevance 0 for every
   email → the Important tab reads "All caught up!" for everyone who has selected interests.

2. **Hard cutoff feels eerie.** A binary "≥60 or nothing" filter leaves the tab empty often
   enough that an empty state reads as broken / too-good-to-be-true and undermines trust in
   the selection feature.

## Goals

- Interests may only **promote** an email's priority, never demote it below its intrinsic
  importance.
- Consequential mail (financial / account / mandatory-administrative) reliably clears the
  Important bar even when extraction under-rates it.
- The Important tab is a **prioritized feed that is rarely empty**: genuinely important mail
  ranks first, with lower-priority filler below so the tab never feels barren — without
  redefining "important" as "anything".
- Works on **existing** mail immediately (no re-sync required), because priority is computed
  at read time.
- Consequential mail still appears under its own category tab; Important is a cross-cutting
  view, not a category.

## Design

### Backend — `backend/app/api/v1/endpoints/events.py` (read-time only, no DB change)

**1. Boost-only priority.** `calculate_priority` changes its blend to:

```
priority = max(importance, 0.4·importance + 0.6·relevance)
```

Interests can only raise priority. The no-interests fallback (importance only) is unchanged.
`max` is equivalent to "blend when relevance > importance, else importance", so interest
matches still promote low-importance-but-relevant mail while high-importance mail is never
buried.

**2. Consequence floor.** A module-level keyword constant and a small helper:

```
CONSEQUENCE_SIGNALS = [
    "fee", "payment", "due", "dues", "fine", "penalty", "overdue",
    "account", "deactivat", "blacklist", "mandatory", "last date",
    "registration deadline",
]
```

`_has_consequence(event) -> bool` scans the lowercased `display_name + " " + raw_summary`
for any signal substring. When true, `importance` is floored to `max(importance, 0.75)`
*before* the blend, so the email clears the 60 bar even if extraction scored it low. The
floor is applied inside `calculate_priority` (or a wrapper it calls) so it affects the
returned `personalized_priority` uniformly across all event endpoints.

Both changes are read-time, so the existing stored `events` rows benefit on the next
`/events` load — the empty tab repopulates without re-extraction. Interest-based promotion
of old mail still requires a future re-sync to populate `interest_tags`, but is not needed
for the tab to be useful.

### Frontend — `frontend/src/app/components/InboxScreen.tsx`

**3. Threshold + top-up, priority-sorted.** Replace the per-email Important predicate
(`ev.personalized_priority >= 60`) and the date sort for this tab with a set computation:

```
const IMPORTANT_MIN = 5;       // never show fewer than this when mail exists
const FILLER_FLOOR = 25;       // never top up with priority <= this (junk guard)

// for the Important tab only:
const ranked = [...events].sort((a, b) =>
  (b.personalized_priority ?? 0) - (a.personalized_priority ?? 0));
const core = ranked.filter(e => (e.personalized_priority ?? 0) >= 60);
const list = core.length >= IMPORTANT_MIN
  ? core
  : [...core, ...ranked
      .filter(e => (e.personalized_priority ?? 0) < 60 &&
                   (e.personalized_priority ?? 0) > FILLER_FLOOR)
    ].slice(0, IMPORTANT_MIN);
```

The Important tab renders `list` in priority order (interest-matched + consequential mail on
top, filler below). All other tabs keep their current per-category filter and date sort. If
the whole inbox is below `FILLER_FLOOR` the tab may still be empty — that is honest (nothing
substantive exists), and distinct from the previous failure where substantive mail was hidden.

## Components / boundaries

- `calculate_priority(event, user_interests)` — pure, returns 0–100; now `max`-blended and
  consequence-floored. Unit-testable in isolation.
- `_has_consequence(event)` — pure predicate over text. Unit-testable.
- Frontend Important-list builder — pure transform over the events array; verifiable by
  inspection / lightweight test.

## Testing

- `calculate_priority`: importance dominates when relevance is low (high-importance,
  no-interest email ≥ its importance); relevance promotes when importance is low (low-importance
  email matching 2 interests clears 60); no-interest fallback unchanged; cap at 100.
- Consequence floor: a "hostel fee due" / "account will be deactivated" subject floors to
  ≥0.75 and so reaches Important; a benign subject does not.
- Existing 64 backend tests stay green.

## Tunables (defaults)

| Knob | Default | Meaning |
|---|---|---|
| Consequence floor | 0.75 | importance assigned to consequence-signal mail |
| `IMPORTANT_MIN` | 5 | minimum items shown when inbox has mail |
| `FILLER_FLOOR` | 25 | top-up never includes priority ≤ this |
| `IMPORTANT_THRESHOLD` | 60 | the "genuinely important" bar (unchanged) |

## Out of scope

- Re-sync / re-extraction of historical mail (separate, optional; enables interest matching
  on old emails).
- Notifications (will reuse the same priority + threshold later).
- Unifying the backend-dead `IMPORTANT_THRESHOLD` with the frontend constant (tracked in
  PRODUCTION_CLEANUP; revisit when notifications land).
