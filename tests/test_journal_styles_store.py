"""The journal-styles store (spec P1.2). ⛔ ONE FACT IN TWO FILES: journal_styles.BLOCK_KINDS <->
app/src/pages/journal-2-0/lib/journalBlocks.js, pinned by importing the JS through Node."""
from __future__ import annotations

import importlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path

import pytest

CLIENT = Path("app/src/pages/journal-2-0/lib/journalBlocks.js")


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


def _client_blocks():
    node = shutil.which("node")
    assert node, "node is not on PATH"
    js = (f"import({json.dumps(CLIENT.resolve().as_uri())}).then((m) => "
          "process.stdout.write(JSON.stringify(m.BLOCK_KINDS)))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


def test_the_client_block_catalog_equals_the_server_catalog():
    from api.services.journal_two import journal_styles as js
    client = _client_blocks()
    assert client                                                        # non-vacuity
    shape = lambda kinds: [(k["id"], [(s["key"], list(s["options"]), s["default"]) for s in k["settings"]])
                           for k in kinds]
    assert shape(client) == shape(js.BLOCK_KINDS)


def test_the_client_name_cap_is_the_servers():
    """Review M-5: lib/journalStyles.js holds the ONE client copy of the style-name cap (every name field and
    the Save-as-style seed read it). It imports browser modules, so Node cannot evaluate it raw: the
    declaration is READ from the file, and must be exactly one."""
    import re
    from api.services.journal_two import journal_styles as js
    src = Path("app/src/pages/journal-2-0/lib/journalStyles.js").read_text(encoding="utf-8")
    found = re.findall(r"^export const MAX_STYLE_NAME_CHARS = (\d+)$", src, flags=re.M)
    assert len(found) == 1, found                                        # non-vacuity: one declaration
    assert int(found[0]) == js.MAX_STYLE_NAME_CHARS


def test_every_builtin_kind_has_a_builtin_style_and_its_blocks_are_known():
    from api.services.journal_two import journal_styles as js, note_kinds as nk
    assert set(js.BUILTIN_STYLES) == nk.BUILTIN_KIND_IDS
    for kind, s in js.BUILTIN_STYLES.items():
        assert s["outline"]["type"] == "doc" and s["version"] >= 1
        assert all(b["block"] in js.KNOWN_BLOCKS for b in s["blocks"]), kind


def test_every_catalogued_block_has_a_builder():
    from api.services.journal_two import journal_styles as js
    assert set(js.BLOCK_BUILDERS) == js.KNOWN_BLOCKS


def _make(user="u1", **kw):
    from api.services.journal_two import journal_styles as js
    body = {"name": "My plan", "kindId": "trade_plan",
            "outlineBodyJson": {"type": "doc", "content": [{"type": "heading", "attrs": {"level": 2},
                                "content": [{"type": "text", "text": "Setup"}]}]},
            "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}], **kw}
    return js.create_style(user, body)


def test_create_list_get_and_owner_scope(db_path):
    from api.services.journal_two import journal_styles as js
    s = _make()
    assert s["version"] == 1 and s["builtin"] is False and s["blocks"][0]["settings"] == {"tf": "W"}
    ids = [x["id"] for x in js.list_styles("u1")]
    assert s["id"] in ids and "builtin:trade_plan" in ids
    assert js.get_style("u2", s["id"]) is None
    assert js.get_style("u1", s["id"])["outlineBodyJson"]["content"][0]["type"] == "heading"


def test_validation(db_path):
    from api.services.journal_two import journal_styles as js
    with pytest.raises(js.StyleValidationError):
        _make(name="  ")
    with pytest.raises(js.StyleValidationError):
        _make(kindId="nope")
    with pytest.raises(js.StyleValidationError):
        _make(blocks=[{"block": "chart", "enabled": True, "settings": {"tf": "2H"}}])
    with pytest.raises(js.StyleValidationError):
        _make(blocks=[{"block": "chart", "enabled": True, "settings": {}},
                      {"block": "chart", "enabled": False, "settings": {}}])
    with pytest.raises(js.StyleValidationError):
        _make(properties={"builtin:note_kind": "thesis"})                # the kind comes from kindId


def test_an_unknown_block_kind_is_kept_verbatim(db_path):
    s = _make(blocks=[{"block": "checklistFromTheFuture", "enabled": True, "settings": {"x": 1}}])
    assert s["blocks"] == [{"block": "checklistFromTheFuture", "enabled": True, "settings": {"x": 1}}]


def test_content_edits_bump_the_version_and_a_rename_does_not(db_path):
    from api.services.journal_two import journal_styles as js
    s = _make()
    assert js.update_style("u1", s["id"], {"name": "Renamed"})["version"] == 1
    assert js.update_style("u1", s["id"], {"blocks": []})["version"] == 2
    assert js.update_style("u1", s["id"], {"properties": {"builtin:confidence": "high"}})["version"] == 3


def test_one_default_per_kind_and_builtin_as_default(db_path):
    from api.services.journal_two import journal_styles as js
    a, b = _make(name="A"), _make(name="B")
    js.set_default("u1", a["id"])
    js.set_default("u1", b["id"])
    defaults = [s["id"] for s in js.list_styles("u1") if s["isDefault"] and s["kindId"] == "trade_plan"]
    assert defaults == [b["id"]]
    js.set_default("u1", "builtin:trade_plan")
    defaults = [s["id"] for s in js.list_styles("u1") if s["isDefault"] and s["kindId"] == "trade_plan"]
    assert defaults == ["builtin:trade_plan"]


def test_the_index_refuses_two_defaults(db_path):
    """⛔ One default per (member, kind) is the INDEX's job (idx_j2_journal_styles_default), not a
    check's: two live is_default rows for one kind cannot both be written, whatever the service does."""
    _make(name="A")
    _make(name="B")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("UPDATE j2_journal_styles SET is_default = 1 WHERE name = 'A'")
        conn.commit()
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE j2_journal_styles SET is_default = 1 WHERE name = 'B'")
        conn.rollback()
        # A soft-deleted default does not hold the slot: the index is partial on deleted_at.
        conn.execute("UPDATE j2_journal_styles SET deleted_at = 'x' WHERE name = 'A'")
        conn.execute("UPDATE j2_journal_styles SET is_default = 1 WHERE name = 'B'")
        conn.commit()
    finally:
        conn.close()


def test_delete_then_restore_keeps_default(db_path):
    from api.services.journal_two import journal_styles as js
    s = _make()
    js.set_default("u1", s["id"])
    assert js.delete_style("u1", s["id"])["deletedAt"]
    assert s["id"] not in [x["id"] for x in js.list_styles("u1")]
    assert js.default_style_for_kind("u1", "trade_plan", None)["id"] == "builtin:trade_plan"
    back = js.restore_style("u1", s["id"])
    assert back["deletedAt"] is None and back["isDefault"] is True


def test_restore_does_not_steal_a_default_set_meanwhile(db_path):
    from api.services.journal_two import journal_styles as js
    a, b = _make(name="A"), _make(name="B")
    js.set_default("u1", a["id"])
    js.delete_style("u1", a["id"])
    js.set_default("u1", b["id"])
    back = js.restore_style("u1", a["id"])
    assert back["isDefault"] is False
    assert js.default_style_for_kind("u1", "trade_plan", None)["id"] == b["id"]


def test_restore_does_not_take_the_default_back_after_the_member_chose_the_builtin(db_path):
    """Review M-3: a built-in default is the ABSENCE of a member default, so choosing it while the style
    was deleted left no trace; Undo then silently took the default back."""
    from api.services.journal_two import journal_styles as js
    s = _make()
    js.set_default("u1", s["id"])
    js.delete_style("u1", s["id"])
    js.set_default("u1", "builtin:trade_plan")
    back = js.restore_style("u1", s["id"])
    assert back["isDefault"] is False
    assert js.default_style_for_kind("u1", "trade_plan", None)["id"] == "builtin:trade_plan"


def test_restore_under_a_concurrent_set_default_never_answers_500(db_path, monkeypatch):
    """Review M-3: the default check and the write are one locked unit; and even if the check is stale
    (another writer set a default in between), the unique index's refusal restores it as non-default."""
    from api.services.journal_two import journal_styles as js
    a, b = _make(name="A"), _make(name="B")
    js.set_default("u1", a["id"])
    js.delete_style("u1", a["id"])
    conn = sqlite3.connect(db_path)                    # another writer: B becomes the default directly
    conn.execute("UPDATE j2_journal_styles SET is_default = 1 WHERE id = ?", (b["id"],))
    conn.commit()
    conn.close()
    with monkeypatch.context() as m:
        m.setattr(js, "_member_default", lambda *args, **kw: None)            # a check that read too early
        back = js.restore_style("u1", a["id"])
    assert back["deletedAt"] is None and back["isDefault"] is False
    assert js.default_style_for_kind("u1", "trade_plan", None)["id"] == b["id"]


def test_restore_respects_the_style_cap(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js
    monkeypatch.setattr(js, "MAX_STYLES_PER_MEMBER", 2)
    a = _make(name="A")
    js.delete_style("u1", a["id"])
    _make(name="B")
    _make(name="C")
    with pytest.raises(js.StyleValidationError):
        js.restore_style("u1", a["id"])
    assert js.get_style("u1", a["id"]) is None                                 # still deleted


def test_an_outline_the_editor_cannot_build_is_refused(db_path):
    """Review M-8: the same unbuildable-body check note creation runs (an empty text node)."""
    from api.services.journal_two import journal_styles as js
    with pytest.raises(js.StyleValidationError):
        _make(outlineBodyJson={"type": "doc", "content": [{"type": "paragraph",
                                                            "content": [{"type": "text", "text": ""}]}]})


def test_builtins_are_read_only(db_path):
    from api.services.journal_two import journal_styles as js
    with pytest.raises(js.StyleValidationError):
        js.update_style("u1", "builtin:trade_plan", {"name": "x"})
    with pytest.raises(js.StyleValidationError):
        js.delete_style("u1", "builtin:trade_plan")


def test_save_a_notes_setup_as_a_style(db_path):
    from api.services.journal_two import journal_styles as js, notes
    chart = {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "chart",
             "params": {"symbol": "NVDA", "tf": "60", "to": 1760000000}}}
    body = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Setup"}]}, chart,
        {"type": "paragraph", "content": [{"type": "text", "text": "My words"}]}]}
    n = notes.create_note("u1", {"title": "NVDA plan", "bodyJson": body},
                          properties={"builtin:confidence": "high"})
    s = js.create_style_from_note("u1", n["id"], "From my note", "trade_plan")
    full = js.get_style("u1", s["id"])
    assert full["blocks"] == [{"block": "chart", "enabled": True, "settings": {"tf": "60"}}]
    texts = [c.get("content", [{}])[0].get("text") for c in full["outlineBodyJson"]["content"]]
    assert "{{block:chart}}" in texts and "My words" in texts
    assert full["properties"] == {"builtin:confidence": "high"}
    assert js.create_style_from_note("u2", n["id"], "x") is None          # not their note


