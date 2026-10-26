"""Notebook widgets phase 2, wave 11, Task 11.3: template slot ids in the journal-styles grammar.

A template slot is a block id the UNCHANGED `BLOCK_ID_RE` / `PLACEHOLDER_RE` already accept (`built_<k>`,
`routine_<k>`, `tracker_<k>`); its target lives in the block's settings, reduced on every write by
`journal_styles.slot_settings_of` (ruling W11-R2). `KNOWN_BLOCKS` is a prefix test (W11-R3), and ONE function,
`_slot_wave_off`, decides whether a slot is shown."""
from __future__ import annotations

import ast
import importlib
import os
import sys
import tempfile
import types
from pathlib import Path

import pytest

UUID = "3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f"         # a canonical uuid4
SHELF_ID, SHELF_REV_PLAIN, SHELF_REV_W10 = "shelf:equity-curve", 1, 2   # r2 uses_wave10, r1 needs no dark wave
API_DIR = Path("api")


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


def _waves(monkeypatch, *on):
    for w in range(1, 13):
        if w in on:
            monkeypatch.setenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", "1")
        else:
            monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)


ALL_ON = (1, 2, 3, 4, 5, 6, 8, 9, 10, 11)


def _built(ref=SHELF_ID, rev=SHELF_REV_PLAIN):
    return {"ref": ref, "defRev": rev}


# ── the ids ─────────────────────────────────────────────────────────────────────────────────────

def test_family_ids_pass_the_unchanged_regexes():
    from api.services.journal_two import journal_styles as js
    for bid, fam in (("built_a", "built"), ("routine_1", "routine"), ("tracker_zz", "tracker")):
        assert js.BLOCK_ID_RE.match(bid)
        assert js.PLACEHOLDER_RE.match("{{block:%s}}" % bid).group(1) == bid
        assert js.SLOT_ID_RE.match(bid) and js.slot_family(bid) == fam
    for not_a_slot in ("built_abc", "built_A", "widget_a", "built_", "builtWidget", "routine", "myPnlStats",
                       "built_a\n", "built_a\r\n", "routine_1\n", "tracker_zz\r\n"):
        assert js.slot_family(not_a_slot) is None, repr(not_a_slot)
        if not_a_slot.endswith("\n"):
            assert not_a_slot not in js.KNOWN_BLOCKS, repr(not_a_slot)
    for bad_id in ("built_a\n", "built_a\r\n", "chart\n"):       # Fix round 1 I-1: `$` would accept these
        with pytest.raises(js.StyleValidationError, match="valid block id"):
            js._clean_blocks([{"block": bad_id, "settings": _built()}])
    assert js.SLOT_FAMILIES == ("built", "routine", "tracker")
    assert js.slot_family(None) is None and js.slot_family(7) is None


def test_known_blocks_is_a_prefix_test_and_iterates_unchanged():
    from api.services.journal_two import journal_styles as js
    assert isinstance(js.KNOWN_BLOCKS, js._KnownBlocks) and isinstance(js.KNOWN_BLOCKS, frozenset)
    catalogued = {k["id"] for k in js.BLOCK_KINDS} | set(js.SNAPSHOT_SLOT_KINDS)
    assert set(js.KNOWN_BLOCKS) == catalogued                      # iteration: the catalogued ids, no family id
    assert "built_a" in js.KNOWN_BLOCKS and "tracker_9" in js.KNOWN_BLOCKS and "chart" in js.KNOWN_BLOCKS
    assert "built_abc" not in js.KNOWN_BLOCKS and "zzNew" not in js.KNOWN_BLOCKS and 3 not in js.KNOWN_BLOCKS
    assert [1] not in js.KNOWN_BLOCKS and {"a": 1} not in js.KNOWN_BLOCKS     # unhashable: False, never raises
    assert "built_a" not in (js.KNOWN_BLOCKS | {"x"})        # documented: only `in` on KNOWN_BLOCKS is prefix-aware
    assert set(js.BLOCK_BUILDERS) == js.KNOWN_BLOCKS              # the builder rail still compares one set
    assert "routine_b" in js.CREATE_ONLY_BLOCKS and "reminder" in js.CREATE_ONLY_BLOCKS
    assert js.CREATE_ONLY_BLOCKS == frozenset({"reminder", *js.SNAPSHOT_SLOT_KINDS})


