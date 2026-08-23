"""The auto-maintained 'Sunday Scans' community watchlists — one dated list per
issue, the newest SUNDAY_SCANS_KEEP issues kept (a rolling one-quarter look-back).

Load-bearing rules:
  1. the rosters come from desk_store.sunday_scans_posts — the SAME tickers_json
     the reader's Covered row shows (never a second derivation), restricted to
     the Sunday Scans series (a 'Rest of the Week' post must never become one),
  2. every list name carries its issue date — derived from published_at in ET,
     and the date round-trips back out of the name (retention is pruned BY DATE),
  3. an unreadable source means "leave the existing lists alone", never "delete
     them" (the seeder's delete-what-isn't-configured step is the hazard),
  4. an issue older than the window is retired; the legacy undated list is
     retired once the dated set is readable,
  5. the hourly substack poller resyncs the family, fail-soft.
"""
from __future__ import annotations

import ast
import importlib
import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

ET = ZoneInfo("America/New_York")


def ts(y, m, d, h=9):
    return int(datetime(y, m, d, h, tzinfo=ET).timestamp())


AUG16, AUG9, AUG2, JUL26 = ts(2026, 8, 16), ts(2026, 8, 9), ts(2026, 8, 2), ts(2026, 7, 26)
PUBLISHED_AT = AUG16


# ── the source read (real sandboxed desk DB, same idiom as related_posts tests) ──

@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DESK_DB_PATH", str(tmp_path / "desk.db"))
    from api.services import desk_store as ds
    importlib.reload(ds)
    ds._init_db()
    return ds


def seed(store, post_id, slug, tickers, *, published_at=PUBLISHED_AT, title="SUNDAY SCANS"):
    store.upsert_post({"id": post_id, "title": title, "url": post_id,
                       "published_at": published_at})
    store.save_post_body(post_id, {
        "body_html": "<p>x</p>", "slug": slug,
        "display_title": f"{title.title()} — {slug}",
        "tickers_json": json.dumps(tickers), "reading_minutes": 14,
    })


def test_sunday_scans_posts_returns_newest_issues_first_in_author_order(store):
    seed(store, "a2", "a2", ["KO", "PEP"], published_at=AUG2)
    seed(store, "a16", "a16", ["INTC", "MU", "ARM"], published_at=AUG16)
    seed(store, "a9", "a9", ["NBIS"], published_at=AUG9)
    got = store.sunday_scans_posts(2)
    assert [r["id"] for r in got] == ["a16", "a9"]            # newest first, capped
    assert got[0]["tickers"] == ["INTC", "MU", "ARM"]        # author order, not sorted
    assert got[0]["published_at"] == AUG16
    assert [r["id"] for r in store.sunday_scans_posts(12)] == ["a16", "a9", "a2"]


def test_sunday_scans_posts_skips_other_series_even_when_newer(store):
    """'The Rest of the Week' carries a 3-4 name roster too. It is NOT an issue
    of the series and must never become a Sunday Scans list — nor displace the
    newest issue. The Sunday row in the same store is the non-vacuity control."""
    seed(store, "sun", "sun", ["MU"], published_at=AUG9)
    seed(store, "rotw", "rotw", ["KO", "PEP", "XOM"], published_at=AUG9 + 2 * 86400,
         title="The Rest of the Week")
    assert [r["id"] for r in store.sunday_scans_posts(12)] == ["sun"]
    assert store.latest_post_with_tickers()["id"] == "sun"


def test_latest_post_with_tickers_is_the_newest_issue(store):
    seed(store, "old", "old", ["KO", "PEP"], published_at=AUG9)
    seed(store, "new", "new", ["INTC", "MU", "ARM"])
    got = store.latest_post_with_tickers()
    assert got is not None
    assert got["tickers"] == ["INTC", "MU", "ARM"]
    assert got["published_at"] == PUBLISHED_AT


