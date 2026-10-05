import datetime
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Request, Response
from api.services.engine import (
    EARNINGS_CACHE_KEY, build_earnings, get_earnings,
    _generate_earnings_analysis, _generate_earnings_preview,
)
from api.services.earnings_estimates import get_earnings_intel
from api.services.cache import cache
from api.services.serve_stale import ServeStale, TIER_FRESH, serve_with_tier, server_timing
from api.limiter import limiter

router = APIRouter()

# TERM-082 (census rank 3): `/api/earnings` sits on a 30-minute TTL, and a miss
# runs two EarningsWhispers + two Finnhub calendar calls SEQUENTIALLY at 15 s
# timeouts each (worst ~60 s), plus the FMP fallback and a Massive overlay.
# CatalystFlow polls `/api/earnings-gaps` every 30 s and that route reads the
# same list, so the member whose poll landed after the cliff paid the rebuild.
# The last COMPLETE payload is served instead while one refresh runs behind the
# caller.
#
# Bound: 2400 s = the 1800 s TTL + 10 minutes. The slot's age counts from the
# BUILD, so it is already ~1800 s old the moment the TTL lapses; any bound at or
# under the TTL would never serve at all. The extra 10 minutes covers a refresh
# that takes the full ~60 s worst case many times over, but no more: the list
# changes around the BMO/AMC report windows as actuals land, and past the bound
# a refresh that keeps RAISING degrades to the old synchronous build rather
# than pinning the day to a pre-report list. (A refresh that returns a PARTIAL
# does not need the bound: it is written to the cache on its short TTL and is
# served from there, never from the slot.)
#
# Keyed by DATE: the payload is "today" (today's BMO, yesterday's AMC, tonight's
# AMC), so yesterday's list must never answer a stale serve after midnight.
#
# Router-level on purpose, like movers: `engine.get_earnings()` has other
# callers (the catalyst engine, which WRITES catalyst rows from it; voice and
# Compass tools; flow_explain; the analysis modal's row lookup below). They keep
# their exact behaviour: cache hit, else a synchronous build. Never a served-
# stale list.
EARNINGS_STALE_MAX_AGE = 2400
_EARNINGS_STALE = ServeStale("earnings", max_age_seconds=EARNINGS_STALE_MAX_AGE, max_keys=4)

# PUSH SEMANTICS. `/api/push` invalidates the "earnings" cache because a new
# wire changes the answer (the cap_universe filter, the wire_data fallback and
# the actuals patch all read it). What last-good means after a push:
#   * the pre-push payload stays in the slot and may be served, MARKED
#     `stale-swr`, within the bound above,
#   * but only because the push KICKS one refresh immediately
#     (`on_wire_push`), so it is the answer for the length of one rebuild, not
#     until some reader happens to notice;
#   * a build that STARTED before the push read the old wire, so its result is
#     never remembered: the build is re-run once, and its cache write is
#     dropped. `_PUSH_GEN` is how a build learns a push landed under it.
# With no last-good in the slot (nobody has read the route since boot) a push
# kicks nothing, and the first reader builds synchronously exactly as before.
_PUSH_GEN = [0]
_PUSH_GEN_LOCK = threading.Lock()


def _today() -> str:
    """Today, as `engine.build_earnings` computes it (a seam for tests)."""
    return datetime.date.today().isoformat()


def _slot_key() -> str:
    return f"earnings:{_today()}"


def _fresh_earnings():
    hit = cache.get(EARNINGS_CACHE_KEY)
    # `get_earnings`' own test is truthiness, kept so the two paths agree on
    # what a hit is. (payload, complete): a fresh cache hit is never judged.
    return (hit, True) if hit else None


def _build_for_route():
    """`build_earnings`, but never let a build that straddled a wire push
    become the answer: the pre-push wire it read is exactly what the push
    replaced."""
    data, complete = {}, False
    for _attempt in range(2):
        gen = _PUSH_GEN[0]
        data, complete = build_earnings()
        if gen == _PUSH_GEN[0]:
            return data, complete
        # A push landed mid-build. Drop the cache write this build made so the
        # next reader does not take pre-push data as fresh, and build again.
        cache.invalidate(EARNINGS_CACHE_KEY)
    # Two pushes raced two builds: serve it, never remember it.
    return data, False


