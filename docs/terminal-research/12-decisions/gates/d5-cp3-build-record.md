---
id: d5-cp3-build-record
unit: CP3
packet: d5-reference-corp-actions-pre-implementation-gate
merges-after: s7-price-level-f6-build-record
status: SIGNED (CP3, fingerprint c6f071bf6)
---

# D5 CP3 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  c6f071bf6
SCOPE APPROVED:   CP3 ONLY -- the checkpoint(s) named here and nothing else in the packet.
```

> **D5 CP3 — the one confirmed corporate-actions source: splits.** Named explicitly by
> the owner's session prompt as one of "the six" units to build this session
> (`SESSION PROMPT — SCORE E CP38, BUILD THE SIX, S7 DARK-READ INVESTIGATION, CARDS
> HELD`, 2026-09-18), which lists `D5 CP3, CP5, CP6, CP7` in dependency order. The
> gate's own table (line 190) already declares CP3's scope: *"One confirmed source.
> The Massive `/v3/reference/splits` read moves behind a D1 adapter and WRITES
> `confirmed` rows. Nothing reads them. `polygon_extras`' quarantine entry is removed
> rather than a second list added."* Size **M**, inert-strand risk **no** (per the
> table). This build record is the approval line the gate's own status
> (`CP1 APPROVED 2026-09-12. CP2-CP7 UNSIGNED — each needs its own line`) says CP3
> was still waiting on.

## 0 · The vocabulary question resolved first — what "D1 adapter" means today

The packet's CP3 row says the read "moves behind a D1 adapter." Investigated by direct
code search before writing any code: **D1 is not yet a generalized, reusable module.**
`calendar.py::_fmp_calendar_day` is the only retroactively-labelled instance, and
`tools/fmp_guard_census.py`'s "D1 shipped" line refers to `fmp_client.py` specifically
— an FMP-only consolidation, not infrastructure this checkpoint can import. CP3
therefore follows the PATTERN D1 is meant to generalize (one owned, purpose-built
wrapper around a single vendor endpoint, never duplicated) for the one feed it owns
here, and says so plainly in its own module docstring rather than claiming to
integrate with infrastructure that does not exist.

## 1 · What this builds

**`api/services/reference_corp_actions.py`** (new) — the one confirmed splits source:

- `fetch_confirmed_splits(from_iso, to_iso)` — reads Massive's `/v3/reference/splits`
  (paginated via `next_url`, capped at 20 pages), returns full row detail (ticker,
  execution_date, split_from, split_to). This IS the confirmation — a vendor's own
  reference feed needs no separate detection stage. Returns `[]` on any provider
  failure; never raises.
- `record_confirmed_splits(rows, *, now=None, db_path=None)` — upserts every row into
  a `confirmed_splits` SQLite table (WAL mode) keyed on `(ticker, execution_date)`.
  Idempotent: a re-run over an overlapping window updates the same facts rather than
  duplicating them.
- `refresh_confirmed_splits(from_iso, to_iso, ...)` — one tick of the detect+confirm
  pipeline: fetch, then record. Nothing else reads the ledger this checkpoint writes
  — per the packet's own scope, CP4's dual-compute and CP7's member-visible label are
  later checkpoints that consume it.

**The retired read.** `api/services/massive.py::get_split_tickers` is removed.
Confirmed via `corp_actions_census.py`'s own 106-importer control: zero callers, zero
tests. It discarded everything but the ticker set, which is not enough to write a
confirmed ROW (execution date + ratio are the row) — `fetch_confirmed_splits` owns
its own pagination rather than reusing it. Replaced with a one-line retirement
comment pointing at the new module.

**What is explicitly NOT touched.** `api/services/polygon_extras.py::get_splits`
reads the same Massive endpoint for the voice assistant's corporate-actions tool. It
is that consumer's OWN direct read; migrating it is a separate, later change (nothing
in this checkpoint reads the ledger below), and CP3 is not authorized to build a
second confirmed-source list beside the one it owns.

## 2 · Census updated (`tools/corp_actions_census.py`)

`REGISTER` dict changes, keeping the shared instrument's classification honest as of
this commit:

- `("api/services/massive.py", PROVIDER_READ)` — removed. The site no longer exists.
- `("api/services/reference_corp_actions.py", PROVIDER_READ)` — added, `MIGRATED`:
  "D5 CP3 — the one confirmed splits source. Writes `confirmed_splits` rows; nothing
  reads them yet (CP4/CP7 will)."
- `("api/services/polygon_extras.py", PROVIDER_READ)` — changed OUTSTANDING →
  `OUTSIDE`: "D5 CP3 (2026-09-18) built the one confirmed splits source elsewhere
  WITHOUT migrating this file's live consumer (the voice assistant's
  corporate-actions tool, `voice_tool_impls.py:340`) — a deliberate, separate,
  later change, not an oversight."
- `("api/services/wisdom/capture/families/gex.py", VENDOR_ADJUSTED)` — added,
  `OUTSIDE`, incidental fix: a pre-existing false positive from another workstream's
  drift (the keyword scanner matched "adjusted" as a corp-action term; in this file
  it selects which GEX/dealer-positioning data source to read, unrelated to corporate
  actions). Verified by reading the file directly before registering it rather than
  guessing a classification, per the standing rule against manufacturing findings
  from an instrument's own blind spot. Fixed here to keep the shared census green for
  every workstream, not just this one.

Verified: `PYTHONIOENCODING=utf-8 python tools/corp_actions_census.py` → exit 0,
`OK — every corporate-action site is registered with a state.`

## 3 · Controls

```
python -m pytest tests/test_reference_corp_actions.py -q
                                                          8 passed, 0 failed
