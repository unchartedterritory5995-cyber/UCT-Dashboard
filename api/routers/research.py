"""Research page endpoints (`/api/research/*`)."""
from __future__ import annotations

import logging
import threading
import time

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Body, Depends, HTTPException

from api.middleware.auth_middleware import require_admin, get_current_user
from api.services import boot_probe
from api.services.research.financials import get_financials
from api.services.research.estimates import get_estimates
from api.services.research.analyst_ratings import get_analyst_ratings
from api.services.research.news import get_company_news
from api.services.research.ownership import get_ownership
from api.services import edgar_ownership
from api.services.ticker_resolver import comparator_path, sym_path
from api.services.ticker_explain import explain_recent_activity
from api.services.research.ratings import get_ratings
from api.services.research.snapshot import get_snapshot
from api.services.research.comparison import get_comparison
from api.services.research.comparison_ai_adapter import explain_comparison

_logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/about/{sym}")
def company_about_endpoint(sym: str = Depends(sym_path), _user: dict = Depends(get_current_user)):
    """Company 'About' tab: FMP profile facts + peers + a cached AI trader brief.

    Powers the ticker-popup About tab. Logged-in gate (it can trigger one Haiku
    call), but the brief is cached 30d per ticker so cost is bounded regardless.
    Fail-soft end to end — a missing brief just renders facts only.
    """
    from api.services import company_about
    return company_about.get_about(sym)


@router.get("/api/research/news/{sym}")
def research_news(sym: str = Depends(sym_path), limit: int = 20):
    """Company news + press releases, newest first, merged into one feed.

    Two FMP endpoints because they carry different things — wire coverage and
    the company's own announcements — and a reader wants them interleaved by
    time, not separated by origin. Each item keeps its `kind` so the UI can
    still tell them apart.

    Fetched concurrently: they are independent, and in series a cold open costs
    their sum.
    """
    sym = (sym or "").upper().strip()
    if not sym:
        return {"sym": "", "items": []}
    try:
        from concurrent.futures import ThreadPoolExecutor
        from api.services.cache import cache
        from api.services.earnings_estimates import _fmp_get

        ck = f"research_news::{sym}::{limit}"
        hit = cache.get(ck)
        if hit is not None:
            return hit

        n = max(1, min(int(limit or 20), 50))
        jobs = {"news": "/stable/news/stock",
                "release": "/stable/news/press-releases"}
        got = {}
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="news") as ex:
            futs = {kind: ex.submit(_fmp_get, path, {"symbols": sym, "limit": n},
                                    timeout=12)
                    for kind, path in jobs.items()}
            for kind, f in futs.items():
                try:
                    got[kind] = f.result()
                except Exception:
                    got[kind] = None

        items = []
        for kind, rows in got.items():
            for r in (rows or []):
                if not isinstance(r, dict) or not r.get("title"):
                    continue
                items.append({
                    "kind": kind,
                    "title": r.get("title"),
                    "publisher": r.get("publisher") or r.get("site"),
                    "url": r.get("url"),
                    "published": r.get("publishedDate"),
                    "image": r.get("image"),
                    # FMP truncates this to the lede; enough for a preview line
                    # and explicitly NOT presented as the article.
                    "summary": (r.get("text") or "")[:280],
                })
        # Sort DESC on the raw ISO string: these are same-format timestamps from
        # one provider, so a string sort is the date sort and needs no parsing.
        items.sort(key=lambda x: x.get("published") or "", reverse=True)
        out = {"sym": sym, "items": items[:n]}
        cache.set(ck, out, 900)      # 15 min — news moves, but not per-request
        return out
    except Exception as exc:
        _logger.warning("research news failed for %s: %s", sym, exc)
        return {"sym": sym, "items": []}


