# R63(b) — durable cold-path instrumentation, composed into R63(c)

## What it is, and why durable

`api/services/discord_render/cold_path_instrument.py` wraps a cold-path call span
(`with observe_cold_call(name):`) and appends `{at_start, at_end, name, duration_ms, thread,
is_loop_thread, ok, pid}` to an append-only JSONL on the volume — same idiom as
`stall_record.py`: own env var (`COLD_PATH_INSTRUMENT_PATH`), `/data` default written as an
inline literal (the `conftest.shared_data_root_census` AST-derivation shape), bounded to
`MAX_RECORDS`, atomic tmp+replace writes.

⛔ **Durable, not a ring buffer, for the same reason `stall_record.py` already paid for**:
`web` redeploys ~20x/day and the longest pod life measured was ~45 minutes. In-memory state
is erased before R63(d)'s "join over the next 10 pods" could ever read it.

## Composed into R63(c), not left as a separate opt-in

`cold_start_guard._run_one` now wraps every registered loader's actual execution in
`observe_cold_call(name)` — any resource wired through the R63(c) mechanism gets durable
telemetry automatically, with zero additional wiring per resource. This is deliberate:
instrumenting only matters if something is actually instrumented, and composing it into the
mechanism that's already being extended (rather than requiring a second registration step per
call site) means the two don't drift apart the way two independently-maintained lists would.

## The join — pure, and it reports the negative finding too

`join_with_stall_record(cold_calls, stalls)` compares wall-clock interval overlap (not uptime —
this instrument and `LoopWatch` share no clock, and inventing a second "since boot" timer here
would be a second authority the moment the two disagree). ⭐ **Every stall is returned, joined or
not** — a settled-pod stall with an empty `joined_calls` list is R63(d)'s actual finding ("this
stall has no cold-path cause"), not a row to filter away. Dropping it would look like clean
evidence for the wrong reason.

## Rails and mutations

13 tests (`test_cold_path_instrument.py`) covering recording on success/failure, loop-thread
detection, boundedness, non-vacuity for the append-failure path, and the join's four properties
(overlap match, unjoined-not-dropped, every-stall-present, boundary padding, unparsable
timestamp reported not skipped). One composition test in `test_cold_start_guard.py` proves
`cold_start_guard`'s own preload produces a `cold_path_instrument` record.

```
target=cold_path_instrument.py  sha256=82b370850c4651a52a09de2475a7378f1130efea38f52eec4f64cec104cae967
CONTROL pristine                              13 passed
N1-failure-not-recorded                 RED
N2-append-not-swallowed                 RED
N3-loop-thread-always-true              RED
N4-unbounded-record                     RED
N5-stall-dropped-when-unjoined          RED
restored sha256 identical, MATCH=True
TOTALS mutate_cold_path_instrument mutations=5 red=5 not_red=0
```

⚰️ **N1's first draft hung the harness, and the cause is worth recording.** The mutation
inserted `if not ok: return` at the top of the `finally` block to skip recording on the
exception path. `return` (or `break`/`continue`) inside a `finally` block **silently
discards any exception currently propagating through it** — a documented CPython gotcha, not
a bug in the harness. Because `observe_cold_call` is a `@contextlib.contextmanager` generator,
swallowing the thrown-in exception this way makes the generator appear to complete normally,
which `contextlib`'s protocol reads as "`__exit__` suppressed the exception" — so
`pytest.raises(RuntimeError)` never saw the exception it expected, and something downstream of
that mismatch stalled rather than failing cleanly. Replaced with a mutation that hardcodes the
recorded `"ok"` field to `True` instead of touching control flow — no `return`/`break`/`continue`
inside a `finally` block, ever, in a mutation targeting generator-based code.

## Disposition

R63(b) **INSTRUMENTATION SHIPPED**, not closed. The correlation R63(d) needs — "boot-window and
settled-pod stalls >= 3s = 0 over >= 10 pods, or each joined to a named non-cold cause" — needs
real elapsed pod boots to accumulate data against; that is calendar time passing in production,
not more code tonight. `snapshot()` and `join_with_stall_record()` are ready to run against
`stall_record.snapshot()`'s output the moment there is enough of both to compare.
