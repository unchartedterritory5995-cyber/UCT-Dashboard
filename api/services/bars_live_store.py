"""Universe live bars on the SERVING tier (bars-api): the 5m and daily series every
member reads are kept current BEFORE anyone asks, so a read never waits on a provider.

Why this exists (measured 2026-10-14, the X-15 gate): every tf=5 read of a long-tail
ticker was a synchronous provider fetch ("miss"/"fetch") and every tf=D read was
"stale-swr". bars-api's only feed was an R2 copy every 20 minutes, so by its own
freshness rule (`bars_fetch._needs_fresh`: tf=5 older than 300 s or a new bucket;
tf=D always, during a session) nothing it held was ever current.

Two feeds keep it current:

* **5m, from the stream.** The web pod's Massive stocks socket subscribes to `AM.*`
  (every minute bar, every ticker) and forwards rolled-up 5m buckets here every few
  seconds (`api/services/bars_live_ingest.py` -> `POST /internal/live-bars`).
  A ticker is COVERED for tf=5 once (a) the stream is alive, and (b) this tier has
  REPAIRED the ticker for the current epoch. Ownership is exact, per bucket:
    - buckets at/after `first_full_bucket` (the first 5m boundary after the socket
      connected): the stream, which saw them from their first minute;
    - the BOUNDARY bucket (the one the socket connected inside): rebuilt minute by
      minute, the provider's 1m bars for the minutes before the socket plus the
      stream's own minutes (which win), and rebuilt again on every push;
    - everything before the boundary: the provider. A ticker covered in the previous
      epoch refetches only from the bucket where that epoch's feed stopped (a few
      buckets, one small call); a ticker never covered fetches BACKFILL_DAYS.
  A new epoch therefore costs a ticker one or two small provider calls, not a
  14-day refetch after a five-minute wait. Tickers members are asking for are
  repaired first.
* **Daily, from the whole-market snapshot.** One provider call returns every
  ticker's `day` bar (o/h/l/c/v so far). Polled every `BARS_LIVE_DAILY_POLL_S`.
  A ticker is COVERED for tf=D while the poll is alive and its daily history is held.

Covered means `_needs_fresh` answers False, so the read is served from SQLite at
once. Uncovered (feed down, not yet backfilled, flag off) falls back to today's path
unchanged. Kill switch: `BARS_LIVE_COVERAGE_ENABLED` (unset = OFF).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

#: The stream is "alive" while its last push is newer than this. The web pod pushes a
#: heartbeat every flush even with no rows, so silence this long means the feed died.
STREAM_ALIVE_S = float(os.environ.get("BARS_LIVE_STREAM_ALIVE_S", "30"))
DAILY_POLL_S = float(os.environ.get("BARS_LIVE_DAILY_POLL_S", "10"))
DAILY_ALIVE_S = float(os.environ.get("BARS_LIVE_DAILY_ALIVE_S", "45"))
#: Sessions of 5m history the backfill makes sure a ticker holds.
BACKFILL_DAYS = int(os.environ.get("BARS_LIVE_BACKFILL_DAYS", "14"))
BACKFILL_WORKERS = int(os.environ.get("BARS_LIVE_BACKFILL_WORKERS", "16"))
BUCKET_S = 300
#: A thin ticker's backfilled 5m history counts as complete only for requests up to
#: this size (the chart's first paint asks for at most 1,199). Deeper requests keep
#: today's depth path, so a covered ticker never serves a truncated deep history.
LIVE_HISTORY_MAX_BARS = 1200
#: A covered serve is cached this long in memory (the normal 5m/D TTLs are 5-300 s;
#: a live daily bar cached 300 s would freeze the developing candle for 5 minutes).
COVERED_CACHE_TTL = {"5": 5, "D": 10}

_lock = threading.Lock()
_state = {
    "epoch_ms": None,             # when the web pod's current socket connected
    "first_full_bucket_ms": None,  # stream owns buckets starting at/after this
    "last_push_mono": None,
    "watermark_ms": None,         # newest minute the stream has delivered
    "pushes": 0,
    "rows_written": 0,
    "daily_last_ok_mono": None,
    "daily_rows_written": 0,
    "daily_polls": 0,
    "backfill_epoch": None,       # the epoch the current backfill pass serves
    "backfill_done": 0,
    "backfill_failed": 0,
    "backfill_started_at": None,
    "backfill_finished_at": None,
    "backfill_gap_repairs": 0,
    "backfill_full": 0,
    "resyncs_requested": 0,
}
#: Tickers backfilled for the CURRENT epoch (5m covered once the stream is alive).
_covered5: set[str] = set()
#: Tickers whose deep 5m history the provider has fully returned (holds fewer rows
#: than a request only because the ticker trades thinly or is young).
_history5_complete: set[str] = set()
#: Tickers the daily poll saw this session (covered for D while the poll is alive).
_daily_seen: set[str] = set()
#: Recent stream buckets per ticker, re-applied after a backfill write so a
#: provider snapshot taken mid-bucket can never regress a bucket the stream owns.
_recent: dict[str, dict[int, tuple]] = {}
#: The last daily row written per ticker (skip unchanged rewrites).
_last_daily: dict[str, tuple] = {}
#: sym -> the bucket (unix s) from which its stored 5m series may be incomplete: where
#: the feed of the epoch that last covered it stopped. Absent = never covered here.
_gap_from: dict[str, int] = {}
#: The boundary bucket of the current epoch, minute by minute.
#: Stream minutes: sym -> minute_s -> (o, h, l, c, v). Provider minutes likewise.
_b0_stream: dict[str, dict[int, tuple]] = {}
_b0_provider: dict[str, dict[int, tuple]] = {}
#: Tickers a read found uncovered while a repair pass runs (repaired first).
_urgent: list[str] = []
_urgent_set: set[str] = set()
#: Bumped whenever a ticker's stream minutes for the boundary bucket change.
_b0_ver: dict[str, int] = {}
_b0_write_lock = threading.Lock()
_backfill_wakeup = threading.Event()
_threads_started = False


def enabled() -> bool:
    return os.environ.get("BARS_LIVE_COVERAGE_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def _now_mono() -> float:
    return time.monotonic()


def stream_alive() -> bool:
    t = _state["last_push_mono"]
    return t is not None and (_now_mono() - t) <= STREAM_ALIVE_S


def daily_alive() -> bool:
    t = _state["daily_last_ok_mono"]
    return t is not None and (_now_mono() - t) <= DAILY_ALIVE_S


def covered(ticker: str, tf: str) -> bool:
    """True when `ticker`'s `tf` series is current by construction (see module doc)."""
    if not enabled():
        return False
    sym = (ticker or "").upper()
    if tf == "5":
        if sym in _covered5:
            return stream_alive()
        if sym not in _urgent_set:
            with _lock:
                if sym not in _urgent_set:
                    _urgent_set.add(sym)
                    _urgent.append(sym)
            _backfill_wakeup.set()
        return False
    if tf == "D":
        return daily_alive() and sym in _daily_seen and _daily_contiguous(sym)
    return False


