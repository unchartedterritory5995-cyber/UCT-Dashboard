"""`POST /api/scans/run` — RUN A SAVED SCAN NOW on a list the member names, and
`GET /api/scans/run/{job}` — the answer, when it is ready.

  POST body {def_id, symbols?: [..] | list_id?: 'wl:<id>'|'flagged'|'tag:<colour>',
             tf?: 'D'|'W'|'M', as_of?: 'YYYYMMDD'|'YYYY-MM-DD'}
  202  {job, state, tier:'on-demand', def_id, tf, as_of, universe:{…}}
  400  "[gate:universe] …"  over the cap / not your list / a complement / empty /
       both at once, or a spelling problem (tf label, as_of, def_id) in the
       store's own words
  402  "On-demand scans require a paid plan"
  404  "Not found"          not the caller's definition — the answer
                            `/api/user-definitions/{id}` gives, never a 403
  409  "[gate:not-scannable] …"  the request was well-formed and the DEFINITION
                            said no; any future sweep gate refused at submit
                            lands here too (`_status_for` defaults to 409)
  422  the body itself is out of bounds (`RunIn`) — refused before the service
  429  "[gate:busy] …"      one run at a time per member, and a bounded queue per
                            pod; or the per-member window, with `Retry-After`

  GET  /api/scans/run/{job}
  200  the job: `queued` (with `position`) / `running` / `done` (`def_hash`,
       `hits`, `coverage`) / `refused` (`gate`, `detail`, and `error: true` for
       a crash or a timeout, which are NOT gates)
  404  "Not found"          expired, evicted, never existed, or somebody else's

⭐ IT IS A JOB, NOT A SYNCHRONOUS CALL, AND THAT IS THE WHOLE DESIGN. A repo rail
forbids any ROUTER importing `scan_evaluator`, and E-A2/A3 keep evaluation off
the request path — a 500-symbol run is 0.7–5.7 s of GIL-bound compute on this
pod's single event loop and its 64 shared anyio threads (the 2026-07-01 outage
class). So the submit VALIDATES and REFUSES synchronously (a row read, a list
read, pure spelling checks) and hands back a job id; the compute happens on
`api/services/screener/scan_run.py`'s one pool thread. Contract ruling 8/25.

⛔ CONSEQUENCE, STATED SO NOBODY "FIXES" IT: a gate the SWEEP raises — the
`snapshot-stale` a member is most likely to meet — cannot be an HTTP status here.
It is refused after the submit already answered, so it lands on the JOB and is
read off the poll with its gate word intact. Turning it into a synchronous 409
would mean evaluating on the request path, which is the one thing this shape
exists to prevent. `tests/test_scan_run.py` pins both halves.

⛔ THIS MODULE NEVER IMPORTS `scan_evaluator`. The sweep has no business in a
router's namespace (`test_the_evaluator_module_is_not_imported_by_any_ROUTER_at_
all`); the ONE bounded caller is `api/services/screener/scan_run.py::_run_job`,
named as such in `tests/test_scan_evaluator_off_request_path.py`.

⛔ `require_paid` IS DECLARED PER HANDLER with its OWN sentence — the shape every
router in this repo uses (`api/routers/signature.py`), and the one
`tests/test_user_definitions_auth.py` walks `api/routers/` by AST to enforce.
`main.py` mounts this router with no router-level dependency, so a route that
omitted its own gate would be reachable by anybody — which is why the POLL
carries it too: a gated submit beside an open read would hand every hit list on
this pod to whoever guessed a job id.

⭐ TWO DEPENDENCIES, TWO ANSWERS, AND EACH ONLY WHERE IT IS USED. `require_paid`
decides WHETHER (402), on both routes. `entitlements.limits_dependency` decides
HOW MUCH — the toolkit's symbol cap, applied INSIDE the evaluator and reported
under `coverage.withheld`, beside the four outcomes and never inside them — and
it rides the SUBMIT alone, because the submit is what hands the toolkit to the
run. On the poll it would be a gate that cannot fail: the slice already happened
when the job ran, and re-reading the caller's plan at read time would be a second
authority over one number.

⭐ THE RATE LIMIT IS PER MEMBER, so it is `_charge_propose`'s shape
(`api/routers/user_definitions.py`) and not `api/limiter.py`'s slowapi decorator,
which keys on the client IP and would give every member behind one office NAT a
shared bucket. Charged BEFORE the work and on the SUBMIT ONLY: a refused run
costs this pod the same request, and a budget charged on the POLL would spend a
member's whole minute on the handful of reads it takes to watch one job finish.

⚠️ PER-PROCESS STATE, like `_charge_propose` and the service's job table: exact
on the single web pod, per-instance the day web scales out.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import ORJSONResponse as JSONResponse
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.entitlements import Limits, limits_dependency
from api.services.screener import scan_run

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="On-demand scans require a paid plan")
    return user


#: The longest string this door will accept as a symbol. See `RunIn`.
MAX_SYMBOL_CHARS = 32


class RunIn(BaseModel):
    """The request, bounded at the door.

    ⛔ THE ARRAY CEILING IS THE SERVICE'S OWN `HARD_SYMBOL_BOUND`, never a second
    number. That constant is already the answer to "how many names will this door
    read at all" (10x the run cap, so a duplicate-heavy paste is fine); a ceiling
    BELOW it would make the service's guard unreachable — a gate that cannot fail
    — and one ABOVE it would admit a body the service has already said it will not
    walk. The member-facing cap (`MAX_RUN_SYMBOLS`) is applied AFTER de-duplication
    inside the service, so its refusal can name the count that was really too big.

    ⛔ AND EACH ENTRY IS BOUNDED TOO, or the array ceiling bounds nothing: five
    thousand strings of unbounded length is an unbounded body, and every other
    string on this model already carries a length. `MAX_SYMBOL_CHARS` is NOT a
    validation of tickers — a typo is answered honestly as `no-bars` and always
    should be; it is a bound on the BODY, set where no spelling of a symbol
    reaches it (the longest exchange-qualified form is about half of it).
    """

    def_id: str = Field(..., min_length=1, max_length=64)
    symbols: Optional[list[Annotated[str, Field(max_length=MAX_SYMBOL_CHARS)]]] = Field(
        default=None, max_length=scan_run.HARD_SYMBOL_BOUND)
    list_id: Optional[str] = Field(default=None, max_length=128)
    tf: str = Field(default="D", min_length=1, max_length=8)
    as_of: Optional[str] = Field(default=None, min_length=4, max_length=32)


# ── the per-member window ────────────────────────────────────────────────────
#
# 🔴 WHAT IT BOUNDS. `require_paid` is a one-time yes/no; the single-flight rail
# in the service already stops a member holding two runs at once. Neither stops a
# paid session in a loop submitting, cancelling by walking away, and submitting
# again — each one a queue slot and a share of the one worker other members are
# waiting behind. Same shape as `/propose`: right auth class, missing bound.
RUN_MAX_PER_MINUTE = int(os.environ.get("SCAN_RUN_MAX_PER_MINUTE", "6"))
_RUN_WINDOW_SECONDS = 60
_run_calls: dict[str, list[float]] = {}
_run_lock = threading.Lock()


def _charge_run(user_id: str, *, now: float | None = None) -> None:
    """Record one submit for `user_id`, or raise 429 if the window is full.

    ⛔ THE CHARGE HAPPENS BEFORE ANYTHING IS READ, not after a run succeeds.
    Billing on success would let a caller loop 404s and 400s for free, and a
    refused submit costs this pod the same request.
    """
    now = time.time() if now is None else now
    cutoff = now - _RUN_WINDOW_SECONDS
    with _run_lock:
        recent = [t for t in _run_calls.get(user_id, ()) if t > cutoff]
        if len(recent) >= RUN_MAX_PER_MINUTE:
            retry_after = max(1, int(recent[0] + _RUN_WINDOW_SECONDS - now))
            _run_calls[user_id] = recent
            raise HTTPException(
                status_code=429,
                detail=f"At most {RUN_MAX_PER_MINUTE} on-demand runs per minute. "
                       f"Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        recent.append(now)
        _run_calls[user_id] = recent
        # Bound the dict itself: a key per member is fine, a key per member
        # FOREVER is a leak. Drop anyone whose window has fully aged out.
        if len(_run_calls) > 5000:
            for uid in [u for u, ts in _run_calls.items()
                        if not ts or ts[-1] <= cutoff]:
                _run_calls.pop(uid, None)


#: The HTTP status per gate, for the gates that are NOT 409.
_STATUS_BY_GATE = {scan_run.UNIVERSE_GATE: 400, scan_run.BUSY_GATE: 429}


def _status_for(gate: str) -> int:
    """⛔ A LOOKUP WITH A DEFAULT, NEVER AN EXHAUSTIVE TABLE. `RUN_GATES` is
    derived from the sweep's own set, so it grows when the sweep does; a table
    that had to list every member would raise a KeyError on the first new one and
    turn a named refusal into a 500. Anything the SWEEP refuses is a 409 — the
    request was well-formed and the STATE (a stale snapshot, an unscannable tree)
    is what said no — so 409 is the right default rather than a fallback.
    """
    return _STATUS_BY_GATE.get(gate, 409)


@router.post("/api/scans/run", status_code=202)
def submit_scan_run(body: RunIn,
                    user: dict = Depends(require_paid),
                    limits: Limits = Depends(limits_dependency)):
    """Queue one on-demand run and hand back its job. NEVER computes."""
    _charge_run(str(user["id"]))
    try:
        job_id = scan_run.submit_run(
            user["id"], body.def_id,
            symbols=body.symbols, list_id=body.list_id,
            tf=body.tf, as_of=body.as_of, limits=limits)
    except scan_run.DefinitionNotFound as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc
    except scan_run.RunRefused as exc:
        raise HTTPException(status_code=_status_for(exc.gate),
                            detail=str(exc)) from exc
    except scan_run.BadRequest as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # ⭐ THE FULL STATUS, NOT A BARE ID. The contract fixes `202 {job}`; this is
    # that plus the shape the poll returns, so the client renders the queued state
    # from the submit's own answer instead of racing a first poll to find out
    # what it was handed. `JobNotFound` cannot happen here — only TERMINAL jobs
    # are ever evicted and the TTL is minutes — so it is deliberately not caught:
    # if it ever did, that is a crash, and a crash should read as one.
    return JSONResponse(status_code=202,
                        content=scan_run.job_status(job_id, user["id"]))


@router.get("/api/scans/run/{job}")
def read_scan_run(job: str, user: dict = Depends(require_paid)):
    """One job's state — the caller's own, or 404.

    ⛔ 404, NOT 403, FOR SOMEBODY ELSE'S JOB. The service answers not-there and
    not-yours identically on purpose (`JobNotFound`), the same way
    `/api/user-definitions/{id}` does: a 403 would confirm that the id exists.

    ⛔ AND A CRASHED OR TIMED-OUT JOB IS STILL A 200. The READ succeeded; the RUN
    failed, and the job says so (`state: 'refused'`, `gate: null`, `error: true`).
    A 500 here would make a job with a terminal answer indistinguishable from a
    broken route, and the client would poll it forever.
    """
    try:
        return JSONResponse(content=scan_run.job_status(job, user["id"]))
    except scan_run.JobNotFound as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc
