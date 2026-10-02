"""COV-01 seasonality (roadmap RM-L11): how a stock has done, historically, by
calendar month and by weekday, from the daily bars we already hold.

The roadmap's note on this row: "the only gap row with no licensing question at
all" — every number here is derived from our own daily bar store.

Honesty rules, each one a way this kind of table usually lies:
  * every bucket carries its n (years for a month, sessions for a weekday), and a
    month seen fewer than MIN_YEARS times is reported but marked thin;
  * a month is only counted when the bars cover it end to end (a first or last
    partial month would be a fraction of a month's return wearing a month's label);
  * returns are close to close: a month's return is its last close over the prior
    month's last close, a weekday's is that session's close over the prior close;
  * the window actually covered is returned, so the page says "since 2011", never
    implies a longer record than it has.

Pure; never raises on a short or empty series.
"""
from __future__ import annotations

from statistics import median

MIN_YEARS = 5
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri")


def _ymd(t) -> tuple[int, int, int] | None:
    """A bar time as (y, m, d): accepts 'YYYY-MM-DD...', YYYYMMDD int/str."""
    s = str(t or "").strip()
    try:
        if len(s) >= 10 and s[4] == "-":
            return int(s[:4]), int(s[5:7]), int(s[8:10])
        if len(s) == 8 and s.isdigit():
            return int(s[:4]), int(s[4:6]), int(s[6:8])
    except ValueError:
        return None
    return None


def _clean(bars: list) -> list[tuple[tuple[int, int, int], float]]:
    out = []
    for b in bars or []:
        d = _ymd(b.get("t") if isinstance(b, dict) else None)
        try:
            c = float(b.get("c"))
        except (TypeError, ValueError, AttributeError):
            continue
        if d and c > 0:
            out.append((d, c))
    out.sort(key=lambda x: x[0])
    return out


def _bucket(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "avg_pct": None, "median_pct": None, "pct_up": None}
    return {"n": len(values),
            "avg_pct": round(sum(values) / len(values) * 100, 2),
            "median_pct": round(median(values) * 100, 2),
            "pct_up": round(sum(1 for v in values if v > 0) / len(values) * 100)}


def compute(bars: list) -> dict:
    rows = _clean(bars)
    if len(rows) < 2:
        return {"months": [], "weekdays": [], "covered_from": None, "covered_to": None,
                "full_months": 0, "min_years": MIN_YEARS}

    # month-end closes, keyed (y, m), in order
    month_last: dict[tuple[int, int], float] = {}
    for (y, m, _d), c in rows:
        month_last[(y, m)] = c
    keys = sorted(month_last)
    # the first month is partial unless it starts on its first sessions; the last is
    # partial while the month is still running — both are dropped as RETURN periods
    # (the first still serves as the base for the second)
    first, last = keys[0], keys[-1]
    by_month: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    full = 0
    for prev, cur in zip(keys, keys[1:]):
        if cur == last:
            continue                                   # the running (or last held) month
        if (cur[0] * 12 + cur[1]) - (prev[0] * 12 + prev[1]) != 1:
            continue                                   # a gap in the record: not a monthly return
        by_month[cur[1]].append(month_last[cur] / month_last[prev] - 1)
        full += 1
    _ = first

    import datetime as _dt
    by_wd: dict[int, list[float]] = {i: [] for i in range(5)}
    for (d0, c0), (d1, c1) in zip(rows, rows[1:]):
        try:
            wd = _dt.date(*d1).weekday()
        except ValueError:
            continue
        if wd < 5:
            by_wd[wd].append(c1 / c0 - 1)

    months = []
    for m in range(1, 13):
        b = _bucket(by_month[m])
        b.update({"month": m, "label": MONTHS[m - 1], "thin": b["n"] < MIN_YEARS})
        months.append(b)
    weekdays = []
    for i in range(5):
        b = _bucket(by_wd[i])
        b.update({"weekday": i, "label": WEEKDAYS[i]})
        weekdays.append(b)
    fmt = lambda d: f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}"
    return {"months": months, "weekdays": weekdays,
            "covered_from": fmt(rows[0][0]), "covered_to": fmt(rows[-1][0]),
            "full_months": full, "min_years": MIN_YEARS}
