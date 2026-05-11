"""
Journal 2.0 — current-regime classifier (Phase D).

Pure-ish read against the wire_data cache via engine.get_breadth().
Classifies UCT Exposure Rating (0–150) into one of four regimes matching
the existing Breadth Monitor thresholds:

  score >= 90 → "green"
  score >= 50 → "amber"
  score >= 15 → "orange"
  else        → "red"

When wire_data is unavailable, returns regime=None (feature no-ops).
"""

from __future__ import annotations

from typing import Any


def classify_regime(score: float | None) -> str | None:
    if score is None:
        return None
    s = float(score)
    if s >= 90:
        return "green"
    if s >= 50:
        return "amber"
    if s >= 15:
        return "orange"
    return "red"


def _read_exposure() -> dict | None:
    """Read the exposure block from the wire_data cache; None if missing.

    Indirected through a function so tests can monkeypatch without
    touching the engine import path.
    """
    try:
        from api.services import engine as engine_service
    except Exception:
        return None
    try:
        breadth = engine_service.get_breadth()
    except Exception:
        return None
    exp = (breadth or {}).get("exposure")
    if not exp or exp.get("score") is None:
        return None
    return exp


def get_current_regime() -> dict[str, Any]:
    """Return current regime label + raw score, or null fields."""
    exp = _read_exposure()
    if exp is None:
        return {"regime": None, "score": None, "source": None, "asOf": None}
    return {
        "regime": classify_regime(exp.get("score")),
        "score": float(exp.get("score")),
        "source": "wire_data",
        "asOf": exp.get("as_of") or exp.get("date"),
    }
