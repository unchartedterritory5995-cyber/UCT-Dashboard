"""Confluence Radar board (confluence_screen.compute_board) — the join gate.

Guards the 2026-09-12 silent-zero: the dark-pool feed cut BBS -> Massive on
7/24, and the Massive ingest writes a BLANK SecurityType. The board's join used
to require `securityType == "Equity"`, so once the last BBS row aged out of the
trailing 30-trading-day window every name failed the gate and the board went to
0 (ok:true, no warning). The fix drops the dead securityType gate and excludes
ETFs via the EOD card's live FMP `isEtf` classifier instead.

These stub the two data legs (flow + dark-pool aggregate) and the profile
classifier, then assert the gate's behaviour end-to-end through compute_board.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import confluence_screen as cs
from api import darkpool_eod


# ── fixtures ──────────────────────────────────────────────────────────────────
def _flow_name(net=5_000_000, bull=5_000_000, bear=0,
               leap_prem=6_000_000, leap_share=0.5):
    """One name's entry in the flow leg (shape confluence_flow returns)."""
    return {
        "net": net, "bull": bull, "bear": bear, "bullPct": 73,
        "leap_prem": leap_prem, "leap_share": leap_share,
        "top": {"cp": "C", "strike": 130, "exp": "6/17/27", "dte": "180",
                "prem": 6_000_000},
    }


def _dp_item(t, cat="Large Cap", n=30_000_000, acc="Acc", sectype="", sector=""):
    """One ticker's entry in the dark-pool 30d aggregate (allItems shape).

    `sectype`/`sector` default BLANK — the Massive-feed reality the fix targets.
    """
    return {
        "t": t, "cat": cat, "n": n, "accDist": acc,
        "securityType": sectype, "sector": sector,
        "bigPrintN": 188_000_000, "bigPrintDate": "09/01",
    }


def _run_board(monkeypatch, names, dp_items, meta_fn, override=None):
    """Compute the board with the two data legs + profile classifier stubbed."""
    monkeypatch.setattr(cs, "_flow_leg",
                        lambda cap, days: {"ok": True, "names": dict(names)})
    monkeypatch.setattr(cs.dpa, "is_window_warm", lambda **kw: True)
    monkeypatch.setattr(
        cs.dpa, "get_aggregated",
        lambda **kw: {"allItems": list(dp_items), "meta": {"dateRange": "Test"}})
    monkeypatch.setattr(darkpool_eod, "_ticker_meta", meta_fn)
    if override is not None:
        monkeypatch.setattr(darkpool_eod, "_ETF_OVERRIDE", override)
    return cs.compute_board()


# ── the regression ────────────────────────────────────────────────────────────
def test_blank_securityType_equity_still_surfaces(monkeypatch):
    """THE 9/12 bug: a real equity with blank securityType must still make the
    board. Pre-fix this returned counts.total == 0."""
    board = _run_board(
        monkeypatch,
        names={"AAA": _flow_name()},
        dp_items=[_dp_item("AAA", sectype="", sector="")],
        meta_fn=lambda s: {"sector": "Technology", "isEtf": False},
    )
    assert board["ok"] is True
    assert board["counts"]["total"] == 1
    assert [r["sym"] for r in board["rows"]] == ["AAA"]
    assert board["rows"][0]["band"] == "L"


def test_isEtf_survivor_is_excluded(monkeypatch):
    """An ETF the cat-band's hardcoded lists miss (mis-sized into a cap band) is
    dropped by the live isEtf classifier once it clears the numeric gates."""
    board = _run_board(
        monkeypatch,
        names={"AAA": _flow_name(), "XLQ": _flow_name()},
        dp_items=[_dp_item("AAA"), _dp_item("XLQ")],
        meta_fn=lambda s: {"sector": "Technology", "isEtf": s == "XLQ"},
    )
    assert {r["sym"] for r in board["rows"]} == {"AAA"}
    assert board["counts"]["total"] == 1


def test_sector_backfilled_from_profile_when_blank(monkeypatch):
    """Blank DP sector (Massive stub) is filled from the profile call."""
    board = _run_board(
        monkeypatch,
        names={"AAA": _flow_name()},
        dp_items=[_dp_item("AAA", sector="")],
        meta_fn=lambda s: {"sector": "Technology", "isEtf": False},
    )
    assert board["rows"][0]["sector"] == "Technology"


def test_dp_sector_is_kept_when_present(monkeypatch):
    """A real DP sector is NOT clobbered by the profile's sector."""
    board = _run_board(
        monkeypatch,
        names={"AAA": _flow_name()},
        dp_items=[_dp_item("AAA", sector="Energy")],
        meta_fn=lambda s: {"sector": "Technology", "isEtf": False},
    )
    assert board["rows"][0]["sector"] == "Energy"


def test_known_etf_cat_dropped_by_band(monkeypatch):
    """A known ETF/index (cat not Large/Mid/Small) is still dropped by the
    cat-band, independent of the profile — the first-line ETF guard survives."""
    board = _run_board(
        monkeypatch,
        names={"SPY": _flow_name()},
        dp_items=[_dp_item("SPY", cat="Indexes")],
        meta_fn=lambda s: {"sector": None, "isEtf": False},  # even if profile disagrees
    )
    assert board["ok"] is True
    assert board["counts"]["total"] == 0


def test_etf_override_excludes(monkeypatch):
    """A name in _ETF_OVERRIDE is dropped before any profile call."""
    board = _run_board(
        monkeypatch,
        names={"AAA": _flow_name()},
        dp_items=[_dp_item("AAA")],
        meta_fn=lambda s: {"sector": "Technology", "isEtf": False},
        override={"AAA"},
    )
    assert board["counts"]["total"] == 0


def test_failsoft_profile_error_never_drops_a_name(monkeypatch):
    """A raising profile classifier degrades to 'keep the name, no backfill' —
    it must never empty the board (the fail-soft the comment promises)."""
    def _boom(_s):
        raise RuntimeError("FMP down")

    board = _run_board(
        monkeypatch,
        names={"AAA": _flow_name()},
        dp_items=[_dp_item("AAA", sector="")],
        meta_fn=_boom,
    )
    assert board["counts"]["total"] == 1
    assert board["rows"][0]["sector"] is None  # no backfill, but survived


def test_below_dp_floor_is_dropped(monkeypatch):
    """Sanity: the numeric gates still bite — a sub-$25M dark-pool name is out."""
    board = _run_board(
        monkeypatch,
        names={"AAA": _flow_name()},
        dp_items=[_dp_item("AAA", n=10_000_000)],  # < DP_MIN ($25M)
        meta_fn=lambda s: {"sector": "Technology", "isEtf": False},
    )
    assert board["counts"]["total"] == 0
