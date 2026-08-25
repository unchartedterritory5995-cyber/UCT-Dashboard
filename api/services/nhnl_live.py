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
_SERIES_MAX = 2880       # H/L Pulse points — rolling ~4h at 5s (fine enough to glide,
                         # small enough to poll cheaply)
_DEFAULT_TICK_SECONDS = 3.0
_EPS = 1e-6              # float-noise guard for the high-water-mark compare
_THEME_EPS = 1e-6       # theme-index level move needed to count a new high/low

# ── Session state (guarded by _lock) ──────────────────────────────────────────
_lock = threading.Lock()
_state = {
    "session_key": None,         # f"{date}:{window}" — counters reset when this rolls
    "window": "closed",          # rth | pre | post | closed
    "date": None,                # ET date string
    "syms": {},                  # app_sym -> {hod, lod, nh, nl, last}
    "themes": {},                # theme_name -> {val, hi, lo, nh, nl, hi_ts, lo_ts}
    "series": deque(maxlen=_SERIES_MAX),  # {t, hi, lo} new-H/L events per ~15s sample
    "events": deque(maxlen=_RING_MAX),  # {sym, price, count, ts, dir}; oldest-left
    "asof": None,
    "ticks": 0,
    "last_error": None,
}

_running = False
_thread = None
_last_persist = 0.0       # epoch of the last state snapshot write
_PERSIST_SECS = 30.0      # snapshot cadence (best-effort; off the request path)

# ── Intraday time series (the "H/L Pulse" chart) ──────────────────────────────
# Every ~15s we append how many names are ACTIVELY making new highs / lows right now:
# the count of names whose last new high (lo) is within the trailing window. This is a
# smooth, continuous "names currently hitting new highs" line (like Trade Ideas), not
# a per-15s delta. That matters because ~3,400 names are polled from a snapshot whose
# day.h/day.l updates ~once a minute, so a "new since last 15s" metric would sawtooth
# (one batch spike per minute + three empty samples); a trailing WINDOW always spans a
# full minute-batch, so it stays continuous. Bump _SERIES_METRIC to drop old-shaped
# stored series.
_SAMPLE_SECS = 5.0                   # append a point every ~5s so the line moves in small,
                                     # frequent steps the client can glide between
_DEFAULT_SERIES_WINDOW_SECS = 90.0   # "active" = made a new high/low within this window
_SERIES_METRIC = "window_v2"
_last_sample = 0.0


def _series_window_secs() -> float:
    try:
        return max(_SAMPLE_SECS, float(os.environ.get("NHNL_SERIES_WINDOW_SECS", _DEFAULT_SERIES_WINDOW_SECS)))
    except (TypeError, ValueError):
        return _DEFAULT_SERIES_WINDOW_SECS

# Universe (provider-ticker -> app-ticker), built once.
_prov_to_app: dict | None = None

# ── Print-exact counting (bounded live trade tape) ────────────────────────────
# The poll above counts "intervals in which a new HOD occurred" — a name ratcheting
# its high many times inside one 3s tick shows +1. When NHNL_PRINT_EXACT=1 we ALSO
# tap the already-open bars WebSocket's T. (per-trade) stream for a BOUNDED active
# set (the names actually making new highs/lows) and count EVERY qualifying print,
# so a relentless name shows its true ratchet count (matching Trade Ideas). It rides
# the existing stocks connection (no 2nd Massive key), runs on the bars-WS thread
# (never the request path), and is capped at _print_max() names to keep the shared
# web event loop light. Prints are gated by the same SIP high/low eligibility the
# charts use (trade_conditions) so odd-lot / out-of-sequence ghosts don't count.
_print_lock = threading.Lock()
_print_counts: dict = {}      # prov_sym -> {app, hod, lod, nh, nl, last, hi_ms, lo_ms}
_print_syms: set = set()      # prov syms currently subscribed for print-counting
_print_listener_on = False
_print_events_total = 0
_tc = None                    # cached trade_conditions module (lazy import)


def _print_exact() -> bool:
    return os.environ.get("NHNL_PRINT_EXACT", "0") == "1"


