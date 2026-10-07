"""Exchange Breadth V1 — derived A/D, MCO, MCS: the locked methodology, pinned."""
import importlib.util
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "derive_exchange_series", os.path.join(ROOT, "tools", "breadth_exch", "derive_exchange_series.py"))
dx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dx)


def _series(n=400, seed=3, holes=()):
    rnd = random.Random(seed)
    import datetime as _dt
    dates = [(_dt.date(2008, 1, 2) + _dt.timedelta(days=i)).isoformat() for i in range(n)]
    adv = [rnd.randint(500, 1500) for _ in range(n)]
    dec = [rnd.randint(500, 1500) for _ in range(n)]
    for h in holes:
        adv[h] = dec[h] = None
    return dates, adv, dec


def test_ad_line_base_zero_and_holes_hold():
    d, a, b = _series(10, holes=(4,))
    ad = dx.ad_line(a, b)
    assert ad[0] == a[0] - b[0]
    assert ad[4] == ad[3] and ad[5] == ad[3] + a[5] - b[5]


def test_ratio_adjusted_tracking_rates_exact():
    d, a, b = _series(300)
    r = [(x - y) / (x + y) * 1000.0 for x, y in zip(a, b)]
    f = s = 0.0
    want = []
    for v in r:
        f = 0.9 * f + 0.1 * v
        s = 0.95 * s + 0.05 * v
        want.append(f - s)
    got = dx.derive(d, a, b)["MCO"]
    for i in range(121, 300):
        assert abs(got[i] - want[i]) < 1e-9


def test_burn_in_boundary_is_exactly_120_real_observations():
    d, a, b = _series(200, holes=(10, 11, 12))
    out = dx.derive(d, a, b)
    # 3 holes inside the first 120 rows push the first publishable session 3 rows later
    first = next(i for i, v in enumerate(out["MCO"]) if v is not None)
    assert first == 123 and out["epoch"] == d[123]
    assert all(v is None for v in out["MCO"][:123])
    assert out["MCS"][123] == 0.0 and all(v is None for v in out["MCS"][:123])


def test_summation_base_zero_and_no_double_count():
    d, a, b = _series(200)
    out = dx.derive(d, a, b)
    e = d.index(out["epoch"])
    assert out["MCS"][e] == 0.0
    assert abs(out["MCS"][e + 1] - out["MCO"][e + 1]) < 1e-12
    assert abs(out["MCS"][e + 2] - (out["MCO"][e + 1] + out["MCO"][e + 2])) < 1e-9


def test_holes_after_burn_in_hold_state():
    d, a, b = _series(260, holes=(200,))
    out = dx.derive(d, a, b)
    assert out["MCO"][200] is None
    assert out["MCS"][200] == out["MCS"][199]
    d2, a2, b2 = _series(260)
    a2[200] = b2[200] = None
    assert dx.derive(d2, a2, b2) == out


def test_appending_future_sessions_never_changes_history():
    d, a, b = _series(400)
    full = dx.derive(d, a, b)
    for cut in (150, 250, 399):
        pre = dx.derive(d[:cut], a[:cut], b[:cut])
        for k in ("AD", "MCO", "MCS"):
            assert pre[k] == full[k][:cut]


def test_deterministic():
    d, a, b = _series(300)
    assert dx.derive(d, a, b) == dx.derive(list(d), list(a), list(b))


def test_the_production_derivation_path_equals_the_locked_derivation(monkeypatch):
    """ONE AUTHORITY. The member path (producers._build_uncached) serves the exchange authority's AD/MCO/MCS
    VERBATIM and never recomputes from the store; and the authority's own continuity rule
    (live_core.derive_step, which `verify_set` folds over frozen + live) IS the locked derivation."""
    import importlib.util
    import os as _os
    from api.services import breadth_daily_ohlc as store
    from api.services import breadth_exchange_authority as ea
    from api.services.market_indicators import producers as p
    d, a, b = _series(300, holes=(150,))
    want = dx.derive(d, a, b)
    # (1) the authority's fold == the locked derivation, session by session
    spec = importlib.util.spec_from_file_location(
        "lc_for_derived_test", _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                                             "tools", "breadth_exch", "live_core.py"))
    lc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lc)
    st = {"ad": None, "ema_fast": None, "ema_slow": None, "valid_obs": 0, "mcs": None}
    folded = {"AD": [], "MCO": [], "MCS": []}
    for x, y in zip(a, b):
        st, out = lc.derive_step(st, x, y)
        for k in folded:
            folded[k].append(out[k])
    assert folded["AD"] == want["AD"] and folded["MCO"] == want["MCO"]
    assert all(v is None and w is None or abs(v - w) < 1e-9 for v, w in zip(folded["MCS"], want["MCS"]))
    # (2) the member path reads the authority verbatim, never the store
    monkeypatch.setattr(store, "history", lambda *k, **kw: (_ for _ in ()).throw(AssertionError("recomputed")))
    served = {f"{X}:{k}": {x: v for x, v in zip(d, want[k]) if v is not None}
              for X in ("NYSE", "NASDAQ") for k in ("AD", "MCO", "MCS")}
    monkeypatch.setattr(ea, "derived", lambda sid: served.get(sid))
    for X in ("NYSE", "NASDAQ"):
        for k in ("AD", "MCO", "MCS"):
            ds = p._build_uncached(f"{X}:{k}")
            assert dict(zip(ds.dates, ds.values)) == served[f"{X}:{k}"]
        assert p._build_uncached(f"{X}:MCS").base == 0.0
    # (3) authority not serving → nothing (fail closed), never a recomputation
    monkeypatch.setattr(ea, "derived", lambda sid: None)
    assert p._build_uncached("NYSE:MCO") is None and p._build_uncached("NASDAQ:AD") is None