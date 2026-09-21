"""THE CBOE PARSER — two file shapes, and the capability claim that follows from them.

⛔⛔ THE DEFECT THIS FILE EXISTS FOR WAS SILENT. Cboe publish `VIX_History.csv` as
`DATE,OPEN,HIGH,LOW,CLOSE` and `VVIX_History.csv` / `SKEW_History.csv` as
`DATE,<SYM>` — one close and nothing else. A parser that required five columns
ingested ZERO ROWS for the close-only families **while reporting success**.

And the fix is not only the parse. Whether a series has real OHLC decides whether a
member may be shown CANDLES, and a close-only series widened to `o=h=l=c` passes every
structural test there is while its body and range mean nothing.
"""
from __future__ import annotations

import pytest

from api.services.market_indicators import cboe_store as cs
from api.services.market_indicators import registry as reg


# ── The two shapes ───────────────────────────────────────────────────────────

def test_the_five_column_shape_parses_as_real_ohlc():
    rows, has_ohlc = cs.parse_csv(
        "DATE,OPEN,HIGH,LOW,CLOSE\n"
        "01/02/1990,17.240000,17.900000,17.100000,17.500000\n")
    assert has_ohlc is True
    assert rows == [{"date": "1990-01-02", "o": 17.24, "h": 17.9, "l": 17.1, "c": 17.5}]


def test_the_two_column_shape_parses_and_declares_itself_close_only():
    """⛔ THE ROW STILL CARRIES o/h/l — the bar shape is uniform — but `has_ohlc` is
    False, and that flag is what the capability gate reads."""
    rows, has_ohlc = cs.parse_csv("DATE,VVIX\n03/06/2006,71.730000\n")
    assert has_ohlc is False
    r = rows[0]
    assert r["o"] == r["h"] == r["l"] == r["c"] == 71.73


def test_a_five_column_parser_would_have_silently_dropped_the_close_only_family():
    """The regression, stated as a test: the close-only file must not yield zero rows."""
    rows, _ = cs.parse_csv("DATE,SKEW\n01/02/1990,126.09\n01/03/1990,123.34\n")
    assert len(rows) == 2, "this is the exact failure that reported success"


# ── Date handling ────────────────────────────────────────────────────────────

def test_cboe_dates_normalise_to_iso_days():
    """⛔⛔ ISO, NOT UNIX SECONDS. `symbolProjection` joins a secondary series onto the
    chart by EXACT `t`; `index_bars` emits unix seconds and therefore matches zero bars
    in a pane. Half the reason this lane exists."""
    rows, _ = cs.parse_csv("DATE,OPEN,HIGH,LOW,CLOSE\n1/2/1990,1,2,0.5,1.5\n"
                           "01/02/2026,1,2,0.5,1.5\n")
    assert [r["date"] for r in rows] == ["1990-01-02", "2026-01-02"]


def test_rows_come_back_oldest_first():
    rows, _ = cs.parse_csv("DATE,SKEW\n03/06/2006,1\n01/02/1990,2\n")
    assert [r["date"] for r in rows] == ["1990-01-02", "2006-03-06"]


def test_a_preamble_or_header_line_is_skipped_not_parsed():
    rows, _ = cs.parse_csv("some,disclaimer,text\nDATE,VVIX\n03/06/2006,71.73\n")
    assert len(rows) == 1


# ── Refusals ─────────────────────────────────────────────────────────────────

def test_an_inverted_bar_is_refused_rather_than_repaired():
    rows, _ = cs.parse_csv("DATE,OPEN,HIGH,LOW,CLOSE\n01/02/1990,17.24,10.0,20.0,17.5\n")
    assert rows == []


def test_absent_open_high_low_falls_back_to_the_close_not_to_zero():
    """⚠️ Cboe's earliest VIX rows carry 0 for o/h/l. Those are absent values, not
    prints — a candle wicking to zero volatility would be a fabricated extreme."""
    rows, has_ohlc = cs.parse_csv("DATE,OPEN,HIGH,LOW,CLOSE\n01/02/1990,0,0,0,17.5\n")
    assert rows[0]["l"] == 17.5 and rows[0]["h"] == 17.5
    assert has_ohlc is False, "a file of nothing but fallbacks is not an OHLC file"


