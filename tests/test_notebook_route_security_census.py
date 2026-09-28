"""Wave 10 lane 10E-2 -- the Notebook route security census, as a rail.

`docs/notebook/security-review-notebook-routes.md` classifies EVERY Notebook route mounted on
the real app: its auth dependency, whether it is paid-gated, its flag gate, its rate limit, its
ownership scope and its size bound. This file holds that table to the app, so the review cannot
quietly go stale:

* a Notebook route the table does not name FAILS (an unclassified route), and so does a row
  naming a route the app no longer serves (a stale row);
* the columns that can be read off the app are READ and compared, never trusted: the auth class
  and the paid gate come from each route's dependency tree, the flag gate is exercised (the
  router-level `_require_enabled` must refuse with its env var unset and pass with it set), a
  `slowapi` limit is read from the limiter's own registry, and every in-handler guard the table
  names (`none: compare_digest`, `in-handler: enforce_rate`, ...) must appear in that handler's
  source;
* what cannot be read off the app (ownership, size bound) must be written, never blank. Those
  cells are the reviewer's findings; the cross-tenant probe that measured the ownership column is
  `docs/notebook/proof/e2-d9e887ca0/security/cross_tenant_probe.py` and its record.

WHICH ROUTES ARE "NOTEBOOK" is decided by a deliberately BROAD net (`is_candidate`): every route
whose handler lives in a Notebook router module, every path naming the notebook, every `/api/j2/`
path with a Notebook segment, and every path anywhere with a segment containing "note". Whatever
the net catches must be classified or listed as excluded WITH A REASON -- so a new Notebook route
mounted tomorrow reds here the day it lands, whatever it is called.

Under pytest the repo-root conftest has already pinned every /data path to a sandbox and armed
the tripwire, so importing the real app is safe here (it is NOT safe bare) -- the same idiom as
tests/test_main_router_order.py.

CONTROLS (rule: a rail that cannot fail is not a rail). Each derived check is shown failing on a
planted defect: a route added to a real router copy that the table does not name, a table row
whose auth class is changed, a stale row, a flag row naming the wrong env var, and an in-handler
guard token that is not in the source.
"""
from __future__ import annotations

import inspect
import re
from pathlib import Path

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.routing import APIRoute

REPO = Path(__file__).resolve().parent.parent
DOC = REPO / "docs" / "notebook" / "security-review-notebook-routes.md"
BEGIN, END = "<!-- ROUTE-CENSUS:BEGIN -->", "<!-- ROUTE-CENSUS:END -->"
XBEGIN, XEND = "<!-- ROUTE-EXCLUDED:BEGIN -->", "<!-- ROUTE-EXCLUDED:END -->"

NB_MODULE_PREFIXES = ("api.routers.notebook_", "api.routers.note_sync", "api.routers.capture_auth")
J2_SEGMENT = re.compile(
    r"^(notes?|note-[a-z-]+|notebook[a-z-]*|property-defs|saved-views|facts|evidence|excerpts|inbox|"
    r"capture|ask|telemetry|link-preview|share|shared|publish|published|export|onboarding|personal|"
    r"inbound-email)$")

AUTH_CLASSES = ("admin", "session", "optional-session", "capture-scope", "personal-bearer", "none")


# ── derivation (shared with the doc's generator; the doc never restates a rule) ──────────────

def is_candidate(path: str, module: str | None) -> bool:
    """The broad net. Anything it catches is a Notebook route unless the doc excludes it by name."""
    module = module or ""
    if module.startswith(NB_MODULE_PREFIXES):
        return True
    if "notebook" in path.lower():
        return True
    segs = [s for s in path.split("/") if s]
    if path.startswith("/api/j2/") and any(J2_SEGMENT.match(s) for s in segs[2:]):
        return True
    return any("note" in s.lower() for s in segs if not s.startswith("{"))


def candidates(app):
    """[(route, (METHOD, path))] for every APIRoute the net catches, one entry per method."""
    out = []
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        if not is_candidate(r.path, getattr(r.endpoint, "__module__", None)):
            continue
        for m in sorted(r.methods or []):
            out.append((r, (m, r.path)))
    return out


def _dep_names(dependant, acc=None):
    acc = [] if acc is None else acc
    for d in dependant.dependencies:
        acc.append(getattr(d.call, "__qualname__", getattr(d.call, "__name__", repr(d.call))))
        _dep_names(d, acc)
    return acc


