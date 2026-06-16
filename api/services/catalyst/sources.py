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

# Securities-litigation / investor-alert boilerplate — never a catalyst.
_LEGAL_NOISE_RE = re.compile(
    r"investor notice|shareholder alert|class action|securities fraud"
    r"|investigat\w* claims|deadline reminder|lead plaintiff"
    r"|law firm|llp announces|llp continues|llp reminds",
    re.IGNORECASE)

# Real tickers that are also corporate-suffix words — a bare-word guess for
# these is almost always part of ANOTHER company's name ("Comfort Systems
# USA", "OSE Immunotherapeutics SA"). They can still attach via an explicit
# $cashtag or their own company-name match.
_BARE_TICKER_DENY = {"USA", "SA", "NV", "AG", "SE", "CO", "PLC", "LTD",
                     "CORP", "INC", "LLC", "LLP", "GRP", "HLDG"}


def _today_market_date() -> str:
    return dt.datetime.now(_ET).date().isoformat()


def _now_et() -> dt.datetime:
    return dt.datetime.now(_ET)


def _envf(name: str, default: float) -> float:
    """Read a float threshold from env, or return default."""
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


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

        # 52-week-high breakout signal: price at/near the 52w high = a core
        # swing setup the news feeds don't flag. Near = within (1 - pct) of high.
        fwh = m.get("fifty_two_week_high")
        near_pct = _envf("CATALYST_52W_NEAR_PCT", 0.98)
        near_52w_high = bool(fwh and price > 0 and price >= float(fwh) * near_pct)

        out[ticker_u] = {
            "price": price,
            "vol_x": vol_x,
            "market_cap": m.get("market_cap"),
            "sector": m.get("sector"),
            "change_pct": float(change_pct) if change_pct is not None else None,
            "open_gap_pct": open_gap_pct,  # frozen at 9:30 ET, None pre-market
            # Raw volumes carried through for the quality gate (dollar-volume
            # liquidity filter). avg_volume_30d preferred; today_volume is the
            # fallback when ADV hasn't cached yet.
            "avg_volume_30d": adv or None,
            "today_volume": today_vol or None,
            "fifty_two_week_high": float(fwh) if fwh else None,
            "near_52w_high": near_52w_high,
            "quote_type": m.get("quote_type"),
            "float_shares": m.get("float_shares"),
            "shares_outstanding": m.get("shares_outstanding"),
        }
    return out


