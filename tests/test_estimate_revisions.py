"""EEHSC: estimate revision breadth by sector (`api/services/estimate_revisions.py`, the market-wide read on
`api/routers/research_cov.py`).

Rails:
  * one stock, one window: up / down / held around the stated tolerance, collecting (too few snapshots to span the
    window), gap (no snapshot near an end), not comparable (no consensus, no upcoming quarter, a zero start); the
    quarter is the NEXT one after the newest snapshot, the same quarter at both ends; revenue reads its own column;
  * through the REAL store (`estimate_history.snapshot_symbol`, invented snapshots): every tracked symbol lands in one
    state and none is dropped; sectors come from the map GRPS reads, cleaned as GRPS cleans them; a symbol with no
    sector is counted under its own row; net breadth needs GRPS's floor; the three largest raises and cuts; the
    tracked count and where the symbols came from; two spellings of one stock are one;
  * held: a request never reads the store (one background read, then the held answer; `computing` while the first
    read runs; a second request in the refresh window reads nothing);
  * the route: dark = 404 before identity, 401 signed out, 402 free, 200 paid, 422 on a word it does not take, a
    plain def, and never a vendor call.
Every ticker, sector figure and date here is INVENTED (the tickers are checked against the site's universe).
"""
from __future__ import annotations

import inspect
import json
import threading
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import estimate_history as EH
from api.services import estimate_revisions as ER
from api.services import held_build
from api.services import group_stats as GS

ROOT = Path(__file__).resolve().parents[1]
FREE_USER = {"id": "rvb-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "rvb-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
ASOF = "2031-03-14"
D7 = "2031-03-07"
D30 = "2031-02-12"
PE = "2031-03-31"          # the next quarter after ASOF
PE2 = "2031-06-30"
PAST = "2030-12-31"


@pytest.fixture(autouse=True)
def _store(monkeypatch, tmp_path):
    monkeypatch.delenv(EH.ENABLED_ENV, raising=False)
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))           # the held answer's copy on disk (speed pass 2)
    ER.reset_for_tests()
    yield
    ER.drain_for_tests()
    ER.reset_for_tests()


def _fetch(eps: dict, rev: dict | None = None):
    rows = [{"date": pe, "epsAvg": v, "revenueAvg": (rev or {}).get(pe, 2.0e9), "numAnalystsEps": 7} for pe, v in eps.items()]
    return lambda sym: ("ok", rows, None)


def _snap(sym: str, day: str, eps: dict, rev: dict | None = None, origin: str = "sp500") -> None:
    EH.track(sym, origin)
    EH.snapshot_symbol(sym, day, fetch=_fetch(eps, rev))


def _series(sym: str, e30, e7, e0, *, origin: str = "sp500", rev=(2.0e9, 2.0e9, 2.0e9)) -> None:
    """Three snapshots: 30 days before ASOF, 7 days before, and ASOF, each holding the next two quarters and a past one."""
    for day, e, r in ((D30, e30, rev[0]), (D7, e7, rev[1]), (ASOF, e0, rev[2])):
        _snap(sym, day, {PAST: 0.5, PE: e, PE2: 9.9}, {PAST: 1.0e9, PE: r, PE2: 3.0e9}, origin)


def _row(day, pe, eps, rev=None):
    return (day, pe, eps, rev)


# ── one stock (pure) ─────────────────────────────────────────────────────────────────────────

