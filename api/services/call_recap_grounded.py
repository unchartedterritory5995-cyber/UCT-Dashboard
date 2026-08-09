"""Transcript-grounded earnings call recap.

The old recap was synthesized from a single Perplexity `web_search` capped at 600
tokens, and its prompt asked for quotes that were explicitly "paraphrased or
verbatim". Meanwhile FMP publishes the FULL verbatim transcript — uncapped on the
Ultimate plan, cached 30 days, no LLM anywhere in its path. This module reads
that transcript instead.

The load-bearing rule:

    THE MODEL NEVER TELLS US WHERE A QUOTE CAME FROM.

It returns verbatim text; `locate()` finds that text in the transcript and the
server computes the segment index. Anything it cannot locate is DROPPED rather
than rendered. So a quote on screen is either genuinely in the transcript and
correctly attributed, or it does not exist — a fabricated quote cannot reach the
UI, and a real quote cannot carry the wrong speaker's name.

Model: `CALL_RECAP_MODEL` (default claude-sonnet-5). This is extraction plus
verification rather than open-ended synthesis, and the gate above closes the
failure mode a larger model would be protecting against, so the Sonnet tier is
the right default here — deliberately NOT the catalyst engine's Opus setting.
Measured ~17.5k input tokens per transcript (DIS/AAPL/JPM, 2026-08).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

_log = logging.getLogger(__name__)

# Deliberately its own knobs. `get_call_recap` used to read CATALYST_OPUS_MODEL
# and spend from the catalyst engine's daily cap, so a morning of stepping
# through reporters could silently disable catalyst synthesis for the day.
_MODEL  = os.environ.get("CALL_RECAP_MODEL", "claude-sonnet-5")
_EFFORT = os.environ.get("CALL_RECAP_EFFORT", "medium")
_MAX_TOKENS = int(os.environ.get("CALL_RECAP_MAX_TOKENS", "8000"))

# A quote may be stitched from clauses with an ellipsis. Each run still has to
# appear in one segment, in order — this loosens the match, never the grounding.
_ELLIPSIS = re.compile(r"\s*(?:\.\.\.|…)\s*")
_MIN_RUN = 15          # below this a "run" matches almost anything
_WS = re.compile(r"\s+")

# Typographic variants the model normalises away when it copies text out.
_QUOTE_MAP = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"',
    "–": "-", "—": "-", "−": "-", " ": " ",
})


def normalize(text: str) -> str:
    """Fold the differences that are not meaning: whitespace, smart quotes, case."""
    if not isinstance(text, str):
        return ""
    return _WS.sub(" ", text.translate(_QUOTE_MAP)).strip().casefold()


def locate(quote: str, segments: list[dict]) -> Optional[int]:
    """Index of the segment containing `quote`, or None if it isn't in any.

    None is the whole point: the caller drops the item rather than guessing.
    """
    runs = [r for r in _ELLIPSIS.split(quote or "") if len(r.strip()) >= _MIN_RUN]
    if not runs:
        runs = [quote or ""]
    normed = [normalize(r) for r in runs]
    if not all(normed):
        return None

    for i, seg in enumerate(segments or []):
        hay = normalize(seg.get("content", ""))
        if not hay:
            continue
        cursor, ok = 0, True
        for part in normed:
            found = hay.find(part, cursor)
            if found < 0:
                ok = False
                break
            cursor = found + len(part)   # runs must appear IN ORDER
        if ok:
            return i
    return None


def ground_items(items, segments, *, field: str = "quote") -> list[dict]:
    """Keep only the items whose verbatim text is in the transcript.

    Attaches `segment` (the located index) and `speaker` (read from THAT
    segment, never from the model — the model can copy a quote correctly and
    still attribute it to the wrong person).
    """
    out: list[dict] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        quote = (item.get(field) or "").strip()
        if not quote:
            continue
        idx = locate(quote, segments)
        if idx is None:
            _log.info("[call_recap] dropped ungrounded %s: %.60r", field, quote)
            continue
        seg = segments[idx]
        grounded = dict(item)
        grounded["segment"] = idx
        grounded["speaker"] = (seg.get("speaker") or "").strip()
        out.append(grounded)
    return out


def prepared_remarks_end(segments: list[dict]) -> Optional[int]:
    """Index of the first Q&A turn, or None when it can't be determined.

    Measured on seven live transcripts: three (DIS, MSFT, JPM) contain no
    "question-and-answer" phrasing at all, so this returns None for them and the
    UI omits the chip. An omitted boundary is honest; a guessed one is a
    confident lie about where the prepared remarks stopped.
    """
    marker = re.compile(
        r"question[-\s]and[-\s]answer|q\s*&\s*a\s+session|"
        r"(?:we(?:'ll| will)?\s+now\s+(?:begin|open|take)|open\s+the\s+(?:call|floor))"
        r".{0,40}?question",
        re.I,
    )
    for i, seg in enumerate(segments or []):
        if marker.search(seg.get("content", "") or ""):
            return min(i + 1, len(segments) - 1)
    return None


def render_transcript(segments: list[dict]) -> str:
    """The transcript as the model sees it — numbered turns, speaker prefixed."""
    lines = []
    for i, seg in enumerate(segments or []):
        who = (seg.get("speaker") or "").strip() or "Unknown"
        lines.append(f"[{i}] {who}: {seg.get('content', '')}")
    return "\n\n".join(lines)


# The model is told to return verbatim text and NOTHING about location — every
# index in the rendered transcript above is for its reading, not its output.
RECAP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "sentiment", "bullets", "quotes",
                 "forward_looking", "guidance", "guidance_detail",
                 "qa_highlights", "speakers"],
    "properties": {
        "headline":  {"type": "string"},
        "sentiment": {"type": "string",
                      "enum": ["positive", "negative", "mixed", "neutral"]},
        "bullets":   {"type": "array", "items": {"type": "string"}},
        "guidance":  {"type": "string",
                      "enum": ["raised", "cut", "maintained", "none"]},
        "guidance_detail": {"type": "string"},
        "quotes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["topic", "quote"],
                "properties": {
                    "topic": {"type": "string"},
                    "quote": {"type": "string"},
                },
            },
        },
        "forward_looking": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["topic", "horizon", "detail", "quote"],
                "properties": {
                    "topic":   {"type": "string"},
                    "horizon": {"type": "string",
                                "enum": ["next_quarter", "full_year",
                                         "multi_year", "unspecified"]},
                    "detail":  {"type": "string"},
                    "quote":   {"type": "string"},
                },
            },
        },
        # `question` and `takeaway` are the model's own prose; `quote` is the
        # only verbatim field and the only one the gate can check. Measured on
        # the live DIS call: demanding a verbatim `answer` dropped 4 of 5 items,
        # because a 500-word answer is something any model condenses. Asking for
        # prose AS prose and gating a short excerpt keeps both honest.
        "qa_highlights": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["analyst", "firm", "question", "takeaway", "quote"],
                "properties": {
                    "analyst":  {"type": "string"},
                    "firm":     {"type": "string"},
                    "question": {"type": "string"},
                    "takeaway": {"type": "string"},
                    "quote":    {"type": "string"},
                },
            },
        },
        "speakers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "role"],
                "properties": {
                    "name": {"type": "string"},
                    "role": {"type": "string"},
                },
            },
        },
    },
}

_PROMPT = """You are reading the verbatim transcript of {sym}'s most recent earnings call.

