"""Wisdom sources — transcripts (stream S-C, CONTRACTS.md §6.3, W1 §4.4).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an attendee's NAME stored anywhere (segment, source, R2 text);
2. a transcript parsed by anything other than education_service.get_transcript_cues;
3. coverage/incomplete computed wrong around the 0.98 threshold;
4. a changed transcript overwriting its source instead of versioning it;
5. a live session ingested while the Desk pipeline is still working on it;
6. an R2 object that is not byte-stable (gzip mtime), or a source row whose R2 write failed.
"""
from __future__ import annotations

import gzip
import json
import os
import time

import pytest

from api.services import desk_session_insights as si
from api.services import education_service as edu
from api.services.wisdom.core import store
from api.services.wisdom.sources import common, transcripts as tr


class _FakeBucket:
    def __init__(self):
        self.objects: dict = {}
        self.fail = False

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"Metadata": {"sha256": self.objects[Key][1]}}

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        if self.fail:
            raise RuntimeError("R2 down")
        assert Key not in self.objects, "overwrite attempted"
        self.objects[Key] = (Body, Metadata["sha256"])


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setattr(edu, "_DB_PATH", str(tmp_path / "education.db"))
    edu._init_db()
    store.init_db()
    from api.services.wisdom.core import r2

    bucket = _FakeBucket()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (bucket, "fake"))
    return bucket


def _seed(title="Live Trading Session — June 24, 2026", category="Workshops & Fireside Chats",
          cues=((5, "Patrick (TSDR)", "good morning"),), duration="1:00:00", chapters=None, description=None):
    v = edu.create_video({"youtube_id": f"Y{time.time_ns()}", "title": title, "category": category,
                          "duration": duration, "description": description, "sort_order": 0})
    block = si._timestamped_block([{"t": t, "text": f"{label}: {text}" if label else text}
                                   for t, label, text in cues])
    edu.set_video_insights(v["id"], transcript=block, chapters=chapters or [])
    return v


def _rows(sql, *args):
    with store.read() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


def test_stream_classification():
    assert tr.stream_for("Interviews") == "interview"
    assert tr.stream_for("Workshops & Fireside Chats", "uuid") == "workshop"
    assert tr.stream_for("Live Trading Sessions") == "zoom_live"
    assert tr.stream_for("Evening Update") == "zoom_live"
    assert tr.stream_for("The Mental Game", "some-uuid") == "zoom_live"
    assert tr.stream_for("The Mental Game") == "education"


def test_attendee_names_are_never_stored_anywhere(env):
    v = _seed(title="Workshop with Stockbee — September 11, 2026", cues=(
        (5, "Patrick (TSDR)", "welcome everyone"),
        (20, "Jane Attendeeson", "can you explain the setup"),
        (40, "Ravi", "flow was heavy on calls"),
        (60, "Pradeep Stockbee Bonde", "momentum bursts matter"),
        (80, "Patrick (TSDR)", "thanks"),
    ))
    out = tr.ingest_video(v["id"])
    assert out["action"] == "new"
    segs = _rows("SELECT speaker_label, author_id, speaker_confidence, text FROM wisdom_segments ORDER BY ordinal")
    labels = {(s["speaker_label"], s["author_id"]) for s in segs}
    assert labels == {("Patrick (TSDR)", "tsdr"), (None, None), ("Ravi", None), ("Stockbee", "guest:stockbee")}
    src = _rows("SELECT * FROM wisdom_sources")[0]
    blob = gzip.decompress(env.objects[src["raw_r2_key"]][0]).decode("utf-8")
    everything = json.dumps(segs) + json.dumps(src) + blob
    assert "Jane" not in everything and "Attendeeson" not in everything
    assert "Attendee: can you explain the setup" in blob  # the words stay, the name goes
    assert "Patrick (TSDR): welcome everyone" in blob      # control: a named author is kept
    assert json.loads(src["guest_names_json"]) == ["Stockbee"]


