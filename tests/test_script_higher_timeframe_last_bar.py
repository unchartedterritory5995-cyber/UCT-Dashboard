"""A WEEKLY OR MONTHLY VALUE ON A DAILY CHART: what each way of writing it shows, by value, and what the script
document says about it.

HISTORY. On 2026-11-22 the script document gained a rule 12 ("read it AS IT STANDS ... a look-back goes INSIDE the
request, and only for last week's"), with a condition: the value case `j06` ("a table that says whether the close is
above the 10 week and the 10 month moving average"), re-recorded live with the rule served, must be RIGHT. It was
not. Measured from recorded answers only: the rule changed that script's FORM (`wMA[1]` after the request became the
look-back inside it) and not its VALUE (the same two numbers on the newest bar, 113.56 and 120.29, where the averages
are 114.05 and 118.72), and it made no value case right. The rule is REMOVED.

The cause is not wording. The engine serves no "as it stands" value of a FORMING higher-timeframe bar (G6): written
as it stands, a last-bar table is right once the newest bar has finished and EMPTY all session; written one bar
back, it has a value all session (the last finished period) and is one period stale on the bar that completes a
week or month. No sentence makes a last-bar table right in both states. `j06` stays recorded WRONG and is an
acceptance case of the engine unit that serves the forming higher-timeframe value.

Held here:
  * the rule is gone and the rules after it moved up one number;
  * THE LIMIT LINE IS TRUE. The document's way through ("that value ONE BAR BACK ... DOES have a value on the newest
    bar") used to say it "is the last finished week or month". On the bar that completes one it is the period
    BEFORE. The line says so now, and tells the assistant to tell the member;
  * THE THREE WAYS TO WRITE IT, BY VALUE, ON EVERY BAR of the engine's built daily bars, through the member pane's
    own path, for the week and for the month (unchanged from the rule's own tests: they are facts about the engine,
    and they are what the line above is true by);
  * the record: `j06` names the engine wall; `i01`'s rule no longer asks for more than its words do;
  * WHAT THE MEASUREMENT COULD NOT SEE: no recorded script PLOTS a weekly value, so whether a script plot of another
    timeframe comes out right was never tested. The pending case `weekly-plot-01` asks exactly that, words and rule
    first; its label rule is held to the line the script itself plots, with controls.

This file needs node and `app/node_modules` for the value tests; where they are missing those SKIP, and the lane
that runs this file treats a skip as a failure.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from api.services import pine_authoring as pa
from api.services import pine_capabilities

ROOT = Path(__file__).resolve().parents[1]

HEAD = '//@version=5\nindicator("p")\n'
#: the three ways, each as one plot, for a timeframe code and a length
AS_IT_STANDS = HEAD + 'plot(request.security(syminfo.tickerid, "{tf}", ta.sma(close, 10)))\n'
LOOK_BACK_OUTSIDE = HEAD + 'x = request.security(syminfo.tickerid, "{tf}", ta.sma(close, 10))\nplot(x[1])\n'
LOOK_BACK_INSIDE = HEAD + 'plot(request.security(syminfo.tickerid, "{tf}", ta.sma(close, 10)[1], lookahead = barmerge.lookahead_on))\n'
FORMS = {"as it stands": AS_IT_STANDS, "look-back outside": LOOK_BACK_OUTSIDE, "look-back inside": LOOK_BACK_INSIDE}


# ── the document ──

def test_rule_12_is_gone_and_the_rules_after_it_moved_up():
    doc = pa.document()
    assert not hasattr(pa, "OTHER_TIMEFRAME_RULE") and "{other_timeframe}" not in doc
    assert "AS IT STANDS with `request.security" not in doc and "put the look-back INSIDE the request" not in doc
    assert doc.split("\n12. ")[1].split("\n")[0] == pa.NUMBER_ON_BARS_RULE
    assert doc.split("\n13. ")[1].split("\n")[0] == pa.PERCENT_FORMAT_RULE
    assert doc.index("\n11. Draw ONLY what the member asked for") < doc.index("\n12. ") < doc.index("\n13. ")


def test_reading_another_timeframe_stays_unoffered_and_unworded():
    assert pa.not_offered("request-other") and "request-other" not in pa.CAPABILITY_WORDS
    doc = pa.document()
    language = doc.split("LANGUAGE YOU MAY USE")[1].split("\n\n")[0]
    assert "request" not in language
    # each of the three ways IS a read of another timeframe, by the one detector
    for form in FORMS.values():
        assert "request-other" in pine_capabilities.capabilities_of(form.replace("{tf}", "W"))


def test_THE_LIMIT_LINE_says_what_one_bar_back_really_is():
    limit, way = pa.RUN_STOP_RELIEFS["higher-timeframe-one-bar-back"]
    assert limit == "higher-timeframe-newest-bar"
    for piece in ("that value ONE BAR BACK, `x[1]` read alone", "DOES have a value on the newest bar",
                  "it is the last finished week or month, except on the bar that completes one, where it is the period before",
                  "say in `reply` that it shows the last finished period and moves when the next one starts"):
        assert piece in way, piece
    # (that it is TRUE is the by-value test below: one bar back is a period stale on exactly the bars that complete one)


# ── the record ──

CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
BY_ID = {c["id"]: c for c in CASES["cases"]}
PENDING = {c["id"]: c for c in CASES.get("pending") or []}


def test_j06_stays_WRONG_and_names_the_engine_wall():
    case = BY_ID["j06"]
    assert case["recorded_verdict"] == "wrong"
    for piece in ("THE ENGINE SERVES NO \"AS IT STANDS\" VALUE OF A FORMING HIGHER-TIMEFRAME BAR (G6)", "one period stale",
                  "EMPTY all session", "an acceptance case of the engine unit that serves the forming higher-timeframe value"):
        assert piece in case["defect"], piece
    assert "nothing tells the assistant where a look-back goes" not in case["defect"]        # the old, wrong cause


def _bound():
    from tools.value_cases import script_rules
    from tools.value_cases.market import STOCK
    script_rules.bind({"bars": STOCK})
    return script_rules


def _checked(sid, run):
    rules = _bound()
    del rules._LINES[:]
    return rules.check_drawn(sid, run), list(rules._LINES)


def test_i01_asks_for_the_latest_value_of_the_PERCENT_and_no_more():
    rules = _bound()
    want = rules.drawn_rules("i01")["numbers"]
    assert [what for what, _values in want] == ["ATR as a percent of the close on the newest bar"]
    percent = want[0][1][0]
    # by hand, independently of the rule: the 14 bar simple average of the true range over the close, in percent
    tr = [rules.H[i] - rules.L[i] if i == 0 else max(rules.H[i] - rules.L[i], abs(rules.H[i] - rules.C[i - 1]), abs(rules.L[i] - rules.C[i - 1]))
          for i in range(rules.N)]
    simple = sum(tr[-14:]) / 14 / rules.C[rules.LAST] * 100
    assert any(abs(v - simple) < 1e-9 for v in want[0][1]), (want[0][1], simple)
    table = lambda *cells: {"drawn": {"tables": [{"position": "top_right", "grid": [list(cells)]}], "labels": []}, "columns": {}}  # noqa: E731
    # the live answer of 2026-11-22: one row, the percent only
    assert _checked("i01", table("ATR 14 %", f"{percent:.2f}%"))[0] is True
    # CONTROLS: the dollars alone, another percent, or no table, are all still wrong
    dollars = percent * rules.C[rules.LAST] / 100
    assert abs(dollars - percent) > 0.05
    assert _checked("i01", table("ATR 14", f"{dollars:.4f}"))[0] is False
    assert _checked("i01", table("ATR 14 %", f"{percent + 0.37:.2f}%"))[0] is False
    assert _checked("i01", {"drawn": {"tables": [], "labels": []}, "columns": {}})[0] is False
    history = BY_ID["i01"]["rule"]["history"]
    assert len(history) == 2 and history[-1]["digest"] == BY_ID["i01"]["rule"]["digest"] != history[0]["digest"]
    assert history[-1]["reason"].startswith("corrected on review 11-22: the words ask for the latest value of the percent only")
    assert history[-1]["quote"] == "show its latest value"


def test_the_pending_case_plots_a_weekly_value_words_and_rule_first():
    case = PENDING["weekly-plot-01"]
    assert case["lane"] == "script" and case["chart"] == "daily" and "answer" not in case and "recorded" not in case
    assert case["words"] == ("Plot the 10 week simple moving average of the weekly close on my daily chart, and put a label with the "
                             "text Cross on each bar where the close crosses above it")
    assert len(case["rule"]["history"]) == 1 and case["rule"]["digest"] == case["rule"]["history"][0]["digest"]
    rules = _bound()
    assert rules.has_rule("weekly-plot-01") and rules.RULES["weekly-plot-01"] is rules.rule_j02
    assert rules.ASKED["weekly-plot-01"] == {"plot", "label"}
    readings = rules.RULES["weekly-plot-01"]()
    assert len(readings) >= 2                                                    # every honest reading of a weekly value on a daily bar
    cols = [col for _name, col, _group in readings]
    assert any(sum(1 for x, y in zip(cols[0], other) if x is not None and y is not None and abs(x - y) > 1e-9) > 100 for other in cols[1:])


def _crosses(rules, col):
    return [rules.T[i] for i in range(1, rules.N) if col[i] is not None and col[i - 1] is not None and rules.C[i] > col[i] and rules.C[i - 1] <= col[i - 1]]


def test_the_labels_are_held_to_the_line_the_script_itself_plots():
    rules = _bound()
    line = rules.RULES["weekly-plot-01"]()[0][1]
    days = _crosses(rules, line)
    assert len(days) > 20
    labels = lambda ds, text="Cross": [{"x": d, "text": text} for d in ds]  # noqa: E731
    run = lambda ls, col=line: {"drawn": {"tables": [], "labels": ls}, "columns": {"value": col}}  # noqa: E731
    assert _checked("weekly-plot-01", run(labels(days)))[0] is True
    assert _checked("weekly-plot-01", run(labels(days[-12:])))[0] is True               # the chart keeps only the newest labels
    # WRONG: a cross missing, a label on a bar that is no cross, another text, no label at all, the crosses of ANOTHER line
    assert _checked("weekly-plot-01", run(labels(days[:5] + days[6:])))[0] is False
    stray = next(t for t in rules.T[400:] if t not in days)
    assert _checked("weekly-plot-01", run(labels(sorted(days + [stray]))))[0] is False
    assert _checked("weekly-plot-01", run(labels(days, "X")))[0] is False
    assert _checked("weekly-plot-01", run([]))[0] is False
    daily = [None if i < 49 else sum(rules.C[i - 49:i + 1]) / 50 for i in range(rules.N)]
    other = _crosses(rules, daily)
    assert other != days and _checked("weekly-plot-01", run(labels(other)))[0] is False


# ── by value, on every bar ──

def _lane_run(jobs):
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_lane
    try:
        return script_lane.run(jobs)
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")


@pytest.fixture(scope="module")
def ran():
    jobs = [{"id": f"{tf}-{name.replace(' ', '-')}", "source": form.replace("{tf}", tf), "chart": "daily"} for tf in ("W", "M") for name, form in FORMS.items()]
    run = _lane_run(jobs)
    bars = run["charts"]["daily"]["bars"]
    return bars, {job["id"]: run["scripts"][job["id"]] for job in jobs}


def _periods(bars, tf):
    """Each bar's period index, each period's last close, and whether a bar COMPLETES its period (its last bar here)."""
    def key(day):
        d = dt.date.fromisoformat(day)
        return (d - dt.timedelta(days=d.weekday())).isoformat() if tf == "W" else day[:7]
    order, idx = [], []
    for b in bars:
        k = key(str(b["t"])[:10])
        if not order or order[-1] != k:
            order.append(k)
        idx.append(len(order) - 1)
    n = len(bars)
    close = [[bars[i]["c"] for i in range(n) if idx[i] == p][-1] for p in range(len(order))]
    completes = [i == n - 1 or idx[i + 1] != idx[i] for i in range(n)]
    return idx, close, completes


def _by_hand(bars, tf):
    """On every bar: the 10 period average of the last FINISHED period (the finished period on its last bar, the one
    before until then), the one of the period BEFORE this bar's own (held all period), and the average as it stands
    with this period's latest close."""
    idx, close, completes = _periods(bars, tf)
    sma = lambda p: sum(close[p - 9:p + 1]) / 10 if p >= 9 else None  # noqa: E731
    finished = [sma(idx[i] if completes[i] else idx[i] - 1) for i in range(len(bars))]
    before = [sma(idx[i] - 1) for i in range(len(bars))]
    stands = [(sum(close[idx[i] - 9:idx[i]]) + bars[i]["c"]) / 10 if idx[i] >= 9 else None for i in range(len(bars))]
    return finished, before, stands, completes


