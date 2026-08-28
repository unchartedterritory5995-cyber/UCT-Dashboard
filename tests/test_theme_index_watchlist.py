"""The 'UCT Thematic Indexes' prebuilt watchlist + its batch-quotes route.

Pins two things a future edit could silently break:
  1. the prebuilt config carries ONE thematic-index list, grouped under
     'UCT Index Components', full of $IDX:<slug> pseudo-tickers (uppercased to
     match how watchlist_service stores them, so the self-heal seed sees no drift);
  2. GET /api/theme-index/quotes is declared BEFORE /{slug} so 'quotes' can't be
     captured as a theme slug.
"""
from api.services import watchlist_prebuilt as wp
from api.routers import theme_index as ti_router


def test_theme_index_prebuilt_list_present_and_categorized():
    lists = wp._theme_index_lists()
    assert len(lists) == 1
    lst = lists[0]
    assert lst["category"] == "UCT Index Components"
    assert lst["name"] == "UCT Thematic Indexes"
    assert lst["tickers"], "expected at least one thematic index"
    # Every ticker is an uppercased $IDX: pseudo-ticker (matches DB storage casing).
    assert all(t.startswith("$IDX:") and t == t.upper() for t in lst["tickers"])
    # It shows up in the committed config under the same category as Dow 30 etc.
    committed = wp._load_committed()
    names = {row["name"]: row["category"] for row in committed}
    assert names.get("UCT Thematic Indexes") == "UCT Index Components"
    # Category order is unchanged: ETF Lists first, then Index Components.
    order = wp.category_order()
    assert order.index("UCT ETF Lists") < order.index("UCT Index Components")


def test_quotes_route_declared_before_slug_capture():
    paths = [r.path for r in ti_router.router.routes]
    assert "/api/theme-index/quotes" in paths
    assert "/api/theme-index/{slug}" in paths
    assert paths.index("/api/theme-index/quotes") < paths.index("/api/theme-index/{slug}")


def test_view_holdings_route_present():
    paths = [r.path for r in ti_router.router.routes]
    assert "/api/theme-index/{slug}/holdings" in paths


def test_ymd_to_ms_lands_on_the_right_utc_day():
    from datetime import datetime, timezone
    from api.services import theme_index as ti
    ms = ti._ymd_to_ms(20260827)
    assert datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d") == "2026-08-27"


def test_holding_daily_bars_reads_warm_cache_and_skips_massive(monkeypatch):
    import datetime as _dt
    from api.services import theme_index as ti
    from api.services import bars_sqlite
    today = _dt.date.today()
    ymd = today.year * 10000 + today.month * 100 + today.day
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda s, tf, n: [(ymd, 10.0, 11.0, 9.0, 10.5, 1000)])
    hit = {"massive": False}
    monkeypatch.setattr(ti, "get_agg_bars",
                        lambda *a, **k: hit.update(massive=True) or [])
    bars = ti._holding_daily_bars("AAPL", "2020-01-01", today.isoformat())
    assert bars and bars[0]["c"] == 10.5
    assert hit["massive"] is False   # warm cache used → NO Massive fan-out (the speed fix)


def test_holding_daily_bars_falls_back_to_massive_when_cold(monkeypatch):
    from api.services import theme_index as ti
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: [])
    sentinel = [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    monkeypatch.setattr(ti, "get_agg_bars", lambda s, f, t: sentinel)
    assert ti._holding_daily_bars("XYZ", "2020-01-01", "2026-01-01") == sentinel


def test_overlay_today_replaces_stale_and_appends_missing(monkeypatch):
    import datetime as _dt
    from api.services import theme_index as ti
    from api.services import massive
    today = _dt.date.today()
    t_today = ti._ymd_to_ms(today.year * 10000 + today.month * 100 + today.day)
    t_prev = ti._ymd_to_ms(20200102)
    snap = {
        "AAPL": {"day_open": 10.0, "day_high": 12.0, "day_low": 9.5, "day_c": 11.0, "today_vol": 500},
        "MSFT": {"day_open": 20.0, "day_high": 21.0, "day_low": 19.0, "day_c": 20.5, "today_vol": 300},
        "ZZZZ": {"day_open": 0.0, "day_high": 0.0, "day_low": 0.0, "day_c": 0.0, "today_vol": 0},  # pre-open → skip
    }
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", lambda ttl=2.0: snap)
    hb = {
        "AAPL": [{"t": t_prev, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1},
                 {"t": t_today, "o": 9, "h": 9, "l": 9, "c": 9, "v": 1}],   # stale today-bar
        "MSFT": [{"t": t_prev, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}],     # no today-bar
        "ZZZZ": [{"t": t_prev, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}],     # no RTH print
    }
    ti._overlay_today(hb)
    assert len(hb["AAPL"]) == 2 and hb["AAPL"][-1]["c"] == 11.0 and hb["AAPL"][-1]["t"] == t_today  # replaced
    assert len(hb["MSFT"]) == 2 and hb["MSFT"][-1]["c"] == 20.5 and hb["MSFT"][-1]["t"] == t_today   # appended
    assert len(hb["ZZZZ"]) == 1   # pre-open snapshot ignored
