"""F-NOTE-1 (ruling W11-R42): a keyed Use writes its note and its key in ONE short locked transaction, through
`notes.create_note(commit=False)`, with no temporary trigger; any exception (a BaseException too) leaves nothing
behind and no transaction open on a caller's connection; and `get_item` with wave 11 off answers exactly what it
answered before Task 11.8.

The reviewer's r5 reproductions (`r118e_trigger.py`) are ported here asserting the fix: m-1 (another insert in the
window cannot take the key) and m-2 (a BaseException on the second path leaves a caller's connection locked)."""
from __future__ import annotations

import json
import threading
import time
import pathlib
import re
import sqlite3
import subprocess
import sys
import types
import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import journal_styles as js
from api.services.journal_two import notes as notes_service
from api.services.journal_two import template_gallery as gallery
from tests._gallery_w11_helpers import (  # noqa: F401 -- db is a fixture
    AUTHOR, MEMBER, OTHER, approve, built, db, heading, list_template, list_tool, para, routine, style, waves, widget,
    ALL_WAVES,
)

TOOL_CHOICES = {"routine_a": {"create": True}}


class Boom(BaseException):
    """A BaseException that is not KeyboardInterrupt (pytest treats that one specially)."""


def _plain_template(db):
    """No tool slot: create_styled_note's SECOND path."""
    s = style(db, blocks=[], outline={"type": "doc", "content": [heading("Plan"), para("stays")]})
    return list_template(db, s["id"])


def _tools_template(db):
    """A built-in `template` routine slot: a fresh copy ASKS, so its first note takes the FIRST (tools) path."""
    w = widget(db)
    slot = {"block": "routine_a", "enabled": True,
            "settings": {"template": "premarket_routine", "bind": "note-day", "display": "items"}}
    return list_template(db, style(db, blocks=[built("a", w["id"]), slot])["id"], title="Tools")


def _use(db, gid, k, conn, tools):
    kw = {"answers": {"p1": "Flag"}, "choices": TOOL_CHOICES} if tools else {}
    return gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=conn, **kw)


def _warm(db, gid, tools):
    """A first Use without a key adopts the copy (NOT for the tools template: its warmed copy would take path 2)."""
    if not tools:
        _use(db, gid, None, db, tools)


def _notes(db):
    """(all, trashed) notes of the member: the trash counts."""
    r = db.execute("SELECT COUNT(*), SUM(deleted_at IS NOT NULL) FROM j2_notes WHERE user_id = ?",
                   (MEMBER,)).fetchone()
    return int(r[0] or 0), int(r[1] or 0)


def _key(db, k):
    return db.execute("SELECT new_id, token FROM j2_tool_create_keys WHERE user_id = ? AND key = ?",
                      (MEMBER, k)).fetchone()


def _temp_objects(c) -> list:
    return [r[0] for r in c.execute("SELECT name FROM sqlite_temp_master")]


def _can_write(path) -> bool:
    c = sqlite3.connect(path, timeout=0.2)
    try:
        c.execute("BEGIN IMMEDIATE")
        c.rollback()
        return True
    except sqlite3.OperationalError:
        return False
    finally:
        c.close()


@pytest.fixture
def path_seen(monkeypatch):
    """Which of create_styled_note's paths ran: only the tools path fills its tool markers."""
    seen = []
    real = js._finish_tools

    def finish(*a, **kw):
        seen.append(1)
        return real(*a, **kw)
    monkeypatch.setattr(js, "_finish_tools", finish)
    return seen


# ── notes.create_note(commit=False): the keyword ────────────────────────────────────────────────────────────────────

