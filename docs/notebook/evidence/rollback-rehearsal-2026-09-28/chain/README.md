# Rollback chain, objects only (lane R1, 2026-09-28): raw

Written before any sandbox ran and before any reading of the results (R-RAW). No verdicts here.

- `chain.py`: the cumulative newest-first revert chain from `origin/master` `38bb9a421`. Each step
  is `git merge-tree --write-tree --merge-base=<squash> <prev> <squash>^` (a revert as a three-way
  merge), then the recorded rules, then `git commit-tree`. No worktree, no index but a temporary
  `GIT_INDEX_FILE`, no ref moved. Rules applied at every step:
  - paths under `docs/`, `tools/`, `scripts/` and the file `CLAUDE.md` are reset to the previous
    step's copy (by induction, the tip's);
  - both schema tables (`notebookSchema.js`, `notebook_schema.py`) are reset to the tip's copy if
    the step changed them;
  - product conflicts are resolved only by an entry in `rules.json`; an unlisted conflict stops
    the chain.
  After the wave-5 revert it cherry-picks the guard commits `8167f7aa0` and `fd87271fd`
  (tags `notebook-wave5-guard-*`). `82c56dd63` is merged but not applied (`MEASURE_ONLY`).
- `rules.json`: every product-conflict resolution, per squash and path.
- `chain-primary.jsonl`: the chain with the server hotfixes #204 (`2ab637644`) and #203
  (`c6a8a9d3a`) KEPT (`R1RB_SKIP=2ab637644,c6a8a9d3a`).
- `chain-strict.jsonl`: every Notebook landing reverted, hotfixes included.
- `chain-keepallhotfix.jsonl`: #225 and #201 kept as well; it stops at wave 8.
- `step-table.md`: `python table.py chain-primary.jsonl chain-strict.jsonl chain-keepallhotfix.jsonl`.
- `sha-verification.txt`: every SHA checked against `git log`, and the two landings (#225, #201)
  the controller's list did not name.
- `82c56dd63-cherry-pick-conflict-hunks.txt`: the five conflicts of the third guard commit.
- `82c56dd63-all-ours-leaves-undefined-names.txt`: the names that commit's clean hunks use and
  its conflicting hunks define.

The scratch commits exist only as unreferenced objects in the worktree's repository. The TREE
ids are deterministic for the same inputs; the commit ids are not (they carry a timestamp).

## Round 2 (after the sandbox rehearsal)

- `chain-primary-r2.jsonl`: written by `tools/notebook_rollback_chain.py --from 38bb9a421 --through wave5`.
  The only change from round 1 is that the schema tables' two rails
  (`notebookSchema.rail.test.js`, `tests/test_notebook_schema_guard.py`) are also kept at the tip.
  - In round 1, the wave6 and wave5 trees reverted those rails while keeping the tables, and the
    in-tree check list went red on them (`../sandbox/p12-*`, `../sandbox/p13b-*`, `verify-*.log`).
  - Steps L1c..wave7 have identical trees in both rounds. Round 2's wave6 and wave5 trees differ
    only in those two test files (`git diff --stat ed39987898 bfb45998cd`,
    `git diff --stat 900580af63 832bd5b759`).
  - `tests/test_notebook_rollback_chain.py` rebuilds round 2 tree for tree.
