"""UCT Agent — production acceptance stabilization (2026-10-12).

Regression tests for the owner's acceptance findings:
  1. FRESHNESS — a present-tense breadth answer uses the latest FINALIZED session (MI D5, unchanged)
     and SAYS so when that session lags the last completed trading session. Dates only — never a
     value, never a provisional reading.
  2. COMPARISON SIGN — a comparison reads earlier → later and its change is LATER − EARLIER, whatever
     order the request named the dates in ("44.5% a month ago, 25.6% latest" is DOWN 18.9 pts).
  4. GENERAL BREADTH — `metrics: []` is UCT's documented overview (four measures, inside MI's limit);
     more than four named measures are still refused.
Synthetic values only; no model call, no network, no production data.
"""
from __future__ import annotations

import copy
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services.market_intel import breadth_answer, breadth_reads
from api.services.uct_agent import breadth_present as bp
from tests.market_intel_breadth_fixtures import synthetic_breadth_world

SESSION = "2026-10-09"
BASE = {"universe": "us", "date": None, "compare_date": None, "start": None, "end": None}
ADMIN = {"id": "c0ffee00-0000-4000-8000-0000000000a1", "plan": "pro", "role": "admin"}
MINUS = "−"


@pytest.fixture
def world(monkeypatch):
    return synthetic_breadth_world(monkeypatch, sentinel=25.6, session=SESSION, forbid_network=True)


def _compare(**kw):
    return breadth_reads.read({**BASE, "mode": "compare", "metrics": ["pct_above_50sma"], **kw})


def _with(res, cur, other):
    """The same MI result with steered values: `change` stays MI's definition (current − other)."""
    r = copy.deepcopy(res)
    for m in r["metrics"]:
        m["current"]["value"], m["other"]["value"] = cur, other
        m["change"] = cur - other
    return r


def _view(res):
    return bp.view_of(res, breadth_answer.answer(res))


# ═══ 2. comparison: chronology, sign, labels ══════════════════════════════════════════════════════

def test_SIGN_the_production_case_is_down_18_9(world):
    """44.5% a month ago, 25.6% latest — the acceptance screenshot said '+18.9 pts'."""
    for res in (_with(_compare(compare_date="2026-09-09"), 25.6, 44.5),                       # latest vs then
                _with(_compare(date="2026-09-09", compare_date=SESSION), 44.5, 25.6)):        # REVERSED order
        v = _view(res)
        assert [i["label"] for i in v["items"]] == ["Earlier", "Latest", "Change"]
        assert [i["value"] for i in v["items"]] == ["44.5%", "25.6%", f"{MINUS}18.9 pts"]
        assert [i["note"] for i in v["items"]] == ["2026-09-09", SESSION, "Down"]
        assert v["items"][2]["tone"] == "down"


def test_SIGN_a_rise_is_up_and_positive(world):
    for res in (_with(_compare(compare_date="2026-09-09"), 44.5, 25.6),
                _with(_compare(date="2026-09-09", compare_date=SESSION), 25.6, 44.5)):
        ch = _view(res)["items"][2]
        assert (ch["value"], ch["note"], ch["tone"]) == ("+18.9 pts", "Up", "up")


def test_SIGN_no_change_is_unchanged_without_a_sign(world):
    for cur, other in ((30.0, 30.0), (30.02, 30.0), (29.98, 30.0)):          # rounds to 0.0 either way
        ch = _view(_with(_compare(compare_date="2026-09-09"), cur, other))["items"][2]
        assert (ch["value"], ch["note"], ch.get("tone")) == ("0.0 pts", "Unchanged", "")


def test_SIGN_counts_keep_their_unit(world):
    res = breadth_reads.read({**BASE, "mode": "compare", "metrics": ["net_new_high_low"], "compare_date": "2026-09-09"})
    v = _view(_with(res, -40.0, 120.0))
    assert v["items"][2]["value"] == f"{MINUS}160" and v["items"][2]["note"] == "Down"


def test_SIGN_two_dates_both_in_the_past_say_later_not_latest(world):
    v = _view(_with(_compare(date="2026-09-09", compare_date="2026-08-10"), 20.0, 10.0))
    assert [i["label"] for i in v["items"]] == ["Earlier", "Later", "Change"]
    assert [i["note"] for i in v["items"]][:2] == ["2026-08-10", "2026-09-09"]
    assert v["items"][2]["value"] == "+10.0 pts"


def test_SIGN_several_measures_are_oriented_the_same_way(world):
    res = breadth_reads.read({**BASE, "mode": "compare", "metrics": ["pct_above_50sma", "pct_above_200sma"],
                              "date": "2026-09-09", "compare_date": SESSION})
    v = _view(_with(res, 44.5, 25.6))
    assert v["kind"] == "metrics"
    for it in v["items"]:
        assert it["value"] == "44.5% → 25.6%"
        assert it["note"] == f"Down 18.9 pts · 2026-09-09 → {SESSION}"


def test_SIGN_a_missing_observation_is_never_a_change(world):
    """One measure without a value on a date: the view says so, and draws no change for it."""
    world["empty"].add("pct_above_200sma")
    v = _view(breadth_reads.read({**BASE, "mode": "compare", "metrics": ["pct_above_50sma", "pct_above_200sma"],
                                  "compare_date": "2026-09-09"}))
    assert all("200" not in it["label"] for it in v.get("items", []))
    assert "note" in v and "200" in v["note"]