# ── Source 3: Earnings ──────────────────────────────────────────────────
def _earnings_publish_time(timing: str) -> Optional[int]:
    """Inferred 'when did this earnings event hit the wire' for BMO / AMC rows.

    EW and Finnhub don't always return a precise publish timestamp, so we
    approximate so catalyst_at has something to fall back on instead of None
    (which would force the UI to show thesis_at as the catalyst time and make
    batches of unrelated rows share the same time).

    BMO -> 7:00 AM ET today (most pre-market releases happen 6-7 AM ET)
    AMC -> 4:30 PM ET yesterday (most after-hours releases happen 4:00-4:30 PM ET)
    """
    et = ZoneInfo("America/New_York")
    now_et = dt.datetime.now(et)
    if timing == "bmo":
        target = now_et.replace(hour=7, minute=0, second=0, microsecond=0)
    elif timing == "amc":
        target = (now_et - dt.timedelta(days=1)).replace(
            hour=16, minute=30, second=0, microsecond=0)
    else:
        return None
    return int(target.timestamp())


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
                "publish_time": _earnings_publish_time(when_label),
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
    """Returns {ticker: [tweet, ...]} for recently cashtagged tickers, plus
    company-NAME mentions (news_match) — squawk accounts often write
    "Rocket Lab wins contract" with no cashtag, which the ingest-time
    cashtag extractor can't link."""
    from api.services import tweet_store
    from api.services.catalyst import news_match
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
    # Name-match pass over the raw tweet stream for tickers the cashtag
    # extractor missed. Dedup per (ticker, tweet id) against the pass above.
    try:
        seen = {(tk, t.get("id")) for tk, ts in out.items() for t in ts}
        for tw in tweet_store.feed(hours=24, limit=200):
            matched = news_match.match_tickers(tw.get("text") or "")
            already = {x.upper() for x in (tw.get("tickers") or [])}
            for ticker in matched - already:
                if (ticker, tw.get("id")) in seen:
                    continue
                seen.add((ticker, tw.get("id")))
                out[ticker].append({
                    "author_handle": tw.get("author_handle"),
                    "text": tw.get("text", ""),
                    "url": tw.get("url"),
                    "id": tw.get("id"),
                    "created_at": tw.get("created_at"),
                })
    except Exception:
        logger.exception("[catalyst-sources] tweet name-match failed (non-fatal)")
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
    """Pull recent RSS items; extract ticker mentions via cashtag regex
    + company-name matching (news_match, Approach 2 v1)."""
    from api.services.news_aggregator import fetch_rss_news
    from api.services.catalyst import news_match
    out: dict[str, list[dict]] = defaultdict(list)
    today = _today_market_date()
    items = _safe(lambda: fetch_rss_news(today, limit=80) or [],
                  default=[], name="rss_news")
    # Persist the live pull and read back the 48h window — feeds only hold
    # ~80 items, so an evening catalyst (the 2026-06-11 Nasdaq-100
    # reconstitution) is gone from every feed by the premarket refresh.
    # Store failure degrades to the live items, never worse than before.
    try:
        from api.services.catalyst import news_store
        news_store.upsert_items(items)
        stored = news_store.recent_items()
        if stored:
            items = stored
    except Exception:
        logger.exception("[catalyst-sources] news store failed (non-fatal)")
    for item in items:
        title = item.get("title") or item.get("headline") or ""
        summary = item.get("summary") or ""
        text = f"{title} {summary}"
        # Law-firm boilerplate ("Shareholder Alert", "INVESTOR NOTICE",
        # class-action deadline reminders) is not a catalyst — it minted
        # junk Catalyst rows (GPGI/FSK reached selection 2026-06-12).
        if _LEGAL_NOISE_RE.search(text):
            continue
        tickers = set(_CASHTAG_RE.findall(text.upper()))
        # Upstream news_aggregator guesses tickers from ANY bare 2-5-letter
        # uppercase word (FIFA/USMNT/LLP/USA arrived as "tickers") — accept
        # bare-word guesses only when they're real cap-universe symbols.
        _uni = news_match.universe_set()
        for t in (item.get("tickers") or []):
            t = (t or "").upper()
            if t and t not in _BARE_TICKER_DENY and (not _uni or t in _uni):
                tickers.add(t)
        # Approach 2 v1: headlines name COMPANIES, not cashtags ("Rocket Lab,
        # Nebius, Astera Labs, CoreWeave, Teradyne to join Nasdaq-100" attached
        # to zero tickers on 2026-06-12). Match company names from the
        # cap-universe meta cache; matched tickers become candidates (an
        # RSS-only ticker enters the universe like any other source's).
        try:
            tickers |= news_match.match_tickers(text)
        except Exception:
            logger.exception("[catalyst-sources] news name-match failed (non-fatal)")
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
    # Bare-word guesses (no $) must be real cap-universe symbols — Perplexity
    # prose is littered with AWS/EV/GMM-style non-tickers. Cashtags bypass
    # this (explicit + trusted). Fail-open if the universe can't load.
    try:
        from api.services.catalyst import news_match
        uni = news_match.universe_set()
        if uni:
            cashtags = {(c or "").upper() for c, _ in _DISCOVERY_TICKER_RE.findall(text) if c}
            tickers = {t for t in tickers if t in cashtags or t in uni}
    except Exception:
        pass
    return tickers


