import calendar

import pytest

from api.services.econ import store as st
from api.services.econ import validate as va
from api.services.econ.model import FetchResult, RawObs

NOW = 1_790_000_000          # 2026-09-21
T0 = 1_700_000_000


@pytest.fixture
def s(tmp_path):
    db = st.connect(str(tmp_path / "econ.db"))
    yield db
    db.close()


def spec(sym="USCPI", freq="M", rev="seasonal_factor_revision", anchor="", **kw):
    d = {"symbol": sym, "frequency": freq, "week_anchor": anchor, "revision": {"type": rev},
         "units": {"raw": "Index", "display": "Index", "fmt": "num1", "scale": 1}}
    d.update(kw)
    return d


def mon(y, m):
    return f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


def series(n=36, y0=2023, base=300.0, step=0.5, sym="USCPI"):
    out, y, m = [], y0, 1
    for i in range(n):
        ps, pe = mon(y, m)
        out.append(RawObs(sym, ps, pe, base + i * step + (0.05 if i % 2 else -0.05)))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def fr(obs):
    return FetchResult(adapter="bls", request_key="bls:test", observations=list(obs))


def store_obs(s, obs, sym="USCPI"):
    r = s.upsert_release("seed", None, "backfill", None, None)
    s.write_observations(sym, r, [(o.period_start, o.period_end, o.value, o.flag, T0, "rule", "L", None, None)
                                  for o in obs])


def test_clean_payload_accepted(s):
    obs = series()
    acc, reasons = va.validate_fetch(spec(), fr(obs), s, now=NOW, mode="history")
    assert reasons == [] and len(acc) == 36
    store_obs(s, obs)
    nxt = obs + [RawObs("USCPI", *mon(2026, 1), obs[-1].value + 0.4)]
    acc, reasons = va.validate_fetch(spec(), fr(nxt), s, now=NOW, mode="history")
    assert reasons == [] and len(acc) == 37


def test_malformed_period_rejected(s):
    bad = [RawObs("USCPI", "2026-8-01", "2026-08-31", 1.0)]
    acc, reasons = va.validate_fetch(spec(), fr(bad), s, now=NOW)
    assert acc == [] and reasons[0].startswith("schema:")
    for o in (RawObs("USCPI", "2026-08-02", "2026-08-31", 1.0),          # off-grid month
              RawObs("USCPI", "2026-08-01", "2026-07-31", 1.0)):         # end < start
        assert va.validate_fetch(spec(), fr([o]), s, now=NOW)[1]
    q = spec(freq="Q")
    assert va.validate_fetch(q, fr([RawObs("USCPI", "2026-02-01", "2026-04-30", 1.0)]), s, now=NOW)[1]
    assert not va.validate_fetch(q, fr([RawObs("USCPI", "2026-04-01", "2026-06-30", 1.0)]), s, now=NOW)[1]


def test_weekly_anchor_and_daily_weekend(s):
    w = spec(freq="W", anchor="SAT", rev="minor_routine")
    ok = RawObs("USCPI", "2026-09-13", "2026-09-19", 1.0)
    bad = RawObs("USCPI", "2026-09-12", "2026-09-18", 1.0)
    assert va.validate_fetch(w, fr([ok]), s, now=NOW)[1] == []
    assert "not a SAT" in va.validate_fetch(w, fr([bad]), s, now=NOW)[1][0]
    d = spec(freq="D", rev="none")
    assert va.validate_fetch(d, fr([RawObs("USCPI", "2026-09-07", "2026-09-07", 4.0)]), s, now=NOW)[1] == []  # Labor Day ok
    assert "weekend" in va.validate_fetch(d, fr([RawObs("USCPI", "2026-09-12", "2026-09-12", 4.0)]), s, now=NOW)[1][0]
    d2 = spec(freq="D", rev="none", validation={"allow_weekend": True})
    assert va.validate_fetch(d2, fr([RawObs("USCPI", "2026-09-12", "2026-09-12", 4.0)]), s, now=NOW)[1] == []


