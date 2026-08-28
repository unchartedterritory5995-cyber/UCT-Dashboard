"""The durable store and the warmer.

The requirement these serve: every ticker opens in under 2-3 seconds even for
the FIRST user. A ~39s synthesis cannot meet that on the request path, so the
request path only reads and the warmer does the writing.
"""
import importlib
import json

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("CALL_RECAP_DB_PATH", str(tmp_path / "recaps.db"))
    import api.services.call_recap_store as m
    importlib.reload(m)          # DB_PATH and prices are read at import
    m.init_db()
    return m


@pytest.fixture
def warmer(monkeypatch):
    monkeypatch.setenv("CALL_RECAP_WARM_ENABLED", "1")
    # SERIAL lane by default in these tests. run_sweep has had a second mode
    # since 2026-08-28 (Batch API, half price, results collected on the NEXT
    # sweep); its own rails are in TestBatchLane below. Pinning the mode here
    # keeps every ordering/cap/clock assertion about the lane it was written
    # for instead of silently grading whichever one the env happens to select.
    monkeypatch.setenv("CALL_RECAP_WARM_BATCH", "0")
    import api.services.call_recap_warmer as w
    importlib.reload(w)
    return w


@pytest.fixture
def batch_warmer(monkeypatch, tmp_path):
    monkeypatch.setenv("CALL_RECAP_WARM_ENABLED", "1")
    monkeypatch.setenv("CALL_RECAP_WARM_BATCH", "1")
    monkeypatch.setenv("LLM_BATCH_ENABLED", "1")
    monkeypatch.setenv("LLM_BATCH_LEDGER_PATH", str(tmp_path / "batches.json"))
    import api.services.llm_batch as lb
    import api.services.call_recap_warmer as w
    importlib.reload(lb)
    importlib.reload(w)
    return w


RECAP = {"headline": "Record quarter", "quotes": [],
         "_usage": {"input_tokens": 18000, "output_tokens": 3500,
                    "model": "claude-sonnet-5"}}


class TestStoreSurvivesRestart:
    def test_a_stored_recap_is_readable_by_a_FRESH_process(self, store, tmp_path, monkeypatch):
        store.put("DIS", "2026Q3", RECAP)
        # The bug this replaces: the recap lived in an in-process TTLCache, so
        # every redeploy threw ~39s of work away. Reload the module to stand in
        # for a new process and prove the artifact outlives it.
        monkeypatch.setenv("CALL_RECAP_DB_PATH", str(tmp_path / "recaps.db"))
        import api.services.call_recap_store as m
        importlib.reload(m)
        assert m.get("DIS")["headline"] == "Record quarter"

    def test_reads_the_newest_quarter_when_none_is_named(self, store):
        import time
        store.put("DIS", "2026Q2", {"headline": "older"})
        time.sleep(1.05)         # created_at is second-resolution
        store.put("DIS", "2026Q3", {"headline": "newer"})
        assert store.get("DIS")["headline"] == "newer"
        assert store.get("DIS", "2026Q2")["headline"] == "older"

    def test_a_new_quarter_does_not_overwrite_the_old_call(self, store):
        store.put("DIS", "2026Q2", {"headline": "Q2"})
        store.put("DIS", "2026Q3", {"headline": "Q3"})
        assert store.get("DIS", "2026Q2")["headline"] == "Q2"

    def test_regenerating_the_SAME_quarter_replaces_it(self, store):
        store.put("DIS", "2026Q3", {"headline": "first"})
        store.put("DIS", "2026Q3", {"headline": "second"})
        assert store.get("DIS", "2026Q3")["headline"] == "second"

    def test_misses_and_junk_read_as_None_not_an_error(self, store):
        assert store.get("NOPE") is None
        assert store.get("") is None
        assert store.has("DIS", "2026Q3") is False


