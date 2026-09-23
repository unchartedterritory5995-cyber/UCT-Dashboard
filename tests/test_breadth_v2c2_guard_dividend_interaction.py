"""PHASE 6 — the adjusted-series guard and the dividend basis never trade off:
a legitimate ex-dividend is never flagged, and a defect is never excused by a nearby dividend."""
import json

from api.services import breadth_adjusted_guard as bag
from api.services import breadth_dividend_basis as bdb

CAL = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]


def _grouped(tmp_path, adj_by_day, raw_by_day):
    for d in CAL:
        (tmp_path / ("%s_1.json" % d)).write_text(json.dumps(adj_by_day[d]))
        (tmp_path / ("%s_0.json" % d)).write_text(json.dumps(raw_by_day[d]))
    return str(tmp_path)


def test_a_large_special_dividend_is_not_a_guard_event(tmp_path):
    # 30 % special on 03-04: the traded price drops, the split-only adjusted series drops the
    # same — f = adj/raw is unchanged, so the guard sees nothing
    raw = {"2026-03-02": 100.0, "2026-03-03": 100.0, "2026-03-04": 70.0, "2026-03-05": 71.0, "2026-03-06": 70.5}
    g = _grouped(tmp_path, {d: {"SPCL": v} for d, v in raw.items()}, {d: {"SPCL": v} for d, v in raw.items()})
    t = bag.build_events(g, {}, [], CAL)
    assert t["events"] == [] and t["withhold_boundaries"] == {}
    divs = [{"ticker": "SPCL", "ex_dividend_date": "2026-03-04", "cash_amount": 30.0, "currency": "USD", "dividend_type": "SC"}]
    raw_close = lambda iso, tk: raw.get(iso) if tk == "SPCL" else None
    d = bdb.build_events(divs, CAL, raw_close)
    assert d["applied"]["SPCL"] == [("2026-03-04", 0.7)]
    assert "SPCL" not in d["withheld_boundaries"]


def test_a_defect_on_an_ex_date_is_still_withheld(tmp_path):
    # adjusted doubles with a flat raw on the ex-date of an ordinary dividend: a provider defect
    raw = {d: 50.0 for d in CAL}
    adj = dict(raw); adj.update({"2026-03-05": 100.0, "2026-03-06": 100.0})
    g = _grouped(tmp_path, {d: {"DFCT": v} for d, v in adj.items()}, {d: {"DFCT": v} for d, v in raw.items()})
    t = bag.build_events(g, {}, [], CAL)
    assert [e["class"] for e in t["events"]] == ["PROVIDER_DEFECT"]
    guard = bag.Guard(t)
    divs = [{"ticker": "DFCT", "ex_dividend_date": "2026-03-05", "cash_amount": 0.25, "currency": "USD", "dividend_type": "CD"}]
    basis = bdb.DividendBasis(bdb.build_events(divs, CAL, lambda iso, tk: raw.get(iso) if tk == "DFCT" else None))
    # the dividend is applicable (not itself withheld) — yet the name stays withheld via the guard
    assert basis.applied["DFCT"] and not basis.withheld_in("DFCT", "2026-03-02", "2026-03-06")
    withhold = guard.withheld("DFCT", "2026-03-02", "2026-03-06") or basis.withheld_in("DFCT", "2026-03-02", "2026-03-06")
    assert withhold


def test_the_pass_withholds_the_union():
    # the pass combines the two with OR — neither source can clear the other's refusal
    import inspect
    from api.services import breadth_corrected_pass as cp
    src = inspect.getsource(cp.run)
    assert "inp.guard.withheld(t, frame[0], D) or inp.divbasis.withheld_in(t, frame[0], D)" in src


def test_the_guard_reads_no_dividend_input():
    import inspect
    src = inspect.getsource(bag.build_events) + inspect.getsource(bag.load_or_build)
    assert "divid" not in src.lower()
