"""Rails for the UCT RS Phase 2a VISUAL round, unit VA1 (server side,
2026-11-06): spec items A1 (server half), A2 (server half) and A8 (server half)
of `phase2a-visual-spec.md`, against the shared contract's fixed names.

* A1 — every summary string the readout prints verbatim: ``rating.summary``,
  ``legend.summary``, ``mansfield.summary``, ``lastRsHigh.summary``, the
  rewritten ``sensitivity.summary`` and ``checks.summary``, and a per-check
  ``line``. The copy fixes: ``today`` / ``1 bar ago`` / ``n bars ago`` (never
  "1 bars"), the anchor check no longer opening with its label's words, the
  green-on-red window wording, pivot speed without "of the range",
  ``rebound risk`` in words.
* A2 — Mansfield view: the wire blanks ``rsLine``, ``rsMa``, ``rsAbove`` and
  every RS-line dot to all-null (still in ``columns``), the readout scalars are
  read before that, and ``dotMansfieldCross`` carries crosses UP only, at 0.
* A8 — ``legend.asOf`` / ``legend.lastValue`` at the last bar with a finite RS
  value, so a benchmark gap on the newest bar never blanks the reading.

The fixtures and helpers are the provider suite's own, imported rather than
retyped, so its hermetic reads (no industry map, no rating table, an empty
evidence dir) hold here too.
"""
from __future__ import annotations

import datetime as _dt
import re

import pytest

from api.routers import signature as sig
from api.services.signature import rs_provider as rsp
from api.services import relative_strength as rsmod
from api.services import rs_benchmarks as rb
from api.services.screener import rs_history
from api.services.signature import registry_defs as rd
from tests.test_rs_columns_provider import (  # noqa: F401 - fixtures are used by name
    V3_COLUMNS, _bars, _fetcher, _hermetic_reads, _long_daily, _no_cache, v2_row,
)

ONE_BARS = re.compile(r"\b1 (bars|sessions|red days)\b")


def _dated(series, start=_dt.date(2024, 1, 1)):
    """The same bars with YYYYMMDD keys (the store's daily encoding), so an
    ``asOf`` can be read as a real date."""
    out = []
    for i, b in enumerate(series):
        d = start + _dt.timedelta(days=i)
        out.append({**b, "t": int(d.strftime("%Y%m%d"))})
    return out


def _strings(obj, path=""):
    """Every string in a payload, with its path."""
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _strings(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from _strings(v, f"{path}[{i}]")


def _rated(monkeypatch, ibd=94, fast=91):
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {
        "NVDA": {"ibd": ibd, "fast": fast, "asof": "2026-11-05", "d5": 2, "d20": 7}})


def _long_payload(monkeypatch, inputs=None, groups=None):
    store = _long_daily()
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    monkeypatch.setattr(rb, "_groups_for", lambda s: groups or {"sector": "Technology", "industry": "Semiconductors"})
    return sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY", **(inputs or {})})


# ── the number and plural rules ────────────────────────────────────────────

def test_bars_ago_and_plural_follow_the_readout_rule():
    assert rsp._rs_ago(0) == "today"
    assert rsp._rs_ago(1) == "1 bar ago"
    assert rsp._rs_ago(2) == "2 bars ago" and rsp._rs_ago(38) == "38 bars ago"
    assert rsp._rs_plural(1, "bar") == "1 bar" and rsp._rs_plural(2, "bar") == "2 bars"
    assert rsp._rs_plural(0, "bar") == "0 bars" and rsp._rs_plural(1, "red day") == "1 red day"


def test_percent_copy_matches_the_client_pct_format():
    assert rsp._rs_pct(18.66) == "+18.7%"
    assert rsp._rs_pct(-3.24) == "-3.2%"
    assert rsp._rs_pct(0.04) == "0.0%" and rsp._rs_pct(-0.04) == "0.0%", "never -0.0% or +0.0%"
    assert rsp._rs_pct(0.0) == "0.0%"


def test_short_date_and_ymd():
    assert rsp._rs_bar_ymd(20261104) == "20261104"
    assert rsp._rs_short_date("20261104") == "Nov 4" and rsp._rs_short_date("20260105") == "Jan 5"
    assert rsp._rs_short_date(None) is None and rsp._rs_bar_ymd(None) is None


# ── rating.summary ─────────────────────────────────────────────────────────

