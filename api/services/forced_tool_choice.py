"""THE MODELS THAT REJECT A FORCED TOOL CALL, and what this server does when it is pointed at one.

Every assistant call here FORCES its tool (`tool_choice={"type": "tool", "name": ...}`): the formula assistant, the
conversation door, the script turn, the indicator-from-an-image reader and the plain-words screener. Some Claude
models reject that with a 400 (`tool_choice: type "tool" and "any" are not supported for this model.`). The model
is one environment variable, so one line of configuration would take every one of those calls down, each paying a
round trip to be refused, with nothing naming the cause where a person looks.

⭐ THE SOURCE, so this table can be RE-READ rather than trusted (read 2026-11-23):
    https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
    section "Controlling Claude's output" > "Forcing tool use"
  "Not every model and setting supports forced tool use. Where it isn't supported, `tool_choice: {"type": "any"}`
  and `tool_choice: {"type": "tool", "name": "..."}` fail": the table there names Claude Fable 5.2, Claude Mythos 5.2,
  Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1 and Claude Mythos 5.1 ("`any` and `tool` return a 400
  error"). The same is said in each of those models' migration guides. Models with thinking on by default "such as
  Claude Opus 5 and Claude Haiku 5.5, accept it".

⛔ THE TABLE'S LIMIT. A model released after that date is NOT listed here. Whoever changes CONCIERGE_MODEL,
INDICATOR_VISION_MODEL or SCREENER_NL_MODEL must read that section again for the model they choose: a model this
table does not know is treated as accepting the forced call, and the API is then the one that says otherwise.

⛔ NEVER A FALL BACK TO `tool_choice: auto` (ruled 2026-11-23). Under `auto` a model may answer in prose with no
tool call, and the newer models differ in thinking and in their default effort. Every figure this product holds its
assistant to was measured with a forced call on the configured model. A silent fall back would put members on a
configuration nobody measured. The assistant refuses by name instead, before any call and any charge, and
`/api/health` says the setting is incompatible.
"""
from __future__ import annotations

import logging
from typing import Any, List, Optional, Tuple

SOURCE = "https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools"
SECTION = "Controlling Claude's output > Forcing tool use"
READ_ON = "2026-11-23"

#: The model ids that reject `tool_choice` of type `tool` or `any` (the table of SOURCE / SECTION, by id).
REJECTED_BY = frozenset({
    "claude-fable-5-2", "claude-mythos-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1",
})

#: What `/api/health` says, and all it says: never the model, a variable's name or anything else.
HEALTH_VALUE = "incompatible"

logger = logging.getLogger(__name__)


def rejects(model: Any) -> bool:
    """Does this model id name a model that rejects a forced tool call? The id as it is configured: a platform's
    prefix ("anthropic.claude-opus-5-5") and a version suffix ("claude-opus-5-5@20260401", "...-20260401") still name
    the model. `claude-opus-5` is not `claude-opus-5-5`. Anything that is not a model id: no."""
    if not isinstance(model, str) or not model.strip():
        return False
    name = model.strip().lower().rsplit("/", 1)[-1]
    if "anthropic." in name:
        name = name.split("anthropic.", 1)[1]
    return any(name == listed or name.startswith(listed + "-") or name.startswith(listed + "@") for listed in REJECTED_BY)


def configured() -> List[Tuple[str, Any]]:
    """[(what uses it, the model it is set to)] for every forced tool call this server makes. Read from the modules
    that make the calls (their own variable and their own default): never restated here."""
    from api.services import definition_concierge, indicator_from_image
    from api.services.screener import nl_compile
    return [("the assistant (formula, conversation and script turns)", definition_concierge.MODEL),
            ("indicator from an image", indicator_from_image.MODEL),
            ("screener in plain words", nl_compile.model())]


def incompatible() -> List[str]:
    """What is configured with a model that rejects the forced call it makes ([] when all is well)."""
    return [what for what, model in configured() if rejects(model)]


def startup_problem() -> Optional[str]:
    """HEALTH_VALUE when any forced call is configured with a model that rejects it, else None."""
    return HEALTH_VALUE if incompatible() else None


def log_startup_problem() -> Optional[str]:
    """ONE named error when the server starts with such a setting. Returns what `startup_problem` does."""
    bad = incompatible()
    if not bad:
        return None
    logger.error("[assistant-model] FORCED TOOL CHOICE UNSUPPORTED: the configured model rejects the forced tool call made by: "
                 "%s. Every such turn is refused by name before any call. Set the model back, or read %s (%s) for the "
                 "model you chose. Never worked around with tool_choice auto.", "; ".join(bad), SOURCE, SECTION)
    return HEALTH_VALUE
