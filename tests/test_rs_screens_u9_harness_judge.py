"""RS screens unit U9, part 4: one formation date's portfolios, and the pass rule.

``run.cross_section`` is checked on a hand-built date with MORE than 50 qualifiers,
where the top 50 by Leader score and the top 50 by rating score (the incumbent) are
different lists, so each is seen to be what the specification says it is.

``run.judge`` is the verdict: PASS needs the spread positive with its interval off
zero, AND three of four years positive, AND the quintiles in order, AND (only when the
holdout was read) the same sign there. Each criterion is failed alone, with the other
three met, so no criterion can be dropped without a test going red.
"""
from __future__ import annotations

import pytest

from api.services.rs_leader_test import panel, run, spec
from api.services.screener import rs_leader_score

PH = spec.PRIMARY_HORIZON


# ───────────────────────── one date, 60 qualifiers ──────────────────────────

def _date_book():
    """60 gate-passers ``S00`` .. ``S59`` in one industry, rating score rising with the
    number, plus 10 liquid non-candidates ``N0`` .. ``N9`` (a 1% daily range).

    The ten weakest by rating (S00..S09) are given a far better Steady input than the
    rest, so the Leader score lifts them over the ten above them. Forward returns at 21
    sessions are the stock's number in percent (S37 returns 37%); non-candidates 1%."""
    book = panel.DateBook()
    for i in range(60):
        t = f"S{i:02d}"
        book.add(t, 0.9 if i < 10 else 0.1, 5.0, 4.0, {h: float(i) for h in spec.HORIZONS})
        book.candidates[t] = {"px_below_high_pct": 0.0, "rs_line_below_high_pct": 0.0,
                              "extended": i >= 50, "excursion": {10: (float(i), -1.0), 21: (2.0 * i, -2.0)}}
    for i in range(10):
        book.add(f"N{i}", 0.1, 5.0, 1.0, {h: 1.0 for h in spec.HORIZONS})
    return book


RATINGS = {**{f"S{i:02d}": (90, float(i)) for i in range(60)},
           **{f"N{i}": (50, -1.0) for i in range(10)}}
CLASSES = {t: {"industry": "X", "sector": "Y"} for t in RATINGS}
BENCH = {"forward": {h: 3.0 for h in spec.HORIZONS}, "above_average": True}


def _rec(**kw):
    args = dict(day=20240105, session="2024-01-05", k=40, segment=run.DEVELOPMENT,
                book=_date_book(), bench=BENCH, ratings=RATINGS, classes=CLASSES)
    args.update(kw)
    return run.cross_section(args["day"], args["session"], args["k"], args["segment"],
                             args["book"], args["bench"], args["ratings"], args["classes"])


def test_the_two_top_50_lists_are_what_the_specification_says():
    rec = _rec()
    assert (rec["floor"], rec["gate_bars"], rec["qualifiers"], rec["scored"]) == (70, 60, 60, 60)
    assert rec["skipped"] is None and rec["market_above_average"] is True
    incumbent = rec["lists"]["top_rating"]
    assert incumbent == [f"S{i:02d}" for i in range(59, 9, -1)], "the 50 highest rating scores, best first"
    by_score = rec["lists"]["top_score"]
    assert len(by_score) == 50 and set(by_score) != set(incumbent)
    # the same score the nightly stores, over the same 70 liquid rows
    rows = [{"ticker": t, "rs_rating_score": RATINGS[t][1], "rs_steady": s, "chg_pct_1m": c,
             "px_below_high_pct": 0.0 if t.startswith("S") else None,
             "rs_line_below_high_pct": 0.0 if t.startswith("S") else None,
             "industry": "X", "sector": "Y"} for t, s, c, _a, _f in _date_book().members()]
    scores = {t: v["score"] for t, v in rs_leader_score.score_rows(rows, in_floor=lambda r: True).items()
              if v["score"] is not None}
    assert set(scores) == {f"S{i:02d}" for i in range(60)}, "the non-candidates have no High part"
    assert by_score == sorted(scores, key=lambda t: (-scores[t], t))[:50]
    assert set(by_score) & {f"S{i:02d}" for i in range(10)}, "Steady lifted some of the weakest ten in"


