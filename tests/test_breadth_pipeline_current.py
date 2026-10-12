"""The breadth pipeline-stage check (`breadth_pipeline`) and the present-tense reading
(`breadth_current`). Regression for 2026-10-12: Monday morning, Oct 9 collected and waiting for
Oct 12's row (the D+1 gate) — NOT a gap — while the Agent answered "as of Oct 8 close".
All values here are synthetic."""
from __future__ import annotations

from datetime import datetime

from api.services import breadth_current as bc
from api.services import breadth_pipeline as bp

ET = bc._ET
RAW = {"2026-10-05": "2026-10-05 20:20:00", "2026-10-06": "2026-10-06 20:20:00",
       "2026-10-07": "2026-10-07 20:20:00", "2026-10-08": "2026-10-08 20:20:00",
       "2026-10-09": "2026-10-09 20:21:02"}
FIN_THROUGH_8 = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]


def _fin(dates):
    return {"us": list(dates), "nyse": list(dates), "nasdaq": list(dates)}


def _stage(res, d):
    return next(r for r in res["sessions"] if r["date"] == d)["stage"]


# ── pipeline stages ──────────────────────────────────────────────────────────

def test_monday_morning_oct9_is_waiting_for_its_gate_not_missing():
    res = bp.status(datetime(2026, 10, 12, 11, 52, tzinfo=ET), sessions=5, raw=RAW,
                    finalized=_fin(FIN_THROUGH_8))
    assert _stage(res, "2026-10-09") == "awaiting_next_session"
    assert _stage(res, "2026-10-12") == "awaiting_raw"
    assert _stage(res, "2026-10-08") == "finalized"
    assert res["ok"] and res["expected_finalized"] == "2026-10-08"
    assert res["latest_finalized"]["nasdaq"] == "2026-10-08"


def test_gate_present_inside_grace_is_finalizing():
    raw = dict(RAW, **{"2026-10-12": "2026-10-12 20:25:00"})     # 16:25 ET
    res = bp.status(datetime(2026, 10, 12, 18, 0, tzinfo=ET), sessions=5, raw=raw,
                    finalized=_fin(FIN_THROUGH_8))
    assert _stage(res, "2026-10-09") == "finalizing" and res["ok"]


def test_gate_present_past_grace_is_stuck_at_finalization_and_names_the_universe():
    raw = dict(RAW, **{"2026-10-12": "2026-10-12 20:25:00"})
    fin = _fin(FIN_THROUGH_8)
    fin["us"].append("2026-10-09")                             # US done, exchanges not
    res = bp.status(datetime(2026, 10, 12, 21, 30, tzinfo=ET), sessions=5, raw=raw, finalized=fin)
    assert _stage(res, "2026-10-09") == "stuck_finalization"
    assert not res["ok"] and "NYSE/NASDAQ" in res["problems"]["finalization"][0]
    assert res["expected_finalized"] == "2026-10-09"


def test_missing_row_after_the_deadline_is_stuck_at_collection():
    res = bp.status(datetime(2026, 10, 12, 22, 30, tzinfo=ET), sessions=5, raw=RAW,
                    finalized=_fin(FIN_THROUGH_8))
    assert _stage(res, "2026-10-12") == "stuck_collection"
    assert res["problems"]["collection"] and not res["problems"]["finalization"]


def test_an_unreadable_finalized_store_is_unknown_never_fine():
    res = bp.status(datetime(2026, 10, 12, 11, 0, tzinfo=ET), sessions=3, raw=RAW,
                    finalized={"us": None, "nyse": None, "nasdaq": None})
    assert {r["stage"] for r in res["sessions"] if r["date"] <= "2026-10-09"} == {"unknown"}


def test_check_sends_one_alert_per_stuck_stage_and_clears(monkeypatch, tmp_path):
    from api.services import breadth_alerts
    monkeypatch.setenv("BREADTH_ALERTS_STATE", str(tmp_path / "s.json"))
    monkeypatch.setenv("DISCORD_BREADTH_WEBHOOK_URL", "https://discord.test/b")
    posts = []

    class R:
        status_code = 204
    post = lambda url, **k: posts.append(k["json"]["content"]) or R()   # noqa: E731
    raw = dict(RAW, **{"2026-10-12": "2026-10-12 20:25:00"})
    bp.check(datetime(2026, 10, 13, 9, 45, tzinfo=ET), post=post, sessions=5, raw=raw,
             finalized=_fin(FIN_THROUGH_8))
    assert len(posts) == 1 and "not finalized" in posts[0]
    cleared = []
    monkeypatch.setattr(breadth_alerts, "clear", lambda k: cleared.append(k))
    bp.check(datetime(2026, 10, 13, 9, 45, tzinfo=ET), post=post, sessions=5, raw=raw,
             finalized=_fin(FIN_THROUGH_8 + ["2026-10-09"]))
    assert "pipeline:finalization" in cleared and len(posts) == 1


