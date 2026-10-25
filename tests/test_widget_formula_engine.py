"""Task 10.5 -- formulas and the wave 10 display options in the widget engine.

Seeded through `auth_db.init_db` on a temp sqlite file (the Task 8.5 fixtures in
`tests.test_widget_sources`); nothing here reaches `C:\\data`. Shapes the real catalog's
`view_allowed` cannot show yet (a split by a formula, a goal progress bar with no number target)
run against `LENIENT`, the real sources and measures with a view rule that refuses nothing.
"""
from __future__ import annotations

import json
import math
import random
from datetime import date, datetime, timedelta, timezone

import pytest

from api.services.journal_two import measures as M
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import widget_formula as wf
from api.services.journal_two.widget_engine import aggregate as A
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import payload as wpayload
from api.services.journal_two.widget_engine import plan as P
from api.services.journal_two.widget_engine import run
from api.services.journal_two.widget_engine import sources as S
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    TODAY, UID, add_account, add_trade, add_user, conn,
)

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)   # ET day = TODAY
CAT = S.CATALOG


class _Lenient:
    sources = CAT.sources
    measures = CAT.measures
    accents = CAT.accents

    def view_allowed(self, plan):
        return None


LENIENT = _Lenient()


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-wfe-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    yield
    run._reset_state()


def F(fid="f1", name="Edge", expr="[net] / [risk_dollars]", fmt="number"):
    return {"id": fid, "name": name, "expr": expr, "format": fmt}


def fp(*, measures, formulas=(), source="closed_trades", rng=None, **kw):
    raw = {"v": 1, "source": source, "measures": list(measures),
           "range": rng or {"token": "all"}}
    if formulas:
        raw["formulas"] = list(formulas)
    raw.update(kw)
    return raw


def vp(raw, cat=CAT):
    return P.validate_plan(raw, cat)


def evaluate(c, raw, *, cat=CAT, check=None, uid=UID):
    p = vp(raw, cat)
    rng = P.resolve_range(p["range"], TODAY)
    sc = S.scan(c, p, {}, rng, uid, today=TODAY)
    return p, sc, A.evaluate(sc.rows, p, cat, check=check)


def build(p, res, sc, **kw):
    rng = P.resolve_range(p["range"], TODAY)
    return wpayload.build_payload(result=res, plan=p, settings={}, def_id=None, def_rev=None,
                                  latest_rev=None, rng=rng, scan=sc, sample=False, now=NOW, **kw)


def days(n, start=date(2026, 3, 2)):
    """`n` distinct weekdays from `start`, oldest first."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


# -- row and aggregate formulas ----------------------------------------------------------------

def test_row_formula_avg_matches_hand_sum(conn):
    nets = [(120.0, 2.0), (-80.0, 1.0), (45.5, 0.5), (300.0, 0.0), (-10.0, 1.0)]
    for d, (pnl, fees) in zip(days(5), nets):
        add_trade(conn, UID, day=d, pnl=pnl, fees=fees)      # entry 100, stop 95, 10 shares: $50
    raw = fp(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"},
                                        {"formula": "f1", "agg": "sum"},
                                        {"formula": "f1", "agg": "min"}])
    p, sc, res = evaluate(conn, raw)
    per = [(pnl - fees) / 50.0 for pnl, fees in nets]
    vals = [c.value for c in res.total.cells]
    assert vals[0] == pytest.approx(sum(per) / len(per))
    assert vals[1] == pytest.approx(sum(per))
    assert vals[2] == pytest.approx(min(per))
    assert [c.have for c in res.total.cells] == [5, 5, 5]
    # the value is written onto every scanned row once, under the formula's own key
    assert sorted(r["formula:f1"] for r in sc.rows) == pytest.approx(sorted(per))


def test_aggregate_formula_per_group(conn):
    rows = [("Flag", 100.0), ("Flag", 50.0), ("Flag", -40.0), ("VCP", 30.0), ("VCP", -20.0),
            ("VCP", -10.0), ("VCP", 90.0)]
    for d, (setup, pnl) in zip(days(len(rows)), rows):
        add_trade(conn, UID, day=d, pnl=pnl, setup=setup)
    raw = fp(formulas=[F(name="Avg win", expr="SumIf([net], [net] > 0) / CountIf([net] > 0)")],
             measures=[{"formula": "f1"}], split={"by": "setup"})
    p, sc, res = evaluate(conn, raw)
    by = {g.label: g.values.cells[0].value for g in res.groups}
    assert by == {"Flag": pytest.approx(75.0), "VCP": pytest.approx(60.0)}
    assert res.total.cells[0].value == pytest.approx((100 + 50 + 30 + 90) / 4)
    m = A.measure_of(p, CAT, p["measures"][0], res.formulas)
    assert (m.key, m.label, m.kind, m.unit) == ("formula:f1", "Avg win", "average", "trades")


def test_bool_formula_share_and_count(conn):
    pnls = [100.0, -50.0, 20.0, -5.0, 60.0, 0.0]
    for d, pnl in zip(days(len(pnls)), pnls):
        add_trade(conn, UID, day=d, pnl=pnl)
    raw = fp(formulas=[F(name="Green", expr="[net] > 0")],
             measures=[{"formula": "f1", "agg": "share"}, {"formula": "f1", "agg": "count"}])
    p, sc, res = evaluate(conn, raw)
    share, count = (c.value for c in res.total.cells)
    assert share == pytest.approx(3 / 6) and count == 3.0
    kinds = [A.measure_of(p, CAT, m, res.formulas).kind for m in p["measures"]]
    assert kinds == [P.formula_measure_kind(res.formulas["f1"], "share"), "count"] == ["rate", "count"]
    fmts = [A.measure_of(p, CAT, m, res.formulas).fmt for m in p["measures"]]
    assert fmts == ["pct", "count"]


def test_measure_of_reuses_the_plan_kind_rule(conn):
    """One authority: `plan.formula_measure_kind` decides every formula measure's kind."""
    for expr, agg in (("CountIf([net] > 0)", None), ("SumIf([net])", None),
                      ("Share([net] > 0)", None), ("AvgIf([net])", None),
                      ("CountIf([net] > 0) / CountIf([net] < 0)", None), ("[net]", "max"),
                      ("[net]", "sum"), ("[net] > 0", "count")):
        m = {"formula": "f1"} if agg is None else {"formula": "f1", "agg": agg}
        p = vp(fp(formulas=[F(expr=expr)], measures=[m]))
        c = A.compile_formulas(p, CAT.sources["closed_trades"])["f1"]
        assert A.measure_of(p, CAT, p["measures"][0], {"f1": c}).kind == \
            P.formula_measure_kind(c, p["measures"][0].get("agg")), expr


