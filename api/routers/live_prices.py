"""Live batch pricing endpoint — returns real-time price data for up to 250 tickers.

Uses Massive.com batch snapshot API (Polygon-compatible).

Caching is TWO-tier (2026-07-01 scale pass, for the ~200-user launch):
  1. A whole-request fast path (one cache key per sorted ticker set) — a user
     polling the same list every 2s pays a single cache lookup.
  2. A SHARED PER-TICKER cache underneath it — so different users' overlapping
     tickers reuse each other's fetches instead of each firing its own Massive
     call (the old per-user cache-key fragmentation). One user fetching AAPL
     warms it for everyone.

A semaphore caps concurrent upstream Massive calls: after a deploy clears the
cache, 200 browsers resuming their 2s polls would otherwise fan out to ~200
simultaneous Massive fetches and exhaust the shared threadpool (the launch-day
524 scenario). The valve + herd-collapse re-check keep that to a handful.
"""
import hashlib
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from api.services.cache import TTLCache
from api.services.massive import _get_client, _detect_session, _ext_price_for

router = APIRouter()

_MAX_TICKERS = 250  # Watchlists page sends every visible ticker in one request.
_CACHE_TTL = 15     # seconds — applies to both the whole-set and per-ticker caches


# ── Cache capacity — derived from the real working set, not a shared default ──
# This instance holds exactly three key families and nothing else:
#
#   live_px1_{TK}      one per ticker            (_px_key,    TTL 15s)
#   live_exvol_{TK}    one per ticker, extended  (_exvol_key, TTL 45s)
#   live_prices_{md5}  one per distinct SET      (whole_key,  TTL 15s)
#
# So the per-ticker half of the working set is bounded by the tradable universe
# — 2 keys per symbol, because during extended hours (which `_detect_session()`
# reports 04:00–20:00 ET on weekdays and all weekend) every active ticker also
# writes an `live_exvol_` key into this same instance.
#
# ⚠️ WHY THIS EXISTS. The bound used to come from `cache._MAX_SIZE = 1000`, a
# MODULE-level constant that applied to every instance including this one. The
# two-tier design below is correct and the per-ticker keys are genuinely shared
# across users (NOT fragmented per user) — but above ~970 distinct tickers the
# ticker keys evicted EACH OTHER, permanently, in steady state: 31.7% per-ticker
# miss and ~3.1k upstream fetches per 2s poll round at 200 users × 50 tickers,
# 68.7% and ~34k at 200 × 250. Those funnel through `_MASSIVE_SEM` (6 slots, 8s
# acquire) and end in the `if not result: 503` below — the launch-day 524 shape
# reached from a different direction. The cap was the whole defect.
#
# Raising `cache._MAX_SIZE` globally was NOT the fix: it would have changed the
# memory profile of the shared singleton, which caches MB-scale bars payloads.
# The bound belongs to the instance whose working set is knowable.
_UNIVERSE_FALLBACK = 4000     # if cap_universe.json can't be read; ≥ today's 3,742
_KEYS_PER_TICKER = 2          # live_px1_ + live_exvol_ (extended hours)
# One whole-set key per DISTINCT polled ticker set alive inside the 15s TTL.
# A member polling their own watchlist contributes exactly one; 1,000 covers
# every concurrent distinct set at several times launch scale, and these entries
# hold REFERENCES to the same per-ticker row dicts (no payload duplication).
_SET_KEY_HEADROOM = 1000


def _universe_size() -> int:
    """Number of symbols the frontend can ask for. Never raises."""
    import json
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            syms = json.load(fh)
        n = len(syms)
        # A truncated/rewritten file must not silently shrink the cache into the
        # thrash regime the bound exists to escape.
        return n if n >= _UNIVERSE_FALLBACK else _UNIVERSE_FALLBACK
    except Exception:
        return _UNIVERSE_FALLBACK


