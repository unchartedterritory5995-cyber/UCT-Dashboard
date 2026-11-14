"""Daily AI budgets (api/services/llm_budget.py) over the AI-spend ledger: block
mode refuses a feature's calls BEFORE any request is sent, `*background` never
touches a member door, a metering fault allows the call, and the watchdog alerts
once per (day, budget, level)."""
from __future__ import annotations

import json

import anthropic
import httpx
import pytest

from api.services import llm_budget, llm_usage

MEMBER_DOOR = "api/routers/ai_search.py"           # kind=member in ai_doors
BACKGROUND_DOOR = "api/services/ai_search_dossier.py"  # kind=background


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_USAGE_LEDGER", "1")
    monkeypatch.setenv("LLM_USAGE_DB_PATH", str(tmp_path / "llm_usage.db"))
    monkeypatch.delenv("LLM_USAGE_FORWARD_URL", raising=False)
    llm_usage._drain(10_000)
    llm_budget._invalidate()
    assert llm_usage.install()
    yield
    llm_budget._invalidate()


def spend(door: str, usd: float):
    llm_usage.record(door=door, model="claude-sonnet-5-5", cost_usd=usd)
    llm_usage.flush()
    llm_budget._invalidate()


def test_defaults_are_seeded_once_and_an_edit_sticks(env):
    bs = llm_budget.budgets(fresh=True)
    assert bs["*"]["mode"] == "alert"
    assert bs["api/services/tsdr_lessons.py"]["mode"] == "block"
    llm_budget.delete_budget("api/services/tsdr_lessons.py")
    assert "api/services/tsdr_lessons.py" not in llm_budget.budgets(fresh=True)  # never re-seeded


@pytest.mark.parametrize("usd", [0, -1, float("nan")])
def test_a_zero_or_negative_budget_is_refused(env, usd):
    with pytest.raises(ValueError):
        llm_budget.set_budget("api/services/x.py", usd, "block")


def test_block_refuses_at_the_cap_and_alert_never_does(env):
    llm_budget.set_budget(BACKGROUND_DOOR, 1.0, "block")
    spend(BACKGROUND_DOOR, 0.5)
    assert llm_budget.check(BACKGROUND_DOOR).allowed
    spend(BACKGROUND_DOOR, 0.6)
    d = llm_budget.check(BACKGROUND_DOOR)
    assert not d.allowed and d.budget_key == BACKGROUND_DOOR and d.spent == pytest.approx(1.1)
    llm_budget.set_budget(BACKGROUND_DOOR, 1.0, "alert")
    assert llm_budget.check(BACKGROUND_DOOR).allowed


def test_background_budget_never_touches_a_member_door(env):
    llm_budget.set_budget(llm_budget.BACKGROUND, 1.0, "block")
    spend(BACKGROUND_DOOR, 2.0)
    assert not llm_budget.check(BACKGROUND_DOOR).allowed
    assert llm_budget.check(MEMBER_DOOR).allowed  # control: the same spend, a member door, allowed


