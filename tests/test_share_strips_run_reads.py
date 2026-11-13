"""⛔⛔ THE AUTHOR'S PINE NEVER TRAVELS WITH A SHARE (owner ruling) — run-read parts included.

Two run-read features put the WHOLE Pine script inside an ``ast`` document: DIV-4's
``compute.runtimeColours.source`` and ENGINE 53's ``compute.runtimeObjects.source``. Before this
file, `install_share` dropped only the run half (a copy kept DIV-4's script), and the share PREVIEW
(`GET /shared/{token}` -> `resolve_share`, read by `SharedFormula.jsx`) returned both scripts to
anyone holding the link.

Now ONE function (`runtime_definitions.without_run_reads`) strips them at the one edge every
cross-member read passes (`user_definitions.resolve_share`); `install_share` reads through it.

1. the strip itself: a DIV-4 copy IS the document the member door writes with the runtime lane off
   (the cross-suite fixture `tests/fixtures/share_strip_div4.json`, whose client twin is
   `memberPane/shareStripCopy.test.js`), bar one disclosure sentence; a plain document is the
   SAME object back;
2. the doors: a preview of a DIV-4 document and of a run-half document carries no script; an
   installed copy has neither key; a fork (the owner's own) keeps both; a plain share is
   byte-identical to the stored document;
3. the rails that enumerate the outbound paths, so a new door cannot skip the strip: the router
   table (every route classified, every cross-member route probed), this module's cross-member
   reads (an AST walk), and the routers that import the store at all.
"""
from __future__ import annotations

import ast
import copy
import json
import pathlib
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import indicator_alert_service as ias
from api.services import runtime_definitions as rt
from api.services import user_definition_relint as rl
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIV4 = json.loads((ROOT / "tests/fixtures/share_strip_div4.json").read_text(encoding="utf-8"))
HALF = json.loads((ROOT / "tests/fixtures/run_half_stored_bytes.json").read_text(encoding="utf-8"))
RUNTIME_DOCS = {d["slug"]: d for d in json.loads(
    (ROOT / "tests/fixtures/runtime_documents/documents.json").read_text(encoding="utf-8"))["documents"]}
AUTHOR, VIEWER = "u-strip-author", "u-strip-viewer"


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV):
        monkeypatch.delenv(k, raising=False)
    rl._NOTICE_CACHE.clear()
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    yield
    rl._NOTICE_CACHE.clear()


