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
    monkeypatch.setattr(retention, "SPAWN", lambda fn: fn())     # the background prune runs inline in tests
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


@pytest.mark.parametrize("v", ["", "0", "-3", "abc", "99999", "1", "7", "29"])          # review #794 B2: floor 30
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
    monkeypatch.setattr(retention, "prune", lambda c, d, now=None, lock=None: calls.append(d) or {})
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


# ── review #794: batches, floor, pinned chats, fixed clock, no connection when off, no orphans ─────────────────────
NOW = 1_800_000_000.0


def _turn_at(cid, created_at, text="x"):
    import contextlib
    store.add_turn("u1", cid, "member", text)
    with contextlib.closing(store._connect()) as c:
        c.execute("UPDATE agent_turns SET created_at = ? WHERE id = (SELECT MAX(id) FROM agent_turns)", (int(created_at),))
        c.execute("UPDATE agent_conversations SET updated_at = ? WHERE id = ?", (int(created_at), cid))
        c.commit()


def test_review794_fixed_clock_boundary_exactly_n_days_is_kept_one_second_more_is_deleted(db):
    kept, gone = store.create_conversation("u1", "kept"), store.create_conversation("u1", "gone")
    _turn_at(kept, NOW - 30 * 86400, "exactly 30 days")
    _turn_at(gone, NOW - 30 * 86400 - 1, "30 days + 1 s")
    res = retention.prune(store._connect, 30, now=NOW)
    assert [r["text"] for r in _rows(kept)] == ["exactly 30 days"] and _rows(gone) == []
    assert res["turns"] == 1


def test_review794_deletes_in_batches_and_checkpoints(db):
    cid = store.create_conversation("u1", "big")
    for i in range(7):
        _turn_at(cid, NOW - 40 * 86400, f"old {i}")
    seen = []

    class Lock:
        def __enter__(self):
            seen.append("lock")

        def __exit__(self, *a):
            return False
    res = retention.prune(store._connect, 30, now=NOW, lock=Lock(), batch=3)
    assert res["turns"] == 7 and seen.count("lock") >= 4          # 3 + 3 + 1 (+ the conversation sweep)
    import contextlib
    with contextlib.closing(store._connect()) as c:
        idx = {r[1] for r in c.execute("PRAGMA index_list(agent_turns)")}
    assert "ix_agent_turns_created" in idx


def test_review794_pinned_chats_are_exempt_by_default(db):
    pinned = store.create_conversation("u1", "pinned")
    _turn_at(pinned, NOW - 400 * 86400, "kept forever while pinned")
    store.set_pinned("u1", pinned, True)
    import contextlib
    with contextlib.closing(store._connect()) as c:
        c.execute("UPDATE agent_conversations SET updated_at = ? WHERE id = ?", (int(NOW - 400 * 86400), pinned))
        c.commit()
    retention.prune(store._connect, 30, now=NOW)
    assert [r["text"] for r in _rows(pinned)] == ["kept forever while pinned"] and store.owns("u1", pinned)


def test_review794_no_orphan_turns_after_a_prune(db):
    for k in range(3):
        cid = store.create_conversation("u1", f"c{k}")
        _turn_at(cid, NOW - (10 + 20 * k) * 86400)
        _turn_at(cid, NOW - (40 + 20 * k) * 86400)
    retention.prune(store._connect, 30, now=NOW)
    import contextlib
    with contextlib.closing(store._connect()) as c:
        orphans = c.execute("SELECT COUNT(*) FROM agent_turns t WHERE NOT EXISTS "
                            "(SELECT 1 FROM agent_conversations c WHERE c.id = t.conversation_id)").fetchone()[0]
        empties = c.execute("SELECT COUNT(*) FROM agent_conversations c WHERE pinned_at IS NULL AND updated_at < ? AND "
                            "NOT EXISTS (SELECT 1 FROM agent_turns t WHERE t.conversation_id = c.id)",
                            (int(NOW - 30 * 86400),)).fetchone()[0]
    assert orphans == 0 and empties == 0


def test_review794_the_off_path_opens_no_connection():
    def boom():
        raise AssertionError("no connection may be opened while the switch is off")
    assert retention.maybe_prune(boom) is False


def test_review794_a_value_below_the_floor_is_refused_and_logged_once(monkeypatch, caplog):
    retention._reset_for_test()
    monkeypatch.setenv(retention.DAYS_ENV, "7")
    caplog.set_level(logging.WARNING)
    assert retention.transcript_days() is None and retention.transcript_days() is None
    assert sum("refused" in r.getMessage() for r in caplog.records) == 1
    def boom():
        raise AssertionError("refused value: no prune")
    assert retention.maybe_prune(boom) is False


def test_review794_the_prune_runs_off_the_request_path(db, monkeypatch):
    monkeypatch.setenv(retention.DAYS_ENV, "30")
    spawned = []
    monkeypatch.setattr(retention, "SPAWN", lambda fn: spawned.append(fn))
    monkeypatch.setattr(retention, "prune", lambda *a, **k: (_ for _ in ()).throw(AssertionError("not inline")))
    cid = store.create_conversation("u1", "x")
    store.add_turn("u1", cid, "member", "x")                     # returns without running the prune
    assert len(spawned) == 1



def test_review794_concurrent_writes_during_a_prune_all_succeed(db):
    import threading
    old = store.create_conversation("u1", "old")
    real_now = time.time()                       # writers stamp the real clock, so the prune uses it too
    for i in range(60):
        _turn_at(old, real_now - 40 * 86400, f"old {i}")
    live = store.create_conversation("u1", "live")
    errors, ids = [], []

    def writer(k):
        for i in range(15):
            try:
                ids.append(store.add_turn("u1", live, "member", f"w{k}-{i}"))
            except Exception as e:  # noqa: BLE001
                errors.append(repr(e))
    ts = [threading.Thread(target=writer, args=(k,)) for k in range(4)]
    pr = threading.Thread(target=lambda: retention.prune(store._connect, 30, now=real_now, lock=store._WRITE_LOCK, batch=5))
    [t.start() for t in ts]
    pr.start()
    [t.join() for t in ts]
    pr.join()
    assert errors == [] and len(ids) == 60
    assert _rows(old) == [] and len(_rows(live)) == 60


def test_review794_index_and_checkpoint_run_under_the_write_lock(db):
    events = []

    class Lock:
        def __enter__(self):
            events.append("in")

        def __exit__(self, *a):
            events.append("out")
            return False
    import contextlib
    real = store._connect

    def spy():
        c = real()

        class Wrapped:
            def __getattr__(self, n):
                return getattr(c, n)

            def execute(self, sql, *a):
                if "CREATE INDEX" in sql or "wal_checkpoint" in sql:
                    events.append(("inside" if events and events[-1] == "in" else "OUTSIDE", sql.split()[0] + " " + sql.split()[1]))
                return c.execute(sql, *a)

            def close(self):
                c.close()
        return Wrapped()
    retention.prune(spy, 30, now=NOW, lock=Lock())
    assert [e for e in events if isinstance(e, tuple)] == [("inside", "CREATE INDEX"), ("inside", "PRAGMA wal_checkpoint(TRUNCATE)")]
    del contextlib


def test_review794_switch_off_changes_no_schema(db):
    import contextlib
    cid = store.create_conversation("u1", "x")
    store.add_turn("u1", cid, "member", "x")
    with contextlib.closing(store._connect()) as c:
        idx = {r[1] for r in c.execute("PRAGMA index_list(agent_turns)")}
    assert "ix_agent_turns_created" not in idx
