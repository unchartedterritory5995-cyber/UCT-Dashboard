"""S6 CP2' -- THE MIGRATION RAIL. GATE-S6 §4, CP2' (proposed, F-S6-1's fix).

The packet's own corrected proposal, verbatim:

    **CP2' (proposed).** The first migration (SPEC §5): `get_user_ticker_sets`
    -> `member_interest.interest_for`, signature unchanged, proved a no-op at
    EVERY call site enumerated by an AST sweep of `api/**` at build time --
    today Calendar (3 sites), the alert-taxonomy event-proximity projection,
    and `calendar_alerts` -- against CP1's baseline.

⛔ F-S6-1's own finding: CP2's original text said "Calendar the only caller."
There are three modules, five call sites. **The sweep is the enumeration;
this sentence does not carry the count** -- a sixth site added tomorrow must
be caught by re-running the sweep, not by trusting a number written here.
"""
from __future__ import annotations

import ast
import pathlib

_REPO = pathlib.Path(__file__).resolve().parents[1]
_API = _REPO / "api"


def _call_sites_of(func_name: str) -> list[tuple[str, int]]:
    """Every `(file, lineno)` calling a function named `func_name`, anywhere
    in `api/**`, however it is imported (`get_user_ticker_sets(...)`,
    `cp.get_user_ticker_sets(...)`, `_cp.get_user_ticker_sets(...)` -- an AST
    Attribute or Name call, matched on the FINAL attribute/name only, since
    the whole point is to survive an import-alias change that a grep would
    miss."""
    out: list[tuple[str, int]] = []
    for py in _API.rglob("*.py"):
        if "__pycache__" in py.parts:
            continue
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            f = node.func
            name = f.attr if isinstance(f, ast.Attribute) else (
                f.id if isinstance(f, ast.Name) else None)
            if name == func_name:
                out.append((str(py.relative_to(_REPO)).replace("\\", "/"), node.lineno))
    return out


# ═════════════════════════════════════════════════════════════════════════
# NON-VACUITY -- the sweep must find something, or every assertion below
# passes because nothing was checked
# ═════════════════════════════════════════════════════════════════════════

def test_NON_VACUITY_the_sweep_finds_call_sites_at_all():
    sites = _call_sites_of("get_user_ticker_sets")
    assert len(sites) >= 5, (
        f"the AST sweep found only {sites} call sites of get_user_ticker_sets "
        "-- F-S6-1 measured 5 (three in calendar.py, one in "
        "event_proximity_projection.py, one in calendar_alerts.py). Either "
        "the sweep is broken, or call sites were removed -- re-verify by "
        "hand before trusting either answer.")


def test_CONTROL_the_sweep_survives_an_import_alias():
    """⛔ `api/routers/calendar.py` imports the module as `_cp` and calls
    `_cp.get_user_ticker_sets(...)` -- an Attribute call, not a bare Name.
    A sweep that only matched bare Name calls would silently miss every one
    of Calendar's three sites, which is exactly the failure this control
    catches: it asserts the alias'd sites are actually IN the result."""
    sites = _call_sites_of("get_user_ticker_sets")
    files = {f for f, _ln in sites}
    assert "api/routers/calendar.py" in files, (
        "the sweep did not find calendar.py's _cp.get_user_ticker_sets(...) "
        "call sites -- it is only matching bare-name calls, not attribute "
        "calls through an import alias")


# ═════════════════════════════════════════════════════════════════════════
# THE ENUMERATION -- named, not counted, and each one accounted for
# ═════════════════════════════════════════════════════════════════════════

#: ⛔ Recorded here as F-S6-1's OWN evidence for the finding, exactly as the
#: packet says: "The enumeration above is dated. It is written as evidence
#: for the finding, not as the list the build should trust." The rail below
#: does NOT compare the sweep's count against this tuple's length -- it
#: names each entry so a NEW site the sweep finds is reported BY NAME,
#: never silently absorbed into a bigger number.
_KNOWN_2026_09_15 = frozenset({
    "api/routers/calendar.py",
    "api/services/alert_taxonomy/event_proximity_projection.py",
    "api/services/calendar_alerts.py",
})


def test_every_call_site_is_in_a_module_this_migration_reasoned_about():
    """⛔⛔ THE RAIL, failing BY NAME on a site nobody has looked at. A new
    caller of `get_user_ticker_sets` in a module outside the three F-S6-1
    named is not wrong by construction -- `get_user_ticker_sets`'s shape is
    unchanged, so it would likely still be a no-op -- but it is UNREASONED
    ABOUT, and this rail's whole purpose is to stop that from being silent
    the way F-S6-1's original "Calendar the only caller" claim was."""
    sites = _call_sites_of("get_user_ticker_sets")
    unreasoned = sorted({f for f, _ln in sites} - _KNOWN_2026_09_15)
    assert not unreasoned, (
        f"get_user_ticker_sets is now called from {unreasoned}, which this "
        "migration's own reasoning (F-S6-1, GATE-S6 CP2') never considered. "
        "Read what it does with the returned dict before trusting the "
        "no-op claim for this site, then add it to _KNOWN_2026_09_15 here.")


# ═════════════════════════════════════════════════════════════════════════
# THE NO-OP PROOF -- the shape every site depends on is unchanged
# ═════════════════════════════════════════════════════════════════════════

def test_get_user_ticker_sets_still_returns_the_declared_five_keys():
    """⛔ Every one of the five known call sites reads this dict ONLY via
    `.get("all_mine")` or the full dict passed whole into `to_payload`
    (verified by hand against F-S6-1's own list) -- so the migration is
    provably a no-op at ALL of them if, and only if, this shape holds:
    exactly five keys, four of them the declared source names, one the
    `all_mine` union, every value a `set`."""
    from unittest import mock
    from api.services import calendar_personalization as cp
    from api.services import member_interest as mi

    with mock.patch.object(mi, "_watchlist_syms", return_value={"AAPL"}), \
         mock.patch.object(mi, "_flagged_syms", return_value=set()), \
         mock.patch.object(mi, "_position_syms", return_value=set()), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        out = cp.get_user_ticker_sets("u")

    assert set(out.keys()) == {"watchlist", "flagged", "positions", "uct20", "all_mine"}
    for k, v in out.items():
        assert isinstance(v, set), f"{k!r} is {type(v)}, every caller expects a set"
