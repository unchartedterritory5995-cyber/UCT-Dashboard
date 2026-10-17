"""The importer's checks for Study bank items (spec §4.9, §6.2 step 3, §8.1,
§13.6, §13.9 #3). PURE FUNCTIONS over item dicts; the router calls
`check_item` on every imported item and stores a failing one as a DRAFT with
`import_flags` so nothing is silently dropped.

  grounding_check(item)        every number in the lesson / reveal prose must be
                               in the item's facts (answer_json + reveal_json),
                               with the K / M / % variants — the COT narrative's
                               number-grounding gate (cot_narrative._validate)
                               applied offline to authored text.
  voice_check(text, ...)       VOICE.md §6: banned phrases, em-dashes, emoji,
                               "traders should"; in a QUESTION also exclamation
                               marks and sentences over 22 words; in a LESSON
                               also rhetorical questions.
  near_duplicate(item, bank)   same skill + normalised question text with a
                               token Jaccard ≥ 0.85 → the id and score it hit.
  assign_review_lane(item)     deterministic (sizing arithmetic, verbatim keys)
                               · fast (agreeing provenance signals) · second_look
                               (disagreeing signals, expired / undecided
                               outcomes) · manual (everything else).

Why the grounding corpus is answer_json + reveal_json and NOT prompt_json:
§8.1 names those two. A lesson that restates a prompt number must carry that
number in its reveal facts too, which is what makes the reveal self-contained.
"""
from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

# ── VOICE.md §6, verbatim ─────────────────────────────────────────────────────

BANNED_PHRASES = (
    "may potentially", "it's important to", "in order to", "leverage", "utilize",
    "navigate your journey", "journey", "robust", "seamless", "dive in", "dive into",
    "great job", "let's explore", "in this scenario", "as a trader, you",
    "it is worth noting", "key takeaway", "comprehensive", "crucial",
    "essential component", "framework",
)
BANNED_REGISTER = ("traders should", "successful traders")
MAX_QUESTION_SENTENCE_WORDS = 22
NEAR_DUP_THRESHOLD = 0.85

#: reveal_json keys that hold PROSE (checked for voice + grounding), as opposed
#: to the facts the prose must cite.
REVEAL_PROSE_KEYS = ("verdict", "why", "lesson_line", "note")
#: prompt_json keys that hold the QUESTION the member reads.
PROMPT_QUESTION_KEYS = ("q", "question", "prompt", "text")

LANES = ("deterministic", "fast", "second_look", "manual")
#: source kinds whose recall keys are verbatim substrings of the source entry
#: (§6.3 gen_recall verification) — deterministic by construction.
VERBATIM_SOURCE_KINDS = ("glossary", "principle", "bible", "concept", "playbook", "candles",
                         "toolkit")

_EM_DASH = "—"
_EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
_WORD_RE = re.compile(r"[a-z0-9][a-z0-9'%.$-]*")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

# ── number grounding (copied from cot_narrative, kept in step by test) ────────

_NUM_RE = re.compile("[-+−]?\\$?\\d[\\d,]*(?:\\.\\d+)?%?")


def _canon(d: Decimal) -> str:
    s = format(d.normalize(), "f")
    return s[1:] if s.startswith("-") else s


def _normalise(token: str) -> Optional[str]:
    """'113,553' -> '113553'; '-12.50%' -> '12.5'; '$2,500' -> '2500'; '08' -> '8'."""
    t = token.strip().lstrip("+-−").replace("$", "").replace(",", "").rstrip("%")
    if not t:
        return None
    try:
        d = Decimal(t)
    except InvalidOperation:
        return None
    return _canon(d)


def _numbers_in_text(text: str) -> list[str]:
    return _NUM_RE.findall(text or "")


def _walk_numbers(obj, out: list) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _walk_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _walk_numbers(v, out)


