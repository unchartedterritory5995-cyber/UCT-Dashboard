"""TERM-080 (FB-S9-03) -- per-route-family rate limits, staged behind RATE_LIMIT_POLICY.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
`api/rate_limit_policy.py` puts ONE declared policy table over the whole route
table, applied by ONE pure-ASGI middleware through the ONE shared limiter
(`api/limiter.py`), behind ONE mode flag. The rails, each failing for a
different reason:

  (i)   SHADOW never blocks. Past the limit it counts and logs a would-limit,
        and the caller still gets its answer.
  (ii)  ENFORCE past the limit answers 429 with a Retry-After a client can obey
        -- and a client that obeys it is admitted again.
  (iii) The `Authorization: Bearer <PUSH_SECRET>` caller is exempt, and only
        with the REAL secret.
  (iv)  Keys: the MEMBER id for a session, a HASH of the client IP otherwise;
        the raw IP never reaches a log line.
  (v)   OFF (the default) is today's behaviour and reads nothing.
  (vi)  THE CENSUS: every route of the REAL app is in a declared family or is
        exempt with a reason, a new route fails BY NAME, and the census holds in
        the PRODUCTION shape too (a built app/dist and the flow proxy add routes
        a bare checkout does not have -- mirrored from auth_surface_check's
        `requires_dist`).

Plus the wiring: the middleware is INSTALLED on `api.main:app`, inside CORS.

NO NETWORK. Every test here refuses non-loopback sockets. Sessions are
synthetic: `validate_session` is patched on `api.services.auth_service`, which
is exactly where the policy reads it (a lazy import at call time).
"""
from __future__ import annotations

import ast
import logging
import os
import socket
import sys
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Mount

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import rate_limit_policy as rlp  # noqa: E402
from api.limiter import limiter  # noqa: E402

REPO = Path(__file__).resolve().parents[1]

#: A cheap, deterministic route of the REAL app (defined in api/main.py, no IO).
PROBE = "/api/maintenance"
SECRET = "push-secret-for-tests"

MEMBER_A = {"id": "member-a", "email": "a@example.test", "role": "member"}
MEMBER_B = {"id": "member-b", "email": "b@example.test", "role": "member"}
TOKENS = {"tok-a1": MEMBER_A, "tok-a2": MEMBER_A, "tok-b": MEMBER_B}


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    real = socket.socket.connect

    def guarded(self, addr):
        host = addr[0] if isinstance(addr, tuple) else str(addr)
        if host in ("127.0.0.1", "::1", "localhost"):
            return real(self, addr)
        raise OSError(f"test_rate_limit_policy: outbound network refused ({addr})")

    monkeypatch.setattr(socket.socket, "connect", guarded)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    import api.services.auth_service as auth
    monkeypatch.setattr(auth, "validate_session",
                        lambda tok: dict(TOKENS[tok]) if tok in TOKENS else None)
    monkeypatch.delenv(rlp.FLAG, raising=False)
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()
    rlp._reset_state()
    yield
    limiter.reset()
    rlp._reset_state()


@pytest.fixture(scope="module")
def app():
    """THE REAL APP -- the object main.py hands uvicorn. A locally-built app is
    how a severed wire stays green."""
    from api.main import app as real_app
    return real_app


def _client(app, token=None, **headers):
    c = TestClient(app, raise_server_exceptions=False)
    if token:
        c.cookies.set("uct_session", token)
    if headers:
        c.headers.update(headers)
    return c


def _mode(monkeypatch, value):
    if value is None:
        monkeypatch.delenv(rlp.FLAG, raising=False)
    else:
        monkeypatch.setenv(rlp.FLAG, value)


def _limit(monkeypatch, family, limit):
    """Tighten ONE family's declared limit for the duration of a test."""
    fam = rlp.FAMILIES[family]
    monkeypatch.setitem(rlp.FAMILIES, family, fam._replace(limit=limit))


def _probe_family():
    hit = rlp.classify(PROBE)
    assert hit is not None and hit[0] == rlp.KIND_FAMILY, (
        f"{PROBE} must be in a declared family for these rails to mean anything: {hit}")
    return hit[1]


# ── (i) SHADOW never blocks ──────────────────────────────────────────────────

