"""BRK-01 increment 4 -- the options strategy backtester (api/services/options_backtest.py + the
/backtest routes on api/routers/options_chain.py).

Every honesty rule of the slice is a test here, asserted on the payload the member's panel renders:
quote mids never prints, an unpriceable contract EXCLUDED AND COUNTED, a small sample refused a
summary in a sentence, the window saying where it starts, a computed IV labelled computed, a
bounded vendor budget whose shortfall is counted, and a job that runs OFF the request.

NO NETWORK. The vendor is a STRICT replay of tests/fixtures/options_backtest/spy_replay.json
(how it was recorded, and that it is synthetic-shaped, not a live capture: record.py). A request
that is not in the file raises -- so a changed request shape is red, never a quiet empty answer.
"""
from __future__ import annotations

import json
import os
import time
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_chain as oc
from api.services import options_backtest as ob
from tests.fixtures.options_backtest.record import key

HERE = os.path.dirname(os.path.abspath(__file__))
FX = json.load(open(os.path.join(HERE, "fixtures", "options_backtest", "spy_replay.json"), encoding="utf-8"))
TODAY = date.fromisoformat(FX["today"])
PAID = {"id": "u1", "role": "member", "plan": "pro", "subscription_status": "active"}
PAID2 = {"id": "u9", "role": "member", "plan": "pro", "subscription_status": "active"}
FREE = {"id": "u2", "role": "member", "plan": "free", "subscription_status": None}


class Unrecorded(AssertionError):
    pass


def replay(path: str, params: dict) -> dict:
    k = key(path, params)
    if k not in FX["responses"]:
        raise Unrecorded(k)
    return json.loads(json.dumps(FX["responses"][k]))


def run(raw: dict, budget: int = ob.MAX_VENDOR_REQUESTS) -> dict:
    return ob.run_backtest(ob.normalize_params("SPY", raw), ob.Vendor(replay, budget), TODAY)


BASE = {"strategy": "long_call", "dte": 30, "offset": 0}


# ── the simulation, on the recorded vendor ─────────────────────────────────────────────────────

def test_a_year_of_monthlies_with_each_trade_stated():
    out = run(BASE)
    assert out["expirations_considered"] == 12
    assert len(out["trades"]) == 9
    t = out["trades"][0]
    assert set(t) >= {"entry_date", "expiry", "legs", "debit", "exit", "pnl"}
    assert t["entry_date"] == "2025-09-05" and t["expiry"] == "2025-10-17"
    leg = t["legs"][0]
    # the debit IS the quote mid x 100 for one contract
    assert t["debit"] == round((leg["bid"] + leg["ask"]) / 2 * 100, 2)
    # held to expiry: the value is intrinsic off the underlying's close, and P&L follows
    assert t["exit"]["kind"] == "expiry"
    assert t["exit"]["value"] == round(max(0.0, t["exit"]["underlying_close"] - leg["strike"]) * 100, 2)
    assert t["pnl"] == round(t["exit"]["value"] - t["debit"], 2)
    assert all(tr["entry_date"] <= u["entry_date"] for tr, u in zip(out["trades"], out["trades"][1:]))


def test_the_atm_strike_is_nearest_the_entry_close_and_offset_walks_the_ladder():
    t0 = run(BASE)["trades"][0]
    assert abs(t0["legs"][0]["strike"] - t0["entry_close"]) <= 2.5
    t1 = run({"strategy": "long_put", "dte": 45, "offset": -1})["trades"][0]
    atm = round(t1["entry_close"] / 5) * 5
    assert t1["legs"][0]["strike"] == atm - 5


def test_a_spread_is_two_legs_long_low_short_high_and_its_debit_nets():
    t = run({"strategy": "bull_call", "dte": 14, "offset": 0, "width": 2})["trades"][0]
    lo, hi = t["legs"]
    assert (lo["side"], hi["side"]) == (1, -1) and hi["strike"] - lo["strike"] == 10
    assert t["debit"] == round((lo["mid"] - hi["mid"]) * 100, 2)
    assert t["exit"]["value"] <= 10 * 100          # a vertical can never be worth more than its width


