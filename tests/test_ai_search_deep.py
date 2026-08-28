"""Deep Research rails (2026-08-28): job lifecycle with every LLM/web stage
faked, the caps (per-user count + global dollars), member scoping, the
redeploy reclaim, the de-identified capture, and the router contract
(5-unit billing, refund on failure to start)."""
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
import api.services.ai_search_deep as deep
import api.services.ai_search_member as mem
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)


# Captured at import, before any fixture patches the module attr — the
# citation-merge test exercises the REAL implementation.
_REAL_SYNTH = deep._synthesize


def _client(user_id=1, role="user", plan="pro"):
    app = FastAPI()
    app.include_router(ai.router)
    who = {"id": user_id, "role": role, "plan": plan}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


class _InlinePool:
    """Run jobs synchronously so tests observe the finished state."""
    def submit(self, fn, *a):
        fn(*a)
        class _F:  # minimal future
            def result(self, timeout=None):
                return None
        return _F()


def _fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_SEARCH_MEMBER_DB_PATH", str(tmp_path / "member.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    mem._reset_for_tests()
    deep._reset_for_tests()
    import api.services.ai_search_log as ail
    ail._reset_for_tests()
    monkeypatch.setattr(deep, "_DEEP_POOL", _InlinePool())
    # fake every external stage (incl. the fail-fast synthesis-client probe)
    monkeypatch.setattr(deep, "_anthropic_available", lambda: True)
    monkeypatch.setattr(deep, "_plan", lambda q: ["sub one about CRM", "sub two about CRM"])
    monkeypatch.setattr(deep, "_desk_block", lambda q: "UCT DESK DATA: CRM last $252")
    monkeypatch.setattr(deep, "_web", lambda sq: {
        "answer": f"web finding for: {sq} [1]", "citations": ["https://reuters.com/x"]})
    monkeypatch.setattr(deep, "_synthesize",
                        lambda q, d, f: ("## Executive read\nCRM ripped. [1]", ["https://reuters.com/x"]))
    import api.services.narrative_cost_guard as guard
    monkeypatch.setattr(guard, "spend_today_usd", lambda s: 0.0)
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._usage_seeded_day = None
    ai._stats = ai._fresh_stats()


