"""FT-033 outbound alert webhooks + FT-036 the one routing rule with suspend.

Recorded fixtures only: DNS answers are supplied by a fake resolver, the HTTP
POST by a fake poster, the signing-key box by a reversible fake. Nothing here
touches the network."""
from __future__ import annotations

import json
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import alert_outbound as rx
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import delivery, receipts, routing_rule
from api.services.alert_taxonomy import outbound_webhooks as wh

PUBLIC = lambda host: ["93.184.216.34"]          # noqa: E731  (example.com)
PRIVATE = lambda host: ["10.0.0.7"]              # noqa: E731
MIXED = lambda host: ["93.184.216.34", "127.0.0.1"]  # noqa: E731


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    from api.services import crypto_box
    monkeypatch.setattr(crypto_box, "is_configured", lambda: True)
    monkeypatch.setattr(crypto_box, "encrypt", lambda s: "enc:" + s[::-1])
    monkeypatch.setattr(crypto_box, "decrypt", lambda b: b[4:][::-1])
    monkeypatch.setattr(wh, "_resolve", PUBLIC)
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setenv(wh.FLAG, "1")
    monkeypatch.setenv(routing_rule.FLAG, "1")


# ── SSRF guard ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,why", [
    ("http://hooks.example.com/x", "https"),
    ("https://user:pw@hooks.example.com/x", "credentials"),
    ("https://hooks.example.com:8443/x", "port 443"),
    ("https://localhost/x", "not reachable"),
    ("https://metadata.internal/x", "not reachable"),
    ("https://127.0.0.1/x", "private or reserved"),
    ("https://169.254.169.254/latest", "private or reserved"),
    ("https://[::1]/x", "private or reserved"),
    ("ftp://hooks.example.com/x", "https"),
])
def test_refused_urls(url, why):
    with pytest.raises(wh.WebhookError, match=why):
        wh.check_url(url, resolver=PUBLIC)


def test_a_hostname_resolving_to_a_private_address_is_refused():
    with pytest.raises(wh.WebhookError, match="private or reserved"):
        wh.check_url("https://hooks.example.com/x", resolver=PRIVATE)
    with pytest.raises(wh.WebhookError, match="private or reserved"):
        wh.check_url("https://hooks.example.com/x", resolver=MIXED)


def test_a_public_https_url_passes():
    assert wh.check_url("https://hooks.example.com/uct", resolver=PUBLIC) == "https://hooks.example.com/uct"


# ── signing ─────────────────────────────────────────────────────────────────

def test_signature_verifies_and_a_tampered_body_does_not():
    body = b'{"a":1}'
    h = wh.sign("whsec_x", body, 1_700_000_000)
    assert wh.verify("whsec_x", body, h, now=1_700_000_010)
    assert not wh.verify("whsec_x", b'{"a":2}', h, now=1_700_000_010)
    assert not wh.verify("whsec_other", body, h, now=1_700_000_010)
    assert not wh.verify("whsec_x", body, h, now=1_700_001_000)   # outside the replay window


# ── create / list / revoke, owner-scoped ────────────────────────────────────

def test_the_secret_is_shown_once_and_never_listed():
    made = wh.create("u1", "https://hooks.example.com/a")
    assert made["secret"].startswith("whsec_")
    listed = wh.list_webhooks("u1")
    assert listed[0]["id"] == made["id"] and "secret" not in listed[0]
    assert listed[0]["secret_hint"] == made["secret"][-4:]
    assert wh.list_webhooks("u2") == []


def test_at_most_three_live_webhooks():
    for i in range(3):
        wh.create("u1", f"https://hooks.example.com/{i}")
    with pytest.raises(wh.WebhookError, match="at most 3"):
        wh.create("u1", "https://hooks.example.com/4")


def test_revoke_is_owner_scoped_and_keeps_the_row():
    made = wh.create("u1", "https://hooks.example.com/a")
    assert wh.revoke("u2", made["id"]) is False
    assert wh.revoke("u1", made["id"]) is True
    assert wh.list_webhooks("u1")[0]["revoked_at"] is not None


def test_no_signing_key_storage_means_no_webhook(monkeypatch):
    from api.services import crypto_box
    monkeypatch.setattr(crypto_box, "is_configured", lambda: False)
    with pytest.raises(wh.WebhookError, match="not configured"):
        wh.create("u1", "https://hooks.example.com/a")


# ── enqueue + drain ─────────────────────────────────────────────────────────

T0 = time.time() + 60    # "now" for the drain: after every enqueue in these tests

