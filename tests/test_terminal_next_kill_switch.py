"""TERM-068 (FB-S12-01) — the MASTER switch, watched killing EVERY Terminal-Next surface.

`tests/test_terminal_next_flag.py` proved the LEVER on a test route it built for
itself, and said in its own docstring what it could not prove: *"There is no
production consumer of `require_terminal_next` yet, so nothing a member could
reach has been watched to die."* This file closes the part of that which source
can close. It does not trust a list of surfaces anybody typed; it DERIVES the set
from the code, throws the switch, and requires every member of the set to die:

  * SERVER ROUTES — every route in the SERVED app (`api.main.app`) whose
    dependency tree carries a cohort gate for a client-visible cohort, found by
    `rollout_gate.cohort_gated_routes`, which reads the mark `require_cohort`
    stamps on every gate it builds. A route that grows one tomorrow is in the set
    tomorrow, with nobody editing this file.
  * THE PAYLOAD FIELD — `cohorts` on `GET /api/auth/me`, the ONE channel a
    browser has for "am I in a dark run". Driven through the real route.
  * FRONTEND GATES — every `app/src` file that reads that field or names the
    cohort or the flag, found by a literal hunt over code with comments and
    strings separated out. A frontend gate is inert when the payload is empty, so
    the rule on that side is that no gate may read a source the runtime switch
    cannot reach (a build flag is baked into a bundle a flip never rebuilds).
  * SERVER BYPASSES — the only way a server surface can skip the switch is to
    ask the store directly (`rollout.includes(uid, "terminal-next")`) instead of
    going through the gate. So outside `rollout_gate.py`, `api/` code may not
    name the cohort (as a value), the flag, or the gate's private constants.
    ⚠️ NOT IN THE SET, deliberately: `api/routers/terminal_next_reports.py`'s
    `/api/terminal-next/...` routes. They carry the PROGRAMME's slug, are
    `PUSH_SECRET`-bearer ops reads for the monitor service, reach no member, and
    must keep answering during a kill.

⛔⛔ AND NOTHING IS DELETED. `feedback_kill_switch_never_a_delete`: stopping a dark
run must NEVER be a DELETE against member data — flags stay env vars, cohorts stay
tags. Every file under the isolated data dir, and every row of every table in
`auth.db`, is fingerprinted before the switch is thrown and after every surface
has been driven dead, and the two must be IDENTICAL. Then the switch is put back
and the tagged member's cohort comes back with nobody re-tagging anyone, which is
the behavioural half of the same claim.

⭐ ORDER IS THE POINT, as in the sibling file: every surface is proved ALIVE for a
tagged member before it is thrown, so a 404 afterwards is a kill and not a route
that never worked.

⭐ CONTROLS, each proving the instrument can see what it claims to see:
  * a probe router mounted on the REAL app — one route through the real gate, one
    through a cohort gate whose kill switch is a constant `True` — must yield
    EXACTLY the second, by name, from the same checker the master rail uses;
  * the data fingerprint must CHANGE when a tag really is removed;
  * each literal hunt is fed code that uses the needle and prose that only
    mentions it, and must tell them apart — and `api/routers/auth.py` carries a
    real comment naming the flag, which the hunt must not count.

⛔ SCOPED RUN ONLY:
    python -m pytest tests/test_terminal_next_kill_switch.py tests/test_terminal_next_flag.py -q
Never an unscoped pytest on this box (18 GB, OOM-killed).

⛔ WHAT THIS CANNOT DO. It cannot read Railway: whether `TERMINAL_NEXT_ENABLED` is
set on the pod, and to what, is `railway variables --service web --kv` plus a
NEW BOOT and an in-process read (rollout-rollback.md RB-5). And a derived census
of zero server routes is an honest census of zero — today the payload field is
the only live Terminal-Next surface, and that is stated, not hidden, below.
"""
from __future__ import annotations

import hashlib
import io
import re
import sqlite3
import tokenize
from pathlib import Path

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import auth_db, rollout
from api.services import rollout_gate as rg

