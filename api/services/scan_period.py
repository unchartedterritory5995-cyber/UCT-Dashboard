"""Custom-period % change scan — every US common stock ranked by its % change over a
user-selected [start, end] date range. Powers the Custom-Period Sort tool.

Whole-market by construction: TWO grouped-daily calls (the start + end date, each snapped
to the nearest trading day) give split-adjusted closes for the entire market, so
% change = (end_close - start_close) / start_close for every ticker in two calls. Filtered
to US common stock (currently trading), sorted gainers-first. Cached per date range.
"""
import json
import os
import threading
import time as _time
from datetime import date, timedelta

from api.services import massive
from api.services.cache import cache
from api.services.scan_volume import _now_et, _snap_lookup, _etf_symbols
from api.services.scan_ipo import _common_stock_symbols

_TTL = 300           # results cache (s) — the range is fixed; only live price/vol drift
_GROUP_STEPS = 9     # snap a target date back over a holiday/weekend up to this many days (covers year-end gaps)

# Ticker-reuse map (recycled-symbol detection) shared across ALL period ranges. Computed
# ONCE with a fixed early floor — its whole-universe window scan was the 3-5-min-per-range
# cost. Reuse boundaries are static historical data, so the map is cached in memory AND on
# disk (survives redeploys) and pre-warmed at startup. Correct for any start date >= floor.
_REUSE_FLOOR = 19900101

_REUSE_FILE = os.path.join(os.environ.get("DATA_DIR", "/data"), "period_reuse_map.json")
_REUSE_FILE_TTL = 7 * 86400
_reuse_lock = threading.Lock()

# ⛔ WHY THE MAP LIVES HERE AND A STALE FILE IS SERVED (2026-11-15). Two defects made one deploy a
# week slow for every member:
#   1. The map sat in the SHARED 1,000-entry LRU (`cache`), and churn evicted it (an hour after a
#      boot, `debug_period` read `warm: false` with the file present) -- the same trap the
#      bars_sanitize meta fell into (moved to its own TTLCache, 2026-11-13).
#   2. A file older than _REUSE_FILE_TTL was IGNORED, so the first boot after it aged out ran the
#      whole-universe window scan in `reuse-map-warm` during the reconnect burst: boot-probe on the
#      17:11 UTC boot showed it at 60-110% of a core from boot+94 s past boot+415 s, process CPU
#      250-400%, and starter screens took 6-80 s; the next boot (fresh file) never showed it.
# Now the map is held in this module (never evicted), a stale file is served at once, and the
# recompute runs off the reader's thread and only outside regular hours (`_reuse_quiet_now`).
_REUSE_MEM: dict = {"map": None, "failed_at": 0.0}
_REUSE_RETRY_S = 3600.0          # after a failed compute, readers get {} for this long, not a retry
_REUSE_REFRESH_POLL_S = 600.0    # a deferred refresh re-checks the clock this often
_reuse_refreshing = threading.Event()


def _reuse_log():
    import logging
    return logging.getLogger(__name__)


def _reuse_quiet_now(now=None) -> bool:
    """True outside the trading day's busy span: weekends, and weekdays before 07:00 or after
    20:15 ET (members reconnect from the pre-market on; the evening jobs end ~20:15)."""
    now = now or _now_et()
    if now.weekday() >= 5:
        return True
    hm = now.hour * 60 + now.minute
    return hm < 7 * 60 or hm >= 20 * 60 + 15


def _read_reuse_file():
    """(map, age_s) from the durable file, or (None, None) when absent or unreadable."""
    try:
        if not os.path.exists(_REUSE_FILE):
            return None, None
        age = _time.time() - os.path.getmtime(_REUSE_FILE)
        with open(_REUSE_FILE) as fh:
            m = json.load(fh)
        if not isinstance(m, dict):
            return None, None
        return m, age
    except Exception as exc:  # noqa: BLE001 -- unreadable = absent
        _reuse_log().warning("[scan_period] reuse map file unreadable, not used: %s", exc)
        return None, None


def _compute_reuse_map() -> dict:
    """The whole-universe window scan, then memory + the durable file. Raises on a failed scan
    (nothing is stored, so a failure never becomes a week-long empty file)."""
    t0 = _time.time()
    from api.services import bars_sqlite
    m = bars_sqlite.current_listing_starts(_REUSE_FLOOR)
    _REUSE_MEM["map"] = m
    try:
        tmp = _REUSE_FILE + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(m, fh)
        os.replace(tmp, _REUSE_FILE)
        saved = "saved"
    except Exception as exc:  # noqa: BLE001
        saved = f"NOT saved ({exc})"
    _reuse_log().info("[scan_period] reuse map computed: %d tickers in %.1f s, %s",
                      len(m), _time.time() - t0, saved)
    return m


def _refresh_reuse_map_when_quiet() -> None:
    """Recompute the map once the clock is in the quiet span. One at a time; never raises."""
    try:
        while not _reuse_quiet_now():
            _time.sleep(_REUSE_REFRESH_POLL_S)
        with _reuse_lock:
            _compute_reuse_map()
    except Exception as exc:  # noqa: BLE001 -- the stale map keeps serving
        _reuse_log().warning("[scan_period] reuse map refresh failed, keeping the stale map: %s", exc)
    finally:
        _reuse_refreshing.clear()


def _spawn_reuse_refresh() -> None:
    """Start the deferred refresh unless one is already waiting (tests replace this)."""
    if _reuse_refreshing.is_set():
        return
    _reuse_refreshing.set()
    try:
        threading.Thread(target=_refresh_reuse_map_when_quiet, daemon=True,
                         name="reuse-map-refresh").start()
    except Exception:  # noqa: BLE001
        _reuse_refreshing.clear()


