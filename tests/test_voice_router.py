"""Voice router — auth gate, plan gate, /tts streaming, /settings, /usage."""

from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db
from api.services.auth_service import create_user, create_session
from api.services import voice_audio_cache as vac


@pytest.fixture
def client():
    init_db()
    return TestClient(app)


def _login(client, plan="pro", role="member"):
    user = create_user(f"vroute_{__import__('uuid').uuid4()}@example.com", "password123")
    # Force plan + role for test
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user["id"]))
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, ?, 'active')",
            (__import__('uuid').uuid4().hex, user["id"], plan),
        )
        conn.commit()
    finally:
        conn.close()
    token = create_session(user["id"])
    client.cookies.set("uct_session", token)
    return user["id"]


def test_tts_requires_auth(client):
    r = client.post("/api/voice/tts", json={"text": "hi"})
    assert r.status_code == 401


def test_tts_requires_paid_plan(client):
    _login(client, plan="free")
    r = client.post("/api/voice/tts", json={"text": "hi"})
    assert r.status_code == 402


def test_tts_returns_mp3_for_paid_user(client, tmp_path, monkeypatch):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    fake_audio = b"\xFF\xFB\x90\x00FAKEMP3"
    fake_client = object()
    with patch("api.services.voice_openai._get_client", return_value=fake_client), \
         patch(
             "api.routers.voice.synthesize_speech_stream",
             side_effect=lambda *a, **k: iter([fake_audio]),
         ):
        r = client.post("/api/voice/tts", json={"text": "hello world"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.content == fake_audio


def test_tts_serves_from_cache_on_second_call(client, tmp_path, monkeypatch):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    fake_audio = b"\xFF\xFB\x90\x00CACHED"
    fake_client = object()
    with patch("api.services.voice_openai._get_client", return_value=fake_client), \
         patch(
             "api.routers.voice.synthesize_speech_stream",
             side_effect=lambda *a, **k: iter([fake_audio]),
         ) as m:
        r1 = client.post("/api/voice/tts", json={"text": "same text"})
        r2 = client.post("/api/voice/tts", json={"text": "same text"})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.content == r2.content == fake_audio
    assert m.call_count == 1  # second call hit cache


def test_tts_rejects_empty_text(client):
    _login(client, plan="pro")
    r = client.post("/api/voice/tts", json={"text": ""})
    assert r.status_code == 400


def test_tts_prepare_returns_token_then_stream_plays(client, tmp_path, monkeypatch):
    """The progressive flow: POST /prepare -> token, GET /stream?token -> audio."""
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    fake_audio = b"\xFF\xFB\x90\x00STREAMED"
    fake_client = object()
    with patch("api.services.voice_openai._get_client", return_value=fake_client), \
         patch(
             "api.routers.voice.synthesize_speech_stream",
             side_effect=lambda *a, **k: iter([fake_audio]),
         ):
        long_rundown = ("Markets are moving today. " * 500).strip()  # ~12k chars
        p = client.post("/api/voice/tts/prepare", json={"text": long_rundown})
        assert p.status_code == 200
        token = p.json()["token"]
        assert token

        s = client.get(f"/api/voice/tts/stream?token={token}")
    assert s.status_code == 200
    assert s.headers["content-type"].startswith("audio/mpeg")
    assert s.content == fake_audio


def test_tts_prepare_requires_paid_plan(client):
    _login(client, plan="free")
    r = client.post("/api/voice/tts/prepare", json={"text": "hi"})
    assert r.status_code == 402


def test_tts_stream_rejects_unknown_token(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/tts/stream?token=does-not-exist")
    assert r.status_code == 404


def test_tts_stream_token_is_user_scoped(client, tmp_path, monkeypatch):
    """A token minted by one user must not be streamable by another."""
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    with patch("api.services.voice_openai._get_client", return_value=object()):
        token = client.post("/api/voice/tts/prepare", json={"text": "hello there"}).json()["token"]
    # Switch to a different user in the same client.
    _login(client, plan="pro")
    r = client.get(f"/api/voice/tts/stream?token={token}")
    assert r.status_code == 404


def test_tts_accepts_full_morning_wire_length(client, tmp_path, monkeypatch):
    """Regression: an ~11k-char Morning Wire rundown must NOT be rejected as
    'too long' — the synth layer chunks it. Previously a 4000-char cap made
    Read Aloud silently fail on the entire Morning Wire."""
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    long_rundown = ("The market opened higher today. " * 400).strip()  # ~12k chars
    assert len(long_rundown) > 10_000
    fake_audio = b"\xFF\xFB\x90\x00FULLWIRE"
    fake_client = object()
    with patch("api.services.voice_openai._get_client", return_value=fake_client), \
         patch(
             "api.routers.voice.synthesize_speech_stream",
             side_effect=lambda *a, **k: iter([fake_audio]),
         ):
        r = client.post("/api/voice/tts", json={"text": long_rundown})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")


# ── Settings + Usage ────────────────────────────────────────────────────────

def test_settings_get_returns_defaults_for_new_paid_user(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["voice"] == "verse"
    assert body["speed"] == 1.0
    assert body["enabled"] is True


def test_settings_put_persists(client):
    _login(client, plan="pro")
    r = client.put("/api/voice/settings", json={"voice": "ash", "speed": 1.25})
    assert r.status_code == 200
    body = r.json()
    assert body["voice"] == "ash"
    assert body["speed"] == 1.25
    # Re-fetch to confirm
    r2 = client.get("/api/voice/settings")
    assert r2.json()["voice"] == "ash"


def test_settings_put_rejects_invalid_voice(client):
    _login(client, plan="pro")
    r = client.put("/api/voice/settings", json={"voice": "not-real"})
    assert r.status_code == 400


def test_settings_requires_paid(client):
    _login(client, plan="free")
    assert client.get("/api/voice/settings").status_code == 402
    assert client.put("/api/voice/settings", json={"voice": "ash"}).status_code == 402


def test_usage_returns_current_month(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/usage")
    assert r.status_code == 200
    body = r.json()
    assert "year_month" in body
    assert "mode_a_seconds" in body
    assert "cap_seconds" in body
    assert body["mode_a_seconds"] == 0
    assert body["cap_seconds"] > 0


def test_tts_blocked_when_disabled(client, tmp_path, monkeypatch):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")
    # Disable voice in settings
    client.put("/api/voice/settings", json={"enabled": False})
    r = client.post("/api/voice/tts", json={"text": "hello"})
    assert r.status_code == 400
    assert "disabled" in r.json()["detail"].lower()


# ── Oneshot + tools (Slice 2) ──────────────────────────────────────────────

def test_tools_endpoint_requires_auth(client):
    r = client.get("/api/voice/tools")
    assert r.status_code == 401


def test_tools_endpoint_returns_global_tools(client):
    _login(client, plan="pro")
    from api.services import voice_tool_impls  # noqa
    r = client.get("/api/voice/tools?context=global")
    assert r.status_code == 200
    body = r.json()
    names = {t["name"] for t in body["tools"]}
    assert "get_quote" in names
    assert "get_movers" in names


def test_oneshot_requires_auth(client):
    r = client.post("/api/voice/oneshot", files={"audio": ("a.webm", b"FAKE", "audio/webm")})
    assert r.status_code == 401


def test_oneshot_requires_paid(client):
    _login(client, plan="free")
    r = client.post("/api/voice/oneshot", files={"audio": ("a.webm", b"FAKE", "audio/webm")})
    assert r.status_code == 402


def test_oneshot_happy_path(client, tmp_path, monkeypatch):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")

    fake_audio = b"\xFF\xFB\x90\x00FAKEMP3"
    with patch("api.services.voice_openai._get_client", return_value=object()), \
         patch("api.routers.voice.transcribe_audio", return_value="what is NVDA at"), \
         patch("api.routers.voice.run_oneshot", return_value={
             "tool": "get_quote",
             "args": {"symbol": "NVDA"},
             "narration": "NVDA is at 487 dollars, up 2.1 percent.",
             "raw_result": {"symbol": "NVDA", "last": 487.20, "abs_pct": 2.1},
         }), \
         patch("api.routers.voice.synthesize_speech_stream",
               side_effect=lambda *a, **k: iter([fake_audio])):
        r = client.post(
            "/api/voice/oneshot",
            files={"audio": ("a.webm", b"FAKE-AUDIO", "audio/webm")},
            data={"context": "global"},
        )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert "NVDA" in r.headers.get("X-Voice-Transcript", "")
    assert "487" in r.headers.get("X-Voice-Narration", "")
    assert r.content == fake_audio


def test_oneshot_rejects_empty_audio(client):
    _login(client, plan="pro")
    r = client.post(
        "/api/voice/oneshot",
        files={"audio": ("a.webm", b"", "audio/webm")},
        data={"context": "global"},
    )
    assert r.status_code == 400


# ── Dictation endpoint (Mode D — pure STT, no TTS, no intent) ──────────────

def test_transcribe_requires_auth(client):
    r = client.post(
        "/api/voice/transcribe",
        files={"audio": ("a.webm", b"FAKE", "audio/webm")},
    )
    assert r.status_code == 401


def test_transcribe_requires_paid(client):
    _login(client, plan="free")
    r = client.post(
        "/api/voice/transcribe",
        files={"audio": ("a.webm", b"FAKE", "audio/webm")},
    )
    assert r.status_code == 402


def test_transcribe_returns_text_for_paid_user(client):
    _login(client, plan="pro")
    with patch("api.services.voice_openai._get_client", return_value=object()), \
         patch("api.routers.voice.transcribe_audio",
               return_value="add NVDA long position at 142"):
        r = client.post(
            "/api/voice/transcribe",
            files={"audio": ("a.webm", b"FAKE-AUDIO", "audio/webm")},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "add NVDA long position at 142"


def test_transcribe_rejects_empty_audio(client):
    _login(client, plan="pro")
    r = client.post(
        "/api/voice/transcribe",
        files={"audio": ("a.webm", b"", "audio/webm")},
    )
    assert r.status_code == 400


def test_transcribe_records_mode_d_usage(client):
    user_id = _login(client, plan="pro")
    from api.services.voice_usage import get_monthly_usage
    before = get_monthly_usage(user_id).get("mode_d_seconds", 0)
    with patch("api.services.voice_openai._get_client", return_value=object()), \
         patch("api.routers.voice.transcribe_audio", return_value="hello world"):
        r = client.post(
            "/api/voice/transcribe",
            files={"audio": ("a.webm", b"FAKE-AUDIO", "audio/webm")},
        )
    assert r.status_code == 200
    after = get_monthly_usage(user_id).get("mode_d_seconds", 0)
    assert after > before


def test_transcribe_applies_cleanup_when_requested(client):
    _login(client, plan="pro")
    with patch("api.services.voice_openai._get_client", return_value=object()), \
         patch("api.routers.voice.transcribe_audio",
               return_value="um add a in video long"), \
         patch("api.routers.voice.cleanup_transcript",
               return_value="Add an NVDA long.") as mock_cleanup:
        r = client.post(
            "/api/voice/transcribe",
            files={"audio": ("a.webm", b"FAKE-AUDIO", "audio/webm")},
            data={"cleanup": "true"},
        )
    assert r.status_code == 200
    assert r.json()["text"] == "Add an NVDA long."
    mock_cleanup.assert_called_once()


def test_transcribe_skips_cleanup_by_default(client):
    _login(client, plan="pro")
    with patch("api.services.voice_openai._get_client", return_value=object()), \
         patch("api.routers.voice.transcribe_audio", return_value="raw text"), \
         patch("api.routers.voice.cleanup_transcript") as mock_cleanup:
        r = client.post(
            "/api/voice/transcribe",
            files={"audio": ("a.webm", b"FAKE-AUDIO", "audio/webm")},
        )
    assert r.status_code == 200
    assert r.json()["text"] == "raw text"
    mock_cleanup.assert_not_called()


def test_transcribe_blocks_when_cap_exceeded(client):
    user_id = _login(client, plan="pro")
    from api.services.voice_usage import (
        record_mode_d_seconds, MODE_D_DEFAULT_CAP_SECONDS,
    )
    # Saturate the cap
    record_mode_d_seconds(user_id, MODE_D_DEFAULT_CAP_SECONDS + 1)
    r = client.post(
        "/api/voice/transcribe",
        files={"audio": ("a.webm", b"FAKE", "audio/webm")},
    )
    assert r.status_code == 429


# ── Realtime endpoints (Slice 4) ───────────────────────────────────────────

def test_session_token_requires_paid(client):
    _login(client, plan="free")
    r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 402


def test_session_token_returns_ephemeral_secret(client):
    _login(client, plan="pro")
    fake_mint = {"session_id": "sess_x", "client_secret": "ek_secret",
                 "expires_at": 9999999999, "model": "gpt-realtime"}
    with patch("api.routers.voice.mint_realtime_session", return_value=fake_mint):
        r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 200
    body = r.json()
    assert body["client_secret"] == "ek_secret"
    assert body["model"] == "gpt-realtime"
    assert "session_id" in body
    assert "openai_session_id" in body


def test_session_token_blocks_when_cap_exceeded(client):
    _login(client, plan="pro")
    from api.services.voice_usage import record_mode_c_seconds, MODE_C_DEFAULT_CAP_SECONDS
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    record_mode_c_seconds(uid, MODE_C_DEFAULT_CAP_SECONDS)

    fake_mint = {"session_id": "sess_x", "client_secret": "ek", "expires_at": 0, "model": "x"}
    with patch("api.routers.voice.mint_realtime_session", return_value=fake_mint):
        r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 429


def test_exec_requires_paid(client):
    _login(client, plan="free")
    r = client.post("/api/voice/exec", json={"session_id": 1, "tool": "get_quote", "args": {}})
    assert r.status_code == 402


def test_exec_runs_tool_and_returns_envelope(client):
    _login(client, plan="pro")
    from api.services.voice_session_service import create_session
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")

    with patch("api.routers.voice.run_tool", return_value={
        "ok": True, "tool": "get_quote", "result": {"symbol": "NVDA", "last": 487.20},
    }):
        r = client.post("/api/voice/exec", json={
            "session_id": sid, "tool": "get_quote", "args": {"symbol": "NVDA"},
        })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["result"]["symbol"] == "NVDA"


def test_exec_rejects_session_owned_by_another_user(client):
    _login(client, plan="pro")
    from api.services.auth_service import create_user
    from api.services.voice_session_service import create_session
    other = create_user(f"other_{__import__('uuid').uuid4()}@example.com", "p")
    sid = create_session(user_id=other["id"], mode="c", source="orb", page_context="global")

    r = client.post("/api/voice/exec", json={"session_id": sid, "tool": "get_quote", "args": {}})
    assert r.status_code == 403


def test_transcript_appends(client):
    _login(client, plan="pro")
    from api.services.voice_session_service import create_session, get_transcripts
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")

    r = client.post("/api/voice/transcript", json={
        "session_id": sid, "role": "user", "text": "what's NVDA at",
    })
    assert r.status_code == 200
    rows = get_transcripts(sid)
    assert len(rows) == 1
    assert rows[0]["role"] == "user"


def test_session_end_records_duration(client):
    _login(client, plan="pro")
    from api.services.voice_session_service import create_session, get_session
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")

    r = client.post("/api/voice/session/end", json={
        "session_id": sid, "duration_seconds": 17,
    })
    assert r.status_code == 200
    s = get_session(sid)
    assert s["status"] == "closed"
    assert s["duration_seconds"] == 17


def test_session_token_injects_user_memory(client):
    _login(client, plan="pro")
    from api.services.auth_db import get_connection
    from api.services.voice_memory_service import add_fact
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    add_fact(uid, text="I trade small caps under $5B", category="style")

    captured_instructions = {}

    def fake_mint(*, voice, tools, instructions, model=None):
        captured_instructions["text"] = instructions
        return {"session_id": "sess_x", "client_secret": "ek_x",
                "expires_at": 0, "model": "gpt-realtime"}

    with patch("api.routers.voice.mint_realtime_session", side_effect=fake_mint):
        r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 200
    assert "small caps" in captured_instructions["text"]


# ── Memory endpoints ───────────────────────────────────────────────────────

def test_memory_facts_get_empty(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/memory/facts")
    assert r.status_code == 200
    assert r.json() == {"facts": []}


def test_memory_facts_post_and_list(client):
    _login(client, plan="pro")
    r = client.post("/api/voice/memory/facts",
                    json={"text": "I trade small caps", "category": "style"})
    assert r.status_code == 200
    fid = r.json()["id"]
    r2 = client.get("/api/voice/memory/facts")
    body = r2.json()
    assert any(f["id"] == fid for f in body["facts"])


def test_memory_fact_delete(client):
    _login(client, plan="pro")
    r = client.post("/api/voice/memory/facts",
                    json={"text": "some fact", "category": "general"})
    fid = r.json()["id"]
    r2 = client.delete(f"/api/voice/memory/facts/{fid}")
    assert r2.status_code == 200
    r3 = client.get("/api/voice/memory/facts")
    assert all(f["id"] != fid for f in r3.json()["facts"])


def test_memory_summaries_get_empty(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/memory/summaries")
    assert r.status_code == 200
    assert r.json() == {"summaries": []}
