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


def test_builtin_trade_plan_places_the_chart_at_its_placeholder(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    # Nothing held (a cold pod): the stamp is still built, and no regime is recorded.
    monkeypatch.setattr(tb, "_breadth", lambda: {})
    monkeypatch.setattr(tb, "_regime_field", lambda memo: {"missing": "wire_unavailable"})
    monkeypatch.setattr(tb, "_quotes", lambda *a, **k: {})
    s = js.get_style("u1", "builtin:trade_plan")
    out = js.compose("u1", s, ticker="NVDA", conn=None, now=NOW)
    body = out["bodyJson"]
    i = next(k for k, n in enumerate(body["content"])
             if n["type"] == "widgetEmbed" and n["attrs"]["widgetId"] == "chart")
    assert _text(body["content"][i - 1]) == "What is the pattern, and why now?"
    attrs = body["content"][i]["attrs"]
    assert attrs["params"] == {"symbol": "NVDA", "tf": "D", "to": int(NOW.timestamp())}
    assert not any("{{block:" in _text(n) for n in body["content"])
    assert out["properties"] == {"builtin:note_kind": "trade_plan"}
    assert (out["styleId"], out["styleVersion"], out["kindId"]) == ("builtin:trade_plan", 2, "trade_plan")


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


# ── Notebook P2a Task 12: the built-in Trade plan at version 2 (IR-S11, R-P2-8, R-RC-1) ──────
# The P2a blocks join the Trade plan. A NEW note (a create, or an empty note switched to the style)
# captures the market and records regime_at_write; an OLDER note offered the blocks by "Update
# layout" gets them UNCAPTURED and never today's regime.
P2A_BLOCKS = ["chart", "preEntryChecklist", "positionSizing", "marketcontext"]
GREEN = {"value": "green", "source": "UCT Exposure Rating", "asOf": "2026-10-13", "missing": None, "detail": None}


def _green(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "_breadth", lambda: {})
    monkeypatch.setattr(tb, "_regime_field", lambda memo: dict(GREEN))
    monkeypatch.setattr(tb, "_quotes", lambda *a, **k: {})


def _embeds(body):
    return [n for n in body["content"] if n.get("type") == "widgetEmbed"]


def _by_id(body, wid):
    found = [n for n in _embeds(body) if n["attrs"]["widgetId"] == wid]
    assert len(found) == 1, (wid, [n["attrs"]["widgetId"] for n in _embeds(body)])
    return found[0]


def _v1_trade_plan_body():
    """A note as the v1 Trade plan wrote it (its chart in place), plus the member's own words."""
    from api.services.journal_two import journal_styles as js
    return {"type": "doc", "content": [
        js._h("The setup"), js._p("What is the pattern, and why now?"),
        js._build_chart({"settings": {"tf": "D"}}, {"ticker": "NVDA", "now": NOW})[0],
        js._p("MY OWN WORDS"),
        js._h("Entry, stop and target"), js._p("Entry: 101.5")]}


def test_trade_plan_v2_holds_the_p2a_blocks(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js
    _green(monkeypatch)
    s = js.BUILTIN_STYLES["trade_plan"]
    assert s["version"] == 2
    assert [b["block"] for b in s["blocks"]] == P2A_BLOCKS
    assert all(b["enabled"] for b in s["blocks"])
    # Each P2 block carries its catalog defaults (the ONE copy in BLOCK_KINDS), the chart its Daily.
    for b in s["blocks"][1:]:
        assert b["settings"] == {x["key"]: x["default"] for x in js._BLOCK_BY_ID[b["block"]]["settings"]}, b
    assert s["blocks"][0]["settings"] == {"tf": "D"}
    out = js.compose("u1", js.get_style("u1", "builtin:trade_plan"), ticker="NVDA", conn=None)
    ids = [n["attrs"]["widgetId"] for n in out["bodyJson"]["content"] if n["type"] == "widgetEmbed"]
    assert ids == ["marketcontext", "chart", "preEntryChecklist", "positionSizing"]
    assert out["properties"]["builtin:regime_at_write"] == "green"
    assert out["styleVersion"] == 2
    # Every block sits at its own placeholder; no placeholder text survives.
    assert not any("{{block:" in _text(n) for n in out["bodyJson"]["content"])
    content = out["bodyJson"]["content"]
    assert _text(content[content.index(_by_id(out["bodyJson"], "positionSizing")) - 1]) == "Size and risk"


def test_a_new_trade_plan_note_captures_its_stamp_and_regime(db_path, monkeypatch):
    """create: the stamp is CAPTURED (readings, capture time) and the regime it was written in is kept."""
    from api.services.journal_two import journal_styles as js
    _green(monkeypatch)
    note, skipped = js.create_styled_note("u1", {"kindId": "trade_plan", "ticker": "NVDA", "title": "plan"})
    assert skipped == []
    assert (note["styleId"], note["styleVersion"]) == ("builtin:trade_plan", 2)
    stamp = _by_id(note["bodyJson"], "marketcontext")["attrs"]
    assert stamp["params"]["readings"]["regime"]["value"] == "green" and stamp["params"]["fields"] == "all"
    assert "uncaptured" not in stamp["params"] and isinstance(stamp["capturedAt"], str)
    sizing = _by_id(note["bodyJson"], "positionSizing")["attrs"]["params"]
    assert (sizing["regimeId"], sizing["grade"]) == ("green", "A")
    assert note["propertiesJson"]["builtin:regime_at_write"] == "green"


def test_an_empty_note_switched_to_trade_plan_v2_is_written_as_a_create(db_path, monkeypatch):
    """insertsOutline: an EMPTY note switched to the Trade plan gets the v2 outline, a captured stamp
    and its regime (R-RC-1: create-equivalent)."""
    from api.services.journal_two import journal_styles as js, notes
    _green(monkeypatch)
    n = notes.create_note("u1", {"title": "empty", "ticker": "NVDA"})
    plan = js.plan_style_update("u1", n["id"], style_id="builtin:trade_plan")
    assert (plan["insertsOutline"], plan["mode"], plan["toVersion"]) == (True, "create", 2)
    note, _ = js.apply_style_update("u1", n["id"], style_id="builtin:trade_plan", expected_updated_at=n["updatedAt"])
    assert [x["attrs"]["widgetId"] for x in _embeds(note["bodyJson"])] == \
        ["marketcontext", "chart", "preEntryChecklist", "positionSizing"]
    stamp = _by_id(note["bodyJson"], "marketcontext")["attrs"]
    assert "uncaptured" not in stamp["params"] and isinstance(stamp["capturedAt"], str)
    assert note["propertiesJson"]["builtin:regime_at_write"] == "green"
    assert (note["styleId"], note["styleVersion"]) == ("builtin:trade_plan", 2)


def test_a_v1_trade_plan_note_gets_the_p2a_blocks_and_an_UNCAPTURED_stamp(db_path, monkeypatch):
    """IR-S11: 'Update layout to v2' never stamps today's market into an older note, and only ADDS."""
    from api.services.journal_two import journal_styles as js, notes, trader_blocks as tb
    _green(monkeypatch)
    n = notes.create_note("u1", {"title": "old", "ticker": "NVDA", "bodyJson": _v1_trade_plan_body()},
                          style_stamp=("builtin:trade_plan", 1, "trade_plan"))
    before = n["bodyJson"]["content"]
    plan = js.plan_style_update("u1", n["id"])
    assert (plan["fromVersion"], plan["toVersion"], plan["versionCurrent"]) == (1, 2, False)
    assert (plan["insertsOutline"], plan["mode"]) == (False, "update")
    assert [a["block"] for a in plan["add"]] == ["preEntryChecklist", "positionSizing", "marketcontext"]
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("an update must not capture"))
    monkeypatch.setattr(tb, "_regime_field", lambda memo: pytest.fail("an update must not read a regime"))
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    stamps = [x for x in note["bodyJson"]["content"]
              if x.get("type") == "widgetEmbed" and x["attrs"]["widgetId"] == "marketcontext"]
    assert len(stamps) == 1 and stamps[0]["attrs"]["params"] == {"uncaptured": True, "fields": "all"}
    assert stamps[0]["attrs"]["capturedAt"] is None
    sizing = _by_id(note["bodyJson"], "positionSizing")["attrs"]["params"]
    assert "regimeId" not in sizing and sizing["grade"] == "A"
    assert "builtin:regime_at_write" not in (note["propertiesJson"] or {})
    # Only ADDS: every node the member had is still there, in order, and the chart is not doubled.
    assert [x for x in note["bodyJson"]["content"] if x not in before and x.get("type") != "widgetEmbed"] == []
    kept = [x for x in note["bodyJson"]["content"] if x in before]
    assert kept == before
    assert len([x for x in _embeds(note["bodyJson"]) if x["attrs"]["widgetId"] == "chart"]) == 1
    assert (note["styleId"], note["styleVersion"]) == ("builtin:trade_plan", 2)
    assert js.plan_style_update("u1", n["id"])["upToDate"] is True


DAILY_PREP_V2 = ["prepWire", "marketcontext", "prepEarnings", "prepMovers", "prepLevels", "myRules"]


def test_daily_prep_v2_and_review_v2_hold_their_packs(db_path, monkeypatch):
    """P2b Task 12: Daily prep v2 carries the prep pack, My rules and the stamp; Post-trade review v2
    carries the review block beside its chart. Each block sits at its own placeholder, in outline order."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import trader_blocks as tb
    _green(monkeypatch)
    monkeypatch.setattr(tb, "prep_part", lambda uid, part, **k: {"part": part, "missing": None})
    dp, pr = js.BUILTIN_STYLES["daily_prep"], js.BUILTIN_STYLES["post_trade_review"]
    assert dp["version"] == 2 and [b["block"] for b in dp["blocks"]] == DAILY_PREP_V2
    assert pr["version"] == 2 and [b["block"] for b in pr["blocks"]] == ["chart", "tradeReview"]
    for s in (dp, pr):
        assert all(b["enabled"] for b in s["blocks"])
        for b in s["blocks"]:
            if b["block"] != "chart":   # the ONE copy of each block's defaults is BLOCK_KINDS
                assert b["settings"] == {x["key"]: x["default"] for x in js._BLOCK_BY_ID[b["block"]]["settings"]}, b
    out = js.compose("u1", js.get_style("u1", "builtin:daily_prep"), ticker=None, conn=None)
    assert [n["attrs"]["widgetId"] for n in _embeds(out["bodyJson"])] == DAILY_PREP_V2
    assert not any("{{block:" in _text(n) for n in out["bodyJson"]["content"])
    content = out["bodyJson"]["content"]
    assert _text(content[content.index(_by_id(out["bodyJson"], "prepEarnings")) - 1]) == "Names on my list"
    assert _text(content[content.index(_by_id(out["bodyJson"], "myRules")) - 1]) == "My plan"
    assert out["styleVersion"] == 2
    out = js.compose("u1", js.get_style("u1", "builtin:post_trade_review"), ticker="NVDA", conn=None)
    assert [n["attrs"]["widgetId"] for n in _embeds(out["bodyJson"])] == ["tradeReview", "chart"]
    assert not any("{{block:" in _text(n) for n in out["bodyJson"]["content"])
    assert out["styleVersion"] == 2


def test_a_v1_daily_prep_note_gets_the_pack_EMPTY_and_keeps_every_word(db_path, monkeypatch):
    """IR-S11 (part b): 'Update layout to v2' on a Daily prep note written under v1 adds the six blocks
    with no snapshot and no captured stamp -- never today's data in an older note -- and only ADDS."""
    from api.services.journal_two import journal_styles as js, notes, trader_blocks as tb
    _green(monkeypatch)
    v1 = {"type": "doc", "content": [
        js._h("The market"), js._p("Tape looked heavy at the open."),
        js._h("Names on my list"), js._p("NVDA, AMD"), js._h("My plan"), js._p("No chasing.")]}
    n = notes.create_note("u1", {"title": "old prep", "bodyJson": v1}, style_stamp=("builtin:daily_prep", 1, "daily_prep"))
    before = n["bodyJson"]["content"]
    plan = js.plan_style_update("u1", n["id"])
    assert (plan["fromVersion"], plan["toVersion"], plan["mode"]) == (1, 2, "update")
    assert sorted(a["block"] for a in plan["add"]) == sorted(DAILY_PREP_V2)
    monkeypatch.setattr(tb, "prep_part", lambda *a, **k: pytest.fail("an update must not read a prep part"))
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("an update must not capture"))
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    body = note["bodyJson"]
    # Update mode adds the missing blocks as one run, in the style's order, right after the first heading.
    assert [x["attrs"]["widgetId"] for x in _embeds(body)] == DAILY_PREP_V2
    first = body["content"].index(_embeds(body)[0])
    assert body["content"][first - 1] == before[0] and body["content"][first:first + 6] == _embeds(body)
    for wid in ("prepWire", "prepEarnings", "prepMovers", "prepLevels"):
        assert "snapshot" not in _by_id(body, wid)["attrs"]["params"], wid
    assert _by_id(body, "marketcontext")["attrs"]["capturedAt"] is None
    assert [x for x in body["content"] if x in before] == before
    assert (note["styleId"], note["styleVersion"]) == ("builtin:daily_prep", 2)
    assert js.plan_style_update("u1", n["id"])["upToDate"] is True