#: sym -> (today_ymd, verdict). Re-checked once per ticker per day, and again after
#: any failed check (a later R2 merge or fetch can fill the missing session).
_contig: dict[str, tuple[int, bool]] = {}


def _prev_session_ymd(today: datetime) -> int:
    from api.services.bars_fetch import _is_nyse_holiday
    d = today - timedelta(days=1)
    for _ in range(14):
        ymd = int(d.strftime("%Y%m%d"))
        if d.weekday() < 5 and not _is_nyse_holiday(ymd):
            return ymd
        d -= timedelta(days=1)
    return int(d.strftime("%Y%m%d"))


def _daily_contiguous(sym: str) -> bool:
    """The stored daily series runs unbroken into today: its newest bar before today is
    the previous session. Without this a ticker whose stored history ended last week
    would be served with today's snapshot bar sitting after a silent gap."""
    now = datetime.now(_ET)
    today = int(now.strftime("%Y%m%d"))
    hit = _contig.get(sym)
    if hit and hit[0] == today and hit[1]:
        return True
    from api.services import bars_sqlite
    try:
        c = bars_sqlite._conn()
        row = c.execute("SELECT MAX(ts) FROM ohlcv WHERE ticker=? AND tf='D' AND ts<?",
                        (sym, today)).fetchone()
        ok = bool(row and row[0] == _prev_session_ymd(now))
    except Exception:
        ok = False
    _contig[sym] = (today, ok)
    return ok


def history_complete(ticker: str, tf: str) -> bool:
    return tf == "5" and (ticker or "").upper() in _history5_complete