REPO = Path(__file__).resolve().parents[1]
API_DIR = REPO / "api"
APP_SRC = REPO / "app" / "src"
GATE_MODULE = API_DIR / "services" / "rollout_gate.py"

# ⛔ NEEDLES BY CONCATENATION, so this file never contains a hit of its own and a
# future scan that widens to `tests/` cannot trip on the rail itself.
FLAG_NEEDLE = "TERMINAL_" + "NEXT"                 # any Terminal-Next flag spelling
FLAG_NAME = FLAG_NEEDLE + "_ENABLED"
COHORT_NEEDLE = "terminal" + "-next"
FIELD = "coh" + "orts"
#: The gate's private constants. A reference outside `rollout_gate.py` is a
#: second reader of the flag, or a surface consulting the cohort by name.
GATE_PRIVATE_NAMES = (
    "TERMINAL_NEXT_" + "FLAG_ENV",
    "TERMINAL_NEXT_" + "FLAG_DEFAULT",
    "TERMINAL_NEXT_" + "COHORT",
)

TAGGED_MEMBER = "tnk-tagged-member"
TAGGED_ADMIN = "tnk-tagged-admin"
UNTAGGED_MEMBER = "tnk-untagged-member"
UNTAGGED_ADMIN = "tnk-untagged-admin"