@router.get("/api/research/company-news/{sym}")
def research_company_news(sym: str = Depends(sym_path)):
    """The canonical, S3/D1/S8-wired News tab on /research/:sym (A8 Slice 1,
    2026-09-04, owner-authorized narrow slice). Deliberately a NEW route,
    not a rewrite of `/api/research/news/{sym}` above -- that route stays
    byte-for-byte untouched as a COMPATIBILITY BRIDGE for the calendar
    modal's NewsSection.jsx, per the readiness review's explicit "do not
    touch a working legacy consumer" instruction.
    """
    try:
        out = get_company_news(sym)
    except Exception as exc:
        _logger.warning("research company-news failed for %s: %s", sym, exc)
        out = {"_outage": True}
    if out.get("_outage"):
        # A failed read is not an empty feed (quality pass 2026-10-05): the tab renders a 503 as
        # "couldn't load" with Retry, and a 200 with no items as "no recent news".
        raise HTTPException(status_code=503, detail="Company news could not be read right now.")
    return out


@router.post("/api/research/explain/{sym}")
def research_explain(sym: str = Depends(sym_path), body: dict = Body(...), _user: dict = Depends(get_current_user)):
    """AI-Native Research Assistant Slice 1 + Security Research Q&A Slice 2
    + Slice 3 (I1, owner-authorized, 2026-09-04) -- the "Ask AI" tab's
    endpoint. Auth-required: unlike the plain GET research routes, this one
    makes a real LLM call with real cost (see ticker_explain.py's own
    narrative_cost_guard use), so an anonymous caller must not be able to
    reach it.

    Slice 3: `history` is the CLIENT's own rolling array of prior-turn
    structured state (never server-persisted -- see `ticker_explain.
    _clean_history`'s docstring for the full entity-isolation/size-cap
    contract this endpoint delegates to). Passed through as-is; malformed or
    missing history degrades to plain single-turn behavior, never an error.
    """
    question = str((body or {}).get("question") or "")[:500]
    history = body.get("history") if isinstance((body or {}).get("history"), list) else None
    try:
        return explain_recent_activity(sym, question, history=history)
    except Exception as exc:
        _logger.warning("ticker explain failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "entity": None, "response_state": "refuse",
                "summary": "", "key_facts": [], "interpretation": "", "caveat": "",
                "clarification_question": "", "citations": [],
                "insufficient_evidence": True,
                "insufficient_evidence_reason": "The AI assistant is temporarily unavailable.",
                "model": None, "error": "internal error",
                "turn_state": {"sym": (sym or "").upper(), "question": question,
                              "response_state": "refuse", "domains": [], "summary": ""}}


@router.get("/api/research/quote/{sym}")
def research_quote(sym: str = Depends(sym_path)):
    """The session line — price, change, OHLC, volume, 52-week range.

    Its own route rather than a widening of /api/fundamentals: that endpoint is
    a shared trio (quote + key-metrics + ratios) consumed by several surfaces,
    and this needs four fields it does not expose. One FMP call, cached briefly
    because it IS the live number.
    """
    sym = (sym or "").upper().strip()
    if not sym:
        return None
    try:
        from api.services.cache import cache
        from api.services import fmp_client as _fmp
        from api.services import provider_degraded as _degraded
        ck = f"research_quote::{sym}"
        hit = cache.get(ck)
        if hit is not None:
            return hit
        try:
            rows = _fmp.get_quote(sym, timeout=10).value
        except Exception as exc:            # noqa: BLE001 -- every D1 typed error
            # ⛔ DEGRADED IS NOT ABSENT. Before this, an outage returned `null`
            # at 200 -- indistinguishable from "this ticker has no quote", so a
            # member could not tell a provider failure from a quiet name. The
            # empty shape is preserved EXACTLY (every key present, every value
            # None, so a client reading `.price` is unchanged); the envelope is
            # ADDITIVE beside it. ⛔ Never a 500.
            _logger.warning("research quote degraded for %s: %s", sym, exc)
            return {"sym": sym, "price": None, "change": None, "change_pct": None,
                    "open": None, "high": None, "low": None, "prev_close": None,
                    "volume": None, "year_high": None, "year_low": None,
                    "market_cap": None,
                    "provenance": _degraded.envelope(exc, activity="research.quote")}
        if not isinstance(rows, list) or not rows:
            # ⭐ Genuinely absent stays `None`, unchanged -- a caller checking
            # truthiness keeps its meaning for "no data". Only the DEGRADED case
            # gains a body.
            return None
        q = rows[0] or {}
        out = {
            "sym": sym,
            "price": q.get("price"),
            "change": q.get("change"),
            "change_pct": q.get("changePercentage"),
            "open": q.get("open"),
            "high": q.get("dayHigh"),
            "low": q.get("dayLow"),
            "prev_close": q.get("previousClose"),
            "volume": q.get("volume"),
            "year_high": q.get("yearHigh"),
            "year_low": q.get("yearLow"),
            "market_cap": q.get("marketCap"),
        }
        cache.set(ck, out, 60)      # 60s: live enough, and it is one call
        return out
    except Exception as exc:
        _logger.warning("research quote failed for %s: %s", sym, exc)
        return None


