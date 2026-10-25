"""Task 8.11: `/api/j2/widget-definitions` (dark behind `NOTEBOOK_WIDGETS_W8_ENABLED`).

`require_paid` is NEVER overridden here -- only what it reads -- so the real gate decides. The store and
the engine are real, on a temp sqlite file seeded through `auth_db.init_db` (the Task 8.5 fixtures in
`tests.test_widget_sources`); nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.notebook_widget_definitions as wdr
import api.routers.notebook_widgets as nwr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import widget_definitions as wdefs
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run as wrun
from api.services.journal_two.widget_engine import shelf as wshelf
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_account, add_trade, add_user, conn, raw_plan,
)

OTHER = "u-wdr-other"
PAID = {"id": UID, "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": UID, "email": "free@example.test", "role": "member", "plan": "free"}
BASE = "/api/j2/widget-definitions"

#: The routes the brief names (run, preview, examples, drill, vocabulary, shelf, list, create, get,
#: put, archive, unarchive, delete, undelete, used-in, revs, name a rev, restore a rev).
BRIEF_ROUTES = 18


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    from api.limiter import limiter
    limiter.reset()
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-wdr-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    wrun._reset_state()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W8_ENABLED", "1")
    yield
    wrun._reset_state()
    limiter.reset()


def _client(user=PAID):
    app = FastAPI()
    app.include_router(wdr.router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _plan(**kw):
    return raw_plan(range={"token": "last_30d"}, **kw)


def _code(r):
    return r.json()["detail"]["code"]


def _concrete(path: str) -> str:
    return path.replace("{def_id}", "some-id").replace("{rev}", "1")


def _routes():
    out = []
    for r in wdr.router.routes:
        for m in sorted(r.methods):
            out.append((m, r.path))
    return out


# -- dark, flag, paid ----------------------------------------------------------------------------

def test_all_routes_404_when_w8_off(conn, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W8_ENABLED", raising=False)
    routes = _routes()
    assert len(routes) >= BRIEF_ROUTES, routes                 # non-vacuity: the router mounts them all
    want = public.not_found().detail
    for user in (PAID, FREE, None):                             # dark first, whoever is asking
        c = _client(user)
        for method, path in routes:
            r = c.request(method, _concrete(path), json={})
            assert r.status_code == 404, (method, path, user, r.status_code)
            assert r.json() == {"detail": want}, (method, path)


def test_flag_read_per_request(conn, monkeypatch):
    c = _client()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W8_ENABLED", "0")
    assert c.get(BASE + "/shelf").status_code == 404
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W8_ENABLED", "1")
    assert c.get(BASE + "/shelf").status_code == 200
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W8_ENABLED")
    assert c.get(BASE + "/shelf").status_code == 404


def test_unpaid_402_own_sentence(conn):
    c = _client(FREE)
    for method, path in _routes():
        r = c.request(method, _concrete(path), json={})
        assert r.status_code == 402, (method, path)
        assert r.json()["detail"] == "Built widgets require a paid plan"
        assert r.headers["cache-control"] == "no-store", (method, path)      # a refusal is not cached
    assert "Built widgets require a paid plan" != "Notebook widgets require a paid plan"
    assert _client(None).get(BASE + "/shelf").status_code in (401, 403)


def test_every_200_is_no_store(conn):
    r = _client().get(BASE + "/shelf")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert {e["id"] for e in r.json()["examples"]} == {e["id"] for e in wshelf.examples()}


# -- runs ----------------------------------------------------------------------------------------

def test_run_saved_and_frozen_and_shelf(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    saved = wdefs.create(UID, "Mine", _plan(measures=("trades",)))
    c = _client()
    r = c.post(BASE + "/run", json={"defId": saved["id"], "defRev": 1, "settings": {}})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    p = r.json()
    assert p["defId"] == saved["id"] and p["defRev"] == 1 and p["latestRev"] == 1
    assert p["notice"] is None

    frozen = c.post(BASE + "/run", json={"def": _plan(), "settings": {}}).json()
    assert frozen["defId"] is None and frozen["notice"] == wdr.S_FROZEN

    ex = wshelf.examples()[0]
    s = c.post(BASE + "/run", json={"defId": ex["id"], "settings": {}})
    assert s.status_code == 200 and s.json()["defId"] is None and s.json()["notice"] != wdr.S_FROZEN

    gone = c.post(BASE + "/run", json={"defId": "nope", "settings": {}})
    assert gone.status_code == 400 and _code(gone) == "invalid"


def test_run_foreign_def_id_runs_frozen_with_notice(conn):
    add_user(conn, OTHER)
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    theirs = wdefs.create(OTHER, "Theirs", _plan(measures=("trades",)))
    r = _client().post(BASE + "/run", json={"defId": theirs["id"], "defRev": 1,
                                            "def": _plan(measures=("net_pnl",)), "settings": {}})
    assert r.status_code == 200
    p = r.json()
    assert p["defId"] is None and p["defRev"] is None
    assert p["notice"] == "Running from the saved copy in this note."
    assert [m["label"] for m in p["measures"]] != [m["label"] for m in wrun.run_plan(
        UID, _plan(measures=("trades",)), {}, lane="drill")["measures"]]


def test_preview_rate_120_scope_separate_from_run_60(conn, monkeypatch):
    monkeypatch.setattr(wrun, "run_plan", lambda *a, **k: {"notice": None})
    monkeypatch.setattr(wdr, "_wants_sample", lambda uid: False)
    c = _client()
    for i in range(120):
        assert c.post(BASE + "/preview", json={"plan": _plan()}).status_code == 200, i
    r = c.post(BASE + "/preview", json={"plan": _plan()})
    assert r.status_code == 429 and r.json()["detail"] == {
        "code": "rate_preview", "message": "Pausing the preview for a moment; your changes are kept."}
    for i in range(60):                                         # the run scope is its own
        assert c.post(BASE + "/run", json={"def": _plan()}).status_code == 200, i
    r = c.post(BASE + "/run", json={"def": _plan()})
    assert r.status_code == 429 and r.json()["detail"] == {
        "code": "rate", "message": "Too many refreshes in a minute. Try again shortly."}     # R-28: spec 5.10
    assert c.post(BASE + "/drill", json={"def": _plan()}).status_code == 429   # drill shares it


def test_preview_answers_sample_and_default_name(conn):
    r = _client().post(BASE + "/preview", json={"plan": _plan(measures=("trades",))})
    assert r.status_code == 200
    p = r.json()
    assert p["sample"] is True                                   # fewer than 5 closed trades
    assert p["defaultName"] == wplan.default_name(
        wplan.validate_plan(_plan(measures=("trades",)), wrun.wsources.CATALOG), wrun.wsources.CATALOG)


def test_examples_counts_one_preview(conn, monkeypatch):
    seen = []
    monkeypatch.setattr(wrun, "run_examples", lambda uid, ids: seen.append(ids) or {"cards": {}})
    monkeypatch.setattr(wrun, "run_plan", lambda *a, **k: {"notice": None})
    monkeypatch.setattr(wdr, "_wants_sample", lambda uid: False)
    c = _client()
    ids = [e["id"] for e in wshelf.examples()[:8]]
    for _ in range(119):
        assert c.post(BASE + "/preview", json={"plan": _plan()}).status_code == 200
    assert c.post(BASE + "/examples", json={"ids": ids}).status_code == 200     # the 120th hit
    assert seen == [ids]
    assert _code(c.post(BASE + "/preview", json={"plan": _plan()})) == "rate_preview"
    assert _code(c.post(BASE + "/examples", json={"ids": ids})) == "rate_preview"


# -- drill ---------------------------------------------------------------------------------------

def test_drill_40_and_more(conn):
    for i in range(45):
        add_trade(conn, UID, day=f"2026-10-{1 + i % 20:02d}", commit=False)
    conn.commit()
    r = _client().post(BASE + "/drill", json={"def": raw_plan(), "cell": {}})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    out = r.json()
    assert len(out["rows"]) == 40 and out["more"] == 5
    assert out["notice"] == wdr.S_FROZEN


def test_drill_live_note_when_count_differs(conn):
    for d in ("2026-10-20", "2026-10-21"):
        add_trade(conn, UID, day=d)
    saved = wdefs.create(UID, "Mine", raw_plan())
    c = _client()
    out = c.post(BASE + "/drill", json={"defId": saved["id"], "cell": {}, "snapshotCount": 1,
                                        "snapshotAt": "2026-10-20T20:00:00Z"}).json()
    assert out["live"] is True and out["note"] == "Live data; the snapshot was taken on Oct 20"
    assert "notice" not in out
    same = c.post(BASE + "/drill", json={"defId": saved["id"], "cell": {}, "snapshotCount": 2}).json()
    assert same["live"] is False and same["note"] is None


def test_drill_never_returns_other_members_trades(conn):
    add_user(conn, OTHER)
    mine = add_trade(conn, UID, day="2026-10-20", symbol="MINE")
    add_trade(conn, OTHER, day="2026-10-20", symbol="THEIRS")
    theirs_def = wdefs.create(OTHER, "Theirs", raw_plan())
    out = _client().post(BASE + "/drill", json={"defId": theirs_def["id"], "def": raw_plan(),
                                                "cell": {}}).json()
    assert [r["id"] for r in out["rows"]] == [mine]
    assert out["notice"] == wdr.S_FROZEN


def test_drill_bad_cell_is_invalid(conn):
    r = _client().post(BASE + "/drill", json={"def": raw_plan(), "cell": {"label": 5}})
    assert r.status_code == 400 and _code(r) == "invalid"


# -- vocabulary ----------------------------------------------------------------------------------

def test_vocabulary_whitelist_refuses_unknown_field(conn):
    add_user(conn, OTHER)
    add_trade(conn, UID, day="2026-10-20", setup="Mine Setup", symbol="AAA", mistakes=["FOMO"])
    add_trade(conn, OTHER, day="2026-10-20", setup="Their Setup", symbol="ZZZ", mistakes=["Theirs"])
    acc = add_account(conn, UID, "Swing")
    c = _client()
    static = c.get(BASE + "/vocabulary").json()
    assert {s["key"] for s in static["sources"]} == {"closed_trades", "open_positions", "trading_days"}
    assert any(f["key"] == "setup" and f["split"] for f in static["sources"][0]["fields"])
    assert {"label", "theme", "meaning", "unit", "kind", "needs"} <= set(static["measures"][0])
    assert any(r["token"] == "last_90d" and r["label"] == "last 90 days" for r in static["ranges"])

    for bad in ("notes", "password_hash", "user_id", "setup; DROP TABLE j2_trades"):
        r = c.get(BASE + "/vocabulary", params={"field": bad})
        assert r.status_code == 400 and _code(r) == "invalid", bad
    assert c.get(BASE + "/vocabulary", params={"field": "setup"}).json()["values"] == ["Mine Setup"]
    assert c.get(BASE + "/vocabulary", params={"field": "symbol"}).json()["values"] == ["AAA"]
    assert c.get(BASE + "/vocabulary", params={"field": "mistake"}).json()["values"] == ["FOMO"]
    assert c.get(BASE + "/vocabulary", params={"field": "account"}).json()["values"] == [
        {"id": acc, "name": "Swing"}]


def test_filter_values_never_in_query_string():
    """Every member-value route is a POST; a GET takes only `field` (/vocabulary) or `view` (the list)."""
    gets = 0
    for r in wdr.router.routes:
        names = {p.name for p in r.dependant.query_params}
        if "GET" in r.methods:
            gets += 1
            allowed = {"/api/j2/widget-definitions/vocabulary": {"field"},
                       "/api/j2/widget-definitions": {"view"}}.get(r.path, set())
            assert names <= allowed, (r.path, names)
        else:
            assert not names, (r.path, names)
    assert gets >= 6
    run_like = {r.path: r.methods for r in wdr.router.routes
                if r.path.rsplit("/", 1)[-1] in ("run", "preview", "examples", "drill")}
    assert len(run_like) == 4 and all(m == {"POST"} for m in run_like.values())


# -- the member's widgets --------------------------------------------------------------------------

def test_put_requires_if_match_and_409_on_stale(conn):
    saved = wdefs.create(UID, "Mine", raw_plan())
    c = _client()
    url = f"{BASE}/{saved['id']}"
    r = c.put(url, json={"name": "New", "apply": "only"})
    assert r.status_code == 428 and r.json()["detail"] == {
        "code": "conflict", "message": "Reload to see the newer version."}         # ruling R-27
    r = c.put(url, json={"name": "New", "apply": "only"}, headers={"If-Match": str(saved["etag"] + 5)})
    assert r.status_code == 409 and r.json()["detail"] == {
        "code": "conflict", "message": "Changed in another tab. Reload to see the newer version."}
    ok = c.put(url, json={"name": "New", "apply": "only"}, headers={"If-Match": f'"{saved["etag"]}"'})
    assert ok.status_code == 200 and ok.json()["name"] == "New"
    assert ok.json()["etag"] == saved["etag"] + 1
    stale = c.put(url, json={"name": "Again", "apply": "only"}, headers={"If-Match": str(saved["etag"])})
    assert stale.status_code == 409 and _code(stale) == "conflict"
    # restore takes If-Match too
    r = c.post(f"{url}/revs/1/restore")
    assert r.status_code == 428 and _code(r) == "conflict"
    assert _code(c.post(f"{url}/revs/1/restore", headers={"If-Match": "0"})) == "conflict"
    rest = c.post(f"{url}/revs/1/restore", headers={"If-Match": str(ok.json()["etag"])})
    assert rest.status_code == 200 and rest.json()["rev"] > ok.json()["rev"]


def test_too_new_409_code(conn):
    saved = wdefs.create(UID, "Mine", raw_plan())
    newer = dict(raw_plan(), v=wplan.PLAN_VERSION + 1)
    conn.execute("UPDATE j2_widget_definitions SET plan_json = ?, plan_version = ? WHERE id = ?",
                 (json.dumps(newer), wplan.PLAN_VERSION + 1, saved["id"]))
    conn.execute("UPDATE j2_widget_definition_revs SET plan_json = ? WHERE definition_id = ?",
                 (json.dumps(newer), saved["id"]))
    conn.commit()
    c = _client()
    r = c.put(f"{BASE}/{saved['id']}", json={"name": "x", "apply": "only"},
              headers={"If-Match": str(saved["etag"])})
    assert r.status_code == 409 and r.json()["detail"] == {"code": "too_new", "message": wplan.S_TOO_NEW}
    r = c.post(BASE + "/run", json={"def": newer})
    assert r.status_code == 409 and _code(r) == "too_new"
    r = c.post(BASE + "/run", json={"defId": saved["id"]})
    assert r.status_code == 409 and _code(r) == "too_new"


@pytest.mark.parametrize("exc,status,code,message", [
    (wrun.EngineBusy(), 503, "busy", wrun.BUSY),
    (wrun.EngineTooLong(), 503, "too_long", wrun.TOO_LONG),
    (wrun.DailyCapReached(), 429, "daily_cap",
     "You have refreshed widgets a lot today. Snapshots stay; refreshing resumes tomorrow."),
    (wrun.Superseded(), 409, "superseded", wdr.S_SUPERSEDED),
    (wplan.PlanError(wplan.S_NO_MEASURE), 400, "invalid", wplan.S_NO_MEASURE),
])
def test_engine_errors_map_to_their_codes(conn, monkeypatch, exc, status, code, message):
    def boom(*a, **k):
        raise exc
    monkeypatch.setattr(wrun, "run_plan", boom)
    r = _client().post(BASE + "/run", json={"def": raw_plan()})
    assert r.status_code == status and r.json() == {"detail": {"code": code, "message": message}}


def test_busy_503_code(conn):
    add_trade(conn, UID, day="2026-10-20")
    with wrun.admit(UID, "run"), wrun.admit(UID, "run"):        # the member's two slots are held
        r = _client().post(BASE + "/run", json={"def": raw_plan()})
    assert r.status_code == 503
    assert r.json()["detail"] == {"code": "busy", "message": "Busy right now. Try again in a moment."}


def test_bodies_over_32kb_refused(conn):
    big = {"def": raw_plan(), "pad": "x" * (wdr.MAX_BODY + 10)}
    r = _client().post(BASE + "/run", json=big)
    assert r.status_code == 413 and _code(r) == "invalid"
    # a chunked body (no declared length) is read only up to the cap, then refused
    data = json.dumps(big).encode()
    chunks = [data[i:i + 4096] for i in range(0, len(data), 4096)]
    def gen():
        yield from chunks

    r = _client().post(BASE + "/run", content=gen(), headers={"content-type": "application/json"})
    assert r.status_code == 413 and _code(r) == "invalid"
    assert "content-length" not in {k.lower() for k in r.request.headers}
    assert _client().post(BASE + "/run", json={"def": raw_plan()}).status_code == 200


def test_crud_round_trip_and_ownership(conn, monkeypatch):
    add_user(conn, OTHER)
    c = _client()
    made = c.post(BASE, json={"name": "Edge", "plan": raw_plan()})
    assert made.status_code == 200
    wid = made.json()["id"]
    assert [w["id"] for w in c.get(BASE).json()["widgets"]] == [wid]
    assert c.get(f"{BASE}/{wid}").json()["name"] == "Edge"
    assert c.get(f"{BASE}/{wid}/used-in").json() == {"notes": []}
    assert [r["rev"] for r in c.get(f"{BASE}/{wid}/revs").json()["revs"]] == [1]
    assert c.post(f"{BASE}/{wid}/revs/1/name", json={"name": "First"}).json() == {"rev": 1, "named": "First"}
    r = c.post(f"{BASE}/{wid}/delete", json={"typedName": "Edge"})
    assert r.status_code == 400 and _code(r) == "invalid"            # archive first
    assert c.post(f"{BASE}/{wid}/archive").json()["archived"] is True
    assert [w["id"] for w in c.get(BASE, params={"view": "archived"}).json()["widgets"]] == [wid]
    assert c.post(f"{BASE}/{wid}/delete", json={"typedName": "Edge"}).status_code == 200
    assert c.get(f"{BASE}/{wid}").status_code == 404
    assert c.post(f"{BASE}/{wid}/undelete").json()["archived"] is True
    assert c.post(f"{BASE}/{wid}/unarchive").json()["archived"] is False
    assert _code(c.get(BASE, params={"view": "nope"})) == "invalid"

    # another member's widget is absent on every /{id} route: the same 404 as the dark one
    theirs = wdefs.create(OTHER, "Theirs", raw_plan())["id"]
    want = {"detail": public.not_found().detail}
    for method, path in _routes():
        if "{def_id}" not in path:
            continue
        url = path.replace("{def_id}", theirs).replace("{rev}", "1")
        r = c.request(method, url, json={"name": "x", "apply": "only", "typedName": "Theirs"},
                      headers={"If-Match": "1"})
        assert r.status_code == 404 and r.json() == want, (method, path)
    assert wdefs.get(OTHER, theirs)["name"] == "Theirs"

    # the count cap is a 409 with its own code
    monkeypatch.setattr(wdefs, "COUNT_CAP", 1)
    r = c.post(BASE, json={"plan": raw_plan()})
    assert r.status_code == 409 and r.json()["detail"] == {"code": "count_cap", "message": wdefs.S_CAP}


def test_a_lone_surrogate_in_a_name_is_400_never_500(conn):
    """Task 10.2 fix 2: the body is sent as ASCII JSON carrying an escaped lone surrogate, the
    way a browser can send it. Every name route answers 400 with the sentence."""
    import json as _json
    want = {"code": "invalid", "message": wdefs.S_BAD_CHARACTER}
    c = _client()

    def send(method, url, body, headers=None):
        raw = _json.dumps(body)  # ensure_ascii: the surrogate travels as an escape
        return c.request(method, url, content=raw.encode("ascii"),
                         headers={"content-type": "application/json", **(headers or {})})

    bad = "a" + chr(0xD800)
    assert "ud800" in _json.dumps({"name": bad})  # the body carries the escape, not the byte
    r = send("POST", BASE, {"name": bad, "plan": raw_plan()})
    assert r.status_code == 400 and r.json()["detail"] == want
    saved = wdefs.create(UID, "Mine", raw_plan())
    url = f"{BASE}/{saved['id']}"
    r = send("PUT", url, {"name": bad, "apply": "only"}, {"If-Match": str(saved["etag"])})
    assert r.status_code == 400 and r.json()["detail"] == want
    r = send("POST", f"{url}/revs/1/name", {"name": bad})
    assert r.status_code == 400 and r.json()["detail"] == want
    assert wdefs.get(UID, saved["id"])["name"] == "Mine"
    # Control: the same route accepts an ordinary escaped character.
    r = send("PUT", url, {"name": "a" + chr(0xE9), "apply": "only"}, {"If-Match": str(saved["etag"])})
    assert r.status_code == 200 and r.json()["name"] == "a" + chr(0xE9)


def test_every_route_is_a_sync_def():
    import inspect
    for r in wdr.router.routes:
        assert not inspect.iscoroutinefunction(r.endpoint), r.path


def test_402_sentence_is_distinct_from_the_phase1_router():
    import ast
    import pathlib
    details = []
    for mod in (wdr, nwr):
        tree = ast.parse(pathlib.Path(mod.__file__).read_text(encoding="utf-8"))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "require_paid")
        details += [kw.value.value for n in ast.walk(fn) if isinstance(n, ast.Call)
                    for kw in n.keywords if kw.arg == "detail" and isinstance(kw.value, ast.Constant)]
    assert details == ["Built widgets require a paid plan", "Notebook widgets require a paid plan"]
    assert re.fullmatch(r"[A-Z][a-z ]+ plan", details[0])



@pytest.mark.parametrize("path", ["/preview", "/run", "/drill"])
def test_deep_bodies_are_400_never_500(conn, path):
    c = _client(); c.raise_server_exceptions = False
    flat = "[" * 30000
    r = c.post(BASE + path, content=flat.encode(), headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json()["detail"] == {"code": "invalid",
                                                           "message": wdr.S_UNREADABLE_BODY}
    for key in ("plan", "def"):
        body = ('{"' + key + '":' + '{"a":' * 5000 + '{}' + '}' * 5000 + '}').encode()
        assert len(body) < wdr.MAX_BODY
        r = c.post(BASE + path, content=body, headers={"content-type": "application/json"})
        assert r.status_code == 400 and _code(r) == "invalid", (path, key)


def test_depth_cap_is_at_the_limit_not_below(conn):
    """A body exactly MAX_BODY_DEPTH deep is read; one level more is refused."""
    def nest(n):
        return '{"x": ' * (n - 1) + '{}' + '}' * (n - 1)
    c = _client()
    ok = c.post(BASE + "/examples", content=('{"ids": [], "pad": ' + nest(wdr.MAX_BODY_DEPTH - 1) + '}').encode(),
                headers={"content-type": "application/json"})
    assert ok.status_code == 200
    bad = c.post(BASE + "/examples", content=('{"ids": [], "pad": ' + nest(wdr.MAX_BODY_DEPTH) + '}').encode(),
                 headers={"content-type": "application/json"})
    assert bad.status_code == 400 and _code(bad) == "invalid"


# -- wave 9 (Task 9.8): routine and tracker history behind NOTEBOOK_WIDGETS_W9_ENABLED ---------

def _tool_plans():
    rid = "0c005e04-610d-4565-89f2-5f1f76bb8fd6"
    return [
        raw_plan(source="routine_history", measures=("routine_days_done",),
                 range={"token": "last_30d"}),
        raw_plan(source="tracker_history", measures=("tracker_entries",),
                 range={"token": "last_30d"}),
        raw_plan(source="trading_days", measures=("avg_day_pnl",),
                 split={"by": "routine_done", "ref": rid}, range={"token": "last_30d"}),
    ]


def test_tool_plans_404_and_hidden_from_catalog_when_w9_off(conn, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED", raising=False)
    c = _client()
    static = c.get(BASE + "/vocabulary").json()
    assert {s["key"] for s in static["sources"]} == {"closed_trades", "open_positions", "trading_days"}
    days = next(s for s in static["sources"] if s["key"] == "trading_days")
    assert all(f["refKind"] is None for s in static["sources"] for f in s["fields"])
    assert not {"routine_done", "tracker_value", "tracker_bucket"} & {f["key"] for f in days["fields"]}
    assert not any(k.startswith(("routine_", "tracker_")) for k in (m["key"] for m in static["measures"]))
    for field in ("routine", "tracker"):
        r = c.get(BASE + "/vocabulary", params={"field": field})
        assert r.status_code == 400 and _code(r) == "invalid"
    saved = wdefs.create(UID, "Mine", raw_plan())                       # a plain widget, for PUT
    for p in _tool_plans():
        for path, body in (("/run", {"def": p}), ("/preview", {"plan": p}),
                           ("/drill", {"def": p, "cell": {}}), ("", {"plan": p})):
            r = c.post(BASE + path, json=body)
            assert r.status_code == 404, (path, p["source"], r.status_code)
            assert r.json()["detail"] == public.not_found().detail
        r = c.put(f"{BASE}/{saved['id']}", json={"plan": p, "apply": "only"},
                  headers={"If-Match": str(saved["etag"])})
        assert r.status_code == 404
    assert not any(wplan.uses_tools(e["plan"]) for e in c.get(BASE + "/shelf").json()["examples"])
    # control: the same routes with a plain plan are not the 404
    assert c.post(BASE + "/run", json={"def": raw_plan()}).status_code == 200
    # on: the same tool plans run (empty, never sample)
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    for p in _tool_plans():
        r = c.post(BASE + "/run", json={"def": p})
        assert r.status_code == 200 and r.json()["sample"] is False, p["source"]
        assert r.json()["def"]["v"] == 2
    created = c.post(BASE, json={"plan": _tool_plans()[0]})
    assert created.status_code == 200
    row = conn.execute("SELECT plan_version FROM j2_widget_definitions WHERE id = ?",
                       (created.json()["id"],)).fetchone()
    assert row[0] == 2
    plain = conn.execute("SELECT plan_version FROM j2_widget_definitions WHERE id = ?",
                         (saved["id"],)).fetchone()
    assert plain[0] == 1                                                # a wave 8 widget stays v1
    # off again: the stored tool widget is still listed and readable, it just does not run
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "0")
    assert c.get(f"{BASE}/{created.json()['id']}").status_code == 200
    assert c.post(BASE + "/run", json={"defId": created.json()["id"]}).status_code == 404


def test_vocabulary_routine_and_tracker_fields_when_w9_on(conn, monkeypatch):
    from datetime import datetime, timezone
    from api.services.journal_two import routines, trackers
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    add_user(conn, OTHER)
    now = datetime(2026, 10, 20, 17, tzinfo=timezone.utc)
    mine = routines.create(UID, name="Morning", items=["Plan"], schedule={"kind": "every"}, now=now)
    routines.create(OTHER, name="Theirs", items=["x"], schedule={"kind": "every"}, now=now)
    t = trackers.create(UID, name="Sleep", kind="duration", now=now)
    trackers.create(OTHER, name="Their tracker", kind="number", now=now)
    c = _client()
    static = c.get(BASE + "/vocabulary").json()
    keys = [s["key"] for s in static["sources"]]
    assert keys == ["closed_trades", "open_positions", "trading_days", "routine_history",
                    "tracker_history"]
    days = next(s for s in static["sources"] if s["key"] == "trading_days")
    kinds = {f["key"]: f["refKind"] for f in days["fields"]}
    assert kinds["routine_done"] == "routine" and kinds["tracker_value"] == "tracker"
    assert kinds["tracker_bucket"] == "tracker" and kinds["day_net"] is None
    rh = next(s for s in static["sources"] if s["key"] == "routine_history")
    assert {f["key"]: f["filter"] for f in rh["fields"]}["item"] is False
    assert set(rh["measures"]) == {"routine_consistency", "routine_completion_pct",
                                   "routine_days_done", "routine_best_run"}
    assert c.get(BASE + "/vocabulary", params={"field": "routine"}).json()["values"] == [
        {"id": mine["id"], "name": "Morning"}]
    vals = c.get(BASE + "/vocabulary", params={"field": "tracker"}).json()["values"]
    assert vals == [{"id": "checkin:mood", "name": "Check-in mood"},
                    {"id": "checkin:focus", "name": "Check-in focus"},
                    {"id": t["id"], "name": "Sleep"}]


def test_restore_of_a_tool_revision_is_refused_while_w9_off_and_rename_is_allowed(conn, monkeypatch):
    """W9-R16."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    c = _client()
    made = c.post(BASE, json={"plan": _tool_plans()[0]}).json()
    url = f"{BASE}/{made['id']}"
    plain = c.put(url, json={"plan": raw_plan(), "apply": "only"},
                  headers={"If-Match": str(made["etag"])}).json()
    assert plain["rev"] == 2
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "0")
    r = c.post(f"{url}/revs/1/restore", headers={"If-Match": str(plain["etag"])})
    assert r.status_code == 404 and r.json()["detail"] == public.not_found().detail
    renamed = c.put(url, json={"name": "Renamed", "apply": "only"},
                    headers={"If-Match": str(plain["etag"])})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Renamed"
    # control: a plain revision restores while off, and the tool one does once wave 9 is on
    ok = c.post(f"{url}/revs/2/restore", headers={"If-Match": str(renamed.json()["etag"])})
    assert ok.status_code == 200
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    again = c.post(f"{url}/revs/1/restore", headers={"If-Match": str(ok.json()["etag"])})
    assert again.status_code == 200


