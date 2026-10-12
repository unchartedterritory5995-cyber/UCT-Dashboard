"""Composed bodies must be buildable by the REAL editor schema (lane A2 review I-1).

Two halves, one fact:
  * this file composes the hard cases (placeholders inside containers, emptied containers, "save as
    style" on charts in columns, every built-in style) and PINS them in
    app/src/pages/journal-2-0/lib/__fixtures__/journalStylesComposed.json;
  * app/src/pages/journal-2-0/lib/journalStylesComposed.schema.test.js runs every pinned body
    through `editorSchema().nodeFromJSON(body).check()` -- the real schema, content expressions
    included. ⭐ The server's `notes._refuse_unbuildable` is NOT equivalent: it mirrors only the
    throws of `nodeFromJSON` (an empty text node, a nameless type), never a content expression, so
    `listItem[widgetEmbed]` or an empty `column` passes it (the review probe: CREATE_ACCEPTED True).

So the composer cannot drift from the fixture (this file fails) and the fixture cannot drift from
the schema (the vitest fails). Regenerate the fixture after an intended change with
    UCT_WRITE_JOURNAL_STYLES_FIXTURE=1 python -m pytest tests/test_journal_styles_schema.py
and read the diff before committing it.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

NOW = datetime(2026, 10, 11, 14, 30, tzinfo=timezone.utc)
FIXTURE = Path("app/src/pages/journal-2-0/lib/__fixtures__/journalStylesComposed.json")
WRITE = os.environ.get("UCT_WRITE_JOURNAL_STYLES_FIXTURE") == "1"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _p(text=""):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]} if text else {"type": "paragraph"}


def _ph(block):
    return _p("{{block:%s}}" % block)


def _h(text):
    return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}


def _doc(*nodes):
    return {"type": "doc", "content": list(nodes)}


def _columns(*cols):
    return {"type": "columns", "content": [{"type": "column", "content": list(c)} for c in cols]}


def _chart_embed(tf):
    return {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "chart",
                                             "params": {"symbol": "NVDA", "tf": tf, "to": 1760000000}}}


ON = [{"block": "chart", "enabled": True, "settings": {"tf": "D"}}]
OFF = [{"block": "chart", "enabled": False, "settings": {}}]
FUTURE = [{"block": "futureThing", "enabled": True, "settings": {}}]

#: name -> (outline, blocks, ticker). Each is a shape the review probed or its neighbour.
CASES = {
    "list_item_first_child_placeholder": (
        _doc(_h("Plan"), {"type": "bulletList", "content": [{"type": "listItem", "content": [_ph("chart")]}]}),
        ON, "NVDA"),
    "list_item_first_child_placeholder_no_ticker": (
        _doc(_h("Plan"), {"type": "bulletList", "content": [{"type": "listItem", "content": [_ph("chart")]}]}),
        ON, None),
    "task_item_first_child_placeholder": (
        _doc(_h("Plan"), {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": False}, "content": [_ph("chart")]}]}),
        ON, "NVDA"),
    "blockquote_only_child_disabled": (_doc({"type": "blockquote", "content": [_ph("chart")]}), OFF, "NVDA"),
    "callout_only_child_unbuildable": (_doc(_h("H"), {"type": "callout", "content": [_ph("futureThing")]}),
                                       FUTURE, "NVDA"),
    "column_only_child_placeholder": (_doc(_h("H"), _columns([_ph("chart")], [_p("words")])), ON, "NVDA"),
    "toggle_content_only_child": (
        _doc(_h("H"), {"type": "toggle", "content": [
            {"type": "toggleSummary", "content": [{"type": "text", "text": "More"}]},
            {"type": "toggleContent", "content": [_ph("chart")]}]}),
        ON, "NVDA"),
    "hand_typed_placeholder_not_in_style": (_doc(_h("H"), _ph("chart"), _p("w")), [], "NVDA"),
}


def _style(outline, blocks):
    return {"id": None, "builtin": False, "version": None, "name": "x", "kindId": "thesis",
            "outlineTemplateId": None, "outlineBodyJson": outline, "blocks": blocks, "properties": {}}


def _normalise(node):
    """embedId is a fresh uuid per compose; nothing else in a composed body is random."""
    if isinstance(node, dict):
        out = {k: _normalise(v) for k, v in node.items()}
        if out.get("type") == "widgetEmbed" and isinstance(out.get("attrs"), dict) and "embedId" in out["attrs"]:
            out["attrs"] = {**out["attrs"], "embedId": "EMBED"}
        return out
    if isinstance(node, list):
        return [_normalise(x) for x in node]
    return node


def _build() -> dict:
    from api.services.journal_two import journal_styles as js, notes
    out = {}
    for name, (outline, blocks, ticker) in CASES.items():
        out[name] = js.compose("u1", _style(outline, blocks), ticker=ticker, conn=None, now=NOW)["bodyJson"]
    for kind in js.BUILTIN_STYLES:
        s = js.get_style("u1", js.builtin_style_id(kind))
        out[f"builtin_{kind}"] = js.compose("u1", s, ticker="NVDA", conn=None, now=NOW)["bodyJson"]
        out[f"builtin_{kind}_no_ticker"] = js.compose("u1", s, ticker=None, conn=None, now=NOW)["bodyJson"]
    # "Save this note's setup as a style" on charts side by side, and on a chart alone in a callout.
    for name, body in {
        "save_two_charts_in_columns": _doc(_h("Setup"), _columns([_chart_embed("D")], [_chart_embed("W")])),
        "save_chart_alone_in_callout": _doc(_h("Setup"), {"type": "callout", "content": [_chart_embed("60")]},
                                            _p("mine")),
    }.items():
        n = notes.create_note("u1", {"title": name, "bodyJson": body})
        s = js.create_style_from_note("u1", n["id"], name, "thesis")
        full = js.get_style("u1", s["id"])
        out[f"{name}_outline"] = full["outlineBodyJson"]
        out[f"{name}_composed"] = js.compose("u1", full, ticker="NVDA", conn=None, now=NOW)["bodyJson"]
    return _normalise(out)


_BLOCK_PLUS = {"blockquote", "callout", "column", "toggleContent", "tableCell", "tableHeader"}
_LIST_ITEMS = {"listItem", "taskItem"}


def _schema_smells(node, path="doc") -> list[str]:
    """The two content-expression breaches the review found, checked in Python so this file goes red
    without Node. The vitest is the authority; this is the cheap early half."""
    out = []
    if not isinstance(node, dict):
        return out
    t, content = node.get("type"), node.get("content")
    if t in _BLOCK_PLUS and not content:
        out.append(f"{path}: empty {t}")
    if t in _LIST_ITEMS and (not content or not isinstance(content[0], dict) or content[0].get("type") != "paragraph"):
        out.append(f"{path}: {t} does not start with a paragraph")
    if t == "columns" and isinstance(content, list) and any(not (c or {}).get("content") for c in content):
        out.append(f"{path}: a column is empty")
    for i, c in enumerate(content or []):
        out.extend(_schema_smells(c, f"{path}/{t}[{i}]"))
    return out


def test_composed_bodies_carry_no_known_schema_breach(db_path):
    built = _build()
    smells = {name: _schema_smells(body) for name, body in built.items()}
    assert {k: v for k, v in smells.items() if v} == {}


def test_the_committed_fixture_is_what_the_composer_makes_now(db_path):
    built = _build()
    if WRITE:
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_bytes((json.dumps(built, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    assert FIXTURE.exists(), f"missing {FIXTURE}; regenerate with UCT_WRITE_JOURNAL_STYLES_FIXTURE=1"
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == built, (
        "the composer's output moved; regenerate the fixture (see this file's docstring), read the diff, "
        "and let journalStylesComposed.schema.test.js judge it")


def test_a_nested_placeholder_becomes_an_empty_paragraph_and_its_block_goes_after_the_heading(db_path):
    built = _build()
    body = built["list_item_first_child_placeholder"]["content"]
    assert [n["type"] for n in body] == ["heading", "widgetEmbed", "bulletList"]
    assert body[2]["content"][0]["content"] == [{"type": "paragraph"}]


def test_save_as_style_never_leaves_an_empty_column(db_path):
    built = _build()
    cols = [n for n in built["save_two_charts_in_columns_outline"]["content"] if n["type"] == "columns"][0]
    assert all(c["content"] for c in cols["content"])
    assert [n["type"] for n in built["save_two_charts_in_columns_composed"]["content"]][:2] == ["heading", "widgetEmbed"]
