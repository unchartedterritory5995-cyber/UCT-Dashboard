"""grade_ticker with REAL default sub-fns — must never raise, degrade gracefully."""
from api.services import grade_ticker as gt


def test_real_defaults_never_raise_and_return_dict(monkeypatch):
    # Force the gate available but everything else absent -> decisive SKIP or ok:False.
    monkeypatch.setattr(gt, "_default_regime_fn",
                        lambda: {"regime": "chop", "confidence": 0.5, "narration": "mixed"})
    monkeypatch.setattr(gt, "_default_quote_fn", lambda s: {"symbol": s, "last": 100.0})
    monkeypatch.setattr(gt, "_default_patterns_fn", lambda s: [])
    out = gt.grade_ticker("AAPL")
    assert isinstance(out, dict)
    assert out["ok"] is True and out["verdict"] == "SKIP" and "no_setup" in out["hard_flags"]


def test_regime_unavailable_degrades_not_raises(monkeypatch):
    monkeypatch.setattr(gt, "_default_regime_fn", lambda: None)
    out = gt.grade_ticker("AAPL")
    assert out["ok"] is False


def test_default_patterns_fn_returns_no_detections():
    """Seam 28 (2026-09-06): the REAL default, not an injected fake, must
    return no detections — proving grade_ticker cannot source a decisive
    verdict from the raw, unconfirmed pattern-engine feed. This is the
    direct unit-level proof; the integration test below proves the same
    thing end-to-end through grade_ticker() itself."""
    assert gt._default_patterns_fn("AAPL") == []


def test_real_defaults_end_to_end_never_source_an_unconfirmed_verdict(monkeypatch):
    """The REAL, unmonkeypatched `_default_patterns_fn` is exercised here
    (only regime + quote are injected) — proving the actual production
    wiring, not a test double, resolves to the honest SKIP rather than a
    decisive GO/HOLD built on raw pattern data."""
    monkeypatch.setattr(gt, "_default_regime_fn",
                        lambda: {"regime": "bull_trend", "confidence": 0.8, "narration": "green tape"})
    monkeypatch.setattr(gt, "_default_quote_fn", lambda s: {"symbol": s, "last": 170.0})
    out = gt.grade_ticker("AAPL")
    assert out["ok"] is True
    assert out["verdict"] == "SKIP"
    assert "no_setup" in out["hard_flags"]
    assert out["entry"] is None and out["stop"] is None
