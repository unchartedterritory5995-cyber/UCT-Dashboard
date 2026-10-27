"""F-ALIAS-1R A5 (11.12 r2 n-6) and A6 (n-7): the two OLDER body readers and the one decode they now share.

A5. `notebook_template_gallery._read_json` (behind `paid_body`, `admin_body` and, with wave 11 off, `library_body`)
and `notebook_journal_styles.paid_body` caught only `ValueError` from `json.loads`. A body nested 60,000 deep
(about 120 KB, under both readers' size caps) makes the parser raise `RecursionError`, which answered 500 on
`POST /api/j2/journal-styles`, `POST /template-gallery/{id}/report` and every other door those readers serve
(`/styles` and `/adopt` too while wave 11 is off). Both readers now decode through the ONE body decode the wave 11
reader uses (`widget_request_body.loads_json`), and a body too deep to parse is a 400 in each reader's own plain
shape (`{"detail": "<sentence>"}`) with `Cache-Control: no-store`.

The routes are DERIVED from the two routers (every route whose dependency tree holds one of the older readers),
never typed, and every one is driven with the generated deep body, wave 11 on and off.

A6. `bad_character_sentence()` imported `share.S_BAD_CHARACTER` inside the function. There is no import cycle
(only routers import `widget_request_body`, and nothing `share` imports reaches it), so the import is at module
level; a fresh interpreter imports the two modules in either order.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers import notebook_journal_styles as jsr
from api.routers import notebook_template_gallery as tgr
from api.services.journal_two import journal_styles as js
from api.services.journal_two import starter_packs
from api.services.journal_two import template_gallery as gallery
from api.services.journal_two import widget_request_body as wbody
from tests._gallery_w11_helpers import ALL_WAVES, AUTHOR, db, waves  # noqa: F401 -- `db` is a fixture used by name

REPO = Path(__file__).resolve().parents[1]
DEPTH = 60_000
NO_STORE = "no-store"

#: The older readers, by router. `library_body` hands over to the wave 11 reader while wave 11 is on.
OLD_READERS = {
    tgr: (tgr.paid_body, tgr.library_body, tgr.admin_body),
    jsr: (jsr.paid_body,),
}


def deep_body(depth: int = DEPTH) -> bytes:
    """A JSON object holding `depth` nested arrays: `{"a":[[[...]]]}`."""
    return b'{"a":' + b"[" * depth + b"]" * depth + b"}"


def _calls(route: APIRoute) -> list:
    seen, stack = [], list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        if d.call is not None:
            seen.append(d.call)
        stack.extend(d.dependencies)
    return seen


def _old_reader_routes() -> list[tuple[object, str, str, object]]:
    """(router module, method, path, reader) for every route whose dependency tree holds an older reader."""
    out = []
    for module, readers in OLD_READERS.items():
        for r in module.router.routes:
            if not isinstance(r, APIRoute):
                continue
            found = [x for x in readers if x in _calls(r)]
            for method in sorted(r.methods):
                if found:
                    out.append((module, method, r.path, found[0]))
    return sorted(out, key=lambda t: (t[2], t[1]))


ROUTES = _old_reader_routes()
_ids = [f"{m} {p}" for _mod, m, p, _r in ROUTES]


def _url(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", path)


@pytest.fixture
def app(db, monkeypatch):
    """Both routers with every switch a door here sits behind turned ON, and a paid admin signed in (the admin doors
    read through `admin_body`)."""
    for flag in (gallery.FLAG, gallery.LIBRARY_FLAG, gallery.PAGE_LAYOUTS_FLAG, gallery.LAYOUT_SHARING_FLAG,
                 gallery.EXAMPLE_FLAG, starter_packs.FLAG, js.FLAG):
        monkeypatch.setenv(flag, "1")
    fa = FastAPI()
    fa.include_router(tgr.router)
    fa.include_router(jsr.router)
    user = {"id": AUTHOR, "role": "admin", "plan": "pro"}
    fa.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _send(client, method: str, path: str, raw: bytes):
    return client.request(method, _url(path), content=raw, headers={"Content-Type": "application/json"})


# ── non-vacuity ────────────────────────────────────────────────────────────────────────────────────

def test_the_generated_body_is_too_deep_for_the_parser_and_small_enough_to_be_read():
    """The fixture is the failure it stands for: the parser recurses out on it, and it is under both size caps (so
    the refusal below is the depth, never the cap)."""
    raw = deep_body()
    with pytest.raises(RecursionError):
        json.loads(raw)
    assert len(raw) < min(tgr.MAX_BODY_BYTES, jsr.MAX_BODY_BYTES)


def test_the_derivation_finds_the_reported_doors_and_every_older_reader():
    pairs = {(m, p) for _mod, m, p, _r in ROUTES}
    assert ("POST", "/api/j2/journal-styles") in pairs
    assert ("POST", "/api/j2/template-gallery/{gallery_id}/report") in pairs
    assert ("POST", "/api/j2/template-gallery/styles") in pairs
    assert ("POST", "/api/j2/template-gallery/{gallery_id}/adopt") in pairs
    assert {r for *_x, r in ROUTES} == {r for rs in OLD_READERS.values() for r in rs}
    assert len(ROUTES) >= 20, len(ROUTES)


# ── A5: the deep body is one 400, never a 500 ─────────────────────────────────────────────────────

def _carries_w11_gate(module, method: str, path: str) -> bool:
    for r in module.router.routes:
        if isinstance(r, APIRoute) and r.path == path and method in r.methods:
            return module._require_w11 in [d.call for d in r.dependant.dependencies]
    raise AssertionError(f"{method} {path} is not served")


@pytest.mark.parametrize("w11", [True, False], ids=["wave11-on", "wave11-off"])
@pytest.mark.parametrize("route", ROUTES, ids=_ids)
def test_a_body_too_deep_to_parse_is_the_readers_400_never_a_500(route, w11, client, monkeypatch):
    module, method, path, reader = route
    waves(monkeypatch, *(ALL_WAVES if w11 else tuple(w for w in ALL_WAVES if w != 11)))
    r = _send(client, method, path, deep_body())
    if not w11 and _carries_w11_gate(module, method, path):
        assert r.status_code == 404, (method, path, r.status_code, r.text)    # the wave 11 gate, before the body
        return
    assert r.headers.get("cache-control") == NO_STORE, (method, path, w11, r.headers)
    if w11 and reader is tgr.library_body:
        # Wave 11 on: `/styles` and `/adopt` read through the wave 11 reader (16 KB), in its `{code, message}` shape;
        # the 120 KB body meets its size cap first.
        assert len(deep_body()) > tgr.W11_MAX_BODY_BYTES
        assert r.status_code == 413, (method, path, r.status_code, r.text[:200])
        assert r.json() == {"detail": {"code": "invalid", "message": wbody.S_BODY_TOO_LARGE}}, (method, path)
    else:
        assert r.status_code == 400, (method, path, w11, r.status_code, r.text[:200])
        assert r.json() == {"detail": wbody.S_UNREADABLE_BODY}, (method, path, w11, r.json())


@pytest.mark.parametrize("route", ROUTES, ids=_ids)
def test_CONTROL_a_shallow_body_on_the_same_door_is_not_the_unreadable_refusal(route, client, monkeypatch):
    """The 400 above is the depth: the same door, sent the same shape 3 deep, is read (whatever it then answers)."""
    _module, method, path, _reader = route
    waves(monkeypatch, *ALL_WAVES)
    r = _send(client, method, path, deep_body(3))
    assert r.status_code != 500, (method, path, r.text[:200])
    detail = r.json().get("detail")
    message = detail.get("message") if isinstance(detail, dict) else detail
    assert message != wbody.S_UNREADABLE_BODY, (method, path, r.status_code, r.text[:200])


@pytest.mark.parametrize("w11", [True, False], ids=["wave11-on", "wave11-off"])
def test_a_malformed_body_keeps_each_older_readers_own_422(w11, client, monkeypatch):
    """The depth refusal is NEW and separate: a body that is not JSON keeps each reader's existing 422 sentence."""
    waves(monkeypatch, *(ALL_WAVES if w11 else tuple(w for w in ALL_WAVES if w != 11)))
    for method, url in (("POST", "/api/j2/journal-styles"), ("POST", "/api/j2/template-gallery/x/report")):
        r = client.request(method, url, content=b"{", headers={"Content-Type": "application/json"})
        assert r.status_code == 422 and r.json() == {"detail": "Send a JSON object"}, (url, r.status_code, r.text)
        # F-ALIAS-1R m-3: the gallery's 422 answers no-store too, as journal-styles' always did (both shapes)
        assert r.headers.get("cache-control") == NO_STORE, (url, r.headers)
        r = client.request(method, url, content=b"[1]", headers={"Content-Type": "application/json"})
        assert r.status_code == 422 and r.headers.get("cache-control") == NO_STORE, (url, r.status_code, r.headers)


