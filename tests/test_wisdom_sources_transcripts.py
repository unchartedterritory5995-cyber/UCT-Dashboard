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


def _dense(start, stop, step=10, label=None):
    """Cues every `step` seconds — a transcript with no hole in it."""
    return tuple((t, label, f"line {t}") for t in range(start, stop + 1, step))


@pytest.mark.parametrize("cues,duration,expected_span,incomplete", [
    # ⚰️ THE OLD RULE IS GONE (owner ruling 2026-09-14). These four rows used to read
    # (345 -> 1), (6700 -> 0), (6680 -> 1), (no duration -> 0): a pure span test that
    # both re-transcribed complete sessions and scored every duration-less row as fine.
    (_dense(0, 6820), "1:53:50", 0.9985, 0),     # complete, and the span agrees
    (_dense(0, 2790), "1:53:50", 0.4085, 0),     # ⭐ THE 254 SHAPE: span 41%, zero internal
                                                 #   gaps, 1742 s of dead air after the
                                                 #   sign-off. COMPLETE. Under the old rule
                                                 #   this row was a night of re-transcription.
    (_dense(0, 500), None, None, 0),             # no duration: the gap rule still answers
    (_dense(0, 500) + ((900, None, "after a hole"),), None, None, 1),   # ...and still fails
])
def test_incomplete_follows_internal_gaps_and_coverage_stays_the_span(
        cues, duration, expected_span, incomplete):
    v = _seed(cues=cues, duration=duration)
    out = tr.ingest_video(v["id"])
    src = _rows("SELECT coverage_ratio, incomplete FROM wisdom_sources")[0]
    assert src["incomplete"] == incomplete and out["incomplete"] == incomplete
    if expected_span is None:
        assert src["coverage_ratio"] is None
    else:
        assert src["coverage_ratio"] == pytest.approx(expected_span, abs=0.0006)


def test_the_gap_rule_cannot_see_an_end_truncation_and_says_so():
    """⛔⛔ THE BLIND SPOT, ASSERTED RATHER THAN HIDDEN. A transcript running 0 s .. 340 s of
    a 6,830 s session with no internal gap PASSES the owner's rule — there is no hole
    between its first and last word, and "trailing dead air is not a shortfall" cannot
    distinguish that from 254's genuine 1,742 s outro. Duration does not help: it says how
    much silence there is, never whether it was speech you lost.

    This is why `desk_session_insights._trash_gate` keeps the 0.98 SPAN rule for the
    irreversible Zoom delete. If this test ever goes red because the verdict changed to
    'incomplete', the gap rule grew a new clause and the delete gate should be re-read."""
    facts = tr.coverage_verdict([{"t": t} for t in range(0, 341, 10)], 6830)
    assert facts["verdict"] == "complete" and facts["passes"] is True
    assert facts["span_ratio"] == pytest.approx(340 / 6830)   # 5%: what the delete gate reads
    assert facts["trailing_silence_s"] == pytest.approx(6490)
    assert facts["end_verified"] is True   # measured, and still unable to answer the question
    assert facts["span_ratio"] < si.COVERAGE_THRESHOLD


def test_a_transcript_that_begins_late_is_incomplete_even_with_no_internal_gap():
    """⛔ Video 356's stored transcript ran 57 s .. 345 s of a 6,830 s session: 76 dense
    cues, NO internal gap over 30 s. Read "internal gaps only" literally and it is COMPLETE
    — the defect this entire guard was built for, passing. The leading-silence clause
    (transcript_coverage.LEADING_SILENCE_COUNTS) is what stops that, and it reports itself
    under its own reason so a false positive is diagnosable.
    MUTANT: set LEADING_SILENCE_COUNTS = False and this reds."""
    v = _seed(cues=_dense(57, 345, step=4), duration="1:53:50")
    out = tr.ingest_video(v["id"])
    assert out["incomplete"] == 1
    assert out["coverage_verdict"] == "incomplete"
    assert "before the first cue" in out["coverage_reason"]
    facts = tr.coverage_verdict([{"t": t} for t in range(57, 346, 4)], 6830)
    assert facts["reasons"] == ["leading_silence"]          # NOT an internal gap
    assert facts["largest_internal_gap_s"] == 4             # control: the body is dense
    # control: the identical transcript starting on time is complete
    assert tr.coverage_verdict([{"t": t} for t in range(0, 289, 4)], 6830)["passes"] is True


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
    ok = _seed(cues=_dense(0, 3590, 20), duration="1:00:00")
    short = _seed(cues=_dense(0, 200, 5) + ((600, None, "after a 400s hole"),),
                  duration="1:53:50", category="Interviews")
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


