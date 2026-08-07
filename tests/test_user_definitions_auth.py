"""Phase D Task 14 — TIERING: everything Phase D exposes is PAID, and the proof
that it is paid is DERIVED FROM THE ROUTER rather than hand-listed.

⭐ THE ONE THING THIS FILE EXISTS TO MAKE IMPOSSIBLE: a route that ships with no
gate and no test that could have noticed. Phase C Task 13 MEASURED that failure —
it dropped `Depends(require_paid)` from `/confluence` and the shipped test stayed
GREEN, because the test hand-listed THREE paths while the router had FIVE. Two
paid endpoints were reachable by anybody and every assertion in the file passed.

So nothing here is typed:

  * the PATH SET comes out of `ud.router.routes`;
  * the COUNT is asserted, so a router that stopped mounting cannot pass by
    iterating zero times and a SEVENTH route cannot ride in uncovered;
  * the count is CROSS-CHECKED against the two other files that already assert it
    (`tests/test_user_definitions.py`'s constant and
    `tests/test_definition_concierge.py`'s inline literal), BY AST — because
    three places knowing a number and only one of them being read is how the
    number rots;
  * the `require_paid` census walks `api/routers/` and reads DEFINITIONS out of
    the parse tree, never a grep (a grep on this branch has manufactured a
    ship-blocker from three prose hits and hidden a real one);
  * and the tier half RUNS THE SHIPPED JAVASCRIPT through node rather than
    asserting a source line, for the same reason `test_user_definitions.py` runs
    `mergeChartSettings`: a regex cannot tell a deleted declaration from a
    renamed one.

⚠️ WHAT THIS FILE DELIBERATELY DOES NOT DECIDE. `nativeRegistry.js`'s shared
default is `tier: 'free'` and SIXTEEN natives inherit it. Whether the owner's
"everything is paid" ruling reaches them is a PAYWALL decision with a blast
radius over every member and every chart, and it is not Task 14's to take — it
goes to the owner as a finding. `test_the_free_tier_is_EXACTLY_the_sixteen_
natives` below is what keeps that question visible instead of silently answered.
"""
from __future__ import annotations

import ast as pyast
import io
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as ud

ROOT = Path(__file__).resolve().parents[1]
ROUTERS_DIR = ROOT / "api" / "routers"
ENGINE = ROOT / "app" / "src" / "components" / "chart" / "engine"

REGISTRY_JS = ENGINE / "nativeRegistry.js"
DEFSCHEMA_JS = ENGINE / "defSchema.js"
PARSE_JS = ENGINE / "ast" / "parse.js"
LINT_JS = ENGINE / "ast" / "lint.js"

#: The 402 sentence THIS router speaks. It is asserted rather than imported so a
#: quiet edit to the message is a failure here and not a silent change to what a
#: refused user reads.
PAID_DETAIL = "Custom indicators require a paid plan"

#: ⛔ ASSERTED, NOT INFORMATIONAL — and CROSS-CHECKED against the two other files
#: that already know it. Phase D Task 13 moved this 5 → 6 when the concierge route
#: (`POST /propose`) landed; it turned both halves of the sweep red until it was
#: updated DELIBERATELY, which is the whole mechanism. A seventh route must cost
#: the same three deliberate edits.
EXPECTED_ROUTE_COUNT = 6


# ─── the derived route table ─────────────────────────────────────────────────

def _routes():
    """Every mounted route, READ OFF THE ROUTER.

    ⛔ `getattr(r, "methods", None)` and not a type check: a `Mount` or a
    `WebSocketRoute` has no `methods`, and an isinstance filter would have to name
    a class this file would then have to keep in step with FastAPI.
    """
    return [r for r in ud.router.routes if getattr(r, "methods", None)]


def _http_methods(route):
    return sorted(route.methods - {"HEAD", "OPTIONS"})


@pytest.fixture
def free_client():
    """A logged-in user on the FREE plan, and nothing else overridden.

    ⚠️ THE OVERRIDE IS ON `get_current_user_with_plan`, WHICH IS WHAT
    `require_paid` DEPENDS ON — not on `require_paid` itself. Overriding the gate
    would mean the test never runs the gate, which is the injected-dependency
    vacuity `lesson_injected_dependency_hides_the_fetch` names (996 green tests,
    0 of 24 charts).
    """
    app = FastAPI()
    app.include_router(ud.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "free1", "role": "user", "plan": "free"}
    return TestClient(app)