# ───────────────────────────────────────────────────────────────────────────────
# FIXTURES — a real auth.db, real accounts, real tags.
# ───────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """An isolated data dir with an `auth.db` built by the product's own
    `init_db()` — both halves of the path pin (`test_terminal_next_flag.py`'s
    fixture records why one half is a fiction)."""
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(path))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth_db.init_db()
    return tmp_path


def _person(uid: str, role: str) -> dict:
    return {"id": uid, "email": uid + "@example.test", "role": role, "plan": "pro"}


@pytest.fixture
def people(data_dir):
    """EVERY KIND OF USER the switch has to beat: tagged and untagged, member and
    admin. ⛔ Admins included on purpose — S0's own words are *"unset ⇒ OFF for
    everyone including admins"*, and an admin bypass is the classic way a kill
    switch turns out to have an exception nobody wrote down. All paid, so a 404
    can never be a 402 in disguise."""
    roster = [_person(TAGGED_MEMBER, "member"), _person(TAGGED_ADMIN, "admin"),
              _person(UNTAGGED_MEMBER, "member"), _person(UNTAGGED_ADMIN, "admin")]
    conn = auth_db.get_connection()
    try:
        for p in roster:
            conn.execute(
                "INSERT OR IGNORE INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                (p["id"], p["email"], "x", p["role"]))
        conn.commit()
    finally:
        conn.close()
    for cohort in rg.COHORT_KILL_SWITCHES:
        rollout.assign_cohort(cohort, [TAGGED_MEMBER, TAGGED_ADMIN])
        assert rollout.includes(TAGGED_MEMBER, cohort) is True, (
            "the fixture did not tag the member — every kill below would be vacuous")
        assert rollout.includes(UNTAGGED_MEMBER, cohort) is False
    return roster


@pytest.fixture(autouse=True)
def _flag_unset(monkeypatch):
    monkeypatch.delenv(rg.TERMINAL_NEXT_FLAG_ENV, raising=False)


@pytest.fixture(scope="module")
def real_app():
    """THE SERVED APP — the object `uvicorn api.main:app` runs. Not a stand-in:
    a census over a test app would census the test."""
    from api.main import app
    return app


@pytest.fixture
def as_user(real_app):
    """Drive the real app as a chosen person. Only the IDENTITY is overridden —
    a cookie is not what is under test; every gate, route and read is real.
    ⛔ No `with TestClient(...)`: that would run the app's startup (schedulers,
    boot audits) inside a unit rail."""
    state = {"user": None}
    real_app.dependency_overrides[get_current_user] = lambda: state["user"]
    real_app.dependency_overrides[get_current_user_with_plan] = lambda: state["user"]
    try:
        yield TestClient(real_app), state
    finally:
        real_app.dependency_overrides.pop(get_current_user, None)
        real_app.dependency_overrides.pop(get_current_user_with_plan, None)


# ───────────────────────────────────────────────────────────────────────────────
# THE CENSUS AND THE CHECKER — one of each, shared by the rail and its control.
# ───────────────────────────────────────────────────────────────────────────────

def _server_surfaces(app) -> list[tuple[str, str]]:
    """Every server route behind a cohort gate for a cohort a client can see."""
    found: set[tuple[str, str]] = set()
    for cohort in rg.COHORT_KILL_SWITCHES:
        found.update(rg.cohort_gated_routes(app, cohort))
    return sorted(found)


def _concrete(path: str) -> str:
    """A path template with every `{param}` filled — the gate runs before the
    handler, so a dead route never looks at the value."""
    return re.sub(r"\{[^}]+\}", "1", path)


def _dead(resp) -> bool:
    """Dead means indistinguishable from a route that does not exist."""
    try:
        return resp.status_code == 404 and resp.json() == {"detail": rg.NOT_FOUND}
    except ValueError:
        return False


def _alive_violations(client, state, routes, person) -> list[str]:
    """With the switch ON, what did NOT answer for a tagged person?"""
    state["user"] = person
    bad = [f"{m} {p}" for m, p in routes
           if _dead(client.request(m, _concrete(p)))]
    me = client.get("/api/auth/me")
    if me.status_code != 200 or sorted(me.json().get(FIELD) or []) != sorted(rg.COHORT_KILL_SWITCHES):
        bad.append(f"GET /api/auth/me#{FIELD}: {me.status_code} {me.text[:200]}")
    return bad


def _killed_violations(client, state, routes, roster) -> list[str]:
    """⛔ THE CHECKER. With the switch THROWN, every (surface, person) pair that
    is NOT dead — named, so a red says which surface outlived the switch."""
    bad = []
    for person in roster:
        state["user"] = person
        for m, p in routes:
            r = client.request(m, _concrete(p))
            if not _dead(r):
                bad.append(f"{m} {p} as {person['id']} -> {r.status_code}")
        me = client.get("/api/auth/me")
        got = me.json().get(FIELD) if me.status_code == 200 else None
        if me.status_code != 200 or got != []:
            bad.append(f"GET /api/auth/me#{FIELD} as {person['id']} -> "
                       f"{me.status_code} {got!r}")
    return bad


def _fingerprint(data_dir: Path) -> dict:
    """Every row of every table in `auth.db`, then the sha256 of every file in
    the data dir.

    ⚠️ ORDER MATTERS. `auth.db` runs in WAL mode, and closing the last
    connection checkpoints the WAL into the main file — so the logical read
    comes FIRST and TRUNCATE-checkpoints, and only then are the bytes hashed. The
    same procedure runs before and after, so it cannot manufacture a difference
    of its own; the control below proves it can SEE one. `-shm` is excluded: it
    is SQLite's shared-memory index, rewritten by readers by design.
    """
    conn = sqlite3.connect(str(data_dir / "auth.db"))
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        rows = list(conn.iterdump())
    finally:
        conn.close()
    files = {}
    for f in sorted(data_dir.rglob("*")):
        if f.is_file() and not f.name.endswith("-shm"):
            files[str(f.relative_to(data_dir))] = hashlib.sha256(f.read_bytes()).hexdigest()
    return {"rows": rows, "files": files}


# ───────────────────────────────────────────────────────────────────────────────
# 1. THE MASTER RAIL — thrown, every derived surface is dead for everyone, and
#    not one byte of member data moved.
# ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("thrown", ["0", None], ids=["set-to-0", "unset"])
def test_THROWN_the_master_switch_kills_EVERY_surface_for_EVERYONE_and_deletes_NOTHING(
        thrown, real_app, as_user, people, data_dir, monkeypatch):
    client, state = as_user
    routes = _server_surfaces(real_app)
    tagged = [p for p in people if p["id"] in (TAGGED_MEMBER, TAGGED_ADMIN)]

    # 1. ALIVE FIRST — every surface answers for every tagged person.
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    for person in tagged:
        assert _alive_violations(client, state, routes, person) == [], (
            "a surface was not reachable with the switch ON — the kill below "
            "would prove nothing about it")

    # 2. THROW IT — no reimport, no restart, and the store is fingerprinted first.
    before = _fingerprint(data_dir)
    if thrown is None:
        monkeypatch.delenv(rg.TERMINAL_NEXT_FLAG_ENV, raising=False)
    else:
        monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, thrown)
    violations = _killed_violations(client, state, routes, people)
    after = _fingerprint(data_dir)

    assert violations == [], (
        "THE MASTER SWITCH WAS THROWN AND THESE SURFACES OUTLIVED IT — a kill "
        "switch with an exception is a variable:\n  " + "\n  ".join(violations))

    # 3. ⛔⛔ NOTHING DELETED, NOTHING REWRITTEN.
    assert after["rows"] == before["rows"], (
        "throwing the switch CHANGED rows in auth.db. Stopping a dark run must "
        "never be a write against member data (feedback_kill_switch_never_a_delete).")
    assert after["files"] == before["files"], (
        f"throwing the switch changed bytes on disk: {before['files']} -> {after['files']}")
    for cohort in rg.COHORT_KILL_SWITCHES:
        assert set(rollout.cohort_user_ids(cohort)) == {TAGGED_MEMBER, TAGGED_ADMIN}, (
            f"the {cohort!r} cohort lost members while the switch was thrown")

    # 4. BACK ON — the cohort returns with NOBODY re-tagging anyone.
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    for person in tagged:
        assert _alive_violations(client, state, routes, person) == [], (
            "the switch came back on and a tagged person did not get the surface "
            "back — the 'kill' destroyed something")


def test_the_census_is_stated_not_hidden(real_app):
    """⚠️ HONESTY ABOUT THE DENOMINATOR. Today no served route mounts a cohort
    gate, so the payload field is the only live Terminal-Next surface and the
    master rail's route loop runs over nothing. That is TRUE, and saying so is
    the difference between "all 0 surfaces die" and "all surfaces die".

    When the first route mounts `require_terminal_next`, this goes red on
    purpose, naming it: the master rail has ALREADY checked it (the census is
    derived, not typed), and updating this set is the author acknowledging a
    member-reachable surface now exists — which is the moment the tier-4
    rollback branch and the member-impact paragraph are owed.
    """
    assert _server_surfaces(real_app) == [], (
        "a served route now sits behind a cohort gate. The master rail below "
        "already requires it to die with the switch thrown; update this census "
        "deliberately:\n  " + "\n  ".join(f"{m} {p}" for m, p in _server_surfaces(real_app)))


# ───────────────────────────────────────────────────────────────────────────────
# 2. THE CONTROL — the same checker, on the same REAL app, sees a surface that
#    ignores the switch, and ONLY that one.
# ───────────────────────────────────────────────────────────────────────────────

PROBE_PREFIX = "/api/__tnk_probe"


@pytest.fixture
def probed_app(real_app):
    """Mount two probe routes ON THE REAL APP for one test, then take them back.

    * `/honours` — the real `require_terminal_next`, as a production router would.
    * `/ignores` — a cohort gate for the SAME cohort whose kill switch is a
      constant `True`: the shape of a surface that forgot the master switch.
    """
    saved = list(real_app.router.routes)
    probe = APIRouter(prefix=PROBE_PREFIX)
    ignores_gate = rg.require_cohort(rg.TERMINAL_NEXT_COHORT, kill_switch=lambda: True)

    @probe.get("/honours")
    def honours(user: dict = Depends(rg.require_terminal_next)):
        return {"reached": user["id"]}

    @probe.get("/ignores/{thing}")
    def ignores(thing: str, user: dict = Depends(ignores_gate)):
        return {"reached": user["id"], "thing": thing}

    n = len(real_app.router.routes)
    real_app.include_router(probe)
    # Production routers are included at import, BEFORE api/main.py's SPA
    # catch-all (`/{full_path:path}`, mounted only when app/dist is built).
    # Appended after it, the probes would be shadowed by the catch-all in any
    # checkout with a built bundle and the control would measure the SPA shell.
    added = real_app.router.routes[n:]
    del real_app.router.routes[n:]
    real_app.router.routes[0:0] = added
    try:
        yield real_app
    finally:
        real_app.router.routes[:] = saved


def test_CONTROL_the_checker_names_a_surface_that_IGNORES_the_switch(
        probed_app, as_user, people, monkeypatch):
    client, state = as_user
    routes = _server_surfaces(probed_app)
    honours = ("GET", PROBE_PREFIX + "/honours")
    ignores = ("GET", PROBE_PREFIX + "/ignores/{thing}")
    assert honours in routes and ignores in routes, (
        f"the census did not find the probe routes on the real app: {routes}")

    tagged_member = next(p for p in people if p["id"] == TAGGED_MEMBER)
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert _alive_violations(client, state, [honours, ignores], tagged_member) == []

    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    violations = _killed_violations(client, state, routes, people)
    named = {v.split(" as ")[0] for v in violations}
    assert named == {"GET " + ignores[1]}, (
        "the checker must name EXACTLY the surface that ignores the switch — "
        f"got {sorted(named)}")
    # …and the probes are gone again, so no other test sees them.


def test_CONTROL_the_probes_do_not_leak_into_the_served_app(real_app):
    assert not any(str(getattr(r, "path", "")).startswith(PROBE_PREFIX)
                   for r in real_app.router.routes)


def test_CONTROL_the_fingerprint_SEES_a_removed_tag(people, data_dir):
    """Non-vacuity of the data rail: a real removal must change the fingerprint,
    or "identical before and after" would be true of a blind instrument."""
    before = _fingerprint(data_dir)
    cohort = next(iter(rg.COHORT_KILL_SWITCHES))
    assert rollout.remove_from_cohort(cohort, [TAGGED_ADMIN]) == 1
    assert _fingerprint(data_dir)["rows"] != before["rows"]


def test_the_census_finds_a_gate_mounted_at_ROUTER_level():
    """`require_cohort`'s own docstring offers `dependencies=[Depends(...)]` as a
    shape; a census that only read handler parameters would miss it."""
    from fastapi import FastAPI

    app = FastAPI()
    r = APIRouter(prefix="/x", dependencies=[Depends(rg.require_terminal_next)])

    @r.get("/y")
    def y():
        return {}

    app.include_router(r)

    @app.get("/open")
    def open_():
        return {}

    assert rg.cohort_gated_routes(app, rg.TERMINAL_NEXT_COHORT) == [("GET", "/x/y")]
    assert rg.cohort_gated_routes(app, "some-other-cohort") == []


# ───────────────────────────────────────────────────────────────────────────────
# 3. SERVER BYPASSES — nothing in `api/` asks the store about the cohort, or reads
#    the flag, except through the gate.
# ───────────────────────────────────────────────────────────────────────────────

def _py_code(src: str) -> tuple[set[str], list[str]]:
    """(NAME tokens, non-docstring STRING tokens) of a Python source, with every
    comment dropped and every triple-quoted string treated as prose.
    ⛔ An unparseable file raises — a scan that skipped it would read as clean."""
    names: set[str] = set()
    strings: list[str] = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.NAME:
            names.add(tok.string)
        elif tok.type == tokenize.STRING:
            body = tok.string.lstrip("rbuRBUfF")
            if not body.startswith(('"""', "'''")):
                strings.append(tok.string)
    return names, strings