# -- splits and filters ------------------------------------------------------------------------

def test_formula_split_by_bucket_in_edge_order(conn):
    # R values placed so the measure would sort the groups differently from the edges
    rs = [2.5, 2.2, 3.0, -0.5, 0.4, 0.6, 1.5, None]
    for d, r in zip(days(len(rs)), rs):
        add_trade(conn, UID, day=d, pnl=100.0 if (r or 0) > 0 else -100.0, r=r,
                  stop=100 if r is None else 95)
    raw = fp(formulas=[F(name="R band", expr="Bucket([r], 0, 1, 2)")],
             measures=[{"key": "trades"}], split={"by": "formula:f1"}, view={"type": "bar"})
    p, sc, res = evaluate(conn, raw, cat=LENIENT)
    assert [g.label for g in res.groups] == ["Under 0", "0 to 1", "1 to 2", "2 or more"]
    assert [g.values.n for g in res.groups] == [1, 2, 1, 3]
    no_r = [r for r in sc.rows if r["formula:f1"] is None]
    assert len(no_r) >= 1
    # the footnote names the formula (Task 10.13 fix round 1, I-1)
    assert any("no R band value" in n and "not in this split" in n for n in res.footnotes)


def test_bool_formula_split_reads_yes_and_no(conn):
    for d, pnl in zip(days(4), (10.0, -5.0, 20.0, 30.0)):
        add_trade(conn, UID, day=d, pnl=pnl)
    raw = fp(formulas=[F(name="Green", expr="[net] > 0")], measures=[{"key": "net_pnl"}],
             split={"by": "formula:f1"}, view={"type": "bar"})
    p, sc, res = evaluate(conn, raw, cat=LENIENT)
    assert {g.label: g.values.cells[0].value for g in res.groups} == {"Yes": 60.0, "No": -5.0}


def test_formula_filter_python_only_sql_unchanged(conn):
    base = vp(fp(formulas=[F(expr="[net] > 0")], measures=[{"key": "net_pnl"}]))
    with_f = vp(fp(formulas=[F(expr="[net] > 0")], measures=[{"key": "net_pnl"}],
                   filters=[{"field": "formula:f1", "op": "is", "values": [True]}]))
    rng = P.resolve_range(base["range"], TODAY)
    a = wcompile.compile_scan(S.CLOSED, base, {}, rng, UID)
    b = wcompile.compile_scan(S.CLOSED, with_f, {}, rng, UID)
    assert a == b


def test_formula_filter_applied_in_python(conn):
    for d, pnl in zip(days(5), (10.0, -5.0, 20.0, -30.0, 40.0)):
        add_trade(conn, UID, day=d, pnl=pnl)
    p = vp(fp(formulas=[F(name="Green", expr="[net] > 0")], measures=[{"key": "net_pnl"}],
              filters=[{"field": "formula:f1", "op": "is", "values": [True]}]))
    rng = P.resolve_range(p["range"], TODAY)
    unfiltered = dict(p, filters=[])
    sc = S.scan(conn, unfiltered, {}, rng, UID, today=TODAY)     # the rows the SQL would read
    res = A.evaluate(sc.rows, p, CAT)
    assert res.count == 3 and res.total.cells[0].value == 70.0
    kept = A.apply_filters(sc.rows, p, S.CLOSED)
    assert sorted(r["net"] for r in kept) == [10.0, 20.0, 40.0]
    # the formula text never reaches a SQL string
    assert "[net]" not in json.dumps(wcompile.compile_scan(S.CLOSED, unfiltered, {}, rng, UID))


# -- notices -----------------------------------------------------------------------------------

