"""Trade Exchange News: the `news-match` S7 trigger type (dark).

Synthetic headlines only; the shared delivery function is faked. Proves: rules
are validated, matching is ticker/keyword/mode exact, one alert per member per
headline, never twice, no stale alerts, dark does nothing, delivery goes
through the S7 path, the bell reconstructs it, and the route is admin-only.
"""
from __future__ import annotations

import time

import httpx
import pytest
from fastapi import FastAPI

from api.middleware import auth_middleware
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import delivery, predicates, receipts
from api.services.alert_taxonomy import news_match as nm
from api.services.alert_taxonomy.predicates import PredicateRegistrationError


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    monkeypatch.setenv(nm.FLAG, "1")
    for f in ("ALERT_ROUTING_RULE_ENABLED", "ALERT_QUEUE_CAPS_ENABLED", "ALERT_WEBHOOKS_ENABLED"):
        monkeypatch.delenv(f, raising=False)
    nm.register()
    sent = []

    def fake(**kw):
        sent.append(kw)
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}

    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", fake)
    return {"sent": sent}


def H(content, tickers=(), eid="01J0000000000000000000000A", age_ms=0):
    return {"type": "headline", "id": eid, "seq": 1, "source": "TXNews1", "content": content,
            "tickers": list(tickers), "received_at_ms": int(time.time() * 1000) - age_ms}


# ── rules ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("kw", [
    dict(), dict(tickers=["not a ticker!"]), dict(keywords=["ai"]),
    dict(tickers=["NVDA"], mode="all"), dict(tickers=["NVDA"], mode="sometimes"),
    dict(tickers=[f"T{i}" for i in range(11)]),
])
def test_invalid_rules_are_refused(kw):
    with pytest.raises(PredicateRegistrationError):
        nm.register_predicate_for_user("u1", **kw)


def test_same_rule_is_one_predicate_and_the_cap_holds(monkeypatch):
    a = nm.register_predicate_for_user("u1", tickers=["nvda"], keywords=["Guidance"])
    b = nm.register_predicate_for_user("u1", tickers=["NVDA"], keywords=["guidance "])
    assert a == b
    monkeypatch.setattr(nm, "MAX_RULES_PER_USER", 2)
    nm.register_predicate_for_user("u1", keywords=["halted"])
    with pytest.raises(PredicateRegistrationError):
        nm.register_predicate_for_user("u1", keywords=["merger"])


@pytest.mark.parametrize("params,headline,hit", [
    ({"tickers": ["NVDA"], "keywords": [], "mode": "any"}, H("SYNTHETIC x", ["NVDA"]), True),
    ({"tickers": ["NVDA"], "keywords": [], "mode": "any"}, H("SYNTHETIC NVDA mentioned", []), False),
    ({"tickers": [], "keywords": ["halt"], "mode": "any"}, H("SYNTHETIC: trading HALTED"), True),
    ({"tickers": [], "keywords": ["halt"], "mode": "any"}, H("SYNTHETIC: asphalt prices"), False),
    ({"tickers": [], "keywords": ["price target"], "mode": "any"}, H("SYNTHETIC: raises price  targets"), True),
    ({"tickers": ["NVDA"], "keywords": ["guidance"], "mode": "all"}, H("SYNTHETIC guidance", ["AMD"]), False),
    ({"tickers": ["NVDA"], "keywords": ["guidance"], "mode": "all"}, H("SYNTHETIC guidance", ["NVDA"]), True),
])
def test_matching_rules(params, headline, hit):
    assert (nm.match(params, headline) is not None) is hit


# ── firing ───────────────────────────────────────────────────────────────────

def test_one_alert_per_member_per_headline_even_with_two_matching_rules(store):
    nm.register_predicate_for_user("u1", tickers=["NVDA"])
    nm.register_predicate_for_user("u1", keywords=["guidance"])
    nm.register_predicate_for_user("u2", keywords=["guidance"])
    out = nm.evaluate_headline(H("SYNTHETIC: Example raises guidance", ["NVDA"]))
    assert out["fired"] == 2
    (f,) = receipts.list_fires("u1", limit=10)
    assert f["trigger_type"] == "news-match" and f["fire_key"].startswith("news:")
    assert f["detail"]["matched_tickers"] == ["NVDA"] and f["detail"]["matched_keywords"] == ["guidance"]
    assert f["detail"]["tickers_provisional"] is True and len(f["detail"]["rules"]) == 2
    titles = sorted(s["title"] for s in store["sent"])
    assert titles == ['News: "guidance"', 'News: NVDA, "guidance"']
    assert {s["source"] for s in store["sent"]} == {"news_match"}


