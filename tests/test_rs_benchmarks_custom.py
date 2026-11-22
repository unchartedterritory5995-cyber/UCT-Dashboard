"""UCT RS Phase 3 unit 3-04: the CUSTOM benchmark (engineering map §2 3-04, D4).

A member's own ticker, resolved honestly: valid ⇒ itself; empty / invalid ⇒
SPY with a reason; the chart's own symbol ⇒ itself (the provider's
same-symbol state); no bars ⇒ itself with empty bars and one warm per ticker
per ten minutes; an ETF is allowed. And CUSTOM stays out of every list that
is derived from the resolver's vocabulary.
"""

from __future__ import annotations

import threading

import pytest

from api.services import rs_benchmarks as rb


def _bars(n=5, base=100.0):
    return [{"t": i, "c": base + i} for i in range(n)]


class _Fetch:
    """A bar reader with a fixed set of tickers that HAVE bars; records calls."""

    def __init__(self, have=("SPY", "QQQ", "IWM", "RSP", "XLK", "AAPL", "MSFT", "BRK.B", "SMH", "ARKK")):
        self.have = set(have)
        self.calls = []

    def __call__(self, sym, tf, count):
        self.calls.append((sym, tf, count))
        return _bars(count, base=float(sum(map(ord, sym)))) if sym in self.have else []


class _Warm:
    def __init__(self):
        self.calls = []

    def __call__(self, ticker):
        self.calls.append(ticker)


@pytest.fixture(autouse=True)
def _fresh_memo(monkeypatch):
    """Each test starts with an empty warm memo and a controllable clock, and no
    test reaches the industry map or the cap universe."""
    monkeypatch.setattr(rb, "_custom_warmed", {})
    clock = {"t": 1000.0}
    monkeypatch.setattr(rb, "_now", lambda: clock["t"])
    monkeypatch.setattr(rb, "_groups_for", lambda s: {})
    monkeypatch.setattr(rb, "_members_of", lambda i: [])
    monkeypatch.setattr(rb, "_cap_universe", lambda: set())
    return clock


# ── the contract's constants ─────────────────────────────────────────────────

def test_custom_constant_and_regex():
    assert rb.CUSTOM_BENCHMARK == "CUSTOM"
    assert rb.CUSTOM_SYMBOL_RE.pattern == r"^[A-Z][A-Z.\-]{0,9}$"
    assert rb.CUSTOM_NO_SYMBOL == "no custom symbol"
    assert rb.CUSTOM_WARM_TTL_S == 600.0


def test_custom_is_absent_from_every_derived_benchmark_list():
    """Every list derived from the resolver's vocabulary: if CUSTOM ever joined
    LITERAL or AUTO, the chart menu, the alert lane, the prewarm set and the
    screener's ETF set would all grow it by accident (map F5, F17)."""
    from api.services import alert_rs_series, bars_prewarm
    from api.services.signature import registry_defs

    assert rb.CUSTOM_BENCHMARK not in rb.LITERAL_BENCHMARKS
    assert rb.CUSTOM_BENCHMARK not in rb.AUTO_BENCHMARKS
    assert rb.CUSTOM_BENCHMARK not in rb.SECTOR_ETF.values()
    assert rb.CUSTOM_BENCHMARK not in registry_defs.RS_LINE_BENCHMARKS
    assert rb.CUSTOM_BENCHMARK not in alert_rs_series.RS_ALERT_BENCHMARKS
    assert rb.CUSTOM_BENCHMARK not in bars_prewarm.RS_BENCHMARK_TICKERS
    # The screener's ETF set reads LITERAL + SECTOR_ETF; with its other three
    # sources unavailable it is exactly those, and CUSTOM is not among them.
    from api.services.screener import rs_history
    assert rb.CUSTOM_BENCHMARK not in rs_history.default_etf_tickers()


def test_custom_regex_accepts_what_the_router_accepts():
    """`CUSTOM_SYMBOL_RE` after strip + ASCII + upper accepts exactly what the
    router's `_SYM_RE` accepts after strip (`_sym_or_422`), so a ticker the
    chart can open is a ticker the chart can benchmark against."""
    from api.routers import signature as sig

    cases = ["AAPL", "aapl", " msft ", "BRK.B", "brk-b", "A", "ABCDEFGHIJ", "ABCDEFGHIJK",
             "$SPX", "^GSPC", "1ABC", ".A", "-A", "", "   ", "A B", "SPX\n", "ı", "ſ",
             "AAPL\n", "Ａ", "QQQ", "X.Y-Z"]
    for raw in cases:
        router_ok = bool(sig._SYM_RE.match((raw or "").strip()))
        mine = rb.normalize_custom_symbol(raw)
        assert (mine is not None) == router_ok, raw
        if router_ok:
            assert mine == raw.strip().upper()


