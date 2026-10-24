"""Task 9.6: `/api/j2/routines` and `/api/j2/trackers` (dark behind `NOTEBOOK_WIDGETS_W9_ENABLED`).

`require_paid` is NEVER overridden here -- only what it reads -- so the real gate decides. The stores
are real, on a temp auth.db built by `auth_db.init_db`; nothing here reaches `C:\\data`. The clock is
pinned by patching each store's `_now` for calls that pass no `now` (the router never passes one),
so no test is a function of the hour.
"""
from __future__ import annotations

import ast
import importlib
import inspect
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.notebook_routines as nr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import routine_insights as rinsights
from api.services.journal_two import routine_days
from api.services.journal_two import routines as rstore
from api.services.journal_two import trackers as tstore

UID = "u-nr-me"
OTHER = "u-nr-other"
PAID = {"id": UID, "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": UID, "email": "free@example.test", "role": "member", "plan": "free"}
RB = "/api/j2/routines"
TB = "/api/j2/trackers"
#: Wednesday 2026-11-04, noon ET. The write window is 2026-10-26 .. 2026-11-05.
NOW = datetime(2026, 11, 4, 17, 0, tzinfo=timezone.utc)
TODAY = "2026-11-04"

#: The routes the briefs name: 16 routine routes + 13 tracker routes (9.6, plus 9.7's two vs-pnl).
BRIEF_ROUTES = 29

ITEMS = [{"text": "Read the wire"}, {"text": "Set max loss"}]
EVERY = {"kind": "every"}


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    for store in (rstore, tstore, rinsights):
        real = store._now
        monkeypatch.setattr(store, "_now", lambda now=None, _r=real: _r(now or NOW))
    from api.limiter import limiter
    limiter.reset()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    yield
    limiter.reset()
    importlib.reload(auth_db)


def _client(user=PAID):
    app = FastAPI()
    app.include_router(nr.routines_router)
    app.include_router(nr.trackers_router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _code(r):
    return r.json()["detail"]["code"]


def _routes():
    out = []
    for router in (nr.routines_router, nr.trackers_router):
        for r in router.routes:
            for m in sorted(r.methods):
                out.append((m, r.path))
    return out


def _concrete(path: str) -> str:
    return (path.replace("{rid}", "some-id").replace("{tid}", "some-id")
            .replace("{day}", TODAY).replace("{item_id}", "it"))


def _routine(c, **kw):
    body = {"name": kw.pop("name", "Morning"), "items": kw.pop("items", ITEMS),
            "schedule": kw.pop("schedule", EVERY), **kw}
    r = c.post(RB, json=body)
    assert r.status_code == 200, r.json()
    return r.json()


def _tracker(c, **kw):
    r = c.post(TB, json={"name": kw.pop("name", "Sleep"), "kind": kw.pop("kind", "number"), **kw})
    assert r.status_code == 200, r.json()
    return r.json()


def _note_with(embeds, user_id=UID, title="Day"):
    from api.services.journal_two import notes
    body = {"type": "doc", "content": [
        {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": w, "embedId": f"e-{i}", "mode": "snapshot",
                                           "params": {key: tid, "day": TODAY}, "searchText": "[" + w + "]"}}
        for i, (w, key, tid) in enumerate(embeds)]}
    return notes.create_note(user_id, {"title": title, "bodyJson": body})


def test_used_in_lists_notes():
    from api.services.journal_two import notes
    c = _client()
    one, t = _routine(c), _tracker(c)
    assert c.get(f"{RB}/{one['id']}/used-in").json() == {"notes": []}
    assert c.get(f"{TB}/{t['id']}/used-in").json() == {"notes": []}
    n1 = _note_with([("routine", "routineId", one["id"]), ("routine", "routineId", one["id"]),
                     ("tracker", "trackerId", t["id"])], title="Monday")
    n2 = _note_with([("routine", "routineId", one["id"])], title="Tuesday")
    # another member's note naming my ids never shows up, and mine never shows for them
    _note_with([("routine", "routineId", one["id"]), ("tracker", "trackerId", t["id"])],
               user_id=OTHER, title="Theirs")
    r = c.get(f"{RB}/{one['id']}/used-in")
    assert r.status_code == 200 and "no-store" in r.headers["cache-control"]
    got = r.json()["notes"]
    assert {x["noteId"]: x["title"] for x in got} == {n1["id"]: "Monday", n2["id"]: "Tuesday"}
    assert len(got) == 2, "a note that places the routine twice is listed once"
    assert all(x["updatedAt"] for x in got)
    assert [x["noteId"] for x in c.get(f"{TB}/{t['id']}/used-in").json()["notes"]] == [n1["id"]]
    assert c.get(f"{RB}/{one['id']}").json()["usedIn"] == 2
    assert c.get(f"{TB}/{t['id']}").json()["usedIn"] == 1
    assert c.get(RB).json()["routines"][0]["usedIn"] == 2
    # a trashed note drops out of the list
    notes.delete_note(UID, n2["id"])
    assert [x["noteId"] for x in c.get(f"{RB}/{one['id']}/used-in").json()["notes"]] == [n1["id"]]
    # the other member sees none of them: my id is absent for them (the public 404)
    assert _client({**PAID, "id": OTHER}).get(f"{RB}/{one['id']}/used-in").status_code == 404


