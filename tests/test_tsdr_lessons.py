"""#tsdr video lessons: scan, channel setup, recap/post, YouTube stage, gating.
Discord, ffmpeg/Whisper, Claude and YouTube are all stubbed."""
import json
from datetime import datetime, timezone

import pytest

from api.services import tsdr_lessons as tl

PATRICK = tl.PATRICK_USER_ID
TSDR = tl.TSDR_CHANNEL_ID
GUILD = tl.DEFAULT_GUILD_ID


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_DB_PATH", str(tmp_path / "lessons.db"))
    for k in ("TSDR_LESSONS_ENABLED", "TSDR_LESSONS_YOUTUBE_ENABLED", "TSDR_LESSONS_CHANNEL_ID",
              "TSDR_LESSONS_SOURCE_CHANNELS", "TSDR_LESSONS_AUTHOR_IDS", "TSDR_LESSONS_SINCE",
              "TSDR_LESSONS_YT_PER_DAY", "DISCORD_GUILD_ID", "TSDR_LESSONS_GUILD_ID"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(tl, "_sleep", lambda s: None)


def sf(year, month, day, n=0):
    """A message id at that date."""
    return str(tl.snowflake_for(datetime(year, month, day, 15, tzinfo=timezone.utc)) + n)


def msg(mid, *, author=PATRICK, attachments=None, mtype=0, content="", **extra):
    return {"id": mid, "type": mtype, "content": content, "author": {"id": author},
            "attachments": attachments or [], **extra}


def video(aid="a1", name="clip.mp4", ctype="video/mp4"):
    return {"id": aid, "filename": name, "content_type": ctype, "size": 1000,
            "url": f"https://cdn.discordapp.com/{aid}/{name}"}


class FakeDiscord:
    def __init__(self, routes=None):
        self.routes = routes or {}
        self.calls = []

    def __call__(self, method, path, *, params=None, body=None):
        self.calls.append((method, path, params, body))
        key = (method, path)
        if key not in self.routes:
            raise AssertionError(f"unexpected Discord call {method} {path}")
        r = self.routes[key]
        return r(params, body) if callable(r) else r

    def posts(self, path):
        return [c[3] for c in self.calls if c[0] == "POST" and c[1] == path]


# ── recording ────────────────────────────────────────────────────────────────

def test_records_only_patricks_videos_from_2026():
    assert tl.record_message(msg(sf(2026, 3, 1), attachments=[video("v1")]), TSDR) == 1
    assert tl.record_message(msg(sf(2026, 3, 1, 1), author="999",
                                 attachments=[video("v2")]), TSDR) == 0
    assert tl.record_message(msg(sf(2025, 12, 30), attachments=[video("v3")]), TSDR) == 0
    assert tl.record_message(msg(sf(2026, 3, 2), attachments=[
        {"id": "img", "filename": "chart.png", "content_type": "image/png"}]), TSDR) == 0
    assert tl.record_message(msg(sf(2026, 3, 3), webhook_id="1",
                                 attachments=[video("v4")]), TSDR) == 0
    # a .mov with no content type still counts; a repeat is ignored
    assert tl.record_message(msg(sf(2026, 3, 4), attachments=[video("v5", "a.MOV", "")]), TSDR) == 1
    assert tl.record_message(msg(sf(2026, 3, 1), attachments=[video("v1")]), TSDR) == 0
    assert tl.status_counts()["new"] == 2


def test_reply_is_flagged_but_member_text_is_not_stored():
    m = msg(sf(2026, 5, 5), mtype=19, content="here you go", attachments=[video("r1")],
            referenced_message={"content": "SECRET member question", "author": {"id": "5"}})
    tl.record_message(m, TSDR)
    row = tl.get_lesson("r1")
    assert row["is_reply"] == 1 and row["caption"] == "here you go"
    assert "SECRET" not in repr(row)


def test_scan_initialises_then_backfills_to_since(monkeypatch):
    newest = [msg(sf(2026, 9, 1, i), attachments=[video(f"n{i}")]) for i in range(3)]
    older = [msg(sf(2026, 2, 1, i), attachments=[video(f"o{i}")]) for i in range(2)]
    ancient = [msg(sf(2025, 11, 1), attachments=[video("x")])]

    def page(params, body):
        if "before" in params:
            b = int(params["before"])
            if b > int(sf(2026, 3, 1)):
                return older
            return ancient
        if "after" in params:
            return []
        return newest

    fake = FakeDiscord({("GET", f"/channels/{TSDR}/messages"): page})
    monkeypatch.setattr(tl, "_discord", fake)
    first = tl.scan_channel(TSDR)
    assert first["added"] == 5
    assert tl.get_state(f"backfill_done:{TSDR}") == "1"
    assert tl.get_lesson("x") is None          # 2025 never recorded
    # the next tick only asks for what came after the newest id
    tl.scan_channel(TSDR)
    last = fake.calls[-1]
    assert last[2]["after"] == str(max(int(m["id"]) for m in newest))


# ── the lesson channel ───────────────────────────────────────────────────────

def test_overwrites_copy_audience_and_remove_posting():
    src = [{"id": GUILD, "type": 0, "allow": "0", "deny": str(tl._VIEW_CHANNEL)},
           {"id": "role-member", "type": 0,
            "allow": str(tl._VIEW_CHANNEL | tl._SEND_MESSAGES), "deny": "0"}]
    out = {o["id"]: o for o in tl._read_only_overwrites(src, "bot", GUILD)}
    member = out["role-member"]
    assert int(member["allow"]) & tl._VIEW_CHANNEL
    assert not int(member["allow"]) & tl._SEND_MESSAGES
    assert int(member["deny"]) & tl._SEND_MESSAGES
    assert int(out[GUILD]["deny"]) & tl._VIEW_CHANNEL    # gating kept
    assert int(out["bot"]["allow"]) & tl._SEND_MESSAGES


def test_creates_category_and_channel_once(monkeypatch):
    fake = FakeDiscord({
        ("GET", f"/guilds/{GUILD}/channels"): [{"id": "1", "type": 0, "name": "video-lessons"}],
        ("POST", f"/guilds/{GUILD}/channels"):
            lambda p, b: {"id": "cat9" if b["type"] == 4 else "ch9"},
        ("GET", "/users/@me"): {"id": "bot"},
        ("GET", f"/channels/{TSDR}"): {"permission_overwrites": []},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.ensure_lesson_channel() == "ch9"
    cat, ch = fake.posts(f"/guilds/{GUILD}/channels")
    assert cat == {"name": "EDUCATION", "type": 4}
    assert ch["parent_id"] == "cat9" and ch["name"] == "video-lessons"
    # remembered: no further Discord calls
    n = len(fake.calls)
    assert tl.ensure_lesson_channel() == "ch9" and len(fake.calls) == n


def test_reuses_existing_channel_by_name(monkeypatch):
    fake = FakeDiscord({("GET", f"/guilds/{GUILD}/channels"): [
        {"id": "c1", "type": 4, "name": "Education"},
        {"id": "ch1", "type": 0, "name": "video-lessons", "parent_id": "c1"}]})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.ensure_lesson_channel() == "ch1"


def test_channel_override_env(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "fixed")
    monkeypatch.setattr(tl, "_discord", FakeDiscord())
    assert tl.ensure_lesson_channel() == "fixed"


# ── recap + post ─────────────────────────────────────────────────────────────

RECAP = {"is_lesson": True, "title": "Wait for the reclaim of the 21 EMA",
         "recap": "One. Two. Three. Four.", "question": "",
         "takeaway": "Let the stock prove itself first.", "tickers": ["NVDA", "AMD"],
         "tags": ["entries", "setups"]}


def _pipeline(monkeypatch, message, *, transcript="word " * 50, recap=None, seen=None):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    fake = FakeDiscord({
        ("GET", f"/channels/{TSDR}/messages/{message['id']}"): message,
        ("POST", "/channels/lessons/messages"): {"id": "post1"},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    monkeypatch.setattr(tl, "download", lambda url, dest: dest.write_bytes(b"x") or 1)
    monkeypatch.setattr(tl, "transcribe", lambda v, w: (transcript, 125.0))

    def gen(**kw):
        if seen is not None:
            seen.update(kw)
        if isinstance(recap, Exception):
            raise recap
        return dict(recap or RECAP)

    monkeypatch.setattr(tl, "generate_recap", gen)
    return fake


def test_posts_embed_with_jump_link(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("a1")], content="EMA lesson")
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m)
    out = tl.run_lessons(limit=3, deadline=9e12)
    assert out["posted"] == 1
    embed = fake.posts("/channels/lessons/messages")[0]["embeds"][0]
    link = f"https://discord.com/channels/{GUILD}/{TSDR}/{m['id']}"
    assert embed["url"] == link and link in embed["description"]
    assert embed["title"] == RECAP["title"] and "2:05" in embed["footer"]["text"]
    assert "**Key takeaway:** Let the stock prove itself first." in embed["description"]
    body = fake.posts("/channels/lessons/messages")[0]
    assert body["content"] == "Entries · Setups · $NVDA $AMD"
    assert body["allowed_mentions"] == {"parse": []}
    row = tl.get_lesson("a1")
    assert row["status"] == "posted" and row["discord_post_id"] == "post1"
    assert json.loads(row["tags"]) == ["entries", "setups"]


def test_clip_that_is_not_a_lesson_is_skipped(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("nl")])
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m, recap={"is_lesson": False})
    assert tl.run_lessons(limit=3, deadline=9e12)["skipped"] == 1
    assert fake.posts("/channels/lessons/messages") == []
    assert tl.get_lesson("nl")["last_error"] == "not a lesson"


def test_reply_question_passed_in_memory_and_only_paraphrase_stored(monkeypatch):
    m = msg(sf(2026, 10, 15), mtype=19, attachments=[video("a2")],
            referenced_message={"content": "<@123> how do you size into a VCP?"})
    tl.record_message(m, TSDR)
    seen = {}
    fake = _pipeline(monkeypatch, m, seen=seen,
                     recap={**RECAP, "question": "A member asked how to scale into a VCP."})
    tl.run_lessons(limit=3, deadline=9e12)
    assert seen["question"] == "how do you size into a VCP?"
    assert "**Question:** A member asked" in fake.posts("/channels/lessons/messages")[0]["embeds"][0]["description"]
    assert "how do you size" not in repr(tl.get_lesson("a2"))


def test_silent_clip_is_skipped(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("a3")])
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m, transcript="")
    assert tl.run_lessons(limit=3, deadline=9e12)["skipped"] == 1
    assert fake.posts("/channels/lessons/messages") == []


