"""BRK-08 positioning extensions (api/services/options_analytics/positioning.py,
positioning_vocab.py, and their routes): FT-047 vocabulary + levels, FT-049 heatmap, FT-050
Options Impact, FT-052 dealer short, FT-055 max pain + NOPE.

No network: the chain is tests/fixtures/options_analytics/chain_tst_schwab_shape.json (read its
`_provenance`), the dealer table is dealer_sample_tst.json, bars and the vendor ATM IV are stubs.
Every expected number is hand-computed in the comments from those files (spot 100, so one
gamma x OI unit is $10,000 per 1% move).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services.options_analytics import positioning as pos
from api.services.options_analytics import positioning_vocab as pv

FIX = pathlib.Path(__file__).parent / "fixtures" / "options_analytics"
CHAIN = json.loads((FIX / "chain_tst_schwab_shape.json").read_text(encoding="utf-8"))
DEALER = json.loads((FIX / "dealer_sample_tst.json").read_text(encoding="utf-8"))
PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "role": "member", "plan": "free"}
FLAGS = ("OPTIONS_GEX_HEATMAP_ENABLED", "OPTIONS_MAX_PAIN_ENABLED", "OPTIONS_NOPE_ENABLED",
         "OPTIONS_IMPACT_ENABLED", "OPTIONS_POSITIONING_VOCAB_ENABLED", "OPTIONS_DEALER_SHORT_ENABLED")
ROUTES = {
    "OPTIONS_GEX_HEATMAP_ENABLED": "/api/options/positioning/TST/heatmap",
    "OPTIONS_MAX_PAIN_ENABLED": "/api/options/positioning/TST/max-pain",
    "OPTIONS_NOPE_ENABLED": "/api/options/positioning/TST/nope",
    "OPTIONS_IMPACT_ENABLED": "/api/options/positioning/TST/impact",
    "OPTIONS_POSITIONING_VOCAB_ENABLED": "/api/options/positioning/TST/levels",
    "OPTIONS_DEALER_SHORT_ENABLED": "/api/options/positioning/TST/dealer-short",
}


def _bars(today_volume=100_000):
    """20 completed sessions at $100 x 1,000,000 shares ($100M ADV) plus today's bar."""
    et = pos._ET
    today = dt.datetime.now(et).date()
    out = []
    for i in range(25, 0, -1):
        d = today - dt.timedelta(days=i)
        ms = int(dt.datetime(d.year, d.month, d.day, 12, tzinfo=et).timestamp() * 1000)
        out.append({"t": ms, "c": 100.0, "v": 1_000_000})
    ms = int(dt.datetime(today.year, today.month, today.day, 12, tzinfo=et).timestamp() * 1000)
    out.append({"t": ms, "c": 100.0, "v": today_volume})
    return out


GEX = {"callWall": {"strike": 100.0, "gex": 330000}, "putWall": {"strike": 95.0, "gex": -160000},
       "zeroGamma": 97.123, "levels": {"call_wall": {"label": "Pin"}, "put_wall": {"label": "Floor"},
                                       "zero_gamma": {"label": "Gamma Flip"}}}


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    pos.clear_cache()
    calls = {"chain": 0}

    async def fetch(sym, f, t):
        calls["chain"] += 1
        return json.loads(json.dumps(CHAIN)), None, "massive"

    async def gex(sym, dte="all", adjusted=False, source=None):
        return dict(GEX)

    from api import gex_service
    monkeypatch.setattr(pos, "_fetch", fetch)
    monkeypatch.setattr(pos, "_bars", lambda s: _bars())
    monkeypatch.setattr(pos, "_atm", lambda s: {"iv": 0.252, "strike": 100.0,
                                               "expiration": "2026-10-09", "spot": 100.0})
    monkeypatch.setattr(pos, "_dealer_rows", lambda s: list(DEALER["rows"]))
    monkeypatch.setattr(gex_service, "get_gex_data", gex)
    yield calls
    pos.clear_cache()


def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


# ── dark + paid, ONE switch per surface ─────────────────────────────────────────

