"""Intraday relative-volume accumulator — the "Volume Surge" scanner.

A fast whole-market scanner for stocks trading UNUSUALLY heavily today — the same
"Rel Vol" a TC2000 user watches — combined with a real price move, so the list
surfaces names reacting to something (often before the catalyst hits the wires).

## The metric (time-of-day RVOL — the proper one)
RVOL is the classic relative-volume: today's CUMULATIVE volume so far divided by
how much this name TYPICALLY trades by this point in the day. So a name that has
already done 3× its normal-by-now volume reads 3× — whether it gapped at the open
or ignited at 2pm (its cumulative jumps above the expected curve either way).

  expected(t) = prev_day_volume × cumulative_fraction(t)   -- the U-shaped day curve
  RVOL        = today's cumulative volume (min.av) / expected(t)
  move        = % price change over the last ~_PRICE_SECS (the move the volume drives)

This is inherently time-of-day-aware: at the 9:30 open everything is heavy, so the
expected curve is already steep and only a GENUINE surge stands out; at lunch the
curve is flat, so a modest pickup still reads as unusual — exactly right. It also
needs no warm-up (RVOL is computable from the first snapshot) and works in pre/RTH/
post because `min.av` (accumulated day volume) grows across all sessions and the
curve extends over 4:00 AM – 8:00 PM ET.

We EXCLUDE dark-pool / illiquid noise structurally: a name is only "lit" (coloured)
if it BOTH reads unusually active (RVOL) AND is actually moving in price AND has
traded a meaningful $ amount in the last minute (the "50× of nothing" guard).

## Scope / rollout
Ships DARK behind `VOLUME_SCANNER_ENABLED=1`. Runs web-side as a bounded single
writer thread; scans the N most-liquid names and SHARES the one whole-market
snapshot pull with `nhnl_live` via `massive.get_full_market_snapshot_hl_cached`
(no extra REST). Served by `api/routers/volume_scan.py` (paid-gated). A future
per-second `A.*` push feed can drive `min.av`/price in ~1s instead of the ~2.5s poll.
"""
import logging
import os
import threading
import time as _time
from collections import deque
from datetime import datetime

# Session-window + universe helpers are shared with the NH/NL scanner (pure, no
# thread required) so the two feeds cover the same universe and sessions.
from api.services.nhnl_live import _active_window, _universe_map, _etf_set, _ext_value

try:
    import zoneinfo
    _ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = None

_log = logging.getLogger(__name__)

# ── Tunables (env-overridable) ────────────────────────────────────────────────
_DEFAULT_TICK_SECONDS = 2.5
_PRICE_SECS = 120.0       # price-move window (the move the volume is driving)
_NOW_DOLLAR_SECS = 60.0   # window for "meaningful $ traded lately" (the noise gate)
_HIST_SECS = 720.0        # keep ~12 min of (t, cum_vol, price) history per name (covers
                          # the sustained-volume window below)
_MIN_SAMPLE_GAP = 3.0     # downsample history writes (bounds memory vs the tick rate)
_RVOL_CAP = 100.0         # clamp RVOL so an early-session near-zero expected can't blow up
_MIN_EXPECTED_FRAC = 0.002  # floor on cumulative_fraction so expected() is never ~0

# Serve-side qualification defaults (all overridable per request).
_DEFAULT_MIN_PRICE = 1.0
# High ceiling, NOT a tight band: this scanner exists to catch big fast movers, and the
# most newsworthy names are high-priced megacaps (META ~$590, NFLX, AVGO, BKNG…). A
# $250 cap silently hid EVERY one of them — META could gap on breaking news and never
# appear. The move / RVOL / burst / $-volume gates are all price-agnostic, so the only
# thing worth excluding up here is a non-trading outlier (BRK.A).
_DEFAULT_MAX_PRICE = 20000.0
_DEFAULT_MIN_LIQ = 100_000     # prev-day volume (shares) — the "avg vol > 100k" floor
_DEFAULT_MIN_RVOL = 2.0
_DEFAULT_MIN_MOVE = 0.25       # % over the ~2-min price window — the dark-pool / drift gate
_DEFAULT_MIN_DAY_MOVE = 1.0    # a clear |% vs prev close| ALSO clears the move gate — a name
                               # up big on the day WITH real volume is a move even if the
                               # 2-min window is momentarily flat (the pre-market news shape)
# The "50× of nothing" guard: session-aware $-volume traded in the last ~minute.
_DEFAULT_MIN_DOLLAR_RTH = 50_000
_DEFAULT_MIN_DOLLAR_EXT = 15_000

