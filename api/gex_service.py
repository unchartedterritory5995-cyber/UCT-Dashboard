"""
Gamma Exposure (GEX) computation service.

Two modes:
  - Naive (default): assumes all CALL OI is customer-long → dealer-short,
    all PUT OI is customer-long → dealer-short. Standard SpotGamma-style
    convention. Works well for index ETFs (SPY/QQQ) where retail
    predominantly buys protection.

  - Trade-Aware (adjusted=True): scales each contract's GEX contribution
    by est_customer_net / OI from the dealer_positioning table. A CALL
    with mostly customer-sold flow (covered-call ETFs, retail income
    strategies) gets a negative contribution — i.e., its OI doesn't
    create a "ceiling" because dealers aren't actually short those calls.

Fetches Schwab /chains for greeks + OI, then aggregates per strike.

Level classification (new): classify_gex_state() produces semantic labels
based on spot-relative position. The call_wall above spot is a Ceiling,
below spot is a Pull Up. The put_wall below spot is a Floor, above spot
is a Magnet (pulling price up). zero_gamma is only a "Danger Line" when
spot is actually near or below it — otherwise it's just a Gamma Flip
level. This stops the FLOOR/Resistance/Magnet naming disagreement
between the card view, chart overlay, and AI summary, and stops the
"below danger" warning from firing when spot is 20% away.
"""

import logging
import httpx
from typing import Optional, Dict

from api import schwab_service as schwab
from api.dealer_positioning import (
    get_positioning_for_ticker,
    get_attribution_days_for_ticker,
    get_avg_confidence_for_ticker,
)

logger = logging.getLogger("gex")

CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains"


def _parse_schwab_exp_key(exp_key: str) -> Optional[str]:
    """Schwab returns expiration keys like '2026-07-17:39' (ISO date + DTE).
    Convert to M/D/YYYY format used in contract_keys."""
    try:
        iso_date = exp_key.split(":", 1)[0]
        y, m, d = iso_date.split("-")
        return f"{int(m)}/{int(d)}/{int(y)}"
    except (ValueError, AttributeError, IndexError):
        return None


