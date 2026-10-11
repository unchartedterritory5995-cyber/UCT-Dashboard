"""confluence_flow.py — the OPTIONS-FLOW leg of the Confluence screen (flow-worker).

Reuses weekly_flow's tested still-open engine (load_directional_trades + aggregate)
so numbers match the Open-Flow board exactly, then adds the two fields the board
never exposed: the TOP CONTRACT's premium (e["top"]["prem"]) and the LEAP SHARE
(still-open premium in contracts with DTE >= LEAP_MIN_DTE, over total).

Runs on the FLOW-WORKER (owns the live flow.db); reached from web via the proxied
/api/live/massive/confluence-flow route. Never raises.

LOAD DISCIPLINE (2026-08-31, learned the hard way): the 30d compute is ~120s and
the flow-worker also runs the live OPRA tape. So:
  - SINGLE-FLIGHT per cache key: concurrent callers (web scheduler + warmer +
    manual refresh) coalesce onto ONE compute instead of piling up and starving
    each other (which left the board stuck at 0 rows).
  - The background warmer SKIPS regular trading hours — it only recomputes
    off-hours, and the long TTL holds the result through the session, so we never
    run a heavy 30d read against flow.db while it's being written by the tape.
"""
import os
import time
import threading
from datetime import date, datetime

from api import weekly_flow as wf

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001
    _ET = None

LEAP_MIN_DTE = int(os.environ.get("CONFLUENCE_LEAP_MIN_DTE", "180"))
# 6h TTL so a result computed off-hours (pre-market / post-close) is still valid
# through the whole trading session — nothing recomputes during RTH.
_TTL = float(os.environ.get("CONFLUENCE_FLOW_TTL", "21600"))
_CACHE: dict = {}
_KEY_LOCKS: dict = {}
_LOCKS_GUARD = threading.Lock()


def _key_lock(ckey) -> threading.Lock:
    with _LOCKS_GUARD:
        lk = _KEY_LOCKS.get(ckey)
        if lk is None:
            lk = _KEY_LOCKS[ckey] = threading.Lock()
        return lk


def _is_rth() -> bool:
    """True during US regular trading hours (Mon-Fri 9:30-16:00 ET)."""
    if _ET is None:
        return False
    now = datetime.now(_ET)
    if now.weekday() >= 5:
        return False
    mins = now.hour * 60 + now.minute
    return (9 * 60 + 30) <= mins <= (16 * 60)


def _leap_premium(contracts: dict, ref: date) -> float:
    lp = 0.0
    for c in contracts.values():
        d = wf._parse_mdy(c.get("exp", ""))
        if d and (d - ref).days >= LEAP_MIN_DTE:
            lp += c.get("prem", 0.0) or 0.0
    return lp


def _compute(days: int, min_dte: int, cap: str, frac: float) -> dict:
    trades, window = wf.load_directional_trades(
        days, min_dte, cap, min_premium=wf._BOARD_MIN_PREMIUM)
    agg = wf.aggregate(trades, top_n=10 ** 9, still_open_frac=frac)
    ref = date.today()
    names: dict = {}
    for e in agg["bulls"] + agg["bears"]:
        tot = (e["bull"] or 0) + (e["bear"] or 0)
        lp = _leap_premium(e.get("contracts") or {}, ref)
        tc = e.get("top") or {}
        names[e["sym"]] = {
            "net": e["net"], "bull": e["bull"], "bear": e["bear"],
            "bullPct": e["bullPct"],
            "top": {
                "cp": tc.get("cp"), "strike": tc.get("K"), "exp": tc.get("exp"),
                "dte": wf._dte_of(tc.get("exp"), ref) if tc.get("exp") else None,
                "prem": round(tc.get("prem", 0.0) or 0.0, 2),
            },
            "leap_prem": round(lp, 2),
            "leap_share": round(lp / tot, 4) if tot else 0.0,
            "since": e["first"].isoformat() if e.get("first") else None,
        }
    return {"ok": True, "window": window, "days": days, "cap": cap,
            "n_names": len(names), "names": names}


# ⛔ AN EXPIRED LEG IS SERVED, NOT RECOMPUTED ON THE REQUEST (2026-10-11). Measured in the pod:
# a 30d leg is ~100 s, and every call past the 6 h TTL paid it inline (the direct route took
# 99 s on a Sunday). Past the TTL the last good leg is returned at once -- within
# `_STALE_MAX` -- and ONE rebuild runs behind it, off-hours only (the RTH rule above still
# holds: during the session the stale leg simply keeps serving). The newest good leg is also
# persisted next to flow.db (weekly_flow.persisted_json_*), so a redeploy answers from disk.
# The numbers are the same `_compute`; `built_at` says how old a served leg is.
_STALE_MAX = float(os.environ.get("CONFLUENCE_FLOW_STALE_MAX", "259200"))


