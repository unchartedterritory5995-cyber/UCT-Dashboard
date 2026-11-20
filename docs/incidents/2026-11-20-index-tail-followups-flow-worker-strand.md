# Flow-worker strand: the 2026-11-20 index-tail follow-ups (D9, A0, the tier-down shed)

**Classification: all three files are INERT STRANDS on flow-worker. No flow-worker redeploy.**

This is the review a red from `tools/flow_worker_watch_coverage.py` requires (`docs/runbooks/deploy-windows.md`).
The changes it reviews are the three follow-ups to `docs/incidents/2026-11-20-index-intraday-tail-goes-back.md`,
on branch `fix/index-tail-vendor-lag-and-web-fallback`.

## The check

`python tools/flow_worker_watch_coverage.py` (base `origin/master`), 2026-11-20:

```
FAIL - flow-worker RUNS these files but will NOT redeploy for them:
    api/index_bars.py
    api/routers/bars.py
    api/services/bars_fetch.py
```

## Why each is inert there

The shortest import chains were computed with the coverage tool's own AST helpers (BFS from
`api.flow_worker_main`):

| file | how flow-worker reaches it | what flow-worker uses | changed here |
|---|---|---|---|
| `api/services/bars_fetch.py` | `flow_worker_main -> flow_gap_autofill -> services.liveflow_monitor -> services.bars_fetch` | `_NYSE_HOLIDAYS_YYYYMMDD` only (`liveflow_monitor.py:107`) | `_intraday_deblockable` |
| `api/routers/bars.py` | `flow_worker_main -> auth_surface_check -> open_reads_gate -> auth_service -> auth_db -> journal_two.db -> template_gallery -> notebook_widgets -> discord_render.symbols -> routers.bars` | symbol helpers, at import | `get_bars` fallback, `_tier_down_cold_tail` |
| `api/index_bars.py` | `... -> discord_render.symbols -> index_bars` | `is_index` | `_copy_behind_since_saved`, `_cached_series` |

- flow-worker mounts no `/api/bars` route and starts no index warm loop (`api/flow_worker_main.py`:
  "consumer + flow routers only (no bars prewarm)"). No flow-owned module calls any changed function: 0 calls
  across the 47 flow-owned modules it reaches.
- Both switches the changed code reads are unset on flow-worker (read with `railway variables`, filtered to
  these keys, 2026-11-20): `BARS_INTRADAY_ASYNC_HEAL`, and `BARS_PROXY_ENABLED` / `BARS_ORIGIN_URL`.
  So `_intraday_deblockable` returns at its flag check before the changed lines, and the tier-down shed sits
  behind the proxy gate.

## The services that do pick it up

- `bars-api` and `web` both deploy from `production`. They take the fix at the next promotion, which the
  deploy freeze holds to outside 09:20-16:15 ET.