def test_returns_cost_and_baselines_on_one_date():
    """The incumbent list holds S10..S59: mean return 34.5%, less the 0.2% cost. The range
    baseline is the 60 stocks with a 4% range (mean 29.5%, uncharged); the plain baseline
    adds ten 1% stocks at 1%: (60 x 29.5 + 10) / 70. The benchmark returned 3%."""
    g = _rec()["h"][PH]["groups"]
    assert g["top_rating"] == {"n": 50, "mean": pytest.approx(34.5 - 0.2), "positive": 50, "beat": 50}
    assert g["baseline_liquid_range"]["n"] == 60
    assert g["baseline_liquid_range"]["mean"] == pytest.approx(29.5)
    assert g["baseline_liquid"]["mean"] == pytest.approx((60 * 29.5 + 10) / 70)
    assert g["baseline_liquid"]["positive"] == 69, "S00 returned 0%: not a positive return"
    # 60 scored stocks: five quintiles of 12, and the spread is top minus bottom
    assert [g[f"q{q}"]["n"] for q in range(1, 6)] == [12] * 5
    rec = _rec()
    assert rec["h"][PH]["spread"] == pytest.approx(g["q5"]["mean"] - g["q1"]["mean"])
    assert rec["h"][PH]["benchmark"] == 3.0
    # a stock that returned 0.2% or less is not a hit after the cost; 3.2% or less does not beat SPY
    low = sum(1 for i in range(10, 60) if i - 0.2 > 3.0)
    assert g["top_rating"]["beat"] == 50 and low == 50
    q1 = g["q1"]
    assert q1["positive"] <= q1["n"] and q1["beat"] <= q1["positive"]


def test_an_open_window_is_left_out_of_the_mean_not_counted_as_zero():
    book = _date_book()
    n = book.tickers.index("S59")
    book.forward[PH][n] = float("nan")              # S59's 21-session window is not over
    g = _rec(book=book)["h"][PH]["groups"]
    assert g["top_rating"]["n"] == 49
    assert g["top_rating"]["mean"] == pytest.approx(sum(range(10, 59)) / 49 - 0.2)
    assert _rec(book=book)["h"][5]["groups"]["top_rating"]["n"] == 50, "the other horizons are untouched"


def test_extended_and_excursions_follow_the_lists():
    rec = _rec()
    assert sum(rec["extended"]["top_rating"]) == 10, "S50..S59 are flagged"
    assert rec["excursion"]["top_rating"][10][0] == (59.0, -1.0)
    assert len(rec["excursion"]["top_rating"][21]) == 50


def test_leave_one_out_re_sorts_the_same_qualifiers():
    """Without Steady the lift given to the weakest ten is gone: the order is the rating's
    again, so the spread widens to the full range (the top 12 minus the bottom 12)."""
    rec = _rec()
    assert set(rec["without"]) == {"strength", "steady", "high", "group"}
    assert rec["without"]["steady"] == pytest.approx(sum(range(48, 60)) / 12 - sum(range(12)) / 12)
    assert rec["without"]["steady"] > rec["h"][PH]["spread"]
    assert rec["without"]["high"] == pytest.approx(rec["h"][PH]["spread"]), "High is the same for all"


def test_the_rating_gate_and_the_25_qualifier_floor():
    weak = {**RATINGS, **{f"S{i:02d}": (79, float(i)) for i in range(36)}}      # 24 left at 80+
    rec = _rec(ratings=weak)
    assert (rec["qualifiers"], rec["scored"], rec["skipped"]) == (24, 24, run.SKIP_FEW)
    assert "h" not in rec
    edge = {**RATINGS, **{f"S{i:02d}": (79, float(i)) for i in range(35)}}      # 25 left
    edge["S35"] = (80, 35.0)                                                      # 80 itself is in
    rec = _rec(ratings=edge)
    assert (rec["qualifiers"], rec["skipped"]) == (25, None)
    unrated = {t: v for t, v in RATINGS.items() if t != "S59"}
    assert _rec(ratings=unrated)["qualifiers"] == 59, "no stored rating that session: not a qualifier"
    none = {**RATINGS, "S59": (None, 59.0)}
    assert _rec(ratings=none)["qualifiers"] == 59


def test_a_date_with_no_benchmark_session_is_skipped():
    rec = _rec(bench=None)
    assert rec["skipped"] == run.SKIP_NO_SESSION and "h" not in rec


# ───────────────────────── the pass rule, one criterion at a time ───────────

def _dev(*, years=(1.0, 1.0, 1.0, 1.0), excess=(-2.0, -1.0, 0.0, 1.0, 2.0), noise=0.1):
    """A development summary with 20 formation dates in each of 2021..2024. The spread on
    each date is the year's value plus a small alternating wobble (so an interval exists)."""
    by_date = []
    for y, m in zip((2021, 2022, 2023, 2024), years):
        for n in range(20):
            by_date.append({"date": f"{y}-{1 + n // 2:02d}-{1 + n % 2:02d}",
                            "spread_pct": m + (noise if n % 2 else -noise)})
    mean = sum(p["spread_pct"] for p in by_date) / len(by_date)
    return {"primary": {"top_minus_bottom_pct": mean,
                        "by_date": by_date, "dates": len(by_date), "independent_blocks": 20,
                        "quintile_excess_pct": list(excess),
                        "without": {p: [(int(d["date"].replace("-", "")), d["spread_pct"]) for d in by_date]
                                    for p in rs_leader_score.PARTS}}}


def _hold(spread):
    return {"primary": {"top_minus_bottom_pct": spread, "dates": 46}}