# ── the cases ────────────────────────────────────────────────────────────────

def test_valid_ticker_resolves_as_itself():
    fetch, warm = _Fetch(), _Warm()
    res = rb.resolve_benchmark("NVDA", "custom", "D", 5, fetch, custom=" aapl ", warm=warm)
    assert res == {"requested": "CUSTOM", "resolved": "AAPL", "label": "AAPL",
                   "fallback": None, "bars": _bars(5, float(sum(map(ord, "AAPL")))), "note": None}
    assert fetch.calls == [("AAPL", "D", 5)]
    assert warm.calls == []


def test_dotted_and_dashed_tickers_are_valid():
    fetch = _Fetch()
    assert rb.resolve_benchmark("NVDA", "CUSTOM", "D", 3, fetch, custom="brk.b")["resolved"] == "BRK.B"
    assert rb.resolve_benchmark("NVDA", "CUSTOM", "D", 3, fetch, custom="BF-B")["resolved"] == "BF-B"


@pytest.mark.parametrize("bad", ["$SPX", "^GSPC", "1ABC", "TOOLONGTICK", "A B", "ı", ".SPY", "SP/Y"])
def test_invalid_ticker_falls_to_spy_with_a_reason(bad):
    fetch, warm = _Fetch(), _Warm()
    res = rb.resolve_benchmark("NVDA", "CUSTOM", "D", 4, fetch, custom=bad, warm=warm)
    assert res["requested"] == "CUSTOM"
    assert res["resolved"] == "SPY"
    assert res["label"] == rb.LABELS["SPY"]
    assert res["fallback"] == "no custom symbol"
    assert res["bars"] == fetch("SPY", "D", 4)
    assert warm.calls == []


@pytest.mark.parametrize("empty", [None, "", "   "])
def test_empty_custom_falls_to_spy_with_a_reason(empty):
    fetch, warm = _Fetch(), _Warm()
    res = rb.resolve_benchmark("NVDA", "CUSTOM", "D", 4, fetch, custom=empty, warm=warm)
    assert (res["resolved"], res["fallback"], res["note"]) == ("SPY", "no custom symbol", None)
    assert fetch.calls == [("SPY", "D", 4)]
    assert warm.calls == []


def test_same_symbol_resolves_as_itself_and_never_warms():
    fetch, warm = _Fetch(have=()), _Warm()
    res = rb.resolve_benchmark("nvda", "CUSTOM", "D", 5, fetch, custom="NVDA", warm=warm)
    assert res["resolved"] == "NVDA"
    assert res["label"] == "NVDA"
    assert res["fallback"] is None
    assert res["note"] is None
    assert warm.calls == []   # the chart's own bars are the chart's business


def test_no_bars_resolves_as_the_ticker_with_empty_bars_and_warms_once(_fresh_memo):
    fetch, warm = _Fetch(), _Warm()
    res = rb.resolve_benchmark("NVDA", "CUSTOM", "D", 5, fetch, custom="zzzq", warm=warm)
    # ⛔ never a silent swap to SPY for a valid ticker
    assert res == {"requested": "CUSTOM", "resolved": "ZZZQ", "label": "ZZZQ", "fallback": None,
                   "bars": [], "note": "No ZZZQ bars yet; they usually load within a minute"}
    assert fetch.calls == [("ZZZQ", "D", 5)]
    assert warm.calls == ["ZZZQ"]

    # Again within ten minutes: same answer, no second warm.
    _fresh_memo["t"] += 599.0
    again = rb.resolve_benchmark("NVDA", "CUSTOM", "W", 5, fetch, custom="ZZZQ", warm=warm)
    assert again["resolved"] == "ZZZQ" and again["bars"] == []
    assert warm.calls == ["ZZZQ"]

    # Another ticker has its own memo entry.
    rb.resolve_benchmark("NVDA", "CUSTOM", "D", 5, fetch, custom="QQQZ", warm=warm)
    assert warm.calls == ["ZZZQ", "QQQZ"]

    # After ten minutes the ticker may be warmed again.
    _fresh_memo["t"] += 1.0
    rb.resolve_benchmark("NVDA", "CUSTOM", "D", 5, fetch, custom="ZZZQ", warm=warm)
    assert warm.calls == ["ZZZQ", "QQQZ", "ZZZQ"]


