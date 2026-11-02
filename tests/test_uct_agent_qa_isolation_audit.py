"""UCT Agent program, agent-qa: ADVERSARIAL MODEL-ISOLATION AUDIT (ADR-005), server half.

Sprint 2 task 1. Owner rule: "gateway-only refusal is not sufficient proof". Every path a protected value
(`breadth.current`, `ratings`, and F-12's stock.compare composite) could take to a MODEL REQUEST is attacked
with SENTINEL values planted at the source. Each test pins what is TRUE TODAY, in one of three states:

  PROVEN BLOCKED          the code refuses or strips it, whatever the flags
  BLOCKED BY DORMANCY     it is refused only because a flag is off or no caller is wired yet
  OPEN                    a sentinel reaches a model request (or a model-bound store); the test is a STRICT pin
                          of the leak, so it FAILS the day the owner fixes it — then flip it to a proof

The written matrix (path × layer L1–L7 × state, with these test ids) is in
docs/agent/program/status/agent-qa.md. The browser half extends app/src/agent/qa/modelIsolation.test.jsx.
Fixes belong to their owners (turn.py / gateway.py / serializers: agent-lead); this file edits no product code.
"""
from __future__ import annotations

import json
import logging
import types

import pytest

from api.services.uct_agent import turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

SENT_NUM = "987.654"
SENT_INT = "13579"
SENT_STR = "ISO-SENTINEL-7Q"
SENTINELS = (SENT_NUM, SENT_INT, SENT_STR)
PURPOSES = sorted(env.PURPOSES)
KINDS_ENV = "UCT_AGENT_DATA_KINDS"          # agent-lead's planned per-kind allowlist (Sprint 2)


def leaks(obj) -> list[str]:
    s = obj if isinstance(obj, str) else json.dumps(obj, default=str)
    return [x for x in SENTINELS if x in s]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in (gw.DATA_ENV, gw.SCAN_ENV, gw.ISOLATED_ENV, KINDS_ENV):
        monkeypatch.delenv(k, raising=False)
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def isolated_kinds() -> list[str]:
    r = gw.registry()
    return sorted(n for n in r.names() if r.get(n).model_isolated)


def test_non_vacuity_the_owner_isolated_kinds_exist():
    assert {"breadth.current", "ratings"} <= set(isolated_kinds())


# ── L1 gateway: sentinels in the validator, the adapter's exception, and a broken envelope ─────────────────
def _spy(name, *, fn=None, validate=None):
    k = gw.registry().get(name)
    r = gw.Registry()
    r.register(gw.Kind(name=name, fn=fn or (lambda p, c: env.make_envelope(name, p, status="ok", freshness=k.freshness,
                                                                        as_of="2026-10-30T20:00:00Z", source="x",
                                                                        data={"v": float(SENT_NUM)})),
                       freshness=k.freshness, category=k.category, owner=k.owner, max_symbols=k.max_symbols,
                       validate=validate, model_isolated=k.model_isolated))
    return r


def _params(name):
    return {"symbol": "NVDA"} if gw.registry().get(name).max_symbols else {}


@pytest.mark.parametrize("name", ["breadth.current", "ratings"])
def test_L1_a_validator_that_RAISES_with_a_value_never_puts_it_in_the_envelope_or_the_log(monkeypatch, caplog, name):
    """PROVEN BLOCKED: the gateway keeps only the exception TYPE (log) and a fixed refusal note."""
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")

    def bad(params):
        raise ValueError(f"composite was {SENT_NUM} for {SENT_STR}")
    p = _params(name)
    gw._reset_for_test(_spy(name, validate=bad))
    with caplog.at_level(logging.DEBUG):
        out = gw.read(name, p, user_id=1, turn_id="v", purpose="answer")
    assert out["status"] == "refused" and env.validate_envelope(out) == []
    assert not leaks(out) and not leaks(caplog.text), (out, caplog.text)


