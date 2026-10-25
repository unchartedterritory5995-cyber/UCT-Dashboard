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
        assert r.headers["cache-control"] == "no-store", (method, path)      # a refusal is not cached
    assert "Built widgets require a paid plan" != "Notebook widgets require a paid plan"
    assert _client(None).get(BASE + "/shelf").status_code in (401, 403)


def test_every_200_is_no_store(conn):
    r = _client().get(BASE + "/shelf")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert {e["id"] for e in r.json()["examples"]} == {
        e["id"] for e in wshelf.examples(allowed=wdr._shelf_allowed())}


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
    assert s.status_code == 200 and s.json()["notice"] != wdr.S_FROZEN
    assert (s.json()["defId"], s.json()["defRev"], s.json()["latestRev"]) == (ex["id"], 1, 1)

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
    monkeypatch.setattr(wrun, "run_examples", lambda uid, ids, **kw: seen.append(ids) or {"cards": {}})
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


#: The same catalog with wave 9 on (`tools=True`: routines and trackers), generated beside it at the be->impl merge,
#: in place of the test-local layering of be's rows on impl's catalog (`toolCatalog.be.json`, retired).
TOOL_CATALOG_FIXTURE = SERVER_CATALOG_FIXTURE.with_name("toolCatalog.json")


#: Wave 10 on too (Task 10.17: the Options strategies and Notes sources, the formula formats, `hourKey` and `prop`),
#: written with note kinds OFFERED (W10-R62: the journal styles switch on, whatever the env says), so the notes
#: source's `kind` field is in it; a client test that needs it absent removes it from its own copy.
W10_CATALOG_FIXTURE = SERVER_CATALOG_FIXTURE.with_name("w10Catalog.json")


