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
              "TSDR_LESSONS_YT_PER_DAY", "DISCORD_GUILD_ID", "TSDR_LESSONS_GUILD_ID",
              "TSDR_LESSONS_THREADS_ENABLED"):
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
    assert tl.get_state(f"backfill_done:{TSDR}") == "2026-01-01"
    assert tl.get_lesson("x") is None          # 2025 never recorded
    # the next tick only asks for what came after the newest id
    tl.scan_channel(TSDR)
    last = fake.calls[-1]
    assert last[2]["after"] == str(max(int(m["id"]) for m in newest))
    assert not [c for c in fake.calls[-1:] if "before" in c[2]]

    # moving the start date earlier reopens the backfill where it stopped
    monkeypatch.setenv("TSDR_LESSONS_SINCE", "2020-01-01")
    again = tl.scan_channel(TSDR)
    assert again["added"] == 1 and tl.get_lesson("x") is not None
    befores = [c[2]["before"] for c in fake.calls if "before" in c[2]]
    assert befores[-1] == str(min(int(m["id"]) for m in older))   # resumed, not restarted
    assert tl.get_state(f"backfill_done:{TSDR}") == "2020-01-01"


def test_the_legacy_done_marker_reopens_only_for_an_earlier_date(monkeypatch):
    tl.set_state(f"backfill_done:{TSDR}", "1")
    tl.set_state(f"backfill:{TSDR}", sf(2026, 1, 2))
    tl.set_state(f"cursor:{TSDR}", sf(2026, 9, 1))
    fake = FakeDiscord({("GET", f"/channels/{TSDR}/messages"): lambda p, b: []})
    monkeypatch.setattr(tl, "_discord", fake)
    tl.scan_channel(TSDR)
    assert not [c for c in fake.calls if "before" in c[2]]   # 2026 floor: still done
    monkeypatch.setenv("TSDR_LESSONS_SINCE", "2018-06-01")
    tl.scan_channel(TSDR)
    assert [c for c in fake.calls if "before" in c[2]]       # earlier floor: reopened


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


def test_overwrites_never_copy_bits_beyond_view():
    attach, mention_all = 1 << 15, 1 << 17
    src = [{"id": "role-vip", "type": 0, "allow": str(tl._VIEW_CHANNEL | attach),
            "deny": str(mention_all)}]
    vip = {o["id"]: o for o in tl._read_only_overwrites(src, "bot", GUILD)}["role-vip"]
    assert int(vip["allow"]) == tl._VIEW_CHANNEL
    assert int(vip["deny"]) == tl._POSTING_BITS


