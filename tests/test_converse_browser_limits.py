"""Two more of the browser's rules, run at the door.

Both measured on production, 2026-11-17, in the second exploratory round as a member; both ended in
a red error ("Nothing was changed ...") for a request the assistant had built:

  A. "Three weeks tight" came back as a daily-bar condition with `set_calculation_timeframe W` and
     a marker. A calculation timeframe moves lines, not markers; the browser said "This indicator
     is always calculated on the chart's own timeframe".
  B. "A ribbon of EMAs 8, 13, 21, 34 and 55, green when stacked in order" came back as five lines,
     each colored by state. Every color rule costs a hidden column, so that is ten columns of the
     eight an indicator holds; the browser said "already has as many lines as it can hold".

Each is refused here with the way out, so the one repair builds it. Never stricter than the
browser: what it would accept still passes.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731
GATE = "envelope:reference"
ema = lambda n: call("ema", S("close"), num(n))  # noqa: E731
TIGHT = op("<=", op("/", op("-", call("highest", S("close"), num(3)), call("lowest", S("close"), num(3))),
                    call("lowest", S("close"), num(3))), num(0.015))
MARK = {"op": "set_marker", "output": "tight", "shape": "circle", "position": "aboveBar"}
WEEKLY = {"op": "set_calculation_timeframe", "timeframe": "W"}
CREATE_TIGHT = {"op": "create", "name": "Three Weeks Tight", "placement": "price",
                "outputs": [{"key": "tight", "tree": TIGHT}]}
STACKED = op("&&", op(">", ema(8), ema(13)), op(">", ema(13), ema(21)))
PERIODS = (8, 13, 21, 34, 55)
RIBBON = {"op": "create", "name": "EMA Ribbon", "placement": "price",
          "outputs": [{"key": f"ema{n}", "tree": ema(n)} for n in PERIODS]}
color = lambda key: {"op": "set_color_states", "output": key,  # noqa: E731
                     "states": [{"when": STACKED, "color": "#089981"}], "otherwise": "#787B86"}


def _ok(conv, ops, v=None, revision=0):
    return conv.check_envelope(env(revision, ops), revision, v if v is not None else empty_view(0))


def _refusal(conv, ops, v=None, revision=0):
    with pytest.raises(conv._Refused) as exc:
        _ok(conv, ops, v, revision)
    assert exc.value.gate == GATE
    return exc.value.detail


# ── A. a calculation timeframe on an indicator that draws a marker ───────────

def test_the_measured_weekly_marker_is_refused_with_the_way_out(conv):
    detail = _refusal(conv, [CREATE_TIGHT, WEEKLY, MARK])
    assert "draws a marker (tight)" in detail and "a calculation timeframe moves lines only" in detail
    assert "`tf` W / M nodes" in detail


def test_the_repair_builds_three_weeks_tight(conv, clean_env, model):
    wk = lambda node: {"type": "tf", "value": "W", "args": [node]}  # noqa: E731
    inside = op("<=", op("/", op("-", wk(call("highest", S("close"), num(3))), wk(call("lowest", S("close"), num(3)))),
                         wk(call("lowest", S("close"), num(3)))), num(0.015))
    good = env(0, [{"op": "create", "name": "Three Weeks Tight", "placement": "price",
                    "outputs": [{"key": "tight", "tree": inside}]}, MARK])
    client = model([emits(env(0, [CREATE_TIGHT, WEEKLY, MARK])), emits(good)])
    r = conv.converse("three weeks tight", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2
    assert r["usage"]["repair_gate"] == GATE


def test_a_calculation_timeframe_alone_or_a_marker_alone_still_passes(conv):
    line = {"op": "create", "name": "Weekly average", "placement": "price",
            "outputs": [{"key": "ma", "tree": call("sma", S("close"), num(10))}]}
    assert _ok(conv, [line, WEEKLY])                                         # lines move
    assert _ok(conv, [CREATE_TIGHT, MARK])                                   # a marker on the chart's own bars
    assert _ok(conv, [CREATE_TIGHT, MARK, WEEKLY, {"op": "set_calculation_timeframe", "timeframe": "chart"}])
    assert _ok(conv, [CREATE_TIGHT, MARK, {"op": "remove_marker", "output": "tight"}, WEEKLY])
    # a marker the VIEW already draws counts too
    row = out("tight", TIGHT, label="Tight")
    row["presentation"] = dict(row.get("presentation") or {}, marker={"shape": "circle", "position": "aboveBar"})
    assert "draws a marker (tight)" in _refusal(conv, [WEEKLY], view(1, [row]), revision=1)


# ── B. the column limit, hidden color columns counted ────────────────────────

def test_the_measured_ribbon_is_refused_with_the_arithmetic_and_the_way_out(conv):
    detail = _refusal(conv, [RIBBON] + [color(f"ema{n}") for n in PERIODS])
    assert f"needs 10 columns and an indicator holds {conv.MAX_OUTPUTS}" in detail
    assert "5 outputs" in detail and "(5 here)" in detail
    assert "color the candles or the background once" in detail


def test_the_repair_builds_the_ribbon(conv, clean_env, model):
    good = env(0, [RIBBON, {"op": "set_color_states", "channel": "barcolor",
                            "states": [{"when": STACKED, "color": "#089981"}], "otherwise": "#787B86"}])
    client = model([emits(env(0, [RIBBON] + [color(f"ema{n}") for n in PERIODS])), emits(good)])
    r = conv.converse("a ribbon of EMAs", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2


def test_what_fits_still_passes(conv):
    assert conv.MAX_OUTPUTS == 8
    assert _ok(conv, [RIBBON])                                               # five plain lines
    assert _ok(conv, [RIBBON] + [color(f"ema{n}") for n in (8, 13, 21)])     # 5 + 3 = 8, exactly the limit
    assert _ok(conv, [RIBBON, {"op": "set_color_states", "channel": "bgcolor",
                               "states": [{"when": STACKED, "color": "#089981"}], "otherwise": "#787B86"}])
    four = _refusal(conv, [RIBBON] + [color(f"ema{n}") for n in (8, 13, 21, 34)])
    assert "needs 9 columns" in four                                         # one past it


def test_a_background_or_candle_rule_costs_a_column_too(conv):
    eight = {"op": "create", "name": "Eight", "placement": "price",
             "outputs": [{"key": f"l{i}", "tree": ema(5 + i)} for i in range(8)]}
    assert _ok(conv, [eight])
    for channel in ("bgcolor", "barcolor"):
        states = {"op": "set_color_states", "channel": channel,
                  "states": [{"when": STACKED, "color": "#089981"}], "otherwise": "#787B86"}
        assert "needs 9 columns" in _refusal(conv, [eight, states]), channel


def test_replacing_a_color_rule_the_view_already_has_costs_nothing(conv):
    """Eight columns in the view, one of them the line's own hidden color column: re-coloring that
    line replaces the column, so the browser accepts it and so does this door."""
    rows = [out(f"l{i}", ema(5 + i), label=f"L{i}") for i in range(7)]
    helper = out("l0$states", STACKED, label="l0 colour rule")
    helper.update({"role": "helper-column", "of": "l0"})
    v = view(1, rows + [helper])
    assert _ok(conv, [dict(color("l0"))], v, revision=1)
    assert "needs 9 columns" in _refusal(conv, [dict(color("l1"))], v, revision=1)   # a NEW one does not fit


def test_the_instructions_say_both():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert f"An indicator holds {dcv.MAX_OUTPUTS} columns in all" in text
    assert "uses one HIDDEN column of its own" in text
    assert "color the candles or the background once" in text
    assert "set_calculation_timeframe moves LINES only" in text
    assert "written with `tf` W / M nodes inside the tree" in text


# ── C. a calculation timeframe on an indicator that reads another symbol ─────
#
# Found by replaying every recorded answer of the day against what the WINDOW showed: "Mansfield
# relative strength versus SPY over 52 weeks" had been reported fixed from the door's answer (a
# ratio against SPY with `set_calculation_timeframe W`), and the browser had refused it: "An
# indicator that reads another symbol is calculated on the chart's own timeframe".

SPY = lambda node: {"type": "sym", "value": "SPY", "args": [node]}  # noqa: E731
RATIO = op("/", S("close"), SPY(S("close")))
MANSFIELD = op("*", op("-", op("/", RATIO, call("sma", RATIO, num(52))), num(1)), num(100))
CREATE_RS = {"op": "create", "name": "Mansfield RS", "placement": "pane", "outputs": [{"key": "rs", "tree": MANSFIELD}]}


def test_the_measured_weekly_ratio_is_refused_with_the_way_out(conv):
    detail = _refusal(conv, [CREATE_RS, WEEKLY])
    assert "reads another symbol (rs)" in detail and "calculated on the chart's own timeframe" in detail
    assert "52 weeks is 252 daily bars" in detail and "sym(SPY, tf(close, W))" in detail


def test_the_repair_builds_mansfield_on_the_daily_count(conv, clean_env, model):
    daily = op("*", op("-", op("/", RATIO, call("sma", RATIO, num(252))), num(1)), num(100))
    good = env(0, [{"op": "create", "name": "Mansfield RS", "placement": "pane", "outputs": [{"key": "rs", "tree": daily}]}])
    client = model([emits(env(0, [CREATE_RS, WEEKLY])), emits(good)])
    r = conv.converse("Mansfield relative strength versus SPY over 52 weeks", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2
    assert r["usage"]["repair_gate"] == GATE


def test_another_symbol_without_a_calculation_timeframe_and_the_reverse_still_pass(conv):
    assert _ok(conv, [CREATE_RS])                                            # the ratio on the chart's own bars
    assert _ok(conv, [CREATE_RS, WEEKLY, {"op": "set_calculation_timeframe", "timeframe": "chart"}])
    line = {"op": "create", "name": "Weekly average", "placement": "price",
            "outputs": [{"key": "ma", "tree": call("sma", S("close"), num(10))}]}
    assert _ok(conv, [line, WEEKLY])                                         # no other symbol: lines move
    # an output of the VIEW that reads another symbol counts; one this answer removes does not
    v = view(1, [out("rs", RATIO, label="RS"), out("ma", call("sma", S("close"), num(10)), label="MA")])
    assert "reads another symbol (rs)" in _refusal(conv, [WEEKLY], v, revision=1)
    assert _ok(conv, [{"op": "remove_output", "output": "rs"}, WEEKLY], v, revision=1)


def test_the_instructions_say_an_other_symbol_indicator_takes_no_calculation_timeframe():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert "reads ANOTHER SYMBOL cannot take set_calculation_timeframe at all" in text
    assert "a 52-week average of a ratio against SPY is its 252-bar average" in text
