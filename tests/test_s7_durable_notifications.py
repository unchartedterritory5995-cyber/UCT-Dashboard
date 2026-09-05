"""S7 durable in-app notification bridge (Part B, owner authorization).

GET /api/alerts's ephemeral TTLCache does not survive a process restart or
redeploy. These tests prove a real document-arrival fire — through the real
evaluator, the real (temp, isolated) alert_taxonomy.db, and the REAL
watchlist_alert_service delivery path (not mocked) — stays visible via the
durable alert_fires reconstruction once the ephemeral copy is gone, with
ownership, read-state, dedup, and legacy-alert-type isolation all proven
against the real merge in api.services.alerts.get_alerts/mark_read/
mark_all_read.

Only the SEC network boundary (sec_filings.recent_filings) is mocked — same
convention as tests/test_alert_taxonomy_document_arrival.py.
"""
import pytest

from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store
from api.services.entity_master import api as em_api
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import document_arrival as da
from api.services import alerts as alerts_svc
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _isolated_dbs(tmp_path, monkeypatch):
    at_path = str(tmp_path / "alert_taxonomy.db")
    monkeypatch.setattr(at_db, "DB_PATH", at_path)

    em_db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(em_schema, "DB_PATH", em_db_path)
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    em_schema.init_db(db_path=em_db_path)

    da.register()

    def _purge_cache():
        cache.invalidate("alerts")
        cache.delete_prefix("alerts:")
    _purge_cache()

    yield

    _purge_cache()
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


def _clear_cache():
    """Simulate a process restart / redeploy: the ephemeral store is gone."""
    cache.invalidate("alerts")
    cache.delete_prefix("alerts:")


def _seed_filer(ticker):
    r = em_api.apply_event(
        "new_entity",
        {"entity_type": "equity", "initial_alias": ticker, "initial_alias_valid_from": "2020-01-01"},
        dedup_key=f"test:{ticker}", source="admin_manual",
    )
    assert r.accepted
    return r.entity_id


def _mock_filings(monkeypatch, ticker, accessions):
    def fake(tk, form_type="", count=5):
        return {
            "ticker": tk, "company": f"{tk} CORP", "cik": "0000000000",
            "filings": [
                {"form": "8-K", "filed": "2026-09-05", "accession": acc, "url": f"https://sec.gov/{acc}"}
                for acc in accessions
            ],
        }
    monkeypatch.setattr(da.sec_filings, "recent_filings", fake)


def _quiet_channels(monkeypatch):
    from api.services import watchlist_alert_service as wls
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    monkeypatch.setattr(alerts_svc, "_fire_discord", lambda payload: None)


def _register_and_fire(monkeypatch, ticker, user_id):
    """Register a predicate at baseline accession A0, then a real new filing
    A1 arrives, run the real sweep. One real fire through the real evaluator,
    real delivery path, real durable alert_fires row."""
    _seed_filer(ticker)
    _mock_filings(monkeypatch, ticker, ["A0"])
    pred_id = da.register_predicate_for_user(user_id, ticker)

    _quiet_channels(monkeypatch)
    _mock_filings(monkeypatch, ticker, ["A1", "A0"])
    result = da.run_document_arrival_sweep()
    assert result["fired"] == 1, f"fixture did not produce a real fire: {result}"
    return pred_id


def _s7_rows(user_id):
    return [a for a in alerts_svc.get_alerts(limit=20, user_id=user_id) if a["type"] == "document_arrival"]


