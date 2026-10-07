"""One side of the old-versus-new body differential. Run under pytest, by path,
inside the tree it measures (the tree's own conftest pins every data path):

    FV_DIFF_MODE=describe FV_DIFF_OUT=cases.json  python -m pytest <this file> -q     (new tree only)
    FV_DIFF_MODE=replay   FV_DIFF_CASES=cases.json FV_DIFF_OUT=side.json python -m pytest <this file> -q

`describe` reads the census for every route that takes its body through
`request_body_cap.capped_json`, and writes the requests to send: the same list
for both sides, built from each route's own annotation.

`replay` sends them. The handler of every target route is replaced by one that
answers the PARSED body, so nothing a handler would do happens (no model call,
no broker call, no write) and what is compared is exactly the layer that
changed: how the request body becomes the handler's argument. Dark-flag gates
are opened on both sides so the body layer is reached.

This file imports nothing from the repo at module level and has no `test_`
prefix in its name, so it is never collected by an ordinary run.
"""
from __future__ import annotations

import asyncio
import enum
import inspect
import json
import os
import types
import typing
import uuid

MODE = os.environ.get("FV_DIFF_MODE", "")
CONTENT_TYPES = [
    ("ct-text-plain", "text/plain"),
    ("ct-form-urlencoded", "application/x-www-form-urlencoded"),
    ("ct-multipart", "multipart/form-data; boundary=xx"),
    ("ct-octet-stream", "application/octet-stream"),
    ("ct-none", None),
    ("ct-json-charset", "application/json; charset=utf-8"),
    ("ct-vnd-json", "application/vnd.api+json"),
    ("ct-upper", "APPLICATION/JSON"),
]
NON_OBJECTS = [("array", b"[1, 2]"), ("string", b'"text"'), ("number", b"42"), ("null", b"null"),
               ("true", b"true")]
MALFORMED = [("open-brace", b"{"), ("dangling-value", b'{"a": }'), ("trailing-comma", b'{"a": 1,}'),
             ("not-utf8", b"\xff\xfe{}"), ("bare-word", b"hello")]


# ── describe: what to send ───────────────────────────────────────────────────

def _unwrap_optional(ann):
    origin = typing.get_origin(ann)
    if origin is typing.Union or origin is types.UnionType:
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        return (args[0] if args else typing.Any), len(args) < len(typing.get_args(ann))
    return ann, False


def _sample(ann, depth=0):
    from pydantic import BaseModel
    ann, _ = _unwrap_optional(ann)
    origin = typing.get_origin(ann)
    if ann is typing.Any or ann is inspect.Parameter.empty:
        return "x"
    if origin is typing.Literal:
        return typing.get_args(ann)[0]
    if origin in (list, set, tuple, frozenset):
        args = typing.get_args(ann)
        return [_sample(args[0], depth + 1)] if args else []
    if origin is dict or ann is dict:
        return {"k": 1}
    if inspect.isclass(ann):
        if issubclass(ann, BaseModel) and depth < 4:
            return {(f.alias or n): _sample(f.annotation, depth + 1) for n, f in ann.model_fields.items()}
        if issubclass(ann, enum.Enum):
            return list(ann)[0].value
        if issubclass(ann, bool):
            return True
        if issubclass(ann, int):
            return 1
        if issubclass(ann, float):
            return 1.0
        if issubclass(ann, str):
            return "x"
        if issubclass(ann, (list, tuple, set)):
            return []
    return "x"


def _wrong(ann):
    """A value of the wrong JSON type for this annotation, or None when every type fits."""
    ann, _ = _unwrap_optional(ann)
    origin = typing.get_origin(ann)
    if ann is typing.Any:
        return None
    if origin is dict or ann is dict or origin in (list, set, tuple) or ann in (list, set, tuple):
        return "text"
    if inspect.isclass(ann) and issubclass(ann, (bool, int, float)):
        return {"nested": [1]}
    if inspect.isclass(ann) and issubclass(ann, str):
        return {"nested": [1]}
    return [["x"]]


def _swap_case(name: str) -> str:
    if "_" in name:
        head, *rest = name.split("_")
        return head + "".join(p[:1].upper() + p[1:] for p in rest)
    out = "".join("_" + c.lower() if c.isupper() else c for c in name)
    return out if out != name else name + "X"


def _j(value) -> str:
    return json.dumps(value)


