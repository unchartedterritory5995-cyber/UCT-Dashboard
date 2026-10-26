"""Task 11.8: the share preview and the publish doors, through ONE reducer (W11-R1, W11-R6, W11-R22).

* `share_preview` writes nothing and is the only place the author's stored words appear (`prefill`, to its owner).
* Every publish of a widget, routine, tracker or template goes through `share.*`; nothing else in
  `template_gallery.py` writes a tool item.
* A tool is pending, then held while approved (R-P3-3). A copy from the library is refused; so is a template holding one.
* A template's payload carries its inline definitions with ONE numbering of choices; non-slot blocks travel by P3a's
  rule (W11-R18); a slot whose target is not the member's is left out and counted.
* The canary rail over what lands on DISK, and the refusal-sentence rail (11.4 m3).
"""
from __future__ import annotations

import ast
import json
import pathlib
import re

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from api.services.journal_two.widget_engine import share
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    AUTHOR, MEMBER, OTHER, SETUP_PLAN, approve, built, counts, db, heading, list_template, list_tool, para,
    routine, routine_edits, routine_slot, style, tracker, tracker_slot, widget,
)
from tests.test_widget_share_canary import CANARY, CANARY_ESC, CANARY_UP, NUMBER, FORBIDDEN_NUMBER, FORBIDDEN_TEXT

GALLERY_SRC = pathlib.Path(gallery.__file__)
#: An INSERT into the item table itself (OR IGNORE included), never one of its `j2_template_gallery_*` siblings.
_INSERT_RE = re.compile(r"INSERT(?: OR \w+)? INTO j2_template_gallery(?![_\w])")


# ── the preview ────────────────────────────────────────────────────────────────────────────────────

def test_preview_writes_nothing_and_prefills_only_for_owner(db):
    w = widget(db, plan={**SETUP_PLAN, "formulas": [{"id": "f1", "name": "My edge", "expr": "[r] * 2",
                                                     "format": "number"}],
                         "measures": [{"formula": "f1", "agg": "avg"}], "display": {"target": 3}})
    r = routine(db)
    t = tracker(db)
    s = style(db, blocks=[built("a", w["id"]), routine_slot("a", r["id"])])
    before = counts(db)
    total = db.total_changes
    out = gallery.share_preview(AUTHOR, "widget", w["id"], conn=db)
    assert set(out) == {"travels", "slots", "kept", "notShared", "prefill"}
    assert out["prefill"]["name"] == "Win rate"
    assert out["prefill"]["formulas"] == [{"id": "f1", "name": "My edge"}]
    # every answer carries `numbers`, each at a path the reducer keeps (11.15 I-3)
    assert {n["path"] for n in out["prefill"]["numbers"]} == {"formulas/f1/6", "display/target"}
    # the author's stored words are ONLY in the prefill: the travels carry the generated words
    assert "Win rate" not in json.dumps(out["travels"]) and "My edge" not in json.dumps(out["travels"])
    rout = gallery.share_preview(AUTHOR, "routine", r["id"], conn=db)
    assert rout["travels"] is None and rout["prefill"]["items"] == [{"text": "Coffee"}, {"text": "Mark levels"}]
    rout2 = gallery.share_preview(AUTHOR, "routine", r["id"], edits=routine_edits("Coffee", ""), conn=db)
    assert [i["text"] for i in rout2["travels"]["items"]] == ["Coffee"]      # an unticked item ('') is dropped
    assert "numbers" in rout2["prefill"]
    trk = gallery.share_preview(AUTHOR, "tracker", t["id"], conn=db)
    assert trk["prefill"]["unit"] == "hrs" and trk["travels"]["unit"] is None and "numbers" in trk["prefill"]
    tpl = gallery.share_preview(AUTHOR, "template", s["id"], conn=db)
    assert set(tpl["prefill"]["blocks"]) == {"built_a", "routine_a"} and tpl["travels"] is None
    assert tpl["outline"] is not None and tpl["outline"]["content"][0]["content"][0]["text"] == "Plan"   # M-4
    assert counts(db) == before and db.total_changes == total                                # nothing written
    # another member's preview of my items reads as absent (404), and reads nothing of mine
    for kind, tid in (("widget", w["id"]), ("routine", r["id"]), ("tracker", t["id"]), ("template", s["id"])):
        assert gallery.share_preview(MEMBER, kind, tid, conn=db) is None


