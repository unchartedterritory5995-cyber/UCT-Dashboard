"""P2 Tier 3 final fix M1: with JOURNAL_TIER3_ENABLED off, applying a style creates no check-in block.

The switch gates CREATING a Tier 3 block. The client hides the slash item and the style editor's toggle
(`tier3Flag.isTier3Block`); a style made while the switch was on and applied after it is turned off still
listed the block, and `journal_styles` built it. Now both of the style's writers drop it the way the insert
menu hides it, silently (no node, no skip line): `compose` (a new note, and an empty note switched to a
style) and `_plan` (Update layout on a written note). An existing check-in still renders and saves: the
switch never reaches a body already written.

⛔ ONE FACT IN TWO FILES: `trader_blocks.TIER3_BLOCK_IDS` is the client's `TIER3_BLOCK_IDS` in
app/src/pages/journal-2-0/lib/tier3Flag.js. The pin below READS the client file (comments stripped).
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

import pytest

from api.services.journal_two import checklist_suggestions as cs

ROOT = Path(__file__).resolve().parents[1]
CLIENT_FLAG = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "tier3Flag.js"


@pytest.fixture
def conn():
    from api.services.journal_two.db import ensure_schema
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _style(blocks, outline=None):
    return {"id": "s1", "name": "Daily", "version": 1, "kindId": "daily", "outlineTemplateId": None,
            "outlineBodyJson": outline, "blocks": blocks, "properties": {}}


def _block_ids(body):
    found = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "widgetEmbed":
                found.append((node.get("attrs") or {}).get("widgetId"))
            for child in node.get("content") or []:
                walk(child)

    walk(body)
    return found


BLOCKS = [{"block": "moodCheckIn", "enabled": True, "settings": {}},
          {"block": "priceStamps", "enabled": True, "settings": {}}]


@pytest.mark.parametrize("mode", ["create", "update"])
def test_compose_drops_the_check_in_with_the_switch_off_and_keeps_it_on(conn, monkeypatch, mode):
    from api.services.journal_two import journal_styles as js
    monkeypatch.setenv(cs.FLAG, "false")
    off = js.compose("u1", _style(BLOCKS), ticker=None, conn=conn, mode=mode)
    assert _block_ids(off["bodyJson"]) == ["priceStamps"]
    assert off["skipped"] == []                        # hidden, exactly as the insert menu hides it
    monkeypatch.setenv(cs.FLAG, "true")                # control: the same style builds it with the switch on
    on = js.compose("u1", _style(BLOCKS), ticker=None, conn=conn, mode=mode)
    assert _block_ids(on["bodyJson"]) == ["moodCheckIn", "priceStamps"]


def test_compose_drops_a_placed_check_in_placeholder_with_the_switch_off(conn, monkeypatch):
    from api.services.journal_two import journal_styles as js
    outline = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Today"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "{{block:moodCheckIn}}"}]}]}
    monkeypatch.delenv(cs.FLAG, raising=False)         # unset is OFF (an enablement gate)
    out = js.compose("u1", _style(BLOCKS[:1], outline), ticker=None, conn=conn, mode="create")
    assert "moodCheckIn" not in json.dumps(out["bodyJson"])
    assert out["skipped"] == []


def test_a_check_in_node_already_in_the_outline_is_dropped_with_the_switch_off(conn, monkeypatch):
    """Ruling R-T3-FIN-4 (completes M1): an outline (a member template, or the style's own) can already
    HOLD a check-in node, at the top level or inside a container. With the switch off it is dropped
    like a built block; the rest of the outline survives."""
    from api.services.journal_two import journal_styles as js
    node = {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "moodCheckIn", "embedId": "ci-o",
                                              "params": {"mood": "", "focus": "", "day": ""}}}
    outline = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Today"}]},
        node,
        {"type": "columns", "content": [{"type": "column", "content": [
            node, {"type": "paragraph", "content": [{"type": "text", "text": "kept"}]}]}]}]}
    monkeypatch.setenv(cs.FLAG, "false")
    off = js.compose("u1", _style([], outline), ticker=None, conn=conn, mode="create")
    assert _block_ids(off["bodyJson"]) == []
    assert "kept" in json.dumps(off["bodyJson"]) and "Today" in json.dumps(off["bodyJson"])
    assert off["skipped"] == []
    monkeypatch.setenv(cs.FLAG, "true")                # control: kept with the switch on
    on = js.compose("u1", _style([], outline), ticker=None, conn=conn, mode="create")
    assert _block_ids(on["bodyJson"]) == ["moodCheckIn", "moodCheckIn"]


def test_update_layout_neither_offers_nor_adds_the_check_in_with_the_switch_off(conn, monkeypatch):
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import notes as notes_service
    note = notes_service.create_note("u1", {"title": "Day", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "written"}]}]}}, conn=conn)
    row = conn.execute("SELECT * FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()
    body = json.loads(row["body_json"])
    monkeypatch.setattr(js, "get_style", lambda _u, _sid, _c: _style(BLOCKS))
    monkeypatch.setenv(cs.FLAG, "false")
    _, built, plan = js._plan("u1", row, body, "s1", conn)
    assert [b["block"] for b, _ in built] == ["priceStamps"]
    assert [a["block"] for a in plan["add"]] == ["priceStamps"] and plan["skipped"] == []
    monkeypatch.setenv(cs.FLAG, "true")                # control
    _, built_on, _ = js._plan("u1", row, body, "s1", conn)
    assert [b["block"] for b, _ in built_on] == ["moodCheckIn", "priceStamps"]


def _client_tier3_ids():
    src = CLIENT_FLAG.read_text(encoding="utf-8")
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)//.*$", "", src)
    m = re.search(r"TIER3_BLOCK_IDS\s*=\s*Object\.freeze\(\[(.*?)\]\)", src, flags=re.S)
    assert m, "TIER3_BLOCK_IDS not found in tier3Flag.js"
    return tuple(re.findall(r"'([^']+)'", m.group(1)))


def test_the_server_gates_exactly_the_blocks_the_client_gates():
    from api.services.journal_two import trader_blocks as tb
    client = _client_tier3_ids()
    assert client, "non-vacuity: the client list was read"
    assert tuple(tb.TIER3_BLOCK_IDS) == client
    assert set(client) <= set(tb.BLOCK_IDS)            # each is a real trader block
