"""Alert Durability V1 (owner authorization, 2026-09-06 Whole-Product
Strategic Re-Anchor). `GET /api/alerts`'s ephemeral TTLCache does not
survive a process restart or redeploy (api/services/alerts.py's own
docstring). These tests prove a real LEGACY (non-S7) private alert --
indicator/catalyst/calendar/awareness/price-style, delivered through
`add_alert` exactly as production calls it -- stays visible via the durable
`user_alerts` table once the ephemeral copy is gone, with ownership,
read-state, dedup, and S7-exclusion all proven against the real merge in
api.services.alerts.get_alerts/mark_read/mark_all_read.

Mirrors tests/test_s7_durable_notifications.py's structure and conventions
exactly -- same fixture shape, same "_clear_cache simulates a redeploy"
idiom -- because this is the SAME durability property, closed for the
alert types S7's own bridge deliberately excludes.
"""
import pytest

from api.services import alerts as alerts_svc
from api.services import alert_durability as ad
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(ad, "_DB_PATH", str(tmp_path / "auth.db"))
    ad.init_schema()

    def _purge_cache():
        cache.invalidate("alerts")
        cache.delete_prefix("alerts:")
    _purge_cache()

    yield

    _purge_cache()


def _clear_cache():
    """Simulate a process restart / redeploy: the ephemeral store is gone."""
    cache.invalidate("alerts")
    cache.delete_prefix("alerts:")


def _rows(user_id, type_filter=None):
    out = alerts_svc.get_alerts(limit=20, user_id=user_id)
    return [a for a in out if type_filter is None or a["type"] == type_filter]


class TestDurability:
    def test_alert_visible_before_simulated_cache_loss(self):
        alerts_svc.add_alert("scanner_match", "New candidate", "XYZ crossed threshold.", user_id="u_a")
        assert len(_rows("u_a", "scanner_match")) == 1

    def test_alert_visible_after_simulated_cache_loss(self):
        alerts_svc.add_alert("scanner_match", "New candidate", "XYZ crossed threshold.",
                             user_id="u_a", data={"symbol": "XYZ"})
        _clear_cache()
        rows = _rows("u_a", "scanner_match")
        assert len(rows) == 1, f"alert did not survive simulated cache loss via the durable path: {rows}"
        assert rows[0]["data"]["symbol"] == "XYZ"

    def test_no_duplicate_while_both_stores_hold_the_same_alert(self):
        alerts_svc.add_alert("stop_hit", "Stop hit", "AAPL stopped out.", user_id="u_a")
        rows = _rows("u_a", "stop_hit")
        assert len(rows) == 1, f"same alert rendered more than once while ephemeral+durable both hold it: {rows}"

    def test_response_shape_matches_the_ephemeral_alert_contract(self):
        alerts_svc.add_alert("ep_resolved", "EP resolved", "AAPL target hit.", user_id="u_a")
        _clear_cache()
        row = _rows("u_a", "ep_resolved")[0]
        for key in ("id", "type", "severity", "title", "message", "timestamp", "read", "user_id", "data"):
            assert key in row, f"durable row missing expected field {key!r}"


class TestOwnership:
    def test_owner_sees_it_another_user_does_not(self):
        alerts_svc.add_alert("scanner_match", "New candidate", "M", user_id="u_a")
        _clear_cache()
        assert len(_rows("u_a", "scanner_match")) == 1, "owner not served their own durable alert"
        assert len(_rows("u_b", "scanner_match")) == 0, "durable alert leaked to a different user"

    def test_another_user_cannot_mark_it_read(self):
        alerts_svc.add_alert("scanner_match", "New candidate", "M", user_id="u_a")
        _clear_cache()
        alert_id = _rows("u_a", "scanner_match")[0]["id"]

        ok = alerts_svc.mark_read(alert_id, "u_b")
        assert ok is False, "a different user's mark-read on someone else's durable alert reported success"
        assert _rows("u_a", "scanner_match")[0]["read"] is False