def test_a_v1_post_trade_review_note_gains_an_unpicked_review_block(db_path, monkeypatch):
    """Post-trade review v2's update offers a v1 note the review block with no trade picked, and only ADDS
    (its chart is not doubled)."""
    from api.services.journal_two import journal_styles as js, notes
    _green(monkeypatch)
    v1 = {"type": "doc", "content": [
        js._h("What happened"), js._p("Entry, exit and result:"),
        js._build_chart({"settings": {"tf": "D"}}, {"ticker": "NVDA", "now": NOW})[0],
        js._h("Did I follow my plan?"), js._p("Mostly.")]}
    n = notes.create_note("u1", {"title": "old review", "ticker": "NVDA", "bodyJson": v1},
                          style_stamp=("builtin:post_trade_review", 1, "post_trade_review"))
    before = n["bodyJson"]["content"]
    plan = js.plan_style_update("u1", n["id"])
    assert (plan["fromVersion"], plan["toVersion"], plan["mode"]) == (1, 2, "update")
    assert [a["block"] for a in plan["add"]] == ["tradeReview"]
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    body = note["bodyJson"]
    assert _by_id(body, "tradeReview")["attrs"]["params"] == {"tradeId": ""}
    assert len([x for x in _embeds(body) if x["attrs"]["widgetId"] == "chart"]) == 1
    assert [x for x in body["content"] if x in before] == before
    assert (note["styleId"], note["styleVersion"]) == ("builtin:post_trade_review", 2)
    assert js.plan_style_update("u1", n["id"])["upToDate"] is True


