"""IBD-style Relative Strength (RS) ranking system.

Computes weighted price performance for a universe of stocks and ranks them
on a 1-99 percentile scale. Uses Massive API for 6-month daily bars.

The RS score is the IBD-style weighted return. ⛔ THE WEIGHTS AND THE
MISSING-PERIOD RULE ARE NOT RESTATED HERE — read ``RS_TERMS`` in
``api/services/rs_weighted_return.py``, which is the one place either is
written down and the one place both this lane and ``research.ratings`` read.
A prose copy of a formula beside the code that owns it is how this repo grew
two RS returns 15.7% apart in the first place.

Cached for 1 hour (3600s). Universe: cap_universe from wire_data ($300M+).

ONE RS RATING EVERYWHERE (RS split unit U5a, 2026-11-09). The chart's UCT RS prints
the nightly IBD-style rating (``screener/rs_history``, column ``ibd``); the badge,
the screener's ``rs_rank`` column and the groups gate read THIS module's hourly
rank, so one stock read 94 on the chart and 88 on its badge. Behind
``RS_RANK_IBD_ENABLED`` (read per call, default off) every by-symbol reader here
(:func:`cached_rank_map`, :func:`get_rs_for_ticker`, :func:`unified_rankings`)
hands back the nightly ``ibd`` as ``rs_rank`` for the newest stored session and
falls back to the hourly value ONLY for a name without a row, saying which in
``rs_rank_source`` (``ibd`` / ``fast``). The field NAME ``rs_rank`` stays: 518
references in 149 files, a rename is out of proportion. Flag off, every reader
answers byte for byte what it did before. :func:`fast_rank_map` is the hourly
rank whatever the flag says, for the one caller that must store it as such.
"""

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from api.services import rs_weighted_return
from api.services.cache import TTLCache, cache
from api.services.massive import get_agg_bars

logger = logging.getLogger(__name__)

_CACHE_KEY = "rs_rankings"
_CACHE_TTL = 3600  # 1 hour

# ⛔ ITS OWN INSTANCE, NOT THE SHARED LRU. The shared `cache` ran at 999/1000
# entries on 2026-09-30 (memory probe), churned by small `bars_*` keys, so an
# hourly-read ~3,685-row list is the first thing it evicts -- and a cold RS list
# is what put two full rebuilds on request threads at 08:08 ET that morning.
# Two slots: the list is ONE key; nothing else lives here.
_rs_cache = TTLCache(max_size=2)

#: The last computed ranking, on disk, so a freshly booted web process can answer
#: /api/rs-rankings while its own ~67 s recompute runs (measured 2026-10-09: 503
#: "warming" for ~3 minutes after every deploy). Served only while younger than
#: _SNAPSHOT_MAX_AGE_S, and never stands in for the in-memory cache: a cold memory
#: cache still starts the rebuild.
_SNAPSHOT_PATH = os.environ.get("RS_RANKINGS_SNAPSHOT_PATH", "/data/rs_rankings_snapshot.json")
_SNAPSHOT_MAX_AGE_S = 6 * 3600


def _disk_universe() -> list[str]:
    """The durable on-disk cap universe — `api/data/cap_universe.json`.

    ⛔ IMPORTED, NEVER RE-RESOLVED. `screener/snapshot_builder._load_universe`
    already owns "where cap_universe.json is on disk", and this repo has FOUR
    other private copies of that resolution (`routers/ticker_search`,
    `routers/admin_chart_health`, two in `main.py`). A fifth would be a fifth
    authority over one path. The import is function-local on BOTH sides — the
    builder imports this module inside `run_build` — so neither module imports
    the other at load time and there is no cycle.

    ⭐ AND IT IS DELIBERATELY THE SCREENER'S OWN LIST. The screener writes
    `rs_rank` onto exactly the rows `run_build` covers, so ranking over the same
    file makes "percentile within the universe this row belongs to" true by
    construction rather than by coincidence.
    """
    try:
        from api.services.screener.snapshot_builder import _load_universe
        return [t for t in (_load_universe() or []) if isinstance(t, str)]
    except Exception:
        logger.warning("[rs_ranking] on-disk universe unavailable", exc_info=True)
        return []