# Burst RVOL — the recent-window volume RATE vs the rate a name TYPICALLY trades at
# this time of day (prev_vol × the cumulative curve's slope). Cumulative RVOL dilutes
# a fresh spike into the whole day and lags worst late in the session; burst reads the
# ignition directly. Burst DRIVES a discovery path for `lit` (surface a fast mover
# before its cumulative RVOL catches up) + the "igniting" pulse cue — but NOT the
# colour tier. The tier tracks cumulative RVOL, so a burst on a quiet name lights and
# pulses yet stays calm/dim; the loud colours are reserved for genuinely heavy volume.
_BURST_CAP = 50.0            # clamp a fresh spike measured against a near-zero expected
_DEFAULT_MIN_BURST = 3.0     # burst-path lit gate (recent 60-sec rate ≥ 3× typical-for-now)
# "Igniting now" pulse (the gold ring) — keyed off SUSTAINED volume, NOT the 60-sec burst:
# a 60-sec blip on a quiet name reads as a huge burst (tiny expected) and would ring a
# nothing-name (AEM at 0.12×) while a real sustained mover (META) that isn't spiking in
# THIS 60 sec would not. Ring only genuinely-heavy sustained names that are moving fast.
_IGNITE_RVOL = 6.0           # SUSTAINED RVOL genuinely high (≥ Very High tier, t4+)…
_IGNITE_MOVE = 0.75          # …AND a real, fast price move
# Instant surge — the OTHER way to light: catch a genuine explosion the SECOND it happens,
# without waiting for the sustained window to fill. Deliberately HIGH bars (a big burst AND
# a real fast move together) so modest blips on quiet names don't flicker in.
# Keyed off burst_intraday = recent-minute pace vs the stock's OWN day pace, so a real
# explosion (quiet → a huge minute, like CRCL) fires but a name merely elevated-vs-a-normal-
# day (META) does not. The 60-sec window inherently smooths single-second blips → no flashes.
_INSTANT_SURGE = 5.0         # recent-minute pace ≥ 5× the stock's own day pace…
_SURGE_MOVE = 1.0            # …AND a real fast move (≥ 1% over the ~2-min window)
# White FLASH — the loudest alert, reserved for a genuinely SHARP move on big volume: a
# SUDDEN range expansion (sharpness) vs the stock's own recent 1-min candles, NOT a smooth
# 45° grind at elevated volume. A heavy-volume name still SHADES a colour, but only a big +
# SHARP move flashes white.
_SHARP_MIN = 2.5            # recent move ≥ 2.5× the stock's own recent 1-min moves…
_FLASH_MOVE = 1.0           # …AND a real move (≥ 1%)
# A SHARP range-expansion candle (a sudden vertical move on a volume burst — the INTC /
# CRCL shape) is the catch even when the raw % move is small: a low-ADR megacap making a
# genuine sharp push moves less in % terms than a small-cap, so the 1% instant floor would
# miss it. When sharpness ≥ _SHARP_MIN AND the burst is big, only this smaller move is
# required — the expansion IS the signal.
_SHARP_SURGE_MOVE = 0.4
# Intraday-surge gate — a name below the "extreme level" bar must be ACCELERATING vs its
# OWN day pace to light (not merely elevated-and-flat). `surge_intraday` = recent pace ÷
# day pace; an earnings name coasting on yesterday's volume (SMTC/SCHW) reads ~1 and is
# excluded, while a genuine fresh surge reads well above 1.
_SUSTAINED_HIGH_RVOL = 6.0   # at/above this vs a normal day, show it even if plateaued (if moving)
_MIN_INTRADAY_SURGE = 1.5    # below the high bar, require recent pace ≥ 1.5× the day pace
# MEGACAP surge lift. RVOL is measured vs a NORMAL day, so a megacap (INTC trades ~40M/day)
# making a genuine sustained surge still reads only ~2-3× and gets buried under small-caps at
# 10×. When a name is accelerating HARD vs its OWN day pace (surge_intraday, recent rate ÷
# day-average rate) — well beyond the routine into-the-close pickup — its effective surge
# strength is lifted toward that acceleration, so a real megacap push (INTC) tiers bold and
# ranks to the top and STAYS there while the volume is sustained. Gated high enough (2.5×)
# that the normal late-day volume ramp doesn't lift the whole board.
_SURGE_BOOST_MIN = 2.5        # recent pace ≥ 2.5× the stock's OWN day pace (a real acceleration)…
_SURGE_BOOST_MIN_RVOL = 2.0  # …AND recent rate ≥ 2× a NORMAL day (genuinely elevated, not just a dead morning)
# COASTING cap — the other side of the boost. A name elevated-but-FLAT (an earnings name
# trading heavy ALL day, surge_intraday ~1) has a high RVOL-vs-a-normal-day but is doing
# nothing UNUSUAL right now. Its effective tier is capped so it doesn't scream "Very High"
# for hours on stale earnings volume. The tier now weights the INTRADAY acceleration, not
# just volume-vs-a-normal-day — so the bold tiers require the volume to be EXPANDING now.
_COAST_SURGE = 1.5           # at/below this the name is coasting (elevated, not accelerating)…
_COAST_TIER_CAP = 3.5        # …so its effective surge caps at ~T2 (Elevated), below the
                             # extreme-bypass level — it shows its elevated volume but stays calm

# Sustained relative volume — the PRIMARY signal (recent ~10-min rate vs typical-for-now).
# Cumulative RVOL dilutes a fresh surge with the quiet early session (META reads ~3×
# cumulative while its last 10 min is ~12×); this tracks the sustained intensity, so a real
# news move lights BOLD and stays lit + ranked until the volume actually dies back down.
# Drives the colour tier, the ranking, and the displayed RVOL; cumulative is kept as
# `rvol_day` for context.
_SUSTAIN_SECS = 600.0        # ~10-min sustained window
_SUSTAIN_MIN_WIN = 120.0     # need ≥2 min of history before it's trusted (else cumulative)

_DEFAULT_UNIVERSE_TOP = 300    # scan only the N most liquid names (by $ volume)
_TOP_TTL = 3600.0             # rebuild the top-liquid set hourly

_HIST_MAX = int(_HIST_SECS / _MIN_SAMPLE_GAP) + 5

