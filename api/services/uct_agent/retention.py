"""Transcript retention for UCT Agent (Track C safeguard c; design: PR #748 RETENTION-PROPOSAL.md P2 + P7).

CODE READY FOR THE OWNER'S DECISION; BOTH SWITCHES DEFAULT OFF, so nothing changes until the owner turns them on
(transcript retention is NOT approved: owner 2026-11-03).

  UCT_AGENT_KN_RETENTION=1    (P2) a Trading Brain answer row (an outcome row whose actions include playbook.*) is
                              stored as a CITATION only: a short line naming its knowledge-base ids / template /
                              setup, plus {kind, actions, kn: {kb_ids, templates, setups, policy_version}}. The answer
                              text, its saved views and lines, and any figures are never written to agent_turns,
                              so they are not kept, searched (/api/agent/search) or re-sent.
  UCT_AGENT_TRANSCRIPT_DAYS=N (P7) every Agent transcript row older than N days (MIN_DAYS=30 .. 3650) is deleted:
                              at most once an hour, started by a write but run on a BACKGROUND thread, in batches of
                              BATCH rows (each batch under the store's write lock, committed on its own), with
                              secure_delete on, an index on created_at and a WAL checkpoint(TRUNCATE) afterwards (both
                              under the write lock; the index is created by the prune, never by the store schema, so
                              nothing changes while the switch is off) so
                              deleted text does not linger in the -wal file. PINNED chats are exempt (owner decision
                              B3 pending; the default keeps them). Empty unpinned conversations older than N days and
                              their state go too. A value below MIN_DAYS is refused (the switch stays off, logged).
                              Unset (the default): nothing is pruned and no connection is opened.

Not retroactive: UCT_AGENT_KN_RETENTION changes only rows written after it is switched on; rows written before keep
their text until the age limit (or a one-shot scrub, #748 P8c) removes them.

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
MIN_DAYS = 30                     # review #794 B2: no transcript age limit below 30 days
BATCH = 500
_ON = ("1", "true", "on", "yes")
_KEEP = ("kind", "actions", "local", "voice")
_KB = re.compile(r"UCT KB #(\d{1,9})")
_TEMPLATE = re.compile(r"template “([^”\n]{1,80})”")
_SETUP_RECORD = re.compile(r"^([^\n—]{1,60}?)(?: in a [A-Z]+ market)? — UCT's historical record")
_POLICY_V = re.compile(r"source policy v(\d{1,4})")


def kn_retention_on() -> bool:
    return str(os.environ.get(KN_FLAG) or "").strip().lower() in _ON


_WARNED = {"value": None}


def transcript_days() -> Optional[int]:
    raw = str(os.environ.get(DAYS_ENV) or "").strip()
    if not raw:
        return None
    try:
        n = int(raw)
    except ValueError:
        n = -1
    if MIN_DAYS <= n <= 3650:
        return n
    if _WARNED["value"] != raw:                      # once per distinct bad value
        _WARNED["value"] = raw
        log.warning("[uct-agent retention] %s=%r refused (allowed %d..3650 days): transcript pruning stays OFF",
                    DAYS_ENV, raw[:20], MIN_DAYS)
    return None


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


def prune(connect: Callable[[], sqlite3.Connection], days: int, now: Optional[float] = None,
          lock: Optional[threading.Lock] = None, batch: int = BATCH) -> dict:
    """Delete UNPINNED transcript rows older than `days` in batches (each under `lock`, committed on its own), then
    empty unpinned conversations older than `days` and their state rows, then checkpoint the WAL. Counts only."""
    import contextlib
    cutoff = int((now if now is not None else time.time()) - days * 86400)
    guard = lock or contextlib.nullcontext()
    turns = 0
    with contextlib.closing(connect()) as c:
        c.execute("PRAGMA secure_delete=ON")
        with guard:                             # review #794: schema change under the store's write lock
            c.execute("CREATE INDEX IF NOT EXISTS ix_agent_turns_created ON agent_turns(created_at)")
            c.commit()
        while True:
            with guard:
                n = c.execute(
                    "DELETE FROM agent_turns WHERE id IN (SELECT t.id FROM agent_turns t WHERE t.created_at < ? AND "
                    "NOT EXISTS (SELECT 1 FROM agent_conversations p WHERE p.id = t.conversation_id "
                    "AND p.pinned_at IS NOT NULL) LIMIT ?)", (cutoff, int(batch))).rowcount
                c.commit()
            turns += n
            if n < batch:
                break
        with guard:
            empty = [r[0] for r in c.execute(
                "SELECT id FROM agent_conversations c WHERE updated_at < ? AND pinned_at IS NULL AND NOT EXISTS "
                "(SELECT 1 FROM agent_turns t WHERE t.conversation_id = c.id)", (cutoff,)).fetchall()]
            for i in range(0, len(empty), batch):
                chunk = empty[i:i + batch]
                q = ",".join("?" * len(chunk))
                c.execute(f"DELETE FROM agent_conversation_state WHERE conversation_id IN ({q})", chunk)
                c.execute(f"DELETE FROM agent_conversations WHERE id IN ({q})", chunk)
            c.commit()
        with guard:                             # review #794: the checkpoint under the write lock too
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    log.info("[uct-agent retention] pruned %d turns and %d empty conversations older than %d days", turns, len(empty), days)
    return {"turns": turns, "conversations": len(empty), "days": days}


def _spawn(fn: Callable[[], Any]) -> None:
    threading.Thread(target=fn, name="uct-agent-retention", daemon=True).start()


SPAWN: Callable[[Callable[[], Any]], None] = _spawn     # tests run it inline


def maybe_prune(connect: Callable[[], sqlite3.Connection], now: Optional[float] = None,
                lock: Optional[threading.Lock] = None) -> bool:
    """Start the prune OFF the request path (a background thread), at most once per hour, only while
    UCT_AGENT_TRANSCRIPT_DAYS holds an allowed value. With the switch off it returns at once: no connection opened."""
    days = transcript_days()
    if days is None:
        return False
    t = now if now is not None else time.time()
    with _LOCK:
        if t - _LAST["at"] < PRUNE_EVERY_S:
            return False
        _LAST["at"] = t

    def run():
        try:
            prune(connect, days, now=t, lock=lock)
        except Exception:  # noqa: BLE001 — a failed prune never affects a member request
            log.exception("[uct-agent retention] prune failed")
    SPAWN(run)
    return True


def _reset_for_test() -> None:
    _LAST["at"] = 0.0
    _WARNED["value"] = None