CACHE_MAX_SIZE = _universe_size() * _KEYS_PER_TICKER + _SET_KEY_HEADROOM

# DEDICATED cache instance (not the app singleton), with its OWN bound above.
# The per-ticker refactor writes up to 250 `live_px1_*` keys + a whole-set key
# PER POLL; in the shared singleton that churned LRU evictions against
# bars/news/snapshot keys at launch scale, defeating the 15s TTL and re-creating
# the cold-herd semaphore pileup this two-tier design exists to prevent.
cache = TTLCache(max_size=CACHE_MAX_SIZE)

# Cap concurrent upstream Massive batch calls (cold-herd backpressure valve).
_MASSIVE_SEM = threading.Semaphore(6)
_SEM_WAIT_S = 8.0

# Closed-market fallback: settled daily closes for the last two sessions, used to
# show the last session's real % move once the live feed goes empty. Immutable
# once a session settles, so this caches hard; one build at a time.
#
# Deliberately module state and NOT the TTLCache above: these are two
# whole-market maps (~12k entries each), i.e. two entries whose payload dwarfs
# every other key in that cache put together. Two LRU slots holding ~24k rows
# would be a size-blind bound pretending to be a memory bound — and an eviction
# of either makes every closed-market poll re-fetch multi-MB grouped responses.
# (This held under the old 1,000-entry cap and still holds under CACHE_MAX_SIZE:
# the argument is about ENTRY SIZE, which no entry-count bound can see.)
_SESSION_CLOSES_TTL = 3600
_SESSION_CLOSES_LOCK = threading.Lock()
_session_closes_at = 0.0
_session_closes_val: tuple[dict, dict] = ({}, {})
_GROUPED_LOOKBACK_DAYS = 10   # enough to clear a long holiday weekend
_GROUPED_TIMEOUT_S = 20.0     # multi-MB whole-market response, off the request path


def _px_key(tk: str) -> str:
    return f"live_px1_{tk}"


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _grouped_closes(client, day) -> dict:
    """{ticker: close} for one date — the whole US market in a single call.

    Returns {} for a non-trading day (the endpoint answers with zero results),
    which is what makes the session walk below holiday-proof.
    """
    url = (
        f"https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/"
        f"{day.isoformat()}?adjusted=true&apiKey={client._api_key}"
    )
    try:
        data = client._get(url, timeout=_GROUPED_TIMEOUT_S)
    except Exception:
        return {}
    out = {}
    for r in (data.get("results") or []):
        tk, c = r.get("T"), _f(r.get("c"))
        if tk and c:
            out[tk] = c
    return out


def _build_session_closes() -> tuple[dict, dict]:
    """(closes of the last completed session, closes of the one before it)."""
    try:
        client = _get_client()
    except Exception:
        return ({}, {})
    maps: list[dict] = []
    day = datetime.now(ZoneInfo("America/New_York")).date()
    for _ in range(_GROUPED_LOOKBACK_DAYS):
        if len(maps) >= 2:
            break
        m = _grouped_closes(client, day)
        if m:
            maps.append(m)
        day -= timedelta(days=1)
    return (maps[0] if maps else {}, maps[1] if len(maps) > 1 else {})


def _warm_session_closes_async() -> None:
    """Build the session-close maps off the request path.

    Each grouped call is a multi-MB response and the walk can take several of
    them, which is far too long to hold an anyio threadpool worker inside the
    Semaphore(6) valve (the launch-day 524 class). So the first closed-market
    poll returns without a % and the next one — 2s later, and for the hour after
    that — reads a warm cache.
    """
    if not _SESSION_CLOSES_LOCK.acquire(blocking=False):
        return  # a build is already in flight

    def _build():
        global _session_closes_at, _session_closes_val
        try:
            built = _build_session_closes()
            if built[0]:
                _session_closes_val = built
                _session_closes_at = time.monotonic()
        except Exception:
            pass
        finally:
            _SESSION_CLOSES_LOCK.release()

    threading.Thread(target=_build, daemon=True,
                     name="live-prices-session-closes").start()


