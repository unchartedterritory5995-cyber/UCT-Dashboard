"""The Breadth Pack (2026-10-10): sealed recent bars of every breadth series, versioned."""
import gzip
import json

from api.services import breadth_pack as bp


def _bars(n, last="2026-10-09"):
    out = []
    for i in range(n):
        out.append({"t": f"2026-09-{10 + i:02d}" if i < n - 1 else last, "o": i, "h": i, "l": i, "c": i})
    return out


def test_pack_builds_versioned_shards_and_drops_the_developing_bar(monkeypatch):
    monkeypatch.setattr(bp, "_today_et", lambda: "2026-10-09")
    monkeypatch.setattr(bp, "_symbols", lambda: [("UCTA50", "uct", "base"), ("NYSE:A50", "nyse", "base"),
                                                 ("NASDAQ:MCS", "nasdaq", "indicator")])
    monkeypatch.setattr(bp, "_bars_for", lambda sym, kind: _bars(5))
    bp._state.update(version=None, shards={}, manifest=None)
    r = bp.refresh()
    assert r["ok"] and r["series"] == 3
    m = bp.manifest()
    assert m["available"] and m["ticker_count"] == 3 and len(m["shards"]) == 4
    doc = json.loads(gzip.decompress(bp.shard(m["version"], 0)))
    cols = doc["tickers"]["UCTA50"]["D"]
    assert cols["t"][-1] < "2026-10-09" and len(cols["t"]) == 4      # today's bar dropped
    assert "NASDAQ:MCS" in json.loads(gzip.decompress(bp.shard(m["version"], 3)))["tickers"]
    # unchanged inputs → same version, no rebuild
    assert bp.refresh().get("unchanged")
    # a change → new version; the previous one stays addressable
    old = m["version"]
    monkeypatch.setattr(bp, "_bars_for", lambda sym, kind: _bars(6))
    assert bp.refresh()["version"] != old
    assert bp.shard(old, 0) is not None and bp.shard("bnope", 0) is None
