"""Track C safeguard (c): transcript retention (PR #748 design P2 + P5 + P7) as code behind switches that default OFF.
Brain stays OFF; with both switches unset, store.add_turn writes exactly what it wrote before (tested)."""
from __future__ import annotations

import json
import logging
import time

import pytest

from api.services.uct_agent import retention, store, turn

ANSWER = ("From UCT's knowledge base (UCT's playbook as of Nov 1, 2026):\n"
          "• UCT team playbook: patience: Wait for your pitch; ZQXSENTINEL passage text. (UCT KB #12 · the UCT team playbook)\n"
          "• UCT team playbook: EP: A gap on a fresh catalyst. (UCT KB #2 · the UCT team playbook)\n"
          "Sources: UCT playbook pack of Nov 1, 2026 · source policy v6. Educational, from UCT's approved knowledge base — not advice.")
DATA = {"kind": "answered", "actions": ["playbook.explain"], "views": [{"text": ANSWER, "table": {"rows": [["a", "b"]]}}],
        "lines": [ANSWER]}
RECORD = ("Episodic Pivot — UCT's historical record (UCT's playbook as of Nov 1, 2026).\n"
          "• the brain's own logged trades: n = 40, win rate 55% (95% interval 39.8–69.3%), calculated Nov 3, 2026. x.")


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "agent.db"))
    store._reset_for_tests()
    retention._reset_for_test()
    for k in (retention.KN_FLAG, retention.DAYS_ENV):
        monkeypatch.delenv(k, raising=False)
    yield
    store._reset_for_tests()


def _rows(cid):
    import contextlib
    with contextlib.closing(store._connect()) as c:
        return [dict(r) for r in c.execute("SELECT role, text, data_json, created_at FROM agent_turns "
                                           "WHERE conversation_id = ? ORDER BY id", (cid,))]


# ── switches off: nothing changes ───────────────────────────────────────────────────────────────────────────────
def test_off_by_default_the_row_is_written_exactly_as_before(db):
    assert retention.kn_retention_on() is False and retention.transcript_days() is None
    cid = store.create_conversation("u1", "what is an EP")
    store.add_turn("u1", cid, "outcome", ANSWER, DATA)
    r = _rows(cid)[0]
    assert r["text"] == ANSWER and json.loads(r["data_json"]) == DATA
    assert retention.on_write("outcome", ANSWER, DATA) == (ANSWER, DATA)


@pytest.mark.parametrize("v", ["", "0", "off", "no", "2"])
def test_only_explicit_on_values_switch_it_on(monkeypatch, v):
    monkeypatch.setenv(retention.KN_FLAG, v)
    assert retention.kn_retention_on() is False


@pytest.mark.parametrize("v", ["", "0", "-3", "abc", "99999"])
def test_transcript_days_needs_a_sane_number(monkeypatch, v):
    monkeypatch.setenv(retention.DAYS_ENV, v)
    assert retention.transcript_days() is None


# ── P2: citations, not text ─────────────────────────────────────────────────────────────────────────────────────
def test_on_a_knowledge_answer_row_is_stored_as_a_citation_only(db, monkeypatch):
    monkeypatch.setenv(retention.KN_FLAG, "1")
    cid = store.create_conversation("u1", "what is an EP")
    store.add_turn("u1", cid, "outcome", ANSWER, DATA)
    r = _rows(cid)[0]
    assert r["text"] == "Answered from UCT's approved knowledge base (UCT KB #2, #12)."
    d = json.loads(r["data_json"])
    assert d == {"kind": "answered", "actions": ["playbook.explain"],
                 "kn": {"kb_ids": [2, 12], "templates": [], "setups": [], "policy_version": 6, "stored": "citation_only"}}
    assert "ZQXSENTINEL" not in json.dumps(_rows(cid))
    assert store.search_turns("u1", "ZQXSENTINEL") == [] and store.search_turns("u1", "patience") == []


def test_on_a_setup_record_row_keeps_no_figures(db, monkeypatch):
    monkeypatch.setenv(retention.KN_FLAG, "1")
    cid = store.create_conversation("u1", "EP record")
    store.add_turn("u1", cid, "outcome", RECORD, {"kind": "answered", "actions": ["playbook.record"]})
    r = _rows(cid)[0]
    assert r["text"] == "Answered from UCT's approved knowledge base (setup record: Episodic Pivot)."
    for fig in ("55%", "39.8", "n = 40"):
        assert fig not in json.dumps(r)