def _reuse_map() -> dict:
    """{TICKER: current-listing-start YYYYMMDD} for the whole warmed universe, floored at
    _REUSE_FLOOR. Memory → durable /data file (at ANY age; a stale one is served and refreshed
    in the quiet span) → compute, only when there is no file at all. Serialized so a stampede
    of pre-2004 requests computes it a single time."""
    m = _REUSE_MEM["map"]
    if m is not None:
        return m
    with _reuse_lock:
        m = _REUSE_MEM["map"]
        if m is not None:
            return m
        m, age = _read_reuse_file()
        if m is not None:
            _REUSE_MEM["map"] = m
            if age > _REUSE_FILE_TTL:
                _reuse_log().info("[scan_period] reuse map file is %.1f d old: serving it, "
                                  "refreshing in the quiet span", age / 86400)
                _spawn_reuse_refresh()
            return m
        if _time.time() - _REUSE_MEM["failed_at"] < _REUSE_RETRY_S:
            return {}
        try:
            return _compute_reuse_map()
        except Exception as exc:  # noqa: BLE001 -- no reuse filtering beats a failed sort
            _REUSE_MEM["failed_at"] = _time.time()
            _reuse_log().warning("[scan_period] reuse map compute failed: %s", exc)
            return {}


def warm_reuse_map() -> None:
    """Pre-warm the reuse map (startup background) so a pre-2004 sort never pays its
    one-time whole-universe scan on the compute path."""
    try:
        _reuse_map()
    except Exception:
        pass


def _to_date(ymd: int) -> date:
    s = str(int(ymd))
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _grouped_near(target: date):
    """({TICKER: adjusted close}, actual_date) via the whole-market grouped-daily endpoint,
    for the first trading day on/before target. FAST (two REST calls). Empty for a PRE-~2003
    date the provider doesn't cover — the caller then falls back to bars.db (off-thread)."""
    dt = target
    for _ in range(_GROUP_STEPS):
        try:
            m = massive.get_grouped_daily_closes(dt.isoformat(), adjusted=True)
        except Exception:
            m = {}
        if m:
            return m, dt
        dt = dt - timedelta(days=1)
    return {}, target


def _bars_near(target: date, indexed: bool):
    """({TICKER: close}, actual_date) from bars.db's deep (yfinance-sourced) daily history —
    the PRE-~2003 fallback. With the by-date daily index built (`indexed`), ONE contiguous
    windowed range-scan (`closes_near_date`) — fast even on cold storage. If the index isn't
    ready yet, fall back to per-ticker as-of seeks over the CS universe (`closes_asof`), which
    use the base index and avoid a full scan. App/hyphen keys, survivorship-biased coverage."""
    from api.services import bars_sqlite
    try:
        frm = target - timedelta(days=_GROUP_STEPS + 7)
        to_i, from_i = int(target.strftime("%Y%m%d")), int(frm.strftime("%Y%m%d"))
        if indexed:
            m = bars_sqlite.closes_near_date(to_i, from_i)
        else:
            m = bars_sqlite.closes_asof(list(_common_stock_symbols()), to_i, from_i)
    except Exception:
        m = {}
    return m, target