def _differ(col, want, start):
    return [i for i in range(start, len(col)) if col[i] is not None and want[i] is not None and abs(col[i] - want[i]) > 1e-9 * max(1.0, abs(want[i]))]


def _compared(col, want, start):
    return sum(1 for i in range(start, len(col)) if col[i] is not None and want[i] is not None)


@pytest.mark.parametrize("tf", ["W", "M"])
def test_AS_IT_STANDS_is_the_last_finished_periods_average_on_EVERY_bar(ran, tf):
    bars, runs = ran
    finished, _before, _stands, completes = _by_hand(bars, tf)
    start = 320                                                       # past ten whole months of bars
    got = runs[f"{tf}-as-it-stands"]
    assert got["ok"] and not got["errors"], got
    col = got["columns"]["value"]
    assert _differ(col, finished, start) == []
    assert _compared(col, finished, start) > len(bars) - start - 5       # every bar, not a handful
    # the bars that COMPLETE a period are compared too, and mid-period bars as well (both kinds are in the count)
    assert sum(1 for i in range(start, len(bars)) if completes[i] and col[i] is not None) > (300 if tf == "W" else 70)
    assert sum(1 for i in range(start, len(bars)) if not completes[i] and col[i] is not None) > 1000


@pytest.mark.parametrize("tf", ["W", "M"])
@pytest.mark.parametrize("form", ["look-back outside", "look-back inside"])
def test_A_LOOK_BACK_is_a_period_stale_on_every_bar_that_completes_a_period_and_right_only_between(ran, tf, form):
    bars, runs = ran
    finished, before, stands, completes = _by_hand(bars, tf)
    start = 320
    got = runs[f"{tf}-{form.replace(' ', '-')}"]
    assert got["ok"] and not got["errors"], got
    col = got["columns"]["value"]
    wrong = _differ(col, finished, start)
    closing = [i for i in range(start, len(bars)) if completes[i] and col[i] is not None]
    # WRONG exactly where a bar completes its period (bar the rare period whose average did not move) ...
    assert set(wrong) <= set(closing)
    assert len(wrong) >= len(closing) - 3 and len(wrong) > (300 if tf == "W" else 70)
    # ... where it is the average of the period BEFORE: a whole period stale
    assert all(abs(col[i] - before[i]) <= 1e-9 * max(1.0, abs(before[i])) for i in wrong)
    # and it is not the average "as it stands" either: neither honest reading of the request
    assert len(_differ(col, stands, start)) > len(bars) // 2
    # CONTROL: between period ends it IS the last finished period's (which is why it looks right on most days)
    assert _compared(col, finished, start) - len(wrong) > 1000


