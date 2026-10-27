"""Task 11.12: the wave 11 routes (`api/routers/notebook_template_gallery.py`, `api/routers/notebook_journal_styles.py`)
and the My tools list merge (`api/routers/notebook_routines.py`, `notebook_widget_definitions.py`).

What each section proves:
  * THE GATE: every new door answers the one 404 while wave 11 (or the library switch) is off, read per request,
    before the plan check and before the body (an oversized body still answers 404).
  * ORDER: the literal paths are declared above `/{gallery_id}`.
  * BODIES: 16 KB and depth 16 on the new gallery doors.
  * ERRORS: answered from the refusal's class (`unresolved`, `not_yours` with its slot, `own_words`, `adopted`,
    `helpful_days`, `count_cap`), never by sentence.
  * RATES: the share preview and preview-mine share the 60/hour scope; publishing a tool is 10/hour.
  * no-store on every 200 and every refusal; 402 for an unpaid member with the gallery's own sentence.
  * The library list, the card facts, two Uses at once through HTTP, the Idempotency-Key, the listed title, the
    journal-styles views and the My tools rows (carry 8).
"""
from __future__ import annotations

import json
import threading
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from api.services.journal_two import template_library
from api.services.journal_two import template_tools
from api.services.journal_two.widget_engine import share
from tests._gallery_w11_helpers import (  # noqa: F401 -- `db` is a fixture used by name
    ALL_WAVES, AUTHOR, MEMBER, OTHER, db, heading, list_template, list_tool, para, routine, style, waves, widget,
)

PAID = {"plan": "pro"}
FREE = {"plan": "free"}
GALLERY = "/api/j2/template-gallery"
STYLES = "/api/j2/journal-styles"
PAID_SENTENCE = "The community template gallery requires a paid plan"

