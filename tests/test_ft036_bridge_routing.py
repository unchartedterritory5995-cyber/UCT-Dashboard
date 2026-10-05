"""FT-036 on the TERM-048 bridge (`watchlist_alert_service._deliver_via_s7`).

The routing rule already governed `alert_taxonomy.delivery.deliver`; the price
alert bridge has its own fan-out (`_deliver_alert`) and ignored it. These rails
prove, each with a control:

  1. Rule DARK: the bridge delivers exactly as before (email sent, push sent).
  2. Rule ON + suspended: the fire is RECORDED in alert_fires with
     `{"routing": "suspended"}` and nothing is sent; the watchlist row stays.
  3. Rule ON + email off: email is SKIPPED (not failed), the bell still lands.
  4. Rule ON + push off: push is never dispatched; control: push on dispatches.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import alert_durability
from api.services import auth_db
from api.services import watchlist_alert_service as wls
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import receipts
from api.services.alert_taxonomy import routing_rule
from api.services.alert_taxonomy import watchlist_price_alerts as wpa


@pytest.fixture
def env(tmp_path, monkeypatch):
    auth_path = str(tmp_path / "auth.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", auth_path)
    monkeypatch.setattr(alert_durability, "_DB_PATH", auth_path)
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    monkeypatch.setenv(wpa.FLAG, "1")
    monkeypatch.delenv(routing_rule.FLAG, raising=False)
    monkeypatch.setenv("DISCORD_ALERT_WEBHOOK", "")
    auth_db.init_db()
    alert_durability.init_schema()
    user = f"u_{uuid.uuid4().hex[:10]}"
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO users (id, email, password_hash) VALUES (?,?,?)",
                 (user, f"{user}@local.test", "x"))
    conn.commit()
    conn.close()
    sent = {"email": [], "push": [], "bell": []}
    real_add = wls.add_alert

    def spy_add(*a, **k):
        sent["bell"].append(a)
        return real_add(*a, **k)

    monkeypatch.setattr(wls, "add_alert", spy_add)
    monkeypatch.setattr(wls, "send_email", lambda to, s, h: sent["email"].append(to) or True)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: "member@test")
    monkeypatch.setattr(wls, "_push_channel", lambda *a, **k: sent["push"].append(a))
    return {"user": user, "sent": sent, "mp": monkeypatch}


def _cross(env):
    a = wls.create_alert(env["user"], "AKAM", 95.0, "above")
    reports: list = []
    wls.check_alerts_against_prices({"AKAM": 96.0}, reports=reports)
    return a, reports


def test_rule_dark_the_bridge_delivers_exactly_as_before(env):
    routing_rule.suspend(env["user"])          # stored, but the surface is dark
    _, reports = _cross(env)
    assert env["sent"]["email"] == ["member@test"]
    assert len(env["sent"]["push"]) == 1 and len(env["sent"]["bell"]) == 1
    assert "routing" not in reports[0]["channels"]


def test_rule_on_suspended_records_the_fire_and_sends_nothing(env):
    env["mp"].setenv(routing_rule.FLAG, "1")
    routing_rule.suspend(env["user"])
    a, reports = _cross(env)
    assert env["sent"] == {"email": [], "push": [], "bell": []}
    (f,) = receipts.list_fires(env["user"], limit=10)
    assert f["delivery_channels"] == {"routing": "suspended"}
    assert f["predicate_id"] == f"watchlist:{a['id']}"
    assert reports[0]["suspended"] is True
    # Never a delete: the member's alert row is still there (deactivated by the fire).
    conn = auth_db.get_connection()
    try:
        assert conn.execute("SELECT 1 FROM watchlist_alerts WHERE id=?", (a["id"],)).fetchone()
    finally:
        conn.close()


def test_CONTROL_rule_on_not_suspended_delivers(env):
    env["mp"].setenv(routing_rule.FLAG, "1")
    _cross(env)
    assert env["sent"]["email"] == ["member@test"] and len(env["sent"]["push"]) == 1


def test_rule_on_email_off_skips_email_and_keeps_the_bell(env):
    env["mp"].setenv(routing_rule.FLAG, "1")
    routing_rule.set_channels(env["user"], email=False)
    _, reports = _cross(env)
    assert env["sent"]["email"] == []
    assert reports[0]["channels"]["email"] == "skipped"
    assert reports[0]["channels"]["in_app"] == "ok"
    assert len(env["sent"]["push"]) == 1


def test_rule_on_push_off_never_dispatches_push(env):
    env["mp"].setenv(routing_rule.FLAG, "1")
    routing_rule.set_channels(env["user"], push=False)
    _cross(env)
    assert env["sent"]["push"] == []
    assert env["sent"]["email"] == ["member@test"]


def test_an_unreadable_rule_fails_to_unrouted_delivery(env):
    env["mp"].setenv(routing_rule.FLAG, "1")

    def boom(_uid):
        raise RuntimeError("store down")

    env["mp"].setattr(routing_rule, "effective", boom)
    _cross(env)
    assert env["sent"]["email"] == ["member@test"]
