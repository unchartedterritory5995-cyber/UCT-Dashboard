"""STRUCTURAL RAIL: a Compass chat TURN is bounded, not merely each call in it.

`LLM-NO-TIMEOUT` (2026-08-09 performance audit) left `coach_chat.py` quarantined
by name — the fix was in flight. These are the tests that let the quarantine be
deleted, and they cover the part a per-call `timeout=` does NOT:

⛔ COMPASS CHAT IS AGENTIC. One member message drives up to `MAX_LOOPS` streaming
Anthropic calls in sequence, plus an inline `_maybe_summarize` pass in front of
them. So bounding each call at N seconds bounds the member's turn at (MAX_LOOPS +
1) x N — with N = 120 that is 1,080 s on one of the pod's 64 shared anyio
workers, which is WORSE than the single unbounded 600 s call the audit found.
A per-call value is not an answer to this surface; a turn budget is.

⭐ THE DEFENDED NUMBER is `coach_chat.turn_hard_ceiling_secs()` — the turn budget
plus one final read, because the SDK's read timeout is fixed when a stream OPENS
and cannot be shortened mid-flight. Every test below that quotes a bound DERIVES
it from that function rather than retyping a literal; a hand-typed number beside
the constant it describes is this repo's most-repeated defect.

💵 SPEND: $0. Every LLM call here is a fake — the real `anthropic` module is
never reached (the client-construction tests swap `sys.modules["anthropic"]` for
a recorder via `monkeypatch.setitem`, which is undone per test).
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import sys
import tempfile
import time
import types

import pytest

from api.services import llm_timeouts
from api.services.journal_two import coach_chat
from tools import llm_timeout_census as cen


# ── fixtures ────────────────────────────────────────────────────────────────

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


def _account(db_conn, user_id="u_timeout"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


class _RecordingAnthropicModule(types.ModuleType):
    """Stands in for `import anthropic` and records every construction."""

    def __init__(self):
        super().__init__("anthropic")
        self.constructions: list[dict] = []
        self.with_options_calls: list[dict] = []
        outer = self

        class _Messages:
            @staticmethod
            def stream(**kw):
                raise AssertionError("no real call should be made in these tests")

            @staticmethod
            def create(**kw):
                raise AssertionError("no real call should be made in these tests")

        class Anthropic:  # noqa: N801 - mirrors the SDK's name
            def __init__(self, **kw):
                outer.constructions.append(kw)
                self.messages = _Messages()

            def with_options(self, **kw):
                outer.with_options_calls.append(kw)
                return self

        self.Anthropic = Anthropic


@pytest.fixture
def fake_anthropic(monkeypatch):
    mod = _RecordingAnthropicModule()
    monkeypatch.setitem(sys.modules, "anthropic", mod)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-not-real")
    return mod


class _TimedStream:
    """A stream that emits `events`, sleeping `gap` seconds before each one.

    This is how a hung call is reproduced without hanging the suite: a stream
    that dribbles forever is the shape a per-READ SDK timeout can never cut.
    """

    #: Safety cap on the "endless" mode. A rail whose subject has been DELETED
    #: must go RED, not hang — a mutation harness cannot read an exit code that
    #: never arrives. Sized so a correct implementation always cuts long before
    #: it (a 1 s budget at a 0.02 s gap cuts near event ~50).
    MAX_EVENTS = 600

    def __init__(self, events, gap=0.0, endless=False):
        self.events = list(events)
        self.gap = gap
        self.endless = endless

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        emitted = 0
        while True:
            for ev in self.events:
                if self.gap:
                    time.sleep(self.gap)
                emitted += 1
                yield ev
                if self.endless and emitted >= self.MAX_EVENTS:
                    return
            if not self.endless:
                return

    def get_final_message(self):
        return None


class _ScriptedClient:
    """Records the `timeout=` handed to every call, and WHEN each was opened."""

    def __init__(self, *, scripts=None, gap=0.0, endless=False):
        self.scripts = list(scripts or [])
        self.gap = gap
        self.endless = endless
        self.timeouts: list[float] = []
        self.opened_at: list[float] = []
        self.calls = 0

    def start_stream(self, *, system_prompt, messages, tools, user_id="u",
                     timeout=None, **_kw):
        self.calls += 1
        self.timeouts.append(timeout)
        self.opened_at.append(time.monotonic())
        events = self.scripts.pop(0) if self.scripts else []
        return _TimedStream(events, gap=self.gap, endless=self.endless)


def _tool_round(n):
    """One scripted round that calls a real read-only tool, so the loop keeps
    going instead of completing."""
    return [{"type": "text", "text": f"round {n} "},
            {"type": "tool_use", "id": f"tu{n}", "name": "get_open_positions",
             "input": {}}]


def _run(db_conn, acct, client, message="hello"):
    return list(coach_chat.handle_user_turn(
        user_id="u_timeout", account_id=acct["id"],
        user_message=message, client=client, conn=db_conn))


# ── 1. the two client constructions are bounded ─────────────────────────────

def test_the_chat_client_passes_an_explicit_timeout(fake_anthropic):
    coach_chat.AnthropicChatClient()
    assert len(fake_anthropic.constructions) == 1
    kw = fake_anthropic.constructions[0]
    assert kw["timeout"] == coach_chat.chat_call_timeout_secs()
    assert kw["timeout"] < 600.0, "the SDK default is 600 s; this is not bounded"


def test_the_summary_client_passes_an_explicit_timeout(fake_anthropic):
    """`_maybe_summarize` builds a SECOND client, on the request path, before
    the member sees a token. It was the quieter of the two quarantined sites."""
    client = coach_chat._DefaultSummaryClient()
    with pytest.raises(AssertionError):       # our fake refuses to do real work
        client.summarize(text="x", user_id="u")
    kw = fake_anthropic.constructions[0]
    assert kw["timeout"] == coach_chat.summary_call_timeout_secs()
    assert kw["timeout"] < 600.0


def test_a_per_call_narrowing_uses_with_options_not_a_new_client(fake_anthropic):
    """`with_options` on an already-bounded client is the idiom `llm_timeouts`
    prescribes and the census explicitly does not count as a construction —
    which is how each turn-step can be handed what is LEFT of the budget without
    ever building an unbounded client."""
    c = coach_chat.AnthropicChatClient()
    with pytest.raises(AssertionError):
        c.start_stream(system_prompt="s", messages=[], tools=[], timeout=7.5)
    assert fake_anthropic.with_options_calls == [{"timeout": 7.5}]
    assert len(fake_anthropic.constructions) == 1, "a second client was built"


def test_neither_site_is_reported_by_the_census():
    """The rail that would have caught these, pointed at this file by name."""
    here = [c for c in cen.census(cen.repo_root())
            if c.path == "api/services/journal_two/coach_chat.py"]
    assert here == [], here


def test_the_quarantine_no_longer_lists_this_file():
    """A stale exemption is a hole nobody can see. Removing the `timeout=` is
    caught by the census; forgetting to un-quarantine is caught here."""
    from tests.test_llm_timeout_census import QUARANTINE
    assert "api/services/journal_two/coach_chat.py" not in QUARANTINE


# ── 2. the stated bound, and the arithmetic behind it ───────────────────────

def test_the_turn_ceiling_is_stated_and_is_far_under_per_call_x_max_loops():
    """⭐ THE NUMBER. Derived, never typed: if someone raises MAX_LOOPS or the
    per-call budget, this recomputes rather than going quietly stale."""
    per_call = coach_chat.chat_call_timeout_secs()
    naive = (coach_chat.MAX_LOOPS + 1) * per_call          # per-call bounding only
    ceiling = coach_chat.turn_hard_ceiling_secs()
    assert ceiling == coach_chat.turn_budget_secs() + max(
        per_call, coach_chat.summary_call_timeout_secs())
    assert ceiling < naive, (
        f"the turn ceiling ({ceiling}s) is not tighter than bounding each call "
        f"in isolation ({naive}s) — then the turn is not bounded, it is only "
        "multiplied")
    assert ceiling <= 600.0, (
        f"a member turn can run {ceiling}s — longer than the ONE unbounded SDK "
        "call this fix replaced, which would make the fix a regression")


def test_the_default_budget_is_the_one_that_ships():
    assert coach_chat.turn_budget_secs() == coach_chat.TURN_BUDGET_DEFAULT_SECS
    assert coach_chat.chat_call_timeout_secs() == llm_timeouts.REQUEST_PATH_LONG
    assert coach_chat.summary_call_timeout_secs() == llm_timeouts.REQUEST_PATH


def test_a_broken_budget_override_falls_back_instead_of_unbounding(monkeypatch):
    """The failure direction matters: `0` would be an INFINITE turn, and it is
    one stray Railway variable away."""
    for bad in ("", "  ", "none", "0", "-30"):
        monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", bad)
        assert coach_chat.turn_budget_secs() == coach_chat.TURN_BUDGET_DEFAULT_SECS


def test_the_offline_report_card_lane_can_buy_room_without_unbounding(monkeypatch):
    """⚠️ Legitimate long work must not break. The exam is an operator script in
    its own process, so it raises the budget by env — the same escape hatch
    DESK_CHAPTERS_LLM_TIMEOUT_SECS gives the scheduler lane."""
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS",
                       str(int(llm_timeouts.OFFLINE_JOB)))
    assert coach_chat.turn_budget_secs() == llm_timeouts.OFFLINE_JOB
    assert coach_chat.turn_hard_ceiling_secs() > coach_chat.TURN_BUDGET_DEFAULT_SECS


# ── 3. a hung call IS CUT at the stated bound ───────────────────────────────

def test_a_hung_stream_is_cut_at_the_turn_bound(db_conn, monkeypatch):
    """🔴 THE CAPTURE. An endless stream that dribbles a token every 20 ms never
    trips a per-READ timeout — no SDK setting can end it. The turn deadline is
    what actually cuts it, and this measures the wall clock to prove it.
    """
    acct = _account(db_conn)
    # Warm the turn's setup path (tool-schema build, prompt assembly, first DB
    # reads) on a generous budget, so the measurement below times the STREAM and
    # not one-time import cost. Without this the turn is cut before it ever
    # opens a stream, and the test would pass for the wrong reason.
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "60")
    _run(db_conn, acct, _ScriptedClient(scripts=[[{"type": "text", "text": "warm"}]]))

    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "1.0")
    client = _ScriptedClient(scripts=[[{"type": "text", "text": "tick "}]],
                             gap=0.02, endless=True)

    began = time.monotonic()
    events = _run(db_conn, acct, client)
    elapsed = time.monotonic() - began

    assert client.calls == 1, "the stream was never opened — nothing was cut"
    assert any(e["type"] == "token" for e in events), (
        "nothing streamed at all — the harness stopped exercising the stream and "
        "the cut below proves nothing")
    assert events[-1]["type"] == "error"
    assert events[-1]["code"] == "turn_budget_exceeded", events[-1]
    assert elapsed < 10.0, f"the hung stream ran {elapsed:.1f}s — it was not cut"


def test_the_hung_stream_control_the_same_stream_completes_when_it_ends(db_conn, monkeypatch):
    """CONTROL for the test above. Same client shape, same gap — only `endless`
    differs. Without it, "the turn ended" could just mean the fake never
    produced anything."""
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "30")
    acct = _account(db_conn)
    client = _ScriptedClient(scripts=[[{"type": "text", "text": "tick "}]],
                             gap=0.02, endless=False)
    events = _run(db_conn, acct, client)
    assert events[-1]["type"] == "complete", events[-1]
    assert not any(e["type"] == "error" for e in events)


def test_a_cut_turn_keeps_what_the_member_already_saw(db_conn, monkeypatch):
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "0.4")
    acct = _account(db_conn)
    client = _ScriptedClient(scripts=[[{"type": "text", "text": "partial "}]],
                             gap=0.02, endless=True)
    _run(db_conn, acct, client)
    rows = coach_chat.list_messages(user_id="u_timeout", account_id=acct["id"],
                                    limit=50, conn=db_conn)["messages"]
    assert any(r["role"] == "assistant" and r["content"] for r in rows), (
        "the partial answer was dropped, leaving the thread with a user message "
        "and no reply")


# ── 4. the WHOLE TURN is bounded across chained loops ───────────────────────

def test_the_whole_turn_is_bounded_across_chained_tool_loops(db_conn, monkeypatch):
    """🔴 THE OTHER CAPTURE. Every round here is individually fast — no single
    call is anywhere near its per-call timeout. Only the SUM runs long, which is
    exactly the exposure a per-call timeout cannot see.
    """
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "0.35")
    acct = _account(db_conn)
    client = _ScriptedClient(
        scripts=[_tool_round(i) for i in range(coach_chat.MAX_LOOPS)],
        gap=0.12)

    began = time.monotonic()
    events = _run(db_conn, acct, client)
    elapsed = time.monotonic() - began

    assert events[-1]["code"] == "turn_budget_exceeded", events[-1]
    assert client.calls < coach_chat.MAX_LOOPS, (
        f"all {client.calls} rounds ran — the turn was never cut, so the budget "
        "is per-call in disguise")
    assert client.calls >= 1
    assert elapsed < 5.0


def test_the_chained_loop_control_the_same_script_runs_every_round(db_conn, monkeypatch):
    """CONTROL. Identical script and gap, generous budget: all MAX_LOOPS rounds
    must fire. Without this, `calls < MAX_LOOPS` above could mean the fake ran
    out of scripts, or that the loop never chained at all."""
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "60")
    acct = _account(db_conn)
    client = _ScriptedClient(
        scripts=[_tool_round(i) for i in range(coach_chat.MAX_LOOPS)],
        gap=0.12)
    events = _run(db_conn, acct, client)
    assert client.calls == coach_chat.MAX_LOOPS, client.calls
    assert events[-1]["code"] == "loop_limit_exceeded", events[-1]


def test_no_new_stream_is_opened_once_the_budget_is_gone(db_conn, monkeypatch):
    """The budget is not only about LLM calls. A tool executor is ordinary
    blocking work — no per-call LLM timeout can see it — so the loop re-checks
    the deadline BETWEEN rounds. Without that check the turn opens one more
    socket on a budget that is already spent.
    """
    from api.services.journal_two import coach_chat_tools as cct

    acct = _account(db_conn)
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "60")
    _run(db_conn, acct, _ScriptedClient(scripts=[[{"type": "text", "text": "warm"}]]))

    def _slow_tool(**_kw):
        time.sleep(0.6)
        return {"count": 0}

    monkeypatch.setitem(cct.TOOLS["get_open_positions"], "executor", _slow_tool)
    budget = 1.0
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", str(budget))
    client = _ScriptedClient(
        scripts=[_tool_round(i) for i in range(coach_chat.MAX_LOOPS)])

    began = time.monotonic()
    events = _run(db_conn, acct, client)

    assert events[-1]["code"] == "turn_budget_exceeded", events[-1]
    assert client.opened_at, "no stream was ever opened"
    last_open = max(client.opened_at) - began
    assert last_open < budget, (
        f"a stream was opened {last_open:.2f}s into a {budget}s turn — the "
        "budget was already gone and another socket went out anyway")


def test_each_chained_call_is_handed_less_than_the_one_before(db_conn, monkeypatch):
    """THE MECHANISM. Each step gets `min(per-call ceiling, what is left)`. That
    clamp is the whole difference between 9 x 120 s and one 180 s turn: without
    it the last round could still open a fresh 120 s socket after 179 s of turn.
    """
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "2.0")
    monkeypatch.setenv("COMPASS_CHAT_LLM_TIMEOUT_SECS", "120")
    acct = _account(db_conn)
    client = _ScriptedClient(
        scripts=[_tool_round(i) for i in range(coach_chat.MAX_LOOPS)],
        gap=0.15)
    _run(db_conn, acct, client)

    handed = client.timeouts
    assert len(handed) >= 2, handed
    assert all(t is not None for t in handed), handed
    assert handed == sorted(handed, reverse=True), (
        f"per-call timeouts did not shrink as the turn burned budget: {handed}")
    assert handed[0] <= coach_chat.turn_budget_secs() + 0.01, (
        f"the first call was handed {handed[0]}s of a "
        f"{coach_chat.turn_budget_secs()}s turn")
    assert max(handed) < llm_timeouts.REQUEST_PATH_LONG, (
        "a call was handed the full per-call ceiling despite the turn being "
        "shorter than it — the clamp is not applied")


def test_the_clamp_control_a_long_budget_leaves_the_per_call_ceiling_intact(
        db_conn, monkeypatch):
    """CONTROL for the clamp: when the turn has room, the per-call ceiling is
    what a call gets. Otherwise "the timeouts shrank" could just mean the clamp
    always returns something tiny."""
    monkeypatch.setenv("COMPASS_CHAT_TURN_BUDGET_SECS", "600")
    monkeypatch.setenv("COMPASS_CHAT_LLM_TIMEOUT_SECS", "30")
    acct = _account(db_conn)
    client = _ScriptedClient(scripts=[[{"type": "text", "text": "done"}]])
    _run(db_conn, acct, client)
    assert client.timeouts == [30.0], client.timeouts


def test_the_summarizer_spends_the_same_turn_budget(db_conn, monkeypatch):
    """`_maybe_summarize` runs INLINE, ahead of the first token. Given its own
    unshared 600 s it would be a free extra ten minutes in front of every turn.
    """
    acct = _account(db_conn)
    seen: list = []

    class _Summ:
        def summarize(self, *, text, user_id="u", timeout=None, **_kw):
            seen.append(timeout)
            return "summary"

    deadline = coach_chat._TurnDeadline(budget=5.0)
    monkeypatch.setattr(coach_chat, "SUMMARIZE_THRESHOLD_TOKENS", 1)
    coach_chat.append_message(user_id="u_timeout", account_id=acct["id"],
                              role="user", content="x" * 50, conn=db_conn)
    coach_chat._maybe_summarize(user_id="u_timeout", account_id=acct["id"],
                                summary_client=_Summ(), conn=db_conn,
                                deadline=deadline)
    assert seen and seen[0] is not None
    assert seen[0] <= 5.0, f"the summarizer was handed {seen[0]}s of a 5s turn"


def test_an_already_spent_budget_skips_the_summarizer(db_conn, monkeypatch):
    acct = _account(db_conn)
    called = []

    class _Summ:
        def summarize(self, **kw):
            called.append(kw)
            return "summary"

    monkeypatch.setattr(coach_chat, "SUMMARIZE_THRESHOLD_TOKENS", 1)
    coach_chat.append_message(user_id="u_timeout", account_id=acct["id"],
                              role="user", content="x" * 50, conn=db_conn)
    spent = coach_chat._TurnDeadline(budget=0.0)
    assert coach_chat._maybe_summarize(
        user_id="u_timeout", account_id=acct["id"], summary_client=_Summ(),
        conn=db_conn, deadline=spent) is False
    assert called == []


# ── 5. the deadline primitive ──────────────────────────────────────────────

def test_the_deadline_is_monotonic_not_wall_clock():
    """An NTP step or a DST jump must not extend (or collapse) a live budget."""
    import inspect
    src = inspect.getsource(coach_chat._TurnDeadline)
    assert "time.monotonic" in src
    assert "datetime" not in src and "time.time" not in src


def test_the_call_timeout_never_exceeds_what_is_left():
    d = coach_chat._TurnDeadline(budget=10.0)
    assert d.call_timeout(120.0) <= 10.0
    assert d.call_timeout(2.0) == 2.0          # its own ceiling still wins
    assert d.remaining() <= 10.0


def test_the_call_timeout_never_collapses_to_zero():
    """Handing the SDK `timeout=0` is the spelling of "fail instantly" — and
    `timeout=None` would be the spelling of "no timeout at all"."""
    spent = coach_chat._TurnDeadline(budget=0.0)
    assert spent.expired() is True
    assert spent.call_timeout(120.0) >= coach_chat._MIN_CALL_SECS > 0