# ── Intraday cumulative-volume curve (fraction of a normal day's volume traded by
# a given ET time). Piecewise-linear over 4:00 AM–8:00 PM; a standard equity U-shape:
# a small pre-market slice, a heavy open, a flat midday, a heavy close (incl. the
# closing auction), then a thin post-market tail. Keyed by minute-of-day (ET). ──────
_CUM_CURVE = [
    (240, 0.000),   # 04:00 pre-market open
    (570, 0.050),   # 09:30 RTH open — ~5% of daily volume done in pre-market
    (600, 0.160),   # 10:00 — first 30 min is heavy
    (630, 0.235),   # 10:30
    (660, 0.300),   # 11:00
    (720, 0.420),   # 12:00
    (780, 0.520),   # 13:00
    (840, 0.620),   # 14:00
    (900, 0.735),   # 15:00
    (930, 0.820),   # 15:30 — power hour ramps
    (960, 0.950),   # 16:00 RTH close (incl. closing auction)
    (1080, 0.980),  # 18:00
    (1200, 1.000),  # 20:00 post-market close
]


def _cumfrac(now: datetime) -> float:
    """Fraction of a normal day's volume expected to have traded by `now` (ET)."""
    m = now.hour * 60 + now.minute + now.second / 60.0
    if m <= _CUM_CURVE[0][0]:
        return _CUM_CURVE[0][1]
    if m >= _CUM_CURVE[-1][0]:
        return _CUM_CURVE[-1][1]
    for i in range(1, len(_CUM_CURVE)):
        m1, f1 = _CUM_CURVE[i]
        if m <= m1:
            m0, f0 = _CUM_CURVE[i - 1]
            return f0 + (f1 - f0) * (m - m0) / (m1 - m0)
    return _CUM_CURVE[-1][1]


def _cumrate(now: datetime) -> float:
    """Expected fraction of a normal day's volume traded PER SECOND at `now` (ET) —
    the slope of the cumulative curve. This is the baseline rate a burst is measured
    against (burst = actual recent rate / this). Flat (0.0) outside 4:00 AM–8:00 PM,
    where the curve's endpoints hold and a "rate" has no meaning."""
    m = now.hour * 60 + now.minute + now.second / 60.0
    if m <= _CUM_CURVE[0][0] or m >= _CUM_CURVE[-1][0]:
        return 0.0
    for i in range(1, len(_CUM_CURVE)):
        m1, f1 = _CUM_CURVE[i]
        if m <= m1:
            m0, f0 = _CUM_CURVE[i - 1]
            return (f1 - f0) / (m1 - m0) / 60.0   # fraction-per-minute → per-second
    return 0.0


# ── Session state (guarded by _lock) ──────────────────────────────────────────
_lock = threading.Lock()
_state = {
    "session_key": None,   # f"{date}:{window}" — history resets when this rolls
    "window": "closed",
    "date": None,
    "syms": {},            # app_sym -> per-symbol dict (see _new_sym)
    "asof": None,
    "ticks": 0,
    "last_error": None,
}

_running = False
_thread = None

# The top-N most-liquid names to scan (app-syms), rebuilt hourly from the snapshot's
# prev_close × prev_vol. Restricting the universe keeps the list to genuinely
# tradable names AND is the bounded set a future tick push can cover cheaply.
_top_set: set | None = None
_top_built = 0.0

# Provider symbols currently subscribed to bar_stream (owner="volume") for the A.* push.
_subscribed_provs: set = set()

# Custom scan lists — app-symbols a user's OWN list asks the scanner to actively track, on
# top of the top-N liquid universe. Registered (app-sym -> expiry epoch) on each live request
# carrying `syms`, with a TTL so a name stops being tracked shortly after the user switches
# away. Bounded so it can never grow without limit.
_custom_registry: dict = {}
_CUSTOM_TTL = 300.0        # seconds a requested symbol stays tracked after its last request
_CUSTOM_MAX = 3000         # hard cap on the total custom universe (across all users)


def register_custom_syms(app_syms) -> None:
    """Keep the given app-symbols tracked (refresh their TTL). Called from get_live when a
    request carries a user's custom list, so those names build metrics + get the A.* push."""
    now = _time.time()
    exp = now + _CUSTOM_TTL
    reg = _custom_registry
    for k in [k for k, e in reg.items() if e <= now]:   # prune expired first
        reg.pop(k, None)
    for s in app_syms:
        if s in reg or len(reg) < _CUSTOM_MAX:
            reg[s] = exp


def _custom_active() -> set:
    now = _time.time()
    return {k for k, e in _custom_registry.items() if e > now}


def _now_et() -> datetime:
    return datetime.now(_ET) if _ET else datetime.utcnow()


def enabled() -> bool:
    return os.environ.get("VOLUME_SCANNER_ENABLED", "0") == "1"


def _demo() -> bool:
    return os.environ.get("VOLUME_DEMO", "0") == "1"


def _push_enabled() -> bool:
    """Instant push: drive min.av/price from the Massive A.* per-second aggregate feed
    (via bar_stream's shared on_bar) so metrics refresh in ~1s instead of the ~2.5s REST
    poll. Dark by default; the REST poll stays the authority for tracking + baselines."""
    return os.environ.get("VOLUME_PUSH_ENABLED", "0") == "1"


def _tick_seconds() -> float:
    try:
        return max(1.0, float(os.environ.get("VOLUME_TICK_SECONDS", _DEFAULT_TICK_SECONDS)))
    except (TypeError, ValueError):
        return _DEFAULT_TICK_SECONDS


def _top_n() -> int:
    try:
        return max(1, int(os.environ.get("VOLUME_UNIVERSE_TOP", _DEFAULT_UNIVERSE_TOP)))
    except (TypeError, ValueError):
        return _DEFAULT_UNIVERSE_TOP


