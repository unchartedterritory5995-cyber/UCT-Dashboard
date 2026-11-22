"""FCTX, factor exposure (api/services/factor_exposure_calc.py, api/services/factor_exposure.py,
api/routers/factor_exposure.py). Every price, date and symbol pattern here is INVENTED (the fund symbols
are the real funds' names, with made-up prices).

  * the maths: the OLS loadings, standard errors, t, R-squared and adjusted R-squared against a
    textbook computation done another way (normal equations and an explicit inverse); the variance
    shares; each VIF against its auxiliary regression; collinear spreads flagged unstable; a singular
    design refused; an exact fit (the stock is a fund of the model) gives no t;
  * the windows: the newest 252 common returns, at least 200 (fewer is words), the 252 before them for
    a year earlier (never overlapping), the change and its t;
  * the alignment: STAT's `aligned_returns` over the sessions every series holds (a day missing on
    any side spans two sessions, never a zero return); the spreads (fund minus the market fund in use,
    IWF minus IWD);
  * the plain line: ONLY loadings with |t| above 2, its exact words, the market against 1;
  * the funds: held with enough history or replaced by the stated alternative (a pair together), or
    left out and said; read once per session for every member, the alternatives only when needed;
    no market fund is words;
  * the reads and the held answers: the bounded read, settled sessions only, per symbol per session,
    a lagging stock, a failed read never held, the cap, one build per symbol, the slot bound, an
    answer follows the fund set;
  * the route: one paid GET, 401 / 402 / 400, its own gate, a plain def, mounted.
"""
from __future__ import annotations

import pathlib
import random
import threading
import time
from datetime import date, datetime, timedelta

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import factor_exposure as fex_route
from api.services import factor_exposure as V
from api.services import factor_exposure_calc as C
from api.services.fundamentals_pit import beta as BETA