# A FUND IS NOT A COMPANY. FA / EE / ANR answer a fund with empty records the panels render
# as generic "no data"; each now also carries the shared, ADDITIVE fund marker
# (`ticker_search_index.fund_not_applicable`: `not_applicable: "fund"` + `reason`) so a panel
# can say why. The vendors are still read and the payload keeps its shape: an index that
# mis-types a company as an ETF must not blank real data. RTG is the exception -- its composite
# for a fund is a number built from price inputs alone, so it answers not_applicable outright.
# Unknown type (index not built yet, symbol not in it) is never "fund".
def _fund_marked(out, sym, why):
    from api.services.ticker_search_index import fund_not_applicable
    na = fund_not_applicable(sym, why)
    return {**out, **na} if na and isinstance(out, dict) else out


_FA_FUND_WHY = "funds report no company income statement, balance sheet or cash flow"
_EE_FUND_WHY = "analysts publish no earnings or revenue estimates for a fund"
_ANR_FUND_WHY = "funds carry no sell-side analyst ratings or price targets"
_RTG_FUND_WHY = ("the UCT composite rates a company's earnings, growth, margins and value, "
                 "which a fund does not have")


@router.get("/api/research/financial-history/{sym}")
def research_financial_history(sym: str = Depends(sym_path), period: str = "quarter"):
    """Deep statement series for the fundamentals panels (24q / 12y).

    Separate from /financials, which returns a 5-row grid from yfinance — five
    points cannot show a cycle.
    """
    try:
        from api.services.research.financial_history import get_history
        return _fund_marked(get_history(sym, period=period), sym, _FA_FUND_WHY)
    except Exception as exc:
        _logger.warning("financial history failed for %s: %s", sym, exc)
        # `fmp_unavailable`: the read FAILED. Without it the panel said "FMP holds no statement
        # history for this ticker" - a claim about the company (quality pass 2026-10-05).
        return _fund_marked({"sym": (sym or "").upper(), "period": period,
                             "periods": [], "series": {}, "fmp_unavailable": True}, sym, _FA_FUND_WHY)


@router.get("/api/research/financials/{sym}")
def research_financials(sym: str = Depends(sym_path)):
    try:
        return _fund_marked(get_financials(sym), sym, _FA_FUND_WHY)
    except Exception as exc:
        _logger.warning("research financials failed for %s: %s", sym, exc)
        return _fund_marked({"sym": (sym or "").upper(), "annual": [], "quarterly": [],
                             "balance": {}, "metrics": {}}, sym, _FA_FUND_WHY)


#: An EE consensus open slower than this logs one `[ee-slow]` line naming its legs.
_SLOW_EE_SECONDS = 5.0


def _timed(legs: dict, name: str, fn, *args):
    """Run `fn(*args)` and record its wall time in `legs[name]`, raise or return.
    The leg thread is TRACKED (`boot_probe.track`), so a leg still running at 10 s / 30 s /
    90 s gets its stack dumped as a `[slow-stack] ee-<name> ...` line -- the frame it is
    parked in is the answer the `[ee-slow]` line alone could not give (2026-10-06)."""
    t0 = time.monotonic()
    try:
        with boot_probe.track(f"ee-{name} {(args[0] if args else '')}"):
            return fn(*args)
    finally:
        legs[name] = time.monotonic() - t0


