"""The deep daily rebuild's rules (tools/history_lake/daily_build.py, 2026-11-18)."""
import sqlite3

from tools.history_lake import daily_build as B


def _rec(ticker, events, cik="1"):
    return {"ticker": ticker, "status": "ok", "cik": cik, "composite_figi": None,
            "events": [{"date": d, "ticker": s} for d, s in events]}


def test_a_ticker_with_no_events_record_is_taken_whole():
    lin = B.lineage([], ["AAPL"])
    assert lin["AAPL"] == {"since": None, "segments": [], "cut": False}


def test_today_s_company_starts_where_it_took_the_ticker_and_stitches_its_earlier_ones():
    """GEN: NLOK from 2019-11-05, GEN from 2022-11-08 (GenOn and Genesis are not in the events)."""
    lin = B.lineage([_rec("GEN", [("2022-11-08", "GEN"), ("2019-11-05", "NLOK")])], ["GEN"])
    assert lin["GEN"]["since"] == "2022-11-08"
    assert lin["GEN"]["segments"] == [{"sym": "NLOK", "from": "2019-11-05", "until": "2022-11-08"}]


def test_splits_are_taken_from_the_symbol_they_executed_under_inside_its_window():
    lin = {"since": "2022-11-08", "segments": [{"sym": "NLOK", "from": "2019-11-05", "until": "2022-11-08"}]}
    by_sym = {"NLOK": [["2018-01-02", 2.0], ["2020-06-01", 3.0]],      # 2018: before NLOK was this company
              "GEN": [["2010-01-04", 5.0], ["2024-03-01", 4.0]]}        # 2010: another company's GEN
    assert B.split_table(lin, "GEN", by_sym) == [["2020-06-01", 3.0], ["2024-03-01", 4.0]]


def _db(rows):
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE day (ticker TEXT, ymd INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL)")
    con.executemany("INSERT INTO day VALUES (?,?,?,?,?,?,?)", rows)
    return con


def test_the_ticker_s_own_bars_before_since_are_never_used():
    """GEN's own vendor bars before 2022-11-08 are GenOn / Genesis Healthcare: left out."""
    con = _db([("GEN", 20150203, 8.8, 8.8, 8.8, 8.76, 1), ("GEN", 20221108, 21.6, 21.6, 21.6, 21.62, 1),
               ("NLOK", 20200102, 25.0, 25.0, 25.0, 25.0, 1), ("NLOK", 20230102, 9.0, 9.0, 9.0, 9.0, 1)])
    lin = {"since": "2022-11-08", "segments": [{"sym": "NLOK", "from": "2019-11-05", "until": "2022-11-08"}]}
    rec = B.build_one(con, "GEN", lin, {})
    assert [b[0] for b in rec["bars"]] == ["2020-01-02", "2022-11-08"]


def test_the_lineage_is_split_adjusted_to_today_s_basis():
    """EMBJ: ERJ's bars before a 4:1 on EMBJ are divided by 4, volume x4."""
    con = _db([("ERJ", 20251031, 64.48, 64.48, 64.48, 64.48, 100), ("EMBJ", 20251103, 64.67, 64.67, 64.67, 64.67, 100),
               ("EMBJ", 20261117, 18.9, 18.9, 18.9, 18.9, 400)])
    lin = {"since": "2025-11-03", "segments": [{"sym": "ERJ", "from": "2010-12-15", "until": "2025-11-03"}]}
    rec = B.build_one(con, "EMBJ", lin, {"EMBJ": [["2026-11-16", 4.0]]})
    assert [(b[0], b[4], b[5]) for b in rec["bars"]] == [("2025-10-31", 16.12, 400), ("2025-11-03", 16.1675, 400),
                                                        ("2026-11-17", 18.9, 400)]


def test_class_shares_are_read_under_the_vendor_s_dot():
    con = _db([("BRK.B", 20261117, 500.0, 500.0, 500.0, 500.0, 1)])
    rec = B.build_one(con, "BRK-B", {"since": None, "segments": []}, {})
    assert rec["bars"][0][4] == 500.0