def test_deleted_message_is_skipped(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("a4")])
    tl.record_message(m, TSDR)
    _pipeline(monkeypatch, {**m, "attachments": []})
    tl.run_lessons(limit=3, deadline=9e12)
    assert tl.get_lesson("a4")["status"] == "skipped"


def test_failures_retry_then_stop(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("a5")])
    tl.record_message(m, TSDR)
    _pipeline(monkeypatch, m, recap=ValueError("bad reply"))
    for _ in range(tl.MAX_ATTEMPTS):
        tl.run_lessons(limit=3, deadline=9e12)
    row = tl.get_lesson("a5")
    assert row["status"] == "failed" and row["attempts"] == tl.MAX_ATTEMPTS
    assert "bad reply" in row["last_error"]


def test_recent_videos_jump_the_backlog(monkeypatch):
    old = msg(sf(2026, 1, 5), attachments=[video("old")])
    new = msg(str(tl.snowflake_for(datetime.now(timezone.utc))), attachments=[video("new")])
    tl.record_message(old, TSDR)
    tl.record_message(new, TSDR)
    import contextlib
    with contextlib.closing(tl._connect()) as c:
        order = [r[0] for r in c.execute(
            f"SELECT attachment_id FROM tsdr_lessons {tl._queue_order_sql()}")]
    assert order == ["new", "old"]