# -- dark, flag, paid ----------------------------------------------------------------------------

def test_all_routes_404_when_w9_off(monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED", raising=False)
    routes = _routes()
    assert len(routes) >= 25 and len(routes) == BRIEF_ROUTES, routes   # non-vacuity
    want = public.not_found().detail
    oversized = json.dumps({"name": "x" * (nr.MAX_BODY + 10)}).encode()
    bodies = {                                                  # dark wins over every body shape
        "empty": dict(json={}),
        "oversized": dict(content=oversized, headers={"content-type": "application/json"}),
        "malformed": dict(content=b"{not json", headers={"content-type": "application/json"}),
        "chunked": dict(content=iter([b'{"name": "', b"x" * (nr.MAX_BODY + 10), b'"}'])),
    }
    for user in (PAID, FREE, None):                             # dark first, whoever is asking
        c = _client(user)
        for method, path in routes:
            for label, kw in bodies.items():
                if label == "chunked":                          # a generator is single-use
                    kw = dict(content=iter([b'{"name": "', b"x" * (nr.MAX_BODY + 10), b'"}']))
                r = c.request(method, _concrete(path), **kw)
                assert r.status_code == 404, (method, path, user, label, r.status_code)
                assert r.json() == {"detail": want}, (method, path, label)
                assert "no-store" in r.headers["cache-control"], (method, path, label)


def test_flag_read_per_request(monkeypatch):
    c = _client()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "0")
    assert c.get(RB + "/starters").status_code == 404
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    assert c.get(RB + "/starters").status_code == 200
    assert c.get(TB).status_code == 200
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED")
    assert c.get(RB + "/starters").status_code == 404
    assert c.get(TB).status_code == 404


def test_unpaid_402_own_sentence():
    c = _client(FREE)
    routes = _routes()
    assert len(routes) == BRIEF_ROUTES
    for method, path in routes:
        r = c.request(method, _concrete(path), json={})
        assert r.status_code == 402, (method, path)
        assert r.json()["detail"] == "Routines and trackers require a paid plan"
        assert r.headers["cache-control"] == "no-store", (method, path)
    assert _client(None).get(RB + "/starters").status_code in (401, 403)


# -- routing -------------------------------------------------------------------------------------

def test_literal_paths_beat_the_id_route():
    c = _client()
    r = c.get(RB + "/starters")
    assert r.status_code == 200
    assert [s["key"] for s in r.json()["starters"]] == [s["key"] for s in rstore.starters()]
    one = _routine(c)
    r = c.post(RB + "/days", json={"ids": [one["id"]], "days": [TODAY]})
    assert r.status_code == 200 and list(r.json()["routines"]) == [one["id"]]
    assert c.get(RB + "/import-day-rules").json() == {"labels": []}
    t = _tracker(c)
    r = c.post(TB + "/days", json={"ids": [t["id"], "checkin:mood"], "days": [TODAY]})
    assert r.status_code == 200 and set(r.json()["trackers"]) == {t["id"], "checkin:mood"}
    # the built-in id is a path segment the tracker routes accept
    assert c.get(TB + "/checkin:mood").json()["readOnly"] is True
    assert c.get(TB + "/checkin:focus").status_code == 200


# -- ticks, skips, logs --------------------------------------------------------------------------

