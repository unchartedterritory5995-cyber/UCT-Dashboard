"""Lane R D-6 / D-7 / D-8: the Research > Depth > News desk.

Real stores on temp files: the company-news store (api.services.news.store)
and calendar_seen (auth.db). Stories are recorded fixtures written through the
store's own upsert; nothing touches a network.
"""
from __future__ import annotations

import inspect
import os
import tempfile

import pytest

from api.services import news_importance as imp
from api.services import news_read_state as rs
from api.services import news_versions as nv
from api.services.news import store

FLAGS = ("NEWS_STORY_VERSIONS_ENABLED", "NEWS_IMPORTANCE_LABEL_ENABLED", "NEWS_READ_STATE_ENABLED")


def _story(pid: str, *, headline: str = "Acme reports third quarter results",
           description: str = "Acme said revenue rose.", published: str = "2026-09-30T12:00:00+00:00",
           source: str = "Reuters", category: str = "earnings", event_key: str = "") -> dict:
    return {
        "provider": "fmp", "provider_id": pid, "source_name": source, "source_display": source,
        "source_class": "journalism", "url": f"https://example.test/{pid}",
        "canonical_url": f"example.test/{pid}", "headline": headline, "headline_key": headline.lower(),
        "description": description, "published_at": published, "category": category,
        "event_key": event_key, "is_primary": True,
    }