def test_a_free_user_is_refused_on_EVERY_route_of_this_router(free_client):
    """🔴 THE MEASURED FAILURE THIS COPIES ITS SHAPE FROM.

    Phase C Task 13 dropped `Depends(require_paid)` from `/confluence` and THE
    SHIPPED TEST WAS GREEN: it hand-listed THREE paths while the router had FIVE,
    so `/confluence` and `/confluence-scan` were never checked at all.

    So the path set is DERIVED from `router.routes` and the COUNT is asserted,
    which is what makes a SEVENTH route land covered instead of riding in.

    ⛔ AND NO BODY IS SENT, ON PURPOSE. Validation runs AFTER the dependency, so a
    route whose gate was deleted answers 422 (or 200, or 500) to a bodyless POST
    while a gated one answers 402 whatever the body is. Sending a valid body would
    let a 200 hide as "the happy path", which is the miss the existing behavioural
    sweep in `test_user_definitions.py` writes down.

    ⛔ AND EVERY METHOD, NOT THE FIRST. `sorted(...)[0]` covers a route that
    declares one verb and quietly stops covering it the day somebody adds a second
    to the same path.
    """
    routes = _routes()
    assert len(routes) == EXPECTED_ROUTE_COUNT, (
        f"the router mounts {len(routes)} routes — one was added or removed. "
        "Update EXPECTED_ROUTE_COUNT DELIBERATELY, here AND in "
        "tests/test_user_definitions.py AND in tests/test_definition_concierge.py.")

    seen = []
    for r in routes:
        for method in _http_methods(r):
            path = r.path.replace("{def_id}", "u_abc")
            resp = free_client.request(method, path)
            assert resp.status_code == 402, (
                f"{method} {r.path} answered a free user {resp.status_code} — "
                f"{resp.text[:200]}")
            assert resp.json()["detail"] == PAID_DETAIL, (
                f"{method} {r.path} refused with someone else's sentence: "
                f"{resp.json().get('detail')!r}")
            seen.append(f"{method} {r.path}")

    assert len(seen) == EXPECTED_ROUTE_COUNT, seen
    # …and they really are six DISTINCT doors, not one route counted six times by
    # a walk that lost its way. Three paths carry the six verbs: the collection
    # (`GET`/`POST`), the concierge (`POST /propose`) and the item
    # (`GET`/`PUT`/`DELETE /{def_id}`).
    assert sorted(seen) == sorted(set(seen)), seen
    assert len({s.split(" ", 1)[1] for s in seen}) == 3, seen


def test_every_route_declares_its_OWN_require_paid_and_the_router_declares_NONE():
    """The STRUCTURAL half — the behavioural sweep above cannot tell WHERE the
    402 came from.

    ⛔ `router.dependencies == []` IS THE LOAD-BEARING HALF. A router-level
    dependency would make every per-handler assertion above pass for a route that
    declares none of its own, and `main.py` mounts this router with no dependency
    — so the day someone "simplifies" by hoisting the gate, the per-handler rail
    silently stops measuring anything and this is what says so.
    """
    routes = _routes()
    assert len(routes) == EXPECTED_ROUTE_COUNT
    for r in routes:
        deps = [d.call for d in r.dependant.dependencies]
        assert ud.require_paid in deps, (
            f"{sorted(r.methods)} {r.path} declares no require_paid of its own")
    assert ud.router.dependencies == [], (
        "a router-level dependency would make the per-handler rail above pass for "
        "a route that has none of its own")


def test_the_route_COUNT_is_the_SAME_NUMBER_in_all_three_files_that_assert_it():
    """⛔ BY AST OVER THE OTHER TWO TEST FILES, NEVER BY GREP OR BY IMPORT.

    Three files assert this number. Importing the sibling's constant would make a
    divergence INVISIBLE (the two would be one object); grepping would count the
    prose — this file's own docstrings say `5` and `6` on purpose. So both other
    sites are read out of their parse trees:

      * `tests/test_user_definitions.py` holds it as a module constant;
      * `tests/test_definition_concierge.py` writes it INLINE as
        `assert len(routes) == 6`, which is the shape that rots quietly.
    """
    sibling = pyast.parse(
        (ROOT / "tests" / "test_user_definitions.py").read_text(encoding="utf-8"))
    constants = [
        n.value.value
        for n in sibling.body
        if isinstance(n, pyast.Assign)
        and any(isinstance(t, pyast.Name) and t.id == "EXPECTED_ROUTE_COUNT"
                for t in n.targets)
        and isinstance(n.value, pyast.Constant)
    ]
    assert constants == [EXPECTED_ROUTE_COUNT], (
        f"tests/test_user_definitions.py asserts {constants} routes, this file "
        f"asserts {EXPECTED_ROUTE_COUNT}")

    concierge = pyast.parse(
        (ROOT / "tests" / "test_definition_concierge.py").read_text(encoding="utf-8"))
    inline = []
    for node in pyast.walk(concierge):
        if not isinstance(node, pyast.Compare):
            continue
        left = node.left
        if not (isinstance(left, pyast.Call)
                and isinstance(left.func, pyast.Name) and left.func.id == "len"
                and len(left.args) == 1
                and isinstance(left.args[0], pyast.Name)
                and left.args[0].id == "routes"):
            continue
        for cmp_ in node.comparators:
            if isinstance(cmp_, pyast.Constant) and isinstance(cmp_.value, int):
                inline.append(cmp_.value)
    # The control: the walk CAN see a literal, so an empty list is a broken scan
    # rather than a file that stopped asserting.
    assert inline, (
        "the AST walk found no `len(routes) == <int>` in "
        "tests/test_definition_concierge.py — the scan rotted, or Task 13's "
        "assertion was deleted")
    assert set(inline) == {EXPECTED_ROUTE_COUNT}, (
        f"tests/test_definition_concierge.py asserts {sorted(set(inline))} routes")