def _rebuild_top_set(snapshot: dict, prov_map: dict, etf: set, n: int) -> set:
    """The N most-liquid app-syms by yesterday's dollar volume (prev_close ×
    prev_vol) from the current snapshot. ETFs excluded (this is a stocks scanner)."""
    scored = []
    for prov, app in prov_map.items():
        if app in etf:
            continue
        row = snapshot.get(prov)
        if not row:
            continue
        dvol = (row.get("prev_close") or 0) * (row.get("prev_vol") or 0)
        if dvol > 0:
            scored.append((dvol, app))
    scored.sort(reverse=True)
    return {app for _dv, app in scored[:n]}


# ── Metric (pure) ─────────────────────────────────────────────────────────────
def _at_or_after(hist, target_t):
    """First (t, cv, px) sample with t >= target_t (hist is oldest-first)."""
    for s in hist:
        if s[0] >= target_t:
            return s
    return None


def _price_sharpness(hist, t_now):
    """How SUDDEN the recent move is vs the stock's OWN recent ~1-min moves — an ATR-style
    range-expansion read off the close series. ~1 = a steady trend (every minute moves about
    the same, e.g. a smooth 45° grind); high = a sharp expansion (a minute that blows out vs
    the recent norm, e.g. a fast breakout/flush). None until there's enough history. This is
    what tells a genuine SHARP move apart from a smooth one at the same volume."""
    if len(hist) < 6:
        return None
    step = 55.0
    pts = []                       # prices ~55s apart, newest first, back ~10 min
    nxt = t_now
    for s in reversed(hist):
        if s[0] <= nxt and isinstance(s[2], (int, float)) and s[2] > 0:
            pts.append(s[2])
            nxt = s[0] - step
            if len(pts) >= 11:
                break
    if len(pts) < 3:
        return None
    moves = [abs(pts[i] - pts[i + 1]) / pts[i + 1] * 100.0
             for i in range(len(pts) - 1) if pts[i + 1] > 0]
    if len(moves) < 2:
        return None
    recent = moves[0]
    typ = sum(moves[1:]) / len(moves[1:])
    return round(recent / max(typ, 0.04), 2)


def _compute_metrics(hist, prev_close, prev_vol, cumfrac, cum_rate):
    """Turn one symbol's rolling (t, cum_vol, px) history + the day's expected-so-far
    fraction (and its per-second slope `cum_rate`) into the served metrics, or None
    when it can't be rated. Pure."""
    if not hist:
        return None
    t_now, cv_now, px_now = hist[-1]
    if not isinstance(px_now, (int, float)) or px_now <= 0:
        return None
    if not isinstance(prev_vol, (int, float)) or prev_vol <= 0:
        return None   # no historical volume baseline → can't compute RVOL

    # Cumulative RVOL = today's cumulative volume / typical cumulative-by-now (context only;
    # the PRIMARY `rvol` below is the sustained recent rate).
    expected = prev_vol * max(cumfrac, _MIN_EXPECTED_FRAC)
    rvol_day = min(_RVOL_CAP, cv_now / expected) if expected > 0 else 0.0

    # Price move over the ~2-min window (the move the volume is driving).
    move = 0.0
    p = _at_or_after(hist, t_now - _PRICE_SECS)
    if p is not None and isinstance(p[2], (int, float)) and p[2] > 0:
        move = (px_now - p[2]) / p[2] * 100.0

    # $ actually traded in the last ~minute (the illiquid-noise gate).
    a = _at_or_after(hist, t_now - _NOW_DOLLAR_SECS)
    recent_vol = max(0.0, cv_now - a[1]) if a is not None else 0.0
    now_dollar = recent_vol * px_now if a is not None else 0.0

    # Burst RVOL — the recent-window volume rate vs the rate this name TYPICALLY
    # trades at this time of day (prev_vol × cum_rate). Reuses the now-window sample
    # `a`, so it shares the "last minute" span; expected scales with the real elapsed
    # window. Cumulative RVOL lags a fresh ignition — this reads it directly.
    burst = 0.0
    if a is not None and cum_rate > 0:
        win = max(1.0, t_now - a[0])
        expected_recent = prev_vol * cum_rate * win
        if expected_recent > 0:
            burst = min(_BURST_CAP, recent_vol / expected_recent)

    # Sustained relative volume (the PRIMARY signal) — the recent ~10-min volume rate vs
    # the rate typically traded now. RISES while volume stays heavy and DECAYS when it
    # dies, so a real news move reads high and STAYS high until the volume fades — unlike
    # cumulative RVOL, which the quiet early session dilutes. Falls back to cumulative
    # until a name has enough history to measure the sustained window.
    svol = None
    ss = _at_or_after(hist, t_now - _SUSTAIN_SECS)
    if ss is not None and cum_rate > 0:
        swin = t_now - ss[0]
        if swin >= _SUSTAIN_MIN_WIN:
            exp_sustain = prev_vol * cum_rate * swin
            svol = min(_RVOL_CAP, max(0.0, cv_now - ss[1]) / exp_sustain) if exp_sustain > 0 else 0.0
    rvol = svol if svol is not None else rvol_day

    # Intraday surge = recent pace vs the stock's OWN day-so-far pace (svol ÷ cumulative).
    # >1 = accelerating (a fresh pickup); ~1 = coasting at its day pace; <1 = decelerating.
    # This separates a genuine surge from a name that's merely ELEVATED-and-flat — an
    # earnings name coasting on yesterday's heavy volume reads ~3× vs a normal day but ~1×
    # vs its own pace, so it should NOT light. None until the sustained window is built
    # (a freshly-tracked mover isn't held back — the gate is skipped while unknown).
    surge_intraday = round(svol / rvol_day, 2) if (svol is not None and rvol_day > 0) else None
    # Instant version (60-sec window) — recent-minute pace vs the stock's OWN day pace. A
    # CRCL-style explosion (quiet all morning, then a 700K-share minute) reads very high
    # here; a name merely elevated-vs-a-normal-day (META) reads low. Fires the instant catch.
    burst_intraday = round(burst / rvol_day, 2) if rvol_day > 0 else 0.0
    sharpness = _price_sharpness(hist, t_now)   # sudden range expansion vs recent 1-min moves

    pct = None
    if isinstance(prev_close, (int, float)) and prev_close > 0:
        pct = (px_now - prev_close) / prev_close * 100.0
    return {
        "price": round(float(px_now), 4),
        "pct": round(pct, 2) if pct is not None else None,
        "rvol": round(rvol, 2),          # PRIMARY: sustained recent rate (cumulative fallback)
        "rvol_day": round(rvol_day, 2),  # cumulative-on-the-day (context)
        "surge_intraday": surge_intraday,  # recent pace ÷ own day pace (>1 accelerating, <1 fading)
        "burst_intraday": burst_intraday,  # recent-MINUTE pace ÷ own day pace (the instant-catch signal)
        "sharpness": sharpness,            # recent move ÷ own recent 1-min moves (range expansion)
        "burst": round(burst, 2),
        "move": round(move, 2),
        "dvol": round(now_dollar),
    }


