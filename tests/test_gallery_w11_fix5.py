"""Task 11.8 fix round 5: the address rule runs BEFORE the reducer (I-1), a key race's loser never inserts a note
(I-2, ruling W11-R41), a failed Use forgets only its own reservation (m-b), every read of a stored listing is cleaned
again (m-a), and "a link whose text is its address" reads the link's FULL text (m-d)."""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from tests._gallery_w11_helpers import (  # noqa: F401 -- db is a fixture
    AUTHOR, MEMBER, approve, built, db, heading, list_template, para, routine, routine_slot, style, tracker,
    tracker_slot, widget,
)

C = "zzqcanary7f"
ZW = "​"
CHOICES = {"routine_a": {"create": True}, "tracker_a": {"create": True}}


def _lt(text, href, *more):
    """A text node carrying a link mark (`href=...` is a mark with no attrs at all)."""
    m = [{"type": "link", "attrs": {"href": href}}] if href is not ... else [{"type": "link"}]
    return {"type": "text", "text": text, "marks": m + list(more)}


def _doc(*nodes):
    return {"type": "doc", "content": [{"type": "paragraph", "content": list(nodes)}]}


def _shared(*nodes) -> str:
    return json.dumps(gallery._shared_outline(_doc(*nodes), AUTHOR), ensure_ascii=False)


# ── I-1: the address rule runs on the RAW outline, before the reducer can unlink ──────────────────────────────────

#: Autolinked addresses the gallery reducer UNLINKS (keeping the text as prose) -- each with text == href. Before fix
#: round 5 every one of them reached the listing whole, the reducer having hidden the link from W11-R40.
REDUCER_UNLINKS = [
    ("email in the query", f"https://broker.example.com/stmt?user=me@{C}.com&acct=99887766", "99887766"),
    ("apostrophe in the path", f"https://{C}.example.com/acct/O'Neil-99887766", "99887766"),
    ("quote in the query", f"https://{C}.example.com/q?a=\"99887766\"", "99887766"),
    ("over 2048 characters", f"https://{C}.example.com/acct/99887766?t=" + "x" * 2100, "99887766"),
    ("backslash", f"https://{C}.example.com/acct\\99887766", "99887766"),
    ("tel:", "tel:+15559876543", "9876543"),
    ("data:", f"data:text/plain,{C}-99887766", "99887766"),
    ("javascript:", f"javascript:alert('{C}-99887766')", "99887766"),
]


@pytest.mark.parametrize("name,url,secret", REDUCER_UNLINKS, ids=[r[0] for r in REDUCER_UNLINKS])
def test_an_address_the_reducer_unlinks_is_still_dropped_whole(db, name, url, secret):
    out = _shared(_lt(url, url), {"type": "text", "text": " words stay"})
    assert secret not in out and C not in out.lower(), (name, out[:200])
    assert "words stay" in out
    # Control: the reducer alone keeps the address as prose -- the case the ORDER now closes.
    assert secret in json.dumps(gallery.sanitize_body(_doc(_lt(url, url)), AUTHOR), ensure_ascii=False)


@pytest.mark.parametrize("slot", [True, False], ids=["slot", "noslot"])
def test_a_broker_statement_link_never_reaches_the_listing_or_the_copy(db, slot):
    """I-1, the reviewer's repro: an autolinked statement URL with the member's email in its query and the account
    number beside it. Neither the account number nor the broker domain reaches `payload_json`, `body_json` or the
    adopter's copy, on a slot template and on a no-slot one; the words around it travel."""
    url = f"https://broker.example.com/stmt?user=me@{C}.com&acct=99887766"
    w = widget(db)
    head = [heading("Plan")] + ([para("{{block:built_a}}")] if slot else [])
    outline = {"type": "doc", "content": head + [
        {"type": "paragraph", "content": [_lt(url, url), {"type": "text", "text": " my statement"}]}]}
    s = style(db, blocks=[built("a", w["id"])] if slot else [], outline=outline)
    assert "99887766" in json.dumps(js.get_style(AUTHOR, s["id"], db, full=True)["outlineBodyJson"])   # control
    gid = list_template(db, s["id"], title=f"T{int(slot)}")
    payload, body = db.execute("SELECT payload_json, body_json FROM j2_template_gallery WHERE id = ?",
                               (gid,)).fetchone()
    ad = gallery.adopt_style(MEMBER, gid, answers={"p1": "Flag"}, key=str(uuid.uuid4()), conn=db)
    copy = json.dumps(js.get_style(MEMBER, ad["style"]["id"], db, full=True))
    for where, blob in (("payload_json", payload), ("body_json", body), ("copy", copy)):
        assert blob and "99887766" not in blob and "broker.example.com" not in blob and C not in blob.lower(), where
    assert "my statement" in payload and "my statement" in copy


