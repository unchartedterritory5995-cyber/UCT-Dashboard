"""In-memory state and subscriber routing for real-time bars.

ONE source of truth per symbol: a PER-MINUTE MAP (minute_ms -> minute state).
Every (sym, tf) developing bar is DERIVED from that map, never accumulated in a
per-tf partial. That is what makes the stream TradingView-correct:

- T (per-trade tick, the primary input) updates ONLY the minute its TRADE
  timestamp falls in (never server receive time). Out-of-order trades are
  placed by timestamp: the minute's open is its earliest last-sale-eligible
  trade, its close the latest, high/low the extremes of high/low-eligible
  trades (SIP sale-condition filter, `trade_conditions.classify`), volume the
  sum of every print. A late trade at a bucket boundary lands in the old bucket.
- AM (authoritative 1-min close) REPLACES ONLY ITS OWN MINUTE (D6). The current
  minute's T accumulation is untouched, so the developing close never snaps
  back and volume never dips; the bucket high can only move down when an AM
  authoritatively corrects an earlier minute. An AM that arrives after its
  bucket closed is applied, and the corrected bucket is re-emitted with
  `final: true` (D7).
- A (per-second aggregate) never moves a bar (D5). Its prices are computed over
  ALL prints of the second and carry no condition codes, so it cannot be
  filtered; every trade it summarises also arrives as a T event (bar_stream
  subscribes T.<sym> with every A.<sym>), so dropping its close nudge loses
  nothing and removes the ghost-close class by construction. Only its `av`
  (cumulative day volume, for the quote feed) is kept.
- Subscribe mid-bucket: `ensure_seeded(sym)` folds the stored/REST 1-min bars of
  the day into the map (authoritative for completed minutes) so a subscriber
  sees the true bucket-to-date O/H/L/V, not "since I subscribed" (D8). A new
  subscriber also gets the current bucket immediately.
- Emission is throttled to 10 Hz per (sym, tf) WITH A TRAILING FLUSH (D9): the
  last update of a burst is always delivered within one throttle window. Bucket
  closes, AM bars and seeds bypass the throttle.

Wire shape (unchanged + additive): `{"sym", "tf", "bar": {t, o, h, l, c, v,
final, trade_ts?}}`, plus `"session"` on 60m. `t` is the bucket start (ms).
`final` is true once the bucket is no longer developing (data for a later bucket
arrived, or the AM for its last minute did); a later correction re-emits the same
`t` with `final: true` again. `trade_ts` is the unix-ms timestamp of the last
trade included (omitted when only AM/seed data is known).

Ordering contract. Per (sym, tf) a flush sends its bars in ascending `t`. An
OLDER-`t` frame (the late-AM correction of a closed bucket, which typically
lands ~1-2 s after the next bucket opened) is sent ONLY to subscribers that
opted in (`subscribe(..., v2=True)`, `/api/stream/bars?v=2`). Legacy
subscribers never receive a frame whose `t` is older than one they already got,
so a consumer that blindly takes `bar.c` as "the live price" can never snap
back to the previous minute's close.

Buckets come from `bar_rollup.tv_bucket_bounds` (the single TradingView bucket
helper): 60m is session-aligned, `session="rth"` (9:30, 10:30 ... 15:30) or
`"eth"` (clock hours 04:00 ... 19:00).

Reference counting: subscribe() returns a Queue. Caller must call unsubscribe() with the
same queue when done. on_last_unsubscribe is invoked when (sym, *) drops to zero
subscribers across all timeframes — used to tell bar_stream.py to unsubscribe upstream.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time as _time
from typing import Callable, Optional

from api.services.bar_rollup import TF_TO_SECONDS, tv_bucket_bounds  # noqa: F401 (TF_TO_SECONDS re-export)
from api.services import trade_conditions

_logger = logging.getLogger(__name__)

# ⭐ THE PER-PAIR EMIT THROTTLE IS A KNOB (2026-11-25, objective 2, gap 4). Leading edge + one trailing
# flush per (symbol, series): a trade inside the window waits for the trailing flush (half the window
# on average under flow). BARS_EMIT_THROTTLE_MS on the service that runs the broadcaster (stream-ingest
# in production; web in local mode). Unset = 100 ms, the value before the knob; clamped 10..1000.
EMIT_THROTTLE_DEFAULT_MS = 100


def emit_throttle_ms_from_env() -> int:
    raw = (os.environ.get("BARS_EMIT_THROTTLE_MS") or "").strip()
    if not raw:
        return EMIT_THROTTLE_DEFAULT_MS
    try:
        v = int(float(raw))
    except ValueError:
        _logger.warning("[bar_broadcaster] BARS_EMIT_THROTTLE_MS=%r is not a number: %d ms", raw[:20], EMIT_THROTTLE_DEFAULT_MS)
        return EMIT_THROTTLE_DEFAULT_MS
    return min(1000, max(10, v))

ROLLUP_TFS = ("5", "15", "30", "60")  # plus "1"; every tf is derived from the per-minute map.

# Internal subscription keys: tf for RTH, "60e" for the 60m extended-hours view.
# 1/5/15/30 buckets are identical in both sessions, so only 60m needs two keys.
_KEY_SPEC = {
    "1": ("1", "rth"), "5": ("5", "rth"), "15": ("15", "rth"), "30": ("30", "rth"),
    "60": ("60", "rth"), "60e": ("60", "eth"),
}
_ALL_KEYS = tuple(_KEY_SPEC)

_MINUTE_MS = 60_000
# How far back (trade time) a minute stays correctable. 3h covers the developing
# 60m bucket plus the one before it (a 60m bucket starts <= 60 min before now).
_RETAIN_MS = 3 * 60 * _MINUTE_MS


def _key_for(tf: str, session: str = "rth") -> str:
    if tf != "1" and tf not in ROLLUP_TFS:
        raise ValueError(f"Unsupported tf: {tf!r}")
    if session not in ("rth", "eth"):
        raise ValueError(f"Unsupported session: {session!r}")
    return "60e" if (tf == "60" and session == "eth") else tf


# ── Telemetry (GIL-atomic plain ints/floats, off the _lock hot path) ──
# The single clearest "push is silently dead — everyone fell back to Finnhub" signal is
# bars_emitted_total flat + last_emit_at old while stream_bars connections > 0 during RTH.
_bars_emitted_total = 0     # bar dispatches that reached >=1 subscriber
_bars_dropped_total = 0     # slow-consumer QueueFull drops (was silently swallowed)
_last_emit_at = 0.0         # epoch seconds of the last dispatch
_trailing_flush_total = 0   # D9 trailing flushes that delivered a throttled update
_final_emits_total = 0      # bars emitted with final=true (closes + late corrections)
_seed_total = 0             # D8 successful seeds
_seed_fail_total = 0        # D8 seed fetches that raised / returned nothing
#: Coverage: T requested, no trade arrived yet — no minute is known whole (sorts after any ms).
_COVER_PENDING = 1 << 62
#: Coverage: a REST minute bar is taken as the whole minute only this long after it ended.
_SEED_SETTLE_MS = 2_000
#: Coverage: how far before the gap minute a seed vouches for every minute (the widest bucket).
_COVER_LOOKBACK_MS = 60 * _MINUTE_MS
#: Coverage: a first trade stamped this long before T was requested is a straggler, not the flow.
_STRAGGLER_MS = 2_000


class _Minute:
    """One minute of one symbol. Prices are None until an eligible print/bar."""
    __slots__ = ("o", "o_ts", "h", "l", "c", "c_ts", "v", "last_ts", "auth", "seeded")

    def __init__(self):
        self.o = None
        self.o_ts = 0
        self.h = None
        self.l = None
        self.c = None
        self.c_ts = 0
        self.v = 0
        self.last_ts = None   # unix ms of the latest T trade seen for this minute
        self.auth = False     # True = AM / completed-REST bar (T can no longer change it)
        self.seeded = False   # True = a REST partial covered this minute's start (coverage)


def _default_tape_probe(sym: str, at_ms: int) -> bool:
    """Coverage: does the vendor's tape hold a print at/after `at_ms` yet? Raises on error."""
    from api.services import bars_fetch
    return bars_fetch.tape_reaches(sym, at_ms)


