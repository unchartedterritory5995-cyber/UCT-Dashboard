"""The auto-maintained 'Sunday Scans' community watchlist.

The list mirrors the newest Desk article's ticker roster. Load-bearing rules:
  1. the roster comes from desk_store.latest_post_with_tickers — the SAME
     tickers_json the reader's Covered row shows (never a second derivation),
  2. an unreadable source means "leave the existing list alone", never
     "delete it" (the seeder's delete-what-isn't-configured step is the
     specific hazard — _PROTECTED exempts this list),
  3. the hourly substack poller resyncs it, fail-soft.
"""
from __future__ import annotations

import ast
import importlib
import json

import pytest

PUBLISHED_AT = 1786902774  # 2026-08-16-ish


# ── the source read (real sandboxed desk DB, same idiom as related_posts tests) ──

@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DESK_DB_PATH", str(tmp_path / "desk.db"))
    from api.services import desk_store as ds
    importlib.reload(ds)
    ds._init_db()
    return ds


def seed(store, post_id, slug, tickers, *, published_at=PUBLISHED_AT):
    store.upsert_post({"id": post_id, "title": "SUNDAY SCANS", "url": post_id,
                       "published_at": published_at})
    store.save_post_body(post_id, {
        "body_html": "<p>x</p>", "slug": slug,
        "display_title": f"Sunday Scans — {slug}",
        "tickers_json": json.dumps(tickers), "reading_minutes": 14,
    })


def test_latest_post_with_tickers_picks_newest_roster_in_author_order(store):
    seed(store, "old", "old", ["KO", "PEP"], published_at=PUBLISHED_AT - 7 * 86400)
    seed(store, "new", "new", ["INTC", "MU", "ARM"])
    got = store.latest_post_with_tickers()
    assert got is not None
    assert got["tickers"] == ["INTC", "MU", "ARM"]   # author order, not sorted
    assert got["published_at"] == PUBLISHED_AT


def test_latest_post_with_tickers_skips_rosterless_posts(store):
    seed(store, "haslist", "haslist", ["MU"], published_at=PUBLISHED_AT - 7 * 86400)
    # Newer post with NO roster must not blank the list.
    store.upsert_post({"id": "bare", "title": "SUNDAY SCANS", "url": "bare",
                       "published_at": PUBLISHED_AT})
    got = store.latest_post_with_tickers()
    assert got and got["tickers"] == ["MU"]


def test_latest_post_with_tickers_empty_store_returns_none(store):
    assert store.latest_post_with_tickers() is None


# ── the spec + seeder integration ────────────────────────────────────────────

@pytest.fixture()
def prebuilt(monkeypatch):
    from api.services import watchlist_prebuilt as wp
    return wp


def _fake_desk(monkeypatch, row):
    from api.services import desk_store
    monkeypatch.setattr(desk_store, "latest_post_with_tickers", lambda: row)


def test_spec_derives_from_the_desk_store(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, {"id": "x", "title": "Sunday Scans — Aug 16",
                             "published_at": PUBLISHED_AT,
                             "tickers": ["intc", "MU", "Arm"]})
    spec = prebuilt._sunday_scans_spec()
    assert spec["name"] == prebuilt.SUNDAY_SCANS_NAME
    assert spec["tickers"] == ["INTC", "MU", "ARM"]
    assert spec["category"] == prebuilt._COMMUNITY_CATEGORY
    assert "updates automatically" in spec["desc"]


def test_spec_is_none_when_source_unreadable(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, None)
    assert prebuilt._sunday_scans_spec() is None


def test_committed_config_carries_the_list_and_its_category(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, {"id": "x", "title": "t", "published_at": PUBLISHED_AT,
                             "tickers": ["INTC", "MU"]})
    names = [l["name"] for l in prebuilt._load_committed()]
    assert prebuilt.SUNDAY_SCANS_NAME in names
    assert prebuilt.category_map()["sunday scans"] == prebuilt._COMMUNITY_CATEGORY
    assert prebuilt._COMMUNITY_CATEGORY in prebuilt.category_order()


