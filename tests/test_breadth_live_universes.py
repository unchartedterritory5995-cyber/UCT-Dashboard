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
    monkeypatch.setattr(blu, "_load_frame_by_key", frame)
    monkeypatch.setattr(blu, "_load_frame_from_pack", lambda tickers, L_iso: None)
    monkeypatch.setattr(bl, "_apply_dividend_basis", lambda t, d, c, m, o=None: c)
    monkeypatch.setattr(blu, "_active_reference", lambda: ref)
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
    monkeypatch.setattr(blu, "_snapshot", lambda: (prices, vols, None, {}, {}))
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
    monkeypatch.setenv("BREADTH_LIVE_UNIVERSES", "0")
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


def test_a_cache_only_reader_accepts_a_slightly_stale_live_payload(monkeypatch):
    """The chart's developing candle must not vanish in the seconds between sampler ticks."""
    import time as _t
    monkeypatch.setattr(bl, "enabled", lambda: True)
    with bl._live_lock:
        bl._live_cache["payload"] = {"ok": True, "tag": "warm"}
        bl._live_cache["at"] = _t.time() - 90          # past the 55 s TTL, inside the grace
    assert bl.compute_live(cached_only=True).get("tag") == "warm"
    with bl._live_lock:
        bl._live_cache["at"] = _t.time() - 600          # genuinely stale
    assert bl.compute_live(cached_only=True).get("ok") is False
    with bl._live_lock:
        bl._live_cache.clear()



def test_frame_by_key_matches_the_in_list_loader():
    """Same frame, index-friendly query."""
    import sqlite3
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE ohlcv(ticker TEXT, tf TEXT, ts INTEGER, c REAL, v REAL, PRIMARY KEY(ticker, tf, ts))")
    rows = [("AAA", "D", 20260101 + i, 10.0 + i, 100.0 * i) for i in range(5)]
    rows += [("BBB", "D", 20260102, 5.0, None), ("BBB", "W", 20260102, 99.0, 1.0)]
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?)", rows)
    dates = [20260101, 20260102, 20260103]
    a = bl._load_frame(c, ["AAA", "BBB", "ZZZ"], dates)
    b = blu._load_frame_by_key(c, ["AAA", "BBB", "ZZZ"], dates)
    for x, y in zip(a, b):
        assert np.array_equal(x, y, equal_nan=True)



def test_frame_from_the_bars_pack(monkeypatch):
    """The pack (manifest + gzip shards) yields the same frame; a stale pack yields None."""
    import gzip
    import json
    from api.services import data_sync
    from api.services import barspack as bp
    spy_idx = bp._shard_of("SPY", 2)
    other = 1 - spy_idx
    shards = {
        f"barspack/d/{spy_idx:03d}.json.gz": {"tickers": {
            "SPY": {"D": {"t": ["2026-10-06", "2026-10-07"], "c": [1, 2], "v": [1, 1]}},
            "AAA": {"D": {"t": ["2026-10-06", "2026-10-07"], "c": [10.0, 11.0], "v": [5, 6]}}}},
        f"barspack/d/{other:03d}.json.gz": {"tickers": {
            "BBB": {"D": {"t": ["2026-10-07"], "c": [20.0], "v": [7]}}}},
    }
    store = {"barspack/latest.json": json.dumps({"num_shards": 2, "shards": [
        {"idx": spy_idx, "name": f"barspack/d/{spy_idx:03d}.json.gz"},
        {"idx": other, "name": f"barspack/d/{other:03d}.json.gz"}]}).encode()}
    store.update({k: gzip.compress(json.dumps(v).encode()) for k, v in shards.items()})
    monkeypatch.setattr(data_sync, "get_bytes", lambda k: store.get(k))
    dates, c, v = blu._load_frame_from_pack(["AAA", "BBB", "ZZZ"], "2026-10-07")
    assert dates == [20261006, 20261007]
    assert c[0].tolist() == [10.0, 11.0] and np.isnan(c[1, 0]) and c[1, 1] == 20.0
    assert np.isnan(c[2]).all() and v[0].tolist() == [5, 6]
    assert blu._load_frame_from_pack(["AAA"], "2026-10-08") is None      # pack older than L
    dates, c, _ = blu._load_frame_from_pack(["AAA"], "2026-10-06")       # pack newer than L: cut
    assert dates == [20261006] and c[0].tolist() == [10.0]