def test_i_SHADOW_never_blocks_past_the_limit(app, monkeypatch):
    fam = _probe_family()
    _limit(monkeypatch, fam, "2/minute")
    _mode(monkeypatch, "shadow")
    c = _client(app)
    codes = [c.get(PROBE).status_code for _ in range(6)]
    assert codes == [200] * 6, f"shadow mode refused a request: {codes}"
    snap = rlp.status_snapshot()
    would = sum(r["count"] for r in snap["over_limit"]
                if r["mode"] == "shadow" and r["family"] == fam)
    assert would == 4, f"shadow must COUNT every would-limit (6 sent, limit 2): {snap}"


def test_i_SHADOW_logs_a_would_limit_ONCE_per_key_per_minute(app, monkeypatch, caplog):
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, "shadow")
    c = _client(app)
    with caplog.at_level(logging.WARNING, logger="api.rate_limit_policy"):
        for _ in range(5):
            assert c.get(PROBE).status_code == 200
    lines = [r.getMessage() for r in caplog.records if "would-limit" in r.getMessage()]
    assert len(lines) == 1, f"one log line per (family, key, minute), got {lines}"
    assert f"family={fam}" in lines[0] and "mode=shadow" in lines[0], lines[0]


def test_i_an_UNKNOWN_mode_is_shadow_never_a_block_and_never_silent(app, monkeypatch, caplog):
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, "enforec")                       # a typo
    c = _client(app)
    with caplog.at_level(logging.WARNING, logger="api.rate_limit_policy"):
        codes = [c.get(PROBE).status_code for _ in range(3)]
    assert codes == [200, 200, 200], codes
    assert rlp.mode() == rlp.MODE_SHADOW
    assert any("would-limit" in r.getMessage() for r in caplog.records)


# ── (ii) ENFORCE: 429 + Retry-After, and a client that obeys it ──────────────

def test_ii_ENFORCE_answers_429_with_Retry_After_past_the_limit(app, monkeypatch):
    fam = _probe_family()
    _limit(monkeypatch, fam, "2/minute")
    _mode(monkeypatch, "enforce")
    c = _client(app)
    assert c.get(PROBE).status_code == 200
    assert c.get(PROBE).status_code == 200
    r = c.get(PROBE)
    assert r.status_code == 429, (r.status_code, r.text[:200])
    ra = r.headers.get("retry-after")
    assert ra is not None and ra.isdigit(), f"no integer Retry-After: {dict(r.headers)}"
    assert 1 <= int(ra) <= 60, ra
    assert r.headers.get("x-ratelimit-limit") == "2"
    assert r.headers.get("x-ratelimit-remaining") == "0"
    assert int(r.headers["x-ratelimit-reset"]) >= int(time.time())
    body = r.json()
    assert body["family"] == fam and body["retry_after"] == int(ra), body
    assert "detail" in body


def test_ii_a_client_that_OBEYS_Retry_After_is_admitted_again(app, monkeypatch):
    """FB-S9-03's own acceptance: "a 429 carries a reset header a client can
    obey, proved by a client that obeys it"."""
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/second")
    _mode(monkeypatch, "enforce")
    c = _client(app)
    assert c.get(PROBE).status_code == 200
    r = c.get(PROBE)
    assert r.status_code == 429
    time.sleep(int(r.headers["retry-after"]) + 0.2)     # the obedient client
    assert c.get(PROBE).status_code == 200


def test_ii_ENFORCE_under_the_limit_is_untouched(app, monkeypatch):
    fam = _probe_family()
    _limit(monkeypatch, fam, "50/minute")
    _mode(monkeypatch, "enforce")
    c = _client(app)
    assert [c.get(PROBE).status_code for _ in range(5)] == [200] * 5


def test_ii_ENFORCE_fails_OPEN_when_the_limiter_itself_errors(app, monkeypatch, caplog):
    """A rate limiter that can take the site down is a worse outage than the one
    it prevents. A broken limiter logs and lets the request through."""
    _mode(monkeypatch, "enforce")

    def boom(*a, **k):
        raise RuntimeError("storage exploded")

    monkeypatch.setattr(limiter.limiter, "hit", boom)
    with caplog.at_level(logging.WARNING, logger="api.rate_limit_policy"):
        assert _client(app).get(PROBE).status_code == 200
    assert any("failed open" in r.getMessage() for r in caplog.records)


# ── (iii) the PUSH_SECRET bearer is exempt ───────────────────────────────────

