"""THE SURFACE E-2's ``join_clause`` REACHES (E4-A5, controller resolution 7).

E4-A5 RESOLVED BY WAVE 4: the scan join IS a ``query.run_scan`` filter branch
now (``{key:'scan'}``). The freshness objection this header used to record is
answered by disclosure — ``run_scan`` reports each joined hash's own ``as_of``
in ``scan_joins``, and the chip renders it, so the nightly-artifact and
live-snapshot stories stay distinguishable in one response. This route remains
the definition-DETAIL door (full receipt + hit list for a chosen session).

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
            # 🔴 "NOBODY LOOKED" MUST NOT ACQUIRE A LIVE BLOCK ON THE WAY OUT.
            # A cycle receipt beside an empty page reads as a swept quiet
            # market — the exact reading this branch exists to refuse.
            "hits": [],
            "live": None,
            "truncated": False,
        })

    tickers, truncated = _hit_tickers(def_hash, tf, as_of, limit)

    # ── PROVENANCE (W4b.5). The nightly page, plus the live-only tail. ──────
    #
    # ⭐ THE OVERLAY IS THE STORE'S ANSWER, NOT A SECOND JOIN. `hits_for` decides
    # which live rows are FRESH (same ET session, younger than `live_max_age_s`)
    # and hands back `tier`/`in_nightly` per symbol; restating that rule here
    # would be a second authority on "is this row live", and the two would
    # disagree the first moment the dead-sweeper window moved.
    #
    # ⚠️ NO N+1 ON THIS SURFACE. `hits_for`'s own docstring warns that rendering N
    # definitions per page would fetch the definition-INDEPENDENT last cycle N
    # times; this route answers for ONE `def_hash` per request, so the four short
    # reads happen once. A future multi-definition page is where that
    # consolidation gets earned.
    overlay = scan_store.hits_for(def_hash, tf, as_of)
    by_symbol = {r["symbol"]: r for r in overlay["rows"]}
    page = [by_symbol.get(t) or {"symbol": t, "tier": scan_store.LIVE_TIERS[0],
                                 "in_nightly": True, "live_as_of": None, "value": None,
                                 "src_price": None, "live_cols": 0}
            for t in tickers]
    # ⛔ THE LIVE-ONLY TAIL PASSES THE SAME JOIN THE NIGHTLY PAGE PASSES. A
    # symbol the nightly build dropped out of `screener_rows` is one a member
    # cannot act on, and a live hit is no exception — `_hit_tickers` refuses
    # exactly this for the nightly half.
    #
    # ⭐ AND IT IS RENDERED (X43, W9l.1). These rows reach the browser under
    # `hits` with `in_nightly: false`, and
    # `app/src/components/screener/ScanResults.jsx` draws them as their OWN block
    # under a line that says they were found by the live sweep and not by the
    # nightly scan — the "live vs nightly per hit" half of A6.
    #
    # ⛔ THAT SENTENCE USED TO BE FALSE. The surface iterated `tickers`, which is
    # the NIGHTLY half (see `kept` below), so this tail was built, capped and
    # discarded on every request. It is invisible today only because
    # `SCAN_LIVE_SWEEP_ENABLED` is unset and `scan_hits_live` is therefore empty:
    # the env flip would have filled the tail and changed NOTHING a member could
    # see. `tests/test_scan_results_route.py` now plants a live row and asserts
    # the tail arrives, so a future edit that drops it fails here rather than
    # on the day someone sets the variable.
    live_only = [r for r in overlay["rows"] if not r["in_nightly"]]
    present = snapshot_db.symbols_in_snapshot([r["symbol"] for r in live_only])
    extra = [r for r in live_only if r["symbol"] in present]
    # …and it is bounded by the SAME page limit, so the overlay cannot make a
    # capped page arbitrarily long.
    #
    # ⭐ SO THE PAGE CAN REACH `2 * limit` ROWS — `limit` nightly plus `limit`
    # live-only — AND THAT IS THE POINT, not an oversight (X87 asked; this is the
    # answer). One shared budget would let a FULL nightly page crowd out every
    # live-only hit, which is the exact thing this tail exists to prevent: the two
    # lists answer different questions (that session's closed bar vs this tick's
    # forming bar) and a member who cannot see the second is back to the state
    # where arming the live sweep looks like a no-op. The ENTITLEMENT cap is a
    # different number and is still applied ONCE over the whole page below, so no
    # member gets a doubled symbol ceiling. ⛔ AND A CUT TAIL SETS `truncated`: a page
    # that silently loses symbols returns fewer hits and reads as a quiet
    # market, which is the exact lie `CoverageLine` exists to refuse. `hits` IS
    # the page, so "the page is short of the hits" is literally true here and
    # keeps its own word — `withheld` still means "your plan stops here".
    page += extra[:limit]
    # ⛔⛔ EACH LIST CARRIES ITS OWN CUT (X87). `truncated` was ONE boolean over
    # TWO independent cuts — the nightly page hitting `limit`, and this live-only
    # tail hitting it — so the member was told "a row cap cut this page" and
    # could not tell WHICH list lost rows. They are different facts with
    # different fixes: a cut nightly list means page for more of that session's
    # closed-bar hits; a cut live tail means this tick's forming bar found more
    # than the page will carry.
    #
    # ⚠️ `truncated` STAYS, AND STAYS THE OR. It is the page's own word — "this
    # page is short of the hits" — which is true whenever either half was cut,
    # and `ScanResults.jsx` plus a browser holding the previous bundle both read
    # it. The two new keys are ADDED BESIDE it, never folded into it.
    truncated_live = len(extra) > limit
    truncated_nightly = bool(truncated)
    truncated = truncated_nightly or truncated_live

    # 🔴 THE ENTITLEMENT, APPLIED ONCE OVER THE WHOLE PAGE — not merely looked
    # up, and not once PER SLICE. A cap that is computed and never applied is the
    # shape of all eight features that shipped green and unreachable this week,
    # and it is the one thing the downgrade test can see.
    #
    # ⛔ AND CAPPING THE TWO HALVES SEPARATELY WOULD HAND A CAPPED MEMBER UP TO
    # `2 * max_symbols` SYMBOLS. The shipped toolkit is `max_symbols=None`, so
    # that defect would be INVISIBLE until the day a second toolkit is sold —
    # which is precisely when a doubled ceiling is a billing fact. One list, one
    # cap. The nightly half leads, so the cap trims the LIVE-ONLY TAIL first and
    # a live-only symbol can never displace a nightly hit.
    kept_syms, withheld = entitlements.apply_symbol_cap([r["symbol"] for r in page], limits)
    kept_set = set(kept_syms)
    page = [r for r in page if r["symbol"] in kept_set]
    # ⛔ `tickers` IS UNCHANGED FOR W5a's CURRENT READER — the same nightly page,
    # in the same order, DERIVED from the capped page rather than capped a second
    # time. `ScanResults.jsx` reads this key and nothing about it moved.
    kept = [r["symbol"] for r in page if r["in_nightly"]]
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
        # ⛔ ADDED BESIDE `tickers`, NEVER FOLDED INTO IT — AND READ. W9l.1 wired
        # `ScanResults.jsx` to this key for the live-only half; a consumer census
        # that finds no reader for it again is a defect, not a spare field.
        # `hits` is that same
        # page carrying WHERE EACH ROW CAME FROM — `tier: nightly|live`,
        # `in_nightly`, `live_as_of` (the TICK), plus the forming-bar `value`,
        # `src_price` and how many live columns answered. A live-only hit is
        # APPENDED with `in_nightly: false` rather than dropped or promoted: the
        # two sets answer DIFFERENT questions (this tick's forming bar vs. that
        # session's closed bar) and the member is told which one they are reading.
        "hits": page,
        # ⭐ AND THE SWEEPER'S OWN RECEIPT, WHOLE. `definition_swept` says whether
        # THIS formula was reached last cycle; `fresh_rows` how many of its live
        # rows survived the freshness gate. `null` means no cycle has ever run —
        # not "the cycle found nothing". The BEAT (how stale that receipt is) has
        # its own door: `GET /api/scans/live-status`.
        "live": overlay["live"],
        # ⚠️ ``truncated`` STILL MEANS "THE PAGE IS SHORT OF THE HITS", which is a
        # different fact from "your plan stops here" and keeps its own word. A cap
        # that set this would tell a member to page for rows they can never have.
        "truncated": truncated,
        # ⭐ WHICH LIST LOST ROWS (X87). The OR above cannot answer that, and the
        # two answers send a member to different places. A consumer that reads
        # only ``truncated`` keeps working; one that wants to name the list has
        # these.
        "truncated_nightly": truncated_nightly,
        "truncated_live": truncated_live,
    })