@pytest.mark.parametrize("flag", FLAGS)
def test_each_surface_is_dark_alone_and_arms_alone(flag, monkeypatch):
    for f in FLAGS:
        monkeypatch.delenv(f, raising=False)
    c = _client(PAID, monkeypatch)
    assert all(c.get(r).status_code == 404 for r in ROUTES.values())
    monkeypatch.setenv(flag, "1")
    for f, r in ROUTES.items():
        assert c.get(r).status_code == (200 if f == flag else 404), (flag, r)
    assert _client(FREE, monkeypatch).get(ROUTES[flag]).status_code == 402


def test_a_bad_symbol_or_window_is_refused(monkeypatch):
    monkeypatch.setenv("OPTIONS_MAX_PAIN_ENABLED", "1")
    c = _client(PAID, monkeypatch)
    assert c.get("/api/options/positioning/not%20a%20sym/max-pain").status_code == 422
    assert c.get("/api/options/positioning/TST/max-pain?dte=year").status_code == 422


def test_a_chain_failure_is_a_503_in_words(monkeypatch):
    monkeypatch.setenv("OPTIONS_GEX_HEATMAP_ENABLED", "1")

    async def bad(sym, f, t):
        return None, "Massive API error: 429", "massive"
    monkeypatch.setattr(pos, "_fetch", bad)
    r = _client(PAID, monkeypatch).get("/api/options/positioning/TST/heatmap")
    assert r.status_code == 503 and "429" in r.json()["detail"]


# ── FT-049 heatmap ────────────────────────────────────────────────────────────

def test_heatmap_cells_are_net_gex_by_expiry_and_strike():
    h = asyncio.run(pos.heatmap("TST"))
    assert h["expirations"] == ["2026-10-09", "2026-10-16"]
    assert h["strikes"] == [90.0, 95.0, 100.0, 105.0]
    # 95: call .02x100 -> +20,000; put .04x400 -> -160,000
    assert h["cells"][0] == [None, -140_000, 150_000, 80_000]
    assert h["cells"][1] == [-60_000, None, 80_000, None]       # blank = no contract, never 0
    assert h["max_abs"] == 150_000
    assert h["contracts_missing_gamma_or_oi"] == 1                # the 110 call
    assert h["label"] == "computed" and h["chain_source"] == "massive"


# ── FT-055 max pain ───────────────────────────────────────────────────────────

def test_max_pain_is_the_strike_of_least_payout_per_expiry():
    m = asyncio.run(pos.max_pain("TST"))
    front, back = m["expirations"]
    # K=95 -> 150,000; K=100 -> 75,000; K=105 -> 350,000
    assert front == {"expiration": "2026-10-09", "max_pain": 100.0, "payout_at_max_pain": 75_000,
                     "call_oi": 900, "put_oi": 650, "strikes_counted": 3, "distance_pct": 0.0}
    assert back["max_pain"] == 90.0
    assert m["contracts_missing_oi"] == 1
    assert "within 15% of spot" in m["band_note"]


# ── FT-055 NOPE ───────────────────────────────────────────────────────────────

def test_nope_is_net_option_delta_over_share_volume():
    n = asyncio.run(pos.nope("TST"))
    # calls 8 + 100 + 10 + 10.4 ; puts -25 - 40 - 4 ; x100 = 5,940 shares
    assert n["net_option_delta_shares"] == 5_940
    assert n["contracts_counted"] == 7 and n["contracts_missing_delta_or_volume"] == 1
    assert n["share_volume"] == 100_000
    assert n["nope"] == 5.94


def test_nope_without_todays_share_volume_says_so_never_a_number(monkeypatch):
    bars = _bars()[:-1]                                           # no bar for today
    monkeypatch.setattr(pos, "_bars", lambda s: bars)
    n = asyncio.run(pos.nope("TST"))
    assert n["nope"] is None and "needs today's traded shares" in n["nope_note"]