def _assemble(start_closes: dict, end_closes: dict, sd: date, ed: date, partial: bool, start_ymd: int) -> dict:
    """Turn two {ticker: close} maps into the ranked result set: normalize keys, filter to
    currently-trading common stock, (on the partial/bars.db path) drop recycled tickers, and
    compute % change per name."""
    # Normalize both sides to app/hyphen form so grouped (BRK.B) and bars.db (BRK-B) keys join.
    start_closes = {k.replace(".", "-"): v for k, v in start_closes.items()}
    end_closes = {k.replace(".", "-"): v for k, v in end_closes.items()}

    cs = _common_stock_symbols()
    if not cs:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}
    etfs = _etf_symbols()
    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    # Partial (bars.db) path: drop RECYCLED tickers whose CURRENT listing began after the
    # start date — their start close belongs to a different, prior company (SQ, WTW, RMIX…).
    # The reuse boundaries are STATIC historical data, so use the shared, cached, fixed-floor
    # map (computed once, not per range — that whole-universe window scan was the 3-5 min/range
    # cost). Only for start dates at/after the floor; a rare pre-floor sort computes its own.
    reuse = {}
    if partial:
        try:
            if int(start_ymd) >= _REUSE_FLOOR:
                reuse = _reuse_map()
            else:
                from api.services import bars_sqlite
                reuse = bars_sqlite.current_listing_starts(int(start_ymd))
        except Exception:
            reuse = {}

    # Whole-market (grouped) path: cross-check against bars.db to drop tickers whose grouped
    # START close is BOGUS — recently-listed / recycled names (e.g. QH showing +3941%) that
    # didn't actually trade in their current listing at the start date. Signal: bars.db has
    # the name NEAR THE END but NOT at the start (its listing began after the start), or the
    # bars.db %-change wildly contradicts grouped (a stale/mis-adjusted start close). Fast:
    # two windowed range scans via the by-date index — skipped (not blocking) if it isn't built.
    bdb_start, bdb_end = {}, {}
    if not partial:
        try:
            from api.services import bars_sqlite
            if bars_sqlite.daily_bydate_index_ready():
                s_hi = int(sd.strftime("%Y%m%d")); s_lo = int((sd - timedelta(days=15)).strftime("%Y%m%d"))
                e_hi = int(ed.strftime("%Y%m%d")); e_lo = int((ed - timedelta(days=15)).strftime("%Y%m%d"))
                bdb_start = bars_sqlite.closes_near_date(s_hi, s_lo)
                bdb_end = bars_sqlite.closes_near_date(e_hi, e_lo)
        except Exception:
            bdb_start, bdb_end = {}, {}
    _xcheck = bool(bdb_start and bdb_end)   # only filter when both bars.db sides are present

    # Attach each name's industry/sector from the in-memory map so the frontend's Industry
    # column is PRE-LOADED for every row (no per-scroll meta fetch, no "—" flash). 6h-cached.
    try:
        smap = _sector_industry_map()
    except Exception:
        smap = {}

    # TERM-047: the coverage receipt. The universe is every common stock (no ETF,
    # no test symbol); each one lands in exactly one bucket. Iterating the
    # universe instead of `start_closes` yields the SAME result set (the old
    # loop skipped every name outside `cs`), and lets the misses be counted.
    # Order: `start_closes`' own order first, then the universe names it lacks,
    # so a tie in the final sort lands exactly where it did before.
    from api.services.coverage_receipt import Tally
    tally = Tally()
    results = []
    _order = [a for a in start_closes if a in cs] + sorted(a for a in cs if a not in start_closes)
    for app in _order:
        if app in etfs or app.endswith("ZZT"):
            continue
        sc = start_closes.get(app)
        if not sc or sc <= 0:
            tally.cannot(app, "no close on the start date")
            continue
        ec = end_closes.get(app)
        if not ec or ec <= 0:
            tally.cannot(app, "no close on the end date")
            continue
        if partial and reuse.get(app, 0) > int(start_ymd):
            tally.drop(app, "ticker reused by a newer listing since the start date")
            continue
        if _xcheck and app in bdb_end and app not in bdb_start:
            # trades now but not at the start → listing began after start → bogus start close
            tally.drop(app, "listing began after the start date")
            continue
        if _xcheck:
            bs, be = bdb_start.get(app), bdb_end.get(app)
            if bs and be and bs > 0:
                gp = (ec - sc) / sc * 100      # grouped % change
                bp = (be - bs) / bs * 100      # bars.db % change (independent source)
                if abs(gp) > 150 and abs(gp - bp) > 150 and abs(gp) > 3 * abs(bp) + 100:
                    # the two sources wildly disagree → grouped start close is suspect
                    tally.drop(app, "start close disagrees with the bar history")
                    continue
        # Currently-trading filter (whole-market path): require the ticker in the live
        # snapshot to drop delisted names. On the partial path we KEEP names bars.db has.
        s = snap.get(app) or _snap_lookup(snap, app) if snap else None
        if snap and not s and not partial:
            tally.drop(app, "not trading now")
            continue
        tally.answer()
        _si = smap.get(app) or {}
        results.append({
            "sym": app,
            "period_change": round((ec - sc) / sc * 100, 2),
            "net_change": round(ec - sc, 2),
            "start_close": round(sc, 4),
            "end_close": round(ec, 4),
            "price": (s.get("last_price") if s else None),
            "volume": (s.get("today_vol") if s else None),
            "industry": _si.get("industry"),
            "sector": _si.get("sector"),
        })
    results.sort(key=lambda r: r["period_change"], reverse=True)
    return {
        "status": "ok",
        "results": results,
        "count": len(results),
        "start": int(sd.strftime("%Y%m%d")),
        "end": int(ed.strftime("%Y%m%d")),
        "as_of": _now_et().isoformat(),
        "partial": partial,
        # TERM-047: always computed; the route publishes it only when armed.
        "coverage": tally.receipt(),
    }


# In-flight pre-coverage (bars.db) computes — the slow full-scans run once per range on a
# background thread; concurrent requests for the same range just get "computing".
_partial_inflight: set = set()
_partial_lock = threading.Lock()


def _partial_bg(ck: str, start_ymd: int, end_ymd: int):
    try:
        from api.services import bars_sqlite
        # Only USE the by-date index if the startup pre-build already made it — never
        # trigger the build from here. A CREATE INDEX holds a multi-minute SQLite write
        # transaction; kicking it off mid-session would make bar writes contend site-wide.
        # If it's not ready yet, fall back to per-ticker seeks (slower, but no build).
        indexed = bars_sqlite.daily_bydate_index_ready()
        sc, sd = _bars_near(_to_date(start_ymd), indexed)
        ec, ed = _bars_near(_to_date(end_ymd), indexed)
        if not sc or not ec:
            out = {"status": "unavailable", "results": [], "count": 0,
                   "error": "Market-wide data isn't available this far back — it begins around 2003.",
                   "as_of": None}
            _period_remember(ck, out, 3600)
            return
        out = _assemble(sc, ec, sd, ed, True, start_ymd)
        _period_remember(ck, out, _TTL if out.get("results") else 3600)
        if out.get("status") == "ok":
            _kick_period_daily_warm(ck, out.get("results"))
    except Exception:
        _period_remember(ck, {"status": "unavailable", "results": [], "count": 0,
                              "error": "Couldn't load data for this period.", "as_of": None}, 300)
    finally:
        with _partial_lock:
            _partial_inflight.discard(ck)


# ── Server-side deep-daily warm (make the lists bulletproof) ──────────────────
# When a sort produces results, pre-build the DEEP daily history for the top-ranked
# tickers into the SAME serve caches /api/bars reads (via _get_bars_inner), so opening
# any of them is an instant cache hit instead of a cold multi-second provider build —
# the frontend warm races the user, this guarantees the server side is ready.
#
# SAFE + CHEAP by construction: bounded (the shared max-4 _bars_warm_pool), DAILY only,
# capped (_PERIOD_WARM_CAP), deduped per range (fires once, not per poll), and
# _get_bars_inner short-circuits already-cached tickers — so a re-sort costs ~0 and only
# genuinely-cold names ever touch the provider (then disk-cached ~48h). Flag-killable.
_PERIOD_WARM_ENABLED = os.environ.get("PERIOD_WARM_ENABLED", "1") == "1"
_PERIOD_WARM_CAP = int(os.environ.get("PERIOD_WARM_CAP", "600"))
_DEEP_DAILY_BARS = 12500          # matches the frontend fullBarsFor('D') deep request
_period_warm_seen: set = set()
_period_warm_lock = threading.Lock()