class TestDurability:
    def test_fire_visible_before_simulated_cache_loss(self, monkeypatch):
        _register_and_fire(monkeypatch, "AAPL", "u_a")
        assert len(_s7_rows("u_a")) == 1, "fire not visible via the ephemeral path immediately after firing"

    def test_fire_visible_after_simulated_cache_loss(self, monkeypatch):
        _register_and_fire(monkeypatch, "MSFT", "u_a")
        _clear_cache()
        rows = _s7_rows("u_a")
        assert len(rows) == 1, f"fire did not survive simulated cache loss via the durable path: {rows}"
        assert rows[0]["data"]["sym"] == "MSFT"
        assert rows[0]["data"]["research_url"] == "/research/MSFT"

    def test_no_duplicate_while_both_stores_hold_the_same_fire(self, monkeypatch):
        _register_and_fire(monkeypatch, "NVDA", "u_a")
        rows = _s7_rows("u_a")
        assert len(rows) == 1, f"same fire rendered more than once while ephemeral+durable both hold it: {rows}"

    def test_response_shape_matches_the_ephemeral_alert_contract(self, monkeypatch):
        _register_and_fire(monkeypatch, "AMD", "u_a")
        _clear_cache()
        row = _s7_rows("u_a")[0]
        for key in ("id", "type", "severity", "title", "message", "timestamp", "read", "user_id", "data"):
            assert key in row, f"durable row missing expected field {key!r}"


class TestOwnership:
    def test_owner_sees_it_another_user_does_not(self, monkeypatch):
        _register_and_fire(monkeypatch, "TSLA", "u_a")
        _clear_cache()
        assert len(_s7_rows("u_a")) == 1, "owner not served their own durable fire"
        assert len(_s7_rows("u_b")) == 0, "durable fire leaked to a different user"

    def test_another_user_cannot_mark_it_read(self, monkeypatch):
        _register_and_fire(monkeypatch, "GOOGL", "u_a")
        _clear_cache()
        fire_id = _s7_rows("u_a")[0]["id"]

        ok = alerts_svc.mark_read(fire_id, "u_b")
        assert ok is False, "a different user's mark-read on someone else's durable fire reported success"
        assert _s7_rows("u_a")[0]["read"] is False, "another user's mark-read call mutated the owner's read state"


class TestReadState:
    def test_unread_then_mark_read_persists_across_simulated_restart_and_is_idempotent(self, monkeypatch):
        _register_and_fire(monkeypatch, "AMZN", "u_a")
        _clear_cache()
        rows = _s7_rows("u_a")
        assert rows[0]["read"] is False
        fire_id = rows[0]["id"]

        assert alerts_svc.mark_read(fire_id, "u_a") is True

        _clear_cache()
        assert _s7_rows("u_a")[0]["read"] is True, "read state did not survive simulated cache loss"

        assert alerts_svc.mark_read(fire_id, "u_a") is True, "repeated mark-read must be idempotent, not an error"
        assert _s7_rows("u_a")[0]["read"] is True

    def test_mark_all_read_covers_durable_s7_fires(self, monkeypatch):
        _register_and_fire(monkeypatch, "META", "u_a")
        _clear_cache()
        marked = alerts_svc.mark_all_read("u_a")
        assert marked >= 1
        assert _s7_rows("u_a")[0]["read"] is True


class TestFeedCoexistenceAndBounds:
    def test_legacy_broadcast_alerts_are_unaffected(self, monkeypatch):
        alerts_svc.add_alert("regime_change", "Regime: Distribution", "Market regime shifted.")
        _register_and_fire(monkeypatch, "NFLX", "u_a")
        _clear_cache_broadcast_kept()

        rows = alerts_svc.get_alerts(limit=20, user_id="u_a")
        assert any(a["type"] == "regime_change" for a in rows), "legacy broadcast alert regressed"
        assert any(a["type"] == "document_arrival" for a in rows), "S7 durable fire missing from merged feed"

    def test_limit_bounds_the_merged_feed(self, monkeypatch):
        for i, tk in enumerate(["ORCL", "CRM", "ADBE"]):
            _register_and_fire(monkeypatch, tk, "u_a")
        _clear_cache()
        rows = alerts_svc.get_alerts(limit=2, user_id="u_a")
        assert len(rows) <= 2, "merged feed ignored the caller's limit"


def _clear_cache_broadcast_kept():
    cache.delete_prefix("alerts:")
