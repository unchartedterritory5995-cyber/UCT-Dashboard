"""Breadth history event queries (market_intel.breadth_events) — synthetic, deterministic, no network.

Finalized sessions only (the D5 cut via breadth_reads.sealed_series); crossings and runs on Slice 2's
own condition core; validators value-free and disjoint from breadth_reads / event_study (the Agent's
history note tries each in turn).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.services.market_intel import breadth_events as be
from api.services.market_intel import breadth_reads as br
from api.services.market_intel import event_study as es
from tests import market_intel_breadth_fixtures as fx

M = "pct_above_50sma"
from datetime import date as _date
from api.services import session_calendar as _sc
#: the fixture's weekdays that are real NYSE sessions (it also carries 06-19 and 09-07, market holidays)
TRADING = [d for d in fx.SESSIONS if _sc.is_trading_day(_date.fromisoformat(d))]


@pytest.fixture
def world(monkeypatch):
    return lambda values, default=50.0: _install(monkeypatch, values, default)


def _install(monkeypatch, values: dict, default: float):
    monkeypatch.setattr(fx, "value", lambda metric, i: values.get(fx.SESSIONS[i], default))
    return fx.synthetic_breadth_world(monkeypatch)


def q(op="below", level=20, find="last", **kw):
    return {"universe": "nasdaq", "metric": M, "op": op, "level": level, "find": find, **kw}


def test_last_and_first_with_the_stretch_around_them(world):
    world({"2026-06-10": 15.0, "2026-06-11": 12.0, "2026-08-03": 18.0})
    last = be.run(q(find="last"))
    assert last["status"] == "ok" and last["event"] == {"date": "2026-08-03", "value": 18.0}
    first = be.run(q(find="first"))
    assert first["event"]["date"] == "2026-06-10"
    assert (first["episode"]["start"], first["episode"]["end"], first["episode"]["sessions"]) == ("2026-06-10", "2026-06-11", 2)


def test_at_or_below_includes_the_level_below_does_not(world):
    world({"2026-07-06": 20.0})
    assert be.run(q(op="below", level=20))["event"] is None
    assert be.run(q(op="at_or_below", level=20))["event"]["date"] == "2026-07-06"
    assert be.run(q(op="above", level=20, find="count"))["counts"]["sessions"] == len(TRADING) - 1   # all but 07-06
    assert be.run(q(op="at_or_above", level=50.0, find="count"))["counts"]["sessions"] == len(TRADING) - 1


def test_a_missing_session_breaks_a_stretch_and_is_counted(world):
    world({"2026-08-19": 10.0, "2026-08-21": 10.0})           # 2026-08-20 has no finalized value
    r = be.run(q(find="count"))
    assert r["counts"] == {"sessions": 2, "episodes": 2}
    assert r["gaps"]["count"] == 1 and r["gaps"]["dates"] == ["2026-08-20"]
    assert "no finalized value" in be.answer(r)["text"]


def test_crossings_only_between_consecutive_valid_sessions(world):
    world({"2026-07-06": 60.0, "2026-07-07": 59.0,            # starts exactly AT the level → a crossing below
           "2026-08-19": 40.0, "2026-08-21": 70.0,            # across the missing 08-20 → NOT a crossing
           "2026-09-01": 40.0, "2026-09-02": 65.0}, default=50.0)
    below = be.run(q(op="crosses_below", level=60, find="count"))
    # 07-07 (from exactly 60), 08-24 (70 → 50), 09-03 (65 → 50); 07-06 is 50 → 60, not ABOVE 60
    assert [e["date"] for e in below["events"]] == ["2026-07-07", "2026-08-24", "2026-09-03"]
    above = be.run(q(op="crosses_above", level=60, find="count"))
    assert [e["date"] for e in above["events"]] == ["2026-09-02"]                 # 08-21 follows a gap: no crossing
    assert above["counts"] == {"events": 1}


def test_crossings_are_slice2s_crossings(world):
    """One detector: the crossing sessions equal event_study's own truth on the same finalized series."""
    world({"2026-06-15": 10.0, "2026-06-16": 30.0, "2026-07-20": 5.0, "2026-07-21": 25.0}, default=22.0)
    s = br.sealed_series("nasdaq", M)
    cal = es._trading_days(s["rows"][0][0], s["rows"][-1][0])
    known, _ = es._align({"rows": s["rows"], "alignment": "session"}, cal)
    t = es._truth({"op": "cross_above", "threshold": 20}, cal, known, None)
    assert [e["date"] for e in be.run(q(op="crosses_above", find="count"))["events"]] == [d for d in cal if t[d]]


