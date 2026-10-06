"""BRK-01 increment 3 -- the implied-vol surface (api/services/vol_surface.py + the /surface route).

Each honesty rule of the increment is a test here, asserted on the payload a member's page renders:
vendor IV only, refusal in a sentence without a two-sided quote, a quote time on every point, a
thin expiration not drawn, today's chain not history, and a bounded, cached fan-out.
"""
from __future__ import annotations

import threading
from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_chain as oc
from api.services import vol_surface as vs

PAID = {"id": "u1", "role": "member", "plan": "pro", "subscription_status": "active"}
FREE = {"id": "u2", "role": "member", "plan": "free", "subscription_status": None}
T = "2026-10-01T15:30:00+00:00"
TODAY = date(2026, 10, 1)


def _q(k, iv, bid=1.0, ask=1.2, t=T, kind="call"):
    return {"strike": k, "iv": iv, "bid": bid, "ask": ask, "quote_time": t, "type": kind,
            "last": 9.99}


def _chain(exp, spot=100.0, strikes=(90, 95, 100, 105, 110), civ=0.30, piv=0.32, **over):
    calls = [_q(k, civ + (abs(k - spot) / 1000)) for k in strikes]
    puts = [_q(k, piv + (abs(k - spot) / 1000), kind="put") for k in strikes]
    return {"ticker": "SPY", "expiration": exp, "spot": spot,
            "calls": over.get("calls", calls), "puts": over.get("puts", puts)}


# ── honesty rules, on the pure builder ─────────────────────────────────────────────────────────

def test_iv_is_the_vendors_field_and_the_payload_says_so():
    out = vs.build_surface("SPY", [_chain("2026-10-16")], "2026-10-16", 1, [], TODAY)
    assert out["iv_source"] == "vendor"
    assert "vendor's own implied volatility" in out["iv_source_text"]
    assert "does not compute it" in out["iv_source_text"]
    # the plotted IV IS the vendor number, untouched
    k100 = next(p for p in out["smile"]["calls"]["points"] if p["strike"] == 100)
    assert k100["iv"] == 0.30


def test_a_strike_with_no_two_sided_quote_is_refused_in_a_sentence_never_priced_off_last():
    calls = [_q(90, .31), _q(95, .305), _q(100, .30), _q(105, .305), _q(110, .31),
             _q(115, .33, bid=0.0, ask=0.05),       # no bid -> one-sided
             _q(120, .35, bid=None, ask=None)]      # no quote at all, only a stale last
    e = vs.build_expiration(_chain("2026-10-16", calls=calls), TODAY)
    strikes = [p["strike"] for p in e["calls"]["points"]]
    assert 115 not in strikes and 120 not in strikes
    assert e["calls"]["refused_text"] == "call 115, 120: no two-sided quote"


def test_a_crossed_quote_or_missing_vendor_iv_is_refused_too():
    calls = [_q(90, .31), _q(95, .305), _q(100, .30), _q(105, .305), _q(110, .31),
             _q(115, .33, bid=2.0, ask=1.5), _q(120, None)]
    e = vs.build_expiration(_chain("2026-10-16", calls=calls), TODAY)
    reasons = {r["strike"]: r["reason"] for r in e["calls"]["refused"]}
    assert reasons == {115: "no two-sided quote", 120: "the vendor sent no IV"}


def test_every_point_carries_its_quote_time_and_one_without_is_refused():
    calls = [_q(k, .3) for k in (90, 95, 100, 105, 110)] + [_q(115, .3, t=None)]
    out = vs.build_surface("SPY", [_chain("2026-10-16", calls=calls)], None, 1, [], TODAY)
    pts = out["smile"]["calls"]["points"] + out["smile"]["puts"]["points"]
    assert pts and all(p["t"] == T for p in pts)
    assert {"strike": 115, "reason": "no quote time"} in out["smile"]["calls"]["refused"]
    assert all(p["t"] for p in out["term"]["points"] if p["atm_iv"] is not None)
    assert all(c is None or c["t"] for r in out["grid"]["rows"] for c in r["cells"])


def test_a_thin_expiration_says_so_and_is_not_a_line():
    thin = _chain("2026-10-16", strikes=(95, 100, 105))
    e = vs.build_expiration(thin, TODAY)
    assert e["calls"]["drawable"] is False
    assert e["calls"]["reason"].startswith("Only 3 call strikes with a two-sided quote")
    assert "not drawn" in e["calls"]["reason"]
    assert e["atm_iv"] is None and "needs 5" in e["reason"]


def test_term_structure_needs_two_expirations_with_an_atm_read():
    one = vs.build_surface("SPY", [_chain("2026-10-16")], None, 1, [], TODAY)
    assert one["term"]["drawable"] is False and "at least 2" in one["term"]["reason"]
    two = vs.build_surface("SPY", [_chain("2026-10-16"), _chain("2026-11-20", civ=.25, piv=.27)],
                           None, 2, [], TODAY)
    assert two["term"]["drawable"] is True
    p = two["term"]["points"][0]
    assert p["atm_strike"] == 100 and p["atm_basis"] == "call and put averaged"
    assert abs(p["atm_iv"] - 0.31) < 1e-9 and p["dte"] == 15


def test_the_surface_states_it_is_todays_chain_not_history():
    out = vs.build_surface("SPY", [_chain("2026-10-16")], None, 1, [], TODAY)
    assert out["basis"].startswith("Today's live chain only, not history")


