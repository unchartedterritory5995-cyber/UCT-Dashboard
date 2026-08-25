"""Intraday New-High / New-Low accumulator — the "Situational Awareness" scanner.

Trade-Ideas-style live feed of every stock printing a fresh **high-of-day** (HOD)
or **low-of-day** (LOD), with a per-symbol running COUNT of how many times it has
done so today. A high count = relentless one-directional momentum (the same symbol
stacks in the stream as its count climbs). This is NOT the breadth engine's
"new 52-week high" — that's a positional LEVEL from one snapshot; this is an
intraday count that must be accumulated across the whole session.

## Why a stateful accumulator (and not a cached scan)
`scan_volume` et al. are stateless: one snapshot in, one ranked list out, cached
~60s. A new-HOD COUNT can't be derived from a single snapshot — you have to watch
each symbol's `day.h`/`day.l` evolve all session and count the increments. So this
module holds session state and a background thread ticks it every few seconds.

## How a tick works (RTH, Phase 1)
One whole-market snapshot (`massive.get_full_market_snapshot_hl`) carries every
name's today running high (`day.h`) and low (`day.l`). Per cap-universe symbol we
keep a high-water mark; when `day.h` ticks above it we emit a "new high" event,
bump the symbol's counter, and advance the mark (symmetric for `day.l`). Events
land in a rolling ring buffer (newest-first when served). Fidelity note: polling
`day.h/day.l` counts "intervals in which a new HOD occurred", not literally every
print like Trade Ideas' full tape — a faithful proxy for v1; a Massive trade-stream
ingest can make it print-exact later.

## Scope / rollout
- RTH only for now; extended-hours (pre/post) session tracking is Phase 3
  (snapshot `day.h/l` is RTH-official and freezes after hours — that pass tracks its
  own ext high/low from `min`/`lastTrade`).
- Ships DARK behind `NHNL_SCANNER_ENABLED=1` (default off), mirroring the
  awareness/fundamentals monitors. Runs web-side as a bounded single-writer thread;
  state is a few hundred KB, the only real cost is one full-market pull per tick.

Served by `api/routers/nhnl.py` (`GET /api/nhnl/live`, paid-gated like the sibling
scanners) and polled by the Charts "New Highs / New Lows" widget.
"""
import json
import logging
import os
import threading
import time as _time
from collections import deque
from datetime import datetime

try:
    import zoneinfo
    _ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = None

_log = logging.getLogger(__name__)

# ── Tunables (env-overridable) ────────────────────────────────────────────────
_RING_MAX = 600          # rolling event buffer per side is drawn from this
_DEFAULT_TICK_SECONDS = 3.0
_EPS = 1e-6              # float-noise guard for the high-water-mark compare

# ── Session state (guarded by _lock) ──────────────────────────────────────────
_lock = threading.Lock()
_state = {
    "session_key": None,         # f"{date}:{window}" — counters reset when this rolls
    "window": "closed",          # rth | pre | post | closed
    "date": None,                # ET date string
    "syms": {},                  # app_sym -> {hod, lod, nh, nl, last}
    "events": deque(maxlen=_RING_MAX),  # {sym, price, count, ts, dir}; oldest-left
    "asof": None,
    "ticks": 0,
    "last_error": None,
}

_running = False
_thread = None

# Universe (provider-ticker -> app-ticker), built once.
_prov_to_app: dict | None = None


def _now_et() -> datetime:
    return datetime.now(_ET) if _ET else datetime.utcnow()


def _active_window(now: datetime) -> str:
    """Which trading window is live right now (ET): 'pre' 04:00–09:30,
    'rth' 09:30–16:00, 'post' 16:00–20:00, else 'closed' (incl. weekends).

    Each window is its own session with its own new-high/low counters — pre-market
    highs, the regular-session HOD/LOD, and post-market highs are tracked separately
    and reset at each window's open (the trader model: a pre-market high is not a
    regular-session high)."""
    if now.weekday() >= 5:
        return "closed"
    hm = now.hour * 100 + now.minute
    if 400 <= hm < 930:
        return "pre"
    if 930 <= hm < 1600:
        return "rth"
    if 1600 <= hm < 2000:
        return "post"
    return "closed"


