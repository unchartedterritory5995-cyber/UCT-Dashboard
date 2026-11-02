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

# token-aware sentinels, shared (tests/test_uct_agent_qa_sentinels.py): a timing can no longer read as a leak
from tests.test_uct_agent_qa_sentinels import SENT_NUM, SENT_INT, SENT_STR, SENTINELS, leaks as _token_leaks
PURPOSES = sorted(env.PURPOSES)
KINDS_ENV = "UCT_AGENT_DATA_KINDS"          # agent-lead's planned per-kind allowlist (Sprint 2)


def leaks(obj) -> list[str]:
    return _token_leaks(obj, SENTINELS)


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
    monkeypatch.setenv(KINDS_ENV, name)                  # #621: a kind must be listed to be read at all

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
    monkeypatch.setenv(KINDS_ENV, name)                  # #621: a kind must be listed to be read at all

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
    monkeypatch.setenv(KINDS_ENV, name)                  # #621: a kind must be listed to be read at all

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
    monkeypatch.setenv(KINDS_ENV, ",".join(isolated_kinds()))   # listed: so the ISOLATION check is what refuses
    for name in isolated_kinds():
        ran = []
        gw._reset_for_test(None)                                  # the real registry, to read this kind's shape
        gw._reset_for_test(_spy(name, fn=lambda p, c: ran.append("fn"), validate=lambda p: ran.append("v")))
        out = gw.read(name, {"symbols": ["A"] * 60}, user_id=1, turn_id="o", purpose=purpose)
        assert out["status"] == "refused" and ran == [] and not gw._turns, (name, out["notes"])
        assert "not available to UCT Agent yet" in " ".join(out["notes"]), out["notes"]


# ── L1 + Sprint 2: the per-kind allowlist (agent-lead's UCT_AGENT_DATA_KINDS) ────────────────────────────────
HAS_ALLOWLIST = getattr(gw, "KINDS_ENV", None) == KINDS_ENV


def _all_spied():
    """Every real kind, its source and validator replaced by spies that record they ran."""
    real = gw.registry()
    ran: list = []
    r = gw.Registry()
    for name in real.names():
        k = real.get(name)
        r.register(gw.Kind(name=name, fn=lambda p, c, _n=name: ran.append(("fn", _n)) or env.make_envelope(
                               _n, p, status="ok", freshness=real.get(_n).freshness, as_of="2026-10-30T20:00:00Z",
                               source="spy", data={"v": 1}),
                           freshness=k.freshness, category=k.category, owner=k.owner, max_symbols=k.max_symbols,
                           validate=lambda p, _n=name: ran.append(("v", _n)), model_isolated=k.model_isolated))
    return r, ran, real.names()


@pytest.mark.parametrize("purpose", PURPOSES)
def test_L1_ALLOWLIST_with_DATA_on_and_KINDS_quote_every_other_kind_is_refused_server_side(monkeypatch, purpose):
    """#621 (agent-lead). Before it: a non-listed kind IS admitted (the cell was OPEN). After: refused, nothing run."""
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")              # even ACTIVATED, a non-listed isolated kind is refused
    monkeypatch.setenv(KINDS_ENV, "quote")
    r, ran, names = _all_spied()
    gw._reset_for_test(r)
    admitted = []
    for name in names:
        if name == "quote":
            continue
        out = gw.read(name, {}, user_id=1, turn_id=f"k-{name}", purpose=purpose)
        if out["status"] != "refused" or any(n == name for _, n in ran):
            admitted.append(name)
    if HAS_ALLOWLIST:
        assert admitted == [] and not gw._turns, admitted                              # PROVEN
    else:
        assert admitted, "pre-#621: the cell is OPEN (a non-listed kind is admitted)"   # OPEN, pinned


