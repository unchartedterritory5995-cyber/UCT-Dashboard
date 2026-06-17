"""Pure performance math: deposit/withdrawal-adjusted returns. No I/O.

External flows (deposits/withdrawals/transfers) are the ONLY adjustment —
internal flows (dividends/interest/fees) are already reflected in the equity
series, so they're never subtracted here. Convention: a flow dated `d` is
applied at the START of the sub-period beginning `d`, so the sub-period return
strips the flow from the end value: `(V_d - F_d) / V_prev`.
"""

from __future__ import annotations

from datetime import date as _date


def _flows_by_date(external_flows) -> dict[str, float]:
    out: dict[str, float] = {}
    for d, a in external_flows:
        out[d] = out.get(d, 0.0) + a
    return out


def time_weighted_return(equity, external_flows) -> float | None:
    """equity = [(date, value), ...] ascending; external_flows = [(date, signed)].
    Returns the time-weighted return as a fraction, or None if < 2 points or any
    sub-period starts from a non-positive value."""
    if not equity or len(equity) < 2:
        return None
    fbd = _flows_by_date(external_flows)
    growth = 1.0
    prev_val = equity[0][1]
    if prev_val <= 0:
        return None
    for d, v in equity[1:]:
        if prev_val <= 0:
            return None
        flow = fbd.get(d, 0.0)
        sub = (v - flow) / prev_val
        growth *= sub
        prev_val = v
    return growth - 1.0


def simple_return(start_equity, end_equity, net_external) -> float | None:
    """(end - start - netExternalFlows) / start. None if start <= 0."""
    if start_equity is None or start_equity <= 0:
        return None
    return (end_equity - start_equity - net_external) / start_equity


def dollar_pnl(start_equity, end_equity, net_external) -> float:
    """True gain net of external flows."""
    return round(end_equity - start_equity - net_external, 2)
