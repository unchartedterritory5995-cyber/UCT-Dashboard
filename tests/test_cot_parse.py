# tests/test_cot_parse.py
"""Unit tests for CFTC COT CSV parser — no DB, no network.

Note: CFTC publishes COT data in two CSV formats. This test uses the
column names from the historical `deacot{YEAR}.zip` annual file (long
form with spaces and parentheses), which is what cot_service expects.
"""
import csv
import io

import pytest


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


# ── contract code first, market name second (2026-11-22) ───────────────────────
# An INVENTED miniature in the legacy layout: the code column sits after the dates, as in the CFTC's
# deacot{YEAR}.zip annual.txt. Every figure below is made up; only the market names and codes are the CFTC's.

_CODE = "CFTC Contract Market Code"


def _make_coded_csv(rows: list[dict]) -> io.StringIO:
    fieldnames = [
        "Market and Exchange Names",
        "As of Date in Form YYYY-MM-DD",
        _CODE,
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


def _row(name: str, code: str, date: str = "2026-11-17", oi: int = 1000, nc=(60, 20), c=(300, 340), nr=(40, 40)):
    return {
        "Market and Exchange Names": name, _CODE: code, "As of Date in Form YYYY-MM-DD": date,
        "Open Interest (All)": str(oi),
        "Noncommercial Positions-Long (All)": str(nc[0]), "Noncommercial Positions-Short (All)": str(nc[1]),
        "Commercial Positions-Long (All)": str(c[0]), "Commercial Positions-Short (All)": str(c[1]),
        "Nonreportable Positions-Long (All)": str(nr[0]), "Nonreportable Positions-Short (All)": str(nr[1]),
    }


# The two names the CFTC's 2026 files carry that the legacy name table did not hold as written.
_MW_NOW = "WHEAT-HRSpring - MIAX FUTURES EXCHANGE"
_TA_TWO_SPACES = "MICRO ETHER  - CHICAGO MERCANTILE EXCHANGE"


def test_renamed_markets_match_by_code_and_a_name_only_market_still_matches():
    from api.services.cot_service import _parse_cftc_stream
    rows = [
        _row(_MW_NOW, "001626", oi=1111, nc=(70, 25)),
        _row(_TA_TWO_SPACES, "146022", oi=2222),
        _row("WHEAT-SRW - CHICAGO BOARD OF TRADE", "", oi=3333),            # no code: matched by name only
        _row("WHEAT-HRW - INVENTED EXCHANGE", "001612", oi=4444),           # a name nobody holds: matched by code only
        _row("WIDGET FUTURES - UNKNOWN EXCHANGE", "999999", oi=5555),       # neither
    ]
    records, unmapped = _parse_cftc_stream(_make_coded_csv(rows))
    by_sym = {r["symbol"]: r for r in records}
    assert sorted(by_sym) == ["KE", "MW", "TA", "ZW"]
    assert len(records) == 4
    assert by_sym["MW"] == {"symbol": "MW", "date": "2026-11-17", "large_spec_net": 45, "commercial_net": -40,
                            "small_spec_net": 0, "open_interest": 1111}
    assert by_sym["TA"]["open_interest"] == 2222
    assert by_sym["ZW"]["open_interest"] == 3333
    assert by_sym["KE"]["open_interest"] == 4444
    assert unmapped == {"WIDGET FUTURES - UNKNOWN EXCHANGE"}


@pytest.mark.parametrize("code_first", [True, False])
def test_a_code_match_beats_a_name_match_for_the_same_market_and_week(code_first):
    from api.services.cot_service import _parse_cftc_stream
    by_code = _row("GOLD - INVENTED EXCHANGE", "088691", oi=7000)                  # GC's code, a name nobody holds
    by_name = _row("GOLD - COMMODITY EXCHANGE INC.", "000000", oi=6000)            # GC's legacy name, a code nobody holds
    other_week = _row("GOLD - COMMODITY EXCHANGE INC.", "000000", date="2026-11-10", oi=5000)
    rows = [by_code, by_name] if code_first else [by_name, by_code]
    records, unmapped = _parse_cftc_stream(_make_coded_csv(rows + [other_week]))
    gold = sorted((r["date"], r["open_interest"]) for r in records if r["symbol"] == "GC")
    # The code row wins its week whichever comes first; the week with no code match keeps its name match.
    assert gold == [("2026-11-10", 5000), ("2026-11-17", 7000)]
    assert unmapped == set()


def test_without_a_code_column_the_current_names_match_by_name():
    """A file that has no code column (the older helper's layout) still finds MW's current name and Micro Ether's
    two-space spelling: the alias and the collapsed spaces."""
    from api.services.cot_service import _parse_cftc_stream
    mw = {**_ES_ROW, "Market and Exchange Names": _MW_NOW}
    ta = {**_ES_ROW, "Market and Exchange Names": _TA_TWO_SPACES}
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([mw, ta]))
    assert [r["symbol"] for r in records] == ["MW", "TA"]
    assert unmapped == set()


def test_every_listed_market_matches_by_its_code_alone():
    """The code table is cot_finer.CONTRACT_CODES (one table for both readers): every market the legacy reader keys
    is found by its code even under a name nobody holds."""
    from api.services import cot_finer
    from api.services.cot_service import SYMBOL_MAP, _parse_cftc_stream
    rows = [_row(f"RENAMED MARKET {i} - INVENTED EXCHANGE", cot_finer.CONTRACT_CODES[sym], oi=100 + i)
            for i, sym in enumerate(SYMBOL_MAP)]
    records, unmapped = _parse_cftc_stream(_make_coded_csv(rows))
    assert [r["symbol"] for r in records] == list(SYMBOL_MAP)
    assert unmapped == set()
