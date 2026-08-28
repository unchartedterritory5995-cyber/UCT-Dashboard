"""Durable Message Batches ledger — the 50%-off lane for work with no SLA.

The Batch API costs half of standard rates and returns within 24h (usually
minutes). That trade is free for anything a WARMER generates: the result is
persisted for a later reader, and a name that misses a batch simply stays cold
until the next pass or a member's click generates it live.

What this module owns is the part that makes batching safe on THIS box:

  ⛔ A pending batch outlives the process. The pod redeploys several times a
    day, so an in-memory batch id is a paid result nobody ever collects. The
    ledger is a file on the volume, written atomically (encode → tmp →
    os.replace), so a reaper on the next scheduler tick can always find it.
  ⛔ Results come back UNORDERED. Every consumer keys strictly by `custom_id`
    — never by position — and the ledger carries the per-id metadata the
    consumer needs (the transcript hash, the signals hash, the quarter …)
    captured AT SUBMIT TIME. Re-deriving it at consume time would stamp a
    result with inputs it was not generated from.
  ⛔ Reaping runs on scheduler THREADS, never a request handler: the single
    web pod has one event loop and one anyio pool (the 524-outage surface).

Failure is always "the name stays cold": an errored, expired or unparseable
result writes nothing, and the existing on-demand path covers the reader. A
batch older than `MAX_AGE_HOURS` is abandoned so the ledger cannot grow a tail
of zombies.

Gate: `LLM_BATCH_ENABLED` (default "1"). Set to "0" to make every submit()
return None — callers then fall back to their synchronous path, so the
rollback is one env var and no code change.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any, Callable, Optional

_log = logging.getLogger(__name__)

_LOCK = threading.Lock()

MAX_AGE_HOURS = float(os.environ.get("LLM_BATCH_MAX_AGE_HOURS", "24"))

# The Batch API's discount. Consumers multiply their own cost accounting by
# this so a daily cap measures DOLLARS, not list-price tokens.
BATCH_DISCOUNT = 0.5


def enabled() -> bool:
    return os.environ.get("LLM_BATCH_ENABLED", "1").strip() not in ("0", "false", "no")


def _path() -> str:
    return os.environ.get(
        "LLM_BATCH_LEDGER_PATH",
        os.path.join(os.environ.get("DATA_DIR", "/data"), "llm_batches.json"))


def _read() -> list[dict]:
    try:
        with open(_path(), encoding="utf-8") as f:
            rows = json.load(f)
        return rows if isinstance(rows, list) else []
    except FileNotFoundError:
        return []
    except Exception as exc:            # corrupt ledger must not stop a sweep
        _log.warning("[llm_batch] unreadable ledger: %s", exc)
        return []


def _write(rows: list[dict]) -> None:
    """Encode BEFORE truncating anything — `open(w)` empties the file before a
    failing serialization can be caught, which loses every pending batch id."""
    path = _path()
    try:
        blob = json.dumps(rows, ensure_ascii=False)
    except Exception as exc:
        _log.warning("[llm_batch] refusing to write an unserializable ledger: %s", exc)
        return
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(blob)
        os.replace(tmp, path)
    except Exception as exc:
        _log.warning("[llm_batch] ledger write failed: %s", exc)


def _client():
    from api.services.engine import _get_anthropic_client
    return _get_anthropic_client()


def submit(surface: str, requests: list[dict], meta: dict[str, dict]) -> Optional[str]:
    """Submit one batch and ledger it. `requests` is the SDK shape
    ([{custom_id, params}]); `meta` carries per-custom_id state the consumer
    will need at reap time. Returns the batch id, or None (caller falls back
    to its synchronous path)."""
    if not enabled() or not requests:
        return None
    try:
        client = _client()
        if client is None:
            return None
        batch = client.messages.batches.create(requests=requests)
        batch_id = getattr(batch, "id", None)
        if not batch_id:
            return None
    except Exception as exc:
        _log.warning("[llm_batch] submit failed for %s: %s", surface, exc)
        return None
    with _LOCK:
        rows = _read()
        rows.append({"batch_id": batch_id, "surface": surface,
                     "created_at": time.time(), "meta": meta or {}})
        _write(rows)
    _log.info("[llm_batch] %s submitted %d request(s) as %s",
              surface, len(requests), batch_id)
    return batch_id


def pending(surface: Optional[str] = None) -> list[dict]:
    rows = _read()
    return [r for r in rows if surface is None or r.get("surface") == surface]


def reap(surface: str, handle: Callable[[str, Any, dict], None]) -> dict[str, Any]:
    """Collect every ENDED batch for `surface`, calling
    `handle(custom_id, message_or_None, meta)` once per result.

    `message` is the Anthropic Message on success and None on any error /
    expiry / cancellation — a consumer that writes nothing for None keeps the
    "cold name, not wrong name" failure shape. Still-running batches are left
    in the ledger for the next tick. Never raises."""
    out = {"batches": 0, "succeeded": 0, "errored": 0, "pending": 0, "abandoned": 0}
    if not enabled():
        return out
    rows = _read()
    mine = [r for r in rows if r.get("surface") == surface]
    if not mine:
        return out
    try:
        client = _client()
        if client is None:
            return out
    except Exception:
        return out

    done_ids: list[str] = []
    for row in mine:
        bid = row.get("batch_id")
        age_h = (time.time() - float(row.get("created_at") or 0)) / 3600.0
        if age_h > MAX_AGE_HOURS:
            # A zombie: whatever it holds, the incremental pass regenerates.
            _log.warning("[llm_batch] abandoning %s (%s) after %.1fh",
                         bid, surface, age_h)
            out["abandoned"] += 1
            done_ids.append(bid)
            continue
        try:
            batch = client.messages.batches.retrieve(bid)
            if getattr(batch, "processing_status", "") != "ended":
                out["pending"] += 1
                continue
            results = client.messages.batches.results(bid)
        except Exception as exc:
            _log.warning("[llm_batch] retrieve failed for %s: %s", bid, exc)
            out["pending"] += 1
            continue

        out["batches"] += 1
        meta = row.get("meta") or {}
        for item in results:
            cid = getattr(item, "custom_id", None)
            if not cid:
                continue
            result = getattr(item, "result", None)
            rtype = getattr(result, "type", "")
            message = getattr(result, "message", None) if rtype == "succeeded" else None
            if message is None:
                out["errored"] += 1
            else:
                out["succeeded"] += 1
            try:
                handle(cid, message, meta.get(cid) or {})
            except Exception as exc:    # one bad result never drops the rest
                _log.warning("[llm_batch] handler failed for %s/%s: %s",
                             surface, cid, exc)
        done_ids.append(bid)

    if done_ids:
        with _LOCK:
            rows = [r for r in _read() if r.get("batch_id") not in set(done_ids)]
            _write(rows)
    return out