def test_tick_and_skip_return_the_merged_day():
    c = _client()
    one = _routine(c)
    a, b = (i["id"] for i in one["items"])
    r = c.put(f"{RB}/{one['id']}/days/{TODAY}/items/{a}", json={"ticked": True})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    want = rstore.read_days(UID, [one["id"]], [TODAY])["routines"][one["id"]]["days"][TODAY]
    assert r.json() == want
    # a second item merges into the same day (no If-Match on ticks)
    r2 = c.put(f"{RB}/{one['id']}/days/{TODAY}/items/{b}", json={"ticked": True})
    assert r2.status_code == 200
    assert r2.json() == rstore.read_days(UID, [one["id"]], [TODAY])["routines"][one["id"]]["days"][TODAY]
    assert r2.json() != r.json()
    s = c.put(f"{RB}/{one['id']}/days/{TODAY}", json={"skipped": True})
    assert s.status_code == 200
    assert s.json() == rstore.read_days(UID, [one["id"]], [TODAY])["routines"][one["id"]]["days"][TODAY]
    bad = c.put(f"{RB}/{one['id']}/days/{TODAY}/items/{a}", json={"ticked": "yes"})
    assert bad.status_code == 400 and bad.json()["detail"] == {
        "code": "invalid", "message": rstore.S_BAD_TICK}
    t = _tracker(c, unit="h")
    lg = c.put(f"{TB}/{t['id']}/days/{TODAY}", json={"value": 7.5})
    assert lg.status_code == 200 and lg.json()["day"] == TODAY and lg.json()["value"] == 7.5
    assert c.put(f"{TB}/{t['id']}/days/{TODAY}", json={"value": None}).json()["value"] is None
    assert _code(c.put(f"{TB}/{t['id']}/days/{TODAY}", json={})) == "invalid"
    ro = c.put(f"{TB}/checkin:mood/days/{TODAY}", json={"value": 3})
    assert ro.status_code == 409 and ro.json()["detail"] == {
        "code": "read_only", "message": tstore.S_READ_ONLY}
    # M2: a built-in is read-only whatever the body, an empty one included
    ro = c.put(f"{TB}/checkin:focus/days/{TODAY}", json={})
    assert ro.status_code == 409 and _code(ro) == "read_only"


def test_window_400_code_and_sentence():
    c = _client()
    one = _routine(c)
    a = one["items"][0]["id"]
    want = {"code": "window", "message": "Ticks can be added up to 7 trading days back."}
    assert routine_days.S_WINDOW == want["message"]
    r = c.put(f"{RB}/{one['id']}/days/2026-10-23/items/{a}", json={"ticked": True})
    assert r.status_code == 400 and r.json()["detail"] == want
    r = c.put(f"{RB}/{one['id']}/days/2026-11-06", json={"skipped": True})   # past the next session
    assert r.status_code == 400 and r.json()["detail"] == want
    t = _tracker(c)
    r = c.put(f"{TB}/{t['id']}/days/2026-10-23", json={"value": 1})
    assert r.status_code == 400 and r.json()["detail"] == want
    # a body cannot choose its own clock
    r = c.put(f"{RB}/{one['id']}/days/2026-10-23/items/{a}",
              json={"ticked": True, "now": "2026-10-23T17:00:00Z"})
    assert r.status_code == 400 and r.json()["detail"] == want


def _store_calls_offending(source: str) -> tuple[int, list[str]]:
    """(store calls seen, the ones that pass `now=` or any `**mapping`). A `**` keyword is refused
    outright: whatever it unpacks could carry `now` from a request body."""
    tree = ast.parse(source)
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name)
             and n.func.value.id in ("rstore", "tstore", "rinsights")]
    bad = [ast.unparse(n) for n in calls
           if any(k.arg is None or k.arg == "now" for k in n.keywords)]
    return len(calls), bad


def test_router_never_passes_now_to_a_store():
    src = Path(inspect.getsourcefile(nr)).read_text(encoding="utf-8")
    seen, bad = _store_calls_offending(src)
    assert seen >= 27, seen                                     # non-vacuity: the store calls are seen
    assert bad == []
    # the two vs-pnl calls are among those seen (9.7)
    assert _store_calls_offending(src.replace("rinsights.", "other."))[0] == seen - 2