def test_examples_and_shelf_gate_a_tool_example(conn, monkeypatch):
    from api.services.journal_two.widget_engine import sources as wsources
    tool = {"id": "shelf:routine-test", "name": "Routine", "description": "d", "keywords": [],
            "plan": wplan.validate_plan(_tool_plans()[0], wsources.CATALOG)}
    real_example, real_examples = wshelf.example, wshelf.examples
    monkeypatch.setattr(wshelf, "example",
                        lambda i: dict(tool) if i == tool["id"] else real_example(i))
    monkeypatch.setattr(wshelf, "examples", lambda: real_examples() + [dict(tool)])
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED", raising=False)
    c = _client()
    r = c.post(BASE + "/examples", json={"ids": [tool["id"]]})
    assert r.status_code == 404 and r.json()["detail"] == public.not_found().detail
    assert tool["id"] not in [e["id"] for e in c.get(BASE + "/shelf").json()["examples"]]
    plain_id = real_examples()[0]["id"]
    assert c.post(BASE + "/examples", json={"ids": [plain_id]}).status_code == 200   # control
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    r = c.post(BASE + "/examples", json={"ids": [tool["id"], plain_id]})
    assert r.status_code == 200 and r.json()["cards"][tool["id"]]["sample"] is False
    assert tool["id"] in [e["id"] for e in c.get(BASE + "/shelf").json()["examples"]]


