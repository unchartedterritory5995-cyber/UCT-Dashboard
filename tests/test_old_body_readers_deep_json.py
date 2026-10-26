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