def _tradable_floor(price, prev_vol, min_price, max_price, min_liq) -> bool:
    return (isinstance(price, (int, float)) and min_price <= price <= max_price
            and isinstance(prev_vol, (int, float)) and prev_vol >= min_liq)


def _new_sym() -> dict:
    return {"hist": deque(maxlen=_HIST_MAX), "last_add": 0.0,
            "m": None, "prev": None, "prev_vol": None}


def _reset(session_key: str, window: str, date: str) -> None:
    """Start a fresh session's accumulation. Caller holds _lock."""
    _state["session_key"] = session_key
    _state["window"] = window
    _state["date"] = date
    _state["syms"] = {}
    _state["ticks"] = 0
    _log.info("[volume] session reset for %s", session_key)


def _tick_once(snapshot: dict, window: str, today: str, now: datetime, sample_t: float) -> None:
    """Fold one snapshot into the current window's accumulator.

    Pure w.r.t. its inputs so tests can drive synthetic sequences. `sample_t` is the
    epoch the SNAPSHOT volume was measured (so the price/dollar windows use the real
    interval, not when we read the cache)."""
    now_iso = now.isoformat()
    if window == "closed":
        with _lock:
            _state["window"] = "closed"
            _state["asof"] = now_iso
        return

    session_key = f"{today}:{window}"
    prov_map = _universe_map()
    etf = _etf_set()
    is_rth = window == "rth"
    cumfrac = _cumfrac(now)
    cum_rate = _cumrate(now)
    # Scan only the N most-liquid names (rebuilt hourly from the snapshot).
    global _top_set, _top_built
    if _top_set is None or (sample_t - _top_built) >= _TOP_TTL:
        rebuilt = _rebuild_top_set(snapshot, prov_map, etf, _top_n())
        if rebuilt:
            _top_set = rebuilt
            _top_built = sample_t
    top = _top_set
    custom = _custom_active()
    # Custom-list names that aren't in the standard breadth universe map (ETFs, leveraged/
    # inverse funds like USO/SOXL/UVXY, any liquid ticker the user adds) must still be
    # visited — the loop otherwise only iterates the top-N stock universe, so those names
    # would never get a reading. Map each such name to its provider symbol (== the app sym
    # for anything without a class dot).
    iter_map = prov_map
    if custom:
        tracked_apps = set(prov_map.values())
        extra = {}
        for app in custom:
            if app in tracked_apps:
                continue
            prov = app
            try:
                from api.services import massive
                prov = massive.to_polygon_symbol(app)
            except Exception:
                prov = app
            extra[prov] = app
        if extra:
            iter_map = {**prov_map, **extra}
    with _lock:
        if _state["session_key"] != session_key:
            _reset(session_key, window, today)
        syms = _state["syms"]

        for prov, app in iter_map.items():
            in_custom = app in custom
            if app in etf and not in_custom:    # stocks only, UNLESS the user put it on a list
                continue
            if not in_custom and top and app not in top:   # outside the top-N and not on a list
                continue
            row = snapshot.get(prov)
            if not row:
                continue
            cv = row.get("min_av") or row.get("today_vol") or 0   # accumulated day volume
            if not cv:
                continue
            price = row.get("last_price") if is_rth else (_ext_value(row) or row.get("last_price"))
            if not isinstance(price, (int, float)) or price <= 0:
                continue
            pv = row.get("prev_vol") or 0
            if price < 0.5 or pv < 20_000:      # can never qualify → don't track (bounds memory)
                continue

            st = syms.get(app)
            if st is None:
                st = _new_sym()
                syms[app] = st
            st["prev"] = row.get("prev_close")
            st["prev_vol"] = row.get("prev_vol")

            hist = st["hist"]
            if hist and cv < hist[-1][1]:       # cumulative counter dropped → reset (day/provider roll)
                hist.clear()
            if not hist or (sample_t - st["last_add"]) >= _MIN_SAMPLE_GAP:
                hist.append((sample_t, int(cv), float(price)))
                st["last_add"] = sample_t

            st["m"] = _compute_metrics(hist, st["prev"], st["prev_vol"], cumfrac, cum_rate)

        _state["asof"] = now_iso
        _state["ticks"] += 1