def _get_universe() -> list[str]:
    """Return the stock universe for RS ranking.

    Prefers cap_universe from wire_data ($300M+ market cap stocks pushed by the
    morning wire engine); falls back to the on-disk `cap_universe.json` when the
    push has not landed.

    🔴 THE FALLBACK EXISTS BECAUSE THE CACHE IS NOT A STORE. `wire_data` is a
    23h TTLCache entry seeded from a volume file, and on 2026-08-09 that file on
    this box was a 241-byte stub dated 2026-02-22 carrying `cap_universe: []`.
    So `compute_rs_scores` logged "No universe available" and returned `[]` —
    forever — and every consumer of RS (`groups_gates`, `/api/rs-rankings`, and
    the screener's `rs_rank` column) read an empty answer that looked exactly
    like "no strong names today". The disk list is the same population, versioned
    in the repo, identical on every pod.

    ⚠️ WHICH SOURCE ANSWERED IS LOGGED, not inferred. A percentile is only
    meaningful against a stated population; a silent switch between two
    populations is how a rank starts meaning two things.
    """
    wire = cache.get("wire_data") or {}

    # cap_universe is a sorted list of tickers with $300M+ market cap
    universe = [t for t in list(wire.get("cap_universe") or []) if isinstance(t, str)]
    source = "wire_data"

    if not universe:
        universe = _disk_universe()
        source = "cap_universe.json"

    if not universe:
        return []

    # Always include UCT20 leadership stocks even if cap_universe is missing
    leadership = wire.get("leadership", [])
    if isinstance(leadership, list):
        lead_tickers = set()
        for item in leadership[:20]:
            sym = item.get("ticker") or item.get("sym") or item.get("symbol")
            if sym:
                lead_tickers.add(sym.upper())
        # Prepend leadership tickers if not already in universe
        uni_set = set(universe)
        for t in lead_tickers:
            if t not in uni_set:
                universe.append(t)

    logger.info("[rs_ranking] universe source=%s n=%d", source, len(universe))
    return universe


def _compute_returns(ticker: str) -> dict | None:
    """Fetch 6 months of daily bars and compute weighted returns.

    Returns dict with ticker, rs_score, and period returns, or None on failure.

    ⛔ THE WEIGHTING AND THE MISSING-PERIOD RULE ARE NOT DECIDED HERE — see
    ``api/services/rs_weighted_return.py``. This function used to substitute the
    3-month return for a missing 6-month one (handing 3m 60% of the weight) and
    ``0`` for a missing 1-month or 1-week one (a fabricated flat return), while
    ``research.ratings`` renormalised — **32.40 vs 28.00 on identical inputs**.
    The score and the four returns beside it now come from ONE derivation, so
    ``snapshot_builder.rs_fields``'s claim that ``rs_return`` is the same
    quantity ``ratings`` computes is true rather than aspirational.

    ⚠️ THE FETCH WINDOW IS THIN AND SAYS SO. ``timedelta(days=200)`` is ≈138
    trading days against the 127 closes ``6m`` needs — about 11 sessions of
    slack. Under the substituting rule a provider gap silently dropped the name
    onto the 3m path with nothing logged; under renormalisation it now scores on
    the terms that resolved, which is honest but still short. Widening the window
    is a separate, measured change.
    """
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=200)).strftime("%Y-%m-%d")

    bars = get_agg_bars(ticker, from_date, to_date)
    if not bars or len(bars) < 10:
        return None

    closes = [b["c"] for b in bars]
    current = closes[-1]
    if current <= 0:
        return None

    returns = rs_weighted_return.period_returns(closes)
    raw_score = rs_weighted_return.weighted_from_returns(returns)
    # No 3-month term ⇒ no RS return. Stated in one place; honoured here.
    if raw_score is None:
        return None

    return {
        "ticker": ticker,
        "raw_score": raw_score,
        # ⛔ DERIVED FROM THE SAME DICT THE SCORE WAS BUILT FROM, never a second
        # lookup: a payload that re-derives what it was handed is how a reported
        # return starts disagreeing with the score beside it.
        "returns": {
            label: (None if returns[label] is None else round(returns[label], 2))
            for label in returns
        },
    }