def covered_cache_ttl(tf: str, default: int) -> int:
    return COVERED_CACHE_TTL.get(tf, default)


# ── stream ingest (5m) ────────────────────────────────────────────────────────

def ingest(payload: dict) -> dict:
    """Apply one push from the web pod. Payload:
    `{"epoch_ms", "seq", "first_full_bucket_ms", "watermark_ms", "rows": [[sym, ts, o, h, l, c, v], ...],
      "minutes": [[sym, minute_s, o, h, l, c, v], ...]}`
    `rows` are 5m buckets (`ts` = bucket start, unix SECONDS, the stored key for
    tf=5); `minutes` are the boundary bucket's minutes. `seq` counts the epoch's
    acknowledged pushes: a NEW epoch arriving with seq > 1 means pushes went to a
    process before this one, which this one cannot vouch for, so it asks for a resync."""
    epoch = payload.get("epoch_ms")
    ffb = payload.get("first_full_bucket_ms")
    seq = int(payload.get("seq") or 1)
    rows = payload.get("rows") or []
    with _lock:
        if epoch is not None and epoch != _state["epoch_ms"]:
            if seq > 1:
                _state["resyncs_requested"] += 1
                return {"accepted": 0, "resync": True, "epoch_ms": _state["epoch_ms"]}
            _begin_epoch_locked(epoch, ffb)
        _state["last_push_mono"] = _now_mono()
        if payload.get("watermark_ms"):
            _state["watermark_ms"] = payload["watermark_ms"]
        _state["pushes"] += 1
        min_ts = (_state["first_full_bucket_ms"] or 0) // 1000
        clean = []
        for r in rows:
            try:
                sym, ts, o, h, l, c, v = r
                sym = str(sym).upper()
                ts = int(ts)
            except Exception:
                continue
            if ts < min_ts:
                continue  # a bucket the stream does not fully own
            row = (sym, ts, float(o), float(h), float(l), float(c), int(v or 0))
            clean.append(row)
        b0 = min_ts - BUCKET_S
        moved_b0 = set()
        for m in payload.get("minutes") or ():
            try:
                sym, mts, o, h, l, c, v = m
                sym = str(sym).upper()
                mts = int(mts)
            except Exception:
                continue
            if not (b0 <= mts < min_ts):
                continue
            _b0_stream.setdefault(sym, {})[mts] = (float(o), float(h), float(l), float(c), int(v or 0))
            _b0_ver[sym] = _b0_ver.get(sym, 0) + 1
            moved_b0.add(sym)
        rebuild = [s_ for s_ in moved_b0 if s_ in _covered5]
    n = _write_rows("5", clean) if clean else 0
    if rebuild:
        n += _write_b0(rebuild, epoch)
    with _lock:
        _state["rows_written"] += n
    return {"accepted": n, "epoch_ms": _state["epoch_ms"]}


def _begin_epoch_locked(epoch: int, ffb: Optional[int]) -> None:
    """A new socket (or a resync). Every ticker covered so far keeps a note of where
    its series may have stopped being complete, so its repair is a small refetch."""
    wm = _state["watermark_ms"]
    if wm and _covered5:
        stop = (int(wm) // 1000) // BUCKET_S * BUCKET_S
        for sym in _covered5:
            prev = _gap_from.get(sym)
            _gap_from[sym] = stop if prev is None else min(prev, stop)
    _state["epoch_ms"] = epoch
    _state["first_full_bucket_ms"] = ffb
    _covered5.clear()
    _b0_stream.clear()
    _b0_provider.clear()
    _b0_ver.clear()
    _urgent.clear()
    _urgent_set.clear()
    _backfill_wakeup.set()


def b0_row(sym: str, b0: int) -> Optional[tuple]:
    """The boundary bucket from its minutes: the stream's minute wins over the provider's."""
    mins = dict(_b0_provider.get(sym) or {})
    mins.update(_b0_stream.get(sym) or {})
    mins = {t: r for t, r in mins.items() if b0 <= t < b0 + BUCKET_S}
    if not mins:
        return None
    ordered = [mins[t] for t in sorted(mins)]
    return (sym, b0, ordered[0][0], max(r[1] for r in ordered), min(r[2] for r in ordered),
            ordered[-1][3], sum(r[4] for r in ordered))


def _write_b0(syms: Iterable[str], epoch) -> int:
    with _b0_write_lock:
        with _lock:
            if _state["epoch_ms"] != epoch or _state["first_full_bucket_ms"] is None:
                return 0
            b0 = _state["first_full_bucket_ms"] // 1000 - BUCKET_S
            rows = [r for r in (b0_row(s_, b0) for s_ in syms) if r is not None]
        return _write_rows("5", rows) if rows else 0


def _write_rows(tf: str, rows: list[tuple]) -> int:
    """One transaction for the whole batch, through the store's own write path so the
    impossible-bar gate still applies."""
    from api.services import bars_sqlite
    by_sym: dict[str, list[dict]] = {}
    for sym, ts, o, h, l, c, v in rows:
        by_sym.setdefault(sym, []).append({"t": ts, "o": o, "h": h, "l": l, "c": c, "v": v})
    return bars_sqlite.put_bars_many(tf, by_sym)


# ── backfill (fills the reconnect gap and any missing history) ────────────────

def _session_start_ms(now: datetime) -> int:
    return int(now.replace(hour=4, minute=0, second=0, microsecond=0).timestamp() * 1000)


def _universe() -> list[str]:
    try:
        from api.services import cap_universe
        return [s.upper() for s in cap_universe.symbols()]
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-live] universe unavailable: %s", e)
        return []