@pytest.mark.parametrize("tf", ["W", "M"])
def test_THE_LOOK_BACK_INSIDE_is_last_periods_value_on_every_bar(ran, tf):
    bars, runs = ran
    _finished, before, _stands, _completes = _by_hand(bars, tf)
    col = runs[f"{tf}-look-back-inside"]["columns"]["value"]
    assert _differ(col, before, 320) == [] and _compared(col, before, 320) > len(bars) - 330


def test_the_newest_bar_completes_its_week_and_its_month_where_the_forms_part(ran):
    bars, runs = ran
    last = dt.date.fromisoformat(str(bars[-1]["t"])[:10])
    assert last.weekday() == 4 and (last + dt.timedelta(days=3)).month != last.month
    for tf in ("W", "M"):
        finished, before, _stands, _completes = _by_hand(bars, tf)
        assert abs(finished[-1] - before[-1]) > 0.1                    # the two numbers are far apart here
        assert runs[f"{tf}-as-it-stands"]["columns"]["value"][-1] == pytest.approx(finished[-1], rel=1e-12)
        assert runs[f"{tf}-look-back-outside"]["columns"]["value"][-1] == pytest.approx(before[-1], rel=1e-12)
        assert runs[f"{tf}-look-back-inside"]["columns"]["value"][-1] == pytest.approx(before[-1], rel=1e-12)
