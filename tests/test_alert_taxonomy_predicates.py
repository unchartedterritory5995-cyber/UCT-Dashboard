"""Predicate registration/lifecycle + S3 entity resolution (S7 first slice).

Real Entity Master, isolated DB per test -- same fixture pattern as
test_research_entity_resolution.py (this session's A3/A4 slice).
"""
import pytest

from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store
from api.services.entity_master import api as em_api
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import registry
from api.services.alert_taxonomy import predicates
from api.services.alert_taxonomy.predicates import PredicateRegistrationError


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "alert_taxonomy.db")


@pytest.fixture(autouse=True)
def _isolated_entity_master(tmp_path, monkeypatch):
    em_db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(em_schema, "DB_PATH", em_db_path)
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    em_schema.init_db(db_path=em_db_path)
    yield
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


def _seed_entity(alias):
    r = em_api.apply_event(
        "new_entity", {"entity_type": "equity", "initial_alias": alias, "initial_alias_valid_from": "2020-01-01"},
        dedup_key=f"test:{alias}", source="admin_manual",
    )
    assert r.accepted
    return r.entity_id


class TestResolveEntityScope:
    def test_resolved_entity_uses_the_entity_id_as_scope_id(self):
        eid = _seed_entity("AAPL")
        scope = predicates.resolve_entity_scope("aapl")
        assert scope["kind"] == "entity"
        assert scope["id"] == eid
        assert scope["entity_status"] == "resolved"
        assert scope["symbol"] == "AAPL"

    def test_unresolved_symbol_falls_back_to_the_raw_symbol_honestly(self):
        scope = predicates.resolve_entity_scope("ZZZNOTREAL")
        assert scope["id"] == "ZZZNOTREAL"
        assert scope["entity_status"] == "not_found"


class TestRegisterPredicate:
    def _register_type(self, db_path):
        registry.register_trigger_type("document-arrival", {"form_type": "string|null"},
                                        module="test", db_path=db_path)

    def test_rejects_unregistered_type(self, db_path):
        with pytest.raises(PredicateRegistrationError, match="unregistered trigger type"):
            predicates.register_predicate("not-a-real-type", {"kind": "entity", "id": "AAPL"},
                                          {}, "u1", db_path=db_path)

    def test_rejects_missing_user_id(self, db_path):
        self._register_type(db_path)
        with pytest.raises(PredicateRegistrationError, match="user_id"):
            predicates.register_predicate("document-arrival", {"kind": "entity", "id": "AAPL"},
                                          {}, "", db_path=db_path)

    def test_rejects_empty_entity_scope(self, db_path):
        self._register_type(db_path)
        with pytest.raises(PredicateRegistrationError, match="entity_scope"):
            predicates.register_predicate("document-arrival", {}, {}, "u1", db_path=db_path)

    def test_rejects_non_dict_params(self, db_path):
        self._register_type(db_path)
        with pytest.raises(PredicateRegistrationError, match="params"):
            predicates.register_predicate("document-arrival", {"kind": "entity", "id": "AAPL"},
                                          "not-a-dict", "u1", db_path=db_path)

    def test_successful_registration_round_trips(self, db_path):
        self._register_type(db_path)
        eid = _seed_entity("AAPL")
        scope = predicates.resolve_entity_scope("AAPL")
        pid = predicates.register_predicate("document-arrival", scope, {"form_type": "8-K"}, "u1", db_path=db_path)
        assert pid.startswith("pred_")
        row = predicates.get_predicate(pid, db_path=db_path)
        assert row["type_id"] == "document-arrival"
        assert row["user_id"] == "u1"
        assert row["entity_scope"]["id"] == eid
        assert row["params"] == {"form_type": "8-K"}
        assert row["suspended_at"] is None
        assert row["last_seen_state"] is None


class TestLifecycle:
    def _make(self, db_path, user_id="u1"):
        registry.register_trigger_type("document-arrival", {}, module="test", db_path=db_path)
        return predicates.register_predicate(
            "document-arrival", {"kind": "entity", "id": "AAPL", "symbol": "AAPL"}, {}, user_id, db_path=db_path,
        )

    def test_list_predicates_filters_by_user_and_type(self, db_path):
        p1 = self._make(db_path, "u1")
        self._make(db_path, "u2")
        rows = predicates.list_predicates(user_id="u1", db_path=db_path)
        assert [r["id"] for r in rows] == [p1]

    def test_suspend_hides_from_active_only_list_but_preserves_the_row(self, db_path):
        pid = self._make(db_path)
        assert predicates.suspend_predicate(pid, "u1", db_path=db_path) is True
        assert predicates.list_predicates(user_id="u1", active_only=True, db_path=db_path) == []
        assert predicates.list_predicates(user_id="u1", active_only=False, db_path=db_path)[0]["id"] == pid
        assert predicates.get_predicate(pid, db_path=db_path)["suspended_at"] is not None

    def test_suspend_is_ownership_scoped(self, db_path):
        pid = self._make(db_path, "u1")
        assert predicates.suspend_predicate(pid, "not-the-owner", db_path=db_path) is False
        assert predicates.get_predicate(pid, db_path=db_path)["suspended_at"] is None

    def test_suspend_twice_is_not_re_suspended(self, db_path):
        pid = self._make(db_path)
        assert predicates.suspend_predicate(pid, "u1", db_path=db_path) is True
        assert predicates.suspend_predicate(pid, "u1", db_path=db_path) is False

    def test_update_last_seen_state_round_trips(self, db_path):
        pid = self._make(db_path)
        predicates.update_last_seen_state(pid, {"accession": "0000320193-24-000123"}, db_path=db_path)
        row = predicates.get_predicate(pid, db_path=db_path)
        assert row["last_seen_state"] == {"accession": "0000320193-24-000123"}

    def test_update_last_seen_state_on_missing_predicate_does_not_raise(self, db_path):
        predicates.update_last_seen_state("pred_does_not_exist", {"a": 1}, db_path=db_path)  # must not raise
