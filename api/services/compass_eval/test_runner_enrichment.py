"""Covering test: `runner._enrich_fired_results` matches the REAL
j2_chat_messages persistence shape.

The chat loop persists tool output as a `role='tool'` row whose
`tool_results` column is a JSON list of `{tool_call_id, result}` entries —
NOT in `content`. This test drives a real `coach_chat.handle_user_turn`
round-trip (scripted tool_use via FakeChatClient, REAL get_regime executor —
network-free because the classifier's cache is pre-seeded), then asserts the
enrichment fills `fired[i]["result"]` with the executor's actual dict.

Investigation note (baseline v1, 2026-07-02): enrichment was suspected of
leaving results empty and causing the 26/50 `price_without_tool` auto-fails.
This test proved enrichment CORRECT — the real culprit was `checks._PRICE_RE`
matching the fractional digits of percentages ("down 1.53%" -> bare "53").
Kept as a regression pin on the persistence contract.
"""
import importlib
import os
import sqlite3
import tempfile
from datetime import datetime, timezone

import pytest

from api.services.journal_two.test_coach_chat import FakeChatClient


@pytest.fixture(autouse=True)
def _restore_brain_tools_flag(monkeypatch):
    """get_regime is a parity tool registered at coach_chat_tools import time
    behind BRAIN_TOOLS_ENABLED — reload with the flag on for this module, and
    leave the registry back in default flag-off state for later tests."""
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    import api.services.journal_two.coach_chat_tools as cct
    importlib.reload(cct)
    yield
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    importlib.reload(cct)


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()


def test_enrichment_fills_results_from_real_turn_persistence(db_conn, monkeypatch):
    from api.services import voice_tool_impls  # noqa: F401 — populates the voice registry
    from api.services import voice_regime_classifier
    from api.services.cache import cache
    from api.services.compass_eval import runner
    from api.services.journal_two import accounts, coach_chat

    # Pin the classifier cache so the REAL get_regime executor runs
    # deterministically with zero network.
    seeded_regime = {
        "regime": "bull_trend", "confidence": 0.9,
        "reasons": ["seeded for test"], "signals": {"spy_pct": 1.23},
        "narration": "Bull trend (seeded).",
    }
    cache.set(voice_regime_classifier._CACHE_KEY, seeded_regime, ttl=300)

    acc = accounts.get_or_migrate_default_account("u_eval_enrich", conn=db_conn)
    turn_start = datetime.now(timezone.utc).isoformat()

    client = FakeChatClient(stream_scripts=[
        [{"type": "tool_use", "id": "tu_reg", "name": "get_regime", "input": {}},
         {"type": "message_stop"}],
        [{"type": "text", "text": "Regime checked."}, {"type": "message_stop"}],
    ])

    fired = []
    for ev in coach_chat.handle_user_turn(
            user_id="u_eval_enrich", account_id=acc["id"],
            user_message="What's the regime?", client=client, conn=db_conn):
        if ev.get("type") == "tool_call":
            fired.append({"name": ev.get("name"),
                          "args": ev.get("args") or {}, "result": {}})

    assert fired and fired[0]["name"] == "get_regime"

    # Sanity-pin the persistence shape enrichment depends on.
    row = db_conn.execute(
        "SELECT tool_results FROM j2_chat_messages WHERE role='tool'"
        " ORDER BY created_at DESC LIMIT 1").fetchone()
    assert row is not None and row["tool_results"], \
        "chat loop no longer persists tool_results on role='tool' rows"

    runner._enrich_fired_results(
        db_conn, user_id="u_eval_enrich", account_id=acc["id"],
        turn_start=turn_start, fired=fired)

    result = fired[0]["result"]
    assert isinstance(result, dict) and result, \
        f"enrichment left result empty: {fired[0]}"
    # The enriched result is the executor's actual payload (regime data),
    # not a placeholder.
    joined = str(result).lower()
    assert "regime" in joined or "bull" in joined
