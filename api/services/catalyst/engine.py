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
    filters,
    selection,
    scoring,
    sources,
    store,
    synthesize,
    tagging,
)


def _compute_sector_context(top_n: list[dict]) -> list[dict]:
    """When 3+ selected candidates share a sector, ask Perplexity what's
    driving the concentrated activity. Returns a list of sector-context
    dicts: [{sector, ticker_count, summary, source_urls}].

    Used by the frontend to render a small banner above the table.
    Cost: ~0-2 calls per refresh × $0.005 ≈ $1-3/mo, skipped entirely
    on refreshes where no sector hits the 3-ticker threshold.

    Gated on CATALYST_PERPLEXITY_ENABLED.
    """
    if os.environ.get("CATALYST_PERPLEXITY_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return []

    from collections import Counter
    sector_counts = Counter(c.get("sector") for c in top_n if c.get("sector"))

    hot_sectors = [s for s, count in sector_counts.items() if count >= 3]
    if not hot_sectors:
        return []

    try:
        from api.services import perplexity_search
    except Exception:
        return []

    contexts: list[dict] = []
    for sector in hot_sectors[:2]:  # cap at 2 sectors per refresh to bound cost
        # Tickers in this sector for prompt grounding
        sector_tickers = [c["ticker"] for c in top_n if c.get("sector") == sector][:6]
        ticker_list = ", ".join(f"${t}" for t in sector_tickers)

        query = (
            f"Multiple US stocks in the {sector} sector are showing "
            f"significant catalysts today: {ticker_list}. What is the "
            f"broader sector/macro story driving this concentrated activity? "
            f"Cite sources. Be concise — 2-3 sentences."
        )
        try:
            result = perplexity_search.web_search(
                query, max_tokens=300,
                domain_pack="finance", recency="day",
            )
        except Exception:
            logger.exception("[catalyst-engine] sector context for %s failed", sector)
            continue

        answer = (result or {}).get("answer") or ""
        if not answer or "error" in (result or {}):
            continue

        # Suppress low-information / hedging answers — when Perplexity admits it
        # has no specific catalyst and hand-waves to a macro narrative, the
        # banner is noise, not signal (exactly the fluff the user flagged).
        if _is_low_info_sector_answer(answer):
            logger.info("[catalyst-engine] suppressed low-info sector banner for %s",
                        sector)
            continue

        contexts.append({
            "sector": sector,
            "ticker_count": sector_counts[sector],
            "summary": answer,
            "source_urls": (result or {}).get("citations") or [],
        })

    return contexts


# Phrases that signal Perplexity has no real sector catalyst and is hedging.
_LOW_INFO_SECTOR_MARKERS = (
    "i don't have", "i do not have", "i can't see", "i cannot see",
    "no live", "without live", "almost certainly", "likely ties back",
    "probably ties", "no specific catalyst", "not available", "no clear",
    "i'm not able", "unable to",
)


def _is_low_info_sector_answer(answer: str) -> bool:
    """True when the sector summary is hedging/no-info filler rather than a
    concrete shared catalyst. Env-disable with CATALYST_SECTOR_STRICT=0."""
    if os.environ.get("CATALYST_SECTOR_STRICT", "1").lower() not in ("1", "true", "yes"):
        return False
    low = answer.lower()
    return any(m in low for m in _LOW_INFO_SECTOR_MARKERS)


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

    am = c.get("analyst_meta") or {}
    ats = am.get("at")
    if isinstance(ats, (int, float)) and ats > 0:
        candidates.append(int(ats))

    return min(candidates) if candidates else None

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# Per-day sector context cache, populated by run_refresh. Module-level so it
# survives across requests but not across restarts (recomputed on next refresh).
_SECTOR_CONTEXT_BY_DATE: dict[str, list[dict]] = {}

# Per-day quality-gate exclusions {market_date: {ticker: reason}}. Populated by
# run_refresh so the "Why isn't X" explainer can report a precise reason
# ("excluded: $2.40 below $3 floor") instead of silence. Survives across
# requests, recomputed each refresh.
_EXCLUDED_BY_DATE: dict[str, dict[str, str]] = {}


def _iso_to_unix(s) -> Optional[int]:
    """Best-effort parse of a published-date string into unix seconds.

    Defensive across the two formats free news feeds emit:
      1. ISO 8601 (`datetime.fromisoformat`, with a Z→+00:00 nudge)
      2. RFC-822 (`email.utils.parsedate_to_datetime`) — Google News uses
         this, e.g. "Wed, 11 Jun 2025 13:20:00 GMT". fromisoformat can't
         parse it, so RFC-822 support is required here.
    Returns int unix seconds, or None on anything unparseable.
    """
    if not s or not isinstance(s, str):
        return None
    try:
        return int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        pass
    try:
        import email.utils
        parsed = email.utils.parsedate_to_datetime(s)
        if parsed is not None:
            return int(parsed.timestamp())
    except (ValueError, TypeError, OverflowError):
        pass
    return None


def get_sector_contexts(market_date: str) -> list[dict]:
    """Read-only accessor for the catalysts router."""
    return _SECTOR_CONTEXT_BY_DATE.get(market_date, [])


def get_exclusion_reason(market_date: str, ticker: str) -> Optional[str]:
    """Why was this ticker dropped by the quality gate today? None if it
    wasn't excluded (or the date hasn't been refreshed yet)."""
    return _EXCLUDED_BY_DATE.get(market_date, {}).get((ticker or "").upper())


def _collect_user_watchlist_tickers() -> dict[str, set[str]]:
    """Returns {user_id: set(tickers)} for every user who has any watchlist
    or flagged ticker. Used to fire catalyst alerts when a top-20 ticker
    matches a user's interest."""
    try:
        from api.services.auth_db import get_connection
    except Exception:
        return {}

    out: dict[str, set[str]] = {}
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            # Get all (user_id, sym) pairs from watchlist_items via watchlists JOIN
            rows = cur.execute(
                """SELECT w.user_id, wi.sym
                   FROM watchlists w
                   JOIN watchlist_items wi ON wi.watchlist_id = w.id"""
            ).fetchall()
            for row in rows:
                user_id = row[0] if not isinstance(row, dict) else row["user_id"]
                sym = row[1] if not isinstance(row, dict) else row["sym"]
                if not user_id or not sym:
                    continue
                out.setdefault(str(user_id), set()).add(sym.upper())
    except Exception:
        logger.exception("[catalyst-engine] failed to collect user watchlists")

    return out


def _fire_catalyst_alerts(top_n: list[dict], market_date: str) -> int:
    """For each (user, ticker) where ticker is in top-N and on user's watchlist,
    fire a multi-channel alert (AlertBell + email + Discord). Deduped per
    (user, ticker, market_date) — only fires once per day.

    Gated on CATALYST_ALERTS_ENABLED env var (default ON).
    Returns count of alerts fired this call.
    """
    if os.environ.get("CATALYST_ALERTS_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return 0
    if not top_n:
        return 0

    user_tickers = _collect_user_watchlist_tickers()
    if not user_tickers:
        return 0

    try:
        from api.services.watchlist_alert_service import deliver_alert_payload
    except Exception:
        logger.exception("[catalyst-engine] alert service unavailable")
        return 0

    top_by_ticker = {c["ticker"].upper(): c for c in top_n if c.get("ticker")}
    fired = 0

    for user_id, watched in user_tickers.items():
        matched = watched & set(top_by_ticker.keys())
        for ticker in matched:
            c = top_by_ticker[ticker]
            # Atomic dedup — try to insert into alerts_fired, skip if already there
            if not store.try_record_alert(user_id, ticker, market_date):
                continue

            tag = c.get("tag", "Catalyst")
            gap = c.get("gap_pct") or 0.0
            thesis = (c.get("thesis_text") or "")[:300]
            title = f"📰 Catalyst: ${ticker} ({tag})"
            message = (
                f"{ticker} is a top catalyst today ({tag}, {gap:+.2f}%). "
                f"{thesis}"
            )
            try:
                deliver_alert_payload(
                    user_id=user_id,
                    sym=ticker,
                    title=title,
                    message=message,
                    source="catalyst_alert",
                    extra_data={
                        "ticker": ticker,
                        "tag": tag,
                        "gap_pct": gap,
                        "market_date": market_date,
                    },
                )
                fired += 1
            except Exception:
                logger.exception("[catalyst-engine] alert delivery for %s/%s failed",
                                 user_id, ticker)

    if fired:
        logger.info("[catalyst-engine] fired %d catalyst alerts", fired)
    return fired


def _collect_admin_user_ids() -> list[str]:
    """User ids with role='admin' — the operator(s). Must-know alerts go here
    (not to all subscribers) so nobody gets a surprise push."""
    try:
        from api.services.auth_db import get_connection
    except Exception:
        return []
    try:
        with get_connection() as conn:
            rows = conn.cursor().execute(
                "SELECT id FROM users WHERE role = 'admin'").fetchall()
            out = []
            for r in rows:
                uid = r[0] if not isinstance(r, dict) else r["id"]
                if uid:
                    out.append(str(uid))
            return out
    except Exception:
        logger.exception("[catalyst-engine] failed to collect admin users")
        return []


def _fire_mustknow_alerts(displayed: list[dict], market_date: str) -> int:
    """Fire 'must-know' alerts to admins/operators for high-grade catalysts
    REGARDLESS of watchlist — the genuinely material stuff (M&A, FDA, big
    guidance/analyst moves) you need to know even if you don't own it.

    Operator-scoped (admins only) so subscribers don't get surprise pushes.
    Deduped via the SAME (user, ticker, market_date) table as watchlist alerts,
    so a name never double-pings. Reuses deliver_alert_payload → AlertBell +
    email + Discord. Gated OFF by default; opt in with
    CATALYST_MUSTKNOW_ALERTS_ENABLED=1. Grades via CATALYST_MUSTKNOW_GRADES
    (default 'A,B'). Returns count fired.
    """
    if os.environ.get("CATALYST_MUSTKNOW_ALERTS_ENABLED", "0").lower() not in ("1", "true", "yes"):
        return 0
    if not displayed:
        return 0

    grades = {g.strip().upper() for g in
              os.environ.get("CATALYST_MUSTKNOW_GRADES", "A,B").split(",") if g.strip()}
    rows = [c for c in displayed if (c.get("grade") or "").upper() in grades]
    if not rows:
        return 0

    admins = _collect_admin_user_ids()
    if not admins:
        return 0

    try:
        from api.services.watchlist_alert_service import deliver_alert_payload
    except Exception:
        logger.exception("[catalyst-engine] alert service unavailable (must-know)")
        return 0

    fired = 0
    for user_id in admins:
        for c in rows:
            ticker = (c.get("ticker") or "").upper()
            if not ticker:
                continue
            if not store.try_record_alert(user_id, ticker, market_date):
                continue
            grade = (c.get("grade") or "").upper()
            ctype = c.get("catalyst_type") or c.get("tag") or "Catalyst"
            gap = c.get("gap_pct") or 0.0
            thesis = (c.get("thesis_text") or "")[:300]
            title = f"🚨 Must-know {grade}: ${ticker} ({ctype})"
            message = f"{ticker} — grade {grade} {ctype} catalyst ({gap:+.2f}%). {thesis}"
            try:
                deliver_alert_payload(
                    user_id=user_id, sym=ticker, title=title, message=message,
                    source="catalyst_mustknow",
                    extra_data={"ticker": ticker, "grade": grade,
                                "catalyst_type": ctype, "gap_pct": gap,
                                "market_date": market_date},
                )
                fired += 1
            except Exception:
                logger.exception("[catalyst-engine] must-know delivery for %s/%s failed",
                                 user_id, ticker)

    if fired:
        logger.info("[catalyst-engine] fired %d must-know alerts", fired)
    return fired


def _today_market_date() -> str:
    return dt.datetime.now(_ET).date().isoformat()


def _enrich_top_3_with_deep_context(top_12: list[dict]) -> None:
    """For the 3 highest-scored candidates, run a richer Perplexity query
    that captures peer reaction, historical comparable setups, and broader
    context that simple source-feed signals miss.

    Cost: 3 queries per refresh × $0.005 ≈ $0.015 per refresh ≈ $40/mo.
    These are the rows the user will scrutinize most, so the marginal
    cost is well-spent on synthesis quality.

    Gated on CATALYST_PERPLEXITY_ENABLED. Skips candidates that already have
    rich source signals (>5 tweets + >2 RSS items) to avoid redundancy.
    """
    if os.environ.get("CATALYST_PERPLEXITY_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return

    try:
        from api.services import perplexity_search
    except Exception:
        return

    # Top 3 by score (already sorted by selection.select_top_12)
    for c in top_12[:3]:
        ticker = c.get("ticker")
        if not ticker:
            continue

        # Skip if already source-rich — Opus has plenty of context already
        tweet_count = len(c.get("tweets") or [])
        rss_count = len(c.get("rss") or [])
        if tweet_count > 5 and rss_count > 2:
            continue

        tag = c.get("tag") or "Catalyst"
        query = (
            f"Provide deep context on ${ticker} for a professional swing "
            f"trader. The stock is moving today with a '{tag}' tag. Cover: "
            f"(1) the specific catalyst details, (2) sell-side reaction "
            f"with any analyst PT changes, (3) how peers/sector are "
            f"reacting, (4) historical comparable setups for this kind of "
            f"move, (5) key levels or signals worth watching. Cite sources. "
            f"Be concise but specific with names, dates, and numbers."
        )
        try:
            result = perplexity_search.web_search(
                query, max_tokens=500,
                domain_pack="finance", recency="day",
            )
        except Exception:
            logger.exception("[catalyst-engine] perplexity top-3 %s failed", ticker)
            continue

        answer = (result or {}).get("answer") or ""
        if not answer or "error" in (result or {}):
            continue
        citations = (result or {}).get("citations") or []

        c.setdefault("rss", []).append({
            "source": "Perplexity (deep context)",
            "title": answer[:600],
            "url": citations[0] if citations else "",
            "time_published": int(time.time()),
        })
        c["rss_headline_count"] = len(c["rss"])


# Per-day per-ticker guard so the reasoning-mode deep pass runs AT MOST ONCE
# per ticker per day. The 2-min pre-market cadence would otherwise re-pay the
# (~2-3x fast) reasoning cost on every refresh for the same names.
_DEEP_CONTEXT_DONE: dict[str, set[str]] = {}


def _enrich_top_movers_deep_context(candidates: list[dict], market_date: str) -> None:
    """DEEP reasoning-mode Perplexity context pass over the top movers.

    For the highest-scored candidates, ask a skeptical sell-side analyst (via
    Perplexity reasoning-mode / sonar-reasoning-pro) to confirm the SPECIFIC
    catalyst with concrete numbers, the market read, key technical levels, and
    what could extend/reverse the move. Injects the synthesis as a synthetic
    RSS item (same shape as the other Perplexity enrichers) so Opus picks it
    up at synthesis time.

    Additive + cost-bounded + anti-hallucination:
    - Gated on CATALYST_DEEP_CONTEXT_ENABLED (default ON). Disable → no deep pass.
    - Top-N capped by CATALYST_DEEP_CONTEXT_TOP_N (default 5).
    - Per-(day, ticker) cache → at most one reasoning call per ticker per day.
    - Skips source-rich rows (>5 tweets + >2 RSS), like the fast top-3 pass.
    - Drops answers that error, are empty, say "no confirmed catalyst", or are
      low-info hedging filler — so we never inject vacuous context.

    Supersedes _enrich_top_3_with_deep_context (the old fast top-3 pass).
    Never raises.
    """
    if os.environ.get("CATALYST_DEEP_CONTEXT_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return

    try:
        from api.services import perplexity_search
    except Exception:
        return

    try:
        top_n = int(os.environ.get("CATALYST_DEEP_CONTEXT_TOP_N", "5"))
    except (TypeError, ValueError):
        top_n = 5
    mode = os.environ.get("CATALYST_DEEP_CONTEXT_MODE", "reasoning")
    try:
        max_tokens = int(os.environ.get("CATALYST_DEEP_CONTEXT_MAX_TOKENS", "700"))
    except (TypeError, ValueError):
        max_tokens = 700

    done = _DEEP_CONTEXT_DONE.setdefault(market_date, set())

    ranked = sorted(candidates, key=lambda c: c.get("score", 0.0), reverse=True)
    for c in ranked[:top_n]:
        ticker = c.get("ticker")
        if not ticker:
            continue
        if ticker in done:
            continue

        # Skip if already source-rich — Opus has plenty of context already.
        tweet_count = len(c.get("tweets") or [])
        rss_count = len(c.get("rss") or [])
        if tweet_count > 5 and rss_count > 2:
            continue

        gap = c.get("gap_pct") or 0.0
        direction = "up" if gap >= 0 else "down"
        prompt = (
            f"Stock ${ticker} is moving {direction} {abs(gap):.1f}% today. "
            f"As a skeptical sell-side analyst, using only reliable financial "
            f"news/filings: (1) state the SPECIFIC confirmed catalyst with "
            f"concrete details (numbers, guidance, deal terms); (2) the market "
            f"read (peer/sector reaction); (3) key technical levels to watch; "
            f"(4) what could extend or reverse the move. If you CANNOT confirm "
            f"a specific catalyst from reliable sources, reply exactly "
            f"'No confirmed catalyst.' Do not speculate."
        )

        # Mark done regardless of outcome below — one (attempted) reasoning call
        # per ticker per day, whether it injects or drops.
        done.add(ticker)

        try:
            result = perplexity_search.web_search(
                prompt, max_tokens=max_tokens, mode=mode,
                domain_pack="finance", recency="day",
            )
        except Exception:
            logger.exception("[catalyst-engine] perplexity deep-context %s failed", ticker)
            continue

        result = result or {}
        if "error" in result:
            continue
        answer = result.get("answer") or ""
        if not answer.strip():
            continue
        if "no confirmed catalyst" in answer.lower():
            continue
        if _is_low_info_sector_answer(answer):
            continue

        citations = result.get("citations") or []
        url = citations[0] if citations else ""
        title = answer[:600]

        rss = c.setdefault("rss", [])
        # Dedup against existing items by url/title so re-runs don't pile up.
        if any((url and r.get("url") == url) or r.get("title") == title for r in rss):
            c["rss_headline_count"] = len(rss)
            continue
        rss.append({
            "source": "Perplexity (deep context)",
            "title": title,
            "url": url,
            "time_published": int(time.time()),
        })
        c["rss_headline_count"] = len(rss)


def _enrich_earnings_with_perplexity(candidates: list[dict]) -> None:
    """For each top-12 candidate tagged 'Earnings', ask Perplexity for the
    things Finnhub's EPS/rev numbers don't tell us: forward guidance, sell-side
    reaction, notable PT changes. Injected as a synthetic RSS item so Opus
    picks it up in the prompt.

    Cost: ~3 earnings rows per refresh × $0.005 ≈ $0.015 per refresh ≈ $0.45/day.
    Gated on CATALYST_PERPLEXITY_ENABLED.
    """
    if os.environ.get("CATALYST_PERPLEXITY_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return

    try:
        from api.services import perplexity_search
    except Exception:
        return

    for c in candidates:
        if c.get("tag") != "Earnings":
            continue
        ticker = c.get("ticker")
        if not ticker:
            continue

        em = c.get("earnings_meta") or {}
        when = em.get("timing", "")
        query = (
            f"${ticker} reported earnings recently ({when} timing). "
            f"What is the specific forward guidance management gave? "
            f"What are notable sell-side reactions, including any analyst "
            f"price target changes, upgrades, or downgrades? "
            f"What's the specific reason the stock is moving in response? "
            f"Cite sources. Be concise."
        )
        try:
            result = perplexity_search.web_search(
                query, max_tokens=400,
                domain_pack="finance", recency="day",
            )
        except Exception:
            logger.exception("[catalyst-engine] perplexity earnings %s failed", ticker)
            continue

        answer = (result or {}).get("answer") or ""
        if not answer or "error" in (result or {}):
            continue
        citations = (result or {}).get("citations") or []

        c.setdefault("rss", []).append({
            "source": "Perplexity (earnings)",
            "title": answer[:400],
            "url": citations[0] if citations else "",
            "time_published": int(time.time()),
        })
        c["rss_headline_count"] = len(c["rss"])


def _enrich_with_ticker_news(candidates: list[dict]) -> None:
    """For each top-12 candidate that is THIN on a catalyst (no RSS, <2 tweet
    mentions, no earnings), pull free Google News headlines for "{ticker} stock"
    and inject them as synthetic 'rss' items. This fills the "why" with a free
    source BEFORE the paid Perplexity zero-signal fallback fires — so Perplexity
    fires less.

    Mutates candidates in-place. Gated on CATALYST_NEWS_FETCH_ENABLED (default
    on). Never raises — per-candidate errors are swallowed.
    """
    if os.environ.get("CATALYST_NEWS_FETCH_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return

    try:
        from api.services import news_search
    except Exception:
        return

    count = int(os.environ.get("CATALYST_NEWS_FETCH_COUNT", "5"))

    for c in candidates:
        thin = (
            (c.get("rss_headline_count") or 0) == 0
            and (c.get("tweet_mention_count") or 0) < 2
            and not c.get("earnings_meta")
        )
        if not thin:
            continue

        ticker = c.get("ticker")
        if not ticker:
            continue

        # "{ticker} stock" (NOT a cashtag — cashtags match poorly in general news)
        try:
            result = news_search.search_news(f"{ticker} stock", count=count)
        except Exception:
            logger.exception("[catalyst-engine] news_search %s failed", ticker)
            continue

        # search_news returns results under "headlines" (defensive: also "results")
        rows = (result or {}).get("headlines") or (result or {}).get("results") or []
        if not rows:
            continue

        existing = c.setdefault("rss", [])
        seen_urls = {(it.get("url") or "").strip() for it in existing if it.get("url")}
        seen_titles = {(it.get("title") or "").strip().lower() for it in existing}

        for r in rows:
            url = (r.get("url") or "").strip()
            title = (r.get("title") or "").strip()
            if not title:
                continue
            # Dedup by url (fallback title)
            if url and url in seen_urls:
                continue
            if not url and title.lower() in seen_titles:
                continue
            existing.append({
                "source": "Google News",
                "title": title,
                "url": r.get("url"),
                "time_published": _iso_to_unix(r.get("published")),
            })
            if url:
                seen_urls.add(url)
            seen_titles.add(title.lower())

        c["rss_headline_count"] = len(existing)


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
                 f"Cite earnings or guidance, M&A, FDA decisions, "
                 f"contract/customer wins, analyst upgrades/downgrades, "
                 f"product launches, partnerships, index inclusion, or a "
                 f"technical breakout, or any breaking news. If no clear "
                 f"catalyst exists, say so plainly.")
        try:
            result = perplexity_search.web_search(
                query, max_tokens=300,
                domain_pack="finance", recency="day",
            )
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
    skip_at = int(os.environ.get("CATALYST_TWITTER_SEARCH_SKIP_AT", "8"))
    max_results = int(os.environ.get("CATALYST_TWITTER_SEARCH_MAX", "30"))
    for c in candidates:
        existing = len(c.get("tweets") or [])
        if existing >= skip_at:
            # Already rich; skip the Twitter search call
            continue
        try:
            extra = twitterapi_io.search_tweets(
                query=f"${c['ticker']}",
                since_unix=since_unix,
                query_type="Latest",
                max_results=max_results,
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
                    # Carry the tweet's true publish time so _compute_catalyst_at
                    # can use it. Previously dropped here → every advanced-search
                    # sourced catalyst silently fell back to thesis_at (which made
                    # batches of unrelated tickers all share the same "When" time).
                    "created_at": t.get("created_at"),
                })
                seen_ids.add(tid)
        c["tweets"] = merged
        c["tweet_mention_count"] = len(merged)


def _enrich_with_analyst_actions(top: list[dict]) -> None:
    """For selected names lacking analyst_meta, check Finnhub for a recent
    upgrade/downgrade so analyst-driven gappers are explained even before the
    daily wire push lands. Bounded to the selected set. Best-effort."""
    from api.services.catalyst.analyst_actions import finnhub_recent_action
    for c in top:
        if c.get("analyst_meta"):
            continue
        try:
            meta = finnhub_recent_action(c.get("ticker") or "")
        except Exception:
            meta = None
        if meta:
            c["analyst_meta"] = meta


def run_refresh() -> dict:
    """Single full pass. Returns summary dict for logging.
    Never raises — all errors swallowed + logged."""
    md = _today_market_date()
    summary = {"market_date": md, "candidates": 0, "scored": 0,
               "selected": 0, "synthesized": 0, "errors": []}

    # Catalyst Hunter mode: deep on the first run of the day, light thereafter.
    # Per-date flag file in the catalysts.db dir marks that today's deep sweep ran.
    hunter_mode = "deep"
    existing_tickers = None
    try:
        _ddir = os.path.dirname(os.environ.get("CATALYST_DB_PATH", "/data/catalysts.db")) or "."
        _flag = os.path.join(_ddir, f".hunter_deep_{md}")
        if os.path.exists(_flag):
            hunter_mode = "light"
            existing_tickers = {(r.get("ticker") or "").upper()
                                for r in store.get_for_date(md, ranked_only=False)
                                if r.get("ticker")}
        else:
            try:
                open(_flag, "w").close()
            except Exception:
                pass
    except Exception:
        pass

    try:
        candidates = sources.collect_all(run_hunter=True, hunter_mode=hunter_mode,
                                         existing_tickers=existing_tickers)
    except Exception as e:
        logger.exception("[catalyst-engine] source collection failed")
        summary["errors"].append(f"collect: {e}")
        return summary

    summary["candidates"] = len(candidates)
    if not candidates:
        # Clear today's ranks even on an empty pull (holiday / all sources down)
        # so stale ranked rows from a prior refresh don't persist indefinitely.
        try:
            store.clear_ranks_for_date(md)
        except Exception:
            logger.exception("[catalyst-engine] clear_ranks on empty pull failed")
        logger.info("[catalyst-engine] no candidates this tick — cleared ranks")
        return summary

    # Two gates run BEFORE scoring + selection, so junk never enters the scored
    # pool and the forced tag quotas come up short rather than backfilling junk:
    #   1. quality_gate    — judges the TICKER (price/liquidity/market-cap).
    #   2. is_real_catalyst — judges the SITUATION (is anything actually
    #                         happening? real move / volume / hard catalyst).
    kept: list[dict] = []
    excluded: dict[str, str] = {}
    for c in candidates:
        passed, reason = filters.quality_gate(c)
        if passed:
            passed, reason = filters.is_real_catalyst(c)
        if passed:
            kept.append(c)
        else:
            sym = (c.get("ticker") or "").upper()
            excluded[sym] = reason or "excluded"
            try:
                adv = c.get("avg_volume_30d") or c.get("today_volume") or 0
                store.log_rejection(
                    market_date=md, ticker=sym, reason=reason or "excluded",
                    price=c.get("price"),
                    dollar_vol=(float(c.get("price") or 0) * float(adv)) or None,
                    float_shares=c.get("float_shares") or c.get("shares_outstanding"),
                    market_cap=c.get("market_cap"),
                )
            except Exception:
                logger.debug("[catalyst-engine] rejection log failed for %s", sym)
    _EXCLUDED_BY_DATE[md] = excluded
    summary["excluded"] = len(excluded)
    if excluded:
        logger.info("[catalyst-engine] gates excluded %d candidates "
                    "(junk + non-catalysts)", len(excluded))
    candidates = kept

    # Freshness: a name not RANKED in the prior N days is "new" (breaking today);
    # one that was is "developing" (a multi-day continuation). Computed once here,
    # consulted per-candidate in the scoring loop below. Never raises.
    fresh_lookback = int(os.environ.get("CATALYST_FRESHNESS_LOOKBACK_DAYS", "3"))
    try:
        recent_ranked = store.recent_ranked_tickers(md, days=fresh_lookback)
    except Exception:
        recent_ranked = set()

    for c in candidates:
        c["tag"] = tagging.assign_tag(c)
        c["is_new"] = (c.get("ticker") or "").upper() not in recent_ranked
        c["score"] = scoring.score(c)
    scored = [c for c in candidates if c.get("tag")]
    summary["scored"] = len(scored)

    top_12 = selection.select_top_12(scored)
    summary["selected"] = len(top_12)

    # Tier 1C: enrich top-12 with broader Twitter search before synthesis.
    # Bounded — skips tickers that already have ≥5 tweets from curated accounts.
    _enrich_with_twitter_search(top_12)

    # Analyst-action enrichment: catch analyst-driven movers pre-wire-push.
    _enrich_with_analyst_actions(top_12)

    # Free per-mover "why" fetch: pull Google News for THIN candidates first
    # so the paid Perplexity zero-signal fallback below fires less often.
    _enrich_with_ticker_news(top_12)

    # Tier 2-1: Perplexity fallback for tickers with zero source signals.
    # Runs AFTER Twitter search so it only fires when even broad search
    # turned up nothing. Bounded by zero-signals check.
    _enrich_with_perplexity(top_12)

    # P1-C1: Earnings-tagged rows get a Perplexity deep-dive for guidance +
    # sell-side context that Finnhub's eps/rev numbers don't carry.
    _enrich_earnings_with_perplexity(top_12)

    # P2-B1 superseded: DEEP reasoning-mode pass over the top movers — confirmed
    # catalyst + market read + key levels + extend/reverse. Cost-capped by per-day
    # per-ticker cache + top-N; anti-hallucination drops unconfirmed answers.
    # (Old fast top-3 pass `_enrich_top_3_with_deep_context` kept for rollback.)
    _enrich_top_movers_deep_context(top_12, md)

    store.clear_ranks_for_date(md)

    # Synthesize everything first, then hide grade-C rows from the RANKED list.
    # They still get stored (unranked) for history + the "Why isn't X" explainer.
    # Big movers with no fresh news are graded B (momentum) by the prompt, so
    # they survive — only genuine noise lands at C.
    hide_c = os.environ.get("CATALYST_HIDE_GRADE_C", "1").lower() in ("1", "true", "yes")
    synthesized: list[tuple[dict, dict]] = []
    for c in top_12:
        try:
            thesis = synthesize.synthesize_ticker(c, md)
        except Exception as e:
            logger.exception("[catalyst-engine] synthesize failed for %s",
                             c.get("ticker"))
            summary["errors"].append(f"synth_{c.get('ticker')}: {e}")
            continue
        synthesized.append((c, thesis))

    rank = 0
    hidden_c = 0
    displayed: list[dict] = []   # ranked, non-grade-C rows actually shown
    for c, thesis in synthesized:
        grade = thesis.get("grade")
        # Enrich the candidate so alert paths (watchlist + must-know) can read
        # grade / thesis / type without re-querying the store.
        c["grade"] = grade
        c["thesis_text"] = thesis.get("thesis_text")
        # Prefer the synthesizer's type; fall back to the hunter's so a
        # hunter-sourced row still has a type even if the thesis omitted one.
        c["catalyst_type"] = thesis.get("catalyst_type") or c.get("catalyst_type")
        # pre_move: a confirmed catalyst whose stock hasn't reacted yet.
        c["pre_move"] = 1 if (c.get("hunter_confirmed") and abs(c.get("gap_pct") or 0)
                              < float(os.environ.get("CATALYST_PRE_MOVE_GAP", "2.0"))) else 0
        if hide_c and grade == "C":
            row_rank = None
            hidden_c += 1
        else:
            rank += 1
            row_rank = rank
            displayed.append(c)

        catalyst_at = _compute_catalyst_at(c)

        try:
            store.upsert_catalyst({
                "market_date": md,
                "ticker": c["ticker"],
                "rank": row_rank,
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
                "grade": grade,
                "catalyst_type": c.get("catalyst_type"),
                "is_new": 1 if c.get("is_new") else 0,
                "pre_move": c.get("pre_move", 0),
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

    if hidden_c:
        summary["hidden_grade_c"] = hidden_c
        logger.info("[catalyst-engine] hid %d grade-C rows from ranked list", hidden_c)

    # P2-E1: sector-framing banner. Computed from the DISPLAYED rows (ranked,
    # non-grade-C) — NOT top_12 — so the count matches what's on screen and a
    # cluster of grade-C noise can't conjure a banner about tickers that were
    # hidden. Only fires when 3+ REAL catalysts share a sector.
    try:
        sector_contexts = _compute_sector_context(displayed)
        _SECTOR_CONTEXT_BY_DATE[md] = sector_contexts
        if sector_contexts:
            summary["sector_contexts"] = len(sector_contexts)
    except Exception:
        logger.exception("[catalyst-engine] sector context computation failed")

    # Tier B-1: Fire alerts only for DISPLAYED catalysts on a user's watchlist
    # (a grade-C row hidden from the table shouldn't trigger an alert). Deduped
    # per (user, ticker, market_date) so a sticky catalyst doesn't spam.
    try:
        alerts_fired = _fire_catalyst_alerts(displayed, md)
        if alerts_fired:
            summary["alerts_fired"] = alerts_fired
    except Exception:
        logger.exception("[catalyst-engine] alert firing failed")

    # Must-know alerts: high-grade (A/B) catalysts pushed to operators even when
    # not on a watchlist. Gated OFF by default (CATALYST_MUSTKNOW_ALERTS_ENABLED).
    try:
        mustknow_fired = _fire_mustknow_alerts(displayed, md)
        if mustknow_fired:
            summary["mustknow_fired"] = mustknow_fired
    except Exception:
        logger.exception("[catalyst-engine] must-know alert firing failed")

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
                "is_new": 1 if c.get("is_new") else 0,
                "raw_signals": "{}",
            })
        except Exception:
            pass

    logger.info("[catalyst-engine] refresh done: %s", summary)
    return summary
