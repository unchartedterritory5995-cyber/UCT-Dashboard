"""Sparse point-in-time observations: the canonical historical series.

Walk every instant at which the company's knowledge changed (a filing became
public), rebuild the as-known Book, evaluate each metric for its latest
computable period, and emit a point ONLY when the value (or the period it
describes) changed:

    Point(t_eff = filing public_at, v, period_end, sources, method)

A chart holds each point until the next one (asof.py). Nothing is interpolated
and no value exists before the first filing that makes it computable. Because
each point is computed from ONE knowledge state, it is reproducible: re-running
this over the same append-only facts yields byte-identical output, and each
point names the accessions it was computed from.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from .knowledge import Knowledge
from .concepts import PRIMITIVES
from .metrics import METRICS, build_book, latest
from .splits import Ledger


@dataclass(frozen=True)
class Point:
    t_eff: datetime
    v: float
    period_end: date
    sources: tuple
    method: str


WARMUP = timedelta(days=365)
# The warm-up exists for the XBRL PHASE-IN cohort: filers whose first XBRL
# filing predates mid-2011 had a first year in which prior periods had never been
# tagged, so a restated comparative looked like a first disclosure (the AAPL
# 2010 case below). MEASURED on the bulk universe: applying it to every filer
# blanked EVERY recent IPO for a year (PTRN, AIRO, EVMN, UROY had a correct
# revenue TTM hidden). Later first-year restatements are caught by the value-
# change detector and the restating-filing signal (restatement_signals.py);
# the residual (a first-year restatement with neither) is documented.
WARMUP_COHORT_BEFORE = datetime(2011, 7, 1, tzinfo=timezone.utc)


def build_series(kb: Knowledge, metrics: list[str] | None = None,
                 ledger: Ledger | None = None, since: datetime | None = None,
                 warmup: timedelta = WARMUP) -> dict[str, list[Point]]:
    """⛔ WARM-UP. Restatement detection (knowledge.restatements) works by
    comparing a filing's number with the number previously KNOWN for the same
    period. In a company's first year of XBRL there is no previous number: a
    10-Q's restated comparatives look like first disclosures, and FY(original)
    + YTD(restated) - YTD_prev(restated) silently mixes two bases. MEASURED on
    AAPL 2010-01-25: the Q1 FY10 10-Q (16:23 ET, restated comparatives) landed
    two minutes before the FY09 10-K/A; the mixed TTM was 40,340M against a
    true 46,708M. So no point is emitted until one year after the company's
    first XBRL disclosure -- the one window in which the check is blind."""
    metrics = metrics or list(METRICS)
    out: dict[str, list[Point]] = {m: [] for m in metrics}
    tags = {tg for p in PRIMITIVES.values() for tg in p.tags}
    events = kb.events_for(tags)
    start = (events[0] + warmup) if events and events[0] < WARMUP_COHORT_BEFORE else None
    for t, state in kb.iter_states(tags):
        if since is not None and t < since:
            continue
        if start is not None and t < start:
            continue
        book = build_book(state, ledger, kb, t)
        for m in metrics:
            val = latest(book, m)
            pts = out[m]
            if val is None:
                continue
            if pts and pts[-1].period_end == val.period_end and _same(pts[-1].v, val.v):
                continue
            pts.append(Point(t, val.v, val.period_end, val.sources, val.note))
    return out


def _same(a: float, b: float) -> bool:
    return a == b or abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


def value_at(points: list[Point], t: datetime) -> Point | None:
    """The point in force at instant t: the last with t_eff <= t."""
    cur = None
    for p in points:
        if p.t_eff <= t:
            cur = p
        else:
            break
    return cur