def test_rating_summary_patterns():
    assert rsp._rs_rating_summary(94, 91) == "94 · fast 91"
    assert rsp._rs_rating_summary(None, 91) == "fast 91 · nightly pending"
    assert rsp._rs_rating_summary(94, None) == "94"
    assert rsp._rs_rating_summary(None, None) is None


def test_rating_summary_rides_the_rating_block(monkeypatch):
    _rated(monkeypatch)
    assert rsp._rs_rating("NVDA")["summary"] == "94 · fast 91"
    _rated(monkeypatch, ibd=None, fast=88)
    assert rsp._rs_rating("NVDA")["summary"] == "fast 88 · nightly pending"
    monkeypatch.setattr(rs_history, "read_fields", lambda tickers, **kw: {})
    assert rsp._rs_rating("NVDA")["summary"] is None, "no rating ⇒ null, the row prints its muted fallback"


# ── legend.summary / asOf / lastValue (A1, A8) ─────────────────────────────

def test_legend_summary_words_and_the_instance_average():
    p = {"maLength": 21, "maType": "EMA"}
    times = [20261103, 20261104]
    leg = rsp._rs_legend({"pctFromMa": 6.81, "maSlope": 1, "above": True, "index": 1, "lastValue": 0.5207}, times, p)
    assert leg["summary"] == "above its 21 EMA by 6.8%"
    assert leg["asOf"] == "20261104" and leg["stale"] is False and leg["lastValue"] == 0.5207
    leg = rsp._rs_legend({"pctFromMa": -2.08, "maSlope": -1, "above": False, "index": 1, "lastValue": 0.4},
                         times, {"maLength": 50, "maType": "sma"})
    assert leg["summary"] == "below its 50 SMA by 2.1%"
    leg = rsp._rs_legend({"pctFromMa": 0.03, "maSlope": 0, "above": True, "index": 1, "lastValue": 0.4}, times, p)
    assert leg["summary"] == "at its 21 EMA"
    leg = rsp._rs_legend({"pctFromMa": -0.04, "maSlope": 0, "above": False, "index": 1, "lastValue": 0.4}, times, p)
    assert leg["summary"] == "at its 21 EMA", "a sub-0.05% gap reads 'at', never 'below ... by 0.0%'"
    # stale: the reading is from the bar before the newest one
    leg = rsp._rs_legend({"pctFromMa": 6.81, "maSlope": 1, "above": True, "index": 0, "lastValue": 0.47}, times, p)
    assert leg["stale"] is True and leg["asOf"] == "20261103"
    assert leg["summary"] == "above its 21 EMA by 6.8% · as of Nov 3"
    # nothing to read
    leg = rsp._rs_legend({"pctFromMa": None, "maSlope": None, "above": None, "index": None, "lastValue": None}, times, p)
    assert leg["summary"] is None and leg["asOf"] is None and leg["stale"] is False


def test_legend_scalars_read_the_last_bar_with_a_finite_ratio():
    """A8 in the compute module: a normal chart reads the last bar exactly as
    before; a gap on the newest bar reads the bar before it instead of going
    blank, and names it."""
    full = {"rsLine": [1.0, 1.1, 1.2, 1.26], "rsMa": [None, None, 1.1, 1.2]}
    leg = rsmod.legend_scalars(full)
    assert leg["pctFromMa"] == pytest.approx(5.0) and leg["above"] is True and leg["maSlope"] == 1
    assert leg["index"] == 3 and leg["lastValue"] == 1.26
    gap = {"rsLine": [1.0, 1.1, 1.2, 1.26, None], "rsMa": [None, None, 1.1, 1.2, None]}
    leg = rsmod.legend_scalars(gap)
    assert leg["index"] == 3 and leg["lastValue"] == 1.26
    assert leg["pctFromMa"] == pytest.approx(5.0) and leg["above"] is True and leg["maSlope"] == 1
    none = {"rsLine": [None, None], "rsMa": [None, None]}
    assert rsmod.legend_scalars(none) == {"pctFromMa": None, "maSlope": None, "above": None,
                                          "index": None, "lastValue": None}
    assert rsmod.legend_scalars({}) == {"pctFromMa": None, "maSlope": None, "above": None,
                                        "index": None, "lastValue": None}