def _print_max() -> int:
    try:
        return max(1, int(os.environ.get("NHNL_PRINT_MAX_SYMS", "300")))
    except (TypeError, ValueError):
        return 300


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
            syms[sym] = {"hod": price, "lod": price, "nh": 0, "nl": cnt, "last": price, "hi_ts": None, "lo_ts": ts}
        for sym, price, cnt in reversed(_DEMO_HIGHS):
            events.append({"sym": sym, "price": price, "count": cnt, "ts": ts, "dir": "high"})
            syms[sym] = {"hod": price, "lod": price, "nh": cnt, "nl": 0, "last": price, "hi_ts": ts, "lo_ts": None}
        # Pad with extra distinct names (no events) so the panel headers show a
        # realistic universe-wide count, not just the ~2 dozen names in the list.
        for i in range(120):
            syms[f"HDMY{i}"] = {"hod": 10, "lod": 9, "nh": 1, "nl": 0, "last": 10, "hi_ts": ts, "lo_ts": None}
        for i in range(76):
            syms[f"LDMY{i}"] = {"hod": 10, "lod": 9, "nh": 0, "nl": 1, "last": 9, "hi_ts": None, "lo_ts": ts}
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
    # Always track the SPDR sector ETFs (for the Sector scope overview), even if
    # cap_universe.json doesn't list them.
    for tk in _SECTOR_ETF_TICKERS:
        try:
            prov = massive.to_polygon_symbol(tk)
        except Exception:
            prov = tk
        mapping.setdefault(prov, tk)
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


def _etf_set() -> set:
    """ETF / ETN / fund tickers (app-form) to EXCLUDE so the feed is stocks-only —
    reuse the scans' shared set (Polygon reference types ETF/ETN/ETV/ETS/FUND,
    cached ~24h). Fail-open to empty so a reference hiccup never drops real stocks."""
    try:
        from api.services import scan_volume
        return scan_volume._etf_symbols() or set()
    except Exception:
        return set()


# ── Sector / industry / theme grouping (for the scope selector) ───────────────
_GROUP_CACHE: dict = {"map": None, "built_at": 0.0}
_GROUP_TTL = 3600   # rebuild the universe grouping hourly (memberships move slowly)
_GROUP_LOCK = threading.Lock()   # one rebuild at a time (no 200-poller thundering herd)
GROUP_DIMS = ("sector", "industry", "theme")

# The Sector scope shows the SPDR sector ETFs themselves making new highs/lows.
# Keys are the Finviz/industry_map sector names (so the overview label == the
# drill-down category name); values are the tradable SPDR ETF (a real ticker, so
# the accumulator tracks its day.h/day.l like any stock).
_SECTOR_ETF: dict = {
    "Technology": "XLK", "Healthcare": "XLV", "Financial": "XLF",
    "Industrials": "XLI", "Consumer Cyclical": "XLY", "Communication Services": "XLC",
    "Basic Materials": "XLB", "Real Estate": "XLRE", "Consumer Defensive": "XLP",
    "Energy": "XLE", "Utilities": "XLU",
}
_SECTOR_ETF_TICKERS: set = set(_SECTOR_ETF.values())

# Theme scope: each UCT theme has a synthetic INDEX (an equal-weight composite of
# its holdings). No intraday value exists in the app (the $IDX: composite is
# daily-only), so we compute each theme's live intraday level ourselves — the
# equal-weight mean of its holdings' % change vs prev close — and track ITS own
# running high/low to count new theme-index highs/lows. Holdings come from the
# taxonomy (owner+engine merged), cached hourly.
_THEME_HOLD_CACHE: dict = {"map": None, "built_at": 0.0}
_THEME_HOLD_TTL = 3600