def get_live(limit: int = 100, min_price: float = None, max_price: float = None,
             min_rvol: float = None, min_move: float = None, min_liq: float = None,
             min_dollar: float = None, min_burst: float = None,
             syms: list = None, show_all: bool = False) -> dict:
    """Relative-volume leaderboard for the endpoint.

    Two modes:
      show_all=False → only the names that MEET the criteria, ranked by score
                       (rvol × move-weight) — a tight "what's surging now" list.
      show_all=True  → the WHOLE tradable top-N universe, lit names first then by
                       RVOL, each row carrying a `lit` flag = does it meet the
                       criteria. The UI shows every name but colours only the lit ones.

    The gates that make a row `lit` (and that filter the show_all=False list):
      min_price / max_price  price band ($1–$250)
      min_liq                prev-day volume floor (the "avg vol > 100k" gate)
      min_rvol               relative-volume floor (the surge gate)
      min_move               |move| floor over the price window (the dark-pool gate)
      min_dollar             now-window $-volume floor (the illiquid-noise gate)
    """
    window = "rth" if _demo() else _active_window(_now_et())
    mnp = _DEFAULT_MIN_PRICE if min_price is None else min_price
    mxp = _DEFAULT_MAX_PRICE if max_price is None else max_price
    mnr = _DEFAULT_MIN_RVOL if min_rvol is None else min_rvol
    mnm = _DEFAULT_MIN_MOVE if min_move is None else min_move
    mnl = _DEFAULT_MIN_LIQ if min_liq is None else min_liq
    if min_dollar is not None:
        mnd = min_dollar
    else:
        mnd = _DEFAULT_MIN_DOLLAR_RTH if window == "rth" else _DEFAULT_MIN_DOLLAR_EXT
    mnb = _DEFAULT_MIN_BURST if min_burst is None else min_burst
    # Custom list: scan ONLY the user's names. Register them (keeps them tracked + pushed)
    # and filter the leaderboard to that set. Their own picks bypass the liquidity floor.
    wanted = None
    if syms:
        wanted = {str(s).strip().upper() for s in syms if s and str(s).strip()}
        if wanted:
            register_custom_syms(wanted)
        else:
            wanted = None
    try:
        limit = max(1, min(int(limit), 300))
    except (TypeError, ValueError):
        limit = 100

    def _is_lit(m):
        # Best of both, gated by real $ flow:
        #  • SUSTAINED — a genuinely EXTREME level (show even if plateaued) OR a real pickup
        #    that is ACCELERATING vs the stock's OWN day pace (surge_intraday). NOT a name
        #    merely elevated-and-flat, coasting on yesterday's earnings volume (SMTC/SCHW
        #    read ~3× vs a normal day but ~1× vs their own pace). The surge gate only
        #    applies once we have that reading; a freshly-tracked mover isn't held back.
        #  • INSTANT SURGE — a genuine explosion right now (big burst + a real fast move),
        #    caught the SECOND it happens. HIGH bars keep modest blips on quiet names out.
        # A "move" = the last ~2 min OR up big on the day (robust when the 2-min window is
        # momentarily flat — the pre-market news shape).
        if m.get("dvol", 0) < mnd:
            return False
        moved = abs(m["move"]) >= mnm or abs(m.get("pct") or 0.0) >= _DEFAULT_MIN_DAY_MOVE
        surge = m.get("surge_intraday")
        accelerating_ok = surge is None or surge >= _MIN_INTRADAY_SURGE
        eff = _eff_rvol(m)   # sustained RVOL, lifted by a hard intraday acceleration (megacaps)
        sustained = moved and (
            eff >= _SUSTAINED_HIGH_RVOL
            or (eff >= mnr and accelerating_ok)
        )
        return sustained or _instant_surge(m)

    def _igniting(m):
        # The gold ring = a GENUINE surge happening NOW — an instant explosion (a vertical
        # candle towering over the stock's own day pace, like CRCL / INTC), OR a heavy name
        # ACCELERATING (not just plateaued) with a real move. Never a coasting flat name.
        surge = m.get("surge_intraday")
        accelerating = (_eff_rvol(m) >= _IGNITE_RVOL and abs(m["move"]) >= _IGNITE_MOVE
                        and (surge is None or surge >= _MIN_INTRADAY_SURGE))
        return accelerating or _instant_surge(m)

    def _score(m):
        # Rank by EFFECTIVE surge strength (what the colour reflects), weighted by the move.
        # Burst LIGHTS + PULSES a fresh mover but does not inflate its rank, so the loud heavy
        # names lead and marginal bursts don't crowd the top.
        mw = abs(m["move"]) / 0.5
        mw = 0.35 if mw < 0.35 else (2.5 if mw > 2.5 else mw)
        return _eff_rvol(m) * mw

    with _lock:
        asof = _state["asof"]
        session_date = _state["date"]
        ticks = _state["ticks"]
        rows = []   # (sym, m, lit)
        for sym, st in _state["syms"].items():
            if wanted is not None and sym not in wanted:
                continue
            m = st.get("m")
            if not m:
                continue
            # A user's own list is shown as-is; the top-N default keeps the tradable floor.
            if wanted is None and not _tradable_floor(m["price"], st.get("prev_vol"), mnp, mxp, mnl):
                continue
            lit = _is_lit(m)
            if not show_all and not lit:
                continue
            rows.append((sym, m, lit))

    if show_all:
        # Genuine surges LEAD: igniting names (a big instant surge OR sustained-heavy +
        # move) sit at the very top so a fresh explosion surfaces the second it happens;
        # then by sustained RVOL so heavy names stay near the top until they die down.
        rows.sort(key=lambda r: (r[2], _igniting(r[1]), _eff_rvol(r[1]), r[1].get("burst", 0.0)),
                  reverse=True)
    else:
        rows.sort(key=lambda r: _score(r[1]), reverse=True)
    lit_total = sum(1 for _s, _m, lit in rows if lit)
    out = []
    for sym, m, lit in rows[:limit]:
        burst = m.get("burst", 0.0)
        tier = _tier(m)
        sharp = m.get("sharpness")
        # WHITE FLASH — big volume AND a genuinely SHARP move (sudden range expansion),
        # NOT a smooth grind at elevated volume. Big-volume names still shade a colour
        # (the tier), but only a sharp move flashes.
        big_vol = tier >= 4 or m.get("burst_intraday", 0.0) >= _INSTANT_SURGE
        # Sharpness is the true discriminator: a sudden range expansion flashes even at a
        # smaller % move (INTC-shape), while a smooth grind (ANF, sharpness ~1) never does.
        flash = bool(lit and big_vol and abs(m["move"]) >= _SHARP_SURGE_MOVE
                     and sharp is not None and sharp >= _SHARP_MIN)
        out.append({
            "sym": sym,
            "price": round(m["price"], 2),
            "pct": m["pct"],
            "rvol": m["rvol"],
            "rvol_day": m.get("rvol_day"),
            "surge_intraday": m.get("surge_intraday"),
            "burst_intraday": m.get("burst_intraday"),
            "sharpness": sharp,
            "burst": burst,
            "move": m["move"],
            "dir": "up" if m["move"] >= 0 else "down",
            "dvol": m.get("dvol", 0),
            "tier": tier,
            "lit": lit,
            "flash": flash,
            # "Igniting now" — a strong burst AND a real move: the look-up-now cue.
            "igniting": bool(_igniting(m)),
        })
    return {
        "window": window,             # rth | pre | post | closed
        "date": session_date,
        "asof": asof,
        "ticks": ticks,
        "active": window != "closed" and _running and (enabled() or _demo()),
        "total": lit_total,           # names MEETING the criteria (header count)
        "shown": len(out),
        "universe_top": _top_n(),
        "filters": {"min_price": mnp, "max_price": mxp, "min_liq": mnl,
                    "min_rvol": mnr, "min_move": mnm, "min_dollar": mnd,
                    "min_burst": mnb},
        "rows": out,
    }


