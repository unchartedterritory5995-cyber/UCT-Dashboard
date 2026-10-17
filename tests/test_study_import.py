"""Importer checks: number grounding (copied from the COT narrative gate),
VOICE.md §6 voice rules, the near-duplicate diff, review lanes, and the
router storing a failing item as a draft WITH its flags (spec §4.9, §6.2,
§8.1, §13.6, §13.9 #3).

Run alone: python -m pytest tests/test_study_import.py -q
"""
from __future__ import annotations

import inspect

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.services import cot_narrative
from api.services import study_import as si
from api.services import study_store as ss


def _item(**over):
    base = {"id": "si_000000000001", "type": "recall", "skill_id": "f1.basics",
            "prompt_json": {"q": "What is a bid?", "choices": ["a", "b"]},
            "answer_json": {"answer": "a"},
            "reveal_json": {"facts": {"spread_pct": 0.5, "shares": 2500}},
            "lesson_text": "The spread was 0.5%. You paid it on 2,500 shares."}
    base.update(over)
    return base


# ── grounding ─────────────────────────────────────────────────────────────────

def test_grounding_passes_when_every_number_is_in_the_facts():
    assert si.grounding_check(_item()) == []


def test_grounding_flags_a_number_the_facts_do_not_hold():
    bad = si.grounding_check(_item(lesson_text="The spread was 0.5%, about 7 ticks."))
    assert bad == ["lesson_text: 7"]


def test_grounding_accepts_the_k_m_and_percent_variants():
    it = _item(reveal_json={"facts": {"volume": 113553, "ratio": 0.42, "dollars": 2500000}},
               lesson_text="Volume ran 113.6K, 42% of the day, worth $2.5M.")
    assert si.grounding_check(it) == []


def test_grounding_checks_reveal_prose_but_not_reveal_facts_or_quotes():
    it = _item(lesson_text=None,
               reveal_json={"facts": {"x": 1}, "quote": "Cut losses at 7-8%", "why": "Here 9 is wrong, 8 is fine."})
    assert si.grounding_check(it) == ["reveal_json.why: 9"]


def test_grounding_allows_the_items_own_asof_date_and_prompt_numbers_do_not_count():
    it = _item(asof="2024-05-20", prompt_json={"q": "Account $10,000, risk 1%?"},
               reveal_json={}, lesson_text="On 2024-05-20 you had 10,000 at 1%.")
    bad = si.grounding_check(it)
    assert "lesson_text: 10,000" in bad and "lesson_text: 1%" in bad and "lesson_text: 2024" not in bad


def test_grounding_regex_and_variants_are_the_cot_narratives():
    """The gate is COPIED from cot_narrative (§8.1 names it); a drift in either
    file shows here."""
    assert si._NUM_RE.pattern == cot_narrative._NUM_RE.pattern
    for v in (113553, 2500000, 0.42, -12.5, 7):
        assert si._variants(v) == cot_narrative._variants(v)
    for tok in ("113,553", "-12.50%", "$2,500", "08", "−15", "+3.0"):
        assert si._normalise(tok) == cot_narrative._normalise(tok), tok
    assert "_allowed_numbers" in inspect.getsource(cot_narrative)   # the gate this copies still exists


# ── voice ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("phrase", si.BANNED_PHRASES)
def test_every_banned_phrase_is_caught(phrase):
    assert any("banned phrase" in v for v in si.voice_check(f"Well, {phrase} here."))


def test_voice_em_dash_emoji_and_register():
    assert "em-dash" in si.voice_check("Stop first — size last.")
    assert "emoji" in si.voice_check("Nice \U0001F680")
    assert any("register" in v for v in si.voice_check("Traders should wait."))
    assert any("register" in v for v in si.voice_check("Successful traders wait."))


def test_voice_question_rules_exclamation_and_22_words():
    long_q = " ".join(["word"] * 23) + "?"
    assert si.voice_check(long_q, question=True) == ["sentence over 22 words (23)"]
    assert si.voice_check(" ".join(["word"] * 22) + "?", question=True) == []
    assert si.voice_check("Where is the stop!", question=True) == ["exclamation mark in a question"]
    assert si.voice_check("Where is the stop!") == []                   # a lesson may carry one


def test_voice_lesson_rule_no_rhetorical_questions():
    assert si.voice_check("Why does that matter? Because.", lesson=True) == ["rhetorical question in a lesson"]
    assert si.voice_check("Why does that matter? Because.") == []


def test_voice_passes_the_owners_own_sentences():
    for s in ("The stop is an appointment, not a debate.",
              "Stop first, distance second, size last.",
              "Skip it. I'd rather miss it than chase it.",
              "This stock just gapped up 14% on earnings and closed near the high. Where is the stop?"):
        assert si.voice_check(s, question=True, lesson=False) == [], s


# ── near-duplicate ────────────────────────────────────────────────────────────

