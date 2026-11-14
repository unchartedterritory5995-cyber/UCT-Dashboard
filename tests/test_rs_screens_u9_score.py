"""RS screens unit U9, part 2: the Leader score (``screener.rs_leader_score``).

    Leader score = 0.40 Strength + 0.25 Steady + 0.20 High + 0.15 Group

The recipe is pre-registered (2026-11-14): the test the score must pass was fixed
before any result was seen, so every number of it is pinned here and every part is
checked against arithmetic done by hand in the comments, never against the module's
own helpers.

Why each rail exists:
  * the first recipe double counted recent strength; this one is only worth testing if
    it is exactly the one written down;
  * the Group part must leave the stock itself out, or a strong stock raises its own
    group and the part repeats Strength;
  * a part that cannot be computed is blank and so is the score: never a partial sum.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.screener import rs_leader_score as ls
from api.services.screener import rs_post_pass

SRC = pathlib.Path(ls.__file__).read_text(encoding="utf-8")


def _stock(ticker, score, *, industry, sector, chg=0.0, steady=0.3, px=0.0, line=0.0,
           price=50.0, dv=5e7, etf=0):
    return {"ticker": ticker, "is_etf": etf, "price": price, "dollar_vol_30d": dv,
            "rs_rating_score": score, "rs_steady": steady, "px_below_high_pct": px,
            "rs_line_below_high_pct": line, "industry": industry, "sector": sector,
            "chg_pct_1m": chg}


def two_industries():
    """16 stocks, two industries of 8, each its own sector. Rating scores 1 to 16 (the
    b's hold 1 to 8, the a's 9 to 16), every 1-month change 0, every Steady input equal."""
    rows = [_stock(f"A{i}", 8 + i, industry="a", sector="A") for i in range(1, 9)]
    rows += [_stock(f"B{i}", i, industry="b", sector="B") for i in range(1, 9)]
    return rows


def four_industries():
    """27 stocks. Tech: Software (scores 20-27, 1-month change 1..8) and Chips (9-16,
    change 20). Health: Biotech (1-8, change -5) and Devices, 3 stocks (17-19, change 0),
    which is under the 8-member floor."""
    rows = [_stock(f"SW{i}", 19 + i, industry="Software", sector="Tech", chg=float(i))
            for i in range(1, 9)]
    rows += [_stock(f"CH{i}", 8 + i, industry="Chips", sector="Tech", chg=20.0)
             for i in range(1, 9)]
    rows += [_stock(f"BI{i}", i, industry="Biotech", sector="Health", chg=-5.0)
             for i in range(1, 9)]
    rows += [_stock(f"DV{i}", 16 + i, industry="Devices", sector="Health", chg=0.0)
             for i in range(1, 4)]
    return rows


def _strength(rows):
    return ls.percentiles({r["ticker"]: r["rs_rating_score"] for r in rows})


# ───────────────────────── the pre-registered numbers ────────────────────────

def test_the_recipe_is_the_one_registered_on_2026_11_14():
    assert ls.PREREGISTERED == "2026-11-14"
    assert ls.WEIGHTS == (("strength", 0.40), ("steady", 0.25), ("high", 0.20), ("group", 0.15))
    assert sum(w for _p, w in ls.WEIGHTS) == pytest.approx(1.0)
    assert ls.PARTS == ("strength", "steady", "high", "group")
    assert ls.NEAR_ZERO_AT_PCT == 25.0
    assert (ls.GROUP_MIN_MEMBERS, ls.GROUP_SHRINK_MEMBERS) == (8, 10)
    assert (ls.GROUP_RATING_SHARE, ls.GROUP_CHANGE_SHARE) == (0.5, 0.5)
    assert "PRE-REGISTERED 2026-11-14" in SRC, "the date must sit beside the constants"


def test_the_module_is_pure():
    """No I/O, no clock, no environment: the harness and the nightly must get one answer."""
    tree = ast.parse(SRC)
    imported = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import)
                for a in n.names}
    imported |= {(n.module or "").split(".")[0] for n in ast.walk(tree)
                 if isinstance(n, ast.ImportFrom) and n.level == 0}
    assert imported <= {"__future__", "bisect", "typing"}, imported
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    assert not ({"open", "os", "time", "sqlite3", "random", "datetime"} & names)


# ───────────────────────── percentile and nearness ───────────────────────────

def test_the_percentile_is_the_mid_rank_one():
    """Four values 1, 2, 2, 4. Below 1: none, equal: itself -> 100 x 0.5 / 4. The two
    2s: one below, two equal -> 100 x (1 + 1) / 4. The 4: three below -> 100 x 3.5 / 4."""
    got = ls.percentiles({"a": 1, "b": 2, "c": 2, "d": 4, "none": None, "text": "9", "flag": True})
    assert got == {"a": 12.5, "b": 50.0, "c": 50.0, "d": 87.5}
    assert ls.percentiles({"only": 7.0}) == {"only": 50.0}
    assert ls.percentiles({"x": 3.0, "y": 3.0, "z": 3.0}) == {"x": 50.0, "y": 50.0, "z": 50.0}
    assert ls.percentiles({"nan": float("nan"), "inf": float("inf")}) == {}
    assert ls.percentiles({}) == {}


def test_near_is_100_at_the_high_and_0_at_25_percent_under_it():
    assert ls.near(0.0) == 100.0
    assert ls.near(-12.5) == 50.0
    assert ls.near(-5.0) == 80.0
    assert ls.near(-25.0) == 0.0
    assert ls.near(-40.0) == 0.0, "clipped below"
    assert ls.near(3.0) == 100.0, "clipped above"
    assert ls.near(None) is None and ls.near(float("nan")) is None and ls.near("x") is None


# ───────────────────────── one score, start to finish, by hand ───────────────

def test_one_whole_score_by_hand():
    """A1 in `two_industries`, 5% under its price high and 10% under its RS-line high.

    Strength: A1's score 9 is 9th of 16 -> 100 x 8.5 / 16 = 53.125.
    Steady: every stock has the same input -> 50.
    High: near(-5) = 80, near(-10) = 60 -> 70.
    Group: the other seven a's hold ranks 10..16, mean 13 -> their mean Strength is
      100 x 12.5 / 16 = 78.125. Their median 1-month change is 0, the other industry's
      is 0: two equal values -> 50. x = 0.5 x 78.125 + 0.5 x 50 = 64.0625. The sector
      holds the same eight stocks, so shrinking changes nothing: g = 64.0625, the
      highest of the 16 (every other a has a weaker set of others, every b a far
      weaker one) -> 100 x 15.5 / 16 = 96.875.
    Score: 0.40 x 53.125 + 0.25 x 50 + 0.20 x 70 + 0.15 x 96.875
         = 21.25 + 12.5 + 14 + 14.53125 = 62.28125."""
    rows = two_industries()
    rows[0].update(px_below_high_pct=-5.0, rs_line_below_high_pct=-10.0)
    got = ls.score_rows(rows)["A1"]
    assert got["strength"] == pytest.approx(53.125)
    assert got["steady"] == pytest.approx(50.0)
    assert got["high"] == pytest.approx(70.0)
    assert got["group"] == pytest.approx(96.875)
    assert got["score"] == pytest.approx(62.28125)
    assert set(got) == {"score", "strength", "steady", "high", "group"}


def test_strength_and_steady_are_percentiles_within_the_floor_only():
    """B1 (score 1) is the weakest of 16 -> 100 x 0.5 / 16. An ETF, a $9 stock and a
    thinly traded stock with huge scores are not in the count and get nothing."""
    rows = two_industries() + [
        _stock("ETF", 99, industry="a", sector="A", etf=1),
        _stock("CHEAP", 99, industry="a", sector="A", price=9.99),
        _stock("THIN", 99, industry="a", sector="A", dv=19_999_999.0)]
    for i, r in enumerate(rows[:16]):
        r["rs_steady"] = i / 100.0          # A1 lowest ... B8 highest, all distinct
    got = ls.score_rows(rows)
    assert got["B1"]["strength"] == pytest.approx(100 * 0.5 / 16)
    assert got["A8"]["strength"] == pytest.approx(100 * 15.5 / 16)
    assert got["A1"]["steady"] == pytest.approx(100 * 0.5 / 16)
    assert got["B8"]["steady"] == pytest.approx(100 * 15.5 / 16)
    blank = {"score": None, "strength": None, "steady": None, "high": None, "group": None}
    assert got["ETF"] == got["CHEAP"] == got["THIN"] == blank
    # the reference set is the floor WITHOUT the full-year test: no 12-month rank needed
    assert all("rs_rating_12m" not in r for r in rows) and got["A1"]["score"] is not None
    assert rs_post_pass.LIQUID_FLOOR["price_min"] == 10.0


# ───────────────────────── the Group part ────────────────────────────────────

def test_group_value_by_hand_industry_shrunk_toward_its_sector():
    """SW1 in `four_industries` (27 stocks, so rank r has Strength 100 x (r - 0.5) / 27).

    Industry, SW1 left out: ranks 21..27, mean 24 -> 100 x 23.5 / 27 = 87.037037.
      The others' 1-month changes are 2..8, median 5. The other eligible industries'
      medians are 20 (Chips) and -5 (Biotech); Devices has 3 members and is not one.
      5 is the middle of three -> 100 x 1.5 / 3 = 50. x_industry = 68.518519, m = 7.
    Sector Tech, SW1 left out: ranks 21..27 and 9..16, sum 268 over 15 -> mean rank
      17.866667 -> 64.320988. Changes 2..8 and eight 20s: the 8th of 15 is 20. Health's
      median is -5 (eight -5s, three 0s). 20 is the higher of two -> 100 x 1.5 / 2 = 75.
      x_sector = 0.5 x 64.320988 + 37.5 = 69.660494.
    g = (7 x 68.518519 + 10 x 69.660494) / 17 = 69.190269."""
    rows = four_industries()
    g = ls.group_values(rows, _strength(rows))
    x_industry = 0.5 * (100 * 23.5 / 27) + 0.5 * 50.0
    x_sector = 0.5 * (100 * (268 / 15 - 0.5) / 27) + 0.5 * 75.0
    assert x_industry == pytest.approx(68.518519, abs=1e-6)
    assert x_sector == pytest.approx(69.660494, abs=1e-6)
    assert g["SW1"] == pytest.approx((7 * x_industry + 10 * x_sector) / 17)
    assert g["SW1"] == pytest.approx(69.190269, abs=1e-6)


def test_an_industry_under_eight_members_falls_back_to_the_sector():
    """DV1: Devices has 3 liquid members, so its value is Health's with DV1 left out.
    The other ten hold ranks 1..8, 18 and 19: mean 7.3 -> 100 x 6.8 / 27 = 25.185185.
    Their changes are eight -5s and two 0s, median -5; Tech's median is (8 + 20) / 2 = 14.
    -5 is the lower of two -> 25. g = 0.5 x 25.185185 + 12.5 = 25.092593, unshrunk."""
    rows = four_industries()
    g = ls.group_values(rows, _strength(rows))
    assert g["DV1"] == pytest.approx(0.5 * (100 * 6.8 / 27) + 0.5 * 25.0)
    assert g["DV1"] == pytest.approx(25.092593, abs=1e-6)
    # the floor counts the stock itself: 8 is in, 7 is out
    assert ls.GROUP_MIN_MEMBERS == 8
    seven = [r for r in four_industries() if r["ticker"] != "SW8"]
    g7 = ls.group_values(seven, _strength(seven))
    sector_only = [dict(r, industry=None) for r in seven]
    assert g7["SW1"] == pytest.approx(ls.group_values(sector_only, _strength(sector_only))["SW1"])
    assert g7["SW1"] != pytest.approx(g["SW1"])


def test_the_stock_itself_is_left_out_of_its_own_group():
    """SW1's own 1-month change and its own rating score are not in its group value.
    (The score is nudged inside its rank gap, 19 < x < 21, so no other stock's
    percentile moves.)"""
    rows = four_industries()
    base = ls.group_values(rows, _strength(rows))["SW1"]
    for change in ({"chg_pct_1m": 900.0}, {"chg_pct_1m": -900.0}, {"chg_pct_1m": None},
                   {"rs_rating_score": 19.5}, {"rs_rating_score": 20.9}):
        moved = [dict(r, **change) if r["ticker"] == "SW1" else r for r in four_industries()]
        assert ls.group_values(moved, _strength(moved))["SW1"] == pytest.approx(base), change
    # ... while a PEER's change does move it
    peer = [dict(r, chg_pct_1m=900.0) if r["ticker"] in ("SW5", "SW6", "SW7", "SW8") else r
            for r in four_industries()]
    assert ls.group_values(peer, _strength(peer))["SW1"] != pytest.approx(base)


def _two_groups(own_change, other_changes, rival_change):
    """Industry T: the stock ``T0`` and its peers; industry U: eight stocks that all
    changed by ``rival_change``. One sector, and every rating score the same, so every
    Strength percentile is 50 and only the 1-month changes decide the value."""
    rows = [_stock("T0", 5.0, industry="T", sector="S", chg=own_change)]
    rows += [_stock(f"T{i}", 5.0, industry="T", sector="S", chg=c)
             for i, c in enumerate(other_changes, 1)]
    rows += [_stock(f"U{i}", 5.0, industry="U", sector="S", chg=rival_change) for i in range(8)]
    return rows


def test_the_median_is_of_the_other_members_changes_only():
    """T0 gained 100% in a month; its seven peers gained 1..7%, median 4. Industry U's
    median is 4.2. Without T0 its industry is the WEAKER of the two (4 < 4.2): 100 x
    0.5 / 2 = 25, so x_industry = 0.5 x 50 + 0.5 x 25 = 37.5 with m = 7. One sector, so
    its change half is 50 and x_sector = 50. g = (7 x 37.5 + 10 x 50) / 17 = 44.852941.
    Counting T0's own 100% would lift the median to 4.5, over 4.2, and give 55.147."""
    rows = _two_groups(100.0, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0], 4.2)
    g = ls.group_values(rows, _strength(rows))
    assert g["T0"] == pytest.approx((7 * 37.5 + 10 * 50.0) / 17)
    assert g["T0"] == pytest.approx(44.852941, abs=1e-6)


