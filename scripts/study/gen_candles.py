"""gen_candles — Foundations F3 recall items from the firm's candle grammar,
api/services/screener/candle_catalog.py (22 shapes, 44 relations); spec §6.3
gen_candles, §13.3 C18.

C18: candlestick DIRECTION is not a fact. Nothing here keys on `bias` or
`kind`; the items ask the NAME from the catalog's own auction-reading
description, the bar count, and the prior move a name REQUIRES (a hammer
after an advance is a hanging man: that is a naming rule, not a forecast).
Every description is quoted verbatim in the reveal and the lesson.

Owner rulings 2026-10-19 (docs/study/corrections/candles.catalog.jsonl):
  * "Fix + draw the candle": a description question never contains the
    answer's name in the quoted text; a sentence that names it is cut from
    the question and kept in the lesson (strip_name);
  * "include images in most if not all of these examples": the segment is
    image-first. docs/study/terms/candle_examples.json (found on the pod by
    scripts/study/find_candle_examples.py through the screener's own
    single_candle) gives every catalog key real (sym, asof) pairs; each becomes
    a chart item in segment candles.chart that shows the bar(s) on a real
    chart cut at that date, drawn in-app by StockChart. The text items stay as
    the first rung (segment candles.catalog, ids unchanged).
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from api.services.screener import candle_catalog as cc  # noqa: E402
from scripts.study._common import make_item, quote_lesson, rotate_pick, shuffled_choices, write_segment  # noqa: E402

SOURCE = "api/services/screener/candle_catalog.py"
EXAMPLES_PATH = pathlib.Path(__file__).resolve().parents[2] / "docs" / "study" / "terms" / "candle_examples.json"
CHART_SEGMENT = "candles.chart"
CHART_WINDOW = 60          # the finder's window: the named bar is the LAST one on the chart
CHART_FORWARD = 10
TREND_WORDS = {"down": "a decline", "up": "an advance"}
TREND_CHOICES = ["a decline", "an advance", "either"]
TREND_SENTENCE = {"down": "The catalog names it only after a decline.",
                  "up": "The catalog names it only after an advance."}


def _name_tokens(p) -> list[str]:
    """The words that give the answer away: the label, the key, and each word
    of the label longer than three letters (so "hammer" cuts "hanging man"'s
    'hammer' sentence too)."""
    toks = {p.label.lower(), p.key.lower().replace("-", " ")}
    toks |= {w for w in re.split(r"[\s/-]+", p.label.lower()) if len(w) > 3}
    return sorted(toks, key=len, reverse=True)


def strip_name(desc: str, p) -> str:
    """The description with every sentence that names the pattern removed
    (owner: the question never contains the answer). Falls back to the whole
    text when every sentence names it, so a question is never empty."""
    sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+", desc.strip()) if x.strip()]
    toks = _name_tokens(p)
    kept = [x for x in sentences if not any(re.search(r"\b" + re.escape(t) + r"\b", x.lower()) for t in toks)]
    return " ".join(kept) if kept else desc


def load_examples() -> list[dict]:
    if not EXAMPLES_PATH.exists():
        return []
    return list(json.loads(EXAMPLES_PATH.read_text(encoding="utf-8")).get("examples") or [])


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
        prompt_extra={"quote": strip_name(p.desc, p), "subject": p.label}, reveal=reveal, source_kind="candles",
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


def chart_items(pats: list, examples: list[dict]) -> list[dict]:
    """One item per real-chart example: the member sees the chart cut at the
    date (the named bar, or the last `bars` of a relation, is the end of the
    chart) and names it. The description moves to the reveal and the lesson."""
    by_key = {p.key: p for p in pats}
    out = []
    for ex in examples:
        p = by_key.get(ex["key"])
        if not p:
            continue
        ref = f"{SOURCE}#{p.key}#{ex['sym']}#{ex['asof']}"
        labels = [s.label for s in pats if s.axis == p.axis and s.label != p.label]
        q = ("Which candle name fits the last bar on this chart?" if p.bars == 1
             else f"Which candle name fits the last {p.bars} bars on this chart?")
        lesson = quote_lesson(p.desc) or p.desc
        if p.trend in TREND_SENTENCE:
            lesson = f"{lesson} {TREND_SENTENCE[p.trend]}"
        reveal = {"key": p.key, "label": p.label, "axis": p.axis, "bars": p.bars, "quote": p.desc,
                  "trend_required": p.trend, "trend_seen": ex.get("trend"),
                  "system": "the firm's candle catalog", "source": ref,
                  "example": {"sym": ex["sym"], "asof": ex["asof"], "found_by": "scripts/study/find_candle_examples.py"},
                  "window_bars": CHART_WINDOW, "highlight_last_bars": p.bars,
                  "direction_is_not_a_fact": "C18: the catalog names a shape; it does not forecast"}
        out.append(make_item(
            type="recall", skill_id="vocab.candle", module="F3", q=q, answer=p.label,
            choices=shuffled_choices(p.label, rotate_pick(labels, 3, ref), ref),
            prompt_extra={"subject": p.label, "chart": {"window_bars": CHART_WINDOW, "tf": "D", "highlight_last_bars": p.bars}},
            reveal=reveal, lesson_text=lesson, lesson_origin="source",
            source_kind="candles", source_ref=ref, difficulty=2,
            sym=ex["sym"], asof=ex["asof"], adjustment_basis="split-adjusted",
            bars={"sym": ex["sym"], "tf": "D", "asof": ex["asof"], "window": CHART_WINDOW, "forward": CHART_FORWARD}))
    return out


def generate() -> dict[str, list[dict]]:
    pats = catalog()
    items = []
    for p in pats:
        items.extend(items_for(p, pats))
    charts = chart_items(pats, load_examples())
    for it in items + charts:
        a = str(it["answer_json"].get("answer", "")).lower()
        assert a not in ("bullish", "bearish", "neutral", "reversal", "continuation"), it["id"]   # C18
    for it in items:
        quote = it["prompt_json"].get("quote")
        if quote:
            assert it["answer_json"]["answer"].lower() not in quote.lower(), it["id"]      # the leak rule
    return {"candles.catalog": items, CHART_SEGMENT: charts}


def main() -> int:
    for name, items in generate().items():
        path = write_segment(name, items)
        print(f"{name}: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
