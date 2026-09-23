"""CANONICAL UCT START (2026-03-23) — design rails. NOT merged, NOT deployed.

UCT has truthful point-in-time membership only from the collector's first live snapshot.
Nothing earlier is canonical: not merged, not served, not substituted from another universe,
and the member-facing symbol series simply begins there.
"""
import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_ohlc_sync as bridge
from api.services import breadth_universes as bu
from tests.test_breadth_v2_merge_precedence import _make_snap, fresh_store  # noqa: F401

M = "pct_above_50sma"


@pytest.fixture(autouse=True)
def _cutover_switch_on(monkeypatch):
    monkeypatch.setenv("BREADTH_CANONICAL_START", "1")


def _put(u, d, v, src="close_recon"):
    store._ensure_init()
    with store._conn() as c:
        c.execute("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at) "
                  "VALUES(?,?,?,?,?,?,?,?,datetime('now'))", (u, d, M, v, v, v, v, src))


def test_the_switch_off_is_todays_behaviour(fresh_store, monkeypatch):
    monkeypatch.setenv("BREADTH_CANONICAL_START", "")
    _put("uct", "2015-08-24", 10.0)
    assert "2015-08-24" in store.history(M, universe="uct")


def test_the_one_authority():
    assert bu.canonical_start("uct") == "2026-03-23"
    assert bu.canonical_start("us") == "" and bu.canonical_start("nyse") == ""


def test_no_merge_introduces_a_canonical_uct_row_before_the_start(fresh_store, tmp_path):
    snap = str(tmp_path / "s.db")
    _make_snap(snap, [("uct", "2026-03-20", M, 40.0, 41.0, 39.0, 40.0, "intraday_recon_1m"),
                      ("uct", "2026-03-23", M, 42.0, 43.0, 41.0, 42.0, "intraday_recon_1m"),
                      ("us", "2026-03-20", M, 30.0, 31.0, 29.0, 30.0, "intraday_recon_1m")])
    assert bridge._merge_from(snap) == 2
    with store._conn() as c:
        rows = set(c.execute("SELECT universe, date FROM breadth_daily_ohlc").fetchall())
    assert rows == {("uct", "2026-03-23"), ("us", "2026-03-20")}


def test_every_serving_reader_starts_uct_on_2026_03_23(fresh_store):
    for d, v in (("2015-08-24", 10.0), ("2026-03-20", 20.0), ("2026-03-23", 30.0), ("2026-03-24", 31.0)):
        _put("uct", d, v)
    _put("us", "2026-03-20", 99.0)                     # another universe HAS the date
    assert sorted(store.history(M, universe="uct")) == ["2026-03-23", "2026-03-24"]
    assert store.dates_since(universe="uct", since="2000-01-01") == ["2026-03-23", "2026-03-24"]
    assert store.distinct_dates_by_scan(universe="uct")[0] == "2026-03-23"
    assert set(store.closes_for_dates(["2015-08-24", "2026-03-20", "2026-03-23"], universe="uct")) == {"2026-03-23"}
    assert store.metric_before(M, "2026-03-24", universe="uct") == {"2026-03-23": 30.0}
    # no substitution: the US row for 03-20 never appears under UCT
    assert "2026-03-20" not in store.history(M, universe="uct")
    assert store.history(M, universe="us") == {"2026-03-20": {"o": 99.0, "h": 99.0, "l": 99.0, "c": 99.0}}


def test_the_member_facing_series_begins_on_the_first_pit_session(fresh_store, monkeypatch):
    from api.services import breadth_monitor, breadth_symbols as bs
    _put("uct", "2015-08-24", 10.0)
    _put("uct", "2026-03-23", 30.0)
    monkeypatch.setattr(breadth_monitor, "get_history", lambda n=0: [
        {"date": "2026-03-24", M: 32.0}, {"date": "2026-03-20", M: 21.0}, {"date": "2026-01-02", M: 5.0}])
    series = bs._build_breadth_series("UCTA50", M, "uct")
    assert [b["t"] for b in series] == ["2026-03-23", "2026-03-24"]
    assert series[0]["o"] == series[0]["c"] == 30.0          # no earlier value stretched backward
