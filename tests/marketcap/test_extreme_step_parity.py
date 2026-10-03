"""2026-10-03 cutover-review fix: the extreme-step rule is ONE shared implementation (extreme_steps.py), applied by the
build to a FIXED POINT and used verbatim by the validator. The failed candidate stopped after 6 passes (an issuer needing
more kept its oldest unproven state served) and its validator proved steps the build rule does not."""
from datetime import date, timedelta

import pytest

from api.services.marketcap import extreme_steps as X
from api.services.marketcap import reasons as R


def row(ck, as_of, norm, accn, form="10-Q", status="ACCEPTED"):
    r = [None] * 23
    r[1], r[3], r[4], r[8], r[13], r[14], r[18] = "cik:1", ck, as_of, norm, accn, form, status
    return tuple(r)


def run(start, end, sh, accn, as_of):
    return (start, end, sh, accn, as_of, "COVER_XBRL")


def old_validator(v_inputs):
    """The FAILED candidate's validator: corroborated AND (bridged OR any capital-event filing between) -- no window, no
    direction, and (before its own fix) any status could bridge."""
    sa, sb, rows, ev = v_inputs
    lo, hi = sa[0][1][4], sb[0][1][4]
    mids = sorted((o[4], o[8]) for o in rows if lo <= o[4] <= hi)
    vals = [sa[0][1][2]] + [v for _d, v in mids] + [sb[0][1][2]]
    import math
    bridged = all(abs(math.log(y / x)) < math.log(10) for x, y in zip(vals, vals[1:]))
    return bridged or any(lo < f <= hi for f, _fm in ev)


def pair(a_val, a_asof, b_val, b_asof, extra_rows=()):
    sa = [("COMMON", run("2000-01-01", "2000-12-31", a_val, "A", a_asof))]
    sb = [("COMMON", run("2001-01-01", "2001-12-31", b_val, "B", b_asof))]
    rows = [row("COMMON", a_asof, a_val, "A"), row("COMMON", a_asof, a_val, "A2"),
            row("COMMON", b_asof, b_val, "B"), row("COMMON", b_asof, b_val, "B2"), *extra_rows]
    return sa, sb, rows


def test_A_capital_event_more_than_two_years_away_proves_nothing():
    sa, sb, rows = pair(1e6, "2010-01-31", 30e6, "2014-01-31")
    ev = [("2011-06-01", "S-1")]
    assert old_validator((sa, sb, rows, ev))                                     # the failed validator proved it
    assert X.step_verdict(sa, sb, 30.0, rows, ev, [])["verdict"] != "PROVEN"


def test_B_capital_event_cannot_explain_a_fall():
    sa, sb, rows = pair(30e6, "2020-01-31", 1e6, "2020-09-30")
    ev = [("2020-05-01", "424B4")]
    assert old_validator((sa, sb, rows, ev))
    v = X.step_verdict(sa, sb, 1 / 30, rows, ev, [])
    assert v["verdict"] == "UNPROVEN_SPLIT_LIKE"


def test_C_a_rejected_intermediate_count_does_not_bridge():
    mid = row("COMMON", "2020-06-30", 5e6, "M", status=R.REJ_SCALE_UNRESOLVED)
    sa, sb, rows = pair(1e6, "2020-01-31", 30e6, "2022-12-31", [mid])
    assert old_validator((sa, sb, rows, []))                                    # 1 -> 5 -> 30: each < 10x
    assert X.step_verdict(sa, sb, 30.0, rows, [], [])["verdict"] != "PROVEN"


def test_D_accepted_intermediate_counts_bridge():
    mid = row("COMMON", "2020-06-30", 5e6, "M")
    sa, sb, rows = pair(1e6, "2020-01-31", 30e6, "2022-12-31", [mid])
    v = X.step_verdict(sa, sb, 30.0, rows, [], [])
    assert v["verdict"] == "PROVEN" and v["basis"] == "BRIDGED"


def test_E_a_capital_event_within_two_years_explains_a_rise():
    sa, sb, rows = pair(1e6, "2020-01-31", 30e6, "2021-06-30")
    v = X.step_verdict(sa, sb, 30.0, rows, [("2020-09-01", "424B5")], [])
    assert v["verdict"] == "PROVEN" and v["basis"] == "CAPITAL_EVENT"


def test_F_more_than_six_withholding_iterations_converge():
    """The NNDM / SXTC shape: eight earlier states (each corroborated, within 10x of one another) and a latest state
    >= 10x above all of them with nothing proving the jump. The failed build stopped after six and served the rest."""
    caps, runs, rows, price = {}, [], [], {}
    start = date(2010, 1, 4)
    for k in range(8):
        d = start + timedelta(days=30 * k)
        v = (k + 1) * 1e6
        runs.append(run(d.isoformat(), (d + timedelta(days=20)).isoformat(), v, f"a{k}", d.isoformat()))
        rows += [row("COMMON", d.isoformat(), v, f"a{k}"), row("COMMON", d.isoformat(), v, f"b{k}")]
        caps[d] = v * 10.0
        price[d] = 10.0
    last = date(2018, 1, 2)
    runs.append(run(last.isoformat(), "2018-12-31", 5e9, "z", last.isoformat()))
    rows += [row("COMMON", last.isoformat(), 5e9, "z"), row("COMMON", last.isoformat(), 5e9, "z2")]
    caps[last], price[last] = 5e9 * 10.0, 10.0
    holds, iters, served = X.converge(caps, price, {("cik:1", "COMMON"): runs}, rows, [], [])
    assert iters == 8 and set(holds) == set(caps) - {last}
    assert all(v["verdict"] == "PROVEN" for _a, _b, v in served)
    assert all(r == R.SCALE_UNRESOLVED for r, _n in holds.values())


def test_fixed_point_is_monotone_and_guarded():
    """A rule that withholds nothing for an unproven step is an impossible state: the build fails, it never loops."""
    orig = X.withhold_for
    try:
        X.withhold_for = lambda days, a, b, v: {}
        sa_caps = {date(2020, 1, 2): 1e7, date(2021, 1, 4): 1e9}
        runs = {("cik:1", "COMMON"): [run("2020-01-01", "2020-12-31", 1e6, "a", "2019-12-31"),
                                      run("2021-01-01", "2021-12-31", 1e8, "b", "2020-12-31")]}
        rows = [row("COMMON", "2019-12-31", 1e6, "a"), row("COMMON", "2019-09-30", 1e6, "a2"),
                row("COMMON", "2020-12-31", 1e8, "b"), row("COMMON", "2020-09-30", 1e8, "b2")]
        with pytest.raises(X.ConvergenceError):
            X.converge(sa_caps, {d: 10.0 for d in sa_caps}, runs, rows, [], [])
    finally:
        X.withhold_for = orig


def test_build_and_validator_share_one_rule():
    """The validator imports the rule; it does not carry its own copy."""
    import inspect
    from api.services.marketcap import build, step_records
    src = inspect.getsource(step_records)
    assert "from .extreme_steps import" in src and "def step_verdict" not in src and "EVENT_WINDOW" not in src
    assert build.CAPITAL_EVENT_FORMS is X.CAPITAL_EVENT_FORMS
    assert "range(6)" not in inspect.getsource(build)