def _cases_for(annotation) -> tuple[str, list[dict]]:
    """(kind, cases). A case is {id, group, body (str, latin-1 safe) | body_hex, ctype}."""
    from pydantic import BaseModel
    inner, optional = _unwrap_optional(annotation)
    cases: list[dict] = []

    def add(cid, group, body: bytes, ctype="application/json"):
        cases.append({"id": cid, "group": group, "body_hex": body.hex(), "ctype": ctype})

    is_model = inspect.isclass(inner) and issubclass(inner, BaseModel)
    if is_model:
        kind = "model:" + inner.__name__ + ("?" if optional else "")
        fields = inner.model_fields
        full = {(f.alias or n): _sample(f.annotation) for n, f in fields.items()}
        minimal = {(f.alias or n): _sample(f.annotation) for n, f in fields.items() if f.is_required()}
        add("valid-full", "a valid", _j(full).encode())
        add("valid-minimal", "a valid", _j(minimal).encode())
        for n, f in fields.items():
            key = f.alias or n
            if f.is_required():
                add(f"missing:{key}", "b required field missing", _j({k: v for k, v in full.items() if k != key}).encode())
                add(f"null:{key}", "c wrong type", _j({**full, key: None}).encode())
            else:
                add(f"omitted-optional:{key}", "a valid (defaults)", _j({k: v for k, v in full.items() if k != key}).encode())
                add(f"null-optional:{key}", "a valid (defaults)", _j({**full, key: None}).encode())
            wrong = _wrong(f.annotation)
            if wrong is not None:
                add(f"wrong-type:{key}", "c wrong type", _j({**full, key: wrong}).encode())
            swapped = _swap_case(key)
            add(f"renamed-key:{key}->{swapped}", "aliases",
                _j({**{k: v for k, v in full.items() if k != key}, swapped: full[key]}).encode())
            if f.alias and f.alias != n:
                add(f"field-name-not-alias:{n}", "aliases",
                    _j({**{k: v for k, v in full.items() if k != key}, n: full[key]}).encode())
            sub, _ = _unwrap_optional(f.annotation)
            if inspect.isclass(sub) and issubclass(sub, BaseModel):
                add(f"nested-empty:{key}", "nested models", _j({**full, key: {}}).encode())
        add("extra-field", "d unknown extra field", _j({**full, "no_such_field_zz": 1}).encode())
        valid = _j(full).encode()
    else:
        kind = "dict" + ("?" if optional else "")
        valid = b'{"a": 1, "nested": {"b": [1, "two", null]}, "camelCase": true, "snake_case": 1.5}'
        add("valid-object", "a valid", valid)
        add("valid-empty-object", "a valid", b"{}")
        add("valid-unicode", "a valid", '{"title": "café — \U0001f4c8"}'.encode("utf-8"))
        add("extra-field", "d unknown extra field", b'{"a": 1, "no_such_field_zz": 1}')
    add("empty-body", "e empty body", b"")
    add("empty-body-no-ctype", "e empty body", b"", None)
    add("whitespace-body", "e empty body", b"  \n")
    for cid, body in NON_OBJECTS:
        add("non-object:" + cid, "f non-object JSON", body)
    for cid, body in MALFORMED:
        add("malformed:" + cid, "g malformed JSON", body)
    for cid, ctype in CONTENT_TYPES:
        add(cid, "h content type", valid, ctype)
    # differences that are the point of the change
    cases.append({"id": "anonymous-malformed", "group": "intended: anonymous", "body_hex": b"{".hex(),
                  "ctype": "application/json", "anonymous": True})
    cases.append({"id": "anonymous-valid", "group": "intended: anonymous", "body_hex": valid.hex(),
                  "ctype": "application/json", "anonymous": True})
    cases.append({"id": "declared-oversize", "group": "intended: oversized", "body_hex": valid.hex(),
                  "ctype": "application/json", "declare_over_cap": True})
    return kind, cases


def _describe() -> dict:
    from api.main import app
    from fastapi.routing import APIRoute
    from tests.support import body_census as bc

    routes = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not bc.in_family(route):
            continue
        dep = next((d for d in route.dependant.dependencies
                    if bc._name(d.call) == bc.CAPPED_JSON_QUALNAME), None)
        if dep is None:
            continue
        annotation = inspect.signature(route.endpoint).parameters[dep.name].annotation
        if isinstance(annotation, str):
            annotation = typing.get_type_hints(route.endpoint)[dep.name]
        kind, cases = _cases_for(annotation)
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            routes.append({"method": method, "path": route.path, "param": dep.name, "kind": kind,
                           "module": route.endpoint.__module__, "endpoint": route.endpoint.__name__,
                           "cap": dep.call.max_bytes(), "cases": cases})
    routes.sort(key=lambda r: (r["module"], r["path"], r["method"]))
    return {"routes": routes}


# ── replay: send them ────────────────────────────────────────────────────────

