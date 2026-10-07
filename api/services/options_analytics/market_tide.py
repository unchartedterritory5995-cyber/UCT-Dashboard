"""FT-056 Market Tide: market-wide net options premium, minute by minute, from OUR flow tape.

WHAT IT MEASURES (computed, ours)
  For every print on the tape for one session, the premium is signed by where it traded:
    * a CALL at the ask (Side A / AA) adds to net call premium; at the bid (B / BB) subtracts.
    * a PUT  at the ask adds to net put premium;  at the bid subtracts.
  Prints with any other Side (mid, unknown) are counted and NAMED, never signed.
  Per minute (ET, from the print's own CreatedTime) we return the minute's net call and net put
  premium and the running totals. `net` = net call - net put: rising = bullish premium.

WHERE IT COMES FROM
  The flow tape, read server-side over `/api/flow/data?days=1` (stocks) and
  `/api/flow/indexes-data?days=1` (ETFs and indexes) with the SERVICE credential
  (`flow_proxy.internal_read_headers`), never a member's cookie. A one-day read is below the
  route's cap threshold (`FLOW_CSV_CAP_DAYS`), so it is the session's whole tape.
⛔ THE TAPE'S OWN FILTERS ARE STATED ON EVERY ANSWER (`TAPE_FILTERS`): it holds prints of 50+
  contracts and $10K+ premium only. This is the tide of THOSE prints, not of all option volume.
⛔ A FAILED READ IS NAMED, NEVER A QUIET TAPE. A source that could not be read is listed in
  `sources` as failed and the answer is `partial`; if both fail the route says 503.
⛔ OFF THE REQUEST PATH WHERE IT CAN BE. One build per `TTL_S`; concurrent callers share one
  build (a lock); a stale answer is served immediately while one background thread refreshes it.
⛔ DARK behind OPTIONS_MARKET_TIDE_ENABLED (api/services/options_analytics/flags.py).
⛔ L3 (live test 2026-10-05): THE SESSION IS TODAY'S ONCE TODAY'S SESSION HAS OPENED. `days=1` on
  the tape means "the last trading day the partition HOLDS", so a scope with no prints today
  (scope=etfs on Monday 10-05) silently tided Friday and called it current. After 09:30 ET on a
  trading day the answer is `session` = today -- with zero minutes and `session_status`
  "no_prints_today" plus `latest_session_on_tape` when the tape has nothing for today. Before
  the open (or on a non-trading day) the last session is served labelled "prior_session".
⛔ L2 (live test 2026-10-05): `computed_at` is when WE built, not how far the TAPE runs. The tape
  route serves its own cached CSV while it rebuilds (stale-while-revalidate behind ONE build lock
  per process, `api/flow_router.py::_get_cached_or_build`), so a build at 15:27 could tide a body
  that ended at 15:07. Every answer now carries `data_through` (the last minute tided) and the
  tape's `X-Flow-Version` per source; in RTH, a tape more than TAPE_BEHIND_S behind the clock is
  named in `partial_reasons` and the build is retried after RETRY_BEHIND_S instead of TTL_S. A
  refresh that fails is recorded (`refresh_error`) instead of being swallowed.
"""
from __future__ import annotations

import csv
import datetime as _dt
import os
import threading
import time
from typing import Callable, Iterable, Optional
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
TTL_S = 60.0
TAPE_BEHIND_S = 300        # in RTH, a tape whose newest print is older than this is "behind"
RETRY_BEHIND_S = 15.0      # ... and the tide is rebuilt this soon instead of after TTL_S
READ_TIMEOUT_S = 45.0
TAPE_FILTERS = ("The flow tape records option prints of 50+ contracts and $10K+ premium; "
                "smaller prints are not on it and are not in this tide.")
METHOD = ("Each print's premium is signed by its side: calls bought at the ask (A/AA) add to "
          "net call premium and calls sold at the bid (B/BB) subtract; puts likewise for net "
          "put premium. Prints at the mid or with no side are counted, not signed. Minutes are "
          "Eastern time, from each print's own timestamp. Net = net call - net put.")
SOURCES = {"stocks": "/api/flow/data", "etfs": "/api/flow/indexes-data"}
SCOPES = ("all", "stocks", "etfs")
_ASK = ("A", "AA")
_BID = ("B", "BB")


# ── parsing ─────────────────────────────────────────────────────────────────────

def _date_iso(mdy: str) -> Optional[str]:
    try:
        m, d, y = (mdy or "").strip().split("/")
        return _dt.date(int(y), int(m), int(d)).isoformat()
    except (ValueError, TypeError):
        return None