def test_latest_post_with_tickers_skips_rosterless_posts(store):
    seed(store, "haslist", "haslist", ["MU"], published_at=AUG9)
    # Newer post with NO roster must not blank the list.
    store.upsert_post({"id": "bare", "title": "SUNDAY SCANS", "url": "bare",
                       "published_at": PUBLISHED_AT})
    got = store.latest_post_with_tickers()
    assert got and got["tickers"] == ["MU"]


def test_latest_post_with_tickers_empty_store_returns_none(store):
    assert store.latest_post_with_tickers() is None
    assert store.sunday_scans_posts(12) == []


# ── the specs: one dated list per issue ──────────────────────────────────────

@pytest.fixture()
def prebuilt(monkeypatch):
    from api.services import watchlist_prebuilt as wp
    return wp


def _row(pid, published_at, tickers):
    return {"id": pid, "title": "Sunday Scans", "published_at": published_at, "tickers": tickers}


ISSUES = [_row("a16", AUG16, ["intc", "MU", "Arm"]), _row("a9", AUG9, ["NBIS", "SNDK"]),
          _row("a2", AUG2, ["KO"])]


def _fake_desk(monkeypatch, rows):
    """rows=None models an unreadable store (the accessor raises)."""
    from api.services import desk_store

    def fake(limit=12):
        if rows is None:
            raise RuntimeError("desk store unreadable")
        return list(rows)[:limit]
    monkeypatch.setattr(desk_store, "sunday_scans_posts", fake)


def test_the_list_name_carries_the_issue_date_in_et(prebuilt):
    assert prebuilt.sunday_scans_list_name(ISSUES[0]) == "Sunday Scans — August 16, 2026"
    assert prebuilt.sunday_scans_list_name(ISSUES[2]) == "Sunday Scans — August 2, 2026"
    # 11pm ET on the Saturday is already Sunday in UTC — the name follows ET.
    late_sat = int(datetime(2026, 8, 15, 23, tzinfo=ET).timestamp())
    assert prebuilt.sunday_scans_list_name(_row("x", late_sat, ["MU"])).endswith("August 15, 2026")


def test_the_issue_date_round_trips_out_of_the_name(prebuilt):
    """Retention prunes BY DATE parsed from the name, so the formatter and the
    parser must agree — pinned as a round trip, not two literals."""
    for row in ISSUES:
        nm = prebuilt.sunday_scans_list_name(row)
        assert prebuilt._issue_date_from_name(nm) == datetime.fromtimestamp(row["published_at"], ET).date()
    assert prebuilt._issue_date_from_name(prebuilt.SUNDAY_SCANS_NAME) is None   # legacy undated
    assert prebuilt._issue_date_from_name("Sunday Scans — someday") is None
    assert prebuilt._issue_date_from_name("Liquid Major ETFs") is None


def test_family_membership_is_by_name_prefix(prebuilt):
    assert prebuilt._is_sunday_family("Sunday Scans")
    assert prebuilt._is_sunday_family("  sunday scans — August 9, 2026")
    assert not prebuilt._is_sunday_family("Liquid Major ETFs")
    assert not prebuilt._is_sunday_family("")


def test_specs_are_one_dated_list_per_issue_newest_first(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, ISSUES)
    specs = prebuilt.sunday_scans_specs()
    assert [s["name"] for s in specs] == [
        "Sunday Scans — August 16, 2026", "Sunday Scans — August 9, 2026",
        "Sunday Scans — August 2, 2026"]
    assert specs[0]["tickers"] == ["INTC", "MU", "ARM"]
    assert [s["issue_date"] for s in specs] == ["2026-08-16", "2026-08-09", "2026-08-02"]
    assert {s["category"] for s in specs} == {prebuilt._COMMUNITY_CATEGORY}
    assert "August 9, 2026" in specs[1]["desc"]


