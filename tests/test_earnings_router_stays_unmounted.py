"""⛔ `POST /api/schwab/earnings` HAS EXACTLY ONE OWNER — and this file is what
makes that a decision rather than an oversight.

WHAT CHANGED, 2026-09-26 (TERM-004)
-----------------------------------
`api/earnings_router.py` — the unmounted Finviz-scraping predecessor this file
was originally written around — is **DELETED**. Verified before deleting it:
zero `include_router` calls anywhere in the repo, the name `earnings_router`
absent from `api/main.py` entirely, and its only references were this file plus
two prose citations in other suites' docstrings. It had no consumers.

It was deleted rather than kept as a rollback copy because its own module
docstring instructed its reader to wire it up:

    Mount in main.py: app.include_router(earnings_router, prefix="/api/schwab")

…at the prefix `api/schwab_router.py` already owns — that module is
`APIRouter(prefix="/api/schwab")` with a mounted `@router.post("/earnings")` —
so following that instruction registered the identical
`(POST, /api/schwab/earnings)` **twice**. FastAPI resolves duplicates by FIRST
MATCH, so one of a Finviz scraper and a Yahoo fetcher would silently never run,
and which one would depend on include order in an 11,000-line file. git history
is the rollback; a live instruction to create a second authority over one value
is not worth keeping in the tree for it.

⛔ THE FILE NAME IS KEPT ON PURPOSE. A deleted module is certainly unmounted, and
this path is cited by name from `tests/test_screener_backtest_mounted.py`,
`tests/test_alert_taxonomy_registration_is_wired.py` and `CLAUDE.md`. What
changed is the SHAPE of two assertions, not the subject.

⛔⛔ AND THE SUBJECT WAS ALWAYS THE ADDRESS, NOT THE FILE. The hazard was never
"this one module exists"; it was "two handlers answer one address". So the
load-bearing rails below read the LIVE route table of `api.main:app` and go red
on a second registration of that address **whatever produces it** — a restored
predecessor, a second `@router.post("/earnings")` pasted into `schwab_router.py`,
a brand-new router mounted at the same prefix. They are strictly stronger than
the import-based checks they replace, which could only ever see one file.

⚠️ A TEST THAT PASSES BECAUSE ITS SUBJECT IS GONE IS WORSE THAN NO TEST. The
absence assertion therefore carries a control proving the same two probes SEE a
present sibling (`api/schwab_router.py` / `api.schwab_router`), and the address
assertions cannot pass vacuously because they require the address to be OWNED —
by `api.schwab_router` specifically — rather than merely un-duplicated. An empty
or unloaded route table fails them by name.
"""
import importlib.util
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
EARNINGS_PATH = "/api/schwab/earnings"

_REPO = pathlib.Path(__file__).resolve().parents[1]

#: The retired module, and the live sibling used as this file's control. The
#: control is a REAL present module so that "absent" can never mean "the probe
#: cannot see anything".
RETIRED = ("api.earnings_router", _REPO / "api" / "earnings_router.py")
PRESENT = ("api.schwab_router", _REPO / "api" / "schwab_router.py")


@pytest.fixture(scope="module")
def real_app():
    from api.main import app
    return app


def _registrations(app):
    """(method, path) -> [endpoint qualnames], over the LIVE route table."""
    out = {}
    for r in getattr(app, "routes", []):
        path = getattr(r, "path", None)
        if not path:
            continue
        ep = getattr(r, "endpoint", None)
        name = f"{getattr(ep, '__module__', '?')}.{getattr(ep, '__name__', '?')}"
        for m in (getattr(r, "methods", None) or set()):
            if m in ("HEAD", "OPTIONS"):
                continue
            out.setdefault((m, path), []).append(name)
    return out


def test_the_earnings_address_has_exactly_one_owner(real_app):
    """⭐⭐ THE RAIL THE DELETION DID NOT CHANGE, AND THE ONE THAT MATTERS.

    It was already the strongest assertion in this file and it is untouched: it
    reads the live table and refuses a second owner of the address regardless of
    which module supplies it. This is what stands between the deleted
    docstring's instruction — should anyone act on it from git history — and a
    silent first-match shadow.
    """
    regs = _registrations(real_app)
    owners = regs.get(("POST", EARNINGS_PATH))
    assert owners, (
        f"POST {EARNINGS_PATH} is not served at all — schwab_router lost its "
        f"mount, which is the broker_sync 405 failure mode again")
    assert len(owners) == 1, (
        f"POST {EARNINGS_PATH} is registered {len(owners)} times: {owners}. "
        f"FastAPI answers with the FIRST match, so one of these implementations "
        f"is dead code that looks live, and which one depends on include order.")
    assert owners[0].startswith("api.schwab_router"), (
        f"POST {EARNINGS_PATH} is answered by {owners[0]}, not by the live "
        f"Yahoo-backed handler in api/schwab_router.py")


