# Wave 10 L9 (lane R1d, rollback chain through L8): classification

Landing tree: `cfdf6c48f7c0e67a1ae84a6e196651c6c6e43d7b` (`feat/notebook-w10-r1d` after merging origin/master).

## Why no six-shard vitest re-gate

Outside its evidence dir (`docs/notebook/evidence/rollback-rehearsal-2026-09-29-r1d/`), the
landing touches only `docs/notebook/wave5-rollback.md`, `tests/test_notebook_rollback_chain.py`
and `tools/notebook_rollback_chain.py`. Nothing under `app/`, no config, no package file,
so the vitest gate reads no input this landing changes. Same basis as L6 and L8.

## Python (C4-Python, on the landing tree)

`python -m pytest tests/test_notebook_rollback_chain.py -q`: **25 passed** (`pytest-l9.log`).

## The chain's state after landing

MEASURED_AT = `6f563c158` (L8). CHAIN now names L6, L7 and L8. Each new step was rehearsed
on a sandbox (CLEAN at every checkpoint). Mutation proof: 5/5 killed
(`evidence/rollback-rehearsal-2026-09-29-r1d/mutations-r1d.log`).

`--check --from origin/master` on this tree reads **stale for two commits that landed after the
measurement**. The integrator reviewed both and neither is a Notebook landing:

- `df82f7a1e`: a revert of `a3afa840d` (another workstream's wave-3 integration merge). It
  touches `journal-2-0/lib/widgetEmbedCore.js` and its test, plus Pine/indicator files.
- `da7d23f49`: perf(clock), market-calendar compaction. It touches `lib/marketClock/` and
  `vite.config.js`.

These go to REVIEWED_NOT_LANDINGS at the next re-measurement, which also re-records the pins
from that tip. They are not chased here: master moved four times during this lane, which is
the "a measurement longer than the gap between disturbances cannot complete" case.
