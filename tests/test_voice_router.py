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
