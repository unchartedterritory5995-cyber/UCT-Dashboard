"""Phase 4 rails: archive full-text search + article↔video pairing.

Both features answer a question the reader can already ask out loud — "what did
he say about MU in May?" and "where's the session that goes with this letter?" —
so both fail in the same quiet way: by returning nothing and looking like there
was nothing to find.
"""
from __future__ import annotations

import gzip
import importlib
import json
import os

import pytest

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures",
                       "substack_sunday_scans_2026-08-16.html.gz")
URL = "https://unchartedterritoryy.substack.com/p/sunday-scans-da5"
PUBLISHED_AT = 1786902774  # Sun 16 Aug 2026 17:52:54 GMT -> Aug 16 in ET


@pytest.fixture()
def store(tmp_path, monkeypatch):
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
    post = {"id": URL, "publication_id": None, "title": "SUNDAY SCANS",
            "excerpt": "", "url": URL, "hero_image": None,
            "author": "Uncharted Territory", "published_at": PUBLISHED_AT}
    store.upsert_post(post)
    bodies.store_body(post, raw, slug="sunday-scans-da5")
    return post


# ── the index exists and is populated by the SAME call that stores the body ───

def test_fts_is_available_on_this_build(store):
    """Everything below is vacuous without it."""
    assert store.fts_available() is True


def test_storing_a_body_indexes_it(store, seeded):
    assert store.count_indexed_posts() == 1


def test_search_finds_a_phrase_from_deep_in_the_article(store, seeded):
    hits = store.search_posts("weekend prep easier")
    assert len(hits) == 1
    assert hits[0]["id"] == URL
    assert "<mark>" in hits[0]["snippet"], "no highlighted snippet to show"


def test_search_finds_an_article_by_ticker(store, seeded):
    """The trader's actual question: which issues covered this name?"""
    assert [h["id"] for h in store.search_posts("MRVL")] == [URL]


def test_search_misses_what_is_not_there(store, seeded):
    assert store.search_posts("cryptocurrency arbitrage seminar") == []


def test_a_search_result_links_INTO_the_reader_not_out_to_substack(store, seeded):
    """`has_body` decides whether a card opens our reader or Substack. It is
    computed in list_posts; a search result missing it renders "on Substack ↗"
    for an article we hold in full — and only the indexed ones can match at all."""
    hit = store.search_posts("breadth")[0]
    assert hit["has_body"] == 1
    assert hit["slug"], "no slug means the card cannot build an in-app link"


def test_a_search_result_carries_the_same_shape_as_a_list_row(store, seeded):
    """The two feed the SAME card component; a key present in one and absent in
    the other is a card that renders differently depending on how you got to it."""
    listed, found = store.list_posts(limit=1)[0], store.search_posts("breadth")[0]
    assert set(listed) - set(found) == set(), "search rows are missing list keys"


def test_search_results_never_carry_article_bodies(store, seeded):
    """Same trap as the card grid: a result list must not ship ~200 KB a row."""
    hit = store.search_posts("breadth")[0]
    for key in ("body_html", "body_raw"):
        assert key not in hit
    assert len(json.dumps(store.search_posts("breadth"))) < 20_000


def test_reindexing_is_idempotent(store, bodies, seeded):
    before = store.count_indexed_posts()
    bodies.store_body(seeded, gzip.open(FIXTURE, "rt", encoding="utf-8").read(),
                      slug="sunday-scans-da5")
    assert store.count_indexed_posts() == before, "re-storing duplicated the index row"


def test_an_article_with_a_body_but_no_index_row_is_found_and_healed(store, bodies, seeded, raw):
    """The index is younger than the archive, so every article stored before
    search existed is in exactly this state. A search covering half the archive
    is worse than none: "nothing found" reads as "he never wrote about it"."""
    store.index_post_search  # noqa: B018 — presence check before we rely on it
    with __import__("contextlib").closing(store._connect()) as c:
        c.execute("DELETE FROM substack_posts_fts")
        c.commit()
    assert store.count_indexed_posts() == 0
    assert [p["id"] for p in store.posts_missing_from_index()] == [URL]

    out = bodies.index_missing()
    assert out == {"pending": 1, "indexed": 1, "skipped": 0}
    assert store.count_indexed_posts() == 1
    assert store.search_posts("breadth")


def test_healing_the_index_is_a_no_op_once_it_is_complete(store, bodies, seeded):
    assert store.posts_missing_from_index() == []
    assert bodies.index_missing() == {"pending": 0, "indexed": 0, "skipped": 0}


def test_a_post_with_no_body_is_never_reported_as_missing_from_the_index(store, bodies, seeded):
    """Otherwise the healer would chase link-out and paywalled posts forever."""
    store.upsert_post({"id": "u-nobody", "title": "T", "url": "u", "published_at": 1})
    assert "u-nobody" not in [p["id"] for p in store.posts_missing_from_index()]


