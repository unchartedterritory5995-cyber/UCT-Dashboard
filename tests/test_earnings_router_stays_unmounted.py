"""⛔ `api/earnings_router.py` MUST NOT BE MOUNTED — and this file is what makes
that a decision rather than an oversight.

THE ASK, AND WHY THE ANSWER IS NO
---------------------------------
The module's own docstring instructs the reader to wire it up:

    Mount in main.py: app.include_router(earnings_router, prefix="/api/schwab")

The reachability audit surfaced it as built-but-unmounted (§3d). It is neither.
It is SUPERSEDED, and following its instruction would create a **second
authority over earnings data** at one address:

  * `api/schwab_router.py` declares `APIRouter(prefix="/api/schwab")` and
    `@router.post("/earnings")`, and `api/main.py` includes it — so
    `POST /api/schwab/earnings` is SERVED, backed by Yahoo `quoteSummary`
    (`_fetch_earnings_yf`).
  * `api/earnings_router.py` declares `@earnings_router.post("/earnings")` and
    asks to be mounted under the SAME `/api/schwab` prefix — the identical
    `(POST, /api/schwab/earnings)`. Its implementation scrapes Finviz quote
    pages with three fallback regexes.

FastAPI resolves duplicate registrations by FIRST MATCH. Mounting it would
therefore not "add" anything: one of the two implementations would silently
never run, and which one would depend on include order in a 4,900-line file.
Two different providers answering — or appearing to answer — the same address is
the shape this repo names `A SECOND AUTHORITY OVER ONE VALUE`, its most repeated
defect.

⭐ THE HONEST OUTCOME IS "SUPERSEDED, LEFT UNMOUNTED, RECORDED", which is what
this file records and rails. Deleting it is an owner call (it is a rollback copy
of a Finviz-based predecessor, the same idiom `api/routers/trades.py` is kept
under); making it unmountable-by-accident is not.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
EARNINGS_PATH = "/api/schwab/earnings"


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


def test_the_finviz_predecessor_is_not_mounted(real_app):
    """Derived from the module object, never from a path string: whatever route
    `earnings_router` declares, its handler is defined in that module."""
    import api.earnings_router as legacy

    mounted = [f"{m} {p}" for (m, p), names in _registrations(real_app).items()
               for n in names if n.startswith(legacy.__name__)]
    assert mounted == [], (
        f"api/earnings_router.py is mounted at {mounted}. Its own docstring asks "
        f"for `prefix='/api/schwab'`, which collides exactly with the served "
        f"schwab_router route — a second authority over earnings data. If it was "
        f"mounted DELIBERATELY, the superseded handler it shadows must be "
        f"removed in the same change, and this test deleted with it.")


def test_the_collision_is_real_and_not_a_stale_claim():
    """⛔ NON-VACUITY. The test above passes just as happily if the two modules
    no longer overlap at all — at which point its reasoning would be folklore.
    Measured from the routers themselves.
    """
    import api.earnings_router as legacy
    from api.schwab_router import router as live

    live_paths = {(m, r.path) for r in live.routes
                  for m in (getattr(r, "methods", None) or set()) if m in MUTATING}
    assert ("POST", EARNINGS_PATH) in live_paths, (
        f"schwab_router no longer declares POST {EARNINGS_PATH}; the supersession "
        f"recorded here has expired and must be revisited, not worked around")

    # The predecessor's own declared paths, plus the prefix its docstring asks for.
    asked_prefix = "/api/schwab"
    assert asked_prefix in (legacy.__doc__ or ""), (
        "earnings_router's docstring no longer names the prefix it wants; the "
        "collision this file reasons about may have moved")
    legacy_paths = {(m, asked_prefix + r.path) for r in legacy.earnings_router.routes
                    for m in (getattr(r, "methods", None) or set()) if m in MUTATING}
    assert legacy_paths & live_paths, (
        f"the two routers no longer collide ({legacy_paths} vs {live_paths}) — "
        f"the 'do not mount' reasoning here is stale")


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
