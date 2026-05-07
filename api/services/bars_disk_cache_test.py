"""Tests for api.services.bars_disk_cache.delete().

The new delete() function powers the surgical refresh endpoint. It must
remove exactly the targeted (ticker, tf) files and leave everything else
alone — operators rely on the count it returns to verify the operation."""
import json
import os


def _reload_disk_cache():
    import importlib
    from api.services import bars_disk_cache
    importlib.reload(bars_disk_cache)
    return bars_disk_cache


def _seed(disk_cache, ticker: str, tf: str, bars: int, payload: dict):
    """Call the real put() so the file format matches production."""
    disk_cache.put(ticker, tf, bars, payload)


def test_delete_removes_only_specified_ticker_and_tf(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    dc = _reload_disk_cache()

    _seed(dc, "AAPL", "30", 200, {"bars": [1]})
    _seed(dc, "AAPL", "30", 500, {"bars": [1, 2]})
    _seed(dc, "AAPL", "60", 200, {"bars": [3]})  # different tf — survives
    _seed(dc, "TSLA", "30", 200, {"bars": [4]})  # different ticker — survives

    n = dc.delete("AAPL", "30")
    assert n == 2

    # The two remaining files must still be readable
    assert dc.get("AAPL", "60", 200) is not None
    assert dc.get("TSLA", "30", 200) is not None

    # The two we deleted are gone
    assert dc.get("AAPL", "30", 200) is None
    assert dc.get("AAPL", "30", 500) is None


def test_delete_with_no_tf_wipes_all_tfs_for_ticker(tmp_path, monkeypatch):
    """Calling delete(ticker) without a tf is the 'wipe everything for
    this ticker' path — used by /api/admin/refresh-bars when the operator
    doesn't specify a tf parameter."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    dc = _reload_disk_cache()

    _seed(dc, "AAPL", "1", 200, {"bars": [1]})
    _seed(dc, "AAPL", "30", 200, {"bars": [2]})
    _seed(dc, "AAPL", "D", 200, {"bars": [3]})
    _seed(dc, "TSLA", "30", 200, {"bars": [4]})

    n = dc.delete("AAPL")
    assert n == 3
    assert dc.get("TSLA", "30", 200) is not None  # untouched


def test_delete_missing_ticker_returns_zero(tmp_path, monkeypatch):
    """No matching files = no error. Idempotent operation."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    dc = _reload_disk_cache()
    _seed(dc, "AAPL", "30", 200, {"bars": [1]})
    assert dc.delete("NEVER_SEEN") == 0


def test_delete_when_cache_dir_missing_returns_zero(tmp_path, monkeypatch):
    """Cold start — bars_cache directory hasn't been created yet. delete()
    must NOT crash; it returns 0 and lets the next put() create the dir
    organically."""
    # Point at a directory that doesn't have bars_cache yet
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "fresh"))
    dc = _reload_disk_cache()
    assert dc.delete("AAPL") == 0


def test_delete_ticker_case_insensitive(tmp_path, monkeypatch):
    """Tickers are stored uppercase in cache filenames; passing lowercase
    must still match (operators may not always uppercase their input)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    dc = _reload_disk_cache()
    _seed(dc, "AAPL", "30", 200, {"bars": [1]})
    n = dc.delete("aapl", "30")
    assert n == 1


def test_delete_does_not_remove_unrelated_files(tmp_path, monkeypatch):
    """Defensive: if some non-bars JSON ends up in bars_cache somehow
    (manual operator action, foreign code path, etc.), delete() must
    not eat it. The filename pattern check (>= 3 underscore-separated
    parts) is what protects us."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    dc = _reload_disk_cache()
    _seed(dc, "AAPL", "30", 200, {"bars": [1]})

    # Drop a foreign file in the cache dir
    cache_dir = os.path.join(str(tmp_path), "bars_cache")
    with open(os.path.join(cache_dir, "stranger.json"), "w") as f:
        json.dump({"hello": "world"}, f)
    with open(os.path.join(cache_dir, "two_parts.json"), "w") as f:
        json.dump({"hello": "world"}, f)

    dc.delete("AAPL", "30")
    # Foreign files preserved
    assert os.path.exists(os.path.join(cache_dir, "stranger.json"))
    assert os.path.exists(os.path.join(cache_dir, "two_parts.json"))