def _met(j):
    return [c["met"] for _k, c in sorted(j["criteria"].items())]


def test_all_three_development_criteria_met_is_a_pass_while_locked():
    j = run.judge(_dev(), None, unlocked=False)
    assert _met(j) == [True, True, True, None] and j["passed"] is True
    c1 = j["criteria"]["1_spread_positive_interval_off_zero"]
    assert c1["interval"]["low"] > 0 and c1["interval"]["draws"] == 2000 and c1["reason"] is None
    assert j["criteria"]["4_same_sign_in_holdout"]["asked"] is False


def test_criterion_1_fails_alone_when_the_interval_reaches_zero():
    """Three strong years and one very weak one: the mean is positive and three of four
    years are, but the blocks that fall in the weak year pull the interval through zero."""
    j = run.judge(_dev(years=(0.6, 0.6, 0.6, -1.7)), None, unlocked=False)
    c1 = j["criteria"]["1_spread_positive_interval_off_zero"]
    assert c1["spread_pct"] > 0 and c1["interval"]["low"] <= 0
    assert _met(j) == [False, True, True, None] and j["passed"] is False


def test_criterion_1_fails_on_a_negative_spread_whatever_the_interval():
    j = run.judge(_dev(years=(-1.0, -1.0, -1.0, -1.0)), None, unlocked=False)
    assert j["criteria"]["1_spread_positive_interval_off_zero"]["met"] is False
    assert j["passed"] is False


def test_criterion_2_fails_alone_with_two_positive_years():
    j = run.judge(_dev(years=(3.0, 3.0, -0.1, -0.1)), None, unlocked=False)
    assert j["criteria"]["2_positive_in_3_of_4_years"]["positive"] == 2
    assert _met(j) == [True, False, True, None] and j["passed"] is False


def test_criterion_3_fails_alone_when_the_quintiles_are_out_of_order():
    j = run.judge(_dev(excess=(0.0, -1.0, -2.0, 1.0, 2.0)), None, unlocked=False)
    assert j["criteria"]["3_quintiles_in_order"]["spearman"] == pytest.approx(0.6)
    assert _met(j) == [True, True, False, None] and j["passed"] is False
    # exactly 0.8 is in order enough
    j = run.judge(_dev(excess=(-1.0, -2.0, 0.0, 2.0, 1.0)), None, unlocked=False)
    assert j["criteria"]["3_quintiles_in_order"]["spearman"] == pytest.approx(0.8)
    assert j["passed"] is True
    # a quintile with no value is no order
    j = run.judge(_dev(excess=(-2.0, None, 0.0, 1.0, 2.0)), None, unlocked=False)
    assert j["criteria"]["3_quintiles_in_order"]["met"] is False


def test_criterion_4_is_asked_only_when_the_holdout_was_read():
    good = run.judge(_dev(), _hold(0.4), unlocked=True)
    assert _met(good) == [True, True, True, True] and good["passed"] is True
    bad = run.judge(_dev(), _hold(-0.4), unlocked=True)
    assert _met(bad) == [True, True, True, False] and bad["passed"] is False
    assert bad["criteria"]["4_same_sign_in_holdout"]["holdout_spread_pct"] == -0.4
    flat = run.judge(_dev(), _hold(0.0), unlocked=True)
    assert flat["passed"] is False, "zero is not the same sign"
    empty = run.judge(_dev(), _hold(None), unlocked=True)
    assert empty["passed"] is False, "a holdout with no spread cannot confirm anything"
    # a good holdout never rescues a failed development criterion
    rescued = run.judge(_dev(years=(3.0, 3.0, -0.1, -0.1)), _hold(5.0), unlocked=True)
    assert rescued["passed"] is False


def test_leave_one_out_is_reported_and_decides_nothing():
    dev = _dev()
    # without Group the spread is 0.5 higher in three of the four years
    dev["primary"]["without"]["group"] = [
        (d, v + (0.5 if d // 10000 != 2022 else 0.0)) for d, v in dev["primary"]["without"]["group"]]
    j = run.judge(dev, None, unlocked=False)
    loo = j["leave_one_out"]
    assert loo["group"]["removal_helps"] is True and loo["group"]["years_improved"] == 3
    assert loo["group"]["decision"] == "KEEP" and loo["steady"]["removal_helps"] is False
    assert j["passed"] is True, "a part that could go does not change the verdict"
    lines = run.verdict_lines({"judgement": j, "quick_run": False, "holdout_unlocked": False,
                               run.DEVELOPMENT: {"dates_used": 80, "formation_dates": 80,
                                                 "first_date": "2021-01-01", "last_date": "2024-10-02"}})
    note = [l for l in lines if l.startswith("NOTE")]
    assert len(note) == 1 and "Removing group" in note[0] and "The default is KEEP" in note[0]
    assert lines[-1] == spec.CAVEAT and lines[-2].startswith("VERDICT: PASS on development data")
