"""Time & Sales -- the live trade tape for one security (COV-08 / FT-077, the T&S half).

Owner approval 2026-10-12. Level II / the order book is NOT in scope (owner declined it).

WHERE THE PRINTS COME FROM
--------------------------
Only the Massive (Polygon-protocol) stocks socket we already hold. `bar_stream.py` already
subscribes `T.<sym>` (one message per trade) alongside `AM.`/`A.` for every symbol it is asked
for, and fans each T print out to `bar_stream._trade_listeners`. This module is one more such
listener. It opens NO upstream connection of its own and never subscribes the whole market:
a symbol is asked for (through `BarBroadcaster.add_interest`, the same refcounted door the
quote feed and the D3 price arm use) only while at least one client is watching it, and is
released the moment the last one leaves.

BID / ASK, AND WHY THE TAPE SAYS "TICK"
---------------------------------------
Classifying a print as at-bid / at-ask needs the NBBO at the moment of the print (the `Q.<sym>`
quote channel). `bar_stream` does not subscribe quotes for stocks, its subscribe builder is shared
by the live chart feed, and quotes are an order of magnitude more messages than trades, so they
are NOT added here. Each print is instead classified by the TICK TEST against the previous print
(uptick / downtick, and zero-tick inheriting the last direction). That is labelled as such
everywhere it is shown: it is a proxy for aggressor side, never presented as the quote.

LOAD, BY CONSTRUCTION (the 2026-10-13 measurement window gates latency on the web pod)
--------------------------------------------------------------------------------------
* Flag `TIME_AND_SALES_ENABLED`, read PER CALL, default OFF. Off: the stream route answers one
  `unavailable` event and returns; nothing is subscribed, no listener is registered, nothing runs.
* The trade listener is registered only while some client watches some symbol, so with nobody
  watching `bar_stream`'s per-print listener loop is the empty-list guard it was before.
* Caps: MAX_SYMBOLS distinct symbols, MAX_STREAMS client streams pod-wide, MAX_STREAMS_PER_USER.
* Each symbol keeps a bounded ring of the last BUFFER_PRINTS prints (a deque, maxlen). Buffers of
  symbols nobody watches any more are kept (for the closed-market view) up to MAX_RETAINED, LRU.
* No database, no disk: nothing here writes per trade except into that ring.
* The client push cadence (<= 4/s, batched) lives in the router; this module only answers
  "what is new since seq N".

Every seam into bar_stream / bar_broadcaster is resolved at CALL time (late-bound), so tests
stub the stream without a network and a monkeypatch actually reaches it.
"""
from __future__ import annotations

import datetime as _dt
import os
import threading
import time
from collections import OrderedDict, deque
from typing import Optional

FLAG = "TIME_AND_SALES_ENABLED"
_TRUTHY = ("1", "true", "yes", "on")

#: The last N prints held per symbol (the ring; also the most a client is ever sent at once).
BUFFER_PRINTS = 200
#: Distinct symbols watched at once, pod-wide.
MAX_SYMBOLS = 20
#: Client streams open at once, pod-wide.
MAX_STREAMS = 60
#: Client streams one member may hold at once (several panels / tabs).
MAX_STREAMS_PER_USER = 4
#: Buffers kept after their last watcher left (closed-market "last session" view), LRU.
MAX_RETAINED = 40

#: A print is "large" at this notional or this many shares; a "block" at BLOCK_NOTIONAL.
LARGE_NOTIONAL = 200_000
LARGE_SHARES = 10_000
BLOCK_NOTIONAL = 1_000_000

#: A print below a round lot (100 shares) is an odd lot: shown, muted.
ROUND_LOT = 100


def enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get("TIME_AND_SALES_ENABLED", "0").strip().lower() in _TRUTHY


# ── pure helpers (no state) ──────────────────────────────────────────────────────────────


def normalize_symbol(sym: str) -> str:
    """The upstream (Polygon/Massive) form of a ticker: upper case, class shares with a dot
    (BRK-B -> BRK.B), which is how `T` events name them and how bar_stream subscribes."""
    return str(sym or "").strip().upper().replace("-", ".")


def classify_tick(prev_price: Optional[float], prev_dir: str, price: float) -> str:
    """The tick test. "up" / "down" against the previous print's price; an unchanged price is a
    zero tick that inherits the last non-zero direction ("zup" / "zdown"); the first print, or a
    zero tick with no direction yet, is "" (unknown)."""
    if prev_price is None:
        return ""
    if price > prev_price:
        return "up"
    if price < prev_price:
        return "down"
    if prev_dir in ("up", "zup"):
        return "zup"
    if prev_dir in ("down", "zdown"):
        return "zdown"
    return ""


