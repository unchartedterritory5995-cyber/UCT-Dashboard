"""Compare Symbols group picker — theme/sector/industry membership."""
from unittest import mock

from api.services import compare_groups as cg


def test_all_groups_rejects_bad_type():
    assert cg.all_groups("bogus") == []


def test_theme_groups_filter_chartable_and_skip_engine():
    themes = {"themes": [
        {"name": "Memory & HBM", "holdings": [
            {"sym": "MU"}, {"sym": "SNDK"}, {"sym": "ZZZZ"},          # ZZZZ not chartable
            {"sym": "WDC", "source": "engine"},                       # engine overlay → skipped
        ]},
        {"name": "Empty", "holdings": [{"sym": "ZZZZ"}]},             # no chartable → dropped
    ]}
    with mock.patch.object(cg._groups, "cap_universe_set", return_value={"MU", "SNDK", "WDC"}), \
         mock.patch("api.services.theme_db.get_all_themes", return_value=themes):
        cg.cache.delete_prefix("compare_groups_") if hasattr(cg.cache, "delete_prefix") else None
        groups = cg._theme_groups()
    names = {g["name"]: g["symbols"] for g in groups}
    assert "Empty" not in names
    assert set(names["Memory & HBM"]) == {"MU", "SNDK"}   # ZZZZ + engine WDC excluded


def test_group_members_caps_and_reports_total():
    big = [{"sym": f"T{i}"} for i in range(70)]
    themes = {"themes": [{"name": "Big", "holdings": big}]}
    cap = {f"T{i}" for i in range(70)}
    with mock.patch.object(cg._groups, "cap_universe_set", return_value=cap), \
         mock.patch("api.services.theme_db.get_all_themes", return_value=themes), \
         mock.patch.object(cg.cache, "get", return_value=None), \
         mock.patch.object(cg.cache, "set"):
        m = cg.group_members("theme", "Big")
    assert m["total"] == 70
    assert m["truncated"] is True
    assert len(m["symbols"]) == cg.MAX_MEMBERS


def test_list_groups_shape():
    themes = {"themes": [{"name": "A", "holdings": [{"sym": "MU"}]}]}
    with mock.patch.object(cg._groups, "cap_universe_set", return_value={"MU"}), \
         mock.patch("api.services.theme_db.get_all_themes", return_value=themes), \
         mock.patch.object(cg.cache, "get", return_value=None), \
         mock.patch.object(cg.cache, "set"):
        lst = cg.list_groups("theme")
    assert lst == [{"name": "A", "count": 1}]
