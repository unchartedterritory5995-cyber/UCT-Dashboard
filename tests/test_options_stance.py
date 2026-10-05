"""FT-039 option stance (api/services/options_analytics/stance.py + route). No network: the chain,
IV rank and earnings date are stubs shaped like their real readers.

Hand-computed for O:TST261101C00100000 on 2026-10-02 (30 days), delta 0.45, bid 2.97 / ask 3.03
(spread 2.0% of the 3.00 mid), OI 500, IV rank 30, earnings 2026-10-28 (before expiry):
  iv_regime 0.70 · greeks_fit 1.00 · dte_fit 1.00 · liquidity 0.7 + 0.3 x 0.5 = 0.85 ·
  earnings_timing 0.30  ->  5 x 3.85 / 5 = 3.85
"""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services.options_analytics import stance as st

OCC = "O:TST261101C00100000"
TODAY = dt.date(2026, 10, 2)
ROW = {"contract": OCC, "type": "call", "strike": 100, "expiration": "2026-11-01", "bid": 2.97, "ask": 3.03,
       "delta": 0.45, "open_interest": 500}
PAID = {"id": "u1", "role": "member", "plan": "pro"}


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    monkeypatch.setattr(st, "_chain", lambda s, e: {"spot": 100.0, "expiration": e, "calls": [dict(ROW)], "puts": []})
    monkeypatch.setattr(st, "_rank", lambda s: {"iv_rank": 30.0, "rank_word": "Low"})
    monkeypatch.setattr(st, "_earnings", lambda s: "2026-10-28")


def test_the_decomposed_score_and_its_words():
    r = st.stance("TST", OCC, "bullish", today=TODAY)
    assert r["sub_scores"] == {"iv_regime": 0.7, "greeks_fit": 1.0, "dte_fit": 1.0, "liquidity": 0.85,
                               "earnings_timing": 0.3}
    assert r["fit_score"] == 3.85 and r["components_used"] == 5
    assert "earnings 2026-10-28 before expiry" in r["explanation"]
    assert r["label"] == "computed" and "Not advice" in r["disclaimer"]


def test_without_20_logged_sessions_iv_regime_is_not_computed_and_said(monkeypatch):
    monkeypatch.setattr(st, "_rank", lambda s: {"iv_rank": None, "sentence": "IV rank: 3 sessions logged, needs 20."})
    r = st.stance("TST", OCC, "bullish", today=TODAY)
    assert r["sub_scores"]["iv_regime"] is None and r["components_used"] == 4
    assert r["fit_score"] == 3.94                                        # 5 x (1 + 1 + 0.85 + 0.3) / 4
    assert "Not computed: iv regime (IV rank: 3 sessions logged, needs 20.)" in r["explanation"]


def test_a_call_for_a_bearish_view_has_no_greeks_fit():
    assert st.stance("TST", OCC, "bearish", today=TODAY)["sub_scores"]["greeks_fit"] == 0.0


@pytest.mark.parametrize("days,fit", [(7, 0.0), (18.5, 0.5), (30, 1.0), (60, 1.0), (120, 0.5), (180, 0.0)])
def test_dte_fit_shape(days, fit):
    assert st.dte_fit(days) == pytest.approx(fit)


def test_the_route_is_dark_paid_and_validates(monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: PAID
    c = TestClient(app)
    url = f"/api/research/options/TST/stance?contract={OCC}"
    monkeypatch.delenv("OPTIONS_STANCE_ENABLED", raising=False)
    assert c.get(url).status_code == 404
    monkeypatch.setenv("OPTIONS_STANCE_ENABLED", "1")
    assert c.get(url).status_code == 200
    assert c.get(url + "&direction=sideways").status_code == 422
    assert c.get("/api/research/options/TST/stance?contract=O:SPY261101C00100000").status_code == 422
    assert c.get("/api/research/options/TST/stance?contract=O:TST261101C00500000").status_code == 422   # not in chain


def test_a_class_share_contract_is_scored_not_refused(monkeypatch):
    """O9: OCC writes BRK.B's root as BRKB; the stance used to 422 it as another underlying."""
    occ = "O:BRKB261101C00100000"
    monkeypatch.setattr(st, "_chain", lambda s, e: {"spot": 100.0, "expiration": e,
                                                    "calls": [{**ROW, "contract": occ}], "puts": []})
    r = st.stance("BRK.B", occ, "bullish", today=TODAY)
    assert r["fit_score"] == 3.85
    with pytest.raises(ValueError):
        st.stance("BRK.B", "O:BRKA261101C00100000", "bullish", today=TODAY)
