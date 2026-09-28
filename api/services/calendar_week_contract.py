# api/services/calendar_week_contract.py — TERM-030 / FB-A5-02.
"""The ONE shape assertion for the `/api/calendar` week contract.

THE PROBLEM, in one sentence
────────────────────────────
Server-side consumers read the week payload (`get_calendar()`, the raw
`calendar_weekly` cache entry, `_get_or_build_range_week()`) with bare
`.get()` chains, so a change to the contract — `sym` renamed, `days`
reshaped — does not fail anywhere: every `.get()` returns None, every loop
runs zero times, and the reader reports *"no reporters this week"*. An empty
week and a broken week were the same answer (PROD-4; TD-37; ledger E1).

WHAT THIS DOES
──────────────
`week_days(payload, reader=...)` returns `payload["days"]` after checking the
parts every reader actually depends on, and raises `WeekContractViolation`
naming the READER and the KEY PATH when one is wrong.

⛔ ABSENT IS NOT MALFORMED. `payload is None` — a cold cache, a failed build —
returns None, untouched: each reader already has its own absent path (fall
through to Finnhub, skip the week, return "no cross-check") and this module
does not second-guess it. Only a payload that EXISTS and has the wrong shape
is a violation. That is the distinction the bare `.get()` chain could not make.

⛔ ONE ASSERTION, NOT ONE PER READER (*a guard repeated is a guard unproved*).
Every reader calls this function; none restates the shape. The reader
population is DERIVED by `tests/test_calendar_week_contract.py` from the
source (every function outside `api/routers/calendar.py` that consumes a week
door), so a new reader that skips this call fails that rail by name.
⚠️ One named reader does NOT call it yet: `calendar_alerts`, whose source S7's
event-proximity comparison pins byte-identical to origin/master. The rail
lists it as FROZEN, and that exemption expires the day the freeze does.

FAILURE MODE — loud, but the reader's own wrapper still decides the member's page
────────────────────────────────────────────────────────────────────────────────
Before raising, a violation is (1) counted per reader (`violation_counts()`),
(2) logged at ERROR, and (3) emitted to the ops-class sink
(`chart_health_alerts.emit`, TERM-011 step 3's OPS destination) at WARNING —
which lands in the admin alert feed and does NOT page. The raise then travels
through whatever error handling the reader already had: a background job
aborts or records an error instead of reporting an empty week; a member route
whose handler already says "never raises" keeps saying so. This module adds
no new way for a member request to 500.

Not a rename of anything: the `calendar` plumbing, `/api/calendar/*`, the
`calendar_weekly` cache key and every persisted pref are untouched.
"""
from __future__ import annotations

import logging
import threading

_log = logging.getLogger(__name__)

#: The earnings session buckets every day in the contract carries. The
#: builders (`_empty_day`, `_build_live`, `_build_range_week`) emit all three.
BUCKETS = ("bmo", "amc", "tbd")

#: The subset a day MUST carry. `tbd` was added to the contract later than the
#: other two and is tolerated when absent (readers already default it); a
#: present `tbd` is still checked exactly like the others.
REQUIRED_BUCKETS = ("bmo", "amc")


class WeekContractViolation(ValueError):
    """A week payload that exists but does not have the contract's shape."""

    def __init__(self, reader: str, path: str, problem: str):
        self.reader = reader
        self.path = path
        self.problem = problem
        super().__init__(f"week contract violated in {reader}: {path} {problem}")


_counts: dict[str, int] = {}
_counts_lock = threading.Lock()


def violation_counts() -> dict[str, int]:
    """{reader: violations since process start}. A copy — callers cannot mutate it."""
    with _counts_lock:
        return dict(_counts)


def _reset_violation_counts() -> None:
    """Test hook."""
    with _counts_lock:
        _counts.clear()


def _violation(reader: str, path: str, problem: str) -> WeekContractViolation:
    exc = WeekContractViolation(reader, path, problem)
    with _counts_lock:
        _counts[reader] = _counts.get(reader, 0) + 1
    _log.error("[week-contract] %s", exc)
    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit(
            f"calendar_week_contract:{reader}", "warning", str(exc),
            {"reader": reader, "path": path},
        )
    except Exception:  # noqa: BLE001 -- observability must never mask the raise
        pass
    return exc


def week_days(payload, *, reader: str) -> dict | None:
    """`payload["days"]`, shape-checked. None in → None out (absent, not malformed).

    Raises `WeekContractViolation` naming `reader` and the first bad key path.
    """
    if payload is None:
        return None
    if not isinstance(payload, dict):
        raise _violation(reader, "payload", f"is {type(payload).__name__}, not a dict")
    if "days" not in payload:
        raise _violation(reader, "days", "is missing")
    days = payload["days"]
    if not isinstance(days, dict):
        raise _violation(reader, "days", f"is {type(days).__name__}, not a dict")
    for ds, day in days.items():
        if not isinstance(day, dict):
            raise _violation(reader, f"days[{ds}]", f"is {type(day).__name__}, not a dict")
        for bucket in BUCKETS:
            if bucket not in day:
                if bucket in REQUIRED_BUCKETS:
                    raise _violation(reader, f"days[{ds}].{bucket}", "is missing")
                continue
            entries = day[bucket]
            if not isinstance(entries, list):
                raise _violation(reader, f"days[{ds}].{bucket}",
                                 f"is {type(entries).__name__}, not a list")
            for i, entry in enumerate(entries):
                if not isinstance(entry, dict) or not isinstance(entry.get("sym"), str):
                    raise _violation(reader, f"days[{ds}].{bucket}[{i}].sym",
                                     "is missing or not a string")
    return days