def _kick_period_daily_warm(ck: str, results) -> None:
    if not _PERIOD_WARM_ENABLED or not results:
        return
    with _period_warm_lock:
        if ck in _period_warm_seen:
            return
        _period_warm_seen.add(ck)
        if len(_period_warm_seen) > 500:      # bound the dedup set (many distinct ranges)
            _period_warm_seen.clear()
            _period_warm_seen.add(ck)
    syms = [r.get("sym") for r in results[:_PERIOD_WARM_CAP] if r.get("sym")]
    # The sort's START — the deep warm need only cover history back to here (a name already
    # holding a bar at/before it is skipped). Parsed from ck = "scan_period_{start}_{end}".
    try:
        start_ymd = int(ck.split("_")[2])
    except Exception:
        start_ymd = None

    def _run():
        try:
            from api.services.bars_fetch import warm_ticker_daily_deep, _bars_warm_pool
            for s in syms:
                try:
                    # Deep FETCH + persist the FULL daily history (not just _get_bars_inner,
                    # which can return recent-only for an old-era name) so a 2008-replay chart
                    # is already in SQLite ≤ cutoff. Skips tickers already deep enough.
                    _bars_warm_pool.submit(warm_ticker_daily_deep, s, start_ymd)
                except RuntimeError:          # pool shutting down
                    break
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True, name="period-daily-warm").start()


# ── One build per range, off the request ─────────────────────────────────────
# Measured on production 2026-11-17, mid-session: a range nobody had asked for yet did not
# answer within 40 seconds (two whole-market grouped-daily reads, each stepping back over
# the unfinished session, plus the full-market snapshot), and three concurrent requests for
# it ran three builds. Both readers (the Custom-Period Sort tool and the Terminal's PCHG
# panel) already re-ask on "computing", and the panel gives up at 30 seconds. So the build
# runs ONCE per range on a background thread; a request waits a few seconds for it (a warm
# provider answers inside that) and otherwise says "computing".
_PERIOD_WAIT_S = float(os.environ.get("PERIOD_CHANGE_WAIT_S", "6"))
_period_inflight: dict = {}          # range key -> the Event its running build sets when done
_period_inflight_lock = threading.Lock()

# ── The finished answer is held HERE, not only in the shared cache ───────────
# Measured on production 2026-11-17, ten minutes after a restart: a fresh range answered
# "computing" for seven minutes and the range's key was never in the shared cache. That cache
# is one 1,000-entry LRU for the whole app (api/services/cache.py), and bars reads write to it
# constantly, so an answer set there can be pushed out before the next poll reads it. When the
# build ran on the request that did not matter (the request returned what it had just built).
# Now that the build runs on its own thread, the hand-off must not depend on a cache another
# workload can empty: the last few answers are kept in this module, each until its own expiry.
_PERIOD_KEEP = 8                     # ranges held; a full list is ~5,000 short rows
_period_done: dict = {}              # range key -> (expires_at, answer)
_period_done_lock = threading.Lock()
# What the last build of each range did, for debug_period: no log line says this otherwise.
_period_last: dict = {}              # range key -> {started, finished, seconds, outcome, count}


# ── The last GOOD answer outlives its freshness, so a range is never cold twice ──────────
# Owner request 2026-11-17 ("Instant period rankings"): a range's answer is fresh for _TTL
# (five minutes), and until this change the request after that waited for a whole new build
# or read "computing". A ranked list for a fixed range changes only in its live price and
# volume columns, so the last good answer is kept a while longer and served AT ONCE, marked
# `refreshing`, while ONE background build replaces it for the next read. Only an "ok" answer
# with rows is kept; an error or an empty answer never is. `as_of` still says when the rows
# were built.
_PERIOD_STALE_S = float(os.environ.get("PERIOD_STALE_S", "900"))   # 0 = never serve a past answer
_PERIOD_OLD_KEEP = 12                # the seven one-click ranges and a few typed ones
_period_old: dict = {}               # range key -> (serve_until, answer)


def _period_remember(ck: str, out: dict, ttl: float) -> None:
    """Keep `out` for `ttl` seconds in this module AND in the shared cache."""
    now = _time.time()
    with _period_done_lock:
        _period_done[ck] = (now + ttl, out)
        for k in [k for k, (exp, _o) in _period_done.items() if exp <= now]:
            _period_done.pop(k, None)
        while len(_period_done) > _PERIOD_KEEP:              # drop the one that expires soonest
            _period_done.pop(min(_period_done, key=lambda k: _period_done[k][0]), None)
        if _PERIOD_STALE_S > 0 and out.get("status") == "ok" and out.get("results"):
            _period_old[ck] = (now + ttl + _PERIOD_STALE_S, out)
            for k in [k for k, (until, _o) in _period_old.items() if until <= now]:
                _period_old.pop(k, None)
            while len(_period_old) > _PERIOD_OLD_KEEP:
                _period_old.pop(min(_period_old, key=lambda k: _period_old[k][0]), None)
    cache.set(ck, out, ttl=ttl)


def _period_old_answer(ck: str):
    """The last good answer for a range while it may still be served past its freshness, as a
    copy marked `refreshing`; else None."""
    with _period_done_lock:
        hit = _period_old.get(ck)
        if hit is None:
            return None
        if hit[0] <= _time.time():
            _period_old.pop(ck, None)
            return None
        return {**hit[1], "refreshing": True}


def _period_answer(ck: str):
    """The held answer for a range, or None: the shared cache first (the bars.db fallback and
    older code write only there), then this module's own copy."""
    cached = cache.get(ck)
    if cached is not None:
        return cached
    with _period_done_lock:
        hit = _period_done.get(ck)
        if hit is None:
            return None
        if hit[0] <= _time.time():
            _period_done.pop(ck, None)
            return None
        return hit[1]


