"""Batch submit / reap rails (stream S-D), driven by a FAKE Anthropic client.

No network in this file. The fake rejects, with a 400-shaped error, exactly what the
real Messages API rejects for claude-opus-5 requests: any sampling parameter
(temperature, top_p, top_k), an assistant prefill, server-side fallbacks (refused on
Batches) and budget_tokens; a structured-output schema with more than 16 union-typed
parameters (measured against the live API 2026-09-13 — batches.create only, since
count_tokens accepted the same schema); and it enforces the Batches custom_id rule
^[a-zA-Z0-9_-]{1,64}$ with uniqueness — its own literal pattern, never the code's.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a request the real API would 400 (the fake is proven to reject each shape first);
2. extraction running with the flag off, before the golden gate accepts the version,
   or past the budget;
3. a second run re-submitting a segment; a dry run that writes or calls anything;
4. a result type mishandled, a stream dying mid-way re-writing records or double
   counting cost, a retry that never gives up;
5. a paid batch orphaned by an ambiguous submit, a 400 retried forever;
6. the reap job not registered at :16/:46 behind WISDOM_EXTRACT_ENABLED; a client
   built without an explicit timeout.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import flags, store, timeutil
from api.services.wisdom.extract import batch, config, golden, jobs, prompt, segmenter

CUSTOM_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


class Rejected(Exception):
    status_code = 400


class APITimeoutError(Exception):
    pass


class BadRequestError(Exception):
    status_code = 400


def _api_check(params: dict) -> None:
    for name in ("temperature", "top_p", "top_k"):
        if name in params:
            raise Rejected(f"{name}: sampling parameters are not supported on this model")
    if "fallbacks" in params:
        raise Rejected("fallbacks is not supported on the Message Batches API")
    messages = params.get("messages") or []
    if messages and messages[-1].get("role") == "assistant":
        raise Rejected("assistant message prefill is not supported on this model")
    if "budget_tokens" in (params.get("thinking") or {}):
        raise Rejected("budget_tokens is not supported on this model")


UNION_LIMIT = 16  # the live API's 400: "limit: 16 parameters with unions"


def _union_params(node) -> int:
    count = 0
    if isinstance(node, dict):
        for sub in (node.get("properties") or {}).values():
            if isinstance(sub, dict) and ("anyOf" in sub or isinstance(sub.get("type"), list)):
                count += 1
        for value in node.values():
            count += _union_params(value)
    elif isinstance(node, list):
        count += sum(_union_params(v) for v in node)
    return count


def _schema_check(params: dict) -> None:
    schema = ((params.get("output_config") or {}).get("format") or {}).get("schema")
    if schema is not None and _union_params(schema) > UNION_LIMIT:
        raise Rejected("Schemas contains too many parameters with union types (limit: 16 parameters with unions)")


def _counts(**kw):
    base = dict(processing=0, succeeded=0, errored=0, canceled=0, expired=0)
    base.update(kw)
    return NS(**base)


class FakeBatches:
    def __init__(self):
        self.created, self.state, self.results_map, self.fail_after = [], {}, {}, {}
        self.listing, self.create_error = [], None

    def create(self, requests):
        if self.create_error is not None:
            raise self.create_error
        seen = set()
        requests = list(requests)
        for r in requests:
            cid = r["custom_id"]
            if not CUSTOM_ID_PATTERN.match(cid) or cid in seen:
                raise Rejected(f"custom_id {cid!r} is invalid or duplicated")
            seen.add(cid)
            _api_check(r["params"])
            _schema_check(r["params"])
        bid = f"msgbatch_{len(self.created) + 1:04d}"
        self.created.append({"id": bid, "requests": requests})
        self.state[bid] = "in_progress"
        return NS(id=bid, processing_status="in_progress", created_at=datetime.now(timezone.utc),
                  request_counts=_counts(processing=len(requests)))

    def retrieve(self, bid):
        n = len(next((c["requests"] for c in self.created if c["id"] == bid), []))
        done = self.state.get(bid) == "ended"
        return NS(id=bid, processing_status=self.state.get(bid, "ended"),
                  created_at=datetime.now(timezone.utc) - timedelta(minutes=10),
                  request_counts=_counts(succeeded=n) if done else _counts(processing=n))

    def results(self, bid):
        fail = self.fail_after.get(bid)
        for i, item in enumerate(self.results_map.get(bid, [])):
            if fail is not None and i == fail:
                self.fail_after.pop(bid)
                raise ConnectionError("stream reset by peer")
            yield item

    def list(self, limit=20):
        return iter(self.listing)


class FakeMessages:
    def __init__(self):
        self.batches = FakeBatches()
        self.counted = 0

    def count_tokens(self, **kw):
        _api_check(kw)
        self.counted += 1
        return NS(input_tokens=2000)


class FakeClient:
    def __init__(self):
        self.messages = FakeMessages()


def succeeded(cid, output, *, stop="end_turn", input_tokens=1000, output_tokens=500):
    usage = NS(input_tokens=input_tokens, output_tokens=output_tokens, cache_read_input_tokens=0,
               cache_creation_input_tokens=0, cache_creation=None)
    message = NS(content=[NS(type="text", text=json.dumps(output))], stop_reason=stop, stop_details=None, usage=usage)
    return NS(custom_id=cid, result=NS(type="succeeded", message=message))


def errored(cid, etype):
    return NS(custom_id=cid, result=NS(type="errored", error=NS(type="error", error=NS(type=etype, message="bad"))))


def ended(cid, kind):
    return NS(custom_id=cid, result=NS(type=kind))


TEXTS = ["Passed on YYYT, too thin to trade.", "No thoughts on WWWT at all today.", "Watching TTTT over 55 now."]


def ctx(dry_run=False, force=False):
    return registry.JobContext(job_id="wisdom_test", now_et=timeutil.now_et(), due_key=None, force=force,
                               dry_run=dry_run, run_id="run-test")


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.delenv("WISDOM_EXTRACT_BUDGET_USD", raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_MODEL", raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_EFFORT", raising=False)
    pages = []
    monkeypatch.setattr(batch, "_page", lambda key, msg, meta: pages.append(key))
    store.init_db()
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, ingest_version, ingested_at) VALUES ('src1', 'sunday_scans', 'test:1', 1, 'x', "
                     "'2026-09-06T08:00:00-04:00', 't', '2026-09-06T09:00:00-04:00')")
        segs = [segmenter.Segment(ordinal=i, kind="section", text=t, char_start=0, char_end=len(t),
                                  path="INTRO", author_id="tsdr", speaker_confidence="medium")
                for i, t in enumerate(TEXTS)]
        segmenter.write_segments(conn, "src1", 1, segs)
    return NS(pages=pages, segment_ids=[s.segment_id("src1", 1) for s in segs])


def accept_gate():
    with store.write() as conn:
        golden.record_eval(conn, kind=golden.EVAL_KIND, extractor_version=prompt.extractor_version(), n=1,
                           metrics={"model": config.configured_model(), "effort": config.configured_effort(),
                                    "golden_version": "gtest", "golden_sha256": "c" * 64, "split": "dev",
                                    "per_type": {"MENTION": {"tp": 1, "fp": 0, "fn": 0, "precision": 1.0,
                                                             "recall": 1.0, "n_expected": 1,
                                                             "n_predicted_scored": 1}}})


def rows():
    with store.read() as conn:
        return {r["custom_id"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_extract_requests")}


def output_for(text, rtype="MENTION", ticker=None, **kw):
    rec = {name: None for name in prompt.record_fields()}
    rec.update({"tickers": [], "targets": [], "levels": [], "confidence_language": [], "hindsight": False,
                "extraction_confidence": "high", "record_type": rtype, "quote": text, "ticker_as_written": ticker})
    rec.update(kw)
    return {"segment_id": "ignored", "records": [rec]}


# ── 1. the fake can say no ───────────────────────────────────────────────────

def test_the_fake_api_rejects_every_shape_the_real_api_rejects():
    fake = FakeClient()
    good = {"model": "m", "max_tokens": 10, "messages": [{"role": "user", "content": "x"}]}
    fake.messages.batches.create([{"custom_id": "wx_ok", "params": good}])
    for bad in ({"temperature": 0}, {"top_p": 1}, {"top_k": 5}, {"fallbacks": "default"},
                {"messages": [{"role": "user", "content": "x"}, {"role": "assistant", "content": "{"}]},
                {"thinking": {"type": "enabled", "budget_tokens": 1024}}):
        with pytest.raises(Rejected):
            fake.messages.batches.create([{"custom_id": "wx_ok", "params": dict(good, **bad)}])
    for cid in ("wx|pipe", "has space", "x" * 65, ""):
        with pytest.raises(Rejected):
            fake.messages.batches.create([{"custom_id": cid, "params": good}])
    with pytest.raises(Rejected):
        fake.messages.batches.create([{"custom_id": "a", "params": good}, {"custom_id": "a", "params": good}])
    many = {"type": "object", "additionalProperties": False, "required": [f"p{i}" for i in range(17)],
            "properties": {f"p{i}": {"anyOf": [{"type": "string"}, {"type": "null"}]} for i in range(17)}}
    with pytest.raises(Rejected):
        fake.messages.batches.create([{"custom_id": "wx_many", "params": dict(
            good, output_config={"format": {"type": "json_schema", "schema": many}})}])
    # the contract as written is over the limit; the transport form is not
    for schema, rejected in ((prompt.contract_schema(), True), (prompt.api_schema(), False)):
        call = lambda: fake.messages.batches.create([{"custom_id": "wx_schema", "params": dict(
            good, output_config={"format": {"type": "json_schema", "schema": schema}})}])
        if rejected:
            with pytest.raises(Rejected):
                call()
        else:
            call()


# ── 2. gates ─────────────────────────────────────────────────────────────────

def test_run_daily_does_nothing_while_the_flag_is_off(env, monkeypatch):
    monkeypatch.delenv("WISDOM_EXTRACT_ENABLED")
    fake = FakeClient()
    out = batch.run_daily(ctx(), client=fake)
    assert out["status"] == "skipped" and fake.messages.batches.created == [] and rows() == {}


def test_run_daily_is_blocked_until_the_golden_gate_accepts_this_version(env):
    fake = FakeClient()
    out = batch.run_daily(ctx(), client=fake)
    assert out["status"] == "blocked_by_gate" and fake.messages.batches.created == [] and rows() == {}
    accept_gate()
    assert batch.run_daily(ctx(), client=fake)["status"] == "submitted"


def test_run_daily_submits_each_new_segment_once_with_clean_params(env):
    accept_gate()
    fake = FakeClient()
    out = batch.run_daily(ctx(), client=fake)
    assert out["status"] == "submitted", out
    created = fake.messages.batches.created
    assert len(created) == 1 and len(created[0]["requests"]) == 3
    for r in created[0]["requests"]:
        assert r["custom_id"].startswith("wx_") and CUSTOM_ID_PATTERN.match(r["custom_id"])
        assert r["params"]["output_config"]["effort"] == "high"
        assert r["params"]["model"] == "claude-opus-5"
    assert fake.messages.counted == 3
    got = rows()
    assert {r["status"] for r in got.values()} == {"submitted"}
    assert {r["segment_id"] for r in got.values()} == set(env.segment_ids)
    assert all(r["est_cost_usd"] == pytest.approx((2000 * 5 + 6000 * 25) / 1e6 * 0.5) for r in got.values())
    with store.read() as conn:
        b = conn.execute("SELECT * FROM wisdom_batches").fetchone()
    assert b["request_count"] == 3 and b["kind"] == "extract" and b["budget_cap_usd"] == 120.0
    again = batch.run_daily(ctx(), client=fake)
    assert again["status"] == "nothing_to_do" and len(fake.messages.batches.created) == 1


def test_the_budget_stops_before_the_request_that_crosses_it_and_pages(env, monkeypatch):
    accept_gate()
    monkeypatch.setenv("WISDOM_EXTRACT_BUDGET_USD", "0.1")
    fake = FakeClient()
    out = batch.run_daily(ctx(), client=fake)
    assert out["status"] == "budget_stop" and out["budget"]["allowed_count"] == 1
    assert len(fake.messages.batches.created[0]["requests"]) == 1
    assert any(k.startswith("wisdom_extract_budget_stop") for k in env.pages)
    monkeypatch.setenv("WISDOM_EXTRACT_BUDGET_USD", "0.05")
    none = batch.run_daily(ctx(), client=fake)
    assert none["status"] == "budget_stop" and none["selected"] == 0 and len(fake.messages.batches.created) == 1


def _table_counts():
    """Every table run_daily can write, counted — not just the one it is easiest to check."""
    with store.read() as conn:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("wisdom_extract_requests", "wisdom_batches", "wisdom_records", "wisdom_segments",
                          "wisdom_review_queue", "wisdom_eval_runs")}


def test_a_dry_run_writes_nothing_and_calls_nothing(env, monkeypatch):
    """⛔ REVIEWER FIX 2026-09-14. This asserted `rows() == {}` — ONE table
    (wisdom_extract_requests) — so the OTHER dry-run write in run_daily was invisible:
    mutating `segment_pending_sources`'s `if not dry_run and segments:` to `if segments:`
    left this file GREEN at 26 passed, because the fixture pre-segments its only source
    and `segment_pending_sources` therefore had nothing to write either way. A control
    that cannot reach the code it guards asserts the defect
    (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

    So: a source with NO segments is planted, the dry run must leave it unsegmented,
    EVERY table run_daily can write is counted, and no page is emitted. The control
    below proves the same fixture DOES segment on a real run."""
    accept_gate()
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, ingest_version, ingested_at) VALUES ('src2', 'sunday_scans', 'test:2', 1, 'y', "
                     "'2026-09-06T08:00:00-04:00', 't', '2026-09-06T09:00:00-04:00')")
    loader = lambda source: {"kind": "sunday_scans", "text": "INTRO\nWatching UUUT over 55 now.\n"}  # noqa: E731
    before = _table_counts()
    assert before["wisdom_segments"] == 3, before      # non-vacuity: the planted source is UNsegmented

    monkeypatch.setattr(batch, "make_client", lambda: pytest.fail("a dry run built a client"))
    out = batch.run_daily(ctx(dry_run=True), loader=loader)

    assert out["status"] == "dry_run" and out["selected"] == 3
    assert out["build"].get("tokens_char_estimated") == 3
    assert out["segmentation"]["sources_segmented"] == 1, out["segmentation"]   # it DID walk the new source
    assert _table_counts() == before, "a dry run wrote a row"
    assert env.pages == [], env.pages

    # CONTROL: the same source, the same loader, NOT a dry run -> segments land. Without
    # this, "wisdom_segments did not grow" is satisfied by a loader that returns nothing.
    real = batch.run_daily(ctx(), client=FakeClient(), loader=loader)
    assert real["segmentation"]["sources_segmented"] == 1
    assert _table_counts()["wisdom_segments"] > before["wisdom_segments"]


# ── 3-4. reaping ─────────────────────────────────────────────────────────────

def _submitted(env):
    accept_gate()
    fake = FakeClient()
    batch.run_daily(ctx(), client=fake)
    bid = fake.messages.batches.created[0]["id"]
    by_segment = {r["segment_id"]: cid for cid, r in rows().items()}
    return fake, bid, [by_segment[s] for s in env.segment_ids]


def test_reap_handles_every_result_type_and_costs_add_up(env):
    fake, bid, cids = _submitted(env)
    assert batch.reap(ctx(), client=fake)["progress"][0]["status"] == "in_progress"
    fake.messages.batches.state[bid] = "ended"
    fake.messages.batches.results_map[bid] = [
        succeeded(cids[0], output_for(TEXTS[0], "NEGATIVE_CALL", "YYYT", stance="passed")),
        succeeded(cids[1], output_for(TEXTS[1]), stop="refusal"),
        succeeded(cids[2], output_for(TEXTS[2]), stop="max_tokens"),
    ]
    out = batch.reap(ctx(), client=fake)
    got = rows()
    assert [got[c]["status"] for c in cids] == ["done", "failed", "retry"]
    assert got[cids[1]]["error_type"] == "refusal" and got[cids[2]]["error_type"] == "max_tokens"
    assert got[cids[0]]["records_written"] == 1
    per = (1000 * 5 + 500 * 25) / 1e6 * 0.5
    with store.read() as conn:
        b = conn.execute("SELECT status, cost_usd_actual FROM wisdom_batches WHERE batch_id = ?", (bid,)).fetchone()
        n_records = conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0]
    assert b["status"] == "reaped" and b["cost_usd_actual"] == pytest.approx(3 * per)
    assert n_records == 1 and out["totals"]["actual_usd"] == pytest.approx(3 * per)


def test_errored_expired_and_missing_results_are_classified(env):
    fake, bid, cids = _submitted(env)
    fake.messages.batches.state[bid] = "ended"
    fake.messages.batches.results_map[bid] = [errored(cids[0], "invalid_request_error"), ended(cids[1], "expired")]
    batch.reap(ctx(), client=fake)
    got = rows()
    assert got[cids[0]]["status"] == "failed" and got[cids[0]]["error_type"] == "invalid_request_error"
    assert got[cids[1]]["status"] == "retry" and got[cids[1]]["error_type"] == "expired"
    assert got[cids[2]]["status"] == "retry" and got[cids[2]]["error_type"] == "missing_result"


def test_a_stream_that_dies_mid_way_resumes_without_writing_twice(env):
    fake, bid, cids = _submitted(env)
    fake.messages.batches.state[bid] = "ended"
    fake.messages.batches.results_map[bid] = [
        succeeded(cids[0], output_for(TEXTS[0], "NEGATIVE_CALL", "YYYT", stance="passed")),
        succeeded(cids[1], output_for(TEXTS[1], "MENTION", "WWWT", stance="no_view")),
        succeeded(cids[2], output_for(TEXTS[2], "MENTION", "TTTT")),
    ]
    fake.messages.batches.fail_after[bid] = 1
    out = batch.reap(ctx(), client=fake)
    assert out["report"]["partial_batches"] == 1
    with store.read() as conn:
        assert conn.execute("SELECT status FROM wisdom_batches").fetchone()[0] == "ended_partial"
        assert conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0] == 1
    batch.reap(ctx(), client=fake)
    per = (1000 * 5 + 500 * 25) / 1e6 * 0.5
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0] == 3
        b = conn.execute("SELECT status, cost_usd_actual FROM wisdom_batches").fetchone()
    assert b["status"] == "reaped" and b["cost_usd_actual"] == pytest.approx(3 * per)
    assert {r["status"] for r in rows().values()} == {"done"}


def test_a_retry_is_resubmitted_under_its_custom_id_until_attempts_run_out(env):
    fake, bid, cids = _submitted(env)
    fake.messages.batches.state[bid] = "ended"
    fake.messages.batches.results_map[bid] = [ended(c, "expired") for c in cids]
    batch.reap(ctx(), client=fake)
    for attempt in range(2, config.MAX_ATTEMPTS + 1):
        out = batch.run_daily(ctx(), client=fake)
        assert out["status"] == "submitted", out
        new_bid = fake.messages.batches.created[-1]["id"]
        assert sorted(r["custom_id"] for r in fake.messages.batches.created[-1]["requests"]) == sorted(cids)
        # control for the max_tokens rail below: any other retry keeps the configured effort
        assert {r["params"]["output_config"]["effort"] for r in fake.messages.batches.created[-1]["requests"]} == {
            config.configured_effort()}
        assert {r["attempt"] for r in rows().values()} == {attempt}
        fake.messages.batches.state[new_bid] = "ended"
        fake.messages.batches.results_map[new_bid] = [ended(c, "expired") for c in cids]
        batch.reap(ctx(), client=fake)
    assert {r["status"] for r in rows().values()} == {"failed"}
    assert batch.run_daily(ctx(), client=fake)["status"] == "nothing_to_do"


def test_a_max_tokens_stop_is_retried_one_effort_level_lower_per_attempt(env):
    fake, bid, cids = _submitted(env)
    empty = {"segment_id": "x", "records": []}
    fake.messages.batches.state[bid] = "ended"
    fake.messages.batches.results_map[bid] = [succeeded(c, empty, stop="max_tokens") for c in cids]
    batch.reap(ctx(), client=fake)
    assert {r["error_type"] for r in rows().values()} == {"max_tokens"}
    efforts = []
    for _ in range(config.MAX_ATTEMPTS - 1):
        assert batch.run_daily(ctx(), client=fake)["status"] == "submitted"
        created = fake.messages.batches.created[-1]
        efforts.append({r["params"]["output_config"]["effort"] for r in created["requests"]})
        fake.messages.batches.state[created["id"]] = "ended"
        fake.messages.batches.results_map[created["id"]] = [succeeded(c, empty, stop="max_tokens") for c in cids]
        batch.reap(ctx(), client=fake)
    assert efforts == [{"medium"}, {"low"}]
    assert {r["status"] for r in rows().values()} == {"failed"}


# ── 5. submit errors and orphans ─────────────────────────────────────────────

def test_an_ambiguous_submit_keeps_rows_for_adoption_and_a_400_fails_them(env):
    accept_gate()
    fake = FakeClient()
    fake.messages.batches.create_error = APITimeoutError("read timed out")
    batch.run_daily(ctx(), client=fake)
    assert {r["status"] for r in rows().values()} == {"submitting"}
    assert all(r["error_type"] == "submit_unconfirmed:APITimeoutError" for r in rows().values())
    with store.write() as conn:
        conn.execute("DELETE FROM wisdom_extract_requests")
    fake.messages.batches.create_error = BadRequestError("schema rejected")
    batch.run_daily(ctx(), client=fake)
    assert {r["status"] for r in rows().values()} == {"failed"}


def _orphan_rows(cids, age):
    stamp = timeutil.iso_et(timeutil.now_et() - age)
    with store.write() as conn:
        for cid, seg in cids:
            conn.execute("INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, segment_ids_json, "
                         "extractor_version, attempt, status, segment_id, purpose, model, est_cost_usd, created_at, "
                         "updated_at) VALUES (?, 'src1', 1, '[]', ?, 1, 'submitting', ?, 'extract', 'claude-opus-5', "
                         "0.08, ?, ?)", (cid, prompt.extractor_version(), seg, stamp, stamp))
    return stamp


def test_an_orphaned_batch_is_adopted_by_its_custom_ids_then_reaped(env):
    cids = [("wx_orphan_a", env.segment_ids[0]), ("wx_orphan_b", env.segment_ids[1])]
    stamp = _orphan_rows(cids, timedelta(hours=1))
    fake = FakeClient()
    created = timeutil.parse_iso(stamp).astimezone(timezone.utc) + timedelta(seconds=3)
    fake.messages.batches.listing = [
        NS(id="msgbatch_other", created_at=created, processing_status="ended", request_counts=_counts(succeeded=2)),
        NS(id="msgbatch_orphan", created_at=created, processing_status="ended", request_counts=_counts(succeeded=2)),
    ]
    fake.messages.batches.results_map["msgbatch_other"] = [ended("wx_someone_else", "expired"),
                                                           ended("wx_other_2", "expired")]
    fake.messages.batches.results_map["msgbatch_orphan"] = [
        succeeded("wx_orphan_a", output_for(TEXTS[0], "NEGATIVE_CALL", "YYYT", stance="passed")),
        succeeded("wx_orphan_b", output_for(TEXTS[1], "MENTION", "WWWT", stance="no_view"))]
    fake.messages.batches.state["msgbatch_orphan"] = "ended"
    first = batch.reap(ctx(), client=fake)
    assert first["orphans"]["orphans_adopted"] == 2
    assert {r["batch_id"] for r in rows().values()} == {"msgbatch_orphan"}
    batch.reap(ctx(), client=fake)
    assert {r["status"] for r in rows().values()} == {"done"}


def test_orphans_with_no_batch_are_requeued_only_after_the_give_up_window(env):
    _orphan_rows([("wx_orphan_c", env.segment_ids[2])], timedelta(hours=1))
    fake = FakeClient()
    assert batch.reap(ctx(), client=fake)["orphans"]["orphans_waiting"] == 1
    with store.write() as conn:
        conn.execute("UPDATE wisdom_extract_requests SET updated_at = ?",
                     (timeutil.iso_et(timeutil.now_et() - timedelta(hours=7)),))
    assert batch.reap(ctx(), client=fake)["orphans"]["orphans_requeued"] == 1
    assert rows()["wx_orphan_c"]["status"] == "retry"
    assert "wisdom_extract_orphans_requeued" in env.pages


# ── 6. registration and client ───────────────────────────────────────────────

def test_the_reap_job_runs_at_16_and_46_behind_the_extract_flag(env, monkeypatch):
    (spec,) = jobs.JOBS
    assert spec.job_id == "wisdom_extract_reap"
    assert spec.trigger == {"kind": "cron", "minute": "16,46"}
    assert spec.enabled is flags.extract_enabled and spec.expected_every_s == 1800
    assert registry.find_spec("wisdom_extract_reap") is not None
    monkeypatch.delenv("WISDOM_INGEST_ENABLED", raising=False)
    assert registry.run_job("wisdom_extract_reap")["status"] == "skipped"
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    monkeypatch.setattr(batch, "make_client", lambda: pytest.fail("no open batch should need a client"))
    out = registry.run_job("wisdom_extract_reap")
    assert out["status"] == "ok" and out["result"]["status"] == "idle"


def test_the_client_is_built_with_an_explicit_timeout(monkeypatch):
    import anthropic

    captured = {}
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: captured.update(kw) or "client")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("WISDOM_EXTRACT_LLM_TIMEOUT_SECS", "123")
    assert batch.make_client() == "client" and captured["timeout"] == 123.0
    monkeypatch.delenv("WISDOM_EXTRACT_LLM_TIMEOUT_SECS")
    batch.make_client()
    assert captured["timeout"] == 300.0
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    with pytest.raises(batch.ExtractUnavailable):
        batch.make_client()
