"""Write the fixture that pins the JavaScript split adjustment to factors.py.

    python tools/history_lake/make_js_adjust_fixture.py

Output: app/src/data/historyLake/__fixtures__/adjust.json -- SYNTHETIC bars and split tables (seeded;
no vendor data: the repo is public) with the values ``factors.adjust_bars`` returns for them.
``app/src/data/historyLake/adjust.test.js`` runs the browser code on the same inputs and must agree.
Deterministic: running it twice writes the same file.
"""
from __future__ import annotations

import json
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import factors  # noqa: E402

OUT = HERE.parents[1] / "app" / "src" / "data" / "historyLake" / "__fixtures__" / "adjust.json"
ET = ZoneInfo("America/New_York")


def _bars(rng, first: date, days: int, per_day: int):
    """Bars across `days` calendar days (weekends skipped), spread from 04:00 to 19:59 ET, so both
    sides of midnight-ET split boundaries and both DST regimes are exercised."""
    t, dates, o, h, l, c, v = [], [], [], [], [], [], []
    px = 240.0
    d = first
    for _ in range(days):
        if d.weekday() < 5:
            for m in sorted(rng.sample(range(4 * 60, 20 * 60), per_day)):
                ts = int(datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=ET).timestamp())
                op = round(px + rng.uniform(-1, 1), 4)
                cl = round(op + rng.uniform(-1, 1), 4)
                t.append(ts); dates.append(d.isoformat())
                o.append(op); c.append(cl)
                h.append(round(max(op, cl) + rng.uniform(0, 0.5), 4))
                l.append(round(min(op, cl) - rng.uniform(0, 0.5), 4))
                v.append(float(rng.randint(1, 500000)))
                px = cl
        d += timedelta(days=1)
    return t, dates, o, h, l, c, v


def _case(name, rng, first, days, per_day, table):
    t, dates, o, h, l, c, v = _bars(rng, first, days, per_day)
    ao, ah, al, ac, av = factors.adjust_bars(dates, o, h, l, c, v, table)
    return {"name": name, "table": table, "t": t, "dates": dates,
            "raw": {"o": o, "h": h, "l": l, "c": c, "v": v},
            "adjusted": {"o": ao, "h": ah, "l": al, "c": ac, "v": av},
            "segments": factors.segment_factors(table)}


def main() -> int:
    rng = random.Random(20261116)
    cases = [
        _case("no splits", rng, date(2026, 3, 2), 5, 6, []),
        _case("one forward split mid-range", rng, date(2026, 6, 1), 12, 8, [["2026-06-08", 4.0]]),
        _case("reverse split", rng, date(2026, 6, 1), 12, 8, [["2026-06-10", 0.1]]),
        _case("three splits, one a 3-for-2", rng, date(2026, 1, 5), 40, 5,
              [["2026-01-14", 2.0], ["2026-01-30", 1.5], ["2026-02-11", 0.05]]),
        _case("split on the spring DST change weekend's Monday", rng, date(2026, 3, 2), 14, 10, [["2026-03-09", 3.0]]),
        _case("split on the fall DST change weekend's Monday", rng, date(2026, 10, 26), 10, 10, [["2026-11-02", 7.0]]),
        _case("every split before the range", rng, date(2026, 6, 1), 5, 6, [["2020-08-31", 4.0], ["2014-06-09", 7.0]][::-1]),
        _case("every split after the range", rng, date(2026, 6, 1), 5, 6, [["2026-07-01", 2.0], ["2026-08-03", 5.0]]),
        _case("split on the first bar's date and on the day after the last", rng, date(2026, 6, 1), 5, 6,
              [["2026-06-01", 2.0], ["2026-06-06", 3.0]]),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {"note": "synthetic; written by tools/history_lake/make_js_adjust_fixture.py", "cases": cases}
    OUT.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True) + "\n", encoding="ascii", newline="\n")
    print(f"{OUT}: {len(cases)} cases, {OUT.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
