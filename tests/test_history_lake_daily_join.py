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


def test_a_spin_off_is_healed_where_the_series_shows_its_cliff():
    """ABT 2013-01-02 (AbbVie): the second vendor files 2.0842; the served history adjusts for it the same way."""
    days = DAYS[:60]
    closes = [65.0] * 30 + [65.0 / 2.0842] * 30
    rec = {"sym": "ABT", "splits": [], "bars": [[d, c, c, c, c, 100] for d, c in zip(days, closes)]}
    out = J.heal_splits(rec, [[days[30], 2.0842]])
    assert out["healed_splits"] == [[days[30], 2.0842]]
    assert abs(max(b[4] for b in out["bars"]) - 65.0 / 2.0842) < 1e-3    # no cliff left at the spin-off


def test_an_event_the_reference_already_applied_is_never_applied_again():
    """BMI 2016: the reference has the 2:1 a day off the second vendor's date; applying both halves the price."""
    days = DAYS[:60]
    closes = [20.0] * 29 + [10.0] * 31                       # a one-day leftover step, as the off-by-a-day leaves
    rec = {"sym": "BMI", "splits": [[days[29], 2.0]], "bars": [[d, c, c, c, c, 100] for d, c in zip(days, closes)]}
    assert J.heal_splits(rec, [[days[30], 2.0]])["healed_splits"] == []


def test_a_second_vendor_event_beside_a_table_event_is_the_same_event_whatever_its_ratio():
    """2026-11-21. The split table already carries an event (the vendor's, or a TradingView-verified supplement
    row); the second vendor files the same event a day off at another ratio, and the rebuilt series still shows a
    step of THAT size (an event-day move). Before: the 2% ratio test said "a different event", the cliff test
    agreed, and the event was applied twice (ATRO 2018: the vendor's 1.15 on 10-11 plus Yahoo's 1.182 on 10-10).
    Now any second-vendor event within +-3 days of a table event is that event: never applied again."""
    days = DAYS[:60]
    closes = [39.0] * 31 + [30.0] * 29                       # a 1.30 step on DAYS[31]
    rec = {"sym": "DUP", "splits": [[days[30], 1.25]], "bars": [[d, c, c, c, c, 100] for d, c in zip(days, closes)]}
    out = J.heal_splits(rec, [[days[31], 1.30]])
    assert out["healed_splits"] == [] and out["bars"] == rec["bars"]


def test_a_second_vendor_event_well_away_from_every_table_event_is_still_its_own_event():
    days = DAYS[:60]
    closes = [39.0] * 40 + [30.0] * 20                       # a real 1.30 cliff on DAYS[40], ten days later
    rec = {"sym": "TWO", "splits": [[days[30], 1.25]], "bars": [[d, c, c, c, c, 100] for d, c in zip(days, closes)]}
    out = J.heal_splits(rec, [[days[40], 1.30]])
    assert out["healed_splits"] == [[days[40], 1.30]]


def test_too_short_an_overlap_joins_nothing():
    rec = _rec(DAYS[:50], [10.0] * 50)
    yf = [["2003-06-02", 10.0, 10.0, 10.0, 10.0, 1]] + [[d, 10.0, 10.0, 10.0, 10.0, 1] for d in DAYS[:50]]
    assert J.join_one(rec, yf)["pre"]["joined"] is False
