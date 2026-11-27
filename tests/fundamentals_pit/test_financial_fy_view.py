"""e99 FY: the serving-side fiscal-year VIEW (Pine `request.financial(..., "FY")`, option B, coordinator ruling 2026-11-26).

The V5 methodology is frozen (v5_prod.METHODOLOGY_FILES), so no FY series is stored: `pine_financial.fy_view_rows` reads the
fiscal year out of series the store already publishes (the TTM's `fiscal_year` points, the balance sheet at a fiscal-year
end, the 10-K's cover-page share count). Two rails carry the ruling:
  * the view EQUALS option A's stored FY series (golden, fixtures/e99_fy_option_a_golden.json) on every value and date
    where no late restatement occurs: NVDA (52/53-week years, the 10:1 split), AAPL outside FY2009, a synthetic company
    with all five figures and a 10-K without EPS (a GAP);
  * ⛔ THE NAMED LIMITATION is pinned exactly: AAPL's FY2009 10-K/A landed after the Q1 FY10 10-Q, and the view keeps the
    pre-restatement 36,537M until the FY2010 10-K. If this rail goes red, the limitation changed: that is a methodology
    decision for the coordinator, never a silent "fix"."""
import json
from datetime import date, timedelta
from pathlib import Path

from api.services import pine_financial as PF
from api.services.fundamentals_pit import asof, facts as F, filings as FL, knowledge as K, splits as SP, v5_prod as VP
from api.services.fundamentals_pit.series import build_series

from ._build import fact, filing

FIX = Path(__file__).parent / "fixtures"
GOLD = json.loads((FIX / "e99_fy_option_a_golden.json").read_text())["series"]
VIEWS = {"revenue_fy": "revenue_ttm@fy", "eps_diluted_fy": "eps_diluted_ttm@fy", "fcf_fy": "fcf_ttm@fy",
         "equity_fy": "equity@fy", "shares_outstanding_fy": "shares_outstanding@fy"}
PUBLISHED = ["revenue_ttm", "eps_diluted_ttm", "fcf_ttm", "equity", "shares_outstanding"]


def _load(name):
    d = json.loads((FIX / name).read_text())
    return K.build(F.parse_companyfacts(d["companyfacts"]), FL.parse_submission_pages([d["submissions_page"]]))


def _year(concept, y, q, fy, pre, unit="USD"):
    s = f"{y}-01-01"
    return [fact(concept, s, f"{y}-03-31", q[0], f"{pre}1", unit=unit), fact(concept, s, f"{y}-06-30", q[1], f"{pre}2", unit=unit),
            fact(concept, s, f"{y}-09-30", q[2], f"{pre}3", unit=unit), fact(concept, s, f"{y}-12-31", fy, f"{pre}4", unit=unit, form="10-K")]


def _filings(y, pre):
    return [filing(f"{pre}1", f"{y}-05-01T20:00:00"), filing(f"{pre}2", f"{y}-08-01T20:00:00"),
            filing(f"{pre}3", f"{y}-11-01T20:00:00"), filing(f"{pre}4", f"{y + 1}-02-15T20:00:00", form="10-K")]


def synthetic_company():
    """Three fiscal years with every FY figure; FY2025's 10-K carries no EPS (a GAP); capex under its second tag.
    (Byte-identical to the company option A's golden was built from.)"""
    f, fl = [], []
    for y, pre, k in ((2023, "A", 1.0), (2024, "B", 1.2), (2025, "C", 1.5)):
        f += _year("Revenues", y, (100 * k, 210 * k, 330 * k), 460 * k, pre)
        f += _year("NetCashProvidedByUsedInOperatingActivities", y, (10 * k, 30 * k, 60 * k), 100 * k, pre)
        f += _year("PaymentsToAcquireProductiveAssets", y, (1 * k, 3 * k, 6 * k), 25 * k, pre)
        f += [fact("StockholdersEquity", None, f"{y}-09-30", 900 * k, f"{pre}3"),
              fact("StockholdersEquity", None, f"{y}-12-31", 1000 * k, f"{pre}4", form="10-K"),
              fact("EntityCommonStockSharesOutstanding", None, f"{y}-10-25", 49 + y - 2023, f"{pre}3", unit="shares", taxonomy="dei"),
              fact("EntityCommonStockSharesOutstanding", None, f"{y + 1}-02-10", 50 + y - 2023, f"{pre}4", unit="shares",
                   taxonomy="dei", form="10-K")]
        if y < 2025:
            f += _year("EarningsPerShareDiluted", y, (1 * k, 2.1 * k, 3.3 * k), 4.6 * k, pre, unit="USD/shares")
        fl += _filings(y, pre)
    return K.build(f, {x.accn: x for x in fl})


def _published(kb, ledger=None):
    """The artifact's `metrics` block as derive + publish write it (rows [t_eff, v, period_end, method]; a GAP is null)."""
    s = build_series(kb, PUBLISHED, ledger=ledger, warmup=timedelta(0))
    return {m: [[int(p.t_eff.timestamp()), None if p.method == "gap" else p.v, p.period_end.isoformat(), p.method] for p in pts]
            for m, pts in s.items()}


CASES = {"nvda": lambda: _published(_load("nvda_2024_split.json"), SP.Ledger([SP.Split(date(2024, 6, 10), 10.0)])),
         "aapl": lambda: _published(_load("aapl_fy2009_restatement.json")),
         "synthetic": lambda: _published(synthetic_company())}
