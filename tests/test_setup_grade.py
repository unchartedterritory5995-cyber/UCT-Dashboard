import datetime as dt
from unittest.mock import patch

from api.services import setup_grade as sg


# ── pure sub-scores ───────────────────────────────────────────────────────────

def test_weights_are_the_published_four_and_sum_to_one():
    assert set(sg.WEIGHTS) == {"beat_streak", "revision_30d", "rs_rank", "iv_premium"}
    assert abs(sum(sg.WEIGHTS.values()) - 1.0) < 1e-9


def test_beat_streak_scores_only_rows_with_a_verdict():
    hist = [{"beat": True}, {"beat": True}, {"beat": False}, {"beat": None}]
    score, detail = sg.score_beat_streak(hist)
    assert score == 200 / 3            # 2 of 3 CONSIDERED, the None row excluded
    assert detail == "2 of 3 beats"
    assert sg.score_beat_streak([]) == (None, None)
    assert sg.score_beat_streak([{"beat": None}]) == (None, None)
    assert sg.score_beat_streak(None) == (None, None)


def test_beat_streak_zero_beats_is_a_real_zero_not_a_missing_input():
    # Number(null)==0 analogue in reverse: a genuine 0.0 must survive as DATA,
    # so the code may never use truthiness to detect availability.
    score, detail = sg.score_beat_streak([{"beat": False}, {"beat": False}])
    assert score == 0.0 and detail == "0 of 2 beats"


def test_revision_30d_uses_the_first_row_carrying_counts():
    rows = [{"period": "0q", "up30": None, "down30": None},
            {"period": "+1q", "up30": 6, "down30": 2}]
    score, detail = sg.score_revision_30d(rows)
    assert score == 75.0 and detail == "6 up / 2 down (30d)"
    # zero revisions is NO SIGNAL, not a neutral 50
    assert sg.score_revision_30d([{"period": "0q", "up30": 0, "down30": 0}]) == (None, None)
    assert sg.score_revision_30d(None) == (None, None)


def test_rs_rank_passes_the_percentile_through():
    assert sg.score_rs_rank({"rs_rank": 88}) == (88.0, "RS 88 of 99")
    assert sg.score_rs_rank({"rs_rank": None}) == (None, None)
    assert sg.score_rs_rank(None) == (None, None)


def test_iv_premium_is_high_when_cheap_and_zero_when_rich():
    cheap, detail = sg.score_iv_premium(3.0, 6.0)      # ratio 0.5
    fair, _ = sg.score_iv_premium(6.0, 6.0)            # ratio 1.0
    rich, _ = sg.score_iv_premium(9.0, 6.0)            # ratio 1.5
    assert cheap == 100.0 and fair == 50.0 and rich == 0.0
    assert detail == "±3.0% priced vs ±6.0% typical"
    assert sg.score_iv_premium(20.0, 6.0)[0] == 0.0    # clamped, never negative
    assert sg.score_iv_premium(-6.0, 6.0)[0] == 50.0   # implied is a MAGNITUDE
    assert sg.score_iv_premium(None, 6.0) == (None, None)
    assert sg.score_iv_premium(6.0, 0) == (None, None)


def test_letter_ladder_is_monotonic_and_floors_at_f():
    assert sg.letter_for(95) == "A+" and sg.letter_for(93) == "A+"
    assert sg.letter_for(71) == "B+" and sg.letter_for(70.9) == "B"
    assert sg.letter_for(0) == "F" and sg.letter_for(14.9) == "F"
    ladder = [sg.letter_for(s) for s in range(0, 101)]
    assert ladder[0] == "F" and ladder[100] == "A+"


# ── composition + partial basis ───────────────────────────────────────────────

def test_compute_grade_full_basis_has_no_basis_string():
    out = sg.compute_grade({
        "beat_streak": (100.0, "4 of 4 beats"),
        "revision_30d": (75.0, "6 up / 2 down (30d)"),
        "rs_rank": (88.0, "RS 88 of 99"),
        "iv_premium": (50.0, "±6.0% priced vs ±6.0% typical"),
    })
    assert out["basis"] is None
    assert out["inputs_present"] == 4 and out["inputs_total"] == 4
    expected = 100 * .30 + 75 * .30 + 88 * .25 + 50 * .15
    assert out["score"] == round(expected, 1)
    assert out["letter"] == sg.letter_for(expected)
    assert [i["key"] for i in out["inputs"]] == list(sg.WEIGHTS)   # stable order
    assert all(i["weight"] == sg.WEIGHTS[i["key"]] for i in out["inputs"])
    assert all(i["available"] for i in out["inputs"])


def test_compute_grade_renormalises_over_present_weights_and_states_the_basis():
    out = sg.compute_grade({
        "beat_streak": (100.0, "4 of 4 beats"),
        "revision_30d": (50.0, "3 up / 3 down (30d)"),
        "rs_rank": (60.0, "RS 60 of 99"),
        "iv_premium": None,
    })
    assert out["basis"] == "3 of 4 inputs"
    assert out["inputs_present"] == 3
    expected = (100 * .30 + 50 * .30 + 60 * .25) / (.30 + .30 + .25)
    assert out["score"] == round(expected, 1)
    missing = next(i for i in out["inputs"] if i["key"] == "iv_premium")
    assert missing["available"] is False and missing["score"] is None
    assert missing["detail"] is None


