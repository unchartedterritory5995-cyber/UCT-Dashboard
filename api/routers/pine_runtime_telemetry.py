"""The Pine runtime lane's STOP telemetry -- Phase 3 WS-H, arming item S8.

Before this, a member's runtime pane that stopped (over its 1,000 ms budget, past
a named VM limit, a worker that hung or died) said so only on that member's own
disclosure strip: the operator could not see that a script was stopping without
reading somebody's screen. This is a counted beacon, one row per stop:

    guard    which stop, from the closed set `STOP_GUARDS`
    limit    for `runtime:limit`, which named limit, from `LIMIT_NAMES`
    hash     the first 12 hex characters of the script's sha256 -- the same
             prefix the kill list and the allowlist already print
    bars     how many bars the run was handed
    ms       how long it ran, in whole milliseconds
    lane     where it ran: the worker, or this thread where no worker exists

⛔⛔ NO MEMBER SOURCE AND NO MEMBER ID. The source never leaves the browser (only
its hash prefix does), and the row's `visitor_id` is the constant `VISITOR`, not
the member's id: the operator's question is "which scripts stop, how, how often",
and no part of it needs to know who. That is strictly less than
`indicator_telemetry.py` stores.

⛔ THE SAME ALLOWLIST DISCIPLINE AS `indicator_telemetry.EVENT_SCHEMAS`: every
field has a type AND a closed value set or a strict pattern, an unknown field is
REJECTED (422, `extra="forbid"`), and no value is free-form text. There is no
`message` field on purpose: a stop's sentence can quote the script.

⭐ THE CLOSED SETS ARE PINNED TO THEIR SOURCES by
`tests/test_pine_runtime_stop_telemetry.py`, which parses `limits.js` and the
guard constants in the client rather than restating them, so a new limit or stop
guard on the client cannot be silently refused here.

Storage is `landing_events` (the table `indicator_telemetry` already writes),
bounded by TWO durable daily caps in `daily_counters`, taken together or not at
all: a global one (subject GLOBAL) and a per-member one, so one member posting
directly cannot fill the day for everyone. ⛔ The per-member counter's subject is
a KEYED HASH of the member id (`member_subject`: HMAC-SHA256 under `PUSH_SECRET`,
this module's own domain, the `indicator_support.member_key` pattern), never the
id itself, and it is pruned within two ET days like every counter row; the
`landing_events` row carries no member identity at all. Over either cap a beacon
is answered and not stored.

⚠️ PSEUDONYMOUS, NOT ANONYMOUS: the hash prefix names a SCRIPT, and an operator
holding the stored runtime definitions can join it to them (and so to their
owners). It carries no member id, but it is not unlinkable.
Never raises into the caller: a telemetry failure must never break anything.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import daily_counters
from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pine-runtime-telemetry", tags=["pine-runtime-telemetry"])

EVENT = "pine_runtime_stop"
VISITOR = "pine-runtime"          # ⛔ never a member id
SCOPE = "pine_runtime_stop"
DAILY_CAP = 5000                  # global, per ET day
MEMBER_DAILY_CAP = 200            # per member, per ET day
_MEMBER_DOMAIN = b"pine-runtime-stop:v1|"
_DEV_FALLBACK_SECRET = b"uct-pine-runtime-stop-dev-salt"


def member_subject(user_id: Any) -> str:
    """The per-member counter's subject: a keyed hash, never the id. `PUSH_SECRET`
    (the server secret `indicator_support.member_key` keys with), or a fixed dev
    salt where it is unset (a local box)."""
    secret = (os.environ.get("PUSH_SECRET") or "").strip().encode("utf-8") or _DEV_FALLBACK_SECRET
    return "m:" + hmac.new(secret, _MEMBER_DOMAIN + str(user_id).encode("utf-8"), hashlib.sha256).hexdigest()[:32]

#: The stops arming item S3 names (`PHASE3-RUNTIME-PLAN.md` 4.1). A refusal
#: (killed, not yet graded, a construct the lane cannot mean) is not a stop.
STOP_GUARDS = frozenset({
    "runtime:time-budget", "runtime:limit", "runtime:failed",
    "runtime:worker-unresponsive", "runtime:worker-failed", "runtime:load-failed",
})

#: `limits.js` `LIMIT_NAMES` -- pinned against that file by the test.
LIMIT_NAMES = frozenset({
    "PROGRAM_SIZE", "IR_SIZE", "INSTRUCTIONS_PER_BAR", "TOTAL_INSTRUCTIONS",
    "LOOP_ITERATIONS", "WHILE_ITERATIONS", "LOOP_NESTING", "CALL_DEPTH", "CALL_COUNT",
    "ARRAY_ELEMENTS", "ARRAY_OPERATIONS", "LIVE_OBJECTS", "OBJECT_OPERATIONS", "HISTORY",
    "HISTORY_SLOTS", "HISTORY_VALUES", "WINDOW_CELLS", "CARRIED_INSTANCES", "CARRIED_CELLS",
    "CARRIED_STEPS", "REQUEST_COUNT", "REQUEST_FANOUT", "MEMORY", "WALL_TIME",
})

_HASH_PATTERN = r"^[0-9a-f]{12}$"


class StopBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    guard: str = Field(..., max_length=40)
    limit: Optional[str] = Field(default=None, max_length=40)
    hash: str = Field(..., pattern=_HASH_PATTERN)
    bars: int = Field(..., ge=0, le=1_000_000, strict=True)
    ms: int = Field(..., ge=0, le=600_000, strict=True)
    lane: Literal["worker", "main"]

    def violation(self) -> Optional[str]:
        if self.guard not in STOP_GUARDS:
            return "guard is not a runtime stop"
        if self.limit is not None:
            if self.guard != "runtime:limit":
                return "limit is carried only by runtime:limit"
            if self.limit not in LIMIT_NAMES:
                return "limit is not a declared runtime limit"
        return None


def _et_day() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def record_stop(body: StopBody, user_id: Any = None) -> bool:
    """Store one stop. True when a row was written. Never raises."""
    if body.violation() is not None:
        return False
    try:
        charges = [daily_counters.Charge(SCOPE, daily_counters.GLOBAL, 1, DAILY_CAP)]
        if user_id is not None:
            charges.insert(0, daily_counters.Charge(SCOPE, member_subject(user_id), 1, MEMBER_DAILY_CAP))
        refused = daily_counters.take(_et_day(), charges)
    except Exception:  # noqa: BLE001
        refused = None
    if refused is not None:
        return False
    props = {"guard": body.guard, "hash": body.hash, "bars": body.bars, "ms": body.ms, "lane": body.lane}
    if body.limit is not None:
        props["limit"] = body.limit
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] no connection")
        return False
    try:
        conn.execute("INSERT INTO landing_events (visitor_id, event, props) VALUES (?, ?, ?)",
                     (VISITOR, EVENT, json.dumps(props, separators=(",", ":"), sort_keys=True)))
        conn.commit()
        return True
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] write failed")
        return False
    finally:
        conn.close()


@router.post("/stop")
def stop(body: StopBody, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """⛔ Signed in (an open write door would let anybody fill the day's cap).
    The member's id is read only to key the per-member cap, as a keyed hash; it
    is stored nowhere."""
    reason = body.violation()
    if reason is not None:
        return {"ok": False, "logged": False, "reason": reason}
    return {"ok": True, "logged": record_stop(body, user.get("id"))}


def _pct(values: list, q: float):
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]


def stop_report(days: int = 7) -> dict[str, Any]:
    """Aggregates only: stops by guard (and limit), and by script hash prefix."""
    days = max(1, min(int(days), 30))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        return {"days": days, "stops": 0, "by_guard": {}, "by_script": []}
    try:
        rows = conn.execute(
            "SELECT props FROM landing_events WHERE event = ? AND visitor_id = ? AND created_at >= ?",
            (EVENT, VISITOR, since)).fetchall()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] report read failed")
        rows = []
    finally:
        conn.close()
    by_guard: dict = {}
    scripts: dict = {}
    for (raw,) in rows:
        try:
            p = json.loads(raw or "{}")
        except (TypeError, ValueError):
            continue
        key = p.get("guard") if not p.get("limit") else f"{p.get('guard')}:{p.get('limit')}"
        by_guard[key] = by_guard.get(key, 0) + 1
        cell = scripts.setdefault(p.get("hash"), {"hash": p.get("hash"), "stops": 0, "guards": {}, "ms": [], "bars": []})
        cell["stops"] += 1
        cell["guards"][key] = cell["guards"].get(key, 0) + 1
        if isinstance(p.get("ms"), int):
            cell["ms"].append(p["ms"])
        if isinstance(p.get("bars"), int):
            cell["bars"].append(p["bars"])
    by_script = []
    for cell in sorted(scripts.values(), key=lambda c: -c["stops"]):
        by_script.append({"hash": cell["hash"], "stops": cell["stops"], "guards": cell["guards"],
                          "ms_p50": _pct(cell["ms"], 0.5), "ms_p95": _pct(cell["ms"], 0.95),
                          "bars_max": max(cell["bars"]) if cell["bars"] else None})
    return {"days": days, "stops": sum(by_guard.values()),
            "by_guard": dict(sorted(by_guard.items(), key=lambda kv: -kv[1])), "by_script": by_script}


@router.get("/stops")
def stops(days: int = 7, user: dict = Depends(require_admin)) -> dict[str, Any]:
    """The operator's read. ADMIN ONLY."""
    return stop_report(days)


# ─── ENGINE 54 -- RUN-HALF REFUSAL TELEMETRY ───────────────────────────────────────────
#
# A host document's run half (`compute.runtimeObjects`) is refused by a dozen gates and three
# rails at bind (`nativeRegistry.withRunHalf`). Before capability admission widens who gets
# one, the reach must be measured: the client counts each refusal code per document session
# and beacons ONE row per (script, code) per tab (`engine/runHalfTelemetry.js`) with exactly
#
#     code    the refusal code, a guard family and a name (`RUN_HALF_CODE_PATTERN`: no free
#             text, so no sentence that could quote the script)
#     hash    the first 12 hex characters of the script's sha256
#
# ⛔⛔ The same discipline as the stop beacon above: no source, no member id in the row
# (`VISITOR`), unknown fields refused (422), the same two durable daily caps under their own
# scope.
RUN_HALF_EVENT = "pine_run_half_refusal"
RUN_HALF_SCOPE = "pine_run_half_refusal"
RUN_HALF_CODE_PATTERN = r"^(run-half|pane|runtime|interpret|pine|lower-tf|budget):[A-Za-z0-9_.-]{1,48}$"


class RunHalfBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., max_length=60, pattern=RUN_HALF_CODE_PATTERN)
    hash: str = Field(..., pattern=_HASH_PATTERN)