class TestClassify:
    def test_up_down_and_held_around_the_tolerance(self):
        assert ER.HELD_TOLERANCE_PCT == 0.5
        for end, state in ((1.00 * 1.0051, "up"), (1.0049, "held"), (1.0, "held"), (0.9951, "held"), (0.9949, "down")):
            rows = [_row(D30, PE, 1.0), _row(ASOF, PE, end)]
            got = ER.classify(rows, D30, ASOF, ASOF, 30, "eps")
            assert (end, got["state"]) == (end, state)
        rows = [_row(D30, PE, 2.0), _row(ASOF, PE, 2.5)]
        got = ER.classify(rows, D30, ASOF, ASOF, 30, "eps")
        assert got == {"state": "up", "reason": None, "pct": 25.0, "from": 2.0, "to": 2.5, "from_date": D30,
                       "to_date": ASOF, "period_end": PE}

    def test_a_negative_estimate_raised_toward_zero_is_up(self):
        got = ER.classify([_row(D30, PE, -0.40), _row(ASOF, PE, -0.20)], D30, ASOF, ASOF, 30, "eps")
        assert got["state"] == "up" and got["pct"] == 50.0

    def test_the_quarter_is_the_next_one_after_the_newest_snapshot_and_the_same_at_both_ends(self):
        rows = [_row(D30, PAST, 1.0), _row(D30, PE, 1.0), _row(D30, PE2, 1.0),
                _row(ASOF, PAST, 5.0), _row(ASOF, PE, 0.9), _row(ASOF, PE2, 3.0)]
        got = ER.classify(rows, D30, ASOF, ASOF, 30, "eps")
        assert (got["period_end"], got["state"], got["pct"]) == (PE, "down", -10.0)

    def test_revenue_reads_its_own_column(self):
        rows = [_row(D30, PE, 1.0, 100.0), _row(ASOF, PE, 1.0, 104.0)]
        assert ER.classify(rows, D30, ASOF, ASOF, 30, "eps")["state"] == "held"
        got = ER.classify(rows, D30, ASOF, ASOF, 30, "revenue")
        assert (got["state"], got["pct"], got["from"], got["to"]) == ("up", 4.0, 100.0, 104.0)

    def test_the_start_is_the_newest_snapshot_on_or_before_the_window_start(self):
        rows = [_row("2031-02-10", PE, 1.0), _row(D30, PE, 2.0), _row("2031-02-13", PE, 3.0), _row(ASOF, PE, 2.2)]
        got = ER.classify(rows, "2031-02-10", ASOF, ASOF, 30, "eps")
        assert (got["from_date"], got["from"], got["state"]) == (D30, 2.0, "up")
        # a weekend or a holiday: a snapshot up to SLACK_DAYS before the window's start counts, one more day does not
        assert ER.SLACK_DAYS == 4
        rows = [_row("2031-02-02", PE, 2.0), _row("2031-03-08", PE, 2.2)]          # the window starts 2031-02-06
        got = ER.classify(rows, "2031-02-02", "2031-03-08", "2031-03-08", 30, "eps")
        assert (got["from_date"], got["state"]) == ("2031-02-02", "up")
        rows = [_row("2031-02-01", PE, 2.0), _row("2031-03-08", PE, 2.2)]
        assert ER.classify(rows, "2031-02-01", "2031-03-08", "2031-03-08", 30, "eps")["state"] == "gap"

    def test_too_few_snapshots_are_collecting_with_the_day_they_began(self):
        got = ER.classify([], None, None, ASOF, 30, "eps")
        assert got["state"] == "collecting" and got["reason"].startswith("no snapshot yet")
        got = ER.classify([_row(D7, PE, 1.0), _row(ASOF, PE, 1.2)], D7, ASOF, ASOF, 30, "eps")
        assert got["state"] == "collecting" and got["reason"] == f"snapshots begin {D7}; a 30-day change needs one from {D30} or before"
        assert got["pct"] is None
        got = ER.classify([_row(ASOF, PE, 1.2)], ASOF, ASOF, ASOF, 7, "eps")
        assert got["state"] == "collecting"
        # the same stock spans the 7-day window
        assert ER.classify([_row(D7, PE, 1.0), _row(ASOF, PE, 1.2)], D7, ASOF, ASOF, 7, "eps")["state"] == "up"

    def test_a_gap_is_said_not_measured_over_a_longer_span(self):
        # the newest snapshot lags the store's newest by more than the slack
        got = ER.classify([_row(D30, PE, 1.0), _row("2031-03-09", PE, 1.3)], D30, "2031-03-09", ASOF, 30, "eps")
        assert got["state"] == "gap" and "2031-03-09" in got["reason"]
        # history is old enough, but nothing near the window's start: a 7-day change is not drawn from 30 days
        got = ER.classify([_row(D30, PE, 1.0), _row(ASOF, PE, 1.3)], D30, ASOF, ASOF, 7, "eps")
        assert got["state"] == "gap" and got["reason"] == "no snapshot between 2031-03-03 and 2031-03-07"
        assert got["pct"] is None

    def test_not_comparable_cases(self):
        got = ER.classify([_row(D30, PAST, 1.0), _row(ASOF, PAST, 1.1)], D30, ASOF, ASOF, 30, "eps")
        assert got["state"] == "not_comparable" and "no fiscal quarter ending after" in got["reason"]
        got = ER.classify([_row(D30, PE, 1.0), _row(ASOF, PE, None)], D30, ASOF, ASOF, 30, "eps")
        assert got["state"] == "not_comparable" and got["reason"] == f"no consensus for the quarter ending {PE} on {ASOF}"
        got = ER.classify([_row(D30, PE2, 1.0), _row(ASOF, PE, 1.1)], D30, ASOF, ASOF, 30, "eps")
        assert got["state"] == "not_comparable" and got["reason"] == f"no consensus for the quarter ending {PE} on {D30}"
        got = ER.classify([_row(D30, PE, 0.0), _row(ASOF, PE, 0.2)], D30, ASOF, ASOF, 30, "eps")
        assert got["state"] == "not_comparable" and "zero" in got["reason"] and got["pct"] is None


