"""Rails for the Phase 2 A-close guard (intraday integrity).

The per-second "A" aggregate nudges ONLY the developing close, but that close is
UNFILTERED (Massive computes it over all prints of the second, ghosts included, and
an A event carries no condition codes). When BARS_A_CLOSE_GUARD_ENABLED is on, a
SIP-eligible T trade that set the close within A_CLOSE_GUARD_MS wins — the unfiltered
A-close is skipped. On a thin ticker with no recent real trade, A still serves as the
fallback (unchanged). Off by default → byte-identical old behavior.

State is inspected via _partials directly (updated before emit); _emit is stubbed so
the test needs no event loop / subscribers.
"""
from api.services import bar_broadcaster as bb

# One shared timestamp so the T trade and the A/AM bars land in the same bucket.
_T = 1_700_000_000_000  # ms (Massive trade + aggregate `t` are ms)


def _mk():
    b = bb.BarBroadcaster()
    b._emit = lambda *a, **k: None  # isolate: we only assert on _partials state
    return b


def _push_T(b, sym, price, size=100, t=_T, cond=None):
    b.push_aggregate(sym, {"t": t, "p": price, "s": size, "c": cond}, "T")


def _push_A(b, sym, close, t=_T):
    b.push_aggregate(sym, {"t": t, "o": close, "h": close, "l": close, "c": close, "v": 1}, "A")


def _push_AM(b, sym, close, t=_T):
    b.push_aggregate(sym, {"t": t, "o": close, "h": close, "l": close, "c": close, "v": 1}, "AM")


def _close(b, sym, tf="5"):
    return b._partials[(sym.upper(), tf)]["c"]


class _Guard:
    """Temporarily set the module-level guard flags (restored on exit)."""
    def __init__(self, enabled, ms=2000):
        self.enabled, self.ms = enabled, ms

    def __enter__(self):
        self._e, self._m = bb.A_CLOSE_GUARD_ENABLED, bb.A_CLOSE_GUARD_MS
        bb.A_CLOSE_GUARD_ENABLED = self.enabled
        bb.A_CLOSE_GUARD_MS = self.ms
        return self

    def __exit__(self, *a):
        bb.A_CLOSE_GUARD_ENABLED, bb.A_CLOSE_GUARD_MS = self._e, self._m


def test_a_close_yields_to_a_recent_real_trade_when_guard_on():
    with _Guard(True):
        b = _mk()
        _push_T(b, "TEST", 100.0)          # real eligible trade sets close + timestamp
        assert _close(b, "TEST") == 100.0
        _push_A(b, "TEST", 105.0)          # unfiltered A ghost close within the window
        assert _close(b, "TEST") == 100.0  # SKIPPED — close held at the real trade price


def test_a_close_applies_as_fallback_when_no_recent_real_trade():
    with _Guard(True):
        b = _mk()
        _push_AM(b, "TEST", 100.0)         # AM seeds the bucket — no real T timestamp
        assert _close(b, "TEST") == 100.0
        _push_A(b, "TEST", 105.0)          # no recent real close → A applies (fallback)
        assert _close(b, "TEST") == 105.0


def test_a_close_applies_when_guard_off_old_behavior():
    with _Guard(False):
        b = _mk()
        _push_T(b, "TEST", 100.0)
        _push_A(b, "TEST", 105.0)          # guard off → A applies (byte-identical old path)
        assert _close(b, "TEST") == 105.0
