"""edu_paths / edu_path_steps schema + service CRUD + seed migration
(Desk Courses Track 1, Task 1). Mirrors tests/test_education_taxonomy.py."""
import contextlib
import os

import pytest


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    return es


def _path(svc, slug="foundations", **kw):
    payload = {
        "slug": slug,
        "name": kw.get("name", "Foundations"),
        "blurb": kw.get("blurb", "The basics."),
        "kind": kw.get("kind", "track"),
        "sort_order": kw.get("sort_order", 0),
    }
    if "enabled" in kw:
        payload["enabled"] = kw["enabled"]
    return svc.create_path(payload)


# ── Schema ─────────────────────────────────────────────────────────────────

def test_schema_creates_edu_paths_and_steps_tables(svc):
    with contextlib.closing(svc._connect()) as c:
        tables = {r["name"] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "edu_paths" in tables
    assert "edu_path_steps" in tables


def test_delete_path_cascades_steps(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "abc12345678"}])
    with contextlib.closing(svc._connect()) as c:
        before = c.execute(
            "SELECT COUNT(*) AS n FROM edu_path_steps WHERE path_id = ?",
            (p["id"],)).fetchone()["n"]
        assert before == 1
    assert svc.delete_path(p["id"]) is True
    with contextlib.closing(svc._connect()) as c:
        after = c.execute(
            "SELECT COUNT(*) AS n FROM edu_path_steps WHERE path_id = ?",
            (p["id"],)).fetchone()["n"]
    assert after == 0


def test_delete_missing_path_returns_false(svc):
    assert svc.delete_path(99999) is False


# ── create_path validation ───────────────────────────────────────────────────

def test_create_path_requires_slug(svc):
    with pytest.raises(ValueError):
        svc.create_path({"name": "X"})


def test_create_path_requires_name(svc):
    with pytest.raises(ValueError):
        svc.create_path({"slug": "x"})


def test_create_path_rejects_non_kebab_slug(svc):
    with pytest.raises(ValueError):
        svc.create_path({"slug": "Not Kebab!", "name": "X"})


def test_create_path_rejects_slug_collision(svc):
    _path(svc, slug="risk")
    with pytest.raises(ValueError):
        _path(svc, slug="risk", name="Risk 2")


def test_create_path_rejects_bad_kind(svc):
    with pytest.raises(ValueError):
        svc.create_path({"slug": "x", "name": "X", "kind": "bogus"})


def test_create_path_defaults(svc):
    p = _path(svc, slug="x", name="X")
    assert p["kind"] == "track"
    assert p["enabled"] == 1
    assert p["sort_order"] == 0
    assert p["steps"] == []


# ── update_path ──────────────────────────────────────────────────────────────

def test_update_path_partial(svc):
    p = _path(svc)
    updated = svc.update_path(p["id"], {"name": "Renamed", "enabled": False})
    assert updated["name"] == "Renamed"
    assert updated["enabled"] == 0
    assert updated["slug"] == p["slug"]  # untouched


def test_update_path_slug_immutable(svc):
    p = _path(svc)
    updated = svc.update_path(p["id"], {"slug": "different", "name": "Still Foundations"})
    assert updated["slug"] == p["slug"]  # 'slug' silently ignored (not a patchable field)


def test_update_missing_path_returns_none(svc):
    assert svc.update_path(99999, {"name": "x"}) is None


def test_update_path_rejects_bad_kind(svc):
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"kind": "bogus"})


def test_update_path_rejects_blank_name(svc):
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"name": "   "})


def test_update_path_kind_none_raises(svc):
    # kind is NOT NULL — an explicit null must raise ValueError (→ 400 at the
    # router), not fall through to an uncaught sqlite3.IntegrityError.
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"kind": None})
    assert svc.get_path(p["id"])["kind"] == "track"  # nothing landed


def test_update_path_sort_order_none_raises(svc):
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"sort_order": None})
    assert svc.get_path(p["id"])["sort_order"] == 0  # nothing landed


def test_update_path_enabled_none_is_ignored_not_disabled(svc):
    p = _path(svc)
    assert p["enabled"] == 1
    updated = svc.update_path(p["id"], {"name": "Renamed", "enabled": None})
    assert updated["name"] == "Renamed"
    assert updated["enabled"] == 1  # untouched, NOT coerced to 0


