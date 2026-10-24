"""The CLEAR price pin (api/services/deal_status.clear_pin): a +30% one-session gap, then a
collapsed band. It hides the MEMBER chart's drawings with a "Possible acquisition" marker and
feeds the pending set every candidate-picking consumer excludes (UCT20, the Top-5 pool); the
team chart keeps its drawings. An episodic-pivot gap followed by a tight flag is never held.

Synthetic bars only; no network, nothing under C:/data (the candidate query runs against a
throwaway SQLite file carrying the store's own index DDL).
"""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta

import pytest

from api.services import auto_structures, bars_sqlite, deal_status as ds
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_member_drawing_set import _flags, _get, calls  # noqa: F401  (fixture)

TODAY = date(2026, 10, 23)
_REAL_CANDIDATES = ds._clear_pin_candidates   # captured before the autouse fixture stubs it


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("CATALYST_NEWS_DB_PATH", str(tmp_path / "none_catalyst.db"))
    monkeypatch.setenv("COMPANY_NEWS_DB_PATH", str(tmp_path / "none_company.db"))
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    monkeypatch.setattr(ds, "_today", lambda: TODAY)
    monkeypatch.setattr(ds, "_delisted", lambda sym: False)
    monkeypatch.setattr(ds, "_clear_pin_candidates", lambda: frozenset())
    ds.reset_cache()
    yield
    ds.reset_cache()


def _ymd(i: int) -> int:
    return int((date(2026, 1, 2) + timedelta(days=i)).strftime("%Y%m%d"))


def _pre(n=40, px=30.0):
    """`n` ordinary sessions: about a 2.5% daily range, so a pre-gap ATR near 2.5%."""
    out = []
    for i in range(n):
        c = px + (0.4 if i % 2 else -0.4)
        out.append({"t": _ymd(i), "o": c, "h": c + 0.4, "l": c - 0.4, "c": c, "v": 1_000_000})
    return out


def deal_pin_bars(post=20, gap_px=45.0, wiggle=0.03):
    """A cash deal: +50% gap, a gap day inside 0.5%, then `post` sessions pinned at the price."""
    out = _pre()
    n = len(out)
    out.append({"t": _ymd(n), "o": gap_px, "h": gap_px + 0.1, "l": gap_px - 0.1, "c": gap_px,
                "v": 40_000_000})
    for j in range(post):
        c = gap_px + (wiggle if j % 2 else -wiggle)
        out.append({"t": _ymd(n + 1 + j), "o": c, "h": c + wiggle, "l": c - wiggle, "c": c,
                    "v": 3_000_000})
    return out


def ep_tight_flag_bars(post=20):
    """An episodic pivot: +40% gap on a wide gap day, then a TIGHT flag (about a 1.6% daily
    range, the whole flag inside 3%, so the band test alone would pass it). A momentum
    trader's best setup; only the collapsed-ATR and gap-day tests keep it drawn."""
    out = _pre()
    n = len(out)
    out.append({"t": _ymd(n), "o": 42.0, "h": 45.5, "l": 41.5, "c": 45.0, "v": 30_000_000})
    for j in range(post):
        c = 45.0 + (0.3 if j % 2 else -0.3)
        out.append({"t": _ymd(n + 1 + j), "o": c, "h": c + 0.35, "l": c - 0.35, "c": c,
                    "v": 4_000_000})
    return out


# -- the geometry --------------------------------------------------------------------------------

def test_a_settled_deal_pin_is_clear():
    pin = ds.clear_pin(deal_pin_bars())
    assert pin is not None and pin["tier"] == "settled"
    assert pin["gap_pct"] > 30 and pin["sessions_since_gap"] == 20


def test_a_fresh_pin_two_sessions_after_the_gap_is_clear():
    pin = ds.clear_pin(deal_pin_bars(post=2))
    assert pin is not None and pin["tier"] == "fresh" and pin["sessions_since_gap"] == 2


def test_an_episodic_pivot_then_a_tight_flag_is_not_a_pin():
    assert ds.clear_pin(ep_tight_flag_bars()) is None
    assert ds.clear_pin(ep_tight_flag_bars(post=2)) is None


def test_a_gap_under_thirty_percent_is_left_to_the_weak_price_only_read():
    assert ds.clear_pin(deal_pin_bars(gap_px=38.0)) is None      # +27%


def test_an_illiquid_print_is_never_a_clear_pin():
    bars = deal_pin_bars()
    for b in bars:
        b["v"] = 100
    assert ds.clear_pin(bars) is None


def test_a_pin_that_breaks_out_of_the_band_stops_holding():
    bars = deal_pin_bars()
    bars[-1] = dict(bars[-1], h=bars[-1]["c"] * 1.08, c=bars[-1]["c"] * 1.07)
    assert ds.clear_pin(bars) is None


# -- the chart hold ------------------------------------------------------------------------------

