"""Wave 11 lane 11A -- voice and meeting notes.

`/api/j2/voice-notes/*` (api/routers/notebook_voice_notes.py) over
api/services/journal_two/voice_notes.py. The rails, each named for what it
would catch:

  * DARK: the gate unset answers 404 on every route BEFORE a credential is read.
  * PAID: a free member reads the paid sentence on every route -- the Desk list
    and the Desk summary included (Desk transcripts are paid content).
  * CHUNKING ORDER: the parts are transcribed and assembled in PLAYBACK order
    (numeric, not lexical), one at a time, each billed once; a real ffmpeg split
    when the box has ffmpeg.
  * THE CAP: a recording longer than the minutes left this month is refused
    BEFORE any part is transcribed, with both numbers in the sentence; nothing
    is left on disk; an admin is uncapped.
  * RETRY KEEPS THE RECORDING: a failed part leaves the job and the untranscribed
    parts in place, the same call resumes at the failed part, and nothing is
    transcribed or billed twice.
  * THE SUMMARY IS VALIDATED: a ticker the transcript does not support is
    dropped (an invented one, and RS said as a word); a summary naming an
    unsaid ticker or number is dropped whole; action items are plain text; a
    malformed or failed answer still returns the transcript, refunded.
  * DESK SOURCE: paid-only, transcript-bearing sessions only, no new
    transcription, an unknown session is a 404.
  * PURGE: account deletion removes the member's in-flight audio (no table is
    added, so the manifest is untouched -- `tools/account_deletion_manifest.py
    --check` stays green).
  * THE SANDBOX STUB cannot be enabled on Railway or beside a real model key.

No vendor is ever called: Whisper is `voice_notes.transcribe_part`, the model is
`voice_notes.complete`, ffmpeg is `voice_notes.split_audio`/`probe_duration` --
each replaced per test (the one real-ffmpeg test makes no network call).
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import note_ask
from api.services.journal_two import voice_notes as vn

BASE = "/api/j2/voice-notes"
DAY = "2026-10-01"
SPEECH = ("I'm watching NVDA for a breakout over last week's high, and I need to set a stop "
          "on AMD below the 50-day. The RS line is strong. Review my position size before the open.")


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    try:
        os.unlink(tmp.name)
    except OSError:
        pass


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    from api.services import daily_counters
    monkeypatch.setattr(note_ask, "_et_day", lambda: DAY)
    for k in ("NOTEBOOK_VOICE_NOTES_PERUSER_CAP", vn.SANDBOX_STUB_ENV, "AI_POPULATION_CAP_MODE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(vn, "jobs_root", lambda: tmp_path / "voice-jobs")
    monkeypatch.setattr(vn, "transcription_available", lambda: True)
    daily_counters.clear()
    with vn._JOBS_LOCK:
        vn._JOBS.clear()
    with note_ask._synth_lock:
        note_ask._inflight.clear()
    yield
    with vn._JOBS_LOCK:
        vn._JOBS.clear()


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv(vn.GATE, "1")


@pytest.fixture
def app(db_path):
    from api.routers import notebook_voice_notes
    fa = FastAPI()
    fa.include_router(notebook_voice_notes.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _seed_user(user_id, role="member"):
    """voice_usage_monthly carries a foreign key to users, as production does."""
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role)"
                     " VALUES (?, ?, 'x', 'Test', ?)", (user_id, f"{user_id}@test.local", role))
        conn.commit()
    finally:
        conn.close()


def _as(app, user_id, *, paid=True, role="member"):
    _seed_user(user_id, role)
    user = {"id": user_id, "role": role, "plan": "pro" if paid else "free"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    return user


def _fake_audio(monkeypatch, *, seconds: float, parts: int, order=None):
    """ffprobe answers `seconds`; ffmpeg writes `parts` files, CREATED in `order`
    (default reversed) so a reader that trusted directory order would be wrong."""
    monkeypatch.setattr(vn, "probe_duration", lambda path: seconds)

    def split(src, out_dir, chunk_seconds=vn.CHUNK_SECONDS, **_kw):
        out_dir.mkdir(parents=True, exist_ok=True)
        for i in (order or list(reversed(range(parts)))):
            (out_dir / f"part{i:04d}.flac").write_bytes(b"flac-%d" % i)
        return vn.ordered_parts(out_dir)

    monkeypatch.setattr(vn, "split_audio", split)


def _upload(client, *, name="memo.m4a", data=b"\x00" * 2048, source="upload"):
    return client.post(f"{BASE}/jobs", files={"audio": (name, data, "audio/mp4")},
                       data={"source": source})


def _set_usage(user_id, seconds):
    from api.services import voice_usage
    voice_usage.record_mode_d_seconds(user_id, seconds)


def _used(user_id):
    from api.services import voice_usage
    return voice_usage.get_monthly_usage(user_id)["mode_d_seconds"]


# ── dark and paid ────────────────────────────────────────────────────────────

ROUTES = [("get", "/status"), ("post", "/jobs"), ("post", "/jobs/x/transcribe"),
          ("post", "/jobs/x/summarize"), ("delete", "/jobs/x"), ("get", "/desk-sessions"),
          ("post", "/desk-sessions/1/summarize")]


@pytest.mark.parametrize("method,path", ROUTES)
def test_the_gate_off_is_a_404_before_any_credential_is_read(client, method, path):
    # No override: a gate that let the request through would 401 on the cookie.
    r = getattr(client, method)(BASE + path)
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}


@pytest.mark.parametrize("method,path", ROUTES)
def test_a_free_member_reads_the_paid_sentence_on_every_route(client, app, gate_on, method, path):
    _as(app, "free-1", paid=False)
    r = getattr(client, method)(BASE + path)
    assert r.status_code == 402
    assert r.json()["detail"] == vn.PAID_SENTENCE


def test_the_gate_is_read_per_request(client, app, monkeypatch):
    _as(app, "m1")
    assert client.get(f"{BASE}/status").status_code == 404
    monkeypatch.setenv(vn.GATE, "1")
    assert client.get(f"{BASE}/status").status_code == 200
    monkeypatch.setenv(vn.GATE, "0")
    assert client.get(f"{BASE}/status").status_code == 404


def test_the_flag_rides_the_auth_payload_and_is_off_by_default(monkeypatch):
    from api.routers import auth
    assert auth.NOTEBOOK_FLAGS["NOTEBOOK_VOICE_NOTES_ENABLED"] is False
    monkeypatch.delenv(vn.GATE, raising=False)
    assert auth._notebook_flags()["notebook_voice_notes_enabled"] is False
    monkeypatch.setenv(vn.GATE, "1")
    assert auth._notebook_flags()["notebook_voice_notes_enabled"] is True


# ── chunking order ───────────────────────────────────────────────────────────

def test_parts_are_ordered_by_their_NUMBER_not_their_name(tmp_path):
    for i in (10, 2, 9, 0, 1):
        (tmp_path / f"part{i}.flac").write_bytes(b"x")
    (tmp_path / "upload.m4a").write_bytes(b"x")          # never a part
    assert [p.name for p in vn.ordered_parts(tmp_path)] == [
        "part0.flac", "part1.flac", "part2.flac", "part9.flac", "part10.flac"]


def test_part_seconds_bill_full_parts_and_the_remainder():
    assert vn.part_seconds(660.2, 3) == [300, 300, 61]
    assert sum(vn.part_seconds(660.2, 3)) == 661
    assert vn.part_seconds(0.4, 1) == [1]
    # A sliver under 2 s rides on the last full part instead of being its own part.
    assert vn.part_count(601.5) == 2 and vn.part_seconds(601.5, 2) == [300, 302]
    assert vn.part_count(603) == 3 and vn.part_count(300) == 1 and vn.part_count(3600) == 12


def test_parts_are_transcribed_and_assembled_in_order_and_each_billed_once(client, app, gate_on, monkeypatch):
    user = _as(app, "m-order")
    _fake_audio(monkeypatch, seconds=660.2, parts=3)
    seen = []

    def whisper(path, index):
        seen.append((index, path.name))
        return f"text of {path.name}"

    monkeypatch.setattr(vn, "transcribe_part", whisper)
    r = _upload(client)
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["parts"] == 3 and job["done"] == 0 and job["finished"] is False
    jdir = vn.jobs_root() / job["jobId"]
    assert not (jdir / "upload.m4a").exists(), "the original is deleted at the split"

    progress = []
    for _ in range(3):
        step = client.post(f"{BASE}/jobs/{job['jobId']}/transcribe").json()
        progress.append((step["done"], step["finished"]))
    assert progress == [(1, False), (2, False), (3, True)]
    assert seen == [(0, "part0000.flac"), (1, "part0001.flac"), (2, "part0002.flac")]
    assert vn.get_job(user["id"], job["jobId"]).transcript == (
        "text of part0000.flac\n\ntext of part0001.flac\n\ntext of part0002.flac")
    assert _used(user["id"]) == 661
    assert not jdir.exists(), "the audio is deleted the moment the last part lands"

    # A fourth call is a no-op: nothing re-transcribed, nothing re-billed.
    again = client.post(f"{BASE}/jobs/{job['jobId']}/transcribe").json()
    assert again["finished"] is True and len(seen) == 3 and _used(user["id"]) == 661


@pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="no ffmpeg on this box")
def test_a_real_ffmpeg_split_yields_ordered_parts_under_the_vendor_limit(tmp_path):
    src = tmp_path / "tone.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=12", str(src)], check=True, timeout=60)
    assert abs(vn.probe_duration(src) - 12.0) < 0.2
    parts = vn.split_audio(src, tmp_path / "parts", chunk_seconds=5, duration=vn.probe_duration(src))
    assert [p.name for p in parts] == ["part0000.flac", "part0001.flac", "part0002.flac"]
    durations = [vn.probe_duration(p) for p in parts]
    assert all(d is not None for d in durations), durations
    assert abs(sum(durations) - 12.0) < 0.5 and durations[-1] < durations[0]
    assert [round(d) for d in durations] == [5, 5, 2]
    from api.services import voice_openai
    assert all(p.stat().st_size < voice_openai.MAX_AUDIO_BYTES for p in parts)
    # A BROWSER recording: MediaRecorder streams its WebM, so the header carries no
    # duration. It is measured by decoding, then split like any other file.
    streamed = tmp_path / "streamed.webm"
    with open(streamed, "wb") as out:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                        "sine=frequency=300:duration=8", "-c:a", "libopus", "-f", "webm", "pipe:1"],
                       stdout=out, check=True, timeout=60)
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json",
                            str(streamed)], capture_output=True, text=True, check=True)
    assert "duration" not in json.loads(probe.stdout).get("format", {}), "precondition: no header duration"
    d = vn.probe_duration(streamed)
    assert d is not None and abs(d - 8.0) < 0.3
    sparts = vn.split_audio(streamed, tmp_path / "sparts", chunk_seconds=3, duration=d)
    assert [round(vn.probe_duration(p)) for p in sparts] == [3, 3, 2]
    # A file with no audio stream is unreadable, never a zero-length "recording".
    (tmp_path / "text.mp3").write_bytes(b"not audio at all")
    assert vn.probe_duration(tmp_path / "text.mp3") is None


# ── the cap ──────────────────────────────────────────────────────────────────

def _never_transcribe(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a refused recording must never reach Whisper")
    monkeypatch.setattr(vn, "transcribe_part", boom)


def test_a_recording_longer_than_the_minutes_left_is_refused_before_any_transcription(
        client, app, gate_on, monkeypatch):
    user = _as(app, "m-cap")
    _set_usage(user["id"], 3600 - 120)                 # two minutes left
    _fake_audio(monkeypatch, seconds=300, parts=1)
    _never_transcribe(monkeypatch)
    r = _upload(client)
    assert r.status_code == 429
    assert r.json()["detail"] == vn.CAP_SHORT_SENTENCE.format(need=5, left=2)
    assert not any(vn.jobs_root().iterdir()) if vn.jobs_root().exists() else True
    assert vn._JOBS == {}
    assert _used(user["id"]) == 3600 - 120, "a refusal bills nothing"


def test_a_spent_month_reads_the_used_up_sentence(client, app, gate_on, monkeypatch):
    user = _as(app, "m-spent")
    _set_usage(user["id"], 3600)
    _fake_audio(monkeypatch, seconds=30, parts=1)
    _never_transcribe(monkeypatch)
    r = _upload(client)
    assert r.status_code == 429
    assert r.json()["detail"] == vn.CAP_USED_SENTENCE.format(cap=60)


def test_another_open_job_holds_its_minutes(client, app, gate_on, monkeypatch):
    """Two uploads made together cannot both spend the same minutes."""
    user = _as(app, "m-two")
    _set_usage(user["id"], 3600 - 600)                 # ten minutes left
    _fake_audio(monkeypatch, seconds=420, parts=2)     # seven
    assert _upload(client).status_code == 200
    r = _upload(client)                                # seven more: only three left
    assert r.status_code == 429
    assert r.json()["detail"] == vn.CAP_SHORT_SENTENCE.format(need=7, left=3)


def test_an_admin_is_uncapped_as_for_dictation(client, app, gate_on, monkeypatch):
    user = _as(app, "a-1", role="admin")
    _set_usage(user["id"], 3600)
    _fake_audio(monkeypatch, seconds=300, parts=1)
    assert _upload(client).status_code == 200


def test_the_length_limit_and_the_file_type_are_refused_up_front(client, app, gate_on, monkeypatch):
    _as(app, "m-len")
    _fake_audio(monkeypatch, seconds=vn.MAX_AUDIO_SECONDS + 60, parts=13)
    _never_transcribe(monkeypatch)
    r = _upload(client)
    assert r.status_code == 413 and r.json()["detail"] == vn.TOO_LONG_SENTENCE
    r = _upload(client, name="notes.pdf")
    assert r.status_code == 415 and r.json()["detail"] == vn.BAD_TYPE_SENTENCE
    r = _upload(client, data=b"")
    assert r.status_code == 400 and r.json()["detail"] == vn.EMPTY_AUDIO_SENTENCE
    monkeypatch.setattr(vn, "probe_duration", lambda p: None)
    r = _upload(client)
    assert r.status_code == 422 and r.json()["detail"] == vn.UNREADABLE_SENTENCE
    assert vn._JOBS == {}


# ── a failure keeps the recording ────────────────────────────────────────────

def test_a_failed_part_keeps_the_upload_and_the_same_call_resumes_there(client, app, gate_on, monkeypatch):
    user = _as(app, "m-retry")
    _fake_audio(monkeypatch, seconds=900, parts=3)
    calls = []
    fail_once = {"armed": True}

    def flaky(path, index):
        calls.append(index)
        if index == 1 and fail_once["armed"]:
            fail_once["armed"] = False
            raise RuntimeError("Whisper 500")
        return f"p{index}"

    monkeypatch.setattr(vn, "transcribe_part", flaky)
    job = _upload(client).json()
    jid = job["jobId"]
    assert client.post(f"{BASE}/jobs/{jid}/transcribe").status_code == 200
    r = client.post(f"{BASE}/jobs/{jid}/transcribe")
    assert r.status_code == 502
    assert r.json()["detail"] == vn.TRANSCRIBE_FAILED_SENTENCE.format(n=2, total=3)
    # The recording is still there: the job, and every part not yet transcribed.
    parts_dir = vn.jobs_root() / jid / "parts"
    assert sorted(p.name for p in parts_dir.iterdir()) == ["part0000.flac", "part0001.flac", "part0002.flac"]
    assert _used(user["id"]) == 300, "only the part that landed is billed"
    # Retry: the same call, from the failed part.
    assert client.post(f"{BASE}/jobs/{jid}/transcribe").json()["done"] == 2
    assert client.post(f"{BASE}/jobs/{jid}/transcribe").json()["finished"] is True
    assert calls == [0, 1, 1, 2], "part 1 is retried; part 0 is never transcribed twice"
    assert _used(user["id"]) == 900
    assert vn.get_job(user["id"], jid).transcript == "p0\n\np1\n\np2"


def test_another_members_job_reads_as_gone(client, app, gate_on, monkeypatch):
    _as(app, "owner")
    _fake_audio(monkeypatch, seconds=30, parts=1)
    jid = _upload(client).json()["jobId"]
    _as(app, "stranger")
    for method, path in (("post", f"/jobs/{jid}/transcribe"), ("post", f"/jobs/{jid}/summarize")):
        r = getattr(client, method)(BASE + path)
        assert r.status_code == 404 and r.json()["detail"] == vn.JOB_GONE_SENTENCE
    client.delete(f"{BASE}/jobs/{jid}")
    assert jid in vn._JOBS, "a stranger's Discard deletes nothing"


def test_discard_and_the_sweep_delete_the_audio(client, app, gate_on, monkeypatch):
    _as(app, "m-del")
    _fake_audio(monkeypatch, seconds=30, parts=1)
    jid = _upload(client).json()["jobId"]
    assert (vn.jobs_root() / jid).exists()
    assert client.delete(f"{BASE}/jobs/{jid}").json() == {"ok": True}
    assert not (vn.jobs_root() / jid).exists() and jid not in vn._JOBS
    jid2 = _upload(client).json()["jobId"]
    vn._JOBS[jid2].touched = time.time() - vn.JOB_TTL_SECONDS - 1
    assert vn.sweep() == 1
    assert not (vn.jobs_root() / jid2).exists() and jid2 not in vn._JOBS


# ── the summary, validated ───────────────────────────────────────────────────

def _finished_job(client, monkeypatch, text=SPEECH):
    _fake_audio(monkeypatch, seconds=60, parts=1)
    monkeypatch.setattr(vn, "transcribe_part", lambda p, i: text)
    jid = _upload(client).json()["jobId"]
    assert client.post(f"{BASE}/jobs/{jid}/transcribe").json()["finished"] is True
    return jid


def _model(monkeypatch, answer, calls=None):
    async def fake(kwargs):
        if calls is not None:
            calls.append(kwargs)
        if isinstance(answer, Exception):
            raise answer
        return answer if isinstance(answer, str) else json.dumps(answer)
    monkeypatch.setattr(vn, "complete", fake)


def test_an_invented_ticker_is_dropped_and_a_said_one_is_kept():
    out = vn.validate_answer(json.dumps({
        "summary": "Watching NVDA for a breakout; a stop on AMD below the 50-day.",
        "tickers": ["NVDA", "$AMD", "TSLA", "RS", "nvda"],
        "actionItems": []}), SPEECH)
    assert out["tickers"] == ["NVDA", "AMD"]
    # The precondition that makes the RS case meaningful: RS IS a real symbol.
    from api.services import buzz_universe
    assert "RS" in buzz_universe.symbols()


def test_a_summary_naming_an_unsaid_ticker_or_number_is_dropped_whole():
    bad_ticker = vn.validate_answer(json.dumps({
        "summary": "You like NVDA and TSLA here.", "tickers": [], "actionItems": []}), SPEECH)
    bad_number = vn.validate_answer(json.dumps({
        "summary": "Set a stop on AMD at 142.50.", "tickers": [], "actionItems": []}), SPEECH)
    good = vn.validate_answer(json.dumps({
        "summary": "A stop on AMD below the 50-day.", "tickers": [], "actionItems": []}), SPEECH)
    assert bad_ticker["summary"] == "" and bad_number["summary"] == ""
    assert good["summary"] == "A stop on AMD below the 50-day."


def test_action_items_are_plain_text_and_grounded():
    out = vn.validate_answer(json.dumps({"summary": "", "tickers": [], "actionItems": [
        "- [ ] **Set a stop** on AMD below the 50-day",
        "1. Review position size",
        "Buy 500 shares of NVDA",                       # 500 was never said
        "Call the broker about margin",                  # shares no word with the transcript
        {"text": "not a string"}, "", "Review position size"]}), SPEECH)
    assert out["actionItems"] == ["Set a stop on AMD below the 50-day", "Review position size"]


def test_a_malformed_answer_is_no_answer():
    assert vn.validate_answer("Sure! Here is your summary.", SPEECH) is None
    assert vn.validate_answer("", SPEECH) is None


def test_the_route_answers_the_validated_result_with_the_transcript(client, app, gate_on, monkeypatch):
    _as(app, "m-sum")
    jid = _finished_job(client, monkeypatch)
    calls = []
    _model(monkeypatch, {"summary": "Watching NVDA for a breakout.", "tickers": ["NVDA", "TSLA"],
                         "actionItems": ["Review my position size"]}, calls)
    r = client.post(f"{BASE}/jobs/{jid}/summarize")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["transcript"] == SPEECH and body["source"] == "upload"
    assert body["tickers"] == ["NVDA"] and body["actionItems"] == ["Review my position size"]
    assert body["ai"]["ok"] is True and body["ai"]["model"]
    # The prompt boundary: the transcript rides in the fence, never the system prompt.
    assert len(calls) == 1 and SPEECH not in calls[0]["system"]
    assert "<<UCT-TEXT BEGIN>>" in calls[0]["messages"][0]["content"]
    assert "tools" not in calls[0] and "temperature" not in calls[0]
    assert note_ask.voice_note_used("m-sum", day=DAY) == 1


@pytest.mark.parametrize("answer,sentence", [
    ("not json at all", vn.AI_FAILED_SENTENCE),
    (RuntimeError("provider went away"), vn.AI_FAILED_SENTENCE),
])
def test_a_failed_summary_still_answers_the_transcript_and_refunds(client, app, gate_on, monkeypatch,
                                                                   answer, sentence):
    _as(app, "m-fail")
    jid = _finished_job(client, monkeypatch)
    _model(monkeypatch, answer)
    body = client.post(f"{BASE}/jobs/{jid}/summarize").json()
    assert body["transcript"] == SPEECH
    assert body["ai"] == {"ok": False, "model": body["ai"]["model"], "sentence": sentence}
    assert body["summary"] == "" and body["tickers"] == [] and body["actionItems"] == []
    assert note_ask.voice_note_used("m-fail", day=DAY) == 0, "a failed summary costs nothing"
    assert note_ask.inflight("m-fail") == 0


def test_an_answer_with_nothing_usable_is_labelled_unusable(client, app, gate_on, monkeypatch):
    _as(app, "m-empty")
    jid = _finished_job(client, monkeypatch)
    _model(monkeypatch, {"summary": "TSLA ripped.", "tickers": ["TSLA"], "actionItems": []})
    body = client.post(f"{BASE}/jobs/{jid}/summarize").json()
    assert body["ai"]["ok"] is False and body["ai"]["sentence"] == vn.AI_UNUSABLE_SENTENCE
    assert body["transcript"] == SPEECH


def test_the_daily_count_refuses_the_summary_never_the_transcript(client, app, gate_on, monkeypatch):
    _as(app, "m-budget")
    monkeypatch.setenv("NOTEBOOK_VOICE_NOTES_PERUSER_CAP", "0")
    jid = _finished_job(client, monkeypatch)
    calls = []
    _model(monkeypatch, {"summary": "x", "tickers": [], "actionItems": []}, calls)
    body = client.post(f"{BASE}/jobs/{jid}/summarize").json()
    assert calls == [], "a refused summary never reaches the model"
    assert body["ai"]["sentence"] == vn.AI_BUDGET_SENTENCE and body["transcript"] == SPEECH


def test_no_speech_is_said_rather_than_saved(client, app, gate_on, monkeypatch):
    _as(app, "m-silent")
    jid = _finished_job(client, monkeypatch, text="   ")
    r = client.post(f"{BASE}/jobs/{jid}/summarize")
    assert r.status_code == 422 and r.json()["detail"] == vn.NO_SPEECH_SENTENCE


def test_a_summary_before_the_last_part_is_refused(client, app, gate_on, monkeypatch):
    _as(app, "m-early")
    _fake_audio(monkeypatch, seconds=400, parts=2)
    jid = _upload(client).json()["jobId"]
    r = client.post(f"{BASE}/jobs/{jid}/summarize")
    assert r.status_code == 409 and r.json()["detail"] == vn.NOT_READY_SENTENCE


def test_a_long_transcript_is_sampled_for_the_model_never_cut_after_the_first_hour():
    t = "".join(f"[{i}] " + "word " * 40 for i in range(2000))
    sent = vn._model_text(t)
    assert len(sent) < vn.MAX_MODEL_CHARS + 100
    assert sent.startswith("[0]") and "[1999]" in sent


# ── the Desk source ──────────────────────────────────────────────────────────

@pytest.fixture
def desk(monkeypatch, tmp_path):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    with_t = es.create_video({"youtube_id": "aaaaaaaaaaa", "title": "Live Trading — Oct 1, 2026",
                              "category": "Live Trading Sessions"})
    es.set_video_insights(with_t["id"], transcript=(
        "[0:05] Good morning, NVDA is holding the gap.\n[0:40] Watching AMD for a reclaim.\n"
        "[1:20] Set alerts on both before lunch."))
    without = es.create_video({"youtube_id": "bbbbbbbbbbb", "title": "Workshop", "category": "Workshops"})
    return {"with": with_t["id"], "without": without["id"]}


def test_the_desk_list_holds_only_sessions_with_a_transcript(client, app, gate_on, desk):
    _as(app, "m-desk")
    sessions = client.get(f"{BASE}/desk-sessions").json()["sessions"]
    assert [s["id"] for s in sessions] == [desk["with"]]
    assert "transcript" not in sessions[0], "the list never carries transcript text"


def test_a_desk_summary_reuses_the_stored_transcript_with_no_transcription(
        client, app, gate_on, desk, monkeypatch):
    _as(app, "m-desk2")
    _never_transcribe(monkeypatch)
    _model(monkeypatch, {"summary": "NVDA held the gap; watching AMD.", "tickers": ["NVDA", "AMD"],
                         "actionItems": ["Set alerts on both before lunch"]})
    body = client.post(f"{BASE}/desk-sessions/{desk['with']}/summarize").json()
    assert body["source"] == "desk" and body["desk"]["id"] == desk["with"]
    assert body["transcript"].startswith("[0:05] Good morning, NVDA is holding the gap.")
    assert body["tickers"] == ["NVDA", "AMD"]


def test_a_desk_session_without_a_transcript_is_a_404(client, app, gate_on, desk):
    _as(app, "m-desk3")
    for vid in (desk["without"], 999999):
        r = client.post(f"{BASE}/desk-sessions/{vid}/summarize")
        assert r.status_code == 404 and r.json()["detail"] == vn.DESK_NOT_FOUND_SENTENCE


# ── account deletion ─────────────────────────────────────────────────────────

def test_account_deletion_removes_the_members_audio_and_only_theirs(db_path, monkeypatch):
    from api.services import auth_db
    from api.services.journal_two import account_purge
    _fake_audio(monkeypatch, seconds=30, parts=1)
    mine = vn.create_job({"id": "gone", "role": "member"}, "upload", "a.m4a", _Bytes(b"x" * 10))
    theirs = vn.create_job({"id": "stays", "role": "member"}, "upload", "b.m4a", _Bytes(b"x" * 10))
    conn = auth_db.get_connection()
    try:
        report = account_purge.purge_user_data("gone", conn)
    finally:
        conn.close()
    assert report["voice_jobs_removed"] == 1
    assert not mine.dir.exists() and mine.id not in vn._JOBS
    assert theirs.dir.exists() and theirs.id in vn._JOBS


class _Bytes:
    def __init__(self, data):
        self._data, self._at = data, 0

    def read(self, n=-1):
        chunk = self._data[self._at:] if n < 0 else self._data[self._at:self._at + n]
        self._at += len(chunk)
        return chunk


def test_the_upload_is_capped_while_it_is_read(monkeypatch):
    monkeypatch.setattr(vn, "MAX_UPLOAD_BYTES", 1000)
    _fake_audio(monkeypatch, seconds=30, parts=1)
    with pytest.raises(vn.VoiceNoteError) as e:
        vn.create_job({"id": "big", "role": "member"}, "upload", "a.m4a", _Bytes(b"x" * 5000))
    assert e.value.status == 413
    assert not any(vn.jobs_root().iterdir())


# ── the sandbox stub cannot reach production ─────────────────────────────────

def test_the_sandbox_stub_is_impossible_on_railway_or_beside_a_real_key(monkeypatch):
    monkeypatch.setenv(vn.SANDBOX_STUB_ENV, "1")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    assert vn.sandbox_stub_active() is True                      # control: it CAN be on
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    assert vn.sandbox_stub_active() is False
    monkeypatch.delenv("RAILWAY_ENVIRONMENT")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-real")
    assert vn.sandbox_stub_active() is False
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real")
    assert vn.sandbox_stub_active() is False
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv(vn.SANDBOX_STUB_ENV, "true")               # only the literal 1
    assert vn.sandbox_stub_active() is False


def test_the_stub_answers_are_fixed_and_carry_an_invented_ticker(monkeypatch):
    monkeypatch.setenv(vn.SANDBOX_STUB_ENV, "1")
    for k in ("RAILWAY_ENVIRONMENT", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    text = vn.transcribe_part(Path("unused.flac"), 0)
    raw = asyncio.run(vn.complete({}))
    out = vn.validate_answer(raw, text)
    assert "TSLA" in raw and out["tickers"] == ["NVDA", "AMD"]


def test_the_stub_fail_once_marker_fails_part_two_once_and_only_in_the_stub(db_path, monkeypatch):
    """The sandbox walk drives Retry in a real browser through this; outside the stub
    the marker is never written and never read."""
    _fake_audio(monkeypatch, seconds=700, parts=3)
    job = vn.create_job({"id": "w", "role": "admin"}, "upload", "sandbox-fail-once.m4a", _Bytes(b"x"))
    assert not (job.dir / vn._STUB_FAIL_ONCE_MARK).exists(), "no stub, no marker"
    monkeypatch.setenv(vn.SANDBOX_STUB_ENV, "1")
    for k in ("RAILWAY_ENVIRONMENT", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    job2 = vn.create_job({"id": "w", "role": "admin"}, "upload", "sandbox-fail-once.m4a", _Bytes(b"x"))
    assert (job2.dir / vn._STUB_FAIL_ONCE_MARK).exists()
    real = vn.transcribe_part
    assert real(job2.parts[0], 0).startswith("Part 1.")
    with pytest.raises(RuntimeError):
        real(job2.parts[1], 1)
    assert real(job2.parts[1], 1).startswith("Part 2.")