def record_run_half(body: RunHalfBody, user_id: Any = None) -> bool:
    """Store one run-half refusal. True when a row was written. Never raises."""
    try:
        charges = [daily_counters.Charge(RUN_HALF_SCOPE, daily_counters.GLOBAL, 1, DAILY_CAP)]
        if user_id is not None:
            charges.insert(0, daily_counters.Charge(RUN_HALF_SCOPE, member_subject(user_id), 1, MEMBER_DAILY_CAP))
        refused = daily_counters.take(_et_day(), charges)
    except Exception:  # noqa: BLE001
        refused = None
    if refused is not None:
        return False
    props = {"code": body.code, "hash": body.hash}
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] no connection")
        return False
    try:
        conn.execute("INSERT INTO landing_events (visitor_id, event, props) VALUES (?, ?, ?)",
                     (VISITOR, RUN_HALF_EVENT, json.dumps(props, separators=(",", ":"), sort_keys=True)))
        conn.commit()
        return True
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] run-half write failed")
        return False
    finally:
        conn.close()


@router.post("/run-half")
def run_half(body: RunHalfBody, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """⛔ Signed in, as `/stop`. The member's id keys the per-member cap as a keyed hash only."""
    return {"ok": True, "logged": record_run_half(body, user.get("id"))}


def run_half_report(days: int = 7) -> dict[str, Any]:
    """Aggregates only: refusals by code, and by script hash prefix."""
    days = max(1, min(int(days), 30))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        return {"days": days, "refusals": 0, "by_code": {}, "by_script": []}
    try:
        rows = conn.execute(
            "SELECT props FROM landing_events WHERE event = ? AND visitor_id = ? AND created_at >= ?",
            (RUN_HALF_EVENT, VISITOR, since)).fetchall()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] run-half report read failed")
        rows = []
    finally:
        conn.close()
    by_code: dict = {}
    scripts: dict = {}
    for (raw,) in rows:
        try:
            p = json.loads(raw or "{}")
        except (TypeError, ValueError):
            continue
        code = p.get("code")
        by_code[code] = by_code.get(code, 0) + 1
        cell = scripts.setdefault(p.get("hash"), {"hash": p.get("hash"), "refusals": 0, "codes": {}})
        cell["refusals"] += 1
        cell["codes"][code] = cell["codes"].get(code, 0) + 1
    return {"days": days, "refusals": sum(by_code.values()),
            "by_code": dict(sorted(by_code.items(), key=lambda kv: -kv[1])),
            "by_script": sorted(scripts.values(), key=lambda c: -c["refusals"])}


