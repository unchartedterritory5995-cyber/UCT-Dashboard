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


def regime_words() -> dict[str, str]:
    """The member-facing WORD for each regime id: the 50-89 tier's id is "amber" and its
    word is "Yellow" (owner ruling O-8). The ids and every stored value stay as
    classify_regime answers them; only what a member or a model reads changes.

    ⛔ Derived, never restated: the words are the option labels of the board property
    builtin:regime_at_write in note_properties.py, the same labels the client's one map
    (app/src/pages/journal-2-0/lib/blocks/regimeWords.js) is railed against. Imported
    lazily so this pure classifier module keeps no import-time dependency on it."""
    from api.services.journal_two.note_properties import BUILTIN_PROPERTY_DEFS, REGIME_AT_WRITE
    prop = next(d for d in BUILTIN_PROPERTY_DEFS if d["id"] == REGIME_AT_WRITE)
    return {o["id"]: o["label"] for o in prop["options"]}


def regime_id_for(value: Any) -> str | None:
    """The regime id for a value a model or member may send, in either spelling and any
    case: the id itself ("amber", "AMBER") or its word ("Yellow", "YELLOW"). None for
    anything else, so a caller can keep its own handling of an unknown value."""
    if not isinstance(value, str):
        return None
    v = value.strip().lower()
    if not v:
        return None
    for rid, word in regime_words().items():
        if v == rid or v == word.lower():
            return rid
    return None


def regime_word(value: Any) -> str | None:
    """The member-facing word for an id (or either spelling of one); None when unknown."""
    rid = regime_id_for(value)
    return regime_words()[rid] if rid else None


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
    return regime_from_exposure(_read_exposure())


def regime_from_exposure(exp: dict | None) -> dict[str, Any]:
    """get_current_regime's answer for an exposure block the caller already holds (the ONE place the
    label, score and date are derived from it). R-T12-C: trader_blocks' held-only regime read passes
    the HELD breadth payload's exposure here, so a note create never asks the default get_breadth."""
    if not isinstance(exp, dict) or exp.get("score") is None:
        return {"regime": None, "score": None, "source": None, "asOf": None}
    return {
        "regime": classify_regime(exp.get("score")),
        "score": float(exp.get("score")),
        "source": "wire_data",
        "asOf": exp.get("as_of") or exp.get("date"),
    }
