---
id: d4-cp4-build-record
unit: D4 CP4'
packet: d4-caching-and-serving-pre-implementation-gate
merges-after: D CP4
status: SIGNED (D4 CP4', fingerprint 23a8da7a9)
---

# D4 CP4′ — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  23a8da7a9
SCOPE APPROVED:   CP4' ONLY -- the checkpoint(s) named here and nothing else in the packet.
```

> **D4 CP4′ — the corrected assertion from F-D4-1.** CP4 as originally written was
> UNBUILDABLE (a hand-typed `fundamentals::{TICKER}::{period}` key that never
> existed). CP4′, PROPOSED in the packet itself, is what this builds: `earnings_table`
> keeps its real two-segment shape but gains a boundary after the ticker so a
> per-ticker `delete_prefix` is safe by construction; `fundamentals_monitor`'s
> ticker-recovery parse refuses a malformed key instead of guessing one;
> `fundamentals.py` is dropped from CP4's scope (it owns no key in this family).
> Scope is `api/services/earnings_table.py`, `api/services/fundamentals_monitor.py`,
> and `tests/test_fundamentals_monitor.py`, as enumerated by `git show --stat` of
> this unit's commit.

⛔ **Collision proof:** no `d4-cp*-build-record.md` exists on disk; CP4 itself was
never signed (stopped on F-D4-1's measurement, per the packet's own record). **CP4′
free** — it is the corrected version of the same slot, not a new number, per this
programme's own precedent (E CP35 corrected E CP34's plan the same way).

## 1 · What F-D4-1 found and what CP4′ fixes

Filed 2026-09-14: CP4's assertion presumed `earnings_table`/`fundamentals` share a
`fundamentals::{TICKER}::{period}` key and asked for "an anchored prefix" — i.e. a
rename. Two of its three nouns did not resolve: `{period}` appears nowhere in the
real key construction, and `fundamentals.py` builds no cache key in this family at
all (zero `cache.get/set/invalidate` sites). The real key is
`f"earnings_table::{ticker}"` — two segments, with no boundary after the ticker, so
a per-ticker `delete_prefix` (nothing calls one today, but nothing stops a future
caller from adding one) would over-match: `delete_prefix("earnings_table::A")` also
matches `"earnings_table::AAPL"`. Today's code avoids this by using exact
`cache.invalidate()`, not `delete_prefix()` — safe by convention, not by
construction.

**CP4′, exactly as PROPOSED in the packet:**
- (a) `earnings_table`'s key stays two-segment; it gains an unambiguous trailing
  boundary (`\x1f`, ASCII unit separator — cannot appear in a real ticker symbol) so
  a per-ticker `delete_prefix` is safe by construction, not by a comment.
- (b) `fundamentals_monitor`'s ticker-recovery parse (`k.split("::", 1)[1].upper()`)
  becomes an explicit parse that REFUSES (skips) a key without the terminator,
  rather than silently upcasing a garbled substring and feeding it to
  `check_ticker` as if it were a real ticker.
- (c) `fundamentals.py` is dropped from CP4's scope — recorded here, no code change,
  since it owns no key in this family to begin with.

## 2 · The fix

- `api/services/earnings_table.py`: new `_KEY_TERM = "\x1f"` constant and
  `_cache_key(ticker)` helper; all four raw `f"earnings_table::{ticker}"`
  constructions (build/read/two invalidate sites) route through it.
- `api/services/fundamentals_monitor.py`: imports `_KEY_TERM`; the warm-entry
  enumeration now requires the key to end with the terminator and slices the
  ticker out explicitly, `continue`-ing past anything that doesn't match.
- Nothing else changed. `fundamentals.py` untouched (per (c) above — it was never
  in scope).

## 3 · Controls

```
python -m pytest tests/test_earnings_table.py tests/test_earnings_table_completeness.py
              tests/test_earnings_table_router.py tests/test_earnings_table_snapshot_version.py
              tests/test_fundamentals_monitor.py tests/test_fundamentals_monitor_dedupe.py -q
                                                                74 passed, 0 failed
```

Two new tests, both mutation-proved:
- `test_sample_refuses_a_malformed_warm_key_rather_than_guessing` — a key missing
  the terminator (or an empty ticker) is skipped, never guessed. **Mutation**:
  reverted the parse to the old blind `split("::", 1)[1]` → RED.
- `test_warm_ticker_recovery_cannot_collide_a_short_ticker_into_a_longer_one` — the
  actual collision proof, against the real key builder and a real `TTLCache`:
  `delete_prefix(_cache_key("A"))` removes exactly the "A" entry, `"AAPL"` survives.
  **Mutation**: reverted `_cache_key` to the old bare (no-terminator) format → RED
  (the delete now removes both entries, `AAPL` no longer survives).

Both pre-existing tests that hard-coded the old key shape
(`test_heal_uses_exact_delete_for_earnings_table`,
`test_sample_prefers_warm_and_bounds_cold_tail`) updated to the new shape and still
pass, unchanged in intent.

## 4 · Files

```
api/services/earnings_table.py         +11/-4 lines: _KEY_TERM + _cache_key(), four call sites
api/services/fundamentals_monitor.py   +7/-2 lines: import _KEY_TERM, refuse-on-mismatch parse
tests/test_fundamentals_monitor.py     +40/-8 lines: 2 updated + 2 new tests
```

## 5 · Validators

```
ast.parse both files                                            OK
scoped pytest, 6 files                                           74 passed, 0 failed
mutation ladder (2 arms, both load-bearing)                      both confirmed RED then restored
```

## 6 · Drafted ledger row — NOT written

| 125 | `<this commit>` | 2026-09-18 | PRODUCT | 1 | D4 CP4′: the packet's original CP4 named a cache key that never existed (F-D4-1); this builds the PROPOSED correction instead — `earnings_table`'s real two-segment key gains an unambiguous terminator so a per-ticker `delete_prefix` is safe by construction, and `fundamentals_monitor`'s ticker-recovery parse refuses a malformed key rather than manufacturing a garbled one and reporting it as a data defect. `fundamentals.py` dropped from scope (owns no key here). |
