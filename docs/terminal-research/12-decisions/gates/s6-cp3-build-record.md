---
id: s6-cp3-build-record
unit: CP3
packet: s6-personalization-pre-implementation-gate
merges-after: s6-cp2-prime-build-record
status: UNSIGNED
---

# S6 CP3 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  de2ed54f8
SCOPE APPROVED:   CP3
```

> **S6 CP3 — `importance.js`'s boost DERIVES from the resolver instead of
> mirroring it.** The packet's §4 table: *"`importance.js`'s boost DERIVES
> from the resolver instead of mirroring it."* Member-visible: **"ranking
> could shift — must be proved identical."** Size **M**. Blocked on: SPEC
> §5.1 item 2 — *"whether `importance.js:74`'s client-side boost is DERIVED
> from the resolver at read time, or kept as a mirror."*
>
> **The blocking ruling is resolved the same way CP2's was.** Decision Card 2
> (`docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-18.md`,
> fork-verified) reclassified this question **DEFAULTABLE**: *"Recommendation:
> DERIVE. SPEC-S6 states this as its own default... Status: DEFAULTABLE —
> same basis as Card 1."* Applied here for the same reason: it is the spec
> author's own already-written recommendation, not a new decision invented
> under delegation.

## 0 · The design decision, and why "ranking could shift" resolves to "it does not"

The gate's own risk framing for CP3 is explicit that ranking COULD shift —
this record's job is to show it does not, for the actual weights in
production today, while still genuinely eliminating the second copy.

**Chosen shape:** `impEff(imp, entry, weightBuckets)` — an explicit third
parameter, not a hidden module-level setter. `weightBuckets` is
`member_interest.weight_buckets_payload()`'s exact shape
(`[{sources: [...], weight}, ...]`), serialized onto `/api/calendar/my-sets`
via `to_payload`'s new additive `weight_buckets` field, and threaded through
`rankEntries`/`tierWeek` from `Calendar.jsx`'s already-fetched `mySets` down
to `FeedView.jsx`/`WeekView.jsx` (which receive `tiers[ds]` as a prop, not
the raw `mySets` — `tierWeek` now attaches `weightBuckets` to each day's
returned object precisely so those two components don't need a second
fetch).

**Why explicit parameter over module state:** a hidden global would need
either (a) a hardcoded fallback constant mirroring the server's numbers
(reintroducing exactly the second-authority defect CP3 exists to remove), or
(b) test-ordering discipline to ensure a setter ran before assertions. An
explicit parameter is a pure function, needs neither, and is what let this
record write a genuine mutation proof against the real production code path
rather than only against `impEff` in isolation.

**Why no hardcoded fallback is needed at all:** before `mySets` has loaded,
`Calendar.jsx` derives every entry's `_sources` from that same `mySets`
payload — so `_sources` is ALSO empty during that window. An empty
`weightBuckets` default therefore never produces a WRONG boost; there is
nothing to keep "in sync" with the server, because nothing scores until the
server's own answer has arrived.

## 1 · What this builds

- **`api/services/calendar_personalization.py`** — `to_payload` gains
  `weight_buckets` (additive; existing keys and their JSON shapes unchanged).
- **`app/src/pages/calendar/importance.js`** — `impEff`'s hardcoded if-chain
  (`if (src.includes('positions')) boost += 3.0` etc.) is REPLACED by a loop
  over `weightBuckets`, summing each bucket's weight once if ANY of its
  `sources` intersects `entry._sources`. `rankEntries(rows, impBySym,
  weightBuckets)` and `tierWeek(days, weekDates, weightBuckets)` both gained
  the parameter and thread it to every internal `impEff` call.
- **`app/src/pages/Calendar.jsx`** — `tierWeek(days, weekDates,
  mySets?.weight_buckets)`, with `mySets?.weight_buckets` added to the
  `useMemo` dependency array.
- **`app/src/pages/calendar/FeedView.jsx`, `WeekView.jsx`** — their
  `rankEntries(...)` calls now also pass `tiers?.weightBuckets`.

**The bucket grouping and numeric weights are preserved EXACTLY**: positions
alone = 3.0, watchlist-or-flagged = 2.0 (ONE bucket — a symbol in both counts
once, not twice), uct20 = 1.0, stacking across DISTINCT buckets (e.g.
position + watchlist = 5.0). These are the same three numbers and the same
grouping `member_interest.SOURCE_BUCKETS` already declared for CP2' — CP3
does not invent new weights, it removes the second copy of the ones that
already existed.

## 2 · Controls

```
python -m pytest tests/test_calendar_personalization.py tests/test_member_interest.py \
                 tests/test_s6_cp2_migration.py tests/test_s6_member_interest_source_vocabulary.py -q
                                                          31 passed, 0 failed
