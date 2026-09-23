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


# ── v4: UNAPPLIED_SPLIT — a ledger split the provider's adjusted series never applied ──
def _cal_files(tmp_path, adj, raw):
    for d in CAL:
        (tmp_path / ("%s_1.json" % d)).write_text(json.dumps(adj[d]))
        (tmp_path / ("%s_0.json" % d)).write_text(json.dumps(raw[d]))
    return str(tmp_path)


def test_hei_a_shape_unapplied_split_is_withheld(tmp_path):
    # ledger 'HEIA' 5:4 on 03-04; the dotted price key HEI.A drops 20 % on BOTH series; HEI (spelled
    # right in the ledger) is adjusted: its f steps, so it is a REAL_ACTION, not withheld
    heia = {"2026-03-02": 43.6, "2026-03-03": 43.55, "2026-03-04": 35.05, "2026-03-05": 35.2, "2026-03-06": 35.1}
    hei_raw = {"2026-03-02": 59.0, "2026-03-03": 59.08, "2026-03-04": 47.43, "2026-03-05": 47.5, "2026-03-06": 47.6}
    hei_adj = {d: (v if d < "2026-03-04" else v * 1.25) / 1.25 for d, v in hei_raw.items()}
    adj = {d: {"HEI.A": heia[d], "HEI": hei_adj[d]} for d in CAL}
    raw = {d: {"HEI.A": heia[d], "HEI": hei_raw[d]} for d in CAL}
    splits = [{"ticker": "HEIA", "execution_date": "2026-03-04", "split_from": 4, "split_to": 5},
              {"ticker": "HEI", "execution_date": "2026-03-04", "split_from": 4, "split_to": 5}]
    t = bag.build_events(_cal_files(tmp_path, adj, raw), {}, splits, CAL)
    cls = {(e["t"], e["class"]) for e in t["events"]}
    assert ("HEI.A", "UNAPPLIED_SPLIT") in cls and ("HEI", "REAL_ACTION") in cls
    assert t["withhold_boundaries"] == {"HEI.A": ["2026-03-04"]}


def test_a_split_the_price_never_shows_is_not_unapplied(tmp_path):
    # ledger says 2:1 but the raw price did not halve — not an unapplied split (nothing to withhold here)
    px = {d: {"XYZ": 20.0} for d in CAL}
    t = bag.build_events(_cal_files(tmp_path, px, px), {}, [{"ticker": "XYZ", "execution_date": "2026-03-04",
                                                           "split_from": 1, "split_to": 2}], CAL)
    assert t["events"] == [] and t["withhold_boundaries"] == {}


def test_a_small_stock_dividend_is_below_the_detection_floor(tmp_path):
    # LENB 51:50 (2 %) cannot be told from an ordinary day's move — out of the detector by construction
    raw = {"2026-03-02": 51.0, "2026-03-03": 51.0, "2026-03-04": 50.0, "2026-03-05": 50.0, "2026-03-06": 50.0}
    px = {d: {"LEN.B": v} for d, v in raw.items()}
    t = bag.build_events(_cal_files(tmp_path, px, px), {}, [{"ticker": "LENB", "execution_date": "2026-03-04",
                                                           "split_from": 50, "split_to": 51}], CAL)
    assert t["events"] == []
