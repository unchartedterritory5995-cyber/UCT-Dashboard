"""Compass Chat orchestrator — persistence + history reconstruction.

The streaming Anthropic loop and tool dispatch land in Tasks 6 + 7.
This file ships only the storage primitives that those layers build on.
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.journal_two import db as j2_db

RATE_LIMIT_PER_DAY = 200


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def append_message(
    *,
    user_id: str,
    account_id: str,
    role: str,
    content: str | None = None,
    tool_calls: list | None = None,
    tool_results: list | None = None,
    parent_id: str | None = None,
    metadata: dict | None = None,
    conn=None,
) -> str:
    _conn, _close = _get_conn(conn)
    try:
        mid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        _conn.execute(
            """INSERT INTO j2_chat_messages
               (id, user_id, account_id, role, content, tool_calls, tool_results,
                parent_id, metadata, created_at, forgotten)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (mid, user_id, account_id, role, content,
             json.dumps(tool_calls) if tool_calls is not None else None,
             json.dumps(tool_results) if tool_results is not None else None,
             parent_id,
             json.dumps(metadata) if metadata is not None else None,
             now),
        )
        _conn.commit()
        return mid
    finally:
        if _close:
            _conn.close()


def list_messages(
    *,
    user_id: str,
    account_id: str,
    limit: int = 50,
    before_id: str | None = None,
    include_forgotten: bool = False,
    conn=None,
) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        sql = """SELECT id, role, content, tool_calls, tool_results, parent_id,
                        metadata, created_at, forgotten
                 FROM j2_chat_messages
                 WHERE user_id = ? AND account_id = ?"""
        params: list[Any] = [user_id, account_id]
        if not include_forgotten:
            sql += " AND forgotten = 0"
        if before_id:
            row = _conn.execute(
                "SELECT created_at FROM j2_chat_messages WHERE id = ?", (before_id,)
            ).fetchone()
            if row:
                sql += " AND created_at < ?"
                params.append(row["created_at"])
        sql += " ORDER BY created_at ASC LIMIT ?"
        params.append(limit)
        rows = _conn.execute(sql, params).fetchall()
        out = [_row_to_dict(r) for r in rows]
        total = _conn.execute(
            "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ? AND account_id = ? AND forgotten = 0",
            (user_id, account_id),
        ).fetchone()["n"]
        return {"messages": out, "has_more": len(out) < total}
    finally:
        if _close:
            _conn.close()


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "tool_calls": json.loads(row["tool_calls"]) if row["tool_calls"] else None,
        "tool_results": json.loads(row["tool_results"]) if row["tool_results"] else None,
        "parent_id": row["parent_id"],
        "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        "created_at": row["created_at"],
        "forgotten": bool(row["forgotten"]),
    }


def forget_message(
    *,
    user_id: str,
    account_id: str,
    message_id: str | None = None,
    all: bool = False,
    conn=None,
) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        if all:
            cur = _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 "
                "WHERE user_id = ? AND account_id = ? AND role != 'summary'",
                (user_id, account_id),
            )
        else:
            if not message_id:
                return {"updated": 0, "error": "message_id required when all=False"}
            cur = _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 WHERE id = ? AND user_id = ?",
                (message_id, user_id),
            )
        _conn.commit()
        return {"updated": cur.rowcount}
    finally:
        if _close:
            _conn.close()


def get_rate_limit_info(*, user_id: str, account_id: str, conn=None) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        today_iso = datetime.now(timezone.utc).date().isoformat()
        cur = _conn.execute(
            """SELECT COUNT(*) AS n FROM j2_chat_messages
               WHERE user_id = ? AND account_id = ?
               AND role = 'user'
               AND substr(created_at, 1, 10) = ?""",
            (user_id, account_id, today_iso),
        ).fetchone()
        used = cur["n"]
        return {"limit": RATE_LIMIT_PER_DAY, "used": used,
                "remaining": max(0, RATE_LIMIT_PER_DAY - used)}
    finally:
        if _close:
            _conn.close()