ROOT = pathlib.Path(__file__).resolve().parents[1]
FREE = {"id": "fex-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID = {"id": "fex-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
PRIMARY = ("SPY", "IWM", "IWF", "IWD", "MTUM", "QUAL", "USMV")
ALL_LEGS = {"market": ("SPY",), "size": ("IWM",), "growth": ("IWF", "IWD"), "momentum": ("MTUM",),
            "quality": ("QUAL",), "lowvol": ("USMV",)}


def fex_weekdays_ending(end: str, n: int) -> list[str]:
    d, out = date.fromisoformat(end), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return out[::-1]


def fex_market(days, seed=5, loads=None, noise=0.012, alt=False):
    """Invented closes for the seven funds (and their alternatives with `alt`) and one stock whose daily
    return is 0.0002 + its loadings on the six spreads + noise. Returns (series, stock)."""
    loads = loads or {"market": 1.3, "size": 0.0, "growth": 0.9, "momentum": 0.7, "quality": 0.0, "lowvol": 0.0}
    rng = random.Random(seed)
    names = list(PRIMARY) + (["IVV", "VTWO", "VUG", "VTV", "SPMO", "SPHQ", "SPLV"] if alt else [])
    px = {s: 100.0 for s in names + ["STK"]}
    series = {s: [] for s in names + ["STK"]}
    for d in days:
        m = rng.gauss(0.0004, 0.01)
        sz, gv, mo, qu, lv = (rng.gauss(0.0, 0.006) for _ in range(5))
        r = {"SPY": m, "IWM": m + sz, "IWF": m + gv / 2, "IWD": m - gv / 2, "MTUM": m + mo, "QUAL": m + qu, "USMV": m + lv}
        if alt:
            r.update({"IVV": m, "VTWO": m + sz, "VUG": m + gv / 2, "VTV": m - gv / 2, "SPMO": m + mo, "SPHQ": m + qu, "SPLV": m + lv})
        spreads = {"market": m, "size": sz, "growth": gv, "momentum": mo, "quality": qu, "lowvol": lv}
        r["STK"] = 0.0002 + sum(loads[k] * spreads[k] for k in loads) + rng.gauss(0.0, noise)
        for s, x in r.items():
            px[s] *= 1.0 + x
            series[s].append((d, px[s]))
    stock = series.pop("STK")
    return series, stock


@pytest.fixture(autouse=True)
def _fex_fresh():
    V.reset_for_tests()
    yield
    V.reset_for_tests()


def _textbook(y, f):
    """OLS by the normal equations and an explicit inverse: (coef, se, t, r2, adj_r2)."""
    n, k = f.shape
    x = np.column_stack((np.ones(n), f))
    xtx_inv = np.linalg.inv(x.T @ x)
    coef = xtx_inv @ x.T @ y
    resid = y - x @ coef
    s2 = float(resid @ resid) / (n - k - 1)
    se = np.sqrt(s2 * np.diag(xtx_inv))
    r2 = 1.0 - float(resid @ resid) / float(((y - y.mean()) ** 2).sum())
    return coef, se, coef / se, r2, 1.0 - (1.0 - r2) * (n - 1) / (n - k - 1)


# ── the maths ──────────────────────────────────────────────────────────────────────────────────

def test_the_loadings_t_and_r_squared_equal_a_textbook_ols_done_another_way():
    days = fex_weekdays_ending("2031-06-02", 300)
    series, stock = fex_market(days)
    dates, y, f, keys = C.align(stock, series, C.legs_of(ALL_LEGS))
    block, raw = C.fit(dates[-252:], y[-252:], f[-252:], keys)
    coef, se, t, r2, adj = _textbook(y[-252:], f[-252:])
    assert keys == ["market", "size", "growth", "momentum", "quality", "lowvol"]
    assert block["state"] == "ok" and block["returns"] == 252 and block["full"] is True
    near = lambda got, want, nd: abs(got - float(want)) <= 0.5 * 10 ** -nd + 1e-9   # noqa: E731
    for j, key in enumerate(keys):
        b, s = raw[key]
        assert abs(b - coef[j + 1]) < 1e-9 and abs(s - se[j + 1]) < 1e-9, key
        row = block["loadings"][j]
        assert row["key"] == key and near(row["loading"], coef[j + 1], 3) and near(row["t"], t[j + 1], 2)
        assert row["clears"] is bool(abs(t[j + 1]) > 2.0)
    assert near(block["r2"], r2, 3) and near(block["adj_r2"], adj, 3)
    assert near(block["explained_pct"], r2 * 100, 1) and near(block["own_pct"], (1 - r2) * 100, 1)
    assert near(block["constant"]["t"], t[0], 2)
    mkt = block["loadings"][0]
    t1 = (coef[1] - 1.0) / se[1]                                       # the market loading against 1
    assert near(mkt["t_vs_one"], t1, 2) and mkt["side"] == ("more" if t1 > 2 else "less" if t1 < -2 else "same")
    assert t1 > 2 and mkt["side"] == "more"
    assert near(block["constant"]["yearly_pct"], coef[0] * 252 * 100, 1)
    # the invented stock has 1.3 market, 0.9 growth, 0.7 momentum: the fit finds them
    got = {k: raw[k][0] for k in keys}
    assert abs(got["market"] - 1.3) < 0.15 and abs(got["growth"] - 0.9) < 0.3 and abs(got["momentum"] - 0.7) < 0.3


def test_the_variance_shares_and_volatilities_add_up_and_the_beta_alone_is_cov_over_var():
    days = fex_weekdays_ending("2031-06-02", 300)
    series, stock = fex_market(days)
    dates, y, f, keys = C.align(stock, series, C.legs_of(ALL_LEGS))
    block, _raw = C.fit(dates, y, f, keys)
    assert abs(block["explained_pct"] + block["own_pct"] - 100.0) < 0.11
    v = block["volatility"]
    total = float(np.std(y, ddof=1)) * 252 ** 0.5 * 100
    assert abs(v["total_pct"] - total) <= 0.05 + 1e-9
    coef, *_rest = _textbook(y, f)
    fitted = np.column_stack((np.ones(len(y)), f)) @ coef
    fac, own = (float(np.std(z, ddof=1)) * 252 ** 0.5 * 100 for z in (fitted, y - fitted))
    assert abs(v["factors_pct"] - fac) <= 0.05 + 1e-9 and abs(v["own_pct"] - own) <= 0.05 + 1e-9
    # fitted and residual parts are uncorrelated in OLS with a constant: their variances add up
    assert abs(fac ** 2 + own ** 2 - total ** 2) < 1e-6
    m = f[:, 0]
    assert abs(block["market_beta_alone"] - float(np.cov(y, m, ddof=1)[0, 1] / np.var(m, ddof=1))) <= 0.0005 + 1e-9


def test_each_vif_is_one_over_one_minus_the_r_squared_of_that_factor_on_the_others():
    days = fex_weekdays_ending("2031-06-02", 300)
    series, stock = fex_market(days)
    dates, y, f, keys = C.align(stock, series, C.legs_of(ALL_LEGS))
    block, _raw = C.fit(dates, y, f, keys)
    for j, key in enumerate(keys):
        others = np.delete(f, j, axis=1)
        *_rest, r2_j, _adj = _textbook(f[:, j], others)
        assert abs(block["loadings"][j]["vif"] - 1.0 / (1.0 - r2_j)) < 0.006, key
    top = max(block["loadings"], key=lambda r: r["vif"])
    assert block["max_vif"] == {"key": top["key"], "value": top["vif"]} and block["unstable"] is False


def test_collinear_spreads_are_flagged_unstable_above_a_vif_of_5():
    rng = random.Random(9)
    n = 260
    a = np.array([rng.gauss(0, 0.01) for _ in range(n)])
    b = a + np.array([rng.gauss(0, 0.002) for _ in range(n)])          # nearly the same spread
    c = np.array([rng.gauss(0, 0.01) for _ in range(n)])
    y = 0.8 * a + 0.5 * c + np.array([rng.gauss(0, 0.01) for _ in range(n)])
    f = np.column_stack((c, a, b))
    block, _raw = C.fit([f"2031-01-{i:03d}" for i in range(n)], y, f, ["market", "momentum", "quality"])
    assert block["state"] == "ok" and block["unstable"] is True
    assert block["max_vif"]["value"] > C.VIF_UNSTABLE and block["max_vif"]["key"] in ("momentum", "quality")
    # the same without the near copy is stable
    calm, _ = C.fit([f"2031-01-{i:03d}" for i in range(n)], y, f[:, :2], ["market", "momentum"])
    assert calm["unstable"] is False and calm["max_vif"]["value"] < 1.2


def test_a_singular_design_is_refused_and_an_exact_fit_gives_no_t():
    rng = random.Random(4)
    n = 230
    a = np.array([rng.gauss(0, 0.01) for _ in range(n)])
    y = 1.1 * a + np.array([rng.gauss(0, 0.01) for _ in range(n)])
    dup, _ = C.fit([str(i) for i in range(n)], y, np.column_stack((a, a)), ["market", "size"])
    assert dup == {"state": "singular", "returns": n, "from": "0", "to": str(n - 1)}
    flat, _ = C.fit([str(i) for i in range(n)], y, np.column_stack((a, np.full(n, 0.001))), ["market", "size"])
    assert flat["state"] == "singular"
    exact, raw = C.fit([str(i) for i in range(n)], 1.0 * a, a.reshape(n, 1), ["market"])
    assert exact["state"] == "ok" and exact["exact"] is True and raw is None
    assert exact["loadings"][0]["t"] is None and exact["loadings"][0]["clears"] is False
    assert C.reading("SPY", exact)["text"].startswith("SPY moves exactly with the factor funds")


def test_fewer_than_200_common_returns_is_words_and_200_is_a_short_window():
    days = fex_weekdays_ending("2031-06-02", 200)
    series, stock = fex_market(days)
    got = C.exposure(stock, series, C.legs_of(ALL_LEGS), "ZZQA")
    assert got["common_returns"] == 199
    assert got["now"] == {"state": "short", "needed": 200, "held": 199, "unit": "returns"}
    assert got["reading"] is None and got["change"] is None
    series, stock = fex_market(fex_weekdays_ending("2031-06-02", 201))
    got = C.exposure(stock, series, C.legs_of(ALL_LEGS), "ZZQA")
    assert got["now"]["state"] == "ok" and got["now"]["returns"] == 200 and got["now"]["full"] is False
    assert got["then"] == {"state": "short", "needed": 200, "held": 0, "unit": "returns"}


def test_a_year_earlier_is_the_252_returns_before_the_newest_252_and_never_overlaps():
    days = fex_weekdays_ending("2031-06-02", 520)
    series, stock = fex_market(days)
    got = C.exposure(stock, series, C.legs_of(ALL_LEGS), "ZZQA")
    assert got["common_returns"] == 519
    now, then = got["now"], got["then"]
    assert now["returns"] == 252 and now["from"] == days[-252] and now["to"] == days[-1]
    assert then["returns"] == 252 and then["to"] == days[-253] and then["from"] == days[-504]
    assert then["to"] < now["from"]
    s400, st400 = fex_market(fex_weekdays_ending("2031-06-02", 400))
    short = C.exposure(st400, s400, C.legs_of(ALL_LEGS), "ZZQA")
    assert short["then"] == {"state": "short", "needed": 200, "held": 147, "unit": "returns"}


def test_the_change_is_now_minus_then_over_the_root_sum_of_both_squared_errors():
    now_raw = {"market": (1.40, 0.05), "size": (0.10, 0.20)}
    then_raw = {"market": (1.00, 0.10), "size": (0.20, 0.10)}
    got = C.changes(now_raw, then_raw)
    assert got[0] == {"key": "market", "change": 0.4, "t": round(0.4 / (0.0125 ** 0.5), 2), "clears": True}
    assert got[1]["change"] == -0.1 and got[1]["clears"] is False
    assert C.changes(None, then_raw) is None and C.changes(now_raw, None) is None


def test_the_alignment_spans_a_missing_day_and_never_makes_a_zero_return():
    days = fex_weekdays_ending("2031-06-02", 260)
    series, stock = fex_market(days)
    gone = days[100]
    series["MTUM"] = [(d, c) for d, c in series["MTUM"] if d != gone]   # one fund misses a session
    stock = [(d, c) for d, c in stock if d != days[150]]                 # and the stock another
    dates, y, f, keys = C.align(stock, series, C.legs_of(ALL_LEGS))
    assert gone not in dates and days[150] not in dates and len(dates) == 257
    i = dates.index(days[101])
    s = dict(stock)
    assert abs(y[i] - (s[days[101]] / s[days[99]] - 1.0)) < 1e-12     # spans the two common sessions
    m = dict(series["SPY"])
    assert abs(f[i, 0] - (m[days[101]] / m[days[99]] - 1.0)) < 1e-12
    # STAT's alignment, by itself, on the same common sessions gives the same returns
    common = set(dates) | {days[0]}
    ref = BETA.aligned_returns([(d, c) for d, c in stock if d in common], [(d, c) for d, c in series["SPY"] if d in common])
    assert [d for d, _a, _b in ref] == dates


def test_the_spreads_are_each_fund_less_the_market_fund_in_use_and_iwf_less_iwd():
    days = fex_weekdays_ending("2031-06-02", 30)
    series, stock = fex_market(days, alt=True)
    dates, _y, f, keys = C.align(stock, series, C.legs_of(ALL_LEGS))
    ret = {s: dict((d, c) for d, c in v) for s, v in series.items()}
    d1, d0 = dates[5], dates[4]
    r = {s: ret[s][d1] / ret[s][d0] - 1.0 for s in ret}
    assert abs(f[5, keys.index("size")] - (r["IWM"] - r["SPY"])) < 1e-12
    assert abs(f[5, keys.index("growth")] - (r["IWF"] - r["IWD"])) < 1e-12
    assert abs(f[5, keys.index("lowvol")] - (r["USMV"] - r["SPY"])) < 1e-12
    legs = C.legs_of({"market": ("IVV",), "size": ("IWM",), "growth": ("VUG", "VTV")})
    assert legs == [("market", "IVV", None), ("size", "IWM", "IVV"), ("growth", "VUG", "VTV")]
    assert C.legs_of({"size": ("IWM",)}) is None


# ── the plain line ─────────────────────────────────────────────────────────────────────────────

def test_the_bar_is_a_t_strictly_above_2_either_way_and_a_missing_t_never_clears():
    assert C.clears(2.0001) and C.clears(-2.0001) and C.clears(14.7)
    assert not C.clears(2.0) and not C.clears(-2.0) and not C.clears(1.99)
    assert not C.clears(None) and not C.clears(float("nan")) and not C.clears(float("inf"))
    assert C.market_side(1.2, 2.0, 9.0) is None and C.market_side(1.2, 2.01, 2.0) == "same"
    assert C.market_side(1.2, 9.0, 2.01) == "more" and C.market_side(0.6, 9.0, -2.01) == "less"


def _fex_block(rows, exact=False):
    out = []
    for key, b, t, t1 in rows:
        row = {"key": key, "loading": b, "t": t, "clears": C.clears(t)}
        if key == "market":
            row["t_vs_one"] = t1
            row["side"] = C.market_side(b, t, t1)
        out.append(row)
    return {"state": "ok", "loadings": out, "exact": exact}


def test_the_plain_line_uses_only_loadings_with_t_above_2_in_a_fixed_order():
    block = _fex_block([("market", 1.4, 20.0, 5.0), ("size", 0.3, 2.01, None), ("growth", 0.6, 4.5, None),
                        ("momentum", 0.5, 3.0, None), ("quality", -0.4, -1.99, None), ("lowvol", -0.3, -2.4, None)])
    got = C.reading("ZZQA", block)
    assert got["text"] == ("ZZQA trades like a high-momentum, high-volatility small-cap growth stock "
                           "with more market sensitivity than the S&P 500.")
    assert [b["key"] for b in got["basis"]] == ["market", "size", "growth", "momentum", "lowvol"]
    assert got["uncertain"] == ["quality"]
    # exactly 2 is not above 2
    block = _fex_block([("market", 1.0, 30.0, 0.3), ("size", -0.5, -2.0, None), ("growth", -0.7, -6.0, None)])
    got = C.reading("ZZQA", block)
    assert got["text"] == "ZZQA trades like a value stock with about the S&P 500's market sensitivity."
    assert got["uncertain"] == ["size"]


def test_the_market_words_follow_its_t_against_1_and_nothing_clearing_says_so():
    cases = [
        ([("market", 0.6, 9.0, -6.0), ("size", -0.4, -3.0, None)], "ZZQA trades like a large-cap stock with less market sensitivity than the S&P 500."),
        ([("market", 1.2, 9.0, 1.5)], "ZZQA shows no style tilt that clears the bar; it trades with about the S&P 500's market sensitivity."),
        ([("market", -0.5, -3.0, -9.0), ("quality", 0.4, 2.5, None)], "ZZQA trades like a high-quality stock that tends to move against the S&P 500."),
        ([("market", 0.1, 0.5, -9.0), ("momentum", -0.6, -2.6, None)], "ZZQA trades like a low-momentum stock; its market loading does not clear the bar."),
        ([("market", 0.1, 0.5, -9.0), ("size", 0.2, 1.0, None)], "No loading clears the bar, so the factors cannot say how ZZQA trades."),
        ([("market", 2.0, 12.0, 6.0)], "ZZQA shows no style tilt that clears the bar; it trades with more market sensitivity than the S&P 500."),
    ]
    for rows, text in cases:
        assert C.reading("ZZQA", _fex_block(rows))["text"] == text
    assert C.reading("ZZQA", {"state": "short", "needed": 200, "held": 10}) is None


# ── the funds ──────────────────────────────────────────────────────────────────────────────────

def test_a_fund_is_usable_with_201_closes_the_newest_within_10_days_of_the_session():
    key = "2031-06-02"
    closes = [(d, 100.0) for d in fex_weekdays_ending(key, 201)]
    assert C.fund_check(closes, key)["state"] == "ok"
    assert C.fund_check(closes[1:], key) == {"state": "short", "needed": 201, "closes": 200, "first": closes[1][0],
                                             "last": key, "full": False}
    lag10 = [(d, 100.0) for d in fex_weekdays_ending("2031-05-23", 300)]          # 10 calendar days before
    lag11 = [(d, 100.0) for d in fex_weekdays_ending("2031-05-22", 300)]
    assert C.fund_check(lag10, key)["state"] == "ok" and C.fund_check(lag11, key)["state"] == "stale"
    assert C.fund_check([], key) == {"state": "not_held", "closes": 0}
    assert C.fund_check([], key, "not_held")["state"] == "not_held"
    assert C.fund_check(closes, key, "unavailable") == {"state": "unavailable", "closes": 0}
    assert C.fund_check([(d, 1.0) for d in fex_weekdays_ending(key, 505)], key)["full"] is True


def _fex_world(monkeypatch, *, key="2031-06-02", drop=(), alt=True, reads=None, n=600, stock_end=None):
    days = fex_weekdays_ending("2031-06-03", n)
    series, stock = fex_market(days, alt=alt)
    if stock_end:
        stock = [(d, c) for d, c in stock if d <= stock_end]
    reads = reads if reads is not None else []
    held = {**series, "ZZQA": stock, "ZZQB": stock, "ZZQC": stock}

    def read_bars(sym):
        reads.append(sym)
        if sym in drop or sym not in held:
            return {"status": "unavailable", "reason": "no_price_history", "symbol": sym}
        rows = held[sym][-V.READ_SESSIONS:]
        return {"status": "ok", "symbol": sym, "closes": list(rows), "suspect_jumps": []}

    monkeypatch.setattr(V, "_read_bars", read_bars)
    monkeypatch.setattr(V, "session_key", lambda now: key)
    monkeypatch.setattr(V, "now_et", lambda: datetime(2031, 6, 3, 12, 0))
    return {"reads": reads, "days": days, "held": held}


def test_the_funds_are_read_once_per_session_for_every_member_and_alternatives_only_when_needed(monkeypatch):
    w = _fex_world(monkeypatch)
    a = V.get_factor_exposure("ZZQA")
    V.get_factor_exposure("ZZQB")
    assert a["status"] == "ok"
    assert w["reads"] == list(PRIMARY) + ["ZZQA", "ZZQB"]
    assert [f["state"] for f in a["factors"]] == ["ok"] * 6
    assert a["factors"][1]["funds"] == ["IWM", "SPY"] and a["factors"][2]["funds"] == ["IWF", "IWD"]
    assert {c["symbol"] for c in a["fund_checks"]} == set(PRIMARY)
    monkeypatch.setattr(V, "session_key", lambda now: "2031-06-03")
    V.get_factor_exposure("ZZQA")
    assert w["reads"][-8:] == list(PRIMARY) + ["ZZQA"]


def test_a_missing_fund_is_replaced_by_its_alternative_a_pair_together_and_said(monkeypatch):
    w = _fex_world(monkeypatch, drop=("IWD", "MTUM", "SPMO"))
    a = V.get_factor_exposure("ZZQA")
    by = {f["key"]: f for f in a["factors"]}
    assert by["growth"]["state"] == "substituted" and by["growth"]["funds"] == ["VUG", "VTV"]
    assert by["momentum"]["state"] == "dropped" and by["momentum"]["funds"] is None
    assert by["market"]["state"] == "ok"
    assert [r["key"] for r in a["now"]["loadings"]] == ["market", "size", "growth", "quality", "lowvol"]
    assert "IWF" in w["reads"] and "VUG" in w["reads"] and "VTV" in w["reads"] and "SPMO" in w["reads"]
    checks = {c["symbol"]: c["state"] for c in a["fund_checks"]}
    assert checks["IWD"] == "not_held" and checks["IWF"] == "ok" and checks["SPMO"] == "not_held"
    assert "IVV" not in w["reads"]


def test_no_market_fund_is_words_never_held_and_the_set_is_looked_at_again(monkeypatch):
    w = _fex_world(monkeypatch, drop=("SPY", "IVV"))
    a = V.get_factor_exposure("ZZQA")
    assert a == {"status": "unavailable", "symbol": "ZZQA", "reason": "no_market_fund",
                 "detail": "The market fund (SPY or IVV) is not held on this server just now, so no factor exposure can be worked out."}
    assert "ZZQA" not in V._cache and "ZZQA" not in w["reads"]
    n = len(w["reads"])
    V.get_factor_exposure("ZZQA")
    assert len(w["reads"]) == n                                   # the fund set is not read again at once
    V._funds["held"]["recheck_at"] = time.time() - 1
    V.get_factor_exposure("ZZQA")
    assert len(w["reads"]) > n


def test_an_answer_follows_the_fund_set_only_when_what_it_holds_changed(monkeypatch):
    w = _fex_world(monkeypatch, drop=("SPHQ", "QUAL"))
    a1 = V.get_factor_exposure("ZZQA")
    assert {f["key"]: f["state"] for f in a1["factors"]}["quality"] == "dropped"
    assert V._funds["held"]["recheck_at"] is not None
    V._funds["held"]["recheck_at"] = time.time() - 1             # the set is read again, unchanged
    assert V.get_factor_exposure("ZZQA") is a1
    assert w["reads"].count("ZZQA") == 1
    w["held"]["QUAL"] = w["held"]["SPHQ"]                         # now a quality fund is held
    monkeypatch.setattr(V, "_read_bars", _fex_unblocked(V._read_bars, "QUAL", w["held"]))
    V._funds["held"]["recheck_at"] = time.time() - 1
    a3 = V.get_factor_exposure("ZZQA")
    assert a3 is not a1 and {f["key"]: f["state"] for f in a3["factors"]}["quality"] == "ok"


def _fex_unblocked(inner, sym, held):
    def read(s):
        if s == sym:
            return {"status": "ok", "symbol": s, "closes": list(held[s][-V.READ_SESSIONS:]), "suspect_jumps": []}
        return inner(s)
    return read


# ── the reads and the held answers ─────────────────────────────────────────────────────────────

def test_the_read_is_the_bounded_stat_read_of_the_newest_rows(monkeypatch):
    from api.services.market_intel import price_reads
    seen = []
    monkeypatch.setattr(price_reads, "daily_bars", lambda sym, max_bars=None: seen.append((sym, max_bars)) or {"status": "ok"})
    V._read_bars("ZZQA")
    assert seen == [("ZZQA", V.READ_SESSIONS)] and V.READ_SESSIONS == 2 * 252 + 60


def test_only_closes_up_to_the_session_count_and_the_answer_says_where_it_comes_from(monkeypatch):
    w = _fex_world(monkeypatch)
    a = V.get_factor_exposure("ZZQA")
    assert w["days"][-1] == "2031-06-03"                             # the store held a bar for the next day
    assert a["data_through"] == "2031-06-02" and a["session"] == "2031-06-02"
    assert a["now"]["to"] == "2031-06-02" and a["now"]["returns"] == 252 and a["then"]["returns"] == 252
    assert a["sessions_read"] == V.READ_SESSIONS - 1 and a["source"] == V.SOURCE and "split-adjusted" in a["basis"]
    assert a["method"]["window"] == 252 and a["method"]["min"] == 200 and a["method"]["t_bar"] == 2.0
    assert a["reading"]["text"].startswith("ZZQA trades like a high-momentum")


def test_the_answer_is_held_per_symbol_per_session_and_a_lagging_stock_is_read_again_later(monkeypatch):
    w = _fex_world(monkeypatch, stock_end="2031-05-28")
    a1 = V.get_factor_exposure("ZZQA")
    assert a1["data_through"] == "2031-05-28"
    assert V.get_factor_exposure("ZZQA") is a1 and w["reads"].count("ZZQA") == 1
    entry = V._cache["ZZQA"]
    assert abs(entry["recheck_at"] - (entry["at"] + V.LAG_RECHECK_S)) < 1e-6
    entry["recheck_at"] = time.time() - 1
    V.get_factor_exposure("ZZQA")
    assert w["reads"].count("ZZQA") == 2


def test_a_failed_read_is_never_held_and_nothing_stored_is_not_held_in_words(monkeypatch):
    w = _fex_world(monkeypatch)
    inner = V._read_bars
    monkeypatch.setattr(V, "_read_bars", lambda s: {"status": "unavailable", "reason": "read_failed"} if s == "ZZQA" else inner(s))
    assert V.get_factor_exposure("ZZQA")["status"] == "unavailable"
    assert V.get_factor_exposure("ZZQA")["status"] == "unavailable"
    assert "ZZQA" not in V._cache
    assert V.get_factor_exposure("ZZQX") == {"status": "not_held", "symbol": "ZZQX", "detail": "UCT holds no daily prices for ZZQX."}
    monkeypatch.setattr(V, "_read_bars", lambda s: (_ for _ in ()).throw(RuntimeError("boom")) if s == "ZZQC" else inner(s))
    got = V.get_factor_exposure("ZZQC")
    assert got["status"] == "unavailable" and got["reason"] == "failed" and "ZZQC" not in V._cache
    assert w["reads"].count("SPY") == 1


def test_the_held_answers_are_capped_least_recently_asked_first(monkeypatch):
    w = _fex_world(monkeypatch)
    monkeypatch.setattr(V, "CACHE_MAX", 2)
    for s in ("ZZQA", "ZZQB", "ZZQA", "ZZQC", "ZZQA", "ZZQB"):
        V.get_factor_exposure(s)
    assert [r for r in w["reads"] if r.startswith("ZZQ")] == ["ZZQA", "ZZQB", "ZZQC", "ZZQB"]


def test_one_build_per_symbol_at_a_time_and_a_bounded_number_of_symbols(monkeypatch):
    w = _fex_world(monkeypatch)
    V.fund_set("2031-06-02")
    gate, started = threading.Event(), threading.Event()
    slow_reads = []
    real = V._read_bars

    def slow(sym):
        slow_reads.append(sym)
        started.set()
        gate.wait(5)
        return real(sym)

    monkeypatch.setattr(V, "_read_bars", slow)
    out = []
    t1 = threading.Thread(target=lambda: out.append(V.get_factor_exposure("ZZQA")))
    t1.start()
    started.wait(5)
    t2 = threading.Thread(target=lambda: out.append(V.get_factor_exposure("ZZQA")))
    t2.start()
    time.sleep(0.2)
    gate.set()
    t1.join(5)
    t2.join(5)
    assert slow_reads == ["ZZQA"] and len(out) == 2 and out[0] is out[1]
    monkeypatch.setattr(V, "BUILD_WAIT_S", 0.05)
    for _ in range(V.BUILD_SLOTS):
        V._slots.acquire()
    try:
        assert V.get_factor_exposure("ZZQZ")["status"] == "busy"
    finally:
        for _ in range(V.BUILD_SLOTS):
            V._slots.release()
    assert "ZZQZ" not in w["reads"]


def test_a_move_over_40_percent_inside_a_window_is_listed_to_check(monkeypatch):
    w = _fex_world(monkeypatch)
    inner = V._read_bars
    jump = w["days"][-10]

    def read(s):
        got = inner(s)
        return {**got, "suspect_jumps": [jump, "2031-06-03"]} if s == "ZZQA" else got

    monkeypatch.setattr(V, "_read_bars", read)
    a = V.get_factor_exposure("ZZQA")
    assert a["now"]["check"] == [jump] and a["then"]["check"] == []


def test_a_fund_asked_for_as_a_stock_is_an_exact_fit_with_no_reading_of_its_loadings(monkeypatch):
    _fex_world(monkeypatch)
    a = V.get_factor_exposure("SPY")
    assert a["status"] == "ok" and a["now"]["exact"] is True
    assert a["reading"]["text"].startswith("SPY moves exactly with the factor funds")
    assert all(r["t"] is None for r in a["now"]["loadings"]) and a["change"] is None


# ── the route ──────────────────────────────────────────────────────────────────────────────────

def _fex_client(user):
    app = FastAPI()
    app.include_router(fex_route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_fex_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(V, "get_factor_exposure", lambda sym: asked.append(sym) or {"status": "ok", "symbol": sym})
    (r,) = fex_route.router.routes
    assert r.path == "/api/research/factor-exposure/{ticker}" and r.methods == {"GET"}
    assert fex_route.require_paid in {d.call for d in r.dependant.dependencies}
    assert fex_route.require_paid.__module__ == "api.routers.factor_exposure"
    assert _fex_client(None).get("/api/research/factor-exposure/NVDA").status_code == 401
    refused = _fex_client(FREE).get("/api/research/factor-exposure/NVDA")
    assert refused.status_code == 402 and refused.json() == {"detail": "Factor exposure requires a paid plan"}
    assert asked == []
    assert _fex_client(PAID).get("/api/research/factor-exposure/nvda").json() == {"status": "ok", "symbol": "NVDA"}
    assert _fex_client(PAID).get("/api/research/factor-exposure/$$$").status_code == 400
    assert asked == ["NVDA"]


def test_the_fex_handler_is_a_plain_def_and_the_route_is_mounted():
    import inspect
    assert not inspect.iscoroutinefunction(fex_route.get_factor_exposure)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import factor_exposure as factor_exposure_router" in main
    assert "app.include_router(factor_exposure_router.router)" in main
