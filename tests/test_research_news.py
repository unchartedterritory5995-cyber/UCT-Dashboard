"""Tests for the canonical News composer (A8 Slice 1, 2026-09-04,
owner-authorized narrow slice) + its two new D1 typed FMP methods +
router, plus a regression check that the legacy `/api/research/news/{sym}`
route (the calendar modal's compatibility bridge) is untouched."""
import time
from unittest.mock import MagicMock, patch

import pytest

from api.services import fmp_client as fc
from api.services import provider_errors as pe
from api.services.cache import cache
from api.services.research import news


# ── fmp_client.py: the two new typed methods ────────────────────────────────

def _fmp_resp(status_code=200, json_value=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_value if json_value is not None else []
    resp.raise_for_status.return_value = None
    return resp


class TestFmpClientNewsMethods:
    @pytest.fixture(autouse=True)
    def _reset_state(self, monkeypatch):
        monkeypatch.setenv("FMP_API_KEY", "test-key")
        fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
        fc._bucket_updated = time.monotonic()
        fc._bucket_denied_total = 0
        fc._served_total = 0
        cache.delete_prefix("fmp_forbidden_")

    def test_get_news_stock_calls_the_right_endpoint_and_stamps_licensing(self):
        body = [{"symbol": "AAPL", "title": "Apple ships a thing", "publishedDate": "2026-09-01 09:30:00"}]
        with patch.object(fc._session, "get", return_value=_fmp_resp(200, body)) as m:
            result = fc.get_news_stock("aapl", limit=10)
        assert result.value == body
        assert result.licensing_class == "R"
        assert result.provenance.vendor == "fmp"
        assert result.provenance.source_activity == "fmp_client.get_news_stock"
        called_url = m.call_args[0][0]
        assert called_url == "https://financialmodelingprep.com/stable/news/stock"
        assert m.call_args[1]["params"]["symbols"] == "AAPL"
        assert m.call_args[1]["params"]["limit"] == 10

    def test_get_news_press_releases_calls_the_right_endpoint(self):
        with patch.object(fc._session, "get", return_value=_fmp_resp(200, [{"title": "x"}])) as m:
            fc.get_news_press_releases("aapl")
        assert m.call_args[0][0] == "https://financialmodelingprep.com/stable/news/press-releases"

    def test_empty_list_raises_not_found_not_a_silent_empty_result(self):
        with patch.object(fc._session, "get", return_value=_fmp_resp(200, [])):
            with pytest.raises(fc.FMPNotFound):
                fc.get_news_stock("ZZZNOTREAL")


# ── research/news.py: pure helpers ──────────────────────────────────────────

class TestPublishedAt:
    def test_a_wellformed_et_string_passes_through_unchanged(self):
        assert news._published_at("2026-08-09 18:00:00") == "2026-08-09 18:00:00"

    def test_missing_is_none_not_fabricated(self):
        assert news._published_at(None) is None
        assert news._published_at("") is None

    def test_malformed_is_none_never_silently_substituted(self):
        # Not the expected shape -- must not be coerced or half-parsed.
        assert news._published_at("not a date") is None
        assert news._published_at("2026-08-09") is None


class TestArticleId:
    def test_url_is_the_id_when_present(self):
        assert news._article_id("https://x.example/a", "Title", "2026-08-09 18:00:00") == "https://x.example/a"

    def test_a_urlless_row_gets_a_stable_hash_fallback(self):
        a = news._article_id(None, "Same Title", "2026-08-09 18:00:00")
        b = news._article_id(None, "Same Title", "2026-08-09 18:00:00")
        c = news._article_id(None, "Different Title", "2026-08-09 18:00:00")
        assert a == b
        assert a != c
        assert a.startswith("nourl:")


class TestItem:
    def test_blank_title_is_rejected(self):
        assert news._item({"title": "  "}, "news") is None
        assert news._item({}, "news") is None

    def test_field_mapping_and_280char_snippet(self):
        row = {"title": "Headline", "text": "x" * 400, "publisher": "Reuters",
               "url": "https://x.example/a", "publishedDate": "2026-08-09 18:00:00",
               "image": "https://x.example/img.png"}
        item = news._item(row, "news")
        assert item["headline"] == "Headline"
        assert len(item["summary"]) == 280
        assert item["publisher"] == "Reuters"
        assert item["kind"] == "news"
        assert item["image"] == "https://x.example/img.png"

    def test_publisher_falls_back_to_site(self):
        item = news._item({"title": "H", "site": "seekingalpha.com"}, "release")
        assert item["publisher"] == "seekingalpha.com"


# ── research/news.py: _articles (dedup, sort, cap) ──────────────────────────

def _result(rows, source_activity="fmp_client.get_news_stock"):
    return pe.ProviderResult(
        value=rows,
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity=source_activity, fetched_at=time.time()),
        licensing_class="R",
        freshness="end_of_day",
    )