FIRE = {"fire_id": 7, "trigger_type": "document_arrival", "entity": "AAPL",
        "title": "New 8-K — AAPL", "message": "Apple filed an 8-K."}


def test_dark_enqueues_nothing_and_drains_nothing(monkeypatch):
    monkeypatch.setenv(wh.FLAG, "1")
    wh.create("u1", "https://hooks.example.com/a")
    monkeypatch.delenv(wh.FLAG)
    assert wh.enqueue_fire("u1", FIRE) == []
    assert wh.drain(poster=lambda *a: 200)["skipped"] == "dark"


def test_a_fire_is_signed_and_delivered_once(armed):
    made = wh.create("u1", "https://hooks.example.com/a")
    ids = wh.enqueue_fire("u1", FIRE)
    assert len(ids) == 1
    assert wh.enqueue_fire("u1", FIRE) == []          # the same fire is queued once per webhook
    sent = []

    def poster(url, body, headers):
        sent.append((url, body, headers))
        return 204
    out = wh.drain(poster=poster, now=T0)
    assert out["delivered"] == 1
    url, body, headers = sent[0]
    assert url == "https://hooks.example.com/a"
    assert headers["X-UCT-Event"] == "alert.fired" and headers["X-UCT-Delivery"] == ids[0]
    assert wh.verify(made["secret"], body, headers["X-UCT-Signature"], now=T0)
    payload = json.loads(body)
    assert payload["entity"] == "AAPL" and payload["fire_id"] == 7
    assert wh.drain(poster=poster, now=T0 + 100)["sent"] == 0   # nothing left


def test_failures_back_off_then_fail_for_good(armed):
    made = wh.create("u1", "https://hooks.example.com/a")
    wh.enqueue_fire("u1", FIRE)
    t = T0
    for attempt in range(1, wh.MAX_ATTEMPTS + 1):
        out = wh.drain(poster=lambda *a: 500, now=t)
        assert out["sent"] == 1
        rows = wh.deliveries("u1", made["id"])
        if attempt < wh.MAX_ATTEMPTS:
            assert rows[0]["status"] == "pending"
            assert rows[0]["next_attempt_at"] == t + wh.backoff_s(attempt)
            assert wh.drain(poster=lambda *a: 500, now=t + 1)["sent"] == 0   # not due yet
            t = rows[0]["next_attempt_at"]
    assert wh.deliveries("u1", made["id"])[0]["status"] == "failed"
    assert wh.list_webhooks("u1")[0]["consecutive_failures"] == wh.MAX_ATTEMPTS


def test_send_time_recheck_refuses_a_rebound_host(armed):
    made = wh.create("u1", "https://hooks.example.com/a")
    wh.enqueue_fire("u1", FIRE)
    called = []
    out = wh.drain(poster=lambda *a: called.append(a) or 200, resolver=PRIVATE, now=T0)
    assert called == [] and out["retry"] == 1
    assert "private" in wh.deliveries("u1", made["id"])[0]["last_error"]


def test_per_member_hourly_cap_records_drops(armed, monkeypatch):
    monkeypatch.setenv("WEBHOOK_HOURLY_CAP", "2")
    made = wh.create("u1", "https://hooks.example.com/a")
    for i in range(3):
        wh.enqueue_fire("u1", {**FIRE, "fire_id": 100 + i})
    statuses = sorted(r["status"] for r in wh.deliveries("u1", made["id"]))
    assert statuses == ["dropped_rate", "pending", "pending"]


def test_a_revoked_webhook_is_not_sent(armed):
    made = wh.create("u1", "https://hooks.example.com/a")
    wh.enqueue_fire("u1", FIRE)
    wh.revoke("u1", made["id"])
    called = []
    wh.drain(poster=lambda *a: called.append(a) or 200, now=T0)
    assert called == []
    assert wh.deliveries("u1", made["id"])[0]["status"] == "dropped_revoked"


# ── FT-036 routing through the real S7 delivery wrapper ────────────────────

def _fire(fire_key="k1"):
    return receipts.record_fire(predicate_id="p1", trigger_type="document-arrival", user_id="u1",
                                entity_ref="AAPL", fire_key=fire_key, as_of=1700000000.0)


def _fake_payload(calls):
    def f(**kw):
        calls.append(kw)
        return {"claimed": True, "channels": {"in_app": "ok", "email": "skipped"},
                "channels_ok": 1, "channels_failed": 0, "errors": {}}
    return f