def test_preview_is_absent_while_wave_11_or_the_library_is_off(db, monkeypatch):
    w = widget(db)
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W11_ENABLED", "0")
    assert gallery.share_preview(AUTHOR, "widget", w["id"], conn=db) is None
    assert gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db) is None
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W11_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    assert gallery.share_preview(AUTHOR, "widget", w["id"], conn=db) is None
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    assert gallery.share_preview(AUTHOR, "widget", w["id"], conn=db) is not None         # control


def test_template_preview_says_when_the_outline_is_gone(db):
    db.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json, created_at,"
               " updated_at) VALUES ('tpl-gone', ?, 'T', 'T', '{}', NULL, 'x', 'x')", (AUTHOR,))
    db.commit()
    w = widget(db)
    s = js.create_style(AUTHOR, {"name": "S", "kindId": "weekend_prep", "blocks": [built("a", w["id"])],
                                 "outlineTemplateId": "tpl-gone"}, db)
    db.execute("DELETE FROM j2_note_templates WHERE id = 'tpl-gone'")
    db.commit()
    out = gallery.share_preview(AUTHOR, "template", s["id"], conn=db)
    assert out["outline"] is None and out["outlineGone"] is True
    assert gallery.OUTLINE_GONE_SENTENCE in out["notShared"]


# ── publishing goes through the reducer ───────────────────────────────────────────────────────────

def test_publish_goes_through_the_reducer(db, monkeypatch):
    calls: list[str] = []
    for name in ("share_plan", "share_routine", "share_tracker", "share_template"):
        real = getattr(share, name)

        def spy(*a, _real=real, _name=name, **kw):
            calls.append(_name)
            return _real(*a, **kw)
        monkeypatch.setattr(share, name, spy)
    w, r, t = widget(db), routine(db), tracker(db)
    gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db)
    gallery.publish_tool(AUTHOR, "routine", r["id"], edits=routine_edits("Coffee"), conn=db)
    gallery.publish_tool(AUTHOR, "tracker", t["id"], conn=db)
    s = style(db, blocks=[built("a", w["id"])])
    gallery.publish_style(AUTHOR, s["id"], title="T", description="", category="journal", trading_style=None, conn=db)
    assert {"share_plan", "share_routine", "share_tracker", "share_template"} <= set(calls)
    assert calls[:3] == ["share_plan", "share_routine", "share_tracker"]


def _functions_writing_gallery_rows(src: str) -> set[str]:
    """Every function whose code holds an `INSERT INTO j2_template_gallery ` statement (the item table itself)."""
    tree = ast.parse(src)
    out = set()
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef):
            for node in ast.walk(fn):
                if isinstance(node, ast.Constant) and isinstance(node.value, str) \
                        and _INSERT_RE.search(node.value):
                    out.add(fn.name)
    return out


def _callers_of(src: str, callee: str) -> set[str]:
    tree = ast.parse(src)
    return {fn.name for fn in ast.walk(tree) if isinstance(fn, ast.FunctionDef)
            for n in ast.walk(fn) if isinstance(n, ast.Call) and getattr(n.func, "id", None) == callee}


def test_only_publish_tool_writes_a_tool_item():
    """W11-R1 rail: the only writer of a widget, routine or tracker item is `publish_tool`, through the shared held /
    replaced write, with the reducer's payload. A second INSERT anywhere, or another caller of the write handing it a
    tool type, goes red here."""
    src = GALLERY_SRC.read_text(encoding="utf-8")
    assert _functions_writing_gallery_rows(src) == {"publish", "seed_firm_templates", "seed_firm_styles",
                                                    "_held_or_replaced_once", "publish_example"}
    assert _callers_of(src, "_write_held_or_replaced") == {"publish_style", "publish_layout", "publish_tool"}
    tree = ast.parse(src)
    pt = next(f for f in ast.walk(tree) if isinstance(f, ast.FunctionDef) and f.name == "publish_tool")
    body = ast.unparse(pt)
    assert "_tool_share(kind, row, edits=edits, keep=keep).payload" in body
    assert "item_type = TOOL_ITEM_TYPE[kind]" in body
    for name in ("publish_style", "publish_layout"):
        f = next(f for f in ast.walk(tree) if isinstance(f, ast.FunctionDef) and f.name == name)
        assert "TOOL_ITEM" not in ast.unparse(f)
    # non-vacuity: the walk finds a planted second writer
    planted = src + "\n\ndef sneaky(conn):\n    conn.execute('INSERT INTO j2_template_gallery (id) VALUES (1)')\n"
    assert "sneaky" in _functions_writing_gallery_rows(planted)