def test_SIGN_change_is_MIs_number_oriented_never_recomputed(world):
    res = _compare(date="2026-09-09", compare_date=SESSION)
    m = res["metrics"][0]
    early, late, delta = bp._chrono(m)
    assert (early["as_of"], late["as_of"]) == ("2026-09-09", SESSION)
    assert delta == -m["change"]


# ═══ 1. freshness: dates only, finalized only ═════════════════════════════════════════════════════

@pytest.mark.parametrize("last,today,expect", [
    ("2026-10-08", "2026-10-12", "2026-10-09 isn't finalized in UCT's breadth data yet."),
    ("2026-10-07", "2026-10-12", "2026-10-08 – 2026-10-09 aren't finalized in UCT's breadth data yet."),
    ("2026-10-09", "2026-10-12", None),           # Friday's session is the last completed one on Monday
    ("2026-10-09", "2026-10-10", None),           # weekend
    ("2026-10-12", "2026-10-12", None),
    (None, "2026-10-12", None),
    ("2026-11-25", "2026-11-27", None),           # Thanksgiving (11-26) is not a session
])
def test_FRESH_the_note_names_only_unfinalized_sessions(last, today, expect):
    assert bp.freshness_note(last, today) == expect


def test_FRESH_a_present_tense_value_states_the_lag(world, monkeypatch):
    monkeypatch.setattr(bp, "_today_et", lambda: "2026-10-14")                    # 10-12 and 10-13 not finalized
    v = _view(breadth_reads.read({**BASE, "mode": "value", "metrics": ["pct_above_50sma"]}))
    assert v["value"] == "25.6%"                                                    # the finalized value, unchanged
    assert v["note"] == f"As of {SESSION} close. 2026-10-12 – 2026-10-13 aren't finalized in UCT's breadth data yet."


def test_FRESH_a_historical_request_gets_no_freshness_note(world, monkeypatch):
    monkeypatch.setattr(bp, "_today_et", lambda: "2026-10-14")
    v = _view(breadth_reads.read({**BASE, "mode": "value", "metrics": ["pct_above_50sma"], "date": "2026-09-09"}))
    assert "finalized" not in v["note"]
    v = _view(_compare(date="2026-09-09", compare_date="2026-08-10"))
    assert "note" not in v


def test_FRESH_the_note_carries_dates_only(world, monkeypatch):
    """The note is built from session DATES; the only digits in it are those dates."""
    import re
    monkeypatch.setattr(bp, "_today_et", lambda: "2026-10-14")
    note = bp.freshness_note(SESSION)
    assert note and not re.search(r"\d", re.sub(r"\d{4}-\d{2}-\d{2}", "", note))


def test_FRESH_source_selection_is_unchanged_finalized_only(world, monkeypatch):
    """No provisional mode: the read still answers the last FINALIZED session, whatever today is."""
    monkeypatch.setattr(bp, "_today_et", lambda: "2026-10-14")
    res = breadth_reads.read({**BASE, "mode": "value", "metrics": ["pct_above_50sma"]})
    assert res["basis"] == "end-of-day, finalized sessions only"
    assert res["metrics"][0]["as_of"] == SESSION


# ═══ 4. the general overview ═════════════════════════════════════════════════════════════════════

def test_OVERVIEW_is_documented_four_measures_and_mirrors_the_browser():
    assert len(bp.OVERVIEW_METRICS) == 4 <= breadth_reads.MAX_METRICS
    import pathlib
    js = (pathlib.Path(__file__).resolve().parents[1] / "app/src/agent/capabilities/breadth.js").read_text(encoding="utf-8")
    assert "export const OVERVIEW_METRICS = [" + ", ".join(f"'{m}'" for m in bp.OVERVIEW_METRICS) + "]" in js


@pytest.fixture
def client(world, monkeypatch):
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[rx.require_admin_dark] = lambda: ADMIN
    return TestClient(app)


def test_OVERVIEW_an_empty_measure_list_is_the_overview(client):
    r = client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": []})
    b = r.json()
    assert r.status_code == 200 and b["status"] == "ok"
    assert b["present"]["kind"] == "metrics" and b["present"]["title"] == "US breadth overview"
    assert len(b["present"]["items"]) == 4


def test_OVERVIEW_more_than_four_named_measures_are_still_refused(client):
    r = client.post("/api/agent/breadth", json={**BASE, "mode": "value",
                                                "metrics": ["pct_above_50sma", "pct_above_200sma", "net_new_high_low", "adv_decline", "new_52w_highs"]})
    assert r.json()["status"] == "refused"
    assert "four" in r.json()["text"].lower() or "4" in r.json()["text"]


def test_OVERVIEW_the_default_never_reaches_the_model_facing_manifest():
    """The overview is filled in by the browser-only breadth route; the model only ever plans `[]`."""
    gold = json.loads((__import__("pathlib").Path(__file__).resolve().parents[1]
                       / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
    blob = json.dumps(gold)
    assert "general overview" in blob
    assert "pct_above_50sma', 'pct_above_200sma" not in blob
