# TY8 -- box status for the exploratory per-key attribution run (R-RAW)

This note covers `ty8-windows-{1000,2000}p.json` and
`ty8-slow-vs-median-{1000,2000}p.json`, produced by `tools/notebook_ty8_tail.py --boot
--sizes 1000,2000 --chars 150`, run `r195210` (see each file's own `run_id`).

`python tools/gate_box_lock.py status` immediately before this run:

```
lock: HELD  C:\ProgramData\uct\gate-box.lock
pid 45260 since 2026-10-01T19:40:51 [int-w10] scripts/gate_shards.py --shards 6 --out ../gate_w11b
load: BUSY -- 5-10 marked process(es) (another lane's six-shard gate plus its own vitest workers)
```

**This run was NOT on a quiet box, and is not offered as a quiet-box reading.** It is
step 1 of the brief's METHOD -- per-key attribution to find WHAT runs on the slow keys,
not a timing verdict -- and the question it answers (which trace-event LABELS are
present on the slow decile and absent from the median band) is a structural, categorical
one: a V8 GC phase event (`V8.GC_MC_INCREMENTAL` and siblings) either fired on the
renderer main thread inside a given keydown-to-keydown window, or it did not. Background
CPU contention from another session's gate can change HOW OFTEN a window crosses an
allocation threshold and WHICH window happens to be slow, and can widen absolute
busy-ms values, but it cannot manufacture a V8-internal GC trace event that did not
actually run on this page's own renderer thread, and it cannot make `EventDispatch`/
`FunctionCall`/`Layout`/`Paint` self-time rows stop summing to the window's own busy
total (checked against `H.keystroke_busy_ms` in `per_window_breakdown`'s own cross-check
field, `busy_check_p50_ms`/`busy_check_p95_ms`, which land where the busy-box caveat
would predict -- higher than the quiet L15 reading in `../ty-l15-quiet/README.md`).

The formal A/B measurement (METHOD step 3, the fix's before/after busy-time table) is
recorded separately with `gate_box_lock.py status` at the START AND END of every run, per
the brief, and is NOT this file.
