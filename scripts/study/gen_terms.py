"""gen_terms -- Vocabulary V.02 "chart words" as chart items (owner ruling 2026-10-19:
"include images in most if not all of these examples").

Sources
  docs/study/terms/chart_words.json   the term records (definition, note, house formula, sources)
  docs/study/terms/examples.json      real (sym, asof) pairs where the firm's OWN formula for the
                                      concept is true, found by scripts/study/find_term_examples.py
                                      on the pod against bars.db (never authored by hand)

Each example becomes ONE item: the member sees the chart cut at `asof` and names the chart
word; the reveal carries the term's full definition, the what-it-depends-on note, the house
formula and the cited source. Bars ride as a SPEC (sym/tf/asof/window/forward) that the
import route resolves on the pod through get_bars_before (B3): no bars in git, no fetch at
import. Ids are deterministic from the source ref (term + sym + asof) and the question.
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study._common import REPO, make_item, rotate_pick, shuffled_choices  # noqa: E402

TERMS_PATH = REPO / "docs" / "study" / "terms" / "chart_words.json"
EXAMPLES_PATH = REPO / "docs" / "study" / "terms" / "examples.json"
SEGMENT = "vocab.chart"
CHART_WINDOW = 120
CHART_FORWARD = 20

#: finder concept -> term id. Several concepts are faces of one word (shallow and
#: deep are both pullbacks; at new highs is the strongest form of near its highs).
CONCEPT_TERM = {
    "trending": "st_chart_trending",
    "in a downtrend": "st_chart_downtrend",
    "coiled": "st_chart_coiled",
    "higher lows": "st_chart_higher_lows",
    "inside day": "st_chart_inside_day",
    "gapping up": "st_chart_gapping",
    "gapping down": "st_chart_gapping",
    "heavy volume": "st_chart_heavy_volume",
    "near its highs": "st_chart_near_highs",
    "at new highs": "st_chart_near_highs",
    "at the 20 ema": "st_chart_at_the_20ema",
    "shallow pullback": "st_chart_pullback",
    "deep pullback": "st_chart_pullback",
}

#: what the question asks for each concept (the chart word is the answer; the
#: concept face, when the word has several, is named in the reveal, never the prompt)
QUESTION = "Which chart word fits what this chart is doing at its last bar?"


def load_terms() -> dict[str, dict]:
    return {t["id"]: t for t in json.loads(TERMS_PATH.read_text(encoding="utf-8"))}


def load_examples() -> list[dict]:
    if not EXAMPLES_PATH.exists():
        return []
    d = json.loads(EXAMPLES_PATH.read_text(encoding="utf-8"))
    return list(d.get("examples") or [])


def term_items(terms: dict[str, dict], examples: list[dict]) -> list[dict]:
    names = [t["term"] for t in terms.values()]
    out = []
    for ex in examples:
        tid = CONCEPT_TERM.get(ex["concept"])
        t = terms.get(tid) if tid else None
        if not t:
            continue
        ref = f"docs/study/terms/chart_words.json#{tid}#{ex['sym']}#{ex['asof']}"
        distractors = rotate_pick([n for n in names if n != t["term"]], 3, ref)
        lesson = f"{t['definition']} {t['note']}"
        reveal = {
            "term": t["term"], "concept": ex["concept"], "definition": t["definition"], "note": t["note"],
            "house_formula": t.get("house_formula"), "sources": t.get("sources") or [],
            "aliases": t.get("aliases_json") or [], "unit_ids": t.get("unit_ids_json") or [],
            "example": {"sym": ex["sym"], "asof": ex["asof"], "found_by": "scripts/study/find_term_examples.py"},
            "window_bars": CHART_WINDOW,
        }
        out.append(make_item(
            type="recall", skill_id="vocab.chart", module="F2",
            q=QUESTION, answer=t["term"],
            choices=shuffled_choices(t["term"], distractors, ref),
            prompt_extra={"subject": t["term"], "chart": {"window_bars": CHART_WINDOW, "tf": "D"}},
            reveal=reveal, lesson_text=lesson, lesson_origin="source",
            source_kind="terms", source_ref=ref, difficulty=int(t.get("difficulty") or 1),
            sym=ex["sym"], asof=ex["asof"], adjustment_basis="split-adjusted",
            bars={"sym": ex["sym"], "tf": "D", "asof": ex["asof"], "window": CHART_WINDOW, "forward": CHART_FORWARD},
        ))
    return out


def generate() -> dict[str, list[dict]]:
    return {SEGMENT: term_items(load_terms(), load_examples())}


if __name__ == "__main__":
    for name, items in generate().items():
        print(name, len(items))
