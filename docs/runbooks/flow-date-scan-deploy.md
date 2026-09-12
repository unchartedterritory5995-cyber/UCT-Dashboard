# Deploy notes — `FLOW_FAST_DATE_SCAN` (branch `perf/flow-date-scan`)

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
