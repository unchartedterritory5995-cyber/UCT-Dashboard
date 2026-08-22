"""Rails for the native Desk article reader (storage + body pipeline + gate).

Three things here are load-bearing and each failed silently in an earlier design:
  1. the card-grid payload must not carry article bodies,
  2. a paywalled post must be REFUSED rather than stored truncated,
  3. the access gate must fail CLOSED on a bad env value.
"""
from __future__ import annotations

import gzip
import importlib
import json
import os

import pytest
from fastapi import HTTPException

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures",
                       "substack_sunday_scans_2026-08-16.html.gz")
URL = "https://unchartedterritoryy.substack.com/p/sunday-scans-da5"
# Sun, 16 Aug 2026 17:52:54 GMT — the post's real publish time.
PUBLISHED_AT = 1786902774


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """A real SQLite store on a throwaway path (never the shared /data root)."""
    monkeypatch.setenv("DESK_DB_PATH", str(tmp_path / "desk.db"))
    from api.services import desk_store as ds
    importlib.reload(ds)
    ds._init_db()
    return ds


@pytest.fixture()
def bodies(store):
    from api.services import substack_bodies as sb
    importlib.reload(sb)
    return sb


@pytest.fixture()
def raw() -> str:
    with gzip.open(FIXTURE, "rt", encoding="utf-8") as fh:
        return fh.read()


@pytest.fixture()
def seeded(store, bodies, raw):
    pub = store.create_publication("Uncharted Territory",
                                   "https://unchartedterritoryy.substack.com/feed")
    post = {"id": URL, "publication_id": pub["id"], "title": "SUNDAY SCANS",
            "excerpt": "seed", "url": URL, "hero_image": None,
            "author": "Uncharted Territory", "published_at": PUBLISHED_AT}
    store.upsert_post(post)
    bodies.store_body(post, raw, slug="sunday-scans-da5")
    return post


# ── the card grid must stay small ─────────────────────────────────────────────

def test_the_article_list_never_carries_article_bodies(store, seeded):
    """`SELECT p.*` here would put ~200 KB per row into a payload that renders
    CARDS. Across an 84-post archive that is ~20 MB on every Desk page load."""
    rows = store.list_posts(limit=50)
    assert rows, "fixture did not seed — the rest of this test is vacuous"
    for key in ("body_html", "body_raw", "sections_json"):
        assert key not in rows[0], f"{key} leaked into the card-grid payload"
    assert len(json.dumps(rows)) < 20_000


def test_the_list_still_reports_whether_a_body_exists(store, seeded):
    """The card needs to know whether to link inward or out to Substack, without
    being handed the body to find out."""
    assert store.list_posts(limit=50)[0]["has_body"] == 1


def test_a_post_with_no_body_reports_has_body_false(store):
    store.upsert_post({"id": "u2", "title": "T", "url": "u2", "published_at": 1})
    assert store.list_posts(limit=50)[0]["has_body"] == 0


# ── conversion + derived fields land ──────────────────────────────────────────

def test_the_stored_article_matches_the_source_post(store, seeded):
    row = store.get_post_by_slug("sunday-scans-da5")
    assert row["display_title"] == "Sunday Scans — August 16, 2026"
    assert row["image_count"] == 62
    assert row["word_count"] > 3_000
    assert row["reading_minutes"] == 18
    # 34 from the "Charts Covered" heading + 10 reached only by a chart label
    # (the ETF walk, and names charted without making that list).
    tickers = json.loads(row["tickers_json"])
    assert len(tickers) == 44
    assert tickers[:3] == ["INTC", "ALAB", "ARM"] and "QQQ" in tickers
    assert any(s["text"] == "WHAT WE WILL COVER TODAY"
               for s in json.loads(row["sections_json"]))


def test_the_raw_body_is_kept_so_a_reconvert_needs_no_network(store, bodies, seeded):
    assert store.get_post_raw(URL)
    row_before = store.get_post_by_slug("sunday-scans-da5")
    assert bodies.reconvert_stored(row_before) is True


def test_a_converter_bump_marks_every_article_for_reconversion(store, seeded):
    from api.services import substack_article
    assert store.posts_needing_body(substack_article.CONVERTER_VERSION) == []
    stale = store.posts_needing_body(substack_article.CONVERTER_VERSION + 1)
    assert [p["id"] for p in stale] == [URL]
    assert stale[0]["has_raw"] == 1, "a reconvert would re-fetch instead of using local raw"


# ── the paywall gate: refuse, never truncate ──────────────────────────────────

def test_a_paywalled_post_is_refused_not_stored_truncated(bodies):
    """Substack returns a TRUNCATED body for a paid post, not an error. Storing
    it renders a partial article with nothing marking it partial — worse than
    the link-out card it replaced."""
    payload = {"audience": "only_paid", "slug": "x",
               "body_html": "<p>The first two paragraphs, then silence.</p>"}
    assert bodies._accept_payload(payload, "x") is None