def _as(user_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": user_id, "role": "member", "plan": "premium"}
    return TestClient(app)


def _div4_doc() -> dict:
    d = copy.deepcopy(DIV4["document"])
    d["id"] = svc.new_def_id()
    return d


def _half_doc() -> dict:
    d = copy.deepcopy(HALF["sent"])
    d["id"] = svc.new_def_id()
    return d


def _saved(kind: str) -> tuple[dict, str, str]:
    """``(document, its script, share token)`` for a saved, shared run-read document."""
    if kind == "div4":
        d, src = _div4_doc(), DIV4["source"]
        svc.save(AUTHOR, d["id"], copy.deepcopy(d), pine_source=src)
    else:
        d, src = _half_doc(), HALF["source"]
        svc.save(AUTHOR, d["id"], copy.deepcopy(d), pine_source=src)
    stored = svc.get(AUTHOR, d["id"])["definition"]
    key = "runtimeColours" if kind == "div4" else "runtimeObjects"
    assert stored["compute"][key]["source"] == src, "CONTROL: the stored document carries the script"
    return d, src, svc.share(AUTHOR, d["id"])["token"]


def _script_lines(src: str) -> list:
    """Distinctive lines of the script (a fragment must not travel either)."""
    return [ln.strip() for ln in src.splitlines() if len(ln.strip()) >= 12]


def _assert_no_script(payload, src: str) -> None:
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    assert src not in text and json.dumps(src, ensure_ascii=False)[1:-1] not in text \
        and json.dumps(src)[1:-1] not in text, "the author's whole script travelled"
    for ln in _script_lines(src):
        assert ln not in text and json.dumps(ln)[1:-1] not in text, f"a line of the script travelled: {ln!r}"
    assert rt.source_hash(src) not in text, "the script's fingerprint travelled"
    for key in rt.RUN_READ_KEYS + (rt.RUN_HALF_SOURCE_STAMP, "pine_source"):
        assert f'"{key}"' not in text, f"{key} travelled"


# -- 0. the controls the rest leans on --------------------------------------------------------------

def test_C0_the_detector_sees_a_script_where_there_is_one():
    """C0: `_assert_no_script` goes red on the unstripped documents and on a bare line, so a
    green below is the strip's, not a blind check's."""
    for doc, src in ((DIV4["document"], DIV4["source"]), (HALF["sent"], HALF["source"])):
        with pytest.raises(AssertionError):
            _assert_no_script(doc, src)
        with pytest.raises(AssertionError):
            _assert_no_script({"x": _script_lines(src)[-1]}, src)
        _assert_no_script(rt.without_run_reads(doc), src)


def test_the_run_half_sentence_is_the_clients():
    """`RUN_HALF_DRAWING_SENTENCE` is `objectLoss.js`'s, read from the JS (never restated)."""
    js = (ROOT / "app/src/components/chart/engine/ast/objectLoss.js").read_text(encoding="utf-8")
    m = re.search(r"export const RUN_HALF_DRAWING_SENTENCE = ((?:\s*\+?\s*(?:'[^']*'|\"[^\"]*\"))+)", js)
    assert m, "objectLoss.js no longer declares RUN_HALF_DRAWING_SENTENCE as string literals"
    text = "".join(a or b for a, b in re.findall(r"'([^']*)'|\"([^\"]*)\"", m.group(1)))
    assert text == rt.RUN_HALF_DRAWING_SENTENCE
    # and the fixture's drawing note ends with it, so the strip below is exercised for real
    notes = [n["note"] for n in HALF["sent"]["meta"]["disclosures"]]
    assert any(n.endswith(" " + text) for n in notes)


# -- 1. the strip -----------------------------------------------------------------------------------

def test_a_DIV4_copy_is_the_document_the_door_writes_with_the_runtime_lane_OFF():
    """The copy keeps its host colours, exactly as a chart without the lane draws: equal to the
    lane-off door document in every field but the run-read paint's disclosure, which now says it
    is not drawn (and why) instead of promising the run."""
    doc = copy.deepcopy(DIV4["document"])
    got = rt.without_run_reads(doc)
    assert doc == DIV4["document"], "the strip never mutates its argument"
    assert "runtimeColours" not in got["compute"] and "paints" not in got
    off = copy.deepcopy(DIV4["laneOff"])
    gone = [n for n in got["meta"]["disclosures"] if n["note"].endswith(rt.RUN_READ_PAINT_GONE)]
    assert [n["name"] for n in gone] == ["`barcolor` (line 13)"]
    assert not any(rt.RUN_READ_PAINT_LEAD in n["note"] for n in got["meta"]["disclosures"])
    strip_notes = lambda d: {**d, "meta": {k: v for k, v in d["meta"].items() if k != "disclosures"}}
    assert strip_notes(got) == strip_notes(off)
    assert len(got["meta"]["disclosures"]) == len(off["meta"]["disclosures"])
    # ⭐ the cross-suite fixture's `copy` is what the server makes (the vitest twin draws it)
    assert got == DIV4["copy"]


def test_a_run_half_copy_drops_the_half_its_stamp_and_its_sentence():
    got = rt.without_run_reads(HALF["sent"])
    assert "runtimeObjects" not in got["compute"]
    assert rt.RUN_HALF_SOURCE_STAMP not in got["meta"]
    assert not any(n["note"].endswith(rt.RUN_HALF_DRAWING_SENTENCE) for n in got["meta"]["disclosures"])
    assert got["meta"]["disclosures"][0]["note"].endswith("so what it draws is incomplete. (The 3 are "
        "every drawing step this chart tried to carry: each line, label, box or table created, changed "
        "or written to, each change to a list of them, each loop, and each call to a drawing function "
        "of the script's own that could not be followed.)")
    assert {k: v for k, v in got.items() if k not in ("compute", "meta")} == \
        {k: v for k, v in HALF["sent"].items() if k not in ("compute", "meta")}


def test_a_served_run_read_stamp_goes_with_the_part_it_answered_for():
    d = copy.deepcopy(DIV4["document"])
    d["meta"] = {**d["meta"], "runtimeKilled": "x", "runtimeNotGraded": "y"}
    meta = rt.without_run_reads(d)["meta"]
    assert "runtimeKilled" not in meta and "runtimeNotGraded" not in meta


@pytest.mark.parametrize("doc", [
    DIV4["laneOff"],
    {"compute": {"kind": "ast", "ast": {"type": "num", "value": 1}}, "meta": {"name": "x"}},
    # ⭐ a runtime document is NOT a run-read part (its source is its implementation): unchanged
    RUNTIME_DOCS["adx-and-di-for-v4"]["definition"],
    {"compute": "not a dict"}, None, "x",
], ids=["lane-off-door", "minimal-ast", "runtime", "malformed", "none", "str"])
def test_IDENTITY_a_document_without_a_run_read_part_is_the_SAME_object_back(doc):
    assert rt.without_run_reads(doc) is doc


# -- 2. the doors -----------------------------------------------------------------------------------

@pytest.mark.parametrize("kind", ["div4", "half"])
def test_the_share_PREVIEW_carries_no_script(kind):
    doc, src, token = _saved(kind)
    got = _as(VIEWER).get(f"/api/user-definitions/shared/{token}")
    assert got.status_code == 200, got.text
    body = got.json()
    _assert_no_script(body, src)
    assert body["definition"] == rt.without_run_reads(svc.get(AUTHOR, doc["id"])["definition"])
    _assert_no_script(svc.resolve_share(token), src)


@pytest.mark.parametrize("kind", ["div4", "half"])
def test_an_INSTALLED_copy_has_neither_key_and_no_script(kind):
    doc, src, token = _saved(kind)
    out = svc.install_share(VIEWER, token)
    row = svc.get(VIEWER, out["def_id"], with_source=True)
    assert not set(rt.RUN_READ_KEYS) & set(row["definition"]["compute"])
    assert row["has_pine_source"] is False and "pine_source" not in row
    _assert_no_script(row, src)
    _assert_no_script(svc.list_for_user(VIEWER, source_below=999), src)
    # through the router too, as the recipient's browser installs it
    token2 = svc.share(AUTHOR, doc["id"])["token"]
    got = _as(VIEWER).post(f"/api/user-definitions/shared/{token2}/install")
    assert got.status_code == 200, got.text
    _assert_no_script(got.json(), src)
    _assert_no_script(_as(VIEWER).get("/api/user-definitions").json(), src)


@pytest.mark.parametrize("kind,key", [("div4", "runtimeColours"), ("half", "runtimeObjects")])
def test_a_FORK_the_owners_own_copy_keeps_its_run_read_part(kind, key):
    doc, src, _ = _saved(kind)
    out = svc.fork(AUTHOR, doc["id"])
    got = svc.get(AUTHOR, out["def_id"], with_source=True)
    assert got["definition"]["compute"][key]["source"] == src
    assert got["pine_source"] == src
    # and the owner's own read is untouched
    assert svc.get(AUTHOR, doc["id"])["definition"]["compute"][key]["source"] == src


def test_IDENTITY_a_plain_share_previews_and_installs_byte_for_byte():
    d = copy.deepcopy(DIV4["laneOff"])
    d["id"] = svc.new_def_id()
    svc.save(AUTHOR, d["id"], d, pine_source=DIV4["source"])
    stored = svc.get(AUTHOR, d["id"])["definition"]
    token = svc.share(AUTHOR, d["id"])["token"]
    body = _as(VIEWER).get(f"/api/user-definitions/shared/{token}").json()
    canon = lambda v: json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    assert canon(body["definition"]) == canon(stored)
    out = svc.install_share(VIEWER, token)
    mine = svc.get(VIEWER, out["def_id"])["definition"]
    assert canon({k: v for k, v in mine.items() if k not in ("id", "origin")}) == \
        canon({k: v for k, v in stored.items() if k != "id"})


def test_the_LIBRARY_lists_no_script():
    doc, src, _ = _saved("div4")
    assert svc.publish(AUTHOR, doc["id"])["listed"] is True
    got = _as(VIEWER).get("/api/user-definitions/library")
    assert got.status_code == 200 and got.json()["entries"], got.text
    _assert_no_script(got.json(), src)
    # ⛔ the entry is a CLOSED projection of meta: a new field that carried the document would
    # have to be added here, on purpose
    assert set(got.json()["entries"][0]) == {"token", "name", "shortName", "description", "repaint",
                                             "placement", "inputs", "published_at", "ast_hash"}


@pytest.mark.xfail(strict=True, reason=(
    "OPEN, owner call: a RUNTIME document (compute.kind == 'runtime') is its Pine "
    "(`compute.source`), and WS-H S4 shares it whole. Not a run-read part; not stripped here. "
    "See docs/pine/evidence/2026-11-13-share-strips-run-reads/EVIDENCE.md"))
def test_OPEN_a_runtime_document_share_still_carries_its_script(monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    d = copy.deepcopy(RUNTIME_DOCS["adx-and-di-for-v4"]["definition"])
    svc.save(AUTHOR, d["id"], d)
    token = svc.share(AUTHOR, d["id"])["token"]
    body = _as(VIEWER).get(f"/api/user-definitions/shared/{token}").json()
    assert body["definition"]["compute"].get("source") != d["compute"]["source"]


# -- 3. the rails: every outbound path --------------------------------------------------------------

#: ⛔ EVERY route of `/api/user-definitions`, classified. ``cross`` hands another member's
#: definition out (each is probed below); ``own`` reads or writes the caller's own namespace only
#: (probed with another member's id: a script never comes back); ``none`` returns no stored
#: definition at all. A new route fails `test_EVERY_route_is_classified` until it is put here.
ROUTES = {
    ("GET", "/api/user-definitions"): "own",
    ("POST", "/api/user-definitions"): "own",
    ("POST", "/api/user-definitions/propose"): "none",
    ("POST", "/api/user-definitions/converse"): "none",
    ("GET", "/api/user-definitions/library"): "cross",
    ("GET", "/api/user-definitions/runtime-kill"): "none",
    ("GET", "/api/user-definitions/{def_id}"): "own",
    ("PUT", "/api/user-definitions/{def_id}"): "own",
    ("POST", "/api/user-definitions/{def_id}/engine-status"): "own",
    ("POST", "/api/user-definitions/{def_id}/fork"): "own",
    ("DELETE", "/api/user-definitions/{def_id}"): "own",
    ("POST", "/api/user-definitions/{def_id}/share"): "own",
    ("GET", "/api/user-definitions/{def_id}/share"): "own",
    ("DELETE", "/api/user-definitions/{def_id}/share"): "own",
    ("GET", "/api/user-definitions/{def_id}/history"): "own",
    ("POST", "/api/user-definitions/{def_id}/list"): "own",
    ("DELETE", "/api/user-definitions/{def_id}/list"): "own",
    ("GET", "/api/user-definitions/{def_id}/list"): "own",
    ("GET", "/api/user-definitions/shared/{token}"): "cross",
    ("POST", "/api/user-definitions/shared/{token}/install"): "cross",
}


def _router_routes() -> set:
    return {(m, r.path) for r in router_mod.router.routes for m in r.methods}


def test_EVERY_route_is_classified():
    assert _router_routes() == set(ROUTES)


@pytest.mark.parametrize("kind", ["div4", "half"])
def test_EVERY_route_probed_as_another_member_returns_no_script(kind):
    """Derived from the router table: each ``own``/``cross`` route, called by a VIEWER with the
    AUTHOR's ids (and every body the route is sent), never answers with the script."""
    doc, src, token = _saved(kind)
    svc.publish(AUTHOR, doc["id"])
    viewer = _as(VIEWER)
    probed = 0
    for (method, path), cls in sorted(ROUTES.items()):
        if cls == "none":
            continue
        url = path.replace("{def_id}", doc["id"]).replace("{token}", token)
        got = viewer.request(method, url, json={} if method in ("POST", "PUT") else None)
        _assert_no_script(got.text, src)
        probed += 1
    assert probed == sum(1 for c in ROUTES.values() if c != "none")
    # the owner's read of the same row still carries it (CONTROL: the probe would see it)
    with pytest.raises(AssertionError):
        _assert_no_script(_as(AUTHOR).get(f"/api/user-definitions/{doc['id']}").text, src)


_READERS = ("get", "history", "list_for_user")


def _cross_member_readers() -> dict:
    """``{function: [call]}``: every call in `user_definitions.py` to a definition reader whose
    owner argument is not the function's own ``user_id`` -- a read of another member's row."""
    tree = ast.parse((ROOT / "api/services/user_definitions.py").read_text(encoding="utf-8"))
    out: dict = {}
    for fn in tree.body:
        if not isinstance(fn, ast.FunctionDef):
            continue
        for call in ast.walk(fn):
            if (isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
                    and call.func.id in _READERS and call.args
                    and not (isinstance(call.args[0], ast.Name) and call.args[0].id == "user_id")):
                out.setdefault(fn.name, []).append(ast.unparse(call))
    return out


def test_the_store_reads_another_members_definition_in_exactly_the_doors_that_strip_or_project():
    """⛔ A new cross-member read in the store fails here until it is routed through
    `resolve_share` (which strips) or proved a closed projection like the library's."""
    found = _cross_member_readers()
    assert set(found) == {"resolve_share", "public_library"}, found
    tree = ast.parse((ROOT / "api/services/user_definitions.py").read_text(encoding="utf-8"))
    fns = {f.name: f for f in tree.body if isinstance(f, ast.FunctionDef)}
    calls = lambda name: {ast.unparse(c.func) for c in ast.walk(fns[name]) if isinstance(c, ast.Call)}
    assert "runtime_definitions.without_run_reads" in calls("resolve_share")
    # the copy reads the shared document ONLY through resolve_share
    assert "resolve_share" in calls("install_share")
    assert not {"get", "history", "_row_to_dict"} & calls("install_share")


def test_the_routers_that_read_the_store_read_only_the_callers_own_rows():
    """Every router importing the store other than its own reads with ``user["id"]`` (the caller),
    so the share doors above are the only routes a member reaches another member's row by."""
    routers = {}
    for p in sorted((ROOT / "api/routers").glob("*.py")):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        names = {a.asname or a.name for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                 and n.module == "api.services" for a in n.names if a.name == "user_definitions"}
        if names:
            routers[p.stem] = (tree, names)
    assert set(routers) == {"user_definitions", "definition_record", "pine_strategy_backtest",
                            "screener_backtest"}, sorted(routers)
    for stem, (tree, names) in routers.items():
        if stem == "user_definitions":
            continue
        for call in ast.walk(tree):
            if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                    and isinstance(call.func.value, ast.Name) and call.func.value.id in names):
                assert call.func.attr not in ("resolve_share", "install_share", "public_library",
                                              "live_definitions"), (stem, ast.unparse(call))
                if call.func.attr in _READERS:
                    owner = ast.unparse(call.args[0])
                    assert owner in ('user["id"]', "user['id']", "user_id"), (stem, ast.unparse(call))
