"""Task 8.11: `/api/j2/widget-definitions` (dark behind `NOTEBOOK_WIDGETS_W8_ENABLED`).

`require_paid` is NEVER overridden here -- only what it reads -- so the real gate decides. The store and
the engine are real, on a temp sqlite file seeded through `auth_db.init_db` (the Task 8.5 fixtures in
`tests.test_widget_sources`); nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import json
import pathlib
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
from api.services.journal_two.widget_engine import sources as wsources
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


def test_vocabulary_carries_pick_lists_and_the_engines_reasons():
    """Task 8.15: the builder picks fixed values from a list (never a blank box where a list exists)
    and greys a choice out with the ENGINE's own sentence, read from here."""
    v = _client().get(BASE + "/vocabulary").json()
    closed = next(s for s in v["sources"] if s["key"] == "closed_trades")
    by_key = {f["key"]: f for f in closed["fields"]}
    assert [x["value"] for x in by_key["hold_bucket"]["values"]] == list(wsources.HOLD_BUCKETS)
    assert by_key["origin"]["values"] == [{"value": "manual", "label": "Manual"},
                                          {"value": "csv", "label": "CSV import"},
                                          {"value": "broker", "label": "Broker"}]
    assert by_key["had_stop"]["values"] == [{"value": True, "label": "Had a stop"},
                                            {"value": False, "label": "No stop set"}]
    assert "values" not in by_key["setup"]          # the member's own list: ?field=setup
    assert by_key["hold_minutes"].get("needsTimes") is True
    assert next(s for s in v["sources"] if s["key"] == "open_positions")["rightNow"] is True
    assert v["reasons"]["view_bar"] == wsources.S_VIEW_BAR
    assert v["reasons"]["no_earlier"] == wplan.S_NO_EARLIER
    assert v["reasons"]["positions_no_compare"] == wsources.S_POSITIONS_NO_COMPARE
    assert v["timeFields"] == ["day", "month"] and v["maxMeasures"] == 3


def test_vocabulary_member_words():
    """No label, description, meaning, value label or reason a member reads uses an internal word.
    Ruling R-33: "plan" appears only as the member's own "trading plan"."""
    banned = ("definition", "shelf", "built widget", "source", "plan", "scope")
    v = _client().get(BASE + "/vocabulary").json()
    texts = list(v["reasons"].values()) + [r["label"] for r in v["ranges"]]
    for s in v["sources"]:
        texts += [s["label"], s["description"]]
        for f in s["fields"]:
            texts.append(f["label"])
            texts += [x["label"] for x in f.get("values") or []]
    for m in v["measures"]:
        texts += [m["label"], m["meaning"]]
    assert len(texts) > 100                          # non-vacuity: the sweep read the catalog
    bad = [t for t in texts
           if any(b in t.lower().replace("trading plan", "") for b in banned)]
    assert bad == []
    assert any("trading plan" in t.lower() for t in texts)   # the allowance is used, not dead


def test_vocabulary_offers_lists_for_side_regime_and_a_month_picker():
    """Task 8.15 fix 1 (I-8): no blank text box where a list exists."""
    from api.services.journal_two.regime import regime_words
    v = _client().get(BASE + "/vocabulary").json()
    for key in ("closed_trades", "open_positions"):
        src = next(s for s in v["sources"] if s["key"] == key)
        side = next(f for f in src["fields"] if f["key"] == "side")
        assert side["values"] == [{"value": "Long", "label": "Long"}, {"value": "Short", "label": "Short"}]
    closed = {f["key"]: f for f in next(s for s in v["sources"] if s["key"] == "closed_trades")["fields"]}
    assert closed["regime"]["values"] == [{"value": k, "label": w} for k, w in regime_words().items()]
    assert any(x["label"] == "Yellow" for x in closed["regime"]["values"])   # the member's word, not the id
    assert closed["month"]["input"] == "month"


def test_view_rules_are_the_data_view_allowed_evaluates():
    """Ruling R-35: the vocabulary's `viewRules` is the engine's own table, and changing the table changes the
    engine's answer (so the builder, which evaluates the same table, can never disagree with it)."""
    v = _client().get(BASE + "/vocabulary").json()
    assert v["viewRules"]["auto"] == wsources.AUTO_VIEW
    assert [c["test"] for c in v["viewRules"]["checks"]] == [c["test"] for c in wsources.VIEW_CHECKS]
    assert all(c["reason"] in v["reasons"] for c in v["viewRules"]["checks"])
    # the second-split rule has ONE authority, validate_plan; the builder reads it from here
    assert v["viewRules"]["thenViews"] == list(wplan.THEN_VIEWS)
    assert all(c["test"] != "no_then" for c in v["viewRules"]["checks"])
    bar = {"source": "closed_trades", "view": {"type": "bar"}, "measures": [{"key": "net_pnl"}]}
    assert wsources.CATALOG.view_allowed(bar) == wsources.S_VIEW_BAR
    saved = wsources.VIEW_CHECKS
    try:
        wsources.VIEW_CHECKS = tuple(c for c in saved if c["reason"] != "view_bar")
        assert wsources.CATALOG.view_allowed(bar) is None
    finally:
        wsources.VIEW_CHECKS = saved


#: The builder's member-words sweep runs against the REAL catalog through this generated file.
SERVER_CATALOG_FIXTURE = (pathlib.Path(__file__).resolve().parent.parent / "app" / "src" / "pages" / "journal-2-0"
                          / "components" / "notebook" / "widgetBuilder" / "__fixtures__" / "serverCatalog.json")


