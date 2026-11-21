"""The deep RE-GRAFT route and job (api/services/bars_regraft.py, POST /api/admin/bars/regraft, 2026-11-21).

Synthetic stores and providers only; every price is invented.
  R1  dry_run writes NOTHING and reports per (ticker, tf) the rows a write would replace / add / keep / leave;
  R2  a proven join REPLACES pre-floor rows that sit on a third basis (the seam closes); the vendor era is unchanged;
  R3  an unproven join is add-only: held rows are kept, missing dates are filled;
  R4  the first provider fault STOPS the job: nothing is written for that ticker or after it;
  R5  throttled: one ticker every max(MIN_INTERVAL_S, interval_s), never after the last;
  R6  the route: PUSH_SECRET only, dry_run by default, <= MAX_TICKERS, tfs a subset of D/W/M, one job at a time."""
from __future__ import annotations

import datetime as dt

import pytest

from api.services import bars_fetch as F
from api.services import bars_regraft as R
from api.services import bars_sqlite as S


def _days(start, n):
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def _bars(days, closes, v=1000):
    return [{"t": t, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": v} for t, c in zip(days, closes)]


PRE = _days("2003-06-02", 60)          # yfinance only (before the floor)
POST = _days("2003-09-10", 40)          # both vendors
POST_PX = [20.0 + 0.1 * i for i in range(40)]


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_DB_PATH", str(tmp_path / "bars.db"))
    S.bump_db_epoch()
    S.init_db()
    with R._lock:
        R.STATE.clear()
        R.STATE["running"] = False
    yield tmp_path
    S.bump_db_epoch()


def _providers(monkeypatch, yf, massive, fault_on=None):
    """Monkeypatch the two vendors the deep fetch reads. `fault_on`: a ticker whose Massive call faults."""
    import api.services.massive as M
    from api.services import provider_fault_scope as PF

    def agg(ticker, *a, **k):
        if ticker == fault_on:
            PF.note(RuntimeError("massive 503"))
            return []
        return [{"t": int(dt.datetime.fromisoformat(b["t"]).replace(tzinfo=dt.timezone.utc).timestamp() * 1000),
                 "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]} for b in massive]
    monkeypatch.setattr(M, "get_agg_bars", agg)
    monkeypatch.setattr(F, "_fetch_daily_yf", lambda *a, **k: [dict(b) for b in yf])


def _closes(t):
    return {r[0]: r[4] for r in S.get_bars(t, "D", 10 ** 6)}


def _key(d):
    return int(d.replace("-", ""))


def _third_basis_store(t):
    """Pre-floor rows on a third basis (x0.5 of both vendors): the web-ADSK shape."""
    S.put_bars(t, "D", _bars(PRE, [5.0] * 60) + _bars(POST, POST_PX), date_tf=True)


def test_R1_a_dry_run_writes_nothing_and_reports_what_a_write_would_do(store, monkeypatch):
    _third_basis_store("DRY")
    before = S.get_bars("DRY", "D", 10 ** 6)
    _providers(monkeypatch, _bars(PRE, [10.0] * 60) + _bars(POST, POST_PX), _bars(POST, POST_PX))
    out = R.run(["DRY"], tfs=("D",), dry_run=True, sleep=lambda s: None)
    assert S.get_bars("DRY", "D", 10 ** 6) == before, "a dry run wrote"
    d = out["results"]["DRY"]["D"]
    held_pre = sum(1 for r in before if r[0] < 20030910)
    assert d["replace"] == held_pre and d["kept"] == 0 and "written" not in d


def test_R2_a_proven_join_replaces_third_basis_pre_floor_rows_and_closes_the_seam(store, monkeypatch):
    _third_basis_store("FIX")
    _providers(monkeypatch, _bars(PRE, [10.0] * 60) + _bars(POST, POST_PX), _bars(POST, POST_PX))
    out = R.run(["FIX"], tfs=("D",), dry_run=False, sleep=lambda s: None)
    c = _closes("FIX")
    assert all(c[_key(d)] == 10.0 for d in PRE if _key(d) in c), "the proven (same-basis) join replaced them"
    assert all(abs(c[_key(d)] - p) < 1e-9 for d, p in zip(POST, POST_PX) if _key(d) in c), "the vendor era is unchanged"
    assert out["results"]["FIX"]["D"]["written"] > 0 and out["stopped"] is None


def test_R3_an_unproven_join_keeps_held_rows_and_only_fills_dates(store, monkeypatch):
    S.put_bars("UNP", "D", _bars(PRE[:30], [5.0] * 30) + _bars(POST, POST_PX), date_tf=True)
    wander = _bars(POST, [20.0 + (i % 5) for i in range(40)])          # the ratio wanders: unproven
    _providers(monkeypatch, _bars(PRE, [10.0] * 60) + wander, _bars(POST, POST_PX))
    out = R.run(["UNP"], tfs=("D",), dry_run=False, sleep=lambda s: None)
    c = _closes("UNP")
    assert all(c[_key(d)] == 5.0 for d in PRE[:30] if _key(d) in c), "held rows kept"
    assert any(_key(d) in c and c[_key(d)] == 10.0 for d in PRE[30:]), "missing dates filled"
    assert out["results"]["UNP"]["D"]["kept"] > 0


def test_R4_the_first_provider_fault_stops_the_job(store, monkeypatch):
    _third_basis_store("AAA")
    _third_basis_store("BBB")
    before = {t: S.get_bars(t, "D", 10 ** 6) for t in ("AAA", "BBB")}
    _providers(monkeypatch, _bars(PRE, [10.0] * 60) + _bars(POST, POST_PX), _bars(POST, POST_PX), fault_on="AAA")
    out = R.run(["AAA", "BBB"], tfs=("D",), dry_run=False, sleep=lambda s: None)
    assert out["stopped"] and "AAA" in out["stopped"]
    assert {t: S.get_bars(t, "D", 10 ** 6) for t in ("AAA", "BBB")} == before, "nothing written after a fault"
    assert out["done"] == 0


def test_R5_one_ticker_per_interval_never_faster_and_not_after_the_last(store, monkeypatch):
    _providers(monkeypatch, _bars(PRE, [10.0] * 60) + _bars(POST, POST_PX), _bars(POST, POST_PX))
    slept = []
    R.run(["T1", "T2", "T3"], tfs=("D",), dry_run=True, interval_s=0.1, sleep=slept.append)
    assert slept == [R.MIN_INTERVAL_S, R.MIN_INTERVAL_S]


def _client(monkeypatch, secret="s3cret"):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import bars as bars_mod
    monkeypatch.setenv("PUSH_SECRET", secret)
    started = []
    monkeypatch.setattr(bars_mod._threading, "Thread",
                        lambda target, args, **k: type("T", (), {"start": lambda self: started.append(args)})())
    app = FastAPI()
    app.include_router(bars_mod.router)
    return TestClient(app), started


def test_R6_the_route_is_admin_only_dry_by_default_bounded_and_one_job_at_a_time(store, monkeypatch):
    c, started = _client(monkeypatch)
    assert c.post("/api/admin/bars/regraft", json={"tickers": ["CX"]}).status_code == 401
    assert c.post("/api/admin/bars/regraft", json={"tickers": ["CX"]},
                  headers={"Authorization": "Bearer nope"}).status_code == 401
    auth = {"Authorization": "Bearer s3cret"}
    assert c.post("/api/admin/bars/regraft", json={"tickers": []}, headers=auth).status_code == 400
    assert c.post("/api/admin/bars/regraft", json={"tickers": [f"T{i}" for i in range(R.MAX_TICKERS + 1)]},
                  headers=auth).status_code == 400
    assert c.post("/api/admin/bars/regraft", json={"tickers": ["CX"], "tfs": ["60"]}, headers=auth).status_code == 400
    r = c.post("/api/admin/bars/regraft", json={"tickers": ["cx", "CX", "bbd"]}, headers=auth)
    assert r.status_code == 200 and r.json()["dry_run"] is True, "dry_run is the default"
    assert started == [(["CX", "BBD"], ["D", "W", "M"], True, 5.0)]
    assert c.post("/api/admin/bars/regraft", json={"tickers": ["CX"], "dry_run": False}, headers=auth).status_code == 409
    assert c.get("/api/admin/bars/regraft-status", headers=auth).json()["running"] is True
    assert c.get("/api/admin/bars/regraft-status").status_code == 401