def test_specs_keep_only_the_newest_window(prebuilt, monkeypatch):
    assert prebuilt.SUNDAY_SCANS_KEEP == 12      # the owner's "one quarter / 12 weeks"
    many = [_row(f"p{i}", AUG16 - i * 7 * 86400, ["MU"]) for i in range(15)]
    _fake_desk(monkeypatch, many)
    specs = prebuilt.sunday_scans_specs()
    assert len(specs) == 12
    assert specs[0]["issue_date"] == "2026-08-16" and specs[-1]["issue_date"] == "2026-05-31"
    monkeypatch.setattr(prebuilt, "SUNDAY_SCANS_KEEP", 2)
    assert len(prebuilt.sunday_scans_specs()) == 2


def test_specs_are_empty_when_source_unreadable(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, None)
    assert prebuilt.sunday_scans_specs() == []
    _fake_desk(monkeypatch, [_row("bare", AUG16, [])])
    assert prebuilt.sunday_scans_specs() == []


def test_committed_config_carries_every_issue_list_and_the_category(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, ISSUES)
    names = [l["name"] for l in prebuilt._load_committed()]
    for s in prebuilt.sunday_scans_specs():
        assert s["name"] in names
        assert prebuilt.category_map()[s["name"].lower()] == prebuilt._COMMUNITY_CATEGORY
    assert prebuilt._COMMUNITY_CATEGORY in prebuilt.category_order()
    assert prebuilt.issue_date_map() == {
        "sunday scans — august 16, 2026": "2026-08-16",
        "sunday scans — august 9, 2026": "2026-08-09",
        "sunday scans — august 2, 2026": "2026-08-02",
    }
    assert "liquid major etfs" not in prebuilt.issue_date_map()


def test_alias_map_tags_exactly_the_newest_issue(prebuilt, monkeypatch):
    """A widget pinned to `community:alias:sunday-scans-latest` must follow each
    new issue: the alias sits on the NEWEST list only, moves with it, and is
    absent when the store is unreadable (nothing for a widget to resolve —
    never a stale guess)."""
    _fake_desk(monkeypatch, ISSUES)
    got = prebuilt.alias_map()
    assert got == {"sunday scans — august 16, 2026": {
        "alias": prebuilt.SUNDAY_SCANS_LATEST_ALIAS, "label": "Sunday Scans — Latest issue"}}
    _fake_desk(monkeypatch, ISSUES[1:])           # Aug 16 gone → the alias moves to Aug 9
    assert list(prebuilt.alias_map()) == ["sunday scans — august 9, 2026"]
    _fake_desk(monkeypatch, None)
    assert prebuilt.alias_map() == {}


# ── the seeder ───────────────────────────────────────────────────────────────

def _wire(prebuilt, monkeypatch, rows, *, admin="admin"):
    deleted, created = [], []
    monkeypatch.setattr(prebuilt.wl, "list_prebuilt_watchlists", lambda n=500: rows)
    monkeypatch.setattr(prebuilt.wl, "delete_watchlist",
                        lambda uid, wid: deleted.append(wid) or True)
    monkeypatch.setattr(prebuilt, "_admin_user_id", lambda: admin)
    monkeypatch.setattr(prebuilt, "_create_list",
                        lambda admin, name, desc, tickers: created.append((name, tickers)) or True)
    return deleted, created


def _family(created):
    return [c for c in created if c[0].lower().startswith("sunday scans")]


def test_seeder_never_deletes_the_family_when_source_is_down(prebuilt, monkeypatch):
    """The hazard this feature must survive: desk store unreadable at boot →
    no Sunday Scans specs in the config → the delete step must SKIP every
    family list (dated AND legacy). The unprotected stale row in the same run
    is the non-vacuity control — the delete step is provably alive."""
    _fake_desk(monkeypatch, None)
    existing = [
        {"id": "wl-ss", "user_id": "admin", "name": "Sunday Scans", "items": []},
        {"id": "wl-a9", "user_id": "admin", "name": "Sunday Scans — August 9, 2026", "items": []},
        {"id": "wl-old", "user_id": "admin", "name": "Delisted Legends", "items": []},
    ]
    deleted, created = _wire(prebuilt, monkeypatch, existing, admin=None)
    prebuilt.seed_prebuilt_watchlists()
    assert "wl-old" in deleted                     # control: the delete step ran
    assert "wl-ss" not in deleted and "wl-a9" not in deleted
    assert _family(created) == []