# ── the sectors (pure) ───────────────────────────────────────────────────────────────────────

def _stock(sym, sector, state, pct=None):
    res = {"state": state, "reason": None, "pct": pct, "from": None, "to": None, "from_date": None, "to_date": None,
           "period_end": None}
    return {"symbol": sym, "sector": sector, "results": {"eps:30": res}}


class TestSectorSlice:
    def test_counts_net_breadth_the_floor_and_the_order(self):
        stocks = ([_stock(f"ZQA{i}", "Alpha", "up", 1.0 + i) for i in range(4)] + [_stock("ZQB0", "Alpha", "down", -3.0),
                  _stock("ZQB1", "Alpha", "held", 0.1), _stock("ZQB2", "Alpha", "collecting")]
                  + [_stock(f"ZQC{i}", "Beta", "down", -1.0 - i) for i in range(5)]
                  + [_stock("ZQD0", "Gamma", "up", 9.0), _stock("ZQD1", "Gamma", "gap")]
                  + [_stock("ZQE0", None, "up", 2.0), _stock("ZQE1", None, "not_comparable")])
        sl = ER.sector_slice(stocks, "eps", 30)
        assert [s["name"] for s in sl["sectors"]] == ["Alpha", "Beta", "Gamma", ER.NO_SECTOR]
        alpha, beta, gamma, none = sl["sectors"]
        assert (alpha["members"], alpha["counted"], alpha["up"], alpha["down"], alpha["held"]) == (7, 6, 4, 1, 1)
        assert alpha["net"] == 50.0 and alpha["not_counted"] == {"collecting": 1, "gap": 0, "not_comparable": 0}
        assert beta["net"] == -100.0
        assert gamma["counted"] == 1 and gamma["net"] is None                     # fewer than GRPS's floor: no figure
        assert none["on_file"] is False and none["counted"] == 1
        assert [x["symbol"] for x in alpha["raises"]] == ["ZQA3", "ZQA2", "ZQA1"]
        assert [x["symbol"] for x in beta["cuts"]] == ["ZQC4", "ZQC3", "ZQC2"] and beta["raises"] == []
        assert [x["symbol"] for x in alpha["symbols"]] == ["ZQA3", "ZQA2", "ZQA1", "ZQA0", "ZQB1", "ZQB0", "ZQB2"]
        t = sl["total"]
        assert (t["members"], t["counted"], t["up"], t["down"], t["held"]) == (16, 13, 6, 6, 1)
        assert t["not_counted"] == {"collecting": 1, "gap": 1, "not_comparable": 1} and t["net"] == 0.0
        # every member is in exactly one state: none dropped
        assert sum(s["members"] for s in sl["sectors"]) == len(stocks)
        assert sum(len(s["symbols"]) for s in sl["sectors"]) == len(stocks)


