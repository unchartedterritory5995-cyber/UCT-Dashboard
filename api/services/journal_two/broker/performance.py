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


def _to_date(s: str) -> _date:
    return _date.fromisoformat(s[:10])


def _npv(rate: float, flows: list[tuple[_date, float]], t0: _date) -> float:
    total = 0.0
    for d, amt in flows:
        yrs = (d - t0).days / 365.0
        total += amt / ((1.0 + rate) ** yrs)
    return total


def money_weighted_return(cash_flows) -> float | None:
    """Annualized money-weighted return (XIRR) via bisection on NPV.

    `cash_flows` are dated signed amounts from the INVESTOR's perspective:
    start equity is a negative flow (money in), deposits negative, withdrawals
    positive, end value positive. Returns None if there's no sign change to
    bracket a root, or on degenerate input.
    """
    if not cash_flows or len(cash_flows) < 2:
        return None
    flows = sorted(((_to_date(d), a) for d, a in cash_flows), key=lambda x: x[0])
    if not (any(a < 0 for _, a in flows) and any(a > 0 for _, a in flows)):
        return None
    t0 = flows[0][0]
    lo, hi = -0.9999, 100.0
    f_lo, f_hi = _npv(lo, flows, t0), _npv(hi, flows, t0)
    if f_lo * f_hi > 0:
        return None  # can't bracket a root in [-99.99%, 10000%]
    for _ in range(200):
        mid = (lo + hi) / 2.0
        f_mid = _npv(mid, flows, t0)
        if abs(f_mid) < 1e-7:
            return round(mid, 6)
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return round((lo + hi) / 2.0, 6)
