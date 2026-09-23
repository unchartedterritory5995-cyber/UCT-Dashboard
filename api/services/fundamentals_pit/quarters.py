"""Standalone fiscal quarters from what a filer actually reported.

Income-statement and cash-flow facts are DURATIONS. Filers report some mix of:
    3-month quarter  (Q1..Q3 in 10-Qs; almost never Q4)
    year-to-date     (6M, 9M -- cash flow is usually ONLY year-to-date)
    fiscal year      (10-K)

A standalone quarter is taken, in order of preference, as:
  1. DIRECT   a reported duration of quarter length;
  2. YTD      cum(S -> e_k) - cum(S -> e_{k-1}) for two cumulative facts that
              share the SAME start S (same fiscal year), SAME tag and SAME unit,
              whose ends are one quarter apart. Q4 = FY - 9M is this rule;
  3. FY-SUM   FY(S -> E) - (standalone quarters tiling S .. e_prev contiguously),
              when no 9M cumulative was reported.

Refused on purpose (never subtracted): facts from different tags, different
units, or different start dates; spans that are not quarter length; cumulative
facts longer than a fiscal year. "Sharing a tag" is not sufficient context.

Lengths are in days and deliberately wide: 52/53-week filers report 12-, 13-,
14- and 16-week quarters (CAVA's Q1 is 16 weeks = 112 days).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

QUARTER_DAYS = (75, 125)
YEAR_DAYS = (350, 380)
DIRECT, YTD, FY_SUM = "direct", "ytd", "fy_sum"


@dataclass(frozen=True)
class Quarter:
    start: date
    end: date
    val: float
    method: str                      # DIRECT | YTD | FY_SUM
    parts: tuple                     # (start, end) keys of the facts used


def _within(days: int, rng: tuple[int, int]) -> bool:
    return rng[0] <= days <= rng[1]


def _days(s: date, e: date) -> int:
    return (e - s).days + 1


def standalone_quarters(durations: dict[tuple[date, date], float],
                        tolerance: float = 0.0) -> tuple[dict[date, Quarter], list[tuple]]:
    """`durations` maps (start, end) -> value for ONE tag and ONE unit.

    Returns ({quarter_end: Quarter}, discrepancies). A discrepancy is a quarter
    that is both reported directly and derivable, with values differing by more
    than `tolerance` (absolute) -- the DIRECT value wins and the pair is logged.
    """
    direct: dict[date, Quarter] = {}
    for (s, e), v in durations.items():
        if _within(_days(s, e), QUARTER_DAYS):
            prev = direct.get(e)
            # Two direct quarters ending the same day with different starts are
            # not the same period; keep the one closest to a 13-week quarter.
            if prev is None or abs(_days(s, e) - 91) < abs(_days(prev.start, e) - 91):
                direct[e] = Quarter(s, e, v, DIRECT, ((s, e),))

    by_start: dict[date, list[tuple[date, float]]] = defaultdict(list)
    for (s, e), v in durations.items():
        if _days(s, e) <= YEAR_DAYS[1]:
            by_start[s].append((e, v))

    derived: dict[date, Quarter] = {}
    for s, pts in by_start.items():
        pts.sort()
        for (e0, v0), (e1, v1) in zip(pts, pts[1:]):
            if not _within((e1 - e0).days, QUARTER_DAYS):
                continue
            if _days(s, e0) < QUARTER_DAYS[0]:
                continue                     # e0 is not a whole quarter in
            q = Quarter(e0 + timedelta(days=1), e1, v1 - v0, YTD, ((s, e0), (s, e1)))
            derived.setdefault(e1, q)

    out: dict[date, Quarter] = dict(derived)
    discrepancies: list[tuple] = []
    for e, q in direct.items():
        d = derived.get(e)
        if d is not None and abs(d.val - q.val) > tolerance:
            discrepancies.append((e, q.val, d.val))
        out[e] = q

    # FY-SUM: a fiscal year whose last quarter is still missing.
    for (s, e), fy in durations.items():
        if not _within(_days(s, e), YEAR_DAYS) or e in out:
            continue
        tiles, cursor = [], s
        while True:
            nxt = next((q for q in out.values() if q.start == cursor and q.end < e), None)
            if nxt is None:
                break
            tiles.append(nxt)
            cursor = nxt.end + timedelta(days=1)
        if len(tiles) == 3 and _within(_days(cursor, e), QUARTER_DAYS):
            out[e] = Quarter(cursor, e, fy - sum(t.val for t in tiles), FY_SUM,
                             ((s, e),) + tuple(p for t in tiles for p in t.parts))
    return out, discrepancies


def contiguous_window(quarters: dict[date, Quarter], end: date, n: int = 4,
                      slack_days: int = 0) -> list[Quarter] | None:
    """The n standalone quarters ending at `end`, each starting the day after
    its predecessor ends (± slack). None if any link is missing or broken."""
    q = quarters.get(end)
    if q is None:
        return None
    chain = [q]
    while len(chain) < n:
        want = chain[-1].start - timedelta(days=1)
        prev = None
        for d in range(0, slack_days + 1):
            for cand in (want - timedelta(days=d), want + timedelta(days=d)):
                if cand in quarters:
                    prev = quarters[cand]
                    break
            if prev:
                break
        if prev is None:
            return None
        chain.append(prev)
    return list(reversed(chain))
