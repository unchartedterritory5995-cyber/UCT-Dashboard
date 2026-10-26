"""Notebook widgets phase 2, wave 11, Task 11.6: routine and tracker slots in templates.

A `routine_<k>` / `tracker_<k>` slot is filled when a note is made: a `ref` names the member's own tool (read at FILL
time, `WHERE id = ? AND user_id = ?`); a `template` / `inline` slot asks the reuse question once ("Use your
<name>" / "Create <name> from the template"), creates at most one tool per member and template (W11-R13, unique
`(user_id, source_template_key)`), and the choice is remembered on the member's own style. The block holds only
`{routineId|trackerId, day, bind, display}` and binds to the note's day (W11-R14). Plus the carried rulings: the
11.9 `tool_questions` contract, W11-R21 names (one batched read per family), the public aliases, one decider."""
from __future__ import annotations

import importlib
import json
import re
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

NOW = datetime(2026, 10, 26, 15, 30, tzinfo=timezone.utc)
A, B = "u-tool-a", "u-tool-b"
VECTORS = Path("tests/fixtures/toolBindingVectors.json")
CLIENT_INSERT = Path("app/src/pages/journal-2-0/lib/toolEmbed.js")
CLIENT_ATTRS = Path("app/src/pages/journal-2-0/lib/widgetEmbedCore.js")
CLIENT_REGISTRY = Path("app/src/widgets/registry.js")
ALL_ON = (1, 2, 3, 4, 5, 6, 8, 9, 10, 11)


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    from api.services.journal_two.widget_engine import run
    monkeypatch.setattr(js, "_SLOT_POOL", nw.BoundedPool(js.SLOT_POOL_WORKERS, "nb-style-slot-test"))
    monkeypatch.setattr(js, "_MEMBER_IN_FLIGHT", {})
    run._reset_state()
    _waves(monkeypatch, *ALL_ON)
    yield tmp_path
    run._reset_state()
    importlib.reload(auth_db)


def _waves(monkeypatch, *on):
    for w in range(1, 13):
        if w in on:
            monkeypatch.setenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", "1")
        else:
            monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)


def _js():
    from api.services.journal_two import journal_styles
    return journal_styles


def _sf():
    from api.services.journal_two import slot_fill
    return slot_fill


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def _routine(user=A, name="Morning routine", items=("Coffee",), now=NOW):
    from api.services.journal_two import routines
    return routines.create(user, name=name, items=[{"text": t} for t in items], schedule={"kind": "every"}, now=now)


def _tracker(user=A, name="Sleep log", kind="duration", now=NOW):
    from api.services.journal_two import trackers
    return trackers.create(user, name=name, kind=kind, now=now)


def _heading(text="Prep"):
    return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}


def _ph(bid):
    return {"type": "paragraph", "content": [{"type": "text", "text": "{{block:%s}}" % bid}]}


def _style(*blocks, outline=None, name="Pre-market prep"):
    return {"id": "s-test", "name": name, "kindId": "trade_plan", "version": 1, "properties": {}, "builtin": False,
            "blocks": [{"block": bid, "enabled": True, "settings": s} for bid, s in blocks],
            "outlineBodyJson": outline or {"type": "doc", "content": [_heading()]}}


def _stored(*blocks, user=A, name="Pre-market prep", outline=None):
    js = _js()
    return js.create_style(user, {"name": name, "kindId": "trade_plan", "blocks": [
        {"block": bid, "enabled": True, "settings": s} for bid, s in blocks],
        "outlineBodyJson": outline or {"type": "doc", "content": [_heading()]}})


def _ctx(**over):
    ctx = {"user_id": A, "now": NOW, "note_day": "2026-10-26", "fill_widgets": True, "choices": {},
           "conn": None, "template_title": "Pre-market prep", "gallery_id": None}
    ctx.update(over)
    return ctx


def _tool_nodes(body, kind=None):
    out, stack = [], list(body.get("content") or [])
    while stack:
        n = stack.pop(0)
        if isinstance(n, dict):
            wid = (n.get("attrs") or {}).get("widgetId") if n.get("type") == "widgetEmbed" else None
            if wid in ("routine", "tracker") and (kind is None or wid == kind):
                out.append(n)
            stack.extend(n.get("content") or [])
    return out


def _lines(body):
    return ["".join(c.get("text", "") for c in n.get("content") or []) for n in body["content"]
            if n.get("type") == "paragraph"]


def _count(table, user=A):
    c = _conn()
    try:
        return c.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user,)).fetchone()[0]
    finally:
        c.close()


TPL = {"template": "premarket_routine", "bind": "note-day", "display": "items"}


# ── the reuse questions (the 11.9 contract) ─────────────────────────────────────────────────────