def test_skip_notice_names_the_empty_field(conn):
    for i, d in enumerate(days(10)):
        add_trade(conn, UID, day=d, pnl=50.0, stop=100 if i < 4 else 95)   # 4 have no stop
    p, sc, res = evaluate(conn, fp(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"}]))
    assert "[Risk $] is empty on 4 trades; those are skipped" in res.footnotes
    assert res.total.cells[0].have == 6
    # one trade: the singular
    conn.execute("DELETE FROM j2_trades")
    add_trade(conn, UID, day="2026-03-02", pnl=50.0, stop=100)
    add_trade(conn, UID, day="2026-03-03", pnl=50.0)
    p, sc, res = evaluate(conn, fp(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"}]))
    assert "[Risk $] is empty on 1 trade; those are skipped" in res.footnotes


def test_skip_notice_for_a_formula_with_no_value_and_no_empty_field(conn):
    for d in days(3):
        add_trade(conn, UID, day=d, pnl=50.0)
    p, sc, res = evaluate(conn, fp(formulas=[F(expr="[net] / ([shares] - [shares])")],
                                   measures=[{"formula": "f1", "agg": "avg"}]))
    assert res.total.cells[0].value is None
    assert "This formula has no value on 3 trades; those are skipped" in res.footnotes


def test_formula_reading_hold_minutes_carries_the_dates_only_sentence(conn):
    raw = fp(formulas=[F(name="Hours held", expr="[hold_minutes] / 60")],
             measures=[{"formula": "f1", "agg": "avg"}])
    for d in days(3):
        add_trade(conn, UID, day=d, pnl=10.0, entry_iso=d, exit_iso=d)        # dates only
    p, sc, res = evaluate(conn, raw)
    assert A.S_HOLD_MINUTES_NO_TIMES in res.footnotes
    assert not any("is empty on" in n for n in res.footnotes)
    assert res.total.cells[0].value is None
    add_trade(conn, UID, day="2026-04-01", pnl=10.0, entry_iso="2026-04-01T14:00:00Z",
              exit_iso="2026-04-01T16:00:00Z")
    p, sc, res = evaluate(conn, raw)
    assert ("3 trades have dates only and are not in the hold-time filter."
            in res.footnotes)
    assert res.total.cells[0].value == pytest.approx(2.0)


def test_an_hour_formula_names_the_day_field(conn):
    add_trade(conn, UID, day="2026-03-02", pnl=10.0, hour=10)
    add_trade(conn, UID, day="2026-03-03", pnl=10.0, hour=None)
    p, sc, res = evaluate(conn, fp(formulas=[F(name="Hour", expr="Hour([day])")],
                                   measures=[{"formula": "f1", "agg": "avg"}]))
    assert "[Day] is empty on 1 trade; those are skipped" in res.footnotes
    assert res.total.cells[0].value == 10.0


def test_divide_by_zero_renders_no_data_never_inf(conn):
    for d in days(6):
        add_trade(conn, UID, day=d, pnl=50.0)
    raw = fp(formulas=[F(expr="[net] / 0"), F("f2", "Big", "[net] / ([shares] - [shares])")],
             measures=[{"formula": "f1", "agg": "sum"}, {"formula": "f2", "agg": "max"}],
             split={"by": "setup"}, view={"type": "table"})
    p, sc, res = evaluate(conn, raw)
    out = build(p, res, sc)
    text = json.dumps(out, allow_nan=False)
    assert "Infinity" not in text and "NaN" not in text
    assert out["value"]["v1"] is None and out["value"]["v2"] is None
    assert all(r["v1"] is None for r in out["rows"])


def test_small_sample_rule_on_average_formula(conn):
    raw = fp(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"},
                                        {"formula": "f1", "agg": "sum"}])
    for d in days(4):
        add_trade(conn, UID, day=d, pnl=50.0)
    p, sc, res = evaluate(conn, raw)
    assert [c.sample for c in res.total.cells] == ["hide", ""]       # a sum is never hidden
    for d in days(15, start=date(2026, 5, 4)):
        add_trade(conn, UID, day=d, pnl=50.0)
    p, sc, res = evaluate(conn, raw)
    assert res.total.cells[0].have == 19 and res.total.cells[0].sample == "small"
    add_trade(conn, UID, day="2026-07-01", pnl=50.0)
    p, sc, res = evaluate(conn, raw)
    assert res.total.cells[0].sample == ""


# -- the run budget ----------------------------------------------------------------------------

def test_check_is_called_every_256_rows_across_groups(conn):
    for i, d in enumerate(days(600, start=date(2024, 1, 1))):
        add_trade(conn, UID, day=d, pnl=float(i % 7 - 3), setup=f"S{i % 300}", commit=False)
    conn.commit()
    calls = {"n": 0}

    def check():
        calls["n"] += 1

    # 300 groups of 2 rows: no group alone reaches 256, the run as a whole does
    evaluate(conn, fp(formulas=[F(expr="[net] * 2")], measures=[{"formula": "f1", "agg": "sum"}],
                      split={"by": "setup"}, view={"type": "bar"}), check=check)
    assert calls["n"] >= 600 // 256 * 2


def test_the_ticker_checks_every_check_every_rows_walked():
    calls = {"n": 0}

    def check():
        calls["n"] += 1

    t = A._Ticker(check)
    for _ in range(1000):
        t.tick()
    assert calls["n"] == 1000 // wf.CHECK_EVERY == 3
    calls["n"] = 0
    t = A._Ticker(check)
    t.tick(300)
    t.tick(300)                          # 600 walked in two groups: two checks, as one group
    assert calls["n"] == 600 // wf.CHECK_EVERY
    A._Ticker(None).tick(10_000)         # no budget: nothing to call


def test_budget_check_raises_too_long_inside_the_python_loop(conn, monkeypatch):
    for i, d in enumerate(days(600, start=date(2024, 1, 1))):
        add_trade(conn, UID, day=d, pnl=float(i % 5 - 2), commit=False)
    conn.commit()
    raw = fp(formulas=[F(expr="[net] * 2")], measures=[{"formula": "f1", "agg": "sum"}])
    scans = {"n": 0}
    real_scan = run.wsources.scan

    def counting(*a, **k):
        scans["n"] += 1
        return real_scan(*a, **k)

    monkeypatch.setattr(run.wsources, "scan", counting)

    class Trips(run.Budget):
        """A budget whose check trips once 300 rows have been walked (checks come every 256)."""
        def check(self):
            self.walked = getattr(self, "walked", 0) + wf.CHECK_EVERY
            if self.walked >= 300:
                raise run.EngineTooLong()

    real_budget = run.Budget
    monkeypatch.setattr(run, "Budget", Trips)
    with pytest.raises(run.EngineTooLong) as e:
        run.run_plan(UID, raw, {}, lane="run", now=NOW)
    assert e.value.sentence == run.TOO_LONG
    monkeypatch.setattr(run, "Budget", real_budget)
    before = scans["n"]
    out = run.run_plan(UID, raw, {}, lane="run", now=NOW)       # nothing was cached: it scans
    assert scans["n"] == before + 1 and out["count"] == 600


def test_the_budget_is_real_time(monkeypatch):
    t = {"now": 100.0}
    monkeypatch.setattr(run, "_budget_clock", lambda: t["now"])
    b = run.Budget(seconds=1.5)
    b.check()
    t["now"] = 101.4
    b.check()
    t["now"] = 101.6
    with pytest.raises(run.EngineTooLong):
        b.check()


# -- running totals ----------------------------------------------------------------------------

def test_cumulative_series_running_total_before_trim(conn):
    ds = days(420, start=date(2025, 1, 6))
    rnd = random.Random(7)
    for d in ds:
        add_trade(conn, UID, day=d, pnl=round(rnd.uniform(-300, 300), 2), commit=False)
    conn.commit()
    raw = fp(measures=[{"key": "net_pnl"}], split={"by": "day"}, view={"type": "line"},
             display={"cumulative": True})
    p, sc, res = evaluate(conn, raw)
    out = build(p, res, sc)
    total = res.total.cells[0].value
    assert out["truncated"] > 0                                 # the 16 KB cap trimmed the oldest
    last = out["series"][-1]
    assert last["v1"] == pytest.approx(total, abs=0.01)
    by_day = {g.key: g.values.cells[0].value for g in res.groups}
    first = out["series"][0]
    upto = sum(v for k, v in by_day.items() if k <= first["label"])
    assert first["v1"] == pytest.approx(upto, abs=0.01)         # true totals survive the trim
    assert first["d1"] == pytest.approx(by_day[first["label"]])
    peak, run_total = 0.0, 0.0
    for k in sorted(by_day):
        run_total += by_day[k]
        peak = max(peak, run_total)
    assert last["dd1"] == pytest.approx(run_total - peak, abs=0.01)
    assert all(r["dd1"] <= 1e-9 for r in out["series"])


def test_cumulative_keys_only_when_used(conn):
    for d in days(3):
        add_trade(conn, UID, day=d, pnl=10.0)
    raw = fp(measures=[{"key": "net_pnl"}], split={"by": "day"}, view={"type": "line"})
    p, sc, res = evaluate(conn, raw)
    out = build(p, res, sc)
    assert [r["v1"] for r in out["series"]] == [10.0, 10.0, 10.0]
    assert not {"d1", "dd1"} & set(out["series"][0])


# -- drawdown dates ----------------------------------------------------------------------------

def _book(pnls):
    return [{"day": d, "net": p, "result": "Win" if p > 0 else "Loss"}
            for d, p in zip(days(len(pnls)), pnls)]


def test_drawdown_span_recovered_open_none():
    rec = _book([100, 50, -80, -40, 30, 200, -10])
    ds = days(7)
    span = M.drawdown_span(rec)
    assert span == M.DrawdownSpan(ds[1], ds[3], ds[5])
    op = M.drawdown_span(_book([100, -30, -40, 10]))
    assert op == M.DrawdownSpan(days(4)[0], days(4)[2], None)
    assert M.drawdown_span(_book([10, 20, 30])) == M.DrawdownSpan(None, None, None)
    assert M.drawdown_span([]) == M.DrawdownSpan(None, None, None)
    # a fall from the start: the peak is the range's start, not a day
    start = M.drawdown_span(_book([-50, -20, 100]))
    assert start == M.DrawdownSpan(None, days(3)[1], days(3)[2])
    # a poisoned figure: no span, as max drawdown has no value
    assert M.drawdown_span([{"day": "2026-03-02", "net": float("nan")}]) == \
        M.DrawdownSpan(None, None, None)


def test_drawdown_span_depth_equals_max_drawdown():
    rnd = random.Random(1005)
    for _ in range(200):
        n = rnd.randint(1, 40)
        rows = []
        for _ in range(rnd.randint(1, 60)):
            d = days(n)[rnd.randrange(n)]
            rows.append({"day": d, "net": round(rnd.uniform(-500, 400), 2)})
        mdd = M.MEASURES["max_drawdown"].fn(rows).value
        span = M.drawdown_span(rows)
        curve, run_total = {}, 0.0
        for d, v in M._daily(rows):                 # the same curve, walked here by hand
            run_total += v
            curve[d] = run_total
        if mdd == 0:
            assert span == M.DrawdownSpan(None, None, None)
            continue
        top = curve[span.peak] if span.peak else 0.0
        assert round(curve[span.trough] - top, 2) == mdd
        if span.recovered:
            assert span.recovered > span.trough and curve[span.recovered] >= top - 1e-9
            assert all(curve[d] < top - 1e-9 for d in curve if span.trough < d < span.recovered)
        else:
            assert all(curve[d] < top - 1e-9 for d in curve if d > span.trough)


def test_drawdown_line_on_a_number_view_with_wave10_on(conn):
    for d, pnl in zip(days(7), (100, 50, -80, -40, 30, 200, -10)):
        add_trade(conn, UID, day=d, pnl=float(pnl))
    p, sc, res = evaluate(conn, fp(measures=[{"key": "max_drawdown"}]))
    ds = days(7)
    out = build(p, res, sc, w10=True)
    assert out["drawdown"] == {"peak": ds[1], "trough": ds[3], "recovered": ds[5],
                               "line": "From Mar 3 to Mar 5; recovered Mar 9."}
    assert "drawdown" not in build(p, res, sc)                 # wave 10 off: the wave 9 payload
    conn.execute("DELETE FROM j2_trades")
    for d, pnl in zip(days(3), (100, -30, -40)):
        add_trade(conn, UID, day=d, pnl=float(pnl))
    p, sc, res = evaluate(conn, fp(measures=[{"key": "max_drawdown"}]))
    assert build(p, res, sc, w10=True)["drawdown"]["line"] == \
        "From Mar 2 to Mar 4; not recovered yet."
    conn.execute("DELETE FROM j2_trades")
    for d in days(3):
        add_trade(conn, UID, day=d, pnl=10.0)
    p, sc, res = evaluate(conn, fp(measures=[{"key": "max_drawdown"}]))
    assert build(p, res, sc, w10=True)["drawdown"]["line"] == wpayload.S_DD_NONE
    p, sc, res = evaluate(conn, fp(measures=[{"key": "max_drawdown"}], split={"by": "setup"},
                                   view={"type": "table"}))
    assert "drawdown" not in build(p, res, sc, w10=True)       # number and compare only


# -- goal targets ------------------------------------------------------------------------------

_STAMP = iter(range(10_000))


def _goals(c, aid, goals):
    """As `accounts.update_goals` writes them: the goals and a new `updated_at`."""
    c.execute("UPDATE j2_accounts SET goals = ?, updated_at = ? WHERE id = ?",
              (json.dumps(goals), f"2026-10-24T12:{next(_STAMP):05d}", aid))
    c.commit()


def _goal_plan(token="this_week"):
    return fp(measures=[{"key": "net_pnl"}], view={"type": "progress"}, rng={"token": token},
              display={"targetGoal": True})


def test_goal_target_sum_and_missing_sentences(conn, monkeypatch):
    monkeypatch.setattr(S.CATALOG, "view_allowed", LENIENT.view_allowed)
    a = add_account(conn, UID, "Main")
    b = add_account(conn, UID, "Swing")
    c3 = add_account(conn, UID, "Third")
    add_trade(conn, UID, day="2026-10-20", pnl=300.0, account=a)
    _goals(conn, a, {"weekly": 1000, "daily": 200})
    _goals(conn, b, {"weekly": 500})
    assert run._goal_target(conn, UID, None, "weekly") == (1500.0, 1)
    assert run._goal_target(conn, UID, a, "weekly") == (1000.0, 0)
    assert run._goal_target(conn, UID, c3, "weekly") == (None, 1)
    out = run.run_plan(UID, _goal_plan(), {}, lane="run", now=NOW)
    assert (out["target"], out["targetLabel"]) == (1500.0, "Weekly goal")
    assert "1 account has no weekly goal and is not in the target." in out["footnotes"]
    out = run.run_plan(UID, _goal_plan("today"), {}, lane="run", now=NOW)
    assert (out["target"], out["targetLabel"]) == (200.0, "Daily goal")
    assert "2 accounts have no daily goal and are not in the target." in out["footnotes"]
    out = run.run_plan(UID, _goal_plan("ytd"), {}, lane="run", now=NOW)
    assert out["target"] is None and out["targetLabel"] == "Yearly goal"
    assert out["notice"] == "Set a yearly goal in your account settings to see progress."
    assert not any("goal" in f for f in out["footnotes"])
    out = run.run_plan(UID, _goal_plan("this_month"), {"accountId": c3}, lane="run", now=NOW)
    assert out["target"] is None and "Set a monthly goal" in out["notice"]
    # a goal change moves the cache (the accounts stamp)
    _goals(conn, c3, {"monthly": 50})
    out = run.run_plan(UID, _goal_plan("this_month"), {"accountId": c3}, lane="run", now=NOW)
    assert out["target"] == 50.0


def test_goal_target_foreign_account_reads_all(conn):
    other = "u-goal-other"
    add_user(conn, other)
    a = add_account(conn, UID, "Main")
    theirs = add_account(conn, other, "Theirs")
    _goals(conn, a, {"weekly": 400})
    _goals(conn, theirs, {"weekly": 9999})
    assert run._goal_target(conn, UID, theirs, "weekly") == (400.0, 0)
    assert run._goal_target(conn, UID, "no-such-account", "weekly") == (400.0, 0)
    assert run._goal_target(conn, other, None, "weekly") == (9999.0, 0)


def test_a_goal_of_zero_is_not_a_goal(conn):
    a = add_account(conn, UID, "Main")
    _goals(conn, a, {"weekly": 0})
    assert run._goal_target(conn, UID, None, "weekly") == (None, 1)


# -- stop after --------------------------------------------------------------------------------

def _stop_out(conn, results, n=3):
    conn.execute("DELETE FROM j2_trades")
    for d, res in zip(days(len(results)), results):
        add_trade(conn, UID, day=d, pnl={"W": 50.0, "L": -50.0, "B": 0.0}[res])
    p, sc, res = evaluate(conn, fp(measures=[{"key": "current_streak"}],
                                   display={"stopAfter": n}))
    return build(p, res, sc)["stop"]


def test_stop_after_lines_exact_never_zero(conn):
    assert _stop_out(conn, "WLL") == {"after": 3, "losses": 2,
                                      "line": "2 of your 3 losses in a row"}
    assert _stop_out(conn, "WLLL") == {"after": 3, "losses": 3,
                                       "line": "3 of your 3 losses in a row. Your rule says stop here."}
    assert _stop_out(conn, "LLLLL")["line"] == "5 of your 3 losses in a row. Your rule says stop here."
    assert _stop_out(conn, "LLW") == {"after": 3, "losses": None, "line": "No losses in a row."}
    assert _stop_out(conn, "LLB") == {"after": 3, "losses": None, "line": "No losses in a row."}
    for res in ("WLL", "W", "LB", "L"):
        line = _stop_out(conn, res)["line"]
        assert "0 of your" not in line and not line.startswith("0")
    conn.execute("DELETE FROM j2_trades")
    p, sc, res = evaluate(conn, fp(measures=[{"key": "current_streak"}], display={"stopAfter": 3}))
    out = build(p, res, sc)
    assert out["stop"] is None and out["empty"]                 # no trades: the empty sentence


# -- quadrants and probe -----------------------------------------------------------------------

def test_quadrants_are_echoed(conn):
    for d in days(3):
        add_trade(conn, UID, day=d, pnl=10.0, r=1.0)
    p, sc, res = evaluate(conn, fp(measures=[{"key": "total_r"}, {"key": "net_pnl"}],
                                   view={"type": "scatter"}, display={"quadrants": "excursion"}))
    assert build(p, res, sc)["quadrants"] == "excursion"


def test_probe_only_on_preview_lane(conn):
    add_trade(conn, UID, day="2026-10-19", pnl=50.0, stop=100)              # no stop: no risk
    add_trade(conn, UID, day="2026-10-20", pnl=100.0)                       # newest: 100/50 = 2
    raw = fp(rng={"token": "last_30d"},
             formulas=[F(), F("f2", "Wins", "CountIf([net] > 0)")],
             measures=[{"formula": "f1", "agg": "avg"}, {"formula": "f2"}])
    out = run.run_plan(UID, raw, {}, lane="run", now=NOW)
    assert "probe" not in out
    prev = run.run_plan(UID, raw, {}, lane="preview", now=NOW)
    assert prev["probe"] == [
        {"id": "f1", "first": 2.0, "skipped": 1,
         "notice": "[Risk $] is empty on 1 trade; those are skipped"},
        {"id": "f2", "first": 2.0, "skipped": 0, "notice": None},
    ]
    again = run.run_plan(UID, raw, {}, lane="run", now=NOW)                 # never the preview's
    assert "probe" not in again
    plain = run.run_plan(UID, fp(measures=[{"key": "net_pnl"}]), {}, lane="preview", now=NOW)
    assert "probe" not in plain                                  # no formula: no probe key


# -- fix round 1 ---------------------------------------------------------------------------------

def test_coverage_of_a_formula_measure_is_measure_of_s(conn):
    """I-1: the coverage loop reads the measure through `measure_of`, so a formula's coverage
    counts the rows where it has a value (its `needs` are its fields), as its cell does."""
    for i, d in enumerate(days(10)):
        add_trade(conn, UID, day=d, pnl=50.0, stop=100 if i < 4 else 95)
    p, sc, res = evaluate(conn, fp(formulas=[F()], measures=[{"formula": "f1", "agg": "avg"},
                                                              {"key": "net_pnl"}]))
    m = A.measure_of(p, CAT, p["measures"][0], res.formulas)
    assert m.needs == ("net", "risk_dollars")
    assert res.coverage[0] == A.Coverage(6, 10, None) and res.total.cells[0].have == 6
    assert res.coverage[1] == A.Coverage(10, 10, None)
    out = build(p, res, sc)
    assert out["coverage"][0] == {"have": 6, "total": 10, "hint": None}
    assert out["measures"][0]["fmt"] == m.fmt


def test_each_formula_is_compiled_once_per_evaluation(conn, monkeypatch):
    """I-2: one compile per formula per evaluation, however many groups and measures read it."""
    for i, d in enumerate(days(40)):
        add_trade(conn, UID, day=d, pnl=float(i % 5 - 2), setup=f"S{i % 20}")
    raw = fp(formulas=[F(), F("f2", "Wins", "CountIf([net] > 0)")],
             measures=[{"formula": "f1", "agg": "avg"}, {"formula": "f1", "agg": "sum"},
                       {"formula": "f2"}],
             split={"by": "setup"}, view={"type": "table"})
    p = vp(raw)
    rng = P.resolve_range(p["range"], TODAY)
    sc = S.scan(conn, p, {}, rng, UID, today=TODAY)
    calls = []
    real = wf.compile_formula

    def spy(expr, fields):
        calls.append(expr)
        return real(expr, fields)

    monkeypatch.setattr(wf, "compile_formula", spy)
    res = A.evaluate(sc.rows, p, CAT, probe=True)
    build(p, res, sc, probe=True)
    assert len(res.groups) == 20
    assert sorted(calls) == sorted(f["expr"] for f in p["formulas"])


@pytest.mark.parametrize("expr", ["CountIf([risk_dollars] > 0)", "SumIf([risk_dollars])",
                                  "Share([risk_dollars] > 10)"])
def test_an_adding_up_formula_over_rows_all_lacking_its_field_has_no_value(conn, expr):
    """I-3: no fabricated zero. Rows whose referenced field is empty are skipped, so over trades
    that all lack it the formula reads no value (with the skip sentence), never a 0."""
    for d in days(3):
        add_trade(conn, UID, day=d, pnl=50.0, stop=100)          # a placeholder stop: no risk
    p, sc, res = evaluate(conn, fp(formulas=[F(name="Risky", expr=expr)],
                                   measures=[{"formula": "f1"}]))
    cell = res.total.cells[0]
    assert cell.value is None and cell.have == 0 and cell.n == 3
    assert "[Risk $] is empty on 3 trades; those are skipped" in res.footnotes
    assert build(p, res, sc)["value"]["v1"] is None


def test_every_scanning_loop_ticks_its_own_rows(conn, monkeypatch):
    """m-1: each Python loop over the scanned rows counts its own rows toward the 256-row cadence
    (a loop that stopped ticking would hide behind the others in a global count)."""
    import sys
    for i, d in enumerate(days(30)):
        add_trade(conn, UID, day=d, pnl=float(i % 3 - 1), setup=("Flag", "VCP")[i % 2])
    ticks: dict[str, int] = {}
    real = A._Ticker.tick

    def tick(self, n=1):
        name = sys._getframe(1).f_code.co_name
        ticks[name] = ticks.get(name, 0) + n
        return real(self, n)

    monkeypatch.setattr(A._Ticker, "tick", tick)
    raw = fp(formulas=[F(expr="[net] * 2")], measures=[{"formula": "f1", "agg": "sum"}],
             split={"by": "setup"}, view={"type": "bar"})
    evaluate(conn, raw, check=lambda: None)
    assert ticks["_write_row_formulas"] == 30           # every scanned row, before filtering
    assert ticks["evaluate"] == 30                        # the grouping loop
    assert ticks["_formula_cell"] == 30 + 30              # the groups, then the total
    assert ticks["_skip_sentences"] == 30                 # the skip count of the measured formula
    ticks.clear()
    evaluate(conn, fp(formulas=[F(expr="[net] * 2")], measures=[{"formula": "f1", "agg": "sum"}],
                      view={"type": "list"}), check=lambda: None)
    assert ticks["evaluate"] == 30                        # the per-row list loop


def test_probe_work_runs_on_the_preview_lane_only(conn):
    """m-3: off the preview lane no probe is computed at all."""
    for d in days(3):
        add_trade(conn, UID, day=d, pnl=50.0)
    raw = fp(formulas=[F(), F("f2", "Unused", "[net] * 3")], measures=[{"formula": "f1",
                                                                          "agg": "avg"}])
    p = vp(raw)
    rng = P.resolve_range(p["range"], TODAY)
    sc = S.scan(conn, p, {}, rng, UID, today=TODAY)
    assert A.evaluate(sc.rows, p, CAT).probe == []
    assert [x["id"] for x in A.evaluate(sc.rows, p, CAT, probe=True).probe] == ["f1", "f2"]


def test_a_plain_preview_keeps_the_wave9_cache_key(conn, monkeypatch):
    """m-4: the probe mark joins the key only for a plan with formulas."""
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "0")
    add_trade(conn, UID, day="2026-10-20", pnl=50.0)
    keys = []
    real = run._cache_key

    def spy(*a, **k):
        keys.append(a[-1])
        return real(*a, **k)

    monkeypatch.setattr(run, "_cache_key", spy)
    run.run_plan(UID, fp(measures=[{"key": "net_pnl"}]), {}, lane="preview", now=NOW)
    run.run_plan(UID, fp(formulas=[F()], measures=[{"formula": "f1", "agg": "sum"}]), {},
                 lane="preview", now=NOW)
    assert keys == [[], ["probe"]]


def test_a_sample_goal_run_claims_no_missing_goal(conn, monkeypatch):
    """m-2: the sample book reads no goal, so it never tells a member to set one they may have."""
    monkeypatch.setattr(S.CATALOG, "view_allowed", LENIENT.view_allowed)
    a = add_account(conn, UID, "Main")
    _goals(conn, a, {"weekly": 1000})
    out = run.run_plan(UID, _goal_plan(), {}, lane="preview", now=NOW, sample=True)
    assert out["sample"] is True
    assert (out["target"], out["targetLabel"]) == (None, "Weekly goal")
    assert "goal" not in (out["notice"] or "") and not any("goal" in f for f in out["footnotes"])


def test_a_fall_from_the_range_start_names_the_start(conn):
    """W10-R50 wording: a drawdown that began at the range's start."""
    for d, pnl in zip(days(3), (-50, -20, 100)):
        add_trade(conn, UID, day=d, pnl=float(pnl))
    p, sc, res = evaluate(conn, fp(measures=[{"key": "max_drawdown"}]))
    assert build(p, res, sc, w10=True)["drawdown"]["line"] == \
        "From the start of this range to Mar 3; recovered Mar 4."


# -- Task 10.6 fix round 1: a formula filter with "last N trades" -----------------------------

def _forty_alternating(conn, *, flag_newest_win=False, n=40):
    """`n` closed trades on `n` days, newest first alternating +210 / -100."""
    start = date(2026, 8, 3)
    for i in range(n):
        d = (start + timedelta(days=i)).isoformat()
        win = i % 2 == 1
        add_trade(conn, UID, day=d, pnl=210.0 if win else -100.0,
                  excluded=1 if (flag_newest_win and i == n - 1) else 0, commit=False)
    conn.commit()


def test_last_n_with_a_formula_filter_keeps_the_newest_n_that_pass(conn):
    """I-2: "last 20 trades where Green is Yes" is the newest 20 WINS (20 trades, $4,200), exactly
    what the same filter written as a SQL filter gives -- never the wins among the newest 20."""
    _forty_alternating(conn)
    rng = {"token": "last_20_trades"}
    by_formula = fp(formulas=[F(name="Green", expr="[net] > 0")], measures=[{"key": "net_pnl"}],
                    rng=rng, filters=[{"field": "formula:f1", "op": "is", "values": [True]}])
    by_sql = fp(measures=[{"key": "net_pnl"}], rng=rng,
                filters=[{"field": "net", "op": "gt", "values": [0]}])
    for raw in (by_formula, by_sql):
        _p, _sc, res = evaluate(conn, raw)
        assert (res.count, res.total.cells[0].value) == (20, 4200.0), raw.get("filters")
    out = run.run_plan(UID, by_formula, {}, lane="run", now=NOW)
    assert out["count"] == 20 and out["value"]["v1"] == 4200.0


def test_last_n_with_a_formula_filter_on_a_list_lists_a_flagged_trade_without_using_up_n(conn):
    _forty_alternating(conn, flag_newest_win=True, n=44)       # 22 wins, the newest flagged
    raw = fp(formulas=[F(name="Green", expr="[net] > 0")], measures=[{"key": "net_pnl"}],
             rng={"token": "last_20_trades"}, view={"type": "list"},
             filters=[{"field": "formula:f1", "op": "is", "values": [True]}])
    _p, sc, res = evaluate(conn, raw)
    assert len(sc.rows) == 21 and sum(1 for r in sc.rows if r["flagged"]) == 1
    assert res.count == 20 and res.total.cells[0].value == 4200.0


def test_a_formula_filter_asks_the_runs_deadline_every_check_every_rows(conn):
    """m-2: writing a formula filter's values asks the run's own check (the Budget's clock),
    every `CHECK_EVERY` rows -- in `apply_filters` and on the last-N scan path."""
    rows = [{"net": float(i), "flagged": False} for i in range(600)]
    p = vp(fp(formulas=[F(name="Green", expr="[net] > 0")], measures=[{"key": "net_pnl"}],
              filters=[{"field": "formula:f1", "op": "is", "values": [True]}]))
    calls = []
    kept = A.apply_filters(rows, p, S.CLOSED, check=lambda: calls.append(1))
    assert len(kept) == 599 and len(calls) == 600 // wf.CHECK_EVERY
    _forty_alternating(conn)
    handed = []
    real = A.apply_filters

    def spy(*a, **kw):
        handed.append(kw.get("check"))
        return real(*a, **kw)

    A.apply_filters = spy
    try:
        p20 = vp(fp(formulas=[F(name="Green", expr="[net] > 0")], measures=[{"key": "net_pnl"}],
                    rng={"token": "last_20_trades"},
                    filters=[{"field": "formula:f1", "op": "is", "values": [True]}]))
        rng = P.resolve_range(p20["range"], TODAY)
        sc = S.scan(conn, p20, {}, rng, UID, today=TODAY)
    finally:
        A.apply_filters = real
    assert len(sc.rows) == 20
    assert handed == [wcompile.check_deadline]          # the scan path hands in the run's clock