def test_no_bars_without_a_warm_callable_still_resolves_honestly():
    res = rb.resolve_benchmark("NVDA", "CUSTOM", "D", 5, _Fetch(), custom="ZZZQ")
    assert (res["resolved"], res["bars"], res["fallback"]) == ("ZZZQ", [], None)
    assert res["note"] == rb.custom_no_bars_note("ZZZQ")


def test_a_failing_warm_never_breaks_the_resolution():
    def boom(_t):
        raise RuntimeError("pool gone")
    res = rb.resolve_benchmark("NVDA", "CUSTOM", "D", 5, _Fetch(), custom="ZZZQ", warm=boom)
    assert (res["resolved"], res["bars"]) == ("ZZZQ", [])
    assert "ZZZQ" in rb._custom_warmed    # claimed before the call: no retry storm


def test_warm_memo_is_thread_safe():
    """Many request threads racing on one cold ticker warm it exactly once, even
    while the first warm is still running (the memo is claimed before the call)."""
    import time as _time

    class _SlowWarm(_Warm):
        def __call__(self, ticker):
            _time.sleep(0.05)
            super().__call__(ticker)
    warm = _SlowWarm()
    start = threading.Barrier(16)

    def go():
        start.wait()
        rb.resolve_benchmark("NVDA", "CUSTOM", "D", 3, _Fetch(), custom="ZZZQ", warm=warm)

    threads = [threading.Thread(target=go) for _ in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert warm.calls == ["ZZZQ"]


def test_warm_memo_prunes_expired_entries(monkeypatch, _fresh_memo):
    monkeypatch.setattr(rb, "_CUSTOM_WARM_MEMO_PRUNE_AT", 3)
    warm = _Warm()
    for t in ("AAA", "BBB", "CCC"):
        rb._warm_custom_once(t, warm)
    _fresh_memo["t"] += 700.0
    rb._warm_custom_once("DDD", warm)
    assert set(rb._custom_warmed) == {"DDD"}


@pytest.mark.parametrize("etf", ["SMH", "ARKK", "QQQ", "XLK"])
def test_an_etf_is_allowed_as_a_custom_benchmark(etf):
    """D4: ETFs included — the SECTOR rule that swaps an ETF *chart* to SPY does
    not apply to a custom benchmark that IS an ETF."""
    fetch = _Fetch()
    res = rb.resolve_benchmark("NVDA", "CUSTOM", "D", 5, fetch, custom=etf.lower())
    assert (res["resolved"], res["label"], res["fallback"]) == (etf, etf, None)
    assert res["bars"] == fetch(etf, "D", 5)


def test_custom_on_an_etf_chart_is_not_swapped(monkeypatch):
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Financial", "industry": rb.ETF_INDUSTRY})
    res = rb.resolve_benchmark("SPY", "CUSTOM", "D", 5, _Fetch(), custom="SMH")
    assert (res["resolved"], res["fallback"]) == ("SMH", None)


# ── the existing benchmarks are untouched ────────────────────────────────────

@pytest.mark.parametrize("req", ["SPY", "QQQ", "IWM", "RSP", "SECTOR", "INDUSTRY", None])
def test_custom_and_warm_are_ignored_for_every_other_benchmark(req):
    warm = _Warm()
    plain = rb.resolve_benchmark("NVDA", req, "D", 5, _Fetch())
    withc = rb.resolve_benchmark("NVDA", req, "D", 5, _Fetch(), custom="AAPL", warm=warm)
    assert withc == plain
    assert "note" not in plain
    assert warm.calls == []


def test_unknown_benchmark_still_raises_with_the_same_message():
    with pytest.raises(ValueError) as e:
        rb.resolve_benchmark("NVDA", "XYZ", "D", 5, _Fetch(), custom="AAPL")
    assert str(e.value) == ("unknown benchmark 'XYZ'; the vocabulary is "
                            "('SPY', 'QQQ', 'IWM', 'RSP', 'SECTOR', 'INDUSTRY')")


def test_resolver_makes_no_network_call(monkeypatch):
    """The resolver reads only what it is handed: a socket opened during a
    CUSTOM resolution is a failure."""
    import socket

    def no_net(*_a, **_k):
        raise AssertionError("network call from rs_benchmarks")
    monkeypatch.setattr(socket, "create_connection", no_net)
    monkeypatch.setattr(socket.socket, "connect", no_net)
    for c in ("AAPL", "ZZZQ", "", "$SPX", "NVDA"):
        rb.resolve_benchmark("NVDA", "CUSTOM", "D", 5, _Fetch(), custom=c, warm=_Warm())