#: The cohort as a VALUE — its bare name or its stored tag. ⚠️ Exact equality,
#: never a substring: `terminal-next` is also the PROGRAMME's slug, and
#: `api/routers/terminal_next_reports.py` serves `/api/terminal-next/report/...`
#: to the ops monitor behind a `PUSH_SECRET` bearer. Those are not member
#: surfaces and must keep answering DURING a kill — an incident is exactly when
#: the monitor has to be able to report.
COHORT_VALUES = frozenset({COHORT_NEEDLE, "rollout:" + COHORT_NEEDLE})


def _unquote(tok: str) -> str:
    body = tok.lstrip("rbuRBUfF")
    return body[1:-1] if len(body) >= 2 else body


def _py_bypasses(rel: str, src: str) -> list[str]:
    names, strings = _py_code(src)
    bad = [f"{rel}: names {n}" for n in GATE_PRIVATE_NAMES if n in names]
    bad += [f"{rel}: string {s}" for s in strings
            if FLAG_NAME in s or _unquote(s) in COHORT_VALUES]
    return bad


def test_nothing_in_api_reaches_the_cohort_or_the_flag_except_through_the_gate():
    """⛔ THE ONLY WAY A SERVER SURFACE CAN SKIP THE SWITCH is to ask the store
    itself — `rollout.includes(uid, "terminal-next")` — or to read the env var
    with a polarity of its own. Both are the same defect: a second door that the
    master switch does not guard. Surfaces use `require_terminal_next` or
    `terminal_next_enabled_for`, which cannot skip it."""
    scanned, bad = 0, []
    for f in sorted(API_DIR.rglob("*.py")):
        if f == GATE_MODULE:
            continue
        scanned += 1
        bad += _py_bypasses(str(f.relative_to(REPO)).replace("\\", "/"),
                            f.read_text(encoding="utf-8"))
    assert scanned > 100, f"scanned only {scanned} files — the walk is broken"
    assert bad == [], (
        "these name the Terminal-Next cohort or flag OUTSIDE the gate — a door the "
        "master switch does not guard:\n  " + "\n  ".join(bad))