def test_the_median_of_an_even_count_is_the_mean_of_the_two_middle_values():
    """Eight peers changed by 1, 2, 3, 4, 6, 7, 8 and 9%: the median is (4 + 6) / 2 = 5,
    under industry U's 5.5, so again the weaker of two: g = 44.852941 with m = 8 ->
    (8 x 37.5 + 10 x 50) / 18 = 44.444444. Taking the upper middle value (6) would put
    it over 5.5."""
    rows = _two_groups(0.0, [1.0, 2.0, 3.0, 4.0, 6.0, 7.0, 8.0, 9.0], 5.5)
    g = ls.group_values(rows, _strength(rows))
    assert g["T0"] == pytest.approx((8 * 37.5 + 10 * 50.0) / 18)
    assert g["T0"] == pytest.approx(44.444444, abs=1e-6)


def test_the_group_part_is_the_percentile_of_the_group_value_within_the_floor():
    rows = four_industries()
    got = ls.score_rows(rows)
    g = ls.group_values(rows, _strength(rows))
    ordered = sorted(g.values())
    for t, v in g.items():
        below = sum(1 for o in ordered if o < v)
        equal = sum(1 for o in ordered if o == v)
        assert got[t]["group"] == pytest.approx(100 * (below + 0.5 * equal) / 27), t
    tech = [got[r["ticker"]]["group"] for r in rows if r["sector"] == "Tech"]
    health = [got[r["ticker"]]["group"] for r in rows if r["sector"] == "Health"]
    assert min(tech) > max(health), "every Tech stock sits in a stronger group"


