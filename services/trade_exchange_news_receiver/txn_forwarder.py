"""The live path: hand each accepted record to web over Railway's private network.

⭐ BEST-EFFORT BY DESIGN, AND THAT IS SAFE. The journal is the durable copy; this
is the fast one. It is started BEFORE the journal write so the headline's trip
to members does not wait on R2. If web is deploying, in maintenance, or
unreachable, the push fails and nothing is lost: web's reconciler lists the
journal after its cursor and ingests what it never received. Web ingests by
event id, so a push that lands AND a reconcile that finds the same record is
one headline, not two.

⛔ Authenticates with ``TXN_INGEST_TOKEN`` (a bearer web holds only the hash
of), never the webhook secret, and never PUSH_SECRET -- the receiver must not
hold a credential that can do anything on web except hand it news.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger("txn.forwarder")

#: Two quick retries ride out a connection reset or web's drain-window 502; a
#: longer outage is the reconciler's job, so the push never queues up behind it.
RETRY_DELAYS_S = (0.1, 0.4)


class Forwarder:
    def __init__(self, url: str, token: str, *, client: httpx.AsyncClient | None = None,
                 timeout_s: float = 2.0) -> None:
        self.url = url
        self.token = token
        self._client = client
        self._owns_client = client is None
        self._timeout = timeout_s
        self._tasks: set[asyncio.Task] = set()

    @property
    def configured(self) -> bool:
        return bool(self.url and self.token)

    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            # Keep-alive pool: the steady state is one warm connection to web.
            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
                headers={"User-Agent": "uct-trade-exchange-news-receiver/1"})
        return self._client

    async def push(self, record: dict[str, Any], trace: list | None = None) -> bool:
        """True once web answered 2xx. Never raises. ``trace`` (⏱ latency audit)
        collects one ``(outcome, ms)`` per attempt: an HTTP status or an error
        class name such as ``ReadTimeout`` -- never the body or the token."""
        if not self.configured:
            return False
        headers = {"Authorization": f"Bearer {self.token}"}
        for attempt, delay in enumerate((0.0, *RETRY_DELAYS_S)):
            if delay:
                await asyncio.sleep(delay)
            t0 = time.perf_counter()
            try:
                r = await self.client().post(self.url, json=record, headers=headers)
                if trace is not None:
                    trace.append((r.status_code, round((time.perf_counter() - t0) * 1000)))
                if 200 <= r.status_code < 300:
                    return True
                if r.status_code in (400, 401, 403, 404, 413, 422):
                    # A refusal will not change on retry. 404 = web's feature flag
                    # off; 401 = token mismatch. Reconcile is the backstop.
                    logger.warning("[txn] web refused push id=%s status=%s",
                                   record.get("id"), r.status_code)
                    return False
            except httpx.HTTPError as e:
                if trace is not None:
                    trace.append((type(e).__name__, round((time.perf_counter() - t0) * 1000)))
                if attempt == len(RETRY_DELAYS_S):
                    logger.warning("[txn] push to web failed id=%s: %s",
                                   record.get("id"), type(e).__name__)
        return False

    def start(self, record: dict[str, Any], on_done=None, trace: list | None = None) -> asyncio.Task:
        """Fire the push without awaiting it; keep a reference so the task is
        not garbage-collected mid-flight."""
        task = asyncio.get_running_loop().create_task(self.push(record, trace))
        self._tasks.add(task)

        def _finish(t: asyncio.Task) -> None:
            self._tasks.discard(t)
            if on_done is not None and not t.cancelled():
                on_done(bool(t.result()))
        task.add_done_callback(_finish)
        return task

    async def drain(self, timeout_s: float = 3.0) -> None:
        """Let in-flight pushes finish (shutdown's drain window, and tests)."""
        if self._tasks:
            await asyncio.wait(set(self._tasks), timeout=timeout_s)

    async def aclose(self) -> None:
        """Close the pool -- only one this forwarder created itself."""
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None