def test_a_my_rules_block_keeps_its_style_setting(db_path):
    """The block reads params.which (MyRulesBlock.jsx); a style that shows ALL rules must compose to that,
    not to the empty params the default happens to cover."""
    from api.services.journal_two import journal_styles as js
    style = {"id": None, "builtin": False, "version": None, "name": "x", "kindId": "thesis",
             "outlineTemplateId": None, "outlineBodyJson": js._doc(js._h("Rules"), js._ph("myRules")),
             "blocks": [{"block": "myRules", "enabled": True, "settings": {"which": "all"}}], "properties": {}}
    out = js.compose("u1", style, ticker=None, conn=None, now=NOW)
    assert _by_id(out["bodyJson"], "myRules")["attrs"]["params"] == {"which": "all"}
    style["blocks"][0]["settings"] = {}
    out = js.compose("u1", style, ticker=None, conn=None, now=NOW)
    assert _by_id(out["bodyJson"], "myRules")["attrs"]["params"] == {"which": "active"}


# -- Tier 2 part B (R-T2B-8): the Earnings follow-up style -----------------------------------------------

def test_the_earnings_followup_style_is_three_headings_and_a_reminder():
    from api.services.journal_two import journal_styles as js
    s = js.BUILTIN_STYLES["earnings_followup"]
    heads = [js._plain(n) for n in s["outline"]["content"] if n.get("type") == "heading"]
    assert heads == list(js.FOLLOWUP_HEADINGS)
    assert [b["block"] for b in s["blocks"]] == ["reminder"] and s["version"] == 1


