"""Tests for api/services/ticker_ipo.get_ipo_date — the chart IPO-badge date source."""
import importlib

import pytest


@pytest.fixture
def ipo_mod(tmp_path, monkeypatch):
    """Fresh ticker_ipo module with an isolated (temp) cache dir + empty mem cache."""
    import api.services.ticker_ipo as mod
    importlib.reload(mod)
    monkeypatch.setattr(mod, "_CACHE_DIR", str(tmp_path / "ipo_cache"))
    mod._mem.clear() if hasattr(mod._mem, "clear") else None
    return mod


def _patch_details(monkeypatch, mod, result):
    from api.services import massive
    monkeypatch.setattr(massive, "get_ticker_details", lambda t: result)


def test_returns_valid_list_date(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "2019-03-14", "name": "X"})
    out = ipo_mod.get_ipo_date("ABC")
    assert out == {"symbol": "ABC", "list_date": "2019-03-14"}


def test_missing_list_date_is_null(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"name": "X"})  # no list_date
    out = ipo_mod.get_ipo_date("NODATE")
    assert out["list_date"] is None


def test_malformed_list_date_rejected(ipo_mod, monkeypatch):
    _patch_details(monkeypatch, ipo_mod, {"list_date": "not-a-date"})
    assert ipo_mod.get_ipo_date("BADFMT")["list_date"] is None


def test_provider_error_returns_null_uncached(ipo_mod, monkeypatch):
    from api.services import massive
    def boom(_t):
        raise RuntimeError("provider down")
    monkeypatch.setattr(massive, "get_ticker_details", boom)
    assert ipo_mod.get_ipo_date("ERR")["list_date"] is None
    # A null miss must NOT be cached — a later good call resolves it.
    monkeypatch.setattr(massive, "get_ticker_details", lambda t: {"list_date": "2020-06-01"})
    assert ipo_mod.get_ipo_date("ERR")["list_date"] == "2020-06-01"


def test_blank_symbol(ipo_mod):
    assert ipo_mod.get_ipo_date("")["list_date"] is None


def test_valid_date_is_cached(ipo_mod, monkeypatch):
    calls = {"n": 0}
    def details(_t):
        calls["n"] += 1
        return {"list_date": "2021-01-04"}
    from api.services import massive
    monkeypatch.setattr(massive, "get_ticker_details", details)
    assert ipo_mod.get_ipo_date("CACHE")["list_date"] == "2021-01-04"
    assert ipo_mod.get_ipo_date("CACHE")["list_date"] == "2021-01-04"
    assert calls["n"] == 1  # second call served from mem cache