def _catalog_fixture_text(tools: bool = False, w10: bool = False) -> str:
    if not w10:
        return json.dumps(wdr._static_vocabulary(tools), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    from api.services.journal_two import journal_styles
    saved = journal_styles.enabled
    journal_styles.enabled = lambda: True
    try:
        return json.dumps(wdr._static_vocabulary(tools, w10), indent=2, ensure_ascii=False,
                          sort_keys=True) + "\n"
    finally:
        journal_styles.enabled = saved


def write_vocabulary_fixture() -> None:
    """Regenerate the builder's server-catalog fixtures (wave 9 off, on, and wave 10 on too):
    python -c "from tests.test_widget_definitions_router import write_vocabulary_fixture as w; w()" """
    SERVER_CATALOG_FIXTURE.write_bytes(_catalog_fixture_text().encode("utf-8"))
    TOOL_CATALOG_FIXTURE.write_bytes(_catalog_fixture_text(tools=True).encode("utf-8"))
    W10_CATALOG_FIXTURE.write_bytes(_catalog_fixture_text(tools=True, w10=True).encode("utf-8"))


@pytest.mark.parametrize("fixture,tools,w10", [(SERVER_CATALOG_FIXTURE, False, False),
                                               (TOOL_CATALOG_FIXTURE, True, False),
                                               (W10_CATALOG_FIXTURE, True, True)])
def test_builder_server_catalog_fixture_is_current(fixture, tools, w10):
    """The client tests read the vocabulary from a generated file; it must be what the server serves today."""
    assert fixture.exists(), "run write_vocabulary_fixture()"
    on_disk = fixture.read_bytes().decode("utf-8").replace("\r\n", "\n")
    assert on_disk == _catalog_fixture_text(tools, w10), (
        "stale: python -c \"from tests.test_widget_definitions_router import write_vocabulary_fixture as w; w()\"")


def test_w10_catalog_fixture_is_the_wave10_catalog_with_note_kinds():
    """Non-vacuity: the wave 10 fixture lists both new sources and the formula formats, and was written with note
    kinds offered (the notes source's `kind` field is in it), so the builder's tests of them read the server."""
    got = json.loads(W10_CATALOG_FIXTURE.read_bytes().decode("utf-8"))
    keys = {s["key"]: s for s in got["sources"]}
    assert {"options_strategies", "notes"} <= set(keys)
    assert [f["key"] for f in got["formats"]] == list(wplan.FORMULA_FORMATS)
    assert "kind" in {f["key"] for f in keys["notes"]["fields"]}


def test_each_source_serves_the_ranges_and_accounts_the_validator_refuses():
    """Task 9.17 concern 2 (at the be->impl merge): `refusedRanges` / `allAccountsOnly` on each source row are the
    validator's own answers, so the builder's disabled ranges and hidden account choice need no mirror. Derived by
    asking `validate_plan` every range on every source, never restated."""
    v = wdr._static_vocabulary(tools=True, w10=True)
    rows = {s["key"]: s for s in v["sources"]}
    assert set(rows) == set(wsources.SOURCES)                       # non-vacuity: every source, waves 9 and 10 in
    measure_of = {"closed_trades": "net_pnl", "open_positions": "open_positions", "trading_days": "avg_day_pnl",
                  "routine_history": "routine_consistency", "tracker_history": "tracker_avg",
                  "options_strategies": "strategies", "notes": "notes"}
    for key, row in rows.items():
        measure = measure_of[key]
        wplan.validate_plan(raw_plan(source=key, measures=(measure,), range={"token": "last_30d"}),
                            wsources.CATALOG)                            # the base plan is valid
        refused = []
        for tok in wplan.RANGE_TOKENS:
            try:
                wplan.validate_plan(raw_plan(source=key, measures=(measure,), range={"token": tok}),
                                    wsources.CATALOG)
            except wplan.PlanError as e:
                if e.sentence == wplan.S_UNKNOWN_RANGE:
                    refused.append(tok)
        assert row["refusedRanges"] == refused, key
        try:
            wplan.validate_plan(raw_plan(source=key, measures=(measure,), range={"token": "last_30d"},
                                         accounts={"id": "acc-1"}), wsources.CATALOG)
            one_account_ok = True
        except wplan.PlanError as e:
            one_account_ok = e.sentence != wplan.S_TOOL_ACCOUNTS
        assert row["allAccountsOnly"] is (not one_account_ok), key
    assert rows["routine_history"]["refusedRanges"] and rows["routine_history"]["allAccountsOnly"]   # it can fire
    assert rows["closed_trades"]["refusedRanges"] == [] and not rows["closed_trades"]["allAccountsOnly"]


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
    # The be->impl merge: the keyed doors (R-43 create, R-49 save_new) hash the request BEFORE `_clean_name` runs,
    # so the surrogate must be refused there too, never reach the hash's UTF-8 encode (a 500).
    key = {"Idempotency-Key": "3f2b8c1e-9d4a-4b7e-8f21-6a5c0d9e1b72"}
    r = send("POST", BASE, {"name": bad, "plan": raw_plan()}, key)
    assert r.status_code == 400 and r.json()["detail"] == want
    r = send("PUT", url, {"name": bad, "plan": raw_plan(), "apply": "save_new"},
             {"If-Match": str(saved["etag"]), **key})
    assert r.status_code == 400 and r.json()["detail"] == want
    assert conn.execute("SELECT COUNT(*) FROM j2_widget_create_keys").fetchone()[0] == 0
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


def test_examples_and_shelf_gate_a_tool_example(conn, monkeypatch, tmp_path):
    from tests.test_widget_shelf_files import planted
    tool = {"id": "shelf:routine-test", "rev": 1, "name": "Routine", "description": "d",
            "keywords": [], "plan": _tool_plans()[0]}
    with planted(tmp_path, [tool], new_ids=(tool["id"],)):
        monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED", raising=False)
        c = _client()
        r = c.post(BASE + "/examples", json={"ids": [tool["id"]]})
        assert r.status_code == 200 and r.json()["cards"] == {}      # Task 10.9: dropped, not run
        assert tool["id"] not in [e["id"] for e in c.get(BASE + "/shelf").json()["examples"]]
        plain_id = wshelf.examples()[0]["id"]
        assert c.post(BASE + "/examples", json={"ids": [plain_id]}).status_code == 200   # control
        monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
        r = c.post(BASE + "/examples", json={"ids": [tool["id"], plain_id]})
        assert r.status_code == 200 and r.json()["cards"][tool["id"]]["sample"] is False
        assert tool["id"] in [e["id"] for e in c.get(BASE + "/shelf").json()["examples"]]


# -- shelf revisions (Task 10.8) -----------------------------------------------------------------

def test_shelf_wave10_fallback_only_before_plan_v3():
    """Task 10.4 landed plan format 3 and `plan.uses_wave10`, and deleted `_shelf_allowed`'s getattr
    fallback: the router asks `wplan.uses_wave10` directly."""
    assert wplan.PLAN_VERSION == 3 and hasattr(wplan, "uses_wave10")
    import inspect
    src = inspect.getsource(wdr._shelf_allowed)
    assert "wplan.uses_wave10(plan)" in src and "getattr" not in src


def _two_revs(tmp_path, **plan_changes):
    from tests.test_widget_shelf_files import planted, rev2_of
    changes = plan_changes or {"display": {"title": "Win rate, revision two", "titleAuto": False,
                                           "accent": "gold"}}
    return planted(tmp_path, [rev2_of("shelf:win-rate", **changes)])


def test_shelf_run_pins_def_rev(conn, tmp_path):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    c = _client()
    with _two_revs(tmp_path):
        one = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 1, "settings": {}})
        two = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 2, "settings": {}})
        assert one.status_code == two.status_code == 200
        assert (one.json()["defRev"], one.json()["latestRev"]) == (1, 2)
        assert (two.json()["defRev"], two.json()["latestRev"]) == (2, 2)
        assert one.json()["title"] == "Win rate"                   # a newer rev does not move rev 1
        assert two.json()["title"] == "Win rate, revision two"
        assert one.json()["defId"] == two.json()["defId"] == "shelf:win-rate"
        # an unknown revision: the note's frozen copy if it has one ...
        frozen = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 9,
                                             "def": _plan(), "settings": {}})
        assert frozen.status_code == 200 and frozen.json()["notice"] == wdr.S_FROZEN
        assert frozen.json()["defId"] is None
        # ... else the newest revision the flags allow
        newest = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 9, "settings": {}})
        assert newest.status_code == 200 and newest.json()["defRev"] == 2
        assert newest.json()["notice"] != wdr.S_FROZEN
        drill = c.post(BASE + "/drill", json={"defId": "shelf:win-rate", "defRev": 1,
                                              "settings": {}, "cell": {}})
        assert drill.status_code != 500
    unknown = c.post(BASE + "/run", json={"defId": "shelf:nope", "defRev": 1, "settings": {}})
    assert unknown.status_code == 400 and _code(unknown) == "invalid"


