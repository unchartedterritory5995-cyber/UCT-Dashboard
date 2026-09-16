"""BL-021 — a metric for date D must not depend on where the invocation began.

⭐⭐ THE INVARIANT: VALUE(metric, universe, D) is a function of canonical historical
inputs and nothing else. Not of chunk size, not of sweep start, not of a process
restart, not of a resume boundary, not of a forward-seal tick.

⛔ THESE RAILS ARE DETERMINISTIC AND OFFLINE. The frame, the membership and the metric
engine are driven from a synthetic fixture in which the WHOLE-MARKET population and the
ELIGIBLE population differ materially — because that difference is the entire defect. A
fixture where they coincide would pass against the broken code.

⚰️ AND EACH ONE CARRIES ITS BITE-CHECK. A rail for an invariant nobody can break is not
a rail; `test_*_bite_check` restores the old behaviour and asserts the rail goes RED.
"""
import numpy as np
import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_history_recon as recon
from api.services import breadth_pit_frame as bpf

#: ⚠️ 260 SESSIONS, NOT 40. `recompute_from_frame` refuses a window under 221 sessions
#: ("only N sessions <=target (need 221)") because a 200-day average and a 52-week
#: extreme need that much runway — so a short fixture does not exercise the real
#: function at all, it exercises its guard. The last 30 are the comparison window.
def _weekdays(start, n):
    from datetime import date as _d, timedelta as _t
    out, d = [], _d.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += _t(days=1)
    return out


DATES = _weekdays("2014-01-01", 260)
#: 400 names in the frame; only 120 are ever eligible. ⛔ The 3.3x gap is the point.
TICKERS = [f"T{i:04d}" for i in range(400)]
ELIGIBLE = set(TICKERS[:120])


@pytest.fixture
def frame():
    """A deterministic whole-market matrix + a per-date member set.

    ⚠️ The INELIGIBLE names move very differently from the eligible ones, so a metric
    computed over the wrong population cannot accidentally agree.
    """
    rng = np.random.default_rng(20260915)
    n, m = len(TICKERS), len(DATES)
    closes = np.full((n, m), np.nan)
    vols = np.full((n, m), np.nan)
    for i in range(n):
        eligible = TICKERS[i] in ELIGIBLE
        # eligible names drift gently; the rest lurch, so up_4pct differs sharply
        # ⚠️ BOTH populations must produce 4% movers or `ratio_5day` divides by zero
        # and is never stored — the rail would then pass by measuring nothing. The
        # eligible names are volatile ENOUGH; the rest are far more so, which is what
        # makes a wrong-population answer visibly wrong.
        step = rng.normal(0.0, 0.035 if eligible else 0.11, m)
        closes[i] = 50.0 * np.exp(np.cumsum(step))
        vols[i] = rng.uniform(1e6, 5e6, m)
    return {
        "ok": True, "universe": "us", "dates": list(DATES),
        "date_pos": {d: i for i, d in enumerate(DATES)},
        "closes": closes, "vols": vols, "tickers": list(TICKERS),
        "eligible": {d: set(ELIGIBLE) for d in DATES},
        "coverage": {d: {} for d in DATES},
        "sweep_dates": list(DATES), "warm_dates": [],
    }


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "chunk.db"))
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    store._INIT_DONE = False
    yield
    store._INIT_DONE = False


def sweep(frame, frm, to, monkeypatch):
    """Drive the REAL `sweep_history` against the fixture frame."""
    monkeypatch.setattr(bpf, "build_frame",
                        lambda uni, f, t, **kw: _sliced(frame, f, t))
    return recon.sweep_history(frm, to, universe="us")


def _sliced(frame, frm, to):
    """What `build_frame` returns for one request: the same matrix, with the member
    set present for the output dates AND the warm window (the BL-021 contract)."""
    sweep_dates = [d for d in frame["dates"] if frm <= d <= to]
    first = frame["dates"].index(sweep_dates[0]) if sweep_dates else len(frame["dates"])
    warm = frame["dates"][max(0, first - bpf.WARM_SESSIONS):first]
    elig = {d: set(ELIGIBLE) for d in warm + sweep_dates}
    return {**frame, "eligible": elig, "sweep_dates": sweep_dates, "warm_dates": warm}


def rows_for(universe="us"):
    from api.services import breadth_metrics as bm
    out = {}
    for m in bm.METRIC_KEYS:
        for d, r in (store.history(m, universe=universe) or {}).items():
            out[(d, m)] = (r.get("o"), r.get("h"), r.get("l"), r.get("c"))
    return out


# ⭐ The comparison window is the LAST 30 sessions, so every date in it clears the
# 221-session floor and the rolling metrics are genuinely warm.
FRM, TO = DATES[-30], DATES[-1]


def one_sweep(frame, monkeypatch):
    sweep(frame, FRM, TO, monkeypatch)
    return rows_for()


def chunked(frame, monkeypatch, bounds):
    for frm, to in bounds:
        sweep(frame, frm, to, monkeypatch)
    return rows_for()


# ── the invariant ────────────────────────────────────────────────────────────

def test_two_chunks_equal_one_sweep(frame, monkeypatch, tmp_path):
    a = one_sweep(frame, monkeypatch)
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "b.db"))
    store._INIT_DONE = False
    b = chunked(frame, monkeypatch, [(FRM, DATES[-16]), (DATES[-15], TO)])
    assert set(a) == set(b)
    assert a == b, {k: (a[k], b[k]) for k in a if a.get(k) != b.get(k)}


