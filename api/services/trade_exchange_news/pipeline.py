"""The single writer: validate -> store (assigns seq) -> publish, strictly in order.

⭐ STORE FIRST, THEN PUBLISH -- a deliberate reversal of the Checkpoint A sketch
("broadcast first, persist after"). Publishing before the commit would put a
headline on members' screens that has no seq yet, so a client reconnecting a
moment later could not resume past it, and a failed commit would leave members
holding a headline the replay path has never heard of. The commit is one local
SQLite transaction on a dedicated file (measured in the Checkpoint B tests at
well under a millisecond on this machine), so the price of being correct is
noise beside the network hops either side of it.

⭐ ONE WRITER THREAD IS THE ORDERING MECHANISM. ``submit`` runs ``_apply`` on a
one-thread executor, and ``_apply`` schedules ``hub.publish`` with
``loop.call_soon_threadsafe`` right after its commit. One thread => commits in
order; ``call_soon_threadsafe`` is FIFO => publishes in the same order.

⭐ BOOT GATE. Until the first recovery scan has finished, a live push waits (up
to ``TXN_BOOT_READY_WAIT_S``) so headlines that arrived while web was down are
assigned their seq BEFORE the newer ones arriving now. If the journal is slow
the wait times out and live wins -- latency is not held hostage by recovery.
"""
from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, AsyncIterator

from api.services.trade_exchange_news import config, records
from api.services.trade_exchange_news.hub import RESYNC, Hub
from api.services.trade_exchange_news.store import KNOWN, NEW, REPEAT, Store

logger = logging.getLogger(__name__)

REPLAY_PAGE = 500


def _tickers_for(content: str, source: str = "") -> list[str]:
    """The one resolver, read in the context the source label's format calls for
    (``categories.tickers_for``: wire news / press release / filing), no AI.
    The original content is never altered by this."""
    try:
        from api.services.trade_exchange_news.categories import tickers_for
        return tickers_for(source, content)
    except Exception:  # noqa: BLE001 -- a resolver fault must never cost a headline
        return []


def _display_for(source: str, content: str) -> dict:
    """Company-name links, the graphic-placeholder mark and the market-impact kind,
    derived like the category."""
    try:
        from api.services.trade_exchange_news.categories import impact_for, mentions_for, placeholder_for
        return {"mentions": mentions_for(source, content), "placeholder": placeholder_for(content),
                "impact": impact_for(source, content)}
    except Exception:  # noqa: BLE001 -- never cost a headline
        return {"mentions": [], "placeholder": None, "impact": None}


def _category_for(source: str, content: str) -> str:
    try:
        from api.services.trade_exchange_news.categories import category_for
        return category_for(source, content)
    except Exception:  # noqa: BLE001 -- a classifier fault must never cost a headline
        return "Other"


#: A headline committed more than this long after its receipt reached members
#: late (recovered from the journal after an outage, or a failed push). It is
#: marked ``delayed`` so the widget can say so instead of passing it off as new.
DELAYED_AFTER_MS = 15_000


def _alert_hook(ev: dict[str, Any]) -> None:
    """Hand a NEW headline to the S7 news-match alerts (dark behind its own flag).
    ``on_headline`` only enqueues onto news-match's own thread, so delivery I/O
    never runs on, or waits for, this writer. Never raises."""
    try:
        from api.services.alert_taxonomy import news_match
        news_match.on_headline(ev)
    except Exception:  # noqa: BLE001 -- an alert fault must never cost a headline
        pass


def derived_for(source: str, content: str) -> dict[str, Any]:
    """Every field ``headline_event`` derives from the text: a pure function of
    ``(source, content)``, so a reader of many rows may cache it (pages.py)."""
    return {"tickers": _tickers_for(content, source), "category": _category_for(source, content),
            **_display_for(source, content)}


def headline_event(row: dict[str, Any], epoch: str = "", derived: dict[str, Any] | None = None) -> dict[str, Any]:
    """⭐ ``seq`` is THE order: assigned once, by the single writer, at commit,
    contiguous within an ``epoch`` (AUTOINCREMENT, never reused; a rolled-back
    insert does not consume one). It is NOT receipt order -- ``received_at_ms``
    is the receiver's clock, ULIDs from two receiver instances may interleave
    differently, and an R2 LIST is only the order RECOVERY ingests in. Every
    client sees the same seq order, and a client that ever sees seq != last+1
    knows it missed something and replays."""
    return {"type": "headline", "epoch": epoch, "seq": row["seq"], "id": row["event_id"],
            "source": row["source"], "content": row["content"],
            "received_at_ms": row["received_at_ms"],
            # ⭐ Derived at EVERY event build, history and live alike, so a stored row
            # and a new arrival always read the same rules (the stored column is the
            # value at ingest; the source label itself is never rewritten). `derived`
            # is the same derivation, already made (derived_for) -- never other rules.
            **(derived if derived is not None else derived_for(row["source"], row["content"])),
            "repeat_count": row["repeat_count"], "via": row["via"],
            "delayed": (row["ingested_at_ms"] - row["received_at_ms"]) > DELAYED_AFTER_MS}


def repeat_event(row: dict[str, Any], epoch: str = "") -> dict[str, Any]:
    return {"type": "repeat", "epoch": epoch, "seq": row["seq"],
            "repeat_count": row["repeat_count"], "last_repeat_ms": row["last_repeat_ms"]}


