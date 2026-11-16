"""`resolve()` / `is_breadth_symbol()` answer an ordinary ticker without building the library rows.

⚰️ 2026-11-16 16:42Z: the first chart request after a deploy (`/api/bars-history`, an `async`
route, so ON the event loop) asked `is_breadth_symbol` about an ordinary ticker. That built the
library index, whose rows now carry `display_floor()`, which reads the exchange authority's SQLite
history cold. The loop froze for 127 s and the whole site with it. Captured mid-stall by the
event-loop watchdog.

What must stay true:
  * the fast-reject keys ARE the index's keys (same sources, nothing more, nothing less);
  * an ordinary ticker is answered with no row built and no disk touched;
  * every breadth identity and alias resolves exactly as before (the control: a real one
    still builds the index, so the "no build" check can see a build).
"""
import pytest

from api.services import breadth_symbols as bs


def test_the_fast_reject_keys_are_exactly_the_index_keys():
    assert bs._library_keys() == frozenset(bs._library_index())
    assert len(bs._library_keys()) > len(bs.SYMBOLS)        # namespaced identities and aliases included


@pytest.fixture()
def cold(monkeypatch):
    """A cold process: no index, no keys, and a record of every row build / floor read."""
    calls = []
    real_rows, real_floor = bs.library_rows, bs.display_floor
    monkeypatch.setattr(bs, "_LIBRARY_INDEX", None)
    monkeypatch.setattr(bs, "_LIBRARY_KEYS", None)
    monkeypatch.setattr(bs, "library_rows", lambda *a, **k: calls.append("rows") or real_rows(*a, **k))
    monkeypatch.setattr(bs, "display_floor", lambda uid: calls.append("floor") or real_floor(uid))
    return calls


@pytest.mark.parametrize("ticker", ["AAPL", "NVDA", "UCTT", "SPY", "NASDAQ:AAPL", "FOO:BAR", "US:NOPE", "BRK.B"])
def test_an_ordinary_ticker_builds_no_rows_and_reads_no_floor(cold, ticker):
    assert bs.is_breadth_symbol(ticker) is False
    assert bs.resolve(ticker) is None and bs.resolve(ticker, published_only=False) is None
    assert cold == []


def test_the_control_a_real_identity_still_builds_the_index(cold):
    namespaced = sorted(k for k in bs._library_keys() if ":" in k and k not in bs.SYMBOLS)
    assert namespaced
    row = bs.resolve(namespaced[0], published_only=False)
    assert row is not None and "rows" in cold                # the check above could have seen a build


def test_every_identity_and_alias_resolves_as_the_index_says():
    idx = bs._library_index()
    for key, row in idx.items():
        assert bs.resolve(key, published_only=False) == row, key
        assert bs.resolve(key.lower(), published_only=False) == row, key
    for key in bs.SYMBOLS:
        assert bs.is_breadth_symbol(key) is True