class TestSpendLedger:
    def test_prices_a_generation_from_its_token_usage(self, store):
        cost = store.record_spend("DIS", RECAP["_usage"])
        # 18000 in @ $3/M + 3500 out @ $15/M
        assert cost == pytest.approx(18000 * 3e-6 + 3500 * 15e-6)
        assert store.spend_today() == pytest.approx(cost)

    def test_the_cap_is_its_OWN_not_the_catalyst_engine_s(self, store, monkeypatch):
        # Previously get_call_recap checked catalyst's cap but never recorded
        # against it, so recap spend was blockable by catalyst AND invisible.
        monkeypatch.setattr(store, "DAILY_CAP_USD", 0.20)
        assert store.may_spend() is True
        for _ in range(3):
            store.record_spend("X", RECAP["_usage"])   # ~$0.107 each
        assert store.may_spend() is False

    def test_spend_is_visible_for_monitoring(self, store):
        store.put("DIS", "2026Q3", RECAP)
        store.record_spend("DIS", RECAP["_usage"])
        s = store.stats()
        assert s["stored"] == 1 and s["generated_today"] == 1
        assert s["spend_today_usd"] > 0


class TestPriorityOrdering:
    def test_names_users_actually_watch_are_warmed_FIRST(self, warmer):
        # The ordering IS the feature: when the budget runs out partway down,
        # what got warmed is decided here.
        q = warmer.build_queue(
            ["AAA", "DIS", "BBB", "NVDA"],
            user_syms={"DIS"}, leaders={"NVDA"})
        assert q == ["DIS", "NVDA", "AAA", "BBB"]

    def test_dedupes_and_normalises(self, warmer):
        q = warmer.build_queue(["dis", "DIS", " dis ", "", None, "AAPL"],
                               user_syms=set(), leaders=set())
        assert q == ["DIS", "AAPL"]

    def test_relative_order_is_preserved_within_a_tier(self, warmer):
        q = warmer.build_queue(["C", "A", "B"], user_syms=set(), leaders=set())
        assert q == ["C", "A", "B"]


class TestWarmSymbol:
    def _fixture(self, store, outcome_recap=RECAP, segments=(("CEO", "hi"),)):
        transcript = {"quarter": "2026Q3",
                      "segments": [{"speaker": s, "content": c} for s, c in segments]}
        return (lambda sym: transcript, lambda sym, t: outcome_recap)

    def test_generates_stores_and_records_spend(self, store, warmer):
        fetch, synth = self._fixture(store)
        assert warmer.warm_symbol("DIS", fetch_transcript=fetch,
                                  synthesize=synth, store=store) == "warmed"
        assert store.get("DIS")["headline"] == "Record quarter"
        assert store.spend_today() > 0

    def test_SKIPS_before_spending_when_already_stored(self, store, warmer):
        fetch, synth = self._fixture(store)
        warmer.warm_symbol("DIS", fetch_transcript=fetch, synthesize=synth, store=store)
        before = store.spend_today()
        calls = []
        assert warmer.warm_symbol(
            "DIS", fetch_transcript=fetch,
            synthesize=lambda *a: calls.append(1), store=store) == "already"
        # An interrupted sweep must cost only time on resume, never money again.
        assert not calls and store.spend_today() == before

    def test_refuses_to_spend_past_the_cap(self, store, warmer, monkeypatch):
        monkeypatch.setattr(store, "DAILY_CAP_USD", 0.0)
        fetch, synth = self._fixture(store)
        assert warmer.warm_symbol("DIS", fetch_transcript=fetch,
                                  synthesize=synth, store=store) == "capped"
        assert store.get("DIS") is None

    def test_a_symbol_with_no_transcript_is_reported_not_crashed(self, store, warmer):
        assert warmer.warm_symbol("ZZZ", fetch_transcript=lambda s: None,
                                  synthesize=lambda *a: RECAP, store=store) == "no_transcript"

    def test_a_failed_synthesis_stores_nothing(self, store, warmer):
        fetch, _ = self._fixture(store)
        assert warmer.warm_symbol("DIS", fetch_transcript=fetch,
                                  synthesize=lambda *a: None, store=store) == "failed"
        assert store.get("DIS") is None

    def test_a_raising_provider_does_not_escape(self, store, warmer):
        def boom(sym): raise RuntimeError("FMP down")
        assert warmer.warm_symbol("DIS", fetch_transcript=boom,
                                  synthesize=lambda *a: RECAP, store=store) == "no_transcript"


