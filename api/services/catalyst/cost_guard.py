"""Tracks daily spend, enforces soft + hard caps.

Anthropic pricing (USD per million tokens, 2026):
  claude-opus-4-7:   $15.00 input, $75.00 output
  claude-sonnet-4-6: $3.00  input, $15.00 output
  claude-haiku-4-5:  $0.80  input, $4.00  output
"""
import logging
import os

from api.services.catalyst import store

logger = logging.getLogger(__name__)

_SOFT_CAP_LOGGED_FOR_DATE: str | None = None
_HARD_CAP_TRIPPED = False

_PRICING = {
    "claude-opus-4-7":   {"input": 15.0, "output": 75.0},
    "claude-sonnet-4-6": {"input": 3.0,  "output": 15.0},
    "claude-haiku-4-5":  {"input": 0.80, "output": 4.0},
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """USD cost for one call. Returns 0 if model unknown."""
    # Tolerate dated model aliases like claude-haiku-4-5-20251001
    base = model.rsplit("-", 1)[0] if model.count("-") >= 3 else model
    rates = _PRICING.get(model) or _PRICING.get(base)
    if not rates:
        logger.warning("[cost_guard] unknown model pricing: %s", model)
        return 0.0
    return (input_tokens * rates["input"] / 1_000_000.0
            + output_tokens * rates["output"] / 1_000_000.0)


def may_synthesize(market_date: str) -> bool:
    """Returns False if hard cap exceeded for the day. Logs warning if soft
    cap exceeded but still returns True."""
    global _SOFT_CAP_LOGGED_FOR_DATE
    soft = float(os.environ.get("CATALYST_COST_CAP_DAILY", "8.00"))
    hard = float(os.environ.get("CATALYST_COST_HARD_CAP", "15.00"))

    stats = store.cost_stats_for_date(market_date)
    spent = stats.get("total_cost_usd", 0.0)

    if spent >= hard:
        if not _HARD_CAP_TRIPPED:
            logger.error("[cost_guard] HARD CAP exceeded for %s: $%.2f >= $%.2f. "
                         "Synthesis disabled for remainder of day.",
                         market_date, spent, hard)
        return False

    if spent >= soft and _SOFT_CAP_LOGGED_FOR_DATE != market_date:
        logger.warning("[cost_guard] soft cap exceeded for %s: $%.2f >= $%.2f. "
                       "Synthesis continues until hard cap $%.2f.",
                       market_date, spent, soft, hard)
        _SOFT_CAP_LOGGED_FOR_DATE = market_date

    return True


def record(market_date: str, ticker: str, model: str,
           input_tokens: int, output_tokens: int,
           was_cached: bool = False) -> float:
    """Record a synthesis call. Returns the cost in USD."""
    cost = 0.0 if was_cached else estimate_cost(model, input_tokens, output_tokens)
    store.log_cost(market_date=market_date, ticker=ticker, model=model,
                   input_tokens=input_tokens, output_tokens=output_tokens,
                   cost_usd=cost, was_cached=was_cached)
    return cost