def test_a_benchmark_gap_on_the_newest_bar_keeps_the_reading_with_its_date(v2_row, monkeypatch):
    """A8 end to end: the benchmark has no bar for the stock's newest session."""
    store = _long_daily(n=400)
    store = {k: _dated(v) for k, v in store.items()}
    last_t = store["NVDA"][-1]["t"]
    gapped = dict(store, SPY=store["SPY"][:-1])
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(gapped))
    _no_cache(monkeypatch)
    env = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})
    rs = env["columns"]["rsLine"]
    assert rs[-1] is None and rs[-2] is not None, "the fixture is a gap on the newest bar"
    leg = env["payload"]["legend"]
    prev = str(store["NVDA"][-2]["t"])
    assert leg["asOf"] == prev and leg["asOf"] != str(last_t)
    assert leg["lastValue"] == rs[-2] and leg["stale"] is True
    assert leg["above"] is not None and leg["pctFromMa"] is not None, "the reading no longer goes blank"
    assert leg["summary"].endswith(f" · as of {rsp._rs_short_date(prev)}"), leg["summary"]
    # control: the same chart with the benchmark complete is current, no date
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    leg = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]["legend"]
    assert leg["asOf"] == str(last_t) and leg["stale"] is False and "as of" not in (leg["summary"] or "")
    assert re.fullmatch(r"(above|below) its 21 EMA by \d+\.\d%|at its 21 EMA", leg["summary"]), leg["summary"]


# ── mansfield.summary ──────────────────────────────────────────────────────

def _mans(values, up=None, down=None):
    n = len(values)
    return {"mansfield": values, "mansfieldState": [0] * n,
            "mansfieldCrossUp": up or [0.0] * n, "mansfieldCrossDown": down or [0.0] * n,
            "mansfieldCrossBarsAgo": [None] * n}


def test_mansfield_summary_spells_out_sign_and_slope():
    n = 60
    vals = [None] * (n - 2) + [19.0, 18.66]
    up = [0.0] * n
    up[n - 1 - 57] = 1.0
    m = rsp._rs_mansfield_scalars(_mans(vals, up=up), 200)
    assert m["summary"] == "+18.7%, above zero, falling"
    assert m["slope"] == -1 and m["crossDirection"] == "up" and m["lastCross"] == "up, 57 bars ago"
    assert m["stateLabel"] == "neutral", "the old field stays for its readers"
    down = [0.0] * n
    down[n - 1] = 1.0
    m = rsp._rs_mansfield_scalars(_mans([None] * (n - 2) + [-4.0, -3.2], down=down), 200)
    assert m["summary"] == "-3.2%, below zero, rising" and m["lastCross"] == "down, today"
    down = [0.0] * n
    down[n - 2] = 1.0
    assert rsp._rs_mansfield_scalars(_mans([None] * (n - 2) + [-4.0, -3.2], down=down), 200)["lastCross"] == \
        "down, 1 bar ago"
    m = rsp._rs_mansfield_scalars(_mans([None] * (n - 2) + [2.0, 0.01]), 200)
    assert m["summary"] == "0.0%, at zero, falling" and m["lastCross"] is None
    m = rsp._rs_mansfield_scalars(_mans([None] * (n - 1) + [5.0]), 200)
    assert m["summary"] == "+5.0%, above zero", "no slope word without a previous value"
    assert rsp._rs_mansfield_scalars(_mans([None] * n), 200)["summary"] is None


# ── lastRsHigh.summary ─────────────────────────────────────────────────────

def _high(ago, bp=False, red=False):
    return {"index": 300 - ago, "time": 1, "beforePrice": bp, "redDay": red, "barsAgo": ago}


def test_last_rs_high_summary_patterns():
    f = rsp._rs_last_high
    assert f(_high(0, bp=True), 252, 852, intraday=False, why=None)["summary"] == "today · before price"
    assert f(_high(1, bp=True, red=True), 252, 852, intraday=False, why=None)["summary"] == \
        "1 bar ago · before price · red day"
    assert f(_high(38), 252, 852, intraday=False, why=None)["summary"] == "38 bars ago"
    assert f(_high(2, red=True), 252, 852, intraday=False, why=None)["summary"] == "2 bars ago · red day"
    none = f(None, 252, 852, intraday=False, why=None)
    assert none["summary"] == "none in the last 252 bars"
    assert none["barsAgo"] is None and none["beforePrice"] is None, "always a block, null fields when no high"
    assert f(None, 252, 180, intraday=False, why=None)["summary"] == "needs 252 bars (has 180)"
    assert f(None, 252, 400, intraday=True, why=None)["summary"] == "not read on intraday charts"
    assert f(None, 252, 400, intraday=False, why="no benchmark bars")["summary"] == "no benchmark bars"