def test_a_free_post_is_accepted(bodies):
    got = bodies._accept_payload(
        {"audience": "everyone", "slug": "x", "body_html": "<p>full</p>",
         "truncated_body_text": "full"}, "x")
    assert got and got["raw"] == "<p>full</p>"


@pytest.mark.parametrize("audience", ["founding", "only_paid", "paid"])
def test_every_non_public_audience_is_refused(bodies, audience):
    assert bodies._accept_payload(
        {"audience": audience, "slug": "x", "body_html": "<p>x</p>"}, "x") is None


def test_an_empty_body_is_refused(bodies):
    assert bodies._accept_payload(
        {"audience": "everyone", "slug": "x", "body_html": "   "}, "x") is None


# ── display titles ────────────────────────────────────────────────────────────

def test_identical_titles_are_disambiguated_by_date(bodies):
    """Every Sunday Scans post ships under the same all-caps title, so the card
    grid is otherwise 61 rows reading 'SUNDAY SCANS'."""
    assert bodies.display_title_for("SUNDAY SCANS", PUBLISHED_AT) == \
        "Sunday Scans — August 16, 2026"


def test_a_mixed_case_title_keeps_its_own_casing(bodies):
    assert bodies.display_title_for("The Rest of the Week", PUBLISHED_AT).startswith(
        "The Rest of the Week — ")


def test_a_title_that_already_carries_its_year_is_not_stamped_twice(bodies):
    assert bodies.display_title_for("SUNDAY SCANS 2026 RECAP", PUBLISHED_AT) == \
        "Sunday Scans 2026 Recap"


def test_a_missing_publish_date_does_not_produce_a_dangling_dash(bodies):
    assert bodies.display_title_for("SUNDAY SCANS", 0) == "Sunday Scans"


# ── edits to an already-stored post ───────────────────────────────────────────

def test_an_edited_post_is_reconverted_and_an_unchanged_one_is_not(store, bodies, seeded, raw):
    """A one-shot backfill would serve pre-edit text forever."""
    unchanged = bodies.refresh_recent_bodies(
        [{"id": URL, "title": "SUNDAY SCANS", "url": URL,
          "published_at": PUBLISHED_AT, "body_raw": raw}])
    assert unchanged == {"checked": 1, "stored": 0, "unchanged": 1}

    edited = bodies.refresh_recent_bodies(
        [{"id": URL, "title": "SUNDAY SCANS", "url": URL,
          "published_at": PUBLISHED_AT, "body_raw": raw + "<p>A late correction.</p>"}])
    assert edited["stored"] == 1
    assert "A late correction." in store.get_post_by_slug("sunday-scans-da5")["body_html"]


def test_a_body_for_an_unknown_post_is_not_stored_as_a_half_row(store, bodies, raw):
    """The poller owns the roster; a body without one would make a row the card
    grid cannot render."""
    out = bodies.refresh_recent_bodies(
        [{"id": "never-seen", "title": "X", "url": "u", "published_at": 1, "body_raw": raw}])
    assert out["stored"] == 0
    assert store.list_posts(limit=10) == []


# ── the self-healing backfill slice ───────────────────────────────────────────

def _seed_bodyless(store, n: int, *, with_raw: bool = False, raw: str = "") -> None:
    for i in range(n):
        url = f"https://unchartedterritoryy.substack.com/p/old-{i}"
        store.upsert_post({"id": url, "title": "SUNDAY SCANS", "url": url,
                           "published_at": 1_700_000_000 + i})
        if with_raw:
            store.save_post_body(url, {"body_raw": raw, "converter_version": 0})


def test_the_backfill_walks_a_bounded_slice_per_pass(store, bodies, monkeypatch):
    """One request per old post, so an 84-post catalogue must not go out as a
    burst. A bounded slice per hourly poll fills it in ~9 hours."""
    _seed_bodyless(store, 20)
    calls = []
    monkeypatch.setattr(bodies, "fetch_body",
                        lambda url: calls.append(url) or {"raw": "<p>x</p>", "slug": "s"})
    out = bodies.backfill_bodies(limit=400, max_fetches=8, pace=0)
    assert out["fetched"] == 8 and len(calls) == 8
    assert out["deferred"] == 12, "the remainder must be reported, not silently dropped"


def test_successive_passes_resume_rather_than_restart(store, bodies, monkeypatch):
    seen = []
    monkeypatch.setattr(bodies, "fetch_body",
                        lambda url: seen.append(url) or {"raw": "<p>x</p>", "slug": "s"})
    _seed_bodyless(store, 20)
    for _ in range(3):
        bodies.backfill_bodies(limit=400, max_fetches=8, pace=0)
    assert len(seen) == 20, "a resumed walk re-fetched posts it already had"
    assert len(set(seen)) == 20
    assert bodies.backfill_bodies(limit=400, max_fetches=8, pace=0)["fetched"] == 0


