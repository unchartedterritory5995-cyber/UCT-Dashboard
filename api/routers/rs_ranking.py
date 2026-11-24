"""RS Ranking endpoints — IBD-style Relative Strength percentile rankings.

GET /api/rs-rankings       → full ranked list
GET /api/rs-rankings/{ticker} → single stock RS data

🔴 BOTH WERE ANONYMOUS (auth/paywall sweep, 2026-08-09). `/api/rs-rankings`
returns the 1-99 percentile ranking of the ENTIRE ~3,685-ticker cap universe —
a ~17s recompute the firm pays for and re-warms every 50 minutes so no member
ever waits on it. That whole table left in one unauthenticated GET.

`/{ticker}` is gated with it: it is a pure lookup into the same cached table, so
an open singular is the bulk route with extra steps.

⚡ THE LIST'S BYTES ARE MADE ONCE PER INPUT (speed pass 2, 2026-11-24). Live, each
request laid the nightly rating over ~5,000 rows (`unified_rankings`), filtered
the pending deals and serialized 577 KB again (1.5 s). `_body` keeps the finished
bytes for the exact inputs they were made from: the cached list OBJECT (a new
ranking is a new object), the rating table OBJECT and whether the rating switch is
on, and the pending-deal set. Any other input makes new bytes; the bound is
`_BODY_MAX` answers (each about the size of the list's JSON, ~0.6 MB). The list
stays whole: the RS badge, UCT 20 and the groups drill read all of it.

⚡ AND THEY ARE MADE BEFORE THE FIRST REQUEST (speed pass 3, 2026-11-24; live, the
first request after a while took 2.8 s). Whenever a source refreshes (a new ranking
cached, computed or seeded; the rating table changed: `rs_ranking.on_change`), ONE
background thread (`BODY_THREAD`) makes the bytes for the new inputs, and a boot
DATE job (`WARM_BOOT_DELAY_S`) makes them too (`warm_body`, a no-op when made). The
rating table is read without waiting on its re-read (`rs_ranking.ibd_latest_nowait`),
and a re-read that finds the same table keeps the same object, so the bytes stay
valid; a table that changed makes new bytes. The key rules above are unchanged: a
request never gets bytes made from another input (it waits for the one build, or
makes them).
"""

import threading
from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import rs_ranking as _rs
from api.services.rs_ranking import (cached_rankings, get_rs_for_ticker, kick_background_warm,
                                     snapshot_rankings, unified_rankings)

router = APIRouter()

#: The boot DATE job's offset (`api/main.py`): past the boot's busy minutes, on an offset no other boot job uses.
WARM_BOOT_DELAY_S = 660
BODY_THREAD = "rs-rankings-body"

#: The finished answers held (see the module docstring): the newest, and the one before it while a request built
#: from the older input may still be finishing.
_BODY_MAX = 2
_bodies: "OrderedDict[tuple, tuple]" = OrderedDict()   # key -> (list, rating table, bytes): holds its inputs alive
_bodies_lock = threading.Lock()
_build_lock = threading.Lock()                          # one answer made at a time; a second request waits for it
body_builds = 0                                         # answers made (tests)


def _body(data: list, deal_pending: frozenset) -> bytes:
    """The JSON bytes of the displayed list for exactly these inputs, made once. The key carries the input
    OBJECTS themselves (compared by identity, so an object can never be freed and its address reused while it is a
    key), the rating switch, and the pending-deal set by value."""
    on = _rs.rs_rank_ibd_enabled()
    table = _rs.ibd_latest_nowait() if on and data else None
    key = (id(data), id(table), on, deal_pending)
    hit = _held_body(key, data, table)
    if hit is not None:
        return hit
    with _build_lock:
        hit = _held_body(key, data, table)              # made by the request this one waited for
        if hit is not None:
            return hit
        return _make_body(key, data, table, deal_pending)


def _held_body(key: tuple, data: list, table) -> "bytes | None":
    with _bodies_lock:
        hit = _bodies.get(key)
        if hit is not None and hit[0] is data and hit[1] is table:
            _bodies.move_to_end(key)
            return hit[2]
    return None


