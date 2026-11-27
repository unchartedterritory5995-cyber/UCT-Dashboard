"""`bars_sqlite.put_bars_many(..., rejected_out=)` names the tickers the impossible-bar gate refused (review of #2738).

The live store notes each ticker's newest written row as that ticker's proof (`bars_live_store.proven_through_s`); a
batch is the covered universe, so it must know WHICH tickers were refused, not only that the count fell short.
All data synthetic."""
from api.services import bars_sqlite


def _bar(t, o=10.0, h=11.0, l=9.0, c=10.5, v=100):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_put_bars_many_names_the_refused_tickers(monkeypatch):
    calls = []

    def _writable(ticker, tf, bars):
        calls.append(ticker)
        return ([], list(bars)) if ticker == "BAD" else (list(bars), [])
    monkeypatch.setattr(bars_sqlite, "_writable_bars", _writable)
    monkeypatch.setattr(bars_sqlite, "_grid_rows", lambda ticker, tf, keep, _x: (keep, []))

    class _C:
        def executemany(self, *_a):
            return None

        def commit(self):
            return None
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: _C())
    monkeypatch.setattr(bars_sqlite, "_history_keys", lambda *a, **k: set())
    monkeypatch.setattr(bars_sqlite, "bump_series_revs", lambda *a, **k: None)
    out = set()
    n = bars_sqlite.put_bars_many("1", {"GOOD": [_bar(1795530300)], "BAD": [_bar(1795530300)]}, rejected_out=out)
    assert n == 1
    assert out == {"BAD"}
    assert sorted(calls) == ["BAD", "GOOD"]