class TestArticlesDedupAndSort:
    def test_the_same_story_in_both_legs_dedupes_on_exact_url_and_keeps_the_news_kind(self, monkeypatch):
        shared = {"title": "Shared story", "url": "https://x.example/shared",
                  "publishedDate": "2026-08-09 12:00:00"}
        monkeypatch.setattr(fc, "get_news_stock", lambda t, **kw: _result([shared]))
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: _result([shared], "fmp_client.get_news_press_releases"))
        items, meta, all_answered = news._articles("AAPL", 40)
        assert len(items) == 1
        assert items[0]["kind"] == "news"   # the news leg is processed first -- wins the tie
        assert all_answered is True

    def test_distinct_stories_are_never_collapsed_merely_for_similar_headlines(self, monkeypatch):
        a = {"title": "Apple beats on earnings", "url": "https://x.example/a", "publishedDate": "2026-08-09 12:00:00"}
        b = {"title": "Apple beats on earnings -- analyst reax", "url": "https://x.example/b", "publishedDate": "2026-08-09 12:05:00"}
        monkeypatch.setattr(fc, "get_news_stock", lambda t, **kw: _result([a, b]))
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: _result([]))
        items, meta, all_answered = news._articles("AAPL", 40)
        assert len(items) == 2   # NOT fuzzy-deduped despite near-identical headlines

    def test_sorted_newest_first(self, monkeypatch):
        older = {"title": "Older", "url": "https://x.example/older", "publishedDate": "2026-08-01 09:00:00"}
        newer = {"title": "Newer", "url": "https://x.example/newer", "publishedDate": "2026-08-09 09:00:00"}
        monkeypatch.setattr(fc, "get_news_stock", lambda t, **kw: _result([older, newer]))
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: _result([]))
        items, meta, all_answered = news._articles("AAPL", 40)
        assert [i["headline"] for i in items] == ["Newer", "Older"]

    def test_a_missing_timestamp_sorts_last_not_first(self, monkeypatch):
        dated = {"title": "Dated", "url": "https://x.example/dated", "publishedDate": "2026-08-01 09:00:00"}
        undated = {"title": "Undated", "url": "https://x.example/undated", "publishedDate": None}
        monkeypatch.setattr(fc, "get_news_stock", lambda t, **kw: _result([undated, dated]))
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: _result([]))
        items, meta, all_answered = news._articles("AAPL", 40)
        assert [i["headline"] for i in items] == ["Dated", "Undated"]

    def test_a_genuinely_empty_ticker_is_not_a_failure(self, monkeypatch):
        monkeypatch.setattr(fc, "get_news_stock", lambda t, **kw: _result([]))
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: _result([]))
        items, meta, all_answered = news._articles("QUIET", 40)
        assert items == []
        assert meta is None
        assert all_answered is True

    def test_one_leg_raising_unexpectedly_is_reported_as_not_all_answered(self, monkeypatch):
        """`_fmp_rows_with_meta` itself never raises by contract (mirrors
        analyst_grades.py's identically-named helper exactly -- an ordinary
        provider error is already absorbed as "no data" one layer down).
        This exercises the outer defense-in-depth path for a genuinely
        unexpected fault, not an ordinary provider blip."""
        real = news._fmp_rows_with_meta

        def _flaky(fn, ticker, **kw):
            if fn is fc.get_news_stock:
                raise RuntimeError("unexpected fault")
            return real(fn, ticker, **kw)

        monkeypatch.setattr(news, "_fmp_rows_with_meta", _flaky)
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: _result([]))
        items, meta, all_answered = news._articles("AAPL", 40)
        assert all_answered is False

    def test_meta_reflects_the_freshest_of_the_two_legs(self, monkeypatch):
        stock = pe.ProviderResult(
            value=[{"title": "A", "url": "https://x.example/a", "publishedDate": "2026-08-09 09:00:00"}],
            provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_news_stock", fetched_at=100.0),
            licensing_class="R", freshness="end_of_day",
        )
        pr = pe.ProviderResult(
            value=[{"title": "B", "url": "https://x.example/b", "publishedDate": "2026-08-09 08:00:00"}],
            provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_news_press_releases", fetched_at=200.0),
            licensing_class="R", freshness="end_of_day",
        )
        monkeypatch.setattr(fc, "get_news_stock", lambda t, **kw: stock)
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: pr)
        items, meta, all_answered = news._articles("AAPL", 40)
        assert meta["sourceActivity"] == "fmp_client.get_news_press_releases"
        assert meta["fetchedAt"] == 200.0