def size_tier(price: float, size: float) -> int:
    """0 ordinary, 1 large (>= LARGE_NOTIONAL or >= LARGE_SHARES), 2 block (>= BLOCK_NOTIONAL)."""
    notional = float(price) * float(size)
    if notional >= BLOCK_NOTIONAL:
        return 2
    if notional >= LARGE_NOTIONAL or float(size) >= LARGE_SHARES:
        return 1
    return 0


_ET = None


def _et_now() -> _dt.datetime:
    global _ET
    if _ET is None:
        from zoneinfo import ZoneInfo
        _ET = ZoneInfo("America/New_York")
    return _dt.datetime.now(_ET)


def session_state(now: Optional[_dt.datetime] = None) -> str:
    """"pre" 04:00-09:30 ET, "regular" 09:30-16:00, "post" 16:00-20:00, else "closed"; weekends
    closed. Exchange holidays are NOT known here (stated: a holiday reads as a quiet session)."""
    n = now or _et_now()
    if n.weekday() >= 5:
        return "closed"
    hm = n.hour * 100 + n.minute
    if 400 <= hm < 930:
        return "pre"
    if 930 <= hm < 1600:
        return "regular"
    if 1600 <= hm < 2000:
        return "post"
    return "closed"


# ── state ────────────────────────────────────────────────────────────────────────────────


class _Tape:
    __slots__ = ("prints", "seq", "last_price", "last_dir", "last_print_at")

    def __init__(self):
        self.prints: deque = deque(maxlen=BUFFER_PRINTS)
        self.seq = 0
        self.last_price: Optional[float] = None
        self.last_dir = ""
        self.last_print_at: Optional[float] = None


_lock = threading.Lock()
_tapes: "OrderedDict[str, _Tape]" = OrderedDict()   # sym -> tape (LRU order, newest last)
_watchers: dict[str, int] = {}                     # sym -> open client streams on it
_streams_by_user: dict[str, int] = {}
_streams_total = 0
_listener_on = False

_counters = {"prints_total": 0, "pushes_total": 0, "refused_total": 0, "streams_opened_total": 0}


def _reset_for_tests() -> None:
    global _streams_total, _listener_on
    with _lock:
        _tapes.clear()
        _watchers.clear()
        _streams_by_user.clear()
        _streams_total = 0
        _listener_on = False
        for k in _counters:
            _counters[k] = 0


# ── late-bound seams into the existing stream (stubbed in tests) ─────────────────────────


def _feed_ready() -> bool:
    """The Massive bar stream is running in this process (STREAM_BARS_ENABLED=1 started it and
    initialised the broadcaster). Without it there is no T feed to listen to."""
    try:
        from api.services.bar_broadcaster import get_broadcaster
        get_broadcaster()
        return True
    except Exception:
        return False


def _add_interest(sym: str) -> None:
    from api.services.bar_broadcaster import get_broadcaster
    get_broadcaster().add_interest([sym])


def _remove_interest(sym: str) -> None:
    from api.services.bar_broadcaster import get_broadcaster
    get_broadcaster().remove_interest([sym])


def _add_listener(fn) -> None:
    from api.services import bar_stream
    bar_stream.add_trade_listener(fn)


def _remove_listener(fn) -> None:
    from api.services import bar_stream
    bar_stream.remove_trade_listener(fn)


# ── the listener (runs on bar_stream's WS thread: minimal, never raises) ──────────────────


def on_trade(sym: str, trade: dict) -> None:
    """One T print from bar_stream. Recorded only for a symbol a client is watching right now."""
    try:
        s = str(sym or "").upper()
        if not _watchers.get(s):          # cheap pre-check, no lock for the common miss
            return
        p = float(trade.get("p"))
        z = float(trade.get("s"))
        t = int(trade.get("t"))
        if not (p > 0) or not (z > 0):
            return
        conds = trade.get("c") or []
        with _lock:
            tape = _tapes.get(s)
            if tape is None or not _watchers.get(s):
                return
            d = classify_tick(tape.last_price, tape.last_dir, p)
            tape.seq += 1
            tape.prints.append({
                "seq": tape.seq, "t": t, "p": p, "s": int(z) if z.is_integer() else z,
                "d": d, "b": size_tier(p, z),
                "o": 1 if z < ROUND_LOT else 0,
                "c": [int(x) for x in conds if isinstance(x, (int, float))][:6],
            })
            tape.last_price = p
            if d:
                tape.last_dir = d
            tape.last_print_at = time.time()
            _counters["prints_total"] += 1
    except Exception:
        return


# ── watch / unwatch (called from the request event loop) ─────────────────────────────────


