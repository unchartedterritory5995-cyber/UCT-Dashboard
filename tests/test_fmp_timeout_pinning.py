"""G1 — every `_fmp_get` call site names its own timeout.

⛔ WHY THIS RAIL EXISTS, AND WHY IT IS NOT COSMETIC.

`earnings_estimates._fmp_get` defaults to **10 s**. The typed adapter
(`fmp_client._DEFAULT_TIMEOUT`) defaults to **25 s**. So a call site that names
no timeout is sitting on 10 s *by accident*, and the day someone migrates it to
the adapter it silently moves to 25 s.

⭐ **A timeout change fails as SLOWNESS, never as an error.** No test anywhere
goes red. A nightly sweep quietly stretches past its window; a request path
quietly passes the reverse proxy's read timeout. That is the one class of
regression this repo cannot detect after the fact, so it is prevented before:
once every site names its number, the move shows up in a diff.

⛔ `bars_sanitize.py` is EXCLUDED BY NAME — bars-api territory, owner-reserved.
The exclusion is a single named constant, not a pattern, so widening it is a
deliberate, reviewable act rather than a regex quietly matching a new file.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]

# Owner-reserved: bars-api territory. Excluded from G1 by ruling, not by taste.
OWNER_RESERVED = {"api/services/bars_sanitize.py"}


def _call_sites():
    """Every `_fmp_get(...)` call in `api/`, as (path, lineno, has_timeout).

    ⭐ AST, never grep: a grep for `_fmp_get(` matches the prose that discusses
    it, and this repo has published six separate findings that were really its
    own instrument matching a comment.
    """
    out = []
    for f in sorted((_REPO / "api").rglob("*.py")):
        rel = f.relative_to(_REPO).as_posix()
        try:
            tree = ast.parse(f.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            name = None
            if isinstance(n.func, ast.Name):
                name = n.func.id
            elif isinstance(n.func, ast.Attribute):
                name = n.func.attr
            if name != "_fmp_get":
                continue
            out.append((rel, n.lineno, any(k.arg == "timeout" for k in n.keywords)))
    return out


def test_every_fmp_get_call_site_names_its_timeout():
    sites = _call_sites()
    # ⛔ NON-VACUITY, AND IT NAMES A MEMBER RATHER THAN COUNTING.
    # ⚰️ This asserted `len(sites) >= 25`. G1 tranche 1 migrated nine sites onto
    # the typed adapter and the population fell to 24, so the floor went red for
    # the RIGHT reason and the WRONG cause — it was measuring migration progress,
    # not scan health. A count beside a population that is deliberately shrinking
    # is a rail that must be edited every time the work succeeds.
    # ⭐ A named member cannot drift that way: `bars_sanitize.py` is
    # owner-reserved and excluded from migration BY RULING, so it is the one site
    # guaranteed to still be here.
    paths = {p for p, _, _ in sites}
    assert "api/services/bars_sanitize.py" in paths, (
        "the scan did not find the owner-reserved site that is excluded from "
        f"migration by ruling — it is broken, not green. Saw: {sorted(paths)}")

    unpinned = [(p, ln) for p, ln, has in sites if not has and p not in OWNER_RESERVED]
    assert unpinned == [], (
        "these _fmp_get call sites inherit a default timeout instead of naming one: "
        f"{unpinned}. Pin the number at the call site (10 to preserve today's "
        "behaviour) — an unnamed timeout becomes 25 s the day it migrates to the "
        "typed adapter, and nothing goes red when it does.")


def test_the_scan_ALSO_SEES_fmp_get_passed_as_a_REFERENCE():
    """⛔⛔ THE BLIND SPOT THIS RAIL SHIPPED WITH, found by migrating G1 tranche 1.

    `api/routers/research.py` passes `_fmp_get` to `ThreadPoolExecutor.submit`
    as a CALLABLE:

        ex.submit(_fmp_get, path, {...}, timeout=12)

    That is a `Name` node in an argument position, **not** a `Call` whose func is
    `_fmp_get` — so the call-site scan above walked straight past it, and so did
    the census that produced the 12 -> 31 number. ⭐ The site happens to pass a
    timeout, so nothing was broken; what was broken is the INSTRUMENT, which
    reported a complete census it could not have made
    (`lesson_an_instrument_can_reproduce_its_own_blind_spot`).

    ⛔ A reference site cannot be checked for a timeout by reading the reference
    — the argument is supplied at the `submit` call. So this rail does the only
    honest thing: it ENUMERATES them and requires each to be known, rather than
    silently covering zero of them.
    """
    refs = []
    for f in sorted((_REPO / "api").rglob("*.py")):
        rel = f.relative_to(_REPO).as_posix()
        try:
            tree = ast.parse(f.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for arg in node.args:
                if isinstance(arg, ast.Name) and arg.id == "_fmp_get":
                    refs.append((rel, node.lineno))
                elif isinstance(arg, ast.Attribute) and arg.attr == "_fmp_get":
                    refs.append((rel, node.lineno))

    KNOWN = {"api/routers/research.py"}
    unknown = sorted({rel for rel, _ in refs} - KNOWN)
    assert unknown == [], (
        f"`_fmp_get` is passed as a REFERENCE from {unknown}. A reference site is "
        "invisible to the call-site scan above, so its timeout cannot be pinned "
        "there. Either give it an explicit timeout at the submit/partial call and "
        "add it to KNOWN, or migrate it to the typed adapter.")

    # ⛔ NON-VACUITY: if the reference form ever disappears, this exemption stops
    # describing anything and should be retired rather than carried.
    assert refs, (
        "no `_fmp_get` reference sites found at all — either they were migrated "
        "(retire this test and its KNOWN set) or this scan is broken")


def test_the_owner_reserved_exclusion_is_STILL_REAL():
    """⛔ CONTROL WITH TEETH. If `bars_sanitize.py` is someday pinned or deleted,
    this exclusion stops describing anything and quietly widens the rail's blind
    spot. A rail that cannot tell you its own exemption is obsolete is worse than
    no exemption."""
    sites = _call_sites()
    reserved = [(p, ln, has) for p, ln, has in sites if p in OWNER_RESERVED]
    assert reserved, (
        "the owner-reserved exclusion names a file with no _fmp_get call sites — "
        "remove the exemption rather than carrying a dead one")
    assert any(not has for _, _, has in reserved), (
        "every owner-reserved site now names a timeout; the exemption is no longer "
        "load-bearing and should be retired with the owner")


def test_the_typed_adapter_default_and_the_legacy_default_still_disagree():
    """⛔ THE PREMISE OF THIS WHOLE RAIL, ASSERTED RATHER THAN ASSUMED.

    If the two defaults were ever reconciled, an unpinned site would be harmless
    and this rail would be ceremony. They are not reconciled — 25 vs 10 — and
    that gap is the entire reason G1 is not a mechanical migration.
    """
    from api.services import fmp_client
    import inspect
    src = pathlib.Path(inspect.getsourcefile(fmp_client)).read_text(encoding="utf-8")
    assert fmp_client._DEFAULT_TIMEOUT == 25, (
        f"the adapter default moved to {fmp_client._DEFAULT_TIMEOUT}; re-read G1's "
        "tranche reasoning before trusting this rail")
    legacy = (_REPO / "api" / "services" / "earnings_estimates.py").read_text(encoding="utf-8")
    tree = ast.parse(legacy)
    default = None
    for n in ast.walk(tree):
        if isinstance(n, ast.FunctionDef) and n.name == "_fmp_get":
            for a, d in zip(reversed(n.args.args + n.args.kwonlyargs),
                            reversed(list(n.args.defaults) + list(n.args.kw_defaults))):
                if a.arg == "timeout" and isinstance(d, ast.Constant):
                    default = d.value
    assert default == 10, (
        f"the legacy _fmp_get default is now {default!r}, not 10 — the 10-second "
        "pins written across the call sites were chosen to preserve THAT number")
