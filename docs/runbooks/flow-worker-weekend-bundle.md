# Deploy notes — flow-worker weekend bundle (branch `perf/flow-date-scan`)

`api/flow_db.py` is on flow-worker's watch list, so this deploy RESTARTS the OPRA
consumer and gaps the tape permanently until the T+1 flat file. **After-hours or
weekend only.** (The Mon–Fri push freeze is rescinded — see CLAUDE.md, 2026-09-11.
The tape gap is a physical constraint, not the rescinded policy.)

Ship as part of a bundle; do not spend a tape gap on this alone.

## Checklist

- [ ] `railway variables --service flow-worker --set "FLOW_FAST_DATE_SCAN=1"`
- [ ] Verify a NEW BOOT (startup line stamped after the `--set`), not the CLI echo.
      `--kv` shows the service's config, not the running process's env.
- [ ] Confirm in-process: `os.environ.get("FLOW_FAST_DATE_SCAN")` over `railway ssh`.
- [ ] **Measure the roll-level effect from the ledger, not from a projection.**
      Read `rolls_steady[]` at `/api/flow/aggregate-health` and compare `prepare_ms`
      against the pre-flag baseline recorded 2026-09-11:

          prepare_ms   min 5,204  p50 6,199  max 9,228  mean 6,544   (n=25, flag OFF)

      Projected with the flag on: p50 ≈ 4,800 ms. **Projected, never measured** — the
      1.3461 s → 0.0050 s figure is measured on prod data directly, but its effect on
      a whole roll is arithmetic until this row is filled in.
      Measured p50 with flag ON: ______  (n=____, date ______)
- [ ] Exclude `rolls_startup[]`; a generation predating the process is
      `startup_catchup`, not a roll.
- [ ] Rollback: unset the var. It is a RUNTIME var on flow-worker (not a Vite
      build-time var), so unsetting + restart is sufficient — no rebuild needed.


---

# Bundle contents — ONE redeploy, ONE tape gap

| # | component | commit | ships as | rollback |
|---|---|---|---|---|
| 1 | date-scan (`_resolve_dates` loose index scan) | `535311c80` | code + **flag OFF** | unset `FLOW_FAST_DATE_SCAN` (no rebuild) |
| 2 | parts guard: "what was REQUESTED" | `f65e5ab67` | code, **always on** | `git revert f65e5ab67` |
| 3 | roll-ledger slot attribution | `7981a46c6` | code, **always on** | `git revert 7981a46c6` |
| 4 | `ORDER BY CreatedDate, id` | — | **NOT INCLUDED** | awaiting owner go |

Components 2 and 3 are independently revertable and touch disjoint files
(`api/services/flow_aggregate.py` vs `api/flow_router.py`). Component 1 is a flag,
so it needs no revert to disable.

## Why this deploy is worth a tape gap
Component 2 is not an optimisation — it restores one that has never worked.
Measured on prod 2026-09-11: the preparer's pass 2 discarded **18,971,776 bytes of
nine valid frames every roll**, so the deferred `TICKER_DB`/`CONV` split and the 3b
raw fallback were never pre-warmed and the first member interaction after each
version roll paid a full ~5.8 s build. No member saw an error, which is why it ran
for 889 rolls unnoticed.

## Post-deploy verification (component 2)
- [ ] `/api/flow/aggregate-health` → `parts.entries` grows beyond
      `['bootstrap','TOP_PICKS']` to **10 entries** (bootstrap, TOP_PICKS,
      all_trades, all_directional, WATCH, ALL_SYMS, UOA_TRADES, darkPool,
      TICKER_DB, CONV). Cap is 24, so no eviction pressure.
- [ ] `build_failures` **stops incrementing** on each prepared roll. Sample the
      counter twice across ≥2 rolls; the pre-fix ratio was 885 failures per 889
      prepared.
- [ ] `parts_rejected_missing` stays **0**. A non-zero value means a stream really
      is short a requested part — a different bug, and now a visible one.
- [ ] Confirm no OTHER counter changed meaning: `prepare.failed` still means
      "pass 1 raised" and was deliberately not widened.

## Post-deploy verification (component 3)
- [ ] `rolls_steady[]` entries carry `blocked_by` / `blocked_pass` /
      `blocked_held_ms`. Expect **null on most rolls** — 22 of 25 were unblocked
      pre-fix; a field populated on every roll would mean the snapshot is being
      read at the wrong moment.
- [ ] Collect a full RTH session Monday, then test the standing hypothesis: the
      4.4 / 8.2 / **15.2 s** handoff outliers are pass-2 lock hold plus something
      else. One tick was ~11.7 s (pass 1 ~6.2 s + pass 2 ~5.5 s), so ~3.5 s of the
      15.2 s roll is unexplained. `blocked_by` should name it — or show the slot
      was free, which kills the hypothesis outright.

## ⛔ Deploy window
`api/flow_db.py`, `api/flow_router.py` and `api/flow_worker_main.py` are all on
flow-worker's watch list, so this redeploys flow-worker and **gaps the OPRA tape
permanently until the T+1 flat file**. After-hours or weekend only. Separately,
the standing rule is **no master push of any kind Mon–Fri 09:00–16:00 ET**, docs
included — a master push redeploys web, worker, bars-api and flow-worker in
lockstep. (A CLAUDE.md line claims that window is rescinded; the owner has stated
it is wrong and will reconcile it. Treat the freeze as in force.)
