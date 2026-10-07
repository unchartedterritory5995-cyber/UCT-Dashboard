"""FT-035 remind, on a per-channel read-state (dark: ALERT_REMIND_ENABLED)."""
from __future__ import annotations

import pytest

from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import predicates, receipts, routing_rule
from api.services.alert_taxonomy import rating_change as rc
from api.services.alert_taxonomy import remind

T0 = 1_800_000_000.0


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    monkeypatch.setattr(predicates, "resolve_entity_scope",
                        lambda t, **k: {"kind": "entity", "id": t, "asOf": None,
                                        "entity_status": "unresolved", "symbol": t})
    monkeypatch.setenv(remind.FLAG, "1")
    monkeypatch.delenv(routing_rule.FLAG, raising=False)
    rc.register()
    sent = []
    return {"sent": sent, "deliver": lambda **kw: sent.append(kw), "mp": monkeypatch}


def _fire(user="u1", channels=None, minutes=30, fired_at=T0, sym="NVDA"):
    pid = predicates.register_predicate("rating-change", predicates.resolve_entity_scope(sym),
                                        {"actions": ["upgrade"]}, user, None)
    if minutes is not None:
        remind.set_remind(user, pid, minutes)
    fid = receipts.record_fire(pid, "rating-change", user, sym, f"k{pid}", as_of=T0, fired_at=fired_at)
    receipts.record_delivery_channels(fid, channels or {"in_app": "ok", "email": "ok"})
    return pid, fid


def _run(store, now):
    return remind.remind_due(now=now, deliver=store["deliver"])


def test_an_unread_fire_is_reminded_once_after_its_delay(store):
    _, fid = _fire()
    assert _run(store, T0 + 29 * 60)["sent"] == 0             # not yet
    assert _run(store, T0 + 31 * 60)["sent"] == 1
    assert _run(store, T0 + 90 * 60)["sent"] == 0             # never twice
    kw = store["sent"][0]
    assert kw["extra_data"]["fire_id"] == fid
    assert kw["channels_allowed"] == frozenset({"in_app", "email"})


def test_a_read_on_ANY_channel_cancels_the_reminder(store):
    _, fid = _fire()
    assert remind.mark_read(fid, "u1", "push", now=T0 + 60)
    assert _run(store, T0 + 3600)["sent"] == 0
    st = remind.read_state(fid, "u1")
    assert st["seen"] and set(st["reads"]) == {"push"}


def test_in_app_read_state_is_the_bells_own_column_one_authority(store):
    _, fid = _fire()
    assert remind.mark_read(fid, "u1", "in_app", now=T0 + 60)
    (f,) = receipts.list_fires("u1", limit=5)
    assert f["read_at"] == T0 + 60                            # written where the bell writes it
    assert _run(store, T0 + 3600)["sent"] == 0


def test_CONTROL_without_a_remind_setting_nothing_is_reminded(store):
    _fire(minutes=None)
    assert _run(store, T0 + 86400)["sent"] == 0


def test_a_withheld_fire_is_never_reminded(store):
    _fire(channels={"routing": "suspended"})
    _fire(user="u2", channels={"queue": "capped"})
    _fire(user="u3", channels={"in_app": "failed"})
    # A withheld marker beside an `ok` (a shape no writer produces today) is
    # still withheld: the marker, not the absence of `ok`, is what decides.
    _fire(user="u4", channels={"queue": "capped", "in_app": "ok"})
    _fire(user="u5", channels={"routing": "suspended", "in_app": "ok"})
    assert _run(store, T0 + 3600)["sent"] == 0


def test_a_suspended_routing_rule_withholds_the_reminder(store):
    store["mp"].setenv(routing_rule.FLAG, "1")
    _, fid = _fire()
    routing_rule.suspend("u1")
    out = _run(store, T0 + 3600)
    assert out["sent"] == 0 and out["suspended"] == 1
    assert remind.read_state(fid, "u1")["reminder_outcome"] == "suspended"


def test_remind_goes_only_to_channels_that_delivered_ok(store):
    _fire(channels={"in_app": "ok", "email": "failed"})
    _run(store, T0 + 3600)
    assert store["sent"][0]["channels_allowed"] == frozenset({"in_app"})


def test_a_reminder_bound_is_refused_and_another_members_alert_is_404(store):
    pid, fid = _fire()
    with pytest.raises(remind.RemindError):
        remind.set_remind("u1", pid, 1)
    assert remind.set_remind("intruder", pid, 30) is None
    assert remind.mark_read(fid, "intruder", "push") is False
    with pytest.raises(remind.RemindError):
        remind.mark_read(fid, "u1", "carrier-pigeon")


def test_clearing_a_reminder_is_a_null_write_never_a_delete(store):
    pid, _ = _fire()
    assert remind.set_remind("u1", pid, None)["remind_after_s"] is None
    assert predicates.get_predicate(pid) is not None


def test_dark_nothing_is_sent(store):
    _fire()
    store["mp"].delenv(remind.FLAG)
    assert _run(store, T0 + 3600) == {"enabled": False, "due": 0, "sent": 0,
                                      "suspended": 0, "errors": 0}


def test_a_reminder_claimed_by_another_worker_between_select_and_send_is_not_sent(store):
    """The race the INSERT-before-send claim exists for: a second worker selected
    the same fire, then the first worker claimed it."""
    _, fid = _fire()
    real = remind._delivered_ok

    def other_worker_claims_first(raw):
        c = remind._conn(None)
        c.execute("INSERT OR IGNORE INTO alert_fire_reminders (fire_id, reminded_at, outcome)"
                  " VALUES (?,?,?)", (fid, T0, "sent"))
        c.commit()
        c.close()
        return real(raw)

    store["mp"].setattr(remind, "_delivered_ok", other_worker_claims_first)
    assert _run(store, T0 + 3600)["sent"] == 0
    assert store["sent"] == []
