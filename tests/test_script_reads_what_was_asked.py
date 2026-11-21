"""A SCRIPT READS ANOTHER SYMBOL OR TIMEFRAME ONLY WHEN THE MEMBER ASKED FOR ONE.

Found by the value cases, 2026-11-22. `request-other` (a script that requests another symbol or timeframe) is
admitted for finished bars only and is NOT offered to the assistant, and the assistant wrote it anyway, from what
it knows of Pine. Asked on a DAILY chart for "yesterday's high" and "yesterday's low", it returned
`request.security(syminfo.tickerid, "D", high[1])`: a read the chart's own `high[1]` already is, carrying a limit
the member never asked to take on.

The rule (`pine_authoring.other_read_asked`), decided by reading THE SCRIPT'S OWN REQUESTS against the member's
words and the chart, never by the assistant:
  * a request for a ticker the member NAMED, or for a timeframe the member's words name, was asked for: KEPT;
  * a request for a ticker nobody named, or for the chart's own symbol on the chart's own timeframe, was not
    asked for: ONE repair, inside the turn's own call limit;
  * anything that cannot be read for certain is UNSURE and is KEPT. A silent rewrite that changes what the script
    means is worse than a limit the window already tells the member about.

Measured before it was written, over the 81 scripts recorded in the live rounds: 6 request something; 5 of those
were asked for by the member's words (a 10 week and a 10 month average; SPY, QQQ and IWM by name), 1 was not
(the case above), none was unsure; the 75 that request nothing have nothing to repair.

No paid calls: every model call is a scripted stub.
"""
from __future__ import annotations

import pytest

from api.services import pine_authoring as pa
from api.services import pine_capabilities
from api.services import script_conversation as sc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    _B, FakeClient, conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

DAILY = {"sym": "NVDA", "tf": "D"}
FIVE_MIN = {"sym": "NVDA", "tf": "5"}
ACCEPTS = ["note.by", "offer", "script"]
HEAD = '//@version=5\nindicator("x", overlay=true)\n'
YESTERDAY_WORDS = "Show a table with yesterday's high and yesterday's low"
#: what the assistant wrote live: the chart's own symbol on the chart's own timeframe
OWN_DAILY = HEAD + 'pdh = request.security(syminfo.tickerid, "D", high[1])\npdl = request.security(syminfo.tickerid, "D", low[1])\nplot(pdh)\nplot(pdl)\n'
WITHOUT = HEAD + "plot(high[1])\nplot(low[1])\n"
WEEKLY = HEAD + 'wLen = input.int(10, "Weeks")\nwMA = request.security(syminfo.tickerid, "W", ta.sma(close, wLen))\nplot(wMA)\n'
THREE_NAMED = (HEAD + 'sym1 = input.symbol("SPY", "First")\nsym2 = input.symbol("QQQ", "Second")\n'
               '[c1, m1] = request.security(sym1, "D", [close, ta.sma(close, 50)])\nc2 = request.security(sym2, timeframe.period, close)\nplot(c1 - c2)\n')


@pytest.fixture
def lane(monkeypatch):
    monkeypatch.setenv(sc.SCRIPT_ENABLED_ENV, "admin")


def writes(pine, *, reply="A table.", tokens=(900, 400)):
    answer = {"disposition": "script", "reply": reply, "name": "x", "pine": pine}
    return _B(content=[_B(type="tool_use", id="tu_s", name=sc.TOOL_NAME, input=answer)], stop_reason="tool_use",
              usage=_B(input_tokens=tokens[0], output_tokens=tokens[1]))


def turn(conv, words, chart=DAILY):
    """`script_turn` itself: the one function every script answer comes out of."""
    return sc.script_turn(words, user_id="u1", chart=chart, cap_usd=5.0, calls=[], revision=0, contract=conv.PATCH_CONTRACT)


def ask(conv, words, chart=DAILY):
    return conv.converse(words, user_id="u1", view=empty_view(0), chart=chart, admin=True, accepts=ACCEPTS)


# ── what a script requests, read from its own code ──