# ═════════════════════════════════════════════════════════════════════════════
# 2026-09-14 — THE OWNER'S STT RULES (Wave 1.5). Verbatim:
#   "Coverage gate = internal gaps only (any gap > 30s between the first and last
#    speech cue); trailing dead air after a sign-off is not a shortfall."
#   "VAD is never disabled to raise coverage; hallucination probe recorded as the
#    reason. Add a test that a silent tail produces zero cues."
# Measurement behind them: docs/wisdom/OVERNIGHT-CHECKPOINTS.md checkpoint 11.
# ═════════════════════════════════════════════════════════════════════════════

#: Video 254 (G80NM-hRoas), measured 2026-09-14: 4,532 s of media, speech 0 s .. 2,790 s,
#: zero internal gaps, and the last cue is a sign-off. The 1,742 s after it is dead air.
_254_DURATION_S = 4532
_254_LAST_SPEECH_T = 2790
_254_SIGN_OFF = "All right, guys, ladies and gentlemen, have a great night."


def _session_254():
    cues = [{"t": t, "end": t + 8} for t in range(0, _254_LAST_SPEECH_T, 10)]
    cues.append({"t": _254_LAST_SPEECH_T, "end": _254_LAST_SPEECH_T + 4, "text": _254_SIGN_OFF})
    return cues


def test_a_silent_tail_produces_zero_cues_and_is_not_missing_coverage():
    """⛔ THE RULE THE OWNER RULED, and the control that makes it evidence.

    Video 254's tail was re-driven on purpose: [4100..4532] returned 0 chars — VAD on,
    no speech, no cues. A probe returning nothing is the CORRECT answer for dead air, and
    folding that empty result into the session must add no gap and change no verdict.

    ⭐ The control is the load-bearing half: an absence is only evidence if the instrument
    could have seen a presence. Put ONE real cue in the same tail window and the identical
    code path reports a 1,406 s internal gap and fails — so "zero cues" here means
    "nothing was there", not "the measurement was blind"."""
    session = _session_254()
    silent_tail_probe = []                # what VAD-on actually returned for [4100..4532]
    assert silent_tail_probe == []

    facts = tr.coverage_verdict(session + silent_tail_probe, _254_DURATION_S)
    assert facts["verdict"] == "complete" and facts["passes"] is True
    assert facts["internal_gap_count"] == 0 and facts["largest_internal_gap_s"] <= 30
    assert facts["trailing_silence_s"] == pytest.approx(_254_DURATION_S - (_254_LAST_SPEECH_T + 4))
    assert "not a shortfall" in facts["reason"]
    assert tr.coverage_verdict(session, _254_DURATION_S) == facts   # the empty probe is inert

    # CONTROL — speech in that same window is seen, and fails
    heard = tr.coverage_verdict(session + [{"t": 4200, "end": 4210}], _254_DURATION_S)
    assert heard["verdict"] == "incomplete" and heard["reasons"] == ["internal_gap"]
    assert heard["largest_internal_gap_s"] == pytest.approx(4200 - (_254_LAST_SPEECH_T + 4))


def test_a_sign_off_with_a_long_trailing_gap_passes():
    """⚰️ Video 254 measured 61.6 % on the old span rule and went on the re-transcription
    list. It was complete: every second of the shortfall is AFTER "have a great night".
    MUTANT: charge trailing silence to the verdict and this reds."""
    facts = tr.coverage_verdict(_session_254(), _254_DURATION_S)
    assert facts["passes"] is True
    assert facts["span_ratio"] < si.COVERAGE_THRESHOLD       # the old rule said NO...
    assert facts["trailing_silence_ratio"] > 0.38            # ...on 38 % of trailing dead air
    # and the same shape ingested end to end is not on the incomplete list
    v = _seed(cues=tuple((c["t"], None, c.get("text") or "x") for c in _session_254()),
              duration="1:15:32")
    out = tr.ingest_video(v["id"])
    assert out["incomplete"] == 0 and out["coverage_verdict"] == "complete"


@pytest.mark.parametrize("gap_s,expected", [(29, "complete"), (30, "complete"), (31, "incomplete")])
def test_a_real_internal_gap_over_thirty_seconds_fails(gap_s, expected):
    """The threshold is "gap > 30s", so 30 is not a failure and 31 is. ⛔ The boundary is
    asserted on both sides: a rule tested only above its threshold cannot distinguish the
    threshold from an accident."""
    before = [{"t": t, "end": t + 5} for t in range(0, 600, 10)]
    resume = 595 + gap_s
    after = [{"t": t, "end": t + 5} for t in range(resume, resume + 600, 10)]
    facts = tr.coverage_verdict(before + after, 2000)
    assert facts["verdict"] == expected
    assert facts["largest_internal_gap_s"] == pytest.approx(gap_s)
    if expected == "incomplete":
        assert facts["reasons"] == ["internal_gap"]
        assert facts["internal_gaps"][0]["after_t"] == 595   # names it, never just a count
        assert facts["internal_gap_total_s"] == pytest.approx(gap_s)


