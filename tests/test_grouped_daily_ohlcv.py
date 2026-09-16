"""`get_grouped_daily_ohlcv` keeps the whole bar, and caches settled days durably."""
import json

import pytest

from api.services import massive
from api.services.cache import cache


class _Client:
    """Stands in for the provider client, recording every URL it is asked for."""
    _api_key = "k"

    def __init__(self, holder, calls):
        self._holder = holder
        self._calls = calls

    def _get(self, url):
        self._calls.append(url)
        return self._holder["payload"]


FULL = {"results": [
    {"T": "AAPL", "o": 10.0, "h": 12.5, "l": 9.5, "c": 11.0, "v": 1_000_000},
    {"T": "msft", "o": 20.0, "h": 21.0, "l": 19.0, "c": 20.5, "v": 2_000_000},
    {"T": "NOVOL", "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0},          # v missing
    {"T": "ZERO", "o": 1.0, "h": 1.0, "l": 1.0, "c": 0.0, "v": 5},   # non-positive close
]}


@pytest.fixture()
def wired(tmp_path, monkeypatch):
    """(holder, calls, dir) with an empty cache and a throwaway durable dir."""
    calls, holder = [], {"payload": FULL}
    monkeypatch.setattr(massive, "_get_client", lambda: _Client(holder, calls))
    monkeypatch.setattr(massive, "_GROUPED_OHLCV_DIR", str(tmp_path / "grouped_ohlcv"))
    with cache._lock:
        cache._store.clear()
    yield holder, calls, tmp_path / "grouped_ohlcv"
    with cache._lock:
        cache._store.clear()


def test_every_ohlc_field_survives_the_fetch(wired):
    _holder, _calls, _dir = wired
    got = massive.get_grouped_daily_ohlcv("2015-03-10", adjusted=True)
    assert got["AAPL"] == {"o": 10.0, "h": 12.5, "l": 9.5, "c": 11.0, "v": 1_000_000.0}
    assert got["MSFT"]["h"] == 21.0          # symbols upper-cased
    assert got["NOVOL"]["v"] == 0.0          # a missing volume is 0.0, not absent
    assert "ZERO" not in got                 # a non-positive close is not a bar


def test_a_missing_field_is_None_not_a_substituted_close(wired):
    holder, _calls, _dir = wired
    holder["payload"] = {"results": [{"T": "ODD", "c": 5.0, "v": 10}]}
    got = massive.get_grouped_daily_ohlcv("2015-03-11", adjusted=True)
    # ⛔ A metric that needs a high must be able to tell "no high" from "the high
    # happened to equal the close".
    assert got["ODD"]["h"] is None and got["ODD"]["o"] is None
    assert got["ODD"]["c"] == 5.0


def test_a_settled_day_persists_and_is_not_refetched_after_a_restart(wired):
    _holder, calls, cdir = wired
    massive.get_grouped_daily_ohlcv("2015-03-12", adjusted=False)
    assert len(calls) == 1
    path = cdir / "2015-03-12_0.json"
    assert path.exists(), "a settled historical frame must survive a redeploy"
    assert json.loads(path.read_text())["AAPL"]["l"] == 9.5

    with cache._lock:                      # simulate a restart: memory gone, disk kept
        cache._store.clear()
    again = massive.get_grouped_daily_ohlcv("2015-03-12", adjusted=False)
    assert again["AAPL"]["c"] == 11.0
    assert len(calls) == 1, "a settled day must never be fetched twice"


def test_raw_and_adjusted_are_separate_entries(wired):
    _holder, _calls, cdir = wired
    massive.get_grouped_daily_ohlcv("2015-03-13", adjusted=True)
    massive.get_grouped_daily_ohlcv("2015-03-13", adjusted=False)
    # Eligibility reads the RAW frame; the MA matrix reads the ADJUSTED one. Conflating
    # them would put a pre-split and a post-split price in one average.
    assert {p.name for p in cdir.iterdir()} == {"2015-03-13_0.json", "2015-03-13_1.json"}


def test_an_empty_answer_is_never_cached(wired):
    holder, calls, cdir = wired
    holder["payload"] = {"results": []}
    assert massive.get_grouped_daily_ohlcv("2015-03-14", adjusted=False) == {}
    assert not cdir.exists() or not (cdir / "2015-03-14_0.json").exists()
    # a holiday miss must not pin — the next call still asks
    massive.get_grouped_daily_ohlcv("2015-03-14", adjusted=False)
    assert len(calls) == 2