def compute_rs_scores(force: bool = False) -> list[dict]:
    """Compute RS scores and percentile ranks for the full universe.

    Returns list of {ticker, rs_score, rs_rank, returns: {1w, 1m, 3m, 6m}}
    sorted by rs_rank descending (best first).

    Results cached for 1 hour. `force=True` recomputes even if cached — used by
    the background re-warmer so the cache never lapses cold onto a real request.
    """
    cached = _rs_cache.get(_CACHE_KEY)
    if cached is not None and not force:
        return cached

    universe = _get_universe()
    if not universe:
        logger.warning("[rs_ranking] No universe available — wire_data may not be loaded")
        return []

    logger.info(f"[rs_ranking] Computing RS scores for {len(universe)} stocks...")

    # Fetch bars and compute returns in parallel
    results = []
    max_workers = min(len(universe), 12)  # Conservative for Railway

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_compute_returns, t): t for t in universe}
        for future in as_completed(futures):
            try:
                result = future.result()
                if result is not None:
                    results.append(result)
            except Exception:
                pass

    if not results:
        logger.warning("[rs_ranking] No valid results computed")
        return []

    # Sort by raw_score to assign percentile ranks
    results.sort(key=lambda x: x["raw_score"])
    n = len(results)

    ranked = []
    for i, item in enumerate(results):
        # Percentile rank: 1-99 scale
        percentile = max(1, min(99, round((i / max(n - 1, 1)) * 98 + 1)))
        ranked.append({
            "ticker": item["ticker"],
            "rs_score": round(item["raw_score"], 2),
            "rs_rank": percentile,
            "returns": item["returns"],
        })

    # Sort descending by rank (best RS first)
    ranked.sort(key=lambda x: x["rs_rank"], reverse=True)

    _rs_cache.set(_CACHE_KEY, ranked, ttl=_CACHE_TTL)
    _write_snapshot(ranked)
    logger.info(f"[rs_ranking] Cached {len(ranked)} RS rankings")
    return ranked


_warm_lock = threading.Lock()
_warm_inflight = False


def cached_rankings() -> list[dict] | None:
    """The ranked list from the CACHE only; ``None`` when cold. Never computes."""
    return _rs_cache.get(_CACHE_KEY)


def _write_snapshot(ranked: list[dict]) -> None:
    """Atomic (tmp + replace), best-effort: a failure costs the next boot its head start."""
    tmp = f"{_SNAPSHOT_PATH}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"computed_at": time.time(), "rankings": ranked}, fh)
        os.replace(tmp, _SNAPSHOT_PATH)
    except (OSError, TypeError, ValueError):
        logger.warning("[rs_ranking] snapshot write failed", exc_info=True)
        try:
            os.remove(tmp)
        except OSError:
            pass


def snapshot_rankings(now: float | None = None) -> list[dict] | None:
    """The last ranking written to disk if younger than _SNAPSHOT_MAX_AGE_S, else None.
    Never raises, never computes."""
    try:
        with open(_SNAPSHOT_PATH, encoding="utf-8") as fh:
            saved = json.load(fh)
        age = (now if now is not None else time.time()) - float(saved.get("computed_at") or 0)
        rows = saved.get("rankings")
        if 0 <= age <= _SNAPSHOT_MAX_AGE_S and isinstance(rows, list) and rows:
            return rows
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    return None


def kick_background_warm() -> bool:
    """Start ONE background rebuild if none is running; True if this call started it.

    ⛔ Single-flight. Measured 2026-09-30 08:08 ET (`/api/watchdog/stacks`): two
    `/api/rs-rankings` requests were EACH running the full ~3,685-ticker rebuild
    in their own request thread, 12 fetch workers apiece, during a 5 s
    event-loop stall. A cold cache must cost one rebuild, off every request."""
    global _warm_inflight
    with _warm_lock:
        if _warm_inflight:
            return False
        _warm_inflight = True

    def _run():
        global _warm_inflight
        try:
            compute_rs_scores(force=True)
        except Exception:
            logger.exception("[rs_ranking] background warm failed")
        finally:
            with _warm_lock:
                _warm_inflight = False

    threading.Thread(target=_run, name="rs-rankings-kick", daemon=True).start()
    return True