def get_chat_status(*, user_id: str, account_id: str, conn=None) -> dict:
    enabled = os.environ.get("COMPASS_CHAT_ENABLED", "true").lower() != "false"
    rate = get_rate_limit_info(user_id=user_id, account_id=account_id, conn=conn)
    _conn, _close = _get_conn(conn)
    try:
        count_row = _conn.execute(
            "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ? AND account_id = ? AND forgotten = 0",
            (user_id, account_id),
        ).fetchone()
        return {
            "enabled": enabled,
            "rate_limit_remaining": rate["remaining"],
            "conversation_message_count": count_row["n"],
        }
    finally:
        if _close:
            _conn.close()


# ── Anthropic streaming + turn handler ─────────────────────────────────────


class AnthropicChatClient:
    """Thin streaming wrapper. Returns an event iterator compatible with the
    orchestrator's expectations."""
    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str | None = None):
        import anthropic
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self._client = anthropic.Anthropic(api_key=key)

    def start_stream(self, *, system_prompt: str, messages: list, tools: list):
        return self._client.messages.stream(
            model=self.DEFAULT_MODEL,
            max_tokens=2000,
            temperature=0.4,
            system=[{"type": "text", "text": system_prompt,
                     "cache_control": {"type": "ephemeral"}}],
            messages=messages,
            tools=tools,
        )


def _build_anthropic_tools_param() -> list[dict]:
    from api.services.journal_two import coach_chat_tools as cct
    return [
        {
            "name": spec["name"],
            "description": spec["description"],
            "input_schema": spec["input_schema"],
        }
        for spec in cct.TOOLS.values()
    ]


def _reconstruct_messages(
    *, user_id: str, account_id: str, conn,
) -> list[dict]:
    """Pull non-forgotten messages and translate into Anthropic messages-API
    shape (alternating user/assistant; tool calls + results inlined)."""
    rows = list_messages(user_id=user_id, account_id=account_id, limit=200, conn=conn)["messages"]
    out: list[dict] = []
    pending_tool_results: list[dict] = []

    def _flush_tool_results():
        nonlocal pending_tool_results
        if pending_tool_results:
            out.append({"role": "user", "content": pending_tool_results})
            pending_tool_results = []

    for r in rows:
        if r["role"] == "user":
            _flush_tool_results()
            out.append({"role": "user", "content": r["content"] or ""})
        elif r["role"] == "assistant":
            _flush_tool_results()
            blocks: list = []
            if r["content"]:
                blocks.append({"type": "text", "text": r["content"]})
            for tc in (r["tool_calls"] or []):
                blocks.append({
                    "type": "tool_use", "id": tc["id"],
                    "name": tc["name"], "input": tc.get("args", {}),
                })
            out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": ""}]})
        elif r["role"] == "tool":
            for tr in (r["tool_results"] or []):
                pending_tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tr["tool_call_id"],
                    "content": json.dumps(tr["result"]),
                })
        elif r["role"] == "summary":
            out.append({"role": "user",
                        "content": f"[Earlier in this conversation, summarized: {r['content'] or ''}]"})
    _flush_tool_results()
    return out