def _ext_value(row: dict):
    """Live extended-hours price for one snapshot row, mirroring
    massive._ext_price_for: prefer a genuine lastTrade print (differs from the RTH
    close), else the minute-aggregate close (min.c carries ext-hours prints), else
    lastTrade. Returns None when nothing usable. RTH's day.h/day.l don't move after
    hours, so pre/post new highs/lows are tracked from THIS value instead."""
    def _pf(v):
        try:
            v = float(v)
            return v if v > 0 else None
        except (TypeError, ValueError):
            return None
    lt = _pf(row.get("last_trade_p"))
    mc = _pf(row.get("min_c"))
    dc = _pf(row.get("day_c"))
    if lt is not None and (dc is None or lt != dc):
        return lt
    if mc is not None:
        return mc
    return lt


def _tick_seconds() -> float:
    try:
        return max(1.0, float(os.environ.get("NHNL_TICK_SECONDS", _DEFAULT_TICK_SECONDS)))
    except (TypeError, ValueError):
        return _DEFAULT_TICK_SECONDS


def enabled() -> bool:
    return os.environ.get("NHNL_SCANNER_ENABLED", "0") == "1"


def _demo() -> bool:
    """Local-only fixture mode (NHNL_DEMO=1): seed the accumulator with example
    events and report a 'regular' session, so the widget can be reviewed off-market
    without live data. Off by default; has no effect in production."""
    return os.environ.get("NHNL_DEMO", "0") == "1"


# Representative fixture (newest-first per side) — mirrors the reference window:
# some names stack as their running count climbs (RL 105→103, NOW 378→376, KMB
# 193→190, MNST 168→163), which is the whole point of the count column.
_DEMO_HIGHS = [
    ("CRWD", 391.62, 222), ("RL", 356.01, 105), ("RL", 356.00, 104), ("RL", 355.98, 103),
    ("NOW", 113.98, 378), ("NOW", 113.97, 377), ("NOW", 113.96, 376), ("PANW", 155.92, 239),
    ("PANW", 155.90, 238), ("SHOP", 120.43, 228), ("WDAY", 141.50, 173), ("ZETA", 18.11, 149),
    ("ZETA", 18.11, 148), ("ZETA", 18.10, 147), ("TTD", 24.96, 132), ("SNPS", 428.26, 131),
    ("DOCU", 46.96, 112), ("DOCU", 46.95, 111), ("MSFT", 403.44, 110), ("GTLB", 26.91, 110),
    ("DBX", 25.79, 86), ("DPZ", 406.88, 80), ("WCLD", 28.17, 77), ("NCNO", 16.78, 46),
]
_DEMO_LOWS = [
    ("KMB", 104.54, 193), ("KMB", 104.55, 192), ("KMB", 104.55, 191), ("KMB", 104.57, 190),
    ("MNST", 78.34, 168), ("MNST", 78.36, 167), ("MNST", 78.37, 166), ("MNST", 78.38, 165),
    ("MNST", 78.39, 164), ("MNST", 78.40, 163), ("RTX", 206.57, 108), ("BTU", 35.62, 100),
    ("MDLZ", 58.79, 95), ("KVUE", 18.16, 95), ("MDLZ", 58.79, 94), ("KVUE", 18.17, 94),
    ("MVO", 2.10, 89), ("MKC", 67.80, 88), ("MVO", 2.10, 88), ("MKC", 67.81, 87),
    ("IRDM", 23.58, 47), ("IRDM", 23.60, 46),
]


def _seed_demo() -> None:
    """Populate _state with the fixture (dev only). Appending each side in
    reverse-display order makes get_live's newest-first walk restore the intended
    order per panel."""
    ts = "2026-08-25T12:20:00-04:00"
    with _lock:
        _reset("2026-08-25:rth", "rth", "2026-08-25")
        events = _state["events"]
        syms = _state["syms"]
        for sym, price, cnt in reversed(_DEMO_LOWS):
            events.append({"sym": sym, "price": price, "count": cnt, "ts": ts, "dir": "low"})
            syms[sym] = {"hod": price, "lod": price, "nh": 0, "nl": cnt, "last": price}
        for sym, price, cnt in reversed(_DEMO_HIGHS):
            events.append({"sym": sym, "price": price, "count": cnt, "ts": ts, "dir": "high"})
            syms[sym] = {"hod": price, "lod": price, "nh": cnt, "nl": 0, "last": price}
        # Pad with extra distinct names (no events) so the panel headers show a
        # realistic universe-wide count, not just the ~2 dozen names in the list.
        for i in range(120):
            syms[f"HDMY{i}"] = {"hod": 10, "lod": 9, "nh": 1, "nl": 0, "last": 10}
        for i in range(76):
            syms[f"LDMY{i}"] = {"hod": 10, "lod": 9, "nh": 0, "nl": 1, "last": 9}
        _state["asof"] = ts
        _state["ticks"] = 1
    _log.info("[nhnl] DEMO fixture seeded (%d highs, %d lows)", len(_DEMO_HIGHS), len(_DEMO_LOWS))


