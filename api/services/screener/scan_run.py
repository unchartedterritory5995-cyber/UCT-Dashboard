"""ON-DEMAND SCAN — one definition over ≤ MAX_RUN_SYMBOLS symbols the member
named, computed through the sweep's own loop on a SINGLE-WORKER POOL, and
WRITTEN NOWHERE.

Spec 2026-08-25 §5.5 "On-demand run", lane W4a; contract ruling 8/25: run-now is
a JOB, not a synchronous call. `POST /api/scans/run` (`api/routers/scan_run.py`,
W4a.2) calls `submit_run` and answers `202 {job}`; `GET /api/scans/run/{job}`
calls `job_status`. Neither handler touches the evaluator: the ONLY call to
`scan_evaluator.evaluate_one` in this module is inside `_run_job`, the function
`_POOL` executes, and `tests/test_scan_run.py` asserts that by AST (W4a.3 amends
the off-request-path rail to name this one bounded path).

⭐ THE SWEEP'S LOOP, NOT A SECOND ONE. `scan_evaluator.evaluate_one` owns the
four-outcome arithmetic, the bars loader (`_read_bars` → `bars_sqlite.get_bars`,
local SQLite), the entitlement slice and the hash. A second per-symbol loop here
would be a second authority over "what did this screen answer", and the day the
two disagreed the member would be looking at it. `def_hash` therefore appears on
a job ONLY when the evaluator hands it back — `submit_run` runs
`assert_scannable` as a GATE and discards its dict.

⛔ OFF THE REQUEST PATH, BY CONSTRUCTION. A member request VALIDATES (a row read,
a list read, pure spelling checks) and REFUSES immediately; the compute — 11.3
ms/symbol contended, 1.4 ms idle on this box, so 0.7–5.7 s of GIL-bound work
for a 500-symbol run — happens on `_POOL`'s one thread, never inside a handler
holding one of the pod's 64 shared anyio threads (the 2026-07-01 outage class;
E-A2/A3). The pool's `max_workers=1` IS the "one run at a time per pod" rail
the brief named `_SINGLE_FLIGHT`; it is pinned by AST, not by convention.

⛔ BOUNDED, NEVER A UNIVERSE. Four bounds, each refusing BY NAME:
  * `MAX_RUN_SYMBOLS`, checked on what was SENT and again after
    list resolution — the walk itself is bounded too            → `gate:universe`
  * one run in flight (queued or running) per MEMBER             → `gate:busy`
  * `MAX_PENDING_RUNS` in flight per POD                         → `gate:busy`
  * `MAX_RUN_SECONDS` on a run's own duration, and
    `_max_queue_wait_seconds()` (DERIVED: the whole queue ahead
    of a job timing out at that cap) on the wait                 → self-healing
The job table itself is bounded (`MAX_JOBS`) and evicts the OLDEST FINISHED
job first — a queued or running job is never DELETED, so a member who was
handed a job id always gets an answer for it.

🔴 AND A WORKER THAT BLOCKS IS NOT A WORKER THAT RAISES. `_run_job`'s `finally`
covers a raise; nothing catches a HANG (a SQLite lock retry loop, a wedged bars
read). Without a duration cap the one worker never frees, the pending slots fill
and are never released, `MAX_PENDING_RUNS` refuses every later submit forever,
and each of those members stays locked out by the per-member gate — permanently,
because the TTL's clock starts at `finished_at` and a wedged job never has one.
So `_evict_locked` AGES a run past `MAX_RUN_SECONDS`, and a wait past
`_max_queue_wait_seconds()`, into a terminal `refused` + `error` state: the
member is freed, the queue slot is freed, and the TTL can then expire the row.

⚠️ THAT IS SELF-HEALING OF THE JOB TABLE, NOT RESURRECTION OF THE WORKER. A
Python thread cannot be killed; a wedged `_POOL` thread stays wedged, and later
submits will queue and age out in turn. What the cap buys is that the pod keeps
ANSWERING — honestly, by name — instead of refusing everyone in silence. The
aging runs on the next request (`submit_run`/`job_status` both call
`_evict_locked`), so no background timer is involved. ⛔ AND THE FIRST TERMINAL
VERDICT WINS: if the wedged worker later finishes, `_run_job` finds the job no
longer `running` and leaves the answer the member was already given.

⛔ WRITES NOTHING. `mode='on-demand'` is what `evaluate_one` is called with —
ONE parameter, the evaluator's own closed set (`EVALUATE_MODES`), the single
authority over persistence — and `tests/test_scan_run.py` monkeypatches every
writer to raise. A 500-symbol run filed under the nightly key would overwrite
the universe's receipt with a list's.

⛔ OWNERSHIP IS ANSWERED THE WAY `/api/user-definitions` ANSWERS IT: a definition
that is not the caller's is 404, not 403 (`DefinitionNotFound`); a JOB that is
not the caller's is 404 too (`JobNotFound`) — the id is unguessable AND
ownership-checked, never one without the other; and a list that is not the
caller's is refused BY NAME by `list_universe.resolve`, whose WHERE clause
carries the `user_id`.

⭐ THE GATE VOCABULARY IS DERIVED. `RUN_GATES` is this module's two gates plus
`scan_evaluator.RUN_GATES` namespaced with `gate:` — one closed set a caller
branches on; every message leads with `[gate:…]` so a test binds to the token.
A CRASH in the worker is not a gate: it lands on the job as `state: refused`
with `gate: None` and `error: True` (the router's 500), never as a plausible
4xx, and never as a job stuck `running`.

⚠️ PER-PROCESS STATE, like `screener_backtest._POOL` and `_charge_propose`:
exact on the single web pod, per-instance the day web scales out.
"""
from __future__ import annotations