def test_no_sector_value_means_no_group_and_no_score():
    """Nothing to shrink toward and nothing to fall back on: blank, never the industry alone."""
    rows = [dict(r, sector=None) if r["ticker"].startswith("SW") else r for r in four_industries()]
    got = ls.score_rows(rows)
    assert got["SW1"]["group"] is None and got["SW1"]["score"] is None
    assert got["SW1"]["strength"] is not None and got["CH1"]["group"] is not None
    blank_name = [dict(r, sector="  ") if r["ticker"] == "CH1" else r for r in four_industries()]
    assert ls.score_rows(blank_name)["CH1"]["group"] is None
    # a sector under the floor is no sector value either
    small = [r for r in four_industries() if r["sector"] == "Tech"][:7]
    assert all(v["group"] is None for v in ls.score_rows(small).values())


# ───────────────────────── blanks ─────────────────────────────────────────────

@pytest.mark.parametrize("key, part", [("rs_rating_score", "strength"), ("rs_steady", "steady"),
                                       ("px_below_high_pct", "high"),
                                       ("rs_line_below_high_pct", "high")])
def test_a_missing_input_blanks_its_part_and_the_score_and_nothing_else(key, part):
    rows = four_industries()
    rows[0][key] = None
    got = ls.score_rows(rows)["SW1"]
    assert got[part] is None and got["score"] is None
    assert all(got[p] is not None for p in ls.PARTS if p != part)
    full = ls.score_rows(four_industries())
    assert full["SW1"]["score"] is not None and all(v["score"] is not None for v in full.values())


