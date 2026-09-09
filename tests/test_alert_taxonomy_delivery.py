"""delivery.py -- the thin wrapper over watchlist_alert_service.deliver_alert_payload.
Mocks the reused function itself (already tested in its own suite); this
file only proves the wrapper's own fire-once + recording behavior."""
import pytest

from api.services.alert_taxonomy import delivery, receipts


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "alert_taxonomy.db")


def _fire(db_path, fire_key="occ:1"):
    return receipts.record_fire(
        predicate_id="p1", trigger_type="document-arrival", user_id="u1",
        entity_ref="AAPL", fire_key=fire_key, as_of=1700000000.0, db_path=db_path,
    )


def test_deliver_claims_calls_the_shared_function_and_records_channels(db_path, monkeypatch):
    fid = _fire(db_path)
    calls = []

    def fake_deliver_alert_payload(**kwargs):
        calls.append(kwargs)
        return {"claimed": True, "channels": {"in_app": "ok", "email": "skipped", "discord": "skipped"},
                "channels_ok": 1, "channels_failed": 0, "errors": {}}

    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", fake_deliver_alert_payload)
    monkeypatch.setattr(delivery._receipts, "claim_delivery", lambda fire_id, db_path=None: True)
    monkeypatch.setattr(delivery._receipts, "record_delivery_channels", lambda *a, **k: True)

    report = delivery.deliver(fid, "u1", "AAPL", "title", "message", source="document_arrival")
    assert len(calls) == 1
    assert calls[0]["source"] == "document_arrival"
    assert calls[0]["user_id"] == "u1"
    assert report["channels_ok"] == 1


def test_deliver_never_calls_the_shared_function_when_the_lease_is_already_claimed(db_path, monkeypatch):
    fid = _fire(db_path)
    calls = []
    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload",
                        lambda **kw: calls.append(kw) or {"claimed": True, "channels": {}, "channels_ok": 0, "channels_failed": 0, "errors": {}})
    monkeypatch.setattr(delivery._receipts, "claim_delivery", lambda fire_id, db_path=None: False)

    report = delivery.deliver(fid, "u1", "AAPL", "title", "message", source="document_arrival")
    assert calls == []
    assert report == {"claimed": False, "channels": {}, "channels_ok": 0, "channels_failed": 0, "errors": {}}


def test_deliver_never_auto_retries_on_partial_failure(db_path, monkeypatch):
    """The deliberate design decision: a partial failure is recorded, never
    released for retry -- proves the duplicate-notification guard."""
    fid = _fire(db_path)
    release_calls = []
    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload",
                        lambda **kw: {"claimed": True, "channels": {"in_app": "ok", "email": "failed"},
                                     "channels_ok": 1, "channels_failed": 1, "errors": {"email": "boom"}})
    monkeypatch.setattr(delivery._receipts, "claim_delivery", lambda fire_id, db_path=None: True)
    monkeypatch.setattr(delivery._receipts, "record_delivery_channels", lambda *a, **k: True)
    monkeypatch.setattr(delivery._receipts, "release_delivery", lambda *a, **k: release_calls.append(a))

    delivery.deliver(fid, "u1", "AAPL", "title", "message", source="document_arrival")
    assert release_calls == []  # never called