def test_every_unpriceable_contract_is_EXCLUDED_AND_COUNTED_with_its_reason():
    out = run(BASE)
    assert out["excluded_count"] == 3 == len(out["excluded"])
    reasons = {e["expiry"]: e["reason"] for e in out["excluded"]}
    assert reasons["2025-11-21"] == "no contracts listed for this expiration at entry"
    assert reasons["2026-01-16"].startswith("no two-sided quote for the")        # one-sided (bid 0)
    assert reasons["2026-03-20"].endswith("at the entry close")                   # no quote at all
    # nothing vanished: every considered expiration is a trade, an exclusion or a not-run
    assert len(out["trades"]) + out["excluded_count"] + out["not_run_count"] == out["expirations_considered"]
    assert not {t["expiry"] for t in out["trades"]} & set(reasons)


def test_a_holiday_friday_expires_the_session_before():
    exps = {t["expiry"] for t in run(BASE)["trades"]}
    assert "2026-06-18" in exps and "2026-06-19" not in exps     # Juneteenth 2026


def test_the_window_says_where_it_starts_and_where_the_history_begins():
    w = run(BASE)["window"]
    assert w["starts"] == "2025-10-02" and w["lookback_months"] == 12
    assert w["first_entry"] == "2025-09-05"
    assert "after 2025-10-02" in w["text"] and "first simulated entry is 2025-09-05" in w["text"]


def test_the_iv_shown_is_COMPUTED_from_the_mid_and_labelled_so():
    out = run(BASE)
    assert out["iv_source"] == "computed"
    assert "COMPUTED" in out["iv_source_text"] and "Black-Scholes" in out["iv_source_text"]
    # the replay prices every option at sigma 0.20: the inversion must recover it
    ivs = [l["iv_computed"] for t in out["trades"] for l in t["legs"]]
    assert ivs and all(abs(v - 0.20) < 0.005 for v in ivs)


def test_the_basis_is_stated():
    b = run(BASE)["basis"]
    for phrase in ("historical simulation, not advice", "One contract per leg", "mid",
                   "before commissions", "never trade prints"):
        assert phrase in b


def test_the_summary_n_win_rate_avg_median_worst_and_max_drawdown():
    out = run(BASE)
    s, pnls = out["summary"], [t["pnl"] for t in out["trades"]]
    assert s["n"] == 9 and out["summary_reason"] is None
    assert s["wins"] == sum(p > 0 for p in pnls) and s["win_rate"] == round(s["wins"] / 9, 4)
    assert s["worst"] == min(pnls) and s["avg_pnl"] == round(sum(pnls) / 9, 2)
    assert s["max_drawdown"] == ob.max_drawdown(pnls) <= 0


def test_max_drawdown_is_peak_to_trough_of_the_cumulative_curve():
    assert ob.max_drawdown([100, -50, -80, 200, -300]) == -300
    assert ob.max_drawdown([-10, -20]) == -30          # from a zero start, not from the first trade
    assert ob.max_drawdown([5, 5, 5]) == 0


def test_a_sample_under_six_is_too_small_to_summarise_and_says_so():
    # a budget of 10 reaches only the newest few expirations
    out = run(BASE, budget=10)
    assert 0 < len(out["trades"]) < ob.MIN_SUMMARY_N
    assert out["summary"] is None
    assert out["summary_reason"] == ob.small_sample_text(len(out["trades"]))
    assert "too small to summarise" in out["summary_reason"]


def test_the_vendor_budget_is_bounded_and_what_it_could_not_reach_is_COUNTED():
    out = run(BASE, budget=10)
    assert out["vendor_requests"] == {"used": 10, "budget": 10}
    assert out["not_run_count"] > 0
    assert all(n["reason"] == "the vendor request budget ran out" for n in out["not_run"])
    assert len(out["trades"]) + out["excluded_count"] + out["not_run_count"] == out["expirations_considered"]
    # newest first under the budget: what ran is the most recent year-end, not the oldest
    assert max(t["expiry"] for t in out["trades"]) == "2026-09-18"


def test_an_exit_rule_marks_each_close_at_the_mid_and_exits_on_the_threshold():
    out = run({"strategy": "long_call", "dte": 7, "offset": 1, "take_profit_pct": 50, "stop_loss_pct": 50})
    kinds = {t["exit"]["kind"] for t in out["trades"]}
    assert {"take_profit", "stop_loss"} <= kinds
    for t in out["trades"]:
        if t["exit"]["kind"] == "take_profit":
            assert t["pnl"] >= 0.5 * t["debit"] - 0.01
            assert t["exit"]["date"] < t["expiry"]
        if t["exit"]["kind"] == "stop_loss":
            assert t["pnl"] <= -0.5 * t["debit"] + 0.01