@pytest.mark.skipif(not HAS_ALLOWLIST, reason="pre-#621: there is no allowlist to fail closed")
def test_L1_ALLOWLIST_fails_closed_when_unset_and_never_widens_ISOLATED_or_SCAN(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    r, ran, names = _all_spied()
    gw._reset_for_test(r)
    for name in names:                                                   # DATA on, KINDS unset: nothing is read
        assert gw.read(name, {}, user_id=1, turn_id=f"u-{name}", purpose="answer")["status"] == "refused", name
    monkeypatch.setenv(KINDS_ENV, ",".join(names))                       # every kind LISTED, ISOLATED and SCAN off
    for name in names:
        k = gw.registry().get(name)
        if k.model_isolated or k.category == "scan":
            out = gw.read(name, {}, user_id=1, turn_id=f"w-{name}", purpose="answer")
            assert out["status"] == "refused", (name, out["notes"])
    assert ran == [] or all(not (gw.registry().get(n).model_isolated or gw.registry().get(n).category == "scan")
                            for _, n in ran), ran
    assert {"breadth.current", "ratings"} <= set(names)                  # non-vacuity


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


HAS_F11_FIX = hasattr(turn, "ACTIONLESS_OUTCOME_KINDS")


def test_L4_F11_an_answered_row_without_actions():
    """#622 (agent-lead): before it, replayed (OPEN). After it, it fails closed, while the browser's own action-less
    notes (ACTIONLESS_OUTCOME_KINDS) still replay."""
    rows = _conv({"kind": "answered"}, f"rating {SENT_NUM}")
    if not HAS_F11_FIX:
        assert leaks(turn.history_messages(rows)) == [SENT_NUM]        # OPEN, pinned
        return
    assert not leaks(turn.history_messages(rows))                        # PROVEN: fail closed
    for kind in ("answered", "garbled", None, ""):
        assert not leaks(turn.history_messages(_conv({"kind": kind}, f"x {SENT_NUM}"))), kind
    note = sorted(turn.ACTIONLESS_OUTCOME_KINDS)[0]
    assert leaks(turn.history_messages(_conv({"kind": note}, f"x {SENT_NUM}"))) == [SENT_NUM], \
        "CONTROL: a listed browser note still replays (its text must stay UCT's own fixed words)"


def test_L4_PROVEN_the_planning_reply_of_a_local_plan_is_never_replayed_even_if_stored_unblanked():
    agent_data = {"envelope": {"disposition": "apply", "ops": [{"action": "breadth.show", "args": {}}]}}
    rows = _conv({"kind": "answered", "actions": ["breadth.show"], "local": True}, f"{SENT_NUM}",
                 agent_text=f"It reads {SENT_INT} {SENT_STR}", agent_data=agent_data)
    assert not leaks(turn.history_messages(rows))


def test_L4_PROVEN_F18_the_NAMING_call_skips_an_unblanked_local_plan_reply_as_history_does():
    """F-18, fixed by agent-lead (isolation-fixes): `name_conversation` now applies `is_local_row` to agent rows, the
    same guard as `history_messages`. CONTROL: a NON-local agent row's text still reaches the naming call, so the
    detector can fail."""
    agent_data = {"envelope": {"disposition": "apply", "ops": [{"action": "breadth.show", "args": {}}]}}
    rows = _conv({"kind": "answered", "actions": ["breadth.show"], "local": True}, "x",
                 agent_text=f"It reads {SENT_INT}", agent_data=agent_data)

    def naming_input(rs):
        sent = []

        def caller(**kw):
            sent.append(kw)
            return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text='{"title": "t"}')], usage=None)
        turn.name_conversation(rs, caller=caller)
        assert sent, "the naming call was not reached: vacuous"
        return sent
    assert not leaks(naming_input(rows))
    assert not leaks(turn.history_messages(rows))
    plain = _conv({"kind": "answered", "actions": ["chart.setType"]}, "x", agent_text=f"Switched {SENT_INT}")
    assert leaks(naming_input(plain)) == [SENT_INT], "CONTROL: a non-local reply is still read (the test can fail)"


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


def test_L6_PROVEN_F17_recent_outcome_never_reaches_the_model_even_with_no_local_row(no_cost):
    """F-17, fixed by agent-lead (isolation-fixes): run_turn never forwards `recent_outcome` (the TurnIn field stays
    accepted for old clients). CONTROL: the same request's member text DOES reach the model."""
    calls = []
    turn.run_turn(message=f"and now {SENT_STR}?", context={}, history=[], caller=_scripted(calls),
                  recent_outcome=f"breadth {SENT_NUM}% above 50sma")
    sent = _sent(calls)
    assert SENT_NUM not in leaks(sent)
    assert SENT_STR in sent, "CONTROL: the member's own words are forwarded (the detector can see a payload)"


def test_L6_PROVEN_recent_outcome_is_dropped_once_history_holds_a_local_row(no_cost):
    calls = []
    hist = _conv({"kind": "answered", "actions": ["breadth.show"], "local": True}, "shown")
    turn.run_turn(message="and now?", context={}, history=hist, caller=_scripted(calls),
                  recent_outcome=f"breadth {SENT_NUM}% above 50sma")
    assert not leaks(_sent(calls))


def test_L6_PROVEN_a_MARKED_object_in_workspace_context_is_stripped_and_L2_marks_isolated_reads(no_cost):
    """Cells #8 and #17, flipped for agent-lead's adr005-l2-l5-l6: run_turn strips any `isolated: true` object from the
    context (L6), and the gateway stamps the marker on isolated reads (L2). CONTROL: the unmarked value IS sent.
    Full layer proofs: tests/test_uct_agent_qa_isolation_layers.py (and F-21 / F-22, where they do not reach)."""
    calls = []
    turn.run_turn(message="hi", context={"charts": [{"ref": "c1", "label": SENT_STR,
                                                      "reading": {"isolated": True, "value": float(SENT_NUM)}}]},
                  history=[], caller=_scripted(calls))
    s = _sent(calls)
    assert SENT_NUM not in leaks(s) and SENT_STR in s
    assert env.validate_envelope({**env.refused("ratings", {}, "x"), "isolated": False}), "L2: a non-true marker is invalid"


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
