"""Wave 3 W3-1 / W3-4 (w3-a, 2026-11-03) -- the coach: knowledge base, flag, config, concepts route, the coach prompt
block and the server-side guard on a coach turn. Scripted model only (no paid call), no network, no member data."""
from __future__ import annotations

import json
import re
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services.uct_agent import coach, turn
from api.services.uct_agent.coach import concepts, guard, prompt

ME = {"id": "u-me", "plan": "pro", "role": "admin"}
CAPS = [{"name": "coach.explain", "domain": "coach", "target": "coach", "summary": "Explain a trading concept.",
         "hints": None, "risk": "local", "reversible": True, "query": True,
         "args": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"], "additionalProperties": False}}]
CONCEPT = ("Breakouts and failed breakouts. A breakout is a move through a level that had been containing price. "
           "Uncertainty: no pattern makes a breakout certain to hold.")
OBS = "On this chart (NVDA, daily bars through 2026-10-30): the last close is above its 20-day average."
COACH_CTX = {"charts": [{"ref": "c1", "label": "Chart (NVDA)", "symbol": "NVDA"}],
             "coach": [{"ref": "k1", "label": "Trading coach", "conceptId": "breakouts-and-failure", "concept": CONCEPT,
                        "observation": OBS, "consent": "unknown"}]}
PLAIN_CTX = {"charts": [{"ref": "c1", "label": "Chart (NVDA)", "symbol": "NVDA"}]}


def env(reply, disposition="answer", question=None):
    return {"disposition": disposition, "reply": reply, "question": question, "ops": [], "unsupported_category": None, "research": None}


def scripted(e):
    """A caller that returns `e` and records every system text it was given."""
    seen = {"system": [], "calls": 0}

    def call(**kw):
        seen["calls"] += 1
        seen["system"].append("\n".join(b["text"] for b in kw["system"]))
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(e))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=100, output_tokens=20))
    call.seen = seen
    return call


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(coach.FLAG_ENV, "1")


@pytest.fixture
def off(monkeypatch):
    monkeypatch.delenv(coach.FLAG_ENV, raising=False)


@pytest.fixture
def client():
    def build(user):
        from api.middleware.auth_middleware import get_current_user_with_plan
        app = FastAPI()
        app.include_router(rx.router)
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return TestClient(app)
    return build


# ── the knowledge base ──────────────────────────────────────────────────────────────────────────────────────────────

def test_knowledge_base_has_the_required_concepts_in_the_required_format():
    rows = concepts.load(force=True)
    assert len(rows) >= concepts.MIN_CONCEPTS
    ids = {c["id"] for c in rows}
    for want in ("price-action-basics", "support-resistance", "consolidation-tightness", "breakouts-and-failure",
                 "relative-strength", "volume-relative-volume", "moving-averages-context", "risk-per-trade-position-sizing",
                 "stop-placement", "market-conditions-breadth", "earnings-gaps", "drawdown", "expectancy"):
        assert want in ids, want
    for c in rows:
        assert set(c["sections"]) == set(concepts.SECTIONS)
        assert all(c["sections"][s] for s in concepts.SECTIONS)
        assert c["observe"] in concepts.OBSERVE
        assert c["aliases"], c["id"]
        assert c["text"].startswith(c["title"] + ". ")
        assert "Uncertainty:" in c["text"]
        # no markdown tables / links / headings survive into the served text
        assert not re.search(r"\|.*\||https?://|^#", c["text"], re.M), c["id"]
        # never advice about THE MEMBER: no "you should" / "I would" buy-sell wording anywhere in the base
        assert guard.order_language(c["text"]) == [], c["id"]
        assert guard.unsupported(c["text"]) == [], c["id"]


def test_knowledge_base_ids_match_their_file_names_and_a_bad_file_is_skipped(tmp_path, caplog):
    good = concepts.CONCEPTS_DIR / "drawdown.md"
    (tmp_path / "drawdown.md").write_text(good.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "wrong-name.md").write_text(good.read_text(encoding="utf-8"), encoding="utf-8")   # id != file name
    (tmp_path / "broken.md").write_text("no front matter here", encoding="utf-8")
    rows = concepts.load(tmp_path)
    assert [c["id"] for c in rows] == ["drawdown"]
    assert "coach concept skipped" in caplog.text