def test_compute_grade_refuses_to_speak_below_two_inputs():
    assert sg.compute_grade({"rs_rank": (60.0, "RS 60 of 99")}) is None
    assert sg.compute_grade({k: None for k in sg.WEIGHTS}) is None
    assert sg.compute_grade({}) is None


# ── gather + orchestration ────────────────────────────────────────────────────

def _boom(*a, **k):
    raise RuntimeError("provider down")


def test_gather_inputs_survives_every_source_failing():
    with patch.object(sg, "_beat_history", _boom), \
         patch.object(sg, "_revisions", _boom), \
         patch.object(sg, "_rs", _boom), \
         patch.object(sg, "_avg_abs_realized", _boom):
        got = sg.gather_inputs("TST", live_move={"pct": 6.0})
    assert got == {k: None for k in sg.WEIGHTS}


def test_one_dead_source_costs_exactly_one_input():
    with patch.object(sg, "_beat_history", _boom), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        out = sg.get_setup_grade("TST", live_move={"pct": 6.0})
    assert out["basis"] == "3 of 4 inputs"
    assert next(i for i in out["inputs"] if i["key"] == "beat_streak")["available"] is False


def test_get_setup_grade_uses_the_live_move_it_is_handed():
    with patch.object(sg, "_beat_history", return_value=[{"beat": True}, {"beat": True}]), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        out = sg.get_setup_grade("TST", live_move={"pct": 3.0})
    assert out["basis"] is None
    iv = next(i for i in out["inputs"] if i["key"] == "iv_premium")
    assert iv["score"] == 100.0        # 3.0 / 6.0 = cheap


def test_get_setup_grade_without_a_live_move_is_a_3_of_4_partial():
    with patch.object(sg, "_beat_history", return_value=[{"beat": True}]), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        out = sg.get_setup_grade("TST", live_move=None)
    assert out["basis"] == "3 of 4 inputs"


def test_realized_average_never_caches_a_failure():
    from api.services.cache import cache
    cache.invalidate("setup_grade_realized_TST")
    with patch("api.services.earnings_enrichment.get_historical_earnings_moves",
               return_value=None), \
         patch("api.services.engine._fetch_quarterly_history", return_value=[]):
        assert sg._avg_abs_realized("TST") is None
    assert cache.get("setup_grade_realized_TST") is None
    # `cache.get()` returns None for BOTH an absent key and a key stored with
    # value None, so it alone can't tell "never cached" from "cached a
    # failure". `keys_with_prefix` reports raw key presence regardless of the
    # stored value and is the check that actually catches a regression to an
    # unconditional `cache.set(key, None, ...)`.
    assert cache.keys_with_prefix("setup_grade_realized_TST") == []


# ── §12 accountability record ─────────────────────────────────────────────────

def test_daily_snapshot_records_one_row_per_symbol_and_dedupes():
    reporters = [{"sym": "AAA", "report_date": "2026-08-05", "hour": "amc"},
                 {"sym": "AAA", "report_date": "2026-08-05", "hour": "amc"},
                 {"sym": "BBB", "report_date": "2026-08-12", "hour": "bmo"}]
    calls = []
    grade = {"letter": "B+", "score": 71.2, "basis": None, "inputs_present": 4,
             "inputs_total": 4, "inputs": [{"key": "rs_rank"}], "asof": "x"}
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade",
                      side_effect=lambda **kw: calls.append(kw)), \
         patch.object(sg, "get_setup_grade", return_value=grade):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 2, "skipped": 0, "failed": 0}
    assert [c["sym"] for c in calls] == ["AAA", "BBB"]
    assert calls[0]["date"] == "2026-08-04"          # injected clock, never date.today()
    assert calls[0]["surface"] == sg.SURFACE == "setup"
    assert calls[0]["grade"] == "B+" and calls[0]["inputs"] == grade["inputs"]


def test_daily_snapshot_skips_ungradeable_and_isolates_one_bad_symbol():
    reporters = [{"sym": "AAA", "report_date": "2026-08-05"},
                 {"sym": "BBB", "report_date": "2026-08-05"},
                 {"sym": "CCC", "report_date": "2026-08-05"}]

    def _grade(sym, live_move=None):
        if sym == "AAA":
            raise RuntimeError("boom")
        return None if sym == "BBB" else {"letter": "C", "inputs": []}

    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade"), \
         patch.object(sg, "get_setup_grade", side_effect=_grade):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 1, "skipped": 1, "failed": 1}


def test_daily_snapshot_is_bounded():
    reporters = [{"sym": f"S{i}", "report_date": "2026-08-05"} for i in range(500)]
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade"), \
         patch.object(sg, "get_setup_grade", return_value={"letter": "C", "inputs": []}), \
         patch.object(sg, "MAX_SNAPSHOT_SYMBOLS", 25):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary["recorded"] == 25


def test_daily_snapshot_no_ops_on_an_empty_reporter_list():
    # upcoming_reporters returns [] on ANY failure and on holidays.
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=[]), \
         patch.object(sg.implied_store, "record_grade") as rec:
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 0, "skipped": 0, "failed": 0}
    rec.assert_not_called()
