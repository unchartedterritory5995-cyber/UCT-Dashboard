"""Verify voice tables are created by auth_db.init_db()."""

from api.services.auth_db import init_db, get_connection


def test_voice_settings_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_settings)").fetchall()
        col_names = {c["name"] for c in cols}
        assert "user_id" in col_names
        assert "enabled" in col_names
        assert "voice" in col_names
        assert "speed" in col_names
    finally:
        conn.close()


def test_voice_usage_monthly_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_usage_monthly)").fetchall()
        col_names = {c["name"] for c in cols}
        assert "user_id" in col_names
        assert "year_month" in col_names
        assert "mode_a_seconds" in col_names
    finally:
        conn.close()


def test_voice_sessions_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_sessions)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "user_id", "mode", "started_at", "ended_at",
                "duration_seconds", "status", "page_context"}.issubset(col_names)
    finally:
        conn.close()


def test_voice_transcripts_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_transcripts)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "session_id", "role", "text", "timestamp"}.issubset(col_names)
    finally:
        conn.close()


def test_user_voice_facts_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(user_voice_facts)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "user_id", "category", "text", "created_at", "updated_at"}.issubset(col_names)
    finally:
        conn.close()


def test_voice_session_summaries_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_session_summaries)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "session_id", "user_id", "summary_text",
                "key_topics_json", "created_at"}.issubset(col_names)
    finally:
        conn.close()