def test_iii_the_PUSH_SECRET_bearer_is_never_limited(app, monkeypatch):
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, "enforce")
    internal = _client(app, authorization=f"Bearer {SECRET}")
    assert [internal.get(PROBE).status_code for _ in range(5)] == [200] * 5
    # ...and the same caller WITHOUT it is limited, so the exemption is doing it.
    anon = _client(app)
    assert anon.get(PROBE).status_code == 200
    assert anon.get(PROBE).status_code == 429


def test_iii_a_WRONG_or_BLANK_secret_is_not_the_exemption(app, monkeypatch):
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, "enforce")
    wrong = _client(app, authorization="Bearer not-the-secret")
    assert wrong.get(PROBE).status_code == 200
    assert wrong.get(PROBE).status_code == 429
    limiter.reset()
    monkeypatch.setenv("PUSH_SECRET", "")
    blank = _client(app, authorization="Bearer ")
    assert blank.get(PROBE).status_code == 200
    assert blank.get(PROBE).status_code == 429, \
        "an unset PUSH_SECRET must exempt NOBODY, not everybody"


# ── (iv) keys: member for a session, hashed IP otherwise ─────────────────────

def test_iv_a_session_is_keyed_on_the_MEMBER_not_the_session(app, monkeypatch):
    fam = _probe_family()
    _limit(monkeypatch, fam, "2/minute")
    _mode(monkeypatch, "enforce")
    # member A, two different sessions: ONE bucket
    assert _client(app, "tok-a1").get(PROBE).status_code == 200
    assert _client(app, "tok-a2").get(PROBE).status_code == 200
    assert _client(app, "tok-a1").get(PROBE).status_code == 429
    # member B from the same address: its own bucket
    assert _client(app, "tok-b").get(PROBE).status_code == 200


def test_iv_anonymous_callers_are_keyed_on_their_IP(app, monkeypatch):
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, "enforce")
    one = _client(app, **{"x-forwarded-for": "198.51.100.23, 10.0.0.1"})
    two = _client(app, **{"x-forwarded-for": "198.51.100.77, 10.0.0.1"})
    assert one.get(PROBE).status_code == 200
    assert one.get(PROBE).status_code == 429
    assert two.get(PROBE).status_code == 200, "a different client IP is a different bucket"
    # an invalid session cookie is anonymous, not a free bucket of its own
    bogus = _client(app, "tok-nobody", **{"x-forwarded-for": "198.51.100.23, 10.0.0.1"})
    assert bogus.get(PROBE).status_code == 429


def test_iv_the_log_carries_an_IP_HASH_never_the_raw_IP(app, monkeypatch, caplog):
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, "shadow")
    raw = "198.51.100.199"
    c = _client(app, **{"x-forwarded-for": f"{raw}, 10.0.0.1"})
    with caplog.at_level(logging.DEBUG):
        for _ in range(3):
            c.get(PROBE)
    text = caplog.text + repr(rlp.status_snapshot())
    assert "would-limit" in text
    assert raw not in text, "the raw client IP reached a log line or the status read"
    assert "key=ip:" in caplog.text


def test_iv_the_member_lookup_is_CACHED_not_a_db_read_per_request(app, monkeypatch):
    import api.services.auth_service as auth
    calls = []

    def counting(tok):
        calls.append(tok)
        return dict(TOKENS[tok]) if tok in TOKENS else None

    monkeypatch.setattr(auth, "validate_session", counting)
    fam = _probe_family()
    _limit(monkeypatch, fam, "100/minute")
    _mode(monkeypatch, "shadow")
    c = _client(app, "tok-b")
    for _ in range(5):
        assert c.get(PROBE).status_code == 200
    assert calls == ["tok-b"], f"one session lookup per session per TTL, got {calls}"


# ── (v) OFF is today's behaviour ─────────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "", "off", "0", "false"])
def test_v_OFF_never_limits_and_reads_nothing(app, monkeypatch, value):
    import api.services.auth_service as auth

    def must_not_be_called(tok):
        raise AssertionError("the policy read a session while OFF")

    monkeypatch.setattr(auth, "validate_session", must_not_be_called)
    fam = _probe_family()
    _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, value)
    c = _client(app, "tok-a1")
    assert [c.get(PROBE).status_code for _ in range(4)] == [200] * 4
    assert rlp.status_snapshot()["over_limit"] == []


