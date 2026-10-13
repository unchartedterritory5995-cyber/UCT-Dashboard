"""`breadth_current.completed_sessions` (2026-10-13, owner-approved): the COMPLETED provisional
sessions after the finalized watermark — what a dated / close / range answer may use, labelled.
Synthetic values only."""
from __future__ import annotations

from datetime import datetime

import pytest

from api.services import breadth_current as bc
from api.services import breadth_live_universes as blu

ET = bc._ET
FINAL = {"2026-10-08": 1.0, "2026-10-09": 1.5}


def _payload(rows, data_as_of=None, drift=0.01, ok=True, carried=False):
    p = {"ok": True, "data_as_of": data_as_of,
         "universes": {u: {"ok": ok, "population_drift": drift, "rows": rows, "reason": None if ok else "x"}
                       for u in ("us", "nyse", "nasdaq")}}
    if carried:
        p.update(carried=True, carried_reason="boot grace")
    return p


OCT12 = {"date": "2026-10-12", "final": True, "metrics": {"pct_above_50sma": 2.0, "new_52w_lows": 9.0}}
TODAY = {"date": "2026-10-13", "final": False, "metrics": {"pct_above_50sma": 3.0}}


@pytest.mark.parametrize("u", ["us", "nyse", "nasdaq"])
def test_the_audit_case_oct12_close_resolves_to_its_provisional_close(u):
    """'US A50 at the October 12 close' at 11:37 ET Tue: Oct 12 completed, not yet finalized."""
    now = datetime(2026, 10, 13, 11, 37, tzinfo=ET)
    r = bc.select_completed(u, "pct_above_50sma", now, _payload([OCT12, TODAY], "2026-10-13T11:36:00-04:00"), FINAL)
    assert r["ok"] and r["finalized_through"] == "2026-10-09"
    assert [s["session"] for s in r["sessions"]] == ["2026-10-12"]            # never today's in-progress
    s = r["sessions"][0]
    assert s["status"] == "provisional" and s["label"] == "Provisional close · Oct 12"
    assert s["observation_basis"] == "session_close" and s["observed_at"].startswith("2026-10-12T16:00")


def test_todays_row_counts_only_once_its_data_has_passed_the_close():
    after = datetime(2026, 10, 13, 17, 0, tzinfo=ET)
    r = bc.select_completed("us", "pct_above_50sma", after, _payload([OCT12, TODAY], "2026-10-13T16:00:40-04:00"), FINAL)
    assert [s["session"] for s in r["sessions"]] == ["2026-10-13", "2026-10-12"]   # newest first
    assert r["sessions"][0]["observation_basis"] == "vendor_snapshot"
    # a delayed feed still before the close at 16:05: today is not completed
    r = bc.select_completed("us", "pct_above_50sma", datetime(2026, 10, 13, 16, 5, tzinfo=ET),
                            _payload([OCT12, TODAY], "2026-10-13T15:49:50-04:00"), FINAL)
    assert [s["session"] for s in r["sessions"]] == ["2026-10-12"]


def test_an_unstamped_or_carried_today_row_is_excluded_not_guessed():
    now = datetime(2026, 10, 13, 17, 0, tzinfo=ET)
    r = bc.select_completed("nasdaq", "pct_above_50sma", now, _payload([OCT12, TODAY], None, carried=True), FINAL)
    assert [s["session"] for s in r["sessions"]] == ["2026-10-12"]           # Oct 12 closing bars still valid


def test_finalization_moves_the_session_out_of_the_accessor():
    now = datetime(2026, 10, 13, 21, 0, tzinfo=ET)
    fin = dict(FINAL, **{"2026-10-12": 2.1})
    r = bc.select_completed("us", "pct_above_50sma", now, _payload([OCT12, TODAY], "2026-10-13T16:00:40-04:00"), fin)
    assert r["finalized_through"] == "2026-10-12"
    assert [s["session"] for s in r["sessions"]] == ["2026-10-13"]


def test_nothing_completed_after_the_watermark_says_why():
    now = datetime(2026, 10, 13, 11, 0, tzinfo=ET)
    r = bc.select_completed("us", "pct_above_50sma", now, _payload([TODAY], "2026-10-13T10:59:00-04:00"), FINAL)
    assert r["ok"] and r["sessions"] == [] and "no completed session" in r["reason"]


@pytest.mark.parametrize("metric", ["new_52w_lows", "net_new_high_low", "mcclellan_osc"])
def test_finalized_only_measures_never_get_a_provisional_session(metric):
    now = datetime(2026, 10, 13, 11, 37, tzinfo=ET)
    r = bc.select_completed("us", metric, now, _payload([OCT12], "2026-10-13T11:36:00-04:00"), FINAL)
    assert r["sessions"] == [] and r["reason"] == "measure is finalized-only"


@pytest.mark.parametrize("payload,why", [
    ({"ok": False, "reason": "boot grace"}, "boot grace"),
    (_payload([OCT12], ok=False), "unavailable"),
    (_payload([OCT12], drift=0.09), "reconcile"),
])
def test_an_unusable_payload_is_ok_false_with_a_reason(payload, why):
    r = bc.select_completed("us", "pct_above_50sma", datetime(2026, 10, 13, 11, 0, tzinfo=ET), payload, FINAL)
    assert r["ok"] is False and r["sessions"] == [] and why in r["reason"]


def test_chart_and_accessor_agree_on_completed_sessions(monkeypatch):
    now = datetime(2026, 10, 13, 17, 0, tzinfo=ET)
    p = _payload([OCT12, TODAY], "2026-10-13T16:00:40-04:00")
    monkeypatch.setattr(blu, "serving", lambda: True)
    monkeypatch.setattr(blu, "payload", lambda cached_only=True: p)
    monkeypatch.setattr(blu, "_intraday_path", lambda *a: None)
    body = [{"t": "2026-10-09", "o": 1, "h": 1, "l": 1, "c": 1.5, "v": 0}]
    drawn = [b["t"] for b in blu.append_library_bars(body, "us", "pct_above_50sma", now=now)][1:]
    acc = sorted(s["session"] for s in bc.select_completed("us", "pct_above_50sma", now, p, FINAL)["sessions"])
    assert drawn == acc == ["2026-10-12", "2026-10-13"]


def test_the_public_call_never_raises_and_rejects_unknown_universes(monkeypatch):
    assert bc.completed_sessions("uct", "pct_above_50sma")["ok"] is False
    monkeypatch.setattr(bc, "_inputs", lambda u, m: ({"ok": True}, {}))
    monkeypatch.setattr(bc, "select_completed", lambda *a: (_ for _ in ()).throw(ValueError("boom")))
    r = bc.completed_sessions("us", "pct_above_50sma")
    assert r["ok"] is False and "selection failed" in r["reason"]