def test_grid_uses_the_out_of_the_money_side_and_never_interpolates():
    a = _chain("2026-10-16")
    b = _chain("2026-11-20", strikes=(90, 100, 110, 120, 130))
    g = vs.build_surface("SPY", [a, b], None, 2, [], TODAY)["grid"]
    assert g["expirations"] == ["2026-10-16", "2026-11-20"]
    row95 = next(r for r in g["rows"] if r["strike"] == 95)
    assert row95["cells"][0]["iv"] == 0.32 + 5 / 1000      # put side below spot
    assert row95["cells"][1] is None                          # Nov has no 95: a gap, not a guess
    row105 = next(r for r in g["rows"] if r["strike"] == 105)
    assert row105["cells"][0]["iv"] == 0.30 + 5 / 1000     # call side above spot


def test_sampling_is_bounded_and_spread():
    listed = [f"2026-{m:02d}-{d:02d}" for m in (10, 11, 12) for d in range(1, 29)]
    got = vs.sample_expirations(listed)
    assert len(got) == vs.MAX_EXPIRATIONS
    assert got[:3] == listed[:3] and got[-1] == listed[-1]
    assert got == sorted(set(got))
    assert vs.sample_expirations(listed[:5]) == listed[:5]


# ── the fetch: bounded, cached, failure is named ───────────────────────────────────────────────

def _patch_provider(monkeypatch, listed, chain_for=None):
    from api.services import polygon_options as po
    calls = []
    wings = []
    lock = threading.Lock()

    def fake_chain(sym, expiration="", strikes_around_spot=6, *, min_abs_delta=None,
                   band_pct=0.25):
        with lock:
            calls.append((expiration, strikes_around_spot))
            wings.append((min_abs_delta, band_pct))
        return chain_for(expiration) if chain_for else _chain(expiration)

    monkeypatch.setattr(po, "list_expirations", lambda s: {"ticker": s, "expirations": listed})
    monkeypatch.setattr(po, "get_chain", fake_chain)
    monkeypatch.setattr(vs, "_CACHE", vs.TTLCache())
    _patch_provider.wings = wings
    return calls


def test_fanout_is_bounded_uses_the_chain_tabs_n_and_is_cached(monkeypatch):
    listed = [f"2026-{m:02d}-{d:02d}" for m in (10, 11, 12) for d in range(1, 29)]
    calls = _patch_provider(monkeypatch, listed)
    out = vs.get_surface("SPY", selected="2026-11-14")
    assert len(calls) <= vs.MAX_EXPIRATIONS + 1
    assert ("2026-11-14", 10) in calls                     # the selected chain, same n as the tab
    assert all(n == 10 for _, n in calls)
    # O2: every chain asks for the delta wings, so 25/10-delta are reachable on $1-strike names
    assert _patch_provider.wings and all(w == (vs.WING_DELTA, vs.WING_BAND)
                                         for w in _patch_provider.wings)
    assert out["smile"]["expiration"] == "2026-11-14"
    assert out["expirations_listed"] == len(listed) and out["cache_seconds"] == 60
    before = len(calls)
    vs.get_surface("SPY", selected="2026-11-14")
    assert len(calls) == before                             # served from the 60 s cache


def test_one_failed_expiration_is_named_not_dropped(monkeypatch):
    listed = ["2026-10-16", "2026-11-20"]
    _patch_provider(monkeypatch, listed, lambda x: {"error": "timeout"} if x == "2026-11-20"
                    else _chain(x))
    out = vs.get_surface("SPY")
    assert out["missing"] == [{"expiration": "2026-11-20", "reason": "timeout"}]
    assert out["expirations_sampled"] == 1


# ── the route ──────────────────────────────────────────────────────────────────────────────────

def _client(user, monkeypatch, surface=None):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(vs, "get_surface",
                        lambda s, selected="": surface or {"ticker": s, "smile": None})
    monkeypatch.setattr(oc, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oc.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


def test_surface_is_dark_unless_both_flags_are_on(monkeypatch):
    monkeypatch.delenv(oc.SURFACE_ENABLED_ENV, raising=False)
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    assert _client(PAID, monkeypatch).get("/api/research/options/SPY/surface").status_code == 404
    monkeypatch.setenv(oc.SURFACE_ENABLED_ENV, "1")
    monkeypatch.delenv(oc.ENABLED_ENV, raising=False)
    assert _client(PAID, monkeypatch).get("/api/research/options/SPY/surface").status_code == 404
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    assert _client(PAID, monkeypatch).get("/api/research/options/SPY/surface").status_code == 200
    assert _client(FREE, monkeypatch).get("/api/research/options/SPY/surface").status_code == 402


def test_surface_provider_failure_is_503_and_bad_expiration_422(monkeypatch):
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    monkeypatch.setenv(oc.SURFACE_ENABLED_ENV, "1")
    c = _client(PAID, monkeypatch, surface={"error": "polygon request failed: timeout"})
    r = c.get("/api/research/options/SPY/surface")
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]
    assert c.get("/api/research/options/SPY/surface?expiration=soon").status_code == 422


def test_the_auth_payload_carries_the_surface_flag(monkeypatch):
    from api.routers import auth
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    monkeypatch.delenv(oc.SURFACE_ENABLED_ENV, raising=False)
    assert auth._options_vol_surface_enabled() is False
    monkeypatch.setenv(oc.SURFACE_ENABLED_ENV, "1")
    assert auth._options_vol_surface_enabled() is True


def test_quote_time_is_read_from_the_snapshot_in_nanoseconds():
    from api.services import polygon_options as po
    row = po._normalize_contract({"details": {"strike_price": 100, "contract_type": "call"},
                                  "last_quote": {"bid": 1, "ask": 1.1,
                                                 "last_updated": 1_791_000_000_000_000_000,
                                                 "timeframe": "REAL-TIME"}})
    assert row["quote_time"] == "2026-10-03T04:00:00+00:00"
    assert row["quote_timeframe"] == "REAL-TIME"
    assert po._normalize_contract({"last_quote": {}})["quote_time"] is None