def _dump(value):
    from pydantic import BaseModel
    if isinstance(value, BaseModel):
        return {"__model__": type(value).__name__, "fields": value.model_dump(mode="json"),
                "set": sorted(value.model_fields_set)}
    return value


def _stub_for(original, param: str):
    if inspect.iscoroutinefunction(original):
        async def stub(**kwargs):
            return {"parsed": _dump(kwargs.get(param)), "got_param": param in kwargs}
    else:
        def stub(**kwargs):
            return {"parsed": _dump(kwargs.get(param)), "got_param": param in kwargs}
    return stub


async def _send(app, method, path, body: bytes, headers: list[tuple[bytes, bytes]]):
    sent = False
    out = {"status": None, "body": b""}

    async def receive():
        nonlocal sent
        if sent:
            await asyncio.sleep(3600)
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        if message["type"] == "http.response.start":
            out["status"] = message["status"]
        elif message["type"] == "http.response.body":
            out["body"] += message.get("body", b"")

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
             "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"",
             "root_path": "", "headers": headers, "client": ("127.0.0.1", 5000), "server": ("testserver", 80)}
    await app(scope, receive, send)
    return out


def _normal(status: int, raw: bytes) -> dict:
    try:
        data = json.loads(raw)
    except ValueError:
        return {"status": status, "raw": raw[:200].decode("latin-1")}
    if status == 422 and isinstance(data, dict) and isinstance(data.get("detail"), list):
        return {"status": status, "errors": [
            {"type": e.get("type"), "loc": e.get("loc"), "msg": e.get("msg"),
             "ctx": {k: str(v) for k, v in (e.get("ctx") or {}).items()}} for e in data["detail"]]}
    return {"status": status, "json": data}


def _replay(spec: dict) -> dict:
    import re
    from api.main import app
    from api.services.auth_db import get_connection, init_db
    from api.services.auth_service import create_session, create_user
    from fastapi.routing import APIRoute

    init_db()
    user = create_user(f"fvdiff_{uuid.uuid4().hex}@example.com", "password123")
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = 'admin' WHERE id = ?", (user["id"],))
        conn.execute("INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
                     (uuid.uuid4().hex, user["id"]))
        conn.commit()
    finally:
        conn.close()
    cookie = ("cookie".encode(), f"uct_session={create_session(user['id'])}".encode())

    table = {}
    for route in app.routes:
        if isinstance(route, APIRoute):
            for m in route.methods:
                table.setdefault((m, route.path), route)

    def gates(dependant, acc):
        for d in dependant.dependencies:
            if getattr(d.call, "__qualname__", "") == "_require_enabled":
                acc.add(d.call)
            gates(d, acc)
        return acc

    results = {}
    loop = asyncio.new_event_loop()
    try:
        for r in spec["routes"]:
            key = f"{r['method']} {r['path']}"
            route = table.get((r["method"], r["path"]))
            if route is None:
                results[key] = {"__route__": "missing on this side"}
                continue
            for gate in gates(route.dependant, set()):
                app.dependency_overrides[gate] = lambda: None
            original = route.dependant.call
            route.dependant.call = _stub_for(original, r["param"])
            url = re.sub(r"\{[^}]+\}", "x1", r["path"])
            side = {}
            try:
                for case in r["cases"]:
                    body = bytes.fromhex(case["body_hex"])
                    headers = [] if case.get("anonymous") else [cookie]
                    if case.get("ctype"):
                        headers.append((b"content-type", case["ctype"].encode()))
                    length = r["cap"] + 1 if case.get("declare_over_cap") else len(body)
                    headers.append((b"content-length", str(length).encode()))
                    try:
                        got = loop.run_until_complete(asyncio.wait_for(
                            _send(app, r["method"], url, body, headers), timeout=30))
                        side[case["id"]] = _normal(got["status"], got["body"])
                    except Exception as e:  # noqa: BLE001
                        side[case["id"]] = {"status": "EXCEPTION", "raw": f"{type(e).__name__}: {e}"[:300]}
            finally:
                route.dependant.call = original
            results[key] = side
    finally:
        loop.close()
        app.dependency_overrides.clear()
    return results


def test_body_differential_probe():
    import pytest
    if MODE not in ("describe", "replay"):
        pytest.skip("run by tests/support/run_body_differential.py with FV_DIFF_MODE set")
    out = os.environ["FV_DIFF_OUT"]
    if MODE == "describe":
        data = _describe()
        assert len(data["routes"]) > 50, "the census found too few capped_json routes to mean anything"
    else:
        with open(os.environ["FV_DIFF_CASES"], encoding="utf-8") as fh:
            data = _replay(json.load(fh))
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