def test_questions_only_for_unresolved_slots(db, monkeypatch):
    sf = _sf()
    mine = _routine(name="Morning routine")
    own_ref = _routine(name="Closing")["id"]
    outline = {"type": "doc", "content": [_heading(), _ph("tracker_a"), _ph("routine_a")]}
    style = _style(("routine_a", TPL),
                   ("routine_b", {"ref": f"routine:{own_ref}"}),
                   ("tracker_a", {"template": "sleep", "bind": "next-trading-day"}),
                   ("tracker_b", {"ref": "checkin:mood"}),
                   ("routine_c", {"inline": "r1", "bind": "week"}),
                   ("routine_d", {"inline": "gone"}),                       # its entry is not in the payload
                   outline=outline)
    inline = {"r1": {"key": "r1", "name": "Shared close", "items": [{"text": "Log every trade"}]}}
    conn = _conn()
    try:
        out = sf.tool_questions(style, user_id=A, conn=conn, inline_routines=inline, inline_trackers={})
    finally:
        conn.close()
    # the note's own order (W11-R28): the unplaced blocks right after the heading, then the placeholders;
    # a ref asks nothing, and an inline entry the payload does not hold asks nothing
    assert [q["slot"] for q in out] == ["routine_c", "tracker_a", "routine_a"]
    by = {q["slot"]: q for q in out}
    assert by["routine_a"] == {"slot": "routine_a", "kind": "routine", "createName": "Pre-market routine",
                               "use": {"id": mine["id"], "name": "Morning routine"}}
    assert by["tracker_a"] == {"slot": "tracker_a", "kind": "tracker", "createName": "Sleep", "use": None}
    assert by["routine_c"]["createName"] == "Shared close"
    # what AdoptSheet.jsx reads: q.slot, q.kind, q.createName, q.use.id / q.use.name
    sheet = Path("../nbw-p2-impl/app/src/pages/journal-2-0/components/notebook/library/AdoptSheet.jsx")
    if sheet.exists():
        src = sheet.read_text(encoding="utf-8")
        for field in ("q.slot", "q.kind", "q.createName", "q.use.id", "q.use.name"):
            assert field in src, field
    # the one decider: wave 9 off asks nothing (routine and tracker slots are hidden)
    _waves(monkeypatch, 1, 2, 3, 4, 5, 6, 8, 10, 11)
    conn = _conn()
    try:
        assert sf.tool_questions(style, user_id=A, conn=conn, inline_routines=inline) == []
    finally:
        conn.close()


def test_questions_read_one_query_per_family_and_never_another_member(db):
    sf = _sf()
    _routine(user=B, name="Pre-market routine", items=("Read the morning wire",))
    style = _style(("routine_a", TPL), ("routine_b", {"template": "night_before"}),
                   ("tracker_a", {"template": "sleep"}), ("tracker_b", {"template": "energy"}))
    conn = _conn()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        out = sf.tool_questions(style, user_id=A, conn=conn)
    finally:
        conn.set_trace_callback(None)
        conn.close()
    assert [q["use"] for q in out] == [None, None, None, None]          # B's routine is never suggested to A
    reads = [s for s in seen if "FROM j2_routines" in s or "FROM j2_trackers" in s]
    assert len(reads) == 2, reads                                        # one per family, not one per slot
    assert all(B not in s for s in seen)


def test_questions_through_template_preview_call_site(db):
    """The exact call `template_preview._questions` makes (payload, user_id=, conn=, inline_routines=,
    inline_trackers=) answers the questions, no longer []."""
    from api.services.journal_two import template_preview as tp
    payload = {"blocks": [{"block": "routine_a", "enabled": True, "settings": {"inline": "r1"}}],
               "routines": [{"key": "r1", "name": "Shared close", "items": [{"text": "Log"}]}], "trackers": []}
    conn = _conn()
    try:
        got = tp._questions(payload, user_id=A, conn=conn)
    finally:
        conn.close()
    assert got == [{"slot": "routine_a", "kind": "routine", "createName": "Shared close", "use": None}]


# ── create: unique, restored, owned, refused ────────────────────────────────────────────────────