#: The new doors, typed here on purpose (NOT read from the router): the router's routes are enumerated against it.
NEW_GALLERY_DOORS = (
    ("POST", "/share/preview"), ("POST", "/tools"), ("GET", "/library"),
    ("POST", "/tools/updates/{kind}/{copy_id}"), ("GET", "/notes/{note_id}/helpful-prompt"),
    ("POST", "/{gallery_id}/preview-mine"), ("POST", "/{gallery_id}/adopt-tool"),
    ("POST", "/{gallery_id}/use-template"), ("POST", "/{gallery_id}/helpful-prompt"),
)
NEW_STYLE_DOORS = (
    ("POST", "/{style_id}/archive"), ("POST", "/{style_id}/unarchive"), ("POST", "/{style_id}/duplicate"),
    ("POST", "/{style_id}/delete"), ("GET", "/{style_id}/used-in"),
)


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _fresh_limiter():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def app(db, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "1")
    from api.routers import notebook_journal_styles, notebook_routines, notebook_template_gallery
    from api.routers import notebook_widget_definitions
    fa = FastAPI()
    fa.include_router(notebook_template_gallery.router)
    fa.include_router(notebook_journal_styles.router)
    fa.include_router(notebook_routines.routines_router)
    fa.include_router(notebook_routines.trackers_router)
    fa.include_router(notebook_widget_definitions.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_user(app, user_id: str, plan: dict = PAID) -> None:
    user = {"id": user_id, "role": "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _concrete(path: str) -> str:
    return (path.replace("{kind}", "widget").replace("{copy_id}", "x1").replace("{note_id}", "n1")
            .replace("{gallery_id}", "g1").replace("{style_id}", "s1"))


def _send(client, method: str, url: str, body=None, headers=None):
    if method == "GET":
        return client.get(url, headers=headers)
    return client.post(url, content=json.dumps(body if body is not None else {}),
                       headers={"Content-Type": "application/json", **(headers or {})})


def _no_store(resp) -> bool:
    return "no-store" in (resp.headers.get("cache-control") or "")


def _official(db, *, title="Pre-market prep", group="before_open", template="morning_routine"):
    payload = {"kindId": "weekend_prep", "format": 2, "name": title, "description": "",
               "outlineBodyJson": {"type": "doc", "content": [heading("Prep"), para("{{block:routine_a}}")]},
               "blocks": [{"block": "routine_a", "enabled": True,
                           "settings": {"template": template, "bind": "note-day", "display": "items"}}],
               "properties": {}, "definitions": [], "routines": [], "trackers": [], "slots": []}
    gid = uuid.uuid4().hex
    db.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
               " listed_at, created_at, updated_at, preview_json, item_type, payload_json, version, template_group)"
               " VALUES (?, NULL, 'official', ?, '', 'journal', '{}', 'approved', '2026-10-01T00:00:00',"
               " '2026-10-01T00:00:00', '2026-10-02T00:00:00', '[]', 'style', ?, 1, ?)",
               (gid, title, json.dumps(payload), group))
    db.commit()
    return gid


def _routine_ids_in_notes(db):
    out = []
    for (body,) in db.execute("SELECT body_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL", (MEMBER,)):
        stack = [json.loads(body)]
        while stack:
            n = stack.pop()
            if isinstance(n, dict):
                attrs = n.get("attrs") or {}
                if n.get("type") == "widgetEmbed" and attrs.get("widgetId") == "routine":
                    out.append((attrs.get("params") or {}).get("routineId"))
                stack.extend(n.get("content") or [])
    return out


# ── the gate ──────────────────────────────────────────────────────────────────────────────────────

def _gate_routes():
    """m-5: the wave 11 doors DERIVED from the route table: every route of the two routers carrying the wave 11
    gate (`_require_w11`) as a route dependency. A gated door is probed the day it lands. A door that forgets the
    gate is caught by `test_every_route_outside_the_pre_wave_11_set_carries_the_gate` (fix round 2, n-2)."""
    from api.routers import notebook_journal_styles, notebook_template_gallery
    found = []
    for router, gate, prefix in ((notebook_template_gallery.router, notebook_template_gallery._require_w11, GALLERY),
                                 (notebook_journal_styles.router, notebook_journal_styles._require_w11, STYLES)):
        for r in router.routes:
            if any(getattr(d, "dependency", None) is gate for d in getattr(r, "dependencies", [])):
                for m in r.methods:
                    found.append((m, r.path, router is notebook_template_gallery.router, prefix))
    return found


def test_every_new_route_404_when_w11_off(app, client, monkeypatch):
    found = _gate_routes()
    derived = {(m, p[len(pre):]) for m, p, _g, pre in found}
    typed = set(NEW_GALLERY_DOORS) | set(NEW_STYLE_DOORS)
    assert len(found) >= 12, found                                       # non-vacuity
    assert typed <= derived, typed - derived                             # every recorded door still carries the gate
    assert ("GET", "/{gallery_id}") not in derived                       # control: an ungated route is not derived
    huge = {"x": "a" * (40 * 1024)}                     # a body the door would refuse: the gate answers first
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W11_ENABLED", raising=False)   # W11-R72: the gate OFF, stated here
    for plan in (PAID, FREE):                           # the gate runs before the plan check
        as_user(app, MEMBER, plan)
        for method, path, is_gallery, _pre in found:
            r = _send(client, method, _concrete(path), huge)
            assert r.status_code == 404, (plan, method, path, r.status_code, r.text)
            assert _no_store(r), (method, path)
        r = client.get(f"{STYLES}?view=live")                      # the one wave 11 door on a shared route (m-1)
        assert r.status_code == 404 and _no_store(r), (plan, r.status_code)
    as_user(app, MEMBER)
    # wave 11 on, the library switch off: every gallery door is still the 404 (journal styles do not need it)
    waves(monkeypatch, *ALL_WAVES)
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    for method, path, is_gallery, _pre in found:
        if is_gallery:
            assert _send(client, method, _concrete(path), huge).status_code == 404, (method, path)
    # control: both on, the gate lets a door through
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    assert client.get(f"{GALLERY}/library").status_code == 200


def test_flag_read_per_request(app, client, monkeypatch):
    as_user(app, MEMBER)
    assert client.get(f"{GALLERY}/library").status_code == 200
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W11_ENABLED", raising=False)   # W11-R72: the gate OFF, stated here
    assert client.get(f"{GALLERY}/library").status_code == 404
    assert client.get(f"{STYLES}/s1/used-in").status_code == 404
    waves(monkeypatch, *ALL_WAVES)
    assert client.get(f"{GALLERY}/library").status_code == 200


def test_literal_paths_beat_the_id_route(app, client, db):
    from api.routers import notebook_template_gallery as tgr
    paths = [(sorted(r.methods), r.path) for r in tgr.router.routes]
    id_route = paths.index((["GET"], f"{GALLERY}/{{gallery_id}}"))
    for lit in ("/share/preview", "/tools", "/library", "/tools/updates/{kind}/{copy_id}",
                "/notes/{note_id}/helpful-prompt"):
        idx = [i for i, (_m, p) in enumerate(paths) if p == GALLERY + lit]
        assert idx and max(idx) < id_route, lit
    assert list(tgr.W11_PATHS) == [p for _m, p in NEW_GALLERY_DOORS]
    as_user(app, MEMBER)
    _official(db)
    r = client.get(f"{GALLERY}/library")
    assert r.status_code == 200 and "templates" in r.json() and "template" not in r.json()


def test_body_over_16kb_and_deep_body_refused(app, client):
    as_user(app, AUTHOR)
    r = _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": "x", "pad": "a" * (16 * 1024)})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "invalid" and _no_store(r)
    deep: dict = {"kind": "widget"}
    node = deep
    for _ in range(17):
        node["n"] = {}
        node = node["n"]
    r = _send(client, "POST", f"{GALLERY}/share/preview", deep)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid"
    ok: dict = {"kind": "widget", "id": "nope"}
    node = ok
    for _ in range(14):                                       # control: 15 levels deep is read (then a 404)
        node["n"] = {}
        node = node["n"]
    assert _send(client, "POST", f"{GALLERY}/share/preview", ok).status_code == 404


# ── errors from classes ───────────────────────────────────────────────────────────────────────────

def test_error_codes_from_classes(app, client, db, monkeypatch):
    as_user(app, MEMBER)

    def raising(e):
        def f(*a, **k):
            raise e
        return f

    nm = share.ShareError("not_yours", gallery.S_CHOICE_NOT_YOURS)
    nm.slot = "p1"
    cases = [
        ("adopt_tool", template_tools.LibraryError(template_tools.S_CHOOSE_ROUTINE), 400, "unresolved", None),
        ("adopt_tool", nm, 400, "not_yours", "p1"),
        ("adopt_tool", gallery.CountCapError("You have 30 trackers."), 409, "count_cap", None),
        ("adopt_tool", gallery.KeyReused(gallery.S_KEY_REUSED), 409, "key_reused", None),     # A9: its own code
        ("adopt_tool", share.ShareError("adopted", "It came from the library."), 400, "adopted", None),
    ]
    for fn, err, status, code, slot in cases:
        monkeypatch.setattr(gallery, fn, raising(err))
        r = _send(client, "POST", f"{GALLERY}/g1/adopt-tool", {})
        assert r.status_code == status and r.json()["detail"]["code"] == code, (code, r.text)
        assert r.json()["detail"]["message"] == err.sentence and _no_store(r)
        assert r.json()["detail"].get("slot") == slot
    monkeypatch.setattr(gallery, "share_preview", raising(share.ShareError("own_words", "Field 1 uses your own words.")))
    r = _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": "w"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "own_words"
    # helpful_days through the EXISTING route: 409 {code, message}; a codeless conflict keeps a plain string
    monkeypatch.setattr(gallery, "set_helpful", raising(gallery.GalleryConflict(gallery.S_HELPFUL_DAYS,
                                                                                 code="helpful_days")))
    r = client.post(f"{GALLERY}/g1/helpful")
    assert r.status_code == 409 and r.json()["detail"] == {"code": "helpful_days", "message": gallery.S_HELPFUL_DAYS}
    monkeypatch.setattr(gallery, "set_helpful", raising(gallery.GalleryConflict("Plain.")))
    r = client.post(f"{GALLERY}/g1/helpful")
    assert r.status_code == 409 and r.json()["detail"] == "Plain."
    assert _no_store(r)                                     # part S m-4: the code-less 409 is no-store too
    monkeypatch.setattr(gallery, "set_helpful", raising(gallery.GalleryError("Plain 400.")))
    r = client.post(f"{GALLERY}/g1/helpful")
    assert r.status_code == 400 and r.json()["detail"] == "Plain 400." and _no_store(r)


def test_unresolved_and_not_yours_end_to_end(app, client, db):
    """No stubs: a listed widget with a pick slot, adopted with no answer, then with another member's account."""
    from tests.test_widget_sources import add_account
    plan = {"v": 1, "source": "closed_trades", "filters": [{"field": "account", "op": "in", "values": ["a-1"]}],
            "measures": [{"key": "trades"}], "range": {"token": "all"}}
    w = widget(db, plan=plan)
    gid = list_tool(db, "widget", w["id"])
    slots = gallery.get_item(MEMBER, gid, conn=db)["payload"]["slots"]
    assert slots, "the listed widget must ask a choice for this rail to mean anything"
    as_user(app, MEMBER)
    r = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "unresolved"
    other = add_account(db, OTHER, "Other's account")
    sid = slots[0]["id"]
    r = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {"answers": {sid: other}})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "not_yours" and r.json()["detail"]["slot"] == sid


# ── rates ─────────────────────────────────────────────────────────────────────────────────────────

def test_preview_and_share_preview_share_the_60_per_hour_scope(app, client, monkeypatch):
    as_user(app, MEMBER)
    from api.services.journal_two import template_preview
    monkeypatch.setattr(gallery, "share_preview", lambda *a, **k: {"travels": {}})
    monkeypatch.setattr(template_preview, "preview_mine", lambda *a, **k: {"cards": []})
    for _ in range(55):
        assert _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": "w"}).status_code == 200
    for _ in range(5):
        assert _send(client, "POST", f"{GALLERY}/g1/preview-mine", {}).status_code == 200
    r = _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": "w"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "rate" and _no_store(r)
    r = _send(client, "POST", f"{GALLERY}/g1/preview-mine", {})
    assert r.status_code == 429


