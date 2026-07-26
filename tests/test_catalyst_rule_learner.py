"""Nightly rule-learner: distill owner notes → durable curator rules.

Safety-critical behaviors under test: watermark advances once per note, dedup
against existing rules, active-rule cap, contradiction-driven retirement, the
LLM/cost failure paths that must NOT advance the watermark, curator application,
and never-raise.
"""
import json

import pytest

from api.services.catalyst import store, rule_learner, curator


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "catalysts.db"))
    store._init_db()
    monkeypatch.setenv("CATALYST_RULE_LEARNER_ENABLED", "1")
    monkeypatch.setenv("CATALYST_LEARNED_RULES_ENABLED", "1")
    monkeypatch.setenv("CATALYST_RULE_LEARNER_DISCORD", "0")   # no webhook in tests
    # cost gate always open + no real cost recording
    monkeypatch.setattr(rule_learner.cost_guard, "may_synthesize", lambda md: True)
    monkeypatch.setattr(rule_learner.cost_guard, "record", lambda *a, **k: None)
    yield


def _note(ticker, text, md="2026-07-24"):
    store.record_feedback(user_id="owner", market_date=md, ticker=ticker, note=text)


def _mock_llm(monkeypatch, new_rules=None, retire_ids=None):
    def fake(prompt):
        return {"new_rules": new_rules or [], "retire_ids": retire_ids or [],
                "_in_tok": 100, "_out_tok": 50}
    monkeypatch.setattr(rule_learner, "_call_llm", fake)


# ── watermark ───────────────────────────────────────────────────────────
def test_disabled_is_noop(monkeypatch):
    monkeypatch.setenv("CATALYST_RULE_LEARNER_ENABLED", "0")
    _note("SAFT", "cut done cash deals")
    out = rule_learner.run_learn()
    assert out["enabled"] is False
    assert store.get_active_learned_rules() == []


def test_no_new_notes_advances_run_time_only(monkeypatch):
    _mock_llm(monkeypatch)
    out = rule_learner.run_learn(now=1000)
    assert out["reviewed"] == 0
    assert store.get_learn_state()["last_run_at"] == 1000


def test_learns_a_rule_and_advances_watermark(monkeypatch):
    _note("SAFT", "acquisition news is dead, nothing to trade after the deal price is set")
    _mock_llm(monkeypatch, new_rules=[
        {"rule": "Cut completed all-cash acquisitions — the trade is over once the deal price is fixed.",
         "rationale": "owner note on SAFT"}])
    out = rule_learner.run_learn(now=2000)
    assert len(out["learned"]) == 1
    rules = store.get_active_learned_rules()
    assert len(rules) == 1 and "all-cash acquisitions" in rules[0]["rule_text"]
    # watermark advanced to the note's created_at, so a second run re-reads nothing
    out2 = rule_learner.run_learn(now=3000)
    assert out2["reviewed"] == 0


def test_note_only_processed_once(monkeypatch):
    _note("XYZ", "stop showing me low-float squeezes")
    _mock_llm(monkeypatch, new_rules=[{"rule": "Cut low-float squeeze pumps.", "rationale": "x"}])
    rule_learner.run_learn(now=2000)
    # second run, same note → LLM should see zero new notes (not re-learn)
    seen = {}
    def fake(prompt):
        seen["called"] = True
        return {"new_rules": [], "retire_ids": [], "_in_tok": 0, "_out_tok": 0}
    monkeypatch.setattr(rule_learner, "_call_llm", fake)
    rule_learner.run_learn(now=3000)
    assert "called" not in seen


# ── dedup ───────────────────────────────────────────────────────────────
def test_dedup_skips_near_duplicate(monkeypatch):
    store.add_learned_rule("Cut completed all-cash acquisitions once the deal price is fixed.", "seed")
    _note("SAFT", "same thing again")
    _mock_llm(monkeypatch, new_rules=[
        {"rule": "Cut completed all-cash acquisitions when the deal price is fixed.", "rationale": "dup"}])
    out = rule_learner.run_learn(now=2000)
    assert out["skipped_dup"] == 1
    assert len(store.get_active_learned_rules()) == 1   # no duplicate added


