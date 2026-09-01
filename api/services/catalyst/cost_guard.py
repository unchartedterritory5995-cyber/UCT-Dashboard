"""Tracks daily spend, enforces soft + hard caps.

Anthropic pricing (USD per million tokens, 2026):
  claude-opus-5:     $5.00  input, $25.00 output
  claude-opus-4-8:   $5.00  input, $25.00 output
  claude-opus-4-7:   $5.00  input, $25.00 output
  claude-sonnet-5:   $3.00  input, $15.00 output
  claude-sonnet-4-6: $3.00  input, $15.00 output
  claude-haiku-4-5:  $1.00  input, $5.00  output
Server-side web search: $10 per 1,000 searches.
"""
import logging
import os

from api.services.catalyst import store

logger = logging.getLogger(__name__)

_SOFT_CAP_LOGGED_FOR_DATE: str | None = None
_HARD_CAP_TRIPPED = False

# Per-million-token rates. MUST carry an entry for whatever CATALYST_OPUS_MODEL /
# CONCIERGE_MODEL resolve to — estimate_cost() prices an unknown model at the
# priciest KNOWN rate and logs it, so the caps stay enforced but the number is a
# guess until the entry lands.
_PRICING = {
    # Opus 5 ships at Opus 4.8's list price — $5 in / $25 out per 1M (Anthropic
    # model table, cached 2026-06-24; the same figures flow_explain._PRICING
    # already carries for claude-opus-4-8). W0.4, 2026-08-25.
    "claude-opus-5":     {"input": 5.0,  "output": 25.0},
    "claude-opus-4-8":   {"input": 5.0,  "output": 25.0},
    "claude-opus-4-7":   {"input": 5.0,  "output": 25.0},
    "claude-sonnet-5":   {"input": 3.0,  "output": 15.0},
    "claude-sonnet-4-6": {"input": 3.0,  "output": 15.0},
    "claude-haiku-4-5":  {"input": 1.0,  "output": 5.0},
}

# Server-side web_search tool: $10 per 1,000 searches. Result tokens are
# billed as normal input tokens and already flow through estimate_cost().
_WEB_SEARCH_USD_EACH = 0.01


def estimate_cost(model: str, input_tokens: int, output_tokens: int,
                  cache_read_tokens: int = 0,
                  cache_creation_tokens: int = 0) -> float:
    """USD cost for one call. An UNKNOWN model is priced at the priciest KNOWN
    rate and logged — never $0, which would make every cap unenforceable.

    Cache-aware (2026-08-28): a prompt-cached call (hunter.py) reports its
    prefix under cache_read_input_tokens (0.1x input) /
    cache_creation_input_tokens (1.25x) INSTEAD of input_tokens — pricing only
    input_tokens under-counted the cached lane and loosened these caps."""
    # Tolerate dated model aliases like claude-haiku-4-5-20251001
    base = model.rsplit("-", 1)[0] if model.count("-") >= 3 else model
    rates = _PRICING.get(model) or _PRICING.get(base)
    if not rates:
        # Unknown model: fall back to the priciest known rate, NOT $0. Returning
        # $0 here would make the daily caps un-enforceable for any model added to
        # CATALYST_OPUS_MODEL without a pricing entry — silent unbounded spend.
        rates = max(_PRICING.values(), key=lambda r: r["output"])
        logger.warning("[cost_guard] unknown model pricing: %s — using priciest "
                       "known rate ($%.0f/$%.0f) so caps stay enforced",
                       model, rates["input"], rates["output"])
    return (input_tokens * rates["input"] / 1_000_000.0
            + (cache_read_tokens or 0) * rates["input"] * 0.1 / 1_000_000.0
            + (cache_creation_tokens or 0) * rates["input"] * 1.25 / 1_000_000.0
            + output_tokens * rates["output"] / 1_000_000.0)


def may_synthesize(market_date: str) -> bool:
    """Returns False if hard cap exceeded for the day. Logs warning if soft
    cap exceeded but still returns True."""
    global _SOFT_CAP_LOGGED_FOR_DATE, _HARD_CAP_TRIPPED
    soft = float(os.environ.get("CATALYST_COST_CAP_DAILY", "8.00"))
    hard = float(os.environ.get("CATALYST_COST_HARD_CAP", "15.00"))

    stats = store.cost_stats_for_date(market_date)
    spent = stats.get("total_cost_usd", 0.0)

    if spent >= hard:
        if not _HARD_CAP_TRIPPED:
            logger.error("[cost_guard] HARD CAP exceeded for %s: $%.2f >= $%.2f. "
                         "Synthesis disabled for remainder of day.",
                         market_date, spent, hard)
            _HARD_CAP_TRIPPED = True
        return False

    if spent >= soft and _SOFT_CAP_LOGGED_FOR_DATE != market_date:
        logger.warning("[cost_guard] soft cap exceeded for %s: $%.2f >= $%.2f. "
                       "Synthesis continues until hard cap $%.2f.",
                       market_date, spent, soft, hard)
        _SOFT_CAP_LOGGED_FOR_DATE = market_date

    return True