# ── m-d: the link's FULL text, normalised ─────────────────────────────────────────────────────────────────────────

ADDRESS_TEXT = [
    ("plain autolink", [_lt(f"https://{C}.example.com/a", f"https://{C}.example.com/a")], C),
    ("upper scheme", [_lt(f"HTTPS://{C.upper()}.EXAMPLE.COM", f"https://{C}.example.com")], C),
    ("idn text = idn href", [_lt(f"https://bücher-{C}.de/a", f"https://bücher-{C}.de/a")], C),
    ("idn bare text, punycode href", [_lt(f"bücher-{C}.de", f"https://xn--bcher-{C}-kva.de")], C),
    ("idn bare text, idn href", [_lt(f"bücher-{C}.de/acct", f"https://bücher-{C}.de/acct")], C),
    ("idn tld bare", [_lt(f"{C}.рф", f"https://{C}.xn--p1ai")], C),
    ("unicode text, punycode href", [_lt("bücher.de/x", "https://xn--bcher-kva.de/x")], "bücher"),
    ("punycode bare text", [_lt(f"xn--bcher-{C}.de", f"https://xn--bcher-{C}.de")], C),
    ("mailto text", [_lt(f"mailto:me@{C}.com", f"mailto:me@{C}.com")], C),
    ("email text", [_lt(f"me@{C}.com", f"mailto:me@{C}.com")], C),
    ("tel same", [_lt("tel:+15559876543", "tel:+15559876543")], "9876543"),
    ("tel formatted", [_lt("+1 (555) 987-6543", "tel:+15559876543")], "987-6543"),
    ("tel formatted, no plus", [_lt("(555) 987-6543", "tel:+15559876543")], "987-6543"),
    ("data uri", [_lt(f"data:text/plain,{C}", f"data:text/plain,{C}")], C),
    ("split across nodes (bold tail)", [_lt("https://broker.example.com/acct/", f"https://broker.example.com/acct/{C}"),
                                        _lt(C, f"https://broker.example.com/acct/{C}", {"type": "bold"})], C),
    ("split: domain head bold", [_lt(C, f"https://{C}.example.com", {"type": "bold"}),
                                 _lt(".example.com", f"https://{C}.example.com")], C),
    ("split: three parts", [_lt("https://", f"https://{C}.example.com"),
                            _lt(C, f"https://{C}.example.com", {"type": "italic"}),
                            _lt(".example.com", f"https://{C}.example.com")], C),
    ("zero-width inside domain", [_lt(f"{C}{ZW}.example.com", f"https://{C}.example.com")], C),
    ("zero-width prefix", [_lt(f"{ZW}https://{C}.example.com", f"https://{C}.example.com")], C),
    ("BOM prefix", [_lt(f"﻿{C}.example.com", f"https://{C}.example.com")], C),
    ("word joiner inside", [_lt(f"{C}⁠.example.com", f"https://{C}.example.com")], C),
    ("zero-width inside scheme url", [_lt(f"https://{C}{ZW}.example.com/a", f"https://{C}.example.com/a")], C),
    ("trailing period", [_lt(f"{C}.example.com.", f"https://{C}.example.com")], C),
    ("angle brackets", [_lt(f"<https://{C}.example.com>", f"https://{C}.example.com")], C),
    ("parens", [_lt(f"({C}.example.com)", f"https://{C}.example.com")], C),
    ("square brackets", [_lt(f"[{C}.example.com]", f"https://{C}.example.com")], C),
    ("fullwidth dots", [_lt(f"{C}。example。com", f"https://{C}.example.com")], C),
    ("fullwidth full stop", [_lt(f"{C}．example．com", f"https://{C}.example.com")], C),
    ("ip address", [_lt("10.20.30.40:8443/acct", "https://10.20.30.40:8443/acct")], "10.20.30.40"),
    ("ip bare, href longer", [_lt("10.20.30.40", "https://10.20.30.40:8443/acct/9")], "10.20.30.40"),
    ("path only", [_lt(f"/acct/{C}", f"https://broker.example.com/acct/{C}")], C),
    # W11-R47: words that appear in their own address go too (the ruling's accepted cost)
    ("a ticker in its own href", [_lt("AAPL", "https://q.com/AAPL")], "AAPL"),
    ("a date in its own href", [_lt("2026-10-26", "https://cal.example.com/2026-10-26")], "2026-10-26"),
    ("a number-only piece of its href", [_lt(C, f"https://broker.example.com/acct/{C}/")], C),
]


