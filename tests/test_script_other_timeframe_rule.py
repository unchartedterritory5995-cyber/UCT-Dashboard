"""RULE 12 OF THE SCRIPT DOCUMENT: a value on another timeframe is read AS IT STANDS; a look-back goes INSIDE the
request, and only for "last week's".

Found by the value cases' oracle check, 2026-11-22. Asked whether the close is above "the 10 week moving average
and above the 10 month moving average", the assistant read each average one bar of the CHART back (`wMA[1]`
outside `request.security`). On the bar that completes a week the table showed the average one whole week stale:
113.56 where the 10 week average is 114.05; 120.29 where the 10 month average is 118.72.

`request-other` is not offered to the assistant and gains no wording here. The rule only stops a request the
member's words asked for being written wrongly, and each half teaches only what a committed capture grades
(`pine_authoring.OTHER_TIMEFRAME_RULE`'s comment names the capture and the rows).

Held here:
  * the document carries the rule, both halves, and still offers no `request` capability;
  * THE THREE WAYS TO WRITE IT, BY VALUE, ON EVERY BAR of the engine's built daily bars, through the member pane's
    own path, for the week and for the month: as it stands is the last FINISHED period's average on every bar
    (the finished period on its last bar, the one before until then); the look-back OUTSIDE and the look-back
    INSIDE with look-ahead on are each a whole period stale on every bar that completes a period, and right
    nowhere the first is not. So the rule cannot pass by teaching the other half for this request;
  * the look-back inside IS last period's value on every bar, which is what its half of the rule says it is for.

This file needs node and `app/node_modules` for the value tests; where they are missing those SKIP, and the lane
that runs this file treats a skip as a failure.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services import pine_authoring as pa
from api.services import pine_capabilities

HEAD = '//@version=5\nindicator("p")\n'
#: the three ways, each as one plot, for a timeframe code and a length
AS_IT_STANDS = HEAD + 'plot(request.security(syminfo.tickerid, "{tf}", ta.sma(close, 10)))\n'
LOOK_BACK_OUTSIDE = HEAD + 'x = request.security(syminfo.tickerid, "{tf}", ta.sma(close, 10))\nplot(x[1])\n'
LOOK_BACK_INSIDE = HEAD + 'plot(request.security(syminfo.tickerid, "{tf}", ta.sma(close, 10)[1], lookahead = barmerge.lookahead_on))\n'
FORMS = {"as it stands": AS_IT_STANDS, "look-back outside": LOOK_BACK_OUTSIDE, "look-back inside": LOOK_BACK_INSIDE}


# ── the document ──

def test_the_document_carries_the_rule_with_both_halves():
    doc = pa.document()
    assert "\n12. A value on ANOTHER TIMEFRAME, only when the member's words ask for one" in doc
    rule = doc.split("\n12. ")[1].split("\n")[0]
    assert rule == pa.OTHER_TIMEFRAME_RULE
    for piece in ('read it AS IT STANDS with `request.security(syminfo.tickerid, "W", expr)`, and put nothing after it',
                  "`x[1]` after a request is one bar of THIS chart, not one week",
                  "on the bar that completes a week it shows the week before",
                  "ONLY when the words say LAST week's or the PREVIOUS month's value, put the look-back INSIDE the request",
                  '`request.security(syminfo.tickerid, "W", expr[1], lookahead = barmerge.lookahead_on)`'):
        assert piece in rule, piece
    assert "{other_timeframe}" not in doc and doc.count(pa.OTHER_TIMEFRAME_RULE) == 1
    assert doc.index("\n11. Draw ONLY what the member asked for") < doc.index("\n12. ")


def test_the_rule_offers_nothing_request_other_stays_unoffered_and_unworded():
    assert pa.not_offered("request-other") and "request-other" not in pa.CAPABILITY_WORDS
    doc = pa.document()
    language = doc.split("LANGUAGE YOU MAY USE")[1].split("\n\n")[0]
    assert "request" not in language
    # what the rule shows IS a read of another timeframe, by the one detector
    for form in FORMS.values():
        assert "request-other" in pine_capabilities.capabilities_of(form.replace("{tf}", "W"))


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
def test_THE_LOOK_BACK_INSIDE_is_last_periods_value_on_every_bar_which_is_what_its_half_is_for(ran, tf):
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
