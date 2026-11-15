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


def test_the_report_shows_what_the_replay_reaches_after_the_stop():
    """A story can say "it later reached 5R without us"; the report shows whether the replay is long enough to show it
    (2026-11-14: an MU question said so over a 10-day replay that never got back to the buy)."""
    days = _days(80)
    rows = [(t, 10.0, 10.5, 9.8, 10.2) for t in days]
    rows[50] = (days[50], 10.0, 10.1, 9.0, 9.2)              # the day after the buy runs through the stop
    for i in range(51, 80):
        p = 9.2 + (i - 50) * 0.4                              # then climbs well past 5R (5R = 15.0 + 5 x 0.31)
        rows[i] = (days[i], p, p + 0.3, p - 0.2, p + 0.2)
    c = _db(rows)
    iso = lambda t: f"{str(t)[:4]}-{str(t)[4:6]}-{str(t)[6:]}"
    q = {"key": "q5", "chart": {"sym": "ABC", "asof": iso(days[49]), "window": 40, "forward": 25,
                                "trade": {"entry": 10.2, "stop": 9.79}}}
    r = cc.check_question(c, "SET.99", q)
    note = [n for n in r["notes"] if "replayed bars" in n][0]
    assert "stopped on day 1" in note and "after the stop it reaches" in note, note
    assert float(note.split("after the stop it reaches ")[1].rstrip("R")) > 5, note


def test_words_naming_the_200_day_need_200_bars_by_asof():
    """2026-11-14: the words name lines the chart must draw (D-021). A 200-day the stock's history cannot draw on the
    decision day fails; with the history it passes (the bank loads WARMUP_BARS ahead of the window for it)."""
    days = _days(80)
    rows = [(t, 10.0, 10.5, 9.8, 10.2) for t in days]
    c = _db(rows)
    iso = lambda t: f"{str(t)[:4]}-{str(t)[4:6]}-{str(t)[6:]}"
    q = {"key": "q6", "story": "It sits just over its 200-day.", "chart": {"sym": "ABC", "asof": iso(days[59]), "window": 40, "forward": 20}}
    r = cc.check_question(c, "SET.99", q)
    assert any("name the 200-day" in p for p in r["problems"]), r
    days2 = _days(330)
    c2 = _db([(t, 10.0, 10.5, 9.8, 10.2) for t in days2])
    q2 = {**q, "chart": {**q["chart"], "asof": iso(days2[299])}}
    assert cc.check_question(c2, "SET.99", q2)["problems"] == []


def test_a_sentence_saying_the_200_day_is_absent_agrees_with_a_young_chart():
    days = _days(80)
    c = _db([(t, 10.0, 10.5, 9.8, 10.2) for t in days])
    iso = lambda t: f"{str(t)[:4]}-{str(t)[4:6]}-{str(t)[6:]}"
    q = {"key": "q7", "why": "A young stock has no 200-day yet. The card does not ask for one.",
         "chart": {"sym": "ABC", "asof": iso(days[59]), "window": 40, "forward": 20}}
    assert cc.check_question(c, "SET.99", q)["problems"] == []