def test_nan_and_non_numeric_rejected(s):
    for v in (float("nan"), float("inf"), "3.1", True):
        acc, reasons = va.validate_fetch(spec(), fr([RawObs("USCPI", *mon(2026, 1), v)]), s, now=NOW)
        assert acc == [] and reasons[0].startswith("numeric:"), v
    # explicit NA is allowed
    assert va.validate_fetch(spec(), fr([RawObs("USCPI", *mon(2026, 1), None)]), s, now=NOW)[1] == []


def test_duplicate_conflicting_period_rejects_payload(s):
    obs = [RawObs("USCPI", *mon(2026, 1), 1.0), RawObs("USCPI", *mon(2026, 2), 2.0),
           RawObs("USCPI", *mon(2026, 1), 1.5)]
    acc, reasons = va.validate_fetch(spec(), fr(obs), s, now=NOW)
    assert acc == [] and reasons[0].startswith("duplicate:")
    same = [RawObs("USCPI", *mon(2026, 1), 1.0), RawObs("USCPI", *mon(2026, 1), 1.0)]
    acc, reasons = va.validate_fetch(spec(), fr(same), s, now=NOW)
    assert reasons == [] and len(acc) == 1


def test_identity(s):
    obs = [RawObs("USCPI", *mon(2026, 1), 1.0), RawObs("USPPI", *mon(2026, 1), 1.0)]
    assert va.validate_fetch(spec(), fr(obs), s, now=NOW)[1][0].startswith("identity:")
    acc, reasons = va.validate_fetch(spec(), fr(obs), s, now=NOW, requested_ids=["USCPI", "USPPI"])
    assert reasons == [] and [o.series_id for o in acc] == ["USCPI"]


def test_scale_slip_million_vs_billion(s):
    lvl = spec(sym="USRETAIL", rev="annual_benchmark")
    hist = [RawObs("USRETAIL", o.period_start, o.period_end, 700_000.0 + i * 500) for i, o in enumerate(series())]
    store_obs(s, hist, "USRETAIL")
    slip = [RawObs("USRETAIL", *mon(2026, 1), 701.0)]            # $bn where $M was expected
    acc, reasons = va.validate_fetch(lvl, fr(slip), s, now=NOW)
    assert acc == [] and reasons[0].startswith("scale:")
    assert "701" not in reasons[0]                                # never echoes payload values
    fine = [RawObs("USRETAIL", *mon(2026, 1), 718_000.0)]
    assert va.validate_fetch(lvl, fr(fine), s, now=NOW)[1] == []


def test_history_mutation_outside_window_none_series(s):
    none = spec(sym="USCPINSA", rev="none")
    hist = [RawObs("USCPINSA", o.period_start, o.period_end, o.value) for o in series()]
    store_obs(s, hist, "USCPINSA")
    mutated = list(hist)
    mutated[5] = RawObs("USCPINSA", hist[5].period_start, hist[5].period_end, hist[5].value + 0.1)
    acc, reasons = va.validate_fetch(none, fr(mutated), s, now=NOW, mode="history")
    assert acc == [] and reasons[0].startswith("mutation:")
    # even the newest period is outside a 0-period window
    last = list(hist)
    last[-1] = RawObs("USCPINSA", hist[-1].period_start, hist[-1].period_end, hist[-1].value + 0.1)
    assert va.validate_fetch(none, fr(last), s, now=NOW)[1][0].startswith("mutation:")
    # minor_routine: last 3 periods may move, the 4th may not
    mr = spec(sym="USCPINSA", rev="minor_routine")
    ok = list(hist)
    ok[-3] = RawObs("USCPINSA", hist[-3].period_start, hist[-3].period_end, hist[-3].value + 0.1)
    assert va.validate_fetch(mr, fr(ok), s, now=NOW)[1] == []
    bad = list(hist)
    bad[-4] = RawObs("USCPINSA", hist[-4].period_start, hist[-4].period_end, hist[-4].value + 0.1)
    assert va.validate_fetch(mr, fr(bad), s, now=NOW)[1][0].startswith("mutation:")
    # seasonal-factor revision reaches back 5 years; comprehensive is unlimited
    assert va.validate_fetch(spec(sym="USCPINSA"), fr(mutated), s, now=NOW)[1] == []
    assert va.validate_fetch(spec(sym="USCPINSA", rev="comprehensive"), fr(mutated), s, now=NOW)[1] == []
    assert va.validate_fetch(spec(sym="USCPINSA", rev="???"), fr(hist), s, now=NOW)[1][0].startswith("mutation:")


