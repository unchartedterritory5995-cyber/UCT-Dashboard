import json

import pytest

from api.services.econ import derive as dv
from api.services.econ import store as st

T0 = 1_780_000_000
DAY = 86_400


@pytest.fixture
def s(tmp_path):
    db = st.connect(str(tmp_path / "econ.db"))
    yield db
    db.close()


def months(y0, m0, n):
    out, y, m = [], y0, m0
    for _ in range(n):
        import calendar
        out.append((f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def put(s, sid, key, rows, pit="V"):
    """rows = [(ps, pe, value, available_at)]"""
    r = s.upsert_release(key, None, "live", None, None)
    return s.write_observations(sid, r, [(ps, pe, v, "", t, "scheduled", pit, None, None) for ps, pe, v, t in rows])


YOY = {"symbol": "USCPIYOY", "frequency": "M",
       "derivation": {"op": "yoy_pct", "inputs": ["USCPINSA"], "params": {}, "version": 1}}


def seed_cpi(s, pit="V"):
    ms = months(2025, 1, 14)                      # 2025-01 .. 2026-02
    for i, (ps, pe) in enumerate(ms):
        put(s, "USCPINSA", f"cpi-{ps}", [(ps, pe, 100.0 + i, T0 + i * 30 * DAY)], pit=pit)
    return ms


def test_derive_latest_pure():
    vals = {ps: 100.0 + i for i, (ps, _) in enumerate(months(2025, 1, 14))}
    out = dv.derive_latest(vals, op="yoy_pct", frequency="M")
    assert list(out) == ["2026-01-01", "2026-02-01"]
    assert out["2026-01-01"] == pytest.approx((112 / 100 - 1) * 100)
    mom = dv.derive_latest(vals, op="mom_pct")
    assert mom["2025-02-01"] == pytest.approx(1.0)
    assert dv.derive_latest(vals, op="diff")["2025-03-01"] == 1.0
    assert dv.derive_latest(vals, op="pct_change", params={"n": 2})["2025-03-01"] == pytest.approx(2.0)
    sma = dv.derive_latest(vals, op="sma", params={"n": 3})
    assert sma["2025-03-01"] == pytest.approx(101.0) and "2025-02-01" not in sma
    assert dv.derive_latest(vals, op="sum", params={"n": 2})["2025-02-01"] == 201.0


def test_missing_month_is_never_bridged():
    vals = {ps: 100.0 + i for i, (ps, _) in enumerate(months(2025, 1, 14)) if ps != "2025-10-01"}
    mom = dv.derive_latest(vals, op="mom_pct")
    assert "2025-10-01" not in mom and "2025-11-01" not in mom   # no Oct -> no Nov MoM
    assert "2025-12-01" in mom


def test_spread_and_ratio_pure():
    a = {"2026-01-01": 4.0, "2026-01-02": 4.1}
    b = {"2026-01-01": 3.5, "2026-01-02": 3.4, "2026-01-05": 3.3}
    out = dv.derive_latest({"A": a, "B": b}, op="spread", inputs=["A", "B"], frequency="D")
    assert out == {"2026-01-01": pytest.approx(0.5), "2026-01-02": pytest.approx(0.7)}
    r = dv.derive_latest({"A": {"2026-01-01": 1.0}, "B": {"2026-01-01": 4.0}}, op="ratio_pct",
                         inputs=["A", "B"], frequency="M")
    assert r == {"2026-01-01": 25.0}
    assert dv.derive_latest({"A": {"2026-01-01": 1.0}, "B": {"2026-01-01": 0.0}}, op="ratio_pct",
                            inputs=["A", "B"]) == {"2026-01-01": None}


def test_eop_q_ratio_pure():
    # daily debt within Q1 2026; the last visible day of the quarter is sampled
    debt = {"2026-03-30": 38.0e12, "2026-03-31": 38.5e12, "2026-04-01": 99e12, "2026-01-02": 36e12}
    gdp = {"2026-01-01": 31.0e12}
    out = dv.derive_latest({"USDEBT": debt, "USGDP": gdp}, op="ratio_pct", inputs=["USDEBT", "USGDP"],
                           frequency="Q", params={"transforms": {"USDEBT": "eop_q"}})
    assert out == {"2026-01-01": pytest.approx(38.5 / 31.0 * 100)}


def test_bad_specs():
    for d in ({"op": "nope", "inputs": ["A"]}, {"op": "yoy_pct", "inputs": ["A", "B"]},
              {"op": "sma", "inputs": ["A"]}, {"op": "spread", "inputs": ["A"]},
              {"op": "ratio_pct", "inputs": ["A", "B"], "params": {"transform": "eop_q"}}):
        with pytest.raises(dv.DerivationError):
            dv.plan_for({"symbol": "X", "frequency": "M", "derivation": d})
    with pytest.raises(dv.DerivationError):
        dv.plan_for({"symbol": "X", "frequency": "D", "derivation": {"op": "yoy_pct", "inputs": ["A"]}})


# ── store-backed PIT behaviour ─────────────────────────────────────────────

def test_yoy_vintages_and_idempotence(s):
    ms = seed_cpi(s)
    rows = dv.compute_derived(s, YOY)
    assert [r.period_start for r in rows] == ["2026-01-01", "2026-02-01"]
    jan = rows[0]
    assert jan.available_at == T0 + 12 * 30 * DAY          # = the Jan-2026 CPI release, not earlier
    assert jan.available_method == "derived:yoy_pct@1"
    assert jan.pit_class == "V"
    cells = json.loads(jan.inputs)
    assert sorted(c[1] for c in cells) == ["2025-01-01", "2026-01-01"] and all(c[0] == "USCPINSA" for c in cells)
    assert dv.write_derived(s, rows) == 2
    # (5) idempotent: a second run computes and writes nothing
    assert dv.compute_derived(s, YOY) == []
    assert dv.derive_and_write(s, YOY) == 0
    assert dv.audit_derived(s, "USCPIYOY") == []


def test_parent_revision_makes_new_derived_vintage_and_keeps_prior(s):
    seed_cpi(s)
    dv.derive_and_write(s, YOY)
    t_rev = T0 + 500 * DAY
    put(s, "USCPINSA", "cpi-rev", [("2025-01-01", "2025-01-31", 99.0, t_rev)])   # base month revised
    rows = dv.compute_derived(s, YOY)
    assert [(r.period_start, r.available_at) for r in rows] == [("2026-01-01", t_rev)]
    assert rows[0].value == pytest.approx((112 / 99 - 1) * 100)
    dv.write_derived(s, rows)
    vs = s.versions("USCPIYOY", "2026-01-01")
    assert [round(v.value, 6) for v in vs] == [12.0, round((112 / 99 - 1) * 100, 6)]
    # as-of before the revision still sees the original derived value
    assert s.latest_rows("USCPIYOY", asof=t_rev - 1)[0].value == pytest.approx(12.0)
    L = s.latest_rows("USCPIYOY")[0]
    assert L.first_available_at == T0 + 12 * 30 * DAY and L.available_at == t_rev
    assert dv.compute_derived(s, YOY) == []
    assert dv.audit_derived(s, "USCPIYOY") == []


def test_derived_never_available_before_latest_input(s):
    # (7) the base period arrives LATER than the current period (late backfill of history)
    put(s, "USCPINSA", "cur", [("2026-01-01", "2026-01-31", 110.0, T0)])
    assert dv.compute_derived(s, YOY) == []                  # nothing without the base
    put(s, "USCPINSA", "late", [("2025-01-01", "2025-01-31", 100.0, T0 + 90 * DAY)])
    rows = dv.compute_derived(s, YOY)
    assert len(rows) == 1 and rows[0].available_at == T0 + 90 * DAY


def test_negative_control_leak_guard(s, monkeypatch):
    # Break the combiner (min instead of max): the guard MUST refuse to emit.
    put(s, "USCPINSA", "cur", [("2026-01-01", "2026-01-31", 110.0, T0)])
    put(s, "USCPINSA", "late", [("2025-01-01", "2025-01-31", 100.0, T0 + 90 * DAY)])
    monkeypatch.setattr(dv, "_combine_available", min)
    with pytest.raises(dv.DerivationLeak):
        dv.compute_derived(s, YOY)


def test_negative_control_audit_catches_stored_leak(s):
    put(s, "USCPINSA", "cur", [("2026-01-01", "2026-01-31", 110.0, T0)])
    put(s, "USCPINSA", "late", [("2025-01-01", "2025-01-31", 100.0, T0 + 90 * DAY)])
    rows = dv.compute_derived(s, YOY)
    leaked = [dv.DerivedRow(**{**r.__dict__, "available_at": T0, "release_key": "forged"}) for r in rows]
    dv.write_derived(s, leaked)                              # forge a row stamped before its input
    reasons = dv.audit_derived(s, "USCPIYOY")
    assert reasons and "LEAK" in reasons[0]


def test_pit_weakest_link(s):
    # (8) spread of a V input and an L input is L; U+V is U
    put(s, "A", "a", [("2026-01-02", "2026-01-02", 4.0, T0)], pit="V")
    put(s, "B", "b", [("2026-01-02", "2026-01-02", 3.0, T0)], pit="L")
    put(s, "C", "c", [("2026-01-02", "2026-01-02", 1.0, T0)], pit="U")
    sp = lambda a, b: {"symbol": f"S{a}{b}", "frequency": "D",
                       "derivation": {"op": "spread", "inputs": [a, b], "params": {}, "version": 1}}
    assert dv.compute_derived(s, sp("A", "B"))[0].pit_class == "L"
    assert dv.compute_derived(s, sp("A", "C"))[0].pit_class == "U"
    assert dv.compute_derived(s, sp("C", "C"))[0].pit_class == "U"


def test_spread_change_points_are_union_of_inputs(s):
    put(s, "A", "a1", [("2026-01-02", "2026-01-02", 4.0, T0)])
    put(s, "B", "b1", [("2026-01-02", "2026-01-02", 3.0, T0 + 100)])
    put(s, "A", "a2", [("2026-01-02", "2026-01-02", 4.2, T0 + 200)])
    put(s, "B", "b2", [("2026-01-02", "2026-01-02", 3.2, T0 + 300)])   # spread back to 1.0
    spec = {"symbol": "SP", "frequency": "D", "derivation": {"op": "spread", "inputs": ["A", "B"], "version": 1}}
    rows = dv.compute_derived(s, spec)
    assert [(r.available_at, round(r.value, 9)) for r in rows] == [(T0 + 100, 1.0), (T0 + 200, 1.2),
                                                                  (T0 + 300, 1.0)]


def test_eop_q_pit(s):
    # USDEBT daily; the Q1 value that GDP is divided by is the last day VISIBLE at T
    put(s, "USDEBT", "d1", [("2026-03-30", "2026-03-30", 38.0, T0)])
    put(s, "USGDP", "g1", [("2026-01-01", "2026-03-31", 31.0, T0 + 10 * DAY)])
    put(s, "USDEBT", "d2", [("2026-03-31", "2026-03-31", 38.5, T0 + 20 * DAY)])   # late print
    spec = {"symbol": "USDEBTGDP", "frequency": "Q",
            "derivation": {"op": "ratio_pct", "inputs": ["USDEBT", "USGDP"],
                           "params": {"transforms": {"USDEBT": "eop_q"}}, "version": 1}}
    rows = dv.compute_derived(s, spec)
    assert [(r.available_at, round(r.value, 9)) for r in rows] == [
        (T0 + 10 * DAY, round(38 / 31 * 100, 9)), (T0 + 20 * DAY, round(38.5 / 31 * 100, 9))]
    assert all(r.period_end == "2026-03-31" for r in rows)
    dv.write_derived(s, rows)
    assert dv.compute_derived(s, spec) == [] and dv.audit_derived(s, "USDEBTGDP") == []


def test_version_bump_writes_only_disagreements(s):
    seed_cpi(s)
    dv.derive_and_write(s, YOY)
    v2 = {**YOY, "derivation": {**YOY["derivation"], "version": 2}}
    assert dv.compute_derived(s, v2) == []                    # same math -> nothing to correct
    v2b = {**YOY, "derivation": {"op": "pct_change", "inputs": ["USCPINSA"], "params": {"n": 1}, "version": 2}}
    rows = dv.compute_derived(s, v2b)
    assert rows and all(r.available_method == "derived:pct_change@2" for r in rows)
    dv.write_derived(s, rows)
    assert dv.compute_derived(s, v2b) == []
    # old-version rows untouched
    assert any(v.available_method == "derived:yoy_pct@1" for v in s.versions("USCPIYOY", "2026-01-01"))


def test_na_input_gives_na_derived(s):
    put(s, "USCPINSA", "a", [("2025-01-01", "2025-01-31", 100.0, T0)])
    put(s, "USCPINSA", "b", [("2026-01-01", "2026-01-31", None, T0 + DAY)])
    rows = dv.compute_derived(s, YOY)
    assert len(rows) == 1 and rows[0].value is None
