import datetime as dt
import threading
import time
from unittest.mock import patch

import pytest

from api.services import setup_grade as sg
from api.services.serve_stale import ServeStale


@pytest.fixture(autouse=True)
def _reset_grade_cache():
    """`get_setup_grade` is now fronted by a module-level TTL cache + ServeStale
    slot (the fan-out fix). Every test in this file that calls it uses symbol
    "TST", so without a reset the FIRST test to populate the cache would poison
    every test that runs after it within the same process — tests would pass
    or fail depending on execution order rather than their own mocks."""
    sg._GRADE_CACHE.clear()
    sg._GRADE_STALE = ServeStale(sg._GRADE_STALE.name, max_age_seconds=sg._GRADE_STALE.max_age)
    yield
    sg._GRADE_CACHE.clear()


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


def test_compute_grade_letter_reflects_the_displayed_rounded_score():
    # 70.96 unrounded is a B (just under the 71 B+ floor) but rounds for
    # DISPLAY to 71.0 — the letter must key off what the user actually sees,
    # or the card would show "71.0 · B", which reads as a bug. Two equal-value
    # present inputs make the weighted average equal the input value exactly,
    # regardless of their relative weights.
    out = sg.compute_grade({
        "beat_streak": (70.96, "x"),
        "rs_rank": (70.96, "y"),
    })
    assert out["score"] == 71.0
    assert sg.letter_for(70.96) == "B"           # sanity: the seam is real
    assert out["letter"] == "B+"                 # graded off the rounded score


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


def test_avg_abs_realized_bounds_the_yfinance_leg_via_run_in_pool():
    # Gap (a) fix, half 1: get_historical_earnings_moves reaches a raw
    # `_yf.Ticker(sym).history()` call with no timeout of its own — the one
    # genuinely unbounded leg in this module. _avg_abs_realized must route it
    # through yfinance_pool.run_in_pool (never call it directly), the same
    # nested-timeout precedent `research.estimates._fetch` already relies on.
    from api.services.cache import cache
    cache.invalidate("setup_grade_realized_TST")
    with patch("api.services.yfinance_pool.run_in_pool",
               return_value={"avg_abs_move_pct": 6.0}) as rip:
        assert sg._avg_abs_realized("TST") == 6.0
    assert rip.call_count == 1
    assert rip.call_args.kwargs.get("timeout") == sg._REALIZED_YF_TIMEOUT


def test_gather_inputs_bounds_a_hung_source_within_the_budget():
    # A source that hangs past its timeout must cost exactly that ONE input
    # (the fan-out fix's core guarantee) — the caller must never wait for it.
    # The Event is deliberately never `.set()`; `wait(timeout=1.0)` bounds the
    # background thread's own lifetime so the test process never truly blocks,
    # and the margin against SOURCE_TIMEOUT/the elapsed assertion is wide
    # (1.0s hang vs a 0.02s timeout vs a 0.5s assertion ceiling) so the check
    # can't flake on a loaded CI box.
    gate = threading.Event()

    def _hangs(*a, **k):
        gate.wait(timeout=1.0)
        return [{"beat": True}]   # never reached in time — proves the caller didn't wait

    with patch.object(sg, "_SOURCE_TIMEOUT", 0.02), \
         patch.object(sg, "_GRADE_BUDGET", 0.05), \
         patch.object(sg, "_beat_history", _hangs), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        t0 = time.monotonic()
        got = sg.gather_inputs("TST", live_move={"pct": 6.0})
        elapsed = time.monotonic() - t0

    assert elapsed < 0.5                    # returned well before the 1.0s hang would resolve
    assert got["beat_streak"] is None        # timed out -> missing input, never a crash
    assert got["revision_30d"] is not None   # the other concurrent sources still complete
    assert got["rs_rank"] is not None


def test_get_setup_grade_cache_hit_never_calls_gather_inputs():
    scored = {
        "beat_streak": (100.0, "4 of 4 beats"),
        "revision_30d": (75.0, "6 up / 2 down (30d)"),
        "rs_rank": (88.0, "RS 88 of 99"),
        "iv_premium": (50.0, "x"),
    }
    with patch.object(sg, "gather_inputs", return_value=scored) as gi:
        first = sg.get_setup_grade("TST", live_move={"pct": 6.0})
        second = sg.get_setup_grade("TST", live_move={"pct": 6.0})
    assert first is not None and second == first
    assert gi.call_count == 1   # the second call was served from the fresh TTL cache


def test_get_setup_grade_recomputes_when_a_live_move_newly_arrives():
    # Gap (b): a grade cached under a MISSING live_move (3-of-4 partial) must
    # NOT be served once a live_move becomes available — the cache key carries
    # the basis dimension so the partial->full transition recomputes on the
    # very first request that has a live_move, not after the 15-min TTL.
    scored_partial = {
        "beat_streak": (100.0, "4 of 4 beats"),
        "revision_30d": (75.0, "6 up / 2 down (30d)"),
        "rs_rank": (88.0, "RS 88 of 99"),
        "iv_premium": None,
    }
    scored_full = dict(scored_partial, iv_premium=(50.0, "x"))
    with patch.object(sg, "gather_inputs", side_effect=[scored_partial, scored_full]) as gi:
        first = sg.get_setup_grade("TST", live_move=None)
        second = sg.get_setup_grade("TST", live_move={"pct": 6.0})
    assert first["basis"] == "3 of 4 inputs"
    assert second["basis"] is None
    assert gi.call_count == 2   # a real live_move must recompute, never serve the noiv slot


