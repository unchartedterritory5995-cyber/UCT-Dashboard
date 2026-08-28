"""The durable Batch ledger (2026-08-28 cost census).

What is being protected: a pending batch is money already committed. It must
survive the several-times-daily redeploy, be keyed by custom_id (results come
back unordered), and never grow a tail of zombies.
"""
import importlib
import json
import time

import pytest


@pytest.fixture
def lb(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_BATCH_ENABLED", "1")
    monkeypatch.setenv("LLM_BATCH_LEDGER_PATH", str(tmp_path / "batches.json"))
    import api.services.llm_batch as m
    importlib.reload(m)
    return m


class _Batches:
    def __init__(self, status="ended", results=None, batch_id="b1"):
        self.status, self._results, self.batch_id = status, results or [], batch_id
        self.created = []

    def create(self, requests):
        self.created.append(list(requests))
        return type("B", (), {"id": self.batch_id})()

    def retrieve(self, bid):
        return type("B", (), {"processing_status": self.status})()

    def results(self, bid):
        return list(self._results)


def _client_with(batches):
    return type("C", (), {"messages": type("M", (), {"batches": batches})()})()


def _result(cid, text=None, rtype="succeeded"):
    msg = None
    if text is not None:
        msg = type("Msg", (), {
            "content": [type("B", (), {"type": "text", "text": text})()],
            "usage": type("U", (), {"input_tokens": 10, "output_tokens": 2})(),
            "stop_reason": "end_turn"})()
    return type("R", (), {
        "custom_id": cid,
        "result": type("Res", (), {"type": rtype, "message": msg})()})()


def test_a_pending_batch_survives_a_restart(lb, monkeypatch, tmp_path):
    """The whole reason the ledger is a FILE: an in-memory batch id is a paid
    result nobody ever collects on a pod that redeploys several times a day."""
    monkeypatch.setattr(lb, "_client", lambda: _client_with(_Batches()))
    lb.submit("call_recap", [{"custom_id": "DIS|Q3", "params": {}}],
              {"DIS|Q3": {"symbol": "DIS"}})
    importlib.reload(lb)                    # stand in for a fresh process
    monkeypatch.setenv("LLM_BATCH_LEDGER_PATH", str(tmp_path / "batches.json"))
    rows = lb.pending("call_recap")
    assert len(rows) == 1 and rows[0]["meta"]["DIS|Q3"]["symbol"] == "DIS"


def test_results_are_handed_over_keyed_by_custom_id_with_their_submit_meta(lb, monkeypatch):
    batches = _Batches(results=[_result("AAPL|Q3", '{"ok":1}'), _result("DIS|Q3", '{"ok":2}')])
    monkeypatch.setattr(lb, "_client", lambda: _client_with(batches))
    lb.submit("s", [{"custom_id": "DIS|Q3", "params": {}},
                    {"custom_id": "AAPL|Q3", "params": {}}],
              {"DIS|Q3": {"symbol": "DIS"}, "AAPL|Q3": {"symbol": "AAPL"}})
    seen = {}
    out = lb.reap("s", lambda cid, msg, meta: seen.__setitem__(cid, meta.get("symbol")))
    # results arrived in the OPPOSITE order to submission — identity must ride
    # the custom_id, never the position
    assert seen == {"AAPL|Q3": "AAPL", "DIS|Q3": "DIS"}
    assert out["succeeded"] == 2 and out["batches"] == 1
    assert lb.pending("s") == []            # collected rows leave the ledger


def test_a_still_running_batch_is_left_in_the_ledger(lb, monkeypatch):
    monkeypatch.setattr(lb, "_client", lambda: _client_with(_Batches(status="in_progress")))
    lb.submit("s", [{"custom_id": "A", "params": {}}], {"A": {}})
    out = lb.reap("s", lambda *a: None)
    assert out["pending"] == 1 and len(lb.pending("s")) == 1


def test_an_errored_result_reaches_the_handler_as_None(lb, monkeypatch):
    batches = _Batches(results=[_result("A", None, rtype="errored")])
    monkeypatch.setattr(lb, "_client", lambda: _client_with(batches))
    lb.submit("s", [{"custom_id": "A", "params": {}}], {"A": {}})
    seen = []
    out = lb.reap("s", lambda cid, msg, meta: seen.append(msg))
    assert seen == [None] and out["errored"] == 1


def test_one_bad_handler_never_drops_the_rest(lb, monkeypatch):
    batches = _Batches(results=[_result("A", "{}"), _result("B", "{}")])
    monkeypatch.setattr(lb, "_client", lambda: _client_with(batches))
    lb.submit("s", [{"custom_id": "A", "params": {}}, {"custom_id": "B", "params": {}}],
              {"A": {}, "B": {}})
    ok = []

    def handle(cid, msg, meta):
        if cid == "A":
            raise RuntimeError("boom")
        ok.append(cid)

    lb.reap("s", handle)
    assert ok == ["B"]


def test_a_zombie_batch_is_abandoned_not_retried_forever(lb, monkeypatch):
    monkeypatch.setattr(lb, "_client", lambda: _client_with(_Batches(status="in_progress")))
    lb.submit("s", [{"custom_id": "A", "params": {}}], {"A": {}})
    rows = lb._read()
    rows[0]["created_at"] = time.time() - (lb.MAX_AGE_HOURS + 1) * 3600
    lb._write(rows)
    out = lb.reap("s", lambda *a: None)
    assert out["abandoned"] == 1 and lb.pending("s") == []


def test_the_kill_switch_makes_submit_return_None(lb, monkeypatch):
    monkeypatch.setenv("LLM_BATCH_ENABLED", "0")
    called = []
    monkeypatch.setattr(lb, "_client", lambda: called.append(1))
    assert lb.submit("s", [{"custom_id": "A", "params": {}}], {}) is None
    assert not called                       # never even builds a client


def test_an_unserializable_ledger_does_not_truncate_the_pending_one(lb, monkeypatch):
    """encode BEFORE the write: open(w) empties the file before a failing
    serialization can be caught, which would lose every pending batch id."""
    monkeypatch.setattr(lb, "_client", lambda: _client_with(_Batches()))
    lb.submit("s", [{"custom_id": "A", "params": {}}], {"A": {}})
    lb._write([{"batch_id": "x", "meta": {"A": {"bad": object()}}}])
    assert len(lb.pending("s")) == 1        # the good ledger is still there


def test_a_corrupt_ledger_reads_as_empty_instead_of_raising(lb):
    import os
    with open(os.environ["LLM_BATCH_LEDGER_PATH"], "w", encoding="utf-8") as f:
        f.write("{not json")
    assert lb.pending() == []
