"""Perf wave 2: collect_all's source deadline bounds WALL time. A hung source used to hold
the call until it finished (the `with ThreadPoolExecutor` exit waits), and a fired timeout
escaped as TimeoutError (a 500 on /api/catalysts/explain)."""
from __future__ import annotations

import threading
import time

from api.services.catalyst import sources

_NAMES = ["_pull_movers", "_pull_gap_scan", "_pull_earnings", "_pull_tweet_signals",
          "_pull_rss_signals", "_pull_scanner_setups", "_pull_perplexity_discovery",
          "_pull_analyst_actions", "_pull_fmp_analyst", "_pull_options_flow",
          "_pull_finviz_news", "_pull_av_news"]


def test_a_hung_source_is_cut_at_the_deadline_and_counted_empty(monkeypatch):
    release = threading.Event()
    for n in _NAMES:
        monkeypatch.setattr(sources, n, lambda: {})
    monkeypatch.setattr(sources, "_pull_rss_signals", lambda: (release.wait(10), {})[1])
    monkeypatch.setattr(sources, "COLLECT_DEADLINE_S", 0.3)
    t0 = time.time()
    try:
        out = sources.collect_all()
        elapsed = time.time() - t0
    finally:
        release.set()
    assert out == []                    # nothing surfaced, and no exception
    assert elapsed < 3.0                # not the 10 s the hung source would take
    assert sources._LAST_SOURCE_STATS["rss"] == 0
