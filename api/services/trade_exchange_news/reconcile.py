"""Recovery: ingest every journal record the live push never delivered -- and say,
rather than assume, whether recovery was complete.

When it runs:
  * at BOOT, before ``pipeline.ready`` is set -- web was down (deploy dead
    window, crash, maintenance) and the receiver kept journaling;
  * then every ``TXN_RECONCILE_INTERVAL_S`` (default 30 s) as a backstop for
    pushes that failed while web was UP (a reset connection, a 502 in drain).

Where it starts: the newest receipt web has ledgered, minus
``TXN_RECONCILE_OVERLAP_S`` (default 10 min) -- a cursor with slack, because
two receiver instances overlap during the receiver's own deploy and their
clocks may disagree by a little. Ids already in the ledger are skipped without
a GET, so the slack costs one LIST, not re-downloads. An empty store starts at
the recoverable floor, never earlier.

⛔ THE LIST IS NOT THE ORDER. R2 lists keys lexicographically, i.e. by ULID =
receiver clock. That decides only the order recovery ingests in; the order
members see is the seq the single writer assigns at commit
(``pipeline.headline_event``). A record recovered late is committed late and
flagged ``delayed`` -- never slotted silently into the past.

⭐ COVERAGE IS MEASURED, NOT CLAIMED. Web writes a heartbeat (``alive_ms``) on
every cycle. At boot the window ``[alive_ms, now]`` is the time web could not
receive pushes. Recovery can only cover the part of that window that is inside
the RECOVERABLE floor = ``now - min(history age, journal retention)``; anything
older is recorded as a GAP (``outage_exceeded_retention``). A boot with no
journal configured, or a recovery scan that fails, records the window as a gap
too (``no_journal`` / ``journal_unreachable``) until a later scan covers it.
Gaps are surfaced in the admin status and to stream clients.

⭐ REPAIR — THE JOURNAL ALWAYS CATCHES UP (Checkpoint D1 durability audit). The
receiver may acknowledge a headline only WEB holds (R2 was failing). Its own
retry is in memory and dies with it, so the durable owner of that work is web's
ledger: every pushed delivery is stored with its exact record and
``journaled=0`` until a LIST shows the journal holds it. Each cycle,
``repair_once`` confirms what the LIST shows and PUTs what it does not (after a
short grace, so it does not race the receiver's own PUT). The backlog survives
web restarts (it is in SQLite) and receiver restarts (it never lived there), and
it is reported, never hidden: ``journal_backlog`` in the admin status, and a
warning every cycle while anything older than REPAIR_WARN_MS is unconfirmed.
What this guarantees: an acknowledged headline is durable in at least one store
at all times, and in both once R2 accepts writes again. What it does NOT: a
headline held only by web is lost if web's volume is lost before R2 recovers.

⚠️ Cost: one R2 LIST per interval (~86k Class A ops/month at 30 s) plus one GET
per genuinely missed record.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from api.services.trade_exchange_news import config, records
from api.services.trade_exchange_news.journal_reader import JournalReader, cursor_for_ms
from api.services.trade_exchange_news.pipeline import Pipeline

logger = logging.getLogger(__name__)

#: Missed records are downloaded this many at a time (order kept by ``map``),
#: so a long outage's backlog does not recover at one-GET-per-round-trip speed.
#: Pushed deliveries younger than this are left alone: the receiver's own PUT is
#: normally in flight and lands within milliseconds.
REPAIR_GRACE_MS = 15_000
#: An unconfirmed delivery older than this is logged as a warning every cycle.
REPAIR_WARN_MS = 120_000
REPAIR_BATCH = 500
FETCH_WORKERS = 8
FETCH_CHUNK = 64
MAX_GAPS = 50


class Reconciler:
    def __init__(self, pipeline: Pipeline, reader: JournalReader | None) -> None:
        self.pipeline, self.reader = pipeline, reader
        self.runs = 0
        self.recovered = 0
        self.invalid = 0
        self.last_error: str | None = None
        self.last_run_ms: int | None = None
        self.last_ok_ms: int | None = None
        self._listing: tuple[int, set[str]] | None = None
        self.repaired = 0
        self.confirmed = 0
        self.last_repair_error: str | None = None
        self._pool = ThreadPoolExecutor(max_workers=FETCH_WORKERS, thread_name_prefix="txn-fetch")

    # ── coverage ─────────────────────────────────────────────────────────────

    def recoverable_floor_ms(self, now_ms: int) -> int:
        return now_ms - min(config.history_max_age_ms(), config.journal_retention_ms())

    def gaps(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self.pipeline.store.get_state("gaps") or "[]")
        except ValueError:
            return []

    def _set_gaps(self, gaps: list[dict[str, Any]], now_ms: int) -> None:
        floor = now_ms - config.history_max_age_ms()
        keep = [g for g in gaps if g["to_ms"] >= floor][-MAX_GAPS:]   # beyond history: moot
        self.pipeline.store.set_state("gaps", json.dumps(keep))

    def _add_gap(self, from_ms: int, to_ms: int, reason: str, now_ms: int) -> None:
        if to_ms <= from_ms:
            return
        gaps = [g for g in self.gaps() if not (g["reason"] == reason and g["from_ms"] == from_ms)]
        gaps.append({"from_ms": int(from_ms), "to_ms": int(to_ms), "reason": reason,
                     "recorded_ms": now_ms})
        self._set_gaps(gaps, now_ms)
        logger.warning("[txn] coverage gap %s..%s reason=%s", from_ms, to_ms, reason)

    def _clear_pending(self, reason: str, now_ms: int) -> None:
        """A later successful scan covers windows recorded only because the
        journal was unreachable -- provided they are still recoverable."""
        floor = self.recoverable_floor_ms(now_ms)
        gaps = [g for g in self.gaps()
                if not (g["reason"] == reason and g["from_ms"] >= floor)]
        self._set_gaps(gaps, now_ms)

    def heartbeat(self, now_ms: int | None = None) -> None:
        self.pipeline.store.set_state("alive_ms", str(int(now_ms or time.time() * 1000)))

    def coverage(self, now_ms: int | None = None) -> dict[str, Any]:
        now = int(now_ms or time.time() * 1000)
        gaps = self.gaps()
        return {"complete": not gaps, "gaps": gaps, "journal": getattr(self.reader, "kind", None),
                "recoverable_floor_ms": self.recoverable_floor_ms(now),
                "last_ok_ms": self.last_ok_ms}

    def boot_assess(self, now_ms: int | None = None) -> None:
        """Before the first scan: record what the downtime window can and cannot
        be recovered from."""
        now = int(now_ms or time.time() * 1000)
        alive = self.pipeline.store.get_state("alive_ms")
        if alive is None:
            return                                   # first boot: nothing was missed
        down_from = int(alive)
        if self.reader is None:
            self._add_gap(down_from, now, "no_journal", now)
            return
        floor = self.recoverable_floor_ms(now)
        if down_from < floor:
            self._add_gap(down_from, floor, "outage_exceeded_retention", now)

    # ── scanning ─────────────────────────────────────────────────────────────

    def _start_ms(self, now_ms: int) -> int:
        floor = self.recoverable_floor_ms(now_ms)
        cur = self.pipeline.store.cursor_ms()
        return floor if cur is None else max(floor, cur - config.reconcile_overlap_ms())

    def _missing(self, start_ms: int) -> list[str]:
        store = self.pipeline.store
        listed = list(self.reader.ids_after(cursor_for_ms(start_ms)))
        self._listing = (start_ms, set(listed))        # reused by repair_once
        return [eid for eid in listed if not store.known(eid)]

    def _fetch_chunk(self, ids: list[str]) -> list[Any]:
        return list(self._pool.map(self.reader.get, ids))   # map keeps the order

    async def run_once(self) -> dict[str, Any]:
        if self.reader is None:
            return {"skipped": "no_journal"}
        now = int(time.time() * 1000)
        found = 0
        try:
            missing = await asyncio.to_thread(self._missing, self._start_ms(now))
            for i in range(0, len(missing), FETCH_CHUNK):        # ULID order
                chunk = await asyncio.to_thread(self._fetch_chunk, missing[i:i + FETCH_CHUNK])
                for eid, raw in zip(missing[i:i + FETCH_CHUNK], chunk):
                    try:
                        out = await self.pipeline.submit(raw, "reconcile")
                    except records.RecordError as e:
                        self.invalid += 1
                        logger.warning("[txn] journal record refused id=%s: %s", eid, e)
                        continue
                    if out["kind"] != "known":
                        found += 1
            self.last_error = None
            self.last_ok_ms = now
            await asyncio.to_thread(self._clear_pending, "journal_unreachable", now)
        except Exception as e:  # noqa: BLE001 -- recovery retries next interval
            self.last_error = type(e).__name__
            logger.warning("[txn] reconcile failed: %s", type(e).__name__)
            alive = await asyncio.to_thread(self.pipeline.store.get_state, "alive_ms")
            since = self.last_ok_ms or int(alive or now)
            await asyncio.to_thread(self._add_gap, since, now, "journal_unreachable", now)
        self.runs += 1
        self.recovered += found
        self.last_run_ms = now
        return {"recovered": found}

    # ── repair ───────────────────────────────────────────────────────────────

    def _repair(self, now_ms: int) -> dict[str, Any]:
        store = self.pipeline.store
        backlog = store.unjournaled(REPAIR_BATCH, older_than_ms=now_ms - REPAIR_GRACE_MS)
        if not backlog:
            return {"confirmed": 0, "repaired": 0}
        oldest = backlog[0][1]
        listing = self._listing
        # An event id encodes its receipt millisecond, so a LIST that started at or
        # before the oldest unconfirmed receipt has seen every key it could hold.
        if listing and listing[0] <= oldest:
            present = listing[1]
        else:
            present = set(self.reader.ids_after(cursor_for_ms(oldest - config.reconcile_overlap_ms())))
        confirmed = [eid for eid, _, _ in backlog if eid in present]
        todo = [(eid, body) for eid, _, body in backlog if eid not in present and body is not None]

        def put(item: tuple[str, str]) -> Exception | None:
            try:
                self.reader.put(*item)
                return None
            except Exception as e:  # noqa: BLE001 -- that one stays in the backlog
                return e

        # Parallel (D2, staging: one PUT ~0.6 s from Railway to R2, so 500 in
        # series held the reconcile loop -- and its recovery scan -- for ~5 min).
        # Each PUT is keyed by event id, so order does not matter.
        errors = list(self._pool.map(put, todo))
        repaired = [eid for (eid, _), err in zip(todo, errors) if err is None]
        store.mark_journaled(confirmed + repaired)
        out = {"confirmed": len(confirmed), "repaired": len(repaired)}
        failed = [e for e in errors if e is not None]
        if failed:
            self.last_repair_error = type(failed[0]).__name__
            logger.warning("[txn] journal repair: %d PUT(s) failed (%s); they stay in the backlog",
                           len(failed), type(failed[0]).__name__)
            return {**out, "error": type(failed[0]).__name__}
        self.last_repair_error = None
        return out

    async def repair_once(self) -> dict[str, Any]:
        if self.reader is None:
            return {"skipped": "no_journal"}
        now = int(time.time() * 1000)
        try:
            out = await asyncio.to_thread(self._repair, now)
        except Exception as e:  # noqa: BLE001 -- the backlog stays; next cycle retries
            self.last_repair_error = type(e).__name__
            logger.warning("[txn] journal repair failed: %s", type(e).__name__)
            out = {"error": type(e).__name__}
        self.confirmed += out.get("confirmed", 0)
        self.repaired += out.get("repaired", 0)
        backlog = await asyncio.to_thread(self.pipeline.store.journal_backlog)
        if backlog["count"] and backlog["oldest_ms"] and now - backlog["oldest_ms"] > REPAIR_WARN_MS:
            logger.warning("[txn] %d acknowledged headline(s) are held by web only (oldest %ds); "
                           "the R2 journal has not confirmed them", backlog["count"],
                           (now - backlog["oldest_ms"]) // 1000)
        return {**out, "backlog": backlog}

    async def run_forever(self) -> None:
        try:
            await asyncio.to_thread(self.boot_assess)
            await self.run_once()
        finally:
            await asyncio.to_thread(self.heartbeat)
            self.pipeline.ready.set()       # the boot gate opens even if recovery failed
        while True:
            await asyncio.sleep(config.reconcile_interval_s())
            await self.run_once()
            await self.repair_once()
            await asyncio.to_thread(self.heartbeat)
            try:
                await self.pipeline.prune()
            except Exception as e:  # noqa: BLE001
                logger.warning("[txn] prune failed: %s", type(e).__name__)

    def snapshot(self) -> dict[str, Any]:
        return {"journal": getattr(self.reader, "kind", None), "runs": self.runs,
                "recovered": self.recovered, "invalid": self.invalid,
                "last_error": self.last_error, "last_run_ms": self.last_run_ms,
                "coverage": self.coverage(),
                "journal_repair": {"confirmed": self.confirmed, "repaired": self.repaired,
                                   "last_error": self.last_repair_error,
                                   "backlog": self.pipeline.store.journal_backlog()}}

    def close(self) -> None:
        self._pool.shutdown(wait=False)


_RECONCILER: Reconciler | None = None
_TASK: asyncio.Task | None = None


def start(pipeline: Pipeline, reader: JournalReader | None) -> Reconciler:
    global _RECONCILER, _TASK
    _RECONCILER = Reconciler(pipeline, reader)
    _TASK = asyncio.get_running_loop().create_task(_RECONCILER.run_forever())
    return _RECONCILER


def get() -> Reconciler | None:
    return _RECONCILER


def stop() -> None:
    global _RECONCILER, _TASK
    if _TASK is not None and not _TASK.get_loop().is_closed():
        _TASK.cancel()
    if _RECONCILER is not None:
        _RECONCILER.close()
    _RECONCILER, _TASK = None, None
