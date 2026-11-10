"""Import a tweet, Task 5 -- removing saved posts that left X (`tweet_capture_sync`).

What each section proves:
  * THE TWO-MISS RULE: one miss removes nothing; a second miss at least 10 minutes later removes the
    post's words and copied images and keeps the card (author, link, time, price, My take).
  * THE GLITCH GUARDS: a bulk miss removes nothing and alerts the owner; a vendor error changes
    nothing; a post that resolves again loses its mark; the job never raises.
  * SEARCH: the post's words leave both FTS mirrors; the member's take stays searchable.
  * ONE IMAGE, MANY CARDS: a content-addressed file outlives every card but its last.
  * WHOLE POSTS: a failure mid-post leaves the post untouched; a failed file delete does not undo a
    removal.
Fixtures use invented handles and ids.
"""
from __future__ import annotations

import importlib
import io
import json
import os
import re
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from api.services import tweet_store, twitterapi_io

UID = "user-sync-a"
OTHER = "user-sync-b"
NOW = int(time.time())
IMG = "https://pbs.twimg.com/media/FakeSyncImg.jpg"
RAW = json.dumps({"extendedEntities": {"media": [{"media_url_https": IMG}]}})
WORDS = "zebrawords breakout on fakeco"
TAKE = "giraffetake my own view"
T0 = datetime(2026, 11, 9, 8, 10, tzinfo=timezone.utc)


# ── fixtures ────────────────────────────────────────────────────────────────────────────

def _png() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (9, 8, 7)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        yield tweet_store


@pytest.fixture
def notebook(monkeypatch, tmp_path, store):
    from api.services.journal_two import hotlink_fetch, tweet_price
    from api.services.journal_two.tweet_price import PricePoint

    async def fake_download(url, **kwargs):
        return _png(), "image/png"

    monkeypatch.setattr(hotlink_fetch, "download", fake_download)
    monkeypatch.setattr(tweet_price, "price_at_post", lambda s, p, wait_until=None: PricePoint("FAKE", 12.5, "posted", None))
    monkeypatch.setattr(tweet_price, "start_refresh", lambda symbol, wait_until=None: None)
    monkeypatch.setattr(tweet_price, "still_comparable", lambda *a: True)
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid, email in ((UID, "a@example.com"), (OTHER, "b@example.com")):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, email, "x", uid, "member"))
    conn.commit()
    conn.close()
    from api.services.journal_two import notes as notes_svc
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "j2_attachments"))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    monkeypatch.setenv("NOTEBOOK_TWEET_IMPORT_ENABLED", "1")
    return tmp_path / "j2_attachments"


@pytest.fixture
def x(monkeypatch):
    """The vendor. `gone` is what it reports missing (or an Exception to raise)."""
    box = {"gone": set(), "calls": []}

    def fake(ids):
        ids = list(ids)
        box["calls"].append(ids)
        if isinstance(box["gone"], Exception):
            raise box["gone"]
        return set(box["gone"]) & set(ids)

    monkeypatch.setattr(twitterapi_io, "find_deleted_tweet_ids", fake)
    return box


@pytest.fixture
def clock(monkeypatch):
    from api.services.journal_two import tweet_capture_sync as sync
    box = {"t": T0}
    monkeypatch.setattr(sync, "_now", lambda: box["t"])
    return box


@pytest.fixture
def alerts(monkeypatch):
    from api.services import chart_health_alerts
    calls = []

    def fake(key, severity, message, metadata=None):
        calls.append((key, severity, message, metadata))
        return True

    monkeypatch.setattr(chart_health_alerts, "emit", fake)
    return calls


def _rows(sql, *args):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


def _exec(sql, *args):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        c.execute(sql, args)
        c.commit()
    finally:
        c.close()


def _note(user_id=UID) -> str:
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": "Thesis", "ticker": "FAKE"})["id"]


def _save(tid, note_id, user_id=UID, raw=RAW, text=WORDS):
    from api.services.journal_two import tweet_capture as tc
    if tweet_store.get_tweet(tid) is None:
        tweet_store.upsert_tweet({
            "id": tid, "author_handle": "fakedesk_sync", "author_name": "Fake Desk", "text": text,
            "created_at": NOW - 3600, "url": f"https://x.com/fakedesk_sync/status/{tid}",
            "reply_count": 0, "like_count": 0, "retweet_count": 0, "is_retweet": 0, "raw_json": raw,
        }, ["FAKE"])
    return tc.save(user_id, note_id, [tid])["excerpts"][0]


def _capture(tid, user_id=UID):
    return _rows("SELECT * FROM j2_note_tweet_captures WHERE tweet_id = ? AND user_id = ?", tid, user_id)[0]


