# api/services/earnings_session_resolver.py
"""Give `tbd` earnings rows a session (bmo/amc) wherever one can be KNOWN.

Finnhub carries `hour` for the names it has confirmed; FMP's range calendar
carries no session field at all, so every FMP-only row lands in `tbd`. Measured
on the week of 2026-10-12: 40 of 78 reporters were "Time TBD" on the Sunday
Scans card — ASML, TSM, PGR, SNA and WHR among them.

Three legs, strongest first. Each only ever MOVES a row out of `tbd`; a session
some earlier leg already decided is never second-guessed.

1. **Nasdaq** `api.nasdaq.com/api/calendar/earnings?date=` — the confirmed
   time for that exact date. Measured 2026-10-09 against Finnhub on the coming
   week: 253 rows timed by both, 253 agree; and 419 rows Nasdaq times that
   Finnhub leaves blank. (It agrees less on dates 2+ weeks out, where both are
   projecting — irrelevant here, it only fills what Finnhub left empty.)
   Nasdaq blanks the time once a day has passed, so it cannot help past days.

2. **The 8-K itself** — a past day whose Item 2.02 8-K was filed on the report
   date already SAYS when the release went out.

3. **Filing history** — the session of the company's last Item 2.02 8-Ks, used
   only when 3+ of them exist and ALL agree. Measured against 127 Finnhub-
   confirmed reporters (2026-09-08..10-09): covers 91, 82 correct (0.90). The
   misses are companies that changed session that quarter (CBRL, MLKN) — a
   unanimous history is the best evidence available short of a confirmation,
   and it is only consulted after Nasdaq had nothing.

How an 8-K acceptance time maps to a session (measured on the same set, the
filing's own quarter vs Finnhub's hour):
  * before 16:00 ET                       -> bmo  (24/24 pre-09:30, 23/25 in-session:
                                                  8-Ks LAG a morning release)
  * 16:00+ ET, filed the SAME date        -> amc  (51/52)
  * 16:00+ ET, filingDate is the NEXT day -> bmo  (2/2) — EDGAR dates an 8-K
    accepted after 22:00 to the next business day; PEP files ~22:00 for its
    06:00 release, so "late evening" is NOT "after the close".

Never raises. Every network call is bounded and cached (failures briefly), and
the whole pass has a wall-clock budget: the range path can sit on a request.
Rows that remain unknown stay in `tbd` — that bucket is for the genuinely
unsolvable, not for "the first provider didn't say".

Each moved row carries `session_src` (`nasdaq` | `edgar_filing` |
`edgar_history`) so a reader can tell a confirmation from an inference.
Kill switch: `CALENDAR_TBD_RESOLVER=0` (unset = ON).
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

_NASDAQ_URL = "https://api.nasdaq.com/api/calendar/earnings?date={ds}"
_NASDAQ_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}
_NASDAQ_TIME = {"time-pre-market": "bmo", "time-after-hours": "amc"}

_OK_TTL = {"nasdaq": 3 * 3600, "sec": 24 * 3600}
_FAIL_TTL = 15 * 60
_HISTORY_MIN = 3          # filings needed before a history is trusted
_HISTORY_N = 4            # most recent filings consulted
_SAME_QUARTER_DAYS = 1    # |filingDate - report date| that counts as THIS report

_cache: dict[tuple[str, str], tuple[float, object]] = {}
_cache_lock = threading.Lock()


def is_enabled() -> bool:
    """Read PER CALL. Unset means ON."""
    return os.environ.get("CALENDAR_TBD_RESOLVER", "1").strip().lower() not in ("0", "false", "no", "off")


def _cached(kind: str, key: str, fetch):
    now = time.time()
    with _cache_lock:
        hit = _cache.get((kind, key))
        if hit and hit[0] > now:
            return hit[1]
    try:
        val, ttl = fetch(), _OK_TTL[kind]
    except Exception as exc:          # noqa: BLE001
        _logger.info("session resolver: %s %s failed: %s", kind, key, exc)
        val, ttl = None, _FAIL_TTL
    with _cache_lock:
        _cache[(kind, key)] = (now + ttl, val)
    return val


# ── transports (replaced by name in tests) ─────────────────────────────────

def _nasdaq_fetch(ds: str) -> dict:
    import requests
    r = requests.get(_NASDAQ_URL.format(ds=ds), headers=_NASDAQ_HEADERS, timeout=6)
    r.raise_for_status()
    return r.json()


def _sec_fetch(cik: str) -> dict:
    from api.services.fundamentals_pit import sec_client
    return json.loads(sec_client.get_bytes(
        f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json", retries=1, timeout=8))


def _cik_for(sym: str) -> str | None:
    # The bulk file only: the resolver chain's later tiers are slow by design
    # and this pass can sit on a request. A miss just leaves the row in tbd.
    from api.services.edgar import _ticker_to_cik_bulk
    try:
        return _ticker_to_cik_bulk().get(sym)
    except Exception:                 # noqa: BLE001
        return None


# ── leg 1: Nasdaq ──────────────────────────────────────────────────────────

def _nasdaq_sessions(ds: str) -> dict[str, str]:
    def fetch():
        rows = ((_nasdaq_fetch(ds) or {}).get("data") or {}).get("rows") or []
        return {(r.get("symbol") or "").strip().upper(): _NASDAQ_TIME[r.get("time")]
                for r in rows if r.get("time") in _NASDAQ_TIME}
    return _cached("nasdaq", ds, fetch) or {}


# ── legs 2+3: SEC 8-K Item 2.02 acceptance times ───────────────────────────

def filing_session(accepted: str, filing_date: str) -> str | None:
    """Session implied by one Item 2.02 8-K. See the module docstring for the
    measurement behind each branch."""
    try:
        t = datetime.fromisoformat(accepted.replace("Z", "+00:00")).astimezone(_ET)
    except (ValueError, AttributeError):
        return None
    if t.hour < 16:
        return "bmo"
    return "bmo" if (filing_date or "") > t.date().isoformat() else "amc"


def _earnings_filings(sym: str) -> list[tuple[str, str]] | None:
    """[(filingDate, session)] newest first, or None when unknowable."""
    cik = _cik_for(sym)
    if not cik:
        return None

    def fetch():
        recent = ((_sec_fetch(cik) or {}).get("filings") or {}).get("recent") or {}
        out = []
        for form, items, acc, fd in zip(recent.get("form") or [], recent.get("items") or [],
                                        recent.get("acceptanceDateTime") or [],
                                        recent.get("filingDate") or []):
            if form == "8-K" and "2.02" in (items or ""):
                s = filing_session(acc, fd)
                if s:
                    out.append((fd, s))
        out.sort(reverse=True)
        return out
    return _cached("sec", cik, fetch)


def session_from_filings(filings: list[tuple[str, str]], ds: str) -> tuple[str, str] | None:
    """(session, source) for a report on `ds`, or None."""
    try:
        d = date.fromisoformat(ds)
    except ValueError:
        return None
    for fd, s in filings:
        try:
            if abs((date.fromisoformat(fd) - d).days) <= _SAME_QUARTER_DAYS:
                return s, "edgar_filing"
        except ValueError:
            continue
    # History = filings clearly BEFORE this report (a prior quarter).
    cutoff = (d - timedelta(days=20)).isoformat()
    hist = [s for fd, s in filings if fd < cutoff][:_HISTORY_N]
    if len(hist) < _HISTORY_MIN:
        return None
    top, n = Counter(hist).most_common(1)[0]
    return (top, "edgar_history") if n == len(hist) else None


# ── the pass ───────────────────────────────────────────────────────────────

def resolve_tbd_sessions(days: dict, *, budget_s: float = 20.0) -> dict:
    """Move `tbd` rows into bmo/amc where a session is known. Mutates `days`.
    Returns per-source counts. Never raises."""
    stats = Counter()
    if not is_enabled():
        return stats
    try:
        deadline = time.monotonic() + budget_s
        pending = {ds: list(day.get("tbd") or []) for ds, day in days.items()
                   if isinstance(day, dict) and day.get("tbd")}
        if not pending:
            return stats
        decided: dict[tuple[str, str], tuple[str, str]] = {}

        # Days in parallel: one at a time took ~2 s each and spent the whole
        # budget before the SEC leg could start (measured on a 5-day week).
        nq_pool = ThreadPoolExecutor(max_workers=5, thread_name_prefix="tbd-nq")
        nq_futs = {nq_pool.submit(_nasdaq_sessions, ds): ds for ds in pending}
        nq_done, _ = wait(nq_futs, timeout=max(0.0, min(8.0, deadline - time.monotonic())))
        nq_pool.shutdown(wait=False, cancel_futures=True)
        for f in nq_done:
            ds = nq_futs[f]
            nq = f.result() or {}
            for e in pending[ds]:
                s = nq.get(e.get("sym") or "")
                if s:
                    decided[(ds, e["sym"])] = (s, "nasdaq")

        left = sorted({e.get("sym") for ds, rows in pending.items() for e in rows
                       if e.get("sym") and (ds, e.get("sym")) not in decided})
        filings: dict[str, list] = {}
        if left and time.monotonic() < deadline:
            pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="tbd-sec")
            futs = {pool.submit(_earnings_filings, s): s for s in left}
            done, _ = wait(futs, timeout=max(0.0, deadline - time.monotonic()))
            pool.shutdown(wait=False, cancel_futures=True)
            for f in done:
                try:
                    if f.result():
                        filings[futs[f]] = f.result()
                except Exception:     # noqa: BLE001
                    pass
            for ds, rows in pending.items():
                for e in rows:
                    sym = e.get("sym")
                    if sym in filings and (ds, sym) not in decided:
                        got = session_from_filings(filings[sym], ds)
                        if got:
                            decided[(ds, sym)] = got

        for ds, rows in pending.items():
            day = days[ds]
            keep = []
            touched = set()
            for e in day.get("tbd") or []:
                got = decided.get((ds, e.get("sym")))
                if not got:
                    keep.append(e)
                    continue
                e["session_src"] = got[1]
                day.setdefault(got[0], []).append(e)
                touched.add(got[0])
                stats[got[1]] += 1
            day["tbd"] = keep
            stats["left"] += len(keep)
            for b in touched:
                day[b].sort(key=lambda e: (-(e.get("ew") or 0),
                                           e.get("eps_est") is None and e.get("rev_est") is None,
                                           e.get("sym") or ""))
        if stats:
            _logger.info("Calendar: tbd session resolver %s", dict(stats))
    except Exception as exc:          # noqa: BLE001
        _logger.warning("Calendar: tbd session resolver failed: %s", exc)
    return stats