def _dep_calls(dependant, acc=None):
    acc = [] if acc is None else acc
    for d in dependant.dependencies:
        acc.append(d.call)
        _dep_calls(d, acc)
    return acc


def derive(route) -> dict:
    """What the app itself says about a route: its auth class, paid gate, flag dependency and
    slowapi registration. Read from the dependency tree, never typed per route."""
    names = set(_dep_names(route.dependant))
    if "require_admin" in names:
        auth = "admin"
    elif "require_capture_scope.<locals>.dependency" in names:
        auth = "capture-scope"
    elif "personal_scope.<locals>.dependency" in names:
        auth = "personal-bearer"
    elif names & {"get_current_user", "require_paid", "require_plan.<locals>.checker", "get_current_user_with_plan"}:
        auth = "session"
    elif "get_current_user_optional" in names:
        auth = "optional-session"
    else:
        auth = "none"
    from api.limiter import limiter
    ep = route.endpoint
    slow = f"{ep.__module__}.{ep.__name__}" in getattr(limiter, "_route_limits", {})
    return {"auth": auth,
            "paid": bool(names & {"require_paid", "require_plan.<locals>.checker"}),
            "flag_dep": "_require_enabled" in names,
            "slowapi": slow}


def handler_source(route) -> str:
    fn = inspect.unwrap(route.endpoint)
    try:
        return inspect.getsource(fn)
    except (OSError, TypeError):
        return ""


# ── the doc's tables ─────────────────────────────────────────────────────────────────────────

def _rows_between(text: str, begin: str, end: str) -> list[list[str]]:
    if begin not in text or end not in text:
        raise AssertionError(f"{DOC.name}: markers {begin} / {end} not found")
    block = text.split(begin, 1)[1].split(end, 1)[0]
    rows = []
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("|") or set(line) <= set("|-: "):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and cells[0].lower() == "method":
            continue
        rows.append(cells)
    return rows


def parse_doc(text: str):
    table = {}
    for cells in _rows_between(text, BEGIN, END):
        if len(cells) < 8:
            raise AssertionError(f"census row has {len(cells)} cells, needs 9: {cells}")
        method, path = cells[0], cells[1].strip("`")
        table[(method, path)] = {"auth": cells[2], "paid": cells[3], "flag": cells[4], "rate": cells[5],
                                 "own": cells[6], "size": cells[7]}
    excluded = {}
    for cells in _rows_between(text, XBEGIN, XEND):
        excluded[(cells[0], cells[1].strip("`"))] = cells[2] if len(cells) > 2 else ""
    return table, excluded


def _token(cell: str) -> str | None:
    """`none: compare_digest` -> 'compare_digest'; `in-handler: enforce_rate` -> 'enforce_rate'."""
    if ":" not in cell:
        return None
    tok = cell.split(":", 1)[1].strip().strip("`")
    return tok or None