# List-mode system prompt for the discovery queries. The module default in
# perplexity_search instructs "2-4 sentences of plain prose", which silently
# capped discovery at ~1 ticker per answer (found 2026-06-12).
_DISCOVERY_SYSTEM = (
    "You are a market-news scanner for a trading desk. Output ONLY a list, "
    "one line per stock, format: $TICKER — one-sentence catalyst (what "
    "happened and when). Include as many distinct US stocks as the sources "
    "support, up to 15. No preamble, no advice, no disclaimers."
)


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
    is_rth = (9 <= hour < 16) and not is_premarket
    is_after_hours = 16 <= hour < 20
    is_eod_window = 16 <= hour < 20  # 4 PM – 8 PM ET — post-close prep
    if is_premarket:
        session_phrase = "in pre-market trading today (before US market open)"
    elif is_rth:
        session_phrase = "during regular US trading hours today"
    elif is_after_hours:
        session_phrase = "in after-hours trading today"
    else:
        session_phrase = "today, including the most recent US trading session"

    # ── A1: always-on broad discovery ──────────────────────────────────
    # REBUILT 2026-06-12 — the old config returned ~0-2 tickers/query for
    # three stacked reasons, measured live via a prompt/params grid:
    #   1. perplexity_search's DEFAULT system prompt says "reply in 2-4
    #      sentences" — it capped every discovery answer at ~700 chars no
    #      matter what the query asked. Discovery now passes its own
    #      list-mode system prompt.
    #   2. recency="day" starved the search index to nothing (1 ticker);
    #      "today" in the prompt anchors freshness instead, and the
    #      activity gate drops anything that isn't actually moving.
    #   3. domain_pack="finance" halved coverage vs general (8 vs 16).
    #   Also: the old 10-category "top 15 + timestamps + citations" mega-
    #   prompt triggered refusals ("here's how you could build this list
    #   yourself"). Measured result of this config: 16 tickers/query.
    a1_query = (
        f"Which individual US stocks are moving {session_phrase} on "
        f"company-specific news — earnings reactions, M&A, FDA decisions, "
        f"analyst upgrades/downgrades, contract wins, index inclusions?"
    )
    try:
        a1_result = perplexity_search.web_search(
            a1_query, max_tokens=1200, system=_DISCOVERY_SYSTEM,
            domain_pack="general",
        )
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

    # ── F1: EOD tomorrow-setup query (4 PM – 8 PM ET only) ─────────────
    # Seeds tomorrow morning's candidate pool with stuff known after-hours:
    # AMC earnings reactions, post-close analyst actions, M&A announcements,
    # tomorrow's BMO reporters with notable setups, etc.
    if is_eod_window:
        f1_query = (
            "Which individual US stocks have catalysts setting up for "
            "tomorrow's market open — after-hours earnings reactions, "
            "post-close M&A or guidance, expected FDA decisions, analyst "
            "actions, or companies reporting before tomorrow's open?"
        )
        try:
            f1_result = perplexity_search.web_search(
                f1_query, max_tokens=1200, system=_DISCOVERY_SYSTEM,
                domain_pack="general",
            )
            f1_text = (f1_result or {}).get("answer") or ""
            f1_citations = (f1_result or {}).get("citations") or []
            for sym in _extract_tickers_from_text(f1_text):
                out[sym].append({
                    "source": "Perplexity (EOD setup)",
                    "title": f1_text[:400],
                    "url": f1_citations[0] if f1_citations else "",
                    "time_published": int(time.time()),
                })
            if f1_text:
                logger.info("[catalyst-sources] perplexity EOD-setup found %d tickers",
                            len(_extract_tickers_from_text(f1_text)))
        except Exception:
            logger.exception("[catalyst-sources] perplexity F1 EOD failed")

    # Note: D1 pre-market query removed 2026-05-27 — overlapped with A1
    # in the 4-9:30 AM ET window. Session-aware A1 prompt above now covers
    # the pre-market case directly. Saves ~1 paid query/refresh.

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


