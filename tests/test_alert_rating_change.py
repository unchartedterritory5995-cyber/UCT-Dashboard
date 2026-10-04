"""FT-034: the `rating-change` S7 trigger type (dark).

The analyst feed and the shared delivery function are faked; this proves the
evaluator's own rules: no history replay, alert_fires as the durable record
(never user_alerts), one fetch per ticker, provider failure = could-not-evaluate,
dark does nothing, suspend never deletes.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import delivery, ops_monitor, predicates, receipts
from api.services.alert_taxonomy import rating_change as rc
from api.services.alert_taxonomy.predicates import PredicateRegistrationError


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    monkeypatch.setattr(predicates, "resolve_entity_scope",
                        lambda t, **k: {"kind": "entity", "id": t.upper(), "asOf": None,
                                        "entity_status": "unresolved", "symbol": t.upper()})
    monkeypatch.setenv(rc.FLAG, "1")
    for f in ("ALERT_ROUTING_RULE_ENABLED", "ALERT_QUEUE_CAPS_ENABLED", "ALERT_WEBHOOKS_ENABLED"):
        monkeypatch.delenv(f, raising=False)
    rc.register()
    sent = []

    def fake(**kw):
        sent.append(kw)
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}

    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", fake)
    return {"sent": sent, "mp": monkeypatch}


def A(date, company, action, frm=None, to=None):
    return {"date": date, "company": company, "action": action, "from_grade": frm, "to_grade": to}


OLD = A("2026-09-01", "Morgan Stanley", "maintain", "Buy", "Buy")


class Feed:
    def __init__(self, items):
        self.items = items
        self.calls = []

    def __call__(self, t):
        self.calls.append(t)
        if isinstance(self.items, Exception):
            return {"error": str(self.items)}
        return {"items": list(self.items)}


def test_no_history_replay_then_a_new_upgrade_fires(store):
    feed = Feed([OLD, A("2026-08-01", "Jefferies", "upgrade", "Hold", "Buy")])
    rc.register_predicate_for_user("u1", "nvda", fetch=feed)
    out = rc.run_sweep(fetch=feed)
    assert out["fired"] == 0 and store["sent"] == []        # the existing upgrade is history
    feed.items = [A("2026-10-01", "Goldman", "upgrade", "Neutral", "Buy")] + feed.items
    out = rc.run_sweep(fetch=feed)
    assert out["fired"] == 1
    (f,) = receipts.list_fires("u1", limit=10)
    assert f["trigger_type"] == "rating-change" and f["entity_ref"] == "NVDA"
    assert f["detail"]["company"] == "Goldman" and f["detail"]["to_grade"] == "Buy"
    assert f["source_data_class"] == "analyst_grades"
    assert "upgraded" in store["sent"][0]["title"]


def test_the_same_action_never_fires_twice(store):
    feed = Feed([OLD])
    rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    feed.items = [A("2026-10-01", "Goldman", "downgrade", "Buy", "Hold"), OLD]
    assert rc.run_sweep(fetch=feed)["fired"] == 1
    assert rc.run_sweep(fetch=feed)["fired"] == 0
    assert len(receipts.list_fires("u1", limit=10)) == 1


def test_a_watermark_that_aged_out_of_the_feed_never_replays_history(store):
    """The provider window slides: the keyed action can vanish from the feed.
    An older upgrade still in the window is history, never a new alert."""
    feed = Feed([OLD, A("2026-08-01", "Jefferies", "upgrade", "Hold", "Buy")])
    rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    feed.items = [A("2026-08-01", "Jefferies", "upgrade", "Hold", "Buy")]   # OLD aged out
    assert rc.run_sweep(fetch=feed)["fired"] == 0 and store["sent"] == []
    # CONTROL: an action dated after the watermark still fires.
    feed.items = [A("2026-10-01", "Goldman", "upgrade", "Hold", "Buy")] + feed.items
    assert rc.run_sweep(fetch=feed)["fired"] == 1


def test_a_maintain_is_not_a_change_by_default(store):
    feed = Feed([OLD])
    rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    feed.items = [A("2026-10-01", "UBS", "maintain", "Buy", "Buy"), OLD]
    assert rc.run_sweep(fetch=feed)["fired"] == 0
    # CONTROL: a predicate that asked for initiations does fire on one.
    feed2 = Feed([OLD])
    rc.register_predicate_for_user("u2", "AMD", actions=["initiate"], fetch=feed2)
    feed.items = [A("2026-10-02", "UBS", "initiate", None, "Buy"), OLD]
    assert rc.run_sweep(fetch=feed)["fired"] == 1


def test_one_fetch_per_distinct_ticker(store):
    feed = Feed([OLD])
    for u in ("u1", "u2", "u3"):
        rc.register_predicate_for_user(u, "NVDA", fetch=feed)
    feed.calls.clear()
    out = rc.run_sweep(fetch=feed)
    assert feed.calls == ["NVDA"] and out["distinct_fetches"] == 1


def test_a_provider_failure_is_could_not_evaluate_never_no_change(store):
    feed = Feed([OLD])
    rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    feed.items = RuntimeError("FMP 503")
    out = rc.run_sweep(fetch=feed)
    assert len(out["errors"]) == 1 and out["fired"] == 0
    rep = ops_monitor.report()
    t = rep["trigger_types"]["rating-change"]
    assert t["could_not_evaluate"] == 1 and t["status"] == "degraded"


def test_registration_refuses_an_unreadable_feed_and_a_bad_action(store):
    with pytest.raises(PredicateRegistrationError):
        rc.register_predicate_for_user("u1", "NVDA", fetch=Feed(RuntimeError("down")))
    with pytest.raises(PredicateRegistrationError):
        rc.register_predicate_for_user("u1", "NVDA", actions=["explode"], fetch=Feed([OLD]))


def test_dark_the_sweep_does_nothing(store):
    feed = Feed([OLD])
    rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    store["mp"].delenv(rc.FLAG)
    feed.items = [A("2026-10-01", "Goldman", "upgrade", "Hold", "Buy"), OLD]
    out = rc.run_sweep(fetch=feed)
    assert out == {"enabled": False, "checked": 0, "fired": 0, "errors": []}


def test_the_durable_record_is_alert_fires_never_user_alerts(store, tmp_path):
    feed = Feed([OLD])
    rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    feed.items = [A("2026-10-01", "Goldman", "upgrade", "Hold", "Buy"), OLD]
    rc.run_sweep(fetch=feed)
    c = sqlite3.connect(str(tmp_path / "alert_taxonomy.db"))
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    c.close()
    assert "user_alerts" not in names
    src = open(rc.__file__, encoding="utf-8").read()
    assert "user_alerts" not in src.replace("NEVER `user_alerts`", "")


def test_suspend_keeps_the_predicate_and_its_fires(store):
    feed = Feed([OLD])
    pid = rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    feed.items = [A("2026-10-01", "Goldman", "upgrade", "Hold", "Buy"), OLD]
    rc.run_sweep(fetch=feed)
    assert predicates.suspend_predicate(pid, "u1")
    assert predicates.get_predicate(pid) is not None
    assert len(receipts.list_fires("u1", limit=10)) == 1
    assert rc.run_sweep(fetch=feed)["checked"] == 0


# ── the feed (filing-watch parity steps 2 + 3 for this type) ─────────────────

def _feed_fixture(store, tmp_path):
    """Real delivery into the real in-app feed (temp stores)."""
    from api.services import alert_durability, auth_db
    from api.services import alerts as alerts_svc
    from api.services import watchlist_alert_service as wls
    store["mp"].setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    store["mp"].setattr(alert_durability, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    alert_durability.init_schema()
    store["mp"].setattr(delivery.watchlist_alert_service, "deliver_alert_payload", _REAL_PAYLOAD)
    store["mp"].setattr(wls, "_get_user_email", lambda uid: None)
    return alerts_svc


from api.services import watchlist_alert_service as _wls_mod  # noqa: E402
_REAL_PAYLOAD = _wls_mod.deliver_alert_payload


def _fire_one(store):
    feed = Feed([OLD])
    rc.register_predicate_for_user("u1", "NVDA", fetch=feed)
    feed.items = [A("2026-10-01", "Goldman", "upgrade", "Hold", "Buy"), OLD]
    assert rc.run_sweep(fetch=feed)["fired"] == 1


def test_the_feed_carries_ONE_copy_while_both_stores_hold_the_fire(store, tmp_path):
    alerts_svc = _feed_fixture(store, tmp_path)
    _fire_one(store)
    feed = [a for a in alerts_svc.get_alerts(limit=50, user_id="u1") if "NVDA" in a.get("title", "")]
    assert len(feed) == 1, feed


def test_the_durable_reconstruction_takes_over_when_the_ephemeral_copy_is_gone(store, tmp_path):
    alerts_svc = _feed_fixture(store, tmp_path)
    _fire_one(store)
    alerts_svc.cache.set(alerts_svc._user_key("u1"), [], ttl=60)   # the ephemeral copy expires
    store["mp"].setattr("api.services.alert_durability.list_durable_alerts", lambda *a, **k: [])
    feed = [a for a in alerts_svc.get_alerts(limit=50, user_id="u1")
            if str(a.get("id", "")).startswith(alerts_svc._S7_FIRE_PREFIX)]
    assert len(feed) == 1
    assert feed[0]["title"] == "NVDA upgraded by Goldman"
    assert feed[0]["data"]["source"] == "rating_change"