def test_the_poll_heals_the_index_without_the_network_budget(store, monkeypatch):
    """Re-converts are local; bounding them by the FETCH budget would leave the
    index behind for days after a backfill."""
    from api.services import substack_poller
    import api.services.substack_bodies as sb
    monkeypatch.setenv("DESK_ARTICLE_BACKFILL_PER_POLL", "1")
    calls = {}
    monkeypatch.setattr(sb, "backfill_bodies", lambda **k: {"fetched": 0, "reconverted": 0,
                                                           "deferred": 0, "refused": 0})
    monkeypatch.setattr(sb, "index_missing",
                        lambda **k: calls.setdefault("kw", k) or {"indexed": 3, "pending": 3})
    substack_poller._backfill_slice()
    assert "kw" in calls, "the poll never healed the index"
    assert calls["kw"].get("max_fetches") is None


def test_reindex_all_rebuilds_from_disk_without_network(store, bodies, seeded, monkeypatch):
    """The index is younger than the archive — articles stored before search
    existed have a body and no index row."""
    monkeypatch.setattr(bodies, "fetch_body",
                        lambda url: pytest.fail("reindex must not hit the network"))
    out = bodies.reindex_all()
    assert out["indexed"] == 1 and out["total_in_index"] == 1


# ── user input must not be able to break the query ────────────────────────────

@pytest.mark.parametrize("q", [
    'MU AND', 'OR', '"', 'NEAR(', 'body:*', '*', '^', 'a"b', ')(', 'MU OR NOT',
])
def test_a_member_typing_fts_operators_gets_a_result_not_a_500(store, seeded, q):
    """FTS5 MATCH raises on a malformed expression. Every term is quoted, so
    operators typed by a member are searched for literally."""
    assert isinstance(store.search_posts(q), list)


def test_quoting_still_lets_an_ordinary_search_work(store, seeded):
    assert store.search_posts("market breadth")


def test_every_term_is_quoted_so_operators_are_searched_LITERALLY(store):
    """⛔ The "doesn't 500" test above CANNOT see this: `search_posts` swallows
    OperationalError and returns [], so an unquoted query that RAISES is
    indistinguishable from a quoted one that found nothing. Assert the
    expression itself, and the outcome below."""
    assert store._fts_query("MU AND") == '"MU" "AND"'
    assert store._fts_query('a"b') == '"a""b"'
    assert store._fts_query("  MU   NEAR( ") == '"MU" "NEAR("'


def test_an_operator_word_in_a_real_query_still_RETURNS_the_article(store, seeded):
    """The behavioural half. Unquoted, `breadth AND` is a dangling operator: FTS
    raises, the except swallows it, and the member sees "no results" for an
    article that plainly matches. Quoted, both words are searched as words."""
    assert [h["id"] for h in store.search_posts("breadth AND")] == [URL]
    assert [h["id"] for h in store.search_posts("market OR")] == [URL]


# ── the snippet lands in dangerouslySetInnerHTML ──────────────────────────────

def test_a_snippet_cannot_inject_markup(store, bodies):
    """The INDEX holds plain text in which `<` is a literal character — the
    converter decodes `&lt;` on the way in. So asking SQLite for '<mark>'
    delimiters directly would ship author text unescaped into the DOM.

    This payload is written the way a real post carries it: HTML-ENCODED in the
    source, decoded by the converter, literal by the time it is indexed.
    """
    url = "https://unchartedterritoryy.substack.com/p/nasty"
    store.upsert_post({"id": url, "title": "SUNDAY SCANS", "url": url,
                       "published_at": PUBLISHED_AT})
    bodies.store_body(
        {"id": url, "title": "SUNDAY SCANS", "url": url, "published_at": PUBLISHED_AT},
        "<p>Watch the &lt;script&gt;alert(1)&lt;/script&gt; xyzzy setup carefully.</p>",
        slug="nasty",
    )
    hit = store.search_posts("xyzzy")
    assert hit, "fixture did not index — this test would pass vacuously"
    snippet = hit[0]["snippet"]
    assert "<script>" not in snippet
    assert "&lt;script&gt;" in snippet, "the payload is not even present — wrong probe"
    # the ONE tag we do emit still works
    assert "<mark>xyzzy</mark>" in snippet or "<mark>" in snippet


def test_the_highlight_is_still_produced(store, seeded):
    assert "<mark>" in store.search_posts("breadth")[0]["snippet"]


def test_an_empty_query_returns_nothing_rather_than_everything(store, seeded):
    for q in ("", "   ", None):
        assert store.search_posts(q) == []


# ── search degrades instead of taking the Desk down ───────────────────────────

def test_without_fts_the_store_still_works_and_search_is_simply_off(store, seeded, monkeypatch):
    """An unguarded CREATE VIRTUAL TABLE would break articles AND team on a
    build lacking FTS5. Search is the only thing allowed to go."""
    monkeypatch.setattr(store, "_FTS_READY", False)
    assert store.fts_available() is False
    assert store.search_posts("breadth") == []
    assert store.count_indexed_posts() == 0
    assert len(store.list_posts(limit=10)) == 1          # the hub still serves
    store.index_post_search("x", title="t", tickers=[], body="b")  # no-ops, no raise