def census_problems(pairs, table: dict, excluded: dict) -> list[str]:
    """Every disagreement between the live routes and the doc, as sentences."""
    problems = []
    live = {}
    for route, key in pairs:
        live[key] = route
    for key, route in live.items():
        if key in excluded:
            if not excluded[key]:
                problems.append(f"EXCLUDED WITHOUT A REASON: {key}")
            continue
        row = table.get(key)
        if row is None:
            problems.append(f"UNCLASSIFIED Notebook route: {key[0]} {key[1]} "
                            f"({route.endpoint.__module__}.{route.endpoint.__name__})")
            continue
        d = derive(route)
        src = handler_source(route)
        auth_cls = row["auth"].split(":", 1)[0].strip()
        if auth_cls not in AUTH_CLASSES:
            problems.append(f"UNKNOWN auth class {row['auth']!r} for {key}")
        elif auth_cls != d["auth"]:
            problems.append(f"AUTH MISMATCH {key}: doc says {auth_cls!r}, the app's dependencies say {d['auth']!r}")
        tok = _token(row["auth"])
        if d["auth"] == "none" and not tok:
            problems.append(f"NO-DEPENDENCY route {key} must name its in-handler guard (`none: <token>`)")
        if tok and tok not in src:
            problems.append(f"GUARD NOT IN SOURCE {key}: {tok!r} does not appear in the handler")
        paid = row["paid"]
        if paid == "yes" and not d["paid"]:
            problems.append(f"PAID MISMATCH {key}: doc says yes, no paid dependency")
        if paid == "no" and d["paid"]:
            problems.append(f"PAID MISMATCH {key}: doc says no, the route depends on a paid gate")
        if paid.startswith("in-handler"):
            ptok = _token(paid)
            if d["paid"] or not ptok or ptok not in src:
                problems.append(f"PAID in-handler claim unproved for {key}: {paid!r}")
        flag = row["flag"]
        if flag.startswith("dep") != d["flag_dep"]:
            problems.append(f"FLAG MISMATCH {key}: doc {flag!r}, router-level gate present={d['flag_dep']}")
        if flag.startswith("in-handler"):
            ftok = _token(flag)
            if not ftok or ftok not in src:
                problems.append(f"FLAG in-handler claim unproved for {key}: {flag!r}")
        rate = row["rate"]
        if rate.startswith("slowapi") != d["slowapi"]:
            problems.append(f"RATE MISMATCH {key}: doc {rate!r}, slowapi-registered={d['slowapi']}")
        if rate.startswith("in-handler"):
            rtok = _token(rate)
            if not rtok or rtok not in src:
                problems.append(f"RATE in-handler claim unproved for {key}: {rate!r}")
        for col in ("own", "size"):
            if not row[col]:
                problems.append(f"BLANK {col} for {key}")
    for key in table:
        if key not in live:
            problems.append(f"STALE row: {key[0]} {key[1]} is not served by the app")
    for key in excluded:
        if key not in live:
            problems.append(f"STALE exclusion: {key[0]} {key[1]} is not served by the app")
    return problems


@pytest.fixture(scope="module")
def real_app():
    from api.main import app  # noqa: WPS433 -- late import under the conftest sandbox
    return app


@pytest.fixture(scope="module")
def doc_tables():
    return parse_doc(DOC.read_text(encoding="utf-8"))


# ── the rail ─────────────────────────────────────────────────────────────────────────────────

def test_every_notebook_route_on_the_real_app_is_classified_and_agrees(real_app, doc_tables):
    table, excluded = doc_tables
    problems = census_problems(candidates(real_app), table, excluded)
    assert not problems, "the Notebook route census disagrees with the app:\n  " + "\n  ".join(problems)


def test_the_census_is_not_vacuous(real_app, doc_tables):
    table, excluded = doc_tables
    pairs = candidates(real_app)
    keys = {k for _, k in pairs}
    # Anchors, one per family: an empty net or an empty table would otherwise pass everything.
    for anchor in [("GET", "/api/j2/notes/{note_id}"), ("PUT", "/api/j2/notes/{note_id}"),
                   ("GET", "/api/j2/shared/{token}"), ("GET", "/api/j2/published/{slug}"),
                   ("POST", "/api/j2/personal/notes"), ("POST", "/api/j2/inbound-email"),
                   ("POST", "/api/j2/capture"), ("GET", "/api/j2/notes/connectors/status"),
                   ("GET", "/api/admin/notebook-soak")]:
        assert anchor in keys, f"the net lost {anchor}"
        assert anchor in table, f"the census table lost {anchor}"
    assert len(table) >= 140, f"only {len(table)} classified rows -- the table was truncated"
    assert len(excluded) >= 5, "the exclusion list is empty: the net is not being exercised"


def test_the_flag_gates_are_the_env_vars_the_census_names(real_app, doc_tables, monkeypatch):
    """`dep: ENV` is exercised: the router's own `_require_enabled` refuses with ENV unset and
    passes with ENV=1 -- the env var is the gate, not a word in the doc."""
    from fastapi import HTTPException
    table, _ = doc_tables
    checked = set()
    for route, key in candidates(real_app):
        row = table.get(key)
        if not row or not row["flag"].startswith("dep"):
            continue
        env = _token(row["flag"])
        gate = next(c for c in _dep_calls(route.dependant) if getattr(c, "__name__", "") == "_require_enabled")
        if (gate, env) in checked:
            continue
        checked.add((gate, env))
        monkeypatch.delenv(env, raising=False)
        with pytest.raises(HTTPException):
            gate()
        monkeypatch.setenv(env, "1")
        assert gate() is None, f"{key}: `_require_enabled` still refuses with {env}=1"
    assert len({e for _, e in checked}) >= 5, f"only {len(checked)} flag gates exercised"