def test_shelf_run_without_def_rev_is_rev_one(conn, tmp_path):
    c = _client()
    with _two_revs(tmp_path):
        for bad in (None, "2", True, 0, -3, 1.5, [2], {"rev": 2}):    # a wave 8 placement, or junk
            body = {"defId": "shelf:win-rate", "settings": {}}
            if bad is not None:
                body["defRev"] = bad
            r = c.post(BASE + "/run", json=body)
            assert r.status_code == 200, bad
            assert (r.json()["defRev"], r.json()["title"]) == (1, "Win rate"), bad
        big = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 10 ** 30,
                                          "settings": {}})
        assert big.status_code == 200 and big.json()["defRev"] == 2     # unknown: the newest


def test_shelf_payload_echoes_latest_rev(conn, tmp_path, monkeypatch):
    from tests.test_widget_shelf_files import planted, rev2_of
    c = _client()
    r2 = rev2_of("shelf:win-rate")
    r2["plan"] = dict(_tool_plans()[0], display={"title": "Win rate", "titleAuto": False,
                                                 "accent": "gold"})
    with planted(tmp_path, [r2]):
        monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED", raising=False)
        r = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 1, "settings": {}})
        assert r.status_code == 200 and (r.json()["defRev"], r.json()["latestRev"]) == (1, 1)
        shelf_row = next(e for e in c.get(BASE + "/shelf").json()["examples"]
                         if e["id"] == "shelf:win-rate")
        assert shelf_row["rev"] == 1                               # rev 2 needs a dark wave
        pinned = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 2, "settings": {}})
        assert pinned.status_code == 404                           # the tool gate still answers
        monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
        r = c.post(BASE + "/run", json={"defId": "shelf:win-rate", "defRev": 1, "settings": {}})
        assert (r.json()["defRev"], r.json()["latestRev"]) == (1, 2)
        assert r.json()["sourceKey"] == "closed_trades"            # still rev 1's plan
        shelf_row = next(e for e in c.get(BASE + "/shelf").json()["examples"]
                         if e["id"] == "shelf:win-rate")
        assert shelf_row["rev"] == 2


def test_shelf_route_lists_rev_and_summary(conn, tmp_path):
    from api.services.journal_two.widget_engine import sources as wsources
    c = _client()
    rows = c.get(BASE + "/shelf").json()["examples"]
    assert len(rows) == len(wshelf.examples(allowed=wdr._shelf_allowed())) >= 23
    for e in rows:
        assert e["rev"] == wshelf.latest_rev(e["id"], allowed=wdr._shelf_allowed()), e["id"]
        unit = wsources.CATALOG.sources[e["plan"]["source"]].unit
        assert e["summary"] == wplan.summary(e["plan"], wsources.CATALOG, None, unit), e["id"]
        assert e["summary"].strip()
    with _two_revs(tmp_path):
        row = next(e for e in c.get(BASE + "/shelf").json()["examples"] if e["id"] == "shelf:win-rate")
        assert row["rev"] == 2 and row["plan"]["display"]["title"] == "Win rate, revision two"


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


# -- wave 10 (ruling W10-R46, Task 10.4 fix round 1): the gate and the interim engine guard ------

