"""The deep RE-GRAFT (2026-11-21): re-fetch a NAMED list of tickers' deep D/W/M history and write it through the
store's own writer, on the pod the request reaches. Web and bars-api are separate calls, because their stores are
separate and a daily delta never carries pre-2003 rows from one to the other.

Why: a deep fetch's yfinance graft (the bars older than Massive's 2003-09-10 archive floor) was written on another
basis before `bars_fetch._yf_join_factor` existed. The seam scan of 2026-11-21 found a cliff at the floor in about
200-270 tickers per pod. A re-fetch now JOINS the graft:
  * a proven join, including a proven same basis (factor 1.0), REPLACES the stored pre-floor rows;
  * an unproven one is add-only (`bars_sqlite.AddOnlyBar`), so nothing the store holds changes.
Every write is the ordinary `put_bars`, so history_rev moves when held history changes.

Safety:
  * ADMIN ONLY (the route checks PUSH_SECRET); a named list of at most `MAX_TICKERS`; one job at a time (`claim`);
  * `dry_run` (the route's DEFAULT) writes NOTHING and reports, per (ticker, tf), the rows a write would replace,
    add, keep (an unjoined bar never replaces a held row) and leave unchanged;
  * throttled: one ticker every `interval_s` (at least `MIN_INTERVAL_S`). Per ticker, one deep fetch per tf, and
    each deep fetch is one Massive aggregates call plus one yfinance period=max call;
  * it STOPS on the first provider fault (`provider_fault_scope`), because a fault can masquerade as an empty
    answer. Nothing is written for that (ticker, tf) or after it.
Rails: tests/test_bars_regraft.py."""
from __future__ import annotations

import logging
import threading
import time

_log = logging.getLogger(__name__)

MAX_TICKERS = 300
MIN_INTERVAL_S = 2.0
TFS = ("D", "W", "M")
_lock = threading.Lock()
STATE: dict = {"running": False}


def claim(n: int, tfs, dry_run: bool) -> bool:
    """Atomically mark a job as running. False when one already is."""
    with _lock:
        if STATE.get("running"):
            return False
        STATE.clear()
        STATE.update(running=True, started=time.time(), dry_run=bool(dry_run), total=int(n), done=0,
                     results={}, stopped=None, tfs=list(tfs))
        return True


def status() -> dict:
    with _lock:
        return {**STATE, "results": dict(STATE.get("results") or {})}


def _fetch(ticker: str, tf: str) -> list:
    from api.services import bars_fetch as F
    if tf == "W":
        return F._fetch_weekly(ticker, 4000, deep=True)
    if tf == "M":
        return F._fetch_monthly(ticker, 1200, deep=True)
    return F._fetch_daily(ticker, 12500, deep=True)


def diff(ticker: str, tf: str, bars: list) -> dict:
    """What `put_bars(bars)` would do to the stored series. Reads only.

    ⛔ It reads the rows AS STORED (`raw_reads()`): `put_bars` replaces stored rows, so the diff must compare against
    what the store holds, never the corrections ledger's served view, or a corrected field would count as a change."""
    from api.services import bars_corrections as _cor
    from api.services import bars_sqlite as S
    with _cor.raw_reads():
        held = {r[0]: r[1:] for r in S.get_bars(ticker, tf, 10 ** 6)}
    out = {"replace": 0, "add": 0, "kept": 0, "unchanged": 0}
    for b in bars:
        try:
            k = int(str(b["t"]).replace("-", ""))
            new = (float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"]), int(b.get("v") or 0))
        except (KeyError, TypeError, ValueError):
            continue
        old = held.get(k)
        if old is None:
            out["add"] += 1
            continue
        differs = (any(abs(float(a) - c) > 1e-9 * max(1.0, abs(c)) for a, c in zip(old[:4], new[:4]))
                   or int(old[4] or 0) != new[4])
        if not differs:
            out["unchanged"] += 1
        elif isinstance(b, S.AddOnlyBar):
            out["kept"] += 1                # an unjoined bar never replaces a held row
        else:
            out["replace"] += 1
    return out


def run(tickers: list, tfs=TFS, dry_run: bool = True, interval_s: float = 5.0, sleep=time.sleep) -> dict:
    """The job body; the route runs it on a thread after `claim`. Returns the final state."""
    from api.services import bars_sqlite as S
    from api.services import provider_fault_scope as PF
    interval_s = max(MIN_INTERVAL_S, float(interval_s))
    with _lock:
        if not STATE.get("running"):
            STATE.update(running=True, started=time.time(), dry_run=bool(dry_run), total=len(tickers), done=0,
                         results={}, stopped=None, tfs=list(tfs))
    try:
        for i, t in enumerate(tickers):
            res = {}
            for tf in tfs:
                with PF.scope() as faults:
                    bars = _fetch(t, tf)
                if not faults.clean:
                    with _lock:
                        STATE["results"][t] = res
                        STATE["stopped"] = f"provider fault on {t} tf={tf}: stopped; nothing written for it or after"
                    _log.warning("[regraft] %s", STATE["stopped"])
                    return status()
                d = diff(t, tf, bars) if bars else {"replace": 0, "add": 0, "kept": 0, "unchanged": 0}
                if not dry_run and bars:
                    d["written"] = S.put_bars(t, tf, bars, date_tf=True)
                res[tf] = d
            with _lock:
                STATE["results"][t] = res
                STATE["done"] = i + 1
            _log.info("[regraft] %s %s %s", "DRY" if dry_run else "WROTE", t, res)
            if i + 1 < len(tickers):
                sleep(interval_s)
        return status()
    finally:
        with _lock:
            STATE["running"] = False
            STATE["finished"] = time.time()
