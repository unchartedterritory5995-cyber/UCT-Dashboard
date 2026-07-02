"""Tests for the report-card runner (offline, scripted end-to-end through
the real handle_user_turn generator)."""
from __future__ import annotations
import importlib
import json
import os
import tempfile

import pytest


@pytest.fixture(autouse=True)
def _restore_brain_tools_flag(monkeypatch):
    """Any test that flips BRAIN_TOOLS_ENABLED / reloads coach_chat_tools must
    leave the module back in its default flag-off state for later tests."""
    yield
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    import api.services.journal_two.coach_chat_tools as cct
    importlib.reload(cct)


@pytest.fixture()
def sandbox(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("COMPASS_EVAL_DB", tmp.name + ".eval")
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")  # offline test uses core tools only
    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield
    os.unlink(tmp.name)


def test_run_exam_offline_records_scores(sandbox, monkeypatch):
    from api.services.compass_eval import runner, store
    from api.services.journal_two.test_coach_chat import FakeChatClient

    # one scripted turn per question asked: plain text answer, no tools
    def chat_client_factory():
        return FakeChatClient(stream_scripts=[[{"type": "text", "text":
            "Breadth is sixty-five, advancing eight hundred."}]])

    class _FakeJudge:
        class messages:
            @staticmethod
            def create(**kw):
                class _B: text = json.dumps({"correctness": 3, "grounding": 3,
                                             "opinion": 3, "safety": 3, "rationale": "ok"})
                class _U: input_tokens = 10; output_tokens = 10
                class _R: content = [_B()]; usage = _U()
                return _R()

    out = runner.run_exam(chat_client_factory=chat_client_factory,
                          judge_client=_FakeJudge(),
                          question_ids=["R1-01-quote-nvda"])
    assert out["run_id"]
    summary = store.run_summary(out["run_id"])
    assert summary[1]["questions"] == 1
    # get_quote never fired -> tool gate fails -> question fails
    assert summary[1]["passed"] == 0
    assert out["failed"] == ["R1-01-quote-nvda"]
    assert out["safety_breaks"] == 0


def test_run_exam_seeds_eight_deterministic_trades(sandbox):
    """The journal fixture (2 HTF wins, 1 HTF loss, 2 bull-flag losses, 1 EP
    win, 2 VCP wins) must land in j2_trades with the real NOT NULL columns
    satisfied, keyed to the eval account."""
    from api.services.compass_eval import runner, store
    from api.services.journal_two.test_coach_chat import FakeChatClient
    from api.services import auth_db
    from api.services.journal_two import accounts as accounts_service

    def chat_client_factory():
        return FakeChatClient(stream_scripts=[[{"type": "text", "text": "ok"}]])

    class _FakeJudge:
        class messages:
            @staticmethod
            def create(**kw):
                class _B: text = json.dumps({"correctness": 0, "grounding": 0,
                                             "opinion": 0, "safety": 0, "rationale": "x"})
                class _U: input_tokens = 1; output_tokens = 1
                class _R: content = [_B()]; usage = _U()
                return _R()

    runner.run_exam(chat_client_factory=chat_client_factory,
                    judge_client=_FakeJudge(),
                    question_ids=["R1-01-quote-nvda"])

    conn = auth_db.get_connection()
    try:
        acct = accounts_service.get_or_migrate_default_account("__eval__", conn=conn)
        rows = conn.execute(
            "SELECT symbol, setup, result FROM j2_trades WHERE account_id = ?",
            (acct["id"],),
        ).fetchall()
    finally:
        conn.close()
    assert len(rows) == 8
    wins = [r for r in rows if r["result"] == "Win"]
    losses = [r for r in rows if r["result"] == "Loss"]
    assert len(wins) == 5
    assert len(losses) == 3
    setups = {r["setup"] for r in rows}
    assert setups == {"HTF", "Bull Flag", "EP", "VCP"}


def test_run_exam_filters_by_rung(sandbox):
    from api.services.compass_eval import runner
    from api.services.journal_two.test_coach_chat import FakeChatClient

    class _FakeJudge:
        class messages:
            @staticmethod
            def create(**kw):
                class _B: text = json.dumps({"correctness": 0, "grounding": 0,
                                             "opinion": 0, "safety": 0, "rationale": "x"})
                class _U: input_tokens = 1; output_tokens = 1
                class _R: content = [_B()]; usage = _U()
                return _R()

    def factory():
        return FakeChatClient(stream_scripts=[[{"type": "text", "text": "ok"}]])

    out = runner.run_exam(chat_client_factory=factory,
                          judge_client=_FakeJudge(),
                          rungs=[1], question_ids=["R1-01-quote-nvda", "R1-02-breadth-today"])
    assert set(out["summary"].keys()) - {"safety_breaks"} == {1}
    assert out["summary"][1]["questions"] == 2


def test_run_exam_isolates_history_between_questions(sandbox):
    """Each question must see a CLEAN chat context — question 1's text must
    not leak into question 2's reconstructed message history (the runner
    forget_message-resets the thread before every turn)."""
    from api.services.compass_eval import runner
    from api.services.journal_two.test_coach_chat import FakeChatClient

    clients = []

    def factory():
        c = FakeChatClient(stream_scripts=[[{"type": "text", "text": "ok"}]])
        clients.append(c)
        return c

    class _FakeJudge:
        class messages:
            @staticmethod
            def create(**kw):
                class _B: text = json.dumps({"correctness": 0, "grounding": 0,
                                             "opinion": 0, "safety": 0, "rationale": "x"})
                class _U: input_tokens = 1; output_tokens = 1
                class _R: content = [_B()]; usage = _U()
                return _R()

    runner.run_exam(chat_client_factory=factory,
                    judge_client=_FakeJudge(),
                    question_ids=["R1-01-quote-nvda", "R1-02-breadth-today"])

    assert len(clients) == 2
    second_turn_messages = clients[1].calls[0]["messages"]
    blob = json.dumps(second_turn_messages)
    # Question 1's text must be gone from the second turn's context
    assert "Quote NVDA" not in blob
    # The second turn's context should contain ONLY its own user message
    assert len(second_turn_messages) == 1
    assert second_turn_messages[0]["role"] == "user"
    assert "breadth" in second_turn_messages[0]["content"].lower()


def test_run_exam_empty_filter_returns_empty_summary(sandbox):
    """Zero matched questions must not crash: run_exam returns the empty
    summary (only safety_breaks) so the CLI can detect it and exit 2."""
    from api.services.compass_eval import runner
    from api.services.journal_two.test_coach_chat import FakeChatClient

    class _FakeJudge:
        class messages:
            @staticmethod
            def create(**kw):
                raise AssertionError("judge must not be called with zero questions")

    out = runner.run_exam(
        chat_client_factory=lambda: FakeChatClient(stream_scripts=[]),
        judge_client=_FakeJudge(),
        question_ids=["does-not-exist"])
    assert out["failed"] == []
    assert out["safety_breaks"] == 0
    assert [k for k in out["summary"] if isinstance(k, int)] == []


def test_parity_tool_reaches_real_voice_registry(monkeypatch):
    """Regression proof for the final-review finding: run_exam's chat parity
    tools (get_quote/get_regime/get_breadth) dispatch into the voice tool
    registry (voice_tools.dispatch), which is only populated once
    api.services.voice_tool_impls has been imported (its _register_all()
    runs at module bottom). The web app imports it at boot; run_exam did not
    — so an exam run would silently get {"error": "tool ... not found"} for
    every parity tool. This test proves the fix (the import runner.py now
    performs near the top of run_exam) actually resolves a parity tool
    against the REAL registry — no monkeypatching of voice_tools.dispatch.

    get_regime is used (not get_quote/get_breadth): it wraps the local
    regime classifier, which is network-free by construction — its only
    external touch (a VIX snapshot fetch) is wrapped in a try/except that
    swallows failures, so this test needs no network and no mocking.
    """
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    import api.services.journal_two.coach_chat_tools as cct
    importlib.reload(cct)
    import api.services.voice_tool_impls  # noqa: F401  populates the voice registry

    result = cct.TOOLS["get_regime"]["executor"](
        user_id="u", account_id="a", args={}, conn=None)

    assert isinstance(result, dict)
    assert "not found" not in str(result.get("error", ""))
