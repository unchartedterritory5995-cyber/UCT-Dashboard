"""
Voice tool-failure recovery hints.

When a tool result is ok=False, we synthesize a small structured hint
that suggests a next step. The model sees it alongside the error and
can decide to retry, try a different tool, or ask a clarifying
question — instead of going silent or giving a vague "couldn't do it".
"""

import logging

_log = logging.getLogger(__name__)

# Per-tool recovery hints. Each hint suggests (next_action, prompt).
# Keep these short — they're shown to the model as a single string.
_HINTS_BY_TOOL: dict[str, tuple[str, str]] = {
    # Watchlist writes
    "flag_ticker": (
        "ask_clarification",
        "Ask: 'which ticker should I flag?'",
    ),
    "unflag_ticker": (
        "ask_clarification",
        "Confirm which ticker they want unflagged.",
    ),
    "tag_ticker": (
        "ask_clarification",
        "Ask: 'which color? Green, blue, orange, red, purple, gold, or teal?'",
    ),
    "add_to_watchlist": (
        "try_alternate_tool",
        "Call list_my_watchlists first to read their list names, then retry.",
    ),
    "remove_from_watchlist": (
        "try_alternate_tool",
        "Call list_my_watchlists first, then retry with an exact list name.",
    ),
    "set_price_alert": (
        "ask_clarification",
        "Ask whether the alert should fire above or below the target price.",
    ),
    "cancel_alert": (
        "try_alternate_tool",
        "Call list_my_alerts first to see active alerts, then retry.",
    ),

    # Market reads
    "get_quote": (
        "ask_clarification",
        "Ask for the ticker symbol.",
    ),
    "get_theme_holdings": (
        "try_alternate_tool",
        "Call get_theme_status first to read theme names, then retry.",
    ),
    "get_theme_history": (
        "try_alternate_tool",
        "Call get_theme_status first to read theme names, then retry.",
    ),
    "get_cot_data": (
        "ask_clarification",
        "Ask which futures symbol — CL, GC, ES, NQ, etc.",
    ),
    "get_insider_activity": (
        "ask_clarification",
        "Ask for the ticker symbol.",
    ),
    "get_earnings_intel": (
        "ask_clarification",
        "Ask for the ticker symbol.",
    ),
    "get_breadth_metric": (
        "try_alternate_tool",
        "Ask which breadth metric — pct_above_50sma, new_highs, breadth_score, etc.",
    ),

    # Navigation
    "open_page": (
        "ask_clarification",
        "Ask the user which page; valid options are listed in the result's "
        "`available` field.",
    ),
    "read_aloud": (
        "ask_clarification",
        "Ask what to read: morning wire, transcript, UCT 20 picks, daily note, "
        "weekly review, or morning/closing briefing.",
    ),

    # Journal
    "get_my_daily_note": (
        "retry",
        "Tell the user no note is saved and offer to create one via add_daily_note.",
    ),
    "switch_account": (
        "try_alternate_tool",
        "Call list_my_accounts first to read their account names, then retry.",
    ),
    "get_my_account_balance": (
        "try_alternate_tool",
        "Call list_my_accounts first if account name didn't match.",
    ),
    "get_my_option_strategies": (
        "ask_clarification",
        "If they asked for a specific status, confirm whether they want open "
        "or closed strategies.",
    ),

    # Writes
    "create_position": (
        "ask_clarification",
        "Re-ask the missing field — shares, entry, stop, or account.",
    ),
    "close_position": (
        "try_alternate_tool",
        "Call find_my_trades to see open positions, then retry.",
    ),
    "update_position": (
        "try_alternate_tool",
        "Call find_my_trades to confirm the position exists, then retry.",
    ),

    # Feedback
    "correct_me": (
        "ask_clarification",
        "Ask: 'what should I have said?'",
    ),
}


# Generic hints used when no per-tool entry matches.
_GENERIC_HINTS: dict[str, tuple[str, str]] = {
    "missing_symbol": (
        "ask_clarification",
        "Ask the user which ticker symbol they mean.",
    ),
    "tool_not_found": (
        "try_alternate_tool",
        "That tool doesn't exist. Pick the closest matching one from your catalog.",
    ),
    "default": (
        "retry",
        "Briefly acknowledge the issue and ask one clarifying question.",
    ),
}


def annotate_failure(
    tool_name: str,
    result: dict,
    dispatch_error: str | None = None,
) -> dict:
    """
    Add a `recovery_hint` field to a failing tool result.

    `result` is what the inner tool returned. We never overwrite — we only
    add the hint if not already present, and we leave the original error /
    narration in place so the model still has the original failure context.
    """
    if not isinstance(result, dict):
        return result
    if result.get("ok", True):
        # Successful — don't annotate.
        return result
    if "recovery_hint" in result:
        # Tool already provided its own hint — keep it.
        return result

    next_action, prompt = _HINTS_BY_TOOL.get(
        tool_name, _GENERIC_HINTS["default"],
    )

    # Override on specific error patterns
    error_text = (
        (result.get("error") or "") + " " + (result.get("narration") or "")
    ).lower()
    if "i need a ticker" in error_text or "which ticker" in error_text:
        next_action, prompt = _GENERIC_HINTS["missing_symbol"]
    elif dispatch_error and "not found" in dispatch_error.lower():
        next_action, prompt = _GENERIC_HINTS["tool_not_found"]

    annotated = dict(result)
    annotated["recovery_hint"] = {
        "next_action": next_action,
        "prompt": prompt,
    }
    return annotated
