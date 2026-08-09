"""THE SURFACE E-2's ``join_clause`` REACHES (E4-A5, controller resolution 7).

E-2 shipped ``scan_store.join_clause`` as ``(sql_fragment, params)`` and no
wiring, and named the three candidates: a ``filters.FILTERS`` entry, a new filter
TYPE inside ``query.run_scan``, or its own endpoint. E-4 takes the third, and the
reasons are recorded here rather than in a plan nobody re-reads:

  * ``filters.FILTERS`` entries are COLUMN-SHAPED — ``column_for`` maps a filter
    name to a ``screener_rows`` column and ``is_valid_op`` gates the operator. A
    ``def_hash`` is not a column and a scan membership is not an operator, so it
    would have to arrive as a special case inside a table whose whole safety
    property is that it has none.
  * a new filter TYPE in ``query.run_scan`` composes with the existing eight
    indexes and would be the cheapest place to put it — but it makes the scan
    lane and the screener lane ONE request path, and the two have different
    freshness stories (a scan receipt is a NIGHTLY artifact with its own
    ``as_of``; a screener query answers off whatever the snapshot holds now).
    Blending them means a member cannot tell which answer they are reading.
  * its own endpoint is the clearest boundary and the honest one: the answer to
    "which symbols did MY formula hit" is a set of symbols plus the RECEIPT that
    says how much of the universe was actually looked at. That receipt has no
    home in ``filters``.

⛔ NO SQL IS BUILT FROM A CLIENT STRING. The ``def_hash`` a caller supplies leaves
this module only as a BOUND PARAMETER, inside the fragment ``scan_store`` returns
— never as text. ``filters.column_for`` / ``filters.is_valid_op`` gate every
existing screener query for exactly that reason, and
``tests/test_scan_results_route.py`` carries an AST rail asserting this module
contains no f-string, ``%`` or ``+`` string-building anywhere near ``execute``.

⛔ THE PROJECTION IS ``ticker`` AND NOTHING ELSE, ON PURPOSE. A scan's answer is a
SET OF SYMBOLS; how a screener ROW is rendered is ``query.run_scan``'s decision
and its column vocabulary. Restating a projection here would be a second one, and
the two would disagree the first time a column moved — this repo's most-repeated
defect, and the reason ``_CASE_COLUMNS`` exists at all.

🔴 AND ``coverage is None`` IS ANSWERED AS "NOBODY LOOKED", NEVER AS ZERO. E6-A2:
a pruned or never-swept window must not be presented as a quiet market. The
payload says ``status: "not-run"`` and carries ``coverage: null`` so
``CoverageLine`` renders nothing at all rather than a receipt of zeroes.

⛔ EVERY ROUTE HERE IS PAID, AND ``require_paid`` IS DECLARED PER HANDLER —
``main.py`` calls ``include_router`` with no router-level dependency, so a route
that omits its own gate is reachable by anybody. The shape is copied from
``api/routers/scans.py``, and ``tests/test_scan_results_route.py`` derives the
(method, path) set from ``router.routes`` rather than listing it.

────────────────────────────────────────────────────────────────────────────────
🔴 AND IT CARRIES THE CALLER'S TOOLKIT BESIDE THAT GATE (E-7). ``require_paid``
decides WHETHER; ``limits_dependency`` decides HOW MUCH. Two dependencies, two
answers, one 402 that still means one thing.

⭐ WHY THE PER-MEMBER SYMBOL CAP IS APPLIED **HERE** AND NOT IN THE SWEEP, WHICH
LOOKS LIKE E7-A1's "at display" AND IS NOT.

The sweep is DELIBERATELY MEMBER-INDEPENDENT: ``run_sweep`` dedupes by
``def_hash`` so two members who typed the same formula cost the pod ONE
evaluation, and ``scan_hits`` has no member column by design (E-2). **There is no
member at sweep time**, so a per-member cap cannot be applied there — and
``record_coverage`` correctly stores no ``withheld`` for the shared receipt,
because a shared sweep withholds from nobody.

What E7-A1 forbids is a UI that RECEIVES every row and hides some. This is the
opposite: the slice happens SERVER-SIDE, the browser is handed the shorter list,
the payload SAYS SO under ``withheld``, and a client cannot ask for the rest. The
assertion is on the payload for exactly that reason.

⛔ ``withheld`` IS ADDED BESIDE THE FOUR, NEVER INTO THEM. ``evaluated`` describes
what the SWEEP looked at — the whole universe, for everybody. Folding a read-time
cap into it would claim the pod did less work than it did, and the closed identity
``evaluated == answered + dropped + not_computable`` would stop closing.
"""
from __future__ import annotations