def test_seeder_prunes_outside_the_window_and_retires_the_legacy_undated_list(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, ISSUES)                # Aug 16, Aug 9, Aug 2 readable
    monkeypatch.setattr(prebuilt, "SUNDAY_SCANS_KEEP", 2)   # window = Aug 16, Aug 9
    existing = [
        {"id": "wl-ss", "user_id": "admin", "name": "Sunday Scans", "items": [{"sym": "INTC"}]},
        {"id": "wl-a2", "user_id": "admin", "name": "Sunday Scans — August 2, 2026",
         "items": [{"sym": "KO"}]},
        {"id": "wl-a16", "user_id": "admin", "name": "Sunday Scans — August 16, 2026",
         "items": [{"sym": "ARM"}, {"sym": "MU"}, {"sym": "INTC"}]},
    ]
    deleted, created = _wire(prebuilt, monkeypatch, existing)
    prebuilt.seed_prebuilt_watchlists()
    assert "wl-ss" in deleted                      # legacy undated → retired
    assert "wl-a2" in deleted                      # older than the window → retired
    assert "wl-a16" not in deleted                 # current and correct → kept
    assert _family(created) == [("Sunday Scans — August 9, 2026", ["NBIS", "SNDK"])]


# ── sync_sunday_scans (the hourly path) ──────────────────────────────────────

def test_sync_unavailable_source_touches_nothing(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, None)
    existing = [{"id": "wl-a9", "user_id": "admin", "name": "Sunday Scans — August 9, 2026",
                 "items": []}]
    deleted, created = _wire(prebuilt, monkeypatch, existing)
    got = prebuilt.sync_sunday_scans()
    assert got["status"] == "unavailable"
    assert deleted == [] and created == []


def test_sync_keeps_current_lists(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, ISSUES[:2])
    rows = [
        {"id": "wl-a16", "user_id": "admin", "name": "Sunday Scans — August 16, 2026",
         "items": [{"sym": "MU"}, {"sym": "INTC"}, {"sym": "ARM"}]},
        {"id": "wl-a9", "user_id": "admin", "name": "Sunday Scans — August 9, 2026",
         "items": [{"sym": "SNDK"}, {"sym": "NBIS"}]},
    ]
    deleted, created = _wire(prebuilt, monkeypatch, rows)
    got = prebuilt.sync_sunday_scans()
    assert got["status"] == "current" and got["lists"] == 2
    assert deleted == [] and created == []


def test_sync_creates_the_new_issue_and_prunes_the_oldest(prebuilt, monkeypatch):
    """A new issue landed: its dated list is created, the one that fell out of
    the window is retired, the ones still in the window are untouched."""
    _fake_desk(monkeypatch, ISSUES)                # Aug 16 (new), Aug 9, Aug 2
    monkeypatch.setattr(prebuilt, "SUNDAY_SCANS_KEEP", 2)
    rows = [
        {"id": "wl-a9", "user_id": "admin", "name": "Sunday Scans — August 9, 2026",
         "items": [{"sym": "SNDK"}, {"sym": "NBIS"}]},
        {"id": "wl-jul26", "user_id": "admin", "name": "Sunday Scans — July 26, 2026",
         "items": [{"sym": "KO"}]},
    ]
    deleted, created = _wire(prebuilt, monkeypatch, rows)
    got = prebuilt.sync_sunday_scans()
    assert got["status"] == "rebuilt"
    assert got["rebuilt"] == 1 and got["pruned"] == 1 and got["lists"] == 2
    assert deleted == ["wl-jul26"]
    assert created == [("Sunday Scans — August 16, 2026", ["INTC", "MU", "ARM"])]


