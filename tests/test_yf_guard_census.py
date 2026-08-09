"""STRUCTURAL RAIL: nothing reaches yfinance outside `yf_util.bounded_call`.

This is the gate on the 2026-08-08 429 storm. Production logs showed dozens of
`Too Many Requests` per second, sustained, from a provider nothing in this repo
handled by name (`grep -rn YFRateLimitError api/` → 0 hits). The cause was not
one bad module: it was that "goes through the guard" was an unenforced
convention, so 20 modules had drifted off it — most of them via a FUNCTION-LOCAL
`import yfinance`, which reads like a normal import and binds a private copy of
the library inside a call frame, escaping the pool, the deadline, the breaker
and every test stub (`lesson_from_import_severs_a_module_from_its_guards`).

WHY THESE ASSERTIONS NAME FILES AND LINES. A count would pass on a swap: fix one
bypass, add another, the number is unchanged and the rail stays green. Every
failure here prints `path:line expr (in scope, function-local import)`.

WHY AN AST AND NOT A GREP. The defect is invisible to a grep. 22 modules under
`api/` match "yfinance"; the question is which of them REACH it outside a
guarded callable, and only the syntax tree can answer that.

The census itself lives in `tools/yf_guard_census.py`. Its own correctness is
covered here by a POSITIVE CONTROL (a planted bypass must be reported by name)
and its inverse (the same call, wrapped, must clear) — without both, "0 findings"
could just mean the census stopped working.
"""
from __future__ import annotations

import textwrap

from tools import yf_guard_census as cen

BASE = cen.repo_root()


# ── QUARANTINE ───────────────────────────────────────────────────────────────
# EMPTY, and that is the point: as of 2026-08-08 nothing under api/ reaches
# yfinance outside the guard, so the rail below has no exemptions to hide
# behind. Keep it empty if you possibly can.
#
# The mechanism, for whoever needs it next: an entry is `path -> count`, the
# count being the known bypasses at the time of listing. A quarantined file is
# skipped by the "no bypass" assertion but must not GROW — and the count is a
# ceiling, never an equality, so the rail can never punish the person who
# finally fixes it. Delete the entry once its module is clean.
#
# (`api/services/earnings_enrichment.py` was the last holdout — three
# function-local `import yfinance as _yf` statements behind a private
# 4-worker pool. It now routes through `yf_util.bounded_call(..., lane=
# "earnings")`: the same isolated slots it wanted, under the shared breaker.)
QUARANTINE: dict[str, int] = {}

# Modules that reach yfinance and are guarded, whose "the guard binds" proof
# lives in a test that is not tests/test_yf_guard_binds.py. Listed so that a NEW
# module can never land here silently — see
# tests/test_yf_guard_binds.py::test_every_yfinance_module_has_a_binding_proof…
PRE_EXISTING_BINDING_PROOFS = {
    "api/services/annual_financials.py":        "tests/test_annual_financials.py",
    "api/services/earnings_table.py":           "tests/test_earnings_table.py",
    "api/services/earnings_estimates.py":       "tests/test_chart_markers.py",
    "api/services/earnings_enrichment.py":      "tests/test_earnings_enrichment_spot_source.py",
    "api/services/research/estimates.py":       "tests/test_research_ratings.py",
    "api/services/research/financials.py":      "tests/test_research_financials.py",
    "api/services/research/ownership.py":       "tests/test_research_ratings.py",
}


def _fmt(reaches) -> str:
    return "\n".join(f"    {r}" for r in reaches)


def test_no_module_reaches_yfinance_outside_the_guard():
    found = cen.census(BASE)
    stray = [r for r in found if r.path not in QUARANTINE]
    assert not stray, (
        "yfinance is reached without going through `yf_util.bounded_call` — a "
        "call at these sites has no shared pool, no deadline, and is invisible "
        "to the rate-limit breaker:\n"
        + _fmt(stray)
        + "\n\nWrap the call: `yf_util.bounded_call(lambda: yf.Ticker(t).info, None)`. "
        "Import the MODULE (`from api.services import yf_util`), never the function."
    )


def test_a_quarantined_module_never_grows_a_new_bypass():
    found = cen.census(BASE)
    for path, allowed in QUARANTINE.items():
        here = [r for r in found if r.path == path]
        assert len(here) <= allowed, (
            f"{path} is quarantined at {allowed} known bypasses and now has "
            f"{len(here)}:\n" + _fmt(here)
        )


