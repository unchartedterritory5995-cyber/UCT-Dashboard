"""Outcome engine rails (manifest §7.3, outcomes-v1; stream S-E).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a bar that spans both the stop and the target booked as either one without 5-minute bars.
2. a missing bar read as a zero return, or a missing ticker read as a zero outcome.
3. an anchor that borrows a close the statement could not have seen (weekend, after-close,
   day precision) or ignores a stated entry the session traded through.
4. MFE/MAE that skip the bar that closes a horizon.
5. a horizon that has not closed yet reported as a number.
6. a stated outcome "verified" against bars after the statement.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from api.services.wisdom.core.timeutil import ET
from api.services.wisdom.evals import outcomes
from api.services.wisdom.evals.bars_asof import BarsAsOf, MemoryReader, ymd_int


def _weekdays(start: date, n: int) -> list[int]:
    out, cur = [], start
    while len(out) < n:
        if cur.weekday() < 5:
            out.append(ymd_int(cur))
        cur += timedelta(days=1)
    return out


SESSIONS = _weekdays(date(2026, 8, 3), 40)      # 2026-08-03 is a Monday


def _reader(ticker_bars: dict | None = None, *, spy_sessions=None, ticker_sessions=None, intraday=None,
            ticker="ABC"):
    spy_sessions = SESSIONS if spy_sessions is None else spy_sessions
    ticker_sessions = SESSIONS if ticker_sessions is None else ticker_sessions
    rows = {("SPY", "D"): [(s, 100.0, 101.0, 99.0, 100.0, 1e6) for s in spy_sessions]}
    overrides = ticker_bars or {}
    rows[(ticker, "D")] = [(s,) + tuple(overrides.get(s, (50.0, 51.0, 49.0, 50.0))) + (1e5,) for s in ticker_sessions]
    for key, value in (intraday or {}).items():
        rows[key] = value
    return BarsAsOf(MemoryReader(rows))


def _record(**over):
    rec = {"record_id": "r1", "ticker": "ABC", "direction": "long", "stated_at_et": "2026-08-05T10:00:00-04:00",
           "stated_at_precision": "minute", "entry": None, "stop": None, "targets_json": "[]"}
    rec.update(over)
    return rec


NOW = datetime(2026, 9, 30, 18, 0, tzinfo=ET)


def _detail(row):
    return json.loads(row["horizons_json"])


# ── 3. anchors ───────────────────────────────────────────────────────────────

def test_a_pre_open_minute_call_anchors_on_that_session_close():
    bars = _reader({20260806: (50.0, 56.0, 49.5, 55.0)})
    out = outcomes.compute(_record(stated_at_et="2026-08-05T08:30:00-04:00"), bars, now=NOW)
    row = out["row"]
    assert out["status"] == "computed"
    assert (row["anchor_session"], row["anchor_rule"], row["anchor_price"]) == ("2026-08-05", "session_close", 50.0)
    assert row["ret_1"] == 10.0


def test_a_weekend_statement_anchors_on_the_next_open_and_counts_that_bar():
    bars = _reader({20260810: (52.0, 60.0, 51.0, 55.0), 20260811: (55.0, 58.0, 54.0, 57.0)})
    out = outcomes.compute(_record(stated_at_et="2026-08-08T12:00:00-04:00", stated_at_precision="day"), bars, now=NOW)
    row, detail = out["row"], _detail(out["row"])
    assert (row["anchor_session"], row["anchor_rule"], row["anchor_price"]) == ("2026-08-10", "next_open", 52.0)
    assert row["ret_1"] == round((57 - 52) / 52 * 100, 4)
    assert detail["horizons"]["1"]["mfe"] == round((60 - 52) / 52 * 100, 4)   # the anchor bar itself


def test_an_after_close_call_and_a_day_precision_call_never_borrow_that_days_close():
    bars = _reader({20260806: (53.0, 54.0, 52.0, 53.5)})
    after = outcomes.compute(_record(stated_at_et="2026-08-05T16:30:00-04:00"), bars, now=NOW)["row"]
    day = outcomes.compute(_record(stated_at_et="2026-08-05T00:00:00-04:00", stated_at_precision="day"), bars,
                           now=NOW)["row"]
    for row in (after, day):
        assert (row["anchor_session"], row["anchor_rule"], row["anchor_price"]) == ("2026-08-06", "next_open", 53.0)


def test_a_stated_entry_the_session_traded_through_is_the_anchor():
    out = outcomes.compute(_record(entry=49.5), _reader(), now=NOW)
    assert (out["row"]["anchor_rule"], out["row"]["anchor_price"]) == ("stated_entry_traded", 49.5)
    # control: an entry outside the anchor bar's range is not
    out = outcomes.compute(_record(entry=48.0), _reader(), now=NOW)
    assert out["row"]["anchor_rule"] == "session_close"


# ── 1. same-bar ambiguity ────────────────────────────────────────────────────

_BOTH = {20260807: (50.0, 61.0, 44.0, 50.0)}


def test_a_bar_spanning_stop_and_target_stays_unresolved_without_intraday_bars():
    rec = _record(stop=45.0, targets_json=json.dumps([{"price": 60.0, "text": "t1"}]))
    row = outcomes.compute(rec, _reader(_BOTH), now=NOW)["row"]
    detail = _detail(row)
    assert (row["same_bar_ambiguity"], row["resolved_with_intraday"]) == (1, 0)
    assert detail["first_hit"] == "ambiguous"
    assert row["stop_hit"] == 1 and row["target_hit"] == 1
    assert row["stop_hit_session"] == row["target_hit_session"] == "2026-08-07"
    # unresolved is neither a win nor a loss: the weight falls back to the 10-session return
    assert outcomes.quality_weight(row) == 0.5


def test_five_minute_bars_resolve_which_level_traded_first():
    t0 = int(datetime(2026, 8, 7, 9, 30, tzinfo=ET).timestamp())
    intraday = {("ABC", "5"): [(t0, 55.0, 61.0, 55.0, 60.5, 1e4), (t0 + 300, 60.0, 60.0, 44.0, 45.0, 1e4)]}
    rec = _record(stop=45.0, targets_json=json.dumps([{"price": 60.0, "text": "t1"}]))
    row = outcomes.compute(rec, _reader(_BOTH, intraday=intraday), now=NOW)["row"]
    assert (row["same_bar_ambiguity"], row["resolved_with_intraday"]) == (1, 1)
    assert _detail(row)["first_hit"] == "target"
    assert outcomes.quality_weight(row) == 1.0
    # control: a 5-minute bar that itself spans both levels resolves nothing
    both = {("ABC", "5"): [(t0, 55.0, 61.0, 44.0, 50.0, 1e4)]}
    row = outcomes.compute(rec, _reader(_BOTH, intraday=both), now=NOW)["row"]
    assert (row["resolved_with_intraday"], _detail(row)["first_hit"]) == (0, "ambiguous")


def test_a_stop_that_trades_first_on_its_own_bar_weights_zero():
    bars = _reader({20260806: (50.0, 50.5, 44.0, 45.0), 20260810: (50.0, 61.0, 49.0, 60.0)})
    rec = _record(stop=45.0, targets_json=json.dumps([{"price": 60.0, "text": "t1"}]))
    row = outcomes.compute(rec, bars, now=NOW)["row"]
    assert _detail(row)["first_hit"] == "stop" and row["same_bar_ambiguity"] == 0
    assert outcomes.quality_weight(row) == 0.0


# ── 2. missing bars ──────────────────────────────────────────────────────────

def test_a_missing_bar_is_unverifiable_never_a_zero_return():
    sessions = [s for s in SESSIONS if s != 20260810]           # idx3 after the 08-05 anchor
    row = outcomes.compute(_record(), _reader(ticker_sessions=sessions), now=NOW)["row"]
    detail = _detail(row)["horizons"]
    assert row["ret_1"] == 0.0 and detail["1"]["status"] == "ok"
    assert row["ret_3"] is None and detail["3"] == {"status": "unverifiable", "reason": "missing_bar:2026-08-10"}
    assert row["ret_20"] is None and detail["20"]["status"] == "unverifiable"
    assert row["n_sessions_available"] == 2


def test_a_ticker_with_no_bar_for_the_anchor_session_is_unverifiable_with_its_reason():
    out = outcomes.compute(_record(ticker="NOPE"), _reader(), now=NOW)
    assert out["status"] == "unverifiable"
    assert out["reason"] == "no_bar_for_anchor_session:2026-08-05"
    assert all(out["row"][k] is None for k in ("anchor_price", "ret_1", "ret_20", "mfe_pct", "mae_pct"))


def test_missing_ticker_direction_or_time_are_named():
    for over, reason in (({"ticker": ""}, "no_ticker"), ({"direction": None}, "no_direction"),
                         ({"stated_at_et": None}, "no_stated_at")):
        out = outcomes.compute(_record(**over), _reader(), now=NOW)
        assert (out["status"], out["reason"]) == ("unverifiable", reason)


# ── 5. immature horizons ─────────────────────────────────────────────────────

def test_an_anchor_session_that_has_not_closed_is_pending_and_writes_nothing():
    out = outcomes.compute(_record(stated_at_et="2026-09-29T10:00:00-04:00"), _reader(), now=NOW)
    assert out == {"status": "pending", "reason": "anchor_session_not_closed", "row": None}


def test_horizons_that_have_not_closed_stay_null_and_mfe_uses_the_widest_closed_one():
    short = SESSIONS[:8]
    bars = _reader({SESSIONS[7]: (50.0, 70.0, 30.0, 52.0)}, spy_sessions=short, ticker_sessions=short)
    row = outcomes.compute(_record(), bars, now=NOW)["row"]
    detail = _detail(row)["horizons"]
    assert row["ret_5"] == 4.0 and detail["10"] == {"status": "immature"} and row["ret_10"] is None
    assert row["n_sessions_available"] == 5
    # 4. the bar that closes horizon 5 is inside its window
    assert (row["mfe_pct"], row["mae_pct"]) == (40.0, -40.0)
    assert outcomes.needs_refresh(row) is True


def test_short_calls_flip_every_sign():
    bars = _reader({20260806: (50.0, 52.0, 44.0, 45.0)})
    row = outcomes.compute(_record(direction="short"), bars, now=NOW)["row"]
    assert row["ret_1"] == 10.0
    detail = _detail(row)["horizons"]["1"]
    assert (detail["mfe"], detail["mae"]) == (12.0, -4.0)


# ── 6. reconciliation is content-stated and looks BACK ──────────────────────

def _past(**over):
    return _record(stated_at_et="2026-09-02T10:00:00-04:00", stance="stopped_out", **over)


def test_a_stated_stop_is_checked_against_bars_before_the_statement_only():
    touched = _reader({20260820: (48.0, 49.0, 44.5, 45.5)})
    assert outcomes.reconcile(_past(stated_outcome="stopped", stop=45.0), touched,
                              datetime(2026, 9, 2, 10, tzinfo=ET), "minute") == ("agrees", "price_traded_at_stated_stop")
    never = _reader()
    assert outcomes.reconcile(_past(stated_outcome="stopped", stop=45.0), never,
                              datetime(2026, 9, 2, 10, tzinfo=ET), "minute")[0] == "disagrees"
    # the only touch is AFTER the statement: it must not count
    later = _reader({20260910: (48.0, 49.0, 44.0, 45.0)})
    assert outcomes.reconcile(_past(stated_outcome="stopped", stop=45.0), later,
                              datetime(2026, 9, 2, 10, tzinfo=ET), "minute")[0] == "disagrees"
    assert outcomes.reconcile(_past(stated_outcome="stopped"), never, datetime(2026, 9, 2, 10, tzinfo=ET),
                              "minute") == ("unverifiable", "no_stated_stop")


def test_a_stated_return_needs_its_entry_and_implied_exit_to_have_traded():
    bars = _reader({20260825: (54.0, 55.5, 53.0, 55.0)})
    rec = _past(stated_outcome="profit", entry=50.0, stated_return_pct=10.0)
    assert outcomes.reconcile(rec, bars, datetime(2026, 9, 2, 10, tzinfo=ET), "minute")[0] == "agrees"
    rec = _past(stated_outcome="profit", entry=50.0, stated_return_pct=40.0)
    assert outcomes.reconcile(rec, bars, datetime(2026, 9, 2, 10, tzinfo=ET), "minute")[0] == "disagrees"
    assert outcomes.reconcile(_past(stated_outcome="still_holding"), bars, datetime(2026, 9, 2, 10, tzinfo=ET),
                              "minute")[0] == "unverifiable"
    assert outcomes.reconcile(_past(stated_outcome=None), bars, datetime(2026, 9, 2, 10, tzinfo=ET),
                              "minute") == (None, None)


def test_refresh_stops_once_twenty_sessions_closed_or_the_anchor_failed():
    assert outcomes.needs_refresh(None) is True
    assert outcomes.needs_refresh({"methodology_version": outcomes.METHODOLOGY_VERSION,
                                   "n_sessions_available": 20, "unverifiable_reason": None}) is False
    assert outcomes.needs_refresh({"methodology_version": outcomes.METHODOLOGY_VERSION, "n_sessions_available": 0,
                                   "unverifiable_reason": "no_bar_for_anchor_session:2026-08-05"}) is False
    assert outcomes.needs_refresh({"methodology_version": "outcomes-v0", "n_sessions_available": 20}) is True
