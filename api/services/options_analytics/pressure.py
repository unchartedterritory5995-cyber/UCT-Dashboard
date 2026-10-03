"""FT-049 beyond gamma (lane/o-options-remainders): delta-pressure and charm heatmaps by strike x
expiry, over the SAME cached chain the gamma heatmap reads (`positioning.chain`).

  delta  per cell: delta x open interest x 100 x spot -- customer-held delta notional, in dollars.
         Under the naive convention (dealers short what customers hold) dealers carry the opposite.
  charm  per cell: dDelta/dt per calendar day x open interest x 100 x spot -- how many dollars of
         delta the cell's hedges shift by tomorrow from time passing alone.

⛔ CHARM IS DERIVED, AND SAYS HOW. The positioning chain carries the vendor's delta and gamma but
   no IV. Under Black-Scholes with a zero rate and no dividends, d1 = N^-1(call delta) (put: N^-1(
   delta + 1)), sigma x sqrt(t) = n(d1) / (spot x gamma), d2 = d1 - sigma x sqrt(t), and
   charm = n(d1) x d2 / (2 t) per year. A contract with a delta at 0 or 1, no gamma, or expiring
   today has no defined charm here: its cell is blank and counted, never zero.
⛔ NOT BUILT: the forward projection and a 1-minute refresh (this reads the 60 s chain cache).
"""
from __future__ import annotations

import datetime as _dt
from statistics import NormalDist
from typing import Optional

from api.services.options_analytics import positioning as pos

_N = NormalDist()

DELTA_METHOD = ("Delta pressure per expiration and strike: vendor delta x open interest x 100 x "
                "spot, summed per cell -- the dollar delta customers hold (calls positive, puts "
                "negative). Under the naive convention dealers hold the opposite and hedge it in "
                "the stock. The nearest expirations and the strikes closest to spot are shown.")
CHARM_METHOD = ("Charm per expiration and strike: the change in delta per calendar day from time "
                "passing alone, x open interest x 100 x spot, summed per cell. Black-Scholes with "
                "a zero rate and no dividends; sigma x sqrt(t) is recovered from the vendor's own "
                "delta and gamma because this chain carries no IV. Contracts expiring today, or "
                "with a delta at 0/1 or no gamma, are left out and counted.")
NOT_BUILT = "A forward projection and a 1-minute refresh are not built; this reads the 60 s chain cache."


def charm_per_day(cp: str, delta: float, gamma: float, spot: float, days: int) -> Optional[float]:
    """dDelta/dt per calendar day for one contract, or None when the model has no answer."""
    if days < 1 or not gamma or gamma <= 0 or spot <= 0:
        return None
    nd = delta if cp == "C" else delta + 1.0
    if not 0.0 < nd < 1.0:
        return None
    d1 = _N.inv_cdf(nd)
    sst = _N.pdf(d1) / (spot * gamma)
    if sst <= 0:
        return None
    t = days / 365.0
    d2 = d1 - sst
    return _N.pdf(d1) * d2 / (2 * t) / 365.0


def _days(exp: str, today: _dt.date) -> Optional[int]:
    try:
        return (_dt.date.fromisoformat(exp) - today).days
    except (TypeError, ValueError):
        return None


def _grid(cells: dict, spot: float) -> tuple:
    exps = sorted({e for e, _ in cells})[:pos.HEATMAP_MAX_EXPIRATIONS]
    strikes = sorted({s for e, s in cells if e in exps}, key=lambda s: abs(s - spot))[:pos.HEATMAP_MAX_STRIKES]
    strikes.sort()
    grid = [[(round(cells[(e, s)]) if (e, s) in cells else None) for s in strikes] for e in exps]
    flat = [v for row in grid for v in row if v is not None]
    return exps, strikes, grid, max((abs(v) for v in flat), default=0)


def delta_heatmap_from(sym: str, dte: str, ch: dict) -> dict:
    spot = ch["spot"]
    cells: dict = {}
    missing = 0
    for r in ch["rows"]:
        if r["oi"] is None or r["delta"] is None:
            missing += 1
            continue
        if r["oi"] <= 0:
            continue
        k = (r["expiration"], r["strike"])
        cells[k] = cells.get(k, 0.0) + r["delta"] * r["oi"] * 100 * spot
    exps, strikes, grid, mx = _grid(cells, spot)
    return {**pos._base(sym, dte, ch, DELTA_METHOD), "measure": "delta", "expirations": exps,
            "strikes": strikes, "cells": grid, "max_abs": mx, "unit": "$ of customer-held delta",
            "contracts_missing_inputs": missing, "not_built": NOT_BUILT,
            "note": "A blank cell is a strike with no computable contract at that expiry, never zero."}


def charm_heatmap_from(sym: str, dte: str, ch: dict, today: Optional[_dt.date] = None) -> dict:
    spot = ch["spot"]
    today = today or _dt.datetime.now(pos._ET).date()
    cells: dict = {}
    missing = undefined = 0
    for r in ch["rows"]:
        if r["oi"] is None or r["delta"] is None or r["gamma"] is None:
            missing += 1
            continue
        if r["oi"] <= 0:
            continue
        days = _days(r["expiration"], today)
        c = charm_per_day(r["cp"], float(r["delta"]), float(r["gamma"]), spot, days if days is not None else -1)
        if c is None:
            undefined += 1
            continue
        k = (r["expiration"], r["strike"])
        cells[k] = cells.get(k, 0.0) + c * r["oi"] * 100 * spot
    exps, strikes, grid, mx = _grid(cells, spot)
    return {**pos._base(sym, dte, ch, CHARM_METHOD), "measure": "charm", "expirations": exps,
            "strikes": strikes, "cells": grid, "max_abs": mx, "unit": "$ of delta per calendar day",
            "contracts_missing_inputs": missing, "contracts_without_defined_charm": undefined,
            "not_built": NOT_BUILT,
            "note": "A blank cell is a strike with no computable contract at that expiry, never zero."}


async def delta_heatmap(sym: str, dte: str = "month") -> dict:
    async def build():
        return delta_heatmap_from(sym, dte, await pos.chain(sym, dte))
    return await pos._cached("delta_heatmap", sym, dte, build)


async def charm_heatmap(sym: str, dte: str = "month") -> dict:
    async def build():
        return charm_heatmap_from(sym, dte, await pos.chain(sym, dte))
    return await pos._cached("charm_heatmap", sym, dte, build)