def _make_body(key: tuple, data: list, table, deal_pending: frozenset) -> bytes:
    global body_builds
    # One RS rating everywhere (U5a): under RS_RANK_IBD_ENABLED the list carries
    # the nightly rating as `rs_rank` (the badge and the RS leaders panel read it
    # from here). A table read, not a compute; flag off, `data` is untouched.
    shown = unified_rankings(data, table=table)       # the very table the key names (speed pass 3)
    # A pending acquisition (DEAL_STATUS_ENABLED) is not shown as an RS leader. Removed
    # from the DISPLAYED list only: every other name keeps the percentile it was ranked
    # at. Flag off: the set is empty and the list is served untouched.
    if deal_pending:
        from api.services import deal_status
        shown = [r for r in shown if not deal_status.is_pending(r.get("ticker"), deal_pending)]
    body = JSONResponse(content=shown).body
    with _bodies_lock:
        body_builds += 1
        _bodies[key] = (data, table, body)
        _bodies.move_to_end(key)
        while len(_bodies) > _BODY_MAX:
            _bodies.popitem(last=False)
    return body


def reset_bodies() -> None:
    """Tests: forget the finished answers."""
    with _bodies_lock:
        _bodies.clear()


def warm_body() -> str:
    """Make the list's bytes for the inputs as they are now, on the calling (background) thread: the boot DATE job and
    the source listener (`_warm_body_bg`). A no-op while the ranking is cold (the route answers from the snapshot then)
    and when the bytes for these inputs are made already."""
    data = cached_rankings()
    if not data:
        return "cold"
    from api.services import deal_status
    made = body_builds
    _body(data, deal_status.consumer_pending())
    return "made" if body_builds > made else "warm"


_warm_lock = threading.Lock()
_warm_state = {"running": False, "again": False}


def _warm_body_run() -> None:
    try:
        while True:
            try:
                warm_body()
            except Exception:  # noqa: BLE001 -- the next request makes the bytes, as before
                import logging
                logging.getLogger(__name__).warning("[rs-rankings] the bytes could not be made ahead", exc_info=True)
            with _warm_lock:
                if not _warm_state["again"]:
                    _warm_state["running"] = False
                    return
                _warm_state["again"] = False
    except BaseException:
        with _warm_lock:
            _warm_state["running"] = False
        raise


def _warm_body_bg() -> None:
    """The source listener (`rs_ranking.on_change`): ONE background thread makes the bytes for the newest inputs; a
    change seen while it runs makes it go round once more. Returns at once."""
    with _warm_lock:
        if _warm_state["running"]:
            _warm_state["again"] = True
            return
        _warm_state["running"], _warm_state["again"] = True, False
    threading.Thread(target=_warm_body_run, name=BODY_THREAD, daemon=True).start()


_rs.on_change(_warm_body_bg)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the RS ranking surface.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="RS rankings require a paid plan")
    return user


@router.get("/api/rs-rankings")
def rs_rankings(_user: dict = Depends(require_paid)):
    """Return full RS-ranked stock list (1-99 percentile, best first).

    ⛔ CACHE ONLY. A cold cache answers 503 + Retry-After and starts ONE
    background rebuild; the ~17 s universe compute never runs in a request
    (it did, twice concurrently, on 2026-09-30 -- see `kick_background_warm`)."""
    try:
        data = cached_rankings()
        if not data:
            # Memory is cold (a fresh boot): rebuild in the background, and answer from the
            # last ranking on disk while it runs, if that one is recent enough.
            kick_background_warm()
            data = snapshot_rankings()
        if not data:
            return JSONResponse(status_code=503, headers={"Retry-After": "30"},
                                content={"status": "warming",
                                         "error": "RS rankings are being computed; retry shortly"})
        from api.services import deal_status
        return Response(content=_body(data, deal_status.consumer_pending()), media_type="application/json")
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": f"RS ranking unavailable: {e}"},
        )


@router.get("/api/rs-rankings/{ticker}")
def rs_ranking_single(ticker: str, _user: dict = Depends(require_paid)):
    """Return RS data for a single ticker."""
    try:
        data = get_rs_for_ticker(ticker)
        if data is None:
            return JSONResponse(
                status_code=404,
                content={"error": f"No RS data for {ticker.upper()}"},
            )
        return JSONResponse(content=data)
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": f"RS ranking unavailable: {e}"},
        )
