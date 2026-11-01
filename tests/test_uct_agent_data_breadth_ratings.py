"""MD-1 kinds `breadth.current` and `ratings` (agent-md, Sprint 1 PR 4b), both MODEL-ISOLATED.

No network: breadth_current.reading and research.ratings.get_ratings are stubbed at their public reads. Pins:
the isolation (every non-"answer" purpose refused before admission, with no read and no budget spent),
breadth's status → freshness mapping, as_of from the VENDOR observation time (never computed_at),
stale = not current with the label as the disclosure, tier notes, stale_reason kept out of the envelope,
and the ratings as_of / partial / stale rules.
"""
from __future__ import annotations

import pathlib

import pytest

from api.services import bars_fetch, breadth_current
from api.services.research import ratings as ratings_svc
from api.services.uct_agent.marketdata import breadth as br
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import ratings as rt

_ROOT = pathlib.Path(__file__).resolve().parents[1]
LATEST = 20261030


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    gw._reset_for_test(None)
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", lambda now=None: LATEST)
    yield
    gw._reset_for_test(None)


def _read(kind, params, purpose="answer", turn="t1"):
    return gw.read(kind, params, user_id=1, turn_id=turn, purpose=purpose)


def _reading(**kw):
    r = {"ok": True, "value": 61.4, "status": "intraday", "session": "2026-11-02",
         "observed_at": "2026-11-02T11:52:03-05:00", "observation_basis": "vendor_snapshot",
         "computed_at": "2026-11-02T11:53:30-05:00", "current": True, "label": "Intraday · 11:52 AM ET",
         "accuracy_tier": "validated", "market_open": True, "finalized_session": "2026-10-29",
         "population_drift": 0.01, "stale_reason": None}
    r.update(kw)
    return r


def _breadth(monkeypatch, **kw):
    calls = []

    def reading(u, m, now=None):
        calls.append((u, m))
        return _reading(**kw)
    monkeypatch.setattr(breadth_current, "reading", reading)
    return calls


# ── isolation ─────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("kind,params", [("breadth.current", {"metric": "pct_above_50sma"}),
                                         ("ratings", {"symbol": "AAPL"})])
@pytest.mark.parametrize("purpose", ["research", "scan"])
def test_model_isolated_kinds_refuse_every_non_answer_purpose_before_any_read(monkeypatch, kind, params, purpose):
    calls = _breadth(monkeypatch)
    monkeypatch.setattr(ratings_svc, "get_ratings", lambda s: calls.append(s))
    out = _read(kind, params, purpose=purpose)
    assert env.validate_envelope(out) == [] and out["status"] == "refused" and calls == []
    assert "never used for research" in out["notes"][0]


def test_isolated_refusals_spend_no_budget(monkeypatch):
    _breadth(monkeypatch)
    for _ in range(gw.MAX_READS_PER_TURN + 2):
        out = _read("breadth.current", {"metric": "pct_above_50sma"}, purpose="research", turn="x")
        assert out["status"] == "refused"
    assert _read("breadth.current", {"metric": "pct_above_50sma"}, turn="x")["status"] == "ok"


def test_both_kinds_register_model_isolated():
    r = gw.registry()
    assert r.get("breadth.current").model_isolated is True and r.get("ratings").model_isolated is True
    assert r.get("quote").model_isolated is False      # control: an ordinary market kind is not isolated


# ── breadth.current ───────────────────────────────────────────────────────────────────────────────────

def test_intraday_current_reading_is_periodic_with_the_vendor_time_and_the_label(monkeypatch):
    calls = _breadth(monkeypatch)
    out = _read("breadth.current", {"universe": "nyse", "metric": "pct_above_50sma"})
    assert env.validate_envelope(out) == []
    assert calls == [("nyse", "pct_above_50sma")]
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == "2026-11-02T16:52:03Z"                 # observed_at, NOT computed_at (16:53:30Z)
    assert out["notes"][0] == "Intraday · 11:52 AM ET" and out["provider_calls"] == 0
    assert set(out["data"]) == set(br.DATA_FIELDS) and out["data"]["value"] == 61.4


@pytest.mark.parametrize("status", ["provisional", "finalized"])
def test_completed_sessions_are_historical(monkeypatch, status):
    _breadth(monkeypatch, status=status, label=f"{status.title()} close · Oct 30", market_open=False,
             observed_at="2026-10-30T16:00:00-04:00")
    out = _read("breadth.current", {"metric": "pct_above_50sma"})
    assert out["freshness"] == "historical" and out["as_of"] == "2026-10-30T20:00:00Z"


def test_not_current_is_stale_says_what_it_is_and_keeps_stale_reason_out(monkeypatch):
    _breadth(monkeypatch, current=False, label="Finalized close · Oct 29", status="finalized",
             stale_reason="INTERNAL: live payload 412s old")
    out = _read("breadth.current", {"metric": "pct_above_50sma"})
    assert out["stale"] is True
    assert br.NOTE_NOT_CURRENT.format(label="Finalized close · Oct 29") in out["notes"]
    assert "INTERNAL" not in repr(out)


@pytest.mark.parametrize("tier,note", [("approximate", br.NOTE_APPROXIMATE),
                                       ("finalized_only", br.NOTE_FINALIZED_ONLY)])
