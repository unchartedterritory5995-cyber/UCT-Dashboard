"""THE FUNCTION TABLE'S SENTENCES SAY WHAT THE ENGINE DOES: the pivots and `valuewhenOccurrence`.

A function's `sentence` in `closedTable.json` is the ONE place its meaning is written in words. The assistants are
told it (`definition_concierge.vocabulary_text`), a member reads it in a formula's read-back, and the reference page
prints it. ⚰️ MEASURED 2026-11-23 (value case cap-03): asked for "the average of the last 5 swing highs", the
assistant averaged occurrences 1 to 5 of `pivothigh`. The sentences did not say that occurrence 0 is the most recent
one (one swing late on 1,192 of 1,639 bars), that a pivot is written ON the swing bar, or that a bar EQUAL to a bar
before it still pivots (9 swings, 409 bars).

Held here, by measurement on the built market and never by wording alone:
  * what the ENGINE does (the server's own interpreter), against a plain loop written from the sentence;
  * that the sentence carries the words for each of those facts, and that the assistant is told that sentence.
The engine is not changed by this file's unit: only three sentences are. No model is called.
"""
from __future__ import annotations

import json
from pathlib import Path

from api.services import definition_concierge as concierge
from api.services import definition_conversation as conversation
from tools.value_cases import grade as G
from tools.value_cases.market import STOCK

ROOT = Path(__file__).resolve().parents[1]
TABLE = json.loads((ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json").read_text(encoding="utf-8"))["functions"]
H = [float(b["h"]) for b in STOCK]
L = [float(b["l"]) for b in STOCK]
C = [float(b["c"]) for b in STOCK]
N = len(STOCK)
LEFT, RIGHT = 3, 3


def series(name):
    return {"type": "series", "name": name}


def num(v):
    return {"type": "num", "value": v}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def engine(tree):
    col, err = G.evaluate(tree, {})
    assert err is None, err
    return [None if (v is None or v != v) else float(v) for v in col]


def swings(x, high, tie_before):
    """The bars the SENTENCE names: beyond each of the bars after it, and beyond (or, with `tie_before`, level with)
    each of the bars before it."""
    beats = (lambda a, b: a > b) if high else (lambda a, b: a < b)
    out = {}
    for i in range(LEFT, N - RIGHT):
        before = all(beats(x[i], x[j]) or (tie_before and x[i] == x[j]) for j in range(i - LEFT, i))
        after = all(beats(x[i], x[j]) for j in range(i + 1, i + RIGHT + 1))
        if before and after:
            out[i] = x[i]
    return out


def test_a_pivot_is_written_on_the_swing_bar_and_an_equal_bar_before_it_still_counts():
    for name, x, high in (("pivothigh", H, True), ("pivotlow", L, False)):
        got = engine(call(name, series("high" if high else "low"), num(LEFT), num(RIGHT)))
        marked = {i: v for i, v in enumerate(got) if v is not None}
        said = swings(x, high, tie_before=True)
        assert marked == said, name                                     # bar for bar, value for value, ON the swing bar
        strict = swings(x, high, tie_before=False)
        assert set(strict) < set(said) and len(said) - len(strict) >= 5, name      # the tie decides bars on this chart
        # only known once the later bars exist: nothing on the newest RIGHT bars, whatever they hold
        assert all(v is None for v in got[N - RIGHT:]), name
        sentence = TABLE[name]["sentence"]
        word = "high" if high else "low"
        for part in (f"at least as {word} as each of the {{1}} bars before it", f"{word}er than each of the {{2}} bars after it",
                     "written on that bar itself", "known only once those later bars exist"):
            assert part in sentence, (name, part)
        assert TABLE[name]["forward"] == "arg2"                         # the table's own declaration that it reads later bars


def test_occurrence_0_is_the_most_recent_one():
    up = {"type": "op", "name": ">", "args": [series("close"), {"type": "offset", "value": 1, "args": [series("close")]}]}
    for k in (0, 1, 4):
        got = engine(call("valuewhenOccurrence", up, series("high"), num(k)))
        seen, want = [], []
        for i in range(N):
            if i >= 1 and C[i] > C[i - 1]:                              # an up close: the event
                seen.append(H[i])
            want.append(seen[-1 - k] if len(seen) > k else None)
        assert got == want, k                                           # 0 = the most recent, 1 = the one before it
    sentence = TABLE["valuewhenOccurrence"]["sentence"]
    assert sentence.endswith("counting occurrences backward from 0 for the most recent one")
    assert "{0}" in sentence and "true" in sentence.lower()


def test_the_assistant_is_told_these_sentences_and_no_other_wording_of_them():
    told = concierge.vocabulary_text(conversation.chart_table())
    for name in ("pivothigh", "pivotlow", "valuewhenOccurrence"):
        lines = [line.strip() for line in told.splitlines() if line.strip().startswith(name + "(")]
        assert len(lines) == 1 and lines[0].endswith(" -- " + TABLE[name]["sentence"]), name
    # each slot once (the read-back's reader captures a slot once), printable ASCII, nothing from {3} up
    for name in ("pivothigh", "pivotlow", "valuewhenOccurrence"):
        sentence = TABLE[name]["sentence"]
        assert [sentence.count("{%d}" % k) for k in range(4)] == [1, 1, 1, 0], name
        assert all(" " <= ch <= "~" for ch in sentence), name