def test_preview_mine_has_its_own_per_member_window(app, client, monkeypatch):
    from api.routers import notebook_template_gallery as tgr
    from api.services.journal_two import template_preview
    as_user(app, MEMBER)
    monkeypatch.setattr(template_preview, "preview_mine", lambda *a, **k: {"cards": []})
    n = int(tgr.PREVIEW_MINE_RATE.split("/")[0])
    for _ in range(n):
        assert _send(client, "POST", f"{GALLERY}/g1/preview-mine", {}).status_code == 200
    assert _send(client, "POST", f"{GALLERY}/g1/preview-mine", {}).status_code == 429
    as_user(app, OTHER)                                        # per member
    assert _send(client, "POST", f"{GALLERY}/g1/preview-mine", {}).status_code == 200


def test_publish_rate_10_per_hour(app, client, monkeypatch):
    as_user(app, AUTHOR)
    monkeypatch.setattr(gallery, "publish_tool", lambda *a, **k: {"id": "g", "title": "T"})
    for _ in range(10):
        assert _send(client, "POST", f"{GALLERY}/tools", {"kind": "widget", "id": "w", "title": "T"}).status_code == 200
    r = _send(client, "POST", f"{GALLERY}/tools", {"kind": "widget", "id": "w", "title": "T"})
    assert r.status_code == 429 and _no_store(r)


# ── no-store, plan ────────────────────────────────────────────────────────────────────────────────

def test_every_response_no_store(app, client, db, monkeypatch):
    as_user(app, MEMBER)
    gid = _official(db)
    s = style(db, uid=MEMBER, name="Mine")
    assert all(_no_store(r) for r in (
        client.get(f"{GALLERY}/library"),
        client.get(f"{GALLERY}/notes/nope/helpful-prompt"),
        _send(client, "POST", f"{GALLERY}/{gid}/preview-mine", {}),
        _send(client, "POST", f"{GALLERY}/{gid}/use-template", {"choices": {"routine_a": {"create": True}}}),
        _send(client, "POST", f"{GALLERY}/{gid}/helpful-prompt", {"answer": "maybe"}),     # 400
        _send(client, "POST", f"{GALLERY}/nope/adopt-tool", {}),                          # 404
        _send(client, "POST", f"{GALLERY}/tools/updates/widget/nope", {}),                # 404
        _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": "nope"}),
        _send(client, "POST", f"{STYLES}/{s['id']}/archive"),
        client.get(f"{STYLES}/{s['id']}/used-in"),
        _send(client, "POST", f"{STYLES}/{s['id']}/delete", {"typedName": "Wrong"}),       # 400
        client.get(f"{STYLES}?view=archived"),
    ))
    r = client.get(f"{GALLERY}/library")
    assert r.status_code == 200


def test_unpaid_402(app, client):
    as_user(app, MEMBER, FREE)
    for method, path in NEW_GALLERY_DOORS:
        r = _send(client, method, GALLERY + _concrete(path), {})
        assert r.status_code == 402 and r.json()["detail"] == PAID_SENTENCE and _no_store(r), path


# ── the library and the cards ─────────────────────────────────────────────────────────────────────

def test_library_lists_by_group_with_in_your_templates(app, client, db):
    late = _official(db, title="Weekend swing review", group="weekly_monthly", template="swing_weekend")
    early = _official(db, title="Night-before prep", group="night_before", template="night_before")
    mid = _official(db, title="Pre-market prep", group="before_open")
    member_style = list_template(db, style(db)["id"])                 # a member's listing is not official
    as_user(app, MEMBER)
    rows = client.get(f"{GALLERY}/library").json()["templates"]
    assert [r["id"] for r in rows] == [early, mid, late]               # GROUPS order, never newest-first
    assert member_style not in [r["id"] for r in rows]
    assert all(r["group"] and r["inYourTemplates"] is False for r in rows)
    body = client.get(f"{GALLERY}/library").json()
    assert body["groups"] == [{"key": k, "label": v} for k, v in template_library.GROUPS]
    assert [r["id"] for r in client.get(f"{GALLERY}/library?group=before_open").json()["templates"]] == [mid]
    bad = client.get(f"{GALLERY}/library?group=nope")
    assert bad.status_code == 400
    assert _send(client, "POST", f"{GALLERY}/{mid}/use-template",
                 {"choices": {"routine_a": {"create": True}}}).status_code == 200
    by_id = {r["id"]: r for r in client.get(f"{GALLERY}/library").json()["templates"]}
    assert by_id[mid]["inYourTemplates"] is True and by_id[early]["inYourTemplates"] is False
    js.archive_style(MEMBER, db.execute("SELECT id FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id"
                                        " = ?", (MEMBER, mid)).fetchone()[0], conn=db)
    by_id = {r["id"]: r for r in client.get(f"{GALLERY}/library").json()["templates"]}
    assert by_id[mid]["inYourTemplates"] is False                      # an archived copy is not a live one


def test_summary_fields_for_cards(app, client, db, monkeypatch):
    gid = _official(db)
    as_user(app, MEMBER)
    card = client.get(f"{GALLERY}/library").json()["templates"][0]
    assert card["contains"] == [template_tools.ROUTINE_TEMPLATES["morning_routine"]["name"]]
    assert card["usedBy"] == 0 and card["updatedAt"] and "credit" not in card
    assert _send(client, "POST", f"{GALLERY}/{gid}/use-template",
                 {"choices": {"routine_a": {"create": True}}}).status_code == 200
    card = client.get(f"{GALLERY}/library").json()["templates"][0]
    assert card["usedBy"] == 1 and card["credit"] == "Based on UCT's Pre-market prep"
    listed = {r["id"]: r for r in client.get(GALLERY).json()["templates"]}
    assert listed[gid]["contains"] and listed[gid]["credit"] == "Based on UCT's Pre-market prep"
    assert client.get(f"{GALLERY}/{gid}").json()["template"]["contains"] == card["contains"]
    # a member-shared template names its inline routine by its shared (typed) name
    r = routine(db)
    src = style(db, blocks=[{"block": "routine_a", "enabled": True,
                             "settings": {"ref": f"routine:{r['id']}", "bind": "note-day"}}])
    shared = list_template(db, src["id"], edits={"blocks": {"routine_a": {"name": "Open checklist",
                                                                          "items": ["Coffee", "Mark levels"]}}})
    listed = {r_["id"]: r_ for r_ in client.get(GALLERY).json()["templates"]}
    assert listed[shared]["contains"] == ["Open checklist"]
    # wave 9 off: a routine is never named (a dark family); wave 11 off: the cards are exactly today's
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 9])
    listed = {r_["id"]: r_ for r_ in client.get(GALLERY).json()["templates"]}
    assert listed[shared]["contains"] == []
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    assert all("contains" not in r_ and "credit" not in r_ for r_ in client.get(GALLERY).json()["templates"])


# ── Review Focus 2 through HTTP, idempotency ──────────────────────────────────────────────────────