def test_the_guard_is_defined_exactly_once():
    defs = cen.guard_definitions(BASE)
    assert defs == [(cen.GUARD_MODULE, defs[0][1] if defs else 0)], (
        "`bounded_call` must be defined once, in " + cen.GUARD_MODULE +
        f" — found {defs}. A second definition is a second pool and a second "
        "breaker, i.e. the same defect wearing a nicer hat."
    )


def test_every_accepted_alias_is_a_real_pass_through_wrapper():
    """The alias list is the census's only soft spot: adding one name to
    `ALIAS_NAMES` would make every call of that name read as "guarded".

    So "delegates" is not "contains a bounded_call somewhere" — that would let
    any DATA function qualify (`ticker_meta._from_yfinance` calls the guard on
    an internal lambda, and adding its name would have been accepted). The
    alias must pass ITS OWN first parameter through to `bounded_call`, i.e. the
    caller's callable is the thing that actually gets bounded."""
    report = cen.alias_delegation(BASE)
    for alias, sites in report.items():
        assert sites, f"accepted alias {alias!r} has no definition under api/ — delete it from ALIAS_NAMES"
        bad = [(p, ln) for p, ln, ok in sites if not ok]
        assert not bad, (
            f"{alias!r} is accepted as the guard but is not a pass-through "
            f"wrapper over `bounded_call` at {bad}. Either make it one "
            "(`def f(fn, ...): return yf_util.bounded_call(fn, ...)`) or remove "
            "it from ALIAS_NAMES."
        )


def test_nothing_from_imports_the_guard_function():
    """`from api.services.yf_util import bounded_call` binds a private copy.

    That is not pedantry — it is the mechanism that makes the binding tests in
    tests/test_yf_guard_binds.py vacuous: they patch `yf_util.bounded_call`, and
    a from-imported copy sails straight past the patch while the test still
    passes. Same shape as the three function-local `import yfinance` statements
    this whole rail exists to catch."""
    severed = cen.severed_guard_imports(BASE)
    assert not severed, (
        "import the MODULE, not the function:\n"
        + "\n".join(f"    {s}" for s in severed)
        + "\n\n    from api.services import yf_util        # then yf_util.bounded_call(...)"
    )


# ── POSITIVE CONTROLS ────────────────────────────────────────────────────────
# Without these, a census that silently stopped parsing would report 0 findings
# and every assertion above would pass. Each control plants real source in a
# temp tree and runs the real `census()` over it.

_BYPASS_LOCAL_IMPORT = '''\
def get_context(sym):
    import yfinance as _yf
    return _yf.Ticker(sym).history(period="3mo")
'''

_BYPASS_MODULE_IMPORT = '''\
import yfinance as yf

def spot(sym):
    return yf.Ticker(sym).info
'''

_BYPASS_FROM_IMPORT = '''\
from yfinance import Ticker

def spot(sym):
    return Ticker(sym).info
'''

_GUARDED = '''\
from api.services import yf_util

def get_context(sym):
    import yfinance as _yf
    return yf_util.bounded_call(
        lambda: _yf.Ticker(sym).history(period="3mo"), None)
'''

_GUARDED_VIA_HELPER = '''\
from api.services import yf_util

def _work(sym):
    import yfinance as _yf
    return _yf.Ticker(sym).info

def spot(sym):
    return yf_util.bounded_call(lambda: _work(sym), None)
'''


def _plant(tmp_path, name, source):
    root = tmp_path / "api"
    root.mkdir(exist_ok=True)
    (root / name).write_text(textwrap.dedent(source), encoding="utf-8")
    return cen.census(str(tmp_path))


def test_the_census_reports_a_planted_function_local_bypass_by_name(tmp_path):
    """THE control. A function-local `import yfinance` is the exact shape that
    hid three bypasses in earnings_enrichment.py behind a clean-looking grep."""
    found = _plant(tmp_path, "planted.py", _BYPASS_LOCAL_IMPORT)
    assert len(found) == 1, found
    r = found[0]
    assert r.path == "api/planted.py"
    assert r.line == 3
    assert r.expr == "_yf.Ticker"
    assert r.scope == "get_context"
    assert r.local_import is True, "must be identified as the private-copy form"


