"""Chart IQ route gates and the engine's end-to-end run (api/routers/chart_iq.py, api/services/chart_iq).

Gates (read per call): CHART_IQ_ENABLED off -> 404 for everyone; on -> admins only; CHART_IQ_MEMBERS_ENABLED also on -> paid
members; a free account -> 402 with Chart IQ's own sentence. Members never receive the admin-only ``raw`` layer. The engine test
runs the REAL pipeline on a synthetic bars.db (no C:/data, no network), so the vendored package is proven importable and runnable
on the site's own data path.
"""
from __future__ import annotations

import math
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import chart_iq as R

ADMIN = {"id": "a1", "role": "admin", "plan": "pro"}
MEMBER = {"id": "m1", "role": "member", "plan": "pro"}
FREE = {"id": "f1", "role": "member", "plan": "free"}
FAKE = {"ticker": "ABC", "asof": "2026-10-30", "clean": [{"kind": "candle", "ptype": "UnR"}], "card": [["Trend", "Uptrend"]], "thesis": "t",
        "context": "", "rs": [], "candles": [], "cycle": [], "buydays": [], "gaps": [], "watches": [], "market": "", "raw": [{"kind": "hline"}]}


def client(user, monkeypatch, paid=True):
    app = FastAPI()
    app.include_router(R.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    monkeypatch.setattr(R, "is_paid_user", lambda u: paid)
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.delenv("CHART_IQ_ENABLED", raising=False)
    monkeypatch.delenv("CHART_IQ_MEMBERS_ENABLED", raising=False)
    from api.services.cache import TTLCache
    monkeypatch.setattr(R, "_CACHE", TTLCache(max_size=50))
    from api.services.chart_iq import pipeline
    monkeypatch.setattr(pipeline, "analyze", lambda sym, date=None: dict(FAKE, ticker=sym))


def test_off_is_404_for_everyone(monkeypatch):
    assert client(ADMIN, monkeypatch).get("/api/chart-iq/ABC").status_code == 404
    assert client(MEMBER, monkeypatch).get("/api/chart-iq/ABC").status_code == 404


def test_on_admin_only(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    r = client(ADMIN, monkeypatch).get("/api/chart-iq/ABC")
    assert r.status_code == 200 and r.json()["raw"] == FAKE["raw"]
    assert client(MEMBER, monkeypatch).get("/api/chart-iq/ABD").status_code == 404


def test_members_flag_needs_the_master_flag(monkeypatch):
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    assert client(MEMBER, monkeypatch).get("/api/chart-iq/ABC").status_code == 404


def test_members_on_and_raw_withheld(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    j = client(MEMBER, monkeypatch).get("/api/chart-iq/ABE").json()
    assert j["thesis"] == "t" and j["clean"] and "raw" not in j


def test_free_account_gets_402(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    monkeypatch.setenv("CHART_IQ_MEMBERS_ENABLED", "1")
    r = client(FREE, monkeypatch, paid=False).get("/api/chart-iq/ABC")
    assert r.status_code == 402 and "Chart IQ" in r.json()["detail"]


def test_bad_input_400(monkeypatch):
    monkeypatch.setenv("CHART_IQ_ENABLED", "1")
    c = client(ADMIN, monkeypatch)
    assert c.get("/api/chart-iq/ab;c").status_code == 400
    assert c.get("/api/chart-iq/ABC?date=10-30-2026").status_code == 400


def _bars_db(path):
    """~420 sessions of a trending stock with pullbacks, and SPY, as the site's ohlcv table."""
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    import datetime
    d = datetime.date(2025, 3, 3); rows = []
    k = 0
    while k < 420:
        if d.weekday() < 5:
            ts = int(d.strftime("%Y%m%d"))
            for t, base, amp in (("SPY", 500.0, 0.03), ("TST", 40.0, 0.12)):
                px = base * (1 + 0.0015 * k) * (1 + amp * math.sin(k / 9.0))
                o = px * (1 - 0.004 * math.sin(k)); c_ = px
                rows.append((t, "D", ts, o, max(o, c_) * 1.012, min(o, c_) * 0.988, c_, 1e6 * (1.5 + math.sin(k / 3.0))))
            k += 1
        d += datetime.timedelta(days=1)
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows); c.commit(); c.close()
    return rows[-1][2]


def test_real_engine_runs_on_the_site_data_path(tmp_path, monkeypatch):
    last = _bars_db(str(tmp_path / "bars.db"))
    monkeypatch.setenv("CHART_IQ_BARS_DB", str(tmp_path / "bars.db"))
    monkeypatch.setenv("INDUSTRY_MAP_DB_PATH", str(tmp_path / "missing_industry.db"))
    monkeypatch.undo()                                  # drop the fake analyze installed by the autouse fixture
    monkeypatch.setenv("CHART_IQ_BARS_DB", str(tmp_path / "bars.db"))
    monkeypatch.setenv("INDUSTRY_MAP_DB_PATH", str(tmp_path / "missing_industry.db"))
    from api.services.chart_iq import pipeline
    from api.services.chart_iq.engine import _db
    monkeypatch.setattr(_db, "_TL", type(_db._TL)())     # fresh per-thread connections for this test's database
    r = pipeline.analyze("TST")
    assert "error" not in r, r
    assert r["asof"] == "%s-%s-%s" % (str(last)[:4], str(last)[4:6], str(last)[6:])
    assert isinstance(r["clean"], list) and isinstance(r["card"], list) and r["thesis"]
    assert {"Trend", "Setup"} <= {k for k, _ in r["card"]}
    assert pipeline.analyze("NOPE").get("error")


def test_engine_carries_no_lab_paths():
    import pathlib
    root = pathlib.Path(R.__file__).resolve().parents[1] / "services" / "chart_iq"
    text = "".join(p.read_text(encoding="utf-8") for p in root.rglob("*.py"))
    for bad in ("C:/data", "owner_review_local", "TSDR", "similar_index", "ratings.json"):
        assert bad not in text, bad
