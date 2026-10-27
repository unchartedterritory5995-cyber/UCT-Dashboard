"""The one composer (spec P1.3): outline body -> block nodes where the outline marks them (a
paragraph that is exactly {{block:<id>}}), the rest after the first heading -> property defaults
-> the kind."""
from __future__ import annotations

import importlib
import os
import tempfile
from datetime import datetime, timezone

import pytest

from tests._style_library_helpers import conn, lib_on  # noqa: F401 -- fixtures (Task 15 gallery rail)

NOW = datetime(2026, 10, 11, 14, 30, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _fresh_pools(monkeypatch):
    """Final review I-4: slots and widget builders each run on a module-level bounded pool, where a test's
    deliberate straggler keeps its permit until it ends. Fresh pools per test keep tests independent."""
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    monkeypatch.setattr(js, "_SLOT_POOL", nw.BoundedPool(js.SLOT_POOL_WORKERS, "nb-style-slot-test"))
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-widget-test"))


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
    # Task 15: the two morning snapshot slots follow the pack in `blocks`, with NO version bump (fix round 1).
    assert dp["version"] == 2 and [b["block"] for b in dp["blocks"]][:6] == DAILY_PREP_V2
    assert pr["version"] == 2 and [b["block"] for b in pr["blocks"]] == ["chart", "tradeReview"]
    for s in (dp, pr):
        assert all(b["enabled"] for b in s["blocks"])
        for b in s["blocks"]:
            if b["block"] != "chart" and b["block"] not in js.SNAPSHOT_SLOT_KINDS:   # the ONE copy of each block's defaults is BLOCK_KINDS
                assert b["settings"] == {x["key"]: x["default"] for x in js._BLOCK_BY_ID[b["block"]]["settings"]}, b
    out = js.compose("u1", js.get_style("u1", "builtin:daily_prep"), ticker=None, conn=None)
    assert [n["attrs"]["widgetId"] for n in _embeds(out["bodyJson"])] == DAILY_PREP_V2
    assert not any("{{block:" in _text(n) for n in out["bodyJson"]["content"])
    content = out["bodyJson"]["content"]
    # Waves off (unset here): the slots vanish, so the pack sits right under its heading as in v2.
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
    assert sorted(a["block"] for a in plan["add"]) == sorted(DAILY_PREP_V2)   # slots are create-only
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


# ── Notebook widgets Task 15: starter styles ship snapshot widgets, filled when the style is applied ──
# Daily prep (the built-in morning style) holds My watchlist today and My names reporting; Weekly review
# holds My P&L and stats, My open positions and risk, My rules check and My recurring mistakes. Each is a
# {{block:<kind>}} slot built by journal_styles._build_widget_slot through notebook_widgets.build, in
# create mode only, and only while the kind's release wave is on.
WEEKLY_SLOTS = ["myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes"]
PREP_SLOTS = ["myWatchlistToday", "myNamesReporting"]


def _waves(monkeypatch, *on):
    for w in range(1, 7):
        if w in on:
            monkeypatch.setenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", "1")
        else:
            monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)


def _fake_build(calls, fail=None):
    fail = fail or {}

    def build(kind, user_id, params, *, now=None):
        calls.append((kind, user_id, params))
        if kind in fail:
            raise fail[kind]
        return {"kind": kind, "asOf": "2026-10-11T14:30:00Z", "source": "broker", "rows": [{"n": 1}]}
    return build


def _slot_embeds(body):
    from api.services.journal_two import notebook_widgets as nw
    return [n for n in _embeds(body) if n["attrs"]["widgetId"] in nw.KIND_WAVE]