# ── Source 7: Broad market gap-scan ─────────────────────────────────────
def _pull_gap_scan() -> dict[str, dict]:
    """Find ANY liquid stock making a meaningful move — not just Massive's
    top-20 gainers/losers (which are ranked BY PERCENT, so modest-% big-cap
    NEWS movers — M&A, analyst PT changes, index inclusion — never make the
    cut). This is the source that surfaces names like NUVL/MU/SIRI/NBIS.

    Computes a PRE-MARKET-AWARE gap from last-trade vs prev-close. Massive's
    todaysChangePerc is ~0 pre-market (no regular-session trades yet) — which
    is exactly the window catalysts matter most — so we derive the move from
    lastTrade.p instead.

    Returns {ticker: {gap_pct}} (same shape as _pull_movers). Names are then
    enriched + run through the same quality gates / scoring / selection as
    every other source. Gated on CATALYST_GAPSCAN_ENABLED (default on).
    """
    if os.environ.get("CATALYST_GAPSCAN_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return {}
    try:
        from api.services.massive import _get_client
        snap = _get_client().get_full_market_snapshot() or {}
    except Exception as e:
        logger.warning("[catalyst-sources] gap_scan snapshot failed: %s", e)
        return {}

    min_pct = _envf("CATALYST_GAPSCAN_MIN_PCT", 3.0)
    min_price = _envf("CATALYST_GAPSCAN_MIN_PRICE", 3.0)
    min_dollar_vol = _envf("CATALYST_GAPSCAN_MIN_DOLLAR_VOL", 10_000_000.0)
    # Hard cap on how many gappers we hand downstream. On a volatile day a
    # bare gap≥3% filter returns 1000+ names — which both blows up the
    # snapshot/metadata enrichment AND is mostly penny-gapper noise. We rank
    # the survivors by DOLLAR-VOLUME (the best size/liquidity proxy we have
    # from a bare snapshot) and keep the most-traded N — i.e. the big, liquid
    # NEWS movers the user actually wants, not thin small-caps.
    max_names = int(_envf("CATALYST_GAPSCAN_MAX", 80))

    survivors: list[tuple[float, str, float]] = []  # (dollar_vol, sym, gap)
    for ticker, d in snap.items():
        sym = (ticker or "").upper()
        # v1: plain alpha symbols only (drops dotted class shares / units /
        # warrants / rights, which are noise for this use case).
        if not sym or len(sym) > 5 or not sym.isalpha():
            continue
        last = d.get("last_price") or 0.0
        prev = d.get("prev_close") or 0.0
        if last <= 0 or prev <= 0:
            continue
        gap = (last - prev) / prev * 100.0
        if abs(gap) < min_pct or last < min_price:
            continue
        # Liquidity floor: prev full-day volume preferred (stable, not inflated
        # by today's catalyst spike); today's volume as fallback.
        vol = d.get("prev_vol") or d.get("today_vol") or 0
        dollar_vol = last * vol
        if vol > 0 and dollar_vol < min_dollar_vol:
            continue
        survivors.append((dollar_vol, sym, round(gap, 2)))

    survivors.sort(key=lambda x: x[0], reverse=True)
    keep = {sym: gap for _dv, sym, gap in survivors[:max_names]}
    # Union in the biggest absolute gaps regardless of dollar-volume rank.
    # A pure by-dollar-volume cut lets megacap 4-percenters crowd out
    # smaller names making the day's REAL moves (OXM -19% on earnings missed
    # the top-50 on 2026-06-11). These already passed the price + $vol
    # floors above, so they're liquid — just not megacap-liquid.
    top_gap_n = int(_envf("CATALYST_GAPSCAN_TOP_GAP", 25))
    for _dv, sym, gap in sorted(survivors, key=lambda x: abs(x[2]),
                                reverse=True)[:top_gap_n]:
        keep.setdefault(sym, gap)
    return {sym: {"gap_pct": gap} for sym, gap in keep.items()}


# ── Source 8: Analyst actions (wire + optional TheFly) ──────────────────
def _pull_analyst_actions() -> dict[str, dict]:
    """{ticker: analyst_meta} for today (wire + optional TheFly)."""
    try:
        from api.services.catalyst.analyst_actions import get_analyst_candidates
        return get_analyst_candidates()
    except Exception as e:
        logger.warning("[catalyst-sources] analyst pull failed: %s", e)
        return {}


# ── Orchestrator ────────────────────────────────────────────────────────
def collect_all() -> list[dict]:
    """Runs all source pulls in parallel; merges into Candidate dicts
    keyed by ticker. Returns list of candidates (one per ticker)."""
    tasks = {
        "movers":     _pull_movers,
        "gap_scan":   _pull_gap_scan,
        "earnings":   _pull_earnings,
        "tweets":     _pull_tweet_signals,
        "rss":        _pull_rss_signals,
        "scanner":    _pull_scanner_setups,
        "perplexity": _pull_perplexity_discovery,
        "analyst":    _pull_analyst_actions,
    }
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=8, thread_name_prefix="cat-src") as ex:
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
    universe.update(results.get("gap_scan", {}).keys())
    universe.update(results.get("earnings", {}).keys())
    universe.update(results.get("tweets", {}).keys())
    universe.update(results.get("rss", {}).keys())
    universe.update(results.get("scanner", {}).keys())
    universe.update(results.get("perplexity", {}).keys())
    universe.update(results.get("analyst", {}).keys())

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
        analyst_meta = results.get("analyst", {}).get(ticker)

        sector = snap.get("sector")
        if sector:
            sector_counts[sector] += 1

        # gap_pct stored is the % change at synthesis time. Frontend will
        # overlay tick-by-tick live % change from useLivePrices when the
        # row renders; stored value is only the fallback during initial
        # load or for tickers outside the live-prices universe.
        #   1. snapshot change_pct (Massive todaysChangePerc — works in RTH)
        #   2. gap-scan last-vs-prevclose (PRE-MARKET-aware; snapshot is ~0
        #      pre-open so this is what makes the gate pass pre-market)
        #   3. movers feed gap_pct (fallback for tickers missing snapshot)
        #   4. 0.0
        gapscan_data = results.get("gap_scan", {}).get(ticker, {})
        snap_chg = snap.get("change_pct")
        if snap_chg is not None and abs(snap_chg) >= 0.01:
            gap_pct = float(snap_chg)
        elif gapscan_data.get("gap_pct") is not None:
            gap_pct = float(gapscan_data["gap_pct"])
        else:
            gap_pct = movers_data.get("gap_pct") or 0.0

        candidates.append({
            "ticker": ticker,
            "company": None,
            "price": snap.get("price"),
            "gap_pct": gap_pct,
            "vol_x": snap.get("vol_x", 1.0),
            "market_cap": snap.get("market_cap"),
            "avg_volume_30d": snap.get("avg_volume_30d"),
            "today_volume": snap.get("today_volume"),
            "sector": sector,
            "tweets": tweets,
            "rss": rss,
            "earnings_meta": em,
            "earnings_reported_recently": bool(em and em.get("reported_recently")),
            "earnings_just_reported": bool(em and em.get("reported_recently")),
            "tweet_mention_count": len(tweets),
            "rss_headline_count": len(rss),
            "scanner_setup": setup,
            # Flags this candidate as surfaced by the broad gap-scan, which lets
            # tagging treat it as a Gapper on gap alone (it's already liquidity-
            # + dollar-volume-qualified) without the big-cap-hostile vol_x>=3.
            "from_gap_scan": bool(gapscan_data),
            # 52-week-high breakout signal (price at/near new highs).
            "near_52w_high": snap.get("near_52w_high", False),
            "fifty_two_week_high": snap.get("fifty_two_week_high"),
            "float_shares": snap.get("float_shares"),
            "shares_outstanding": snap.get("shares_outstanding"),
            "analyst_meta": analyst_meta,
        })

    for c in candidates:
        c["sector_momentum_count"] = max(0, sector_counts.get(c.get("sector"), 0) - 1)

    return candidates