def _theme_holdings() -> dict:
    """{theme_name: [provider-form holding tickers]} for every theme, cached ~1h."""
    now = _time.time()
    c = _THEME_HOLD_CACHE
    if c["map"] is not None and (now - c["built_at"]) < _THEME_HOLD_TTL:
        return c["map"]
    m: dict = {}
    try:
        from api.services import theme_db, massive
        from api.services import groups as _groups
        data = theme_db.get_all_themes() or {}
        for th in (data.get("themes") or []):
            name = th.get("name")
            if not name:
                continue
            provs = []
            for h in (th.get("holdings") or []):
                try:
                    app = _groups.normalize_sym(h.get("sym"))
                    provs.append(massive.to_polygon_symbol(app))
                except Exception:
                    continue
            if provs:
                m[name] = provs
    except Exception:
        _log.exception("[nhnl] theme holdings build failed")
    c["map"] = m
    c["built_at"] = now
    return m


def _theme_app_members() -> dict:
    """{theme_name: set(app_syms)} — FULL membership (a stock is in many themes).

    Theme breadth + theme drill count/filter by full membership, so both use this
    rather than gmap's single "primary theme". Derived from the cached provider-form
    holdings mapped back to app form; recompute is cheap (~112 themes × ~50 holds)."""
    prov_map = _universe_map()             # {prov: app}
    out: dict = {}
    for name, provs in _theme_holdings().items():
        members = {prov_map.get(p) for p in provs}
        members.discard(None)
        if members:
            out[name] = members
    return out


def _group_map() -> dict:
    """{app_sym: {"sector", "industry", "theme"}} for the whole universe, cached ~1h.

    Sector + industry come from the shared whole-market `industry_map` (Finviz Elite
    SQLite, one bulk read). Theme is the symbol's smallest OWNER theme from the
    taxonomy (mirrors groups.resolve_primary_theme's "smallest theme wins", owner-
    only — the CLAUDE.md aggregates-are-owner-only invariant). Everything is a filter
    over the already-running accumulator, so no extra scanning happens."""
    now = _time.time()
    c = _GROUP_CACHE
    if c["map"] is not None and (now - c["built_at"]) < _GROUP_TTL:
        return c["map"]
    with _GROUP_LOCK:
        # Double-check: another caller may have just rebuilt while we waited.
        now = _time.time()
        if c["map"] is not None and (now - c["built_at"]) < _GROUP_TTL:
            return c["map"]
        return _build_group_map(now)


def _build_group_map(now: float) -> dict:
    c = _GROUP_CACHE
    m: dict = {}
    # Sector + industry — one bulk SQLite hit over the tracked universe.
    try:
        from api.services import industry_map
        si = industry_map.get_groups(list(_universe_map().values())) or {}
        for sym, d in si.items():
            m[sym] = {"sector": d.get("sector") or None,
                      "industry": d.get("industry") or None, "theme": None}
    except Exception:
        _log.exception("[nhnl] industry_map lookup failed")
    # Primary theme — smallest owner theme per symbol, built from one taxonomy read.
    try:
        from api.services import theme_db
        from api.services import groups as _groups
        data = theme_db.get_all_themes() or {}
        best: dict = {}   # sym -> (owner_theme_size, theme_name)
        for th in (data.get("themes") or []):
            name = th.get("name")
            holds = [h for h in (th.get("holdings") or []) if h.get("source") != "engine"]
            size = len(holds)
            if not name or size == 0:
                continue
            for h in holds:
                try:
                    sym = _groups.normalize_sym(h.get("sym"))   # dot -> hyphen, upper
                except Exception:
                    sym = str(h.get("sym") or "").upper()
                if not sym:
                    continue
                cur = best.get(sym)
                if cur is None or size < cur[0]:
                    best[sym] = (size, name)
        for sym, (_sz, name) in best.items():
            if sym in m:
                m[sym]["theme"] = name
            else:
                m[sym] = {"sector": None, "industry": None, "theme": name}
    except Exception:
        _log.exception("[nhnl] theme map build failed")
    c["map"] = m
    c["built_at"] = now
    return m


