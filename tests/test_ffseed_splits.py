"""The first-frame seed manifest's next-session split list (api/services/ffseed.py
`next_session_splits`), read by the device store's split guard
(app/src/data/deviceStore/engine.js `_basisHolds` / `_splitsOf`).

The guard fails CLOSED without the field, so what is pinned here is the difference between "no split"
and "could not ask": the field appears only when Massive answered completely for the next session, it
names every seed symbol with a split executing that session (forward or reverse, either vendor
spelling), and `symbols` is the OBJECT the device reads.
"""
from datetime import date

import pytest

from api.services import ffseed, massive, reference_corp_actions as rca


class _FakeClient:
    """The typed transport massive_adapter reads through (as in tests/test_reference_corp_actions.py)."""
    _api_key = "k"

    def __init__(self, pages=None, boom=None):
        self._pages = list(pages or [])
        self.boom = boom
        self.urls = []

    def _typed_get(self, path, *, timeout=None):
        self.urls.append(path)
        if self.boom:
            raise self.boom
        return self._pages.pop(0) if self._pages else {}


def _rows(*items):
    return [{"ticker": t, "execution_date": d, "split_from": f, "split_to": to} for t, d, f, to in items]


def _no_fmp(sym):
    return []


@pytest.mark.parametrize("asof, want", [
    (date(2026, 11, 18), date(2026, 11, 19)),       # Wed -> Thu
    (date(2026, 11, 20), date(2026, 11, 23)),       # Fri -> Mon
    (date(2026, 11, 25), date(2026, 11, 27)),       # Thanksgiving skipped (the 27th is a half day: a session)
    (date(2026, 12, 24), date(2026, 12, 28)),       # Christmas Friday skipped
])
def test_next_session_is_the_next_nyse_trading_day(asof, want):
    assert ffseed.next_session(asof) == want


def test_names_every_seed_symbol_splitting_next_session_in_the_seed_spelling():
    asked = []

    def massive_rows(session):
        asked.append(session)
        return _rows(("BRK.B", "2026-11-19", 1, 2),        # the vendor's dot spelling of BRK-B
                     ("ZZREV", "2026-11-19", 10, 1),       # a 1-for-10 reverse split
                     ("NOTSEED", "2026-11-19", 1, 4),      # not a seed symbol
                     ("ZZLATER", "2026-11-20", 1, 3),      # a later session: not this list
                     ("ZZODD", "2026-11-19", None, 2))     # no usable ratio: still named
    sp = ffseed.next_session_splits(date(2026, 11, 18), ["AAPL", "BRK-B", "ZZREV", "ZZLATER", "ZZODD"],
                                    massive_rows=massive_rows, fmp_cached=_no_fmp)
    assert asked == ["2026-11-19"]
    assert sp == {"session": "2026-11-19", "symbols": {"BRK-B": 2.0, "ZZODD": None, "ZZREV": 0.1}}


def test_symbols_is_the_object_the_device_reads_not_an_array():
    sp = ffseed.next_session_splits(date(2026, 11, 18), ["AAPL"],
                                    massive_rows=lambda s: _rows(("AAPL", s, 1, 4)), fmp_cached=_no_fmp)
    assert isinstance(sp["symbols"], dict) and list(sp["symbols"]) == ["AAPL"]   # Object.keys -> ["AAPL"]


def test_an_empty_list_only_when_massive_answered():
    sp = ffseed.next_session_splits(date(2026, 11, 18), ["AAPL"], massive_rows=lambda s: [], fmp_cached=_no_fmp)
    assert sp == {"session": "2026-11-19", "symbols": {}}

    def down(session):
        raise rca.CorpActionsUnavailable("Massive /v3/reference/splits failed: MassiveTransient")
    assert ffseed.next_session_splits(date(2026, 11, 18), ["AAPL"], massive_rows=down, fmp_cached=_no_fmp) is None