@router.get("/run-halves")
def run_halves(days: int = 7, user: dict = Depends(require_admin)) -> dict[str, Any]:
    """The operator's read. ADMIN ONLY."""
    return run_half_report(days)


# ─── U4 -- THE RUN COUNT AND PERF BEACON (the cohort gate's denominator) ────────────────
#
# The stop beacon above counts STOPS once per (script, stop) per tab, so "stops under 2% of
# runs" (the runtime pane's admins -> cohort exit gate) had no denominator. The browser lane
# now counts every run it ANSWERS, by outcome, and sends one batch at most once a minute
# (`engine/runtimeRunTelemetry.js`):
#
#     tab                       a RANDOM per-tab nonce (16 hex), minted per page load and never
#                               stored in the browser: it joins nothing and names nobody; it
#                               exists so one heavy tab cannot dominate the gate unseen
#     started, ok, declined     integers
#     dropped                   runs the tab answered but could not count (its batch was full
#                               or its send budget spent): reported, never silently lost
#     stops                     {code: n}: a `STOP_GUARDS` code, or `runtime:limit:<LIMIT_NAME>`
#     ms                        {bucket: n}: the round-trip histogram, `RUN_MS_BUCKETS` upper
#                               edges (ms) plus `inf`
#
# ⛔⛔ NO SOURCE, NO HASH, NO MEMBER ID: a batch is integers under closed keys, AGGREGATED on
# arrival into `pine_runtime_run_daily(day, metric, key, n)` (per ET day, per code) and
# `pine_runtime_run_tabs(day, tab, runs, stops)` (per random tab nonce, kept
# `RUNS_TAB_RETAIN_DAYS`). Every key is re-checked against the closed sets (an unknown key
# refuses the WHOLE batch), every value is a strict int, an unknown field is a 422.
#
# ⛔⛔ WHO MAY POST (review M3): only a member whose pane runs the runtime lane
# (`runtime_definitions.pane_permitted`, the stage and cohort the pane itself asks); anyone
# else is answered and nothing is stored. One batch may carry at most `RUNS_MAX_PER_BATCH`
# answered runs (a realistic minute), and the durable per-member daily cap is a small
# fraction of the global one, so one member can neither flood the counts nor exhaust the day.
#
# THE GATE (review M1, M2): `stop_rate` = stops / (ok + stops). A decline is a refusal, not a
# run that completed or stopped, so it is reported beside the rate and never dilutes it.
# The criterion passes only with at least `COHORT_MIN_RUNS` runs (rule of three: 0 stops in
# 150 runs bounds the rate under 2%), a one-sided 95% Wilson UPPER bound under the threshold,
# at least `COHORT_MIN_TABS` tabs, no tab holding more than `COHORT_MAX_TAB_SHARE` of the
# runs, no worker-failed, no load-failed, and nothing dropped.