def test_create_note_commit_false_leaves_the_insert_to_the_caller(db, monkeypatch):
    events = []
    monkeypatch.setattr(notes_service, "_log_notebook_event", lambda uid, ev, details=None: events.append(ev))
    other = auth_db.get_connection()
    try:
        note = notes_service.create_note(MEMBER, {"title": "mine", "tags": ["thesis"]}, db, commit=False)
        assert db.in_transaction                                    # the caller's transaction, still open
        assert db.execute("SELECT 1 FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()        # its own write
        assert other.execute("SELECT 1 FROM j2_notes WHERE id = ?", (note["id"],)).fetchone() is None
        assert events == []                                         # no created event before a commit
        db.rollback()
        assert db.execute("SELECT 1 FROM j2_notes WHERE id = ?", (note["id"],)).fetchone() is None
        # the default is unchanged: it commits and logs both events
        n2 = notes_service.create_note(MEMBER, {"title": "mine", "tags": ["thesis"]}, db)
        assert not db.in_transaction
        assert other.execute("SELECT 1 FROM j2_notes WHERE id = ?", (n2["id"],)).fetchone()
        assert events == ["notebook_note_created", "notebook_thesis_note_created"]
    finally:
        other.close()


def test_create_note_commit_false_needs_the_callers_connection():
    with pytest.raises(ValueError):
        notes_service.create_note(MEMBER, {"title": "x"}, None, commit=False)


def test_a_guarded_styled_create_refuses_an_open_transaction(db):
    s = style(db, uid=MEMBER, blocks=[])
    db.execute("UPDATE users SET display_name = display_name WHERE id = ?", (MEMBER,))     # an open transaction
    assert db.in_transaction
    n0 = _notes(db)
    with pytest.raises(ValueError):
        js.create_styled_note(MEMBER, {"styleId": s["id"]}, db, after_insert=lambda c, n: None)
    db.rollback()
    assert _notes(db) == n0


@pytest.mark.parametrize("tools", [False, True], ids=["path2", "path1"])
def test_a_guarded_create_commits_the_note_and_the_hooks_writes_once(db, monkeypatch, tools, path_seen):
    """Both paths: the guard and the after-insert hook run in ONE transaction the create began, the hook sees the
    note's own id before any commit, another connection sees neither until the one commit, and the created event is
    logged after it."""
    if tools:
        sid = gallery.adopt_style(MEMBER, _tools_template(db), answers={"p1": "Flag"}, conn=db)["style"]["id"]
        choices = TOOL_CHOICES
    else:
        sid, choices = style(db, uid=MEMBER, blocks=[])["id"], {}
    events, seen = [], {}
    monkeypatch.setattr(notes_service, "_log_notebook_event", lambda uid, ev, details=None: events.append(ev))
    other = auth_db.get_connection()
    try:
        def guard(c):
            seen["guard_tx"] = c.in_transaction

        def after(c, note):
            seen["id"] = note["id"]
            seen["tx"] = c.in_transaction
            seen["other_sees"] = other.execute("SELECT 1 FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()
            seen["events"] = list(events)
        note, _ = js.create_styled_note(MEMBER, {"styleId": sid, "choices": choices}, db, before_insert=guard,
                                        after_insert=after)
        assert bool(path_seen) == tools
        assert seen == {"guard_tx": True, "id": note["id"], "tx": True, "other_sees": None, "events": []}
        assert not db.in_transaction
        assert other.execute("SELECT 1 FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()
        assert events == ["notebook_note_created"]
    finally:
        other.close()


def _guarded_style(db, tools):
    """A style for a direct guarded create: (style id, choices). The tools one takes the FIRST path."""
    if tools:
        return gallery.adopt_style(MEMBER, _tools_template(db), answers={"p1": "Flag"}, conn=db)["style"]["id"], \
            TOOL_CHOICES
    return style(db, uid=MEMBER, blocks=[])["id"], {}


@pytest.mark.parametrize("tools", [False, True], ids=["path2", "path1"])
@pytest.mark.parametrize("exc", [RuntimeError("hook failed"), Boom()], ids=["Exception", "BaseException"])
@pytest.mark.parametrize("hook", ["before_insert", "after_insert"])
def test_a_guarded_create_rolls_back_its_own_transaction_on_any_exception(db, tools, exc, hook, path_seen):
    """r5 m-2 at create_styled_note itself (not only through a Use, whose own handler would hide it): a hook raising
    any exception, a BaseException included, on a CALLER-SUPPLIED connection, on either path, leaves no note, no
    transaction open and the database writable by others."""
    sid, choices = _guarded_style(db, tools)
    n0 = _notes(db)
    c = auth_db.get_connection()
    kw = {"before_insert": _raiser(exc)} if hook == "before_insert" else {"after_insert": _raiser(exc)}
    try:
        with pytest.raises(type(exc)):
            js.create_styled_note(MEMBER, {"styleId": sid, "choices": choices}, c, **kw)
        assert bool(path_seen) == tools, "wrong create_styled_note path"
        res = {"in_tx": c.in_transaction, "notes": _notes(db), "others_can_write": _can_write(auth_db._DB_PATH)}
    finally:
        if c.in_transaction:
            c.rollback()
        c.close()
    assert res == {"in_tx": False, "notes": n0, "others_can_write": True}


@pytest.mark.parametrize("guarded", [True, False], ids=["guarded", "unguarded"])
@pytest.mark.parametrize("exc", [RuntimeError("read failed"), Boom()], ids=["Exception", "BaseException"])
def test_path1_never_holds_the_lock_outside_the_try_that_rolls_back(db, monkeypatch, exc, guarded, path_seen):
    """F-NOTE-1 review m-1, ported (`rfn1_conc.py`): on path 1 the style is re-read UNDER the create's lock. That read
    raising (any exception) on a caller-supplied connection leaves no transaction open and others able to write."""
    sid, choices = _guarded_style(db, True)
    real, raised = js.get_style, []

    def get_style(*a, **kw):
        c = a[2] if len(a) > 2 else kw.get("conn")
        if c is not None and c.in_transaction and not raised:
            raised.append(1)
            raise exc
        return real(*a, **kw)
    monkeypatch.setattr(js, "get_style", get_style)
    c = auth_db.get_connection()
    kw = {"before_insert": lambda conn: None} if guarded else {}
    try:
        with pytest.raises(type(exc)):
            js.create_styled_note(MEMBER, {"styleId": sid, "choices": choices}, c, **kw)
        res = {"raised": bool(raised), "in_tx": c.in_transaction, "others_can_write": _can_write(auth_db._DB_PATH)}
    finally:
        if c.in_transaction:
            c.rollback()
        c.close()
    assert res == {"raised": True, "in_tx": False, "others_can_write": True}


@pytest.mark.parametrize("tools", [False, True], ids=["path2", "path1"])
def test_a_guarded_create_composes_with_no_lock_held(db, monkeypatch, tools, path_seen):
    """W11-R31: the guarded create's locked transaction starts only AFTER the slow compose. While compose runs, the
    caller's connection holds no transaction and another connection can take the write lock; the hooks run under it.
    """
    sid, choices = _guarded_style(db, tools)
    real = js.compose
    during, under = [], []

    def compose(*a, **kw):
        during.append((kw["conn"].in_transaction, _can_write(auth_db._DB_PATH)))
        return real(*a, **kw)
    monkeypatch.setattr(js, "compose", compose)
    c = auth_db.get_connection()
    try:
        js.create_styled_note(MEMBER, {"styleId": sid, "choices": choices}, c,
                              before_insert=lambda conn: under.append((conn.in_transaction,
                                                                       _can_write(auth_db._DB_PATH))))
    finally:
        c.close()
    assert bool(path_seen) == tools
    assert during and all(d == (False, True) for d in during), during
    assert under == [(True, False)]                     # the hook runs inside the lock: others cannot write


def test_the_key_record_never_writes_another_requests_reservation(db):
    """The after-insert backstop: a reservation that is not this request's (another token, or a recorded note) is never
    written, and the create is refused (`_UseKeyLost`, so it rolls back)."""
    k = str(uuid.uuid4())
    gallery._key_remember(db, MEMBER, k, "gallery_use_template", "g", "", token="theirs")
    db.commit()
    with pytest.raises(gallery._UseKeyLost):
        gallery._use_key_record(MEMBER, k, "mine")(db, {"id": "n-mine"})
    db.rollback()
    assert tuple(_key(db, k)) == ("", "theirs")
    db.execute("UPDATE j2_tool_create_keys SET new_id = 'n-theirs' WHERE user_id = ? AND key = ?", (MEMBER, k))
    db.commit()
    with pytest.raises(gallery._UseKeyLost):
        gallery._use_key_record(MEMBER, k, "theirs")(db, {"id": "n-mine"})
    db.rollback()
    assert tuple(_key(db, k)) == ("n-theirs", "theirs")


# ── m-1: no other insert on the connection can take the key ────────────────────────────────────────────────────────

@pytest.mark.parametrize("nested", ["raw_insert", "nested_create_note"])
def test_another_insert_in_the_window_never_takes_the_key(db, monkeypatch, nested):
    """r5 m-1, ported asserting the fix: one more note for the same member is inserted on the same connection between
    the key check and the Use's own INSERT (a raw INSERT, or a nested `create_note` that commits). The key still names
    the Use's OWN note -- written with the id `create_note` returned -- and a replay answers it."""
    gid = _plain_template(db)
    _warm(db, gid, False)
    real_guard = gallery._use_key_guard
    other = {}

    def guard_then_other(user_id, key, token, gallery_id):
        g = real_guard(user_id, key, token, gallery_id)

        def run(conn):
            g(conn)
            if nested == "raw_insert":
                other["id"] = uuid.uuid4().hex
                conn.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at,"
                             " updated_at) VALUES (?, ?, 'unrelated', '{}', '', '[]', datetime('now'),"
                             " datetime('now'))", (other["id"], user_id))
            else:
                other["id"] = notes_service.create_note(user_id, {"title": "unrelated"}, conn)["id"]
        return run
    monkeypatch.setattr(gallery, "_use_key_guard", guard_then_other)
    k = str(uuid.uuid4())
    u = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=db)
    monkeypatch.setattr(gallery, "_use_key_guard", real_guard)
    assert other["id"] != u["note"]["id"]
    assert _key(db, k)[0] == u["note"]["id"]
    replay = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=db)
    assert replay["replayed"] and replay["note"]["id"] == u["note"]["id"]


# ── m-2: any exception, a BaseException too, on either path ────────────────────────────────────────────────────────

def _raiser(exc):
    def boom(*a, **kw):
        raise exc
    return boom


@pytest.mark.parametrize("tools", [False, True], ids=["path2", "path1"])
@pytest.mark.parametrize("exc", [RuntimeError("sidecar failed"), Boom()], ids=["Exception", "BaseException"])
@pytest.mark.parametrize("where", ["mid_insert", "after_insert"])
def test_an_exception_in_the_window_leaves_nothing_and_no_open_transaction(db, monkeypatch, tools, exc, where,
                                                                           path_seen):
    """r5 m-2, ported asserting the fix, on a CALLER-SUPPLIED connection: an exception after the uncommitted INSERT
    (in `create_note`'s sidecars) or in the key write (`after_insert`) rolls the whole transaction back on both paths.
    No note, the request's own reservation forgotten, no transaction open, no temp object, others can write."""
    gid = _tools_template(db) if tools else _plain_template(db)
    _warm(db, gid, tools)
    n0 = _notes(db)
    if where == "mid_insert":
        monkeypatch.setattr(notes_service, "_sync_note_sidecars", _raiser(exc))
    else:
        monkeypatch.setattr(gallery, "_use_key_record", lambda *a: _raiser(exc))
    c = auth_db.get_connection()
    k = str(uuid.uuid4())
    try:
        with pytest.raises(type(exc)):
            _use(db, gid, k, c, tools)
        assert bool(path_seen) == tools, "wrong create_styled_note path"
        res = {"in_tx": c.in_transaction, "temp": _temp_objects(c), "notes": _notes(db), "key": _key(db, k),
               "others_can_write": _can_write(auth_db._DB_PATH)}
    finally:
        if c.in_transaction:
            c.rollback()
        c.close()
    assert res == {"in_tx": False, "temp": [], "notes": n0, "key": None, "others_can_write": True}


@pytest.mark.parametrize("tools", [False, True], ids=["path2", "path1"])
def test_a_base_exception_after_the_commit_leaves_the_key_naming_the_note(db, monkeypatch, tools, path_seen):
    """A BaseException after the one commit (in the created event): the note and its key are already committed
    together, the connection holds no transaction and no temp object, and a replay answers that note."""
    gid = _tools_template(db) if tools else _plain_template(db)
    _warm(db, gid, tools)
    n0 = _notes(db)[0]
    real_log = notes_service._log_notebook_event
    monkeypatch.setattr(notes_service, "_log_notebook_event", _raiser(Boom()))
    c = auth_db.get_connection()
    k = str(uuid.uuid4())
    try:
        with pytest.raises(Boom):
            _use(db, gid, k, c, tools)
        assert bool(path_seen) == tools
        assert not c.in_transaction and _temp_objects(c) == []
    finally:
        c.close()
    monkeypatch.setattr(notes_service, "_log_notebook_event", real_log)
    assert _notes(db)[0] == n0 + 1
    made = _key(db, k)[0]
    assert made and notes_service.get_note(MEMBER, made, db) is not None
    replay = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=db)
    assert replay["replayed"] and replay["note"]["id"] == made


# ── no temporary schema object, ever ───────────────────────────────────────────────────────────────────────────────