def handle_user_turn(
    *,
    user_id: str,
    account_id: str,
    user_message: str,
    client=None,
    conn=None,
):
    """Generator yielding event dicts.

    Events: 'token', 'tool_call', 'tool_call_pending', 'complete', 'error'.
    """
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two import coach_prompts

    if os.environ.get("COMPASS_CHAT_ENABLED", "true").lower() == "false":
        yield {"type": "error", "code": "disabled", "message": "Compass chat is disabled."}
        return

    _conn, _close = _get_conn(conn)
    try:
        rl = get_rate_limit_info(user_id=user_id, account_id=account_id, conn=_conn)
        if rl["remaining"] <= 0:
            yield {"type": "error", "code": "rate_limited",
                   "message": "Daily chat limit reached.", "reset_at_utc": "midnight UTC"}
            return

        try:
            _maybe_summarize(user_id=user_id, account_id=account_id, conn=_conn)
        except Exception:
            pass

        append_message(user_id=user_id, account_id=account_id,
                       role="user", content=user_message, conn=_conn)

        active_client = client or AnthropicChatClient()
        tools_param = _build_anthropic_tools_param()
        MAX_LOOPS = 8

        for _iter in range(MAX_LOOPS):
            messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
            row = _conn.execute(
                "SELECT onboarding_mode FROM j2_accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id),
            ).fetchone()
            onboarding = bool(row and row["onboarding_mode"])
            system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT
            if onboarding:
                system_prompt += "\n\n" + coach_prompts.COMPASS_ONBOARDING_DIRECTIVE

            assistant_text = ""
            tool_uses: list[dict] = []
            with active_client.start_stream(
                system_prompt=system_prompt, messages=messages, tools=tools_param,
            ) as stream:
                for ev in stream:
                    etype = ev.get("type") if isinstance(ev, dict) else getattr(ev, "type", None)
                    if etype == "text":
                        text = ev.get("text") if isinstance(ev, dict) else getattr(ev, "text", "")
                        assistant_text += text
                        yield {"type": "token", "text": text}
                    elif etype == "tool_use":
                        tu = {
                            "id": ev.get("id") if isinstance(ev, dict) else getattr(ev, "id", None),
                            "name": ev.get("name") if isinstance(ev, dict) else getattr(ev, "name", None),
                            "args": (ev.get("input") if isinstance(ev, dict)
                                     else getattr(ev, "input", {})) or {},
                        }
                        tool_uses.append(tu)
                    elif etype == "message_stop":
                        pass

            tool_calls_json = [{"id": tu["id"], "name": tu["name"], "args": tu["args"],
                                "status": "pending"} for tu in tool_uses]
            asst_id = append_message(
                user_id=user_id, account_id=account_id,
                role="assistant", content=assistant_text or None,
                tool_calls=tool_calls_json if tool_calls_json else None,
                conn=_conn,
            )
            try:
                _audit_assistant_message(message_id=asst_id, conn=_conn)
            except Exception:
                pass

            if not tool_uses:
                yield {"type": "complete", "message_id": asst_id}
                return

            inline_results: list[dict] = []
            had_pending_action = False
            for tu in tool_uses:
                spec = cct.TOOLS.get(tu["name"])
                if spec is None:
                    inline_results.append({
                        "tool_call_id": tu["id"],
                        "result": {"error": f"unknown tool: {tu['name']}"},
                    })
                    continue
                if spec["requires_confirm"]:
                    had_pending_action = True
                    preview = spec["preview"](
                        user_id=user_id, account_id=account_id,
                        args=tu["args"], conn=_conn,
                    )
                    _mark_tool_call_status(_conn, asst_id, tu["id"], "pending_confirm")
                    yield {
                        "type": "tool_call_pending",
                        "tool_call_id": tu["id"], "name": tu["name"], "args": tu["args"],
                        "preview": preview, "message_id": asst_id,
                    }
                else:
                    try:
                        result = spec["executor"](
                            user_id=user_id, account_id=account_id,
                            args=tu["args"], conn=_conn,
                        )
                    except Exception as e:  # noqa: BLE001
                        result = {"error": str(e)}
                    yield {"type": "tool_call", "name": tu["name"],
                           "args": tu["args"],
                           "summary": _summarize_tool_result(tu["name"], result)}
                    inline_results.append({"tool_call_id": tu["id"], "result": result})
                    _mark_tool_call_status(_conn, asst_id, tu["id"], "confirmed")

            if inline_results:
                append_message(
                    user_id=user_id, account_id=account_id,
                    role="tool", tool_results=inline_results,
                    parent_id=asst_id, conn=_conn,
                )

            if had_pending_action:
                yield {"type": "complete", "message_id": asst_id,
                       "awaiting_confirm": True}
                return

            # Loop back with tool results in history.
            continue

        yield {"type": "error", "code": "loop_limit_exceeded",
               "message": "Compass tool-use loop exceeded max iterations."}
    finally:
        if _close:
            _conn.close()