import contextlib
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import ORJSONResponse as JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import entitlements
from api.services.entitlements import Limits, limits_dependency
from api.services.screener import scan_store, snapshot_db

router = APIRouter()

#: A scan over a 3,742-symbol universe can hit thousands of names. The cap is on
#: the ROWS RETURNED, never on the counts — ``coverage`` is the authority on how
#: many there were, and ``truncated`` says whether this page is the whole answer.
MAX_ROWS = 500


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Saved scans require a paid plan")
    return user


def _hit_tickers(def_hash: str, tf: Any, as_of: Any, limit: int) -> tuple:
    """``(tickers, truncated)`` for the ``screener_rows`` this scan hit.

    ⛔ THE FRAGMENT AND ITS PARAMS COME BACK TOGETHER AND ARE USED TOGETHER. The
    only text this function concatenates is its own literals; every value the
    caller supplied travels in ``params``.
    """
    fragment, params = scan_store.join_clause(def_hash, tf, as_of)
    sql = (
        "SELECT ticker FROM screener_rows WHERE "
        + fragment
        + " ORDER BY ticker LIMIT ?"
    )
    with contextlib.closing(snapshot_db.connect()) as conn:
        rows = conn.execute(sql, (*params, limit + 1)).fetchall()
    tickers = [r[0] for r in rows]
    if len(tickers) > limit:
        return tickers[:limit], True
    return tickers, False


@router.get("/api/scans/definition-results")
def definition_results(
    def_hash: str = Query(..., min_length=1, max_length=128),
    tf: str = Query("D", min_length=1, max_length=8),
    as_of: str = Query(..., min_length=4, max_length=32),
    limit: int = Query(200, ge=1, le=MAX_ROWS),
    _user: dict = Depends(require_paid),
    limits: Limits = Depends(limits_dependency),
):
    """The symbols one saved formula hit on one session, WITH its coverage receipt.

    ``as_of`` is a session — ``20260807``, ``"2026-08-07"`` and
    ``"2026-08-07T00:00:00Z"`` all collapse to one key at ``scan_store``'s door,
    which is the whole reason that collapse lives there and not here.
    """
    try:
        receipt: Optional[dict] = scan_store.coverage(def_hash, tf, as_of)
    except (ValueError, TypeError) as exc:
        # A caller's spelling problem, named. ``_normalise_tf`` hands back the
        # code a product label should have been, and swallowing that would leave
        # a member with an empty screen and no way to tell why.
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if receipt is None:
        # 🔴 "NOBODY LOOKED" IS AN ANSWER, AND IT IS NOT "NO HITS". Returning
        # ``tickers: []`` with no receipt would present an unrun — or pruned —
        # window as a quiet market, which is exactly E6-A2's trap.
        return JSONResponse(content={
            "def_hash": def_hash,
            "tf": tf,
            "as_of": as_of,
            "status": "not-run",
            "coverage": None,
            "tickers": [],
            "truncated": False,
        })

    tickers, truncated = _hit_tickers(def_hash, tf, as_of, limit)

    # 🔴 THE ENTITLEMENT, APPLIED — not merely looked up. A cap that is computed
    # and never applied is the shape of all eight features that shipped green and
    # unreachable this week, and it is the one thing the downgrade test can see.
    kept, withheld = entitlements.apply_symbol_cap(tickers, limits)
    coverage = dict(receipt)
    if withheld:
        # BESIDE the four, and it ACCUMULATES onto whatever the sweep already
        # withheld rather than replacing it — one number for one member fact,
        # "symbols your plan did not get".
        coverage["withheld"] = int(coverage.get("withheld") or 0) + len(withheld)
        coverage["withheld_reason"] = entitlements.SYMBOLS_WITHHELD

    return JSONResponse(content={
        "def_hash": def_hash,
        "tf": tf,
        "as_of": receipt.get("as_of", as_of),
        "status": "evaluated",
        # ⛔ THE RECEIPT, WHOLE. Four outcomes plus the enumeration, forwarded
        # verbatim — a surface that dropped ``not_computable`` on the way to the
        # browser would make a capped-history universe read as a failing screen
        # (controller resolution 5). ``withheld`` is ADDED beside them; nothing
        # the sweep reported is rewritten.
        "coverage": coverage,
        "tickers": kept,
        # ⚠️ ``truncated`` STILL MEANS "THE PAGE IS SHORT OF THE HITS", which is a
        # different fact from "your plan stops here" and keeps its own word. A cap
        # that set this would tell a member to page for rows they can never have.
        "truncated": truncated,
    })