def classify_gex_state(
    spot: float,
    call_wall: Optional[dict],
    put_wall: Optional[dict],
    zero_gamma: Optional[float],
    near_threshold_pct: float = 3.0,
    asymmetry_threshold_pct: float = 15.0,
) -> dict:
    """
    Produce semantic labels and gated warnings for the current GEX state.

    Replaces the hardcoded convention "call_wall is always Ceiling, put_wall
    is always Floor". Classifies each level by position relative to spot:

      - call_wall above spot   → Ceiling (true resistance)
      - call_wall below spot   → Pull Up (magnet pulling price up — rare,
                                 happens when retail is heavily long calls
                                 OTM and there's an inverted gamma profile)
      - put_wall below spot    → Floor (true support)
      - put_wall above spot    → Magnet (price gets pulled up toward the
                                 dealer-short put cluster — TSLA $400 case)
      - zero_gamma             → "Danger Line" only when spot is below AND
                                 within near_threshold_pct. Otherwise it's
                                 just a Gamma Flip level (informational).

    Regime classification from wall asymmetry:
      - 'bullish'  : floor dominant by > asymmetry_threshold_pct
      - 'bearish'  : ceiling dominant by > asymmetry_threshold_pct
      - 'choppy'   : walls within asymmetry_threshold_pct of each other
      - 'unbound'  : one or both walls missing

    asymmetry_pct is signed: positive = ceiling stronger, negative = floor
    stronger. Useful for the AI summary to phrase narratives correctly
    instead of saying "about the same strength" when one wall is 43%
    larger.

    Args:
        spot: current underlying price
        call_wall: {"strike", "gex"} or None
        put_wall: {"strike", "gex"} or None
        zero_gamma: scalar strike or None
        near_threshold_pct: how close to zero_gamma counts as "near" (default 3%)
        asymmetry_threshold_pct: walls within this % count as choppy (default 15%)

    Returns:
        {
          "levels": {
             "call_wall": {strike, gex, above_spot, label, role},
             "put_wall":  {strike, gex, above_spot, label, role},
             "zero_gamma":{strike, above_spot, distance_pct, near,
                          spot_below, label, role},
          },
          "regime": "bullish"|"bearish"|"choppy"|"unbound",
          "asymmetry_pct": signed float or None,
          "warnings": {
              "below_danger_active": bool,   # only true when actually near
              "spot_near_danger":    bool,
          },
        }
    """
    levels: Dict[str, dict] = {}

    if call_wall is not None:
        above = call_wall["strike"] > spot
        levels["call_wall"] = {
            "strike": call_wall["strike"],
            "gex": call_wall["gex"],
            "above_spot": above,
            "label": "Ceiling" if above else "Pull Up",
            "role": "resistance" if above else "magnet_down",
        }

    if put_wall is not None:
        below = put_wall["strike"] < spot
        levels["put_wall"] = {
            "strike": put_wall["strike"],
            "gex": put_wall["gex"],
            "above_spot": not below,
            "label": "Floor" if below else "Magnet",
            "role": "support" if below else "magnet_up",
        }

    if zero_gamma is not None and spot > 0:
        distance_pct = abs(spot - zero_gamma) / spot * 100
        spot_below = spot < zero_gamma
        near = distance_pct <= near_threshold_pct
        levels["zero_gamma"] = {
            "strike": zero_gamma,
            "above_spot": zero_gamma > spot,
            "distance_pct": round(distance_pct, 2),
            "near": near,
            "spot_below": spot_below,
            # Only call it Danger Line when actually relevant — spot is
            # below it AND close. Otherwise it's just informational.
            "label": "Danger Line" if (spot_below and near) else "Gamma Flip",
            "role": "danger" if (spot_below and near) else "gamma_flip",
        }

    # Regime: signed asymmetry between wall strengths.
    # Sign convention: positive = ceiling stronger (bearish bias),
    # negative = floor stronger (bullish bias).
    regime = "unbound"
    asymmetry_pct: Optional[float] = None
    if call_wall is not None and put_wall is not None:
        call_strength = abs(call_wall["gex"])
        put_strength = abs(put_wall["gex"])
        max_strength = max(call_strength, put_strength)
        if max_strength > 0:
            asymmetry_pct = round(
                (call_strength - put_strength) / max_strength * 100, 1
            )
            if abs(asymmetry_pct) <= asymmetry_threshold_pct:
                regime = "choppy"
            elif asymmetry_pct > 0:
                regime = "bearish"
            else:
                regime = "bullish"

    # Warning gating. The old "Below danger line — drops accelerate"
    # warning fired whenever spot < zero_gamma — which is true any time
    # zero_gamma is above spot, regardless of distance. Now requires both
    # spot_below AND near.
    zg = levels.get("zero_gamma", {})
    below_danger_active = bool(zg.get("spot_below") and zg.get("near"))

    return {
        "levels": levels,
        "regime": regime,
        "asymmetry_pct": asymmetry_pct,
        "warnings": {
            "below_danger_active": below_danger_active,
            "spot_near_danger": bool(zg.get("near")),
        },
    }