def _reset(session_key: str, window: str, date: str) -> None:
    """Start a fresh session's accumulation. Caller holds _lock."""
    _state["session_key"] = session_key
    _state["window"] = window
    _state["date"] = date
    _state["syms"] = {}
    _state["themes"] = {}
    _state["series"] = deque(maxlen=_SERIES_MAX)
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
    etf = _etf_set()          # stocks-only — computed outside the lock (cached ~24h)
    px_on = _print_exact()    # print-exact owns counting for its subscribed set
    with _lock:
        if _state["session_key"] != session_key:
            _reset(session_key, window, today)
        syms = _state["syms"]
        events = _state["events"]

        for prov, app in prov_map.items():
            # ETFs/ETNs/funds excluded from the stock universe — EXCEPT the SPDR
            # sector ETFs, which the Sector-scope overview shows directly.
            if app in etf and app not in _SECTOR_ETF_TICKERS:
                continue
            # Print-exact owns this name's HOD/LOD counting via the live trade tape;
            # the merge in _manage_print_set is authoritative, so the poll must not
            # also increment it (double-count). Its st was seeded before it joined.
            if px_on and prov in _print_syms:
                continue
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
                syms[app] = {"hod": ref_hi, "lod": lo0, "nh": 0, "nl": 0,
                             "last": price, "prev": row.get("prev_close"),
                             "hi_ts": None, "lo_ts": None}
                continue

            # New high (of day in RTH; of the ext session in pre/post)?
            if ref_hi > st["hod"] * (1 + _EPS):
                if _is_tradable(app, row):
                    st["nh"] += 1
                    st["hi_ts"] = now_iso
                    events.append({"sym": app, "price": round(float(price or ref_hi), 2),
                                   "count": st["nh"], "ts": now_iso, "dir": "high"})
                st["hod"] = ref_hi   # advance the mark even if untradable
            # New low?
            if isinstance(ref_lo, (int, float)) and ref_lo > 0 and ref_lo < st["lod"] * (1 - _EPS):
                if _is_tradable(app, row):
                    st["nl"] += 1
                    st["lo_ts"] = now_iso
                    events.append({"sym": app, "price": round(float(price or ref_lo), 2),
                                   "count": st["nl"], "ts": now_iso, "dir": "low"})
                st["lod"] = ref_lo
            st["last"] = price

        _state["asof"] = now_iso
        _state["ticks"] += 1