# ─── `require_paid` is LOCAL to each router, and stays that way ───────────────

def _router_modules():
    """⛔ DERIVED FROM THE DIRECTORY, NEVER TYPED. Four false alarms in one
    session came from typed probe names (`lesson_probe_names_must_be_derived_
    not_typed`)."""
    return sorted(p for p in ROUTERS_DIR.glob("*.py") if p.name != "__init__.py")


def _require_paid_defs(tree: pyast.Module) -> list[pyast.FunctionDef]:
    return [n for n in tree.body
            if isinstance(n, pyast.FunctionDef) and n.name == "require_paid"]


def test_require_paid_is_defined_PER_ROUTER_and_this_task_invented_no_shared_one():
    """⛔ THE NON-MEASUREMENT ASSERTION, AS A DURABLE RAIL.

    `require_paid` is defined LOCALLY, once per router, each with its OWN 402
    sentence — that is the shipped pattern (`api/routers/signature.py:174`), and
    inventing a shared one for a Phase D task would change TWO OTHER ROUTERS'
    behaviour as a side effect of tiering the builder. So:

      * every module that gates on it DEFINES it (a module that IMPORTS one from
        a sibling is the shared gate wearing a different hat);
      * the 402 sentences are DISTINCT, which is what makes a support question
        answerable — "which surface refused me" is readable off the message;
      * and `user_definitions.py` is among the definers, which is the half that
        would go red if this task had taken the tidy route.
    """
    definers: dict[str, list[str]] = {}
    importers: list[str] = []

    for path in _router_modules():
        tree = pyast.parse(path.read_text(encoding="utf-8"))
        defs = _require_paid_defs(tree)
        if defs:
            assert len(defs) == 1, f"{path.name} defines require_paid twice"
            details = [
                kw.value.value
                for n in pyast.walk(defs[0])
                if isinstance(n, pyast.Call)
                and isinstance(n.func, pyast.Name) and n.func.id == "HTTPException"
                for kw in n.keywords
                if kw.arg == "detail" and isinstance(kw.value, pyast.Constant)
            ]
            definers[path.name] = details
        for n in pyast.walk(tree):
            if isinstance(n, pyast.ImportFrom) and any(
                    a.name == "require_paid" for a in (n.names or [])):
                importers.append(path.name)

    assert "user_definitions.py" in definers, (
        "this router no longer defines its own require_paid — the tidy refactor "
        "this task was told not to make")
    assert definers["user_definitions.py"] == [PAID_DETAIL], definers["user_definitions.py"]
    assert importers == [], (
        f"{importers} import require_paid from somewhere else — the shared gate "
        "this task was told not to invent, which would change other routers' "
        "behaviour as a side effect")

    # Every definer speaks for itself: one sentence each, all distinct.
    sentences = [d for details in definers.values() for d in details]
    assert all(len(d) == 1 for d in definers.values()), definers
    assert len(set(sentences)) == len(sentences), (
        f"two routers refuse with the SAME sentence — a member cannot tell which "
        f"surface locked them out: {sentences}")
    # …and the census is not empty, which is what stops the three claims above
    # being satisfied by a walk that read nothing.
    assert len(definers) >= 4, definers


# ─── the node lane: the tier half, RUN rather than grepped ───────────────────
#
# ⚠️ NODE, NOT A SOURCE-TEXT GUARD — the same lane and the same two hook
# customisations `tests/test_user_definitions.py` carries, for the same reason:
# a regex over `nativeRegistry.js` cannot tell a deleted `AST_LANE_TIER` from a
# renamed one, and the claim here is about what the SHIPPED registration door
# does with a definition, not about what a line of source says.

