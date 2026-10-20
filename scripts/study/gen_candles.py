"""gen_candles — Foundations F3 recall items from the firm's candle grammar,
api/services/screener/candle_catalog.py (22 shapes, 44 relations); spec §6.3
gen_candles, §13.3 C18.

C18: candlestick DIRECTION is not a fact. Nothing here keys on `bias` or
`kind`; the items ask the NAME from the catalog's own auction-reading
description, the bar count, and the prior move a name REQUIRES (a hammer
after an advance is a hanging man: that is a naming rule, not a forecast).
Every description is quoted verbatim in the prompt and the reveal.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from api.services.screener import candle_catalog as cc  # noqa: E402
from scripts.study._common import make_item, quote_lesson, rotate_pick, shuffled_choices, write_segment  # noqa: E402

SOURCE = "api/services/screener/candle_catalog.py"
TREND_WORDS = {"down": "a decline", "up": "an advance"}
TREND_CHOICES = ["a decline", "an advance", "either"]


def catalog() -> list:
    return list(cc.SHAPES) + list(cc.RELATIONS)


def items_for(p, siblings: list) -> list[dict]:
    ref = f"{SOURCE}#{p.key}"
    labels = [s.label for s in siblings if s.axis == p.axis]
    reveal = {"key": p.key, "label": p.label, "axis": p.axis, "bars": p.bars, "quote": p.desc,
              "system": "the firm's candle catalog", "source": ref,
              "direction_is_not_a_fact": "C18: the catalog names a shape; it does not forecast"}
    out = [make_item(
        type="recall", skill_id="vocab.candle", module="F3",
        q="Which candle name fits this description?", answer=p.label,
        choices=shuffled_choices(p.label, rotate_pick(labels, 3, ref + "name", exclude=p.label), ref + "name"),
        prompt_extra={"quote": p.desc, "subject": p.label}, reveal=reveal, source_kind="candles",
        source_ref=ref + "#name", difficulty=2, lesson_text=quote_lesson(p.desc))]
    counts = [str(n) for n in (1, 2, 3, 4, 5)]
    out.append(make_item(
        type="recall", skill_id="vocab.candle", module="F3",
        q=f"How many bars make a {p.label}?", answer=str(p.bars), prompt_extra={"subject": p.label},
        choices=counts, reveal=reveal, source_kind="candles", source_ref=ref + "#bars", difficulty=1))
    if p.trend in TREND_WORDS:
        key = TREND_WORDS[p.trend]
        out.append(make_item(
            type="recall", skill_id="vocab.candle", module="F3",
            q=f"The catalog names a {p.label} only after which kind of move?", answer=key,
            choices=list(TREND_CHOICES), prompt_extra={"subject": p.label}, reveal=dict(reveal, trend=p.trend),
            source_kind="candles", source_ref=ref + "#trend", difficulty=2, lesson_text=quote_lesson(p.desc)))
    return out


def generate() -> dict[str, list[dict]]:
    pats = catalog()
    items = []
    for p in pats:
        items.extend(items_for(p, pats))
    for it in items:
        a = str(it["answer_json"].get("answer", "")).lower()
        assert a not in ("bullish", "bearish", "neutral", "reversal", "continuation"), it["id"]   # C18
    return {"candles.catalog": items}


def main() -> int:
    for name, items in generate().items():
        path = write_segment(name, items)
        print(f"{name}: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
