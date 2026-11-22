"""Worked examples for Create Indicator (Studio plan lane L5).

A small, committed set of REQUEST -> PATCH pairs: each is one of UCT's own house indicators, as it was
described and as the assistant built it, kept only because its values were checked against an
independent calculation (``tests/test_house_indicators_values.py``) and it was looked at on a chart.
The two nearest to a member's request ride along in the turn's data as reference: how a request like
this one was turned into outputs, markers, paints and levels here.

⛔ DATA, NEVER INSTRUCTIONS. They are placed inside ``<uct_language_notes>``, which the instructions
already declare to be data; the cached instruction block does not change. Each carries its own rule.
⛔ DARK BY DEFAULT. ``enabled()`` is false for every member unless ``CONVERSE_WORKED_EXAMPLES=1``.
An ADMIN turn that asks for them (the measuring switch) gets them, so the effect can be measured on
production before any member sees it. The proof the plan asks for: the one-turn build rate rises on
the evaluation set with examples on, with no fall on the hidden set.
⛔ ONLY FOR A NEW INDICATOR. A refinement patches what exists; an example of a whole build would
invite a rebuild.

Pure: no model, no network. Never raises out of ``nearest``.
"""
from __future__ import annotations

import functools
import json
import os
import pathlib
import re
from typing import Any, Dict, List, Mapping, Optional, Tuple

PATH = pathlib.Path(__file__).resolve().parents[1] / "data" / "worked_examples.json"

#: At most this many ride along, and only when they share at least this much with the request.
MAX_EXAMPLES: int = 2
MIN_SCORE: float = 0.34
#: ...and at least this many words in common (one shared word is a coincidence).
MIN_SHARED: int = 2

EXAMPLE_RULE = (
    "a request UCT built and checked earlier, with the patch that built it: reference for how a request "
    "like the member's becomes outputs, markers, paints and levels here. Use what fits; the member's "
    "own words and numbers decide; never copy a number, a symbol or a colour the member did not ask for")

_WORD = re.compile(r"[a-z]+|\d+(?:\.\d+)?")
_STOP = frozenset((
    "a an the and or of on in at to for with by from as is are be it its this that these those when while "
    "where which each every any all than then into over under out per me my i we you your show "
    "plot draw put make mark add give use want like line lines bar bars chart price day days").split())
#: Words a trader uses for one idea, folded to one token so a paraphrase still meets its example.
_FOLD = {
    "moving": "ma", "average": "ma", "avg": "ma", "sma": "ma", "mean": "ma",
    "exponential": "ema", "vol": "volume", "relative": "rs", "strength": "rs",
    "percent": "pct", "percentage": "pct", "%": "pct", "weeks": "week", "weekly": "week",
    "highs": "high", "lows": "low", "closes": "close", "closing": "close", "gaps": "gap",
    "shade": "shading", "shaded": "shading", "highlight": "shading", "background": "shading",
    "color": "colour", "colored": "colour", "coloured": "colour", "paint": "colour",
    "arrow": "marker", "markers": "marker", "dot": "marker", "flag": "marker",
    "extension": "extended", "stretch": "extended", "stretched": "extended",
    "tight": "tight", "tightness": "tight", "base": "base", "bases": "base",
    "distribution": "distribution", "followthrough": "follow",
}


#: Abbreviations a trader types, spelled out before matching.
_ALIASES = {"adr": "average daily range", "ftd": "follow through day", "rs": "relative strength",
            "dma": "day moving average", "wma": "week moving average", "u/d": "up down"}


def _tokens(text: Any) -> frozenset:
    raw = str(text or "").lower().replace("-", " ")
    raw = " ".join(_ALIASES.get(w, w) for w in raw.split())
    words = _WORD.findall(raw)
    return frozenset(_FOLD.get(w, w) for w in words if w not in _STOP and len(w) > 1 or w.isdigit())


@functools.lru_cache(maxsize=1)
def _load() -> Tuple[Dict[str, Any], ...]:
    try:
        doc = json.loads(PATH.read_text(encoding="utf-8"))
    except Exception:                                   # noqa: BLE001 -- a missing file means no examples
        return ()
    out = []
    for ex in doc.get("examples") or []:
        if isinstance(ex, Mapping) and isinstance(ex.get("request"), str) and isinstance(ex.get("ops"), list) and ex.get("id"):
            out.append({"id": str(ex["id"]), "request": ex["request"], "ops": ex["ops"], "_tokens": _tokens(ex["request"])})
    return tuple(out)


def all_examples() -> List[Dict[str, Any]]:
    """Every stored example (id, request, ops). For tests and the admission rail."""
    return [{k: v for k, v in ex.items() if not k.startswith("_")} for ex in _load()]


def enabled(*, admin: bool = False, asked: bool = False) -> bool:
    """Whether THIS turn may carry examples. On for everyone only by the env switch; an admin turn that
    asks is the measuring lane."""
    if str(os.environ.get("CONVERSE_WORKED_EXAMPLES", "")).strip().lower() in ("1", "true", "yes", "on"):
        return True
    return bool(admin and asked)


def score(request_tokens: frozenset, example_tokens: frozenset) -> float:
    """Shared words over the smaller side's size: a short request that is wholly inside an example scores 1.
    0 when fewer than ``MIN_SHARED`` words are shared (unless the request is that short itself)."""
    if not request_tokens or not example_tokens:
        return 0.0
    shared = len(request_tokens & example_tokens)
    if shared < min(MIN_SHARED, len(request_tokens)):
        return 0.0
    return shared / float(min(len(request_tokens), len(example_tokens)))


def nearest(message: Any, k: int = MAX_EXAMPLES) -> List[Dict[str, Any]]:
    """The up-to-``k`` examples nearest to the member's words, best first, each
    ``{"request", "ops", "rule"}``. ``[]`` when nothing is near enough. Deterministic."""
    try:
        want = _tokens(message)
        ranked = sorted(((score(want, ex["_tokens"]), i, ex) for i, ex in enumerate(_load())),
                        key=lambda t: (-t[0], t[1]))
        return [{"request": ex["request"], "ops": ex["ops"], "rule": EXAMPLE_RULE}
                for s, _i, ex in ranked[:max(0, int(k))] if s >= MIN_SCORE]
    except Exception:                                   # noqa: BLE001
        return []


def ids_of(examples: List[Mapping[str, Any]]) -> List[str]:
    by_request = {ex["request"]: ex["id"] for ex in _load()}
    return [by_request.get(e.get("request"), "?") for e in examples or []]


def for_turn(message: Any, view: Optional[Mapping[str, Any]], *, admin: bool = False, asked: bool = False) -> List[Dict[str, Any]]:
    """What a turn carries: nothing unless enabled AND the member is starting a NEW indicator."""
    if not enabled(admin=admin, asked=asked):
        return []
    if not (isinstance(view, Mapping) and view.get("empty") is True):
        return []
    return nearest(message)