def test_a_non_positive_close_is_dropped():
    rows, _ = cs.parse_csv("DATE,SKEW\n01/02/1990,0\n01/03/1990,-5\n01/04/1990,120\n")
    assert [r["date"] for r in rows] == ["1990-01-04"]


# ── The capability claim ─────────────────────────────────────────────────────

@pytest.mark.parametrize("sym,expected", [
    ("VIX9D", True), ("VIX3M", True), ("VIX6M", True), ("VXN", True), ("RVX", True),
    ("VVIX", False), ("SKEW", False),
])
def test_ohlc_capability_is_claimed_per_series(sym, expected):
    """⛔ PER SERIES, NEVER PER FAMILY. VVIX and SKEW are volatility indices and are
    NOT candle-capable; VIX9D is. A family-level claim would draw a tidy candlestick
    over a synthesised o=h=l=c whose body and range mean nothing."""
    row = reg.get(f"CBOE:{sym}")
    assert row is not None
    assert row.has_ohlc is expected
    assert row.ohlc_capable is expected


def test_every_published_volatility_row_is_eod_and_says_where_it_came_from():
    for s in reg.rows_for_family(reg.FAM_VOLATILITY):
        assert s.frequency == reg.FREQ_DAILY
        assert "cdn.cboe.com" in s.provenance
        assert "Cboe" in s.source_owner
        # the licensing position must state the real-time carve-out explicitly
        assert "real-time" in s.licensing.lower()


def test_the_volatility_family_never_claims_to_be_our_calculation():
    for s in reg.rows_for_family(reg.FAM_VOLATILITY):
        assert "UCT does not compute it" in s.methodology
        assert s.reproduces_reference is True


# ── The store must not ship EMPTY ────────────────────────────────────────────

def test_the_published_family_is_what_refresh_fetches():
    """⛔ THE LIST THE CATALOGUE ADVERTISES AND THE LIST THE REFRESH FILLS ARE ONE.

    A series published without a matching fetch is a series that renders nothing;
    a symbol fetched but not published is wasted bandwidth. `VIX` is deliberately
    absent from both — `api/index_bars.py` already owns that symbol.
    """
    published = {s.symbol for s in reg.rows_for_family(reg.FAM_VOLATILITY)}
    assert set(cs.PUBLISHED_SYMBOLS) == published, (
        f"catalogue={sorted(published)} refresh={sorted(cs.PUBLISHED_SYMBOLS)}")
    assert "VIX" not in cs.PUBLISHED_SYMBOLS
    for sym in cs.PUBLISHED_SYMBOLS:
        assert sym in cs.KNOWN_SYMBOLS


def test_the_refresh_is_actually_wired_into_boot():
    """⛔⛔ THE TOOL EXISTING IS NOT THE TOOL RUNNING.

    `tools/build_cboe_indices.py` was the only door into this store and nothing in
    the service ever opened it, so seven PUBLISHED series went live with zero rows.
    Same defect as the NAAIM seed, so it gets the same source-level rail.
    """
    import inspect
    import api.main as main
    src = inspect.getsource(main)
    i = src.index("_market_indicator_jobs")
    block = src[i:i + 900]
    assert "cboe_store" in block and ".refresh()" in block
    assert "threading.Thread(target=_market_indicator_jobs" in src
    assert ".start()" in src[src.index("threading.Thread(target=_market_indicator_jobs"):][:300]


def test_one_symbols_failure_cannot_cost_the_others(monkeypatch):
    """⚠️ PER-SYMBOL ISOLATION — a CDN hiccup on SKEW must not empty VIX9D."""
    calls = []

    def flaky(sym, timeout=60):
        calls.append(sym)
        if sym == "SKEW":
            raise TimeoutError("cdn said no")
        return "DATE,OPEN,HIGH,LOW,CLOSE\n01/02/1990,17.24,17.9,17.1,17.5\n"

    monkeypatch.setattr(cs, "fetch_csv", flaky)
    monkeypatch.setattr(cs, "upsert", lambda s, b: len(b))
    res = cs.refresh()
    assert res["ok"] is False, "a partial refresh must not report success"
    assert "SKEW" in res["errors"]
    assert res["ingested"].get("VIX9D") == 1, "the healthy symbols still ingested"
    assert len(calls) == len(cs.PUBLISHED_SYMBOLS), "every symbol was attempted"
