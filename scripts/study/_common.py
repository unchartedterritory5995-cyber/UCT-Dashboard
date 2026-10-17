"""Shared helpers for the Study bank generators (spec §6.1 item schema, §6.2
the bank on disk, §6.3 generators).

Every generator:
  * builds items with `make_item` (ids `si_` + 12 hex, deterministic from the
    source reference and the question text, so a re-run rewrites the same
    rows and the importer upserts them);
  * leaves every item `review_status='draft'` (§8.8: nothing goes live
    unreviewed);
  * cites its source in `source_ref`;
  * embeds NO bars for a chart item — it records a `bars` spec (sym, tf,
    asof, window, forward) for the importer to resolve through
    bars_sqlite.get_bars_before (B3) — EXCEPT a fixture item, which may carry
    `bars_embed` with the fixture's own bars because the fixture IS the record;
  * runs `validate` before writing: the importer's voice and grounding
    checks, unique ids, the schema fields.

Run a generator from the repo root: `python -m scripts.study.gen_recall`.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import sys
from typing import Any, Iterable, Optional

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services import study_import  # noqa: E402

BANK_DIR = REPO / "docs" / "study" / "bank"
SPEC = "docs/superpowers/specs/2026-10-17-desk-practice-interactive-education-design.md"

ITEM_TYPES = ("recall", "match", "spot", "size", "regime", "call_scan", "grade", "levels", "next",
              "family", "call_archive", "listen", "autopsy", "plan", "tap", "scenario")
FAMILIES = ("Bases & Breakouts", "Momentum & Trend", "Gaps & Catalysts", "Reversals & Reclaims", "Intraday")
WIRE_WORDS = ("Aggressive", "Constructive", "Neutral", "Caution", "Defensive")
EM_DASH = "—"


def item_id(source_ref: str, question: str) -> str:
    """'si_' + 12 hex, deterministic from the source reference + question."""
    h = hashlib.sha1(f"{source_ref}\n{question}".encode("utf-8")).hexdigest()
    return "si_" + h[:12]


def rotate_pick(pool: list, n: int, seed: str, *, exclude: Any = None) -> list:
    """`n` distractors from `pool` (minus `exclude`), chosen by a deterministic
    rotation keyed on `seed` so every run picks the same ones."""
    cands = [p for p in pool if p != exclude and p is not None]
    if not cands:
        return []
    start = int(hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8], 16) % len(cands)
    rot = cands[start:] + cands[:start]
    out: list = []
    for c in rot:
        if c not in out:
            out.append(c)
        if len(out) >= n:
            break
    return out


def shuffled_choices(correct: Any, distractors: Iterable[Any], seed: str) -> list:
    """The key and its distractors in a deterministic order (never always
    first)."""
    opts = [correct] + [d for d in distractors if d != correct]
    start = int(hashlib.sha1(("order:" + seed).encode("utf-8")).hexdigest()[:8], 16) % max(1, len(opts))
    return opts[start:] + opts[:start]


def make_item(*, type: str, skill_id: str, q: str, answer: Any, source_kind: str, source_ref: str,
              choices: Optional[list] = None, reveal: Optional[dict] = None, prompt_extra: Optional[dict] = None,
              lesson_text: Optional[str] = None, lesson_origin: str = "source", module: Optional[str] = None,
              difficulty: int = 1, accept: Optional[list] = None, answer_json: Optional[dict] = None,
              **extra: Any) -> dict:
    q = dedash(q)
    prompt = {"q": q}
    if choices:
        prompt["choices"] = [dedash(c) for c in choices]
    if prompt_extra:
        prompt.update({k: dedash(v) for k, v in prompt_extra.items()})
    if answer_json is None:
        answer_json = {"answer": dedash(answer)}
        if accept:
            answer_json["accept"] = [dedash(x) for x in accept]
    lesson_text = dedash(lesson_text)
    it = {
        "id": item_id(source_ref, q + "\n" + json.dumps(prompt_extra or {}, sort_keys=True)),
        "version": 1,
        "type": type,
        "skill_id": skill_id,
        "module": module,
        "difficulty": int(difficulty),
        "prompt_json": prompt,
        "answer_json": answer_json,
        "reveal_json": reveal or {},
        "source_kind": source_kind,
        "source_ref": source_ref,
        "lesson_text": lesson_text,
        "lesson_origin": lesson_origin,
        "review_status": "draft",
    }
    it.update(extra)
    if not it.get("lesson_text"):
        it["lesson_text"], it["lesson_origin"] = fallback_lesson(it)
    return it


def dedash(text: Any) -> Any:
    """The owner's own normalisation (morning-wire/owner_voice.py::dedash):
    an em-dash construction becomes a comma, repeated commas collapse. Applied
    to every MEMBER-FACING string (question, choices, key, lesson, the quote a
    prompt shows) because VOICE.md §6 bans em-dashes in member copy. The
    verbatim source text stays untouched in reveal_json.quote, so provenance
    is never rewritten. Non-strings pass through."""
    if not isinstance(text, str) or (EM_DASH not in text and " -- " not in text):
        return text
    s = text.replace(" " + EM_DASH + " ", ", ").replace(EM_DASH, ", ").replace(" -- ", ", ")
    s = re.sub(r",\s*,+", ",", s)
    s = re.sub(r"^\s*,\s*", "", s)           # a leading dash leaves no leading comma
    s = re.sub(r",\s*([.;:!?])", r"\1", s)    # "word, ." -> "word."
    return s


def quote_lesson(text: Optional[str]) -> Optional[str]:
    """A source sentence as the lesson, ONLY when it passes the voice rules.
    The one normalisation applied is `dedash` (the owner's own tool on his own
    prose); a sentence that still fails (a banned phrase, a question mark)
    stays in reveal_json.quote and the lesson falls back to a template."""
    if not text:
        return None
    t = dedash(text)
    return t if not study_import.voice_check(t, lesson=True) else None


def _pass(text: str) -> bool:
    return bool(text) and not study_import.voice_check(text, lesson=True)


def fallback_lesson(it: dict) -> tuple[str, str]:
    """(lesson_text, lesson_origin) for an item that has none: the source
    quote when it passes the voice rules (origin 'source'), else a short
    template built ONLY from the item's own facts (answer_json / reveal_json),
    so the grounding check holds by construction (origin 'template')."""
    r = it.get("reveal_json") or {}
    a = (it.get("answer_json") or {}).get("answer")
    kind = it.get("source_kind")
    q = quote_lesson(r.get("quote") if isinstance(r.get("quote"), str) else None)
    if q and kind not in ("fixture", "bottoms"):
        return q, "source"
    if kind == "glossary":
        t = f"{r.get('term')} is the desk's word for this. Say the definition back in your own words."
    elif kind == "principle":
        t = f"{r.get('title')}. That is the principle. The firm's own wording is in the reveal."
    elif kind == "bible":
        t = f"That is rule {r.get('rule')} as the firm's bible quotes O'Neil. Read it again, slowly."
    elif kind == "concept":
        t = f"The screener calls it \"{r.get('word')}\". The exact test is in the reveal."
    elif kind == "playbook":
        t = f"{r.get('setup')}: the playbook's own line is in the reveal."
    elif kind == "candles":
        t = (f"A {r.get('label')} is {r.get('bars')} bar(s) on the chart. "
             "The catalog names a shape. It does not forecast.")
    elif kind == "fixture" and it.get("type") == "family":
        t = f"{r.get('setup')} belongs to the {r.get('family')} family."
    elif kind == "fixture":
        verb = "fires" if r.get("fires") else "does not fire"
        t = f"{r.get('setup')}: the firm's detector {verb} on the last bar of this chart."
        if q:
            t = t + " " + q
    elif kind == "bottoms" and r.get("signpost"):
        t = f"{r.get('bottom')}: {r.get('signpost')} fired here. Count the signposts, not the days."
        if q:
            t = t + " " + q
    elif kind == "bottoms":
        t = f"{r.get('bottom')}: the {r.get('index')} fell {a} from the peak to the low."
    elif kind == "wire":
        t = f"The Wire's word that day was {a}."
    else:
        t = f"The key is {a}." if isinstance(a, str) and not re.search(r"\d", a) else "The key is in the reveal."
    if not _pass(t):
        t = "The key is in the reveal."
    return t, "template"


def validate(items: list[dict], *, allow_embed_kinds: tuple = ("fixture",)) -> list[str]:
    """Problems in `items` (empty = clean): schema, unique ids, the importer's
    question-voice / lesson-voice / grounding checks, the bars rule."""
    problems: list[str] = []
    seen: set[str] = set()
    for it in items:
        iid = it.get("id") or "?"
        if not re.fullmatch(r"si_[0-9a-f]{12}", str(iid)):
            problems.append(f"{iid}: bad id")
        if iid in seen:
            problems.append(f"{iid}: duplicate id")
        seen.add(iid)
        if it.get("type") not in ITEM_TYPES:
            problems.append(f"{iid}: bad type {it.get('type')}")
        for k in ("skill_id", "prompt_json", "answer_json", "source_kind", "source_ref"):
            if not it.get(k):
                problems.append(f"{iid}: missing {k}")
        if it.get("review_status") != "draft":
            problems.append(f"{iid}: review_status must be draft")
        if it.get("lesson_origin") not in ("template", "source"):
            problems.append(f"{iid}: lesson_origin must be template|source")
        if not (isinstance(it.get("lesson_text"), str) and it["lesson_text"].strip()):
            problems.append(f"{iid}: no lesson_text (every item teaches, spec §4.9)")
        for field in ("q", "choices", "quote"):
            if EM_DASH in json.dumps(it.get("prompt_json", {}).get(field, ""), ensure_ascii=False):
                problems.append(f"{iid}: em-dash in prompt_json.{field}")
        if EM_DASH in json.dumps(it.get("answer_json", {}), ensure_ascii=False):
            problems.append(f"{iid}: em-dash in answer_json")
        if "bars" in it:
            spec = it["bars"]
            if not isinstance(spec, dict) or isinstance(spec.get("bars"), list):
                problems.append(f"{iid}: bars must be a spec, never embedded bars")
            else:
                for k in ("sym", "tf", "asof", "window"):
                    if not spec.get(k):
                        problems.append(f"{iid}: bars spec missing {k}")
        if "bars_embed" in it and it.get("source_kind") not in allow_embed_kinds:
            problems.append(f"{iid}: only a fixture may embed bars")
        for v in study_import.voice_check(study_import.question_text(it), question=True):
            problems.append(f"{iid}: voice (question): {v}")
        for field, text in study_import.lesson_texts(it):
            for v in study_import.voice_check(text, lesson=True):
                problems.append(f"{iid}: voice ({field}): {v}")
        for tok in study_import.grounding_check(it):
            problems.append(f"{iid}: ungrounded number {tok}")
    # the near-duplicate diff within the segment (§6.2 step 3), so a
    # generator cannot ask the same thing twice under one skill
    by_skill: dict = {}
    for it in items:
        earlier = by_skill.setdefault(it.get("skill_id"), [])
        dup = study_import.near_duplicate(it, earlier)
        if dup:
            problems.append(f"{it.get('id')}: near-duplicate of {dup['id']} ({dup['score']})")
        earlier.append(it)
    return problems


def write_segment(name: str, items: list[dict]) -> pathlib.Path:
    """docs/study/bank/<name>.json, after validation (raises on a problem)."""
    problems = validate(items)
    if problems:
        raise ValueError(f"{name}: {len(problems)} problem(s):\n  " + "\n  ".join(problems[:40]))
    BANK_DIR.mkdir(parents=True, exist_ok=True)
    path = BANK_DIR / f"{name}.json"
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(items, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    return path


def load_json(path: pathlib.Path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def js_string_literals(block: str) -> list[str]:
    """Every single- or double-quoted JS string in `block`, with the `' +`
    continuation lines joined. Good enough for the hand-written catalogs."""
    out: list[str] = []
    for m in re.finditer(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"", block):
        s = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(s.replace("\\'", "'").replace('\\"', '"'))
    return out


def joined_js_string(block: str) -> str:
    """A `'a ' +\n 'b'` concatenation as one string."""
    return "".join(js_string_literals(block))


def env_flag(name: str, default: str = "") -> str:
    return os.environ.get(name, default)