# ── sensitivity.summary (Agreement) ────────────────────────────────────────

def _sens(stock, legs, groups=None):
    bench = {"resolved": "SPY", "bars": legs.get("SPY", [])}

    def fetch(sym, tf, count):
        return legs.get(sym, [])
    return rsp._rs_sensitivity("NVDA", stock, bench, "D", 40,
                               groups if groups is not None else {"sector": "Technology", "industry": "x"}, fetch)


def test_agreement_summary_patterns():
    stock = [{"t": 1000 + i, "c": 100.0 + i} for i in range(40)]
    flat = [{"t": 1000 + i, "c": 100.0} for i in range(40)]
    fast = [{"t": 1000 + i, "c": 100.0 * 1.05 ** i} for i in range(40)]
    out = _sens(stock, {"SPY": flat, "RSP": flat, "XLK": flat})
    assert out["summary"] == "SPY, RSP and XLK all rising"
    assert out["legs"] == {"spy": "rising", "rsp": "rising", "sector": "XLK rising"}
    out = _sens(stock, {"SPY": flat, "RSP": fast, "XLK": flat})
    assert out["summary"] == "split: SPY rising, RSP falling, XLK rising"
    out = _sens(stock, {"SPY": flat, "XLK": flat})
    assert out["summary"] == "SPY and XLK rising; RSP: no bars"
    assert out["legs"]["rsp"] == "no bars" and out["reasons"]["rsp"] == "no RSP bars", "the long reasons stay"
    out = _sens(stock, {"SPY": flat, "RSP": flat}, groups={"sector": "Financial", "industry": rb.ETF_INDUSTRY})
    assert out["summary"] == "SPY and RSP rising; sector: none for an ETF"
    assert out["legs"]["sector"] == "none for an ETF"
    gap = [b for b in flat if b["t"] != 1035]
    out = _sens(stock, {"SPY": gap, "RSP": flat, "XLK": flat})
    assert out["summary"] == "RSP and XLK rising; SPY: gap in last 20 bars"
    out = _sens(stock[:14], {"SPY": flat, "RSP": flat, "XLK": flat})
    assert out["summary"] == "SPY: needs 20 bars (has 14); RSP: needs 20 bars (has 14); XLK: needs 20 bars (has 14)"
    out = _sens(stock, {"SPY": flat, "RSP": flat}, groups={"sector": "Cryptocurrency", "industry": None})
    assert out["summary"] == "SPY and RSP rising; sector: Cryptocurrency not mapped"


def test_unavailable_sensitivity_keeps_a_null_summary_and_gains_legs():
    s = rsp._rs_sensitivity_unavailable("daily charts only")
    assert s["summary"] is None
    assert s["legs"] == {"spy": "daily charts only", "rsp": "daily charts only", "sector": "daily charts only"}


# ── checks.summary and the per-check line ──────────────────────────────────

def _check_bars(n=260, low_ago=None):
    """A stock that beats a red-every-third-day benchmark; optionally the
    benchmark's 20-session low sits ``low_ago`` bars back."""
    stock, bench = [], []
    c, b = 100.0, 400.0
    for i in range(n):
        bchg = -0.01 if i % 3 == 0 else 0.004
        b *= 1 + bchg
        c *= 1 + 2 * bchg if bchg > 0 else 1 + 0.002
        stock.append({"t": 1000 + i, "o": c * 0.99, "h": c * 1.005, "l": c * 0.985, "c": c, "v": 1})
        bench.append({"t": 1000 + i, "o": b, "h": b, "l": b, "c": b, "v": 1})
    if low_ago is not None:
        i = n - 1 - low_ago
        bench[i] = {**bench[i], "c": bench[i]["c"] * 0.5}
    return stock, bench


def test_checks_summary_and_lines():
    stock, bench = _check_bars()
    out = rsp._rs_checks(stock, bench, "SPY", -0.5)
    assert out["summary"] == "4 of 4 pass"
    for k in ("ma", "anchor", "pivotSpeed", "greenOnRed"):
        assert out[k]["line"] == f"pass · {out[k]['reason']}", k
    assert re.fullmatch(r"stock [+-]\d+\.\d% vs its 200-day, SPY [+-]?\d+\.\d%", out["ma"]["reason"]), out["ma"]["reason"]
    assert re.fullmatch(r"\d+ of the last 10 red days closed in the top third", out["pivotSpeed"]["reason"])
    assert re.fullmatch(r"up on \d+ of \d+ red days in the last 20 sessions", out["greenOnRed"]["reason"])
    flat = [{"t": 1000 + i, "o": 50.0, "h": 51.0, "l": 49.0, "c": 50.0, "v": 1} for i in range(260)]
    out = rsp._rs_checks(flat, bench, "SPY", -0.5)
    assert out["anchor"]["line"] == f"fail · {out['anchor']['reason']}"
    assert out["summary"] == f"{out['passed']} of 4 pass"