def _known_blocks_aliases(tree: ast.AST) -> dict[str, str]:
    """{local name: source module} for every `from M import KNOWN_BLOCKS [as X]` in the module."""
    return {(a.asname or a.name): n.module for n in ast.walk(tree)
            if isinstance(n, ast.ImportFrom) and n.module and n.level == 0
            for a in n.names if a.name == "KNOWN_BLOCKS"}


def _names_known_blocks(tree: ast.AST, local_names: set) -> list[ast.AST]:
    return [n for n in ast.walk(tree)
            if (isinstance(n, ast.Name) and n.id in local_names)
            or (isinstance(n, ast.Attribute) and n.attr == "KNOWN_BLOCKS")]


def _import_aliases(tree: ast.AST) -> dict[str, str]:
    """{local name: module path} for every `import a.b as x` / `from a import b as x` in the module."""
    out: dict[str, str] = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                out[a.asname or a.name.split(".")[0]] = a.name
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            for a in n.names:
                out[a.asname or a.name] = f"{n.module}.{a.name}"
    return out


def test_known_blocks_prefix_test_reaches_every_module():
    """W11-R3: every module that names KNOWN_BLOCKS reads THE `_KnownBlocks` instance, so every `bid in
    KNOWN_BLOCKS` site accepts the families with no call-site change; and only journal_styles binds it."""
    from api.services.journal_two import journal_styles as js
    modules, sites = [], 0
    for path in sorted(API_DIR.rglob("*.py")):           # Fix round 1 M-1: every module under api/, subpackages too
        if "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        imported = _known_blocks_aliases(tree)           # `from ... import KNOWN_BLOCKS as KB` names it as KB
        uses = _names_known_blocks(tree, {"KNOWN_BLOCKS", *imported})
        if not uses and not imported:
            continue
        modname = ".".join(path.with_suffix("").parts)
        mod = importlib.import_module(modname)
        aliases = _import_aliases(tree)
        modules.append(modname)
        for n in uses:
            if isinstance(n, ast.Attribute):
                assert isinstance(n.value, ast.Name), (modname, ast.dump(n))
                owner = importlib.import_module(aliases.get(n.value.id, modname))
                got = getattr(owner, "KNOWN_BLOCKS")
            elif n.id in imported:
                got = getattr(importlib.import_module(imported[n.id]), "KNOWN_BLOCKS")
            else:
                got = getattr(mod, "KNOWN_BLOCKS")
            assert got is js.KNOWN_BLOCKS, (modname, ast.dump(n))
            assert isinstance(got, js._KnownBlocks) and "built_a" in got
            sites += 1
        if modname != js.__name__:
            binds = [t for node in ast.walk(tree) if isinstance(node, (ast.Assign, ast.AnnAssign))
                     for t in (node.targets if isinstance(node, ast.Assign) else [node.target])
                     if isinstance(t, ast.Name) and t.id == "KNOWN_BLOCKS"]
            assert not binds, f"{modname} binds its own KNOWN_BLOCKS: a second authority"
    # Non-vacuity. Measured 2026-10-26: two modules name it (journal_styles and template_gallery, whose
    # `_safe_listed` and `style_payload` are what starter_packs reaches), at four sites (the binding included).
    assert {js.__name__, "api.services.journal_two.template_gallery"} <= set(modules), modules
    assert sites >= 4, sites