_JS_HOOK = r"""
import { readFile } from 'node:fs/promises'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    for (const ext of ['.js', '/index.js']) {
      try {
        const r = await nextResolve(specifier + ext, context)
        if (r) return r
      } catch { /* fall through to the next candidate */ }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./hook.mjs', import.meta.url)

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)

const registry = await import(pathToFileURL(payload.registry).href)
const schema = await import(pathToFileURL(payload.defSchema).href)
const parse = await import(pathToFileURL(payload.parse).href)
const lint = await import(pathToFileURL(payload.lint).href)

const parsed = parse.parseFormula(payload.source)
if (!parsed.ok) throw new Error(`the fixture formula does not parse: ${parsed.error}`)
const tree = parsed.ast
const mode = lint.lintRepaint(tree).mode

// The document shape `builder/BuilderSheet.jsx::buildDefinition` produces — the
// ONE place the product decides what a user definition looks like. Rebuilt here
// rather than imported because that module is JSX and this lane is bare node.
function doc(tier) {
  const meta = {
    name: 'My formula', shortName: 'F', category: 'Custom',
    tags: ['custom'], repaint: mode,
  }
  if (tier !== null) meta.tier = tier
  return {
    schemaVersion: schema.SCHEMA_VERSION,
    id: 'u_0123456789ab',
    version: 1,
    compute: { kind: 'ast', fn: parse.astHash(tree), rev: 1, ast: tree, source: payload.source },
    meta,
    placement: { target: 'pane', pane: { height: 0.15 } },
    inputs: [{ key: 'color', type: 'color', label: 'Color', default: '#c9a84c' }],
    plots: [{ key: 'value', label: 'F', style: 'line', color: '$color', width: 1, role: 'primary' }],
  }
}

const cases = {}
for (const [name, tier] of [['premium', 'premium'], ['free', 'free'], ['omitted', null]]) {
  const res = registry.validateUserDefinitions([doc(tier)])
  cases[name] = {
    ids: res.defs.map(d => d.id),
    tiers: res.defs.map(d => d.meta.tier),
    errors: res.errors,
  }
}

process.stdout.write(JSON.stringify({
  astLaneTier: registry.AST_LANE_TIER,
  repaintMode: mode,
  cases,
  catalogue: registry.listDefinitions().map(d => ({
    id: d.id, kind: d.compute.kind, tier: d.meta.tier === undefined ? null : d.meta.tier,
  })),
}))
"""


class LaneUnavailable(RuntimeError):
    """The node lane could not run. NOT a skip: the tier claim is only checkable
    there, and a lane that cannot run has not agreed with anything."""


def _js(payload: dict) -> dict:
    """One node process, payload on STDIN.

    ⛔ STDIN, NEVER `-e` — a `-e` string carrying a formula SPLIT under cmd.exe on
    this branch. And the reader is pinned `encoding='utf-8'`: without it Python
    decodes the child as cp1252 and one box-drawing character raises inside the
    reader thread.
    """
    exe = shutil.which("node")
    if not exe:
        raise LaneUnavailable("node is not on PATH")
    tmpdir = tempfile.mkdtemp(prefix="user_definitions_auth_js_")
    try:
        for name, source in (("hook.mjs", _JS_HOOK), ("driver.mjs", _JS_DRIVER)):
            with io.open(os.path.join(tmpdir, name), "w",
                         encoding="utf-8", newline="\n") as fh:
                fh.write(source)
        proc = subprocess.run(
            [exe, os.path.join(tmpdir, "driver.mjs")], cwd=str(ROOT),
            input=json.dumps(payload), capture_output=True, text=True,
            encoding="utf-8", errors="replace")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if proc.returncode != 0:
        raise LaneUnavailable(
            f"the JS lane exited {proc.returncode}: {(proc.stderr or proc.stdout)[-1500:]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise LaneUnavailable(
            f"the JS lane printed something that is not JSON: {exc}; "
            f"stdout was {proc.stdout[:400]!r}") from exc


@pytest.fixture(scope="module")
def js():
    return _js({
        "registry": str(REGISTRY_JS),
        "defSchema": str(DEFSCHEMA_JS),
        "parse": str(PARSE_JS),
        "lint": str(LINT_JS),
        "source": "sma(close, 20)",
    })


