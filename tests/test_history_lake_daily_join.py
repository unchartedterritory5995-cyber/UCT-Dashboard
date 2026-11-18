"""Step 3's join (tools/history_lake/daily_join.py): the second vendor's earlier bars are joined only on one ratio."""
from tools.history_lake import daily_join as J


def _rec(days, closes):
    return {"sym": "X", "bars": [[d, c, c, c, c, 100] for d, c in zip(days, closes)]}


DAYS = [f"2004-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(300)]


def test_one_ratio_joins_the_earlier_bars_on_the_rebuilt_basis():
    rec = _rec(DAYS, [10.0 + i * 0.01 for i in range(300)])
    yf = [["2003-06-02", 40.0, 40.0, 40.0, 40.0, 50]] + [[d, c * 4, c * 4, c * 4, c * 4, 25] for d, _, _, _, c, _ in rec["bars"]]
    out = J.join_one(rec, yf)
    assert out["pre"]["joined"] is True and out["pre"]["factor"] == 4.0
    assert out["bars"][0] == ["2003-06-02", 10.0, 10.0, 10.0, 10.0, 200]
    assert out["bars"][1:] == rec["bars"]


def test_a_wandering_ratio_joins_nothing():
    rec = _rec(DAYS, [10.0] * 300)
    yf = [["2003-06-02", 40.0, 40.0, 40.0, 40.0, 50]] + [[d, 10 + (i % 7), 0, 0, 10 + (i % 7), 1] for i, d in enumerate(DAYS)]
    out = J.join_one(rec, yf)
    assert out["pre"]["joined"] is False and "wanders" in out["pre"]["reason"]
    assert out["bars"] == rec["bars"]


def test_a_split_the_reference_lacks_is_healed_only_where_the_series_shows_its_cliff():
    """BCPC: a 3:2 the vendor's split reference lacks; the raw-based rebuild drops -33% on its date."""
    days = DAYS[:60]
    closes = [30.0] * 30 + [20.0] * 30                       # 3:2 on DAYS[30]
    rec = {"sym": "BCPC", "splits": [], "bars": [[d, c, c, c, c, 100] for d, c in zip(days, closes)]}
    out = J.heal_splits(rec, [[days[30], 1.5], ["2004-02-10", 2.0]])   # the second has no cliff: ignored
    assert out["healed_splits"] == [[days[30], 1.5]]
    assert {b[4] for b in out["bars"]} == {20.0} and out["bars"][0][5] == 150


def test_a_spin_off_filed_as_a_split_is_never_healed():
    """ABT 2013-01-02 (AbbVie): the second vendor lists 2.0842 as a split; the series is split-adjusted only."""
    days = DAYS[:60]
    closes = [65.0] * 30 + [65.0 / 2.0842] * 30
    rec = {"sym": "ABT", "splits": [], "bars": [[d, c, c, c, c, 100] for d, c in zip(days, closes)]}
    assert J.heal_splits(rec, [[days[30], 2.0842]])["healed_splits"] == []
    assert all(J.clean_split_ratio(r) for r in (1.5, 1.25, 2.0, 3.0, 0.1, 1 / 15, 4.0, 0.2))
    assert not any(J.clean_split_ratio(r) for r in (2.0842, 1.0475, 1.3382))


def test_too_short_an_overlap_joins_nothing():
    rec = _rec(DAYS[:50], [10.0] * 50)
    yf = [["2003-06-02", 10.0, 10.0, 10.0, 10.0, 1]] + [[d, 10.0, 10.0, 10.0, 10.0, 1] for d in DAYS[:50]]
    assert J.join_one(rec, yf)["pre"]["joined"] is False
