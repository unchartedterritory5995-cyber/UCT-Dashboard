"""Intraday relative-volume accumulator — the "Volume Surge" scanner.

A lightning-fast, whole-market scanner for stocks REACTING to something right now:
an unusual spike in trading volume that is SUSTAINED over the last minute AND is
accompanied by real price movement. The ultimate goal is to surface a name the
moment size + price start moving together — often BEFORE the catalyst hits the
wires — and to drop it back down the instant the surge fades.

## Why a stateful accumulator (not a cached scan)
"Relative volume vs the last few minutes" cannot be read from a single snapshot —
you have to watch each symbol's cumulative volume evolve and compare its CURRENT
rate to its OWN trailing-baseline rate. So (like `nhnl_live`) this holds rolling
per-symbol history and a background thread ticks it every few seconds.

## The metric (why it catches news, and why it decays fast)
Per tick we read each name's accumulated day volume (`min.av`, which grows in
pre/RTH/post) and its session-aware price, and keep a short rolling history.

  now_rate   = Δvolume over the last  _NOW_SECS   (≈ last minute)   [shares/sec]
  base_rate  = Δvolume over the _BASE_SECS window that ENDS one _NOW_SECS ago
               (the recent "normal", deliberately EXCLUDING the current minute so
                a spike never inflates its own baseline)               [shares/sec]
  rvol       = now_rate / base_rate         → "how many × its recent normal"
  move       = % price change over _PRICE_SECS (the move the volume is driving)

Because `now_rate` is a trailing-minute rate, a one-off blip decays out of the
window within ~a minute and the name sinks — exactly the "must SUSTAIN elevated
volume" behaviour. We EXCLUDE dark-pool / non-directional prints structurally: a
name only scores if it BOTH surges in volume AND actually moves in price (a big
off-exchange print that doesn't move the tape fails the price gate).

  score = rvol × move_weight,  move_weight = clamp(|move| / _MOVE_REF, floor, cap)

so the ranking is dominated by relative volume (top = highest sustained RVOL) but
a name that is barely moving is discounted and a name genuinely breaking out is
lifted. Rows are colour-TIERED by RVOL.

## Sessions
`min.av` accumulates across pre/RTH/post, so the rate works in every window. Each
window (pre / rth / post) is its own session with its own baselines — they reset at
each open (a pre-market volume regime is not the RTH regime).

## Scope / rollout
Ships DARK behind `VOLUME_SCANNER_ENABLED=1`. Runs web-side as a bounded single
writer thread; it SHARES the one whole-market snapshot pull with `nhnl_live` via
`massive.get_full_market_snapshot_hl_cached` (no extra REST load). Served by
`api/routers/volume_scan.py` (`GET /api/volume-scan/live`, paid-gated).
"""
import json
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
_NOW_SECS = 60.0          # the "current" volume-rate window (≈ last minute)
_BASE_SECS = 600.0        # trailing-baseline window (10 min), ending _NOW_SECS ago
_PRICE_SECS = 120.0       # price-move window (the move the volume is driving)
_MIN_BASE_SPAN = 90.0     # need at least this much baseline history to rate a name
_MIN_SAMPLE_GAP = 4.5     # downsample history writes (bounds memory vs the tick rate)
_RVOL_CAP = 50.0          # clamp rvol so a near-dead baseline can't print ∞
_MOVE_REF = 0.5           # a |move| of this % → move_weight 1.0
_MOVE_W_FLOOR = 0.35      # a non-mover (dark-pool-ish) keeps only this share of its rvol
_MOVE_W_CAP = 2.5         # a big breakout lift is capped so rvol still dominates

