"""Full-universe 1m for the first-frame seed: a post-close one-shot fetch, and a bounded retention.

WHY. The seed reads the WORKER's bars.db, and the worker keeps 1m current only for the prewarm's
ACTIVE intraday set (watchlists, breadth drill lists, UCT20, candidates, theme holdings; capped by
`PREWARM_1M_CAP`). The rest of cap_universe has no 1m there, so the first builds seeded 1m for 1,270
symbols against ~3,545 on every other timeframe.

THE PASS (`backfill`). Runs as soon as a session has closed (`pass_due`: from `FFSEED_1M_AFTER_MIN`, default
16:20 ET, and on a worker boot after that when the session's pass has not completed), and again inside the
nightly seed build (`ffseed.nightly`) just before it builds, where it costs nothing for the symbols the first
run already brought current: the build never starts before the pass for its session has run (bounded by
the deadline below). For every cap_universe symbol whose stored 1m does not already reach the
as-of session's last regular minute, it fetches that session's 1m (and the session before it when the
store does not hold that one either: the seed's 600 regular-session bars span ~1.5 sessions) with the
same provider read and write the serve path's range repairs use (`bars_fetch._fetch_intraday_range`,
split-adjusted, then `bars_sqlite.put_bars` inside `provider_check`). So the seed then reads those rows
through the unchanged `/api/bars` read path, exactly as for every other symbol. Symbols the prewarm
keeps current cost one `MAX(ts)` read and no call. Bounded: `FFSEED_1M_WORKERS` threads (default 2),
`FFSEED_1M_DEADLINE_S` (default 2700 s; past it the pass stops and the build goes ahead with what it has).
Off: `FFSEED_1M_BACKFILL=0`.

THE RETENTION (`retention`). Those long-tail symbols' 1m would otherwise grow by a session a night in
bars.db. After each publish, a symbol keeps its newest `FFSEED_1M_KEEP_SESSIONS` (default 5) sessions of
1m (older rows deleted by `bars_sqlite.prune_before`, a prefix trim) ONLY when this pass filled it (the
long-tail ledger, below), it is not in today's active intraday set and has not been for
`FFSEED_1M_INACTIVE_DAYS` (default 10) days, and it holds no 1m older than the first session this pass
ever fetched for it: rows the pass could not have written are never touched. NOTHING is trimmed while
the active set is unknown (`bars_prewarm.active_intraday_set()` is None until a prewarm pass has run in
this process). `FFSEED_1M_KEEP_SESSIONS=0` turns it off.

HOW A TRIM REACHES OTHER PODS. Not through the R2 deltas: a serving pod (web, bars-api) merges a delta by
INSERT only (`data_sync`: INSERT OR IGNORE / INSERT OR REPLACE into main.ohlcv), never by delete, so rows
the worker trimmed stay on those pods until a pod installs a WHOLE snapshot (cold start, `force_resync`,
`BARS_REINSTALL_TOKEN`), which replaces its store with the worker's and bumps its store floor. On the
worker the trim bumps each trimmed series' revision (history changed) like every other delete.

Memory: one symbol's two sessions of 1m (<= ~2,000 rows) per thread at a time.
"""
from __future__ import annotations

import json
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
# the long-tail ledger: which symbols THIS pass filled (and from when), and when each was last active
# --------------------------------------------------------------------------------------------
#
# The retention may trim only rows this pass could have written. The ledger records, per symbol the
# pass stored 1m for, the earliest session it ever fetched from (`first`), and the newest day the
# symbol was seen in the prewarm's active intraday set (`active`). A small JSON file
# (<DATA_DIR>/ffseed_1m_longtail.json, ~60 bytes a symbol), written whole and atomically.

_LEDGER_FILE = "ffseed_1m_longtail.json"


def _ledger_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), _LEDGER_FILE)


def load_ledger() -> dict:
    try:
        with open(_ledger_path(), encoding="ascii") as f:
            led = json.load(f)
        if isinstance(led, dict) and led.get("v") == 1 and isinstance(led.get("symbols"), dict):
            return led
    except Exception:  # noqa: BLE001 - a missing or unreadable ledger is an empty one
        pass
    return {"v": 1, "symbols": {}}


def save_ledger(led: dict) -> None:
    try:
        tmp = _ledger_path() + ".tmp"
        with open(tmp, "w", encoding="ascii") as f:
            json.dump(led, f, sort_keys=True, separators=(",", ":"))
        os.replace(tmp, _ledger_path())
    except Exception:  # noqa: BLE001
        log.warning("[ffseed-1m] could not write the long-tail ledger")


def note_filled(led: dict, fills: dict) -> None:
    """`fills` = {symbol: first day fetched}. A symbol's `first` only ever moves EARLIER."""
    for sym, frm in fills.items():
        iso = frm.isoformat() if isinstance(frm, date) else str(frm)
        e = led["symbols"].setdefault(str(sym).upper(), {"first": iso, "active": None})
        if iso < e.get("first", iso):
            e["first"] = iso