def _variants(v) -> set[str]:
    """Every way prose can legitimately write the numeric value `v`."""
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        return set()
    if not d.is_finite():
        return set()
    a = abs(d)
    out = {_canon(d), _canon(a)}
    out.add(_canon(a.quantize(Decimal("1"))))          # integer rounding
    out.add(_canon(a.quantize(Decimal("0.1"))))        # one decimal
    if a >= 1000:
        k = a / Decimal(1000)
        out.add(_canon(k.quantize(Decimal("0.1"))))    # 113.6 (K)
        out.add(_canon(k.quantize(Decimal("1"))))      # 114 (K)
    if a >= 1_000_000:
        m = a / Decimal(1_000_000)
        out.add(_canon(m.quantize(Decimal("0.1"))))    # 2.5 (M)
        out.add(_canon(m.quantize(Decimal("1"))))      # 3 (M)
    if 0 < a < 1:
        p = a * Decimal(100)
        out.add(_canon(p.quantize(Decimal("1"))))      # ratio as a percent
        out.add(_canon(p.quantize(Decimal("0.1"))))
    return out


def canonical_facts(facts) -> str:
    return json.dumps(facts, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def allowed_numbers(facts, *extra: str) -> set[str]:
    """The grounding set: every numeric token anywhere in the canonical facts
    JSON (keys, strings, literals) and in `extra`, plus the derived variants of
    every numeric VALUE."""
    allowed: set[str] = set()
    corpus = canonical_facts(facts) + " " + " ".join(x for x in extra if x)
    for tok in _numbers_in_text(corpus):
        n = _normalise(tok)
        if n is not None:
            allowed.add(n)
    values: list = []
    _walk_numbers(facts, values)
    for v in values:
        allowed |= _variants(v)
    return allowed


def ungrounded_numbers(text: str, allowed: set[str]) -> list[str]:
    """The numeric tokens in `text` that are not in `allowed`, in order, deduped."""
    out: list[str] = []
    seen: set[str] = set()
    for tok in _numbers_in_text(text or ""):
        n = _normalise(tok)
        if n is not None and n not in allowed and tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


# ── item accessors ────────────────────────────────────────────────────────────

def _as_dict(v: Any) -> dict:
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        try:
            d = json.loads(v)
            return d if isinstance(d, dict) else {}
        except ValueError:
            return {}
    return {}


def question_text(item: dict) -> str:
    """The question the member reads (prompt_json.q, or the first prose key).
    Choices and quoted source text are NOT the question."""
    p = _as_dict(item.get("prompt_json"))
    for k in PROMPT_QUESTION_KEYS:
        v = p.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def lesson_texts(item: dict) -> list[tuple[str, str]]:
    """(field, text) for every prose field the checks run on: lesson_text and
    the reveal's prose keys."""
    out: list[tuple[str, str]] = []
    lt = item.get("lesson_text")
    if isinstance(lt, str) and lt.strip():
        out.append(("lesson_text", lt))
    r = _as_dict(item.get("reveal_json"))
    for k in REVEAL_PROSE_KEYS:
        v = r.get(k)
        if isinstance(v, str) and v.strip():
            out.append((f"reveal_json.{k}", v))
    return out


# ── the four checks ───────────────────────────────────────────────────────────

def grounding_check(item: dict) -> list[str]:
    """Numbers in the lesson / reveal prose that are NOT in answer_json or
    reveal_json facts (the item's asof and sym are allowed too). Empty = pass."""
    answer = item.get("answer_json")
    reveal = _as_dict(item.get("reveal_json"))
    facts_reveal = {k: v for k, v in reveal.items() if k not in REVEAL_PROSE_KEYS}
    allowed = allowed_numbers({"answer": answer, "reveal": facts_reveal},
                              str(item.get("asof") or ""), str(item.get("sym") or ""))
    bad: list[str] = []
    for field, text in lesson_texts(item):
        for tok in ungrounded_numbers(text, allowed):
            bad.append(f"{field}: {tok}")
    return bad


def _sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE_SPLIT_RE.split(text.strip()) if s.strip()]