# ── cap ─────────────────────────────────────────────────────────────────
def test_cap_retires_oldest(monkeypatch):
    monkeypatch.setenv("CATALYST_LEARNED_RULES_MAX", "3")
    for i in range(3):
        store.add_learned_rule(f"existing rule number {i} about topic {i}", "seed")
    _note("NEW", "a brand new distinct preference about biotech runners")
    _mock_llm(monkeypatch, new_rules=[
        {"rule": "Rank biotech phase-3 runners higher on real volume.", "rationale": "new"}])
    rule_learner.run_learn(now=2000)
    active = store.get_active_learned_rules(limit=50)
    assert len(active) == 3          # cap held
    texts = " ".join(r["rule_text"] for r in active)
    assert "biotech" in texts        # new rule kept
    assert "number 0" not in texts   # oldest retired


# ── contradiction / retirement ──────────────────────────────────────────
def test_retires_contradicted_rule(monkeypatch):
    rid = store.add_learned_rule("Always cut all M&A names.", "old broad rule")
    _note("RUMR", "actually keep rumored/contested takeovers, those still have action")
    _mock_llm(monkeypatch,
              new_rules=[{"rule": "Keep live/speculative M&A (rumors, contested bids); cut only done cash deals.",
                          "rationale": "refine"}],
              retire_ids=[rid])
    rule_learner.run_learn(now=2000)
    active_ids = {r["id"] for r in store.get_active_learned_rules()}
    assert rid not in active_ids                       # old broad rule retired
    assert any("speculative" in r["rule_text"] for r in store.get_active_learned_rules())


# ── failure paths must NOT advance the watermark ─────────────────────────
def test_llm_failure_does_not_advance_watermark(monkeypatch):
    _note("SAFT", "cut done deals")
    monkeypatch.setattr(rule_learner, "_call_llm", lambda p: None)
    before = store.get_learn_state()["last_note_ts"]
    rule_learner.run_learn(now=2000)
    assert store.get_learn_state()["last_note_ts"] == before   # notes retried next run


def test_cost_cap_defers(monkeypatch):
    _note("SAFT", "cut done deals")
    monkeypatch.setattr(rule_learner.cost_guard, "may_synthesize", lambda md: False)
    before = store.get_learn_state()["last_note_ts"]
    out = rule_learner.run_learn(now=2000)
    assert out["learned"] == []
    assert store.get_learn_state()["last_note_ts"] == before   # deferred


def test_run_never_raises(monkeypatch):
    _note("SAFT", "boom")
    def boom(p):
        raise RuntimeError("llm exploded")
    monkeypatch.setattr(rule_learner, "_call_llm", boom)
    out = rule_learner.run_learn(now=2000)   # must swallow
    assert out["learned"] == []


# ── curator application ──────────────────────────────────────────────────
def test_curator_reads_active_rules(monkeypatch):
    store.add_learned_rule("Cut completed all-cash acquisitions.", "seed")
    block = curator._learned_rules_block()
    assert "LEARNED RULES" in block
    assert "all-cash acquisitions" in block


def test_curator_ignores_rules_when_reader_disabled(monkeypatch):
    monkeypatch.setenv("CATALYST_LEARNED_RULES_ENABLED", "0")
    store.add_learned_rule("Cut completed all-cash acquisitions.", "seed")
    assert curator._learned_rules_block() == ""


def test_new_rule_changes_pool_hash(monkeypatch):
    pool = [{"ticker": "NVDA", "gap_pct": 5.0, "vol_x": 2.0, "tag": "Catalyst"}]
    before = curator._pool_hash(pool)
    store.add_learned_rule("Cut completed all-cash acquisitions.", "seed")
    assert curator._pool_hash(pool) != before


def test_retire_removes_from_curator(monkeypatch):
    rid = store.add_learned_rule("Cut completed all-cash acquisitions.", "seed")
    assert "all-cash" in curator._learned_rules_block()
    store.retire_learned_rule(rid)
    assert curator._learned_rules_block() == ""
