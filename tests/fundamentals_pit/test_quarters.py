"""Standalone quarters: DIRECT, YTD difference, Q4 = FY - 9M, FY-SUM, refusals."""
from datetime import date

from api.services.fundamentals_pit.quarters import (DIRECT, FY_SUM, YTD, contiguous_window,
                                                    standalone_quarters)

D = date.fromisoformat
S = D("2024-01-01")


def test_q2_q3_q4_from_ytd_differences():
    durs = {(S, D("2024-03-31")): 100, (S, D("2024-06-30")): 250,
            (S, D("2024-09-30")): 420, (S, D("2024-12-31")): 600}
    q, _ = standalone_quarters(durs)
    assert q[D("2024-03-31")].val == 100 and q[D("2024-03-31")].method == DIRECT   # Q1 IS a quarter
    assert q[D("2024-06-30")].val == 150 and q[D("2024-06-30")].method == YTD
    assert q[D("2024-09-30")].val == 170
    assert q[D("2024-12-31")].val == 180 and q[D("2024-12-31")].start == D("2024-10-01")


def test_q4_from_fy_minus_three_direct_quarters_when_no_9m():
    durs = {(S, D("2024-03-31")): 100, (D("2024-04-01"), D("2024-06-30")): 150,
            (D("2024-07-01"), D("2024-09-30")): 170, (S, D("2024-12-31")): 600}
    q, _ = standalone_quarters(durs)
    assert q[D("2024-12-31")].val == 180 and q[D("2024-12-31")].method == FY_SUM


def test_no_subtraction_across_different_start_dates():
    # a 6M fact from one fiscal year and a 9M fact from ANOTHER must never subtract
    durs = {(D("2023-07-01"), D("2023-12-31")): 500, (S, D("2024-09-30")): 900}
    q, _ = standalone_quarters(durs)
    assert q == {}


def test_non_quarter_spans_are_not_quarters():
    durs = {(S, D("2024-01-31")): 10, (S, D("2024-08-31")): 80}      # 1M and 8M
    q, _ = standalone_quarters(durs)
    assert q == {}


def test_sixteen_week_first_quarter_is_a_quarter():
    # CAVA: 52/53-week year, Q1 is 16 weeks (112 days)
    s = D("2024-12-30")
    durs = {(s, D("2025-04-20")): 330, (s, D("2025-07-13")): 610}
    q, _ = standalone_quarters(durs)
    assert q[D("2025-07-13")].val == 280


def test_direct_quarter_wins_and_disagreement_is_logged():
    durs = {(S, D("2024-03-31")): 100, (S, D("2024-06-30")): 250,
            (D("2024-04-01"), D("2024-06-30")): 149}
    q, disc = standalone_quarters(durs)
    assert q[D("2024-06-30")].val == 149 and q[D("2024-06-30")].method == DIRECT
    assert disc == [(D("2024-06-30"), 149, 150)]


def test_contiguous_window_requires_unbroken_chain():
    durs = {(S, D("2024-03-31")): 1, (S, D("2024-06-30")): 3, (S, D("2024-09-30")): 6,
            (S, D("2024-12-31")): 10, (D("2025-01-01"), D("2025-03-31")): 5}
    q, _ = standalone_quarters(durs)
    w = contiguous_window(q, D("2025-03-31"))
    assert [x.val for x in w] == [2, 3, 4, 5]
    del q[D("2024-09-30")]
    assert contiguous_window(q, D("2025-03-31")) is None