def _file_of(url) -> Path:
    """The file behind a stored attachment URL."""
    from api.services.journal_two import notes as notes_svc
    m = re.match(r"/api/j2/notes/attachments/([^/]+)/([^/]+)/([^/]+)/([^/]+)$", url)
    path = notes_svc.serve_note_image_path(m[1], m[2], m[3], m[4])
    assert path is not None
    return Path(path)


def _take(excerpt_id, take=TAKE, user_id=UID):
    from api.services.journal_two import note_excerpts
    assert note_excerpts.update_excerpt_annotation(user_id, excerpt_id, take) is not None


def _seed_rows(n, prefix="9"):
    """Bare sidecar rows: for the sweep's own arithmetic, which reads nothing else."""
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        for i in range(n):
            c.execute(
                "INSERT INTO j2_note_tweet_captures (document_id, user_id, note_id, tweet_id, created_at)"
                " VALUES (?,?,?,?,?)", (f"doc-{prefix}{i}", UID, "note-x", f"{prefix}{i:04d}", "2026-11-01"))
        c.commit()
    finally:
        c.close()


def _sync():
    from api.services.journal_two import tweet_capture_sync
    return tweet_capture_sync


def _stamp(moment):
    return moment.isoformat(timespec="microseconds")


# ── the two-miss rule ───────────────────────────────────────────────────────────────────

def test_single_miss_removes_nothing(notebook, x, clock, alerts):
    note_id = _note()
    excerpt = _save("7001", note_id)
    x["gone"] = {"7001"}

    out = _sync().run_sweep()

    assert out["checked"] == 1 and out["missed"] == 1
    row = _capture("7001")
    assert row["gone_first_missed_at"] is not None
    assert row["removed_at"] is None
    assert json.loads(row["media_json"])
    assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == WORDS
    assert len(_rows("SELECT * FROM j2_note_document_pages")) == 1
    assert alerts == []


def test_confirm_needs_ten_minutes(notebook, x, clock):
    note_id = _note()
    _save("7002", note_id)
    x["gone"] = {"7002"}
    _sync().run_sweep()
    x["calls"].clear()

    clock["t"] = T0 + timedelta(minutes=9, seconds=59)
    out = _sync().run_confirm()
    assert out["removed"] == 0
    assert x["calls"] == []         # not due: not even a lookup
    assert _capture("7002")["removed_at"] is None

    clock["t"] = T0 + timedelta(minutes=10)
    out = _sync().run_confirm()
    assert out["removed"] == 1
    assert x["calls"] == [["7002"]]
    assert _capture("7002")["removed_at"] is not None