def test_two_use_template_requests_at_once(app, db):
    gid = _official(db)
    as_user(app, MEMBER)
    barrier = threading.Barrier(2)
    results, errors = [], []

    def press():
        try:
            c = TestClient(app)
            barrier.wait()
            results.append(_send(c, "POST", f"{GALLERY}/{gid}/use-template",
                                 {"choices": {"routine_a": {"create": True}}}))
        except Exception as e:  # noqa: BLE001 -- the assertion below names it
            errors.append(e)
    threads = [threading.Thread(target=press) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(90)
    assert errors == [] and [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert db.execute("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id = ?",
                      (MEMBER, gid)).fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1
    ids = _routine_ids_in_notes(db)
    assert len(ids) == 2 and len(set(ids)) == 1 and ids[0]
    assert all(r.json()["note"]["id"] for r in results)


def test_idempotency_key_reaches_adopt_tool_and_use(app, client, db):
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits={"name": "Open", "items": ["Coffee", "Mark levels"]})
    as_user(app, MEMBER)
    key = {"Idempotency-Key": str(uuid.uuid4())}
    one = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}, key)
    two = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}, key)
    assert one.status_code == two.status_code == 200 and two.json().get("replayed") is True
    assert two.json()["id"] == one.json()["id"]
    assert db.execute("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 1
    other_key = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}, {"Idempotency-Key": str(uuid.uuid4())})
    assert other_key.json()["id"] != one.json()["id"]                     # a new key is a deliberate re-adopt
    off = _official(db)
    k2 = {"Idempotency-Key": str(uuid.uuid4())}
    a = _send(client, "POST", f"{GALLERY}/{off}/use-template", {"choices": {"routine_a": {"create": True}}}, k2)
    b = _send(client, "POST", f"{GALLERY}/{off}/use-template", {"choices": {"routine_a": {"create": True}}}, k2)
    assert a.json()["note"]["id"] == b.json()["note"]["id"] and b.json().get("replayed") is True
    reused = _send(client, "POST", f"{GALLERY}/{gid}/use-template", {}, key)   # same key, another door
    assert reused.status_code == 404                                        # a tool is not a template listing


def test_listed_title_comes_from_the_reduced_payload(app, client, db):
    w = widget(db)
    as_user(app, AUTHOR)
    r = _send(client, "POST", f"{GALLERY}/tools", {"kind": "widget", "id": w["id"], "title": "Typed title",
                                                  "edits": {"name": "Shared name"}})
    assert r.status_code == 200 and r.json()["template"]["title"] == "Shared name"


def test_share_preview_shape(app, client, db):
    w = widget(db)
    as_user(app, AUTHOR)
    r = _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": w["id"]})
    assert r.status_code == 200
    assert {"travels", "slots", "kept", "notShared", "prefill"} <= set(r.json())
    as_user(app, MEMBER)                                                     # author only
    assert _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": w["id"]}).status_code == 404


def test_styles_publish_passes_edits_and_keep(app, client, db, monkeypatch):
    seen = {}

    def fake(*a, **k):
        seen.update(k)
        return {"id": "g", "droppedProperties": 0, "droppedSlots": 1}
    monkeypatch.setattr(gallery, "publish_style", fake)
    as_user(app, AUTHOR)
    r = _send(client, "POST", f"{GALLERY}/styles", {"styleId": "s", "title": "T", "category": "journal",
                                                   "edits": {"name": "x"}, "keep": ["a"]})
    assert r.status_code == 200 and seen["edits"] == {"name": "x"} and seen["keep"] == ["a"]
    assert r.json()["droppedSlots"] == 1 and _no_store(r)
    seen.clear()
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    r = _send(client, "POST", f"{GALLERY}/styles", {"styleId": "s", "title": "T", "category": "journal",
                                                   "edits": {"name": "x"}})
    assert r.status_code == 200 and "edits" not in seen and "droppedSlots" not in r.json()   # today's route