@pytest.fixture
def stores(tmp_path, monkeypatch):
    for f in FLAGS:
        monkeypatch.delenv(f, raising=False)
    store.set_db_path(str(tmp_path / "news.db"))
    import api.services.calendar_seen as cs
    monkeypatch.setattr(cs, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(cs, "_INIT_DONE", False)
    yield
    store.set_db_path(os.path.join(tempfile.gettempdir(), "unused_news.db"))


def _put(item, ticker="ACME", relevance="direct"):
    return store.upsert(item, [{"ticker": ticker, "relevance": relevance, "subject": "primary"}])


# ── D-6 versions ─────────────────────────────────────────────────────────────

class TestVersions:
    def test_dark_records_nothing(self, stores):
        nid = _put(_story("a"))
        _put(_story("a", headline="Acme reports Q3 results, raises guidance"))
        assert nv.history(nid)["prior_versions"] == []

    def test_a_changed_resend_keeps_the_prior_text(self, stores, monkeypatch):
        monkeypatch.setenv("NEWS_STORY_VERSIONS_ENABLED", "1")
        nid = _put(_story("a"))
        _put(_story("a", headline="Acme reports Q3 results, raises guidance"))
        h = nv.history(nid)
        assert h["current"]["headline"] == "Acme reports Q3 results, raises guidance"
        assert len(h["prior_versions"]) == 1
        v = h["prior_versions"][0]
        assert v["headline"] == "Acme reports third quarter results"
        assert v["changed"] == ["headline"]
        assert v["replaced_at"]

    def test_an_identical_resend_or_an_omitted_field_is_not_a_version(self, stores, monkeypatch):
        monkeypatch.setenv("NEWS_STORY_VERSIONS_ENABLED", "1")
        nid = _put(_story("a"))
        _put(_story("a"))
        _put(_story("a", description=""))
        assert nv.history(nid)["prior_versions"] == []

    def test_retraction_is_never_claimed(self, stores, monkeypatch):
        monkeypatch.setenv("NEWS_STORY_VERSIONS_ENABLED", "1")
        nid = _put(_story("a"))
        r = nv.history(nid)["retraction"]
        assert r["state"] == "not_tracked"
        assert "absence is not a retraction" in r["reason"]


# ── D-7 importance ───────────────────────────────────────────────────────────

class TestImportance:
    def test_a_subject_earnings_story_is_high_with_its_reason(self):
        out = imp.classify({"category": "earnings", "rel": "direct"}, 1)
        assert out["label"] == "high"
        assert out["reasons"] == ["earnings story about this ticker"]

    def test_wide_coverage_is_high(self):
        out = imp.classify({"category": "other", "rel": "direct"}, 3)
        assert out["label"] == "high" and "reported by 3 outlets" in out["reasons"]

    def test_related_only_is_low(self):
        out = imp.classify({"category": "earnings", "rel": "related"}, 1)
        assert out["label"] == "low"

    def test_single_outlet_other_is_low_and_the_rest_is_normal(self):
        assert imp.classify({"category": "other", "rel": "direct"}, 1)["label"] == "low"
        n = imp.classify({"category": "analyst", "rel": "direct"}, 2)
        assert n["label"] == "normal" and n["reasons"]

    def test_outlets_are_counted_distinct_per_event(self, stores):
        _put(_story("a", source="Reuters", event_key="ev1"))
        _put(_story("b", source="CNBC", event_key="ev1"))
        _put(_story("c", source="CNBC", event_key="ev1"))
        assert imp.outlet_counts(["ev1", ""]) == {"ev1": 2}


# ── D-8 read state ───────────────────────────────────────────────────────────

class TestReadState:
    def test_idempotent_and_keeps_the_first_read_time(self, stores):
        nid = _put(_story("a"))
        first = rs.set_read("u1", [nid], True)[nid]
        again = rs.set_read("u1", [nid], True)[nid]
        assert first == again
        assert rs.set_read("u1", [nid], False) == {}
        assert rs.set_read("u1", [nid], False) == {}

    def test_owner_scoped(self, stores):
        nid = _put(_story("a"))
        rs.set_read("u1", [nid], True)
        assert rs.read_among("u2", [nid]) == {}
        assert nid in rs.read_among("u1", [nid])


# ── routes + auth payload ────────────────────────────────────────────────────

class TestRoutes:
    @pytest.fixture
    def client(self, stores):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import news_depth as route
        app = FastAPI()
        app.include_router(route.router)
        who = {"id": "u1"}
        app.dependency_overrides[route.require_paid] = lambda: dict(who)
        return route, TestClient(app), who

    def test_all_dark_is_a_404_everywhere(self, client):
        _, c, _ = client
        nid = _put(_story("a"))
        assert c.get("/api/research/news-desk/ACME").status_code == 404
        assert c.get(f"/api/research/news-desk/story/{nid}/versions").status_code == 404
        assert c.post("/api/research/news-desk/read", json={"ids": [nid], "read": True}).status_code == 404

    def test_each_annotation_rides_only_with_its_own_flag(self, client, monkeypatch):
        _, c, _ = client
        _put(_story("a"))
        monkeypatch.setenv("NEWS_IMPORTANCE_LABEL_ENABLED", "1")
        d = c.get("/api/research/news-desk/ACME").json()
        assert d["annotations"] == ["importance"]
        it = d["items"][0]
        assert it["importance"]["label"] == "high"
        assert "prior_versions" not in it and "read_at" not in it
        assert d["importance_rules"] and "retraction" not in d

    def test_read_route_marks_and_the_desk_shows_it(self, client, monkeypatch):
        _, c, _ = client
        nid = _put(_story("a"))
        monkeypatch.setenv("NEWS_READ_STATE_ENABLED", "1")
        assert c.get("/api/research/news-desk/ACME").json()["items"][0]["read_at"] is None
        r = c.post("/api/research/news-desk/read", json={"ids": [nid], "read": True})
        assert r.status_code == 200 and str(nid) in r.json()["read"]
        assert c.get("/api/research/news-desk/ACME").json()["items"][0]["read_at"]
        assert c.post("/api/research/news-desk/read", json={"ids": [nid + 999], "read": True}).status_code == 404
        assert c.post("/api/research/news-desk/read", json={"ids": [nid], "read": "yes"}).status_code == 400

    def test_versions_route(self, client, monkeypatch):
        _, c, _ = client
        monkeypatch.setenv("NEWS_STORY_VERSIONS_ENABLED", "1")
        nid = _put(_story("a"))
        _put(_story("a", published="2026-09-30T13:00:00+00:00"))
        assert c.get("/api/research/news-desk/ACME").json()["items"][0]["prior_versions"] == 1
        v = c.get(f"/api/research/news-desk/story/{nid}/versions").json()
        assert v["prior_versions"][0]["changed"] == ["published_at"]
        assert c.get("/api/research/news-desk/story/987654/versions").status_code == 404

    def test_handlers_are_sync_and_payload_keys_ride_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _, _ = client
        for fn in (route.news_desk_route, route.news_versions_route, route.news_read_route):
            assert not inspect.iscoroutinefunction(fn)
        flags = auth._research_depth_flags()
        for k in ("news_story_versions_enabled", "news_importance_enabled", "news_read_state_enabled"):
            assert k not in flags
        for f in FLAGS:
            monkeypatch.setenv(f, "1")
        flags = auth._research_depth_flags()
        for k in ("news_story_versions_enabled", "news_importance_enabled", "news_read_state_enabled"):
            assert flags[k] is True
