"""The Breadth Monitor's universe switcher: the `universe` param, the PRE-BUILT per-universe
store, cache-key isolation and the market-wide copy.

Rails:
  • `uct` is byte-identical — the same body and the same cache keys as before the param existed;
  • an unknown universe is a 400 (never silently UCT);
  • a nasdaq request can never return UCT rows (only the MARKET_WIDE keys come from UCT);
  • per-universe cache keys cannot collide (with each other, with UCT, or across store builds);
  • the store is built only from canonical sources, clipped at each universe's start, and the
    request path only reads it.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

UCT_DATES = [f"2026-03-{d:02d}" for d in range(2, 28)]          # 26 sessions


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    monkeypatch.setenv("BREADTH_SENTIMENT_DB", str(tmp_path / "sent.db"))
    monkeypatch.setenv("BREADTH_UNIVERSE_MONITOR_DB", str(tmp_path / "umon.db"))
    monkeypatch.setenv("BREADTH_DEEP_HISTORY", "1")
    from api.services import breadth_monitor as bm
    from api.services import breadth_daily_ohlc as ohlc
    from api.services import breadth_sentiment_history as sent
    from api.services import breadth_self_heal
    from api.services import breadth_universe_monitor as bum
    from api.services.cache import cache

    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "monitor.db"))
    monkeypatch.setattr(bm, "_DEEP_ENABLED", True)
    monkeypatch.setattr(breadth_self_heal, "maybe_auto_heal", lambda *a, **k: None)
    monkeypatch.setattr(bm, "_universe_live", lambda u: ([], ""))
    bum._VIEW.clear()
    bum._INIT["path"] = None
    ohlc._INIT_DONE = False
    sent._INIT_DONE = False
    bm.init_db()
    with sqlite3.connect(bm._db_path()) as c:
        for i, d in enumerate(UCT_DATES):
            c.execute("INSERT OR REPLACE INTO breadth_snapshots(date, metrics) VALUES (?,?)", (d, json.dumps({
                "pct_above_50sma": 50 + i, "universe_count": 3700, "up_vol_ratio": 1.5,
                "vix": 20 + i, "cnn_fear_greed": 40 + i, "naaim": 60.5, "naaim_date": d,
                "spy_above_50sma": 1, "uct_exposure": 70, "cnn_fear_greed_asof": d,
            })))
        c.commit()

    import api.main as main
    from api.routers import breadth_monitor as rm
    main.app.dependency_overrides[rm.require_paid] = lambda: {"id": "t", "plan": "pro"}
    cache.delete_prefix("breadth_history_")
    try:
        yield {"client": TestClient(main.app), "bm": bm, "rm": rm, "bum": bum, "cache": cache,
               "tmp": tmp_path}
    finally:
        main.app.dependency_overrides.pop(rm.require_paid, None)
        cache.delete_prefix("breadth_history_")
        bum._VIEW.clear()


def _seed(bum, universe, dates, pct=-7.0, count=2900):
    rows = {d: {"pct_above_50sma": pct, "universe_count": count, "adv_decline": 10,
                "adv_decline_cum": 100 + i, "mcclellan_osc": 1.0} for i, d in enumerate(dates)}
    return bum.write_rows(universe, rows, source_token="t1", mode="full")


# ── the param ────────────────────────────────────────────────────────────────

def test_unknown_universe_is_a_400_on_every_endpoint(env):
    c = env["client"]
    for url in ("/api/breadth-monitor?days=5&universe=nasdac", "/api/breadth-monitor/dates?universe=UCTX"):
        r = c.get(url)
        assert r.status_code == 400, url
        assert "unknown breadth universe" in r.json()["detail"]


def test_service_history_validates_and_passes_the_universe(env):
    from fastapi import HTTPException
    rm = env["rm"]
    with pytest.raises(HTTPException) as e:
        rm.get_breadth_history_service(days=5, universe="nope", _=None)
    assert e.value.status_code == 400
    _seed(env["bum"], "nasdaq", UCT_DATES[-10:])
    body = json.loads(rm.get_breadth_history_service(days=5, universe="nasdaq", _=None).body)
    assert body["universe"] == "nasdaq" and len(body["rows"]) == 5


def test_uct_is_byte_identical_with_or_without_the_param(env):
    c = env["client"]
    a = c.get("/api/breadth-monitor?days=10").content
    env["cache"].delete_prefix("breadth_history_")
    b = c.get("/api/breadth-monitor?days=10&universe=uct").content
    assert a == b
    assert "universe" not in json.loads(a)
    d1 = c.get("/api/breadth-monitor/dates").json()
    d2 = c.get("/api/breadth-monitor/dates?universe=uct").json()
    assert d1 == d2 and "universe" not in d1


def test_uct_cache_keys_are_unchanged(env):
    rm = env["rm"]
    assert rm._body_cache_key(90, "", "le") == "breadth_history_body_90_latest_le"
    assert rm._body_cache_key(90, "2026-03-02", "ge", "uct", "ignored") == "breadth_history_body_90_2026-03-02_ge"


# ── cache-key isolation ──────────────────────────────────────────────────────

def test_per_universe_cache_keys_cannot_collide(env):
    rm = env["rm"]
    keys = {u: rm._body_cache_key(90, "", "le", u, "tok") for u in ("uct", "us", "nasdaq", "nyse")}
    assert len(set(keys.values())) == 4
    for u in ("us", "nasdaq", "nyse"):
        assert keys[u].startswith("breadth_history_")          # every writer's wipe still reaches it
        assert f"_{u}|" in keys[u]
    # the same universe under two store builds is two keys
    assert rm._body_cache_key(90, "", "le", "nasdaq", "a") != rm._body_cache_key(90, "", "le", "nasdaq", "b")


def test_store_rebuild_moves_the_cache_token(env):
    bum, bm = env["bum"], env["bm"]
    _seed(bum, "nyse", UCT_DATES[-5:])
    t1 = bm.universe_cache_token("nyse")
    _seed(bum, "nyse", UCT_DATES[-6:])
    assert bm.universe_cache_token("nyse") != t1


def test_stale_slot_bound_raised(env):
    assert env["rm"]._HISTORY_STALE_MAX_KEYS >= 64


# ── a nasdaq request never returns UCT rows ──────────────────────────────────

def test_nasdaq_rows_are_nasdaq_rows_even_after_a_warm_uct_read(env):
    c, bum = env["client"], env["bum"]
    _seed(bum, "nasdaq", UCT_DATES, pct=-7.0, count=2900)
    uct = c.get(f"/api/breadth-monitor?days=10&end={UCT_DATES[-1]}&anchor=le").json()
    nas = c.get(f"/api/breadth-monitor?days=10&end={UCT_DATES[-1]}&anchor=le&universe=nasdaq").json()
    assert nas["universe"] == "nasdaq"
    assert [r["date"] for r in nas["rows"]] == [r["date"] for r in uct["rows"]]
    for r in nas["rows"]:
        assert r["_universe"] == "nasdaq"
        assert r["pct_above_50sma"] == -7.0 and r["universe_count"] == 2900
        assert r["up_vol_ratio"] is None and r["breadth_score"] is None   # n/a + hidden Health
    for r in uct["rows"]:
        assert r["pct_above_50sma"] != -7.0 and "_universe" not in r
    # and the UCT body is still UCT's after the nasdaq read
    again = c.get(f"/api/breadth-monitor?days=10&end={UCT_DATES[-1]}&anchor=le").json()
    assert again == uct


def test_an_empty_universe_store_is_empty_never_uct(env):
    r = env["client"].get("/api/breadth-monitor?days=10&universe=nyse").json()
    assert r["rows"] == [] and r["universe"] == "nyse"
    d = env["client"].get("/api/breadth-monitor/dates?universe=nyse").json()
    assert d["dates"] == [] and d["count"] == 0


# ── market-wide columns come from UCT, by date ───────────────────────────────

def test_market_wide_columns_are_copied_from_the_uct_row_of_the_same_date(env):
    c, bum = env["client"], env["bum"]
    extra = ["2026-02-27"]                                     # a nasdaq session UCT does not have
    _seed(bum, "nasdaq", extra + UCT_DATES)
    _seed(bum, "nyse", UCT_DATES)
    uct = {r["date"]: r for r in c.get("/api/breadth-monitor?days=30").json()["rows"]}
    for u in ("nasdaq", "nyse"):
        rows = {r["date"]: r for r in c.get(f"/api/breadth-monitor?days=40&universe={u}").json()["rows"]}
        for d, r in rows.items():
            if d in uct:
                for k in ("vix", "cnn_fear_greed", "naaim", "naaim_date", "spy_above_50sma",
                          "uct_exposure", "cnn_fear_greed_asof", "is_ftd"):
                    assert r.get(k) == uct[d].get(k), (u, d, k)
            else:
                assert r["vix"] is None and r["naaim"] is None     # never carried from another date
    nas = {r["date"]: r for r in c.get("/api/breadth-monitor?days=40&universe=nasdaq").json()["rows"]}
    nys = {r["date"]: r for r in c.get("/api/breadth-monitor?days=40&universe=nyse").json()["rows"]}
    for d in UCT_DATES:
        assert nas[d]["vix"] == nys[d]["vix"] == uct[d]["vix"]


def test_dates_and_bounds_follow_the_universe(env):
    c, bum = env["client"], env["bum"]
    _seed(bum, "nyse", UCT_DATES[5:])
    d = c.get("/api/breadth-monitor/dates?universe=nyse").json()
    assert d["min"] == UCT_DATES[5] and d["max"] == UCT_DATES[-1]
    assert d["dates"][0] == UCT_DATES[-1] and d["count"] == len(UCT_DATES) - 5
    h = c.get(f"/api/breadth-monitor?days=3&end={UCT_DATES[10]}&anchor=le&universe=nyse").json()
    assert h["min_date"] == UCT_DATES[5] and h["top_date"] == UCT_DATES[10]
    assert h["next_date"] == UCT_DATES[11]


# ── provisional sessions + today's live row ──────────────────────────────────

def test_provisional_sessions_and_the_live_row(env, monkeypatch):
    c, bum, bm = env["client"], env["bum"], env["bm"]
    _seed(bum, "nasdaq", UCT_DATES[:-2])                       # canonical lags two sessions
    live = [{"date": UCT_DATES[-2], "final": True, "metrics": {"universe_count": 2901, "adv_decline": 5,
                                                                  "pct_above_50sma": 33.0, "mcclellan_osc": 9}},
            {"date": UCT_DATES[-1], "final": True, "metrics": {"universe_count": 2902, "adv_decline": -3}},
            {"date": "2026-03-30", "final": False, "metrics": {"universe_count": 2903, "adv_decline": 1}}]
    monkeypatch.setattr(bm, "_universe_live", lambda u: (live if u == "nasdaq" else [], "as-of-1"))
    d = c.get("/api/breadth-monitor/dates?universe=nasdaq").json()
    assert d["dates"][:2] == [UCT_DATES[-1], UCT_DATES[-2]]
    assert d["live_row"]["date"] == "2026-03-30" and d["live_row"]["_live"] is True
    assert d["live_row"]["_provisional"] is True and d["live_row"]["universe_count"] == 2903
    rows = c.get("/api/breadth-monitor?days=3&universe=nasdaq").json()["rows"]
    assert [r["date"] for r in rows] == [UCT_DATES[-1], UCT_DATES[-2], UCT_DATES[-3]]
    assert rows[0]["_provisional"] and rows[1]["_provisional"] and not rows[2].get("_provisional")
    assert "mcclellan_osc" not in rows[1] or rows[1]["mcclellan_osc"] is None   # never a live McClellan
    base = rows[2]["adv_decline_cum"]
    assert rows[1]["adv_decline_cum"] == base + 5 and rows[0]["adv_decline_cum"] == base + 5 - 3
    assert rows[1]["vix"] == next(r for r in c.get("/api/breadth-monitor?days=5").json()["rows"]
                                  if r["date"] == UCT_DATES[-2])["vix"]


# ── the builder ──────────────────────────────────────────────────────────────

def _fake_history(series):
    def history(metric, limit, universe):
        return {d: {"c": v} for d, v in series.get(metric, {}).items()}
    return history


def test_build_rows_clips_at_the_start_and_needs_a_base_row(env):
    bum = env["bum"]
    series = {
        "universe_count": {"2009-06-10": 1700, "2009-06-11": 1700, "2009-06-12": 1701},
        "pct_above_50sma": {"2009-06-10": 40.0, "2009-06-11": 41.0, "2009-06-12": 42.0},
        # an MA-extra overlay date with no base row, and one before NYSE's start
        "pct_above_20sma": {"2009-06-09": 1.0, "2009-06-12": 43.0, "2009-06-15": 44.0},
    }
    derived = {"MCO": {"2009-06-12": -12.5}, "AD": {"2009-06-11": 3, "2009-06-12": 7}}
    rows = bum.build_rows("nyse", history=_fake_history(series), derived=lambda u, k: derived[k])
    assert sorted(rows) == ["2009-06-11", "2009-06-12"]
    assert rows["2009-06-12"]["pct_above_20sma"] == 43.0
    assert rows["2009-06-12"]["mcclellan_osc"] == -12.5 and "mcclellan_osc" not in rows["2009-06-11"]
    assert rows["2009-06-11"]["adv_decline_cum"] == 3
    for r in rows.values():
        for k in bum.UNAVAILABLE + bum.HIDDEN + bum.MARKET_WIDE:
            assert k not in r


def test_build_rows_drops_non_finite_values(env):
    bum = env["bum"]
    series = {"universe_count": {"2020-01-02": 3000}, "pct_above_50sma": {"2020-01-02": float("nan")},
              "ratio_5day": {"2020-01-02": None}}
    rows = bum.build_rows("us", history=_fake_history(series), derived=lambda u, k: {})
    assert rows == {"2020-01-02": {"universe_count": 3000}}


def test_write_rows_full_replaces_and_tail_upserts(env):
    bum = env["bum"]
    bum.write_rows("us", {"2020-01-02": {"universe_count": 1}, "2020-01-03": {"universe_count": 2},
                          "2020-01-06": {"universe_count": 3}}, source_token="a")
    assert bum.dates("us") == ["2020-01-02", "2020-01-03", "2020-01-06"]
    # tail: 01-06 revised, 01-07 new, 01-03 gone from the source inside the rebuilt span
    bum.write_rows("us", {"2020-01-06": {"universe_count": 33}, "2020-01-07": {"universe_count": 4}},
                   source_token="b", mode="tail", replace=False)
    assert bum.dates("us") == ["2020-01-02", "2020-01-03", "2020-01-06", "2020-01-07"]
    assert bum.rows_for_dates("us", ["2020-01-06"])["2020-01-06"]["universe_count"] == 33
    bum.write_rows("us", {"2020-01-03": {"universe_count": 9}, "2020-01-07": {"universe_count": 4}},
                   source_token="c", mode="tail", replace=False)
    assert bum.dates("us") == ["2020-01-02", "2020-01-03", "2020-01-07"]
    m = bum.meta("us")
    assert m["source_token"] == "c" and m["rows"] == 3 and m["build_version"] == bum.BUILD_VERSION
    bum.write_rows("us", {"2021-01-04": {"universe_count": 5}}, source_token="d")
    assert bum.dates("us") == ["2021-01-04"]


def test_write_rows_never_stores_before_the_universe_start(env):
    bum = env["bum"]
    bum.write_rows("nyse", {"2009-01-02": {"universe_count": 1}, "2009-06-11": {"universe_count": 2}},
                   source_token="x")
    assert bum.dates("nyse") == ["2009-06-11"]


def test_refresh_builds_full_then_tail_then_skips(env, monkeypatch):
    bum = env["bum"]
    calls = []
    monkeypatch.setattr(bum, "_sources_ready", lambda u: True)
    tok = {"v": "s1"}
    monkeypatch.setattr(bum, "source_token", lambda u: tok["v"])

    def fake_build_rows(u, limit=8000, since="", **k):
        calls.append((u, limit, since))
        return {"2020-01-02": {"universe_count": 1}, "2020-01-03": {"universe_count": 2}}
    monkeypatch.setattr(bum, "build_rows", fake_build_rows)
    assert bum.refresh("us")["mode"] == "full"
    assert bum.refresh("us") == {"universe": "us", "skipped": "current"}
    tok["v"] = "s2"
    assert bum.refresh("us")["mode"] == "tail"
    assert calls[0][1] == 8000 and calls[1][1] == bum._TAIL_READ
    assert bum.meta("us")["source_token"] == "s2"


def test_refresh_never_raises_and_skips_unserved_sources(env, monkeypatch):
    bum = env["bum"]
    monkeypatch.setattr(bum, "_sources_ready", lambda u: False)
    assert bum.refresh("nasdaq")["skipped"] == "sources not served"
    with pytest.raises(ValueError):
        bum.refresh("uct")


def test_kick_while_running_is_queued_not_dropped(env, monkeypatch):
    import threading
    bum = env["bum"]
    gate, seen = threading.Event(), []

    def fake_refresh(u):
        seen.append(u)
        gate.wait(5)
        return {"universe": u}
    monkeypatch.setattr(bum, "refresh", fake_refresh)
    assert bum.kick_refresh(("us",)) is True
    assert bum.kick_refresh(("nyse",)) is False            # queued behind the running one
    gate.set()
    for _ in range(200):
        if not bum._JOB["running"]:
            break
        threading.Event().wait(0.02)
    assert seen == ["us", "nyse"] and not bum._JOB["running"]


def test_the_request_path_never_builds(env, monkeypatch):
    bum, c = env["bum"], env["client"]
    _seed(bum, "us", UCT_DATES)

    def boom(*a, **k):
        raise AssertionError("built on a request")
    monkeypatch.setattr(bum, "build_rows", boom)
    monkeypatch.setattr(bum, "build", boom)
    assert c.get("/api/breadth-monitor?days=5&universe=us").status_code == 200
    assert c.get("/api/breadth-monitor/dates?universe=us").status_code == 200


# ── the 20/150-day SMA overlay is clipped at the universe's start ─────────────

def test_ma_extra_override_is_clipped_at_the_exchange_start(monkeypatch):
    from api.services import breadth_ma_extra as mae
    rows = {"nyse": {"2008-03-03": [10.0, 11.0], "2009-06-11": [12.0, 13.0]},
            "nasdaq": {"2008-03-03": [20.0, 21.0]}}
    monkeypatch.setattr(mae, "_series_view", lambda: {"rows": rows, "through": None, "sha": "x" * 12})
    assert sorted(mae.override_history("pct_above_20sma", "nyse", {})) == ["2009-06-11"]
    assert sorted(mae.override_history("pct_above_20sma", "nasdaq", {})) == ["2008-03-03"]
