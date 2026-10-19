"""gen_walkthroughs — unscored walk-through items from the Presenter's Brief
(spec §13.9 #1; VOICE.md §4 "A walk-through"; owner ruling 2026-10-17: the
brief is "more of a teach vs a quiz item").

  stations   section "1 · The system in one page": one bullet per station of
             the loop (Regime, Scan, Setup, Size, Manage, Review). The steps
             are that bullet's own sentences: dedashed, markdown stripped,
             split into sentences of at most 22 words (a longer sentence is
             split at a semicolon, else a colon, else around a parenthetical,
             else its most balanced comma, else a " · " list separator; never
             a word rewritten, only a cut separator dropped and a first letter
             raised). The bold
             heading ("Regime — what am I permitted to do today?") names the
             station and is the prompt, not a step: it is a question, and a
             walk-through narrates. A bullet with more than four steps is
             chunked into consecutive items of 2-4 steps (part 1 of 2, ...)
             rather than cut, so every sentence of the brief reaches a member.
  terms      the FRAMING glossary terms (`_common.FRAMING_TERMS`, the loop,
             the card, the gates, the contracts): the definition split the
             same way. gen_recall skips exactly these, so a framing term is
             taught and never quizzed.

Every item: type "walkthrough", difficulty 1, prompt_json {q, steps, order,
subject[, part, parts]}, answer_json {"unscored": true}, reveal_json {term |
station, quote (verbatim), source}, lesson_text = the last step, source_kind
"brief", source_ref "docs/curriculum/uct_method_presenter_brief.json#...",
review_status draft, review lane manual at import. The numbers in the steps
are grounded by construction: reveal_json.quote is the verbatim bullet the
steps came from.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study._common import (FRAMING_TERMS, REPO, dedash, load_json, make_item,  # noqa: E402
                                   write_segment)

BRIEF = REPO / "docs" / "curriculum" / "uct_method_presenter_brief.json"
SKILL_MAP = REPO / "docs" / "study" / "skill_map.json"
SOURCE = "docs/curriculum/uct_method_presenter_brief.json"
SECTION_ONE = "1 · The system in one page"
MAX_STEP_WORDS = 22
MIN_STEPS, MAX_STEPS = 2, 4

#: Station (the bold heading's first word) → the skill its walk-through opens.
STATION_SKILLS = {
    "Regime": "regime.bands", "Scan": "scan.funnel", "Setup": "setup.card",
    "Size": "size.formula", "Manage": "manage.rules", "Review": "review.journal",
}
STATIONS = tuple(STATION_SKILLS)
#: Framing term → skill (every key is in FRAMING_TERMS; a test pins both ways).
TERM_SKILLS = {
    "THE LOOP": "regime.loop", "Permission band": "regime.bands", "Five-field card": "setup.card",
    "The four entry triggers": "setup.triggers", "Setup families": "setup.gallery",
    "The regime × grade table": "size.cap_table", "The sizing gate": "size.gate",
    "Specialization contract": "review.specialise", "Playbook defense": "review.defend",
    "Field week": "review.field_week", "Drawdown protocol": "size.drawdown",
    "Progressive exposure": "regime.ladder", "A-list / B-list": "scan.watchlists",
}

_MD_RE = re.compile(r"\*{1,2}")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_HEADING_RE = re.compile(r"^\*\*([A-Z][a-z]+)\s+—")


# ── sources ───────────────────────────────────────────────────────────────────

def read_station_bullets(brief: dict | None = None) -> list[tuple[str, str]]:
    """[(station, verbatim bullet)] for the six stations, in loop order."""
    brief = brief or load_json(BRIEF)
    section = next((s for s in brief.get("sections", []) if s.get("heading") == SECTION_ONE), None)
    if not section:
        raise ValueError(f"brief has no section {SECTION_ONE!r}")
    out = []
    for bullet in section.get("body", []):
        m = _HEADING_RE.match(bullet)
        if m and m.group(1) in STATION_SKILLS:
            out.append((m.group(1), bullet))
    found = [s for s, _ in out]
    if found != list(STATIONS):
        raise ValueError(f"stations found {found}, expected {list(STATIONS)}")
    return out


def read_framing_terms(brief: dict | None = None) -> list[dict]:
    brief = brief or load_json(BRIEF)
    terms = [g for g in brief.get("glossary", []) if g.get("term") in FRAMING_TERMS and g.get("definition")]
    missing = FRAMING_TERMS - {g["term"] for g in terms}
    if missing:
        raise ValueError(f"framing terms missing from the brief's glossary: {sorted(missing)}")
    return terms


def skill_module(skill_id: str) -> str | None:
    """The first module skill_map.json lists for the unit carrying `skill_id`."""
    for cur in load_json(SKILL_MAP).get("curricula", []):
        for track in cur.get("tracks", []):
            for unit in track.get("units", []):
                if skill_id in (unit.get("skills") or []):
                    mods = unit.get("modules") or []
                    return mods[0] if mods else None
    return None


# ── splitting (never a word rewritten) ────────────────────────────────────────

def strip_markdown(text: str) -> str:
    return _MD_RE.sub("", text)


def _words(s: str) -> int:
    return len(s.split())


def _tidy(part: str) -> str:
    """A fragment as a step: outer whitespace off, a trailing comma or
    semicolon (the separator it was cut at) off, first letter upper-cased.
    A colon stays: "The sizing ceiling matrix:" is a lead-in."""
    s = part.strip().rstrip(",;").strip()
    return s[:1].upper() + s[1:] if s else s


def _outside_parens(s: str) -> str:
    """`s` with every bracketed aside blanked to spaces (same length), so a
    separator search never lands inside a bracket."""
    return re.sub(r"\([^()]*\)", lambda m: " " * len(m.group(0)), s)


def _split_once(s: str) -> list[str] | None:
    """Fragments of `s`, cut at a semicolon, else a colon, else around a
    parenthetical (before · the bracketed aside · after, so a bracket is
    never torn open), else the comma that balances the halves best, else a
    " · " list separator. None when nothing can split it."""
    for sep in (";", ":"):
        i = s.find(sep)
        if 0 < i < len(s) - 1:
            return [s[:i + 1], s[i + 1:]]
    outside = _outside_parens(s)
    m = re.search(r"\([^()]*\)", s)
    if m and "," not in outside:
        # every comma sits inside a bracket: lift the aside out whole
        parts = [s[:m.start()], m.group(0), s[m.end():]]
        parts = [p for p in parts if p.strip()]
        if len(parts) >= 2:
            return parts
    best = None
    for sep in (",", " · "):
        idx = [m.start() for m in re.finditer(re.escape(sep), outside)]
        for i in idx:
            left, right = s[:i + (1 if sep == "," else 0)], s[i + len(sep):]
            if not left.strip() or not right.strip():
                continue
            score = max(_words(left), _words(right))
            if best is None or score < best[0]:
                best = (score, left, right)
        if best:
            return [best[1], best[2]]
    return None


def _fit(s: str) -> list[str]:
    """`s` as fragments of at most MAX_STEP_WORDS words, splitting as little
    as possible; an unsplittable long sentence is returned as-is (the
    importer then flags it, nothing is rewritten)."""
    if _words(s) <= MAX_STEP_WORDS:
        return [s]
    halves = _split_once(s)
    if not halves:
        return [s]
    return [f for h in halves for f in _fit(h)]


def split_steps(text: str) -> list[str]:
    """The brief's prose as walk-through steps: markdown off, dedashed,
    sentences, each fitted to 22 words; a single sentence is still split
    once so a walk-through has at least two steps."""
    clean = dedash(strip_markdown(text)).strip()
    sentences = [s for s in _SENTENCE_RE.split(clean) if s.strip()]
    frags: list[str] = [f for s in sentences for f in _fit(s)]
    if len(frags) < MIN_STEPS and frags:
        halves = _split_once(frags[0])
        if halves:
            frags = [f for h in halves for f in _fit(h)] + frags[1:]
    return [_tidy(f) for f in frags if _tidy(f)]


def _sentence_end(step: str) -> bool:
    return step.rstrip().endswith((".", "!", "?", ")"))


def chunk_steps(steps: list[str]) -> list[list[str]]:
    """Consecutive chunks of 2-4 steps; a list of 2-4 is one chunk. A cut
    lands only where a step ends a sentence (so a split sentence or a
    lead-in with its list is never torn across two items), the fewest
    chunks win, then the most even. When no such cut exists the chunks are
    simply as even as possible."""
    n = len(steps)
    if n <= MAX_STEPS:
        return [steps]
    cuts = {i for i in range(1, n) if _sentence_end(steps[i - 1])}
    best: tuple | None = None

    def walk(start: int, acc: list[int]) -> None:
        nonlocal best
        if start == n:
            key = (len(acc), max(acc) - min(acc))
            if best is None or key < best[0]:
                best = (key, list(acc))
            return
        for size in range(MIN_STEPS, MAX_STEPS + 1):
            end = start + size
            if end > n or (end < n and end not in cuts):
                continue
            walk(end, acc + [size])

    walk(0, [])
    if best is None:
        parts = -(-n // MAX_STEPS)
        base, extra = divmod(n, parts)
        sizes = [base + (1 if k < extra else 0) for k in range(parts)]
    else:
        sizes = best[1]
    out, i = [], 0
    for size in sizes:
        out.append(steps[i:i + size])
        i += size
    return out


def station_sentences(bullet: str) -> str:
    """The bullet without its bold heading sentence (the station's own
    question, which is the prompt, not a step)."""
    m = re.match(r"^\*\*[^*]*\*\*\s*", bullet)
    return bullet[m.end():] if m else bullet


# ── generators ────────────────────────────────────────────────────────────────

def _walk(*, q: str, steps: list[str], order: int, skill_id: str, reveal: dict, source_ref: str,
          part: int | None = None, parts: int | None = None) -> dict:
    extra = {"steps": steps, "order": order, "subject": q}
    if parts and parts > 1:
        extra["part"] = part
        extra["parts"] = parts
    return make_item(type="walkthrough", skill_id=skill_id, module=skill_module(skill_id), q=q, answer=None,
                     answer_json={"unscored": True}, prompt_extra=extra, reveal=reveal,
                     lesson_text=steps[-1], source_kind="brief", source_ref=source_ref, difficulty=1)


def station_items(bullets: list[tuple[str, str]], start: int = 1) -> list[dict]:
    out: list[dict] = []
    order = start
    for station, bullet in bullets:
        chunks = chunk_steps(split_steps(station_sentences(bullet)))
        ref = f"{SOURCE}#{SECTION_ONE}#{station}"
        reveal = {"station": station, "quote": bullet, "source": ref}
        for i, steps in enumerate(chunks, 1):
            out.append(_walk(q=station, steps=steps, order=order, skill_id=STATION_SKILLS[station],
                             reveal=reveal, source_ref=ref, part=i, parts=len(chunks)))
            order += 1
    return out


def term_items(terms: list[dict], start: int = 1) -> list[dict]:
    out: list[dict] = []
    order = start
    for g in sorted(terms, key=lambda t: list(TERM_SKILLS).index(t["term"])):
        term, definition = g["term"], g["definition"]
        chunks = chunk_steps(split_steps(definition))
        ref = f"{SOURCE}#glossary#{term}"
        reveal = {"term": term, "quote": definition, "source": f"{SOURCE}#glossary"}
        for i, steps in enumerate(chunks, 1):
            out.append(_walk(q=term, steps=steps, order=order, skill_id=TERM_SKILLS[term], reveal=reveal,
                             source_ref=ref, part=i, parts=len(chunks)))
            order += 1
    return out


def generate() -> dict[str, list[dict]]:
    brief = load_json(BRIEF)
    stations = station_items(read_station_bullets(brief))
    terms = term_items(read_framing_terms(brief), start=len(stations) + 1)
    return {"walk.method": stations + terms}


def main() -> int:
    for name, items in generate().items():
        path = write_segment(name, items)
        print(f"{name}: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