def test_a_slow_dividend_store_never_hangs_the_build(monkeypatch):
    import time as _t
    monkeypatch.setattr(blu, "DIVIDEND_BUDGET_SECONDS", 0.2)
    monkeypatch.setattr(bl, "dividend_basis_enabled", lambda: True)
    monkeypatch.setattr(bl, "_apply_dividend_basis", lambda *a, **k: (_t.sleep(2), a[2] * 2)[1])
    c = np.ones((2, 3))
    out, st = blu._dividend_basis_with_budget(["A", "B"], [1, 2, 3], c, 3)
    assert st == "timeout" and out is c
    monkeypatch.setattr(bl, "_apply_dividend_basis", lambda *a, **k: a[2] * 2)
    out, st = blu._dividend_basis_with_budget(["A", "B"], [1, 2, 3], c, 3)
    assert st == "applied" and out[0, 0] == 2



def test_serving_is_on_by_default(monkeypatch):
    monkeypatch.delenv("BREADTH_LIVE_UNIVERSES", raising=False)
    monkeypatch.setattr(bl, "enabled", lambda: True)
    assert blu.serving() is True



def test_no_state_build_inside_the_boot_grace(market, monkeypatch):
    monkeypatch.setattr(blu, "_process_uptime", lambda: 30.0)
    monkeypatch.setattr(bl, "_session_started", lambda now=None: False)
    p = blu.compute()
    assert p["ok"] is False and "boot grace" in p["reason"]
    assert blu._state.get("value") is None