Produce a recap for an experienced trader who did not listen to the call.

RULES FOR EVERY `quote` FIELD — these are strict:
- Copy the words EXACTLY as they appear in the transcript. Do not paraphrase,
  tidy, condense, or fix grammar. A quote that is not a character-for-character
  copy will be discarded by an automated check and will not reach the reader.
- Do not merge words spoken by two different people into one quote.
- Use "…" only to elide words WITHIN one speaker's continuous passage.
- Prefer quotes that are specific: a number, a target, a commitment, a named
  driver. Skip pleasantries, thanks, and operator boilerplate.

Return:
- headline: one sentence on what the call actually established.
- sentiment: the call's tone on its own terms, not the stock reaction.
- bullets: 5-8 concrete takeaways, each carrying a specific figure or fact.
- quotes: 5-8 of the most consequential things management actually said.
- forward_looking: every statement about FUTURE performance — guidance, targets,
  demand commentary, margin or capex trajectory, segment outlook. `detail` is
  your plain-language reading; `quote` is the verbatim words it rests on.
  `horizon` says which period it concerns. This is the section a trader reads
  first; be thorough rather than selective.
  The `quote` MUST be MANAGEMENT stating the outlook. An analyst or the
  moderator restating guidance back in a question is not the company saying it —
  quote management's own answer instead, or leave the item out.