def voice_check(text: str, *, question: bool = False, lesson: bool = False) -> list[str]:
    """VOICE.md §6 violations in `text`. Empty = pass. `question=True` adds the
    question-only rules (no exclamation marks, no sentence over 22 words);
    `lesson=True` adds the lesson-only rule (no rhetorical questions)."""
    if not text:
        return []
    low = text.lower()
    out: list[str] = []
    for phrase in BANNED_PHRASES:
        if phrase in low:
            out.append(f"banned phrase: {phrase}")
    for phrase in BANNED_REGISTER:
        if phrase in low:
            out.append(f"banned register: {phrase}")
    if _EM_DASH in text:
        out.append("em-dash")
    if _EMOJI_RE.search(text):
        out.append("emoji")
    if question:
        if "!" in text:
            out.append("exclamation mark in a question")
        for s in _sentences(text):
            n = len(s.split())
            if n > MAX_QUESTION_SENTENCE_WORDS:
                out.append(f"sentence over {MAX_QUESTION_SENTENCE_WORDS} words ({n})")
    if lesson and "?" in text:
        out.append("rhetorical question in a lesson")
    return out


def normalise_question(text: str) -> set[str]:
    """Lower-cased word tokens of a question, for the Jaccard."""
    return set(_WORD_RE.findall((text or "").lower()))


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def near_duplicate(item: dict, bank: Iterable[dict], *, threshold: float = NEAR_DUP_THRESHOLD
                   ) -> Optional[dict]:
    """The bank item with the same skill whose normalised question is at least
    `threshold` similar (token Jaccard), or None. Items with the same id are
    never compared against themselves (a re-import is not a duplicate)."""
    toks = normalise_question(question_text(item))
    if not toks:
        return None
    best: Optional[dict] = None
    for other in bank:
        if other.get("id") == item.get("id"):
            continue
        if other.get("skill_id") != item.get("skill_id"):
            continue
        score = jaccard(toks, normalise_question(question_text(other)))
        if score >= threshold and (best is None or score > best["score"]):
            best = {"id": other.get("id"), "score": round(score, 4)}
    return best


def _signals(item: dict) -> list[dict]:
    r = _as_dict(item.get("reveal_json"))
    sig = r.get("signals")
    return [s for s in sig if isinstance(s, dict)] if isinstance(sig, list) else []


def assign_review_lane(item: dict) -> str:
    """§13.6 review lanes, from the item's own provenance:

      deterministic  size items (the key is arithmetic) and recall items whose
                     key is a verbatim substring of a cited source
                     (reveal_json.quote present, source_kind verbatim-able)
      second_look    an expired / undecided outcome, or provenance signals
                     that disagree
      fast           two or more provenance signals that agree
      manual         everything else (a session-authored judgement item)
    """
    t = str(item.get("type") or "")
    r = _as_dict(item.get("reveal_json"))
    if t == "size":
        return "deterministic"
    if t == "recall" and r.get("quote") and str(item.get("source_kind") or "") in VERBATIM_SOURCE_KINDS:
        return "deterministic"
    outcome = str(r.get("outcome") or "").lower()
    if outcome in ("expired", "undecided"):
        return "second_look"
    sig = _signals(item)
    verdicts = [str(s.get("verdict")).lower() for s in sig if s.get("verdict") is not None]
    if len(verdicts) >= 2:
        return "fast" if len(set(verdicts)) == 1 else "second_look"
    if r.get("disagreement"):
        return "second_look"
    return "manual"


def check_item(item: dict, bank: Iterable[dict] = ()) -> dict:
    """Run every check. Returns {flags: [...], lane: str, near_dup: {...}|None}.
    An empty `flags` list means the item passed."""
    flags: list[str] = []
    for tok in grounding_check(item):
        flags.append(f"ungrounded number ({tok})")
    for v in voice_check(question_text(item), question=True):
        flags.append(f"voice (question): {v}")
    for field, text in lesson_texts(item):
        for v in voice_check(text, lesson=True):
            flags.append(f"voice ({field}): {v}")
    dup = near_duplicate(item, bank)
    if dup:
        flags.append(f"near-duplicate of {dup['id']} ({dup['score']})")
    return {"flags": flags, "lane": assign_review_lane(item), "near_dup": dup}