@router.get("/api/research/estimates/{sym}")
def research_estimates(sym: str = Depends(sym_path), consensus: int = 0):
    """yfinance forward estimates + revisions. `?consensus=1` (the terminal's EE
    panel, and the research tab when RESEARCH_FMP_DEPTH_ENABLED is on) adds the
    FMP multi-year consensus beside them, read CONCURRENTLY with the yfinance leg
    so a cold load costs the slower of the two, not their sum. Without the
    parameter the response is exactly what it always was."""
    # Route-entry line, first 10 min after boot only, BEFORE any import or lock: proves
    # whether the handler started at all when a boot-window open stalls.
    t_start = time.monotonic()
    if boot_probe.in_entry_window():
        _logger.info("[ee-enter] %s consensus=%s boot+%.0fs threads=%d",
                     (sym or "").upper(), consensus, boot_probe.boot_age(),
                     threading.active_count())
    if not consensus:
        try:
            return _fund_marked(get_estimates(sym), sym, _EE_FUND_WHY)
        except Exception as exc:
            _logger.warning("research estimates failed for %s: %s", sym, exc)
            return _fund_marked({"sym": (sym or "").upper(), "entity": None, "forward": [],
                                 "revisions": []}, sym, _EE_FUND_WHY)

    t_imp = time.monotonic()
    from api.services.research.estimates_consensus import get_consensus
    t_imp = time.monotonic() - t_imp
    # Slow-open trace (2026-10-06 boot contention): three opens of TSM EE hung 102 / 47 / 5 s
    # and released within 7 ms of each other, and no log line said what they waited on. A
    # slow answer now names its legs and whether the estimates key was already in flight.
    est_key = f"research_est::{(sym or '').upper().strip()}"
    try:
        from api.services import single_flight as _sf
        in_flight_at_entry = est_key in _sf.inflight_keys()
    except Exception:                                    # noqa: BLE001 -- a trace never fails a read
        in_flight_at_entry = None
    legs: dict = {}
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="ee-route") as ex:
        f_yf = ex.submit(_timed, legs, "yf", get_estimates, sym)
        f_fmp = ex.submit(_timed, legs, "fmp", get_consensus, sym)
        try:
            out = dict(f_yf.result() or {})
        except Exception as exc:
            _logger.warning("research estimates failed for %s: %s", sym, exc)
            # `yf_unavailable`: the Yahoo leg FAILED, so an empty forward list is not a finding
            # (the EE panel said "Neither FMP nor Yahoo Finance holds forward estimates").
            out = {"sym": (sym or "").upper(), "entity": None, "forward": [], "revisions": [],
                   "yf_unavailable": True}
        try:
            out["consensus"] = f_fmp.result()
        except Exception as exc:
            _logger.warning("research consensus failed for %s: %s", sym, exc)
            out["consensus"] = {"sym": (sym or "").upper(), "state": "error",
                                "annual": [], "quarterly": []}
    total = time.monotonic() - t_start
    if total >= _SLOW_EE_SECONDS:
        _logger.warning("[ee-slow] %s %.1fs: yf %.1fs, fmp %.1fs, estimates key in flight at entry=%s,"
                        " import %.2fs, boot+%.0fs",
                        (sym or "").upper(), total, legs.get("yf", -1.0), legs.get("fmp", -1.0),
                        in_flight_at_entry, t_imp, boot_probe.boot_age())
    # Which vendor stands behind each block, for the on-screen source line.
    out["sources"] = {"forward": "Yahoo Finance", "revisions": "Yahoo Finance",
                      "consensus": "FMP"}
    # The company's reporting currency (TSM -> "TWD"), read once by the FMP leg and
    # lifted here so the Yahoo fallback tables can say their revenue is not dollars
    # either. None = not known.
    out["reporting_currency"] = (out.get("consensus") or {}).get("currency")
    # `consensus.state` is untouched: the EE panel maps it through a fixed table and an
    # unknown value would read as "FMP did not answer". The marker sits at the top level.
    return _fund_marked(out, sym, _EE_FUND_WHY)


# R10: ANR / OWN / RTG used to turn an exception into a 200 carrying an EMPTY
# record, which reads to a member as "no analysts / no holders / no rating".
# A failed read is a 503; the research hooks (useAnalystRatings, useOwnership,
# useRatings) already keep a non-2xx as `error`, never as an empty record.
def _read_failed(what: str, sym: str, exc: Exception):
    _logger.warning("research %s failed for %s: %s", what, sym, exc)
    raise HTTPException(status_code=503,
                        detail=f"{what} for {(sym or '').upper()} could not be read right now")