def _w10_plans():
    """The review's three repro plans, plus the two display options that would run wrong."""
    return {
        "aggregate formula measure": dict(_plan(
            formulas=[{"id": "f1", "name": "Wins n", "expr": "CountIf([net] > 0)"}]),
            measures=[{"formula": "f1"}]),
        "row formula measure": dict(_plan(
            formulas=[{"id": "f1", "name": "Double", "expr": "[net] * 2"}]),
            measures=[{"formula": "f1", "agg": "sum"}]),
        "row formula filter": _plan(
            formulas=[{"id": "f1", "name": "Big", "expr": "[net] > 0"}],
            filters=[{"field": "formula:f1", "op": "is", "values": [True]}]),
        "cumulative": _plan(split={"by": "day"}, view={"type": "line"},
                            display={"cumulative": True}),
        "stop after": _plan(measures=("current_streak",), display={"stopAfter": 2}),
    }


def _unraising(user=PAID):
    app = FastAPI()
    app.include_router(wdr.router)
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def _doors(c, p, saved):
    """Every door `_gate_tools` guards, for plan `p`: (name, response)."""
    yield "run", c.post(BASE + "/run", json={"def": p})
    yield "preview", c.post(BASE + "/preview", json={"plan": p})
    yield "drill", c.post(BASE + "/drill", json={"def": p, "cell": {}})
    yield "create", c.post(BASE, json={"plan": p})
    yield "save", c.put(f"{BASE}/{saved['id']}", json={"plan": p, "apply": "only"},
                        headers={"If-Match": str(saved["etag"])})