def test_the_serve_paths_fmp_list_can_add_a_name_and_never_remove_one():
    fmp = {"AAPL": [("2020-08-31", 4.0), ("2026-11-19", 2.0)], "MSFT": [("2026-11-20", 3.0)]}

    def fmp_cached(sym):
        if sym == "BOOM":
            raise RuntimeError("cache unreadable")
        return fmp.get(sym, [])

    sp = ffseed.next_session_splits(date(2026, 11, 18), ["AAPL", "MSFT", "NVDA", "BOOM"],
                                    massive_rows=lambda s: _rows(("NVDA", s, 1, 10)), fmp_cached=fmp_cached)
    assert sp["symbols"] == {"AAPL": 2.0, "NVDA": 10.0}


def test_the_default_sources_are_massive_strict_and_the_fmp_cache(monkeypatch):
    client = _FakeClient([{"results": _rows(("TSLA", "2026-11-19", 1, 3))}])
    monkeypatch.setattr(massive, "_get_client", lambda: client)
    seen = []
    monkeypatch.setattr(ffseed, "_fmp_cached_splits", lambda sym: seen.append(sym) or [])
    sp = ffseed.next_session_splits(date(2026, 11, 18), ["TSLA", "AAPL"])
    assert sp == {"session": "2026-11-19", "symbols": {"TSLA": 3.0}}
    assert "execution_date.gte=2026-11-19" in client.urls[0] and "execution_date.lte=2026-11-19" in client.urls[0]
    assert seen == ["AAPL"]                                    # TSLA is already named


def test_the_fmp_supplement_never_calls_the_vendor(monkeypatch):
    from api.services import bars_sanitize
    calls = []
    monkeypatch.setattr(bars_sanitize, "_fetch_meta", lambda t: calls.append(t) or {"ipo": None, "splits": []})
    monkeypatch.setattr(bars_sanitize._warm_pool, "submit", lambda fn, *a: calls.append("submit"))
    assert ffseed._fmp_cached_splits("ZZCOLDNEVERSEEN") == []            # a cold cache entry
    assert calls == []


def test_strict_read_raises_where_the_sweep_answers_empty(monkeypatch):
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeClient(
        boom=massive.MassiveTransient("provider down", vendor="massive", status=503)))
    with pytest.raises(rca.CorpActionsUnavailable):
        rca.fetch_confirmed_splits_strict("2026-11-19", "2026-11-19")
    assert rca.fetch_confirmed_splits("2026-11-19", "2026-11-19") == []          # the sweep keeps its contract
    # more pages than the bound: a truncated window is refused, never read as complete
    endless = [{"results": [], "next_url": "https://api.massive.com/v3/reference/splits?cursor=x"}] * 30
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeClient(endless))
    with pytest.raises(rca.CorpActionsUnavailable):
        rca.fetch_confirmed_splits_strict("2026-11-19", "2026-11-19")


def test_the_manifest_carries_the_list_or_omits_it(monkeypatch):
    asof = date(2026, 11, 18)
    table = {("AAA", "D"): [{"t": asof.isoformat(), "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}]}

    def read(sym, tf, count):
        rows = table.get((sym, tf), [])
        return rows[-count:], len(rows)

    monkeypatch.setattr(ffseed, "_fmp_cached_splits", _no_fmp)
    monkeypatch.setattr(ffseed, "_massive_split_rows", lambda s: _rows(("AAA", s, 1, 2)))
    m = ffseed.build(tfs=["D"], symbols=["AAA"], asof=asof, read=read, min_symbols=1)["manifest"]
    assert m["splits"] == {"session": "2026-11-19", "symbols": {"AAA": 2.0}}

    def down(session):
        raise rca.CorpActionsUnavailable("down")
    monkeypatch.setattr(ffseed, "_massive_split_rows", down)
    built = ffseed.build(tfs=["D"], symbols=["AAA"], asof=asof, read=read, min_symbols=1)
    assert "splits" not in built["manifest"]                  # the guard stays closed ...
    assert built["packs"]["D"]                                 # ... and the build still publishes