def _served_codes(c, source, field):
    static = c.get(BASE + "/vocabulary").json()
    src = next(s for s in static["sources"] if s["key"] == source)
    return next(f for f in src["fields"] if f["key"] == field)["values"]


def test_vocabulary_serves_the_routine_state_codes_and_the_validator_agrees(conn, monkeypatch):
    """W9-R23: `state` and `routine_done` serve their codes with labels, derived from the source
    constants; every served code passes the filter validator and every label is refused."""
    from api.services.journal_two.widget_engine import sources as wsources
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    c = _client()
    rid = "0c005e04-610d-4565-89f2-5f1f76bb8fd6"
    cases = {
        ("trading_days", "routine_done"): (wsources.STATE_CODES, lambda v: raw_plan(
            source="trading_days", measures=("avg_day_pnl",),
            filters=[{"field": "routine_done", "op": "in", "values": [v], "ref": rid}],
            range={"from": "2026-10-19", "to": "2026-10-23"})),
        ("routine_history", "state"): (wsources.HISTORY_STATES, lambda v: raw_plan(
            source="routine_history", measures=("routine_days_done",),
            filters=[{"field": "state", "op": "in", "values": [v]}], range={"token": "last_30d"})),
    }
    for (source, field), (codes, mk) in cases.items():
        served = _served_codes(c, source, field)
        assert served == [{"value": k, "label": wsources.STATE_LABELS[k]} for k in codes]
        assert {s["label"] for s in served} <= {"Done", "Not done", "Skipped", "Off day", "Not yet"}
        for s in served:
            assert wplan.validate_plan(mk(s["value"]), wsources.CATALOG)["filters"][0]["values"] \
                == [s["value"]]
            with pytest.raises(wplan.PlanError) as e:
                wplan.validate_plan(mk(s["label"]), wsources.CATALOG)
            assert e.value.sentence == wplan.S_FILTER_VALUE_TYPE
    # moving the source moves what is served AND what the validator accepts
    monkeypatch.setattr(wsources, "STATE_LABELS", {**wsources.STATE_LABELS, "done": "Finished"})
    monkeypatch.setattr(wsources, "HISTORY_STATES", ("done", "skipped"))
    served = _served_codes(c, "routine_history", "state")
    assert served == [{"value": "done", "label": "Finished"},
                      {"value": "skipped", "label": "Skipped"}]
    with pytest.raises(wplan.PlanError):
        wplan.validate_plan(cases[("routine_history", "state")][1]("not_done"), wsources.CATALOG)
    assert _served_codes(c, "trading_days", "routine_done")[0] == {"value": "done",
                                                                   "label": "Finished"}
