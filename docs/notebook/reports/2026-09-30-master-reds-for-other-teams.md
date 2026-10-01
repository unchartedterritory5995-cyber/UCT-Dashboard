# Master reds found by the Notebook gates: for the charts, terminal, breadth and hub owners

Date: 2026-09-30. Found by the L12 and L13 six-shard gates and the checks around them.
None is in Notebook code. Each was read on the tree named beside it.
Evidence: `docs/notebook/gate-runs/wave10-L13-final/` (manifest, shard logs, `classification.md`, re-run logs).

## Red on master today

| # | Test | What it says | Whose | Last seen red on |
|---|---|---|---|---|
| 1 | `app/src/__tests__/entryExcludesChartEngine.test.js` (2 tests) | The entry chunk and the Notebook route statically reach `components/chart/engine/`. Chain: `main.jsx -> App.jsx -> components/Layout.jsx -> hooks/usePreferences.js -> components/chart/instanceShape.js -> components/chart/engine/legacyCotGroups.js`. The last edge is new in `aada122e0`. | Charts | `fb5a14bf0` |
| 2 | `app/src/pages/charts/VersionHistory.workspace.test.jsx` (3 tests, STATE-2) | A stored board that cannot be read. | Charts (TERM-051, `659c9c6f2`) | `fb5a14bf0` |
| 3 | `app/src/lib/context/symbolLinkChannels.test.js` > "no NEW surface reads a symbol/timeframe param by hand" | Names `testing/panes/paneHarness.jsx` (last touched by `20c58838c`, `8f5d9755b`). | Charts | `fb5a14bf0` |
| 4 | `tests/test_gate_shards.py::test_the_read_set_covers_every_root_relative_path_the_suite_reads` | A frontend test reads `api/services/workspace_doc_store.py`, which is not in `GATE_READ_PATHS`. | Terminal (TERM-021) / the gate's owner | `fb5a14bf0` |
| 5 | `tests/test_shared_data_root_guard.py` (2 tests) | 7 `/data` literals no env var can move (expected 0), and 13 unguarded sites (ceiling 8). | Breadth V2, hub reports, economic data | L14 `49e8a124b` (= master `a680b0d40` + lanes) |

| 6 | `app/src/hooks/pollingSites.rail.test.js` (full-suite-only rail) | `pages/research/tabs/OptionsChainTab.jsx: 1 (listed 0)`: a bare `useSWR` poll with no census entry, added by `017f40d938` (BRK-01 option chain). | Terminal / research | lane PF's run on `ad7efc93a` + its change (file untouched by the lane) |

What each one costs until fixed:

1. Every route, the Notebook included, loads those chart-engine modules in the entry chunk. The test's own remedy is a dynamic `import()` at the edge nearest the shell.
2. Every gate reports three NEW rows that have to be classified by hand.
3. The same: one NEW row per gate. Remedy named by the test: route the read through `readChartsLink`, or add the file to `HAND_TYPED_BASELINE` with a reason.
4. A gate verdict can be carried across a change to that file without anyone noticing.
5. On this box `/data` is `C:\data`, the live files. A test or tool that reaches one of these paths touches them (the tripwire fails the run). The seven literals:
   - `api/services/breadth_v2_producer.py:44-47`: four real paths (`FROZEN_ON_RUNNER`, `SEED_LEDGER`, `SEED_GROUPED`, `PINNED_UCT`).
   - `api/services/hub_reports.py:33`: `/data/hub_reports.db`. Its comment says the census pins it; it does not.
   - `api/services/econ/adapters/eia.py:330` and `fed_ddp.py:605`: URL fragments (`.../data/`), not file paths. False positives, but they still redden the guard.

   Lane DR of this session is fixing item 5 on `feat/notebook-w10-dr` with the repo's standard remedy (an env override whose default is the existing literal). It will land with L14 unless an owner objects.

## Fixed in passing (#259)

- `app/src/hub/rule12Paths.test.js` threw `spawnSync git ENOBUFS`: `git ls-files` printed 1,050,169 bytes on master `f912aaa9c`, past Node's 1 MiB default. `maxBuffer` raised in `dad9c002f`.
- `api/services/journal_two/test_calendar.py::test_calendar_marks_expiring_strategies` failed on the last day of each month.

## Load-sensitive (pass alone on a quiet box, red inside a busy gate)

Seen in the L13 gate at `8588ad1b1`, each passed alone at 20:30 with `load: QUIET`:

- `components/chart/engine/runtime/__tests__/guardProbe.measure.test.js`
- `components/chart/engine/runtime/__tests__/objectLaneCallSites.measure.test.js`
- `components/chart/engine/runtime/__tests__/objectLaneDrawerCensus.measure.test.js`
- `lib/presentation/presentationSingleFormatter.test.js` > "nothing outside lib/presentation imports formatPercent from S10"
- `pages/command/keyListenerCensus.test.js` > NON-VACUITY
- `lib/context/symbolLinkChannels.test.js`: four more of its tests timed out at 15 s on a busy box.

Each walks or parses the whole tree inside one test. A longer per-test timeout, or one shared parse per file, would stop them showing up as NEW rows.