#: The lanes a MEMBER triggers, by the `ticker` prefix each one records under.
#: ⛔ SIX LANES SHARE ONE DAILY BUDGET and two of them are member-triggered:
#: `definition_concierge` (English → a scan, SHIPPED AND UNFLAGGED) and
#: `indicator_from_image` (a screenshot → a formula). The other four — synthesis,
#: hunter, curator, rule_learner — are SCHEDULED: they run on a cron, nobody asks
#: for them, and if they do not run the member-facing product silently loses its
#: morning catalyst table.
MEMBER_LANE_PREFIXES = ("concierge:", "indicator-vision:")


def scheduled_reserve_usd() -> float:
    """The slice of the daily cap that member-triggered lanes may NOT consume."""
    return float(os.environ.get("SCHEDULED_LANE_RESERVE_USD", "6.00"))


def may_member_spend(market_date: str) -> bool:
    """The gate a MEMBER-TRIGGERED lane asks. Tighter than `may_synthesize`.

    ⛔⛔ MEASURED, NOT FEARED: with the concierge's own per-user cap at $0.75/day,
    **20 members** using their allowance take the shared spend from $0 to the
    $15 hard cap, at which point `may_synthesize` returns False and the SCHEDULED
    catalyst lanes stop for the rest of the day. Fewer than 20 in practice, since
    the catalyst engine itself spends $2-4. The morning catalyst table then does
    not get built, for a reason with nothing to do with catalysts, and nothing
    anywhere connects the two.

    ⭐ A PER-USER CAP DOES NOT BOUND A POPULATION. The concierge already caps ONE
    member at $0.75; what was missing is any bound on N members together. This is
    that bound, and it is expressed as a FLOOR FOR THE SCHEDULED LANES rather than
    a ceiling for members, because the floor is the property actually wanted:
    stopping member lanes once total spend reaches ``hard - reserve`` leaves
    ``reserve`` for the lanes nobody asked for, whatever order the spending
    arrives in.

    ⚠️ THE FLOOR IS ``reserve`` MINUS ONE IN-FLIGHT CALL, and saying "by
    construction" would be an overclaim — a rail written for this caught it. The
    gate is asked BEFORE a call and the call then spends, so the last admitted
    member crosses the line by their own call's cost: measured, a $4 scheduled day
    plus members at $0.75 each leaves $5.75 against a $6 reserve. That is why the
    reserve is set well above any single call rather than trimmed to the expected
    catalyst spend — the overshoot is bounded by one call, and $6 against a $0.75
    member call absorbs it with room to spare. Checking after the spend would
    close the gap and would mean billing for a call in order to discover it was
    not allowed.

    ⭐ AND THE TOTAL CEILING DOES NOT MOVE. The product already chose $15/day as
    its AI ceiling; this changes who may spend the last $6 of it, not how much
    exists. Giving member lanes their own separate budget would have been the
    other obvious design and it doubles worst-case spend — a money decision, not
    a correctness one, so it is not taken here.

    ⚠️ IT COUNTS TOTAL SPEND, NOT MEMBER SPEND, and that is deliberate: the
    guarantee is about what REMAINS for the scheduled lanes, which only a total
    can answer. The cost is that a heavy catalyst day leaves members less room —
    acceptable, because the catalyst engine's measured $2-4 sits well inside the
    reserve and the member lanes still have the rest.
    """
    hard = float(os.environ.get("CATALYST_COST_HARD_CAP", "15.00"))
    ceiling = max(0.0, hard - scheduled_reserve_usd())
    spent = store.cost_stats_for_date(market_date).get("total_cost_usd", 0.0)
    if spent >= ceiling:
        logger.warning(
            "[cost_guard] member-lane ceiling reached for %s: $%.2f >= $%.2f "
            "(hard $%.2f minus a $%.2f reserve the scheduled lanes keep). "
            "Member-triggered AI is paused; scheduled jobs continue.",
            market_date, spent, ceiling, hard, scheduled_reserve_usd())
        return False
    return True


def record(market_date: str, ticker: str, model: str,
           input_tokens: int, output_tokens: int,
           was_cached: bool = False, search_requests: int = 0,
           cache_read_tokens: int = 0, cache_creation_tokens: int = 0) -> float:
    """Record a synthesis/hunter call. Returns the cost in USD.

    search_requests: server-side web_search invocations made during the call,
    billed at $10/1k on top of token cost so the daily caps see real spend.
    cache_*_tokens: prompt-cache usage fields (see estimate_cost). Note
    `was_cached` is the APP-level skip-if-stable reuse — a different thing."""
    cost = 0.0 if was_cached else estimate_cost(
        model, input_tokens, output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens)
    cost += max(0, int(search_requests or 0)) * _WEB_SEARCH_USD_EACH
    store.log_cost(market_date=market_date, ticker=ticker, model=model,
                   input_tokens=input_tokens, output_tokens=output_tokens,
                   cost_usd=cost, was_cached=was_cached)
    return cost