def _mark_tool_call_status(conn, assistant_msg_id: str, tool_call_id: str, status: str) -> None:
    row = conn.execute(
        "SELECT tool_calls FROM j2_chat_messages WHERE id = ?", (assistant_msg_id,),
    ).fetchone()
    if row is None or not row["tool_calls"]:
        return
    try:
        calls = json.loads(row["tool_calls"])
    except (TypeError, json.JSONDecodeError):
        return
    for tc in calls:
        if tc.get("id") == tool_call_id:
            tc["status"] = status
    conn.execute(
        "UPDATE j2_chat_messages SET tool_calls = ? WHERE id = ?",
        (json.dumps(calls), assistant_msg_id),
    )
    conn.commit()


def _summarize_tool_result(tool_name: str, result: dict) -> str:
    if isinstance(result, dict) and "error" in result:
        return f"error: {result['error']}"
    if tool_name == "list_recent_trades":
        return f"{result.get('count', 0)} trades"
    if tool_name == "get_aggregates":
        agg = result.get("aggregates", {})
        return f"{agg.get('trade_count', 0)} trades, ${agg.get('net_pnl_dollar', 0):.0f} net"
    if tool_name == "get_open_positions":
        return f"{result.get('count', 0)} open"
    if tool_name == "find_arcs":
        return f"{len(result.get('arcs', []))} arc(s)"
    return "ok"


# ── Pending-action confirm / cancel ─────────────────────────────────────────


def _find_pending_tool_call(conn, *, message_id: str, tool_call_id: str) -> dict | None:
    row = conn.execute(
        "SELECT tool_calls FROM j2_chat_messages WHERE id = ?", (message_id,),
    ).fetchone()
    if row is None or not row["tool_calls"]:
        return None
    try:
        calls = json.loads(row["tool_calls"])
    except (TypeError, json.JSONDecodeError):
        return None
    for tc in calls:
        if tc.get("id") == tool_call_id:
            return tc
    return None