def _fetch(sym: str, mult: int, frm, to) -> list[dict]:
    """Provider aggregates, raising on failure (an error must never read as "no bars")."""
    from api.services import bars_fetch
    return bars_fetch._fetch_intraday_range(sym, str(mult), str(frm), str(to), raise_errors=True)


def _backfill_one(sym: str, epoch: int, ffb_s: int) -> bool:
    """Repair `sym` for the current epoch (ownership rules in the module doc)."""
    from api.services import bars_sqlite
    b0 = ffb_s - BUCKET_S
    gap = _gap_from.get(sym)
    if gap is None:
        now = datetime.now(_ET)
        frm = (now - timedelta(days=BACKFILL_DAYS)).strftime("%Y-%m-%d")
        bars = _fetch(sym, 5, frm, now.strftime("%Y-%m-%d"))
        full = True
    elif gap < b0:
        bars = _fetch(sym, 5, gap * 1000, b0 * 1000 - 1)
        full = False
    else:
        bars, full = [], False
    mins = _fetch(sym, 1, b0 * 1000, (b0 + BUCKET_S) * 1000 - 1)
    closed = [b for b in bars if int(b["t"]) < b0]
    if closed:
        bars_sqlite.put_bars(sym, "5", closed)
    provider = {int(m["t"]): (float(m["o"]), float(m["h"]), float(m["l"]), float(m["c"]),
                              int(m["v"] or 0))
                for m in mins if b0 <= int(m["t"]) < b0 + BUCKET_S}
    with _b0_write_lock:
        with _lock:
            if _state["epoch_ms"] != epoch:
                return False  # the socket changed under us; the next pass redoes it
            _b0_provider[sym] = provider
            ver = _b0_ver.get(sym, 0)
            row = b0_row(sym, b0)
        if row is not None:
            _write_rows("5", [row])
    with _lock:
        if _state["epoch_ms"] != epoch:
            return False
        _covered5.add(sym)
        # A stream minute that landed between the snapshot above and this line was not
        # rebuilt by its push (the ticker was not covered yet): rebuild it now.
        stale = _b0_ver.get(sym, 0) != ver
        _gap_from.pop(sym, None)
        _state["backfill_full" if full else "backfill_gap_repairs"] += 1
        if full:
            # The range above starts BACKFILL_DAYS back; a ticker that returned fewer
            # bars than a deep request asks for simply has no more in that window.
            _history5_complete.add(sym)
    if stale:
        _write_b0([sym], epoch)
    return True


def _next_todo(todo: list[str], pos: list[int]) -> Optional[str]:
    """The next ticker to repair: one a member is waiting on first, then the universe."""
    with _lock:
        while _urgent:
            sym = _urgent.pop(0)
            if sym not in _covered5:
                return sym
        while pos[0] < len(todo):
            sym = todo[pos[0]]
            pos[0] += 1
            if sym not in _covered5:
                return sym
    return None


