from api.services.screener.nl_compile import flatten_to_filters

A = {"key": "rs_rank", "op": "gte", "min": 80}
B = {"key": "price", "op": "gt", "min": 10}


def test_all_of_plain_leaves_flatten():
    assert flatten_to_filters({"all": [A, B]}) == [A, B]


def test_single_leaf_flattens():
    assert flatten_to_filters(A) == [A]


def test_any_or_none_or_not_do_not():
    assert flatten_to_filters({"any": [A, B]}) is None
    assert flatten_to_filters({"none": [A]}) is None
    assert flatten_to_filters({"not": A}) is None


def test_nested_group_does_not():
    assert flatten_to_filters({"all": [A, {"any": [B]}]}) is None


def test_field_compare_and_arith_do_not():
    assert flatten_to_filters({"all": [A, {"key": "price", "op": "gt_col", "value": "ema20"}]}) is None
    assert flatten_to_filters({"all": [{"key": "arith", "op": "gt", "value": "x"}]}) is None


def test_duplicate_keys_do_not():
    assert flatten_to_filters({"all": [A, {"key": "rs_rank", "op": "lte", "max": 95}]}) is None


def test_none_and_garbage():
    assert flatten_to_filters(None) is None
    assert flatten_to_filters({"all": []}) is None
    assert flatten_to_filters("nope") is None


def test_compile_english_carries_the_flattened_filters():
    from api.services.screener import nl_compile
    out = nl_compile.compile_english("x", caller=lambda m: {"criteria": "rs_rank >= 80 and price > 10", "assumptions": []})
    assert out["filters"] == [A, B]
    out = nl_compile.compile_english("x", caller=lambda m: {"criteria": "rs_rank >= 80 or price > 10", "assumptions": []})
    assert out["filters"] is None
