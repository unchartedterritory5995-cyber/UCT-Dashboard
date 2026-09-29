# Wave Q1 — gate verdict

VERDICT: **KEEP**
at:        2026-09-28 14:34 ET
heartbeat: Last Run Time 9/28/2026 12:00:01 PM | Last Result 0
rows read: 22 (1 skipped)
⚠️ 1 SKIPPED row(s) - those intervals were UNOBSERVED, not clean.
  (2026-09-26 19:00 ET .. 2026-09-28 13:00 ET)
member:    1 ORGANIC MEMBER IDENTITY(S) - see the log
POPULATION: organic members exposed = 1  |  synthetic = 1  |  rig/owner = 0  (counted by distinct identity, never summed)
do-not-build: CLEAN - DO-NOT-BUILD sweep -- 20 item(s) checked across app/src, api, scripts, tools

| trigger | result |
|---|---|
| 1 · unexplained red | PASS - 20 FOREIGN row(s) recorded below, not blocking |
| 2 · unattributable fork | PASS |
| 3 · outbox stuck >5 min | PASS - canary `sunday-canary` @ 2026-09-27T20:00:00Z queued real work offline and the queue SETTLED (outbox 0, mini-canary 11/11 green). ⚠️ A canary run is minutes long, so this evidences that the drain does not strand work - it is not a five-minute observation |
| 4 · member console error | PASS |

## Foreign console errors - RECORDED, not blocking

Triggers 1 and 4 both filter by OWNERSHIP of the failing request, not by severity (owner rulings 2026-09-14). Every error on these rows came from an endpoint the Notebook does not issue, so they do not say REVERT - and they are named in full, because a hole that is invisible is worse than one that is attributed.

- 2026-09-26 19:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest
- 2026-09-26 21:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest
- 2026-09-26 23:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest
- 2026-09-27 01:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 03:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest
- 2026-09-27 05:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest
- 2026-09-27 07:00 ET - https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest, https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 09:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest
- 2026-09-27 11:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 13:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 15:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 17:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 19:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 21:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-27 23:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/live-prices?tickers=AUGO
- 2026-09-28 01:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-28 03:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-28 05:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-28 09:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO
- 2026-09-28 11:00 ET - https://uctintelligence.com/api/stream/prices?tickers=AUGO, https://uctintelligence.com/api/intradaypack/manifest, https://uctintelligence.com/api/barspack/manifest

- This file does not merge anything. A REVERT verdict is a reading for a person
  to act on: merge the draft rollback PR for
  `rollback/notebook-offline-default-off` @ `3db89e205` with a MERGE COMMIT,
  then verify `offlineFlag.js` reads `false` on `origin/master` and that `web`
  redeployed. Full procedure: `docs/notebook/wave-q1-sunday-gate.md`.
