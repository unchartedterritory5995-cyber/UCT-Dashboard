"""D3 CP3 (D3-D) — `/api/stream/status` names the bars-overlay degradation.

`/api/stream/prices`'s Massive broadcaster coupling is a best-effort
`try/except: _bb = None` — if `init_broadcaster` never ran (it only runs under
`STREAM_BARS_ENABLED == "1"`), every live quote silently falls back to
Finnhub-only. D3's own gate packet (§D3-D) recommends exactly one additive,
read-only field naming that state, on the same reasoning the endpoint's own
docstring already uses for its admission counters: "a cap nobody can see hit
is a cap nobody knows they hit." Additive: no existing field's value or
presence changes.
"""
from api.routers import stream
from api.services import bar_broadcaster as bb


def test_bars_overlay_live_is_true_when_the_broadcaster_is_initialized(monkeypatch):
    monkeypatch.setattr(bb, "_singleton", bb.BarBroadcaster(), raising=False)
    out = stream.stream_status()
    assert out["bars_overlay_live"] is True


def test_bars_overlay_live_is_false_when_the_broadcaster_was_never_initialized(monkeypatch):
    monkeypatch.setattr(bb, "_singleton", None, raising=False)
    out = stream.stream_status()
    assert out["bars_overlay_live"] is False


def test_the_existing_fields_are_unchanged_by_this_addition(monkeypatch):
    """Additive means additive: max_subscribers and subscribers must keep
    behaving exactly as before regardless of overlay state."""
    monkeypatch.setattr(bb, "_singleton", None, raising=False)
    monkeypatch.setattr(stream, "_subscribers", {"prices": {1, 2}, "bars": set()})
    out = stream.stream_status()
    assert out["max_subscribers"] == stream.MAX_SUBSCRIBERS
    assert out["subscribers"] == {"prices": 2, "bars": 0}