def _catalog_fixture_text() -> str:
    return json.dumps(wdr._static_vocabulary(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def write_vocabulary_fixture() -> None:
    """Regenerate the builder's server-catalog fixture:
    python -c "from tests.test_widget_definitions_router import write_vocabulary_fixture as w; w()" """
    SERVER_CATALOG_FIXTURE.write_bytes(_catalog_fixture_text().encode("utf-8"))


def test_builder_server_catalog_fixture_is_current():
    """The client tests read the vocabulary from a generated file; it must be what the server serves today."""
    assert SERVER_CATALOG_FIXTURE.exists(), "run write_vocabulary_fixture()"
    on_disk = SERVER_CATALOG_FIXTURE.read_bytes().decode("utf-8").replace("\r\n", "\n")
    assert on_disk == _catalog_fixture_text(), (
        "stale: python -c \"from tests.test_widget_definitions_router import write_vocabulary_fixture as w; w()\"")


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


# -- the builder's create key (wave 8 consolidation, ruling R-43) --------------------------------

KEY = "3f2b8c1e-9d4a-4b7e-8f21-6a5c0d9e1b72"


def _count(conn, sql, args=()):
    return conn.execute(sql, args).fetchone()[0]


def test_create_with_one_idempotency_key_twice_makes_one_widget(conn):
    c = _client()
    first = c.post(BASE, json={"name": "Edge", "plan": raw_plan()}, headers={"Idempotency-Key": KEY})
    again = c.post(BASE, json={"name": "Edge", "plan": raw_plan()}, headers={"Idempotency-Key": KEY})
    assert first.status_code == 200 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["replayed"] is True
    assert again.json()["createdEtag"] == first.json()["etag"]
    assert again.headers["cache-control"] == "no-store"
    assert _count(conn, "SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?", (UID,)) == 1
    assert [w["id"] for w in c.get(BASE).json()["widgets"]] == [first.json()["id"]]


def test_the_same_key_from_two_members_makes_two_widgets(conn):
    add_user(conn, OTHER)
    mine = _client().post(BASE, json={"plan": raw_plan()}, headers={"Idempotency-Key": KEY})
    theirs = _client({**PAID, "id": OTHER}).post(BASE, json={"plan": raw_plan()}, headers={"Idempotency-Key": KEY})
    assert mine.json()["id"] != theirs.json()["id"]
    assert "replayed" not in theirs.json()
    assert _client().post(BASE, json={"plan": raw_plan()}, headers={"Idempotency-Key": KEY}).json()["id"] == mine.json()["id"]
    again = _client({**PAID, "id": OTHER}).post(BASE, json={"plan": raw_plan()}, headers={"Idempotency-Key": KEY})
    assert again.json()["id"] == theirs.json()["id"]
    assert _count(conn, "SELECT COUNT(*) FROM j2_widget_create_keys WHERE key = ?", (KEY,)) == 2


def test_a_malformed_key_is_ignored_and_the_post_behaves_as_before(conn):
    c = _client()
    for bad in ("nope", KEY + "x", "", "   "):
        r = c.post(BASE, json={"plan": raw_plan()}, headers={"Idempotency-Key": bad})
        assert r.status_code == 200 and "replayed" not in r.json()
    r = c.post(BASE, json={"plan": raw_plan()})                      # no header at all
    assert r.status_code == 200 and "replayed" not in r.json()
    assert _count(conn, "SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?", (UID,)) == 5
    assert _count(conn, "SELECT COUNT(*) FROM j2_widget_create_keys") == 0


def test_the_same_key_with_a_different_payload_is_409_and_nothing_changes(conn):
    c = _client()
    first = c.post(BASE, json={"name": "Edge", "plan": raw_plan()}, headers={"Idempotency-Key": KEY}).json()
    r = c.post(BASE, json={"name": "Edge", "plan": raw_plan(measures=("win_rate",))},
               headers={"Idempotency-Key": KEY})
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "conflict", "message": wdefs.S_KEY_REUSED}
    assert _count(conn, "SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?", (UID,)) == 1
    assert c.get(f"{BASE}/{first['id']}").json()["plan"]["measures"] == [{"key": "net_pnl"}]
    same = c.post(BASE, json={"name": "Edge", "plan": raw_plan()}, headers={"Idempotency-Key": KEY})
    assert same.status_code == 200 and same.json()["id"] == first["id"]


def test_save_new_put_honours_the_key(conn):
    c = _client()
    src = c.post(BASE, json={"name": "Edge", "plan": raw_plan()}).json()
    body = {"name": "Edge 2", "plan": raw_plan(), "apply": "save_new"}
    hdr = {"If-Match": str(src["etag"]), "Idempotency-Key": KEY}
    one = c.put(f"{BASE}/{src['id']}", json=body, headers=hdr)
    two = c.put(f"{BASE}/{src['id']}", json=body, headers=hdr)
    assert one.status_code == 200 and two.status_code == 200
    assert two.json()["id"] == one.json()["id"] != src["id"] and two.json()["replayed"] is True
    assert _count(conn, "SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?", (UID,)) == 2
    bad = c.put(f"{BASE}/{src['id']}", json={**body, "name": "Else"}, headers=hdr)
    assert bad.status_code == 409 and _code(bad) == "conflict"
    assert _count(conn, "SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?", (UID,)) == 2