def _good(result) -> bool:
    # Only a COMPLETE build becomes the fallback (cache_policy's rule): a
    # failed provider leg is served on the short TTL but never remembered.
    return bool(result) and result[1] is True


def serve_earnings():
    """The routes' read of today's earnings: `(payload, tier, stale_age_s)`."""
    served, tier, age = serve_with_tier(
        _EARNINGS_STALE, _slot_key(),
        fresh=_fresh_earnings, build=_build_for_route, good=_good,
    )
    return served[0], tier, age


def on_wire_push() -> bool:
    """Called by `/api/push` after it stores the new wire. Marks every build in
    flight as pre-push, and kicks one refresh now when there is a last-good the
    routes could be serving. Returns whether a refresh was kicked."""
    with _PUSH_GEN_LOCK:
        _PUSH_GEN[0] += 1
    key = _slot_key()
    value, age = _EARNINGS_STALE.peek(key)
    if value is None or age is None or age > _EARNINGS_STALE.max_age:
        # Nothing servable: the first reader builds synchronously, as before.
        # (Kicking here would race that reader's build: the background refresh
        # does not take the single-flight build lock.)
        return False
    _EARNINGS_STALE.kick(key, build=_build_for_route, good=_good)
    return True


@router.get("/api/earnings")
def earnings(response: Response):
    t0 = time.perf_counter()
    try:
        result, tier, age = serve_earnings()
        try:
            from api.routers.bars import warm_bars_async
            tickers = [
                e["sym"].upper()
                for bucket in (result.get("bmo") or [], result.get("amc") or [], result.get("amc_tonight") or [])
                for e in bucket if isinstance(e, dict) and e.get("sym")
            ]
            if tickers:
                warm_bars_async(list(dict.fromkeys(tickers)), tf="D", bars=8000)
        except Exception:
            pass
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    # PROD-C7: a served-stale list says so on the response, in /api/bars'
    # Server-Timing shape (`desc="stale-swr"` + the list's age).
    response.headers["Server-Timing"] = server_timing(
        "earnings", tier, (time.perf_counter() - t0) * 1000.0, age)
    return result


@router.get("/api/earnings-gaps")
def earnings_gaps(response: Response):
    """Live change_pct for all current earnings tickers. TTL 30 s.

    The Server-Timing tier names where the earnings LIST came from (the
    serve-stale read above); the prices themselves are at most 30 s old."""
    t0 = time.perf_counter()
    cached = cache.get("earnings_gaps_live")
    if cached is not None:
        response.headers["Server-Timing"] = server_timing(
            "earnings-gaps", TIER_FRESH, (time.perf_counter() - t0) * 1000.0)
        return cached

    data, tier, age = serve_earnings()
    all_syms = [e["sym"] for e in data.get("bmo", []) + data.get("amc", []) if e.get("sym")]
    if not all_syms:
        result = {}
    else:
        try:
            from api.services.massive import _get_client
            result = _get_client().get_batch_snapshots(all_syms)
        except Exception:
            result = {}

    cache.set("earnings_gaps_live", result, ttl=30)
    response.headers["Server-Timing"] = server_timing(
        "earnings-gaps", tier, (time.perf_counter() - t0) * 1000.0, age)
    return result


