"""Production synthetic monitor for chart data (P0a of the chart-data consolidation program).

WHY. Every chart-data regression so far was found by someone looking at a chart. This package
asks production the questions a member's chart asks, every ~5 minutes while the market is open
(lightly off-hours), and pages the ops channel when an answer regresses for N consecutive runs.

  * ``checks``   — PURE check functions (frontier math, grid, OHLC, gaps, latency, serve-label
                   budget, stream-vs-REST). No I/O. Bucket grid = ``bar_rollup.tv_bucket_bounds``
                   and calendar = ``session_calendar`` — the same owners the server serves from,
                   never a second copy.
  * ``alerting`` — hysteresis/dedupe state machine (pure) + the one Discord poster + durable state.
  * ``probe``    — stdlib HTTP + SSE client against the PUBLIC edge (what members actually hit).
  * ``runner``   — one cycle, the cadence, the worker thread, heartbeat, daily summary, CLI.
  * ``deadman``  — WEB-pod side: receives the heartbeat and pages when the monitor stops.

PRIVACY. Nothing here prints, logs or posts a price or a volume: messages carry tickers, tf,
check names, counts, ET timestamps and relative differences only.

Kill switch: ``CHART_MONITOR_ENABLED=0`` (on by default). Dead-man: ``CHART_MONITOR_DEADMAN_ENABLED=0``.
"""