_TEMP_ACTIONS = {getattr(sqlite3, n) for n in dir(sqlite3) if n.startswith("SQLITE_CREATE_TEMP_")}


def _record_temp_writes(c, seen):
    def auth(action, *args):
        seen["calls"] += 1
        if action in _TEMP_ACTIONS or (len(args) > 2 and args[2] == "temp"):
            seen["temp"].append((action, args))
        return sqlite3.SQLITE_OK
    c.set_authorizer(auth)


@pytest.mark.parametrize("tools", [False, True], ids=["path2", "path1"])
def test_a_keyed_use_never_creates_a_temp_object(db, tools, path_seen):
    """The rail that replaces fix5's vacuous "no trigger outlives a request" check: SQLite's authorizer on the
    request's OWN connection records every statement a keyed Use prepares, and none of them creates (or writes) a
    temp schema object. Controls: the authorizer saw the Use's statements, and it does record a temp trigger."""
    gid = _tools_template(db) if tools else _plain_template(db)
    _warm(db, gid, tools)
    c = auth_db.get_connection()
    seen = {"calls": 0, "temp": []}
    try:
        _record_temp_writes(c, seen)
        u = _use(db, gid, str(uuid.uuid4()), c, tools)
        assert bool(path_seen) == tools
        use_calls, use_temp = seen["calls"], list(seen["temp"])
        c.execute("CREATE TEMP TRIGGER control_t AFTER INSERT ON main.j2_notes BEGIN SELECT 1; END")   # control
        control = list(seen["temp"])
        c.execute("DROP TRIGGER temp.control_t")
        c.set_authorizer(None)
    finally:
        c.close()
    assert u["note"]["id"] and use_calls > 50
    assert use_temp == []
    assert control, "the authorizer must see a temp trigger"


# ── wave 11 off: get_item exactly as before Task 11.8 ──────────────────────────────────────────────────────────────

PRE_11_8 = "042cb8ce0a"          # e214651c65^: the tree just before Task 11.8's first commit


def _pre_11_8_module():
    """The pre-Task-11.8 `template_gallery`, loaded from git beside the live one (its own module object)."""
    root = pathlib.Path(__file__).resolve().parents[1]
    src = subprocess.run(["git", "-C", str(root), "cat-file", "blob",
                          f"{PRE_11_8}:api/services/journal_two/template_gallery.py"],
                         capture_output=True, check=True).stdout.decode("utf-8")
    assert "def get_item(" in src and "SHARED_TEMPLATE_FORMAT" not in src      # non-vacuity: the OLD file
    mod = types.ModuleType("api.services.journal_two._template_gallery_pre_11_8")
    mod.__file__ = str(root / "api/services/journal_two/template_gallery.py")
    mod.__package__ = "api.services.journal_two"
    sys.modules[mod.__name__] = mod
    try:
        exec(compile(src, mod.__file__, "exec"), mod.__dict__)
    finally:
        sys.modules.pop(mod.__name__, None)
    return mod


def _hand_edit(db, gid, *, payload=None, preview=None, pending=None, group=None):
    sets, args = [], []
    for col, v in (("payload_json", payload), ("preview_json", preview), ("pending_json", pending),
                   ("template_group", group)):
        if v is not None:
            sets.append(f"{col} = ?")
            args.append(json.dumps(v) if not isinstance(v, str) else v)
    db.execute(f"UPDATE j2_template_gallery SET {', '.join(sets)} WHERE id = ?", (*args, gid))
    db.commit()


def test_get_item_with_wave_11_off_is_byte_identical_to_before_task_11_8(db, monkeypatch):
    """Ruling W11-R42: rows of every kind -- a P3a-shaped listing holding an autolinked address, a slot placeholder in
    its body and its preview, a group and a held revision; a reducer (shared-format) listing; a listed tool with a
    held revision -- read by a member and by an admin. With wave 11 off, the live `get_item` and the pre-11.8 one
    answer the same bytes. Control: with wave 11 ON they differ (the comparison can tell them apart)."""
    old = _pre_11_8_module()
    url = "https://broker.example.com/acct/99887766"
    p3a = {"kindId": "weekend_prep", "blocks": [], "properties": {},
           "outlineBodyJson": {"type": "doc", "content": [
               heading("Plan"), para("{{block:routine_a}}"),
               {"type": "paragraph", "content": [{"type": "text", "text": url,
                                                  "marks": [{"type": "link", "attrs": {"href": url}}]}]}]}}
    revision = {"title": "v2", "description": "", "category": "journal", "payload": p3a}
    g_p3a = _plain_template(db)
    _hand_edit(db, g_p3a, payload=p3a, preview=[{"type": "paragraph", "text": "{{block:routine_a}}"},
                                                {"type": "paragraph", "text": "stays"}],
               pending=revision, group="morning")
    g_shared = _tools_template(db)
    g_tool = list_tool(db, "routine", routine(db)["id"], edits={"items": ["Coffee", "Mark levels"]})
    tool_payload = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                         (g_tool,)).fetchone()[0])
    _hand_edit(db, g_tool, pending={"title": "v2", "description": "", "category": "journal",
                                    "payload": {**tool_payload, "extra": url}})

    def reads(mod):
        return {(gid, who): json.dumps(mod.get_item(who, gid, is_admin=who == "admin", conn=db), sort_keys=False,
                                       default=str)
                for gid in (g_p3a, g_shared, g_tool) for who in (MEMBER, "admin")}
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    live_off, old_off = reads(gallery), reads(old)
    for k in live_off:
        assert live_off[k] == old_off[k], k
    assert "99887766" in live_off[(g_p3a, MEMBER)]                    # wave off: the stored outline, as before
    waves(monkeypatch, *ALL_WAVES)
    live_on = reads(gallery)
    assert live_on[(g_p3a, MEMBER)] != old_off[(g_p3a, MEMBER)]      # control: wave on, the reducer pass applies
    assert "99887766" not in live_on[(g_p3a, MEMBER)]


# ── W11-R47: ONE skeleton comparison closes every address form, on every share path ───────────────────────────────

ACCT, HOST = "99887766", "broker.example.com"
URL = f"https://{HOST}/acct/{ACCT}"
BOLD = {"type": "bold"}


def _lk(text, href=URL, *more):
    return {"type": "text", "text": text, "marks": [{"type": "link", "attrs": {"href": href}}, *more]}


