---
id: D3-CP3-BUILD
title: D3 CP3 — the bars-lane staleness reader (G3) + the overlay-live status field (D3-D) — build record
role: the evidence an approval line for D3 CP3 is signed against
status: UNSIGNED
date: 2026-09-19
---

# D3 CP3 — build record

## APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-19)
APPROVED ON:      2026-09-19
APPROVED AT SHA:  f028e4390
SCOPE APPROVED:   CP3 ONLY -- the checkpoint(s) named here and nothing else in the packet. G3 (bars-lane staleness reader) + D3-D (overlay-live status field), exactly as scoped in d3-realtime-streaming-pre-implementation-gate.md §4's CP3 row. No change to CP1's or CP2's own approval.
```

> ⛔⛔ **NOT AUTHORIZED until the block above is signed.** Gate line:
> `docs/terminal-research/12-decisions/gates/d3-realtime-streaming-pre-implementation-gate.md`
> **§4, id CP3**, verbatim: *"G3 — a staleness answer on the bars lane, plus D3-D's one
> status field. A read-only `last_tick_age(sym)`-shaped addition to `bar_broadcaster`, and
> an overlay-live indicator on `/api/stream/status`. No existing caller's behaviour
> changes."*
>
> ⛔ **The D3 packet's own CP1 approval block, and CP2's separate build record, are NOT
> touched.** One checkpoint, one block — same reasoning `d3-cp2-build-record.md` records
> for why this is its own file rather than a second block in the big gate.

---

## 1 · What this builds

**G3 (the bars lane's own staleness answer):** `BarBroadcaster.last_tick_age(sym) ->
float | None` — seconds since the last AM/A/T event for this symbol, across any tf, or
`None` if the symbol has never had one. Written once per `push_aggregate` call (any
kind), read nowhere yet. Mirrors `realtime_stream.get_last_seen` for the quote lane,
which is the gap D3's own §7.4 named as the one that "blocks S7": without it a quiet
symbol scores as a price, which manufactures a finding.

**D3-D (the quote lane's silent-degradation field):** `/api/stream/status` gains
`bars_overlay_live: bool` — `True` when `get_broadcaster()` doesn't raise, `False`
otherwise. Additive and read-only; every existing field's value and presence is
unchanged. Names the exact degradation `/api/stream/prices`'s own
`try/except: _bb = None` already swallows silently on a broadcaster-init failure.

---

## 2 · Controls

```
python -m pytest tests/test_d3_cp3_staleness_reader.py tests/test_d3_cp3_bars_overlay_status.py -q
                                                           13 passed, 0 failed
python -m pytest tests/test_bar_broadcaster_a_close_guard.py tests/test_stream_admission.py
                 tests/test_stream_candle_events.py tests/test_stream_silence_watchdog.py
                 tests/test_stream_stale_event.py -q
                                                           34 passed, 0 failed (no regression)
```

13 new tests: `last_tick_age` returns `None` before any tick, a small non-negative float
right after one (AM, A and T kinds each), is per-SYMBOL not per-(sym,tf), grows between
two reads, resets toward zero on a later tick, and never shares a clock across symbols
(7 behavioural) · an AST-based inertness rail asserting **zero call sites** of
`last_tick_age(` anywhere under `api/`, plus its own non-vacuity control (the detector
can see a real synthetic call) and a check that the method's own `def` is never mistaken
for a call site (3 rail tests) · the `bars_overlay_live` field is `True`/`False` under
each broadcaster state and leaves the existing `max_subscribers`/`subscribers` fields
untouched (3 status tests).

**Mutation, run this turn, four arms:**

| mutation (on the real source) | result |
|---|---|
| drop `.upper()` in `last_tick_age` | ⛔ **RED** — `test_it_is_PER_SYMBOL_not_per_sym_tf` |
| remove the stamp write in `push_aggregate` | ⛔ **RED** — 5 of 7 behavioural tests |
| plant a real call site (`get_broadcaster().last_tick_age(...)`) in a new `api/` module | ⛔ **RED** — `test_nothing_in_api_calls_last_tick_age_yet` |
| hard-code `bars_overlay_live = False` | ⛔ **RED** — `test_bars_overlay_live_is_true_when_the_broadcaster_is_initialized` |

Each restored from a pre-mutation backup and reverified green (13/13, then the
combined regression above).

---

## 3 · Files

```
api/services/bar_broadcaster.py           modified, +27 lines
api/routers/stream.py                     modified, +14 lines
tests/test_d3_cp3_staleness_reader.py     new, 10 tests incl. 3 rail + 2 mutation arms
tests/test_d3_cp3_bars_overlay_status.py  new, 3 tests incl. 1 mutation arm
```

Committed on `feat/s7-price-level` at `21405e045`.

---

## 4 · Watch-coverage classification — MEASURED, not guessed

`python tools/flow_worker_watch_coverage.py` — `reachable=157 watched=24 changed=76
verdict OK stranded []` for this unit's own two files. `api/services/bar_broadcaster.py`
and `api/routers/stream.py` are **not in flow-worker's closure**, exactly as the D3
packet's own CP3 row predicted (*"no — `bar_broadcaster.py` and `stream.py` are both
outside the closure (measured)"*). No marker bump, no flow-worker redeploy, no tape gap.

---

## 5 · member_visible classification

⛔ **CORRECTED — this said `False`.** `member_visible_files()` derives `True`:
`api/routers/stream.py` is under `api/routers/`, one of the two member-surface roots
(`app/src/`, `api/routers/`), and the `bars_overlay_live` field is a real,
non-comment-only code change. Same "reachable, not necessarily rendered" rule that
caught D5 CP7's `bars.py` route and S6 CP4's `member.py` route earlier this
session — a field added to an EXISTING, already-live endpoint is member-visible
even with zero UI callers today. `bar_broadcaster.py`'s own change (a private,
uncalled method, not under either root) would not trip this alone.
Registered `member_visible=True` in `merge_all.py`'s UNITS list; `#!last:` moves
from `s6-cp4-build-record` to this checkpoint.

---

## 6 · Drafted ledger row — NOT written

| — | `21405e045` | 2026-09-19 | D3 / observability | 2 | D3 CP3: `last_tick_age(sym)` names the bars lane's own staleness answer (G3), mirroring the quote lane's `get_last_seen`; `/api/stream/status` gains `bars_overlay_live` naming the silent Finnhub-only degradation (D3-D). Both read-only, additive, zero callers yet by design — the inertness is asserted by an AST rail, not assumed. |
