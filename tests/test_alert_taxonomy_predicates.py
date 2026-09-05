"""Predicate registration/lifecycle + S3 entity resolution (S7 first slice).

Real Entity Master, isolated DB per test -- same fixture pattern as
test_research_entity_resolution.py (this session's A3/A4 slice).
"""
import threading

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


class TestDuplicateGuard:
    """Stage 3: at most one ACTIVE predicate per (user, type, canonical entity)."""

    def _register_type(self, db_path):
        registry.register_trigger_type("document-arrival", {"form_type": "string|null"},
                                        module="test", db_path=db_path)

    def test_same_user_same_entity_twice_reuses_the_predicate(self, db_path):
        self._register_type(db_path)
        scope = {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}
        pid1 = predicates.register_predicate("document-arrival", scope, {}, "u1", db_path=db_path)
        pid2 = predicates.register_predicate("document-arrival", scope, {}, "u1", db_path=db_path)
        assert pid1 == pid2
        rows = predicates.list_predicates(user_id="u1", active_only=False, db_path=db_path)
        assert len(rows) == 1

    def test_rapid_repeated_requests_never_exceed_one_row(self, db_path):
        self._register_type(db_path)
        scope = {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}
        ids = {predicates.register_predicate("document-arrival", scope, {}, "u1", db_path=db_path)
               for _ in range(25)}
        assert len(ids) == 1
        assert len(predicates.list_predicates(user_id="u1", active_only=False, db_path=db_path)) == 1

    def test_different_params_for_the_same_entity_still_dedupes(self, db_path):
        """A1: params (form_type/keyword) are deliberately NOT part of the
        equivalence key -- no member UI exposes them yet."""
        self._register_type(db_path)
        scope = {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}
        pid1 = predicates.register_predicate("document-arrival", scope, {"form_type": "8-K"}, "u1", db_path=db_path)
        pid2 = predicates.register_predicate("document-arrival", scope, {"form_type": "10-Q"}, "u1", db_path=db_path)
        assert pid1 == pid2

    def test_concurrent_duplicate_creation_lands_exactly_one_active_row(self, db_path):
        """A4: proves the race-safety mechanically against a real on-disk
        SQLite DB with real concurrent connections/threads racing the
        SELECT-then-INSERT window -- not a mocked check."""
        self._register_type(db_path)
        scope = {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}
        results: list[str] = []
        errors: list[Exception] = []
        barrier = threading.Barrier(10)

        def _attempt():
            try:
                barrier.wait(timeout=5)
                pid = predicates.register_predicate("document-arrival", scope, {}, "u1", db_path=db_path)
                results.append(pid)
            except Exception as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=_attempt) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert not errors, f"unexpected errors: {errors}"
        assert len(results) == 10
        assert len(set(results)) == 1, f"expected one winning predicate id, got {set(results)}"
        active_rows = predicates.list_predicates(user_id="u1", type_id="document-arrival",
                                                  active_only=True, db_path=db_path)
        assert len(active_rows) == 1

    def test_different_user_same_entity_both_allowed(self, db_path):
        self._register_type(db_path)
        scope = {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}
        pid1 = predicates.register_predicate("document-arrival", scope, {}, "u1", db_path=db_path)
        pid2 = predicates.register_predicate("document-arrival", scope, {}, "u2", db_path=db_path)
        assert pid1 != pid2
        assert len(predicates.list_predicates(type_id="document-arrival", active_only=False, db_path=db_path)) == 2

    def test_same_user_different_entity_both_allowed(self, db_path):
        self._register_type(db_path)
        pid1 = predicates.register_predicate(
            "document-arrival", {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}, {}, "u1", db_path=db_path)
        pid2 = predicates.register_predicate(
            "document-arrival", {"kind": "entity", "id": "AAPL", "symbol": "AAPL"}, {}, "u1", db_path=db_path)
        assert pid1 != pid2
        assert len(predicates.list_predicates(user_id="u1", active_only=False, db_path=db_path)) == 2

    def test_suspended_equivalent_is_reactivated_not_duplicated(self, db_path):
        self._register_type(db_path)
        scope = {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}
        pid1 = predicates.register_predicate("document-arrival", scope, {}, "u1", db_path=db_path)
        assert predicates.suspend_predicate(pid1, "u1", db_path=db_path) is True
        assert predicates.get_predicate(pid1, db_path=db_path)["suspended_at"] is not None

        pid2 = predicates.register_predicate("document-arrival", scope, {}, "u1", db_path=db_path)

        assert pid2 == pid1, "reactivation must reuse the existing row, not create a second one"
        row = predicates.get_predicate(pid1, db_path=db_path)
        assert row["suspended_at"] is None
        assert len(predicates.list_predicates(user_id="u1", active_only=False, db_path=db_path)) == 1

    def test_owner_isolation_unaffected_by_the_guard(self, db_path):
        """Regression: suspend is still ownership-scoped after the guard change."""
        self._register_type(db_path)
        pid = predicates.register_predicate(
            "document-arrival", {"kind": "entity", "id": "NVDA", "symbol": "NVDA"}, {}, "u1", db_path=db_path)
        assert predicates.suspend_predicate(pid, "not-the-owner", db_path=db_path) is False
        assert predicates.get_predicate(pid, db_path=db_path)["suspended_at"] is None

    def test_dedup_keys_off_the_canonical_entity_id_not_the_ticker_string(self, db_path):
        """Two different raw ticker inputs that resolve to the SAME canonical
        S3 entity must dedupe -- the guard reads entity_scope.id (the
        resolved entity id), never the raw symbol string."""
        self._register_type(db_path)
        eid = _seed_entity("AAPL")
        scope_a = predicates.resolve_entity_scope("AAPL")
        scope_b = predicates.resolve_entity_scope("aapl")  # same entity, different-case input
        assert scope_a["id"] == scope_b["id"] == eid

        pid1 = predicates.register_predicate("document-arrival", scope_a, {}, "u1", db_path=db_path)
        pid2 = predicates.register_predicate("document-arrival", scope_b, {}, "u1", db_path=db_path)
        assert pid1 == pid2
