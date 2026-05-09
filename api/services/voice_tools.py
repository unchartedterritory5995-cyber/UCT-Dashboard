"""
Voice tool registry. The single source of truth for what the voice
assistant can do. Tools are registered via @voice_tool() decorator.

Slice 2 (Mode B) adds read-only tools.
Slice 5+ will add write tools with two-phase preview/confirm.
"""

from typing import Any, Callable
import logging

_log = logging.getLogger(__name__)

_REGISTRY: dict[str, dict] = {}


def voice_tool(
    *,
    name: str,
    description: str,
    parameters: dict,
    contexts: list[str],
    wants_user: bool = False,
):
    """
    Register a function as a voice tool.

    Args:
        name: unique tool name (e.g. "get_quote")
        description: short natural-language description for the LLM classifier
        parameters: JSON schema "properties" dict — e.g. {"symbol": {"type": "string"}}
        contexts: list of page contexts where this tool is available
                  (e.g. ["global"], ["chart"], ["journal"])
        wants_user: if True, dispatcher passes user dict as kwarg "user"
    """
    def decorator(fn: Callable):
        _REGISTRY[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "contexts": set(contexts),
            "wants_user": wants_user,
            "fn": fn,
        }
        return fn
    return decorator


def get_schema_for_context(context: str) -> list[dict]:
    """Return JSON-schema dicts for all tools available in the given context."""
    out = []
    for entry in _REGISTRY.values():
        if context in entry["contexts"]:
            out.append({
                "name": entry["name"],
                "description": entry["description"],
                "parameters": {
                    "type": "object",
                    "properties": entry["parameters"],
                },
            })
    return out


def dispatch(name: str, args: dict, *, user: dict | None = None) -> dict:
    """
    Look up a tool by name, validate args, call it, return its result dict.
    """
    entry = _REGISTRY.get(name)
    if entry is None:
        raise KeyError(f"voice tool {name!r} not found")

    fn = entry["fn"]
    call_kwargs = dict(args or {})
    if entry["wants_user"]:
        call_kwargs["user"] = user or {}

    try:
        result = fn(**call_kwargs)
    except TypeError as e:
        raise ValueError(f"tool {name} arg mismatch: {e}")

    if not isinstance(result, dict):
        raise TypeError(f"tool {name} must return a dict, got {type(result).__name__}")
    return result


def all_tool_names() -> list[str]:
    return sorted(_REGISTRY.keys())
