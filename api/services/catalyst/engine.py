"""Orchestrator: collect → score → tag → select → synthesize → store.

Called by APScheduler cron jobs in api/main.py. Each call is independent
and safe to run concurrently across pods because store writes are
idempotent on (market_date, ticker)."""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import time
from zoneinfo import ZoneInfo

from typing import Optional

from api.services.catalyst import (
    selection,
    scoring,
    sources,
    store,
    synthesize,
    tagging,
)


def _compute_catalyst_at(c: dict) -> Optional[int]:
    """Earliest source-signal timestamp for this candidate, in unix seconds.

    'When did the catalyst occur?' — answered by the oldest timestamp across
    tweets / RSS / earnings. Used by UI to show 'catalyst broke at 4:23 AM'
    instead of 'we synthesized this at 7:32 AM'.

    Returns None when no source has a timestamp (e.g. Perplexity-only signal).
    """
    candidates: list[int] = []
    for t in (c.get("tweets") or []):
        ts = t.get("created_at")
        if isinstance(ts, (int, float)) and ts > 0:
            candidates.append(int(ts))
    for r in (c.get("rss") or []):
        ts = r.get("time_published")
        if isinstance(ts, (int, float)) and ts > 0:
            candidates.append(int(ts))
    em = c.get("earnings_meta") or {}
    # Earnings reports have a publish_time field set by EW/Finnhub layer if
    # present; otherwise we fall back to the timing label (bmo/amc) which is
    # less precise so we don't use it as a candidate_at value.
    ts = em.get("publish_time")
    if isinstance(ts, (int, float)) and ts > 0:
        candidates.append(int(ts))

    return min(candidates) if candidates else None

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")


def _today_market_date() -> str:
    return dt.datetime.now(_ET).date().isoformat()