def test_v_the_flag_is_declared_as_a_MODE_with_OFF_as_its_default():
    from api.services import feature_flag_index as ffi
    found = ffi.mode_flags([REPO / "api"], REPO)
    assert rlp.FLAG in found, "the mode table must be visible to the flag index"
    assert found[rlp.FLAG]["default"] == rlp.MODE_OFF
    assert set(found[rlp.FLAG]["allowed"]) == {rlp.MODE_OFF, rlp.MODE_SHADOW, rlp.MODE_ENFORCE}


def test_v_an_EXEMPT_path_is_never_limited_under_enforce(app, monkeypatch):
    for fam in list(rlp.FAMILIES):
        _limit(monkeypatch, fam, "1/minute")
    _mode(monkeypatch, "enforce")
    hit = rlp.classify("/api/health")
    assert hit is not None and hit[0] == rlp.KIND_EXEMPT, hit
    c = _client(app)
    assert [c.get("/api/health").status_code for _ in range(3)] == [200] * 3


# ── (vi) THE CENSUS ──────────────────────────────────────────────────────────

def _fmt(res):
    return (f"unclassified={res['unclassified']} stale={res['stale']} "
            f"dist_only_undeclared={res['dist_only_undeclared']}")


def test_vi_every_route_of_the_REAL_app_is_declared_or_exempt(app):
    res = rlp.census(app)
    assert res["routes"] > 500, f"the census examined almost nothing: {res['routes']}"
    assert not res["unclassified"], (
        "these routes are in NO declared rate-limit family and are not exempt. "
        "Add their prefix to a family in api/rate_limit_policy.py FAMILIES, or to "
        "EXEMPT with a reason:\n  " + "\n  ".join(res["unclassified"]))
    assert not res["stale"], (
        "these declared prefixes match NO route (a typo, or a retired router): "
        + ", ".join(res["stale"]))
    assert res["ok"], _fmt(res)
    # the buckets close over what was examined
    assert sum(res["by_family"].values()) + res["exempt"] == res["routes"]


def test_vi_a_NEW_undeclared_route_fails_the_census_BY_NAME(app):
    a = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    a.router.routes.extend(app.routes)
    a.get("/api/zz-brand-new-family/{x}")(lambda x: x)
    res = rlp.census(a)
    assert res["unclassified"] == ["/api/zz-brand-new-family/{x}"], _fmt(res)
    assert res["ok"] is False
    # control: the same app WITHOUT the new route is clean
    assert rlp.census(app)["ok"] is True


def test_vi_a_new_route_under_a_DECLARED_prefix_inherits_its_family(app):
    """Default-plus-override: a route added under an existing family's prefix is
    covered by that family's limit, so nobody hand-writes a decorator for it."""
    hit = rlp.classify("/api/bars/{ticker}/some-new-read")
    assert hit is not None and hit[0] == rlp.KIND_FAMILY and hit[2] == "/api/bars", hit


def test_vi_a_declared_prefix_matching_NOTHING_is_stale(app, monkeypatch):
    fam = next(iter(rlp.FAMILIES))
    f = rlp.FAMILIES[fam]
    monkeypatch.setitem(rlp.FAMILIES, fam,
                        f._replace(prefixes=f.prefixes + ("/api/no-such-router-at-all",)))
    res = rlp.census(app)
    assert res["stale"] == ["/api/no-such-router-at-all"], _fmt(res)
    assert res["ok"] is False


#: The `app.<attr>(path, ...)` calls that register a path. Only these are
#: required to resolve: `@app.exception_handler(SomeError)` is not a path.
_ROUTE_ATTRS = frozenset({"get", "post", "put", "patch", "delete", "head", "options",
                          "api_route", "route", "websocket", "mount"})


class UnresolvedDistPath(AssertionError):
    pass