def test_the_entry_quote_is_read_at_the_new_york_close_of_the_entry_session_only():
    seen = []

    def spy(path, params):
        seen.append((path, params))
        return replay(path, params)
    ob.run_backtest(ob.normalize_params("SPY", BASE), ob.Vendor(spy), TODAY)
    q = [p for path, p in seen if path.startswith("/v3/quotes/")]
    assert q and all(p["order"] == "desc" and p["limit"] == 1 for p in q)
    # never a trade print: no trades or last-trade endpoint is ever read
    assert not [path for path, _ in seen if "/trades/" in path or "/last/" in path]
    # unadjusted closes, so they share a scale with the strikes listed then
    assert [p for path, p in seen if path.startswith("/v2/aggs/")][0]["adjusted"] == "false"
    # the ladder is the one that EXISTED at entry
    assert all("as_of" in p for path, p in seen if path.endswith("/contracts"))


def test_the_close_instant_is_dst_correct():
    assert ob._ny_instant(date(2026, 7, 15), 16, 0) == "2026-07-15T20:00:00Z"
    assert ob._ny_instant(date(2026, 1, 15), 16, 0) == "2026-01-15T21:00:00Z"
    assert ob._ny_instant(date(2026, 1, 15), 9, 30) == "2026-01-15T14:30:00Z"


def test_a_one_sided_crossed_or_missing_quote_has_no_mid():
    assert ob.two_sided_mid({"bid_price": 1.0, "ask_price": 1.2}) == pytest.approx(1.1)
    assert ob.two_sided_mid({"bid_price": 0.0, "ask_price": 0.05}) is None
    assert ob.two_sided_mid({"bid_price": 1.3, "ask_price": 1.2}) is None
    assert ob.two_sided_mid({"bid_price": None, "ask_price": 1.2}) is None
    assert ob.two_sided_mid(None) is None


def test_an_iv_outside_any_sigma_is_None_never_clamped():
    assert ob.implied_vol("call", 0.001, 100, 50, 0.1) is None      # below intrinsic
    v = ob.implied_vol("put", ob.bs_price("put", 100, 105, 0.25, 0.35), 100, 105, 0.25)
    assert abs(v - 0.35) < 1e-3


@pytest.mark.parametrize("raw,msg", [
    ({"strategy": "short_strangle", "dte": 30}, "Pick one of"),
    ({"strategy": "long_call", "dte": 10}, "Entry must be one of"),
    ({"strategy": "long_call", "dte": 30, "offset": 9}, "within 5 strikes"),
    ({"strategy": "bull_call", "dte": 30, "width": 0}, "1 to 5 strikes wide"),
    ({"strategy": "long_call", "dte": 30, "take_profit_pct": 33}, "Exit percentages"),
])
def test_bad_params_are_refused_in_a_sentence(raw, msg):
    with pytest.raises(ob.BadParams, match=msg):
        ob.normalize_params("SPY", raw)


# ── jobs: off the request, cached, rate-limited ───────────────────────────────────────────────

@pytest.fixture
def jobs(monkeypatch):
    ob._reset_for_tests()
    monkeypatch.setattr(ob, "_fetch_override", replay)
    monkeypatch.setattr(ob, "_today", lambda: TODAY)
    yield ob
    ob._reset_for_tests()