def _default_seed_fetcher(sym: str) -> list[dict]:
    """Today's (ET) stored/REST 1-min bars as {t(ms), o, h, l, c, v}."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from api.services import bars_fetch
    day = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    # raise_errors: a vendor ERROR must not read as "no bars today" (coverage retries an error)
    bars = bars_fetch._fetch_intraday_range(sym, "1", day, day, raise_errors=True)
    out = []
    for b in bars or []:
        t = int(b["t"])
        out.append({**b, "t": t * 1000 if t < 10_000_000_000 else t})
    return out


def _default_trades_fetcher(sym: str, from_ms: int, to_ms: int) -> list:
    """Coverage: the vendor's trades with SIP time in [from_ms, to_ms) as
    [(t ms, price, size, conditions)] — the same fields the T feed carries. Raises on error."""
    from api.services import bars_fetch
    return bars_fetch.fetch_trades_between(sym, from_ms, to_ms)


class BarBroadcaster:
    def __init__(self,
                 on_first_subscribe: Optional[Callable[[str], None]] = None,
                 on_last_unsubscribe: Optional[Callable[[str], None]] = None,
                 *,
                 clock_ms: Optional[Callable[[], int]] = None,
                 scheduler: Optional[Callable[[float, Callable[[], None]], None]] = None,
                 seed_fetcher: Optional[Callable[[str], list]] = None,
                 publisher: Optional[Callable[[asyncio.Queue, asyncio.AbstractEventLoop, dict], None]] = None):
        # sym -> {minute_ms -> _Minute}: THE state. Every tf's bar is derived from it.
        self._minutes: dict[str, dict[int, _Minute]] = {}
        # sym -> highest event timestamp seen (trade ts, or AM minute end) — the
        # stream's own notion of "now", in TRADE time.
        self._hwm: dict[str, int] = {}
        self._pruned_at: dict[str, int] = {}
        # (sym, key) -> bucket starts whose bar changed since the last emit
        self._dirty: dict[tuple[str, str], set[int]] = {}
        # C1: store (queue, loop) tuples so _emit can use call_soon_threadsafe
        # (queue, loop, v2): v2 subscribers also receive older-t `final` corrections.
        self._subscribers: dict[tuple[str, str], set[tuple[asyncio.Queue, asyncio.AbstractEventLoop, bool]]] = {}
        # (sym, key) -> newest bucket start sent to that key's LEGACY subscribers
        self._legacy_hi: dict[tuple[str, str], int] = {}
        self._sym_keys: dict[str, set[str]] = {}
        # Quote-feed INTEREST refcount (per symbol). The live-price SSE
        # (/api/stream/prices) needs Massive ticks for watchlist/theme/header
        # symbols, but it reads the developing bar directly (get_last_price) and
        # must NOT create a per-(sym,tf) subscriber queue — that would dispatch a
        # throttled tick into the request event loop for every watched symbol
        # (the 524 surface). Interest keeps the symbol subscribed upstream + its
        # minute map alive, WITHOUT any queue dispatch.
        self._interest: dict[str, int] = {}
        # Latest ACCUMULATED day volume per symbol (Massive `av` on AM/A aggregate
        # events) — a live-ticking source for the quote feed's Volume column,
        # served via get_last_price. Lock-free (atomic int assignment / read).
        self._day_volume: dict[str, int] = {}
        self._lock = threading.Lock()
        self._on_first_subscribe = on_first_subscribe or (lambda sym: None)
        self._on_last_unsubscribe = on_last_unsubscribe or (lambda sym: None)
        # Throttle: 10 Hz max per (sym, key) + trailing flush (D9).
        self._last_emit_ms: dict[tuple[str, str], int] = {}
        self._flush_pending: set[tuple[str, str]] = set()
        # (sym, key) -> {bucket start -> last bar sent}: never send an identical
        # frame twice (e.g. the closed bucket re-marked at the boundary).
        self._last_sent: dict[tuple[str, str], dict[int, dict]] = {}
        self._emit_throttle_ms: int = emit_throttle_ms_from_env()
        # (sym, key) -> newest contract `rev` dispatched (HLC ms; see `_dispatch`).
        self._rev: dict[tuple[str, str], int] = {}
        self._clock_ms = clock_ms or (lambda: int(_time.time() * 1000))
        self._scheduler = scheduler or self._default_schedule
        self._seed_fetcher = seed_fetcher or _default_seed_fetcher
        # Publisher seam (ingest PR1): HOW a derived frame reaches one subscriber queue.
        # Default = today's cross-thread hop (call_soon_threadsafe onto the queue's own
        # loop). The stream-ingest relay (PR5) passes a same-loop publisher instead.
        # Called under self._lock, in dispatch order, once per (frame, subscriber).
        self._publish = publisher or self._threadsafe_publish
        # sym -> ET session day (YYYYMMDD) it was seeded for: a symbol that stays
        # subscribed overnight is re-seeded for the next session (F5).
        self._seeded: dict[str, int] = {}
        self._seed_failed_at: dict[str, int] = {}   # sym -> clock ms of the last empty/failed seed
        self._seed_retry_ms: int = 60_000
        # ⭐ COVERAGE (owner 2026-11-23: "the current candle should be completely accurate as if
        # they were already watching it. It should not change."). sym -> clock ms from which the
        # minute map holds EVERY trade (T (re)started there). A minute that began before it is
        # known only through an AM / REST bar (auth) or a seed (seeded); until then any bucket
        # containing it is NOT derived: never emitted, never snapshotted, so no client ever sees
        # a candle built from part of its minute. Absent = no gap (the seed or AM covered it, or
        # this process never declared one: the in-web local mode is unchanged).
        self._cover_from: dict[str, int] = {}
        self._gap: dict = {}                # sym -> (minute M ms, first-trade ms B): see Coverage
        self._t_floor: dict = {}            # sym -> B+1: feed trades stamped before it are dropped
        self._t_requested: dict = {}        # sym -> clock ms T was last requested (straggler guard)
        self._reseed_on_flow: set = set()   # seeded while coverage was still pending
        self._reseed_wanted: set = set()    # ...and their first trade has since arrived
        # D3 CP3 (G3): monotonic-ms of the last AM/A/T event received for this symbol,
        # across every tf -- the bars lane's own staleness answer, mirroring
        # realtime_stream.get_last_seen for the quote lane. Read by last_tick_age().
        # No caller yet -- see the inertness rail in tests/test_d3_cp3_staleness_reader.py.
        self._last_tick_wall_ms: dict[str, int] = {}

    # ── Subscription management (called from SSE endpoint coroutines) ──

    def subscribe(self, sym: str, tf: str, session: str = "rth", v2: bool = False) -> asyncio.Queue:
        sym = sym.upper()
        k = _key_for(tf, session)
        key = (sym, k)
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        # C1: capture the calling coroutine's loop so _emit can dispatch safely
        loop = asyncio.get_running_loop()
        with self._lock:
            had_any = self._symbol_wanted(sym)
            self._subscribers.setdefault(key, set()).add((q, loop, bool(v2)))
            self._sym_keys.setdefault(sym, set()).add(k)
            # Hand the new subscriber the current bucket right away (it may have
            # joined mid-bucket of a symbol other charts already stream).
            hwm = self._hwm.get(sym)
            snap = self._derive(sym, k, tv_bucket_bounds(hwm, *_KEY_SPEC[k])[0]) if hwm else None
            if snap is not None:
                # Put under the lock (we are on the queue's own loop): anything the
                # WS thread derives later is queued behind it, never ahead of it.
                self._safe_put(q, self._msg(sym, k, snap))
        if not had_any:
            try:
                self._on_first_subscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_first_subscribe(%s) failed: %s", sym, e)
        return q

    def subscribe_sink(self, sym: str, tf: str, sink, session: str = "rth") -> None:
        """stream-ingest (PR4b): register `sink` as a v2 subscriber of (sym, tf).

        Like subscribe(), but no queue and no event loop: every frame for the key,
        older-t corrections included (v2), goes to the PUBLISHER as
        `publisher(sink, None, msg)`, which needs a publisher that knows sinks (the
        default cross-thread one does not). No subscribe-time snapshot is put: the
        ingest feed snapshots per client connection (`snapshot_bars`). Release with
        unsubscribe(sym, tf, sink, session)."""
        sym = sym.upper()
        k = _key_for(tf, session)
        with self._lock:
            had_any = self._symbol_wanted(sym)
            self._subscribers.setdefault((sym, k), set()).add((sink, None, True))
            self._sym_keys.setdefault(sym, set()).add(k)
        if not had_any:
            try:
                self._on_first_subscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_first_subscribe(%s) failed: %s", sym, e)

    def snapshot_bars(self, sym: str, tf: str, session: str = "rth",
                      lookback_ms: int = 15 * _MINUTE_MS) -> list:
        """stream-ingest (PR4b): what a (re)connecting feed client must get for (sym, tf).

        Every bucket the minute map can derive whose END is within `lookback_ms` of
        the symbol's trade-time high-water mark, plus the developing bucket, in
        ascending t, each exactly as `_derive` builds it (closed buckets carry
        final=True). A stalled client lost its pending frames, late-AM corrections
        of closed buckets among them, so the developing bucket alone is not enough
        (PR3 review): a correction lands within seconds of its minute, and a client
        reconnects within seconds, so 15 minutes covers it many times over."""
        su = sym.upper()
        k = _key_for(tf, session)
        tfx, sess = _KEY_SPEC[k]
        with self._lock:
            hwm = self._hwm.get(su)
            mins = self._minutes.get(su)
            if hwm is None or not mins:
                return []
            floor = hwm - lookback_ms
            starts = sorted({tv_bucket_bounds(m, tfx, sess)[0] for m in mins})
            out = []
            for st in starts:
                if tv_bucket_bounds(st, tfx, sess)[1] <= floor:
                    continue
                b = self._derive(su, k, st)
                if b is not None:
                    out.append(b)
            return out

    def unsubscribe(self, sym: str, tf: str, q: asyncio.Queue, session: str = "rth") -> None:
        sym = sym.upper()
        k = _key_for(tf, session)
        key = (sym, k)
        with self._lock:
            subs = self._subscribers.get(key)
            # C1: subs contains (queue, loop) tuples — find by queue identity
            if subs:
                match = next((t for t in subs if t[0] is q), None)
                if match:
                    subs.discard(match)
                    if not subs:
                        self._subscribers.pop(key, None)
                        ks = self._sym_keys.get(sym)
                        if ks is not None:
                            ks.discard(k)
                            if not ks:
                                self._sym_keys.pop(sym, None)
            still_any = self._symbol_wanted(sym)
            if not still_any:
                self._clear_symbol(sym)
        if not still_any:
            try:
                self._on_last_unsubscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_last_unsubscribe(%s) failed: %s", sym, e)

    def _clear_symbol(self, sym: str) -> None:
        """I1: drop every piece of per-symbol state (caller holds _lock)."""
        self._minutes.pop(sym, None)
        self._hwm.pop(sym, None)
        self._pruned_at.pop(sym, None)
        self._seeded.pop(sym, None)
        self._cover_from.pop(sym, None)
        self._gap.pop(sym, None)
        self._t_floor.pop(sym, None)
        self._t_requested.pop(sym, None)
        self._reseed_on_flow.discard(sym)
        self._reseed_wanted.discard(sym)
        self._day_volume.pop(sym, None)
        for k in _ALL_KEYS:
            self._dirty.pop((sym, k), None)
            self._last_emit_ms.pop((sym, k), None)
            self._flush_pending.discard((sym, k))
            self._last_sent.pop((sym, k), None)
            self._legacy_hi.pop((sym, k), None)

    def _symbol_has_any_subscriber(self, sym: str) -> bool:
        return bool(self._sym_keys.get(sym))

    def _symbol_wanted(self, sym: str) -> bool:
        """A symbol must stay subscribed upstream while ANY chart is streaming it
        (a subscriber queue) OR the quote feed holds interest in it."""
        return self._interest.get(sym, 0) > 0 or self._symbol_has_any_subscriber(sym)

    # ── Quote-feed interest (no queues; keeps the minute map alive for get_last_price) ──

    def add_interest(self, symbols) -> None:
        """Register live-price interest in symbols (refcounted). Triggers the
        upstream Massive subscription (via on_first_subscribe) so tick-by-tick
        trades start flowing into the minute map, readable via get_last_price."""
        for raw in symbols:
            sym = str(raw).upper()
            if not sym:
                continue
            with self._lock:
                was_wanted = self._symbol_wanted(sym)
                self._interest[sym] = self._interest.get(sym, 0) + 1
            if not was_wanted:
                try:
                    self._on_first_subscribe(sym)
                except Exception as e:
                    _logger.warning("[bar_broadcaster] on_first_subscribe(%s) failed: %s", sym, e)

    def remove_interest(self, symbols) -> None:
        """Release live-price interest. When a symbol has no interest AND no chart
        subscriber left, unsubscribe it upstream and drop its state."""
        for raw in symbols:
            sym = str(raw).upper()
            if not sym:
                continue
            with self._lock:
                cur = self._interest.get(sym, 0)
                if cur <= 1:
                    self._interest.pop(sym, None)
                else:
                    self._interest[sym] = cur - 1
                still = self._symbol_wanted(sym)
                if not still:
                    self._clear_symbol(sym)
            if not still:
                try:
                    self._on_last_unsubscribe(sym)
                except Exception as e:
                    _logger.warning("[bar_broadcaster] on_last_unsubscribe(%s) failed: %s", sym, e)

    # ── Reads ──

    def get_last_price(self, sym: str) -> Optional[dict]:
        """Latest Massive-derived live quote for a symbol, or None if no tick yet.

        `price` is the close of the newest priced minute (SIP-filtered T trades,
        or AM), `ts` that minute's start (ms; kept for existing callers),
        `trade_ts` the unix-ms TRADE time of that close when a trade set it (else
        the newest trade seen in that minute, else None), and `volume` the
        cumulative day volume (Massive `av`, may be None).

        FRESHNESS CONTRACT. Per-trade freshness is promised ONLY for a symbol
        with registered interest here (`add_interest`, released with
        `remove_interest` when done) or a live chart subscriber: that is what
        holds the symbol on the T channel upstream (owner "bars"). For any other
        symbol the answer rides whichever bar_stream owner happens to hold it, and
        an A event never moves the price (D5). Under STREAM_SCOPED_CHANNELS=1 a
        symbol held only by the volume owner (A/AM, no T) moves once a minute, on
        AM; a symbol no owner holds returns None or a stale minute. A caller that
        cannot register (a one-shot read inside one request) must treat the result
        as best-effort and label it with `ts`. Every caller is listed, by kind, in
        tests/test_get_last_price_consumers.py."""
        su = sym.upper()
        with self._lock:
            mins = self._minutes.get(su)
            if not mins:
                return None
            for m in sorted(mins, reverse=True):
                st = mins[m]
                if st.c is not None:
                    trade_ts = st.last_ts if st.auth else (st.c_ts if st.last_ts is not None else None)
                    return {"price": st.c, "ts": m, "trade_ts": trade_ts,
                            "volume": self._day_volume.get(su)}
        return None

    def get_partial(self, sym: str, tf: str, session: str = "rth") -> Optional[dict]:
        """The developing bar for (sym, tf) — derived exactly as it is emitted."""
        su = sym.upper()
        k = _key_for(tf, session)
        with self._lock:
            hwm = self._hwm.get(su)
            if hwm is None:
                return None
            return self._derive(su, k, tv_bucket_bounds(hwm, *_KEY_SPEC[k])[0])

    def last_tick_age(self, sym: str) -> Optional[float]:
        """D3 CP3 (G3) -- the bars lane's own staleness answer, mirroring
        realtime_stream.get_last_seen for the quote lane. Seconds since the last
        AM/A/T event for this symbol arrived, across any tf, or None if this
        symbol has never had one. Read-only; no product code calls this yet
        (see the inertness rail in tests/test_d3_cp3_staleness_reader.py) --
        this is a read path with no caller, and D3's own gate packet names
        that exact shape as the defect to avoid shipping again."""
        ms = self._last_tick_wall_ms.get(sym.upper())
        if ms is None:
            return None
        return (_time.monotonic() * 1000 - ms) / 1000.0

    # ── Inbound from bar_stream ──

    def push_aggregate(self, sym: str, payload: dict, kind: str) -> None:
        """Called from bar_stream's on_bar callback (background asyncio loop).

        `kind` is "AM" (authoritative 1-min bar {t, o, h, l, c, v, av?}),
        "A" (per-second aggregate — only its `av` is used, see module doc), or
        "T" (per-trade tick {t, p, s, c?}; t = trade timestamp ms, c = SIP
        condition codes).
        """
        sym = sym.upper()
        # D3 CP3 (G3): stamp arrival for EVERY kind (AM/A/T).
        self._last_tick_wall_ms[sym] = int(_time.monotonic() * 1000)

        if kind != "T":
            av = payload.get("av")
            if av is not None:
                try:
                    self._day_volume[sym] = int(av)
                except (TypeError, ValueError):
                    pass
            if kind != "AM":
                return  # D5: an A event never moves a bar (unfilterable; T already carries its trades)

        with self._lock:
            prev_hwm = self._hwm.get(sym)
            if kind == "T":
                if self._cover_from.get(sym) == _COVER_PENDING:
                    t0 = int(payload["t"])
                    if t0 < self._t_requested.get(sym, 0) - _STRAGGLER_MS:
                        return    # stamped well before T was asked for: a straggler, not the flow
                    self._first_trade(sym, t0)
                hl_ok, last_ok = trade_conditions.classify(payload.get("c"))
                minute = self._apply_trade(sym, int(payload["t"]), payload["p"],
                                           payload.get("s") or 0, hl_ok, last_ok)
            else:
                minute = self._apply_minute_bar(sym, payload, authoritative=True)
            if minute is None:
                return
            work = self._mark_dirty(sym, [minute], prev_hwm, force=(kind == "AM"))
        self._run_flushes(sym, work)

    def push_minute_bar(self, sym: str, bar: dict) -> None:
        """Backward-compat alias — delegates to push_aggregate with kind="AM"."""
        self.push_aggregate(sym, bar, "AM")

    def ensure_seeded(self, sym: str) -> bool:
        """D8: fold today's stored/REST 1-min bars into the minute map once per
        upstream subscription, so a mid-bucket subscriber gets the true
        bucket-to-date bar. Blocking (does IO) — call off the event loop.
        Completed minutes become authoritative (like AM); the still-developing
        minute is merged with the live T accumulation. Returns True when a seed
        was applied."""
        su = sym.upper()
        if not self.begin_seed(su):
            return False
        try:
            bars = self._seed_fetcher(su) or []
        except Exception as e:
            bars = []
            _logger.warning("[bar_broadcaster] seed(%s) failed: %s", su, type(e).__name__)
        return self.apply_seed(su, bars)

    def begin_seed(self, sym: str) -> bool:
        """D8 step 1 (ensure_seeded = begin_seed, fetch, apply_seed): True when `sym`
        needs a seed now, and marks it seeded for this session so a concurrent caller
        does not fetch it twice. Non-blocking."""
        su = sym.upper()
        with self._lock:
            day = self._session_day()
            if self._seeded.get(su) == day or not self._symbol_wanted(su):
                return False
            failed = self._seed_failed_at.get(su)
            if failed is not None and self._clock_ms() - failed < self._seed_retry_ms:
                return False   # a thin/pre-market name: don't re-fetch on every chart switch
            self._seeded[su] = day
        return True

    def reset_seed(self, sym: str, forget_failure: bool = True) -> None:
        """Forget that `sym` was seeded (and, unless `forget_failure` is False, any failed
        attempt), so the next begin_seed fetches again. stream-ingest calls it for every chart
        symbol after a Massive RECONNECT: the minutes the socket missed come back from REST (D8);
        and with forget_failure=False when T restarts for a symbol, so a name whose seed keeps
        failing is still fetched at most once per _seed_retry_ms however often it is reopened."""
        su = sym.upper()
        with self._lock:
            self._seeded.pop(su, None)
            if forget_failure:
                self._seed_failed_at.pop(su, None)

    # ── Coverage (owner 2026-11-23: the forming candle exact at once, never replaced) ──
    #
    # T (re)requested ............ PENDING: nothing new is known whole; no seed counts.
    # first T arrives at exchange ms B, in minute M:
    #     every trade at/after B reaches the map from the feed (an earlier-stamped straggler is
    #     dropped: `_t_floor`); minutes after M are whole from T alone; M lacks its trades in
    #     [M, B); minutes before M lack everything.            cover = M + 1 min, gap = (M, B)
    # a seed after the flow ....... completed minutes before M from the vendor's minute bars
    #     (auth); M's missing trades from the vendor's TRADES in [M, B), classified exactly like
    #     the feed's (trade_conditions) and folded in: M is then the same minute an all-day
    #     watcher built, volume included. Coverage closes.
    # no seed yet / it failed ..... any bucket holding M or an earlier non-auth minute is not
    #     derived: never emitted, never snapshotted (a minute's AM still makes it derivable).

    def trades_started(self, sym: str) -> None:
        """Coverage: T was (re)requested for `sym` (see the block above). A seed mark from before
        the restart no longer counts: the minutes since then miss the gap's trades."""
        su = sym.upper()
        with self._lock:
            self._cover_from[su] = _COVER_PENDING
            self._t_requested[su] = self._clock_ms()
            self._gap.pop(su, None)
            self._t_floor.pop(su, None)
            self._reseed_on_flow.discard(su)
            self._reseed_wanted.discard(su)
            for st in (self._minutes.get(su) or {}).values():
                if not st.auth:
                    st.seeded = False

    def _first_trade(self, sym: str, t: int) -> None:
        """Coverage (caller holds _lock): the first trade since T was requested arrived."""
        m = t // _MINUTE_MS * _MINUTE_MS
        self._cover_from[sym] = m + _MINUTE_MS
        self._gap[sym] = (m, t)
        # the vendor's tape supplies M through B's own millisecond (several prints can share it);
        # the feed keeps only what is stamped after it — the first trade itself included in the tape
        self._t_floor[sym] = t + 1
        st = (self._minutes.get(sym) or {}).get(m)
        if st is not None and not st.auth:
            # whatever the map held for M came from before the restart: M is rebuilt from the
            # vendor's trades before B plus the feed's from B on
            (self._minutes.get(sym) or {}).pop(m, None)
        if sym in self._reseed_on_flow:
            self._reseed_on_flow.discard(sym)
            self._seeded.pop(sym, None)
            self._reseed_wanted.add(sym)

    def seed_failed(self, sym: str) -> None:
        """A seed errored: forget the seed mark and arm the retry gate (_seed_retry_ms)."""
        global _seed_fail_total
        su = sym.upper()
        _seed_fail_total += 1
        with self._lock:
            self._seeded.pop(su, None)
            self._seed_failed_at[su] = self._clock_ms()

    def trades_flowing(self, sym: str) -> bool:
        """Coverage: a trade has arrived since the last trades_started (or none is pending)."""
        with self._lock:
            return self._cover_from.get(sym.upper()) != _COVER_PENDING

    def gap_window(self, sym: str):
        """Coverage: (minute M ms, first-trade ms B) whose trades [M, B) a seed must supply, or
        None (pending, or no gap)."""
        with self._lock:
            return self._gap.get(sym.upper())

    def take_reseeds(self) -> list:
        """Symbols whose first trade arrived after a seed that ran before it (pending): the
        ingest seeds them again. Cheap when empty (called once per trade)."""
        if not self._reseed_wanted:
            return []
        with self._lock:
            out, self._reseed_wanted = sorted(self._reseed_wanted), set()
        return out

    def covered(self, sym: str) -> bool:
        with self._lock:
            return sym.upper() not in self._cover_from

    def apply_seed(self, sym: str, bars, gap_trades=None, fetched_at=None, tape_from=None) -> bool:
        """D8 step 3: fold fetched 1-min bars into the minute map (see ensure_seeded).
        Empty `bars` = a failed seed (retried after _seed_retry_ms). Non-blocking.

        COVERAGE MODE (the symbol has a declared gap — stream-ingest): see the block above.
        `gap_trades` = the vendor's trades for gap_window() as [(t ms, price, size, conditions)],
        fetched AFTER the flow began; [] = none happened. `fetched_at` = the clock ms taken BEFORE
        the fetch (what "settled" is judged against — never the apply time). `tape_from` = where
        the tape starts: M-1 min when the vendor had no settled bar for M-1, which is then built
        from the tape (proving it empty or whole) instead of assumed empty. Returns True when
        coverage closed."""
        su = sym.upper()
        with self._lock:
            coverage_mode = su in self._cover_from
        if coverage_mode:
            return self._apply_coverage_seed(su, bars or [], gap_trades, fetched_at, tape_from)
        return self._apply_seed_legacy(su, bars)

    def _apply_coverage_seed(self, su: str, bars, gap_trades, fetched_at=None, tape_from=None) -> bool:
        global _seed_total
        now = self._clock_ms() if fetched_at is None else int(fetched_at)
        with self._lock:
            if not self._symbol_wanted(su) or su not in self._cover_from:
                return False
            cover = self._cover_from[su]
            gap = self._gap.get(su)
            prev_hwm = self._hwm.get(su)
            touched = []
            seen = set()
            for b in bars:
                try:
                    m = int(b["t"]) // _MINUTE_MS * _MINUTE_MS
                    if m + _MINUTE_MS + _SEED_SETTLE_MS > now:
                        continue    # a minute still open (or just closed) vouches for nothing:
                                    # an open gap minute comes from the trades instead
                    seen.add(m)
                    got = self._apply_minute_bar(su, b, authoritative=True, from_seed=True)
                except (KeyError, TypeError, ValueError):
                    continue
                if got is not None:
                    touched.append(got)
            if gap is not None and gap_trades is not None and cover != _COVER_PENDING:
                if gap[0] + _SEED_SETTLE_MS > now:
                    gap_trades = None     # the minute before M is not settled yet: not ready
                else:
                    # every settled minute of the widest bucket before M that the vendor has no
                    # bar for had no trade: known EMPTY (auth), not a hole — so no bucket waits
                    # on it, and no stale pre-restart state in it is ever shown
                    mins = self._minutes.setdefault(su, {})
                    prev = gap[0] - _MINUTE_MS
                    held = mins.get(prev)
                    if prev not in seen and tape_from is not None and tape_from <= prev \
                            and self._accept_minute(su, prev) \
                            and not (held is not None and held.auth and held.o is not None):
                        # (an AM for M-1 that already arrived is the minute: never overwritten)
                        # no settled vendor bar for M-1 (late, or no trade): the tape decides
                        e = _Minute()
                        for (t, p, s, conds) in gap_trades:
                            if prev <= t < gap[0]:
                                hl_ok, last_ok = trade_conditions.classify(conds)
                                self._fold_trade(e, t, p, s, hl_ok, last_ok)
                        e.auth = True
                        mins[prev] = e
                        seen.add(prev)
                        touched.append(prev)
                    for m in range(gap[0] - _COVER_LOOKBACK_MS, gap[0], _MINUTE_MS):
                        if m in seen or not self._accept_minute(su, m):
                            continue
                        st = mins.get(m)
                        if st is None or not st.auth:
                            e = _Minute()
                            e.auth = True
                            mins[m] = e
            if cover == _COVER_PENDING or gap is None or gap_trades is None:
                if cover == _COVER_PENDING:
                    self._reseed_on_flow.add(su)  # the first trade asks for the real seed
                work = self._mark_dirty(su, touched, prev_hwm, force=True) if touched else []
                closed = False
            else:
                m0, b0 = gap
                st = self._minutes.setdefault(su, {}).get(m0)
                if st is None:
                    st = _Minute()
                    self._minutes[su][m0] = st
                if not st.auth:
                    for (t, p, s, conds) in gap_trades:
                        if m0 <= t <= b0:      # through B's own ms (the feed keeps t > B)
                            hl_ok, last_ok = trade_conditions.classify(conds)
                            self._fold_trade(st, t, p, s, hl_ok, last_ok)
                    st.seeded = True
                self._cover_from.pop(su, None)
                self._gap.pop(su, None)
                touched.append(m0)
                work = self._mark_dirty(su, touched, prev_hwm, force=True)
                closed = True
        if closed:
            _seed_total += 1
        self._run_flushes(su, work)
        return closed

    def _apply_seed_legacy(self, su: str, bars) -> bool:
        global _seed_total, _seed_fail_total
        bars = bars or []
        if not bars:
            _seed_fail_total += 1
            with self._lock:
                self._seeded.pop(su, None)   # allow a retry (after _seed_retry_ms)
                self._seed_failed_at[su] = self._clock_ms()
            return False
        fetched_at = self._clock_ms()
        with self._lock:
            if not self._symbol_wanted(su):
                return False
            prev_hwm = self._hwm.get(su)
            touched = []
            for b in bars:
                try:
                    m = int(b["t"]) // _MINUTE_MS * _MINUTE_MS
                    complete = m + _MINUTE_MS <= fetched_at
                    got = self._apply_minute_bar(su, b, authoritative=complete, from_seed=True)
                except (KeyError, TypeError, ValueError):
                    continue
                if got is not None:
                    touched.append(got)
            if not touched:
                return False
            # F2: emit only each key's CURRENT bucket. The seeded history is
            # already on the client (REST); replaying ~3h of buckets into a
            # 64-slot queue only overflowed it.
            work = self._mark_dirty(su, [self._hwm[su]], prev_hwm, force=True)
        _seed_total += 1
        self._run_flushes(su, work)
        return True

    def _session_day(self) -> int:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        d = datetime.fromtimestamp(self._clock_ms() / 1000, tz=ZoneInfo("America/New_York"))
        return d.year * 10000 + d.month * 100 + d.day

    # ── State transitions (caller holds _lock) ──

    def _accept_minute(self, sym: str, m: int) -> bool:
        hwm = self._hwm.get(sym)
        return hwm is None or m >= hwm - _RETAIN_MS

    def _bump_hwm(self, sym: str, ts: int) -> None:
        cur = self._hwm.get(sym)
        if cur is None or ts > cur:
            self._hwm[sym] = ts
            m = ts // _MINUTE_MS * _MINUTE_MS
            if self._pruned_at.get(sym) != m:
                self._pruned_at[sym] = m
                mins = self._minutes.get(sym)
                if mins:
                    floor = ts - _RETAIN_MS
                    for old in [x for x in mins if x < floor]:
                        del mins[old]

    def _apply_trade(self, sym, t, p, s, hl_ok, last_ok) -> Optional[int]:
        m = t // _MINUTE_MS * _MINUTE_MS
        if not self._accept_minute(sym, m):
            return None
        floor = self._t_floor.get(sym)
        if floor is not None and t < floor:
            self._bump_hwm(sym, t)
            return None   # coverage: at/before the first live trade — the seed's tape holds it
        mins = self._minutes.setdefault(sym, {})
        st = mins.get(m)
        if st is None:
            st = _Minute()
            mins[m] = st
        self._bump_hwm(sym, t)
        if st.auth:
            st.last_ts = t if st.last_ts is None else max(st.last_ts, t)
            return None   # the AM / completed REST bar for this minute already includes it
        self._fold_trade(st, t, p, s, hl_ok, last_ok)
        return m

    @staticmethod
    def _fold_trade(st, t, p, s, hl_ok, last_ok) -> None:
        """One eligible-classified trade into a minute (the feed's and the seed's alike)."""
        st.last_ts = t if st.last_ts is None else max(st.last_ts, t)
        st.v += s
        if last_ok:
            if st.o is None or t < st.o_ts:
                st.o, st.o_ts = p, t
            if st.c is None or t >= st.c_ts:
                st.c, st.c_ts = p, t
        if hl_ok:
            st.h = p if st.h is None else max(st.h, p)
            st.l = p if st.l is None else min(st.l, p)

    def _apply_minute_bar(self, sym, bar, authoritative: bool, from_seed: bool = False) -> Optional[int]:
        m = int(bar["t"]) // _MINUTE_MS * _MINUTE_MS
        if not self._accept_minute(sym, m):
            return None
        mins = self._minutes.setdefault(sym, {})
        st = mins.get(m)
        if st is None:
            st = _Minute()
            mins[m] = st
        elif from_seed and st.auth and st.o is not None:
            return None   # AM already authoritative for this minute (a seed's "known empty"
                          # minute, auth with no prices, still takes a later-arriving REST bar)
        if authoritative:
            st.o, st.h, st.l, st.c, st.v = bar["o"], bar["h"], bar["l"], bar["c"], bar["v"]
            st.o_ts, st.c_ts = m, m + _MINUTE_MS - 1
            st.auth = True
            # An AM means the minute is over in trade time; a seed only proves it began.
            self._bump_hwm(sym, m if from_seed else m + _MINUTE_MS - 1)
        else:
            # Seed for a still-developing minute (REST partial): merge with the T
            # accumulation — the REST bar saw the minute's earlier prints.
            st.seeded = True
            # the REST bar's open IS the minute's first eligible trade (it saw the minute from
            # its start); it replaces whatever an earlier, less complete seed or T put there
            st.o, st.o_ts = bar["o"], m
            if st.c is None:
                st.c, st.c_ts = bar["c"], m
            st.h = bar["h"] if st.h is None else max(st.h, bar["h"])
            st.l = bar["l"] if st.l is None else min(st.l, bar["l"])
            st.v = max(st.v, bar["v"])
            self._bump_hwm(sym, m)
        return m

    def _mark_dirty(self, sym, minutes, prev_hwm, force: bool):
        """Mark the buckets of `minutes` dirty for every subscribed key; a key
        whose developing bucket just closed gets the closed bucket too and is
        forced (a bucket close bypasses the throttle). Returns [(key, force)]."""
        keys = self._sym_keys.get(sym)
        if not keys:
            return []
        new_hwm = self._hwm.get(sym)
        work = []
        for k in keys:
            tf, sess = _KEY_SPEC[k]
            d = self._dirty.setdefault((sym, k), set())
            for m in minutes:
                d.add(tv_bucket_bounds(m, tf, sess)[0])
            kf = force
            if prev_hwm is not None and new_hwm is not None:
                ps = tv_bucket_bounds(prev_hwm, tf, sess)[0]
                if tv_bucket_bounds(new_hwm, tf, sess)[0] != ps:
                    d.add(ps)
                    kf = True
            work.append((k, kf))
        return work

    def _derive(self, sym: str, k: str, start: int) -> Optional[dict]:
        """The bar for bucket `start` of key `k`, aggregated from the minute map."""
        mins = self._minutes.get(sym)
        if not mins:
            return None
        tf, sess = _KEY_SPEC[k]
        _, end = tv_bucket_bounds(start, tf, sess)
        o = h = l = c = None
        v = 0
        trade_ts = None
        cover = self._cover_from.get(sym)
        for m in range(start, end, _MINUTE_MS):
            st = mins.get(m)
            if cover is not None and m < cover and not (
                    st is not None and (st.auth or (st.seeded and cover != _COVER_PENDING))):
                # coverage: began before T did and no seed/AM has filled it yet (a seed taken
                # before the first trade arrived vouches for nothing: see Coverage)
                return None
            if st is None:
                continue
            v += st.v
            if st.last_ts is not None:
                trade_ts = st.last_ts if trade_ts is None else max(trade_ts, st.last_ts)
            if st.c is not None:
                if o is None:
                    o = st.o
                c = st.c
            if st.h is not None:
                h = st.h if h is None else max(h, st.h)
                l = st.l if l is None else min(l, st.l)
        if o is None:
            return None   # no last-sale-eligible price yet: never invent a bar
        h = max(x for x in (h, o, c) if x is not None)
        l = min(x for x in (l, o, c) if x is not None)
        last_min = mins.get(end - _MINUTE_MS)
        final = self._hwm.get(sym, 0) >= end or bool(last_min is not None and last_min.auth)
        bar = {"t": start, "o": o, "h": h, "l": l, "c": c, "v": v, "final": final}
        if trade_ts is not None:
            bar["trade_ts"] = trade_ts
        return bar

    # ── Emission ──

    def _run_flushes(self, sym: str, work) -> None:
        for (k, force) in work:
            self._flush(sym, k, force)

    def _flush(self, sym: str, k: str, force: bool) -> None:
        key = (sym, k)
        now = self._clock_ms()
        schedule_in = None
        with self._lock:
            if not self._dirty.get(key):
                return
            last = self._last_emit_ms.get(key, 0)
            if not force and now - last < self._emit_throttle_ms:
                # D9: throttled — guarantee the latest state still goes out.
                if key in self._flush_pending:
                    return
                self._flush_pending.add(key)
                schedule_in = max(0.0, (last + self._emit_throttle_ms - now) / 1000.0)
            else:
                self._last_emit_ms[key] = now
                starts = sorted(self._dirty.pop(key))
                sent = self._last_sent.setdefault(key, {})
                bars = []
                for s in starts:
                    b = self._derive(sym, k, s)
                    if b is not None and sent.get(s) != b:
                        sent[s] = b
                        bars.append(b)
                if len(sent) > 4:
                    for old in sorted(sent)[:-4]:
                        del sent[old]
                pairs = list(self._subscribers.get(key, ()))
                # Dispatch UNDER the lock: call_soon_threadsafe is non-blocking and
                # FIFO per loop, so serialising it here guarantees each key's frames
                # reach the queue in the order they were derived (two flushes on
                # different threads can no longer swap a newer and an older bar).
                self._dispatch(sym, k, bars, pairs)
        if schedule_in is not None:
            try:
                self._scheduler(schedule_in, lambda: self._trailing_flush(sym, k))
            except Exception as e:
                with self._lock:
                    self._flush_pending.discard(key)
                _logger.debug("[bar_broadcaster] trailing flush schedule failed: %s", e)

    def _trailing_flush(self, sym: str, k: str) -> None:
        global _trailing_flush_total
        with self._lock:
            self._flush_pending.discard((sym, k))
            had = bool(self._dirty.get((sym, k)))
        if had:
            _trailing_flush_total += 1
            self._flush(sym, k, force=True)

    @staticmethod
    def _default_schedule(delay_s: float, fn: Callable[[], None]) -> None:
        try:
            asyncio.get_running_loop().call_later(delay_s, fn)
        except RuntimeError:
            t = threading.Timer(delay_s, fn)
            t.daemon = True
            t.start()

    @staticmethod
    def _msg(sym: str, k: str, bar: dict) -> dict:
        tf, sess = _KEY_SPEC[k]
        msg = {"sym": sym, "tf": tf, "bar": bar}
        if tf == "60":
            msg["session"] = sess
        return msg

    def _dispatch(self, sym: str, k: str, bars: list, pairs: list) -> None:
        global _bars_emitted_total, _last_emit_at, _final_emits_total
        if not bars or not pairs:
            return
        for bar in bars:
            msg = self._msg(sym, k, dict(bar))
            # ⭐ BAR CONTRACT `rev` (docs/architecture/bar-contract.md): a hybrid-logical-
            # clock MILLISECOND revision per (sym, key) — max(prev + 1, now_ms), assigned
            # here under the lock in dispatch order, so it strictly increases for every
            # frame of a key and is comparable with REST `developing.rev` (as-of ms).
            rk = (sym, k)
            rev = max(self._rev.get(rk, 0) + 1, int(self._clock_ms()))
            self._rev[rk] = rev
            msg["rev"] = rev
            legacy_ok = bar["t"] >= self._legacy_hi.get((sym, k), bar["t"])
            if legacy_ok:
                self._legacy_hi[(sym, k)] = bar["t"]
            for (q, loop, v2) in pairs:
                if not (v2 or legacy_ok):
                    continue   # F1: older-t correction — opt-in (v2) subscribers only
                self._publish(q, loop, msg)
            _bars_emitted_total += 1
            if bar.get("final"):
                _final_emits_total += 1
        _last_emit_at = _time.time()

    @classmethod
    def _threadsafe_publish(cls, q: asyncio.Queue, loop: asyncio.AbstractEventLoop, msg: dict) -> None:
        """Default publisher. C1: dispatch via call_soon_threadsafe — safe from any thread."""
        try:
            loop.call_soon_threadsafe(cls._safe_put, q, msg)
        except RuntimeError:
            pass   # loop closed — subscriber's session is dead

    @staticmethod
    def _safe_put(q: asyncio.Queue, msg: dict) -> None:
        """Runs on the queue's owner loop via call_soon_threadsafe."""
        global _bars_dropped_total
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            # Slow consumer — drop the oldest, push the new. Real-time data:
            # freshness > completeness. Count it (was silently swallowed = invisible loss).
            try:
                q.get_nowait()
                q.put_nowait(msg)
                _bars_dropped_total += 1
            except Exception:
                pass

    def get_status(self) -> dict:
        with self._lock:
            return {
                "subscriber_pairs": len(self._subscribers),
                "quote_interest_symbols": len(self._interest),
                "tracked_partials": sum(len(v) for v in self._sym_keys.values()),
                "tracked_symbols": len(self._minutes),
                "symbols": sorted(self._sym_keys),
                "bars_emitted_total": _bars_emitted_total,
                "bars_dropped_total": _bars_dropped_total,
                "trailing_flush_total": _trailing_flush_total,
                "final_emits_total": _final_emits_total,
                "seed_total": _seed_total,
                "seed_fail_total": _seed_fail_total,
                "last_emit_at": _last_emit_at,
                "last_emit_age_s": (round(_time.time() - _last_emit_at, 1) if _last_emit_at else None),
            }


