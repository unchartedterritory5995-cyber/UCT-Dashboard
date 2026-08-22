"""Rails for the article-pipeline audit and the prev/next sequence.

Every stage of the article chain is fail-soft, so total failure looks exactly
like a quiet week. This is the thing that notices — which means it has to fail
LOUDLY when the pipeline is broken and stay SILENT when it isn't, or it gets
muted within a week and becomes the coverage it only pretends to be.
"""
from __future__ import annotations

import importlib
import json
import time

import pytest

WEEK = 7 * 86400


def _wl_rows(store, items):
    """One dated community list per Sunday Scans issue in the store, every list
    carrying `items` — the healthy shape. Names DERIVED, never restated."""
    from api.services import watchlist_prebuilt as wp
    return [{"id": f"wl-{p['id']}", "user_id": "admin", "name": wp.sunday_scans_list_name(p),
             "items": [{"sym": s} for s in items]}
            for p in store.sunday_scans_posts(wp.SUNDAY_SCANS_KEEP)]


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DESK_DB_PATH", str(tmp_path / "desk.db"))
    monkeypatch.delenv("DESK_ARTICLE_AUDIT_GRACE_SECS", raising=False)
    monkeypatch.delenv("DESK_ARTICLE_AUDIT_STALE_DAYS", raising=False)
    from api.services import desk_store as ds
    importlib.reload(ds)
    ds._init_db()
    return ds


@pytest.fixture()
def audit(store, monkeypatch):
    from api.services import desk_article_audit as a
    importlib.reload(a)
    # Every seeded post carries tickers ["MU"], so a healthy archive REQUIRES a
    # matching dated community watchlist PER ISSUE — the fixture supplies them,
    # derived from the store (names via the module that owns them). Tests that
    # probe the watchlist check override this with a mismatch / missing / raising read.
    from api.services import watchlist_service as wl
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda n=500: _wl_rows(store, ["MU"]))
    return a


NOW = 1787000000.0


def seed(store, pid, slug, *, published_at, body="<p>x</p>", index=True, version=None):
    from api.services import substack_article
    store.upsert_post({"id": pid, "title": "SUNDAY SCANS", "url": pid,
                       "published_at": int(published_at)})
    store.save_post_body(pid, {
        "body_html": body, "slug": slug, "display_title": f"Sunday Scans — {slug}",
        "tickers_json": json.dumps(["MU"]),
        "converter_version": substack_article.CONVERTER_VERSION if version is None else version,
    })
    if index and body:
        store.index_post_search(pid, title=slug, tickers=["MU"], body="market breadth")


# ── silence when healthy ─────────────────────────────────────────────────────

def test_a_healthy_archive_reports_no_problems(store, audit):
    for i in range(3):
        seed(store, f"u{i}", f"s{i}", published_at=NOW - i * WEEK)
    r = audit.audit_articles(now=NOW)
    assert r["problems"] == []
    assert r["checked"] == 3 and r["with_body"] == 3 and r["indexed"] == 3


def test_a_healthy_run_sends_no_alert(store, audit, monkeypatch):
    """⛔ An audit that fires on every healthy Sunday gets muted, and a muted
    audit reads as coverage while covering nothing."""
    seed(store, "u1", "s1", published_at=NOW)
    sent = []
    monkeypatch.setattr(audit, "_send_alert", lambda t: sent.append(t))
    audit.run_audit_and_alert(now=NOW)
    assert sent == []


# ── the check that catches "the whole thing died" ────────────────────────────

def test_a_stalled_poller_is_the_headline_problem(store, audit, monkeypatch):
    """Missing bodies self-heal. A poller that stopped does not — this is the
    one signal that distinguishes an outage from a lagging step."""
    seed(store, "u1", "s1", published_at=NOW - 30 * 86400)
    r = audit.audit_articles(now=NOW)
    assert any("no new post in 30 days" in p for p in r["problems"])
    assert r["days_since_newest_post"] == 30.0
    sent = []
    monkeypatch.setattr(audit, "_send_alert", lambda t: sent.append(t))
    audit.run_audit_and_alert(now=NOW)
    assert sent and "no new post in 30 days" in sent[0]


def test_a_normal_weekly_cadence_is_not_called_stale(store, audit):
    """The letter is weekly — 8 days between issues is a holiday, not an outage."""
    seed(store, "u1", "s1", published_at=NOW - 8 * 86400)
    assert not any("no new post" in p for p in audit.audit_articles(now=NOW)["problems"])


def test_an_empty_archive_is_reported_rather_than_read_as_healthy(store, audit):
    r = audit.audit_articles(now=NOW)
    assert r["checked"] == 0
    assert any("never stored one" in p for p in r["problems"])


# ── the grace window ─────────────────────────────────────────────────────────