def _session_closes() -> tuple[dict, dict]:
    if _session_closes_val[0] and (time.monotonic() - _session_closes_at) < _SESSION_CLOSES_TTL:
        return _session_closes_val
    # Stale or never built — kick off a refresh and serve what we have. An
    # expired-but-present map is still the right last session until the market
    # reopens, so it keeps being served rather than blanking the % column.
    _warm_session_closes_async()
    return _session_closes_val


# ── Extended-hours volume (match the chart) ─────────────────────────────────
# The watchlist and the chart's volume pane must agree. The chart sums today's
# intraday AGGREGATES; the snapshot's `min.av` counts every trade condition
# (odd-lots, off-exchange) and over-states it — pre-market NBIS read 418k on
# min.av vs the chart's ~330k. So in extended hours we replace the volume with
# the same aggregate total the chart uses.
#
# It's per-ticker (no bulk pre-market aggregate exists — the grouped/daily
# endpoints return nothing until RTH), so it rides a shared per-ticker cache and
# a bounded async warm, exactly like the session-close maps: the 2s poll never
# blocks on it, it just reads the warm value. Volume is additive across
# granularities (verified 1/5/30/60-min all equal), so we sum COARSE hourly bars
# — a whole day is ~8 tiny rows.
_EXVOL_TTL = 45
_EXVOL_SEM = threading.Semaphore(4)
_EXVOL_WARMING: set[str] = set()
_EXVOL_WARM_LOCK = threading.Lock()
# Last-known aggregate per ticker, {tk: (yyyymmdd, volume)}. Survives the TTL
# cache's expiry so a poll landing in the ~1-2s re-warm window serves the last
# good aggregate instead of flapping back to the min.av placeholder (the "correct
# on refresh, wrong a few seconds later" bug). Date-stamped so yesterday's total
# is never served today. Bounded by the watched-ticker universe; fine unpruned.
_EXVOL_LAST: dict[str, tuple[int, int]] = {}

# Last-known EXTENDED-hours print per ticker, {tk: (yyyymmdd, session, price)}.
# Massive's snapshot intermittently comes back with an EMPTY `lastTrade` for a
# thin pre/post name. Without this memo that poll shipped `ext_price: None` +
# `ext_session: None` and a `price` that falls through to day.c / prevDay.c —
# i.e. the RTH or PRIOR close. The chart's tick writer then folded that stale
# close into the developing pre-market candle: a wick shooting down to the SAME
# price every few seconds, the right-axis tag snapping to it, then both
# reverting on the next good poll ("ghost wicks"). Re-serving the last known
# ext print keeps the extended session continuously flagged, so a momentary
# hole in the feed can never look like "we're back in regular hours at
# yesterday's close". Date+session-stamped so a stale print never leaks into
# the next session; bounded by the watched universe, fine unpruned.
_EXT_LAST: dict[str, tuple[int, str, float]] = {}


def _today_yyyymmdd() -> int:
    return int(datetime.now(ZoneInfo("America/New_York")).strftime("%Y%m%d"))


def _exvol_key(tk: str) -> str:
    return f"live_exvol_{tk}"


def _fetch_extended_volume(client, ticker: str) -> int | None:
    """Today's total traded volume from hourly aggregates — the chart's tally.

    Returns None when there are no bars yet (market closed / no trades), so the
    caller keeps its placeholder rather than showing a hard 0.
    """
    day = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    url = (
        f"https://api.massive.com/v2/aggs/ticker/{ticker}/range/60/minute/"
        f"{day}/{day}?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
    )
    try:
        data = client._get(url, timeout=5.0)
    except Exception:
        return None
    res = data.get("results") or []
    if not res:
        return None
    return int(sum(_f(r.get("v")) or 0 for r in res))