# ── the model reply ──────────────────────────────────────────────────────────

def test_parse_json_tolerates_fences():
    assert tl._parse_json_object('```json\n{"title": "x"}\n```') == {"title": "x"}
    with pytest.raises(ValueError):
        tl._parse_json_object("no json here")


def test_generate_recap_validates_and_caps(monkeypatch):
    class Block:
        type = "text"
        text = ('{"title": "Cut losers fast", "recap": "' + " ".join(
            f"Sentence {i}." for i in range(8)) + '", "question_needed": false, '
            '"question": "ignored", "is_lesson": true, "takeaway": "Small losses.", '
            '"tickers": ["$nvda", "NVDA", "not a ticker", "BRK.B"], '
            '"tags": ["Risk", "made-up", "risk", "exits"]}')

    class Msg:
        stop_reason = "end_turn"
        content = [Block()]

    sent = {}

    class Client:
        def with_options(self, **kw):
            return self

        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                sent.update(kw)
                return Msg()

    import api.services.engine as engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: Client())
    out = tl.generate_recap(transcript="t", caption="", posted=datetime(2026, 10, 15, tzinfo=timezone.utc))
    assert out["title"] == "Cut losers fast"
    assert len(tl.split_sentences(out["recap"])) == 6
    assert out["question"] == ""
    assert out["tickers"] == ["NVDA", "BRK.B"]
    assert out["tags"] == ["risk", "exits"]
    assert out["takeaway"] == "Small losses."
    assert sent["model"] == "claude-opus-5-5"


