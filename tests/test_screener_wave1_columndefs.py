"""Every column a member can filter on or see in a view has a display def.

beta/current_ratio/close_position shipped filterable-but-undisplayable — a
member could filter on them and never see the value. This pins the gap class.
"""
import re


def _column_def_keys():
    src = open("app/src/pages/screener/columnDefs.js", encoding="utf-8").read()
    body = src.split("export const COLUMN_DEFS = {", 1)[1]
    return set(re.findall(r"^  (\w+): \{", body, flags=re.M))


def test_the_parser_can_see_a_known_key_and_not_a_phantom():
    keys = _column_def_keys()
    assert "ticker" in keys            # non-vacuity control
    assert "definitely_not_a_column" not in keys


def test_every_filterable_and_viewed_column_has_a_def():
    from api.services.screener import filters
    keys = _column_def_keys()
    want = {f["column"] for f in filters.FILTERS.values()}
    for v in filters.VIEWS.values():
        want |= set(v["columns"])
    missing = sorted(want - keys)
    assert not missing, f"member-visible columns with no display def: {missing}"