class TestSweep:
    def test_is_inert_until_the_flag_is_set(self, store, warmer, monkeypatch):
        monkeypatch.delenv("CALL_RECAP_WARM_ENABLED", raising=False)
        importlib.reload(warmer)
        called = []
        out = warmer.run_sweep(["DIS"], warm=lambda s: called.append(s), store=store)
        assert out == {"skipped": "disabled"} and not called

    def test_reports_the_work_done_not_merely_that_it_ran(self, store, warmer):
        out = warmer.run_sweep(["DIS", "AAPL"],
                               warm=lambda s: "warmed", sleep=lambda _: None, store=store)
        # A count-based monitor cannot tell a capped sweep from a healthy one
        # unless the outcomes themselves are reported.
        assert out["queued"] == 2 and out["warmed"] == 2
        assert out["last_symbol"] == "AAPL"
        assert "spend_today_usd" in out

    def test_stops_at_the_cap_instead_of_logging_a_run_of_identical_failures(
            self, store, warmer):
        seen = []
        def warm(s):
            seen.append(s)
            return "capped"
        out = warmer.run_sweep(["A", "B", "C"], warm=warm, sleep=lambda _: None, store=store)
        assert seen == ["A"] and out["capped"] == 1

    def test_honours_the_wall_clock_ceiling(self, store, warmer, monkeypatch):
        monkeypatch.setattr(warmer, "MAX_SECONDS", 5)
        t = {"v": 0.0}
        def clock():
            t["v"] += 4          # two symbols, then past the ceiling
            return t["v"]
        out = warmer.run_sweep(["A", "B", "C", "D"], now=clock,
                               warm=lambda s: "warmed", sleep=lambda _: None, store=store)
        assert out.get("timed_out") == 1
        assert out["warmed"] < 4