def get_live(limit: int = 100, min_price: float = 0.0, min_count: int = 1,
             group: str = None, value: str = None, session: str = "auto") -> dict:
    """Ranked New-Highs / New-Lows leaderboards for the endpoint.

    ONE row per symbol (deduped), ranked by running count DESCENDING then recency.

    - `limit`     max rows per side.
    - `min_price` hide names below this price.
    - `min_count` hide names whose count is below this.
    - `group`     'sector' | 'industry' | 'theme' — the scope dimension (or None for
                  the whole US-stock universe).
    - `value`     when `group` is set, restrict to this ONE category (e.g. group=
                  'sector', value='Technology'). When None, the full universe is
                  ranked and `categories` lists every category for the dropdown.

    Scope is a pure filter over the already-running accumulator — every sector /
    industry / theme is always being scanned; this just changes what you look at.
    """
    window = "rth" if _demo() else _active_window(_now_et())
    with _lock:
        asof = _state["asof"]
        session_date = _state["date"]
        ticks = _state["ticks"]
        # (sym, nh, nl, last, hi_ts, lo_ts) for every active symbol (stocks + the
        # tracked sector ETFs).
        sym_rows = [(s, st.get("nh", 0), st.get("nl", 0), st.get("last"),
                     st.get("hi_ts"), st.get("lo_ts"), st.get("prev"))
                    for s, st in _state["syms"].items()
                    if st.get("nh", 0) > 0 or st.get("nl", 0) > 0]

    try:
        limit = max(1, min(int(limit), _RING_MAX))
    except (TypeError, ValueError):
        limit = 100

    dim = group if group in GROUP_DIMS else None
    gmap = _group_map() if dim else {}
    etf = _etf_set()
    # Full theme membership {theme: set(app_syms)} — a stock is in MANY themes, so
    # theme breadth + theme drill use this, not the single "primary theme" in gmap.
    theme_members = _theme_app_members() if dim == "theme" else {}
    _r2 = lambda v: round(float(v), 2) if isinstance(v, (int, float)) else None
    _srt = lambda full: sorted(full, key=lambda r: (r["count"], r["ts"] or ""), reverse=True)

    def _in_cat(sym, cat):
        # Which stocks belong to category `cat` of the active dim. Sector/industry
        # are single-membership (gmap); theme is multi-membership (theme_members).
        if dim == "theme":
            return sym in theme_members.get(cat, ())
        return ((gmap.get(sym) or {}).get(dim) or "—") == cat

    def _pct(last, prev):
        if isinstance(last, (int, float)) and isinstance(prev, (int, float)) and prev > 0:
            return round((last - prev) / prev * 100, 2)   # % change vs prior close
        return None

    def rank_stocks(direction, cat=None):
        hi = direction == "high"
        full = []
        for sym, nh, nl, last, hts, lts, prev in sym_rows:
            cnt = nh if hi else nl
            if cnt < min_count or sym in etf:              # stocks only
                continue
            if isinstance(last, (int, float)) and last < min_price:
                continue
            if cat is not None and not _in_cat(sym, cat):  # drill to one category
                continue
            full.append({"sym": sym, "price": _r2(last), "pct": _pct(last, prev),
                         "count": cnt, "ts": hts if hi else lts, "dir": direction, "pick": sym})
        return _srt(full)

    def rank_breadth(direction):
        """Group OVERVIEW: rank each sector/industry/theme by how many of its member
        STOCKS are making new highs (or lows) — breadth, always-active and covering
        every group (an ETF's own HOD ratchets are too sparse to populate a panel)."""
        hi = direction == "high"
        agg: dict = {}   # group name -> [distinct-stock count, latest_ts]
        def _bump(name, ts):
            a = agg.get(name)
            if a is None:
                agg[name] = [1, ts or ""]
            else:
                a[0] += 1
                if (ts or "") > a[1]:
                    a[1] = ts or ""
        for sym, nh, nl, last, hts, lts, _prev in sym_rows:
            cnt = nh if hi else nl
            if cnt < min_count or sym in etf:
                continue
            ts = hts if hi else lts
            if dim == "theme":
                for name, members in theme_members.items():
                    if sym in members:
                        _bump(name, ts)
            else:
                _bump((gmap.get(sym) or {}).get(dim) or "—", ts)
        # Sector rows carry their SPDR ETF as the chartable proxy; a click drills
        # into the group's stocks, so `pick` is only a fallback.
        full = [{"sym": name, "price": None, "count": n, "ts": (t or None),
                 "dir": direction, "group": True,
                 "pick": _SECTOR_ETF.get(name) if dim == "sector" else None}
                for name, (n, t) in agg.items()]
        return _srt(full)

    # Category counts for the drill-down dropdown (distinct stocks per group).
    categories = {}
    if dim:
        for sym, nh, nl, last, _h, _l, _p in sym_rows:
            if sym in etf or (nh < min_count and nl < min_count):
                continue
            if dim == "theme":
                for name, members in theme_members.items():
                    if sym in members:
                        categories[name] = categories.get(name, 0) + 1
            else:
                c = (gmap.get(sym) or {}).get(dim) or "—"
                categories[c] = categories.get(c, 0) + 1

    if dim is None:
        hi_full, lo_full = rank_stocks("high"), rank_stocks("low")
    elif value:
        hi_full, lo_full = rank_stocks("high", value), rank_stocks("low", value)
    else:  # sector / industry / theme OVERVIEW → breadth of member stocks
        hi_full, lo_full = rank_breadth("high"), rank_breadth("low")

    highs, lows = hi_full[:limit], lo_full[:limit]
    highs_total, lows_total = len(hi_full), len(lo_full)

    return {
        "window": window,             # rth | pre | post | closed
        "date": session_date,
        "asof": asof,
        "ticks": ticks,
        "active": window != "closed" and _running and (enabled() or _demo()),
        "highs_total": highs_total,   # count of rows in the CURRENT view (stocks / sectors / industries / themes)
        "lows_total": lows_total,
        "group": dim,                 # echo the active scope dim (or null)
        "value": value if dim else None,
        "categories": categories,     # {category: distinct-name count} for the dropdown
        "highs": highs,
        "lows": lows,
    }


