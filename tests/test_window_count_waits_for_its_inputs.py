"""A COUNT OVER A WINDOW OF A CONDITION HAS NO VALUE UNTIL WHAT THE CONDITION READS EXISTS ON THE WINDOW'S OLDEST BAR.

Found by a value check of a live round, 2026-11-21. Asked for "the percent of the last 50 days the close was
above its own 20 day average", the assistant built a sum of 1s and 0s over 50 bars. A comparison with a value
that does not exist yet is FALSE here (and in the script language the paste door agrees with), so on the bars
where the average had no value the sum added a 0 and the line showed a NUMBER for something not known.

On a long chart that is a few of its oldest bars. On a symbol with less history than the average needs it is
EVERY bar: "days of the last 20 above the 200 day average" on a 150-bar history reads 0 on the newest bar,
although no 200 day average exists anywhere. A confident zero.

The instructions now say the count has no value until the thing the condition reads has one on the window's
oldest bar, and give the form: ``na(offset N - 1 of X) ? 0 / 0 : <the count>``.

What is held here, with the engine's own interpreter and a plain calculation:
  * AS BUILT, the count has a value where the plain calculation has none, and reads 0 on a young symbol;
  * GUARDED, it has a value on exactly the bars the plain calculation has one, and equals it there;
  * the cause is the COMPARISON (false against a missing value), not the window sum;
  * the door accepts the guarded form as built;
  * the instruction's sentences.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import math

from api.services import ast_interpret
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CLOSE = {"type": "series", "name": "close"}
num = lambda v: {"type": "num", "value": v}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
back = lambda node, k: {"type": "offset", "value": k, "args": [node]}  # noqa: E731
NO_VALUE = op("/", num(0), num(0))


def average(n):
    return call("sma", CLOSE, num(n))


def count_above(avg_bars, window):
    """The count as the assistant built it: 1 for a bar that closed above its average, summed over the window."""
    return call("sum", op("?:", op(">", CLOSE, average(avg_bars)), num(1), num(0)), num(window))


def guarded(avg_bars, window):
    """The form the instructions give: no value until the average exists on the window's oldest bar."""
    return op("?:", call("na", back(average(avg_bars), window - 1)), NO_VALUE, count_above(avg_bars, window))