class Pipeline:
    def __init__(self, store: Store, hub: Hub, loop: asyncio.AbstractEventLoop) -> None:
        self.store, self.hub, self.loop = store, hub, loop
        self._writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="txn-writer")
        self.ready = asyncio.Event()
        self.counts = {NEW: 0, REPEAT: 0, KNOWN: 0, "invalid": 0, "push": 0, "reconcile": 0,
                       "boot_wait_timeouts": 0}
        self.last_ingest_latency_ms: float | None = None

    # ── writing ──────────────────────────────────────────────────────────────

    def _apply(self, rec: dict[str, Any], via: str, record_json: str | None = None,
               queued_at: float | None = None) -> dict[str, Any]:
        t0 = time.perf_counter()
        arrive_lag_ms = time.time() * 1000 - rec["received_at_ms"]  # receiver clock -> web clock
        tickers = _tickers_for(rec["content"], rec["source"])
        t1 = time.perf_counter()
        out = self.store.ingest(rec, via=via, dedupe_key=records.dedupe_key(rec["source"], rec["content"]),
                                window_ms=config.dedupe_window_ms(),
                                tickers=tickers, record_json=record_json)
        t2 = time.perf_counter()
        if out["kind"] == NEW:
            ev = headline_event(out["headline"], self.store.epoch)
            timing = {"id": rec["id"], "via": via, "arrive_lag_ms": arrive_lag_ms,
                      "queue_ms": (t0 - queued_at) * 1000 if queued_at else None,
                      "tickers_ms": (t1 - t0) * 1000, "store_ms": (t2 - t1) * 1000, "t2": t2}
            self.loop.call_soon_threadsafe(self._publish_timed, ev, timing)
            _alert_hook(ev)
        elif out["kind"] == REPEAT:
            self.loop.call_soon_threadsafe(self.hub.publish,
                                           repeat_event(out["headline"], self.store.epoch))
        self.counts[out["kind"]] += 1
        self.counts[via] += 1
        self.last_ingest_latency_ms = (time.perf_counter() - t0) * 1000
        return out

    def _publish_timed(self, ev: dict[str, Any], timing: dict[str, Any]) -> None:
        # ⏱ LATENCY AUDIT: ``server_ms`` (web wall clock at publish) lets an admin
        # browser measure publish -> SSE receipt; the log line carries stage
        # durations only -- an event id, never content.
        ev["server_ms"] = int(time.time() * 1000)
        self.hub.publish(ev)
        logger.info("[txn] timing web id=%s via=%s arrive_lag_ms=%.0f queue_ms=%s tickers_ms=%.1f "
                    "store_ms=%.1f to_publish_ms=%.1f subscribers=%d", timing["id"], timing["via"],
                    timing["arrive_lag_ms"], None if timing["queue_ms"] is None else round(timing["queue_ms"], 1),
                    timing["tickers_ms"], timing["store_ms"], (time.perf_counter() - timing["t2"]) * 1000,
                    self.hub.subscribers)

    async def submit(self, raw: Any, via: str) -> dict[str, Any]:
        """Validate and ingest one journal record. Raises ``RecordError``."""
        try:
            rec = records.validate(raw)
        except records.RecordError:
            self.counts["invalid"] += 1
            raise
        # The record is kept EXACTLY as received (journal encoding), so the repair
        # pass can rewrite the identical object if the journal never got it.
        return await self.loop.run_in_executor(self._writer, self._apply, rec, via,
                                               records.encode_record(raw), time.perf_counter())

    async def submit_live(self, raw: Any) -> dict[str, Any]:
        if not self.ready.is_set():
            try:
                await asyncio.wait_for(self.ready.wait(), timeout=config.boot_ready_wait_s())
            except asyncio.TimeoutError:
                self.counts["boot_wait_timeouts"] += 1
        return await self.submit(raw, "push")

    # ── reading ──────────────────────────────────────────────────────────────

    async def stream(self, after_seq: int) -> AsyncIterator[dict[str, Any]]:
        """Every headline after ``after_seq``, then live, with no gap and no
        duplicate. Subscribes BEFORE reading the backlog, so a headline
        committed during the read is in the queue and skipped by seq if the
        backlog already had it."""
        sub = self.hub.subscribe()
        last = int(after_seq)
        try:
            while True:
                page = await asyncio.to_thread(self.store.after, last, REPLAY_PAGE)
                for row in page:
                    last = row["seq"]
                    yield headline_event(row, self.store.epoch)
                if len(page) < REPLAY_PAGE:
                    break
            while True:
                ev = await sub.queue.get()
                if ev is RESYNC:
                    while True:
                        page = await asyncio.to_thread(self.store.after, last, REPLAY_PAGE)
                        for row in page:
                            last = row["seq"]
                            yield headline_event(row, self.store.epoch)
                        if len(page) < REPLAY_PAGE:
                            break
                    continue
                if ev["type"] == "headline":
                    if ev["seq"] <= last:
                        continue
                    last = ev["seq"]
                yield ev
        finally:
            self.hub.unsubscribe(sub)

    def close(self) -> None:
        self._writer.shutdown(wait=True)


# ── the process-wide instance ────────────────────────────────────────────────

_PIPELINE: Pipeline | None = None


def get() -> Pipeline | None:
    return _PIPELINE


def start(loop: asyncio.AbstractEventLoop | None = None, store: Store | None = None) -> Pipeline:
    global _PIPELINE
    if _PIPELINE is None:
        _PIPELINE = Pipeline(store or Store(config.db_path()),
                             Hub(config.subscriber_queue_max()),
                             loop or asyncio.get_running_loop())
    return _PIPELINE


def stop() -> None:
    global _PIPELINE
    if _PIPELINE is not None:
        _PIPELINE.close()
        _PIPELINE = None