def test_transcripts_are_parsed_only_by_education_service(monkeypatch):
    v = _seed(cues=((5, "Patrick (TSDR)", "stored text"),))
    calls = []

    def fake_cues(video_id):
        calls.append(video_id)
        return [{"t": 7, "text": "Patrick (TSDR): from the parser"}]

    monkeypatch.setattr(edu, "get_transcript_cues", fake_cues)
    tr.ingest_video(v["id"])
    assert calls == [v["id"]]
    assert [s["text"] for s in _rows("SELECT text FROM wisdom_segments")] == ["from the parser"]


@pytest.mark.parametrize("last_t,duration,expected,incomplete", [
    (345, "1:53:50", 0.0505, 1),      # the 356 shape
    (6700, "1:53:50", 0.981, 0),      # just over the threshold
    (6680, "1:53:50", 0.978, 1),      # just under it
    (100, None, None, 0),             # unmeasurable
])
def test_coverage_and_incomplete_around_the_threshold(last_t, duration, expected, incomplete):
    v = _seed(cues=((5, None, "a"), (last_t, None, "b")), duration=duration)
    out = tr.ingest_video(v["id"])
    src = _rows("SELECT coverage_ratio, incomplete FROM wisdom_sources")[0]
    assert src["incomplete"] == incomplete and out["incomplete"] == incomplete
    if expected is None:
        assert src["coverage_ratio"] is None
    else:
        assert src["coverage_ratio"] == pytest.approx(expected, abs=0.0006)


def test_a_changed_transcript_becomes_a_new_version_and_the_old_one_stays():
    v = _seed(cues=((5, "Patrick (TSDR)", "first take"),))
    assert tr.ingest_video(v["id"])["action"] == "new"
    assert tr.ingest_video(v["id"])["action"] == "unchanged"
    edu.set_video_insights(v["id"], transcript=si._timestamped_block([{"t": 5, "text": "Patrick (TSDR): second take"}]))
    out = tr.ingest_video(v["id"])
    assert out["action"] == "changed" and out["version"] == 2
    rows = _rows("SELECT source_id, version, supersedes_source_id, raw_r2_key FROM wisdom_sources ORDER BY version")
    assert [r["version"] for r in rows] == [1, 2]
    assert rows[1]["supersedes_source_id"] == rows[0]["source_id"]
    assert rows[0]["raw_r2_key"].endswith("/v1.txt.gz") and rows[1]["raw_r2_key"].endswith("/v2.txt.gz")
    texts = {(r["source_version"], r["text"]) for r in _rows("SELECT source_version, text FROM wisdom_segments")}
    assert texts == {(1, "first take"), (2, "second take")}


def test_a_live_session_waits_for_the_desk_pipeline():
    v = _seed(category="Live Trading Sessions")
    edu.set_meeting_uuid(v["id"], "MEET1")
    now = int(time.time())
    assert tr.ingest_video(v["id"], now_s=now)["action"] == "not_settled"
    assert tr.ingest_video(v["id"], now_s=now + 4 * 3600)["action"] == "not_settled"  # Zoom not cleaned yet
    edu.mark_zoom_cleaned(v["id"])
    assert tr.ingest_video(v["id"], now_s=now + 4 * 3600)["action"] == "new"


def test_r2_objects_are_byte_stable_and_a_failed_put_writes_no_source(env, monkeypatch):
    # ⚠️ Python 3.14 (this box) may write a zero mtime by default while Railway's
    # Python 3.12 stamps the wall clock — so the header bytes alone cannot prove
    # the explicit mtime=0 (a mutation removing it survived that check). Spy the call.
    seen = []
    real = gzip.compress

    def spy(data, *args, **kwargs):
        seen.append(kwargs.get("mtime"))
        return real(data, *args, **kwargs)

    monkeypatch.setattr(gzip, "compress", spy)
    assert common.gzip_text("same")[4:8] == b"\x00\x00\x00\x00"  # gzip mtime = 0
    assert seen == [0]
    assert common.gzip_text("same") == common.gzip_text("same")
    monkeypatch.setattr(gzip, "compress", real)
    v = _seed()
    env.fail = True
    res = tr.ingest_new()
    assert res["errors"] and res["written"] == 0
    assert _rows("SELECT COUNT(*) AS n FROM wisdom_sources")[0]["n"] == 0
    env.fail = False
    assert tr.ingest_new()["written"] == 1  # control: the next run writes it