# Module-level singleton — initialized at app startup, importable everywhere
_singleton: Optional[BarBroadcaster] = None


def get_broadcaster() -> BarBroadcaster:
    global _singleton
    if _singleton is None:
        raise RuntimeError("BarBroadcaster not initialized — call init_broadcaster() first")
    return _singleton


def init_broadcaster(*, on_first_subscribe=None, on_last_unsubscribe=None) -> BarBroadcaster:
    global _singleton
    # I4: guard against double-init — would orphan in-flight subscriber queues
    if _singleton is not None:
        raise RuntimeError("BarBroadcaster already initialized — call once at app startup")
    _singleton = BarBroadcaster(
        on_first_subscribe=on_first_subscribe,
        on_last_unsubscribe=on_last_unsubscribe,
    )
    return _singleton


def install_broadcaster(obj) -> None:
    """STREAM_FEED_SOURCE=remote: make `obj` (a remote_broadcaster.RemoteBroadcaster, the
    same interface) THE broadcaster every caller of get_broadcaster() gets. Once, at
    startup, instead of init_broadcaster."""
    global _singleton
    if _singleton is not None:
        raise RuntimeError("BarBroadcaster already initialized — call once at app startup")
    _singleton = obj


def reset_broadcaster_for_tests() -> None:
    """Test-only: clear the singleton so init_broadcaster can be called again."""
    global _singleton
    _singleton = None
