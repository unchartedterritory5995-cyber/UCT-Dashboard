# tests/test_cot_parse.py
"""Unit tests for CFTC COT CSV parser — no DB, no network.

Note: CFTC publishes COT data in two CSV formats. This test uses the
column names from the historical `deacot{YEAR}.zip` annual file (long
form with spaces and parentheses), which is what cot_service expects.
"""
import csv
import io


def _make_cftc_csv(rows: list[dict]) -> io.StringIO:
    """Build a minimal CFTC-format CSV string from a list of row dicts."""
    fieldnames = [
        "Market and Exchange Names",
        "As of Date in Form YYYY-MM-DD",
        "Open Interest (All)",
        "Noncommercial Positions-Long (All)",
        "Noncommercial Positions-Short (All)",
        "Commercial Positions-Long (All)",
        "Commercial Positions-Short (All)",
        "Nonreportable Positions-Long (All)",
        "Nonreportable Positions-Short (All)",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return output


_ES_ROW = {
    "Market and Exchange Names": "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    "As of Date in Form YYYY-MM-DD": "2025-03-07",
    "Open Interest (All)": "2500000",
    "Noncommercial Positions-Long (All)": "300000",
    "Noncommercial Positions-Short (All)": "150000",
    "Commercial Positions-Long (All)":    "800000",
    "Commercial Positions-Short (All)":   "1000000",
    "Nonreportable Positions-Long (All)": "200000",
    "Nonreportable Positions-Short (All)": "150000",
}


def test_parse_known_symbol():
    from api.services.cot_service import _parse_cftc_stream
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([_ES_ROW]))
    assert len(records) == 1
    r = records[0]
    assert r["symbol"]         == "ES"
    assert r["date"]           == "2025-03-07"
    assert r["large_spec_net"] == 150000    # 300000 - 150000
    assert r["commercial_net"] == -200000   # 800000 - 1000000
    assert r["small_spec_net"] == 50000     # 200000 - 150000
    assert r["open_interest"]  == 2500000
    assert unmapped == set()


def test_parse_unknown_symbol_goes_to_unmapped():
    from api.services.cot_service import _parse_cftc_stream
    unknown = {**_ES_ROW, "Market and Exchange Names": "WIDGET FUTURES - UNKNOWN EXCHANGE"}
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([unknown]))
    assert records == []
    assert "WIDGET FUTURES - UNKNOWN EXCHANGE" in unmapped


def test_parse_bad_date_row_skipped():
    from api.services.cot_service import _parse_cftc_stream
    bad = {**_ES_ROW, "As of Date in Form YYYY-MM-DD": "not-a-date"}
    records, _ = _parse_cftc_stream(_make_cftc_csv([bad]))
    assert records == []


def test_parse_empty_csv():
    from api.services.cot_service import _parse_cftc_stream
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([]))
    assert records == []
    assert unmapped == set()


def test_parse_mixed_known_and_unknown():
    from api.services.cot_service import _parse_cftc_stream
    unknown = {**_ES_ROW, "Market and Exchange Names": "MYSTERY MARKET - NOWHERE"}
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([_ES_ROW, unknown]))
    assert len(records) == 1
    assert records[0]["symbol"] == "ES"
    assert "MYSTERY MARKET - NOWHERE" in unmapped


def test_parse_comma_formatted_numbers():
    from api.services.cot_service import _parse_cftc_stream
    row = {**_ES_ROW,
           "Open Interest (All)": "2,500,000",
           "Noncommercial Positions-Long (All)": "300,000"}
    records, _ = _parse_cftc_stream(_make_cftc_csv([row]))
    assert records[0]["open_interest"] == 2500000