def test_channel_creation_steps_down_when_discord_refuses(monkeypatch):
    attempts = []

    def create(p, b):
        if b["type"] == 4:
            return {"id": "cat9"}
        attempts.append(b["permission_overwrites"])
        if len(attempts) < 3:
            raise tl.DiscordError(403, '{"message": "Missing Permissions", "code": 50013}')
        return {"id": "ch9"}

    fake = FakeDiscord({
        ("GET", f"/guilds/{GUILD}/channels"): [{"id": "cat9", "type": 4, "name": "EDUCATION"}],
        ("POST", f"/guilds/{GUILD}/channels"): create,
        ("GET", "/users/@me"): {"id": "bot"},
        ("GET", f"/channels/{TSDR}"): {"permission_overwrites": []},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.ensure_lesson_channel() == "ch9"
    assert len(attempts) == 3
    everyone = next(o for o in attempts[-1] if o["id"] == GUILD)
    assert int(everyone["deny"]) == tl._SEND_MESSAGES


def test_channel_creation_gives_up_after_the_last_step(monkeypatch):
    def create(p, b):
        raise tl.DiscordError(403, "Missing Permissions")

    monkeypatch.setattr(tl, "_discord", FakeDiscord({
        ("GET", f"/guilds/{GUILD}/channels"): [{"id": "cat9", "type": 4, "name": "EDUCATION"}],
        ("POST", f"/guilds/{GUILD}/channels"): create,
        ("GET", "/users/@me"): {"id": "bot"},
        ("GET", f"/channels/{TSDR}"): {"permission_overwrites": []},
    }))
    with pytest.raises(tl.DiscordError):
        tl.ensure_lesson_channel()
    assert tl.get_state("lesson_channel_id") is None


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


# ── section threads ──────────────────────────────────────────────────────────

def test_section_follows_the_first_known_tag():
    assert tl.section_for({"tags": json.dumps(["entries", "risk"])}) == "setups"
    assert tl.section_for({"tags": ["exits"]}) == "management"
    assert tl.section_for({"tags": ["made-up", "market"]}) == "market"
    assert tl.section_for({"tags": ["psychology"]}) == "mindset"
    assert tl.section_for({"tags": None}) == tl._DEFAULT_SECTION
    # every tag the model may choose lands in a real section
    assert set(tl._TAG_SECTION) == set(tl.TAGS)
    assert set(tl._TAG_SECTION.values()) <= set(tl._SECTION_KEYS)


def test_an_old_database_gains_the_new_columns(tmp_path, monkeypatch):
    import sqlite3
    path = tmp_path / "old.db"
    monkeypatch.setenv("TSDR_LESSONS_DB_PATH", str(path))
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE tsdr_lessons (attachment_id TEXT PRIMARY KEY, message_id TEXT "
                 "NOT NULL, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, posted_at "
                 "INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', attempts INTEGER NOT "
                 "NULL DEFAULT 0, yt_attempts INTEGER NOT NULL DEFAULT 0, discord_post_id TEXT, "
                 "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")
    conn.commit()
    conn.close()
    import contextlib
    with contextlib.closing(tl._connect()) as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(tsdr_lessons)")}
    assert {"section", "post_channel_id", "forward_post_id"} <= cols
    tl._connect().close()          # a second open must not try to add them again


def _thread_routes(lock_ok=True):
    """The lesson channel and a counter-backed header + thread per section."""
    made = []

    def header(p, b):
        made.append(("header", b["embeds"][0]["title"]))
        return {"id": f"h{len(made)}"}

    def thread_from(n):
        def make(p, b):
            made.append(("thread", b["name"]))
            return {"id": f"t-{b['name']}"}
        return make

    def lock(p, b):
        if not lock_ok:
            raise tl.DiscordError(403, "Missing Permissions")
        return {}

    routes = {("POST", "/channels/lessons/messages"): header}
    for i in range(1, 9):
        routes[("POST", f"/channels/lessons/messages/h{i}/threads")] = thread_from(i)
    for _, name, _ in tl.SECTIONS:
        routes[("PATCH", f"/channels/t-{name}")] = lock
    return routes, made


def test_the_four_section_threads_are_made_once_in_order(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    routes, made = _thread_routes()
    fake = FakeDiscord(routes)
    monkeypatch.setattr(tl, "_discord", fake)
    threads = tl.ensure_section_threads()
    names = [n for _, n, _ in tl.SECTIONS]
    assert [n for kind, n in made if kind == "header"] == names
    assert [n for kind, n in made if kind == "thread"] == names
    assert threads == {k: f"t-{n}" for k, n, _ in tl.SECTIONS}
    locks = [c for c in fake.calls if c[0] == "PATCH"]
    assert len(locks) == 4 and all(c[3] == {"locked": True} for c in locks)
    n = len(fake.calls)
    assert tl.ensure_section_threads() == threads and len(fake.calls) == n   # remembered


def test_a_bot_that_cannot_lock_still_gets_its_threads(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    routes, _ = _thread_routes(lock_ok=False)
    monkeypatch.setattr(tl, "_discord", FakeDiscord(routes))
    assert len(tl.ensure_section_threads()) == 4


def _seed_threads():
    for key, name, _ in tl.SECTIONS:
        tl.set_state(tl._thread_state_key(key), f"t-{key}")


def test_with_threads_on_a_lesson_is_the_recap_then_the_forwarded_video(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    m = msg(sf(2026, 10, 15), attachments=[video("th1")], content="EMA lesson")
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m)                      # RECAP tags: entries, setups
    _seed_threads()
    sent = []
    fake.routes[("POST", "/channels/t-setups/messages")] = \
        lambda p, b: sent.append(b) or {"id": f"m{len(sent)}"}
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    recap, forward = sent
    assert recap["embeds"][0]["title"] == RECAP["title"]
    assert forward == {"message_reference": {"type": 1, "message_id": m["id"],
                                             "channel_id": TSDR, "guild_id": GUILD}}
    assert fake.posts("/channels/lessons/messages") == []    # nothing in the channel itself
    row = tl.get_lesson("th1")
    assert (row["section"], row["post_channel_id"], row["discord_post_id"],
            row["forward_post_id"]) == ("setups", "t-setups", "m1", "m2")


def test_a_failed_forward_keeps_the_recap(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    m = msg(sf(2026, 10, 15), attachments=[video("th2")])
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m)
    _seed_threads()

    def post(p, b):
        if "message_reference" in b:
            raise tl.DiscordError(500, "boom")
        return {"id": "r1"}

    fake.routes[("POST", "/channels/t-setups/messages")] = post
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    row = tl.get_lesson("th2")
    assert row["status"] == "posted" and row["discord_post_id"] == "r1"
    assert row["forward_post_id"] == ""


def test_an_archived_thread_is_reopened_and_the_post_retried(monkeypatch):
    _seed_threads()
    tries = []

    def post(p, b):
        tries.append(b)
        if len(tries) == 1:
            raise tl.DiscordError(400, '{"code": 50083, "message": "Thread is archived"}')
        return {"id": f"p{len(tries)}"}

    fake = FakeDiscord({("POST", "/channels/t-market/messages"): post,
                        ("PATCH", "/channels/t-market"): {}})
    monkeypatch.setattr(tl, "_discord", fake)
    lesson = {"attachment_id": "a", "message_id": "9", "channel_id": TSDR,
              "tags": ["market"], "title": "T", "recap": "A. B. C.",
              "posted_at": int(datetime(2026, 5, 1, tzinfo=timezone.utc).timestamp())}
    placed = tl.post_to_section(lesson, "https://x")
    assert placed["post_id"] == "p2" and placed["section"] == "market"
    assert [c[3] for c in fake.calls if c[0] == "PATCH"] == [{"archived": False}]


def test_a_deleted_thread_is_made_again(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    _seed_threads()
    routes, made = _thread_routes()

    def gone(p, b):
        raise tl.DiscordError(404, "Unknown Channel")

    routes[("POST", "/channels/t-mindset/messages")] = gone
    routes[("POST", "/channels/t-Mindset & Process/messages")] = {"id": "new1"}
    monkeypatch.setattr(tl, "_discord", FakeDiscord(routes))
    lesson = {"attachment_id": "a", "message_id": "9", "channel_id": TSDR,
              "tags": ["review"], "title": "T", "recap": "A. B. C.",
              "posted_at": int(datetime(2026, 5, 1, tzinfo=timezone.utc).timestamp())}
    placed = tl.post_to_section(lesson, "https://x")
    assert placed["thread"] == "t-Mindset & Process" and placed["post_id"] == "new1"
    assert made == [("header", "Mindset & Process"), ("thread", "Mindset & Process")]


def _old_post(aid, day, tags, post_id):
    m = msg(sf(2026, 3, day), attachments=[video(aid)])
    tl.record_message(m, TSDR)
    tl._update(aid, status="posted", title=f"Lesson {aid}", recap="A. B. C. D.",
               tags=json.dumps(tags), discord_post_id=post_id)
    return m


def test_regroup_moves_old_posts_oldest_first_and_deletes_the_originals(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    _seed_threads()
    _old_post("late", 20, ["risk"], "op2")
    _old_post("early", 5, ["risk"], "op1")
    _old_post("gone", 10, ["market"], "op3")              # Patrick deleted this one
    sent = []

    def old(post_id):
        def get(p, b):
            if post_id == "op3":
                raise tl.DiscordError(404, "Unknown Message")
            return {"id": post_id}
        return get

    routes = {("POST", "/channels/t-management/messages"):
              lambda p, b: sent.append(b) or {"id": f"n{len(sent)}"}}
    for pid in ("op1", "op2", "op3"):
        routes[("GET", f"/channels/lessons/messages/{pid}")] = old(pid)
        routes[("DELETE", f"/channels/lessons/messages/{pid}")] = None
    fake = FakeDiscord(routes)
    monkeypatch.setattr(tl, "_discord", fake)
    out = tl.run_regroup(deadline=9e12)
    assert out == {"moved": 2, "removed": 1, "errors": 0}
    titles = [b["embeds"][0]["title"] for b in sent if "embeds" in b]
    assert titles == ["Lesson early", "Lesson late"]       # oldest first
    deleted = [c[1] for c in fake.calls if c[0] == "DELETE"]
    assert deleted == ["/channels/lessons/messages/op1", "/channels/lessons/messages/op2"]
    assert tl.get_lesson("early")["post_channel_id"] == "t-management"
    assert tl.get_lesson("gone")["section"] == tl.REMOVED
    assert tl.run_regroup(deadline=9e12) == {"moved": 0, "removed": 0, "errors": 0}


def test_regroup_never_deletes_a_post_it_could_not_replace(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    _seed_threads()
    _old_post("keep", 5, ["market"], "op1")

    def refuse(p, b):
        raise tl.DiscordError(500, "boom")

    fake = FakeDiscord({("GET", "/channels/lessons/messages/op1"): {"id": "op1"},
                        ("POST", "/channels/t-market/messages"): refuse})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_regroup(deadline=9e12)["errors"] == 1
    assert not [c for c in fake.calls if c[0] == "DELETE"]
    assert tl.get_lesson("keep")["section"] is None         # tried again next tick


def test_youtube_edits_the_post_where_it_now_lives(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("yt9")])
    tl.record_message(m, TSDR)
    tl._update("yt9", status="posted", title="Lesson", recap="A. B. C. D.",
               discord_post_id="lp9", post_channel_id="t-risk", section="management")
    fake = FakeDiscord({
        ("GET", f"/channels/{TSDR}/messages/{m['id']}"): m,
        ("GET", "/channels/t-risk/messages/lp9"): {"id": "lp9"},
        ("PATCH", "/channels/t-risk/messages/lp9"): {"id": "lp9"},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    monkeypatch.setattr(tl, "download", lambda url, dest: dest.write_bytes(b"x") or 1)

    class YT:
        def upload(self, path, title, description, privacy):
            return "YTID9"

    from api.services import education_service as es
    monkeypatch.setattr(es, "register_category_if_missing", lambda *a, **k: None)
    monkeypatch.setattr(es, "create_video", lambda p: {"id": 5})
    monkeypatch.setattr(es, "set_video_insights", lambda vid, **kw: None)
    monkeypatch.setattr(es, "set_video_tags", lambda vid, tags: None)
    import api.services.youtube_client as ytc
    monkeypatch.setattr(ytc, "YouTubeClient", YT)
    assert tl.run_youtube(deadline=9e12)["uploaded"] == 1
    assert [c[1] for c in fake.calls if c[0] == "PATCH"] == ["/channels/t-risk/messages/lp9"]


def test_regroup_only_runs_with_the_threads_flag(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_ENABLED", "1")
    monkeypatch.setattr(tl, "scan_channel", lambda ch: {})
    monkeypatch.setattr(tl, "run_lessons", lambda **k: {})
    calls = []
    monkeypatch.setattr(tl, "run_regroup", lambda **k: calls.append(1) or {})
    assert "regroup" not in tl.tick() and calls == []
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    assert "regroup" in tl.tick() and calls == [1]


# ── video refill ─────────────────────────────────────────────────────────────

def _threaded_without_video(aid, day, youtube_id="yt-1"):
    m = msg(sf(2026, 3, day), attachments=[video(aid)])
    tl.record_message(m, TSDR)
    tl._update(aid, status="posted", title=f"Lesson {aid}", recap="A. B. C. D.",
               tags=json.dumps(["market"]), discord_post_id=f"old-{aid}",
               post_channel_id="t-market", section="market", forward_post_id="",
               youtube_id=youtube_id)
    return m


def _refused_forward(sent):
    def post(p, b):
        sent.append(b)
        if "message_reference" in b:
            raise tl.DiscordError(429, '{"message": "Maximum amount of forwarded '
                                       'attachment bytes reached", "retry_after": 300.0}')
        return {"id": f"n{len(sent)}"}
    return post


def test_a_missing_video_is_posted_again_and_the_old_recap_removed(monkeypatch):
    _seed_threads()
    _threaded_without_video("nv1", 5)
    sent = []
    fake = FakeDiscord({
        ("GET", "/channels/t-market/messages/old-nv1"): {"id": "old-nv1"},
        ("POST", "/channels/t-market/messages"):
            lambda p, b: sent.append(b) or {"id": f"n{len(sent)}"},
        ("DELETE", "/channels/t-market/messages/old-nv1"): None,
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_video_refill(deadline=9e12) == {"refilled": 1, "waiting": 0, "errors": 0}
    assert "embeds" in sent[0] and "message_reference" in sent[1]   # recap, then video
    row = tl.get_lesson("nv1")
    assert (row["discord_post_id"], row["forward_post_id"]) == ("n1", "n2")
    assert [c[1] for c in fake.calls if c[0] == "DELETE"] == ["/channels/t-market/messages/old-nv1"]
    assert tl.run_video_refill(deadline=9e12)["refilled"] == 0       # done, not repeated


def test_a_refused_forward_falls_back_to_the_youtube_copy(monkeypatch):
    _seed_threads()
    _threaded_without_video("nv2", 5, youtube_id="abc123")
    sent = []
    fake = FakeDiscord({
        ("GET", "/channels/t-market/messages/old-nv2"): {"id": "old-nv2"},
        ("POST", "/channels/t-market/messages"): _refused_forward(sent),
        ("DELETE", "/channels/t-market/messages/old-nv2"): None,
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_video_refill(deadline=9e12) == {"refilled": 1, "waiting": 0, "errors": 0}
    assert "embeds" in sent[0] and "message_reference" in sent[1]
    assert sent[2] == {"content": "https://youtu.be/abc123"}          # the video, in place
    assert tl.get_lesson("nv2")["forward_post_id"] == "n3"
    assert [c[1] for c in fake.calls if c[0] == "DELETE"] == ["/channels/t-market/messages/old-nv2"]


def test_a_lesson_without_a_youtube_copy_is_not_retried(monkeypatch):
    # Retrying only the forward posted and deleted a recap every tick for a
    # file Discord never forwarded. Without a YouTube copy, nothing is touched.
    _seed_threads()
    _threaded_without_video("nv3", 6, youtube_id=None)
    fake = FakeDiscord({})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_video_refill(deadline=9e12) == {"refilled": 0, "waiting": 0, "errors": 0}
    assert fake.calls == []


def test_lessons_missing_their_video_go_first_to_youtube(monkeypatch):
    _seed_threads()
    _threaded_without_video("first", 9, youtube_id=None)
    for i, aid in enumerate(("older1", "older2")):
        tl.record_message(msg(sf(2026, 2, 1 + i), attachments=[video(aid)]), TSDR)
        tl._update(aid, status="posted", title=aid, recap="A. B.", section="market",
                   post_channel_id="t-market", discord_post_id=f"p-{aid}",
                   forward_post_id=f"f-{aid}")
    order = []
    monkeypatch.setattr(tl, "upload_lesson", lambda row: order.append(row["attachment_id"]) or "uploaded")
    monkeypatch.setenv("TSDR_LESSONS_YT_PER_DAY", "1")
    tl.run_youtube(deadline=9e12)
    assert order == ["first"]


def test_a_refused_forward_without_youtube_leaves_the_recap(monkeypatch):
    _seed_threads()
    sent = []
    fake = FakeDiscord({("POST", "/channels/t-market/messages"): _refused_forward(sent)})
    monkeypatch.setattr(tl, "_discord", fake)
    lesson = {"attachment_id": "z", "message_id": "1", "channel_id": TSDR, "title": "T",
              "posted_at": 1772377200,
              "recap": "A. B.", "tags": json.dumps(["market"])}
    placed = tl.post_to_section(lesson, "https://discord.com/x")
    assert placed["post_id"] == "n1" and placed["forward_id"] == ""
    assert len(sent) == 2                                              # no YouTube post


def test_refill_leaves_a_deleted_lesson_deleted(monkeypatch):
    _seed_threads()
    _threaded_without_video("nv4", 5)

    def gone(p, b):
        raise tl.DiscordError(404, "Unknown Message")

    fake = FakeDiscord({("GET", "/channels/t-market/messages/old-nv4"): gone})
    monkeypatch.setattr(tl, "_discord", fake)
    tl.run_video_refill(deadline=9e12)
    assert tl.get_lesson("nv4")["section"] == tl.REMOVED
    assert not [c for c in fake.calls if c[0] == "POST"]