def _period_build_bg(ck: str, start_ymd: int, end_ymd: int, done: threading.Event) -> None:
    started = _time.time()
    note = {"started": started, "finished": None, "seconds": None, "outcome": "running", "count": None}
    _period_last[ck] = note
    while len(_period_last) > 32:
        _period_last.pop(next(iter(_period_last)), None)
    try:
        _build_period_change(ck, start_ymd, end_ymd)
        held = _period_answer(ck)
        note["outcome"] = (held or {}).get("status") or "nothing held (the deep-history fallback took over, or the provider had neither date)"
        note["count"] = (held or {}).get("count")
    except Exception as exc:
        # A failed build must not read as "computing" for ever: say so, briefly, then let a
        # later request try again.
        note["outcome"] = f"failed: {type(exc).__name__}"
        _period_remember(ck, {"status": "error", "results": [], "count": 0,
                              "error": "Couldn't load data for this period.", "as_of": None}, 15)
    finally:
        note["finished"] = _time.time()
        note["seconds"] = round(note["finished"] - started, 1)
        try:
            import logging
            logging.getLogger(__name__).info("[period-build] %s %s in %.1fs (count=%s)", ck, note["outcome"], note["seconds"], note["count"])
        except Exception:
            pass
        with _period_inflight_lock:
            _period_inflight.pop(ck, None)
        done.set()


def get_period_change(start_ymd: int, end_ymd: int) -> dict:
    """Every US common stock's % change over [start, end], sorted desc (biggest gainers
    first). Whole-market via two grouped-daily calls; PRE-~2003 ranges fall back to bars.db.
    NEVER builds on the request: one background build per range, a short wait for it, then
    "computing" (the caller asks again). Shape: {status, results, count, start, end, as_of,
    partial}."""
    if start_ymd >= end_ymd:
        return {"status": "error", "results": [], "count": 0, "error": "start must be before end"}
    ck = f"scan_period_{start_ymd}_{end_ymd}"
    cached = _period_answer(ck)
    if cached is not None and cached.get("status") == "error":
        # a failed rebuild is held for a few seconds; the last good answer is worth more
        old = _period_old_answer(ck)
        if old is not None:
            return old
    if cached is None:
        old = _period_old_answer(ck)
        with _partial_lock:
            if ck in _partial_inflight:      # the bars.db fallback is already working on it
                return old if old is not None else {"status": "computing", "results": [], "count": 0, "as_of": None}
        with _period_inflight_lock:
            done = _period_inflight.get(ck)
            if done is None:
                done = _period_inflight[ck] = threading.Event()
                threading.Thread(target=_period_build_bg, args=(ck, start_ymd, end_ymd, done),
                                 daemon=True, name="period-build").start()
        if old is not None:
            return old                       # at once; the build replaces it for the next read
        done.wait(_PERIOD_WAIT_S)
        cached = _period_answer(ck)
    if cached is not None:
        if cached.get("status") == "ok":
            _kick_period_daily_warm(ck, cached.get("results"))
        return cached
    return {"status": "computing", "results": [], "count": 0, "as_of": None}


def _build_period_change(ck: str, start_ymd: int, end_ymd: int) -> None:
    """The build behind get_period_change, run on its background thread. Caches the answer
    under `ck`; when the provider holds neither date it starts the bars.db fallback (its own
    background thread) and caches nothing, so the caller keeps reading "computing"."""
    # Fetch BOTH whole-market dates AND prewarm the full-market snapshot CONCURRENTLY — these
    # three ~8,000-ticker calls were sequential (the 30-40s wait). Snapshot lands in its own
    # cache so _assemble reads it instantly; grouped-daily is now cached per date too.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="period-fetch") as _ex:
        _fs = _ex.submit(_grouped_near, _to_date(start_ymd))
        _fe = _ex.submit(_grouped_near, _to_date(end_ymd))
        _ex.submit(lambda: massive._get_client().get_full_market_snapshot())  # prewarm cache
        start_closes, sd = _fs.result()
        end_closes, ed = _fe.result()
    if start_closes and end_closes:
        out = _assemble(start_closes, end_closes, sd, ed, False, start_ymd)
        _period_remember(ck, out, _TTL if out.get("results") else 15)
        return

    # Grouped empty. A recent date may still be warming ("computing"); a date well in the
    # past is a provider-coverage boundary → kick the bars.db fallback onto a background
    # thread and report "computing" until it caches a result (never full-scan synchronously).
    bad = _to_date(start_ymd) if not start_closes else _to_date(end_ymd)
    if (_now_et().date() - bad).days > 30:
        with _partial_lock:
            if ck not in _partial_inflight:
                _partial_inflight.add(ck)
                threading.Thread(target=_partial_bg, args=(ck, start_ymd, end_ymd), daemon=True).start()


# ── The one-click ranges are kept built (owner request 2026-11-17) ───────────────────────
# The Terminal's PCHG panel offers seven one-click ranges (periodChangeModel.js PERIOD_RANGES)
# and asks for each by two dates worked out from today's date in New York, so every member
# asks for the SAME seven ranges on a given day. One background thread on the web service
# builds them, one at a time, after boot and then on a slow loop, so a member's first click
# reads a held answer and not "computing" for half a minute. Past dates' whole-market closes
# are already kept on disk (massive.get_grouped_daily_closes), so after the first pass a
# rebuild is two cached reads and the live snapshot.
# ⛔ preset_ranges MIRRORS rangeDates in app/src/pages/terminal/panels/periodChangeModel.js.
# Both are pinned to ONE table of examples (periodPresets.fixture.json, beside the model),
# read by tests/test_scan_period_presets.py and by periodChangeModel.test.js. A mismatch is
# not a wrong number for a member: the warm would build a range nobody asks for and the
# panel would wait as it did before.
_PRESET_WARM_S = float(os.environ.get("PERIOD_PRESET_WARM_S", "240"))   # 0 = never start the loop
_PRESET_WARM_IDLE_S = 840.0          # nights and weekends: nothing moves, keep answers inside _PERIOD_STALE_S
_PRESET_WARM_DELAY_S = 150.0         # after boot: never compete with startup
_PRESET_BUILD_WAIT_S = 180.0         # the longest the loop waits on a build a member already started
_preset_warm_started = threading.Event()
_preset_warm_last: dict = {}         # for debug_period: when the loop last ran and what each range did