def test_last_good_payload_is_carried_through_a_restart(tmp_path, monkeypatch):
    """A fresh process inside its boot grace serves the previous process's good payload."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from api.services import breadth_live as bl
    monkeypatch.setattr(blu, "LAST_GOOD_PATH", str(tmp_path / "last.json"))
    now_et = datetime(2026, 10, 9, 9, 52, tzinfo=ZoneInfo("America/New_York"))
    monkeypatch.setattr(bl, "_now_et", lambda: now_et)
    good = {"ok": True, "as_of": "2026-10-09T09:40:00-04:00", "L": "2026-10-07",
            "universes": {"nasdaq": {"ok": True, "rows": [{"date": "2026-10-08", "final": True,
                                                           "metrics": {"advancing": 1}}]}}}
    blu._last_good.clear()
    monkeypatch.setattr(blu, "compute", lambda force=False: good)
    blu.refresh()
    blu._last_good.clear()                              # a new process: memory empty, disk kept
    monkeypatch.setattr(blu, "compute", lambda force=False: {"ok": False, "reason": "boot grace"})
    p = blu.refresh()
    assert p["carried"] and p["universes"]["nasdaq"]["rows"][0]["date"] == "2026-10-08"
    assert p["carried_reason"] == "boot grace"
    # the next ET day never serves yesterday's carried payload
    blu._last_good.clear()
    monkeypatch.setattr(bl, "_now_et", lambda: datetime(2026, 10, 10, 9, 52, tzinfo=ZoneInfo("America/New_York")))
    assert blu.refresh() == {"ok": False, "reason": "boot grace"}
    blu._last_good.clear()
    blu._payload.clear()


def test_uct_live_frame_reads_the_pack_and_leaves_older_columns_empty(monkeypatch):
    from api.services import breadth_live as bl
    tickers = ["T%03d" % i for i in range(120)]
    pdates = [20250000 + i for i in range(1, 301)]
    pc = np.arange(120 * 300, dtype=float).reshape(120, 300)
    calls = []
    monkeypatch.setattr(blu, "_load_frame_from_pack",
                        lambda t, last: calls.append(last) or (pdates, pc, pc * 0 + 7))
    bl._pack_frame_cache.clear()
    dates = [20240000 + i for i in range(1, 81)] + pdates          # 380 wide, pack covers 300
    c, v = bl._load_frame(None, tickers, dates)
    assert c.shape == (120, 380) and np.isnan(c[:, :80]).all()
    assert c[5, -1] == pc[5, -1] and v[0, 100] == 7
    bl._load_frame(None, tickers, dates)
    assert len(calls) == 1                                           # cached per pack read
    # a pack that does not reach the newest requested session is not used
    bl._pack_frame_cache.clear()
    assert bl._frame_from_pack(tickers, pdates + [20260001]) is None
    # small requests stay on bars.db
    assert bl._frame_from_pack(tickers[:5], pdates) is None
    bl._pack_frame_cache.clear()


def test_uct_dividend_basis_is_budgeted_and_session_consistent(monkeypatch):
    import time as _t
    from api.services import breadth_live as bl
    monkeypatch.setattr(bl, "dividend_basis_enabled", lambda: True)
    monkeypatch.setattr(bl, "DIVIDEND_BUDGET_SECONDS", 0.2)
    monkeypatch.setattr(bl, "_session_ts", lambda: 20261009)
    bl._session_div.clear()
    closes = np.ones((2, 3))
    slow = lambda t, d, c, m, o=None: (_t.sleep(1.0), c * 2)[1]
    monkeypatch.setattr(bl, "_apply_dividend_basis", slow)
    out, b = bl._dividend_basis_for_session(["A", "B"], [1, 2, 3], closes, 20261008)
    assert b == "skipped" and (out == 1).all()
    # the anchor in the same session follows, even when the store is fast again
    monkeypatch.setattr(bl, "_apply_dividend_basis", lambda t, d, c, m, o=None: c * 2)
    out, b = bl._dividend_basis_for_session(["A", "B"], [1, 2, 3], closes, 20261008)
    assert b == "skipped" and (out == 1).all()
    assert not bl._adopt_basis("applied") and bl._adopt_basis("skipped")
    # a new session decides afresh
    monkeypatch.setattr(bl, "_session_ts", lambda: 20261010)
    out, b = bl._dividend_basis_for_session(["A", "B"], [1, 2, 3], closes, 20261009)
    assert b == "applied" and (out == 2).all()
    assert bl._adopt_basis(None)                               # untagged = applied
    bl._session_div.clear()


def test_unchanged_is_carried_for_the_exchange_universes():
    """NYSE:UNCH / NASDAQ:UNCH are built from `unchanged`, which is no library metric — the live
    rows must still carry it, or both series stop at the last canonical session."""
    for u in ("nyse", "nasdaq", "us"):
        assert "unchanged" in blu._published_metrics(u)


def test_recorded_session_draws_as_an_observed_candle(tmp_path, monkeypatch):
    """2026-10-10: the live/provisional US/NYSE/Nasdaq bars carry the recorded intraday path."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from api.services import breadth_live as bl
    monkeypatch.setattr(blu, "INTRADAY_PATH", str(tmp_path / "intra.json"))
    blu._intra.clear(); blu._intra_loaded["done"] = False
    monkeypatch.setattr(bl, "_session_started", lambda: True)
    monkeypatch.setattr(bl, "_market_open", lambda: True)
    monkeypatch.setattr(bl, "_now_et", lambda: datetime(2026, 10, 12, 11, 0, tzinfo=ZoneInfo("America/New_York")))

    def payload(v):
        return {"ok": True, "universes": {"nyse": {"ok": True, "rows": [
            {"date": "2026-10-12", "final": False, "metrics": {"pct_above_50sma": v}}]}}}
    for v in (30.0, 35.4, 27.2, 29.0, 28.1, 29.6):
        blu._record_intraday(payload(v))
    monkeypatch.setattr(blu, "rows_for", lambda u: payload(29.6)["universes"]["nyse"]["rows"])
    body = [{"t": "2026-10-09", "o": 25.0, "h": 26.0, "l": 24.0, "c": 25.5, "v": 0}]
    bar = blu.append_library_bars(body, "nyse", "pct_above_50sma")[-1]
    assert bar == {"t": "2026-10-12", "o": 30.0, "h": 35.4, "l": 27.2, "c": 29.6, "v": 0, "ohlc": 1}
    # a restart keeps the morning (persisted), and an unrecorded session stays a body
    blu._intra.clear(); blu._intra_loaded["done"] = False
    assert blu._intraday_path("2026-10-12", "nyse", "pct_above_50sma") == (30.0, 35.4, 27.2)
    assert blu._intraday_path("2026-10-12", "us", "pct_above_50sma") is None
    blu._intra.clear(); blu._intra_loaded["done"] = False