def test_the_owner_ruling_is_carried_as_a_TIER_and_the_ast_lane_is_premium(js):
    """✅ OWNER RULING 2026-08-06: *"everything is paid, almost nothing is
    accessible for free."*

    It is already applied once and CONFIRMED: Phase C Task 13 set `rsLine.meta.tier`
    to `premium` because its lane (`/api/signature/columns`) declares
    `Depends(require_paid)`, and the owner confirmed it rather than waiving it. The
    `ast` lane is served only by `/api/user-definitions`, whose every route declares
    the same dependency — asserted three tests up, derived from the route table — so
    it carries the same tier by the same argument.

    ⛔ AND IT IS A GATE, NOT A DEFAULT THAT GETS STAMPED ON. A stamp would silently
    rewrite an author's `free` into `premium` and the badge would stop being
    anything anyone declared; the refusal is the same shape GATE 3 already uses for
    the repaint badge one field over. Both directions are checked: a `free` claim is
    refused AND an OMITTED one is, because `defSchema` lets the field be omitted (a
    definition need not gate itself) and an omitted badge reads as free in the
    library dialog — an absent claim and a false one land a user in the same place.
    """
    assert js["astLaneTier"] == "premium", (
        "the ast lane no longer claims the owner's ruling")

    # THE CONTROL, FIRST. An honest definition registers — without this every
    # refusal below is satisfied by a gate that refuses everything.
    ok = js["cases"]["premium"]
    assert ok["errors"] == [], ok["errors"]
    assert ok["ids"] == ["u_0123456789ab"], ok
    assert ok["tiers"] == ["premium"], ok

    refused = js["cases"]["free"]
    assert refused["ids"] == [], (
        "a `free` badge registered on the ast lane — a definition promising data "
        "`/api/user-definitions` refuses to hand over")
    assert any("meta.tier" in e for e in refused["errors"]), refused["errors"]
    # ⛔ THE DOOR IS NAMED, NOT INFERRED. This branch has found the wrong-door
    # defect (a correct refusal from the wrong guard) four separate times, so the
    # refusal must be about the badge and not about the budget or the linter.
    joined = "\n".join(refused["errors"])
    assert "require_paid" in joined, joined
    assert "budget" not in joined and "linter" not in joined, joined

    omitted = js["cases"]["omitted"]
    assert omitted["ids"] == [], (
        "a definition with NO tier registered — an omitted badge reads as free")
    assert any("meta.tier" in e and "required" in e for e in omitted["errors"]), \
        omitted["errors"]

    # …and the fixture really did exercise the ast lane rather than some other
    # branch: the formula linted clean, which is what let it reach GATE 4 at all.
    assert js["repaintMode"] == "non-repainting", js["repaintMode"]


def test_the_free_tier_is_EXACTLY_the_sixteen_natives_and_that_is_the_OWNER_QUESTION(js):
    """⚠️ THE ESCALATION, HELD VISIBLE RATHER THAN ANSWERED.

    `nativeRegistry.nativeDef` writes `tier: 'free'` in ONE shared helper before the
    `...meta` spread, so every native inherits it and no native overrides it — a
    uniform column, which is indistinguishable from an unset one. The owner's
    ruling would re-tier all sixteen in one edit, on a surface that has shipped
    free since B1. THAT IS A PAYWALL DECISION WITH A BLAST RADIUS AND IT IS NOT
    TASK 14'S TO TAKE.

    So this asserts the PARTITION rather than the policy: every free-tier
    definition is a native, and every non-native lane — the one that fetches
    (`server`) and the one a user authors (`ast`) — is premium. It is a real claim,
    not a tautology: `rsLine` is on the `server` lane and was `free` until Task 13
    corrected it. The day the owner answers, this test is what says out loud that
    the answer landed.
    """
    catalogue = js["catalogue"]
    assert len(catalogue) >= 17, catalogue

    by_lane: dict[str, set] = {}
    for d in catalogue:
        by_lane.setdefault(d["kind"], set()).add((d["id"], d["tier"]))

    free_ids = sorted(d["id"] for d in catalogue if d["tier"] == "free")
    native_ids = sorted(d["id"] for d in catalogue if d["kind"] == "native")
    assert free_ids == native_ids, (
        "the free tier is no longer exactly the natives. If the OWNER answered "
        "the shared-default question (nativeRegistry.js `nativeDef`, 16 natives, "
        "paywall blast radius), record the answer and update this rail; if a NEW "
        "lane arrived free, it is the silently-dead-indicator class this phase "
        f"exists to retire. free={free_ids} native={native_ids}")

    assert all(t == "premium" for _, t in by_lane.get("server", set())), by_lane["server"]
    # …and the natives really are uniform, which is the half of the finding the
    # owner is being asked about: a uniform column is indistinguishable from an
    # unset one.
    assert {t for _, t in by_lane["native"]} == {"free"}, by_lane["native"]