def test_the_census_reports_a_planted_module_level_bypass(tmp_path):
    found = _plant(tmp_path, "planted.py", _BYPASS_MODULE_IMPORT)
    assert [(r.path, r.line, r.expr, r.local_import) for r in found] == [
        ("api/planted.py", 4, "yf.Ticker", False)
    ]


def test_the_census_reports_a_planted_from_import_bypass(tmp_path):
    """`from yfinance import Ticker` never spells "yf." anywhere — a grep for
    the usual call shape misses it entirely."""
    found = _plant(tmp_path, "planted.py", _BYPASS_FROM_IMPORT)
    assert [(r.line, r.expr) for r in found] == [(4, "Ticker")]


def test_the_census_clears_the_same_call_once_it_is_wrapped(tmp_path):
    """The control's control: prove the census is discriminating on the GUARD
    and not merely on the word "yfinance"."""
    assert _plant(tmp_path, "planted.py", _GUARDED) == []


def test_the_census_clears_a_helper_whose_every_call_site_is_guarded(tmp_path):
    """Transitive rule — `earnings_estimates._yf_corporate_actions` is the live
    case. Demanding a second wrap inside it would add a nested guard for
    nothing."""
    assert _plant(tmp_path, "planted.py", _GUARDED_VIA_HELPER) == []


def test_the_census_still_flags_a_helper_with_one_unguarded_call_site(tmp_path):
    """...and the transitive rule must not become a loophole: ONE unguarded
    call site re-exposes the helper."""
    source = _GUARDED_VIA_HELPER + "\n\ndef careless(sym):\n    return _work(sym)\n"
    found = _plant(tmp_path, "planted.py", source)
    assert [r.expr for r in found] == ["_yf.Ticker"], found


def test_the_census_ignores_a_shadowing_local_name(tmp_path):
    """A parameter named `yf` in a module that also imports yfinance is not a
    reach — a false positive here trains people to add names to the ignore
    list, which is how a real rail dies."""
    source = '''\
    import yfinance as yf

    def render(yf):
        return yf.title
    '''
    assert _plant(tmp_path, "planted.py", source) == []


def _first_def(source: str):
    import ast
    tree = ast.parse(textwrap.dedent(source))
    return next(n for n in ast.walk(tree)
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)))


def test_the_wrapper_check_accepts_a_real_pass_through_wrapper():
    fdef = _first_def('''\
    def _bounded_yf(fn, default, timeout=12.0):
        return yf_util.bounded_call(fn, default, timeout=timeout)
    ''')
    assert cen._is_pass_through_wrapper(fdef) is True


def test_the_wrapper_check_rejects_a_data_function_that_merely_calls_the_guard():
    """Without this, `_is_pass_through_wrapper` could be weakened to "contains
    a bounded_call anywhere" and every rail above would stay green — the
    alias list would silently become a one-word bypass switch again.

    `ticker_meta._from_yfinance` is the real shape: it calls the guard, on its
    OWN lambda. Accepting it would mean every `_from_yfinance(...)` call site
    anywhere counted as guarded."""
    fdef = _first_def('''\
    def _from_yfinance(ticker):
        import yfinance as yf
        return yf_util.bounded_call(lambda: yf.Ticker(ticker).info, None)
    ''')
    assert cen._is_pass_through_wrapper(fdef) is False


def test_the_wrapper_check_rejects_a_private_valve_that_never_delegates():
    """The realistic abuse: a module keeps its own pool and its owner adds the
    valve's name to ALIAS_NAMES to make the census go quiet."""
    fdef = _first_def('''\
    def _yf_bounded(fn, default, timeout=None):
        try:
            return _YF_POOL.submit(fn).result(timeout=timeout or 12.0)
        except Exception:
            return default
    ''')
    assert cen._is_pass_through_wrapper(fdef) is False


def test_the_wrapper_check_rejects_a_zero_argument_function():
    fdef = _first_def('''\
    def warm():
        return yf_util.bounded_call(lambda: 1, None)
    ''')
    assert cen._is_pass_through_wrapper(fdef) is False


def test_the_severed_import_rail_reports_a_planted_from_import(tmp_path):
    root = tmp_path / "api"
    root.mkdir()
    (root / "planted.py").write_text(
        "from api.services.yf_util import bounded_call\n", encoding="utf-8")
    found = cen.severed_guard_imports(str(tmp_path))
    assert [(s.path, s.line) for s in found] == [("api/planted.py", 1)]
