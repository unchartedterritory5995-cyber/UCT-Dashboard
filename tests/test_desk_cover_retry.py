"""desk_cover_retry — the creative cover's second chance.

Contract: a session whose creative cover didn't render at publish time is
QUEUED (the themed card is a placeholder), a scheduler drain re-renders it
from the session's own stored story, failures back off and eventually give
up, nothing here ever raises, and the flag is the in-band stop button.
"""
import contextlib
import json
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import desk_cover_retry as cr
from api.services import desk_creative
from api.services import education_service as edu

ENTRY = dict(section="Live Trading Sessions", eyebrow="LIVE TRADING SESSION",
             date_text="August 20, 2026")


@pytest.fixture
def ledger(tmp_path):
    return str(tmp_path / "retry.json")


@pytest.fixture
def edu_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(edu, "_DB_PATH", os.path.join(d, "education.db"))
        edu._init_db()
        yield edu


def _seed(edu_db, youtube_id, *, title="Live Trading Session — August 20, 2026",
          category="Live Trading Sessions", headline="", tickers=()):
    edu_db.register_category_if_missing(category, kind="show")
    row = edu_db.create_video({"youtube_id": youtube_id, "title": title,
                               "description": "", "category": category, "sort_order": 0})
    with contextlib.closing(edu._connect()) as c:
        c.execute("UPDATE edu_videos SET headline=?, ticker_moments=? WHERE id=?",
                  (headline, json.dumps(list(tickers)), row["id"]))
        c.commit()
    return row


class _YT:
    def __init__(self):
        self.calls = []

    def set_thumbnail(self, video_id, image_bytes):
        self.calls.append((video_id, image_bytes))


# ---------------------------------------------------------------------------
# enqueue / resolve
# ---------------------------------------------------------------------------

def test_enqueue_is_idempotent_and_keeps_attempts(ledger):
    assert cr.enqueue("V1", now=1000, path=ledger, **ENTRY)
    q = cr._read(ledger)
    q["V1"]["attempts"] = 3
    q["V1"]["next_after"] = 5000
    cr._write(ledger, q)
    assert cr.enqueue("V1", now=2000, path=ledger, **ENTRY)
    e = cr._read(ledger)["V1"]
    assert e["attempts"] == 3 and e["next_after"] == 5000    # a re-enqueue doesn't reset
    assert cr.enqueue("V1", now=2000, path=ledger, force_now=True, **ENTRY)
    assert cr._read(ledger)["V1"]["next_after"] == 2000       # ...unless asked to be due now