#: Every leaking form found so far, each of which carried the account number into a share: the r5 review's
#: (`r118e_address.py`), W11-R45's split autolink piece, and F-NOTE-1's review (`rfn1_paths.py`, `rfn1_forms.py`: a
#: line-break character INSIDE one text node, a visible blank, a combining mark, U+2065). Written as escapes.
ADDRESS_FORMS = {
    "LRM in the host": [_lk(f"broker‎.example.com/acct/{ACCT}")],
    "RLM in the host": [_lk(f"broker‏.example.com/acct/{ACCT}")],
    "RLO in the host": [_lk(f"broker‮.example.com/acct/{ACCT}")],
    "LRI/PDI wrapping": [_lk(f"⁦{HOST}/acct/{ACCT}⁩")],
    "invisible times in the host": [_lk(f"broker⁢.example.com/acct/{ACCT}")],
    "combining grapheme joiner in the host": [_lk(f"broker͏.example.com/acct/{ACCT}")],
    "unassigned U+2065 in the host": [_lk(f"broker⁥.example.com/acct/{ACCT}")],
    "a hardBreak inside the link": [_lk(f"https://{HOST}/acct/"), {"type": "hardBreak"}, _lk(ACCT)],
    "two hardBreaks inside the link": [_lk(f"https://{HOST}/acct/"), {"type": "hardBreak"}, {"type": "hardBreak"},
                                       _lk(ACCT)],
    "hrefs differ only by a trailing slash": [_lk(f"https://{HOST}/acct/"), _lk(ACCT, URL + "/", BOLD)],
    "hrefs differ only by case": [_lk(f"https://{HOST}/acct/"), _lk(ACCT, URL.upper(), BOLD)],
    "hrefs differ only by scheme": [_lk(f"https://{HOST}/acct/"), _lk(ACCT, URL.replace("https:", "http:"), BOLD)],
    "R45: a split piece in its own longer href": [_lk(f"https://{HOST}/acct/", f"https://{HOST}/acct/"),
                                                  _lk(ACCT, f"https://{HOST}/acct/{ACCT}/", BOLD)],
    "LF inside one text node": [_lk(f"https://{HOST}/acct/\n{ACCT}")],
    "CRLF inside one text node": [_lk(f"https://{HOST}/acct/\r\n{ACCT}")],
    "U+2028 inside one text node": [_lk(f"https://{HOST}/acct/ {ACCT}")],
    "U+2029 inside one text node": [_lk(f"https://{HOST}/acct/ {ACCT}")],
    "TAB inside one text node": [_lk(f"https://{HOST}/acct/\t{ACCT}")],
    "ideographic space inside": [_lk(f"https://{HOST}/acct/　{ACCT}")],
    "LF inside the bare host form": [_lk(f"{HOST}/acct/\n{ACCT}")],
    "LF inside the host": [_lk(f"broker.example\n.com/acct/{ACCT}")],
    "braille blank in the host": [_lk(f"broker⠀.example.com/acct/{ACCT}")],
    "combining low line in the host": [_lk(f"broker̲.example.com/acct/{ACCT}")],
    "number only, linked": [_lk(ACCT)],
    "fullwidth letters in the host": [_lk("\uff42\uff52\uff4f\uff4b\uff45\uff52.example.com/acct/" + ACCT)],
    "a stray accented letter in the host": [_lk(f"broker\u00e9.example.com/acct/{ACCT}")],
    "a piece its own href lacks, beside one that holds it": [_lk(f"https://{HOST}/acct/", f"https://{HOST}/acct/"),
                                                             _lk(ACCT, f"https://{HOST}/acct/", BOLD),
                                                             _lk(".", URL)],
    "a whitespace text node between the parts": [_lk(f"https://{HOST}/acct/"), {"type": "text", "text": " \n "},
                                                  _lk(ACCT)],
    "a fullwidth letter inside the host": [_lk(f"broｋer.example.com/acct/{ACCT}")],
    "the holder before a break, the lacking piece after it": [_lk(f"https://{HOST}/acct/", URL),
                                                              {"type": "hardBreak"},
                                                              _lk(ACCT, f"https://{HOST}/acct/", BOLD)],
    # W11-R48 (a): text that is itself an address, whatever its href
    "R48: URL text linked to a different address": [_lk(URL, "https://elsewhere.example.org/")],
    "R48: URL text with no href": [{"type": "text", "text": URL, "marks": [{"type": "link"}]}],
    "R48: a bare host linked elsewhere": [_lk(f"{HOST}/acct/{ACCT}", "https://elsewhere.example.org/")],
    "R48: the split bold head (text longer than its href)": [_lk(HOST, f"https://{HOST}/", BOLD),
                                                            _lk(f"/acct/{ACCT}", f"https://{HOST}/")],
    "R48: punycode text for another host": [_lk(f"xn--brker-jua.example.com/acct/{ACCT}",
                                               f"https://br\u00f6ker.example.com/acct/{ACCT}")],
    "R48: words around a URL": [_lk(f"see my statement {URL} here", URL)],
    # W11-R48 (b): the text holds its href's host (no dots, so not (a); not inside the href, so not R47)
    "R48: the host written inside words": [_lk(f"my broker example com statement {ACCT}", f"https://{HOST}/x")],
    "R53: a split piece linked elsewhere, beside the part that holds it": [
        _lk(f"https://{HOST}/acct/"), _lk(ACCT, "https://elsewhere.example.org/")],
    "R48: a scheme URL with an undotted host, no href": [
        {"type": "text", "text": f"https://intranet/acct/{ACCT}", "marks": [{"type": "link"}]}],
}


def _leaks(blob) -> list:
    s = blob if isinstance(blob, str) else json.dumps(blob, default=str, ensure_ascii=False)
    return [x for x in (ACCT, HOST, "broker") if x in s]


def _every_share_path(db, content, slot):
    """Share one outline paragraph through EVERY path and return what each answer or row holds: the share preview,
    the listing's `payload_json` / `body_json` / `preview_json`, `list_gallery`, `get_item`, the adopt answer and the
    adopter's copy, and a Use note's `body_json || body_plain`."""
    w = widget(db)
    head = [heading("Plan")] + ([para("{{block:built_a}}")] if slot else []) + [para("stays")]
    outline = {"type": "doc", "content": head + [{"type": "paragraph", "content": content}]}
    s = style(db, blocks=[built("a", w["id"])] if slot else [], outline=outline)
    got = {"share_preview": gallery.share_preview(AUTHOR, "template", s["id"], conn=db)}
    gid = gallery.publish_style(AUTHOR, s["id"], title="T", description="", category="journal", trading_style=None,
                                conn=db)["id"]
    row = db.execute("SELECT payload_json, body_json, preview_json FROM j2_template_gallery WHERE id = ?",
                     (gid,)).fetchone()
    got.update(payload_json=row[0] or "", body_json=row[1] or "", preview_json=row[2] or "")
    approve(db, gid)
    got["list_gallery"] = gallery.list_gallery(MEMBER, conn=db)
    got["get_item"] = gallery.get_item(MEMBER, gid, conn=db)
    ad = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, key=str(uuid.uuid4()), conn=db)
    got["adopt"] = ad
    got["copy"] = js.get_style(MEMBER, ad["style"]["id"], db, full=True)
    u = gallery.use_library_template(OTHER, gid, payload={}, key=str(uuid.uuid4()), conn=db,
                                     answers={"p1": "Flag"} if slot else None)
    got["use_note"] = db.execute("SELECT body_json || body_plain FROM j2_notes WHERE id = ?",
                                 (u["note"]["id"],)).fetchone()[0]
    return s, got


@pytest.mark.parametrize("slot", [True, False], ids=["slot", "noslot"])
@pytest.mark.parametrize("name", list(ADDRESS_FORMS))
def test_no_address_form_reaches_any_share_path(db, name, slot):
    """W11-R47 (closing r5 m-3, R45 and the F-NOTE-1 review's I-1 and m-2): each form, on a slot template and a
    no-slot one. Neither the account number nor the broker's host reaches any share path; the words beside it
    travel. Control: the author's own style still holds the account number (the share removed it)."""
    s, got = _every_share_path(db, ADDRESS_FORMS[name] + [{"type": "text", "text": " my statement"}], slot)
    assert ACCT in json.dumps(js.get_style(AUTHOR, s["id"], db, full=True)["outlineBodyJson"])
    bad = {k: _leaks(v) for k, v in got.items() if _leaks(v)}
    assert not bad, (name, ascii(bad))
    assert "my statement" in got["payload_json"] and "my statement" in json.dumps(got["copy"])


@pytest.mark.parametrize("slot", [True, False], ids=["slot", "noslot"])
@pytest.mark.parametrize("words,href,host", [("my notes", "https://x.example/a", "x.example"),
                                             ("Fix it", "https://x.io/fix", "x.io"),
                                             ("Maxio stats", "https://x.io/", "x.io")],
                         ids=["my notes", "short host", "short host inside a word"])
def test_a_link_whose_text_is_not_in_its_address_travels_as_text(db, slot, words, href, host):
    """The controls W11-R47 and W11-R48 name: "my notes" linked to https://x.example/a is not its address, and
    "Fix it" and "Maxio stats" linked to x.io are words: "maxiostats" even holds the host's skeleton "xio", which is
    under `HOST_SKELETON_MIN`, so it is not judged an address.
    Both reach every path as words (only the href goes)."""
    _s, got = _every_share_path(db, [_lk(words, href)], slot)
    for where in ("payload_json", "body_json", "get_item", "adopt", "copy", "use_note"):
        blob = got[where] if isinstance(got[where], str) else json.dumps(got[where], default=str)
        assert words in blob and host not in blob, where


def test_a_line_break_between_two_different_links_does_not_join_them(db):
    """A plain-word link beside an address link keeps its words: the joined run is not an address, so each linked
    node is judged alone."""
    out = json.dumps(gallery._shared_outline({"type": "doc", "content": [{"type": "paragraph", "content": [
        _lk("my broker", "https://elsewhere.example.org/"), {"type": "hardBreak"},
        _lk(f"https://{HOST}/acct/")]}]}, AUTHOR))
    assert "my broker" in out and HOST not in out


def test_the_skeleton_is_nfkc_casefold_letters_and_digits():
    """W11-R47's skeleton, exactly: NFKC, casefold, then only `[a-z0-9]` (the ruling's) or only alphanumerics (every
    script). A fullwidth letter folds, capitals fold, and every space, line break, mark, blank and punctuation goes."""
    s = "ＡB\n c d̲e⠀f.-_g9é　h\t​i"
    assert gallery._skeleton(s, latin=True) == "abcdefg9hi"
    assert gallery._skeleton(s, latin=False) == "abcdefg9éhi"