class TestRequestPathNeverGenerates:
    """The latency contract: a request must never trigger a ~39s synthesis.

    This is the invariant behind "under 2-3 seconds even for the first user".
    It also pins the branch that broke the older fallback tests: a ticker WITH a
    transcript returns None and defers to the warmer, rather than generating.
    """

    def _call(self, *, stored, has_transcript):
        from unittest.mock import MagicMock, patch
        import api.services.call_recap as cr
        transcript = ({"quarter": "2026Q3", "segments": [{"speaker": "CEO", "content": "hi"}]}
                      if has_transcript else None)
        with patch.object(cr, "_cache", return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch.object(cr, "_store", return_value=MagicMock(get=MagicMock(return_value=stored))), \
             patch.object(cr, "_transcript_for", return_value=transcript), \
             patch.object(cr, "_trigger_background_warm") as warm, \
             patch.object(cr, "_cost_guard",
                          return_value=MagicMock(may_synthesize=MagicMock(return_value=True))), \
             patch.object(cr, "_grounded") as grounded, \
             patch.object(cr, "_pplx_earnings_highlights", return_value=""), \
             patch.object(cr, "_anthropic_client") as client:
            result = cr.get_call_recap("DIS")
        return result, warm, grounded, client

    def test_a_warmed_recap_is_served_straight_from_the_store(self):
        result, warm, grounded, client = self._call(
            stored={"headline": "Record quarter"}, has_transcript=True)
        assert result["headline"] == "Record quarter"
        grounded.assert_not_called()                 # no synthesis
        client.assert_not_called()                   # no LLM at all
        warm.assert_not_called()                     # nothing to warm

    def test_a_cold_symbol_WITH_a_transcript_defers_instead_of_generating(self):
        result, warm, grounded, client = self._call(stored=None, has_transcript=True)
        # None is correct here: the transcript panel still renders immediately,
        # and the recap arrives once the background warm lands.
        assert result is None
        grounded.assert_not_called()
        client.assert_not_called()
        warm.assert_called_once_with("DIS")

    def test_a_symbol_with_NO_transcript_still_reaches_the_web_fallback(self):
        # Otherwise pre-report names would lose their recap entirely.
        result, warm, grounded, client = self._call(stored=None, has_transcript=False)
        warm.assert_not_called()
        assert result is None                        # empty pplx context here


class TestSentimentFold:
    """SentimentGauge used to be a SECOND Perplexity + LLM round-trip per
    ticker, for a judgement about the call the recap generation already reads.
    Measured cost of that duplication: ~5s of Perplexity plus an LLM call, per
    ticker, on the request path."""

    def test_the_gauge_payload_rides_the_recap_schema(self):
        import api.services.call_recap_grounded as g
        props = g.RECAP_SCHEMA["properties"]["sentiment_detail"]["properties"]
        assert set(props) == {"score", "label", "rationale", "drivers"}
        assert "sentiment_detail" in g.RECAP_SCHEMA["required"]

    def _synth(self, monkeypatch, detail):
        import json
        import api.services.call_recap_grounded as g
        payload = {"headline": "h", "sentiment": "positive", "bullets": [],
                   "guidance": "raised", "guidance_detail": "", "quotes": [],
                   "forward_looking": [], "qa_highlights": [], "speakers": [],
                   "sentiment_detail": detail}

        class _Resp:
            stop_reason = "end_turn"
            content = [type("B", (), {"type": "text", "text": json.dumps(payload)})()]
            usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()

        monkeypatch.setattr(g, "_client", lambda: type("C", (), {
            "messages": type("M", (), {"create": staticmethod(lambda **k: _Resp())})()
        })())
        segs = [{"speaker": "CEO", "content": "Revenue was a record."},
                {"speaker": "CFO", "content": "Margins expanded."}]
        return g.synthesize("DIS", {"segments": segs, "quarter": "2026Q3"})

    def test_a_sane_score_survives(self, monkeypatch):
        out = self._synth(monkeypatch, {"score": 72, "label": "Positive",
                                        "rationale": "Beat and raise.", "drivers": ["EPS beat"]})
        assert out["sentiment_detail"]["score"] == 72

    def test_an_out_of_range_score_is_clamped_not_rendered_raw(self, monkeypatch):
        out = self._synth(monkeypatch, {"score": 900, "label": "Very Positive",
                                        "rationale": "r", "drivers": []})
        assert out["sentiment_detail"]["score"] == 100

    def test_a_score_CONTRADICTING_its_label_is_dropped_entirely(self, monkeypatch):
        # A gauge pointing hard positive beside the words "Very Negative" is
        # worse than no gauge — it makes the panel look broken and untrustworthy.
        out = self._synth(monkeypatch, {"score": 80, "label": "Very Negative",
                                        "rationale": "r", "drivers": []})
        assert out["sentiment_detail"] is None

    def test_a_missing_or_junk_block_becomes_None(self, monkeypatch):
        assert self._synth(monkeypatch, None)["sentiment_detail"] is None
        assert self._synth(monkeypatch, "not a dict")["sentiment_detail"] is None

    def test_get_sentiment_reads_the_warmed_recap_without_any_provider_call(self):
        from unittest.mock import MagicMock, patch
        import api.services.call_recap as cr
        detail = {"score": 72, "label": "Positive", "rationale": "r", "drivers": ["d"]}
        with patch.object(cr, "_cache", return_value=MagicMock(get=MagicMock(return_value=None))), \
             patch.object(cr, "_store",
                          return_value=MagicMock(get=MagicMock(
                              return_value={"sentiment_detail": detail}))), \
             patch.object(cr, "_pplx_earnings_highlights") as pplx, \
             patch.object(cr, "_anthropic_client") as client:
            out = cr.get_sentiment("DIS")
        assert out == detail
        pplx.assert_not_called()      # the ~5s round-trip that used to run
        client.assert_not_called()    # and the LLM call after it


class TestRecentReporters:
    """The sweep queue must cover the recent tape, not just today.

    Today's calendar alone leaves a Wednesday reporter cold for good: it is
    swept on Wednesday and never again, so a reader opening it on Friday pays
    the full ~39s. These tests pin the walk-back and the query SHAPE.
    """

    @pytest.fixture(autouse=True)
    def _uni(self, warmer, monkeypatch):
        """Pin the universe so these tests assert ORDERING, not membership.

        The real cap_universe.json is loaded otherwise and silently drops the
        fixture tickers.
        """
        monkeypatch.setattr(warmer, "_UNIVERSE",
                            {"AAA", "NEW", "OLD", "PEND", "DIS"})

    @staticmethod
    def _recorder(by_day):
        calls = []

        def fmp_get(path, params, timeout=None):
            calls.append(dict(params))
            return by_day.get(params["from"], [])

        return fmp_get, calls

    def test_foreign_listings_are_dropped(self, warmer, monkeypatch):
        # A week of the raw calendar is ~5,000 names, mostly foreign listings
        # with no FMP transcript. Unfiltered they push DIS to position ~3,250
        # and the sweep's budget never reaches it.
        from datetime import date
        monkeypatch.setattr(warmer, "_UNIVERSE", set())   # force the shape filter
        fmp_get, _ = self._recorder({"2026-08-09": [
            {"symbol": "600641.SS", "epsActual": 1.0},
            {"symbol": "PNCINFRA.NS", "epsActual": 1.0},
            {"symbol": "4324.SR", "epsActual": 1.0},
            {"symbol": "DIS", "epsActual": 1.0},
        ]})

        out = warmer.recent_reporters(days=0, today=date(2026, 8, 9),
                                      fmp_get=fmp_get)

        assert out == ["DIS"]

    def test_universe_membership_filters_when_the_file_loaded(self, warmer,
                                                              monkeypatch):
        from datetime import date
        monkeypatch.setattr(warmer, "_UNIVERSE", {"DIS"})
        fmp_get, _ = self._recorder({"2026-08-09": [
            {"symbol": "DIS", "epsActual": 1.0},
            {"symbol": "ZZZZ", "epsActual": 1.0},   # US-shaped but not charted
        ]})

        out = warmer.recent_reporters(days=0, today=date(2026, 8, 9),
                                      fmp_get=fmp_get)

        assert out == ["DIS"]

    def test_queries_one_day_at_a_time_not_a_range(self, warmer):
        # A from/to RANGE response is capped at 4000 rows and drops issuers
        # WITHOUT erroring — DIS is absent from an 8-day range and present in
        # its own day. A range query would look like it worked, so the
        # single-day shape is the thing worth pinning.
        from datetime import date
        fmp_get, calls = self._recorder({})

        warmer.recent_reporters(days=3, today=date(2026, 8, 9), fmp_get=fmp_get)

        assert [c["from"] for c in calls] == [
            "2026-08-09", "2026-08-08", "2026-08-07", "2026-08-06"]
        assert all(c["from"] == c["to"] for c in calls), \
            "a range query silently truncates; every request must be ONE day"

    def test_skips_names_that_have_not_reported_yet(self, warmer):
        from datetime import date
        fmp_get, _ = self._recorder({"2026-08-09": [
            {"symbol": "AAA", "epsActual": 1.0},
            {"symbol": "PEND", "epsActual": None},   # scheduled, not yet out
        ]})

        out = warmer.recent_reporters(days=0, today=date(2026, 8, 9),
                                      fmp_get=fmp_get)

        assert out == ["AAA"], "a name with no epsActual has no transcript yet"

    def test_newest_day_first_and_deduped(self, warmer):
        # Order IS the feature: the budget runs out partway down the queue, so
        # the most recent call must be ahead of the older one.
        from datetime import date
        fmp_get, _ = self._recorder({
            "2026-08-09": [{"symbol": "NEW", "epsActual": 1.0}],
            "2026-08-08": [{"symbol": "OLD", "epsActual": 2.0},
                           {"symbol": "NEW", "epsActual": 1.0}],
        })

        out = warmer.recent_reporters(days=1, today=date(2026, 8, 9),
                                      fmp_get=fmp_get)

        assert out == ["NEW", "OLD"]

    def test_one_bad_day_does_not_lose_the_others(self, warmer):
        from datetime import date

        def fmp_get(path, params, timeout=None):
            if params["from"] == "2026-08-08":
                raise RuntimeError("provider blew up")
            if params["from"] == "2026-08-07":
                return None                      # provider returned nothing
            return [{"symbol": "AAA", "epsActual": 1.0}]

        out = warmer.recent_reporters(days=2, today=date(2026, 8, 9),
                                      fmp_get=fmp_get)

        assert out == ["AAA"]

    def test_ranked_by_size_so_the_budget_reaches_the_big_names(self, warmer,
                                                                monkeypatch):
        # Ordered purely by day, DIS sat at queue position 743 of 1,241 —
        # past the daily spend cap, so the single name most likely to be
        # opened would never have been warmed.
        from datetime import date
        monkeypatch.setattr(warmer, "_UNIVERSE", {"DIS", "TINY", "MID"})
        fmp_get, _ = self._recorder({
            # TINY reported TODAY, DIS four days ago — size must still win.
            "2026-08-09": [{"symbol": "TINY", "epsActual": 0.1,
                            "revenueActual": 5_000_000}],
            "2026-08-07": [{"symbol": "MID", "epsActual": 0.5,
                            "revenueActual": 900_000_000}],
            "2026-08-05": [{"symbol": "DIS", "epsActual": 2.06,
                            "revenueActual": 25_248_000_000}],
        })

        out = warmer.recent_reporters(days=4, today=date(2026, 8, 9),
                                      fmp_get=fmp_get)

        assert out == ["DIS", "MID", "TINY"]

    def test_unknown_revenue_sorts_last_not_first(self, warmer, monkeypatch):
        # A missing revenue must not read as zero-and-therefore-huge, nor
        # outrank a name whose size is known.
        from datetime import date
        monkeypatch.setattr(warmer, "_UNIVERSE", {"KNOWN", "UNK"})
        fmp_get, _ = self._recorder({"2026-08-09": [
            {"symbol": "UNK", "epsActual": 1.0},                       # no revenue
            {"symbol": "KNOWN", "epsActual": 1.0, "revenueActual": 1_000},
        ]})

        out = warmer.recent_reporters(days=0, today=date(2026, 8, 9),
                                      fmp_get=fmp_get)

        assert out == ["KNOWN", "UNK"]


class TestSweepSingleFlight:
    """Two sweeps must not walk the same queue at once.

    A sweep runs for up to MAX_SECONDS (an hour) and the boot sweep and the
    next cron are separate APScheduler jobs, so they overlap rather than queue.
    Both would see store.has() == False for the same symbol and both would pay
    to generate it, out of one capped daily budget.
    """

    def test_a_second_concurrent_sweep_is_refused(self, store, warmer):
        import threading
        started, release = threading.Event(), threading.Event()

        def slow_warm(sym):
            started.set()
            release.wait(5)
            return "warmed"

        first = threading.Thread(
            target=lambda: warmer.run_sweep(["AAA"], warm=slow_warm,
                                            sleep=lambda _: None, store=store))
        first.start()
        assert started.wait(5), "first sweep never got going"

        out = warmer.run_sweep(["BBB"], warm=lambda s: "warmed",
                               sleep=lambda _: None, store=store)

        release.set()
        first.join(5)
        assert out == {"skipped": "already_running"}

    def test_the_lock_is_released_so_the_next_sweep_runs(self, store, warmer):
        warmer.run_sweep(["AAA"], warm=lambda s: "warmed",
                         sleep=lambda _: None, store=store)
        out = warmer.run_sweep(["BBB"], warm=lambda s: "warmed",
                               sleep=lambda _: None, store=store)
        assert out.get("queued") == 1

    def test_an_exception_does_not_leak_the_lock(self, store, warmer):
        # A leaked lock would wedge every future sweep permanently — the store
        # would simply stop filling, silently, and look exactly like "no
        # reporters today".
        def boom(sym):
            raise RuntimeError("provider died mid-sweep")

        with pytest.raises(RuntimeError):
            warmer.run_sweep(["AAA"], warm=boom, sleep=lambda _: None,
                             store=store)

        out = warmer.run_sweep(["BBB"], warm=lambda s: "warmed",
                               sleep=lambda _: None, store=store)
        assert out.get("queued") == 1


def test_the_recap_is_STORED_before_it_is_BILLED(store, warmer, monkeypatch):
    """Ordering, because a restart can land between the two calls.

    Billed-then-stored loses the artifact and keeps the charge: one afternoon
    of deploys produced 12 generations against 8 stored recaps — four paid for
    and gone. Stored-then-billed can only under-count the day's spend by one,
    which the cap absorbs.
    """
    order = []
    monkeypatch.setattr(store, "put",
                        lambda *a, **k: order.append("put"))
    monkeypatch.setattr(store, "record_spend",
                        lambda *a, **k: order.append("record_spend"))

    transcript = {"quarter": "2026Q3",
                  "segments": [{"speaker": "CEO", "content": "hi"}]}
    warmer.warm_symbol("DIS", fetch_transcript=lambda s: transcript,
                       synthesize=lambda s, t: RECAP, store=store)

    assert order == ["put", "record_spend"]


class TestBatchLane:
    """The 50%-off lane (2026-08-28 cost census). Its invariants differ from
    the serial lane's: results come back UNORDERED and MUCH later, so identity
    must ride the custom_id, the transcript must ride the ledger, and the
    daily cap must be pre-paid at SUBMIT time."""

    def _transcript(self, sym):
        return {"quarter": "Q3 2026",
                "segments": [{"speaker": "CEO", "text": f"{sym} had a record quarter."},
                             {"speaker": "CFO", "text": "Margins expanded."}]}

    def test_submit_ledgers_the_transcript_and_keys_by_custom_id(
            self, store, batch_warmer, monkeypatch):
        import api.services.llm_batch as lb
        sent = {}

        def fake_submit(surface, requests, meta):
            sent["surface"], sent["requests"], sent["meta"] = surface, requests, meta
            return "batch_abc"

        monkeypatch.setattr(lb, "submit", fake_submit)
        out = batch_warmer.submit_batch(
            ["DIS", "AAPL"], fetch_transcript=self._transcript, store=store)
        assert out["batch_id"] == "batch_abc" and out["queued"] == 2
        assert [r["custom_id"] for r in sent["requests"]] == ["DIS|Q3 2026", "AAPL|Q3 2026"]
        # the transcript the model was GIVEN rides the ledger — grounding at
        # reap time against a re-fetch could drop quotes that were really said
        assert sent["meta"]["DIS|Q3 2026"]["transcript"]["segments"]
        assert sent["meta"]["DIS|Q3 2026"]["quarter"] == "Q3 2026"
        # and the params are the SAME grammar the live lane sends
        from api.services.call_recap_grounded import build_params
        assert sent["requests"][0]["params"] == build_params("DIS", self._transcript("DIS"))

    def test_submit_never_queues_more_than_the_remaining_budget(
            self, store, batch_warmer, monkeypatch):
        """A batch is committed all at once: without a submit-time bound it can
        overshoot the daily cap by a whole batch."""
        import api.services.llm_batch as lb
        monkeypatch.setattr(store, "DAILY_CAP_USD", 0.10)   # ~1 recap at batch rate
        captured = {}
        monkeypatch.setattr(lb, "submit",
                            lambda s, r, m: captured.setdefault("n", len(r)) and "b1" or "b1")
        out = batch_warmer.submit_batch(
            ["DIS", "AAPL", "MSFT", "NVDA"], fetch_transcript=self._transcript, store=store)
        assert captured["n"] < 4 and out.get("deferred", 0) >= 1

    def test_reap_grounds_stores_and_bills_at_the_BATCH_rate(
            self, store, batch_warmer, monkeypatch):
        import api.services.llm_batch as lb
        transcript = self._transcript("DIS")

        class _Msg:
            stop_reason = "end_turn"
            content = [type("B", (), {"type": "text", "text": json.dumps({
                "headline": "Record quarter", "quotes": [], "forward_looking": [],
                "qa_highlights": [], "speakers": []})})()]
            usage = type("U", (), {"input_tokens": 18000, "output_tokens": 3500})()

        def fake_reap(surface, handle):
            handle("DIS|Q3 2026", _Msg(),
                   {"symbol": "DIS", "quarter": "Q3 2026", "transcript": transcript})
            return {"batches": 1, "succeeded": 1, "errored": 0,
                    "pending": 0, "abandoned": 0}

        monkeypatch.setattr(lb, "reap", fake_reap)
        monkeypatch.setattr("api.services.call_recap.get_webcast_url", lambda s: None)
        monkeypatch.setattr("api.services.call_recap.get_rating_changes", lambda s: None)
        batch_warmer.reap_batches(store=store)
        assert store.has("DIS", "Q3 2026")
        # billed at HALF list price — a cap that measures list-price tokens
        # spends half the discount on an artificially early cap trip
        listed = 18000 * store.PRICE_IN + 3500 * store.PRICE_OUT
        assert abs(store.spend_today() - listed * 0.5) < 1e-9

    def test_an_errored_result_writes_nothing(self, store, batch_warmer, monkeypatch):
        """The failure shape is a COLD name (the click path covers it), never a
        wrong or half-written one."""
        import api.services.llm_batch as lb
        monkeypatch.setattr(lb, "reap", lambda surface, handle: (
            handle("DIS|Q3 2026", None, {"symbol": "DIS", "quarter": "Q3 2026",
                                         "transcript": self._transcript("DIS")}),
            {"batches": 1, "succeeded": 0, "errored": 1})[1])
        batch_warmer.reap_batches(store=store)
        assert not store.has("DIS", "Q3 2026")
        assert store.spend_today() == 0.0

    def test_sweep_reaps_BEFORE_it_submits(self, store, batch_warmer, monkeypatch):
        """Reaping first lets store.has() skip a name this batch already
        delivered — submitting first pays for the same recap twice."""
        order = []
        monkeypatch.setattr(batch_warmer, "reap_batches",
                            lambda store=None: order.append("reap") or {})
        monkeypatch.setattr(batch_warmer, "submit_batch",
                            lambda q, store=None: order.append("submit") or {})
        out = batch_warmer.run_sweep(["DIS"], store=store)
        assert order == ["reap", "submit"] and out["mode"] == "batch"

    def test_the_kill_switch_returns_the_serial_lane(self, store, batch_warmer, monkeypatch):
        monkeypatch.setenv("CALL_RECAP_WARM_BATCH", "0")
        seen = []
        out = batch_warmer.run_sweep(["DIS"], warm=lambda s: seen.append(s) or "warmed",
                                     sleep=lambda _: None, store=store)
        assert seen == ["DIS"] and out.get("mode") != "batch"


def test_batch_reaper_is_wired_into_the_scheduler():
    """A submitted batch with no collector is money paid for nothing. Pin the
    job id (AST over main.py, not a grep of prose) + a non-vacuity control."""
    import ast
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    ids = set()
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_job"):
            for kw in node.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    assert "call_recap_batch_reap" in ids
    assert "call_recap_warm_boot" in ids        # control: the probe can see siblings
