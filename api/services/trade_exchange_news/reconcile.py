"""Recovery: ingest every journal record the live push never delivered.

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
the history bound (7 days), never earlier.

⚠️ Cost: one R2 LIST per interval (~86k Class A ops/month at 30 s) plus one GET
per genuinely missed record.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from api.services.trade_exchange_news import config, records
from api.services.trade_exchange_news.journal_reader import JournalReader, cursor_for_ms
from api.services.trade_exchange_news.pipeline import Pipeline

logger = logging.getLogger(__name__)


class Reconciler:
    def __init__(self, pipeline: Pipeline, reader: JournalReader | None) -> None:
        self.pipeline, self.reader = pipeline, reader
        self.runs = 0
        self.recovered = 0
        self.invalid = 0
        self.last_error: str | None = None
        self.last_run_ms: int | None = None

    def _start_ms(self, now_ms: int) -> int:
        floor = now_ms - config.history_max_age_ms()
        cur = self.pipeline.store.cursor_ms()
        return floor if cur is None else max(floor, cur - config.reconcile_overlap_ms())

    def _missing(self, start_ms: int) -> list[str]:
        store = self.pipeline.store
        return [eid for eid in self.reader.ids_after(cursor_for_ms(start_ms))
                if not store.known(eid)]

    async def run_once(self) -> dict[str, Any]:
        if self.reader is None:
            return {"skipped": "no_journal"}
        now = int(time.time() * 1000)
        found = 0
        try:
            missing = await asyncio.to_thread(self._missing, self._start_ms(now))
            for eid in missing:            # ULID order == receipt order
                raw = await asyncio.to_thread(self.reader.get, eid)
                try:
                    out = await self.pipeline.submit(raw, "reconcile")
                except records.RecordError as e:
                    self.invalid += 1
                    logger.warning("[txn] journal record refused id=%s: %s", eid, e)
                    continue
                if out["kind"] != "known":
                    found += 1
            self.last_error = None
        except Exception as e:  # noqa: BLE001 -- recovery retries next interval
            self.last_error = type(e).__name__
            logger.warning("[txn] reconcile failed: %s", type(e).__name__)
        self.runs += 1
        self.recovered += found
        self.last_run_ms = now
        return {"recovered": found}

    async def run_forever(self) -> None:
        try:
            await self.run_once()
        finally:
            self.pipeline.ready.set()       # the boot gate opens even if recovery failed
        while True:
            await asyncio.sleep(config.reconcile_interval_s())
            await self.run_once()
            try:
                await self.pipeline.prune()
            except Exception as e:  # noqa: BLE001
                logger.warning("[txn] prune failed: %s", type(e).__name__)

    def snapshot(self) -> dict[str, Any]:
        return {"journal": getattr(self.reader, "kind", None), "runs": self.runs,
                "recovered": self.recovered, "invalid": self.invalid,
                "last_error": self.last_error, "last_run_ms": self.last_run_ms}


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
    _RECONCILER, _TASK = None, None