def test_published_tool_is_pending_then_held_when_approved(db):
    w = widget(db)
    first = gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db)
    assert first["status"] == "pending" and first["itemType"] == "widget_definition"
    row = db.execute("SELECT category, body_json, source_tool_id, payload_json, pending_json FROM j2_template_gallery"
                     " WHERE id = ?", (first["id"],)).fetchone()
    assert (row["category"], json.loads(row["body_json"]), row["source_tool_id"], row["pending_json"]) == \
        ("review", {}, w["id"], None)
    # again while pending: replaced in place
    again = gallery.publish_tool(AUTHOR, "widget", w["id"], edits={"name": "Flags only"}, conn=db)
    assert again["id"] == first["id"] and again["title"] == "Flags only"
    approve(db, first["id"])
    # again while APPROVED: held, the approved one stays listed
    gallery.publish_tool(AUTHOR, "widget", w["id"], edits={"name": "Second version"}, conn=db)
    row = db.execute("SELECT status, title, pending_json FROM j2_template_gallery WHERE id = ?",
                     (first["id"],)).fetchone()
    assert row["status"] == "approved" and row["title"] == "Flags only"
    assert json.loads(row["pending_json"])["payload"]["name"] == "Second version"
    assert db.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE user_id = ?", (AUTHOR,)).fetchone()[0] == 1
    assert db.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = ?", (AUTHOR,)).fetchone() is not None
    # approving the held revision lists it, and the tool's body stays empty
    approve(db, first["id"])
    row = db.execute("SELECT title, version, body_json FROM j2_template_gallery WHERE id = ?",
                     (first["id"],)).fetchone()
    assert (row["title"], row["version"], json.loads(row["body_json"])) == ("Second version", 2, {})


def test_adopted_copy_refused_with_sentence(db):
    w, r, t = widget(db), routine(db), tracker(db)
    gw = list_tool(db, "widget", w["id"])
    gr = list_tool(db, "routine", r["id"], edits=routine_edits("Coffee"))
    gt = list_tool(db, "tracker", t["id"])
    copies = {"widget": gallery.adopt_tool(MEMBER, gw, answers={"p1": "Flag"}, conn=db)["id"],
              "routine": gallery.adopt_tool(MEMBER, gr, conn=db)["id"],
              "tracker": gallery.adopt_tool(MEMBER, gt, conn=db)["id"]}
    for kind, cid in copies.items():
        before = counts(db)
        for door in (lambda: gallery.share_preview(MEMBER, kind, cid, conn=db),
                     lambda: gallery.publish_tool(MEMBER, kind, cid, conn=db)):
            with pytest.raises(share.ShareError) as e:
                door()
            assert e.value.code == "adopted"
            assert e.value.sentence == f"This {kind} came from the library, so it can't be shared again."
        assert counts(db) == before
    # a template copy
    s = style(db, blocks=[built("a", w["id"])])
    gs = list_template(db, s["id"])
    mine = gallery.adopt_style(MEMBER, gs, answers={"p1": "Flag"}, conn=db)["style"]["id"]
    with pytest.raises(share.ShareError) as e:
        gallery.share_preview(MEMBER, "template", mine, conn=db)
    assert (e.value.code, e.value.sentence) == ("adopted", gallery.ADOPTED_TEMPLATE_SENTENCE)
    # control: the AUTHOR's own originals are shareable
    assert gallery.share_preview(AUTHOR, "widget", w["id"], conn=db) is not None


def test_template_holding_an_adopted_widget_refused(db):
    w = widget(db)
    gw = list_tool(db, "widget", w["id"])
    mine = gallery.adopt_tool(MEMBER, gw, answers={"p1": "Flag"}, conn=db)["id"]
    s = style(db, uid=MEMBER, blocks=[built("a", mine)])
    with pytest.raises(share.ShareError) as e:
        gallery.share_preview(MEMBER, "template", s["id"], conn=db)
    assert (e.value.code, e.value.sentence) == ("adopted", gallery.HOLDS_ADOPTED_SENTENCE)
    with pytest.raises(share.ShareError):
        gallery.publish_style(MEMBER, s["id"], title="T", description="", category="journal", trading_style=None,
                              conn=db)
    # control: the same template holding the member's OWN widget shares
    own = widget(db, uid=MEMBER)
    s2 = style(db, uid=MEMBER, blocks=[built("a", own["id"])])
    assert gallery.share_preview(MEMBER, "template", s2["id"], conn=db)["travels"]["definitions"]