def test_parse_concept_rejects_missing_sections():
    text = "---\nid: x-y\ntitle: X\naliases: x\nobserve: none\n---\n## What it is\nA.\n## What to look for\nB.\n"
    with pytest.raises(ValueError):
        concepts.parse_concept(text)


@pytest.mark.parametrize("words,expect", [
    ("relative strength", "relative-strength"), ("what is rs", None), ("explain the rs line", "relative-strength"),
    ("failed breakout", "breakouts-and-failure"), ("tell me about the 50-day", "moving-averages-context"),
    ("how many shares", "risk-per-trade-position-sizing"), ("my drawdown", "drawdown"),
    ("where to put a stop", "stop-placement"), ("earnings gap", "earnings-gaps"), ("breadth", None), ("market breadth context", "market-conditions-breadth"),
    ("rsi", None), ("macd", None), ("", None), ("x" * 201, None),
])
def test_concept_for_matches_exactly_one_or_none(words, expect):
    c = concepts.concept_for(words)
    assert (c["id"] if c else None) == expect


def test_longest_alias_wins_on_overlap():
    # "relative volume" names the volume concept, not "volume" alone; "support and resistance" the levels concept
    assert concepts.concept_for("relative volume")["id"] == "volume-relative-volume"
    assert concepts.concept_for("support and resistance")["id"] == "support-resistance"


# ── the flag, the config, the route ─────────────────────────────────────────────────────────────────────────────────

def test_flag_is_off_by_default_and_reported_by_config(off, client):
    assert coach.enabled() is False
    assert client(ME).get("/api/agent/config").json()["coach"] is False


def test_config_reports_coach_on(on, client):
    assert client(ME).get("/api/agent/config").json()["coach"] is True


def test_concepts_route_404_while_dark(off, client):
    assert client(ME).get("/api/agent/coach/concepts").status_code == 404


def test_concepts_route_serves_the_base_when_on(on, client):
    r = client(ME).get("/api/agent/coach/concepts")
    assert r.status_code == 200
    body = r.json()
    assert body["footer"] == guard.FOOTER
    assert len(body["concepts"]) >= concepts.MIN_CONCEPTS
    row = next(c for c in body["concepts"] if c["id"] == "relative-strength")
    assert set(row) == {"id", "title", "aliases", "observe", "text", "sections"}
    assert "rs line" in row["aliases"] and "rs" not in row["aliases"]


def test_concepts_route_is_admin_dark(on, client):
    member = {"id": "u-m", "plan": "pro", "role": "member"}
    assert client(member).get("/api/agent/coach/concepts").status_code == 403


# ── is_coach_turn ───────────────────────────────────────────────────────────────────────────────────────────────────

def test_is_coach_turn_needs_both_the_flag_and_the_browser_entry(on, monkeypatch):
    assert coach.is_coach_turn(COACH_CTX) is True
    assert coach.is_coach_turn(PLAIN_CTX) is False
    assert coach.is_coach_turn({"coach": "yes"}) is False
    assert coach.is_coach_turn({"coach": [{"label": "no ref"}]}) is False
    monkeypatch.delenv(coach.FLAG_ENV)
    assert coach.is_coach_turn(COACH_CTX) is False          # a stale browser cannot coach a dark server


# ── the turn: the coach block and the guard ─────────────────────────────────────────────────────────────────────────

def test_coach_turn_gets_the_coach_block_and_a_clean_reply_gets_the_footer(on):
    c = scripted(env("A breakout is a move through a level that had been containing price. It may fail. What was the level?"))
    out = turn.run_turn(message="what is a failed breakout?", context=COACH_CTX, history=[], capabilities=CAPS, caller=c)
    assert prompt.RULES.strip() in c.seen["system"][0]
    assert out["envelope"]["reply"].endswith(guard.FOOTER)
    assert out["usage"]["coach_guard"] == []