def test_two_misses_remove_text_keep_take_and_author(notebook, x, clock):
    from api.services.journal_two import note_excerpts
    note_id = _note()
    excerpt = _save("7003", note_id)
    _take(excerpt["id"])
    before = _capture("7003")
    image = _file_of(json.loads(before["media_json"])[0])
    assert image.is_file()

    x["gone"] = {"7003"}
    _sync().run_sweep()
    clock["t"] = T0 + timedelta(minutes=15)
    assert _sync().run_confirm()["removed"] == 1

    row = _rows("SELECT * FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]
    assert row["captured_text"] == ""
    assert row["annotation"] == TAKE
    assert _rows("SELECT * FROM j2_note_document_pages") == []
    assert not image.exists()

    after = _capture("7003")
    assert after["media_json"] == "[]"
    assert after["removed_at"] is not None
    for keep in ("author_handle", "author_name", "avatar_url", "permalink", "posted_at", "price_symbol",
                 "price_at_post", "price_label", "price_session_date", "tweet_id", "note_id"):
        assert after[keep] == before[keep], keep
    assert before["author_handle"] == "fakedesk_sync" and before["price_at_post"] == 12.5

    # The card still comes back, marked: the excerpt row is what carries My take.
    card = note_excerpts.get_excerpt(UID, excerpt["id"])
    assert card["capturedText"] == "" and card["annotation"] == TAKE

    # A second removal has nothing left to do.
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        assert _sync().remove_post(c, "7003") == 0
    finally:
        c.close()


def test_removal_clears_quote_context_too(notebook, x, clock):
    """A passage's context selector holds the post's words as well."""
    note_id = _note()
    excerpt = _save("7016", note_id)
    _exec("UPDATE j2_note_excerpts SET quote_prefix = 'zebraprefix', quote_suffix = 'zebrasuffix' WHERE id = ?",
          excerpt["id"])
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        assert _sync().remove_post(c, "7016") == 1
    finally:
        c.close()
    row = _rows("SELECT quote_prefix, quote_suffix FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]
    assert row == {"quote_prefix": None, "quote_suffix": None}


def test_removed_text_not_searchable_take_still_searchable(notebook, x, clock):
    note_id = _note()
    excerpt = _save("7004", note_id)
    _take(excerpt["id"])

    def hits(table, word):
        return _rows(f"SELECT * FROM {table} WHERE {table} MATCH ?", word)

    assert len(hits("j2_note_excerpts_fts", "zebrawords")) == 1      # control: the query can find it
    assert len(hits("j2_note_document_pages_fts", "zebrawords")) == 1
    assert len(hits("j2_note_excerpts_fts", "giraffetake")) == 1

    x["gone"] = {"7004"}
    _sync().run_sweep()
    clock["t"] = T0 + timedelta(minutes=10)
    _sync().run_confirm()

    assert hits("j2_note_excerpts_fts", "zebrawords") == []
    assert hits("j2_note_document_pages_fts", "zebrawords") == []
    assert len(hits("j2_note_excerpts_fts", "giraffetake")) == 1
    assert _rows("SELECT * FROM j2_note_document_pages_fts_map") == []


def test_post_that_resolves_again_clears_the_mark(notebook, x, clock):
    note_id = _note()
    excerpt = _save("7005", note_id)
    x["gone"] = {"7005"}
    _sync().run_sweep()
    assert _capture("7005")["gone_first_missed_at"] is not None

    # Back at the confirm: the mark goes and nothing is removed.
    x["gone"] = set()
    clock["t"] = T0 + timedelta(minutes=10)
    out = _sync().run_confirm()
    assert out["removed"] == 0 and out["resolved"] == 1
    assert _capture("7005")["gone_first_missed_at"] is None

    # Back at the next sweep, too.
    x["gone"] = {"7005"}
    _sync().run_sweep()
    assert _capture("7005")["gone_first_missed_at"] is not None
    x["gone"] = set()
    _sync().run_sweep()
    row = _capture("7005")
    assert row["gone_first_missed_at"] is None and row["removed_at"] is None
    assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == WORDS


def test_a_repeat_miss_keeps_the_first_mark(notebook, x, clock):
    note_id = _note()
    _save("7006", note_id)
    x["gone"] = {"7006"}
    _sync().run_sweep()
    first = _capture("7006")["gone_first_missed_at"]
    clock["t"] = T0 + timedelta(days=1)
    _sync().run_sweep()
    assert _capture("7006")["gone_first_missed_at"] == first


# ── the glitch guards ───────────────────────────────────────────────────────────────────

def test_bulk_miss_removes_nothing_and_alerts(notebook, x, clock, alerts, caplog):
    _seed_rows(40)
    # A mark from an earlier night, on a post this pass also misses: not to be trusted either.
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ? WHERE tweet_id = '90000'",
          (T0 - timedelta(days=1)).isoformat(timespec="microseconds"))
    x["gone"] = {f"9{i:04d}" for i in range(20)}

    with caplog.at_level("ERROR", logger="api.services.journal_two.tweet_capture_sync"):
        out = _sync().run_sweep()

    assert out["bulk_guard"] is True and out["missed"] == 20 and out["checked"] == 40
    assert _rows("SELECT * FROM j2_note_tweet_captures WHERE gone_first_missed_at IS NOT NULL") == []
    assert _rows("SELECT * FROM j2_note_tweet_captures WHERE removed_at IS NOT NULL") == []
    assert len(alerts) == 1 and alerts[0][1] == "critical"
    assert "20" in alerts[0][2] and "40" in alerts[0][2]
    assert any(r.levelname == "ERROR" for r in caplog.records)

    # And the confirm that follows has nothing to confirm.
    x["calls"].clear()
    clock["t"] = T0 + timedelta(minutes=15)
    assert _sync().run_confirm()["removed"] == 0
    assert x["calls"] == []


@pytest.mark.parametrize("total,missed", [
    (100, 20),      # exactly 20% does not exceed it
    (30, 19),       # over 20%, but fewer than 20
])
def test_a_miss_below_either_bulk_bound_is_marked(notebook, x, clock, alerts, total, missed):
    _seed_rows(total)
    x["gone"] = {f"9{i:04d}" for i in range(missed)}
    out = _sync().run_sweep()
    assert out["bulk_guard"] is False
    assert len(_rows("SELECT 1 FROM j2_note_tweet_captures WHERE gone_first_missed_at IS NOT NULL")) == missed
    assert alerts == []


def test_a_failing_alert_never_raises(notebook, x, clock, monkeypatch):
    from api.services import chart_health_alerts

    def boom(*a, **k):
        raise RuntimeError("no channel")

    monkeypatch.setattr(chart_health_alerts, "emit", boom)
    _seed_rows(40)
    x["gone"] = {f"9{i:04d}" for i in range(20)}
    out = _sync().run_sweep()
    assert out["bulk_guard"] is True
    assert _rows("SELECT 1 FROM j2_note_tweet_captures WHERE gone_first_missed_at IS NOT NULL") == []


def test_the_alert_still_fires_when_the_marks_cannot_be_cleared(notebook, x, clock, alerts, monkeypatch):
    sync = _sync()
    _seed_rows(40)
    x["gone"] = {f"9{i:04d}" for i in range(20)}

    def boom(*a):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(sync, "_write_marks", boom)
    out = sync.run_sweep()
    assert out["bulk_guard"] is True and out["error"] == "RuntimeError"
    assert len(alerts) == 1


def test_nothing_resolving_in_sweep_is_an_outage(notebook, x, clock, alerts, caplog):
    _seed_rows(3)                   # far under the 20-and-20 guard: only this rule can catch it
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ? WHERE tweet_id = '90000'",
          (T0 - timedelta(days=1)).isoformat(timespec="microseconds"))
    x["gone"] = {"90000", "90001", "90002"}

    with caplog.at_level("ERROR", logger="api.services.journal_two.tweet_capture_sync"):
        out = _sync().run_sweep()

    assert out["outage"] is True and out["bulk_guard"] is False and out["marked"] == 0
    assert _rows("SELECT * FROM j2_note_tweet_captures WHERE gone_first_missed_at IS NOT NULL") == []
    assert _rows("SELECT * FROM j2_note_tweet_captures WHERE removed_at IS NOT NULL") == []
    assert len(alerts) == 1 and alerts[0][1] == "critical"
    assert any(r.levelname == "ERROR" for r in caplog.records)


