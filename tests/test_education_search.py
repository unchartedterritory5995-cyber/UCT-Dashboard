"""Deep content search across the Desk video library —
api/services/education_search.py + GET /api/education/search (round 6).

Harness mirrors tests/test_education_taxonomy.py (tmp-DB svc fixture) and
tests/test_education_router_taxonomy.py (standalone app + dependency_overrides).
"""
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.education as edu_router
from api.services import education_search as srch


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    monkeypatch.setattr(es, "_search_dirty", True)  # fresh DB → force rebuild
    es._init_db()
    return es


def _vid(svc, title, yt, **insights):
    v = svc.create_video({"youtube_id": yt, "title": title,
                          "category": insights.pop("category", "General")})
    if insights:
        svc.set_video_insights(v["id"], **insights)
    return v


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(edu_router.router)
    return app


# ── Mode detection ────────────────────────────────────────────────────────────

def test_mode_detected_and_reported(svc):
    out = srch.search("anything here")
    print(f"\nsqlite_version={sqlite3.sqlite_version} search_mode={out['mode']}")
    assert out["mode"] in ("fts", "like")
    assert out == {"results": [], "total": 0, "mode": out["mode"]}


# ── Core matching ─────────────────────────────────────────────────────────────

def test_title_match_case_insensitive_with_highlight(svc):
    _vid(svc, "VCP Masterclass", "yt_vcp1")
    out = srch.search("vcp")
    assert out["total"] == 1
    r = out["results"][0]
    assert r["match_field"] == "title" and r["t"] is None
    assert "<b>VCP</b>" in r["snippet"]
    assert r["youtube_id"] == "yt_vcp1" and r["category"] == "General"
    assert r["title"] == "VCP Masterclass"


def test_results_ordered_title_headline_chapter_transcript(svc):
    # created in REVERSE priority order to prove ordering is by field, not id
    d = _vid(svc, "Video D", "d4", transcript="[0:05] position sizing talk here")
    c = _vid(svc, "Video C", "c3", chapters=[{"t": 60, "title": "Sizing chapter"}])
    b = _vid(svc, "Video B", "b2", headline="All about sizing")
    a = _vid(svc, "Sizing 101", "a1")
    out = srch.search("sizing")
    assert [r["match_field"] for r in out["results"]] == [
        "title", "headline", "chapter", "transcript"]
    assert [r["id"] for r in out["results"]] == [a["id"], b["id"], c["id"], d["id"]]


def test_best_field_wins_one_result_per_video(svc):
    _vid(svc, "Breakout basics", "bo1",
         headline="breakout recap", transcript="[0:10] breakout entries here")
    out = srch.search("breakout")
    assert out["total"] == 1
    assert out["results"][0]["match_field"] == "title"


def test_chapter_match_returns_chapter_timestamp(svc):
    _vid(svc, "Session Jul 22", "ch1", chapters=[
        {"t": 30, "title": "Open discussion"},
        {"t": 245, "title": "Risk management deep dive"}])
    out = srch.search("risk management")
    r = out["results"][0]
    assert r["match_field"] == "chapter" and r["t"] == 245
    assert "<b>" in r["snippet"] and "Risk" in r["snippet"]


def test_transcript_match_returns_first_matching_cue_t(svc):
    tr = ("[0:05] welcome everyone to the desk\n"
          "[2:15] let's talk about drawdowns today\n"
          "[1:03:00] drawdowns again much later")
    _vid(svc, "Mental game ep", "tr1", transcript=tr)
    out = srch.search("drawdowns")
    r = out["results"][0]
    assert r["match_field"] == "transcript"
    assert r["t"] == 135  # FIRST matching cue, not the later one
    assert "<b>drawdowns</b>" in r["snippet"]


def test_multi_token_query_is_anded_within_a_field(svc):
    _vid(svc, "Volume dry up explained", "and1")
    _vid(svc, "Volume basics", "and2")
    out = srch.search("volume dry")
    assert out["total"] == 1
    assert out["results"][0]["youtube_id"] == "and1"


# ── Guardrails ────────────────────────────────────────────────────────────────

def test_query_under_two_chars_returns_empty(svc):
    _vid(svc, "A video", "sq1")
    for q in ("", "a", "  a ", None):
        out = srch.search(q)
        assert out["results"] == [] and out["total"] == 0


def test_limit_default_30_and_cap_50(svc):
    for i in range(55):
        _vid(svc, f"Momentum lesson {i}", f"lim{i:03d}")
    assert srch.search("momentum")["total"] == 30          # default
    assert srch.search("momentum", limit=5)["total"] == 5   # respected
    assert srch.search("momentum", limit=999)["total"] == 50  # capped