# ── article ↔ video pairing ───────────────────────────────────────────────────

from api.services import desk_article_links as links  # noqa: E402

VIDEOS = [
    {"id": 1, "youtube_id": "aaa", "title": "Sunday Scans — August 16, 2026",
     "category": "Sunday Scans"},
    {"id": 2, "youtube_id": "bbb", "title": "Sunday Scans — August 9, 2026",
     "category": "Sunday Scans"},
    {"id": 3, "youtube_id": "ccc", "title": "Live Trading Session — August 16, 2026",
     "category": "Live Trading Sessions"},
    {"id": 4, "youtube_id": "ddd", "title": "Evening Update — August 16, 2026",
     "category": "Evening Update"},
]


def test_the_letter_pairs_with_that_days_session():
    got = links.pick_related_video("Sunday Scans — August 16, 2026", PUBLISHED_AT, VIDEOS)
    assert got and got["youtube_id"] == "aaa" and got["day_gap"] == 0


def test_it_will_not_pair_a_letter_with_a_DIFFERENT_SHOW_on_the_same_day():
    """The Live Trading Session and the Evening Update are also dated Aug 16.
    Matching on date alone gives a confident WRONG answer, which is worse than
    no answer."""
    only_other_shows = [v for v in VIDEOS if not v["title"].startswith("Sunday Scans")]
    assert links.pick_related_video(
        "Sunday Scans — August 16, 2026", PUBLISHED_AT, only_other_shows) is None


def test_it_will_not_reach_into_an_adjacent_week():
    """Aug 9's session is 7 days away — a neighbouring issue, not this one."""
    week_before_only = [v for v in VIDEOS if v["youtube_id"] == "bbb"]
    assert links.pick_related_video(
        "Sunday Scans — August 16, 2026", PUBLISHED_AT, week_before_only) is None


def test_a_session_published_just_after_midnight_still_pairs():
    late = [{"id": 9, "youtube_id": "zzz", "title": "Sunday Scans — August 17, 2026",
             "category": "Sunday Scans"}]
    got = links.pick_related_video("Sunday Scans — August 16, 2026", PUBLISHED_AT, late)
    assert got and got["day_gap"] == 1


def test_the_nearest_session_wins_when_two_are_in_range():
    two = [{"id": 8, "youtube_id": "far", "title": "Sunday Scans — August 18, 2026"},
           {"id": 9, "youtube_id": "near", "title": "Sunday Scans — August 16, 2026"}]
    assert links.pick_related_video(
        "Sunday Scans — August 16, 2026", PUBLISHED_AT, two)["youtube_id"] == "near"


@pytest.mark.parametrize("videos", [[], None])
def test_no_videos_means_no_pairing_not_a_crash(videos):
    assert links.pick_related_video("Sunday Scans — August 16, 2026", PUBLISHED_AT, videos) is None


def test_an_undated_video_title_is_ignored():
    assert links.pick_related_video(
        "Sunday Scans — August 16, 2026", PUBLISHED_AT,
        [{"id": 1, "youtube_id": "x", "title": "Sunday Scans"}]) is None


def test_a_missing_publish_date_pairs_with_nothing():
    assert links.pick_related_video("Sunday Scans — August 16, 2026", 0, VIDEOS) is None


# ── the date format is a CONTRACT with the video pipeline ─────────────────────

def test_the_video_title_format_this_parser_assumes_is_the_one_desk_daily_session_writes():
    """⛔ If `_session_date_text` is ever reformatted, pairing turns off silently
    with no other symptom. Read the format off the PRODUCER, not off a literal."""
    from api.services import desk_daily_session
    produced = desk_daily_session._session_date_text("2026-08-16T21:52:54Z")
    assert links.parse_session_date(f"Sunday Scans — {produced}") is not None


def test_the_article_stamp_and_the_video_stamp_agree_for_one_instant():
    """Both sides render "{Month} {D}, {YYYY}" in ET. If they ever disagree, a
    letter and its own session would carry different dates."""
    from api.services import desk_daily_session, substack_bodies
    video_text = desk_daily_session._session_date_text("2026-08-16T21:52:54Z")
    article_title = substack_bodies.display_title_for("SUNDAY SCANS", PUBLISHED_AT)
    assert article_title.endswith(video_text)


def test_related_video_for_never_raises_when_the_video_store_is_unreadable(monkeypatch):
    import api.services.education_service as es
    monkeypatch.setattr(es, "list_videos",
                        lambda: (_ for _ in ()).throw(RuntimeError("db gone")))
    assert links.related_video_for("Sunday Scans — August 16, 2026", PUBLISHED_AT) is None