def test_every_request_of_a_script_is_read_with_what_it_names():
    assert pa.other_reads(OWN_DAILY) == [("syminfo.tickerid", "D"), ("syminfo.tickerid", "D")]
    assert pa.other_reads(WEEKLY) == [("syminfo.tickerid", "W")]
    assert pa.other_reads(THREE_NAMED) == [("SPY", "D"), ("QQQ", "timeframe.period")]        # a name is what it was given
    assert pa.other_reads(WITHOUT) == []
    assert pa.other_reads("") is None and pa.other_reads(None) is None


def test_CODE_NEVER_PROSE_a_request_named_in_a_comment_or_a_string_is_not_a_request():
    prose = HEAD + '// never use request.security(syminfo.tickerid, "W", close) here\nlabelText = "request.security(x, y, z) is not used"\nplot(close) // request.security("SPY", "D", close)\n'
    assert pa.other_reads(prose) == []
    assert pa.other_read_asked("plot the close", prose, DAILY) == (pa.OTHER_READ_ASKED, [])
    # CONTROL: the same call as code IS seen, and a `//` inside a string does not hide what follows it
    live = HEAD + 'u = "http://x"\nw = request.security(syminfo.tickerid, "W", close)\nplot(w)\n'
    assert pa.other_reads(live) == [("syminfo.tickerid", "W")]


def test_what_cannot_be_read_for_certain_is_not_guessed():
    twice = HEAD + 's = "SPY"\ns := "QQQ"\nplot(request.security(s, "D", close))\n'
    built = HEAD + 'plot(request.security(syminfo.prefix + ":" + "SPY", "D", close))\n'
    never = HEAD + 'plot(request.security(other, "D", close))\n'
    for script in (twice, built, never):
        assert pa.other_reads(script) == [(None, "D")], script
        assert pa.other_read_asked("compare with SPY", script, DAILY) == (pa.OTHER_READ_UNSURE, [])


# ── asked for, not asked for, unsure ──

@pytest.mark.parametrize("words,script,chart,want,unasked", [
    # THE FINDING: the chart's own symbol on the chart's own timeframe
    (YESTERDAY_WORDS, OWN_DAILY, DAILY, pa.OTHER_READ_NOT_ASKED, ["the chart's own symbol on the chart's own timeframe"]),
    ("plot the close", HEAD + "plot(request.security(syminfo.tickerid, timeframe.period, close))\n", DAILY, pa.OTHER_READ_NOT_ASKED,
     ["the chart's own symbol on the chart's own timeframe"]),
    # a timeframe the member's words name
    ("Plot the 10 week moving average on the daily chart", WEEKLY, DAILY, pa.OTHER_READ_ASKED, []),
    ("Plot last month's high", HEAD + 'plot(request.security(syminfo.tickerid, "M", high[1]))\n', DAILY, pa.OTHER_READ_ASKED, []),
    (YESTERDAY_WORDS, OWN_DAILY, FIVE_MIN, pa.OTHER_READ_ASKED, []),                       # on a 5 minute chart, yesterday IS another timeframe
    ("Plot the hourly close under the chart", HEAD + 'plot(request.security(syminfo.tickerid, "60", close))\n', DAILY, pa.OTHER_READ_ASKED, []),
    # tickers the member named, as whole words, any case
    ("Plot SPY against qqq", THREE_NAMED, DAILY, pa.OTHER_READ_ASKED, []),
    # a ticker nobody named
    ("Plot the close against SPY", THREE_NAMED, DAILY, pa.OTHER_READ_NOT_ASKED, ["the symbol QQQ"]),
    ("Plot a moving average", THREE_NAMED, DAILY, pa.OTHER_READ_NOT_ASKED, ["the symbol QQQ", "the symbol SPY"]),
    ("Plot my SPYDER count", HEAD + 'plot(request.security("SPY", "D", close))\n', DAILY, pa.OTHER_READ_NOT_ASKED, ["the symbol SPY"]),   # a whole word, never a part of one
    # another timeframe nobody named: UNSURE, so kept
    ("Plot a smooth average", WEEKLY, DAILY, pa.OTHER_READ_UNSURE, []),
    ("Plot a smooth average", OWN_DAILY, FIVE_MIN, pa.OTHER_READ_UNSURE, []),
    # a chart this cannot place: unsure
    (YESTERDAY_WORDS, OWN_DAILY, None, pa.OTHER_READ_UNSURE, []),
    (YESTERDAY_WORDS, OWN_DAILY, {"sym": "NVDA", "tf": "3D"}, pa.OTHER_READ_UNSURE, []),
    # nothing requested: nothing to repair
    ("anything at all", WITHOUT, DAILY, pa.OTHER_READ_ASKED, []),
])
def test_a_request_is_asked_for_not_asked_for_or_unsure(words, script, chart, want, unasked):
    assert pa.other_read_asked(words, script, chart) == (want, unasked)