def test_nothing_resolving_in_confirm_removes_nothing(notebook, x, clock, alerts, caplog):
    """Every saved post is marked, so there is no canary: two misses still read as an outage."""
    note_id = _note()
    excerpt = _save("7050", note_id)
    _save("7051", note_id)
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ?", _stamp(T0))
    x["gone"] = {"7050", "7051"}
    before = _rows("SELECT * FROM j2_note_tweet_captures ORDER BY tweet_id")

    clock["t"] = T0 + timedelta(minutes=10)
    with caplog.at_level("ERROR", logger="api.services.journal_two.tweet_capture_sync"):
        out = _sync().run_confirm()

    assert out["outage"] is True and out["removed"] == 0 and out["checked"] == 2 and out["canaries"] == 0
    assert _rows("SELECT * FROM j2_note_tweet_captures ORDER BY tweet_id") == before    # no marks either
    assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == WORDS
    assert len(_rows("SELECT * FROM j2_note_document_pages")) == 2
    assert len(alerts) == 1 and alerts[0][1] == "critical"
    assert any(r.levelname == "ERROR" for r in caplog.records)


def test_several_real_deletions_are_removed_when_a_canary_resolves(notebook, x, clock, alerts):
    """Every marked post missed, which is the ordinary case: the canary is what says X is up."""
    note_id = _note()
    a = _save("7060", note_id)
    b = _save("7061", note_id)
    _save("7062", note_id)
    x["gone"] = {"7060", "7061"}
    _sync().run_sweep()
    x["calls"].clear()

    clock["t"] = T0 + timedelta(minutes=10)
    out = _sync().run_confirm()

    assert out["outage"] is False and out["removed"] == 2 and out["checked"] == 2 and out["canaries"] == 1
    assert len(x["calls"]) == 1 and sorted(x["calls"][0]) == ["7060", "7061", "7062"]
    for excerpt in (a, b):
        assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == ""
    assert _capture("7062")["removed_at"] is None
    assert alerts == []


def test_confirm_is_an_outage_when_canaries_miss_too(notebook, x, clock, alerts):
    note_id = _note()
    excerpt = _save("7070", note_id)
    _save("7071", note_id)
    _save("7072", note_id)
    x["gone"] = {"7070", "7071"}
    _sync().run_sweep()
    before = _rows("SELECT * FROM j2_note_tweet_captures ORDER BY tweet_id")

    x["gone"] = {"7070", "7071", "7072"}
    clock["t"] = T0 + timedelta(minutes=10)
    out = _sync().run_confirm()

    assert out["outage"] is True and out["removed"] == 0
    assert _rows("SELECT * FROM j2_note_tweet_captures ORDER BY tweet_id") == before
    assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == WORDS
    assert len(alerts) == 1 and "3 of 3" in alerts[0][2]