def test_CONTROL_the_python_hunt_separates_code_from_prose():
    # A real comment in the served auth router names the flag — raw text sees it,
    # the hunt must not.
    auth_src = (API_DIR / "routers" / "auth.py").read_text(encoding="utf-8")
    assert FLAG_NAME in auth_src, "the natural control moved — pick another"
    assert _py_bypasses("auth.py", auth_src) == []

    prose = f'"""Uses {COHORT_NEEDLE} and {GATE_PRIVATE_NAMES[2]}."""\n# {FLAG_NAME}\nx = 1\n'
    assert _py_bypasses("prose.py", prose) == []
    raw_bypass = f'from api.services import rollout\nok = rollout.includes(uid, "{COHORT_NEEDLE}")\n'
    assert _py_bypasses("bypass.py", raw_bypass) == [f'bypass.py: string "{COHORT_NEEDLE}"']
    # The programme slug inside an ops path is NOT the cohort (see COHORT_VALUES).
    ops_path = f'@router.get("/api/{COHORT_NEEDLE}/report/{{name}}")\ndef r(): ...\n'
    assert _py_bypasses("ops.py", ops_path) == []
    reports_src = (API_DIR / "routers" / "terminal_next_reports.py").read_text(encoding="utf-8")
    assert COHORT_NEEDLE in reports_src, "the natural control moved — pick another"
    assert _py_bypasses("reports.py", reports_src) == []
    second_reader = f'import os\non = os.environ.get("{FLAG_NAME}", "1")\n'
    assert _py_bypasses("reader.py", second_reader) == [f'reader.py: string "{FLAG_NAME}"']
    via_constant = f"from api.services import rollout_gate as rg\nc = rg.{GATE_PRIVATE_NAMES[2]}\n"
    assert _py_bypasses("const.py", via_constant) == [f"const.py: names {GATE_PRIVATE_NAMES[2]}"]