def test_one_unsure_request_keeps_the_whole_script():
    mixed = HEAD + 'a = request.security("QQQ", "D", close)\nb = request.security(mystery, "D", close)\nplot(a - b)\n'
    assert pa.other_read_asked("plot the close", mixed, DAILY) == (pa.OTHER_READ_UNSURE, [])


def test_the_chart_s_own_ticker_written_out_is_the_chart_s_own_symbol():
    named = HEAD + 'plot(request.security("NASDAQ:NVDA", "D", close))\n'
    assert pa.other_read_asked("plot the close", named, DAILY)[0] == pa.OTHER_READ_NOT_ASKED
    assert pa.other_read_asked("plot the close", named, {"sym": "AAPL", "tf": "D"}) == (pa.OTHER_READ_NOT_ASKED, ["the symbol NVDA"])


def test_the_rule_reads_exactly_the_scripts_the_detector_calls_request_other():
    for script in (OWN_DAILY, WEEKLY, THREE_NAMED):
        assert "request-other" in pine_capabilities.capabilities_of(script) and pa.other_reads(script)
        assert pa.not_offered("request-other")
    assert "request-other" not in pine_capabilities.capabilities_of(WITHOUT) and pa.other_reads(WITHOUT) == []


# ── the turn: one repair, inside the call limit ──

def test_THE_FINDING_a_read_nobody_asked_for_is_sent_back_once_and_the_rewrite_is_the_answer(conv, clean_env, model, lane):
    client = model([writes(OWN_DAILY), writes(WITHOUT, reply="A table of yesterday's high and low.")])
    r = ask(conv, YESTERDAY_WORDS)
    assert r["ok"] is True and len(client.calls) == 2 and r["attempts"] == 2
    assert r["script"]["pine"] == WITHOUT and r["script"]["waits_for_the_bar"] is False
    back = client.calls[1]["messages"]
    assert back[-2]["content"][0]["input"]["pine"] == OWN_DAILY                        # the assistant sees what it wrote
    told = back[-1]["content"][0]
    assert told["is_error"] is True and told["content"].startswith("[script:not-asked] ")
    for piece in ("the chart's own symbol on the chart's own timeframe", "did not ask for another symbol or timeframe",
                  "Return the WHOLE script without `request.security`", "that is the prior day", "Change nothing else about what it computes"):
        assert piece in told["content"], piece


def test_a_checked_recipe_is_never_sent_back_for_its_own_read(conv, clean_env, model, lane):
    """Found by the door lane before this merged: `prior-day-levels`, one of UCT's own checked recipes, reads the
    daily bar through a request, and on a daily chart that is "the chart's own timeframe". It is the checked
    answer to these words and is right; a repair would trade it for an unchecked rewrite."""
    recipe = next(r for r in pa.recipes() if r["id"] == "prior-day-levels")
    words = "Add " + recipe["asks"][0]
    assert pa.other_read_asked(words, recipe["source"], DAILY)[0] == pa.OTHER_READ_NOT_ASKED      # the rule alone WOULD send it back
    assert pa.backed_by(words, recipe["source"]) == "prior-day-levels"
    client = model([writes(recipe["source"], reply="Yesterday's levels.")])
    r = turn(conv, words)
    assert r["ok"] is True and len(client.calls) == 1
    assert r["script"]["pine"] == recipe["source"] and r["script"]["reference"] == "prior-day-levels"
    # CONTROL: the same read in a script that is NOT the recipe is still sent back (the finding)
    assert pa.backed_by(YESTERDAY_WORDS, OWN_DAILY) is None
    client = model([writes(OWN_DAILY), writes(WITHOUT)])
    assert len(client.calls) == 0 and ask(conv, YESTERDAY_WORDS)["attempts"] == 2