def test_one_marked_post_is_an_outage_when_its_canary_misses_too(notebook, x, clock, alerts):
    note_id = _note()
    _save("7073", note_id)
    _save("7074", note_id)
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ? WHERE tweet_id = '7073'", _stamp(T0))
    x["gone"] = {"7073", "7074"}
    clock["t"] = T0 + timedelta(minutes=10)
    out = _sync().run_confirm()
    assert out["outage"] is True and out["removed"] == 0 and _capture("7073")["removed_at"] is None
    assert len(alerts) == 1


def test_canaries_are_never_marked_or_removed(notebook, x, clock, alerts):
    note_id = _note()
    _save("7080", note_id)              # the marked post
    gone_canary = _save("7081", note_id)
    _save("7082", note_id)
    _seed_rows(8)
    x["gone"] = {"7080"}
    _sync().run_sweep()
    # A mark too young to confirm: neither due, nor free to serve as a canary.
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ? WHERE tweet_id = '90000'",
          _stamp(T0 + timedelta(minutes=9)))
    x["calls"].clear()

    # A canary that misses in this pass (7081) is only ever evidence about X.
    x["gone"] = {"7080", "7081"}
    clock["t"] = T0 + timedelta(minutes=10)
    out = _sync().run_confirm()

    assert out["removed"] == 1 and out["canaries"] == 5 and out["resolved"] == 0
    lookup = x["calls"][0]
    assert len(lookup) == 6 and len(set(lookup)) == 6 and "7080" in lookup and "90000" not in lookup
    assert _capture("7080")["removed_at"] is not None
    for canary in set(lookup) - {"7080"}:
        row = _rows("SELECT * FROM j2_note_tweet_captures WHERE tweet_id = ?", canary)[0]
        assert row["gone_first_missed_at"] is None and row["removed_at"] is None, canary
    assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?",
                 gone_canary["id"])[0]["captured_text"] == WORDS


def _feed(*ids, age=86400):
    for tid in ids:
        tweet_store.upsert_tweet({
            "id": tid, "author_handle": "fakedesk_feed", "author_name": "Fake Feed", "text": "a feed post",
            "created_at": NOW - age, "url": f"https://x.com/fakedesk_feed/status/{tid}",
            "reply_count": 0, "like_count": 0, "retweet_count": 0, "is_retweet": 0, "raw_json": "{}",
        }, [])


def test_every_saved_post_really_gone_is_removed_when_the_feed_answers(notebook, x, clock, alerts):
    note_id = _note()
    a = _save("7090", note_id)
    b = _save("7091", note_id)
    _feed("8001", "8002")
    x["gone"] = {"7090", "7091"}

    sweep = _sync().run_sweep()
    assert sweep["outage"] is False and sweep["marked"] == 2

    clock["t"] = T0 + timedelta(minutes=10)
    confirm = _sync().run_confirm()
    assert confirm["outage"] is False and confirm["removed"] == 2
    for excerpt in (a, b):
        assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == ""
    assert alerts == []
    assert tweet_store.get_tweet("8001") is not None    # a feed post is only ever evidence


def test_nothing_resolving_is_still_an_outage_when_the_feed_misses_too(notebook, x, clock, alerts):
    note_id = _note()
    _save("7092", note_id)
    _save("7093", note_id)
    _feed("8003")
    x["gone"] = {"7092", "7093", "8003"}

    out = _sync().run_sweep()

    assert out["outage"] is True and out["marked"] == 0
    assert len(alerts) == 1 and "2 of 2" in alerts[0][2]


def test_a_failed_feed_lookup_is_no_evidence(notebook, x, clock, alerts, monkeypatch):
    note_id = _note()
    _save("7094", note_id)
    _save("7095", note_id)
    _feed("8004")
    seen = []

    def fake(ids):
        seen.append(list(ids))
        if len(seen) > 1:
            raise twitterapi_io.TwitterApiError("down")
        return set(ids)

    monkeypatch.setattr(twitterapi_io, "find_deleted_tweet_ids", fake)
    out = _sync().run_sweep()
    assert seen[1] == ["8004"] and out["outage"] is True and out["marked"] == 0 and len(alerts) == 1


def test_an_unreadable_feed_is_no_evidence(notebook, x, clock, alerts, monkeypatch):
    note_id = _note()
    _save("7096", note_id)
    _save("7097", note_id)
    x["gone"] = {"7096", "7097"}

    def broken(*a, **k):
        raise RuntimeError("no store")

    monkeypatch.setattr(tweet_store, "oldest_tweet_ids", broken)
    out = _sync().run_sweep()
    assert out["outage"] is True and out["marked"] == 0 and len(alerts) == 1


