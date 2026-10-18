"""The screener at every hour (owner, 2026-10-17: "why would it be any different than
premarket when the market is open or closed").

Two halves:
  * the CLOSING pass -- after the close the live columns carry the official close
    (`day.c`), never the last in-session tick and never an after-hours print;
  * the ONE extended-hours column -- pre-market in the morning, after hours in the
    evening, the last after-hours print held overnight and on weekends, nothing in the
    session.

⛔ Every fixture is a tmp DB. Nothing reads C:\\data.
"""
import datetime as dt
import time
from zoneinfo import ZoneInfo

import pytest

from api.services import session_calendar
from api.services.screener import live_tier, premarket, query, snapshot_db

ET = ZoneInfo("America/New_York")


# ── the closing pass ──────────────────────────────────────────────────────────

def _nightly(ticker="AAA", price=100.0):
    return {"ticker": ticker, "price": price, "bars_asof": "20260821",
            "snapshot_date": "2026-08-21", "built_at": 1, "chg_pct_1d": 0.5,
            "pct_vs_sma50": 11.11, "sma50": 90.0}


@pytest.fixture
def close_env(monkeypatch, tmp_path):
    """Monday 2026-08-24. `state` drives the clock and the feed."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    state = {"session": "post_market",
             "now": dt.datetime(2026, 8, 24, 16, 5, tzinfo=ET),
             # after hours the last trade is 110; the regular session closed at 105
             "snap": {"AAA": {"last_price": 110.0, "prev_close": 100.0,
                              "today_vol": 1_000_000, "prev_vol": 2_000_000,
                              "day_close": 105.0}}}
    monkeypatch.setattr(live_tier, "_session", lambda: state["session"])
    monkeypatch.setattr(live_tier, "_now_et", lambda: state["now"])
    monkeypatch.setattr(live_tier, "_EFFECTIVE_COLUMNS", None)
    from api.services import scan_volume
    monkeypatch.setattr(scan_volume, "full_market_snapshot", lambda: dict(state["snap"]))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([_nightly()])
    return state


def _live_price(ticker="AAA"):
    with snapshot_db.connect() as conn:
        r = conn.execute(f"SELECT price, chg_pct_1d FROM {live_tier.LIVE_TABLE} "
                         "WHERE ticker=?", (ticker,)).fetchone()
        return tuple(r) if r else None


def test_after_the_close_the_live_price_is_the_official_close(close_env):
    r = live_tier.run_sweep()
    assert r["pass"] == "closing" and r["skipped_reason"] is None
    assert _live_price() == (105.0, 5.0)        # day.c, never the 110 after-hours print


def test_CONTROL_after_the_window_the_sweep_stops(close_env):
    close_env["now"] = dt.datetime(2026, 8, 24, 16, 31, tzinfo=ET)
    r = live_tier.run_sweep()
    assert r["skipped_reason"] == "not_regular_session"
    assert _live_price() is None


def test_a_stock_with_no_day_close_keeps_its_in_session_row(close_env):
    close_env["snap"]["AAA"].pop("day_close")
    live_tier.run_sweep()
    assert _live_price() is None                # left out, never the after-hours print


def test_a_half_day_runs_the_closing_pass_from_its_own_close(close_env, monkeypatch):
    """13:00 close: the weekday clock still says regular until 16:00, while every print
    after 13:00 is after hours."""
    monkeypatch.setattr(session_calendar, "session_at", lambda ts, *a: "post")
    monkeypatch.setattr(session_calendar, "close_time",
                        lambda d, *a: dt.datetime(2026, 8, 24, 13, 0, tzinfo=ET))
    close_env["session"] = "regular"
    close_env["now"] = dt.datetime(2026, 8, 24, 13, 10, tzinfo=ET)
    assert live_tier.run_sweep()["pass"] == "closing"
    assert _live_price() == (105.0, 5.0)
    # past the window the clock's "regular" must not restart the in-session sweep
    close_env["now"] = dt.datetime(2026, 8, 24, 14, 0, tzinfo=ET)
    assert live_tier.run_sweep()["skipped_reason"] == "not_regular_session"
    assert live_tier.min_serve_asof() is None   # and the closing values keep serving


def test_in_the_session_the_regular_sweep_still_reads_the_last_trade(close_env):
    close_env["session"] = "regular"
    close_env["now"] = dt.datetime(2026, 8, 24, 10, 42, tzinfo=ET)
    r = live_tier.run_sweep()
    assert r["pass"] is None
    assert _live_price() == (110.0, 10.0)


# ── serving the extended-hours column ─────────────────────────────────────────

MEMBER = {"id": "m1", "role": "member"}
FRI = 20261016


@pytest.fixture
def ext(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "pm.db"))
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "1")
    monkeypatch.delenv("SCREENER_LIVE_TIER_ENABLED", raising=False)
    state = {"now": dt.datetime(2026, 10, 16, 17, 5, tzinfo=ET)}     # Friday after hours
    monkeypatch.setattr(live_tier, "_session", lambda: "post_market")
    monkeypatch.setattr(live_tier, "_now_et", lambda: state["now"])
    monkeypatch.setattr(query, "_COUNT_CACHE", None)
    snapshot_db.init_db()
    snapshot_db.upsert_rows([{"ticker": t, "price": 50.0, "bars_asof": "20261015",
                              "snapshot_date": "2026-10-15", "built_at": 1}
                             for t in ("AH", "PRE", "OLDAH")])
    now = time.time()
    with snapshot_db.connect() as conn:
        premarket.ensure_schema(conn)
        conn.executemany(
            f"INSERT INTO {premarket.TABLE} (ticker, session_ymd, premarket_price, "
            "premarket_chg_pct, premarket_asof, ext_session) VALUES (?, ?, ?, ?, ?, ?)",
            [("AH", FRI, 55.0, 10.0, now, "post"),
             ("PRE", FRI, 51.0, 2.0, now, "pre"),
             ("OLDAH", FRI - 1, 40.0, -20.0, now, "post")])
        conn.commit()
    return state


def _ext():
    res = query.run_scan({"page_size": 50}, user_id="m1", user=MEMBER)
    return ({r["ticker"]: r["premarket_chg_pct"] for r in res["rows"]},
            res["snapshot"].get("premarket"))


def test_after_hours_serves_todays_after_hours_rows_only(ext):
    vals, block = _ext()
    assert vals == {"AH": 10.0, "PRE": None, "OLDAH": None}
    assert block["session"] == "post"


def test_a_weekend_holds_the_last_after_hours_print_whatever_its_age(ext):
    with snapshot_db.connect() as conn:                 # written Friday evening, long ago
        conn.execute(f"UPDATE {premarket.TABLE} SET premarket_asof = 1")
        conn.commit()
    ext["now"] = dt.datetime(2026, 10, 17, 12, 0, tzinfo=ET)       # Saturday
    vals, block = _ext()
    assert vals == {"AH": 10.0, "PRE": None, "OLDAH": None}
    assert block["session"] == "post"


def test_CONTROL_after_hours_a_dead_sweeper_serves_null(ext):
    """In the window the age rule holds; only a CLOSED market holds the last print."""
    with snapshot_db.connect() as conn:
        conn.execute(f"UPDATE {premarket.TABLE} SET premarket_asof = 1")
        conn.commit()
    vals, block = _ext()
    assert vals["AH"] is None


def test_in_the_session_nothing_is_served(ext):
    ext["now"] = dt.datetime(2026, 10, 16, 11, 0, tzinfo=ET)
    vals, block = _ext()
    assert set(vals.values()) == {None} and block is None


def test_a_table_from_before_ext_session_serves_null_and_never_errors(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "old.db"))
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "1")
    monkeypatch.setattr(live_tier, "_now_et",
                        lambda: dt.datetime(2026, 10, 16, 8, 42, tzinfo=ET))
    monkeypatch.setattr(query, "_COUNT_CACHE", None)
    snapshot_db.init_db()
    snapshot_db.upsert_rows([{"ticker": "AAA", "price": 1.0, "bars_asof": "20261015",
                              "snapshot_date": "2026-10-15", "built_at": 1}])
    with snapshot_db.connect() as conn:
        conn.execute("CREATE TABLE screener_premarket (ticker TEXT PRIMARY KEY, "
                     "session_ymd INTEGER, premarket_price REAL, premarket_chg_pct REAL, "
                     "premarket_asof REAL)")
        conn.execute(f"INSERT INTO screener_premarket VALUES ('AAA', {FRI}, 2, 2, "
                     f"{time.time()})")
        conn.commit()
    res = query.run_scan({"page_size": 5}, user_id="m1", user=MEMBER)
    assert res["rows"][0]["premarket_chg_pct"] is None