def test_template_payload_inline_definitions_and_shared_slot_ids(db):
    w1 = widget(db)
    w2 = widget(db, name="Second")
    t = tracker(db)
    blocks = [built("a", w1["id"]), built("b", w2["id"]), built("c", w1["id"]), tracker_slot("a", t["id"]),
              {"block": "chart", "enabled": True, "settings": {"tf": "W"}},
              {"block": "myPnlStats", "enabled": True, "settings": {"range": "1w"}}]
    s = style(db, blocks=blocks)
    out = gallery.publish_style(AUTHOR, s["id"], title="T", description="", category="journal", trading_style=None,
                                conn=db)
    payload = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                    (out["id"],)).fetchone()[0])
    assert payload["format"] == 2
    assert [d["key"] for d in payload["definitions"]] == ["d1", "d2"]
    refs = {b["block"]: b["settings"] for b in payload["blocks"]}
    assert refs["built_a"] == {"ref": "inline:d1"} and refs["built_b"] == {"ref": "inline:d2"}
    assert refs["built_c"] == {"ref": "inline:d1"}                    # one widget in two spots is one part
    assert refs["tracker_a"]["inline"] == "t1"
    # ONE numbering: the same setup in both widgets is one choice
    assert [s_["id"] for s_ in payload["slots"]] == ["p1"]
    assert payload["definitions"][0]["plan"]["filters"][0]["values"] == [{"pick": "p1"}]
    assert payload["definitions"][1]["plan"]["filters"][0]["values"] == [{"pick": "p1"}]
    # W11-R18: a non-slot block travels by P3a's own rule (a chart verbatim, a snapshot slot with empty settings)
    assert refs["chart"] == {"tf": "W"} and refs["myPnlStats"] == {}
    # no member id anywhere
    blob = json.dumps(payload)
    for leaked in (w1["id"], w2["id"], t["id"], "def:", "tracker:"):
        assert leaked not in blob


def test_a_slot_whose_target_is_not_the_members_is_left_out_and_counted(db):
    w = widget(db)
    foreign = widget(db, uid=OTHER)
    blocks = [built("a", w["id"]), built("b", foreign["id"])]
    s = style(db, blocks=blocks)
    out = gallery.publish_style(AUTHOR, s["id"], title="T", description="", category="journal", trading_style=None,
                                conn=db)
    assert out["droppedSlots"] == 1
    payload = json.loads(db.execute("SELECT payload_json, body_json FROM j2_template_gallery WHERE id = ?",
                                    (out["id"],)).fetchone()[0])
    assert [b["block"] for b in payload["blocks"]] == ["built_a"]
    text = json.dumps(payload["outlineBodyJson"])
    assert "{{block:built_a}}" in text and "{{block:built_b}}" not in text     # its placeholder goes with it
    assert foreign["id"] not in json.dumps(payload)


def test_hand_written_rows_serve_no_slot_placeholder(db):
    """11.7 note: a listing the reducer did not write serves no `{{block:<slot>}}` line, in its body or its preview."""
    gid = gallery.publish_style(AUTHOR, style(db)["id"], title="T", description="", category="journal",
                                trading_style=None, conn=db)["id"]
    body = {"type": "doc", "content": [heading("Plan"), para("{{block:built_a}}"), para("{{block:chart}}")]}
    db.execute("UPDATE j2_template_gallery SET body_json = ?, preview_json = ?, payload_json = ? WHERE id = ?",
               (json.dumps(body), json.dumps([{"kind": "heading", "text": "Plan"},
                                              {"kind": "text", "text": "{{block:built_a}}"}]),
                json.dumps({"kindId": "weekend_prep", "outlineBodyJson": body, "blocks": [], "properties": {}}),
                gid))
    db.commit()
    approve(db, gid)
    item = gallery.get_item(MEMBER, gid, conn=db)
    assert "built_a" not in json.dumps(item["bodyJson"]) and "{{block:chart}}" in json.dumps(item["bodyJson"])
    assert item["preview"] == [{"kind": "heading", "text": "Plan"}]


# ── the canary, on disk ───────────────────────────────────────────────────────────────────────────

def _assert_clean_blob(blob: str, ids) -> None:
    low = blob.lower()
    for bad in FORBIDDEN_TEXT + FORBIDDEN_NUMBER + tuple(ids):
        assert bad.lower() not in low, f"{bad!r} reached the gallery table: {blob[:300]}"


