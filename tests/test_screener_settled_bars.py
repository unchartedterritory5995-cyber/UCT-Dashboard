"""The nightly build publishes the SETTLED newest daily bar, not an intraday snapshot.

`bars.db`'s newest daily bar can be a chart-view snapshot (`bars_sqlite._delta_daily`
replaces today's bar; `ohlcv` has no settled flag), so ~10% of rows published a
newest-session volume >10% short of the final figure and `vol_ratio` landed on the
wrong side of members' thresholds. The build now fetches the settled previous
session for the whole market in ONE grouped-daily call and replaces a ticker's
newest bar with it, in memory. Provider stubbed throughout: no network here.
"""
import datetime
import importlib

import pytest

SESSION = datetime.date(2026, 10, 14)          # a Wednesday, an NYSE session
SESSION_YMD = 20261014


def _bars(last_v=500.0, last_c=10.0, last_h=10.5, last_l=9.5):
    """60 daily bars ending on SESSION; every prior session traded 1,000 shares."""
    out = []
    for i in range(60):
        d = SESSION - datetime.timedelta(days=59 - i)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": 10.0, "h": 10.5, "l": 9.5,
                    "c": 10.0, "v": 1000.0})
    out[-1].update({"v": last_v, "c": last_c, "h": last_h, "l": last_l})
    return out


def _settled(c=10.4, v=3000.0, h=10.9, l=9.4, o=10.0):
    return {"o": o, "h": h, "l": l, "c": c, "v": v}


@pytest.fixture
def build(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.delenv("SCREENER_SNAPSHOT_MAX_PER_RUN", raising=False)
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    from api.services import massive
    from api.services.screener import context_joins as cj
    state = {"universe": ["AAA", "BBB"], "bars": {}, "frame": None, "calls": []}

    def _frame(day_iso, adjusted=False, store=True, fresh=False):
        state["calls"].append({"day": day_iso, "adjusted": adjusted,
                               "store": store, "fresh": fresh})
        f = state["frame"]
        if isinstance(f, Exception):
            raise f
        return {"rows": dict(f or {}), "empty": not f}

    monkeypatch.setattr(massive, "get_grouped_daily_frame", _frame)
    monkeypatch.setattr(b, "settled_session", lambda now=None: SESSION)
    monkeypatch.setattr(b, "_load_universe", lambda: list(state["universe"]))
    monkeypatch.setattr(b, "_read_daily_bars",
                        lambda t: [dict(x) for x in state["bars"].get(t, [])])
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals",
                        lambda t, price=None, failures=None: {"company": "X"})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    for name in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, name, lambda targets, failures=None: {})

    def run():
        stats = b.run_build()
        return stats, db.get_rows(state["universe"])
    state["run"] = run
    state["b"], state["db"] = b, db
    return state


def test_a_partial_newest_volume_is_replaced_by_the_settled_one(build):
    build["bars"] = {"AAA": _bars(last_v=500.0), "BBB": _bars(last_v=500.0)}
    build["frame"] = {"AAA": _settled(v=3000.0, c=10.4), "BBB": _settled(v=1500.0)}
    stats, rows = build["run"]()
    assert rows["AAA"]["vol_ratio"] == 3.0          # 3000 / 1000, not 500 / 1000
    assert rows["BBB"]["vol_ratio"] == 1.5
    assert rows["AAA"]["price"] == 10.4             # the settled close, not 10.0
    assert stats["settled_bars"] == {
        "session": "2026-10-14", "fetched": 2, "applied": 2, "absent": 0,
        "not_session": 0, "incomplete": 0, "basis": 0}


def test_the_call_is_ONE_adjusted_uncached_whole_market_request(build):
    build["bars"] = {"AAA": _bars(), "BBB": _bars()}
    build["frame"] = {"AAA": _settled()}
    build["run"]()
    assert build["calls"] == [{"day": "2026-10-14", "adjusted": True,
                               "store": False, "fresh": True}]


def test_a_provider_failure_builds_exactly_as_today_and_says_so(build):
    build["bars"] = {"AAA": _bars(last_v=500.0), "BBB": _bars(last_v=500.0)}
    build["frame"] = RuntimeError("429 from the provider")
    stats, rows = build["run"]()
    assert rows["AAA"]["vol_ratio"] == 0.5          # the stored partial bar
    assert rows["AAA"]["price"] == 10.0
    assert stats["built"] == 2
    sb = stats["settled_bars"]
    assert sb["session"] == "2026-10-14" and "429" in sb["error"]
    assert "applied" not in sb


def test_an_empty_answer_is_recorded_as_an_error_not_as_zero_applied(build):
    build["bars"] = {"AAA": _bars(last_v=500.0), "BBB": _bars()}
    build["frame"] = {}
    stats, rows = build["run"]()
    assert rows["AAA"]["vol_ratio"] == 0.5
    assert "no rows" in stats["settled_bars"]["error"]