def test_the_address_this_file_guards_is_the_one_schwab_router_DECLARES():
    """⛔ NON-VACUITY, AND THE PIN ON THE ONE TYPED LITERAL HERE.

    `EARNINGS_PATH` is the only address written by hand in this file, so it is
    compared against the router object that owns it. If `schwab_router` renames
    its route or moves its prefix, every assertion above would go on passing
    about an address nobody serves — so this fails first and says to revisit the
    supersession rather than work around it.

    ⚠️ This replaces the old `test_the_collision_is_real_and_not_a_stale_claim`,
    which measured the collision by importing BOTH routers and intersecting their
    declared paths. Half of that check — "the live router still declares this
    address" — is what actually kept the file honest and is preserved here. The
    other half asked whether the deleted module still asked for the colliding
    prefix, a question a deleted module cannot answer and which the live-table
    rails above no longer need it to.
    """
    from api.schwab_router import router as live

    declared = {(m, r.path) for r in live.routes
                for m in (getattr(r, "methods", None) or set()) if m in MUTATING}
    assert declared, (
        "api/schwab_router.py declares no mutating routes at all — it did not "
        "import properly and every assertion in this file is vacuous")
    assert ("POST", EARNINGS_PATH) in declared, (
        f"schwab_router no longer declares POST {EARNINGS_PATH} (it declares "
        f"{sorted(declared)}); the supersession this file records has expired "
        f"and must be revisited, not worked around")


def test_the_finviz_predecessor_is_GONE_and_bringing_it_back_is_a_DECISION():
    """⛔ THE RETIREMENT, ASSERTED TWO WAYS, WITH A CONTROL FOR EACH.

    On disk AND as an importable module, because they can diverge: a sourceless
    `.pyc` dropped beside the package imports with no `.py` present, and a `.py`
    restored into the tree is importable the moment it lands. Either way the
    hazard is back — not the route (the rails above own that), but the
    INSTRUCTION, which is what made this file a footgun rather than dead weight.

    ⭐ THE CONTROL IS THE WHOLE POINT. Both probes are run against a module that
    IS present, so a `find_spec` that had quietly stopped resolving anything, or
    a `_REPO` that no longer points at the repo, cannot make this pass by
    answering "no" to everything.
    """
    retired_mod, retired_file = RETIRED
    present_mod, present_file = PRESENT

    # ── the controls, first ───────────────────────────────────────────────────
    assert present_file.exists(), (
        f"the control file {present_file} is missing, so 'the retired file is "
        f"absent' is a statement about a broken path, not about the repo")
    assert importlib.util.find_spec(present_mod) is not None, (
        f"the control module {present_mod} does not resolve either — the import "
        f"probe is broken and proves nothing about {retired_mod}")

    # ── the assertion ─────────────────────────────────────────────────────────
    assert not retired_file.exists(), (
        f"{retired_file} is back. It was retired 2026-09-26 (TERM-004) because "
        f"its own docstring instructs `app.include_router(earnings_router, "
        f"prefix='/api/schwab')`, which registers POST {EARNINGS_PATH} a second "
        f"time behind the live Yahoo handler. If it was restored DELIBERATELY, "
        f"strip that instruction from the docstring in the same change and say "
        f"here which handler is meant to own the address.")
    assert importlib.util.find_spec(retired_mod) is None, (
        f"{retired_mod} still imports even though {retired_file} is absent — a "
        f"sourceless .pyc or an installed copy is shadowing the deletion, so "
        f"the module a reader is told to mount is still reachable.")


def test_no_two_handlers_claim_the_same_address(real_app):
    """The general form, and the reachability audit's own measurement: of 986
    registered routes, ZERO duplicate (method, path) pairs. Kept as a standing
    rail because a duplicate is silent — the shadowed handler keeps its tests,
    keeps importing, and simply never runs."""
    regs = _registrations(real_app)
    assert len(regs) > 500, (
        f"only {len(regs)} registrations found; the route table did not load and "
        f"this rail is vacuous")
    dupes = {k: v for k, v in regs.items() if len(v) > 1}
    assert dupes == {}, (
        f"{len(dupes)} address(es) are claimed by more than one handler. FastAPI "
        f"answers with the first, so the rest are dead code that looks live: "
        f"{ {f'{m} {p}': names for (m, p), names in dupes.items()} }")
