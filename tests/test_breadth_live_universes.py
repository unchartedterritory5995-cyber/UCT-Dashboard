"""Live breadth for US / NYSE / Nasdaq (`breadth_live_universes`), 2026-10-08.

The method is `breadth_live`'s (already reconciled against the collector for UCT); what is new
here is the plumbing — per-universe membership, one union frame cut into universes, anchoring to
each universe's OWN canonical series, the provisional completed sessions, the population guard,
and the producers' input overlay that extends every derived series with the same formulas.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

from api.services import breadth_live as bl
from api.services import breadth_live_universes as blu


# ── membership ───────────────────────────────────────────────────────────────

def test_membership_is_type_and_venue_on_the_session():
    ref = {
        "AAPL": [{"type": "CS", "primary_exchange": "XNAS"}],
        "IBM": [{"type": "CS", "primary_exchange": "XNYS"}],
        "TSM": [{"type": "ADRC", "primary_exchange": "XNYS"}],
        "SPY": [{"type": "ETF", "primary_exchange": "ARCX"}],
        "AMEX1": [{"type": "CS", "primary_exchange": "XASE"}],
        "GONE": [{"type": "CS", "primary_exchange": "XNAS", "delisted_utc": "2020-01-01"}],
        "TIER": [{"type": "CS", "primary_exchange": "XNGS"}],
    }
    m = blu.members("2026-10-07", ref_map=ref)
    assert m["nasdaq"] == ["AAPL", "TIER"]
    assert m["nyse"] == ["IBM", "TSM"]
    assert m["us"] == ["AAPL", "AMEX1", "IBM", "TIER", "TSM"], "US ⊇ NYSE ∪ Nasdaq, plus XASE; no ETF"


# ── the synthetic market ─────────────────────────────────────────────────────

N_DAYS = 300


def _sessions():
    d, out = date(2025, 6, 2), []
    while len(out) < N_DAYS:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += timedelta(days=1)
    return out


@pytest.fixture
def market(monkeypatch):
    rng = np.random.default_rng(7)
    venues = (["XNAS"] * 400) + (["XNYS"] * 350) + (["XASE"] * 150)
    tickers = [f"T{i:04d}" for i in range(len(venues))]
    ref = {t: [{"type": "CS", "primary_exchange": v}] for t, v in zip(tickers, venues)}
    dates = _sessions()
    rets = rng.normal(0.0004, 0.02, size=(len(tickers), N_DAYS))
    closes = 50.0 * np.exp(np.cumsum(rets, axis=1))
    vols = rng.uniform(1e5, 1e6, size=(len(tickers), N_DAYS))
    L = dates[-1]

    monkeypatch.setattr(bl, "_bars_conn", lambda: None)
    monkeypatch.setattr(bl, "last_completed_session", lambda conn=None, now=None: L)
    monkeypatch.setattr(bl, "_session_dates", lambda conn, end, start, limit=0: [d for d in dates if d <= end])
    pos = {t: i for i, t in enumerate(tickers)}

    def frame(conn, tks, ds):
        ix = [pos[t] for t in tks]
        cols = [dates.index(d) for d in ds]
        return closes[np.ix_(ix, cols)].copy(), vols[np.ix_(ix, cols)].copy()
    monkeypatch.setattr(bl, "_load_frame", frame)
    monkeypatch.setattr(bl, "_apply_dividend_basis", lambda t, d, c, m, o=None: c)
    from api.services import breadth_pit_frame as pf
    monkeypatch.setattr(pf, "reference_map", lambda force=False: ref)
    blu._members_cache.clear()
    blu._state.clear()
    blu._payload.clear()
    blu._ind_cache.clear()
    return {"tickers": tickers, "dates": dates, "closes": closes, "vols": vols, "ref": ref}


def _true_rows(mk, u, k):
    """The method's own value at the close of session index k, for universe u."""
    st = blu._build_state(mk["dates"][-1])
    return blu._close_rows(st, k)[u]


BIAS = {"pct_above_50sma": 3.0, "advancing": 25, "declining": -10, "new_52w_highs": 4,
        "new_52w_lows": 2, "universe_count": 0, "up_4pct_today": 1, "down_4pct_today": 1}