python -m pytest tests/test_corp_actions_census.py -q
                                                         13 passed, 0 failed
```

8 new tests in `tests/test_reference_corp_actions.py`, all passing:
`test_fetch_confirmed_splits_builds_the_correct_url_and_paginates`,
`test_fetch_confirmed_splits_skips_a_row_missing_ticker_or_date`,
`test_fetch_confirmed_splits_returns_empty_on_provider_failure`,
`test_record_confirmed_splits_writes_and_is_idempotent`,
`test_record_confirmed_splits_skips_a_row_missing_ticker_or_date`,
`test_record_confirmed_splits_empty_input_is_a_no_op`,
`test_refresh_confirmed_splits_fetches_then_records`, and the mutation proof:

- `test_MUTATION_the_upsert_key_is_ticker_and_execution_date_together` — writes two
  rows sharing exactly one of the two key columns each (`AAPL`/2026-01-01,
  `AAPL`/2026-06-01, `MSFT`/2026-01-01) and asserts all three coexist. **Mutation,
  run this turn**: weakened `PRIMARY KEY (ticker, execution_date)` to
  `PRIMARY KEY (execution_date)` alone → the test went RED (collision, 2 rows
  survived instead of 3), confirming the composite key is load-bearing. Restored and
  reverified green (8/8) before proceeding.

One pre-existing test fixed, and its evolution explained rather than silently
patched: `test_OUTSTANDING_is_allowed_to_be_the_long_list` in
`tests/test_corp_actions_census.py` originally asserted
`not by_state[cac.MIGRATED]` — true at CP1 (nothing had migrated yet), now false
since CP3 shipped a real one. Updated to pin the exact expected migrated-paths set
(`{"api/services/reference_corp_actions.py"}`) with a docstring explaining why the
assertion changed, rather than asserting emptiness against a state that no longer
holds. Full `test_corp_actions_census.py` suite reverified green (13 passed)
alongside this change.

## 4 · Files

```
api/services/reference_corp_actions.py     new, ~150 lines: fetch/record/refresh + schema
api/services/massive.py                    -N lines: get_split_tickers() retired
tools/corp_actions_census.py               REGISTER updated: 1 removed, 2 added, 1 reclassified
tests/test_reference_corp_actions.py       new, 8 tests incl. 1 mutation proof
tests/test_corp_actions_census.py          1 assertion updated + docstring
```

## 5 · Validators

```
ast.parse all changed .py files                                   OK
scoped pytest, 2 files                                             21 passed, 0 failed
mutation ladder (1 arm, load-bearing)                              confirmed RED then restored
census self-check (PYTHONIOENCODING=utf-8 tools/corp_actions_census.py)   exit 0
```

## 6 · Drafted ledger row — NOT written

| 126 | `<this commit>` | 2026-09-18 | BACKEND | 1 | D5 CP3: the one confirmed corporate-actions source (splits). `reference_corp_actions.py` moves the Massive `/v3/reference/splits` read behind a purpose-built wrapper (the D1 PATTERN — D1 itself is not yet a generalized module, confirmed by code search) and writes idempotent `confirmed_splits` rows; nothing reads them yet (CP4/CP7). `massive.get_split_tickers` (zero callers) retired in the same commit. Census updated: the new module MIGRATED, `polygon_extras`'s untouched voice-assistant consumer explicitly OUTSIDE (separate, later change), plus an incidental fix to a pre-existing unrelated false positive in `wisdom/capture/families/gex.py`. |
