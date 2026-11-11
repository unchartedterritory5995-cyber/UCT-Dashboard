"""Cross-vendor parity for the UCT RS Rating against Deepvue (design round, 2026-11-08).

`tests/fixtures/indicators/rs_parity_deepvue.json` records both sides of one
measurement, value for value from the review
(`docs/research/relative-strength/reviews/2026-11-08-deepvue-parity.{md,py}` in
the uct-rs-plan repo): Deepvue's 1M 3M 6M 9M 12M ranks for 21 names, read from
the owner's Deepvue account on 2026-11-08 (last close 2026-11-06), and ours from
production `rs_rating_history` for session 2026-11-06.

What it asserts, and why each is the claim the member copy makes
(`app/src/content/rs/teachingData.js`, the RS Rating glossary entry):

* our IBD-style rating ranks the 21 names in the same order as Deepvue's 12M
  (Spearman >= 0.95; the review measured 1.00);
* where Deepvue rates a name 75 or above, ours is within about a point (mean
  |difference| <= 3; measured 1.4, signed -1.1);
* below 75 ours reads lower (the universe offset: Deepvue ranks against every
  listed stock, we rank against a liquid universe). The offset is asserted to be
  negative and printed; its size is the review's -11.1, pinned to the fixture's
  own `reported` block so neither can drift alone.

Nothing here computes a rating from bars: the fixture is a record, the test is
its arithmetic.
"""
from __future__ import annotations

import pytest

from tests.test_indicator_golden import load_case

CASE = load_case("rs_parity_deepvue")
DV = CASE["deepvue"]["rows"]
US = CASE["ours"]["rows"]
NAMES = list(DV)
TOP = CASE["reported"]["top_band_floor"]

SPEARMAN_FLOOR = 0.95
TOP_BAND_MAE_CEILING = 3.0


def _ranks(values):
    """Average ranks (1-based), ties sharing the mean of their positions."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def _spearman(a, b):
    ra, rb = _ranks(a), _ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5
    return num / den


def _col(rows, key):
    return [rows[t][key] for t in NAMES]


def test_the_fixture_is_the_review_shape():
    assert CASE["kind"] == "rs_parity" and CASE["case"] == "rs_parity_deepvue"
    assert len(NAMES) == 21 and list(US) == NAMES
    assert CASE["deepvue"]["columns"] == ["m1", "m3", "m6", "m9", "m12"]
    assert CASE["ours"]["columns"] == ["ibd", "fast", "m1", "m3", "m6", "m12"]
    for side in (DV, US):
        for t, row in side.items():
            for k, v in row.items():
                assert isinstance(v, int) and 1 <= v <= 99, (t, k, v)
    assert CASE["source"]["deepvue"]["read_on"] == "2026-11-08"
    assert CASE["source"]["ours"]["asof"] == "2026-11-06"
    assert CASE["caveats"] and any("MarketSurge" in c for c in CASE["caveats"])
    # the names the review lists, in its order
    assert NAMES[:3] == ["NVDA", "AAPL", "MSFT"] and NAMES[-1] == "CRCL"


def test_our_rating_ranks_stocks_in_deepvues_order():
    rho = _spearman(_col(US, "ibd"), _col(DV, "m12"))
    print(f"Spearman(our IBD-style, Deepvue 12M) = {rho:.3f} on {len(NAMES)} names")
    assert rho >= SPEARMAN_FLOOR
    assert rho == pytest.approx(CASE["reported"]["spearman_ibd_vs_dv12m"], abs=0.005)


def test_at_75_and_above_ours_is_within_about_a_point():
    top = [t for t in NAMES if DV[t]["m12"] >= TOP]
    diffs = [US[t]["ibd"] - DV[t]["m12"] for t in top]
    mae = sum(abs(d) for d in diffs) / len(diffs)
    bias = sum(diffs) / len(diffs)
    print(f"Deepvue 12M >= {TOP}: {len(top)} names, mean |diff| {mae:.2f}, mean ours-minus-Deepvue {bias:+.2f}")
    assert len(top) == CASE["reported"]["top_band_names"]
    assert mae <= TOP_BAND_MAE_CEILING
    assert round(bias, 1) == CASE["reported"]["bias_top_band"]


def test_below_75_ours_reads_lower_the_universe_offset():
    low = [t for t in NAMES if DV[t]["m12"] < TOP]
    offset = sum(US[t]["ibd"] - DV[t]["m12"] for t in low) / len(low)
    print(f"Deepvue 12M < {TOP}: {len(low)} names, mean ours-minus-Deepvue {offset:+.1f} (the universe offset)")
    assert len(low) == CASE["reported"]["below_band_names"]
    assert offset < 0, "ours should read LOWER below 75: we rank against a liquid universe, Deepvue against every listed stock"
    assert round(offset, 1) == CASE["reported"]["bias_below_band"]
    # and the glossary's "about 11 points" is what the record says
    assert 10 <= -offset <= 12


def test_overall_mae_matches_the_review():
    mae = sum(abs(u - d) for u, d in zip(_col(US, "ibd"), _col(DV, "m12"))) / len(NAMES)
    assert round(mae, 1) == CASE["reported"]["mae_ibd_vs_dv12m"]


def test_the_spearman_helper_handles_ties_and_order():
    assert _spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)
    assert _spearman([1, 2, 3, 4], [40, 30, 20, 10]) == pytest.approx(-1.0)
    assert _ranks([5, 1, 5, 3]) == [3.5, 1.0, 3.5, 2.0]


def test_the_glossary_states_this_measurement():
    """The member copy says what this file measures, and nothing it does not."""
    import json
    import pathlib
    teaching = json.loads((pathlib.Path(__file__).resolve().parents[1] / "api" / "data" / "rs_teaching.json")
                          .read_text(encoding="utf-8"))
    rating = next(g for g in teaching["glossary"] if g["key"] == "rsRating")
    text = rating["definition"]
    assert "Deepvue" in text and "same order" in text
    assert "75" in text and "about a point" in text
    assert "about 11 points lower" in text and "liquid universe" in text
    assert "MarketSurge" in text and "not" in text
    assert "has not been measured yet" not in text