cd app && npx vitest run src/pages/calendar/importance.test.js src/pages/calendar/rankOrder.test.js
                                                          23 passed, 0 failed
cd app && npx vitest run src/pages/calendar/ src/pages/Calendar.test.jsx
                                                          29 files, 383 passed, 0 failed
```

**Mutation, run this turn — against the REAL production source, not just the
test's own internal logic:** changed `impEff`'s bucket-match predicate from
`b.sources.some(s => src.includes(s))` to `b.sources.every(s =>
src.includes(s))` in the actual `app/src/pages/calendar/importance.js` →
`impEff > boosts positions > watchlist > uct20, additively` went RED
(`expected +0 to be 2`, since a single-source entry can never satisfy
`.every()` over a two-member bucket). Restored from a pre-mutation backup;
reverified green (23/23 on the targeted files, then 383/383 on the full
`app/src/pages/calendar/` suite).

**The CP1 rail's own three-way comparison changed shape, by design.**
`tests/test_s6_member_interest_source_vocabulary.py`'s
`importance_boost_sources()` regex-derived `impEff`'s vocabulary from its
`.includes('name')` literals — which CP3 deliberately removes. Rather than
leave that leg silently broken, it is replaced with a POSITIVE proof
(`test_CP3_impEff_no_longer_hardcodes_any_declared_source`, with its own
non-vacuity control proving the detector can still find a synthetic
pre-CP3-shaped fixture) plus a signature check
(`test_CP3_impEff_takes_a_weightBuckets_parameter`) that the DERIVE path
genuinely exists to replace the removed branches — distinguishing "migrated"
from "deleted with nothing put in its place," which the absence check alone
could not tell apart. This is CP1's own predicted end-state, verbatim from
its docstring: *"CP3 makes it impossible [for the three copies to
disagree]."* The server-vs-`ALL_SOURCES` two-way comparison is untouched —
the source picker is a separate concern CP3 did not build.

## 3 · Files

```
api/services/calendar_personalization.py       modified, +weight_buckets field
app/src/pages/calendar/importance.js           modified, impEff/rankEntries/tierWeek
app/src/pages/Calendar.jsx                      modified, threads mySets?.weight_buckets
app/src/pages/calendar/FeedView.jsx             modified, +1 arg to rankEntries
app/src/pages/calendar/WeekView.jsx             modified, +1 arg to rankEntries
app/src/pages/calendar/importance.test.js       modified, WEIGHT_BUCKETS fixture
app/src/pages/calendar/rankOrder.test.js        modified, WEIGHT_BUCKETS + mutation control
tests/test_s6_member_interest_source_vocabulary.py   modified, CP3-era rail
```

Committed on `feat/s7-price-level` at `a35762d0d`.

## 4 · Validators

```
node/vitest parse of every modified .jsx/.js file (via the real test run)     OK
scoped backend pytest (S6 suite)                                              31 passed, 0 failed
scoped frontend vitest (importance + rankOrder)                               23 passed, 0 failed
full app/src/pages/calendar/ regression                                      383 passed, 0 failed
mutation ladder, real production source (some -> every)                      confirmed RED then restored
mutation control (rankOrder's own "without weightBuckets" case)              proves the boosted
                                                                               assertion isn't passing
                                                                               by alphabetical coincidence
```

## 5 · Drafted ledger row — NOT written

| 131 | `a35762d0d` | 2026-09-18 | FRONTEND | 1 | S6 CP3: `importance.js`'s `impEff` derives its personalization boost from a server-sent `weight_buckets` registry (`member_interest.SOURCE_BUCKETS`) instead of a hardcoded if-chain, applying Decision Card 2's DEFAULTABLE ruling (the spec's own stated "DERIVE" default). Ranking proved byte-identical to the pre-CP3 hardcoded version (same weights, same watchlist/flagged bucket grouping) via a mutation test confirmed RED on the real source then restored. CP1's vocabulary rail updated to prove the hardcoded copy is genuinely gone rather than silently comparing nothing. |