@pytest.mark.parametrize("name", ["breadth.current", "ratings"])
def test_L1_an_adapter_that_RAISES_with_a_value_never_puts_it_in_the_envelope_or_the_log(monkeypatch, caplog, name):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")

    def boom(params, ctx):
        raise RuntimeError(f"upstream said {SENT_INT} / {SENT_STR}")
    gw._reset_for_test(_spy(name, fn=boom))
    with caplog.at_level(logging.DEBUG):
        out = gw.read(name, _params(name), user_id=1, turn_id="a", purpose="answer")
    assert out["status"] == "unavailable" and out["data"] is None
    assert not leaks(out) and not leaks(caplog.text), (out, caplog.text)


@pytest.mark.parametrize("name", ["breadth.current", "ratings"])
def test_L1_a_contract_BREAKING_envelope_carrying_values_is_replaced_and_its_values_never_logged(monkeypatch, caplog, name):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")

    def broken(params, ctx):
        return {"kind": name, "status": SENT_STR, "freshness": SENT_NUM, "data": {"composite": float(SENT_NUM)}}
    gw._reset_for_test(_spy(name, fn=broken))
    with caplog.at_level(logging.DEBUG):
        out = gw.read(name, _params(name), user_id=1, turn_id="b", purpose="answer")
    assert out["status"] == "unavailable" and out["data"] is None
    assert not leaks(out), out
    # the MD-1 error strings are logged (errs[:3]); they must name fields, never echo the values handed in
    assert not leaks(caplog.text), caplog.text


@pytest.mark.parametrize("name", ["breadth.current", "ratings"])
def test_L1_the_REAL_validators_answer_in_fixed_words_never_echoing_params(monkeypatch, name):
    """A validator's text DOES reach the member's envelope notes (gateway.py `str(why)[:300]`), so it must be
    value-free by construction. The two isolated validators, fed sentinel garbage, say fixed sentences."""
    k = gw.registry().get(name)
    if k.validate is None:
        pytest.skip(f"{name} has no validator")
    for bad in ({"symbol": SENT_STR}, {"symbol": SENT_NUM}, {"universe": SENT_STR, "metrics": [SENT_STR]}):
        why = k.validate(bad)
        if why:
            assert not leaks(str(why)), (name, bad, why)


@pytest.mark.parametrize("purpose", PURPOSES)
def test_L1_ORDER_isolation_is_decided_before_scan_symbol_validator_and_budget_checks(monkeypatch, purpose):
    """Dormant: refused for every purpose with NOTHING run — not the validator, not the source, no budget."""
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    for name in isolated_kinds():
        ran = []
        gw._reset_for_test(None)                                  # the real registry, to read this kind's shape
        gw._reset_for_test(_spy(name, fn=lambda p, c: ran.append("fn"), validate=lambda p: ran.append("v")))
        out = gw.read(name, {"symbols": ["A"] * 60}, user_id=1, turn_id="o", purpose=purpose)
        assert out["status"] == "refused" and ran == [] and not gw._turns, (name, out["notes"])
        assert "not available to UCT Agent yet" in " ".join(out["notes"]), out["notes"]


# ── L1 + Sprint 2: the per-kind allowlist (agent-lead's UCT_AGENT_DATA_KINDS) ────────────────────────────────
@pytest.mark.xfail(strict=True, reason="UCT_AGENT_DATA_KINDS is being built by agent-lead (Sprint 2). When it lands "
                   "this XPASSes and fails: delete this marker and keep the test as the proof.")
@pytest.mark.parametrize("purpose", PURPOSES)
def test_L1_ALLOWLIST_with_DATA_on_and_KINDS_quote_every_other_kind_is_refused_server_side(monkeypatch, purpose):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")              # even ACTIVATED, a non-listed isolated kind is refused
    monkeypatch.setenv(KINDS_ENV, "quote")
    real = gw.registry()
    for name in real.names():
        if name == "quote":
            continue
        k = real.get(name)
        ran = []
        r = gw.Registry()
        r.register(gw.Kind(name=name, fn=lambda p, c, _r=ran: _r.append("fn"), freshness=k.freshness,
                           category=k.category, owner=k.owner, max_symbols=k.max_symbols,
                           validate=lambda p, _r=ran: _r.append("v"), model_isolated=k.model_isolated))
        gw._reset_for_test(r)
        out = gw.read(name, {}, user_id=1, turn_id=f"k-{name}", purpose=purpose)
        assert out["status"] == "refused" and ran == [] and not gw._turns, (name, purpose, out.get("notes"))
        gw._reset_for_test(None)