def fast_rank_map() -> dict:
    """``{TICKER: {ticker, rs_score, rs_rank, returns}}`` from the CACHE only: the
    HOURLY rank, whatever ``RS_RANK_IBD_ENABLED`` says.

    ⭐ THIS IS THE ONE PLACE THE RANKINGS ARE SHAPED FOR A BY-SYMBOL READER, and
    it exists so a caller with thousands of symbols (the nightly screener build)
    does not walk the ~3,685-entry list once per ticker.

    ⛔ IT NEVER COMPUTES. The ~17s full-universe rebuild belongs to the
    background warmer (`main._start_rs_rankings_warm_background`, every 50 min
    under the 1h TTL). A build that computed on a cold cache would be a
    3,685-symbol fetch herd racing the boot warmers — the `bars_prewarm` failure
    reverted in `68392f4`. Cold cache returns ``{}``, and the caller's job is to
    COUNT that, not to hide it.

    Its one direct caller besides :func:`cached_rank_map` is
    ``rs_history.default_fast_map``, which STORES this value in the rating
    table's ``fast`` column and must never be handed the rating back.
    """
    rankings = _rs_cache.get(_CACHE_KEY)
    if not rankings:
        return {}
    out = {}
    for item in rankings:
        sym = (item.get("ticker") or "").upper()
        if sym:
            out[sym] = item
    return out


# ── one RS rating everywhere (U5a) ───────────────────────────────────────────

def rs_rank_ibd_enabled() -> bool:
    """``RS_RANK_IBD_ENABLED``, read PER CALL (only the literal ``1`` arms it), so a
    flip needs no restart and a rollback is an unset. Ledger: docs/feature_flags.json."""
    return os.environ.get("RS_RANK_IBD_ENABLED", "0") == "1"


_IBD_KEY = "rs_ibd_latest"
#: The nightly rating changes once a day (04:15 ET); five minutes is how long a
#: pod may print yesterday's number after the job writes, against ~3,700-row reads
#: per badge request without it. Its own instance for the same reason as `_rs_cache`.
_IBD_TTL = 300
_ibd_cache = TTLCache(max_size=2)

SOURCE_IBD = "ibd"
SOURCE_FAST = "fast"


def invalidate_ibd_cache() -> None:
    """Drop the memoised nightly ratings (tests, and a rerun of the nightly)."""
    _ibd_cache.invalidate(_IBD_KEY)


def _ibd_latest() -> tuple:
    """``(session, {TICKER: ibd})`` for the newest stored rating session, memoised
    for :data:`_IBD_TTL`. Read-only on ``rs_rating_history``: no table, no rows or a
    failed read is ``(None, {})`` (memoised too, so a dark store is not re-asked
    on every request), and the caller falls back to the hourly rank."""
    hit = _ibd_cache.get(_IBD_KEY)
    if hit is not None:
        return hit
    try:
        from api.services.screener import rs_history
        session, ratings = rs_history.newest_ibd_ratings()
    except Exception:                                        # noqa: BLE001 - never costs a reader
        logger.warning("[rs_ranking] nightly ratings unavailable; serving the fast rank",
                       exc_info=True)
        session, ratings = None, {}
    out = (session, dict(ratings or {}))
    _ibd_cache.set(_IBD_KEY, out, ttl=_IBD_TTL)
    return out


