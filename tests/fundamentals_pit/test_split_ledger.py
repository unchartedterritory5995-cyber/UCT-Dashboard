"""The split ledger is VERIFIED against the filings, never trusted blindly.

Golden: TSLA (5:1 2020-08-31, then 3:1 2022-08-25) and NVDA (10:1 2024-06-10),
real SEC facts. A correct ledger verifies; a missing, doubled, misdated or
phantom split is caught."""
import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K, metrics as M
from api.services.fundamentals_pit import split_ledger as SL, splits as SP

from ._build import fact, filing

FIX = Path(__file__).parent / "fixtures"


def _kb(name):
    d = json.loads((FIX / name).read_text())
    return K.build(F.parse_companyfacts(d["companyfacts"]),
                   FL.parse_submission_pages([d["submissions_page"]])), d


def test_tsla_real_multi_split_ledger_verifies():
    kb, d = _kb("tsla_multi_split.json")
    led = SL.ledger_from_rows(d["split_rows_fixture"])
    v = SL.verify(kb, led)
    assert v.status == "verified", v.reasons
    assert {r for _, _, r in v.inferred} == {5.0, 3.0}         # both splits seen IN THE FILINGS


@pytest.mark.parametrize("bad", ["missing_first", "missing_second", "doubled", "misdated"])
def test_tsla_broken_ledgers_are_caught(bad):
    kb, _ = _kb("tsla_multi_split.json")
    s1, s2 = SP.Split(date(2020, 8, 31), 5.0), SP.Split(date(2022, 8, 25), 3.0)
    led = {"missing_first": [s2], "missing_second": [s1], "doubled": [s1, s1, s2],
           "misdated": [SP.Split(date(2021, 9, 1), 5.0), s2]}[bad]
    assert SL.verify(kb, SP.Ledger(led)).status == "unverified"


def test_nvda_real_ledger_verifies_and_empty_does_not():
    kb, _ = _kb("nvda_2024_split.json")
    assert SL.verify(kb, SP.Ledger([SP.Split(date(2024, 6, 10), 10.0)])).status == "verified"
    assert SL.verify(kb, SP.Ledger()).status == "unverified"


def test_phantom_split_is_caught():
    # the filings re-report the same EPS unchanged across the window: no split
    fl = {a: filing(a, t) for a, t in (("A", "2023-05-01T20:00:00"), ("B", "2024-05-01T20:00:00"))}
    fx = [fact("EarningsPerShareDiluted", s, e, v, a, unit="USD/shares")
          for a in "AB" for s, e, v in (("2023-01-01", "2023-03-31", 1.25), ("2022-01-01", "2022-12-31", 4.80))]
    kb = K.build(fx, fl)
    assert SL.verify(kb, SP.Ledger()).status == "verified"
    assert SL.verify(kb, SP.Ledger([SP.Split(date(2023, 9, 1), 2.0)])).status == "unverified"


def test_restatement_that_looks_like_a_split_is_not_one_when_shares_disagree():
    # EPS 3.00 -> 1.00 on two periods (a restatement), weighted shares unchanged
    fl = {a: filing(a, t) for a, t in (("A", "2021-08-12T12:00:00"), ("B", "2022-08-09T20:00:00"))}
    fx = []
    for a, k in (("A", 1.0), ("B", 3.0)):
        fx += [fact("EarningsPerShareDiluted", "2021-01-01", "2021-06-30", 3.0 / k, a, unit="USD/shares"),
               fact("EarningsPerShareDiluted", "2021-04-01", "2021-06-30", 1.5 / k, a, unit="USD/shares"),
               fact("WeightedAverageNumberOfDilutedSharesOutstanding", "2021-01-01", "2021-06-30", 7.7e7, a, unit="shares"),
               fact("WeightedAverageNumberOfDilutedSharesOutstanding", "2021-04-01", "2021-06-30", 7.7e7, a, unit="shares")]
    kb = K.build(fx, fl)
    assert SL.verify(kb, SP.Ledger()).status == "verified"


def test_rounding_uninformative_periods_do_not_vote():
    # 0.05 -> 0.01 is anywhere in [3, 11]: evidence of no particular split
    fl = {a: filing(a, t) for a, t in (("A", "2021-08-12T12:00:00"), ("B", "2022-08-09T20:00:00"))}
    fx = [fact("EarningsPerShareDiluted", s, e, v, a, unit="USD/shares")
          for a, vals in (("A", (0.06, 0.05)), ("B", (0.02, 0.01)))
          for (s, e), v in zip((("2021-01-01", "2021-06-30"), ("2021-04-01", "2021-06-30")), vals)]
    assert SL.verify(K.build(fx, fl), SP.Ledger()).status == "no_evidence"


def test_conflicting_sources_raise():
    with pytest.raises(SL.LedgerConflict):
        SL.ledger_from_rows([("X", "2020-01-02", 2.0, "massive"), ("X", "2020-01-02", 3.0, "massive")])
    led = SL.ledger_from_rows([("GOOGL", "2022-07-18", 20.0, "massive"), ("GOOG", "2022-07-18", 20.0, "massive")])
    assert [s.ratio for s in led.splits] == [20.0]               # two share classes, one event


def test_eps_ttm_is_continuous_across_both_tsla_splits_on_todays_basis():
    # With the verified ledger, a TTM computed just before a split and a TTM of
    # the same period after the recast agree (no 5x / 3x step).
    kb, d = _kb("tsla_multi_split.json")
    led = SL.ledger_from_rows(d["split_rows_fixture"])
    q = date(2020, 6, 30)
    b1 = M.build_book(kb.state_at(datetime(2020, 8, 1, tzinfo=timezone.utc)), led, kb,
                      datetime(2020, 8, 1, tzinfo=timezone.utc))
    b2 = M.build_book(kb.state_at(datetime(2021, 8, 1, tzinfo=timezone.utc)), led, kb,
                      datetime(2021, 8, 1, tzinfo=timezone.utc))
    v1, v2 = M.quarter_value(b1, "eps_diluted", q), M.quarter_value(b2, "eps_diluted", q)
    assert v1 is not None and v2 is not None
    assert abs(v1.v - v2.v) <= 0.01 / 15 + 1e-9                  # equal up to the recast's rounding