# ───────────────────────────────────────────────────────────────────────────────
# 4. FRONTEND GATES — derived by literal hunt; each must take its answer from the
#    payload the switch empties, and nothing the switch cannot reach.
# ───────────────────────────────────────────────────────────────────────────────

_JS_EXTS = {".js", ".jsx", ".ts", ".tsx", ".mjs"}


def _js_split(src: str) -> tuple[str, list[str]]:
    """(code with comments AND string/template literals blanked, the literals'
    contents). A small scanner rather than a regex, because a regex stripper eats
    `'http://x'` as a comment and keeps `// const on = ...` as code.
    ⚠️ Regex literals are not special-cased; a `//` inside one would read as a
    comment and could only HIDE code, which the controls below would not see —
    stated as a limit, not hidden."""
    code, strings = [], []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        two = src[i:i + 2]
        if two == "//":
            j = src.find("\n", i)
            i = n if j < 0 else j
        elif two == "/*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c in "'\"`":
            j, buf = i + 1, []
            while j < n and src[j] != c:
                if src[j] == "\\" and j + 1 < n:
                    buf.append(src[j:j + 2])
                    j += 2
                    continue
                if c != "`" and src[j] == "\n":
                    break
                buf.append(src[j])
                j += 1
            strings.append("".join(buf))
            code.append(" '' ")
            i = j + 1
        else:
            code.append(c)
            i += 1
    return "".join(code), strings


