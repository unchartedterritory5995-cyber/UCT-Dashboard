"""Unified social sentiment for a ticker — combines Twitter (curated
trader feed), Reddit (r/wsb / r/stocks / etc), and Stocktwits.

Single voice call replaces three. Each source is fetched in parallel
and degrades gracefully if its API is unavailable.
"""

import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any

_log = logging.getLogger(__name__)
_PER_SOURCE_TIMEOUT = 10


def _safe_call(fn, *args, timeout: float = _PER_SOURCE_TIMEOUT, **kwargs):
    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            return ex.submit(fn, *args, **kwargs).result(timeout=timeout)
    except (FutureTimeout, Exception) as e:
        _log.warning("sentiment subcall failed: %s", e)
        return None


def _verdict_to_score(verdict: str | None) -> float:
    """Map verbal verdicts to comparable -1..+1 scores so we can compute
    an aggregate agreement signal."""
    if not verdict:
        return 0.0
    v = verdict.lower()
    if v == "bullish":
        return 1.0
    if v == "bearish":
        return -1.0
    return 0.0  # mixed / neutral / no_chatter / etc


def aggregate(ticker: str) -> dict[str, Any]:
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    # Fire all three in parallel
    def _twitter():
        try:
            from api.services import tweet_store
            rows = tweet_store.tweets_for_ticker(sym, hours=24)
            if not rows:
                return {"verdict": "no_chatter", "count": 0}
            # Crude bull/bear keyword counter for tweets
            import re
            bull_re = re.compile(r"\b(bull|moon|breakout|rip|long|buy|squeeze)\b|🚀|💎", re.I)
            bear_re = re.compile(r"\b(bear|dump|crash|short|sell|tank|drilling|put)\b|📉", re.I)
            bull = bear = 0
            for r in rows:
                txt = r.get("text") or ""
                bull += len(bull_re.findall(txt))
                bear += len(bear_re.findall(txt))
            total = bull + bear
            score = (bull - bear) / total if total else 0.0
            verdict = "bullish" if score > 0.2 else "bearish" if score < -0.2 else "mixed"
            return {"verdict": verdict, "count": len(rows),
                    "bull": bull, "bear": bear, "net_score": round(score, 3)}
        except Exception as e:
            _log.warning("twitter aggregate failed: %s", e)
            return None

    def _reddit():
        try:
            from api.services.reddit_sentiment import sentiment_for_ticker
            return sentiment_for_ticker(sym, hours=24)
        except Exception as e:
            _log.warning("reddit aggregate failed: %s", e)
            return None

    def _stocktwits():
        try:
            from api.services.stocktwits_sentiment import sentiment_for_ticker
            return sentiment_for_ticker(sym)
        except Exception as e:
            _log.warning("stocktwits aggregate failed: %s", e)
            return None

    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {"twitter": ex.submit(_twitter),
                   "reddit":  ex.submit(_reddit),
                   "stocktwits": ex.submit(_stocktwits)}
        results: dict[str, Any] = {}
        for name, fut in futures.items():
            try:
                results[name] = fut.result(timeout=_PER_SOURCE_TIMEOUT)
            except Exception as e:
                _log.warning("aggregate.%s failed: %s", name, e)
                results[name] = None

    # Build verdict array (None / error sources excluded from agreement calc)
    verdicts = []
    for name, r in results.items():
        if isinstance(r, dict) and not r.get("error") and r.get("verdict"):
            verdicts.append({"source": name, "verdict": r["verdict"],
                            "score": _verdict_to_score(r.get("verdict"))})

    if not verdicts:
        return {"ticker": sym, "verdict": "no_data", "sources": results,
                "agreement": None}

    avg_score = sum(v["score"] for v in verdicts) / len(verdicts)
    overall = (
        "bullish" if avg_score > 0.35 else
        "bearish" if avg_score < -0.35 else
        "mixed"
    )

    # Agreement: do all sources lean the same way?
    nonzero = [v for v in verdicts if v["score"] != 0]
    if not nonzero:
        agreement = "neutral_across_sources"
    elif all(v["score"] > 0 for v in nonzero):
        agreement = "unanimous_bullish"
    elif all(v["score"] < 0 for v in nonzero):
        agreement = "unanimous_bearish"
    else:
        agreement = "mixed_across_sources"

    return {
        "ticker": sym,
        "verdict": overall,
        "agreement": agreement,
        "sources_consulted": [v["source"] for v in verdicts],
        "sources_failed": [k for k, v in results.items() if not v or (isinstance(v, dict) and v.get("error"))],
        "twitter": results.get("twitter"),
        "reddit": results.get("reddit"),
        "stocktwits": results.get("stocktwits"),
    }