# Serve-side qualification defaults (all overridable per request).
_DEFAULT_MIN_PRICE = 1.0
_DEFAULT_MAX_PRICE = 250.0
_DEFAULT_MIN_LIQ = 100_000     # prev-day volume (shares) — the "avg vol > 100k" floor
_DEFAULT_MIN_RVOL = 2.0
_DEFAULT_MIN_MOVE = 0.25       # % over the price window — the dark-pool / drift gate
# The "50× of nothing" guard: a relative-volume spike only counts if the name has
# ALSO actually traded a meaningful dollar amount in the now-window. CSIQ printing
# 143 shares (~$2k) after hours is 50× its own dead baseline but untradeable noise —
# this floor drops it while a real post-market news mover (tens of $k/min) sails
# through. Session-aware defaults: pre/post markets trade thinner than RTH.
_DEFAULT_MIN_DOLLAR_RTH = 50_000     # $ traded in the last ~minute (regular hours)
_DEFAULT_MIN_DOLLAR_EXT = 15_000     # pre-market / post-market floor

_DEFAULT_UNIVERSE_TOP = 300    # scan only the N most liquid names (by $ volume)
_TOP_TTL = 3600.0              # rebuild the top-liquid set hourly (liquidity is slow)

_HIST_MAX = int((_NOW_SECS + _BASE_SECS + 60) / _MIN_SAMPLE_GAP) + 5

# ── Session state (guarded by _lock) ──────────────────────────────────────────
_lock = threading.Lock()
_state = {
    "session_key": None,   # f"{date}:{window}" — baselines reset when this rolls
    "window": "closed",
    "date": None,
    "syms": {},            # app_sym -> per-symbol dict (see _tick_once)
    "asof": None,
    "ticks": 0,
    "last_error": None,
}

_running = False
_thread = None
_last_persist = 0.0
_PERSIST_SECS = 30.0

# The top-N most-liquid names to scan (app-syms), rebuilt hourly from the snapshot's
# prev_close × prev_vol (yesterday's dollar volume). Restricting the universe keeps
# the list to genuinely tradable names AND is the bounded set that a future
# tick-by-tick push feed can cover cheaply on the existing WebSocket.
_top_set: set | None = None
_top_built = 0.0


def _now_et() -> datetime:
    return datetime.now(_ET) if _ET else datetime.utcnow()


def enabled() -> bool:
    return os.environ.get("VOLUME_SCANNER_ENABLED", "0") == "1"


def _demo() -> bool:
    return os.environ.get("VOLUME_DEMO", "0") == "1"


def _tick_seconds() -> float:
    try:
        return max(1.0, float(os.environ.get("VOLUME_TICK_SECONDS", _DEFAULT_TICK_SECONDS)))
    except (TypeError, ValueError):
        return _DEFAULT_TICK_SECONDS


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


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


# ── Rate math (pure) ──────────────────────────────────────────────────────────
def _at_or_after(hist, target_t):
    """First (t, cv, px) sample with t >= target_t (hist is oldest-first)."""
    for s in hist:
        if s[0] >= target_t:
            return s
    return None