RUNS_SCOPE = "pine_runtime_runs"
RUNS_DAILY_CAP = 200_000          # batches, global, per ET day
RUNS_MEMBER_DAILY_CAP = 600       # batches, per member, per ET day (10 h at one a minute)
RUNS_MAX_PER_BATCH = 600          # answered runs one batch may carry (the client's own cap)
RUNS_MAX_PER_FIELD = 600
RUNS_MAX_DROPPED = 100_000
RUNS_RETAIN_DAYS = 400
RUNS_TAB_RETAIN_DAYS = 30
RUN_TELEMETRY_ENV = "PINE_RUNTIME_RUN_TELEMETRY"
#: Pinned to the client's `RUN_MS_BUCKETS` by the rail.
RUN_MS_BUCKETS = (1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700, 1000,
                  1500, 2000, 3000, 5000, 10000, 20000)
RUN_MS_KEYS = tuple(str(b) for b in RUN_MS_BUCKETS) + ("inf",)
RUN_COUNT_KEYS = ("started", "ok", "declined", "dropped")
COHORT_STOP_RATE = 0.02
COHORT_MIN_RUNS = 150
COHORT_MIN_TABS = 3
COHORT_MAX_TAB_SHARE = 0.5
_WILSON_Z = 1.6448536269514722    # one-sided 95%
RUNS_TABLE = "pine_runtime_run_daily"
RUNS_TAB_TABLE = "pine_runtime_run_tabs"
_RUNS_DDL = (f"CREATE TABLE IF NOT EXISTS {RUNS_TABLE} (day TEXT NOT NULL, metric TEXT NOT NULL, "
             "key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, metric, key))")