def test_no_recipe_of_UCT_s_own_is_sent_back_on_any_chart_it_is_asked_on(conv, clean_env, model, lane):
    """Every recipe, asked for by its own words, on a daily and on a 5 minute chart: one call, the recipe kept."""
    judged = 0
    for recipe in pa.recipes():
        for chart in (DAILY, FIVE_MIN):
            client = model([writes(recipe["source"])])
            r = turn(conv, "Add " + recipe["asks"][0], chart)
            assert r["ok"] is True and len(client.calls) == 1, (recipe["id"], chart["tf"], r.get("gate"))
            judged += 1
    assert judged == 2 * len(pa.recipes()) and judged >= 20


def test_a_read_the_member_asked_for_is_kept_with_no_second_call(conv, clean_env, model, lane):
    client = model([writes(WEEKLY)])
    r = ask(conv, "Show a table with the 10 week moving average")
    assert r["ok"] is True and len(client.calls) == 1 and r["script"]["pine"] == WEEKLY
    assert r["script"]["waits_for_the_bar"] is True                 # the FACT still rides the answer: the window says what it means


def test_an_unsure_read_is_kept_with_no_second_call(conv, clean_env, model, lane):
    client = model([writes(WEEKLY)])
    r = ask(conv, "Show a table with a smooth average")
    assert r["ok"] is True and len(client.calls) == 1 and r["script"]["pine"] == WEEKLY


def test_a_second_answer_that_still_reads_it_is_kept_never_refused(conv, clean_env, model, lane):
    client = model([writes(OWN_DAILY), writes(OWN_DAILY)])
    r = ask(conv, YESTERDAY_WORDS)
    assert r["ok"] is True and len(client.calls) == sc.MAX_SCRIPT_CALLS and r["script"]["pine"] == OWN_DAILY
    assert r["script"]["waits_for_the_bar"] is True


def test_the_repair_is_one_and_shares_the_turns_call_limit(conv, clean_env, model, lane):
    # the shape repair spent the second call: a read nobody asked for is then kept, with no third call
    wrong_shape = OWN_DAILY.replace("version=5", "version=6")
    client = model([writes(wrong_shape), writes(OWN_DAILY)])
    r = ask(conv, YESTERDAY_WORDS)
    assert r["ok"] is True and len(client.calls) == sc.MAX_SCRIPT_CALLS == 2 and r["script"]["pine"] == OWN_DAILY
    # and a rewrite of the wrong shape after the repair is not offered at all (the limit is the limit)
    client = model([writes(OWN_DAILY), writes(WITHOUT.replace("version=5", "version=6"))])
    r = ask(conv, YESTERDAY_WORDS)
    assert r["ok"] is False and r["gate"] == sc.SHAPE_GATE and len(client.calls) == 2


def test_a_script_with_no_request_is_never_sent_back(conv, clean_env, model, lane):
    client = model([writes(WITHOUT)])
    r = ask(conv, YESTERDAY_WORDS)
    assert r["ok"] is True and len(client.calls) == 1 and r["script"]["pine"] == WITHOUT


def test_the_repair_says_which_bar_the_chart_s_own_read_is():
    assert "that is the prior day" in pa.other_read_repair(["x"], DAILY)
    assert "that is the prior week" in pa.other_read_repair(["x"], {"sym": "A", "tf": "W"})
    assert "that is the prior bar" in pa.other_read_repair(["x"], FIVE_MIN)
    assert "reads the symbol QQQ and the symbol SPY with" in pa.other_read_repair(["the symbol QQQ", "the symbol SPY"], DAILY)


