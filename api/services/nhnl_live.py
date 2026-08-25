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
    "session_date": None,        # ET date string the counters belong to (RTH day)
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


def _tick_seconds() -> float:
    try:
        return max(1.0, float(os.environ.get("NHNL_TICK_SECONDS", _DEFAULT_TICK_SECONDS)))
    except (TypeError, ValueError):
        return _DEFAULT_TICK_SECONDS


def enabled() -> bool:
    return os.environ.get("NHNL_SCANNER_ENABLED", "0") == "1"


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


def _reset(session_date: str) -> None:
    """Start a fresh session's accumulation. Caller holds _lock."""
    _state["session_date"] = session_date
    _state["syms"] = {}
    _state["events"] = deque(maxlen=_RING_MAX)
    _state["ticks"] = 0
    _log.info("[nhnl] session reset for %s", session_date)


def _tick_once(snapshot: dict, session: str, today: str, now: datetime) -> None:
    """Fold one snapshot into the session accumulator.

    Pure w.r.t. its inputs (snapshot/session/today/now) so tests can drive it with
    synthetic snapshot sequences. RTH only: a non-regular session just stamps
    `asof` and returns (Phase 1 does not accumulate pre/post — that's Phase 3).
    """
    now_iso = now.isoformat()
    if session != "regular":
        with _lock:
            _state["asof"] = now_iso
        return

    prov_map = _universe_map()
    with _lock:
        if _state["session_date"] != today:
            _reset(today)
        syms = _state["syms"]
        events = _state["events"]

        for prov, app in prov_map.items():
            row = snapshot.get(prov)
            if not row:
                continue
            dh = row.get("day_high")
            dl = row.get("day_low")
            price = row.get("last_price")
            if not isinstance(dh, (int, float)) or dh <= 0:
                continue  # no valid session high yet (pre-open rows read 0)

            st = syms.get(app)
            if st is None:
                # First sight today — SEED the marks, emit nothing. Counts are
                # "new HODs since we began watching this session".
                lod0 = dl if isinstance(dl, (int, float)) and dl > 0 else dh
                syms[app] = {"hod": dh, "lod": lod0, "nh": 0, "nl": 0, "last": price}
                continue

            # New high-of-day?
            if dh > st["hod"] * (1 + _EPS):
                if _is_tradable(app, row):
                    st["nh"] += 1
                    events.append({
                        "sym": app,
                        "price": round(float(price or dh), 2),
                        "count": st["nh"],
                        "ts": now_iso,
                        "dir": "high",
                    })
                st["hod"] = dh  # advance the mark even if untradable, so we never
                                # backfill a flood of highs if it later qualifies
            # New low-of-day?
            if isinstance(dl, (int, float)) and dl > 0 and dl < st["lod"] * (1 - _EPS):
                if _is_tradable(app, row):
                    st["nl"] += 1
                    events.append({
                        "sym": app,
                        "price": round(float(price or dl), 2),
                        "count": st["nl"],
                        "ts": now_iso,
                        "dir": "low",
                    })
                st["lod"] = dl
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
    from api.services import massive
    cur_session = massive._detect_session()
    with _lock:
        evs = list(_state["events"])
        asof = _state["asof"]
        session_date = _state["session_date"]
        ticks = _state["ticks"]

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
        "session": cur_session,
        "date": session_date,
        "asof": asof,
        "ticks": ticks,
        "active": _running and enabled(),
        "highs": highs,
        "lows": lows,
    }


def status() -> dict:
    """Diagnostics — accumulator health without the event payload."""
    with _lock:
        return {
            "enabled": enabled(),
            "running": _running,
            "session_date": _state["session_date"],
            "tracked_symbols": len(_state["syms"]),
            "events_buffered": len(_state["events"]),
            "ticks": _state["ticks"],
            "asof": _state["asof"],
            "last_error": _state["last_error"],
            "tick_seconds": _tick_seconds(),
        }


def _tick() -> None:
    """One scheduled cycle: fetch (only during RTH) and fold."""
    from api.services import massive
    now = _now_et()
    today = now.strftime("%Y-%m-%d")
    session = massive._detect_session()
    if session != "regular":
        _tick_once({}, session, today, now)  # stamps asof, no fetch
        return
    snap = massive._get_client().get_full_market_snapshot_hl()
    if not snap:
        with _lock:
            _state["last_error"] = "empty snapshot"
        return
    _tick_once(snap, session, today, now)
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