def test_helpful_prompt_routes(app, client, db):
    as_user(app, MEMBER)
    assert client.get(f"{GALLERY}/notes/nope/helpful-prompt").json() == {"show": False}
    gid = _official(db)
    r = _send(client, "POST", f"{GALLERY}/{gid}/helpful-prompt", {"answer": "maybe"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid"
    r = _send(client, "POST", f"{GALLERY}/{gid}/helpful-prompt", {"answer": "yes"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "helpful_days"


def test_update_tool_unresolved_or_404(app, client, db):
    as_user(app, MEMBER)
    assert _send(client, "POST", f"{GALLERY}/tools/updates/widget/nope", {}).status_code == 404
    assert _send(client, "POST", f"{GALLERY}/tools/updates/bogus/nope", {}).status_code == 404


# ── journal styles (Task 11.13's store) ───────────────────────────────────────────────────────────

def test_view_param_absent_is_unchanged(app, client, db, monkeypatch):
    style(db, uid=MEMBER, name="Mine")
    as_user(app, MEMBER)
    on = client.get(STYLES).json()
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    off = client.get(STYLES).json()
    assert set(on) == {"kinds", "styles", "blockKinds"} and on == off
    assert all("usedIn" not in s and "archivedAt" not in s for s in on["styles"])


def test_archive_routes_404_when_w11_off(app, client, db, monkeypatch):
    s = style(db, uid=MEMBER, name="Mine")
    as_user(app, MEMBER)
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    for method, path in NEW_STYLE_DOORS:
        assert _send(client, method, STYLES + path.replace("{style_id}", s["id"]), {}).status_code == 404, path
    assert client.get(f"{STYLES}?view=live").status_code == 404
    assert js.get_style(MEMBER, s["id"], db)["name"] == "Mine"            # nothing was archived


def test_templates_tab_routes(app, client, db):
    s = style(db, uid=MEMBER, name="Mine")
    as_user(app, MEMBER)
    live = client.get(f"{STYLES}?view=live").json()
    assert set(live) == {"kinds", "styles"}
    row = next(x for x in live["styles"] if x["id"] == s["id"])
    for k in ("usedIn", "credit", "fromLibrary", "updateAvailable", "sourceGalleryId", "archivedAt", "deletedAt"):
        assert k in row, k
    assert client.get(f"{STYLES}?view=bogus").status_code == 400
    assert _send(client, "POST", f"{STYLES}/{s['id']}/delete", {"typedName": "Mine"}).status_code == 400  # live
    a = _send(client, "POST", f"{STYLES}/{s['id']}/archive")
    assert a.status_code == 200 and a.json()["style"]["archivedAt"]
    assert [x["id"] for x in client.get(f"{STYLES}?view=archived").json()["styles"]] == [s["id"]]
    d = _send(client, "POST", f"{STYLES}/{s['id']}/duplicate")
    assert d.status_code == 200 and d.json()["style"]["name"] == "Mine copy"
    assert _send(client, "POST", f"{STYLES}/{s['id']}/delete", {"typedName": "Wrong"}).status_code == 400
    gone = _send(client, "POST", f"{STYLES}/{s['id']}/delete", {"typedName": "Mine"})
    assert gone.status_code == 200 and gone.json()["style"]["deletedAt"]
    assert client.get(f"{STYLES}/{s['id']}/used-in").json() == {"notes": []}
    u = _send(client, "POST", f"{STYLES}/{d.json()['style']['id']}/unarchive")
    assert u.status_code == 200
    as_user(app, OTHER)                                                       # another member's: the 404
    assert _send(client, "POST", f"{STYLES}/{s['id']}/archive").status_code == 404
    assert client.get(f"{STYLES}/{s['id']}/used-in").status_code == 404


# ── My tools rows (carry 8) ───────────────────────────────────────────────────────────────────────

def test_my_tools_rows_carry_library_facts(app, client, db, monkeypatch):
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits={"name": "Open", "items": ["Coffee", "Mark levels"]})
    as_user(app, MEMBER)
    copy = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}).json()
    own = routine(db, uid=MEMBER, name="My own")
    rows = {x["id"]: x for x in client.get("/api/j2/routines").json()["routines"]}
    assert rows[copy["id"]]["sourceGalleryId"] == gid and rows[copy["id"]]["credit"] == "Based on Sam's Open"
    assert rows[copy["id"]]["updateAvailable"] is False
    assert "credit" not in rows[own["id"]] and "updateAvailable" not in rows[own["id"]]
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    rows = {x["id"]: x for x in client.get("/api/j2/routines").json()["routines"]}
    assert "credit" not in rows[copy["id"]] and "updateAvailable" not in rows[copy["id"]]


# -- fix round 1 ------------------------------------------------------------------------------------

@pytest.mark.parametrize("body", [
    {"ticker": "not a ticker!!"}, {"ticker": "A" * 30}, {"title": "x" * 12000},
    {"title": 1}, {"title": True}, {"title": ["a"]}, {"title": {"a": 1}},
    {"ticker": 1}, {"ticker": True}, {"ticker": ["A"]}, {"ticker": {"a": 1}},
])
def test_use_template_refuses_bad_note_fields_with_400(app, client, db, body):
    """I-1: a Use's note fields are checked by the notes module's own rules before any charge: never a 500."""
    gid = _official(db)
    as_user(app, MEMBER)
    r = _send(client, "POST", f"{GALLERY}/{gid}/use-template", {**body, "choices": {"routine_a": {"create": True}}})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid" and _no_store(r), (body, r.text)
    assert db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 0
    ok = _send(client, "POST", f"{GALLERY}/{gid}/use-template",
               {"ticker": "nvda", "title": "Prep", "choices": {"routine_a": {"create": True}}})
    assert ok.status_code == 200 and ok.json()["note"]["ticker"] == "NVDA"               # control


def test_a_note_refusal_from_the_service_is_a_400(app, client, db, monkeypatch):
    from api.services.journal_two import notes as notes_service
    as_user(app, MEMBER)

    def refuse(*a, **k):
        raise notes_service.NoteValidationError("folder not found")
    monkeypatch.setattr(gallery, "use_library_template", refuse)
    r = _send(client, "POST", f"{GALLERY}/g1/use-template", {})
    assert r.status_code == 400 and r.json()["detail"] == {"code": "invalid", "message": "folder not found"}
    assert _no_store(r)


@pytest.mark.parametrize("w11_on", [True, False])
def test_one_charge_rule_in_both_flag_states(app, client, db, monkeypatch, w11_on):
    """I-2: /styles charges through `_charged_publish` and /adopt through `_spend_adopt`, whatever the flag, and the
    wave 11 doors use the same two functions."""
    from api.routers import notebook_template_gallery as tgr
    calls = []
    real_pub, real_adopt = tgr._charged_publish, tgr._spend_adopt
    monkeypatch.setattr(tgr, "_charged_publish", lambda *a, **k: calls.append("publish") or real_pub(*a, **k))
    monkeypatch.setattr(tgr, "_spend_adopt", lambda *a, **k: calls.append("adopt") or real_adopt(*a, **k))
    monkeypatch.setattr(gallery, "publish_style", lambda *a, **k: {"id": "g", "droppedProperties": 0})
    monkeypatch.setattr(gallery, "adopt_style", lambda *a, **k: {"style": {"id": "s"}, "notify": False,
                                                                   "credit": None})
    if not w11_on:
        waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    as_user(app, AUTHOR)
    assert _send(client, "POST", f"{GALLERY}/styles", {"styleId": "s", "title": "T",
                                                      "category": "journal"}).status_code == 200
    assert _send(client, "POST", f"{GALLERY}/g1/adopt", {}).status_code == 200
    assert calls == ["publish", "adopt"]
    if w11_on:
        monkeypatch.setattr(gallery, "publish_tool", lambda *a, **k: {"id": "g"})
        monkeypatch.setattr(gallery, "adopt_tool", lambda *a, **k: {"kind": "routine", "id": "r", "credit": None})
        _send(client, "POST", f"{GALLERY}/tools", {"kind": "widget", "id": "w"})
        _send(client, "POST", f"{GALLERY}/g1/adopt-tool", {})
        assert calls == ["publish", "adopt", "publish", "adopt"]
        for gone in ("_w11_charged", "_publish_charged", "_adopt_charged", "_rate"):
            assert not hasattr(tgr, gone), gone                   # no second copy of a charge or rate rule


def test_preview_429_words_are_the_previews_own(app, client, monkeypatch):
    """m-2: a template or widget preview's 429 never talks about example notes."""
    from api.routers import notebook_template_gallery as tgr
    monkeypatch.setattr(gallery, "share_preview", lambda *a, **k: {"travels": {}})
    as_user(app, MEMBER)
    for _ in range(60):
        _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": "w"})
    r = _send(client, "POST", f"{GALLERY}/share/preview", {"kind": "widget", "id": "w"})
    assert r.status_code == 429 and r.json()["detail"]["message"] == tgr.W11_PREVIEW_RATE_SENTENCE
    assert "example" not in r.json()["detail"]["message"]


def test_styles_and_adopt_read_wave_11_bodies_through_the_wave_11_reader(app, client, monkeypatch):
    """m-8: while wave 11 is on, /styles and /adopt take at most 16 KB and depth 16; off, the old reader."""
    monkeypatch.setattr(gallery, "publish_style", lambda *a, **k: {"id": "g", "droppedProperties": 0})
    as_user(app, AUTHOR)
    big = {"styleId": "s", "title": "T", "category": "journal", "pad": "a" * (20 * 1024)}
    r = _send(client, "POST", f"{GALLERY}/styles", big)
    assert r.status_code == 413 and _no_store(r)
    deep: dict = {}
    node = deep
    for _ in range(30):
        node["n"] = {}
        node = node["n"]
    assert _send(client, "POST", f"{GALLERY}/g1/adopt", {"answers": deep}).status_code == 400
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    assert _send(client, "POST", f"{GALLERY}/styles", big).status_code == 200          # the old 256 KB reader


def test_library_reads_the_list_once(app, client, db, monkeypatch):
    """m-6: one list read for /library across every group, still in GROUPS order."""
    _official(db, title="Weekend swing review", group="weekly_monthly", template="swing_weekend")
    _official(db, title="Night-before prep", group="night_before", template="night_before")
    seen = []
    real = gallery.list_gallery
    monkeypatch.setattr(gallery, "list_gallery", lambda *a, **k: seen.append(k) or real(*a, **k))
    as_user(app, MEMBER)
    rows = client.get(f"{GALLERY}/library").json()["templates"]
    assert len(seen) == 1 and [r["group"] for r in rows] == ["night_before", "weekly_monthly"]


def test_journal_styles_402_and_restore_are_no_store(app, client, db):
    """m-1: the journal-styles router's 402 and the Templates tab's restore carry no-store."""
    s = style(db, uid=MEMBER, name="Mine")
    as_user(app, MEMBER, FREE)
    r = _send(client, "POST", f"{STYLES}/{s['id']}/archive")
    assert r.status_code == 402 and _no_store(r)
    as_user(app, MEMBER)
    js.delete_style(MEMBER, s["id"], db)
    r = _send(client, "POST", f"{STYLES}/{s['id']}/restore")
    assert r.status_code == 200 and _no_store(r)


# -- fix round 2 ------------------------------------------------------------------------------------

#: n-2: every route the two routers had BEFORE wave 11 (recorded from the base routers, `3e72cf1a1f`), as
#: (method, full path). Any route outside this set is a wave 11 door and must carry the wave 11 gate.
PRE_W11_ROUTES = frozenset({
    ("DELETE", "/api/j2/template-gallery/authors/{handle}/follow"), ("DELETE", "/api/j2/template-gallery/{gallery_id}"),
    ("DELETE", "/api/j2/template-gallery/{gallery_id}/helpful"), ("GET", "/api/j2/template-gallery"),
    ("GET", "/api/j2/template-gallery/admin/queue"), ("GET", "/api/j2/template-gallery/authors/{handle}"),
    ("GET", "/api/j2/template-gallery/feed"), ("GET", "/api/j2/template-gallery/layouts/status"),
    ("GET", "/api/j2/template-gallery/updates"), ("GET", "/api/j2/template-gallery/updates/{style_id}"),
    ("GET", "/api/j2/template-gallery/{gallery_id}"), ("GET", "/api/j2/template-gallery/{gallery_id}/images/{n}"),
    ("PATCH", "/api/j2/template-gallery/admin/items/{gallery_id}"),
    ("PATCH", "/api/j2/template-gallery/admin/reports/{report_id}"), ("POST", "/api/j2/template-gallery"),
    ("POST", "/api/j2/template-gallery/authors/{handle}/follow"), ("POST", "/api/j2/template-gallery/examples"),
    ("POST", "/api/j2/template-gallery/examples/preview"), ("POST", "/api/j2/template-gallery/layouts"),
    ("POST", "/api/j2/template-gallery/styles"), ("POST", "/api/j2/template-gallery/updates/{style_id}"),
    ("POST", "/api/j2/template-gallery/{gallery_id}/adopt"), ("POST", "/api/j2/template-gallery/{gallery_id}/adopt-layout"),
    ("POST", "/api/j2/template-gallery/{gallery_id}/helpful"), ("POST", "/api/j2/template-gallery/{gallery_id}/report"),
    ("POST", "/api/j2/template-gallery/{gallery_id}/use"),
    ("DELETE", "/api/j2/journal-styles/{style_id}"), ("DELETE", "/api/j2/note-kinds/{kind_id}"),
    ("GET", "/api/j2/journal-styles"), ("GET", "/api/j2/journal-styles/{style_id}"), ("GET", "/api/j2/note-kinds"),
    ("GET", "/api/j2/note-kinds/mapping-offer"), ("GET", "/api/j2/notes/{note_id}/style-update-plan"),
    ("GET", "/api/j2/trader-blocks/market-context"), ("GET", "/api/j2/trader-blocks/prep/{part}"),
    ("GET", "/api/j2/trader-blocks/review/trades"), ("GET", "/api/j2/trader-blocks/review/{trade_key}"),
    ("GET", "/api/j2/trader-blocks/rules/{rule_id}/before-after"), ("GET", "/api/j2/trader-blocks/rules/{rule_id}/versions"),
    ("POST", "/api/j2/journal-styles"), ("POST", "/api/j2/journal-styles/preview"),
    ("POST", "/api/j2/journal-styles/starter-packs/{pack}"), ("POST", "/api/j2/journal-styles/{style_id}/default"),
    ("POST", "/api/j2/journal-styles/{style_id}/restore"), ("POST", "/api/j2/note-kinds"),
    ("POST", "/api/j2/note-kinds/mapping-offer"), ("POST", "/api/j2/notes/{note_id}/apply-style-update"),
    ("POST", "/api/j2/trader-blocks/price-stamp"), ("PUT", "/api/j2/journal-styles/{style_id}"),
    ("PUT", "/api/j2/note-kinds/{kind_id}"), ("PUT", "/api/j2/trader-blocks/positions/{position_id}/pre-entry"),
    ("PUT", "/api/j2/trader-blocks/rules/{rule_id}"),
})


def _route_set():
    from api.routers import notebook_journal_styles, notebook_template_gallery
    return [(m, r.path) for router in (notebook_template_gallery.router, notebook_journal_styles.router)
            for r in router.routes for m in r.methods]


def _unrecorded_ungated(routes, gated):
    return sorted(set(routes) - PRE_W11_ROUTES - gated)


def test_every_route_outside_the_pre_wave_11_set_carries_the_gate():
    """n-2: a new route the routers gain is a wave 11 door, so it must carry `_require_w11`. The recorded set is the
    routers' routes before wave 11; nothing new may be ungated, whatever the typed list says."""
    routes = _route_set()
    gated = {(m, p) for m, p, _g, _pre in _gate_routes()}
    assert PRE_W11_ROUTES <= set(routes), sorted(PRE_W11_ROUTES - set(routes))      # the record is current
    assert len(set(routes) - PRE_W11_ROUTES) >= 14                                    # non-vacuity: the new doors
    assert _unrecorded_ungated(routes, gated) == []
    # control: an ungated new door (or one gated by the wrong dependency) is seen
    fake = routes + [("POST", "/api/j2/template-gallery/zz-new-w11-door")]
    assert _unrecorded_ungated(fake, gated) == [("POST", "/api/j2/template-gallery/zz-new-w11-door")]


SURROGATE = "\\ud800"                   # a lone surrogate, as `JSON.stringify` sends a broken pair


def _raw(client, url, text):
    return client.post(url, content=text.encode("utf-8"), headers={"Content-Type": "application/json"})


@pytest.mark.parametrize("w11_on", [True, False])
def test_a_lone_surrogate_is_a_400_on_every_door(app, client, db, monkeypatch, w11_on):
    """I-A: a lone surrogate never reaches SQLite: the body readers refuse it once, 400 + no-store, with the reducer's
    own sentence. A valid astral character (an emoji) still goes through."""
    from api.services.journal_two import widget_request_body as wbody
    from api.services.journal_two.widget_engine import share as share_mod
    gid = _official(db)
    s = style(db, uid=MEMBER, name="Mine")
    if not w11_on:
        waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    as_user(app, MEMBER)
    u = SURROGATE
    cases = [
        (f"{GALLERY}/styles", '{"styleId": "%s", "title": "T", "category": "journal"}' % u),
        (f"{GALLERY}/{gid}/adopt", '{"choices": {"routine_a": {"use": "%s"}}}' % u),
        (f"{STYLES}", '{"name": "%s", "kindId": "weekend_prep"}' % u),
    ]
    if w11_on:
        cases += [
            (f"{STYLES}/{s['id']}/delete", '{"typedName": "%s"}' % u),
            (f"{GALLERY}/share/preview", '{"kind": "widget", "id": "%s"}' % u),
            (f"{GALLERY}/tools", '{"kind": "routine", "id": "%s", "title": "T"}' % u),
            (f"{GALLERY}/{gid}/use-template", '{"title": "%s", "choices": {"routine_a": {"create": true}}}' % u),
            (f"{GALLERY}/{gid}/use-template", '{"choices": {"routine_a": {"use": "%s"}}}' % u),
            (f"{GALLERY}/{gid}/preview-mine", '{"answers": {"p1": "%s"}}' % u),
            (f"{GALLERY}/{gid}/adopt-tool", '{"answers": {"%s": 1}}' % u),               # a KEY, too
            (f"{GALLERY}/{gid}/helpful-prompt", '{"answer": "%s"}' % u),
        ]
    for url, text in cases:
        r = _raw(client, url, text)
        assert r.status_code == 400 and _no_store(r), (url, r.status_code, r.text)
        detail = r.json()["detail"]
        msg = detail["message"] if isinstance(detail, dict) else detail
        assert msg == share_mod.S_BAD_CHARACTER == wbody.bad_character_sentence(), (url, detail)
    assert db.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (MEMBER,)).fetchone()[0] == 0
    # control: a valid astral character is accepted where text is stored
    ok = _raw(client, f"{STYLES}", '{"name": "Prep \\ud83d\\ude00", "kindId": "weekend_prep"}')
    assert ok.status_code == 200 and ok.json()["style"]["name"].endswith("\U0001F600")
    if w11_on:
        ok = _raw(client, f"{GALLERY}/{gid}/use-template",
                  '{"title": "Prep \\ud83d\\ude00", "choices": {"routine_a": {"create": true}}}')
        assert ok.status_code == 200 and ok.json()["note"]["title"].endswith("\U0001F600")