def test_a_post_published_minutes_ago_is_not_flagged_for_having_no_body(store, audit):
    """RSS supplies the body within the hour; flagging instantly means an alert
    every single Sunday."""
    store.upsert_post({"id": "fresh", "title": "T", "url": "fresh",
                       "published_at": int(NOW - 600)})
    assert audit.audit_articles(now=NOW)["missing_bodies"] == []


def test_a_post_with_no_body_past_the_window_IS_flagged_by_name(store, audit):
    """⛔ Names, not counts — a count sends someone hunting."""
    store.upsert_post({"id": "old", "title": "SUNDAY SCANS", "url": "old",
                       "published_at": int(NOW - 5 * 86400)})
    store.save_post_body("old", {"display_title": "Sunday Scans — stuck", "slug": "stuck"})
    r = audit.audit_articles(now=NOW)
    assert r["missing_bodies"] == ["Sunday Scans — stuck"]
    assert "Sunday Scans — stuck" in audit.format_alert(r)


# ── search coverage ──────────────────────────────────────────────────────────

def test_an_article_absent_from_search_is_flagged(store, audit):
    seed(store, "u1", "s1", published_at=NOW, index=False)
    r = audit.audit_articles(now=NOW)
    assert r["missing_from_index"] == ["Sunday Scans — s1"]
    assert any("absent from search" in p for p in r["problems"])


def test_a_stalled_converter_bump_is_flagged(store, audit):
    seed(store, "u1", "s1", published_at=NOW, version=0)
    r = audit.audit_articles(now=NOW)
    assert r["stale_converter"] == 1
    assert any("older converter" in p for p in r["problems"])


# ── the community watchlist is a downstream artifact of the newest issue ─────



def test_a_stale_community_watchlist_is_flagged_with_the_symbol_diff(store, audit, monkeypatch):
    """The list still carrying LAST week's names under this week's letter is the
    quiet failure the hourly sync could produce — the audit names the diff."""
    from api.services import watchlist_service as wl
    seed(store, "u1", "s1", published_at=NOW - WEEK)
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda n=500: _wl_rows(store, ["KO"]))
    r = audit.audit_articles(now=NOW)
    stale = [p for p in r["problems"] if "STALE" in p]
    assert stale and "MU" in stale[0] and "KO" in stale[0]
    # Control (non-vacuity): the same archive with a MATCHING list is silent.
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda n=500: _wl_rows(store, ["MU"]))
    r2 = audit.audit_articles(now=NOW)
    assert not any("STALE" in p or "MISSING" in p for p in r2["problems"])
    assert r2["sunday_scans_watchlist"] == {"listed": 1, "expected": 1}


def test_a_missing_community_watchlist_is_flagged(store, audit, monkeypatch):
    from api.services import watchlist_service as wl
    seed(store, "u1", "s1", published_at=NOW - WEEK)
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda n=500: [])
    r = audit.audit_articles(now=NOW)
    assert any("MISSING" in p for p in r["problems"])


def test_a_missing_newest_list_is_reported_once_not_as_an_archive_gap_too(store, audit, monkeypatch):
    from api.services import watchlist_service as wl
    seed(store, "u1", "s1", published_at=NOW - WEEK)
    seed(store, "u2", "s2", published_at=NOW - 2 * WEEK)
    full = _wl_rows(store, ["MU"])
    monkeypatch.setattr(wl, "list_prebuilt_watchlists",
                        lambda n=500: [r for r in full if r["id"] != "wl-u1"])
    r = audit.audit_articles(now=NOW)
    assert sum("MISSING" in p for p in r["problems"]) == 1
    assert not any("archive" in p.lower() for p in r["problems"])


def test_a_missing_archive_issue_is_flagged_by_name(store, audit, monkeypatch):
    """The look-back is the product: an OLDER issue's dated list quietly gone
    (a failed create, a hand delete) is named. Control: the full archive is silent."""
    from api.services import watchlist_service as wl
    seed(store, "u1", "s1", published_at=NOW - WEEK)
    seed(store, "u2", "s2", published_at=NOW - 2 * WEEK)
    seed(store, "u3", "s3", published_at=NOW - 3 * WEEK)
    full = _wl_rows(store, ["MU"])
    gone = next(r for r in full if r["id"] == "wl-u2")
    monkeypatch.setattr(wl, "list_prebuilt_watchlists",
                        lambda n=500: [r for r in full if r is not gone])
    r = audit.audit_articles(now=NOW)
    hits = [p for p in r["problems"] if "archive" in p.lower()]
    assert hits and gone["name"] in hits[0]
    assert r["sunday_scans_archive"] == {"listed": 2, "expected": 3}
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda n=500: full)
    r2 = audit.audit_articles(now=NOW)
    assert not any("archive" in p.lower() for p in r2["problems"])
    assert r2["sunday_scans_archive"] == {"listed": 3, "expected": 3}