def test_a_run_whose_linked_parts_all_go_takes_its_blank_joiners_with_it(db):
    """A blank text node between two linked parts of one address is part of that link: it goes with them, and the
    words after it stay exactly as written."""
    out = gallery._shared_outline({"type": "doc", "content": [{"type": "paragraph", "content": [
        _lk(f"https://{HOST}/acct/"), {"type": "text", "text": " \n "}, _lk(ACCT),
        {"type": "text", "text": " my statement"}]}]}, AUTHOR)
    assert out["content"][0]["content"] == [{"type": "text", "text": " my statement"}]


def test_the_skeleton_is_the_one_authority(db):
    """W11-R47: the hand lists it replaced are gone, and the one comparison reads both skeletons and every spelling
    of the href (Unicode and punycode host, `www.`, percent-encoding)."""
    for gone in ("_text_is_its_address", "_normal_text", "_bare_address", "_URLISH", "_PHONE", "_DOTS",
                 "_WRAP_OPEN", "_IGNORABLE_NOT_CF", "_strip_invisible"):
        assert not hasattr(gallery, gone), gone
    yes = (("bücher.de/x", ["https://xn--bcher-kva.de/x"]), ("xn--bcher-kva.de", ["https://bücher.de"]),
           ("пример.рф", ["https://xn--e1afmkfd.xn--p1ai/a"]),
           ("www.example.com", ["https://example.com"]), ("bücher", ["https://x.com/b%C3%BCcher"]),
           ("+1 (555) 987-6543", ["tel:+15559876543"]), ("me@x.io", ["mailto:me@x.io"]),
           ("BROKER.EXAMPLE.COM", [URL]), ("my broker example com notes", ["https://www.broker.example.com/x"]))
    for text, hrefs in yes:
        assert gallery._link_text_is_an_address(text, hrefs), ascii(text)
    for text, hrefs in (("my notes", ["https://x.example/a"]), ("anything", []), ("⠀​", [URL]),
                        ("Fix it", ["https://x.io/"]), ("e.g.", ["https://example.com"]), ("read this. then go", []),
                        ("Q3 report", ["https://ir.example.com/q3"]),
                        ("документы", ["https://docs.example.com/"])):
        assert not gallery._link_text_is_an_address(text, hrefs), ascii(text)


# ── W11-R46: text that travels carries no Default_Ignorable_Code_Point ─────────────────────────────────────────────

#: Spot members of Unicode 16.0's Default_Ignorable_Code_Point (DerivedCoreProperties.txt), Cn ones included, and
#: neighbours that are NOT members.
DI_MEMBERS = [0x00AD, 0x034F, 0x061C, 0x115F, 0x17B4, 0x180B, 0x180E, 0x180F, 0x200B, 0x200D, 0x200E, 0x202A,
              0x2060, 0x2065, 0x206F, 0x3164, 0xFE00, 0xFE0F, 0xFEFF, 0xFFA0, 0xFFF0, 0xFFF8, 0x1BCA0, 0x1D173,
              0xE0000, 0xE0001, 0xE0041, 0xE01EF, 0xE0FFF]
#: R46 refined (W11-R48 c4): the emoji pieces travel -- ZWJ, the variation selectors and their supplement, and the
#: emoji tag block. Every other member is stripped.
DI_EMOJI = {0x200D, 0xFE00, 0xFE0F, 0xE0100, 0xE01EF}
#: W11-R53 (m-1): a tag character travels only INSIDE a well-formed emoji tag sequence; alone it is stripped.
DI_TAGS = [0xE0020, 0xE0041, 0xE007E, 0xE007F]
DI_STRIPPED = [cp for cp in DI_MEMBERS if cp not in DI_EMOJI] + [0xE001F, 0xE0080, 0xE00FF, 0xE01F0] + DI_TAGS
DI_NOT = [0x0020, 0x00A0, 0x00AC, 0x0600, 0x200A, 0x2028, 0x2070, 0x2800, 0x3000, 0xFFF9, 0xFFFC, 0x1D172, 0xE1000,
          ord("a")]


def test_the_default_ignorable_table_matches_the_published_set():
    for cp in DI_MEMBERS:
        assert gallery._is_default_ignorable(chr(cp)), hex(cp)
    for cp in DI_NOT:
        assert not gallery._is_default_ignorable(chr(cp)), hex(cp)


@pytest.mark.parametrize("cp", DI_STRIPPED, ids=[hex(c) for c in DI_STRIPPED])
def test_text_that_travels_has_every_default_ignorable_removed(db, cp):
    """Prose that travels (no link) arrives without the character; a text node made only of it goes."""
    ch = chr(cp)
    out = gallery._shared_outline({"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": f"keep{ch} these{ch} words"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": ch * 2,
                                                                          "marks": [{"type": "bold"}]}]}]}, AUTHOR)
    blob = json.dumps(out, ensure_ascii=False)
    assert "keep these words" in blob and ch not in blob
    assert out["content"][1]["content"] == [{"type": "text", "text": "a"}]


#: A ZWJ family, a subdivision flag (a tag sequence ending in CANCEL TAG) and a VS16 heart.
EMOJI = ["\U0001F468\u200D\U0001F469\u200D\U0001F467",
         "\U0001F3F4\U000E0067\U000E0062\U000E0073\U000E0063\U000E0074\U000E007F",
         "\u2764\uFE0F"]


@pytest.mark.parametrize("emoji", EMOJI, ids=["zwj family", "tag flag", "vs16 heart"])
def test_an_emoji_travels_byte_identical(db, emoji):
    """R46 refined (W11-R48 c4): text that travels keeps the emoji pieces, so an emoji arrives byte-identical in the
    shared outline (plain, bold and as link words alike), while an LRM, a ZWSP and a word joiner beside it are
    still stripped."""
    out = gallery._shared_outline({"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": f"a{emoji}b \u200eL\u200bZ\u2060W"},
        {"type": "text", "text": emoji, "marks": [{"type": "bold"}]}]}]}, AUTHOR)
    content = out["content"][0]["content"]
    assert content[0]["text"] == f"a{emoji}b LZW"
    assert content[1]["text"] == emoji
    assert json.dumps(out).encode() == json.dumps(out).encode() and emoji.encode("utf-8") in json.dumps(
        out, ensure_ascii=False).encode("utf-8")


def test_address_detection_still_ignores_the_emoji_pieces():
    """The pieces that travel never hide an address: they are not letters or digits, so no skeleton holds them."""
    for ch in ("\u200D", "\uFE0F", "\U000E0041", "\U000E0100"):
        assert gallery._link_text_is_an_address(f"broker{ch}.example.com/acct/{ACCT}", ["https://elsewhere.org/"])
        assert gallery._link_text_is_an_address(f"{ACCT}{ch}", [URL])


def test_the_emoji_pieces_are_kept_and_every_other_ignorable_is_not():
    for cp in DI_EMOJI:
        assert gallery._without_ignorables(chr(cp)) == chr(cp), hex(cp)
    for cp in DI_STRIPPED:
        assert gallery._without_ignorables(chr(cp)) == "", hex(cp)


def test_the_address_form_removes_everything_but_letters_digits_spaces_and_punctuation():
    """W11-R48 (a) reads `_address_form`: NFKC, casefold, then only letters, digits, punctuation and single spaces."""
    assert gallery._address_form("\uff21\n\tb\u0332c\u2800 d\u200b.E  f\u3002G") == "abc d.e f.g"
    assert gallery._link_text_is_an_address("www.123/acct", [])          # `www.` alone is a scheme-like prefix



# ── W11-R53 (m-1): tag characters only inside a well-formed emoji tag sequence ────────────────────────────────────

def _tagged(s: str) -> str:
    """`s` written in invisible TAG characters (U+E0000 + each ASCII code): an "ASCII-smuggled" copy."""
    return "".join(chr(0xE0000 + ord(c)) for c in s)


@pytest.mark.parametrize("slot", [True, False], ids=["slot", "noslot"])
@pytest.mark.parametrize("linked", [True, False], ids=["link", "prose"])
def test_an_invisible_tag_copy_of_an_address_never_travels(db, slot, linked):
    """The re-review's m-1 repro: "statement" followed by the address written in tag characters, as link text and as
    plain prose. No tag character -- so no decodable copy of the account number or the host -- reaches any path,
    and the word travels. A real subdivision flag beside it still travels byte-identical."""
    flag = EMOJI[1]
    text = "statement" + _tagged(URL) + " " + flag
    node = _lk(text, "https://x.example/a") if linked else {"type": "text", "text": text}
    _s, got = _every_share_path(db, [node], slot)
    for where, v in got.items():
        blob = _decoded(v)
        assert not any(0xE0000 <= ord(c) <= 0xE007F for c in blob.replace(flag, "")), where
    for where in ("payload_json", "body_json", "copy", "use_note"):
        blob = _decoded(got[where])
        assert "statement" in blob and flag in blob, where


