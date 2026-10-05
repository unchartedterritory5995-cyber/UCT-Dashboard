"""English -> a finished screen (FT-024 / FT-030), compiled INTO the grammar.

"Liquid tech names up more than 20% this quarter with RS above 90, no
utilities" becomes the where-grammar text a member can read and edit, plus the
logic tree the screener runs and one sentence per criterion.

⭐ THE MODEL WRITES GRAMMAR, NEVER A SCREEN. Its whole output is one string in
the language `grammar.py` defines, and that string is then parsed by the same
parser a member's own typed criteria go through. So the model cannot name a
column that does not exist, use an operator the screener lacks, or put a % on
a price -- the parser refuses all of that by construction, and a refused text
gets ONE repair call carrying the parser's own sentence. If the repair also
fails the member gets a sentence, never a guessed screen. This is the
"compiles English into that language, alongside the text form" design FT-030
names, and it is why TERM-087's scan-definition door was not reused: that door
produces a 0/1 formula that reaches the screener only after the nightly sweep.

THE RULES.
  * DARK: `SCREENER_NL_COMPILE_ENABLED` (default off, read per call).
  * METERED: `SCREENER_NL_DAILY_CAP` compiles per member per ET day (default
    30, durable in `daily_counters`), then the population cap
    (`ai_population_cap.admit`, door "screener_nl"); a refusal by either
    charges nothing and a failed compile gives the member's charge back.
  * BOUNDED: the shared Anthropic client's own timeout, zero SDK retries (the
    Concierge's reasoning: a timed-out attempt is billed and unledgered), at
    most two model calls per compile.
  * Model: `SCREENER_NL_MODEL`, default the Concierge's model. Never
    downgraded for cost.
"""
from __future__ import annotations

import os
from typing import Any, Callable

from api.services import daily_counters
from . import filters, grammar, logic

FLAG = "SCREENER_NL_COMPILE_ENABLED"
CAP_ENV = "SCREENER_NL_DAILY_CAP"
DEFAULT_DAILY_CAP = 30
SCOPE = "screener_nl_compile"
MAX_ENGLISH = 600
MAX_TOKENS = 4096
TOOL_NAME = "emit_criteria"

CAP_SENTENCE = "You've used today's plain-English screens. It resets at midnight ET."


class CompileError(ValueError):
    """A sentence for the member."""


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def model() -> str:
    return os.environ.get("SCREENER_NL_MODEL") or os.environ.get("CONCIERGE_MODEL", "claude-opus-5")


def daily_cap() -> int:
    try:
        v = int(os.environ.get(CAP_ENV, DEFAULT_DAILY_CAP))
        return v if v >= 0 else DEFAULT_DAILY_CAP
    except (TypeError, ValueError):
        return DEFAULT_DAILY_CAP


def _et_day() -> str:
    from api.services.journal_two.calendar import et_today
    return et_today()


def field_table() -> str:
    lines = []
    for k, f in filters.FILTERS.items():
        unit = f.get("unit")
        lines.append(f"{k} | {f['label']} | {f['type']}{(' | ' + unit) if unit else ''}")
    return "\n".join(lines)


SYSTEM = """You translate a trader's plain-English stock screen into ONE criteria string in this exact language.

LANGUAGE
- field op value, joined with and / or / not and parentheses. `and` binds tighter than `or`.
- ops: > >= < <= = != ; `field between A and B` ; `field in [a, b]` ; `field not in [a, b]` ; `field contains "text"`.
- numbers may use k, m, b, t (thousand, million, billion, trillion). `%` is allowed ONLY on fields whose unit is %, and means the same number (25% is 25).
- compare two fields directly: `gross_margin > op_margin` (range fields only).
- yes/no fields: `field = true` or `field = false`.
- text values in quotes or bare words inside [ ].
- NOT in the language: arithmetic between fields, $TICKER / @group / #list prefixes. Do not use them.

RULES
- Use ONLY field keys from the table below, spelled exactly.
- Prefer a reasonable, conventional threshold over refusing, and list every threshold you chose as an assumption.
- If the request cannot be expressed with these fields, return the closest honest screen and say what was left out in assumptions.
- Output only through the emit_criteria tool.

FIELDS (key | label | type | unit)
"""


def _tool() -> dict:
    return {
        "name": TOOL_NAME,
        "description": "Return the screen as one criteria string in the language described.",
        "input_schema": {
            "type": "object",
            "properties": {
                "criteria": {"type": "string"},
                "assumptions": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["criteria", "assumptions"],
        },
    }


def _call(messages: list[dict]) -> dict:
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client().with_options(max_retries=0)
    msg = client.messages.create(
        model=model(), max_tokens=MAX_TOKENS, system=SYSTEM + field_table(),
        tools=[_tool()], tool_choice={"type": "tool", "name": TOOL_NAME},
        messages=messages,
    )
    for block in getattr(msg, "content", []) or []:
        if getattr(block, "type", None) == "tool_use":
            return dict(block.input or {})
    raise CompileError("The model did not return criteria. Try rephrasing.")


def _parse(text: str) -> dict:
    node = grammar.parse(text)
    logic.validate(node)
    return node


def compile_english(english: str, *, caller: Callable[[list[dict]], dict] | None = None) -> dict[str, Any]:
    """English -> {criteria, logic, explanation, assumptions}. At most two
    model calls. Raises CompileError with a sentence. Does not meter."""
    caller = caller or _call
    english = (english or "").strip()
    if not english:
        raise CompileError("Describe the screen you want.")
    if len(english) > MAX_ENGLISH:
        raise CompileError(f"Keep the description under {MAX_ENGLISH} characters.")
    messages = [{"role": "user", "content": english}]
    out = caller(messages)
    text = str(out.get("criteria") or "")
    try:
        node = _parse(text)
    except ValueError as first:
        messages = messages + [
            {"role": "assistant", "content": f"criteria: {text}"},
            {"role": "user", "content": f"The parser refused that: {first}. Return corrected criteria."},
        ]
        out = caller(messages)
        text = str(out.get("criteria") or "")
        try:
            node = _parse(text)
        except ValueError as second:
            raise CompileError(f"That could not be turned into a screen ({second}). Try rephrasing.")
    return {"criteria": text, "logic": node, "explanation": grammar.explain(node),
            "assumptions": [str(a) for a in (out.get("assumptions") or [])][:10]}


def take(user_id) -> bool:
    charge = daily_counters.Charge(SCOPE, str(user_id), 1, daily_cap())
    return daily_counters.take(_et_day(), [charge]) is None


def give_back(user_id) -> None:
    daily_counters.give_back(_et_day(), [daily_counters.Charge(SCOPE, str(user_id), 1, None)])
