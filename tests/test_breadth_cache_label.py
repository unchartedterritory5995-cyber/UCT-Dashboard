"""The `cache` label must report what ACTUALLY served the request.

⚰️ THE DEFECT THESE RAILS EXIST FOR. `_history_deep_uncached` delegates any window
inside the collector range to `get_history`, having already noted `cache="miss"`.
`get_history` noted *nothing*. So a `days=90` request served entirely from
`get_history`'s own cache reported `cache=miss` — on every request, indefinitely,
in the direction that makes a warm path look like work.

⛔ STANDING RULE: a harness never asserts a label; it measures what served the
request and compares. These drive the REAL route and decide "was this served from a
cache" from whether the reader actually ran, not from the label under test.

⛔ AND THE LABEL IS READ FROM THE LOG, NOT FROM THE CONTEXTVAR. The record is
per-request and the middleware clears it; reading `breadth_timing.get()` from the
test's own context returns None, which would make every assertion below fail for a
reason that has nothing to do with the label.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def app_env(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    monkeypatch.setenv("BREADTH_SENTIMENT_DB", str(tmp_path / "sent.db"))
    monkeypatch.setenv("BREADTH_DEEP_HISTORY", "1")

    from api.services import breadth_monitor as bm
    from api.services import breadth_daily_ohlc as ohlc
    from api.services import breadth_sentiment_history as sent
    from api.services import breadth_self_heal
    from api.services.cache import cache

    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "monitor.db"))
    monkeypatch.setattr(bm, "_DEEP_ENABLED", True)
    monkeypatch.setattr(breadth_self_heal, "maybe_auto_heal", lambda *a, **k: None)
    ohlc._INIT_DONE = False
    sent._INIT_DONE = False
    bm.init_db()

    # 120 collector sessions, so a days=90 window lies INSIDE the collector range
    # and takes the delegation path this file is about.
    dates = sorted(f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(120))
    with sqlite3.connect(bm._db_path()) as c:
        for i, d in enumerate(dates):
            c.execute("INSERT OR REPLACE INTO breadth_snapshots(date, metrics) VALUES (?,?)",
                      (d, json.dumps({"pct_above_50sma": 50 + (i % 10),
                                      "universe_count": 3700, "adv_decline": i % 50,
                                      "sp500_close": 5000 + i, "qqq_close": 400 + i})))
        c.commit()

    import api.main as main
    from api.routers import breadth_monitor as rm
    main.app.dependency_overrides[rm.require_paid] = lambda: {"id": "t", "plan": "pro"}
    cache.delete_prefix("breadth_history_")
    try:
        yield {"client": TestClient(main.app), "bm": bm, "rm": rm, "cache": cache}
    finally:
        main.app.dependency_overrides.pop(rm.require_paid, None)
        cache.delete_prefix("breadth_history_")


_LINE = re.compile(r"cache=(?P<cache>\S+) tier=(?P<tier>\S+)")


def _get(env, days, caplog):
    """One request. Returns the LABEL from the log, plus GROUND TRUTH: did the
    reader actually run?

    ⛔ Ground truth is a counter on `_history_uncached` — the function that does the
    real work. A request that never reaches it was served by some cache, whatever
    the label says.
    """
    bm = env["bm"]
    ran = {"n": 0}
    real = bm._history_uncached

    def counted(*a, **k):
        ran["n"] += 1
        return real(*a, **k)

    bm._history_uncached = counted
    caplog.clear()
    try:
        with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
            r = env["client"].get(f"/api/breadth-monitor?days={days}")
    finally:
        bm._history_uncached = real
    assert r.status_code == 200, r.status_code

    lines = [x.getMessage() for x in caplog.records if "cache=" in x.getMessage()]
    assert lines, "the timing line was not logged — the label cannot be read at all"
    m = _LINE.search(lines[-1])
    assert m, f"no cache=/tier= in: {lines[-1]}"
    return {"label": m.group("cache"), "tier": m.group("tier"), "read_ran": ran["n"] > 0}


def test_a_request_served_from_a_cache_is_never_labelled_miss(app_env, caplog):
    """THE REGRESSION, in its simplest form."""
    first = _get(app_env, 90, caplog)
    assert first["read_ran"] is True, "the first request should have done real work"

    second = _get(app_env, 90, caplog)
    assert second["read_ran"] is False, (
        "the second request still ran the reader — this fixture is not exercising a "
        "cached path, so the assertion below would prove nothing")
    assert second["label"] == "hit", (
        f"served from a cache but labelled {second['label']!r} — the defect")


def test_the_delegated_window_reports_the_plain_tier_not_a_miss(app_env, caplog):
    """⭐ THE EXACT CASE SESSION 7 FOUND, isolated. With the body cache evicted but
    `get_history`'s own cache still warm, the request does NO read — and used to be
    labelled `miss` because `get_history` noted nothing at all."""
    first = _get(app_env, 90, caplog)
    assert first["read_ran"] is True

    # Evict ONLY the pre-rendered body entry, leaving the plain reader's cache warm.
    env_cache = app_env["cache"]
    env_cache.invalidate(app_env["rm"]._body_cache_key(90, "", "le"))

    second = _get(app_env, 90, caplog)
    assert second["read_ran"] is False, (
        "the plain cache did not serve it, so this case is not being exercised")
    assert second["label"] == "hit", (
        f"served by get_history's cache but labelled {second['label']!r}")
    assert second["tier"] == "plain", (
        f"expected the plain tier, got {second['tier']!r}")


def test_a_real_read_is_never_labelled_hit(app_env, caplog):
    """The other direction. Without it, a label hard-coded to 'hit' passes above."""
    first = _get(app_env, 90, caplog)
    assert first["read_ran"] is True
    assert first["label"] == "miss", (
        f"the reader ran but the request was labelled {first['label']!r}")
    assert first["tier"] == "miss", first["tier"]


def test_every_tier_emitted_is_one_of_the_declared_names(app_env, caplog):
    """A tier outside the declared set means somebody added a cache and did not
    name it."""
    from api.services import breadth_timing
    seen = {_get(app_env, 90, caplog)["tier"] for _ in range(2)}
    app_env["cache"].invalidate(app_env["rm"]._body_cache_key(90, "", "le"))
    seen.add(_get(app_env, 90, caplog)["tier"])
    assert seen, "no tiers observed — the probe saw nothing"
    for t in seen:
        assert t in breadth_timing.CACHE_TIERS, f"{t!r} not in {breadth_timing.CACHE_TIERS}"


def test_the_original_cache_field_still_reads_hit_or_miss(app_env, caplog):
    """⛔ BACKWARDS COMPATIBILITY, ASSERTED. Sessions 5-7 parsed `cache=` as
    hit/miss; the tier is ADDITIVE. If `cache` ever started carrying tier names,
    every earlier sample in the programme record would become unparseable."""
    a = _get(app_env, 90, caplog)
    b = _get(app_env, 90, caplog)
    for r in (a, b):
        assert r["label"] in ("hit", "miss"), r["label"]
