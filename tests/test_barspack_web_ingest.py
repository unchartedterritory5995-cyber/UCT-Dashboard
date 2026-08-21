"""Web-side Bars Pack ingest (api/services/barspack_web_ingest.py).

Folds the universe D/W/M pack into web's bars.db, ADD-ONLY and MISSING-SERIES-ONLY,
so a cold long-tail view serves from SQLite instead of a provider fetch.
"""
import gzip
import json

import api.services.barspack_web_ingest as bpwi


def _cols(bars):
    return {"t": [b["t"] for b in bars], "o": [b["o"] for b in bars],
            "h": [b["h"] for b in bars], "l": [b["l"] for b in bars],
            "c": [b["c"] for b in bars], "v": [b["v"] for b in bars]}


def test_decode_shard_roundtrips_and_is_defensive():
    d = [{"t": "2026-08-20", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100},
         {"t": "2026-08-21", "o": 1.5, "h": 2.2, "l": 1.4, "c": 2.0, "v": 200}]
    obj = {"tickers": {"aaa": {"D": _cols(d), "W": _cols(d[:1])}}}
    out = dict(((sym, tf), bars) for sym, tf, bars in bpwi.decode_shard(obj))
    assert out[("AAA", "D")] == d
    assert out[("AAA", "W")] == d[:1]
    # defensive
    assert bpwi.decode_shard(None) == []
    assert bpwi.decode_shard({}) == []
    assert bpwi.decode_shard({"tickers": {"X": None}}) == []
    assert bpwi.decode_shard({"tickers": {"X": {"D": {"t": []}}}}) == []


def _wire(monkeypatch, tmp_path, *, present):
    """Stub R2 (manifest + one shard) and bars_sqlite; `present` = set of syms web
    already has. Returns the list of put_bars calls."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    d = [{"t": "2026-08-21", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}]
    manifest = {"version": "2026-08-21", "shards": [{"idx": 0, "name": "barspack/2026-08-21/000.json.gz"}]}
    shard = {"format": 1, "tickers": {"NEWCO": {"D": _cols(d)}, "HAVE": {"D": _cols(d)}}}
    gz = gzip.compress(json.dumps(shard).encode())

    def _get_bytes(key):
        if key.endswith("latest.json"):
            return json.dumps(manifest).encode()
        if key.endswith("000.json.gz"):
            return gz
        return None

    calls = []
    import api.services.data_sync as ds
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(ds, "get_bytes", _get_bytes)
    monkeypatch.setattr(bs, "get_last_ts", lambda sym, tf: (20260101 if sym in present else None))
    monkeypatch.setattr(bs, "put_bars",
                        lambda sym, tf, bars, date_tf=False, on_conflict="replace":
                        (calls.append((sym, tf, date_tf, on_conflict)) or len(bars)))
    return calls, manifest["version"]


def test_ingest_writes_only_missing_series_add_only(monkeypatch, tmp_path):
    calls, version = _wire(monkeypatch, tmp_path, present={"HAVE"})
    res = bpwi.ingest_once()

    assert res["ok"] is True
    assert res["series"] == 1                      # only NEWCO written
    assert calls == [("NEWCO", "D", True, "ignore")]  # add-only, date_tf, missing only
    assert res["skipped_present"] == 1             # HAVE left untouched
    assert bpwi._last_ingested_version() == version  # marker stamped


def test_ingest_is_noop_when_version_already_stamped(monkeypatch, tmp_path):
    calls, version = _wire(monkeypatch, tmp_path, present=set())
    bpwi._stamp_version(version)                   # pretend a prior cycle did it
    res = bpwi.ingest_once()
    assert res["reason"] == "already ingested"
    assert calls == []                             # no writes


def test_ingest_handles_missing_manifest(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import api.services.data_sync as ds
    monkeypatch.setattr(ds, "get_bytes", lambda k: None)
    res = bpwi.ingest_once()
    assert res["ok"] is False and res["reason"] == "no manifest"


def test_shard_idx_resolves_int_or_name():
    assert bpwi._shard_idx({"idx": 3}) == 3
    assert bpwi._shard_idx({"idx": "5"}) == 5
    assert bpwi._shard_idx({"name": "barspack/2026-08-21/007.json.gz"}) == 7
    assert bpwi._shard_idx({"name": "garbage"}) is None
