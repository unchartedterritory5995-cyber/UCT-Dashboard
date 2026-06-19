from api.services.screener import filters, snapshot_db


def test_every_filter_column_exists_in_schema():
    for key, f in filters.FILTERS.items():
        assert f["column"] in snapshot_db.COLUMNS, f"{key} -> {f['column']}"


def test_every_view_column_is_known():
    known = set(snapshot_db.COLUMNS)
    for vkey, v in filters.VIEWS.items():
        for c in v["columns"]:
            assert c in known, f"{vkey} -> {c}"


def test_meta_shape():
    m = filters.meta()
    assert {"filters", "views", "categories"} <= set(m)
    assert any(f["key"] == "sector" for f in m["filters"])
    assert any(v["key"] == "overview" for v in m["views"])


def test_op_validation():
    assert filters.is_valid_op("rsi14", "range") is False  # 'range' is a type, not an op
    assert filters.is_valid_op("rsi14", "between") is True
    assert filters.is_valid_op("rsi14", "in") is False
    assert filters.is_valid_op("sector", "eq") is True
    assert filters.is_valid_op("nope", "eq") is False
