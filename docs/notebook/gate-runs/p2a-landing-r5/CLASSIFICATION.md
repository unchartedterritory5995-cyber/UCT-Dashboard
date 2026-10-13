# Gate 5 (tree 4e85b893eb): classification of the four NEW rows

Manifest: `2026-10-13T09-49-59.md` / `.json`. VERDICT=NEW_FAILURES, new=4, test_files=3386, tests_failed=8,
reconciles=true. The box was NOT quiet: the gate's own preamble names a foreign pytest (pid 46336,
`tests/test_publish*.py`, another session's) running for the whole gate.

No row is banked in `gate-baseline.json`. None is P2a's.

## 1. `src/components/StockChart.smoke.test.jsx > ... > reports the drawn bar count to onDrawnBarCount`

`TypeError: timeScale.subscribeVisibleTimeRangeChange is not a function` at `PatternOverlay.jsx:72`, the same
signature as gate 4.

**MASTER-OWNED, INTERMITTENT. This corrects gate 4's classification ("order-dependent").** Gate 4's evidence
was one solo pass; one sample cannot tell order-dependence from chance.

- Solo on the gate tree `4e85b893eb`: exit 1. Tests 9 passed, but `Errors 1 error`: the same TypeError,
  surfacing as an UNHANDLED error after the test (vitest names this test as the last one documented).
- Solo on bare master `8f2b324a65` (worktree `notebook-p2-masterprobe`, no P2a commits), three runs:
  run 1 exit 1 (`1 failed | 8 passed`), run 2 exit 0 (`9 passed`), run 3 exit 1 (`9 passed`, `1 error`).
  Two of three red, with the identical TypeError.
- P2a touches nothing in its closure's chart half: `git diff --name-only origin/master...HEAD` over
  `app/src/components/chart`, `StockChart.jsx`, the smoke test, `app/src/test`, `vitest.config.js`,
  `setupTests.js` is empty.

Cause, for the chart workstream (F-SMOKE-ORDER, renamed in spirit to an intermittent): `PatternOverlay`
subscribes in an effect to a `timeScale` method the smoke's `lightweight-charts` mock does not provide; whether
the effect runs before teardown is timing.

## 2-4. Three chart-runtime census tests, `Test timed out in 15000ms`

- `src/components/chart/engine/runtime/__tests__/guardProbe.measure.test.js > PROBE > groups each guard by message shape`
- `.../objectLaneCallSites.measure.test.js > the call sites behind one guard > prints every script that dies on $GUARD, with its line`
- `.../objectLaneDrawerCensus.measure.test.js > the drawable ceiling ... > prints the ceiling and the per-guard drawer count`

**LOAD-SENSITIVE TIMEOUTS, not P2a.** Each re-run ALONE on `4e85b893eb`, exit 0: 1/1, 2/2 and 3/3 passed,
test time 9.85 s, 9.70 s and 10.07 s against a 15 s limit. Two thirds of the budget alone leaves no headroom
for a contended box, and this box was contended (above). All three were in shard 1 together. P2a touches no
file under `app/src/components/chart`.

Not banked: a timeout is re-run, never baselined.

## What happened next

Master moved again during the gate, to `8f2b324a65` (3 commits). Carry-over from this gate to the landing
tree `456fa274f7` (`carry-over-to-8f2b324a65.txt`): RE-GATE, C2 failed, for the second time on the same
edge: master's `app/src/agent/useAgent.js` and `app/src/agent/capabilities/workspace.js` import
`app/src/widgets/registry.js`, which P2a changes. That is the third supersession; per the standing rule the
landing STOPPED for an owner decision.