import collections
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional, Sequence

from api.services import scan_definition, user_definitions
from api.services.screener import list_universe, scan_evaluator, scan_store

log = logging.getLogger(__name__)

#: ⛔ THE ONE NUMBER. The client's `RUN_SYMBOL_CAP` (W4a.4) is pinned EQUAL to
#: this by a backend test that reads the JS constant, never restated by hand.
MAX_RUN_SYMBOLS = 500

#: The tier a member reads on the result. `scan_store.hits_for` rows carry
#: `'nightly'|'live'` (W4b); this is the third word, and it never reaches a table.
#: It is ALSO the `mode` literal `_run_job` hands the evaluator — the AST test in
#: `tests/test_scan_run.py` pins the two to each other.
TIER = "on-demand"

UNIVERSE_GATE = "gate:universe"
BUSY_GATE = "gate:busy"
RUN_GATES = (UNIVERSE_GATE, BUSY_GATE) + tuple(
    f"gate:{g}" for g in scan_evaluator.RUN_GATES)

#: The job's life, closed. `refused` covers both a named gate (`gate` set) and a
#: crash (`gate: None`, `error: True`); the state set is the contract's.
JOB_STATES = ("queued", "running", "done", "refused")
_PENDING = ("queued", "running")
_TERMINAL = ("done", "refused")

#: How long a FINISHED job stays readable. The client polls every second or so
#: and renders once; ten minutes is a browser tab left open, not a store.
JOB_TTL_SECONDS = 600

#: Jobs in flight (queued + running) per pod.
MAX_PENDING_RUNS = 8

#: 🔴 THE CAP ON A RUN'S OWN DURATION, and the one that keeps this pod alive when
#: a worker WEDGES rather than raises (module header). ⭐ IT IS ~10x THE MEASURED
#: WORST CASE, not a round number: a 500-symbol run is 0.7-5.7 s of GIL-bound
#: compute on this box, so a run still going after a minute is not slow, it is
#: stuck. Same shape of margin as `scan_evaluator.SWEEP_STOP_BEFORE_OPEN` — a
#: bound whose whole job is to be wrong in the safe direction.
MAX_RUN_SECONDS = 60

#: The job table's bound. Finished jobs are evicted oldest-first past this;
#: pending ones never are (and there are at most `MAX_PENDING_RUNS` of those).
MAX_JOBS = 64


def _max_queue_wait_seconds() -> float:
    """The longest a job can honestly sit `queued`: everything ahead of it timing
    out at the duration cap, on the one worker.

    ⛔ DERIVED, NEVER TYPED — and it is what makes the header's claim CHECKABLE
    rather than decorative: `MAX_PENDING_RUNS x MAX_RUN_SECONDS` must stay under
    `JOB_TTL_SECONDS`, or a member could be handed a job id whose answer expires
    before it could possibly be computed. `tests/test_scan_run.py` asserts that
    inequality, so tuning either bound past it fails BY ARITHMETIC.
    """
    return MAX_PENDING_RUNS * MAX_RUN_SECONDS


