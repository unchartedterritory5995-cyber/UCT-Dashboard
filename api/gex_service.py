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

The trade-aware path requires dealer_positioning data to exist for the
ticker. Contracts without coverage fall back to naive (customer_factor =
1.0). The response includes a `confidence` field (0-1) reporting the
OI-weighted average flow_confidence across contracts that DO have data,
plus an `attribution_days` count so the UI can decide whether enough
history exists to trust the adjustment.
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

    return {
        "ticker": ticker,
        "spot": spot,
        "totalGex": total_gex,
        "callGex": total_call_gex,
        "putGex": total_put_gex,
        "zeroGamma": zero_gamma,
        "netDelta": round(net_delta),
        "callWall": {"strike": call_wall["strike"], "gex": call_wall["callGex"]} if call_wall else None,
        "putWall": {"strike": put_wall["strike"], "gex": put_wall["putGex"]} if put_wall else None,
        "strikes": strikes_list,
        "dteFilter": dte_filter,
        # Trade-aware metadata. When adjusted=False these are zero/null —
        # the frontend uses them to decide whether to show the confidence
        # badge and "Using N days of flow attribution" indicator.
        "adjusted": adjusted,
        "attributionDays": attribution_days,
        "avgConfidence": round(avg_confidence, 3),
        "coveragePct": round(coverage_pct, 3),
        "contractsWithDp": contracts_with_dp,
        "contractsWithoutDp": contracts_without_dp,
    }
