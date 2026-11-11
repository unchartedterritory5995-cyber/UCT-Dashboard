"""The intraday bucket grid: every stored/served 1/5/15/30/60m row is a BUCKET START.

⛔ THE DEFECT (prod, 2026-11-10 probe). Stored intraday series carried post-market
rows stamped mid-bucket with seconds — SPY 5m 16:35:50 beside the real 16:35:00,
AMD 5m 16:15:30 and AMD 15m 16:15:31, NVDA 5m 17:00:41 — each drawn as an extra
candle between two real buckets. Producer: the yfinance intraday fallback
(`bars_fetch._fetch_intraday_yfinance`, reached through `fetch_with_validation`
whenever Massive fails/lags or its breaker is open). Yahoo returns the in-progress
interval as a SEPARATE last row stamped with the LAST TRADE time; yfinance's own
`fix_Yahoo_returning_live_separate` folds it into the bucket only when the previous
row is in the same interval — in thin post-market the bucket has no row yet, so the
live row survives with its trade timestamp. `_put_fetched_intraday` writes a fallback
answer ADD-ONLY (INSERT OR IGNORE), which never collides with the Massive grid row
(different `ts`), so the stray row was added next to it and nothing ever removed it.

This module is the ONE definition of "aligned" and the ONE fold, used at every door:
  * the fetch (`_fetch_intraday_yfinance` folds before returning),
  * the write (`bars_sqlite.put_bars` / `put_bars_many`, `data_sync` merge gate),
  * the serve (`bars_fetch._fmt_sqlite_bars`),
  * the stored-row repair (`repair_pair` / `sweep_async`).

The fold rule (same everywhere):
  * a misaligned row whose bucket ALSO has an aligned row is DROPPED at the write,
    serve and repair doors — the aligned row is the authoritative full-bucket
    aggregate and already contains those trades. Only at the FETCH door, inside one
    provider payload, is it merged in (open earliest, H/L extremes, close latest,
    volume summed — yfinance's own live-row fold).
  * a misaligned row with NO aligned twin is SNAPPED to its bucket start (several
    such rows in one bucket fold together). At the write door a snapped row is
    written INSERT OR IGNORE: it may fill an empty bucket but never replaces a stored
    row (that row came from a full-bucket aggregate; the next delta re-supplies the
    settled bucket). At the serve door a snapped row is emitted only when its bucket
    starts inside the read window (a `since=` read must not resend an older bucket).

Why snap rather than reject: the stray row is real data (the newest post-market
prints). Rejecting it would leave its bucket EMPTY whenever it was the only row for
that bucket — a hole the chart draws as a missing candle until a delta runs. Snapping
never fabricates a print: every value comes from the row itself, only its key moves
to where the row belongs.

60m: aligned = minute-aligned AND a bucket start on the TradingView session grid OR
the ET clock-hour grid (`bar_rollup.tv_bucket_bounds` rth/eth): either layout may be
stored by the session-aware 60m work; the pre-2026-11-10 clock-hour RTH layout is the
separate `is_old_grid_60m_ts` migration's business, not this one's. Snap target for
60m is the session grid (`bars_fetch.SIXTY_MIN_GRID`).

Kill switch: `BARS_OFFGRID_GUARD=0` (escape hatch, not a mode).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from functools import lru_cache
from typing import Iterable, Optional

_log = logging.getLogger(__name__)

#: The intraday timeframes the grid applies to (custom tfs are resampled client-side).
STEP_S = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600}

_stats_lock = threading.Lock()
_stats = {"write_folded": 0, "write_snapped": 0, "serve_folded": 0, "serve_snapped": 0,
          "serve_dropped": 0, "repair_pairs": 0, "repair_deleted": 0, "repair_snapped": 0,
          "sweep_runs": 0, "sweep_tickers": 0, "sweep_last_s": None, "merge_refused": 0}


def enabled() -> bool:
    return os.environ.get("BARS_OFFGRID_GUARD", "1") != "0"


def stats() -> dict:
    with _stats_lock:
        return dict(_stats)


def _bump(**kw) -> None:
    with _stats_lock:
        for k, v in kw.items():
            _stats[k] = (_stats.get(k) or 0) + v


def applies(tf) -> bool:
    return str(tf) in STEP_S


def bucket_start(tf, ts: int) -> int:
    """Start (unix s) of the `tf` bucket containing `ts`. 1/5/15/30: plain floor (ET
    offsets are whole hours and 30 divides the 09:30 open, so this IS the ET-session
    grid). 60: the TradingView session grid (`bars_fetch.SIXTY_MIN_GRID`)."""
    tf = str(tf)
    ts = int(ts)
    if tf != "60":
        step = STEP_S[tf]
        return ts // step * step
    from api.services.bars_fetch import bucket_60_et_unix_seconds
    return bucket_60_et_unix_seconds(ts)


def is_aligned(tf, ts) -> bool:
    """True when `ts` is a bucket start for `tf` (non-grid tfs: always True)."""
    tf = str(tf)
    step = STEP_S.get(tf)
    if step is None:
        return True
    try:
        ts = int(ts)
    except (TypeError, ValueError):
        return True     # not ours to judge (date keys etc.)
    if tf != "60":
        return ts % step == 0
    if ts % 1800:
        return False    # every 60m start on either grid is on a :00 or :30
    if ts % 3600 == 0:
        return True     # an ET clock hour: an `eth` start (ET offsets are whole hours)
    # A :30 is a start only on the session grid, inside the regular session
    # (09:30 … the last bar before the close) — the `rth` rule of tv_bucket_bounds,
    # computed without a zone lookup per row (a 60m serve is ~30k rows).
    off, ymd = _et_day(ts)
    m = ((ts + off) % 86400) // 60
    return 570 <= m < _close_min(ymd)


@lru_cache(maxsize=8192)
def _et_day_cached(utc_day: int) -> tuple[int, int]:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    # Noon UTC: after the 06:00/07:00 UTC DST switch, so right for every RTH instant.
    dt = datetime.fromtimestamp(utc_day * 86400 + 43200, tz=ZoneInfo("America/New_York"))
    return int(dt.utcoffset().total_seconds()), dt.year * 10000 + dt.month * 100 + dt.day


def _et_day(ts: int) -> tuple[int, int]:
    return _et_day_cached(ts // 86400)


def _close_min(ymd: int) -> int:
    try:
        from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
        if ymd in NYSE_EARLY_CLOSES_YYYYMMDD:
            return 780
    except Exception:  # noqa: BLE001 — calendar unreadable → regular day
        pass
    return 960


def _fold_into(acc: dict, b: dict, b_is_later: bool) -> None:
    """Merge `b` into `acc` in place (OHLCV fold). `b_is_later` decides open/close."""
    if b_is_later:
        acc["c"] = b.get("c")
    else:
        acc["o"] = b.get("o")
    try:
        acc["h"] = max(x for x in (acc.get("h"), b.get("h")) if x is not None)
        acc["l"] = min(x for x in (acc.get("l"), b.get("l")) if x is not None)
    except ValueError:
        pass
    acc["v"] = int(acc.get("v") or 0) + int(b.get("v") or 0)


def fold(tf, bars: list[dict], window_start: Optional[int] = None, twin: str = "drop",
         ) -> tuple[list[dict], list[dict], int]:
    """Apply the fold rule to `bars` (dicts with int `t`).

    ``twin`` decides a misaligned row whose bucket HAS an aligned row:
      * ``"drop"`` (default — write, serve, repair): the aligned row wins untouched. A
        stored twin is a full-bucket aggregate (Massive) that already contains the
        stray's trades; merging would double-count volume, take a possibly-older close
        and widen H/L with another vendor's prints (integrator review, PR #1062).
      * ``"merge"`` (fetch door only, ONE provider payload): fold it in — yfinance's own
        live-row fix (open earlier, H/L extremes, close later, volume summed).

    Returns ``(aligned_out, snapped, n_misaligned)``:
      * ``aligned_out`` — every aligned row (twins dropped or merged per ``twin``), ascending;
      * ``snapped`` — buckets that had ONLY misaligned rows, re-keyed to the bucket
        start (dropped when ``window_start`` is given and the bucket starts before it);
      * ``n_misaligned`` — how many input rows were off the grid (0 ⇒ input untouched).
    Fast path: no misaligned row ⇒ the input list itself is returned (no copy)."""
    tf = str(tf)
    if not applies(tf) or not bars or not enabled():
        return bars, [], 0
    bad_idx = []
    for i, b in enumerate(bars):
        t = b.get("t")
        if isinstance(t, int) and not is_aligned(tf, t):
            bad_idx.append(i)
    if not bad_idx:
        return bars, [], 0
    bad_set = set(bad_idx)
    good: dict[int, dict] = {}
    order: list[int] = []
    for i, b in enumerate(bars):
        if i in bad_set:
            continue
        t = b.get("t")
        if isinstance(t, int):
            if t not in good:
                order.append(t)
            good[t] = dict(b)
        else:
            order.append(id(b))
            good[id(b)] = b   # non-int key: pass through untouched
    lone: dict[int, dict] = {}
    for i in sorted(bad_idx, key=lambda j: bars[j]["t"]):
        b = bars[i]
        start = bucket_start(tf, b["t"])
        tw = good.get(start)
        if tw is not None:
            if twin == "merge":
                # A misaligned row is always LATER than its bucket start.
                _fold_into(tw, b, b_is_later=True)
        elif start in lone:
            _fold_into(lone[start], b, b_is_later=True)
        else:
            nb = dict(b)
            nb["t"] = start
            lone[start] = nb
    aligned_out = [good[k] for k in order]
    snapped = [lone[k] for k in sorted(lone)
               if window_start is None or k >= int(window_start)]
    return aligned_out, snapped, len(bad_idx)


def normalize(tf, bars: list[dict]) -> list[dict]:
    """A provider payload on the grid: misaligned rows folded/snapped, ascending.
    Used at the fetch door (the yfinance live row)."""
    out, snapped, n = fold(tf, bars, twin="merge")
    if not n:
        return bars
    return sorted(out + snapped, key=_sort_key)


def fold_for_serve(tf, bars: list[dict], ticker: Optional[str] = None) -> list[dict]:
    """The serve chokepoint's guard: never emit a misaligned row. Snapped buckets are
    emitted only when they start at/after the read's first row (`since=` reads must
    not resend an older bucket). Queues a background repair of the stored pair."""
    out, snapped, n = fold(tf, bars, window_start=_first_int_t(bars))
    if not n:
        return bars
    if snapped:
        out = sorted(out + snapped, key=_sort_key)
    _bump(serve_dropped=n - _count_lone_rows(bars, tf, snapped), serve_snapped=len(snapped))
    if ticker:
        lo = min(int(b["t"]) for b in bars
                 if isinstance(b.get("t"), int) and not is_aligned(tf, b["t"]))
        request_repair(ticker, tf, lo)
    return out


def _first_int_t(bars) -> Optional[int]:
    for b in bars:
        if isinstance(b.get("t"), int):
            return int(b["t"])
    return None


def _count_lone_rows(bars, tf, snapped) -> int:
    if not snapped:
        return 0
    keys = {b["t"] for b in snapped}
    return sum(1 for b in bars if isinstance(b.get("t"), int)
               and not is_aligned(tf, b["t"]) and bucket_start(tf, b["t"]) in keys)


def _sort_key(b):
    t = b.get("t")
    return t if isinstance(t, int) else 0


def fold_for_write(ticker: str, tf, bars: list[dict]) -> tuple[list[dict], list[dict]]:
    """The write door's invariant: ``(rows to write with the caller's verb,
    snapped rows to write INSERT OR IGNORE)``. Logs and counts any misaligned input."""
    out, snapped, n = fold(tf, bars)
    if not n:
        return bars, []
    _bump(write_folded=n - _count_lone_rows(bars, tf, snapped), write_snapped=len(snapped))
    _log.warning("[bars-grid] %s tf=%s: %d off-grid row(s) at the write door "
                 "(%d dropped beside their bucket row, %d snapped add-only)",
                 ticker, tf, n, n - _count_lone_rows(bars, tf, snapped), len(snapped))
    return out, snapped


# ── stored-row repair ─────────────────────────────────────────────────────────

#: Reach of the boot sweep below each pair's newest row (the yfinance fallback writes
#: at most 60 days of 5/15/30m and 7 days of 1m; the margin covers older fetches).
SWEEP_DAYS = float(os.environ.get("BARS_OFFGRID_SWEEP_DAYS", "120"))
#: Pause between tickers so the sweep never competes with serving for the GIL / lock.
SWEEP_PAUSE_S = float(os.environ.get("BARS_OFFGRID_SWEEP_PAUSE_S", "0.002"))


def _misaligned_rows(c, ticker: str, tf: str, lo: int) -> list[tuple]:
    """Stored rows of (ticker, tf) at/after `lo` that are not bucket starts. One
    PK-prefixed range read; the modulo filter runs inside SQLite."""
    step = 1800 if tf == "60" else STEP_S[tf]
    rows = c.execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts>=? AND (ts % ?) != 0",
        (ticker, tf, int(lo), step)).fetchall()
    if tf != "60":
        return rows
    # 60m: every start on either grid sits on :00 or :30, so the prefilter above is
    # necessary but not sufficient — a :30 outside the regular session is off-grid too.
    extra = c.execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='60' AND ts>=? "
        "AND (ts % 3600) = 1800", (ticker, int(lo))).fetchall()
    return rows + [r for r in extra if not is_aligned("60", r[0])]


def repair_pair(ticker: str, tf, lo: int = 0) -> dict:
    """Repair stored misaligned rows of (ticker, tf) at/after `lo`: delete each one whose
    bucket has an aligned row, snap the rest into their bucket (INSERT OR IGNORE, then
    delete the stray). One short transaction under the store's write lock; idempotent
    (a second run finds nothing)."""
    from api.services import bars_sqlite
    tf = str(tf)
    ticker = (ticker or "").upper()
    res = {"deleted": 0, "snapped": 0}
    if not applies(tf) or not ticker:
        return res
    c = bars_sqlite._conn()
    bad = _misaligned_rows(c, ticker, tf, lo)
    if not bad:
        return res
    by_bucket: dict[int, list[tuple]] = {}
    for r in bad:
        by_bucket.setdefault(bucket_start(tf, r[0]), []).append(r)
    starts = sorted(by_bucket)
    have = set()
    for i in range(0, len(starts), 500):
        chunk = starts[i:i + 500]
        qs = ",".join("?" for _ in chunk)
        have.update(t for (t,) in c.execute(
            f"SELECT ts FROM ohlcv WHERE ticker=? AND tf=? AND ts IN ({qs})",
            [ticker, tf, *chunk]).fetchall())
    inserts = []
    for start in starts:
        if start in have:
            continue
        grp = sorted(by_bucket[start], key=lambda r: r[0])
        acc = {"t": start, "o": grp[0][1], "h": grp[0][2], "l": grp[0][3],
               "c": grp[0][4], "v": int(grp[0][5] or 0)}
        for r in grp[1:]:
            _fold_into(acc, {"o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}, True)
        inserts.append((ticker, tf, start, acc["o"], acc["h"], acc["l"], acc["c"], acc["v"]))
    with bars_sqlite._WRITE_LOCK:
        if inserts:
            c.executemany("INSERT OR IGNORE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) "
                          "VALUES(?,?,?,?,?,?,?,?)", inserts)
        c.executemany("DELETE FROM ohlcv WHERE ticker=? AND tf=? AND ts=?",
                      [(ticker, tf, r[0]) for r in bad])
        c.commit()
    res["deleted"] = len(bad)
    res["snapped"] = len(inserts)
    _bump(repair_pairs=1, repair_deleted=len(bad), repair_snapped=len(inserts))
    _log.info("[bars-grid] repaired %s tf=%s: %d off-grid row(s) removed, %d bucket(s) "
              "filled from them", ticker, tf, len(bad), len(inserts))
    try:
        from api.services.cache import cache
        cache.delete_prefix(f"bars_{ticker}_{tf}_")
    except Exception:  # noqa: BLE001 — cache keys are best-effort
        pass
    return res


_queue_lock = threading.Lock()
_queue: dict[tuple[str, str], int] = {}
_queue_event = threading.Event()
_worker_started = False
#: A bound on pending read-triggered repairs (a pathological store cannot grow it).
QUEUE_MAX = 2048


def request_repair(ticker: str, tf, lo: int) -> None:
    """Queue a background repair of one pair (deduped; never blocks a read)."""
    global _worker_started
    if os.environ.get("BARS_OFFGRID_REPAIR", "1") == "0":
        return
    if os.environ.get("PYTEST_CURRENT_TEST") and not os.environ.get("BARS_OFFGRID_REPAIR_IN_TESTS"):
        return   # a background thread outliving a test's monkeypatched store (cf. tail gap-fill)
    key = ((ticker or "").upper(), str(tf))
    with _queue_lock:
        if key not in _queue and len(_queue) >= QUEUE_MAX:
            return
        prev = _queue.get(key)
        _queue[key] = int(lo) if prev is None else min(prev, int(lo))
        start = not _worker_started
        _worker_started = True
    if start:
        threading.Thread(target=_repair_loop, daemon=True, name="bars-offgrid-repair").start()
    _queue_event.set()


def _repair_loop() -> None:
    while True:
        _queue_event.wait(timeout=30)
        _queue_event.clear()
        while True:
            with _queue_lock:
                if not _queue:
                    break
                key, lo = next(iter(_queue.items()))
                del _queue[key]
            try:
                repair_pair(key[0], key[1], lo)
            except Exception as e:  # noqa: BLE001
                _log.warning("[bars-grid] repair %s tf=%s failed (will retry on next read): %s",
                             key[0], key[1], e)


def sweep(tickers: Optional[Iterable[str]] = None, days: Optional[float] = None) -> dict:
    """Repair every (ticker, intraday tf) in the store, newest `days` per pair. Per-ticker
    PK-prefixed range reads (never a table scan); writes only for a pair with something
    to repair, one short transaction each. Idempotent."""
    from api.services import bars_sqlite
    reach = int((SWEEP_DAYS if days is None else days) * 86400)
    t0 = time.monotonic()
    n_t = deleted = snapped = 0
    src = tickers if tickers is not None else _iter_tickers_fresh()
    for tkr in src:
        n_t += 1
        # ⛔ A FRESH connection per ticker: a snapshot install bumps the db epoch and
        # closes this thread's cached one; a handle held across the walk then fails
        # every later pair (review #1062, LOW 3).
        c = bars_sqlite._conn()
        for tf in STEP_S:
            try:
                mx = c.execute("SELECT MAX(ts) FROM ohlcv WHERE ticker=? AND tf=?",
                               (tkr, tf)).fetchone()[0]
                if mx is None:
                    continue
                r = repair_pair(tkr, tf, int(mx) - reach)
                deleted += r["deleted"]
                snapped += r["snapped"]
            except Exception as e:  # noqa: BLE001 — one pair never stops the sweep
                _log.warning("[bars-grid] sweep %s tf=%s failed (non-fatal): %s", tkr, tf, e)
        if SWEEP_PAUSE_S > 0:
            time.sleep(SWEEP_PAUSE_S)
    took = time.monotonic() - t0
    _bump(sweep_runs=1, sweep_tickers=n_t)
    with _stats_lock:
        _stats["sweep_last_s"] = round(took, 1)
    _log.info("[bars-grid] sweep: %d ticker(s), %d off-grid row(s) removed, %d bucket(s) "
              "filled, %.0fs", n_t, deleted, snapped, took)
    return {"tickers": n_t, "deleted": deleted, "snapped": snapped}


def _iter_tickers_fresh():
    """`bars_sqlite.iter_tickers`, but each PK seek on a freshly fetched connection
    (survives a db replacement mid-walk; resumes after the last ticker seen)."""
    from api.services import bars_sqlite
    current = ""
    while True:
        try:
            row = bars_sqlite._conn().execute(
                "SELECT ticker FROM ohlcv WHERE ticker>? ORDER BY ticker LIMIT 1",
                (current,)).fetchone()
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-grid] sweep ticker walk stopped at %r: %s", current, e)
            return
        if row is None:
            return
        current = row[0]
        yield current


_sweep_lock = threading.Lock()
_sweep_running = False


def sweep_async(delay_s: float = 0.0) -> bool:
    """Run `sweep` once in a daemon thread (deduped). `BARS_OFFGRID_SWEEP=0` disables."""
    global _sweep_running
    if os.environ.get("BARS_OFFGRID_SWEEP", "1") == "0" or not enabled():
        return False
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return False   # boot paths under test must not sweep a real store
    with _sweep_lock:
        if _sweep_running:
            return False
        _sweep_running = True

    def _run():
        global _sweep_running
        try:
            if delay_s > 0:
                time.sleep(delay_s)
            sweep()
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-grid] sweep failed (non-fatal): %s", e)
        finally:
            with _sweep_lock:
                _sweep_running = False

    threading.Thread(target=_run, daemon=True, name="bars-offgrid-sweep").start()
    return True