def test_the_feed_is_only_asked_when_nothing_resolved(notebook, x, clock, alerts):
    note_id = _note()
    _save("7098", note_id)
    _save("7099", note_id)
    _feed("8005")
    x["gone"] = {"7098"}
    _sync().run_sweep()
    assert len(x["calls"]) == 1 and "8005" not in x["calls"][0]


def test_feed_canaries_are_the_oldest_posts_not_already_asked_about(store):
    _feed("8010", age=300)
    _feed("8011", age=900)
    _feed("8012", age=600)
    assert tweet_store.oldest_tweet_ids(1) == ["8011"]
    assert tweet_store.oldest_tweet_ids(5, exclude=["8011"]) == ["8012", "8010"]


def test_a_single_post_really_gone_is_still_removed_after_both_checks(notebook, x, clock, alerts):
    """The control: one id checked is not an outage, however it answers."""
    excerpt = _save("7053", _note())
    x["gone"] = {"7053"}
    sweep = _sync().run_sweep()
    assert sweep["outage"] is False and sweep["marked"] == 1
    clock["t"] = T0 + timedelta(minutes=10)
    confirm = _sync().run_confirm()
    assert confirm["outage"] is False and confirm["removed"] == 1
    assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == ""
    assert alerts == []


def test_resave_of_a_removed_post_is_refused_and_restores_nothing(notebook, x, clock):
    from api.services import auth_db
    from api.services.journal_two import notes, tweet_capture as tc

    note_id = _note()
    excerpt = _save("7054", note_id)
    c = auth_db.get_connection()
    try:
        assert _sync().remove_post(c, "7054") == 1
    finally:
        c.close()
    assert tweet_store.get_tweet("7054") is not None    # the store can still answer: the reachable case
    before = notes.get_note(UID, note_id)["bodyJson"]

    with pytest.raises(tc.TweetCaptureError) as refused:
        tc.save(UID, note_id, ["7054"])

    assert refused.value.status == 409
    assert str(refused.value) == "That post is no longer on X, so it can't be saved again."
    assert _rows("SELECT * FROM j2_note_document_pages") == []
    assert _rows("SELECT * FROM j2_note_document_pages_fts_map") == []
    excerpts = _rows("SELECT id, captured_text FROM j2_note_excerpts")
    assert excerpts == [{"id": excerpt["id"], "captured_text": ""}]
    assert notes.get_note(UID, note_id)["bodyJson"] == before
    assert _capture("7054")["removed_at"] is not None


def test_saving_a_removed_post_into_a_new_note_is_a_fresh_card(notebook, x, clock):
    """The refusal is about the card that was removed; the sweep checks a new one on its own."""
    from api.services import auth_db
    _save("7055", _note())
    c = auth_db.get_connection()
    try:
        _sync().remove_post(c, "7055")
    finally:
        c.close()
    fresh = _save("7055", _note())
    assert fresh["capturedText"] == WORDS
    assert len(_rows("SELECT 1 FROM j2_note_tweet_captures WHERE tweet_id = '7055' AND removed_at IS NULL")) == 1


def test_vendor_error_changes_nothing(notebook, x, clock):
    note_id = _note()
    _save("7007", note_id)
    _save("7008", note_id)
    stale = (T0 - timedelta(minutes=30)).isoformat(timespec="microseconds")
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ? WHERE tweet_id = '7007'", stale)
    before = _rows("SELECT * FROM j2_note_tweet_captures ORDER BY tweet_id")
    x["gone"] = twitterapi_io.TwitterApiTransientError("HTTP 503")

    sweep = _sync().run_sweep()
    confirm = _sync().run_confirm()

    assert sweep["vendor_error"] is True and confirm["vendor_error"] is True
    assert confirm["removed"] == 0
    assert _rows("SELECT * FROM j2_note_tweet_captures ORDER BY tweet_id") == before
    assert len(_rows("SELECT * FROM j2_note_document_pages")) == 2


def test_one_lookup_per_distinct_tweet_across_members(notebook, x, clock):
    _save("7009", _note(UID), UID)
    _save("7009", _note(OTHER), OTHER)
    _save("7010", _note(UID), UID)

    _sync().run_sweep()

    assert len(x["calls"]) == 1
    assert sorted(x["calls"][0]) == ["7009", "7010"]