def _unify(items: list, *, append_missing: bool = True) -> list:
    """The overlay itself: a NEW list of NEW dicts, never the cached objects.

    An entry with a nightly row gets ``rs_rank = ibd``, ``rs_rank_source = "ibd"``,
    ``rs_rank_asof = <session>`` and keeps its hourly value as ``rs_rank_fast``;
    one without gets ``rs_rank_source = "fast"`` and nothing else changes. With
    ``append_missing`` (the by-symbol MAP, :func:`cached_rank_map`), a name rated
    in the nightly but absent from the hourly list (an ETF, which the nightly
    rates by interpolation and the chart shows a rating for) is appended with
    ``rs_score None`` and empty ``returns``, so the badge and the chart agree on
    it too. The ranked LIST (:func:`unified_rankings`) passes ``False``: such a
    row has no score and no returns, so in the RS leaders panel it is a blank
    line (RS split F3, 2026-11-10). Sorted best first like the hourly list (a
    stable sort, so equal ratings keep the hourly order).
    """
    session, ibd = _ibd_latest()
    out = []
    seen = set()
    for item in items or ():
        sym = (item.get("ticker") or "").upper()
        row = dict(item)
        rating = ibd.get(sym)
        if rating is None:
            row["rs_rank_source"] = SOURCE_FAST
        else:
            row["rs_rank_fast"] = item.get("rs_rank")
            row["rs_rank"] = rating
            row["rs_rank_source"] = SOURCE_IBD
            row["rs_rank_asof"] = session
        if sym:
            seen.add(sym)
        out.append(row)
    if append_missing:
        for sym in sorted(set(ibd) - seen):
            out.append({"ticker": sym, "rs_score": None, "rs_rank": ibd[sym], "returns": {},
                        "rs_rank_source": SOURCE_IBD, "rs_rank_asof": session})
    out.sort(key=lambda r: (r.get("rs_rank") is None, -(r.get("rs_rank") or 0)))
    return out


def unified_rankings(items: list) -> list:
    """The ranked LIST as the site should show it: ``items`` untouched (the same
    object) when the flag is off or the list is empty; the overlay otherwise.
    ``/api/rs-rankings`` and the groups gate's list read go through here.

    ⛔ The hourly list's NAMES ONLY (RS split F3): a nightly-only name (an ETF)
    is a row with no score and no returns, which the RS leaders panel shows as a
    blank line. It still answers the single-ticker lookup (the chart's badge)
    through :func:`cached_rank_map`, where the chart and the badge must agree.
    """
    if not items or not rs_rank_ibd_enabled():
        return items
    return _unify(items, append_missing=False)


def cached_rank_map() -> dict:
    """``{TICKER: entry}`` from the CACHE only, the shape every by-symbol reader
    uses (the screener build, the badge route, the groups gate, scatter, the
    notebook entry context).

    Flag off: :func:`fast_rank_map` itself, the SAME dict objects (a rail pins
    the identity). Flag on: the hourly map with the nightly rating laid over it
    (:func:`_unify`). A COLD hourly cache still answers ``{}`` either way: the
    "cold means count it, never hide it" contract of :func:`fast_rank_map` is
    what the build's compute-on-cold path keys on, and the boot warmer fills the
    cache within minutes.
    """
    fast = fast_rank_map()
    if not fast or not rs_rank_ibd_enabled():
        return fast
    out = {}
    for row in _unify(list(fast.values())):
        sym = (row.get("ticker") or "").upper()
        if sym:
            out[sym] = row
    return out


def get_rs_for_ticker(ticker: str) -> dict | None:
    """Return RS data for a single ticker from CACHED rankings only.

    Never triggers a full-universe recompute — that ~17s cost belongs to the
    background warmer, not a one-row lookup (previously a single-ticker request
    on a cold cache rebuilt all ~3,685 tickers). Returns None when cold.

    ⛔ Delegates to `cached_rank_map` rather than re-walking the list: one reader
    of the cache's shape, so a change to that shape cannot leave two lookups
    disagreeing. That is also how the badge (`/api/rs-rankings/{sym}`) gets the
    nightly rating under ``RS_RANK_IBD_ENABLED``: the map already carries it.

    Dual-class symbols are accepted in either spelling. The universe stores the
    hyphen form (``BRK-B``), and a member typing the dot form (``BRK.B``, which
    is how Massive and most brokers write it) used to get a 404.
    """
    sym = (ticker or "").strip().upper()
    ranks = cached_rank_map()
    hit = ranks.get(sym)
    if hit is None and ("." in sym or "/" in sym):
        hit = ranks.get(sym.replace(".", "-").replace("/", "-"))
    return hit