LIMIT_T = 1264454758          # AAPL FY2009 10-K/A public instant (2010-01-25 16:25:58 ET), option A's restated point


def _norm(rows):
    return [[int(t), None if v is None else round(float(v), 9), pe, m] for t, v, pe, m in rows]


def test_the_view_is_option_a_on_every_value_and_date_but_the_named_limitation():
    for case, build in CASES.items():
        metrics = build()
        for fy, view in VIEWS.items():
            want = [r for r in GOLD[case][fy] if not (case == "aapl" and r[0] == LIMIT_T)]
            assert _norm(PF.fy_view_rows(metrics, view)) == want, (case, fy)
    # the equality is not vacuous: every view is non-empty somewhere, the GAP and the split both reached
    assert all(any(GOLD[c][fy] for c in GOLD) for fy in VIEWS)
    assert [r[3] for r in GOLD["synthetic"]["eps_diluted_fy"]][-1] == "gap"
    assert abs(GOLD["nvda"]["eps_diluted_fy"][1][1] - 1.193) < 1e-9


def test_the_named_limitation_aapl_fy2009_10ka_after_the_next_10q_keeps_the_first_reported_value():
    """⛔ PINNED ON PURPOSE. The 10-K/A restating FY2009 revenue (36,537M -> 42,905M) became public two minutes after the
    Q1 FY10 10-Q, when the TTM had moved on to Dec-2009; the view keeps 36,537M until the FY2010 10-K. Option A shows the
    restatement (its golden row at LIMIT_T). Red here = the limitation moved: a ruling, not a fix."""
    rows = PF.fy_view_rows(CASES["aapl"](), "revenue_ttm@fy")
    assert _norm(rows) == [[1256674709, 36537e6, "2009-09-26", "fiscal_year"], [1288211781, 65225e6, "2010-09-25", "fiscal_year"]]
    assert [1264454758, 42905e6, "2009-09-26", "fiscal_year"] in GOLD["aapl"]["revenue_fy"]
    # the route says so to the member, on every FY field and on no other
    assert "restatement of that year filed after the next quarterly report is not shown until the following 10-K" in PF.fy_limitation()


def test_a_fiscal_year_view_ages_by_its_own_cap_never_the_quarterly_one():
    assert asof.MAX_FY_PERIOD_AGE == timedelta(days=470)
    rows = PF.fy_view_rows(CASES["synthetic"](), "revenue_ttm@fy")
    # 2023-12-31 + 470 days + 1 = 2025-04-15; the quarterly cap would say 2024-07-19
    assert PF.points_of(rows, "revenue_ttm@fy")[0]["staleFrom"] == "2025-04-15"
    assert PF.points_of(rows, "revenue_ttm")[0]["staleFrom"] == "2024-07-19"


def test_the_route_serves_the_view_with_its_limitation_and_withholds_split_sensitive_views():
    metrics = CASES["synthetic"]()
    got = PF.build_fields({"company": {"withheldSplitSensitive": False}, "metrics": metrics})
    rev = got["TOTAL_REVENUE:FY"]
    assert rev["state"] == "ok" and [p["v"] for p in rev["points"]] == [460, 552, 690]
    assert rev["limitation"] == PF.fy_limitation() and "not shown until the following 10-K" in rev["limitation"]
    eps = got["EARNINGS_PER_SHARE_DILUTED:FY"]
    assert [p["v"] for p in eps["points"]] == [4.6, 5.52, None]          # the FY2025 10-K without EPS: a GAP
    # every FY field and no other carries the limitation
    assert {k for k, b in got.items() if "limitation" in b} == {k for k in got if k.endswith(":FY")} and len(got) == 12
    # a company whose split history is unverified: the per-share and share-count VIEWS are withheld like their sources
    w = PF.build_fields({"company": {"withheldSplitSensitive": True}, "metrics": metrics})
    assert w["EARNINGS_PER_SHARE_DILUTED:FY"]["state"] == "withheld" and w["TOTAL_SHARES_OUTSTANDING:FY"]["state"] == "withheld"
    assert w["TOTAL_REVENUE:FY"]["state"] == "ok" and w["TOTAL_EQUITY:FY"]["state"] == "ok"


def test_no_existing_field_moves_when_the_fy_views_are_served():
    """⛔ NO REGRESSION (condition 1): no artifact changes (nothing is republished), and the route's seven FQ / TTM fields
    are identical, value for value, with and without the FY entries in the catalog, on all three companies."""
    import copy
    from api.services import pine_data_catalog as cat
    full = copy.deepcopy(cat.load())
    bare = copy.deepcopy(full)
    for spec in cat.families(bare)["financial"]["fields"].values():
        if isinstance(spec, dict):
            (spec.get("periods") or {}).pop("FY", None)
    for case, build in CASES.items():
        store = {"company": {"withheldSplitSensitive": False}, "metrics": build()}
        before, after = PF.build_fields(store, bare), PF.build_fields(store, full)
        assert len(before) == 7 and set(before) < set(after)
        for k in before:
            assert json.dumps(after[k], sort_keys=True) == json.dumps(before[k], sort_keys=True), (case, k)


def test_the_frozen_methodology_is_untouched():
    """Option B touches no frozen file: the FY figures are read, never derived or stored."""
    assert VP.methodology_drift() == {}