def test_applies_only_enabled_kinds(db_path, monkeypatch):
    """Wave 1 on, wave 2 off: the Weekly review places the two wave-1 kinds, and the wave-2 slots vanish
    with NO sentence and no skip entry (a switched-off kind is never offered). Daily prep places both."""
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw, trader_blocks as tb
    _waves(monkeypatch, 1)
    calls = []
    monkeypatch.setattr(nw, "build", _fake_build(calls))
    out = js.compose("u1", js.get_style("u1", "builtin:weekly_review"), ticker=None, conn=None, now=NOW)
    assert [n["attrs"]["widgetId"] for n in _slot_embeds(out["bodyJson"])] == ["myPnlStats", "myPositionsRisk"]
    assert sorted(c[0] for c in calls) == ["myPnlStats", "myPositionsRisk"]           # wave 2 never read
    assert [n["attrs"]["params"]["kind"] for n in _slot_embeds(out["bodyJson"])] == ["myPnlStats", "myPositionsRisk"]
    assert out["skipped"] == []
    words = " ".join(_text(n) for n in out["bodyJson"]["content"])
    assert "{{block:" not in words and "couldn't load" not in words
    # Every word of the outline is still there (slots are added, nothing removed).
    for line in ("The numbers", "Trades, wins, losses and the result:", "Best and worst trade", "One thing to change"):
        assert line in words, line
    # Both waves on: all four, in outline order (the control: wave 2 CAN place).
    _waves(monkeypatch, 1, 2)
    out = js.compose("u1", js.get_style("u1", "builtin:weekly_review"), ticker=None, conn=None, now=NOW)
    assert [n["attrs"]["widgetId"] for n in _slot_embeds(out["bodyJson"])] == WEEKLY_SLOTS
    # Every wave off: nothing placed, nothing read, no sentence.
    _waves(monkeypatch)
    calls.clear()
    out = js.compose("u1", js.get_style("u1", "builtin:weekly_review"), ticker=None, conn=None, now=NOW)
    assert _slot_embeds(out["bodyJson"]) == [] and calls == [] and out["skipped"] == []
    # Daily prep, wave 1 on: both morning kinds, under "Names on my list", ahead of the prep pack's rows.
    _waves(monkeypatch, 1)
    _green(monkeypatch)
    monkeypatch.setattr(tb, "prep_part", lambda uid, part, **k: {"part": part, "missing": None})
    out = js.compose("u1", js.get_style("u1", "builtin:daily_prep"), ticker=None, conn=None, now=NOW)
    assert [n["attrs"]["widgetId"] for n in _slot_embeds(out["bodyJson"])] == PREP_SLOTS
    content = out["bodyJson"]["content"]
    i = content.index(_by_id(out["bodyJson"], "myWatchlistToday"))
    assert _text(content[i - 1]) == "Names on my list"
    assert [n["attrs"]["widgetId"] for n in _embeds(out["bodyJson"])] == [
        "prepWire", "marketcontext", *PREP_SLOTS, "prepEarnings", "prepMovers", "prepLevels", "myRules"]


