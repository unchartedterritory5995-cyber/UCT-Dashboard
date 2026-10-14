# P2b landing gate — classification

Gate: `scripts/gate_shards.py --shards 6` in worktree `notebook-p2b-gate` (branch `notebook-p2b-gate`,
a `notebook-*` name for rule 12) at tree **`e7e4981d26`**. Manifest `2026-10-13T16-59-04.md` / `.json`,
shard logs `shard-1..6.log` (copied here unchanged from the gate worktree).

Box at start: gate lock FREE, load QUIET, 14,252 MB available, `app/node_modules` a junction to
`_nb-shared-install` (377 entries).

**Verdict line:** `VERDICT=NEW_FAILURES exit=1 new=1 no_longer_failing=125 expected_red_seen=0
expected_red_stale=0 expected_red_unexplained=0 test_files=3400 tests_failed=5 reconciles=true`.
Every shard's parsed identities equal its `Tests N failed`.

## The one NEW row

`src/pages/journal-2-0/components/notebook/BarReplay.theme.test.jsx > the replay chart follows the
theme > in the light theme the chart is drawn in the light tokens` (shard 3):
`TypeError: Cannot read properties of undefined (reading 'layout')` at line 55, `made.chart[0]`
undefined: the mocked chart had not been created when the assertion ran.

- **Disjoint from this branch.** `BarReplay.jsx` imports `react`, `lightweight-charts`,
  `components/mobile/Sheet`, `components/ui/UIcon` and its own CSS module; the test imports only
  `BarReplay`. `git diff --name-only 2d4c93293c..e7e4981d26` (merge base with master .. gated tree)
  names none of them.
- **Green alone, four times, on the gated tree:** 3 passed (3) each run.
- **Classified: load-sensitive, not this branch's. Not banked** (a load-sensitive row is never added
  to the baseline). The assertion reads the chart before a mount completed; under the full-suite
  load the mount had not happened in time.

## no_longer_failing = 125

Rows in the baseline that did not fail here (fixed on master since the baseline, or the gate tree
differs). Not this branch's to classify; recorded for the next baseline refresh.

## §8 DO-NOT-BUILD sweep

Two matches, both outside this branch's diff: `components/chart/engine/runtime/objectStore.js:158`
(`kind: 'delete'`) and `utils/webPush.js:106` (`navigator.serviceWorker.register`). Neither file is
in `git diff --name-only 2d4c93293c..e7e4981d26`.

**Gate on `e7e4981d26`: green for P2b.**
