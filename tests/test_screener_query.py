import importlib
import pytest
from api.services.screener import query


def test_build_where_range_and_enum():
    sql, params = query.build_where([
        {"key": "rsi14", "op": "between", "min": 40, "max": 60},
        {"key": "sector", "op": "eq", "value": "Technology"},
        {"key": "above_50sma", "op": "eq", "value": 1},
    ])
    assert "rsi14 >= ?" in sql and "rsi14 <= ?" in sql
    assert "sector = ?" in sql
    assert params == [40, 60, "Technology", 1]


def test_build_where_rejects_unknown_key():
    with pytest.raises(ValueError):
        query.build_where([{"key": "drop_table", "op": "eq", "value": 1}])


def test_build_where_rejects_bad_op():
    with pytest.raises(ValueError):
        query.build_where([{"key": "rsi14", "op": "in", "values": [1]}])


def test_contains_uses_like():
    sql, params = query.build_where([{"key": "pattern", "op": "contains", "value": "vcp"}])
    assert "patterns LIKE ?" in sql
    assert params == ["%vcp%"]


def test_run_scan_filters_and_paginates(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "rsi14": 50, "sector": "Tech", "uct_composite": 90,
         "snapshot_date": "2026-06-19", "built_at": 1},
        {"ticker": "BBB", "rsi14": 80, "sector": "Tech", "uct_composite": 70,
         "snapshot_date": "2026-06-19", "built_at": 1},
    ])
    importlib.reload(query)
    res = query.run_scan({"filters": [{"key": "rsi14", "op": "lte", "max": 60}],
                          "view": "overview", "page": 1, "page_size": 10})
    assert res["total"] == 1
    assert res["rows"][0]["ticker"] == "AAA"
    assert "ticker" in res["view_columns"]
    assert res["snapshot_date"] == "2026-06-19"


# ─── the label over the results must describe the results ────────────────────
#
# 🔴 Measured on the live `screener.db` 2026-08-09: 3,589 rows — ONE stamped
# 2026-08-08, 3,583 stamped 2026-07-11, 5 stamped 2026-07-10. `run_scan`
# reported `MAX(snapshot_date)` (and reported it UNFILTERED), so a member saw
# "snapshot 2026-08-08" printed over fundamentals 28 days old and screened on
# them. ⛔ The shape is CONSTRUCTED here, never read off the live db.

_SKEW = (("2026-08-08", 1), ("2026-07-11", 3583), ("2026-07-10", 5))


def _skewed_db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "skew.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    rows, i = [], 0
    for date_str, count in _SKEW:
        for _ in range(count):
            # the outlier is the ONLY row in its sector, so a filter can select
            # exactly it without the test restating which ticker it is
            rows.append({"ticker": f"T{i}", "snapshot_date": date_str,
                         "sector": "Fresh" if date_str == "2026-08-08" else "Stale",
                         "uct_composite": i, "built_at": 1_700_000_000 + i})
            i += 1
    db.upsert_rows(rows)
    importlib.reload(query)
    return db


def test_run_scan_reports_the_median_of_the_served_rows_not_the_max(tmp_path, monkeypatch):
    _skewed_db(tmp_path, monkeypatch)
    res = query.run_scan({"page": 1, "page_size": 10})

    assert res["snapshot_date"] == "2026-07-11"
    assert res["snapshot_date"] != "2026-08-08", "one rebuilt row relabelled 3,588 stale ones"
    # more than one number, so a mixed table can say it is mixed
    assert res["snapshot"]["newest_snapshot_date"] == "2026-08-08"
    assert res["snapshot"]["oldest_snapshot_date"] == "2026-07-10"
    assert res["snapshot"]["rows_on_snapshot_date"] == 3583
    assert res["snapshot"]["distinct_snapshot_dates"] == 3
    assert res["snapshot"]["mixed"] is True


def test_the_RESULT_SET_is_not_filtered_to_the_representative_date(tmp_path, monkeypatch):
    """⛔ Fixing the label must not silently drop rows.

    Filtering the results down to the median date would make the label true by
    deleting the counter-examples — a labelling bug traded for a missing-data
    bug, which is strictly worse: a screen that quietly returns fewer symbols
    looks like a quiet market.
    """
    _skewed_db(tmp_path, monkeypatch)
    res = query.run_scan({"page": 1, "page_size": 500})
    assert res["total"] == 3589, "the whole table must still be matched"

    # and the off-median row is still REACHABLE, not merely counted
    fresh = query.run_scan({"filters": [{"key": "sector", "op": "eq", "value": "Fresh"}],
                            "page": 1, "page_size": 10})
    assert fresh["total"] == 1
    assert len(fresh["rows"]) == 1


def test_the_label_describes_the_FILTERED_set_it_is_printed_over(tmp_path, monkeypatch):
    """A member who screens only the freshly-rebuilt row is shown ITS date.

    This is the whole contract in one assertion: the date is a property of the
    rows being served, not of the table they came out of.
    """
    _skewed_db(tmp_path, monkeypatch)
    res = query.run_scan({"filters": [{"key": "sector", "op": "eq", "value": "Fresh"}]})
    assert res["snapshot_date"] == "2026-08-08"
    assert res["snapshot"]["rows"] == 1
    assert res["snapshot"]["mixed"] is False

    stale = query.run_scan({"filters": [{"key": "sector", "op": "eq", "value": "Stale"}]})
    assert stale["snapshot_date"] == "2026-07-11"
    assert stale["snapshot"]["newest_snapshot_date"] == "2026-07-11"


def test_total_and_the_described_row_count_are_one_number(tmp_path, monkeypatch):
    """They are read from the same GROUP BY, so they cannot disagree."""
    _skewed_db(tmp_path, monkeypatch)
    for spec in ({}, {"filters": [{"key": "sector", "op": "eq", "value": "Fresh"}]},
                 {"filters": [{"key": "uct_composite", "op": "lte", "max": 100}]}):
        res = query.run_scan(spec)
        assert res["total"] == res["snapshot"]["rows"], spec


def test_an_empty_result_set_reports_no_date(tmp_path, monkeypatch):
    _skewed_db(tmp_path, monkeypatch)
    res = query.run_scan({"filters": [{"key": "sector", "op": "eq", "value": "Nobody"}]})
    assert res["total"] == 0 and res["rows"] == []
    assert res["snapshot_date"] is None
    assert res["snapshot"]["mixed"] is False
    assert res["snapshot"]["rows_on_snapshot_date"] == 0
