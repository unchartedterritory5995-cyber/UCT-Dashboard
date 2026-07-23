"""
Live Massive Router — TEST PHASE for Massive-based live flow

Mirrors /api/live/alerts/recent but sources data from FlowDB (worker writes)
instead of Bullflow SSE. The frontend test page (LiveFlowMassive.jsx) polls
this endpoint every 5s and renders the same UI as the existing LiveFlow.

Architecture:
  Massive WS → massive_ws_worker.py → flow table (FlowDB)
  Worker computes Color in real-time when OI arrives:
    cum_vol >= 1.5 * OI  →  MAGENTA  (strong single-trade conviction)
    cum_vol > OI         →  YELLOW   (cumulative accumulation)
  This endpoint surfaces those classified rows + tier-naming + conviction.

Filters applied:
  - source = 'stocks' (indexes have aggregation-boundary risk per 6/26)
  - Color IN ('MAGENTA', 'YELLOW') (drop WHITE noise, drop ARB cancels/clusters)
  - CreatedDate = today (rolling live window)

Tier derivation from row characteristics:
  MAGENTA + premium >= $1M + ASK + DTE < 180  →  Alpha Gold (rarest)
  MAGENTA + DTE >= 180                         →  Bull/Bear LEAPS
  MAGENTA + premium >= $500K                   →  Size Bulls/Bears
  MAGENTA + V/OI >= 5                          →  Unusual
  MAGENTA                                       →  Bullish/Bearish
  YELLOW + DTE >= 180                          →  Bull/Bear LEAPS (lower priority)
  YELLOW                                        →  Bullish/Bearish (accumulation)
  Type=ML/                                      →  Algo (multi-leg, non-directional)

Why this lives separately:
  1. We don't want to break the existing LiveFlow.jsx wiring during testing
  2. The Bullflow worker (liveflow_worker.py) and this router can coexist
  3. Once validated, swap LiveFlow.jsx data source URL — no other changes needed
"""
from fastapi import APIRouter, Query, Request, HTTPException, Depends
# Auth for the MUTATING endpoints below. Until 2026-07-20 every POST on this
# router was UNAUTHENTICATED and internet-reachable — anyone could fire
# force-push-discord into members' Discord or rewrite the alert thresholds.
# require_flow_admin/-user accept a PUSH_SECRET bearer, a direct admin/user
# session cookie, OR the HMAC-signed vouch that flow_proxy injects (which is how
# this works on the flow-worker, where web's auth.db isn't present). Same gate
# already used by darkpool_router / dealer_positioning_router / flow_gap_autofill.
from api.flow_admin_auth import require_flow_admin, require_flow_user
from datetime import date, datetime, timezone, timedelta
import sqlite3
import os
import time
import re
import json
import threading
import logging

router = APIRouter(prefix="/api/live/massive", tags=["live-flow-massive"])

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
ET = timezone(timedelta(hours=-4))

# Market session bounds, ET minutes-since-midnight. Also duplicated locally in
# the restart-log endpoint (MARKET_OPEN_ET_HHMM); worth collapsing to these.
_MARKET_OPEN_ET_MIN = 9 * 60 + 30    # 9:30 ET
_MARKET_CLOSE_ET_MIN = 16 * 60       # 16:00 ET


def _in_market_hours(now_et: datetime = None) -> bool:
    """True during 9:30-16:00 ET, Mon-Fri. No holiday calendar — on a holiday
    this returns True, but there's no flow to qualify, so nothing fires."""
    n = now_et or datetime.now(ET)
    if n.weekday() >= 5:
        return False
    return _MARKET_OPEN_ET_MIN <= (n.hour * 60 + n.minute) < _MARKET_CLOSE_ET_MIN


# ─── Tier priority (for convictionScore weighting) ─────────────────────────
# Lower priority number = higher quality signal. Matches Bullflow taxonomy.
# bullish and bearish share priority 3 (same conviction weight, just opposite
# direction — used for grouping in the UI).
TIER_PRIORITY = {
    "alpha":   1,
    "size":    2,
    "bullish": 3,
    "bearish": 3,
    "leaps":   4,
    "unusual": 5,
    "algo":    99,
}


# ─── Curated mode thresholds + qualification ────────────────────────────────
# Curated mode is the "best of the best" view — only alerts that meet stacked
# criteria show up. The thresholds are admin-tunable via /thresholds endpoint
# and persisted to a JSON file so values stick across deploys.
#
# Stacking model:
#   Tiers {alpha, size, leaps, bullish, bearish}:
#     1. Premium MUST meet tier+cap-band floor (HARD requirement)
#     2. AND must meet ≥ stack.min_signals of these 3 quality confirmers:
#          - V/OI ≥ stack.vOI
#          - Hit count (same-contract repeats) ≥ stack.hit_count
#          - Grade ≥ stack.grade
#     min_signals=0 → premium alone qualifies (loose)
#     min_signals=1 → premium + 1 confirmer (default)
#     min_signals=2 → premium + 2 confirmers
#     min_signals=3 → premium + all 3 confirmers (strictest)
#
#   Tier 'unusual' (cap-agnostic, own path):
#     Show if premium >= unusual.min_premium AND v_oi >= unusual.vOI.
#     The signal IS the V/OI anomaly on a normally-quiet name — no stacking.
#     NOTE: True "unusual name" detection (dormant ticker lookup over past N
#     trading days) is planned for after-hours build. For now, the existing
#     V/OI-based Unusual tier rule applies.
#
#   Tier 'algo': always excluded from Curated.

_THRESHOLDS_PATH = os.environ.get("CURATED_THRESHOLDS_PATH", "/data/curated_thresholds.json")
_thresholds_cache = None

DEFAULT_THRESHOLDS = {
    "stack": {
        "min_signals": 1,         # min quality confirmers (out of 3); premium always required
        "vOI": 3.0,
        "hit_count": 3,
        "grade": "B",
        "voi_required": False,    # 7/7 addition: when True, V/OI >= stack.vOI becomes a hard gate,
                                  # short-circuits before the confirmer count. Lets Ravi toggle
                                  # "volume>OI mandatory" from the admin panel without touching code.
                                  # Default False preserves today's 1-of-3 flexibility.
    },
    "premium_by_cap": {
        # premium $ floor by tier and cap band
        "alpha":   {"mid_small": 1_000_000, "large": 1_000_000, "mega": 1_000_000},
        "size":    {"mid_small":   500_000, "large":   750_000, "mega": 1_000_000},
        "leaps":   {"mid_small":   500_000, "large":   750_000, "mega": 1_000_000},
        "bullish": {"mid_small":   250_000, "large":   500_000, "mega":   750_000},
        "bearish": {"mid_small":   250_000, "large":   500_000, "mega":   750_000},
    },
    "unusual": {
        "min_premium": 100_000,
        "vOI": 5.0,
    },
    # 7/7: ETF/index-specific thresholds. Applied when source='indexes'.
    # ETFs (SPY/QQQ/SOXL/etc.) have fundamentally different premium scales
    # than single-name stocks — $100K-$500K on SPY is retail dust, not
    # institutional. These floors are ~5x stock levels; tune from admin
    # panel. No cap bands because all major ETFs are mega-scale.
    "etf_premium_floors": {
        "alpha":   5_000_000,
        "size":    2_500_000,
        "leaps":   2_500_000,
        "bullish": 1_250_000,
        "bearish": 1_250_000,
    },
    "etf_unusual": {
        "min_premium":   500_000,
        "vOI": 10.0,
    },
    "cap_bands": {
        # in $ market cap. Below mid_small_max = "mid_small";
        # mid_small_max to large_max = "large"; above large_max = "mega"
        "mid_small_max":  10_000_000_000,    # <$10B = mid/small cap
        "large_max":     200_000_000_000,    # $10B-$200B = large; >$200B = mega
    },
    # 7/7: Whether to include source='indexes' rows (ETFs + index products
    # like SPY, QQQ, NDXP, VIX, TLT, GDX...) in the /recent alert stream.
    # Default False preserves the "stocks only" behavior the pipeline has
    # had since 6/26. When True, the frontend's Stocks/ETFs/All toggle can
    # actually partition returned alerts; when False, ETFs mode shows only
    # historical mis-routed indexes (nothing going forward). Wire through
    # the same admin panel that hosts voi_required and premium floors.
    "etf_enabled": False,
    # Big sweeps/blocks on fresh strikes (OI=0) get classified WHITE because
    # Massive's V/OI classifier can't compute a ratio without OI. This rule
    # promotes those rows to MAGENTA-equivalent classification so they
    # surface in /live-massive. Catches institutional sweeps Massive would
    # otherwise miss (Bullflow surfaces them via different criteria).
    "premium_override": {
        "enabled": True,
        "min_premium": 1_000_000,
        "require_sweep_or_block": True,
    },
    # Deep-ITM filter for Alpha Gold tier (added 6/29 audit).
    #
    # Background: deep in-the-money calls/puts are typically delta-exposure
    # tools (essentially synthetic stock with leverage) rather than direct-
    # ional conviction bets. A $1M+ ask-side buy on a 60% ITM call is
    # mechanical positioning, not a high-conviction signal worth surfacing
    # at the top tier. MRVL 6/29 example: $170C with spot ~$277 (62.9%
    # ITM) qualified for Alpha Gold under the old rules despite being a
    # synthetic-stock substitute.
    #
    # When an otherwise-Alpha-eligible row is deeper than this % ITM, the
    # tier classifier falls through to the Size tier check ($500K-$1M+
    # premium depending on cap band) so the institutional positioning
    # still surfaces -- just not at the Alpha Gold conviction tier.
    #
    # Moneyness pct is measured as (spot - strike) / strike * 100 for
    # calls, with sign flipped for puts so positive = ITM consistently.
    # Threshold of 25% means: calls with strike < 80% of spot (or puts
    # with strike > 125% of spot) are blocked from Alpha Gold.
    "alpha_max_itm_pct": 25.0,
    # Vol/OI gate for Alpha Gold tier (added 6/30 morning).
    #
    # Alpha Gold should require FRESH institutional positioning -- new
    # exposure being created, not adjustments to yesterday's positions.
    # Volume exceeding open interest is the canonical signal for this:
    # today's flow on this contract is larger than the entire prior
    # accumulated position. That's new conviction, not noise.
    #
    # Default 1.0 = vol must strictly exceed OI (the literal "vol > oi"
    # reading). Set higher (e.g. 1.5) for stricter "fresh and dominant"
    # positioning. Set to 0 to disable this gate.
    #
    # Contracts with unknown OI (Schwab snapshot misses, fresh strikes
    # with no OI history) are REJECTED at this gate -- we can't verify
    # the freshness criterion without known OI. Those rows fall through
    # to Size tier where the requirement doesn't apply.
    "alpha_min_vol_oi_ratio": 1.0,
    # Block-type exclusion for Alpha Gold (added 6/30 morning).
    #
    # BLOCK trades are pre-negotiated off-exchange single transactions.
    # When a single BLOCK has huge volume (>OI), it LOOKS like dominant
    # fresh positioning -- but the V/OI dominance can be artifact of a
    # multi-leg structure (delta-neutral spread, stock-hedge pair, etc.)
    # where the apparent directional signal is offset by the other leg.
    #
    # Until next-day settled OI confirms the directional exposure was
    # real, a BLOCK with high V/OI is suggestive but not high-conviction.
    # Exclude BLOCKs from Alpha Gold entirely; they fall through to Size
    # tier where they're still surfaced but not treated as top conviction.
    #
    # SWEEPs are NOT excluded -- they're inherently multi-venue aggressive
    # liquidity-takers, not negotiable, and V/OI dominance is a cleaner
    # signal for sweeps than for blocks.
    "alpha_exclude_block_type": True,
    # Weekly exclusion for Alpha Gold (added 7/8 evening).
    #
    # Short-dated calls/puts expiring within N days are speculative
    # weekly plays, not high-conviction directional positioning. Even
    # when premium is huge (>$1M) and V/OI dominant, a 2-DTE $945 call
    # on MU is more likely event-driven momentum than an institution
    # building a real exposure. Fall through to Size tier where they
    # still surface but not at top conviction.
    #
    # Default 7 = this Friday's expirations excluded from Alpha Gold.
    # Set to 0 to disable this gate (recover previous behavior — all
    # short-dated big prints eligible for Alpha Gold).
    #
    # Applied AFTER the LEAPS gate (>=180 DTE), so the DTE bands are:
    #   0 to alpha_max_weekly_dte    → excluded from Alpha (Size fallback)
    #   alpha_max_weekly_dte to 179  → Alpha Gold eligible
    #   180+                         → LEAPS tier
    "alpha_max_weekly_dte": 7,
    # Global deep-ITM filter (added 6/30 morning).
    #
    # Trades deeper than this threshold are "synthetic stock substitute"
    # plays -- the trader is using deep-ITM options as a leveraged stock
    # exposure, not making a directional bet on the option itself. They
    # have no informational value as flow signals and clutter the feed.
    #
    # When a trade is deeper than this threshold, it is REJECTED entirely
    # from the alert feed -- not just demoted to a lower tier. The row
    # does not appear in /live-massive at all.
    #
    # Two-tier ITM logic:
    #   - alpha_max_itm_pct (25%): demote from Alpha Gold, keep in Size
    #   - max_itm_pct (50%): drop entirely from feed
    #
    # 25-50% ITM range still surfaces as Size/Bullish/Bearish (these
    # can be legitimate aggressive ITM directional bets). 50%+ is
    # consensus deep-ITM and suppressed.
    "max_itm_pct": 50.0,
    # Deep-ITM DIRECTION guard (2026-07-20). On deeply-ITM contracts the
    # single-venue NBBO is unreliable, so the A/B/AA/BB side — and thus
    # bull/bear — is frequently wrong (AMAT/MU LEAP puts read opposite BBS).
    # Beyond this ITM %, the row is kept but its DIRECTION is dropped (no
    # bull/bear). Separate from max_itm_pct (which drops the row entirely).
    # Set 0 to disable.
    "direction_max_itm_pct": 20.0,
    # Null-spot fail-closed (2026-07-23). The deep-ITM guard above and the
    # deep-ITM/lottery noise filters are ALL gated on having a spot price. When
    # spot enrichment is missing for a row (or a whole symbol), they silently
    # skip and arb/parity flow publishes with a confident bull/bear. When True,
    # approximate moneyness from price vs strike and drop the direction on
    # apparent deep-ITM. False restores the old fail-open behaviour.
    "spotless_itm_guard": True,
    # Keep-as-Size floor (2026-07-20). When the side can't be trusted (deep-ITM
    # guard, ambiguous at-bid 'B', or blank single-venue NBBO) direction is None
    # and the row would be dropped. If premium clears this floor, KEEP it as a
    # neutral Size row instead — real size shouldn't vanish on an uncertain side
    # (UW's own doc: a fill at the bid is "not necessarily a sell"). 0 disables.
    "keep_sizeless_min_premium": 1000000,
    # Net-flow demote (2026-07-21): in the curated feed, a directional print on a
    # contract whose OWN net flow is < this fraction one-sided (dominant/total,
    # at-bid selling counted) is demoted to neutral "UCT Size" — drops the
    # misleading Bull/Bear AND removes it from the Market Read math (MU $1190P
    # ~54/46 -> neutral). 0 disables. Mirrors the auto-push min_directional_ratio.
    "net_flow_min_ratio": 0.67,
    # Size tier V/OI gate (added 6/30 evening).
    #
    # Size tier ($500K-$1M+ premium MAGENTA, not Alpha-Gold-quality)
    # was previously promoted purely on premium. That surfaced large
    # institutional positioning but also a lot of low-V/OI rows that
    # represent adjustments to existing positions rather than fresh
    # conviction flow. Adding a V/OI floor narrows Size tier to trades
    # where today's volume is dominating prior OI -- same "fresh
    # positioning" principle as the Alpha Gold gate, just looser.
    #
    # Default 1.0 = vol must strictly exceed OI. Set to 0 to disable
    # (recover previous behavior). Like the Alpha Gold gate, this
    # requires KNOWN OI (>0); Schwab snapshot misses fail this gate
    # and fall through to bullish/bearish tier.
    "size_min_vol_oi_ratio": 1.0,
    # Strict directional rule (added 6/30 evening, after audit).
    #
    # When True (default), only the unambiguously-aggressive sides
    # produce Bull/Bear direction classification:
    #   - A   (at ask)        Bull on calls / Bear on puts
    #   - AA  (above ask)     Bull on calls / Bear on puts
    #   - BB  (below bid)     Bear on calls / Bull on puts
    #
    # Side=B (at bid only) is dropped from directional classification.
    # Bid-side fills can be closing trades, covered call writes, dealer
    # hedges, or aggressive selling -- the mechanics don't tell us which.
    # Without intent signal, calling them directional generates noise.
    #
    # Today's audit (6/30) showed most Size-tier disagreements between
    # UCT and BBS/Bullflow were on bid-side BLOCK trades where all three
    # sources guessed differently because the trade itself was ambiguous.
    #
    # When False, falls back to legacy behavior (B and BB both treated
    # as bid-side, no distinction).
    "derive_strict_bid_only_bb": True,
    # Fresh-strike promotion threshold (added 6/30 evening).
    #
    # When OI is explicitly known to be zero (Schwab confirmed: no
    # settled OI yesterday — usually a brand new strike that opened
    # today), AND today's volume is at least this threshold, treat the
    # contract as PASSING the V/OI gate (any V/OI test reads as
    # "freshly established institutional position").
    #
    # This is the canonical fresh-strike pattern: someone opens a new
    # strike and immediately builds a meaningful position. Every contract
    # of today's volume is brand-new exposure. Highest-conviction signal
    # possible.
    #
    # Critically, this only applies when OI is EXPLICITLY zero from
    # Schwab. When OI is null/empty (Schwab fetch failed, status unknown),
    # the gate still rejects -- we don't know if it's a fresh strike or
    # a transient API failure. Erring conservative on data quality.
    #
    # Default 100 contracts: high enough to filter out random tiny
    # opening prints, low enough to catch real institutional bets.
    "fresh_strike_min_volume": 100,
    # V/OI gate for Bullish/Bearish catchall tier (added 6/30 evening).
    #
    # The catchall directional tier was previously gateless -- any MAGENTA
    # row with premium and a direction landed in Bullish or Bearish. Today's
    # audit showed 36% direction-disagreement on Bearish vs BBS/Bullflow,
    # mostly because the tier admitted noisy low-V/OI reads.
    #
    # Applying the same V/OI > 1.0 floor as Size/Alpha narrows the tier to
    # only fresh positioning. Failed rows drop from curated entirely
    # (uncurated still shows them).
    #
    # Set to 0 to disable (recover previous behavior — risky, catches lots
    # of noise).
    "bullish_bearish_min_vol_oi_ratio": 1.0,
    # V/OI gate for LEAPS tier (added 6/30 evening).
    #
    # Same principle as Bullish/Bearish. LEAPS gate is independent so it
    # can be tuned looser if institutional position-building on long-dated
    # contracts consistently shows low same-day V/OI. Default starts at
    # the same 1.0 as other tiers; adjust based on observed flow patterns.
    "leaps_min_vol_oi_ratio": 1.0,
}

_GRADE_NUMERIC = {"A+ 🚀": 4, "A+": 4, "A": 3, "B": 2, "C": 1, "D": 0}


def _deep_merge_thresholds(defaults: dict, saved: dict) -> dict:
    """Merge saved values into defaults so missing keys fall back gracefully
    when the saved file pre-dates a new threshold being added."""
    out = json.loads(json.dumps(defaults))  # deep copy
    for k, v in saved.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge_thresholds(out[k], v)
        else:
            out[k] = v
    return out


def _load_thresholds() -> dict:
    """Load thresholds from disk, falling back to defaults. Cached in-memory
    after first read; cache invalidates on _save_thresholds()."""
    global _thresholds_cache
    if _thresholds_cache is not None:
        return _thresholds_cache
    try:
        if os.path.exists(_THRESHOLDS_PATH):
            with open(_THRESHOLDS_PATH) as f:
                saved = json.load(f)
            _thresholds_cache = _deep_merge_thresholds(DEFAULT_THRESHOLDS, saved)
        else:
            _thresholds_cache = json.loads(json.dumps(DEFAULT_THRESHOLDS))
    except Exception as e:
        print(f"[curated] Failed to load thresholds ({e}), using defaults")
        _thresholds_cache = json.loads(json.dumps(DEFAULT_THRESHOLDS))
    return _thresholds_cache


def _save_thresholds(thresholds: dict) -> bool:
    """Persist thresholds to disk. Refresh cache on success."""
    global _thresholds_cache
    try:
        merged = _deep_merge_thresholds(DEFAULT_THRESHOLDS, thresholds)
        os.makedirs(os.path.dirname(_THRESHOLDS_PATH), exist_ok=True)
        tmp = _THRESHOLDS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(merged, f, indent=2)
        os.replace(tmp, _THRESHOLDS_PATH)  # atomic swap
        _thresholds_cache = merged
        return True
    except Exception as e:
        print(f"[curated] Failed to save thresholds: {e}")
        return False


def _cap_band_key(mkt_cap, cap_bands: dict) -> str:
    """Classify a ticker's market cap into 'mid_small', 'large', or 'mega'."""
    mc = mkt_cap if isinstance(mkt_cap, (int, float)) else _parse_int(mkt_cap)
    if not mc or mc <= 0:
        return "mid_small"   # default to most permissive when unknown
    if mc < cap_bands.get("mid_small_max", 10_000_000_000):
        return "mid_small"
    if mc < cap_bands.get("large_max", 200_000_000_000):
        return "large"
    return "mega"


def _qualifies_curated(alert: dict, thresholds: dict,
                       contract_totals: dict | None = None) -> bool:
    """Apply Curated-mode filter to a single alert.
    Returns True if the alert should be visible in Curated mode.

    Rule (for alpha/size/leaps/bullish/bearish tiers):
      1. Premium MUST meet tier+cap floor (HARD requirement)
         - 7/7 rollup rescue: if the individual event's premium is below
           the tier floor but the same contract's total premium across the
           day is above the floor, the individual event is promoted. This
           fixes the NFLX $77 C 7/31 case (BBS $2.76M total → Massive split
           into two $0.4M events, each individually failing the $1M Alpha
           floor). Only applies when contract_totals is passed in.
      2. AND ≥ stack.min_signals of these 3 quality signals must also pass:
            - V/OI ≥ stack.vOI
            - hit count ≥ stack.hit_count
            - grade ≥ stack.grade

    Rule (for unusual tier): own path — premium + V/OI thresholds only
    Rule (for algo tier): always excluded
    """
    tier = alert.get("_tierKey", "")

    if tier == "algo":
        return False

    # Optional (2026-07-21): hide direction-unconfirmed "UCT Size" (keep-as-Size)
    # rows from the curated feed. They're big prints whose side we couldn't call —
    # SHOWN by default; the admin can hide them since they're non-directional.
    # Toggle `hide_sizeless` in /thresholds. (Auto-push already never fires them.)
    if thresholds.get("hide_sizeless") and (
        alert.get("_directionUnconfirmed")
        or "not clean" in (alert.get("alertName") or "").lower()
    ):
        return False

    prem = alert.get("alertPremium") or 0
    v_oi = alert.get("volumeOIRatio") or 0
    hit_count = alert.get("_hitCount") or 1
    grade = alert.get("grade", "")
    mkt_cap = alert.get("_mktCap") or 0
    # 7/7: source-aware branch. ETFs have fundamentally different premium
    # scales — $100K on SPY is retail dust, but institutional on a $10B stock.
    # etf_premium_floors is a flat dict keyed by tier (no cap bands, since
    # major ETFs are all mega-scale). Falls back to stock floors if unset.
    is_etf = alert.get("source") == "indexes"

    # Unusual: own path. V/OI anomaly + small premium IS the signal.
    if tier == "unusual":
        u = (thresholds.get("etf_unusual") if is_etf
             else thresholds.get("unusual", {})) or {}
        return (prem >= u.get("min_premium", 100_000) and
                v_oi >= u.get("vOI", 5.0))

    if tier not in ("alpha", "size", "leaps", "bullish", "bearish"):
        return False

    stack = thresholds.get("stack", {})
    cap_bands = thresholds.get("cap_bands", {})

    # ─── HARD requirement: premium tier floor ─────────────────────────
    if is_etf:
        # Flat ETF floors, no cap band
        etf_floors = thresholds.get("etf_premium_floors", {}) or {}
        prem_floor = etf_floors.get(tier, 0)
    else:
        prem_caps = thresholds.get("premium_by_cap", {}).get(tier, {})
        band = _cap_band_key(mkt_cap, cap_bands)
        prem_floor = prem_caps.get(band, 0)
    if prem < prem_floor:
        # 7/7 rollup rescue: check if this contract's daily aggregate crosses
        # the floor. Only fires when caller passes contract_totals. Rescue
        # ONLY applies to the premium floor — V/OI required + confirmer count
        # still have to pass on this individual event. Prevents rollup from
        # laundering low-conviction fragments through a big-total shell.
        if contract_totals is not None:
            key = (f"{alert.get('ticker','')}|{alert.get('cp','')}|"
                   f"{alert.get('strike','')}|{alert.get('exp','')}")
            aggregate = contract_totals.get(key, 0)
            if aggregate < prem_floor:
                return False
            # Rescue applies — fall through to remaining checks
        else:
            return False

    # ─── Optional HARD gate: V/OI (7/7) ───────────────────────────────
    # When admin panel has "V/OI required" ticked, V/OI < stack.vOI is a
    # short-circuit fail regardless of grade/hit_count confirmers. Lets
    # the panel enforce Ravi's stated priority of volume>OI without
    # changing the underlying 1-of-3 confirmer semantics.
    if stack.get("voi_required", False) and v_oi < stack.get("vOI", 3.0):
        return False

    # ─── Count quality signals (V/OI, hits, grade) ────────────────────
    quality_signals = 0
    if v_oi >= stack.get("vOI", 3.0):
        quality_signals += 1
    if hit_count >= stack.get("hit_count", 3):
        quality_signals += 1
    min_grade_n = _GRADE_NUMERIC.get(stack.get("grade", "B"), 2)
    if _GRADE_NUMERIC.get(grade, 0) >= min_grade_n:
        quality_signals += 1

    return quality_signals >= stack.get("min_signals", 1)


# ─── Dormant ticker tracking (true "Unusual name" detection) ──────────────
# A ticker is "dormant" if it has NOT produced any classifiable MAGENTA/
# YELLOW alert in the past N trading days. The Unusual tier promotes a
# dormant ticker that suddenly shows up with high V/OI flow — the canonical
# "name that doesn't normally trade flow is suddenly trading" signal.
#
# Storage model:
#   /data/dormant_tickers.json — JSON file written by the recompute job.
#   Contains the ACTIVE set (smaller than universe of all tickers).
#   Lookup: ticker IN active_set → not dormant. NOT IN → dormant.
#
# Performance model:
#   File loaded into a frozenset at module level. Membership check is O(1).
#   Cache invalidates on file mtime change (so manual recompute takes effect
#   without restart).
#
# Graceful fallback:
#   If dormant data hasn't been computed yet (initial deploy, missing file),
#   _has_dormant_data() returns False and the classifier falls back to the
#   legacy V/OI-only Unusual rule. This means the system works seamlessly
#   pre- and post-precompute without manual coordination.

_DORMANT_PATH = os.environ.get("DORMANT_TICKERS_PATH", "/data/dormant_tickers.json")
_dormant_cache = None         # full JSON object (for status display)
_dormant_active_set = None    # frozenset(active_tickers) for fast lookup
_dormant_loaded_mtime = 0     # mtime when we last loaded (for cache invalidation)


def _load_dormant_tickers():
    """Load dormant tickers data from disk into module cache. Re-reads if
    file mtime is newer than our cached load time (so manual recomputes
    take effect without process restart). Safe to call on every request."""
    global _dormant_cache, _dormant_active_set, _dormant_loaded_mtime
    try:
        if not os.path.exists(_DORMANT_PATH):
            # Reset caches if file was deleted
            if _dormant_cache is not None:
                _dormant_cache = None
                _dormant_active_set = None
                _dormant_loaded_mtime = 0
            return
        mtime = os.path.getmtime(_DORMANT_PATH)
        if _dormant_cache is not None and mtime <= _dormant_loaded_mtime:
            return  # cache still valid
        with open(_DORMANT_PATH) as f:
            data = json.load(f)
        _dormant_cache = data
        _dormant_active_set = frozenset(data.get("active_tickers", []))
        _dormant_loaded_mtime = mtime
    except Exception as e:
        print(f"[dormant] load error: {e}")
        # Don't clobber existing cache on error — better to use stale than empty
        if _dormant_cache is None:
            _dormant_cache = {}
            _dormant_active_set = frozenset()


def _has_dormant_data() -> bool:
    """True if precompute has been run and active-tickers set is loaded.
    When False, classifier should fall back to legacy V/OI Unusual rule."""
    _load_dormant_tickers()
    return _dormant_active_set is not None and len(_dormant_active_set) > 0


def _is_dormant_ticker(symbol: str) -> bool:
    """True if ticker is NOT in the active-tickers set (i.e. dormant).
    Returns False if no precompute data — caller should check _has_dormant_data()
    first to decide which classification path to take."""
    _load_dormant_tickers()
    if _dormant_active_set is None:
        return False
    return symbol not in _dormant_active_set


def _trading_days_back(n: int, end_date: date = None) -> list:
    """Return the last N trading days as date objects, ending at `end_date`
    (default: today). Weekends excluded. Holidays NOT excluded (over-includes
    by 5-9 calendar days per year, harmless for "dormancy in N trading days").
    """
    end = end_date or datetime.now(ET).date()
    dates = []
    d = end
    while len(dates) < n:
        if d.weekday() < 5:  # 0-4 = Mon-Fri
            dates.append(d)
        d -= timedelta(days=1)
    return dates


def _compute_active_tickers(lookback_days: int = 30) -> dict:
    """Scan FlowDB for distinct tickers with at least one classifiable
    MAGENTA/YELLOW alert in the past N trading days. Returns dict matching
    the JSON file schema. Heavy operation — full DB scan, can take 1-5s."""
    trading_dates = _trading_days_back(lookback_days)
    earliest = trading_dates[-1]
    today = trading_dates[0]
    date_strs = [f"{d.month}/{d.day}/{d.year}" for d in trading_dates]

    conn = sqlite3.connect(DB_PATH, timeout=30)
    try:
        placeholders = ",".join("?" for _ in date_strs)
        cur = conn.execute(f"""
            SELECT Symbol, COUNT(*) AS hits
              FROM flow
             WHERE source = 'stocks'
               AND Color IN ('MAGENTA', 'YELLOW')
               AND CreatedDate IN ({placeholders})
             GROUP BY Symbol
        """, date_strs)
        rows = cur.fetchall()
        active = sorted([r[0] for r in rows if r[0]])
        total_hits = sum(r[1] for r in rows)
    finally:
        conn.close()

    return {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "lookback_trading_days": lookback_days,
        "earliest_date": f"{earliest.month}/{earliest.day}/{earliest.year}",
        "today_date": f"{today.month}/{today.day}/{today.year}",
        "active_tickers": active,
        "active_count": len(active),
        "total_alerts_scanned": total_hits,
    }