# ── the repair changes the capability, never the numbers (held by value, through the member pane's own path) ──

def _lane_run(jobs):
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_lane
    try:
        return script_lane.run(jobs)
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")


def test_THE_REWRITE_IS_RIGHT_BY_VALUE_on_every_bar_and_has_no_value_where_there_is_no_yesterday():
    """Yesterday's high and low, written without the request, on the engine's built daily bars: each bar holds the
    bar before's high and low, and the FIRST bar, which has no yesterday, holds NO VALUE (never a 0)."""
    run = _lane_run([{"id": "rewrite", "source": WITHOUT, "chart": "daily"}, {"id": "requested", "source": OWN_DAILY, "chart": "daily"}])
    bars = run["charts"]["daily"]["bars"]
    rewrite, requested = run["scripts"]["rewrite"], run["scripts"]["requested"]
    assert rewrite["ok"] and not rewrite["errors"], rewrite
    highs, lows = rewrite["columns"]["value"], rewrite["columns"]["out2"]
    assert len(highs) == len(bars) > 1000
    assert highs[0] is None and lows[0] is None                                   # no yesterday on the first bar
    for i in range(1, len(bars)):
        assert highs[i] == pytest.approx(bars[i - 1]["h"], rel=1e-12) and lows[i] == pytest.approx(bars[i - 1]["l"], rel=1e-12), i
    # and it is NOT this bar's own high and low (a rewrite that dropped the look-back would be)
    assert sum(1 for i in range(1, len(bars)) if highs[i] != bars[i]["h"]) > len(bars) * 0.9
    # THE REPAIR CHANGES NO NUMBER: what the assistant first wrote, with the request, says the same on every bar
    # both have a value (on a daily chart the daily read of the bar before IS the bar before)
    assert requested["ok"], requested
    both = [i for i in range(len(bars)) if requested["columns"]["value"][i] is not None and highs[i] is not None]
    assert len(both) > len(bars) - 5
    assert all(requested["columns"]["value"][i] == pytest.approx(highs[i], rel=1e-12)
               and requested["columns"]["out2"][i] == pytest.approx(lows[i], rel=1e-12) for i in both)


def test_CONTROL_on_a_five_minute_chart_yesterday_is_another_timeframe_and_the_script_is_kept(conv, clean_env, model, lane):
    client = model([writes(OWN_DAILY)])
    r = ask(conv, YESTERDAY_WORDS, chart=FIVE_MIN)
    assert pa.other_read_asked(YESTERDAY_WORDS, OWN_DAILY, FIVE_MIN) == (pa.OTHER_READ_ASKED, [])
    assert r["ok"] is True and len(client.calls) == 1 and r["script"]["pine"] == OWN_DAILY          # asked for, kept, no second call
    assert r["script"]["waits_for_the_bar"] is True


def test_the_repair_is_ONE_even_when_the_turn_could_afford_more(conv, clean_env, model, lane, monkeypatch):
    """⚰️ The deliberate break "the repair may be sent twice" was NOT RED on its first run: with two calls a turn the
    call limit alone stops a second repair, so the one-repair guard could not be shown to hold anything. With a
    third call allowed, a second answer that still reads what nobody asked for must be KEPT, not sent back again."""
    monkeypatch.setattr(sc, "MAX_SCRIPT_CALLS", 3)
    client = model([writes(OWN_DAILY), writes(OWN_DAILY), writes(WITHOUT)])
    r = ask(conv, YESTERDAY_WORDS)
    assert r["ok"] is True and len(client.calls) == 2 and r["script"]["pine"] == OWN_DAILY
    # CONTROL: the third call IS there to be had (a shape repair after the one repair still gets it)
    client = model([writes(OWN_DAILY), writes(WITHOUT.replace("version=5", "version=6")), writes(WITHOUT)])
    r = ask(conv, YESTERDAY_WORDS)
    assert r["ok"] is True and len(client.calls) == 3 and r["script"]["pine"] == WITHOUT
