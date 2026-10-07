"""Wave 13 lane 13A -- `plan_extract.py`, the ONE reader of plan levels in a note.

One fixture per source shape (chart roles, canvas levels, number properties, labelled text and
the setup plans' numbers table, the Compass verdict row); conflicting entries read
"unreadable"; the in-note precedence; a chart for another ticker is not read; a hostile body
reads as less, never raises; and the write interface's role vocabulary is pinned to the client
builders (`lib/planLevels.js`), parsed rather than restated.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services.journal_two import plan_extract as px

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "planLevels.js"


def t(s):
    return {"type": "text", "text": s}


def p(s):
    return {"type": "paragraph", "content": [t(s)]}


def doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def bullets(*lines):
    return {"type": "bulletList", "content": [{"type": "listItem", "content": [p(s)]} for s in lines]}


def table(*rows):
    def cell(kind, s):
        return {"type": kind, "content": [p(s)]}
    out = [{"type": "tableRow", "content": [cell("tableHeader", h) for h in ("", "Value", "Why there")]}]
    out += [{"type": "tableRow", "content": [cell("tableCell", c) for c in r]} for r in rows]
    return {"type": "table", "content": out}


def chart(symbol, *annotations, ta=None):
    attrs = {"widgetId": "chart", "params": {"symbol": symbol}, "annotations": list(annotations)}
    if ta is not None:
        attrs["ta"] = ta
    return {"type": "widgetEmbed", "attrs": attrs}


def canvas(levels, items=()):
    return {"type": "tradeCanvas", "attrs": {"board": {"v": 1, "items": list(items), "edges": [], "levels": levels}}}


DEFS = [
    {"id": "p-entry", "name": "Entry", "type": "number"},
    {"id": "p-stop", "name": "Stop", "type": "number"},
    {"id": "p-target", "name": "Target", "type": "number"},
    {"id": "p-shares", "name": "Shares", "type": "number"},
    {"id": "p-exit", "name": "Exit", "type": "number"},
    {"id": "p-rps", "name": "Risk per share", "type": "number"},
    {"id": "p-setup", "name": "Setup", "type": "select", "options": [{"id": "o1", "label": "Breakout"}]},
]


def values(reading):
    return {r: reading.value(r) for r in px.PLAN_ROLES}


# ── one fixture per shape ───────────────────────────────────────────────────────────────

def test_labelled_text_the_trade_plan_template_bullets():
    body = doc(p("Name the pattern."), bullets("Entry: $42.50", "Stop: 40", "Target(s): 48, 52",
                                               "Size (shares / $ risk): 200 / $500"))
    r = px.read_note_plan(body, symbol="NVDA")
    assert values(r) == {"entry": 42.5, "stop": 40.0, "target": 48.0, "shares": 200.0}
    assert r.role("entry").shape == "text"


def test_labelled_text_the_unfilled_template_is_no_plan():
    body = doc(bullets("Entry: —", "Stop: —", "Target(s): —", "Size (shares / $ risk): —"))
    r = px.read_note_plan(body, symbol="NVDA")
    assert not r.names_any_level and not r.is_plan


def test_the_setup_plans_numbers_table():
    body = doc(table(["Pivot (entry)", "101.20", "top of the handle"], ["Stop", "97", "under the 21-day"],
                     ["Risk per share", "4.20", ""], ["Prior high (first target)", "112", ""],
                     ["Shares", "1,200", ""]))
    r = px.read_note_plan(body, symbol="NVDA")
    assert values(r) == {"entry": 101.2, "stop": 97.0, "target": 112.0, "shares": 1200.0}


def test_number_properties_and_the_setup_select():
    props = {"p-entry": 50, "p-stop": "48.5", "p-shares": 300, "p-exit": 55, "p-rps": 1.5, "p-setup": "o1"}
    r = px.read_note_plan(doc(), json.dumps(props), DEFS, "AAPL")
    assert values(r) == {"entry": 50.0, "stop": 48.5, "target": None, "shares": 300.0}
    assert r.setup == "Breakout"
    assert r.role("entry").shape == "properties"


def test_canvas_levels():
    body = doc(canvas([px.canvas_level("entry", 20, "a"), px.canvas_level("stop", 19, "b"),
                       px.canvas_level("target", 24, "c")]))
    r = px.read_note_plan(body, symbol="AMD")
    assert values(r) == {"entry": 20.0, "stop": 19.0, "target": 24.0, "shares": None}
    assert r.role("stop").shape == "canvas"


def test_chart_roles_and_the_ta_plan_block():
    body = doc(chart("TSLA", px.plan_annotation("entry", 250), px.plan_annotation("stop", 240),
                     {"type": "horizontal", "points": [{"time": 1, "price": 280}], "role": "target"},
                     {"type": "trendline", "points": [{"time": 1, "price": 10}]},   # no role: ignored
                     ta={"planBlock": {"shares": 40}, "setupTag": "Pullback"}))
    r = px.read_note_plan(body, symbol="TSLA")
    assert values(r) == {"entry": 250.0, "stop": 240.0, "target": 280.0, "shares": 40.0}
    assert r.setup == "Pullback"
    assert r.role("entry").shape == "chart"


def test_a_chart_for_another_ticker_is_not_read():
    body = doc(chart("MSFT", px.plan_annotation("entry", 400), px.plan_annotation("stop", 390)))
    assert not px.read_note_plan(body, symbol="TSLA").names_any_level
    assert px.read_note_plan(body, symbol="MSFT").value("entry") == 400.0


def test_a_canvas_level_on_another_tickers_chart_is_not_read():
    items = [{"id": "c1", "kind": "chart", "symbol": "MSFT"}]
    body = doc(canvas([px.canvas_level("entry", 400, "a", "c1"), px.canvas_level("stop", 9, "b")], items))
    r = px.read_note_plan(body, symbol="TSLA")
    assert r.role("entry").state == px.STATE_ABSENT and r.value("stop") == 9.0


def test_the_compass_verdict_row():
    row = {"entry_price": 10.0, "stop_price": 9.5, "target_price": 12, "shares": 100, "side": "long",
           "setup": "Gap"}
    r = px.read_verdict_plan(row)
    assert values(r) == {"entry": 10.0, "stop": 9.5, "target": 12.0, "shares": 100.0}
    assert r.side == "Long" and r.setup == "Gap" and r.role("entry").shape == "verdict"


# ── conflicts, precedence ───────────────────────────────────────────────────────────────

def test_conflicting_entries_read_unreadable_never_a_pick():
    body = doc(bullets("Entry: 42", "Entry: 43", "Stop: 40"))
    r = px.read_note_plan(body, symbol="X")
    assert r.role("entry").state == px.STATE_UNREADABLE
    assert r.role("entry").values == (42.0, 43.0)
    assert r.value("entry") is None and r.value("stop") == 40.0


def test_the_same_value_twice_is_not_a_conflict():
    r = px.read_note_plan(doc(bullets("Entry: 42", "Entry: 42.00")), symbol="X")
    assert r.value("entry") == 42.0


def test_several_targets_are_scale_outs_the_nearest_is_the_target():
    r = px.read_note_plan(doc(bullets("Entry: 50", "Stop: 48", "Target: 60", "Target: 55")), symbol="X")
    assert r.value("target") == 55.0
    short = px.read_note_plan(doc(bullets("Entry: 50", "Stop: 52", "Target: 40", "Target: 45")), symbol="X")
    assert short.value("target") == 45.0
    straddle = px.read_note_plan(doc(bullets("Entry: 50", "Target: 60", "Target: 45")), symbol="X")
    assert straddle.role("target").state == px.STATE_UNREADABLE


def test_in_note_precedence_chart_canvas_properties_text_per_role():
    body = doc(chart("X", px.plan_annotation("entry", 11)),
               canvas([px.canvas_level("entry", 12, "a"), px.canvas_level("stop", 10, "b")]),
               bullets("Entry: 13", "Stop: 9", "Target: 20", "Shares: 50"))
    props = {"p-entry": 14, "p-stop": 8, "p-shares": 70}
    r = px.read_note_plan(body, json.dumps(props), DEFS, "X")
    assert (r.value("entry"), r.role("entry").shape) == (11.0, "chart")
    assert (r.value("stop"), r.role("stop").shape) == (10.0, "canvas")
    assert (r.value("shares"), r.role("shares").shape) == (70.0, "properties")
    assert (r.value("target"), r.role("target").shape) == (20.0, "text")
    assert r.primary_shape == "chart"


def test_an_unreadable_higher_shape_is_not_passed_over_for_a_lower_one():
    body = doc(canvas([px.canvas_level("entry", 12, "a"), px.canvas_level("entry", 13, "b")]),
               bullets("Entry: 12"))
    assert px.read_note_plan(body, symbol="X").role("entry").state == px.STATE_UNREADABLE


@pytest.mark.parametrize("label,role", [
    ("Entry", "entry"), ("Pivot (entry)", "entry"), ("Reclaim (entry)", "entry"),
    ("Entry (after the crack)", "entry"), ("Opening range high (entry)", "entry"),
    ("Stop", "stop"), ("Low of day (stop)", "stop"), ("High of day (stop)", "stop"),
    ("Target(s)", "target"), ("Prior high (first target)", "target"), ("First support (cover)", "target"),
    ("Shares", "shares"), ("Shares (small)", "shares"), ("Size (shares / $ risk)", "shares"), ("Size", "shares"),
    ("Risk per share", None), ("Regime", None), ("Exit", None), ("Account size", None),
    ("Position size %", None), ("Undercut level", None), ("Gap fill level", None), ("", None), (None, None),
])
def test_classify_label(label, role):
    assert px.classify_label(label) == role


@pytest.mark.parametrize("body", [None, "", "not json", "[]", {"type": "doc", "content": "x"},
                                  {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": []}]},
                                  {"type": "doc", "content": [{"type": "tradeCanvas", "attrs": {"board": []}}]},
                                  doc(bullets("Entry: abc", "Stop: -5", "Stop: 0", "Entry: inf"))])
def test_a_hostile_body_reads_as_less_never_raises(body):
    r = px.read_note_plan(body, "{bad", [None, {"id": 1}], "X")
    assert not r.names_any_level
    assert px.note_levels(body, None, None, "X") == []


def test_a_deep_body_is_bounded():
    node = p("Entry: 5")
    for _ in range(500):
        node = {"type": "blockquote", "content": [node]}
    assert px.read_note_plan(doc(node), symbol="X").value("entry") is None   # beyond the depth bound


def test_note_levels_lists_every_level_unmerged_in_precedence_order():
    body = doc(canvas([px.canvas_level("entry", 12, "a")]), bullets("Entry: 13", "Stop: 9"))
    assert px.note_levels(body, symbol="X") == [
        {"shape": "canvas", "role": "entry", "price": 12.0},
        {"shape": "text", "role": "entry", "price": 13.0},
        {"shape": "text", "role": "stop", "price": 9.0},
    ]


# ── the write interface ─────────────────────────────────────────────────────────────────

def test_the_role_vocabulary_is_one_fact_in_two_files():
    src = CLIENT.read_text(encoding="utf-8")
    m = re.search(r"export const PLAN_ROLES = Object\.freeze\(\[([^\]]*)\]\)", src)
    assert m, "planLevels.js no longer declares PLAN_ROLES in the parsed form"
    client = tuple(re.findall(r"'([a-z]+)'", m.group(1)))
    assert client == px.PLAN_ROLES
    m2 = re.search(r"export const PRICE_ROLES = Object\.freeze\(\[([^\]]*)\]\)", src)
    assert tuple(re.findall(r"'([a-z]+)'", m2.group(1))) == px.PRICE_ROLES


def test_the_python_builders_produce_what_the_reader_reads():
    body = doc(chart("X", px.plan_annotation("entry", 5), px.plan_annotation("stop", 4)))
    assert values(px.read_note_plan(body, symbol="X"))["entry"] == 5.0
    with pytest.raises(ValueError):
        px.plan_annotation("shares", 5)
    with pytest.raises(ValueError):
        px.canvas_level("custom", 5)


def test_the_module_docstring_documents_the_write_interface():
    doc_text = px.__doc__ or ""
    for needle in ("THE WRITE INTERFACE", "annotations", "planBlock", "planLevels.js", "NEVER WRITES A NOTE"):
        assert needle in doc_text