def test_a_converter_bump_is_NOT_throttled_by_the_network_bound(store, bodies, monkeypatch, raw):
    """Re-converts are local and free. Throttling them the way a cold archive
    walk is throttled would make a CONVERTER_VERSION bump take days to apply."""
    _seed_bodyless(store, 20, with_raw=True, raw=raw)
    monkeypatch.setattr(bodies, "fetch_body",
                        lambda url: pytest.fail("re-convert must not hit the network"))
    out = bodies.backfill_bodies(limit=400, max_fetches=2, pace=0)
    assert out["reconverted"] == 20 and out["fetched"] == 0 and out["deferred"] == 0


def test_the_poll_never_fails_because_a_body_did(store, monkeypatch):
    """The roster is the poller's job; bodies are a bonus. A broken backfill
    must not cost us the article list."""
    from api.services import substack_poller
    monkeypatch.setenv("DESK_ARTICLE_BACKFILL_PER_POLL", "4")
    monkeypatch.setattr(substack_poller.desk_store, "list_publications", lambda **k: [])
    import api.services.substack_bodies as sb
    monkeypatch.setattr(sb, "backfill_bodies",
                        lambda **k: (_ for _ in ()).throw(RuntimeError("substack down")))
    assert substack_poller.poll_all() == []


def test_the_walk_can_be_switched_off_with_an_env_var(store, monkeypatch):
    from api.services import substack_poller
    monkeypatch.setenv("DESK_ARTICLE_BACKFILL_PER_POLL", "0")
    import api.services.substack_bodies as sb
    monkeypatch.setattr(sb, "backfill_bodies",
                        lambda **k: pytest.fail("walk ran while switched off"))
    substack_poller._backfill_slice()


# ── the access gate ───────────────────────────────────────────────────────────

@pytest.fixture()
def desk_router():
    from api.routers import desk
    return desk


PAID_USER = {"id": 1, "email": "p@x.test", "role": "user", "plan": "premium"}
FREE_USER = {"id": 2, "email": "f@x.test", "role": "user", "plan": "free"}


@pytest.mark.parametrize("value,expected", [
    (None, "paid"), ("", "paid"), ("paid", "paid"), ("free", "free"),
    ("public", "public"), ("PUBLIC", "public"), ("  free  ", "free"),
    ("open", "paid"), ("yes", "paid"), ("1", "paid"),
])
def test_the_access_mode_fails_closed_on_anything_it_does_not_recognise(
        desk_router, monkeypatch, value, expected):
    """⛔ An unset or fat-fingered value must resolve to the RESTRICTIVE end.
    A gate that opens on a typo is not a gate."""
    monkeypatch.delenv("DESK_ARTICLES_ACCESS", raising=False)
    if value is not None:
        monkeypatch.setenv("DESK_ARTICLES_ACCESS", value)
    assert desk_router.article_access_mode() == expected


def test_default_access_is_exactly_todays_behaviour(desk_router, monkeypatch):
    """Shipping this must not change who can read Articles."""
    monkeypatch.delenv("DESK_ARTICLES_ACCESS", raising=False)
    monkeypatch.setattr(desk_router, "get_user_plan", lambda _uid: "free")
    with pytest.raises(HTTPException) as exc:
        desk_router.require_article_reader(dict(FREE_USER))
    assert exc.value.status_code == 402

    monkeypatch.setattr(desk_router, "get_user_plan", lambda _uid: "premium")
    assert desk_router.require_article_reader(dict(PAID_USER))["id"] == 1


def test_an_anonymous_reader_is_refused_unless_access_is_public(desk_router, monkeypatch):
    for mode in ("paid", "free"):
        monkeypatch.setenv("DESK_ARTICLES_ACCESS", mode)
        with pytest.raises(HTTPException) as exc:
            desk_router.require_article_reader(None)
        assert exc.value.status_code == 401, mode

    monkeypatch.setenv("DESK_ARTICLES_ACCESS", "public")
    assert desk_router.require_article_reader(None) == {}


def test_free_mode_admits_a_signed_in_free_member(desk_router, monkeypatch):
    monkeypatch.setenv("DESK_ARTICLES_ACCESS", "free")
    assert desk_router.require_article_reader(dict(FREE_USER))["id"] == 2


def test_the_gate_is_not_built_on_a_dependency_that_pre_empts_it(desk_router):
    """`get_current_user_with_plan` raises 401 before the gate body runs, so a
    gate built on it can never serve `public` — the env var would be a control
    that silently does nothing."""
    import inspect
    sig = inspect.signature(desk_router.require_article_reader)
    dep = sig.parameters["user"].default.dependency
    assert dep.__name__ == "get_current_user_optional"
