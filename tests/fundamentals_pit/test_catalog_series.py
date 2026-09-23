"""Catalogue truthfulness + series emission semantics."""
from datetime import timedelta
from api.services.fundamentals_pit import catalog as C, knowledge as K, metrics as M
from api.services.fundamentals_pit.series import build_series

from ._build import fact, filing


def test_catalogue_is_truthful():
    C.assert_catalogue_truthful()


def test_every_catalogue_series_exists():
    for m in C.V1:
        if m.compose:
            assert all(i in M.METRICS for i in m.inputs), m.id
        elif m.source == "sec_xbrl":
            assert m.series in M.METRICS, m.id
        else:
            assert m.series == "beta_1y_spy"


def test_beta_identity_is_explicit_and_label_is_plain():
    b = C.by_id()["beta_1y_spy"]
    assert b.name == "Beta" and b.subtitle == "1Y daily · Benchmark: SPY"


def test_payload_serves_only_ready_metrics_and_search_aliases():
    p = C.payload()
    ids = {m["id"] for m in p["metrics"]}
    assert "forward_pe" not in ids and "eps_ttm" in ids
    eps = next(m for m in p["metrics"] if m["id"] == "eps_ttm")
    assert "earnings per share" in eps["aliases"]


def test_snapshot_only_metrics_cannot_masquerade_as_historical():
    for snap in ("forward_pe", "peg", "eps_next_5y", "analyst_targets"):
        assert snap in C.DEFERRED and snap not in {m.id for m in C.V1}
    fake = C.MetricDef("forward_pe", "Forward P/E", "Valuation", "fmp_snapshot", "ratio", "x2", "line",
                       "daily", "", None, series="pe_fwd")
    try:
        C.V1, saved = C.V1 + (fake,), C.V1
        raised = False
        try:
            C.assert_catalogue_truthful()
        except AssertionError:
            raised = True
        assert raised
    finally:
        C.V1 = saved


def test_series_emits_only_on_change_and_names_its_filings():
    fl = [filing("K1", "2021-02-10T21:00:00", form="10-K"), filing("Q1", "2021-05-01T20:00:00"),
          filing("K2", "2022-02-10T21:00:00", form="10-K")]
    facts = [fact("Revenues", "2020-01-01", "2020-12-31", 400, "K1"),
             fact("Revenues", "2021-01-01", "2021-03-31", 120, "Q1"),
             fact("Revenues", "2020-01-01", "2020-03-31", 100, "Q1"),
             fact("Revenues", "2021-01-01", "2021-12-31", 480, "K2")]
    kb = K.build(facts, {f.accn: f for f in fl})
    pts = build_series(kb, ["revenue_ttm"])["revenue_ttm"]
    assert [(p.v, p.period_end.isoformat(), p.method) for p in pts] == [
        (400, "2020-12-31", "fiscal_year"), (420, "2021-03-31", "ytd_roll"), (480, "2021-12-31", "fiscal_year")]
    assert {s[3] for s in pts[1].sources} == {"K1", "Q1"}
    assert pts[1].t_eff == fl[1].public_at


def test_no_point_exists_before_the_first_filing():
    fl = [filing("K1", "2021-02-10T21:00:00", form="10-K")]
    kb = K.build([fact("Revenues", "2020-01-01", "2020-12-31", 400, "K1")], {f.accn: f for f in fl})
    pts = build_series(kb, ["revenue_ttm"])["revenue_ttm"]
    assert pts[0].t_eff == fl[0].public_at and len(pts) == 1