def _compute_metrics(hist, prev_close, prev_vol, seed_base):
    """Turn one symbol's rolling (t, cv, px) history into the served metrics, or
    None while it's still warming. Pure — the tick calls it under no lock."""
    if len(hist) < 2:
        return None
    t_now, cv_now, px_now = hist[-1]
    if not isinstance(px_now, (int, float)) or px_now <= 0:
        return None

    a = _at_or_after(hist, t_now - _NOW_SECS)      # boundary of the "now" window
    b = _at_or_after(hist, t_now - _NOW_SECS - _BASE_SECS)
    if a is None or a[0] >= t_now:
        return None
    now_shares = max(0.0, cv_now - a[1])           # shares traded in the now-window
    now_rate = now_shares / max(t_now - a[0], 1.0)
    now_dollar = now_shares * px_now               # $ actually traded in the last ~min

    # Baseline: prefer the measured trailing window; if history is still short,
    # fall back to the persisted seed so a name is rate-able within ~a minute of
    # a deploy instead of blank for 10 minutes.
    base_rate = None
    if b is not None and (a[0] - b[0]) >= _MIN_BASE_SPAN:
        base_rate = max(0.0, (a[1] - b[1]) / max(a[0] - b[0], 1.0))
    elif isinstance(seed_base, (int, float)) and seed_base > 0:
        base_rate = float(seed_base)
    if base_rate is None:
        return None

    # Floor the denominator at a small fraction of the name's own average
    # per-second volume so a dead-quiet baseline can't manufacture a huge rvol.
    avg_ps = (prev_vol or 0) / 23400.0            # ~6.5h RTH session in seconds
    min_base = max(0.5, avg_ps * 0.15)
    rvol = min(_RVOL_CAP, now_rate / max(base_rate, min_base))

    p = _at_or_after(hist, t_now - _PRICE_SECS)
    move = 0.0
    if p is not None and isinstance(p[2], (int, float)) and p[2] > 0:
        move = (px_now - p[2]) / p[2] * 100.0

    mw = abs(move) / _MOVE_REF
    mw = _MOVE_W_FLOOR if mw < _MOVE_W_FLOOR else (_MOVE_W_CAP if mw > _MOVE_W_CAP else mw)
    score = rvol * mw

    pct = None
    if isinstance(prev_close, (int, float)) and prev_close > 0:
        pct = (px_now - prev_close) / prev_close * 100.0
    return {
        "price": round(float(px_now), 4),
        "pct": round(pct, 2) if pct is not None else None,
        "rvol": round(rvol, 2),
        "move": round(move, 2),
        "score": round(score, 3),
        "dvol": round(now_dollar),   # $ traded in the now-window (the illiquid-noise gate)
        "base_rate": base_rate,      # persisted as the next boot's seed baseline
    }


def _tradable_floor(price, prev_vol, min_price, max_price, min_liq) -> bool:
    return (isinstance(price, (int, float)) and min_price <= price <= max_price
            and isinstance(prev_vol, (int, float)) and prev_vol >= min_liq)


def _reset(session_key: str, window: str, date: str, seeds: dict | None = None) -> None:
    """Start a fresh session's accumulation. Caller holds _lock. `seeds` maps
    app_sym -> base_rate restored from disk (used as the warming-baseline)."""
    _state["session_key"] = session_key
    _state["window"] = window
    _state["date"] = date
    _state["syms"] = {}
    if seeds:
        for app, base in seeds.items():
            _state["syms"][app] = _new_sym(seed_base=base)
    _state["ticks"] = 0
    _log.info("[volume] session reset for %s (%d seeds)", session_key, len(seeds or {}))


def _new_sym(seed_base=None) -> dict:
    return {"hist": deque(maxlen=_HIST_MAX), "last_add": 0.0,
            "seed_base": seed_base, "m": None, "prev": None, "prev_vol": None}