def test_a_ticker_absent_from_the_grouped_frame_keeps_its_own_bar(build):
    build["bars"] = {"AAA": _bars(last_v=500.0), "BBB": _bars(last_v=700.0)}
    build["frame"] = {"AAA": _settled(v=3000.0)}
    stats, rows = build["run"]()
    assert rows["AAA"]["vol_ratio"] == 3.0
    assert rows["BBB"]["vol_ratio"] == 0.7
    assert stats["settled_bars"]["applied"] == 1
    assert stats["settled_bars"]["absent"] == 1


def test_a_newest_bar_from_another_session_is_left_alone(build):
    old = _bars(last_v=500.0)[:-1]                  # newest bar is the day before
    build["bars"] = {"AAA": old, "BBB": _bars(last_v=500.0)}
    build["frame"] = {"AAA": _settled(v=9999.0), "BBB": _settled(v=3000.0)}
    stats, rows = build["run"]()
    assert rows["AAA"]["vol_ratio"] == 1.0          # untouched history
    assert stats["settled_bars"]["not_session"] == 1
    assert stats["settled_bars"]["applied"] == 1


def test_a_settled_bar_on_another_price_basis_is_refused(build):
    """A split between the session and the build moves the ADJUSTED frame onto the
    new basis while bars.db holds the old one; splicing it would fake a cliff."""
    build["bars"] = {"AAA": _bars(last_v=500.0, last_c=100.0, last_h=101.0, last_l=99.0),
                     "BBB": _bars()}
    build["frame"] = {"AAA": _settled(o=50.0, h=51.0, l=49.0, c=50.5, v=6000.0)}
    stats, rows = build["run"]()
    assert rows["AAA"]["price"] == 100.0
    assert rows["AAA"]["vol_ratio"] == 0.5
    assert stats["settled_bars"]["basis"] == 1


def test_a_grouped_row_with_a_hole_is_refused_rather_than_costing_the_bar(build):
    build["bars"] = {"AAA": _bars(last_v=500.0), "BBB": _bars()}
    build["frame"] = {"AAA": {"o": None, "h": 10.9, "l": 9.4, "c": 10.4, "v": 3000.0}}
    stats, rows = build["run"]()
    assert rows["AAA"]["vol_ratio"] == 0.5          # newest bar kept, not dropped
    assert rows["AAA"]["bars_asof"] == str(SESSION_YMD)
    assert stats["settled_bars"]["incomplete"] == 1


def test_the_receipt_persists_the_settled_counts(build):
    build["bars"] = {"AAA": _bars(), "BBB": _bars()}
    build["frame"] = {"AAA": _settled()}
    build["run"]()
    last = build["db"].last_build_run()
    assert last["settled_bars"]["applied"] == 1
    assert last["settled_bars"]["fetched"] == 1
    assert last["settled_bars"]["session"] == "2026-10-14"


def test_an_old_receipts_table_gains_the_column_and_keeps_its_rows(tmp_path, monkeypatch):
    import sqlite3
    path = tmp_path / "s.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE screener_build_runs (id INTEGER PRIMARY KEY "
                     "AUTOINCREMENT, started_at REAL, finished_at REAL, targets INTEGER, "
                     "built INTEGER, skipped INTEGER, errors INTEGER, empty_columns TEXT)")
        conn.execute("INSERT INTO screener_build_runs (targets, built, skipped, errors) "
                     "VALUES (5, 5, 0, 0)")
    db.record_build_run({"targets": 1, "built": 1, "skipped": 0, "errors": 0,
                         "settled_bars": {"session": None, "error": "x"}})
    with db.connect() as conn:
        n = conn.execute("SELECT COUNT(*) FROM screener_build_runs").fetchone()[0]
    assert n == 2
    assert db.last_build_run()["settled_bars"] == {"session": None, "error": "x"}


# ── the pure pieces ──────────────────────────────────────────────────────────

def test_settled_session_is_the_last_completed_session_before_today():
    from api.services import session_calendar as sc
    from api.services.screener import snapshot_builder as b
    at = lambda y, m, d, h=3: datetime.datetime(y, m, d, h, 0, tzinfo=sc.ET)  # noqa: E731
    assert b.settled_session(at(2026, 10, 15)) == datetime.date(2026, 10, 14)   # Thu -> Wed
    assert b.settled_session(at(2026, 10, 12)) == datetime.date(2026, 10, 9)    # Mon -> Fri
    assert b.settled_session(at(2026, 10, 14, 17)) == datetime.date(2026, 10, 13)
    # The control that proves the calendar is consulted, not a weekday rule:
    # Thanksgiving 2026 is Thu 11/26, so a Friday-morning build settles Wednesday.
    assert not sc.is_trading_day(datetime.date(2026, 11, 26))
    assert b.settled_session(at(2026, 11, 27)) == datetime.date(2026, 11, 25)


def test_settled_bar_outcome_never_mutates_the_bar_it_was_handed():
    from api.services.screener import snapshot_builder as b
    bars = _bars(last_v=500.0)
    original = bars[-1]
    assert b.settled_bar_outcome(bars, _settled(v=3000.0), SESSION_YMD) == "applied"
    assert original["v"] == 500.0 and bars[-1]["v"] == 3000.0
    assert bars[-1]["t"] == SESSION_YMD