def test_a_filled_slot_params_equal_the_build_payload(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    _waves(monkeypatch, 1)
    calls = []
    monkeypatch.setattr(nw, "build", _fake_build(calls))
    out = js.compose("u7", js.get_style("u7", "builtin:weekly_review"), ticker=None, conn=None, now=NOW)
    node = _by_id(out["bodyJson"], "myPnlStats")
    payload = _fake_build([])("myPnlStats", "u7", {})
    a = node["attrs"]
    assert a["params"] == payload
    assert (a["v"], a["widgetId"], a["mode"], a["capturedAt"], a["fallback"]) == (
        1, "myPnlStats", "snapshot", payload["asOf"], None)
    assert a["layout"]["width"] == "full" and a["embedId"]
    assert a["embedId"] != _by_id(out["bodyJson"], "myPositionsRisk")["attrs"]["embedId"]
    assert ("myPnlStats", "u7", {}) in calls                                           # the member's OWN id


def test_failed_slot_leaves_sentence(db_path, monkeypatch):
    """A build that raises (a WidgetRequestError, or anything else) leaves ONE sentence, never an empty
    embed; the other slots still fill."""
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    _waves(monkeypatch, 1, 2)
    fail = {"myPnlStats": nw.WidgetRequestError("bad range"), "myMistakes": RuntimeError("db gone")}
    monkeypatch.setattr(nw, "build", _fake_build([], fail))
    out = js.compose("u1", js.get_style("u1", "builtin:weekly_review"), ticker=None, conn=None, now=NOW)
    body = out["bodyJson"]
    assert [n["attrs"]["widgetId"] for n in _slot_embeds(body)] == ["myPositionsRisk", "myRulesCheck"]
    lines = [_text(n) for n in body["content"]]
    assert "My P&L and stats couldn't load. Type / to add it again." in lines
    assert "My recurring mistakes couldn't load. Type / to add it again." in lines
    assert sum("couldn't load" in t for t in lines) == 2
    assert {s["block"] for s in out["skipped"]} == {"myPnlStats", "myMistakes"}


def test_slots_are_create_only_update_layout_never_fills_an_older_note(db_path, monkeypatch):
    """IR-S11: never today's data in an older note. A Weekly review note made before Task 15 is offered no
    widget and reads up to date (no version bump, fix round 1), and the dry run reads nothing."""
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw, notes
    _waves(monkeypatch, 1, 2)
    monkeypatch.setattr(nw, "build", lambda *a, **k: pytest.fail("update layout must not build a widget"))
    v1 = {"type": "doc", "content": [js._h("The numbers"), js._p("Up 2R.")]}
    n = notes.create_note("u1", {"title": "wk", "bodyJson": v1}, style_stamp=("builtin:weekly_review", 1, "weekly_review"))
    plan = js.plan_style_update("u1", n["id"])
    assert (plan["fromVersion"], plan["toVersion"]) == (1, 1)
    assert plan["add"] == [] and plan["missingBlocks"] is False and plan["upToDate"] is True
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    assert note["bodyJson"]["content"] == n["bodyJson"]["content"]


def test_an_empty_note_switched_to_the_style_is_a_create_and_fills(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw, notes
    _waves(monkeypatch, 1)
    calls = []
    monkeypatch.setattr(nw, "build", _fake_build(calls))
    n = notes.create_note("u1", {"title": "blank", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    plan = js.plan_style_update("u1", n["id"], style_id="builtin:weekly_review")
    assert plan["insertsOutline"] is True and calls == []                                # the dry run reads nothing
    assert [a["block"] for a in plan["add"]] == ["myPnlStats", "myPositionsRisk"]
    note, _ = js.apply_style_update("u1", n["id"], style_id="builtin:weekly_review", expected_updated_at=n["updatedAt"])
    assert [x["attrs"]["widgetId"] for x in _slot_embeds(note["bodyJson"])] == ["myPnlStats", "myPositionsRisk"]
    # Audit I-4: concurrent slots, so the SET of builds (each once, by the write) and the PLACED order.
    assert sorted(c[0] for c in calls) == ["myPnlStats", "myPositionsRisk"]
    assert [x["attrs"]["params"]["kind"] for x in _slot_embeds(note["bodyJson"])] == ["myPnlStats", "myPositionsRisk"]


def test_the_starter_styles_hold_their_slots_with_no_version_bump():
    """Fix round 1: slots are create-only, so a version bump would buy nothing and re-arm the banner."""
    from api.services.journal_two import journal_styles as js
    wr, dp = js.BUILTIN_STYLES["weekly_review"], js.BUILTIN_STYLES["daily_prep"]
    assert wr["version"] == 1 and dp["version"] == 2
    assert [b["block"] for b in wr["blocks"]] == WEEKLY_SLOTS
    assert [b["block"] for b in dp["blocks"]] == DAILY_PREP_V2 + PREP_SLOTS
    for s, slots in ((wr, WEEKLY_SLOTS), (dp, PREP_SLOTS)):
        holders = [js._placeholder_kind(n) for n in s["outline"]["content"]]
        assert [h for h in holders if h in slots] == slots


def test_the_server_kind_titles_match_the_client_widget_kinds():
    import re
    from pathlib import Path
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    src = Path("app/src/pages/journal-2-0/lib/notebookWidgets.js").read_text(encoding="utf-8")
    start = src.index("export const WIDGET_KINDS")
    block = src[start:src.index("])", start)]
    client = dict(re.findall(r"\{ id: '(\w+)'.*?title: '([^']+)'", block, flags=re.S))
    assert len(client) == 23                                                             # non-vacuity
    assert nw.KIND_TITLE == client
    assert set(js.SNAPSHOT_SLOT_KINDS) <= set(nw.KIND_TITLE)



#: Task 11.14: the six wave 10 dedicated kinds a template may hold (Task 11.3 appends them to
#: journal_styles.SNAPSHOT_SLOT_KINDS on the backend branch). Named here so this rail checks them on both branches.
_WAVE10_SLOT_KINDS = ("myRiskLeftToday", "myGamePlan", "myTiltCheck", "myRevengeClean", "myPropFirm", "myAlertsFired")


def test_the_client_names_every_slot_kind_by_the_servers_title():
    """Task 11.14: journalBlocks.SNAPSHOT_BLOCK_LABELS names every snapshot kind a style may place by the server's
    notebook_widgets.KIND_TITLE, read from the client file, never restated."""
    import re
    from pathlib import Path
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    src = Path("app/src/pages/journal-2-0/lib/journalBlocks.js").read_text(encoding="utf-8")
    start = src.index("export const SNAPSHOT_BLOCK_LABELS")
    block = src[start:src.index("})", start)]
    client = dict(re.findall(r"^\s+(\w+): '([^']+)',", block, flags=re.M))
    kinds = list(dict.fromkeys([*js.SNAPSHOT_SLOT_KINDS, *_WAVE10_SLOT_KINDS]))
    assert len(kinds) == 12                                                               # non-vacuity
    assert client == {k: nw.KIND_TITLE[k] for k in kinds}

def _client_widget_rows():
    """{id: row text} for each WIDGET_KINDS row in the client file, read from the file, never restated."""
    import re
    from pathlib import Path
    src = Path("app/src/pages/journal-2-0/lib/notebookWidgets.js").read_text(encoding="utf-8")
    start = src.index("export const WIDGET_KINDS")
    block = src[start:src.index("])", start)]
    rows = re.findall(r"\{ id: '(\w+)'(.*?)\}", block, flags=re.S)
    return {kid: body for kid, body in rows}


def test_account_kinds_agree_client_server_and_public_table():
    """Final review M-4: "account kind" has three authorities -- the client's `account: true` (drives the
    archive rule and the lock chip), the server's ACCOUNT_KINDS, and the public table's rows.
    A client flag drifting to false would archive a private widget to a PNG, so all three are railed.

    Task 10.14: an account kind is one of TWO public kinds, and the rule is stated for each. The phase 1 account
    kinds (and the built widget) are "member-optin": neutral unless the member switches `share` on, then only
    their EMBED_PARAM_KEYS. The seven ready-made dedicated kinds (`shelf_kind_names.KINDS`) are "private": the
    neutral line on every public page, `share` or not, so they have no allowlist at all."""
    import re
    from api.services.journal_two import notebook_widgets as nw, public_note_payload as public
    from api.services.journal_two import shelf_kind_names
    rows = _client_widget_rows()
    assert len(rows) == 23                                                               # non-vacuity
    client = {k for k, body in rows.items() if re.search(r"\baccount: true\b", body)}
    widget_rows = {d: v for (t, d), v in public.MARKET_DATA_VENDORS.items() if t == "widgetEmbed"}
    optin = {d for d, v in widget_rows.items() if v == "member-optin"}
    dedicated = set(shelf_kind_names.KINDS)
    assert len(client) == 15 and len(optin) == 8 and len(dedicated) == 7                 # non-vacuity
    assert client == set(nw.ACCOUNT_KINDS)
    assert set(nw.ACCOUNT_KINDS) == optin | dedicated and not optin & dedicated
    assert {k: widget_rows[k] for k in dedicated} == {k: "private" for k in dedicated}
    assert optin <= set(public.EMBED_PARAM_KEYS)
    assert not dedicated & set(public.EMBED_PARAM_KEYS) and not dedicated & set(public.EMBED_ROW_KEYS)


def test_client_waves_match_the_server_kind_wave():
    """Final review M-4: the client's `wave` (which gates the menu entry) is the server's KIND_WAVE (which
    gates the read)."""
    import re
    from api.services.journal_two import notebook_widgets as nw
    client = {}
    for k, body in _client_widget_rows().items():
        m = re.search(r"\bwave: (\d+)", body)
        assert m, k
        client[k] = int(m.group(1))
    assert len(client) == 23                                                             # non-vacuity
    assert client == nw.KIND_WAVE


def test_gallery_template_has_no_payload(conn, lib_on, monkeypatch):
    """A member style shared to the gallery carries its slots as unfilled placeholders: publishing builds
    nothing, a snapshot the member's outline held is reduced away, and the library's Preview (the journal
    styles preview door) names the widget instead of reading the viewer's account."""
    import json as _json
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    from api.services.journal_two import template_gallery as gallery
    _waves(monkeypatch, 1, 2)
    monkeypatch.setattr(nw, "build", lambda *a, **k: pytest.fail("the gallery must never build a widget"))
    secret = {"kind": "myMistakes", "asOf": "2026-10-11T14:30:00Z", "source": "broker",
              "rows": [{"mistake": "SECRET-CHASE", "cost30d": -1234.5}]}
    filled = {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "myMistakes", "embedId": "e1", "mode": "snapshot", "params": secret,
        "capturedAt": secret["asOf"], "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None}}
    s = js.create_style("author", {"name": "My week", "kindId": "weekly_review",
                                   "outlineBodyJson": {"type": "doc", "content": [
                                       js._h("The numbers"), js._ph("myPnlStats"), filled]},
                                   "blocks": [{"block": "myPnlStats", "enabled": True, "settings": {}}]}, conn)
    item = gallery.publish_style("author", s["id"], title="My week", description="", category="journal",
                                 trading_style=None, conn=conn)
    got = gallery.get_item("admin", item["id"], is_admin=True, conn=conn)
    stored = _json.dumps(got["payload"]) + _json.dumps(got.get("bodyJson"))
    assert "SECRET-CHASE" not in stored and "-1234.5" not in stored
    assert [b["block"] for b in got["payload"]["blocks"]] == ["myPnlStats"]               # the slot travels
    assert "{{block:myPnlStats}}" in stored                                               # ...as a placeholder
    prev = js.preview("viewer", {"style": got["payload"]}, conn)
    body = prev["bodyJson"]
    assert [n for n in _slot_embeds(body) if n["attrs"]["widgetId"] == "myPnlStats"] == []
    assert "My P&L and stats fills in with your own data when you make a note." in [_text(n) for n in body["content"]]


# ── Task 15 fix round 1: slots are built LAST, under their own SLOT_BUDGET_S ─────────────────────────────

def test_slots_never_spend_the_prep_packs_read_budget(db_path, monkeypatch):
    """Review I-1: a slow prep read plus slots that take time. The slots sit between marketcontext and
    prepEarnings in the outline; built there, they would push prepEarnings/Movers/Levels past the create
    budget. Built LAST, the pack is captured with no budget reason, and the slots still fill in place."""
    import time as _t
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw, trader_blocks as tb
    _waves(monkeypatch, 1)
    _green(monkeypatch)
    monkeypatch.setattr(tb, "PREP_CREATE_BUDGET_S", 0.7)
    real_breadth = tb._breadth
    monkeypatch.setattr(tb, "_breadth", lambda *a, **k: (_t.sleep(0.3), real_breadth(*a, **k))[1])   # the slow prep read
    monkeypatch.setattr(tb, "prep_part", lambda uid, part, memo=None, **k: (
        tb._spend(memo) if memo is not None else None, {"part": part, "missing": None})[1])

    def slow_build(kind, user_id, params, *, now=None):
        _t.sleep(0.3)                                                   # 2 x 0.3 s: past what the pack has left
        return {"kind": kind, "asOf": "2026-10-11T14:30:00Z", "source": "market", "rows": []}
    monkeypatch.setattr(nw, "build", slow_build)
    out = js.compose("u1", js.get_style("u1", "builtin:daily_prep"), ticker=None, conn=None)
    body = out["bodyJson"]
    for wid in ("prepEarnings", "prepMovers", "prepLevels"):
        assert "snapshot" in _by_id(body, wid)["attrs"]["params"], wid   # captured, not budget-stopped
    mc = _by_id(body, "marketcontext")["attrs"]
    assert mc["params"].get("reason") != "budget" and mc["capturedAt"], mc
    assert [n["attrs"]["widgetId"] for n in _embeds(body)] == [
        "prepWire", "marketcontext", *PREP_SLOTS, "prepEarnings", "prepMovers", "prepLevels", "myRules"]
    assert not any("__uctSlot" in n for n in body["content"])                # no marker survives


def test_a_slow_build_degrades_every_slot_to_its_sentence_inside_the_slot_budget(db_path, monkeypatch):
    """Review I-2: every build hangs. The create returns under 3 s + SLOT_BUDGET_S + 1 s and each slot is
    its "couldn't load" sentence (never an empty embed)."""
    import threading
    import time as _t
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    _waves(monkeypatch, 1, 2)
    release = threading.Event()
    started = []

    def hang(kind, user_id, params, *, now=None):
        started.append(kind)
        release.wait(30)
        return {"asOf": "x", "source": "broker"}
    monkeypatch.setattr(nw, "build", hang)
    try:
        t0 = _t.monotonic()
        n, skipped = js.create_styled_note("u1", {"kindId": "weekly_review", "title": "Week"})
        took = _t.monotonic() - t0
    finally:
        release.set()
    assert took < 3.0 + js.SLOT_BUDGET_S + 1.0, took
    assert sorted(started) == sorted(WEEKLY_SLOTS)                        # non-vacuity: every slot was asked
    lines = [_text(x) for x in n["bodyJson"]["content"]]
    for title in ("My P&L and stats", "My open positions and risk", "My rules check", "My recurring mistakes"):
        assert f"{title} couldn't load. Type / to add it again." in lines, title
    assert _slot_embeds(n["bodyJson"]) == []
    assert {s["block"] for s in skipped} == set(WEEKLY_SLOTS)


def test_a_v2_daily_prep_note_missing_a_pack_block_reads_as_it_did_before(db_path, monkeypatch):
    """Review I-3: no version bump, so a v2 note the member deleted prepMovers from is still version-current
    (StyleUpdateBanner shows only on `!versionCurrent && missingBlocks`): no banner, and the sheet offers
    exactly the deleted block, as before Task 15."""
    from api.services.journal_two import journal_styles as js, notes, trader_blocks as tb
    _waves(monkeypatch, 1, 2)
    _green(monkeypatch)
    monkeypatch.setattr(tb, "prep_part", lambda uid, part, **k: {"part": part, "missing": None})
    body = js.compose("u1", js.get_style("u1", "builtin:daily_prep"), ticker=None, conn=None)["bodyJson"]
    body["content"] = [x for x in body["content"]
                       if not (x.get("type") == "widgetEmbed" and x["attrs"]["widgetId"] in ("prepMovers", *PREP_SLOTS))]
    n = notes.create_note("u1", {"title": "prep", "bodyJson": body}, style_stamp=("builtin:daily_prep", 2, "daily_prep"))
    plan = js.plan_style_update("u1", n["id"])
    assert (plan["fromVersion"], plan["toVersion"], plan["versionCurrent"]) == (2, 2, True)
    assert [a["block"] for a in plan["add"]] == ["prepMovers"] and plan["missingBlocks"] is True
    assert not (not plan["versionCurrent"] and plan["missingBlocks"])        # the banner's rule: no banner


def test_save_as_style_on_a_note_holding_a_snapshot_widget(db_path):
    """Review minor 1: the slot becomes a bare style block and its payload never reaches the outline."""
    import json as _json
    from api.services.journal_two import journal_styles as js, notes
    secret = {"kind": "myMistakes", "asOf": "2026-10-11T14:30:00Z", "source": "broker",
              "rows": [{"mistake": "SECRET-CHASE", "cost30d": -1234.5}]}
    body = {"type": "doc", "content": [js._h("The numbers"), {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "myMistakes", "embedId": "e1", "mode": "snapshot", "params": secret,
        "capturedAt": secret["asOf"], "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None}}]}
    n = notes.create_note("u1", {"title": "wk", "bodyJson": body})
    style = js.create_style_from_note("u1", n["id"], "From my week", "weekly_review")
    full = js.get_style("u1", style["id"], full=True)
    assert full["blocks"] == [{"block": "myMistakes", "enabled": True, "settings": {}}]
    stored = _json.dumps(full.get("outlineBodyJson"))
    assert "SECRET-CHASE" not in stored and "{{block:myMistakes}}" in stored


# ── Notebook widgets Task 18 (C18, ruling R50): member note presets with live slots ────────────────────
# "Save as style" on a note turns each snapshot widget into a {{block:<kind>}} slot at its place, keeping only
# the builder's request keys (R4) as the block's settings. Applying the style refills every slot through the
# Task 15 server path. A gallery copy ships every slot's settings empty.

def _snap(kind, payload):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": kind, "embedId": "e-" + kind, "mode": "snapshot", "params": payload,
        "capturedAt": payload.get("asOf"), "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None}}


# The frozen payloads a member's note holds: settings keys beside the member's own figures.
_WATCH = {"kind": "myWatchlistToday", "asOf": "2026-10-11T14:30:00Z", "source": "market",
          "listLabel": "Flagged", "rows": [{"symbol": "SECRETSYM", "pct": 4.2}], "share": True}
_PNL = {"kind": "myPnlStats", "asOf": "2026-10-11T14:30:00Z", "source": "broker",
        "from": "2026-10-01", "to": "2026-10-09", "netPnl": 51234.5, "accountSize": 250000,
        "range": {"from": "2026-10-01", "to": "2026-10-09"}, "rows": [{"n": 7}], "share": False}
_RISK = {"kind": "myPositionsRisk", "asOf": "2026-10-11T14:30:00Z", "source": "mixed",
         "positions": [{"symbol": "SECRETPOS", "risk": 812.0}], "accountSize": 250000}
_NOTE_ORDER = ["myWatchlistToday", "myPnlStats", "myPositionsRisk"]


def _note_with_widgets(notes, js):
    body = {"type": "doc", "content": [
        js._h("My week"), js._p("Names first."), _snap("myWatchlistToday", _WATCH),
        js._h("The numbers"), _snap("myPnlStats", _PNL), js._p("Then risk."), _snap("myPositionsRisk", _RISK)]}
    return notes.create_note("u1", {"title": "wk", "bodyJson": body})


def test_slots_hold_settings_not_data(db_path):
    """Every snapshot widget becomes a slot at its place; the slot keeps the builder's request keys and
    nothing else (the list is recovered from listLabel, like the client's presetParams). No figure, row or
    share switch reaches the saved style, through Save as style or through a hand-made style."""
    import json as _json
    from api.services.journal_two import journal_styles as js, notes
    n = _note_with_widgets(notes, js)
    s = js.create_style_from_note("u1", n["id"], "My week", "weekly_review")
    full = js.get_style("u1", s["id"], full=True)
    assert full["blocks"] == [
        {"block": "myWatchlistToday", "enabled": True, "settings": {"list": "flagged"}},
        {"block": "myPnlStats", "enabled": True, "settings": {"from": "2026-10-01", "to": "2026-10-09"}},
        {"block": "myPositionsRisk", "enabled": True, "settings": {}}]
    holders = [js._placeholder_kind(x) for x in full["outlineBodyJson"]["content"]]
    assert [h for h in holders if h] == _NOTE_ORDER                       # each slot at its own place
    stored = _json.dumps(full)
    for word in ("netPnl", "rows", "positions", "accountSize", "share", "SECRETSYM", "SECRETPOS", "51234.5"):
        assert word not in stored, word
    # The same reduction on a style a client writes by hand: data in a slot's settings never lands.
    hand = js.create_style("u1", {"name": "Hand", "kindId": "weekly_review", "blocks": [
        {"block": "myPnlStats", "enabled": True, "settings": dict(_PNL)}]})
    got = js.get_style("u1", hand["id"], full=True)["blocks"]
    assert got == [{"block": "myPnlStats", "enabled": True, "settings": {"from": "2026-10-01", "to": "2026-10-09"}}]


def test_apply_refills_each_slot(db_path, monkeypatch):
    """Applying a member style fills each slot through notebook_widgets.build, with the slot's settings as
    params and the applier's own id; the node holds today's payload. A kind whose wave is off is skipped
    with no sentence (Task 15's behaviour), whatever the style was saved with."""
    import json as _json
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    s = js.create_style("u1", {"name": "Mine", "kindId": "weekly_review",
                               "outlineBodyJson": {"type": "doc", "content": [
                                   js._h("Week"), js._ph("myWatchlistToday"), js._ph("myRulesCheck"),
                                   js._ph("myPnlStats")]},
                               "blocks": [{"block": "myWatchlistToday", "enabled": True, "settings": {"list": "flagged"}},
                                          {"block": "myRulesCheck", "enabled": True, "settings": {}},
                                          {"block": "myPnlStats", "enabled": True, "settings": {"from": "2026-10-01"}}]})
    calls = []
    monkeypatch.setattr(nw, "build", _fake_build(calls))
    _waves(monkeypatch, 1)                                                # wave 2 (myRulesCheck) off
    note, skipped = js.create_styled_note("u1", {"styleId": s["id"], "title": "today"})
    # Robustness audit I-4: slots build CONCURRENTLY, so the order build was CALLED is not a contract
    # (it differed in 7/3000 runs on a fresh pool, 1361/3000 on a warm one). The contract is WHICH builds
    # ran, and the ORDER the embeds were placed in (railed below, each embed holding its own kind's payload).
    assert sorted(calls, key=repr) == sorted([("myWatchlistToday", "u1", {"list": "flagged"}),
                                              ("myPnlStats", "u1", {"from": "2026-10-01"})], key=repr)
    embeds = _slot_embeds(note["bodyJson"])
    assert [e["attrs"]["widgetId"] for e in embeds] == ["myWatchlistToday", "myPnlStats"]
    assert [e["attrs"]["params"]["kind"] for e in embeds] == ["myWatchlistToday", "myPnlStats"]
    assert all(e["attrs"]["params"]["rows"] == [{"n": 1}] for e in embeds)          # today's payload
    assert skipped == [] and "{{block:" not in _json.dumps(note["bodyJson"])
    # The control: wave 2 on, the third slot fills too.
    _waves(monkeypatch, 1, 2)
    calls.clear()
    note, _ = js.create_styled_note("u1", {"styleId": s["id"], "title": "today 2"})
    assert sorted(c[0] for c in calls) == sorted(["myWatchlistToday", "myRulesCheck", "myPnlStats"])
    placed = _slot_embeds(note["bodyJson"])
    assert [e["attrs"]["widgetId"] for e in placed] == ["myWatchlistToday", "myRulesCheck", "myPnlStats"]
    assert [e["attrs"]["params"]["kind"] for e in placed] == ["myWatchlistToday", "myRulesCheck", "myPnlStats"]


def test_member_preset_round_trip_refills_slots_in_order(db_path, monkeypatch):
    """A note with widgets -> Save as style -> apply to a new note: the same kinds, in the same order, each
    built fresh with the settings it was saved with; none of the old figures comes back."""
    import json as _json
    from api.services.journal_two import journal_styles as js, notes, notebook_widgets as nw
    n = _note_with_widgets(notes, js)
    s = js.create_style_from_note("u1", n["id"], "My week", "weekly_review")
    _waves(monkeypatch, 1)
    calls = []
    monkeypatch.setattr(nw, "build", _fake_build(calls))
    fresh, skipped = js.create_styled_note("u1", {"styleId": s["id"], "title": "next week"})
    placed = _slot_embeds(fresh["bodyJson"])
    assert [e["attrs"]["widgetId"] for e in placed] == _NOTE_ORDER
    assert [e["attrs"]["params"]["kind"] for e in placed] == _NOTE_ORDER      # each slot holds its own build
    # Audit I-4: the set of builds, never the order they were called in (the slots run concurrently).
    assert sorted(calls, key=repr) == sorted([("myWatchlistToday", "u1", {"list": "flagged"}),
                                              ("myPnlStats", "u1", {"from": "2026-10-01", "to": "2026-10-09"}),
                                              ("myPositionsRisk", "u1", {})], key=repr)
    words = [_text(x) for x in fresh["bodyJson"]["content"]]
    assert "Names first." in words and "Then risk." in words and skipped == []
    dumped = _json.dumps(fresh["bodyJson"])
    assert "SECRETSYM" not in dumped and "51234.5" not in dumped and "SECRETPOS" not in dumped


def test_gallery_publish_empties_slots(conn, lib_on, monkeypatch):
    """A member style shared to the gallery ships every slot with empty settings: a ticker or a list is the
    author's, a template is a scaffold. The author's own style keeps its settings."""
    import json as _json
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    from api.services.journal_two import template_gallery as gallery
    monkeypatch.setattr(nw, "build", lambda *a, **k: pytest.fail("the gallery must never build a widget"))
    s = js.create_style("author", {"name": "My week", "kindId": "weekly_review",
                                   "outlineBodyJson": {"type": "doc", "content": [
                                       js._h("Week"), js._ph("myWatchlistToday"), js._ph("myPnlStats")]},
                                   "blocks": [{"block": "myWatchlistToday", "enabled": True,
                                               "settings": {"list": "flagged"}},
                                              {"block": "myPnlStats", "enabled": True,
                                               "settings": {"from": "2026-10-01", "to": "2026-10-09"}}]}, conn)
    item = gallery.publish_style("author", s["id"], title="My week", description="", category="journal",
                                 trading_style=None, conn=conn)
    got = gallery.get_item("admin", item["id"], is_admin=True, conn=conn)
    assert got["payload"]["blocks"] == [{"block": "myWatchlistToday", "enabled": True, "settings": {}},
                                        {"block": "myPnlStats", "enabled": True, "settings": {}}]
    stored = _json.dumps(got["payload"])
    assert "flagged" not in stored and "2026-10-01" not in stored
    mine = js.get_style("author", s["id"], conn, full=True)["blocks"]        # the author's copy is untouched
    assert [b["settings"] for b in mine] == [{"list": "flagged"}, {"from": "2026-10-01", "to": "2026-10-09"}]


def test_the_slot_setting_keys_match_the_client_settings_keys():
    """One list of request keys: the server's (notebook_widgets.SETTING_KEYS, which the router passes
    through) and the client's SETTINGS_KEYS in notebookSets.js, read from the file, never restated."""
    import re
    from pathlib import Path
    from api.routers import notebook_widgets as router
    from api.services.journal_two import notebook_widgets as nw
    src = Path("app/src/pages/journal-2-0/lib/notebookSets.js").read_text(encoding="utf-8")
    m = re.search(r"export const SETTINGS_KEYS = Object\.freeze\(\[([^\]]*)\]\)", src)
    client = re.findall(r"'(\w+)'", m.group(1))
    assert len(client) == 7                                                          # non-vacuity
    assert tuple(client) == nw.SETTING_KEYS == router.PASS_PARAMS


def test_a_saturated_slot_pool_answers_each_slot_sentence_at_once(db_path, monkeypatch):
    """Final review I-4: the slot builder has its OWN bounded pool (never the widget builders' shared one,
    which a slot task waits on). When it is saturated, each slot is its "couldn't load" sentence AT ONCE:
    nothing queues, and no build is asked for."""
    import time as _t
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    assert js._slot_pool() is not nw._POOL                                   # two pools, by construction
    _waves(monkeypatch, 1, 2)
    full = nw.BoundedPool(1, "nb-style-slot-full")
    assert full._slots.acquire(blocking=False)
    monkeypatch.setattr(js, "_SLOT_POOL", full)
    asked = []
    monkeypatch.setattr(nw, "build", lambda kind, *a, **k: asked.append(kind) or {"asOf": "x", "source": "broker"})
    t0 = _t.monotonic()
    n, skipped = js.create_styled_note("u1", {"kindId": "weekly_review", "title": "Week"})
    assert _t.monotonic() - t0 < js.SLOT_BUDGET_S
    assert asked == []
    lines = [_text(x) for x in n["bodyJson"]["content"]]
    for kind in WEEKLY_SLOTS:
        assert f"{nw.KIND_TITLE[kind]} couldn't load. Type / to add it again." in lines, kind
    assert _slot_embeds(n["bodyJson"]) == []



def test_the_w3_ledger_note_says_what_the_starter_styles_hold():
    """F1 cleanup queue: the W3 note said wave 3 carried "the starter styles that hold widgets". The starter
    styles' slots are wave 1 and wave 2 kinds, each gated by its own wave. Derived from the styles, so the
    note goes red the day a starter style gains a slot of another wave."""
    import json as _json
    from pathlib import Path
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    waves = {nw.KIND_WAVE[b["block"]] for s in js.BUILTIN_STYLES.values() for b in s["blocks"]
             if b["block"] in nw.KIND_WAVE}
    assert waves == {1, 2}
    ledger = _json.loads(Path("docs/feature_flags.json").read_text(encoding="utf-8"))
    note = next(v for k, v in _iter_flags(ledger) if k == "NOTEBOOK_WIDGETS_W3_ENABLED")["note"]
    assert "starter styles that hold widgets" not in note
    assert "starter styles hold wave 1 and wave 2 widgets" in note


def _iter_flags(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, dict) and "note" in v and k.isupper():
                yield k, v
            yield from _iter_flags(v)


def test_a_styled_create_passes_its_note_day_answers_and_choices_to_compose(db_path, monkeypatch):
    """Task 11.6: `create_styled_note` composes with the note's day (`tool_binding.note_day`, from the moment it is
    made; a styled note has no daily date), and the payload's `answers` and `choices`. Not-object answers are
    refused with one sentence before anything is written."""
    from api.services.journal_two import journal_styles as js, tool_binding
    seen: dict = {}
    real = js.compose

    def spy(*a, **k):
        seen.update(k)
        return real(*a, **k)
    monkeypatch.setattr(js, "compose", spy)
    days = []
    real_day = tool_binding.note_day
    monkeypatch.setattr(tool_binding, "note_day", lambda **k: days.append(k) or real_day(**k))
    note, _ = js.create_styled_note("u1", {"kindId": "trade_plan", "title": "x", "answers": {"p1": "A+"},
                                           "choices": {"routine_a": {"create": True}}})
    assert days and days[0]["daily_date"] is None and days[0]["created_at"] == seen["now"].isoformat()
    assert seen["note_day"] == real_day(daily_date=None, created_at=seen["now"].isoformat(), now=seen["now"])
    assert seen["answers"] == {"p1": "A+"} and seen["choices"] == {"routine_a": {"create": True}}
    for bad in ({"answers": []}, {"choices": "create"}):
        with pytest.raises(js.StyleValidationError) as e:
            js.create_styled_note("u1", {"kindId": "trade_plan", "title": "y", **bad})
        assert str(e.value) == js.S_BAD_ANSWERS