# ── through the real store ───────────────────────────────────────────────────────────────────

GROUPS = {f"ZQT{i}": {"sector": "Technology", "industry": "Invented Chips"} for i in range(6)}
GROUPS.update({"ZQN0": {"sector": "  Energy  ", "industry": "Invented Oil"}, "ZQN1": {"sector": "Energy", "industry": None}})
GROUPS["BRK-Z"] = {"sector": "Financial   Services", "industry": "Invented"}


def _fill():
    _series("ZQT0", 1.00, 1.10, 1.20)            # +20% / +9.09%
    _series("ZQT1", 2.00, 2.00, 2.30)            # +15% / +15%
    _series("ZQT2", 1.00, 1.00, 1.001)           # held both
    _series("ZQT3", 1.00, 0.95, 0.90)            # -10% / -5.26%
    _series("ZQT4", 1.00, 1.04, 1.05, origin="viewed")      # +5% / +0.96%
    _snap("ZQT5", D7, {PE: 1.0}, origin="viewed")           # collecting at 30, up at 7
    _snap("ZQT5", ASOF, {PE: 1.5}, origin="viewed")
    _series("ZQN0", 3.0, 3.0, 2.4, rev=(5.0e9, 5.0e9, 5.5e9))   # EPS -20%, revenue +10%
    _series("ZQN1", 1.0, 1.0, 1.0)
    _series("ZQX0", 1.0, 1.0, 1.1)               # no sector on file
    EH.track("ZQX1", "viewed")                    # tracked, never snapshotted


def _build(monkeypatch):
    seen = []
    monkeypatch.setattr(GS, "_group_map", lambda: seen.append(1) or dict(GROUPS))
    answer, note = ER.build()
    assert seen == [1] and "tracked=" in note
    return answer


def test_fixture_tickers_are_not_stocks_the_site_follows():
    universe = set(json.loads((ROOT / "api" / "data" / "cap_universe.json").read_text(encoding="utf-8")))
    assert "NVDA" in universe                                   # the control: this is the ticker list
    for sym in [*GROUPS, "ZQX0", "ZQX1", "ZQA0", "ZQB0", "ZQC0", "ZQD0", "ZQE0"]:
        assert sym not in universe and sym.replace("-", ".") not in universe


def test_every_tracked_symbol_is_counted_once_by_the_map_grps_reads(monkeypatch):
    _fill()
    a = _build(monkeypatch)
    assert a["status"] == "ok" and a["asof"] == ASOF and a["covers_from"] == D30
    assert a["tracked"] == {"n": 10, "cap": EH.MAX_SYMBOLS, "origins": {"sp500": 7, "viewed": 3}, "no_sector": 2}
    assert a["tolerance_pct"] == 0.5 and a["min_counted"] == 5 and a["source"] == EH.SOURCE and a["map"] == GS.MAP_NAME
    sl = a["slices"]["eps:30"]
    names = [s["name"] for s in sl["sectors"]]
    assert names == ["Technology", "Energy", ER.NO_SECTOR]      # "  Energy  " is GRPS's "Energy" (group_stats._clean)
    tech, energy, none = sl["sectors"]
    assert (tech["members"], tech["counted"], tech["up"], tech["down"], tech["held"]) == (6, 5, 3, 1, 1)
    assert tech["not_counted"]["collecting"] == 1 and tech["net"] == 40.0
    assert [r["symbol"] for r in tech["raises"]] == ["ZQT0", "ZQT1", "ZQT4"] and [r["symbol"] for r in tech["cuts"]] == ["ZQT3"]
    assert tech["raises"][0]["pct"] == 20.0
    assert (energy["members"], energy["counted"], energy["net"]) == (2, 2, None)     # below the floor: counts, no figure
    assert {x["symbol"]: x["state"] for x in none["symbols"]} == {"ZQX0": "up", "ZQX1": "collecting"}
    assert sl["total"]["members"] == 10 and sum(sl["total"]["not_counted"].values()) + sl["total"]["counted"] == 10
    # the 7-day window: ZQT5 now spans it
    t7 = a["slices"]["eps:7"]["sectors"][0]
    assert t7["name"] == "Technology" and t7["counted"] == 6 and t7["not_counted"]["collecting"] == 0
    zqt5 = next(x for x in t7["symbols"] if x["symbol"] == "ZQT5")
    assert (zqt5["state"], zqt5["pct"], zqt5["from_date"], zqt5["to_date"]) == ("up", 50.0, D7, ASOF)
    # revenue is its own count
    rev = {s["name"]: s for s in a["slices"]["revenue:30"]["sectors"]}
    zqn0 = next(x for x in rev["Energy"]["symbols"] if x["symbol"] == "ZQN0")
    assert (zqn0["state"], zqn0["pct"]) == ("up", 10.0)


