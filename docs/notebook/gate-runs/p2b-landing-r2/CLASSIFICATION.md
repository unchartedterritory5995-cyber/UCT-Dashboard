# P2b landing gate r2 — classification

Gate: `scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/p2b-landing-r2` in worktree
`notebook-p2b-gate` at tree **`4f0b86e5fd`** (the landing tree: fix round 3 `514d1a09c1`, lane B
merge `b1b80b4624`, master `66cd9fe126` merged in). `tree_head_start` = `tree_head_end` =
`4f0b86e5fd`. Manifest `2026-10-13T19-24-55.md` / `.json`, shard logs `shard-1..6.log`, copied here
unchanged from the gate worktree. Box lock acquired, no bypass. `app/node_modules` a junction to
`_nb-shared-install` (377 entries).

**Verdict line:** `VERDICT=NO_NEW_FAILURES exit=0 new=0 no_longer_failing=125 expected_red_seen=0
expected_red_stale=0 expected_red_unexplained=0 test_files=3403 tests_failed=4 reconciles=true`.
Every shard's parsed identities equal its `Tests N failed`; the file count reconciles (3,403 on disk).

## The four failing rows — all in the baseline

- `src/lib/panelContract.rail.test.js` (TERM-024 (a))
- `src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js`
- `src/pages/terminal/formControls.terminal.test.js`
- `src/utils/jsonFetcher.test.js`

None is NEW, so none needs classifying against this branch. r1's one NEW row
(`BarReplay.theme`, load-sensitive) did not fail here.

## no_longer_failing = 125

Baseline rows that did not fail here, the same 125 as r1. The baseline is stale; this is for the
next baseline refresh, not this branch.

## §8 DO-NOT-BUILD sweep

The same two matches as r1, both outside this branch's diff: `components/chart/engine/runtime/objectStore.js:158`
and `utils/webPush.js:106`.

**Gate on `4f0b86e5fd`: green, 0 NEW.**
