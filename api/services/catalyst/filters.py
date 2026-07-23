"""Quality gate — a hard pre-filter that drops untradeable junk before scoring.

Deterministic. No ML, no training, no screenshots. Bright lines defined by env
vars so they can be tuned live on Railway without a redeploy.

Applied in the orchestrator AFTER metadata enrichment but BEFORE scoring /
selection — so junk never enters the scored pool, AND the forced tag quotas
(10/5/3/2) can come up short rather than backfilling a junk name just to hit
the count.

Fail-open on missing data: a candidate whose liquidity / market-cap metadata
hasn't cached yet is KEPT. Rationale: pump junk almost always has price +
volume data (so it gets caught anyway), while missing-metadata is usually a
legit fresh name we'd be wrong to suppress. The price floor is the one true
hard line — it only fires when we have a real positive price below the floor.

Note: distinct from CATALYST_PRICE_FLOOR in scoring.py, which is a soft
ranking *penalty*. CATALYST_MIN_PRICE here is a hard *exclusion*.
"""
from __future__ import annotations

import os
from typing import Optional

from api.services.catalyst import tuning


def _f(name: str, default: float) -> float:
    """Read a float threshold from env, or return default."""
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def quality_gate(c: dict) -> tuple[bool, Optional[str]]:
    """Decide whether a candidate is tradeable enough to keep.

    Returns (passed, reason). reason is None when passed, else a short
    human-readable exclusion string suitable for the "Why isn't X" explainer.
    """
    min_price = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    min_dollar_vol = tuning.get_threshold("CATALYST_MIN_DOLLAR_VOL", 5_000_000.0)
    min_market_cap = tuning.get_threshold("CATALYST_MIN_MARKET_CAP", 300_000_000.0)

    # ── Not a stock — ETFs/funds/indexes are vehicles, not catalysts. A
    # leveraged-semis ETF (USD) was SELECTED on 2026-06-11; SOXL/SOXS/KORU
    # recur in gap scans on every sector-rotation day. Fail-open when
    # quote_type is unknown (pre-migration cache rows, yfinance misses). ──
    qt = (c.get("quote_type") or "").upper()
    if qt and qt != "EQUITY":
        return False, f"not a stock (quote_type={qt})"

    price = c.get("price")
    price_f = float(price) if isinstance(price, (int, float)) else 0.0

    # ── No price data — untradeable / cashtag-collision junk (e.g. a crypto
    # pump token sharing a symbol with a real stock). A catalyst row with no
    # price helps no one; the engine reruns every few minutes, so a transient
    # snapshot miss self-heals on the next tick. ──
    if price_f <= 0:
        return False, "no price data (untradeable or symbol collision)"

    # ── Price floor — hard line. ──
    if price_f < min_price:
        return False, f"price ${price_f:.2f} below ${min_price:.0f} floor"

    # ── Dollar volume — the strongest junk filter. ──
    # avg 30d volume preferred (stable, not inflated by the catalyst-day
    # spike); today's volume as fallback. Skipped entirely (fail-open) when
    # we have no volume data at all.
    adv = c.get("avg_volume_30d") or 0
    today_vol = c.get("today_volume") or 0
    vol_for_calc = adv if (adv and adv > 0) else today_vol
    if price_f > 0 and vol_for_calc and vol_for_calc > 0:
        dollar_vol = price_f * float(vol_for_calc)
        if dollar_vol < min_dollar_vol:
            return False, (
                f"liquidity ${dollar_vol / 1e6:.1f}M/day below "
                f"${min_dollar_vol / 1e6:.0f}M floor"
            )

    # ── Market cap floor — only when cap is known (fail-open on missing). ──
    mc = c.get("market_cap")
    if isinstance(mc, (int, float)) and mc > 0 and mc < min_market_cap:
        return False, (
            f"market cap ${mc / 1e6:.0f}M below ${min_market_cap / 1e6:.0f}M floor"
        )

    # ── Float floor — the classic low-float pump tell. Prefer true float;
    # fall back to shares-outstanding. Fail-open when neither is known. ──
    min_float = tuning.get_threshold("CATALYST_MIN_FLOAT", 5_000_000.0)
    flt = c.get("float_shares") or c.get("shares_outstanding")
    if isinstance(flt, (int, float)) and flt > 0 and flt < min_float:
        return False, (
            f"float {flt / 1e6:.1f}M shares below {min_float / 1e6:.1f}M floor"
        )

    return True, None


