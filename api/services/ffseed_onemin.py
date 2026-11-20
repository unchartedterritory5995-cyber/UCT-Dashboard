"""Full-universe 1m for the first-frame seed: a post-close one-shot fetch, and a bounded retention.

WHY. The seed reads the WORKER's bars.db, and the worker keeps 1m current only for the prewarm's
ACTIVE intraday set (watchlists, breadth drill lists, UCT20, candidates, theme holdings; capped by
`PREWARM_1M_CAP`). The rest of cap_universe has no 1m there, so the first builds seeded 1m for 1,270
symbols against ~3,545 on every other timeframe.

THE PASS (`backfill`). Run by the nightly seed build (`ffseed.nightly`) just before it builds, after the
extended session has ended. For every cap_universe symbol whose stored 1m does not already reach the
as-of session's last regular minute, it fetches that session's 1m (and the session before it when the
store does not hold that one either: the seed's 600 regular-session bars span ~1.5 sessions) with the
same provider read and write the serve path's range repairs use (`bars_fetch._fetch_intraday_range`,
split-adjusted, then `bars_sqlite.put_bars` inside `provider_check`). So the seed then reads those rows
through the unchanged `/api/bars` read path, exactly as for every other symbol. Symbols the prewarm
keeps current cost one `MAX(ts)` read and no call. Bounded: `FFSEED_1M_WORKERS` threads (default 2),
`FFSEED_1M_DEADLINE_S` (default 2700 s; past it the pass stops and the build goes ahead with what it has).
Off: `FFSEED_1M_BACKFILL=0`.

THE RETENTION (`retention`). Those long-tail symbols' 1m would otherwise grow by a session a night, in
bars.db and in every R2 delta. After each publish, every cap_universe symbol OUTSIDE the active intraday
set keeps its newest `FFSEED_1M_KEEP_SESSIONS` (default 5) sessions of 1m; older rows are deleted
(`bars_sqlite.prune_before`, a prefix trim). The active set's 1m is never trimmed, and NOTHING is trimmed
while the active set is unknown (`bars_prewarm.active_intraday_set()` is None until a prewarm pass has
run in this process). `FFSEED_1M_KEEP_SESSIONS=0` turns it off.

Memory: one symbol's two sessions of 1m (<= ~2,000 rows) per thread at a time.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Callable, Iterable, List, Optional, Tuple

from api.services import ffseed

log = logging.getLogger(__name__)

_UNKNOWN = object()


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


def backfill_enabled() -> bool:
    return os.environ.get("FFSEED_1M_BACKFILL", "1").strip() != "0"


def keep_sessions() -> int:
    return max(0, _int_env("FFSEED_1M_KEEP_SESSIONS", 5))


def workers() -> int:
    return max(1, _int_env("FFSEED_1M_WORKERS", 2))


def deadline_s() -> int:
    return max(1, _int_env("FFSEED_1M_DEADLINE_S", 2700))


# --------------------------------------------------------------------------------------------
# the session calendar (ffseed's: the server's NYSE calendar)
# --------------------------------------------------------------------------------------------

def prev_session(d: date) -> date:
    x = d - timedelta(days=1)
    for _ in range(30):
        if ffseed.is_trading_day(x):
            return x
        x -= timedelta(days=1)
    return x


def sessions_back(asof: date, k: int) -> date:
    """The k-th newest session counting `asof` as the first (k >= 1)."""
    d = asof
    for _ in range(max(1, int(k)) - 1):
        d = prev_session(d)
    return d


def session_start_ts(d: date) -> int:
    """04:00 ET of `d`: the first minute of its extended session."""
    return int(datetime(d.year, d.month, d.day, 4, 0, tzinfo=ffseed.ET).timestamp())


def last_rth_minute_ts(d: date) -> int:
    """The start of `d`'s last regular-session minute (15:59, or 12:59 on an early close)."""
    m = ffseed.rth_close_min(int(d.strftime("%Y%m%d"))) - 1
    return int(datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=ffseed.ET).timestamp())


# --------------------------------------------------------------------------------------------
# the pass
# --------------------------------------------------------------------------------------------

def _stored_last_ts(sym: str) -> Optional[int]:
    from api.services import bars_sqlite
    return bars_sqlite.get_last_ts(sym, "1")


def _fetch(sym: str, frm: date, to: date) -> list:
    """The provider's split-adjusted 1m for [frm, to] (whole ET days); raises on failure."""
    from api.services import bars_fetch
    return bars_fetch._fetch_intraday_range(sym, "1", frm.isoformat(), to.isoformat(), raise_errors=True)


