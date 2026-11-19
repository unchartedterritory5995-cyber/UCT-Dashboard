"""U-HTF-CALENDAR in the Python lane's merge pick (``ast_interpret.py``), held to the JS authority.

``interpret.js::tfMergeReads`` (the run's supply pick and the host's ``tf_merge`` arm) and the Python lane's
``tf_merge`` arm show a completed week or month on its LAST session with look-ahead off -- except a SHORT period
(its last session is not the period's last weekday) that ends before TradingView's exchange calendar begins
(2000-01-01), or the week of 2001-09-10: those show on the NEXT bar. Measured on Q-HTF-CAL-1a / 1b (the numbers
are in ``interpret.js`` above ``HTF_CALENDAR_START``).

These rails: the constants are the JS file's own (read from it, never restated); the hand-written cases; and
TradingView's own weekly / monthly close with look-ahead off (A02 / A05) on every bar of both committed captures.
"""
from __future__ import annotations

import datetime
import json
import pathlib
import re

import pytest

from api.services import ast_interpret

REPO = pathlib.Path(__file__).resolve().parents[1]
JS = REPO / "app" / "src" / "components" / "chart" / "engine" / "ast" / "interpret.js"
HARNESS = REPO / "tests" / "fixtures" / "vendor" / "harness"
CLOSE = {"type": "series", "name": "close"}


def merge(code):
    return {"type": "tf_merge", "value": code, "args": [dict(CLOSE)]}


def col(tree, bars):
    out = ast_interpret.interpret(tree, bars, {}, opts={"tf": "D", "historyFromListing": True})
    return [v if v is not None and v == v else None for v in out]


def bars_on(dates):
    return [{"t": t, "o": i + 1, "h": i + 1.5, "l": i + 0.5, "c": i + 1, "v": 100} for i, t in enumerate(dates)]


def test_the_constants_are_the_js_authoritys_own():
    text = JS.read_text(encoding="utf-8")
    start = re.search(r"export const HTF_CALENDAR_START = '([0-9-]+)'", text)
    unseen = re.search(r"export const HTF_CALENDAR_UNSEEN_CLOSES = Object\.freeze\(\[([^\]]*)\]\)", text)
    assert start and unseen, "interpret.js no longer declares the calendar constants this lane mirrors"
    assert ast_interpret.HTF_CALENDAR_START == start.group(1)
    assert tuple(re.findall(r"'([0-9-]+)'", unseen.group(1))) == ast_interpret.HTF_CALENDAR_UNSEEN_CLOSES


@pytest.mark.parametrize("iso,code,want", [
    ("1999-04-01", "W", True), ("1999-12-23", "W", True), ("1999-04-09", "W", False),
    ("2000-04-20", "W", False), ("2004-06-10", "W", False), ("2001-09-10", "W", True),
    ("1999-05-28", "M", True), ("1999-04-30", "M", False), ("2004-05-28", "M", False), ("1999-07-30", "M", False),
])
def test_the_rule_case_by_case(iso, code, want):
    assert ast_interpret.htf_closes_on_next_bar(iso, code) is want


def test_weekly_hand_written_the_short_week_moves_one_bar_nothing_else_does():
    d = ["1999-03-22", "1999-03-23", "1999-03-24", "1999-03-25", "1999-03-26",
         "1999-03-29", "1999-03-30", "1999-03-31", "1999-04-01",
         "1999-04-05", "1999-04-06",
         "2000-04-17", "2000-04-18", "2000-04-19", "2000-04-20",
         "2000-04-24", "2000-04-25"]
    c = col(merge("W"), bars_on(d))
    assert c[d.index("1999-03-26")] == 5
    assert c[d.index("1999-04-01")] == 5          # the short week's Thursday still reads the week before
    assert c[d.index("1999-04-05")] == 9          # ...and the next Monday reads it
    assert c[d.index("2000-04-20")] == 15         # from 2000: its own Thursday
    assert c[d.index("2000-04-24")] == 15


def test_the_week_of_10_september_2001_shows_on_17_september():
    d = ["2001-09-04", "2001-09-05", "2001-09-06", "2001-09-07", "2001-09-10", "2001-09-17", "2001-09-18"]
    c = col(merge("W"), bars_on(d))
    assert c[d.index("2001-09-10")] == 4
    assert c[d.index("2001-09-17")] == 5


def test_monthly_may_1999_shows_on_1_june_may_2004_on_its_last_bar():
    d = ["1999-04-29", "1999-04-30", "1999-05-27", "1999-05-28", "1999-06-01", "1999-06-02",
         "2004-04-29", "2004-04-30", "2004-05-27", "2004-05-28", "2004-06-01", "2004-06-02"]
    c = col(merge("M"), bars_on(d))
    assert c[d.index("1999-05-28")] == 2
    assert c[d.index("1999-06-01")] == 4
    assert c[d.index("2004-05-28")] == 10
    assert c[d.index("2004-06-01")] == 10


@pytest.mark.parametrize("cap_id", ["vw-request-htf-alignment-spy-1d-2026-11-18", "vw-request-htf-alignment-qqq-1d-2026-11-18"])
@pytest.mark.parametrize("code,title", [("W", "A02_close_W_lookahead_OFF"), ("M", "A05_close_M_lookahead_OFF")])
def test_tradingviews_own_merge_on_every_bar(cap_id, code, title):
    cap = json.loads((HARNESS / f"{cap_id}.json").read_text(encoding="utf-8"))
    rows = cap["bars"]["rows"]
    bars = [{"t": datetime.datetime.fromtimestamp(r[0], datetime.timezone.utc).date().isoformat(),
             "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]
    fields = cap["plotValues"]["fields"]
    titles = {p["id"]: p["title"] for p in cap["study"]["plots"]}
    k = next(i for i, f in enumerate(fields) if titles.get(f) == title)
    by_t = {r[0]: r for r in cap["plotValues"]["rows"]}
    want = []
    for r in rows:
        v = (by_t.get(r[0]) or [None] * len(fields))[k]
        want.append(v if isinstance(v, (int, float)) and v == v else None)
    ours = col(merge(code), bars)
    bad = [(i, bars[i]["t"], ours[i], want[i]) for i in range(len(rows) - 1) if ours[i] != want[i]]
    assert bad == [], bad[:5]
    assert sum(1 for v in want[:-1] if v is not None) > len(rows) - 30
