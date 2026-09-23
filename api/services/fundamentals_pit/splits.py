"""Share-basis conversion for per-share values and share counts.

Charts draw SPLIT-ADJUSTED prices (bars.db is adjusted to the basis current at
fetch time). A per-share fundamental drawn against those prices must be on the
SAME basis, or a P/E jumps 10x on NVDA's 2024 split. Converting a reported
per-share value to today's basis is a UNIT conversion (exactly what the price
series already does), not a disclosure of future information.

Which basis a reported number is in:
  * statement per-share values and weighted shares (EPS, DPS): the basis at the
    filing's PUBLIC date -- US GAAP (ASC 260-10-55-12) restates per-share data
    for a split that occurs before the statements are issued;
  * a cover-page share COUNT (dei): the basis on its own "as of" date.

    today_value = reported / F(after basis date)      per-share
    today_value = reported * F(after basis date)      share counts
    F(after d)  = product of ratios of splits with ex_date > d

A Ledger is supplied by the caller (production: a persisted split ledger;
the POC used Yahoo's split history as an independent stand-in). `infer_splits`
recovers split events from the SEC data ALONE -- the same period's per-share
value restated across filings by a clean ratio -- so a ledger can be verified
against the filings rather than trusted.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Split:
    ex_date: date
    ratio: float                     # new shares per old share (4.0 = 4-for-1)


class Ledger:
    def __init__(self, splits: list[Split] | tuple = ()):
        self.splits = tuple(sorted(splits, key=lambda s: s.ex_date))

    def factor_after(self, d: date) -> float:
        f = 1.0
        for s in self.splits:
            if s.ex_date > d:
                f *= s.ratio
        return f

    def per_share_today(self, val: float, basis_date: date) -> float:
        return val / self.factor_after(basis_date)

    def shares_today(self, val: float, basis_date: date) -> float:
        return val * self.factor_after(basis_date)


_CLEAN = (1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 15.0, 20.0, 25.0, 30.0, 40.0, 50.0)


def infer_splits(pairs: list[tuple[date, float, date, float]], tol: float = 0.02) -> list[tuple]:
    """`pairs`: (public_date_a, value_a, public_date_b, value_b) for the SAME
    per-share period key reported by two filings (a earlier). A ratio a/b close
    to a clean split factor (or its reciprocal, for a reverse split) implies a
    split effective in (public_date_a, public_date_b]. Returns
    [(after, until, ratio)]; small restatements (ratio ~1) are ignored."""
    out = []
    for da, va, db, vb in pairs:
        if not va or not vb or (va > 0) != (vb > 0):
            continue
        r = va / vb
        for c in _CLEAN:
            for cand in (c, 1.0 / c):
                if abs(r / cand - 1.0) <= tol:
                    out.append((da, db, cand))
    return out