def _is_unusual_classification(symbol: str, v_oi: float, premium: int) -> bool:
    """Should this alert be classified as Unusual tier?

    Two modes depending on whether dormant precompute data is available:

    Dormant mode (preferred — when precompute has been run):
      Symbol must be DORMANT (not in active set) +
      V/OI >= 5.0 + premium >= $100K.
      This catches "quiet name suddenly waking up" — the canonical Unusual.
      AAPL/NVDA/TSLA will NEVER qualify because they trade every day.

    Legacy mode (fallback — pre-precompute):
      V/OI >= 5.0 + premium < $500K.
      Preserved so the system works seamlessly during initial deploy before
      the dormant precompute has been triggered.
    """
    if v_oi < 5.0:
        return False
    if _has_dormant_data():
        return _is_dormant_ticker(symbol) and premium >= 100_000
    # Legacy fallback
    return premium < 500_000


def _parse_int(s, default=0):
    try:
        return int(s) if s else default
    except (ValueError, TypeError):
        return default


def _oi_status(raw):
    """Distinguish 'OI explicitly known to be zero' (fresh strike, no
    settled positions yesterday) from 'OI unknown' (Schwab couldn't
    retrieve data for this contract).

    Both return integer 0 from _parse_int, but they're semantically
    different: a real fresh strike with active volume is high-conviction
    institutional positioning (every contract today is new exposure),
    while unknown OI is just missing data.

    Returns one of:
      ("known", int)  — Schwab returned a positive integer value
      ("zero", 0)     — Schwab explicitly returned "0" (real fresh strike)
      ("unknown", 0)  — Schwab returned null/empty (failed fetch)
    """
    if raw is None:
        return ("unknown", 0)
    if isinstance(raw, str):
        raw_s = raw.strip()
        if raw_s == "":
            return ("unknown", 0)
        if raw_s == "0":
            return ("zero", 0)
        try:
            val = int(raw_s)
            if val > 0:
                return ("known", val)
            if val == 0:
                return ("zero", 0)
            return ("unknown", 0)  # negative is weird, treat as unknown
        except ValueError:
            return ("unknown", 0)
    if isinstance(raw, (int, float)):
        if raw > 0:
            return ("known", int(raw))
        if raw == 0:
            return ("zero", 0)
        return ("unknown", 0)
    return ("unknown", 0)


def _parse_float(s, default=0.0):
    try:
        return float(s) if s else default
    except (ValueError, TypeError):
        return default


def _parse_strike(s):
    """Strike may be stored as '30' or '30.5' or '30.0' — return float."""
    return _parse_float(s, 0.0)


def _ts_from_row(created_date: str, created_time: str) -> float:
    """'6/26/2026' + '11:25:14 AM' -> Unix timestamp."""
    try:
        m, d, y = created_date.split("/")
        # Parse the time format "H:MM:SS AM/PM"
        t = datetime.strptime(created_time.strip(), "%I:%M:%S %p")
        dt = datetime(int(y), int(m), int(d), t.hour, t.minute, t.second, tzinfo=ET)
        return dt.timestamp()
    except (ValueError, AttributeError):
        return 0.0


def _derive_direction(cp: str, side: str, type_: str = ""):
    """Bull/Bear from Side+CP. Returns None when the side classification
    is too ambiguous to call directional.

    Refined rule (added 6/30 evening, after audit analysis showed bid-side
    blocks are unreliable directional signals):

      Aggressive sides (kept as directional):
        - A   (at ask)        — buyer aggression
        - AA  (above ask)     — strong buyer aggression
        - BB  (below bid)     — strong seller aggression

      Ambiguous side (dropped — return None):
        - B   (at bid)        — can be closing trade, covered call write,
                                dealer hedge, or genuine seller aggression.
                                Without more context, not a clean direction
                                signal. Trader can still see these in
                                uncurated mode.
        - Mid / blank         — no signal at all

    Tunable via thresholds.derive_strict_bid_only_bb. When False, falls back
    to legacy behavior treating B and BB identically (pre-6/30 logic).

    Empty-side SWEEP fallback (added 2026-07-03):
      When side is empty AND type is SWEEP, presume A (at ask). Sweeps are
      by definition aggressive orders that cross the spread across venues;
      market microstructure makes them almost always buyer-initiated
      (~85%+ per BBS side distribution audit). This lets high-conviction
      institutional sweeps (e.g. SPCX $2.4M 10:36 CALL SWEEP on 7/2) reach
      the Premium Override rescue path in _derive_alert_name, which they
      previously couldn't because empty-side rows exited before the
      override could run.

      Only applies to SWEEP type (including ISO variants). BLOCKs stay
      strict — a $3M BLOCK with no side signal is more ambiguous than a
      SWEEP (could be portfolio rebalance, dealer facilitation, etc.).

      Tunable via thresholds.sweep_empty_side_as_ask (default True).
      Set False to revert to strict "empty = drop" behavior.

    For PUT contracts, direction maps inversely as before.
    """
    side_norm = (side or "").strip().upper()
    type_up = (type_ or "").upper().strip().strip("/")
    is_sweep = ("SWEEP" in type_up) or ("ISO" in type_up)

    # Empty-side handling with SWEEP fallback
    if not side_norm:
        try:
            thresholds = _load_thresholds()
            sweep_fallback = thresholds.get("sweep_empty_side_as_ask", True)
        except Exception:
            sweep_fallback = True
        if sweep_fallback and is_sweep:
            # Presume ASK — sweeps are buyer-driven
            side_is_ask = True
            side_is_bid = False
        else:
            return None
    else:
        # Non-empty side: original strict/legacy logic
        try:
            thresholds = _load_thresholds()
            strict = thresholds.get("derive_strict_bid_only_bb", True)
        except Exception:
            strict = True

        # Aggressive ask-side (always directional)
        if side_norm in ("A", "AA"):
            side_is_ask = True
            side_is_bid = False
        elif side_norm == "BB":
            # Below-bid: unambiguous seller aggression, always directional
            side_is_ask = False
            side_is_bid = True
        elif side_norm == "B":
            if strict:
                # Strict mode: at-bid alone is ambiguous, drop
                return None
            # Legacy mode: treat B same as BB
            side_is_ask = False
            side_is_bid = True
        else:
            # Unknown side string
            return None

    if cp == "CALL":
        if side_is_ask: return "Bull"
        if side_is_bid: return "Bear"
    elif cp == "PUT":
        if side_is_ask: return "Bear"   # PUT bought = bearish bet
        if side_is_bid: return "Bull"   # PUT sold = bullish bet
    return None


def _derive_alert_name(row: dict, direction: str, money_pct: float | None = None):
    """Returns (alertName, tier_key, tier_priority), or None if the row
    is a WHITE color that didn't qualify for premium-override promotion.

    Mapping aligns to LiveFlow.jsx deriveTier() so the existing UI groups
    Massive rows into the right colored sections without modification.

    money_pct (optional): signed moneyness percentage (positive = ITM,
    negative = OTM) from _moneyness(). When provided, deep-ITM rows are
    blocked from Alpha Gold tier and fall through to Size tier instead.
    See thresholds.alpha_max_itm_pct for the cutoff (default 25%).
    """
    color = row["Color"]
    type_ = row["Type"] or ""
    premium = _parse_int(row["Premium"])
    side = row["Side"] or ""
    dte = _parse_int(row["Dte"])
    volume = _parse_int(row["Volume"])
    oi = _parse_int(row["OI"])
    v_oi = (volume / oi) if oi > 0 else 0

    # Distinguish "explicitly zero OI" (real fresh strike) from "unknown
    # OI" (Schwab fetch failed). _parse_int collapses both to 0 for math,
    # but the gates need the distinction to handle fresh strikes correctly.
    oi_status, _ = _oi_status(row.get("OI"))
    # oi_status is one of: "known", "zero", "unknown"

    try:
        fresh_strike_min_vol = _load_thresholds().get(
            "fresh_strike_min_volume", 100)
    except Exception:
        fresh_strike_min_vol = 100
    # A row counts as "fresh-strike-with-volume" when Schwab confirmed
    # zero OI yesterday AND today's volume crosses the threshold.
    # Every contract trading today is brand-new exposure -- the strongest
    # possible "fresh positioning" signal.
    is_fresh_strike = (oi_status == "zero" and volume >= fresh_strike_min_vol)

    # Multi-leg complex strategies → Algo (non-directional, low priority)
    if type_ == "ML/":
        return ("Algo", "algo", TIER_PRIORITY["algo"])

    # ─── Global deep-ITM rejection (added 6/30 morning) ──────────────
    # Trades deeper than max_itm_pct% ITM are synthetic-stock-substitute
    # plays with no flow-signal value. Reject entirely -- the row will
    # not appear in /live-massive at all. Distinct from the Alpha-tier-
    # only filter (alpha_max_itm_pct, typically 25%) which only demotes.
    # This rejects across ALL tiers above the higher threshold (50%).
    try:
        max_itm = _load_thresholds().get("max_itm_pct", 50.0)
    except Exception:
        max_itm = 50.0
    if money_pct is not None and money_pct > max_itm:
        return None

    is_leaps = dte >= 180
    side_is_ask = side in ("A", "AA")

    # Direction-aware tier key: Bull → "bullish", Bear → "bearish".
    # Both share priority 3 in TIER_PRIORITY, just rendered in different
    # colored sections in LiveFlow.jsx (green vs red).
    dir_tier = "bullish" if direction == "Bull" else "bearish"

    # ─── Premium override (rescue high-conviction WHITE rows) ──────────
    # Massive's classifier assigns Color = WHITE when cum_vol/OI < 1.0.
    # If OI is unknown (e.g. fresh strike, Schwab snapshot miss), the
    # ratio defaults to 0 → WHITE → row filtered out of /live-massive.
    # But a $3M ASK sweep is institutional-grade regardless of what OI
    # says. This rule promotes those rows to MAGENTA-equivalent classify-
    # ation so they surface. Tunable via thresholds.premium_override.
    if color == "WHITE":
        try:
            override = _load_thresholds().get("premium_override", {})
        except Exception:
            override = {}
        if override.get("enabled", True):
            min_prem = override.get("min_premium", 1_000_000)
            require_sb = override.get("require_sweep_or_block", True)
            type_up = type_.upper().strip().strip("/")
            is_sweep_or_block = (
                "SWEEP" in type_up or "ISO" in type_up or "BLOCK" in type_up
                or type_up in ("BLK", "B", "BL", "BT", "S", "SW", "IS")
            )
            if premium >= min_prem and (is_sweep_or_block or not require_sb):
                # Promote — fall through to MAGENTA branch below.
                color = "MAGENTA"

    if color == "MAGENTA":
        # Alpha Gold — rarest, top tier
        if premium >= 1_000_000 and side_is_ask and not is_leaps:
            # ─── Alpha Gold quality gates (ALL must pass) ──────────────
            # Each gate is independent. Failing any gate falls through
            # to the Size / Unusual / Bullish-Bearish tier below.
            try:
                thresholds = _load_thresholds()
            except Exception:
                thresholds = DEFAULT_THRESHOLDS
            deep_itm_threshold = thresholds.get("alpha_max_itm_pct", 25.0)
            min_vol_oi_ratio = thresholds.get("alpha_min_vol_oi_ratio", 1.0)
            exclude_blocks = thresholds.get("alpha_exclude_block_type", True)
            max_weekly_dte = thresholds.get("alpha_max_weekly_dte", 7)

            # Gate 1 — Deep-ITM filter (added 6/29 audit):
            # Deep in-the-money calls/puts are delta-exposure plays
            # (essentially synthetic stock with leverage), not directional
            # conviction. A $1M+ ask-side fire on a 60% ITM call is
            # mechanical positioning -- the trader is buying stock
            # exposure, not making a conviction directional bet.
            is_deep_itm = (money_pct is not None and money_pct > deep_itm_threshold)

            # Gate 2 — Volume-exceeds-OI gate (added 6/30 morning):
            # Alpha Gold requires fresh institutional positioning -- new
            # exposure being created, not adjustments to existing positions.
            # Volume strictly greater than OI means today's flow is larger
            # than the entire prior accumulated position. That's new
            # conviction, not noise.
            #
            # Two pass conditions (added 6/30 evening, for fresh strikes):
            #   1. Normal: oi > 0 AND v_oi > min_vol_oi_ratio
            #   2. Fresh strike: Schwab confirmed OI=0 AND volume above
            #      fresh_strike_min_volume floor.
            #
            # Schwab MISSES (oi unknown / fetch failed) still fail this
            # gate -- we don't have the data to evaluate freshness.
            vol_exceeds_oi = (
                (oi > 0 and v_oi > min_vol_oi_ratio)
                or is_fresh_strike
            )

            # Gate 3 — Block-type exclusion (added 6/30 morning):
            # BLOCK trades are pre-negotiated single transactions. High
            # V/OI on a block can be artifact of a multi-leg structure
            # (delta-neutral spread, stock-hedge pair) where the apparent
            # directional signal is offset by the other leg. Until
            # next-day settled OI confirms real exposure, blocks don't
            # earn Alpha Gold conviction. SWEEPs are still allowed --
            # they're inherently aggressive liquidity-takers and the
            # V/OI signal is cleaner for them.
            type_up_g = (type_ or "").upper().strip().strip("/")
            is_block = ("BLOCK" in type_up_g) or type_up_g in ("BLK", "BL", "BT")
            block_disqualifies = exclude_blocks and is_block

            # Gate 4 — Weekly exclusion (added 7/8 evening):
            # Short-dated calls/puts (DTE < alpha_max_weekly_dte, default 7)
            # are weekly speculation, not high-conviction positioning. Even
            # $1M+ SWEEPs on 2-DTE strikes are more likely event-driven
            # momentum than institutional exposure builds. Excluded from
            # Alpha Gold; fall through to Size tier where they still
            # surface at the $500K-$1M floor if premium clears it.
            #
            # Threshold is tunable via /thresholds admin panel. Setting
            # alpha_max_weekly_dte to 0 disables this gate (recovers
            # previous behavior — short-dated big prints eligible for Alpha).
            is_weekly = (dte is not None and dte < max_weekly_dte)

            if (not is_deep_itm and vol_exceeds_oi
                    and not block_disqualifies and not is_weekly):
                return (f"UCT Alpha Gold {direction}", "alpha", TIER_PRIORITY["alpha"])
            # Any gate failed → fall through to Size / Unusual / Bullish-Bearish
        # LEAPS
        # V/OI gate (added 6/30 evening): LEAPS now requires fresh
        # positioning OR fresh-strike with volume. Long-dated contracts
        # that fail the gate (e.g. low V/OI on stale OI) get dropped
        # from curated entirely. Trade still exists in raw feed.
        if is_leaps:
            try:
                leaps_min_voi = _load_thresholds().get(
                    "leaps_min_vol_oi_ratio", 1.0)
            except Exception:
                leaps_min_voi = 1.0
            leaps_vol_exceeds_oi = (
                (oi > 0 and v_oi > leaps_min_voi)
                or is_fresh_strike
            )
            if leaps_vol_exceeds_oi:
                return (f"UCT {direction} LEAPS", "leaps", TIER_PRIORITY["leaps"])
            # V/OI gate failed → drop from curated
            return None
        # Unusual — dormant ticker (per past N trading days) waking up with
        # high V/OI flow. When precompute data unavailable, falls back to
        # legacy V/OI-only rule. See _is_unusual_classification() for full
        # explanation.
        if _is_unusual_classification(row["Symbol"], v_oi, premium):
            return ("UCT Unusual Name", "unusual", TIER_PRIORITY["unusual"])
        # Size — big premium magenta
        # Size tier V/OI gate (added 6/30 evening): like Alpha Gold,
        # Size now requires fresh institutional positioning. Two pass
        # conditions:
        #   1. Normal: oi > 0 AND v_oi > size_min_vol_oi_ratio
        #   2. Fresh strike: Schwab confirmed OI=0 AND volume above
        #      fresh_strike_min_volume floor (added 6/30 evening).
        # Schwab misses (oi unknown) fall through to bullish/bearish.
        if premium >= 500_000:
            try:
                size_min_voi = _load_thresholds().get("size_min_vol_oi_ratio", 1.0)
            except Exception:
                size_min_voi = 1.0
            size_vol_exceeds_oi = (
                (oi > 0 and v_oi > size_min_voi)
                or is_fresh_strike
            )
            if size_vol_exceeds_oi:
                return (f"UCT Size {direction}s", "size", TIER_PRIORITY["size"])
            # V/OI gate failed → fall through to bullish/bearish
        # Regular bullish/bearish magenta
        # V/OI gate (added 6/30 evening): catchall tier now requires
        # vol > OI before classifying as Bullish/Bearish. Without it,
        # noisy stale-OI directional reads (V/OI 0.01-0.20) clutter
        # the curated feed. Today's audit (6/30) confirmed this pattern
        # produced 36% direction-disagreement vs BBS/Bullflow on the
        # Bearish tier.
        try:
            bull_bear_min_voi = _load_thresholds().get(
                "bullish_bearish_min_vol_oi_ratio", 1.0)
        except Exception:
            bull_bear_min_voi = 1.0
        bull_bear_vol_exceeds_oi = (
            (oi > 0 and v_oi > bull_bear_min_voi)
            or is_fresh_strike
        )
        if bull_bear_vol_exceeds_oi:
            return (f"UCT {direction}ish", dir_tier, TIER_PRIORITY[dir_tier])
        # V/OI gate failed → drop from curated entirely
        return None

    if color == "YELLOW":
        if is_leaps:
            return (f"UCT {direction} LEAPS", "leaps", TIER_PRIORITY["leaps"])
        # YELLOW = cumulative accumulation
        return (f"UCT {direction}ish Accumulation", dir_tier, TIER_PRIORITY[dir_tier])

    # WHITE rows that reached here didn't qualify for premium-override
    # promotion (premium too low, or wrong type). Skip — caller filters None.
    return None


def _moneyness(strike: float, spot: float, cp: str):
    """Returns (pct, label) where pct is signed (negative for OTM puts,
    positive for OTM calls). Label is ITM/ATM/OTM."""
    if not spot or not strike:
        return (None, None)
    pct = (spot - strike) / strike * 100.0
    if cp == "PUT":
        pct = -pct  # PUTs: ITM when spot < strike, so flip
    if abs(pct) < 1.0:
        return (round(pct, 1), "ATM")
    if pct > 0:
        return (round(pct, 1), "ITM")
    return (round(pct, 1), "OTM")


def _compute_conviction(premium: int, oi: int, volume: int,
                        tier_priority: int, moneyness_label: str | None,
                        moneyness_pct: float | None, is_leaps: bool) -> tuple[float, str]:
    """
    Ported from liveflow_worker._compute_conviction. Simplified because we
    don't have multi-fire aggregate state in real-time (single rows only).

    Score components (0-10 cap):
      Premium tier:    0-3
      OI break ratio:  0-2
      Tier priority:   0-3 (Alpha highest, Algo lowest)
      Moneyness:       0-1
      LEAPS bonus:     0-0.5
    """
    score = 0.0

    # Premium tier (0-3)
    if premium >= 5_000_000:   score += 3.0
    elif premium >= 2_000_000: score += 2.5
    elif premium >= 1_000_000: score += 2.0
    elif premium >= 500_000:   score += 1.5
    elif premium >= 250_000:   score += 1.0
    else:                      score += 0.5

    # OI break (0-2)
    if oi > 0 and volume > oi:
        ratio = volume / oi
        if ratio >= 5.0:   score += 2.0
        elif ratio >= 2.0: score += 1.5
        else:              score += 1.0

    # Tier priority (0-3)
    if tier_priority == 1:   score += 3.0   # Alpha Gold
    elif tier_priority == 2: score += 2.0   # Size
    elif tier_priority == 3: score += 1.25  # Bullish/Bearish
    elif tier_priority == 4: score += 1.0   # LEAPS
    elif tier_priority == 5: score += 0.5   # Unusual
    else:                    score += 0.25  # Algo

    # Moneyness (0-1)
    if moneyness_label == "ITM":
        if moneyness_pct is not None and 5 <= moneyness_pct <= 30:
            score += 1.0
        else:
            score += 0.75
    elif moneyness_label == "ATM":
        score += 0.75
    elif moneyness_label == "OTM" and moneyness_pct is not None:
        ap = abs(moneyness_pct)
        if ap <= 5: score += 0.6
        elif ap <= 15: score += 0.3

    # LEAPS bonus
    if is_leaps:
        score += 0.5

    score = min(score, 10.0)
    if score >= 8.5: grade = "A+ 🚀"
    elif score >= 7.0: grade = "A"
    elif score >= 5.5: grade = "B"
    elif score >= 3.5: grade = "C"
    else: grade = "D"

    return (round(score, 1), grade)


def _row_to_alert(row: dict, require_direction: bool = True) -> dict | None:
    """Translate a FlowDB row to the alert shape LiveFlow.jsx expects.
    Returns None if the row should be skipped (e.g., unclassified side).

    require_direction=True (default, used by the tape/day-stats): a row with no
    derivable direction is dropped. require_direction=False (by-contract rollup):
    direction-less prints are KEPT (with _direction=None) so the accumulation view
    counts repetition regardless of side quality — but true noise (deep-ITM,
    lottery, spread legs) is still dropped. Side accuracy itself is a separate,
    worker-side fix; here we just stop the broken sides from hiding real repeats.
    """
    cp_full = row["CallPut"]
    cp_short = "C" if cp_full == "CALL" else ("P" if cp_full == "PUT" else "")
    side = row["Side"] or ""

    strike = _parse_strike(row["Strike"])
    spot = _parse_float(row["Spot"])
    money_pct, money_label = _moneyness(strike, spot, cp_full)
    premium = _parse_int(row["Premium"])

    direction = _derive_direction(cp_full, side, row.get("Type", ""))
    # Deep-ITM side/direction guard (2026-07-20): on deeply-ITM contracts the
    # single-venue NBBO is unreliable (wide/stale books), so the A/B/AA/BB side —
    # and therefore bull/bear — is frequently wrong (AMAT/MU LEAP puts read the
    # OPPOSITE side of BBS). Beyond direction_max_itm_pct, drop the direction:
    # better directionless than a confidently-wrong bull/bear. Tunable; 0 disables.
    if direction is not None and money_label == "ITM" and money_pct is not None:
        try:
            _dir_itm_cap = _load_thresholds().get("direction_max_itm_pct", 20.0)
        except Exception:
            _dir_itm_cap = 20.0
        if _dir_itm_cap and money_pct > _dir_itm_cap:
            direction = None
    # Null-spot fail-CLOSED (2026-07-23). The guard above needs money_pct, which
    # needs spot — and the deep-ITM/lottery noise filters further down are all
    # gated on `spot > 0` too. So when spot enrichment is missing (ISRG 7/23:
    # a whole symbol arrived with Spot NULL), every one of those protections
    # SKIPS and a 75%-ITM put bought at parity publishes as a clean
    # "UCT Size Bears". Same philosophy as the guard above — better
    # directionless than confidently wrong — so approximate moneyness from
    # price vs strike instead of trusting it.
    #
    # A deep-ITM option trades at ~intrinsic, so at parity we can recover spot:
    #   PUT : spot ≈ strike - price  → moneyness = price / (strike - price)
    #   CALL: spot ≈ strike + price  → moneyness = price / (strike + price)
    # Solving each for "moneyness > direction_max_itm_pct" gives a pure
    # price-vs-strike trip point, so this guard uses the SAME cap as the
    # spot-based one above rather than a second hardcoded number:
    #   PUT  trips when price > strike * cap/(100 + cap)
    #   CALL trips when price > strike * cap/(100 - cap)
    # This only drops DIRECTION; keep-as-Size below still decides whether the
    # row survives as a neutral Size print. Tunable — set
    # spotless_itm_guard=false to restore the old fail-open behaviour.
    # Only applied under 365 DTE: the at-parity assumption needs extrinsic to be
    # small relative to intrinsic. On LEAPS it isn't — an OTM 2028 put can carry
    # $34 of pure time value and would trip this falsely — so LEAPS keep their
    # direction and rely on the spot-based guard once enrichment is fixed.
    if direction is not None and money_pct is None and strike > 0 \
            and 0 < (_parse_int(row.get("Dte")) or 0) < 365:
        _px_guard = _parse_float(row.get("Price"))
        if _px_guard and _px_guard > 0:
            try:
                _t = _load_thresholds()
                _spotless_on = _t.get("spotless_itm_guard", True)
                _cap_no_spot = float(_t.get("direction_max_itm_pct", 20.0) or 0)
            except Exception:
                _spotless_on, _cap_no_spot = True, 20.0
            if _spotless_on and _cap_no_spot > 0:
                if cp_full == "PUT":
                    _trip = strike * (_cap_no_spot / (100.0 + _cap_no_spot))
                else:
                    _denom = max(100.0 - _cap_no_spot, 1.0)
                    _trip = strike * (_cap_no_spot / _denom)
                if _px_guard > _trip:
                    direction = None
    # Keep-as-Size override (2026-07-20): when the side can't be trusted — the
    # deep-ITM guard above, an ambiguous at-bid "B", or a blank single-venue
    # NBBO — direction is None. Real size shouldn't vanish on a side we can't
    # call, so if premium clears keep_sizeless_min_premium, KEEP the print as a
    # NEUTRAL Size row (no Bull/Bear) instead of dropping it. Below the floor a
    # direction-less row is still noise → drop.
    _sizeless = False
    if direction is None and require_direction:
        try:
            _keep_floor = _load_thresholds().get("keep_sizeless_min_premium", 1000000)
        except Exception:
            _keep_floor = 1000000
        if _keep_floor and premium >= _keep_floor:
            _sizeless = True
        else:
            return None

    volume = _parse_int(row["Volume"])
    oi = _parse_int(row["OI"])
    dte = _parse_int(row["Dte"])
    price = _parse_float(row["Price"])

    # ─── Noise filter 0: Spot-independent deep-ITM heuristic ────────────────
    # When Spot is missing (backfilled historical data), the % from spot
    # can't be computed. Fall back to a heuristic using option price vs
    # strike: deep-ITM options are priced near their intrinsic value,
    # which is a large fraction of the strike.
    #
    # Example: CSCO $80c at $32.5 → price/strike = 40.6% → clearly deep
    # ITM (spot must be ~$112). Normal near-money calls are 2-5% of strike.
    #
    # Combined with DTE < 90 to avoid false-positives on LEAPS that
    # legitimately have high time-value prices.
    #
    # Only fires when: Type is BLOCK AND price >= 15% of strike AND
    # DTE < 90. This is spot-independent so it works on 7/2 backfill
    # data where the strike/spot filter can't fire.
    type_str_for_early = (row.get("Type") or "").upper().strip()
    is_block_for_early = type_str_for_early == "BLOCK" or "BLK" in type_str_for_early
    if is_block_for_early and strike > 0 and price > 0 and dte < 90:
        price_strike_ratio = price / strike
        if price_strike_ratio >= 0.15:
            return None  # deep-ITM BLOCK detected via price/strike heuristic

    # ─── Noise filter 1: Deep-money classification (matches OptionsFlow.jsx) ─
    # Ports the exact isDeep + BLK-filter logic that OptionsFlow uses to
    # kill CSCO $80c-style noise (spot $112, 28.8% ITM BLOCKs at $32.5 =
    # arb/rebalancing spread legs, not directional).
    #
    # isDeep threshold varies by type:
    #   - BLOCK: 10% from spot (more aggressive; blocks at moderate ITM
    #     depth are usually spread legs)
    #   - SWEEP: 20% from spot (kept as "urgency" unless very deep)
    #
    # Filter rules:
    #   1. Deep ITM BLOCK → FILTER (arb/rebalancing)
    #   2. Very deep ITM SWEEP (intrinsic > 50% spot) → FILTER (synthetic roll,
    #      matches AXTI $130p at spot $55 case)
    #   3. Deep ITM SWEEP at 20-50% ITM → KEEP (urgency signal)
    #
    # Only applies when spot > 0. Missing spot skips this check (but
    # noise filter 0 above catches the deep-ITM BLOCK case via
    # price/strike heuristic).
    type_str = (row.get("Type") or "").upper().strip()
    is_block = type_str == "BLOCK" or "BLK" in type_str
    is_sweep = type_str == "SWEEP" or "SWP" in type_str or "SWEEP" in type_str
    if spot > 0 and strike > 0:
        pct_from_spot = abs(strike - spot) / spot * 100.0
        is_deep_by_type = pct_from_spot >= (10.0 if is_block else 20.0)
        is_itm = (cp_full == "CALL" and strike < spot) or (cp_full == "PUT" and strike > spot)
        if is_deep_by_type and is_itm:
            # Rule 1: Deep ITM BLOCK → always filter (arb/rebalancing/spread leg)
            if is_block:
                return None
            # Rule 2: Very deep ITM SWEEP (intrinsic > 50% spot) → filter
            if cp_full == "CALL":
                intrinsic = spot - strike
            elif cp_full == "PUT":
                intrinsic = strike - spot
            else:
                intrinsic = 0
            if intrinsic > spot * 0.5:
                return None  # synthetic roll

    # ─── Noise filter 2: Deep-OTM lottery ticket ─────────────────────────────
    # Trades that are >40% OTM AND have DTE < 365 are lottery tickets.
    # Legitimate deep-OTM LEAPS (DTE≥365) are institutional tail hedges
    # and should stay. Short-dated deep-OTM is retail gambling — high
    # noise, low signal. Matches OptionsFlow's deep-OTM guard.
    if spot > 0 and dte < 365:
        if cp_full == "CALL" and strike > spot * 1.4:
            return None  # >40% OTM call, short-dated → lottery
        if cp_full == "PUT" and strike < spot * 0.6:
            return None  # >40% OTM put, short-dated → lottery

    # ─── Noise filter 3: BBS-format ML/ skip ─────────────────────────────────
    # Distinguish real multi-leg spreads from Massive's aggregation label:
    #   - BBS ML/ (real spread legs): comes with populated OI (BBS enriches
    #     upstream). Each leg emitted with side classification. These ARE
    #     legit spread activity — not directional, should be skipped from
    #     directional tiers.
    #   - Massive ML/ (aggregation catch-all): ingests with OI=0. Often
    #     misclassified multi-exchange sweeps that should be rescued.
    #
    # If Type='ML/' AND OI>0, it's a BBS-format spread leg. Skip from
    # directional tier assignment (would still land in algo tier via
    # tier detection, which is always excluded from curated).
    if type_str == "ML/" and oi > 0:
        return None  # BBS-format spread leg, not a directional signal

    if direction is None and not _sizeless:
        # require_direction=False path: no clean direction, but the row passed
        # every noise filter above (not deep-ITM/lottery/spread). Return a
        # minimal alert so the by-contract rollup counts this print toward
        # repetition/size. No tier/grade/name — those are direction-derived.
        ts = _ts_from_row(row["CreatedDate"], row["CreatedTime"])
        return {
            "id": row["id"],
            "ticker": row["Symbol"],
            "cp": cp_short,
            "strike": strike,
            "exp": row["ExpirationDate"],
            "dte": dte,
            "source": row.get("source", "stocks"),
            "alertPremium": float(premium),
            "averageFillPrice": price,
            "tradeSize": volume,
            "timestamp": ts,
            "priorOI": oi if oi > 0 else None,
            "spot": spot if spot > 0 else None,
            "moneynessPct": money_pct,
            "moneynessLabel": money_label,
            "_mktCap": _parse_int(row.get("MktCap")),
            "_direction": None,
            "_side": side.strip().upper(),
            "_type": (row.get("Type") or ""),
            "_color": row.get("Color"),
            "grade": None,
            "_tierKey": None,
        }

    if _sizeless:
        # Untrustworthy side but premium cleared the floor → neutral Size row,
        # no Bull/Bear label (see keep_sizeless_min_premium).
        result = ("UCT Size - Not Clean", "size", TIER_PRIORITY["size"])
    else:
        result = _derive_alert_name(row, direction, money_pct=money_pct)
    if result is None:
        return None  # WHITE row that didn't qualify for premium override
    alert_name, tier_key, tier_priority = result
    is_leaps = dte >= 180

    score, grade = _compute_conviction(
        premium=premium, oi=oi, volume=volume,
        tier_priority=tier_priority, moneyness_label=money_label,
        moneyness_pct=money_pct, is_leaps=is_leaps,
    )

    ts = _ts_from_row(row["CreatedDate"], row["CreatedTime"])

    # Build OCC-style symbol for parity with Bullflow display path
    try:
        exp_m, exp_d, exp_y = row["ExpirationDate"].split("/")
        occ = f"O:{row['Symbol']}{int(exp_y)%100:02d}{int(exp_m):02d}{int(exp_d):02d}{cp_short}{int(strike*1000):08d}"
    except (ValueError, AttributeError):
        occ = row["Symbol"]

    return {
        "id": row["id"],
        "alertType": "massive",
        "alertName": alert_name,
        "_tierKey": tier_key,            # debug / diagnostic
        "_tierPriority": tier_priority,
        "symbol": occ,
        "ticker": row["Symbol"],
        "cp": cp_short,
        "strike": strike,
        "exp": row["ExpirationDate"],
        "dte": dte,
        "alertPremium": float(premium),
        "averageFillPrice": price,
        "tradeSize": volume,
        "timestamp": ts,
        "receivedAt": ts,                # same as timestamp (no Bullflow-style ingest delay)
        "latency": 0.0,
        "deliveryLatency": 0.0,
        "ingestedAt": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts > 0 else None,
        "priorOI": oi if oi > 0 else None,
        "volumeOIRatio": round(volume / oi, 2) if oi > 0 else None,
        "oiExceeded": (oi > 0 and volume > oi),
        "spot": spot if spot > 0 else None,
        "moneynessPct": money_pct,
        "moneynessLabel": money_label,
        "grade": grade,
        "convictionScore": score,
        "gatePassed": True,              # gating not implemented in test phase
        "forwardedToDiscord": False,     # not wired in test phase
        # Massive-specific extras (useful for debugging / future UI)
        "_color": row["Color"],
        "_side": side,
        "_type": row["Type"],
        "_sector": row["Sector"],
        "_mktCap": _parse_int(row["MktCap"]),
        "_weekly": row["Weekly"],
        "_er": row["ER"],
        "_uoa": row["Uoa"],
        "_direction": direction,
        "_directionUnconfirmed": _sizeless,
        # 7/7: expose source ('stocks' or 'indexes') so downstream code —
        # both the ETF-branch in _qualifies_curated and the frontend
        # ETF/Stocks toggle — can classify without a hardcoded ticker list.
        "source": row.get("source", "stocks"),
    }


