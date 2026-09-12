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
    # NON-VACUITY: an AST walk that found nothing would pass this trivially, and
    # "no call sites" is exactly what a broken scan looks like.
    assert len(sites) >= 25, f"the scan found only {len(sites)} _fmp_get sites — broken, not green"

    unpinned = [(p, ln) for p, ln, has in sites if not has and p not in OWNER_RESERVED]
    assert unpinned == [], (
        "these _fmp_get call sites inherit a default timeout instead of naming one: "
        f"{unpinned}. Pin the number at the call site (10 to preserve today's "
        "behaviour) — an unnamed timeout becomes 25 s the day it migrates to the "
        "typed adapter, and nothing goes red when it does.")


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