def _leg_name(ckey) -> str:
    days, min_dte, cap, frac = ckey
    safe_cap = "".join(c for c in cap if c.isalnum() or c == "_")
    return "confluence_%s_%s_%s_%s" % (int(days), int(min_dte), safe_cap, frac)


def _build_locked(ckey) -> dict:
    """Compute, cache and persist one key. The CALLER holds `_key_lock(ckey)`."""
    days, min_dte, cap, frac = ckey
    with wf.SCAN_SLOT:
        at = time.time()
        res = _compute(days, min_dte, cap, frac)
    res["built_at"] = round(at, 3)
    _CACHE[ckey] = (at, res)
    wf.persisted_json_put(_leg_name(ckey), at, res)
    return res


#: A caller with nothing to serve waits this long for the build, then hears "computing" (the
#: web join already treats that reason as "the worker is still BUILDING this leg").
_COLD_WAIT = float(os.environ.get("CONFLUENCE_FLOW_COLD_WAIT", "25"))
_INFLIGHT: dict = {}
_ERRORS: dict = {}


def _spawn_refresh(ckey):
    """Rebuild one key behind the caller; None when it is already building, else the Event set
    when this build ends."""
    lk = _key_lock(ckey)
    if not lk.acquire(blocking=False):
        return None
    done = threading.Event()
    _INFLIGHT[ckey] = done
    _ERRORS.pop(ckey, None)

    def _run():
        try:
            _build_locked(ckey)
        except Exception as e:  # noqa: BLE001 -- the stale leg keeps serving
            _ERRORS[ckey] = str(e)
        finally:
            lk.release()
            done.set()

    threading.Thread(target=_run, name="confluence-flow-refresh", daemon=True).start()
    return done


def flow_leg(*, days: int = 30, min_dte: int = 30, cap: str = "all",
             frac: float = 0.75) -> dict:
    """Per-ticker options-flow leg. Single-flight per key; serves the cached
    result (fresh, or past its TTL while one off-hours rebuild runs behind it, or
    -- while a recompute holds the lock -- the last one)."""
    days, cap = wf.clamp_scan_params(days, cap)   # an unbounded `days` is a whole-table scan
    ckey = (days, min_dte, cap, frac)
    now = time.time()
    hit = _CACHE.get(ckey)
    if hit is None:
        disk = wf.persisted_json_get(_leg_name(ckey))
        if disk is not None:
            hit = _CACHE[ckey] = disk
    if hit and now - hit[0] < _TTL:
        return hit[1]
    if hit and now - hit[0] < _STALE_MAX:
        if not _is_rth():
            _spawn_refresh(ckey)
        return hit[1]
    # Nothing servable: start (or join) the one build and wait a bounded time for it -- never
    # a duplicate, never the whole ~100 s (minutes on a cold pod) on the request.
    ev = _spawn_refresh(ckey) or _INFLIGHT.get(ckey)
    if ev is not None:
        ev.wait(_COLD_WAIT)
    again = _CACHE.get(ckey)
    if again and time.time() - again[0] < _STALE_MAX:
        return again[1]
    if hit:
        return hit[1]
    err = _ERRORS.get(ckey)
    if err is not None:
        return {"ok": False, "reason": f"error: {err}", "names": {}}
    return {"ok": False, "reason": "computing", "names": {}}


# ── Background warmer (OFF-HOURS ONLY) ────────────────────────────────────────
def _warm_one(days: int, cap: str, min_dte: int = 30, frac: float = 0.75) -> None:
    """Rebuild one key IN THIS THREAD when it is past its TTL (serially, never four at once --
    `flow_leg` itself would hand an expired key to a background thread and return)."""
    ckey = (days, min_dte, cap, frac)
    hit = _CACHE.get(ckey)
    if hit is None:
        disk = wf.persisted_json_get(_leg_name(ckey))
        if disk is not None:
            hit = _CACHE[ckey] = disk
    if hit and time.time() - hit[0] < _TTL:
        return
    lk = _key_lock(ckey)
    if not lk.acquire(blocking=False):
        return
    try:
        _build_locked(ckey)
    except Exception:  # noqa: BLE001
        pass
    finally:
        lk.release()


def warm_all() -> None:
    for cap in ("large", "mid_small"):
        _warm_one(30, cap)
        _warm_one(5, cap)


def _warm_loop(interval: float) -> None:
    while True:
        try:
            if not _is_rth():          # never run the heavy 30d read during RTH
                warm_all()
        except Exception:  # noqa: BLE001
            pass
        time.sleep(interval)


def start_background_warm(interval: float = 1800.0) -> None:
    """Spawn the off-hours warm loop (daemon). Fast to call. Gated by
    CONFLUENCE_WARM_ENABLED (default on) so it can be killed via env, no deploy."""
    if os.environ.get("CONFLUENCE_WARM_ENABLED", "1") != "1":
        return
    threading.Thread(target=_warm_loop, args=(interval,), daemon=True,
                     name="confluence-flow-warm").start()
