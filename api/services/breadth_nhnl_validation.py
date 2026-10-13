"""Option B for new highs / lows (owner, 2026-10-12): VALIDATE the provisional NH/NL the live
engine publishes after the close against the same session's SETTLED intraday-basis series, and
promote the family out of `breadth_current.UNVALIDATED_LIVE` only if it passes.

⭐ WHY FORWARD CAPTURE. The provisional NH/NL at the close was never stored: the live payload is
recomputed every minute, and `_record_intraday` keeps four sessions and only regular-hours
samples. A replay is no substitute. The provisional differs from the settled series only by the
snapshot's running day high/low (vs the session's final daily-bar high/low), membership and
same-day splits. Replaying from daily bars reproduces the settled value nearly by construction.
So the live engine's own tick records, per session and universe, the FIRST provisional NH/NL row
it would serve after the close: exactly what the Agent and the charts would show.

SAME BASIS ON BOTH SIDES. Provisional = `breadth_live_universes._apply_nhnl` (`live_counts`:
snapshot high/low vs the ring's prior windows). Settled = `breadth_nhnl_intraday.values(u, D)`
once the series settles D (close + `SETTLE_MINUTES_AFTER_CLOSE`).

⛔ VALUE-FREE OUTSIDE THIS MODULE. The capture file holds counts because grading needs them.
`report()` returns only session counts, pass/fail, tolerance-multiple buckets, dates and times.

THE BAR (owner-explicit, proposed by the Agent team and adopted 2026-10-12), per universe ×
measure:
  counts (highs / lows, 52-week and 20-day)  |prov − settled| ≤ max(3, 2% of settled)
  net highs − lows                           ≤ max(5, 3% of settled highs + lows)
  hi / lo ratio (% of universe)              ≤ 0.1 pt
  PASS = ≥ MIN_SESSIONS graded AND ≥ 95% within tolerance AND none beyond 3× AND every session
         whose close observation was stale / unstamped was WITHHELD (no value captured).
A FAIL keeps that universe/measure finalized-only. Promotion is a separate, owner-approved edit of
`breadth_current.UNVALIDATED_LIVE`; nothing here changes a tier.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import date, datetime
from typing import Callable, Optional

_log = logging.getLogger("breadth_nhnl_validation")

UNIVERSES = ("us", "nyse", "nasdaq")
MEASURES = ("new_52w_highs", "new_52w_lows", "net_new_high_low", "new_20d_highs",
            "new_20d_lows", "hi_ratio", "lo_ratio")
MIN_SESSIONS = 20
PASS_SHARE = 0.95
MAX_MULTIPLE = 3.0
KEEP_SESSIONS = 120
PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "breadth_nhnl_provisional.json")
_lock = threading.Lock()


def _path() -> str:
    return os.environ.get("BREADTH_NHNL_VALIDATION_PATH") or PATH


def _load() -> dict:
    try:
        with open(_path()) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _save(store: dict) -> None:
    keep = dict(sorted(store.items())[-KEEP_SESSIONS:])
    tmp = _path() + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(keep, fh, separators=(",", ":"))
    os.replace(tmp, _path())


# ── capture (called from the live engine's tick, after the close) ───────────────────────────

def capture(payload: Optional[dict], now: datetime) -> dict:
    """Record, once per session and universe, the first provisional NH/NL row after the close,
    or WITHHELD (+ reason) when the close observation is stale / unstamped. Only on a trading day,
    at or after its close. Never raises; returns what it recorded."""
    try:
        from api.services import breadth_current as bc
        from api.services import session_calendar as sc
        d = now.date()
        close = sc.close_time(d)
        if close is None or now < close:
            return {"captured": [], "reason": "not after a session close"}
        today = d.isoformat()
        p = payload or {}
        done = []
        with _lock:
            store = _load()
            before = json.dumps(store.get(today), sort_keys=True)
            day = store.setdefault(today, {})
            for u in UNIVERSES:
                if u in day and day[u].get("status") == "provisional":
                    continue                       # the FIRST provisional observation stands
                uv = (p.get("universes") or {}).get(u) or {}
                row = next((r for r in uv.get("rows") or []
                            if r.get("date") == today and not r.get("final")), None)
                if not uv.get("ok") or row is None:
                    day.setdefault(u, {"status": "absent", "seen_at": now.isoformat(timespec="seconds"),
                                       "reason": (uv.get("reason") or p.get("reason")
                                                  or "no live row for the session")})
                    continue
                obs = bc.row_observation(p, row, now)
                rec = {"seen_at": now.isoformat(timespec="seconds"),
                       "data_as_of": obs["observed"].isoformat() if obs["observed"] else None,
                       "carried": bool(p.get("carried"))}
                if obs["status"] == "provisional":
                    m = row.get("metrics") or {}
                    vals = {k: m.get(k) for k in MEASURES}
                    if all(v is None for v in vals.values()):
                        rec.update(status="absent", reason="provisional row carries no NH/NL")
                    else:
                        rec.update(status="provisional", values=vals)
                else:
                    rec.update(status="withheld", reason=obs["reason"] or "close not yet observed")
                day[u] = rec
                done.append((u, rec["status"]))
            if json.dumps(store.get(today), sort_keys=True) != before:
                _save(store)                     # only when this session's record changed
        return {"captured": done}
    except Exception as e:                         # noqa: BLE001 - a capture must never break a tick
        _log.warning("[nhnl-validation] capture failed: %s", e)
        return {"captured": [], "error": f"{type(e).__name__}: {e}"}


# ── grading ─────────────────────────────────────────────────────────────────────────────────

def tolerance(measure: str, settled: dict) -> float:
    if measure in ("hi_ratio", "lo_ratio"):
        return 0.1
    if measure == "net_new_high_low":
        hl = (settled.get("new_52w_highs") or 0) + (settled.get("new_52w_lows") or 0)
        return max(5.0, 0.03 * hl)
    return max(3.0, 0.02 * abs(settled.get(measure) or 0))


def _settled_values(universe: str, d: str) -> Optional[dict]:
    from api.services import breadth_nhnl_intraday as nhi
    return nhi.values(universe, d)


def grade(store: Optional[dict] = None, settled: Callable = _settled_values) -> dict:
    """Value-free verdict per universe × measure over every captured session the series has
    settled. Sessions whose close observation was stale / unstamped are checked for WITHHELD."""
    store = _load() if store is None else store
    out: dict = {"universes": {}, "min_sessions": MIN_SESSIONS}
    for u in UNIVERSES:
        per = {m: {"graded": 0, "within": 0, "buckets": {"<=1x": 0, "1-2x": 0, "2-3x": 0, ">3x": 0},
                   "failing_sessions": []} for m in MEASURES}
        withheld = absent = pending = 0
        bad_withhold = []
        for d in sorted(store):
            rec = (store[d] or {}).get(u)
            if not rec:
                continue
            st = rec.get("status")
            if st == "withheld":
                withheld += 1
                continue
            if st != "provisional":
                absent += 1
                continue
            sv = settled(u, d)
            if sv is None:
                pending += 1                       # the series has not settled this session yet
                continue
            if rec.get("data_as_of") is None:
                bad_withhold.append(d)             # a value captured without a vendor data time
            for m in MEASURES:
                pv, s = (rec.get("values") or {}).get(m), sv.get(m)
                if pv is None or s is None:
                    continue
                tol = tolerance(m, sv)
                mult = abs(float(pv) - float(s)) / tol if tol else 0.0
                g = per[m]
                g["graded"] += 1
                g["within"] += mult <= 1.0
                g["buckets"]["<=1x" if mult <= 1 else "1-2x" if mult <= 2 else "2-3x" if mult <= 3 else ">3x"] += 1
                if mult > 1.0:
                    g["failing_sessions"].append(d)
        verdicts = {}
        for m, g in per.items():
            share = g["within"] / g["graded"] if g["graded"] else 0.0
            reasons = []
            if g["graded"] < MIN_SESSIONS:
                reasons.append(f"only {g['graded']} of {MIN_SESSIONS} sessions graded")
            if g["graded"] and share < PASS_SHARE:
                reasons.append(f"{share:.0%} within tolerance (< {PASS_SHARE:.0%})")
            if g["buckets"][">3x"]:
                reasons.append(f"{g['buckets']['>3x']} session(s) beyond {MAX_MULTIPLE:g}× tolerance")
            if bad_withhold:
                reasons.append(f"{len(bad_withhold)} value(s) captured without a vendor data time")
            verdicts[m] = {"pass": not reasons, "graded": g["graded"], "within": g["within"],
                           "share_within": round(share, 3), "buckets": g["buckets"],
                           "failing_sessions": g["failing_sessions"][-10:], "reasons": reasons}
        out["universes"][u] = {"withheld_sessions": withheld, "absent_sessions": absent,
                               "pending_settlement": pending, "measures": verdicts}
    return out


def report() -> dict:
    """The value-free status the ops route serves: capture coverage + the current verdict."""
    store = _load()
    times = []
    for d in sorted(store)[-10:]:
        for u, rec in (store[d] or {}).items():
            times.append({"date": d, "universe": u, "status": rec.get("status"),
                          "seen_at": rec.get("seen_at"), "data_as_of": rec.get("data_as_of")})
    return {"sessions_captured": len(store), "recent": times, "grade": grade(store)}
