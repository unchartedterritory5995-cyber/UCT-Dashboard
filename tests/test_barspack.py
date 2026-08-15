"""Universe Bars Pack builder (api/services/barspack.py).

The critical property: what the client reconstructs from a shard must be
byte-identical to the sanitized serve-shaped bars fed into the pack — because
those are exactly what /api/bars serves (barspack reads them via the same
_fmt_sqlite_bars serve path). These tests pin the encode/decode round-trip,
stable sharding, and the size-floor gate that stops an empty pack from
overwriting a good one.
"""
import gzip
import json

import pytest

from api.services import barspack


def _synthetic_bars(sym, tf, depth):
    """Deterministic per (sym, tf) bars in the server shape (ISO date t)."""
    base = abs(hash((sym, tf))) % 50
    n = 3 + (abs(hash(sym)) % 4)   # 3..6 bars
    return [
        {
            "t": f"2026-08-{10 + i:02d}",
            "o": round(base + i + 0.1, 4),
            "h": round(base + i + 1.2, 4),
            "l": round(base + i - 0.3, 4),
            "c": round(base + i + 0.7, 4),
            "v": (base + i + 1) * 1000,
        }
        for i in range(n)
    ]


def _decode_shard(gz: bytes) -> dict:
    """Client-side reconstruction: columnar arrays → row bars [{t,o,h,l,c,v}]."""
    obj = json.loads(gzip.decompress(gz).decode("utf-8"))
    out = {}
    for sym, tfs in obj["tickers"].items():
        out[sym] = {}
        for tf, cols in tfs.items():
            n = len(cols["t"])
            out[sym][tf] = [
                {k: cols[k][i] for k in ("t", "o", "h", "l", "c", "v")}
                for i in range(n)
            ]
    return out


def test_columnar_roundtrip_is_exact():
    bars = _synthetic_bars("AAPL", "D", 300)
    cols = barspack._columnar(bars)
    n = len(cols["t"])
    rebuilt = [{k: cols[k][i] for k in ("t", "o", "h", "l", "c", "v")} for i in range(n)]
    assert rebuilt == bars


def test_shard_of_is_stable_and_in_range():
    for sym in ("AAPL", "NVDA", "BRK-B", "SPY", "A", "ZZZZ"):
        idx = barspack._shard_of(sym, 12)
        assert 0 <= idx < 12
        assert idx == barspack._shard_of(sym, 12)  # deterministic


def test_build_encodes_every_ticker_and_decodes_identically(monkeypatch):
    monkeypatch.setattr(barspack, "_sanitized_bars", _synthetic_bars)
    monkeypatch.setattr(barspack, "MIN_TICKERS", 1)
    monkeypatch.setattr(barspack, "MIN_BARS", 1)
    universe = [f"T{i:03d}" for i in range(200)]

    built = barspack.build(depth=300, num_shards=8, tickers=universe, date="2026-08-14")
    manifest = built["manifest"]
    shards = built["shards"]

    assert manifest["version"] == "2026-08-14"
    assert manifest["format"] == barspack.PACK_FORMAT
    assert manifest["ticker_count"] == 200
    # Numbered shards: every one named in the manifest is present, and vice-versa
    # (the delta file is tracked separately under manifest["delta"]).
    numbered = {k for k in shards if not k.endswith("/delta.json.gz")}
    assert {s["name"] for s in manifest["shards"]} == numbered
    assert manifest["delta"]["name"] in shards

    # Reconstruct the WHOLE universe from the numbered shards and compare.
    seen = {}
    total_bars = 0
    for key in numbered:
        for sym, tfs in _decode_shard(shards[key]).items():
            seen[sym] = tfs
            for tf, bars in tfs.items():
                total_bars += len(bars)
                assert bars == _synthetic_bars(sym, tf, 300)  # byte-identical
    assert set(seen) == set(universe)
    assert total_bars == manifest["bar_count"]