def test_suspend_records_the_fire_and_sends_nothing(armed, monkeypatch):
    calls = []
    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", _fake_payload(calls))
    wh.create("u1", "https://hooks.example.com/a")
    routing_rule.suspend("u1")
    fid = _fire()
    report = delivery.deliver(fid, "u1", "AAPL", "t", "m", source="document_arrival")
    assert report["suspended"] is True and calls == []
    fire = [f for f in receipts.list_fires("u1") if f["id"] == fid][0]
    assert fire["delivery_channels"] == {"routing": "suspended"}       # recorded, not deleted
    assert wh.deliveries("u1", wh.list_webhooks("u1")[0]["id"]) == []  # no webhook either
    routing_rule.resume("u1")
    fid2 = _fire("k2")
    delivery.deliver(fid2, "u1", "AAPL", "t", "m", source="document_arrival")
    assert len(calls) == 1


def test_the_rule_reaches_the_fanout_and_gates_the_webhook(armed, monkeypatch):
    calls = []
    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", _fake_payload(calls))
    made = wh.create("u1", "https://hooks.example.com/a")
    routing_rule.set_channels("u1", email=False, webhook=False)
    delivery.deliver(_fire(), "u1", "AAPL", "t", "m", source="document_arrival")
    assert calls[0]["channels_allowed"] == frozenset({"push"})
    assert wh.deliveries("u1", made["id"]) == []
    routing_rule.set_channels("u1", webhook=True)
    report = delivery.deliver(_fire("k2"), "u1", "AAPL", "t", "m", source="document_arrival")
    assert report["channels"]["webhook"] == "queued"


def test_dark_routing_leaves_delivery_unchanged(monkeypatch):
    calls = []
    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", _fake_payload(calls))
    routing_rule.suspend("u1")                         # a stored rule, never applied while dark
    delivery.deliver(_fire(), "u1", "AAPL", "t", "m", source="document_arrival")
    assert len(calls) == 1 and "channels_allowed" not in calls[0]


def test_the_fanout_honours_channels_allowed(monkeypatch):
    from api.services import watchlist_alert_service as was
    sent = []
    monkeypatch.setattr(was, "add_alert", lambda *a, **k: None)
    monkeypatch.setattr(was, "_get_user_email", lambda uid: "m@example.com")
    monkeypatch.setattr(was, "send_email", lambda *a, **k: sent.append(a) or True)
    pushed = []
    monkeypatch.setattr(was, "_push_channel", lambda *a, **k: pushed.append(a))
    r = was.deliver_alert_payload("u1", "AAPL", "t", "m", source="document_arrival",
                                  channels_allowed=frozenset({"webhook"}))
    assert sent == [] and pushed == [] and r["channels"]["email"] == "skipped"
    was.deliver_alert_payload("u1", "AAPL", "t2", "m", source="document_arrival")
    assert len(sent) == 1 and len(pushed) == 1


# ── routes ──────────────────────────────────────────────────────────────────

def _client(monkeypatch, paid=True, uid="u1"):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(rx, "is_paid_user", lambda u: paid)
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": uid, "plan": "pro"}
    return TestClient(app)


def test_routes_are_dark_by_default(monkeypatch):
    c = _client(monkeypatch)
    for m, p in [("get", "/api/alerts/routing"), ("post", "/api/alerts/routing/suspend"),
                 ("get", "/api/alerts/webhooks"), ("post", "/api/alerts/webhooks/x/test")]:
        assert getattr(c, m)(p).status_code == 404, p


def test_routes_are_paid(armed, monkeypatch):
    c = _client(monkeypatch, paid=False)
    assert c.get("/api/alerts/routing").status_code == 402
    assert c.get("/api/alerts/webhooks").status_code == 402


def test_route_round_trip(armed, monkeypatch):
    c = _client(monkeypatch)
    r = c.post("/api/alerts/webhooks", json={"url": "https://hooks.example.com/a"})
    assert r.status_code == 200 and r.json()["secret"].startswith("whsec_")
    wid = r.json()["id"]
    assert c.post("/api/alerts/webhooks", json={"url": "http://x.example.com"}).status_code == 400
    assert c.post(f"/api/alerts/webhooks/{wid}/test").json()["queued"].startswith("whd_")
    assert len(c.get(f"/api/alerts/webhooks/{wid}/deliveries").json()["deliveries"]) == 1
    other = _client(monkeypatch, uid="u2")
    assert other.delete(f"/api/alerts/webhooks/{wid}").status_code == 404
    assert other.get(f"/api/alerts/webhooks/{wid}/deliveries").status_code == 404
    assert c.post("/api/alerts/routing/suspend").json()["suspended"] is True
    assert c.put("/api/alerts/routing", json={"email": False}).json()["email"] is False
    assert c.post("/api/alerts/routing/resume").json()["suspended"] is False