def test_w10_plans_are_the_dark_404_at_every_door_while_w10_is_off(conn, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W10_ENABLED", raising=False)
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    c = _unraising()
    saved = wdefs.create(UID, "Mine", _plan())
    plans = _w10_plans()
    assert all(wplan.uses_wave10(p) for p in plans.values())
    for name, p in plans.items():
        for door, r in _doors(c, p, saved):
            assert r.status_code == 404, (name, door, r.status_code, r.text[:200])
            assert r.json()["detail"] == public.not_found().detail, (name, door)
    n = conn.execute("SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?",
                     (UID,)).fetchone()[0]
    assert n == 1                                                   # nothing v3 was stored
    # controls: a v1 plan runs, and a v2 tool plan runs once wave 9 is on, with wave 10 still off
    assert c.post(BASE + "/run", json={"def": _plan()}).status_code == 200
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    r = c.post(BASE + "/run", json={"def": _tool_plans()[0]})
    assert r.status_code == 200 and r.json()["def"]["v"] == 2


def test_w10_plans_run_at_every_door_while_w10_is_on(conn, monkeypatch):
    """With wave 10 ON (Tasks 10.5 and 10.6): formula measures, formula filters and the display
    options run at `/run`, `/preview` and `/drill` -- W10-R46's interim guard is gone. Never a
    500, and never the plan-level refusal for a plan the validator accepted."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    c = _unraising()
    runs = drills = set(_w10_plans())
    for name, p in _w10_plans().items():
        made = c.post(BASE, json={"plan": p})
        assert made.status_code == 200 and made.json()["plan"]["v"] == 3, (name, made.text[:200])
        for door, body in (("/run", {"def": p}), ("/run", {"defId": made.json()["id"]}),
                           ("/preview", {"plan": p}), ("/drill", {"def": p, "cell": {}})):
            r = c.post(BASE + door, json=body)
            ok = name in (drills if door == "/drill" else runs)
            assert r.status_code == (200 if ok else 400), (name, door, r.status_code, r.text[:200])
            if not ok:
                assert r.json()["detail"] == {"code": "invalid", "message": wplan.S_UNREADABLE}
    r = c.post(BASE + "/run", json={"def": _w10_plans()["row formula measure"]})
    assert r.json()["value"]["v1"] == 100.0                     # [net] * 2, added up
    assert r.json()["measures"][0]["key"] == "formula:f1"
    r = c.post(BASE + "/run", json={"def": _w10_plans()["row formula filter"]})
    assert r.json()["count"] == 1 and r.json()["value"]["v1"] == 50.0    # [net] > 0 kept it
    # controls: v1 and v2 plans still run with wave 10 on
    assert c.post(BASE + "/run", json={"def": _plan()}).status_code == 200
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    assert c.post(BASE + "/run", json={"def": _tool_plans()[0]}).status_code == 200


def _sweep_shapes():
    """Every display option and formula shape (Task 10.5's rail): {name: raw plan}."""
    def f(fid, name, expr, fmt="number"):
        return {"id": fid, "name": name, "expr": expr, "format": fmt}

    def mk(measures, formulas=(), source="closed_trades", rng=None, **kw):
        raw = {"v": 1, "source": source, "measures": list(measures),
               "range": rng or {"token": "last_90d"}}
        if formulas:
            raw["formulas"] = list(formulas)
        raw.update(kw)
        return raw

    edge = f("f1", "Edge", "[net] / [risk_dollars]", "r")
    green = f("f1", "Green", "[net] > 0")
    shapes = {}
    for agg, fmt in (("sum", "money"), ("avg", "r"), ("min", "percent"), ("max", "number")):
        shapes[f"row {agg}"] = mk([{"formula": "f1", "agg": agg}], [dict(edge, format=fmt)])
    shapes["bool share"] = mk([{"formula": "f1", "agg": "share"}], [green])
    shapes["bool count"] = mk([{"formula": "f1", "agg": "count"}], [green])
    shapes["text measure"] = mk([{"formula": "f1", "agg": "sum"}],
                                [f("f1", "Wd", "Weekday([day])")])
    for name, expr in (("countif", "CountIf([net] > 0)"), ("sumif", "SumIf([net], [r] > 0)"),
                       ("share", "Share([net] > 0)"), ("avgif", "AvgIf([net])"),
                       ("composite", "SumIf([net], [net] > 0) / CountIf([net] > 0)"),
                       ("agg divide by zero", "SumIf([net]) / 0")):
        shapes[f"aggregate {name}"] = mk([{"formula": "f1"}], [f("f1", "Agg", expr)])
    shapes["hour"] = mk([{"formula": "f1", "agg": "avg"}], [f("f1", "Hr", "Hour([day])")])
    shapes["hold minutes"] = mk([{"formula": "f1", "agg": "avg"}],
                                [f("f1", "Hours", "[hold_minutes] / 60")])
    shapes["divide by zero"] = mk([{"formula": "f1", "agg": "avg"}],
                                  [f("f1", "Zero", "[net] / 0")])
    shapes["five formulas"] = mk([{"formula": f"f{i}", "agg": "sum"} for i in (1, 2, 3)],
                                 [f(f"f{i}", f"F{i}", f"[net] * {i}") for i in range(1, 6)])
    shapes["declared unused"] = mk([{"key": "net_pnl"}], [edge])
    shapes["text split"] = mk([{"key": "net_pnl"}], [f("f1", "Wd", "Weekday([day])")],
                              split={"by": "formula:f1"}, view={"type": "bar"})
    shapes["bucket split"] = mk([{"key": "trades"}], [f("f1", "Band", "Bucket([r], 0, 1)")],
                                split={"by": "formula:f1"}, view={"type": "bar"})
    shapes["bool filter"] = mk([{"key": "net_pnl"}], [green],
                               filters=[{"field": "formula:f1", "op": "is", "values": [True]}])
    shapes["number filter"] = mk([{"key": "net_pnl"}], [edge],
                                 filters=[{"field": "formula:f1", "op": "gt", "values": [0]}])
    for view, split in (("list", None), ("table", {"by": "setup"}), ("bar", {"by": "setup"}),
                        ("heat", {"by": "day"}), ("line", {"by": "day"})):
        shapes[f"formula on {view}"] = mk([{"formula": "f1", "agg": "sum"}], [edge],
                                           split=split, view={"type": view})
    shapes["formula compare"] = mk([{"formula": "f1", "agg": "sum"}], [edge],
                                   view={"type": "compare"}, compare={"mode": "previous"})
    shapes["cumulative"] = mk([{"key": "net_pnl"}], split={"by": "day"}, view={"type": "line"},
                              display={"cumulative": True})
    shapes["cumulative formula"] = mk([{"formula": "f1", "agg": "sum"}], [edge],
                                      split={"by": "month"}, view={"type": "line"},
                                      display={"cumulative": True})
    shapes["goal"] = mk([{"key": "net_pnl"}], rng={"token": "this_week"},
                        view={"type": "progress"}, display={"targetGoal": True})
    shapes["stop after"] = mk([{"key": "current_streak"}], display={"stopAfter": 2})
    shapes["quadrants"] = mk([{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "avg"}],
                             [f("f1", "MAE", "Abs([mae_r])", "r"), f("f2", "MFE", "[mfe_r]", "r")],
                             view={"type": "scatter"}, display={"quadrants": "excursion"})
    shapes["drawdown number"] = mk([{"key": "max_drawdown"}])
    shapes["drawdown compare"] = mk([{"key": "max_drawdown"}], view={"type": "compare"},
                                    compare={"mode": "previous"})
    shapes["days formula"] = mk([{"formula": "f1", "agg": "sum"}],
                                [f("f1", "Double", "[day_net] * 2")], source="trading_days")
    shapes["positions formula"] = mk([{"formula": "f1", "agg": "avg"}],
                                     [f("f1", "Heat", "[unrealised] / [risk_dollars]")],
                                     source="open_positions", rng={"token": "all"})
    # Task 10.6: formula filters and splits on every source that scans, the two-way split,
    # and the options strategies source in every view it allows
    shapes["two-way formula split"] = mk([{"key": "net_pnl"}], [green],
                                         split={"by": "setup", "then": "formula:f1"},
                                         view={"type": "table"})
    shapes["formula filter + split"] = mk([{"key": "trades"}],
                                          [green, f("f2", "Wd", "Weekday([day])")],
                                          filters=[{"field": "formula:f1", "op": "is",
                                                    "values": [True]}],
                                          split={"by": "formula:f2"}, view={"type": "bar"})
    shapes["overridable formula filter"] = mk(
        [{"key": "net_pnl"}], [green],
        filters=[{"field": "formula:f1", "op": "is", "values": [True], "overridable": True}])
    shapes["days formula filter"] = mk([{"key": "avg_day_pnl"}],
                                       [f("f1", "Green day", "[day_net] > 0")],
                                       filters=[{"field": "formula:f1", "op": "is",
                                                 "values": [True]}], source="trading_days")
    shapes["days formula split"] = mk([{"key": "avg_day_pnl"}],
                                      [f("f1", "Green day", "[day_net] > 0")],
                                      split={"by": "formula:f1"}, view={"type": "bar"},
                                      source="trading_days")
    shapes["positions formula filter"] = mk([{"key": "open_positions"}],
                                            [f("f1", "Risky", "[risk_dollars] > 100")],
                                            filters=[{"field": "formula:f1", "op": "is",
                                                      "values": [False]}],
                                            source="open_positions", rng={"token": "all"})
    opt = dict(source="options_strategies")
    shapes["options number"] = mk([{"key": "strategies"}, {"key": "net_pnl"},
                                   {"key": "win_rate"}], **opt)
    shapes["options compare"] = mk([{"key": "net_pnl"}], view={"type": "compare"},
                                   compare={"mode": "previous"}, **opt)
    shapes["options list"] = mk([{"key": "net_pnl"}, {"key": "total_r"}], view={"type": "list"},
                                **opt)
    for by in ("strategy", "direction", "status", "underlying", "result", "account", "setup",
               "weekday", "month"):
        shapes[f"options by {by}"] = mk([{"key": "strategies"}, {"key": "profit_factor"}],
                                        split={"by": by}, view={"type": "bar"}, **opt)
    shapes["options line"] = mk([{"key": "net_pnl"}], split={"by": "day"}, view={"type": "line"},
                                display={"cumulative": True}, **opt)
    shapes["options heat"] = mk([{"key": "net_pnl"}], split={"by": "day"}, view={"type": "heat"},
                                **opt)
    shapes["options drawdown"] = mk([{"key": "max_drawdown"}], **opt)
    shapes["options stop after"] = mk([{"key": "current_streak"}], display={"stopAfter": 2},
                                      **opt)
    shapes["options filters"] = mk([{"key": "strategies"}], filters=[
        {"field": "dte_entry", "op": "lte", "values": [30]},
        {"field": "status", "op": "in", "values": ["closed", "open"]},
        {"field": "underlying", "op": "contains", "values": ["sp"]}], **opt)
    shapes["options formulas"] = mk([{"formula": "f1", "agg": "sum"}, {"formula": "f3"}],
                                    [f("f1", "Double", "[net] * 2", "money"),
                                     f("f2", "Dir", "[direction]"),
                                     f("f3", "Wins n", "CountIf([net] > 0)")],
                                    filters=[{"field": "formula:f2", "op": "in",
                                              "values": ["bullish"]}], **opt)
    shapes["options formula split"] = mk([{"key": "net_pnl"}], [f("f1", "Dir", "[direction]")],
                                         split={"by": "formula:f1"}, view={"type": "bar"}, **opt)
    return shapes


def test_every_w10_shape_answers_200_or_a_clean_400_never_a_500(conn, monkeypatch):
    """Task 10.5's sweep: with wave 10 ON every formula shape and display option goes through
    `/run`, `/preview` and `/drill`; each answers 200 (a payload with no NaN and no infinity) or a
    clean 400 (`{code, message}`), never a 500."""
    from api.limiter import limiter
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
    acc = add_account(conn, UID, "Main")
    days = ("2026-09-01", "2026-09-15", "2026-10-01", "2026-10-14", "2026-10-20", "2026-10-21",
            "2026-10-22")
    pnls = (120, -80, 45, -150, 300, -20, 60)
    rs = (1.2, -0.8, None, -1.5, 3.0, -0.2, 0.6)
    for i, d in enumerate(days):
        add_trade(conn, UID, day=d, pnl=pnls[i], r=rs[i], setup=("Flag", "VCP", None)[i % 3],
                  account=acc, hour=None if i == 2 else 10 + i, stop=100 if i == 2 else 95,
                  entry_iso=d if i == 3 else None, exit_iso=d if i == 3 else None)
    from tests.test_widget_options_source import add_opt
    for i, d in enumerate(days):
        add_opt(conn, UID, entry=f"{d}T14:00:00Z", closed_at=f"{d}T19:00:00Z", pnl=pnls[i] / 2,
                r=rs[i], account=acc if i % 2 else None, setup=("Wheel", None)[i % 2],
                direction=("bullish", "bearish", "neutral")[i % 3],
                strategy_type=("long_call", "iron_condor")[i % 2],
                legs=("2026-11-20",) if i % 3 else (), stamp=bool(i % 2))
    add_opt(conn, UID, status="open", entry="2026-10-21T14:00:00Z", legs=("2026-11-20",))
    add_opt(conn, UID, closed_at="2026-10-22T00:30:00Z", pnl=5.0, result="Scratch", stamp=False)
    conn.execute("UPDATE j2_accounts SET goals = ? WHERE id = ?",
                 (json.dumps({"weekly": 500}), acc))
    conn.commit()
    c = _unraising()
    answered: dict[int, list] = {200: [], 400: []}
    for name, p in _sweep_shapes().items():
        for door, body in (("/run", {"def": p}), ("/preview", {"plan": p}),
                           ("/drill", {"def": p, "cell": {}})):
            limiter.reset()
            r = c.post(BASE + door, json=body)
            assert r.status_code in (200, 400), (name, door, r.status_code, r.text[:300])
            if r.status_code == 400:
                detail = r.json()["detail"]
                assert set(detail) >= {"code", "message"} and detail["message"], (name, door)
            else:
                json.dumps(r.json(), allow_nan=False)
            answered[r.status_code].append((name, door))
        if (p.get("view") or {}).get("type") == "scatter":       # a scatter point's own drill
            limiter.reset()
            r = c.post(BASE + "/drill", json={"def": p, "cell": {"d": "2026-10-20", "x": 1,
                                                                  "y": 1}})
            assert r.status_code in (200, 400), (name, "point", r.status_code, r.text[:300])
            answered[r.status_code].append((name, "/drill point"))
        if p.get("split"):                                       # a group's own drill
            ran = c.post(BASE + "/run", json={"def": p})
            labels = [row.get("label") for row in (ran.json().get("rows") or [])
                      ] if ran.status_code == 200 else []
            for label in labels[:3]:
                limiter.reset()
                r = c.post(BASE + "/drill", json={"def": p, "cell": {"label": label}})
                assert r.status_code == 200, (name, "group", label, r.text[:300])
                answered[200].append((name, "/drill group"))
    ran = {n for n, d in answered[200] if d == "/run"}
    drilled = {n for n, d in answered[200] if d.startswith("/drill")}
    refused = {n for n, d in answered[400]}
    # non-vacuity: every shape the validator accepts runs at every door -- the only 400 left is
    # the validator's own refusal of a text formula as a measure
    assert refused == {"text measure"}, sorted(refused)
    assert set(_sweep_shapes()) - {"text measure"} <= ran, sorted(set(_sweep_shapes()) - ran)
    assert set(_sweep_shapes()) - {"text measure"} <= drilled
    assert {n for n, d in answered[200] if d == "/drill point"} == {"quadrants"}
    assert {"options by strategy", "two-way formula split", "formula filter + split",
            "options formula split", "days formula split"} <= \
        {n for n, d in answered[200] if d == "/drill group"}
    assert len(answered[200]) >= 200


@pytest.mark.parametrize("w9", ["0", "1"])
def test_restore_and_examples_gate_a_w10_plan(conn, monkeypatch, tmp_path, w9):
    """Restore and examples gate in a loop that runs when EITHER wave is off. Fix round 2 (N-1):
    W9 ON with W10 OFF is the production combination, where a loop keyed on wave 9 alone skips."""
    from tests.test_widget_shelf_files import planted
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", w9)
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
    c = _unraising()
    made = c.post(BASE, json={"plan": _w10_plans()["row formula measure"]}).json()
    url = f"{BASE}/{made['id']}"
    plain = c.put(url, json={"plan": _plan(), "apply": "only"},
                  headers={"If-Match": str(made["etag"])}).json()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "0")
    r = c.post(f"{url}/revs/1/restore", headers={"If-Match": str(plain["etag"])})
    assert r.status_code == 404 and r.json()["detail"] == public.not_found().detail
    renamed = c.put(url, json={"name": "Renamed", "apply": "only"},
                    headers={"If-Match": str(plain["etag"])})
    assert renamed.status_code == 200                                # a rename-only PUT passes
    ex = {"id": "shelf:formula-test", "rev": 1, "name": "F", "description": "d", "keywords": [],
          "plan": _w10_plans()["aggregate formula measure"]}
    fx = {"id": "shelf:formula-filter-test", "rev": 1, "name": "G", "description": "d",
          "keywords": [], "plan": _w10_plans()["row formula filter"]}
    with planted(tmp_path, [ex, fx], new_ids=(ex["id"], fx["id"])):
        r = c.post(BASE + "/examples", json={"ids": [ex["id"]]})
        assert r.status_code == 200 and r.json()["cards"] == {}      # Task 10.9: dropped, not run
        assert ex["id"] not in [e["id"] for e in c.get(BASE + "/shelf").json()["examples"]]
        monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
        r = c.post(BASE + "/examples", json={"ids": [ex["id"]]})          # Task 10.5 runs it
        assert r.status_code == 200 and ex["id"] in r.json()["cards"]
        r = c.post(BASE + "/examples", json={"ids": [fx["id"]]})          # Task 10.6 runs it
        assert r.status_code == 200 and fx["id"] in r.json()["cards"]
        plain_id = wshelf.examples()[0]["id"]
        assert c.post(BASE + "/examples", json={"ids": [plain_id]}).status_code == 200  # control


# -- Task 10.13: the wave 10 shelf revisions, the new entries and the dedicated list ---------------

#: The seven dedicated kinds as `GET /shelf` lists them, in spec section 8 order (Task 10.13, verbatim).
DEDICATED = [
    ("myTiltCheck", "Tilt check", "Trades soon after a loss compared with the rest."),
    ("myRevengeClean", "Revenge trades", "Clean days in the last 30 trading days."),
    ("myPlanVsActual", "Plan vs actual", "One trade's plan against its fills."),
    ("myRiskLeftToday", "Risk left today", "Your daily loss limit against today's P&L and open risk."),
    ("myPropFirm", "Prop-firm rules", "Room left under your daily loss and max drawdown limits."),
    ("myGamePlan", "Pre-market game plan",
     "The wire's read, your names reporting today and your open risk."),
    ("myAlertsFired", "Alerts that fired", "Your alerts since the last session."),
]

W10_NEW_IDS = ("shelf:mae-vs-mfe", "shelf:process-vs-results", "shelf:goals-progress")


def test_shelf_dedicated_list_only_when_wave10_on(conn, monkeypatch):
    from api.services.journal_two import shelf_kind_names
    c = _client()
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W10_ENABLED", raising=False)
    off = c.get(BASE + "/shelf")
    assert off.status_code == 200 and "dedicated" not in off.json()
    rows = {e["id"]: e for e in off.json()["examples"]}
    assert not set(W10_NEW_IDS) & set(rows)                  # each needs wave 10: not offered
    assert rows["shelf:equity-curve"]["rev"] == 1 and len(rows) == 23
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
    on = c.get(BASE + "/shelf")
    assert on.status_code == 200 and on.headers["cache-control"] == "no-store"
    body = on.json()
    assert [(d["kind"], d["name"], d["description"]) for d in body["dedicated"]] == DEDICATED
    for d in body["dedicated"]:
        assert set(d) == {"kind", "name", "description", "keywords"}, d["kind"]
        assert d["keywords"] and all(isinstance(k, str) and k.strip() for k in d["keywords"]), d
    rows = {e["id"]: e for e in body["examples"]}
    assert set(W10_NEW_IDS) <= set(rows) and rows["shelf:equity-curve"]["rev"] == 2
    assert len(rows) == 26
    # one owner: the router serves `shelf_kind_names`' tables, it restates none of them
    assert [d["kind"] for d in body["dedicated"]] == list(shelf_kind_names.KINDS)
    monkeypatch.setitem(shelf_kind_names.DESCRIPTIONS, "myTiltCheck", "Moved at the source.")
    moved = c.get(BASE + "/shelf").json()["dedicated"][0]
    assert moved["description"] == "Moved at the source."
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "0")
    assert "dedicated" not in c.get(BASE + "/shelf").json()          # switched back off: hidden


