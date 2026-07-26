"""edu_categories meta table + tags + grouped payload (Desk taxonomy redesign)."""
import importlib
import json

import pytest


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    return es


def _add(svc, title, category, yt="", **kw):
    return svc.create_video({"youtube_id": yt or f"yt_{title[:8]}", "title": title,
                             "category": category, **kw})


def test_upsert_category_appends_at_tail_within_kind(svc):
    a = svc.upsert_category("Live Trading Sessions", kind="show")
    b = svc.upsert_category("Post-Market Recaps", kind="show")
    c = svc.upsert_category("Options & Flow", kind="library")
    assert a["sort_order"] < b["sort_order"]
    assert [m["name"] for m in svc.list_category_meta()] == [
        "Live Trading Sessions", "Post-Market Recaps", "Options & Flow"]
    assert c["kind"] == "library"


def test_upsert_category_updates_only_provided_fields(svc):
    svc.upsert_category("Interviews", kind="library", blurb="Guests")
    got = svc.upsert_category("Interviews", sort_order=5)
    assert got["blurb"] == "Guests" and got["sort_order"] == 5 and got["kind"] == "library"


def test_upsert_category_rejects_bad_kind(svc):
    with pytest.raises(ValueError):
        svc.upsert_category("X", kind="playlist")


def test_set_video_tags_roundtrip(svc):
    v = _add(svc, "Risk 101", "Risk & Trade Management")
    svc.set_video_tags(v["id"], ["risk", "starter"])
    assert json.loads(svc.get_video(v["id"])["tags"]) == ["risk", "starter"]


def test_grouped_payload_orders_shows_first_then_library(svc):
    svc.upsert_category("Live Trading Sessions", kind="show")
    svc.upsert_category("Options & Flow", kind="library")
    _add(svc, "Session Jul 24", "Live Trading Sessions", yt="ltsA")
    _add(svc, "Flow basics", "Options & Flow", yt="oafA")
    out = svc.grouped_videos_payload()
    names = [c["name"] for c in out["categories"]]
    assert names == ["Live Trading Sessions", "Options & Flow"]
    assert out["categories"][0]["kind"] == "show"
    assert out["total"] == 2
    assert out["categories"][1]["videos"][0]["tags"] == []


def test_grouped_payload_auto_registers_unknown_category_at_tail(svc):
    svc.upsert_category("Options & Flow", kind="library")
    _add(svc, "Flow basics", "Options & Flow", yt="oafB")
    _add(svc, "Mystery Webinar", "Tonight", yt="mysB")  # no meta row
    out = svc.grouped_videos_payload()
    assert [c["name"] for c in out["categories"]] == ["Options & Flow", "Tonight"]
    meta = {m["name"]: m for m in svc.list_category_meta()}
    assert "Tonight" in meta  # registered so it renders ordered next time


def test_rename_category_moves_rows_and_meta(svc):
    svc.upsert_category("Live Sessions", kind="show")
    svc.upsert_category("Live Trading Sessions", kind="show")
    _add(svc, "Old stream", "Live Sessions", yt="oldC")
    moved = svc.rename_category("Live Sessions", "Live Trading Sessions")
    assert moved == 1
    assert svc.get_video_by_youtube_id("oldC")["category"] == "Live Trading Sessions"
    assert "Live Sessions" not in {m["name"] for m in svc.list_category_meta()}


def test_bulk_apply_taxonomy_transactional(svc):
    v1 = _add(svc, "A", "General", yt="bulkA")
    v2 = _add(svc, "B", "General", yt="bulkB")
    res = svc.bulk_apply_taxonomy(
        categories=[{"name": "Setups & Strategies", "kind": "library",
                     "sort_order": 0, "blurb": "The playbook"}],
        assignments=[{"id": v1["id"], "category": "Setups & Strategies", "tags": ["vcp"]},
                     {"id": v2["id"], "category": "Setups & Strategies", "tags": []},
                     {"id": 99999, "category": "Setups & Strategies", "tags": []}],
    )
    assert res["videos"] == 2 and res["missing_ids"] == [99999]
    assert svc.get_video(v1["id"])["category"] == "Setups & Strategies"
    assert json.loads(svc.get_video(v1["id"])["tags"]) == ["vcp"]