def _sample_series(now: datetime) -> None:
    """Append one H/L Pulse point: how many names are ACTIVELY making new highs / lows
    — i.e. their last new high (low) landed within the trailing window. A rolling count
    off hi_ts/lo_ts, so it stays continuous between the snapshot's minute-batched
    updates instead of collapsing to zero."""
    cutoff = now.timestamp() - _series_window_secs()
    with _lock:
        hi_n = 0
        lo_n = 0
        for s in _state["syms"].values():
            ht = s.get("hi_ts")
            lt = s.get("lo_ts")
            if ht:
                try:
                    if datetime.fromisoformat(ht).timestamp() >= cutoff:
                        hi_n += 1
                except (ValueError, TypeError):
                    pass
            if lt:
                try:
                    if datetime.fromisoformat(lt).timestamp() >= cutoff:
                        lo_n += 1
                except (ValueError, TypeError):
                    pass
        _state["series"].append({"t": now.isoformat(), "hi": hi_n, "lo": lo_n})


def get_series() -> dict:
    """The H/L Pulse payload: the two-line time series + session distinct-name totals
    (for the bull/bear ratio bar). Read-only; safe on the request path."""
    window = "rth" if _demo() else _active_window(_now_et())
    with _lock:
        series = list(_state["series"])
        hi_names = sum(1 for s in _state["syms"].values() if s.get("nh", 0) > 0)
        lo_names = sum(1 for s in _state["syms"].values() if s.get("nl", 0) > 0)
        asof = _state["asof"]
        session_date = _state["date"]
    return {
        "window": window,
        "asof": asof,
        "date": session_date,
        "active": window != "closed" and _running and (enabled() or _demo()),
        "sample_secs": _SAMPLE_SECS,
        "series": series,            # [{t, hi, lo}] oldest-first
        "highs_total": hi_names,     # distinct names at a new high / low today
        "lows_total": lo_names,
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
            "print_exact": _print_exact(),      # bounded live-trade-tape counting
            "print_syms": len(_print_syms),     # names currently print-counted
            "print_events": _print_events_total,  # total qualifying prints counted
        }


# ── State persistence (survive deploys mid-session) ───────────────────────────
# A web deploy restarts this daemon → counts would reset to 0 mid-session (a name
# that made 40 new highs shows 5 after a 10am deploy). We snapshot the per-symbol
# state to disk every ~30s and restore it on boot IFF it's the SAME live session
# (date + window) — a new day/window resets counters anyway, so a stale file is
# simply ignored. Best-effort throughout: persistence never breaks the accumulator.
def _state_path() -> str:
    p = os.environ.get("NHNL_STATE_PATH")
    if p:
        return p
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "nhnl_state.json")


def _persist_state() -> None:
    try:
        with _lock:
            snap = {
                "session_key": _state["session_key"],
                "date": _state["date"],
                "window": _state["window"],
                "ticks": _state["ticks"],
                "syms": _state["syms"],   # the counts — only the nhnl thread writes these
                "series": list(_state["series"]),
                "series_metric": _SERIES_METRIC,
            }
        # Safe to serialize outside the lock: _state["syms"] is mutated ONLY by this
        # (the nhnl) thread; request threads and the trade tape never touch it.
        path = _state_path()
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(snap, f)
        os.replace(tmp, path)
    except Exception:
        _log.exception("[nhnl] state persist failed")