class RunRefused(Exception):
    """The run cannot honestly proceed, and the gate that said so."""

    def __init__(self, gate: str, detail: str) -> None:
        if gate not in RUN_GATES:
            raise ValueError(
                f"{gate!r} is not one of the run gates {RUN_GATES}. The set is "
                "closed on purpose: a caller branches on it.")
        self.gate = gate
        self.detail = detail
        super().__init__(f"[{gate}] {detail}")


class DefinitionNotFound(LookupError):
    """No LIVE definition at this id for this member. ⛔ Not-there and not-yours
    are ONE answer, matching `api/routers/user_definitions.py::get_definition`."""


class JobNotFound(LookupError):
    """No job at this id for this member — expired, evicted, never existed, or
    somebody else's. ⛔ ONE answer for all four, for the same reason."""


class BadRequest(ValueError):
    """A spelling problem in the request — a product-label timeframe, an
    unparseable session, a malformed id — carrying the store's own sentence."""


#: ⛔ ONE WORKER. This is the rail: two concurrent runs would double this single
#: pod's GIL-bound compute for no member benefit, and `evaluate_one` is called
#: NOWHERE but on this thread. Pinned by AST in `tests/test_scan_run.py`.
_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scan-run")

#: The job table: insertion-ordered, so "oldest" is a position, not a sort.
#: Every read and write goes under `_LOCK`; `job_status` hands out COPIES.
_JOBS: "collections.OrderedDict[str, dict]" = collections.OrderedDict()
_LOCK = threading.Lock()


def _clock() -> float:
    """Wall-clock seconds. ONE function so a test can freeze the whole table."""
    return time.time()


def _new_job_id() -> str:
    return uuid.uuid4().hex


# --------------------------------------------------------------------------- #
# the universe
# --------------------------------------------------------------------------- #

def _over_cap(count: Any, source: str) -> RunRefused:
    """THE ONE over-cap sentence, so the two call sites cannot word it two ways.
    `count` is a number, or a phrase when the input could not be measured."""
    return RunRefused(
        UNIVERSE_GATE,
        f"{count} symbols for a run of {source!r}; the cap is {MAX_RUN_SYMBOLS}. "
        "Pick a shorter list — the nightly sweep already covers the whole universe")


def _clean_symbols(symbols: Optional[Sequence[Any]]) -> list:
    """Uppercased, de-duplicated, order-stable — the same normalisation
    `list_universe._finish` applies, because `ohlcv.ticker` is uppercase and a
    case mismatch would read as `no-bars` on a symbol we hold.

    ⛔ AND THE WALK ITSELF IS BOUNDED. This runs on the REQUEST PATH in a module
    whose whole thesis is "bounded, never a universe"; a loop over whatever
    arrived — before any cap was consulted — is the one unbounded thing left in
    it. `resolve_universe` refuses a SIZED body before calling here at all; this
    guard is for one that cannot be measured (a generator), and it stops ONE PAST
    the cap so an over-long input is REFUSED rather than silently truncated.
    """
    seen: set = set()
    out: list = []
    walked = 0
    for raw in symbols or ():
        walked += 1
        if walked > MAX_RUN_SYMBOLS + 1:
            raise _over_cap(f"more than {MAX_RUN_SYMBOLS}", "symbols")
        s = str(raw).strip().upper()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def resolve_universe(user_id: Any, *, symbols: Optional[Sequence[Any]] = None,
                     list_id: Optional[str] = None) -> tuple:
    """``(symbols, receipt)`` for one request. The receipt says where they came
    from and how many were asked for, so the response can state its universe."""
    if list_id is not None and symbols is not None:
        raise RunRefused(UNIVERSE_GATE,
                         "send symbols OR list_id, not both — two universes for one "
                         "run would leave the result claiming whichever won")
    if list_id is not None:
        try:
            syms, rc = list_universe.resolve(list_id, user_id)
        except list_universe.ListRefusal as exc:
            raise RunRefused(UNIVERSE_GATE, str(exc)) from exc
        if rc.get("complement"):
            raise RunRefused(UNIVERSE_GATE,
                             f"{list_id!r} is a complement (everything NOT on a list), "
                             "not a list — a run needs a bounded set of names")
        source = {"source": rc.get("selector", list_id), "label": rc.get("label")}
    else:
        if isinstance(symbols, (str, bytes)):
            # ⛔ ITERATED, `"NVDA"` IS FOUR SYMBOLS WE DO NOT HOLD — four `no-bars`
            # drops and a receipt that reads like a quiet market. The wire says
            # `string[]`; a string is a spelling problem, and it says so.
            raise BadRequest(
                "symbols must be a list of tickers, not a string — iterated, "
                f"{symbols!r:.40} would be one symbol per character")
        # ⛔ THE CAP FIRST, THE WALK SECOND. Checking it after `_clean_symbols`
        # meant the request path had already walked every name the caller sent.
        if symbols is not None and hasattr(symbols, "__len__") \
                and len(symbols) > MAX_RUN_SYMBOLS:
            raise _over_cap(len(symbols), "symbols")
        syms = _clean_symbols(symbols)
        source = {"source": "symbols", "label": None}
    requested = len(syms)
    if not syms:
        raise RunRefused(UNIVERSE_GATE,
                         f"no symbols to run ({source['source']!r} resolved to nothing) — "
                         "an empty universe produces an empty hit list that is "
                         "indistinguishable from a quiet market")
    if requested > MAX_RUN_SYMBOLS:
        raise _over_cap(requested, source["source"])
    return syms, {**source, "requested": requested}