def _eff_rvol(m: dict) -> float:
    """Effective surge strength used for the tier + ranking + the sustained-lit test.

    Normally the sustained RVOL (vs a NORMAL day). BUT a name accelerating hard vs its OWN
    day pace (surge_intraday ≥ _SURGE_BOOST_MIN) is lifted toward that acceleration — so a
    megacap whose huge baseline makes a real surge read only ~2-3× vs a normal day still
    tiers bold and ranks up (the INTC shape), instead of being buried by absolute small-cap
    RVOLs. The 2.5× gate keeps the routine late-day volume ramp from lifting everything."""
    rvol = m.get("rvol") or 0.0
    surge = m.get("surge_intraday")
    if surge is None:
        return rvol   # freshly tracked — not enough history to judge acceleration yet
    # Lift only when the recent rate is GENUINELY elevated vs a normal day (rvol ≥ the boost
    # floor) AND accelerating hard vs its own day — so a name whose morning was dead but is
    # merely trading NORMALLY now (low rvol, high surge) is not inflated into a fake surge.
    if surge >= _SURGE_BOOST_MIN and rvol >= _SURGE_BOOST_MIN_RVOL:
        return max(rvol, float(surge))
    # COASTING — elevated but flat (surge ~1): cap the effective tier so an earnings name
    # heavy all day doesn't read "Very High" on stale volume. The bold tiers require the
    # volume to be EXPANDING now, not just high-vs-a-normal-day.
    if surge < _COAST_SURGE:
        return min(rvol, _COAST_TIER_CAP)
    return rvol


def _instant_surge(m: dict) -> bool:
    """A genuine explosion RIGHT NOW: a big burst vs the stock's own day pace, AND either a
    fast % move OR a sudden ATR-style range expansion (a vertical candle on the burst — the
    INTC / CRCL shape). The range-expansion arm catches low-ADR megacaps whose sharp move is
    real but under the 1% instant floor."""
    if (m.get("burst_intraday") or 0.0) < _INSTANT_SURGE:
        return False
    move = abs(m.get("move") or 0.0)
    if move >= _SURGE_MOVE:
        return True
    sharp = m.get("sharpness")
    return sharp is not None and sharp >= _SHARP_MIN and move >= _SHARP_SURGE_MOVE


def _rvol_tier(rvol: float) -> int:
    if rvol >= 10:
        return 5   # Extreme
    if rvol >= 6:
        return 4   # Very High
    if rvol >= 4:
        return 3   # High
    if rvol >= 3:
        return 2   # Elevated
    return 1       # Notable (2–3×, or burst-lit)