def test_the_now_rail_catches_a_planted_now_and_a_planted_body_splat():
    planted = "\n".join([
        "def a(uid, body):",
        "    return rstore.create(uid, **body)",
        "def b(uid, body):",
        "    return tstore.set_value(uid, 't', 'd', 1, now=body.get('now'))",
        "def c(uid, extra):",
        "    return tstore.update(uid, 't', if_match=1, **extra)",
        "def ok(uid, body):",
        "    return rstore.get(uid, body.get('id'))",
        ""])
    seen, bad = _store_calls_offending(planted)
    assert seen == 4
    assert bad == ["rstore.create(uid, **body)",
                   "tstore.set_value(uid, 't', 'd', 1, now=body.get('now'))",
                   "tstore.update(uid, 't', if_match=1, **extra)"]


def test_foreign_id_404_and_absent_from_days():
    mine = _client()
    theirs = _client({**PAID, "id": OTHER})
    one = _routine(theirs)
    t = _tracker(theirs)
    a = one["items"][0]["id"]
    want = {"detail": public.not_found().detail}
    for method, path, body in [
        ("GET", f"{RB}/{one['id']}", None),
        ("PUT", f"{RB}/{one['id']}", {"name": "Mine now"}),
        ("POST", f"{RB}/{one['id']}/archive", {}),
        ("POST", f"{RB}/{one['id']}/duplicate", {}),
        ("PUT", f"{RB}/{one['id']}/days/{TODAY}/items/{a}", {"ticked": True}),
        ("PUT", f"{RB}/{one['id']}/days/{TODAY}", {"skipped": True}),
        ("GET", f"{RB}/{one['id']}/used-in", None),
        ("GET", f"{TB}/{t['id']}", None),
        ("PUT", f"{TB}/{t['id']}", {"name": "x"}),
        ("POST", f"{TB}/{t['id']}/archive", {}),
        ("PUT", f"{TB}/{t['id']}/days/{TODAY}", {"value": 1}),
        ("GET", f"{TB}/{t['id']}/used-in", None),
        ("GET", f"{RB}/no-such-id", None),
    ]:
        r = mine.request(method, path, json=body, headers={"If-Match": "1"})
        assert r.status_code == 404 and r.json() == want, (method, path, r.status_code)
    # with NO If-Match a foreign id is still the 404, never the 428 (that would confirm it exists)
    for path in (f"{RB}/{one['id']}", f"{TB}/{t['id']}"):
        r = mine.put(path, json={"name": "x"})
        assert r.status_code == 404 and r.json() == want, path
    assert mine.post(RB + "/days", json={"ids": [one["id"]], "days": [TODAY]}).json()["routines"] == {}
    assert mine.post(TB + "/days", json={"ids": [t["id"]], "days": [TODAY]}).json()["trackers"] == {}
    # nothing was written to the other member's rows
    assert rstore.get(OTHER, one["id"])["name"] == "Morning"
    assert rstore.get(OTHER, one["id"])["archived"] is False


def test_put_requires_if_match_428_and_409_on_stale():
    c = _client()
    one = _routine(c)
    r = c.put(f"{RB}/{one['id']}", json={"name": "Evening"})
    assert r.status_code == 428 and r.json()["detail"] == {
        "code": "conflict", "message": "Reload to see the newer version."}
    ok = c.put(f"{RB}/{one['id']}", json={"name": "Evening"}, headers={"If-Match": str(one["etag"])})
    assert ok.status_code == 200 and ok.json()["name"] == "Evening" and ok.json()["etag"] == one["etag"] + 1
    stale = c.put(f"{RB}/{one['id']}", json={"name": "Night"}, headers={"If-Match": str(one["etag"])})
    assert stale.status_code == 409 and stale.json()["detail"] == {
        "code": "conflict", "message": "Changed in another tab. Reload to see the newer version."}
    assert _code(c.put(f"{RB}/{one['id']}", json={}, headers={"If-Match": "abc"})) == "conflict"
    t = _tracker(c)
    assert c.put(f"{TB}/{t['id']}", json={"name": "Nap"}).status_code == 428
    ok = c.put(f"{TB}/{t['id']}", json={"name": "Nap"}, headers={"If-Match": str(t["etag"])})
    assert ok.status_code == 200 and ok.json()["name"] == "Nap"
    assert c.put(f"{TB}/{t['id']}", json={"name": "x"},
                 headers={"If-Match": str(t["etag"])}).status_code == 409
    # an archived routine is read-only: 409 `read_only`, the store's own status (W9-R14)
    a = c.post(f"{RB}/{one['id']}/archive").json()
    ro = c.put(f"{RB}/{one['id']}", json={"name": "Z"}, headers={"If-Match": str(a["etag"])})
    assert ro.status_code == 409 and ro.json()["detail"] == {
        "code": "read_only", "message": rstore.S_ARCHIVED}
    # a built-in tracker answers read_only with or without If-Match
    assert _code(c.put(f"{TB}/checkin:mood", json={"name": "x"})) == "read_only"


