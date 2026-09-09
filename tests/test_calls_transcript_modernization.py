"""Tests for the 2026-09-03 A6/A7 Calls & Transcript modernization:
canonical-entity resolution at the router boundary, and the honest
quarter/generated-at as-of disclosure (both previously computed and
silently dropped before reaching the response)."""
from unittest.mock import MagicMock

import api.services.call_recap as cr
import api.services.call_recap_store as store


class _FakeCache:
    def __init__(self):
        self._d = {}

    def get(self, k):
        return self._d.get(k)

    def set(self, k, v, ttl=None):
        self._d[k] = v


class TestCallRecapStoreMeta:
    def test_get_meta_returns_quarter_and_created_at(self, monkeypatch, tmp_path):
        db = str(tmp_path / "recaps.db")
        monkeypatch.setattr(store, "DB_PATH", db)
        store.init_db()
        store.put("AAPL", "2026Q2", {"headline": "hi"})
        meta = store.get_meta("AAPL")
        assert meta["quarter"] == "2026Q2"
        assert isinstance(meta["created_at"], int)

    def test_get_meta_none_when_nothing_stored(self, monkeypatch, tmp_path):
        db = str(tmp_path / "recaps2.db")
        monkeypatch.setattr(store, "DB_PATH", db)
        store.init_db()
        assert store.get_meta("ZZZZ") is None

    def test_get_meta_respects_the_requested_quarter(self, monkeypatch, tmp_path):
        db = str(tmp_path / "recaps3.db")
        monkeypatch.setattr(store, "DB_PATH", db)
        store.init_db()
        # Two puts in the same wall-clock second tie on created_at (int
        # seconds) -- force a real ordering so "newest by default" is
        # actually testing that, not an unspecified SQLite tie-break.
        monkeypatch.setattr(store.time, "time", lambda: 1_800_000_000)
        store.put("AAPL", "2026Q1", {"headline": "old"})
        monkeypatch.setattr(store.time, "time", lambda: 1_800_000_100)
        store.put("AAPL", "2026Q2", {"headline": "new"})
        assert store.get_meta("AAPL", "2026Q1")["quarter"] == "2026Q1"
        assert store.get_meta("AAPL")["quarter"] == "2026Q2"   # newest by default


class TestGetCallRecapWithStatusSurfacesAsOf:
    def test_stored_recap_gains_quarter_and_generated_at(self, monkeypatch):
        monkeypatch.setattr(cr, "_cache", lambda: _FakeCache())
        fake_store = MagicMock()
        fake_store.get.return_value = {"headline": "Beat and raise"}
        fake_store.get_meta.return_value = {"quarter": "2026Q2", "created_at": 1_800_000_000}
        monkeypatch.setattr(cr, "_store", lambda: fake_store)

        recap, status = cr.get_call_recap_with_status("AAPL")
        assert status == "ready"
        assert recap["headline"] == "Beat and raise"
        assert recap["quarter"] == "2026Q2"
        assert recap["generated_at"] == 1_800_000_000

    def test_a_meta_read_failure_still_serves_the_recap(self, monkeypatch):
        """Best-effort: the as-of stamp is a bonus, never a blocker."""
        monkeypatch.setattr(cr, "_cache", lambda: _FakeCache())
        fake_store = MagicMock()
        fake_store.get.return_value = {"headline": "Beat and raise"}
        fake_store.get_meta.side_effect = RuntimeError("db locked")
        monkeypatch.setattr(cr, "_store", lambda: fake_store)

        recap, status = cr.get_call_recap_with_status("AAPL")
        assert status == "ready"
        assert recap["headline"] == "Beat and raise"
        assert "quarter" not in recap


class TestRouterEntityResolution:
    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def _auth_override(self):
        from api.main import app
        from api.routers.earnings_intel import require_paid
        app.dependency_overrides[require_paid] = lambda: {"id": "u1", "role": "member"}
        return app

    def test_call_recap_endpoint_carries_entity(self, monkeypatch):
        import api.routers.earnings_intel as ei
        monkeypatch.setattr(ei, "resolve_entity",
                            lambda sym: ({"status": "resolved", "entityId": "em_1"}, sym))
        monkeypatch.setattr(ei, "get_call_recap_with_status", lambda sym, quarter=None: (None, "unavailable"))
        app = self._auth_override()
        try:
            r = self._client().get("/api/earnings/call-recap/AAPL")
            assert r.status_code == 200
            assert r.json()["entity"] == {"status": "resolved", "entityId": "em_1"}
        finally:
            app.dependency_overrides.clear()

    def test_transcript_endpoint_carries_entity_and_source(self, monkeypatch):
        import api.routers.earnings_intel as ei
        monkeypatch.setattr(ei, "resolve_entity",
                            lambda sym: ({"status": "not_found", "entityId": None}, sym))
        monkeypatch.setattr(ei, "get_fmp_transcript",
                            lambda sym, quarter=None: {"symbol": sym, "quarter": "2026Q2",
                                                       "segments": [{"speaker": "CEO", "content": "hi"}]})
        app = self._auth_override()
        try:
            r = self._client().get("/api/earnings/transcript/AAPL")
            assert r.status_code == 200
            body = r.json()
            assert body["source"] == "fmp"
            assert body["entity"] == {"status": "not_found", "entityId": None}
        finally:
            app.dependency_overrides.clear()

    def test_transcript_endpoint_marks_the_alphavantage_fallback(self, monkeypatch):
        import api.routers.earnings_intel as ei
        monkeypatch.setattr(ei, "resolve_entity",
                            lambda sym: ({"status": "resolved", "entityId": "em_1"}, sym))
        monkeypatch.setattr(ei, "get_fmp_transcript", lambda sym, quarter=None: None)
        monkeypatch.setattr(ei, "get_transcript",
                            lambda sym, quarter=None: {"symbol": sym, "quarter": "2026Q1",
                                                       "segments": [{"speaker": "CFO", "content": "hi"}]})
        app = self._auth_override()
        try:
            r = self._client().get("/api/earnings/transcript/AAPL")
            assert r.status_code == 200
            assert r.json()["source"] == "alphavantage"
        finally:
            app.dependency_overrides.clear()