def test_the_same_headline_never_fires_twice(store):
    nm.register_predicate_for_user("u1", keywords=["halted"])
    h = H("SYNTHETIC: Example halted")
    assert nm.evaluate_headline(h)["fired"] == 1
    assert nm.evaluate_headline(h)["fired"] == 0
    assert len(store["sent"]) == 1


def test_a_headline_recovered_late_is_not_alerted(store):
    nm.register_predicate_for_user("u1", keywords=["halted"])
    out = nm.evaluate_headline(H("SYNTHETIC: Example halted", age_ms=nm.MAX_ALERT_DELAY_MS + 1))
    assert out["outcome"] == "stale" and store["sent"] == []


def test_dark_does_nothing(store, monkeypatch):
    nm.register_predicate_for_user("u1", keywords=["halted"])
    monkeypatch.setenv(nm.FLAG, "0")
    assert nm.evaluate_headline(H("SYNTHETIC halted"))["outcome"] == "disabled"
    nm.on_headline(H("SYNTHETIC halted"))
    assert store["sent"] == []


def test_suspended_rules_do_not_fire(store):
    pid = nm.register_predicate_for_user("u1", keywords=["halted"])
    assert predicates.suspend_predicate(pid, "u1")
    assert nm.evaluate_headline(H("SYNTHETIC halted"))["fired"] == 0


def test_the_bell_reconstructs_a_fire_from_its_frozen_detail(store):
    nm.register_predicate_for_user("u1", tickers=["NVDA"])
    nm.evaluate_headline(H("SYNTHETIC: words as sent", ["NVDA"]))
    (f,) = receipts.list_fires("u1", limit=10)
    shape = nm.alert_shape_for_fire(f)
    assert shape["type"] == "news_match" and shape["message"] == "SYNTHETIC: words as sent"
    assert shape["data"]["research_url"] == "/research/NVDA" and shape["data"]["source"] == "news_match"
    from api.services import alerts as feed
    assert any(a["id"] == shape["id"] for a in feed._s7_durable_alerts("u1", 10))


def test_the_pipeline_hook_runs_off_the_writer_thread(store):
    import threading
    seen = []
    orig = nm.evaluate_headline

    def spy(h, now_ms=None):
        seen.append(threading.current_thread().name)
        return orig(h, now_ms)
    nm.register_predicate_for_user("u1", keywords=["halted"])
    nm.evaluate_headline = spy
    try:
        nm.on_headline(H("SYNTHETIC halted"))
        nm._POOL.submit(lambda: None).result(timeout=5)
    finally:
        nm.evaluate_headline = orig
    assert seen and seen[0].startswith("news-match")


def test_cooldown_is_published():
    from api.services.alert_taxonomy import cooldowns
    c = cooldowns.published_cooldown("news-match")
    assert c["rearm_grain"] == "headline" and c["check_every_minutes"] is None


# ── the route ────────────────────────────────────────────────────────────────

async def test_the_route_is_admin_only_and_dark_aware(monkeypatch):
    from api.routers import alert_taxonomy as r
    app = FastAPI()
    app.include_router(r.router)

    async def call(user, method="post", json=None):
        app.dependency_overrides.clear()
        if user:
            app.dependency_overrides[auth_middleware.get_current_user] = lambda: user
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return await getattr(c, method)("/api/alerts/taxonomy/news-match",
                                            **({"json": json} if json is not None else {}))
    body = {"keywords": ["halted"]}
    assert (await call(None, json=body)).status_code == 401
    assert (await call({"id": "m", "role": "user"}, json=body)).status_code == 403
    ok = await call({"id": "a", "role": "admin"}, json=body)
    assert ok.status_code == 200 and ok.json()["predicate_id"]
    assert (await call({"id": "a", "role": "admin"}, json={"keywords": ["x"]})).status_code == 400
    listed = await call({"id": "a", "role": "admin"}, method="get")
    assert len(listed.json()["predicates"]) == 1
    monkeypatch.setenv(nm.FLAG, "0")
    assert (await call({"id": "a", "role": "admin"}, json=body)).status_code == 404