@router.get("/api/research/analyst-ratings/{sym}")
def research_analyst_ratings(sym: str = Depends(sym_path)):
    try:
        return _fund_marked(get_analyst_ratings(sym), sym, _ANR_FUND_WHY)
    except Exception as exc:
        _read_failed("analyst ratings", sym, exc)


@router.get("/api/research/ownership/{sym}")
def research_ownership(sym: str = Depends(sym_path)):
    try:
        result = get_ownership(sym)
        # TERM-045, DARK: armed, the insider section is read from SEC EDGAR
        # Form 4 (cache-only here; the SEC reads run on edgar_ownership's own
        # worker). Unset, this branch is never entered and the response is
        # exactly what get_ownership returned.
        if edgar_ownership.is_enabled() and isinstance(result, dict) and result:
            return edgar_ownership.overlay_insider(result, sym)
        return result
    except Exception as exc:
        _read_failed("ownership", sym, exc)


@router.get("/api/research/ratings/{sym}")
def research_ratings(sym: str = Depends(sym_path)):
    # composite None + components {} is the shape RatingsTab already renders as
    # "Ratings are unavailable for this ticker." -- never a coloured score from 2 of 6 inputs.
    from api.services.ticker_search_index import fund_not_applicable
    na = fund_not_applicable(sym, _RTG_FUND_WHY)
    if na:
        return {"sym": sym, **na, "composite": None, "components": {}, "checkup": [],
                "coverage": None}
    try:
        return get_ratings(sym)
    except Exception as exc:
        _read_failed("ratings", sym, exc)


@router.get("/api/research/compare/{sym}/{comparator}")
def research_compare(sym: str = Depends(sym_path), comparator: str = Depends(comparator_path)):
    """Cross-Security Comparison V1 (owner authorization) -- deterministic
    side-by-side, no AI. See api/services/research/comparison.py for scope."""
    try:
        return get_comparison(sym, comparator)
    except Exception as exc:
        _logger.warning("research compare failed for %s vs %s: %s", sym, comparator, exc)
        return {"error": "comparison temporarily unavailable"}


@router.post("/api/research/compare/{sym}/{comparator}/explain")
def research_compare_explain(sym: str = Depends(sym_path), comparator: str = Depends(comparator_path), body: dict = Body(...),
                             _user: dict = Depends(get_current_user)):
    """Shared Multi-Security Grounding Architecture V1 (owner authorization,
    Phase B) -- the comparison page's "Ask AI" panel. Auth-required, same as
    /api/research/explain/{sym}: this makes a real, separately cost-guarded
    LLM call (see comparison_ai_adapter.py's own narrative_cost_guard use),
    so an anonymous caller must not be able to reach it. Single-turn only --
    see comparison_ai_adapter.py's module docstring for why."""
    question = str((body or {}).get("question") or "")[:500]
    try:
        return explain_comparison(sym, comparator, question)
    except Exception as exc:
        _logger.warning("comparison explain failed for %s vs %s: %s", sym, comparator, exc)
        return {"sym_a": (sym or "").upper(), "sym_b": (comparator or "").upper(),
                "entity_a": None, "entity_b": None, "response_state": "refuse",
                "summary": "", "key_facts": [], "interpretation": "", "caveat": "",
                "clarification_question": "", "citations": [],
                "insufficient_evidence": True,
                "insufficient_evidence_reason": "The AI assistant is temporarily unavailable.",
                "model": None, "error": "internal error"}


