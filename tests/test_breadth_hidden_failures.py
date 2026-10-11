"""Failures that used to hide (2026-10-11).

3a: a build that failed to READ, or came back much shorter, is not cached over the good
    series — the previous one keeps serving and the build is retried.
3b: a write into PAST sessions queues the affected charts for a background rebuild
    (corrections no longer hide behind a fresh cache for up to 6 h); today's live writes
    never do.
Pack: a per-series content hash, so a correction inside the window reaches browsers.
"""
from __future__ import annotations

import time

import pytest

from api.services import breadth_symbols as bs


def _series(n, start=0):
    return [{"t": f"2020-{(i // 28) % 12 + 1:02d}-{i % 28 + 1:02d}", "o": 1, "h": 1, "l": 1, "c": 1}
            for i in range(start, start + n)]


@pytest.fixture
def clean(monkeypatch, tmp_path):
    monkeypatch.setenv("BREADTH_SERIES_PERSIST", "0")
    monkeypatch.setattr(bs, "_DIRTY_PATH", str(tmp_path / "dirty.json"))
    bs._DIRTY.clear()
    bs._refused_since.clear()
    bs._breadth_cache.invalidate(bs._daily_key("UCTA50")) if hasattr(bs._breadth_cache, "invalidate") else None
    yield


def _seed_prev(sym, series):
    bs._breadth_cache.set(bs._daily_key(sym), {"saved_at": time.time(), "series": series}, ttl=3600)


def _build_returns(monkeypatch, series, issues=()):
    def fake(sym, metric, universe=bs.DEFAULT_UNIVERSE):
        bs._build_state.issues = list(issues)
        return series
    monkeypatch.setattr(bs, "_build_breadth_series", fake)


def test_a_build_whose_store_read_failed_is_refused(clean, monkeypatch):
    prev = _series(300)
    _seed_prev("UCTA50", prev)
    _build_returns(monkeypatch, _series(60, 240), issues=["breadth store read failed"])
    out = bs._refresh_series("UCTA50", "pct_above_50sma")
    assert out == prev
    hit = bs._breadth_cache.get(bs._daily_key("UCTA50"))
    assert hit["series"] == prev
    # retried soon: the kept entry goes stale in ~5 minutes, not 6 hours
    assert time.time() - hit["saved_at"] > bs._SEALED_TTL - bs._REFUSE_RETRY_S - 5


def test_a_much_shorter_build_is_refused_but_a_normal_one_is_kept(clean, monkeypatch):
    _seed_prev("UCTA50", _series(300))
    _build_returns(monkeypatch, _series(250))
    assert len(bs._refresh_series("UCTA50", "pct_above_50sma")) == 300
    _build_returns(monkeypatch, _series(301))
    assert len(bs._refresh_series("UCTA50", "pct_above_50sma")) == 301
    assert "UCTA50" not in bs._refused_since


def test_after_a_day_of_refusals_the_new_build_is_accepted_and_alerted(clean, monkeypatch):
    _seed_prev("UCTA50", _series(300))
    _build_returns(monkeypatch, _series(250))
    sent = []
    from api.services import breadth_alerts
    monkeypatch.setattr(breadth_alerts, "send", lambda k, t, lines: sent.append(k) or {"sent": True})
    bs._refused_since["UCTA50"] = time.time() - bs._REFUSE_MAX_S - 1
    assert len(bs._refresh_series("UCTA50", "pct_above_50sma")) == 250
    assert sent == ["build_refused:UCTA50"]


def test_past_writes_mark_charts_dirty_and_today_does_not(clean, monkeypatch):
    from api.services import breadth_daily_ohlc as bdo
    bs.mark_dirty("uct", ["pct_above_50sma"])
    bs.mark_dirty("uct", ["_meta", "foo_list"])
    taken = bs._take_dirty()
    assert taken == {("uct", "pct_above_50sma")}
    assert bs._is_dirty(taken, "uct", "pct_above_50sma")
    assert not bs._is_dirty(taken, "uct", "pct_above_200sma")
    assert bs._is_dirty({("us", "*")}, "us", "anything")
    assert bs._take_dirty() == set()


def test_the_warm_loop_rebuilds_a_dirty_fresh_chart(clean, monkeypatch):
    from api.services import breadth_monitor
    monkeypatch.setattr(bs, "_METRIC_OF", {"UCTA50": "pct_above_50sma", "UCTA200": "pct_above_200sma"})
    monkeypatch.setattr(breadth_monitor, "get_history", lambda n: [{"date": "2020-11-03"}])
    for s in ("UCTA50", "UCTA200"):
        _seed_prev(s, _series(300))
    rebuilt = []
    monkeypatch.setattr(bs, "_refresh_series", lambda sym, metric, universe=None: rebuilt.append(sym) or [])
    monkeypatch.setattr(bs, "_warm_published_pit", lambda cache, stats: {})
    monkeypatch.setattr(bs, "_rebuild_dirty_pit", lambda dirty, stats: None)
    monkeypatch.setattr(bs, "_WARM_GAP", 0)
    from api.services.market_indicators import producers
    from api.services import breadth_pack
    monkeypatch.setattr(producers, "warm_all", lambda: {})
    monkeypatch.setattr(breadth_pack, "refresh", lambda: {})
    bs.mark_dirty("uct", ["pct_above_50sma"])
    bs.warm_breadth()
    assert rebuilt == ["UCTA50"]


def test_a_correction_inside_the_pack_window_re_versions_it(monkeypatch):
    """Same length, same last bar, one interior close corrected: the version must move and
    the series must carry a different content hash (the browser replaces on that)."""
    import gzip
    import json
    from api.services import breadth_pack as bp

    def bars(fix=False):
        out = [{"t": f"2026-09-{10 + i:02d}", "o": i, "h": i, "l": i, "c": i} for i in range(5)]
        out.append({"t": "2026-10-08", "o": 9, "h": 9, "l": 9, "c": 9})
        if fix:
            out[2] = dict(out[2], c=42)
        return out
    monkeypatch.setattr(bp, "_today_et", lambda: "2026-10-09")
    monkeypatch.setattr(bp, "_symbols", lambda: [("UCTA50", "uct", "base")])
    monkeypatch.setattr(bp, "_bars_for", lambda sym, kind: bars())
    bp._state.update(version=None, shards={}, manifest=None)
    v1 = bp.refresh()["version"]
    sha1 = json.loads(gzip.decompress(bp.shard(v1, 0)))["tickers"]["UCTA50"]["D"]["sha"]
    monkeypatch.setattr(bp, "_bars_for", lambda sym, kind: bars(fix=True))
    v2 = bp.refresh()["version"]
    sha2 = json.loads(gzip.decompress(bp.shard(v2, 0)))["tickers"]["UCTA50"]["D"]["sha"]
    assert v1 != v2 and sha1 != sha2