# ── L4 history door: what a stored row contributes to the NEXT model request ─────────────────────────────────
def _conv(outcome_data, outcome_text, agent_text="ok", agent_data=None):
    return [{"role": "member", "text": "show NVDA", "data": {}},
            {"role": "agent", "text": agent_text, "data": agent_data or {}},
            {"role": "outcome", "text": outcome_text, "data": outcome_data}]


def test_L4_OPEN_PIN_a_NON_local_outcome_row_is_replayed_VERBATIM_so_the_boundary_is_the_action_name_or_flag():
    """The server cannot see values: a row is censored ONLY when its action is in LOCAL_ONLY_ACTIONS or the browser
    flagged it `local`. Any OTHER capability whose outcome TEXT embeds a protected value (a composition) reaches
    the model. Today no live capability's text does (stock.compare keeps the composite in its table — F-12 browser
    rail), so this is the structural fact the browser rails stand on. STRICT pin of today's behaviour."""
    rows = _conv({"kind": "answered", "actions": ["stock.compare"]}, f"NVDA UCT composite {SENT_NUM}")
    assert leaks(turn.history_messages(rows)) == [SENT_NUM]


def test_L4_F11_still_open_an_answered_row_without_actions_is_replayed():
    rows = _conv({"kind": "answered"}, f"rating {SENT_NUM}")
    assert leaks(turn.history_messages(rows)) == [SENT_NUM]


def test_L4_PROVEN_the_planning_reply_of_a_local_plan_is_never_replayed_even_if_stored_unblanked():
    agent_data = {"envelope": {"disposition": "apply", "ops": [{"action": "breadth.show", "args": {}}]}}
    rows = _conv({"kind": "answered", "actions": ["breadth.show"], "local": True}, f"{SENT_NUM}",
                 agent_text=f"It reads {SENT_INT} {SENT_STR}", agent_data=agent_data)
    assert not leaks(turn.history_messages(rows))


def test_L4_OPEN_LATENT_the_NAMING_call_reads_an_unblanked_local_plan_reply_that_history_would_drop():
    """Asymmetry: `history_messages` drops an agent row of a local plan (is_local_row); `name_conversation` reads
    every member/agent row's text with NO such guard. Today such a row is blanked when stored (and the model wrote
    it before any value existed), so this needs a stored row that was not blanked — an older or garbled row.
    Owner: agent-lead (turn.py). STRICT pin: fails when name_conversation applies the same guard."""
    agent_data = {"envelope": {"disposition": "apply", "ops": [{"action": "breadth.show", "args": {}}]}}
    rows = _conv({"kind": "answered", "actions": ["breadth.show"], "local": True}, "x",
                 agent_text=f"It reads {SENT_INT}", agent_data=agent_data)
    sent = []

    def caller(**kw):
        sent.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text='{"title": "t"}')], usage=None)
    turn.name_conversation(rows, caller=caller)
    assert sent, "the naming call was not reached: vacuous"
    assert leaks(sent) == [SENT_INT]
    assert not leaks(turn.history_messages(rows)), "history must still drop it (the control for the asymmetry)"


# ── L6 the model request itself: run_turn with a scripted model ──────────────────────────────────────────────
_ANSWER = '{"disposition":"answer","reply":"ok","question":null,"ops":[],"unsupported_category":null,"research":null,"title":null}'


def _scripted(calls):
    def call(**kw):
        calls.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=_ANSWER)], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))
    return call


@pytest.fixture
def no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)
    monkeypatch.setattr(turn, "_research", lambda q, r: pytest.fail("research must not run in this audit"))


def _sent(calls) -> str:
    assert calls, "no model call was made: vacuous"
    return json.dumps([{k: c.get(k) for k in ("system", "messages")} for c in calls], default=str)


