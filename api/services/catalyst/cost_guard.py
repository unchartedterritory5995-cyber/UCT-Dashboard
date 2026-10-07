"""Tracks daily spend, enforces soft + hard caps.

Anthropic pricing (USD per million tokens, 2026):
  claude-opus-5:     $5.00  input, $25.00 output
  claude-opus-4-8:   $5.00  input, $25.00 output
  claude-opus-4-7:   $5.00  input, $25.00 output
  claude-sonnet-5:   $2.00  input, $10.00 output
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
#
# Corrected 2026-09-22 (PACKET-R): `claude-sonnet-5` sat at Sonnet 4.6's rate
# since before this file existed; `narrative_cost_guard.py` fixed the same
# number 2026-08-30 and this table was never brought in line. Sonnet 5 is
# $2.00/$10.00, not $3.00/$15.00 — the two guards had drifted apart.
_PRICING = {
    # Opus 5 ships at Opus 4.8's list price — $5 in / $25 out per 1M (Anthropic
    # model table, cached 2026-06-24; the same figures flow_explain._PRICING
    # already carries for claude-opus-4-8). W0.4, 2026-08-25.
    "claude-opus-5":     {"input": 5.0,  "output": 25.0},
    "claude-opus-4-8":   {"input": 5.0,  "output": 25.0},
    "claude-opus-4-7":   {"input": 5.0,  "output": 25.0},
    "claude-sonnet-5":   {"input": 2.0,  "output": 10.0},
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


#: ─── ⭐ BUDGET ISOLATION (owner decision, 2026-10-07) ──────────────────────────
#:
#: The $15/day hard ceiling is split by KIND OF LANE, not by who spends first:
#:
#:   INTERACTIVE  ``concierge:<user>`` (/propose + /converse) and
#:                ``indicator-vision:<user>`` -- a person is waiting on the answer.
#:                May spend up to the $4 interactive reservation.
#:   BACKGROUND   everything else on this ledger: catalyst synthesis (bare tickers),
#:                ``_CURATOR``, ``__hunter__``, ``_RULE_LEARNER``, call recaps (bare
#:                tickers), ``sector:<name>`` reads -- nobody is waiting on them.
#:                May spend up to hard - reservation = $11.
#:
#: ⛔⛔ MEASURED, NOT FEARED (read-only ledger query, 2026-10-07): since catalyst
#: synthesis moved to Opus 5 on 2026-09-24, a full trading day's BACKGROUND spend
#: was $9.6-11.3 -- by itself more than the old `hard - $6 reserve` = $9 member
#: ceiling, which counted TOTAL spend. Members were therefore locked out of AI every
#: trading afternoon by work nobody asked for. The old design reserved a floor for
#: the scheduled lanes and nothing for the interactive ones; this one reserves both.
#:
#: ⭐ THE TOTAL DOES NOT MOVE. $4 + $11 = $15, the ceiling the product already chose.
#: Each side is checked BEFORE a call against its OWN spend, so each may overshoot
#: by the one call it admitted -- the same bound the old gate had -- and `hard`
#: stays an absolute check on both gates.
#:
#: ⛔ NO BORROWING, deliberately. Interactive lanes do not use idle background
#: dollars and background lanes never touch the reservation. Simple and safe beat
#: utilisation for the rollout (owner, 2026-10-07).
#:
#: ⭐ FAIL SAFE FOR NEW LANES: a ticker is INTERACTIVE only if it carries one of the
#: two prefixes below. Anything else -- including a lane added tomorrow -- is
#: BACKGROUND and therefore capped at $11; a new lane cannot reach the reservation.
INTERACTIVE_LANE_PREFIXES = ("concierge:", "indicator-vision:")
#: The old name for the same tuple; existing readers keep working.
MEMBER_LANE_PREFIXES = INTERACTIVE_LANE_PREFIXES

INTERACTIVE = "interactive"
BACKGROUND = "background"

#: The scheduled support jobs, named for the owner's report (all BACKGROUND).
_SUPPORT_JOBS = frozenset({"_CURATOR", "__hunter__", "_RULE_LEARNER"})

_BACKGROUND_LIMIT_LOGGED_FOR_DATE: str | None = None


def lane_kind(ticker: str) -> str:
    """INTERACTIVE or BACKGROUND for one ledger ``ticker`` -- the ONE classifier."""
    return INTERACTIVE if str(ticker or "").startswith(INTERACTIVE_LANE_PREFIXES) else BACKGROUND


def lane_name(ticker: str) -> str:
    """The report bucket for one ledger ``ticker`` (no user ids)."""
    t = str(ticker or "")
    if t.startswith("concierge:"):
        return "concierge"
    if t.startswith("indicator-vision:"):
        return "vision"
    if t in _SUPPORT_JOBS:
        return "scheduled_support"
    if ":" in t or t.startswith("_"):
        return "other_background"
    return "synthesis"


def hard_cap_usd() -> float:
    return float(os.environ.get("CATALYST_COST_HARD_CAP", "15.00"))


def interactive_limit_usd() -> float:
    """The reservation interactive lanes may spend: $4 of the $15."""
    return max(0.0, min(float(os.environ.get("INTERACTIVE_AI_RESERVE_USD", "4.00")),
                        hard_cap_usd()))


def background_limit_usd() -> float:
    """What background lanes may spend: the ceiling minus the reservation ($11)."""
    return max(0.0, hard_cap_usd() - interactive_limit_usd())


def spend_by_kind(market_date: str) -> dict:
    """Today's ledger split by kind (and by report bucket). READ-ONLY."""
    out = {"total": 0.0, INTERACTIVE: 0.0, BACKGROUND: 0.0, "lanes": {
        "concierge": 0.0, "vision": 0.0, "synthesis": 0.0,
        "scheduled_support": 0.0, "other_background": 0.0}}
    for ticker, usd in store.spend_by_ticker(market_date):
        usd = float(usd or 0.0)
        out["total"] += usd
        out[lane_kind(ticker)] += usd
        out["lanes"][lane_name(ticker)] += usd
    return out