def test_accuracy_tiers_add_their_note(monkeypatch, tier, note):
    _breadth(monkeypatch, accuracy_tier=tier)
    assert note in _read("breadth.current", {"metric": "advancing"})["notes"]


@pytest.mark.parametrize("metric", br.NHNL_METRICS)
def test_nhnl_measures_are_breadth_metrics(monkeypatch, metric):
    calls = _breadth(monkeypatch, accuracy_tier="finalized_only", current=False, status="finalized",
                     label="Finalized close · Oct 29")
    out = _read("breadth.current", {"metric": metric})
    assert calls == [("us", metric)] and out["status"] == "ok" and out["freshness"] == "historical"
    assert br.NOTE_FINALIZED_ONLY in out["notes"]


def test_unknown_observation_time_gives_null_as_of_with_a_note(monkeypatch):
    _breadth(monkeypatch, observed_at=None, current=False, label="Intraday · observation time unknown")
    out = _read("breadth.current", {"metric": "pct_above_50sma"})
    assert env.validate_envelope(out) == [] and out["as_of"] is None and br.NOTE_NO_OBSERVATION in out["notes"]


@pytest.mark.parametrize("reading", [{"ok": False, "stale_reason": "unknown metric"},
                                     {"ok": True, "value": None}, None])
def test_no_reading_is_unavailable(monkeypatch, reading):
    monkeypatch.setattr(breadth_current, "reading", lambda u, m, now=None: reading)
    out = _read("breadth.current", {"metric": "made_up"})
    assert env.validate_envelope(out) == [] and out["status"] == "unavailable"
    assert "unknown metric" not in repr(out)


@pytest.mark.parametrize("params", [{}, {"metric": "X Y"}, {"metric": "pct_above_50sma", "universe": "uct20"}])
def test_breadth_bad_params_are_refused(monkeypatch, params):
    calls = _breadth(monkeypatch)
    assert _read("breadth.current", params)["status"] == "refused" and calls == []


# ── ratings ───────────────────────────────────────────────────────────────────────────────────────────

def _rating(**kw):
    r = {"sym": "AAPL", "entity": {"big": "x" * 50}, "composite": 82,
         "components": {"eps": 90, "rs": 77, "growth": 70, "value": 40, "smr": "B", "accdis": "B+",
                        "sponsorship": 60},
         "checkup": [{"item": "Composite >= 80", "pass": True}], "method": "Percentile rank vs universe",
         "basis": "percentile", "coverage": {"measured_weight": 1.0}, "universe_n": 3700, "sector": "Technology",
         "group_rs": 71, "price_as_of": "2026-10-30", "complete": True}
    r.update(kw)
    return r


def test_ratings_as_of_is_the_price_session_close_with_the_uct_and_undated_notes(monkeypatch):
    monkeypatch.setattr(ratings_svc, "get_ratings", lambda s: _rating())
    out = _read("ratings", {"symbol": "aapl"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == "2026-10-30T20:00:00Z" and out["provider_calls"] == rt.PROVIDER_CALLS
    assert rt.NOTE_UCT_DERIVED in out["notes"] and rt.NOTE_UNDATED_LEGS in out["notes"]
    assert set(out["data"]) == set(rt.DATA_FIELDS) and "entity" not in repr(out["data"])
    assert out["data"]["components"]["smr"] == "B" and out["source"] == "uct-ratings"


def test_ratings_price_behind_the_last_session_is_stale(monkeypatch):
    monkeypatch.setattr(ratings_svc, "get_ratings", lambda s: _rating(price_as_of="2026-10-28"))
    out = _read("ratings", {"symbol": "AAPL"})
    assert out["stale"] is True
    assert rt.NOTE_PRICE_BEHIND.format(date="2026-10-28", session="2026-10-30") in out["notes"]


def test_ratings_incomplete_is_partial(monkeypatch):
    monkeypatch.setattr(ratings_svc, "get_ratings", lambda s: _rating(complete=False))
    out = _read("ratings", {"symbol": "AAPL"})
    assert out["status"] == "partial" and rt.NOTE_INCOMPLETE in out["notes"]


def test_ratings_without_a_price_date_has_null_as_of_and_is_stale(monkeypatch):
    monkeypatch.setattr(ratings_svc, "get_ratings", lambda s: _rating(price_as_of=None))
    out = _read("ratings", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == [] and out["as_of"] is None and out["stale"] is True


@pytest.mark.parametrize("payload", [{}, None, {"composite": None}])
def test_ratings_unavailable(monkeypatch, payload):
    monkeypatch.setattr(ratings_svc, "get_ratings", lambda s: payload)
    out = _read("ratings", {"symbol": "ZZZZ"})
    assert env.validate_envelope(out) == [] and out["status"] == "unavailable"


def test_the_contract_doc_states_section_4_4():
    doc = (_ROOT / "docs/agent/program/contracts/MD-1-market-data.md").read_text(encoding="utf-8")
    assert "### 4.4 Model-isolated kinds: `breadth.current`, `ratings` (v1.4)" in doc
    for s in (br.NOTE_NOT_CURRENT, br.NOTE_APPROXIMATE, br.NOTE_FINALIZED_ONLY, br.NOTE_UNAVAILABLE,
              rt.NOTE_UCT_DERIVED, rt.NOTE_UNDATED_LEGS, rt.NOTE_INCOMPLETE, rt.NOTE_PRICE_BEHIND):
        assert s in doc, s