async def get_gex_data(ticker: str, dte_filter: str = "all", adjusted: bool = False) -> dict:
    """
    Fetch full options chain and compute GEX per strike.

    dte_filter options:
      - "0dte"   → expirations today only
      - "1dte"   → today + tomorrow
      - "2dte"   → today + 2 days
      - "3dte"   → today + 3 days
      - "week"   → next 7 days
      - "all"    → next 180 days

    adjusted:
      - False (default): naive convention (dealer short all OI)
      - True: scale by est_customer_net from dealer_positioning table.
              Falls back to naive for any contract without DP data.
    """
    ticker = ticker.upper().strip()
    token = await schwab.get_valid_token()
    if not token:
        return {"error": "Schwab not authenticated"}

    dte_map = {
        "0dte": 0, "1dte": 1, "2dte": 2, "3dte": 3,
        "week": 7, "month": 30, "all": 180,
    }
    days = dte_map.get(dte_filter, 180)

    from datetime import datetime, timedelta
    from_date = datetime.now().strftime("%Y-%m-%d")
    to_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

    schwab_ticker = ticker
    index_tickers = {"SPX", "NDX", "VIX", "RUT", "DJX", "XSP", "XND"}
    if ticker in index_tickers:
        schwab_ticker = "$" + ticker

    params = {
        "symbol": schwab_ticker,
        "contractType": "ALL",
        "strikeCount": 60,
        "includeUnderlyingQuote": "true",
        "fromDate": from_date,
        "toDate": to_date,
    }
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(CHAINS_URL, headers=headers, params=params)
            if r.status_code != 200:
                logger.error(f"[gex] Schwab chains failed: {r.status_code} {r.text[:200]}")
                return {"error": f"Schwab API error: {r.status_code}"}
            data = r.json()
    except Exception as e:
        logger.error(f"[gex] fetch failed: {e}")
        return {"error": str(e)}

    spot = float(data.get("underlyingPrice") or 0)
    if spot <= 0:
        return {"error": f"No spot price for {ticker}"}

    # ── Load dealer_positioning data for this ticker (if adjusted) ───────
    dp_lookup: Dict[str, dict] = {}
    attribution_days = 0
    avg_confidence = 0.0
    contracts_with_dp = 0
    contracts_without_dp = 0

    if adjusted:
        attribution_days = get_attribution_days_for_ticker(ticker)
        avg_confidence = get_avg_confidence_for_ticker(ticker)
        for row in get_positioning_for_ticker(ticker):
            dp_lookup[row["contract_key"]] = {
                "est_customer_net": row["est_customer_net"],
                "est_dealer_net": row["est_dealer_net"],
                "flow_confidence": row["flow_confidence"],
                "snap_oi": row["oi"],
            }
        logger.info(
            f"[gex] adjusted=True for {ticker}: loaded {len(dp_lookup)} contract estimates, "
            f"attribution_days={attribution_days}, avg_conf={avg_confidence:.3f}"
        )

    # Aggregate GEX by strike
    strikes_map = {}
    net_delta = 0

    def process_chain(chain_map: dict, is_call: bool):
        nonlocal net_delta, contracts_with_dp, contracts_without_dp
        if not chain_map:
            return
        for exp_key, strikes in chain_map.items():
            exp_mdy = _parse_schwab_exp_key(exp_key)
            for strike_str, contracts in strikes.items():
                try:
                    strike = float(strike_str)
                except (ValueError, TypeError):
                    continue
                for c in contracts:
                    oi = c.get("openInterest") or 0
                    gamma = c.get("gamma") or 0
                    delta = c.get("delta") or 0
                    if oi <= 0:
                        continue

                    net_delta += delta * oi * 100

                    if gamma == 0:
                        continue

                    # ── Determine customer_factor ──────────────────────
                    # Naive: 1.0 (assume customer fully long).
                    # Adjusted: scale by est_customer_net / snap_OI,
                    # clamped to [-1, +1]. Falls back to 1.0 if a contract
                    # has no DP data (e.g. it was added to the chain
                    # mid-month after the last snapshot, or it's an index
                    # contract for which we don't run snapshots).
                    customer_factor = 1.0
                    if adjusted and exp_mdy:
                        cp_letter = "C" if is_call else "P"
                        ck = f"{ticker}|{cp_letter}|{strike}|{exp_mdy}"
                        dp = dp_lookup.get(ck)
                        if dp:
                            denom = max(dp["snap_oi"], 1)
                            raw_factor = dp["est_customer_net"] / denom
                            customer_factor = max(-1.0, min(1.0, raw_factor))
                            contracts_with_dp += 1
                        else:
                            contracts_without_dp += 1

                    # GEX contribution. Convention preserved:
                    #   positive call_gex = ceiling (resistance)
                    #   negative put_gex = support (floor)
                    # customer_factor scales magnitude AND can flip the
                    # sign — a CALL with -1.0 factor (customers net-short)
                    # flips ceiling → floor for that strike.
                    gex_contrib = gamma * oi * 100 * (spot ** 2) * 0.01 * customer_factor
                    if not is_call:
                        gex_contrib = -gex_contrib

                    if strike not in strikes_map:
                        strikes_map[strike] = {
                            "strike": strike,
                            "callGex": 0,
                            "putGex": 0,
                            "callOI": 0,
                            "putOI": 0,
                        }
                    s = strikes_map[strike]
                    if is_call:
                        s["callGex"] += gex_contrib
                        s["callOI"] += oi
                    else:
                        s["putGex"] += gex_contrib
                        s["putOI"] += oi

    process_chain(data.get("callExpDateMap", {}), is_call=True)
    process_chain(data.get("putExpDateMap", {}), is_call=False)

    if not strikes_map:
        return {"error": f"No options data with greeks for {ticker}"}

    strikes_list = sorted(strikes_map.values(), key=lambda x: x["strike"])
    for s in strikes_list:
        s["gex"] = s["callGex"] + s["putGex"]
        s["totalOI"] = s["callOI"] + s["putOI"]

    total_gex = sum(s["gex"] for s in strikes_list)
    total_call_gex = sum(s["callGex"] for s in strikes_list)
    total_put_gex = sum(s["putGex"] for s in strikes_list)

    # Call wall / Put wall identification.
    # IMPORTANT: in adjusted mode, call_gex can go negative (customer-sold
    # calls) and put_gex can go positive (customer-sold puts). The naive
    # max/min logic still works because the SIGN encodes meaning — but to
    # find the strongest "wall" regardless of which way it leans, we use
    # ABS in adjusted mode for the call_wall search.
    if adjusted:
        call_wall = max(strikes_list, key=lambda x: abs(x["callGex"])) if strikes_list else None
        put_wall = max(strikes_list, key=lambda x: abs(x["putGex"])) if strikes_list else None
    else:
        call_wall = max(strikes_list, key=lambda x: x["callGex"]) if strikes_list else None
        put_wall = min(strikes_list, key=lambda x: x["putGex"]) if strikes_list else None

    # Zero gamma (same multi-fallback approach as before)
    zero_gamma = None
    cumulative = 0.0
    prev_strike = None
    prev_cum = 0.0
    for s in strikes_list:
        cumulative += s["gex"]
        if prev_strike is not None and prev_cum < 0 and cumulative >= 0:
            if cumulative - prev_cum != 0:
                t = -prev_cum / (cumulative - prev_cum)
                zero_gamma = prev_strike + t * (s["strike"] - prev_strike)
            else:
                zero_gamma = s["strike"]
            break
        prev_strike = s["strike"]
        prev_cum = cumulative

    if zero_gamma is None and spot > 0:
        cumulative = 0.0
        prev_strike = None
        prev_cum = 0.0
        for s in reversed(strikes_list):
            cumulative += s["gex"]
            if prev_strike is not None and prev_cum > 0 and cumulative <= 0:
                if prev_cum - cumulative != 0:
                    t = prev_cum / (prev_cum - cumulative)
                    zero_gamma = prev_strike - t * (prev_strike - s["strike"])
                else:
                    zero_gamma = s["strike"]
                break
            prev_strike = s["strike"]
            prev_cum = cumulative

    if zero_gamma is None and spot > 0:
        below_spot = [s for s in strikes_list if s["strike"] < spot]
        for s in reversed(below_spot):
            if s["gex"] < 0:
                zero_gamma = s["strike"]
                break

    if zero_gamma is None and spot > 0 and call_wall:
        threshold = abs(call_wall["callGex"]) * 0.01
        below_spot = [s for s in strikes_list if s["strike"] < spot]
        for s in reversed(below_spot):
            if s["gex"] < threshold:
                zero_gamma = s["strike"]
                break

    if zero_gamma is None and put_wall:
        zero_gamma = put_wall["strike"]

    total_chain_contracts = contracts_with_dp + contracts_without_dp
    coverage_pct = (
        contracts_with_dp / total_chain_contracts if total_chain_contracts > 0 else 0
    )

    # Build the {strike, gex} dicts used by the classifier. These match
    # the shape returned in callWall/putWall fields so frontends can
    # cross-reference if needed.
    cw_dict = {"strike": call_wall["strike"], "gex": call_wall["callGex"]} if call_wall else None
    pw_dict = {"strike": put_wall["strike"],  "gex": put_wall["putGex"]}  if put_wall  else None
    classification = classify_gex_state(
        spot=spot,
        call_wall=cw_dict,
        put_wall=pw_dict,
        zero_gamma=zero_gamma,
    )

    return {
        "ticker": ticker,
        "spot": spot,
        "totalGex": total_gex,
        "callGex": total_call_gex,
        "putGex": total_put_gex,
        "zeroGamma": zero_gamma,
        "netDelta": round(net_delta),
        "callWall": cw_dict,
        "putWall": pw_dict,
        "strikes": strikes_list,
        "dteFilter": dte_filter,
        # ── Trade-aware metadata ──────────────────────────────────────
        "adjusted": adjusted,
        "attributionDays": attribution_days,
        "avgConfidence": round(avg_confidence, 3),
        "coveragePct": round(coverage_pct, 3),
        "contractsWithDp": contracts_with_dp,
        "contractsWithoutDp": contracts_without_dp,
        # ── Classification (new) ──────────────────────────────────────
        # Frontends should prefer levels[].label over hardcoded
        # "Floor"/"Ceiling" — and gate the "below danger" warning on
        # warnings.below_danger_active rather than spot<zeroGamma.
        "levels": classification["levels"],
        "regime": classification["regime"],
        "asymmetryPct": classification["asymmetry_pct"],
        "warnings": classification["warnings"],
    }


