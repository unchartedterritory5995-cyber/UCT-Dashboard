"""What CEOs are saying: the phrases new and rising across a month of earnings calls.

What these pin: CALLS are counted (never repeats), a real theme reaches the right list, and each
kind of thing that is not a theme stays out: operator and safe-harbour wording, greetings, numbers
and dates, seasonal expressions, speaker names, one company's own phrase, and the vocabulary of an
industry that simply reports later in the season. Then the hand-off: a request never builds.
"""
from __future__ import annotations

import importlib
import json
import threading
from datetime import datetime, timezone

import pytest


@pytest.fixture
def ct(tmp_path, monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_INDEX_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import api.services.transcript_index as ix
    importlib.reload(ix)
    ix.init_db()
    import api.services.call_themes as m
    m._reset_for_tests()
    monkeypatch.setattr(m, "PACE_S", 0)
    monkeypatch.setattr(m, "_groups_for", lambda symbols: {})
    yield m
    done = m._inflight
    if done is not None:
        done.wait(10)
    m._reset_for_tests()


# ── one call's phrases ───────────────────────────────────────────────────────────────────────────

class TestPhrasesOfOneCall:
    def test_one_two_and_three_word_phrases_with_plain_plurals_folded(self, ct):
        keys = ct.doc_keys("Tariffs hurt margins. The tariff impact was real.")
        assert keys.count("tariff") == 2                      # "Tariffs" and "tariff" are one phrase
        assert "tariff impact" in keys and "tariff hurt margin" in keys
        assert "margin the tariff" not in keys                # a full stop ends the run of words

    def test_a_phrase_never_begins_or_ends_on_a_filler_word(self, ct):
        keys = ct.doc_keys("We think the cost of capital is rising")
        assert "cost of capital" in keys                      # a joining word may sit in the middle
        assert "think" not in keys and "the cost" not in keys and "cost of" not in keys
        assert "capital is rising" not in keys                # "is" is not a joining word

    def test_numbers_dates_and_calendar_words_end_the_run(self, ct):
        keys = ct.doc_keys("Revenue of 4.2 billion in the fourth quarter of fiscal 2027 and Q3 guidance in October")
        assert set(keys) == {"revenue", "guidance"}

    def test_seasonal_expressions_are_not_phrases(self, ct):
        keys = ct.doc_keys("Black Friday traffic and back to school demand")
        assert "black" not in keys and "school" not in keys
        assert {"traffic", "demand"} <= set(keys)

    def test_safe_harbour_and_greeting_wording_is_dropped(self, ct):
        keys = ct.doc_keys("Thank you operator. These forward-looking statements may differ materially. See our press release.")
        for gone in ("thank", "operator", "forward looking", "looking statement", "forward looking statement",
                     "differ materially", "press release"):
            assert gone not in keys

    def test_the_operator_is_not_counted_and_speaker_names_are_not_phrases(self, ct):
        text = ("Operator: Welcome to the Zoomcast platform. Thaddeus Quill is on the line.\n"
                "Mary Stone: Thanks. Sovereign compute demand is strong.\n"
                "Thaddeus Quill: What about sovereign compute pricing?\n"
                "Mary Stone: Thanks, Thaddeus. Stone quarries are unrelated.")
        keys = ct.doc_keys(text)
        assert "zoomcast" not in keys and "platform" not in keys          # the operator's turn
        assert "thaddeus" not in keys and "quill" not in keys and "stone" not in keys
        assert keys.count("sovereign compute") == 2

    def test_a_label_that_is_not_a_person_does_not_take_its_words_out_of_the_call(self, ct):
        text = ("Unidentified Company Representative: Welcome.\nMary Stone: The company grew.\n"
                "Unidentified Analyst: Is the company hiring?\nMary Stone: Yes.")
        keys = ct.doc_keys(text)
        assert keys.count("company") == 2 and "mary" not in keys

    def test_a_text_with_no_speaker_lines_is_taken_whole(self, ct):
        turns, names = ct.split_turns("Operator said welcome. Sovereign compute demand is strong.")
        assert len(turns) == 1 and names == set()

    def test_as_said_keeps_real_capitals_and_lowers_a_sentence_start(self, ct):
        want = frozenset({"ai agent", "tariff"})
        got = ct.doc_keys("Tariffs rose. Our AI agents sell more.", {}, want)
        assert ("tariff", "tariffs") in got and ("ai agent", "AI agents") in got


# ── which months get a list ──────────────────────────────────────────────────────────────────────

class TestPlanMonths:
    def test_the_newest_two_months_with_enough_calls_and_enough_before_them(self, ct):
        plan = ct.plan_months({"2026-08": 120, "2026-09": 130, "2026-10": 400, "2026-11": 300})
        assert [p["month"] for p in plan] == ["2026-11", "2026-10"]
        assert plan[0]["base_months"] == ["2026-08", "2026-09", "2026-10"] and plan[0]["base_calls"] == 650
        assert plan[1]["base_months"] == ["2026-08", "2026-09"]

    def test_a_thin_month_is_skipped_and_a_month_with_nothing_before_it_gets_no_list(self, ct):
        assert ct.MIN_MONTH_CALLS == 100 and ct.MIN_BASE_CALLS == 100
        plan = ct.plan_months({"2026-09": 500, "2026-10": 400, "2026-11": 99})
        assert [p["month"] for p in plan] == ["2026-10"]         # November is one call short; September has no before
        assert ct.plan_months({"2026-10": 99, "2026-11": 400}) == []

    def test_the_comparison_reaches_back_three_calendar_months_across_a_year_end(self, ct):
        plan = ct.plan_months({"2025-09": 200, "2025-10": 200, "2025-12": 200, "2026-01": 300})
        assert plan[0]["month"] == "2026-01" and plan[0]["base_months"] == ["2025-10", "2025-12"]

    def test_the_call_floor_is_the_larger_of_the_count_and_the_share(self, ct):
        assert ct.floor_calls(100) == 8 and ct.floor_calls(400) == 8 and ct.floor_calls(1400) == 28


# ── ranking ──────────────────────────────────────────────────────────────────────────────────────

def _rank(ct, rows, month=1000, base=2000, **kw):
    return ct.rank_month(rows, month, base, **kw)


class TestRankMonth:
    def test_new_is_near_absent_before_and_rising_is_points_and_times(self, ct):
        out = _rank(ct, [("agentic commerce", 60, 58, 4, 4.0),       # 6.0% against 0.2%
                         ("tariff", 300, 290, 200, 200.0),           # 30% against 10%
                         ("margin", 620, 600, 1200, 1200.0),         # 62% against 60%: 2 points, not 1.25 times
                         ("pipeline", 120, 118, 210, 210.0)])        # 12% against 10.5%: 1.5 points
        assert [r["key"] for r in out["new"]] == ["agentic commerce"]
        assert [r["key"] for r in out["rising"]] == ["tariff"]
        row = out["rising"][0]
        assert (row["pct"], row["base_pct"], row["rise"], row["ratio"], row["companies"]) == (30.0, 10.0, 20.0, 3.0, 290)
        assert out["new"][0]["ratio"] == 30.0 and out["qualified"] == {"new": 1, "rising": 1}

    def test_a_phrase_needs_the_floor_of_calls_and_of_companies(self, ct):
        out = _rank(ct, [("too few calls", 19, 19, 0, 0.0),          # the floor for 1,000 calls is 20
                         ("one company", 40, 5, 0, 0.0),            # five companies
                         ("enough", 20, 6, 0, 0.0)])
        assert [r["key"] for r in out["new"]] == ["enough"]

    def test_a_gap_that_chance_alone_explains_is_not_listed(self, ct):
        # 11% against 5% is a rise on both tests, and nothing in a month of 150 calls
        thin = ct.rank_month([("pricing power", 17, 17, 18, 18.0)], 150, 360)
        assert thin["rising"] == []
        big = ct.rank_month([("pricing power", 165, 160, 180, 180.0)], 1500, 3600)
        assert [r["key"] for r in big["rising"]] == ["pricing power"]

    def test_weighting_shrinks_what_the_earlier_calls_can_prove(self, ct):
        row = [("glp users", 90, 90, 100, 100.0)]                     # 9% against 5%
        assert ct.rank_month(row, 1000, 2000)["rising"] != []
        assert ct.rank_month(row, 1000, 2000, base_effective=150.0)["rising"] == []

    def test_the_rule_uses_the_like_for_like_share_not_the_plain_one(self, ct):
        out = _rank(ct, [("net interest income", 400, 390, 200, 800.0)])   # plainly 10% before; like for like 40%
        assert out["rising"] == [] and out["new"] == []

    def test_a_shorter_phrase_gives_way_to_the_longer_one_that_explains_it(self, ct):
        out = _rank(ct, [("shutdown", 150, 150, 0, 0.0), ("government shutdown", 140, 140, 0, 0.0),   # 140 of its 150 calls
                         ("pricing", 300, 300, 240, 240.0), ("pricing power", 180, 180, 60, 60.0)])
        assert [r["key"] for r in out["new"]] == ["government shutdown"]
        assert [r["key"] for r in out["rising"]] == ["pricing power"]      # 15 of "pricing"'s 18 points

    def test_a_single_word_must_double_where_a_phrase_needs_a_quarter_more(self, ct):
        out = _rank(ct, [("orders", 320, 320, 400, 400.0), ("order backlog", 320, 320, 400, 400.0),   # 32% against 20%
                         ("tariff", 400, 400, 400, 400.0)])                                            # 40% against 20%
        assert [r["key"] for r in out["rising"]] == ["tariff", "order backlog"]
        assert ct.RISE_MIN_RATIO == 1.25 and ct.RISE_MIN_RATIO_ONE_WORD == 2.0

    def test_a_longer_phrase_is_named_on_the_row_it_holds_not_listed_again(self, ct):
        out = _rank(ct, [("tariff", 300, 300, 200, 200.0), ("tariff impact", 120, 120, 60, 60.0),
                         ("reciprocal tariff", 90, 90, 40, 40.0), ("tariff exemption", 70, 70, 20, 20.0),
                         ("tariff cost", 60, 60, 20, 20.0)])
        assert [r["key"] for r in out["rising"]] == ["tariff"]
        assert out["rising"][0]["related"] == ["tariff impact", "reciprocal tariff", "tariff exemption"]
        assert out["qualified"]["rising"] == 1

    def test_the_lists_are_cut_from_the_weak_end(self, ct):
        rows = [(f"theme{i:02d}", 100 + i, 100, 0, 0.0) for i in range(40)]
        out = _rank(ct, rows)
        assert len(out["new"]) == ct.LIST_CAP == 30 and out["qualified"]["new"] == 40
        assert out["new"][0]["key"] == "theme39" and out["new"][-1]["key"] == "theme10"


class TestFoldTogether:
    def _lists(self, *keys):
        return {"new": [{"key": k, "related": []} for k in keys], "rising": [], "qualified": {"new": len(keys), "rising": 0}}

    def test_phrases_said_by_the_same_calls_are_one_row(self, ct):
        said = {"government shutdown": 0b1111111111, "delayed approvals": 0b0111111111, "agentic commerce": 0b1111100000 << 10}
        out = ct.fold_together(self._lists("government shutdown", "delayed approvals", "agentic commerce"), said, 100)
        assert [r["key"] for r in out["new"]] == ["government shutdown", "agentic commerce"]
        assert out["new"][0]["related"] == ["delayed approvals"] and out["qualified"]["new"] == 2

    def test_a_word_that_travels_with_a_theme_folds_into_it(self, ct):
        tariff = (1 << 30) - 1                                 # 30 of 100 calls
        said = {"tariff": tariff, "exemption": 0b111111, "margin": (1 << 6) - 1 << 40}
        out = ct.fold_together(self._lists("tariff", "exemption", "margin"), said, 100)
        assert [r["key"] for r in out["new"]] == ["tariff", "margin"]

    def test_nothing_folds_into_a_phrase_most_calls_say_anyway(self, ct):
        everyone = (1 << 90) - 1                               # 90 of 100 calls
        out = ct.fold_together(self._lists("demand", "sovereign compute"), {"demand": everyone, "sovereign compute": 0b11111111}, 100)
        assert [r["key"] for r in out["new"]] == ["demand", "sovereign compute"]


class TestLikeForLike:
    def test_with_no_industry_map_every_earlier_call_counts_once(self, ct):
        weights, matched = ct.base_weights(["A", "B"], ["C", "D", "E"], {})
        assert weights == [1.0, 1.0, 1.0] and matched == 0.0

    def test_the_earlier_calls_are_weighted_to_this_months_mix(self, ct):
        groups = {f"T{i}": {"sector": "Financial", "industry": "Banks"} for i in range(40)}
        groups |= {f"T{i}": {"sector": "Technology", "industry": "Software"} for i in range(40, 100)}
        groups |= {f"B{i}": {"sector": "Financial", "industry": "Banks"} for i in range(10)}
        groups |= {f"B{i}": {"sector": "Technology", "industry": "Software"} for i in range(10, 100)}
        weights, matched = ct.base_weights([f"T{i}" for i in range(100)], [f"B{i}" for i in range(100)], groups)
        assert matched == 100.0
        assert weights[0] == pytest.approx(4.0) and weights[50] == pytest.approx(60 / 90)   # banks: 40% now, 10% before
        assert sum(weights) == pytest.approx(100.0)

    def test_a_thin_industry_falls_back_to_its_sector_then_to_the_rest(self, ct):
        groups = {f"T{i}": {"sector": "Healthcare", "industry": f"Niche {i % 5}"} for i in range(20)}
        groups |= {f"B{i}": {"sector": "Healthcare", "industry": f"Niche {i % 5}"} for i in range(20)}
        _w, matched = ct.base_weights([f"T{i}" for i in range(20)] + ["X1"], [f"B{i}" for i in range(20)] + ["X2"], groups)
        assert matched == pytest.approx(20 * 100 / 21, abs=0.1)      # four a niche is thin; the sector holds twenty


# ── the whole build, over planted calls ──────────────────────────────────────────────────────────

MONTHS = {"2026-08": 120, "2026-09": 120, "2026-10": 120, "2026-11": 150}
FILLER = ["Revenue grew and operating margin expanded.", "Demand was steady across our regions.",
          "We returned cash to shareholders.", "Our balance sheet is healthy."]


def _sym(n: int) -> str:
    return "S" + "".join("ABCDEFGHIJ"[int(d)] for d in f"{n:03d}")


def _plant(ix):
    """Four months of short calls. Returns {symbol: {"sector", "industry"}}.

    In November only, unless said otherwise:
      new        "agentic commerce"            30 calls, none before
      rising     "tariffs"                     66 calls (42%), 10% of every earlier month
      steady     "pricing power"               20% of every month
      fading     "destocking"                  30% before, 5% now
      boilerplate, said by the investor-relations speaker and the operator
      greeting   "happy thanksgiving", "thank you operator"
      dates      "fourth quarter of fiscal 2027"
      seasonal   "Black Friday"
      a name     the analyst Thaddeus Quill, thanked by name, on 40 calls
      one call   "quantum advantage" forty times on a single call
      one company "Project Skyline" on nine calls of the same company
      an industry banks say "net interest income" on every call, and are 10% of the earlier calls
                 and 40% of November's
    """
    groups, n = {}, 0
    for ym, count in MONTHS.items():
        nov = ym == "2026-11"
        for i in range(count):
            n += 1
            sym = _sym(n)
            bank = i % 10 < (4 if nov else 1)
            groups[sym] = ({"sector": "Financial", "industry": "Banks"} if bank
                           else {"sector": "Technology", "industry": "Software"})
            body = [FILLER[i % 4], FILLER[(i + 1) % 4]]
            if bank:
                body.append("Net interest income rose on loan growth.")
            if i % 5 == 0:
                body.append("We kept our pricing power.")
            if i % 20 < (1 if nov else 6):
                body.append("Customer destocking weighed on volumes.")
            if (i % 7 < 3) if nov else (i % 10 == 3):
                body.append("Tariffs raised our costs." if i % 3 else "The tariff bill rose and tariffs hit suppliers.")
            ir = "These forward-looking statements may differ materially from actual results. See our press release."
            ask = "How should we think about demand?"
            who = "Dana Reed"
            if nov:
                if i % 5 == 1:
                    body.append("Agentic commerce is sending shoppers to us.")
                if i in (1, 6, 11):
                    body.append("Agentic commerce matters. Agentic commerce is early. Agentic commerce will grow.")
                body.append("We expect a strong fourth quarter of fiscal 2027 and a good Black Friday.")
                body.append("Happy Thanksgiving to all.")
                if i % 15 < 4:
                    who = "Thaddeus Quill"
                if i == 7:
                    body.append("Quantum advantage is near. " * 40)
            text = (f"Operator: Welcome to the Zoomcast line.{' The Zoomcast recording has started.' if nov else ''}\n"
                    f"Ira Vale: {ir if nov else 'Welcome everyone.'}\n"
                    f"Pat Lane: {' '.join(body)}\n"
                    f"{who}: {ask}\n"
                    f"Pat Lane: Thanks, {who.split()[0]}. Thank you operator. {FILLER[(i + 2) % 4]}\n"
                    "Operator: That concludes the Zoomcast call.")
            ix.put(sym, 2026, 3, f"{ym}-{1 + i % 27:02d} 17:00:00", text)
    for q in range(9):                                         # one company, nine calls in November
        ix.put("PETC", 2018 + q, 1 + q % 4, f"2026-11-{10 + q:02d}",
               "Operator: Welcome.\nIra Vale: Welcome everyone.\nPat Lane: Project Skyline is on track. Demand was steady across our regions.\n"
               "Dana Reed: Thanks.\nPat Lane: Project Skyline again.")
    groups["PETC"] = {"sector": "Technology", "industry": "Software"}
    return groups


@pytest.fixture(scope="module")
def planted(tmp_path_factory):
    """The planted calls, built once: (with the industry map, without it, the call search's own month totals)."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("TRANSCRIPT_INDEX_DB_PATH", str(tmp_path_factory.mktemp("planted") / "t.db"))
        import api.services.transcript_index as ix
        importlib.reload(ix)
        ix.init_db()
        import api.services.call_themes as m
        groups = _plant(ix)
        now = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
        payload = m.build(groups=groups, now=now, pace=0)
        plain = m.build(groups={}, now=now, pace=0)
        trend = {x["month"]: x["calls"] for x in ix.trend("tariff")["months"]}
    return payload, plain, trend


def _phrases(one, name):
    return [r["phrase"] for r in one[name]]


def _everything(one):
    words = []
    for name in ("new", "rising"):
        for r in one[name]:
            words += [r["phrase"].lower(), *[x.lower() for x in r["related"]]]
    return " | ".join(words)


class TestBuildOverPlantedCalls:
    def test_the_fixture_is_big_enough_to_mean_something(self, planted):
        payload, _plain, _trend = planted
        assert payload["built_at"] == "2026-11-17T12:00:00Z" and payload["built_day"] == "2026-11-17"
        assert payload["corpus"]["calls"] == 519 >= 60
        assert [m["calls"] for m in payload["corpus"]["months"]] == [120, 120, 120, 159]
        assert payload["corpus"]["oldest"] == "2026-08-01" and payload["corpus"]["newest"] == "2026-11-27"

    def test_november_lists_the_new_theme_and_the_rising_theme_and_nothing_else(self, planted):
        payload, _plain, _trend = planted
        assert payload["months"] == ["2026-11", "2026-10"]
        nov = payload["lists"]["2026-11"]
        assert (nov["calls"], nov["companies"]) == (159, 151)
        assert nov["baseline"] == {"months": ["2026-08", "2026-09", "2026-10"], "calls": 360, "matched_pct": 100.0}
        assert _phrases(nov, "new") == ["agentic commerce"]
        assert _phrases(nov, "rising") == ["tariffs"]

    def test_calls_are_counted_not_repeats_with_the_share_and_the_companies(self, planted):
        payload, _plain, _trend = planted
        new = payload["lists"]["2026-11"]["new"][0]
        assert (new["calls"], new["companies"], new["base_calls"], new["base_pct"]) == (30, 30, 0, 0.0)
        assert new["pct"] == round(30 * 100 / 159, 1) and new["ratio"] is None
        rising = payload["lists"]["2026-11"]["rising"][0]
        assert (rising["calls"], rising["base_calls"], rising["base_raw_pct"]) == (66, 36, 10.0)
        assert rising["pct"] == round(66 * 100 / 159, 1) and rising["rise"] > 20

    def test_the_examples_are_the_companies_whose_call_said_it_most(self, planted):
        payload, _plain, _trend = planted
        new = payload["lists"]["2026-11"]["new"][0]
        assert new["examples"] == [_sym(360 + 2), _sym(360 + 7), _sym(360 + 12)]      # the three calls that said it four times

    def test_what_is_not_a_theme_stays_out(self, planted):
        payload, _plain, _trend = planted
        said = _everything(payload["lists"]["2026-11"])
        for gone in ("forward", "materially", "press release", "zoomcast", "recording", "thanksgiving", "operator", "fourth", "fiscal",
                     "2027", "black", "friday", "thaddeus", "quill", "quantum", "skyline", "project", "net interest",
                     "interest income", "pricing power", "destocking", "revenue", "demand"):
            assert gone not in said, gone

    def test_without_the_industry_map_the_late_reporting_industry_looks_like_a_theme(self, planted):
        payload, plain, _trend = planted
        assert "net interest" not in _everything(payload["lists"]["2026-11"])
        nov = plain["lists"]["2026-11"]
        assert nov["baseline"]["matched_pct"] == 0.0
        assert "net interest income" in _everything(nov)         # the trap the weighting exists for

    def test_october_had_no_theme_and_says_so_with_empty_lists(self, planted):
        payload, _plain, _trend = planted
        oct_ = payload["lists"]["2026-10"]
        assert oct_["new"] == [] and oct_["rising"] == [] and oct_["baseline"]["months"] == ["2026-08", "2026-09"]

    def test_month_totals_match_the_call_searchs_own_monthly_totals(self, planted):
        payload, _plain, trend = planted
        assert trend == {m["month"]: m["calls"] for m in payload["corpus"]["months"]}

    def test_an_empty_index_and_a_thin_one_build_no_list(self, ct):
        empty = ct.build(pace=0)
        assert empty["months"] == [] and empty["corpus"] == {"calls": 0, "oldest": None, "newest": None, "months": []}
        import api.services.transcript_index as ix
        ix.put("AAPL", 2026, 3, "2026-11-01", "Pat Lane: Tariffs rose.")
        thin = ct.build(pace=0)
        assert thin["months"] == [] and thin["corpus"]["calls"] == 1


# ── the held answer: a request never builds ──────────────────────────────────────────────────────

def _now_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fake(ct, monkeypatch, *, months=("2026-11",), calls=500, built=None, day="2026-11-17"):
    made = []
    built = built or _now_z()

    def build():
        made.append(threading.current_thread().name)
        return {"version": ct.METHOD_VERSION, "built_at": built, "built_day": day, "seconds": 1.0, "rules": dict(ct.RULES),
                "corpus": {"calls": calls, "oldest": "2026-08-20", "newest": "2026-11-17", "months": []},
                "months": list(months),
                "lists": {m: {"month": m, "calls": 300, "companies": 290, "baseline": {"months": [], "calls": 400, "matched_pct": 90.0},
                              "floor": {"calls": 8, "companies": 6}, "new": [{"phrase": "agentic commerce"}], "rising": [],
                              "qualified": {"new": 1, "rising": 0}} for m in months}}
    monkeypatch.setattr(ct, "build", build)
    return made


def _wait(ct):
    done = ct._inflight
    if done is not None:
        assert done.wait(10)


class TestHeldAnswer:
    def test_a_cold_server_answers_computing_and_builds_once_in_the_background(self, ct, monkeypatch):
        gate = threading.Event()
        made = _fake(ct, monkeypatch)
        real = ct.build
        monkeypatch.setattr(ct, "build", lambda: (gate.wait(10), real())[1])
        assert ct.get_themes() == {"status": "computing"}
        assert ct.get_themes() == {"status": "computing"}        # the second read does not start a second build
        assert ct.debug_state()["building"] is True
        done = ct._inflight
        gate.set()
        assert done.wait(10)
        assert made == ["call-themes-build"]                      # one build, on its own thread
        got = ct.get_themes()
        assert got["status"] == "ok" and got["month"] == "2026-11" and got["built_at"].endswith("Z") and got["refreshing"] is False
        assert got["new"] == [{"phrase": "agentic commerce"}] and got["months"] == ["2026-11"]
        assert got["rules"]["min_month_calls"] == 100 and got["corpus"]["calls"] == 500

    def test_the_answer_is_stored_so_a_new_process_reads_it_and_does_not_build(self, ct, monkeypatch, tmp_path):
        made = _fake(ct, monkeypatch)
        ct.get_themes()
        _wait(ct)
        stored = json.loads((tmp_path / "call_themes.json").read_text(encoding="utf-8"))
        assert stored["months"] == ["2026-11"] and stored["version"] == ct.METHOD_VERSION
        ct._reset_for_tests()                                     # "a deploy": the module holds nothing
        assert ct.get_themes()["status"] == "ok"
        assert ct._inflight is None and made == ["call-themes-build"]

    def test_a_stored_answer_from_another_method_version_is_not_served(self, ct, monkeypatch, tmp_path):
        (tmp_path / "call_themes.json").write_text(json.dumps(
            {"version": ct.METHOD_VERSION + 1, "built_at": "2026-11-17T11:00:00Z", "months": [], "lists": {}, "corpus": {}}), encoding="utf-8")
        made = _fake(ct, monkeypatch)
        assert ct.get_themes() == {"status": "computing"}
        _wait(ct)
        assert made == ["call-themes-build"]

    def test_a_damaged_file_is_the_same_as_none(self, ct, monkeypatch, tmp_path):
        (tmp_path / "call_themes.json").write_text("{not json", encoding="utf-8")
        _fake(ct, monkeypatch)
        assert ct.get_themes() == {"status": "computing"}
        _wait(ct)

    def test_the_daily_job_builds_once_a_new_york_day(self, ct, monkeypatch):
        made = _fake(ct, monkeypatch, day="2026-11-17")
        noon = datetime(2026, 11, 17, 17, 0, tzinfo=timezone.utc)
        assert ct.refresh_if_due(noon) is True                    # nothing held
        _wait(ct)
        assert ct.refresh_if_due(noon) is False                   # built today
        assert ct.refresh_if_due(datetime(2026, 11, 18, 3, 0, tzinfo=timezone.utc)) is False    # 22:00 New York, same day
        assert ct.refresh_if_due(datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)) is True    # the next morning
        _wait(ct)
        assert len(made) == 2

    def test_the_daily_job_reads_a_thin_index_again_every_sweep(self, ct, monkeypatch):
        made = _fake(ct, monkeypatch, months=(), calls=40)
        noon = datetime(2026, 11, 17, 17, 0, tzinfo=timezone.utc)
        assert ct.refresh_if_due(noon) is True
        _wait(ct)
        assert ct.refresh_if_due(noon) is True                    # no list yet: cheap, so try again
        _wait(ct)
        assert len(made) == 2

    def test_thin_empty_and_a_month_with_no_list_each_say_so(self, ct, monkeypatch):
        _fake(ct, monkeypatch, months=(), calls=40)
        ct.get_themes()
        _wait(ct)
        assert ct.get_themes()["status"] == "thin" and ct.get_themes()["corpus"]["calls"] == 40
        ct._reset_for_tests()
        _fake(ct, monkeypatch, months=(), calls=0)
        ct._kick("test")
        _wait(ct)
        assert ct.get_themes()["status"] == "empty"
        ct._reset_for_tests()
        _fake(ct, monkeypatch)
        ct._kick("test")
        _wait(ct)
        miss = ct.get_themes("2026-09")
        assert miss["status"] == "no_month" and miss["month"] == "2026-09" and miss["months"] == ["2026-11"]
        assert ct.get_themes("2026-11")["status"] == "ok"

    def test_a_failed_build_is_an_error_for_a_minute_never_computing_for_ever(self, ct, monkeypatch):
        calls = []

        def boom():
            calls.append(1)
            raise RuntimeError("index locked")
        monkeypatch.setattr(ct, "build", boom)
        assert ct.get_themes() == {"status": "computing"}
        _wait(ct)
        assert ct.get_themes() == {"status": "error"} and len(calls) == 1      # held: no second build yet
        monkeypatch.setattr(ct, "ERROR_HOLD_S", 0)
        assert ct.get_themes() == {"status": "computing"}                      # later, a read tries again
        _wait(ct)
        assert len(calls) == 2

    def test_an_old_answer_is_served_at_once_while_one_rebuild_runs(self, ct, monkeypatch):
        made = _fake(ct, monkeypatch, built="2020-01-01T11:00:00Z", day="2020-01-01")
        ct._kick("test")
        _wait(ct)
        got = ct.get_themes()
        assert got["status"] == "ok" and got["refreshing"] is True and got["built_at"] == "2020-01-01T11:00:00Z"
        _wait(ct)
        assert len(made) == 2


# ── the route ────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(ct):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import earnings_intel
    app = FastAPI()
    app.include_router(earnings_intel.router)
    return app, TestClient(app)


class TestRoute:
    def test_it_is_a_paid_route(self, client):
        app, http = client
        from api.middleware.auth_middleware import get_current_user_with_plan
        assert http.get("/api/earnings/call-themes").status_code == 401                 # signed out
        app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "free"}
        refused = http.get("/api/earnings/call-themes")
        assert refused.status_code == 402 and "paid plan" in refused.json()["detail"]

    def test_a_paid_member_reads_the_held_lists_and_the_month_is_checked(self, client, ct, monkeypatch):
        app, http = client
        from api.routers.earnings_intel import require_paid
        app.dependency_overrides[require_paid] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
        seen = []
        monkeypatch.setattr(ct, "get_themes", lambda month=None: (seen.append(month), {"status": "ok", "month": month})[1])
        assert http.get("/api/earnings/call-themes").json() == {"status": "ok", "month": None}
        assert http.get("/api/earnings/call-themes?month=2026-10").json()["month"] == "2026-10"
        assert http.get("/api/earnings/call-themes?month=2026-13").status_code == 422
        assert http.get("/api/earnings/call-themes?month=last").status_code == 422
        assert seen == [None, "2026-10"]

    def test_a_cold_server_answers_computing_with_200_and_a_crash_is_an_error_body(self, client, ct, monkeypatch):
        app, http = client
        from api.routers.earnings_intel import require_paid
        app.dependency_overrides[require_paid] = lambda: {"id": "u1"}
        _fake(ct, monkeypatch)
        cold = http.get("/api/earnings/call-themes")
        assert cold.status_code == 200 and cold.json() == {"status": "computing"}
        _wait(ct)

        def boom(month=None):
            raise RuntimeError("x")
        monkeypatch.setattr(ct, "get_themes", boom)
        assert http.get("/api/earnings/call-themes").json() == {"status": "error"}


# ── the daily job rides the transcript index's own sweep ──────────────────────────────────────────

class TestRidesTheIndexSweep:
    def _jobs(self, monkeypatch):
        import api.main as main
        jobs = {}

        class Scheduler:
            def add_job(self, fn, **kw):
                jobs[kw.get("id")] = fn
        return main, Scheduler(), jobs

    def test_each_sweep_asks_for_the_daily_build_even_when_the_sweep_itself_fails(self, ct, monkeypatch):
        import api.services.transcript_indexer as ixr
        monkeypatch.setenv("TRANSCRIPT_INDEX_ENABLED", "1")
        main, scheduler, jobs = self._jobs(monkeypatch)
        assert main.register_transcript_index_jobs(scheduler) is True
        assert {"transcript_index_0645", "transcript_index_2045", "transcript_index_boot"} <= set(jobs)
        asked = []
        monkeypatch.setattr(ct, "refresh_if_due", lambda: asked.append("due") or True)
        monkeypatch.setattr(ixr, "run_index_sweep", lambda: {"indexed": 0})
        jobs["transcript_index_0645"]()
        assert asked == ["due"]

        def down():
            raise RuntimeError("feed down")
        monkeypatch.setattr(ixr, "run_index_sweep", down)
        jobs["transcript_index_2045"]()
        assert asked == ["due", "due"]

    def test_a_failing_build_start_never_breaks_the_sweep_job(self, ct, monkeypatch):
        import api.services.transcript_indexer as ixr
        monkeypatch.setenv("TRANSCRIPT_INDEX_ENABLED", "1")
        main, scheduler, jobs = self._jobs(monkeypatch)
        main.register_transcript_index_jobs(scheduler)
        monkeypatch.setattr(ixr, "run_index_sweep", lambda: {"indexed": 0})

        def boom():
            raise RuntimeError("x")
        monkeypatch.setattr(ct, "refresh_if_due", boom)
        jobs["transcript_index_boot"]()                           # does not raise

    def test_with_the_index_switched_off_nothing_is_scheduled(self, ct, monkeypatch):
        monkeypatch.delenv("TRANSCRIPT_INDEX_ENABLED", raising=False)
        main, scheduler, jobs = self._jobs(monkeypatch)
        assert main.register_transcript_index_jobs(scheduler) is False and jobs == {}