def _tick_once(snapshot: dict, window: str, today: str, now: datetime, sample_t: float) -> None:
    """Fold one snapshot into the current window's accumulator.

    Pure w.r.t. its inputs so tests can drive synthetic sequences. `sample_t` is
    the epoch the SNAPSHOT volume was measured (so rates use the real interval,
    not when we read the cache)."""
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
    # Scan only the N most-liquid names (rebuilt hourly from the snapshot). Restricts
    # the list to genuinely tradable stocks and bounds the tracked set.
    global _top_set, _top_built
    if _top_set is None or (sample_t - _top_built) >= _TOP_TTL:
        rebuilt = _rebuild_top_set(snapshot, prov_map, etf, _top_n())
        if rebuilt:
            _top_set = rebuilt
            _top_built = sample_t
    top = _top_set
    with _lock:
        if _state["session_key"] != session_key:
            _reset(session_key, window, today)
        syms = _state["syms"]

        for prov, app in prov_map.items():
            if app in etf:                      # stocks only (news reacts on stocks)
                continue
            if top and app not in top:          # outside the top-N liquid universe
                continue
            row = snapshot.get(prov)
            if not row:
                continue
            # Cumulative accumulated volume (grows across pre/RTH/post).
            cv = row.get("min_av") or row.get("today_vol") or 0
            if not cv:
                continue
            price = row.get("last_price") if is_rth else (_ext_value(row) or row.get("last_price"))
            if not isinstance(price, (int, float)) or price <= 0:
                continue
            # Don't build rolling history for names that can never qualify under any
            # sane filter (sub-cent junk / dead liquidity) — bounds the tracked set
            # (and its memory) to the couple-thousand names actually in play. The
            # serve-side band ($1–250 / 100k) still applies on top of this.
            pv = row.get("prev_vol") or 0
            if price < 0.5 or pv < 20_000:
                continue

            st = syms.get(app)
            if st is None:
                st = _new_sym()
                syms[app] = st
            st["prev"] = row.get("prev_close")
            st["prev_vol"] = row.get("prev_vol")

            hist = st["hist"]
            # A cumulative counter that DROPS = provider reset / day rollover → start
            # this name's history over so a false huge delta never registers.
            if hist and cv < hist[-1][1]:
                hist.clear()
            # Downsample history writes to bound memory vs the tick rate.
            if not hist or (sample_t - st["last_add"]) >= _MIN_SAMPLE_GAP:
                hist.append((sample_t, int(cv), float(price)))
                st["last_add"] = sample_t

            st["m"] = _compute_metrics(hist, st["prev"], st["prev_vol"], st["seed_base"])

        _state["asof"] = now_iso
        _state["ticks"] += 1