def _warm_extended_volumes_async(tickers: list[str]) -> None:
    with _EXVOL_WARM_LOCK:
        todo = [t for t in tickers if t not in _EXVOL_WARMING]
        _EXVOL_WARMING.update(todo)
    if not todo:
        return

    def _build():
        try:
            client = _get_client()
        except Exception:
            client = None
        today = _today_yyyymmdd()
        for t in todo:
            try:
                if client is not None and cache.get(_exvol_key(t)) is None:
                    if _EXVOL_SEM.acquire(timeout=3.0):
                        try:
                            v = _fetch_extended_volume(client, t)
                            if v is not None:
                                cache.set(_exvol_key(t), v, ttl=_EXVOL_TTL)
                                _EXVOL_LAST[t] = (today, v)   # survives the TTL expiry
                        finally:
                            _EXVOL_SEM.release()
            except Exception:
                pass
            finally:
                with _EXVOL_WARM_LOCK:
                    _EXVOL_WARMING.discard(t)

    threading.Thread(target=_build, daemon=True, name="live-prices-exvol").start()


def _prev_session_change(prev_day: dict, prior_close) -> dict:
    """{prev_change, prev_change_pct} — the prevDay session's OWN change (its close vs
    the close of the session before it). The header shows this as the regular-hours
    number during pre-market/overnight. Both None until the prior-close cache warms."""
    pd_c = _f(prev_day.get("c"))
    pp_c = _f(prior_close)
    if pd_c and pp_c and pp_c > 0:
        abs_ = pd_c - pp_c
        return {"prev_change": round(abs_, 4), "prev_change_pct": round(abs_ / pp_c * 100.0, 4)}
    return {"prev_change": None, "prev_change_pct": None}


def _last_session_row(ticker: str, t: dict, last_map: dict, prior_map: dict) -> dict | None:
    """Build a quote from prevDay when the live feed is empty (market closed).

    Massive zeroes `day` and `lastTrade` outside trading hours but keeps
    `prevDay` populated with the last completed session, so a weekend row can
    still show that session's close, volume and OHLC instead of a blank.
    """
    prev_day = t.get("prevDay") or {}
    close = _f(prev_day.get("c"))
    if not close or close <= 0:
        return None

    # Only trust the prior close once the settled grouped data for the last
    # session AGREES with this snapshot's prevDay. That proves both maps are
    # aligned to the session being displayed, so the % can't silently become a
    # multi-session move mislabelled as a one-day change.
    prior = None
    settled = last_map.get(ticker)
    if settled and abs(settled - close) / close < 0.001:
        prior = prior_map.get(ticker)

    if prior and prior > 0:
        chg_abs = close - prior
        chg_pct = chg_abs / prior * 100.0
    else:
        prior, chg_abs, chg_pct = None, 0.0, 0.0

    return {
        "price": round(close, 2),
        "change_pct": round(chg_pct, 4),
        "change": round(chg_abs, 4),
        "volume": int(prev_day.get("v") or 0),
        "day_open": round(float(prev_day.get("o") or 0), 2),
        "day_high": round(float(prev_day.get("h") or 0), 2),
        "day_low": round(float(prev_day.get("l") or 0), 2),
        "prev_close": round(prior, 2) if prior else 0.0,
        "day_close": round(close, 2),
        "ext_price": None,
        "ext_session": None,
        # This row already REPRESENTS the last completed session (its change is that
        # session's move), so there's no separate pre-market split — the header uses
        # `change`/`change_pct` here. Kept for response-shape consistency.
        "prev_change": None,
        "prev_change_pct": None,
        # Marks a row served from the last completed session rather than a live
        # feed. Price alerts skip these so a weekend poll can't re-fire Friday.
        "market_closed": True,
    }