def test_a_dry_run_writes_nothing(env):
    _seed()
    out = tr.ingest_new(dry_run=True)
    assert out["actions"] == {"would_new": 1}
    assert _rows("SELECT COUNT(*) AS n FROM wisdom_sources")[0]["n"] == 0 and env.objects == {}


def test_an_unlabeled_transcript_keeps_colon_text_and_no_speaker():
    v = _seed(cues=((5, None, "Note: this is not a speaker"), (30, None, "plain line"), (70, None, "more")))
    tr.ingest_video(v["id"])
    segs = _rows("SELECT speaker_label, author_id, speaker_confidence, text FROM wisdom_segments")
    assert all(s["speaker_label"] is None and s["speaker_confidence"] == "low" for s in segs)
    assert any("Note: this is not a speaker" in s["text"] for s in segs)


def test_segments_follow_chapters_and_size_bounds():
    cues = tuple((t, "Patrick (TSDR)", f"line {t}") for t in range(0, 400, 10))
    v = _seed(cues=cues, chapters=[{"t": 0, "title": "Open"}, {"t": 200, "title": "NVDA"}])
    tr.ingest_video(v["id"])
    segs = _rows("SELECT path, t_start_s, t_end_s FROM wisdom_segments ORDER BY ordinal")
    assert {s["path"] for s in segs} == {"Open", "NVDA"}
    assert all(s["t_end_s"] - s["t_start_s"] <= tr.WINDOW_MAX_S + 10 for s in segs)
    assert segs[0]["t_start_s"] == 0


def test_transcript_coverage_summary():
    ok = _seed(cues=((5, None, "a"), (3590, None, "b")), duration="1:00:00")
    short = _seed(cues=((5, None, "a"), (345, None, "b")), duration="1:53:50", category="Interviews")
    tr.ingest_new()
    with store.read() as conn:
        cov = tr.transcript_coverage(conn)
    assert cov["sources"] == 2 and cov["incomplete_total"] == 1
    assert cov["by_stream"]["interview"]["incomplete"] == 1
    assert [r["external_ref"] for r in cov["incomplete"]] == [f"edu_videos:{short['id']}"]
    assert f"edu_videos:{ok['id']}" not in {r["external_ref"] for r in cov["incomplete"]}


def test_guests_come_from_the_title_and_never_include_team():
    assert tr.guests_from("Workshop with Stockbee — September 11, 2026") == ["Stockbee"]
    assert tr.guests_from("BROS Discussing Stocks featuring @Bracco and @CregwithaG") == ["CregwithaG"]
    assert tr.guests_from("Fireside chat: Moonlight and Stocks with Bracco, TSDR and CregwithaG") == ["CregwithaG"]
    assert tr.guests_from("Live Trading Session — June 24, 2026") == []


# ═════════════════════════════════════════════════════════════════════════════
# 2026-09-13 — ADVERSARIAL REVIEW (S-C), reviewer checklist item 1:
# "does the resolver INVENT an entity when a label is unmapped?"  It did. Twice.
# CONTRACTS §8a.2 + §8b.2 (drift #3/#4 — "the resolver invented a person").
# ═════════════════════════════════════════════════════════════════════════════