def is_real_catalyst(c: dict) -> tuple[bool, Optional[str]]:
    """Is *anything actually happening* with this name today?

    Distinct from quality_gate (which judges the TICKER). This judges the
    SITUATION: a catalyst row should earn a slot only when there's a real
    move, a real volume surge, or a hard catalyst (scanner setup / analyst
    action / Hunter-confirmed event, or an earnings print that actually MOVED
    the stock). A dead-flat stock on normal volume with only vague prose about
    it is NOT a catalyst — that's the PAR / MEDP / FTRE failure mode, and it's
    also every sleepy regional-bank earnings print that used to flood the list
    in July.

    Deliberately keys on MOVE + VOLUME, not on whether fresh news exists: a
    big pre-market gap with no headline is often momentum / continuation from
    an older catalyst, which the user explicitly wants to keep. So 'no clear
    catalyst' is NOT a drop reason here — a flat tape is.

    Returns (passed, reason). Thresholds env-tunable.
    """
    min_move = _f("CATALYST_MIN_MOVE_PCT", 3.0)
    min_volx = _f("CATALYST_MIN_VOLX", 2.0)
    earnings_min_move = _f("CATALYST_EARNINGS_MIN_MOVE_PCT", 3.0)

    gap = c.get("gap_pct")
    gap_abs = abs(float(gap)) if isinstance(gap, (int, float)) else 0.0
    vol_x = c.get("vol_x")
    vol_f = float(vol_x) if isinstance(vol_x, (int, float)) else 0.0

    # ── Earnings names must show a real price REACTION to earn a slot. ──
    # "A company reported earnings" is NOT itself a catalyst a trader cares
    # about — mid-July regional-bank season floods the EarningsWhispers
    # calendar with names that report and barely move, and nobody is
    # positioning around a dead-flat bank print. So an earnings row is kept
    # only when it actually moved (earnings_min_move) OR carries an
    # independent hard signal (scanner / analyst / Hunter-confirmed). Report-
    # day volume is ALWAYS elevated, so we deliberately do NOT fall through to
    # the volume-surge rescue below — volume alone must not resurrect a flat
    # earnings name. (This replaces the old unconditional earnings pass.)
    # earnings_min_move is env-tunable; note it only ever makes earnings
    # STRICTER than the general move gate — a name gapping past min_move
    # already qualifies as a normal mover regardless of earnings.
    if c.get("earnings_just_reported"):
        if gap_abs >= earnings_min_move:
            return True, None                          # real earnings reaction
        if c.get("scanner_setup"):
            return True, None                          # independent hard signal
        if c.get("analyst_meta"):
            return True, None                          # independent hard signal
        if c.get("hunter_confirmed"):
            return True, None                          # Hunter-confirmed hard catalyst
        if c.get("flow_notable"):
            return True, None                          # unusual options flow (smart money)
        return False, (
            f"earnings reported but no real reaction "
            f"(gap {gap_abs:.1f}% < {earnings_min_move:.0f}%) — sleepy print"
        )

    if gap_abs >= min_move:
        return True, None                              # real move (incl. momentum)
    if vol_f >= min_volx:
        return True, None                              # real volume surge
    if c.get("scanner_setup"):
        return True, None                              # UCT scanner flagged it
    if c.get("analyst_meta"):
        return True, None                              # analyst rating/PT change
    if c.get("hunter_confirmed"):
        return True, None                              # Catalyst Hunter confirmed a hard
        #                                                catalyst — keep it even when the
        #                                                stock hasn't moved yet (early /
        #                                                pre-move detection). quality_gate
        #                                                still drops untradeable junk.
    if c.get("flow_notable"):
        return True, None                              # unusual options flow (smart money
        #                                                positioning) — surface it even
        #                                                before the stock moves; the
        #                                                curator judges whether it's real.

    return False, (
        f"no real move (gap {gap_abs:.1f}% < {min_move:.0f}%, "
        f"vol {vol_f:.1f}× < {min_volx:.0f}×) and no hard catalyst "
        f"(earnings/scanner)"
    )