async def get_gex_compare(ticker: str, dte_filter: str = "all") -> dict:
    """Returns naive + adjusted GEX side-by-side with per-strike deltas.

    Two sequential calls to get_gex_data — naive then adjusted — packaged
    with strike-level comparison and summary shifts. Spot drift between
    the two snapshots is typically <1bp; for GEX (which scales with spot²)
    that's negligible vs the signal we're measuring. If we ever need
    pixel-perfect comparison, refactor get_gex_data to share the chain
    fetch between modes.

    Response shape:
      { ticker, spot, spotAdjusted, dteFilter,
        naive:    {...flat summary + levels/regime/warnings...},
        adjusted: {...flat summary + attributionDays/coverage/confidence
                   + levels/regime/warnings...},
        delta: {
          totalGexPctChange, call/putGexPctChange,
          zeroGammaShift, callWallShift, putWallShift,
          regimeChange, signFlippedStrikes,
          strikes: [{...per-strike delta...}]
        }
      }
    """
    naive = await get_gex_data(ticker, dte_filter, adjusted=False)
    if "error" in naive:
        return {"error": f"naive: {naive['error']}"}

    adjusted = await get_gex_data(ticker, dte_filter, adjusted=True)
    if "error" in adjusted:
        return {"error": f"adjusted: {adjusted['error']}"}

    # Per-strike deltas. Outer-join on strike so we don't drop anything
    # that only appears in one set (shouldn't happen since both pull from
    # the same chain, but cheap insurance).
    naive_by_strike = {s["strike"]: s for s in naive["strikes"]}
    adj_by_strike = {s["strike"]: s for s in adjusted["strikes"]}
    all_strikes = sorted(set(naive_by_strike) | set(adj_by_strike))

    delta_strikes = []
    for strike in all_strikes:
        n = naive_by_strike.get(strike, {})
        a = adj_by_strike.get(strike, {})
        n_gex = n.get("gex", 0)
        a_gex = a.get("gex", 0)
        delta_strikes.append({
            "strike": strike,
            "naiveGex": n_gex,
            "adjustedGex": a_gex,
            "deltaGex": a_gex - n_gex,
            "deltaPct": round((a_gex - n_gex) / abs(n_gex) * 100, 2) if n_gex != 0 else None,
            "callOI": n.get("callOI", a.get("callOI", 0)),
            "putOI": n.get("putOI", a.get("putOI", 0)),
            # Sign flip = ceiling became floor (or vice versa). These are
            # the strikes where customer-sold flow most changes the regime,
            # and the most interesting ones to validate against SpotGamma.
            "signFlipped": (n_gex * a_gex < 0) if (n_gex != 0 and a_gex != 0) else False,
        })

    def _pct(new_v, old_v):
        return round((new_v - old_v) / abs(old_v) * 100, 2) if old_v != 0 else None

    def _wall_shift(a_wall, n_wall):
        if not a_wall or not n_wall:
            return None
        return round(a_wall["strike"] - n_wall["strike"], 2)

    zg_n = naive["zeroGamma"]
    zg_a = adjusted["zeroGamma"]
    return {
        "ticker": ticker.upper().strip(),
        "spot": naive["spot"],
        "spotAdjusted": adjusted["spot"],  # surface both so drift is visible
        "dteFilter": dte_filter,
        "naive": {
            "totalGex": naive["totalGex"],
            "callGex": naive["callGex"],
            "putGex": naive["putGex"],
            "zeroGamma": zg_n,
            "callWall": naive["callWall"],
            "putWall": naive["putWall"],
            "netDelta": naive["netDelta"],
            # Classification surfaced so the validation UI can compare
            # not just numbers but regime labels
            "levels": naive["levels"],
            "regime": naive["regime"],
            "asymmetryPct": naive["asymmetryPct"],
            "warnings": naive["warnings"],
        },
        "adjusted": {
            "totalGex": adjusted["totalGex"],
            "callGex": adjusted["callGex"],
            "putGex": adjusted["putGex"],
            "zeroGamma": zg_a,
            "callWall": adjusted["callWall"],
            "putWall": adjusted["putWall"],
            "netDelta": adjusted["netDelta"],
            "attributionDays": adjusted["attributionDays"],
            "avgConfidence": adjusted["avgConfidence"],
            "coveragePct": adjusted["coveragePct"],
            "contractsWithDp": adjusted["contractsWithDp"],
            "contractsWithoutDp": adjusted["contractsWithoutDp"],
            "levels": adjusted["levels"],
            "regime": adjusted["regime"],
            "asymmetryPct": adjusted["asymmetryPct"],
            "warnings": adjusted["warnings"],
        },
        "delta": {
            "totalGexPctChange": _pct(adjusted["totalGex"], naive["totalGex"]),
            "callGexPctChange": _pct(adjusted["callGex"], naive["callGex"]),
            "putGexPctChange":  _pct(adjusted["putGex"],  naive["putGex"]),
            "zeroGammaShift": (round(zg_a - zg_n, 2) if (zg_n is not None and zg_a is not None) else None),
            "callWallShift": _wall_shift(adjusted["callWall"], naive["callWall"]),
            "putWallShift":  _wall_shift(adjusted["putWall"],  naive["putWall"]),
            "regimeChange": (
                None if naive["regime"] == adjusted["regime"]
                else f"{naive['regime']} → {adjusted['regime']}"
            ),
            "signFlippedStrikes": sum(1 for s in delta_strikes if s["signFlipped"]),
            "strikes": delta_strikes,
        },
    }
