"""e99 PLACEMENT: the Pine `request.financial` supply places each value at its fiscal period end, as TradingView does
(coordinator ruling 2026-11-26), graded against TradingView's OWN steps.

Vendor truth: tests/fixtures/vendor/financial-steps-aapl-nvda-1d-2026-11-26.json (our probe captures of
`request.financial(syminfo.tickerid, id, FY|FQ)` on NASDAQ:AAPL and NASDAQ:NVDA 1D, full history; every step's date and
value). Ours: tests/fundamentals_pit/fixtures/e99_aapl_nvda_published_metrics.json (the store's derivation over SEC
EDGAR data, in the published artifact's shape). Graded through the route itself (`build_fields`):
  * DATES: every step we draw within TradingView's history lands on a TradingView step date, and every TradingView
    step within ours is ours, for FQ and FY of all five ids and TTM on the FQ dates; the exceptions are NAMED and pinned
    (each a data difference, never a placement one);
  * VALUES: within 0.5% on those dates, the exceptions counted and bounded;
  * the point-in-time store is untouched: the published series are not mutated, every point still carries its filing's
    session (`publishedFrom`), and no frozen methodology file moved.
Our deeper history (FQ before TradingView's late 2018) is not graded: extra history is not wrong."""
import copy
import json
from pathlib import Path

import pytest

from api.services import pine_financial as PF
from api.services.fundamentals_pit import v5_prod as VP

ROOT = Path(__file__).resolve().parent
TV = json.loads((ROOT / "fixtures/vendor/financial-steps-aapl-nvda-1d-2026-11-26.json").read_text())["steps"]
OURS = json.loads((ROOT / "fundamentals_pit/fixtures/e99_aapl_nvda_published_metrics.json").read_text())["metrics"]
PAIRS = [("TOTAL_REVENUE", "FQ"), ("TOTAL_REVENUE", "FY"), ("EARNINGS_PER_SHARE_DILUTED", "FQ"),
         ("EARNINGS_PER_SHARE_DILUTED", "FY"), ("FREE_CASH_FLOW", "FY"), ("TOTAL_EQUITY", "FQ"), ("TOTAL_EQUITY", "FY"),
         ("TOTAL_SHARES_OUTSTANDING", "FQ"), ("TOTAL_SHARES_OUTSTANDING", "FY")]

# ⛔ THE NAMED DATE EXCEPTIONS, each measured 2026-11-26 and each a DATA difference (the placement is the same rule):
#   NVDA FQ 2026-10-30: the quarter's 10-Q is not in our SEC snapshot (fetched before it reached companyfacts);
#   NVDA FREE_CASH_FLOW FY 2013-2023: the store's fcf yields no fiscal-year value for those years (its capex tag);
#   NVDA TOTAL_SHARES_OUTSTANDING: the cover-page count is reported rounded to 10M shares, so equal neighbours draw one
#   step where TradingView's count moves (FQ), and FY2019's count moved where TradingView's did not.
TV_ONLY = {("NVDA", "TOTAL_REVENUE", "FQ"): ["2026-10-30"], ("NVDA", "EARNINGS_PER_SHARE_DILUTED", "FQ"): ["2026-10-30"],
           ("NVDA", "TOTAL_EQUITY", "FQ"): ["2026-10-30"],
           ("NVDA", "FREE_CASH_FLOW", "FY"): ["2013-01-31", "2014-01-31", "2015-01-30", "2016-01-29", "2017-01-31", "2018-01-31",
                                             "2019-01-31", "2020-01-31", "2021-01-29", "2022-01-31", "2023-01-31"],
           ("NVDA", "TOTAL_SHARES_OUTSTANDING", "FQ"): ["2021-10-29", "2023-04-28", "2023-07-31", "2023-10-31", "2025-04-30",
                                                       "2025-10-31", "2026-01-30"]}
OURS_ONLY = {("NVDA", "TOTAL_SHARES_OUTSTANDING", "FY"): ["2019-01-31"]}
# values: (dates within 0.5%, dates compared, largest relative difference allowed); every other pair is ALL within 0.5%.
# AAPL revenue FY2015/FY2016 (TradingView's figures 1.0% and 0.7% below the 10-K's); EPS: TradingView computes four
# decimals, the filings report two; NVDA share counts: the 10M rounding above.
VALUE_EXCEPTIONS = {("AAPL", "TOTAL_REVENUE", "FY"): (15, 17, 0.011), ("AAPL", "EARNINGS_PER_SHARE_DILUTED", "FQ"): (31, 32, 0.007),
                    ("NVDA", "EARNINGS_PER_SHARE_DILUTED", "FQ"): (30, 32, 0.008),
                    ("NVDA", "TOTAL_SHARES_OUTSTANDING", "FQ"): (22, 23, 0.015),
                    ("NVDA", "TOTAL_SHARES_OUTSTANDING", "FY"): (10, 15, 0.025)}