def _wait(job, uid="u1", timeout=20.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        st = ob.job_status(job, uid)
        if st["state"] in ("done", "failed"):
            return st
        time.sleep(0.02)
    raise AssertionError("job never finished")


def test_submit_returns_before_the_run_and_the_poll_gets_the_result(jobs):
    job = ob.submit("u1", "spy", BASE)
    assert ob.job_status(job, "u1")["state"] in ("queued", "running", "done")
    st = _wait(job)
    assert st["state"] == "done" and len(st["result"]["trades"]) == 9


def test_a_done_run_is_dated_by_when_it_finished_never_now(jobs):
    """TERM-019: a cached identical run answers with the time it was actually simulated."""
    import datetime as _dt
    job = ob.submit("u1", "spy", BASE)
    st = _wait(job)
    key = next(iter(ob._cache))
    finished = float(int(time.time()) - 30)          # inside the result cache's TTL
    ob._cache[key] = (finished, ob._cache[key][1])
    again = ob.job_status(job, "u1")
    assert st["as_of"]
    assert _dt.datetime.fromisoformat(again["as_of"]).timestamp() == finished


def test_an_identical_run_is_served_from_the_cache_and_costs_no_quota(jobs, monkeypatch):
    _wait(ob.submit("u1", "SPY", BASE))
    calls = []
    monkeypatch.setattr(ob, "_fetch_override", lambda p, q: calls.append(p) or replay(p, q))
    for _ in range(ob.RUNS_PER_MEMBER_PER_HOUR + 2):
        st = ob.job_status(ob.submit("u1", "SPY", dict(BASE)), "u1")
        assert st["state"] == "done"
    assert calls == []


def test_a_member_is_rate_limited_on_NEW_runs(jobs, monkeypatch):
    monkeypatch.setattr(ob, "_fetch_override", lambda p, q: {"results": []})   # instant, empty runs
    for i in range(ob.RUNS_PER_MEMBER_PER_HOUR):
        _wait(ob.submit("u1", "SPY", {"strategy": "long_call", "dte": 30, "offset": i - 3}))
    with pytest.raises(ob.Refused) as e:
        ob.submit("u1", "SPY", {"strategy": "long_put", "dte": 30, "offset": 0})
    assert e.value.status == 429 and e.value.retry_after > 0
    assert "per hour" in str(e.value)
    ob.submit("u2", "SPY", {"strategy": "long_put", "dte": 30, "offset": 0})   # another member is not


def test_a_member_cannot_fill_the_queue(jobs, monkeypatch):
    import threading
    gate = threading.Event()
    monkeypatch.setattr(ob, "_fetch_override", lambda p, q: gate.wait(5) and {"results": []})
    try:
        ob.submit("u1", "SPY", {"strategy": "long_call", "dte": 30, "offset": 0})
        ob.submit("u1", "SPY", {"strategy": "long_call", "dte": 30, "offset": 1})
        with pytest.raises(ob.Refused, match="already have 2 backtests running"):
            ob.submit("u1", "SPY", {"strategy": "long_call", "dte": 30, "offset": 2})
    finally:
        gate.set()


def test_a_job_is_readable_only_by_its_owner(jobs):
    job = ob.submit("u1", "SPY", BASE)
    with pytest.raises(ob.JobNotFound):
        ob.job_status(job, "u2")
    with pytest.raises(ob.JobNotFound):
        ob.job_status("nope", "u1")


def test_a_crashed_run_is_a_terminal_failed_state_not_a_hang(jobs, monkeypatch):
    def boom(p, v, t):
        raise RuntimeError("x")
    monkeypatch.setattr(ob, "run_backtest", boom)
    st = _wait(ob.submit("u1", "SPY", BASE))
    assert st["state"] == "failed" and "could not finish" in st["error"]


# ── routes ────────────────────────────────────────────────────────────────────────────────────

def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oc, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oc.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


URL = "/api/research/options/SPY/backtest"


def test_dark_by_default_and_rides_on_the_chain_flag(monkeypatch, jobs):
    monkeypatch.delenv(oc.BACKTEST_ENABLED_ENV, raising=False)
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    c = _client(PAID, monkeypatch)
    assert c.post(URL, json=BASE).status_code == 404
    assert c.get(f"{URL}/abc").status_code == 404
    monkeypatch.setenv(oc.BACKTEST_ENABLED_ENV, "1")
    monkeypatch.setenv(oc.ENABLED_ENV, "0")
    assert c.post(URL, json=BASE).status_code == 404


def test_armed_202_then_poll_and_free_is_402(monkeypatch, jobs):
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    monkeypatch.setenv(oc.BACKTEST_ENABLED_ENV, "1")
    c = _client(PAID, monkeypatch)
    r = c.post(URL, json=BASE)
    assert r.status_code == 202
    job = r.json()["job"]
    _wait(job)
    body = c.get(f"{URL}/{job}").json()
    assert body["state"] == "done" and body["result"]["excluded_count"] == 3
    assert _client(PAID2, monkeypatch).get(f"{URL}/{job}").status_code == 404
    assert _client(FREE, monkeypatch).post(URL, json=BASE).status_code == 402
    assert c.post(URL, json={"strategy": "long_call", "dte": 3}).status_code == 400


def test_the_auth_payload_carries_the_flag_from_the_same_reader(monkeypatch):
    from api.routers import auth
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    monkeypatch.delenv(oc.BACKTEST_ENABLED_ENV, raising=False)
    assert auth._options_backtest_enabled() is False
    monkeypatch.setenv(oc.BACKTEST_ENABLED_ENV, "1")
    assert auth._options_backtest_enabled() is True