# ── get_company_news: cache policy + entity resolution ──────────────────────

class TestGetCompanyNewsCachePolicy:
    def setup_method(self):
        cache.invalidate("research_company_news::TEST")

    def _captured_ttl(self, monkeypatch, *, articles):
        seen = {}
        real_set = cache.set

        def spy(key, value, ttl=None):
            if key == "research_company_news::TEST":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        monkeypatch.setattr(news, "_articles", lambda sym, limit: articles)
        monkeypatch.setattr(cache, "set", spy)
        out = news.get_company_news("test")
        return out, seen.get("ttl")

    def test_a_clean_fetch_is_cached_for_the_full_ttl(self, monkeypatch):
        out, ttl = self._captured_ttl(monkeypatch, articles=([], None, True))
        assert out["items"] == []
        assert ttl == news._CACHE_TTL

    def test_a_leg_raising_shortens_the_ttl(self, monkeypatch):
        out, ttl = self._captured_ttl(monkeypatch, articles=([], None, False))
        assert ttl == news._FAIL_TTL
        assert ttl < news._CACHE_TTL

    def test_blank_symbol_returns_the_empty_shape_without_a_cache_write(self, monkeypatch):
        calls = []
        monkeypatch.setattr(news, "_articles", lambda sym, limit: calls.append(1) or ([], None, True))
        out = news.get_company_news("")
        assert out == {"sym": "", "entity": None, "items": [], "_meta": None}
        assert not calls