def _fetch_snapshots(client, tickers: list[str], session: str) -> dict:
    """One Massive batch call → {ticker: value_dict}."""
    tickers_param = ",".join(tickers)
    url = (
        f"https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers"
        f"?tickers={tickers_param}&apiKey={client._api_key}"
    )
    # Short per-call timeout: this runs inside the Semaphore(6) valve on an anyio
    # threadpool worker. The client-level default read timeout is 25s (tuned for
    # large historical-bar fetches) — far too long for a 2s user poll. A slow Massive
    # would otherwise pin up to 6 workers for 25s each and, under a post-deploy cold
    # herd, exhaust the 64-worker pool (the launch-day 524 class). 5s caps that.
    data = client._get(url, timeout=5.0)

    out: dict = {}
    degraded: dict = {}
    need_exvol: list[str] = []   # active extended-hours tickers awaiting an aggregate warm
    _today = _today_yyyymmdd()    # for the date-guarded last-known aggregate
    # Closes of the session BEFORE the last completed one (cached, warmed async) — lets
    # us report the PREVIOUS regular session's change (prevDay.c vs the one before it),
    # which the header's pre-market split shows as the "original" (regular-hours) number.
    _, _prior_map = _session_closes()
    for t in data.get("tickers", []):
        ticker = t.get("ticker", "")
        if not ticker:
            continue
        day = t.get("day", {})
        prev_day = t.get("prevDay", {})
        last_trade = t.get("lastTrade", {})
        minute = t.get("min", {})

        # Live price. During RTH the actual LAST TRADE is the current price;
        # `day.c` (the day aggregate's close) LAGS the last trade intraday by
        # cents-to-dollars, so serving it made the chart's developing bar snap back
        # to that stale value on every 2s poll while the fast tick showed the real
        # price (the "keeps jumping to one price" bug). Pre/post keep day.c-first so
        # the main price stays the frozen RTH close (ext price is served separately).
        if session == "regular":
            price = last_trade.get("p") or day.get("c") or prev_day.get("c") or 0.0
        else:
            price = day.get("c") or last_trade.get("p") or prev_day.get("c") or 0.0
        # `day.v` is the REGULAR-session aggregate and stays 0 until the 9:30
        # open. `min.av` (today's accumulated) is the pre-open placeholder, but it
        # OVER-counts vs the chart, so in extended hours it's replaced below with
        # the chart-matching aggregate total once that's warmed.
        volume = int(day.get("v") or minute.get("av") or 0)

        # The day % must be the REGULAR-SESSION move — day close vs prev close, the
        # exact thing the chart's close-vs-prev-close legend shows. Massive's
        # todaysChangePerc is based on the LAST TRADE (incl. after-hours), so after
        # the close it MIS-STATES the regular % (TWST: 2.93% vs the real 2.87%) AND
        # intermittently returns a stale 0. So ALWAYS derive from the closes when we
        # have them; a genuinely flat name still has day_c == prev_c → an honest 0.
        day_c = _f(day.get("c"))
        prev_c = _f(prev_day.get("c"))
        if day_c and prev_c and prev_c != 0:
            chg_pct = (day_c - prev_c) / prev_c * 100.0
            chg_abs = day_c - prev_c
        else:
            chg_pct = _f(t.get("todaysChangePerc"))
            chg_abs = _f(t.get("todaysChange"))
            # No day close AND no real change. MID-SESSION that means a degraded
            # read we must not trust — serving it would flash a live row to a
            # spurious 0.00% — so the ticker is held back and the caller keeps
            # its last-good value.
            #
            # But when the market is CLOSED the ENTIRE feed looks like this
            # (day + lastTrade zeroed, prevDay intact), so holding every ticker
            # back emptied the response completely → 503 → every Price/Vol/%Chg
            # cell blank all weekend. Those are rebuilt from prevDay below.
            if chg_pct is None or chg_pct == 0.0:
                degraded[ticker] = t
                continue

        ext_price = None
        ext_session = None
        if session != "regular":
            # min.c-aware: a STALE lastTrade (SPY sits pinned to the 4pm regular close
            # in pre/post) falls back to the minute-aggregate close that the chart's
            # extended bars use. See _ext_price_for.
            ext_price, ext_session = _ext_price_for(session, last_trade, minute, day)
            if ext_price is not None:
                _EXT_LAST[ticker] = (_today, session, ext_price)
            else:
                # Empty read on THIS poll only — see _EXT_LAST. Re-serve the last
                # print from this same session so the ticker never reads as "no
                # extended session" (which sends the chart back to the stale
                # regular/prior close for one tick = the ghost wick).
                prior = _EXT_LAST.get(ticker)
                if prior is not None and prior[0] == _today and prior[1] == session:
                    ext_session, ext_price = prior[1], prior[2]
            # NOTE: `price` deliberately stays the frozen RTH/prior close in
            # extended hours (see the price derivation above) — the locked-close
            # axis tag and the Regular-Hours view depend on it. Consumers that
            # want the live pre/post number read ext_price, gated on ext_session.

        # Extended hours: swap in the chart-matching aggregate total. day.v is 0
        # pre-market and RTH-only post-market, and min.av over-counts, so pre/post
        # we use the summed intraday aggregate (per-ticker, cached + async-warmed).
        # Only ACTIVE names reach here — degraded/weekend rows already `continue`d
        # to the last-session path above, so they never trigger a warm.
        if session != "regular":
            fresh = cache.get(_exvol_key(ticker))
            if fresh is not None:
                volume = fresh
            else:
                # Fresh cache expired → refresh in the background, but serve the
                # LAST-KNOWN aggregate meanwhile so we never flap back to the
                # min.av placeholder (which over-counts ~30%). Only a ticker that
                # has never been warmed today keeps the min.av placeholder, and
                # only until its first warm lands a second or two later.
                need_exvol.append(ticker)
                last = _EXVOL_LAST.get(ticker)
                if last is not None and last[0] == _today:
                    volume = last[1]

        out[ticker] = {
            "price": round(float(price), 2),
            # Recomputed above from day/prev close when Massive's field is a
            # spurious 0 — never a raw passthrough that flashes charts to 0.00%.
            "change_pct": round(chg_pct, 4) if chg_pct is not None else 0.0,
            "change": round(chg_abs, 4) if chg_abs is not None else 0.0,
            "volume": volume,
            "day_open": round(float(day.get("o") or 0), 2),
            "day_high": round(float(day.get("h") or 0), 2),
            "day_low": round(float(day.get("l") or 0), 2),
            "prev_close": round(float(prev_day.get("c") or 0), 2),
            # Today's REGULAR-session close — null pre-market (no day bar yet).
            # Powers the RH-style After-Hours split (move since the 4pm close).
            "day_close": round(float(day["c"]), 2) if day.get("c") else None,
            "ext_price": ext_price,
            "ext_session": ext_session,
            # The PREVIOUS regular session's change (prevDay.c vs the close before it).
            # The header shows this as the "original" regular-hours number during
            # pre-market/overnight, when today's regular session hasn't happened yet.
            **_prev_session_change(prev_day, _prior_map.get(ticker)),
        }

    # Serve last-session values for the held-back tickers when the market isn't
    # open. `not out` covers the cases _detect_session() can't know about — market
    # holidays and early closes, where the clock says "regular" but the feed is
    # uniformly empty. A mid-session one-off degraded ticker still gets held back.
    if degraded and (session != "regular" or not out):
        last_map, prior_map = _session_closes()
        for ticker, t in degraded.items():
            row = _last_session_row(ticker, t, last_map, prior_map)
            if row is not None:
                out[ticker] = row

    # Warm the aggregate volume for any extended-hours ticker still on its
    # placeholder; the next poll reads the chart-matching value from cache.
    if need_exvol:
        _warm_extended_volumes_async(need_exvol)
    return out