def _universe_map() -> dict:
    """{provider_ticker: app_ticker} for the cap universe, built once.

    Snapshot keys are provider-form (BRK.B); the app/universe form is BRK-B. We
    key state by app form (what the UI shows) but look up snapshot rows by provider
    form, so hold both directions.
    """
    global _prov_to_app
    if _prov_to_app is not None:
        return _prov_to_app
    from api.services import massive
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
    mapping: dict = {}
    try:
        with open(path) as f:
            arr = json.load(f)
        for t in arr:
            if not t:
                continue
            app = str(t).upper()
            try:
                prov = massive.to_polygon_symbol(app)
            except Exception:
                prov = app
            mapping[prov] = app
    except Exception:
        mapping = {}
    _prov_to_app = mapping
    return mapping


def _is_tradable(app_sym: str, row: dict) -> bool:
    """Shared scan floor (price > $1 AND avg daily $-vol >= $1M), reusing the exact
    predicate every preset scan applies so this feed's names match theirs."""
    try:
        from api.services import scan_volume
        return scan_volume._tradable(app_sym, row, scan_volume._avg_dollar_volume())
    except Exception:
        # If the liquidity map is unavailable, fall back to a bare price floor
        # rather than dropping everything.
        price = row.get("last_price")
        return isinstance(price, (int, float)) and price > 1.0


def _reset(session_key: str, window: str, date: str) -> None:
    """Start a fresh session's accumulation. Caller holds _lock."""
    _state["session_key"] = session_key
    _state["window"] = window
    _state["date"] = date
    _state["syms"] = {}
    _state["events"] = deque(maxlen=_RING_MAX)
    _state["ticks"] = 0
    _log.info("[nhnl] session reset for %s", session_key)


def _tick_once(snapshot: dict, window: str, today: str, now: datetime) -> None:
    """Fold one snapshot into the current window's accumulator.

    Pure w.r.t. its inputs (snapshot/window/today/now) so tests can drive it with
    synthetic snapshot sequences. `window` is 'rth' | 'pre' | 'post' | 'closed'.
      - rth   → new high/low OF DAY tracked from the official day.h / day.l.
      - pre/post → the RTH day.h/l are frozen after hours, so the extended-session
        high/low is tracked from the live ext price (_ext_value) instead.
      - closed → just stamp asof; nothing accumulates.
    Counters reset whenever the (date, window) session rolls over.
    """
    now_iso = now.isoformat()
    if window == "closed":
        with _lock:
            _state["window"] = "closed"
            _state["asof"] = now_iso
        return

    session_key = f"{today}:{window}"
    is_rth = window == "rth"
    prov_map = _universe_map()
    with _lock:
        if _state["session_key"] != session_key:
            _reset(session_key, window, today)
        syms = _state["syms"]
        events = _state["events"]

        for prov, app in prov_map.items():
            row = snapshot.get(prov)
            if not row:
                continue
            price = row.get("last_price")
            if is_rth:
                # Official running HOD / LOD (live during RTH).
                ref_hi = row.get("day_high")
                ref_lo = row.get("day_low")
                if not isinstance(ref_hi, (int, float)) or ref_hi <= 0:
                    continue
            else:
                # Extended session: track running high/low of the ext price itself
                # (one sampled point per tick), since day.h/l are frozen after hours.
                ext = _ext_value(row)
                if ext is None:
                    continue
                ref_hi = ref_lo = ext
                price = ext

            st = syms.get(app)
            if st is None:
                lo0 = ref_lo if isinstance(ref_lo, (int, float)) and ref_lo > 0 else ref_hi
                syms[app] = {"hod": ref_hi, "lod": lo0, "nh": 0, "nl": 0, "last": price}
                continue

            # New high (of day in RTH; of the ext session in pre/post)?
            if ref_hi > st["hod"] * (1 + _EPS):
                if _is_tradable(app, row):
                    st["nh"] += 1
                    events.append({"sym": app, "price": round(float(price or ref_hi), 2),
                                   "count": st["nh"], "ts": now_iso, "dir": "high"})
                st["hod"] = ref_hi   # advance the mark even if untradable
            # New low?
            if isinstance(ref_lo, (int, float)) and ref_lo > 0 and ref_lo < st["lod"] * (1 - _EPS):
                if _is_tradable(app, row):
                    st["nl"] += 1
                    events.append({"sym": app, "price": round(float(price or ref_lo), 2),
                                   "count": st["nl"], "ts": now_iso, "dir": "low"})
                st["lod"] = ref_lo
            st["last"] = price

        _state["asof"] = now_iso
        _state["ticks"] += 1