@pytest.mark.parametrize("name,nodes,secret", ADDRESS_TEXT, ids=[c[0] for c in ADDRESS_TEXT])
def test_a_link_whose_full_text_is_its_address_goes_whole(db, name, nodes, secret):
    out = _shared(*nodes, {"type": "text", "text": " kept words"})
    assert secret.lower() not in out.lower(), (name, out[:200])
    assert "kept words" in out


@pytest.mark.parametrize("text,href", [
    ("my broker", f"https://{C}.x.com"), ("read the filing", "https://sec.gov/x"), ("my notes", "https://x.example/a"),
    ("Q3 report", "https://ir.example.com/q3"),
    ("e.g.", "https://example.com"), ("S&P 500", "https://example.com/spx"),
])
def test_words_that_are_not_an_address_travel(db, text, href):
    """No false positives: link text that is words keeps its words (the href goes, W11-R33)."""
    out = _shared(_lt(text, href))
    assert text in out and href not in out


@pytest.mark.parametrize("nodes", [
    [_lt(f"https://{C}.example.com/a", "javascript:alert(1)")],
    [_lt(f"https://{C}.example.com/a", ...)],
    [_lt(f"{C}.example.com", "https://elsewhere.example.org")],
], ids=["javascript href", "no href", "another address"])
def test_link_text_that_is_not_its_own_address_travels_as_prose_does(db, nodes):
    """W11-R47 (superseding the URL-shape forms): a link's text that is NOT in its own href is visible text, exactly
    like a URL written in plain prose (W11-R40), and travels; only the href goes."""
    out = _shared(*nodes)
    assert C in out and "href" not in out


def test_a_run_is_judged_whole_and_words_beside_an_address_travel(db):
    """A run of one link split by a mark change is one link: judged on its joined text. Link text that is words plus
    a URL is not "its address" (W11-R40, recorded by the r4 review): it travels, the href does not. A plain-prose URL
    with no link mark is unchanged."""
    words = _shared(_lt("my acct ", f"https://{C}.example.com/1"),
                    _lt("statement", f"https://{C}.example.com/1", {"type": "bold"}))
    assert "my acct " in words and "statement" in words and C not in words
    prose = _shared({"type": "text", "text": f"see https://{C}.example.com/plain"})
    assert f"https://{C}.example.com/plain" in prose
    # two adjacent links with DIFFERENT hrefs: the joined run is not an address, so each linked node is judged
    two = _shared(_lt("my broker", "https://a.example.com"), _lt(f"{C}.example.com", f"https://{C}.example.com"))
    assert "my broker" in two and C not in two


# ── m-a: every read of a stored listing is cleaned again (THE one path) ─────────────────────────────────────────

def _link_card(url):
    return {"type": "linkPreview", "attrs": {"url": url, "title": "card"}}


