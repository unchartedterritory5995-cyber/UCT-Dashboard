"""The 2026-11-10 AI-spend phase 2: half-price Batch lanes for the earnings PREVIEW
warm and for pattern vision, the pattern-vision reference-chart cache, and the
5.5-family rows in the catalyst price table. Every model call is faked; nothing
here spends."""
from __future__ import annotations

import importlib
import json
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services import daily_counters, earnings_ai_store as store, engine, llm_batch
from api.services.cache import cache

DAY = "2026-11-05"
SYM = "PL"
COMPLETE = {k: None for k in engine._ENRICHMENT_LEG_KEYS}
REPLY = '{"preview": "A real preview.", "bullets": ["a", "b", "c"]}'


def _msg(text, inp=1000, out=200, cr=0, cw=0):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)], model="claude-sonnet-5",
        usage=SimpleNamespace(input_tokens=inp, output_tokens=out, cache_read_input_tokens=cr,
                              cache_creation_input_tokens=cw, server_tool_use=None))


# ── catalyst price table ─────────────────────────────────────────────────────

def test_catalyst_guard_prices_the_55_family_at_their_own_rates():
    from api.services.catalyst import cost_guard
    assert cost_guard.estimate_cost("claude-opus-5-5", 1_000_000, 0) == pytest.approx(4.0)
    assert cost_guard.estimate_cost("claude-opus-5-5", 0, 1_000_000) == pytest.approx(20.0)
    # Without its row Haiku 5.5 fell to the priciest (Fable) rate, ~100x over.
    assert cost_guard.estimate_cost("claude-haiku-5-5", 1_000_000, 1_000_000) == pytest.approx(0.60)


# ── llm_batch.reap credits the caller's door ─────────────────────────────────

