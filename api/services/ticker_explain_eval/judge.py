"""LLM judge for the dimensions checks.py cannot score mechanically:
source_selection, answer_relevance, terminal_usefulness, and (Slice 3, new)
reference_resolution. Mirrors compass_eval/judge.py's shape (a rubric-scored
0-4 per axis via a cheap model) at a fraction of the size, since this slice
has a handful of axes, not a dozen, and no fired-tool-result truncation to
worry about (the evidence bundle IS the tool result, and it's already
bounded to _MAX_NEWS_ITEMS + _MAX_ACTIONS + ... items by ticker_explain.py
itself).

Needs a live model call -- this module runs during the bounded
live-validation checkpoint, not in ordinary CI (see runner.py's module
docstring for the offline/live split)."""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

_log = logging.getLogger(__name__)

_JUDGE_MODEL = "claude-haiku-4-5"

_RUBRIC_BASE = (
    "You are grading ONE answer from UCT's contextual security-explain assistant. "
    "Score these axes, 0-4 each (0=fails badly, 4=excellent):\n"
    "- source_selection: did the answer draw on the RIGHT pieces of evidence for "
    "the question asked, not just any evidence that happened to be present?\n"
    "- answer_relevance: does the answer actually address what the member asked, "
    "concisely, without padding or generic commentary?\n"
    "- terminal_usefulness: would a trader reading this on a research terminal "
    "find it immediately useful -- specific, evidence-first, not vague?\n"
    "{reference_axis_desc}\n"
    "Return ONLY a JSON object: "
    '{{"source_selection": int, "answer_relevance": int, "terminal_usefulness": int'
    '{reference_axis_key}, "rationale": str}}.\n\n'
    "QUESTION: {question}\n\n{history_section}"
    "EVIDENCE PROVIDED TO THE ASSISTANT:\n{evidence}\n\n"
    "THE ASSISTANT'S ANSWER:\n{answer}"
)

_REFERENCE_AXIS_DESC = (
    "- reference_resolution: this question is a FOLLOW-UP in a conversation "
    "(the prior exchange is shown below). Did the answer correctly understand "
    "what the follow-up was actually asking about, given that context -- "
    "resolving pronouns/references correctly, not misreading or ignoring "
    "them?\n"
)


def _get_client():
    from api.services import engine
    return engine._get_anthropic_client()


def judge_answer(question: str, evidence: list[dict], result: dict,
                 history: Optional[list[dict]] = None) -> Optional[dict[str, Any]]:
    """None on any failure -- a judge that can't run must not fabricate a
    score (mirrors compass_eval/judge.py's judge_error/excluded-from-count
    discipline). `history` (Slice 3, optional): when provided (non-empty),
    the judge additionally scores `reference_resolution` against it; when
    omitted, that axis is left out of the request and `None` in the
    returned dict so callers can exclude it from averaging rather than
    letting an inapplicable score deflate the average."""
    if result.get("insufficient_evidence"):
        return None
    evidence_text = "\n".join(f"[{e['id']}] {e['text']}" for e in evidence) or "(none)"
    answer_text = json.dumps({
        "summary": result.get("summary"), "key_facts": result.get("key_facts"),
        "interpretation": result.get("interpretation"),
        "caveat": result.get("caveat"),
    })
    has_history = bool(history)
    history_section = ""
    if has_history:
        hist_lines = "\n".join(
            f"- Q: {h.get('question')!r} -> response_state={h.get('response_state')}, "
            f"summary: {h.get('summary')}"
            for h in history
        )
        history_section = f"PRIOR CONVERSATION:\n{hist_lines}\n\n"
    prompt = _RUBRIC_BASE.format(
        reference_axis_desc=_REFERENCE_AXIS_DESC if has_history else "",
        reference_axis_key=', "reference_resolution": int' if has_history else "",
        question=question, history_section=history_section,
        evidence=evidence_text, answer=answer_text,
    )
    try:
        resp = _get_client().with_options(timeout=30).messages.create(
            model=_JUDGE_MODEL, max_tokens=350,
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
    if has_history:
        try:
            data["reference_resolution"] = max(0, min(4, int(data.get("reference_resolution", 0))))
        except (TypeError, ValueError):
            data["reference_resolution"] = 0
    else:
        data["reference_resolution"] = None
    return data