# ── controls: each derived check is seen failing on a planted defect ─────────────────────────

def _planted_app(real_app, extra_router: APIRouter) -> FastAPI:
    a = FastAPI()
    for r in real_app.routes:
        if isinstance(r, APIRoute):
            a.router.routes.append(r)
    a.include_router(extra_router)
    return a


def test_CONTROL_an_unclassified_notebook_route_is_caught(real_app, doc_tables):
    from api.middleware.auth_middleware import get_current_user
    table, excluded = doc_tables
    r = APIRouter()

    @r.get("/api/j2/notes/{note_id}/planted-unclassified")
    def planted(note_id: str, user: dict = Depends(get_current_user)):  # pragma: no cover
        return {}

    problems = census_problems(candidates(_planted_app(real_app, r)), table, excluded)
    assert any("UNCLASSIFIED" in p and "planted-unclassified" in p for p in problems), problems


def test_CONTROL_the_net_catches_a_notebook_route_under_a_new_name(real_app, doc_tables):
    table, excluded = doc_tables
    r = APIRouter()

    @r.post("/api/notebook-v2/pages")
    def planted_v2():  # pragma: no cover
        return {}

    @r.get("/api/research/notes-feed")
    def planted_feed():  # pragma: no cover
        return {}

    problems = census_problems(candidates(_planted_app(real_app, r)), table, excluded)
    assert any("/api/notebook-v2/pages" in p for p in problems), problems
    assert any("/api/research/notes-feed" in p for p in problems), problems


def test_CONTROL_a_changed_auth_class_is_caught(real_app, doc_tables):
    table, excluded = doc_tables
    mutated = dict(table)
    key = ("GET", "/api/j2/notes/{note_id}")
    mutated[key] = dict(table[key], auth="none: get_note")
    problems = census_problems(candidates(real_app), mutated, excluded)
    assert any("AUTH MISMATCH" in p and "/api/j2/notes/{note_id}" in p for p in problems), problems


def test_CONTROL_a_route_that_loses_its_session_dependency_is_caught(real_app, doc_tables):
    """The mirror image: the doc still says `session`, the route no longer depends on it."""
    table, excluded = doc_tables
    r = APIRouter()

    @r.get("/api/j2/notes/{note_id}/unguarded-copy")
    def unguarded(note_id: str):  # pragma: no cover
        return {}

    mutated = dict(table)
    mutated[("GET", "/api/j2/notes/{note_id}/unguarded-copy")] = dict(
        table[("GET", "/api/j2/notes/{note_id}")])
    problems = census_problems(candidates(_planted_app(real_app, r)), mutated, excluded)
    assert any("AUTH MISMATCH" in p and "unguarded-copy" in p for p in problems), problems


def test_CONTROL_a_stale_row_and_an_unproved_guard_are_caught(real_app, doc_tables):
    table, excluded = doc_tables
    mutated = dict(table)
    mutated[("GET", "/api/j2/notes/{note_id}/retired")] = dict(table[("GET", "/api/j2/notes/{note_id}")])
    key = ("GET", "/api/j2/notebook-validation-report")
    mutated[key] = dict(table[key], auth="none: definitely_not_in_this_handler")
    problems = census_problems(candidates(real_app), mutated, excluded)
    assert any(p.startswith("STALE row") and "/retired" in p for p in problems), problems
    assert any("GUARD NOT IN SOURCE" in p and "notebook-validation-report" in p for p in problems), problems


def test_CONTROL_a_flag_row_naming_the_wrong_env_var_is_caught(real_app, doc_tables, monkeypatch):
    """The flag exercise must be able to fail: the share router's gate does NOT answer to a
    made-up variable."""
    from fastapi import HTTPException
    route = next(r for r, k in candidates(real_app) if k == ("GET", "/api/j2/shared/{token}"))
    gate = next(c for c in _dep_calls(route.dependant) if getattr(c, "__name__", "") == "_require_enabled")
    monkeypatch.delenv("J2_SHARE_LINKS_ENABLED", raising=False)
    monkeypatch.setenv("E2_NOT_THE_SHARE_FLAG", "1")
    with pytest.raises(HTTPException):
        gate()