def test_violating_reply_is_replaced_and_logged_value_free(on, caplog):
    c = scripted(env("NVDA will go up from here — buy now, target 180."))
    with caplog.at_level("INFO"):
        out = turn.run_turn(message="should I buy NVDA?", context=COACH_CTX, history=[], capabilities=CAPS, caller=c)
    assert out["envelope"]["reply"] == guard.FIXED
    assert set(out["usage"]["coach_guard"]) == {"unsupported", "order", "figure", "uncertainty"}
    line = next(r.getMessage() for r in caplog.records if "coach guard" in r.getMessage())
    assert "180" not in line and "NVDA" not in line and "buy" not in line     # codes only


def test_figures_from_the_entry_and_the_message_are_allowed_others_are_not(on):
    ok = scripted(env("On this chart the last close is above its 20-day average (through 2026-10-30). That may change. What is your plan?"))
    out = turn.run_turn(message="is NVDA above the 20-day?", context=COACH_CTX, history=[], capabilities=CAPS, caller=ok)
    assert out["usage"]["coach_guard"] == []
    mine = scripted(env("Your 2% rule is a common choice; it may or may not suit you. What made you pick it?"))
    out = turn.run_turn(message="I risk 2% per trade, is that right?", context=COACH_CTX, history=[], capabilities=CAPS, caller=mine)
    assert out["usage"]["coach_guard"] == []                     # 2 came from the member's own words
    invented = scripted(env("Most traders risk 1% per trade; it may vary. What do you risk?"))
    out = turn.run_turn(message="how much should I risk?", context=COACH_CTX, history=[], capabilities=CAPS, caller=invented)
    assert out["envelope"]["reply"] == guard.FIXED and out["usage"]["coach_guard"] == ["figure"]


def test_a_clarify_question_is_guarded_too(on):
    c = scripted(env("", disposition="clarify", question={"text": "Which chart — the one that will go up?", "choices": []}))
    out = turn.run_turn(message="coach me on breakouts", context=COACH_CTX, history=[], capabilities=CAPS, caller=c)
    assert out["envelope"]["question"]["text"] == guard.FIXED


def test_non_coach_turn_is_untouched_even_with_the_flag_on(on):
    reply = "NVDA will go up from here, buy now."       # not the coach's turn: ordinary rules apply, nothing replaced here
    c = scripted(env(reply))
    out = turn.run_turn(message="what do you think?", context=PLAIN_CTX, history=[], capabilities=CAPS, caller=c)
    assert prompt.RULES.strip() not in c.seen["system"][0]
    assert out["envelope"]["reply"] == reply
    assert "coach_guard" not in out["usage"]


def test_flag_off_the_entry_is_ignored(off):
    reply = "This is guaranteed."
    c = scripted(env(reply))
    out = turn.run_turn(message="coach me", context=COACH_CTX, history=[], capabilities=CAPS, caller=c)
    assert prompt.RULES.strip() not in c.seen["system"][0]
    assert out["envelope"]["reply"] == reply


def test_coach_turn_never_streams_its_reply(on):
    """The guard must see the whole reply before the member does: no delta events on a coach turn."""
    events = []
    c = scripted(env("Breakouts may fail; a close back inside the range is one definition. What was yours?"))

    def stream_caller(feed, **kw):
        feed("Breakouts may fail")           # a streaming model would feed deltas; the gate must drop them
        return c(**kw)
    out = turn.run_turn(message="coach me on breakouts", context=COACH_CTX, history=[], capabilities=CAPS,
                        caller=c, stream_caller=stream_caller, on_event=events.append)
    assert not [e for e in events if e.get("t") == "delta"]
    assert out["envelope"]["reply"].endswith(guard.FOOTER)


def test_prompt_block_states_the_hard_rules():
    r = prompt.RULES
    for must in ("Educational, not advice", "price target", "buy", "ONE short question", "Every number", "consent", "GROUNDED"):
        assert must in r, must


# ── W3 review fixes (C1, C2, server-built concept text) ─────────────────────────────────────────────────────────────