def get_live(limit: int = 100, min_price: float = 0.0,
             min_count: int = 1, session: str = "auto") -> dict:
    """Current New-Highs / New-Lows event streams (newest first), for the endpoint.

    - `limit`     max rows per side.
    - `min_price` hide events below this price.
    - `min_count` hide events whose running count is below this (raise it to see
                  only persistent, one-directional names).
    Cheap: a copy of the ring buffer + a filtered walk.
    """
    window = "rth" if _demo() else _active_window(_now_et())
    with _lock:
        evs = list(_state["events"])
        asof = _state["asof"]
        session_date = _state["date"]
        ticks = _state["ticks"]
        # Universe-wide breadth: how many DISTINCT symbols have made at least one
        # new high (or low) today across the whole cap universe — not just the
        # rows in the event list below. This is what the panel headers show.
        syms = _state["syms"]
        highs_total = sum(1 for st in syms.values() if st.get("nh", 0) > 0)
        lows_total = sum(1 for st in syms.values() if st.get("nl", 0) > 0)

    try:
        limit = max(1, min(int(limit), _RING_MAX))
    except (TypeError, ValueError):
        limit = 100

    highs: list = []
    lows: list = []
    for e in reversed(evs):  # newest first
        price = e.get("price")
        if price is not None and price < min_price:
            continue
        if e.get("count", 0) < min_count:
            continue
        if e.get("dir") == "high":
            if len(highs) < limit:
                highs.append(e)
        elif len(lows) < limit:
            lows.append(e)
        if len(highs) >= limit and len(lows) >= limit:
            break

    return {
        "window": window,             # rth | pre | post | closed
        "date": session_date,
        "asof": asof,
        "ticks": ticks,
        "active": window != "closed" and _running and (enabled() or _demo()),
        "highs_total": highs_total,   # universe-wide distinct-symbol counts
        "lows_total": lows_total,
        "highs": highs,
        "lows": lows,
    }


def status() -> dict:
    """Diagnostics — accumulator health without the event payload."""
    with _lock:
        return {
            "enabled": enabled(),
            "running": _running,
            "window": _state["window"],
            "session_key": _state["session_key"],
            "date": _state["date"],
            "tracked_symbols": len(_state["syms"]),
            "events_buffered": len(_state["events"]),
            "ticks": _state["ticks"],
            "asof": _state["asof"],
            "last_error": _state["last_error"],
            "tick_seconds": _tick_seconds(),
        }


def _tick() -> None:
    """One scheduled cycle: fetch during any active window (pre/rth/post) and fold."""
    from api.services import massive
    now = _now_et()
    today = now.strftime("%Y-%m-%d")
    window = _active_window(now)
    if window == "closed":
        _tick_once({}, "closed", today, now)  # stamps asof, no fetch
        return
    snap = massive._get_client().get_full_market_snapshot_hl()
    if not snap:
        with _lock:
            _state["last_error"] = "empty snapshot"
        return
    _tick_once(snap, window, today, now)
    with _lock:
        _state["last_error"] = None


def _run_forever() -> None:
    while _running:
        try:
            _tick()
        except Exception as e:  # never let one bad tick kill the loop
            _log.exception("[nhnl] tick failed")
            with _lock:
                _state["last_error"] = str(e)
        _time.sleep(_tick_seconds())


def start() -> None:
    """Start the background accumulator. No-op unless NHNL_SCANNER_ENABLED=1.

    Called from the web-pod lifespan (mirrors fundamentals_monitor.start()).
    """
    global _running, _thread
    if _demo():
        _seed_demo()          # dev fixture: no fetch thread, static example events
        _running = True
        return
    if not enabled():
        return
    if _running:
        return
    _running = True
    _thread = threading.Thread(target=_run_forever, daemon=True, name="nhnl-scanner")
    _thread.start()
    _log.info("[nhnl] accumulator started (tick=%.1fs)", _tick_seconds())


def stop() -> None:
    """Signal the loop to exit (used by lifespan shutdown / tests)."""
    global _running
    _running = False