def _decoded(v) -> str:
    """Any answer or stored column as its text with every JSON escape decoded (a stored `\\uXXXX` is a character)."""
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return v
    if isinstance(v, str):
        return v
    return json.dumps(v, default=str, ensure_ascii=False)


def test_a_tag_sequence_travels_only_when_well_formed():
    flag = EMOJI[1]
    assert gallery._without_ignorables(flag) == flag
    assert gallery._without_ignorables("a" + flag[1:]) == "a"                 # no U+1F3F4 base: stripped
    assert gallery._without_ignorables(flag[:-1]) == flag[0]                   # no CANCEL TAG: stripped
    assert gallery._without_ignorables(flag[0] + "\U000E007F") == flag[0]      # no tag between: stripped
    assert gallery._without_ignorables(flag + _tagged("acct") + flag) == flag + flag


# ── W11-R53 (C-1): linear, and never under the write lock ─────────────────────────────────────────────────────────

def _many_links(n: int, sep: str = ", ") -> list:
    out = []
    for i in range(n):
        out += [_lk(f"https://broker{i}.example.com/acct/{i:08d}", f"https://broker{i}.example.com/acct/{i:08d}"),
                {"type": "text", "text": sep}]
    return out


def _timed(content) -> float:
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": content}]}
    t0 = time.perf_counter()
    out = gallery._shared_outline(doc, AUTHOR)
    took = time.perf_counter() - t0
    assert "broker" not in json.dumps(out) and "acct" not in json.dumps(out)
    return took


@pytest.mark.parametrize("sep", [", ", " ", "\n"], ids=["comma", "space", "newline"])
def test_1600_links_reduce_in_under_half_a_second(db, sep):
    """The re-review's C-1: 1,600 links, each its own href, in ONE run (23 s for 800 before W11-R53)."""
    assert _timed(_many_links(1600, sep)) < 0.5


def test_1600_word_links_that_travel_reduce_in_under_half_a_second(db):
    """The judgement that runs for EVERY part is the one for a part that is not an address (nothing short-circuits it):
    1,600 adjacent links of words, each its own href, are judged in linear time and every word travels."""
    content = []
    for i in range(1600):
        content += [_lk(f"my note number {i}", f"https://site{i}.example.com/n/{i}"), {"type": "text", "text": " "}]
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": content}]}
    t0 = time.perf_counter()
    out = json.dumps(gallery._shared_outline(doc, AUTHOR))
    assert time.perf_counter() - t0 < 0.5
    assert "my note number 1599" in out and "site1599" not in out


@pytest.mark.parametrize("shape", ["tiny links, each its own host", "one host, 1 MB"])
def test_the_one_mb_worst_case_reduces_in_under_half_a_second(db, shape):
    """The outline cap's worst case: 1 MB of adjacent links in one run -- tiny ones with a host each (the most hrefs),
    or all of one host (the longest stretch and joined text)."""
    content, i = [], 0
    while len(json.dumps(content)) < 1_000_000:
        for _ in range(500):
            if shape.startswith("tiny"):
                content += [_lk(f"{i}", f"https://a{i}.co/{i}"), {"type": "text", "text": " "}]
            else:
                content.append(_lk(f"https://broker.example.com/acct/{i} ", f"https://broker.example.com/acct/{i}"))
            i += 1
    assert _timed(content) < 0.5, i


def _legacy_listing(db, n_links: int) -> str:
    """A listing whose STORED payload still carries link marks (one approved while wave 11 was off, through P3a's
    reduce): every read cleans it again (`_safe_listed`)."""
    gid = _plain_template(db)
    p = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0])
    p["outlineBodyJson"]["content"].append({"type": "paragraph", "content": _many_links(n_links)})
    db.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(p), gid))
    db.commit()
    return gid


def _lock_is_held() -> bool:
    c = sqlite3.connect(auth_db._DB_PATH, timeout=0)
    try:
        c.execute("BEGIN IMMEDIATE")
        c.rollback()
        return False
    except sqlite3.OperationalError:
        return True
    finally:
        c.close()


@pytest.fixture
def clean_calls(monkeypatch):
    """Every call of the reducer/clean (`_shared_outline`, `_without_links`, `sanitize_body`), recorded with whether
    the auth.db write lock was held at that moment."""
    calls = []
    for name in ("_shared_outline", "_without_links", "sanitize_body"):
        real = getattr(gallery, name)

        def wrapped(*a, _real=real, _name=name, **kw):
            calls.append((_name, _lock_is_held()))
            return _real(*a, **kw)
        monkeypatch.setattr(gallery, name, wrapped)
    return calls


def _path(db, which, gid):
    if which == "keyed adopt":
        return gallery.adopt_style(MEMBER, gid, key=str(uuid.uuid4()), conn=db)
    if which == "first use":
        return gallery.use_library_template(MEMBER, gid, payload={}, key=str(uuid.uuid4()), conn=db)
    raise AssertionError(which)


@pytest.mark.parametrize("which", ["keyed adopt", "first use", "unkeyed first use"])
def test_the_cleaner_never_runs_while_the_lock_is_held(db, clean_calls, which):
    """W11-R53: on the keyed adopt and the first Use, every clean of the listing runs BEFORE the write lock. Non-vacuity:
    the cleaner was called, and the instrument does see a held lock (control)."""
    gid = _legacy_listing(db, 50)
    if which == "unkeyed first use":
        gallery.use_library_template(MEMBER, gid, payload={}, conn=db)
    else:
        _path(db, which, gid)
    assert clean_calls and not any(held for _n, held in clean_calls), clean_calls
    c = auth_db.get_connection()
    try:
        c.execute("BEGIN IMMEDIATE")
        assert _lock_is_held()                                           # control
    finally:
        c.rollback()
        c.close()


def test_the_cleaner_never_runs_while_the_lock_is_held_on_apply_update(db, clean_calls):
    gid = _legacy_listing(db, 50)
    ad = gallery.adopt_style(MEMBER, gid, conn=db)
    p = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0])
    p["outlineBodyJson"]["content"].append(para("v2 words"))
    db.execute("UPDATE j2_template_gallery SET payload_json = ?, version = version + 1 WHERE id = ?",
               (json.dumps(p), gid))
    db.commit()
    mine = js.get_style(MEMBER, ad["style"]["id"], db, full=True)
    clean_calls.clear()
    out = gallery.apply_update(MEMBER, ad["style"]["id"], take_outline=True, base_updated_at=mine["updatedAt"], conn=db)
    assert "v2 words" in json.dumps(out) and "broker" not in json.dumps(out)
    assert clean_calls and not any(held for _n, held in clean_calls), clean_calls


@pytest.mark.parametrize("which", ["keyed adopt", "first use", "apply"])
def test_a_listing_that_moves_under_the_lock_is_cleaned_again_outside_once_then_refused(db, monkeypatch, which):
    """Under the lock only the stored listing is compared with the one cleaned before it. Moved once: the request is
    run again (cleaned outside), and succeeds. Moved every time: it is refused with the existing sentence, and
    nothing is written."""
    gid = _legacy_listing(db, 5)

    def newer_version(word):
        p = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0])
        p["outlineBodyJson"]["content"].append(para(word))
        db.execute("UPDATE j2_template_gallery SET payload_json = ?, version = version + 1 WHERE id = ?",
                   (json.dumps(p), gid))
        db.commit()
    if which == "apply":
        ad = gallery.adopt_style(MEMBER, gid, conn=db)
        newer_version("v2")
    real = gallery._Prepared.__init__
    moves = {"left": 1}

    def init(self, row):
        real(self, row)
        if moves["left"]:
            moves["left"] -= 1
            self.payload_json = (self.payload_json or "") + " "               # what an approval in between does
    monkeypatch.setattr(gallery._Prepared, "__init__", init)

    def run(uid):
        if which == "apply":
            mine = js.get_style(MEMBER, ad["style"]["id"], db, full=True)
            return gallery.apply_update(MEMBER, ad["style"]["id"], take_outline=True,
                                        base_updated_at=mine["updatedAt"], conn=db)
        if which == "keyed adopt":
            return gallery.adopt_style(uid, gid, key=str(uuid.uuid4()), conn=db)
        return gallery.use_library_template(uid, gid, payload={}, key=str(uuid.uuid4()), conn=db)

    def state():
        return (db.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0],
                db.execute("SELECT COUNT(*) FROM j2_journal_styles").fetchone()[0],
                db.execute("SELECT updated_at FROM j2_journal_styles WHERE id = ?",
                           (ad["style"]["id"],)).fetchone()[0] if which == "apply" else None)
    before = state()
    out = run(MEMBER)                                                    # moved once: run again, succeeds
    assert out and state() != before and moves["left"] == 0
    if which == "apply":
        assert "v2" in json.dumps(out)
        newer_version("v3")
    moves["left"] = 10**6                                                # moved every time
    settled = state()
    with pytest.raises(gallery.GalleryConflict) as e:
        run(OTHER)                                                       # OTHER has no copy: its Use adopts
    # W11-R59: an adopt or a first Use whose listing kept moving says the template changed, not "on its way"
    assert str(e.value) == (gallery.UPDATE_MOVED_SENTENCE if which == "apply" else gallery.LISTING_MOVED_SENTENCE)
    assert e.value.code == (None if which == "apply" else gallery.LISTING_MOVED_CODE)        # W11-R60
    assert not db.in_transaction and state() == settled                 # nothing was written