def test_c1_a_coach_turn_never_takes_the_v2_step_loop(on, monkeypatch):
    """C1: with planner v2 requested, a coach turn is still served on v1 -- the coach block and the guard apply."""
    from api.services.uct_agent import turn_v2

    def boom(**_kw):
        raise AssertionError("a coach turn reached turn_v2.run_turn_v2")
    monkeypatch.setattr(turn_v2, "run_turn_v2", boom)
    c = scripted(env("NVDA will go up from here, buy now."))
    out = turn.run_turn(message="should I buy NVDA?", context=COACH_CTX, history=[], capabilities=CAPS, caller=c,
                        v2={"turn_token": "t-v2", "wait_step": lambda *_a, **_k: None})
    assert prompt.RULES.strip() in c.seen["system"][0]
    assert out["envelope"]["reply"] == guard.FIXED
    assert "unsupported" in out["usage"]["coach_guard"]


def test_c1_a_plain_turn_still_takes_v2_when_requested(on, monkeypatch):
    from api.services.uct_agent import turn_v2
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return {"envelope": {"reply": "v2"}, "usage": {}}
    monkeypatch.setattr(turn_v2, "run_turn_v2", fake)
    out = turn.run_turn(message="add a 20-day line", context=PLAIN_CTX, history=[], capabilities=CAPS, caller=scripted(env("x")),
                        v2={"turn_token": "t-v2", "wait_step": lambda *_a, **_k: None})
    assert out["envelope"]["reply"] == "v2" and seen["turn_token"] == "t-v2"


def test_c1_the_router_never_registers_a_v2_turn_for_a_coach_context():
    import inspect
    from api.routers import uct_agent as r
    src = inspect.getsource(r)
    assert "not agent_coach.is_coach_turn(body.context)" in src


def test_c2_the_footer_never_stands_in_for_a_hedge(on):
    assert guard.check("The breakout likely follows through.\n\nEducational, not advice.", []) == ["uncertainty"]
    assert guard.check("Odds strongly favor continuation from here.\n\nEducational, not advice.", []) == ["unsupported", "uncertainty"]
    assert guard.has_hedge("Educational, not advice.") is False
    c = scripted(env("The breakout likely follows through. What level are you watching?\n\nEducational, not advice."))
    out = turn.run_turn(message="what is a failed breakout?", context=COACH_CTX, history=[], capabilities=CAPS, caller=c)
    assert out["envelope"]["reply"] == guard.FIXED and out["usage"]["coach_guard"] == ["uncertainty"]


def test_guard_inputs_rebuild_the_concept_from_its_id_not_the_browser_copy(on):
    forged = {"coach": [{"ref": "k1", "conceptId": "breakouts-and-failure", "concept": "Targets: 180 and 250.", "consent": "unknown"}]}
    ins = coach.guard_inputs(forged, "hi")
    assert concepts.by_id("breakouts-and-failure")["text"] in ins
    assert not any("180" in x for x in ins)
    assert guard.untraceable_figures("It may reach 180.", ins) == ["180"]
    unknown = {"coach": [{"ref": "k1", "conceptId": "no-such-concept", "concept": "Targets: 180.", "consent": "unknown"}]}
    assert coach.guard_inputs(unknown, "hi") == ["hi"]


GENERIC = ("flag", "breakdown", "false breakout", "gap up", "gap and go", "volume", "stop", "stops", "support", "levels",
           "base", "edge", "ma", "rs", "breadth", "tape", "leader")


def test_no_concept_claims_a_wisdom_setup_word_or_a_bare_generic_alias():
    """W3 review: these collide with Wisdom setups (flag, gap and go ...) or UCT's own tools / chart commands."""
    rows = concepts.load(force=True)
    for c in rows:
        assert not set(c["aliases"]) & set(GENERIC), (c["id"], sorted(set(c["aliases"]) & set(GENERIC)))
    for words in ("add volume", "move my stop", "show breadth", "rs", "flag", "gap and go"):
        assert concepts.concept_for(words, rows) is None, words


def test_n5_the_coach_block_sends_setups_to_the_playbook():
    r = prompt.RULES
    assert "UCT SETUPS COME FROM THE PLAYBOOK" in r and "never write your own definition of a setup" in r
