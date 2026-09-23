"""Golden tests on REAL SEC data (trimmed companyfacts + submissions, values
untouched; see each fixture's `source`). These pin behaviour measured in the
2026-09-22 proof of concept against the filings themselves."""
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K, metrics as M, splits as SP
from api.services.fundamentals_pit.series import build_series

ET = ZoneInfo("America/New_York")
FIX = Path(__file__).parent / "fixtures"


def _load(name):
    d = json.loads((FIX / name).read_text())
    fl = FL.parse_submission_pages([d["submissions_page"]])
    return K.build(F.parse_companyfacts(d["companyfacts"]), fl), fl


def test_aapl_fy2009_restatement_timeline():
    # Original 10-K (public 2009-10-27 16:18:29 ET) states net sales $36,537M;
    # the 10-K/A (public 2010-01-25 16:25:58 ET) restates it to $42,905M.
    kb, fl = _load("aapl_fy2009_restatement.json")
    t1, t2 = fl["0001193125-09-214859"].public_at, fl["0001193125-10-012091"].public_at
    assert t1.astimezone(ET) == datetime(2009, 10, 27, 16, 18, 29, tzinfo=ET)
    assert t2.astimezone(ET) == datetime(2010, 1, 25, 16, 25, 58, tzinfo=ET)
    key = ("us-gaap:SalesRevenueNet", "USD", date(2008, 9, 28), date(2009, 9, 26))
    assert kb.known(key, t1 - timedelta(seconds=1)) is None
    assert kb.known(key, t1).fact.val == 36_537e6
    assert kb.known(key, t2 - timedelta(seconds=1)).fact.val == 36_537e6
    assert kb.known(key, t2).fact.val == 42_905e6
    assert kb.known(key, datetime(2026, 1, 1, tzinfo=timezone.utc)).fact.val == 42_905e6


def test_aapl_mixed_basis_ttm_is_never_emitted():
    # 2010-01-25 16:23 ET: the Q1 FY10 10-Q (restated comparatives) landed two
    # minutes before the FY09 10-K/A. FY(original) + YTD(restated) = 40,340M
    # is a number no filing supports; the phase-in warm-up withholds it.
    kb, fl = _load("aapl_fy2009_restatement.json")
    pts = build_series(kb, ["revenue_ttm"])["revenue_ttm"]
    assert all(abs(p.v - 40_340e6) > 1 for p in pts)
    assert all(p.t_eff >= datetime(2010, 7, 22, tzinfo=timezone.utc) for p in pts)


def test_nvda_eps_on_todays_share_basis_across_the_2024_split():
    # The 10-Q public 2024-05-29 reports pre-split EPS; the 10:1 split went
    # ex 2024-06-10; the 10-Q public 2024-08-28 reports post-split comparatives.
    kb, fl = _load("nvda_2024_split.json")
    led = SP.Ledger([SP.Split(date(2024, 6, 10), 10.0)])
    t = datetime(2024, 6, 1, tzinfo=timezone.utc)
    b = M.build_book(kb.state_at(t), led, kb, t)
    q = M.quarter_value(b, "eps_diluted", date(2024, 4, 28))
    assert q is not None and abs(q.v - 0.598) < 1e-9          # 5.98 / 10
    # The Q2 10-Q (2024-08-28) re-reports only Q2 and 6M, so Q1 stays 0.598 on
    # today's basis; the post-split Q1 comparative (0.60) arrives with the
    # Q1 FY26 10-Q (2025-05-28).
    t_mid = datetime(2024, 9, 1, tzinfo=timezone.utc)
    b_mid = M.build_book(kb.state_at(t_mid), led, kb, t_mid)
    assert abs(M.quarter_value(b_mid, "eps_diluted", date(2024, 4, 28)).v - 0.598) < 1e-9
    t2 = datetime(2025, 6, 1, tzinfo=timezone.utc)
    b2 = M.build_book(kb.state_at(t2), led, kb, t2)
    assert abs(M.quarter_value(b2, "eps_diluted", date(2024, 4, 28)).v - 0.60) < 1e-9
    # the split re-basing is NOT a restatement
    assert kb.restatements("us-gaap:EarningsPerShareDiluted", t2, M._per_share_same(led, led.per_share_today)) == []


def test_nvda_split_is_recoverable_from_the_filings_alone():
    kb, fl = _load("nvda_2024_split.json")
    pairs = []
    for key, rows in kb.history.items():
        if key[0] == "us-gaap:EarningsPerShareDiluted":
            for a, b in zip(rows, rows[1:]):
                pairs.append((a.public_at.astimezone(ET).date(), a.fact.val, b.public_at.astimezone(ET).date(), b.fact.val))
    ratios = {r for _, _, r in SP.infer_splits(pairs)}
    assert ratios == {10.0}