def _months_back(t: date, months: int) -> date:
    import calendar
    y, m = t.year, t.month - months
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, min(t.day, calendar.monthrange(y, m)[1]))


def preset_ranges(today: date) -> dict:
    """{range key: start date} for the panel's seven one-click ranges; every range ends today.
    This month, this quarter and year to date start from the LAST DAY BEFORE the period."""
    first_of = lambda y, m: date(y, m, 1) - timedelta(days=1)
    return {
        "mtd": first_of(today.year, today.month),
        "qtd": first_of(today.year, today.month - ((today.month - 1) % 3)),
        "ytd": first_of(today.year, 1),
        "m1": _months_back(today, 1),
        "m3": _months_back(today, 3),
        "m6": _months_back(today, 6),
        "y1": _months_back(today, 12),
    }


def warm_presets(today: date = None) -> dict:
    """Build today's seven one-click ranges, one at a time, ON THE CALLER'S THREAD. Shares the
    single-flight with get_period_change, so a range a member is already building is waited
    for, never built twice. Never raises. Returns {range key: what happened}."""
    t = today or _now_et().date()
    end = int(t.strftime("%Y%m%d"))
    said = {}
    for key, start in preset_ranges(t).items():
        s = int(start.strftime("%Y%m%d"))
        ck = f"scan_period_{s}_{end}"
        try:
            with _partial_lock:
                if ck in _partial_inflight:
                    said[key] = "the deep-history fallback is working on it"
                    continue
            with _period_inflight_lock:
                done = _period_inflight.get(ck)
                mine = done is None
                if mine:
                    done = _period_inflight[ck] = threading.Event()
            if mine:
                _period_build_bg(ck, s, end, done)
            else:
                done.wait(_PRESET_BUILD_WAIT_S)
            said[key] = (_period_last.get(ck) or {}).get("outcome") or "no record"
        except Exception as exc:                       # one range must not stop the others
            said[key] = f"failed: {type(exc).__name__}"
    _preset_warm_last.clear()
    _preset_warm_last.update({"at": _time.time(), "day": t.isoformat(), "ranges": said})
    return said


def _preset_warm_loop() -> None:
    _time.sleep(_PRESET_WARM_DELAY_S)
    while True:
        try:
            warm_presets()
        except Exception:
            pass
        now = _now_et()
        busy = now.weekday() < 5 and 4 <= now.hour < 20
        _time.sleep(_PRESET_WARM_S if busy else max(_PRESET_WARM_S, _PRESET_WARM_IDLE_S))


def start_preset_warmer(force: bool = False) -> bool:
    """Start the loop once, on the web service only (every other service that imports this
    module would repeat the same provider reads for nobody). True when this call started it."""
    if _PRESET_WARM_S <= 0 or _preset_warm_started.is_set():
        return False
    if not force and os.environ.get("RAILWAY_SERVICE_NAME", "") != "web":
        return False
    _preset_warm_started.set()
    threading.Thread(target=_preset_warm_loop, daemon=True, name="period-presets").start()
    return True


def debug_period(start_ymd: int, end_ymd: int) -> dict:
    """Synchronous ground-truth probe for a stuck pre-2004 sort (admin diagnostic).
    Reports whether grouped-daily covers the dates, whether bars.db actually HOLDS
    daily data near them, the by-date index state, and the current cache/inflight
    state — so we can tell "slow" from "the deep history isn't on this pod." Bounded;
    does NOT full-scan (relies on the by-date index for counts)."""
    import time as _t
    from api.services import bars_sqlite
    ck = f"scan_period_{start_ymd}_{end_ymd}"
    out = {"start": start_ymd, "end": end_ymd, "cache_key": ck}

    t0 = _t.time()
    sc, sd = _grouped_near(_to_date(start_ymd))
    ec, ed = _grouped_near(_to_date(end_ymd))
    out["grouped"] = {
        "start_count": len(sc), "start_snapped": int(sd.strftime("%Y%m%d")),
        "end_count": len(ec), "end_snapped": int(ed.strftime("%Y%m%d")),
        "covers_both": bool(sc and ec), "ms": round((_t.time() - t0) * 1000),
    }
    try:
        out["bars_db"] = bars_sqlite.daily_coverage_probe(start_ymd, end_ymd)
    except Exception as e:
        out["bars_db"] = {"error": str(e)}
    cached = cache.get(ck)
    out["cache"] = {"present": cached is not None,
                    "status": (cached or {}).get("status"),
                    "count": (cached or {}).get("count")}
    with _partial_lock:
        out["inflight"] = ck in _partial_inflight
    # The build itself: is one running, is its answer held outside the shared cache, and what
    # did the last one do and how long did it take.
    with _period_inflight_lock:
        building = ck in _period_inflight
    with _period_done_lock:
        held = _period_done.get(ck)
    last = dict(_period_last.get(ck) or {})
    with _period_done_lock:
        old = _period_old.get(ck)
    out["build"] = {"running": building,
                    "held_here": bool(held and held[0] > _time.time()),
                    "held_status": (held[1] or {}).get("status") if held else None,
                    "past_answer_servable": bool(old and old[0] > _time.time()),
                    "last": last or None}
    out["preset_warm"] = {"started": _preset_warm_started.is_set(), "every_s": _PRESET_WARM_S,
                          "last": dict(_preset_warm_last) or None}
    try:
        cs = _common_stock_symbols()
        out["cs_universe_size"] = len(cs) if cs else 0
    except Exception as e:
        out["cs_universe_size"] = f"error: {e}"
    rm = _REUSE_MEM["map"]
    try:
        file_age_d = round((_time.time() - os.path.getmtime(_REUSE_FILE)) / 86400, 2)
    except OSError:
        file_age_d = None
    out["reuse_map"] = {"warm": rm is not None, "size": (len(rm) if rm else 0),
                        "file": os.path.exists(_REUSE_FILE), "file_age_days": file_age_d,
                        "refresh_waiting": _reuse_refreshing.is_set()}
    return out


