"""Notebook widgets wave 9 (Task 9.3): tracker values -- cleaning, display, buckets, measures.

A tracker logs one value per day. Four kinds:

* `yesno`    -- stored 0 or 1;
* `number`   -- finite, `abs(v) <= NUMBER_ABS_MAX`;
* `scale`    -- an integer 1 to 5;
* `duration` -- minutes, `0 <= v <= DURATION_MAX_MIN` (24 hours).

`clean_value` is the one gate every write goes through; it refuses with the member sentence, so a
bad value is never stored. A bool is never a number (Python's `True == 1` must not log a 1), a
string is never parsed, and NaN or Infinity is refused everywhere.

Buckets split days by their value for the "vs P&L" view and the builder: yes/no and the 1-5 scale
have fixed buckets; a number or a duration with three or more distinct values is cut into terciles
of its distinct values.

Pure: no I/O, no clock.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from api.services.journal_two.measures import DEFAULT_MIN_N, Measure, MeasureValue
from api.services.journal_two.notebook_widgets import _num

KINDS = ("yesno", "number", "scale", "duration")
KIND_LABELS = {"yesno": "Yes / no", "number": "Number", "scale": "1-5 scale",
               "duration": "Duration"}
UNIT_MAX = 16
DURATION_MAX_MIN = 1440
NUMBER_ABS_MAX = 1e9

S_YESNO = "Pick yes or no."
S_SCALE = "Pick a value from 1 to 5."
S_NUMBER = "Enter a number."
S_DURATION = "A duration can be at most 24 hours."
S_UNIT = "A unit can be at most 16 characters."
S_KIND = "Pick a tracker type."


# ── cleaning ───────────────────────────────────────────────────────────────────────────────────

def _finite(raw: Any) -> float | None:
    """`raw` as a finite float, or None. Bools, strings and anything non-numeric are None."""
    if isinstance(raw, bool) or isinstance(raw, (str, bytes)) or raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError, OverflowError):
        return None
    return v if math.isfinite(v) else None


def clean_value(kind: str, raw: Any) -> float:
    """The stored float for `raw`, or `ValueError(<member sentence>)`."""
    if kind == "yesno":
        if isinstance(raw, bool):
            return 1.0 if raw else 0.0
        v = _finite(raw)
        if v not in (0.0, 1.0):
            raise ValueError(S_YESNO)
        return v
    if kind == "scale":
        v = _finite(raw)
        if v is None or v != int(v) or not 1 <= v <= 5:
            raise ValueError(S_SCALE)
        return v
    if kind == "number":
        v = _finite(raw)
        if v is None or abs(v) > NUMBER_ABS_MAX:
            raise ValueError(S_NUMBER)
        return v
    if kind == "duration":
        v = _finite(raw)
        if v is None:
            raise ValueError(S_NUMBER)
        if not 0 <= v <= DURATION_MAX_MIN:
            raise ValueError(S_DURATION)
        return v
    raise ValueError(S_KIND)


# ── display ────────────────────────────────────────────────────────────────────────────────────

def _num_text(v: float) -> str:
    """Fixed notation, at most 2 decimals, never an exponent: 6.5 -> "6.5", 1e9 -> "1000000000",
    0.123 -> "0.12", -2.0 -> "-2"."""
    text = f"{round(v, 2):.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _with_unit(text: str, unit: str | None) -> str:
    return f"{text} {unit}" if unit else text


def _duration_text(minutes: float) -> str:
    """450 -> "7h 30m", 480 -> "8h", 45 -> "45m", 0 -> "0m"."""
    total = int(round(minutes))
    h, m = divmod(total, 60)
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


def format_value(kind: str, value: float | None, unit: str | None) -> str:
    """The value as the member reads it. "" for a missing value (the caller says "no data")."""
    v = _num(value)
    if v is None:
        return ""
    if kind == "yesno":
        return "Yes" if v >= 0.5 else "No"
    if kind == "scale":
        return str(int(round(v)))
    if kind == "duration":
        return _duration_text(v)
    return _with_unit(_num_text(v), unit)


# ── buckets ────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Bucket:
    label: str
    lo: float | None   # inclusive
    hi: float | None   # exclusive


def _edge_text(kind: str, v: float) -> str:
    return _duration_text(v) if kind == "duration" else _num_text(v)


def buckets(kind: str, values: list[float], unit: str | None) -> list[Bucket]:
    """yes/no: Yes, No. scale: 1-2, 3, 4-5. number/duration with 3+ distinct values: terciles of
    the sorted distinct values (edges at index k // 3 and 2k // 3); fewer: one bucket per value."""
    if kind == "yesno":
        return [Bucket("Yes", 1.0, None), Bucket("No", None, 1.0)]
    if kind == "scale":
        return [Bucket("1-2", None, 3.0), Bucket("3", 3.0, 4.0), Bucket("4-5", 4.0, None)]
    distinct = sorted({v for v in (_num(x) for x in values or []) if v is not None})
    k = len(distinct)
    if k == 0:
        return []
    suffix = "" if kind == "duration" or not unit else f" {unit}"
    if k < 3:
        out = []
        for i, v in enumerate(distinct):
            hi = distinct[i + 1] if i + 1 < k else None
            out.append(Bucket(format_value(kind, v, unit), v, hi))
        return out
    a, b = distinct[k // 3], distinct[2 * k // 3]
    at, bt = _edge_text(kind, a), _edge_text(kind, b)
    # A hyphen beside a minus sign reads wrongly ("-5--2"), so a negative edge uses "to".
    middle = f"{at} to {bt}" if a < 0 or b < 0 else f"{at}-{bt}"
    return [Bucket(f"Under {at}{suffix}", None, a),
            Bucket(f"{middle}{suffix}", a, b),
            Bucket(f"{bt}{suffix} or more", b, None)]


def bucket_of(bs: list[Bucket], v: float | None) -> str | None:
    """The label of the bucket holding `v`; None for a missing value or one outside every bucket."""
    x = _num(v)
    if x is None:
        return None
    for b in bs:
        if (b.lo is None or x >= b.lo) and (b.hi is None or x < b.hi):
            return b.label
    return None


# ── measures over tracker-history rows ─────────────────────────────────────────────────────────
# Rows: {tracker, day, value}, one per logged day. A row with no value is not an entry.

_SOURCES = frozenset({"tracker_history"})


def _entries(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r.get("value") is not None and not isinstance(r.get("value"), bool)]


def _poisoned(rows: list[dict]) -> bool:
    return any(_num(r.get("value")) is None for r in _entries(rows))


def _values(rows: list[dict]) -> list[float]:
    return [v for v in (_num(r.get("value")) for r in _entries(rows)) if v is not None]


def _tracker_avg(rows):
    vs = _values(rows)
    if _poisoned(rows) or not vs:
        return MeasureValue(None, len(_entries(rows)), None)
    return MeasureValue(_num(sum(vs) / len(vs)), len(vs), None)


def _tracker_min(rows):
    vs = _values(rows)
    if _poisoned(rows) or not vs:
        return MeasureValue(None, len(_entries(rows)), None)
    return MeasureValue(_num(min(vs)), len(vs), None)


def _tracker_max(rows):
    vs = _values(rows)
    if _poisoned(rows) or not vs:
        return MeasureValue(None, len(_entries(rows)), None)
    return MeasureValue(_num(max(vs)), len(vs), None)


def _tracker_latest(rows):
    es = _entries(rows)
    if not es:
        return MeasureValue(None, 0, None)
    # Newest day wins; on a tie the later row in input order.
    newest = max(enumerate(es), key=lambda p: (str(p[1].get("day") or "")[:10], p[0]))[1]
    return MeasureValue(_num(newest.get("value")), len(es), None)


def _tracker_entries(rows):
    # Ruling W9-R7: a count of 0 is never shown (matches routine_days_done).
    n = len(_entries(rows))
    return MeasureValue(float(n) if n else None, n, None)


def _m(key, label, meaning, kind, fn):
    return Measure(key, label, "process", meaning, "entries", kind, DEFAULT_MIN_N, (), _SOURCES,
                   fn)


#: "Change vs previous period" is the builder's compare view over `tracker_avg`, not a measure.
TRACKER_MEASURES: dict[str, Measure] = {m.key: m for m in [
    _m("tracker_avg", "Average", "The average of the values you logged.", "average", _tracker_avg),
    _m("tracker_min", "Lowest", "The lowest value you logged.", "extreme", _tracker_min),
    _m("tracker_max", "Highest", "The highest value you logged.", "extreme", _tracker_max),
    _m("tracker_latest", "Latest", "The value on the newest day you logged.", "extreme",
       _tracker_latest),
    _m("tracker_entries", "Entries", "How many days you logged a value.", "count",
       _tracker_entries),
]}