def _fields(sym):
    return PF.build_fields({"company": {"withheldSplitSensitive": False}, "metrics": OURS[sym]})


def _steps(points, since):
    """Our points as the steps a chart shows: each the first day of a CHANGED value (a repeated value draws no step)."""
    o = {p["knownFrom"]: p["v"] for p in points if p["v"] is not None and p["knownFrom"] >= since}
    out, prev = {}, None
    for d in sorted(o):
        if o[d] != prev:
            out[d] = o[d]
        prev = o[d]
    return out


@pytest.mark.parametrize("sym", ["AAPL", "NVDA"])
def test_every_step_date_is_tradingviews_fq_and_fy_all_five_ids(sym):
    f = _fields(sym)
    graded = 0
    for fid, per in PAIRS:
        tv = dict((d, v) for d, v in TV[sym][f"{fid} {per}"])
        ours = _steps(f[f"{fid}:{per}"]["points"], min(tv))
        assert ours, (sym, fid, per)
        assert sorted(set(ours) - set(tv)) == OURS_ONLY.get((sym, fid, per), []), (sym, fid, per, "ours only")
        assert sorted(d for d in set(tv) - set(ours) if d >= min(ours)) == TV_ONLY.get((sym, fid, per), []), (sym, fid, per, "TV only")
        graded += len(set(ours) & set(tv))
    assert graded == {"AAPL": 213, "NVDA": 186}[sym]


@pytest.mark.parametrize("sym", ["AAPL", "NVDA"])
def test_ttm_steps_on_tradingviews_quarter_ends(sym):
    f = _fields(sym)
    for fid in ("TOTAL_REVENUE", "EARNINGS_PER_SHARE_DILUTED", "FREE_CASH_FLOW"):
        q = {d for d, _v in TV[sym][f"{fid} FQ"]}
        days = [p["knownFrom"] for p in f[f"{fid}:TTM"]["points"] if p["v"] is not None and p["knownFrom"] >= min(q)]
        assert days and all(d in q for d in days), (sym, fid, [d for d in days if d not in q][:4])


@pytest.mark.parametrize("sym", ["AAPL", "NVDA"])
def test_values_on_those_dates_within_half_a_percent_but_the_named_exceptions(sym):
    f = _fields(sym)
    for fid, per in PAIRS:
        tv = dict((d, v) for d, v in TV[sym][f"{fid} {per}"])
        ours = _steps(f[f"{fid}:{per}"]["points"], min(tv))
        rel = [abs(ours[d] - tv[d]) / max(abs(tv[d]), 1e-12) for d in sorted(set(ours) & set(tv))]
        n_ok, n, worst = VALUE_EXCEPTIONS.get((sym, fid, per), (len(rel), len(rel), 0.005))
        assert (sum(r <= 0.005 for r in rel), len(rel)) == (n_ok, n), (sym, fid, per)
        assert max(rel) <= worst, (sym, fid, per, max(rel))


def test_the_placement_rule_on_its_measured_cases():
    # AAPL: a Saturday year end in the month (2024-09-28 -> Monday 09-30; 2023-09-30 -> Friday 09-29); NVDA: a Sunday
    # year end in late January (2025-01-26 -> Friday 01-31); a period ending in a month's first half -> the month before
    assert PF.placement_day("2024-09-28") == "2024-09-30" and PF.placement_day("2023-09-30") == "2023-09-29"
    assert PF.placement_day("2025-01-26") == "2025-01-31" and PF.placement_day("2021-01-02") == "2020-12-31"
    assert PF.PINE_PLACEMENT == "fiscal_period_end"


def test_the_point_in_time_store_is_untouched():
    for sym in ("AAPL", "NVDA"):
        before = copy.deepcopy(OURS[sym])
        f = _fields(sym)
        assert OURS[sym] == before, "the published series are read, never changed"
        for b in f.values():
            for p in b["points"]:
                assert p["publishedFrom"] == PF.known_from(p["publicAt"]), "every point still carries its filing's session"
    assert VP.methodology_drift() == {}


def test_the_member_is_told_where_a_value_is_placed():
    said = PF._disclosure()
    assert PF.placement() == ("placed at the fiscal period end, as TradingView does; the figure was published weeks later, "
                              "so historical bars show values before they were public")
    assert PF.placement() in said