def _install_canonical(monkeypatch, mk, upto_k, bias=BIAS):
    """Canonical = the method + a constant bias, finalised through session index `upto_k`."""
    st = blu._build_state(mk["dates"][-1])
    canon = {u: {} for u in blu.UNIVERSES}
    for k in range(upto_k - 12, upto_k + 1):
        rows = blu._close_rows(st, k)
        iso = blu._iso(mk["dates"][k])
        for u in blu.UNIVERSES:
            canon[u][iso] = {m: rows[u][m] + b for m, b in bias.items() if rows[u].get(m) is not None}
    monkeypatch.setattr(blu, "canonical", lambda u, metrics: canon[u])
    monkeypatch.setattr(blu, "_published_metrics", lambda u: list(bias))
    return canon


def test_provisional_sessions_continue_the_canonical_series_exactly(market, monkeypatch):
    """Two sessions not finalised yet (the canonical lag) come back as canonical + method delta.
    With a constant bias between method and canonical that is EXACTLY the method + bias."""
    k_last = N_DAYS - 1
    _install_canonical(monkeypatch, market, k_last - 2)
    monkeypatch.setattr(bl, "_session_started", lambda now=None: False)
    p = blu.compute(force=True)
    assert p["ok"]
    for u in blu.UNIVERSES:
        res = p["universes"][u]
        assert res["ok"], res
        assert res["anchor"] == blu._iso(market["dates"][k_last - 2])
        got = [r["date"] for r in res["rows"]]
        assert got == [blu._iso(market["dates"][k_last - 1]), blu._iso(market["dates"][k_last])]
        for r in res["rows"]:
            k = market["dates"].index(int(r["date"].replace("-", "")))
            truth = _true_rows(market, u, k)
            for m, b in BIAS.items():
                if truth.get(m) is None:
                    continue
                assert r["metrics"][m] == pytest.approx(truth[m] + b, abs=0.051), (u, m)
            assert r["metrics"]["adv_decline"] == r["metrics"]["advancing"] - r["metrics"]["declining"]
            assert r["final"] is True


def test_no_rows_when_canonical_is_current(market, monkeypatch):
    _install_canonical(monkeypatch, market, N_DAYS - 1)
    monkeypatch.setattr(bl, "_session_started", lambda now=None: False)
    p = blu.compute(force=True)
    assert all(p["universes"][u]["rows"] == [] for u in blu.UNIVERSES)


def test_a_population_that_does_not_reconcile_is_withheld(market, monkeypatch):
    bias = dict(BIAS, universe_count=200)        # canonical counts 200 more names than the method
    _install_canonical(monkeypatch, market, N_DAYS - 2, bias=bias)
    monkeypatch.setattr(bl, "_session_started", lambda now=None: False)
    p = blu.compute(force=True)
    nyse = p["universes"]["nyse"]                # 350 names: +200 is far beyond 5 %
    assert nyse["ok"] is False and nyse["degraded"] is True and "rows" not in nyse


def test_today_is_a_live_row_from_the_snapshot(market, monkeypatch):
    _install_canonical(monkeypatch, market, N_DAYS - 1)
    monkeypatch.setattr(bl, "_session_started", lambda now=None: True)
    last = market["closes"][:, -1]
    prices = {t: float(last[i] * 1.01) for i, t in enumerate(market["tickers"])}   # everything up 1 %
    vols = {t: 1e5 for t in market["tickers"]}
    monkeypatch.setattr(blu, "_snapshot", lambda: (prices, vols, None))
    p = blu.compute(force=True)
    for u in blu.UNIVERSES:
        rows = p["universes"][u]["rows"]
        assert len(rows) == 1 and rows[0]["final"] is False
        n = len(blu.members("x", ref_map=market["ref"])[u])
        assert rows[0]["metrics"]["advancing"] == n + BIAS["advancing"]
        assert rows[0]["metrics"]["declining"] == 0 + BIAS["declining"]


def test_library_bars_append_only_after_the_canonical_end(monkeypatch):
    monkeypatch.setattr(blu, "rows_for", lambda u: [
        {"date": "2026-10-06", "final": True, "metrics": {"pct_above_50sma": 99.0}},
        {"date": "2026-10-07", "final": True, "metrics": {"pct_above_50sma": 30.0}},
        {"date": "2026-10-08", "final": False, "metrics": {"pct_above_50sma": 28.5}}])
    body = [{"t": "2026-10-06", "o": 30, "h": 31, "l": 29, "c": 31.0, "v": 0}]
    out = blu.append_library_bars(body, "us", "pct_above_50sma")
    assert [b["t"] for b in out] == ["2026-10-06", "2026-10-07", "2026-10-08"]
    assert out[0] is body[0], "canonical bars are never rewritten"
    assert out[1] == {"t": "2026-10-07", "o": 31.0, "h": 31.0, "l": 30.0, "c": 30.0, "v": 0}
    assert out[2]["o"] == 30.0 and out[2]["c"] == 28.5