def test_adopt_notify_refusal_is_the_wave_11_shape(app, client, db, monkeypatch):
    """n-3: with wave 11 on, /adopt's own notify check answers `{code, message}` + no-store; off, today's string."""
    gid = _official(db)
    as_user(app, MEMBER)
    r = _send(client, "POST", f"{GALLERY}/{gid}/adopt", {"notify": "yes"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid" and _no_store(r)
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    r = _send(client, "POST", f"{GALLERY}/{gid}/adopt", {"notify": "yes"})
    assert r.status_code == 400 and r.json()["detail"] == "notify must be true or false"


def test_journal_styles_unreadable_body_is_no_store(app, client, db):
    """n-3: the journal-styles reader's 422 carries no-store (the delete door reads through it)."""
    s = style(db, uid=MEMBER, name="Mine")
    as_user(app, MEMBER)
    r = _raw(client, f"{STYLES}/{s['id']}/delete", "[1, 2]")
    assert r.status_code == 422 and _no_store(r)


# ── A9: a reused key and a key in flight answer two different codes ───────────────────────────────

def test_a_key_spent_on_another_item_is_key_reused_and_a_key_in_flight_is_conflict(app, client, db, monkeypatch):
    """F-ALIAS-1 A9 (W9-R14: no client reads a sentence): the same Idempotency-Key sent for a DIFFERENT item is
    409 `key_reused` -- a definite refusal -- while the same key still on its way for the SAME item stays 409
    `conflict`. Real doors and real keys; only the in-flight twin's wait is cut short (it never lands)."""
    as_user(app, MEMBER)
    first = list_tool(db, "widget", widget(db)["id"])
    other = list_tool(db, "widget", widget(db, name="Other")["id"])
    answers = {"answers": {"p1": "Flag"}}
    key = str(uuid.uuid4())
    made = _send(client, "POST", f"{GALLERY}/{first}/adopt-tool", answers, headers={gallery.IDEMPOTENCY_HEADER: key})
    assert made.status_code == 200, made.text
    reused = _send(client, "POST", f"{GALLERY}/{other}/adopt-tool", answers, headers={gallery.IDEMPOTENCY_HEADER: key})
    assert reused.status_code == 409 and _no_store(reused), reused.text
    assert reused.json()["detail"] == {"code": gallery.KEY_REUSED_CODE, "message": gallery.S_KEY_REUSED}
    assert gallery.KEY_REUSED_CODE == "key_reused"
    # the in-flight refusal: a fresh "" reservation of a Use (a twin request still making the note) that never lands
    from datetime import datetime, timezone
    tid = list_template(db, style(db)["id"])
    pending = str(uuid.uuid4())
    db.execute("INSERT INTO j2_tool_create_keys (user_id, key, kind, source_id, new_id, created_at)"
               " VALUES (?, ?, 'gallery_use_template', ?, '', ?)",
               (MEMBER, pending, tid, datetime.now(timezone.utc).isoformat()))
    db.commit()
    monkeypatch.setattr(gallery, "_wait_for_key", lambda *a, **k: None)
    busy = _send(client, "POST", f"{GALLERY}/{tid}/use-template", {}, headers={gallery.IDEMPOTENCY_HEADER: pending})
    assert busy.status_code == 409, busy.text
    assert busy.json()["detail"] == {"code": "conflict", "message": gallery.S_KEY_IN_FLIGHT}
    assert busy.json()["detail"]["code"] != reused.json()["detail"]["code"]


def test_a_second_use_does_not_ask_the_routine_question_again(app, client, db):
    # 11.20 rehearsal R2 / spec §10: "asks once per slot ... the choice is remembered for that template". The first
    # Use answers the routine question and remembers it on the member's copy; the next preview of the SAME listed
    # template asks nothing for that slot (it read the listing, and a cached first answer, before), and the next Use
    # places the remembered routine.
    gid = _official(db)
    as_user(app, MEMBER)
    first = _send(client, "POST", f"{GALLERY}/{gid}/preview-mine", {})
    assert first.status_code == 200
    assert [q["slot"] for q in first.json()["questions"]] == ["routine_a"]          # non-vacuity: asked the first time
    one = _send(client, "POST", f"{GALLERY}/{gid}/use-template", {"choices": {"routine_a": {"create": True}}})
    assert one.status_code == 200
    again = _send(client, "POST", f"{GALLERY}/{gid}/preview-mine", {})
    assert again.status_code == 200
    assert again.json()["questions"] == []
    two = _send(client, "POST", f"{GALLERY}/{gid}/use-template", {})
    assert two.status_code == 200
    ids = _routine_ids_in_notes(db)
    assert len(ids) == 2 and len(set(ids)) == 1 and ids[0]                          # the remembered routine, twice
    # CONTROL: another member who never used it is still asked.
    as_user(app, OTHER)
    other = _send(client, "POST", f"{GALLERY}/{gid}/preview-mine", {})
    assert [q["slot"] for q in other.json()["questions"]] == ["routine_a"]


def _hold_write_lock():
    """Another writer holding auth.db's write lock (a second connection inside BEGIN IMMEDIATE)."""
    import sqlite3
    from api.services import auth_db
    holder = sqlite3.connect(auth_db._DB_PATH, isolation_level=None)
    holder.execute("BEGIN IMMEDIATE")
    return holder


def test_a_busy_database_is_the_busy_answer_never_a_500_on_adopt_and_use(app, client, db):
    # 11.20 rehearsal R1: adopt-tool answered 500 with an unhandled `sqlite3.OperationalError: database is locked`
    # while another writer held the lock past auth.db's 3 s. Through the REAL doors, with a real held lock: the
    # member gets 503 `busy` with the house sentence (no-store, a code the client resends the same key on), nothing
    # is made, and the same press succeeds once the lock is gone.
    from api.routers import notebook_template_gallery as tgr
    from api.services import daily_counters
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits={"name": "Open", "items": ["Coffee", "Mark levels"]})
    off = _official(db)
    as_user(app, MEMBER)
    before = db.execute("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?", (MEMBER,)).fetchone()[0]
    key = {"Idempotency-Key": str(uuid.uuid4())}
    holder = _hold_write_lock()
    try:
        got = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}, key)
        used = _send(client, "POST", f"{GALLERY}/{off}/use-template", {"choices": {"routine_a": {"create": True}}})
    finally:
        holder.rollback()
        holder.close()
    for resp in (got, used):
        assert resp.status_code == 503
        assert resp.json()["detail"] == {"code": "busy", "message": tgr.DATABASE_BUSY_SENTENCE}
        assert _no_store(resp)
    assert db.execute("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?", (MEMBER,)).fetchone()[0] == before
    from api.services.journal_two.calendar import et_today
    assert daily_counters.value(et_today(), tgr.DAILY_ADOPT_SCOPE, MEMBER) == 0       # no adopt charge kept
    again = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}, key)            # the same press, lock gone
    assert again.status_code == 200 and not again.json().get("replayed")