def test_update_path_enabled_none_alone_is_full_noop(svc):
    p = _path(svc)
    updated = svc.update_path(p["id"], {"enabled": None})
    assert updated == svc.get_path(p["id"])
    assert updated["enabled"] == 1


# ── list_paths ordering + shape ──────────────────────────────────────────────

def test_list_paths_orders_course_first_then_sort_order_then_name(svc):
    _path(svc, slug="t2", name="Zed Track", kind="track", sort_order=0)
    _path(svc, slug="t1", name="Alpha Track", kind="track", sort_order=1)
    _path(svc, slug="c1", name="Beta Course", kind="course", sort_order=5)
    names = [p["name"] for p in svc.list_paths()]
    assert names == ["Beta Course", "Zed Track", "Alpha Track"]


def test_list_paths_excludes_disabled_by_default(svc):
    p = _path(svc, slug="off", enabled=False)
    assert p["id"] not in [x["id"] for x in svc.list_paths()]
    assert p["id"] in [x["id"] for x in svc.list_paths(include_disabled=True)]


def test_list_paths_includes_ordered_steps(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [
        {"youtube_id": "bbbbbbbbbbb", "module_label": "M2"},
        {"youtube_id": "aaaaaaaaaaa", "module_label": "M1"},
    ])
    got = next(x for x in svc.list_paths() if x["id"] == p["id"])
    assert [s["youtube_id"] for s in got["steps"]] == ["bbbbbbbbbbb", "aaaaaaaaaaa"]
    assert got["steps"][0]["module_label"] == "M2"


def test_get_path_returns_none_when_missing(svc):
    assert svc.get_path(99999) is None


# ── replace_path_steps ──────────────────────────────────────────────────────

def test_replace_path_steps_orders_from_array_order(svc):
    p = _path(svc)
    n = svc.replace_path_steps(p["id"], [
        {"youtube_id": "zzzzzzzzzzz"},
        {"youtube_id": "aaaaaaaaaaa"},
        {"youtube_id": "mmmmmmmmmmm"},
    ])
    assert n == 3
    got = svc.get_path(p["id"])
    assert [s["youtube_id"] for s in got["steps"]] == \
        ["zzzzzzzzzzz", "aaaaaaaaaaa", "mmmmmmmmmmm"]