def test_a_removal_covers_every_member_holding_the_post(notebook, x, clock):
    a = _save("7011", _note(UID), UID)
    b = _save("7011", _note(OTHER), OTHER)
    x["gone"] = {"7011"}
    _sync().run_sweep()
    clock["t"] = T0 + timedelta(minutes=10)
    assert _sync().run_confirm()["removed"] == 2
    for excerpt_id in (a["id"], b["id"]):
        assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt_id)[0]["captured_text"] == ""
    assert _capture("7011", UID)["removed_at"] and _capture("7011", OTHER)["removed_at"]
    assert _rows("SELECT * FROM j2_note_document_pages") == []


def test_removed_posts_are_not_checked_again(notebook, x, clock):
    _save("7012", _note())
    x["gone"] = {"7012"}
    _sync().run_sweep()
    clock["t"] = T0 + timedelta(minutes=10)
    _sync().run_confirm()
    x["calls"].clear()
    assert _sync().run_sweep()["checked"] == 0
    assert x["calls"] == []


@pytest.mark.parametrize("job", ["run_sweep", "run_confirm"])
def test_flag_off_does_nothing(notebook, x, clock, monkeypatch, job):
    _save("7013", _note())
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ?",
          (T0 - timedelta(hours=1)).isoformat(timespec="microseconds"))
    monkeypatch.delenv("NOTEBOOK_TWEET_IMPORT_ENABLED")
    x["gone"] = {"7013"}
    out = getattr(_sync(), job)()
    assert out["skipped"] == "disabled"
    assert x["calls"] == []
    assert _capture("7013")["removed_at"] is None


@pytest.mark.parametrize("job", ["run_sweep", "run_confirm"])
def test_an_unexpected_failure_is_a_dict_not_a_raise(notebook, x, clock, job):
    _save("7014", _note())
    _exec("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ?",
          (T0 - timedelta(hours=1)).isoformat(timespec="microseconds"))
    before = _rows("SELECT * FROM j2_note_tweet_captures")
    x["gone"] = RuntimeError("something new")
    out = getattr(_sync(), job)()
    assert out["error"] == "RuntimeError"
    assert _rows("SELECT * FROM j2_note_tweet_captures") == before


def test_no_write_transaction_is_held_across_the_vendor_call(notebook, x, clock, monkeypatch):
    """A write to the same database during the lookup succeeds at once."""
    _save("7015", _note())
    seen = []

    def fake(ids):
        from api.services import auth_db
        c = auth_db.get_connection()
        try:
            c.execute("PRAGMA busy_timeout = 0")
            c.execute("UPDATE j2_note_tweet_captures SET price_label = 'during'")
            c.commit()
            seen.append(True)
        finally:
            c.close()
        return set()

    monkeypatch.setattr(twitterapi_io, "find_deleted_tweet_ids", fake)
    _sync().run_sweep()
    assert seen == [True]


# ── one image, many cards ───────────────────────────────────────────────────────────────

def test_shared_image_survives_until_its_last_card_is_removed(notebook, x, clock):
    note_id = _note()
    _save("7020", note_id)
    _save("7021", note_id)
    url = json.loads(_capture("7020")["media_json"])[0]
    assert url == json.loads(_capture("7021")["media_json"])[0]     # content-addressed: one file
    image = _file_of(url)

    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        assert _sync().remove_post(c, "7020") == 1
        assert image.is_file()                                       # the other card still shows it
        assert _sync().remove_post(c, "7021") == 1
        assert not image.exists()
    finally:
        c.close()


def test_an_image_the_member_placed_in_the_note_is_kept(notebook, x, clock):
    """Same bytes in the note body share the file: the post leaving X must not break the member's own."""
    note_id = _note()
    _save("7022", note_id)
    url = json.loads(_capture("7022")["media_json"])[0]
    image = _file_of(url)
    _exec("UPDATE j2_notes SET body_json = ? WHERE id = ?",
          json.dumps({"type": "doc", "content": [{"type": "image", "attrs": {"src": url}}]}), note_id)

    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        assert _sync().remove_post(c, "7022") == 1
    finally:
        c.close()
    assert image.is_file()


def test_attachment_gc_stops_protecting_a_removed_posts_images(notebook, x, clock, monkeypatch):
    """A file whose delete failed is no longer referenced, so the GC sweep can finish the job; a
    file another card still lists stays referenced."""
    from api.services import auth_db
    from api.services.journal_two import attachment_gc, media_policy

    note_id = _note()
    _save("7030", note_id)
    _save("7031", note_id)                                           # shares 7030's file
    url = json.loads(_capture("7030")["media_json"])[0]
    name = url.rsplit("/", 1)[-1]

    c = auth_db.get_connection()
    try:
        _sync().remove_post(c, "7030")
        assert name in attachment_gc._referenced_names(c, UID)       # 7031 still lists it
        monkeypatch.setattr(media_policy, "delete_stored_media", lambda *a: False)
        _sync().remove_post(c, "7031")
        assert name not in attachment_gc._referenced_names(c, UID)   # nothing protects it now
    finally:
        c.close()
    assert _file_of(url).is_file()                                   # the failed delete, left for the GC
    assert attachment_gc.sweep_orphaned_attachments(min_age_hours=-1.0, user_id=UID)["deleted"] == 1