def test_reap_records_spend_under_the_callers_door(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_BATCH_LEDGER_PATH", str(tmp_path / "b.json"))
    llm_batch._write([{"batch_id": "b1", "surface": "s", "created_at": time.time(), "meta": {"c1": {"x": 1}}}])
    item = SimpleNamespace(custom_id="c1", result=SimpleNamespace(type="succeeded", message=_msg(REPLY)))
    client = MagicMock()
    client.messages.batches.retrieve.return_value = SimpleNamespace(processing_status="ended")
    client.messages.batches.results.return_value = [item]
    monkeypatch.setattr(llm_batch, "_client", lambda: client)
    from api.services import llm_usage
    seen = []
    monkeypatch.setattr(llm_usage, "record_message", lambda m, **kw: seen.append(kw))
    got = []
    out = llm_batch.reap("s", lambda cid, m, meta: got.append((cid, meta)), door="api/services/x.py")
    assert out["succeeded"] == 1 and got == [("c1", {"x": 1})]
    assert seen[0]["door"] == "api/services/x.py" and seen[0]["kind"] == "batch"
    assert llm_batch.pending("s") == []


# ── earnings preview: defer, then finish ─────────────────────────────────────

@pytest.fixture
def warm(tmp_path, monkeypatch):
    from api.services import auth_db, earnings_enrichment, earnings_estimates, narrative_cost_guard
    path = str(tmp_path / "auth.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    monkeypatch.setenv("AUTH_DB_PATH", path)
    monkeypatch.setattr(store, "_DIR", str(tmp_path / "earnings_ai_cache"))
    monkeypatch.setattr(store, "_et_day", lambda: DAY)
    monkeypatch.setattr(engine, "_fetch_quarterly_history", lambda _sym: [])
    monkeypatch.setattr(earnings_estimates, "_fh_get", lambda *_a, **_k: [])
    monkeypatch.setattr(earnings_enrichment, "enrich_earnings_response", lambda *_a, **_k: dict(COMPLETE))
    client = MagicMock()
    client.messages.create.return_value = _msg(REPLY)
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: client)
    billed = []
    monkeypatch.setattr(narrative_cost_guard, "record",
                        lambda surface, model, i=0, o=0, **kw: billed.append((surface, kw.get("cost_usd"))) or 0.0)
    cache.clear()
    yield SimpleNamespace(client=client, billed=billed)
    cache.clear()


def _row():
    return {"sym": SYM, "eps_estimate": 1.0, "date": "2026-11-06", "session": "AMC", "verdict": "Pending"}


def _attempts():
    return daily_counters.value(DAY, f"{store.ATTEMPT_SCOPE}:preview", SYM)


def test_a_warm_preview_defers_to_the_collector_and_writes_nothing(warm):
    taken = []
    token = engine.EARNINGS_BATCH_COLLECTOR.set(lambda *a: taken.append(a) or True)
    try:
        engine._generate_earnings_preview(SYM, _row(), force_fresh_check=True)
    finally:
        engine.EARNINGS_BATCH_COLLECTOR.reset(token)
    assert warm.client.messages.create.call_count == 0
    assert store.read("preview", SYM) is None
    kind, sym, request, meta = taken[0]
    assert (kind, sym) == ("preview", SYM)
    assert request["messages"][0]["role"] == "user" and request["model"]
    assert meta["base"]["signals_hash"] and meta["enrichment_complete"] is True
    json.dumps(meta)                               # rides the batch ledger
    assert _attempts() == 1                        # the claim holds while the batch runs


def test_a_member_click_never_defers(warm):
    token = engine.EARNINGS_BATCH_COLLECTOR.set(lambda *a: pytest.fail("a click must not defer"))
    try:
        engine._generate_earnings_preview(SYM, _row(), force_fresh_check=False)
    finally:
        engine.EARNINGS_BATCH_COLLECTOR.reset(token)
    assert warm.client.messages.create.call_count == 1


def test_a_declining_collector_falls_through_to_the_live_call(warm):
    token = engine.EARNINGS_BATCH_COLLECTOR.set(lambda *a: False)
    try:
        out = engine._generate_earnings_preview(SYM, _row(), force_fresh_check=True)
    finally:
        engine.EARNINGS_BATCH_COLLECTOR.reset(token)
    assert warm.client.messages.create.call_count == 1 and out["preview_text"] == "A real preview."


def test_the_finisher_stores_what_the_live_path_stores_at_the_batch_rate(warm):
    taken = []
    token = engine.EARNINGS_BATCH_COLLECTOR.set(lambda *a: taken.append(a) or True)
    try:
        engine._generate_earnings_preview(SYM, _row(), force_fresh_check=True)
    finally:
        engine.EARNINGS_BATCH_COLLECTOR.reset(token)
    meta = json.loads(json.dumps(taken[0][3]))
    assert engine.finish_earnings_preview(_msg(REPLY), meta, discount=0.5) is True
    stored = store.read("preview", SYM)
    assert stored["preview_text"] == "A real preview." and stored["preview_bullets"] == ["a", "b", "c"]
    assert stored["signals_hash"] == meta["base"]["signals_hash"]
    from api.services import narrative_cost_guard
    full = narrative_cost_guard.estimate_cost("claude-sonnet-5", 1000, 200)
    assert warm.billed[-1] == ("earnings_warm", pytest.approx(full * 0.5))
    assert _attempts() == 0                        # released on success, as live


def test_an_errored_batch_row_frees_the_attempt(warm):
    store.claim_attempt("preview", SYM)
    assert engine.finish_earnings_preview(None, {"sym": SYM}) is False
    assert _attempts() == 0


# ── the warm's collector ─────────────────────────────────────────────────────

def test_the_collector_submits_in_chunks_and_declines_after_close(monkeypatch):
    from api.services import earnings_preview_warm as w
    sent = []
    monkeypatch.setattr(llm_batch, "submit", lambda surface, reqs, meta: sent.append((surface, reqs, meta)) or "b")
    b = w._PreviewBatch(chunk=2)
    for s in ("A", "B", "C"):
        assert b("preview", s, {"model": "m", "messages": []}, {"sym": s}) is True
    assert len(sent) == 1 and len(sent[0][1]) == 2
    b.close()
    assert len(sent) == 2 and sent[1][1][0]["params"] == {"model": "m", "messages": []}
    assert b("preview", "D", {}, {"sym": "D"}) is False      # a straggler goes live
    assert b("analysis", "E", {}, {"sym": "E"}) is False     # analyses never batch
    assert set(sent[0][2]) == {r["custom_id"] for r in sent[0][1]}


def test_a_failed_submit_generates_live_instead_of_leaving_names_cold(monkeypatch):
    from api.services import earnings_preview_warm as w
    monkeypatch.setattr(llm_batch, "submit", lambda *a: None)
    live = []
    monkeypatch.setattr(w, "_live_preview", lambda req, meta: live.append(meta["sym"]))
    b = w._PreviewBatch(chunk=1)
    b("preview", "A", {"model": "m"}, {"sym": "A"})
    assert live == ["A"] and b.live_fallback == 1


def test_batch_lane_rolls_back_with_one_env(monkeypatch):
    from api.services import earnings_preview_warm as w
    monkeypatch.setenv("EARNINGS_WARM_BATCH", "0")
    assert w.preview_batch_enabled() is False
    monkeypatch.setenv("EARNINGS_WARM_BATCH", "1")
    monkeypatch.setenv("LLM_BATCH_ENABLED", "0")
    assert w.preview_batch_enabled() is False


# ── pattern vision ───────────────────────────────────────────────────────────

def test_reference_charts_are_a_cached_prefix_and_the_candidate_is_not():
    from api.services.pattern_vision import vision_judge as vj
    content = vj.build_messages("vcp", b"CAND", example_pngs=[b"EX1", b"EX2"])[0]["content"]
    marked = [i for i, c in enumerate(content) if "cache_control" in c]
    assert marked == [1]                            # the LAST example, nothing after it
    assert content[2]["type"] == "image" and content[-1]["type"] == "text"
    no_ex = vj.build_messages("vcp", b"CAND")[0]["content"]
    assert not any("cache_control" in c for c in no_ex)


def test_cost_counts_cached_prefix_tokens():
    from api.services.pattern_vision import orchestrator as o
    assert o._cost("claude-opus-4-8", 0, 0, cache_read=1_000_000) == pytest.approx(0.5)
    assert o._cost("claude-opus-4-8", 0, 0, cache_write=1_000_000) == pytest.approx(6.25)


def _pv(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    monkeypatch.setenv("LLM_BATCH_LEDGER_PATH", str(tmp_path / "b.json"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    import api.services.pattern_vision.orchestrator as orch
    importlib.reload(orch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6,
                                            "asof_date": "2026-06-19", "key_level": 10.0}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    monkeypatch.setattr(orch, "_example_pngs", lambda setup: [])
    monkeypatch.setattr(orch.vision_judge, "judge", lambda *a, **k: pytest.fail("batch mode called live"))
    return s, orch


def test_batch_mode_queues_the_judgement_instead_of_calling(tmp_path, monkeypatch):
    s, orch = _pv(tmp_path, monkeypatch)
    batch = orch.JudgeBatch()
    out = orch.judge_ticker("NVDA", batch=batch)
    assert out["queued"] == 1 and out["judged"] == 0
    cid, req, meta = batch.items[0]
    assert req["model"] == orch.vision_judge.JUDGE_MODEL == "claude-opus-4-8"
    assert meta["ticker"] == "NVDA" and meta["reserved_usd"] > 0
    # the same slot does not queue it twice
    assert orch.judge_ticker("NVDA", batch=batch)["queued"] == 0


def test_a_candidate_pending_in_an_earlier_batch_is_not_paid_twice(tmp_path, monkeypatch):
    s, orch = _pv(tmp_path, monkeypatch)
    sent = []
    monkeypatch.setattr(llm_batch, "submit", lambda surface, reqs, meta: sent.append(meta) or None)
    first = orch.JudgeBatch()
    orch.judge_ticker("NVDA", batch=first)
    cid, _req, meta = first.items[0]
    llm_batch._write([{"batch_id": "b1", "surface": "pattern_vision", "created_at": 1, "meta": {cid: meta}}])
    second = orch.JudgeBatch()
    out = orch.judge_ticker("NVDA", batch=second)
    assert out["queued"] == 0 and out["skipped"] == 1
    assert second.reserved == pytest.approx(meta["reserved_usd"])


def test_the_hard_cap_counts_what_is_queued_but_not_yet_billed(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "0.0001")
    s, orch = _pv(tmp_path, monkeypatch)
    out = orch.judge_ticker("NVDA", batch=orch.JudgeBatch())
    assert out["cost_capped"] is True and out["queued"] == 0


def test_the_reaper_stores_the_verdict_at_the_batch_rate(tmp_path, monkeypatch):
    s, orch = _pv(tmp_path, monkeypatch)
    batch = orch.JudgeBatch()
    orch.judge_ticker("NVDA", batch=batch)
    cid, _req, meta = batch.items[0]
    llm_batch._write([{"batch_id": "b1", "surface": "pattern_vision", "created_at": time.time(), "meta": {cid: meta}}])
    text = json.dumps({"confirmed": True, "confidence": 90, "reason": "tight", "key_level": 10.5, "checks": []})
    client = MagicMock()
    client.messages.batches.retrieve.return_value = SimpleNamespace(processing_status="ended")
    client.messages.batches.results.return_value = [
        SimpleNamespace(custom_id=cid, result=SimpleNamespace(type="succeeded", message=_msg(text, 1000, 100)))]
    monkeypatch.setattr(llm_batch, "_client", lambda: client)
    out = orch.reap_batches()
    assert out["succeeded"] == 1
    v = s.get_verdict("NVDA", "D", "vcp", "2026-06-19")
    assert v["confirmed"] == 1 and v["signals_hash"] == meta["signals_hash"]
    full = orch._cost("claude-opus-4-8", 1000, 100)
    import datetime
    assert s.cost_today(datetime.date.today().isoformat()) == pytest.approx(full * 0.5)


def test_the_pattern_vision_reaper_registers_on_its_own_and_is_a_noop_when_idle(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_BATCH_LEDGER_PATH", str(tmp_path / "b.json"))
    import api.main as main
    jobs = []
    main.register_pattern_vision_batch_reaper(SimpleNamespace(add_job=lambda f, **kw: jobs.append((f, kw))))
    (func, kw), = jobs
    assert kw["id"] == "pattern_vision_batch_reap" and kw["max_instances"] == 1
    func()                                      # nothing pending: returns quietly
