"""Tests for the 2026-07-01 perf batch A (audit follow-ups):
yf_util bounded_call, RS single-ticker cache-only lookup, insider parallel feed,
fundamentals peer-comp parallelization."""

import time


# ── yf_util.bounded_call ──────────────────────────────────────────────────────

def test_bounded_call_fast_value():
    from api.services.yf_util import bounded_call
    assert bounded_call(lambda: 7, default=-1, timeout=1.0) == 7


def test_bounded_call_timeout_returns_default_promptly():
    from api.services.yf_util import bounded_call
    start = time.monotonic()
    r = bounded_call(lambda: (time.sleep(1.0), "slow")[1], default="D", timeout=0.2)
    assert r == "D"
    assert time.monotonic() - start < 0.8


def test_bounded_call_error_returns_default():
    from api.services.yf_util import bounded_call
    def boom():
        raise RuntimeError("x")
    assert bounded_call(boom, default=None, timeout=1.0) is None


# ── RS: single-ticker is a pure cache lookup (no universe recompute) ──────────

def test_get_rs_for_ticker_never_recomputes(monkeypatch):
    import api.services.rs_ranking as rs
    calls = {"compute": 0}
    monkeypatch.setattr(rs, "compute_rs_scores",
                        lambda *a, **k: (calls.__setitem__("compute", calls["compute"] + 1), [])[1])

    class FakeCache:
        def __init__(self, v):
            self.v = v
        def get(self, k):
            return self.v

    # cold cache → None, and compute must NOT be called
    monkeypatch.setattr(rs, "cache", FakeCache(None))
    assert rs.get_rs_for_ticker("AAPL") is None
    assert calls["compute"] == 0

    # warm cache → returns the item, still no recompute
    monkeypatch.setattr(rs, "cache", FakeCache([{"ticker": "AAPL", "rs_rank": 88}]))
    got = rs.get_rs_for_ticker("aapl")
    assert got and got["rs_rank"] == 88
    assert calls["compute"] == 0


# ── insider feed aggregates across tickers (parallel path) ───────────────────

def test_insider_feed_parallel_aggregates(monkeypatch):
    import api.services.insider as ins

    monkeypatch.setattr(ins, "_get_feed_tickers", lambda: ["AAA", "BBB"])

    def fake_activity(tk):
        amt = 100 if tk == "AAA" else 200
        return [{"type": "buy", "date": "2999-01-01", "amount": amt,
                 "name": "x", "title": "t", "shares": 1, "price": 1, "filing_date": ""}]

    monkeypatch.setattr(ins, "get_insider_activity", fake_activity)

    class FakeCache:
        def get(self, k):
            return None
        def set(self, k, v, ttl=None):
            pass

    monkeypatch.setattr(ins, "cache", FakeCache())
    res = ins.get_recent_insider_buys()
    assert {r["symbol"] for r in res} == {"AAA", "BBB"}
    assert res[0]["symbol"] == "BBB"  # sorted by dollar amount desc


# ── fundamentals peer-comp parallelization still returns rows ────────────────

def test_compare_fundamentals_parallel(monkeypatch):
    import api.services.fundamentals as f
    monkeypatch.setattr(f, "get_fundamentals",
                        lambda t: {"ticker": t, "name": t, "pe_trailing": 10.0})
    out = f.compare_fundamentals(["AAA", "BBB"])
    assert isinstance(out, dict) and "error" not in out