def test_every_read_of_a_stored_listing_is_cleaned_again(db):
    """m-a: a listing approved, then hand-edited to hold a link card and a link href carrying the canary (a row
    written before the fix, or by hand). `get_item`, the update plan's `newOutline`, what `apply_update` writes and a
    later adopt all serve it cleaned; the words travel. The copy's outline fingerprint stays on the LISTED outline."""
    s = style(db, blocks=[], outline={"type": "doc", "content": [heading("Plan"), para("stays")]})
    gid = list_template(db, s["id"])
    ad = gallery.adopt_style(MEMBER, gid, conn=db)
    p = json.loads(db.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0])
    p["outlineBodyJson"]["content"] += [
        _link_card(f"https://{C}.example.com/acct"),
        {"type": "paragraph", "content": [_lt("my broker", f"https://{C}.x.com"),
                                          {"type": "text", "text": " v2 words"}]}]
    raw_hash = gallery._outline_hash(p["outlineBodyJson"])
    db.execute("UPDATE j2_template_gallery SET payload_json = ?, version = version + 1 WHERE id = ?",
               (json.dumps(p), gid))
    db.commit()
    item = json.dumps(gallery.get_item(MEMBER, gid, conn=db), default=str)
    plan = gallery.plan_update(MEMBER, ad["style"]["id"], conn=db)
    mine = js.get_style(MEMBER, ad["style"]["id"], db, full=True)
    gallery.apply_update(MEMBER, ad["style"]["id"], take_outline=True, base_updated_at=mine["updatedAt"], conn=db)
    after = js.get_style(MEMBER, ad["style"]["id"], db, full=True)
    ad2 = gallery.adopt_style(MEMBER, gid, conn=db)
    copy2 = js.get_style(MEMBER, ad2["style"]["id"], db, full=True)
    for where, blob in (("get_item", item), ("plan_update", json.dumps(plan)), ("after apply", json.dumps(after)),
                        ("second adopt", json.dumps(copy2))):
        assert C not in blob.lower() and "linkPreview" not in blob, where
    assert plan["outlineChanged"] and "v2 words" in json.dumps(plan["newOutline"])
    assert "v2 words" in json.dumps(after) and "my broker" in json.dumps(after)
    rec = db.execute("SELECT source_outline_hash FROM j2_journal_styles WHERE id = ?", (ad["style"]["id"],)).fetchone()
    assert rec[0] == raw_hash                                    # the fingerprint is the LISTED outline's
    assert gallery.plan_update(MEMBER, ad["style"]["id"], conn=db) is None        # nothing newer: no plan


# ── I-2 / W11-R41: the losing request NEVER inserts a note ─────────────────────────────────────────────────────

def _template(db):
    """A listed template whose adoption makes the member's own widget, routine and tracker: every Use after the first
    composes on `create_styled_note`'s PLAIN path."""
    w, r, t = widget(db), routine(db), tracker(db)
    s = style(db, blocks=[built("a", w["id"]), routine_slot("a", r["id"]), tracker_slot("a", t["id"])])
    return list_template(db, s["id"], edits={"blocks": {"routine_a": {"items": ["Coffee", "Mark levels"]}}})


TOOL_PICK = {"routine_a": {"create": True}}


def _tools_template(db):
    """A listed template with a built-in `template` routine slot: a fresh copy ASKS for its routine, so its first
    note is composed on `create_styled_note`'s TOOLS path (under the style's write lock)."""
    w = widget(db)
    slot = {"block": "routine_a", "enabled": True,
            "settings": {"template": "premarket_routine", "bind": "note-day", "display": "items"}}
    return list_template(db, style(db, blocks=[built("a", w["id"]), slot])["id"], title="Tools")


def _notes(db):
    """(all, live, trashed) notes of the member -- the trash COUNTS (W11-R41)."""
    r = db.execute("SELECT COUNT(*), SUM(deleted_at IS NULL), SUM(deleted_at IS NOT NULL) FROM j2_notes"
                   " WHERE user_id = ?", (MEMBER,)).fetchone()
    return int(r[0] or 0), int(r[1] or 0), int(r[2] or 0)


def _key(db, k):
    return db.execute("SELECT new_id, token FROM j2_tool_create_keys WHERE user_id = ? AND key = ?",
                      (MEMBER, k)).fetchone()