@router.get("/api/debug/earnings-sources/{sym}")
def debug_earnings_sources(sym: str):
    """Diagnostic: hit each earnings-data source and report status + sample.

    Use to see why preview_text/beat_streak/etc are empty. Shows which of FMP,
    Alpha Vantage, Finnhub, Anthropic returns usable data for this ticker.
    """
    import os, requests
    sym = sym.upper()
    out = {}

    fmp_key = os.environ.get("FMP_API_KEY", "")
    av_key = os.environ.get("ALPHAVANTAGE_API_KEY", "")
    fh_key = os.environ.get("FINNHUB_API_KEY", "")
    ant_key = os.environ.get("ANTHROPIC_API_KEY", "")

    out["env"] = {
        "FMP_API_KEY":         "set" if fmp_key else "MISSING",
        "ALPHAVANTAGE_API_KEY":"set" if av_key else "MISSING",
        "FINNHUB_API_KEY":     "set" if fh_key else "MISSING",
        "ANTHROPIC_API_KEY":   "set" if ant_key else "MISSING",
    }

    # Test each FMP earnings endpoint variant
    fmp_tests = [
        ("v3/earnings-surprises", f"https://financialmodelingprep.com/api/v3/earnings-surprises/{sym}?apikey={fmp_key}"),
        ("stable/earnings-surprises", f"https://financialmodelingprep.com/stable/earnings-surprises?symbol={sym}&apikey={fmp_key}"),
        ("v3/historical/earning_calendar", f"https://financialmodelingprep.com/api/v3/historical/earning_calendar/{sym}?apikey={fmp_key}"),
        ("stable/earnings", f"https://financialmodelingprep.com/stable/earnings?symbol={sym}&limit=12&apikey={fmp_key}"),
        ("stable/historical-earning-calendar", f"https://financialmodelingprep.com/stable/historical-earning-calendar?symbol={sym}&limit=12&apikey={fmp_key}"),
        ("stable/analyst-estimates?period=quarter", f"https://financialmodelingprep.com/stable/analyst-estimates?symbol={sym}&period=quarter&limit=8&apikey={fmp_key}"),
        ("stable/analyst-estimates?period=annual", f"https://financialmodelingprep.com/stable/analyst-estimates?symbol={sym}&period=annual&limit=8&apikey={fmp_key}"),
        ("stable/grades", f"https://financialmodelingprep.com/stable/grades?symbol={sym}&limit=8&apikey={fmp_key}"),
        ("stable/grades-consensus", f"https://financialmodelingprep.com/stable/grades-consensus?symbol={sym}&apikey={fmp_key}"),
        ("stable/grades-historical", f"https://financialmodelingprep.com/stable/grades-historical?symbol={sym}&limit=4&apikey={fmp_key}"),
        ("stable/price-target-consensus", f"https://financialmodelingprep.com/stable/price-target-consensus?symbol={sym}&apikey={fmp_key}"),
        ("stable/price-target-summary", f"https://financialmodelingprep.com/stable/price-target-summary?symbol={sym}&apikey={fmp_key}"),
        ("stable/price-target-news", f"https://financialmodelingprep.com/stable/price-target-news?symbol={sym}&limit=5&apikey={fmp_key}"),
        ("v3/analyst-estimates", f"https://financialmodelingprep.com/api/v3/analyst-estimates/{sym}?period=quarter&limit=8&apikey={fmp_key}"),
        ("inst/positions-summary-2026q1", f"https://financialmodelingprep.com/stable/institutional-ownership/symbol-positions-summary?symbol={sym}&year=2026&quarter=1&apikey={fmp_key}"),
        ("inst/positions-summary-2025q4", f"https://financialmodelingprep.com/stable/institutional-ownership/symbol-positions-summary?symbol={sym}&year=2025&quarter=4&apikey={fmp_key}"),
        ("inst/holder-analytics-2025q4", f"https://financialmodelingprep.com/stable/institutional-ownership/extract-analytics/holder?symbol={sym}&year=2025&quarter=4&page=0&limit=3&apikey={fmp_key}"),
        ("inst/latest", f"https://financialmodelingprep.com/stable/institutional-ownership/latest?page=0&limit=2&apikey={fmp_key}"),
    ]
    # Rich dump of the live stable/earnings endpoint (what get_year_earnings uses)
    # so we can confirm revenueActual is populated for PAST quarters, not just
    # the future sample.
    if fmp_key:
        try:
            rr = requests.get(
                f"https://financialmodelingprep.com/stable/earnings?symbol={sym}&limit=12&apikey={fmp_key}",
                timeout=8,
            )
            if rr.status_code == 200 and isinstance(rr.json(), list):
                out["fmp_stable_earnings_dump"] = [
                    {k: e.get(k) for k in ("date", "epsActual", "epsEstimated", "revenueActual", "revenueEstimated")}
                    for e in rr.json()[:12]
                ]
            else:
                out["fmp_stable_earnings_dump"] = f"{rr.status_code}: {rr.text[:160]}"
        except Exception as e:
            out["fmp_stable_earnings_dump"] = f"err: {e}"

    out["fmp"] = {}
    if fmp_key:
        for name, url in fmp_tests:
            try:
                r = requests.get(url, timeout=8)
                body = r.text[:200] if r.status_code != 200 else None
                if r.status_code == 200:
                    try:
                        data = r.json()
                        if isinstance(data, list):
                            out["fmp"][name] = f"OK list[{len(data)}]" + (f" sample={data[0]}" if data else "")
                        elif isinstance(data, dict):
                            out["fmp"][name] = f"OK dict keys={list(data.keys())[:5]}"
                        else:
                            out["fmp"][name] = f"OK type={type(data).__name__}"
                    except Exception as je:
                        out["fmp"][name] = f"200 but JSON parse failed: {je}"
                else:
                    out["fmp"][name] = f"{r.status_code}: {body}"
            except Exception as e:
                out["fmp"][name] = f"exception: {e}"

    # Test AV
    if av_key:
        try:
            r = requests.get(f"https://www.alphavantage.co/query?function=EARNINGS&symbol={sym}&apikey={av_key}", timeout=10)
            data = r.json()
            if data.get("quarterlyEarnings"):
                out["av"] = f"OK quarters={len(data['quarterlyEarnings'])}"
            else:
                out["av"] = f"empty/error: {str(data)[:200]}"
        except Exception as e:
            out["av"] = f"exception: {e}"

    # Test Anthropic with a one-line haiku call
    if ant_key:
        try:
            from api.services.engine import _get_anthropic_client
            client = _get_anthropic_client()
            msg = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=20,
                metadata={"user_id": "earnings_ping_test:global"},
                messages=[{"role": "user", "content": "Say 'pong' and nothing else."}],
            )
            out["anthropic"] = f"OK: {msg.content[0].text[:50]}"
        except Exception as e:
            out["anthropic"] = f"exception: {type(e).__name__}: {e}"

    # Test FMP earnings-call transcript (FMP Ultimate) — shape probe
    if fmp_key:
        for name, url in [
            ("fmp_transcript_dates", f"https://financialmodelingprep.com/stable/earning-call-transcript-dates?symbol={sym}&apikey={fmp_key}"),
        ]:
            try:
                r = requests.get(url, timeout=12)
                if r.status_code != 200:
                    out[name] = f"{r.status_code}: {r.text[:160]}"
                    continue
                data = r.json()
                if isinstance(data, list) and data:
                    first = data[0]
                    if isinstance(first, dict):
                        keys = list(first.keys())
                        content = str(first.get("content") or "")
                        out[name] = {"len": len(data), "keys": keys,
                                     "content_chars": len(content),
                                     "content_head": content[:300]}
                    else:
                        out[name] = f"list[{len(data)}] sample={str(first)[:200]}"
                else:
                    out[name] = f"OK type={type(data).__name__} {str(data)[:160]}"
            except Exception as e:
                out[name] = f"exception: {e}"

    # Test Finnhub transcript availability — routed through the shared
    # finnhub_client.fh_get (2026-08-05) so this diagnostic probe shares the
    # process-wide token bucket / 429 cooldown instead of spending the same
    # account budget uncoordinated.
    if fh_key:
        try:
            from api.services.finnhub_client import fh_get
            data = fh_get("/stock/transcripts/list", {"symbol": sym}, timeout=8)
            if isinstance(data, dict):
                tr_count = len(data.get("transcripts", []))
                out["finnhub_transcripts"] = f"OK count={tr_count}" if tr_count else f"empty: {str(data)[:200]}"
            else:
                out["finnhub_transcripts"] = "budget-shed or failed (see logs)"
        except Exception as e:
            out["finnhub_transcripts"] = f"exception: {e}"

    return out


