"""The current model IDs and the two request shapes that differ between them.

WHY. Moving a call from an older model to the current, cheaper one breaks on
two request fields, and the break differs by model (2026-11-10, verified
against the Claude API reference shipped with the anthropic SDK skill):

  * THINKING OFF is spelled three ways. Sonnet 5.5 rejects `{"type":"disabled"}`
    (400) and takes `{"type":"between_tools"}`; Opus 5.5 / Fable / Mythos cannot
    turn thinking off at all (send nothing, lower `effort` instead); every other
    model takes `{"type":"disabled"}`.
  * SAMPLING. `temperature` is a 400 on Opus 4.7+ and every 5.x model; only the
    4.6-and-older generation still accepts it.

Call sites are env-overridable, so they must not hard-code either shape for the
DEFAULT model: an operator who points one back at Sonnet 4.6 would get a 400
from `between_tools`. `plain(model, temperature=...)` derives the right kwargs
from the model actually being called.

`text_of(message)` joins the TEXT blocks. ⛔ Never `content[0].text`: on any
model that thinks by default the first block is a thinking block, which has no
`.text` -- an AttributeError raised AFTER the call was billed.
"""
from __future__ import annotations

from typing import Any

SONNET = "claude-sonnet-5-5"
HAIKU = "claude-haiku-5-5"
OPUS = "claude-opus-5-5"

_CANNOT_DISABLE_THINKING = ("claude-opus-5-5", "claude-fable", "claude-mythos")
_TAKES_TEMPERATURE = ("claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4-2", "claude-haiku-4-5",
                      "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-opus-4-2", "claude-3")


def thinking_off(model: str) -> dict | None:
    m = str(model or "")
    if m.startswith("claude-sonnet-5-5"):
        return {"type": "between_tools"}
    if m.startswith(_CANNOT_DISABLE_THINKING):
        return None
    return {"type": "disabled"}


def takes_temperature(model: str) -> bool:
    return str(model or "").startswith(_TAKES_TEMPERATURE)


def plain(model: str, *, temperature: float | None = None) -> dict:
    """kwargs for a no-thinking call on `model`, keeping `temperature` only where
    the model still accepts it."""
    out: dict[str, Any] = {}
    t = thinking_off(model)
    if t is not None:
        out["thinking"] = t
    if temperature is not None and takes_temperature(model):
        out["temperature"] = temperature
    return out


def text_of(message: Any) -> str:
    content = getattr(message, "content", None) or []
    return "".join(getattr(b, "text", "") or "" for b in content if getattr(b, "type", "") == "text")