def test_an_auth_write_succeeds_during_a_1600_link_adopt(db):
    """W11-R53 / W11-R31: a sign-in-style write (busy timeout 3 s, as `auth_db` sets) runs to completion every time
    while a keyed adopt of a 1,600-link legacy listing is in flight on another thread."""
    gid = _legacy_listing(db, 1600)
    done, errors, waits = threading.Event(), [], []

    def adopt():
        c = auth_db.get_connection()
        try:
            gallery.adopt_style(MEMBER, gid, key=str(uuid.uuid4()), conn=c)
        except BaseException as e:                     # noqa: BLE001 -- reported below
            errors.append(e)
        finally:
            c.close()
            done.set()
    th = threading.Thread(target=adopt)
    th.start()
    w = sqlite3.connect(auth_db._DB_PATH, timeout=3.0)
    try:
        writes = 0
        while not done.is_set() or writes < 3:
            t0 = time.perf_counter()
            w.execute("UPDATE users SET display_name = display_name WHERE id = ?", (OTHER,))
            w.commit()
            waits.append(time.perf_counter() - t0)
            writes += 1
    finally:
        w.close()
        th.join(30)
    assert not errors, errors
    assert waits and max(waits) < 3.0, max(waits)


def test_each_distinct_href_is_spelled_once_per_body(db, monkeypatch):
    """W11-R53: an href's spellings and skeletons are computed ONCE per distinct href per body (the memo), however many
    judgements read them; 1,600 links with 400 distinct hrefs spell 400."""
    real, calls = gallery._href_variants, []

    def counted(h):
        calls.append(h)
        return real(h)
    monkeypatch.setattr(gallery, "_href_variants", counted)
    content = []
    for i in range(1600):
        content += [_lk(f"part {i}", f"https://broker{i % 400}.example.com/acct/{i % 400}"),
                    {"type": "text", "text": " "}]
    gallery._without_links({"type": "doc", "content": [{"type": "paragraph", "content": content}]})
    assert len(calls) == 400 == len(set(calls))


# ── W11-R56: the address-shape check is linear, and judged link text is capped ────────────────────────────────────

#: The round-2 R48 (a) pattern, kept HERE ONLY as the oracle the linear check is compared with (its nested
#: quantifiers backtrack quadratically: never run it on long text).
R48_PATTERN_ORACLE = re.compile(
    r"(?:https?|ftp|mailto):|www\.|(?:[^\W_](?:[\w-]*[^\W_])?\.)+(?:[^\W\d_]{2,}|xn--[a-z0-9-]+)(?![\w-])")

#: The three shapes the re-review timed (50 KB: 73 s, 48 s, 127 s), each `n` characters long and never an address:
#: one word, a hyphenated word, and full stops with no letter TLD.
LONG_SHAPES = {
    "a long word": lambda n: "a" * n,
    "a long hyphenated word": lambda n: ("ab-" * n)[:n - 1] + "b",
    "dots with no letter TLD": lambda n: ("a." * n)[:n - 1] + "1",
}


def test_the_linear_shape_check_decides_exactly_what_the_r48_pattern_decided():
    """W11-R56 keeps R48 (a)'s decisions: 40,000 seeded random short texts over the characters that matter (full
    stops, hyphens, underscores, digits of several kinds, letters of several scripts, the scheme words), and code
    points at the five places a host is read (before and after the full stop, inside the TLD, after `xn--`) -- all of
    the first 12,288 and every 97th after -- answer the same as the round-2 pattern."""
    import random
    rnd = random.Random(56)
    alphabet = list("ab.-_1 xnwhtpfmilo:/") + ["xn--", "www", "http", "https", "ftp", "mailto", "é", "٣",
                                               "፩", "²", "Ⅻ", "ж", "..", "co"]
    for _ in range(40_000):
        s = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(0, 14)))
        assert gallery._has_address_shape(s) == bool(R48_PATTERN_ORACLE.search(s)), ascii(s)
    for cp in list(range(0, 0x3000)) + list(range(0x3000, 0x110000, 97)):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        c = chr(cp)
        for s in (f"a.{c}{c}", f"{c}.co", f"a.x{c}", f"a.xn--{c}", f"a.{c}"):
            assert gallery._has_address_shape(s) == bool(R48_PATTERN_ORACLE.search(s)), (hex(cp), ascii(s))


def test_the_shape_check_has_no_nested_quantifier():
    """The patterns the shape check runs hold one character class under one quantifier at most: nothing to
    backtrack into. The round-2 pattern is gone from the module."""
    assert not hasattr(gallery, "_ADDRESS_SHAPE")
    assert gallery._TLD_PIECE.pattern == r"(?<=[^\W_]\.)[\w-]{2,}"
    assert gallery._DECIMAL.pattern == r"\d"


_SHAPE_PROBE = r"""
import sys, time
sys.path.insert(0, sys.argv[1])
from api.services.journal_two import template_gallery as g
n, shape = 1_000_000, sys.argv[2]
s = {"word": "a" * n, "hyphen": ("ab-" * n)[:n - 1] + "b", "dots": ("a." * n)[:n - 1] + "1"}[shape]
form = g._address_form(s)
t0 = time.perf_counter()
got = g._has_address_shape(form)
print(repr((time.perf_counter() - t0, got)))
"""


@pytest.mark.parametrize("shape", ["word", "hyphen", "dots"])
def test_the_shape_check_alone_is_linear_on_one_mb(shape):
    """The shape check itself, BELOW the cap that normally guards it: 1 MB of each shape is judged in under half a
    second (the round-2 pattern needs hours). It runs in a child process with a deadline, so a quadratic check fails
    this rail by timing out instead of hanging the suite."""
    root = pathlib.Path(__file__).resolve().parents[1]
    try:
        r = subprocess.run([sys.executable, "-c", _SHAPE_PROBE, str(root), shape], capture_output=True, text=True,
                           timeout=60, cwd=str(root))
    except subprocess.TimeoutExpired:
        pytest.fail(f"the shape check did not finish 1 MB of {shape} in 60 s")
    assert r.returncode == 0, r.stderr
    took, got = eval(r.stdout.strip().splitlines()[-1])            # noqa: S307 -- our own child's repr
    assert got is False and took < 0.5, (shape, took)


def _one_link_paragraph(text: str, href: str) -> dict:
    return {"type": "paragraph", "content": [_lk(text, href)]}


@pytest.mark.parametrize("shape", list(LONG_SHAPES))
def test_a_one_mb_linked_text_reduces_in_under_half_a_second_and_goes_whole(db, shape):
    """The re-review's C-1 bodies at the outline cap: ONE linked text of 1 MB in each shape. It is over
    `LINK_TEXT_JUDGE_MAX`, so it is not judged and goes whole (toward privacy), in under half a second."""
    text = LONG_SHAPES[shape](1_000_000)
    doc = {"type": "doc", "content": [_one_link_paragraph(text, "https://x.example.org/a"), para("stays")]}
    t0 = time.perf_counter()
    out = gallery._shared_outline(doc, AUTHOR)
    took = time.perf_counter() - t0
    assert took < 0.5, took
    blob = json.dumps(out)
    assert text[:64] not in blob and "stays" in blob