# ── present-tense reading ────────────────────────────────────────────────────

FINAL = {d: 40.0 for d in FIN_THROUGH_8}


def _payload(as_of, rows, ok=True, drift=0.01, data_as_of="same"):
    return {"ok": True, "as_of": as_of, "L": "2026-10-09",
            "data_as_of": as_of if data_as_of == "same" else data_as_of,
            "universes": {"us": {"ok": ok, "population_drift": drift, "rows": rows,
                                 "reason": None if ok else "degraded"}}}


ROWS = [{"date": "2026-10-09", "final": True, "metrics": {"pct_above_50sma": 41.0}},
        {"date": "2026-10-12", "final": False, "metrics": {"pct_above_50sma": 42.0}}]


def test_market_hours_prefers_the_fresh_intraday_reading():
    now = datetime(2026, 10, 12, 11, 53, tzinfo=ET)
    r = bc.choose("us", "pct_above_50sma", now, _payload("2026-10-12T11:52:20-04:00", ROWS), FINAL)
    assert r["status"] == "intraday" and r["current"] and r["session"] == "2026-10-12"
    assert r["label"] == "Intraday · 11:52 AM ET" and r["finalized_session"] == "2026-10-08"


def test_a_stale_intraday_payload_is_not_now():
    now = datetime(2026, 10, 12, 12, 30, tzinfo=ET)
    r = bc.choose("us", "pct_above_50sma", now, _payload("2026-10-12T11:52:20-04:00", ROWS), FINAL)
    assert r["status"] == "intraday" and not r["current"] and "market data is" in r["stale_reason"]


def test_live_down_never_passes_off_the_finalized_value_as_current():
    now = datetime(2026, 10, 12, 11, 53, tzinfo=ET)
    r = bc.choose("us", "pct_above_50sma", now, {"ok": False, "reason": "warming"}, FINAL)
    assert r["status"] == "finalized" and r["session"] == "2026-10-08"
    assert not r["current"] and "warming" in r["stale_reason"] and "not 2026-10-12" in r["stale_reason"]
    assert r["label"] == "Finalized close · Oct 8"


def test_after_the_close_todays_row_is_a_provisional_close():
    now = datetime(2026, 10, 12, 17, 0, tzinfo=ET)
    r = bc.choose("us", "pct_above_50sma", now, _payload("2026-10-12T16:59:00-04:00", ROWS), FINAL)
    assert r["status"] == "provisional" and r["current"] and r["label"] == "Provisional close · Oct 12"


def test_weekend_reads_fridays_provisional_close_as_current():
    now = datetime(2026, 10, 11, 10, 0, tzinfo=ET)
    r = bc.choose("us", "pct_above_50sma", now,
                  _payload("2026-10-11T09:55:00-04:00", ROWS[:1], data_as_of=None), FINAL)
    assert r["session"] == "2026-10-09" and r["status"] == "provisional" and r["current"]
    assert r["observation_basis"] == "session_close" and r["observed_at"].startswith("2026-10-09T16:00")


def test_finalized_wins_once_the_session_finalizes():
    now = datetime(2026, 10, 13, 8, 0, tzinfo=ET)
    fin = dict(FINAL, **{"2026-10-09": 41.5, "2026-10-12": 42.5})
    r = bc.choose("us", "pct_above_50sma", now, _payload("2026-10-13T07:55:00-04:00", ROWS[:1]), fin)
    assert r["status"] == "finalized" and r["session"] == "2026-10-12" and r["current"]


def test_population_drift_and_finalized_only_measures_fall_back_honestly():
    now = datetime(2026, 10, 12, 11, 53, tzinfo=ET)
    r = bc.choose("us", "pct_above_50sma", now,
                  _payload("2026-10-12T11:52:20-04:00", ROWS, drift=0.09), FINAL)
    assert r["status"] == "finalized" and not r["current"] and "reconcile" in r["stale_reason"]
    r = bc.choose("us", "mcclellan_osc", now, _payload("2026-10-12T11:52:20-04:00", ROWS),
                  {"2026-10-08": 1.0})
    assert r["status"] == "finalized" and not r["current"] and "no live reading" in r["stale_reason"]


def test_a_finalized_close_during_market_hours_is_not_now():
    now = datetime(2026, 10, 12, 11, 53, tzinfo=ET)
    fin = dict(FINAL, **{"2026-10-12": 1.0})       # impossible in practice; the rule still holds
    r = bc.choose("us", "pct_above_50sma", now, {"ok": False, "reason": "x"}, fin)
    assert not r["current"]


def test_unknown_universe():
    assert bc.reading("uct", "pct_above_50sma")["ok"] is False