def test_enqueue_rejects_blank_and_never_raises(ledger, monkeypatch):
    assert not cr.enqueue("", path=ledger, **ENTRY)
    assert not cr.enqueue("V1", path=ledger, section="s", eyebrow="e", date_text="")

    def boom(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(cr, "_write", boom)
    assert not cr.enqueue("V1", path=ledger, **ENTRY)


def test_resolve_drops_the_entry(ledger):
    cr.enqueue("V1", now=0, path=ledger, **ENTRY)
    assert cr.resolve("V1", path=ledger)
    assert not cr.resolve("V1", path=ledger)
    assert cr._read(ledger) == {}


def test_ledger_write_is_atomic_tmp_plus_replace(ledger):
    cr.enqueue("V1", now=0, path=ledger, **ENTRY)
    folder = os.path.dirname(ledger)
    assert sorted(os.listdir(folder)) == ["retry.json"]      # no stray tmp files
    assert json.loads(open(ledger, encoding="utf-8").read())["V1"]["youtube_id"] == "V1"


# ---------------------------------------------------------------------------
# drain
# ---------------------------------------------------------------------------

def test_drain_is_a_noop_when_flag_off(ledger, monkeypatch):
    monkeypatch.delenv("DESK_CREATIVE_THUMBS", raising=False)
    cr.enqueue("V1", now=1, path=ledger, **ENTRY)
    yt = _YT()
    assert cr.drain(now=10, path=ledger, render=lambda **k: b"x", youtube=yt) == []
    assert yt.calls == [] and "V1" in cr._read(ledger)        # waits, not dropped


def test_drain_renders_from_the_sessions_story_sets_thumbnail_and_drops(ledger, edu_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(desk_creative, "day_context", lambda: {"date": "2026-08-20", "tone": "cautious"})
    _seed(edu_db, "V1", headline="MU breakout traded live",
          tickers=[{"ticker": "MU"}, {"symbol": "$DELL"}, "MU"])
    cr.enqueue("V1", now=1, path=ledger, **ENTRY)
    seen = {}

    def render(**kw):
        seen.update(kw)
        return b"JPEG-BYTES"
    yt = _YT()
    out = cr.drain(now=10, path=ledger, render=render, youtube=yt)
    assert out == [{"youtube_id": "V1", "outcome": "done"}]
    assert yt.calls == [("V1", b"JPEG-BYTES")]
    assert seen["facts"] == {"this_sessions_headline": "MU breakout traded live",
                             "tickers_discussed_in_session": ["MU", "DELL"]}
    assert seen["eyebrow"] == "LIVE TRADING SESSION"
    assert seen["date_text"] == "August 20, 2026"
    assert seen["section"] == "Live Trading Sessions"
    assert "ctx" not in seen                                   # the day brief is on the volume
    assert cr._read(ledger) == {}


def test_drain_without_a_wire_brief_uses_the_sessions_own_story_as_context(ledger, edu_db, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(desk_creative, "day_context", lambda: None)
    _seed(edu_db, "V1", headline="Sat on hands while tech bled", tickers=[])
    cr.enqueue("V1", now=0, path=ledger, **ENTRY)
    seen = {}

    def render(**kw):
        seen.update(kw)
        return b"J"
    cr.drain(now=1, path=ledger, render=render, youtube=_YT())
    assert seen["ctx"]["this_sessions_headline"] == "Sat on hands while tech bled"
    assert seen["ctx"]["date"] == "August 20, 2026"


def test_drain_failure_backs_off_exponentially_then_gives_up(ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(cr, "_stored_facts", lambda yid: None)
    monkeypatch.setattr(desk_creative, "day_context", lambda: {"date": "2026-08-20"})
    cr.enqueue("V1", now=0, path=ledger, **ENTRY)
    yt = _YT()
    now = 0
    for attempt in range(1, cr.MAX_ATTEMPTS):
        out = cr.drain(now=now, path=ledger, render=lambda **k: None, youtube=yt)
        assert out == [{"youtube_id": "V1", "outcome": "no_render"}]
        e = cr._read(ledger)["V1"]
        assert e["attempts"] == attempt
        assert e["next_after"] == now + cr.backoff_secs(attempt)
        # Not due a second early — and a due-check must not consume a render.
        assert cr.drain(now=e["next_after"] - 1, path=ledger,
                        render=lambda **k: b"x", youtube=yt) == []
        now = e["next_after"]
    out = cr.drain(now=now, path=ledger, render=lambda **k: None, youtube=yt)
    assert out[0]["outcome"].startswith("gave_up")
    assert cr._read(ledger) == {}
    assert yt.calls == []


def test_backoff_doubles_and_is_capped():
    assert cr.backoff_secs(1) == 15 * 60
    assert cr.backoff_secs(2) == 30 * 60
    assert cr.backoff_secs(3) == 60 * 60
    assert cr.backoff_secs(20) == cr.MAX_BACKOFF_SECS


def test_drain_render_exception_is_an_outcome_not_a_raise(ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(cr, "_stored_facts", lambda yid: None)
    monkeypatch.setattr(desk_creative, "day_context", lambda: {"date": "2026-08-20"})
    cr.enqueue("V1", now=0, path=ledger, **ENTRY)

    def boom(**k):
        raise RuntimeError("image api down")
    out = cr.drain(now=5, path=ledger, render=boom, youtube=_YT())
    assert out[0]["outcome"].startswith("error: RuntimeError")
    e = cr._read(ledger)["V1"]
    assert e["attempts"] == 1 and e["last"].startswith("error: RuntimeError")


def test_drain_thumbnail_set_failure_keeps_the_entry(ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(cr, "_stored_facts", lambda yid: None)
    monkeypatch.setattr(desk_creative, "day_context", lambda: {"date": "2026-08-20"})
    cr.enqueue("V1", now=0, path=ledger, **ENTRY)

    class _BoomYT:
        def set_thumbnail(self, *a):
            raise RuntimeError("oauth")
    out = cr.drain(now=5, path=ledger, render=lambda **k: b"J", youtube=_BoomYT())
    assert out[0]["outcome"].startswith("error: RuntimeError: oauth")
    assert cr._read(ledger)["V1"]["attempts"] == 1


def test_drain_expires_old_entries_without_rendering(ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    cr.enqueue("V1", now=0, path=ledger, **ENTRY)
    calls = []
    out = cr.drain(now=cr.MAX_AGE_SECS + 1, path=ledger,
                   render=lambda **k: calls.append(1) or b"x", youtube=_YT())
    assert out == [{"youtube_id": "V1", "outcome": "expired"}]
    assert calls == [] and cr._read(ledger) == {}


def test_drain_is_bounded_per_pass_oldest_first(ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    monkeypatch.setattr(cr, "_stored_facts", lambda yid: None)
    monkeypatch.setattr(desk_creative, "day_context", lambda: {"date": "2026-08-20"})
    for i in (3, 1, 2, 0):
        cr.enqueue(f"V{i}", now=i, path=ledger, **ENTRY)
    out = cr.drain(now=10, path=ledger, render=lambda **k: b"x", youtube=_YT())
    assert [o["youtube_id"] for o in out] == ["V0", "V1"]
    assert sorted(cr._read(ledger)) == ["V2", "V3"]


def test_drain_never_raises_on_a_corrupt_ledger(ledger, monkeypatch):
    monkeypatch.setenv("DESK_CREATIVE_THUMBS", "1")
    open(ledger, "w").write("{not json")
    assert cr.drain(now=1, path=ledger, render=lambda **k: b"x", youtube=_YT()) == []


# ---------------------------------------------------------------------------
# the admin lever: enqueue_from_library + endpoints
# ---------------------------------------------------------------------------

def test_enqueue_from_library_derives_show_date_and_section(ledger, edu_db):
    _seed(edu_db, "V9", title="QQQ can't pick a lane at the MAs | Live Trading Session — August 20, 2026",
          headline="Faded the chop", tickers=[{"ticker": "MU"}])
    out = cr.enqueue_from_library("V9", now=5, path=ledger)
    assert out["queued"] == "V9"
    assert out["show"] == "Live Trading Session" and out["date_text"] == "August 20, 2026"
    assert out["facts"] == {"this_sessions_headline": "Faded the chop",
                            "tickers_discussed_in_session": ["MU"]}
    e = cr._read(ledger)["V9"]
    assert e["section"] == "Live Trading Sessions"
    assert e["eyebrow"] == "LIVE TRADING SESSION"
    assert e["next_after"] == 5


def test_enqueue_from_library_refuses_unknown_and_non_session_videos(ledger, edu_db):
    assert cr.enqueue_from_library("NOPE", path=ledger)["error"].startswith("no video")
    _seed(edu_db, "V8", title="How to read a VCP", category="Courses")
    assert "session title" in cr.enqueue_from_library("V8", path=ledger)["error"]
    assert cr.enqueue_from_library("", path=ledger)["error"].startswith("youtube_id")
    assert cr._read(ledger) == {}


def _client():
    from api.routers import desk_zoom_webhook as wh
    app = FastAPI()
    app.include_router(wh.router)
    return TestClient(app)


def _url(c):
    from api.routers import desk_zoom_webhook as wh
    return f"{wh.router.prefix}/creative-cover-retry"


def test_retry_endpoints_require_the_push_secret(monkeypatch, tmp_path):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("DESK_CREATIVE_DATA_DIR", str(tmp_path))
    c = _client()
    assert c.get(_url(c)).status_code == 401
    assert c.post(_url(c), json={"youtube_id": "V1"}).status_code == 401
    assert c.get(_url(c), headers={"Authorization": "Bearer wrong"}).status_code == 401
    r = c.get(_url(c), headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and r.json()["pending"] == []


def test_retry_endpoint_queues_a_library_video(monkeypatch, tmp_path, edu_db):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("DESK_CREATIVE_DATA_DIR", str(tmp_path))
    _seed(edu_db, "V9", title="Hook | Evening Update — August 20, 2026", category="Evening Update")
    c = _client()
    h = {"Authorization": "Bearer s3cret"}
    r = c.post(_url(c), json={"youtube_id": "V9"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queued"] == "V9" and "drain_started" not in body
    assert [e["youtube_id"] for e in body["pending"]] == ["V9"]
    assert c.post(_url(c), json={"youtube_id": "NOPE"}, headers=h).status_code == 404
    assert c.post(_url(c), content=b"{bad", headers=h).status_code == 400
    assert c.get(_url(c), headers=h).json()["pending"][0]["date_text"] == "August 20, 2026"


def test_status_handler_is_sync(monkeypatch):
    # The 524 class: a blocking status read must not sit on the event loop.
    import inspect
    from api.routers import desk_zoom_webhook as wh
    assert not inspect.iscoroutinefunction(wh.creative_cover_retry_status)