def test_L6_OPEN_LATENT_recent_outcome_is_free_text_that_reaches_the_model_when_history_holds_no_local_row(no_cost):
    """`TurnIn.recentOutcome` is accepted by the router and forwarded verbatim. It is dropped ONLY when the stored
    history already holds a local row; the first local answer of a conversation (or one whose /record has not
    landed) is not in history yet. No browser code sends recentOutcome today (grep: zero senders), so it is an
    unused door. Owner: agent-lead. STRICT pin: fails when the door is removed or fails closed."""
    calls = []
    turn.run_turn(message="and now?", context={}, history=[], caller=_scripted(calls),
                  recent_outcome=f"breadth {SENT_NUM}% above 50sma")
    assert leaks(_sent(calls)) == [SENT_NUM]


def test_L6_PROVEN_recent_outcome_is_dropped_once_history_holds_a_local_row(no_cost):
    calls = []
    hist = _conv({"kind": "answered", "actions": ["breadth.show"], "local": True}, "shown")
    turn.run_turn(message="and now?", context={}, history=hist, caller=_scripted(calls),
                  recent_outcome=f"breadth {SENT_NUM}% above 50sma")
    assert not leaks(_sent(calls))


def test_L6_NOT_BUILT_workspace_context_is_forwarded_whole_the_server_strips_nothing(no_cost):
    """ADR-005 L6 ('run_turn refuses or strips a request whose context carries the isolated marker') is not built:
    there is no marker (L2 absent) and run_turn forwards the browser's context dict whole. BLOCKED BY DORMANCY:
    no capability reads an isolated kind yet. This pin fails when L6 lands — then make it the proof."""
    calls = []
    turn.run_turn(message="hi", context={"charts": [{"ref": "c1", "label": "NVDA", "isolated": True,
                                                      "value": float(SENT_NUM)}]},
                  history=[], caller=_scripted(calls))
    assert leaks(_sent(calls)) == [SENT_NUM]
    assert "isolated" not in json.dumps(env.refused("ratings", {}, "x")), "L2 marker landed: update this cell"


def test_L6_research_results_never_carry_gateway_data_the_server_has_no_path_from_a_read_to_a_model(no_cost):
    """PROVEN BY STRUCTURE: turn.py never imports the gateway; a gateway read's envelope goes only to the browser
    (/api/agent/data). Checked on the source, not by grep of prose: the module's import table."""
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(turn))
    mods = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module} | \
           {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    assert mods, "no imports parsed: vacuous"
    assert not any("marketdata" in m or "gateway" in m for m in mods), sorted(mods)


# ── L7 telemetry and logs ────────────────────────────────────────────────────────────────────────────────────
def test_L7_telemetry_is_column_allowlisted_but_its_short_FREE_TEXT_columns_are_not_value_checked(tmp_path, monkeypatch):
    """`/api/agent/record` telemetry lands in fixed columns (unknown keys dropped), but `path`, `disposition`,
    `actions[]`, `model` and `unsupported` are free strings, clipped not checked. Telemetry is never model-bound;
    F-13 says it carries no values, so the BROWSER must never put one there (browser rail). STRICT pin."""
    from api.services.uct_agent import store
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "agent.db"))
    monkeypatch.setattr(store, "_READY", False)            # a fresh file needs its schema, whatever ran before
    store.record_telemetry(1, "c1", {"path": "local", "unsupported": f"r{SENT_INT}", "values": float(SENT_NUM),
                                     "actions": [f"x{SENT_INT}"]})
    rows = store.telemetry_rows(1)
    assert rows, "telemetry not written: vacuous"
    assert SENT_NUM not in json.dumps(rows)                      # an unknown key is dropped
    assert SENT_INT in json.dumps(rows)                          # a free-text column keeps what it is handed


def test_L7_a_scripted_turn_with_sentinels_everywhere_logs_none_of_them(no_cost, caplog):
    calls = []
    hist = _conv({"kind": "answered", "actions": ["breadth.show"], "local": True}, f"{SENT_NUM}")
    with caplog.at_level(logging.DEBUG):
        turn.run_turn(message="hello", context={"note": SENT_STR}, history=hist, caller=_scripted(calls))
    assert calls
    assert not leaks(caplog.text), caplog.text
