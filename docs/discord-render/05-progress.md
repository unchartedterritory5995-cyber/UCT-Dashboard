# 05 — Progress: numbers after every merge

One section per master merge: what shipped, the gate on the merged tree, the deploy as measured,
and the bench before → after. "Before" for every row is `02-baseline.md` (in-pod, closed market,
2026-09-13). A row with the V2 flag unset has no member-path latency change by construction; its
bench column says so rather than printing a re-run that measures the same code.

---

## Merge 1 — Phase 0 + dark 2.1 · `740b79ad5` · 2026-09-13 (Sunday)

**Shipped (dark):** program docs `00`–`03`, `LEDGER`; tools `discord_render_bench.py`,
`discord_render_forensics.py`, `railway_env_logs.py`; `api/services/discord_render/`
(ids, contract, jobs store, delivery, runtime, commands); router V2 branch; lifespan resume/release;
`fail_fn` hooks on the chart/flow jobs; 7 stale tests corrected; activity-row truncation fix.

**Gate on the merged tree** (`7f230fbe9`, after merging 29 master commits): 17 scoped files,
**494 passed, 1 failed** — the failure (`test_every_off_by_default_gate_is_declared`, four
`ALERT_TAXONOMY_*_DARK_ENABLED` gates) reproduced identically on a clean checkout of master's tip
`506eeee6d`: **inherited, 0 new**. flow-worker watch coverage `OK` (reachable 154, watched 24,
changed 26). Mutation proofs: 18 across three harnesses, all red, restores sha-verified.

**Deploy, measured:**

| Check | Result |
|---|---|
| `web` deployment on `740b79ad5` | SUCCESS 17:17:20 UTC (built 17:14:59 → 17:17:20) |
| Running commit, read in-process | `740b79ad52aa…`, then — after another session's push inside the window — `f34ce660b798b6ca5`, which contains `740b79ad5` (ancestor verified) |
| `/api/health` | 200; uptime reset (62 s on this deploy; 166–255 s on the superseding pod) |
| Interactions endpoint, bad signature | `401 invalid request signature` ×3, 0.18–0.43 s (one 502 during the other session's swap) |
| `DISCORD_RENDER_V2_ENABLED` in the running process | absent |
| flow-worker | SKIPPED (no tape gap) |
| `worker`, `bars-api` | rebuilt; superseded by `f34ce660b` SUCCESS |

**Bench before → after:** no change measurable by design — with the flag unset the member path is
the pre-V2 code (railed). The first flag-on bench row belongs to the canary in Phase 3/4.

**Member impact:** none visible (see `LEDGER.md` row 4).

---

## Merge 2 — 2.2 observability, dark · 2026-09-13 (Sunday)

**Shipped (dark):** `api/services/discord_render/observe.py` — scrubbed `drender` events (exceptions
through `observe.exception`, so a failed Discord edit cannot log the interaction token), SLOs from
the durable jobs table (5 min / 30 min / 1 h / 24 h / 7 d), the §3.9 alert rules, and the observer
thread (alerts to `DISCORD_RENDER_ALERT_WEBHOOK` with a durable cooldown recorded only after Discord
accepts, hourly `store.purge()`, a cached renderer reading); `GET /api/discord/render-health`; the
`/renderhealth` handler with a server-side admin check, plus `build_commands(renderhealth=True)` and
`register --renderhealth` (not registered); one stale test corrected.

**Gate on the merged tree** (`72cfddf87`, after merging 22 master commits): 13 scoped files,
**479 passed, 0 failed**. flow-worker watch coverage `OK` (reachable 154, watched 24, changed 14).
Mutation proofs: 18 on the branch tree, all red, restores sha-verified, control green.

**Deploy, measured:**

| Check | Result |
|---|---|
| Push | fast-forward `d6ac61816..6d779dd47`, 18:03:56 UTC; `web` SUCCESS and master 0 ahead immediately before |
| `web` deployment on `6d779dd47` | BUILDING 18:04:21 → DEPLOYING 18:05:48 → SUCCESS 18:06:09 UTC |
| Running commit, read in-process | `6d779dd47d1f` (`/proc/1/environ` of the running process) |
| `/api/health` | 200; uptime 33 s |
| Interactions endpoint, bad signature | `401 invalid request signature` ×3, 0.11–1.80 s |
| `GET /api/discord/render-health`, no bearer | `401 unauthorized` — the new route is live and gated |
| `DISCORD_RENDER_V2_ENABLED` / `DISCORD_RENDER_ALERT_WEBHOOK` in the running process | both absent |
| flow-worker | SKIPPED (no tape gap) |
| `bars-api` · `worker` | SUCCESS · SUCCESS (worker re-read after 18:07 UTC) |

**Bench before → after:** no change measurable by design — the flag is unset.

**Member impact:** none visible (see `LEDGER.md` row 6).

---

## Step 2.3 — chart-renderer, measured against real Chromium (branch, before merge 3)

`scratchpad/renderer_pool_smoke.py` on the owner's box: Playwright 1.58 / Chromium 145, the
service module loaded fresh per config, a **hermetic** `data:` page (a canvas of 200 bars, no
network), 960×500 @1×, 48 renders per config at concurrency 4, first-render costs excluded.
⚠️ Not Railway (Playwright 1.47, Linux, 8 slots) and not `/r/chart` over the network: this
separates the pool's effects from each other; it does not predict production latency. Production
reads come from `/health` (`p95_render_ms`, `pool_hits`) in the Phase 3 canary.

| Config | p50 | p90 | max | Pool hits / misses | Recycles | Boot warm |
|---|---|---|---|---|---|---|
| legacy (pool off) | 537 ms | 865 ms | 1,121 ms | — | — | — |
| pool, no spare contexts, recycle 500 | 534 ms | 816 ms | 914 ms | 0 / 48 | 0 | 1,772 ms |
| **pool, spare contexts, recycle 500** | **440 ms** | 787 ms | 1,249 ms | 16 / 48 | 0 | 1,311 ms |
| pool, recycle every 12 (worst case) | 593 ms | 1,039 ms | 1,565 ms | 0 / 48 | 3 | 1,496 ms |
| legacy again (drift control) | 535 ms | 963 ms | 1,017 ms | — | — | — |

- **Spare contexts: kept** — the one measured latency gain (−97 ms p50 against legacy, whose p50
  moved 2 ms across the run). §3.7 made keeping them conditional on a measured gain.
- **A recycle** costs little once the replacement is launched at retire time: +56 ms p50 at a
  recycle every 12 renders. The first smoke, before that change, launched Chromium on the next
  member's render and measured p50 1,732 ms at a recycle every 8 — the fix came from that number.
- **Background cap** under real concurrency (6 background + 6 member renders, 4 slots, 2
  background): at most **2** background renders at once; all 12 valid.
- **C-13 against a real Playwright error:** navigation to an unresolvable host with a token in the
  URL — the raw error message contained the token (control), `scrub()` output did not.

---

## Merge 3 — 2.3 web half (headers + scrub) · 2026-09-13 (Sunday)

**Shipped:** `ids.bind / background / carry / render_headers`; the V2 runtime binds each job; the
multi-chart pool carries the binding; the warm cycle marks itself background; house and buzz renders
send the headers and scrub the renderer's error body before logging it. `services/chart_renderer/app.py`
is in the commit but deploys separately (row 9).

**Gate** (`a69dfc574`; master had not moved since merge 2, nothing to merge): 25 scoped files,
**724 passed, 0 failed**. Watch coverage `OK` (changed 12). Mutation proofs 22/22 red.

**Deploy, measured:** *(filled from the running pod after the push)*
