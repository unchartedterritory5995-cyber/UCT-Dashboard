"""The canonical Market Cap engine: share states x the right price, per issuer, per trading day.

    company_market_cap(d) = sum over ECONOMIC components c of  shares_c(d) * multiplier_c(d) * close_{price_c}(d)

  * single class          one component, multiplier 1, its own ticker's close;
  * multiple listed       one component per listed class, each priced by ITS OWN ticker (GOOGL + GOOG);
  * unlisted convertible  shares of the unlisted class * authoritative conversion ratio * the listed class's close;
  * voting-only classes   not components (no economic interest -> no double counting);
  * ADR/ADS               ordinary shares * (ADS per ordinary, time-aware) * the ADS close -- never ADS price x
                          ordinary shares;
  * complex / unresolved  no value; the structure's reason code for every day.

security_market_cap is one listed class x its own price and is a separate output: under GOOG and GOOGL the
product field "Market Cap" is the SAME company number.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from . import reasons as R
from .state import DayState


@dataclass(frozen=True)
class Listing:
    ticker: str
    start: date                        # first legitimate trading day of THIS security under this ticker
    end: date | None = None            # last day (delisting / ticker change), None = current
    prior_other_issuer: bool = False   # bars exist under this ticker before `start` for a DIFFERENT issuer


@dataclass(frozen=True)
class Component:
    class_key: str                     # share-state series key ("COMMON", "CLASS_A", "TOTAL", ...)
    price_ticker: str                  # the listed ticker whose close values this component
    multipliers: tuple = ((None, None, 1.0),)   # (start|None, end|None, multiplier): conversion / ADS ratio
    evidence: str = ""                 # accession / registry id that authorizes the multiplier
    start: date | None = None          # the class exists from (e.g. GOOG class C from 2014-04-03)
    end: date | None = None

    def active(self, d: date) -> bool:
        return (self.start is None or d >= self.start) and (self.end is None or d <= self.end)

    def multiplier(self, d: date) -> float | None:
        for s, e, m in self.multipliers:
            if (s is None or d >= s) and (e is None or d <= e):
                return m
        return None


@dataclass
class Structure:
    kind: str                          # SINGLE | MULTI_LISTED | LISTED_PLUS_CONVERTIBLE | ADR | UNRESOLVED
    components: list = field(default_factory=list)
    reason: str | None = None          # for UNRESOLVED: MULTI_CLASS / COMPLEX / ADR_RATIO / QUARANTINED / WITHHELD
    note: str = ""


@dataclass(frozen=True)
class CapDay:
    d: date
    value: float | None
    reason: str | None
    detail: tuple = ()                 # per component: (class_key, shares, multiplier, ticker, close, accn)


def listing_reason(lst: Listing, d: date) -> str | None:
    if d < lst.start:
        return R.TICKER_REUSE if lst.prior_other_issuer else R.NOT_YET_LISTED
    if lst.end is not None and d > lst.end:
        return R.DELISTED
    return None


def company_cap(days: list[date], structure: Structure, states: dict[str, dict[date, DayState]],
                closes: dict[str, dict[date, float]], listings: dict[str, Listing], primary: str | None = None) -> list[CapDay]:
    """One CapDay per requested day. `states[class_key][d]`, `closes[ticker][d]`, `listings[ticker]`.
    The primary ticker's listing interval is checked FIRST: a day that is not this issuer's trading day (ticker
    reuse, not yet listed, delisted) carries that reason whatever the structure."""
    out = []
    for d in days:
        if primary is not None and primary in listings:
            lr = listing_reason(listings[primary], d)
            if lr:
                out.append(CapDay(d, None, lr))
                continue
        if structure.kind == "UNRESOLVED":
            out.append(CapDay(d, None, structure.reason or R.MULTI_CLASS))
            continue
        total, detail, why = 0.0, [], None
        for c in structure.components:
            if not c.active(d):
                continue
            lst = listings.get(c.price_ticker)
            if lst is None:
                why = R.BUG
                break
            lr = listing_reason(lst, d)
            if lr:
                why = lr
                break
            px = closes.get(c.price_ticker, {}).get(d)
            if px is None or not px > 0:
                why = R.NO_VALID_PRICE
                break
            st = states.get(c.class_key, {}).get(d)
            if st is None:
                why = R.BUG
                break
            if st.value is None:
                why = st.reason
                break
            m = c.multiplier(d)
            if m is None:
                why = R.ADR_RATIO if structure.kind == "ADR" else R.MULTI_CLASS
                break
            total += st.value * m * px
            detail.append((c.class_key, st.value, m, c.price_ticker, px, st.obs.accn if st.obs else ""))
        if not why and not detail:
            why = R.NOT_YET_LISTED
        out.append(CapDay(d, None if why else total, why, tuple(detail) if not why else ()))
    return out