def test_near_duplicate_same_skill_similar_text():
    bank = [{"id": "si_a", "skill_id": "f1.basics", "prompt_json": {"q": "What is a bid, exactly?", "choices": ["a", "b"]}},
            {"id": "si_b", "skill_id": "f2.other", "prompt_json": {"q": "What is a bid?", "choices": ["a", "b"]}}]
    hit = si.near_duplicate(_item(prompt_json={"q": "What is a bid exactly?", "choices": ["a", "b"]}), bank)
    assert hit == {"id": "si_a", "score": 1.0}
    assert si.near_duplicate(_item(prompt_json={"q": "Where does the stop go on a flag?"}), bank) is None


def test_near_duplicate_ignores_itself_and_respects_the_threshold():
    bank = [{"id": "si_000000000001", "skill_id": "f1.basics", "prompt_json": {"q": "What is a bid?"}},
            {"id": "si_c", "skill_id": "f1.basics", "prompt_json": {"q": "What is a bid and an ask and a spread?"}}]
    assert si.near_duplicate(_item(), bank) is None            # self + below 0.85
    assert si.jaccard({"a", "b"}, {"a", "b", "c"}) == pytest.approx(2 / 3)


def test_near_duplicate_reads_the_quote_the_choices_and_the_chart_identity():
    """The same question over two different quoted sources, two different
    choice sets, or two different charts is two items, not a duplicate."""
    base = {"skill_id": "vocab.candle", "prompt_json": {"q": "Which candle name fits this description?"}}
    a = {**base, "id": "si_a", "prompt_json": {**base["prompt_json"], "quote": "A long lower wick after a decline."}}
    b = {**base, "id": "si_b", "prompt_json": {**base["prompt_json"], "quote": "A long upper wick after an advance."}}
    assert si.near_duplicate(a, [b]) is None
    c = {"id": "si_c", "skill_id": "s", "prompt_json": {"q": "Does the setup fire here?", "choices": ["Yes", "No"]},
         "bars_embed": {"sym": "AAPL", "asof": "2022-07-12"}}
    d = {**c, "id": "si_d", "bars_embed": {"sym": "MSFT", "asof": "2023-01-26"}}
    assert si.near_duplicate(c, [d]) is None
    assert si.near_duplicate(c, [{**d, "bars_embed": dict(c["bars_embed"])}]) == {"id": "si_d", "score": 1.0}
    assert si.chart_key(c) == ("2022-07-12", "AAPL") and si.chart_key(a) == ("", "")
    # the chart is a hard key: a near-identical question over another chart of the same ticker is not a dup
    e = {**c, "id": "si_e", "bars_embed": {"sym": "AAPL", "asof": "2023-01-26"}}
    assert si.near_duplicate(c, [e]) is None


def test_a_different_number_in_the_question_is_a_different_question():
    """Sizing drills share one template and differ by their inputs; the
    drawdown ladder items differ by one percent. Those are not duplicates."""
    a = {"id": "si_a", "skill_id": "size.drawdown",
         "prompt_json": {"q": "You are 8% off your peak. What is your max size?", "choices": ["20%", "10%", "8%", "5%"]}}
    b = {**a, "id": "si_b", "prompt_json": {**a["prompt_json"], "q": "You are 10% off your peak. What is your max size?"}}
    assert si.near_duplicate(a, [b]) is None
    assert si.near_duplicate(a, [{**b, "prompt_json": dict(a["prompt_json"])}]) == {"id": "si_b", "score": 1.0}
    assert si.question_numbers(a) == ["8"] and si.question_numbers(b) == ["10"]


def test_a_declared_subject_separates_two_names_that_share_their_words():
    """'Upside Tasuki Gap' vs 'Downside Tasuki Gap' in one short template is
    0.89 by Jaccard; prompt_json.subject makes them two items. The same
    subject asked the same way is still a duplicate."""
    a = {"id": "si_a", "skill_id": "vocab.candle",
         "prompt_json": {"q": "How many bars make a Upside Tasuki Gap?", "choices": ["1", "2", "3", "4", "5"],
                         "subject": "Upside Tasuki Gap"}}
    b = {"id": "si_b", "skill_id": "vocab.candle",
         "prompt_json": {"q": "How many bars make a Downside Tasuki Gap?", "choices": ["1", "2", "3", "4", "5"],
                         "subject": "Downside Tasuki Gap"}}
    assert si.near_duplicate(a, [b]) is None
    hit = si.near_duplicate(a, [{**b, "id": "si_c", "prompt_json": {**b["prompt_json"], "subject": "upside tasuki gap"}}])
    assert hit and hit["id"] == "si_c" and hit["score"] >= 0.85
    assert si.subject_key(a) == "upside tasuki gap" and si.subject_key({"prompt_json": {"q": "x"}}) == ""


# ── lanes ─────────────────────────────────────────────────────────────────────

def test_lane_deterministic_for_size_and_verbatim_recall():
    assert si.assign_review_lane({"type": "size", "answer_json": {"shares": 40}}) == "deterministic"
    assert si.assign_review_lane({"type": "recall", "source_kind": "glossary",
                                  "reveal_json": {"quote": "The firm's six-station cycle"}}) == "deterministic"
    assert si.assign_review_lane({"type": "recall", "source_kind": "glossary", "reveal_json": {}}) == "manual"


