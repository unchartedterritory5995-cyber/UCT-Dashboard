"""Split-adjustment factors for the history lake.

The pieces are RAW (the vendor's day files are unadjusted). A chart shows SPLIT-ADJUSTED prices,
so that a 4-for-1 split does not draw a 75% cliff. This module turns the vendor's split reference
(`/v3/reference/splits`: ticker, execution_date, split_from, split_to) into one small factor table
per symbol, and applies it. The same arithmetic is what the browser will run on a decoded piece.

THE RULE
--------
ratio = split_to / split_from            (a 4-for-1 forward split: from 1, to 4, ratio 4.0;
                                          a 1-for-10 reverse split: from 10, to 1, ratio 0.1)

For a bar on ET calendar date D:
    f(D)       = product of ratio_i over every executed split i with execution_date_i > D
    adj price  = raw price / f(D)
    adj volume = raw volume * f(D)

The execution date is the first session that trades on the NEW basis, so a bar ON the execution
date is already post-split and is not divided by that split (strict `>`).

WHAT IS NEVER APPLIED
---------------------
* A split whose execution date is after `as_of` (the vendor lists announced, future-dated splits;
  applying one early would move every bar by a ratio that has not happened).
* A row with a missing, zero, negative or non-finite side.
* A ratio of exactly 1.

WHAT THIS DOES NOT DO (deliberately, and stated so nobody assumes it)
---------------------------------------------------------------------
* Dividends: the app's intraday series are split-adjusted only.
* Ticker changes: the day files and the split reference are keyed by the ticker AS IT WAS on that
  day. A symbol that was renamed has its older history (and older splits) under the old ticker;
  stitching those is a separate step that needs the vendor's ticker-event history.
"""
from __future__ import annotations

import bisect
import math
from typing import Iterable, Mapping, Sequence

FACTORS_VERSION = 1


def split_ratio(split_from, split_to):
    """split_to / split_from, or None when the row cannot be used."""
    try:
        f, t = float(split_from), float(split_to)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(f) and math.isfinite(t)) or f <= 0 or t <= 0:
        return None
    r = t / f
    if not math.isfinite(r) or r <= 0 or r == 1.0:
        return None
    return r


def _is_iso_date(s) -> bool:
    return (isinstance(s, str) and len(s) == 10 and s[4] == '-' and s[7] == '-'
            and s[:4].isdigit() and s[5:7].isdigit() and s[8:].isdigit())


def build_factor_tables(rows: Iterable[Mapping], as_of: str) -> dict:
    """{ticker: [[execution_date, ratio], ...]} ascending by date, executed splits only.

    `as_of` (YYYY-MM-DD, ET) is the last date whose splits count as executed. Two usable rows for
    one (ticker, date) are a vendor restatement of the same event: the LAST one read wins, and the
    two ratios are never multiplied together.
    """
    if not _is_iso_date(as_of):
        raise ValueError('as_of must be YYYY-MM-DD')
    by = {}
    for r in rows:
        tk, d = r.get('ticker'), r.get('execution_date')
        if not tk or not _is_iso_date(d) or d > as_of:
            continue
        ratio = split_ratio(r.get('split_from'), r.get('split_to'))
        if ratio is None:
            continue
        by.setdefault(str(tk), {})[d] = ratio
    return {tk: [[d, m[d]] for d in sorted(m)] for tk, m in sorted(by.items())}


#: An entry filed under both spellings counts once: same ratio (within 2%) within 14 days.
SAME_EVENT_DAYS = 14
SAME_EVENT_TOL = 0.02


def _same_event(table: Sequence[Sequence], d: str, ratio: float) -> bool:
    import datetime as _dt
    day = _dt.date.fromisoformat(d)
    for d0, r0 in table:
        if abs((_dt.date.fromisoformat(d0) - day).days) <= SAME_EVENT_DAYS \
                and abs(float(r0) / float(ratio) - 1) <= SAME_EVENT_TOL:
            return True
    return False


def with_class_share_spellings(tables: Mapping, symbols: Iterable[str]) -> dict:
    """`tables` with each class share's splits that the vendor filed under its UNDOTTED spelling added.

    ⚠️ The vendor's split reference files a class share's events under both spellings, while the day files
    (and so the lake's symbols) always use the dotted one (2026-11-18: BF.B's 2004 and 2008 splits under
    `BF.B` but its 2012 / 2016 / 2018 ones under `BFB`; BF.A's and HEI.A's only under `BFA` / `HEIA`). Read
    by exact symbol, 23 lake class shares missed splits and drew cliffs on their intraday history.

    The undotted spelling is borrowed only when it is NOT itself one of `symbols` (the lake's own symbols):
    then it may be another company (`CWD` is CaliberCos, never `C.WD`). Lowercase-marked vendor symbols
    (preferreds, rights) are never touched. An entry already present under the dotted spelling (same ratio
    within 14 days) is not added twice.
    """
    known = set(symbols)
    out = dict(tables)
    for sym in sorted(known):
        if "." not in sym or any(ch.islower() for ch in sym):
            continue
        alt = sym.replace(".", "")
        if alt in known or alt not in tables:
            continue
        own = [list(x) for x in tables.get(sym, [])]
        add = [[d, r] for d, r in tables[alt] if not _same_event(own, d, r)]
        if add:
            out[sym] = sorted(own + add)
    return out


def factor_for_date(table: Sequence[Sequence], bar_date: str) -> float:
    """f(D): the product of the ratios of every split executed strictly after `bar_date`."""
    if not table:
        return 1.0
    dates = [row[0] for row in table]
    i = bisect.bisect_right(dates, bar_date)      # first split with execution_date > bar_date
    f = 1.0
    for _, ratio in table[i:]:
        f *= ratio
    return f


def segment_factors(table: Sequence[Sequence]) -> list:
    """The table as date segments, for a reader that walks bars in time order.

    [[first_date_inclusive_or_None, last_date_inclusive_or_None, factor], ...] ascending; the last
    segment (on and after the newest split) always has factor 1.0.
    """
    if not table:
        return [[None, None, 1.0]]
    out, start = [], None
    for i, (d, _) in enumerate(table):
        f = 1.0
        for _, ratio in table[i:]:
            f *= ratio
        out.append([start, _day_before(d), f])
        start = d
    out.append([start, None, 1.0])
    return out


def _day_before(iso: str) -> str:
    import datetime as _dt
    return (_dt.date.fromisoformat(iso) - _dt.timedelta(days=1)).isoformat()


def adjust_bars(dates: Sequence[str], o, h, l, c, v, table: Sequence[Sequence]):
    """Apply the rule to parallel sequences. `dates[i]` is bar i's ET calendar date.

    Returns new lists (o, h, l, c, v); the inputs are not modified. Pure Python on purpose: this is
    the reference the vectorised and the JavaScript appliers are tested against.
    """
    n = len(dates)
    if not (len(o) == len(h) == len(l) == len(c) == len(v) == n):
        raise ValueError('columns differ in length')
    cache = {}
    oo, hh, ll, cc, vv = [], [], [], [], []
    for i in range(n):
        d = dates[i]
        f = cache.get(d)
        if f is None:
            f = cache[d] = factor_for_date(table, d)
        if f == 1.0:
            oo.append(o[i]); hh.append(h[i]); ll.append(l[i]); cc.append(c[i]); vv.append(v[i])
        else:
            oo.append(o[i] / f); hh.append(h[i] / f); ll.append(l[i] / f); cc.append(c[i] / f); vv.append(v[i] * f)
    return oo, hh, ll, cc, vv