def test_build_emits_delta_tail(monkeypatch):
    monkeypatch.setattr(barspack, "_sanitized_bars", _synthetic_bars)
    monkeypatch.setattr(barspack, "MIN_TICKERS", 1)
    monkeypatch.setattr(barspack, "MIN_BARS", 1)
    monkeypatch.setattr(barspack, "_DELTA_TAIL", 2)
    universe = [f"T{i:03d}" for i in range(50)]

    built = barspack.build(depth=300, num_shards=4, tickers=universe, date="2026-08-14")
    dkey = built["manifest"]["delta"]["name"]
    assert dkey == "barspack/2026-08-14/delta.json.gz"
    assert dkey in built["shards"]

    # The delta holds the LAST _DELTA_TAIL bars of each series (or fewer).
    dpayload = _decode_shard(built["shards"][dkey])
    assert set(dpayload) == set(universe)
    for sym, tfs in dpayload.items():
        for tf, bars in tfs.items():
            full = _synthetic_bars(sym, tf, 300)
            assert bars == full[-2:]  # tail of exactly the full series


def test_build_refuses_below_floor(monkeypatch):
    monkeypatch.setattr(barspack, "_sanitized_bars", _synthetic_bars)
    monkeypatch.setattr(barspack, "MIN_TICKERS", 10_000)  # unreachable
    with pytest.raises(barspack.BarsPackError):
        barspack.build(depth=300, num_shards=4, tickers=["AAPL", "MSFT"], date="2026-08-14")


def test_build_skips_tickers_with_no_bars(monkeypatch):
    def _sparse(sym, tf, depth):
        return _synthetic_bars(sym, tf, depth) if sym == "AAPL" else []
    monkeypatch.setattr(barspack, "_sanitized_bars", _sparse)
    monkeypatch.setattr(barspack, "MIN_TICKERS", 1)
    monkeypatch.setattr(barspack, "MIN_BARS", 1)

    built = barspack.build(depth=300, num_shards=4, tickers=["AAPL", "EMPTY1", "EMPTY2"], date="2026-08-14")
    assert built["manifest"]["ticker_count"] == 1
    decoded = {}
    for gz in built["shards"].values():
        decoded.update(_decode_shard(gz))
    assert set(decoded) == {"AAPL"}


def test_sanitized_bars_uses_the_serve_path(monkeypatch):
    """_sanitized_bars must go through _fmt_sqlite_bars WITH the ticker (so the
    serve-time sanitize is applied) and never trigger a provider fetch."""
    calls = {}

    def _fake_get_bars(ticker, tf, depth):
        calls["get_bars"] = (ticker, tf, depth)
        return [(20260813, 1.0, 2.0, 0.5, 1.5, 100)]

    def _fake_fmt(rows, tf, ticker):
        calls["fmt"] = (tuple(rows), tf, ticker)
        return [{"t": "2026-08-13", "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}]

    import api.services.bars_sqlite as bs
    import api.services.bars_fetch as bf
    monkeypatch.setattr(bs, "get_bars", _fake_get_bars)
    monkeypatch.setattr(bf, "_fmt_sqlite_bars", _fake_fmt)

    out = barspack._sanitized_bars("AAPL", "D", 300)
    assert out and out[0]["t"] == "2026-08-13"
    assert calls["get_bars"] == ("AAPL", "D", 300)
    # ticker WAS passed to the formatter (→ sanitize applied)
    assert calls["fmt"][2] == "AAPL"


def test_build_suppresses_meta_warm(monkeypatch):
    """The builder must sanitize with warm-suppression active, so a universe
    sweep never schedules a provider (FMP) corporate-action fetch."""
    import api.services.bars_sanitize as san
    seen = {}

    def _fake_fmt(rows, tf, ticker):
        # Capture whether suppression is active at the moment sanitize runs.
        seen["suppressed"] = san._suppress_warm.get()
        return [{"t": "2026-08-13", "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100}]

    import api.services.bars_sqlite as bs
    import api.services.bars_fetch as bf
    monkeypatch.setattr(bs, "get_bars", lambda *a: [(20260813, 1.0, 2.0, 0.5, 1.5, 100)])
    monkeypatch.setattr(bf, "_fmt_sqlite_bars", _fake_fmt)

    barspack._sanitized_bars("AAPL", "D", 300)
    assert seen["suppressed"] is True
    # and the flag is reset afterwards (context cleanly exited)
    assert san._suppress_warm.get() is False
