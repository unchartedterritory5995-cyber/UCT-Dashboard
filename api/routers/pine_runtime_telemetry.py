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
#     started, ok, declined     integers
#     stops                     {code: n}: a `STOP_GUARDS` code, or `runtime:limit:<LIMIT_NAME>`
#     ms                        {bucket: n}: the round-trip histogram, `RUN_MS_BUCKETS` upper
#                               edges (ms) plus `inf`
#
# ⛔⛔ NO SOURCE, NO HASH, NO MEMBER ID: a batch is integers under closed keys, and it is
# AGGREGATED on arrival into `pine_runtime_run_daily(day, metric, key, n)`: per ET day, per
# code, summed. No row says who, or which script. Every key is re-checked here against the
# closed sets (an unknown key refuses the WHOLE batch), every value is a strict int in
# 1..`RUNS_MAX_PER_FIELD`, and an unknown field is a 422. The same two durable daily caps the
# other beacons use bound how many batches one member (keyed hash, `member_subject`) and
# everyone may land per day; over either, the batch is answered and not stored.
#
# The admin read (`GET /runs`) gives the stop rate per day: stops / runs, where runs = ok +
# stops + declined (every answered run), with p50/p95 round trip read off the SUMMED
# histogram (an upper edge: "p95 <= 300 ms"), and the cohort criterion stated as booleans.

RUNS_SCOPE = "pine_runtime_runs"
RUNS_DAILY_CAP = 50_000           # batches, global, per ET day
RUNS_MEMBER_DAILY_CAP = 1_500     # batches, per member, per ET day (one a minute is 1,440)
RUNS_MAX_PER_FIELD = 10_000
RUNS_RETAIN_DAYS = 400
RUN_TELEMETRY_ENV = "PINE_RUNTIME_RUN_TELEMETRY"
#: Pinned to the client's `RUN_MS_BUCKETS` by the rail.
RUN_MS_BUCKETS = (1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700, 1000,
                  1500, 2000, 3000, 5000, 10000, 20000)
RUN_MS_KEYS = tuple(str(b) for b in RUN_MS_BUCKETS) + ("inf",)
RUN_COUNT_KEYS = ("started", "ok", "declined")
COHORT_STOP_RATE = 0.02
RUNS_TABLE = "pine_runtime_run_daily"
_RUNS_DDL = (f"CREATE TABLE IF NOT EXISTS {RUNS_TABLE} (day TEXT NOT NULL, metric TEXT NOT NULL, "
             "key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, metric, key))")
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

    started: int = Field(0, ge=0, le=RUNS_MAX_PER_FIELD, strict=True)
    ok: int = Field(0, ge=0, le=RUNS_MAX_PER_FIELD, strict=True)
    declined: int = Field(0, ge=0, le=RUNS_MAX_PER_FIELD, strict=True)
    stops: dict[Annotated[str, Field(max_length=64)], _Count] = Field(default_factory=dict, max_length=32)
    ms: dict[Annotated[str, Field(max_length=8)], _Count] = Field(default_factory=dict,
                                                                  max_length=len(RUN_MS_KEYS))

    def violation(self) -> Optional[str]:
        for code in self.stops:
            if not run_stop_code_ok(code):
                return "a stop code is not a declared runtime stop"
        for key in self.ms:
            if key not in RUN_MS_KEYS:
                return "a histogram key is not a declared bucket"
        answered = self.ok + self.declined + sum(self.stops.values())
        if sum(self.ms.values()) > answered:
            return "the histogram counts more runs than were answered"
        if not (answered or self.started):
            return "the batch is empty"
        return None


def _runs_rows(body: RunsBody) -> list:
    rows = [("count", k, getattr(body, k)) for k in RUN_COUNT_KEYS if getattr(body, k)]
    rows += [("stop", k, v) for k, v in sorted(body.stops.items())]
    rows += [("ms", k, v) for k, v in sorted(body.ms.items())]
    return rows


def record_runs(body: RunsBody, user_id: Any = None, *, day: Optional[str] = None) -> bool:
    """Aggregate one batch into the day's per-code sums. True when stored. Never raises."""
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
        return False
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        log.exception("[pine-runtime-telemetry] no connection")
        return False
    try:
        conn.execute(_RUNS_DDL)
        conn.executemany(
            f"INSERT INTO {RUNS_TABLE} (day, metric, key, n) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(day, metric, key) DO UPDATE SET n = n + excluded.n",
            [(d, m, k, v) for m, k, v in _runs_rows(body)])
        if _runs_pruned_day[0] != d:
            cutoff = (datetime.fromisoformat(d) - timedelta(days=RUNS_RETAIN_DAYS)).date().isoformat()
            conn.execute(f"DELETE FROM {RUNS_TABLE} WHERE day < ?", (cutoff,))
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
    """⛔ Signed in, as `/stop`. The member's id keys the per-member cap as a keyed hash only."""
    reason = body.violation()
    if reason is not None:
        return {"ok": False, "logged": False, "reason": reason}
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


def _summary(counts: dict, stops: dict, hist: dict) -> dict:
    n_stops = sum(stops.values())
    answered = counts.get("ok", 0) + counts.get("declined", 0) + n_stops
    return {
        "runs": answered, "started": counts.get("started", 0), "ok": counts.get("ok", 0),
        "declined": counts.get("declined", 0), "stops": n_stops,
        "stop_rate": (round(n_stops / answered, 6) if answered else None),
        "by_code": dict(sorted(stops.items(), key=lambda kv: (-kv[1], kv[0]))),
        "worker_failed": stops.get("runtime:worker-failed", 0),
        "load_failed": stops.get("runtime:load-failed", 0),
        "ms_p50_le": _hist_quantile(hist, 0.5), "ms_p95_le": _hist_quantile(hist, 0.95),
        "ms_histogram": {k: hist[k] for k in RUN_MS_KEYS if hist.get(k)},
    }


def runs_report(days: int = 14, *, today: Optional[str] = None) -> dict:
    """⭐ The cohort gate's read: per ET day and over the window, runs, stops by code, the
    stop rate, and p50/p95 round trip. Aggregates only."""
    days = max(1, min(int(days), 90))
    end = today or _et_day()
    since = (datetime.fromisoformat(end) - timedelta(days=days - 1)).date().isoformat()
    rows: list = []
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        conn = None
    if conn is not None:
        try:
            conn.execute(_RUNS_DDL)
            rows = conn.execute(f"SELECT day, metric, key, n FROM {RUNS_TABLE} WHERE day >= ? AND day <= ?",
                                (since, end)).fetchall()
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
    total = _summary(*tot)
    return {
        "days": days, "since": since, "through": end,
        "by_day": [{"day": d, **_summary(*per_day[d])} for d in sorted(per_day, reverse=True)],
        "total": total,
        "cohort_criterion": {
            "stop_rate_threshold": COHORT_STOP_RATE,
            "has_runs": total["runs"] > 0,
            "stop_rate_under_threshold": (total["stop_rate"] is not None
                                          and total["stop_rate"] < COHORT_STOP_RATE),
            "no_worker_failed": total["worker_failed"] == 0,
            "no_load_failed": total["load_failed"] == 0,
        },
    }


@router.get("/runs")
def runs_read(days: int = 14, user: dict = Depends(require_admin)) -> dict:
    """The operator's read of the run count and the stop rate. ADMIN ONLY."""
    return runs_report(days)