def test_sync_rebuilds_a_drifted_issue_list(prebuilt, monkeypatch):
    """An issue's roster was re-converted: the stored set no longer matches →
    that list is dropped and recreated with the fresh roster in author order."""
    _fake_desk(monkeypatch, ISSUES[:1])
    rows = [{"id": "wl-a16", "user_id": "admin", "name": "Sunday Scans — August 16, 2026",
             "items": [{"sym": "INTC"}, {"sym": "MU"}]}]
    deleted, created = _wire(prebuilt, monkeypatch, rows)
    got = prebuilt.sync_sunday_scans()
    assert deleted == ["wl-a16"]
    assert created == [("Sunday Scans — August 16, 2026", ["INTC", "MU", "ARM"])]
    assert got["status"] == "rebuilt" and got["rebuilt"] == 1


def test_sync_keeps_one_correct_duplicate_and_drops_the_other(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, ISSUES[:1])
    rows = [{"id": "wl-a16", "user_id": "admin", "name": "Sunday Scans — August 16, 2026",
             "items": [{"sym": "INTC"}, {"sym": "MU"}]},
            {"id": "wl-a16-dup", "user_id": "admin", "name": "Sunday Scans — August 16, 2026",
             "items": [{"sym": "INTC"}, {"sym": "MU"}, {"sym": "ARM"}]}]
    deleted, created = _wire(prebuilt, monkeypatch, rows)
    prebuilt.sync_sunday_scans()
    assert deleted == ["wl-a16"] and created == []


def test_sync_leaves_an_in_window_list_whose_issue_vanished(prebuilt, monkeypatch):
    """The store can only say which issues are NEWEST; a dated list inside the
    window that has no spec (post gone from the store) is left standing —
    failure direction = stale persists, same as the seeder's rail."""
    _fake_desk(monkeypatch, [ISSUES[0], ISSUES[2]])          # Aug 16 + Aug 2; Aug 9 gone
    monkeypatch.setattr(prebuilt, "SUNDAY_SCANS_KEEP", 2)
    rows = [
        {"id": "wl-a16", "user_id": "admin", "name": "Sunday Scans — August 16, 2026",
         "items": [{"sym": "INTC"}, {"sym": "MU"}, {"sym": "ARM"}]},
        {"id": "wl-a9", "user_id": "admin", "name": "Sunday Scans — August 9, 2026",
         "items": [{"sym": "NBIS"}]},
    ]
    deleted, created = _wire(prebuilt, monkeypatch, rows)
    prebuilt.sync_sunday_scans()
    assert "wl-a9" not in deleted
    assert created == [("Sunday Scans — August 2, 2026", ["KO"])]


def test_sync_does_not_prune_by_date_until_the_window_is_full(prebuilt, monkeypatch):
    """A thin store (fewer issues than the window) cannot define the window's
    edge — older dated lists stay; only the legacy undated list is retired."""
    _fake_desk(monkeypatch, ISSUES[:1])            # one issue known, KEEP = 12
    rows = [
        {"id": "wl-ss", "user_id": "admin", "name": "Sunday Scans", "items": []},
        {"id": "wl-jul26", "user_id": "admin", "name": "Sunday Scans — July 26, 2026",
         "items": [{"sym": "KO"}]},
    ]
    deleted, created = _wire(prebuilt, monkeypatch, rows)
    prebuilt.sync_sunday_scans()
    assert deleted == ["wl-ss"]
    assert created == [("Sunday Scans — August 16, 2026", ["INTC", "MU", "ARM"])]


def test_sync_without_admin_creates_nothing(prebuilt, monkeypatch):
    _fake_desk(monkeypatch, ISSUES[:1])
    deleted, created = _wire(prebuilt, monkeypatch, [], admin=None)
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