def _backfill_pass() -> None:
    with _lock:
        epoch = _state["epoch_ms"]
        ffb = _state["first_full_bucket_ms"]
    if epoch is None or ffb is None:
        return
    with _lock:
        _state["backfill_epoch"] = epoch
        _state["backfill_done"] = 0
        _state["backfill_failed"] = 0
        _state["backfill_started_at"] = time.time()
        _state["backfill_finished_at"] = None
    universe = _universe()
    # Previously covered tickers are one small call each; do them before cold ones.
    todo = sorted((s_ for s_ in universe if s_ not in _covered5), key=lambda s_: s_ not in _gap_from)
    ffb_s = ffb // 1000
    pos = [0]

    def _worker() -> None:
        while True:
            with _lock:
                if _state["epoch_ms"] != epoch:
                    return
            sym = _next_todo(todo, pos)
            if sym is None:
                return
            try:
                ok = _backfill_one(sym, epoch, ffb_s)
            except Exception as e:  # noqa: BLE001
                ok = False
                from api.services.log_redaction import redact
                _log.debug("[bars-live] repair %s failed: %s", sym, redact(str(e)))
            with _lock:
                _state["backfill_done" if ok else "backfill_failed"] += 1

    workers = [threading.Thread(target=_worker, daemon=True, name=f"bars-live-bf-{i}")
               for i in range(BACKFILL_WORKERS)]
    for w in workers:
        w.start()
    for w in workers:
        w.join()
    with _lock:
        _state["backfill_finished_at"] = time.time()
        took = _state["backfill_finished_at"] - _state["backfill_started_at"]
    if not todo and not _state["backfill_done"] and not _state["backfill_failed"]:
        return
    _log.info("[bars-live] repair pass for epoch %s: %d covered, %d failed of %d in %.0fs "
              "(gap repairs so far %d, full %d)",
              epoch, _state["backfill_done"], _state["backfill_failed"], len(todo), took,
              _state["backfill_gap_repairs"], _state["backfill_full"])


def _backfill_loop() -> None:
    while True:
        # A pass that left failures is retried after a minute; a new epoch starts at once.
        _backfill_wakeup.wait(timeout=60)
        _backfill_wakeup.clear()
        try:
            if enabled():
                _backfill_pass()
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-live] backfill loop error: %s", e)


# ── daily (whole-market snapshot) ─────────────────────────────────────────────

def _in_daily_window(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    try:
        from api.services.bars_fetch import _is_nyse_holiday
        if _is_nyse_holiday(int(now.strftime("%Y%m%d"))):
            return False
    except Exception:
        pass
    hm = now.hour * 100 + now.minute
    return 400 <= hm < 2000


def daily_rows_from_snapshot(tickers: Iterable[dict], today_ymd: int) -> list[tuple]:
    """Today's daily bar per ticker from the provider's whole-market snapshot `day`.
    A ticker with no regular-session print yet (zeros) gets no row: its newest stored
    daily bar (yesterday) is then the truth, exactly as the provider's daily series."""
    out = []
    for t in tickers:
        sym = t.get("ticker")
        day = t.get("day") or {}
        try:
            o, h, l, c, v = (float(day.get(k) or 0) for k in ("o", "h", "l", "c", "v"))
        except (TypeError, ValueError):
            continue
        if not sym or min(o, h, l, c) <= 0:
            continue
        out.append((sym.replace(".", "-").upper(), today_ymd, o, h, l, c, int(v)))
    return out


def _daily_poll_once(last: Optional[dict] = None) -> tuple[int, set]:
    """One whole-market snapshot -> today's daily rows. Returns (rows written, every
    ticker seen). Runs in the CHILD process (`_daily_child`): parsing a ~13k-ticker
    snapshot holds the GIL for 150-230 ms, and in the serving process that stalled
    every chart read queued behind it (measured 2026-10-14 against bars-api /health)."""
    from api.services import massive_adapter
    last = _last_daily if last is None else last
    data = massive_adapter.get(
        "/v2/snapshot/locale/us/markets/stocks/tickers", data_class="bars",
        activity="bars_live_store.daily_poll").value or {}
    tickers = data.get("tickers") or []
    if not tickers:
        return 0, set()
    today = int(datetime.now(_ET).strftime("%Y%m%d"))
    # Only bars that moved since the last poll: an unchanged ticker's stored row is
    # already exact, and rewriting ~13k rows every poll would crowd the write lock.
    rows = [r for r in daily_rows_from_snapshot(tickers, today) if last.get(r[0]) != r]
    n = _write_rows("D", rows) if rows else 0
    for r in rows:
        last[r[0]] = r
    seen = {str(t.get("ticker", "")).replace(".", "-").upper() for t in tickers if t.get("ticker")}
    return n, seen


def _daily_child(q, poll_s: float) -> None:
    """Long-lived child process: poll, write, and report (time, rows, NEW tickers) to
    the parent. Only new tickers cross the pipe, so a report is a few bytes."""
    last: dict = {}
    reported: set = set()
    while True:
        try:
            if enabled() and _in_daily_window(datetime.now(_ET)):
                n, seen = _daily_poll_once(last)
                if seen:
                    fresh = seen - reported
                    reported |= fresh
                    q.put(("ok", n, sorted(fresh)))
        except Exception as e:  # noqa: BLE001
            try:
                q.put(("err", 0, str(e)[:200]))
            except Exception:
                pass
        time.sleep(poll_s)


def apply_daily_report(msg) -> None:
    """Parent side of the child's report."""
    kind, n, payload = msg
    if kind != "ok":
        _log.warning("[bars-live] daily poll failed: %s", payload)
        return
    with _lock:
        _daily_seen.update(payload or ())
        _state["daily_last_ok_mono"] = _now_mono()
        _state["daily_rows_written"] += int(n or 0)
        _state["daily_polls"] += 1


def _daily_listener(q) -> None:
    while True:
        try:
            apply_daily_report(q.get())
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-live] daily listener error: %s", e)
            time.sleep(1)