def _real_operational_error(sql: str):
    """A REAL sqlite3.OperationalError (with its `sqlite_errorcode`), raised by SQLite itself."""
    import sqlite3
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE t (a)")
    try:
        c.execute(sql)
    except sqlite3.OperationalError as e:
        return e
    finally:
        c.close()
    raise AssertionError(f"{sql!r} did not fail")


@pytest.mark.parametrize("sql, words", [
    ("SELECT locked FROM t", "no such column: locked"),
    ("SELECT * FROM j2_user_blocked", "no such table: j2_user_blocked"),
    ("blocked", 'near "blocked": syntax error'),
    ("SELECT * FROM j2_routines", "no such table: j2_routines"),
])
def test_an_operational_error_that_is_not_busy_is_not_dressed_as_busy(app, client, db, monkeypatch, sql, words):
    # CONTROL (W11-R75): only SQLite's own BUSY/LOCKED result codes are the busy answer. A schema fault whose words
    # carry a lock word -- `j2_notes` really has a column named `locked` -- stays a server fault, never `busy`.
    import sqlite3
    err = _real_operational_error(sql)
    assert str(err) == words and err.sqlite_errorcode == sqlite3.SQLITE_ERROR       # non-vacuity: real, not busy
    monkeypatch.setattr(gallery, "adopt_tool", lambda *a, **k: (_ for _ in ()).throw(err))
    as_user(app, MEMBER)
    with pytest.raises(sqlite3.OperationalError):
        _send(client, "POST", f"{GALLERY}/g1/adopt-tool", {})


