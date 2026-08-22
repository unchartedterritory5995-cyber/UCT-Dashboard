from unittest.mock import patch

from fastapi.testclient import TestClient


def _client():
    from api.main import app
    return TestClient(app)


def test_cached_only_returns_the_cached_analysis_without_firing_the_llm():
    from api.routers import earnings as er
    from api.services.cache import cache
    cache.set("earnings_analysis_v2_TST",
              {"sym": "TST", "analysis_headline": "Beat and raised"}, ttl=60)
    with patch.object(er, "_generate_earnings_analysis") as ga, \
         patch.object(er, "_generate_earnings_preview") as gp:
        r = _client().get("/api/earnings-analysis/TST?cached_only=1")
    body = r.json()
    assert body["cached"] is True and body["analysis_headline"] == "Beat and raised"
    ga.assert_not_called()
    gp.assert_not_called()
    cache.invalidate("earnings_analysis_v2_TST")


def test_cached_only_falls_back_to_the_preview_key():
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_TST")
    cache.set("earnings_preview_v2_TST",
              {"sym": "TST", "preview_text": "Watch guidance."}, ttl=60)
    body = _client().get("/api/earnings-analysis/TST?cached_only=1").json()
    assert body["cached"] is True and body["preview_text"] == "Watch guidance."
    cache.invalidate("earnings_preview_v2_TST")


def test_cached_only_miss_returns_the_empty_shape_and_touches_nothing():
    from api.routers import earnings as er
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_ZZZ")
    cache.invalidate("earnings_preview_v2_ZZZ")
    with patch.object(er, "_generate_earnings_analysis") as ga, \
         patch.object(er, "_generate_earnings_preview") as gp, \
         patch.object(er, "get_earnings") as ge:
        body = _client().get("/api/earnings-analysis/ZZZ?cached_only=1").json()
    assert body["cached"] is False
    assert body["analysis_bullets"] == [] and body["preview_bullets"] == []
    assert body["news"] == [] and body["analysis_headline"] is None
    ga.assert_not_called()
    gp.assert_not_called()
    ge.assert_not_called()          # not even the row lookup — this path is FREE


def test_default_call_is_unchanged_and_still_generates():
    from api.routers import earnings as er
    with patch.object(er, "get_earnings", return_value={}), \
         patch.object(er, "_generate_earnings_preview",
                      return_value={"sym": "ZZZ", "preview_text": "x"}) as gp:
        r = _client().get("/api/earnings-analysis/ZZZ")
    assert r.status_code == 200
    gp.assert_called_once()


# ── 2026-08-21: disk-aware probes + the non-blocking `?background=1` path ─────

def test_cached_only_answers_from_the_disk_store_after_a_redeploy(monkeypatch):
    """Memory is wiped by every redeploy; a brief on disk must still count as
    cached for the stepping probe (it used to render "No brief generated yet")."""
    from api.routers import earnings as er
    from api.services import earnings_ai_store
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_DSK")
    cache.invalidate("earnings_preview_v2_DSK")
    monkeypatch.setattr(
        earnings_ai_store, "get",
        lambda kind, sym: {"sym": "DSK", "preview_text": "From disk."}
        if (kind, sym) == ("preview", "DSK") else None)
    with patch.object(er, "get_earnings") as ge:
        body = _client().get("/api/earnings-analysis/DSK?cached_only=1").json()
    assert body["cached"] is True and body["preview_text"] == "From disk."
    ge.assert_not_called()
    assert cache.get("earnings_preview_v2_DSK")["preview_text"] == "From disk."   # hydrated
    cache.invalidate("earnings_preview_v2_DSK")


class _InlinePool:
    """Runs the submitted job on the calling thread so the test can observe it."""
    def __init__(self):
        self.ran = []

    def submit(self, fn, *a, **k):
        self.ran.append(fn)
        fn(*a, **k)