def market(n):
    """Made-up daily closes that cross their own averages often."""
    out = []
    for i in range(n):
        c = 100 + 12 * math.sin(i / 7.0) + 5 * math.sin(i / 2.3) + i * 0.02
        out.append({"t": 1_700_000_000 + i * 86400, "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1_000_000.0})
    return out


def run(tree, bars):
    got = ast_interpret.interpret(tree, bars)
    return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else float(x) for x in got]


def by_hand(bars, avg_bars, window):
    """The count where EVERY bar of the window has an average, else nothing."""
    c = [b["c"] for b in bars]
    avg = [None if i < avg_bars - 1 else sum(c[i - avg_bars + 1:i + 1]) / avg_bars for i in range(len(c))]
    out = []
    for i in range(len(c)):
        w = range(i - window + 1, i + 1)
        if i - window + 1 < 0 or any(avg[k] is None for k in w):
            out.append(None)
        else:
            out.append(float(sum(1 for k in w if c[k] > avg[k])))
    return out


LONG = market(400)
YOUNG = market(150)


def test_THE_FINDING_as_built_the_count_shows_a_number_where_nothing_is_known():
    got, want = run(count_above(20, 50), LONG), by_hand(LONG, 20, 50)
    extra = [i for i in range(len(LONG)) if got[i] is not None and want[i] is None]
    assert extra == list(range(49, 68))                                   # the 19 bars whose window reaches before the first average
    # where both have a value they agree: the fault is only the bars that should be blank
    assert all(got[i] == want[i] for i in range(len(LONG)) if want[i] is not None)
    # and on those bars the number is too LOW: the bars with no average were counted as "not above"
    truth_if_known = [sum(1 for k in range(i - 49, i + 1) if k >= 19 and LONG[k]["c"] > sum(b["c"] for b in LONG[k - 19:k + 1]) / 20) for i in extra]
    assert [got[i] for i in extra] == [float(v) for v in truth_if_known]   # it is the count of the KNOWN bars only, shown as if of 50


def test_THE_FINDING_on_a_young_symbol_the_count_is_a_confident_zero_on_every_bar():
    got = run(count_above(200, 20), YOUNG)                                 # no 200-bar average exists on a 150-bar history
    with_a_value = [v for v in got if v is not None]
    assert len(with_a_value) == 150 - 19 and set(with_a_value) == {0.0}
    assert got[-1] == 0.0                                                  # on the newest bar, the one a member reads
    assert all(v is None for v in by_hand(YOUNG, 200, 20))                 # the plain calculation has nothing to say


def test_GUARDED_the_count_has_a_value_on_exactly_the_bars_it_is_known_and_is_right_there():
    got, want = run(guarded(20, 50), LONG), by_hand(LONG, 20, 50)
    assert [i for i in range(len(LONG)) if (got[i] is None) != (want[i] is None)] == []
    assert all(got[i] == want[i] for i in range(len(LONG)) if want[i] is not None)
    assert next(i for i, v in enumerate(got) if v is not None) == 68       # 19 bars later than as built
    assert sum(1 for v in got if v is not None) == 400 - 68
    # the young symbol: nothing at all, which is the truth
    assert all(v is None for v in run(guarded(200, 20), YOUNG))


def test_THE_CAUSE_is_the_comparison_not_the_window():
    """`close > average` answers 0 where the average does not exist. The sum never meets a missing value."""
    average_20 = run(average(20), LONG)
    above = run(op(">", CLOSE, average(20)), LONG)
    assert all(v is None for v in average_20[:19]) and average_20[19] is not None
    assert above[:19] == [0.0] * 19                                        # FALSE, not unknown, on the bars with no average
    # a sum handed a missing value would skip it (it looks further back): the same sum over the average itself has no early value
    assert run(call("sum", average(20), num(50)), LONG)[49] is None
    # and `na` of the average is what tells the two apart
    assert run(call("na", average(20)), LONG)[:20] == [1.0] * 19 + [0.0]


def test_the_guard_reads_the_windows_OLDEST_bar():
    """An offset one bar short lets one unknown bar in; one bar long throws a known bar away."""
    want = by_hand(LONG, 20, 50)
    wrong = lambda k: op("?:", call("na", back(average(20), k)), NO_VALUE, count_above(20, 50))  # noqa: E731
    short, long_ = run(wrong(48), LONG), run(wrong(50), LONG)
    assert [i for i in range(400) if short[i] is not None and want[i] is None] == [67]
    assert [i for i in range(400) if long_[i] is None and want[i] is not None] == [68]


def test_the_door_accepts_the_guarded_form_as_built(conv, clean_env, model):
    tree = op("/", op("*", guarded(20, 50), num(100)), num(50))
    client = model([emits(env(0, [{"op": "create", "name": "Share above the average", "placement": "pane",
                                    "outputs": [{"key": "share", "tree": tree}]}]))])
    r = conv.converse("the percent of the last 50 days the close was above its 20 day average", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, (r.get("gate"), r.get("reason"))
    assert r["envelope"]["ops"][0]["outputs"][0]["tree"] == tree           # nothing after the model call rewrote it


def test_the_instructions_say_when_a_window_count_has_no_value(conv):
    prompt = conv.system_prompt()
    head = "A COUNT, A SUM OR AN AVERAGE OVER A WINDOW OF A CONDITION THAT READS SOMETHING WITH ITS OWN WARM-UP"
    assert head in prompt
    text = prompt.split(head)[1].split("A COUNT OF BARS SINCE something")[0]
    for piece in ("a comparison with a value that does not exist yet is FALSE here",
                  "show a NUMBER for something that is not known",
                  "On a symbol with less history than the average needs, that number is 0 on every bar",
                  "has a value on the window's OLDEST bar: na(offset N - 1 of X) ? 0 / 0 : <the count>",
                  "na(offset 49 of sma(close, 20)) ? 0 / 0 : sum(close > sma(close, 20) ? 1 : 0, 50) * 100 / 50",
                  "(close > offset 1 of close) needs no such guard"):
        assert piece in text, piece
    # it sits with the other window paragraphs, after "only some bars of a window" and before "bars since"
    assert prompt.index("THE EXTREME, THE SUM OR THE AVERAGE OF ONLY SOME BARS IN A WINDOW") < prompt.index(head) < prompt.index("A COUNT OF BARS SINCE something")