def test_member_hold_carries_the_possible_acquisition_marker_and_the_team_hold_does_not(monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(ds, "_bars_for", lambda sym: deal_pin_bars())
    m = auto_structures.deal_hold("ZZPN", member=True)
    assert m["pending"] is True and m["label"] == ds.CLEAR_PIN_LABEL
    assert m["label"] == "Possible acquisition, drawings hidden"
    assert m["source"] == ["clear_price_pin"]
    assert auto_structures.deal_hold("ZZPN") is None


def test_member_hold_leaves_an_ep_flag_drawn(monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(ds, "_bars_for", lambda sym: ep_tight_flag_bars())
    assert auto_structures.deal_hold("ZZEP", member=True) is None


def test_flag_off_never_reads_bars_for_the_clear_pin(monkeypatch):
    def boom(sym):
        raise AssertionError("bars read with DEAL_STATUS_ENABLED off")
    monkeypatch.setattr(ds, "_bars_for", boom)
    assert auto_structures.deal_hold("ZZPN", member=True) is None


def test_a_bars_error_never_hides_a_member_chart(monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    def boom(sym):
        raise RuntimeError("store exploded")
    monkeypatch.setattr(ds, "_bars_for", boom)
    assert auto_structures.deal_hold("ZZPN", member=True) is None


# -- the patterns route: member held, team path unchanged ----------------------------------------

def _not_pending(monkeypatch):
    monkeypatch.setattr(ds, "deal_status", lambda sym, bars=None: {
        "sym": sym, "pending": False, "possible": False, "source": [], "since": None,
        "price": None, "confidence": 0.0})


def test_route_member_gets_only_the_clear_pin_marker(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _not_pending(monkeypatch)
    monkeypatch.setattr(ds, "_bars_for", lambda sym: deal_pin_bars())
    body = _get(PAID_MEMBER).json()
    assert body["detections"] == [] and body["count"] == 0 and "structures" not in body
    assert body["deal_status"]["label"] == ds.CLEAR_PIN_LABEL


def test_route_admin_path_is_unchanged_by_a_clear_pin(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    want = _get(ADMIN).content
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _not_pending(monkeypatch)
    monkeypatch.setattr(ds, "_bars_for", lambda sym: deal_pin_bars())
    assert _get(ADMIN).content == want


def test_route_member_ep_flag_is_byte_identical_to_flag_off(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    want = _get(PAID_MEMBER).content
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _not_pending(monkeypatch)
    monkeypatch.setattr(ds, "_bars_for", lambda sym: ep_tight_flag_bars())
    assert _get(PAID_MEMBER).content == want


# -- downstream: the pending set (UCT20, Top-5 pool) ---------------------------------------------

def _bars_by_sym(sym):
    return {"ZZBZ": deal_pin_bars(post=2), "ZZEP": ep_tight_flag_bars()}.get(sym, [])


def test_a_brze_like_fresh_pin_joins_the_pending_set_and_an_ep_does_not(monkeypatch):
    monkeypatch.setattr(ds, "_clear_pin_candidates", lambda: frozenset({"ZZBZ", "ZZEP"}))
    monkeypatch.setattr(ds, "_bars_for", _bars_by_sym)
    got = ds.pending_deal_symbols()
    assert "ZZBZ" in got and "ZZEP" not in got


def test_uct20_leadership_drops_a_brze_like_pin_and_keeps_an_ep(monkeypatch):
    from api.services import engine
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(ds, "_clear_pin_candidates", lambda: frozenset({"ZZBZ", "ZZEP"}))
    monkeypatch.setattr(ds, "_bars_for", _bars_by_sym)
    rows = [{"ticker": "ZZEP"}, {"ticker": "ZZBZ"}, {"ticker": "AAA"}]
    monkeypatch.setattr(engine, "_leadership_as_pushed", lambda: list(rows))
    assert engine.get_leadership() == [rows[0], rows[2]]
    assert ds.is_pending("ZZBZ") and not ds.is_pending("ZZEP")


def test_flag_off_the_pending_set_excludes_nothing(monkeypatch):
    monkeypatch.setattr(ds, "_clear_pin_candidates", lambda: frozenset({"ZZBZ"}))
    monkeypatch.setattr(ds, "_bars_for", _bars_by_sym)
    assert ds.consumer_pending() == frozenset()


def test_a_scan_error_adds_nothing_and_keeps_the_hand_lists(monkeypatch):
    def boom():
        raise RuntimeError("index gone")
    monkeypatch.setattr(ds, "_clear_pin_candidates", boom)
    got = ds.pending_deal_symbols()
    assert "TECH" in got and "ZZBZ" not in got


# -- the candidate query, on the store's own schema ----------------------------------------------

def test_the_candidate_query_finds_both_tiers_and_skips_an_ordinary_name(monkeypatch, tmp_path):
    path = tmp_path / "bars.db"
    c = sqlite3.connect(str(path), check_same_thread=False)
    c.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
              "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
    for ddl in bars_sqlite.BARS_INDEX_DDL.values():
        c.execute(ddl)
    series = {"ZZST": deal_pin_bars(), "ZZBZ": deal_pin_bars(post=2), "ZZNO": _pre(61)}
    # every symbol ends on the same session (the query reads the market calendar)
    for sym, bars in series.items():
        shift = 61 - len(bars)
        for i, b in enumerate(bars):
            c.execute("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                      (sym, "D", _ymd(i + shift), b["o"], b["h"], b["l"], b["c"], b["v"]))
    c.commit()
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: c)
    got = _REAL_CANDIDATES()
    assert {"ZZST", "ZZBZ"} <= got and "ZZNO" not in got