def test_replace_path_steps_is_full_replacement(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa"}, {"youtube_id": "bbbbbbbbbbb"}])
    svc.replace_path_steps(p["id"], [{"youtube_id": "ccccccccccc"}])
    got = svc.get_path(p["id"])
    assert [s["youtube_id"] for s in got["steps"]] == ["ccccccccccc"]


def test_replace_path_steps_rejects_empty_youtube_id_and_leaves_existing_untouched(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa"}])
    with pytest.raises(ValueError):
        svc.replace_path_steps(p["id"], [{"youtube_id": "bbbbbbbbbbb"}, {"youtube_id": ""}])
    # Nothing landed: the pre-existing step is exactly as it was.
    assert [s["youtube_id"] for s in svc.get_path(p["id"])["steps"]] == ["aaaaaaaaaaa"]


def test_replace_path_steps_missing_path_raises(svc):
    with pytest.raises(ValueError):
        svc.replace_path_steps(99999, [{"youtube_id": "aaaaaaaaaaa"}])


def test_replace_path_steps_can_clear_to_empty(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa"}])
    n = svc.replace_path_steps(p["id"], [])
    assert n == 0
    assert svc.get_path(p["id"])["steps"] == []


# ── bulk_apply_paths ─────────────────────────────────────────────────────────

def test_bulk_apply_paths_upserts_by_slug_and_replaces_steps(svc):
    res = svc.bulk_apply_paths([
        {"slug": "foundations", "name": "Foundations", "blurb": "b1", "kind": "track",
         "sort_order": 0, "enabled": True,
         "steps": [{"youtube_id": "aaaaaaaaaaa"}, {"youtube_id": "bbbbbbbbbbb"}]},
    ])
    assert res == {"paths": 1, "steps": 2}
    p = next(x for x in svc.list_paths() if x["slug"] == "foundations")
    assert [s["youtube_id"] for s in p["steps"]] == ["aaaaaaaaaaa", "bbbbbbbbbbb"]

    # Re-apply with a different name/steps — upserts (same row id), replaces steps.
    res2 = svc.bulk_apply_paths([
        {"slug": "foundations", "name": "Foundations Renamed", "kind": "track",
         "steps": [{"youtube_id": "ccccccccccc"}]},
    ])
    assert res2 == {"paths": 1, "steps": 1}
    p2 = next(x for x in svc.list_paths() if x["slug"] == "foundations")
    assert p2["id"] == p["id"]
    assert p2["name"] == "Foundations Renamed"
    assert [s["youtube_id"] for s in p2["steps"]] == ["ccccccccccc"]


def test_bulk_apply_paths_rolls_back_whole_batch_on_bad_slug(svc):
    _path(svc, slug="existing", name="Existing")
    with pytest.raises(ValueError):
        svc.bulk_apply_paths([
            {"slug": "good-one", "name": "Good", "kind": "track",
             "steps": [{"youtube_id": "aaaaaaaaaaa"}]},
            {"slug": "bad one!", "name": "Bad slug", "kind": "track", "steps": []},
        ])
    # Nothing landed: the valid entry earlier in the list didn't get created
    # either, and the pre-existing path is completely untouched.
    paths = svc.list_paths(include_disabled=True)
    slugs = {p["slug"] for p in paths}
    assert "good-one" not in slugs
    assert slugs == {"existing"}
    existing = next(p for p in paths if p["slug"] == "existing")
    assert existing["name"] == "Existing"
    assert existing["steps"] == []


def test_bulk_apply_paths_rolls_back_whole_batch_on_bad_step(svc):
    with pytest.raises(ValueError):
        svc.bulk_apply_paths([
            {"slug": "x", "name": "X", "kind": "track",
             "steps": [{"youtube_id": ""}]},
        ])
    assert svc.list_paths(include_disabled=True) == []


def test_bulk_apply_paths_empty_list_is_noop(svc):
    assert svc.bulk_apply_paths([]) == {"paths": 0, "steps": 0}


# ── ensure_default_paths (flag-file one-shot migration) ──────────────────────

def test_ensure_default_paths_seeds_exactly_six_once(svc):
    from api.services.education_paths_seed import SEED_PATHS
    assert len(SEED_PATHS) == 6
    svc.ensure_default_paths()
    paths = svc.list_paths(include_disabled=True)
    assert len(paths) == 6
    assert all(p["kind"] == "track" for p in paths)
    assert all(p["enabled"] == 1 for p in paths)
    got_slugs_by_sort = [p["slug"] for p in sorted(paths, key=lambda x: x["sort_order"])]
    assert got_slugs_by_sort == [p["slug"] for p in SEED_PATHS]

    # Re-run on the next "boot" — flag file blocks a re-check entirely, no dup.
    svc.ensure_default_paths()
    assert len(svc.list_paths(include_disabled=True)) == 6


def test_ensure_default_paths_seeds_steps_in_file_order(svc):
    from api.services.education_paths_seed import SEED_PATHS
    svc.ensure_default_paths()
    expected = next(x for x in SEED_PATHS if x["slug"] == "foundations")
    p = next(x for x in svc.list_paths(include_disabled=True) if x["slug"] == "foundations")
    assert [s["youtube_id"] for s in p["steps"]] == expected["steps"]


def test_ensure_default_paths_respects_existing_flag_file(svc):
    flag = os.path.join(os.path.dirname(svc._DB_PATH), ".edu_paths_migrate_v1")
    with open(flag, "w") as f:
        f.write("v1")
    svc.ensure_default_paths()
    assert svc.list_paths(include_disabled=True) == []


def test_ensure_default_paths_respects_nonempty_table_no_dup(svc):
    _path(svc, slug="custom", name="Admin's own path")
    svc.ensure_default_paths()
    paths = svc.list_paths(include_disabled=True)
    # Table was non-empty (an admin/prior boot already added a path) → seed
    # skipped entirely — but the flag is still written so future boots never
    # re-check (and never fight the admin's edits).
    assert [p["slug"] for p in paths] == ["custom"]
    flag = os.path.join(os.path.dirname(svc._DB_PATH), ".edu_paths_migrate_v1")
    assert os.path.exists(flag)