def test_saving_a_notes_setup_names_every_widget_it_left_out(db_path):
    """Final review M-4: every widgetEmbed leaves the outline, and only the first of each known block becomes
    a block. What did not (a widget that is not a style block yet, a second chart) is RETURNED, once each,
    in the order met, so the confirmation can say so instead of dropping it silently."""
    from api.services.journal_two import journal_styles as js, notes
    def embed(widget, **attrs):
        return {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": widget, "params": {"symbol": "NVDA"}, **attrs}}
    body = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Setup"}]},
        embed("chart"), embed("fundamentals"), embed("chart", embedId="second"),
        {"type": "blockquote", "content": [embed("fundamentals", embedId="nested")]},
        {"type": "paragraph", "content": [{"type": "text", "text": "My words"}]}]}
    n = notes.create_note("u1", {"title": "NVDA plan", "bodyJson": body})
    left: list = []
    s = js.create_style_from_note("u1", n["id"], "From my note", "trade_plan", left_out=left)
    assert [b["block"] for b in s["blocks"]] == ["chart"]
    assert left == [{"widgetId": "fundamentals", "reason": "not-a-style-block"},
                    {"widgetId": "chart", "reason": "repeat"}]
    clean: list = []
    plain = notes.create_note("u1", {"title": "x", "bodyJson": {"type": "doc", "content": [embed("chart")]}})
    js.create_style_from_note("u1", plain["id"], "Plain", "trade_plan", left_out=clean)
    assert clean == []                                             # CONTROL: nothing left out, nothing said


