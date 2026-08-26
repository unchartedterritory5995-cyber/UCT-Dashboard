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

import contextlib
import hmac
import os
import sqlite3
import time

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

    ⚠️ TIMEFRAME IS ``scan_store.SCAN_JOIN_TF`` AND TAKES NO QUERY PARAMETER, on
    purpose: the Wave-1 sweep REFUSES any ``tf`` but ``D`` by name, so a ``tf``
    argument here would be a knob whose only other setting is an error. When the
    sweep gains a second timeframe this grows a parameter and the beat becomes
    per-``tf`` — the store's ``live_beat(tf)`` already takes one.
    """
    return scan_store.live_beat(scan_store.SCAN_JOIN_TF)


def _auth_db_path() -> str:
    """``auth.db``'s path, read off ``auth_db``'s OWN declaration.

    🔴 THIS SHIPPED BROKEN AND THE BUG IS WORTH THE PARAGRAPH. W4b.5 wrote
    ``from api.services.auth_db import get_db_path`` — copied from the brief and
    from ``bars_prewarm.py`` L400 — and **that function does not exist**. The
    import raised ``ImportError``, the broad ``except`` in the caller swallowed
    it, and ``lists`` was PERMANENTLY ``[]``: the ring would have fallen back to
    cap-universe order forever with every test green. A grep found the name in a
    sibling and nobody asked the module whether it exported it.
    ⚠️ ``api/services/bars_prewarm.py`` L400 STILL CARRIES THE SAME DEAD IMPORT,
    inside its own bare ``except`` — that file is not this lane's to edit, and
    the worker's member-list read has been dead for as long as it has been there.

    ``_DB_PATH`` is ``auth_db``'s single authority on this (it reads
    ``AUTH_DB_PATH`` once at import, which is that module's choice, not ours);
    reading it by attribute means a rename raises here — loudly, and
    ``tests/test_scan_live_sweep.py`` drives this function to prove it returns a
    real path rather than being caught.
    """
    from api.services import auth_db
    return auth_db._DB_PATH


#: ⛔ LITERAL SQL, NOT AN f-STRING OVER A TABLE NAME. `bars_prewarm` L400-406
#: spells these two reads with `f"SELECT DISTINCT {col} FROM {tbl}"`; the values
#: are its own constants so it is safe, but a SQL string built from a NAME is a
#: shape this repo rails against elsewhere and there is no reason to plant a
#: second instance of it on a request path.
_MEMBER_LIST_SQL = (
    "SELECT DISTINCT sym FROM watchlist_items",
    "SELECT DISTINCT sym FROM ticker_tags",
)


def _member_list_symbols() -> tuple:
    """``(symbols, ok)`` — every symbol a member has watchlisted or tagged, and
    WHETHER THE READ ACTUALLY HAPPENED.

    The union of ``watchlist_items.sym`` and ``ticker_tags.sym``. ⭐ This is how
    member lists reach the prewarm ring at all: ``auth.db`` is web-local and
    EMPTY on the worker pod, so the ring cannot read these tables itself and
    pulls them over this route with the worker credential.

    ⛔ IT STILL NEVER RAISES — a missing or locked ``auth.db`` must cost the ring
    its member lists for one pass, not the whole demand answer — ⛔ BUT IT NO
    LONGER LIES ABOUT IT. "No member has a watchlist" and "I could not read the
    watchlists" are different facts and the ring orders its entire pass on the
    difference; returning ``[]`` for both is exactly what let the ``get_db_path``
    bug above hide, because a broken wire and a quiet Sunday looked identical on
    the wire. ``ok`` is ``False`` if anything went wrong, and the route publishes
    it as ``lists_ok``.

    ⚠️ ``contextlib.closing``, not a bare ``with`` on the connection: sqlite3's
    ``__exit__`` COMMITS the transaction, it does not CLOSE the handle. The repo
    idiom is ``closing`` (``snapshot_db``, ``tweet_store``) and on a read path
    that runs once per ring pass a leaked handle is a real file descriptor.
    """
    out: set = set()
    ok = True
    try:
        with contextlib.closing(sqlite3.connect(_auth_db_path())) as db:
            for sql in _MEMBER_LIST_SQL:
                try:
                    out |= {str(s).upper() for (s,) in db.execute(sql) if s}
                except sqlite3.Error:
                    # one table absent (a fresh volume) is not the other's
                    # problem — but it IS a fact the caller is told about.
                    ok = False
    except Exception:
        return [], False
    return sorted(out), ok


@router.get("/api/scans/demand")
def demand(_gate: None = Depends(require_push_secret)):
    """The symbols the intraday prewarm ring should reach FIRST.

    ``recent`` is the demand ring — symbols a member or a definition just NAMED,
    most recent first, per-process and persisted nowhere (losing it on a redeploy
    costs the ring one pass of cap-universe order). ``lists`` is the member
    watchlist/tag union. ``as_of`` stamps when the worker was told.
    """
    lists, lists_ok = _member_list_symbols()
    return {"recent": scan_store.demand_recent(),
            "lists": lists,
            # ⛔ THE DISCLOSURE, BESIDE THE ANSWER. An empty `lists` with
            # `lists_ok: false` means "ask again"; with `true` it means "nobody
            # has a watchlist". The ring must not reorder a whole pass on a
            # number it cannot tell apart from a broken wire.
            "lists_ok": lists_ok,
            "as_of": time.time()}