def _today_mdyyyy() -> str:
    """Today as 'M/D/YYYY' (matches FlowDB CreatedDate format)."""
    d = datetime.now(ET).date()
    return f"{d.month}/{d.day}/{d.year}"


def _resolve_date(target_date) -> str:
    """Resolve an incoming target_date to the flow store's 'M/D/YYYY' format.
    None → today (ET). Accepts ISO 'YYYY-MM-DD' (the standard date-picker /
    task-spec format) and normalizes it — flow.db keys CreatedDate as M/D/YYYY,
    so an un-normalized ISO date silently matched ZERO rows (a 200-with-zeros
    'empty day' bug). Anything else is passed through unchanged (assumed already
    M/D/YYYY)."""
    if not target_date:
        return _today_mdyyyy()
    s = str(target_date).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)   # ISO YYYY-MM-DD
    if m:
        return f"{int(m.group(2))}/{int(m.group(3))}/{int(m.group(1))}"
    # Canonicalize M/D/YYYY too so a zero-padded '07/19/2026' collapses to the
    # flow.db key format '7/19/2026' (else it matches zero rows AND isn't 'today',
    # so it would be cached as an empty historical day).
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        return f"{int(m.group(1))}/{int(m.group(2))}/{int(m.group(3))}"
    return s


# Historical dates are NOT truly immutable: the T+1 flat-file ingest + gap-fill
# mutates "yesterday" AFTER it rolls into the past. So we cache historical dates
# with a long-but-BOUNDED TTL (default 6h) rather than never-expire — a morning
# view of yesterday re-checks within the window and picks up the backfill (this
# matters most for worker-history, whose job is gap detection).
_HISTORICAL_TTL = int(os.environ.get("MASSIVE_HISTORICAL_TTL", "21600"))  # 6h


def _cached_single_flight(cache_dict, key, lock, ttl, compute):
    """Generic serve-fresh / serve-stale / single-flight cache for the heavy
    per-date scan endpoints (diagnostic, worker-history). One recompute at a time
    per `lock`; a stale holder is served instantly instead of queueing behind the
    compute (that pile-up is what starved /recent). Heavy computes are bounded by
    the shared fill semaphore so a herd of cold callers can't pin the whole anyio
    threadpool. Pass a long `ttl` (_HISTORICAL_TTL) for past dates.

    NOTE: on a TRULY cold key (no value yet) concurrent callers all take the
    `with lock` branch and block until the first fills — bounded to one compute,
    but each blocked caller pins a threadpool thread meanwhile; the flow-worker
    warmer pre-fills today's keys so this window is narrow."""
    now = time.time()
    hit = cache_dict.get(key)
    if hit is not None and now - hit[0] < ttl:
        return hit[1]
    if not lock.acquire(blocking=False):
        if hit is not None:
            return hit[1]                              # serve stale; another refreshes
        with lock:                                    # cold first-ever: compute once
            h2 = cache_dict.get(key)
            if h2 is not None and time.time() - h2[0] < ttl:
                return h2[1]
            with _recent_fill_sem:                    # bound concurrent heavy scans
                payload = compute()
            cache_dict[key] = (time.time(), payload)
            return payload
    try:
        with _recent_fill_sem:                        # bound concurrent heavy scans
            payload = compute()
        cache_dict[key] = (time.time(), payload)
        return payload
    finally:
        lock.release()


def _get_worker_status() -> dict:
    """Worker liveness derived from FlowDB write recency.

    IMPORTANT: the web service and the Massive WS worker run in SEPARATE
    Railway services and don't share memory. Importing
    `from api.massive_ws_worker import get_status` works (same code) but
    returns the WEB service's copy of `_state`, which is never updated by
    the actual worker process. So `connected` would be permanently False
    even when the worker is healthy.

    Instead: query FlowDB for the most-recent stocks row. The worker writes
    rows continuously during market hours; if the latest row's timestamp
    is within `_STALE_THRESHOLD_SEC`, the worker is alive. Otherwise idle.
    Database is the shared substrate between the two services, so this
    avoids the cross-process state visibility problem entirely.
    """
    try:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        try:
            # Liveness = recency of the newest row for TODAY (ET), across all
            # sources. Two robustness fixes vs the old
            # `WHERE source='stocks' ORDER BY id DESC LIMIT 1`:
            #   1. Scope to today's CreatedDate. A spool-replay / heal can
            #      re-insert an OLD-dated row with a fresh (high) autoincrement
            #      id; the old query then returned that stale-dated row and froze
            #      last_event_at (observed stuck at "7/17" for days), so
            #      `connected` read False all day even while the tape was live.
            #      Filtering to today makes a replayed old row un-poisonable.
            #   2. Drop the source filter so index/ETF-only activity still
            #      registers as "live" (equity prints can lag intraday).
            today = _today_mdyyyy()
            cur = conn.execute("""
                SELECT id, CreatedDate, CreatedTime
                  FROM flow
                 WHERE CreatedDate = ?
                 ORDER BY id DESC LIMIT 1
            """, (today,))
            row = cur.fetchone()
            # GLOBAL max id (across ALL dates), separate from the today-scoped
            # liveness row above. This is liveflow_monitor's PRIMARY staleness
            # oracle (max_id delta between polls) and it MUST NOT go None just
            # because there are no rows for TODAY yet (pre-open) — else a consumer
            # that's dead AT the open (process up, HTTP 200, zero today-rows) is
            # misclassified BLIND_DB instead of WORKER_DOWN. MAX(id) on the rowid
            # PK is O(1). `connected`/`last_event_at` still derive from today's
            # newest row so a replayed old-dated row can't poison them.
            gmax = conn.execute("SELECT MAX(id) FROM flow").fetchone()
            global_max_id = gmax[0] if gmax else None
        finally:
            conn.close()
        if not row:
            return {
                "connected": False, "source": "massive",
                "last_event_at": None, "last_event_age_sec": None,
                "max_id": global_max_id,
                "note": "No rows for today yet — no live flow ingested.",
            }
        _today_id, created_date, created_time = row
        latest_ts = _ts_from_row(created_date, created_time)
        if not latest_ts:
            return {
                "connected": False, "source": "massive",
                "last_event_at": None, "last_event_age_sec": None,
                "max_id": global_max_id,
                "note": "Latest FlowDB row has unparseable timestamp.",
            }
        now = time.time()
        age = now - latest_ts
        connected = age < _STALE_THRESHOLD_SEC
        return {
            "connected": connected,
            "source": "massive",
            "last_event_at": datetime.fromtimestamp(latest_ts, tz=timezone.utc).isoformat(),
            "last_event_age_sec": round(age, 1),
            "max_id": global_max_id,
            "stale_threshold_sec": _STALE_THRESHOLD_SEC,
        }
    except Exception as e:
        return {
            "connected": False, "source": "massive",
            "last_event_at": None, "last_event_age_sec": None,
            "last_error": f"FlowDB status query failed: {e}",
        }


# How recent the most-recent FlowDB row must be for the worker to be
# considered "live". Massive sends thousands of events per minute during
# market hours, so a 2-minute gap is a strong signal something is wrong.
# Outside market hours legitimate gaps occur; the indicator will show
# IDLE which is accurate.
_STALE_THRESHOLD_SEC = 120


# --- Backward-compatible shims for pre-consolidation frontend --------------
# Added 2026-07-05 during pre-market debug of 404s on /status and /curated.
#
# Before the /recent consolidation these two paths were independent endpoints.
# The refactor absorbed /status into /recent's response envelope ({status,
# alerts}) and turned /curated into a `?curated=true` query param on /recent.
# Cleaner server-side, but the frontend was never migrated -- OptionsFlow.jsx,
# OptionsFlow_admin.jsx, and LiveFlowMassive.jsx still call the old paths,
# which now fall through to the SPA catch-all and return the React 404 page.
#
# These shims restore the pre-consolidation contract without changing the
# frontend. Both delegate to the same underlying logic /recent uses, so there
# is no risk of divergence and no double-maintenance -- when the frontend is
# eventually updated to read status from /recent's envelope and pass
# ?curated=true directly, these can be deleted with no other change.
@router.get("/status")
def status_shim():
    """
    Backward-compat: worker status dict, matches pre-consolidation contract.
    New frontend code should read `status` from GET /recent's response instead.
    """
    return _get_worker_status()


@router.get("/curated")
def curated_shim(
    limit: int = Query(default=200, ge=1, le=20000),
    min_grade: str = Query(default="D", description="Min letter grade A+/A/B/C/D"),
    target_date: str = Query(default=None, description="M/D/YYYY override (default=today)"),
    sort_by: str = Query(default="recent", description="recent|conviction|premium"),
    tier: str = Query(default=None, description="Filter to one tier"),
):
    """
    Backward-compat: equivalent to GET /recent?curated=true.
    New frontend code should call GET /recent?curated=true directly.
    """
    return recent_massive_alerts(
        limit=limit,
        min_grade=min_grade,
        target_date=target_date,
        sort_by=sort_by,
        tier=tier,
        curated=True,
    )


# ─── /recent result cache (2026-07-09) ──────────────────────────────────────
# _row_to_alert over the (now wide) scan is CPU-heavy (~1-2s); at ~200 users
# polling, an uncached /recent would pin the anyio threadpool = the 524 outage
# class. The snapshot only needs to be seconds-fresh — the SSE stream
# (massive_stream) delivers new prints live on top of it, so a short snapshot
# cache is invisible to users. Single-flight + serve-stale: a fresh entry
# returns instantly; a STALE entry is served immediately while ONE request
# refreshes in the background (never blocks); only the very first fill (empty
# cache) blocks — and warm-on-boot (main.py) does that fill before users arrive.
_recent_cache: dict = {}          # key -> (computed_at_unix, payload)
_recent_cache_locks: dict = {}    # key -> threading.Lock
_recent_cache_guard = threading.Lock()
_RECENT_CACHE_TTL = float(os.environ.get("MASSIVE_RECENT_CACHE_TTL", "15"))
# Global cap on CONCURRENT heavy /recent computes. Single-flight caps one fill
# per KEY, but a burst of distinct cold keys (many users with different params
# right after a flow-worker restart) could otherwise spawn N unbounded daemon
# threads each running an 80K-row curated scan and starve the WS writer. This
# bounds the herd; excess fills queue (off the request path — the request still
# gets an instant warming stub).
_recent_fill_sem = threading.Semaphore(
    int(os.environ.get("MASSIVE_RECENT_FILL_CONCURRENCY", "2")))


def _recent_lock_for(key):
    with _recent_cache_guard:
        lk = _recent_cache_locks.get(key)
        if lk is None:
            lk = threading.Lock()
            _recent_cache_locks[key] = lk
        return lk


def _warming_stub(today: str) -> dict:
    """Fast, non-blocking response for a COLD /recent cache key. Real worker
    status + an empty alert list + warming=True. The page shows a 'loading'
    state and keeps polling; a single-flight background fill (below) populates
    the cache within one cycle. This is what turns the first curated scan after
    a flow-worker (re)start / new-day rollover from a 10-120s HANG into an
    instant paint — the proxied flow-worker's _recent_cache starts cold and is
    otherwise only filled by the first (blocked) user request."""
    st = _get_worker_status()
    st["warming"] = True
    st["query_date"] = today
    return {"status": st, "alerts": [], "warming": True}


def _compute_and_store(ck, today, limit, min_grade, sort_by, tier, curated):
    """Heavy compute → cache store, bounded by the global fill semaphore so at
    most MASSIVE_RECENT_FILL_CONCURRENCY curated scans run at once."""
    with _recent_fill_sem:
        payload = _compute_recent(today, limit, min_grade, sort_by, tier, curated)
        _recent_cache[ck] = (time.time(), payload)
    return payload


def _spawn_recent_fill(ck, today, limit, min_grade, sort_by, tier, curated, lock):
    """Fill OFF the request path, then release the single-flight `lock`. The
    caller MUST have already acquired `lock` non-blocking. Guarantees no user
    request ever blocks on the heavy scan (single-flight preserved: only the
    lock holder fills). If the thread can't even START, the lock is released
    here so the key can never be permanently wedged (all future requests would
    otherwise get the warming stub / stale forever)."""
    def _run():
        try:
            _compute_and_store(ck, today, limit, min_grade, sort_by, tier, curated)
        except Exception:
            logging.getLogger(__name__).exception("[massive] background /recent fill failed")
        finally:
            try:
                lock.release()
            except Exception:
                pass
    try:
        threading.Thread(target=_run, daemon=True, name="massive-recent-fill").start()
    except Exception:
        try:
            lock.release()
        except Exception:
            pass
        logging.getLogger(__name__).exception("[massive] could not spawn /recent fill thread")


def warm_recent(*, limit, min_grade, sort_by, tier, curated, target_date=None):
    """Synchronously fill a /recent key, PARTICIPATING in the per-key single-flight
    lock so the warmer never double-computes a key a request-path fill is already
    building (that would run two 80K scans at once and hammer the WS writer).
    Skips (returns n=None) when a fill already holds the key's lock — that fill
    will populate the cache. Bounded by the global fill semaphore. Used by the
    boot / flow-worker warmers (recent_massive_alerts() itself no longer blocks —
    it returns a warming stub on a cold key — so warmers must call THIS).
    Returns (cache_key, n_alerts | None)."""
    today = target_date or _today_mdyyyy()
    ck = (today, limit, min_grade, sort_by, tier, curated)
    lock = _recent_lock_for(ck)
    if not lock.acquire(blocking=False):
        return ck, None  # a request-path fill is already computing this key
    try:
        payload = _compute_and_store(ck, today, limit, min_grade, sort_by, tier, curated)
        return ck, len(payload.get("alerts") or [])
    finally:
        lock.release()


@router.get("/recent")
def recent_massive_alerts(
    limit: int = Query(default=200, ge=1, le=20000),
    min_grade: str = Query(default="D", description="Min letter grade A+/A/B/C/D"),
    target_date: str = Query(default=None, description="M/D/YYYY override (default=today)"),
    sort_by: str = Query(default="recent", description="recent|conviction|premium"),
    tier: str = Query(default=None, description="Filter to one tier (alpha|size|bullish|bearish|leaps|unusual|algo). When set, common-tier alerts can't crowd out rare-tier ones — useful for 'show me all the day's Alpha Golds' even hours after they fired."),
    curated: bool = Query(default=False, description="Apply Curated-mode stacking filter: tiers like Size/Alpha need ≥N stacked signals (premium/V-OI/hits/grade), Unusual needs its own dedicated criteria, Algo always excluded. Thresholds are tunable via /thresholds endpoint."),
):
    """
    Return recent MAGENTA + YELLOW rows from FlowDB as alert objects shaped
    to match the existing /api/live/alerts/recent response (so LiveFlow.jsx
    can consume it with just a URL swap).

    Query params:
      limit:       max rows to return (1-1000, default 200)
      min_grade:   filter out rows below this letter grade (A+/A/B/C/D)
      target_date: override date for testing (default = today in ET)
      sort_by:     'recent' (default, id DESC) | 'conviction' | 'premium'
      tier:        if set, only return alerts of this tier. Lets the page
                   show full-day history of rare tiers (Alpha Gold, Size)
                   without being pushed out by common tiers like Algo.
    """
    today = _resolve_date(target_date)   # ISO YYYY-MM-DD → M/D/YYYY (else zero-rows)

    # Piggyback on the frontend's 5s polling cadence to auto-record any
    # worker restart. Cheap O(1) module-cache check when nothing changed;
    # single INSERT + cache-update when a restart is detected. See
    # /restart-log endpoint below for the read side.
    _log_startup_if_new()

    # Snapshot cache (single-flight + serve-stale) — see _recent_cache above.
    # NEVER block a user request on the heavy scan:
    #   • fresh entry            → return instantly
    #   • stale entry            → serve it NOW, refresh in ONE background thread
    #   • cold key (nothing yet) → return a fast "warming" stub, fill in background
    # Before 2026-07-20 the cold path did `lock.acquire(blocking=True)` and hung
    # the FIRST caller per key for the full 10-120s curated scan — the "1-2 min
    # to load on login" symptom, made chronic because the proxied flow-worker's
    # cache is never boot-warmed (only the web service warms, and reads proxy to
    # the worker). A background warmer (flow_worker_main) now keeps these keys
    # hot; this stub covers the brief window before the first fill lands.
    ck = (today, limit, min_grade, sort_by, tier, curated)
    is_today = (today == _today_mdyyyy())
    now = time.time()
    hit = _recent_cache.get(ck)
    # Today: 15s TTL (kept hot by the warmer, live tape). Historical: a long
    # BOUNDED TTL (6h) — NOT never-expire, so the T+1 backfill/gap-fill that
    # mutates a past date is eventually picked up.
    _fresh_ttl = _RECENT_CACHE_TTL if is_today else _HISTORICAL_TTL
    if hit is not None and now - hit[0] < _fresh_ttl:
        return hit[1]
    lock = _recent_lock_for(ck)
    if not is_today:
        # HISTORICAL date: NOT the live tape. Compute SYNCHRONOUSLY (block once,
        # this key only) and cache with the bounded historical TTL — never return
        # a warming stub. The stub made past dates in the DateRail show an empty
        # tape: the 15s TTL expired between the frontend's 20-30s polls, so a
        # non-warmed historical key was cold on EVERY poll and never filled.
        # (Auto-push stays inert on historical: _compute_recent passes live=False.)
        with lock:
            h2 = _recent_cache.get(ck)
            if h2 is not None:
                return h2[1]
            payload = _compute_recent(today, limit, min_grade, sort_by, tier, curated)
            _recent_cache[ck] = (time.time(), payload)
            return payload
    if hit is not None:
        # TODAY, stale — serve it immediately; kick a background refresh if
        # nobody else already holds the single-flight lock.
        if lock.acquire(blocking=False):
            _spawn_recent_fill(ck, today, limit, min_grade, sort_by, tier, curated, lock)
        return hit[1]
    # TODAY, cold — return a warming stub now; fill in the background.
    if lock.acquire(blocking=False):
        _spawn_recent_fill(ck, today, limit, min_grade, sort_by, tier, curated, lock)
    return _warming_stub(today)


def _compute_recent(today, limit, min_grade, sort_by, tier, curated):
    """Heavy scan + classify for /recent, split out so the endpoint can cache
    the result. All params already resolved (today = concrete M/D/YYYY)."""
    grade_threshold = {"A+ 🚀": 4, "A": 3, "B": 2, "C": 1, "D": 0,
                       "A+": 4}  # accept both with and without rocket
    min_threshold = grade_threshold.get(min_grade, 0)

    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        # When sorting by something other than recency we need to consider
        # ALL the day's rows. id DESC is fine for limit*3 cushion for recent;
        # for conviction/premium we pull more upfront. When a tier filter is
        # active we also pull 20000 since the tier might be rare — limit*3
        # won't have enough of that tier to satisfy `limit` post-filter.
        # 7/8: curated needs the whole day, not just recent tail. Curation
        # has cross-alert dependencies — contract_totals for rollup rescue,
        # hit_counts for the confirmer signal — that produce wrong answers
        # when computed over a slice. 100K covers heaviest observed days
        # (7/8 had 161K raw rows). This is a reapplication of an earlier
        # 7/8 fix that got reverted during a subsequent deploy.
        if curated:
            sql_limit = 100_000
        elif sort_by != "recent" or tier:
            sql_limit = max(20_000, limit + 1000)
        else:
            sql_limit = max(limit * 3, limit + 1000)  # safety margin for grade filter
        # HARD CAP (2026-07-09): finding the latest N classified rows among the
        # day's ~400K mostly-WHITE rows scans O(N) matching rows; at midday N>~2000
        # timed out /recent (30s+) and broke the whole page ("1 of 1" + stuck
        # market-read). Cap the scan — with SSE streaming the snapshot only needs
        # recent history, new prints arrive live. Env-tunable; proper fix = a
        # Color-aware index (after-close).
        # Mode-aware cap (2026-07-09): the default recent tape stays instant
        # (3000). But tier-isolation and curated are deliberate "show me ALL the
        # day's Alpha Golds / stacked contracts" queries where FULL-DAY coverage
        # matters more than sub-second speed — a 3000 cap made tier=alpha return 0
        # (the day's rare-tier prints fired earlier + fell outside the window).
        # The Color index keeps even a full-day scan reasonable. Env-tunable.
        # (Permanent instant-everywhere fix = store tier/grade as SQL columns at
        # write time so these filter in SQL; after-close, Ravi-area.)
        if curated or tier:
            # OVERRIDE up to full-day coverage (not min — tier's base sql_limit is
            # only 20000 = recent ~half-day, so min() left the morning's rare-tier
            # prints out of range and tier=alpha returned 0). Set it wide; the
            # Color index keeps the full-day scan fast (~2-3s).
            sql_limit = int(os.environ.get("MASSIVE_RECENT_SQL_CAP_WIDE", "80000"))
        else:
            # 2026-07-09 (Ravi flagged "missing flow"): the default ALL FLOW tape
            # is the raw firehose — users expect the whole day's classified prints,
            # not a thin recent slice. A 3000 cap left ~90% of the day's flow hidden
            # (only ~220 of thousands shown). Raised to 20000 (limit*3 = 30000 at the
            # "All" = 10000 frontend value is capped here) → ~1400 prints, the full
            # working tape. The _row_to_alert pass over 20K rows is ~1.5s, but the
            # /recent result cache (single-flight, above) means users hit that cost at
            # most once per TTL window — the SSE stream keeps the tape live between
            # snapshots. Env-tunable.
            sql_limit = min(sql_limit, int(os.environ.get("MASSIVE_RECENT_SQL_CAP", "20000")))
        # Pull MAGENTA + YELLOW always. Also pull WHITE rows above the premium
        # override threshold so they get a chance at promotion in
        # _derive_alert_name. SQL filter avoids loading every WHITE row (huge
        # volume). Floor the WHITE pull at premium_override.min_premium: WHITE
        # rows only promote (surface) at premium >= min_premium — below that
        # _row_to_alert always drops them, so fetching WHITE 500K-1M was pure
        # waste (materialized then discarded). Derive from the config so the SQL
        # floor can't drift from the promotion threshold (was hardcoded 500_000).
        override_cfg = _load_thresholds().get("premium_override", {})
        override_sql_floor = int(override_cfg.get("min_premium", 1_000_000))
        # 7/7: source clause is conditional on the etf_enabled admin threshold.
        # When enabled, both 'stocks' and 'indexes' rows flow through so the
        # frontend's Stocks/ETFs toggle can partition them. When disabled
        # (default, today's behavior), only 'stocks' — indexes stay excluded
        # 7/7: source clause is conditional on the etf_enabled admin threshold.
        # When enabled, both 'stocks' and 'indexes' rows flow through so the
        # frontend's Stocks/ETFs toggle can partition them. When disabled
        # (default), only 'stocks' — indexes stay excluded per the 6/26
        # aggregation-boundary concern documented at file top.
        etf_enabled = _load_thresholds().get("etf_enabled", False)
        if etf_enabled:
            source_clause = "source IN ('stocks','indexes')"
        else:
            source_clause = "source = 'stocks'"
        cur = conn.execute(f"""
            SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                   Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate,
                   Color, Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI
              FROM flow
             WHERE {source_clause}
               AND CreatedDate = ?
               AND (Color IN ('MAGENTA', 'YELLOW')
                    OR (Color = 'WHITE' AND CAST(Premium AS INTEGER) >= ?))
             ORDER BY id DESC
             LIMIT ?
        """, (today, override_sql_floor, sql_limit))
        rows = cur.fetchall()
    finally:
        conn.close()

    # Translate all rows first (drop unclassified + low-grade + off-tier),
    # then sort + trim. Tier filter applied here (not in SQL) because the
    # tier is derived in _row_to_alert based on premium/side/dte/color logic
    # that's easier in Python than translating into SQL conditions.
    all_alerts = []
    skipped_unclassified = 0
    skipped_low_grade = 0
    skipped_off_tier = 0
    for r in rows:
        a = _row_to_alert(dict(r))
        if a is None:
            skipped_unclassified += 1
            continue
        if grade_threshold.get(a["grade"], 0) < min_threshold:
            skipped_low_grade += 1
            continue
        if tier and a.get("_tierKey") != tier:
            skipped_off_tier += 1
            continue
        all_alerts.append(a)

    if sort_by == "conviction":
        all_alerts.sort(key=lambda a: a["convictionScore"], reverse=True)
    elif sort_by == "premium":
        all_alerts.sort(key=lambda a: a["alertPremium"], reverse=True)
    # "recent" already in id DESC order from SQL

    # ─── Hit count per contract ─────────────────────────────────────────────
    # Count how many times each contract (ticker|cp|strike|exp) fires across
    # the day's classified alerts. Used both for the ×N hit badge in the UI
    # and for the Curated-mode stacking criterion. Computed over the WHOLE
    # classified set (post-grade-filter, pre-limit) so the hit count reflects
    # the true day's activity, not just what made the visible window.
    hit_counts = {}
    for a in all_alerts:
        k = f"{a.get('ticker')}|{a.get('cp')}|{a.get('strike')}|{a.get('exp')}"
        hit_counts[k] = hit_counts.get(k, 0) + 1
    for a in all_alerts:
        k = f"{a.get('ticker')}|{a.get('cp')}|{a.get('strike')}|{a.get('exp')}"
        a["_hitCount"] = hit_counts.get(k, 1)

    # ─── Curated filter ─────────────────────────────────────────────────────
    # When ?curated=true, apply the stacking + Unusual logic. Algo always
    # excluded. Filter happens AFTER hit-count computation so hits is one
    # of the stacking signals.
    skipped_curated = 0
    if curated:
        thresholds = _load_thresholds()
        # 7/7: precompute per-contract daily premium totals across ALL uncurated
        # alerts. Passed into _qualifies_curated so alerts whose individual
        # premium fails the tier floor can be rescued when the contract's
        # aggregated total clears it. Fixes NFLX-shape aggregation splitting.
        contract_totals: dict[str, float] = {}
        for a in all_alerts:
            k = (f"{a.get('ticker','')}|{a.get('cp','')}|"
                 f"{a.get('strike','')}|{a.get('exp','')}")
            contract_totals[k] = contract_totals.get(k, 0) + (a.get("alertPremium") or 0)
        kept = []
        for a in all_alerts:
            if _qualifies_curated(a, thresholds, contract_totals=contract_totals):
                kept.append(a)
            else:
                skipped_curated += 1
        all_alerts = kept

        # Net-flow demote: two-way contracts (MU-style ~54/46) -> neutral "UCT
        # Size", so the feed stops mislabeling them Bull/Bear. See the helper.
        _demote_two_way_flow(all_alerts)

        # ─── Contract-level dedupe (added 2026-07-05) ────────────────────
        # In curated mode, collapse multiple alerts on the same contract
        # (ticker + cp + strike + exp) to a single representative row. Fixes
        # the "Alpha Gold fired 20 times on same CSCO $80c" symptom where
        # each raw print became its own alert badge.
        #
        # Representative selection: highest-premium row wins (keeps its
        # timestamp, side, type). Premium and volume aggregate across the
        # group so downstream displays show the contract-level total.
        # _hitCount was already set to the true group size in the earlier
        # pass so the ×N badge still reflects raw activity.
        #
        # Only in curated mode — All Flow stays raw firehose for tape
        # scanning where every print matters.
        by_contract: dict = {}
        for a in all_alerts:
            k = f"{a.get('ticker')}|{a.get('cp')}|{a.get('strike')}|{a.get('exp')}"
            entry = by_contract.get(k)
            if entry is None:
                by_contract[k] = {
                    "rep": a,
                    "premium_sum": a.get("alertPremium") or 0,
                    "volume_sum": a.get("tradeSize") or 0,
                }
            else:
                entry["premium_sum"] += a.get("alertPremium") or 0
                entry["volume_sum"] += a.get("tradeSize") or 0
                # Promote to new representative if higher premium
                if (a.get("alertPremium") or 0) > (entry["rep"].get("alertPremium") or 0):
                    entry["rep"] = a
        deduped = []
        for k, entry in by_contract.items():
            rep = dict(entry["rep"])  # shallow copy so we don't mutate original
            rep["alertPremium"] = entry["premium_sum"]
            rep["tradeSize"] = entry["volume_sum"]
            deduped.append(rep)
        # Preserve prior sort order (conviction / premium / recent) on deduped set
        if sort_by == "conviction":
            deduped.sort(key=lambda a: a.get("convictionScore") or 0, reverse=True)
        elif sort_by == "premium":
            deduped.sort(key=lambda a: a.get("alertPremium") or 0, reverse=True)
        else:  # recent — use timestamp
            deduped.sort(key=lambda a: a.get("timestamp") or 0, reverse=True)
        all_alerts = deduped

    # Auto-push scan: mark already-pushed alerts (POSTED persists) and, when the
    # master switch is on, claim + fire newly-qualifying ones. On the FULL set so
    # no client's tier/limit filter hides a qualifier; dedup via the log.
    # live=... so browsing a historical date MARKS ONLY and never fires (see
    # _apply_auto_push docstring).
    _apply_auto_push(all_alerts, live=(today == _today_mdyyyy()))

    alerts = all_alerts[:limit]

    status = _get_worker_status()
    status["query_date"] = today
    status["sort_by"] = sort_by
    status["tier_filter"] = tier
    status["curated"] = curated
    status["rows_scanned"] = len(rows)
    status["skipped_unclassified_side"] = skipped_unclassified
    status["skipped_below_min_grade"] = skipped_low_grade
    status["skipped_off_tier"] = skipped_off_tier
    status["skipped_curated"] = skipped_curated
    status["returned"] = len(alerts)

    return {
        "status": status,
        "alerts": alerts,
    }