def test_nothing_is_served_while_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("BREADTH_LIVE_UNIVERSES", raising=False)
    assert blu.serving() is False
    assert blu.rows_for("us") == []
    body = [{"t": "2026-10-06", "o": 1, "h": 1, "l": 1, "c": 1.0, "v": 0}]
    assert blu.append_library_bars(body, "us", "pct_above_50sma") == body
    assert blu.indicator_points("US:MCO", "us", [{"t": "2026-10-06", "v": 1.0}]) == []


# ── the derived series extend with the SAME formulas ─────────────────────────

def _store(adv, dec, dates):
    data = {"advancing": dict(zip(dates, adv)), "declining": dict(zip(dates, dec))}
    data["adv_decline"] = {d: a - b for d, a, b in zip(dates, adv, dec)}
    data["new_52w_highs"] = {d: 50 + (i % 7) for i, d in enumerate(dates)}
    data["new_52w_lows"] = {d: 30 + (i % 5) for i, d in enumerate(dates)}

    def history(metric, limit=0, universe=None, **kw):
        return {d: {"c": v} for d, v in (data.get(metric) or {}).items()}
    return history


def test_overlay_extends_us_mcclellan_ratios_and_hli_like_a_full_recompute(monkeypatch):
    from api.services import breadth_daily_ohlc as store
    from api.services.market_indicators import producers
    rng = np.random.default_rng(3)
    n = 400
    dates = [(date(2024, 1, 1) + timedelta(days=i)).isoformat() for i in range(n)]
    adv = [int(x) for x in rng.integers(800, 2200, n)]
    dec = [int(x) for x in rng.integers(800, 2200, n)]
    head, tail = dates[:-2], dates[-2:]
    monkeypatch.setattr(store, "history", _store(adv[:-2], dec[:-2], head))
    overlay = {"us": {"advancing": dict(zip(tail, adv[-2:])), "declining": dict(zip(tail, dec[-2:])),
                      "adv_decline": {d: a - b for d, a, b in zip(tail, adv[-2:], dec[-2:])},
                      "new_52w_highs": {tail[0]: 50 + (n - 2) % 7, tail[1]: 50 + (n - 1) % 7},
                      "new_52w_lows": {tail[0]: 30 + (n - 2) % 5, tail[1]: 30 + (n - 1) % 5}}}
    ext = {sid: producers.build_with_overlay(sid, overlay) for sid in ("US:MCO", "US:ADR", "US:HLI", "US:ZBT")}
    monkeypatch.setattr(store, "history", _store(adv, dec, dates))
    for sid, ds in ext.items():
        full = producers._build_uncached(sid)
        assert ds.dates[-2:] == tail
        for d in tail:
            a, b = dict(zip(ds.dates, ds.values))[d], dict(zip(full.dates, full.values))[d]
            assert a == pytest.approx(b, abs=1e-9), (sid, d)
    assert producers._INPUT_OVERLAY.get() is None, "the overlay never leaks past the call"


def test_indicator_points_continue_running_totals_from_the_served_level(monkeypatch):
    monkeypatch.setenv("BREADTH_LIVE_UNIVERSES", "1")
    monkeypatch.setattr(bl, "enabled", lambda: True)
    monkeypatch.setattr(blu, "indicator_overlay", lambda u: {"advancing": {"2026-10-07": 1}})
    from api.services.market_indicators import producers

    class DS:
        dates = ["2026-10-06", "2026-10-07", "2026-10-08"]
        values = [500.0, 510.0, 495.0]
    monkeypatch.setattr(producers, "build_with_overlay", lambda sid, ov: DS)
    blu._ind_cache.clear()
    served = [{"t": "2026-10-06", "v": -100.0}]       # served level differs from the recompute
    pts = blu.indicator_points("NASDAQ:MCS", "nasdaq", served)
    assert pts == [{"t": "2026-10-07", "v": -90.0}, {"t": "2026-10-08", "v": -105.0}]
    blu._ind_cache.clear()
    pts = blu.indicator_points("NASDAQ:ADR", "nasdaq", served)     # not cumulative: as computed
    assert pts == [{"t": "2026-10-07", "v": 510.0}, {"t": "2026-10-08", "v": 495.0}]
