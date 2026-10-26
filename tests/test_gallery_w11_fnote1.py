"""F-NOTE-1 (ruling W11-R42): a keyed Use writes its note and its key in ONE short locked transaction, through
`notes.create_note(commit=False)`, with no temporary trigger; any exception (a BaseException too) leaves nothing
behind and no transaction open on a caller's connection; and `get_item` with wave 11 off answers exactly what it
answered before Task 11.8.

The reviewer's r5 reproductions (`r118e_trigger.py`) are ported here asserting the fix: m-1 (another insert in the
window cannot take the key) and m-2 (a BaseException on the second path leaves a caller's connection locked)."""
from __future__ import annotations

import json
import pathlib
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
           ("BROKER.EXAMPLE.COM", [URL]))
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
DI_EMOJI = {0x200D, 0xFE00, 0xFE0F, 0xE0020, 0xE0041, 0xE007F, 0xE0100, 0xE01EF}
DI_STRIPPED = [cp for cp in DI_MEMBERS if cp not in DI_EMOJI] + [0xE001F, 0xE0080, 0xE00FF, 0xE01F0]
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
