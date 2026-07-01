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
import time

from api.services.voice_tools import dispatch
from api.services.voice_session_service import append_transcript

_log = logging.getLogger(__name__)


def _audit(user_id: str, tool_name: str, args: dict, ok: bool,
           error: str | None, latency_ms: int, session_id: int | None,
           result: object | None = None) -> None:
    """Fire-and-forget tool-call audit. Never raises."""
    try:
        from api.services.voice_feedback_service import record_tool_call
        record_tool_call(
            user_id, tool_name=tool_name, args=args, result=result,
            ok=ok, error=error, latency_ms=latency_ms, session_id=session_id,
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("[voice_dispatch] audit failed: %s", e)


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
    _t0 = time.monotonic()

    try:
        result = dispatch(
            tool_name, safe_args,
            user={"id": user_id, "session_id": session_id},
        )
    except KeyError as e:
        msg = f"tool {tool_name!r} not found"
        _log.warning(msg)
        _audit(user_id, tool_name, safe_args, False, msg,
               int((time.monotonic() - _t0) * 1000), session_id)
        return _failure_envelope(tool_name, msg, dispatch_error=msg)
    except (ValueError, TypeError) as e:
        msg = f"tool {tool_name} failed: {e}"
        _log.warning(msg)
        if session_id:
            append_transcript(session_id, role="tool", text=f"{tool_name}: ERROR — {e}")
        _audit(user_id, tool_name, safe_args, False, str(e),
               int((time.monotonic() - _t0) * 1000), session_id)
        return _failure_envelope(tool_name, str(e))
    except Exception as e:  # noqa: BLE001
        msg = f"tool {tool_name} unexpected error: {e}"
        _log.exception(msg)
        if session_id:
            append_transcript(session_id, role="tool", text=f"{tool_name}: ERROR — {e}")
        _audit(user_id, tool_name, safe_args, False, str(e),
               int((time.monotonic() - _t0) * 1000), session_id)
        return _failure_envelope(tool_name, str(e))

    latency_ms = int((time.monotonic() - _t0) * 1000)

    if session_id:
        try:
            append_transcript(
                session_id,
                role="tool",
                text=f"{tool_name}({json.dumps(safe_args)[:200]}) -> {json.dumps(result)[:400]}",
            )
        except Exception:
            pass

    # Tools may return {"ok": False, "narration": ...} on graceful failures
    # (e.g. "no such ticker"). Surface that into the audit + envelope so the
    # model and the dashboard can both see the failure rate accurately.
    # A dict carrying an `error` key but no explicit `ok` is a FAILURE — several
    # read tools signal failure that way. This previously defaulted to True, so
    # those failures were logged as successes and never got a recovery hint,
    # leaving the model to go vague or silent instead of trying another source.
    inner_ok = bool(result.get("ok", "error" not in result)) if isinstance(result, dict) else True
    inner_err = result.get("error") if isinstance(result, dict) else None

    _audit(user_id, tool_name, safe_args, inner_ok, inner_err,
           latency_ms, session_id, result=result)

    # Annotate graceful failures with a recovery hint so the model knows
    # what to try next instead of going silent.
    if isinstance(result, dict) and not inner_ok:
        from api.services.voice_recovery import annotate_failure
        result = annotate_failure(tool_name, result)

    return {"ok": True, "tool": tool_name, "result": result}


def _failure_envelope(tool_name: str, error: str,
                      dispatch_error: str | None = None) -> dict:
    """Build the outer envelope for hard dispatch failures (exceptions)."""
    from api.services.voice_recovery import annotate_failure
    inner = annotate_failure(
        tool_name, {"ok": False, "error": error}, dispatch_error=dispatch_error,
    )
    return {"ok": False, "tool": tool_name, "error": error,
            "recovery_hint": inner.get("recovery_hint")}