def _load_definition(user_id: Any, def_id: str) -> dict:
    try:
        row = user_definitions.get(user_id, def_id)
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    if row is None:
        raise DefinitionNotFound(def_id)
    return row


def _note_demand(symbols: Sequence[str]) -> bool:
    """Tell the prewarm ring (W4b) what a member just asked for — IF it exists.
    ⛔ ON THE STORE, not the evaluator (contract: the import rail). A hint must
    never break a run: absent → False, raising → False + a log line."""
    fn = getattr(scan_store, "note_demand", None)
    if not callable(fn):
        return False
    try:
        fn(list(symbols))
        return True
    except Exception as exc:                                   # noqa: BLE001
        log.warning("[scan-run] note_demand failed: %s", exc)
        return False


# --------------------------------------------------------------------------- #
# the job table
# --------------------------------------------------------------------------- #

_COVERAGE_KEYS = ("evaluated", "answered", "dropped", "not_computable",
                  "withheld", "withheld_reason", "dropped_symbols",
                  "dropped_listed", "truncated")


def _abandon_locked(job: dict, now: float, detail: str) -> None:
    """Give a wedged job a terminal answer. ⛔ `gate: None` + `error: True`, the
    crash shape — a timeout is this pod failing the member, never one of the
    closed gates the member could act on. Caller holds `_LOCK`."""
    log.warning("[scan-run] job %s abandoned: %s", job["job"], detail)
    job.update({"state": "refused", "gate": None, "error": True,
                "detail": detail, "finished_at": now})


def _evict_locked(now: float, *, make_room: bool = False) -> None:
    """Age out what is wedged, expire what is finished, then (on submit) make
    room — and NEVER DELETE a job that is still queued or running.
    Caller holds `_LOCK`.

    🔴 THE AGING IS FIRST AND IT IS WHY THE POD SELF-HEALS. See the module
    header: a blocked worker frees nothing on its own, and the TTL cannot reach
    it because the TTL's clock starts at `finished_at`.
    """
    queue_wait = _max_queue_wait_seconds()
    for job in _JOBS.values():
        if job["state"] == "running" and now - job["started_at"] > MAX_RUN_SECONDS:
            _abandon_locked(job, now,
                            f"the run passed {MAX_RUN_SECONDS}s without finishing and "
                            "was abandoned; the worker may still be wedged, so try "
                            "again and tell someone if it repeats")
        elif job["state"] == "queued" and now - job["submitted_at"] > queue_wait:
            _abandon_locked(job, now,
                            f"the job waited {queue_wait:.0f}s without starting — the "
                            "one run worker on this pod is not draining; try again")
    expired = [jid for jid, job in _JOBS.items()
               if job["state"] in _TERMINAL
               and now - job["finished_at"] > JOB_TTL_SECONDS]
    for jid in expired:
        del _JOBS[jid]
    while make_room and len(_JOBS) >= MAX_JOBS:
        oldest = next((jid for jid, job in _JOBS.items()
                       if job["state"] in _TERMINAL), None)
        if oldest is None:
            break
        del _JOBS[oldest]