def _dist_registrations_from_main_py(src: str | None = None) -> dict[str, str]:
    """`{path: "route"|"mount"}` for what api/main.py registers ONLY under
    `if os.path.exists(DIST):`, read by AST -- never typed here.

    ⛔ A path expression it cannot resolve (an f-string, a call, an imported
    name) RAISES, naming the line, instead of being skipped: a skipped route is
    one the census never sees."""
    tree = ast.parse(src if src is not None else (REPO / "api" / "main.py").read_text(encoding="utf-8"))

    def is_dist_guard(test):
        return (isinstance(test, ast.Call) and isinstance(test.func, ast.Attribute)
                and test.func.attr == "exists" and len(test.args) == 1
                and isinstance(test.args[0], ast.Name) and test.args[0].id == "DIST")

    out: dict[str, str] = {}

    # Module-level string constants, so a path written as a NAME
    # (`@app.api_route(LIVE_TRADING_ROOM_PATH + "/terms", ...)`) is resolved
    # instead of silently skipped. A literal-only reader missed the six
    # /live-trading-room routes for weeks, and the census only met them when a
    # local build happened to exist.
    consts: dict[str, str] = {}

    def resolve(expr):
        if isinstance(expr, ast.Constant) and isinstance(expr.value, str):
            return expr.value
        if isinstance(expr, ast.Name):
            return consts.get(expr.id)
        if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
            left, right = resolve(expr.left), resolve(expr.right)
            return left + right if left is not None and right is not None else None
        return None

    for node in tree.body:
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)):
            val = resolve(node.value)
            if val is not None:
                consts[node.targets[0].id] = val

    def norm(path):
        # classify() strips a trailing slash, so the policy cannot (and need not)
        # declare `/x/` apart from `/x`.
        return path if path == rlp.SPA_CATCH_ALL else (path.rstrip("/") or "/")

    unresolved: list[str] = []

    def path_of(call):
        """The resolved path of an `app.<route attr>(path, ...)` call, else None."""
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                and isinstance(call.func.value, ast.Name) and call.func.value.id == "app"
                and call.func.attr in _ROUTE_ATTRS and call.args):
            return None
        path = resolve(call.args[0])
        if path is None:
            unresolved.append(f"main.py:{call.lineno} app.{call.func.attr}({ast.unparse(call.args[0])})")
        return path

    def collect(node):
        for sub in ast.walk(node):
            if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in sub.decorator_list:
                    path = path_of(dec)
                    if path is not None:
                        out[norm(path)] = "route"
            if isinstance(sub, ast.Call) and getattr(sub.func, "attr", None) == "mount":
                path = path_of(sub)
                if path is not None:
                    out[norm(path)] = "mount"

    for node in tree.body:
        if isinstance(node, ast.If) and is_dist_guard(node.test):
            collect(node)
    if unresolved:
        raise UnresolvedDistPath(
            "these DIST-guard registrations have a path the census reader cannot resolve, so it "
            "would never see them; write the path as a literal or a module-level string constant: "
            + "; ".join(unresolved))
    return out


def test_vi_the_DIST_reader_resolves_every_path_in_main_py():
    # The real file: every app.<route>(path) under the DIST guard resolved (no raise).
    assert rlp.SPA_CATCH_ALL in _dist_registrations_from_main_py()


def test_THE_CONTROL_an_unresolvable_DIST_path_fails_by_name():
    src = "\n".join([
        "import os",
        "P = '/known'",
        "if os.path.exists(DIST):",
        "    @app.get(P + '/ok')",
        "    def ok(): pass",
        "    @app.get(f'/x/{P}')",
        "    def bad(): pass",
        "    app.mount(make_path(), None)",
        "    @app.exception_handler(ValueError)",
        "    def handler(): pass",
    ]) + "\n"
    with pytest.raises(UnresolvedDistPath) as exc:
        _dist_registrations_from_main_py(src)
    msg = str(exc.value)
    assert "main.py:6 app.get(f'/x/{P}')" in msg and "main.py:8 app.mount(make_path())" in msg, msg
    assert "exception_handler" not in msg, msg     # not a path, so not required to resolve


def _dist_only_from_main_py() -> set[str]:
    return set(_dist_registrations_from_main_py())


def test_vi_DIST_ONLY_is_exactly_what_main_py_registers_under_the_DIST_guard():
    derived = _dist_only_from_main_py()
    assert rlp.SPA_CATCH_ALL in derived, f"the derivation found no SPA catch-all: {derived}"
    assert len(derived) >= 8, f"the derivation is suspiciously small: {derived}"
    assert set(rlp.DIST_ONLY) == derived, (
        f"missing from DIST_ONLY: {sorted(derived - set(rlp.DIST_ONLY))}; "
        f"not dist-only: {sorted(set(rlp.DIST_ONLY) - derived)}")