def test_create_is_unique_across_two_uses(db):
    sf = _sf()
    block = {"block": "routine_a", "settings": TPL}
    gate = threading.Barrier(2)
    got: list = []
    errs: list = []

    def use():
        try:
            gate.wait(5)
            got.append(sf.build_tool_slot(block, _ctx(choices={"routine_a": {"create": True}})))
        except Exception as e:  # noqa: BLE001
            errs.append(e)
    threads = [threading.Thread(target=use) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert not errs, errs
    ids = {node["attrs"]["params"]["routineId"] for node, _ in got}
    assert len(ids) == 1 and _count("j2_routines") == 1                # one routine, both blocks name it
    c = _conn()
    try:
        row = c.execute("SELECT source_template_key, settings_json FROM j2_routines WHERE user_id = ?", (A,)).fetchone()
    finally:
        c.close()
    assert row["source_template_key"] == "tpl:premarket_routine"


def test_two_uses_at_once_make_one_routine_two_notes(db):
    """Review Focus 2: two tabs press Use on the same template within milliseconds."""
    js = _js()
    style = _stored(("routine_a", TPL))
    gate = threading.Barrier(2)
    notes: list = []
    errs: list = []

    def use():
        try:
            gate.wait(5)
            notes.append(js.create_styled_note(A, {"styleId": style["id"], "title": "Prep",
                                                   "choices": {"routine_a": {"create": True}}})[0])
        except Exception as e:  # noqa: BLE001
            errs.append(e)
    threads = [threading.Thread(target=use) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert not errs, errs
    assert len(notes) == 2 and len({n["id"] for n in notes}) == 2
    ids = {_tool_nodes(n["bodyJson"])[0]["attrs"]["params"]["routineId"] for n in notes}
    assert len(ids) == 1 and _count("j2_routines") == 1
    after = js.get_style(A, style["id"])
    assert after["blocks"][0]["settings"] == {"ref": f"routine:{ids.pop()}", "bind": "note-day", "display": "items"}


def test_create_restores_a_soft_deleted_template_routine(db):
    from api.services.journal_two import routines
    sf = _sf()
    block = {"block": "routine_a", "settings": TPL}
    first, _ = sf.build_tool_slot(block, _ctx(choices={"routine_a": {"create": True}}))
    rid = first["attrs"]["params"]["routineId"]
    routines.archive(A, rid, now=NOW)
    routines.soft_delete(A, rid, typed_name="Pre-market routine", now=NOW)
    assert routines.get(A, rid) is None
    again, _ = sf.build_tool_slot(block, _ctx(now=NOW + timedelta(days=2), choices={"routine_a": {"create": True}}))
    assert again["attrs"]["params"]["routineId"] == rid                # W9-R12: the same row, live again
    back = routines.get(A, rid)
    assert back is not None and back["archived"] is False and _count("j2_routines") == 1


def test_use_choice_must_be_owned(db):
    from api.services.journal_two.widget_engine.share import ShareError
    sf = _sf()
    theirs = _routine(user=B, name="Pre-market routine")
    block = {"block": "routine_a", "settings": TPL}
    for bad in (theirs["id"], str(uuid.uuid4()), "", 7):
        with pytest.raises(ShareError) as e:
            sf.build_tool_slot(block, _ctx(choices={"routine_a": {"use": bad}}))
        assert e.value.code == "not_yours" and e.value.sentence == "That choice isn't in your account."
    assert _count("j2_routines") == 0                                   # nothing created for A
    mine = _routine(name="Morning routine")
    node, why = sf.build_tool_slot(block, _ctx(choices={"routine_a": {"use": mine["id"]}}))
    assert why is None and node["attrs"]["params"]["routineId"] == mine["id"]
    assert _count("j2_routines") == 1
    # a tracker choice may name a check-in tracker (it is every member's)
    tnode, _ = sf.build_tool_slot({"block": "tracker_a", "settings": {"template": "energy"}},
                                  _ctx(choices={"tracker_a": {"use": "checkin:mood"}}))
    assert tnode["attrs"]["params"]["trackerId"] == "checkin:mood"


def test_missing_choice_refused_with_sentence(db):
    from api.services.journal_two import template_tools as tt
    js, sf = _js(), _sf()
    for block, sentence in (({"block": "routine_a", "settings": TPL}, tt.S_CHOOSE_ROUTINE),
                            ({"block": "tracker_a", "settings": {"template": "sleep"}}, tt.S_CHOOSE_TRACKER)):
        for choices in ({}, {block["block"]: {}}, {block["block"]: {"create": "yes"}}, {block["block"]: "use"}):
            with pytest.raises(tt.LibraryError) as e:
                sf.build_tool_slot(block, _ctx(choices=choices))
            assert e.value.sentence == sentence and e.value.code == "unresolved"
    # through a styled create: refused, and nothing is written (no note, no tool, the style unchanged)
    style = _stored(("routine_a", TPL))
    with pytest.raises(tt.LibraryError):
        js.create_styled_note(A, {"styleId": style["id"], "title": "Prep"})
    assert _count("j2_notes") == 0 and _count("j2_routines") == 0
    assert js.get_style(A, style["id"])["version"] == style["version"]


def test_choice_remembered_on_the_style(db):
    js, sf = _js(), _sf()
    mine = _tracker(name="Hours of sleep", kind="duration")
    style = _stored(("routine_a", {"template": "night_before", "bind": "next-trading-day", "display": "pnl"}),
                    ("tracker_a", {"template": "sleep", "bind": "week", "display": "pnl"}),
                    ("tracker_b", {"ref": "checkin:focus"}))
    conn = _conn()
    try:
        asked = sf.tool_questions(style, user_id=A, conn=conn)
    finally:
        conn.close()
    assert [(q["slot"], q["use"]) for q in asked] == [("routine_a", None),
                                                    ("tracker_a", {"id": mine["id"], "name": "Hours of sleep"})]
    note, _ = js.create_styled_note(A, {"styleId": style["id"], "title": "Night",
                                        "choices": {"routine_a": {"create": True},
                                                    "tracker_a": {"use": mine["id"]}}})
    made = _tool_nodes(note["bodyJson"], "routine")[0]["attrs"]["params"]["routineId"]
    after = js.get_style(A, style["id"])
    assert [b["settings"] for b in after["blocks"]] == [
        {"ref": f"routine:{made}", "bind": "next-trading-day", "display": "pnl"},
        {"ref": f"tracker:{mine['id']}", "bind": "week", "display": "pnl"},
        {"ref": "checkin:focus", "bind": "note-day", "display": "chart"}]
    assert after["version"] == style["version"]                         # remembering is not an edit (fix round 1)
    assert note["styleVersion"] == style["version"]                     # the version it was composed from
    # remembered: the next use asks nothing and makes nothing new
    conn = _conn()
    try:
        assert sf.tool_questions(after, user_id=A, conn=conn) == []
    finally:
        conn.close()
    second, _ = js.create_styled_note(A, {"styleId": style["id"], "title": "Night 2"})
    assert _tool_nodes(second["bodyJson"], "routine")[0]["attrs"]["params"]["routineId"] == made
    assert _count("j2_routines") == 1 and js.get_style(A, style["id"])["version"] == after["version"]


def test_from_template_setting_written(db):
    from api.services.journal_two import routines, trackers
    sf = _sf()
    long_title = "T" * 120
    node, _ = sf.build_tool_slot({"block": "routine_a", "settings": TPL},
                                 _ctx(choices={"routine_a": {"create": True}}, template_title=long_title))
    r = routines.get(A, node["attrs"]["params"]["routineId"])
    assert r["settings"]["fromTemplate"] == "T" * 80
    assert r["name"] == "Pre-market routine" and [i["text"] for i in r["items"]] == [
        i["text"] for i in routines.STARTERS["premarket"]["items"]]
    tnode, _ = sf.build_tool_slot({"block": "tracker_a", "settings": {"template": "sleep"}},
                                  _ctx(choices={"tracker_a": {"create": True}}, template_title="Sleep and focus"))
    t = trackers.get(A, tnode["attrs"]["params"]["trackerId"])
    assert t["settings"] == {"days": "trading", "fromTemplate": "Sleep and focus"}
    assert (t["name"], t["kind"], t["unit"], t["sourceTemplateKey"]) == ("Sleep", "duration", None, "tpl:sleep")
    # a member-shared template's inline tool: keyed on the gallery item, which it records
    gid = uuid.uuid4().hex
    inode, _ = sf.build_tool_slot(
        {"block": "routine_b", "settings": {"inline": "r1"}},
        _ctx(choices={"routine_b": {"create": True}}, gallery_id=gid,
             inline_routines={"r1": {"key": "r1", "name": "Shared close", "items": [{"text": "Log it"}]}}))
    c = _conn()
    try:
        row = c.execute("SELECT source_template_key, source_gallery_id FROM j2_routines WHERE id = ?",
                        (inode["attrs"]["params"]["routineId"],)).fetchone()
    finally:
        c.close()
    assert (row["source_template_key"], row["source_gallery_id"]) == (f"gal:{gid}:r1", gid)
    # without a gallery item an inline tool cannot be made (it would have no unique key)
    _, why = sf.build_tool_slot(
        {"block": "routine_c", "settings": {"inline": "r1"}},
        _ctx(choices={"routine_c": {"create": True}},
             inline_routines={"r1": {"key": "r1", "name": "Shared close", "items": [{"text": "Log it"}]}}))
    assert why == "slot-unreadable:routine_c"



def test_a_failed_note_insert_remembers_nothing(db):
    """The choice and the note are ONE transaction: a note refused after the choice was remembered leaves the
    style as it was, even on a caller's connection that commits later."""
    from api.services.journal_two import notes
    js = _js()
    style = _stored(("routine_a", TPL))
    conn = _conn()
    try:
        with pytest.raises(notes.NoteValidationError):
            js.create_styled_note(A, {"styleId": style["id"], "title": "x" * 10_000,
                                      "choices": {"routine_a": {"create": True}}}, conn)
        assert not conn.in_transaction
        conn.commit()
    finally:
        conn.close()
    after = js.get_style(A, style["id"])
    assert after["version"] == style["version"] and after["blocks"][0]["settings"]["template"] == "premarket_routine"
    assert _count("j2_notes") == 0

# ── the node, the binding, the refs ─────────────────────────────────────────────────────────────

def _client_attr_keys() -> set[str]:
    src = CLIENT_ATTRS.read_text(encoding="utf-8")
    body = src[src.index("export function buildWidgetEmbedAttrs"):]
    body = body[body.index("  return {"):body.index("\n  }\n")]
    return set(re.findall(r"^    (\w+)[:,]", body, re.M))


def _client_kinds() -> dict:
    src = CLIENT_INSERT.read_text(encoding="utf-8")
    return {k: (idk, disp) for k, idk, disp in
            re.findall(r"(\w+): \{ idKey: '(\w+)', display: '(\w+)'", src)}


def _client_params(kind: str) -> list[str]:
    src = CLIENT_REGISTRY.read_text(encoding="utf-8")
    block = src[src.index(f"  {kind}: blockManifest("):]
    block = block[:block.index("]")]
    return re.findall(r"\{ key: '(\w+)'", block)


def test_node_attrs_match_the_client_insert(db):
    js, sf = _js(), _sf()
    kinds = _client_kinds()
    assert set(kinds) == {"routine", "tracker"}
    assert {k: v[0] for k, v in kinds.items()} == sf.TOOL_ID_KEYS
    assert {k: v[1] for k, v in kinds.items()} == {f: js.SLOT_DISPLAYS[f][0] for f in ("routine", "tracker")}
    mine = _routine(name="Morning routine")
    node, why = sf.build_tool_slot({"block": "routine_a", "settings": {"ref": f"routine:{mine['id']}"}}, _ctx())
    assert why is None
    attrs = node["attrs"]
    assert node["type"] == "widgetEmbed" and set(attrs) == _client_attr_keys()
    assert list(attrs["params"]) == _client_params("routine")
    assert attrs["params"] == {"routineId": mine["id"], "day": "2026-10-26", "bind": "note-day", "display": "items"}
    assert (attrs["v"], attrs["widgetId"], attrs["mode"], attrs["annotations"], attrs["caption"],
            attrs["layout"], attrs["fallback"]) == (1, "routine", "snapshot", [], None,
                                                    {"width": "full", "height": None}, None)
    assert re.fullmatch(r"[0-9a-f]{32}", attrs["embedId"])
    from api.services.journal_two import tool_binding
    assert attrs["searchText"] == tool_binding.search_text("routine", "Morning routine", "2026-10-26", "note-day")
    tnode, _ = sf.build_tool_slot({"block": "tracker_a", "settings": {"ref": "checkin:mood", "display": "pnl"}},
                                  _ctx())
    assert list(tnode["attrs"]["params"]) == _client_params("tracker")
    assert tnode["attrs"]["params"] == {"trackerId": "checkin:mood", "day": "2026-10-26", "bind": "note-day",
                                        "display": "pnl"}
    assert tnode["attrs"]["searchText"].startswith("[tracker: Check-in mood ")
    # ⛔ live state never enters the block: no tick, value, item or count key anywhere in it
    keys: set[str] = set()
    stack = [node, tnode]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            keys |= set(n)
            stack.extend(n.values())
        elif isinstance(n, list):
            stack.extend(n)
    for word in ("tick", "value", "item", "done", "count", "state"):
        assert not [k for k in keys if word in k.lower()], word


def test_next_trading_day_and_week_binding_in_the_note(db, monkeypatch):
    """Review Focus 3, from the vector file both sides read (W11-R14), into real notes."""
    js, sf = _js(), _sf()
    vectors = json.loads(VECTORS.read_text(encoding="utf-8"))
    from api.services.journal_two import tool_binding
    checked = 0
    for v in vectors["bind"]:
        if v.get("raises"):
            continue
        style = _style(("routine_a", {"template": "night_before", "bind": v["bind"]}))
        out = js.compose(A, style, ticker=None, conn=None, now=NOW, note_day=v["note_day"],
                         choices={"routine_a": {"create": True}})
        params = _tool_nodes(out["bodyJson"])[0]["attrs"]["params"]
        assert params["day"] == v["expected"], v
        assert params["bind"] == v["bind"]
        checked += 1
    assert checked >= 20
    # the client's search line for each search vector, through the node
    for v in vectors["search"]:
        node = sf.tool_node(v["kind"], "x", v["name"], v["day"], v["bind"], "items")
        assert node["attrs"]["searchText"] == v["expected"]

    # a styled create binds from the ET day the note is MADE: 23:30 ET Thanksgiving (04:30 UTC Friday) binds Fri
    class Clock(datetime):
        fixed = datetime(2026, 11, 27, 4, 30, tzinfo=timezone.utc)

        @classmethod
        def now(cls, tz=None):
            return cls.fixed if tz is None else cls.fixed.astimezone(tz)
    monkeypatch.setattr(js, "datetime", Clock)
    style = _stored(("routine_a", {"template": "night_before", "bind": "next-trading-day"}),
                    ("routine_b", {"template": "swing_weekend", "bind": "week"}))
    note, _ = js.create_styled_note(A, {"styleId": style["id"], "title": "T",
                                        "choices": {"routine_a": {"create": True}, "routine_b": {"create": True}}})
    days = [n["attrs"]["params"]["day"] for n in _tool_nodes(note["bodyJson"])]
    assert days == ["2026-11-27", "2026-11-27"]                         # note day Thu 11-26: next session, its week
    assert tool_binding.note_day(daily_date=None, created_at=Clock.fixed.isoformat(), now=Clock.fixed) == "2026-11-26"
    # a Saturday swing review binds the Friday just ended, "For the week of Oct 19"
    Clock.fixed = datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc)
    sat, _ = js.create_styled_note(A, {"styleId": style["id"], "title": "Sat"})
    week = [n for n in _tool_nodes(sat["bodyJson"]) if n["attrs"]["params"]["bind"] == "week"][0]["attrs"]
    assert week["params"]["day"] == "2026-10-23" and week["searchText"].endswith("For the week of Oct 19]")


def test_empty_note_switched_to_a_style_binds_the_notes_own_day(db):
    from api.services.journal_two import notes
    js = _js()
    mine = _routine(name="Morning routine")
    style = _stored(("routine_a", {"ref": f"routine:{mine['id']}", "bind": "next-trading-day"}))
    note = notes.create_note(A, {"title": "Old", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    c = _conn()
    try:
        c.execute("UPDATE j2_notes SET created_at = ? WHERE id = ?", ("2026-10-23T15:00:00+00:00", note["id"]))
        c.commit()
    finally:
        c.close()
    updated, _plan = js.apply_style_update(A, note["id"], style_id=style["id"])
    params = _tool_nodes(updated["bodyJson"])[0]["attrs"]["params"]
    assert params["day"] == "2026-10-26"                                 # Fri 10-23's next session, never today's


def test_follow_today_slot_is_refused(db, monkeypatch):
    js, sf = _js(), _sf()
    mine = _routine()
    block = {"block": "routine_a", "settings": {"ref": f"routine:{mine['id']}", "bind": "today"}}
    assert sf.build_tool_slot(block, _ctx()) == (None, "slot-unreadable:routine_a")
    with pytest.raises(js.StyleValidationError):
        js.slot_settings_of("routine", block["settings"])
    # a second layer holds even if the grammar ever let "today" through: bind_day refuses it, no node is made
    monkeypatch.setattr(js, "_slot_binds", lambda: ("note-day", "next-trading-day", "week", "today"))
    assert sf.build_tool_slot(block, _ctx()) == (None, "slot-unreadable:routine_a")


def test_archived_ref_placed_read_only(db):
    from api.services.journal_two import routines
    js = _js()
    mine = _routine(name="Old routine")
    routines.archive(A, mine["id"], now=NOW)
    out = js.compose(A, _style(("routine_a", {"ref": f"routine:{mine['id']}"})), ticker=None, conn=None, now=NOW)
    nodes = _tool_nodes(out["bodyJson"])
    assert len(nodes) == 1 and nodes[0]["attrs"]["params"]["routineId"] == mine["id"]
    assert out["skipped"] == [] and out["slotNames"] == {"routine_a": "Old routine"}


def test_foreign_ref_sentence_and_no_foreign_read(db):
    js = _js()
    theirs = _routine(user=B, name="Secret routine")
    their_tracker = _tracker(user=B, name="Secret sleep")
    style = _style(("routine_a", {"ref": f"routine:{theirs['id']}"}),
                   ("tracker_a", {"ref": f"tracker:{their_tracker['id']}"}),
                   ("routine_b", {"ref": f"routine:{uuid.uuid4()}"}))
    conn = _conn()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        out = js.compose(A, style, ticker=None, conn=conn, now=NOW)
    finally:
        conn.set_trace_callback(None)
        conn.close()
    assert _tool_nodes(out["bodyJson"]) == []
    lines = _lines(out["bodyJson"])
    assert lines.count("This routine is not in your account.") == 2
    assert "This tracker is not in your account." in lines
    assert out["slotNames"] == {"routine_a": "This routine is not in your account.",
                                "tracker_a": "This tracker is not in your account.",
                                "routine_b": "This routine is not in your account."}
    tool_reads = [s for s in seen if "FROM j2_routines" in s or "FROM j2_trackers" in s]
    assert tool_reads and all(f"'{A}'" in s for s in tool_reads)
    assert all(B not in s for s in seen) and "Secret" not in json.dumps(out)


def test_names_are_one_batched_read_per_family(db):
    js = _js()
    rs = [_routine(name=f"R{i}") for i in range(4)]
    ts = [_tracker(name=f"T{i}") for i in range(3)]
    blocks = [(f"routine_{chr(97 + i)}", {"ref": f"routine:{r['id']}"}) for i, r in enumerate(rs)]
    blocks += [(f"tracker_{chr(97 + i)}", {"ref": f"tracker:{t['id']}"}) for i, t in enumerate(ts)]
    blocks += [("routine_x", {"template": "tilt_reset"}), ("tracker_x", {"ref": "checkin:focus"})]
    style = _style(*blocks)
    conn = _conn()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        served = js.served_style(style, A, conn)
    finally:
        conn.set_trace_callback(None)
        conn.close()
    assert served["slotNames"] == {**{f"routine_{chr(97 + i)}": f"R{i}" for i in range(4)},
                                   **{f"tracker_{chr(97 + i)}": f"T{i}" for i in range(3)},
                                   "routine_x": "Tilt reset", "tracker_x": "Check-in focus"}
    assert len([s for s in seen if "FROM j2_routines" in s]) == 1
    assert len([s for s in seen if "FROM j2_trackers" in s]) == 1


def test_name_read_failure_and_budget_fall_back_to_the_family_word(db, monkeypatch):
    js, sf = _js(), _sf()
    from api.services.journal_two import routines
    mine = _routine(name="Morning routine")
    style = _style(("routine_a", {"ref": f"routine:{mine['id']}"}))

    def boom(*a, **k):
        raise RuntimeError("read failed")
    real = routines.resolve_many
    monkeypatch.setattr(routines, "resolve_many", boom)
    assert js.served_style(style, A)["slotNames"] == {"routine_a": "Routine"}
    monkeypatch.setattr(routines, "resolve_many", real)
    assert js.served_style(style, A)["slotNames"] == {"routine_a": "Morning routine"}     # control: it can name
    monkeypatch.setattr(sf, "TOOL_PREFETCH_MAX", 0)                       # past the budget: unknown, not missing
    assert js.served_style(style, A)["slotNames"] == {"routine_a": "Routine"}


def test_preview_reads_nothing_and_says_where_it_goes(db):
    js = _js()
    style = {"name": "Night", "kindId": "trade_plan", "outlineBodyJson": {"type": "doc", "content": [_heading()]},
             "blocks": [{"block": "routine_a", "enabled": True, "settings": {"template": "night_before",
                                                                              "bind": "next-trading-day"}},
                        {"block": "tracker_a", "enabled": True, "settings": {"template": "sleep", "bind": "week"}},
                        {"block": "routine_b", "enabled": True, "settings": {"template": "tilt_reset"}}]}
    out = js.preview(A, {"style": style})
    assert _tool_nodes(out["bodyJson"]) == []
    assert _lines(out["bodyJson"]) == ["Night-before prep goes here, for the next trading day.",
                                       "Sleep goes here, for the trading week.",
                                       "Tilt reset goes here, for the day of your note."]
    assert _count("j2_routines") == 0 and _count("j2_trackers") == 0


def test_follow_today_node_saves_as_note_day(db):
    from api.services.journal_two import notes
    js = _js()
    mine = _routine(name="Morning routine")
    theirs = _tracker(name="Mood log", kind="scale")
    body = {"type": "doc", "content": [
        _heading(),
        {"type": "widgetEmbed", "attrs": {"widgetId": "routine", "params": {
            "routineId": mine["id"], "day": "2026-10-26", "bind": "today", "display": "pnl"}}},
        {"type": "widgetEmbed", "attrs": {"widgetId": "tracker", "params": {
            "trackerId": theirs["id"], "day": "2026-10-26", "bind": "week", "display": "chart"}}},
        {"type": "widgetEmbed", "attrs": {"widgetId": "tracker", "params": {
            "trackerId": "checkin:mood", "day": "2026-10-26", "bind": "next-trading-day", "display": "nope"}}},
    ]}
    note = notes.create_note(A, {"title": "Tools", "bodyJson": body})
    style = js.create_style_from_note(A, note["id"], "Saved", "trade_plan")
    assert [(b["block"], b["settings"]) for b in style["blocks"]] == [
        ("routine_a", {"ref": f"routine:{mine['id']}", "bind": "note-day", "display": "pnl"}),
        ("tracker_a", {"ref": f"tracker:{theirs['id']}", "bind": "week", "display": "chart"}),
        ("tracker_b", {"ref": "checkin:mood", "bind": "next-trading-day", "display": "chart"})]
    text = json.dumps(style["outlineBodyJson"])
    assert "{{block:routine_a}}" in text and "{{block:tracker_b}}" in text and "widgetEmbed" not in text


def test_open_and_fill_touch_no_tick_rows(db):
    js, sf = _js(), _sf()
    mine = _routine(name="Morning routine")
    style = _stored(("routine_a", {"ref": f"routine:{mine['id']}"}), ("routine_b", TPL),
                    ("tracker_a", {"template": "sleep"}), ("tracker_b", {"ref": "checkin:mood"}))
    conn = _conn()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        sf.tool_questions(style, user_id=A, conn=conn)
        js.served_style(js.get_style(A, style["id"], conn), A, conn)
        js.create_styled_note(A, {"styleId": style["id"], "title": "Fill", "choices": {
            "routine_b": {"create": True}, "tracker_a": {"create": True}}}, conn)
        js.preview(A, {"styleId": style["id"]}, conn)
    finally:
        conn.set_trace_callback(None)
        conn.close()
    for table in ("j2_routine_ticks", "j2_routine_days", "j2_tracker_values"):
        assert _count(table) == 0, table
        assert not any(table in s for s in seen), table                # not even read


def test_tools_take_no_engine_share_and_build_in_place(db, monkeypatch):
    """The 11.5 per-member in-flight share is unaffected: tool slots never enter the slot pool."""
    js = _js()
    taken: list = []
    real_take = js._member_take
    monkeypatch.setattr(js, "_member_take", lambda uid: taken.append(uid) or real_take(uid))
    mine = _routine(name="Morning routine")
    out = js.compose(A, _style(("routine_a", {"ref": f"routine:{mine['id']}"}),
                               ("tracker_a", {"ref": "checkin:focus"})), ticker=None, conn=None, now=NOW)
    assert len(_tool_nodes(out["bodyJson"])) == 2 and taken == []
    assert js.POOLED_FAMILIES == frozenset({"built"})


def test_public_aliases_are_the_one_implementation(db, monkeypatch):
    js, sf = _js(), _sf()
    assert js.slot_wave_off("routine_a", {"ref": "checkin:mood"}) is js._slot_wave_off("routine_a", {"ref": "checkin:mood"})
    seen = []
    real = js._slot_wave_off
    monkeypatch.setattr(js, "_slot_wave_off", lambda *a: seen.append(a) or real(*a))
    js.slot_wave_off("tracker_a", None, None)
    assert seen == [("tracker_a", None, None)]                          # the public name reaches the private one
    calls = []
    monkeypatch.setattr(sf, "_dark", lambda plan: calls.append(plan) or True)
    assert sf.plan_is_dark({"x": 1}) is True and calls == [{"x": 1}]
    # one decider: wave 9 off hides routine and tracker slots on every path (served, compose)
    _waves(monkeypatch, 1, 2, 3, 4, 5, 6, 8, 10, 11)
    style = _style(("routine_a", {"ref": "routine:" + str(uuid.uuid4())}), ("tracker_a", {"ref": "checkin:mood"}))
    assert js.served_style(style, A)["blocks"] == []
    out = js.compose(A, style, ticker=None, conn=None, now=NOW)
    assert _tool_nodes(out["bodyJson"]) == [] and out["skipped"] == [] and "slotNames" not in out


# -- Fix round 1 ------------------------------------------------------------------------------------

def _routine_ids(note):
    return [n["attrs"]["params"]["routineId"] for n in _tool_nodes(note["bodyJson"], "routine")]


def _race(user, sid, choice_list, delay=0.0):
    import time
    js = _js()
    gate = threading.Barrier(len(choice_list))
    res, errs = [None] * len(choice_list), []

    def go(i, ch):
        try:
            gate.wait(5)
            if i and delay:
                time.sleep(delay)
            res[i] = js.create_styled_note(user, {"styleId": sid, "title": "Prep", "choices": ch})[0]
        except Exception as e:  # noqa: BLE001
            errs.append((i, type(e).__name__, str(e)))
    threads = [threading.Thread(target=go, args=(i, ch)) for i, ch in enumerate(choice_list)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    return res, errs


def test_create_and_use_at_once_name_one_routine(db):
    """I1, Review Focus 2's third case (the reviewer's S3, real threads): one tab creates the routine while the other
    picks "Use your Morning routine", order alternated, 0 to 30 ms apart. 20 rounds, 0 divergent ids."""
    js = _js()
    divergent, errors = [], []
    for k in range(20):
        u = f"u-race-{k}"
        mine = _routine(user=u, name="Morning routine")
        style = _stored(("routine_a", TPL), user=u)
        order = [{"routine_a": {"create": True}}, {"routine_a": {"use": mine["id"]}}]
        if k % 2:
            order.reverse()
        res, errs = _race(u, style["id"], order, delay=0.01 * (k % 4))
        errors += errs
        ids = {i for n in res if n for i in _routine_ids(n)}
        remembered = js.get_style(u, style["id"])["blocks"][0]["settings"].get("ref")
        if len([n for n in res if n]) != 2 or len(ids) != 1 or remembered != "routine:" + next(iter(ids), ""):
            divergent.append({"round": k, "ids": ids, "remembered": remembered})
        # each note is stamped with the version it was composed from, and remembering moved none
        assert all(n["styleVersion"] == style["version"] for n in res if n)
    assert not errors, errors
    assert divergent == [], divergent


def test_a_choice_naming_another_members_routine_never_lands_in_the_style(db, monkeypatch):
    """I2 (the reviewer's r116_unchecked): only enabled, shown slots are eligible, and every use id is checked as the
    member's own BEFORE it is remembered. Member B's routine id never lands in member A's style."""
    from api.services.journal_two.widget_engine.share import ShareError
    js, sf = _js(), _sf()
    theirs = _routine(user=B, name="Theirs")
    disabled = js.create_style(A, {"name": "Off", "kindId": "trade_plan", "blocks": [
        {"block": "routine_a", "enabled": False, "settings": {"template": "premarket_routine"}}],
        "outlineBodyJson": {"type": "doc", "content": []}})
    js.create_styled_note(A, {"styleId": disabled["id"], "title": "P", "choices": {"routine_a": {"use": theirs["id"]}}})
    assert js.get_style(A, disabled["id"])["blocks"][0]["settings"]["template"] == "premarket_routine"
    # remember_choices itself ignores a disabled slot, even for the member's OWN routine (a direct caller)
    own = _routine(name="Mine")
    conn = _conn()
    try:
        sf.remember_choices(A, disabled["id"], {"routine_a": {"use": own["id"]}}, {"routine_a": own["id"]}, conn=conn)
        conn.commit()
    finally:
        conn.close()
    assert js.get_style(A, disabled["id"])["blocks"][0]["settings"]["template"] == "premarket_routine"
    # an enabled slot: the foreign answer is refused and nothing is written (no note, no change)
    shown = _stored(("routine_a", TPL))
    with pytest.raises(ShareError) as e:
        js.create_styled_note(A, {"styleId": shown["id"], "title": "P", "choices": {"routine_a": {"use": theirs["id"]}}})
    assert e.value.code == "not_yours" and e.value.sentence == "That choice isn't in your account."
    assert js.get_style(A, shown["id"])["blocks"][0]["settings"]["template"] == "premarket_routine"
    # remember_choices itself refuses an unchecked id (a caller that hands it raw answers), writing nothing
    conn = _conn()
    try:
        for bad in (theirs["id"], str(uuid.uuid4())):
            with pytest.raises(ShareError):
                sf.remember_choices(A, shown["id"], {"routine_a": {"use": bad}}, {}, conn=conn)
        conn.commit()
    finally:
        conn.close()
    # wave 9 off: the slot is hidden, so its answer is ignored and the template slot is kept
    _waves(monkeypatch, 1, 2, 3, 4, 5, 6, 8, 10, 11)
    js.create_styled_note(A, {"styleId": shown["id"], "title": "P", "choices": {"routine_a": {"use": theirs["id"]}}})
    conn = _conn()
    try:
        sf.remember_choices(A, shown["id"], {"routine_a": {"use": theirs["id"]}}, {}, conn=conn)
        conn.commit()
        raw = [r[0] for r in conn.execute("SELECT blocks_json FROM j2_journal_styles WHERE user_id = ?", (A,))]
    finally:
        conn.close()
    assert not any(theirs["id"] in r for r in raw), raw
    assert _count("j2_notes") == 2                                       # the two creates whose answer was ignored


def test_switching_a_note_to_a_style_skips_an_unanswered_template_slot_in_plan_and_write(db):
    """I3 (W11-R30): there is nothing to answer on when a note is switched to a style, so an unanswered template slot
    is skipped with its line, and the dry run plans exactly what the write writes."""
    from api.services.journal_two import notes
    js = _js()
    mine = _routine(name="Morning routine")
    style = _stored(("routine_a", TPL), ("routine_b", {"ref": f"routine:{mine['id']}"}),
                    ("tracker_a", {"template": "sleep"}))
    note = notes.create_note(A, {"title": "Old", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    planned = js.plan_style_update(A, note["id"], style_id=style["id"])
    updated, plan = js.apply_style_update(A, note["id"], style_id=style["id"])
    written = [n["attrs"]["params"].get("routineId") or n["attrs"]["params"].get("trackerId")
               for n in _tool_nodes(updated["bodyJson"])]
    assert [a["block"] for a in planned["add"]] == ["routine_b"] == [a["block"] for a in plan["add"]]
    assert written == [mine["id"]]
    assert {(x["block"], x["reason"]) for x in planned["skipped"]} == {
        ("routine_a", "slot-unanswered:routine_a"), ("tracker_a", "slot-unanswered:tracker_a")}
    lines = _lines(updated["bodyJson"])
    assert "Make a new note from this template to choose its routine." in lines
    assert "Make a new note from this template to choose its tracker." in lines
    assert _count("j2_routines") == 1 and _count("j2_trackers") == 0     # nothing was created


def test_questions_follow_the_notes_block_order(db):
    """W11-R28: the questions come in the order the note shows the blocks, from compose's own placement."""
    js, sf = _js(), _sf()
    outline = {"type": "doc", "content": [
        _ph("routine_c"),                                              # before the first heading: stays first
        _heading(),
        {"type": "bulletList", "content": [{"type": "listItem", "content": [_ph("tracker_b")]}]},  # nested: no place
        _ph("tracker_a"),
        _ph("routine_a")]}
    style = _style(("routine_a", TPL), ("routine_b", {"template": "tilt_reset"}), ("tracker_a", {"template": "sleep"}),
                   ("tracker_b", {"template": "energy"}), ("routine_c", {"template": "eod_review"}), outline=outline)
    conn = _conn()
    try:
        asked = [q["slot"] for q in sf.tool_questions(style, user_id=A, conn=conn)]
    finally:
        conn.close()
    out = js.compose(A, style, ticker=None, conn=None, now=NOW, choices={q: {"create": True} for q in asked})
    by_id = {t: bid for bid, t in out["toolsCreated"].items()}
    composed_order = [by_id[n["attrs"]["params"].get("routineId") or n["attrs"]["params"].get("trackerId")]
                      for n in _tool_nodes(out["bodyJson"])]
    assert asked == composed_order == ["routine_c", "routine_b", "tracker_b", "tracker_a", "routine_a"]
    assert js.placement_order(outline["content"], style["blocks"]) == asked


def test_create_restores_an_archived_template_routine(db):
    """M1 ruling: "Create" for a template-made routine that is ARCHIVED restores it live and uses it."""
    from api.services.journal_two import routines
    sf = _sf()
    block = {"block": "routine_a", "settings": TPL}
    first, _ = sf.build_tool_slot(block, _ctx(choices={"routine_a": {"create": True}}))
    rid = first["attrs"]["params"]["routineId"]
    routines.archive(A, rid, now=NOW)
    again, _ = sf.build_tool_slot(block, _ctx(choices={"routine_a": {"create": True}}))
    assert again["attrs"]["params"]["routineId"] == rid
    assert routines.get(A, rid)["archived"] is False and _count("j2_routines") == 1


def test_an_empty_daily_note_switched_to_a_style_binds_its_daily_date(db):
    """M2: the daily date wins over the created day (W11-R14)."""
    from api.services.journal_two import notes
    js = _js()
    mine = _routine(name="Morning routine")
    style = _stored(("routine_a", {"ref": f"routine:{mine['id']}", "bind": "next-trading-day"}))
    note = notes.create_note(A, {"title": "Day", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}},
                             daily_date="2026-11-25")
    updated, _plan = js.apply_style_update(A, note["id"], style_id=style["id"])
    assert _tool_nodes(updated["bodyJson"])[0]["attrs"]["params"]["day"] == "2026-11-27"   # skips Thanksgiving
