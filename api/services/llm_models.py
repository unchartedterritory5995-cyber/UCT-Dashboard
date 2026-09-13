"""Which Claude model each kind of work runs on — the policy, in one place.

WHY THIS EXISTS. On 2026-08-28 a fleet-wide audit found **51 Anthropic call
sites across 36 modules naming their model by hand**, spread over six different
IDs (`claude-sonnet-4-6`, `claude-opus-4-8`, `claude-opus-4-7`,
`claude-haiku-4-5`, and two date-suffixed Haiku pins that no longer match the
canonical ID). Two sites read the SAME env var and disagreed on its default
(`CATALYST_OPUS_MODEL` -> `claude-opus-4-7` in `call_recap.py`, `claude-opus-4-8`
in `calendar_sector_read.py`), so what model ran depended on which module you
read. That is this repo's most repeated defect wearing a new hat —
`lesson_a_second_authority_over_one_value`: **derive, never restate.**

A model ID is not a per-service decision. What each site actually decides is
what KIND of work it is doing; the tier decides the model. Then a migration is
one edit here instead of fifty, and a site added tomorrow is on the current
model the day it ships rather than pinned to whatever was newest when its author
wrote it.

  FLAGSHIP  — the words are the product, or the judgment is hard enough that
              being wrong is expensive. Member-facing prose (the wire letter,
              Top 5 picks, desk titles, the COT weekly read), and adjudication
              whose output persists (theme membership, the concierge's AST).
  WORKHORSE — the default, and where most traffic belongs. Structured
              extraction, per-request synthesis, summarization, ranking.
  CHEAP     — graders, health probes, and lookups behind a short timeout, where
              latency or volume dominates and quality is not the product.

⛔ PICK BY JOB, NOT BY BILL. "This runs a lot, so make it cheap" inverts the
question: a high-volume surface members read is exactly where quality compounds.
`FLAGSHIP` costs 2.5x `WORKHORSE` per token, which is a real number and a small
one against a wire letter nobody wants to read twice.

⛔⛔ CLAUDE 5 MODELS REJECT SAMPLING PARAMETERS. `temperature`, `top_p` and
`top_k` return a 400 on every model this module names. The 2026-08-28 audit
found **13 call sites passing `temperature` with no retry guard**, including all
four Model Book sites and the ENTIRE Compass surface (coach chat, weekly review,
EOD recap, trade review, pre-trade verdict) — so moving those defaults without
removing the kwarg in the same commit would have taken down every coaching path
at once. Five other modules already carry in-code postmortems of exactly this
failure. `tools/llm_model_census.py` now refuses a sampling parameter outright,
so the next author cannot rediscover it in production.

⛔ ADAPTIVE THINKING IS ON BY DEFAULT. Every model here reasons before it
answers unless told otherwise, which means `response.content[0]` is often a
`ThinkingBlock` and `content[0].text` raises `AttributeError` — a silent failure
inside a broad `except`, not a 400. Read text with `text_of()` below, never by
index. (`thinking={"type": "disabled"}` remains correct for a latency-bound
surface; it is a deliberate opt-out, not the default.)
"""
from __future__ import annotations

import os

# The words are the product, or a wrong answer is expensive and persists.
# $5/$25 per MTok — the same rate as the Opus 4.6/4.7/4.8 this replaced, so
# every site that was already on an Opus moved here for free.
FLAGSHIP = "claude-opus-5"

# The default tier. $2/$10 per MTok — BOTH cheaper and stronger than the
# `claude-sonnet-4-6` most of this fleet ran before 2026-08-28 ($3/$15), so that
# migration had no tradeoff to weigh. Note the tokenizer produces ~30% more
# tokens for the same text, so the net saving is ~10-15%, not the 33% the list
# prices suggest: re-baseline a cost dashboard against measurement, not against
# this comment.
WORKHORSE = "claude-sonnet-5"

# Graders, health probes, and lookups behind a short timeout. Haiku 4.5 is a
# 200K-context model — the only tier here that is not 1M — which matters for a
# grader fed a large transcript.
CHEAP = "claude-haiku-4-5"


def name(env_name: str, tier: str) -> str:
    """`tier`, overridable per surface by the `env_name` environment variable.

    Mirrors `llm_timeouts.seconds()`: the coded value is the policy, and the env
    var is the operator's escape hatch for retuning ONE surface from Railway
    without a deploy — how a regression gets contained at 3pm on a weekday.

    Fail-soft on a blank or whitespace override, because the failure mode of an
    empty env var would otherwise be a 404 from the API on every call to that
    surface. An override is NOT validated against a known-model list: pinning a
    model this module has never heard of is a legitimate thing for an operator
    to do during an incident, and a validator here would be a second authority
    over which models exist.
    """
    raw = os.environ.get(env_name)
    if raw is None or not str(raw).strip():
        return tier
    return str(raw).strip()


def text_of(response) -> str:
    """The assistant's TEXT, ignoring thinking blocks. Never indexes `content`.

    ⛔ THIS IS NOT A CONVENIENCE. Adaptive thinking is on by default on every
    model this module names, so `content[0]` is frequently a `ThinkingBlock` and
    the near-universal `response.content[0].text` raises `AttributeError`. The
    2026-08-28 audit found that pattern inside broad `except Exception` handlers
    at four Discord-bot sites, where it would have degraded `/ask` and `/recall`
    to a generic error string that names no cause — the failure this repo keeps
    paying for, which is a real fault reported as nothing.

    Returns "" when the model produced no text at all (a pure-refusal turn, or a
    reply that spent its whole `max_tokens` budget on thinking). Callers that
    care about the difference should check `stop_reason` themselves —
    `refusal` and `max_tokens` are different problems with different fixes, and
    collapsing them here would hide both.
    """
    parts = []
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
    return "".join(parts)