def test_saving_a_note_whose_property_was_deleted_leaves_that_value_out(db_path):
    """A deleted property's value stays in the note's properties_json, invisibly
    (note_properties.delete_property_def). Saving the note's setup must drop it, not refuse."""
    from api.services.journal_two import journal_styles as js, note_properties as np, notes
    p = np.create_property_def("u1", "Setup", "select", [{"label": "VCP"}])
    n = notes.create_note("u1", {"title": "x"},
                          properties={p["id"]: p["options"][0]["id"], "builtin:confidence": "low"})
    np.delete_property_def("u1", p["id"])
    s = js.create_style_from_note("u1", n["id"], "Mine", "thesis")
    assert s["properties"] == {"builtin:confidence": "low"}


def _editor_body(style: dict, **changes) -> dict:
    """What StyleEditor.save sends for an existing style: name, kind, blocks and properties, every time
    (the outline only when the member changed it)."""
    body = {"name": style["name"], "kindId": style["kindId"], "blocks": style["blocks"],
            "properties": style["properties"]}
    body.update(changes)
    return body


def _duplicate_body(style: dict) -> dict:
    """What StylesManager.duplicate sends: the full style read back, renamed."""
    body = {"name": style["name"] + " copy", "kindId": style["kindId"], "blocks": style["blocks"],
            "properties": style["properties"]}
    if style.get("outlineTemplateId"):
        body["outlineTemplateId"] = style["outlineTemplateId"]
    if style.get("outlineBodyJson"):
        body["outlineBodyJson"] = style["outlineBodyJson"]
    return body