# ── YouTube stage ────────────────────────────────────────────────────────────

def test_youtube_title_fits_and_dates():
    row = {"title": "x" * 150, "posted_at": int(datetime(2026, 3, 9, 18, tzinfo=timezone.utc).timestamp())}
    t = tl.youtube_title(row)
    assert len(t) <= 100 and t.endswith("| TSDR 3/9/26")


def _posted_lesson(monkeypatch, aid, *, post_exists=True):
    m = msg(sf(2026, 10, 15), attachments=[video(aid)])
    tl.record_message(m, TSDR)
    tl._update(aid, status="posted", title="Lesson", recap="A. B. C. D.",
               transcript="the words", duration_s=65.0, discord_post_id="lp1",
               tags=json.dumps(["risk"]), tickers=json.dumps(["SPY"]))
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")

    def lesson_post(p, b):
        if not post_exists:
            raise tl.DiscordError(404, "Unknown Message")
        return {"id": "lp1"}

    fake = FakeDiscord({
        ("GET", f"/channels/{TSDR}/messages/{m['id']}"): m,
        ("GET", "/channels/lessons/messages/lp1"): lesson_post,
        ("PATCH", "/channels/lessons/messages/lp1"): {"id": "lp1"},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    monkeypatch.setattr(tl, "download", lambda url, dest: dest.write_bytes(b"x") or 1)
    return fake


def test_deleting_the_lesson_post_keeps_it_off_youtube(monkeypatch):
    _posted_lesson(monkeypatch, "y0", post_exists=False)
    import api.services.youtube_client as ytc

    class YT:
        def upload(self, *a, **k):
            raise AssertionError("must not upload")

    monkeypatch.setattr(ytc, "YouTubeClient", YT)
    assert tl.run_youtube(deadline=9e12)["uploaded"] == 0
    assert tl.get_lesson("y0")["yt_error"] == "lesson post was deleted in Discord"


def test_youtube_stage_uploads_unlisted_and_adds_to_library(monkeypatch):
    fake = _posted_lesson(monkeypatch, "y1")
    uploads = []

    class YT:
        def upload(self, path, title, description, privacy):
            uploads.append(privacy)
            return "YTID1234567"

    from api.services import education_service as es
    made = {}
    monkeypatch.setattr(es, "register_category_if_missing", lambda *a, **k: None)
    monkeypatch.setattr(es, "create_video", lambda p: made.update(p) or {"id": 77})
    monkeypatch.setattr(es, "set_video_insights", lambda vid, **kw: made.update(kw))
    monkeypatch.setattr(es, "set_video_tags", lambda vid, tags: made.update(tags=tags))
    import api.services.youtube_client as ytc
    monkeypatch.setattr(ytc, "YouTubeClient", YT)
    monkeypatch.setenv("TSDR_LESSONS_YT_PER_DAY", "1")
    assert tl.run_youtube(deadline=9e12)["uploaded"] == 1
    assert uploads == ["unlisted"]
    assert made["category"] == "TSDR Lessons" and made["youtube_id"] == "YTID1234567"
    assert made["summary"] == ["A.", "B.", "C.", "D."] and made["duration"] == "1:05"
    assert made["tags"] == ["risk"]
    assert tl.get_lesson("y1")["edu_video_id"] == 77
    patch = [c[3] for c in fake.calls if c[0] == "PATCH"][0]
    assert "[Watch on UCT](https://uctintelligence.com/desk?section=videos&v=YTID1234567)" \
        in patch["embeds"][0]["description"]
    assert patch["content"] == "Risk · $SPY"
    assert tl._yt_quota_left() == 0           # daily cap respected


# ── gating ───────────────────────────────────────────────────────────────────

def test_tick_is_inert_when_off(monkeypatch):
    monkeypatch.setattr(tl, "_discord", FakeDiscord())   # any call would raise
    assert tl.tick()["ran"] is False


def test_tick_never_raises(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_ENABLED", "1")

    def boom(*a, **k):
        raise tl.DiscordError(403, "Missing Access")

    monkeypatch.setattr(tl, "_discord", boom)
    out = tl.tick()
    assert out["ran"] is True and "error" in out[f"scan:{TSDR}"]