def confirm_pending_action(
    *,
    user_id: str,
    account_id: str,
    message_id: str,
    tool_call_id: str,
    client=None,
    conn=None,
):
    """Execute a pending action, persist its result, then re-invoke the
    model for an acknowledgement. Generator yields events."""
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two import coach_prompts

    _conn, _close = _get_conn(conn)
    try:
        tc = _find_pending_tool_call(_conn, message_id=message_id, tool_call_id=tool_call_id)
        if tc is None or tc.get("status") != "pending_confirm":
            yield {"type": "error", "code": "no_pending_action",
                   "message": "Tool call not found or no longer pending."}
            return
        spec = cct.TOOLS.get(tc["name"])
        if spec is None or not spec["requires_confirm"]:
            yield {"type": "error", "code": "invalid_tool",
                   "message": f"Tool {tc['name']} is not a confirmable action."}
            return

        try:
            result = spec["executor"](
                user_id=user_id, account_id=account_id,
                args=tc.get("args") or {}, conn=_conn,
            )
        except Exception as e:  # noqa: BLE001
            result = {"ok": False, "error": str(e)}

        _mark_tool_call_status(_conn, message_id, tool_call_id, "confirmed")
        append_message(
            user_id=user_id, account_id=account_id,
            role="tool",
            tool_results=[{"tool_call_id": tool_call_id, "result": result}],
            parent_id=message_id, conn=_conn,
        )
        yield {"type": "tool_call", "name": tc["name"], "args": tc.get("args") or {},
               "summary": _summarize_tool_result(tc["name"], result)}

        # Re-invoke model for acknowledgement
        row = _conn.execute(
            "SELECT onboarding_mode FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        onboarding = bool(row and row["onboarding_mode"])
        system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT
        if onboarding:
            system_prompt += "\n\n" + coach_prompts.COMPASS_ONBOARDING_DIRECTIVE
        active_client = client or AnthropicChatClient()
        tools_param = _build_anthropic_tools_param()
        messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
        ack_text = ""
        with active_client.start_stream(
            system_prompt=system_prompt,
            messages=messages, tools=tools_param,
        ) as stream:
            for ev in stream:
                etype = ev.get("type") if isinstance(ev, dict) else getattr(ev, "type", None)
                if etype == "text":
                    text = ev.get("text") if isinstance(ev, dict) else getattr(ev, "text", "")
                    ack_text += text
                    yield {"type": "token", "text": text}
        ack_id = append_message(
            user_id=user_id, account_id=account_id,
            role="assistant", content=ack_text or None, conn=_conn,
        )
        try:
            _audit_assistant_message(message_id=ack_id, conn=_conn)
        except Exception:
            pass
        yield {"type": "complete", "message_id": ack_id}
    finally:
        if _close:
            _conn.close()


# ── Summarization + hallucination audit ────────────────────────────────────

SUMMARIZE_THRESHOLD_TOKENS = 80_000


def _estimate_tokens(messages: list[dict]) -> int:
    """Quick token estimate: len(JSON) / 3.5. Good enough for sliding-window
    detection without a tokenizer dependency."""
    payload = json.dumps(messages, default=str)
    return max(1, int(len(payload) / 3.5))


def _maybe_summarize(*, user_id: str, account_id: str, summary_client=None, conn=None) -> bool:
    """If history exceeds the threshold, summarize the oldest 30% of
    non-summary messages into a single 'summary' row and mark them
    forgotten. Returns True if summarization happened."""
    _conn, _close = _get_conn(conn)
    try:
        messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
        if _estimate_tokens(messages) < SUMMARIZE_THRESHOLD_TOKENS:
            return False
        rows = list_messages(user_id=user_id, account_id=account_id, limit=200, conn=_conn)["messages"]
        non_summary = [r for r in rows if r["role"] != "summary"]
        cut = max(1, int(len(non_summary) * 0.3))
        to_summarize = non_summary[:cut]
        if not to_summarize:
            return False
        text_blob = "\n".join(
            f"[{r['role']}] {r.get('content') or ''}"
            for r in to_summarize
        )
        summary_text = (summary_client or _DefaultSummaryClient()).summarize(text=text_blob)
        append_message(
            user_id=user_id, account_id=account_id,
            role="summary", content=summary_text, conn=_conn,
        )
        ids = [r["id"] for r in to_summarize]
        if ids:
            _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 WHERE id IN (" +
                ",".join("?" * len(ids)) + ")",
                ids,
            )
            _conn.commit()
        return True
    finally:
        if _close:
            _conn.close()


class _DefaultSummaryClient:
    def summarize(self, *, text: str) -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            temperature=0.2,
            system="You compress trading-coach conversations. Preserve any user-stated focus, behavioral commitments, or Compass observations of trader patterns. Drop tool-call mechanics. ≤500 tokens.",
            messages=[{"role": "user", "content": text}],
        )
        return msg.content[0].text if msg.content else ""