def test_seeder_never_deletes_the_protected_list_when_source_is_down(prebuilt, monkeypatch):
    """The hazard this feature must survive: desk store unreadable at boot →
    Sunday Scans absent from the config → the delete step must SKIP it. The
    unprotected stale row in the same run is the non-vacuity control — the
    delete step is provably alive."""
    _fake_desk(monkeypatch, None)   # config will NOT contain Sunday Scans
    existing = [
        {"id": "wl-ss", "user_id": "admin", "name": "Sunday Scans", "items": []},
        {"id": "wl-old", "user_id": "admin", "name": "Delisted Legends", "items": []},
    ]
    deleted = []
    monkeypatch.setattr(prebuilt.wl, "list_prebuilt_watchlists", lambda n=500: existing)
    monkeypatch.setattr(prebuilt.wl, "delete_watchlist",
                        lambda uid, wid: deleted.append(wid) or True)
    # No reconcile/creation side effects for lists that DO exist correctly.
    monkeypatch.setattr(prebuilt, "_admin_user_id", lambda: None)
    prebuilt.seed_prebuilt_watchlists()
    assert "wl-old" in deleted          # control: the delete step ran
    assert "wl-ss" not in deleted       # the protected list survived


# ── sync_sunday_scans ────────────────────────────────────────────────────────

def test_sync_unavailable_source_touches_nothing(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, None)
    called = []
    monkeypatch.setattr(prebuilt.wl, "delete_watchlist",
                        lambda *a: called.append(a) or True)
    got = prebuilt.sync_sunday_scans()
    assert got["status"] == "unavailable"
    assert called == []


def test_sync_keeps_a_current_list(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, {"id": "x", "title": "t", "published_at": PUBLISHED_AT,
                             "tickers": ["INTC", "MU"]})
    rows = [{"id": "wl-ss", "user_id": "admin", "name": "Sunday Scans",
             "items": [{"sym": "MU"}, {"sym": "INTC"}]}]
    deleted, created = [], []
    monkeypatch.setattr(prebuilt.wl, "list_prebuilt_watchlists", lambda n=500: rows)
    monkeypatch.setattr(prebuilt.wl, "delete_watchlist",
                        lambda uid, wid: deleted.append(wid) or True)
    monkeypatch.setattr(prebuilt, "_create_list",
                        lambda *a: created.append(a) or True)
    got = prebuilt.sync_sunday_scans()
    assert got["status"] == "current"
    assert deleted == [] and created == []


def test_sync_rebuilds_on_drift(prebuilt, monkeypatch):
    """A new issue landed: the stored set no longer matches → old list dropped,
    fresh one created with the new roster in author order."""
    _fake_desk(monkeypatch, {"id": "x", "title": "t", "published_at": PUBLISHED_AT,
                             "tickers": ["NBIS", "SNDK", "MU"]})
    rows = [{"id": "wl-ss", "user_id": "admin", "name": "Sunday Scans",
             "items": [{"sym": "INTC"}, {"sym": "MU"}]}]
    deleted, created = [], []
    monkeypatch.setattr(prebuilt.wl, "list_prebuilt_watchlists", lambda n=500: rows)
    monkeypatch.setattr(prebuilt.wl, "delete_watchlist",
                        lambda uid, wid: deleted.append(wid) or True)
    monkeypatch.setattr(prebuilt, "_admin_user_id", lambda: "admin")
    monkeypatch.setattr(prebuilt, "_create_list",
                        lambda admin, name, desc, tickers: created.append((name, tickers)) or True)
    got = prebuilt.sync_sunday_scans()
    assert got["status"] == "rebuilt"
    assert deleted == ["wl-ss"]
    assert created == [("Sunday Scans", ["NBIS", "SNDK", "MU"])]


def test_sync_without_admin_creates_nothing(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, {"id": "x", "title": "t", "published_at": PUBLISHED_AT,
                             "tickers": ["MU"]})
    monkeypatch.setattr(prebuilt.wl, "list_prebuilt_watchlists", lambda n=500: [])
    monkeypatch.setattr(prebuilt, "_admin_user_id", lambda: None)
    created = []
    monkeypatch.setattr(prebuilt, "_create_list", lambda *a: created.append(a) or True)
    assert prebuilt.sync_sunday_scans()["status"] == "no_admin"
    assert created == []


# ── the poller wire (AST-derived, never a grep; with a non-vacuity control) ──

def _calls_in(fn_node):
    return {n.func.id if isinstance(n.func, ast.Name) else getattr(n.func, "attr", "")
            for n in ast.walk(fn_node) if isinstance(n, ast.Call)}


def test_poll_all_calls_the_sunday_scans_sync():
    import api.services.substack_poller as sp
    tree = ast.parse(open(sp.__file__, encoding="utf-8").read())
    fns = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    poll_calls = _calls_in(fns["poll_all"])
    # Non-vacuity control: the probe can see a sibling call it isn't testing.
    assert "_backfill_slice" in poll_calls
    assert "_sync_sunday_scans_watchlist" in poll_calls
    # And the helper actually reaches watchlist_prebuilt.sync_sunday_scans.
    assert "sync_sunday_scans" in _calls_in(fns["_sync_sunday_scans_watchlist"])