def test_count_cap_409_code():
    c = _client()
    for i in range(rstore.COUNT_CAP):
        rstore.create(UID, name=f"R{i}", items=ITEMS, schedule=EVERY)
    r = c.post(RB, json={"name": "One more", "items": ITEMS, "schedule": EVERY})
    assert r.status_code == 409 and r.json()["detail"] == {"code": "count_cap", "message": rstore.S_CAP}
    for i in range(tstore.COUNT_CAP):
        tstore.create(UID, name=f"T{i}", kind="number")
    r = c.post(TB, json={"name": "One more", "kind": "number"})
    assert r.status_code == 409 and r.json()["detail"] == {"code": "count_cap", "message": tstore.S_CAP}
    # an ordinary refusal keeps the store's own 400 `invalid`
    r = c.post(TB, json={"name": "", "kind": "number"})
    assert r.status_code == 400 and r.json()["detail"] == {"code": "invalid", "message": tstore.S_BAD_NAME}


def test_body_over_8kb_refused_and_deep_body_refused():
    c = _client()
    big = {"name": "x" * (nr.MAX_BODY + 10), "items": ITEMS, "schedule": EVERY}
    r = c.post(RB, json=big)
    assert r.status_code == 413 and r.json()["detail"] == {
        "code": "invalid", "message": "That is too much to send at once."}
    deep: dict = {}
    cur = deep
    for _ in range(nr.MAX_BODY_DEPTH + 2):
        cur["a"] = {}
        cur = cur["a"]
    r = c.post(RB, json={"name": "x", "items": ITEMS, "schedule": EVERY, "settings": deep})
    assert r.status_code == 400 and r.json()["detail"] == {
        "code": "invalid", "message": "That request couldn't be read."}
    r = c.post(TB, content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 400 and _code(r) == "invalid"
    # a chunked body (no Content-Length) is bounded too
    r = c.post(RB, content=iter([b'{"name": "', b"x" * (nr.MAX_BODY + 10), b'"}']))
    assert r.status_code == 413
    assert nr.MAX_BODY == 8 * 1024 and nr.MAX_BODY_DEPTH == 16


def test_write_rate_120_and_read_rate_60_separate_scopes(monkeypatch):
    assert (nr.WRITE_RATE, nr.SCOPE_WRITE) == ("120/minute", "notebook-routine-writes")
    assert (nr.READ_RATE, nr.SCOPE_READ) == ("60/minute", "notebook-routine-reads")
    monkeypatch.setattr(rstore, "archive", lambda uid, rid: {"id": rid})
    monkeypatch.setattr(tstore, "archive", lambda uid, tid: {"id": tid})
    c = _client()
    for i in range(120):                                        # writes across BOTH routers share
        base = RB if i % 2 else TB
        assert c.post(f"{base}/x/archive").status_code == 200, i
    r = c.post(f"{RB}/x/archive")
    assert r.status_code == 429 and r.json()["detail"] == {
        "code": "rate", "message": "Too many changes in a minute. Try again shortly."}
    monkeypatch.setattr(rstore, "get", lambda uid, rid: {"id": rid})
    monkeypatch.setattr(rstore, "import_day_rules", lambda uid: [])
    reads = [lambda: c.get(RB + "/starters"),
             lambda: c.post(RB + "/days", json={"ids": [], "days": []}),
             lambda: c.get(RB + "/x"),
             lambda: c.get(RB + "/x/used-in"),
             lambda: c.get(RB + "/import-day-rules")]
    for i in range(60):                                         # the read scope is its own
        r = reads[i % len(reads)]()
        assert r.status_code == 200, (i, r.request.url)
    for probe in reads:                                         # every read route is on the read scope
        r = probe()
        assert r.status_code == 429 and _code(r) == "rate", r.request.url
    r = c.post(TB + "/days", json={"ids": [], "days": []})      # POST /days is a read
    assert r.status_code == 429 and r.json()["detail"] == {
        "code": "rate", "message": "Too many reads in a minute. Try again shortly."}
    assert c.get(TB).status_code == 429
    # another member has their own budget
    assert _client({**PAID, "id": OTHER}).get(RB + "/starters").status_code == 200


def test_every_200_is_no_store():
    c = _client()
    one = _routine(c)
    t = _tracker(c)
    checks = [
        c.get(RB), c.get(RB + "/starters"), c.get(RB + "/import-day-rules"),
        c.post(RB + "/days", json={"ids": [one["id"]], "days": ["today"]}),
        c.get(f"{RB}/{one['id']}"), c.get(f"{RB}/{one['id']}/used-in"),
        c.post(f"{RB}/{one['id']}/duplicate"),
        c.get(TB), c.get(f"{TB}/{t['id']}"), c.get(f"{TB}/{t['id']}/used-in"),
        c.post(f"{TB}/{t['id']}/duplicate"),
    ]
    for r in checks:
        assert r.status_code == 200, r.request.url
        assert r.headers["cache-control"] == "no-store", r.request.url
    assert c.get(f"{RB}/{one['id']}/used-in").json() == {"notes": []}
    # lifecycle through the router
    a = c.post(f"{RB}/{one['id']}/archive").json()
    assert a["archived"] is True
    assert _code(c.post(f"{RB}/{one['id']}/delete", json={"typedName": "nope"})) == "invalid"
    d = c.post(f"{RB}/{one['id']}/delete", json={"typedName": "Morning"})
    assert d.status_code == 200 and d.headers["cache-control"] == "no-store"
    assert [x["id"] for x in c.get(RB + "?filter=deleted").json()["routines"]] == [one["id"]]
    assert c.post(f"{RB}/{one['id']}/undelete").json()["archived"] is True
    assert c.post(f"{RB}/{one['id']}/unarchive").json()["archived"] is False
    assert _code(c.get(RB + "?filter=bogus")) == "invalid"


def test_no_note_route_touched(monkeypatch):
    from api.services.journal_two import notes
    calls = []
    names = [n for n, f in vars(notes).items() if callable(f) and not n.startswith("_")
             and n.split("_")[0] in ("create", "update", "delete", "restore", "set", "patch",
                                     "save", "put")]
    assert {"create_note", "update_note", "delete_note"} <= set(names)   # non-vacuity
    for n in names:
        monkeypatch.setattr(notes, n, lambda *a, _n=n, **k: calls.append(_n))
    c = _client()
    one = _routine(c)
    a = one["items"][0]["id"]
    t = _tracker(c)
    assert c.put(f"{RB}/{one['id']}/days/{TODAY}/items/{a}", json={"ticked": True}).status_code == 200
    assert c.put(f"{RB}/{one['id']}/days/{TODAY}", json={"skipped": True}).status_code == 200
    assert c.put(f"{TB}/{t['id']}/days/{TODAY}", json={"value": 2}).status_code == 200
    assert calls == []


def test_template_key_create_restores_the_stored_row():
    """W9-R12, through the router: the sent fields are ignored when a deleted row is restored."""
    c = _client()
    one = _routine(c, sourceTemplateKey="eod")
    c.post(f"{RB}/{one['id']}/archive")
    assert c.post(f"{RB}/{one['id']}/delete", json={"typedName": "Morning"}).status_code == 200
    again = _routine(c, name="Different", sourceTemplateKey="eod")
    assert again["id"] == one["id"] and again["name"] == "Morning" and again["archived"] is False


def test_a_parser_RecursionError_is_400_invalid(monkeypatch):
    """Python 3.12 (production) can raise RecursionError out of json.loads on a deep body before
    the depth check sees it; the router must answer 400 `invalid`, never a 500."""
    def boom(*a, **k):
        raise RecursionError("maximum recursion depth exceeded")
    import types                       # a shim for THIS module only: the client still decodes JSON
    monkeypatch.setattr(nr, "json", types.SimpleNamespace(loads=boom))
    c = _client()
    for r in (c.post(RB, json={"name": "x"}),
              c.post(TB + "/days", json={"ids": [], "days": []})):
        assert r.status_code == 400 and r.json()["detail"] == {
            "code": "invalid", "message": "That request couldn't be read."}
        assert r.headers["cache-control"] == "no-store"


def test_my_own_soft_deleted_id_is_the_404():
    c = _client()
    one = _routine(c)
    a = one["items"][0]["id"]
    c.post(f"{RB}/{one['id']}/archive")
    assert c.post(f"{RB}/{one['id']}/delete", json={"typedName": "Morning"}).status_code == 200
    t = _tracker(c)
    c.post(f"{TB}/{t['id']}/archive")
    assert c.post(f"{TB}/{t['id']}/delete", json={"typedName": "Sleep"}).status_code == 200
    want = {"detail": public.not_found().detail}
    for method, path, body, hdr in [
        ("GET", f"{RB}/{one['id']}", None, {}),
        ("PUT", f"{RB}/{one['id']}", {"name": "x"}, {"If-Match": str(one["etag"])}),
        ("PUT", f"{RB}/{one['id']}", {"name": "x"}, {}),
        ("PUT", f"{RB}/{one['id']}/days/{TODAY}/items/{a}", {"ticked": True}, {}),
        ("PUT", f"{RB}/{one['id']}/days/{TODAY}", {"skipped": True}, {}),
        ("GET", f"{RB}/{one['id']}/used-in", None, {}),
        ("GET", f"{TB}/{t['id']}", None, {}),
        ("PUT", f"{TB}/{t['id']}", {"name": "x"}, {}),
        ("PUT", f"{TB}/{t['id']}/days/{TODAY}", {"value": 1}, {}),
        ("GET", f"{TB}/{t['id']}/used-in", None, {}),
    ]:
        r = c.request(method, path, json=body, headers=hdr)
        assert r.status_code == 404 and r.json() == want, (method, path, r.status_code)
    # and it is still there to bring back
    assert c.post(f"{RB}/{one['id']}/undelete").status_code == 200


def test_every_refusal_is_no_store(monkeypatch):
    c = _client()
    one = _routine(c)
    a = one["items"][0]["id"]
    refusals = {
        400: c.put(f"{RB}/{one['id']}/days/{TODAY}/items/{a}", json={"ticked": "yes"}),
        404: c.get(f"{RB}/no-such-id"),
        409: c.put(f"{RB}/{one['id']}", json={}, headers={"If-Match": "*"}),
        413: c.post(RB, json={"name": "x" * (nr.MAX_BODY + 10)}),
        428: c.put(f"{RB}/{one['id']}", json={}),
        402: _client(FREE).get(RB + "/starters"),
    }
    for _ in range(120):                                       # spend the write budget
        c.post(f"{RB}/no-such-id/archive")
    refusals[429] = c.post(f"{RB}/no-such-id/archive")
    for status, r in refusals.items():
        assert r.status_code == status, (status, r.status_code, r.text)
        assert "no-store" in r.headers.get("cache-control", ""), status
    # M4: `If-Match: *` is a stale tab, never "any version"
    assert refusals[409].json()["detail"] == {"code": "conflict", "message": rstore.S_CONFLICT}


# -- vs P&L (Task 9.7) -----------------------------------------------------------------------------

def test_vs_pnl_routes_read_scope_and_404_foreign(monkeypatch):
    c = _client()
    one = _routine(c)
    t = _tracker(c)
    spent = []
    monkeypatch.setattr(nr, "_read_rate", lambda uid: spent.append(("read", uid)))
    monkeypatch.setattr(nr, "_write_rate", lambda uid: spent.append(("write", uid)))
    r = c.get(f"{RB}/{one['id']}/vs-pnl")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert set(body) == {"done", "other", "winRate", "sentence"}
    assert body["sentence"] == "No days with trades yet. A comparison, not proof."
    r = c.get(f"{TB}/{t['id']}/vs-pnl")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert set(r.json()) == {"buckets", "sentence"}
    assert r.json()["sentence"].endswith(rinsights.CAVEAT)
    assert c.get(f"{TB}/checkin:mood/vs-pnl").status_code == 200
    assert spent == [("read", UID)] * 3                         # the read scope, never the write
    # someone else's routine and tracker are the public 404, as are unknown ids
    theirs = rstore.create(OTHER, name="Theirs", items=ITEMS, schedule=EVERY, now=NOW)
    their_t = tstore.create(OTHER, name="Theirs", kind="number", now=NOW)
    want = {"detail": public.not_found().detail}
    for path in (f"{RB}/{theirs['id']}/vs-pnl", f"{TB}/{their_t['id']}/vs-pnl",
                 f"{RB}/nope/vs-pnl", f"{TB}/nope/vs-pnl"):
        r = c.get(path)
        assert r.status_code == 404 and r.json() == want, path
        assert "no-store" in r.headers["cache-control"], path
    # unpaid: the router's own 402
    r = _client(FREE).get(f"{RB}/{one['id']}/vs-pnl")
    assert r.status_code == 402
