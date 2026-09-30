# TERM-007 quiet window, 2026-09-30 — results

Source: `raw.jsonl` beside this file (69 rows); the task's run log (`../2026-09-30-quiet-window-run.log`) is one line: "69 rows -> raw.jsonl".
Window sampled: 13:25:02Z to 14:34:12Z (09:25 to 10:34 ET), across the market open.

## The sample

| | |
|---|---|
| Rows | 69 (plan: ~70 at 60 s) |
| Pods | **1** — `uptime_seconds` 5,420 → 9,571, no reset; watchdog `started_at` one value. `deployments_sampled = 1` |
| Failed samples | 4, all at 14:23–14:28Z, all CLIENT-side connection errors (TLS EOF, `WinError 10053`, one `Server disconnected`). In 3 of those rows `/api/health/memory` answered 200, and in all 4 the watchdog answered 200 with `checks` still advancing, so the pod was not wedged. Health was missing for those 4; memory for 1. 68 memory rows are usable. |

## Memory (68 rows, one pod, 69 min)

| | first | last | min | max | least-squares slope |
|---|---|---|---|---|---|
| RSS | 1,878 MB | 2,077 MB | 1,878 | 2,321 | **+0.91 MB/min** |
| RssAnon | 1,415 | 1,862 | 1,415 | 1,866 | **+3.40 MB/min** |
| RssFile | 463 | 215 | 211 | 502 | −2.48 MB/min |

Quartile medians (≈17 rows each): RSS 2,031 → 2,183 → 2,126 → 2,083 · RssAnon 1,578 → 1,715 → 1,757 → 1,751.

- RSS is **not monotonic** across quartiles. RssAnon rises in the first half and is flat in the second.
- The anon rise is partly masked in RSS by RssFile dropping ~250 MB (page cache released) at ~14:00Z and again after 14:25Z.
- Swings of ±300 MB inside five minutes are normal here (e.g. 1,951 → 2,257 → 1,943 MB at 13:35–13:45Z).
- The earlier figure of +7.9 MB/min, monotonic over 104 min, was **not reproduced**. This window reads +0.9 MB/min RSS and +3.4 MB/min anon, flattening.

## Event-loop lag (the watchdog's `last_lag_ms` at each sample)

| n | median | p90 | max |
|---|---|---|---|
| 69 | 0.2 ms | 5.5 ms | 45.9 ms |

Buckets: <10 ms 63 · 10–100 ms 6 · 100–1,000 ms 0 · ≥1 s 0. `missed_streak` max 0.
The watchdog ran 827 checks in 4,150 s (one per 5.02 s), so none were skipped.
`max_lag_ms` read 16,312.3 at the first sample and at the last. The worst lag since the pod booted happened **before** the window, and nothing in the window exceeded it.

## Stall stacks (`/api/watchdog/stacks`, read as smoke@)

One capture, at **12:08:14Z (08:08 ET), before the window**, lag 5,011.8 ms. At that moment the event-loop thread was in
`api/main.py:10276 _ticker_types_etf_index_symbols` → `api/ticker_types.py:465 etf_index_snapshot().fetchall()`.
That is a blocking SQLite read inside an `async def` with no await. The handler is on
`tests/async_route_no_await_baseline.json` (line 50).
Concurrently, and not on the loop: two `/api/rs-rankings` request threads were running `compute_rs_scores()`
(a full universe rebuild on a request path), and a catalyst `run_refresh` thread was in an Opus call.
No capture falls inside 09:25–10:35 ET.

## What is NOT established

- **The loop-lag numbers are 69 point readings, not a distribution.** `last_lag_ms` is one check's lag at the sample instant. The ~760 checks between samples are only bounded above, by the unchanged `max_lag_ms` (16.3 s), which is far too loose to set a threshold from.
- **No heavy-job window.** 09:25–10:35 ET covers the open only. CARD 18 / TERM-017 require a window spanning an open **and** a heavy-job window.
- **No subsystem attribution.** `jobs_by_rss_delta` is cumulative since pod start, and its deltas overlap in time (e.g. `discord_chart_hot_warm` totals −2,244 MB). It cannot say what grew during these 69 minutes. The probe's own note: byte figures are estimates from a bounded sample.
- **69 minutes is shorter than the 104-minute sample** that TERM-014's criterion (a) names.
- The 4 connection errors are attributed to the client side from their error types. The Cloudflare side was not read.

## Against the tickets

- **TERM-014:** (a) not met — 69 min < 104 min, and no monotonic slope. (b) not met — no reader or pager exists. (c) not met — no subsystem named. Still HELD. It needs a ≥104-min single-pod window, and anon-RSS attribution with per-window deltas.
- **TERM-017:** (a) not met — no heavy-job window, and no per-check distribution (only 69 point samples). (b) met — `WATCHDOG_ENABLED` is untouched by this work. Still HELD. It needs the watchdog to keep a per-check histogram (a distributional quantity inside one pod, which per-process state can hold), read across an open plus a heavy-job window.
