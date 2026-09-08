"""Alert Durability V1 -- unit tests for the storage module itself (CRUD,
retention cap, ownership isolation, read-marking). Integration-level proof
(the real dual-write through alerts.py, surviving a simulated cache loss) is
in tests/test_alert_durability_legacy.py, mirroring the existing S7 split
(api/services/test_* for the store, tests/test_* for the wired behavior)."""
import pytest

from api.services import alert_durability as ad


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(ad, "_DB_PATH", str(tmp_path / "auth.db"))
    ad.init_schema()
    yield


def _alert(id="a_1", user_id="u_a", type="scanner_match", read=False, data=None):
    return {"id": id, "user_id": user_id, "type": type, "severity": "info",
            "title": "T", "message": "M", "timestamp": "2026-09-06T12:00:00",
            "read": read, "data": data or {}}


class TestShouldPersist:
    def test_broadcast_alert_is_excluded(self):
        assert ad.should_persist(_alert(user_id=None)) is False

    def test_private_legacy_alert_is_included(self):
        assert ad.should_persist(_alert(user_id="u_a")) is True

    def test_s7_document_arrival_alert_is_excluded(self):
        # S7 already owns a separate, more capable durable pipeline --
        # writing it here too would create a third copy of the same fire.
        alert = _alert(user_id="u_a", type="document_arrival",
                       data={"source": "document_arrival", "accession": "A1"})
        assert ad.should_persist(alert) is False

    def test_a_private_alert_that_merely_mentions_a_sym_is_still_included(self):
        # Only the literal document_arrival source excludes -- an ordinary
        # price/catalyst alert with its own `data` dict must not be caught
        # by an overly broad check.
        alert = _alert(user_id="u_a", data={"sym": "AAPL", "research_url": "/research/AAPL"})
        assert ad.should_persist(alert) is True


class TestRecordAndList:
    def test_a_recorded_alert_is_listed_back(self):
        ad.record_alert(_alert())
        rows = ad.list_durable_alerts("u_a")
        assert len(rows) == 1
        assert rows[0]["id"] == "a_1"
        assert rows[0]["read"] is False

    def test_response_shape_matches_the_ephemeral_alert_contract(self):
        ad.record_alert(_alert(data={"sym": "AAPL"}))
        row = ad.list_durable_alerts("u_a")[0]
        for key in ("id", "type", "severity", "title", "message", "timestamp", "read", "user_id", "data"):
            assert key in row, f"durable row missing expected field {key!r}"
        assert row["data"] == {"sym": "AAPL"}

    def test_insert_is_idempotent_on_the_same_id(self):
        ad.record_alert(_alert())
        ad.record_alert(_alert())  # same id -- INSERT OR IGNORE
        assert len(ad.list_durable_alerts("u_a")) == 1

    def test_newest_first(self):
        ad.record_alert(_alert(id="a_1"))
        ad.record_alert(_alert(id="a_2"))
        ids = [r["id"] for r in ad.list_durable_alerts("u_a")]
        assert ids == ["a_2", "a_1"]

    def test_limit_is_respected(self):
        for i in range(5):
            ad.record_alert(_alert(id=f"a_{i}"))
        assert len(ad.list_durable_alerts("u_a", limit=2)) == 2

    def test_never_raises_on_a_missing_field(self):
        # Defensive: record_alert must not raise even on a malformed input --
        # a durability write must never be able to break the caller's own
        # ephemeral delivery path.
        ad.record_alert({"id": "bad"})  # missing user_id/type/etc
        assert ad.list_durable_alerts("u_a") == []


class TestOwnershipIsolation:
    def test_one_user_never_sees_another_users_rows(self):
        ad.record_alert(_alert(id="a_1", user_id="u_a"))
        ad.record_alert(_alert(id="a_2", user_id="u_b"))
        assert [r["id"] for r in ad.list_durable_alerts("u_a")] == ["a_1"]
        assert [r["id"] for r in ad.list_durable_alerts("u_b")] == ["a_2"]

    def test_mark_read_cannot_touch_another_users_row(self):
        ad.record_alert(_alert(id="a_1", user_id="u_a"))
        assert ad.mark_read("a_1", "u_b") is False
        assert ad.list_durable_alerts("u_a")[0]["read"] is False

    def test_clear_alerts_only_clears_the_named_user(self):
        ad.record_alert(_alert(id="a_1", user_id="u_a"))
        ad.record_alert(_alert(id="a_2", user_id="u_b"))
        ad.clear_alerts("u_a")
        assert ad.list_durable_alerts("u_a") == []
        assert len(ad.list_durable_alerts("u_b")) == 1


class TestReadState:
    def test_mark_read_is_idempotent(self):
        ad.record_alert(_alert())
        assert ad.mark_read("a_1", "u_a") is True
        assert ad.mark_read("a_1", "u_a") is True
        assert ad.list_durable_alerts("u_a")[0]["read"] is True

    def test_mark_read_on_a_nonexistent_id_returns_false(self):
        assert ad.mark_read("nope", "u_a") is False

    def test_mark_all_read_covers_only_unread_and_reports_the_count(self):
        ad.record_alert(_alert(id="a_1"))
        ad.record_alert(_alert(id="a_2"))
        ad.mark_read("a_1", "u_a")
        n = ad.mark_all_read("u_a")
        assert n == 1
        assert all(r["read"] for r in ad.list_durable_alerts("u_a"))

    def test_mark_all_read_is_scoped_to_one_user(self):
        ad.record_alert(_alert(id="a_1", user_id="u_a"))
        ad.record_alert(_alert(id="a_2", user_id="u_b"))
        ad.mark_all_read("u_a")
        assert ad.list_durable_alerts("u_a")[0]["read"] is True
        assert ad.list_durable_alerts("u_b")[0]["read"] is False


class TestRetentionCap:
    def test_writes_beyond_the_cap_evict_the_oldest(self, monkeypatch):
        monkeypatch.setattr(ad, "_MAX_PER_USER", 3)
        for i in range(5):
            ad.record_alert(_alert(id=f"a_{i}"))
        rows = ad.list_durable_alerts("u_a", limit=50)
        assert len(rows) == 3
        assert {r["id"] for r in rows} == {"a_2", "a_3", "a_4"}

    def test_the_cap_is_per_user_not_global(self, monkeypatch):
        monkeypatch.setattr(ad, "_MAX_PER_USER", 2)
        for i in range(3):
            ad.record_alert(_alert(id=f"a_{i}", user_id="u_a"))
        ad.record_alert(_alert(id="b_1", user_id="u_b"))
        assert len(ad.list_durable_alerts("u_a", limit=50)) == 2
        assert len(ad.list_durable_alerts("u_b", limit=50)) == 1