def _minute(created_time: str) -> Optional[str]:
    """'9:31:05 AM' or '13:04:59' -> 'HH:MM' (24h). None when unreadable."""
    s = (created_time or "").strip().upper()
    if not s:
        return None
    ampm = None
    if s.endswith("AM") or s.endswith("PM"):
        ampm, s = s[-2:], s[:-2].strip()
    parts = s.split(":")
    try:
        h, m = int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return None
    if ampm == "PM" and h != 12:
        h += 12
    elif ampm == "AM" and h == 12:
        h = 0
    if not (0 <= h < 24 and 0 <= m < 60):
        return None
    return f"{h:02d}:{m:02d}"


def _f(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class Tide:
    """Accumulates tape rows ONE AT A TIME (a day's tape is ~10^5 prints; it is never held in
    memory). Per session: per-minute signed premium. `result()` tides the LATEST session."""

    def __init__(self):
        self._by_session: dict = {}
        self.unreadable = 0

    def add(self, r: dict) -> None:
        session = _date_iso(r.get("CreatedDate"))
        mn = _minute(r.get("CreatedTime"))
        prem = _f(r.get("Premium"))
        cp = (r.get("CallPut") or "").strip().upper()
        if session is None or mn is None or prem is None or cp not in ("CALL", "PUT"):
            self.unreadable += 1
            return
        side = (r.get("Side") or "").strip().upper()
        sign = 1 if side in _ASK else -1 if side in _BID else 0
        s = self._by_session.setdefault(session, {"minutes": {}, "counted": 0, "unsigned": 0})
        b = s["minutes"].setdefault(mn, {"call": 0.0, "put": 0.0, "prints": 0})
        b["prints"] += 1
        s["counted"] += 1
        if sign == 0:
            s["unsigned"] += 1
            return
        b["call" if cp == "CALL" else "put"] += sign * prem

    def result(self, today: Optional[str] = None, *, clocked: bool = False) -> dict:
        """`clocked` = the caller knows the session rule (build does; the pure tide_from_rows
        does not). With `today` set (today's session has opened), a tape whose latest session
        is not today tides TODAY -- empty -- and names what the tape does hold (L3)."""
        sessions = sorted(self._by_session)
        latest = sessions[-1] if sessions else None
        session, status, dropped = latest, None, sessions[:-1]
        if clocked:
            if today and latest != today:
                session, status, dropped = today, "no_prints_today", sessions
            else:
                status = "today" if today else ("prior_session" if latest else None)
        s = self._by_session.get(session) or {"minutes": {}, "counted": 0, "unsigned": 0}
        out, cc, cpt = [], 0.0, 0.0
        for mn in sorted(s["minutes"]):
            b = s["minutes"][mn]
            cc += b["call"]
            cpt += b["put"]
            out.append({"t": mn, "net_call_premium": round(b["call"]),
                        "net_put_premium": round(b["put"]),
                        "cum_net_call_premium": round(cc), "cum_net_put_premium": round(cpt),
                        "cum_net_premium": round(cc - cpt), "prints": b["prints"]})
        res = {"session": session, "minutes": out, "prints_counted": s["counted"],
               "prints_unsigned": s["unsigned"], "prints_unreadable": self.unreadable,
               "older_sessions_dropped": [x for x in dropped if x != session],
               "data_through": out[-1]["t"] if out else None,
               "totals": {"net_call_premium": round(cc), "net_put_premium": round(cpt),
                          "net_premium": round(cc - cpt)}}
        if clocked:
            res["session_status"] = status
            res["latest_session_on_tape"] = latest
        return res


def tide_from_rows(rows: Iterable[dict]) -> dict:
    """The pure computation over parsed tape rows (dicts keyed by the tape's header)."""
    t = Tide()
    for r in rows:
        t.add(r)
    return t.result()


def _merge(into: Tide, part: Tide) -> None:
    into.unreadable += part.unreadable
    for session, s in part._by_session.items():
        d = into._by_session.setdefault(session, {"minutes": {}, "counted": 0, "unsigned": 0})
        d["counted"] += s["counted"]
        d["unsigned"] += s["unsigned"]
        for mn, b in s["minutes"].items():
            t = d["minutes"].setdefault(mn, {"call": 0.0, "put": 0.0, "prints": 0})
            t["call"] += b["call"]
            t["put"] += b["put"]
            t["prints"] += b["prints"]


# ── the read ────────────────────────────────────────────────────────────────────

def _flow_base_url() -> str:
    """Decided PER CALL the way `flow_proxy` decides it (same rule as ticker_history)."""
    from api import flow_proxy
    if flow_proxy.PROXY_ENABLED and flow_proxy.WORKER_INTERNAL_URL:
        return flow_proxy.WORKER_INTERNAL_URL
    return f"http://127.0.0.1:{os.environ.get('PORT', '8000')}"


_TL = threading.local()     # the last read's response metadata, per building thread


def _default_read(path: str, add: Callable[[dict], None]) -> bool:
    """Stream one tape partition's last session into `add`, row by row. False when the read
    FAILED (a refused or unreachable tape is not a quiet one). The tape's `X-Flow-Version` (the
    data-version bucket the body was BUILT from) is left on `_TL.meta` for the build."""
    import httpx
    from api import flow_proxy
    _TL.meta = None
    try:
        with httpx.stream("GET", _flow_base_url() + path, params={"days": 1},
                          headers=flow_proxy.internal_read_headers(),
                          timeout=READ_TIMEOUT_S) as r:
            if r.status_code != 200:
                return False
            _TL.meta = {"version": r.headers.get("x-flow-version")}
            for row in csv.DictReader(r.iter_lines()):
                add(row)
            return True
    except Exception:  # noqa: BLE001 -- surfaced as a failed source, never as an empty tape
        return False


_read: Callable[[str, Callable[[dict], None]], bool] = _default_read


def _default_now() -> _dt.datetime:
    return _dt.datetime.now(_ET)


_now: Callable[[], _dt.datetime] = _default_now


def today_session(now_et: _dt.datetime) -> Optional[str]:
    """Today's ISO date once today's session has opened (a trading day, 09:30 ET or later);
    None before the open and on a non-trading day."""
    from api.services import session_calendar
    d = now_et.date()
    try:
        trading = session_calendar.is_trading_day(d)
    except Exception:  # noqa: BLE001 -- the calendar is a published dataset; fall back to weekdays
        trading = d.weekday() < 5
    return d.isoformat() if trading and (now_et.hour, now_et.minute) >= (9, 30) else None


def _behind_reason(session: Optional[str], data_through: Optional[str],
                   now_et: _dt.datetime) -> Optional[str]:
    """In today's regular session, a tide whose newest minute trails the clock by more than
    TAPE_BEHIND_S names it. Outside RTH a quiet tape is just quiet."""
    if session != now_et.date().isoformat() or not data_through:
        return None
    if not ((9, 31) <= (now_et.hour, now_et.minute) < (16, 15)):
        return None
    h, m = (int(x) for x in data_through.split(":"))
    last = now_et.replace(hour=h, minute=m, second=59, microsecond=0)
    lag = (now_et - last).total_seconds()
    if lag <= TAPE_BEHIND_S:
        return None
    return (f"The tape served runs only to {data_through} ET, {int(lag // 60)} min behind the "
            "clock; the tide is rebuilt sooner than usual until it catches up.")


def build(scope: str = "all", *, now: Optional[_dt.datetime] = None) -> dict:
    """One full computation. Raises RuntimeError when no requested source could be read."""
    from api.services.options_analytics.tide_extras import TideExtras
    wanted = list(SOURCES) if scope == "all" else ["stocks" if scope == "stocks" else "etfs"]
    acc = Tide()
    ext = TideExtras()      # sector tide, per-minute prints, blocks: the SAME read (tide_extras.py)
    status, versions = {}, {}
    now_et = now.astimezone(_ET) if now else _now()
    for name in wanted:
        # each source into its OWN accumulator first: a read that dies half-way must not leave
        # half a tape in the answer while the source is reported as failed
        part = Tide()
        part_ext = TideExtras()

        def add(r, _t=part, _e=part_ext):
            _t.add(r)
            _e.add(r)
        _TL.meta = None
        ok = _read(SOURCES[name], add)
        meta = getattr(_TL, "meta", None) or {}
        versions[name] = meta.get("version")
        status[name] = "ok" if ok else "failed"
        if ok:
            _merge(acc, part)
            ext.merge(part_ext)
    if all(v == "failed" for v in status.values()):
        raise RuntimeError("the flow tape could not be read")
    out = acc.result(today_session(now_et), clocked=True)
    _EXTRAS[scope] = {**ext.result(out["session"]), "sources": dict(status)}
    reasons = [f"The {k} tape could not be read; this tide leaves it out."
               for k, v in status.items() if v == "failed"]
    if out["prints_unreadable"]:
        reasons.append(f"{out['prints_unreadable']} prints had no readable time, premium or "
                       "call/put and are not counted.")
    if out.get("session_status") == "no_prints_today":
        reasons.append(f"The {scope} tape has no prints for today ({out['session']}) yet; the "
                       f"latest session it holds is {out.get('latest_session_on_tape') or 'none'}, "
                       "which is not shown as today's tide.")
    behind = _behind_reason(out["session"], out.get("data_through"), now_et)
    if behind:
        reasons.append(behind)
    stamp = (now or _dt.datetime.now(_dt.timezone.utc)).isoformat(timespec="seconds")
    return {**out, "scope": scope, "sources": status, "tape_versions": versions,
            "tape_behind": bool(behind), "partial": bool(reasons),
            "partial_reasons": reasons, "filters": TAPE_FILTERS, "method": METHOD,
            "label": "computed", "computed_at": stamp}


# ── cache: one build per TTL, shared; stale served while one thread refreshes ──

_CACHE: dict = {}          # scope -> (monotonic_built_at, payload)
_EXTRAS: dict = {}         # scope -> tide_extras result of the build that made _CACHE[scope]
_LOCKS = {s: threading.Lock() for s in SCOPES}
_REFRESHING: set = set()
_ERRORS: dict = {}         # scope -> {"at": iso, "error": text} of the last failed refresh


def clear_cache() -> None:
    _CACHE.clear()
    _EXTRAS.clear()
    _REFRESHING.clear()
    _ERRORS.clear()


def _ttl(payload: dict) -> float:
    """A tide built off a tape that was behind is retried soon, not after the full TTL."""
    return min(TTL_S, RETRY_BEHIND_S) if payload.get("tape_behind") else TTL_S


def extras(scope: str = "all") -> dict:
    """The sector / minute / block read of the same build `get(scope)` serves (built now if
    absent, stale-refreshed like the tide). Raises what `get` raises."""
    tide = get(scope)
    ex = _EXTRAS.get(scope) or {"session": tide.get("session"), "sectors": [], "minutes": {},
                                "blocks": [], "blocks_count": 0}
    return {**ex, "scope": scope, "filters": TAPE_FILTERS, "partial": tide.get("partial"),
            "partial_reasons": tide.get("partial_reasons"), "stale": tide.get("stale"),
            "cache_age_s": tide.get("cache_age_s"), "computed_at": tide.get("computed_at"),
            "data_through": tide.get("data_through"), "session_status": tide.get("session_status")}


def _refresh(scope: str) -> None:
    try:
        with _LOCKS[scope]:
            _CACHE[scope] = (time.monotonic(), build(scope))
        _ERRORS.pop(scope, None)
    except Exception as e:  # noqa: BLE001 -- the stale answer stays and SAYS why; next request retries
        _ERRORS[scope] = {"at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
                          "error": f"{type(e).__name__}: {e}"[:300]}
    finally:
        _REFRESHING.discard(scope)


def warm_rth(now: Optional[_dt.datetime] = None) -> dict:
    """L2 (terminal backend fixes, 2026-10-05): rebuild every scope on a fixed cadence in the
    regular session, so the tide a member opens is never older than the cadence -- it used to be
    rebuilt only when somebody looked, and served stale (12+ min measured) to whoever looked
    first after a gap. Runs on the scheduler's thread, never a request's. A scope already being
    refreshed by a request is left to that refresh.

    Also the instrument for the larger lag: when the tape feeding a scope runs more than
    TAPE_BEHIND_S behind the clock, a WARNING names the scope and the tape's last minute, so the
    tape-side delay (flow_router's stale-while-revalidate) shows in the log with timestamps.
    Returns {scope: "built" | "skipped" | "error: ..."} for the job's own log line."""
    now_et = (now or _now()).astimezone(_ET)
    out = {}
    if today_session(now_et) is None or (now_et.hour, now_et.minute) >= (16, 15):
        return {s: "closed" for s in SCOPES}
    for scope in SCOPES:
        if scope in _REFRESHING:
            out[scope] = "skipped"
            continue
        _REFRESHING.add(scope)
        _refresh(scope)
        if scope in _ERRORS:
            out[scope] = "error: " + _ERRORS[scope]["error"]
            continue
        out[scope] = "built"
        payload = (_CACHE.get(scope) or (0, {}))[1]
        if payload.get("tape_behind"):
            import logging
            logging.getLogger(__name__).warning(
                "[market-tide] %s tape behind: data_through=%s at %s ET",
                scope, payload.get("data_through"), now_et.strftime("%H:%M"))
    return out


def get(scope: str = "all") -> dict:
    """The cached tide for `scope`. Fresh: served. Stale: served with its age while ONE
    background thread rebuilds. Absent: built now (callers share one build)."""
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
    hit = _CACHE.get(scope)
    if hit is not None:
        age = time.monotonic() - hit[0]
        ttl = _ttl(hit[1])
        if age >= ttl and scope not in _REFRESHING:
            _REFRESHING.add(scope)
            threading.Thread(target=_refresh, args=(scope,), daemon=True,
                             name=f"market-tide-{scope}").start()
        out = {**hit[1], "cache_age_s": round(age, 1), "stale": age >= TTL_S}
        if scope in _ERRORS:
            out["refresh_error"] = dict(_ERRORS[scope])
        return out
    with _LOCKS[scope]:
        hit = _CACHE.get(scope)
        if hit is None:
            hit = (time.monotonic(), build(scope))
            _CACHE[scope] = hit
    return {**hit[1], "cache_age_s": round(time.monotonic() - hit[0], 1), "stale": False}