@router.get("/api/earnings/intel/{ticker}")
def earnings_intel(ticker: str):
    """Analyst consensus, EPS beat history, and price targets for a ticker.

    ⚠️ NOT a duplicate of `/api/earnings-intel/{ticker}` (fundamentals.py), despite
    the name (audit L12, 2026-10-05). This route serves
    `earnings_estimates.get_earnings_intel` (consensus / beat_history / price
    targets); that one serves `earnings_intel.get_earnings` (the normalized
    quarters / estimates / annual / summary model). Different payloads, both with
    live callers: this one from research/hooks/useResearchOverview.js, that one
    from the chart dock, ChartEarningsStrip and useLatestReport. A redirect
    either way would hand a caller the wrong shape."""
    ticker = ticker.upper()
    try:
        result = get_earnings_intel(ticker)
        if result is None:
            raise HTTPException(status_code=404, detail=f"No earnings intel available for {ticker}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


_logger = logging.getLogger(__name__)

# ── Click-path generation pool ───────────────────────────────────────────────
# `?background=1` is what the earnings modal's Brief section sends. A cold name
# used to pin the request thread for the 25-40s a Sonnet generation takes (the
# documented 524-outage class — see engine._fetch_quarterly_history) while the
# modal showed a grey box. Now the request answers in milliseconds with
# `generating: True`, the generator runs on this bounded pool (in-flight
# dedupe: ONE generation per name no matter how many viewers poll), and the
# client re-polls the same URL until the generators' own mem/disk caches
# answer. The synchronous default is unchanged for every other consumer
# (useResearchOverview on /research, scripts, tests).
_CLICK_WORKERS = int(os.environ.get("EARNINGS_CLICK_WORKERS", "3") or 3)
_CLICK_POOL = ThreadPoolExecutor(max_workers=_CLICK_WORKERS, thread_name_prefix="earn-click")
_inflight: set = set()
_inflight_lock = threading.Lock()


def _empty_analysis(sym: str, **extra) -> dict:
    return {
        "sym": sym, "cached": False,
        "analysis": None, "analysis_headline": None, "analysis_summary": None,
        "analysis_bullets": [], "preview_text": "", "preview_bullets": [],
        "beat_history": [], "yoy_eps_growth": None, "beat_streak": None,
        "news": [], "key_quotes": [],
        **extra,
    }


def _cached_for(kind: str, sym: str):
    """Memory, then the disk store (which survives redeploys), hydrating memory
    on a disk hit. FREE — no provider work. Until 2026-08-21 the stepping probe
    read memory only, so after every redeploy a name with a perfectly good
    brief on disk rendered "No brief generated yet"."""
    from api.services import earnings_ai_store
    from api.services.engine import _EARNINGS_CACHE_TTL_HIT
    key = f"earnings_{kind}_v2_{sym}"
    hit = cache.get(key)
    if hit:
        return hit
    disk = earnings_ai_store.get(kind, sym)
    if disk:
        cache.set(key, disk, ttl=_EARNINGS_CACHE_TTL_HIT)
        return disk
    return None


def _resolve_row(sym: str):
    """The earnings row for this sym (context for the generators). Today's
    bmo/amc first, then the weekly calendar for future-dated reports (e.g. a
    click on AMT before its report date — not in today's data but on the
    calendar). None for an unknown name."""
    try:
        data = get_earnings()
    except Exception:
        data = {}

    row = None
    for bucket in ("bmo", "amc", "amc_tonight"):
        for entry in data.get(bucket, []):
            if entry.get("sym") == sym:
                row = entry
                break
        if row:
            break
    if row is not None:
        return row

    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data() or {}
        cal = wire.get("weekly_calendar") or {}
        for date_str, day in cal.items():
            if not isinstance(day, dict):
                continue
            for bucket in ("bmo", "amc"):
                for entry in day.get(bucket, []) or []:
                    if isinstance(entry, dict) and entry.get("sym") == sym:
                        row = dict(entry)
                        # Future earnings → mark pending so preview path is used
                        row.setdefault("verdict", "Pending")
                        return row
    except Exception:
        pass
    return None


def _is_pending(row) -> bool:
    # Pending if explicitly marked OR if no reported_eps yet (a future report
    # with no verdict set) OR unknown sym (still try a preview — useful output).
    return (
        row is None
        or (row.get("verdict") or "").lower() == "pending"
        or row.get("reported_eps") is None
    )


def _is_unpreviewable_fund(sym: str, row) -> bool:
    """A name with no consensus that looks like a fund — the WARM's own rule,
    imported rather than restated.

    ⛔ BOTH halves matter. `_looks_like_a_fund` alone would deny a brief to
    BlackRock, which shares its industry with the funds it runs; the consensus
    check is what separates a real asset manager (the street publishes an
    estimate) from a closed-end fund (nobody does). This mirrors
    `earnings_preview_warm._rank` exactly, because the click path and the warm
    disagreeing about who deserves a preview is how a name ends up permanently
    cold on one path and permanently re-billed on the other."""
    try:
        from api.services.earnings_preview_warm import has_consensus, _looks_like_a_fund
        if has_consensus(row or {}):
            return False
        return _looks_like_a_fund(sym)
    except Exception:
        return False        # unknown → generate, the same direction as the warm


def _kick_generation(sym: str, row, pending: bool) -> bool:
    """Run the generator on the click pool unless one is already in flight for
    this name. Returns whether a NEW job was started."""
    with _inflight_lock:
        if sym in _inflight:
            return False
        _inflight.add(sym)

    def _job():
        try:
            gen = _generate_earnings_preview if pending else _generate_earnings_analysis
            gen(sym, row or {"sym": sym})
        except Exception as e:
            _logger.warning("background earnings AI failed for %s: %s", sym, e)
        finally:
            with _inflight_lock:
                _inflight.discard(sym)

    _CLICK_POOL.submit(_job)
    return True


@router.get("/api/earnings-analysis/{sym}")
@limiter.limit("60/minute")
def earnings_analysis(request: Request, sym: str, cached_only: bool = False,
                      background: bool = False, force: bool = False):
    sym = sym.upper()

    # §4.3.3 / §7: arrow-key stepping across a 40-name day must never auto-fire
    # the LLM path. `cached_only=1` answers ONLY from the caches the generators
    # write (memory, then disk) and returns `cached: false` instead of
    # generating — the Brief section then renders a "Generate brief"
    # affordance. This branch does no provider work at all (not even the row
    # lookup), which is what makes it safe to fire on every step.
    if cached_only:
        for kind in ("analysis", "preview"):
            hit = _cached_for(kind, sym)
            if hit:
                return {**hit, "cached": True}
        return _empty_analysis(sym)

    row = _resolve_row(sym)
    pending = _is_pending(row)
    hit = _cached_for("preview" if pending else "analysis", sym)
    if hit:
        return {**hit, "cached": True}

    # The modal's path: answer NOW, generate on the pool, let the client poll.
    if background:
        # A closed-end fund reports on the calendar and has no earnings story:
        # no segments, no guidance, no consensus anyone publishes. The WARM has
        # skipped these deliberately since 2026-08-24; the click path did not
        # know, so opening one bought a ~30s generation of a preview nobody
        # wants — the last surface on this modal that was not instant.
        #
        # ⛔ `force` is what keeps this from being a refusal: pressing
        # "Generate brief" sends it and still generates. Only the AUTOMATIC
        # spend goes away, and the reader keeps the choice. Returning the empty
        # shape (`cached: false`) is what makes the section render that button.
        if not force and _is_unpreviewable_fund(sym, row):
            return _empty_analysis(sym)
        _kick_generation(sym, row, pending)
        return _empty_analysis(sym, generating=True)

    try:
        if pending:
            return _generate_earnings_preview(sym, row or {"sym": sym})
        return _generate_earnings_analysis(sym, row)
    except Exception as e:
        # Anthropic API or other transient failure — return graceful fallback
        return {
            "sym": sym,
            "analysis": None,
            "analysis_headline": None,
            "analysis_summary": None,
            "analysis_bullets": [],
            "preview_text": "",
            "preview_bullets": [],
            "beat_history": [],
            "yoy_eps_growth": None,
            "beat_streak": None,
            "news": [],
            "error": str(e),
        }


@router.get("/api/chart/markers/{ticker}")
@router.get("/api/chart-markers/{ticker}")
def chart_markers_endpoint(ticker: str, days: int = 730):
    """Earnings beat/miss history + stock splits + dividends for chart annotation.

    `days` filters output to events within the last N calendar days
    (1 ≤ days ≤ 36500). The underlying fetch pulls full available history
    (earnings back to inception, splits ~45yr) so the per-ticker cache entry
    serves both short and since-inception chart ranges; we only post-filter
    the cached result here. Charts request a large window to load all markers
    alongside the full price history.
    """
    from datetime import date, timedelta
    from api.services.earnings_estimates import get_chart_markers

    days = max(1, min(int(days or 730), 36500))
    cutoff = (date.today() - timedelta(days=days)).isoformat()

    raw = get_chart_markers(ticker.upper()) or {}
    return {
        "earnings":  [e for e in (raw.get("earnings")  or []) if (e.get("date") or "") >= cutoff],
        "splits":    [s for s in (raw.get("splits")    or []) if (s.get("date") or "") >= cutoff],
        "dividends": [d for d in (raw.get("dividends") or []) if (d.get("date") or "") >= cutoff],
    }
