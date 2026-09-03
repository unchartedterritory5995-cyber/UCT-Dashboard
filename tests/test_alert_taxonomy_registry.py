"""Trigger-type registration (S7 first slice)."""
import pytest

from api.services.alert_taxonomy import registry


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "alert_taxonomy.db")


def test_register_then_is_registered(db_path):
    assert not registry.is_registered("document-arrival", db_path=db_path)
    registry.register_trigger_type("document-arrival", {"form_type": "string|null"}, module="test", db_path=db_path)
    assert registry.is_registered("document-arrival", db_path=db_path)


def test_register_is_idempotent_upsert(db_path):
    registry.register_trigger_type("document-arrival", {"a": 1}, module="m1", db_path=db_path)
    registry.register_trigger_type("document-arrival", {"a": 2}, module="m2", db_path=db_path)
    types = registry.list_trigger_types(db_path=db_path)
    assert len(types) == 1
    assert types[0]["module"] == "m2"
    assert types[0]["params_schema"] == {"a": 2}


def test_list_trigger_types_round_trips_json(db_path):
    registry.register_trigger_type("document-arrival", {"form_type": "string|null", "keyword": "string|null"},
                                    module="api.services.alert_taxonomy.document_arrival", db_path=db_path)
    types = registry.list_trigger_types(db_path=db_path)
    assert types[0]["type_id"] == "document-arrival"
    assert types[0]["params_schema"]["form_type"] == "string|null"