def test_gather_inputs_pool_has_slack_when_three_workers_are_stuck():
    # Gap (a): _avg_abs_realized's yfinance leg used to be the one genuinely
    # UNBOUNDED call in this module — even with it now bounded via
    # yfinance_pool.run_in_pool, this test independently proves the SECOND
    # half of the fix: raising _GATHER_POOL from 3 to 6 workers. Simulates
    # three permanently-stuck iv_premium legs (as if their inner bound had
    # somehow still not freed the worker) and asserts a fourth symbol's other
    # two concurrent legs are NOT starved behind them — the pool has slack.
    gate = threading.Event()  # never set until teardown; these 3 hang forever

    def _hangs_forever(*a, **k):
        gate.wait()
        return 6.0  # never reached inside the test

    try:
        with patch.object(sg, "_avg_abs_realized", _hangs_forever), \
             patch.object(sg, "_beat_history", return_value=[{"beat": True}]), \
             patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
             patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
             patch.object(sg, "_SOURCE_TIMEOUT", 0.05), \
             patch.object(sg, "_GRADE_BUDGET", 0.1):
            # Occupy 3 _GATHER_POOL workers permanently: each symbol's
            # iv_premium job blocks on `gate` forever (its own outer timeout
            # only frees the CALLING thread, not the worker thread actually
            # running the hung callable) while beat_streak/revision_30d free
            # their workers back up almost immediately.
            for sym in ("AAA", "BBB", "CCC"):
                sg.gather_inputs(sym, live_move={"pct": 6.0})

            # A 4th symbol must still be served promptly: with max_workers=6
            # and only 3 stuck, 3 idle workers remain for DDD's 3 jobs.
            t0 = time.monotonic()
            got = sg.gather_inputs("DDD", live_move={"pct": 6.0})
            elapsed = time.monotonic() - t0

        assert elapsed < 0.5
        assert got["beat_streak"] is not None    # NOT queued behind the stuck workers
        assert got["revision_30d"] is not None
        assert got["rs_rank"] is not None
        assert got["iv_premium"] is None          # its own leg still hangs -> times out
    finally:
        gate.set()  # release the 3 (now 4) leaked background threads


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
         patch.object(sg.implied_move, "get_expected_move", return_value=None), \
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
         patch.object(sg.implied_move, "get_expected_move", return_value=None), \
         patch.object(sg, "get_setup_grade", side_effect=_grade):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 1, "skipped": 1, "failed": 1}


def test_daily_snapshot_is_bounded():
    reporters = [{"sym": f"S{i}", "report_date": "2026-08-05"} for i in range(500)]
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade"), \
         patch.object(sg.implied_move, "get_expected_move", return_value=None), \
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


def test_daily_snapshot_uses_a_freshly_fetched_live_move_for_iv_premium():
    # 16:40 ET runs 5 min after the implied-move capture — the accountability
    # record must be scored against THAT evening's freshly captured chain, not
    # score iv_premium as permanently missing (the bug this test guards: the
    # old code called `get_setup_grade(sym)` with no live_move at all).
    reporters = [{"sym": "AAA", "report_date": "2026-08-05", "hour": "amc"}]
    live = {"pct": 4.0, "dollar": 7.0, "expiry": "2026-08-07", "asof": "x"}
    calls = []
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade",
                      side_effect=lambda **kw: calls.append(kw)), \
         patch.object(sg.implied_move, "get_expected_move", return_value=live) as gem, \
         patch.object(sg, "_beat_history", return_value=[{"beat": True}, {"beat": True}]), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 1, "skipped": 0, "failed": 0}
    gem.assert_called_once_with("AAA", "2026-08-05")
    iv = next(i for i in calls[0]["inputs"] if i["key"] == "iv_premium")
    assert iv["available"] is True


def test_daily_snapshot_isolates_a_raising_live_move_fetch():
    # A bad/slow chain read must cost only iv_premium for that one symbol,
    # never sink the symbol's whole grading attempt.
    reporters = [{"sym": "AAA", "report_date": "2026-08-05"}]
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade"), \
         patch.object(sg.implied_move, "get_expected_move", side_effect=RuntimeError("boom")), \
         patch.object(sg, "get_setup_grade", return_value={"letter": "C", "inputs": []}) as gsg:
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 1, "skipped": 0, "failed": 0}
    assert gsg.call_args.kwargs["live_move"] is None


def test_daily_snapshot_default_now_uses_et_not_naive_local_clock():
    # `today = now.date().isoformat()` feeds directly into the persisted §12
    # row's `date` column — a naive `datetime.now()` would silently key off
    # the SERVER's local clock instead of the ET convention every other
    # implied-store job assumes (`implied_store._ET`).
    captured = {}

    def _capture(*, days, now):
        captured["now"] = now
        return []

    with patch.object(sg.implied_store, "upcoming_reporters", side_effect=_capture), \
         patch.object(sg.implied_store, "record_grade") as rec:
        sg.run_daily_grade_snapshot(now=None)
    assert captured["now"].tzinfo == sg.implied_store._ET
    rec.assert_not_called()
