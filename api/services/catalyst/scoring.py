"""Composite scoring formula. Pure function — easy to tune in isolation.

All weights are env-var overridable so live tuning doesn't need a redeploy.
"""
import math
import os


def _w(name: str, default: float) -> float:
    """Read a weight from env or return default."""
    raw = os.environ.get(f"CATALYST_SCORE_W_{name}")
    return float(raw) if raw else default


def _is_regional_bank_earnings(c: dict) -> bool:
    """A small/mid regional bank whose only reason to be here is its earnings.

    Regional-bank season (mid-July) reports in a tight cluster of low-beta
    names that traders don't position around. The move gate in filters.py
    already drops the dead-flat ones; this catches the mild movers (3-5% on
    the report) that clear the gate but still aren't real trader catalysts,
    so they can be pushed below the 5-slot earnings quota unless the print
    is exceptionally strong.

    Matches on the yfinance `industry` label (Banks—Regional / Banks—
    Diversified etc.) via a robust 'bank' substring so em-dash / hyphen /
    spacing variants all hit, gated below a cap floor so money-center
    giants (JPM/BAC/WFC — always well above the floor) are left untouched.
    Only fires for earnings-driven rows; a bank gapping on non-earnings
    news is a legit catalyst and keeps its full score.
    """
    if not c.get("earnings_just_reported"):
        return False
    industry = (c.get("industry") or "").lower()
    if "bank" not in industry:
        return False
    max_cap = float(os.environ.get("CATALYST_BANK_DEWEIGHT_MAX_CAP",
                                   str(50_000_000_000)))
    mc = c.get("market_cap")
    # Money-center giants (cap at/above the floor) are exempt. Unknown cap
    # falls through as "small" — a money-center's cap is reliably cached, so
    # an unknown-cap bank in the pool is almost always a small regional.
    if isinstance(mc, (int, float)) and mc > 0 and mc >= max_cap:
        return False
    return True


# Per-category bonus for a Catalyst-Hunter-confirmed catalyst. Lets a real but
# NOT-yet-moving name (0% gap) rank onto the board instead of sinking to ~0 in a
# gap-dominated score. Decisive events (M&A/FDA/Halt) outweigh soft news.
_HUNTER_BONUS = {
    "M&A": 35.0, "FDA": 35.0, "Halt": 28.0, "Earnings": 20.0, "Guidance": 18.0,
    "Analyst": 15.0, "Contract": 12.0, "Index": 12.0, "Offering": 8.0, "News": 8.0,
}


def _hunter_bonus(catalyst_type: str) -> float:
    """Env-overridable per-type hunter bonus. Env key: CATALYST_SCORE_W_HUNTER_<TYPE>
    where TYPE is uppercased with '&'→'' and non-alphanumerics→'_' (e.g. M&A→MA)."""
    default = _HUNTER_BONUS.get(catalyst_type, _HUNTER_BONUS["News"])
    key = "".join(ch if ch.isalnum() else "_" for ch in catalyst_type.upper().replace("&", ""))
    return _w(f"HUNTER_{key}", default)