def _load_state() -> None:
    """Restore counts on boot if the snapshot is from the CURRENT live session."""
    try:
        with open(_state_path()) as f:
            snap = json.load(f)
    except (FileNotFoundError, ValueError, OSError):
        return
    except Exception:
        _log.exception("[nhnl] state load failed")
        return
    now = _now_et()
    cur_key = f"{now.strftime('%Y-%m-%d')}:{_active_window(now)}"
    if not isinstance(snap, dict) or snap.get("session_key") != cur_key:
        return   # stale (different day/window) → fresh start; counters reset anyway
    syms = snap.get("syms")
    if not isinstance(syms, dict):
        return
    with _lock:
        _state["session_key"] = snap.get("session_key")
        _state["date"] = snap.get("date")
        _state["window"] = snap.get("window")
        _state["ticks"] = snap.get("ticks", 0)
        _state["syms"] = syms
        # Only restore the stored series if it was built with the CURRENT metric shape.
        ser = snap.get("series")
        if isinstance(ser, list) and snap.get("series_metric") == _SERIES_METRIC:
            _state["series"] = deque(ser, maxlen=_SERIES_MAX)
    _log.info("[nhnl] restored %d symbols for session %s", len(syms), cur_key)


# ── Print-exact machinery ─────────────────────────────────────────────────────
def _ms_to_iso(ms) -> str | None:
    try:
        return (datetime.fromtimestamp(ms / 1000.0, _ET) if _ET
                else datetime.utcfromtimestamp(ms / 1000.0)).isoformat()
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _classify_hl(conditions) -> bool:
    """True if a print may set a new high/low (same SIP filter the charts use).
    Missing/unknown conditions or a disabled filter => eligible."""
    global _tc
    if _tc is None:
        try:
            from api.services import trade_conditions as tc
            _tc = tc
        except Exception:
            _tc = False
    if not _tc:
        return True
    try:
        return _tc.classify(conditions)[0]
    except Exception:
        return True


def _on_trade_print(sym: str, trade: dict) -> None:
    """Runs on the bars-WS thread for every T. print of a print-counted symbol.
    MINIMAL by design — dict lookup + condition gate + compare under a DEDICATED
    lock (never the main _lock, so get_live / the poll never contend with the tape)."""
    global _print_events_total
    if sym not in _print_counts:            # cheap pre-check before the price parse
        return
    p = trade.get("p")
    if not isinstance(p, (int, float)) or p <= 0:
        return
    if not _classify_hl(trade.get("c")):    # odd-lot / out-of-sequence ghosts don't count
        return
    ms = trade.get("t")
    with _print_lock:
        st = _print_counts.get(sym)
        if st is None:
            return
        if p > st["hod"] * (1 + _EPS):
            st["nh"] += 1; st["hod"] = p; st["hi_ms"] = ms
        elif p < st["lod"] * (1 - _EPS):
            st["nl"] += 1; st["lod"] = p; st["lo_ms"] = ms
        st["last"] = p
        _print_events_total += 1


def _ensure_print_listener() -> None:
    global _print_listener_on
    if _print_listener_on:
        return
    try:
        from api.services import bar_stream
        bar_stream.add_trade_listener(_on_trade_print)
        _print_listener_on = True
        _log.info("[nhnl] print-exact trade listener registered")
    except Exception:
        _log.exception("[nhnl] could not register trade listener")


def _clear_print_state() -> None:
    """Drop all print subscriptions + counts (feature off / session rollover / closed)."""
    global _print_syms
    try:
        from api.services import bar_stream
        with _print_lock:
            drop = set(_print_syms)
            _print_counts.clear()
            _print_syms = set()
        if drop:
            bar_stream.unsubscribe_symbols(drop, owner="nhnl")
    except Exception:
        _log.exception("[nhnl] clear print state failed")