@pytest.mark.parametrize("code, busy", [(5, True), (6, True), (517, True), (262, True), (1, False), (11, False)])
def test_busy_is_the_base_result_code_extended_codes_included(code, busy):
    # W11-R75: SQLITE_BUSY (5), SQLITE_LOCKED (6) and their extended codes (BUSY_SNAPSHOT 517, LOCKED_SHAREDCACHE
    # 262; base code in the low byte) are busy; SQLITE_ERROR (1) and CORRUPT (11) are not, whatever the words say.
    import sqlite3
    from api.routers import notebook_template_gallery as tgr
    e = sqlite3.OperationalError("database is locked" if not busy else "no such column: x")
    e.sqlite_errorcode = code
    assert tgr._database_busy(e) is busy
    assert tgr._database_busy(sqlite3.OperationalError("database is locked")) is False   # no code: not SQLite's


def test_a_busy_adopt_gives_back_the_charge_it_really_took(app, client, db, monkeypatch):
    # Review I-2: the charge must be TAKEN first (the lock is free while `_spend_adopt` charges), then the adopt meets
    # a held lock, then the lock is released before the refund runs. A refund that never ran leaves 1.
    from api.routers import notebook_template_gallery as tgr
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits={"name": "Open", "items": ["Coffee", "Mark levels"]})
    as_user(app, MEMBER)
    real = gallery.adopt_tool
    seen = {}

    def adopt_under_a_held_lock(*a, **k):
        seen["charged"] = daily_counters.value(et_today(), tgr.DAILY_ADOPT_SCOPE, MEMBER)
        holder = _hold_write_lock()
        try:
            return real(*a, **k)
        finally:
            holder.rollback()
            holder.close()
    monkeypatch.setattr(gallery, "adopt_tool", adopt_under_a_held_lock)
    got = _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {})
    assert got.status_code == 503 and got.json()["detail"]["code"] == "busy"
    assert seen["charged"] == 1                                    # non-vacuity: the charge was really taken
    assert daily_counters.value(et_today(), tgr.DAILY_ADOPT_SCOPE, MEMBER) == 0
    # CONTROL: an adopt that succeeds keeps its charge.
    monkeypatch.setattr(gallery, "adopt_tool", real)
    assert _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}).status_code == 200
    assert daily_counters.value(et_today(), tgr.DAILY_ADOPT_SCOPE, MEMBER) == 1


def test_a_take_that_failed_open_is_never_given_back(app, client, db, monkeypatch):
    # Review m-2: a take that FAILED OPEN charged nothing, so a refusal after it must refund nothing -- otherwise it
    # cancels an earlier, legitimate adopt's charge.
    from api.routers import notebook_template_gallery as tgr
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    r = routine(db)
    gid = list_tool(db, "routine", r["id"], edits={"name": "Open", "items": ["Coffee", "Mark levels"]})
    as_user(app, MEMBER)
    assert _send(client, "POST", f"{GALLERY}/{gid}/adopt-tool", {}).status_code == 200
    assert daily_counters.value(et_today(), tgr.DAILY_ADOPT_SCOPE, MEMBER) == 1       # one legitimate charge
    real_connect = daily_counters._connect
    calls = {"n": 0}

    def fail_the_take_once():
        calls["n"] += 1
        if calls["n"] == 1:
            raise daily_counters.sqlite3.OperationalError("simulated: the counter store is unreachable")
        return real_connect()
    monkeypatch.setattr(daily_counters, "_connect", fail_the_take_once)
    assert _send(client, "POST", f"{GALLERY}/nope/adopt-tool", {}).status_code == 404      # refused after the take
    monkeypatch.setattr(daily_counters, "_connect", real_connect)
    assert calls["n"] >= 1
    assert daily_counters.value(et_today(), tgr.DAILY_ADOPT_SCOPE, MEMBER) == 1


def _real_busy_error():
    """A REAL SQLITE_BUSY: a second connection asks for the write lock another one holds, with no wait."""
    import sqlite3
    from api.services import auth_db
    holder = _hold_write_lock()
    c = sqlite3.connect(auth_db._DB_PATH, timeout=0, isolation_level=None)
    try:
        c.execute("BEGIN IMMEDIATE")
    except sqlite3.OperationalError as e:
        return e
    finally:
        c.close()
        holder.rollback()
        holder.close()
    raise AssertionError("the lock was granted")


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_the_helpful_doors_answer_busy_never_a_500(app, client, db, monkeypatch, method):
    # Review m-4: POST and DELETE /{id}/helpful (W11-R8's 409 helpful_days lives here) write outside `_w11`.
    import sqlite3
    from api.routers import notebook_template_gallery as tgr
    err = _real_busy_error()
    assert err.sqlite_errorcode == sqlite3.SQLITE_BUSY                               # non-vacuity: SQLite's own
    monkeypatch.setattr(gallery, "set_helpful", lambda *a, **k: (_ for _ in ()).throw(err))
    as_user(app, MEMBER)
    url = f"{GALLERY}/g1/helpful"
    resp = client.post(url) if method == "POST" else client.delete(url)
    assert resp.status_code == 503
    assert resp.json()["detail"] == {"code": "busy", "message": tgr.DATABASE_BUSY_SENTENCE}
    assert _no_store(resp)
