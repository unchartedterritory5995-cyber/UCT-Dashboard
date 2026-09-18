# R63(c) AMENDED — cold loads never run on the event loop, and nothing gates the swap

## The design correction, and why it survived one more round of scrutiny

The original R63(c) was a preload barrier gated on a readiness endpoint. R68's finding —
Railway does not overlap deploys for a volume-mounted service, and gating *anything* on
readiness caused the 2026-07-26 outage — generalizes one layer down: a barrier *inside* the
app, holding every request until warm, reproduces the identical unresponsive-until-warm shape
even with Railway's healthcheck untouched. The corrected design has no barrier at all:

- preload runs in a background thread started at boot (`start_boot_preload`), so almost every
  request simply arrives after it's done;
- the rare request racing ahead of one resource `await`s that resource's own future
  (`asyncio.wrap_future`), which yields the event loop back to every other coroutine while it
  waits — the cost is scoped to the requests that need it, never to the whole app;
- a resource asked for before preload ever ran self-heals by submitting its loader on demand,
  still off the calling thread — preload is a head start, never a precondition for correctness.

Built: `api/services/discord_render/cold_start_guard.py`. Wired: `api/main.py`'s
`_start_cold_path_boot_preload()`, called at startup, registering the two `@lru_cache`-forever
resources both R63(a)'s scanner and the 2026-09-13 W1 incident independently named
(`cap_universe.symbols`, `cap_universe.etf_symbols`).

⛔ **Deliberately NOT wired:** `api.ticker_types.classify`'s underlying cache is TTL-refreshed,
not load-once — this mechanism solves "cold at boot," not "cold again every 24h on whatever
thread calls it next." Recorded as a known gap rather than silently claimed as covered.

⭐ **Populating the other ~500 modules / ~1,013 loader sites is not attempted here.** Most need
individual verification (safe to call with no request context? idempotent? side-effect-free?)
before they belong in a registry that runs unconditionally at every boot — that is R63(b)'s job,
not a one-pass guess.

## Rails

`tests/discord_render/test_cold_start_guard.py` (13 tests) + `test_cold_path_boot_preload_wiring.py`
(3 tests, proving `api.main` actually calls the mechanism — the "routing computed but never
applied" failure this repo has hit before). The load-bearing one:
`test_get_async_does_not_block_the_event_loop` — a slow loader runs concurrently with a ticking
counter coroutine; if `get_async` ever blocked the loop, the counter could not advance during the
wait.

## Mutations — 6/6 RED, sha256 verified identical after each

```
target=cold_start_guard.py  sha256=54751a83f65af9996e04f318778bcf48fd89127f4a3e7f855c33f4ac978e411f
CONTROL pristine                          13 passed
M1-sync-result-instead-of-await     RED   (the loop-blocking regression itself)
M2-preload-never-fires              RED
M3-self-heal-removed                RED
M4-exception-swallowed              RED
M5-two-authorities-allowed          RED
M6-double-load-under-race           RED
restored sha256 identical, MATCH=True
```

⚰️ **M2's first test was vacuous, and a mutation caught it before it shipped.** The initial
non-vacuity test for "preload works" asked whether a reader eventually got the right value —
which the deliberate self-heal property satisfies identically whether `start_boot_preload` ran
or was a complete no-op (mutating it to `return 0` left every other test green). Replaced with
`test_start_boot_preload_PROACTIVELY_invokes_the_loader_with_no_reader_asking`, which removes
the reader entirely and asserts the loader fires on preload alone.

## A methodology lesson, recorded rather than discarded

Mid-session I ran three ad-hoc reproduction loops plus the mutation harness **concurrently**
against the same sandbox worktree, chasing what looked like an intermittent test failure. One of
those concurrent runs surfaced `KeyError: 'AUTH_DB_PATH'` — a symptom of this repo's own
conftest census running under contention, not a defect in `cold_start_guard.py`. The clean,
single-process, uninterrupted run above (CONTROL + all 6 mutations, one after another, nothing
else touching the directory) is what stands as evidence; the confusing intermediate data is
disclosed here rather than silently dropped. Restated plainly: **"one gate at a time on this
machine" is this repo's own rule, written from three prior incidents, and I broke it debugging a
phantom of my own making.**

## Disposition

R63(c) **BUILT AND PROVEN**, not closed — it is infrastructure for the remaining cold-path
surface, not a completed audit of it. R63(b)/(d) remain: instrumentation to correlate real
production stalls against these (and future) registered resources, over real elapsed pod
boots — which needs production time to pass, not more code tonight.
