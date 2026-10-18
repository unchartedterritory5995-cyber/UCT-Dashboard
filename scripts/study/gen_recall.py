"""gen_recall — recall items from the firm's own written sources (spec §6.3
row 1; §13.3 C19, C20):

  glossary    docs/curriculum/uct_method_presenter_brief.json (40 terms, minus
              the 13 FRAMING terms gen_walkthroughs teaches instead): term →
              definition and definition → term MCQs, distractors from sibling
              entries.
  principles  api/data/voice_kb/trading_principles.json (36): "which
              principle is this" by title, the text quoted verbatim. C19:
              no number in that file is ever a key.
  bible       the 23 O'Neil rules in the methodology bible: "which line is
              one of the rules" (distractors = playbook named mistakes), and
              a fill-in for every number the rule STATES, tagged "O'Neil"
              (C20: a trader-attributed number only in a question that names
              the trader).
  concepts    conceptVocabulary.json (22 formulas): the firm's screener
              definition of a word, verbatim formula as the key, tagged "the
              firm's screener".
  playbooks   setupPlaybooks.js (9): named mistakes as distractor pools, and
              "where does the stop go" per playbook.

Every answer string is a verbatim substring of its source entry (§6.3
verification). The question prose is this file's; it states no market fact.
Lessons are the verbatim source sentence when it passes the voice rules as
written, else empty with the quote in reveal_json.quote.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study._common import (FRAMING_TERMS, REPO, load_json, make_item, quote_lesson,  # noqa: E402
                                   rotate_pick, shuffled_choices, write_segment)

BRIEF = REPO / "docs" / "curriculum" / "uct_method_presenter_brief.json"
PRINCIPLES = REPO / "api" / "data" / "voice_kb" / "trading_principles.json"
BIBLE = pathlib.Path(r"C:\Users\pgosz\projects\uct-intelligence\prompts\01_methodology_bible.txt")
CONCEPTS = REPO / "app" / "src" / "components" / "chart" / "engine" / "ast" / "conceptVocabulary.json"
PLAYBOOKS = REPO / "app" / "src" / "pages" / "modelbook" / "setupPlaybooks.js"
SKILL_MAP = REPO / "docs" / "study" / "skill_map.json"

PRINCIPLE_SKILLS = {
    "position_sizing": "size.formula", "setup_definition": "setup.placement",
    "behavioral_bias": "review.pattern_map", "regime_playbook": "regime.dial",
    "microstructure": "scan.orders", "meta": "size.r_expectancy",
}
#: O'Neil rule number → the skill it drills (fallback review.plan).
BIBLE_SKILLS = {
    1: "size.stop", 2: "manage.sell_right", 3: "scan.new_highs", 4: "scan.volume_confirm",
    5: "manage.add", 6: "review.plan", 7: "size.heat", 8: "scan.rs", 9: "setup.family1.flat_base",
    10: "scan.scorecard", 11: "scan.new_highs", 12: "scan.volume_accum", 13: "regime.dial",
    14: "regime.dd_ftd", 15: "regime.dd_ftd", 16: "setup.family1.flat_base", 17: "scan.groups",
    18: "manage.sell_right", 19: "manage.sell_wrong", 20: "scan.volume_confirm",
    21: "manage.sell_wrong", 22: "scan.rs", 23: "review.journal",
}
#: Rule number → (question, verbatim key, accepted spellings). Only numbers
#: the rule STATES; the question names the trader (C20).
BIBLE_NUMBERS = {
    1: ("O'Neil's rule 1: cut losses at what percent below your buy point?", "7-8%", ["7-8", "7 to 8%", "7-8 percent"]),
    2: ("O'Neil's rule 2 names a profit rule. What percent?", "20-25%", ["20-25", "20 to 25%", "20-25 percent"]),
    3: ("O'Neil's rule 3: buy stocks at or near which highs?", "52-week or all-time highs", ["52-week highs", "new 52-week or all-time highs"]),
    4: ("O'Neil's rule 4: volume must confirm a breakout by how much above average?", "40-50%+", ["40-50%", "40-50", "40 to 50%"]),
    7: ("O'Neil's rule 7: never hold more than how many stocks at once?", "5-7", ["5-7 stocks", "5 to 7", "five to seven"]),
    13: ("O'Neil's rule 13: the general market decides what share of a stock's outcome?", "75%", ["75", "75 percent"]),
    14: ("O'Neil's rule 14: a Follow-Through Day comes on which days of a rally attempt?", "Day 4-7", ["4-7", "day 4 to 7", "days 4-7"]),
    15: ("O'Neil's rule 15: how many distribution days in 25 sessions signal a top?", "5-6", ["5-6 distribution days", "5 to 6", "five to six"]),
    16: ("O'Neil's rule 16: the best buy is within what percent of a proper base breakout pivot?", "5-10%", ["5-10", "5 to 10%", "5-10 percent"]),
}
SOURCE_BRIEF = "docs/curriculum/uct_method_presenter_brief.json#glossary"
SOURCE_PRINCIPLES = "api/data/voice_kb/trading_principles.json"
SOURCE_BIBLE = "uct-intelligence/prompts/01_methodology_bible.txt#oneil-23-rules"
SOURCE_CONCEPTS = "app/src/components/chart/engine/ast/conceptVocabulary.json#concepts"
SOURCE_PLAYBOOKS = "app/src/pages/modelbook/setupPlaybooks.js"


# ── sources ───────────────────────────────────────────────────────────────────

def read_glossary() -> list[dict]:
    return [g for g in load_json(BRIEF).get("glossary", []) if g.get("term") and g.get("definition")]


def read_principles() -> list[dict]:
    return [p for p in load_json(PRINCIPLES).get("entries", []) if p.get("title") and p.get("text")]


def read_bible_rules(text: str | None = None) -> list[tuple[int, str]]:
    """(number, verbatim rule text) for the 23 condensed rules."""
    if text is None:
        text = BIBLE.read_text(encoding="utf-8")
    m = re.search(r"O'NEIL 23 RULES[^\n]*\n(.*?)\n\s*\n", text, re.S)
    block = m.group(1) if m else text
    out = []
    for line in block.splitlines():
        mm = re.match(r"\s*(\d{1,2})\.\s+(.*\S)\s*$", line)
        if mm:
            out.append((int(mm.group(1)), mm.group(2)))
    return out


def read_concepts() -> list[dict]:
    v = load_json(CONCEPTS).get("concepts") or {}
    out = []
    for word, c in v.items():
        if isinstance(c, dict) and c.get("source"):
            labels = [g.get("label") or g.get("kind") for g in (c.get("grounding") or []) if isinstance(g, dict)]
            out.append({"word": word, "source": c["source"], "grounding": labels,
                        "setup": (c.get("attribution") or {}).get("setup")})
    return out


def read_playbooks(js: str | None = None) -> list[dict]:
    """[{name, mistakes: [...], stop: str|None}] from the JS text."""
    if js is None:
        js = PLAYBOOKS.read_text(encoding="utf-8")
    out = []
    heads = list(re.finditer(r"^  '([^']+)': \{", js, re.M))
    for i, h in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(js)
        block = js[h.start():end]
        mistakes: list[str] = []
        mm = re.search(r"mistakes:\s*\[(.*?)\]", block, re.S)
        if mm:
            mistakes = [s.strip() for s in re.findall(r"'((?:[^'\\]|\\.)*)'", mm.group(1))]
            mistakes = [s.replace("\\'", "'") for s in mistakes if s]
        stop = None
        sm = re.search(r"label: 'Stop',\s*accent: 'stop',\s*body:\s*((?:\s*'(?:[^'\\]|\\.)*'\s*\+?)+)", block)
        if sm:
            stop = "".join(re.findall(r"'((?:[^'\\]|\\.)*)'", sm.group(1))).replace("\\'", "'")
        # the playbook's own RULES: the first sentence of the intro and of every
        # section body, verbatim. They are the distractors for a "which is the
        # mistake" item (owner 2026-10-18: a mistake from another playbook is
        # not clearly wrong, "all of these have right and some wrong in them").
        rules: list[str] = []
        for bm in re.finditer(r"(?:intro|body):\s*((?:\s*'(?:[^'\\]|\\.)*'\s*\+?)+)", block):
            text = "".join(re.findall(r"'((?:[^'\\]|\\.)*)'", bm.group(1))).replace("\\'", "'").strip()
            first = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0].strip()
            if first and first not in rules and len(first.split()) <= 40:
                rules.append(first)
        out.append({"name": h.group(1), "mistakes": mistakes, "stop": stop, "rules": rules})
    return out


def setup_skill(name: str) -> str:
    for s in load_json(SKILL_MAP).get("setups", []):
        if s.get("canonical") == name:
            return s.get("skill_id") or "setup.placement"
    return "setup.placement"


# ── generators ────────────────────────────────────────────────────────────────

def glossary_items(glossary: list[dict]) -> list[dict]:
    """Two recall items per glossary term, EXCEPT the framing terms
    (`_common.FRAMING_TERMS`): those are walk-throughs (gen_walkthroughs),
    teaching rather than a quiz (owner ruling 2026-10-17), and they feed
    neither a key nor a distractor here."""
    glossary = [g for g in glossary if g["term"] not in FRAMING_TERMS]
    out = []
    defs = [g["definition"] for g in glossary]
    terms = [g["term"] for g in glossary]
    for g in glossary:
        term, definition = g["term"], g["definition"]
        ref = f"{SOURCE_BRIEF}#{term}"
        reveal = {"term": term, "quote": definition, "source": SOURCE_BRIEF}
        q1 = f"At the desk, what does \"{term}\" mean?"
        d1 = rotate_pick(defs, 3, ref + "|def", exclude=definition)
        out.append(make_item(type="recall", skill_id="vocab.method", q=q1, answer=definition,
                             choices=shuffled_choices(definition, d1, ref + "|def"), reveal=reveal,
                             prompt_extra={"subject": term}, source_kind="glossary", source_ref=ref,
                             difficulty=1, lesson_text=quote_lesson(f"{term}: {definition}")))
        q2 = "Which term does the desk use for this?"
        d2 = rotate_pick(terms, 3, ref + "|term", exclude=term)
        out.append(make_item(type="recall", skill_id="vocab.method", q=q2, answer=term,
                             choices=shuffled_choices(term, d2, ref + "|term"), reveal=reveal,
                             prompt_extra={"quote": definition, "subject": term}, source_kind="glossary",
                             source_ref=ref, difficulty=2, lesson_text=quote_lesson(f"{term}: {definition}")))
    return out


def principle_items(principles: list[dict]) -> list[dict]:
    out = []
    for p in principles:
        same = [x["title"] for x in principles if x["category"] == p["category"]]
        others = [x["title"] for x in principles]
        ref = f"{SOURCE_PRINCIPLES}#{p['id']}"
        d = rotate_pick(same, 3, ref, exclude=p["title"])
        if len(d) < 3:
            d += rotate_pick(others, 3 - len(d), ref + "|any", exclude=p["title"])
        reveal = {"title": p["title"], "category": p["category"], "quote": p["text"],
                  "source": ref, "numbers_in_quote_are_not_keys": True}
        out.append(make_item(type="recall", skill_id=PRINCIPLE_SKILLS.get(p["category"], "review.plan"),
                             q="Which principle is this?", answer=p["title"],
                             choices=shuffled_choices(p["title"], d, ref),
                             prompt_extra={"quote": p["text"], "subject": p["id"]},
                             reveal=reveal, source_kind="principle", source_ref=ref, difficulty=2))
    return out


def bible_items(rules: list[tuple[int, str]], mistakes_pool: list[str]) -> list[dict]:
    out = []
    for n, rule in rules:
        ref = f"{SOURCE_BIBLE}#{n}"
        reveal = {"rule": n, "quote": rule, "system": "O'Neil", "source": SOURCE_BIBLE}
        d = rotate_pick(mistakes_pool, 3, ref)
        out.append(make_item(type="recall", skill_id=BIBLE_SKILLS.get(n, "review.plan"),
                             q="Which line is one of O'Neil's 23 rules, as the firm's bible quotes them?",
                             answer=rule, choices=shuffled_choices(rule, d, ref), reveal=reveal,
                             prompt_extra={"subject": f"oneil rule {n}"},
                             source_kind="bible", source_ref=ref, difficulty=2,
                             lesson_text=quote_lesson(rule)))
        if n in BIBLE_NUMBERS:
            q, key, accept = BIBLE_NUMBERS[n]
            assert key.lower() in rule.lower(), (n, key, rule)
            out.append(make_item(type="recall", skill_id=BIBLE_SKILLS.get(n, "review.plan"), q=q,
                                 answer=key, accept=accept,
                                 prompt_extra={"format": "fill", "subject": f"oneil rule {n}"},
                                 reveal={**reveal, "key_is_oneils_number": True},
                                 source_kind="bible", source_ref=ref + "#number", difficulty=3,
                                 lesson_text=quote_lesson(rule)))
    return out


def concept_items(concepts: list[dict]) -> list[dict]:
    out = []
    formulas = [c["source"] for c in concepts]
    for c in concepts:
        ref = f"{SOURCE_CONCEPTS}#{c['word']}"
        d = rotate_pick(formulas, 3, ref, exclude=c["source"])
        reveal = {"word": c["word"], "quote": c["source"], "grounding": c["grounding"],
                  "system": "the firm's screener", "source": ref}
        if c.get("setup"):
            reveal["attributed_setup"] = c["setup"]
        out.append(make_item(type="recall", skill_id="scan.funnel", module="M6",
                             q=f"The firm's screener calls a stock \"{c['word']}\" when which of these holds?",
                             answer=c["source"], choices=shuffled_choices(c["source"], d, ref), reveal=reveal,
                             prompt_extra={"subject": c["word"]},
                             source_kind="concept", source_ref=ref, difficulty=3))
    return out


def playbook_items(playbooks: list[dict]) -> list[dict]:
    out = []
    all_mistakes = [(p["name"], m) for p in playbooks for m in p["mistakes"]]
    stops = [(p["name"], p["stop"]) for p in playbooks if p.get("stop")]
    for p in playbooks:
        skill = setup_skill(p["name"])
        for m in p["mistakes"]:
            ref = f"{SOURCE_PLAYBOOKS}#{p['name']}#mistake"
            # distractors are the SAME playbook's own rules, so the one mistake
            # is the one line that contradicts the playbook; a mistake lifted
            # from another setup is not clearly wrong (owner, 2026-10-18)
            d = rotate_pick(p.get("rules") or [], 3, ref + m)
            if len(d) < 3:
                others = [x for n, x in all_mistakes if n != p["name"]]
                d += rotate_pick(others, 3 - len(d), ref + m + "|fallback")
            out.append(make_item(type="recall", skill_id=skill,
                                 q=f"Three of these are rules from the firm's {p['name']} playbook. Which one is the named mistake?",
                                 answer=m, choices=shuffled_choices(m, d, ref + m),
                                 prompt_extra={"subject": f"{p['name']} mistake: {m[:40]}",
                                               "note": "The other three are the playbook's own rules."},
                                 reveal={"setup": p["name"], "quote": m, "source": ref,
                                         "rules": list(p.get("rules") or [])},
                                 source_kind="playbook", source_ref=ref + "#" + m[:40], difficulty=2,
                                 lesson_text=quote_lesson(m)))
        if p.get("stop"):
            ref = f"{SOURCE_PLAYBOOKS}#{p['name']}#stop"
            others = [s for n, s in stops if n != p["name"]]
            d = rotate_pick(others, 3, ref)
            out.append(make_item(type="recall", skill_id=skill,
                                 q=f"In the firm's {p['name']} playbook, where does the stop go?",
                                 answer=p["stop"], choices=shuffled_choices(p["stop"], d, ref),
                                 prompt_extra={"subject": f"{p['name']} stop"},
                                 reveal={"setup": p["name"], "quote": p["stop"], "source": ref},
                                 source_kind="playbook", source_ref=ref, difficulty=3,
                                 lesson_text=quote_lesson(p["stop"])))
    return out


def generate() -> dict[str, list[dict]]:
    playbooks = read_playbooks()
    mistakes_pool = [m for p in playbooks for m in p["mistakes"]]
    return {
        "recall.glossary": glossary_items(read_glossary()),
        "recall.principles": principle_items(read_principles()),
        "recall.bible": bible_items(read_bible_rules(), mistakes_pool),
        "recall.concepts": concept_items(read_concepts()),
        "recall.playbooks": playbook_items(playbooks),
    }


def main() -> int:
    for name, items in generate().items():
        path = write_segment(name, items)
        print(f"{name}: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