def test_the_anchor_reason_leads_with_numbers_and_says_1_bar_ago():
    stock, bench = _check_bars(low_ago=1)
    a = rsp._rs_checks(stock, bench, "QQQ", -0.5)["anchor"]
    assert a["barsAgo"] == 1
    assert re.fullmatch(r"stock [+-]?\d+\.\d%, QQQ [+-]?\d+\.\d%; low was 1 bar ago", a["reason"]), a["reason"]
    assert not a["reason"].lower().startswith("since"), "a value never opens with its label's words"
    stock, bench = _check_bars(low_ago=7)
    a = rsp._rs_checks(stock, bench, "QQQ", -0.5)["anchor"]
    assert a["reason"].endswith("; low was 7 bars ago"), a["reason"]


def test_undecided_checks_print_the_reason_alone_with_plurals():
    n = 30
    stock = _bars([100.0 + i for i in range(n)])
    bench = _bars([400.0 + i for i in range(n - 2)] + [399.0, 401.0])   # one red day, at bar 28
    out = rsp._rs_checks(stock, bench, "SPY", -0.1)
    assert out["ma"]["pass"] is None and out["ma"]["line"] == out["ma"]["reason"]
    assert out["pivotSpeed"]["reason"] == "only 1 red day in 30 bars (needs 10)"
    assert out["greenOnRed"]["reason"] == "up on 1 of 1 red day in the last 20 sessions", "the stock rose that day"
    calm = _bars([400.0 + i for i in range(n)])
    assert rsp._rs_checks(stock, calm, "SPY", -0.1)["greenOnRed"]["reason"] == "no red days in the last 20 sessions"
    blank = rsp._rs_checks_unavailable("daily charts only")
    assert all(blank[k]["line"] == "daily charts only" for k in ("ma", "anchor", "pivotSpeed", "greenOnRed"))
    assert blank["summary"] == "daily charts only"


def test_regime_label_is_words():
    calm = [100.0 * (1.0 - 0.0005) ** i for i in range(880)]
    wild = [calm[-1] * (1.0 + (0.08 if i % 2 == 0 else -0.09)) ** (i + 1) for i in range(130)]
    assert rsp._rs_regime(calm + wild)["label"] == "rebound risk"


# ── A2: Mansfield view ─────────────────────────────────────────────────────

def test_mansfield_view_blanks_the_ratio_and_its_dots_but_keeps_every_column(v2_row, monkeypatch):
    on = _long_payload(monkeypatch, {"showMansfield": True, "showRedDay": True, "showNewLow": True})
    off = _long_payload(monkeypatch, {"showMansfield": False, "showRedDay": True, "showNewLow": True})
    cols = on["columns"]
    assert set(cols) == set(V3_COLUMNS), "the exact-match column contract holds"
    n = len(on["times"])
    for k in rsp._RS_MANSFIELD_VIEW_BLANKS:
        assert len(cols[k]) == n and all(v is None for v in cols[k]), k
    assert set(rsp._RS_MANSFIELD_VIEW_BLANKS) == {"rsLine", "rsMa", "rsAbove", "dotNH", "dotNHbeforePx",
                                                 "dotNHred", "dotNHpartial", "dotNL"}
    assert any(v is not None for v in off["columns"]["rsLine"]) and any(v is not None for v in off["columns"]["rsAbove"])
    # the Mansfield line draws alone
    assert any(v is not None for v in cols["mansfield"])
    # event columns stay for the screener and alerts
    for k in ("rsNH", "rsNHbeforePx", "crossUp", "crossDown", "mansfieldCrossUp", "mansfieldCrossDown"):
        assert cols[k] == off["columns"][k], k
    # the scalars were read before the blanking: identical to the view-off read
    assert on["payload"]["legend"] == off["payload"]["legend"]
    assert on["payload"]["lastRsHigh"] == off["payload"]["lastRsHigh"]
    assert on["payload"]["legend"]["summary"] and on["payload"]["lastRsHigh"]["summary"]
    assert on["payload"]["mansfield"]["summary"]