def test_a_deleted_property_never_locks_a_style(db_path):
    """Final review I-1: a style whose stored default names a property the member has since deleted
    (a soft delete leaves the value behind) must still rename, duplicate, edit and preview. The stale id
    is dropped from what is stored, the way compose already ignores it."""
    from api.services.journal_two import journal_styles as js, note_properties as np
    p = np.create_property_def("u1", "Setup", "select", [{"label": "VCP"}])
    s = _make(properties={p["id"]: p["options"][0]["id"], "builtin:confidence": "high"})
    np.delete_property_def("u1", p["id"])
    stored = js.get_style("u1", s["id"])
    assert p["id"] in stored["properties"]                         # the case under test: still served

    renamed = js.update_style("u1", s["id"], _editor_body(stored, name="Renamed"))
    assert renamed["name"] == "Renamed"
    assert renamed["properties"] == {"builtin:confidence": "high"}     # the stale id is gone from storage
    assert renamed["version"] == stored["version"]                 # dropping what compose ignored is no edit

    copy_ = js.create_style("u1", _duplicate_body(stored))
    assert copy_["properties"] == {"builtin:confidence": "high"}

    edited = js.update_style("u1", s["id"], _editor_body(renamed, blocks=[]))
    assert edited["blocks"] == [] and edited["version"] == stored["version"] + 1

    out = js.preview("u1", {"style": _editor_body(stored)})
    assert p["id"] not in out["properties"] and out["properties"]["builtin:confidence"] == "high"


