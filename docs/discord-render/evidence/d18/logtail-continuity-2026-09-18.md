# D-18 addendum item 3 — does the 30s log-tail poll lose anything?

**Question, verbatim (D-19 addendum 2):** *"since `railway logs` dumps-and-exits, prove the 30s
poll loses nothing... compare consecutive dumps for overlap by timestamp across one hour on both
services; any window with zero overlap is a gap record, and the backoff drops to the value that
yields continuous overlap (bounded by the 2GB/72h budget, re-derived)."*

## Method

`docs/discord-render/evidence/logs/logtail-events.jsonl` records a `stream_started` event (wall
clock) at the start of every `railway logs` invocation, for both services independently. Combined
with the per-line timestamps already inside the captured `.log` files, this gives two independent
views of the same ~2.5h window (11:22–12:50Z, 2026-09-18): how often the daemon actually polled,
and what content-time gaps exist in what it captured.

⛔ **A real bug found while building this evidence, fixed before trusting it further:** the two
`TailWorker` threads (`web`, `flow-worker`) both append to `logtail-events.jsonl` with no lock.
On Windows this interleaves mid-line — one corrupted record was found and confirmed byte-for-byte
(`{"t": "...", "gap": "spawn_failed", ...` immediately followed by a second object's tail with no
newline). A resilient decoder (skip-and-resync) recovers 598 of 599 objects for THIS analysis, but
the daemon now holds a `threading.Lock` around every write so future evidence doesn't need one.
Task restarted to pick up the fix (stale `.logtail.lock` cleared by hand first — a
`schtasks /end` kill doesn't run the daemon's own unlink-on-exit).

## Cycle cadence (from the events ledger, resilient parse)

| service | cycles observed | spacing min/avg/median/max (s) |
|---|---|---|
| web | 146 starts, 150 ends | 31 / 35.4 / 32.0 / 114 |
| flow-worker | 150 starts, 150 ends | 31 / 34.5 / 32.0 / 96 |

Matches the configured 30s backoff plus real subprocess overhead (spawn + `railway logs`' own
2-7s dump-and-exit). No systemic drift.

## Content-gap analysis (from the captured `.log` files directly)

For each service, every DISTINCT second that appears in any captured line, across both hourly
files, sorted; the largest gap between consecutive distinct seconds is the worst-case blind spot
in what was captured, independent of the polling cadence.

| service | distinct timestamped seconds | max gap | where |
|---|---|---|---|
| web | 1,348 (of ~5,270 in the window) | **23s** | recurring, ~20-23s, evenly spread |
| flow-worker | 168 (of ~8,850 in the window) | **125s** (one instance); next-largest all **60s**, recurring | 125s at 11:45:25Z; the 60s gaps recur roughly every few minutes throughout |

## Reading the two services differently, because their source cadence differs

**web** logs continuously (~25% of seconds carry a line) — every observed gap (max 23s) is
comfortably inside one poll cycle (35s avg), which is exactly what "the next dump's content
reaches back far enough to cover the previous dump's cutoff" looks like. **No evidence of a
capture gap on `web` in this window.**

**flow-worker** logs sparsely (~2% of seconds) — a background/WS worker that emits on events, not
continuously. Its RECURRING 60s gaps are the more informative signal: they look like a genuine
~60s SOURCE cadence (a periodic line, not a capture artifact), and a 30-35s poll comfortably
re-samples within every one of those 60s windows — 149 of 150 cycles show no problem.

⛔ **The one exception is named, not smoothed over.** A single 125s gap at 11:45:25Z breaks the
otherwise-consistent ~60s pattern. Available data cannot distinguish "the source was genuinely
quiet for ~2 minutes" from "one poll cycle's dump missed content" — there is no independent
oracle for what Railway's buffer actually held at that moment. **Recorded here as a named,
un-closed gap, per this programme's own rule that an absence is not evidence of nothing having
happened.** It is a single instance in 150 cycles, not a repeating pattern, so it does not by
itself justify tightening the backoff — see below.

## Backoff decision

**Not changed.** 149 of 150 flow-worker cycles and all web cycles show continuous or
comfortably-inside-budget coverage at the current 30s backoff. The one 125s outlier is a named,
unexplained gap, not a demonstrated systemic loss rate — tightening the backoff to chase a single
unrepeated instance would trade real budget (steady-state volume scales inversely with backoff,
and the very first version of this daemon at 5s backoff hit the 2GB cap within an hour) for no
demonstrated improvement. If the 125s-class gap recurs, that is the trigger to revisit, not this
one sighting.

## Numbers this analysis is not

This is a static, retrospective sample of one ~2.5h window on one day. It is not a distribution,
and 150 samples of a process that has run continuously since is not "forever." Re-derive rather
than quote this table after any change to `RECONNECT_BACKOFF_S`, `SERVICES`, or a redeploy of
either tailed service.