def test_a_fresh_issue_inside_the_grace_window_is_not_flagged(store, audit, monkeypatch):
    """The sync is hourly; an issue minutes old with a not-yet-updated list is
    NORMAL. Without the grace this fires every Sunday afternoon and gets muted."""
    from api.services import watchlist_service as wl
    seed(store, "u1", "s1", published_at=NOW)
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda n=500: _wl_rows(store, ["KO"]))
    r = audit.audit_articles(now=NOW)
    assert not any("STALE" in p or "MISSING" in p for p in r["problems"])


def test_an_unreadable_watchlist_store_is_the_finding(store, audit, monkeypatch):
    from api.services import watchlist_service as wl
    seed(store, "u1", "s1", published_at=NOW - WEEK)
    monkeypatch.setattr(wl, "list_prebuilt_watchlists",
                        lambda n=500: (_ for _ in ()).throw(RuntimeError("auth.db locked")))
    r = audit.audit_articles(now=NOW)
    assert any("could not read" in p for p in r["problems"])


# ── it must not take anything down ───────────────────────────────────────────

def test_a_broken_alert_channel_never_raises(store, audit, monkeypatch):
    """It shares a scheduler thread with everything else."""
    seed(store, "u1", "s1", published_at=NOW - 30 * 86400)
    monkeypatch.setattr(audit, "_send_alert",
                        lambda t: (_ for _ in ()).throw(RuntimeError("discord down")))
    assert audit.run_audit_and_alert(now=NOW)["problems"]


def test_a_broken_store_never_raises(audit, monkeypatch):
    monkeypatch.setattr(audit, "audit_articles",
                        lambda **k: (_ for _ in ()).throw(RuntimeError("db gone")))
    assert "error" in audit.run_audit_and_alert(now=NOW)


def test_it_can_be_switched_off(store, audit, monkeypatch):
    monkeypatch.setenv("DESK_ARTICLE_AUDIT_ENABLED", "0")
    assert audit.run_audit_and_alert(now=NOW) == {"skipped": "disabled"}


# ── the wiring: an audit nobody runs reads as coverage ───────────────────────

def test_the_audit_is_actually_REGISTERED_with_the_scheduler():
    """⛔ This pipeline's sibling sat 'written, documented as scheduled, wired
    into no scheduler' for weeks. Read the AST of main.py, not a comment."""
    import ast
    import pathlib
    src = pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py"
    tree = ast.parse(src.read_text(encoding="utf-8"))
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_job":
            for kw in node.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    assert "desk_article_audit" in ids, "the audit is not wired to any scheduler"
    # non-vacuity: the walk can see a sibling it is not looking for
    assert "substack_poll_hourly" in ids


def test_the_audit_route_is_mounted_on_the_served_app():
    from api.main import app
    paths = {r.path for r in app.routes}
    assert "/api/desk/articles/audit" in paths
    assert "/api/desk/articles/for-ticker/{sym}" in paths   # non-vacuity control


# ── prev / next ──────────────────────────────────────────────────────────────

def test_the_reader_can_walk_the_archive_in_both_directions(store):
    for i in range(3):
        seed(store, f"u{i}", f"s{i}", published_at=NOW - i * WEEK)
    mid = store.adjacent_posts("u1")
    assert mid["next"]["slug"] == "s0"       # newer
    assert mid["previous"]["slug"] == "s2"   # older


def test_the_ends_of_the_archive_have_one_neighbour(store):
    for i in range(2):
        seed(store, f"u{i}", f"s{i}", published_at=NOW - i * WEEK)
    assert store.adjacent_posts("u0")["next"] is None       # newest
    assert store.adjacent_posts("u1")["previous"] is None   # oldest


def test_an_unreadable_neighbour_is_skipped(store):
    """Stepping into an article with no body would land on a 409."""
    seed(store, "u0", "s0", published_at=NOW)
    store.upsert_post({"id": "u1", "title": "T", "url": "u1", "published_at": int(NOW - WEEK)})
    seed(store, "u2", "s2", published_at=NOW - 2 * WEEK)
    assert store.adjacent_posts("u0")["previous"]["slug"] == "s2"


def test_two_issues_on_one_date_still_order_deterministically(store):
    """A tie must not leak the store's row order."""
    seed(store, "a", "sa", published_at=NOW)
    seed(store, "b", "sb", published_at=NOW)
    assert store.adjacent_posts("b")["previous"]["slug"] == "sa"
    assert store.adjacent_posts("a")["next"]["slug"] == "sb"


def test_an_unknown_post_has_no_neighbours(store):
    assert store.adjacent_posts("nope") == {"previous": None, "next": None}