def _daily_loop() -> None:
    """In-process fallback, used only if the child process cannot start."""
    while True:
        try:
            if enabled() and _in_daily_window(datetime.now(_ET)):
                n, seen = _daily_poll_once()
                if seen:
                    apply_daily_report(("ok", n, sorted(seen)))
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-live] daily poll failed: %s", e)
        time.sleep(DAILY_POLL_S)


def _start_daily() -> str:
    try:
        import multiprocessing as mp
        ctx = mp.get_context("spawn")
        q = ctx.Queue()
        p = ctx.Process(target=_daily_child, args=(q, DAILY_POLL_S), daemon=True,
                        name="bars-live-daily")
        p.start()
        threading.Thread(target=_daily_listener, args=(q,), daemon=True,
                         name="bars-live-daily-listener").start()
        return f"process pid={p.pid}"
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-live] daily child process failed (%s); polling in-process", e)
        threading.Thread(target=_daily_loop, daemon=True, name="bars-live-daily").start()
        return "thread"


def start() -> None:
    global _threads_started
    if _threads_started:
        return
    _threads_started = True
    threading.Thread(target=_backfill_loop, daemon=True, name="bars-live-backfill").start()
    how = _start_daily()
    _log.info("[bars-live] started (enabled=%s, daily poll in %s)", enabled(), how)


def status() -> dict:
    with _lock:
        s = dict(_state)
        s["covered5"] = len(_covered5)
        s["gap_pending"] = len(_gap_from)
        s["b0_stream_tickers"] = len(_b0_stream)
        s["daily_seen"] = len(_daily_seen)
    s["enabled"] = enabled()
    s["stream_alive"] = stream_alive()
    s["daily_alive"] = daily_alive()
    lp = s.pop("last_push_mono")
    s["last_push_age_s"] = None if lp is None else round(_now_mono() - lp, 1)
    dl = s.pop("daily_last_ok_mono")
    s["daily_age_s"] = None if dl is None else round(_now_mono() - dl, 1)
    return s


def _reset_for_tests() -> None:
    with _lock:
        for k in _state:
            _state[k] = 0 if isinstance(_state[k], int) and k not in (
                "epoch_ms", "first_full_bucket_ms", "watermark_ms", "backfill_epoch") else None
        for k in ("pushes", "rows_written", "daily_rows_written", "daily_polls",
                  "backfill_done", "backfill_failed"):
            _state[k] = 0
        _covered5.clear()
        _history5_complete.clear()
        _daily_seen.clear()
        _recent.clear()
        _contig.clear()
        _last_daily.clear()
        _gap_from.clear()
        _b0_stream.clear()
        _b0_provider.clear()
        _urgent.clear()
        _urgent_set.clear()
        _b0_ver.clear()
        for k in ("backfill_gap_repairs", "backfill_full", "resyncs_requested"):
            _state[k] = 0