_diagnostic_cache: dict = {}          # date -> (ts, payload)
_DIAGNOSTIC_TTL = 30
_diagnostic_lock = threading.Lock()   # single-flight: one heavy scan at a time


@router.get("/diagnostic")
def diagnostic(target_date: str = Query(default=None)):
    """Per-tier counts for the target date — useful for tuning thresholds.
    Cached (single-flight): today TTL 30s + kept hot by the flow-worker warmer;
    historical dates cached immutably. Was an UNCACHED full-day scan (18-58s)
    that blocked the single-process event loop on every call (524/502 risk)."""
    today = _resolve_date(target_date)
    ttl = _HISTORICAL_TTL if today != _today_mdyyyy() else _DIAGNOSTIC_TTL
    return _cached_single_flight(
        _diagnostic_cache, today, _diagnostic_lock, ttl,
        lambda: _build_diagnostic(today))


def _build_diagnostic(today):
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute("""
            SELECT * FROM flow
             WHERE source = 'stocks' AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
        """, (today,))
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    tier_counts = {}
    grade_counts = {}
    color_counts = {}
    skipped_unclassified = 0
    for r in rows:
        cp = r["CallPut"]
        side = r["Side"] or ""
        d = _derive_direction(cp, side, r.get("Type", ""))
        if d is None:
            skipped_unclassified += 1
            continue
        a = _row_to_alert(r)
        if a is None:
            continue
        tier_counts[a["_tierKey"]] = tier_counts.get(a["_tierKey"], 0) + 1
        grade_counts[a["grade"]] = grade_counts.get(a["grade"], 0) + 1
        color_counts[r["Color"]] = color_counts.get(r["Color"], 0) + 1

    return {
        "query_date": today,
        "total_rows_yellow_magenta": len(rows),
        "skipped_unclassified_side": skipped_unclassified,
        "after_classification": len(rows) - skipped_unclassified,
        "by_tier": tier_counts,
        "by_grade": grade_counts,
        "by_color": color_counts,
    }


# ─── Current quotes endpoint (for P/L column) ─────────────────────────────
# Frontend polls this every 30s with the unique tickers visible on the page.
# Server uses the same Schwab quote service liveflow_worker uses, with a
# 2-min TTL cache (so two pages polling the same tickers don't double-hit
# Schwab). Returns a dict of ticker → current spot price.

from pydantic import BaseModel

# Reuse liveflow_worker's spot cache — same TTL, same source of truth.
# Avoids duplicate Schwab calls from /live-flow + /live-massive both polling.
_SPOT_CACHE_TTL = 120  # 2 min; matches liveflow_worker
_quote_cache: dict = {}  # ticker → (price, cached_at_unix)


class CurrentQuotesPayload(BaseModel):
    tickers: list[str] = []


async def _fetch_one_quote(ticker: str) -> float | None:
    """Single ticker quote with 2-min cache. Lazy import of schwab_service
    so we don't pull it on cold start when this endpoint isn't used."""
    if not ticker or ticker.startswith("$") or "." in ticker:
        return None
    now = time.time()
    cached = _quote_cache.get(ticker)
    if cached and (now - cached[1]) < _SPOT_CACHE_TTL:
        return cached[0]
    try:
        from api import schwab_service
        price = await schwab_service.get_equity_quote(ticker)
        if price:
            _quote_cache[ticker] = (float(price), now)
            return float(price)
    except Exception:
        # Quote unavailable for this ticker — likely index/unusual symbol or
        # rate-limited. Returning None lets the frontend show "—" in P/L.
        pass
    return None


@router.post("/current-quotes")
async def current_quotes(payload: CurrentQuotesPayload,
                         _auth: dict = Depends(require_flow_user)):
    """
    Batch fetch current spot prices for a list of tickers. Used by the
    frontend to compute P/L from alert spot → current spot. Polls less
    frequently than /recent (spot moves slower than alert flow).

    Body: {"tickers": ["MSFT", "MU", "NVDA", ...]}
    Returns: {"quotes": {"MSFT": 388.50, "MU": 105.20, "NVDA": null}, "fetched_at": <unix>}
    """
    import asyncio
    tickers = list(dict.fromkeys(payload.tickers or []))  # dedup, preserve order
    if not tickers:
        return {"quotes": {}, "fetched_at": time.time()}

    # Cap to avoid abuse / huge bursts. 200 tickers per call is plenty
    # (the live page maxes at 200 alerts which is typically <100 uniques).
    tickers = tickers[:200]

    # Fire all lookups concurrently. Schwab service handles its own rate
    # limiting; cache layer (above) dedupes same-ticker repeats within TTL.
    results = await asyncio.gather(
        *[_fetch_one_quote(t) for t in tickers], return_exceptions=False
    )
    quotes = {t: p for t, p in zip(tickers, results) if p is not None}
    return {"quotes": quotes, "fetched_at": time.time(), "requested": len(tickers)}


# ─── Day stats endpoint (for Market Read hero card) ────────────────────────
# Returns aggregated bull/bear stats for ALL classifiable Y/M rows on the
# target date, independent of any pagination/grade/tier filters. The frontend
# uses this for the hero card so the macro Market Read is stable regardless
# of the user's filter selections (a chip toggle shouldn't change what "the
# market looks like today" — only what THEY are looking at).

_day_stats_cache: dict = {}  # date_key → (computed_at_unix, payload)
_DAY_STATS_TTL = 30  # 30s — fast enough for live, slow enough to skip work
_day_stats_lock = threading.Lock()  # single-flight: bound concurrent heavy recomputes to 1


def _build_day_stats(today: str, exclude_algo: bool = False,
                     stock_etf: str = "all") -> dict:
    """Compute aggregate stats for all Y/M classifiable stocks rows on `today`.
    Heavy SQL + Python pass over potentially 5K-10K rows; cache the result
    via the wrapper endpoint so repeated polls within 30s don't re-process.

    When exclude_algo=True, alerts classified as Algo tier (multi-leg complex
    strategies) are skipped during aggregation. Multi-leg trades aren't truly
    directional even when one leg happens to print at ask, so excluding them
    gives a cleaner "directional conviction only" read.
    """
    # Include WHITE rows that could pass premium override in _row_to_alert,
    # mirroring the same visibility rule /recent uses (line 1360-1378). Without
    # this, on days where the classifier didn't lift anything to MAGENTA/YELLOW
    # (e.g. 7/2 backfill where every row landed WHITE because OI=0 at write
    # time), the alert list shows N alerts via premium override but this card
    # reports "0 alerts" — a visibility mismatch that misrepresents the day.
    #
    # Absolute SQL floor of $500K is conservative; the actual premium_override
    # threshold gate lives in _derive_alert_name and is stricter. Loading a few
    # extra WHITE rows here that get dropped in _row_to_alert costs microseconds
    # per row and keeps the two code paths visually consistent.
    override_sql_floor = 500_000
    # 7/7: same conditional source clause as /recent so bull/bear card counts
    # stay consistent with the alert stream when ETFs are enabled.
    # 7/9: also honor the Stocks/ETFs/All partition (stock_etf) so the Market
    # Read matches the row feed, which splits client-side on the source column
    # (source=='indexes' → ETFs/indexes; else stocks). We narrow WITHIN the etf
    # gate, so "ETFs" while the indexes pipeline is disabled yields nothing —
    # exactly what the feed would show. `sources` holds only code-controlled
    # literals ('stocks'/'indexes'), so interpolating them is injection-safe.
    etf_enabled = _load_thresholds().get("etf_enabled", False)
    base_sources = ["stocks", "indexes"] if etf_enabled else ["stocks"]
    if stock_etf == "stocks":
        sources = [s for s in base_sources if s == "stocks"]
    elif stock_etf == "etfs":
        sources = [s for s in base_sources if s == "indexes"]
    else:
        sources = base_sources

    rows = []
    if sources:
        cap = int(os.environ.get("MASSIVE_DAYSTATS_CAP", "20000"))
        select_cols = (
            "SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume, "
            "Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate, "
            "Color, Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI"
        )
        color_gate = ("(Color IN ('MAGENTA', 'YELLOW') "
                      "OR (Color = 'WHITE' AND CAST(Premium AS INTEGER) >= ?))")
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            conn.row_factory = sqlite3.Row
            if len(sources) == 1:
                cur = conn.execute(
                    f"{select_cols} FROM flow "
                    f"WHERE source = ? AND CreatedDate = ? AND {color_gate} "
                    f"ORDER BY id DESC LIMIT ?",
                    (sources[0], today, override_sql_floor, cap),
                )
            else:
                # 'all' = a TRUE UNION of the partitions: cap PER SOURCE and union,
                # not "latest N of the merged pool". The old merged-pool LIMIT dropped
                # the morning on heavy days (>cap combined color-gate rows) and made
                # All < Stocks -- 7/9: stocks classified 2137 vs all 1685, undercounting
                # the day by ~$86M bull. Per-source cap keeps each partition's full day,
                # so All == Stocks u ETFs by construction. Each source stays under the
                # cap, so it's the same per-source work, just no longer truncated.
                subqueries, params = [], []
                for s in sources:
                    subqueries.append(
                        f"SELECT * FROM ({select_cols} FROM flow "
                        f"WHERE source = ? AND CreatedDate = ? AND {color_gate} "
                        f"ORDER BY id DESC LIMIT ?)"
                    )
                    params.extend([s, today, override_sql_floor, cap])
                cur = conn.execute(" UNION ALL ".join(subqueries), params)
            # CAP (2026-07-09; per-source since 2026-07-10): _row_to_alert over an
            # unbounded row set timed out (30s+) at midday, so we cap. Applied PER
            # SOURCE so the ALL view is a real union of full-day partitions instead of
            # a truncated latest-N of the merged pool. Sync endpoint (threadpool) +
            # 30s cache absorbs the pass. Env-tunable via MASSIVE_DAYSTATS_CAP.
            rows = cur.fetchall()
        finally:
            conn.close()

    # Translate each row to an alert (includes direction + dte + ticker)
    classified = []
    for r in rows:
        a = _row_to_alert(dict(r))
        if a is not None:
            classified.append(a)

    # Aggregate everything in one pass
    bull_prem = 0
    bear_prem = 0
    bull_count = 0
    bear_count = 0
    by_ticker = {}              # ticker → {bull, bear}
    dte_buckets = {
        "0-7":   {"label": "0-7d",   "bull": 0, "bear": 0, "count": 0},
        "7-14":  {"label": "7-14d",  "bull": 0, "bear": 0, "count": 0},
        "14-60": {"label": "14-60d", "bull": 0, "bear": 0, "count": 0},
        "60+":   {"label": "60+d",   "bull": 0, "bear": 0, "count": 0},
    }

    # Last-hour window resolution differs by mode:
    #   • If target_date == today (ET): rolling 60 min ending NOW (real-time)
    #   • If target_date is historical: last hour of trading activity on that
    #     date (max(timestamp) - 3600). Otherwise historical pages always
    #     show "no alerts in last 60 minutes" which is useless.
    now_et = datetime.now(ET)
    try:
        m, d, y = today.split("/")
        target_date_obj = datetime(int(y), int(m), int(d)).date()
    except (ValueError, AttributeError):
        target_date_obj = None
    is_today = (target_date_obj == now_et.date()) if target_date_obj else False

    if is_today:
        one_hour_threshold = time.time() - 3600
    elif classified:
        max_ts = max((a["timestamp"] for a in classified if a.get("timestamp")), default=0)
        one_hour_threshold = max_ts - 3600 if max_ts > 0 else 0
    else:
        one_hour_threshold = 0

    bull_prem_1h = 0
    bear_prem_1h = 0
    count_1h = 0
    by_ticker_1h: dict = {}  # ticker → {bull, bear} restricted to last-hour window

    # Net-flow demote (2026-07-21): keep two-way contracts (MU-style ~54/46) OUT
    # of the Market Read bull/bear totals — same demote as the feed, so a churned
    # contract can't skew the macro read. Mutates _direction→None; the loop below
    # already skips None.
    _demote_two_way_flow(classified)

    for a in classified:
        # Skip multi-leg/Algo alerts when caller requested directional-only.
        if exclude_algo and a.get("_tierKey") == "algo":
            continue
        prem = a["alertPremium"] or 0
        direction = a.get("_direction")
        is_bull = direction == "Bull"
        is_bear = direction == "Bear"
        if not (is_bull or is_bear):
            continue

        if is_bull:
            bull_prem += prem
            bull_count += 1
        else:
            bear_prem += prem
            bear_count += 1

        # Last hour
        ts = a.get("timestamp") or 0
        if one_hour_threshold > 0 and ts >= one_hour_threshold:
            count_1h += 1
            if is_bull:
                bull_prem_1h += prem
            else:
                bear_prem_1h += prem
            # Per-ticker rollup restricted to last-hour window
            t1h = a.get("ticker")
            if t1h:
                if t1h not in by_ticker_1h:
                    by_ticker_1h[t1h] = {"bull": 0, "bear": 0}
                if is_bull:
                    by_ticker_1h[t1h]["bull"] += prem
                else:
                    by_ticker_1h[t1h]["bear"] += prem

        # Per-ticker rollup
        t = a.get("ticker")
        if t:
            if t not in by_ticker:
                by_ticker[t] = {"bull": 0, "bear": 0}
            if is_bull:
                by_ticker[t]["bull"] += prem
            else:
                by_ticker[t]["bear"] += prem

        # DTE bucket
        dte = a.get("dte") if a.get("dte") is not None else 999
        if dte <= 7:
            bucket = "0-7"
        elif dte <= 14:
            bucket = "7-14"
        elif dte <= 60:
            bucket = "14-60"
        else:
            bucket = "60+"
        if is_bull:
            dte_buckets[bucket]["bull"] += prem
        else:
            dte_buckets[bucket]["bear"] += prem
        dte_buckets[bucket]["count"] += 1

    # Top tickers by direction (top 10 each; frontend uses 3 for inline
    # summary and up to 10 for click-to-expand drilldown)
    top_bull = sorted(
        [{"ticker": t, "premium": v["bull"]} for t, v in by_ticker.items() if v["bull"] > 0],
        key=lambda x: x["premium"], reverse=True,
    )[:10]
    top_bear = sorted(
        [{"ticker": t, "premium": v["bear"]} for t, v in by_ticker.items() if v["bear"] > 0],
        key=lambda x: x["premium"], reverse=True,
    )[:10]

    # Top tickers active in the last-hour window (combined premium, max 5).
    # Each entry carries bull/bear split so the frontend can color the amount
    # by which side dominated for that ticker in that hour.
    top_tickers_1h = []
    for t, v in by_ticker_1h.items():
        total = v["bull"] + v["bear"]
        if total <= 0:
            continue
        top_tickers_1h.append({
            "ticker": t,
            "total": total,
            "bull": v["bull"],
            "bear": v["bear"],
            "lean": "bull" if v["bull"] > v["bear"] else
                    "bear" if v["bear"] > v["bull"] else "flat",
        })
    top_tickers_1h.sort(key=lambda x: x["total"], reverse=True)
    top_tickers_1h = top_tickers_1h[:5]

    return {
        "query_date": today,
        "total_classified": len(classified),
        "bull_premium": bull_prem,
        "bear_premium": bear_prem,
        "bull_count": bull_count,
        "bear_count": bear_count,
        "by_dte": list(dte_buckets.values()),  # ordered list for stable frontend rendering
        "top_bull": top_bull,
        "top_bear": top_bear,
        "last_hour": {
            "bull_premium": bull_prem_1h,
            "bear_premium": bear_prem_1h,
            "count": count_1h,
            "is_today_target": is_today,
            "top_tickers": top_tickers_1h,
        },
    }


@router.get("/day-stats")
def day_stats(
    target_date: str = Query(default=None),
    exclude_algo: bool = Query(default=False, description="Exclude multi-leg/Algo tier from the bull/bear/DTE/top-tickers aggregation. Useful for a 'pure directional' read since multi-leg trades aren't truly directional even when one leg prints at ask."),
    stock_etf: str = Query(default="all", description="Partition the Market Read to match the row feed's Stocks/ETFs/All toggle. 'stocks' = source='stocks' only; 'etfs' = source='indexes' only; 'all' = both (subject to the etf_enabled gate)."),
):
    """
    Aggregated bull/bear stats for ALL classifiable Y/M rows on the target
    date, within the requested Stocks/ETFs/All partition. Independent of the
    tier/min-grade/row-limit filters — gives the page's Market Read a stable
    macro view — but DOES honor the Stocks/ETFs toggle so the card and the
    feed agree on which universe they're describing.

    Cached for 30s server-side per (date, exclude_algo, stock_etf). Historical
    dates never change so cache hit rate is near-100% after first request.

    When exclude_algo=true, the Algo tier (multi-leg complex strategies) is
    skipped during aggregation. Single-leg directional alerts only.
    """
    today = _resolve_date(target_date)   # ISO YYYY-MM-DD → M/D/YYYY (else zero-rows)
    now = time.time()
    if stock_etf not in ("stocks", "etfs", "all"):
        stock_etf = "all"
    cache_key = (today, bool(exclude_algo), stock_etf)
    cached = _day_stats_cache.get(cache_key)
    if cached and (now - cached[0]) < _DAY_STATS_TTL:
        return cached[1]
    # Single-flight + stale-serve. Only ONE heavy recompute runs at a time; a
    # concurrent request holding a stale value gets it instantly instead of
    # launching a second 30s+ pass. Those parallel passes are what piled up in
    # the threadpool and starved /recent (feed lag). Staleness is bounded to one
    # refresh — identical to what the 30s cache already allowed.
    if not _day_stats_lock.acquire(blocking=False):
        if cached:
            return cached[1]                      # serve stale, don't queue behind the compute
        with _day_stats_lock:                     # first-ever for this key: must compute once
            c2 = _day_stats_cache.get(cache_key)
            if c2 and (time.time() - c2[0]) < _DAY_STATS_TTL:
                return c2[1]
            payload = _build_day_stats(today, exclude_algo=exclude_algo, stock_etf=stock_etf)
            _day_stats_cache[cache_key] = (time.time(), payload)
            return payload
    try:
        payload = _build_day_stats(today, exclude_algo=exclude_algo, stock_etf=stock_etf)
        _day_stats_cache[cache_key] = (time.time(), payload)
        return payload
    finally:
        _day_stats_lock.release()


# ─── By-Contract rollup (accumulation view) ───────────────────────────────
# Groups the day's flow into one row per contract (ticker+cp+strike+exp).
# Purpose: surface REPETITION (Ravi rule #1) — a contract hit many times is
# conviction that the flat print-tape structurally hides. Gate is cap-scaled
# so a $250K print on a megacap and a $25K print on a $14 name are judged on
# their own scale; META's 41-print 620C churn doesn't qualify, ACI's stack does.
_by_contract_cache: dict = {}          # (date, stock_etf, min_hits, excl_algo) -> (ts, payload)
_BY_CONTRACT_TTL = 30
_by_contract_lock = threading.Lock()  # single-flight: bound concurrent heavy recomputes to 1

# Per-print NOISE floor by cap band — a print must clear this to count as a
# "hit". Deliberately LOW (it only rejects dust): repetition of small clips on
# a small name IS the signal (ACI: 13x $10-40K on a $14 stock). Mega stays high
# so megacap churn (META: 41x ~$70K) doesn't rack up hits. Tunable via
# thresholds['rollup_min_print']. ETFs are mega-scale → mega floor.
def _rollup_floor(mkt_cap, source, thresholds) -> int:
    defaults = {"mid_small": 15_000, "large": 25_000, "mega": 250_000}
    floors = thresholds.get("rollup_min_print", {}) or {}
    if source == "indexes":
        return int(floors.get("mega", defaults["mega"]))
    band = _cap_band_key(mkt_cap, thresholds.get("cap_bands", {}))
    return int(floors.get(band, defaults[band]))


# Contract-TOTAL floor by cap band — the sum of all the contract's prints must
# clear this for the contract to be worth surfacing. This is where cap-scaling
# does its real work: a mega name must total big to matter (silences churn that
# survives the hit gate), while a small name qualifies on a modest aggregate.
# Tunable via thresholds['rollup_min_total'].
def _rollup_total_floor(mkt_cap, source, thresholds) -> int:
    defaults = {"mid_small": 100_000, "large": 250_000, "mega": 1_000_000}
    floors = thresholds.get("rollup_min_total", {}) or {}
    if source == "indexes":
        return int(floors.get("mega", defaults["mega"]))
    band = _cap_band_key(mkt_cap, thresholds.get("cap_bands", {}))
    return int(floors.get(band, defaults[band]))


_ROLLUP_GRADE_RANK = {"A+ 🚀": 5, "A+": 4, "A": 3, "B": 2, "C": 1, "D": 0}
def _best_grade(grades):
    best, best_r = None, -1
    for g in grades:
        r = _ROLLUP_GRADE_RANK.get(g, _ROLLUP_GRADE_RANK.get((g or "").strip(), 0))
        if r > best_r:
            best_r, best = r, g
    return best


def _accumulation_grade(*, total_premium, qualifying_hits, swift_hits,
                        burst_rising, shape, sided_pct, cum_voi):
    """Grade the ACCUMULATION PATTERN, not the best single print. A slow
    institutional build is sliced into moderate clips on purpose, so per-print
    grade (best single leg) understates it — this scores what actually makes
    accumulation strong: aggregate premium, repetition, intraday density, rising
    price, shape, direction, cumulative Vol/OI. Returns (score, grade)."""
    s = 0.0
    tp = total_premium or 0
    if tp >= 10_000_000: s += 4.0
    elif tp >= 5_000_000: s += 3.2
    elif tp >= 2_500_000: s += 2.4
    elif tp >= 1_000_000: s += 1.6
    elif tp >= 500_000: s += 0.8
    qh = qualifying_hits or 0
    if qh >= 30: s += 2.0
    elif qh >= 15: s += 1.5
    elif qh >= 8: s += 1.0
    elif qh >= 3: s += 0.5
    sw = swift_hits or 0
    if sw >= 10: s += 1.5
    elif sw >= 6: s += 1.0
    elif sw >= 4: s += 0.6
    if burst_rising: s += 0.8
    s += {"accelerating": 1.8, "intraday_burst": 1.4, "steady": 0.9,
          "single": 0.0, "fading": -0.5, "incidental": -1.0}.get(shape, 0.0)
    if sided_pct is not None:
        if sided_pct >= 0.8: s += 1.2
        elif sided_pct >= 0.65: s += 0.7
        elif sided_pct >= 0.55: s += 0.3
    if cum_voi is not None:
        if cum_voi >= 5: s += 1.0
        elif cum_voi >= 2: s += 0.6
        elif cum_voi >= 1: s += 0.3
    if s >= 8.5: g = "A+ 🚀"
    elif s >= 6.5: g = "A"
    elif s >= 4.5: g = "B"
    elif s >= 2.5: g = "C"
    else: g = "D"
    return round(s, 1), g


def _parse_mdy(s):
    """M/D/YYYY → sortable (Y,M,D) tuple. (0,0,0) on malformed."""
    try:
        m, d, y = str(s).strip().split("/")
        return (int(y), int(m), int(d))
    except Exception:
        return (0, 0, 0)


