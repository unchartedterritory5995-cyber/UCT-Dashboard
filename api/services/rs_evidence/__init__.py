"""UCT Relative Strength - the point-in-time EVIDENCE job (Phase 2b, unit 2b-01).

``python -m api.services.rs_evidence --db <store> [--sessions N] [--dry-run]
[--publish --dest rs/evidence.json]`` measures what the RS signals did next
over the held daily bars and publishes our own numbers so the chart's cards
print measured figures instead of claims (plan §9; research base
``03-evidence.md`` §(b): the five defensible statements plus "our own measured
numbers, once produced by the nightly backtest, with sample size and period
shown"; §(c): the measurement rules).

Modules: ``measure`` (the pure statistics), ``signals`` (which columns of
`relative_strength` are measured and why one compute is point-in-time),
``store`` (SQLite rows + ``(session, signal)`` checkpoint), ``job`` (the
driver, the artifact, the publish gate), ``__main__`` (the CLI).

THE ARTIFACT ``rs/evidence.json`` (what unit 2b-03 pulls and the card reads)::

    {
      "version": 2,                         2 since 2026-11-07: next-open base (N6), split guard (N5)
      "asof": "YYYY-MM-DD",                 newest benchmark session measured against
      "generated_at": "...Z",
      "benchmark": "SPY",
      "window": {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"},   sessions with rows
      "sessions": int,                      distinct sessions with rows
      "sessions_open": int,                 sessions whose longest window is still open
      "universe": int,                      tickers with rows
      "universe_requested": int,
      "delisted_count": int | null,         registry names with last_date inside the window
      "survivorship": "universe as held, survivorship not yet corrected",
      "horizons": [21, 63, 126],
      "rows": int,                          all-bars rows (the publish floor's quantity)
      "per_signal": {
        "<name>": {
          "column": "rsNH", "definition": "...",
          "n_signals": int, "dates": int, "tickers": int,
          "horizons": {"21": {"n", "incomplete", "incomplete_share", "hit_rate",
                              "median_excess", "mean_excess", "dates"}, "63": {...}, "126": {...}}
                                            horizon "dates": distinct sessions with a COMPLETE
                                            window at that horizon (unit VA3; absent before it)
        }, ...
      },
      "baseline": {"21": {same keys}, "63": {...}, "126": {...}},
      "split_guard": {"skipped": {"<name>": int, ..., "all_bars": int}, "rule": "...",
                      "unchecked": int | null,
                      "unchecked_by_signal": {"<name>": int, ..., "all_bars": int} | null,
                      "unchecked_rule": "..."},
                                            skipped: rows left out (an unadjusted split in the window);
                                            unchecked: names whose split list was unknown, measured
                                            as held (unit VA3; absent before it)
      "method": {"forward_return", "hit", "baseline", "point_in_time", "inputs",
                 "warmup_bars", "display_floor_n", "publish_floor_rows"}
    }

The forward return runs from the NEXT session's open to the close ``h`` sessions
after the signal (``measure`` header).

``hit_rate`` and ``incomplete_share`` are fractions 0-1; ``median_excess`` and
``mean_excess`` are PERCENT; a statistic with no complete window is ``null``.
"""

from .job import (
    ARTIFACT_KEY,
    ARTIFACT_VERSION,
    DEFAULT_BENCHMARK,
    DISPLAY_FLOOR_N,
    MIN_ROWS,
    SURVIVORSHIP_NOTE,
    WARMUP_BARS,
    UsageError,
    artifact_bytes,
    build_artifact,
    default_delisted_count,
    plan_sessions,
    publish,
    run,
)
from .measure import (BASELINE_KEY, HORIZONS, benchmark_aligned, forward_excess, measure, rows_for_ticker,
                      split_indexes, summarise, summarise_values)
from .signals import SIGNALS, compute_signal_columns, inputs_used

__all__ = [
    "ARTIFACT_KEY", "ARTIFACT_VERSION", "BASELINE_KEY", "DEFAULT_BENCHMARK", "DISPLAY_FLOOR_N", "HORIZONS",
    "MIN_ROWS", "SIGNALS", "SURVIVORSHIP_NOTE", "WARMUP_BARS", "UsageError", "artifact_bytes",
    "benchmark_aligned", "build_artifact", "compute_signal_columns", "default_delisted_count", "forward_excess",
    "inputs_used", "measure", "plan_sessions", "publish", "rows_for_ticker", "run", "split_indexes",
    "summarise", "summarise_values",
]
