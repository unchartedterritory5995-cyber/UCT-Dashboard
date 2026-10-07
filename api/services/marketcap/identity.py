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


MASSIVE_EVENTS_START = date(2003, 10, 10)   # Massive's ticker history starts 2003-09-10: an event then is the INITIAL symbol


def foreign_ticker_end(ticker: str, days: list[date], events: list) -> date | None:
    """The end of the last span in which the issuer traded under ANOTHER symbol while bars of `ticker` exist.

    `events`: [(date, "ticker_change", new_symbol)]. From each event on, the issuer's symbol is that event's. Before the
    first event: the first event's symbol when it is the initial record (dated at the start of Massive's history);
    otherwise (a later change TO a symbol) the issuer traded under something else before it. When the last event is to
    another symbol although this record's ticker is current (a return missing from the history: Fiserv FISV -> FI 2023
    -> FISV), the foreign span ends where this ticker's last bar segment begins."""
    norm = lambda s: (s or "").upper().replace(".", "-")
    T = norm(ticker)
    ev = sorted((d, norm(x)) for d, typ, x in events if d and typ == "ticker_change" and x)
    if not ev:
        return None
    spans = []
    d0, x0 = ev[0]
    if x0 != T or d0 > MASSIVE_EVENTS_START:
        spans.append((date.min, d0))
    for i, (d, x) in enumerate(ev):
        if x == T:
            continue
        if i + 1 < len(ev):
            spans.append((d, ev[i + 1][0]))
        else:
            last_seg = segments(days)[-1][0] if days else d
            spans.append((d, max(d, last_seg)))
    # a provider-STITCHED history (the same security renamed: FB -> META, GOOG -> GOOGL class A) is continuous through
    # the change; another issuer's use of the symbol is separated from this issuer's by a > GAP_DAYS break in the bars
    segs = segments(days)
    out = None
    for s, e in spans:
        if not any(s <= b < e for b in days):
            continue
        seg = next((g for g in segs if g[1] >= e), None)
        if seg is None or seg[0] >= e - timedelta(days=10):
            out = max(out, seg[0] if seg else e) if out else (seg[0] if seg else e)
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
    # ⛔ THE ISSUER'S OWN TICKER HISTORY (Massive ticker_change events of the record whose CIK is this issuer's): bars of
    # this ticker while the issuer traded under ANOTHER symbol are another issuer's (Cencora: ABC until 2023-08-30 --
    # "COR" before it was CoreSite and others; Waste Management: WMI until 2009-08-06 -- "WM" before it was Washington
    # Mutual; 3D Systems: TDSC until 2011-05-27). Everything up to the last such span that holds bars is withheld.
    reuse_end = foreign_ticker_end(ticker, days, ref.events) if ref_ok and ref.events else None
    if reuse_end is not None and reuse_end > start:
        nxt = next((d for d in days if d >= reuse_end), None)
        if nxt is None:
            return None
        start, basis = nxt, "TICKER_EVENTS"
        notes.append(f"issuer traded under another ticker until {reuse_end}")
    pre = [d for d in days if d < start]
    pre_reason = None
    if pre:
        last_pre = pre[-1]
        gap = (start - last_pre).days
        pre_reason = R.TICKER_REUSE if (provably_other(last_pre) or gap > GAP_DAYS or basis == "TICKER_EVENTS") else R.NOT_YET_LISTED
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