@router.post("/api/research/snapshot-batch")
def research_snapshot_batch(tickers: list[str] = Body(..., embed=True)):
    """Compact snapshot (market cap / next earnings / UCT rating) for a BATCH of
    tickers — powers the Watchlist's optional Market Cap / Next Earnings / UCT Rating
    columns. Bounded parallel over get_snapshot (each internally cached), capped at 100.
    Only the three fields the columns need, to keep the payload small.
    """
    syms = list(dict.fromkeys(
        (t or "").upper().strip() for t in (tickers or []) if t and t.strip()
    ))[:100]
    if not syms:
        return {}

    def _one(sym):
        try:
            s = get_snapshot(sym)
            return sym, {
                "name": s.get("name"),
                "market_cap": (s.get("metrics") or {}).get("market_cap"),
                "next_earnings": s.get("next_earnings"),
                "composite": s.get("composite"),
                "sector": s.get("sector"),
                "industry": s.get("industry"),
            }
        except Exception:
            return sym, {"name": None, "market_cap": None, "next_earnings": None, "composite": None,
                         "sector": None, "industry": None}

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for sym, val in ex.map(_one, syms):
            out[sym] = val

    # 20-session average daily volume — for the RVOL column (live volume / this avg).
    # One bounded batch of tiny indexed reads; today's evolving bar is excluded.
    try:
        from api.services import bars_sqlite
        import datetime as _dt
        try:
            import zoneinfo
            _today = int(_dt.datetime.now(zoneinfo.ZoneInfo("America/New_York")).strftime("%Y%m%d"))
        except Exception:
            _today = None
        avg = bars_sqlite.avg_daily_volume(list(out.keys()), sessions=20, before_ymd=_today)
    except Exception:
        avg = {}
    for sym in out:
        out[sym]["avg_vol_20d"] = avg.get(sym)

    # First-trade (IPO) date — for the optional 'IPO Date' column. One bulk GROUP BY
    # over bars.db's since-inception daily coverage; YYYYMMDD int per ticker.
    try:
        from api.services import bars_sqlite as _bs
        ftd = _bs.first_trade_dates(list(out.keys()))
    except Exception:
        ftd = {}
    for sym in out:
        out[sym]["ipo_date"] = ftd.get(sym)
    return out


@router.get("/api/research/snapshot/{sym}")
def research_snapshot(sym: str = Depends(sym_path)):
    """Consolidated ratings + key fundamentals for the glanceable snapshot card."""
    try:
        snap = get_snapshot(sym)
        # Wave-2 audit: a snapshot with no identity and no numbers, for a symbol that is not a
        # ticker, carries the additive `not_found` marker (api/services/symbol_presence.py).
        # The provider-failure branch below never does.
        from api.services.symbol_presence import mark_if_empty
        # (`name` falls back to the symbol itself when no provider named the company.)
        empty = (isinstance(snap, dict)
                 and snap.get("name") in (None, "", sym)
                 and not snap.get("sector")
                 and snap.get("composite") is None
                 and not any(v is not None for v in (snap.get("metrics") or {}).values()))
        return mark_if_empty(snap, sym, empty)
    except Exception as exc:
        _logger.warning("research snapshot failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "name": None, "sector": None, "industry": None,
                "composite": None, "components": {}, "checkup": [], "method": None, "metrics": {}}


@router.get("/api/research/ratings-percentile/status")
def ratings_percentile_status():
    """Universe percentile-rank coverage (read-only). Shows whether ratings are
    percentile-based yet and how many tickers/distributions are warmed."""
    try:
        from api.services.research import ratings_db, ratings_universe
        st = ratings_db.status()
        st["enabled"] = ratings_universe.is_enabled()
        return st
    except Exception as exc:
        _logger.warning("ratings-percentile status failed: %s", exc)
        return {"enabled": False, "usable": False, "error": str(exc)}


@router.post("/api/research/ratings-percentile/refresh")
def ratings_percentile_refresh(max_per_run: int | None = None, _admin: dict = Depends(require_admin)):
    """Admin: trigger a universe percentile refresh in the background (force —
    runs even if the feature flag is off so admins can warm it before enabling)."""
    from api.services.research import ratings_universe

    def _run():
        try:
            ratings_universe.run_percentile_refresh(max_per_run=max_per_run, force=True)
        except Exception as exc:  # pragma: no cover
            _logger.warning("ratings-percentile manual refresh failed: %s", exc)

    threading.Thread(target=_run, daemon=True, name="ratings-percentile-manual").start()
    return {"status": "started", "max_per_run": max_per_run}
