"""Task 1 V16 probe: api.services.session_calendar horizon, coverage, version, holidays. Pure read of the bundled
calendar data: no network, no key, no data directory is opened. Run: python t2b_v16_probe.py <repo>"""
import datetime as dt
import json
import sys

sys.path.insert(0, sys.argv[1])
from api.services import session_calendar as sc  # noqa: E402

cal = sc._CAL
h = {d: n for d, n in cal.holidays.items()}
out = {
    "horizon": str(sc.horizon()),
    "coverage_start": str(cal.coverage_start),
    "version": sc.version(),
    "covers_2026_10_14": sc.covers(dt.date(2026, 10, 14)),
    "covers_2027_12_31": sc.covers(dt.date(2027, 12, 31)),
    "holidays_2026_from_september": [(str(d), n) for d, n in sorted(h.items()) if d.year == 2026 and d.month >= 9],
    "holidays_2027_count": sum(1 for d in h if d.year == 2027),
    "holidays_2027": [(str(d), n) for d, n in sorted(h.items()) if d.year == 2027],
    "thanksgiving_2026_is_weekday_holiday": dt.date(2026, 11, 26).weekday() < 5 and not sc.is_trading_day(dt.date(2026, 11, 26)),
    "thanksgiving_2026_name": sc.holiday_name(dt.date(2026, 11, 26)),
}
print("V16 " + json.dumps(out))