def budget_state(market_date: str) -> dict:
    """The owner-facing budget numbers for one ET day -- aggregates only."""
    s = spend_by_kind(market_date)
    hard, i_lim, b_lim = hard_cap_usd(), interactive_limit_usd(), background_limit_usd()
    r = lambda v: round(v, 4)                                   # noqa: E731
    return {
        "market_date": market_date,
        "total_spend": r(s["total"]),
        "interactive_spend": r(s[INTERACTIVE]),
        "background_spend": r(s[BACKGROUND]),
        "total_limit": hard,
        "interactive_limit": i_lim,
        "background_limit": b_lim,
        "total_remaining": r(max(0.0, hard - s["total"])),
        "interactive_remaining": r(max(0.0, i_lim - s[INTERACTIVE])),
        "background_remaining": r(max(0.0, b_lim - s[BACKGROUND])),
        "lanes": {k: r(v) for k, v in s["lanes"].items()},
    }


def may_synthesize(market_date: str) -> bool:
    """THE BACKGROUND GATE. False once background spend reaches its limit ($11) or
    the day's total reaches the hard ceiling ($15). Callers already treat False as
    "skip this AI call" -- nothing here raises or charges.

    The soft cap ($8, total) still only logs."""
    global _SOFT_CAP_LOGGED_FOR_DATE, _HARD_CAP_TRIPPED, _BACKGROUND_LIMIT_LOGGED_FOR_DATE
    soft = float(os.environ.get("CATALYST_COST_CAP_DAILY", "8.00"))
    hard = hard_cap_usd()

    s = spend_by_kind(market_date)
    spent = s["total"]

    if spent >= hard:
        if not _HARD_CAP_TRIPPED:
            logger.error("[cost_guard] HARD CAP exceeded for %s: $%.2f >= $%.2f. "
                         "Synthesis disabled for remainder of day.",
                         market_date, spent, hard)
            _HARD_CAP_TRIPPED = True
        return False

    limit = background_limit_usd()
    if s[BACKGROUND] >= limit:
        if _BACKGROUND_LIMIT_LOGGED_FOR_DATE != market_date:
            logger.warning(
                "[cost_guard] background AI limit reached for %s: $%.2f >= $%.2f "
                "(the $%.2f interactive reservation is kept for members). "
                "Background AI is paused for the rest of the day.",
                market_date, s[BACKGROUND], limit, interactive_limit_usd())
            _BACKGROUND_LIMIT_LOGGED_FOR_DATE = market_date
        return False

    if spent >= soft and _SOFT_CAP_LOGGED_FOR_DATE != market_date:
        logger.warning("[cost_guard] soft cap exceeded for %s: $%.2f >= $%.2f. "
                       "Synthesis continues until hard cap $%.2f.",
                       market_date, spent, soft, hard)
        _SOFT_CAP_LOGGED_FOR_DATE = market_date

    return True


def may_member_spend(market_date: str) -> bool:
    """THE INTERACTIVE GATE (/propose, /converse, indicator-vision). False once
    interactive spend reaches the reservation ($4) or the day's total reaches the
    hard ceiling ($15). Background spend does NOT count against it -- that is the
    whole point -- and admin calls to these lanes DO (owner, 2026-10-07).

    ⚠️ Checked BEFORE a call, so the last admitted call may overshoot the
    reservation by its own cost; the per-member allowance and the per-user
    in-flight guard (`definition_concierge.interactive_slot`) bound that to one call
    per member."""
    s = spend_by_kind(market_date)
    hard, limit = hard_cap_usd(), interactive_limit_usd()
    if s["total"] >= hard or s[INTERACTIVE] >= limit:
        logger.warning(
            "[cost_guard] interactive AI limit reached for %s: interactive $%.2f "
            "(limit $%.2f), total $%.2f (ceiling $%.2f). Member AI is paused; "
            "background jobs are unaffected.",
            market_date, s[INTERACTIVE], limit, s["total"], hard)
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
