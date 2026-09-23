"""Catalogue truthfulness + series emission semantics."""
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