def _manage_print_set() -> None:
    """Each tick: fold live print counts into the served state, then re-pick the
    BOUNDED active set (names already ratcheting, busiest first) and adjust the T.
    subscriptions. Runs after _tick_once, off the _lock hot path for the tape."""
    global _print_syms
    if not _print_exact():
        if _print_listener_on or _print_syms:
            _clear_print_state()
        return
    with _lock:
        win = _state["window"]
    if win == "closed":
        if _print_syms:
            _clear_print_state()
        return
    _ensure_print_listener()
    prov_map = _universe_map()                       # {prov: app}
    app_to_prov = {app: prov for prov, app in prov_map.items()}
    add: set = set()
    drop: set = set()
    with _lock:
        syms = _state["syms"]
        # 1) fold the live print counts back into the served per-symbol state.
        with _print_lock:
            for prov, pc in _print_counts.items():
                st = syms.get(pc["app"])
                if st is None:
                    continue
                st["nh"] = pc["nh"]; st["nl"] = pc["nl"]
                st["hod"] = pc["hod"]; st["lod"] = pc["lod"]
                if pc["last"] is not None:
                    st["last"] = pc["last"]
                if pc["hi_ms"]:
                    st["hi_ts"] = _ms_to_iso(pc["hi_ms"]) or st.get("hi_ts")
                if pc["lo_ms"]:
                    st["lo_ts"] = _ms_to_iso(pc["lo_ms"]) or st.get("lo_ts")
        # 2) active set = names already at a new high/low, busiest first, capped.
        ranked = sorted(
            ((max(st.get("nh", 0), st.get("nl", 0)), app)
             for app, st in syms.items()
             if st.get("nh", 0) > 0 or st.get("nl", 0) > 0),
            key=lambda r: r[0], reverse=True,
        )
        want = {app_to_prov[a] for _, a in ranked[:_print_max()] if a in app_to_prov}
        # 3) seed newcomers from their current poll marks; drop the fallen-off.
        with _print_lock:
            add = want - _print_syms
            drop = _print_syms - want
            for prov in list(add):             # copy: we discard from `add` below
                app = prov_map.get(prov)
                st = syms.get(app) if app else None
                if st is None:
                    add.discard(prov)          # nothing to seed → don't subscribe
                    continue
                _print_counts[prov] = {
                    "app": app, "hod": st.get("hod", 0.0), "lod": st.get("lod", 0.0),
                    "nh": st.get("nh", 0), "nl": st.get("nl", 0),
                    "last": st.get("last"), "hi_ms": None, "lo_ms": None,
                }
            for prov in drop:
                _print_counts.pop(prov, None)
            _print_syms = (_print_syms - drop) | add
    # 4) adjust the WS subscriptions OUTSIDE the locks (thread-safe, quick queue ops).
    try:
        from api.services import bar_stream
        if add:
            bar_stream.subscribe_symbols(add, owner="nhnl")
        if drop:
            bar_stream.unsubscribe_symbols(drop, owner="nhnl")
    except Exception:
        _log.exception("[nhnl] print-set subscription update failed")


def _tick() -> None:
    """One scheduled cycle: fetch during any active window (pre/rth/post) and fold."""
    from api.services import massive
    now = _now_et()
    today = now.strftime("%Y-%m-%d")
    window = _active_window(now)
    if window == "closed":
        _tick_once({}, "closed", today, now)  # stamps asof, no fetch
    else:
        snap = massive._get_client().get_full_market_snapshot_hl()
        if not snap:
            with _lock:
                _state["last_error"] = "empty snapshot"
        else:
            _tick_once(snap, window, today, now)
            with _lock:
                _state["last_error"] = None
    try:
        _manage_print_set()
    except Exception:
        _log.exception("[nhnl] print-set management failed")
    global _last_persist, _last_sample
    if window != "closed" and (_time.time() - _last_sample) >= _SAMPLE_SECS:
        try:
            _sample_series(now)
        except Exception:
            _log.exception("[nhnl] series sample failed")
        _last_sample = _time.time()
    if window != "closed" and (_time.time() - _last_persist) >= _PERSIST_SECS:
        _persist_state()
        _last_persist = _time.time()


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
    _load_state()             # restore counts if this boot is mid-session (deploy)
    _running = True
    _thread = threading.Thread(target=_run_forever, daemon=True, name="nhnl-scanner")
    _thread.start()
    _log.info("[nhnl] accumulator started (tick=%.1fs)", _tick_seconds())


def stop() -> None:
    """Signal the loop to exit (used by lifespan shutdown / tests)."""
    global _running
    _running = False
    if _print_listener_on or _print_syms:
        _clear_print_state()