def _age(db, k):
    db.execute("UPDATE j2_tool_create_keys SET created_at = ? WHERE user_id = ? AND key = ?",
               ((datetime.now(timezone.utc) - timedelta(seconds=gallery.USE_RESERVATION_STALE_SECS + 1)).isoformat(),
                MEMBER, k))
    db.commit()


def _race(db, monkeypatch, gid, k, *, point="create", together=False, a_raises=False, b_raises=False,
          answers=None, choices=None):
    """Real threads, each on its own connection. A stalls at `point`; its reservation is aged past the 60 s edge; B
    (same key) takes over. `point`: "check" -- before the pre-compose key check; "create" -- on entering
    `create_styled_note` (after the check, before compose); "lock" -- after compose, before the write lock and the
    before-insert guard. `together`: A is released the moment B starts, so the two run at once; otherwise B
    finishes first. `a_raises` / `b_raises`: that request's compose fails."""
    real_create, real_lock, real_refs = js.create_styled_note, js._lock_for_style, gallery._tool_slot_refs
    inside, go = threading.Event(), threading.Event()
    first = []

    def stall(at):
        if at == point and threading.current_thread().name == "A" and not first:
            first.append(1)
            inside.set()
            go.wait(30)
            if a_raises:
                raise RuntimeError("compose failed")

    def slow(user_id, payload, conn=None, **kw):
        stall("create")
        if threading.current_thread().name == "B" and b_raises:
            raise RuntimeError("compose failed")
        return real_create(user_id, payload, conn, **kw)

    def lock(conn):
        stall("lock")
        return real_lock(conn)

    def refs(*a, **kw):
        stall("check")
        return real_refs(*a, **kw)

    monkeypatch.setattr(js, "create_styled_note", slow)
    monkeypatch.setattr(js, "_lock_for_style", lock)
    monkeypatch.setattr(gallery, "_tool_slot_refs", refs)
    out = {}

    def run(name):
        c = auth_db.get_connection()
        try:
            out[name] = gallery.use_library_template(MEMBER, gid, answers=answers, choices=choices, payload={},
                                                     key=k, conn=c)
        except Exception as e:  # noqa: BLE001 -- asserted by the caller
            out[name] = e
        finally:
            c.close()
    a = threading.Thread(target=run, args=("A",), name="A")
    a.start()
    assert inside.wait(30)
    _age(db, k)
    b = threading.Thread(target=run, args=("B",), name="B")
    b.start()
    if together:
        go.set()
    b.join(60)
    go.set()
    a.join(60)
    monkeypatch.setattr(js, "create_styled_note", real_create)
    monkeypatch.setattr(js, "_lock_for_style", real_lock)
    monkeypatch.setattr(gallery, "_tool_slot_refs", real_refs)
    return out


def test_fifty_races_at_the_edge_never_make_a_second_note(db, monkeypatch):
    """W11-R41, the rail: 50 real-thread races at the 60 s edge across five interleavings (A stalled before its key
    check, before its compose, or after it, with B finishing first or running at once). Every race inserts
    exactly ONE note in all (the trash counts), leaves nothing in the trash -- so restoring cannot produce two live
    notes --, records that note in the key, and both requests answer it. (F-NOTE-1, r5 m-4: the old "no TEMP trigger
    outlives a request" check here could not fail and is gone; no keyed Use creates a temp object at all, railed in
    `test_gallery_w11_fnote1.py::test_a_keyed_use_never_creates_a_temp_object`.)"""
    gid = _template(db)
    gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    gid_tools = _tools_template(db)
    real_finish, tools_paths = js._finish_tools, []

    def finish(*a, **kw):
        tools_paths.append(1)
        return real_finish(*a, **kw)
    monkeypatch.setattr(js, "_finish_tools", finish)               # only the TOOLS path fills its tool markers
    modes = (("check", False), ("create", False), ("lock", False), ("create", True), ("lock", True))
    for i in range(50):
        mode = modes[i % len(modes)]
        tools = i % 2 == 1
        if tools:
            # a fresh copy each time (the last one archived), so the race composes on the TOOLS path
            old = gallery._newest_copy(db, MEMBER, gid_tools)
            if old:
                js.archive_style(MEMBER, old, conn=db)
        all0, live0, trash0 = _notes(db)
        k = str(uuid.uuid4())
        out = _race(db, monkeypatch, gid_tools if tools else gid, k, point=mode[0], together=mode[1],
                    answers={"p1": "Flag"} if tools else None, choices=TOOL_PICK if tools else None)
        all1, live1, trash1 = _notes(db)
        assert (all1 - all0, live1 - live0, trash1 - trash0) == (1, 1, 0), (i, mode, tools, out)
        assert not isinstance(out["A"], Exception) and not isinstance(out["B"], Exception), (i, mode, out)
        key_note = _key(db, k)[0]
        assert out["A"]["note"]["id"] == out["B"]["note"]["id"] == key_note, (i, mode)
        assert sum(bool(out[n].get("replayed")) for n in "AB") == 1, (i, mode)
    assert trash1 == 0                         # nothing to restore: Recently Deleted cannot make a second note
    assert len(tools_paths) >= 25, len(tools_paths)                # both of create_styled_note's paths raced