def test_on_a_template_row_cites_the_template(db, monkeypatch):
    monkeypatch.setenv(retention.KN_FLAG, "1")
    text = "From UCT's playbook — Episodic Pivot: UCT setup template.\nEntry: opening range high\nCited: template “Episodic Pivot”, x."
    line, meta = retention.on_write("outcome", text, {"kind": "answered", "actions": ["playbook.setup"], "views": [1]})
    assert line == "Answered from UCT's approved knowledge base (template “Episodic Pivot”)." and "views" not in meta


@pytest.mark.parametrize("role,data", [
    ("outcome", {"kind": "answered", "actions": ["chart.setType"]}), ("agent", {"actions": ["playbook.explain"]}),
    ("member", None), ("outcome", None), ("outcome", {"actions": "playbook.explain"}),
])
def test_on_other_rows_are_untouched(monkeypatch, role, data):
    monkeypatch.setenv(retention.KN_FLAG, "1")
    assert retention.on_write(role, ANSWER, data) == (ANSWER, data)


def test_on_a_citation_row_replays_as_the_existing_knowledge_stub(db, monkeypatch):
    monkeypatch.setenv(retention.KN_FLAG, "1")
    cid = store.create_conversation("u1", "q")
    store.add_turn("u1", cid, "outcome", ANSWER, DATA)
    r = _rows(cid)[0]
    msgs = turn.history_messages([{"role": "outcome", "text": r["text"], "data": json.loads(r["data_json"])}])
    assert "ZQXSENTINEL" not in json.dumps(msgs)


def test_the_citation_line_is_bounded():
    many = " ".join(f"(UCT KB #{i} · x)" for i in range(1, 60))
    line, meta = retention.citation(many, {"actions": ["playbook.explain"]})
    assert len(line) <= retention.CITATION_MAX and len(meta["kn"]["kb_ids"]) == 20


# ── P7: transcript age limit ────────────────────────────────────────────────────────────────────────────────────
def _age(cid, days):
    import contextlib
    old = int(time.time() - days * 86400)
    with contextlib.closing(store._connect()) as c:
        c.execute("UPDATE agent_turns SET created_at = ? WHERE conversation_id = ?", (old, cid))
        c.execute("UPDATE agent_conversations SET updated_at = ? WHERE id = ?", (old, cid))
        c.commit()


def test_prune_off_by_default_keeps_everything(db):
    cid = store.create_conversation("u1", "old chat")
    store.add_turn("u1", cid, "member", "hello")
    _age(cid, 400)
    store.add_turn("u1", store.create_conversation("u1", "new"), "member", "hi")
    assert len(_rows(cid)) == 1 and store.owns("u1", cid)


def test_prune_deletes_old_rows_and_empty_old_conversations_only(db, monkeypatch):
    old = store.create_conversation("u1", "old chat")
    store.add_turn("u1", old, "member", "hello")
    _age(old, 40)
    mixed = store.create_conversation("u1", "mixed")
    store.add_turn("u1", mixed, "member", "old part")
    _age(mixed, 40)
    store.add_turn("u1", mixed, "member", "new part")
    monkeypatch.setenv(retention.DAYS_ENV, "30")
    store.add_turn("u1", store.create_conversation("u1", "trigger"), "member", "x")    # the write that prunes
    assert _rows(old) == [] and not store.owns("u1", old)
    assert [r["text"] for r in _rows(mixed)] == ["new part"] and store.owns("u1", mixed)


def test_prune_runs_at_most_once_an_hour(db, monkeypatch):
    monkeypatch.setenv(retention.DAYS_ENV, "30")
    calls = []
    monkeypatch.setattr(retention, "prune", lambda c, d, now=None: calls.append(d) or {})
    cid = store.create_conversation("u1", "x")
    for _ in range(5):
        store.add_turn("u1", cid, "member", "x")
    assert calls == [30]


def test_a_failed_prune_never_fails_the_write(db, monkeypatch):
    monkeypatch.setenv(retention.DAYS_ENV, "30")
    monkeypatch.setattr(retention, "prune", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("disk")))
    cid = store.create_conversation("u1", "x")
    assert store.add_turn("u1", cid, "member", "x") > 0


# ── P5: no passage text in logs (independent of the switches) ───────────────────────────────────────────────────
def test_no_passage_text_reaches_a_log_record(db, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    for on in ("", "1"):
        monkeypatch.setenv(retention.KN_FLAG, on)
        monkeypatch.setenv(retention.DAYS_ENV, "30")
        retention._reset_for_test()
        cid = store.create_conversation("u1", "q")
        store.add_turn("u1", cid, "outcome", ANSWER, DATA)
        turn.history_messages([{"role": "outcome", "text": ANSWER, "data": DATA}])
    assert not any("ZQXSENTINEL" in r.getMessage() for r in caplog.records)