def coverage_probe(start_ymd: int, end_ymd: int) -> dict:
    """Would serving this range from bars.db (skipping the provider's grouped-daily call)
    give the SAME ranked list? Instruments the risk of the 'bars.db-primary' speedup.

    The provider's grouped-daily set is the authoritative, complete universe for a date.
    bars.db is survivorship-biased (delisted names absent) and coverage-dependent. This
    compares, at the RESULT level, the names each source would produce — a name only makes
    the list if it has BOTH a start and end close, is common stock, and isn't an ETF — then
    reports what bars.db would DROP versus the provider, with special attention to whether
    any dropped name is a big mover (the visible failure). Read-only; no writes, no warm."""
    from api.services import bars_sqlite
    sd_t, ed_t = _to_date(start_ymd), _to_date(end_ymd)

    # Authoritative provider closes (normalize BRK.B → BRK-B to match bars.db storage form).
    prov_s, sd = _grouped_near(sd_t)
    prov_e, ed = _grouped_near(ed_t)
    prov_s = {k.replace(".", "-"): v for k, v in prov_s.items()}
    prov_e = {k.replace(".", "-"): v for k, v in prov_e.items()}

    idx_ready = bars_sqlite.daily_bydate_index_ready()
    bdb_s = bdb_e = {}
    if idx_ready:
        # Same ±15-day windows _assemble uses for its cross-check.
        s_hi = int(sd.strftime("%Y%m%d")); s_lo = int((sd - timedelta(days=15)).strftime("%Y%m%d"))
        e_hi = int(ed.strftime("%Y%m%d")); e_lo = int((ed - timedelta(days=15)).strftime("%Y%m%d"))
        bdb_s = bars_sqlite.closes_near_date(s_hi, s_lo)
        bdb_e = bars_sqlite.closes_near_date(e_hi, e_lo)

    cs = _common_stock_symbols() or set()
    etfs = _etf_symbols() or set()

    def _result_set(start_map, end_map):
        """Names that would appear in the ranked list from this source, → their % change."""
        out = {}
        for app, sc in start_map.items():
            if not sc or sc <= 0:
                continue
            ec = end_map.get(app)
            if not ec or ec <= 0:
                continue
            if app not in cs or app in etfs or app.endswith("ZZT"):
                continue
            out[app] = (ec - sc) / sc * 100
        return out

    prov_res = _result_set(prov_s, prov_e)
    bdb_res = _result_set(bdb_s, bdb_e) if (bdb_s and bdb_e) else {}

    prov_names = set(prov_res)
    bdb_names = set(bdb_res)
    dropped = prov_names - bdb_names          # in the provider list, MISSING from bars.db → would vanish
    extra = bdb_names - prov_names            # bars.db has, provider doesn't (rare; stale/survivorship)
    overlap = prov_names & bdb_names

    cov_pct = round(100 * len(overlap) / len(prov_names), 2) if prov_names else None

    # The killer metric: are the dropped names BIG movers? A dropped +300% gainer is a
    # visible, unacceptable list change; a dropped ±2% name nobody would notice. Rank the
    # dropped names by |provider % change| and show the worst offenders.
    dropped_ranked = sorted(
        ({"sym": s, "pct": round(prov_res[s], 2)} for s in dropped),
        key=lambda r: abs(r["pct"]), reverse=True,
    )
    big_dropped = [d for d in dropped_ranked if abs(d["pct"]) >= 25]

    # Price agreement on the overlap: median |Δ| between the two sources' computed % change.
    # A large divergence = split-adjustment / staleness mismatch (bars.db close on a wrong basis).
    diffs = sorted(abs(prov_res[s] - bdb_res[s]) for s in overlap)
    if diffs:
        median_diff = round(diffs[len(diffs) // 2], 3)
        p95_diff = round(diffs[int(len(diffs) * 0.95)], 3)
        big_disagree = sum(1 for d in diffs if d > 5)  # >5 percentage-points apart
    else:
        median_diff = p95_diff = big_disagree = None

    return {
        "start": int(sd.strftime("%Y%m%d")), "end": int(ed.strftime("%Y%m%d")),
        "index_ready": idx_ready,
        "provider_result_count": len(prov_names),
        "bars_db_result_count": len(bdb_names),
        "overlap": len(overlap),
        "coverage_pct": cov_pct,                       # % of provider names bars.db also has
        "dropped_count": len(dropped),                 # names that would DISAPPEAR from the list
        "dropped_big_movers_count": len(big_dropped),  # of those, how many moved ≥25% (the real risk)
        "dropped_big_movers_sample": big_dropped[:25],
        "dropped_worst_sample": dropped_ranked[:15],
        "extra_in_bars_db_count": len(extra),
        "price_agreement": {                           # on the overlapping names
            "median_pct_diff": median_diff,
            "p95_pct_diff": p95_diff,
            "names_over_5pp_apart": big_disagree,
        },
        "verdict_hint": (
            "bars.db not usable (index not built / no data near dates)" if not bdb_res else
            "SAFE-looking: near-complete coverage + close price agreement"
            if (cov_pct or 0) >= 99 and not big_dropped and (median_diff or 0) < 2 else
            "RISKY: bars.db would drop names or diverge on price — keep provider-primary"
        ),
    }


def _sector_industry_map():
    """{app_sym: {'sector', 'industry'}} read from the prewarmed ticker_meta disk cache
    (the only whole-universe sector/industry source — no bulk API exists). Globbing ~4k
    small JSON files is ~1s, so cache it for 6h."""
    ck = "period_sector_industry_map"
    cached = cache.get(ck)
    if cached is not None:
        return cached
    import glob
    import json
    import os
    from api.services.ticker_meta import _CACHE_DIR
    out = {}
    try:
        for path in glob.glob(os.path.join(_CACHE_DIR, "*.json")):
            sym = os.path.splitext(os.path.basename(path))[0]
            try:
                with open(path) as fh:
                    d = json.load(fh)
            except Exception:
                continue
            out[sym] = {"sector": d.get("sector"), "industry": d.get("industry")}
    except Exception:
        pass
    cache.set(ck, out, ttl=21600)
    return out


def _robust_group_pct(vals) -> float:
    """A group's representative % change, robust to a single moonshot outlier.

    UPSIDE-WINSORIZED MEAN: cap the top ~10% of members (at least 1) down to the
    next-highest member's return, then take the equal-weight mean. This keeps the
    group's MAGNITUDE (it still averages every member's real move) but stops one absurd
    gainer — e.g. CVNA +2641% inside Auto & Truck Dealerships — from dragging the whole
    group to #1. The DOWNSIDE is left untouched: a genuinely weak group should rank low,
    and simple returns are already bounded at -100%, so there's no runaway there.
    Single-member groups return that member; empty → 0."""
    n = len(vals)
    if n == 0:
        return 0.0
    if n <= 2:
        # Too small to separate an outlier from a trend meaningfully — but still don't
        # let a lone moonshot define a 2-name group: cap the max to the min.
        return (min(vals) if n == 2 and max(vals) > min(vals) * 3 and max(vals) > 100
                else sum(vals) / n)
    s = sorted(vals)
    k = max(1, round(n * 0.10))          # how many top members to winsorize
    cap = s[n - k - 1]                    # the return just below the winsorized top block
    capped = [v if v <= cap else cap for v in s]
    return sum(capped) / n


def get_period_change_groups(start_ymd: int, end_ymd: int, group: str) -> dict:
    """Rank THEMES / SECTORS / INDUSTRIES by their (outlier-robust) % change over
    [start, end], reusing the whole-market per-stock period_change. Each group carries its
    member symbols so the UI can drill into it. `group` ∈ {'theme','sector','industry'}.
    Ranking uses `_robust_group_pct` (upside-winsorized mean) so one moonshot can't top a
    group; members still show their own raw % change."""
    if group not in ("theme", "sector", "industry"):
        return {"status": "error", "group": group, "results": [], "count": 0, "error": "bad group"}
    return period_groups_of(get_period_change(start_ymd, end_ymd), group)


def period_groups_of(base: dict, group: str) -> dict:
    """The groups answer worked out from a per-stock answer ALREADY IN HAND (`get_period_change`'s
    shape). It reads the stored sector / industry map or the stored theme list and nothing else:
    it never asks for the per-stock ranking, so it can never start that build. A caller that must
    not cause work (the Agent's `group.drill` kind, inside a turn) passes the answer this module
    already holds (`_period_answer`, else `_period_old_answer`)."""
    if group not in ("theme", "sector", "industry"):
        return {"status": "error", "group": group, "results": [], "count": 0, "error": "bad group"}
    if base.get("status") != "ok":
        return {"status": base.get("status", "computing"), "group": group, "results": [], "count": 0, "error": base.get("error")}
    chg = {r["sym"]: r["period_change"] for r in base["results"]}

    buckets = {}  # name -> {"vals": [member % changes], "members": [syms]}
    if group == "theme":
        from api.services import theme_db
        try:
            themes = theme_db.get_all_themes().get("themes", [])
        except Exception:
            themes = []
        for th in themes:
            name = th.get("name")
            if not name:
                continue
            members, vals = [], []
            for h in th.get("holdings", []):
                if h.get("source") == "engine":   # owner-only aggregate (matches every UCT group metric)
                    continue
                s = str(h.get("sym", "")).replace(".", "-")   # taxonomy is dot-form; scan is hyphen-form
                if s in chg:
                    members.append(s)
                    vals.append(chg[s])
            if vals:
                buckets[name] = {"vals": vals, "members": members}
    else:
        smap = _sector_industry_map()
        field = group  # 'sector' | 'industry'
        for sym, c in chg.items():
            g = (smap.get(sym) or {}).get(field)
            if not g:
                continue
            b = buckets.setdefault(g, {"vals": [], "members": []})
            b["vals"].append(c)
            b["members"].append(sym)

    results = []
    for name, b in buckets.items():
        results.append({
            "name": name,
            "period_change": round(_robust_group_pct(b["vals"]), 2),
            "count": len(b["vals"]),
            "members": b["members"],
        })
    results.sort(key=lambda r: r["period_change"], reverse=True)
    return {
        "status": "ok",
        "group": group,
        "results": results,
        "count": len(results),
        "start": base.get("start"),
        "end": base.get("end"),
        "as_of": base.get("as_of"),
        # TERM-047: the groups are built from the SAME per-stock pass, so its
        # receipt (counted in symbols) is this surface's receipt too.
        "coverage": base.get("coverage"),
    }
