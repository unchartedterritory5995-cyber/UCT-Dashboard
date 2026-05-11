"""Tests for the Phase D regime classifier."""
from __future__ import annotations

import pytest


def test_classify_regime_thresholds():
    from api.services.journal_two import regime
    assert regime.classify_regime(None) is None
    assert regime.classify_regime(150) == "green"
    assert regime.classify_regime(90) == "green"
    assert regime.classify_regime(89) == "amber"
    assert regime.classify_regime(50) == "amber"
    assert regime.classify_regime(49) == "orange"
    assert regime.classify_regime(15) == "orange"
    assert regime.classify_regime(14) == "red"
    assert regime.classify_regime(0) == "red"


def test_get_current_regime_handles_missing_wire(monkeypatch):
    """When wire_data is empty / unavailable, return null shape."""
    from api.services.journal_two import regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: None)
    out = regime.get_current_regime()
    assert out["regime"] is None
    assert out["score"] is None


def test_get_current_regime_reads_exposure_score(monkeypatch):
    from api.services.journal_two import regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: {
        "score": 72.5,
        "as_of": "2026-05-10T07:35:00-04:00",
    })
    out = regime.get_current_regime()
    assert out["regime"] == "amber"
    assert out["score"] == 72.5