def test_an_unrated_stock_still_counts_as_a_member_but_not_in_the_mean():
    """SW8 has no rating score. Software still has 8 liquid members (the floor counts
    members), and SW1's industry mean is over the six others that have one:
    ranks 21..26 -> mean 23.5 of 26 rated stocks -> 100 x 23 / 26, m = 6."""
    rows = four_industries()
    rows[7]["rs_rating_score"] = None
    g = ls.group_values(rows, _strength(rows))
    x_industry = 0.5 * (100 * 23.0 / 26) + 0.5 * 50.0
    # sector: ranks 21..26 and 9..16 -> (141 + 100) / 14, of 26 rated; the changes are unchanged
    x_sector = 0.5 * (100 * (241 / 14 - 0.5) / 26) + 0.5 * 75.0
    assert g["SW1"] == pytest.approx((6 * x_industry + 10 * x_sector) / 16)


def test_combine_is_the_weighted_sum_and_leave_one_out_rescales():
    parts = {"strength": 80.0, "steady": 40.0, "high": 100.0, "group": 20.0}
    assert ls.combine(parts) == pytest.approx(0.40 * 80 + 0.25 * 40 + 0.20 * 100 + 0.15 * 20)
    assert ls.combine(parts) == pytest.approx(65.0)
    # without Group: (32 + 10 + 20) / 0.85
    assert ls.combine(parts, without="group") == pytest.approx(62.0 / 0.85)
    assert ls.combine(parts, without="strength") == pytest.approx((10 + 20 + 3) / 0.60)
    assert ls.combine({**parts, "high": None}) is None
    assert ls.combine({**parts, "high": None}, without="high") == pytest.approx((32 + 10 + 3) / 0.80)
    assert ls.combine({}) is None


def test_edges_never_raise():
    assert ls.score_rows([]) == {}
    assert ls.score_rows([{"ticker": None}, {"price": 50}]) == {}
    off = ls.score_rows([_stock("X", 5, industry="a", sector="A", price=1.0)])
    assert off == {"X": {"score": None, "strength": None, "steady": None, "high": None,
                         "group": None}}
    # a caller's own floor (the harness builds it from bars as of each date)
    everyone = ls.score_rows([_stock("X", 5, industry="a", sector="A", price=1.0)],
                             in_floor=lambda r: True)
    assert everyone["X"]["strength"] == 50.0 and everyone["X"]["group"] is None