def test_fts_syntax_is_treated_as_literal(svc):
    _vid(svc, 'Weird "quoted" OR title', "inj1")
    # must not raise, and OR/quotes must not act as FTS operators
    out = srch.search('"quoted" OR nothing')
    assert isinstance(out["results"], list)
    out2 = srch.search("missing OR alsomissing")
    assert out2["total"] == 0  # literal AND semantics — OR is just a token
    out3 = srch.search("quoted title")
    assert out3["total"] == 1


# ── Dirty-flag rebuild rail ───────────────────────────────────────────────────

def test_write_sets_dirty_flag_and_next_search_rebuilds(svc):
    _vid(svc, "First video about gaps", "d1")
    assert srch.search("gaps")["total"] == 1
    assert svc._search_dirty is False
    svc.create_video({"youtube_id": "d2", "title": "Second gaps video",
                      "category": "General"})
    assert svc._search_dirty is True  # write only FLAGS — no synchronous rebuild
    out = srch.search("gaps")
    assert out["total"] == 2
    assert svc._search_dirty is False


def test_delete_video_drops_from_index(svc):
    v = _vid(svc, "Deletable gaps video", "del1")
    assert srch.search("deletable")["total"] == 1
    svc.delete_video(v["id"])
    assert srch.search("deletable")["total"] == 0


def test_update_title_reindexes(svc):
    v = _vid(svc, "Old name", "up1")
    assert srch.search("wyckoff")["total"] == 0
    svc.update_video(v["id"], {"title": "Wyckoff accumulation"})
    out = srch.search("wyckoff")
    assert out["total"] == 1 and out["results"][0]["title"] == "Wyckoff accumulation"


def test_set_video_insights_reindexes_transcript(svc):
    v = _vid(svc, "Plain video", "si1")
    assert srch.search("liquidity")["total"] == 0
    svc.set_video_insights(v["id"], transcript="[1:00] liquidity sweep explained")
    out = srch.search("liquidity")
    assert out["total"] == 1 and out["results"][0]["t"] == 60


def test_bulk_apply_taxonomy_marks_dirty(svc):
    v = _vid(svc, "Bulk target", "blk1")
    srch.search("bulk")  # build index → flag cleared
    assert svc._search_dirty is False
    svc.bulk_apply_taxonomy(
        categories=[{"name": "Shows", "kind": "show"}],
        assignments=[{"id": v["id"], "category": "Shows", "tags": []}])
    assert svc._search_dirty is True
    # category served fresh from edu_videos on the next search
    assert srch.search("bulk")["results"][0]["category"] == "Shows"


# ── LIKE fallback (same signature, %/_ escaped) ───────────────────────────────

def test_like_fallback_full_behavior(svc, monkeypatch):
    monkeypatch.setattr(srch, "_MODE", "like")
    _vid(svc, "VCP Masterclass", "lk1")
    _vid(svc, "Video with 100% moves", "lk2")
    _vid(svc, "Chapter vid", "lk3", chapters=[{"t": 10, "title": "VCP entries"}])
    out = srch.search("VCP")
    assert out["mode"] == "like"
    assert [r["match_field"] for r in out["results"]] == ["title", "chapter"]
    assert out["results"][1]["t"] == 10
    assert "<b>VCP</b>" in out["results"][0]["snippet"]
    # % and _ are literals, never LIKE wildcards
    out2 = srch.search("100%")
    assert out2["total"] == 1 and out2["results"][0]["youtube_id"] == "lk2"
    assert srch.search("V_P")["total"] == 0


# ── Router: GET /api/education/search (require_paid) ──────────────────────────

def test_search_route_requires_paid(svc):
    client = TestClient(_app())
    r = client.get("/api/education/search", params={"q": "vcp"})
    assert r.status_code in (401, 402, 403)


def test_search_route_returns_results_shape(svc):
    _vid(svc, "VCP Masterclass", "rt1")
    app = _app()
    app.dependency_overrides[edu_router.require_paid] = lambda: {"id": "u1"}
    client = TestClient(app)
    r = client.get("/api/education/search", params={"q": "vcp", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1 and body["mode"] in ("fts", "like")
    r0 = body["results"][0]
    assert set(r0) == {"id", "youtube_id", "title", "category",
                       "match_field", "snippet", "t"}
    assert r0["match_field"] == "title" and r0["t"] is None


def test_search_route_short_query_is_empty_not_error(svc):
    app = _app()
    app.dependency_overrides[edu_router.require_paid] = lambda: {"id": "u1"}
    client = TestClient(app)
    r = client.get("/api/education/search", params={"q": "x"})
    assert r.status_code == 200
    assert r.json()["results"] == [] and r.json()["total"] == 0
