"""The chat hallucination audit's GROUND-TRUTH CORPUS.

D-1 (2026-08-09 Compass audit): the corpus was built from tool results carrying
one of three hand-listed keys (`trades` / `positions` / `arcs`), i.e. 3 of the
52 registered tools. Every number from the other 49 — `get_quote`,
`portfolio_heat`, `grade_ticker`, `setup_winrate`, … — had no corpus to match
against, so a correct, fully tool-sourced answer was flagged, and
`ChatMessage.jsx` renders that flag to the MEMBER as a red "Some claims
unverified".

These tests pin both directions:
  * a correct answer sourced from a tool OUTSIDE the old hand-list must NOT be
    flagged (the false positive the member actually saw), and
  * a number NO fired tool returned MUST be flagged (without this, the fix is
    just a quieter badge).

The corpus must be DERIVED from the tools that actually fired this turn — never
a hand-list of three, and never a hand-list of fifty-two either.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_audit"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _turn(db_conn, account_id, *, user_text, tool_results, answer, user_id="u_audit"):
    """Lay down one realistic turn: user row -> tool row(s) -> assistant row.

    Mirrors `handle_user_turn`'s write order (the assistant row is appended
    after the tools of the preceding loop iterations have been persisted).
    Returns the assistant message id.
    """
    from api.services.journal_two import coach_chat
    coach_chat.append_message(user_id=user_id, account_id=account_id,
                              role="user", content=user_text, conn=db_conn)
    if tool_results:
        coach_chat.append_message(user_id=user_id, account_id=account_id,
                                  role="tool", tool_results=tool_results, conn=db_conn)
    return coach_chat.append_message(user_id=user_id, account_id=account_id,
                                     role="assistant", content=answer, conn=db_conn)


# Tools whose result payloads carry NONE of trades/positions/arcs — i.e. the 49
# the old corpus was blind to.
_QUOTE_AND_HEAT_RESULTS = [
    {"tool_call_id": "tc1", "result": {
        "ok": True, "symbol": "NVDA", "price": 187.40, "change_pct": 2.31,
        "prev_close": 183.18}},
    {"tool_call_id": "tc2", "result": {
        "ok": True, "risk_heat_pct": 4.2, "agg_cap_pct": 10.0,
        "room_to_add_pct": 5.8, "placeholder_stops": []}},
]


def test_a_correct_answer_from_a_tool_outside_the_old_hand_list_is_not_flagged(db_conn):
    """RED before the fix: every number here came back from a fired tool, and
    every one of them was flagged because get_quote/portfolio_heat emit no
    `trades`/`positions`/`arcs` key."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="Quote NVDA and tell me where my heat sits.",
        tool_results=_QUOTE_AND_HEAT_RESULTS,
        answer=("NVDA is $187.40, up 2.31% from the $183.18 close. "
                "Your risk heat is 4.2% against the 10.0% aggregate cap."),
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["flags"] == [], result["flags"]
    assert result["passed"] is True


def test_the_member_visible_badge_is_not_set_on_a_correct_answer(db_conn):
    """ChatMessage.jsx reads `metadata.audit_passed === false`. Pin the value
    the renderer actually consumes, not just the return value."""
    import json
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="Quote NVDA.",
        tool_results=_QUOTE_AND_HEAT_RESULTS,
        answer="NVDA is $187.40, up 2.31%.",
    )
    coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    meta = json.loads(db_conn.execute(
        "SELECT metadata FROM j2_chat_messages WHERE id = ?", (asst_id,),
    ).fetchone()["metadata"])
    assert meta["audit_passed"] is True, meta["audit_flags"]


def test_a_number_no_fired_tool_returned_is_still_flagged(db_conn):
    """The converse. A quieter badge is the easy wrong fix — a price the tools
    never returned has to fire."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="Quote NVDA.",
        tool_results=_QUOTE_AND_HEAT_RESULTS,
        answer="NVDA is $212.75, up 2.31%.",
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["passed"] is False
    assert any("212.75" in f for f in result["flags"]), result["flags"]


def test_a_fabricated_ticker_is_still_flagged(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="Quote NVDA.",
        tool_results=_QUOTE_AND_HEAT_RESULTS,
        answer="NVDA is $187.40. PLTR looks like the better setup here.",
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["passed"] is False
    assert any("PLTR" in f for f in result["flags"]), result["flags"]


def test_a_near_miss_price_is_flagged_not_swallowed_by_tolerance(db_conn):
    """The old matcher accepted anything within +-0.0501, so a fabricated
    two-decimal price two cents off a real one landed inside the window. The
    tolerance is now the precision the CLAIM itself asserts."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="Quote NVDA.",
        tool_results=_QUOTE_AND_HEAT_RESULTS,
        answer="NVDA is $187.42.",
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["passed"] is False
    assert any("187.42" in f for f in result["flags"]), result["flags"]


def test_a_legitimately_rounded_price_is_not_flagged(db_conn):
    """...but rounding the SAME number to fewer places is honest reporting."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="Quote NVDA.",
        tool_results=_QUOTE_AND_HEAT_RESULTS,
        answer="NVDA is right around $187.",
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["flags"] == [], result["flags"]


def test_the_corpus_spans_the_whole_turn_not_the_last_five_tool_rows(db_conn):
    """`handle_user_turn` runs up to MAX_LOOPS=8 iterations, one tool row each.
    A LIMIT 5 window silently drops the earliest tools of a long agentic turn
    and flags every number that came from them."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    coach_chat.append_message(user_id="u_audit", account_id=acc["id"],
                              role="user", content="Do the homework on NVDA.",
                              conn=db_conn)
    # 8 separate tool rows, one per loop iteration. The number under test comes
    # from the FIRST one.
    for i in range(8):
        coach_chat.append_message(
            user_id="u_audit", account_id=acc["id"], role="tool",
            tool_results=[{"tool_call_id": f"tc{i}",
                           "result": {"ok": True, "step": i, "value": 1000.0 + i}}],
            conn=db_conn,
        )
    asst_id = coach_chat.append_message(
        user_id="u_audit", account_id=acc["id"], role="assistant",
        content="The first read came back at $1000.00.", conn=db_conn,
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["flags"] == [], result["flags"]


def test_a_number_the_user_supplied_is_grounded(db_conn):
    """Repeating a figure the trader stated is not a fabrication. Rung-3+
    questions routinely hand Compass the account size."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="I have $50,000 in the account. Size me on NVDA.",
        tool_results=_QUOTE_AND_HEAT_RESULTS,
        answer="On $50,000 with NVDA at $187.40, keep it inside the 10.0% cap.",
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["flags"] == [], result["flags"]


def test_an_answer_with_no_fired_tools_still_audits_live_numbers(db_conn):
    """No tools fired => nothing is grounded. The audit must not go vacuous
    just because the corpus is empty."""
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = _turn(
        db_conn, acc["id"],
        user_text="What's NVDA doing?",
        tool_results=[],
        answer="NVDA is $187.40 right now.",
    )
    result = coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    assert result["passed"] is False
    assert any("187.40" in f for f in result["flags"]), result["flags"]
