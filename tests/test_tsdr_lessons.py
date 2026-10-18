"""#tsdr video lessons: scan, channel setup, recap/post, YouTube stage, gating.
Discord, ffmpeg/Whisper, Claude and YouTube are all stubbed."""
import json
from datetime import datetime, timezone

import pytest

from api.services import tsdr_lessons as tl

PATRICK = tl.PATRICK_USER_ID
TSDR = tl.TSDR_CHANNEL_ID
GUILD = tl.DEFAULT_GUILD_ID


_REAL_VIDEO_GONE = tl.youtube_video_gone


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_DB_PATH", str(tmp_path / "lessons.db"))
    for k in ("TSDR_LESSONS_ENABLED", "TSDR_LESSONS_YOUTUBE_ENABLED", "TSDR_LESSONS_CHANNEL_ID",
              "TSDR_LESSONS_SOURCE_CHANNELS", "TSDR_LESSONS_AUTHOR_IDS", "TSDR_LESSONS_SINCE",
              "TSDR_LESSONS_YT_PER_DAY", "DISCORD_GUILD_ID", "TSDR_LESSONS_GUILD_ID",
              "TSDR_LESSONS_THREADS_ENABLED", "TSDR_LESSONS_FORUM_ENABLED",
              "TSDR_LESSONS_FORUM_CHANNEL_ID", "TSDR_LESSONS_REVIEWER_IDS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(tl, "_sleep", lambda s: None)
    # no test asks YouTube whether a video exists: present unless a test says otherwise
    monkeypatch.setattr(tl, "youtube_video_gone", lambda vid: False)


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


def _pipeline(monkeypatch, message, *, transcript="word " * 50, recap=None, seen=None,
              channel=TSDR):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    fake = FakeDiscord({
        ("GET", f"/channels/{channel}/messages/{message['id']}"): message,
        ("POST", "/channels/lessons/messages"): {"id": "post1"},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    monkeypatch.setattr(tl, "download", lambda url, dest: dest.write_bytes(b"x") or 1)
    monkeypatch.setattr(tl, "transcribe", lambda v, w: (transcript, 125.0, []))

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


def test_a_bracco_video_is_credited_to_bracco(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_AUTHOR_IDS", f"{PATRICK},{tl.BRACCO_USER_ID}")
    m = msg(sf(2026, 10, 15), author=tl.BRACCO_USER_ID, attachments=[video("b1")])
    tl.record_message(m, tl.BRACCO_CHANNEL_ID)
    seen = {}
    fake = _pipeline(monkeypatch, m, seen=seen, channel=tl.BRACCO_CHANNEL_ID)
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert seen["speaker"] == "Bracco"
    embed = fake.posts("/channels/lessons/messages")[0]["embeds"][0]
    assert embed["footer"]["text"].startswith("From #bracco")
    row = {**tl.get_lesson("b1"), **RECAP}
    assert tl.youtube_title(row).endswith("| Bracco 10/15/26")
    assert "(#bracco)" in tl.youtube_description(row)
    patrick = {**row, "author_id": PATRICK, "channel_id": TSDR}
    assert tl.youtube_title(patrick).endswith("| TSDR 10/15/26")
    assert tl.speaker_name(patrick) == "Patrick"


def test_the_recap_prompt_names_the_speaker(monkeypatch):
    class Msg:
        stop_reason = "refusal"
        content = []

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
    with pytest.raises(ValueError):
        tl.generate_recap(transcript="t", caption="", speaker="Bracco",
                          posted=datetime(2026, 10, 15, tzinfo=timezone.utc))
    assert sent["messages"][0]["content"].startswith("SPEAKER: Bracco\n")
    assert "Patrick" not in sent["system"]


def test_a_clip_that_is_not_a_lesson_is_still_posted_as_a_clip(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("nl")], content="look at NVDA here")
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m, recap={"is_lesson": False, "title": "NVDA tape check",
                                            "recap": "A quick look at the NVDA tape.",
                                            "tags": ["market"]})
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    embed = fake.posts("/channels/lessons/messages")[0]["embeds"][0]
    assert embed["title"] == "NVDA tape check"
    row = tl.get_lesson("nl")
    assert json.loads(row["tags"])[0] == tl.CLIP_TAG
    assert tl.section_for(row) == "clips"


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


def test_a_silent_clip_is_posted_without_asking_the_model(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("a3")])
    tl.record_message(m, TSDR)
    seen = {}
    fake = _pipeline(monkeypatch, m, transcript="", seen=seen)
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert seen == {}                                   # no recap call for no words
    embed = fake.posts("/channels/lessons/messages")[0]["embeds"][0]
    assert "no spoken commentary" in embed["description"]
    assert tl.section_for(tl.get_lesson("a3")) == "clips"


def test_clips_skipped_before_are_reopened_once(monkeypatch):
    for aid, why in (("s1", "not a lesson"), ("s2", "no spoken lesson to recap"),
                     ("s3", "message or video was deleted")):
        tl.record_message(msg(sf(2026, 10, 15), attachments=[video(aid)]), TSDR)
        tl._update(aid, status="skipped", last_error=why, attempts=3)
    assert tl.reopen_skipped_clips() == 2
    assert tl.get_lesson("s1")["status"] == "new" and tl.get_lesson("s1")["attempts"] == 0
    assert tl.get_lesson("s3")["status"] == "skipped"
    tl._update("s1", status="skipped", last_error="not a lesson")
    assert tl.reopen_skipped_clips() == 0               # only ever once


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
    assert set(tl._TAG_SECTION) == set(tl.TAGS) | {tl.CLIP_TAG}
    assert tl.section_for({"tags": [tl.CLIP_TAG, "market"]}) == "clips"
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
    for i in range(1, 2 * len(tl.SECTIONS) + 1):
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
    assert len(locks) == len(tl.SECTIONS) and all(c[3] == {"locked": True} for c in locks)
    n = len(fake.calls)
    assert tl.ensure_section_threads() == threads and len(fake.calls) == n   # remembered


def test_a_bot_that_cannot_lock_still_gets_its_threads(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    routes, _ = _thread_routes(lock_ok=False)
    monkeypatch.setattr(tl, "_discord", FakeDiscord(routes))
    assert len(tl.ensure_section_threads()) == len(tl.SECTIONS)


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


# ── YouTube links ────────────────────────────────────────────────────────────

YT = "oZxqCRSpX6s"


def test_youtube_ids_are_found_in_every_link_shape():
    text = (f"Must watch https://youtu.be/{YT}?is=abc and again "
            f"https://www.youtube.com/watch?v={YT}&t=3 plus "
            "https://youtube.com/live/S2kDC6I2FE4?feature=share "
            "https://m.youtube.com/shorts/AbCdEfGhIjK not https://youtu.be/short")
    assert tl.youtube_ids_in(text) == [YT, "S2kDC6I2FE4", "AbCdEfGhIjK"]
    assert tl.youtube_ids_in("no links here") == []


def test_a_youtube_link_is_recorded_once_and_only_for_an_author():
    m1 = msg(sf(2026, 7, 9), content=f"Must watch https://youtu.be/{YT}",
             attachments=[video("f1")])
    m2 = msg(sf(2026, 7, 10), content=f"again https://youtu.be/{YT}")
    member = msg(sf(2026, 7, 11), author="999", content="https://youtu.be/AbCdEfGhIjK")
    assert tl.record_message(m1, TSDR) == 2            # the file and the link
    assert tl.record_message(m2, TSDR) == 0            # the same video, already kept
    assert tl.record_message(member, TSDR) == 0
    row = tl.get_lesson(tl.LINK_PREFIX + YT)
    assert row["message_id"] == m1["id"] and tl.link_video_id(row) == YT
    assert tl.link_video_id(tl.get_lesson("f1")) == ""


def test_a_youtube_link_lesson_is_recapped_from_its_captions_and_shows_the_link(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    m = msg(sf(2026, 7, 9), content=f"Must watch https://youtu.be/{YT}")
    tl.record_message(m, TSDR)
    seen = {}
    fake = _pipeline(monkeypatch, m, seen=seen)
    monkeypatch.setattr(tl, "download", lambda *a: pytest.fail("a link is never downloaded"))
    monkeypatch.setattr(tl, "youtube_transcript", lambda vid: "word " * 60)
    monkeypatch.setattr(tl, "youtube_video_title", lambda vid: "Chat w/ PBA")
    _seed_threads()
    sent = []
    fake.routes[("POST", "/channels/t-setups/messages")] = \
        lambda p, b: sent.append(b) or {"id": f"m{len(sent)}"}
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert seen["transcript"].startswith("word")
    assert "Chat w/ PBA" in seen["caption"]
    recap, video_post = sent
    assert video_post == {"content": f"https://youtu.be/{YT}"}


def test_a_link_without_captions_is_still_posted_under_its_title(monkeypatch):
    m = msg(sf(2026, 7, 9), content=f"https://youtu.be/{YT}")
    tl.record_message(m, TSDR)
    seen = {}
    fake = _pipeline(monkeypatch, m, seen=seen)
    monkeypatch.setattr(tl, "youtube_transcript", lambda vid: "")
    monkeypatch.setattr(tl, "youtube_video_title", lambda vid: "Chat w/ PBA")
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert seen == {}                                   # too few words for a recap call
    embed = fake.posts("/channels/lessons/messages")[0]["embeds"][0]
    assert embed["title"] == "Chat w/ PBA"


def test_a_deleted_link_message_is_skipped(monkeypatch):
    m = msg(sf(2026, 7, 9), content=f"https://youtu.be/{YT}")
    tl.record_message(m, TSDR)
    gone = dict(m, content="edited away")
    _pipeline(monkeypatch, gone)
    assert tl.run_lessons(limit=3, deadline=9e12)["skipped"] == 1


def test_linked_videos_are_never_uploaded_to_youtube_again(monkeypatch):
    tl.record_message(msg(sf(2026, 7, 9), content=f"https://youtu.be/{YT}"), TSDR)
    tl._update(tl.LINK_PREFIX + YT, status="posted", title="T", recap="A. B.",
               section="setups", post_channel_id="t-setups", discord_post_id="p",
               forward_post_id="f")
    order = []
    monkeypatch.setattr(tl, "upload_lesson", lambda row: order.append(row) or "uploaded")
    tl.run_youtube(deadline=9e12)
    assert order == []


def test_the_link_rescan_reopens_each_scanned_channel_once():
    tl.set_state(f"cursor:{TSDR}", "5000")
    tl.set_state(f"backfill:{TSDR}", "10")
    tl._mark_backfill_done(f"backfill_done:{TSDR}")
    assert tl._backfill_done(f"backfill_done:{TSDR}")
    assert tl.rescan_for_links() is True
    assert not tl._backfill_done(f"backfill_done:{TSDR}")
    assert tl.get_state(f"backfill:{TSDR}") == "5001"
    tl._mark_backfill_done(f"backfill_done:{TSDR}")
    assert tl.rescan_for_links() is False               # only ever once
    assert tl._backfill_done(f"backfill_done:{TSDR}")


# ── transcripts sent in for link lessons ─────────────────────────────────────

def _posted_link_clip(vid=YT):
    m = msg(sf(2026, 7, 9), content=f"Must watch https://youtu.be/{vid}")
    tl.record_message(m, TSDR)
    tl._update(tl.LINK_PREFIX + vid, status="posted", title="Chat w/ PBA",
               recap="A short clip.", transcript="", tags=json.dumps(["clip"]),
               section="clips", post_channel_id="t-clips", discord_post_id="old-r",
               forward_post_id="old-v")
    return m


def test_only_posted_links_without_a_transcript_are_listed():
    _posted_link_clip()
    tl.record_message(msg(sf(2026, 7, 9), attachments=[video("file1")]), TSDR)
    assert tl.links_needing_transcript() == [{"video_id": YT, "title": "Chat w/ PBA"}]
    assert tl.store_link_transcript(YT, "word " * 60) == "queued"
    assert tl.links_needing_transcript() == []
    assert tl.store_link_transcript("AbCdEfGhIjK", "word " * 60) == "unknown"
    assert tl.store_link_transcript(YT, "too few words") == "too short"


def test_a_sent_transcript_rewrites_the_clip_as_a_full_lesson(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    m = _posted_link_clip()
    tl.store_link_transcript(YT, "word " * 60)
    seen = {}
    fake = _pipeline(monkeypatch, m, seen=seen)
    monkeypatch.setattr(tl, "youtube_transcript", lambda vid: pytest.fail("captions refetched"))
    monkeypatch.setattr(tl, "youtube_video_title", lambda vid: "Chat w/ PBA")
    _seed_threads()
    deleted, sent = [], []
    for mid in ("old-r", "old-v"):
        fake.routes[("DELETE", f"/channels/t-clips/messages/{mid}")] = \
            lambda p, b, mid=mid: deleted.append(mid) or {}
    fake.routes[("POST", "/channels/t-setups/messages")] = \
        lambda p, b: sent.append(b) or {"id": f"n{len(sent)}"}
    assert tl.run_link_redo(deadline=9e12) == {"requeued": 1, "errors": 0}
    assert deleted == ["old-r", "old-v"]
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert seen["transcript"].startswith("word")
    row = tl.get_lesson(tl.LINK_PREFIX + YT)
    assert (row["section"], row["redo"], row["discord_post_id"]) == ("setups", 0, "n1")
    assert sent[1] == {"content": f"https://youtu.be/{YT}"}


def test_a_failed_take_down_is_retried_and_leaves_the_clip(monkeypatch):
    _posted_link_clip()
    tl.store_link_transcript(YT, "word " * 60)
    fake = FakeDiscord({("DELETE", "/channels/t-clips/messages/old-r"):
                        lambda p, b: (_ for _ in ()).throw(tl.DiscordError(500, "boom"))})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_link_redo(deadline=9e12) == {"requeued": 0, "errors": 1}
    row = tl.get_lesson(tl.LINK_PREFIX + YT)
    assert (row["status"], row["redo"]) == ("posted", 1)


def test_the_transcript_routes_take_the_push_secret_and_nothing_else(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import tsdr_lessons as router_mod
    monkeypatch.setenv("PUSH_SECRET", "")
    blank = FastAPI(); blank.include_router(router_mod.router)
    assert TestClient(blank).get("/api/tsdr-lessons/links-needing-transcript",
                                 headers={"Authorization": "Bearer "}).status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    app = FastAPI()
    app.include_router(router_mod.router)
    client = TestClient(app)
    _posted_link_clip()
    assert client.get("/api/tsdr-lessons/links-needing-transcript").status_code in (401, 403)
    ok = {"Authorization": "Bearer s3cret"}
    assert client.get("/api/tsdr-lessons/links-needing-transcript",
                      headers=ok).json() == {"videos": [{"video_id": YT, "title": "Chat w/ PBA"}]}
    r = client.post("/api/tsdr-lessons/link-transcript", headers=ok,
                    json={"video_id": YT, "transcript": "word " * 60})
    assert r.json() == {"result": "queued"}
    assert client.post("/api/tsdr-lessons/link-transcript", headers=ok,
                       json={"video_id": "AbCdEfGhIjK", "transcript": "w"}).status_code == 404


# ── library v2: level, key moments, duplicates, clips off the shelf ─────────

def test_transcribe_keeps_each_parts_offset(monkeypatch, tmp_path):
    from api.services.journal_two import voice_notes as vn
    monkeypatch.setattr(vn, "probe_duration", lambda p: 650.0)
    monkeypatch.setattr(vn, "split_audio", lambda src, out, duration=None: ["p0", "p1", "p2"])
    monkeypatch.setattr(vn, "transcribe_part", lambda p, i: ["first part", "", "third part"][i])
    text, seconds, segments = tl.transcribe(tmp_path / "v.mp4", tmp_path)
    assert text == "first part third part" and seconds == 650.0
    assert segments == [[0, "first part"], [2 * vn.CHUNK_SECONDS, "third part"]]


def test_key_moments_are_timed_from_part_offsets_then_proportionally():
    # part one is slow speech (100 words in 300 s), part two fast (300 words in
    # 300 s), so a position along the whole transcript and a part-anchored time
    # DISAGREE - which is what makes the part offsets worth keeping
    words_a = " ".join(f"a{i}" for i in range(100))          # part 1: 0-300 s
    words_b = "Here is the entry trigger on NVDA " + " ".join(f"b{i}" for i in range(293))
    transcript = words_a + " " + words_b
    segments = [[0, words_a], [300, words_b]]
    moments = [{"quote": "here is the ENTRY trigger, on NVDA!", "label": "The entry trigger"},
               {"quote": "a50 a51 a52 a53", "label": "Halfway through part one"},
               {"quote": "never said anywhere at all", "label": "Dropped"},
               {"quote": "a1 a2", "label": "Too short to trust"}]
    out = tl.locate_moments(moments, transcript, segments, 600.0)
    assert [m["label"] for m in out] == ["Halfway through part one", "The entry trigger"]
    assert out[0]["t"] == 150 and out[1]["t"] == 300          # sorted, part-anchored
    # no part offsets: the position along the transcript is the time
    out = tl.locate_moments(moments[:2], transcript, [], 1000.0)
    assert out[0]["t"] == 125 and out[1]["t"] == 250
    assert tl.locate_moments(moments, transcript, [], None) == []   # nothing to time with
    assert tl.locate_moments(moments, "", segments, 600.0) == []


def test_fmt_time_and_seek_links():
    assert tl.fmt_time(65) == "1:05" and tl.fmt_time(3725) == "1:02:05" and tl.fmt_time(None) == "0:00"
    assert tl.seek_link({"attachment_id": "a1", "youtube_id": "YT123456789"}, 65) == \
        "https://youtu.be/YT123456789?t=65"
    assert tl.seek_link({"attachment_id": "yt:LINK1234567"}, 9) == "https://youtu.be/LINK1234567?t=9"
    assert tl.seek_link({"attachment_id": "a1"}, 9) == ""


def _recap_client(monkeypatch, payload):
    class Block:
        type = "text"
        text = payload

    class Msg:
        stop_reason = "end_turn"
        content = [Block()]

    class Client:
        def with_options(self, **kw):
            return self

        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                return Msg()

    import api.services.engine as engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: Client())


def test_generate_recap_reads_the_level_and_the_moments(monkeypatch):
    _recap_client(monkeypatch, json.dumps({
        "title": "Cut losers fast", "recap": "One. Two. Three. Four.", "is_lesson": True,
        "takeaway": "Small losses.", "tickers": [], "tags": ["risk"], "level": "Advanced ",
        "moments": [{"quote": "cut it right here", "label": "The stop is hit."},
                    "junk", {"quote": "", "label": "no quote"},
                    {"quote": "second moment words", "label": "Second"},
                    {"quote": "third moment words", "label": "Third"},
                    {"quote": "fourth is one too many", "label": "Fourth"}]}))
    out = tl.generate_recap(transcript="t", caption="", posted=datetime(2026, 10, 15, tzinfo=timezone.utc))
    assert out["level"] == "advanced"
    assert [m["label"] for m in out["moments"]] == ["The stop is hit", "Second", "Third"]
    assert "**" not in tl._SYS and "level" in tl._SYS and "moments" in tl._SYS
    _recap_client(monkeypatch, json.dumps({
        "title": "T", "recap": "One. Two. Three. Four.", "is_lesson": True, "level": "expert"}))
    out = tl.generate_recap(transcript="t", caption="", posted=datetime(2026, 10, 15, tzinfo=timezone.utc))
    assert out["level"] == "intermediate" and out["moments"] == []


def test_a_lesson_stores_its_level_and_timed_moments_and_shows_them(monkeypatch):
    transcript = "intro words " * 20 + "now watch the entry trigger on NVDA " + "more words " * 20
    m = msg(sf(2026, 10, 15), attachments=[video("km")])
    tl.record_message(m, TSDR)
    recap = {**RECAP, "level": "beginner",
             "moments": [{"quote": "now watch the entry trigger on NVDA", "label": "The entry trigger"}]}
    fake = _pipeline(monkeypatch, m, transcript=transcript, recap=recap)
    monkeypatch.setattr(tl, "transcribe", lambda v, w: (transcript, 100.0, [[0, transcript]]))
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    row = tl.get_lesson("km")
    assert row["level"] == "beginner"
    moments = json.loads(row["moments"])
    assert len(moments) == 1 and moments[0]["label"] == "The entry trigger"
    assert 45 <= moments[0]["t"] <= 55                     # about halfway through 100 s
    assert json.loads(row["segments"]) == [[0, transcript]]
    desc = fake.posts("/channels/lessons/messages")[0]["embeds"][0]["description"]
    stamp = tl.fmt_time(moments[0]["t"])
    assert f"**Key moments**\n`{stamp}` The entry trigger" in desc       # no video copy: time only
    with_copy = {**row, "youtube_id": "YTID1234567"}
    assert f"[`{stamp}`](https://youtu.be/YTID1234567?t={moments[0]['t']}) The entry trigger" \
        in tl.build_embed(with_copy, "https://x")["description"]
    assert f"Key moments:\n{stamp} The entry trigger" in tl.youtube_description(row)


def test_a_repeat_of_an_earlier_video_is_recorded_and_not_posted(monkeypatch):
    talk = " ".join(f"word{i} " for i in range(80))
    first = msg(sf(2026, 10, 14), attachments=[video("d1")])
    tl.record_message(first, TSDR)
    _pipeline(monkeypatch, first, transcript=talk)
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    again = msg(sf(2026, 10, 15), attachments=[video("d2")])
    tl.record_message(again, TSDR)
    fake = _pipeline(monkeypatch, again, transcript=talk + " one extra sentence here.")
    out = tl.run_lessons(limit=3, deadline=9e12)
    assert out == {"posted": 0, "skipped": 0, "duplicate": 1, "errors": 0}
    row = tl.get_lesson("d2")
    assert row["status"] == "duplicate" and row["duplicate_of"] == "d1"
    assert fake.posts("/channels/lessons/messages") == []
    # the same talk from the OTHER speaker is their own lesson
    monkeypatch.setenv("TSDR_LESSONS_AUTHOR_IDS", f"{PATRICK},{tl.BRACCO_USER_ID}")
    theirs = msg(sf(2026, 10, 16), author=tl.BRACCO_USER_ID, attachments=[video("d3")])
    tl.record_message(theirs, tl.BRACCO_CHANNEL_ID)
    _pipeline(monkeypatch, theirs, transcript=talk, channel=tl.BRACCO_CHANNEL_ID)
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    # a different talk by the first speaker is not a duplicate
    assert tl.find_duplicate(" ".join(f"other{i}" for i in range(80)), PATRICK, "x") is None
    assert tl.find_duplicate("too short", PATRICK, "x") is None


def test_clips_never_reach_the_shelf_and_existing_ones_come_off_once(monkeypatch):
    _posted_lesson(monkeypatch, "c1")
    tl._update("c1", section="clips", tags=json.dumps(["clip"]), edu_video_id=501)
    _posted_lesson(monkeypatch, "l1")
    tl._update("l1", section="setups", edu_video_id=502)
    tl._update("c1", youtube_id="YTCLIP00001")
    tl._update("l1", youtube_id="YTLESSON001")
    from api.services import education_service as es
    gone = []
    monkeypatch.setattr(es, "delete_video", lambda vid: gone.append(vid) or True)
    assert tl.remove_clips_from_library() == 1 and gone == [501]
    assert tl.get_lesson("c1")["edu_video_id"] is None
    assert tl.get_lesson("l1")["edu_video_id"] == 502          # lessons stay
    assert tl.remove_clips_from_library() == 0 and gone == [501]   # once
    # the upload stage skips clips
    tl._update("c1", youtube_id=None)
    tl._update("l1", youtube_id=None)
    order = []
    monkeypatch.setattr(tl, "upload_lesson", lambda row: order.append(row["attachment_id"]) or "uploaded")
    tl.run_youtube(deadline=9e12)
    assert order == ["l1"]


# ── library v2: the Forum channel ────────────────────────────────────────────

FORUM = "forum9"
TAG_IDS = {spec["name"]: f"tag-{i}" for i, spec in enumerate(tl.forum_tag_specs())}


def _forum_env(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_FORUM_ENABLED", "1")
    monkeypatch.setenv("TSDR_LESSONS_FORUM_CHANNEL_ID", FORUM)
    tl.set_state("forum_tags", json.dumps(TAG_IDS))


def _forum_routes(posts, sent, *, forward_ok=True):
    """A forum that numbers its posts p1, p2, ... and records what goes in them."""
    def make_post(p, b):
        posts.append(b)
        pid = f"p{len(posts)}"
        sent.setdefault(pid, [])
        return {"id": pid}

    def in_post(pid):
        def post(p, b):
            if "message_reference" in b and not forward_ok:
                raise tl.DiscordError(429, "Maximum amount of forwarded attachment bytes reached")
            sent[pid].append(b)
            return {"id": f"{pid}-m{len(sent[pid])}"}
        return post

    routes = {("POST", f"/channels/{FORUM}/threads"): make_post}
    for n in range(1, 40):
        routes[("POST", f"/channels/p{n}/messages")] = in_post(f"p{n}")
    return routes


def _forum_lesson(aid, day, *, title=None, tags=("setups",), tickers=("NVDA",), section="setups",
                  level="intermediate", author=PATRICK, transcript="the words " * 30):
    m = msg(sf(2026, 3, day), author=author, attachments=[video(aid)])
    tl.record_message(m, TSDR if author == PATRICK else tl.BRACCO_CHANNEL_ID)
    tl._update(aid, status="posted", title=title or f"Lesson {aid}", recap="A. B. C. D.",
               tags=json.dumps(list(tags)), tickers=json.dumps(list(tickers)), section=section,
               level=level, transcript=transcript, discord_post_id=f"old-{aid}",
               post_channel_id=f"t-{section}")
    return m


def test_the_forum_is_created_once_with_its_tags_read_only_and_remembered(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_FORUM_ENABLED", "1")
    made = []
    fake = FakeDiscord({
        ("GET", f"/guilds/{GUILD}/channels"): [{"id": "cat1", "type": 4, "name": "EDUCATION"}],
        ("GET", "/users/@me"): {"id": "bot1"},
        ("GET", f"/channels/{TSDR}"): {"permission_overwrites": [
            {"id": "role-members", "type": 0, "allow": str(tl._VIEW_CHANNEL), "deny": "0"}]},
        ("POST", f"/guilds/{GUILD}/channels"): lambda p, b: made.append(b) or {"id": "forum1"},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.ensure_forum() == "forum1"
    body = made[0]
    assert body["type"] == tl._FORUM and body["name"] == "lesson-library"
    assert body["parent_id"] == "cat1" and body["default_sort_order"] == tl._SORT_BY_CREATION
    assert [t["name"] for t in body["available_tags"]] == [
        "Setups & Entries", "Trade Management", "Market Read", "Mindset & Process",
        "Clips & Quick Takes", "Beginner", "Intermediate", "Advanced", "TSDR", "Bracco"]
    ows = {o["id"]: o for o in body["permission_overwrites"]}
    assert int(ows["role-members"]["deny"]) & tl._SEND_MESSAGES          # members read only
    assert int(ows["bot1"]["allow"]) & tl._SEND_IN_THREADS                # the bot replies in posts
    n = len(fake.calls)
    assert tl.ensure_forum() == "forum1" and len(fake.calls) == n          # remembered


def test_an_existing_forum_is_found_by_name_and_a_bot_without_the_permission_is_told(monkeypatch):
    fake = FakeDiscord({("GET", f"/guilds/{GUILD}/channels"): [
        {"id": "f-old", "type": tl._FORUM, "name": "Lesson-Library"}]})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.ensure_forum() == "f-old"
    tl.set_state("forum_channel_id", "")

    def refuse(p, b):
        raise tl.DiscordError(403, "Missing Permissions")

    fake = FakeDiscord({
        ("GET", f"/guilds/{GUILD}/channels"): [{"id": "cat1", "type": 4, "name": "EDUCATION"}],
        ("GET", "/users/@me"): {"id": "bot1"},
        ("GET", f"/channels/{TSDR}"): {"permission_overwrites": []},
        ("POST", f"/guilds/{GUILD}/channels"): refuse,
    })
    monkeypatch.setattr(tl, "_discord", fake)
    with pytest.raises(tl.DiscordError):
        tl.ensure_forum()
    assert len([c for c in fake.calls if c[0] == "POST"]) == len(tl._FORUM_OVERWRITE_LADDER)
    assert tl.get_state("forum_channel_id") in (None, "")                 # nothing remembered


def test_missing_forum_tags_are_added_keeping_the_existing_ones(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_FORUM_CHANNEL_ID", FORUM)
    existing = [{"id": "t-a", "name": "Setups & Entries", "emoji_name": "x"},
                {"id": "t-z", "name": "Owner's own tag"}]
    patched = []

    def patch(p, b):
        patched.append(b)
        return {"available_tags": [*b["available_tags"][:2],
                                   *[{**t, "id": f"new-{i}"} for i, t in enumerate(b["available_tags"][2:])]]}

    fake = FakeDiscord({("GET", f"/channels/{FORUM}"): {"available_tags": existing},
                        ("PATCH", f"/channels/{FORUM}"): patch})
    monkeypatch.setattr(tl, "_discord", fake)
    tags = tl.forum_tags()
    assert patched[0]["available_tags"][:2] == existing                   # kept, ids and all
    assert tags["Setups & Entries"] == "t-a" and tags["Owner's own tag"] == "t-z"
    assert tags["Beginner"].startswith("new-") and tags["Bracco"].startswith("new-")
    n = len(fake.calls)
    assert tl.forum_tags() == tags and len(fake.calls) == n              # cached
    # a bot that may not edit the channel uses what is there
    tl.set_state("forum_tags", "")

    def refuse(p, b):
        raise tl.DiscordError(403, "Missing Permissions")

    monkeypatch.setattr(tl, "_discord", FakeDiscord({("GET", f"/channels/{FORUM}"): {"available_tags": existing},
                                                      ("PATCH", f"/channels/{FORUM}"): refuse}))
    assert tl.forum_tags() == {"Setups & Entries": "t-a", "Owner's own tag": "t-z"}


def test_with_the_forum_on_a_lesson_is_one_tagged_post_with_the_video_inside(monkeypatch):
    _forum_env(monkeypatch)
    m = msg(sf(2026, 10, 15), attachments=[video("f1")], content="EMA lesson")
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m, recap={**RECAP, "level": "beginner"})
    posts, sent = [], {}
    fake.routes.update(_forum_routes(posts, sent))
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert posts[0]["name"] == RECAP["title"]
    assert posts[0]["applied_tags"] == [TAG_IDS["Setups & Entries"], TAG_IDS["Beginner"], TAG_IDS["TSDR"]]
    assert posts[0]["message"]["embeds"][0]["title"] == RECAP["title"]
    assert posts[0]["message"]["content"] == "Beginner · Entries · Setups · $NVDA $AMD"
    assert "message_reference" in sent["p1"][0]                           # the video, inside the post
    row = tl.get_lesson("f1")
    assert row["forum_post_id"] == "p1" and row["discord_post_id"] == "p1"
    assert row["post_channel_id"] == "p1" and row["forward_post_id"] == "p1-m1"
    assert row["section"] == "setups" and row["related_at"]
    assert tl.get_state("index_dirty") == "1"
    assert fake.posts("/channels/lessons/messages") == []                 # nothing in the old channel


def test_a_clip_post_carries_no_level_tag_and_a_refused_forward_waits_for_youtube(monkeypatch):
    _forum_env(monkeypatch)
    m = msg(sf(2026, 10, 15), attachments=[video("fc")])
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m, recap={"is_lesson": False, "title": "Tape check",
                                            "recap": "A quick look.", "tags": ["market"]})
    posts, sent = [], {}
    fake.routes.update(_forum_routes(posts, sent, forward_ok=False))
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert posts[0]["applied_tags"] == [TAG_IDS["Clips & Quick Takes"], TAG_IDS["TSDR"]]
    row = tl.get_lesson("fc")
    assert row["forward_post_id"] == "" and row["section"] == "clips"
    # once the YouTube copy exists, the refill puts it inside the post
    tl._update("fc", youtube_id="YTCOPY00001")
    assert tl.run_video_refill(deadline=9e12) == {"refilled": 1, "waiting": 0, "errors": 0}
    assert sent["p1"][-1] == {"content": "https://youtu.be/YTCOPY00001"}
    assert tl.get_lesson("fc")["forward_post_id"] == "p1-m1"


def test_related_lessons_score_tickers_then_tags_then_section_and_never_clips():
    for aid, day, tags, tickers, section in (
            ("r1", 1, ("setups",), ("NVDA",), "setups"),       # ticker + tag + section = 6
            ("r2", 2, ("setups",), ("AMD",), "setups"),        # tag + section = 3
            ("r3", 3, ("risk",), ("NVDA",), "management"),     # ticker = 3, newer than r2
            ("r4", 4, ("market",), ("SPY",), "market"),        # 0
            ("r5", 5, ("clip",), ("NVDA",), "clips")):         # a clip: never
        _forum_lesson(aid, day, tags=tags, tickers=tickers, section=section)
        tl._update(aid, forum_post_id=f"post-{aid}")
    me = {"attachment_id": "me", "tags": ["setups"], "tickers": ["NVDA"], "section": "setups"}
    assert [r["post"] for r in tl.related_lessons(me)] == ["post-r1", "post-r3", "post-r2"]
    assert tl.related_lessons({**me, "tags": ["clip"]}) == []
    embed = tl.build_embed({**me, "title": "T", "recap": "R", "posted_at": 1700000000,
                            "related": tl.related_lessons(me)}, "https://x")
    assert ("**See also:** [Lesson r1](https://discord.com/channels/" + GUILD + "/post-r1) · "
            "[Lesson r3](") in embed["description"]


def test_the_migration_moves_old_lessons_oldest_first_classifying_and_deduping(monkeypatch):
    _forum_env(monkeypatch)
    monkeypatch.setenv("TSDR_LESSONS_FORUM_MIGRATE_PER_TICK", "3")
    talk = "same talk words " * 30
    _forum_lesson("m1", 1, level=None, transcript=talk)                     # needs a level
    _forum_lesson("m2", 2, transcript=talk)                                  # repeats m1
    _forum_lesson("m3", 3, transcript="different words here " * 30)
    _forum_lesson("m4", 4, transcript="fourth lesson words " * 30)         # next tick
    _forum_lesson("gone", 5, transcript="deleted by hand " * 30)
    posts, sent = [], {}
    routes = _forum_routes(posts, sent)
    for aid in ("m1", "m2", "m3", "m4"):
        routes[("GET", f"/channels/t-setups/messages/old-{aid}")] = {"id": f"old-{aid}"}

    def deleted(p, b):
        raise tl.DiscordError(404, "Unknown Message")
    routes[("GET", "/channels/t-setups/messages/old-gone")] = deleted
    monkeypatch.setattr(tl, "_discord", FakeDiscord(routes))
    monkeypatch.setattr(tl, "classify_level", lambda title, recap: "advanced")
    out = tl.run_forum_migration(deadline=9e12)
    assert out == {"moved": 2, "duplicate": 1, "removed": 0, "errors": 0, "left": 2}
    assert [b["name"] for b in posts] == ["Lesson m1", "Lesson m3"]
    assert TAG_IDS["Advanced"] in posts[0]["applied_tags"]
    m1, m2 = tl.get_lesson("m1"), tl.get_lesson("m2")
    assert m1["level"] == "advanced" and m1["forum_post_id"] == "p1" and m1["discord_post_id"] == "p1"
    assert m2["status"] == "duplicate" and m2["duplicate_of"] == "m1"
    assert json.loads(tl.get_lesson("m3")["related"]) == [{"title": "Lesson m1", "post": "p1"}]
    out = tl.run_forum_migration(deadline=9e12)
    assert out == {"moved": 1, "duplicate": 0, "removed": 1, "errors": 0, "left": 0}
    assert tl.get_lesson("gone")["status"] == "removed"
    assert tl.run_forum_migration(deadline=9e12)["moved"] == 0             # done


def test_the_index_is_one_pinned_post_edited_in_place_and_split_when_long(monkeypatch):
    _forum_env(monkeypatch)
    for i in range(1, 4):
        _forum_lesson(f"i{i}", i, title=f"Lesson {i}", section="setups" if i < 3 else "market")
        tl._update(f"i{i}", forum_post_id=f"post-i{i}")
    tl._mark_index_dirty()
    posts, msgs, patched, pinned = [], [], [], []
    fake = FakeDiscord({
        ("POST", f"/channels/{FORUM}/threads"): lambda p, b: posts.append(b) or {"id": "idx"},
        ("PATCH", "/channels/idx"): lambda p, b: pinned.append(b) or {},
        ("POST", "/channels/idx/messages"): lambda p, b: msgs.append(b) or {"id": f"im{len(msgs)}"},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.refresh_index() == {"updated": len(tl.SECTIONS)}
    assert posts[0]["name"] == "Index" and pinned == [{"flags": tl._PINNED}]
    assert msgs[0]["embeds"][0]["title"] == "Setups & Entries"
    assert msgs[0]["embeds"][0]["description"] == (
        f"• [Lesson 1](https://discord.com/channels/{GUILD}/post-i1) · Mar 1, 2026\n"
        f"• [Lesson 2](https://discord.com/channels/{GUILD}/post-i2) · Mar 2, 2026")
    assert msgs[2]["embeds"][0]["description"].startswith("• [Lesson 3]")
    assert msgs[4]["embeds"][0]["description"] == "Nothing here yet."
    assert tl.refresh_index() == {"updated": 0}                            # nothing changed
    # a new lesson: the same messages are edited, not re-posted
    _forum_lesson("i4", 6, title="Lesson 4", section="setups")
    tl._update("i4", forum_post_id="post-i4")
    tl._mark_index_dirty()
    for n in range(1, 6):
        fake.routes[("PATCH", f"/channels/idx/messages/im{n}")] = lambda p, b: patched.append(b) or {}
    assert tl.refresh_index()["updated"] == len(tl.SECTIONS)
    assert len(msgs) == 5 and len(patched) == 5
    assert "[Lesson 4]" in patched[0]["embeds"][0]["description"]
    # a section longer than one embed continues in a second message
    assert tl._pack([f"line {i} " + "x" * 100 for i in range(60)], limit=3900)[1].startswith("line ")
    assert len(tl._pack(["a", "b"], limit=3900)) == 1


def test_a_pencil_from_a_speaker_rewrites_the_lesson_without_a_download(monkeypatch):
    _forum_env(monkeypatch)
    _forum_lesson("w1", 1, transcript="rewrite these words " * 30)
    _forum_lesson("w2", 2, transcript="second lesson words " * 30)
    _forum_lesson("w3", 3, transcript="third lesson words " * 30)
    for aid, pid in (("w1", "p-w1"), ("w2", "p-w2"), ("w3", "p-w3")):
        tl._update(aid, forum_post_id=pid, discord_post_id=pid, post_channel_id=pid)
    deleted = []
    fake = FakeDiscord({
        ("GET", f"/channels/p-w1/messages/p-w1/reactions/{tl._PENCIL}"): [{"id": PATRICK}],
        ("GET", f"/channels/p-w2/messages/p-w2/reactions/{tl._PENCIL}"): [{"id": "stranger"}],
        ("GET", f"/channels/p-w3/messages/p-w3/reactions/{tl._PENCIL}"):
            lambda p, b: (_ for _ in ()).throw(tl.DiscordError(404, "Unknown Channel")),
        ("DELETE", "/channels/p-w1"): lambda p, b: deleted.append("p-w1"),
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_rewrite_requests(deadline=9e12) == {"checked": 2, "rewriting": 1, "removed": 1, "gone": 0, "errors": 0}
    assert deleted == ["p-w1"]
    w1 = tl.get_lesson("w1")
    assert w1["status"] == "new" and w1["forum_post_id"] is None and w1["transcript"]
    assert tl.get_lesson("w2")["status"] == "posted" and tl.get_lesson("w2")["reaction_checked_at"]
    assert tl.get_lesson("w3")["status"] == "removed"
    # the rewrite reuses the stored transcript: no download, a new post
    message = msg(sf(2026, 3, 1), attachments=[video("w1")])
    fake2 = _pipeline(monkeypatch, message)
    monkeypatch.setattr(tl, "download", lambda url, dest: (_ for _ in ()).throw(AssertionError("downloaded")))
    posts, sent = [], {}
    fake2.routes.update(_forum_routes(posts, sent))
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert tl.get_lesson("w1")["forum_post_id"] == "p1"


def test_a_link_rewrite_in_the_forum_takes_the_whole_post_down(monkeypatch):
    _forum_env(monkeypatch)
    m = msg(sf(2026, 7, 9), content="Must watch https://youtu.be/LINKVID0001")
    tl.record_message(m, TSDR)
    aid = tl.LINK_PREFIX + "LINKVID0001"
    tl._update(aid, status="posted", title="Clip", recap="A short clip.", forum_post_id="p-link",
               discord_post_id="p-link", post_channel_id="p-link", forward_post_id="p-link-m1",
               section="clips")
    assert tl.store_link_transcript("LINKVID0001", "now the words " * 30) == "queued"
    deleted = []
    fake = FakeDiscord({("DELETE", "/channels/p-link"): lambda p, b: deleted.append(1)})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_link_redo(deadline=9e12) == {"requeued": 1, "errors": 0}
    assert deleted == [1] and [c for c in fake.calls if "messages" in c[1]] == []
    row = tl.get_lesson(aid)
    assert row["status"] == "new" and row["forum_post_id"] is None and row["redo"] == 0


def test_see_also_is_refreshed_in_place_when_stale(monkeypatch):
    _forum_env(monkeypatch)
    _forum_lesson("s1", 1, tickers=("NVDA",))
    _forum_lesson("s2", 2, tickers=("NVDA",))
    tl._update("s1", forum_post_id="p-s1", discord_post_id="p-s1", post_channel_id="p-s1",
               related="[]", related_at=1)                                  # long ago, nothing related then
    tl._update("s2", forum_post_id="p-s2", discord_post_id="p-s2", post_channel_id="p-s2",
               related=json.dumps([{"title": "Lesson s1", "post": "p-s1"}]),
               related_at=int(__import__("time").time()))                   # fresh
    patched = []
    fake = FakeDiscord({("PATCH", "/channels/p-s1/messages/p-s1"): lambda p, b: patched.append(b) or {}})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_related_refresh(deadline=9e12) == {"refreshed": 1, "errors": 0}
    assert "[Lesson s2](https://discord.com/channels/" in patched[0]["embeds"][0]["description"]
    assert json.loads(tl.get_lesson("s1")["related"]) == [{"title": "Lesson s2", "post": "p-s2"}]
    assert tl.run_related_refresh(deadline=9e12) == {"refreshed": 0, "errors": 0}


def test_the_forum_stages_run_only_with_the_flag_and_regroup_steps_aside(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_ENABLED", "1")
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    ran = []
    for name in ("run_regroup", "run_forum_migration", "run_rewrite_requests", "run_related_refresh",
                 "run_video_refill", "run_level_backfill"):
        monkeypatch.setattr(tl, name, lambda deadline, _n=name: ran.append(_n) or {})
    monkeypatch.setattr(tl, "refresh_index", lambda: ran.append("refresh_index") or {"updated": 0})
    monkeypatch.setattr(tl, "refresh_thread_index", lambda: ran.append("refresh_thread_index") or {"updated": 0})
    monkeypatch.setattr(tl, "scan_channel", lambda ch: {})
    monkeypatch.setattr(tl, "run_lessons", lambda limit, deadline: {})
    monkeypatch.setattr(tl, "run_link_redo", lambda deadline: {"requeued": 0, "errors": 0})
    tl.set_state(tl._LINK_RESCAN_KEY, "1")
    tl.set_state(tl._REOPEN_DONE_KEY, "1")
    tl.tick()
    assert ran == ["run_level_backfill", "run_rewrite_requests", "run_related_refresh",
                   "run_regroup", "run_video_refill", "refresh_thread_index"]
    ran.clear()
    monkeypatch.setenv("TSDR_LESSONS_FORUM_ENABLED", "1")
    tl.tick()
    assert ran == ["run_forum_migration", "run_rewrite_requests", "run_related_refresh",
                   "run_video_refill", "refresh_index"]


# ── library v2: Desk > Videos mirrors the sections ───────────────────────────

def test_a_lesson_uploads_onto_its_sections_shelf_with_section_and_level_tags(monkeypatch):
    fake = _posted_lesson(monkeypatch, "sh1")
    tl._update("sh1", section="management", level="advanced",
               moments=json.dumps([{"t": 42, "label": "The stop", "quote": "q"}]))

    class YT:
        def upload(self, path, title, description, privacy):
            return "YTSHELF0001"

    from api.services import education_service as es
    made = {}
    monkeypatch.setattr(es, "register_category_if_missing", lambda name, kind="library": made.update(cat=name))
    monkeypatch.setattr(es, "create_video", lambda p: made.update(p) or {"id": 78})
    monkeypatch.setattr(es, "set_video_insights", lambda vid, **kw: made.update(kw))
    monkeypatch.setattr(es, "set_video_tags", lambda vid, tags: made.update(tags=tags))
    import api.services.youtube_client as ytc
    monkeypatch.setattr(ytc, "YouTubeClient", YT)
    assert tl.run_youtube(deadline=9e12)["uploaded"] == 1
    assert made["cat"] == made["category"] == "TSDR Lessons · Trade Management"
    assert made["tags"] == ["risk", "trade management", "advanced"]
    assert made["chapters"] == [{"t": 42, "title": "The stop"}]
    assert "Key moments:\n0:42 The stop" in made["description"]
    # a lesson without a section keeps the plain shelf and its topic tags
    assert tl.library_category_for({"section": None}) == "TSDR Lessons"
    assert tl.library_tags({"tags": json.dumps(["risk"]), "section": None, "level": None}) == ["risk"]
    assert tl.library_category_for({"section": "clips"}) == "TSDR Lessons"


def test_rows_already_on_the_website_move_to_their_section_shelves_once(monkeypatch):
    _posted_lesson(monkeypatch, "mv1")
    tl._update("mv1", section="setups", level="beginner", edu_video_id=601)
    _posted_lesson(monkeypatch, "mv2")
    tl._update("mv2", section="market", edu_video_id=602)
    _posted_lesson(monkeypatch, "mv3")                                     # not on the website
    from api.services import education_service as es
    writes = []
    monkeypatch.setattr(es, "register_category_if_missing", lambda name, kind="library": writes.append(("cat", name)))
    monkeypatch.setattr(es, "update_video", lambda vid, p: writes.append(("video", vid, p["category"])) or {})
    monkeypatch.setattr(es, "set_video_tags", lambda vid, tags: writes.append(("tags", vid, tags)))
    monkeypatch.setattr(es, "set_video_insights", lambda vid, **kw: writes.append(("insights", vid, kw.get("chapters"))))
    assert tl.move_library_rows_to_sections() == 2
    assert ("video", 601, "TSDR Lessons · Setups & Entries") in writes
    assert ("tags", 601, ["risk", "setups & entries", "beginner"]) in writes
    assert ("video", 602, "TSDR Lessons · Market Read") in writes
    assert ("insights", 601, None) in writes
    assert not any(w[0] == "video" and w[1] not in (601, 602) for w in writes)
    assert tl.move_library_rows_to_sections() == 0                           # once
    # a failed write leaves the one-shot open for the next tick
    tl.set_state(tl._LIBRARY_SECTIONS_KEY, "")

    def boom(vid, p):
        raise RuntimeError("db locked")
    monkeypatch.setattr(es, "update_video", boom)
    assert tl.move_library_rows_to_sections() == 0
    assert tl.get_state(tl._LIBRARY_SECTIONS_KEY) in (None, "")


def test_a_rewrite_updates_the_lessons_website_row(monkeypatch):
    m = msg(sf(2026, 10, 15), attachments=[video("rw1")])
    tl.record_message(m, TSDR)
    tl._update("rw1", edu_video_id=701, transcript="old words " * 30)
    fake = _pipeline(monkeypatch, m, recap={**RECAP, "title": "Better title", "level": "beginner"})
    from api.services import education_service as es
    writes = {}
    monkeypatch.setattr(es, "register_category_if_missing", lambda name, kind="library": None)
    monkeypatch.setattr(es, "update_video", lambda vid, p: writes.update(vid=vid, **p) or {})
    monkeypatch.setattr(es, "set_video_tags", lambda vid, tags: writes.update(tags=tags))
    monkeypatch.setattr(es, "set_video_insights", lambda vid, **kw: writes.update(kw))
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert writes["vid"] == 701 and writes["title"] == writes["headline"] == "Better title"
    assert writes["category"] == "TSDR Lessons · Setups & Entries"
    assert writes["tags"] == ["entries", "setups", "setups & entries", "beginner"]


# ── library v2 in the threads: levels, See also, pencil, the header index ────

def _thread_lesson(aid, day, *, title=None, section="setups", level="intermediate",
                   tags=("setups",), tickers=("NVDA",), transcript="the words " * 30):
    m = msg(sf(2026, 3, day), attachments=[video(aid)])
    tl.record_message(m, TSDR)
    tl._update(aid, status="posted", title=title or f"Lesson {aid}", recap="A. B. C. D.",
               tags=json.dumps(list(tags)), tickers=json.dumps(list(tickers)), section=section,
               level=level, transcript=transcript, discord_post_id=f"msg-{aid}",
               post_channel_id=f"t-{section}")
    return m


def test_a_thread_lesson_carries_its_level_and_see_also_links(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    _seed_threads()
    _thread_lesson("sa1", 1, tickers=("NVDA",))
    m = msg(sf(2026, 10, 15), attachments=[video("sa2")])
    tl.record_message(m, TSDR)
    fake = _pipeline(monkeypatch, m, recap={**RECAP, "level": "advanced"})
    sent = []
    fake.routes[("POST", "/channels/t-setups/messages")] = lambda p, b: sent.append(b) or {"id": f"n{len(sent)}"}
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 1
    assert sent[0]["content"] == "Advanced · Entries · Setups · $NVDA $AMD"
    link = f"https://discord.com/channels/{GUILD}/t-setups/msg-sa1"
    assert f"**See also:** [Lesson sa1]({link})" in sent[0]["embeds"][0]["description"]
    row = tl.get_lesson("sa2")
    assert json.loads(row["related"]) == [{"title": "Lesson sa1", "url": link}]
    assert tl.get_state("index_dirty") == "1"


def test_the_header_posts_become_a_level_grouped_index(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    _seed_threads()
    _thread_lesson("h1", 1, title="First principles of risk", level="beginner")
    _thread_lesson("h2", 2, title="A much longer lesson title that will certainly be shortened for the index",
                   level="advanced")
    _thread_lesson("h3", 3, title="Levelled later", level=None)
    _thread_lesson("c1", 4, title="Quick NVDA look", section="clips", level=None)
    patched = {}
    fake = FakeDiscord({("PATCH", f"/channels/lessons/messages/t-{k}"): (lambda key: lambda p, b: patched.update({key: b}) or {})(k)
                        for k, _, _ in tl.SECTIONS})
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.refresh_thread_index() == {"updated": len(tl.SECTIONS)}
    setups = patched["setups"]["embeds"]
    assert setups[0]["title"] == "Setups & Entries · 3 lessons" and "Click a title" in setups[0]["description"]
    assert [e["title"] for e in setups[1:]] == ["🌱 Beginner", "🏔️ Advanced", "More lessons"]
    assert setups[1]["description"] == (
        f"• [First principles of risk](https://discord.com/channels/{GUILD}/t-setups/msg-h1) · Mar 1")
    assert setups[2]["description"].startswith("• [A much longer lesson title that will certainly…](")
    assert "[Levelled later]" in setups[3]["description"]
    clips = patched["clips"]["embeds"]
    assert clips[1]["title"] == "Newest first" and "[Quick NVDA look]" in clips[1]["description"]
    assert patched["market"]["embeds"] == [patched["market"]["embeds"][0]]        # blurb only
    assert patched["market"]["embeds"][0]["title"] == "Market Read"                # no count when empty
    assert tl.get_state("index_dirty") == "0"
    assert tl.refresh_thread_index() == {"updated": 0}                             # clean
    # too many lessons for one post: the rest is counted, not dropped silently
    rows = [{"title": f"Lesson {i}", "level": "beginner", "posted_at": 1700000000 + i,
             "post_channel_id": "t-setups", "discord_post_id": str(10 ** 18 + i)} for i in range(120)]
    embeds = tl.thread_index_embeds("setups", "Setups & Entries", "Blurb.", rows)
    total = sum(len(e["title"]) + len(e["description"]) for e in embeds)
    assert total <= 6000 and embeds[-1]["description"].endswith("more in the thread")
    assert sum(e["description"].count("• [") for e in embeds[1:]) + int(
        embeds[-1]["description"].rsplit("and ", 1)[1].split()[0]) == 120


def test_old_lessons_get_a_level_a_few_per_tick_and_clips_do_not(monkeypatch):
    _thread_lesson("l1", 1, level=None)
    _thread_lesson("l2", 2, level=None)
    _thread_lesson("l3", 3, level="beginner")
    _thread_lesson("lc", 4, level=None, section="clips")
    monkeypatch.setattr(tl, "classify_level", lambda title, recap: "advanced")
    assert tl.run_level_backfill(deadline=9e12, limit=1) == {"classified": 1}
    assert tl.run_level_backfill(deadline=9e12) == {"classified": 1}
    assert tl.get_lesson("l1")["level"] == tl.get_lesson("l2")["level"] == "advanced"
    assert tl.get_lesson("l3")["level"] == "beginner" and tl.get_lesson("lc")["level"] is None
    assert tl.run_level_backfill(deadline=9e12) == {"classified": 0}
    assert tl.get_state("index_dirty") == "1"


def test_a_pencil_on_a_thread_post_rewrites_it_and_see_also_refreshes_in_the_thread(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    _thread_lesson("tp1", 1, transcript="rewrite me " * 30)
    _thread_lesson("tp2", 2, transcript="leave me " * 30)
    tl._update("tp1", forward_post_id="vid-tp1")
    tl._update("tp2", related="[]", related_at=1)
    deleted, patched = [], []
    fake = FakeDiscord({
        ("GET", f"/channels/t-setups/messages/msg-tp1/reactions/{tl._PENCIL}"): [{"id": tl.BRACCO_USER_ID}],
        ("GET", f"/channels/t-setups/messages/msg-tp2/reactions/{tl._PENCIL}"): [],
        ("DELETE", "/channels/t-setups/messages/msg-tp1"): lambda p, b: deleted.append("msg-tp1"),
        ("DELETE", "/channels/t-setups/messages/vid-tp1"): lambda p, b: deleted.append("vid-tp1"),
        ("PATCH", "/channels/t-setups/messages/msg-tp2"): lambda p, b: patched.append(b) or {},
    })
    monkeypatch.setattr(tl, "_discord", fake)
    assert tl.run_rewrite_requests(deadline=9e12) == {"checked": 2, "rewriting": 1, "removed": 0, "gone": 0, "errors": 0}
    assert deleted == ["msg-tp1", "vid-tp1"]
    row = tl.get_lesson("tp1")
    assert row["status"] == "new" and row["discord_post_id"] is None and row["transcript"]
    # tp2's See also was empty; tp1 is no longer posted, so it stays empty and nothing is edited
    assert tl.run_related_refresh(deadline=9e12) == {"refreshed": 1, "errors": 0}
    assert patched == []
    _thread_lesson("tp3", 3, tickers=("NVDA",))
    tl._update("tp3", related_at=int(__import__("time").time()))             # fresh: only tp2 is due
    tl._update("tp2", related_at=1)
    assert tl.run_related_refresh(deadline=9e12)["refreshed"] == 1
    assert "[Lesson tp3](https://discord.com/channels/" in patched[0]["embeds"][0]["description"]


def test_caption_titles_are_cleaned_of_mentions_links_and_brackets():
    raw = "<@&1216780250286002297> https://open.substack.com/pub/x/p/y?r=1 [Patrick] Morning plan:"
    assert tl.clean_title(raw) == "Patrick Morning plan"
    assert tl.clean_title("<:fire:123> Watch NVDA here https://t.co/abc") == "Watch NVDA here"
    assert tl.clean_title("https://youtu.be/abc") == ""
    row = {"posted_at": 1767225600, "author_id": PATRICK, "channel_id": TSDR}
    assert tl.as_clip({}, row, raw)["title"] == "Patrick Morning plan"
    assert tl.as_clip({}, row, "https://youtu.be/abc")["title"].startswith("Quick clip, ")
    assert tl.as_clip({"title": "[Live] <@&1> NVDA"}, row, "")["title"] == "Live NVDA"


def test_the_clips_header_shows_only_the_newest_dozen_and_counts_the_rest():
    rows = [{"title": f"<@&1> Clip {i} https://x.y/{i}", "level": None, "posted_at": 1700000000 + i,
             "post_channel_id": "t-clips", "discord_post_id": str(10 ** 18 + i)}
            for i in range(30, 0, -1)]
    embeds = tl.thread_index_embeds("clips", "Clips & Quick Takes", "Blurb.", rows)
    assert embeds[0]["title"] == "Clips & Quick Takes · 30 clips"
    lines = embeds[1]["description"].split("\n")
    assert lines[0].startswith("• [Clip 30](") and len([l for l in lines if l.startswith("• [")]) == tl._CLIPS_INDEX_MAX
    assert lines[-1] == "… and 18 more in the thread"
    assert "https://x.y" not in embeds[1]["description"].split("](")[0]


def test_a_linked_lesson_whose_video_left_youtube_comes_down_and_stays_out(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    monkeypatch.setenv("TSDR_LESSONS_CHANNEL_ID", "lessons")
    _seed_threads()
    dead, alive = f"{tl.LINK_PREFIX}A2py58scpYI", f"{tl.LINK_PREFIX}dQw4w9WgXcQ"
    for aid, day in ((dead, 3), (alive, 4)):
        m = msg(sf(2026, 5, day), content=f"https://youtu.be/{aid[len(tl.LINK_PREFIX):]}")
        tl.record_message(m, TSDR)
        tl._update(aid, status="posted", title="https://youtu.be/x", recap="A clip.", section="clips",
                   tags=json.dumps(["clip"]), discord_post_id=f"msg-{aid}", forward_post_id=f"vid-{aid}",
                   post_channel_id="t-clips")
    _thread_lesson("att1", 5)                                              # an attachment: YouTube is never asked
    asked, deleted = [], []
    monkeypatch.setattr(tl, "youtube_video_gone", lambda v: asked.append(v) or v == "A2py58scpYI")
    routes = {("GET", f"/channels/t-clips/messages/msg-{a}/reactions/{tl._PENCIL}"): [] for a in (dead, alive)}
    routes[("GET", f"/channels/t-setups/messages/msg-att1/reactions/{tl._PENCIL}")] = []
    routes[("DELETE", f"/channels/t-clips/messages/msg-{dead}")] = lambda p, b: deleted.append("post")
    routes[("DELETE", f"/channels/t-clips/messages/vid-{dead}")] = lambda p, b: deleted.append("video")
    fake = FakeDiscord(routes)
    monkeypatch.setattr(tl, "_discord", fake)
    tl.set_state("index_dirty", "")
    assert tl.run_rewrite_requests(deadline=9e12) == {"checked": 3, "rewriting": 0, "removed": 0, "gone": 1, "errors": 0}
    assert asked == ["A2py58scpYI", "dQw4w9WgXcQ"] and deleted == ["post", "video"]
    row = tl.get_lesson(dead)
    assert row["status"] == "skipped" and row["last_error"] == tl.GONE_FROM_YOUTUBE
    assert row["discord_post_id"] is None and row["post_channel_id"] is None
    assert tl.get_lesson(alive)["status"] == "posted"
    assert tl.get_state("index_dirty") == "1"
    assert [r["discord_post_id"] for r in tl._index_rows("clips")] == [f"msg-{alive}"]
    # a skipped dead link is not reopened or re-posted: the queue ignores it
    assert tl.run_lessons(limit=3, deadline=9e12)["posted"] == 0
    assert tl.get_lesson(dead)["status"] == "skipped"


def test_a_new_link_to_a_video_youtube_no_longer_has_is_never_posted(monkeypatch):
    monkeypatch.setenv("TSDR_LESSONS_THREADS_ENABLED", "1")
    m = msg(sf(2026, 10, 16), content="https://youtu.be/rC4J8QA7hM0")
    tl.record_message(m, TSDR)
    aid = f"{tl.LINK_PREFIX}rC4J8QA7hM0"
    assert tl.get_lesson(aid)["status"] == "new"
    monkeypatch.setattr(tl, "fetch_message", lambda ch, mid: m)
    monkeypatch.setattr(tl, "youtube_video_gone", lambda v: True)
    monkeypatch.setattr(tl, "youtube_transcript", lambda v: (_ for _ in ()).throw(AssertionError("not asked")))
    assert tl.process_lesson(tl.get_lesson(aid), "lessons") == "skipped"
    row = tl.get_lesson(aid)
    assert row["status"] == "skipped" and row["last_error"] == tl.GONE_FROM_YOUTUBE


def test_youtube_video_gone_only_on_a_definite_404(monkeypatch):
    import httpx

    class R:
        def __init__(self, code):
            self.status_code = code
    gone = _REAL_VIDEO_GONE                                  # the fixture stubs the module's copy
    monkeypatch.setattr(httpx, "get", lambda *a, **k: R(404))
    assert gone("x") is True
    monkeypatch.setattr(httpx, "get", lambda *a, **k: R(401))                 # private: not gone
    assert gone("x") is False
    monkeypatch.setattr(httpx, "get", lambda *a, **k: R(200))
    assert gone("x") is False

    def boom(*a, **k):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(httpx, "get", boom)
    assert gone("x") is False
