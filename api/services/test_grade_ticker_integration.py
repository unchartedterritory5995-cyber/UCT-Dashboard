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
