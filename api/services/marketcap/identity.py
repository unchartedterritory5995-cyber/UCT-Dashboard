"""Minimum durable identity: ISSUER (SEC CIK) -> SECURITY -> time-bounded TICKER listing intervals.

bars.db is keyed by TICKER and a ticker is reused across issuers (ARM = ArvinMeritor 2003-2011, Arm Holdings from
2023-09-14). Bars are never rewritten; this module decides which of a ticker's days belong to the issuer's
security and gives every other day a reason:

  listing start
    1. Massive `list_date`, but ONLY when the Massive record's CIK equals the issuer's CIK;
    2. otherwise the start of the last bar segment when an earlier segment is PROVABLY another issuer
       (it ended before the issuer's CIK first filed with the SEC, while EDGAR was complete for that issuer);
    3. otherwise the first bar (no evidence of a different issuer).
  days before the start
    TICKER_REUSE_DIFFERENT_ISSUER  when provably another issuer (segment ended before the CIK existed on EDGAR,
                                   or separated from the listing by a trading gap > GAP_DAYS)
    NOT_YET_LISTED                 otherwise (pre-listing / when-issued / unverified prior trading)
  listing end
    Massive `delisted_utc` for an inactive record whose CIK matches; days after it -> DELISTED.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from . import reasons as R
from .engine import Listing

GAP_DAYS = 90
EDGAR_DOMESTIC = date(1996, 5, 6)     # phase-in complete for domestic registrants
EDGAR_FOREIGN = date(2002, 5, 6)      # mandatory electronic filing for foreign private issuers


@dataclass
class Ref:
    """The subset of a Massive ticker reference record this module uses."""
    ticker: str
    cik: int | None = None
    list_date: date | None = None
    active: bool | None = None
    delisted: date | None = None
    type: str | None = None
    composite_figi: str | None = None
    share_class_figi: str | None = None
    events: list = field(default_factory=list)      # [(date, "ticker_change", new_ticker)]
    # CURRENT counts, used ONLY as a multi-class DETECTION signal (never as a value: not PIT, no provenance)
    share_class_shares: float | None = None
    weighted_shares: float | None = None
    name: str | None = None                          # Massive security name (instrument-kind screening only)


@dataclass
class ListingDecision:
    listing: Listing
    basis: str                       # MASSIVE_LIST_DATE | SEGMENT_AFTER_REUSE | FIRST_BAR
    pre_reason: str | None           # reason for bars before listing.start (None when there are none)
    pre_bars: int = 0
    post_bars: int = 0
    notes: list = field(default_factory=list)


def segments(days: list[date], gap_days: int = GAP_DAYS) -> list[tuple[date, date]]:
    if not days:
        return []
    out, s = [], days[0]
    for a, b in zip(days, days[1:]):
        if (b - a).days > gap_days:
            out.append((s, a))
            s = b
    out.append((s, days[-1]))
    return out


def decide(ticker: str, cik: int, days: list[date], ref: Ref | None, cik_first_filing: date | None,
           foreign: bool = False) -> ListingDecision | None:
    if not days:
        return None
    segs = segments(days)
    edgar = EDGAR_FOREIGN if foreign else EDGAR_DOMESTIC
    notes = []

    def provably_other(seg_end: date) -> bool:
        # the CIK did not exist on EDGAR while this segment traded, although EDGAR covered such issuers then
        return cik_first_filing is not None and seg_end < cik_first_filing and seg_end >= edgar

    ref_ok = ref is not None and ref.cik is not None and int(ref.cik) == int(cik)
    if ref is not None and ref.cik is not None and not ref_ok:
        notes.append(f"massive cik {ref.cik} != issuer cik {cik}: list_date ignored")
    if ref_ok and ref.list_date:
        start = next((d for d in days if d >= ref.list_date), None)
        basis = "MASSIVE_LIST_DATE"
        if start is None:
            return None
    else:
        start, basis = days[0], "FIRST_BAR"
        for s, e in segs[:-1]:
            if provably_other(e):
                nxt = segs[segs.index((s, e)) + 1][0]
                start, basis = nxt, "SEGMENT_AFTER_REUSE"
    pre = [d for d in days if d < start]
    pre_reason = None
    if pre:
        last_pre = pre[-1]
        gap = (start - last_pre).days
        pre_reason = R.TICKER_REUSE if (provably_other(last_pre) or gap > GAP_DAYS) else R.NOT_YET_LISTED
    end = None
    if ref_ok and ref.active is False and ref.delisted:
        end = ref.delisted
    lst = Listing(ticker, start, end, prior_other_issuer=(pre_reason == R.TICKER_REUSE))
    return ListingDecision(lst, basis, pre_reason, len(pre), len([d for d in days if d >= start]), notes)


def day_reason(dec: ListingDecision, d: date) -> str | None:
    if d < dec.listing.start:
        return dec.pre_reason or R.NOT_YET_LISTED
    if dec.listing.end is not None and d > dec.listing.end:
        return R.DELISTED
    return None
