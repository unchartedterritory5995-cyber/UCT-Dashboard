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
"""
from __future__ import annotations

import csv
import datetime as _dt
import os
import threading
import time
from typing import Callable, Iterable, Optional

TTL_S = 60.0
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

    def result(self) -> dict:
        sessions = sorted(self._by_session)
        session = sessions[-1] if sessions else None
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
        return {"session": session, "minutes": out, "prints_counted": s["counted"],
                "prints_unsigned": s["unsigned"], "prints_unreadable": self.unreadable,
                "older_sessions_dropped": sessions[:-1],
                "totals": {"net_call_premium": round(cc), "net_put_premium": round(cpt),
                           "net_premium": round(cc - cpt)}}


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


def _default_read(path: str, add: Callable[[dict], None]) -> bool:
    """Stream one tape partition's last session into `add`, row by row. False when the read
    FAILED (a refused or unreachable tape is not a quiet one)."""
    import httpx
    from api import flow_proxy
    try:
        with httpx.stream("GET", _flow_base_url() + path, params={"days": 1},
                          headers=flow_proxy.internal_read_headers(),
                          timeout=READ_TIMEOUT_S) as r:
            if r.status_code != 200:
                return False
            for row in csv.DictReader(r.iter_lines()):
                add(row)
            return True
    except Exception:  # noqa: BLE001 -- surfaced as a failed source, never as an empty tape
        return False


_read: Callable[[str, Callable[[dict], None]], bool] = _default_read


def build(scope: str = "all", *, now: Optional[_dt.datetime] = None) -> dict:
    """One full computation. Raises RuntimeError when no requested source could be read."""
    from api.services.options_analytics.tide_extras import TideExtras
    wanted = list(SOURCES) if scope == "all" else ["stocks" if scope == "stocks" else "etfs"]
    acc = Tide()
    ext = TideExtras()      # sector tide, per-minute prints, blocks: the SAME read (tide_extras.py)
    status = {}
    for name in wanted:
        # each source into its OWN accumulator first: a read that dies half-way must not leave
        # half a tape in the answer while the source is reported as failed
        part = Tide()
        part_ext = TideExtras()

        def add(r, _t=part, _e=part_ext):
            _t.add(r)
            _e.add(r)
        ok = _read(SOURCES[name], add)
        status[name] = "ok" if ok else "failed"
        if ok:
            _merge(acc, part)
            ext.merge(part_ext)
    if all(v == "failed" for v in status.values()):
        raise RuntimeError("the flow tape could not be read")
    out = acc.result()
    _EXTRAS[scope] = {**ext.result(out["session"]), "sources": dict(status)}
    reasons = [f"The {k} tape could not be read; this tide leaves it out."
               for k, v in status.items() if v == "failed"]
    if out["prints_unreadable"]:
        reasons.append(f"{out['prints_unreadable']} prints had no readable time, premium or "
                       "call/put and are not counted.")
    stamp = (now or _dt.datetime.now(_dt.timezone.utc)).isoformat(timespec="seconds")
    return {**out, "scope": scope, "sources": status, "partial": bool(reasons),
            "partial_reasons": reasons, "filters": TAPE_FILTERS, "method": METHOD,
            "label": "computed", "computed_at": stamp}


# ── cache: one build per TTL, shared; stale served while one thread refreshes ──

_CACHE: dict = {}          # scope -> (monotonic_built_at, payload)
_EXTRAS: dict = {}         # scope -> tide_extras result of the build that made _CACHE[scope]
_LOCKS = {s: threading.Lock() for s in SCOPES}
_REFRESHING: set = set()


def clear_cache() -> None:
    _CACHE.clear()
    _EXTRAS.clear()
    _REFRESHING.clear()


def extras(scope: str = "all") -> dict:
    """The sector / minute / block read of the same build `get(scope)` serves (built now if
    absent, stale-refreshed like the tide). Raises what `get` raises."""
    tide = get(scope)
    ex = _EXTRAS.get(scope) or {"session": tide.get("session"), "sectors": [], "minutes": {},
                                "blocks": [], "blocks_count": 0}
    return {**ex, "scope": scope, "filters": TAPE_FILTERS, "partial": tide.get("partial"),
            "partial_reasons": tide.get("partial_reasons"), "stale": tide.get("stale"),
            "cache_age_s": tide.get("cache_age_s"), "computed_at": tide.get("computed_at")}


def _refresh(scope: str) -> None:
    try:
        with _LOCKS[scope]:
            _CACHE[scope] = (time.monotonic(), build(scope))
    except Exception:  # noqa: BLE001 -- the stale answer stays; the next request retries
        pass
    finally:
        _REFRESHING.discard(scope)


def get(scope: str = "all") -> dict:
    """The cached tide for `scope`. Fresh: served. Stale: served with its age while ONE
    background thread rebuilds. Absent: built now (callers share one build)."""
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
    hit = _CACHE.get(scope)
    if hit is not None:
        age = time.monotonic() - hit[0]
        if age >= TTL_S and scope not in _REFRESHING:
            _REFRESHING.add(scope)
            threading.Thread(target=_refresh, args=(scope,), daemon=True,
                             name=f"market-tide-{scope}").start()
        return {**hit[1], "cache_age_s": round(age, 1), "stale": age >= TTL_S}
    with _LOCKS[scope]:
        hit = _CACHE.get(scope)
        if hit is None:
            hit = (time.monotonic(), build(scope))
            _CACHE[scope] = hit
    return {**hit[1], "cache_age_s": round(time.monotonic() - hit[0], 1), "stale": False}