_RUNS_TAB_DDL = (f"CREATE TABLE IF NOT EXISTS {RUNS_TAB_TABLE} (day TEXT NOT NULL, tab TEXT NOT NULL, "
                 "runs INTEGER NOT NULL, stops INTEGER NOT NULL, PRIMARY KEY (day, tab))")
_runs_pruned_day = [""]


def run_telemetry_enabled() -> bool:
    """`PINE_RUNTIME_RUN_TELEMETRY`, read per call: on unless set to `off` (a kill switch
    for storage; the beacon is still answered)."""
    return os.environ.get("PINE_RUNTIME_RUN_TELEMETRY", "on").strip().lower() != "off"


def run_stop_code_ok(code: Any) -> bool:
    if not isinstance(code, str):
        return False
    if code in STOP_GUARDS:
        return True
    head, _, name = code.rpartition(":")
    return head == "runtime:limit" and name in LIMIT_NAMES


_Count = Annotated[int, Field(ge=1, le=RUNS_MAX_PER_FIELD, strict=True)]


class RunsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tab: str = Field(..., pattern=r"^[0-9a-f]{16}$")
    started: int = Field(0, ge=0, le=RUNS_MAX_PER_FIELD, strict=True)
    ok: int = Field(0, ge=0, le=RUNS_MAX_PER_FIELD, strict=True)
    declined: int = Field(0, ge=0, le=RUNS_MAX_PER_FIELD, strict=True)
    dropped: int = Field(0, ge=0, le=RUNS_MAX_DROPPED, strict=True)
    stops: dict[Annotated[str, Field(max_length=64)], _Count] = Field(default_factory=dict, max_length=32)
    ms: dict[Annotated[str, Field(max_length=8)], _Count] = Field(default_factory=dict,
                                                                  max_length=len(RUN_MS_KEYS))

    def answered(self) -> int:
        return self.ok + self.declined + sum(self.stops.values())

    def violation(self) -> Optional[str]:
        for code in self.stops:
            if not run_stop_code_ok(code):
                return "a stop code is not a declared runtime stop"
        for key in self.ms:
            if key not in RUN_MS_KEYS:
                return "a histogram key is not a declared bucket"
        answered = self.answered()
        if answered > RUNS_MAX_PER_BATCH:
            return "the batch carries more runs than one batch may"
        if sum(self.ms.values()) > answered:
            return "the histogram counts more runs than were answered"
        if not (answered or self.started or self.dropped):
            return "the batch is empty"
        return None


