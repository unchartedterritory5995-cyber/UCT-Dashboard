"""
Wraps voice_tools.dispatch with:
  - error normalization (always returns {ok, result|error} envelope for Realtime)
  - audit logging (session_id transcripts, future Slice 5 write-tool gate)

The OpenAI Realtime API expects function call results as a JSON-serializable
value. This module returns {"ok": bool, "result": ..., "error": ...} so the
browser data-channel handler can pass it straight through.
"""

import json
import logging

from api.services.voice_tools import dispatch
from api.services.voice_session_service import append_transcript

_log = logging.getLogger(__name__)


def run_tool(
    *,
    session_id: int | None,
    user_id: str,
    tool_name: str,
    args: dict,
) -> dict:
    """
    Execute a tool. Always returns {ok, result|error}.

    session_id: optional. When present, appends a transcript entry of role 'tool'.
    """
    safe_args = args or {}

    try:
        result = dispatch(tool_name, safe_args, user={"id": user_id})
    except KeyError as e:
        msg = f"tool {tool_name!r} not found"
        _log.warning(msg)
        return {"ok": False, "tool": tool_name, "error": msg}
    except (ValueError, TypeError) as e:
        msg = f"tool {tool_name} failed: {e}"
        _log.warning(msg)
        if session_id:
            append_transcript(session_id, role="tool", text=f"{tool_name}: ERROR — {e}")
        return {"ok": False, "tool": tool_name, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        msg = f"tool {tool_name} unexpected error: {e}"
        _log.exception(msg)
        if session_id:
            append_transcript(session_id, role="tool", text=f"{tool_name}: ERROR — {e}")
        return {"ok": False, "tool": tool_name, "error": str(e)}

    if session_id:
        try:
            append_transcript(
                session_id,
                role="tool",
                text=f"{tool_name}({json.dumps(safe_args)[:200]}) -> {json.dumps(result)[:400]}",
            )
        except Exception:
            pass

    return {"ok": True, "tool": tool_name, "result": result}