def _tier(m: dict) -> int:
    """Colour tier by EFFECTIVE surge strength — how significant/extreme the surge is
    (5 = Extreme … 1 = Notable). Boldness tracks the effective RVOL (sustained volume, lifted
    by a hard intraday acceleration for megacaps — see _eff_rvol) so a genuine sustained push
    gets the loud colours while weak/marginal prints stay calm. A 1-minute burst does NOT by
    itself inflate the tier — a fresh ignition is surfaced by the row's `igniting` pulse + its
    rank. UCT-palette ramp: faint green → gold → hot red."""
    return _rvol_tier(_eff_rvol(m))


def status() -> dict:
    with _lock:
        return {
            "enabled": enabled(),
            "running": _running,
            "window": _state["window"],
            "session_key": _state["session_key"],
            "date": _state["date"],
            "tracked_symbols": len(_state["syms"]),
            "rated_symbols": sum(1 for s in _state["syms"].values() if s.get("m")),
            "ticks": _state["ticks"],
            "asof": _state["asof"],
            "last_error": _state["last_error"],
            "tick_seconds": _tick_seconds(),
            "push_enabled": _push_enabled(),
            "push_subscribed": len(_subscribed_provs),
        }


def on_aggregate(sym: str, payload: dict, kind: str) -> None:
    """Instant push from the Massive A.* (per-second aggregate) feed, via bar_stream's
    shared on_bar. Refreshes ONE tracked symbol's accumulated volume + price and
    recomputes its metric in ~1s — instead of waiting for the ~2.5s REST poll. Runs on
    the WS thread, so it must be quick and NEVER raise (a shared callback). The REST poll
    stays the authority for tracking, prev-day baselines, and the top-N universe; this
    only refreshes symbols the poll already tracks."""
    if not _push_enabled() or kind not in ("A", "AM"):
        return
    try:
        if not isinstance(payload, dict):
            return
        av = payload.get("av")            # today's ACCUMULATED volume (authoritative)
        price = payload.get("c")          # aggregate close = latest traded price
        if (not isinstance(av, (int, float)) or av <= 0
                or not isinstance(price, (int, float)) or price <= 0):
            return
        app = _universe_map().get(sym)
        if app is None:
            return
        now = _now_et()
        if _active_window(now) == "closed":
            return
        cumfrac = _cumfrac(now)
        cum_rate = _cumrate(now)
        t = _time.time()
        with _lock:
            st = _state["syms"].get(app)
            if st is None or st.get("prev_vol") is None:
                return   # only the poll creates + baselines a symbol
            hist = st["hist"]
            if hist and av < hist[-1][1]:            # counter dropped (day/provider roll) → reset
                hist.clear()
            if not hist or (t - st["last_add"]) >= _MIN_SAMPLE_GAP:
                hist.append((t, int(av), float(price)))
                st["last_add"] = t
            else:
                hist[-1] = (t, int(av), float(price))   # refresh the developing point in place
            st["m"] = _compute_metrics(hist, st["prev"], st["prev_vol"], cumfrac, cum_rate)
    except Exception:
        pass   # a shared callback — never break the bars feed


def _sync_push_subscriptions() -> None:
    """Keep bar_stream subscribed to the scanner's tracked universe (owner="volume") so
    the A.* per-second aggregates flow for it. No-op unless the push is enabled; when it
    is turned OFF, drops any subscriptions we hold (clean rollback)."""
    global _subscribed_provs
    try:
        from api.services import bar_stream
    except Exception:
        return
    if not _push_enabled():
        if _subscribed_provs:
            try:
                bar_stream.unsubscribe_symbols(sorted(_subscribed_provs), owner="volume")
            except Exception:
                pass
            _subscribed_provs = set()
        return
    universe = set(_top_set or ()) | _custom_active()   # top-N + every active custom-list name
    if not universe:
        return
    app_to_prov = {app: prov for prov, app in _universe_map().items()}
    want = {app_to_prov[a] for a in universe if a in app_to_prov}
    new = want - _subscribed_provs
    gone = _subscribed_provs - want
    try:
        if new:
            bar_stream.subscribe_symbols(sorted(new), owner="volume")
        if gone:
            bar_stream.unsubscribe_symbols(sorted(gone), owner="volume")
    except Exception:
        return
    _subscribed_provs = want


def _tick() -> None:
    now = _now_et()
    today = now.strftime("%Y-%m-%d")
    window = _active_window(now)
    if window == "closed":
        _tick_once({}, "closed", today, now, _time.time())
    else:
        from api.services import massive
        snap = massive.get_full_market_snapshot_hl_cached()
        sample_t = massive.hl_snapshot_fetched_at() or _time.time()
        if not snap:
            with _lock:
                _state["last_error"] = "empty snapshot"
        else:
            _tick_once(snap, window, today, now, sample_t)
            with _lock:
                _state["last_error"] = None
    _sync_push_subscriptions()


def _run_forever() -> None:
    while _running:
        try:
            _tick()
        except Exception as e:
            _log.exception("[volume] tick failed")
            with _lock:
                _state["last_error"] = str(e)
        _time.sleep(_tick_seconds())


def start() -> None:
    """Start the background accumulator. No-op unless VOLUME_SCANNER_ENABLED=1."""
    global _running, _thread
    if not enabled() and not _demo():
        return
    if _running:
        return
    _running = True
    _thread = threading.Thread(target=_run_forever, daemon=True, name="volume-scanner")
    _thread.start()
    _log.info("[volume] accumulator started (tick=%.1fs)", _tick_seconds())


def stop() -> None:
    global _running, _subscribed_provs
    _running = False
    if _subscribed_provs:
        try:
            from api.services import bar_stream
            bar_stream.unsubscribe_symbols(sorted(_subscribed_provs), owner="volume")
        except Exception:
            pass
        _subscribed_provs = set()