@router.get("/api/live-prices")
def get_live_prices(
    tickers: str = Query(..., description="Comma-separated ticker symbols (max 250)"),
):
    """Return real-time price snapshot for a batch of tickers.

    Response: {AAPL: {price, change_pct, change, volume, ...}, ...}
    """
    raw_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not raw_list:
        return JSONResponse(status_code=400, content={"error": "No tickers provided"})
    if len(raw_list) > _MAX_TICKERS:
        return JSONResponse(
            status_code=400,
            content={"error": f"Maximum {_MAX_TICKERS} tickers per request"},
        )

    unique = list(dict.fromkeys(raw_list))  # dedupe, preserve order

    # UCT BREADTH pseudo-tickers (UCTA50 etc.) have no market-data provider — their
    # "quote" is the latest breadth value + day change. Split them out so they skip the
    # Massive path; their quotes are injected below (and ride the whole-request cache).
    from api.services import breadth_symbols as _breadth_syms
    _breadth_in = [t for t in unique if _breadth_syms.is_breadth_symbol(t)]
    _breadth_set = set(_breadth_in)

    # Tier 1: whole-request fast path (one lookup for a repeated identical poll).
    sorted_key = ",".join(sorted(set(unique)))
    whole_key = f"live_prices_{hashlib.md5(sorted_key.encode()).hexdigest()}"
    whole_hit = cache.get(whole_key)
    if whole_hit is not None:
        return whole_hit  # alerts already ran when this set was last built

    # Tier 2: assemble from the shared per-ticker cache; fetch only what's missing.
    result: dict = {}
    missing: list[str] = []
    for tk in unique:
        if tk in _breadth_set:
            continue  # served from breadth history below, not the price cache
        hit = cache.get(_px_key(tk))
        if hit is not None:
            result[tk] = hit
        else:
            missing.append(tk)

    if missing:
        try:
            client = _get_client()
        except Exception:
            client = None
        if client is not None:
            acquired = _MASSIVE_SEM.acquire(timeout=_SEM_WAIT_S)
            try:
                if acquired:
                    # Herd collapse: a concurrent request may have filled these
                    # while we waited on the semaphore — re-check before fetching.
                    still: list[str] = []
                    for tk in missing:
                        hit = cache.get(_px_key(tk))
                        if hit is not None:
                            result[tk] = hit
                        else:
                            still.append(tk)
                    if still:
                        session = _detect_session()
                        try:
                            fetched = _fetch_snapshots(client, still, session)
                        except Exception:
                            fetched = {}
                        for tk, val in fetched.items():
                            cache.set(_px_key(tk), val, ttl=_CACHE_TTL)
                            result[tk] = val
                # if not acquired within the wait: serve whatever the cache gave
                # us rather than piling another call onto a saturated upstream.
            finally:
                if acquired:
                    _MASSIVE_SEM.release()

    # Breadth quotes: latest value + day-over-day change (live where breadth_live
    # tracks the metric, else the last EOD candle). Injected before the empty-check so
    # a breadth-only request is never a 503.
    if _breadth_in:
        try:
            result.update(_breadth_syms.latest_quotes(_breadth_in))
        except Exception:
            pass

    if not result:
        return JSONResponse(status_code=503, content={"error": "Pricing service unavailable"})

    cache.set(whole_key, result, ttl=_CACHE_TTL)

    # Price alerts run once per freshly-built set (mirrors the pre-refactor cadence
    # of running only on a cache miss, not on every repeated poll).
    # Closed-market rows are Friday's close replayed on every poll — evaluating
    # alerts against them would re-test targets the live session already settled.
    try:
        from api.services.watchlist_alert_service import run_alert_check
        live_only = {k: v for k, v in result.items() if not v.get("market_closed")}
        if live_only:
            run_alert_check(live_only)
    except Exception:
        pass

    return result