def test_the_gallery_reader_accepts_a_family_block_with_no_call_site_change():
    """W11-R3: `KNOWN_BLOCKS` admits every family id at the gallery reader's own membership test (`bid in
    KNOWN_BLOCKS`, unchanged), and still refuses an unknown one. W11-R19 (Task 11.7 fix round 2): the reader
    itself then DROPS family blocks until Task 11.8's reducer, through the one shared strip
    `template_gallery._without_template_slots` (railed in tests/test_gallery_item_types_w11.py)."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import template_gallery as tg
    for bid in ("built_a", "routine_b", "tracker_c"):
        assert bid in js.KNOWN_BLOCKS, bid
    assert "zzNew" not in js.KNOWN_BLOCKS
    got = tg._safe_listed({"blocks": [{"block": "built_a", "settings": _built()},
                                      {"block": "chart", "settings": {}},
                                      {"block": "zzNew", "settings": {}}]})
    assert [b["block"] for b in got["blocks"]] == ["chart"]


# ── slot_settings_of: one case per sentence ────────────────────────────────────────────────────

def _refused(family, settings):
    from api.services.journal_two import journal_styles as js
    with pytest.raises(js.StyleValidationError) as e:
        js.slot_settings_of(family, settings)
    return str(e.value)


def test_slot_settings_shapes():
    from api.services.journal_two import journal_styles as js
    sso = js.slot_settings_of
    # built: the three refs, defRev pinned where required, range optional, unknown keys dropped
    assert sso("built", {**_built(), "junk": 1, "rows": [1, 2]}) == {"ref": SHELF_ID, "defRev": 1}
    assert sso("built", {"ref": f"def:{UUID}", "defRev": 3, "range": {"token": "last_30d"}}) == {
        "ref": f"def:{UUID}", "defRev": 3, "range": {"token": "last_30d"}}
    assert sso("built", {"ref": "inline:w1"}) == {"ref": "inline:w1"}
    for bad in ({}, {"ref": None}, {"ref": 7}, {"ref": "widget:x", "defRev": 1}, {"ref": "shelf:no-such", "defRev": 1},
                {"ref": f"def:{UUID}\n", "defRev": 1}, {"ref": f"def:{UUID}\r\n", "defRev": 1},
                {"ref": "inline:w1\n"}, {"ref": "inline:w1\r\n"}, {"ref": f"{SHELF_ID}\n", "defRev": 1},
                {"ref": "def:not-a-uuid", "defRev": 1}, {"ref": f"def:{UUID.upper()}", "defRev": 1},
                {"ref": "def:3f2b8c1e-9a4d-1c6b-8e2f-1a2b3c4d5e6f", "defRev": 1},      # a uuid1 is not a uuid4
                {"ref": "inline:"}, {"ref": "inline:TooLongKey"}, {"ref": "inline:a-b"}):
        assert _refused("built", bad) == js.S_SLOT_REF, bad
    for bad in ({"ref": SHELF_ID}, {"ref": SHELF_ID, "defRev": 0}, {"ref": SHELF_ID, "defRev": "1"},
                {"ref": SHELF_ID, "defRev": True}, {"ref": SHELF_ID, "defRev": 999},
                {"ref": f"def:{UUID}"}, {"ref": f"def:{UUID}", "defRev": 1.5}, {"ref": "inline:w1", "defRev": 1}):
        assert _refused("built", bad) == js.S_SLOT_REV, bad
    for bad in ("last_30d", {"token": "yesterday"}, {"token": "ytd", "from": "2026-01-01"}, {}, {"token": None}):
        assert _refused("built", {**_built(), "range": bad}) == js.S_SLOT_RANGE, bad
    # routine / tracker: exactly one target, defaults written explicitly
    assert sso("routine", {"ref": f"routine:{UUID}", "extra": "x"}) == {
        "ref": f"routine:{UUID}", "bind": "note-day", "display": "items"}
    assert sso("routine", {"template": "premarket_routine", "bind": "next-trading-day", "display": "pnl"}) == {
        "template": "premarket_routine", "bind": "next-trading-day", "display": "pnl"}
    assert sso("routine", {"inline": "r1", "bind": "week"}) == {"inline": "r1", "bind": "week", "display": "items"}
    assert sso("tracker", {"ref": f"tracker:{UUID}"}) == {"ref": f"tracker:{UUID}", "bind": "note-day",
                                                          "display": "chart"}
    for ref in ("checkin:mood", "checkin:focus"):
        assert sso("tracker", {"ref": ref, "display": "pnl"})["ref"] == ref
    for fam, bad in (("routine", {}), ("routine", {"ref": f"routine:{UUID}", "inline": "r1"}),
                     ("routine", {"template": "premarket_routine", "inline": "r1"}),
                     ("routine", {"ref": f"tracker:{UUID}"}), ("routine", {"ref": "checkin:mood"}),
                     ("routine", {"ref": "routine:nope"}), ("routine", {"template": "Bad-Key"}),
                     ("routine", {"template": "x" * 41}), ("routine", {"inline": "TooLongKey"}),
                     ("tracker", {"ref": f"routine:{UUID}"}), ("tracker", {"ref": "checkin:sleep"}),
                     ("tracker", {"inline": 5}),
                     # Fix round 1 I-1: a trailing newline is refused everywhere (`$` alone accepted it)
                     ("routine", {"inline": "r1\n"}), ("routine", {"inline": "r1\r\n"}),
                     ("routine", {"template": "premarket_routine\n"}), ("routine", {"ref": f"routine:{UUID}\n"}),
                     ("tracker", {"ref": f"tracker:{UUID}\r\n"}), ("tracker", {"ref": "checkin:mood\n"})):
        assert _refused(fam, bad) == js.S_SLOT_TOOL, (fam, bad)
    for bad in ("tomorrow", None, 3, "NOTE-DAY"):
        assert _refused("routine", {"inline": "r1", "bind": bad}) == js.S_SLOT_BIND, bad
    assert _refused("routine", {"inline": "r1", "display": "chart"}) == js.S_SLOT_DISPLAY
    assert _refused("tracker", {"inline": "t1", "display": "items"}) == js.S_SLOT_DISPLAY
    assert _refused("tracker", {"inline": "t1", "display": None}) == js.S_SLOT_DISPLAY
    assert _refused("widget", {"ref": "inline:a"}) == js.S_SLOT_REF
    out = sso("tracker", {"inline": "t1"})
    out["bind"] = "mutated"
    assert sso("tracker", {"inline": "t1"})["bind"] == "note-day"   # a NEW dict each call


def test_today_bind_refused_with_sentence():
    """Follow today (`bind: 'today'`) is never a template value (spec §6.2, W11-R14)."""
    from api.services.journal_two import journal_styles as js
    for fam, target in (("routine", {"ref": f"routine:{UUID}"}), ("tracker", {"ref": "checkin:mood"})):
        assert _refused(fam, {**target, "bind": "today"}) == js.S_SLOT_BIND == "Pick the day this block is for."
    with pytest.raises(js.StyleValidationError, match="Pick the day this block is for."):
        js._clean_blocks([{"block": "routine_a", "settings": {"inline": "r1", "bind": "today"}}])


def test_binds_agree_with_tool_binding():
    from api.services.journal_two import journal_styles as js
    assert js._slot_binds() == ("note-day", "next-trading-day", "week")
    try:
        from api.services.journal_two import tool_binding
    except ModuleNotFoundError:
        return                                                       # Task 11.2 not landed here yet
    assert tuple(tool_binding.BINDS) == js._BINDS_BEFORE_TOOL_BINDING


def test_template_key_is_checked_against_template_tools_once_it_exists(monkeypatch):
    from api.services.journal_two import journal_styles as js
    import api.services.journal_two as pkg
    fake = types.ModuleType("api.services.journal_two.template_tools")
    fake.ROUTINE_TEMPLATES = {"night_before": {}}
    fake.TRACKER_TEMPLATES = {"sleep": {}}
    monkeypatch.setitem(sys.modules, fake.__name__, fake)
    monkeypatch.setattr(pkg, "template_tools", fake, raising=False)
    assert js.slot_settings_of("routine", {"template": "night_before"})["template"] == "night_before"
    assert js.slot_settings_of("tracker", {"template": "sleep"})["template"] == "sleep"
    assert _refused("routine", {"template": "sleep"}) == js.S_SLOT_TOOL          # a tracker key is not a routine's
    assert _refused("routine", {"template": "unknown_key"}) == js.S_SLOT_TOOL


# ── _clean_blocks ───────────────────────────────────────────────────────────────────────────────

def test_style_holds_two_built_slots_and_one_each_of_routine_tracker():
    from api.services.journal_two import journal_styles as js
    out = js._clean_blocks([
        {"block": "built_a", "settings": {**_built(), "payload": {"rows": [1]}}},
        {"block": "built_b", "settings": {"ref": f"def:{UUID}", "defRev": 2}},
        {"block": "routine_a", "settings": {"template": "premarket_routine"}},
        {"block": "tracker_a", "settings": {"ref": "checkin:mood", "display": "pnl"}},
    ])
    assert [b["block"] for b in out] == ["built_a", "built_b", "routine_a", "tracker_a"]
    assert out[0]["settings"] == {"ref": SHELF_ID, "defRev": 1}                  # the figure never stored
    assert out[2]["settings"] == {"template": "premarket_routine", "bind": "note-day", "display": "items"}
    assert out[3]["settings"] == {"ref": "checkin:mood", "bind": "note-day", "display": "pnl"}
    with pytest.raises(js.StyleValidationError, match="each block once"):
        js._clean_blocks([{"block": "built_a", "settings": _built()}, {"block": "built_a", "settings": _built()}])
    with pytest.raises(js.StyleValidationError, match="Pick a widget for this spot."):
        js._clean_blocks([{"block": "built_a"}])                                # no settings = no ref


def test_create_style_stores_family_slots_reduced(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "Prep", "kindId": "trade_plan", "blocks": [
        {"block": "built_a", "settings": {**_built(), "share": True}},
        {"block": "tracker_b", "settings": {"inline": "t1"}}]})
    assert s["blocks"] == [
        {"block": "built_a", "enabled": True, "settings": {"ref": SHELF_ID, "defRev": 1}},
        {"block": "tracker_b", "enabled": True, "settings": {"inline": "t1", "bind": "note-day", "display": "chart"}}]


# ── _slot_wave_off ──────────────────────────────────────────────────────────────────────────────

def test_slot_wave_off_matrix(monkeypatch):
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import shelf
    off = js._slot_wave_off
    plain, w10 = _built(SHELF_ID, SHELF_REV_PLAIN), _built(SHELF_ID, SHELF_REV_W10)
    defref, tool = {"ref": f"def:{UUID}", "defRev": 1}, {"inline": "r1"}
    cases = {"built_a": plain, "built_b": w10, "built_c": defref, "built_d": None,
             "routine_a": tool, "tracker_a": tool}

    def hidden():
        return {bid for bid, s in cases.items() if off(bid, s)}

    _waves(monkeypatch, *ALL_ON)
    assert hidden() == set()
    assert not off("chart") and not off("myPnlStats") and not off("myGamePlan")
    for wave, expect in ((11, set(cases)),
                         (8, {"built_a", "built_b", "built_c", "built_d"}),
                         (9, {"routine_a", "tracker_a"}),
                         (10, {"built_b"})):                    # the shelf ref pinned to a wave 10 revision
        _waves(monkeypatch, *(w for w in ALL_ON if w != wave))
        assert hidden() == expect, wave
    _waves(monkeypatch, *(w for w in ALL_ON if w != 10))
    assert off("myGamePlan") and not off("myPnlStats")             # a dedicated kind reads its own KIND_WAVE
    assert not off("chart")
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    assert off("myGamePlan") and off("myAlertsFired") and not off("myPnlStats")    # W11-R20: wave 11's too
    assert not off("chart")
    # a shelf ref whose pinned revision reads a routine needs wave 9 too
    real = shelf.revision
    monkeypatch.setattr(shelf, "revision", lambda sid, rev: (
        {**real(sid, rev), "plan": {**real(sid, rev)["plan"], "source": "routine_history"}}
        if (sid, rev) == (SHELF_ID, SHELF_REV_PLAIN) else real(sid, rev)))
    from api.services.journal_two.widget_engine import plan as wplan
    assert wplan.uses_tools(shelf.revision(SHELF_ID, SHELF_REV_PLAIN)["plan"])
    _waves(monkeypatch, *(w for w in ALL_ON if w != 9))
    assert off("built_a", plain) and not off("built_c", defref)
    _waves(monkeypatch, *ALL_ON)
    assert not off("built_a", plain)


def _family_style():
    para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
    return {"id": "s1", "kindId": "trade_plan", "version": 1, "properties": {}, "blocks": [
        {"block": "chart", "enabled": True, "settings": {"tf": "D"}},
        {"block": "built_a", "enabled": True, "settings": _built()},
        {"block": "routine_a", "enabled": True, "settings": {"inline": "r1", "bind": "note-day", "display": "items"}}],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Prep"}]},
            para("{{block:built_a}}"),
            {"type": "blockquote", "content": [para("{{block:routine_a}}")]},
            para("{{block:chart}}")]}}


def test_served_style_hides_family_slots_and_placeholders_when_w11_off(monkeypatch):
    import json
    from api.services.journal_two import journal_styles as js
    style = _family_style()
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    served = js.served_style(style)
    assert [b["block"] for b in served["blocks"]] == ["chart"]
    text = json.dumps(served["outlineBodyJson"])
    assert "built_a" not in text and "routine_a" not in text and "{{block:chart}}" in text
    assert [b["block"] for b in style["blocks"]] == ["chart", "built_a", "routine_a"]     # the stored copy untouched
    _waves(monkeypatch, *ALL_ON)
    served = js.served_style(style)
    assert [b["block"] for b in served["blocks"]] == ["chart", "built_a", "routine_a"]
    assert "{{block:built_a}}" in json.dumps(served["outlineBodyJson"])
    # wave 10 off hides only the slot pinned to a wave 10 shelf revision, and its placeholder
    style["blocks"][1]["settings"] = _built(SHELF_ID, SHELF_REV_W10)
    _waves(monkeypatch, *(w for w in ALL_ON if w != 10))
    served = js.served_style(style)
    assert [b["block"] for b in served["blocks"]] == ["chart", "routine_a"]
    assert "built_a" not in json.dumps(served["outlineBodyJson"])


def test_compose_drops_family_slots_when_w11_off(db_path, monkeypatch):
    import json
    from api.services.journal_two import journal_styles as js
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    out = js.compose("u1", _family_style(), ticker=None, conn=None)
    text = json.dumps(out["bodyJson"])
    assert "built_a" not in text and "routine_a" not in text                   # no node, no placeholder
    assert not [s for s in out["skipped"] if s["block"] in ("built_a", "routine_a")]   # and no skip line


def test_update_style_keeps_hidden_family_slots(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js
    _waves(monkeypatch, *ALL_ON)
    s = js.create_style("u1", {"name": "Prep", "kindId": "trade_plan", "blocks": [
        {"block": "chart", "settings": {"tf": "D"}},
        {"block": "built_a", "settings": _built()},
        {"block": "tracker_a", "settings": {"ref": "checkin:focus"}}]})
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    seen = js.served_style(s)
    assert [b["block"] for b in seen["blocks"]] == ["chart"]
    got = js.update_style("u1", s["id"], {"blocks": [{"block": "chart", "settings": {"tf": "W"}}]})
    assert [b["block"] for b in got["blocks"]] == ["chart", "built_a", "tracker_a"]       # kept, at their index
    assert got["blocks"][1]["settings"] == {"ref": SHELF_ID, "defRev": 1}
    _waves(monkeypatch, *ALL_ON)
    assert [b["block"] for b in js.served_style(js.get_style("u1", s["id"]))["blocks"]] == [
        "chart", "built_a", "tracker_a"]                                                   # back on re-arm


def test_save_as_style_never_turns_an_embed_into_a_family_slot(db_path):
    """A note's widgetEmbed never carries a family id; a hand-made one is left out, never a refused save."""
    from api.services.journal_two import journal_styles as js, notes as notes_service
    body = {"type": "doc", "content": [js._h("Prep"), {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "built_a", "embedId": "e1", "mode": "snapshot", "params": _built(),
        "capturedAt": None, "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None}}]}
    note = notes_service.create_note("u1", {"title": "N", "bodyJson": body})
    left = []
    s = js.create_style_from_note("u1", note["id"], "Mine", "trade_plan", left_out=left)
    assert [b["block"] for b in s["blocks"]] == []
    assert left == [{"widgetId": "built_a", "reason": "not-a-style-block"}]


# ── the wave 10 dedicated kinds ────────────────────────────────────────────────────────────────

WAVE10_SLOTS = ("myRiskLeftToday", "myGamePlan", "myTiltCheck", "myRevengeClean", "myPropFirm", "myAlertsFired")


def test_dedicated_kinds_are_slots_with_skip_sentences(monkeypatch):
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    _waves(monkeypatch, *ALL_ON)
    assert js.WAVE11_SLOT_KINDS == WAVE10_SLOTS
    assert js.SNAPSHOT_SLOT_KINDS[6:] == WAVE10_SLOTS and len(js.SNAPSHOT_SLOT_KINDS) == 12
    assert "myPlanVsActual" not in js.SNAPSHOT_SLOT_KINDS and "myPlanVsActual" not in js.KNOWN_BLOCKS
    for kind in WAVE10_SLOTS:
        assert nw.KIND_WAVE[kind] == 10
        title = nw.KIND_TITLE[kind]
        assert js.SKIP_SENTENCES[f"widget-failed:{kind}"] == f"{title} couldn't load. Type / to add it again."
        assert js.SKIP_SENTENCES[f"widget-preview:{kind}"] == f"{title} fills in with your own data when you make a note."
        assert kind in js.KNOWN_BLOCKS and kind in js.CREATE_ONLY_BLOCKS and js.BLOCK_BUILDERS[kind] is js._build_widget_slot
    assert js.SKIP_SENTENCES["widget-failed:myGamePlan"] == "Pre-market game plan couldn't load. Type / to add it again."


def test_builtin_styles_do_not_change():
    from api.services.journal_two import journal_styles as js
    versions = {k: s["version"] for k, s in js.BUILTIN_STYLES.items()}
    held = {b["block"] for s in js.BUILTIN_STYLES.values() for b in s["blocks"]}
    assert not held & set(WAVE10_SLOTS)
    assert not any(js.slot_family(b) for b in held)
    assert versions["weekly_review"] == 1 and versions["daily_prep"] == 2


# ── Fix round 1, ruling W11-R20: the six wave 10 kinds as template slots are a wave 11 capability ─────────

def _embed(kind):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": kind, "embedId": "e-" + kind, "mode": "snapshot",
        "params": {"kind": kind, "asOf": "2026-10-20T14:30:00Z", "rows": [{"figure": 987.5}]},
        "capturedAt": "2026-10-20T14:30:00Z", "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None}}


def _save_as_style(js, notes_service, kind):
    body = {"type": "doc", "content": [js._h("Prep"), _embed(kind)]}
    note = notes_service.create_note("u1", {"title": "N", "bodyJson": body})
    left = []
    s = js.create_style_from_note("u1", note["id"], "Mine", "trade_plan", left_out=left)
    full = js.get_style("u1", s["id"], full=True)
    return full["blocks"], full["outlineBodyJson"], left


def test_save_as_style_with_a_wave10_embed_is_unchanged_while_w11_is_off(db_path, monkeypatch):
    """W11 off: "Save as style" on a note holding a wave 10 embed is byte-identical to the pre-task behaviour,
    which is how it treats ANY id it does not know (control: a never-known kind, `myZzNever`). W11 on: a slot."""
    from api.services.journal_two import journal_styles as js, notes as notes_service
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    for kind in WAVE10_SLOTS:
        blocks, outline, left = _save_as_style(js, notes_service, kind)
        c_blocks, c_outline, c_left = _save_as_style(js, notes_service, "myZzNever")
        assert blocks == c_blocks == []
        assert outline == c_outline
        assert left == [{"widgetId": kind, "reason": "not-a-style-block"}]
        assert c_left == [{"widgetId": "myZzNever", "reason": "not-a-style-block"}]
    _waves(monkeypatch, *ALL_ON)
    blocks, _, left = _save_as_style(js, notes_service, "myGamePlan")
    assert [b["block"] for b in blocks] == ["myGamePlan"] and left == []
    assert "rows" not in blocks[0]["settings"]                  # the payload figures never reach the style


def _wave10_style():
    para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
    return {"id": "s2", "kindId": "trade_plan", "version": 1, "properties": {}, "blocks": [
        {"block": "chart", "enabled": True, "settings": {"tf": "D"}},
        {"block": "myGamePlan", "enabled": True, "settings": {}},
        {"block": "myPnlStats", "enabled": True, "settings": {}}],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Prep"}]},
            para("{{block:myGamePlan}}"), para("{{block:chart}}")]}}


def test_wave10_slot_kinds_are_hidden_everywhere_while_w11_is_off(db_path, monkeypatch):
    import json
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    from api.services.journal_two import template_gallery as tg
    built = []
    monkeypatch.setattr(nw, "build", lambda kind, *a, **k: built.append(kind) or {"asOf": "2026-10-20T00:00:00Z"})
    style = _wave10_style()
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    served = js.served_style(style)
    assert [b["block"] for b in served["blocks"]] == ["chart", "myPnlStats"]
    assert "myGamePlan" not in json.dumps(served["outlineBodyJson"])
    out = js.compose("u1", style, ticker=None, conn=None)
    assert "myGamePlan" not in built and "myPnlStats" in built                       # no node
    assert not [s for s in out["skipped"] if s["block"] == "myGamePlan"]             # and no skip line
    assert "myGamePlan" not in json.dumps(out["bodyJson"])
    assert [b["block"] for b in tg._safe_listed({"blocks": style["blocks"]})["blocks"]] == ["chart", "myPnlStats"]
    # update_style keeps the hidden slot, at its stored index
    _waves(monkeypatch, *ALL_ON)
    s = js.create_style("u1", {"name": "Prep", "kindId": "trade_plan", "blocks": style["blocks"]})
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    got = js.update_style("u1", s["id"], {"blocks": [b for b in js.served_style(s)["blocks"]]})
    assert [b["block"] for b in got["blocks"]] == ["chart", "myGamePlan", "myPnlStats"]
    # wave 11 on: a slot on every path
    _waves(monkeypatch, *ALL_ON)
    built.clear()
    assert [b["block"] for b in js.served_style(style)["blocks"]] == ["chart", "myGamePlan", "myPnlStats"]
    js.compose("u1", style, ticker=None, conn=None)
    assert "myGamePlan" in built
    assert [b["block"] for b in tg._safe_listed({"blocks": style["blocks"]})["blocks"]] == [
        "chart", "myGamePlan", "myPnlStats"]


def test_a_legacy_family_block_stored_before_the_grammar_can_still_be_saved(db_path, monkeypatch):
    """Review M-4: before Task 11.3 a `built_a` block was an unknown block kept verbatim. A style stored so
    keeps saving (the block comes back unchanged); a NEW invalid family block is still refused."""
    import json
    from api.services.auth_db import get_connection
    from api.services.journal_two import journal_styles as js
    _waves(monkeypatch, *ALL_ON)
    s = js.create_style("u1", {"name": "Old", "kindId": "trade_plan", "blocks": [
        {"block": "chart", "settings": {"tf": "D"}}]})
    legacy = {"block": "built_a", "enabled": True, "settings": {"whatever": "kept"}}
    conn = get_connection()
    try:
        stored = json.loads(conn.execute("SELECT blocks_json FROM j2_journal_styles WHERE id = ?",
                                         (s["id"],)).fetchone()["blocks_json"])
        conn.execute("UPDATE j2_journal_styles SET blocks_json = ? WHERE id = ?",
                     (json.dumps(stored + [legacy]), s["id"]))
        conn.commit()
    finally:
        conn.close()
    seen = js.served_style(js.get_style("u1", s["id"]))["blocks"]
    got = js.update_style("u1", s["id"], {"blocks": seen})
    assert got["blocks"][-1] == legacy
    with pytest.raises(js.StyleValidationError, match="Pick a widget for this spot."):
        js.update_style("u1", s["id"], {"blocks": seen + [{"block": "built_b", "settings": {"whatever": "x"}}]})
    with pytest.raises(js.StyleValidationError, match="Pick a widget for this spot."):
        js.update_style("u1", s["id"], {"blocks": [{"block": "built_a", "settings": {"whatever": "changed"}}]})