- guidance: the direction of formal guidance versus the prior period.
- guidance_detail: one or two sentences on what specifically changed. Empty
  string if no formal guidance was given.
- qa_highlights: up to 5 exchanges that moved the story. `question` and
  `takeaway` are your own words — summarise freely, do not quote. `quote` is a
  SHORT verbatim excerpt of management's answer (one or two sentences), copied
  exactly under the quote rules above.
- speakers: every person who speaks, with their role (CEO, CFO, analyst at a
  named firm, Operator). Use the exact name as it appears before the colon.

Do NOT report where in the transcript anything appears — that is computed
separately. The bracketed numbers are for your reading only.

TRANSCRIPT
{transcript}"""


def _client():
    import anthropic
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic()


def synthesize(sym: str, transcript: dict) -> Optional[dict[str, Any]]:
    """Recap grounded in `transcript`, or None. Never raises."""
    segments = (transcript or {}).get("segments") or []
    if len(segments) < 2:
        return None

    import json
    try:
        resp = _client().messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            # Structured outputs: the schema is enforced, so there is no fenced
            # JSON to strip and no parse failure to cache as "no recap".
            output_config={
                "format": {"type": "json_schema", "schema": RECAP_SCHEMA},
                "effort": _EFFORT,
            },
            messages=[{"role": "user", "content": _PROMPT.format(
                sym=sym, transcript=render_transcript(segments))}],
        )
        if getattr(resp, "stop_reason", None) == "refusal":
            _log.warning("[call_recap] %s refused for %s", _MODEL, sym)
            return None
        text = next((b.text for b in resp.content if b.type == "text"), "")
        data = json.loads(text)
    except Exception as exc:
        _log.warning("[call_recap] grounded synthesis failed for %s: %s", sym, exc)
        return None

    # ── The gate ─────────────────────────────────────────────────────────────
    data["quotes"] = ground_items(data.get("quotes"), segments)
    # The Operator never states company guidance — it reads instructions and
    # introduces analysts. A forward-looking item that lands on that turn is
    # mis-sourced by construction, so drop it rather than re-prompting for
    # compliance. (A moderator restating guidance inside a QUESTION still gets
    # through; the reader sees the speaker name and can open the turn.)
    data["forward_looking"] = [
        f for f in ground_items(data.get("forward_looking"), segments)
        if (f.get("speaker") or "").strip().lower() != "operator"
    ]
    data["qa_highlights"] = ground_items(data.get("qa_highlights"), segments)

    data["speakers"] = {
        s["name"]: s.get("role", "")
        for s in (data.get("speakers") or [])
        if isinstance(s, dict) and s.get("name")
    }
    data["quarter"] = transcript.get("quarter")
    data["prepared_remarks_end"] = prepared_remarks_end(segments)
    data["grounded"] = True
    data["_usage"] = {
        "input_tokens": getattr(resp.usage, "input_tokens", 0),
        "output_tokens": getattr(resp.usage, "output_tokens", 0),
        "model": _MODEL,
    }
    return data