def test_background_miss_answers_instantly_and_generates_on_the_pool(monkeypatch):
    from api.routers import earnings as er
    from api.services import earnings_ai_store
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_BG")
    cache.invalidate("earnings_preview_v2_BG")
    monkeypatch.setattr(earnings_ai_store, "get", lambda kind, sym: None)
    pool = _InlinePool()
    monkeypatch.setattr(er, "_CLICK_POOL", pool)
    er._inflight.discard("BG")
    with patch.object(er, "get_earnings", return_value={}), \
         patch.object(er, "_generate_earnings_preview",
                      return_value={"sym": "BG", "preview_text": "x"}) as gp:
        body = _client().get("/api/earnings-analysis/BG?background=1").json()
    assert body["generating"] is True and body["cached"] is False
    assert body["preview_text"] == "" and body["analysis"] is None
    gp.assert_called_once()                       # the generator ran — on the pool
    assert len(pool.ran) == 1
    assert "BG" not in er._inflight               # released when the job finished


def test_background_hit_returns_the_brief_without_generating(monkeypatch):
    from api.routers import earnings as er
    from api.services import earnings_ai_store
    from api.services.cache import cache
    cache.set("earnings_preview_v2_BH", {"sym": "BH", "preview_text": "Warm."}, ttl=60)
    monkeypatch.setattr(earnings_ai_store, "get", lambda kind, sym: None)
    with patch.object(er, "get_earnings", return_value={}), \
         patch.object(er, "_generate_earnings_preview") as gp, \
         patch.object(er, "_generate_earnings_analysis") as ga:
        body = _client().get("/api/earnings-analysis/BH?background=1").json()
    assert body["cached"] is True and body["preview_text"] == "Warm."
    assert "generating" not in body
    gp.assert_not_called()
    ga.assert_not_called()
    cache.invalidate("earnings_preview_v2_BH")


def test_background_routes_a_reported_name_to_the_analysis_cache(monkeypatch):
    """A name that has printed must NOT be answered by its pre-print preview."""
    from api.routers import earnings as er
    from api.services import earnings_ai_store
    from api.services.cache import cache
    cache.set("earnings_preview_v2_RP", {"sym": "RP", "preview_text": "Stale preview."}, ttl=60)
    cache.invalidate("earnings_analysis_v2_RP")
    monkeypatch.setattr(earnings_ai_store, "get", lambda kind, sym: None)
    pool = _InlinePool()
    monkeypatch.setattr(er, "_CLICK_POOL", pool)
    er._inflight.discard("RP")
    row = {"sym": "RP", "verdict": "Beat", "reported_eps": 1.2, "eps_estimate": 1.0}
    with patch.object(er, "get_earnings", return_value={"amc": [row]}), \
         patch.object(er, "_generate_earnings_analysis", return_value={"sym": "RP"}) as ga, \
         patch.object(er, "_generate_earnings_preview") as gp:
        body = _client().get("/api/earnings-analysis/RP?background=1").json()
    assert body["generating"] is True
    ga.assert_called_once()
    gp.assert_not_called()
    cache.invalidate("earnings_preview_v2_RP")


def test_background_dedupes_an_in_flight_generation(monkeypatch):
    from api.routers import earnings as er
    from api.services import earnings_ai_store
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_DUP")
    cache.invalidate("earnings_preview_v2_DUP")
    monkeypatch.setattr(earnings_ai_store, "get", lambda kind, sym: None)
    pool = _InlinePool()
    monkeypatch.setattr(er, "_CLICK_POOL", pool)
    er._inflight.add("DUP")
    try:
        with patch.object(er, "get_earnings", return_value={}), \
             patch.object(er, "_generate_earnings_preview") as gp:
            body = _client().get("/api/earnings-analysis/DUP?background=1").json()
        assert body["generating"] is True
        gp.assert_not_called()                    # one generation per name, ever
        assert pool.ran == []
    finally:
        er._inflight.discard("DUP")
