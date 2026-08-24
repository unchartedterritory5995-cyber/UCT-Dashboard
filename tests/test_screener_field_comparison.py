"""One column against another — benchmark metric 423.

Held by Barchart, Stockopedia, ChartMill, Stock Rover and TradingView. The
formula lane could already compare any expression to any expression, so the
filter rail was the only thing missing: margin trend, profitability sanity and
momentum acceleration were all inexpressible without writing a formula.
"""
import pytest

from api.services.screener import filters as F
from api.services.screener import query as Q


def _where(specs):
    return Q.build_where(specs)


# ── the comparison ───────────────────────────────────────────────────────────

def test_a_column_can_be_compared_to_another_column():
    sql, params = _where([{"key": "gross_margin", "op": "gt_col",
                           "other": "op_margin"}])
    assert '"gross_margin" > "op_margin"' in sql
    assert params == [], "a field comparison binds no value"


@pytest.mark.parametrize("op,sql_op", [("gt_col", ">"), ("gte_col", ">="),
                                       ("lt_col", "<"), ("lte_col", "<=")])
def test_every_declared_operator_renders(op, sql_op):
    sql, _ = _where([{"key": "roe", "op": op, "other": "roa"}])
    assert f'"roe" {sql_op} "roa"' in sql


def test_it_composes_with_an_ordinary_filter():
    sql, params = _where([{"key": "chg_pct_1w", "op": "gt_col",
                           "other": "chg_pct_1m"},
                          {"key": "price", "op": "gte", "min": 10}])
    assert '"chg_pct_1w" > "chg_pct_1m"' in sql and ">= ?" in sql
    assert params == [10]


# ── the boundary: the client never names a column ────────────────────────────

def test_the_right_hand_side_is_a_FILTER_KEY_not_a_column_name():
    """⛔ The registry is the only thing that may name a column. A raw column
    string would be the one place client text reaches SQL."""
    with pytest.raises(ValueError):
        _where([{"key": "roe", "op": "gt_col", "other": "roa; DROP TABLE x"}])
    with pytest.raises(ValueError):
        _where([{"key": "roe", "op": "gt_col", "other": "sqlite_master"}])


def test_an_unknown_or_missing_comparison_field_refuses():
    for other in (None, "", "not_a_filter", 7):
        with pytest.raises(ValueError):
            _where([{"key": "roe", "op": "gt_col", "other": other}])


def test_a_non_numeric_field_cannot_be_the_right_hand_side():
    """⛔ SQLite compares across storage classes by RANK rather than refusing,
    so `pe_ttm > sector` would return a confident, meaningless row set."""
    non_range = [k for k, f in F.FILTERS.items() if f.get("type") != "range"]
    assert non_range, "the registry has no non-range filter to test with"
    with pytest.raises(ValueError):
        _where([{"key": "pe_ttm", "op": "gt_col", "other": non_range[0]}])


def test_a_col_op_is_rejected_on_a_non_range_filter():
    non_range = next(k for k, f in F.FILTERS.items() if f.get("type") != "range")
    assert F.is_valid_op(non_range, "gt_col") is False


# ── one definition of the operator set ───────────────────────────────────────

def test_the_operator_table_is_the_only_definition():
    """`_VALID_OPS` and the query module both read `COL_OPS`, so the operator
    set cannot be admitted in one place and unrendered in the other."""
    assert set(F.COL_OPS) <= F._VALID_OPS["range"]
    for op in F.COL_OPS:
        sql, _ = _where([{"key": "roe", "op": op, "other": "roa"}])
        assert F.COL_OPS[op] in sql


def test_comparable_keys_are_exactly_the_range_filters():
    assert set(F.comparable_keys()) == {
        k for k, f in F.FILTERS.items() if f.get("type") == "range"}
    assert len(F.comparable_keys()) > 50, "this should be a broad surface"


# ── meta ─────────────────────────────────────────────────────────────────────

def test_meta_ships_the_pickable_right_hand_sides():
    """The control must not invent its own list of what is comparable."""
    meta = F.meta()
    fields = meta["comparable_fields"]
    keys = {f["key"] for f in fields}
    assert keys == set(F.comparable_keys())
    assert all(f.get("label") and f.get("category") for f in fields)
    assert set(meta["column_ops"]) == set(F.COL_OPS)