def test_one_cue_is_inconclusive_not_a_pass():
    """⛔ `lesson_a_saturated_instrument_reports_zero`: a largest-gap of 0 computed over
    zero pairs is not "no problem". It lands on the list for a human, never off it."""
    facts = tr.coverage_verdict([{"t": 5}], 3600)
    assert facts["verdict"] == "inconclusive" and facts["passes"] is None
    v = _seed(cues=((5, None, "only line"),), duration="1:00:00")
    assert tr.ingest_video(v["id"])["incomplete"] == 1


def test_no_cues_at_all_is_incomplete_and_still_measured():
    """A whole session with no speech cue captured nothing — `incomplete`, not
    `inconclusive`. And with a duration it is MEASURED (span 0.0), because the Zoom delete
    gate branches on `span_ratio is None` to mean "we could not take the measurement"."""
    facts = tr.coverage_verdict([], 6830)
    assert facts["verdict"] == "incomplete" and facts["reasons"] == ["no_cues"]
    assert facts["span_ratio"] == 0.0 and facts["end_verified"] is True
    assert tr.coverage_verdict([], None)["span_ratio"] is None    # genuinely unmeasurable


# ── The VAD rule ──────────────────────────────────────────────────────────────

def _transcribe_kwargs(source: str) -> list:
    """Every `*.transcribe(...)` call's keyword literals, read from the AST.

    ⛔ CODE, NEVER PROSE. A regex over this repo's source has matched its own comments six
    separate times; comments are not in the AST at all, and a docstring naming vad_filter
    is an ast.Constant, never an ast.Call."""
    import ast

    out = []
    for node in ast.walk(ast.parse(source)):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr != "transcribe":
            continue
        out.append({kw.arg: (kw.value.value if isinstance(kw.value, ast.Constant) else "<expr>")
                    for kw in node.keywords if kw.arg})
    return out


def test_vad_stays_on_wherever_this_repo_runs_whisper():
    """⛔⛔ NEVER DISABLE VAD TO RAISE COVERAGE. Owner ruling 2026-09-14.

    The measured reason, and it is why this is a rail and not a preference: video 221 has
    335 s of dead air after its sign-off. Re-driving that tail with vad_filter=False did
    not recover missed speech — it produced the string "All right." ELEVEN TIMES, whisper
    looping on silence. Turning VAD off would push 221's span number toward 100 % by
    MANUFACTURING TRANSCRIPT TEXT OUT OF SILENCE, and that text would then be segmented,
    extracted, scored and attributed to a named author (§8a.2). Since trailing dead air is
    no longer a shortfall at all, there is no coverage number VAD-off could legitimately
    buy — only a worse artifact behind a better-looking one.

    MUTANT: flip vad_filter to False at the call site below, or drop the kwarg -> RED."""
    import pathlib

    from api.services import transcript_coverage as rule

    assert rule.STT_REQUIRED_VAD_FILTER is True
    assert "All right." in rule.STT_VAD_RATIONALE and "ELEVEN" in rule.STT_VAD_RATIONALE

    root = pathlib.Path(__file__).resolve().parents[1]
    path = root / "tools" / "desk_transcript_gapfill.py"
    assert path.exists(), "the committed STT call site moved; re-point this rail"
    calls = _transcribe_kwargs(path.read_text(encoding="utf-8"))

    # NON-VACUITY: an empty result would satisfy every `for` loop below.
    assert calls, f"no *.transcribe(...) call found in {path.name} — a failed read, not a pass"
    assert any("word_timestamps" in c for c in calls), "control: the walker reads real kwargs"
    for c in calls:
        assert c.get("vad_filter") == rule.STT_REQUIRED_VAD_FILTER, (
            f"whisper invoked with vad_filter={c.get('vad_filter')!r}: {rule.STT_VAD_RATIONALE}")

    # CONTROL — the same extractor over a mutant proves it can say no.
    assert _transcribe_kwargs("model.transcribe(p, word_timestamps=False, vad_filter=False)\n") == [
        {"word_timestamps": False, "vad_filter": False}]
    # CONTROL — a docstring and a comment naming the kwarg are NOT call sites.
    assert _transcribe_kwargs('"""call model.transcribe(p, vad_filter=False)"""\n'
                              '# model.transcribe(p, vad_filter=False)\n') == []