def _build_by_contract(today: str, stock_etf: str, min_hits: int,
                       exclude_algo: bool, lookback_days: int = 1) -> dict:
    thresholds = _load_thresholds()
    override_sql_floor = 500_000
    etf_enabled = thresholds.get("etf_enabled", False)
    base_sources = ["stocks", "indexes"] if etf_enabled else ["stocks"]
    if stock_etf == "stocks":
        sources = [s for s in base_sources if s == "stocks"]
    elif stock_etf == "etfs":
        sources = [s for s in base_sources if s == "indexes"]
    else:
        sources = base_sources

    rows = []
    # Multi-day accumulation: aggregate a contract's hits across the last
    # `lookback_days` trading days present in the data (default 1 = today).
    # Same-strike/same-exp repeats across days are the strongest accumulation
    # signal — someone building a position with conviction.
    lookback_days = max(1, min(int(lookback_days or 1), 5))
    if lookback_days <= 1:
        target_dates = [today]
    else:
        _c = sqlite3.connect(DB_PATH, timeout=10)
        try:
            all_dates = [r[0] for r in _c.execute(
                "SELECT DISTINCT CreatedDate FROM flow").fetchall() if r[0]]
        finally:
            _c.close()
        today_key = _parse_mdy(today)
        dated = sorted([d for d in all_dates if _parse_mdy(d) <= today_key],
                       key=_parse_mdy, reverse=True)
        target_dates = dated[:lookback_days] or [today]

    if sources:
        base_cap = int(os.environ.get("MASSIVE_DAYSTATS_CAP", "20000"))
        cap = min(base_cap * len(target_dates), 100000)  # scale for the window
        select_cols = (
            "SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume, "
            "Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate, "
            "Color, Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI"
        )
        color_gate = ("(Color IN ('MAGENTA', 'YELLOW') "
                      "OR (Color = 'WHITE' AND CAST(Premium AS INTEGER) >= ?))")
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            conn.row_factory = sqlite3.Row
            subqueries, params = [], []
            date_ph = ",".join("?" for _ in target_dates)
            for s in sources:
                subqueries.append(
                    f"SELECT * FROM ({select_cols} FROM flow "
                    f"WHERE source = ? AND CreatedDate IN ({date_ph}) AND {color_gate} "
                    f"ORDER BY id DESC LIMIT ?)"
                )
                params.append(s)
                params.extend(target_dates)
                params.extend([override_sql_floor, cap])
            cur = conn.execute(" UNION ALL ".join(subqueries), params)
            rows = cur.fetchall()
        finally:
            conn.close()

    # Group by contract
    contracts: dict = {}
    for r in rows:
        # require_direction=False: count every meaningful print toward the
        # accumulation, even ones the tape drops for unclassifiable side. The
        # rollup's thesis is repetition; direction is derived from the sided
        # subset and shown as bull/bear/mixed with a sided-% for honesty.
        a = _row_to_alert(dict(r), require_direction=False)
        if a is None:
            continue
        if exclude_algo and a.get("_tierKey") == "algo":
            continue
        tk, cp, strike, exp = a.get("ticker"), a.get("cp"), a.get("strike"), a.get("exp")
        if not tk or cp is None or strike is None or not exp:
            continue
        ckey = (tk, cp, strike, exp)
        g = contracts.get(ckey)
        if g is None:
            g = {
                "ticker": tk, "cp": cp, "strike": strike, "exp": exp,
                "source": a.get("source", "stocks"), "mkt_cap": a.get("_mktCap") or 0,
                "spot": a.get("spot"), "dte": a.get("dte"),
                "moneynessPct": a.get("moneynessPct"), "moneynessLabel": a.get("moneynessLabel"),
                "total_premium": 0.0, "total_volume": 0,
                "bull_premium": 0.0, "bear_premium": 0.0,
                "sides": {"A": 0, "AA": 0, "B": 0, "BB": 0, "none": 0},
                "types": set(), "grades": [], "max_oi": 0,
                "first_ts": None, "last_ts": None, "prints": [],
                "dates": {},  # M/D/YYYY -> hit count, for multi-day accumulation
            }
            contracts[ckey] = g
        rdate = r["CreatedDate"] if "CreatedDate" in r.keys() else None
        if rdate:
            g["dates"][rdate] = g["dates"].get(rdate, 0) + 1
        prem = a.get("alertPremium") or 0.0
        vol = a.get("tradeSize") or 0
        g["total_premium"] += prem
        g["total_volume"] += vol
        d = a.get("_direction")
        if d == "Bull":
            g["bull_premium"] += prem
        elif d == "Bear":
            g["bear_premium"] += prem
        side = (a.get("_side") or "").strip().upper()
        g["sides"][side if side in g["sides"] else "none"] += 1
        if a.get("_type"):
            g["types"].add(a["_type"])
        if a.get("grade"):
            g["grades"].append(a["grade"])
        oi = a.get("priorOI") or 0
        if oi and oi > g["max_oi"]:
            g["max_oi"] = oi
        ts = a.get("timestamp") or 0
        if ts:
            if g["first_ts"] is None or ts < g["first_ts"]:
                g["first_ts"] = ts
            if g["last_ts"] is None or ts > g["last_ts"]:
                g["last_ts"] = ts
        g["prints"].append({
            "timestamp": ts, "price": a.get("averageFillPrice"), "volume": vol,
            "side": side, "type": a.get("_type") or "", "premium": round(prem),
            "direction": d, "grade": a.get("grade"), "color": a.get("_color"),
        })

    have_dormant = _has_dormant_data()
    out = []
    for g in contracts.values():
        floor = _rollup_floor(g["mkt_cap"], g["source"], thresholds)
        qual = sum(1 for p in g["prints"] if (p["premium"] or 0) >= floor)
        total_floor = _rollup_total_floor(g["mkt_cap"], g["source"], thresholds)
        # Gate: enough repeated meaningful clips AND a total that clears the
        # cap-scaled bar. The hit floor is low (repetition of small clips on a
        # small name is the signal); the cap-scaling lives in the total floor.
        if qual < min_hits or g["total_premium"] < total_floor:
            continue
        bull, bear = g["bull_premium"], g["bear_premium"]
        sided = bull + bear
        if bull > 0 and bear > 0:
            direction = "Mixed"
        elif bull > bear:
            direction = "Bull"
        elif bear > bull:
            direction = "Bear"
        else:
            direction = "Unclear"   # no cleanly-sided prints (all empty/ambiguous)
        consistency = round(max(bull, bear) / sided, 2) if sided > 0 else 0.0
        # What fraction of the contract's premium is cleanly directional — lets
        # the UI flag "8 hits / $2.87M, 50% sided" rather than overclaiming.
        sided_pct = round(sided / g["total_premium"], 2) if g["total_premium"] > 0 else 0.0
        dormant = _is_dormant_ticker(g["ticker"]) if have_dormant else False
        voi = round(g["total_volume"] / g["max_oi"], 1) if g["max_oi"] > 0 else None
        # Soft-drop: cumulative volume UNDER open interest (< 1x, when we HAVE OI)
        # means the flow may not be new positioning (Ravi's OI rule) — skip it
        # unless the dollar size is large enough to matter on its own. When OI is
        # unknown (voi is None) we can't judge, so keep. Tunable premium escape.
        voi_keep_premium = thresholds.get("rollup_voi_keep_premium", 1_000_000)
        if voi is not None and voi < 1.0 and g["total_premium"] < voi_keep_premium:
            continue
        # V/OI factor: reward relative volume (a core conviction signal), but
        # compress the tail so a 176x doesn't dwarf a large-premium 3x. Bounded
        # to 3x. None OI → neutral 1.0.
        voi_factor = min(3.0, 1.0 + (voi / 10.0)) if voi is not None else 1.0
        # Multi-day span: same contract accumulated across N days is a stronger
        # conviction signal than a single day. Boost score 25% per extra day so
        # multi-day builds surface to the top.
        _dates_sorted = sorted(g["dates"].keys(), key=_parse_mdy)
        days_active = len(_dates_sorted)
        first_seen = _dates_sorted[0] if _dates_sorted else None
        day_hits = [{"date": d, "hits": g["dates"][d]} for d in _dates_sorted]
        is_multiday = days_active >= 2

        # Intraday density (BBS Rapid Fire / Swift / Steady model): how hard was
        # the strike hammered in a short window on its busiest stretch? Uses the
        # per-print timestamps + prices already collected. swift_hits = most
        # qualifying prints inside any 5-min window; steady_hits = 60-min window;
        # burst_rising = did the fill price climb across that burst (the BBS tell
        # that it's aggressive accumulation, not churn). peak_intraday_hits = the
        # busiest single day. An intraday burst is a signal even on ONE day.
        _qual_prints = sorted(
            [p for p in g["prints"] if (p.get("premium") or 0) >= floor and p.get("timestamp")],
            key=lambda p: p["timestamp"],
        )
        peak_intraday_hits = max(g["dates"].values()) if g["dates"] else 0
        swift_hits, steady_hits, burst_rising = 1, 1, False
        if len(_qual_prints) >= 2:
            _ts = [p["timestamp"] for p in _qual_prints]
            _px = [p.get("price") or 0 for p in _qual_prints]
            for i in range(len(_ts)):
                j5 = j60 = i
                while j5 + 1 < len(_ts) and _ts[j5 + 1] - _ts[i] <= 300:
                    j5 += 1
                while j60 + 1 < len(_ts) and _ts[j60 + 1] - _ts[i] <= 3600:
                    j60 += 1
                if (j5 - i + 1) > swift_hits:
                    swift_hits = j5 - i + 1
                    burst_rising = _px[j5] > _px[i]
                steady_hits = max(steady_hits, j60 - i + 1)
        is_intraday_burst = swift_hits >= 4  # >=4 qualifying prints within 5 min

        # Accumulation SHAPE. Multi-day shape from the daily pattern; single-day
        # contracts that were hammered intraday get their own "intraday_burst".
        _h = [x["hits"] for x in day_hits]
        if days_active < 2:
            accumulation_shape = "intraday_burst" if is_intraday_burst else "single"
        else:
            _peak = max(_h); _first = _h[0]; _last = _h[-1]; _tot = sum(_h)
            if _peak <= 2 and _tot <= days_active * 2:
                accumulation_shape = "incidental"
            elif _last < _peak * 0.34 and _peak >= 5:
                accumulation_shape = "fading"
            elif _last >= _peak * 0.9 and _last > _first:
                accumulation_shape = "accelerating"
            else:
                accumulation_shape = "steady"
        # Score factor by shape. Intraday burst ranks alongside accelerating —
        # a strike being hammered today is a strong immediate signal.
        _shape_factor = {"accelerating": 1.6, "intraday_burst": 1.5, "steady": 1.2,
                         "single": 1.0, "fading": 0.6, "incidental": 0.4}.get(accumulation_shape, 1.0)
        # Extra nudge if the intraday burst had price rising (BBS Swift tell).
        if is_intraday_burst and burst_rising:
            _shape_factor *= 1.15
        score = int(qual * g["total_premium"] * (0.5 + 0.5 * consistency)
                    * voi_factor * _shape_factor * (2.0 if dormant else 1.0))
        out.append({
            "ticker": g["ticker"], "cp": g["cp"], "strike": g["strike"], "exp": g["exp"],
            "source": g["source"], "dte": g["dte"],
            "spot": g["spot"], "moneynessPct": g["moneynessPct"], "moneynessLabel": g["moneynessLabel"],
            "hit_count": len(g["prints"]), "qualifying_hits": qual, "floor": floor,
            "days_active": days_active, "first_seen": first_seen,
            "day_hits": day_hits, "is_multiday": is_multiday,
            "accumulation_shape": accumulation_shape,
            "peak_intraday_hits": peak_intraday_hits, "swift_hits": swift_hits,
            "steady_hits": steady_hits, "burst_rising": burst_rising,
            "is_intraday_burst": is_intraday_burst,
            "total_floor": total_floor,
            "total_premium": round(g["total_premium"]), "total_volume": g["total_volume"],
            "bull_premium": round(bull), "bear_premium": round(bear),
            "direction": direction, "consistency": consistency,
            "sided_pct": sided_pct, "sided_premium": round(sided),
            "sides": g["sides"], "types": sorted(g["types"]),
            "grade": _best_grade(g["grades"]), "cum_voi": voi, "max_oi": g["max_oi"],
            "accumulation_grade": _accumulation_grade(
                total_premium=g["total_premium"], qualifying_hits=qual,
                swift_hits=swift_hits, burst_rising=burst_rising,
                shape=accumulation_shape, sided_pct=sided_pct, cum_voi=voi,
            )[1],
            "accumulation_score": _accumulation_grade(
                total_premium=g["total_premium"], qualifying_hits=qual,
                swift_hits=swift_hits, burst_rising=burst_rising,
                shape=accumulation_shape, sided_pct=sided_pct, cum_voi=voi,
            )[0],
            "dormant": dormant, "score": score,
            "first_ts": g["first_ts"], "last_ts": g["last_ts"],
            "prints": sorted(g["prints"], key=lambda p: p["timestamp"] or 0, reverse=True),
        })
    # Default order: latest activity first, so the view still reads like a tape.
    out.sort(key=lambda c: c["last_ts"] or 0, reverse=True)
    return {
        "query_date": today, "stock_etf": stock_etf, "min_hits": min_hits,
        "contract_count": len(out), "contracts": out,
    }


@router.get("/by-contract")
def by_contract(
    target_date: str = Query(default=None),
    stock_etf: str = Query(default="all", description="'stocks' | 'etfs' | 'all' — same partition as the feed."),
    min_hits: int = Query(default=3, ge=1, le=20, description="Min qualifying prints (>= cap-scaled floor) for a contract to appear."),
    exclude_algo: bool = Query(default=True),
    lookback_days: int = Query(default=1, ge=1, le=5, description="Aggregate a contract's hits across the last N trading days (multi-day accumulation). 1 = today only."),
):
    """One row per contract (ticker+cp+strike+exp) for the day, for contracts
    that were hit >= min_hits times by prints clearing the cap-scaled floor.
    total_premium sums ALL of the contract's prints; the floor only gates the
    hit count. Each row carries its individual prints for expand-on-click.
    Sorted by latest activity; also returns a `score` (qualifying_hits x total
    premium x direction-consistency, x2 for dormant/unusual names) for optional
    conviction-first sorting. Cached 30s per (date, stock_etf, min_hits)."""
    today = _resolve_date(target_date)   # ISO YYYY-MM-DD → M/D/YYYY (else zero-rows)
    se = stock_etf if stock_etf in ("stocks", "etfs", "all") else "all"
    now = time.time()
    key = (today, se, int(min_hits), bool(exclude_algo), int(lookback_days))
    cached = _by_contract_cache.get(key)
    if cached and (now - cached[0]) < _BY_CONTRACT_TTL:
        return cached[1]
    # Single-flight + stale-serve (see day_stats). Bounds concurrent heavy
    # recomputes to 1 so the 30s+ rollup pass can't pile up and starve /recent.
    if not _by_contract_lock.acquire(blocking=False):
        if cached:
            return cached[1]
        with _by_contract_lock:
            c2 = _by_contract_cache.get(key)
            if c2 and (time.time() - c2[0]) < _BY_CONTRACT_TTL:
                return c2[1]
            payload = _build_by_contract(today, se, int(min_hits), bool(exclude_algo), int(lookback_days))
            # Accumulation auto-push: mark already-pushed contracts (POSTED persists in
            # the non-admin view) and fire newly-qualifying ones. Hooked in the ROUTE
            # on fresh builds only — NOT in _build_by_contract, which the manual
            # force-push path also calls.
            _apply_auto_push(payload.get("contracts", []), mode="accumulation",
                             live=(today == _today_mdyyyy()))
            _by_contract_cache[key] = (time.time(), payload)
            return payload
    try:
        payload = _build_by_contract(today, se, int(min_hits), bool(exclude_algo), int(lookback_days))
        # Accumulation auto-push: mark already-pushed contracts (POSTED persists in
        # the non-admin view) and fire newly-qualifying ones. Hooked in the ROUTE
        # on fresh builds only — NOT in _build_by_contract, which the manual
        # force-push path also calls.
        _apply_auto_push(payload.get("contracts", []), mode="accumulation",
                             live=(today == _today_mdyyyy()))
        _by_contract_cache[key] = (time.time(), payload)
        return payload
    finally:
        _by_contract_lock.release()


# ─── Curated thresholds endpoints (admin tuning panel) ────────────────────
# Used by the in-page tuning panel (`?tune=1` on /live-massive). The frontend
# fetches current thresholds, lets admin adjust sliders + preview the impact
# against the latest /recent payload, then POSTs the final values back.

@router.get("/thresholds")
def get_thresholds():
    """Return the current Curated-mode thresholds. Defaults if file missing."""
    return {
        "thresholds": _load_thresholds(),
        "defaults": DEFAULT_THRESHOLDS,
        "path": _THRESHOLDS_PATH,
    }


# ─── Massive Discord push (manual force-push + shared embed builder) ─────────
# Webhook resolution mirrors LiveFlow: prefer a dedicated Massive webhook, fall
# back to the LiveFlow channel so "same channel for now" works with no config.
# Never hardcode the URL — it's a secret; set DISCORD_MASSIVE_WEBHOOK_URL in the
# environment (Railway) and rotate there without a code change.
_MASSIVE_WEBHOOK = (
    os.getenv("DISCORD_MASSIVE_WEBHOOK_URL")
    or os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
    or os.getenv("DISCORD_WEBHOOK_URL", "")
).strip()
_UCT_LOGO_URL = os.getenv(
    "UCT_LOGO_URL",
    "https://raw.githubusercontent.com/unchartedterritory5995-cyber/"
    "UCT-Dashboard/master/app/public/UCT_logo_512.png",
).strip()


# ── Earnings-date lookup for embeds (2026-07-19) ─────────────────────────
# The router is a SEPARATE process from the flow-worker (principle #1: its
# module state is invisible here), so it keeps its OWN calendar cache rather
# than reading the worker's _ER_DATE_CACHE. Same source: /api/calendar, paged
# via ?week=<Monday>. Refreshed in a BACKGROUND THREAD (never blocks the push
# path); on failure the prior cache is kept and the earnings line is omitted.
_ER_CAL_BASE = os.getenv("UCT_PUBLIC_BASE", "https://uctintelligence.com").rstrip("/")
_ER_CAL_ENABLED = os.getenv("MASSIVE_EARNINGS_CAL_ENABLED", "1") == "1"
_ER_CAL_WEEKS_AHEAD = int(os.getenv("MASSIVE_EARNINGS_CAL_WEEKS_AHEAD", "2"))
_ER_CAL_TTL = 6 * 60 * 60
_ER_CAL_MIN_RETRY = 5 * 60          # after a failed refresh, wait ≥5 min before retrying
_ER_CAL_UA = "UCT-Massive/1.0 (+https://uctintelligence.com)"
_ER_CAL: dict = {}                  # {sym: 'YYYY-MM-DD'}
_ER_CAL_AT: float = 0.0
_ER_CAL_TRIED: float = 0.0
_ER_CAL_REFRESHING = False


def _er_cal_do_refresh():
    """Background-thread fetch of current week + next N Mondays. Never raises."""
    global _ER_CAL, _ER_CAL_AT, _ER_CAL_REFRESHING
    try:
        import urllib.request
        from datetime import datetime as _dt, timedelta as _td

        def _get(url):
            req = urllib.request.Request(url, headers={"User-Agent": _ER_CAL_UA})
            with urllib.request.urlopen(req, timeout=6.0) as resp:
                if resp.status != 200:
                    return None
                return json.loads(resp.read().decode("utf-8"))

        def _flatten(payload, acc):
            days = (payload or {}).get("days") or {}
            if not isinstance(days, dict):
                return
            for date_str, day in days.items():
                if not isinstance(day, dict):
                    continue
                for bucket in ("bmo", "amc", "tbd"):
                    for e in day.get(bucket) or []:
                        if not isinstance(e, dict):
                            continue
                        s = (e.get("sym") or "").upper().strip()
                        if not s:
                            continue
                        prev = acc.get(s)
                        if prev is None or date_str < prev:
                            acc[s] = date_str

        out = {}
        base = _get(f"{_ER_CAL_BASE}/api/calendar")
        if not base:
            return
        _flatten(base, out)
        ws = str(base.get("week_start") or "")[:10]
        try:
            monday = _dt.strptime(ws, "%Y-%m-%d")
        except (TypeError, ValueError):
            monday = None
        if monday is not None:
            for k in range(1, max(0, _ER_CAL_WEEKS_AHEAD) + 1):
                wk = (monday + _td(days=7 * k)).strftime("%Y-%m-%d")
                try:
                    p = _get(f"{_ER_CAL_BASE}/api/calendar?week={wk}")
                except Exception:
                    p = None
                if p:
                    _flatten(p, out)
        if out:
            _ER_CAL = out
            _ER_CAL_AT = time.time()
    except Exception:
        pass
    finally:
        _ER_CAL_REFRESHING = False


def _er_cal_maybe_refresh():
    """Kick a background refresh if the cache is stale. Non-blocking; guarded so
    a failing fetch doesn't hammer the endpoint and only one refresh runs."""
    global _ER_CAL_TRIED, _ER_CAL_REFRESHING
    if not _ER_CAL_ENABLED or _ER_CAL_REFRESHING:
        return
    now = time.time()
    if (now - _ER_CAL_AT) < _ER_CAL_TTL:
        return
    if (now - _ER_CAL_TRIED) < _ER_CAL_MIN_RETRY:
        return
    _ER_CAL_TRIED = now
    _ER_CAL_REFRESHING = True
    threading.Thread(target=_er_cal_do_refresh, daemon=True).start()


def _parse_mdy(s):
    """'M/D/YYYY' → date, else None."""
    try:
        p = str(s).strip().split("/")
        if len(p) == 3:
            return date(int(p[2]), int(p[0]), int(p[1]))
    except (ValueError, IndexError):
        pass
    return None


