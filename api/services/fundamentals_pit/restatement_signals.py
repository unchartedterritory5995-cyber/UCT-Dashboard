"""Restating-filing signals from a filing's OWN XBRL instance.

companyfacts is the right base store (every filing's copy of every
non-dimensional fact), but it cannot see a restatement disclosed only through
DIMENSIONS. CELH's FY2021 10-K (public 2022-03-16) tagged its restated
standalone quarters under `srt:RestatementAdjustmentMember` /
`celh:EffectsOfTheAdjustmentsOnAStandaloneQuarterBasisMember`; the first
non-dimensional restated Q3 2021 value arrived eight months later, in the
2022-11-09 10-Q. In between, Q4 = FY(restated) - 9M(original) mixed two bases.

The signal: a filing whose instance contains contexts on the SEC reporting
taxonomy's restatement axis members is RESTATING, for the periods those
contexts cover. It opens a restatement epoch (knowledge.filing_epochs), so
facts known before it that overlap those periods are STALE for derivation --
the derived value is withheld rather than wrong, until non-dimensional restated
values arrive. The signal only ever withholds; it never supplies a value.
"""
from __future__ import annotations

import re
from datetime import date

RESTATEMENT_MEMBERS = (
    "srt:RestatementAdjustmentMember",
    "srt:ScenarioPreviouslyReportedMember",
    "us-gaap:RestatementAdjustmentMember",          # pre-2019 taxonomy
    "us-gaap:ScenarioPreviouslyReportedMember",
)

_CTX = re.compile(r"<(?:xbrli:)?context\b.*?</(?:xbrli:)?context>", re.S)
_START = re.compile(r"<(?:xbrli:)?startDate>(\d{4}-\d{2}-\d{2})<")
_END = re.compile(r"<(?:xbrli:)?endDate>(\d{4}-\d{2}-\d{2})<")
_INSTANT = re.compile(r"<(?:xbrli:)?instant>(\d{4}-\d{2}-\d{2})<")


def restated_span(instance_xml: str) -> tuple[date, date] | None:
    """(earliest start, latest end) over contexts that carry a restatement
    member, or None when the filing does not restate."""
    lo = hi = None
    for ctx in _CTX.findall(instance_xml):
        if not any(m in ctx for m in RESTATEMENT_MEMBERS):
            continue
        s = _START.search(ctx) or _INSTANT.search(ctx)
        e = _END.search(ctx) or _INSTANT.search(ctx)
        if not (s and e):
            continue
        ds, de = date.fromisoformat(s.group(1)), date.fromisoformat(e.group(1))
        lo = ds if lo is None or ds < lo else lo
        hi = de if hi is None or de > hi else hi
    return (lo, hi) if lo else None