def test_partial_tail_drop(s):
    hist = series()
    store_obs(s, hist)
    acc, reasons = va.validate_fetch(spec(), fr(hist[:-2]), s, now=NOW, mode="history")
    assert acc == [] and reasons[0].startswith("partial:") and "2 stored period" in reasons[0]
    # a bounded history window only has to cover its own range
    assert va.validate_fetch(spec(), fr(hist[:-2]), s, now=NOW, mode="history",
                             end=hist[-3].period_start)[1] == []
    # 'latest' fetches are not held to the full history
    assert va.validate_fetch(spec(), fr(hist[-2:]), s, now=NOW, mode="latest")[1] == []


def test_future_period_rejected(s):
    acc, reasons = va.validate_fetch(spec(), fr([RawObs("USCPI", *mon(2026, 12), 1.0)]), s, now=NOW)
    assert acc == [] and reasons[0].startswith("ordering:")
    d = spec(freq="D", rev="none")
    tomorrow_ok = RawObs("USCPI", "2026-09-21", "2026-09-21", 1.0)
    assert va.validate_fetch(d, fr([tomorrow_ok]), s, now=NOW)[1] == []
    far = RawObs("USCPI", "2026-09-01", "2026-09-30", 1.0)       # month still running
    assert va.validate_fetch(spec(), fr([far]), s, now=NOW)[1][0].startswith("ordering:")


def test_plausibility_quarantine(s):
    hist = series()
    store_obs(s, hist)
    spike = hist + [RawObs("USCPI", *mon(2026, 1), hist[-1].value + 40.0)]
    acc, reasons = va.validate_fetch(spec(), fr(spike), s, now=NOW)
    assert acc == [] and reasons[0].startswith("plausibility:")
    assert va.severity(reasons) == "quarantine"
    assert va.severity(["scale: x"]) == "reject" and va.severity([]) == "ok"


def test_reasons_never_carry_secrets(s):
    fr_ = FetchResult(adapter="bls", request_key="bls:v2:?registrationkey=SECRET123",
                      observations=[RawObs("USCPI", "garbage-SECRET123", "x", 1.0)])
    _, reasons = va.validate_fetch(spec(), fr_, s, now=NOW)
    assert reasons and all("SECRET" not in r and "registrationkey" not in r and "garbage" not in r
                           for r in reasons)


def test_partial_tolerates_a_dropped_daily_holiday_null_only(s):
    """A pre-fix DB holds ND holiday rows (value None) of a daily series; the adapter now drops
    them, so a history payload omitting ONLY those nulls is complete. Omitting a VALUED day
    (or a null of a monthly series) is still partial."""
    d = spec(sym="UST10Y", freq="D", rev="none")
    days = [("2026-09-03", 4.1), ("2026-09-04", 4.2), ("2026-09-07", None), ("2026-09-08", 4.3)]
    held = [RawObs("UST10Y", p, p, v) for p, v in days]
    store_obs(s, held, sym="UST10Y")
    no_holiday = [o for o in held if o.value is not None]
    assert va.validate_fetch(d, fr(no_holiday), s, now=NOW, mode="history")[1] == []
    # negative control: dropping a valued day is still refused
    r = va.validate_fetch(d, fr([o for o in no_holiday if o.period_start != "2026-09-04"]), s, now=NOW,
                          mode="history")[1]
    assert r and r[0].startswith("partial:") and "1 stored period" in r[0]
    # negative control: a stored null of a MONTHLY series must still be covered
    hist = series(n=6)
    hist[2] = RawObs("USCPI", hist[2].period_start, hist[2].period_end, None)
    store_obs(s, hist)
    r = va.validate_fetch(spec(), fr([o for i, o in enumerate(hist) if i != 2]), s, now=NOW, mode="history")[1]
    assert r and r[0].startswith("partial:")
