"""THE LIVE SWEEP'S READER — the liveness beat for members, the demand list for
the WORKER's prewarm ring.

🔴 WHY THIS FILE EXISTS AT ALL. W4b.1-4 built a continuous intraday sweep that
files an honest cycle receipt every tick, and then measured the thing that made
it unarmable: ``last_live_cycle`` had THREE references in ``api/``, **all of them
inside ``scan_evaluator.py``** (one a comment), and the only other mention of the
cycles table was its own DDL. The sweeper's own heartbeat was readable by nobody
who was not holding a shell on the pod, so the arming runbook's confirm step was
written against a surface nothing mounted. **This module is that surface.**

⭐ THE ANSWER IS THE AGE OF THE TOP ROW, AND IT IS SERVED, NOT IMPLIED. A healthy
read is inside one interval; a scheduler dead at the bell reads hundreds of
minutes stale. ``scan_store.live_beat`` computes it off the read path's ONE clock
seam and this module does no arithmetic of its own — two clocks would be two
answers, and the one the operator gets would depend on which side they curled.

⛔ NOTHING HERE FILTERS ``closed`` RECEIPTS OUT. Overnight EVERY top row says
``closed``; a reader that hid them would report a perfectly healthy pod as one
that had never swept, which is the same blindness a REFUTED earlier fix
(not recording ``closed`` at all) produced — refuted with byte-identical table
hashes, and it must not be reintroduced one layer up in the reader.

⛔ IMPORTS ``scan_store`` ONLY, NEVER THE EVALUATOR.
``tests/test_scan_evaluator_off_request_path.py`` walks every module under
``api/routers/`` and refuses the sweep's namespace there even unused; every value
this module serves is declared on the STORE for exactly that reason
(``live_max_age_s``, ``SCAN_JOIN_TF``, ``live_beat``).

⛔ EVERY ROUTE IS GATED AND THE GATE IS A NAMED DEPENDENCY. ``main.py`` includes
this router with NO router-level dependency, so a route that omits its own gate
is reachable by anybody — the same contract as ``scan_results.py``. The two gates
are different credentials for different callers: ``require_paid`` is a MEMBER
(the beat is product surface), ``require_push_secret`` is the WORKER (the demand
list carries member watchlist symbols and is not member-facing). Railed by
``tests/test_scan_live_sweep.py``, DERIVED off ``router.routes`` and off these two
function objects — never off a substring of the handler's source, which a comment
would satisfy.
"""
from __future__ import annotations

import hmac
import os
import sqlite3
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.screener import scan_store

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """WHETHER, per handler. The live sweep is paid surface like the saved scans
    it overlays; the wording differs from ``scan_results``' so "which surface
    refused me" stays answerable from the 402 alone."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Live scans require a paid plan")
    return user


def require_push_secret(request: Request) -> None:
    """The WORKER's credential — the ``PUSH_SECRET`` bearer, the same one
    ``/api/push`` and ``desk_zoom_webhook.sessions_status`` carry.

    ⛔ THE FAILURE DIRECTION IS CLOSED. An UNSET or BLANK ``PUSH_SECRET`` refuses
    everybody rather than making ``Authorization: Bearer `` (empty) match — the
    same contract as ``DESK_TSDR_ANNOUNCE_SHOWS``, where blank announces nothing.

    ⚠️ ``compare_digest``, never ``==``: string equality returns on the first
    differing byte and leaks the prefix length by timing. Precedent:
    ``broker_sync.py`` L275, ``schwab_oauth_state.py`` L114.

    ⛔ AND IT COMPARES BYTES, NOT ``str``. ``hmac.compare_digest`` RAISES
    ``TypeError`` when either ``str`` carries a non-ASCII character — and an HTTP
    header is bytes on the wire that Starlette decodes latin-1, so a caller
    really can hand this a non-ASCII ``str``. The ``str`` form (which
    ``broker_sync.py`` still uses) answers **500** to that request: a refusal
    indistinguishable from an outage, on an unauthenticated path. Encoding both
    sides first makes 401 the answer for every input.
    """
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(
            auth.encode("utf-8"), f"Bearer {expected}".encode("utf-8")):
        raise HTTPException(status_code=401, detail="worker credential required")


@router.get("/api/scans/live-status")
def live_status(_user: dict = Depends(require_paid)):
    """Is the intraday sweeper alive, and how stale is its last beat?

    ⭐ THIS IS THE ARMING RUNBOOK'S CONFIRM STEP, and it is performable by anyone
    holding a paid session — no ``railway ssh``. Read ``age_s`` against
    ``max_age_s``: ``stale: false`` with a small ``age_s`` is a live sweeper;
    ``stale: true`` is at least two intervals missed; ``last_cycle: null`` with
    ``age_s: null`` is "nobody has ever swept", which is a THIRD answer and not a
    dressed-up zero.

    ⛔ NO ARITHMETIC HERE. ``scan_store.live_beat`` owns the clock and the bound.
    """
    return scan_store.live_beat(scan_store.SCAN_JOIN_TF)


def _auth_db_path() -> Optional[str]:
    """``auth.db``'s path, resolved LAZILY and never at import.

    ⚠️ A module-level capture would freeze the path before ``conftest.py``'s
    redirect and point a test at the owner's live ``C:\\data\\auth.db``. Seamed as
    its own function so a test can point it somewhere harmless.
    """
    from api.services.auth_db import get_db_path
    return get_db_path()


#: ⛔ LITERAL SQL, NOT AN f-STRING OVER A TABLE NAME. `bars_prewarm` L400-406
#: spells these two reads with `f"SELECT DISTINCT {col} FROM {tbl}"`; the values
#: are its own constants so it is safe, but a SQL string built from a NAME is a
#: shape this repo rails against elsewhere and there is no reason to plant a
#: second instance of it on a request path.
_MEMBER_LIST_SQL = (
    "SELECT DISTINCT sym FROM watchlist_items",
    "SELECT DISTINCT sym FROM ticker_tags",
)


def _member_list_symbols() -> list:
    """Every symbol a member has watchlisted or tagged — the union of
    ``watchlist_items.sym`` and ``ticker_tags.sym``, the two reads
    ``bars_prewarm`` (L400-406) makes on the WORKER.

    ⭐ THIS IS HOW MEMBER LISTS REACH THE PREWARM RING AT ALL. ``auth.db`` is
    web-local and EMPTY on the worker pod, so the ring cannot read these tables
    itself; it pulls them over this route with the worker credential.

    ⛔ NEVER RAISES. A missing or locked ``auth.db`` costs the ring its member
    lists for one pass — it still has the demand ring and cap universe — and must
    not cost the worker the whole demand answer.
    """
    out: set = set()
    try:
        with sqlite3.connect(_auth_db_path()) as db:
            for sql in _MEMBER_LIST_SQL:
                try:
                    out |= {str(s).upper() for (s,) in db.execute(sql) if s}
                except sqlite3.Error:
                    # one table absent (a fresh volume) is not the other's problem
                    continue
    except Exception:
        return []
    return sorted(out)


@router.get("/api/scans/demand")
def demand(_gate: None = Depends(require_push_secret)):
    """The symbols the intraday prewarm ring should reach FIRST.

    ``recent`` is the demand ring — symbols a member or a definition just NAMED,
    most recent first, per-process and persisted nowhere (losing it on a redeploy
    costs the ring one pass of cap-universe order). ``lists`` is the member
    watchlist/tag union. ``as_of`` stamps when the worker was told.
    """
    return {"recent": scan_store.demand_recent(),
            "lists": _member_list_symbols(),
            "as_of": time.time()}
