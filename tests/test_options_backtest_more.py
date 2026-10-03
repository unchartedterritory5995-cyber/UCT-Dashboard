"""FT-011 (lane/o-options-remainders) -- the backtester's earnings anchor (AMC/BMO) and its further
structures, behind OPTIONS_BACKTEST_MORE_ENABLED.

NO NETWORK. The vendor is a STRICT replay of tests/fixtures/options_backtest/spy_earnings_replay.json
(synthetic-shaped, recorded by record_earnings.py; a request not in the file raises). The past
prints are the fixture's own list, passed in as the reader.
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
FX = json.load(open(os.path.join(HERE, "fixtures", "options_backtest", "spy_earnings_replay.json"),
                    encoding="utf-8"))
TODAY = date.fromisoformat(FX["today"])
PRINTS = FX["prints"]
PAID = {"id": "u1", "role": "member", "plan": "pro", "subscription_status": "active"}
FLAG = "OPTIONS_BACKTEST_MORE_ENABLED"


class Unrecorded(AssertionError):
    pass


def replay(path: str, params: dict) -> dict:
    k = key(path, params)
    if k not in FX["responses"]:
        raise Unrecorded(k)
    return json.loads(json.dumps(FX["responses"][k]))


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


def run(raw: dict) -> dict:
    return ob.run_backtest(ob.normalize_params("SPY", raw), ob.Vendor(replay), TODAY,
                           prints=lambda _s: PRINTS)


# ── dark ────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,msg", [
    ({"strategy": "long_straddle", "dte": 30}, "Pick one of: long call, long put, bull call spread, bear put spread."),
    ({"strategy": "long_call", "anchor": "earnings"}, "Entries anchor on monthly expirations."),
])
def test_off_the_new_structures_and_the_earnings_anchor_are_refused(monkeypatch, raw, msg):
    monkeypatch.delenv(FLAG, raising=False)
    with pytest.raises(ob.BadParams, match=msg):
        ob.normalize_params("SPY", raw)


def test_on_the_refusal_names_every_structure(on):
    with pytest.raises(ob.BadParams, match="iron condor"):
        ob.normalize_params("SPY", {"strategy": "nope", "dte": 30})


# ── the earnings anchor ─────────────────────────────────────────────────────────────────────

def test_amc_enters_the_report_day_and_bmo_the_session_before(on):
    r = run({"strategy": "long_straddle", "anchor": "earnings"})
    got = {(t["report_date"], t["timing"], t["entry_date"], t["exit"]["date"]) for t in r["trades"]}
    assert got == {
        ("2025-10-22", "amc", "2025-10-22", "2025-10-23"),
        ("2026-04-23", "bmo", "2026-04-22", "2026-04-23"),
        ("2026-07-22", "amc", "2026-07-22", "2026-07-23"),
    }
    assert r["anchor"] == "earnings" and "AMC" in r["anchor_text"] and "BMO" in r["anchor_text"]


def test_a_print_with_no_timing_is_EXCLUDED_AND_COUNTED_never_guessed(on):
    r = run({"strategy": "long_straddle", "anchor": "earnings"})
    assert r["excluded_count"] == 1
    assert r["excluded"][0]["report_date"] == "2026-01-28"
    assert "report time" in r["excluded"][0]["reason"]
    assert all(t["report_date"] != "2026-10-20" for t in r["trades"])     # future print not read
    assert r["window"]["prints_read"] == 4


def test_the_options_are_the_first_expiration_on_or_after_the_exit_session(on):
    r = run({"strategy": "long_straddle", "anchor": "earnings"})
    by = {t["report_date"]: t for t in r["trades"]}
    assert by["2026-07-22"]["expiry"] == "2026-07-24"       # first Friday on/after exit 07-23
    assert by["2026-04-23"]["expiry"] == "2026-04-24"
    t = by["2026-07-22"]
    assert {l["type"] for l in t["legs"]} == {"call", "put"} and len({l["strike"] for l in t["legs"]}) == 1
    # exit marked at the exit-session quote mid (an option still alive), not at intrinsic
    assert t["exit"]["kind"] == "after_print"
    assert t["pnl"] == round(t["exit"]["value"] - t["debit"], 2)


def test_a_one_sided_exit_quote_is_excluded_with_its_reason(on):
    r = run({"strategy": "iron_condor", "anchor": "earnings", "width": 1})
    reasons = [e["reason"] for e in r["excluded"]]
    assert any("at the exit close" in x for x in reasons), reasons
    assert r["summary"] is None and "too small" in r["summary_reason"]


# ── the further structures ──────────────────────────────────────────────────────────────────

def test_a_credit_structure_carries_a_negative_debit_and_its_loss_is_capped_by_the_width(on):
    r = run({"strategy": "bear_call", "dte": 30, "offset": 1, "width": 1})
    assert r["trades"], r["excluded"]
    for t in r["trades"]:
        short, long_ = t["legs"]
        assert short["side"] == -1 and long_["side"] == 1 and long_["strike"] > short["strike"]
        assert t["debit"] < 0
        width = (long_["strike"] - short["strike"]) * 100
        assert t["pnl"] >= -(width + t["debit"]) - 0.01          # max loss = width - credit
        assert t["pnl"] <= -t["debit"] + 0.01                     # max gain = the credit


def test_a_butterfly_is_one_two_one_around_the_anchor(on):
    r = run({"strategy": "call_butterfly", "dte": 30, "width": 1})
    t = r["trades"][0]
    sides = [l["side"] for l in t["legs"]]
    ks = [l["strike"] for l in t["legs"]]
    assert sides == [1, -2, 1] and ks[1] - ks[0] == ks[2] - ks[1] > 0


def test_an_exit_rule_on_a_credit_is_measured_on_the_credit(on):
    r = run({"strategy": "short_strangle", "dte": 14, "width": 2, "take_profit_pct": 50})
    tp = [t for t in r["trades"] if t["exit"]["kind"] == "take_profit"]
    assert tp, "the fixture should hit the take-profit at least once"
    for t in tp:
        assert t["pnl"] >= 0.5 * abs(t["debit"]) - 0.01


def test_the_first_slice_request_shape_is_unchanged_for_single_type_structures():
    # a single-type structure reads ONE ladder with the exact first-slice params
    seen = []
    v = ob.Vendor(lambda path, params: seen.append((path, dict(params))) or {"results": []})
    ob._ladders(v, "SPY", "long_call", date(2026, 7, 17), date(2026, 6, 5), 600.0)
    assert len(seen) == 1 and seen[0][1]["contract_type"] == "call" and "expiration_date" in seen[0][1]


# ── the catalog route ───────────────────────────────────────────────────────────────────────

def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oc, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oc.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


CAT = "/api/research/options/SPY/backtest-catalog"


def test_the_catalog_is_dark_until_all_three_switches(monkeypatch):
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    monkeypatch.setenv(oc.BACKTEST_ENABLED_ENV, "1")
    monkeypatch.delenv(FLAG, raising=False)
    c = _client(PAID, monkeypatch)
    assert c.get(CAT).status_code == 404
    monkeypatch.setenv(FLAG, "1")
    body = c.get(CAT).json()
    ids = {s["id"] for s in body["strategies"]}
    assert {"long_call", "iron_condor", "long_straddle", "call_butterfly"} <= ids
    assert body["anchors"] == ["monthly", "earnings"]
    monkeypatch.setenv(oc.BACKTEST_ENABLED_ENV, "0")
    assert c.get(CAT).status_code == 404


def test_an_earnings_run_goes_through_the_job_queue(monkeypatch):
    ob._reset_for_tests()
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    monkeypatch.setenv(oc.BACKTEST_ENABLED_ENV, "1")
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setattr(ob, "_fetch_override", replay)
    monkeypatch.setattr(ob, "_today", lambda: TODAY)
    monkeypatch.setattr(ob, "_default_prints", lambda _s: PRINTS)
    c = _client(PAID, monkeypatch)
    r = c.post("/api/research/options/SPY/backtest", json={"strategy": "long_straddle", "anchor": "earnings"})
    assert r.status_code == 202
    job = r.json()["job"]
    end = time.monotonic() + 20
    while time.monotonic() < end:
        st = ob.job_status(job, "u1")
        if st["state"] in ("done", "failed"):
            break
        time.sleep(0.02)
    assert st["state"] == "done" and len(st["result"]["trades"]) == 3
    ob._reset_for_tests()
