"""Tiny builders for deterministic PIT fixtures (no network, no clock)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from api.services.fundamentals_pit.facts import Fact
from api.services.fundamentals_pit.filings import Filing, public_at

D = date.fromisoformat


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def filing(accn: str, accepted_utc: str, filing_date: str | None = None, form: str = "10-Q") -> Filing:
    acc = utc(accepted_utc)
    fd = D(filing_date) if filing_date else acc.date()
    return Filing(accn=accn, form=form, filing_date=fd, report_date=None,
                  accepted_at=acc, public_at=public_at(acc, fd))


def fact(concept: str, start: str | None, end: str, val: float, accn: str,
         unit: str = "USD", taxonomy: str = "us-gaap", form: str = "10-Q") -> Fact:
    return Fact(taxonomy=taxonomy, concept=concept, unit=unit,
                start=D(start) if start else None, end=D(end), val=float(val),
                accn=accn, form=form, filed=D(end), fy=None, fp=None, frame=None)
