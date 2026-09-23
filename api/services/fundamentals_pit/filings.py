"""Filing identity and the instant a filing became PUBLIC.

Source: data.sec.gov/submissions/CIK##########.json (`filings.recent` plus every
page named in `filings.files`). Each row carries `accessionNumber`, `form`,
`filingDate`, `reportDate` and `acceptanceDateTime`.

MEASURED (2026-09-22, AAPL): `acceptanceDateTime` is TRUE UTC despite looking
like a label -- the EDGAR header `<ACCEPTANCE-DATETIME>20191030181236` (Eastern)
is served as `2019-10-30T22:12:36.000Z`.

ACCEPTED IS NOT PUBLIC. SEC: "filing submissions that begin after 5:30 p.m. ET
... will be disseminated the next business day". That same AAPL 10-K was
accepted Oct 30 18:12 ET and carries `filingDate` 2019-10-31. So:

    public_at = max(accepted_at, filingDate 06:00 ET)

06:00 ET is when EDGAR opens for the day, the earliest a next-day dissemination
can occur. The rule is conservative in exactly one direction: it can only make a
value appear LATER than reality, never earlier.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
EDGAR_OPEN_ET = time(6, 0)

# Periodic reports whose XBRL carries financial statements. 20-F/40-F are IFRS
# foreign filers: parsed, but the concept map (concepts.py) is US-GAAP only.
PERIODIC_FORMS = frozenset({
    "10-K", "10-K/A", "10-Q", "10-Q/A", "10-KT", "10-KT/A", "10-QT", "10-QT/A",
    "20-F", "20-F/A", "40-F", "40-F/A",
})


@dataclass(frozen=True)
class Filing:
    accn: str
    form: str
    filing_date: date
    report_date: date | None
    accepted_at: datetime | None     # UTC, from acceptanceDateTime
    public_at: datetime              # UTC, see module doc

    @property
    def is_amendment(self) -> bool:
        return self.form.endswith("/A")


def _parse_accepted(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = raw.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:            # never observed; treat a naive value as UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def public_at(accepted_at: datetime | None, filing_date: date) -> datetime:
    """The earliest instant the filing's content was public. Always >= the
    filing date's 06:00 ET; >= accepted_at when that is known."""
    floor = datetime.combine(filing_date, EDGAR_OPEN_ET, tzinfo=ET).astimezone(timezone.utc)
    if accepted_at is None:
        # No acceptance time: the whole filing date is uncertain, so the value
        # is only certain to be public by the END of that day. Be late, not early.
        return datetime.combine(filing_date, time(23, 59, 59), tzinfo=ET).astimezone(timezone.utc)
    return max(accepted_at, floor)


def parse_submission_pages(pages: list[dict], anomalies: list | None = None) -> dict[str, Filing]:
    """accn -> Filing over `filings.recent` and every overflow page.

    One accession CAN be listed more than once: a combined filing carries
    several form types (MEASURED in the bulk archive: 0001104659-26-081818 is
    both `SC TO-T/A` and `SC 13D/A`). Merge rule, never silent:
      * a periodic form (10-K, 10-Q, ...) wins the `form` field;
      * differing times resolve to the LATER public_at (late, never early).
    Every merge with a real difference is appended to `anomalies`.
    """
    out: dict[str, Filing] = {}
    for page in pages:
        cols = page
        n = len(cols.get("accessionNumber", []))
        acc_col = cols.get("acceptanceDateTime") or [None] * n
        rep_col = cols.get("reportDate") or [None] * n
        for i in range(n):
            accn = cols["accessionNumber"][i]
            fd = date.fromisoformat(cols["filingDate"][i])
            rd_raw = rep_col[i]
            rd = date.fromisoformat(rd_raw) if rd_raw else None
            acc = _parse_accepted(acc_col[i])
            f = Filing(accn=accn, form=cols["form"][i], filing_date=fd,
                       report_date=rd, accepted_at=acc,
                       public_at=public_at(acc, fd))
            prev = out.get(accn)
            if prev is not None and prev != f:
                if anomalies is not None:
                    anomalies.append((accn, prev, f))
                form = prev.form if prev.form in PERIODIC_FORMS else f.form
                later = f if f.public_at >= prev.public_at else prev
                f = Filing(accn=accn, form=form, filing_date=later.filing_date,
                           report_date=prev.report_date or f.report_date,
                           accepted_at=later.accepted_at, public_at=later.public_at)
            out[accn] = f
    return out