def _public(job: dict, position: Optional[int]) -> dict:
    """The member's view of a job — a FRESH dict, so a caller mutating the
    answer cannot reach the table."""
    out = {
        "job": job["job"],
        "state": job["state"],
        "tier": TIER,
        "def_id": job["def_id"],
        "tf": job["tf"],
        "as_of": job["as_of"],
        "universe": dict(job["universe"]),
        "submitted_at": job["submitted_at"],
    }
    if job["state"] == "queued":
        out["position"] = position
    for stamp in ("started_at", "finished_at"):
        if stamp in job:
            out[stamp] = job[stamp]
    if job["state"] == "done":
        env = job["envelope"]
        out.update({
            "def_hash": env["def_hash"],
            "rev": env["rev"],
            "freshness": env["freshness"],
            "cadence": env["cadence"],
            "mode": env["mode"],
            "persisted": env["persisted"],
            "hits": [dict(h) for h in env["hit_rows"]],
            "coverage": {k: ([dict(d) for d in env[k]] if k == "dropped_symbols" else env[k])
                         for k in _COVERAGE_KEYS},
        })
    elif job["state"] == "refused":
        out["gate"] = job["gate"]
        out["detail"] = job["detail"]
        if job.get("error"):
            out["error"] = True
    return out


# --------------------------------------------------------------------------- #
# the doors
# --------------------------------------------------------------------------- #

def submit_run(user_id: Any, def_id: str, *,
               symbols: Optional[Sequence[Any]] = None,
               list_id: Optional[str] = None,
               tf: str = scan_evaluator.DEFAULT_TF,
               as_of: Optional[Any] = None,
               limits: Any = None) -> str:
    """Validate, resolve, refuse-or-queue. Returns the job id; NEVER computes.

    ⛔ THE CHECKS RUN IN COST ORDER AND EVERY REFUSAL IS IMMEDIATE: the definition
    (a row read), scannability (pure), the spelling (pure), the universe (a list
    read), then — atomically under the lock — the two busy gates. Only a request
    that passed all of them gets a job id, and only that job reaches the worker.

    `limits` is the caller's toolkit (`entitlements.Limits`), handed through to
    the evaluator's own entitlement slice; `None` is the default toolkit.
    """
    row = _load_definition(user_id, def_id)
    definition = row["definition"]
    try:
        # ⭐ A GATE, NOT A HASH. The dict it returns carries `def_hash`, and it is
        # DISCARDED here: the run's hash is `evaluate_one`'s own, read off the
        # artifact when the worker hands it back. One object, one hash.
        scan_definition.assert_scannable(definition)
    except scan_definition.ScanRefused as exc:
        raise RunRefused("gate:not-scannable", str(exc)) from exc
    try:
        tf_code = scan_store._normalise_tf(tf)
        session = int(scan_store._normalise_as_of(
            as_of if as_of is not None else scan_evaluator.expected_session()))
    except (ValueError, TypeError) as exc:
        raise BadRequest(str(exc)) from exc
    syms, universe = resolve_universe(user_id, symbols=symbols, list_id=list_id)

    member = str(user_id)
    job_id = _new_job_id()
    job = {
        "job": job_id,
        "user_id": member,
        "state": "queued",
        "def_id": row["def_id"],
        "definition": definition,
        "tf": tf_code,
        "as_of": session,
        "symbols": syms,
        "universe": {**universe, "resolved": len(syms)},
        "limits": limits,
        "submitted_at": None,
    }
    with _LOCK:
        now = _clock()
        _evict_locked(now, make_room=True)
        # ⛔ CHECK-THEN-INSERT UNDER ONE LOCK, or two clicks a millisecond apart
        # both pass the check and the member has two runs in flight.
        mine = next((j for j in _JOBS.values()
                     if j["user_id"] == member and j["state"] in _PENDING), None)
        if mine is not None:
            raise RunRefused(BUSY_GATE,
                             f"a run for this member is already {mine['state']} "
                             f"(job {mine['job']}); one at a time — poll it, or wait "
                             "for it to finish")
        pending = sum(1 for j in _JOBS.values() if j["state"] in _PENDING)
        if pending >= MAX_PENDING_RUNS:
            raise RunRefused(BUSY_GATE,
                             f"{pending} runs are already in flight on this pod's one "
                             f"worker (the bound is {MAX_PENDING_RUNS}); try again in "
                             "a moment")
        job["submitted_at"] = now
        _JOBS[job_id] = job
    try:
        _POOL.submit(_run_job, job_id)
    except Exception as exc:                                   # noqa: BLE001
        # A pool that refuses (shut down at exit) must not leave a job `queued`
        # forever — that would lock the member out under the per-member gate.
        with _LOCK:
            job.update({"state": "refused", "gate": None, "error": True,
                        "detail": f"the run pool refused the job: {exc}"[:300],
                        "finished_at": _clock()})
        raise
    return job_id