def _enrich_with_perplexity(candidates: list[dict]) -> None:
    """For each top-12 candidate with thin source signals (no tweets, no RSS,
    no earnings), ask Perplexity 'what's the catalyst for $XYZ today?' and
    inject the answer into the candidate's signals as a synthetic 'rss' item.

    This is the bridge that lets us answer the "this stock is up 8% but I have
    no idea why" rows. Bounded: only fires for candidates with zero existing
    signals. Cost ~$0.005/call × ~3-5 hits/refresh ≈ $0.50/day.

    Mutates candidates in-place. Gated on CATALYST_PERPLEXITY_ENABLED.
    """
    if os.environ.get("CATALYST_PERPLEXITY_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return

    try:
        from api.services import perplexity_search
    except Exception:
        return

    for c in candidates:
        has_signals = (
            (c.get("tweets") and len(c["tweets"]) > 0)
            or (c.get("rss") and len(c["rss"]) > 0)
            or c.get("earnings_meta")
        )
        if has_signals:
            continue  # already have something — skip the paid call

        ticker = c.get("ticker")
        gap_pct = c.get("gap_pct", 0)
        if not ticker:
            continue

        query = (f"What is the specific catalyst driving ${ticker} stock "
                 f"{'up' if gap_pct >= 0 else 'down'} {abs(gap_pct):.1f}% today? "
                 f"Cite earnings, M&A, FDA, contract wins, analyst actions, "
                 f"or any breaking news. If no clear catalyst exists, say so plainly.")
        try:
            result = perplexity_search.web_search(query, max_tokens=300)
        except Exception:
            logger.exception("[catalyst-engine] perplexity %s failed", ticker)
            continue

        answer = (result or {}).get("answer") or ""
        if not answer or "error" in (result or {}):
            continue
        citations = (result or {}).get("citations") or []

        # Inject as a synthetic 'rss' item so the synthesize prompt picks it up
        c.setdefault("rss", []).append({
            "source": "Perplexity",
            "title": answer[:200],
            "url": citations[0] if citations else "",
        })
        c["rss_headline_count"] = len(c["rss"])


def _enrich_with_twitter_search(candidates: list[dict]) -> None:
    """For each top-12 candidate, search ALL of Twitter for $TICKER mentions
    in last 24h and merge results into candidate['tweets']. Bounds cost by
    skipping when the candidate already has >=5 tweets from curated accounts.

    Mutates candidates in-place. Gated on CATALYST_TWITTER_SEARCH_ENABLED env."""
    if os.environ.get("CATALYST_TWITTER_SEARCH_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return
    try:
        from api.services import twitterapi_io
    except Exception:
        return

    since_unix = int(time.time()) - 24 * 3600
    for c in candidates:
        existing = len(c.get("tweets") or [])
        if existing >= 5:
            # Already rich; skip the Twitter search call
            continue
        try:
            extra = twitterapi_io.search_tweets(
                query=f"${c['ticker']}",
                since_unix=since_unix,
                query_type="Latest",
                max_results=20,
            )
        except twitterapi_io.TwitterApiError as e:
            logger.warning("[catalyst-engine] twitter_search %s failed: %s",
                           c.get("ticker"), e)
            continue
        except Exception:
            logger.exception("[catalyst-engine] twitter_search %s unexpected",
                             c.get("ticker"))
            continue

        # Dedup by tweet id against existing tweets
        seen_ids = {t.get("id") for t in (c.get("tweets") or []) if t.get("id")}
        merged = list(c.get("tweets") or [])
        for t in extra:
            tid = t.get("id")
            if tid and tid not in seen_ids:
                merged.append({
                    "author_handle": t.get("author_handle"),
                    "text": t.get("text", ""),
                    "url": t.get("url"),
                    "id": tid,
                })
                seen_ids.add(tid)
        c["tweets"] = merged
        c["tweet_mention_count"] = len(merged)


def run_refresh() -> dict:
    """Single full pass. Returns summary dict for logging.
    Never raises — all errors swallowed + logged."""
    md = _today_market_date()
    summary = {"market_date": md, "candidates": 0, "scored": 0,
               "selected": 0, "synthesized": 0, "errors": []}

    try:
        candidates = sources.collect_all()
    except Exception as e:
        logger.exception("[catalyst-engine] source collection failed")
        summary["errors"].append(f"collect: {e}")
        return summary

    summary["candidates"] = len(candidates)
    if not candidates:
        logger.info("[catalyst-engine] no candidates this tick")
        return summary

    for c in candidates:
        c["tag"] = tagging.assign_tag(c)
        c["score"] = scoring.score(c)
    scored = [c for c in candidates if c.get("tag")]
    summary["scored"] = len(scored)

    top_12 = selection.select_top_12(scored)
    summary["selected"] = len(top_12)

    # Tier 1C: enrich top-12 with broader Twitter search before synthesis.
    # Bounded — skips tickers that already have ≥5 tweets from curated accounts.
    _enrich_with_twitter_search(top_12)

    # Tier 2-1: Perplexity fallback for tickers with zero source signals.
    # Runs AFTER Twitter search so it only fires when even broad search
    # turned up nothing. Bounded by zero-signals check.
    _enrich_with_perplexity(top_12)

    store.clear_ranks_for_date(md)

    for rank, c in enumerate(top_12, start=1):
        try:
            thesis = synthesize.synthesize_ticker(c, md)
        except Exception as e:
            logger.exception("[catalyst-engine] synthesize failed for %s",
                             c.get("ticker"))
            summary["errors"].append(f"synth_{c.get('ticker')}: {e}")
            continue

        catalyst_at = _compute_catalyst_at(c)

        try:
            store.upsert_catalyst({
                "market_date": md,
                "ticker": c["ticker"],
                "rank": rank,
                "score": c["score"],
                "tag": c["tag"],
                "price": c.get("price"),
                "gap_pct": c.get("gap_pct"),
                "vol_x": c.get("vol_x"),
                "market_cap": c.get("market_cap"),
                "sector": c.get("sector"),
                "thesis_text": thesis["thesis_text"],
                "thesis_model": thesis["thesis_model"],
                "thesis_at": thesis["thesis_at"],
                "thesis_sources": thesis["thesis_sources"],
                "signals_hash": thesis["signals_hash"],
                "catalyst_at": catalyst_at,
                "raw_signals": json.dumps({
                    "tweets": c.get("tweets", []),
                    "rss": c.get("rss", []),
                    "earnings_meta": c.get("earnings_meta"),
                    "scanner_setup": c.get("scanner_setup"),
                }, default=str),
            })
            summary["synthesized"] += 1
        except Exception as e:
            logger.exception("[catalyst-engine] store upsert failed for %s",
                             c.get("ticker"))
            summary["errors"].append(f"store_{c.get('ticker')}: {e}")

    selected_tickers = {c["ticker"] for c in top_12}
    for c in scored:
        if c["ticker"] in selected_tickers:
            continue
        existing = store.get_ticker_for_date(c["ticker"], md)
        if existing:
            continue
        try:
            store.upsert_catalyst({
                "market_date": md,
                "ticker": c["ticker"],
                "rank": None,
                "score": c["score"],
                "tag": c["tag"],
                "price": c.get("price"),
                "gap_pct": c.get("gap_pct"),
                "vol_x": c.get("vol_x"),
                "market_cap": c.get("market_cap"),
                "sector": c.get("sector"),
                "thesis_text": None,
                "thesis_model": None,
                "thesis_at": None,
                "thesis_sources": "[]",
                "signals_hash": None,
                "catalyst_at": None,
                "raw_signals": "{}",
            })
        except Exception:
            pass

    logger.info("[catalyst-engine] refresh done: %s", summary)
    return summary