def _earnings_line(ticker: str, exp=None) -> str:
    """Date-aware earnings line for the embed, or None. Uses the router's own
    calendar cache. Renders nothing when earnings are past or unknown. ET here
    is the file's fixed EDT(−4); date-only so DST is immaterial except within an
    hour of midnight ET. (`exp` is accepted for call-site compatibility but
    unused — the held-through-earnings note was removed 2026-07-20.)"""
    if not ticker:
        return None
    _er_cal_maybe_refresh()
    d = _ER_CAL.get(str(ticker).upper().strip())
    if not d:
        return None
    try:
        ed = datetime.strptime(d, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None
    days_to = (ed - datetime.now(ET).date()).days
    if days_to < 0:
        return None  # already reported — say nothing (fixes the MU stale flag)
    horizon = "today" if days_to == 0 else ("tomorrow" if days_to == 1 else f"in {days_to} days")
    return f"⚠️ Earnings {ed.month}/{ed.day} ({horizon})"


def _fmt_money_m(n) -> str:
    try:
        n = float(n or 0)
    except (TypeError, ValueError):
        return "?"
    if n >= 1_000_000:
        return f"${n/1_000_000:.2f}M"
    if n >= 1_000:
        return f"${n/1_000:.0f}K"
    return f"${n:.0f}"


def _exp_us(exp: str) -> str:
    """flow.db exp is 'M/D/YYYY'; render 'MM-DD-YYYY' to match LiveFlow embeds."""
    if not exp:
        return "?"
    s = str(exp).strip()
    if "/" in s:
        p = s.split("/")
        if len(p) == 3:
            try:
                return f"{int(p[0]):02d}-{int(p[1]):02d}-{int(p[2])}"
            except (ValueError, IndexError):
                return s
    if "-" in s:  # ISO fallback
        p = s.split("-")
        if len(p) == 3:
            try:
                return f"{int(p[1]):02d}-{int(p[2]):02d}-{int(p[0])}"
            except (ValueError, IndexError):
                return s
    return s


def _build_massive_embed(alert: dict, *, mode: str = "single") -> dict:
    """Discord embed for a Massive alert — visually identical to LiveFlow's
    (UCT logo author, green/red color bar, badges, 3-per-row fields).
    mode='single' = one tape print; mode='accumulation' = By-Contract rollup."""
    cp = (alert.get("cp") or "?").upper()
    ticker = alert.get("ticker") or "?"
    strike = alert.get("strike")
    exp = alert.get("exp")
    dte = alert.get("dte")
    direction = alert.get("_direction") or alert.get("direction")
    color = 0x3CB868 if cp == "C" else (0xE74C3C if cp == "P" else 0xC9A84C)
    strike_str = f"${strike:g}" if isinstance(strike, (int, float)) else "?"
    cp_label = "CALL" if cp == "C" else ("PUT" if cp == "P" else cp)
    dte_str = f"{dte}d" if dte is not None else "?"

    # Title with moneyness suffix (magnitude only; label conveys direction).
    m_pct = alert.get("moneynessPct")
    m_lbl = alert.get("moneynessLabel")
    title = f"{ticker} {strike_str} {cp_label} EXP: {_exp_us(exp)}"
    if m_lbl == "ATM":
        title += " (ATM)"
    elif m_lbl in ("ITM", "OTM") and m_pct is not None:
        title += f" ({abs(m_pct):.0f}% {m_lbl})"

    # Direction isn't repeated as a line — the title (CALL/PUT), the color bar,
    # and the alert name already convey it.

    # All metrics go in the DESCRIPTION as compact text lines (not inline fields):
    # inline fields stack one-per-row on narrow mobile, whereas description text
    # renders identically on desktop and mobile. Groups are separated by a BLANK
    # line for readable row spacing.
    def _row(*parts):
        """Join the present parts of a line with a middot; None if all empty."""
        parts = [p for p in parts if p]
        return "  ·  ".join(parts) if parts else None

    badges, lines = [], []
    spot = alert.get("spot")
    spot_line = f"🧭 Spot ${float(spot):,.2f}" if spot else None

    if mode == "accumulation":
        hits = alert.get("qualifying_hits") or alert.get("hit_count") or 0
        total_prem = alert.get("total_premium") or 0
        total_vol = alert.get("total_volume") or 0
        sided_pct = alert.get("sided_pct")
        voi = alert.get("cum_voi")
        # Lead badge reflects the accumulation SHAPE (matches the radar).
        shape = alert.get("accumulation_shape") or "single"
        days_active = alert.get("days_active") or 1
        day_hits = alert.get("day_hits") or []
        swift = alert.get("swift_hits") or 0
        rising = alert.get("burst_rising")
        if shape == "accelerating":
            badges.append(f"🔥 **{days_active}-DAY ACCELERATING** · {hits} hits")
        elif shape == "intraday_burst":
            badges.append(f"⚡ **SWIFT {swift}×**{' ↑' if rising else ''} · {hits} hits")
        elif shape == "steady":
            badges.append(f"🔁 **{days_active}-DAY STEADY** · {hits} hits")
        else:
            badges.append(f"🔁 **{hits} HITS — ACCUMULATION**")
        if voi and voi > 1.0:
            badges.append(f"🚀 **OI BREAK** {voi:.1f}x")
        # Daily build ramp (37 → 45 → 108) when multi-day.
        ramp = " → ".join(str(h.get("hits", 0)) for h in day_hits) if len(day_hits) > 1 else None
        lines.append(_row(
            f"💰 **{_fmt_money_m(total_prem)}**",
            (f"{dte} DTE" if dte is not None else None),
            (f"{int(round(sided_pct * 100))}% sided" if sided_pct is not None else None),
        ))
        if spot_line:
            lines.append(spot_line)
        # 📊 volume group — Vol/OI drops to its own line under Volume.
        vol_group = [x for x in (
            (f"Volume: {int(total_vol):,}" if total_vol else None),
            (f"Vol/OI: {voi:.2f}x" if voi is not None else None),
        ) if x]
        if vol_group:
            lines.append("📊 " + "\n".join(vol_group))
        if ramp:
            # Ramp is the per-day HIT COUNT growing across sessions (e.g.
            # 37 → 45 → 108 hits). "Daily build" alone didn't say what was
            # building; label it as hits/day so the number is self-explaining.
            lines.append(f"📈 Hits by day:  {ramp}")
        default_name = "UCT Accumulation"
    else:
        prem = alert.get("alertPremium") or 0
        size = alert.get("tradeSize") or 0
        oi = alert.get("priorOI")
        fill = alert.get("averageFillPrice")
        voi = round(size / oi, 2) if (oi and oi > 0 and size) else None
        if voi and voi > 1.0:
            badges.append(f"🚀 **OI BREAK** {voi:.1f}x")
        lines.append(_row(
            f"💰 **{_fmt_money_m(prem)}**",
            (f"Fill ${fill:.2f}" if fill else None),
            (f"{dte} DTE" if dte is not None else None),
        ))
        if spot_line:
            lines.append(spot_line)
        # 📊 volume group — Volume + OI on line 1, Vol/OI on its own line.
        vol_l1 = _row(
            (f"Volume: {int(size):,}" if size else None),
            (f"OI: {int(oi):,}" if oi is not None else None),
        )
        vol_group = [x for x in (vol_l1, (f"Vol/OI: {voi:.2f}x" if voi is not None else None)) if x]
        if vol_group:
            lines.append("📊 " + "\n".join(vol_group))
        default_name = alert.get("alertName") or "UCT Massive"

    # Conviction grades the PATTERN for accumulation (accumulation_grade), the
    # single print otherwise — a sliced institutional build has moderate
    # per-print grades but strong aggregate conviction.
    # Timestamp — single = the print's execution time; accumulation = the most
    # recent qualifying hit. Rendered as a friendly ET label ("Today at 12:57 PM",
    # "Yesterday at …", else "MM/DD/YYYY …") on the same line as Conviction. ET is
    # fixed EDT (-4) here, matching the rest of this file (so it'll read an hour off
    # once DST ends — a pre-existing property of this module's ET constant).
    _ts_raw = alert.get("last_ts") if mode == "accumulation" else alert.get("timestamp")
    if not _ts_raw:
        _ts_raw = alert.get("timestamp") or alert.get("last_ts")
    _ts_label = None
    try:
        if _ts_raw:
            _dt = datetime.fromtimestamp(float(_ts_raw), tz=ET)
            _today = datetime.now(ET).date()
            _clock = _dt.strftime("%I:%M %p").lstrip("0")
            if _dt.date() == _today:
                _ts_label = f"Today at {_clock}"
            elif _dt.date() == _today - timedelta(days=1):
                _ts_label = f"Yesterday at {_clock}"
            else:
                _ts_label = f"{_dt.strftime('%m/%d/%Y')} {_clock}"
    except (TypeError, ValueError, OSError):
        _ts_label = None

    grade = alert.get("accumulation_grade") if mode == "accumulation" else alert.get("grade")
    # Label the timestamp so it can't be mistaken for Discord's post time. For an
    # accumulation the ts is the most recent qualifying hit ("Last hit"); for a
    # single print it's the execution time ("Filled"). Without the label, a card
    # posted at 9:31 AM ET showing "Yesterday at 3:59 PM" read like a
    # contradiction — two unlabeled times 17h apart.
    _ts_prefix = "Last hit" if mode == "accumulation" else "Filled"
    _ts_display = f"{_ts_prefix}: {_ts_label}" if _ts_label else None
    if grade and grade != "D":
        rocket = " 🚀" if grade in ("A+", "A") else ""
        conv = f"🏆 Conviction **{grade}**{rocket}"
        if _ts_display:
            conv += f"  ·  🕐 {_ts_display}"
        lines.append(conv)
    elif _ts_display:
        # No conviction line (grade D/blank) — still surface the time on its own line.
        lines.append(f"🕐 {_ts_display}")

    # Compose: badge line(s), then metric groups separated by a BLANK line for
    # readable spacing. All in the description → identical on desktop and mobile.
    # Earnings proximity (2026-07-19) — date-aware, self-clearing. Nothing when
    # earnings are past or unknown.
    _er_line = _earnings_line(ticker, exp)
    if _er_line:
        lines.append(_er_line)
    lines = [ln for ln in lines if ln]
    desc_parts = []
    if badges:
        desc_parts.append("  ·  ".join(badges))
    if lines:
        desc_parts.append("\n\n".join(lines))

    embed = {"title": title, "color": color}
    if desc_parts:
        embed["description"] = "\n\n".join(desc_parts)
    if _UCT_LOGO_URL:
        embed["author"] = {"name": alert.get("alertName") or default_name, "icon_url": _UCT_LOGO_URL}
    else:
        embed["footer"] = {"text": f"{default_name} · UCT Massive"}
    return embed


def _post_massive_discord(embed: dict) -> tuple:
    """POST an embed to the Massive webhook. Returns (ok, detail)."""
    if not _MASSIVE_WEBHOOK:
        return (False, "no webhook configured (set DISCORD_MASSIVE_WEBHOOK_URL)")
    import urllib.request
    import urllib.error
    data = json.dumps({"embeds": [embed]}).encode("utf-8")
    req = urllib.request.Request(
        _MASSIVE_WEBHOOK, data=data,
        headers={
            "Content-Type": "application/json",
            # Discord's Cloudflare edge blocks urllib's default UA with error
            # 1010. A normal UA is required for the webhook POST to go through.
            "User-Agent": "UCT-Massive/1.0 (+https://uctintelligence.com)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            code = resp.getcode()
            return (200 <= code < 300, f"discord {code}")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read()[:200].decode("utf-8", "ignore")
        except Exception:
            pass
        return (False, f"discord HTTP {e.code}: {body}")
    except Exception as e:
        return (False, str(e))


# ─── Push log: persistent record of what was sent to Discord ─────────────────
# Manual force-push (and, once enabled, auto-push) record here so: (1) POSTED
# state survives a refresh and is visible in the non-admin view, and (2) auto-push
# can dedup — a contract pushed once by EITHER path is never re-pushed. Kept in a
# SEPARATE small DB (not flow.db) so push writes never contend with the Massive
# worker's heavy writes to flow.db (the source of this morning's lock 500s).
_PUSHED_DB = os.path.join(os.path.dirname(DB_PATH), "pushed.db")


def _pushed_conn():
    conn = sqlite3.connect(_PUSHED_DB, timeout=10)
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS pushed_alerts (
            push_key   TEXT PRIMARY KEY,
            ticker TEXT, cp TEXT, strike TEXT, exp TEXT, alert_date TEXT,
            premium REAL, grade TEXT, side TEXT, type TEXT, tier TEXT, alert_name TEXT,
            mode TEXT, source TEXT, pushed_at TEXT)"""
    )
    return conn


def _alert_trading_day(alert: dict) -> str:
    """The ET trading day an alert belongs to, ISO date. Single = the print's
    execution date; accumulation = its most recent qualifying hit.

    Derived from the alert's OWN event time, never wall-clock now, so a 10:00 AM
    print keys to its own day regardless of when the scan that finds it runs.

    2026-07-15 bug this fixes: both call sites used date.today() — the
    CONTAINER'S UTC date. At 00:06 UTC (8:06 PM ET, still the 7/15 session) the
    key flipped to 7/16, collided with none of the existing 7/15 claims, and
    re-fired the whole day's alerts to Discord as duplicates.
    """
    ts = alert.get("last_ts") or alert.get("timestamp")
    try:
        if ts:
            return datetime.fromtimestamp(float(ts), tz=ET).date().isoformat()
    except (TypeError, ValueError, OSError):
        pass
    return datetime.now(ET).date().isoformat()


def _push_key(alert: dict) -> str:
    """Contract+day identity, so a contract pushed once (manual OR auto, single OR
    accumulation) is recorded/pushed only once."""
    return "|".join([
        str(alert.get("ticker", "")).upper(),
        str(alert.get("cp", "")).upper(),
        str(alert.get("strike", "")),
        _exp_us(alert.get("exp", "")),
        str(alert.get("alertDate") or alert.get("_date") or _alert_trading_day(alert)),
    ])


def _record_push(alert: dict, mode: str, source: str) -> bool:
    """Record a push. Returns True if this was a NEW push (row inserted), False if
    the contract was already recorded — making the INSERT the atomic dedup gate for
    auto-push. Never raises: logging must not break a push."""
    try:
        conn = _pushed_conn()
        cur = conn.execute(
            """INSERT OR IGNORE INTO pushed_alerts
               (push_key,ticker,cp,strike,exp,alert_date,premium,grade,side,type,tier,alert_name,mode,source,pushed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (_push_key(alert), alert.get("ticker"), alert.get("cp"),
             str(alert.get("strike", "")), _exp_us(alert.get("exp", "")),
             str(alert.get("alertDate") or alert.get("_date") or _alert_trading_day(alert)),
             alert.get("alertPremium") or alert.get("total_premium"),
             alert.get("grade") or alert.get("accumulation_grade"),
             alert.get("_side") or alert.get("side"),
             alert.get("_type") or alert.get("alertType"),
             alert.get("_tierKey"), alert.get("alertName"),
             mode, source, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        claimed = cur.rowcount > 0
        conn.close()
        return claimed
    except Exception:
        return False


def _pushed_keys(alert_date: str = None) -> set:
    """Set of push_keys already sent — for marking forwardedToDiscord / dedup."""
    try:
        conn = _pushed_conn()
        if alert_date:
            rows = conn.execute("SELECT push_key FROM pushed_alerts WHERE alert_date=?", (alert_date,)).fetchall()
        else:
            rows = conn.execute("SELECT push_key FROM pushed_alerts").fetchall()
        conn.close()
        return set(r[0] for r in rows)
    except Exception:
        return set()


# Auto-push algo. DEFAULT is intentionally conservative — derived from 7/13's
# manual pushes: the alerts you sent by hand were the top tier (Alpha Gold) and
# grade A/A+. Everything else (B/C/D, light Bullish/Bearish/LEAPS tiers) stayed
# manual. This fires ONLY that top set, so nothing you didn't reliably push by
# hand goes out automatically. The optional Size-sweep rule is OFF by default.
# NOTE: this only DECIDES; nothing calls it to actually fire yet (auto-firing is
# a separate, opt-in step so we can't spam the channel before you sign off).
_AUTO_PUSH_CFG = {
    "enabled": False,            # master switch — auto-fire is OFF until turned on
    "alpha_gold": True,          # push Alpha Gold tier
    "grade_a": True,             # push grade A / A+
    "size_sweep_enabled": False, # optional: high-premium Size B sweeps
    "size_min_premium": 3_000_000,
    "accum_enabled": False,       # push accumulations (By-Contract) — OFF 2026-07-21 (too noisy; two-way contracts mislabeled). Re-enable in the auto-push panel.
    "accum_min_premium": 3_000_000,  # accumulation premium floor
    # Net-flow cleanliness gate (2026-07-21): only auto-push when the
    # CONTRACT's directional premium is >= this fraction one-sided (dominant
    # side / total directional). A big print on a two-way tape (MU $1190P:
    # mixed bid/ask puts, ~50/50) won't fire. 0 disables. Only as reliable
    # as the per-print side reads (fresh-NBBO accuracy makes it meaningful).
    "min_directional_ratio": 0.67,
    # ── Time gates (2026-07-15). Runtime-tunable; both off == prior behaviour.
    "market_hours_only": True,    # never fire outside 9:30-16:00 ET, Mon-Fri
    "max_alert_age_sec": 600,     # single: don't fire a print older than 10 min
    "accum_max_age_sec": 0,       # accumulation: 0 = OFF (see _push_window_ok)
}


_AUTO_PUSH_CFG_FILE = os.path.join(os.path.dirname(DB_PATH), "auto_push_config.json")


def _load_auto_push_cfg():
    """Load persisted auto-push config (survives restarts); falls back to the
    conservative in-code defaults if the file is missing/corrupt."""
    try:
        with open(_AUTO_PUSH_CFG_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict):
            _AUTO_PUSH_CFG.update({k: data[k] for k in _AUTO_PUSH_CFG if k in data})
    except Exception:
        pass


_load_auto_push_cfg()


def _is_repeater(alert: dict) -> bool:
    """A GENUINE consistent repeat accumulator — a sustained shape AND a real hit
    count. NOT 'active on 2 days' (days_active>1 over a multi-day lookback flags
    almost everything and floods auto-push). A steady/accelerating shape with
    qualifying_hits>=3 is true repeatability."""
    shape = (alert.get("accumulation_shape") or "").lower()
    return shape in ("steady", "accelerating") and (alert.get("qualifying_hits") or 0) >= 3


def _alert_age_sec(alert: dict, mode: str = "single") -> float | None:
    """Seconds between the alert's own event time and now. None when it carries
    no usable timestamp — callers ABSTAIN rather than block, since a missing
    timestamp is a data gap, not evidence of staleness."""
    ts = alert.get("last_ts") if mode == "accumulation" else alert.get("timestamp")
    if not ts:
        ts = alert.get("timestamp") or alert.get("last_ts")
    try:
        return time.time() - float(ts)
    except (TypeError, ValueError, OSError):
        return None


def _push_window_ok(alert: dict, mode: str, cfg: dict) -> bool:
    """Time-window guards. Independent of alert QUALITY — should_auto_push
    decides WHAT qualifies, this decides WHEN it may fire.

    Prevents two failures, both from auto-push being scan-triggered (a scan only
    happens on a page view or a scheduler tick):
      1) OFF-HOURS FLUSH — 7/15: nothing fired all afternoon (laptop asleep),
         then a browser opened at 8:06 PM ET and pushed the day's backlog at once.
      2) IN-SESSION STALE FLUSH — same mechanism inside market hours (asleep
         10:00-14:00, opened at 14:00 -> 10:00 AM prints fire 4h late). The
         market-hours gate can't catch that one; the age gate can.

    Still required once the scheduler exists: flow-worker restarted 5x on 7/15,
    and a scheduler would otherwise flush its own backlog on every boot.

    ACCUMULATION AGE (accum_max_age_sec default 0 = off): a multi-day
    accumulator's last_ts can legitimately be days old — it's a rollup over a
    lookback window, so "recent hit" != "recent event". A 10-min gate would block
    every genuine multi-day build. market_hours_only still covers accumulations.
    """
    if cfg.get("market_hours_only", True) and not _in_market_hours():
        return False

    # SAME-SESSION GATE (2026-07-18): an accumulation may auto-push ONLY if its
    # most recent qualifying hit (last_ts) is from the CURRENT trading session.
    #
    # THE BUG: accumulation = YELLOW = cumulative vol > OI. Contracts that
    # accumulated into yesterday's close but didn't fire before 16:00 sit in
    # flow.db still-unclaimed. At the next open the first scan finds them and
    # blasts them out — the SNDK/AAPL/MU cards stamped 9:31 AM ET whose events
    # were "Yesterday at 3:5x PM". That's a stale re-push with no new info.
    #
    # WHY NOT just drop the contract for the day: the next-day flow on that SAME
    # contract is the signal that tells you whether they're ADDING or TAKING
    # PROFIT. So we must NOT blacklist the contract — we only block firing on a
    # PRIOR-SESSION event. The moment the contract prints again today, last_ts
    # advances into today's session and it fires on that fresh event — which is
    # exactly the add/distribute follow-through worth alerting.
    #
    # So this gates on the EVENT TIME, not the contract. Prior-session last_ts →
    # mark-only (never fire). Today's-session last_ts → fires. A missing
    # timestamp ABSTAINS (doesn't block) — a data gap isn't evidence of
    # staleness. Config: accum_same_session_only (default True); set False to
    # restore the old always-fire behavior.
    if mode == "accumulation" and cfg.get("accum_same_session_only", True):
        _lt = alert.get("last_ts") or alert.get("timestamp")
        if _lt:
            try:
                _hit = datetime.fromtimestamp(float(_lt), tz=ET)
                _now = datetime.now(ET)
                # Session open for the CURRENT calendar day in ET. Before 9:30 the
                # "current session" is still today's upcoming open, so a hit from
                # yesterday is correctly prior-session. (No holiday calendar; a
                # holiday simply has no flow to fire.)
                _session_open = _now.replace(hour=9, minute=30, second=0, microsecond=0)
                if _hit < _session_open:
                    return False   # prior-session event — mark-only, don't re-blast
            except (TypeError, ValueError, OSError):
                pass  # unparseable ts → abstain (don't block on a data gap)

    max_age = (cfg.get("accum_max_age_sec", 0) if mode == "accumulation"
               else cfg.get("max_alert_age_sec", 600))
    if max_age:
        age = _alert_age_sec(alert, mode)
        if age is not None and age > max_age:
            return False
    return True


def should_auto_push(alert: dict, cfg: dict = None) -> bool:
    """Decide whether an alert qualifies for auto-push under the current algo.

    Single prints: Alpha Gold tier, or grade A/A+ (+ optional high-premium Size
    sweeps). Accumulations (By-Contract): total premium >= accum_min_premium AND
    an EFFECTIVE grade of A/A+ — where a genuine multi-day REPEATER gets a
    one-grade upgrade (a B repeater at $3M+ becomes an A and fires). Consistency +
    repeatability + size is the tell."""
    if cfg is None:
        cfg = _AUTO_PUSH_CFG
    # Stocks-only for now: index products and (leveraged) ETFs are source="indexes"
    # (SPX, NDX, QQQ, SOXL, VIX, GDX...). They need their own higher floors we
    # haven't wired, so they're excluded from auto-push entirely — matching the
    # single-name flow you curate by hand.
    if (alert.get("source") or "stocks") == "indexes":
        return False
    tier = (alert.get("_tierKey") or "").lower()
    grade = (alert.get("grade") or "").upper()
    name = (alert.get("alertName") or "").lower()

    # Never auto-push a direction-unconfirmed "UCT Size" print (2026-07-21):
    # keep-as-Size surfaces big prints whose side we couldn't trust (deep-ITM,
    # ambiguous at-bid 'B', stale/blank NBBO). They belong in the FEED, but a
    # neutral "big, direction unknown" print is not a Bull/Bear signal to blast
    # to Discord. Directional Size (UCT Size Bulls/Bears) is unaffected. Manual
    # force-push is unaffected (this gates auto-push only).
    if alert.get("_directionUnconfirmed") or "not clean" in name:
        return False

    # ── Single-print tiers ──
    if cfg.get("alpha_gold") and (tier == "alpha" or "alpha gold" in name):
        return True
    if cfg.get("grade_a") and grade in ("A+", "A"):
        return True
    if cfg.get("size_sweep_enabled"):
        prem = alert.get("alertPremium") or 0
        typ = (alert.get("_type") or alert.get("alertType") or "").upper()
        if tier == "size" and grade == "B" and prem >= cfg.get("size_min_premium", 3_000_000) and typ == "SWEEP":
            return True

    # ── Accumulation (By-Contract): premium floor + repeatability upgrade ──
    acc_grade = (alert.get("accumulation_grade") or "").upper()
    if cfg.get("accum_enabled") and acc_grade:
        total_prem = alert.get("total_premium") or 0
        if total_prem >= cfg.get("accum_min_premium", 3_000_000):
            eff = acc_grade
            # Consistency + size elevates conviction, but only a B base rides the
            # repeater upgrade to A. A C/D accumulation shouldn't auto-push on
            # repeatability alone.
            if eff == "B" and _is_repeater(alert):
                eff = "A"
            if eff in ("A+", "A"):
                return True
    return False


def _unclaim_push(alert: dict):
    """Remove an AUTO claim so a failed push retries next scan. Never deletes a
    manual record."""
    try:
        conn = _pushed_conn()
        conn.execute("DELETE FROM pushed_alerts WHERE push_key=? AND source='auto'", (_push_key(alert),))
        conn.commit()
        conn.close()
    except Exception:
        pass


def _flow_direction(cp: str, side: str):
    """Directional implication of a print for NET-FLOW math — INCLUDES at-bid
    'B' (unlike _derive_direction, which drops it as too ambiguous to ALERT on).
    For measuring whether a contract is one-sided, at-bid selling IS real
    directional flow: a put sold at the bid is bullish, a call sold is bearish.
    Counting it (2026-07-21) stops strict-B dropping from bear-biasing the split
    on put-heavy contracts — MU $1190P read 80% bear classified vs 54% real."""
    s = (side or "").strip().upper()
    c = (cp or "").strip().upper()
    if s in ("A", "AA"):
        bought = True
    elif s in ("B", "BB"):
        bought = False
    else:
        return None
    if c in ("C", "CALL"):
        return "Bull" if bought else "Bear"
    if c in ("P", "PUT"):
        return "Bear" if bought else "Bull"
    return None


def _net_flow_clean(alert: dict, flow_split: dict, min_ratio: float) -> bool:
    """True only when the CONTRACT's directional flow is cleanly one-sided in the
    alert's direction. A big ask-side print on a two-way tape (both Bull and Bear
    premium heavy — e.g. MU $1190P's mixed bid/ask puts) fails; a genuinely
    one-directional contract (e.g. NFLX 8/21, dominated by one ask sweep) passes.
    Requires the dominant side's premium >= min_ratio of total directional premium
    AND that dominant side to match the alert's direction. Direction-less prints
    never pass. Only as good as the per-print side reads feeding flow_split."""
    d = (alert.get("_direction") or "").strip()
    if d not in ("Bull", "Bear"):
        return False
    key = (f"{alert.get('ticker','')}|{alert.get('cp','')}|"
           f"{alert.get('strike','')}|{alert.get('exp','')}")
    fs = flow_split.get(key)
    if not fs:
        return False
    bull = fs.get("Bull", 0.0)
    bear = fs.get("Bear", 0.0)
    total = bull + bear
    if total <= 0:
        return False
    dominant = "Bull" if bull >= bear else "Bear"
    return dominant == d and (max(bull, bear) / total) >= min_ratio


def _demote_two_way_flow(alerts: list) -> None:
    """Demote directional prints on TWO-WAY contracts to neutral "UCT Size" —
    in place. A contract whose OWN net flow (inclusive of at-bid selling) is
    < net_flow_min_ratio one-sided isn't a directional signal (MU $1190P ~54/46),
    so its Bull/Bear prints become neutral: drops the misleading label AND (since
    the Market-Read + feed both skip _direction=None) keeps it out of the bull/bear
    math. Shared by _compute_recent (feed) and the market read. 0 disables.
    Idempotent — the split reads _side, so re-running is safe. GIGO: only as good
    as the per-print side reads (deep-ITM/stale inflate — pairs w/ staleness)."""
    try:
        ratio = float(_load_thresholds().get("net_flow_min_ratio", 0.67) or 0)
    except Exception:
        ratio = 0.67
    if ratio <= 0 or not alerts:
        return
    nf = {}
    for a in alerts:
        fd = _flow_direction(a.get("cp"), a.get("_side"))
        if fd in ("Bull", "Bear"):
            k = f"{a.get('ticker','')}|{a.get('cp','')}|{a.get('strike','')}|{a.get('exp','')}"
            e = nf.setdefault(k, {"Bull": 0.0, "Bear": 0.0})
            e[fd] += (a.get("alertPremium") or 0)
    for a in alerts:
        d = (a.get("_direction") or "").strip()
        if d not in ("Bull", "Bear"):
            continue
        k = f"{a.get('ticker','')}|{a.get('cp','')}|{a.get('strike','')}|{a.get('exp','')}"
        fs = nf.get(k)
        if not fs:
            continue
        tot = fs["Bull"] + fs["Bear"]
        if tot <= 0:
            continue
        dom = "Bull" if fs["Bull"] >= fs["Bear"] else "Bear"
        if (max(fs["Bull"], fs["Bear"]) / tot) < ratio or d != dom:
            a["_direction"] = None
            a["_directionUnconfirmed"] = True
            a["alertName"] = "UCT Size - Not Clean"
            a["_tierKey"] = "size"


def _apply_auto_push(alerts: list, mode: str = "single", live: bool = True):
    """Per-scan auto-push pass, run on the FULL alert set in /recent:
      1) mark forwardedToDiscord on every alert already in the push log — so
         POSTED survives a refresh and shows in the non-admin view;
      2) if the master switch is on AND `live`, claim + fire any newly-
         qualifying alert.

    `live` (added 2026-07-14): False when the caller is rendering a HISTORICAL
    date. Browsing back to an older day used to fire that whole day's
    qualifiers to Discord as new — _push_key is contract+day, so a day that
    predates auto-push had never been claimed and every qualifier blasted out
    on view. Historical scans now MARK ONLY (step 1); they never claim or fire.
    The claim (atomic INSERT via _record_push) is the dedup gate, so concurrent
    /recent polls can never double-send. Discord POSTs run in a daemon thread so
    /recent never blocks; a failed POST un-claims so it retries next scan."""
    try:
        pushed = _pushed_keys()
    except Exception:
        pushed = set()
    # Single prints must ALSO clear the curated cap-tiered premium floors, so a
    # grade-A print that never cleared its market-cap floor (e.g. $500K on a mega)
    # does not auto-fire — while the same $500K in a small-cap, which DOES clear
    # its floor, can. The curated gate already encodes cap-vs-premium; auto-push
    # inherits it. Accumulations use their own accum_min_premium floor instead.
    curated_ok = None
    if mode == "single":
        try:
            _thr = _load_thresholds()
            _ct = {}
            for _a in alerts:
                _k = f"{_a.get('ticker','')}|{_a.get('cp','')}|{_a.get('strike','')}|{_a.get('exp','')}"
                _ct[_k] = _ct.get(_k, 0) + (_a.get("alertPremium") or 0)
            curated_ok = lambda a: _qualifies_curated(a, _thr, contract_totals=_ct)
        except Exception:
            curated_ok = None
    enabled = bool(_AUTO_PUSH_CFG.get("enabled")) and live
    # Net-flow split per contract (2026-07-21): directional premium by side, so we
    # only fire on cleanly one-directional contracts. Direction-less prints don't
    # count toward either side.
    _flow = {}
    for _fa in alerts:
        # INCLUSIVE flow direction (counts at-bid selling), NOT the alert's
        # _direction (which drops at-bid) — so the cleanliness split reflects the
        # TRUE two-sided flow instead of a strict-B bear bias (MU: 80%→54% bear).
        _fd = _flow_direction(_fa.get("cp"), _fa.get("_side"))
        if _fd in ("Bull", "Bear"):
            _fk = f"{_fa.get('ticker','')}|{_fa.get('cp','')}|{_fa.get('strike','')}|{_fa.get('exp','')}"
            _fs = _flow.setdefault(_fk, {"Bull": 0.0, "Bear": 0.0})
            _fs[_fd] += (_fa.get("alertPremium") or 0)
    _min_ratio = float(_AUTO_PUSH_CFG.get("min_directional_ratio", 0.67) or 0)
    to_push = []
    for a in alerts:
        try:
            key = _push_key(a)
        except Exception:
            continue
        if key in pushed:
            a["forwardedToDiscord"] = True
            continue
        if (enabled and should_auto_push(a)
                and (_min_ratio <= 0 or _net_flow_clean(a, _flow, _min_ratio))
                and _push_window_ok(a, mode, _AUTO_PUSH_CFG)):
            if curated_ok is not None and not curated_ok(a):
                continue   # conviction match, but failed its cap-tier curated floor
            if _record_push(a, mode, "auto"):           # atomic claim
                a["forwardedToDiscord"] = True
                to_push.append(a)
    if to_push:
        def _fire(batch):
            for a in batch:
                try:
                    ok, _ = _post_massive_discord(_build_massive_embed(a, mode=mode))
                    if not ok:
                        _unclaim_push(a)
                except Exception:
                    _unclaim_push(a)
        threading.Thread(target=_fire, args=(list(to_push),), daemon=True).start()
    return alerts


# ─── Server-side auto-push scanners (2026-07-15) ──────────────────────────
# Auto-push was hooked into the scan paths (/recent, /by-contract) because those
# already produced a classified alert set. The consequence surfaced 7/15: no
# viewer means no scan means no push. Accumulations were worse — they only ever
# fired while the By-Contract tab was open.
#
# These are called by flow-worker's APScheduler (see flow_worker_main). They
# reuse the exact scan+push paths the routes use, so there's no second copy of
# the push logic to drift. Registered ONLY on flow-worker, which owns flow.db
# and serves /api/live/massive/* — web must NOT run them: the two pods have
# SEPARATE pushed.db files, so a double scanner would double-post rather than
# dedup (_record_push's INSERT OR IGNORE only guards within one file).

def auto_push_scan_single():
    """Timer-driven single-print scan. _compute_recent calls _apply_auto_push
    internally on the FULL classified set (before the [:limit] trim), so `limit`
    here doesn't affect what fires — it only bounds the response we discard."""
    if not _AUTO_PUSH_CFG.get("enabled") or not _in_market_hours():
        return
    _compute_recent(_today_mdyyyy(), 500, None, "recent", None, True)


def auto_push_scan_accum():
    """Timer-driven accumulation scan.

    Params mirror what LiveFlowMassive.jsx sends (min_hits=3, lookback_days=3,
    exclude_algo defaulted True) so the scheduler evaluates the SAME contract set
    the radar displays. stock_etf="stocks" because should_auto_push excludes
    source="indexes" outright — scanning them would be pure cost.

    Respects _by_contract_lock (single-flight): if a route-triggered build is
    already running it will fire the pushes itself, so we skip rather than pay
    for a second 30s+ rollup. Warms the route cache on success.
    """
    if not _AUTO_PUSH_CFG.get("enabled") or not _in_market_hours():
        return
    today = _today_mdyyyy()
    key = (today, "stocks", 3, True, 3)
    if not _by_contract_lock.acquire(blocking=False):
        return  # route build in flight; it fires its own pushes
    try:
        payload = _build_by_contract(today, "stocks", 3, True, 3)
        _apply_auto_push(payload.get("contracts", []), mode="accumulation", live=True)
        _by_contract_cache[key] = (time.time(), payload)
    finally:
        _by_contract_lock.release()


@router.post("/force-push-discord")
def force_push_discord(
    id: int = Query(None, description="flow.db row id for a single-print push"),
    ticker: str = Query(None),
    cp: str = Query(None),
    strike: str = Query(None),
    exp: str = Query(None),
    target_date: str = Query(None),
    mode: str = Query("single", description="'single' or 'accumulation'"),
    lookback_days: int = Query(3, ge=1, le=5, description="Accumulation lookback window for finding the contract (matches the radar)."),
    _auth: dict = Depends(require_flow_admin),
):
    """Manual override: push a Massive alert to Discord, bypassing all auto-fire
    gates (like LiveFlow's force-push). Two modes:
      • single       — ?id=<row>          push one tape print
      • accumulation — ?ticker&cp&strike&exp&target_date  push the contract rollup
    """
    try:
        if mode == "accumulation":
            if not all([ticker, cp, strike, exp, target_date]):
                raise HTTPException(400, "accumulation mode needs ticker, cp, strike, exp, target_date")
            se = "all"
            # Use a lookback window (default 3d) so multi-day accumulators are
            # found the same way the radar surfaces them — a contract flagged for
            # its 3-day build won't necessarily clear min_hits on the target day
            # alone (that was the "contract not found" 404).
            payload = _build_by_contract(target_date, se, 1, False, int(lookback_days))
            cpU = cp.strip().upper()[:1]
            def _strike_eq(a, b):
                try:
                    return abs(float(a) - float(str(b).strip().lstrip("$"))) < 1e-6
                except (TypeError, ValueError):
                    return str(a).strip() == str(b).strip().lstrip("$")
            match = next(
                (c for c in payload.get("contracts", [])
                 if c.get("ticker") == ticker.strip().upper()
                 and (c.get("cp") or "").upper() == cpU
                 and _strike_eq(c.get("strike"), strike)
                 and _exp_us(c.get("exp")) == _exp_us(exp)),
                None,
            )
            if not match:
                raise HTTPException(404, f"contract not found in rollup for {target_date}")
            embed = _build_massive_embed(match, mode="accumulation")
        else:
            if id is None:
                raise HTTPException(400, "single mode needs id")
            conn = sqlite3.connect(DB_PATH, timeout=10)
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute("SELECT * FROM flow WHERE id = ?", (id,)).fetchone()
            finally:
                conn.close()
            if not row:
                raise HTTPException(404, f"row id {id} not found")
            alert = _row_to_alert(dict(row), require_direction=False)
            if alert is None:
                raise HTTPException(422, "row could not be built into an alert (filtered as noise)")
            embed = _build_massive_embed(alert, mode="single")

        ok, detail = _post_massive_discord(embed)
        if ok:
            # Persist the push so POSTED survives refresh + shows in the non-admin
            # view, and so auto-push later won't duplicate a manually-pushed contract.
            _record_push(match if mode == "accumulation" else alert, mode, "manual")
        return {"ok": ok, "detail": detail, "mode": mode}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        return {"ok": False, "error": str(e), "traceback": traceback.format_exc().splitlines()[-3:]}


@router.get("/pushed")
def get_pushed(alert_date: str = Query(None, description="alert_date to filter (defaults to all recent)")):
    """Read-only list of alerts pushed to Discord (manual + auto). Feeds the
    non-admin 'what was pushed' view and replaces the old session-only state."""
    try:
        conn = _pushed_conn()
        conn.row_factory = sqlite3.Row
        if alert_date:
            rows = conn.execute("SELECT * FROM pushed_alerts WHERE alert_date=? ORDER BY pushed_at DESC", (alert_date,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM pushed_alerts ORDER BY pushed_at DESC LIMIT 500").fetchall()
        conn.close()
        return {"ok": True, "count": len(rows), "pushed": [dict(r) for r in rows]}
    except Exception as e:
        return {"ok": False, "error": str(e), "pushed": []}


@router.get("/auto-push-config")
def get_auto_push_config():
    """Current auto-push algo config (for the admin toggle UI)."""
    return {"ok": True, "config": dict(_AUTO_PUSH_CFG)}


@router.post("/auto-push-config")
async def set_auto_push_config(request: Request, _auth: dict = Depends(require_flow_admin)):
    """Admin: update + persist the auto-push config (master switch + thresholds).
    Whitelisted keys only; persisted to disk so it survives restarts."""
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(400, f"Invalid JSON: {e}")
    if not isinstance(body, dict):
        raise HTTPException(400, "expected a JSON object")
    for k in ("enabled", "alpha_gold", "grade_a", "size_sweep_enabled", "size_min_premium", "accum_enabled", "accum_min_premium"):
        if k in body:
            _AUTO_PUSH_CFG[k] = body[k]
    try:
        with open(_AUTO_PUSH_CFG_FILE, "w") as f:
            json.dump(_AUTO_PUSH_CFG, f)
    except Exception as e:
        return {"ok": False, "error": str(e), "config": dict(_AUTO_PUSH_CFG)}
    return {"ok": True, "config": dict(_AUTO_PUSH_CFG)}


@router.post("/thresholds")
async def save_thresholds(request: Request, _auth: dict = Depends(require_flow_admin)):
    """Admin: persist new Curated-mode thresholds. Validates shape lightly
    then atomic-swaps the JSON file. Invalidates server-side cache so the
    next /recent poll picks up the new values."""
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(400, f"Invalid JSON: {e}")
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object")
    # Basic shape validation — top-level keys we accept
    allowed_top = {
        "stack", "premium_by_cap", "unusual", "cap_bands", "premium_override",
        "etf_enabled",               # 7/7: admin gate for source='indexes' pipeline
        "etf_premium_floors",        # 7/7: ETF-specific tier premium floors
        "etf_unusual",               # 7/7: ETF-specific Unusual tier thresholds
        # Alpha Gold quality gates (added 6/29-6/30)
        "alpha_max_itm_pct",         # deep-ITM filter threshold (Alpha only)
        "alpha_min_vol_oi_ratio",    # vol > OI fresh-positioning gate
        "alpha_exclude_block_type",  # BLOCK trades excluded from Alpha Gold
        "alpha_max_weekly_dte",      # 7/8: short-dated (weekly) exclusion from Alpha
        "max_itm_pct",               # global deep-ITM filter (drops entirely)
        "size_min_vol_oi_ratio",     # vol > OI gate for Size tier
        "derive_strict_bid_only_bb", # B alone is ambiguous, only BB counts as bid-side
        # 2026-07-16: was MISSING from this whitelist since the flag was added
        # on 7/3, so a POST containing it 400'd and the flag could never be
        # anything but its `.get(..., True)` default. Its sibling
        # derive_strict_bid_only_bb was here from the start — plain oversight.
        #
        # Why it matters: the flag presumes ASK for blank-side SWEEPs on the
        # docstring's claim that sweeps are "~85%+ buyer-initiated". Measured
        # against flow.db on 7/15 (n=21,161) and 7/16 (n=8,352): 50%. A coin
        # flip, at every premium bucket. ~2,399 alerts/day carry an invented
        # direction — e.g. AMAT 9/18 $400P on 7/16 went out as "Size Bears" on
        # a print the reference tape shows filled at the BID.
        "sweep_empty_side_as_ask",   # presume ASK for blank-side SWEEPs (see above)
        "fresh_strike_min_volume",   # min volume to promote OI=0 fresh strikes
        "bullish_bearish_min_vol_oi_ratio",  # V/OI gate for catchall tier
        "leaps_min_vol_oi_ratio",    # V/OI gate for LEAPS tier
        # 2026-07-23: the four side-classification / net-flow tunables added on
        # 7/21 were put into DEFAULT_THRESHOLDS and wired into the logic, but
        # never added HERE — so any admin-panel save that included them 400'd
        # with "Unknown keys" and rejected the WHOLE payload, meaning no
        # threshold change of any kind could be saved. Same oversight class as
        # sweep_empty_side_as_ask above (missing 7/3 → 7/16).
        "direction_max_itm_pct",     # deep-ITM cap above which direction is dropped
        "keep_sizeless_min_premium", # premium floor to keep a direction-less print as neutral Size
        "net_flow_min_ratio",        # feed-side two-way-flow demote threshold
        "hide_sizeless",             # hide direction-unconfirmed rows from curated
        "spotless_itm_guard",        # fail closed on deep-ITM when spot is missing
    }
    bad_keys = set(body.keys()) - allowed_top
    if bad_keys:
        raise HTTPException(400, f"Unknown keys: {sorted(bad_keys)}")
    if not _save_thresholds(body):
        raise HTTPException(500, "Failed to save thresholds")
    return {"ok": True, "thresholds": _load_thresholds()}


@router.post("/thresholds/reset")
def reset_thresholds(_auth: dict = Depends(require_flow_admin)):
    """Admin: revert to compiled-in defaults (wipes the saved file)."""
    try:
        if os.path.exists(_THRESHOLDS_PATH):
            os.remove(_THRESHOLDS_PATH)
        global _thresholds_cache
        _thresholds_cache = None
        return {"ok": True, "thresholds": _load_thresholds()}
    except Exception as e:
        raise HTTPException(500, f"Failed to reset: {e}")


# ─── Dormant ticker admin endpoints ───────────────────────────────────────
# Used to manage the dormant-ticker precompute that powers the true Unusual
# classification. Trigger from browser address bar / fetch() in console —
# no terminal cron in user's workflow, so manual trigger is the norm. Aim
# for once-nightly cadence; data is stable through the trading day.

@router.get("/dormant-status")
def dormant_status():
    """Show metadata about the current dormant-ticker dataset."""
    _load_dormant_tickers()
    if _dormant_cache is None or not _dormant_active_set:
        return {
            "ok": False,
            "has_data": False,
            "message": (
                "No dormant data computed yet. Unusual classification is using "
                "legacy V/OI-only fallback. Run POST /recompute-dormant to build it."
            ),
            "path": _DORMANT_PATH,
        }
    return {
        "ok": True,
        "has_data": True,
        "computed_at": _dormant_cache.get("computed_at"),
        "lookback_trading_days": _dormant_cache.get("lookback_trading_days"),
        "earliest_date": _dormant_cache.get("earliest_date"),
        "today_date": _dormant_cache.get("today_date"),
        "active_count": _dormant_cache.get("active_count"),
        "total_alerts_scanned": _dormant_cache.get("total_alerts_scanned"),
        "sample_active": _dormant_cache.get("active_tickers", [])[:30],
        "path": _DORMANT_PATH,
    }


@router.post("/recompute-dormant")
def recompute_dormant(
    lookback: int = Query(default=30, ge=1, le=365, description="Trading days to look back"),
    _auth: dict = Depends(require_flow_admin),
):
    """Admin: scan FlowDB and recompute the active-tickers set. Writes the
    result to /data/dormant_tickers.json (atomic swap) and invalidates the
    in-memory cache so the next classification picks up new values.

    Heavy operation — does a full DB scan over the lookback window. Expected
    runtime: 1-5 seconds depending on FlowDB size. Safe to call during
    market hours but ideally run nightly after close.
    """
    try:
        data = _compute_active_tickers(lookback_days=lookback)
    except Exception as e:
        raise HTTPException(500, f"Compute failed: {e}")

    try:
        os.makedirs(os.path.dirname(_DORMANT_PATH), exist_ok=True)
        tmp = _DORMANT_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, _DORMANT_PATH)  # atomic swap
    except Exception as e:
        raise HTTPException(500, f"Failed to write dormant file: {e}")

    # Invalidate cache so next read picks up new file
    global _dormant_cache, _dormant_active_set, _dormant_loaded_mtime
    _dormant_cache = None
    _dormant_active_set = None
    _dormant_loaded_mtime = 0

    # Force reload to populate cache with new data
    _load_dormant_tickers()

    return {
        "ok": True,
        "computed_at": data["computed_at"],
        "lookback_trading_days": data["lookback_trading_days"],
        "earliest_date": data["earliest_date"],
        "today_date": data["today_date"],
        "active_count": data["active_count"],
        "total_alerts_scanned": data["total_alerts_scanned"],
        "sample_active": data["active_tickers"][:30],
    }



@router.get("/contract-debug")
def contract_debug(
    ticker: str = Query(..., description="Underlying symbol, e.g. 'SNDK'"),
    cp: str = Query(..., description="'C' or 'P' (case-insensitive)"),
    strike: str = Query(..., description="Strike price (any reasonable format)"),
    exp: str = Query(..., description="Expiration date M/D/YYYY"),
    target_date: str = Query(default=None, description="Trading date M/D/YYYY (default today)"),
):
    """Diagnostic: return ALL FlowDB rows for a specific contract on a given
    day, regardless of Color. Hardened to never 500 — wraps each row's
    classification in try/except and reports diagnostics for any failure.

    Use case: "why didn't I see X on /live-massive?" Returns enough raw
    detail to answer that without needing to query the DB directly.
    """
    debug = {"stage": "init", "errors": []}
    try:
        today = target_date or _today_mdyyyy()
        debug["query_date"] = today

        # Normalize cp
        cp_norm = (cp or "").strip().upper()
        if cp_norm in ("C", "CALL"):
            cp_long = "CALL"
        elif cp_norm in ("P", "PUT"):
            cp_long = "PUT"
        else:
            return {"error": f"cp must be C/CALL/P/PUT, got {cp!r}", "debug": debug}

        # Build many strike candidates — DB stores Strike as TEXT in various
        # formats depending on source ("$2050", "2050.0", "2050", etc.)
        strike_str = str(strike).strip().lstrip("$").strip()
        try:
            strike_float = float(strike_str)
        except ValueError:
            return {"error": f"strike not parseable: {strike!r}", "debug": debug}
        is_whole = strike_float.is_integer()
        strike_int = int(strike_float) if is_whole else None

        candidates = set()
        candidates.add(strike_str)
        candidates.add(f"${strike_str}")
        candidates.add(str(strike_float))
        candidates.add(f"${strike_float}")
        if strike_int is not None:
            candidates.add(str(strike_int))
            candidates.add(f"${strike_int}")
            candidates.add(f"{strike_int}.0")
            candidates.add(f"${strike_int}.0")
        candidates = list(candidates)
        debug["strike_candidates"] = candidates

        debug["stage"] = "sql_query"
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            conn.row_factory = sqlite3.Row
            placeholders = ",".join("?" for _ in candidates)
            cur = conn.execute(f"""
                SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price,
                       Side, CallPut, Strike, Spot, Premium, ExpirationDate, Color,
                       Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI
                  FROM flow
                 WHERE source = 'stocks'
                   AND CreatedDate = ?
                   AND Symbol = ?
                   AND CallPut = ?
                   AND Strike IN ({placeholders})
                   AND ExpirationDate = ?
                 ORDER BY id ASC
            """, [today, ticker.upper(), cp_long, *candidates, exp])
            rows = [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
        debug["row_count_strict"] = len(rows)

        # If strict match returns nothing, do a forgiving second query: same
        # symbol + cp + date, no strike/exp filter. Helps diagnose strike-
        # format mismatches and shows what IS in the DB for that ticker.
        loose_rows = []
        if not rows:
            debug["stage"] = "sql_loose_query"
            conn = sqlite3.connect(DB_PATH, timeout=10)
            try:
                conn.row_factory = sqlite3.Row
                cur = conn.execute("""
                    SELECT id, CreatedTime, Symbol, CallPut, Strike, ExpirationDate,
                           Color, Side, Volume, Premium, OI
                      FROM flow
                     WHERE source = 'stocks'
                       AND CreatedDate = ?
                       AND Symbol = ?
                       AND CallPut = ?
                     ORDER BY id ASC
                     LIMIT 50
                """, [today, ticker.upper(), cp_long])
                loose_rows = [dict(r) for r in cur.fetchall()]
            finally:
                conn.close()
            debug["row_count_loose_same_ticker_cp"] = len(loose_rows)

        # Per-row classification (try/except so one bad row doesn't kill it)
        debug["stage"] = "classify_rows"
        summary = {
            "total_rows": len(rows),
            "by_color": {},
            "by_side": {},
            "would_show_in_live_massive_count": 0,
            "max_oi_seen": 0,
            "total_volume": 0,
            "total_premium": 0,
        }
        detailed = []
        for r in rows:
            try:
                color = r.get("Color") or "(none)"
                side = r.get("Side") or "(none)"
                summary["by_color"][color] = summary["by_color"].get(color, 0) + 1
                summary["by_side"][side] = summary["by_side"].get(side, 0) + 1
                vol = _parse_int(r.get("Volume"))
                prem = _parse_int(r.get("Premium"))
                oi = _parse_int(r.get("OI"))
                summary["total_volume"] += vol
                summary["total_premium"] += prem
                if oi > summary["max_oi_seen"]:
                    summary["max_oi_seen"] = oi
                v_oi = round(vol / oi, 2) if oi > 0 else None

                # Try classify
                a = None
                tier = grade = None
                try:
                    a = _row_to_alert(r)
                    if a:
                        tier = a.get("_tierKey")
                        grade = a.get("grade")
                except Exception as e:
                    debug["errors"].append(f"row {r.get('id')} classify error: {e}")

                in_live_massive = (a is not None) and color in ("MAGENTA", "YELLOW")
                if in_live_massive:
                    summary["would_show_in_live_massive_count"] += 1

                why_filtered = None
                if not in_live_massive:
                    if color == "WHITE":
                        why_filtered = "Color=WHITE (cum_vol/OI ratio < 1.0)"
                    elif color not in ("MAGENTA", "YELLOW", "WHITE"):
                        why_filtered = f"Color={color!r}"
                    elif a is None:
                        why_filtered = "Side unclassifiable or unknown direction"

                detailed.append({
                    "id": r.get("id"),
                    "time": r.get("CreatedTime"),
                    "color": r.get("Color"),
                    "side": r.get("Side"),
                    "volume": vol,
                    "price": r.get("Price"),
                    "premium": prem,
                    "oi": oi,
                    "v_oi": v_oi,
                    "spot": r.get("Spot"),
                    "type": r.get("Type"),
                    "strike_in_db": r.get("Strike"),
                    "tier": tier,
                    "grade": grade,
                    "would_show_in_live_massive": in_live_massive,
                    "why_filtered": why_filtered,
                })
            except Exception as e:
                debug["errors"].append(f"row {r.get('id')} outer error: {e}")

        debug["stage"] = "done"

        # Interpretation hint
        if not rows and not loose_rows:
            interp = "No rows for this ticker+cp+date at all. Worker did not capture, or symbol/date mismatch."
        elif not rows and loose_rows:
            interp = (
                "Strike/exp filter excluded all rows BUT the ticker+cp DOES have rows today. "
                "See `loose_match_sample` for actual Strike/ExpirationDate values stored — "
                "your input likely has a format mismatch."
            )
        else:
            mag_yel = sum(summary["by_color"].get(c, 0) for c in ("MAGENTA", "YELLOW"))
            white = summary["by_color"].get("WHITE", 0)
            if summary["would_show_in_live_massive_count"] > 0:
                interp = f"Yes, {summary['would_show_in_live_massive_count']} rows would show in /live-massive."
            elif white > 0 and mag_yel == 0:
                interp = (
                    f"Captured {white} rows but all classified Color=WHITE. The cum_vol/OI "
                    f"ratio never reached 1.0× — Massive's classifier filters these out."
                )
            else:
                interp = "Captured but filtered. See per-row why_filtered."

        return {
            "query": {
                "date": today, "ticker": ticker.upper(), "cp": cp_long,
                "strike": strike, "exp": exp,
            },
            "summary": summary,
            "rows": detailed,
            "loose_match_sample": loose_rows[:20] if not rows else None,
            "interpretation": interp,
            "debug": debug,
        }

    except Exception as e:
        import traceback
        debug["errors"].append(f"top-level: {type(e).__name__}: {e}")
        debug["traceback"] = traceback.format_exc().split("\n")[-15:]
        return {"error": str(e), "debug": debug}


@router.get("/side-diagnostic")
def side_diagnostic(target_date: str = Query(default=None, description="Trading date M/D/YYYY (default today)")):
    """Diagnose unclassified-Side rate. Returns breakdown of Side values
    across today's MAGENTA/YELLOW rows + sample of unclassified rows for
    pattern detection. Useful for investigating "skipped_unclassified_side"
    metric on /recent responses.

    Common reasons a row has empty/unclassifiable Side:
      - Trade printed at mid-market (Lee-Ready can't decide)
      - NBBO data stale / Q subscription not yet active for the contract
      - Raw print history empty (first trade on the contract today)
      - Worker was warming up and hadn't subscribed to this contract yet
    """
    today = target_date or _today_mdyyyy()
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        # Counts by Side value across today's classifiable color rows
        cur = conn.execute("""
            SELECT COALESCE(Side, '') AS s, COUNT(*) AS n
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
             GROUP BY s
             ORDER BY n DESC
        """, (today,))
        side_counts = [(r["s"] or "(empty)", r["n"]) for r in cur.fetchall()]
        total = sum(n for _, n in side_counts)
        classified = sum(n for s, n in side_counts if s in ("A", "AA", "B", "BB"))
        unclassified = total - classified

        # Sample of unclassified rows for pattern detection
        cur = conn.execute("""
            SELECT CreatedTime, Symbol, Type, CallPut, Strike, Spot,
                   Premium, Color, OI, Volume, Side, ExpirationDate
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
               AND (Side IS NULL OR Side = '' OR Side NOT IN ('A','AA','B','BB'))
             ORDER BY id DESC
             LIMIT 25
        """, (today,))
        sample_unclassified = [dict(r) for r in cur.fetchall()]

        # Pattern: which tickers have the most unclassified
        cur = conn.execute("""
            SELECT Symbol, COUNT(*) AS n
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
               AND (Side IS NULL OR Side = '' OR Side NOT IN ('A','AA','B','BB'))
             GROUP BY Symbol
             ORDER BY n DESC
             LIMIT 20
        """, (today,))
        top_unclassified_tickers = [(r["Symbol"], r["n"]) for r in cur.fetchall()]

        # Pattern: by Type (sweep vs block vs ML vs regular)
        cur = conn.execute("""
            SELECT COALESCE(Type, '') AS t, COUNT(*) AS n
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
               AND (Side IS NULL OR Side = '' OR Side NOT IN ('A','AA','B','BB'))
             GROUP BY t
             ORDER BY n DESC
             LIMIT 10
        """, (today,))
        unclassified_by_type = [(r["t"] or "(empty)", r["n"]) for r in cur.fetchall()]
    finally:
        conn.close()

    return {
        "query_date": today,
        "summary": {
            "total_my_rows": total,
            "classified_count": classified,
            "unclassified_count": unclassified,
            "unclassified_pct": round(100.0 * unclassified / total, 1) if total else 0,
        },
        "side_distribution": dict(side_counts),
        "top_unclassified_tickers": dict(top_unclassified_tickers),
        "unclassified_by_type": dict(unclassified_by_type),
        "sample_unclassified": sample_unclassified,
        "interpretation": (
            f"{unclassified} of {total} MAGENTA/YELLOW rows have no usable Side. "
            "Common causes: trades printing mid-market (Lee-Ready can't decide), "
            "NBBO data stale, Q subscription not active, or first trade on a "
            "contract before raw print history existed."
        ),
    }


@router.get("/side-method-stats")
def side_method_stats():
    """Live side-classification telemetry, straight from the consumer's _state.

    WHY THIS EXISTS (2026-07-16): massive_ws_worker sets these counters on every
    flush (~lines 886-892) but nothing logs or surfaces them. So the question
    that actually matters — "are our sides coming from NBBO or from the tick
    test?" — has been unanswerable. A ~40%-accuracy side bug survived weeks of
    tuning inside that blind spot.

    ONLY MEANINGFUL ON flow-worker. It owns the WS consumer, so get_status()
    returns live state. On any other process this returns the never-updated
    import-time copy (all zeros) — that's the same trap that made `running:false`
    look like a dead feed on 7/14 when the query hit web instead of the worker.

    Counters are PER-FLUSH (last batch) except reclassified_total /
    quotes_received, which are cumulative. One read is a snapshot — poll across
    the session, especially during a fast tape (that's when the tick test does
    its damage).

    READING THE FORK:
      lookup_size      — events in the last flush needing a side
      have_nbbo        — _nbbo_at() found a quote at-or-before the trade
      fresh_nbbo       — ...and it was within NBBO_STALENESS_NS (5s)
      classified_nbbo  — side from NBBO (trustworthy)
      classified_tick  — side from the tick test. This path SATURATES to "A" in
                         a rising tape: it only knows "price moved up from the
                         last print", not "above the ask". In a stacked-bid
                         uptrend every bid-hit prints higher and gets stamped A.
      no_signal        — no NBBO, no tick history

    If have_nbbo << lookup_size while q_subscribed_count is near the 950 cap,
    the problem is NOT quote coverage — it's that the trades being classified are
    OLDER than every quote in _NBBO_HISTORY (bounded 1000 snapshots/contract,
    ~20-100s on an active name). That is the ingestion-lag corruption path: at a
    415s lag the quote history has rolled past the trades, _nbbo_at returns None,
    and everything falls through to the tick test.

    Conversely, if have_nbbo AND fresh_nbbo AND classified_nbbo are all high,
    the lag theory is dead — NBBO classified these and still got them wrong, and
    the bug is in _classify_side / avg_price / the quote content itself.
    """
    try:
        from api.massive_ws_worker import get_status
        st = get_status() or {}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"worker status unavailable: {e}"}

    keys = (
        "last_side_lookup_size", "last_side_lookup_classified",
        "last_side_have_nbbo", "last_side_fresh_nbbo",
        "last_side_classified_nbbo", "last_side_classified_tick",
        "last_side_no_signal",
        "reclassify_buffer_size", "reclassified_total", "last_reclassify_count",
        "quotes_received", "q_subscribed_count",
        "last_trade_ts", "last_write_ts", "running", "enabled",
    )
    stats = {k: st.get(k) for k in keys}

    n = stats.get("last_side_lookup_size") or 0
    derived = {}
    if n:
        def _pct(k):
            return round(100.0 * (stats.get(k) or 0) / n, 1)
        derived = {
            "have_nbbo_pct": _pct("last_side_have_nbbo"),
            "fresh_nbbo_pct": _pct("last_side_fresh_nbbo"),
            "classified_nbbo_pct": _pct("last_side_classified_nbbo"),
            "classified_tick_pct": _pct("last_side_classified_tick"),
            "no_signal_pct": _pct("last_side_no_signal"),
        }

    # Write lag: the gap between the last trade seen and the last DB write. When
    # this grows, _NBBO_HISTORY rolls past the events being classified and NBBO
    # lookup starts failing — lag becomes a CORRECTNESS bug, not just latency.
    lag_sec = None
    try:
        lt, lw = stats.get("last_trade_ts"), stats.get("last_write_ts")
        if lt and lw:
            lag_sec = round(float(lt) - float(lw), 1)
    except (TypeError, ValueError):
        pass

    return {
        "ok": True,
        "stats": stats,
        "derived_pct_of_lookup_size": derived,
        "trade_to_write_lag_sec": lag_sec,
        "note": ("Per-flush counters. Low have_nbbo_pct while q_subscribed_count "
                 "is near 950 means trades are being classified AFTER the NBBO "
                 "history rolled past them (ingestion-lag corruption), not for "
                 "lack of quotes. High classified_tick_pct means the saturating "
                 "path is doing the work — it stamps 'A' on everything in a "
                 "rising tape."),
    }


# ─── OI enrichment from contract_oi_snapshots (snapshot-only, no Schwab) ──
# The frontend "fetch OI" button was previously wired to /api/oi-snapshot/
# bulk-fetch, which tries snapshot lookup with an incorrect key format then
# falls through to Schwab options_quotes_batch for the (100%) miss set.
# For historical views (?date=<past>) Schwab returns nothing — its quotes
# API is current-only — and the underlying HTTP call has no timeout on that
# code path, so the endpoint hangs indefinitely. Symptom: button spinner
# never resolves, subsequent /recent requests back up behind the stuck
# call due to SQLite lock contention.
#
# This endpoint is the surgical replacement:
#   1. Snapshot table ONLY. Never touches Schwab, so no hang risk.
#   2. Uses the contract_key format proven correct by tonight's confirmation-
#      map endpoint (`TICKER|C_or_P|STRIKE.0|M/D/YYYY`), with the same 7-
#      variant probe fallback if that format ever changes.
#   3. Optional target_date param clamps snap_date <= target_date so
#      historical views return pre-trade OI (not lookahead post-trade OI).
#   4. Batched query pattern from confirmation-map (400 keys per IN clause)
#      keeps this fast even at 1000+ contracts.
#
# The daily snapshot job runs at 5:30 UTC (1:30 AM ET), so for any historical
# view of date D the "latest snap <= D" returns D's row, which was written at
# 1:30 AM ET the morning of D and holds D-1's EOD OI — exactly the pre-trade
# figure we want to show in the priorOI column.

@router.post("/enrich-oi")
async def enrich_oi(
    request: Request,
    target_date: str = Query(default=None, description="M/D/YYYY. Clamp lookup to snap_date <= this date so historical views return pre-trade OI instead of post-trade lookahead. Omit for latest available."),
    _auth: dict = Depends(require_flow_user),
):
    """Enrich a batch of contracts with prior OI from contract_oi_snapshots.

    Request body: bare JSON array of contracts:
        [{"ticker": "MU", "cp": "C", "strike": 1000, "exp": "9/18/2026"},
         {"ticker": "BE", "cp": "P", "strike": 250, "exp": "7/17/2026"},
         ...]

    Query param:
        target_date=7/2/2026  →  return latest snap where snap_date <= 7/2/2026
        (omit)                →  return latest snap overall for each contract

    Response:
        {
            "ok": true,
            "results": [
                {"ticker": "MU", "cp": "C", "strike": 1000,
                 "exp": "9/18/2026", "oi": 4287, "snap_date": "2026-07-02"},
                ...
            ],
            "total_requested": 30,
            "matched": 28,
            "unmatched": 2,
            "matched_variant_examples": ["MU|C|1000.0|9/18/2026"],
            "target_date": "7/2/2026"
        }

    Missing contracts (no snapshot ever recorded, or all snapshots later
    than target_date) are silently omitted from `results` — the caller
    already knows what it asked for and can diff request vs response.
    Format detection failures return the same shape with matched=0 and
    an empty matched_variant_examples list.
    """
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid JSON body: {e}")

    # Accept bare list (JSX current shape) or {contracts: [...]} for parity
    # with confirmation-map. Some future clients may prefer the wrapped form.
    if isinstance(body, list):
        contracts = body
    elif isinstance(body, dict):
        contracts = body.get("contracts") or []
    else:
        contracts = []

    if not contracts:
        return {"ok": False, "error": "No contracts provided",
                "results": [], "total_requested": 0, "matched": 0}
    if len(contracts) > 5000:
        raise HTTPException(status_code=400,
                            detail="Too many contracts (limit 5000)")

    def _iso(date_str: str) -> str:
        s = (date_str or "").strip()
        if not s:
            return ""
        parts = s.split("/")
        if len(parts) == 3:
            m, d, y = parts[0], parts[1], parts[2]
            if len(y) == 2:
                y = "20" + y
            try:
                return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
            except Exception:
                return s
        return s

    def _key_variants(c: dict) -> list[str]:
        """Candidate storage formats for contract_key. Verified format first."""
        sym = str(c.get("ticker") or c.get("sym") or "").upper().strip()
        cp = str(c.get("cp") or "").upper().strip()
        cp_letter = cp[0] if cp else ""
        cp_word = "CALL" if cp_letter == "C" else "PUT" if cp_letter == "P" else cp
        strike = c.get("strike")
        try:
            strike_num = float(strike)
            if strike_num == int(strike_num):
                strike_1dp = f"{int(strike_num)}.0"
                strike_int = f"{int(strike_num)}"
            else:
                strike_1dp = f"{strike_num}"
                strike_int = f"{strike_num}"
        except (TypeError, ValueError):
            strike_1dp = str(strike) if strike is not None else ""
            strike_int = strike_1dp
        expiry_raw = str(c.get("exp") or c.get("expiry") or "").strip()
        expiry_iso = _iso(expiry_raw)
        return [
            f"{sym}|{cp_letter}|{strike_1dp}|{expiry_raw}",   # verified: BE|C|370.0|9/18/2026
            f"{sym}|{cp_letter}|{strike_int}|{expiry_raw}",   # BE|C|370|9/18/2026
            f"{sym}|{cp_word}|{strike_1dp}|{expiry_raw}",
            f"{sym}|{cp_letter}|{strike_1dp}|{expiry_iso}",
            f"{sym}|{cp_word}|{strike_int}|{expiry_raw}",
            f"{sym} {cp_letter} {strike_1dp} {expiry_raw}",
            f"{sym}_{cp_letter}_{strike_1dp}_{expiry_iso}",
        ]

    def _echo_key(c: dict) -> str:
        """Original-key echo used by JSX to reconcile the response with its
        outstanding request. Must match the JSX side's dedup key exactly:
        `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`.
        """
        return (f"{c.get('ticker','')}|{c.get('cp','')}|"
                f"{c.get('strike','')}|{c.get('exp','')}")

    # Convert target_date (M/D/YYYY) → ISO (YYYY-MM-DD) for snap_date comparison.
    # snap_date in contract_oi_snapshots is stored as ISO per api/oi_snapshots.py.
    target_iso = _iso(target_date) if target_date else None

    results: list[dict] = []
    matched_variant_examples: list[str] = []
    unmatched_count = 0

    try:
        with sqlite3.connect(DB_PATH, timeout=10) as conn:
            # ── Step 1: Detect stored key format from a small probe set.
            # Reuses confirmation-map's proven approach — try up to 20 probe
            # contracts, use the first variant that hits, then commit to that
            # format for the whole batch. Avoids the 7×N table scans that
            # timed out on Cloudflare for large batches.
            detected_format = None
            probe_contracts = contracts[:min(20, len(contracts))]
            for probe in probe_contracts:
                if detected_format is not None:
                    break
                for i, v in enumerate(_key_variants(probe)):
                    cur = conn.execute(
                        "SELECT 1 FROM contract_oi_snapshots "
                        "WHERE contract_key = ? LIMIT 1",
                        (v,),
                    )
                    if cur.fetchone():
                        detected_format = i
                        matched_variant_examples.append(v)
                        break

            if detected_format is None:
                return {
                    "ok": True,
                    "results": [],
                    "total_requested": len(contracts),
                    "matched": 0,
                    "unmatched": len(contracts),
                    "matched_variant_examples": [],
                    "target_date": target_date,
                    "note": ("Could not detect contract_key format from any of "
                             "the 7 candidates on 20 probe contracts. Hit "
                             "/api/admin/oi/table-diagnose and share "
                             "oi_sample_keys."),
                }

            # ── Step 2: Build the one winning-format key per contract.
            key_to_contract: dict[str, dict] = {}
            for c in contracts:
                variants = _key_variants(c)
                if detected_format < len(variants):
                    k = variants[detected_format]
                    # Last-wins if the same key appears twice — fine, we only
                    # need one lookup result per unique contract.
                    key_to_contract[k] = c

            # ── Step 3: Batch-fetch latest snapshot per contract with snap_date
            # ceiling. We pull all rows for the contract set and reduce to the
            # target row in Python — one round-trip per BATCH of 400 keys.
            snap_by_key: dict[str, tuple[str, int]] = {}  # key → (snap_date, oi)
            key_list = list(key_to_contract.keys())
            BATCH = 400
            for i in range(0, len(key_list), BATCH):
                batch = key_list[i:i + BATCH]
                placeholders = ",".join(["?"] * len(batch))
                if target_iso:
                    # Clamp to snap_date <= target_iso. Ordering by snap_date
                    # ASC means the LAST row we see per key is the desired one.
                    q = (f"SELECT contract_key, snap_date, oi "
                         f"FROM contract_oi_snapshots "
                         f"WHERE contract_key IN ({placeholders}) "
                         f"  AND snap_date <= ? "
                         f"ORDER BY contract_key, snap_date")
                    params = batch + [target_iso]
                else:
                    q = (f"SELECT contract_key, snap_date, oi "
                         f"FROM contract_oi_snapshots "
                         f"WHERE contract_key IN ({placeholders}) "
                         f"ORDER BY contract_key, snap_date")
                    params = batch
                cur = conn.execute(q, params)
                for r in cur.fetchall():
                    k, sd, oi_val = r[0], r[1], int(r[2] or 0)
                    # Keep only the latest snap per key (last-wins after ORDER BY).
                    # Skip zero-OI snapshots so a real earlier value isn't
                    # shadowed by a later Schwab-write-failed sentinel row.
                    if oi_val <= 0:
                        continue
                    prev = snap_by_key.get(k)
                    if prev is None or sd > prev[0]:
                        snap_by_key[k] = (sd, oi_val)

            # ── Step 4: Assemble results in the JSX-expected shape.
            for k, c in key_to_contract.items():
                snap = snap_by_key.get(k)
                if snap is None:
                    unmatched_count += 1
                    continue
                sd, oi_val = snap
                results.append({
                    "ticker": c.get("ticker", ""),
                    "cp": c.get("cp", ""),
                    "strike": c.get("strike"),
                    "exp": c.get("exp", ""),
                    "oi": oi_val,
                    "snap_date": sd,
                })

    except sqlite3.OperationalError as e:
        # SQLite lock timeout / disk error — surface it cleanly rather than
        # letting the request hang. flow.db can lock under write pressure.
        raise HTTPException(status_code=503,
                            detail=f"contract_oi_snapshots read failed: {e}")

    return {
        "ok": True,
        "results": results,
        "total_requested": len(contracts),
        "matched": len(results),
        "unmatched": unmatched_count,
        "matched_variant_examples": matched_variant_examples[:3],
        "target_date": target_date,
    }


# ─── Spot diagnostic: is flow.db actually storing Spot for this date? ────
# Ravi asserts the Massive OPRA source data carries spot on every print,
# so a missing Spot column in the UI must be a pipeline loss (either
# build_gap_fill_csv.py stripping it during CSV generation, or
# apply_gap_fill.py dropping it on insert). This endpoint reads flow.db
# directly and reports the true Spot state per date so we can pinpoint
# the failure side without guessing.
#
# Interpretation:
#   spot_pct_populated == 0.0 for a backfilled day  →  pipeline is losing
#     Spot somewhere between the flat file and flow.db. Next check: view
#     fill-<DATE>-stocks.csv in the repo and confirm whether the Spot
#     column has real values there. If yes → apply_gap_fill.py is dropping
#     it on insert. If no → build_gap_fill_csv.py isn't extracting it.
#   spot_pct_populated > 0.0 but UI shows "—"  →  read-path bug in
#     _row_to_alert or _parse_float. Very unlikely; those helpers are
#     shared across sources and live rows populate correctly.
#   spot_pct_populated ≈ 100% for live-worker-written days  →  ingestion
#     path from massive_ws_worker is fine; only the backfill path is broken.

@router.get("/spot-check")
def spot_check(target_date: str = Query(default=None, description="M/D/YYYY. Defaults to today ET.")):
    """Report Spot-column population state in flow.db for a given date.

    Returns row counts by Spot state (populated / zero / null) plus a small
    sample of rows from each bucket so we can eyeball whether the missing
    column is a pipeline loss or a display bug.
    """
    today = target_date or _today_mdyyyy()
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row

        # Total rows on this date across all sources
        total_row = conn.execute(
            "SELECT COUNT(*) AS n FROM flow WHERE CreatedDate = ?", (today,)
        ).fetchone()
        total = total_row["n"] if total_row else 0

        # Spot state breakdown. SQLite stores Spot as TEXT; treat both empty
        # string and "0" / "0.0" as unpopulated. CAST to REAL for numeric
        # comparison — non-numeric text CASTs to 0, which folds correctly
        # into the "zero_or_null" bucket.
        populated_row = conn.execute(
            "SELECT COUNT(*) AS n FROM flow "
            "WHERE CreatedDate = ? "
            "  AND Spot IS NOT NULL "
            "  AND Spot != '' "
            "  AND CAST(Spot AS REAL) > 0",
            (today,)
        ).fetchone()
        populated = populated_row["n"] if populated_row else 0

        # Sample: 3 rows with populated Spot (to prove format), 3 without
        sample_populated = [
            {"Symbol": r["Symbol"], "CreatedTime": r["CreatedTime"],
             "CallPut": r["CallPut"], "Strike": r["Strike"],
             "Spot": r["Spot"], "Price": r["Price"], "source": r["source"]}
            for r in conn.execute(
                "SELECT source, Symbol, CreatedTime, CallPut, Strike, Spot, Price "
                "FROM flow "
                "WHERE CreatedDate = ? "
                "  AND Spot IS NOT NULL "
                "  AND Spot != '' "
                "  AND CAST(Spot AS REAL) > 0 "
                "ORDER BY id DESC LIMIT 3",
                (today,)
            ).fetchall()
        ]
        sample_missing = [
            {"Symbol": r["Symbol"], "CreatedTime": r["CreatedTime"],
             "CallPut": r["CallPut"], "Strike": r["Strike"],
             "Spot": r["Spot"], "Price": r["Price"], "source": r["source"]}
            for r in conn.execute(
                "SELECT source, Symbol, CreatedTime, CallPut, Strike, Spot, Price "
                "FROM flow "
                "WHERE CreatedDate = ? "
                "  AND (Spot IS NULL OR Spot = '' OR CAST(Spot AS REAL) <= 0) "
                "ORDER BY id DESC LIMIT 3",
                (today,)
            ).fetchall()
        ]

        # By-source breakdown so we can see if live (worker) vs backfill
        # (gap-fill) differ. Same-day mixed-source ingestion is possible;
        # a per-source view isolates the guilty path.
        by_source_rows = conn.execute(
            "SELECT source, "
            "       COUNT(*) AS total, "
            "       SUM(CASE WHEN Spot IS NOT NULL AND Spot != '' "
            "                 AND CAST(Spot AS REAL) > 0 THEN 1 ELSE 0 END) AS populated "
            "FROM flow "
            "WHERE CreatedDate = ? "
            "GROUP BY source",
            (today,)
        ).fetchall()
        by_source = {
            r["source"]: {
                "total": r["total"],
                "populated": r["populated"],
                "pct": round(100.0 * r["populated"] / r["total"], 1) if r["total"] else 0.0,
            }
            for r in by_source_rows
        }

    finally:
        conn.close()

    return {
        "target_date": today,
        "total_rows": total,
        "spot_populated": populated,
        "spot_zero_or_null": total - populated,
        "spot_pct_populated": round(100.0 * populated / total, 1) if total else 0.0,
        "by_source": by_source,
        "sample_rows_with_spot": sample_populated,
        "sample_rows_without_spot": sample_missing,
        "interpretation": (
            "Zero populated → Spot lost somewhere between Massive flat file "
            "and flow.db. Next check the CSV column in fill-<DATE>-stocks.csv. "
            "If CSV has Spot values → apply_gap_fill.py isn't reading it. "
            "If CSV has Spot=0 → build_gap_fill_csv.py isn't extracting it."
            if populated == 0 and total > 0 else
            "Some rows have Spot. Compare by_source to see which ingestion "
            "path is missing it (worker vs gap-fill)."
            if populated > 0 else
            "No rows on this date."
        ),
    }


# ─── Worker downtime detection (retroactive gap analysis) ───────────────
# Detect windows during market hours where flow.db received zero writes,
# which is a strong proxy for worker-down periods. Massive doesn't replay
# missed events, so any consecutive-empty-minutes stretch during 9:30-16:00
# ET is either (a) the worker was down/restarting or (b) the entire OPRA
# feed had an outage. (a) dominates in practice.
#
# Why this works: liquid trading days see 500-5000 option prints per minute
# across the tape. A single zero-print minute during regular hours is
# already suspicious; two consecutive is near-certain worker downtime.
# We report both counts (permissive and strict) so the operator can decide
# which threshold matches their tolerance.
#
# Complementary approach: forward-looking restart log. Not built here — see
# the response note for the ~5-line patch to massive_ws_worker.py that
# would give you exact restart timestamps going forward.

# ─── Q pool subscription history ──────────────────────────────────────────
# 7/8: added after the 7/7 OPRA analysis proved that VRT/ORCL/MSFT/etc. gaps
# were not upstream (Massive had every print) or aggregator (big prints
# clear the $10K floor trivially) or Side classification (empty-Side events
# still land in flow.db as uncurated). Remaining explanation is Q pool
# coverage: worker wasn't subscribed to the specific OCC symbol at print
# time, so nothing was ever received via WebSocket.
#
# This endpoint reads q_pool_events (populated by massive_ws_worker.py's
# q_pool_log_flusher) so we can answer "was contract X in the pool at
# time T?" in one query for future gap diagnosis. Diagnostic-only — does
# not change subscription behavior.
@router.get("/q-pool-history")
def q_pool_history(
    occ: str = Query(default=None,
                     description="Exact OCC symbol, e.g. 'O:VRT260821P00330000'"),
    ticker: str = Query(default=None,
                        description="Ticker filter — matches OCC symbols starting with 'O:<TICKER>'"),
    ts_unix: float = Query(default=None,
                           description="Point-in-time: return most recent event for OCC(s) "
                                       "at-or-before this unix timestamp. Requires occ or ticker."),
    since_unix: float = Query(default=None,
                              description="Return events with ts_unix >= this. Combines with occ/ticker."),
    limit: int = Query(default=500, ge=1, le=10000),
):
    """Query Q pool subscription history for gap diagnosis.

    Three modes:
      1. Full event stream for one contract:
         /q-pool-history?occ=O:VRT260821P00330000
      2. Point-in-time state for one contract:
         /q-pool-history?occ=O:VRT260821P00330000&ts_unix=1783519000
         Returns [{action: 'sub'|'unsub'|'warmstart', ...}] — most recent
         event at-or-before ts_unix. Interpret: if last event was 'sub' or
         'warmstart', contract was subscribed at that moment.
      3. All events for a ticker across the day:
         /q-pool-history?ticker=VRT&since_unix=1783483200
    """
    if not occ and not ticker:
        return {"ok": False,
                "error": "Provide at least one of: occ, ticker.",
                "hint": "Try ?occ=O:VRT260821P00330000 or ?ticker=VRT"}

    try:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        try:
            conn.row_factory = sqlite3.Row
            where = []
            params: list = []
            if occ:
                where.append("occ = ?")
                params.append(occ)
            elif ticker:
                # OCC format: O:TICKERYYMMDD[C|P]STRIKE. Prefix match on ticker.
                # Anchored at position 3 (after "O:") so 'BE' doesn't match 'BEAR'.
                # We use LIKE because ticker length varies; SQLite handles the
                # prefix scan fine with the ix_qpe_occ_ts index for equality
                # cases, and a full-scan is bounded by other filters anyway.
                where.append("occ LIKE ?")
                params.append(f"O:{ticker}%")

            if ts_unix is not None:
                # Point-in-time mode — take most-recent event(s) at-or-before
                where.append("ts_unix <= ?")
                params.append(float(ts_unix))
                sql = (f"SELECT ts_unix, action, occ, reason, "
                       f"pool_size_after, evicted_for "
                       f"FROM q_pool_events "
                       f"WHERE {' AND '.join(where)} "
                       f"ORDER BY ts_unix DESC LIMIT ?")
                params.append(int(limit))
            else:
                if since_unix is not None:
                    where.append("ts_unix >= ?")
                    params.append(float(since_unix))
                sql = (f"SELECT ts_unix, action, occ, reason, "
                       f"pool_size_after, evicted_for "
                       f"FROM q_pool_events "
                       f"WHERE {' AND '.join(where)} "
                       f"ORDER BY ts_unix ASC LIMIT ?")
                params.append(int(limit))

            try:
                rows = conn.execute(sql, params).fetchall()
            except sqlite3.OperationalError as _e:
                # Table might not exist yet if worker hasn't started emitting
                if 'no such table' in str(_e).lower():
                    return {"ok": True, "events": [], "count": 0,
                            "note": "q_pool_events table does not exist yet — "
                                    "worker hasn't recorded any subscription "
                                    "events (either not deployed or no writes "
                                    "since deploy)."}
                raise

            events = [dict(r) for r in rows]
        finally:
            conn.close()

        # For point-in-time queries, group by occ so caller sees the most
        # recent state per contract in a single response (useful when using
        # ?ticker=X&ts_unix=T to check "which of this ticker's contracts
        # were subscribed at moment T").
        pit_by_occ = None
        if ts_unix is not None:
            pit_by_occ = {}
            for e in events:
                if e['occ'] not in pit_by_occ:
                    pit_by_occ[e['occ']] = e
            pit_by_occ = {
                k: {
                    'last_action': v['action'],
                    'last_ts_unix': v['ts_unix'],
                    'reason': v['reason'],
                    'subscribed_at_query_time': v['action'] in ('sub', 'warmstart'),
                } for k, v in pit_by_occ.items()
            }

        return {
            "ok": True,
            "count": len(events),
            "events": events,
            "point_in_time_state": pit_by_occ,
            "note": (
                "action='sub' or 'warmstart' means contract entered pool. "
                "action='unsub' means contract left pool. "
                "For point-in-time queries, interpret last_action to determine "
                "whether contract was subscribed at query_ts_unix."
            ),
        }
    except Exception as _e:
        return {"ok": False, "error": str(_e), "error_type": type(_e).__name__}


_worker_history_cache: dict = {}      # (date, min_gap) -> (ts, payload)
# 300s (> the frontend's 180s status poll) so a poll almost always hits a warm
# entry instead of triggering another 24-45s scan; outage history isn't time-
# sensitive. Warmed on boot/new-day only (see flow_worker_main warmer).
_WORKER_HISTORY_TTL = int(os.environ.get("MASSIVE_WORKER_HISTORY_TTL", "300"))
_worker_history_lock = threading.Lock()   # single-flight: one heavy scan at a time


@router.get("/worker-history")
def worker_history(
    target_date: str = Query(default=None, description="M/D/YYYY or ISO. Defaults to today ET."),
    min_gap_minutes: int = Query(default=2, ge=1, le=30,
                                  description="Minimum consecutive empty minutes to count as a downtime window."),
):
    """Retrospective outage detection from flow.db write timestamps — wrapper.

    Cached (single-flight): today TTL 30s + kept hot by the flow-worker warmer;
    historical dates cached immutably. Was an UNCACHED full-day minute-by-minute
    scan (24-45s) that blocked the single-process event loop on every call.
    Delegates to _worker_history_impl; catches any exception so a bug surfaces
    as a usable JSON error (uncached) instead of an upstream-gateway null.
    """
    today = _resolve_date(target_date)
    ttl = _HISTORICAL_TTL if today != _today_mdyyyy() else _WORKER_HISTORY_TTL
    try:
        return _cached_single_flight(
            _worker_history_cache, (today, int(min_gap_minutes)),
            _worker_history_lock, ttl,
            lambda: _worker_history_impl(today, min_gap_minutes))
    except Exception as _err:
        import traceback as _tb
        return {
            "ok": False,
            "error": str(_err),
            "error_type": type(_err).__name__,
            "target_date": target_date,
            "traceback_last_frames": _tb.format_exc().splitlines()[-6:],
            "note": "worker-history handler raised. Common causes: DB path "
                    "missing, unexpected CreatedTime format, SQLite lock.",
        }


def _worker_history_impl(target_date, min_gap_minutes):
    """Actual retrospective outage detection. See worker_history() docstring."""
    today = target_date or _today_mdyyyy()

    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        # Pull the CreatedTime for every row on this date. Single column, so
        # even 500K rows on a busy day = ~5MB. Faster than doing minute-bucket
        # aggregation in SQLite because CreatedTime is stored as "H:MM:SS AM/PM"
        # text — parsing is easier in Python than in SQL substring gymnastics.
        cur = conn.execute(
            "SELECT CreatedTime FROM flow "
            "WHERE CreatedDate = ? AND source = 'stocks'",
            (today,)
        )
        times = [r[0] for r in cur.fetchall() if r[0]]
    finally:
        conn.close()

    if not times:
        return {
            "target_date": today,
            "total_rows": 0,
            "note": "No rows found on this date (weekend, holiday, or worker "
                    "was down the entire session).",
        }

    def _parse_to_minute_of_day(t):
        """'2:58:37 PM' → 898 (minutes past midnight). None on parse failure.

        NOTE: Return annotation intentionally omitted — using PEP 604 union
        syntax (`int | None`) here breaks on Python 3.9, which is Railway's
        default runtime for older FastAPI templates. The whole handler falls
        over at first call because annotation eval happens when this nested
        def statement executes. Removing the annotation is the cleanest fix.
        """
        try:
            s = t.strip().upper()
            # Handle both 'H:MM:SS AM' and 'HH:MM:SS AM' plus stray whitespace
            parts = s.split()
            if len(parts) != 2:
                return None
            hhmmss, ampm = parts[0], parts[1]
            h_str, m_str, *_ = hhmmss.split(":")
            h, m = int(h_str), int(m_str)
            if ampm == "PM" and h != 12:
                h += 12
            elif ampm == "AM" and h == 12:
                h = 0
            return h * 60 + m
        except Exception:
            return None

    # Bucket every row into its minute-of-day. Only market hours count for
    # the downtime analysis: 9:30 = minute 570, 16:00 = minute 960.
    MARKET_OPEN = 9 * 60 + 30    # 570
    MARKET_CLOSE = 16 * 60       # 960

    # Cap the scan at "now" when target_date is today. Otherwise every
    # minute from now to 4:00 PM is counted as empty, producing a fake
    # multi-hour downtime window at the tail. (Bug caught mid-session
    # 7/6/2026 when a legitimate ~80-minute downtime finding was
    # buried under a bogus 160-minute future-hours "gap".)
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    _now_et = _dt.now(_tz.utc) + _td(hours=-4)  # July DST
    _today_str = f"{_now_et.month}/{_now_et.day}/{_now_et.year}"
    if today == _today_str:
        scan_end = min(MARKET_CLOSE, _now_et.hour * 60 + _now_et.minute)
    else:
        scan_end = MARKET_CLOSE
    # Never scan backwards if called before market open on a live day.
    scan_end = max(scan_end, MARKET_OPEN)

    minute_counts: dict[int, int] = {}
    hour_counts: dict[int, int] = {}
    for t in times:
        m = _parse_to_minute_of_day(t)
        if m is None:
            continue
        minute_counts[m] = minute_counts.get(m, 0) + 1
        hour_counts[m // 60] = hour_counts.get(m // 60, 0) + 1

    # Scan MARKET_OPEN..scan_end for zero-count minutes and group into
    # consecutive runs. scan_end excludes future minutes on the live day.
    empty_minutes = [m for m in range(MARKET_OPEN, scan_end)
                     if minute_counts.get(m, 0) == 0]
    market_minutes_in_scan = scan_end - MARKET_OPEN
    market_minutes_with_writes = market_minutes_in_scan - len(empty_minutes)

    # Group consecutive empty minutes into windows.
    windows: list[dict] = []
    if empty_minutes:
        run_start = empty_minutes[0]
        prev = run_start
        for m in empty_minutes[1:]:
            if m == prev + 1:
                prev = m
                continue
            windows.append({"start_min": run_start, "end_min": prev + 1,
                            "duration_min": prev + 1 - run_start})
            run_start = m
            prev = m
        windows.append({"start_min": run_start, "end_min": prev + 1,
                        "duration_min": prev + 1 - run_start})

    # Estimate dropped events per window using the average print rate of the
    # non-empty minutes on either side of it (buffer = 5 min each side).
    def _fmt(min_of_day: int) -> str:
        h = min_of_day // 60
        mm = min_of_day % 60
        ampm = "AM" if h < 12 else "PM"
        h12 = h if 1 <= h <= 12 else (h - 12 if h > 12 else 12)
        return f"{h12}:{mm:02d} {ampm}"

    def _neighbor_rate(w: dict) -> float:
        buf = 5
        neighbors = []
        for m in range(max(MARKET_OPEN, w["start_min"] - buf), w["start_min"]):
            neighbors.append(minute_counts.get(m, 0))
        for m in range(w["end_min"], min(MARKET_CLOSE, w["end_min"] + buf)):
            neighbors.append(minute_counts.get(m, 0))
        if not neighbors:
            return 0.0
        return sum(neighbors) / len(neighbors)

    strict_windows = []
    for w in windows:
        if w["duration_min"] < min_gap_minutes:
            continue
        rate = _neighbor_rate(w)
        strict_windows.append({
            "start": _fmt(w["start_min"]),
            "end": _fmt(w["end_min"]),
            "duration_min": w["duration_min"],
            "est_dropped_events": int(round(rate * w["duration_min"])),
        })

    hourly = {f"{h:02d}": hour_counts.get(h, 0)
              for h in range(9, 17) if hour_counts.get(h, 0) > 0}

    total_estimated_dropped = sum(w["est_dropped_events"] for w in strict_windows)
    interp_parts = []
    if not strict_windows:
        interp_parts.append(
            f"No worker downtime detected on {today} at the "
            f"≥{min_gap_minutes}-minute threshold."
        )
    else:
        interp_parts.append(
            f"{len(strict_windows)} probable downtime window(s) "
            f"detected on {today}. Estimated {total_estimated_dropped:,} "
            f"OPRA events dropped (based on neighbor-minute rates)."
        )
    if len(windows) > len(strict_windows):
        soft = len(windows) - len(strict_windows)
        interp_parts.append(
            f"{soft} additional single-minute gap(s) present but under threshold "
            "— likely genuine market quiet, not downtime."
        )
    if len(empty_minutes) > 30:
        interp_parts.append(
            "High empty-minute count suggests either an extended outage or "
            "the worker wasn't running for most of the session."
        )

    # Classification parity (2026-07-15): writes-per-minute alone is a FALSE
    # GREEN on healed days — 7/14 reported 390/390 minutes with zero downtime
    # while every restored row was unclassified (0% sided, 89% OI=0) and
    # invisible to the curated tiers. A heal check must assert classification
    # parity, not row presence. Additive block; never breaks the endpoint.
    classification = None
    try:
        from api.flow_heal_enrich import classification_parity
        classification = classification_parity(today)
        if classification.get("backfilled", {}).get("rows") and \
                not classification.get("heal_complete"):
            interp_parts.append(
                "WARNING: backfilled rows on this date diverge sharply from "
                "the live classification baseline (sided-%/OI>0-%) — the heal "
                "is INCOMPLETE for side/V-OI gated tiers despite full row "
                "coverage. Re-run POST /api/flow-gap-fill/enrich.")
    except Exception as _cls_err:
        classification = {"error": str(_cls_err)}

    # Restored 2026-07-06 mid-session: an earlier str_replace edit consumed
    # this final return block, causing the endpoint to fall off the end of
    # the function and implicitly return None (serialized by FastAPI as
    # `null`). The wrapper's try/except couldn't catch it because there
    # was no exception — just a legitimate None return.
    return {
        "target_date": today,
        "min_gap_minutes": min_gap_minutes,
        "market_minutes_total": MARKET_CLOSE - MARKET_OPEN,
        "market_minutes_scanned": market_minutes_in_scan,
        "scan_ended_at_market_minute": scan_end,
        "market_minutes_with_writes": market_minutes_with_writes,
        "market_minutes_empty": len(empty_minutes),
        "downtime_windows_strict_count": len(strict_windows),
        "downtime_windows_strict": strict_windows,
        "downtime_windows_permissive_count": len(windows),
        "total_estimated_dropped_events": total_estimated_dropped,
        "sample_hour_rates": hourly,
        "total_rows_scanned": len(times),
        "classification": classification,
        "interpretation": " ".join(interp_parts),
    }


# ─── Worker restart persistent log (auto-recorded via frontend polling) ─
# Tracks every worker process start in a worker_starts table so that after
# a session of chaos-deploy the operator can answer "how many times did
# my worker restart today and when?" definitively.
#
# Auto-recording mechanism: _log_startup_if_new() reads the current
# process's started_at from massive_ws_worker.get_status() and INSERTs it
# into worker_starts if it hasn't been logged yet. The check is O(1) using
# a module-level cache so it's cheap to call on every /recent request.
# When the worker restarts, the module state resets → the next /recent
# call re-detects and logs the new started_at.
#
# Piggybacks on the frontend's 5s poll cadence — no separate cron needed,
# no touch to massive_ws_worker.py or main.py. Limitation: restarts that
# happen before this code is deployed are lost. From first deploy of this
# module onward, every subsequent restart is captured.

_STARTUP_LOG_CACHE = {"last_logged_started_at": None}


def _log_startup_if_new() -> None:
    """Idempotent per-process: on first call after a restart, insert the
    current started_at into worker_starts. Subsequent calls in the same
    process are O(1) no-ops (module cache short-circuit).
    """
    try:
        from api.massive_ws_worker import get_status
        status = get_status() or {}
        started_at = status.get("started_at")
        if not started_at:
            return
        if _STARTUP_LOG_CACHE["last_logged_started_at"] == started_at:
            return
        import os as _os
        import time as _time
        with sqlite3.connect(DB_PATH, timeout=10) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS worker_starts ("
                "  started_at REAL PRIMARY KEY, "
                "  logged_at REAL, "
                "  deployment_id TEXT, "
                "  replica_id TEXT"
                ")"
            )
            conn.execute(
                "INSERT OR IGNORE INTO worker_starts "
                "(started_at, logged_at, deployment_id, replica_id) "
                "VALUES (?, ?, ?, ?)",
                (float(started_at), _time.time(),
                 _os.environ.get("RAILWAY_DEPLOYMENT_ID", ""),
                 _os.environ.get("RAILWAY_REPLICA_ID", "")),
            )
        _STARTUP_LOG_CACHE["last_logged_started_at"] = started_at
    except Exception as e:
        # Never let a logging failure affect the actual request handling.
        print(f"[worker_starts] auto-log failed (non-fatal): {e}")


@router.get("/restart-log")
def restart_log(
    target_date: str = Query(default=None, description="M/D/YYYY. Defaults to today ET."),
):
    """Return the worker's process-start timestamps recorded for target_date.

    Each row represents one process start (deploy, crash-restart, or
    Railway platform restart). The gap between consecutive starts is an
    approximate downtime window, but the more accurate downtime signal is
    /worker-history which reads actual flow.db write gaps.

    Response fields:
      current_process_started_at_et: when the process currently serving
        this request started (from live get_status(), not the DB).
      current_uptime_sec: seconds since current process start.
      startup_log: chronological list of every recorded start today.
        `during_market_hours` flags restarts that crossed 9:30-16:00 ET.
      restarts_during_market_hours: count of the flagged ones — the
        actionable number for "how much data did I likely drop?"
      note: caveat about pre-deploy restarts being unrecoverable.
    """
    # Fold in any restart we haven't captured yet, before reading back.
    _log_startup_if_new()

    today = target_date or _today_mdyyyy()

    # Convert M/D/YYYY -> ET day boundaries in Unix seconds. Naive but
    # correct for the operator's timezone (US Eastern is the reference
    # for the whole platform).
    try:
        m, d, y = today.split("/")
        from datetime import datetime, timezone, timedelta
        # ET is UTC-4 during DST (Mar-Nov), UTC-5 otherwise. July is DST.
        et_offset = timedelta(hours=-4)  # US Eastern DST
        day_start_et = datetime(int(y), int(m), int(d), 0, 0, 0)
        day_end_et = datetime(int(y), int(m), int(d), 23, 59, 59)
        day_start_ts = (day_start_et - et_offset).replace(tzinfo=timezone.utc).timestamp()
        day_end_ts = (day_end_et - et_offset).replace(tzinfo=timezone.utc).timestamp()
    except Exception as e:
        raise HTTPException(status_code=400,
                            detail=f"bad target_date, expected M/D/YYYY: {e}")

    MARKET_OPEN_ET_HHMM = 9 * 60 + 30
    MARKET_CLOSE_ET_HHMM = 16 * 60

    def _to_et_hhmm(unix_ts: float) -> int:
        """Return minute-of-day in ET for a Unix timestamp (July DST)."""
        from datetime import datetime, timezone, timedelta
        dt = datetime.fromtimestamp(unix_ts, tz=timezone.utc) + timedelta(hours=-4)
        return dt.hour * 60 + dt.minute

    def _to_et_str(unix_ts: float) -> str:
        from datetime import datetime, timezone, timedelta
        dt = datetime.fromtimestamp(unix_ts, tz=timezone.utc) + timedelta(hours=-4)
        h = dt.hour
        ampm = "AM" if h < 12 else "PM"
        h12 = h if 1 <= h <= 12 else (h - 12 if h > 12 else 12)
        return f"{h12}:{dt.minute:02d}:{dt.second:02d} {ampm} ET"

    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS worker_starts ("
            "  started_at REAL PRIMARY KEY, "
            "  logged_at REAL, "
            "  deployment_id TEXT, "
            "  replica_id TEXT"
            ")"
        )
        cur = conn.execute(
            "SELECT started_at, logged_at, deployment_id, replica_id "
            "FROM worker_starts "
            "WHERE started_at >= ? AND started_at <= ? "
            "ORDER BY started_at ASC",
            (day_start_ts, day_end_ts),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    startup_log = []
    prev_ts = None
    for r in rows:
        started_at, logged_at, deployment_id, replica_id = r
        et_hhmm = _to_et_hhmm(started_at)
        during_market = MARKET_OPEN_ET_HHMM <= et_hhmm < MARKET_CLOSE_ET_HHMM
        entry = {
            "started_at_et": _to_et_str(started_at),
            "started_at_unix": started_at,
            "logged_at_et": _to_et_str(logged_at) if logged_at else None,
            "detection_lag_sec": round((logged_at - started_at), 1) if logged_at else None,
            "during_market_hours": during_market,
            "deployment_id": deployment_id or None,
            "replica_id": replica_id or None,
        }
        if prev_ts is not None:
            # Interval between previous logged start and this start. This is
            # NOT the downtime — it's the *uptime* of the previous process
            # plus its shutdown time. Downtime alone is a subset of this.
            entry["seconds_since_previous_start"] = round(started_at - prev_ts, 1)
        startup_log.append(entry)
        prev_ts = started_at

    # Current process's status — separate from the table so we always see
    # the live number even if logging hasn't caught up yet.
    current_started_at = None
    current_uptime = None
    try:
        from api.massive_ws_worker import get_status
        st = get_status() or {}
        current_started_at = st.get("started_at")
        current_uptime = st.get("uptime_sec")
    except Exception:
        pass

    restarts_during_market_hours = sum(1 for e in startup_log if e["during_market_hours"])

    note_parts = [
        "This log auto-populates via /recent polling from the frontend. "
        "It only captures restarts that happened AFTER this endpoint was "
        "first deployed — prior restarts today are unrecoverable from data "
        "alone; check Railway deploy history for those.",
    ]
    if restarts_during_market_hours > 0:
        note_parts.append(
            f"{restarts_during_market_hours} restart(s) occurred within 9:30-16:00 "
            "ET — likely dropped Massive events during those windows. Cross-"
            "reference with /worker-history for the actual data-loss estimate."
        )
    if not startup_log and current_started_at:
        note_parts.append(
            "No historical entries yet. This is the first request since the "
            "endpoint was deployed; the current process start has now been "
            "logged. Reload to see it."
        )

    return {
        "target_date": today,
        "current_process_started_at_et": (
            _to_et_str(current_started_at) if current_started_at else None
        ),
        "current_process_started_at_unix": current_started_at,
        "current_uptime_sec": current_uptime,
        "restarts_recorded_today": len(startup_log),
        "restarts_during_market_hours": restarts_during_market_hours,
        "startup_log": startup_log,
        "note": " ".join(note_parts),
    }


# ─── Manual spot backfill trigger (Phase 3) ─────────────────────────────
# The worker runs spot backfill automatically ~5s after each start(), but
# if that first pass fails (Yahoo hiccup, DB lock, etc.) the rows stay
# stranded until the next restart. This endpoint lets the operator retry
# on demand from the browser without waiting for a full worker restart.
# Also handy for backfilling historical days after the fact — pass
# target_date=M/D/YYYY to run against any date's blank-spot rows.

@router.post("/backfill-spot")
def backfill_spot(
    target_date: str = Query(default=None, description="M/D/YYYY. Defaults to today ET."),
    _auth: dict = Depends(require_flow_admin),
):
    """Manually run the stranded-spot backfill for a given date.

    Same function that runs automatically at worker startup. Safe to call
    multiple times — already-populated rows are excluded by the WHERE
    clause. Returns the same result shape you'll see in the worker's
    last_spot_backfill status field.

    Common uses:
      - Retry after a failed startup pass (Yahoo transient, DB lock)
      - Backfill an older date after realizing rows never got Spot
      - Diagnostic: run against yesterday to see if any rows are still
        stranded from a restart during that session
    """
    try:
        from api.massive_ws_worker import backfill_stranded_spots
        return backfill_stranded_spots(target_date)
    except ImportError as e:
        return {
            "ok": False,
            "error": f"backfill_stranded_spots not available: {e}",
            "note": "This endpoint requires the Phase 3 changes to "
                    "massive_ws_worker.py (backfill_stranded_spots function). "
                    "If you just deployed the router alone without the worker "
                    "changes, deploy those too.",
        }
    except Exception as e:
        import traceback
        return {
            "ok": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "traceback_last_frames": traceback.format_exc().splitlines()[-5:],
        }