def _store(sym: str, rows: list, checked_at: float) -> int:
    """The range-repair write: rows a newer provider check sealed are never overwritten."""
    from api.services import bars_fetch, bars_sqlite
    with bars_fetch._provider_write(checked_at):
        return bars_sqlite.put_bars(sym, "1", rows)


def plan(asof: date, symbols: Iterable[str],
         last_ts: Callable[[str], Optional[int]] = _stored_last_ts) -> List[Tuple[str, date]]:
    """(symbol, first day to fetch) for every symbol whose stored 1m does not reach `asof`'s last
    regular minute: from `asof` when the store already reaches into the session before it, else from
    that session (the seed's window spans ~1.5 sessions)."""
    need = last_rth_minute_ts(asof)
    prev = prev_session(asof)
    prev_start = session_start_ts(prev)
    out = []
    for sym in symbols:
        lt = last_ts(sym)
        if lt is not None and int(lt) >= need:
            continue
        out.append((sym, asof if (lt is not None and int(lt) >= prev_start) else prev))
    return out


def backfill(asof: date, symbols: Optional[Iterable[str]] = None, *,
             fetch: Callable[[str, date, date], list] = None,
             store: Callable[[str, list, float], int] = None,
             last_ts: Callable[[str], Optional[int]] = None,
             n_workers: Optional[int] = None, deadline: Optional[float] = None,
             clock: Callable[[], float] = time.monotonic) -> dict:
    """Fetch and store 1m for every universe symbol the store lacks for `asof`. Never raises for a
    symbol (each failure is counted); returns the pass's stats."""
    fetch = fetch or _fetch
    store = store or _store
    last_ts = last_ts or _stored_last_ts
    syms = list(symbols) if symbols is not None else ffseed.universe()
    t0 = clock()
    todo = plan(asof, syms, last_ts)
    stop_at = t0 + (deadline if deadline is not None else deadline_s())
    stats = {"asof": asof.isoformat(), "symbols": len(syms), "current": len(syms) - len(todo),
             "todo": len(todo), "fetched": 0, "rows": 0, "empty": 0, "failed": 0,
             "not_reached": 0, "secs": 0.0}
    lock = threading.Lock()

    def one(item):
        sym, frm = item
        if clock() > stop_at:
            with lock:
                stats["not_reached"] += 1
            return
        try:
            checked = time.time()
            rows = fetch(sym, frm, asof)
            n = store(sym, rows, checked) if rows else 0
            with lock:
                stats["fetched"] += 1
                stats["rows"] += int(n or 0)
                if not rows:
                    stats["empty"] += 1
        except Exception as e:  # noqa: BLE001 - one symbol never stops the pass
            log.info("[ffseed-1m] %s failed: %s", sym, type(e).__name__)
            with lock:
                stats["failed"] += 1

    with ThreadPoolExecutor(max_workers=n_workers or workers(), thread_name_prefix="ffseed-1m") as ex:
        list(ex.map(one, todo))
    stats["secs"] = round(clock() - t0, 1)
    log.info("[ffseed-1m] backfill %s", stats)
    return stats


# --------------------------------------------------------------------------------------------
# the retention
# --------------------------------------------------------------------------------------------

def protected_symbols() -> Optional[frozenset]:
    """The prewarm's active intraday set, or None when no prewarm pass has computed it here."""
    try:
        from api.services import bars_prewarm
        return bars_prewarm.active_intraday_set()
    except Exception:  # noqa: BLE001
        return None


def _prune(symbols: List[str], before_ts: int) -> int:
    from api.services import bars_sqlite
    return bars_sqlite.prune_before(symbols, "1", before_ts)


def retention(asof: date, symbols: Optional[Iterable[str]] = None, *, protected=_UNKNOWN,
              keep: Optional[int] = None, prune: Callable[[List[str], int], int] = None) -> dict:
    """Trim every non-active universe symbol's 1m to its newest `keep` sessions (see the module doc)."""
    keep = keep_sessions() if keep is None else int(keep)
    if keep <= 0:
        return {"skipped": "disabled"}
    active = protected_symbols() if protected is _UNKNOWN else protected
    if active is None:
        log.info("[ffseed-1m] retention skipped: the active intraday set is not known yet")
        return {"skipped": "active set unknown"}
    syms = list(symbols) if symbols is not None else ffseed.universe()
    targets = sorted({s.upper() for s in syms} - {a.upper() for a in active})
    cutoff = session_start_ts(sessions_back(asof, keep))
    deleted = (prune or _prune)(targets, cutoff)
    out = {"keep": keep, "cutoff": cutoff, "symbols": len(targets), "protected": len(active), "deleted": deleted}
    log.info("[ffseed-1m] retention %s", out)
    return out