def test_four_chunks_equal_one_sweep(frame, monkeypatch, tmp_path):
    a = one_sweep(frame, monkeypatch)
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "c.db"))
    store._INIT_DONE = False
    b = chunked(frame, monkeypatch,
                [(FRM, DATES[-24]), (DATES[-23], DATES[-16]),
                 (DATES[-15], DATES[-8]), (DATES[-7], TO)])
    assert a == b, {k: (a[k], b[k]) for k in a if a.get(k) != b.get(k)}


def test_a_forward_seal_sized_invocation_equals_the_historical_value(
        frame, monkeypatch, tmp_path):
    """⭐⭐ THE MANDATORY CASE. A daily seal is a one-date sweep. If that produced a
    different number from the grind, the live end of every series would disagree with
    its own history at the join — and look entirely plausible doing it."""
    a = one_sweep(frame, monkeypatch)
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "d.db"))
    store._INIT_DONE = False
    b = chunked(frame, monkeypatch, [(d, d) for d in DATES[-30:]])
    assert a == b, {k: (a[k], b[k]) for k in a if a.get(k) != b.get(k)}


@pytest.mark.parametrize("metric", ["ratio_5day", "ratio_10day"])
def test_the_rolling_ratios_specifically(frame, monkeypatch, tmp_path, metric):
    a = one_sweep(frame, monkeypatch)
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / f"{metric}.db"))
    store._INIT_DONE = False
    b = chunked(frame, monkeypatch, [(FRM, DATES[-16]), (DATES[-15], TO)])
    ra = {d: v for (d, m), v in a.items() if m == metric}
    rb = {d: v for (d, m), v in b.items() if m == metric}
    assert ra and ra == rb
    assert all(v[3] is not None for v in ra.values()), "the ratio never computed at all"


def test_ohlc_specifically_not_just_the_close(frame, monkeypatch, tmp_path):
    a = one_sweep(frame, monkeypatch)
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    store._INIT_DONE = False
    b = chunked(frame, monkeypatch, [(FRM, DATES[-16]), (DATES[-15], TO)])
    bad = {k: (a[k], b[k]) for k in a if a[k] != b[k]}
    assert not bad, bad
    # and the bar after the boundary opens at the PRIOR canonical close
    boundary = DATES[-15]
    before = DATES[-16]
    for m in ("pct_above_50sma", "up_4pct_today"):
        assert b[(boundary, m)][0] == b[(before, m)][3], m


def test_the_true_first_date_of_a_series_still_opens_at_its_own_close(
        frame, monkeypatch):
    """⚠️ A GENUINELY FIRST DATE IS NOT A BOUNDARY DEFECT. With no earlier session
    there is no prior close to open at, so `o == c` is the right answer — and it must
    now be decided by the data, not by where a loop began."""
    # ⚠️ The frame still carries 221+ sessions of PRICE history (the metric engine
    # needs them), but NO earlier session has a member set — which is exactly a PIT
    # universe standing at its own historical floor.
    first = DATES[-30]
    monkeypatch.setattr(bpf, "build_frame",
                        lambda uni, f, t, **kw: {**frame,
                                                 "eligible": {first: set(ELIGIBLE)},
                                                 "sweep_dates": [first],
                                                 "warm_dates": []})
    monkeypatch.setattr(recon, "_seed_carry_in", lambda *a, **k: None)
    recon.sweep_history(first, first, universe="us")
    got = rows_for()
    o, _h, _l, c = got[(first, "pct_above_50sma")]
    assert o == c, "the first EVER date must open at its own close"


# ── bite-checks: break it back, the rails must go red ───────────────────────

def test_bite_check_warmup_without_membership_breaks_the_ratios(
        frame, monkeypatch, tmp_path):
    """⚰️ Restore `members=None` on warm dates — the exact pre-BL-021 behaviour."""
    a = one_sweep(frame, monkeypatch)

    def _no_warm_members(frame_, frm, to):
        sl = _sliced(frame_, frm, to)
        return {**sl, "eligible": {d: set(ELIGIBLE) for d in sl["sweep_dates"]}}

    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "bite1.db"))
    store._INIT_DONE = False
    for frm, to in [(FRM, DATES[-16]), (DATES[-15], TO)]:
        monkeypatch.setattr(bpf, "build_frame",
                            lambda uni, f, t, **kw: _no_warm_members(frame, f, t))
        recon.sweep_history(frm, to, universe="us")
    b = rows_for()

    r5 = {d: (a[(d, "ratio_5day")], b[(d, "ratio_5day")])
          for (d, m) in a if m == "ratio_5day" and a[(d, m)] != b.get((d, m))}
    assert r5, ("the bite-check did not break ratio_5day — the fixture's eligible and "
                "whole-market populations must differ enough to matter")


def test_bite_check_unseeded_prev_breaks_the_bodies(frame, monkeypatch, tmp_path):
    """⚰️ Disable the carry-in seeding — the exact pre-BL-021 behaviour, where `prev`
    began empty on every invocation and the first stored bar took `o = c`."""
    a = one_sweep(frame, monkeypatch)
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "bite2.db"))
    store._INIT_DONE = False
    monkeypatch.setattr(recon, "_seed_carry_in", lambda *a_, **k_: None)
    b = chunked(frame, monkeypatch, [(FRM, DATES[-16]), (DATES[-15], TO)])

    boundary = DATES[-15]
    assert a[(boundary, "pct_above_50sma")] != b[(boundary, "pct_above_50sma")], (
        "the bite-check did not break the boundary body")
    o, _h, _l, c = b[(boundary, "pct_above_50sma")]
    assert o == c, "the old behaviour should produce a doji at the boundary"
    # ⭐ and the FIXED run does not
    fo, _fh, _fl, fc = a[(boundary, "pct_above_50sma")]
    assert fo != fc
