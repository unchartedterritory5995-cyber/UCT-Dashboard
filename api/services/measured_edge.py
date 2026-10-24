"""The "Measured edge" badge: the ONE authority on which drawing types may carry it.

Owner decision 2 (chart pattern product decisions, 2026-10-24): drawing and asserting are separate permissions. A
drawing may be shown because it describes structure; a badge is an assertion, and only the outcome replay against a
plain 20-day-high breakout in the same stock grants it. A type earns the chip only when its lift held on the
out-of-sample (held-out) period.

MEASURED_EDGE maps a member row's `pattern_id` to its measured facts:
    lift_pp     float  the hit-rate lift over the matched breakout baseline, in percentage points (> 0)
    ci          [lo, hi] the 95% interval of that lift, in percentage points
    n           int    the number of setups the lift was measured on (>= 1)
    period      str    the replay period, e.g. "2023-2026"
    holdout     bool   True only when the held-out check passed (the chip is never served without it)
    method_url  str    the in-app method page ("/methodology/measured-edge")

⛔ IT STARTS EMPTY. The edges are being re-measured on current master; the list is filled from those results in a
later commit, one reviewed entry per type. A type not listed carries nothing (no chip, no "no edge" chip).

The member payload carries `measured_edge` on a row only for a listed type (`with_badges`). A malformed entry serves
nothing (fail closed). A bearish (caution-layer) row is never badged: there is no replay edge for any bearish type.
The client renders the chip and the tooltip from these facts (app/src/components/chart/measuredEdge.js); the words
"confidence" and "probability" never appear on it.
"""
from __future__ import annotations

import math

#: pattern_id -> {lift_pp, ci, n, period, holdout, method_url}. EMPTY until the re-measured edges land.
MEASURED_EDGE: dict = {}

#: The in-app page that explains the replay (app route).
METHOD_URL = "/methodology/measured-edge"

_KEYS = ("lift_pp", "ci", "n", "period", "holdout", "method_url")


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(float(x))


def badge_for(pattern_id):
    """The served badge for one type, or None. Read PER CALL (a test can move the list). Fail closed: an entry
    missing a key, with a non-positive lift, no passed holdout, a bad interval or count, or a method link that is
    not an in-app path serves nothing."""
    e = MEASURED_EDGE.get(pattern_id) if isinstance(MEASURED_EDGE, dict) else None
    if not isinstance(e, dict) or any(k not in e for k in _KEYS):
        return None
    lift, ci, n, period, holdout, url = (e[k] for k in _KEYS)
    if not (_finite(lift) and float(lift) > 0):
        return None
    if not (isinstance(ci, (list, tuple)) and len(ci) == 2 and all(_finite(v) for v in ci)
            and float(ci[0]) <= float(lift) <= float(ci[1])):
        return None
    if not (type(n) is int and n >= 1):
        return None
    if not (isinstance(period, str) and period.strip()):
        return None
    if holdout is not True:
        return None
    if not (isinstance(url, str) and url.startswith("/") and not url.startswith("//")):
        return None
    return {"lift_pp": round(float(lift), 1), "ci": [round(float(ci[0]), 1), round(float(ci[1]), 1)],
            "n": n, "period": period.strip(), "holdout": True, "method_url": url}


def with_badges(rows):
    """`rows` with `measured_edge` set on each row of a listed type and removed from every other row (so no badge
    reaches a member from anywhere but this list). A bearish row is never badged. Rows are copied, never modified;
    a non-list passes through unchanged."""
    if not isinstance(rows, list):
        return rows
    out = []
    for r in rows:
        if not isinstance(r, dict):
            out.append(r)
            continue
        b = None if r.get("direction") == "bearish" else badge_for(r.get("pattern_id"))
        if b is None:
            if "measured_edge" in r:
                r = {k: v for k, v in r.items() if k != "measured_edge"}
            out.append(r)
        else:
            out.append({**r, "measured_edge": b})
    return out


def badge_payload(payload: dict) -> dict:
    """Apply with_badges to every drawing list a patterns payload carries (detections, structures, setup_draws).
    Returns the same dict, updated in place. Never raises."""
    try:
        for k in ("detections", "structures", "setup_draws"):
            if isinstance(payload.get(k), list):
                payload[k] = with_badges(payload[k])
    except Exception:  # noqa: BLE001 -- a badge never breaks a read
        pass
    return payload