def test_the_loser_inserts_nothing_and_answers_the_winner(db, monkeypatch):
    """The reviewer's r4 repro (r118d_idem), asserting the fix: A is taken over while composing; B finishes; A
    resumes. One note in all -- A never inserted, so there is no trashed twin -- and A answers B's note."""
    gid = _template(db)
    gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    monkeypatch.setattr(gallery, "_wait_for_key", lambda uid, key, timeout_s=15.0: None)
    all0, live0, trash0 = _notes(db)
    k = str(uuid.uuid4())
    out = _race(db, monkeypatch, gid, k)
    assert _notes(db) == (all0 + 1, live0 + 1, trash0)
    assert out["A"]["replayed"] and out["A"]["note"]["id"] == out["B"]["note"]["id"] == _key(db, k)[0]


def test_a_failed_loser_never_forgets_the_winners_key(db, monkeypatch):
    """m-b, path 1: B takes over and records its note; A's compose then raises. A forgets ONLY its own reservation,
    so B's recorded key survives and a replay answers B's note: one note."""
    gid = _template(db)
    gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    all0 = _notes(db)[0]
    k = str(uuid.uuid4())
    out = _race(db, monkeypatch, gid, k, a_raises=True)
    assert isinstance(out["A"], RuntimeError) and isinstance(out["B"], dict)
    assert _key(db, k)[0] == out["B"]["note"]["id"]
    again = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=db)
    assert again["replayed"] and again["note"]["id"] == out["B"]["note"]["id"]
    assert _notes(db)[0] - all0 == 1


def test_a_failed_taker_leaves_the_holder_to_record_its_note(db, monkeypatch):
    """m-b, path 2: B takes over and FAILS (forgetting only its own reservation); A then finds no key row, so its
    guard reserves the key again and its note is recorded in the same transaction: a replay answers A's note."""
    gid = _template(db)
    gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    all0 = _notes(db)[0]
    k = str(uuid.uuid4())
    out = _race(db, monkeypatch, gid, k, b_raises=True)
    assert isinstance(out["B"], RuntimeError) and isinstance(out["A"], dict) and not out["A"].get("replayed")
    assert _key(db, k)[0] == out["A"]["note"]["id"]
    again = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=db)
    assert again["replayed"] and again["note"]["id"] == out["A"]["note"]["id"]
    assert _notes(db)[0] - all0 == 1