def test_lane_fast_for_agreeing_signals_second_look_for_disagreement_or_expired():
    agree = {"type": "spot", "reveal_json": {"signals": [{"name": "detector", "verdict": "yes"},
                                                        {"name": "outcome", "verdict": "yes"}]}}
    disagree = {"type": "spot", "reveal_json": {"signals": [{"name": "detector", "verdict": "yes"},
                                                           {"name": "vision", "verdict": "no"}]}}
    assert si.assign_review_lane(agree) == "fast"
    assert si.assign_review_lane(disagree) == "second_look"
    assert si.assign_review_lane({"type": "next", "reveal_json": {"outcome": "expired", "signals": [
        {"verdict": "up"}, {"verdict": "up"}]}}) == "second_look"
    assert si.assign_review_lane({"type": "spot", "reveal_json": {"disagreement": True}}) == "second_look"
    assert si.assign_review_lane({"type": "spot", "reveal_json": {}}) == "manual"
    assert set(si.LANES) == {"deterministic", "fast", "second_look", "manual"}


def test_check_item_collects_every_flag_and_the_lane():
    it = _item(prompt_json={"q": "In this scenario, what is a bid!"},
               lesson_text="The spread was 0.5%, or 7 ticks — easy.")
    out = si.check_item(it, [{"id": "si_z", "skill_id": "f1.basics",
                              "prompt_json": {"q": "In this scenario, what is a bid!"}}])
    kinds = {f.split(":")[0].split(" (")[0] for f in out["flags"]}
    assert kinds == {"ungrounded number", "voice", "near-duplicate of si_z"} and out["lane"] == "manual"
    assert out["near_dup"] == {"id": "si_z", "score": 1.0}
    assert si.check_item(_item())["flags"] == []


# ── router integration: a failing item is stored as a draft with its flags ──

@pytest.fixture()
def push_client(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    monkeypatch.setenv("PUSH_SECRET", "test-secret-123")
    ss.init_db()
    app = FastAPI()
    app.include_router(study_router.router)
    c = TestClient(app)
    c.headers.update({"Authorization": "Bearer test-secret-123"})
    return c


def test_import_stores_a_failing_item_as_a_flagged_draft_and_reports_it(push_client):
    good = _item(id="si_good")
    bad = _item(id="si_bad", prompt_json={"q": "How wide was the spread?"},
                lesson_text="The spread was 0.5%, or 7 ticks.")
    dup = _item(id="si_dup", prompt_json={"q": "What is a bid?", "choices": ["a", "b"]}, lesson_text=None)
    r = push_client.post("/api/study/import", json={"items": [good, bad, dup]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["inserted"] == 3
    assert [f["id"] for f in out["flagged"]] == ["si_bad", "si_dup"]
    assert out["flagged"][0]["flags"] == ["ungrounded number (lesson_text: 7)"]
    assert out["flagged"][1]["flags"] == ["near-duplicate of si_good (1.0)"]
    row_bad = ss.get_item_full("si_bad")
    assert row_bad["review_status"] == "draft"
    assert row_bad["import_flags"] == ["ungrounded number (lesson_text: 7)"]
    assert ss.get_item_full("si_good")["import_flags"] is None
    # the near-dup diff also runs against items ALREADY in the store
    again = push_client.post("/api/study/import", json={"items": [_item(id="si_dup2")]}).json()
    assert again["flagged"][0]["flags"][0].startswith("near-duplicate of si_")


def test_import_assigns_the_lane_unless_the_bank_names_one(push_client):
    size = {"id": "si_size", "type": "size", "skill_id": "size.formula",
            "prompt_json": {"q": "How many shares?"}, "answer_json": {"shares": 40}}
    named = {**_item(id="si_named"), "review_lane": "second_look"}
    push_client.post("/api/study/import", json={"items": [size, named]})
    assert ss.get_item_full("si_size")["review_lane"] == "deterministic"
    assert ss.get_item_full("si_named")["review_lane"] == "second_look"


def test_import_accepts_embedded_fixture_bars(push_client):
    bars = [{"t": 20220712 + i, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(3)]
    it = {"id": "si_fx", "type": "spot", "skill_id": "setup.family3.kicker",
          "prompt_json": {"q": "Is this a kicker?"}, "answer_json": {"answer": "yes"},
          "bars_embed": {"sym": "aapl", "tf": "D", "asof": "2022-07-14", "bars": bars}}
    out = push_client.post("/api/study/import", json={"items": [it]}).json()
    assert out["inserted"] == 1 and out["misses"] == []
    row = ss.get_item_full("si_fx")
    assert row["sym"] == "AAPL" and row["bars_ref"] == "sb_si_fx" and row["asof"] == "2022-07-14"
    ss.approve("si_fx", "owner")
    assert ss.get_visible_bars("si_fx")["bars"] == bars


def test_import_flags_are_never_served_to_a_member():
    assert "import_flags" not in ss._PROMPT_FIELDS