def test_a_deleted_select_option_never_locks_a_style(db_path):
    """The same class one level down: the property still exists, the OPTION the default named does not."""
    from api.services.journal_two import journal_styles as js, note_properties as np
    p = np.create_property_def("u1", "Setup", "select", [{"label": "VCP"}, {"label": "Flag"}])
    s = _make(properties={p["id"]: p["options"][0]["id"]})
    np.update_property_def("u1", p["id"], options=[p["options"][1]])          # VCP is removed
    stored = js.get_style("u1", s["id"])
    renamed = js.update_style("u1", s["id"], _editor_body(stored, name="Renamed"))
    assert renamed["name"] == "Renamed" and renamed["properties"] == {}
    assert js.create_style("u1", _duplicate_body(stored))["properties"] == {}
    assert p["id"] not in js.preview("u1", {"style": _editor_body(stored)})["properties"]


def test_a_malformed_value_for_a_property_that_exists_is_still_refused(db_path):
    """CONTROL: leniency is for STALE references only. A wrong type for a live property is the client's
    mistake and answers 400, on save, on duplicate and on the draft preview."""
    from api.services.journal_two import journal_styles as js, note_properties as np
    p = np.create_property_def("u1", "Setup", "select", [{"label": "VCP"}])
    s = _make()
    with pytest.raises(js.StyleValidationError):
        js.update_style("u1", s["id"], {"properties": {p["id"]: 7}})
    with pytest.raises(js.StyleValidationError):
        _make(properties={"builtin:confidence": ["high"]})
    with pytest.raises(js.StyleValidationError):
        js.preview("u1", {"style": {"name": "x", "kindId": "thesis", "properties": {p["id"]: True}}})


def test_a_deleted_linked_template_never_locks_a_style(db_path):
    """Final review I-1, the template half: a missing linked template is treated as no template (compose's
    own fallback), on rename, duplicate, edit and the draft preview."""
    from api.services.journal_two import journal_styles as js, note_templates, notes
    n = notes.create_note("u1", {"title": "t", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "from template"}]}]}})
    t = note_templates.create_from_note("u1", n["id"])
    s = _make(outlineTemplateId=t["id"])
    note_templates.delete_template("u1", t["id"])
    stored = js.get_style("u1", s["id"])
    assert stored["outlineTemplateId"] == t["id"]                  # the case under test: still linked

    renamed = js.update_style("u1", s["id"], _editor_body(stored, name="Renamed",
                                                         outlineTemplateId=stored["outlineTemplateId"]))
    assert renamed["name"] == "Renamed" and renamed["outlineTemplateId"] is None
    assert renamed["version"] == stored["version"]                 # compose read the inline outline before too

    copy_ = js.create_style("u1", _duplicate_body(stored))
    assert copy_["outlineTemplateId"] is None
    assert copy_["outlineBodyJson"] == stored["outlineBodyJson"]   # the inline outline travels

    edited = js.update_style("u1", s["id"], _editor_body(renamed, blocks=[]))
    assert edited["blocks"] == []

    draft = _editor_body(stored, outlineTemplateId=stored["outlineTemplateId"],
                         outlineBodyJson=stored["outlineBodyJson"])
    out = js.preview("u1", {"style": draft})
    assert out["bodyJson"]["content"][0]["type"] == "heading"      # the inline outline, composed


def test_a_template_id_of_the_wrong_type_is_still_refused(db_path):
    """CONTROL: a missing template is stale; a template id that is not text is malformed."""
    from api.services.journal_two import journal_styles as js
    with pytest.raises(js.StyleValidationError):
        _make(outlineTemplateId=5)


def test_note_carries_style_keys(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"})
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == (None, None, None)
