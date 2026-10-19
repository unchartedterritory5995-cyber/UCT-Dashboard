"""Templated lessons for detector-sourced Study items (spec §6.4, §7.3).

`render(item_type, facts)` fills FIXED strings from the numbers a detection
stored: pattern name and family, the geometry numbers, the levels, the
outcome (target / stop hit, bars to resolve, MFE / MAE), the regime bucket
and the rubric essence. No model. Every number the lesson writes comes out
of the `facts` dict through `fmt_num`, and the generator stores that same
dict in `reveal_json["facts"]`, so `study_import.grounding_check` passes by
construction; the sentence shapes are fixed and short, so `voice_check`
passes by construction too (a rubric essence that fails voice is dropped,
never rewritten). `tests/test_study_templates.py` proves both over many
random facts.

Items rendered here keep `lesson_origin='template'` until a session rewrites
them (§6.4).
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from api.services import study_import

LESSON_ORIGIN = "template"
NEXT_WINDOW_SESSIONS = 20          # C14: one window for every `next` answer

#: Family → one fixed line about what the family's trade is (method, not a
#: market fact). Keys are the skill_map.json family names.
FAMILY_LINES = {
    "Bases & Breakouts": "A base is a rest after a move. The trade is the break out of it, stop under the base.",
    "Momentum & Trend": "The trend is already there. The trade is the pullback to a rising average, stop under the low.",
    "Gaps & Catalysts": "News moved it. The trade is day one of the new trend, stop under the gap.",
    "Reversals & Reclaims": "The move failed. The trade is the reclaim, stop under the shakeout low.",
    "Intraday": "The timer runs at the open. The trade is the range break, stop at the far side of the range.",
}

#: Outcome vocabulary the detections carry → (what happened, the lesson line).
OUTCOME_LINES = {
    "target_hit": ("It paid. The target printed after {n} sessions, with {mfe}% of room at the best point.",
                   "I take the setup when the stop is honest, and I let the target do the work."),
    "stop_hit": ("It failed. The stop printed after {n} sessions. The worst point was {mae}% against it.",
                 "Stopped out. That's the cost of being there for the ones that work."),
    "expired": ("Undecided. Neither the stop nor the target printed inside {window} sessions.",
                "No answer inside the window is an answer. I'd rather wait than guess."),
}
#: The same outcomes when the detection carries no outcome row (no numbers).
OUTCOME_LINES_BARE = {
    "target_hit": "It paid. The target printed.",
    "stop_hit": "It failed. The stop printed.",
    "expired": "Undecided. Neither the stop nor the target printed inside {window} sessions.",
}

#: Geometry keys worth a sentence, in the order they are written. Anything
#: else the detector stored stays in the facts and off the page.
GEOMETRY_ORDER = ("contractions", "pivot", "base_depth_pct", "depth_pct", "pole_pct",
                  "flag_depth_pct", "gap_pct", "range_pct", "volume_ratio", "bars_in_base",
                  "handle_depth_pct", "tightness")


def fmt_num(v: Any) -> str:
    """The number exactly as the facts hold it (Decimal-normalised), so the
    grounding gate sees the same token: 51.25 -> '51.25', 20.0 -> '20'."""
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        return str(v)
    if not d.is_finite():
        return str(v)
    s = format(d.normalize(), "f")
    return s


def _r(v: Any, places: int = 2) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, places)


def facts_from_detection(det: dict, outcome: Optional[dict], *, name: str, family: Optional[str],
                         rubric_essence: Optional[str] = None, regime_bucket: Optional[str] = None,
                         geometry: Optional[dict] = None, levels: Optional[dict] = None) -> dict:
    """The rounded fact set a templated item carries. Only numbers that are
    in this dict reach a lesson. `det` is a pattern_detections row (dict);
    `outcome` a pattern_outcomes row or None."""
    geometry = {k: _r(v) for k, v in (geometry or {}).items()
                if isinstance(v, (int, float)) and not isinstance(v, bool)}
    geometry = {k: v for k, v in geometry.items() if v is not None}
    levels = levels or {}
    entry = _r(levels.get("entry"))
    stop = _r(levels.get("stop"))
    target = _r(levels.get("target_primary", levels.get("target")))
    facts: dict = {
        "pattern_id": det.get("pattern_id"),
        "name": name,
        "family": family,
        "direction": det.get("direction"),
        "confidence": _r(det.get("confidence"), 0),
        "geometry": geometry,
        "levels": {k: v for k, v in (("entry", entry), ("stop", stop), ("target", target)) if v is not None},
        "window": NEXT_WINDOW_SESSIONS,
    }
    if entry and stop and target and entry > 0:
        risk = abs(entry - stop) / entry * 100.0
        reward = abs(target - entry) / entry * 100.0
        facts["risk_pct"] = round(risk, 1)
        facts["reward_pct"] = round(reward, 1)
        facts["rr"] = round(reward / risk, 1) if risk > 0 else None
    status = str(det.get("status") or "")
    if outcome:
        if outcome.get("target_hit"):
            facts["outcome"] = "target_hit"
        elif outcome.get("stop_hit"):
            facts["outcome"] = "stop_hit"
        else:
            facts["outcome"] = "expired"
        facts["bars_to_resolve"] = int(outcome.get("bars_to_resolve") or 0)
        facts["mfe_pct"] = _r(outcome.get("mfe_pct"), 1)
        facts["mae_pct"] = _r(outcome.get("mae_pct"), 1)
    elif status in ("completed", "failed", "expired"):
        facts["outcome"] = {"completed": "target_hit", "failed": "stop_hit"}.get(status, "expired")
    if regime_bucket:
        facts["regime_bucket"] = str(regime_bucket)
    if rubric_essence and not study_import.voice_check(rubric_essence, lesson=True):
        facts["rubric_essence"] = str(rubric_essence)
    return facts


# ── sentence builders ─────────────────────────────────────────────────────────

def _geometry_sentence(facts: dict) -> str:
    g = facts.get("geometry") or {}
    parts = []
    for k in GEOMETRY_ORDER:
        if k in g and len(parts) < 3:
            label = k.replace("_pct", "").replace("_", " ")
            val = fmt_num(g[k]) + ("%" if k.endswith("_pct") else "")
            parts.append(f"{label} {val}")
    return ("The detector measured " + ", ".join(parts) + ".") if parts else ""


def _levels_sentence(facts: dict) -> str:
    lv = facts.get("levels") or {}
    if not all(k in lv for k in ("entry", "stop", "target")):
        return ""
    return f"Entry {fmt_num(lv['entry'])}, stop {fmt_num(lv['stop'])}, target {fmt_num(lv['target'])}."


def _risk_sentence(facts: dict) -> str:
    if facts.get("risk_pct") is None or facts.get("reward_pct") is None:
        return ""
    s = f"Risk to the stop {fmt_num(facts['risk_pct'])}%, room to the target {fmt_num(facts['reward_pct'])}%"
    if facts.get("rr") is not None:
        s += f", {fmt_num(facts['rr'])}R"
    return s + "."


def _outcome_sentences(facts: dict) -> tuple[str, str]:
    oc = facts.get("outcome")
    if oc not in OUTCOME_LINES:
        return "", ""
    what, lesson = OUTCOME_LINES[oc]
    window = fmt_num(facts.get("window") or NEXT_WINDOW_SESSIONS)
    has_numbers = (facts.get("bars_to_resolve") is not None
                   and facts.get("mfe_pct") is not None and facts.get("mae_pct") is not None)
    if not has_numbers:
        return OUTCOME_LINES_BARE[oc].format(window=window), lesson
    what = what.format(n=fmt_num(facts["bars_to_resolve"]), mfe=fmt_num(facts["mfe_pct"]),
                       mae=fmt_num(facts["mae_pct"]), window=window)
    return what, lesson


def _regime_sentence(facts: dict) -> str:
    b = facts.get("regime_bucket")
    return f"The market read {b} at the time." if b else ""


def _join(*parts: str) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


def render_spot(facts: dict) -> str:
    what, lesson = _outcome_sentences(facts)
    return _join(
        f"This is a {facts.get('name')}, one of the {facts.get('family')} setups." if facts.get("family")
        else f"This is a {facts.get('name')}.",
        f"The detector read it at {fmt_num(facts['confidence'])} confidence." if facts.get("confidence") is not None else "",
        _geometry_sentence(facts), _levels_sentence(facts), _regime_sentence(facts), what, lesson,
        facts.get("rubric_essence") or "",
    )


def render_levels(facts: dict) -> str:
    what, lesson = _outcome_sentences(facts)
    return _join(
        f"{facts.get('name')}. Mark the stop first, then the entry, then the target.",
        _levels_sentence(facts), _risk_sentence(facts), what, lesson,
    )


def render_next(facts: dict) -> str:
    what, lesson = _outcome_sentences(facts)
    return _join(
        f"Cut at the detection bar. One window: the next {fmt_num(facts.get('window') or NEXT_WINDOW_SESSIONS)} sessions.",
        _levels_sentence(facts), _regime_sentence(facts), what, lesson,
    )


def render_family(facts: dict) -> str:
    fam = facts.get("family")
    return _join(
        f"{facts.get('name')} sits in {fam}." if fam else f"{facts.get('name')}.",
        FAMILY_LINES.get(fam or "", ""), _geometry_sentence(facts),
    )


_RENDERERS = {"spot": render_spot, "levels": render_levels, "next": render_next, "family": render_family}


def render(item_type: str, facts: dict) -> str:
    """The lesson for a detector-sourced item of `item_type`. Raises
    ValueError on a type this module has no template for."""
    fn = _RENDERERS.get(item_type)
    if fn is None:
        raise ValueError(f"no lesson template for {item_type!r}")
    return fn(facts)


def verify(lesson: str, facts: dict) -> list[str]:
    """The two importer checks a rendered lesson must pass: empty = clean."""
    item = {"lesson_text": lesson, "answer_json": {}, "reveal_json": {"facts": facts}}
    out = [f"ungrounded {t}" for t in study_import.grounding_check(item)]
    out += study_import.voice_check(lesson, lesson=True)
    return out