def test_loads_json_is_the_one_decode_and_answers_the_parsers_recursion_as_its_own_refusal():
    with pytest.raises(wbody.BodyTooDeep):
        wbody.loads_json(deep_body())
    assert not issubclass(wbody.BodyTooDeep, ValueError)     # a reader's `except ValueError` (422) cannot swallow it
    with pytest.raises(ValueError):
        wbody.loads_json(b"{")
    assert wbody.loads_json(b'{"a": [[1]]}') == {"a": [[1]]}                                         # CONTROL


# ── A6: no import cycle, so the sentence's import is at module level ───────────────────────────────

@pytest.mark.parametrize("first,second", [
    ("api.services.journal_two.widget_request_body", "api.services.journal_two.widget_engine.share"),
    ("api.services.journal_two.widget_engine.share", "api.services.journal_two.widget_request_body"),
])
def test_the_body_reader_and_the_reducer_import_in_either_order_in_a_fresh_interpreter(first, second):
    code = (f"import importlib; importlib.import_module({first!r}); importlib.import_module({second!r}); "
            "from api.services.journal_two import widget_request_body as w; "
            "from api.services.journal_two.widget_engine import share as s; "
            "assert w.S_BAD_CHARACTER is s.S_BAD_CHARACTER and w.bad_character_sentence() == s.S_BAD_CHARACTER")
    done = subprocess.run([sys.executable, "-c", code], cwd=REPO, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr[-2000:]


# ── W11-R55: EVERY notebook body reader, derived from the routers' own source ─────────────────────
#
# The review of A5 (F-ALIAS-1R I-2) found five more readers that caught only `ValueError` and answered a body too deep
# to parse with a 500. The reader set is DERIVED, never typed: every function in `api/routers/notebook_*.py` that reads
# the raw request body (`read_capped_body`, `request.stream()`, `request.body()`) and decodes it. Each must decode
# through the one body decode (`widget_request_body.loads_plain_body`, or the wave 11 `read_json_object`) and none may
# call `json.loads` itself. Then every plain reader is DRIVEN with a body too deep to parse.

import ast  # noqa: E402
import asyncio  # noqa: E402
import importlib  # noqa: E402

from fastapi import HTTPException  # noqa: E402
from starlette.requests import Request  # noqa: E402

_BODY_READS = ("read_capped_body", "stream", "body")
_ONE_DECODES = ("loads_plain_body", "read_json_object")


def _calls_named(fn: ast.AST) -> set[str]:
    out = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Call):
            f = n.func
            out.add(f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", ""))
    return out


def _json_loads_calls(fn: ast.AST) -> list[int]:
    return [n.lineno for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr == "loads" and isinstance(n.func.value, ast.Name) and n.func.value.id == "json"]


def _derived_body_readers() -> list[tuple[str, str, set[str], list[int]]]:
    """(module, function, the calls it makes, its `json.loads` lines) for every notebook router function that reads
    the raw request body and decodes it (a call to `loads`, `loads_json`, `loads_plain_body` or `read_json_object`)."""
    out = []
    for path in sorted((REPO / "api" / "routers").glob("notebook_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            calls = _calls_named(fn)
            reads = bool(calls & set(_BODY_READS))
            decodes = bool(calls & {"loads", "loads_json", *_ONE_DECODES})
            if reads and decodes:
                out.append((f"api.routers.{path.stem}", fn.name, calls, _json_loads_calls(fn)))
    return out


BODY_READERS_DERIVED = _derived_body_readers()
PLAIN_READERS = [(m, f) for m, f, calls, _l in BODY_READERS_DERIVED if "loads_plain_body" in calls]


def test_the_derivation_finds_every_reader_the_review_named():
    """Non-vacuity: the five I-2 readers and both A5 readers are in the derived set."""
    found = {(m.rsplit(".", 1)[1], f) for m, f, *_x in BODY_READERS_DERIVED}
    named = {("notebook_shares", "read_expiry"), ("notebook_personal_api", "_json_body"),
             ("notebook_ai_actions", "_read_json"), ("notebook_chart_alerts", "_read_json"),
             ("notebook_writing_help", "_read_payload"),
             ("notebook_template_gallery", "_read_json"), ("notebook_journal_styles", "paid_body")}
    assert named <= found, sorted(named - found)


@pytest.mark.parametrize("module,fn,calls,loads", BODY_READERS_DERIVED, ids=lambda x: x if isinstance(x, str) else "")
def test_every_notebook_body_reader_decodes_through_the_one_body_decode(module, fn, calls, loads):
    assert not loads, f"{module}.{fn} decodes a body with json.loads (lines {loads}): a deep body is a 500 there"
    assert calls & set(_ONE_DECODES), f"{module}.{fn} does not decode through loads_plain_body / read_json_object"


def test_CONTROL_the_scan_sees_a_reader_that_calls_json_loads():
    src = "async def r(request):\n    raw = await request.body()\n    return json.loads(raw)\n"
    fn = ast.parse(src).body[0]
    assert _json_loads_calls(fn) == [3] and not (_calls_named(fn) & set(_ONE_DECODES))


def _request(raw: bytes) -> Request:
    sent = {"done": False}

    async def receive():
        if sent["done"]:
            return {"type": "http.disconnect"}
        sent["done"] = True
        return {"type": "http.request", "body": raw, "more_body": False}
    scope = {"type": "http", "method": "POST", "path": "/x", "query_string": b"",
             "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())]}
    return Request(scope, receive)


def _read(module: str, fn: str, raw: bytes, monkeypatch):
    mod = importlib.import_module(module)
    for cap in ("MAX_BODY_BYTES", "_MAX_BODY_BYTES"):          # a reader whose cap is under the deep body still
        if hasattr(mod, cap):                                  # decodes it: the depth refusal is what is railed here
            monkeypatch.setattr(mod, cap, 10 * 1024 * 1024)
    return asyncio.run(getattr(mod, fn)(_request(raw)))


@pytest.mark.parametrize("module,fn", PLAIN_READERS, ids=[f"{m.rsplit('.', 1)[1]}.{f}" for m, f in PLAIN_READERS])
def test_W11_R55_a_body_too_deep_to_parse_is_each_readers_400_no_store_never_a_500(module, fn, monkeypatch):
    with pytest.raises(HTTPException) as e:
        _read(module, fn, deep_body(), monkeypatch)
    assert e.value.status_code == 400, (module, fn, e.value.status_code, e.value.detail)
    assert e.value.detail == wbody.S_UNREADABLE_BODY
    assert (e.value.headers or {}).get("Cache-Control") == NO_STORE


@pytest.mark.parametrize("module,fn", PLAIN_READERS, ids=[f"{m.rsplit('.', 1)[1]}.{f}" for m, f in PLAIN_READERS])
def test_W11_R55_CONTROL_a_malformed_body_keeps_each_readers_own_refusal(module, fn, monkeypatch):
    with pytest.raises(HTTPException) as e:
        _read(module, fn, b"{", monkeypatch)
    assert e.value.detail != wbody.S_UNREADABLE_BODY, (module, fn)
    assert e.value.status_code in (400, 422), (module, fn, e.value.status_code)
    ok = _read(module, fn, b'{"a": [[1]]}', monkeypatch)                 # and a shallow object is read
    assert ok is None or isinstance(ok, (dict, int)), (module, fn, ok)


def test_W11_R55_the_expiry_doors_keep_their_422_sentence_for_a_malformed_body(monkeypatch):
    from api.services.journal_two import note_shares
    with pytest.raises(HTTPException) as e:
        _read("api.routers.notebook_shares", "read_expiry", b"{", monkeypatch)
    assert e.value.status_code == 422 and e.value.detail == note_shares.EXPIRY_SENTENCE
