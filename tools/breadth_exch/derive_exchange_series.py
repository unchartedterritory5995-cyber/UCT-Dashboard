"""Exchange Breadth V1 — derived series from exchange base data (Phase 3).

Locked methodology (owner, 2026-10-03):
  {X}:AD   adline-v1: level(t) = level(t-1) + (ADV - DEC), base 0 from the declared start (the
           exchange's first session); a hole HOLDS the level; no vendor seed.
  {X}:MCO  ratio-adjusted McClellan: R = (ADV - DEC)/(ADV + DEC) * 1000 (unchanged excluded),
           trends 0.10 / 0.05, seed 0; a hole advances neither trend. NOT PUBLISHED inside the
           burn-in: values exist only from the first session with 120 real observations behind it.
  {X}:MCS  summation of {X}:MCO, DECLARED epoch = the MCO's first trustworthy session, base 0.

Pure: everything is computed from (dates, adv, dec) with the shared engine
`api.services.market_indicators.mcclellan` — the module verified against McClellan Financial's
published series. No store, no network.
"""
from __future__ import annotations

from typing import Optional, Sequence

from api.services.market_indicators import mcclellan as mc

METHOD = mc.RATIO_ADJUSTED
assert mc.ALPHA_19 == 0.10 and mc.ALPHA_39 == 0.05 and METHOD.burn_in == 120


def ad_line(adv: Sequence[Optional[float]], dec: Sequence[Optional[float]]) -> list[Optional[float]]:
    out, level, started = [], 0.0, False
    for a, d in zip(adv, dec):
        if a is None or d is None:
            out.append(level if started else None)
            continue
        level += float(a) - float(d)
        started = True
        out.append(level)
    return out


def derive(dates: Sequence[str], adv: Sequence[Optional[float]], dec: Sequence[Optional[float]]) -> dict:
    """{'AD', 'MCO', 'MCS', 'epoch'} aligned with `dates`; unpublished cells are None."""
    if not (len(dates) == len(adv) == len(dec)):
        raise ValueError("dates, adv and dec must align")
    if list(dates) != sorted(dates) or len(set(dates)) != len(dates):
        raise ValueError("dates must be strictly ascending")
    res = mc.compute(list(dates), list(adv), list(dec), method=METHOD, anchor=None,
                     seed_mode=mc.SEED_ZERO)
    osc = res.oscillator
    idx = mc.first_trustworthy_index(osc, METHOD)
    mco = [None] * len(dates)
    mcs = [None] * len(dates)
    epoch = None
    if idx is not None:
        epoch = dates[idx]
        mco[idx:] = osc[idx:]
        mcs = mc.summation_series(list(dates), osc, mc.Anchor(at=epoch, value=0.0, source="declared"),
                                  method=METHOD)
    return {"AD": ad_line(adv, dec), "MCO": mco, "MCS": mcs, "epoch": epoch}
