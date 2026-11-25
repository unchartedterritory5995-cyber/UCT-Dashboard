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

**Restarts of this tier** (2026-10-15: a deploy at 15:53 ET cost a 229 s full
repair of the whole universe). Coverage is checkpointed into bars.db itself every
`BARS_LIVE_CKPT_S` (see `save_checkpoint`). On boot the checkpoint is read back: if the
web pod's socket is the SAME one (same epoch), every ticker it covered is covered again
at once, because every push it acknowledged was committed to this database before the
acknowledgement; otherwise each ticker repairs only from where that feed stopped. The
checkpoint lives in bars.db so a database replaced by an R2 snapshot carries none,
and the tier then does a full repair, as before.

Covered means `_needs_fresh` answers False, so the read is served from SQLite at
once. Uncovered (feed down, not yet backfilled, flag off) falls back to today's path
unchanged. Kill switch: `BARS_LIVE_COVERAGE_ENABLED` (unset = OFF).

**1m, on demand** (`BARS_LIVE_1M_ENABLED`, unset = OFF; needs the coverage flag too,
and the web pod's forwarder must carry the same flag). Measured 2026-11-16: a 1m read
whose stored tail was older than the freshness rule paid a 1.2-2.0 s provider fetch on
the request path. Every AM event IS a complete 1m bar, so the stream can keep a 1m
series current exactly like 5m, without a boundary bucket. Not universe-wide (that
would be millions of rows): a ticker is COVERED for tf=1 only after a member's read
asked for it and this tier REPAIRED it for the current epoch:
  - the push's `m1` carries every minute of each dirty bucket; ALL of them go into a
    bounded recent-minutes ring (`_recent1`, the last `BARS_LIVE_1M_RECENT_S`, at most
    `BARS_LIVE_1M_RECENT_MAX` entries), and only a COVERED ticker's are written;
  - a repair fetches the provider's 1m from the ticker's stored tail (from where the
    last epoch's feed stopped, for a ticker covered before; `BARS_LIVE_1M_DEPTH_DAYS`
    when nothing is stored) through the newest CLOSED minute, then writes the ring's
    minutes over it (the stream wins), then marks it covered. A minute that lands
    between that overlay and the coverage flip is rewritten (`_m1_ver`, as `_b0_ver`);
  - a new epoch uncovers every ticker (the socket may have missed minutes), notes
    where each one stopped and re-queues it, so its repair is one small refetch;
  - a push WITHOUT `m1` (the forwarder is not carrying minutes) uncovers everything.
Repairs run on their own worker threads (`BARS_LIVE_1M_WORKERS`), never on a request
or event-loop thread; only member (interactive) reads queue one.
"""
from __future__ import annotations

import json
import logging
import os
import sys
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
COVERED_CACHE_TTL = {"1": 5, "5": 5, "D": 10,
                     # 15m/30m/60m rebuilt from the live 5m (`bars_fetch._live_derive_on_read`)
                     "15": 5, "30": 5, "60": 5}

_lock = threading.Lock()
_state = {
    "epoch_ms": None,             # when the web pod's current socket connected
    "first_full_bucket_ms": None,  # stream owns buckets starting at/after this
    "last_push_mono": None,
    "watermark_ms": None,         # newest minute the stream has delivered
    "watermark_epoch": None,      # the epoch `watermark_ms` was pushed in (it only grows within one)
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
#: Coverage checkpoint (see the module doc). Seconds between saves.
CKPT_EVERY_S = float(os.environ.get("BARS_LIVE_CKPT_S", "15"))
_ckpt = {"last_mono": None, "saves": 0, "save_errors": 0, "loaded": None, "adopted": 0}
#: The checkpoint read at boot, until the first push says whether its socket survived.
_restored: Optional[dict] = None
_backfill_wakeup = threading.Event()
_threads_started = False

# ── 1m coverage state (see the module doc; all of it inert with the 1m flag off) ──
MINUTE_S = 60
#: Seconds of stream minutes the recent ring keeps (a repair's overlay window).
RECENT1_S = int(os.environ.get("BARS_LIVE_1M_RECENT_S", "900"))
#: Hard cap on ring entries (one entry = one ticker's minute; measured ~280 B of private
#: bytes each, so 60k ~ 17 MB). At a busy ~10k minutes a minute it keeps the newest ~6
#: minutes, far more than a repair's race (provider lag, seconds) needs.
RECENT1_MAX = int(os.environ.get("BARS_LIVE_1M_RECENT_MAX", "60000"))
#: Calendar days of 1m a repair fetches when nothing usable is stored (the normal 1m
#: path's own lookback for any non-deep request is 10 days).
DEPTH1_DAYS = int(os.environ.get("BARS_LIVE_1M_DEPTH_DAYS", "10"))
REPAIR1_WORKERS = int(os.environ.get("BARS_LIVE_1M_WORKERS", "4"))
#: A ticker whose repair failed is not re-queued by a read for this long.
RETRY1_S = float(os.environ.get("BARS_LIVE_1M_RETRY_S", "30"))
_s1 = {"m1_last_push_mono": None, "m1_watermark_ms": None, "m1_pushes": 0,
       "m1_rows_written": 0, "repairs_done": 0, "repairs_failed": 0, "repairs_full": 0,
       "repairs_gap": 0, "repairs_tail": 0, "feed_lost": 0}
#: Tickers repaired for tf=1 in the CURRENT epoch (covered while stream + m1 are alive).
_covered1: set[str] = set()
#: Tickers whose 1m history a depth repair returned in full (see LIVE_HISTORY_MAX_BARS).
_history1_complete: set[str] = set()
#: sym -> the minute (unix s) from which its stored 1m may be incomplete (where the
#: feed of the epoch that last covered it stopped).
_gap1_from: dict[str, int] = {}
#: The recent-minutes ring: minute_s -> sym -> (o, h, l, c, v). By minute, so pruning
#: drops whole minutes in O(1) and a ticker's minutes are a walk over <= RECENT1_S/60.
_recent1: dict[int, dict[str, tuple]] = {}
_recent1_meta = {"n": 0, "newest": None}
#: Bumped whenever an UNCOVERED ticker's stream minutes change (the repair race guard).
_m1_ver: dict[str, int] = {}
_urgent1: list[str] = []        # tickers a member read found uncovered
_recover1: list[str] = []       # tickers covered in an earlier epoch
_queued1: set[str] = set()
_repairing1: set[str] = set()
_retry1_after: dict[str, float] = {}
_m1_write_lock = threading.Lock()
_m1_wakeup = threading.Event()
_eth_minute: dict[int, bool] = {}


def enabled() -> bool:
    return os.environ.get("BARS_LIVE_COVERAGE_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def enabled1() -> bool:
    """1m coverage: its own flag, and only on top of the coverage flag."""
    return enabled() and os.environ.get("BARS_LIVE_1M_ENABLED", "0").strip().lower() in (
        "1", "true", "yes", "on")


def m1_alive() -> bool:
    """The forwarder is carrying minutes (`m1`): its last push with them is recent."""
    t = _s1["m1_last_push_mono"]
    return t is not None and (_now_mono() - t) <= STREAM_ALIVE_S


def _now_mono() -> float:
    return time.monotonic()


def stream_alive() -> bool:
    t = _state["last_push_mono"]
    return t is not None and (_now_mono() - t) <= STREAM_ALIVE_S


def proven_through_s(ticker: str, tf: str = "5") -> Optional[int]:
    """Unix seconds through which the universe stream PROVES `ticker`'s 5m series
    complete: the end of the newest minute the (alive) stream has delivered for the
    whole market, for a ticker covered in this epoch. A thin name that printed
    nothing since its tail has, by this proof, nothing newer. None = no proof (flag
    off, not covered, stream silent, or no minute delivered yet this epoch).

    tf="1": the same proof for a 1m-covered ticker, from the watermark of the newest
    push whose minutes were WRITTEN (`_s1["m1_watermark_ms"]`, set after the write)."""
    if not enabled():
        return None
    sym = (ticker or "").upper()
    if tf == "1":
        if not enabled1() or sym not in _covered1 or not stream_alive() or not m1_alive():
            return None
        wm = _s1["m1_watermark_ms"]
    else:
        if sym not in _covered5 or not stream_alive():
            return None
        wm = _state["watermark_ms"]
    if not wm:
        return None
    return int(wm) // 1000 + 60


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
    if tf == "1":
        if not enabled1():
            return False
        if sym in _covered1:
            return stream_alive() and m1_alive()
        _want1(sym)
        return False
    return False


def _want1(sym: str) -> None:
    """A read found `sym` uncovered for 1m: queue an URGENT repair. Only a member's
    interactive read asks (never a warm/prewarm sweep, which would make 1m universe
    wide), only while the minutes are flowing, and not again within RETRY1_S of a
    failed repair. Never repairs inline: a worker thread does (`_m1_pass`)."""
    if not (stream_alive() and m1_alive()):
        return
    try:
        from api.services import bars_fetch
        if not bars_fetch._request_is_interactive():
            return
    except Exception:  # noqa: BLE001
        return
    with _lock:
        if _state["epoch_ms"] is None or _retry1_after.get(sym, 0.0) > _now_mono():
            return
        if sym in _covered1 or sym in _queued1 or sym in _repairing1:
            return
        _queued1.add(sym)
        _urgent1.append(sym)
    _m1_wakeup.set()


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
    if tf == "1":
        return enabled1() and (ticker or "").upper() in _history1_complete
    return tf == "5" and (ticker or "").upper() in _history5_complete


def covered_cache_ttl(tf: str, default: int) -> int:
    return COVERED_CACHE_TTL.get(tf, default)


# ── stream ingest (5m) ────────────────────────────────────────────────────────

def ingest(payload: dict) -> dict:
    """Apply one push from the web pod. Payload:
    `{"epoch_ms", "seq", "first_full_bucket_ms", "watermark_ms", "rows": [[sym, ts, o, h, l, c, v], ...],
      "minutes": [[sym, minute_s, o, h, l, c, v], ...], "m1": [...] (1m flag only)}`
    `rows` are 5m buckets (`ts` = bucket start, unix SECONDS, the stored key for
    tf=5); `minutes` are the boundary bucket's minutes. `seq` counts the epoch's
    acknowledged pushes: a NEW epoch arriving with seq > 1 means pushes went to a
    process before this one, which this one cannot vouch for, so it asks for a resync."""
    epoch = payload.get("epoch_ms")
    ffb = payload.get("first_full_bucket_ms")
    seq = int(payload.get("seq") or 1)
    rows = payload.get("rows") or []
    # 1m: validated before the lock (the bulk of its work), applied inside it.
    parsed1 = _parse_m1(payload.get("m1")) if enabled1() else None
    global _restored
    with _lock:
        if epoch is not None and epoch != _state["epoch_ms"]:
            r, _restored = _restored, None
            if r is not None and r["epoch_ms"] == epoch and r["first_full_bucket_ms"] is not None:
                _adopt_restored_locked(r)
            else:
                if r is not None:
                    _gaps_from_restored_locked(r)
                if seq > 1:
                    _state["resyncs_requested"] += 1
                    return {"accepted": 0, "resync": True, "epoch_ms": _state["epoch_ms"]}
                _begin_epoch_locked(epoch, ffb)
        _state["last_push_mono"] = _now_mono()
        # (the 5m watermark, the PROOF, is set after this push's rows are written: below)
        w_epoch = _state["epoch_ms"]
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
        # Only a ticker holding the provider's half of the boundary bucket is rebuilt: one
        # covered by a restored checkpoint has its boundary row on disk already, and the
        # stream's minutes alone would overwrite it with a partial bucket.
        rebuild = [s_ for s_ in moved_b0 if s_ in _covered5 and s_ in _b0_provider]
        m1_epoch = _state["epoch_ms"]
        m1_rows = _ingest_m1_locked(payload, parsed1) if enabled1() else None
    n = _write_rows("5", clean) if clean else 0
    if rebuild:
        n += _write_b0(rebuild, epoch)
    with _lock:
        _state["rows_written"] += n
        # ⛔ Only now (this push's buckets are on disk) may the proof cover them (review of #2708, round 2): set before the
        # write, a read in between got `proven_through_s` (the roll) for rows not stored yet, and the 15m/30m/60m derived
        # from the 5m inherited it. The 1m watermark below follows the same rule.
        # ...and it only grows within the epoch (review of #2708, round 3): two pushes completing out of order (a slow
        # POST and its retry, concurrent request threads) must not move the proof back by a flush.
        if payload.get("watermark_ms") and _state["epoch_ms"] == w_epoch:
            held = _state["watermark_ms"] if _state["watermark_epoch"] == w_epoch else None
            _state["watermark_ms"] = max(held or 0, payload["watermark_ms"])
            _state["watermark_epoch"] = w_epoch
    n1 = None
    if m1_rows is not None:
        n1 = _write_m1(m1_rows, m1_epoch)
        with _lock:
            if _state["epoch_ms"] == m1_epoch:
                _s1["m1_rows_written"] += n1
                # Only now (the push's minutes are on disk) may the proof cover them.
                if payload.get("watermark_ms"):
                    _s1["m1_watermark_ms"] = payload["watermark_ms"]
    save_checkpoint()
    out = {"accepted": n, "epoch_ms": _state["epoch_ms"]}
    if n1 is not None:
        out["m1"] = n1
    return out


# ── 1m: the stream's minutes ──────────────────────────────────────────────────

def _in_eth(mts: int) -> bool:
    """`mts` lies in its ET day's extended session (04:00 to 20:00, 17:00 on an early
    close): the span the stored 1m series (the provider's) covers. A stream minute
    outside it is never written, so the stream adds no bar the provider path would not."""
    hit = _eth_minute.get(mts)
    if hit is None:
        try:
            from api.services.bars_fetch import _session_window
            lo, hi = _session_window(datetime.fromtimestamp(mts, _ET), "eth")
            hit = lo <= mts < hi
        except Exception:  # noqa: BLE001 — a real minute is never dropped for a clock fault
            hit = True
        if len(_eth_minute) > 4096:
            _eth_minute.clear()
        _eth_minute[mts] = hit
    return hit


def _remember1_locked(sym: str, mts: int, row: tuple) -> None:
    newest = _recent1_meta["newest"]
    if newest is not None and mts < newest - RECENT1_S:
        return  # older than the ring: the provider has it
    slot = _recent1.get(mts)
    if slot is None:
        slot = _recent1[mts] = {}
    if sym not in slot:
        _recent1_meta["n"] += 1
    slot[sym] = row  # a repeated minute replaces itself
    if newest is None or mts > newest:
        _recent1_meta["newest"] = mts


def _prune1_locked() -> None:
    """Bound the ring: whole minutes older than RECENT1_S, then the oldest minutes
    until it holds at most RECENT1_MAX entries."""
    newest = _recent1_meta["newest"]
    if newest is None:
        return
    floor = newest - RECENT1_S
    for k in sorted(_recent1):
        if k >= floor and _recent1_meta["n"] <= RECENT1_MAX:
            break
        _recent1_meta["n"] -= len(_recent1.pop(k))


def _recent_rows1_locked(sym: str) -> list[tuple]:
    """`sym`'s stream minutes held in the ring, oldest first, as store rows."""
    return [(sym, mts) + slot[sym] for mts, slot in sorted(_recent1.items()) if sym in slot]


def _parse_m1(m1) -> Optional[list]:
    """Validate a push's `m1` into (sym, minute_s, row) WITHOUT the state lock (it is
    the bulk of the work: ~30k entries in the flush after a busy minute). Minutes off
    the minute grid or outside the extended session are dropped. None = no `m1`."""
    if m1 is None:
        return None
    out = []
    for m in m1:
        try:
            sym, mts, o, h, l, c, v = m
            sym = sys.intern(str(sym).upper())
            mts = int(mts)
            row = (float(o), float(h), float(l), float(c), int(v or 0))
        except Exception:
            continue
        if mts % MINUTE_S or not _in_eth(mts):
            continue
        out.append((sym, mts, row))
    return out


def _ingest_m1_locked(payload: dict, parsed=False) -> Optional[list]:
    """The push's minutes (`m1`): every one into the ring; a COVERED ticker's are
    returned for writing. A push without `m1` means the forwarder is not carrying
    minutes, so nothing can stay covered. `parsed` = `_parse_m1(payload["m1"])` done
    before the lock (False: parse here)."""
    if parsed is False:
        parsed = _parse_m1(payload.get("m1"))
    if parsed is None:
        _s1["m1_last_push_mono"] = None   # not alive: no read queues a repair it cannot keep
        if _covered1:
            _s1["feed_lost"] += 1
            _log.warning("[bars-live] a push carried no 1m minutes; %d tickers uncovered",
                         len(_covered1))
            _uncover1_locked()
        return None
    _s1["m1_last_push_mono"] = _now_mono()
    _s1["m1_pushes"] += 1
    out = []
    for sym, mts, row in parsed:
        _remember1_locked(sym, mts, row)
        if sym in _covered1:
            out.append((sym, mts) + row)
        elif sym in _repairing1:
            _m1_ver[sym] = _m1_ver.get(sym, 0) + 1
    _prune1_locked()
    return out


def _write_m1(rows: list, epoch) -> int:
    """A push's covered minutes, one transaction (`put_bars_many`: the impossible-bar
    gate applies), serialised with the repairs' overlays."""
    if not rows:
        return 0
    with _m1_write_lock:
        with _lock:
            if _state["epoch_ms"] != epoch:
                return 0
        return _write_rows("1", rows)


def _rewrite1(sym: str, epoch) -> int:
    """Write every minute the ring holds for `sym` (snapshot and write under the 1m
    write lock, so a later snapshot always lands later)."""
    with _m1_write_lock:
        with _lock:
            if _state["epoch_ms"] != epoch:
                return 0
            rows = _recent_rows1_locked(sym)
        return _write_rows("1", rows) if rows else 0


def _uncover1_locked() -> None:
    """Every 1m-covered ticker stops being covered (new socket, or the minutes stopped):
    each notes where its series may have stopped being complete and is queued again,
    so its repair is one small refetch."""
    wm = _s1["m1_watermark_ms"] or _state["watermark_ms"]
    if wm and _covered1:
        stop = (int(wm) // 1000) // BUCKET_S * BUCKET_S
        for sym in _covered1:
            prev = _gap1_from.get(sym)
            _gap1_from[sym] = stop if prev is None else min(prev, stop)
    again = _covered1 | _repairing1
    _covered1.clear()
    _s1["m1_watermark_ms"] = None
    for sym in sorted(again):
        if sym not in _queued1:
            _queued1.add(sym)
            _recover1.append(sym)
    if again:
        _m1_wakeup.set()


def _adopt_restored_locked(r: dict) -> None:
    """The socket outlived this process: what it covered before the restart is covered."""
    _state["epoch_ms"] = r["epoch_ms"]
    _state["first_full_bucket_ms"] = r["first_full_bucket_ms"]
    _state["watermark_ms"] = r["watermark_ms"]
    _state["watermark_epoch"] = r["epoch_ms"]   # (the restored proof belongs to this epoch: later pushes only grow it)
    for sym in r["covered"]:
        _covered5.add(sym)
        _gap_from.pop(sym, None)
    # 1m likewise: every acknowledged push's minutes were committed before its ack.
    if enabled1():
        for sym in r.get("covered1") or ():
            _covered1.add(sym)
            _gap1_from.pop(sym, None)
    _ckpt["adopted"] = len(r["covered"])
    _log.info("[bars-live] same socket as before the restart: %d tickers covered again "
              "from the checkpoint", len(r["covered"]))
    _backfill_wakeup.set()


def _gaps_from_restored_locked(r: dict) -> None:
    """The socket changed too: each ticker the checkpoint covered repairs from where that
    feed stopped (or in full, when that is older than BACKFILL_DAYS)."""
    if enabled1():
        _gaps1_from_restored_locked(r)
    wm = r.get("watermark_ms")
    if not wm:
        return
    stop = (int(wm) // 1000) // BUCKET_S * BUCKET_S
    if stop < int(time.time()) - BACKFILL_DAYS * 86400:
        return
    for sym in r["covered"]:
        prev = _gap_from.get(sym)
        _gap_from[sym] = stop if prev is None else min(prev, stop)


def _gaps1_from_restored_locked(r: dict) -> None:
    """1m: each ticker the checkpoint covered notes where that feed stopped and is queued
    for its (small) repair: it was covered because a member read it."""
    cov1 = r.get("covered1") or ()
    wm = r.get("wm1") or r.get("watermark_ms")
    if wm:
        stop = (int(wm) // 1000) // BUCKET_S * BUCKET_S
        for sym in cov1:
            prev = _gap1_from.get(sym)
            _gap1_from[sym] = stop if prev is None else min(prev, stop)
    for sym in sorted(cov1):
        if sym not in _queued1:
            _queued1.add(sym)
            _recover1.append(sym)


# -- coverage checkpoint (survives a restart of this tier) --------------------

_CKPT_DDL = ("CREATE TABLE IF NOT EXISTS live_cov_ckpt("
             "id INTEGER PRIMARY KEY CHECK (id = 1), saved_at REAL NOT NULL, body TEXT NOT NULL)")


def _checkpoint_body_locked() -> Optional[dict]:
    if _state["epoch_ms"] is None:
        return None
    gaps: dict[str, list[str]] = {}
    for sym, g in _gap_from.items():
        gaps.setdefault(str(g), []).append(sym)
    body = {"v": 1, "epoch_ms": _state["epoch_ms"],
            "first_full_bucket_ms": _state["first_full_bucket_ms"],
            "watermark_ms": _state["watermark_ms"], "covered": sorted(_covered5),
            "gaps": gaps, "complete": sorted(_history5_complete)}
    if enabled1():
        # Additive fields, same `v`: a body without them (older, or 1m off) still loads.
        gaps1: dict[str, list[str]] = {}
        for sym, g in _gap1_from.items():
            gaps1.setdefault(str(g), []).append(sym)
        body.update({"covered1": sorted(_covered1), "gaps1": gaps1,
                     "complete1": sorted(_history1_complete), "wm1": _s1["m1_watermark_ms"]})
    return body


def save_checkpoint(force: bool = False) -> bool:
    """Write the coverage checkpoint, at most every CKPT_EVERY_S unless `force`.
    Taken under the state lock after the push's rows were committed, so every ticker it
    calls covered has its series on disk through the watermark it records."""
    if not enabled():
        return False
    now = _now_mono()
    last = _ckpt["last_mono"]
    if not force and last is not None and now - last < CKPT_EVERY_S:
        return False
    _ckpt["last_mono"] = now
    with _lock:
        body = _checkpoint_body_locked()
    if body is None:
        return False
    from api.services import bars_sqlite
    try:
        with bars_sqlite._WRITE_LOCK:
            c = bars_sqlite._conn()
            c.execute(_CKPT_DDL)
            c.execute("INSERT OR REPLACE INTO live_cov_ckpt(id, saved_at, body) VALUES (1, ?, ?)",
                      (time.time(), json.dumps(body, separators=(",", ":"))))
            c.commit()
        _ckpt["saves"] += 1
        return True
    except Exception as e:  # noqa: BLE001
        _ckpt["save_errors"] += 1
        _log.warning("[bars-live] checkpoint save failed: %s", e)
        return False


def load_checkpoint() -> int:
    """Read the checkpoint at boot. Returns how many tickers it named."""
    global _restored
    from api.services import bars_sqlite
    try:
        row = bars_sqlite._conn().execute(
            "SELECT saved_at, body FROM live_cov_ckpt WHERE id = 1").fetchone()
    except Exception:
        return 0  # no table: a fresh or replaced database
    if not row:
        return 0
    try:
        saved_at, body = float(row[0]), json.loads(row[1])
        if body.get("v") != 1:
            return 0
    except Exception:  # noqa: BLE001
        return 0
    floor = int(time.time()) - BACKFILL_DAYS * 86400
    if saved_at < floor:
        return 0
    n = 0
    with _lock:
        for g, syms in (body.get("gaps") or {}).items():
            g = int(g)
            if g < floor:
                continue  # older than the backfill window: a full repair instead
            for sym in syms:
                prev = _gap_from.get(sym)
                _gap_from[sym] = g if prev is None else min(prev, g)
                n += 1
        _history5_complete.update(body.get("complete") or ())
        covered = set(body.get("covered") or ())
        n += len(covered)
        _restored = {"epoch_ms": body.get("epoch_ms"),
                     "first_full_bucket_ms": body.get("first_full_bucket_ms"),
                     "watermark_ms": body.get("watermark_ms"), "covered": covered}
        if enabled1():
            # 1m fields are optional: an older body (or one saved with 1m off) has none.
            floor1 = int(time.time()) - DEPTH1_DAYS * 86400
            for g, syms in (body.get("gaps1") or {}).items():
                g = int(g)
                if g < floor1:
                    continue  # the repair then refetches from the stored tail
                for sym in syms:
                    prev = _gap1_from.get(sym)
                    _gap1_from[sym] = g if prev is None else min(prev, g)
                    n += 1
            _history1_complete.update(body.get("complete1") or ())
            covered1 = set(body.get("covered1") or ())
            n += len(covered1)
            _restored["covered1"] = covered1
            _restored["wm1"] = body.get("wm1")
    _ckpt["loaded"] = {"tickers": n, "age_s": round(time.time() - saved_at, 1)}
    _log.info("[bars-live] coverage checkpoint read: %d covered, %d awaiting repair, %.0fs old",
              len(covered), n - len(covered), time.time() - saved_at)
    return n


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
    # 1m: the new socket may have missed minutes, so nothing stays covered; each ticker
    # covered so far is re-queued for a small repair from where its feed stopped.
    _uncover1_locked()
    _recent1.clear()
    _recent1_meta.update(n=0, newest=None)
    _m1_ver.clear()
    _retry1_after.clear()
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
    _t0 = time.time()                     # this backfill's provider check instant
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
        with getattr(bars_sqlite, "provider_check", lambda _t: __import__("contextlib").nullcontext())(_t0):
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
    save_checkpoint(force=True)
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


# ── 1m repair (on demand: tickers a member read, plus those covered before) ──────

def _repair1_one(sym: str, epoch) -> bool:
    """Repair `sym`'s 1m series for the current epoch and mark it covered (module doc).
    Raises on a provider failure (an error must never read as "no bars")."""
    with _lock:
        _repairing1.add(sym)
    try:
        return _repair1_inner(sym, epoch)
    finally:
        with _lock:
            _repairing1.discard(sym)


def _repair1_inner(sym: str, epoch) -> bool:
    from api.services import bars_sqlite
    t0 = time.time()                       # this repair's provider check instant
    now_min = int(t0) // MINUTE_S * MINUTE_S  # the forming minute: the stream's, never fetched
    floor = int(t0) - DEPTH1_DAYS * 86400
    gap = _gap1_from.get(sym)
    frm, full, kind = None, False, "repairs_full"
    if gap is not None and gap >= floor:
        frm, kind = gap, "repairs_gap"
    else:
        try:
            last = bars_sqlite.get_last_ts(sym, "1")
        except Exception:  # noqa: BLE001
            last = None
        if last is not None and int(last) >= floor:
            frm, kind = int(last), "repairs_tail"   # from the tail, inclusive (it may be partial)
        else:
            # Nothing usable stored: the bounded depth. It vouches for a short history
            # only when NOTHING was stored (an old tail would leave a hole behind it).
            full = last is None
    end_ms = now_min * 1000 - 1               # through the newest CLOSED minute
    if frm is None:
        start = (datetime.now(_ET) - timedelta(days=DEPTH1_DAYS)).strftime("%Y-%m-%d")
        bars = _fetch(sym, 1, start, end_ms)
    else:
        bars = _fetch(sym, 1, min(frm, now_min - MINUTE_S) * 1000, end_ms)
    closed = [b for b in bars if int(b["t"]) < now_min]
    if closed:
        with getattr(bars_sqlite, "provider_check", lambda _t: __import__("contextlib").nullcontext())(t0):
            bars_sqlite.put_bars(sym, "1", closed)
    # The stream's minutes over the provider's: the stream wins for the same minute.
    with _m1_write_lock:
        with _lock:
            if _state["epoch_ms"] != epoch:
                return False  # the socket changed under us; the next pass redoes it
            ver = _m1_ver.get(sym, 0)
            rows = _recent_rows1_locked(sym)
        if rows:
            _write_rows("1", rows)
    with _lock:
        if _state["epoch_ms"] != epoch:
            return False
        _covered1.add(sym)
        # A stream minute that landed between the overlay above and this line was not
        # written by its push (the ticker was not covered yet): write it now.
        stale = _m1_ver.get(sym, 0) != ver
        _gap1_from.pop(sym, None)
        _s1[kind] += 1
        if full:
            _history1_complete.add(sym)
    if stale:
        _rewrite1(sym, epoch)
    return True


def _next1() -> Optional[str]:
    """The next 1m repair: a ticker a member is waiting on first, then the re-covers."""
    with _lock:
        while _urgent1 or _recover1:
            sym = (_urgent1 or _recover1).pop(0)
            _queued1.discard(sym)
            if sym in _covered1:
                continue
            _repairing1.add(sym)
            return sym
    return None


def _m1_pass() -> int:
    """Drain the 1m queues on REPAIR1_WORKERS threads. Returns how many were covered."""
    with _lock:
        epoch = _state["epoch_ms"]
    if epoch is None or not (stream_alive() and m1_alive()):
        return 0
    done = [0]

    def _worker() -> None:
        while True:
            with _lock:
                if _state["epoch_ms"] != epoch:
                    return
            sym = _next1()
            if sym is None:
                return
            ok = False
            try:
                ok = _repair1_one(sym, epoch)
            except Exception as e:  # noqa: BLE001
                from api.services.log_redaction import redact
                _log.debug("[bars-live] 1m repair %s failed: %s", sym, redact(str(e)))
            with _lock:
                _repairing1.discard(sym)
                _s1["repairs_done" if ok else "repairs_failed"] += 1
                if ok:
                    done[0] += 1
                else:
                    _retry1_after[sym] = _now_mono() + RETRY1_S

    workers = [threading.Thread(target=_worker, daemon=True, name=f"bars-live-1m-{i}")
               for i in range(max(1, REPAIR1_WORKERS))]
    for w in workers:
        w.start()
    for w in workers:
        w.join()
    if done[0]:
        save_checkpoint(force=True)
    return done[0]


def _m1_loop() -> None:
    while True:
        _m1_wakeup.wait(timeout=60)
        _m1_wakeup.clear()
        try:
            if enabled1():
                _m1_pass()
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-live] 1m repair loop error: %s", e)


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
    from api.services.vendor_symbols import app_symbol
    out = []
    for t in tickers:
        # ⛔ `BCpC` (Brunswick's preferred C) is not `BCPC` (Balchem): a lowercase-marked vendor
        # ticker has no app key. Upper-cased, the preferred's day bar replaced Balchem's on every
        # poll (2026-11-16/17: 20.55 against 171.48; api/services/vendor_symbols.py).
        sym = app_symbol(t.get("ticker"))
        day = t.get("day") or {}
        try:
            o, h, l, c, v = (float(day.get(k) or 0) for k in ("o", "h", "l", "c", "v"))
        except (TypeError, ValueError):
            continue
        if not sym or min(o, h, l, c) <= 0:
            continue
        out.append((sym, today_ymd, o, h, l, c, int(v)))
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
    # ⛔ NO ROW BEFORE TODAY'S REGULAR SESSION HAS OPENED. The poll runs from 04:00, and before
    # the open the snapshot's `day` can still hold the PRIOR session (2026-09-04, 2026-09-11:
    # the same object stamped with today's date drew a second copy of yesterday's candle on
    # every pre-market daily chart). The one rule for "may today's `day` be dated today" is
    # `massive._regular_session_has_opened_today` (todays_daily_bar and the today pack ask it
    # too); asked here rather than restated. Before the open nothing is written, so the stored
    # series ends at the prior session, exactly what the uncovered path serves; every ticker
    # is still reported, so daily coverage does not drop.
    from api.services import massive
    opened = massive._regular_session_has_opened_today()
    # Only bars that moved since the last poll: an unchanged ticker's stored row is
    # already exact, and rewriting ~13k rows every poll would crowd the write lock.
    rows = ([r for r in daily_rows_from_snapshot(tickers, today) if last.get(r[0]) != r]
            if opened else [])
    n = _write_rows("D", rows) if rows else 0
    for r in rows:
        last[r[0]] = r
    from api.services.vendor_symbols import app_symbol
    seen = {s for s in (app_symbol(t.get("ticker")) for t in tickers) if s}
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
    if enabled():
        try:
            load_checkpoint()
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-live] checkpoint read failed: %s", e)
    threading.Thread(target=_backfill_loop, daemon=True, name="bars-live-backfill").start()
    if enabled1():
        threading.Thread(target=_m1_loop, daemon=True, name="bars-live-1m").start()
    how = _start_daily()
    _log.info("[bars-live] started (enabled=%s, 1m=%s, daily poll in %s)", enabled(), enabled1(), how)


def status() -> dict:
    with _lock:
        s = dict(_state)
        s["covered5"] = len(_covered5)
        s["gap_pending"] = len(_gap_from)
        s["b0_stream_tickers"] = len(_b0_stream)
        s["daily_seen"] = len(_daily_seen)
        s["checkpoint"] = {k: v for k, v in _ckpt.items() if k != "last_mono"}
        if enabled1():
            m1 = {k: v for k, v in _s1.items() if k != "m1_last_push_mono"}
            m1.update(covered1=len(_covered1), gap1_pending=len(_gap1_from),
                      recent1_entries=_recent1_meta["n"], recent1_minutes=len(_recent1),
                      urgent1=len(_urgent1), recover1=len(_recover1),
                      repairing1=len(_repairing1), m1_alive=m1_alive())
            s["m1"] = m1
    s["enabled"] = enabled()
    s["stream_alive"] = stream_alive()
    s["daily_alive"] = daily_alive()
    lp = s.pop("last_push_mono")
    s["last_push_age_s"] = None if lp is None else round(_now_mono() - lp, 1)
    dl = s.pop("daily_last_ok_mono")
    s["daily_age_s"] = None if dl is None else round(_now_mono() - dl, 1)
    return s


def _reset_for_tests() -> None:
    global _restored
    _restored = None
    _ckpt.update({"last_mono": None, "saves": 0, "save_errors": 0, "loaded": None, "adopted": 0})
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
        for k in _s1:
            _s1[k] = None if k in ("m1_last_push_mono", "m1_watermark_ms") else 0
        for coll in (_covered1, _history1_complete, _gap1_from, _recent1, _m1_ver, _urgent1,
                     _recover1, _queued1, _repairing1, _retry1_after, _eth_minute):
            coll.clear()
        _recent1_meta.update(n=0, newest=None)
    _m1_wakeup.clear()