def test_job_lifecycle_and_member_scoping(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    out = deep.submit("u1", "full picture on CRM after the print")
    assert out["ok"] and out["job_id"]
    jid = out["job_id"]
    job = deep.get_job("u1", jid)
    assert job["status"] == "done"
    assert "CRM ripped" in job["report"]
    assert job["citations"] == ["https://reuters.com/x"]
    # member scoping is absolute
    assert deep.get_job("u2", jid) is None
    assert deep.delete_job("u2", jid) is False
    assert deep.list_jobs("u2") == []
    assert deep.list_jobs("u1")[0]["job_id"] == jid
    assert deep.delete_job("u1", jid) is True


def test_finished_report_feeds_the_capture_log(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    out = deep.submit("u1", "full picture on CRM after the print")
    import api.services.ai_search_log as ail
    rows = ail._all_rows_for_test()
    assert len(rows) == 1
    assert rows[0]["endpoint"] == "deep" and rows[0]["mode"] == "deep"
    assert "CRM ripped" in rows[0]["answer"]
    assert rows[0]["user_bucket"]   # de-identified bucket, never a raw id
    # ⛔ PRIVACY RAIL: the capture-log answer_id must NEVER equal the member-
    # keyed job PK — that join would re-identify the de-identified log.
    assert rows[0]["answer_id"] != out["job_id"]


def test_per_user_daily_cap(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    monkeypatch.setenv("AI_SEARCH_DEEP_PERUSER_CAP", "2")
    assert deep.submit("u1", "question number one here")["ok"]
    assert deep.submit("u1", "question number two here")["ok"]
    out = deep.submit("u1", "question number three here")
    assert not out["ok"] and "capped" in out["reason"]
    # another member is unaffected
    assert deep.submit("u2", "their own first question")["ok"]


def test_global_dollar_cap_blocks_submission(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    import api.services.narrative_cost_guard as guard
    monkeypatch.setattr(guard, "spend_today_usd", lambda s: 99.0)
    out = deep.submit("u1", "an expensive question today")
    assert not out["ok"] and "cooling down" in out["reason"]


def test_failed_job_refunds_and_reports_error(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    refunded = []
    monkeypatch.setattr(deep, "_refund_units", lambda uid: refunded.append(uid))
    monkeypatch.setattr(deep, "_synthesize",
                        lambda q, d, f: (_ for _ in ()).throw(RuntimeError("boom")))
    out = deep.submit("u1", "a question that will fail")
    job = deep.get_job("u1", out["job_id"])
    assert job["status"] == "error" and "resubmit" in job["error"]
    assert refunded == ["u1"]


def test_reclaim_marks_stale_running_jobs(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    refunded = []
    monkeypatch.setattr(deep, "_refund_units", lambda uid: refunded.append(uid))
    import contextlib
    deep._ensure_init()
    with contextlib.closing(deep._connect()) as conn:
        conn.execute(
            "INSERT INTO ais_deep_jobs (job_id, user_id, query, status, progress, created_at, started_at) "
            "VALUES ('stale1','u1','q','running','researching',"
            "'2026-08-27T00:00:00+00:00','2026-08-27T00:00:01+00:00')")
        conn.commit()
    assert deep.reclaim_stale() == 1
    job = deep.get_job("u1", "stale1")
    assert job["status"] == "error" and "deploy" in job["error"]
    assert refunded == ["u1"]
    # idempotent: a second reclaim (second tab polling) must not double-credit
    assert deep.reclaim_stale() == 0
    assert refunded == ["u1"]


def test_queued_jobs_get_the_longer_wall(monkeypatch, tmp_path):
    """Pool-queue wait is NOT staleness: a queued job 20 min old (busy morning,
    2-worker pool) must survive the running-wall that would have falsely
    reclaimed it — and refunded a member who then ALSO got the report."""
    _fresh(monkeypatch, tmp_path)
    import contextlib
    from datetime import datetime, timedelta, timezone
    deep._ensure_init()
    ts = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
    with contextlib.closing(deep._connect()) as conn:
        conn.execute(
            "INSERT INTO ais_deep_jobs (job_id, user_id, query, status, progress, created_at) "
            "VALUES ('q20','u1','q','queued','queued',?)", (ts,))
        conn.commit()
    assert deep.reclaim_stale() == 0
    assert deep.get_job("u1", "q20")["status"] == "queued"


def test_late_worker_never_overwrites_a_reclaimed_job(monkeypatch, tmp_path):
    """Reclaim refunded the member — a worker finishing late must not flip the
    row to done (member would get the report AND the refund), and must not
    write the capture log."""
    _fresh(monkeypatch, tmp_path)
    import contextlib
    deep._ensure_init()
    with contextlib.closing(deep._connect()) as conn:
        conn.execute(
            "INSERT INTO ais_deep_jobs (job_id, user_id, query, status, progress, created_at) "
            "VALUES ('gone1','u1','full picture on CRM','error','queued','2026-08-27T00:00:00+00:00')")
        conn.commit()
    deep._run_job("gone1")   # early-exit on terminal status
    job = deep.get_job("u1", "gone1")
    assert job["status"] == "error" and not job["report"]
    import api.services.ai_search_log as ail
    assert ail._all_rows_for_test() == []


def test_duplicate_inflight_query_is_refused(monkeypatch, tmp_path):
    """The double-click rail: same member, same question, still queued/running
    → refused (the router then refunds the second reservation)."""
    _fresh(monkeypatch, tmp_path)

    class _NeverRuns:   # keep the first job queued
        def submit(self, fn, *a):
            class _F:
                def result(self, timeout=None):
                    return None
            return _F()

    monkeypatch.setattr(deep, "_DEEP_POOL", _NeverRuns())
    assert deep.submit("u1", "full picture on CRM after the print")["ok"]
    out = deep.submit("u1", "full picture on CRM after the print")
    assert not out["ok"] and "already running" in out["reason"]


def test_cost_cap_sums_both_ledger_surfaces(monkeypatch, tmp_path):
    """The advertised $10/day is Anthropic + Perplexity — counting one surface
    under-reported the cap."""
    _fresh(monkeypatch, tmp_path)
    import api.services.narrative_cost_guard as guard
    monkeypatch.setattr(guard, "spend_today_usd",
                        lambda s: 6.0 if s == "pplx:ai_search_deep" else 5.0)
    out = deep.submit("u1", "an expensive question today")
    assert not out["ok"] and "cooling down" in out["reason"]


def test_pool_reject_refunds_exactly_once(monkeypatch, tmp_path):
    """Service used to refund AND the router refunds on ok:False — one
    reservation came back twice, silently erasing other billed usage."""
    _fresh(monkeypatch, tmp_path)

    class _Dead:
        def submit(self, fn, *a):
            raise RuntimeError("executor shut down")

    monkeypatch.setattr(deep, "_DEEP_POOL", _Dead())
    c = _client(user_id=9)
    # seed prior legitimate usage so a double refund can't hide behind max(0,..)
    ai._reserve(9, 7)
    before = ai._usage_global
    r = c.post("/api/ai-search/deep", json={"query": "a question that cannot start"})
    assert r.status_code == 429
    assert ai._usage_global == before   # the 5-unit reservation came back ONCE


def test_endpoints_bill_five_units_and_scope(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    c1 = _client(user_id=1)
    r = c1.post("/api/ai-search/deep", json={"query": "full picture on CRM here"})
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] and d["quota"]["used"] == 5   # a report bills 5 of the daily 40
    jid = d["job_id"]
    assert c1.get("/api/ai-search/deep").json()["jobs"][0]["job_id"] == jid
    assert "CRM ripped" in c1.get(f"/api/ai-search/deep/{jid}").json()["report"]
    c2 = _client(user_id=2)
    assert c2.get(f"/api/ai-search/deep/{jid}").status_code == 404
    assert c1.delete(f"/api/ai-search/deep/{jid}").json()["ok"] is True
    # free members never reach the researcher
    free = _client(user_id=3, plan="free")
    assert free.post("/api/ai-search/deep", json={"query": "anything at all here"}).status_code == 402


def test_endpoint_refunds_when_submit_refused(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    import api.services.narrative_cost_guard as guard
    monkeypatch.setattr(guard, "spend_today_usd", lambda s: 99.0)
    c = _client(user_id=1)
    r = c.post("/api/ai-search/deep", json={"query": "an expensive question today"})
    assert r.status_code == 429
    assert ai._usage_global == 0   # the 5-unit reservation came back


def test_synthesize_merges_and_renumbers_citations(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    captured = {}

    def fake_llm(model, system, prompt, max_tokens, timeout):
        captured["prompt"] = prompt
        return "report body [2]"

    monkeypatch.setattr(deep, "_anthropic_text", fake_llm)
    report, cites = _REAL_SYNTH(
        "q", "desk",
        [{"q": "s1", "answer": "alpha [1]", "citations": ["https://a.com/1"]},
         {"q": "s2", "answer": "beta [1]", "citations": ["https://b.com/2", "https://a.com/1"]}])
    # merged, deduped, order-stable
    assert cites == ["https://a.com/1", "https://b.com/2"]
    # each finding's local [1] was renumbered into the merged list in the prompt
    assert "alpha [1]" in captured["prompt"]
    assert "beta [2]" in captured["prompt"]
    assert "[1] https://a.com/1" in captured["prompt"]
    assert report == "report body [2]"


# ── scheduled (weekly) jobs — source='scheduled' rails (2026-08-28) ──────────

def test_scheduled_job_delivers_and_never_refunds_on_error(monkeypatch, tmp_path):
    """A scheduled job reserved no router units, so its failure must refund
    nothing (a refund here would mint phantom credit), and its success must
    deliver a ready-alert through the watchlist alert door."""
    _fresh(monkeypatch, tmp_path)
    refunded, delivered = [], []
    monkeypatch.setattr(deep, "_refund_units", lambda uid: refunded.append(uid))
    import api.services.watchlist_alert_service as was
    monkeypatch.setattr(was, "deliver_alert_payload",
                        lambda uid, sym, title, msg, **kw: delivered.append((uid, title, kw)))
    # success path → delivered, severity info, no refund
    out = deep.submit("u1", "weekly deep question one", source="scheduled")
    assert out["ok"]
    job = deep.get_job("u1", out["job_id"])
    assert job["status"] == "done"
    assert len(delivered) == 1
    uid, title, kw = delivered[0]
    assert uid == "u1" and "ready" in title.lower()
    assert kw.get("severity") == "info"          # info skips the Discord webhook
    assert refunded == []
    # error path → error status, STILL no refund
    monkeypatch.setattr(deep, "_synthesize",
                        lambda q, d, f: (_ for _ in ()).throw(RuntimeError("boom")))
    out2 = deep.submit("u1", "weekly deep question two", source="scheduled")
    assert deep.get_job("u1", out2["job_id"])["status"] == "error"
    assert refunded == []
    # interactive failure in the same store still refunds (control)
    out3 = deep.submit("u1", "interactive question that fails")
    assert deep.get_job("u1", out3["job_id"])["status"] == "error"
    assert refunded == ["u1"]


def test_scheduled_jobs_do_not_consume_interactive_slots(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    monkeypatch.setenv("AI_SEARCH_DEEP_PERUSER_CAP", "2")
    assert deep.submit("u1", "scheduled weekly report one", source="scheduled")["ok"]
    assert deep.submit("u1", "scheduled weekly report two", source="scheduled")["ok"]
    # both interactive slots still free
    assert deep.submit("u1", "interactive question one")["ok"]
    assert deep.submit("u1", "interactive question two")["ok"]
    assert not deep.submit("u1", "interactive question three")["ok"]


def test_reclaim_never_refunds_a_scheduled_job(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    refunded = []
    monkeypatch.setattr(deep, "_refund_units", lambda uid: refunded.append(uid))
    import contextlib
    deep._ensure_init()
    with contextlib.closing(deep._connect()) as conn:
        conn.execute(
            "INSERT INTO ais_deep_jobs (job_id, user_id, query, status, progress, created_at, started_at, source) "
            "VALUES ('sched1','u1','q','running','researching',"
            "'2026-08-27T00:00:00+00:00','2026-08-27T00:00:01+00:00','scheduled')")
        conn.commit()
    assert deep.reclaim_stale() == 1
    assert deep.get_job("u1", "sched1")["status"] == "error"
    assert refunded == []
