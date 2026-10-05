"""FT-072 / FT-073 strategy screens (api/services/options_analytics/strategy_screens.py + routes),
built on COV-02's per-session screen file.

⛔ COUPLING, NAMED: COV-02 (`origin/lane/cov-02-03`) was not merged when this was written, so the
fixture below re-creates its `_SCHEMA` verbatim from that branch's
`api/services/research/options_screener.py` (scaled integers: strike x1000, OTM % x10 with + = out
of the money, IV in bp, delta x1000, bid/ask in cents, spread % x10). When COV-02 lands, a schema
change there must move here too; `test_the_fixture_schema_matches_cov02_when_it_is_present` checks
it the moment the module exists.

Hand-computed (spot 100, every contract 30 days out):
  covered calls  C100 bid 3.00 -> 3.0% x 365/30 = 36.5% ; C105 bid 1.20 -> 14.6%, if called 6.2%
  cash puts      P95 bid 1.00 -> 1/95 = 1.05%, 12.8% annualized, breakeven 94.00, cushion 6.0%
  bull put       sell P95 @1.00, buy P92 @0.40: credit 0.60, risk 2.40, 25.0%, breakeven 94.40
  bear call      sell C105 @1.20, buy C108 @0.50: credit 0.70, risk 2.30, 30.4%, breakeven 105.70
  bull call      buy C100 @3.10, sell C105 @1.20: debit 1.90, max 3.10, 1.63 : 1, breakeven 101.90
"""
from __future__ import annotations

import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services.options_analytics import strategy_screens as ss

COV02_SCHEMA = """
CREATE TABLE contracts (
  contract TEXT NOT NULL, underlying TEXT NOT NULL, exp INTEGER NOT NULL,
  dte INTEGER NOT NULL, cp TEXT NOT NULL, strike_m INTEGER NOT NULL,
  otm_d INTEGER, iv_bp INTEGER, delta_m INTEGER, bid_c INTEGER, ask_c INTEGER,
  spread_d INTEGER, oi INTEGER, vol INTEGER
);
CREATE TABLE underlyings (underlying TEXT PRIMARY KEY, price REAL);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
"""
PAID = {"id": "u1", "role": "member", "plan": "pro"}

#            cp  strike otm%  delta   bid   ask   oi
CONTRACTS = [("C", 100, 0.0, 0.50, 3.00, 3.10, 800),
             ("C", 105, 5.0, 0.25, 1.20, 1.30, 500),
             ("C", 108, 8.0, 0.15, 0.40, 0.50, 200),
             ("C", 120, 20.0, 0.03, 0.05, 0.10, 900),
             ("P", 95, 5.0, -0.25, 1.00, 1.10, 300),
             ("P", 92, 8.0, -0.12, 0.30, 0.40, 200),
             ("P", 90, 10.0, -0.08, 0.20, 0.25, 50)]


def build(path):
    con = sqlite3.connect(path)
    con.executescript(COV02_SCHEMA)
    for cp, k, otm, d, b, a, oi in CONTRACTS:
        m = (a + b) / 2
        con.execute("INSERT INTO contracts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"O:TST261101{cp}{k * 1000:08d}", "TST", 20261101, 30, cp, k * 1000, round(otm * 10),
                     3000, round(d * 1000), round(b * 100), round(a * 100), round((a - b) / m * 1000), oi, None))
    con.execute("INSERT INTO underlyings VALUES ('TST', 100.0)")
    con.execute("INSERT INTO meta VALUES ('session', '2026-10-02')")
    con.commit()
    con.close()


@pytest.fixture
def db(tmp_path, monkeypatch):
    p = str(tmp_path / "screen.sqlite")
    build(p)
    monkeypatch.setattr(ss, "_screen_db", lambda: ("2026-10-02", p))
    return p


def test_covered_calls(db):
    r = ss.run("covered_calls")
    assert [(x["strike"], x["annualized_pct"]) for x in r["rows"]] == [(100.0, 36.5), (105.0, 14.6)]
    assert r["rows"][1]["if_called_pct"] == 6.2
    assert r["session"] == "2026-10-02" and r["data_basis"] == "end-of-day snapshot"


def test_cash_secured_puts(db):
    (p,) = ss.run("cash_secured_puts")["rows"]                      # P92: spread 28.6% > 15%
    assert (p["strike"], p["yield_on_cash_pct"], p["annualized_pct"], p["breakeven"], p["cushion_pct"]) == \
        (95.0, 1.05, 12.8, 94.0, 6.0)


def test_bull_put_spreads(db):
    (s,) = ss.run("bull_put_spreads")["rows"]
    assert (s["short"]["strike"], s["long"]["strike"], s["credit"], s["max_loss"], s["return_on_risk_pct"],
            s["breakeven"]) == (95.0, 92.0, 0.6, 2.4, 25.0, 94.4)


def test_bear_call_spreads(db):
    rows = ss.run("bear_call_spreads")["rows"]
    s = rows[0]
    assert (s["short"]["strike"], s["long"]["strike"], s["credit"], s["max_loss"], s["return_on_risk_pct"],
            s["breakeven"]) == (105.0, 108.0, 0.7, 2.3, 30.4, 105.7)
    assert all(r["width"] <= 5 for r in rows)                       # C108 -> C120 is 12 wide: refused


def test_bull_call_spreads(db):
    (s,) = ss.run("bull_call_spreads")["rows"]
    assert (s["long"]["strike"], s["short"]["strike"], s["debit"], s["max_profit"], s["reward_to_risk"],
            s["breakeven"]) == (100.0, 105.0, 1.9, 3.1, 1.63, 101.9)


def test_an_unknown_strategy_and_a_missing_store(db, monkeypatch):
    with pytest.raises(ss.BadQuery):
        ss.run("iron_condors")
    def nostore():
        raise ss.NoStore("the COV-02 screen store is not on this build")
    monkeypatch.setattr(ss, "_screen_db", nostore)
    with pytest.raises(ss.NoStore):
        ss.run("covered_calls")


def test_routes_are_dark_paid_and_name_a_missing_store(db, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: PAID
    c = TestClient(app)
    monkeypatch.delenv("OPTIONS_STRATEGY_SCREENS_ENABLED", raising=False)
    assert c.get("/api/options-screener/strategies").status_code == 404
    assert c.get("/api/options-screener/strategy/covered_calls").status_code == 404
    monkeypatch.setenv("OPTIONS_STRATEGY_SCREENS_ENABLED", "1")
    assert len(c.get("/api/options-screener/strategies").json()["strategies"]) == 5
    assert c.get("/api/options-screener/strategy/covered_calls?underlyings=TST").json()["matches"] == 2
    assert c.get("/api/options-screener/strategy/covered_calls?underlyings=NOPE").json()["matches"] == 0
    assert c.get("/api/options-screener/strategy/nope").status_code == 422
    monkeypatch.setattr(ss, "_screen_db", lambda: (_ for _ in ()).throw(ss.NoStore("the COV-02 screen store is not on this build")))
    r = c.get("/api/options-screener/strategy/covered_calls")
    assert r.status_code == 503 and "COV-02" in r.json()["detail"]


def test_the_fixture_schema_matches_cov02_when_it_is_present():
    try:
        from api.services.research import options_screener as cov02
    except ImportError:
        pytest.skip("COV-02 (lane/cov-02-03) is not merged on this build; the schema is copied above")
    norm = lambda s: " ".join(s.split())  # noqa: E731
    assert norm(cov02._SCHEMA) == norm(COV02_SCHEMA)