def _runs_rows(body: RunsBody) -> list:
    rows = [("count", k, getattr(body, k)) for k in RUN_COUNT_KEYS if getattr(body, k)]
    rows += [("stop", k, v) for k, v in sorted(body.stops.items())]
    rows += [("ms", k, v) for k, v in sorted(body.ms.items())]
    return rows


def _prune_runs(conn, today: str) -> None:
    """Retention for both tables: daily sums `RUNS_RETAIN_DAYS`, tab rows `RUNS_TAB_RETAIN_DAYS`.
    (Follow-up review: run by the read too, not only by a day's first stored batch.)"""
    base = datetime.fromisoformat(today)
    conn.execute(f"DELETE FROM {RUNS_TABLE} WHERE day < ?",
                 ((base - timedelta(days=RUNS_RETAIN_DAYS)).date().isoformat(),))
    conn.execute(f"DELETE FROM {RUNS_TAB_TABLE} WHERE day < ?",
                 ((base - timedelta(days=RUNS_TAB_RETAIN_DAYS)).date().isoformat(),))


def _count_refused(day: str) -> None:
    """One more batch the caps refused today. Never raises."""
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        return
    try:
        conn.execute(_RUNS_DDL)
        conn.execute(f"INSERT INTO {RUNS_TABLE} (day, metric, key, n) VALUES (?, 'count', 'refused', 1) "
                     "ON CONFLICT(day, metric, key) DO UPDATE SET n = n + 1", (day,))
        conn.commit()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] refused count failed")
    finally:
        conn.close()


def record_runs(body: RunsBody, user_id: Any = None, *, day: Optional[str] = None) -> bool:
    """Aggregate one batch into the day's per-code sums and its tab's row. True when stored.
    Never raises. (Who may post is the route's question: `runs`.)"""
    if body.violation() is not None or not run_telemetry_enabled():
        return False
    d = day or _et_day()
    try:
        charges = [daily_counters.Charge(RUNS_SCOPE, daily_counters.GLOBAL, 1, RUNS_DAILY_CAP)]
        if user_id is not None:
            charges.insert(0, daily_counters.Charge(RUNS_SCOPE, member_subject(user_id), 1,
                                                    RUNS_MEMBER_DAILY_CAP))
        refused = daily_counters.take(_et_day(), charges)
    except Exception:  # noqa: BLE001
        refused = None
    if refused is not None:
        # ⭐ follow-up review L1: a batch the caps refused is a hole in the sample. It is COUNTED
        # (one integer per ET day, no member, no tab) and fails `nothing_dropped`, so a gate read
        # can never pass over runs it was not allowed to see.
        _count_refused(d)
        return False
    stops = sum(body.stops.values())
    completed = body.ok + stops
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] no connection")
        return False
    try:
        conn.execute(_RUNS_DDL)
        conn.execute(_RUNS_TAB_DDL)
        conn.executemany(
            f"INSERT INTO {RUNS_TABLE} (day, metric, key, n) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(day, metric, key) DO UPDATE SET n = n + excluded.n",
            [(d, m, k, v) for m, k, v in _runs_rows(body)])
        if completed:
            conn.execute(
                f"INSERT INTO {RUNS_TAB_TABLE} (day, tab, runs, stops) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(day, tab) DO UPDATE SET runs = runs + excluded.runs, "
                "stops = stops + excluded.stops", (d, body.tab, completed, stops))
        if _runs_pruned_day[0] != d:
            _prune_runs(conn, d)
            _runs_pruned_day[0] = d
        conn.commit()
        return True
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] runs write failed")
        return False
    finally:
        conn.close()