def test_canary_never_reaches_payload_json_on_disk(db):
    """Review Focus 1 on DISK: the Task 11.4 canary planted in real rows (names, formula names, formula literals,
    filter values, an account named with it, routine item text, a tracker's name and unit, a template's name and its
    outline's link), each published with empty edits (a routine with the words the author typed instead), then every
    stored column of every listing read back and scanned in both encodings."""
    from tests.test_widget_sources import add_account
    acc = add_account(db, AUTHOR, f"{CANARY} Fidelity")
    plan = {"v": 1, "source": "closed_trades", "accounts": {"id": acc},
            "filters": [{"field": "setup", "op": "in", "values": [CANARY, CANARY_UP]},
                        {"field": "symbol", "op": "in", "values": [CANARY_ESC]},
                        {"field": "net", "op": "gt", "values": [NUMBER]}],
            "measures": [{"formula": "f1", "agg": "avg"}],
            "formulas": [{"id": "f1", "name": CANARY, "expr": "[r] * 987654.321", "format": "number"}],
            "range": {"token": "all"}, "display": {"title": CANARY, "target": NUMBER}}
    w = widget(db, plan=plan, name=CANARY)
    r = routine(db, name=CANARY_UP, items=(CANARY, CANARY_ESC))
    t = tracker(db, name=CANARY, unit=CANARY[:16])
    outline = {"type": "doc", "content": [heading("Plan"), para("{{block:built_a}}"), para("{{block:routine_a}}"),
                                          # an image the gallery reducer drops (`sanitize_body`); the outline's own
                                          # headings are the template's structure and travel (W11-R6)
                                          {"type": "image", "attrs": {"src": f"/api/j2/notes/{CANARY}/att/x.png",
                                                                      "alt": CANARY}}]}
    s = style(db, blocks=[built("a", w["id"]), routine_slot("a", r["id"])], outline=outline, name=CANARY)
    ids = [w["id"], r["id"], t["id"], s["id"], acc]
    gallery.publish_tool(AUTHOR, "widget", w["id"], edits={}, conn=db)
    gallery.publish_tool(AUTHOR, "routine", r["id"], edits=routine_edits("Check the plan", ""), conn=db)
    gallery.publish_tool(AUTHOR, "tracker", t["id"], edits={}, conn=db)
    gallery.publish_style(AUTHOR, s["id"], title="Study", description="", category="journal", trading_style=None,
                          edits={"blocks": {"routine_a": {"items": ["Check the plan", ""]}}}, conn=db)
    rows = db.execute("SELECT payload_json, body_json, preview_json, title, description, pending_json"
                      " FROM j2_template_gallery WHERE user_id = ?", (AUTHOR,)).fetchall()
    assert len(rows) == 4
    for row in rows:
        for col in row:
            if col is None:
                continue
            _assert_clean_blob(col, ids)
            _assert_clean_blob(json.dumps(json.loads(col), ensure_ascii=False) if col[:1] and col[:1] in "[{" else col, ids)
    # non-vacuity: the rows really are the shares (picks where the values were, the typed item travelled)
    payloads = [json.loads(r_[0]) for r_ in rows]
    assert any(p.get("slots") for p in payloads)
    assert any("Check the plan" in json.dumps(p) for p in payloads)


# ── 11.4 m3: a refusal sentence is never stored, logged or forwarded ───────────────────────────────────

def test_a_refused_share_is_never_stored_or_logged(db, capsys):
    plan = {**SETUP_PLAN, "formulas": [{"id": "f1", "name": "x", "expr": '[setup] = "my secret words"',
                                        "format": "number"}], "measures": [{"formula": "f1", "agg": "share"}]}
    w = widget(db, plan=plan)
    before = counts(db)
    with pytest.raises(share.ShareError) as e:
        gallery.publish_tool(AUTHOR, "widget", w["id"], conn=db)
    assert e.value.code == "own_words"
    assert counts(db) == before
    out = capsys.readouterr()
    assert "secret" not in out.out and "secret" not in out.err and "Field 1" not in out.out


def test_no_log_call_in_the_gallery_names_a_refusal():
    """Rail: no `print` / logging call in template_gallery.py formats an exception's text (a share refusal may echo the
    author's formula), only its type name."""
    src = GALLERY_SRC.read_text(encoding="utf-8")
    tree = ast.parse(src)
    bad = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and (getattr(n.func, "id", None) == "print"
                                        or getattr(n.func, "attr", None) in ("warning", "info", "error", "exception")):
            text = ast.unparse(n)
            if ".sentence" in text:
                bad.append(text)
    assert bad == []
    planted = "def f(e):\n    print(f'x {e.sentence}')\n"
    assert any(".sentence" in ast.unparse(c) for c in ast.walk(ast.parse(planted)) if isinstance(c, ast.Call))