def test_examples_run_the_newest_allowed_revision(conn, monkeypatch):
    """With wave 10 off a revised id's examples card runs its revision 1 (never the dark 404), and a
    new id with no allowed revision is dropped from the batch (Task 10.9: the gallery draws its bare
    shape; it was the dark 404 for the whole batch in 10.13); on, the card is revision 2."""
    c = _unraising()
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W10_ENABLED", raising=False)
    r = c.post(BASE + "/examples", json={"ids": ["shelf:equity-curve", "shelf:win-rate"]})
    assert r.status_code == 200, r.text
    card = r.json()["cards"]["shelf:equity-curve"]
    assert card["def"] == wshelf.revision("shelf:equity-curve", 1)["plan"]
    for new in W10_NEW_IDS:
        r = c.post(BASE + "/examples", json={"ids": [new]})
        assert r.status_code == 200 and r.json()["cards"] == {}, new
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
    r = c.post(BASE + "/examples", json={"ids": ["shelf:equity-curve", *W10_NEW_IDS]})
    assert r.status_code == 200, r.text
    cards = r.json()["cards"]
    assert cards["shelf:equity-curve"]["def"] == wshelf.revision("shelf:equity-curve", 2)["plan"]
    assert cards["shelf:mae-vs-mfe"]["def"]["display"]["quadrants"] == "excursion"