def watch(sym: str, user_id: str = "") -> tuple[bool, str]:
    """Register one client stream on `sym`. Returns (True, "") or (False, reason) where reason is
    one of "off", "feed_off", "symbol_cap", "at_capacity", "user_cap". On success the caller MUST
    call `unwatch(sym, user_id)` exactly once (the router does it in a `finally`)."""
    global _streams_total, _listener_on
    s = normalize_symbol(sym)
    if not enabled():
        return False, "off"
    if not _feed_ready():
        with _lock:
            _counters["refused_total"] += 1
        return False, "feed_off"
    uid = str(user_id or "")
    with _lock:
        if _streams_total >= MAX_STREAMS:
            _counters["refused_total"] += 1
            return False, "at_capacity"
        if uid and _streams_by_user.get(uid, 0) >= MAX_STREAMS_PER_USER:
            _counters["refused_total"] += 1
            return False, "user_cap"
        first_on_sym = not _watchers.get(s)
        if first_on_sym and sum(1 for v in _watchers.values() if v) >= MAX_SYMBOLS:
            _counters["refused_total"] += 1
            return False, "symbol_cap"
        _watchers[s] = _watchers.get(s, 0) + 1
        _streams_total += 1
        if uid:
            _streams_by_user[uid] = _streams_by_user.get(uid, 0) + 1
        if s not in _tapes:
            _tapes[s] = _Tape()
        _tapes.move_to_end(s)
        _evict_retained_locked()
        need_listener = not _listener_on
        _listener_on = True
        _counters["streams_opened_total"] += 1
    if need_listener:
        try:
            _add_listener(on_trade)
        except Exception:
            pass
    if first_on_sym:
        try:
            _add_interest(s)
        except Exception:
            pass
    return True, ""


def unwatch(sym: str, user_id: str = "") -> None:
    """Release one client stream. The last watcher of a symbol releases its upstream interest;
    the last watcher of anything removes the trade listener (zero cost again)."""
    global _streams_total, _listener_on
    s = normalize_symbol(sym)
    uid = str(user_id or "")
    with _lock:
        cur = _watchers.get(s, 0)
        if cur <= 0:
            return
        if cur == 1:
            _watchers.pop(s, None)
        else:
            _watchers[s] = cur - 1
        _streams_total = max(0, _streams_total - 1)
        if uid:
            n = _streams_by_user.get(uid, 0) - 1
            if n > 0:
                _streams_by_user[uid] = n
            else:
                _streams_by_user.pop(uid, None)
        last_on_sym = s not in _watchers
        drop_listener = _listener_on and not any(_watchers.values())
        if drop_listener:
            _listener_on = False
        _evict_retained_locked()
    if last_on_sym:
        try:
            _remove_interest(s)
        except Exception:
            pass
    if drop_listener:
        try:
            _remove_listener(on_trade)
        except Exception:
            pass


def _evict_retained_locked() -> None:
    """Keep at most MAX_RETAINED unwatched buffers (oldest first out). Watched ones never go."""
    unwatched = [k for k in _tapes if not _watchers.get(k)]
    excess = len(unwatched) - MAX_RETAINED
    for k in unwatched[:max(0, excess)]:
        _tapes.pop(k, None)


# ── reads ────────────────────────────────────────────────────────────────────────────────


def prints_since(sym: str, since_seq: int = 0) -> tuple[list[dict], int]:
    """Prints of `sym` with seq > since_seq (oldest first, at most BUFFER_PRINTS) and the newest
    seq. A symbol with no buffer answers ([], since_seq)."""
    s = normalize_symbol(sym)
    with _lock:
        tape = _tapes.get(s)
        if tape is None:
            return [], since_seq
        if tape.seq <= since_seq:
            return [], tape.seq
        out = [dict(p) for p in tape.prints if p["seq"] > since_seq]
        return out, tape.seq


def last_print_at(sym: str) -> Optional[float]:
    with _lock:
        tape = _tapes.get(normalize_symbol(sym))
        return tape.last_print_at if tape else None


def note_push() -> None:
    _counters["pushes_total"] += 1


def status() -> dict:
    with _lock:
        watched = sorted(k for k, v in _watchers.items() if v)
        return {
            "enabled": enabled(),
            "feed_ready": _feed_ready(),
            "listener_registered": _listener_on,
            "symbols_watched": len(watched),
            "watched": watched[:MAX_SYMBOLS],
            "streams_open": _streams_total,
            "buffers_held": len(_tapes),
            "caps": {
                "buffer_prints": BUFFER_PRINTS, "max_symbols": MAX_SYMBOLS,
                "max_streams": MAX_STREAMS, "max_streams_per_user": MAX_STREAMS_PER_USER,
                "max_retained": MAX_RETAINED,
            },
            **dict(_counters),
        }