def test_the_sdk_refuses_before_sending_a_request(env, monkeypatch):
    sent = []

    def handler(request):
        sent.append(request)
        return httpx.Response(200, json={})

    llm_budget.set_budget("unattributed", 0.01, "block")
    spend("unattributed", 1.0)
    client = anthropic.Anthropic(api_key="t", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(llm_budget.LLMBudgetExceeded):
        client.messages.create(model="claude-sonnet-5-5", max_tokens=5, messages=[{"role": "user", "content": "x"}])
    assert sent == []
    # control: count_tokens is not a billed call and is never gated
    client.messages.count_tokens(model="claude-sonnet-5-5", messages=[{"role": "user", "content": "x"}])
    assert len(sent) == 1


def test_a_budget_fault_allows_the_call(env, monkeypatch):
    monkeypatch.setattr(llm_budget, "budgets", lambda *a, **k: 1 / 0)
    assert llm_budget.check(BACKGROUND_DOOR).allowed


def test_watch_alerts_once_per_level(env):
    llm_budget.set_budget(BACKGROUND_DOOR, 1.0, "block")
    spend(BACKGROUND_DOOR, 1.5)
    posts = []
    sent = llm_budget.watch(post=lambda t: posts.append(t) or True)
    assert any(s["door"] == BACKGROUND_DOOR and s["level"] == "over" for s in sent)
    assert any("REFUSED" in t for t in posts)
    assert llm_budget.watch(post=lambda t: posts.append(t) or True) == []  # deduped


def test_a_failed_post_is_retried_next_pass(env):
    llm_budget.set_budget(BACKGROUND_DOOR, 1.0, "alert")
    spend(BACKGROUND_DOOR, 1.5)
    assert llm_budget.watch(post=lambda t: False) == []
    assert llm_budget.watch(post=lambda t: True)


def test_tsdr_tick_skips_its_model_stages_when_the_budget_is_spent(env, monkeypatch):
    from api.services import tsdr_lessons as t
    called = []
    monkeypatch.setattr(t, "is_enabled", lambda: True)
    monkeypatch.setattr(t, "rescan_for_links", lambda: False)
    monkeypatch.setattr(t, "source_channels", lambda: [])
    monkeypatch.setattr(t, "run_link_redo", lambda **k: {"requeued": 0, "errors": 0})
    monkeypatch.setattr(t, "reopen_skipped_clips", lambda: 0)
    # the tick also reopens failed videos and counts the library; both open the lessons
    # database, which this fixture does not point anywhere
    monkeypatch.setattr(t, "reopen_failed", lambda: 0)
    monkeypatch.setattr(t, "status_counts", lambda: {})
    monkeypatch.setattr(t, "run_lessons", lambda **k: called.append(k) or {"posted": 1})
    monkeypatch.setattr(t, "threads_enabled", lambda: False)
    monkeypatch.setattr(t, "forum_enabled", lambda: False)
    monkeypatch.setattr(t, "youtube_enabled", lambda: False)
    monkeypatch.setattr(llm_budget, "allows", lambda door: False)
    out = t.tick()
    assert out["lessons"] == {"skipped": "daily AI budget reached"} and called == []
    monkeypatch.setattr(llm_budget, "allows", lambda door: True)  # control: allowed, it runs
    out = t.tick()
    assert out["lessons"] == {"posted": 1} and len(called) == 1


def test_budget_endpoints(env):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import require_admin
    from api.routers import admin_llm_usage as r
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[require_admin] = lambda: {"role": "admin", "email": "owner@example.test"}
    c = TestClient(app)
    assert c.put("/api/admin/llm-usage/budgets", json={"door": BACKGROUND_DOOR, "daily_usd": 0, "mode": "block"}).status_code == 422
    ok = c.put("/api/admin/llm-usage/budgets", json={"door": BACKGROUND_DOOR, "daily_usd": 3, "mode": "block"})
    assert ok.status_code == 200 and ok.json()["budget"]["updated_by"] == "owner@example.test"
    rows = {b["door"]: b for b in c.get("/api/admin/llm-usage/budgets").json()["budgets"]}
    assert rows[BACKGROUND_DOOR]["daily_usd"] == 3 and rows[BACKGROUND_DOOR]["level"] == "ok"
    assert c.delete("/api/admin/llm-usage/budgets", params={"door": BACKGROUND_DOOR}).json() == {"deleted": True}
    summary = c.get("/api/admin/llm-usage/summary?days=1").json()
    assert any(b["door"] == "*" for b in summary["budgets"])


# ── daily digest ─────────────────────────────────────────────────────────────

def _spend_on(door, usd, day_iso, model="claude-sonnet-5-5", kind="sync", ok=True):
    llm_usage.record(door=door, model=model, cost_usd=usd, kind=kind, ok=ok, at=f"{day_iso}T17:00:00+00:00")


def test_digest_ranks_features_splits_segments_and_compares_to_yesterday(env):
    _spend_on(BACKGROUND_DOOR, 3.0, "2026-11-09")
    _spend_on(BACKGROUND_DOOR, 6.0, "2026-11-10")
    _spend_on(MEMBER_DOOR, 2.0, "2026-11-10", model="claude-opus-5-5")
    _spend_on("morning-wire/morning_wire_engine.py", 1.0, "2026-11-10", kind="batch")
    _spend_on("api/services/never_listed.py", 0.5, "2026-11-10", ok=False)
    llm_usage.flush()
    d = llm_budget.digest_data("2026-11-10")
    assert d["total"] == pytest.approx(9.5) and d["prev_total"] == pytest.approx(3.0)
    assert [x["door"] for x in d["doors"]][:2] == [BACKGROUND_DOOR, MEMBER_DOOR]
    assert d["segments"] == pytest.approx({"background": 6.0, "member": 2.0, "outside site": 1.0, "unlisted": 0.5})
    assert d["batch_usd"] == pytest.approx(1.0) and d["failed_usd"] == pytest.approx(0.5)
    text = llm_budget.digest_text(d)
    assert "$9.50" in text and "yesterday $3.00 (+217%)" in text
    assert "ai_search_dossier: $6.00 (63%" in text and "+100% vs yday" in text
    assert "NEW vs yday" in text and "/admin/ai-spend" in text


def test_digest_posts_once_per_day_and_can_be_switched_off(env, monkeypatch):
    _spend_on(BACKGROUND_DOOR, 1.0, "2026-11-10")
    llm_usage.flush()
    sent = []
    assert llm_budget.digest("2026-11-10", post=lambda t: sent.append(t) or True)
    assert llm_budget.digest("2026-11-10", post=lambda t: sent.append(t) or True) is None
    assert len(sent) == 1
    # a failed post is retried on the next run rather than marked done
    assert llm_budget.digest("2026-11-11", post=lambda t: False) is None
    assert llm_budget.digest("2026-11-11", post=lambda t: sent.append(t) or True)
    monkeypatch.setenv("LLM_SPEND_DIGEST", "0")
    assert llm_budget.digest("2026-11-12", post=lambda t: sent.append(t) or True) is None
    assert len(sent) == 2
