# tests/test_cot_parse.py
"""Unit tests for CFTC COT CSV parser — no DB, no network."""
import csv
import io
import pytest


def _make_cftc_csv(rows: list[dict]) -> io.StringIO:
    """Build a minimal CFTC-format CSV string from a list of row dicts."""
    fieldnames = [
        "Market_and_Exchange_Names",
        "Report_Date_as_MM_DD_YYYY",
        "Open_Interest_All",
        "NonComm_Positions_Long_All",
        "NonComm_Positions_Short_All",
        "Comm_Positions_Long_All",
        "Comm_Positions_Short_All",
        "NonRept_Positions_Long_All",
        "NonRept_Positions_Short_All",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return output


_ES_ROW = {
    "Market_and_Exchange_Names": "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    "Report_Date_as_MM_DD_YYYY": "03/07/2025",
    "Open_Interest_All": "2500000",
    "NonComm_Positions_Long_All": "300000",
    "NonComm_Positions_Short_All": "150000",
    "Comm_Positions_Long_All":    "800000",
    "Comm_Positions_Short_All":   "1000000",
    "NonRept_Positions_Long_All": "200000",
    "NonRept_Positions_Short_All":"150000",
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
    unknown = {**_ES_ROW, "Market_and_Exchange_Names": "WIDGET FUTURES - UNKNOWN EXCHANGE"}
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([unknown]))
    assert records == []
    assert "WIDGET FUTURES - UNKNOWN EXCHANGE" in unmapped


def test_parse_bad_date_row_skipped():
    from api.services.cot_service import _parse_cftc_stream
    bad = {**_ES_ROW, "Report_Date_as_MM_DD_YYYY": "not-a-date"}
    records, _ = _parse_cftc_stream(_make_cftc_csv([bad]))
    assert records == []


def test_parse_empty_csv():
    from api.services.cot_service import _parse_cftc_stream
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([]))
    assert records == []
    assert unmapped == set()


def test_parse_mixed_known_and_unknown():
    from api.services.cot_service import _parse_cftc_stream
    unknown = {**_ES_ROW, "Market_and_Exchange_Names": "MYSTERY MARKET - NOWHERE"}
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([_ES_ROW, unknown]))
    assert len(records) == 1
    assert records[0]["symbol"] == "ES"
    assert "MYSTERY MARKET - NOWHERE" in unmapped


def test_parse_comma_formatted_numbers():
    from api.services.cot_service import _parse_cftc_stream
    row = {**_ES_ROW, "Open_Interest_All": "2,500,000", "NonComm_Positions_Long_All": "300,000"}
    records, _ = _parse_cftc_stream(_make_cftc_csv([row]))
    assert records[0]["open_interest"] == 2500000
