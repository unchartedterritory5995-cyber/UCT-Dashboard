"""Transcript retention for UCT Agent (Track C safeguard c; design: PR #748 RETENTION-PROPOSAL.md P2 + P7).

CODE READY FOR THE OWNER'S DECISION; BOTH SWITCHES DEFAULT OFF, so nothing changes until the owner turns them on
(transcript retention is NOT approved: owner 2026-11-03).

  UCT_AGENT_KN_RETENTION=1    (P2) a Trading Brain answer row (an outcome row whose actions include playbook.*) is
                              stored as a CITATION only: a short line naming its knowledge-base ids / template /
                              setup, plus {kind, actions, kn: {kb_ids, templates, setups, policy_version}}. The answer
                              text, its saved views and lines, and any figures are never written to agent_turns,
                              so they are not kept, searched (/api/agent/search) or re-sent.
  UCT_AGENT_TRANSCRIPT_DAYS=N (P7) every Agent transcript row older than N days (1..3650) is deleted, at most once an
                              hour, on the next write; empty conversations older than N days and their state go too.
                              The prune runs with secure_delete on. Unset (the default): nothing is ever pruned.

Already true without a flag: history replay never re-sends knowledge text (turn.KNOWLEDGE_REPLAY / frame.REPLAY_STUB).
Not done here (owner decisions, PR #748 Q5 / P8b): telemetry and spend retention, and purging the Agent store on
account deletion (shared account-purge code).
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
import threading
import time
from typing import Any, Callable, Optional

log = logging.getLogger(__name__)

KN_FLAG = "UCT_AGENT_KN_RETENTION"
DAYS_ENV = "UCT_AGENT_TRANSCRIPT_DAYS"
CITATION_MAX = 200
PRUNE_EVERY_S = 3600
_ON = ("1", "true", "on", "yes")
_KEEP = ("kind", "actions", "local", "voice")
_KB = re.compile(r"UCT KB #(\d{1,9})")
_TEMPLATE = re.compile(r"template “([^”\n]{1,80})”")
_SETUP_RECORD = re.compile(r"^([^\n—]{1,60}?)(?: in a [A-Z]+ market)? — UCT's historical record")
_POLICY_V = re.compile(r"source policy v(\d{1,4})")


def kn_retention_on() -> bool:
    return str(os.environ.get(KN_FLAG) or "").strip().lower() in _ON


def transcript_days() -> Optional[int]:
    try:
        n = int(str(os.environ.get(DAYS_ENV) or "").strip())
    except ValueError:
        return None
    return n if 1 <= n <= 3650 else None


def _is_knowledge_row(role: str, data: Any) -> bool:
    if role != "outcome" or not isinstance(data, dict):
        return False
    acts = data.get("actions")
    return isinstance(acts, list) and any(isinstance(a, str) and a.startswith("playbook.") for a in acts)


def citation(text: str, data: dict) -> tuple[str, dict]:
    """(citation line, metadata) for one knowledge answer row — ids, names and versions only, never text or figures."""
    t = str(text or "")
    kb_ids = sorted({int(x) for x in _KB.findall(t)})[:20]
    templates = list(dict.fromkeys(_TEMPLATE.findall(t)))[:5]
    setups = [m.group(1).strip() for m in [_SETUP_RECORD.match(t)] if m][:1]
    pv = _POLICY_V.search(t)
    parts = []
    if kb_ids:
        parts.append("UCT KB " + ", ".join(f"#{k}" for k in kb_ids))
    if templates:
        parts.append("template " + ", ".join(f"“{x}”" for x in templates))
    if setups:
        parts.append(f"setup record: {setups[0]}")
    line = ("Answered from UCT's approved knowledge base" + (f" ({'; '.join(parts)})" if parts else "") + ".")
    if len(line) > CITATION_MAX:
        line = line[:CITATION_MAX - 2].rstrip() + "…)"
    meta = {k: data[k] for k in _KEEP if k in data}
    meta["kn"] = {"kb_ids": kb_ids, "templates": templates, "setups": setups,
                  "policy_version": int(pv.group(1)) if pv else None, "stored": "citation_only"}
    return line, meta


def on_write(role: str, text: str, data: Any) -> tuple[str, Any]:
    """What store.add_turn writes. Identity unless UCT_AGENT_KN_RETENTION is on and this is a knowledge answer row."""
    if not kn_retention_on() or not _is_knowledge_row(role, data):
        return text, data
    return citation(text, data)


_LAST = {"at": 0.0}
_LOCK = threading.Lock()


def prune(conn: sqlite3.Connection, days: int, now: Optional[float] = None) -> dict:
    """Delete transcript rows older than `days`, then empty conversations older than `days` and their state rows.
    Counts only in the result and the log."""
    cutoff = int((now if now is not None else time.time()) - days * 86400)
    conn.execute("PRAGMA secure_delete=ON")
    turns = conn.execute("DELETE FROM agent_turns WHERE created_at < ?", (cutoff,)).rowcount
    empty = [r[0] for r in conn.execute(
        "SELECT id FROM agent_conversations c WHERE updated_at < ? AND NOT EXISTS "
        "(SELECT 1 FROM agent_turns t WHERE t.conversation_id = c.id)", (cutoff,)).fetchall()]
    for i in range(0, len(empty), 500):
        chunk = empty[i:i + 500]
        q = ",".join("?" * len(chunk))
        conn.execute(f"DELETE FROM agent_conversation_state WHERE conversation_id IN ({q})", chunk)
        conn.execute(f"DELETE FROM agent_conversations WHERE id IN ({q})", chunk)
    conn.commit()
    log.info("[uct-agent retention] pruned %d turns and %d empty conversations older than %d days", turns, len(empty), days)
    return {"turns": turns, "conversations": len(empty), "days": days}


def maybe_prune(connect: Callable[[], sqlite3.Connection], now: Optional[float] = None) -> Optional[dict]:
    """The opportunistic daily-ish prune: only while UCT_AGENT_TRANSCRIPT_DAYS is set, at most once per hour."""
    days = transcript_days()
    if days is None:
        return None
    t = now if now is not None else time.time()
    with _LOCK:
        if t - _LAST["at"] < PRUNE_EVERY_S:
            return None
        _LAST["at"] = t
    try:
        import contextlib
        with contextlib.closing(connect()) as c:
            return prune(c, days, now=t)
    except Exception:  # noqa: BLE001 — a failed prune never fails the write that triggered it
        log.exception("[uct-agent retention] prune failed")
        return None


def _reset_for_test() -> None:
    _LAST["at"] = 0.0