def test_an_ambiguous_host_label_is_never_minted_into_a_guest():
    """⛔ R3. `author_for_alias('Uncharted Territory')` answers None because the label is
    AMBIGUOUS, so `guests_from` read it out of a title and `speaker_resolver` returned
    author_id `guest:uncharted-territory` — an entity nobody declared, from a title
    heuristic. MUTANT: revert `_is_not_a_guest` to `_is_team_or_author` and this reds."""
    from api.services.wisdom.core import authors as wa

    assert wa.is_ambiguous_label("Uncharted Territory")  # control: it IS the ruled label
    assert tr.guests_from("Workshop with Uncharted Territory — Sept 11, 2026") == []
    # control: a REAL guest in the identical title shape is still extracted
    assert tr.guests_from("Workshop with Stockbee — Sept 11, 2026") == ["Stockbee"]


@pytest.mark.parametrize("label", ["Uncharted Territory", "Patrick", "Blake", "Manav"])
def test_every_ambiguous_label_resolves_to_team_unresolved(label):
    """⛔ R4. §8a.2: insufficient evidence -> speaker `team-unresolved` (MENTION only),
    and authors.json says in terms "never dropped as an attendee". Both wrong answers
    were live: WITH the label in the title it became a minted guest, WITHOUT it an
    anonymous attendee — so the host's own words were filed as a member's.
    MUTANT: delete the `is_ambiguous_label` branch in `speaker_resolver.resolve`."""
    from api.services.wisdom.core import authors as wa

    got = tr.speaker_resolver([label])(label)   # the title-derived case, the worse one
    assert got["kind"] == "team_unresolved"
    assert got["author_id"] == wa.TEAM_UNRESOLVED
    assert got["speaker_label"] == wa.TEAM_UNRESOLVED   # never the raw name: "Patrick" is
    assert got["author_id"] not in {a["author_id"] for a in wa.authors()}  # also an attendee's
    # control: an ordinary guest in the same call still resolves as a guest
    guest = tr.speaker_resolver(["Stockbee"])("Stockbee")
    assert guest["kind"] == "guest" and guest["author_id"] == "guest:stockbee"


def test_an_ambiguous_speaker_never_reaches_a_segment_or_the_r2_text(env):
    """End to end: the raw ambiguous label must not be stored in any column, and the
    §8a.2 evidence log must be WRITTEN — `speaker_resolution_json` has existed in
    wisdom-db-v0.sql since the ruling and nothing wrote it (R4b), partly because
    `common._SOURCE_COLUMNS` did not name it, so a caller that set it wrote nothing."""
    import gzip
    import json as _json
    from api.services.wisdom.core import authors as wa

    v = _seed(title="Workshop with Uncharted Territory", category="Workshops & Fireside Chats",
              cues=((5, "Uncharted Territory", "NVDA over 150 is the trigger"),
                    (3550, "Patrick (TSDR)", "that is the close")), duration="1:00:00")
    out = tr.ingest_video(v["id"])
    assert out["action"] == "new" and out["ambiguous_labels"] == 1

    seg = _rows("SELECT * FROM wisdom_segments WHERE source_id = ? ORDER BY ordinal", out["source_id"])
    assert seg[0]["author_id"] == wa.TEAM_UNRESOLVED
    assert seg[0]["speaker_label"] == wa.TEAM_UNRESOLVED
    assert seg[1]["author_id"] == "tsdr"                      # control: the real author still resolves

    src = _rows("SELECT * FROM wisdom_sources WHERE source_id = ?", out["source_id"])[0]
    logged = _json.loads(src["speaker_resolution_json"])
    assert [e["label"] for e in logged["labels"]] == ["Uncharted Territory"]
    assert logged["labels"][0]["resolved_to"] == wa.TEAM_UNRESOLVED
    assert logged["labels"][0]["evidence"] == []              # no evidence cited, and it says so

    raw = gzip.decompress(env.objects[src["raw_r2_key"]][0]).decode("utf-8")
    assert "guest:" not in raw
    assert "NVDA over 150" in raw                             # control: the words are kept