def _audit_assistant_message(*, message_id: str, conn=None) -> dict:
    """Hallucination audit. Re-uses coach_validation's numeric/symbol grounding
    against the data Compass actually had access to in the surrounding turn.
    Non-blocking — writes flags to metadata."""
    from api.services.journal_two import coach_validation as cv
    _conn, _close = _get_conn(conn)
    try:
        row = _conn.execute(
            "SELECT id, user_id, account_id, content, tool_calls, parent_id, created_at "
            "FROM j2_chat_messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        if row is None or row["content"] is None:
            return {"passed": True, "flags": []}
        data = {"today": {"trades": [], "open_positions": []}, "recent_arcs": []}
        tool_rows = _conn.execute(
            """SELECT tool_results FROM j2_chat_messages
               WHERE user_id = ? AND account_id = ? AND role = 'tool'
                 AND created_at <= ? AND forgotten = 0
               ORDER BY created_at DESC LIMIT 5""",
            (row["user_id"], row["account_id"], row["created_at"]),
        ).fetchall()
        for tr in tool_rows:
            try:
                results = json.loads(tr["tool_results"] or "[]")
            except (TypeError, json.JSONDecodeError):
                continue
            for r in results:
                result_obj = r.get("result") or {}
                trades = (result_obj.get("trades") or [])
                positions = (result_obj.get("positions") or [])
                data["today"]["trades"].extend(trades)
                data["today"]["open_positions"].extend(positions)
                if "arcs" in result_obj:
                    data["recent_arcs"].extend(result_obj["arcs"])
        result = cv.validate_eod_output(row["content"], data)
        try:
            existing_meta = json.loads(_conn.execute(
                "SELECT metadata FROM j2_chat_messages WHERE id = ?", (message_id,),
            ).fetchone()["metadata"] or "{}")
        except (TypeError, json.JSONDecodeError):
            existing_meta = {}
        existing_meta["audit_flags"] = result["flags"]
        existing_meta["audit_passed"] = result["passed"]
        _conn.execute(
            "UPDATE j2_chat_messages SET metadata = ? WHERE id = ?",
            (json.dumps(existing_meta), message_id),
        )
        _conn.commit()
        return result
    finally:
        if _close:
            _conn.close()


def cancel_pending_action(
    *,
    user_id: str,
    account_id: str,
    message_id: str,
    tool_call_id: str,
    client=None,
    conn=None,
):
    """User clicked Cancel. Mark cancelled; model acknowledges briefly."""
    from api.services.journal_two import coach_prompts

    _conn, _close = _get_conn(conn)
    try:
        tc = _find_pending_tool_call(_conn, message_id=message_id, tool_call_id=tool_call_id)
        if tc is None or tc.get("status") != "pending_confirm":
            yield {"type": "error", "code": "no_pending_action",
                   "message": "Tool call not found or no longer pending."}
            return

        _mark_tool_call_status(_conn, message_id, tool_call_id, "cancelled")
        append_message(
            user_id=user_id, account_id=account_id,
            role="tool",
            tool_results=[{"tool_call_id": tool_call_id,
                           "result": {"ok": False, "cancelled": True,
                                      "reason": "user_cancelled"}}],
            parent_id=message_id, conn=_conn,
        )

        row = _conn.execute(
            "SELECT onboarding_mode FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        onboarding = bool(row and row["onboarding_mode"])
        system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT
        if onboarding:
            system_prompt += "\n\n" + coach_prompts.COMPASS_ONBOARDING_DIRECTIVE
        active_client = client or AnthropicChatClient()
        tools_param = _build_anthropic_tools_param()
        messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
        ack_text = ""
        with active_client.start_stream(
            system_prompt=system_prompt,
            messages=messages, tools=tools_param,
        ) as stream:
            for ev in stream:
                etype = ev.get("type") if isinstance(ev, dict) else getattr(ev, "type", None)
                if etype == "text":
                    text = ev.get("text") if isinstance(ev, dict) else getattr(ev, "text", "")
                    ack_text += text
                    yield {"type": "token", "text": text}
        ack_id = append_message(
            user_id=user_id, account_id=account_id,
            role="assistant", content=ack_text or None, conn=_conn,
        )
        try:
            _audit_assistant_message(message_id=ack_id, conn=_conn)
        except Exception:
            pass
        yield {"type": "complete", "message_id": ack_id}
    finally:
        if _close:
            _conn.close()
