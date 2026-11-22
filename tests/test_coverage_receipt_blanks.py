"""The scan receipt and the blanks the scan itself keeps.

`query.coverage_for` counts a row "not computable" when a column one of the screen's
criteria reads is NULL, because the WHERE drops that row without saying so. An exclude
(`not_in`) is the one clause that does NOT drop a blank (`col NOT IN (...) OR col IS
NULL`), so a row that is blank only there was answered, and listed.

2026-11-15, the first morning the RS screens held rows on the live site: every one of
them excludes `rs_flag = buyout_pending`, nearly every stock's `rs_flag` is blank, and
the receipt said 10,881 of 11,174 stocks could not be checked on a screen that listed
1,845 of them. The page turned that into "10,811 stocks have no RS Rating" on a morning
when 231 had none. `missing_keys` is what lets the page name a cause only when there is
exactly one.
"""
import pytest

ROWS = [
    {"ticker": "AAA", "price": 100.0, "gross_margin": 60.0, "security_type": "Stock",
     "dollar_vol_30d": 1e7, "snapshot_date": "2026-10-01"},
    {"ticker": "BBB", "price": 50.0, "gross_margin": 20.0, "security_type": None,
     "dollar_vol_30d": 1e7, "snapshot_date": "2026-10-01"},
    {"ticker": "CCC", "price": 10.0, "gross_margin": None, "security_type": None,
     "dollar_vol_30d": 1e7, "snapshot_date": "2026-10-01"},
    {"ticker": "DDD", "price": None, "gross_margin": None, "security_type": "Stock",
     "dollar_vol_30d": 1e7, "snapshot_date": "2026-10-01"},
    {"ticker": "EEE", "price": 30.0, "gross_margin": 40.0, "security_type": "ETF",
     "dollar_vol_30d": 1e7, "snapshot_date": "2026-10-01"},
]
NO_ETF = {"key": "security_type", "op": "not_in", "values": ["ETF"]}


@pytest.fixture
def Q(tmp_path, monkeypatch):
    from api.services.screener import query
    from api.services.screener import snapshot_db as db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    db.upsert_rows([dict(r) for r in ROWS])
    return query


def _counts(c):
    return c["evaluated"], c["answered"], c["dropped"], c["not_computable"]


def test_a_blank_under_an_exclude_is_answered_because_the_scan_lists_it(Q):
    spec = {"filters": [NO_ETF], "page_size": 50}
    listed = sorted(r["ticker"] for r in Q.run_scan(spec)["rows"])
    # the two rows with no type are on the list: the exclude keeps a blank
    assert listed == ["AAA", "BBB", "CCC", "DDD"]
    c = Q.coverage_for(spec)
    assert _counts(c) == (5, 5, 0, 0)
    assert c["missing_keys"] == {} and c["dropped_symbols"] == []
    # the receipt can never say fewer were answered than the scan listed
    assert c["answered"] >= len(listed)


def test_an_exclude_beside_a_real_criterion_counts_only_the_real_blanks(Q):
    spec = {"filters": [{"key": "gross_margin", "op": "gte", "min": 30}, NO_ETF], "page_size": 50}
    assert [r["ticker"] for r in Q.run_scan(spec)["rows"]] == ["AAA"]
    c = Q.coverage_for(spec)
    assert _counts(c) == (5, 3, 0, 2)
    assert c["missing_keys"] == {"gross_margin": 2}
    assert {d["ticker"] for d in c["dropped_symbols"]} == {"CCC", "DDD"}
    # the blank type is never named as the reason
    assert all(d["detail"] == "no value for Gross Margin" for d in c["dropped_symbols"])


@pytest.mark.parametrize("other", [
    {"key": "security_type", "op": "in", "values": ["Stock", "ETF"]},
    {"key": "security_type", "op": "eq", "value": "Stock"},
])
def test_a_key_read_another_way_as_well_is_not_excused(Q, other):
    # `in` and `eq` drop a blank, so the same column read by one of them is "no value" again
    spec = {"filters": [NO_ETF, other], "page_size": 50}
    listed = sorted(r["ticker"] for r in Q.run_scan(spec)["rows"])
    assert listed == ["AAA", "DDD"]
    c = Q.coverage_for(spec)
    assert _counts(c) == (5, 3, 0, 2)
    assert c["missing_keys"] == {"security_type": 2}
    assert {d["ticker"] for d in c["dropped_symbols"]} == {"BBB", "CCC"}


def test_an_exclude_inside_a_group_is_excused_too(Q, monkeypatch):
    from api.services.screener import logic
    monkeypatch.setenv(logic.FLAG, "1")
    spec = {"filters": [], "logic": {"all": [NO_ETF]}, "page_size": 50}
    listed = sorted(r["ticker"] for r in Q.run_scan(spec)["rows"])
    assert listed == ["AAA", "BBB", "CCC", "DDD"]
    c = Q.coverage_for(spec)
    assert _counts(c) == (5, 5, 0, 0) and c["missing_keys"] == {}


def test_missing_keys_counts_each_blank_column_over_the_rows_that_were_not_computable(Q):
    spec = {"filters": [{"key": "gross_margin", "op": "gte", "min": 30},
                        {"key": "price", "op": "gte", "min": 20}], "page_size": 50}
    c = Q.coverage_for(spec)
    assert _counts(c) == (5, 3, 0, 2)
    # CCC has no margin; DDD has neither. A row blank in two columns counts in both.
    assert c["missing_keys"] == {"gross_margin": 2, "price": 1}
    assert sum(c["missing_keys"].values()) >= c["not_computable"]


def test_a_column_that_was_never_blank_is_not_in_the_map(Q):
    # every row holds its traded value, so that column is absent from the map, not a zero
    spec = {"filters": [{"key": "gross_margin", "op": "gte", "min": 30},
                        {"key": "dollar_vol_30d", "op": "gte", "min": 1}], "page_size": 50}
    c = Q.coverage_for(spec)
    assert _counts(c) == (5, 3, 0, 2)
    assert c["missing_keys"] == {"gross_margin": 2}


def test_a_screen_with_nothing_blank_carries_an_empty_map(Q):
    c = Q.coverage_for({"filters": [{"key": "price", "op": "gte", "min": 20}], "page_size": 50})
    assert _counts(c) == (5, 4, 0, 1) and c["missing_keys"] == {"price": 1}
    c = Q.coverage_for({"filters": []})
    assert _counts(c) == (5, 5, 0, 0) and c["missing_keys"] == {}