def test_longest_and_last_episode_ongoing_and_begun_before_the_window(world):
    vals = {d: 85.0 for d in fx.SESSIONS if "2026-06-01" <= d <= "2026-06-12"}       # 10 sessions
    vals.update({d: 85.0 for d in fx.SESSIONS if "2026-10-05" <= d <= "2026-10-09"})  # 5, to the watermark
    world(vals)
    longest = be.run(q(op="above", level=80, find="longest"))
    assert (longest["episode"]["start"], longest["episode"]["sessions"]) == ("2026-06-01", 10)
    last = be.run(q(op="above", level=80, find="last_episode"))
    e = last["episode"]
    assert (e["start"], e["end"], e["ongoing"]) == ("2026-10-05", "2026-10-09", True)
    assert "still running at the latest finalized session" in be.answer(last)["text"]
    clipped = be.run(q(op="above", level=80, find="episodes", start="2026-06-05", end="2026-06-30"))
    ep = clipped["episodes"][0]
    assert ep["start"] == "2026-06-05" and ep["began_before_window"] and not ep["ongoing"]
    assert be.answer(clipped)["table"]["rows"][0]["start"] == "2026-06-05 (or earlier)"


def test_provisional_sessions_never_appear(world):
    world({})                                                # fixture appends 99999 on 10-12/10-13 past the watermark
    r = be.run(q(op="above", level=90, find="last"))
    assert r["event"] is None and r["coverage"]["last"] == fx.LAST_SEALED
    assert "99999" not in be.answer(r)["text"]
    assert be.run(q(find="count", start="2026-10-12"))["reason"] == "no_sessions"


@pytest.mark.parametrize("bad,reason", [
    (q(op="crosses_above", find="episodes"), "bad_request"),
    (q(op="crosses_below", find="longest"), "bad_request"),
    (q(aggregation="weekly"), "not_supported"),
    (q(aggregation="monthly"), "bad_request"),
    (q(level=150), "bad_threshold"),
    (q(level=True), "bad_threshold"),
    (q(level=None), "bad_threshold"),
    (q(op="crosses"), "bad_condition"),
    (q(find="all"), "bad_request"),
    (q(start="2026-13-01"), "bad_date"),
    (q(start="2026-09-01", end="2026-08-01"), "bad_date"),
    ({**q(), "note": "73.4567"}, "bad_request"),
    ({**q(), "universe": "uct"}, "unsupported_universe"),
    ({k: v for k, v in q().items() if k != "find"}, "bad_request"),
])
def test_refusals_read_nothing(world, bad, reason):
    state = world({})
    r = be.run(bad)
    assert r["status"] == "refused" and r["reason"] == reason
    assert state["calls"] == []
    out = be.answer(r)
    assert out["table"] is None and not re.search(r"\d+\.\d", out["text"])


def test_validate_is_value_free_and_note_rebuilt_from_it(world):
    world({"2026-08-03": 18.0})
    ok, err = be.validate(q(level=20, start="2015-01-01"))
    assert err is None and set(ok) == {"universe", "metric", "label", "unit", "domain", "op", "level", "find",
                                       "aggregation", "start", "end"}
    note = be.request_note(q(level=20, start="2015-01-01"))
    assert note.startswith("breadth history: most recent") and "20" in note and "2015-01-01" in note
    assert "18" not in note
    assert be.request_note({**q(), "note": "73.4567"}) == ""


def test_three_validators_are_disjoint():
    """The Agent records local requests as bare args and tries each validator in turn."""
    lookups = [{"mode": "value", "universe": "us", "metrics": [M]},
               {"mode": "series", "universe": "nyse", "metrics": [M], "start": "2024-01-01"}]
    studies = [{"condition": {"series": {"kind": "breadth", "universe": "nasdaq", "metric": M},
                              "op": "below", "threshold": 10}, "symbol": "QQQ", "horizons": [{"sessions": 5}]}]
    events = [q(), q(op="crosses_above", find="count", start="2020-01-01")]
    for x in lookups:
        assert br.validate(x)[0] and not es.validate(x)[0] and not be.validate(x)[0] and be.request_note(x) == ""
    for x in studies:
        assert es.validate(x)[0] and not br.validate(x)[0] and not be.validate(x)[0] and be.request_note(x) == ""
    for x in events:
        assert be.validate(x)[0] and not br.validate(x)[0] and not es.validate(x)[0] and es.request_note(x) == ""


def test_answer_states_window_source_and_finalized_basis(world):
    world({"2026-06-10": 15.0})
    out = be.answer(be.run(q(find="last", start="2026-06-01")))
    assert out["status"] == "ok" and out["lead"] == out["text"].split("\n")[0]
    assert "2026-06-10" in out["lead"] and "15.0%" in out["lead"]
    assert "finalized end-of-day sessions only" in out["text"] and fx.LAST_SEALED in out["text"]


def test_module_imports_no_model_or_network_client_and_reuses_the_core():
    src = Path(be.__file__).read_text(encoding="utf-8")
    assert not re.search(r"^\s*(import|from)\s+(anthropic|openai|requests|httpx|urllib|aiohttp|socket)\b", src, re.M)
    assert "_es._truth(" in src and "_br.sealed_series(" in src and "_es._align(" in src