def _production_shape(app, *, dist=True, proxy=True, drop=()):
    """The routes production serves and a bare checkout does not: the flow read
    proxy (FLOW_READS_PROXY_ENABLED on web) and the app/dist bundle."""
    from api import flow_proxy
    a = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    if proxy:
        a.include_router(flow_proxy.build_flow_proxy_router())
    # The real app ALREADY carries the dist routes in any checkout with a built
    # app/dist, so copying them wholesale makes `drop=` a no-op there (the route
    # survives via the copy) and the shape stops depending on `dist=`. Strip them
    # from the copy; the block below is their one source.
    dist_paths = set(_dist_registrations_from_main_py()) | {rlp.SPA_CATCH_ALL}
    a.router.routes.extend(r for r in app.routes
                           if getattr(r, "path", None) not in dist_paths)
    if dist:
        for path, how in sorted(_dist_registrations_from_main_py().items()):
            if path in drop or path == rlp.SPA_CATCH_ALL:
                continue
            if how == "mount":
                a.router.routes.append(Mount(path, app=Starlette()))
            else:
                a.get(path)(lambda: "x")
        if rlp.SPA_CATCH_ALL not in drop:
            a.get(rlp.SPA_CATCH_ALL)(lambda full_path: "spa")   # registered LAST, as in main.py
    return a


def test_vi_the_census_holds_in_the_PRODUCTION_shape_with_dist_and_the_flow_proxy(app):
    res = rlp.census(_production_shape(app))
    assert res["ok"], _fmt(res)
    assert res["dist_served"] and res["proxy_served"], res


def _app_with_a_built_dist(app, dist_dir):
    """The real app as production serves it: main.py's OWN `if
    os.path.exists(DIST):` blocks, executed against a throwaway FastAPI with
    DIST pointed at a temporary bundle. Not a list of paths restated here, and
    never app/dist: what registers is whatever main.py registers."""
    import api.main as m
    for sub in ("assets", "fonts", "live-trading-room"):
        (dist_dir / sub).mkdir(parents=True, exist_ok=True)
    (dist_dir / "index.html").write_text("<!doctype html>", encoding="utf-8")
    tree = ast.parse(MAIN_SRC())
    blocks = [n for n in tree.body if isinstance(n, ast.If)
              and isinstance(n.test, ast.Call) and isinstance(n.test.func, ast.Attribute)
              and n.test.func.attr == "exists" and len(n.test.args) == 1
              and isinstance(n.test.args[0], ast.Name) and n.test.args[0].id == "DIST"]
    assert blocks, "found no DIST guard in api/main.py"
    built = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    scope = dict(vars(m))
    scope.update(app=built, DIST=str(dist_dir))
    for block in blocks:
        exec(compile(ast.Module(body=[block], type_ignores=[]), str(REPO / "api" / "main.py"), "exec"), scope)
    whole = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    dist_paths = {getattr(r, "path", None) for r in built.routes}
    whole.router.routes.extend(r for r in app.routes if getattr(r, "path", None) not in dist_paths)
    whole.router.routes.extend(built.routes)
    return whole, built


def MAIN_SRC():
    return (REPO / "api" / "main.py").read_text(encoding="utf-8")


def test_vi_with_a_BUILT_bundle_every_route_is_declared_or_exempt(app, tmp_path):
    whole, built = _app_with_a_built_dist(app, tmp_path / "dist")
    paths = {getattr(r, "path", None) for r in built.routes}
    # non-vacuity: the executed block really registered the bundle's routes
    assert rlp.SPA_CATCH_ALL in paths and "/live-trading-room" in paths, sorted(p for p in paths if p)
    res = rlp.census(whole)
    assert res["dist_served"] is True, res
    assert not res["unclassified"], _fmt(res)
    assert not res["stale"] and not res["dist_only_undeclared"], _fmt(res)


def test_vi_a_dist_only_entry_is_NOT_stale_without_a_bundle_and_IS_stale_with_one(app):
    # bare checkout: the dist-only declarations are excused
    assert rlp.census(app)["ok"] is True
    # a built bundle that is MISSING one of its routes: now it is stale
    res = rlp.census(_production_shape(app, drop=("/robots.txt",)))
    assert res["stale"] == ["/robots.txt"], _fmt(res)