def test_an_empty_bar_read_is_unavailable_not_zero(monkeypatch):
    monkeypatch.setattr(pos, "_bars", lambda s: [])
    n = asyncio.run(pos.nope("TST"))
    assert n["nope"] is None and "unavailable" in n["nope_note"]


# ── FT-050 Options Impact ─────────────────────────────────────────────────────

def test_impact_is_gamma_notional_over_dollar_volume():
    i = asyncio.run(pos.impact("TST"))
    assert i["gamma_notional_per_1pct"] == 770_000
    assert i["adv_dollars"] == 100_000_000 and i["adv_sessions"] == 20
    assert i["impact_ratio"] == 0.0077 and i["band"] == "low"
    assert "uncalibrated" in i["method"]


def test_impact_bands_move_with_the_ratio(monkeypatch):
    thin = [dict(b, v=1_000) for b in _bars()]                   # $100K ADV -> ratio 7.7
    monkeypatch.setattr(pos, "_bars", lambda s: thin)
    assert asyncio.run(pos.impact("TST"))["band"] == "high"


# ── FT-047 vocabulary + levels ────────────────────────────────────────────────

#: Version 1, pinned. Changing a word or the order without bumping the version is the defect.
V1 = (("call_wall", "Call Wall"), ("put_wall", "Put Wall"), ("zero_gamma", "Zero Gamma"),
      ("absolute_gamma_strike", "Absolute Gamma Strike"), ("key_delta_strike", "Key Delta Strike"),
      ("max_pain", "Max Pain"), ("implied_move_1d", "Implied 1-Day Move"),
      ("implied_move_5d", "Implied 5-Day Move"), ("dealer_short", "Dealer Short"),
      ("options_impact", "Options Impact"))


def test_the_vocabulary_is_closed_versioned_and_pinned():
    v = pv.vocabulary()
    assert v["version"] == pv.POSITIONING_VOCABULARY_VERSION == 1 and v["closed"] is True
    assert tuple((t["id"], t["label"]) for t in v["terms"]) == V1
    assert all(t["definition"] for t in v["terms"])
    with pytest.raises(KeyError):
        pv.label_of("volatility_trigger")                       # no improvised words


def test_levels_speak_only_the_vocabulary_and_carry_the_gex_role():
    lv = asyncio.run(pos.levels("TST"))
    by = {r["id"]: r for r in lv["levels"]}
    assert all(r["label"] == pv.label_of(r["id"]) for r in lv["levels"])
    assert by["call_wall"]["value"] == 100.0 and by["call_wall"]["role"] == "Pin"
    assert by["put_wall"]["value"] == 95.0 and by["zero_gamma"]["value"] == 97.12
    assert by["absolute_gamma_strike"]["value"] == 100.0           # 430,000 at 100
    assert by["key_delta_strike"]["value"] == 100.0                # 25,400 delta-shares at 100
    assert by["max_pain"]["value"] == 100.0
    assert by["implied_move_1d"]["value"] == 1.59                  # 100 x .252 x sqrt(1/252)
    assert by["implied_move_5d"]["value"] == 3.55
    assert lv["atm_iv"]["label"] == "vendor"


def test_levels_name_a_gex_failure_instead_of_blanking_silently(monkeypatch):
    from api import gex_service

    async def broken(*a, **k):
        return {"error": "Schwab not authenticated"}
    monkeypatch.setattr(gex_service, "get_gex_data", broken)
    lv = asyncio.run(pos.levels("TST"))
    by = {r["id"]: r for r in lv["levels"]}
    assert by["call_wall"]["value"] is None
    assert any("Schwab not authenticated" in n for n in lv["notes"])


# ── FT-052 dealer short ───────────────────────────────────────────────────────

def test_dealer_short_reads_the_latest_snapshot_and_explains_it():
    d = asyncio.run(pos.dealer_short("TST"))
    assert d["snapshot"] == "2026-10-02"
    assert [r["contract_key"] for r in d["dealer_short"]] == ["TST|C|100.0|10/9/2026", "TST|C|105.0|10/9/2026"]
    assert d["dealer_short"][0]["est_dealer_net"] == -220
    assert "net short 2 of the 3 largest" in d["summary"]
    assert "net short them" in d["explanation"]


