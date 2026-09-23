"""PRECEDENCE RAILS for the V2c2 cutover design (NOT merged, NOT deployed).

live > intraday_recon_1m > intraday_recon_1m_body > intraday_recon > close_recon, from ONE
ordered list (`breadth_daily_ohlc.SOURCE_PRECEDENCE`) that the serving allow-list, the merge
rank and the merge gate are all derived from.
"""
import itertools

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_ohlc_sync as bridge
from tests.test_breadth_v2_merge_precedence import _make_snap, _rows, fresh_store  # noqa: F401

ORDER = ("live", "intraday_recon_1m", "intraday_recon_1m_body", "intraday_recon", "close_recon")
KEY = ("2026-05-15", "pct_above_50sma")


def _candle(src):
    v = {"live": 50.0, "intraday_recon_1m": 40.0, "intraday_recon_1m_body": 30.0,
         "intraday_recon": 20.0, "close_recon": 10.0}[src]
    return (v, v + 1.0, v - 1.0, v) if not src.endswith(("_body", "close_recon")) else (v, v, v, v)


def _seed(src):
    store._ensure_init()
    o, h, l, c = _candle(src)
    with store._conn() as cn:
        cn.execute("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at) "
                   "VALUES('uct',?,?,?,?,?,?,?, '2000-01-01 00:00:00')", (*KEY, o, h, l, c, src))


def test_one_list_drives_serving_rank_and_gate():
    assert store.SOURCE_PRECEDENCE == ORDER
    assert store._TRUSTED_SOURCES == ORDER
    for s in ORDER:
        assert "'%s'" % s in bridge._SOURCE_GATE and "WHEN '%s'" % s in bridge._RANK


@pytest.mark.parametrize("local,incoming", list(itertools.permutations(ORDER, 2)))
def test_every_pair_resolves_by_precedence(fresh_store, tmp_path, local, incoming):
    """30 ordered pairs: the higher-precedence source always ends up stored, whichever side
    it arrives on, and a lower one never downgrades it (1m beats body, body beats the
    defective 30 m sweep, live beats every reconstruction, close_recon is lowest)."""
    _seed(local)
    snap = str(tmp_path / "s.db")
    _make_snap(snap, [("uct", *KEY, *_candle(incoming), incoming)])
    bridge._merge_from(snap)
    winner = min(local, incoming, key=ORDER.index)
    assert _rows()[KEY][4] == winner


@pytest.mark.parametrize("src", ORDER)
def test_negative_control_every_accepted_source_is_adopted_and_served(fresh_store, tmp_path, src):
    """No source silently disappears: each is adopted (>0) into an empty store AND served."""
    snap = str(tmp_path / "s.db")
    _make_snap(snap, [("uct", *KEY, *_candle(src), src)])
    assert bridge._merge_from(snap) == 1, f"{src} filtered out of the merge"
    h = store.history(KEY[1], universe="uct")
    assert KEY[0] in h, f"{src} adopted but not served"


def test_a_research_universe_is_never_merged(fresh_store, tmp_path):
    snap = str(tmp_path / "s.db")
    _make_snap(snap, [("uct_backtest", *KEY, 40.0, 41.0, 39.0, 40.0, "intraday_recon_1m"),
                      ("us", *KEY, 40.0, 41.0, 39.0, 40.0, "intraday_recon_1m")])
    bridge._merge_from(snap)
    with store._conn() as cn:
        unis = {u for (u,) in cn.execute("SELECT DISTINCT universe FROM breadth_daily_ohlc")}
    assert "uct_backtest" not in unis


def test_an_unknown_source_is_still_refused(fresh_store, tmp_path):
    snap = str(tmp_path / "s.db")
    _make_snap(snap, [("uct", *KEY, 40.0, 41.0, 39.0, 40.0, "reconstruct")])
    assert bridge._merge_from(snap) == 0