_FIELD_READ = re.compile(r"\b" + FIELD + r"\b")


def _js_gate(rel: str, src: str) -> tuple[bool, list[str]]:
    """(is this file a Terminal-Next frontend gate?, its violations)."""
    code, strings = _js_split(src)
    reads_field = bool(_FIELD_READ.search(code)) or FIELD in strings
    names_cohort = any(s in COHORT_VALUES for s in strings)
    names_flag = FLAG_NEEDLE in code or any(FLAG_NEEDLE in s for s in strings)
    bad = []
    if names_flag:
        bad.append(f"{rel}: reads a Terminal-Next FLAG in the client — a bundle "
                   "value the runtime switch cannot reach")
    if names_cohort and not reads_field:
        bad.append(f"{rel}: names the cohort without reading `{FIELD}` from the "
                   "auth payload — its answer comes from somewhere the switch does not empty")
    return (reads_field or names_cohort or names_flag), bad


def _frontend_census() -> tuple[list[str], list[str], int]:
    gates, bad, scanned = [], [], 0
    for f in sorted(APP_SRC.rglob("*")):
        if not f.is_file() or f.suffix not in _JS_EXTS or "node_modules" in f.parts:
            continue
        scanned += 1
        rel = str(f.relative_to(REPO)).replace("\\", "/")
        is_gate, v = _js_gate(rel, f.read_text(encoding="utf-8", errors="replace"))
        if is_gate:
            gates.append(rel)
        bad += v
    return gates, bad, scanned


def test_every_frontend_gate_answers_from_the_payload_the_switch_empties():
    gates, bad, scanned = _frontend_census()
    assert scanned > 100, f"scanned only {scanned} frontend files — the walk is broken"
    assert bad == [], (
        "frontend Terminal-Next gates reading a source the master switch cannot "
        "reach:\n  " + "\n  ".join(bad))
    # ⚠️ Stated, not hidden: today no frontend file reads the field. When one
    # does, it is inert with the switch thrown because the master rail above
    # proves the field is `[]` for everyone.
    assert gates == [], (
        "a frontend Terminal-Next gate now exists; it is already held to the rule "
        "above — acknowledge it here:\n  " + "\n  ".join(gates))


def test_CONTROL_the_frontend_hunt_separates_code_from_prose():
    # Natural control: this file carries the word in PROSE and in a STRING, and
    # neither is a read of the payload field.
    grid = (APP_SRC / "pages" / "charts" / "grid" / "MultiChartMenu.jsx").read_text(encoding="utf-8")
    assert FIELD in grid, "the natural control moved — pick another"
    assert _js_gate("grid", grid) == (False, [])

    cases = {
        "payload_gate.jsx":
            (f"export const on = (u) => (u?.{FIELD} || []).includes('{COHORT_NEEDLE}')\n",
             (True, [])),
        "commented.jsx":
            (f"// VITE_{FLAG_NAME}\n/* '{COHORT_NEEDLE}' */\nconst url = 'http://x/y'\n",
             (False, [])),
        "ops_path.jsx":
            (f"fetch('/api/{COHORT_NEEDLE}/report/x')\n", (False, [])),
        "build_flag.jsx":
            (f"const on = import.meta.env.VITE_{FLAG_NAME} === '1'\n", None),
        "latched.jsx":
            (f"const on = localStorage.getItem('{COHORT_NEEDLE}') === '1'\n", None),
    }
    for rel, (src, expected) in cases.items():
        got = _js_gate(rel, src)
        if expected is None:
            assert got[0] is True and len(got[1]) == 1 and got[1][0].startswith(rel), (rel, got)
        else:
            assert got == expected, (rel, got)
