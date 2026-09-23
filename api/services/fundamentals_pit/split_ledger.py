"""The persisted split ledger, and the proof that it agrees with the filings.

SOURCE. One confirmed split source already exists and is NOT duplicated:
`reference_corp_actions.fetch_confirmed_splits` (Massive `/v3/reference/splits`).
`massive_rows` adapts its rows into `split_event` (store.py). Production
serving accepts only PRODUCTION_SOURCES; tests and local scratch runs name
their fixture source explicitly, so a stand-in can never leak into production.

BASIS. Measured facts this module relies on (see docs/fundamentals-pit):
  * UCT bars are split-adjusted to TODAY: bars.db closes are continuous across
    all 16 split ex-dates checked (AAPL, NVDA, CELH incl. a 1:20 reverse,
    SMCI, TSLA, GOOGL, AMZN, WMT; 2005-2024).
  * SEC per-share values are in the share basis of the FILING that reported
    them; a filing issued after a split recasts its comparatives (ASC 260).
  * So a reported per-share value is converted to today's basis by the splits
    AFTER its filing's public date (splits.Ledger), a cover-page share count by
    the splits after its own "as of" date. A value is converted exactly once:
    a post-split filing's basis date already lies past the split.

VERIFY, DON'T TRUST. `verify` checks the ledger against the SEC evidence of the
same company:
  every WINDOW of re-reported per-share periods (the same period in an
  earlier and a later filing -- NVDA 5.98 -> 0.60) must be explained by the
  ledger's splits inside that window. A missing split (ledger 1, filings 10),
  a split applied twice (ledger 100, filings 10) or a misdated one all leave
  a window the ledger cannot explain.
A security that fails is UNVERIFIED and every split-sensitive metric (EPS,
shares, market cap, P/E, P/S, P/B, FCF yield) is WITHHELD for it. Reported
dollar metrics (revenue, margins, cash...) are unaffected.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from .filings import ET
from .splits import Ledger, Split

PRODUCTION_SOURCES = ("massive",)
PER_SHARE_TAGS = ("us-gaap:EarningsPerShareDiluted", "us-gaap:EarningsPerShareBasic",
                  "us-gaap:EarningsPerShareBasicAndDiluted")
SHARE_COUNT_TAGS = ("us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
                    "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic")
SPLIT_SENSITIVE_METRICS = frozenset({
    "eps_diluted_ttm", "eps_diluted_q", "eps_growth_ttm", "eps_growth_yoy_q",
    "shares_outstanding", "shares_diluted_q", "dividends_per_share_ttm",
    "market_cap", "pe_ttm", "ps_ttm", "pb", "fcf_yield", "dividend_yield",
})


def massive_rows(from_iso: str, to_iso: str) -> list[tuple]:
    """(ticker, ex_date, ratio, source_ref) from the existing confirmed-splits
    adapter. Massive reports `split_from` -> `split_to` (e.g. 1 -> 10)."""
    from api.services import reference_corp_actions as rca
    out = []
    for r in rca.fetch_confirmed_splits(from_iso, to_iso):
        try:
            ratio = float(r["split_to"]) / float(r["split_from"])
        except (TypeError, ValueError, ZeroDivisionError, KeyError):
            continue
        if ratio > 0 and ratio != 1.0:
            out.append((r["ticker"], r["execution_date"], ratio, f"{r['split_from']}->{r['split_to']}"))
    return out


class LedgerConflict(ValueError):
    pass


def ledger_from_rows(rows: list[tuple]) -> Ledger:
    """rows: (ticker, ex_date_iso, ratio, source). Multiple tickers of ONE
    security (share classes) may repeat an event; the same ex-date with a
    DIFFERENT ratio is a conflict and raises."""
    by_date: dict[str, float] = {}
    for _t, d, ratio, _src in rows:
        if d in by_date and abs(by_date[d] / ratio - 1) > 1e-6:
            raise LedgerConflict(f"split on {d}: {by_date[d]} vs {ratio}")
        by_date[d] = ratio
    return Ledger([Split(date.fromisoformat(d), r) for d, r in by_date.items()])


@dataclass
class Verification:
    status: str                                   # 'verified' | 'unverified' | 'no_evidence'
    reasons: list = field(default_factory=list)
    inferred: list = field(default_factory=list)  # (after, until, ratio)

    @property
    def ok(self) -> bool:
        return self.status != "unverified"


def _et_date(dt: datetime) -> date:
    return dt.astimezone(ET).date()


# A period only VOTES if its rounding interval pins the ratio down: 0.05 -> 0.01
# (CELH Q2 2021, a restatement) is anywhere in [3, 11] -- consistent with every
# split from 3:1 to 10:1 and therefore evidence of none.
MAX_SPREAD = 1.25

_CLEAN = (1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 15.0, 20.0, 25.0, 30.0, 40.0, 50.0)
_CLEAN_ALL = tuple(sorted(set(_CLEAN) | {1.0 / c for c in _CLEAN}))


def _decimals(v: float) -> int:
    r = repr(float(v))
    return 0 if "e" in r or "." not in r else len(r.split(".")[1].rstrip("0"))


def _interval(a: float, b: float) -> tuple[float, float] | None:
    """The range the TRUE ratio a/b can take given each was rounded to its
    reported precision (at least cents). TSLA's Q1 2020 EPS 0.08 re-reported
    as 0.02 after the 5:1 split is a 4.0 ratio on paper, [3.0, 5.67] in truth."""
    if a == 0 or b == 0 or (a > 0) != (b > 0):
        return None
    a, b = abs(a), abs(b)
    ha = 0.5 * 10 ** -max(2, _decimals(a))
    hb = 0.5 * 10 ** -max(2, _decimals(b))
    lo = (a - ha) / (b + hb)
    hi = float("inf") if b - hb <= 0 else (a + ha) / (b - hb)
    return (max(lo, 0.0), hi)


def verify(kb, ledger: Ledger, tol: float = 0.02, min_periods: int = 2, share: float = 0.6) -> Verification:
    """Evidence is grouped by WINDOW -- the pair of filings (earlier, later)
    that reported the same per-share period. A real split recasts EVERY
    comparative in the later filing, so a window counts only when at least
    `min_periods` DISTINCT periods speak; a single re-reported period is noise
    (MEASURED false alarms with one period: AAPL's 2009 restatement 0.67x, CAT's
    2016 pension recast 1.51x, an AMZN 10-K context mis-tag 1.52x).

    In a window, a ratio R is SUPPORTED by a period when R lies in that
    period's rounding interval (x (1 +/- tol)). The window is consistent when
    the ledger's product of splits inside it is supported by >= `share` of its
    periods; it is a finding when it is not AND some other clean ratio is."""
    windows: dict[tuple, dict[tuple, tuple]] = {}
    for key, rows in kb.history.items():
        if key[0] not in PER_SHARE_TAGS:
            continue
        for a, b in zip(rows, rows[1:]):
            da, db = _et_date(a.public_at), _et_date(b.public_at)
            iv = _interval(a.fact.val, b.fact.val)
            if iv is None or iv[0] <= 0 or iv[1] / iv[0] > MAX_SPREAD:
                continue                      # rounding leaves the ratio undetermined: no vote
            period = (key[2], key[3])
            # one vote per period: prefer the tighter interval (diluted vs basic)
            cur = windows.setdefault((da, db), {}).get(period)
            if cur is None or (iv[1] - iv[0]) < (cur[1] - cur[0]):
                windows[(da, db)][period] = iv
    # Share counts re-reported in the same window move the OTHER way by the same
    # ratio in a split, and not at all in a restatement. MEASURED: CELH's 2021
    # restatement dropped two periods' EPS ~3x (0.05 -> 0.01) with share counts
    # unchanged -- EPS alone called it a split.
    share_win: dict[tuple, dict[tuple, float]] = {}
    for key, rows in kb.history.items():
        if key[0] not in SHARE_COUNT_TAGS:
            continue
        for a, b in zip(rows, rows[1:]):
            if a.fact.val > 0 and b.fact.val > 0:
                da, db = _et_date(a.public_at), _et_date(b.public_at)
                share_win.setdefault((da, db), {})[(key[2], key[3])] = b.fact.val / a.fact.val
    reasons, inferred = [], []
    judged = 0
    for (da, db), periods in sorted(windows.items()):
        if len(periods) < min_periods:
            continue
        judged += 1
        ivs = list(periods.values())
        supports = lambda r: sum(1 for lo, hi in ivs if lo / (1 + tol) <= r <= hi * (1 + tol))
        led = 1.0
        for sp in ledger.splits:
            if da < sp.ex_date <= db:
                led *= sp.ratio
        best = max(_CLEAN_ALL + (1.0,), key=supports)
        sw = list(share_win.get((da, db), {}).values())
        if sw and best != 1.0:
            agree = sum(1 for r in sw if abs(r / best - 1) <= tol)
            if agree < share * len(sw):
                continue                      # EPS moved, shares did not: a restatement, not a split
        if best != 1.0 and supports(best) >= share * len(ivs):
            inferred.append((da, db, best))
        if supports(led) < share * len(ivs) and supports(best) >= share * len(ivs) and abs(best / led - 1) > tol:
            reasons.append(("window_disagrees", da.isoformat(), db.isoformat(), len(ivs),
                            round(led, 6), best))
    status = "unverified" if reasons else ("verified" if judged else "no_evidence")
    return Verification(status, reasons, inferred)