def job_status(job_id: Any, user_id: Any) -> dict:
    """The member's view of ONE job — theirs, or `JobNotFound`.

    While `queued`, `position` is how many queued jobs are ahead of it (0 = next
    up). `def_hash`, `hits` and `coverage` appear only once the job is `done`;
    `gate`/`detail` (and `error` for a crash) only once it is `refused`.
    """
    member = str(user_id)
    with _LOCK:
        _evict_locked(_clock())
        job = _JOBS.get(str(job_id))
        if job is None or job["user_id"] != member:
            raise JobNotFound(str(job_id))
        position = None
        if job["state"] == "queued":
            position = 0
            for other in _JOBS.values():
                if other is job:
                    break
                if other["state"] == "queued":
                    position += 1
        return _public(job, position)


# --------------------------------------------------------------------------- #
# the worker body — the ONE place the evaluator is called
# --------------------------------------------------------------------------- #

def _run_job(job_id: str) -> None:
    """Runs on `_POOL`'s single thread, never on a request.

    Whatever happens here lands on the job: a named gate as `refused` with its
    namespaced gate, a crash as `refused` with `gate: None` + `error: True`, an
    answer as `done` with the evaluator's own envelope. Nothing is raised out of
    the pool, so nothing can disappear into a Future nobody reads.
    """
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None or job["state"] != "queued":
            # ⛔ ABANDONED, OR GONE. The duration/queue cap already gave this job a
            # terminal answer and the member has read it; running it now would
            # replace that answer with a later, different one.
            return
        job["state"] = "running"
        job["started_at"] = _clock()
        definition = job["definition"]
        tf_code, session, limits = job["tf"], job["as_of"], job["limits"]
        syms = list(job["symbols"])
    outcome: Optional[dict] = None
    try:
        _note_demand(syms)
        # ⛔ THE LITERAL, NOT `TIER`. The AST rails (this file's test, W4a.3's) read
        # the keyword off the source; `TIER` is pinned equal to it by test.
        env = scan_evaluator.evaluate_one(
            definition, tf_code, universe=syms, as_of=session,
            limits=limits, mode="on-demand")
    except scan_evaluator.ScanRunRefused as exc:
        # the evaluator's own gate, namespaced — in `RUN_GATES` by derivation
        outcome = {"state": "refused", "gate": f"gate:{exc.gate}", "detail": exc.detail}
    except Exception as exc:                                   # noqa: BLE001
        # ⛔ RECORDED, NEVER SWALLOWED, NEVER A GATE. A crash that left the job
        # `running` would poll forever; one dressed as a refusal would read as
        # the member's fault.
        log.exception("[scan-run] job %s crashed", job_id)
        outcome = {"state": "refused", "gate": None, "error": True,
                   "detail": f"{type(exc).__name__}: {exc}"[:300]}
    else:
        outcome = {"state": "done", "envelope": env}
    finally:
        # ⛔ TERMINAL, WHATEVER HAPPENED. A job left `running` polls forever AND
        # locks its member out under the per-member gate; the fallback below is
        # for an exception no clause above caught (an interrupt mid-run).
        with _LOCK:
            job = _JOBS.get(job_id)
            # ⛔ THE FIRST TERMINAL VERDICT WINS: a job the duration cap already
            # abandoned keeps that answer, so a member is never told `refused`
            # and then `done` for one run.
            if job is not None and job["state"] == "running":
                job.update(outcome or {
                    "state": "refused", "gate": None, "error": True,
                    "detail": "the worker was interrupted before it recorded an outcome"})
                job["finished_at"] = _clock()
