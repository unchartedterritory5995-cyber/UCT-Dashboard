"""Parallel pulls from existing project data sources, normalized into
the Candidate dict shape consumed by scoring/tagging/synthesize.

Phase 1 sources (all already wired in the codebase):
  1. Massive movers (get_movers)               -> gap_pct
  2. Massive batch snapshot (rich)             -> price
  3. Earnings (get_earnings bmo/amc)           -> earnings_meta
  4. Tweets (tweet_store.tape)                 -> tweets
  5. RSS news (news_aggregator.fetch_rss_news) -> rss
  6. UCT scanner (engine.get_candidates)       -> scanner_setup

vol_x and market_cap default to 0/None in Phase 1 — no ADV pipeline yet.
Sector is best-effort from yfinance if available, else None.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")
_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")


def _today_market_date() -> str:
    return dt.datetime.now(_ET).date().isoformat()


def _now_et() -> dt.datetime:
    return dt.datetime.now(_ET)


def _safe(fn, default=None, name="?"):
    """Run a source pull; on any exception return default + log."""
    try:
        return fn()
    except Exception as e:
        logger.warning("[catalyst-sources] %s failed: %s", name, e)
        return default if default is not None else {}


# ── Source 1: Massive gappers/losers ────────────────────────────────────
def _pull_movers() -> dict[str, dict]:
    """Returns {ticker: {gap_pct}} for current ripping + drilling lists."""
    from api.services.massive import get_movers
    movers = get_movers() or {}
    out: dict[str, dict] = {}

    def _parse_pct(raw):
        if raw is None:
            return 0.0
        if isinstance(raw, (int, float)):
            return float(raw)
        s = str(raw).strip().rstrip("%").replace(",", "")
        if not s or s == "—":
            return 0.0
        try:
            return float(s)
        except ValueError:
            return 0.0

    for item in (movers.get("ripping") or []):
        sym = (item.get("sym") or "").upper()
        if sym:
            out[sym] = {"gap_pct": _parse_pct(item.get("pct"))}
    for item in (movers.get("drilling") or []):
        sym = (item.get("sym") or "").upper()
        if sym:
            out[sym] = {"gap_pct": -abs(_parse_pct(item.get("pct")))}
    return out


def _enrich_with_snapshot(tickers: list[str]) -> dict[str, dict]:
    """Get price, vol_x, sector, market_cap for the union of candidate tickers.

    Combines Massive rich snapshot (price, today's volume) with yfinance-backed
    ticker_metadata (sector, market_cap, avg_volume_30d) to compute vol_x.
    """
    if not tickers:
        return {}

    # Massive rich batch — gives us price + today's volume
    try:
        from api.services.massive import _get_client
        client = _get_client()
        snaps = client.get_batch_rich_snapshots(tickers) or {}
    except Exception as e:
        logger.warning("[catalyst-sources] batch snapshot failed: %s", e)
        snaps = {}

    # yfinance-backed metadata — sector, market_cap, avg_volume_30d (cached 24h)
    from api.services.catalyst.ticker_metadata import get_metadata_batch
    try:
        meta = get_metadata_batch(tickers)
    except Exception as e:
        logger.warning("[catalyst-sources] metadata batch failed: %s", e)
        meta = {}

    out = {}
    for ticker in tickers:
        ticker_u = ticker.upper()
        snap = snaps.get(ticker_u, {})
        m = meta.get(ticker_u, {})

        price = float(snap.get("price") or 0)
        today_vol = int(snap.get("vol") or 0)
        adv = m.get("avg_volume_30d") or 0
        change_pct = snap.get("change_pct")  # intraday — current vs prev close
        day_open = float(snap.get("day_open") or 0)
        prev_close = float(snap.get("prev_close") or 0)

        # vol_x = today's volume / avg 30d volume. Bounded at 0 when ADV unknown.
        vol_x = 0.0
        if adv and adv > 0 and today_vol > 0:
            vol_x = round(today_vol / float(adv), 2)

        # True open-gap: (today_open - prev_close) / prev_close * 100
        # Frozen at 9:30 AM ET — the actual catalyst-driven move that
        # the news produced. Pre-market this is 0 (no open yet); we use
        # intraday change_pct in that case which is mathematically the
        # same anyway when there's no regular session activity.
        open_gap_pct = None
        if day_open > 0 and prev_close > 0:
            open_gap_pct = round(((day_open - prev_close) / prev_close) * 100.0, 2)

        out[ticker_u] = {
            "price": price,
            "vol_x": vol_x,
            "market_cap": m.get("market_cap"),
            "sector": m.get("sector"),
            "change_pct": float(change_pct) if change_pct is not None else None,
            "open_gap_pct": open_gap_pct,  # frozen at 9:30 ET, None pre-market
        }
    return out


# ── Source 3: Earnings ──────────────────────────────────────────────────
def _pull_earnings() -> dict[str, dict]:
    """Returns {ticker: earnings_meta} for today BMO + yesterday AMC."""
    from api.services.engine import get_earnings
    er = _safe(lambda: get_earnings() or {}, default={}, name="earnings")
    out: dict[str, dict] = {}

    for timing_key, when_label in (("bmo", "bmo"), ("amc", "amc")):
        for entry in (er.get(timing_key) or []):
            sym = (entry.get("sym") or "").upper()
            if not sym:
                continue
            out[sym] = {
                "ticker": sym,
                "timing": when_label,
                "eps_actual": entry.get("reported_eps") or entry.get("eps_actual"),
                "eps_estimate": entry.get("eps_estimate"),
                "revenue_actual_m": entry.get("rev_actual") or entry.get("revenue_m"),
                "quarter": entry.get("quarter"),
                "year": entry.get("year"),
                "reported_recently": (entry.get("reported_eps") is not None
                                       or entry.get("eps_actual") is not None
                                       or entry.get("verdict") in ("BEAT", "MISS")),
            }
    return out


# ── Source 4: Tweets from tweet_store ───────────────────────────────────
def _pull_tweet_signals() -> dict[str, list[dict]]:
    """Returns {ticker: [tweet, ...]} for recently cashtagged tickers."""
    from api.services import tweet_store
    out: dict[str, list[dict]] = defaultdict(list)
    try:
        tape_rows = tweet_store.tape(hours=24, limit=200)
    except Exception as e:
        logger.warning("[catalyst-sources] tweet tape failed: %s", e)
        return out
    for row in tape_rows:
        ticker = (row.get("ticker") or "").upper()
        if not ticker:
            continue
        try:
            tweets = tweet_store.tweets_for_ticker(ticker, hours=24)
        except Exception:
            continue
        for t in tweets[:5]:
            out[ticker].append({
                "author_handle": t.get("author_handle"),
                "text": t.get("text", ""),
                "url": t.get("url"),
                "id": t.get("id"),
                # When the tweet was posted (unix seconds UTC) — used to compute
                # the catalyst's "actual occurrence time" for UI display.
                "created_at": t.get("created_at"),
            })
    return out


# ── Source 5: RSS news ──────────────────────────────────────────────────
def _parse_iso_to_unix(s: str) -> Optional[int]:
    """Parse an ISO 8601 string into unix seconds. Returns None on failure."""
    if not s or not isinstance(s, str):
        return None
    try:
        return int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return None


def _pull_rss_signals() -> dict[str, list[dict]]:
    """Pull recent RSS items; extract ticker mentions via cashtag regex."""
    from api.services.news_aggregator import fetch_rss_news
    out: dict[str, list[dict]] = defaultdict(list)
    today = _today_market_date()
    items = _safe(lambda: fetch_rss_news(today, limit=80) or [],
                  default=[], name="rss_news")
    for item in items:
        title = item.get("title") or item.get("headline") or ""
        summary = item.get("summary") or ""
        text = f"{title} {summary}"
        tickers = set(_CASHTAG_RE.findall(text.upper()))
        for t in (item.get("tickers") or []):
            if t:
                tickers.add(t.upper())
        # news_aggregator emits time_published as ISO string — convert to unix.
        published_unix = _parse_iso_to_unix(item.get("time_published") or "")
        for ticker in tickers:
            if not ticker or len(ticker) > 5:
                continue
            out[ticker].append({
                "source": item.get("source") or item.get("category") or "RSS",
                "title": title,
                "url": item.get("url"),
                "time_published": published_unix,
            })
    return out


# ── Source 7: Perplexity discovery (proactive candidate finding) ────────
# Two queries — both gated on CATALYST_PERPLEXITY_ENABLED:
#   A1 (always-on): "what are today's top catalyst movers right now?"
#   D1 (pre-market only): "biggest pre-market movers + why" — fires 4–9am ET

# Extract `$TICKER` or bare uppercase 1-5 letter sequences treated as tickers.
# Bare-word path requires a leading word boundary AND match against a
# minimal common-words exclusion to avoid garbage like "USA" or "CEO".
_DISCOVERY_TICKER_RE = re.compile(r"\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b")
_NON_TICKER_WORDS = {
    "USA", "CEO", "CFO", "COO", "ETF", "IPO", "FDA", "SEC", "USD", "EUR", "GBP",
    "JPY", "CAD", "AUD", "AI", "ML", "EPS", "QOQ", "YOY", "AMC", "BMO", "RTH",
    "NYSE", "PRE", "POST", "FED", "JPM", "GS", "EBIT", "EBITDA", "FY", "FQ",
    "GAAP", "NON",
}


def _extract_tickers_from_text(text: str) -> set[str]:
    """Pull plausible tickers from Perplexity prose. Cashtags trusted;
    bare uppercase words filtered against a tiny stoplist."""
    if not text:
        return set()
    tickers: set[str] = set()
    for cashtag, bareword in _DISCOVERY_TICKER_RE.findall(text):
        sym = cashtag or bareword
        if not sym:
            continue
        sym = sym.upper()
        if cashtag:  # trusted
            tickers.add(sym)
        elif sym not in _NON_TICKER_WORDS and 2 <= len(sym) <= 5:
            tickers.add(sym)
    # Drop the forex/crypto false-positives we already exclude elsewhere
    tickers -= {"USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "HKD", "NZD"}
    return tickers


def _pull_perplexity_discovery() -> dict[str, list[dict]]:
    """Two Perplexity queries that proactively find candidate tickers.

    Returns {ticker: [synthetic_rss_item, ...]} so the union+enrichment
    flow downstream picks them up automatically.
    """
    if os.environ.get("CATALYST_PERPLEXITY_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return {}
    try:
        from api.services import perplexity_search
    except Exception:
        return {}

    out: dict[str, list[dict]] = defaultdict(list)
    now = _now_et()
    hour = now.hour
    is_premarket = (4 <= hour < 9) or (hour == 9 and now.minute < 30)

    # ── A1: always-on broad discovery ──────────────────────────────────
    a1_query = (
        "What are the top 15 individual US stocks with breaking catalysts right now? "
        "Include M&A, earnings beats/misses, FDA approvals, contract wins, halts, "
        "analyst upgrades/downgrades, or other significant single-stock news. "
        "For each: ticker symbol (use $TICKER format), one sentence catalyst, and "
        "approximate time the news broke. Skip macro/index moves. Skip rumors. "
        "Cite sources."
    )
    try:
        a1_result = perplexity_search.web_search(a1_query, max_tokens=600)
        a1_text = (a1_result or {}).get("answer") or ""
        a1_citations = (a1_result or {}).get("citations") or []
        for sym in _extract_tickers_from_text(a1_text):
            out[sym].append({
                "source": "Perplexity (discovery)",
                "title": a1_text[:400],
                "url": a1_citations[0] if a1_citations else "",
                "time_published": int(time.time()),
            })
        if a1_text:
            logger.info("[catalyst-sources] perplexity discovery found %d tickers",
                        len(_extract_tickers_from_text(a1_text)))
    except Exception:
        logger.exception("[catalyst-sources] perplexity A1 discovery failed")

    # ── D1: pre-market window only ─────────────────────────────────────
    if is_premarket:
        d1_query = (
            "What are the biggest US stock pre-market movers right now and the "
            "specific catalysts driving each? Include stocks gapping up or down "
            "more than 4% with news, earnings, M&A, analyst actions, or other "
            "events. For each ticker, give symbol ($TICKER format), gap percent "
            "if available, and one-sentence reason. Cite sources."
        )
        try:
            d1_result = perplexity_search.web_search(d1_query, max_tokens=600)
            d1_text = (d1_result or {}).get("answer") or ""
            d1_citations = (d1_result or {}).get("citations") or []
            for sym in _extract_tickers_from_text(d1_text):
                # Append rather than overwrite — A1 may have already seen this ticker
                out[sym].append({
                    "source": "Perplexity (pre-market)",
                    "title": d1_text[:400],
                    "url": d1_citations[0] if d1_citations else "",
                    "time_published": int(time.time()),
                })
            if d1_text:
                logger.info("[catalyst-sources] perplexity pre-market found %d tickers",
                            len(_extract_tickers_from_text(d1_text)))
        except Exception:
            logger.exception("[catalyst-sources] perplexity D1 pre-market failed")

    return out


# ── Source 6: UCT scanner candidates ────────────────────────────────────
def _pull_scanner_setups() -> dict[str, dict]:
    """Pull from wire_data.candidates (PB / Remount / Gapper setups)."""
    from api.services import engine
    candidates = _safe(lambda: engine.get_candidates() or {},
                       default={}, name="scanner")
    out: dict[str, dict] = {}
    for bucket_name in ("pullback_ma", "remount", "gapper_news",
                        "pullback", "gappers"):  # tolerate alt naming
        for entry in (candidates.get(bucket_name) or []):
            sym = (entry.get("ticker") or entry.get("sym") or "").upper()
            if sym:
                out[sym] = {
                    "setup_type": entry.get("alert_state") or bucket_name.upper(),
                    "candle_score": entry.get("candle_score"),
                    "adr_pct": entry.get("adr_pct"),
                }
    return out


# ── Orchestrator ────────────────────────────────────────────────────────
def collect_all() -> list[dict]:
    """Runs all source pulls in parallel; merges into Candidate dicts
    keyed by ticker. Returns list of candidates (one per ticker)."""
    tasks = {
        "movers":     _pull_movers,
        "earnings":   _pull_earnings,
        "tweets":     _pull_tweet_signals,
        "rss":        _pull_rss_signals,
        "scanner":    _pull_scanner_setups,
        "perplexity": _pull_perplexity_discovery,
    }
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=5, thread_name_prefix="cat-src") as ex:
        futures = {ex.submit(_safe, fn, {}, name): name
                   for name, fn in tasks.items()}
        for fut in as_completed(futures, timeout=30):
            name = futures[fut]
            try:
                results[name] = fut.result()
            except Exception as e:
                logger.warning("[catalyst-sources] %s exception: %s", name, e)
                results[name] = {}

    # Universe = union of tickers from all sources
    universe: set[str] = set()
    universe.update(results.get("movers", {}).keys())
    universe.update(results.get("earnings", {}).keys())
    universe.update(results.get("tweets", {}).keys())
    universe.update(results.get("rss", {}).keys())
    universe.update(results.get("scanner", {}).keys())
    universe.update(results.get("perplexity", {}).keys())

    if not universe:
        return []

    # Enrich with snapshot (price) for the union
    snapshot = _enrich_with_snapshot(sorted(universe))

    # Sector momentum requires sector field which we don't populate Phase 1
    sector_counts: dict[str, int] = defaultdict(int)

    candidates: list[dict] = []
    for ticker in sorted(universe):
        movers_data = results["movers"].get(ticker, {})
        snap = snapshot.get(ticker, {})
        em = results["earnings"].get(ticker)
        tweets = results["tweets"].get(ticker, [])
        # Merge RSS + Perplexity-discovery items into the same `rss` list
        # so the synthesize prompt + downstream code see them uniformly.
        rss = list(results["rss"].get(ticker, []))
        for pp_item in (results.get("perplexity", {}).get(ticker, []) or []):
            rss.append(pp_item)
        setup = results["scanner"].get(ticker)

        sector = snap.get("sector")
        if sector:
            sector_counts[sector] += 1

        # gap_pct preference order — for a morning catalyst dashboard,
        # the TRUE open gap is the most useful number (frozen at 9:30 ET,
        # tells you what the catalyst caused). Pre-market we fall back
        # to intraday change which is mathematically the same.
        #   1. snapshot open_gap_pct  (= (day_open - prev_close) / prev_close)
        #   2. snapshot change_pct    (intraday — used pre-market when day_open=0)
        #   3. movers feed gap_pct    (fallback for tickers missing snapshot)
        #   4. 0.0
        gap_pct = snap.get("open_gap_pct")
        if gap_pct is None:
            snap_chg = snap.get("change_pct")
            if snap_chg is not None:
                gap_pct = float(snap_chg)
            else:
                gap_pct = movers_data.get("gap_pct") or 0.0

        candidates.append({
            "ticker": ticker,
            "company": None,
            "price": snap.get("price"),
            "gap_pct": gap_pct,
            "vol_x": snap.get("vol_x", 1.0),
            "market_cap": snap.get("market_cap"),
            "sector": sector,
            "tweets": tweets,
            "rss": rss,
            "earnings_meta": em,
            "earnings_reported_recently": bool(em and em.get("reported_recently")),
            "earnings_just_reported": bool(em and em.get("reported_recently")),
            "tweet_mention_count": len(tweets),
            "rss_headline_count": len(rss),
            "scanner_setup": setup,
        })

    for c in candidates:
        c["sector_momentum_count"] = max(0, sector_counts.get(c.get("sector"), 0) - 1)

    return candidates