def get_live(limit: int = 100, min_price: float = None, max_price: float = None,
             min_rvol: float = None, min_move: float = None, min_liq: float = None,
             min_dollar: float = None, show_all: bool = False) -> dict:
    """Relative-volume leaderboard for the endpoint.

    Two modes:
      show_all=False → only the names that MEET the surge criteria, ranked by score
                       (rvol × move-weight) — a tight "what's surging now" list.
      show_all=True  → the WHOLE tradable top-N universe, ranked by RVOL descending,
                       each row carrying a `lit` flag = does it meet the criteria.
                       The UI shows every name but colours only the lit ones (so you
                       always see the ranking, and the colour tells you what's real).

    The gates that make a row `lit` (and that filter the show_all=False list):
      min_price / max_price  price band ($1–$250, like Trade Ideas)
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
    # The now-window dollar-volume floor (the illiquid-noise guard). Default is
    # session-aware — pre/post trade thinner than RTH — unless the caller overrides.
    if min_dollar is not None:
        mnd = min_dollar
    else:
        mnd = _DEFAULT_MIN_DOLLAR_RTH if window == "rth" else _DEFAULT_MIN_DOLLAR_EXT
    try:
        limit = max(1, min(int(limit), 300))
    except (TypeError, ValueError):
        limit = 100

    def _is_lit(m):
        return (m["rvol"] >= mnr and abs(m["move"]) >= mnm and m.get("dvol", 0) >= mnd)

    with _lock:
        asof = _state["asof"]
        session_date = _state["date"]
        ticks = _state["ticks"]
        rows = []   # (sym, m, lit)
        for sym, st in _state["syms"].items():
            m = st.get("m")
            if not m:
                continue
            # The price/liquidity band defines the tradable universe — applied in
            # BOTH modes (an un-tradable name is never shown, lit or not).
            if not _tradable_floor(m["price"], st.get("prev_vol"), mnp, mxp, mnl):
                continue
            lit = _is_lit(m)
            if not show_all and not lit:
                continue
            rows.append((sym, m, lit))

    if show_all:
        # Lit (real, criteria-meeting) names first — each group ranked by RVOL — so
        # the coloured signals sit at the top and greyed illiquid spikes (a 50× on a
        # few after-hours shares) sink to the bottom instead of leading the list.
        rows.sort(key=lambda r: (r[2], r[1]["rvol"]), reverse=True)
    else:
        rows.sort(key=lambda r: r[1]["score"], reverse=True)  # tight list by surge score
    lit_total = sum(1 for _s, _m, lit in rows if lit)
    out = []
    for sym, m, lit in rows[:limit]:
        out.append({
            "sym": sym,
            "price": round(m["price"], 2),
            "pct": m["pct"],
            "rvol": m["rvol"],
            "move": m["move"],
            "dir": "up" if m["move"] >= 0 else "down",
            "dvol": m.get("dvol", 0),   # $ traded in the now-window (tooltip)
            "score": m["score"],
            "tier": _tier(m["rvol"]),
            "lit": lit,                 # meets the surge criteria → gets colour
        })
    return {
        "window": window,             # rth | pre | post | closed
        "date": session_date,
        "asof": asof,
        "ticks": ticks,
        "active": window != "closed" and _running and (enabled() or _demo()),
        "total": lit_total,           # names MEETING the criteria (header count)
        "shown": len(out),            # rows returned (whole top-N when show_all)
        "universe_top": _top_n(),     # scanning the N most-liquid names
        "filters": {"min_price": mnp, "max_price": mxp, "min_liq": mnl,
                    "min_rvol": mnr, "min_move": mnm, "min_dollar": mnd},
        "rows": out,
    }


def _tier(rvol: float) -> int:
    """Colour tier by relative volume: 4 = hottest."""
    if rvol >= 10:
        return 4
    if rvol >= 6:
        return 3
    if rvol >= 4:
        return 2
    return 1


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
        }


# ── State persistence (survive deploys mid-session) ───────────────────────────
# A deploy restarts this daemon → every baseline would need ~10 min to rebuild
# (the scanner would go blind right after a mid-session deploy). We snapshot a
# COMPACT per-symbol summary (just the trailing baseline rate) every ~30s and, on
# boot in the SAME session, seed each name's baseline so it's rate-able within the
# ~60s it takes the now-window to fill, instead of the full 10 min.
def _state_path() -> str:
    p = os.environ.get("VOLUME_STATE_PATH")
    if p:
        return p
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "volume_state.json")


def _persist_state() -> None:
    try:
        with _lock:
            seeds = {}
            for app, st in _state["syms"].items():
                m = st.get("m")
                if m and m.get("base_rate"):
                    seeds[app] = round(float(m["base_rate"]), 4)
            snap = {"session_key": _state["session_key"], "date": _state["date"],
                    "window": _state["window"], "seeds": seeds}
        path = _state_path()
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(snap, f)
        os.replace(tmp, path)
    except Exception:
        _log.exception("[volume] state persist failed")


def _load_state() -> None:
    """Seed baselines on boot if the snapshot is from the CURRENT live session."""
    try:
        with open(_state_path()) as f:
            snap = json.load(f)
    except (FileNotFoundError, ValueError, OSError):
        return
    except Exception:
        _log.exception("[volume] state load failed")
        return
    now = _now_et()
    cur_key = f"{now.strftime('%Y-%m-%d')}:{_active_window(now)}"
    if not isinstance(snap, dict) or snap.get("session_key") != cur_key:
        return
    seeds = snap.get("seeds")
    if not isinstance(seeds, dict) or not seeds:
        return
    with _lock:
        _reset(cur_key, snap.get("window"), snap.get("date"), seeds=seeds)
    _log.info("[volume] restored %d baselines for session %s", len(seeds), cur_key)


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
    global _last_persist
    if window != "closed" and (_time.time() - _last_persist) >= _PERSIST_SECS:
        _persist_state()
        _last_persist = _time.time()


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
    _load_state()
    _running = True
    _thread = threading.Thread(target=_run_forever, daemon=True, name="volume-scanner")
    _thread.start()
    _log.info("[volume] accumulator started (tick=%.1fs)", _tick_seconds())


def stop() -> None:
    global _running
    _running = False
