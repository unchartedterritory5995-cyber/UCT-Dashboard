"""AC-4: per-trigger-type queue caps with a reserve.

The PRD's own acceptance test: arm enough catalyst-match fires to exhaust a
naive global cap, and position-risk still delivers in the same window. Plus:
a capped fire is RECORDED (never dropped), dark is byte-identical, and the
reserve arithmetic is internally consistent.
"""
from __future__ import annotations

import pytest

from api.services import watchlist_alert_service as wls
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import delivery
from api.services.alert_taxonomy import queue_caps as qc
from api.services.alert_taxonomy import receipts


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = str(tmp_path / "alert_taxonomy.db")
    monkeypatch.setattr(at_db, "DB_PATH", path)
    monkeypatch.delenv(qc.FLAG, raising=False)
    monkeypatch.delenv("ALERT_ROUTING_RULE_ENABLED", raising=False)
    monkeypatch.delenv("ALERT_WEBHOOKS_ENABLED", raising=False)
    sent = []

    def fake_payload(**kw):
        sent.append(kw)
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}

    monkeypatch.setattr(wls, "deliver_alert_payload", fake_payload)
    return {"sent": sent, "mp": monkeypatch}


_n = {"i": 0}


def _fire(ttype, user="u1"):
    _n["i"] += 1
    fid = receipts.record_fire(f"p:{ttype}", ttype, user, "AAPL", f"k{_n['i']}", as_of=1.0)
    return delivery.deliver(fid, user, "AAPL", "t", "m", source=ttype.replace("-", "_"))


def test_the_reserves_fit_inside_the_total():
    assert sum(qc.reserve_for(t) for t in qc.KNOWN_TYPES) <= qc.TOTAL
    for t in qc.KNOWN_TYPES:
        assert qc.reserve_for(t) <= qc.cap_for(t)


def test_PRD_AC4_a_catalyst_flood_never_starves_position_risk(store):
    store["mp"].setenv(qc.FLAG, "1")
    outcomes = [_fire("catalyst-match") for _ in range(qc.TOTAL + 5)]
    delivered = [o for o in outcomes if not o.get("capped")]
    assert len(delivered) == qc.cap_for("catalyst-match")      # its own cap holds
    # Same window: position-risk still goes out, through its whole reserve.
    for _ in range(qc.reserve_for("position-risk")):
        assert not _fire("position-risk").get("capped")


def test_CONTROL_dark_the_same_flood_is_all_sent(store):
    outcomes = [_fire("catalyst-match") for _ in range(qc.TOTAL + 5)]
    assert not any(o.get("capped") for o in outcomes)
    assert len(store["sent"]) == qc.TOTAL + 5


def test_a_capped_fire_is_recorded_with_its_reason_never_dropped(store):
    store["mp"].setenv(qc.FLAG, "1")
    for _ in range(qc.cap_for("catalyst-match") + 1):
        _fire("catalyst-match")
    fires = receipts.list_fires("u1", limit=100)
    assert len(fires) == qc.cap_for("catalyst-match") + 1
    capped = [f for f in fires if f["delivery_channels"] == qc.CAPPED]
    assert len(capped) == 1


def test_the_shared_pool_runs_out_but_never_a_reserve():
    used = {t: qc.cap_for(t) for t in ("catalyst-match", "indicator-condition", "event-proximity")}
    # Whatever the flood, an untouched type is still inside its own reserve.
    assert qc.decide("position-risk", used) is True
    assert qc.decide("rating-change", used) is True


def test_a_type_beyond_its_reserve_competes_for_the_shared_pool():
    t = "indicator-condition"
    assert qc.decide(t, {t: qc.reserve_for(t)}) is True          # pool is wide open
    held = sum(qc.reserve_for(u) for u in qc.KNOWN_TYPES if u != t)
    full = {t: qc.reserve_for(t), "x-filler": qc.TOTAL - held - qc.reserve_for(t)}
    assert qc.decide(t, full) is False                            # only reserves left


def test_a_routing_suspended_or_capped_fire_consumes_nothing(store):
    store["mp"].setenv(qc.FLAG, "1")
    fid = receipts.record_fire("p", "position-risk", "u1", "AAPL", "kz", as_of=1.0)
    receipts.record_delivery_channels(fid, {"routing": "suspended"})
    fid2 = receipts.record_fire("p", "position-risk", "u1", "AAPL", "kz2", as_of=1.0)
    receipts.record_delivery_channels(fid2, dict(qc.CAPPED))
    assert qc.used_in_window("u1") == {}


def test_a_counting_failure_admits(store, monkeypatch):
    store["mp"].setenv(qc.FLAG, "1")

    def boom(*a, **k):
        raise RuntimeError("db locked")

    monkeypatch.setattr(qc, "used_in_window", boom)
    assert qc.admit("u1", "catalyst-match") is True
