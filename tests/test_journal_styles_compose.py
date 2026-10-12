"""The one composer (spec P1.3): outline body -> block nodes where the outline marks them (a
paragraph that is exactly {{block:<id>}}), the rest after the first heading -> property defaults
-> the kind."""
from __future__ import annotations

import importlib
import os
import tempfile
from datetime import datetime, timezone

import pytest

NOW = datetime(2026, 10, 11, 14, 30, tzinfo=timezone.utc)


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


def _types(doc):
    return [n["type"] for n in doc["content"]]


def _text(node):
    return "".join(c.get("text", "") for c in node.get("content") or [])


def test_builtin_trade_plan_places_the_chart_at_its_placeholder(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.get_style("u1", "builtin:trade_plan")
    out = js.compose("u1", s, ticker="NVDA", conn=None, now=NOW)
    body = out["bodyJson"]
    i = _types(body).index("widgetEmbed")
    assert _text(body["content"][i - 1]) == "What is the pattern, and why now?"
    attrs = body["content"][i]["attrs"]
    assert attrs["widgetId"] == "chart" and attrs["params"] == {"symbol": "NVDA", "tf": "D", "to": int(NOW.timestamp())}
    assert not any("{{block:" in _text(n) for n in body["content"])
    assert out["properties"] == {"builtin:note_kind": "trade_plan"}
    assert (out["styleId"], out["styleVersion"], out["kindId"]) == ("builtin:trade_plan", 1, "trade_plan")


def test_blocks_without_a_placeholder_go_after_the_first_heading(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis",
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "intro"}]},
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "H"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "after"}]}]},
        "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}]})
    body = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)["bodyJson"]
    assert _types(body) == ["paragraph", "heading", "widgetEmbed", "paragraph"]


def test_no_heading_puts_blocks_first_and_disabled_placeholders_vanish(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis",
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "{{block:chart}}"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "words"}]}]},
        "blocks": [{"block": "chart", "enabled": False, "settings": {}}]})
    body = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)["bodyJson"]
    assert _types(body) == ["paragraph"] and _text(body["content"][0]) == "words"


def test_no_heading_with_an_enabled_block_puts_it_first(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis",
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "words"}]}]},
        "blocks": [{"block": "chart", "enabled": True, "settings": {}}]})
    body = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)["bodyJson"]
    assert _types(body) == ["widgetEmbed", "paragraph"]


def test_chart_block_without_ticker_leaves_an_instruction(db_path):
    from api.services.journal_two import journal_styles as js
    out = js.compose("u1", js.get_style("u1", "builtin:thesis"), ticker=None, conn=None, now=NOW)
    assert "widgetEmbed" not in _types(out["bodyJson"])
    assert any(_text(n) == js.SKIP_SENTENCES["needs-ticker"] for n in out["bodyJson"]["content"])
    assert out["skipped"] == [{"block": "chart", "reason": "needs-ticker"}]


def test_an_unknown_block_is_skipped_and_named(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis", "outlineBodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "{{block:futureThing}}"}]}]},
        "blocks": [{"block": "futureThing", "enabled": True, "settings": {}}]})
    out = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)
    assert out["skipped"] == [{"block": "futureThing", "reason": "unknown-block"}]
    assert _types(out["bodyJson"]) == ["paragraph"]                     # never an empty doc


def test_a_hand_typed_placeholder_the_style_does_not_list_is_kept_as_text(db_path):
    """Review M-5: a member's own `{{block:chart}}` (an old template, a typed note) is their text when
    the style does not switch that block on. Kept, and reported as not-in-style, never unknown-block."""
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis", "blocks": [],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "H"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "{{block:chart}}"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "{{block:somethingNew}}"}]}]}})
    out = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)
    assert [_text(n) for n in out["bodyJson"]["content"]] == ["H", "{{block:chart}}", "{{block:somethingNew}}"]
    assert out["skipped"] == [{"block": "chart", "reason": "not-in-style"},
                              {"block": "somethingNew", "reason": "not-in-style"}]


def test_compose_falls_back_when_the_linked_template_is_gone(db_path):
    from api.services.journal_two import journal_styles as js, note_templates, notes
    n = notes.create_note("u1", {"title": "t", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "from template"}]}]}})
    t = note_templates.create_from_note("u1", n["id"])
    s = js.create_style("u1", {"name": "x", "kindId": "thesis", "outlineTemplateId": t["id"],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "inline"}]}]}})
    assert _text(js.compose("u1", js.get_style("u1", s["id"]), ticker=None, conn=None, now=NOW)["bodyJson"]["content"][0]) == "from template"
    note_templates.delete_template("u1", t["id"])
    assert _text(js.compose("u1", js.get_style("u1", s["id"]), ticker=None, conn=None, now=NOW)["bodyJson"]["content"][0]) == "inline"


def test_compose_never_mutates_the_builtin_outline(db_path):
    """Snapshot semantics start here: the composer works on a COPY, so composing a built-in style
    (or a saved one) can never edit the style it read."""
    from api.services.journal_two import journal_styles as js
    import copy
    before = copy.deepcopy(js.BUILTIN_STYLES["trade_plan"]["outline"])
    js.compose("u1", js.get_style("u1", "builtin:trade_plan"), ticker="NVDA", conn=None, now=NOW)
    assert js.BUILTIN_STYLES["trade_plan"]["outline"] == before


def test_property_defaults_drop_a_property_deleted_since(db_path):
    from api.services.journal_two import journal_styles as js, note_properties as np
    p = np.create_property_def("u1", "Setup", "select", [{"label": "VCP"}])
    s = js.create_style("u1", {"name": "x", "kindId": "thesis",
                               "properties": {p["id"]: p["options"][0]["id"], "builtin:confidence": "high"}})
    np.delete_property_def("u1", p["id"])
    out = js.compose("u1", js.get_style("u1", s["id"]), ticker=None, conn=None, now=NOW)
    assert out["properties"] == {"builtin:confidence": "high", "builtin:note_kind": "thesis"}


def test_create_note_writes_the_style_stamp_in_one_insert(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"}, style_stamp=("builtin:thesis", 1, "thesis"))
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == ("builtin:thesis", 1, "thesis")
    assert notes.get_note("u1", n["id"])["styleVersion"] == 1


def test_the_style_stamp_is_never_read_from_the_payload(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x", "styleId": "builtin:thesis", "styleVersion": 9, "kindId": "thesis",
                                 "style_stamp": ["a", 1, "b"]})
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == (None, None, None)


def test_preview_uses_the_members_latest_ticker(db_path):
    from api.services.journal_two import journal_styles as js, notes
    notes.create_note("u1", {"title": "x", "ticker": "CRWD"})
    out = js.preview("u1", {"styleId": "builtin:watchlist_note"})
    assert out["ticker"] == "CRWD" and out["tickerSource"] == "latest-note"
    assert any(n["type"] == "widgetEmbed" for n in out["bodyJson"]["content"])


def test_preview_writes_nothing_and_takes_an_asked_ticker_and_a_draft(db_path):
    from api.services.journal_two import journal_styles as js
    out = js.preview("u1", {"style": {"name": "Draft", "kindId": "thesis",
                                      "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}]},
                            "ticker": "amd"})
    assert out["ticker"] == "AMD" and out["tickerSource"] == "asked"
    assert [n for n in out["bodyJson"]["content"] if n["type"] == "widgetEmbed"][0]["attrs"]["params"]["tf"] == "W"
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM j2_journal_styles").fetchone()[0] == 0
    finally:
        conn.close()
    with pytest.raises(js.StyleNotFound):
        js.preview("u1", {"styleId": "nope"})
