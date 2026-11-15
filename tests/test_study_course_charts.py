"""check_course_charts (2026-11-14): a course chart is checked against bars the way the server resolves it."""
import sqlite3

from scripts.study import check_course_charts as cc


def _db(rows):
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    c.executemany("INSERT INTO ohlcv VALUES ('ABC','D',?,?,?,?,?,1000)", rows)
    return c


def _days(n, start=20250102):
    import datetime as dt
    d = dt.date(start // 10000, (start // 100) % 100, start % 100)
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += dt.timedelta(days=1)
    return out


def test_a_good_buy_day_chart_passes_and_reports_the_replayed_outcome():
    days = _days(80)
    rows = [(t, 10 + i * 0.1, 10.5 + i * 0.1, 9.8 + i * 0.1, 10.2 + i * 0.1) for i, t in enumerate(days)]
    c = _db(rows)
    buy = rows[49]   # o, h, l: 14.9, 15.4, 14.7
    q = {"key": "q1", "chart": {"sym": "ABC", "asof": f"{str(buy[0])[:4]}-{str(buy[0])[4:6]}-{str(buy[0])[6:]}", "window": 40,
                                "forward": 25, "trade": {"entry": 15.0, "stop": 14.69}}}
    r = cc.check_question(c, "SET.99", q)
    assert r["problems"] == [], r
    assert any("in the 25 replayed bars" in n and "stop not hit" in n for n in r["notes"]), r


def test_a_bad_chart_is_caught():
    days = _days(80)
    rows = [(t, 10.0, 10.5, 9.8, 10.2) for t in days]
    c = _db(rows)
    asof = days[49]
    iso = f"{str(asof)[:4]}-{str(asof)[4:6]}-{str(asof)[6:]}"
    # an entry that never traded that day, and a stop above the day's low
    r = cc.check_question(c, "SET.99", {"key": "q2", "chart": {"sym": "ABC", "asof": iso, "window": 40, "forward": 20,
                                                              "trade": {"entry": 11.0, "stop": 9.9}}})
    assert any("did not trade that day" in p for p in r["problems"]) and any("not beyond the day's low" in p for p in r["problems"])
    # a weekend asof is not a bar
    r = cc.check_question(c, "SET.99", {"key": "q3", "chart": {"sym": "ABC", "asof": "2025-01-04", "window": 2, "forward": 0}})
    assert any("is not a bar" in p for p in r["problems"])
    # an unknown symbol does not resolve
    r = cc.check_question(c, "SET.99", {"key": "q4", "chart": {"sym": "ZZZ", "asof": iso}})
    assert any("no daily bars" in p for p in r["problems"])
