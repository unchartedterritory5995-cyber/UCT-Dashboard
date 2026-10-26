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

def _new_routes(app):
    """(method, path-after-prefix) of every route of the two routers that is one of the recorded new doors."""
    from api.routers import notebook_journal_styles, notebook_template_gallery
    found = []
    for router, prefix, doors in ((notebook_template_gallery.router, GALLERY, NEW_GALLERY_DOORS),
                                  (notebook_journal_styles.router, STYLES, NEW_STYLE_DOORS)):
        for r in router.routes:
            for m in r.methods:
                if r.path.startswith(prefix) and (m, r.path[len(prefix):]) in doors:
                    found.append((m, r.path, router is notebook_template_gallery.router))
    return found


def test_every_new_route_404_when_w11_off(app, client, monkeypatch):
    found = _new_routes(app)
    assert len(found) >= 12 and len(found) == len(NEW_GALLERY_DOORS) + len(NEW_STYLE_DOORS), found   # non-vacuity
    as_user(app, MEMBER)
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
    huge = {"x": "a" * (40 * 1024)}                     # a body the door would refuse: the gate answers first
    for method, path, is_gallery in found:
        r = _send(client, method, _concrete(path), huge)
        assert r.status_code == 404, (method, path, r.status_code, r.text)
        assert _no_store(r), (method, path)
    # wave 11 on, the library switch off: every gallery door is still the 404 (journal styles do not need it)
    waves(monkeypatch, *ALL_WAVES)
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    for method, path, is_gallery in found:
        if is_gallery:
            assert _send(client, method, _concrete(path), huge).status_code == 404, (method, path)
    # control: both on, the gate lets a door through
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    assert client.get(f"{GALLERY}/library").status_code == 200


def test_flag_read_per_request(app, client, monkeypatch):
    as_user(app, MEMBER)
    assert client.get(f"{GALLERY}/library").status_code == 200
    waves(monkeypatch, *[w for w in ALL_WAVES if w != 11])
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
        ("adopt_tool", gallery.KeyReused(gallery.S_KEY_REUSED), 409, "conflict", None),
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