def test_nh_nl_family_is_finalized_only_until_validated():
    now = datetime(2026, 10, 12, 11, 53, tzinfo=ET)
    rows = [{"date": "2026-10-12", "final": False, "metrics": {"new_52w_lows": 9.0}}]
    r = bc.choose("us", "new_52w_lows", now, _payload("2026-10-12T11:52:20-04:00", rows),
                  {"2026-10-08": 5.0})
    assert r["status"] == "finalized" and not r["current"] and "not yet validated" in r["stale_reason"]
    assert r["accuracy_tier"] == "finalized_only"
    assert bc.accuracy_tier("advancing") == "approximate"
    assert bc.accuracy_tier("pct_above_50sma") == "validated"


# ── observation time vs computation time (2026-10-12 licensing review) ──────

def test_delayed_source_is_labelled_with_the_data_time_and_is_not_current():
    """A 15-minute-delayed feed recomputed at 11:52 holds data observed at 11:37."""
    now = datetime(2026, 10, 12, 11, 52, 30, tzinfo=ET)
    p = _payload("2026-10-12T11:52:20-04:00", ROWS, data_as_of="2026-10-12T11:37:15-04:00")
    r = bc.choose("us", "pct_above_50sma", now, p, FINAL)
    assert r["label"] == "Intraday · 11:37 AM ET" and r["observed_at"].startswith("2026-10-12T11:37:15")
    assert r["computed_at"].startswith("2026-10-12T11:52:20") and r["compute_lag_s"] == 905
    assert not r["current"] and "feed delayed" in r["stale_reason"]


def test_fresh_computation_over_stale_observations_is_not_current():
    now = datetime(2026, 10, 12, 13, 0, 5, tzinfo=ET)
    p = _payload("2026-10-12T13:00:00-04:00", ROWS, data_as_of="2026-10-12T12:50:00-04:00")
    r = bc.choose("us", "pct_above_50sma", now, p, FINAL)
    assert r["data_age_s"] == 605 and not r["current"]


def test_valid_current_observation():
    now = datetime(2026, 10, 12, 14, 0, 30, tzinfo=ET)
    p = _payload("2026-10-12T14:00:20-04:00", ROWS, data_as_of="2026-10-12T14:00:12-04:00")
    r = bc.choose("us", "pct_above_50sma", now, p, FINAL)
    assert r["current"] and r["status"] == "intraday" and r["data_age_s"] == 18
    assert r["observation_basis"] == "vendor_snapshot" and r["label"] == "Intraday · 2:00 PM ET"


def test_unknown_observation_time_is_never_current_and_says_so():
    now = datetime(2026, 10, 12, 11, 53, tzinfo=ET)
    p = _payload("2026-10-12T11:52:50-04:00", ROWS, data_as_of=None)
    r = bc.choose("us", "pct_above_50sma", now, p, FINAL)
    assert r["status"] == "intraday" and not r["current"] and r["observed_at"] is None
    assert r["observation_basis"] == "unknown" and r["label"] == "Intraday · observation time unknown"
    assert "observation time unavailable" in r["stale_reason"]


def test_a_delayed_feed_just_after_the_close_has_not_seen_the_close():
    now = datetime(2026, 10, 12, 16, 5, tzinfo=ET)
    p = _payload("2026-10-12T16:04:50-04:00", ROWS, data_as_of="2026-10-12T15:49:50-04:00")
    r = bc.choose("us", "pct_above_50sma", now, p, FINAL)
    assert r["status"] == "intraday" and not r["current"]


def test_snapshot_records_the_vendor_data_time_beside_unchanged_rows(monkeypatch):
    from api.services import massive
    c = massive._MassiveRestClient.__new__(massive._MassiveRestClient)
    c._api_key = "k"
    now = 1_791_830_000.0
    monkeypatch.setattr(massive.time, "time", lambda: now)
    tickers = [{"ticker": f"T{i}", "updated": int((now - 900 - i) * 1e9),
                "day": {"c": 10, "v": 5}, "prevDay": {"c": 9}, "lastTrade": {"p": 10}}
               for i in range(100)]
    tickers.append({"ticker": "FUT", "updated": int((now + 3600) * 1e9), "day": {"c": 1}})
    tickers.append({"ticker": "NOSTAMP", "day": {"c": 1}})
    monkeypatch.setattr(c, "_get", lambda url: {"tickers": tickers}, raising=False)
    out = c.get_full_market_snapshot()
    assert set(out["T0"]) == {"last_price", "prev_close", "today_vol", "prev_vol", "day_open",
                              "day_high", "day_low"}
    m = c.last_full_snapshot_meta
    assert m["stamped"] == 100 and m["tickers"] == 102          # future stamp + unstamped dropped
    assert now - 905 <= m["data_at"] <= now - 900 and m["data_at_newest"] == now - 900