@router.post("/runs")
def runs(body: RunsBody, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """⛔ Signed in AND a runtime-pane member (review M3): a member whose pane never runs the
    runtime lane has no runs to report, so their batch is answered and not stored. The id keys
    the per-member cap as a keyed hash only."""
    reason = body.violation()
    if reason is not None:
        return {"ok": False, "logged": False, "reason": reason}
    from api.services import runtime_definitions
    if not runtime_definitions.pane_permitted(user.get("role"), user.get("id")):
        return {"ok": True, "logged": False, "reason": "the runtime pane is not on for this member"}
    return {"ok": True, "logged": record_runs(body, user.get("id"))}


def _hist_quantile(hist: dict, q: float):
    """The upper edge (ms) of the bucket holding the q-quantile of a summed histogram, the
    string ">20000" for the overflow bucket, or None for an empty one."""
    total = sum(hist.values())
    if total <= 0:
        return None
    need = q * total
    seen = 0
    for key in RUN_MS_KEYS:
        seen += hist.get(key, 0)
        if seen >= need and seen > 0:
            return int(key) if key != "inf" else f">{RUN_MS_BUCKETS[-1]}"
    return f">{RUN_MS_BUCKETS[-1]}"


def wilson_upper(stops: int, runs: int, z: float = _WILSON_Z) -> Optional[float]:
    """The one-sided (95%) Wilson score UPPER bound of a stop rate; None without runs."""
    if runs <= 0:
        return None
    p = stops / runs
    den = 1 + z * z / runs
    centre = p + z * z / (2 * runs)
    margin = z * ((p * (1 - p) / runs + z * z / (4 * runs * runs)) ** 0.5)
    return min(1.0, (centre + margin) / den)


def _tabs_summary(tabs: list) -> dict:
    """Dispersion across tabs: how many, the largest tab's share of the runs, and the spread
    of per-tab stop rates (so one heavy tab is visible, and the criterion can refuse it)."""
    runs = [r for r, _s in tabs]
    total = sum(runs)
    rates = [s / r for r, s in tabs if r > 0]
    return {
        "tabs": len(tabs),
        "top_tab_share": (round(max(runs) / total, 6) if total else None),
        "tab_stop_rate_p50": (round(_pct(rates, 0.5), 6) if rates else None),
        "tab_stop_rate_p95": (round(_pct(rates, 0.95), 6) if rates else None),
        "tab_stop_rate_max": (round(max(rates), 6) if rates else None),
    }


def _summary(counts: dict, stops: dict, hist: dict, tabs: list) -> dict:
    n_stops = sum(stops.values())
    completed = counts.get("ok", 0) + n_stops
    upper = wilson_upper(n_stops, completed)
    return {
        "runs": completed, "started": counts.get("started", 0), "ok": counts.get("ok", 0),
        "stops": n_stops, "declined": counts.get("declined", 0), "dropped": counts.get("dropped", 0),
        "refused": counts.get("refused", 0),
        "stop_rate": (round(n_stops / completed, 6) if completed else None),
        "stop_rate_upper_95": (round(upper, 6) if upper is not None else None),
        "by_code": dict(sorted(stops.items(), key=lambda kv: (-kv[1], kv[0]))),
        "worker_failed": stops.get("runtime:worker-failed", 0),
        "load_failed": stops.get("runtime:load-failed", 0),
        "ms_p50_le": _hist_quantile(hist, 0.5), "ms_p95_le": _hist_quantile(hist, 0.95),
        "ms_histogram": {k: hist[k] for k in RUN_MS_KEYS if hist.get(k)},
        **_tabs_summary(tabs),
    }


def cohort_criterion(total: dict) -> dict:
    """⭐ The admins -> cohort exit gate, stated so a reader can see WHICH part fails."""
    upper = total["stop_rate_upper_95"]
    share = total["top_tab_share"]
    out = {
        "stop_rate_threshold": COHORT_STOP_RATE,
        "min_runs": COHORT_MIN_RUNS, "min_tabs": COHORT_MIN_TABS, "max_tab_share": COHORT_MAX_TAB_SHARE,
        "enough_runs": total["runs"] >= COHORT_MIN_RUNS,
        "stop_rate_under_threshold": total["stop_rate"] is not None and total["stop_rate"] < COHORT_STOP_RATE,
        "upper_bound_under_threshold": upper is not None and upper < COHORT_STOP_RATE,
        "enough_tabs": total["tabs"] >= COHORT_MIN_TABS,
        "no_tab_dominates": share is not None and share <= COHORT_MAX_TAB_SHARE,
        "no_worker_failed": total["worker_failed"] == 0,
        "no_load_failed": total["load_failed"] == 0,
        "nothing_dropped": total["dropped"] == 0 and total["refused"] == 0,
    }
    out["passes"] = all(out[k] for k in ("enough_runs", "stop_rate_under_threshold",
                                         "upper_bound_under_threshold", "enough_tabs",
                                         "no_tab_dominates", "no_worker_failed", "no_load_failed",
                                         "nothing_dropped"))
    return out


def runs_report(days: int = 14, *, today: Optional[str] = None) -> dict:
    """⭐ The cohort gate's read: per ET day and over the window, runs, stops by code, the
    stop rate and its upper bound, tab dispersion, and p50/p95 round trip. Aggregates only."""
    days = max(1, min(int(days), 90))
    end = today or _et_day()
    since = (datetime.fromisoformat(end) - timedelta(days=days - 1)).date().isoformat()
    rows: list = []
    tab_rows: list = []
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        conn = None
    if conn is not None:
        try:
            conn.execute(_RUNS_DDL)
            conn.execute(_RUNS_TAB_DDL)
            _prune_runs(conn, end)
            conn.commit()
            rows = conn.execute(f"SELECT day, metric, key, n FROM {RUNS_TABLE} WHERE day >= ? AND day <= ?",
                                (since, end)).fetchall()
            tab_rows = conn.execute(f"SELECT day, tab, runs, stops FROM {RUNS_TAB_TABLE} "
                                    "WHERE day >= ? AND day <= ?", (since, end)).fetchall()
        except Exception:  # noqa: BLE001
            log.exception("[pine-runtime-telemetry] runs report read failed")
        finally:
            conn.close()
    slot = {"count": 0, "stop": 1, "ms": 2}
    per_day: dict = {}
    tot: tuple = ({}, {}, {})
    for day, metric, key, n in rows:
        idx = slot.get(metric)
        if idx is None:
            continue
        cell = per_day.setdefault(day, ({}, {}, {}))
        for target in (cell[idx], tot[idx]):
            target[key] = target.get(key, 0) + int(n)
    day_tabs: dict = {}
    window_tabs: dict = {}
    for day, tab, r, s in tab_rows:
        day_tabs.setdefault(day, []).append((int(r), int(s)))
        cur = window_tabs.get(tab, (0, 0))
        window_tabs[tab] = (cur[0] + int(r), cur[1] + int(s))
    total = _summary(*tot, list(window_tabs.values()))
    days_out = sorted(set(per_day) | set(day_tabs), reverse=True)
    # ⭐ follow-up review L2: the criterion reads its OWN window, never longer than the tab rows are
    # kept (`RUNS_TAB_RETAIN_DAYS`): over a longer window the run sums would cover days whose tabs
    # are gone, and the tab test would grade a different sample than the rate.
    crit_days = min(days, RUNS_TAB_RETAIN_DAYS)
    crit_since = (datetime.fromisoformat(end) - timedelta(days=crit_days - 1)).date().isoformat()
    ctot: tuple = ({}, {}, {})
    for d, cell in per_day.items():
        if d < crit_since:
            continue
        for idx in range(3):
            for key, n in cell[idx].items():
                ctot[idx][key] = ctot[idx].get(key, 0) + n
    ctabs: dict = {}
    for d, tab, r, st in tab_rows:
        if d < crit_since:
            continue
        cur = ctabs.get(tab, (0, 0))
        ctabs[tab] = (cur[0] + int(r), cur[1] + int(st))
    crit_total = _summary(*ctot, list(ctabs.values()))
    return {
        "days": days, "since": since, "through": end,
        "by_day": [{"day": d, **_summary(*per_day.get(d, ({}, {}, {})), day_tabs.get(d, []))}
                   for d in days_out],
        "total": total,
        "criterion_window": {"days": crit_days, "since": crit_since, "through": end, "total": crit_total},
        "cohort_criterion": {**cohort_criterion(crit_total), "window_days": crit_days},
    }


@router.get("/runs")
def runs_read(days: int = 14, user: dict = Depends(require_admin)) -> dict:
    """The operator's read of the run count and the stop rate. ADMIN ONLY."""
    return runs_report(days)