def test_the_mansfield_dot_is_a_cross_up_at_zero(v2_row, monkeypatch):
    env = _long_payload(monkeypatch, {"showMansfield": True})
    cols = env["columns"]
    dot = cols["dotMansfieldCross"]
    ups = [i for i, v in enumerate(cols["mansfieldCrossUp"]) if v == 1.0 and cols["mansfield"][i] is not None]
    downs = [i for i, v in enumerate(cols["mansfieldCrossDown"]) if v == 1.0]
    assert ups and downs, "the series crosses both ways"
    assert [i for i, v in enumerate(dot) if v is not None] == ups
    assert all(dot[i] == 0.0 for i in ups)
    assert all(dot[i] is None for i in downs), "crosses down are not drawn"
    # the last cross in EITHER direction is still named in the readout
    last = max(ups + downs)
    m = env["payload"]["mansfield"]
    assert m["crossDirection"] == ("up" if last in ups else "down")
    assert m["lastCross"] == f"{m['crossDirection']}, {rsp._rs_ago(len(dot) - 1 - last)}"
    # off: the dot and the line are blank as before
    off = _long_payload(monkeypatch, {"showMansfield": False})
    assert all(v is None for v in off["columns"]["dotMansfieldCross"])
    assert all(v is None for v in off["columns"]["mansfield"])


def test_classic_trend_classic_round_trip_is_exact(v2_row, monkeypatch):
    """A2 acceptance 8 on the wire: Classic after Trend is a fresh Classic."""
    first = _long_payload(monkeypatch)
    _long_payload(monkeypatch, {"showMansfield": True, "mansfieldLength": 200})
    again = _long_payload(monkeypatch)
    assert first["columns"] == again["columns"]
    assert {k: v for k, v in first["payload"].items()} == {k: v for k, v in again["payload"].items()}


# ── the whole payload: patterns, plurals, paths ────────────────────────────

SUMMARY_PATHS = ("rating.summary", "legend.summary", "legend.asOf", "legend.lastValue", "mansfield.summary",
                 "lastRsHigh.summary", "sensitivity.summary", "checks.summary",
                 "checks.ma.line", "checks.anchor.line", "checks.pivotSpeed.line", "checks.greenOnRed.line")


def _walk(payload, path):
    cur = payload
    for seg in path.split("."):
        assert isinstance(cur, dict) and seg in cur, f"{path} is missing at {seg!r}"
        cur = cur[seg]
    return cur


def test_every_contract_summary_is_answered_on_a_long_daily_payload(v2_row, monkeypatch):
    _rated(monkeypatch)
    p = _long_payload(monkeypatch, {"showMansfield": True})["payload"]
    for path in SUMMARY_PATHS:
        v = _walk(p, path)
        assert v is not None, path
        if isinstance(v, str):
            assert v and not v.endswith("."), f"{path}: {v!r} (no trailing period)"
    assert p["rating"]["summary"] == "94 · fast 91"
    assert re.fullmatch(r"\d{8}", p["legend"]["asOf"]) and p["legend"]["stale"] is False
    assert isinstance(p["legend"]["lastValue"], float)
    assert re.fullmatch(r"\d of 4 pass", p["checks"]["summary"])
    assert re.fullmatch(r"[+-]?\d+\.\d%, (above|below|at) zero(, (rising|falling|flat))?", p["mansfield"]["summary"])
    assert re.fullmatch(r"(today|1 bar ago|\d+ bars ago)( · before price)?( · red day)?|none in the last \d+ bars",
                        p["lastRsHigh"]["summary"]), p["lastRsHigh"]["summary"]
    assert re.fullmatch(r"(SPY, RSP and XLK all (rising|falling|flat))|(split: SPY \w+, RSP \w+, XLK \w+)",
                        p["sensitivity"]["summary"]), p["sensitivity"]["summary"]


def test_every_contract_path_exists_on_a_short_and_an_intraday_payload(v2_row, monkeypatch):
    store = _long_daily(n=80)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    _no_cache(monkeypatch)
    for tf in ("D", "5", "W"):
        p = sig._rs_line_provider("NVDA", tf, {"benchmark": "SPY"})["payload"]
        for path in SUMMARY_PATHS:
            _walk(p, path)                               # a null is fine; a missing key is drift
    p = sig._rs_line_provider("NVDA", "5", {"benchmark": "SPY"})["payload"]
    assert p["lastRsHigh"]["summary"] == "not read on intraday charts"
    p = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    assert p["lastRsHigh"]["summary"].startswith("needs ") or p["lastRsHigh"]["summary"].startswith("none")


