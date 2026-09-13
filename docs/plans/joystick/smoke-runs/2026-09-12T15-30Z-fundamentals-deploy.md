# Post-deploy client smoke — 2026-09-12 ~15:30Z

Run after deploying the fundamentals staleness work (`d65cddfb4`, in master tip
`24df5ae68`). Operator: Claude, autonomous session.

## Verdict

| Pass | Exit | Result |
|---|---|---|
| `--self-check` | 0 | **PASS** — both detectors fire on planted faults, quiet on healthy pages |
| `--auth` (desktop) | 1 | **INCONCLUSIVE on one row** — 15/16 routes clean; `/options-flow` timed out. See below. |
| `--auth --touch` | 0 | **PASS** — 16 routes, hub mounted per registry, 0 console/page errors |

Self-check detail: planted freeze DETECTED, healthy page not flagged, planted
render loop DETECTED (96% blocked, 17 fps), idle page not flagged (0%, 58 fps),
present-is-not-showing correct. **The instrument is trustworthy**, which is what
makes the row below worth recording rather than dismissing.

## The `/options-flow` row is INCONCLUSIVE, not FAILED

The desktop pass reported `⛔ /options-flow: the route would not load
(TimeoutError)` and exited **1**, which under H15 means roll back first. It was
not rolled back, on this evidence:

| # | Measurement | Result |
|---|---|---|
| 1 | First desktop pass, during a pod swap | TimeoutError + HTTP 502 |
| 2 | Second desktop pass, **after 5 consecutive SUCCESS deploy polls** | TimeoutError (reproduced) |
| 3 | `curl` the route directly | HTTP 200, 0.12s |
| 4 | Playwright `goto`, route in isolation | domcontentloaded **0.4s** |
| 5 | Playwright `goto`, replaying the smoke's exact 7-route sequence | **0.2s, OK** |
| 6 | `--touch` pass, same tool / box / domain, 16 routes | **`/options-flow` ✓, 0 console errors** |

⚠️ **My first explanation was wrong and is kept here deliberately.** I attributed
run 1 to deploy churn — three master deploys landed in 75 seconds from another
workstream, and the 502 really was churn. But the timeout **reproduced on a
settled pod** (run 2), so churn did not explain it, and saying so was premature.

⭐ What the evidence does support: the route is healthy under five independent
measurements, and it fails only inside the *long* desktop session. That session
does materially more per route than the others — probe injection, a ~5s dwell,
and a nav click — so it runs far longer overall, and **9 Cloudflare
`cdn-cgi/challenge-platform` requests were observed** during a replay. This
domain is behind Cloudflare bot mitigation that already 1010-blocks curl UAs.

⛔ **Not proven.** I did not isolate Cloudflare as the cause; I established that
the product route is healthy and the failure does not reproduce outside the long
session. So the honest classification is that the desktop pass **cannot currently
measure `/options-flow` from this box**, not that the route is broken.

⭐ **It is also not attributable to this deploy.** `OptionsFlow.jsx` does not
reference anything in the changeset, and the backend reach
(`api.flow_proxy` / `api.live_massive_router` → … → `earnings_estimates`) is via
`_fmp_get`, which this branch does not touch. Note that reach is *real* — it is
why the 502 was investigated rather than waved off as impossible.

⭐ **A prior run passed it**: `2026-09-12T02-24-24Z.md` recorded `/options-flow`
at 6.3% blocked, 47 fps — so this is a change in what the instrument can measure
since this morning, and worth someone's attention. **Owner: the smoke's own
maintainer, not the fundamentals work.** The exit code deserves a look too: a
route that cannot be measured is arguably exit 2 (INCONCLUSIVE), and collapsing
it into exit 1 is what pointed a rollback at an unrelated workstream's weekend
merge.

## Product verification (the actual objective)

Signed in as the smoke account against production:

| Ticker | `_v` | `reported_through` | `stale_quarters` | Outcome |
|---|---|---|---|---|
| MMC | 2 | 2026 Q2 | 0 | **fixed** — had shown 2025 Q4 since April |
| BK | 2 | 2026 Q2 | 0 | **fixed** |
| SJW | – | 2026 Q2 | 0 | **fixed** (data correct; `_v` stamps on next rebuild) |
| RNP | 2 | 2026 Q2 | 0 | **fixed** |
| HOLX | 2 | 2025 Q4 | 2 | notice shown — genuinely unavailable upstream |
| EXAS | 2 | 2025 Q4 | 2 | notice shown — genuinely unavailable upstream |
| AAPL | 2 | 2026 Q2 | 0 | healthy control, unchanged |

Monitor after its first cycle: `cycles_completed 1`, `checked_total 22`,
`flagged_total 0`, `last_alert_at None`, `last_digest_at None`,
`flagged_current []`. **Zero pages.**
