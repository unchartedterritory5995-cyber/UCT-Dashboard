"""THE FUNDAMENTALS CASES: five plain-words requests about a company's own figures, held BEFORE anything can answer them.

A member may ask for "quarterly revenue growth" or "book value per share". The figures come from company filings
(UCT data, read by a script with `request.financial`), each dated by the day its filing became public. Until the engine
serves them to members nothing can answer these requests, so the cases are PENDING: words and a rule, no answer, and
none of them counts toward any threshold. The rules were written FIRST, from the words.

Held here, with no paid call:
  * the five cases wait with their words, their rule, what the rule needs and what it distinguishes;
  * the built company is the same on every run and holds the ties and holes a rule must be caught on;
  * HOW A FIGURE SITS ON BARS: from the bar its filing became public, carried to the next, WITHHELD where UCT holds no
    current figure, and never carried across a hole;
  * each rule passes on a second calculation of the same words and fails on the honest-looking wrong readings:
    BARS counted in place of reports, a single quarter in place of twelve months, a zero or an older value where
    the figure is withheld;
  * "quarterly revenue growth" reads two honest ways and either is right;
  * the analyst estimate is a wall: refused by name, with the filed figure offered, and nothing built.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from tools.value_cases import grade as G
from tools.value_cases import script_rules as R
from tools.value_cases.market import STOCK

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
PENDING = {c["id"]: c for c in DATA.get("pending") or [] if c["id"].startswith("fund-")}
SCRIPT_IDS = ["fund-01", "fund-02", "fund-03", "fund-04"]
CHART = {"bars": STOCK}
#: ten sessions, Monday 2026-01-05 to Friday 2026-01-16
DAYS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"]


def bound():
    R.bind(CHART)
    return R


def graded(cid, col):
    run = {"ok": True, "errors": None, "columns": {"value": col}, "drawn": {"tables": [], "labels": [], "lines": [], "boxes": [], "via": "test"}}
    got = R.grade_script(cid, "plot(x)", run, CHART)
    return got["verdict"], got["lines"]


def field(*points):
    return {"state": "ok", "knownFrom": points[0][0],
            "points": [{"knownFrom": p[0], "v": p[1], "staleFrom": (p[2] if len(p) > 2 else (None if p[1] is None else "2026-12-31"))} for p in points]}


def shown(col):
    """A placed column with `na` written as the string, so two columns can be compared."""
    return ["na" if (v is not None and v != v) else v for v in col]


def filled(col, with_value=0.0):
    return [with_value if v is None else v for v in col]


# ── the cases ──

def test_five_cases_wait_with_their_words_and_their_rule_and_no_answer():
    assert sorted(PENDING) == SCRIPT_IDS + ["fund-05"]
    recorded = {c["id"] for c in DATA["cases"]}
    for cid in SCRIPT_IDS:
        case = PENDING[cid]
        assert cid not in recorded and case["lane"] == "script" and case["chart"] == "daily"
        assert "answer" not in case and "recorded" not in case and "recorded_verdict" not in case
        assert len(case["rule"]["history"]) == 1 and case["rule"]["history"][0]["digest"] == case["rule"]["digest"]
        assert case["rule"]["history"][0]["reason"] == "written from the request's words before the answer was read"
        assert case["needs"] and case["distinguishes"] and case["waits_for"] and R.has_rule(cid)
    assert [R.RULES[cid] for cid in SCRIPT_IDS] == [R.rule_fund01, R.rule_fund02, R.rule_fund03, R.rule_fund04]
    assert "quarterly revenue growth" in PENDING["fund-01"]["words"]
    assert "diluted EPS over the trailing twelve months" in PENDING["fund-02"]["words"]
    assert "free cash flow per share" in PENDING["fund-03"]["words"] and "book value per share" in PENDING["fund-04"]["words"]
    assert PENDING["fund-04"]["says"] == [["filings", "filed"]]              # the member is told where the number comes from
    wall = PENDING["fund-05"]
    assert wall["lane"] == "wall" and "answer" not in wall and "analyst EPS estimate" in wall["words"] and wall["waits_for"]
    assert wall["wall"]["names"] == ["analyst", "estimate"] and [o["words"] for o in wall["wall"]["offers"]] == [["eps", "fil"]]


def test_a_pending_case_is_in_no_lane_count_and_no_threshold():
    assert not {c["id"] for c in DATA["cases"]} & set(PENDING)
    assert set(DATA["thresholds"]) == {"_", "formula", "wall", "script"}       # no lane of their own either


# ── the built company ──

def test_the_built_company_is_the_same_every_run_and_holds_what_a_rule_must_be_caught_on():
    r = bound()
    doc = r.filings_doc(r.T)
    assert doc == r.filings_doc(r.T) and json.loads(json.dumps(doc)) == doc and doc["schema"] == "uct.pine-financial/v1"
    f = doc["fields"]
    assert set(f) == {"TOTAL_REVENUE:FQ", "TOTAL_REVENUE:TTM", "EARNINGS_PER_SHARE_DILUTED:FQ", "EARNINGS_PER_SHARE_DILUTED:TTM",
                      "TOTAL_EQUITY:FQ", "TOTAL_SHARES_OUTSTANDING:FQ", "FREE_CASH_FLOW:TTM"}
    rev = [p["v"] for p in f["TOTAL_REVENUE:FQ"]["points"]]
    assert len(rev) >= 20 and rev[9] == rev[5] and rev[12] == rev[11]          # growth of exactly 0, both ways
    assert sum(1 for p in f["EARNINGS_PER_SHARE_DILUTED:FQ"]["points"] if p["v"] < 0) == 1          # one losing quarter
    assert [p["v"] is None for p in f["FREE_CASH_FLOW:TTM"]["points"]].count(True) == 1             # one report left it unknown
    assert f["TOTAL_SHARES_OUTSTANDING:FQ"]["knownFrom"] > f["TOTAL_EQUITY:FQ"]["knownFrom"]        # the share count starts later
    days = [dt.date.fromisoformat(p["knownFrom"]).weekday() for p in f["TOTAL_REVENUE:FQ"]["points"]]
    assert days.count(5) == 1 and days.count(6) == 0                           # one report public on a Saturday
    for key, fld in f.items():
        known = [p["knownFrom"] for p in fld["points"]]
        assert known == sorted(known) and len(set(known)) == len(known) and fld["knownFrom"] == known[0], key
    # a trailing figure is the last four quarters, so it starts three reports after the quarterly one
    assert f["TOTAL_REVENUE:TTM"]["points"][0]["v"] == pytest.approx(sum(rev[:4])) and len(f["TOTAL_REVENUE:TTM"]["points"]) == len(rev) - 3
    # report by report, a figure the newest filing left unknown is not a report of that figure
    fcf = f["FREE_CASH_FLOW:TTM"]["points"]
    counted = r._reports(f["FREE_CASH_FLOW:TTM"])
    assert len(counted) == len(fcf) - 1 and all(v is not None for _i, v in counted) and [i for i, _v in counted] == sorted(i for i, _v in counted)


# ── how a figure sits on bars ──

def test_a_figure_is_read_from_the_bar_its_filing_became_public_and_carried():
    # public before the chart (carried into it), then Wednesday, then a SATURDAY (read from Monday), then Wednesday
    f = field(("2025-11-03", 100), ("2026-01-07", 120), ("2026-01-10", 130), ("2026-01-14", 140))
    assert R.placed(f, DAYS) == [100, 100, 120, 120, 120, 130, 130, 140, 140, 140]
    # with gaps on it is read on its own bar only; the one carried in did not step on this chart
    assert shown(R.placed(f, DAYS, gaps=True)) == ["na", "na", 120, "na", "na", 130, "na", 140, "na", "na"]
    assert R.NA != R.NA                                                         # `na` is never equal to a value


def test_a_bar_with_no_current_figure_is_WITHHELD_and_nothing_older_is_carried_across_it():
    # nothing public yet: withheld until the first filing
    assert R.placed(field(("2026-01-08", 15)), DAYS) == [None, None, None, 15, 15, 15, 15, 15, 15, 15]
    # a filing on the 8th left the figure UNKNOWN until the 13th: withheld through it, AND before it
    gap = field(("2025-11-03", 1.0), ("2026-01-08", None), ("2026-01-13", 1.2))
    assert R.placed(gap, DAYS) == [None, None, None, None, None, None, 1.2, 1.2, 1.2, 1.2]
    # a figure gone stale on the 9th, until the next filing on the 13th
    stale = field(("2025-06-02", 5, "2026-01-09"), ("2026-01-13", 6))
    assert R.placed(stale, DAYS) == [None, None, None, None, None, None, 6, 6, 6, 6]
    # CONTROL: the same figures with no hole are carried from the first bar
    assert R.placed(field(("2025-11-03", 1.0), ("2026-01-13", 1.2)), DAYS) == [1.0] * 6 + [1.2] * 4
    # with gaps on, the unknown filing's own bar is the hole
    assert shown(R.placed(gap, DAYS, gaps=True)) == [None, None, None, None, "na", "na", 1.2, "na", "na", "na"]


# ── each rule, against the honest-looking wrong readings ──

@pytest.mark.parametrize("cid", SCRIPT_IDS)
def test_the_right_line_passes_and_a_line_one_bar_late_or_filled_in_fails(cid):
    r = bound()
    col = r.RULES[cid]()[0][1]
    assert sum(1 for v in col if v is not None) > 1000 and col[0] is None        # a value on most bars, none on the first
    assert graded(cid, col)[0] == "right"
    assert graded(cid, [None] + list(col[:-1]))[0] == "wrong"                    # one bar late
    assert graded(cid, [None] * r.N)[0] == "wrong"                               # nothing drawn
    # ⛔ WITHHELD MEANS NOTHING: a zero, or any value, where UCT holds no figure is wrong
    verdict, lines = graded(cid, filled(col))
    assert verdict == "wrong" and "bars differ" in " ".join(lines)


def test_quarterly_revenue_growth_reads_two_honest_ways_and_either_is_right():
    r = bound()
    readings = r.rule_fund01()
    assert [v[0].split(",")[0] for v in readings] == ["quarterly revenue against the same quarter a year before (4 reports back)"] * 2 + [
        "quarterly revenue against the quarter before (1 report back)"] * 2
    for _label, col, *_rest in readings:
        assert graded("fund-01", col)[0] == "right"
    yoy, qoq = readings[0][1], readings[2][1]
    assert yoy != qoq and sum(1 for v in yoy if v == 0) > 0 and sum(1 for v in qoq if v == 0) > 0     # each has its tie
    # the year-over-year line starts on the fifth report's bar, the quarter-over-quarter line on the second's
    first = lambda col: next(i for i, v in enumerate(col) if v is not None)  # noqa: E731
    bars = [i for i, _v in r._reports(r._fig("TOTAL_REVENUE:FQ"))]
    assert (first(qoq), first(yoy)) == (bars[1], bars[4])


def test_REPORTS_ARE_COUNTED_never_bars():
    r = bound()
    rev = r.placed(r._fig("TOTAL_REVENUE:FQ"), r.T)
    for back in (252, 63):
        bars = [None if (i < back or rev[i] is None or rev[i - back] is None) else (rev[i] / rev[i - back] - 1) * 100 for i in range(r.N)]
        assert graded("fund-01", bars)[0] == "wrong", back
    # ... because the reports are NOT a fixed number of bars apart (CONTROL: on this company they never are for a year)
    at = [i for i, _v in r._reports(r._fig("TOTAL_REVENUE:FQ"))]
    assert len({b - a for a, b in zip(at, at[1:])}) > 4 and min(b - a for a, b in zip(at, at[1:])) >= 50
    # counting CHANGES of the carried figure is not counting reports: a quarter equal to the one before is a report too
    changes, col = [], []
    for i in range(r.N):
        if rev[i] is not None and (i == 0 or rev[i - 1] is None or rev[i] != rev[i - 1]):
            changes.append(rev[i])
        col.append((changes[-1] / changes[-5] - 1) * 100 if len(changes) >= 5 else None)
    assert col != r._growth(4, True) and graded("fund-01", col)[0] == "wrong"


def test_twelve_months_is_not_one_quarter_and_a_per_share_figure_is_not_carried_across_a_hole():
    r = bound()
    assert graded("fund-02", r.placed(r._fig("EARNINGS_PER_SHARE_DILUTED:FQ"), r.T))[0] == "wrong"
    shares = r.placed(r._fig("TOTAL_SHARES_OUTSTANDING:FQ"), r.T)
    fcf = r._fig("FREE_CASH_FLOW:TTM")
    papered = dict(fcf, points=[p for p in fcf["points"] if p["v"] is not None])       # the unknown report dropped: the older value carried
    across = [a / b if (a is not None and b) else None for a, b in zip(r.placed(papered, r.T), shares)]
    right = r.rule_fund03()[0][1]
    assert across != right and graded("fund-03", across)[0] == "wrong"
    assert next(i for i, v in enumerate(across) if v is not None) < next(i for i, v in enumerate(right) if v is not None)
    # book value per share with the first share count carried BACK to before it was reported
    first_count = next(v for v in shares if v is not None)
    equity = r.placed(r._fig("TOTAL_EQUITY:FQ"), r.T)
    backfilled = [None if e is None else e / (s or first_count) for e, s in zip(equity, shares)]
    assert graded("fund-04", backfilled)[0] == "wrong"
    # CONTROL: the two per-share lines are different lines
    assert r.rule_fund03()[0][1] != r.rule_fund04()[0][1]


# ── the wall ──

def test_the_analyst_estimate_is_refused_by_name_with_the_filed_figure_offered_and_nothing_built():
    case = PENDING["fund-05"]
    good = {"disposition": "unsupported", "reply": "Analyst estimates are not something UCT holds: company filings carry none. I can plot EPS as the company filed it instead."}
    assert G.grade_wall(case, good)["verdict"] == "right"
    assert G.grade_wall(case, {"disposition": "unsupported", "reply": "I can't build that."})["verdict"] == "wrong"              # names nothing
    assert G.grade_wall(case, {"disposition": "unsupported", "reply": "Analyst estimates are not available here."})["verdict"] == "wrong"   # offers nothing
    assert G.grade_wall(case, {"disposition": "answer", "reply": good["reply"]})["verdict"] == "wrong"                           # it did not refuse
    built = {"turn": "script", "script": {"pine": "//@version=5\nindicator('x')\nplot(close)\n"}, "reply": good["reply"]}
    assert G.grade_wall(case, built)["verdict"] == "wrong"                                                                       # a proxy was built


# ── on the script lane's own bars (node): the fingerprints, and what each case says its rule distinguishes ──

@pytest.fixture(scope="module")
def lane_chart():
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_lane
    try:
        run = script_lane.run([{"id": "bars", "source": '//@version=5\nindicator("bars")\nplot(close)\n', "chart": "daily"}])
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")
    return run["charts"]["daily"]


def test_each_fingerprint_is_its_rule_on_the_lanes_bars(lane_chart):
    from tools.value_cases import script_grade
    digests = script_grade.rule_digests([PENDING[cid] for cid in SCRIPT_IDS])
    assert {cid: PENDING[cid]["rule"]["digest"] for cid in SCRIPT_IDS} == digests and len(set(digests.values())) == 4


def test_what_each_case_says_its_rule_distinguishes_is_true(lane_chart):
    R.bind(lane_chart)
    n = R.N
    has = lambda col: sum(1 for v in col if v is not None)  # noqa: E731
    differ = lambda a, b: sum(1 for i in range(n) if (a[i] is None) != (b[i] is None) or (a[i] is not None and abs(a[i] - b[i]) > 1e-9))  # noqa: E731
    said = {cid: PENDING[cid]["distinguishes"] for cid in SCRIPT_IDS}
    yoy, qoq = R._growth(4, True), R._growth(1, True)
    rev = R.placed(R._fig("TOTAL_REVENUE:FQ"), R.T)
    bars_back = [None if (i < 252 or rev[i] is None or rev[i - 252] is None) else (rev[i] / rev[i - 252] - 1) * 100 for i in range(n)]
    assert f"the line has a value on {has(yoy):,} bars and is exactly 0 on {sum(1 for v in yoy if v == 0):,} of them" in said["fund-01"]
    assert f"against the quarter before, on {has(qoq):,} bars" in said["fund-01"]
    assert f"differs from the four-reports reading on {differ(yoy, bars_back):,} bars" in said["fund-01"] and differ(yoy, bars_back) > 50
    ttm = R.rule_fund02()[0][1]
    assert f"a value on {has(ttm):,} of {n:,} bars and nothing on the first {n - has(ttm):,}" in said["fund-02"] and n - has(ttm) > 100
    f3, f4 = R.rule_fund03()[0][1], R.rule_fund04()[0][1]
    assert f"a value on {has(f3):,} of {n:,} bars" in said["fund-03"] and has(f3) < has(f4)
    assert f"a value on {has(f4):,} of {n:,} bars and nothing on the first {n - has(f4):,}" in said["fund-04"]