def test_no_server_string_says_1_bars_or_repeats_its_label(v2_row, monkeypatch):
    """Acceptance 6 on the server half: across long, short, gapped and
    low-yesterday payloads no string pluralises a one, and the check values do
    not open with their labels' first words."""
    payloads = [_long_payload(monkeypatch, {"showMansfield": True})["payload"]]
    store = _long_daily(n=120)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    payloads.append(sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"])
    for p in payloads:
        for path, text in _strings({k: v for k, v in p.items() if k != "evidence"}):
            assert not ONE_BARS.search(text), f"{path}: {text!r}"
        labels = {"anchor": "since", "pivotSpeed": "pivot", "greenOnRed": "green", "ma": "averages"}
        for k, word in labels.items():
            reason = p["checks"][k].get("reason") or ""
            assert not reason.lower().startswith(word), f"checks.{k}.reason {reason!r}"
        assert "of the range" not in (p["checks"]["pivotSpeed"].get("reason") or "")
    stock, bench = _check_bars(low_ago=1)
    for path, text in _strings(rsp._rs_checks(stock, bench, "SPY", -0.5)):
        assert not ONE_BARS.search(text), f"{path}: {text!r}"


def test_the_v2_cache_key_carries_the_payload_shape_and_v1_does_not(v2_row, monkeypatch):
    """An envelope cached before the summaries must not be served after them."""
    n = 30
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher({"NVDA": _bars([100.0 + i for i in range(n)]),
                                                          "SPY": _bars([400.0] * n)}))
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    seen = []
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.append(k))
    sig._rs_line_provider("NVDA", "D", {"lookback": 20})
    assert rsp._RS_PAYLOAD_SHAPE == 4 and f"rs3p{rsp._RS_PAYLOAD_SHAPE}" in seen[-1], seen[-1]
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(False))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", False)
    sig._rs_line_provider("NVDA", "D", {"lookback": 20})
    assert "rs1" in seen[-1] and "rs1p" not in seen[-1], seen[-1]


# ── controls ───────────────────────────────────────────────────────────────

def test_control_the_other_server_rows_and_the_flag_off_lane_are_unchanged(v2_row, monkeypatch):
    """Non-RS definitions are untouched by this unit: a Mansfield-view RS
    compute leaves every other server row and provider exactly as it was, and
    the flag-off RS lane is still the bare v1 envelope."""
    import copy

    def others():
        return {d["id"]: d for d in rd.list_definitions() if d["id"] != "rsLine"}
    before = copy.deepcopy(others())
    assert set(before) == {"uct-darkpool-levels", "uct-gex-walls", "uct-flow-breakout"}
    providers = {k: rd.provider_for(k) for k in before}
    env = _long_payload(monkeypatch, {"showMansfield": True})
    assert others() == before
    assert {k: rd.provider_for(k) for k in before} == providers
    # the Mansfield-view columns pass the lane's exact-match wire contract
    wired = rd.wire_columns("rsLine", env["columns"])
    assert sorted(wired) == sorted(V3_COLUMNS) and all(v is None for v in wired["rsLine"])

    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(False))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", False)
    n = 30
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher({"NVDA": _bars([100.0 + i for i in range(n)]),
                                                          "SPY": _bars([400.0] * n)}))
    _no_cache(monkeypatch)
    env = sig._rs_line_provider("NVDA", "D", {"lookback": 20, "showMansfield": True})
    assert set(env) == {"columns", "times", "asOf"} and set(env["columns"]) == {"rsLine"}
    assert any(v is not None for v in env["columns"]["rsLine"]), "v1 never blanks the line, whatever the inputs say"


def _key_paths(obj, path=""):
    """Every dict key path in a payload (lists are leaves): the payload's SHAPE."""
    out = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            out.add(p)
            out |= _key_paths(v, p)
    return out


#: The v2 payload's key paths at `_RS_PAYLOAD_SHAPE` 3 (2026-11-07: benchmark.note,
#: history.summary, mansfield.lengthText), and at 4 (2026-11-07: rating.m1, rating.m3,
#: rating.m6, rating.m12, rating.components, the Components row). ⛔ A field added or removed here without a
#: bump is served the OLD shape for up to a session: the pod carries its cache across
#: a restart (`cache_snapshot`), and an RS envelope lives until the next session
#: close. Measured in the sandbox the day this rail was written.
_SHAPE_3_TOP = {"benchmark", "checks", "evidence", "history", "inputs", "intraday", "lastRsHigh", "legend",
                "mansfield", "rating", "regime", "sensitivity", "state", "theme"}
