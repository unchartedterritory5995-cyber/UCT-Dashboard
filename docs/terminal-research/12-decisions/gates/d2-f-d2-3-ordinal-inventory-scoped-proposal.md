---
id: GATE-D2-F-D2-3-ORDINAL-INVENTORY
unit: D2 CP5
title: D2 CP5 — F-D2-3, close the "other positional readers are named in the
  finding" gap that was never actually delivered
role: Narrow pre-implementation review packet. Detection and inventory ONLY — this
  packet does not migrate any of the 21+ exposed call sites, and says so repeatedly
  on purpose, because the risk profile of touching them is completely different
  from the risk profile of finding them
phase: 3.5 (pre-implementation, not implementation)
date: 2026-09-22
status: PROPOSED — not signed.
sources: docs/terminal-research/12-decisions/gates/d2-canonical-data-model-pre-implementation-gate.md
  (§CP2.3, the paragraph claiming "the other positional readers of that projection
  are named in the finding" — traced this pass and found untrue; the finding names
  nothing beyond ticker_returns.py), docs/terminal-research/00-program-control/
  {COMPLETION_AUDIT.md (F-D2-3's row, §262, "OPEN -- needs re-read"), LEDGER.md
  (lines 1596-1604, the only other place F-D2-3's text exists)}, plus this pass's
  own read-only whole-repo enumeration of every call site indexing a
  bars_sqlite.get_bars/get_bars_before/get_bars_since result by bare integer
  (api/services/{bars_fetch.py:815, adjustment_basis.py:89, audit.py:396,
  bars_split_repair.py:92, desk_article_anchors.py:52, single_stock_etfs.py:315,
  theme_engine/comovement.py:14, voice_deep_data_tools.py:90-108, scan_volume.py,
  screener/{snapshot_builder.py:591-619, scan_evaluator.py:973-974},
  research/ratings_universe.py:70-71, indicator_alert_evaluator.py:1104-1119,
  pattern_engine/memory.py:346, pattern_vision/modelbook_examples.py:85,
  wisdom/publish/{lookalike.py:62-65, level_alerts.py:122}}, api/routers/{signature.py,
  ai_search.py:1489-1496, backtest.py:68}), tests/test_canonical_address_book.py
  (test_exactly_the_named_module_reads_the_address_book, the allowlist rail this
  proposal's new rail is modeled on), and tests/test_signature_router.py:240-256
  (the vacuous-fixture bug found while tracing the existing rail's coverage). No
  application code was modified to produce this packet.
---

# D2 CP5 — closing F-D2-3's undelivered enumeration

## Why this is CP5, and how that number was chosen (not guessed)

⚰️ *This section originally argued for naming the packet after its finding
(F-D2-3) instead of a checkpoint number, to avoid guessing a slot in D2's
already-drifted numbering (see F-D2-2's own closure). That reasoning was
right about the risk and wrong about the fix: `tools/sign_gate.py`'s own
`sign()` requires the `--scope-file` text to name a checkpoint id the packet
itself declares (`declared_checkpoints()`) — a signature cannot be written
at all without one. Discovered when the first sign attempt on this file was
correctly REFUSED (exit `REFUSED_UNDECLARED_SCOPE`) for naming no checkpoint.*

**CP5 is genuinely unused, checked directly rather than assumed:** D2's numbering
has two tracks — the base sequence (CP1, CP2, "top-level CP3") and a second
sequence living under §4 (§4-CP3, §4-CP4, added for the timeframe-map and
indicator-axis work). Neither track has ever used 5. A repo-wide grep for
`D2 CP5`/`D2CP5`/`D2-CP5`/`§4-CP5`/`§5-CP` before this line was written found
nothing. This packet declares itself via the `unit: D2 CP5` frontmatter line —
the STRONG, table/unit-line form `declared_checkpoints()` prefers over scanning
prose — so a future reader (or tool) never has to re-derive this from scratch.

## APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-22
APPROVED AT SHA:  06ddbe081
SCOPE APPROVED:   D2 CP5 (closes F-D2-3) -- close the "other positional readers are named in the finding" gap, per docs/terminal-research/12-decisions/gates/d2-f-d2-3-ordinal-inventory-scoped-proposal.md section 2. MUST BUILD: a whole-repo static inventory tool (e.g. tools/bars_ordinal_census.py) that AST-sweeps every call to bars_sqlite.get_bars/get_bars_before/get_bars_since and classifies each consumer as named-access or positional, refusing rather than guessing on an ambiguous call site; a checked-in inventory file (e.g. api/data/bars_ordinal_census.json) listing every positional consumer by file:line; a rail test asserting the live census matches the checked-in one, mutation-proved both directions; a one-line fix to tests/test_signature_router.py's vacuous open==close==95.0 fixture so it can actually distinguish an ordinal swap. SHOULD BUILD: none. EXPLICITLY DEFERRED, NOT AUTHORIZED BY THIS LINE: migrating any of the 21+ enumerated positional call sites onto named/declared access -- each is its own future checkpoint, requiring tools/flow_worker_watch_coverage.py to be run against the specific file first; adding new declared accessors to address_book.py. No schema change on any live store. No production reader's runtime behavior changes.
```

No field above is filled in. This packet proposes exactly one checkpoint (section 2);
nothing in it authorizes writing product code beyond that scope.

---

## 1. Why now, and why this is smaller than it looks

D2 CP2's own packet said, about the `ticker_returns.py` ordinal fix: *"the other
positional readers of that projection are named in the finding."* That sentence is
not true. F-D2-3's actual text (`LEDGER.md:1601-1604`, and the identical restatement
in the gate packet) names only `ticker_returns.py` — the "other readers" were never
enumerated anywhere in the doc tree. `COMPLETION_AUDIT.md` already records this
honestly as `F-D2-3 | D2 CP1 | OPEN | -- needs re-read`.

This pass did the re-read. The rail CP2 actually built
(`test_canonical_address_book.py::test_the_migrated_readers_ORDINAL_agrees_with_the_book`)
is real and currently passing (verified: `python -m pytest tests/test_d2_dual_read.py
tests/test_canonical_address_book.py -q` → 59/59) — it protects exactly the one reader
CP2 migrated, and does so honestly (mutation-proved: `test_the_ordinal_rail_CAN_FAIL`).
What it does not do, and never claimed in its own code to do, is protect anything else.

A whole-repo enumeration (this pass, read-only, no files modified) found **21+ call
sites across 19 files** with the identical shape `ticker_returns.py` had before CP2 —
a bare integer index into a `(ts,o,h,l,c,v)` tuple, with no test that would notice a
reorder. The highest-traffic one, `bars_fetch.py::_fmt_sqlite_bars`, feeds
`/api/bars/{ticker}`, the site's primary chart endpoint. Others feed the voice
assistant (narrates the numbers aloud), Journal 2.0's MFE/MAE analytics, and the
bars-reconciliation auditor itself.

**This is a real gap, and it is also not an emergency.** Nothing has actually
reordered `bars_sqlite.py`'s SELECT — the code is currently correct, everywhere.
What is missing is a safety net for a future reorder, not evidence of a present
defect. That distinction is why this packet's scope is detection, not surgery: the
21 call sites span core chart-serving code, the nightly scan sweep, and
indicator-condition alert evaluation, several of which may be inside flow-worker's
watched-file set (not checked by this pass) — migrating any of them is a
materially different, higher-blast-radius decision than finding them, and deserves
its own separately-scoped checkpoint(s) once someone has actually run
`tools/flow_worker_watch_coverage.py` against each candidate file.

## 2. Exact scope

**MUST BUILD:**

- **A whole-repo static inventory tool** (e.g. `tools/bars_ordinal_census.py`,
  modeled directly on `test_canonical_address_book.py`'s existing
  `test_exactly_the_named_module_reads_the_address_book` allowlist pattern): an AST
  sweep that finds every call to a function returning the `(ts,o,h,l,c,v)` shape
  (`bars_sqlite.get_bars`/`get_bars_before`/`get_bars_since`, extendable if more are
  found) and classifies each consumer as **named-access** (goes through
  `address_book.row_position` or an equivalent declared accessor) or
  **positional** (bare integer index / unpack). Refuses rather than guesses on an
  ambiguous call site, matching every other builder in this book's family.
- **A checked-in inventory file** (e.g. `api/data/bars_ordinal_census.json`) listing
  every positional consumer found, by file:line — the enumeration F-D2-3's own text
  claimed existed and did not.
- **A rail test** asserting the live census matches the checked-in one — so a NEW
  positional consumer added anywhere in the repo in the future is caught by name at
  review time, not discovered by another investigation years later. Mutation-proved
  both directions (adding an unlisted positional read reds it; the census tool
  itself failing open — e.g. an AST form it doesn't recognize silently skipped —
  reds it too, mirroring the "refuses rather than guesses" discipline).
- **Fix the vacuous fixture found while verifying the existing rail's actual
  coverage**: `tests/test_signature_router.py::test_bars_are_read_with_the_daily_store_key`
  sets `open=95.0` and `close=95.0` identically (lines 248-249), so an open/close
  ordinal swap would still pass `rows[0]["c"] == 95.0` vacuously — the exact
  "every value must be distinct" fixture defect `test_d2_dual_read.py`'s own header
  already warns against, recommitted in a different test. One-line fix: make the
  fixture's OHLC values pairwise distinct. Test-file-only change, zero production
  risk.
- **Correct the record**: strike the false "the other positional readers are named
  in the finding" sentence from wherever it is quoted as fact going forward (this
  proposal's own sources list is the correction; the gate packet and LEDGER.md
  entries themselves are historical and are not rewritten, per this program's own
  convention of correcting forward with a ⚰️ note rather than editing history).

**SHOULD BUILD:** none, matching the same house convention CP2 used.

**DEFER (named, not silently dropped — this is the load-bearing DEFER of this
packet):**

- **Migrating any of the 21+ enumerated call sites** onto named/declared access.
  Every one of them is real production code, several likely flow-worker-reachable,
  and the highest-traffic one (`bars_fetch.py`) is the primary chart data path for
  the whole site. Each migration is its own risk profile and belongs in its own
  future checkpoint(s), scoped and reviewed individually — exactly the same
  "declare once, migrate one reader at a time" discipline CP2 itself used, except
  here even choosing a safe first reader to migrate requires running
  `tools/flow_worker_watch_coverage.py` against the specific file first, which this
  packet does not do.
- **Adding new declared accessors to `address_book.py` beyond what already exists.**
  This packet inventories exposure; it does not build new named-access
  infrastructure for readers that don't have one yet.

## 3. Current state → target state

**CURRENT STATE**, confirmed this pass:

| Component | State |
|---|---|
| `ticker_returns.py`'s ordinal | Protected, rail passing (59/59), mutation-proved |
| The other 21+ positional consumers | Unenumerated anywhere in the doc tree; each as exposed as `ticker_returns.py` was pre-CP2 |
| `test_signature_router.py`'s ordinal-shaped test | Present, but its fixture cannot distinguish open from close — vacuous |
| F-D2-3's status | `OPEN -- needs re-read` (accurate) |

**TARGET STATE**: the population of positional bars-tuple consumers is a named,
checked-in fact instead of an unenumerated risk; any future addition to that
population is caught at review time by the census rail; the one identified vacuous
test fixture is fixed. No production reader's runtime behavior changes.

**THE GAP**: exactly the MUST-BUILD list in section 2.

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Reading this packet as "the fragility is now fixed" | A member-facing reorder-induced data-corruption bug could still ship — only detection exists, not remediation | Section 1 and the DEFER list say so explicitly, more than once, on purpose |
| The census tool itself has blind spots (a call shape it doesn't recognize) | A positional consumer could exist outside the checked-in inventory and nobody would know | The tool refuses rather than silently skips an unrecognized form, matching `build_canonical_address_book.py`'s existing discipline; the rail's own mutation proof includes this failure mode |
| Someone reads the census and migrates a flow-worker-reachable file without checking reachability first | A flow-worker restart could be forced at the wrong time, permanently gapping the OPRA options tape | Section 2's DEFER explicitly instructs running `tools/flow_worker_watch_coverage.py` before migrating any enumerated site — named as a precondition, not left implicit |

## 5. Test & acceptance plan

| Test | Proves |
|---|---|
| `test_bars_ordinal_census_matches_checked_in_inventory` | The live AST sweep and the committed JSON agree — mirrors the address book's own `--check` discipline |
| `test_bars_ordinal_census_CAN_FAIL` | Planting a new positional consumer in a fixture copy reds the rail |
| `test_bars_ordinal_census_refuses_an_unrecognized_form` | An AST shape the census tool doesn't recognize fails the build rather than being silently omitted |
| `test_bars_are_read_with_the_daily_store_key` (fixed) | Re-run with a corrected, pairwise-distinct OHLC fixture — proves it can now actually catch an ordinal swap, not just pass one vacuously |

## 6. Owner-bound questions

None. This proposal only inventories and records an existing, already-live gap; it
authorizes no change to any production reader's behavior.