def test_the_guard_runs_before_the_insert_on_both_compose_paths(db, monkeypatch):
    """The hook is on BOTH of `create_styled_note`'s insert paths (a style asking for tools, under the style's write
    lock, and one that does not): a guard that refuses leaves no note and no routine or tracker behind; one that
    allows is called exactly once and the note is made."""
    from api.services.journal_two import notes as notes_service
    w = widget(db, uid=MEMBER)
    plain = style(db, uid=MEMBER, blocks=[built("a", w["id"])])          # no routine/tracker slot: the plain path
    copy_id = gallery.adopt_style(MEMBER, _tools_template(db), answers={"p1": "Flag"}, conn=db)["style"]["id"]
    assert not js._asks_tools(js.get_style(MEMBER, plain["id"], db))
    assert js._asks_tools(js.get_style(MEMBER, copy_id, db))             # the tools path: it asks for its tools

    class Refused(Exception):
        pass

    def made(c):
        return [c.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (MEMBER,)).fetchone()[0]
                for t in ("j2_notes", "j2_routines", "j2_trackers")]

    for sid, choices in ((plain["id"], {}), (copy_id, TOOL_PICK)):
        calls = []

        def refuse(conn):
            calls.append(conn.in_transaction)
            raise Refused()
        before = made(db)
        with pytest.raises(Refused):
            js.create_styled_note(MEMBER, {"styleId": sid, "choices": choices}, db, before_insert=refuse)
        if db.in_transaction:
            db.rollback()
        assert len(calls) == 1, (sid, calls)
        assert made(db) == before, sid
        ok = []
        note, _ = js.create_styled_note(MEMBER, {"styleId": sid, "choices": choices}, db,
                                        before_insert=lambda conn: ok.append(conn.in_transaction))
        assert len(ok) == 1 and notes_service.get_note(MEMBER, note["id"], db) is not None, sid


def test_a_holder_never_inserts_while_its_taker_is_still_in_flight(db, monkeypatch):
    """The token's own case: A has composed and is about to insert; B has ALREADY taken the key over and is still
    composing (its reservation is "" too). A key check on `new_id = ''` alone would let A insert beside B. A's guard
    reads the token, inserts nothing, and waits for B's note; B then lands. One note in all, both answer B's."""
    gid = _template(db)
    gallery.use_library_template(MEMBER, gid, answers={"p1": "Flag"}, choices=CHOICES, payload={}, conn=db)
    real_create, real_lock, real_wait = js.create_styled_note, js._lock_for_style, gallery._wait_for_key
    a_at_lock, a_go, b_in, b_go, a_waiting = (threading.Event() for _ in range(5))
    seen = []

    def slow(user_id, payload, conn=None, **kw):
        if threading.current_thread().name == "B" and not b_in.is_set():
            b_in.set()
            b_go.wait(30)
        return real_create(user_id, payload, conn, **kw)

    def lock(conn):
        if threading.current_thread().name == "A" and not seen:
            seen.append(1)
            a_at_lock.set()
            a_go.wait(30)
        return real_lock(conn)

    def wait(uid, key, timeout_s=15.0):
        if threading.current_thread().name == "A":
            a_waiting.set()
        return real_wait(uid, key, timeout_s)
    monkeypatch.setattr(js, "create_styled_note", slow)
    monkeypatch.setattr(js, "_lock_for_style", lock)
    monkeypatch.setattr(gallery, "_wait_for_key", wait)
    all0, _live0, trash0 = _notes(db)
    k = str(uuid.uuid4())
    out = {}

    def run(name):
        c = auth_db.get_connection()
        try:
            out[name] = gallery.use_library_template(MEMBER, gid, payload={}, key=k, conn=c)
        except Exception as e:  # noqa: BLE001 -- asserted below
            out[name] = e
        finally:
            c.close()
    a = threading.Thread(target=run, args=("A",), name="A")
    a.start()
    assert a_at_lock.wait(30)                       # A: composed, before the lock and its guard
    _age(db, k)
    b = threading.Thread(target=run, args=("B",), name="B")
    b.start()
    assert b_in.wait(30)                            # B: took the key over (its own "" + token), composing
    assert _key(db, k)[0] == "" and _key(db, k)[1] is not None
    a_go.set()
    assert a_waiting.wait(30), out                  # A's guard refused: A is waiting for B's note, inserted nothing
    assert _notes(db)[0] == all0
    b_go.set()
    b.join(60)
    a.join(60)
    assert _notes(db) == (all0 + 1, _live0 + 1, trash0), out
    assert out["A"]["replayed"] and out["A"]["note"]["id"] == out["B"]["note"]["id"] == _key(db, k)[0]