def test_a_failed_dealer_read_is_a_503(monkeypatch):
    monkeypatch.setenv("OPTIONS_DEALER_SHORT_ENABLED", "1")
    monkeypatch.setattr(pos, "_dealer_rows", lambda s: None)
    r = _client(PAID, monkeypatch).get("/api/options/positioning/TST/dealer-short")
    assert r.status_code == 503 and "could not be read" in r.json()["detail"]


# ── one chain per (symbol, window), results cached ────────────────────────────

def test_a_result_is_cached_for_its_ttl(_stubs):
    asyncio.run(pos.heatmap("TST"))
    asyncio.run(pos.heatmap("TST"))
    assert _stubs["chain"] == 1


# ── O6: 30-day constant-maturity IV, max pain names its expiry ────────────────────────────────

def _cm_stub(monkeypatch, exps, iv_by_exp):
    from api.services import polygon_options as po
    monkeypatch.setattr(po, "list_expirations", lambda s: {"ticker": s, "expirations": exps})

    def chain(sym, expiration="", strikes_around_spot=6, **kw):
        exp = expiration or exps[0]
        iv = iv_by_exp.get(exp)
        if iv is None:
            return {"error": "no chain"}
        return {"ticker": sym, "expiration": exp, "spot": 100.0,
                "calls": [{"strike": 100.0, "iv": iv}], "puts": [{"strike": 100.0, "iv": iv}]}
    monkeypatch.setattr(po, "get_chain", chain)


def test_the_implied_moves_use_a_30_day_constant_maturity_iv(monkeypatch):
    import datetime as _d
    today = _d.date(2026, 10, 5)
    # 0DTE at a crazy 0.90, then 20d at 0.20 and 40d at 0.30: 0DTE must play no part.
    _cm_stub(monkeypatch, ["2026-10-05", "2026-10-25", "2026-11-14"],
             {"2026-10-05": 0.90, "2026-10-25": 0.20, "2026-11-14": 0.30})
    a = pos._atm_iv_30d("TST", today=today)
    w = 0.20 ** 2 * 20 + (0.30 ** 2 * 40 - 0.20 ** 2 * 20) * (30 - 20) / (40 - 20)
    assert abs(a["iv"] - (w / 30) ** 0.5) < 1e-12
    assert a["expirations"] == ["2026-10-25", "2026-11-14"]
    assert "30-day constant maturity" in a["basis"]


def test_with_one_side_of_30_days_the_basis_says_so(monkeypatch):
    import datetime as _d
    _cm_stub(monkeypatch, ["2026-10-09", "2026-10-16"], {"2026-10-09": 0.25, "2026-10-16": 0.22})
    a = pos._atm_iv_30d("TST", today=_d.date(2026, 10, 5))
    assert a["iv"] == 0.22 and a["expirations"] == ["2026-10-16"]
    assert "single expiration 11 days out" in a["basis"]


def test_the_levels_route_uses_the_30_day_reader():
    import pathlib
    src = pathlib.Path(pos.__file__).read_text(encoding="utf-8")   # the autouse stub replaces _atm
    assert "_atm = _atm_iv_30d" in src.splitlines()


def test_max_pain_names_the_expiration_it_is_for():
    lv = asyncio.run(pos.levels("TST"))
    by = {r["id"]: r for r in lv["levels"]}
    assert by["max_pain"]["expiration"] == "2026-10-09"
    assert by["call_wall"]["expiration"] is None


def test_a_stand_in_zero_gamma_is_named_in_the_notes(monkeypatch):
    from api import gex_service

    async def gex(sym, dte="all", adjusted=False, source=None):
        return {**GEX, "zeroGammaMethod": "put_wall_fallback", "zeroGammaIsFlip": False}
    monkeypatch.setattr(gex_service, "get_gex_data", gex)
    lv = asyncio.run(pos.levels("TST"))
    assert lv["zero_gamma_method"] == "put_wall_fallback"
    assert any("stand-in" in n for n in lv["notes"])