class TestEntityResolution:
    """Real Entity Master, isolated DB per test -- same pattern as
    tests/test_analyst_grades_entity.py (news.py routes through FMP the
    same way analyst_grades.py does, so it needs the same vendor="fmp"
    coverage, not estimates.py's no-vendor pattern)."""

    @pytest.fixture(autouse=True)
    def _isolated_entity_master(self, tmp_path, monkeypatch):
        from api.services.entity_master import schema, store
        db_path = str(tmp_path / "em_default.db")
        monkeypatch.setattr(schema, "DB_PATH", db_path)
        store._local.conns = {}
        store._ALIAS_CACHE.clear()
        store._CACHE_LOADED = False
        schema.init_db(db_path=db_path)
        yield
        store._local.conns = {}
        store._ALIAS_CACHE.clear()
        store._CACHE_LOADED = False
        cache.invalidate("research_company_news::UNSEEDED")
        cache.invalidate("research_company_news::NOBODYKNOWSTHIS")
        cache.invalidate("research_company_news::BRK-B")

    def test_entity_resolves_for_a_known_alias(self, monkeypatch):
        from api.services.entity_master import api as em_api
        eid = em_api.apply_event(
            "new_entity", {"entity_type": "equity", "initial_alias": "UNSEEDED",
                          "initial_alias_valid_from": "2020-01-01"},
            dedup_key="test:unseeded", source="admin_manual",
        ).entity_id
        monkeypatch.setattr(news, "_articles", lambda sym, limit: ([], None, True))
        out = news.get_company_news("unseeded")
        assert out["entity"] == {"status": "resolved", "entityId": eid}

    def test_an_unresolved_symbol_still_serves_an_honest_empty_shape(self, monkeypatch):
        monkeypatch.setattr(news, "_articles", lambda sym, limit: ([], None, True))
        out = news.get_company_news("NOBODYKNOWSTHIS")
        assert out["entity"] == {"status": "not_found", "entityId": None}
        assert out["items"] == []   # the rest of the page still works

    def test_the_resolved_vendor_symbol_is_what_reaches_d1(self, monkeypatch):
        """The exact BRK-B/BRK.B case: the route param and the symbol D1 is
        actually called with must differ, on purpose, when Entity Master
        has a real vendor mapping."""
        from api.services.entity_master import api as em_api
        eid = em_api.apply_event(
            "new_entity", {"entity_type": "equity", "initial_alias": "BRK-B",
                          "initial_alias_valid_from": "2020-01-01"},
            dedup_key="test:brkb", source="admin_manual",
        ).entity_id
        em_api.set_vendor_symbol(eid, "fmp", "BRK.B", "2020-01-01", source="admin_manual")

        seen = {}

        def _spy_stock(ticker, **kw):
            seen["ticker"] = ticker
            return pe.ProviderResult(value=[], provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"), licensing_class="R")

        monkeypatch.setattr(fc, "get_news_stock", _spy_stock)
        monkeypatch.setattr(fc, "get_news_press_releases", lambda t, **kw: pe.ProviderResult(
            value=[], provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"), licensing_class="R"))

        out = news.get_company_news("BRK-B")
        assert seen["ticker"] == "BRK.B"       # D1 called with the VENDOR symbol
        assert out["sym"] == "BRK-B"           # the payload still shows the route's own symbol
        assert out["entity"]["status"] == "resolved"


# ── Router ───────────────────────────────────────────────────────────────────

class TestRoute:
    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_route_shape(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_company_news", lambda sym: {
            "sym": sym.upper(), "entity": {"status": "resolved", "entityId": "em_1"},
            "items": [], "_meta": None,
        })
        r = self._client().get("/api/research/company-news/AAPL")
        assert r.status_code == 200
        assert set(r.json().keys()) == {"sym", "entity", "items", "_meta"}

    def test_route_degrades_safely_on_an_exception(self, monkeypatch):
        import api.routers.research as research_router

        def _boom(sym):
            raise RuntimeError("boom")
        monkeypatch.setattr(research_router, "get_company_news", _boom)
        r = self._client().get("/api/research/company-news/AAPL")
        assert r.status_code == 200
        body = r.json()
        assert body["sym"] == "AAPL"
        assert body["items"] == []


class TestLegacyRouteUntouched:
    """A8 Slice 1 must not touch the calendar modal's existing News tab --
    this is the regression rail proving that, not just claiming it."""

    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_the_legacy_route_still_serves_its_original_shape(self):
        with patch("api.services.earnings_estimates._fmp_get", return_value=[
            {"title": "Old-shape headline", "publisher": "Reuters", "url": "https://x.example/a",
             "publishedDate": "2026-08-09 18:00:00", "image": None, "text": "body"},
        ]):
            r = self._client().get("/api/research/news/AAPL")
        assert r.status_code == 200
        body = r.json()
        assert body["sym"] == "AAPL"
        item = body["items"][0]
        assert set(item.keys()) == {"kind", "title", "publisher", "url", "published", "image", "summary"}
        assert item["title"] == "Old-shape headline"