_SHAPE_3_FIELDS = {"benchmark.note", "history.summary", "mansfield.lengthText", "mansfield.lastCross",
                   "rating.m1", "rating.m3", "rating.m6", "rating.m12", "rating.components"}


def test_a_payload_field_change_comes_with_a_shape_bump(v2_row, monkeypatch):
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily()))
    _no_cache(monkeypatch)
    p = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    got = _key_paths(p)
    assert {k for k in got if "." not in k} == _SHAPE_3_TOP
    assert _SHAPE_3_FIELDS <= got
    import hashlib
    digest = hashlib.sha256("\n".join(sorted(got)).encode()).hexdigest()[:16]
    assert (rsp._RS_PAYLOAD_SHAPE, digest) == (4, "0946aceab7795a4e"), (
        f"the RS payload's key paths changed (digest {digest}): bump signature._RS_PAYLOAD_SHAPE, "
        f"then pin the new pair here. Paths: {sorted(got)}")


#: The v4 payload's key paths (unit 3-06, `compute.rev` 4, `_RS_PAYLOAD_SHAPE_V4`
#: 5): the v3 paths plus the `rotation`, `quality` and `vars` blocks, the nine
#: Phase 3 `inputs` and `checks.anchor.source` / `date`. The v3 pin above is
#: unchanged on purpose: with the flag off the v3 payload is byte-identical and
#: its key still reads `rs3p4`. A v4 field added or removed needs
#: `_RS_PAYLOAD_SHAPE_V4` bumped and this pair re-pinned.
_SHAPE_5_NEW_TOP = {"rotation", "quality", "vars"}
_SHAPE_5_FIELDS = {"rotation.summary", "rotation.inQuadrantBars", "quality.summary", "quality.annualPct",
                   "vars.summary", "vars.stateWord", "inputs.view", "inputs.customBenchmark",
                   "inputs.anchorDate", "checks.anchor.source", "checks.anchor.date"}
#: Shape 6 (Deepvue round 2, 2026-11-08, `compute.rev` 5): the RS Rating
#: Reading's `ratingHistory` block and the rating's 9-month component `rating.m9`.
_SHAPE_6_NEW_TOP = {"ratingHistory"}
_SHAPE_6_FIELDS = {"rating.m9", "ratingHistory.summary", "ratingHistory.reason", "ratingHistory.value",
                   "ratingHistory.average", "ratingHistory.change20", "ratingHistory.sessions",
                   "ratingHistory.asof", "ratingHistory.stale"}
#: Shape 7 (2026-11-12, sector and theme benchmarks): the plain benchmark name the
#: pane label prints, and the picked sector / theme beside the custom ticker.
_SHAPE_7_FIELDS = {"benchmark.name", "inputs.sectorBenchmark", "inputs.themeBenchmark"}


def test_a_v4_payload_field_change_comes_with_a_v4_shape_bump(monkeypatch):
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True, True))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily()))
    _no_cache(monkeypatch)
    p = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    got = _key_paths(p)
    assert {k for k in got if "." not in k} == _SHAPE_3_TOP | _SHAPE_5_NEW_TOP | _SHAPE_6_NEW_TOP
    assert _SHAPE_3_FIELDS | _SHAPE_5_FIELDS | _SHAPE_6_FIELDS | _SHAPE_7_FIELDS <= got
    import hashlib
    digest = hashlib.sha256("\n".join(sorted(got)).encode()).hexdigest()[:16]
    # 5 / 941624d86bef76c7 until Deepvue round 2 (2026-11-08): shape 6 adds
    # `rating.m9` and the `ratingHistory` block (`compute.rev` 5).
    # 6 / b7e71e5426b27163 until 2026-11-12: shape 7 adds `benchmark.name` and the
    # sector / theme picks in `inputs`.
    assert (rsp._RS_PAYLOAD_SHAPE_V4, digest) == (7, "574bbe475d7e130d"), (
        f"the v4 RS payload's key paths changed (digest {digest}): bump rs_provider._RS_PAYLOAD_SHAPE_V4, "
        f"then pin the new pair here. Paths: {sorted(got)}")