def note_active(led: dict, active: Iterable[str], day_iso: str) -> None:
    """Stamp every ledger symbol of the active set with `day_iso`, the newest day it was seen active."""
    syms = led["symbols"]
    for a in active:
        e = syms.get(str(a).upper())
        if e is not None and (e.get("active") or "") < day_iso:
            e["active"] = day_iso


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
    fills: dict = {}

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
                elif n:
                    fills[sym] = frm
        except Exception as e:  # noqa: BLE001 - one symbol never stops the pass
            log.info("[ffseed-1m] %s failed: %s", sym, type(e).__name__)
            with lock:
                stats["failed"] += 1

    with ThreadPoolExecutor(max_workers=n_workers or workers(), thread_name_prefix="ffseed-1m") as ex:
        list(ex.map(one, todo))
    led = load_ledger()
    note_filled(led, fills)
    act = protected_symbols()
    if act is not None:
        note_active(led, act, asof.isoformat())
    save_ledger(led)
    stats["ledger"] = len(led["symbols"])
    stats["secs"] = round(clock() - t0, 1)
    log.info("[ffseed-1m] backfill %s", stats)
    return stats


# --------------------------------------------------------------------------------------------
# when the pass runs: right after the close (and on a boot after it), and again just before the build
# --------------------------------------------------------------------------------------------

_PASS_FILE = ".last_ffseed_1m_pass"


def after_close_min() -> int:
    """ET minute of the day from which a session's pass may run (default 16:20: the regular-session
    minutes have closed and the vendor's late prints have landed)."""
    return _int_env("FFSEED_1M_AFTER_MIN", 16 * 60 + 20)


def _pass_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), _PASS_FILE)


def read_pass_marker() -> str:
    try:
        with open(_pass_path(), encoding="ascii") as f:
            return f.read().strip()
    except Exception:  # noqa: BLE001
        return ""


def _write_pass_marker(asof_iso: str) -> None:
    try:
        tmp = _pass_path() + ".tmp"
        with open(tmp, "w", encoding="ascii") as f:
            f.write(asof_iso)
        os.replace(tmp, _pass_path())
    except Exception:  # noqa: BLE001
        pass


def pass_due(now: Optional[datetime] = None) -> Optional[date]:
    """The session whose pass should run now: the newest session closed at least `after_close_min()`
    into its day, when no COMPLETE pass for it is recorded. None otherwise (or when the pass is off)."""
    if not backfill_enabled():
        return None
    target = ffseed.last_closed_session(now or datetime.now(ffseed.ET), after_min=after_close_min())
    return None if read_pass_marker() == target.isoformat() else target


def run_pass(asof: date, **kw) -> dict:
    """`backfill(asof)`, recorded as done for `asof` only when it reached every symbol it planned
    (a pass cut short by its deadline is finished by the next one)."""
    st = backfill(asof, **kw)
    if not st.get("not_reached"):
        _write_pass_marker(asof.isoformat())
    return st


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


def inactive_days() -> int:
    return max(0, _int_env("FFSEED_1M_INACTIVE_DAYS", 10))


def _first_ts(sym: str) -> Optional[int]:
    from api.services import bars_sqlite
    return bars_sqlite.get_first_ts(sym, "1")


def retention(asof: date, symbols: Optional[Iterable[str]] = None, *, protected=_UNKNOWN,
              keep: Optional[int] = None, prune: Callable[[List[str], int], int] = None,
              first_ts: Callable[[str], Optional[int]] = None, ledger: Optional[dict] = None,
              idle_days: Optional[int] = None) -> dict:
    """Trim to its newest `keep` sessions the 1m of every universe symbol that is ALL of:
      * in the ledger: this pass filled it;
      * not in today's active intraday set, and not seen in it for `idle_days` (default 10) days;
      * holding no 1m older than the first session this pass ever fetched for it (rows from before
        that came from somewhere else, e.g. the prewarm while the symbol was active: never touched).
    Nothing at all while the active set is unknown. Returns the counts, skips by reason included."""
    keep = keep_sessions() if keep is None else int(keep)
    if keep <= 0:
        return {"skipped": "disabled"}
    active = protected_symbols() if protected is _UNKNOWN else protected
    if active is None:
        log.info("[ffseed-1m] retention skipped: the active intraday set is not known yet")
        return {"skipped": "active set unknown"}
    led = load_ledger() if ledger is None else ledger
    note_active(led, active, asof.isoformat())
    if ledger is None:
        save_ledger(led)
    first_ts = first_ts or _first_ts
    idle = inactive_days() if idle_days is None else int(idle_days)
    horizon = (asof - timedelta(days=idle)).isoformat()
    act = {str(a).upper() for a in active}
    syms = sorted({str(x).upper() for x in (symbols if symbols is not None else ffseed.universe())})
    skipped = {"not_filled": 0, "active": 0, "recently_active": 0, "older_rows": 0}
    eligible = []
    for sym in syms:
        e = led["symbols"].get(sym)
        if e is None:
            skipped["not_filled"] += 1
            continue
        if sym in act:
            skipped["active"] += 1
            continue
        if e.get("active") and e["active"] > horizon:
            skipped["recently_active"] += 1
            continue
        ft = first_ts(sym)
        if ft is not None and int(ft) < session_start_ts(date.fromisoformat(e["first"])):
            skipped["older_rows"] += 1
            continue
        eligible.append(sym)
    cutoff = session_start_ts(sessions_back(asof, keep))
    deleted = (prune or _prune)(eligible, cutoff) if eligible else 0
    out = {"keep": keep, "cutoff": cutoff, "eligible": len(eligible), "skipped": skipped,
           "protected": len(act), "deleted": deleted}
    log.info("[ffseed-1m] retention %s", out)
    return out
