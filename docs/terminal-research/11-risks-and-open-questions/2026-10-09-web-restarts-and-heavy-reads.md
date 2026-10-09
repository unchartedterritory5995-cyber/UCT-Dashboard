# 2026-10-09: web restarts during terminal timing, and the two heavy reads behind them

## What happened

Between 19:25 and 19:40 UTC the production `web` process restarted three times with no deploy
in between (`/api/health` uptime reset; 502s for about a minute each time). Two changes had gone
live together at 19:25: terminal batch 2 (`6f6326a7d`) and a privacy update (`edf36e51d`).
Railway keeps only the last 500 log lines, all from the newest start, so the crash itself was
never seen.

Batch 2 was rolled back (`bdaa5ebf4`) per the deploy rule, roll back first. Before the rollback
landed, the batch-2 build ran **16.7 minutes clean** once the timing probes stopped. Every
restart had followed a burst of overlapping requests to `/api/scatter/universes` and
`/api/screener/meta` from one browser. Batch 2 was re-landed (`30b855f17`) with the first fix
below and ran clean.

## The two reads

| Endpoint | Cause (measured with the slow-build log lines) | Fix |
|---|---|---|
| `/api/scatter/universes` | `list_user_watchlists(user_id)` shipped every symbol of every list; on the admin account that includes the prebuilt index lists (~4,700 rows). Then `themes=9.2s`: `get_all_themes()` merges every owner and engine membership for a list of names. | `include_items=False` (`30b855f17`); `theme_db.get_theme_names()` (`c9278d6b3`) |
| `/api/screener/meta` | `filters=3.3s` of 4.1 s: distinct-value scans, list tokens and lift-ledger evidence rebuilt on every request | the member-independent filter list cached per snapshot vintage for 10 min (`c9278d6b3`) |

## Lessons

* Overlapping heavy reads from one admin browser were enough to tip a ~2 GB process. Time
  endpoints one at a time, and never in parallel against production.
* A hidden browser tab throttles timers, so in-page timeouts and waits there are unreliable;
  measure in a fresh tab or from the server log.
* `c9278d6b3`'s web build failed at Docker Hub (`python:3.12-slim-bookworm` metadata), not in
  code. `railway redeploy` refuses a failed deployment, and the master deploy gate refuses an
  empty commit (its secret scan needs a non-empty range), so a real change is the retry. This
  note is that change.
