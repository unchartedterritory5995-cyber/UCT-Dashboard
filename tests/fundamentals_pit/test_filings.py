"""Filing time: accession -> acceptance -> the instant a value became PUBLIC."""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from api.services.fundamentals_pit.filings import parse_submission_pages, public_at

ET = ZoneInfo("America/New_York")


def _page(rows):
    cols = ["accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form"]
    return {c: [r[i] for r in rows] for i, c in enumerate(cols)}


def test_acceptance_datetime_is_true_utc():
    # AAPL 10-K 0000320193-19-000119: EDGAR header <ACCEPTANCE-DATETIME>20191030181236
    # (Eastern) is served as 2019-10-30T22:12:36.000Z. Measured 2026-09-22.
    fl = parse_submission_pages([_page([
        ("0000320193-19-000119", "2019-10-31", "2019-09-28", "2019-10-30T22:12:36.000Z", "10-K")])])
    f = fl["0000320193-19-000119"]
    assert f.accepted_at.astimezone(ET) == datetime(2019, 10, 30, 18, 12, 36, tzinfo=ET)


def test_after_1730_filing_is_public_next_business_day_at_open():
    # accepted 18:12 ET, filingDate the next day -> not public until 06:00 ET that day
    fl = parse_submission_pages([_page([
        ("A", "2019-10-31", "2019-09-28", "2019-10-30T22:12:36.000Z", "10-K")])])
    assert fl["A"].public_at.astimezone(ET) == datetime(2019, 10, 31, 6, 0, tzinfo=ET)


def test_friday_evening_filing_is_public_monday():
    # NVDA 0001045810-23-000175: accepted Fri 2023-08-25 19:36 ET, filingDate Mon 08-28
    fl = parse_submission_pages([_page([
        ("B", "2023-08-28", "2023-07-30", "2023-08-25T23:36:34.000Z", "10-Q")])])
    assert fl["B"].public_at.astimezone(ET) == datetime(2023, 8, 28, 6, 0, tzinfo=ET)


def test_intraday_filing_is_public_at_acceptance():
    fl = parse_submission_pages([_page([
        ("C", "2018-02-15", "2017-12-31", "2018-02-15T17:14:45.000Z", "10-K")])])
    assert fl["C"].public_at == fl["C"].accepted_at


def test_public_never_precedes_edgar_open_of_filing_date():
    acc = datetime(2020, 1, 2, 9, 0, tzinfo=timezone.utc)      # 04:00 ET
    assert public_at(acc, date(2020, 1, 2)).astimezone(ET) == datetime(2020, 1, 2, 6, 0, tzinfo=ET)


def test_missing_acceptance_time_is_end_of_filing_day():
    assert public_at(None, date(2020, 1, 2)).astimezone(ET).hour == 23


def test_combined_filing_listed_twice_merges_late_and_periodic():
    anomalies = []
    fl = parse_submission_pages([
        _page([("X", "2026-07-08", "", "2026-07-08T20:41:20.000Z", "SC 13D/A")]),
        _page([("X", "2026-07-08", "", "2026-07-08T20:41:21.000Z", "10-Q")]),
    ], anomalies)
    assert fl["X"].form == "10-Q"
    assert fl["X"].accepted_at == datetime(2026, 7, 8, 20, 41, 21, tzinfo=timezone.utc)
    assert len(anomalies) == 1