def test_series_never_steps_back_to_an_older_period(monkeypatch):
    """MEASURED on TSLA 2025-04-23: the newest TTM stopped being computable,
    `latest` fell back to 2024-09-30, and the chart showed a six-month-old
    period as current. Older periods are refused; a same-period restatement is
    still a new point."""
    from datetime import date
    from api.services.fundamentals_pit import series as SER
    from api.services.fundamentals_pit.metrics import Value
    fl = [filing("K1", "2021-02-10T21:00:00", form="10-K"), filing("Q1", "2021-05-01T20:00:00"),
          filing("Q2", "2021-08-01T20:00:00"), filing("K2", "2022-02-10T21:00:00", form="10-K")]
    facts = [fact("Revenues", "2020-01-01", "2020-12-31", 400, a.accn) for a in fl]
    kb = K.build(facts, {f.accn: f for f in fl})
    script = iter([Value(400, date(2020, 12, 31), (), "fiscal_year"),
                   Value(390, date(2020, 9, 30), (), "sum_of_4"),       # regression: refused
                   Value(410, date(2020, 12, 31), (), "fiscal_year"),   # same-period restatement: kept
                   Value(480, date(2021, 12, 31), (), "fiscal_year")])
    monkeypatch.setattr(SER, "latest", lambda book, m: next(script))
    pts = SER.build_series(kb, ["revenue_ttm"])["revenue_ttm"]
    assert [(p.v, p.period_end.isoformat()) for p in pts] == [
        (400, "2020-12-31"), (410, "2020-12-31"), (480, "2021-12-31")]


def test_every_filing_sourced_metric_discloses_the_filing_lag():
    served = {m["id"]: m for m in C.payload()["metrics"]}
    for m in C.V1:
        if m.status != "READY":
            continue
        has = C.FILING_LAG_NOTE in served[m.id]["limitations"]
        assert has == ("sec_xbrl" in m.source.split("+")), m.id
    assert C.FILING_LAG_NOTE not in served["beta_1y_spy"]["limitations"]


def test_an_underivable_newest_period_is_a_gap_not_a_carried_value():
    """OWNER RULING: a quarter that cannot be trusted is a GAP. MEASURED on TSLA
    2025: the Q1-25 10-Q made 2025-03-31 known while its TTM was underivable, and
    v2 kept showing the FY2024 TTM as if it were current. Here the Q1-21 10-Q has
    no prior-year comparative, so its TTM cannot be derived: the FY2020 value must
    STOP at that filing, and nothing may appear until FY2021 is public."""
    from api.services.fundamentals_pit.series import GAP, value_at
    fl = [filing("K1", "2021-02-10T21:00:00", form="10-K"), filing("Q1", "2021-05-01T20:00:00"),
          filing("K2", "2022-02-10T21:00:00", form="10-K")]
    facts = [fact("Revenues", "2020-01-01", "2020-12-31", 400, "K1"),
             fact("Revenues", "2021-01-01", "2021-03-31", 120, "Q1"),     # no 2020-Q1 comparative
             fact("Revenues", "2021-01-01", "2021-12-31", 480, "K2")]
    kb = K.build(facts, {f.accn: f for f in fl})
    pts = build_series(kb, ["revenue_ttm"])["revenue_ttm"]
    assert [(p.method, p.period_end.isoformat()) for p in pts] == [
        ("fiscal_year", "2020-12-31"), (GAP, "2021-03-31"), ("fiscal_year", "2021-12-31")]
    assert pts[1].t_eff == fl[1].public_at
    # As-of: before Q1 the FY value; between Q1 and K2 the GAP -- never 400.
    between = fl[1].public_at + (fl[2].public_at - fl[1].public_at) / 2
    assert value_at(pts, between).method == GAP
    assert value_at(pts, fl[1].public_at - timedelta(seconds=1)).v == 400


def test_a_gap_survives_the_store_as_null(tmp_path):
    from api.services.fundamentals_pit import store as S
    from api.services.fundamentals_pit.series import GAP, Point
    from datetime import date, datetime, timezone
    c = S.connect(str(tmp_path / "g.db"))
    t0, t1 = datetime(2021, 2, 10, tzinfo=timezone.utc), datetime(2021, 5, 1, tzinfo=timezone.utc)
    S.replace_series(c, 1, 9, {"revenue_ttm": [Point(t0, 400.0, date(2020, 12, 31), (), "fiscal_year"),
                                               Point(t1, float("nan"), date(2021, 3, 31), (), GAP)]}, "h", {})
    got = S.read_series(c, 1, 9)["revenue_ttm"]
    assert got[0][1] == 400.0 and got[1][1] is None and got[1][3] == GAP
