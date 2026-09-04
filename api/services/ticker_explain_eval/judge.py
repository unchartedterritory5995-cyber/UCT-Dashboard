"""LLM judge for the three dimensions checks.py cannot score mechanically:
source_selection, answer_relevance, terminal_usefulness. Mirrors
compass_eval/judge.py's shape (a rubric-scored 0-4 per axis via a cheap
model) at a fraction of the size, since this slice has three axes, not
four, and no fired-tool-result truncation to worry about (the evidence
bundle IS the tool result, and it's already bounded to
_MAX_NEWS_ITEMS + _MAX_ACTIONS items by ticker_explain.py itself).

Needs a live model call -- this module runs during the bounded
live-validation checkpoint, not in ordinary CI (see runner.py's module
docstring for the offline/live split)."""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

_log = logging.getLogger(__name__)

_JUDGE_MODEL = "claude-haiku-4-5"

_RUBRIC = (
    "You are grading ONE answer from UCT's contextual security-explain assistant. "
    "Score three axes, 0-4 each (0=fails badly, 4=excellent):\n"
    "- source_selection: did the answer draw on the RIGHT pieces of evidence for "
    "the question asked, not just any evidence that happened to be present?\n"
    "- answer_relevance: does the answer actually address what the member asked, "
    "concisely, without padding or generic commentary?\n"
    "- terminal_usefulness: would a trader reading this on a research terminal "
    "find it immediately useful -- specific, evidence-first, not vague?\n\n"
    "Return ONLY a JSON object: "
    # 2026-09-04 live-validation fix: the literal JSON example's braces
    # collided with str.format()'s own placeholder syntax (KeyError on the
    # quoted key names) -- doubled here so .format() emits them literally,
    # leaving the three real {question}/{evidence}/{answer} placeholders
    # single-braced.
    '{{"source_selection": int, "answer_relevance": int, "terminal_usefulness": int, "rationale": str}}.\n\n'
    "QUESTION: {question}\n\nEVIDENCE PROVIDED TO THE ASSISTANT:\n{evidence}\n\n"
    "THE ASSISTANT'S ANSWER:\n{answer}"
)


def _get_client():
    from api.services import engine
    return engine._get_anthropic_client()


def judge_answer(question: str, evidence: list[dict], result: dict) -> Optional[dict[str, Any]]:
    """None on any failure -- a judge that can't run must not fabricate a
    score (mirrors compass_eval/judge.py's judge_error/excluded-from-count
    discipline)."""
    if result.get("insufficient_evidence"):
        # Nothing to judge for relevance/usefulness/source-selection when the
        # assistant correctly declined -- that correctness is already scored
        # by checks.check_insufficient_evidence_behavior.
        return None
    evidence_text = "\n".join(f"[{e['id']}] {e['text']}" for e in evidence) or "(none)"
    answer_text = json.dumps({
        "summary": result.get("summary"), "key_facts": result.get("key_facts"),
        "interpretation": result.get("interpretation"),
    })
    prompt = _RUBRIC.format(question=question, evidence=evidence_text, answer=answer_text)
    try:
        resp = _get_client().with_options(timeout=30).messages.create(
            model=_JUDGE_MODEL, max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") or "" for b in resp.content).strip()
        if text.startswith("```"):
            text = text.strip("`").split("\n", 1)[-1]
        data = json.loads(text)
    except Exception as exc:
        _log.warning("[ticker_explain_eval.judge] judge call failed: %s", exc)
        return None
    for axis in ("source_selection", "answer_relevance", "terminal_usefulness"):
        try:
            data[axis] = max(0, min(4, int(data.get(axis, 0))))
        except (TypeError, ValueError):
            data[axis] = 0
    return data