class TestReadState:
    def test_unread_then_mark_read_persists_across_simulated_restart_and_is_idempotent(self):
        alerts_svc.add_alert("scanner_match", "New candidate", "M", user_id="u_a")
        rows = _rows("u_a", "scanner_match")
        assert rows[0]["read"] is False
        alert_id = rows[0]["id"]

        assert alerts_svc.mark_read(alert_id, "u_a") is True

        _clear_cache()
        assert _rows("u_a", "scanner_match")[0]["read"] is True, "read state did not survive simulated cache loss"

        assert alerts_svc.mark_read(alert_id, "u_a") is True, "repeated mark-read must be idempotent, not an error"

    def test_marking_the_visible_ephemeral_copy_dual_writes_the_durable_alert(self):
        # The ephemeral copy is the ONLY copy a member sees/marks while both
        # stores hold it -- prove mark_read on THAT id dual-writes the
        # durable row, mirroring the S7 read-state-parity fix exactly.
        alerts_svc.add_alert("scanner_match", "New candidate", "M", user_id="u_a")
        ephemeral_id = _rows("u_a", "scanner_match")[0]["id"]

        assert alerts_svc.mark_read(ephemeral_id, "u_a") is True

        _clear_cache()
        durable_rows = _rows("u_a", "scanner_match")
        assert len(durable_rows) == 1
        assert durable_rows[0]["read"] is True, (
            "durable reconstruction reappeared UNREAD after the ephemeral copy "
            "was marked read and then lost -- the exact gap this fix closes"
        )

    def test_mark_all_read_covers_durable_legacy_alerts(self):
        alerts_svc.add_alert("scanner_match", "New candidate", "M", user_id="u_a")
        _clear_cache()
        marked = alerts_svc.mark_all_read("u_a")
        assert marked >= 1
        assert _rows("u_a", "scanner_match")[0]["read"] is True


class TestS7Exclusion:
    """S7 already owns a separate, more capable durable pipeline
    (alert_taxonomy.alert_fires) -- this store must never take a second,
    redundant copy of an S7 fire."""

    def test_a_document_arrival_alert_is_not_duplicated_into_the_legacy_store(self):
        alerts_svc.add_alert(
            "document_arrival", "New 8-K filed", "AAPL filed an 8-K.",
            user_id="u_a", data={"source": "document_arrival", "accession": "0001-A1"},
        )
        assert ad.list_durable_alerts("u_a") == [], (
            "an S7 document_arrival alert was written into the legacy "
            "durability table -- it already has its own durable pipeline; "
            "this would create a confusing third copy of the same fire"
        )


class TestBroadcastExclusion:
    """Broadcast alerts (user_id=None) are deliberately out of V1's scope --
    api/services/alerts.py's own docstring scopes the durability concern to
    per-member alerts specifically."""

    def test_a_broadcast_alert_is_not_persisted_at_all(self):
        alerts_svc.add_alert("regime_change", "Regime: Distribution", "Market regime shifted.")
        # No user_id at all -- should_persist's own contract, proven here
        # end-to-end through the real add_alert call.
        assert ad.list_durable_alerts("u_a") == []

    def test_legacy_broadcast_alerts_are_still_unaffected_in_the_merged_feed(self):
        alerts_svc.add_alert("regime_change", "Regime: Distribution", "Market regime shifted.")
        alerts_svc.add_alert("scanner_match", "New candidate", "M", user_id="u_a")
        cache.delete_prefix("alerts:")  # simulate loss of the PRIVATE cache only

        rows = alerts_svc.get_alerts(limit=20, user_id="u_a")
        assert any(a["type"] == "regime_change" for a in rows), "broadcast alert regressed"
        assert any(a["type"] == "scanner_match" for a in rows), "durable legacy alert missing from merged feed"


class TestBounds:
    def test_limit_bounds_the_merged_feed(self):
        for i in range(3):
            alerts_svc.add_alert("scanner_match", f"Candidate {i}", "M", user_id="u_a")
        _clear_cache()
        rows = alerts_svc.get_alerts(limit=2, user_id="u_a")
        assert len(rows) <= 2, "merged feed ignored the caller's limit"
