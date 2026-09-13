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