# ── whole posts ─────────────────────────────────────────────────────────────────────────

class _FailOnNth:
    """A connection that fails on the Nth statement containing `needle`."""

    def __init__(self, conn, needle, n):
        self._conn, self._needle, self._n = conn, needle, n

    def execute(self, sql, *args):
        if self._needle in sql:
            self._n -= 1
            if self._n == 0:
                raise RuntimeError("the disk went away")
        return self._conn.execute(sql, *args)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def test_a_failure_mid_post_leaves_the_whole_post_untouched(notebook, x, clock):
    from api.services import auth_db
    _save("7040", _note(UID), UID)
    _save("7040", _note(OTHER), OTHER)
    before = _rows("SELECT * FROM j2_note_tweet_captures ORDER BY user_id")

    c = auth_db.get_connection()
    try:
        with pytest.raises(RuntimeError):
            # The second member's sidecar write: the first member's rows are already written.
            _sync().remove_post(_FailOnNth(c, "UPDATE j2_note_tweet_captures", 2), "7040")
    finally:
        c.close()

    assert _rows("SELECT * FROM j2_note_tweet_captures ORDER BY user_id") == before
    assert len(_rows("SELECT * FROM j2_note_document_pages")) == 2
    assert {r["captured_text"] for r in _rows("SELECT captured_text FROM j2_note_excerpts")} == {WORDS}
    assert all(_file_of(json.loads(r["media_json"])[0]).is_file() for r in before)


def test_one_bad_post_does_not_stop_the_others(notebook, x, clock, monkeypatch):
    sync = _sync()
    note_id = _note()
    _save("7041", note_id)
    _save("7042", note_id)
    _save("7044", note_id)          # marked, then back: the confirm must see something resolve
    _save("7045", note_id)          # never missed: the sweep must see something resolve
    x["gone"] = {"7041", "7042", "7044"}
    sync.run_sweep()
    x["gone"] = {"7041", "7042"}
    clock["t"] = T0 + timedelta(minutes=10)
    real = sync.remove_post

    def flaky(conn, tweet_id):
        if tweet_id == "7041":
            raise RuntimeError("not this one")
        return real(conn, tweet_id)

    monkeypatch.setattr(sync, "remove_post", flaky)
    out = sync.run_confirm()
    assert out["removed"] == 1 and out["failed"] == 1
    assert _capture("7041")["removed_at"] is None
    assert _capture("7042")["removed_at"] is not None


def test_a_failed_file_delete_does_not_undo_the_removal(notebook, x, clock, monkeypatch):
    from api.services import auth_db
    from api.services.journal_two import media_policy
    note_id = _note()
    excerpt = _save("7043", note_id)

    def boom(*a):
        raise OSError("volume busy")

    monkeypatch.setattr(media_policy, "delete_stored_media", boom)
    c = auth_db.get_connection()
    try:
        assert _sync().remove_post(c, "7043") == 1
    finally:
        c.close()
    assert _capture("7043")["removed_at"] is not None
    assert _rows("SELECT captured_text FROM j2_note_excerpts WHERE id = ?", excerpt["id"])[0]["captured_text"] == ""


# ── the schedule ────────────────────────────────────────────────────────────────────────

def test_both_jobs_sit_beside_the_tweet_cleanup_job():
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    block = src[src.index('if os.environ.get("TWITTERAPI_IO_ENABLED"'):src.index("[scheduler] tweet poll jobs registered")]
    for minute, job in (("10", "run_sweep"), ("25", "run_confirm")):
        m = re.search(rf"{job},\s*trigger=CronTrigger\(hour=3, minute={minute}, timezone=_ET\),[^)]*max_instances=1", block)
        assert m, job


def test_a_removed_post_is_not_offered_as_evidence(notebook, x, clock):
    from api.services.journal_two import evidence_candidates
    note_id = _note()
    _save("7003", note_id)
    assert len(evidence_candidates.list_candidates(UID, note_id)) == 1

    x["gone"] = {"7003"}
    _sync().run_sweep()
    clock["t"] = T0 + timedelta(minutes=15)
    assert _sync().run_confirm()["removed"] == 1
    assert evidence_candidates.list_candidates(UID, note_id) == []