def score(c: dict) -> float:
    """Composite score for a candidate. Higher = more interesting."""
    s = 0.0

    # Raw gap — primary signal. abs() so big drops score same as big gains.
    s += abs(c.get("gap_pct", 0.0)) * _w("GAP", 1.0)

    # Log-volume bonus (plateaus past ~100x).
    vol_x = max(1.0, c.get("vol_x", 1.0))
    s += math.log(vol_x) * _w("VOLX", 15.0)

    # Social + news signals
    s += c.get("tweet_mention_count", 0) * _w("TWEET_MENTION", 5.0)
    s += c.get("rss_headline_count", 0) * _w("RSS_HEADLINE", 8.0)

    # Earnings — huge bonus for AMC/BMO reporters
    if c.get("earnings_just_reported"):
        s += _w("EARNINGS_REPORTED", 20.0)

    # Regional-bank earnings de-weight — mid-July bank season noise. A small/
    # mid regional bank that only cleared the gate on a mild earnings move
    # gets penalized so it ranks below the earnings quota cutoff unless the
    # print is exceptionally strong (a big enough gap out-scores the penalty).
    # Default -15 roughly cancels most of the +20 EARNINGS_REPORTED bonus.
    if _is_regional_bank_earnings(c):
        s += _w("REGIONAL_BANK", -15.0)

    # UCT scanner already flagged this — credit it
    if c.get("scanner_setup"):
        s += _w("SCANNER_SETUP", 12.0)

    # Unusual options flow (smart-money sweep/block premium) — a real
    # positioning signal. Flat bonus so a flow-notable name clears the pre-sort
    # into the curator pool; the curator judges whether the flow is worth a slot.
    if c.get("flow_notable"):
        s += _w("FLOW", 12.0)

    # Sector momentum: each peer in candidate pool adds a small bonus
    s += c.get("sector_momentum_count", 0) * _w("SECTOR_MOMENTUM", 5.0)

    # Market-cap / liquidity bonus — a notable big-cap NEWS mover should rank
    # above a microcap with a bigger raw % gap. Scaled vs the ~$300M universe
    # floor (log10 3e8 ≈ 8.5), so $300M→0 and ~$3T→~24 at the default weight.
    # Fail-neutral when cap is unknown (no bonus, no penalty).
    mc = c.get("market_cap")
    if isinstance(mc, (int, float)) and mc > 0:
        s += max(0.0, math.log10(mc) - 8.5) * _w("MARKET_CAP", 6.0)

    # 52-week-high breakout bonus — a price at/near new highs on volume is a
    # core swing setup that pure news/gap signals miss.
    if c.get("near_52w_high"):
        s += _w("FIFTYTWO_WK_HIGH", 8.0)

    # Analyst rating / PT change — a clean upgrade with a modest gap should
    # still rank against bigger pure-% movers.
    if c.get("analyst_meta"):
        s += _w("ANALYST_ACTION", 12.0)

    # Brain setup-grade — the firm's OWN historical edge for this candidate's
    # setup (e.g. an Episodic Pivot the firm has logged hundreds of times). A
    # positive-expectancy setup earns a bonus scaled by expectancy (capped), so
    # a name that fits a proven setup ranks above an equal mover that fits none.
    # Only fires when the brain had enough sample to grade it. Fail-neutral.
    bg = c.get("brain_grade")
    if isinstance(bg, dict):
        exp = bg.get("expectancy")
        if isinstance(exp, (int, float)) and exp > 0:
            s += min(float(exp), 3.0) * _w("BRAIN_EDGE", 5.0)

    # News sentiment (AlphaVantage, dormant unless a premium key is set) — a
    # small attention nudge for names carrying real, sentiment-scored coverage.
    av = c.get("av_news")
    if isinstance(av, dict):
        sent = av.get("news_sentiment")
        if isinstance(sent, (int, float)):
            s += abs(float(sent)) * _w("NEWS_SENTIMENT", 8.0)

    # Freshness: a catalyst breaking TODAY (not ranked in the prior days) gets a
    # boost so 'new and sudden' surfaces above multi-day continuations. Multi-day
    # runners are NOT penalized — they simply don't get this bonus.
    if c.get("is_new"):
        s += _w("FRESHNESS", 6.0)

    # Penny stock penalties
    price = c.get("price", 100.0) or 100.0
    floor = float(os.environ.get("CATALYST_PRICE_FLOOR", "2.0"))
    if price < 5.0:
        s -= _w("PENNY_5_PENALTY", 20.0)
    if price < floor:
        s -= _w("PENNY_FLOOR_PENALTY", 30.0)

    # Catalyst Hunter: a confirmed hard catalyst earns a per-category bonus so a
    # not-yet-moving name surfaces onto the board. A mover keeps its gap/volume
    # score and gets this on top, so movers still outrank equal-type flat names.
    if c.get("hunter_confirmed"):
        s += _hunter_bonus(c.get("catalyst_type") or "News")

    return s