def test_the_followup_headings_are_the_agreed_sentences_with_straight_apostrophes():
    """followup_prefill (Task 6) finds the first two by their exact text; the third carries the apostrophe
    pre-flight F24 settled as straight everywhere (the NVDA ear's blind spot is the curly one)."""
    from api.services.journal_two import journal_styles as js
    assert js.FOLLOWUP_HEADINGS == ("What I expected", "What happened", "What I'll do differently")
    assert chr(0x2019) not in "".join(js.FOLLOWUP_HEADINGS)       # the curly one


def test_the_followup_outline_ends_on_the_reminder_after_the_last_heading():
    from api.services.journal_two import journal_styles as js
    outline = js.BUILTIN_STYLES["earnings_followup"]["outline"]["content"]
    assert js._plain(outline[-1]) == "{{block:reminder}}"                  # the reminder lands at the end
    last_head = max(i for i, n in enumerate(outline) if n.get("type") == "heading")
    assert js._plain(outline[last_head]) == js.FOLLOWUP_HEADINGS[2] and last_head < len(outline) - 1


def test_composing_the_followup_style_in_create_mode_places_an_unticked_reminder_task(db_path):
    from api.services.journal_two import journal_styles as js, note_tasks
    s = js.get_style("u1", js.builtin_style_id("earnings_followup"))
    out = js.compose("u1", s, ticker="NVDA", conn=None, now=NOW)
    heads = [js._plain(n) for n in out["bodyJson"]["content"] if n.get("type") == "heading"]
    assert heads == list(js.FOLLOWUP_HEADINGS)
    tasks = note_tasks.extract_tasks(out["bodyJson"])
    assert len(tasks) == 1 and tasks[0]["checked"] is False and tasks[0]["due"]       # control: a task WAS placed
    assert "{{block:" not in str(out["bodyJson"])                                       # no placeholder left behind


def test_the_kind_of_note_property_lists_the_new_kind():
    from api.services.journal_two import note_properties as np_
    opts = [o["id"] for o in np_._BUILTIN_BY_ID["builtin:note_kind"]["options"]]
    assert "earnings_followup" in opts