@pytest.mark.parametrize("shape", list(LONG_SHAPES))
def test_one_mb_of_linked_texts_just_under_the_cap_reduce_in_under_half_a_second(db, shape):
    """Under the cap every text IS judged: 1 MB of distinct linked texts of `LINK_TEXT_JUDGE_MAX` characters in each
    shape (each its own paragraph and href, so nothing is joined and no judgement is shared) reduce in under half a
    second, and every one travels as words. The round-2 pattern took about 0.05 s for EACH of them."""
    n = gallery.LINK_TEXT_JUDGE_MAX
    paras = [_one_link_paragraph(LONG_SHAPES[shape](n - 6) + f"{i:06d}", f"https://site{i}.example.org/a")
             for i in range(1_000_000 // n)]
    assert all(len(p["content"][0]["text"]) == n for p in paras)
    t0 = time.perf_counter()
    out = gallery._shared_outline({"type": "doc", "content": paras}, AUTHOR)
    took = time.perf_counter() - t0
    assert took < 0.5, (shape, took)
    kept = [p["content"][0]["text"] for p in out["content"] if p.get("content")]
    assert kept == [p["content"][0]["text"] for p in paras]


def test_the_cap_is_one_constant_and_over_it_the_text_goes_whole(db):
    """`LINK_TEXT_JUDGE_MAX` is the one bound: words of exactly that length are judged (and travel), one character
    more and they go whole, linked to anything or nothing. A stretch's JOINED text is capped the same way."""
    n = gallery.LINK_TEXT_JUDGE_MAX
    words = ("my notes " * n)[:n]
    assert not gallery._link_text_is_an_address(words, ["https://x.example/a"])
    assert gallery._link_text_is_an_address(words + "s", ["https://x.example/a"])
    assert gallery._link_text_is_an_address(words + "s", [])
    half = words[: n // 2 + 1]
    out = gallery._shared_outline({"type": "doc", "content": [{"type": "paragraph", "content": [
        _lk(half, "https://x.example/a"), _lk(half, "https://x.example/a", BOLD)]}]}, AUTHOR)
    assert out["content"][0].get("content", []) == []                  # one host, joined past the cap: goes whole
    out = gallery._shared_outline({"type": "doc", "content": [{"type": "paragraph", "content": [
        _lk(half, "https://x.example/a"), {"type": "text", "text": " and "}, _lk(half, "https://y.example/b")]}]},
        AUTHOR)
    assert json.dumps(out).count(half) == 2                             # control: two hosts, each under the cap


# ── W11-R57: a flag frame travels only with subdivision-shaped tags ───────────────────────────────────────────────

def _flag(spec: str) -> str:
    return "\U0001F3F4" + _tagged(spec) + "\U000E007F"


#: The emoji that must stay byte-identical: the three subdivision flags, the ZWJ family, the VS16 heart, the pirate
#: flag (ZWJ + VS16 on the same black flag) and the rainbow flag.
TRAVELLING_EMOJI = {
    "England": _flag("gbeng"), "Scotland": _flag("gbsct"), "Wales": _flag("gbwls"),
    "zwj family": "\U0001F468‍\U0001F469‍\U0001F467", "vs16 heart": "❤️",
    "pirate flag": "\U0001F3F4‍☠️", "rainbow flag": "\U0001F3F3️‍\U0001F308",
}


@pytest.mark.parametrize("slot", [True, False], ids=["slot", "noslot"])
@pytest.mark.parametrize("linked", [True, False], ids=["link", "prose"])
def test_an_address_written_in_tags_inside_a_flag_frame_never_travels(db, slot, linked):
    """The round-3 re-review's m-1 body: the address in tag characters INSIDE a well-formed flag frame (U+1F3F4 ...
    U+E007F), as link text and as prose. No tag character reaches any path, so nothing decodes to the address; the
    word beside it and every real emoji beside it travel byte-identical."""
    frame = _flag("broker.example.com/acct/99887766")
    emoji = "".join(TRAVELLING_EMOJI.values())
    text = "statement " + frame + " " + emoji
    node = _lk(text, "https://x.example/a") if linked else {"type": "text", "text": text}
    _s, got = _every_share_path(db, [node], slot)
    for where, v in got.items():
        blob = _decoded(v)
        for e in TRAVELLING_EMOJI.values():
            blob = blob.replace(e, "")
        assert not any(0xE0000 <= ord(c) <= 0xE007F for c in blob), where
    for where in ("payload_json", "body_json", "copy", "use_note"):
        blob = _decoded(got[where])
        assert "statement" in blob and emoji in blob, where


@pytest.mark.parametrize("name", list(TRAVELLING_EMOJI))
def test_every_real_emoji_travels_byte_identical(db, name):
    e = TRAVELLING_EMOJI[name]
    assert gallery._without_ignorables(e) == e
    out = gallery._shared_outline({"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": f"a{e}b"}, {"type": "text", "text": f" see {e}", "marks": [BOLD]}]}]}, AUTHOR)
    assert [n["text"] for n in out["content"][0]["content"]] == [f"a{e}b", f" see {e}"]


def test_a_flag_frame_keeps_only_one_to_six_tag_letters_or_digits():
    """W11-R57's grammar, at its edges: 1 and `FLAG_TAG_MAX` tags of a-z / 0-9 travel; one too many, a tag capital,
    a tag full stop, slash or space, or the re-review's address strips every tag (the black flag base stays, as any
    emoji does)."""
    base = "\U0001F3F4"
    assert gallery.FLAG_TAG_MAX == 6
    for spec in ("g", "gbeng", "us0ca1", "123456"):
        assert gallery._without_ignorables(_flag(spec)) == _flag(spec), spec
    for spec in ("gbengx1", "GBENG", "gb.eng", "a/b", "gb eng", "broker.example.com/acct/99887766"):
        assert gallery._without_ignorables(_flag(spec)) == base, spec


# ── W11-R58: the adjacency-only judgement is a recorded limit ─────────────────────────────────────────────────────

def test_the_adjacency_limit_is_recorded_beside_the_others_and_one_link_away_is_still_caught(db):
    """W11-R58 records the re-review's m-2 as an accepted limit in the authority's docstring, with its concrete body.
    What the limit does not cover still holds: a fragment linked elsewhere ONE link away from the part that holds
    the rest of the address goes."""
    doc = gallery._link_text_is_an_address.__doc__
    assert "W11-R58" in doc and 'link("99887766", O2)' in doc and "recorded limit" in doc
    out = gallery._shared_outline({"type": "doc", "content": [{"type": "paragraph", "content": [
        _lk(f"https://{HOST}/acct/"), {"type": "text", "text": " "}, _lk(ACCT, "https://help.example.org/")]}]},
        AUTHOR)
    assert ACCT not in json.dumps(out) and HOST not in json.dumps(out)


# ── W11-R59: a listing that moved twice answers that the template changed ─────────────────────────────────────────

@pytest.fixture
def gallery_client(db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.limiter import limiter
    from api.middleware import auth_middleware as authmw
    from api.routers import notebook_template_gallery
    monkeypatch.setenv("NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "1")
    limiter.reset()
    fa = FastAPI()
    fa.include_router(notebook_template_gallery.router)
    user = {"id": OTHER, "role": "member", "plan": "pro"}
    fa.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    yield TestClient(fa)
    fa.dependency_overrides.clear()
    limiter.reset()


@pytest.mark.parametrize("door,keyed", [("adopt", True), ("use-template", True), ("use-template", False)],
                         ids=["keyed adopt", "keyed first use", "unkeyed first use"])
def test_a_listing_that_moved_twice_answers_that_the_template_changed(db, monkeypatch, gallery_client, door, keyed):
    """The round-3 re-review's m-3, through the member's own door: the listing moves under the lock on BOTH tries of
    a keyed adopt and of a first Use (the paths that take the write lock up front; an unkeyed adopt cleans under no
    lock). The rendered answer is 409 with `LISTING_MOVED_SENTENCE` -- the template changed -- never "That is already
    on its way", and nothing was made."""
    gid = _legacy_listing(db, 5)
    real = gallery._Prepared.__init__

    def init(self, row):
        real(self, row)
        self.payload_json = (self.payload_json or "") + " "             # an approval in between, every time
    monkeypatch.setattr(gallery._Prepared, "__init__", init)

    def made():
        return (db.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0],
                db.execute("SELECT COUNT(*) FROM j2_journal_styles").fetchone()[0])
    before = made()
    headers = {"Content-Type": "application/json"}
    if keyed:
        headers[gallery.IDEMPOTENCY_HEADER] = str(uuid.uuid4())
    r = gallery_client.post(f"/api/j2/template-gallery/{gid}/{door}", content=b"{}", headers=headers)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["message"] == gallery.LISTING_MOVED_SENTENCE
    assert r.json()["detail"]["code"] == gallery.LISTING_MOVED_CODE == "listing_moved"       # W11-R60: its own code
    assert "template changed" in r.text and gallery.S_KEY_IN_FLIGHT not in r.text
    assert made() == before