def test_two_spellings_of_one_stock_are_one_and_a_symbol_the_map_lacks_is_said(monkeypatch):
    _series("BRK.Z", 1.0, 1.0, 1.2)
    EH.track("BRK-Z", "viewed")
    a = _build(monkeypatch)
    assert a["tracked"]["n"] == 1 and sum(a["tracked"]["origins"].values()) == 1
    (fin,) = a["slices"]["eps:30"]["sectors"]
    assert fin["name"] == "Financial Services" and fin["symbols"][0]["symbol"] == "BRK-Z" and fin["symbols"][0]["state"] == "up"


def test_an_empty_store_is_an_answer_not_a_failure(monkeypatch):
    a = _build(monkeypatch)
    assert a["status"] == "ok" and a["tracked"]["n"] == 0 and a["asof"] is None
    assert all(s["sectors"] == [] and s["total"]["counted"] == 0 for s in a["slices"].values())
    EH.track("ZQX1", "viewed")
    a = _build(monkeypatch)
    assert a["tracked"]["n"] == 1 and a["slices"]["eps:7"]["sectors"][0]["not_counted"]["collecting"] == 1


def test_the_read_never_asks_the_vendor(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a vendor call on the read")
    monkeypatch.setattr(EH, "_fetch_fmp", boom)
    _fill()
    _build(monkeypatch)
    src = (ROOT / "api" / "services" / "estimate_revisions.py").read_text(encoding="utf-8")
    assert "fmp_client" not in src and "requests" not in src and "httpx" not in src and "snapshot_symbol" not in src


# ── held: a request never reads the store ────────────────────────────────────────────────────

def test_the_first_request_is_told_computing_at_once_and_after_one_read_the_next_reads_nothing(monkeypatch):
    # speed pass 2 (2026-11-24): the first request no longer waits on the read; it is told `computing` at once
    _fill()
    monkeypatch.setattr(GS, "_group_map", lambda: dict(GROUPS))
    reads = []
    real = ER.build
    monkeypatch.setattr(ER, "build", lambda previous=None, **k: reads.append(1) or real(previous, **k))
    assert ER.get_breadth("eps", 30) == {"status": "computing", "metric": "eps", "window": 30}
    ER.drain_for_tests()
    first = ER.get_breadth("eps", 30)
    assert first["status"] == "ok" and first["metric"] == "eps" and first["window"] == 30 and len(reads) == 1
    assert first["sectors"][0]["name"] == "Technology" and "slices" not in first and first["check"] is None
    monkeypatch.setattr(EH, "_conn", lambda: (_ for _ in ()).throw(AssertionError("the store was read on a request")))
    second = ER.get_breadth("revenue", 7)
    assert second["status"] == "ok" and (second["metric"], second["window"]) == ("revenue", 7) and len(reads) == 1


def test_while_the_first_read_runs_a_request_is_told_computing(monkeypatch):
    gate = threading.Event()
    monkeypatch.setattr(ER, "build", lambda previous=None, **k: (gate.wait(5), (
        {"status": "ok", "v": 1, "built_at": held_build.now_iso(), "slices": {}}, "x"))[1])
    monkeypatch.setattr(ER._held, "_wait_s", 0.05)
    got = ER.get_breadth("eps", 7)
    assert got == {"status": "computing", "metric": "eps", "window": 7}
    gate.set()
    ER.drain_for_tests()
    got = ER.get_breadth("eps", 7)
    assert got["status"] == "ok" and got["sectors"] == [] and got["total"]["counted"] == 0


def test_a_failed_read_is_said_and_a_word_it_does_not_take_is_refused(monkeypatch):
    monkeypatch.setattr(ER, "build", lambda previous=None, **k: (_ for _ in ()).throw(RuntimeError("disk")))
    assert ER.get_breadth("eps", 30)["status"] in ("computing", "failed")     # the read may fail before it answers
    ER.drain_for_tests()
    got = ER.get_breadth("eps", 30)
    assert got["status"] == "failed" and got["reason"] == "error" and got["window"] == 30
    assert ER.get_breadth("pe", 30)["status"] == "error" and ER.get_breadth("eps", 14)["status"] == "error"


def test_the_refresh_rule():
    import time
    assert ER._due({}, time.time() - ER.REFRESH_S - 1) is True
    assert ER._due({}, time.time() - 60) is False
    assert ER.REFRESH_S == 1800


# ── the route ────────────────────────────────────────────────────────────────────────────────

def _client(user, monkeypatch, *, armed=True):
    from api.routers import research_cov as route
    if armed:
        monkeypatch.setenv(EH.ENABLED_ENV, "1")
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_dark_paid_and_takes_only_its_words(monkeypatch):
    from api.routers import research_cov as route
    asked = []
    monkeypatch.setattr(ER, "get_breadth", lambda metric, window: asked.append((metric, window)) or {"status": "ok"})
    path = "/api/research/estimate-history"
    (r,) = [x for x in route.router.routes if x.path == path]
    assert r.methods == {"GET"} and route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.research_cov"
    assert not inspect.iscoroutinefunction(route.estimate_revisions_route)
    assert _client(PAID_USER, monkeypatch, armed=False).get(path).status_code == 404      # dark: before identity
    assert _client(None, monkeypatch, armed=False).get(path).status_code == 404
    assert _client(None, monkeypatch).get(path).status_code == 401
    refused = _client(FREE_USER, monkeypatch).get(path)
    assert refused.status_code == 402 and refused.json() == {"detail": "This Research tab requires a paid plan"}
    assert asked == []
    paid = _client(PAID_USER, monkeypatch)
    assert paid.get(path).json() == {"status": "ok"}
    assert paid.get(path + "?metric=revenue&window=7").status_code == 200
    assert asked == [("eps", 30), ("revenue", 7)]
    for bad in ("?metric=pe", "?window=14", "?window=7d", "?metric=EPS"):
        assert paid.get(path + bad).status_code == 422
    assert len(asked) == 2
    # the per-stock read is untouched beside it
    assert paid.get("/api/research/estimate-history/ZQT0").status_code == 200


def test_the_route_serves_the_held_answer_end_to_end(monkeypatch):
    _fill()
    monkeypatch.setattr(GS, "_group_map", lambda: dict(GROUPS))
    client = _client(PAID_USER, monkeypatch)
    assert client.get("/api/research/estimate-history?metric=eps&window=7").json()["status"] == "computing"
    ER.drain_for_tests()
    body = client.get("/api/research/estimate-history?metric=eps&window=7").json()
    assert body["status"] == "ok" and body["window"] == 7 and body["tracked"]["n"] == 10
    assert [s["name"] for s in body["sectors"]][-1] == ER.NO_SECTOR
    assert len(json.dumps(body)) < 20000