def test_vi_the_table_is_well_formed():
    from limits import parse
    seen = {}
    for name, fam in rlp.FAMILIES.items():
        parse(fam.limit)                                   # every limit parses
        assert len(fam.reason) >= 20, f"{name}: a family needs a reason"
        for p in fam.prefixes:
            assert p.startswith("/") and "{" not in p and not p.endswith("/"), (name, p)
            assert p not in seen, f"{p} declared twice ({seen[p]}, {name})"
            seen[p] = name
    for p, why in rlp.EXEMPT.items():
        assert p not in seen, f"{p} is both a family prefix and exempt"
        assert len(why) >= 20, f"{p}: an exemption needs a reason"
        assert "{" not in p or p in rlp.DIST_ONLY, p
    for p in rlp.DIST_ONLY:
        assert p in seen or p in rlp.EXEMPT, f"dist-only {p} is declared nowhere"


# ── wiring ───────────────────────────────────────────────────────────────────

def test_the_middleware_is_INSTALLED_on_the_real_app_inside_CORS(app):
    order = [getattr(m.cls, "__name__", str(m.cls)) for m in app.user_middleware]
    assert "RateLimitPolicyMiddleware" in order, order
    # Starlette prepends: index 0 is outermost. Inside CORS so a 429 still
    # carries CORS headers a browser can read.
    assert order.index("CORSMiddleware") < order.index("RateLimitPolicyMiddleware"), order


def test_the_policy_uses_THE_shared_limiter_not_a_second_one():
    import api.limiter as lim
    assert rlp.limiter is lim.limiter


def test_the_status_read_is_admin_only(app):
    from api import auth_surface_check as asc
    route = next(r for r in app.routes if getattr(r, "path", "") == rlp.STATUS_PATH)
    assert "require_admin" in asc._guard_names_for(route)
    assert _client(app).get(rlp.STATUS_PATH).status_code in (401, 403)


def test_the_render_pages_are_EXEMPT_so_enforcement_cannot_fail_a_discord_render():
    """Owner ruling 2026-09-30: enforce, but never 429 the chart-renderer. Its
    /api/r/* reads are exempt; its /api/bars/* never reach web (bars-edge-router)."""
    hit = rlp.classify("/api/r/chart-settings")
    assert hit is not None and hit[0] == rlp.KIND_EXEMPT, hit
    assert "render" not in rlp.FAMILIES
    # the control: an ordinary market-data read is still limited
    assert rlp.classify("/api/ticker-meta/NVDA")[0] != rlp.KIND_EXEMPT


# ── chosen families, pinned ──────────────────────────────────────────────────
#
# The census proves every route is in SOME family; it cannot see a prefix
# moved to the WRONG one (say /api/study into the 60/minute intake tier).
# Each row is a concrete request path and the family it was placed in on
# purpose, with the reason in rate_limit_policy.py beside the prefix.
PINNED_FAMILIES = [
    ("/api/study/today", "community-content"),
    ("/api/study/attempts/12/step", "community-content"),
    ("/api/study/admin/items/si_a/bars", "study-review"),
    ("/api/study/admin/review", "study-review"),
    ("/api/wisdom/archive/ticker/NVDA", "research"),
    ("/api/wisdom/team-calls", "research"),
    ("/api/wisdom/archive/image/img_1", "archive-images"),
    ("/api/tsdr-lessons/link-transcript", "internal"),
    ("/api/time-and-sales/status", "admin-ops"),
]


def _family_of(path, index=None):
    hit = rlp.classify(path, index)
    assert hit is not None and hit[0] == rlp.KIND_FAMILY, (path, hit)
    return hit[1]


@pytest.mark.parametrize("path,family", PINNED_FAMILIES)
def test_each_new_prefix_is_in_the_family_it_was_placed_in(path, family):
    assert _family_of(path) == family


def test_THE_CONTROL_the_pin_sees_a_prefix_moved_to_another_family(monkeypatch):
    # Move /api/study into public-intake in a copy of the table: the pin's
    # lookup must then answer the new family, or the rows above prove nothing.
    fams = dict(rlp.FAMILIES)
    cc = fams["community-content"]
    fams["community-content"] = cc._replace(
        prefixes=tuple(p for p in cc.prefixes if p != "/api/study"))
    pi = fams["public-intake"]
    fams["public-intake"] = pi._replace(prefixes=pi.prefixes + ("/api/study",))
    moved = rlp.build_index(fams)
    assert _family_of("/api/study/today", moved) == "public-intake"
    assert _family_of("/api/study/today") == "community-content"
