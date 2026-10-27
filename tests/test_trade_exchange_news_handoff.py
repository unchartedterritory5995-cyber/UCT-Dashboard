"""End to end, in process: receiver -> journal -> web -> subscribers (synthetic only).

Proves the owner's durable-delivery requirements against the real code on
both sides of the service boundary:

  * acknowledged => durable (in the journal before the 2xx);
  * web unavailable => no loss (receiver keeps acking; web recovers on boot);
  * web restart => seq continues, replay resumes;
  * receiver restart => nothing in the journal is lost or duplicated;
  * a sender retry => one headline with a visible repeat count, both deliveries kept;
  * every subscriber sees one identical ordered stream;
  * the two sides agree on the record and key format (parity).

Latency numbers printed here are LOCAL, in-process figures (no network, no R2):
they bound the code's own cost, not production's end-to-end time.
"""
from __future__ import annotations

import asyncio
import random
import statistics
import time

import httpx
import pytest
from fastapi import FastAPI

from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import config, journal_reader as web_journal
from api.services.trade_exchange_news import pipeline as pl, reconcile as rc, records
from api.services.trade_exchange_news.store import Store
from tests.support.txn_fakes import FakeS3, load_receiver

M = load_receiver()
rx, jr, fw, appmod = M["txn_receiver"], M["txn_journal"], M["txn_forwarder"], M["txn_app"]

HOOK_TOKEN = "txn_" + "Q" * 43
INGEST_TOKEN = "ingest-" + "k" * 40


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_INGEST_TOKEN_SHA256", config.sha256_hex(INGEST_TOKEN))
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "web.db"))
    monkeypatch.setenv("TXN_BOOT_READY_WAIT_S", "1")
    yield
    rc.stop()
    pl.stop()


class Switch(httpx.AsyncBaseTransport):
    """Private network to web, with an off switch (deploy dead window)."""

    def __init__(self, app: FastAPI) -> None:
        self.inner = httpx.ASGITransport(app=app)
        self.down = False

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("web is deploying")
        return await self.inner.handle_async_request(request)


def _web_app() -> FastAPI:
    app = FastAPI()
    app.include_router(route.router)
    return app


def _receiver(journal, net: Switch):
    cfg = rx.Config({"TXN_RECEIVER_ENABLED": "1",
                     "TXN_WEBHOOK_TOKEN_SHA256": rx.token_sha256(HOOK_TOKEN),
                     "TXN_INGEST_TOKEN": INGEST_TOKEN,
                     "TXN_WEB_INGEST_URL": "http://web.internal" + route.INGEST_PATH,
                     "TXN_RATE_BURST": "10000", "TXN_STORAGE_PERMISSION_CONFIRMED": "1"})
    f = fw.Forwarder(cfg.web_ingest_url, cfg.ingest_token, client=httpx.AsyncClient(transport=net))
    app = appmod.create_app(cfg, journal, f)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rx"), f


async def _boot_web(reader) -> pl.Pipeline:
    p = pl.start(asyncio.get_running_loop())
    rc.start(p, reader)
    await asyncio.wait_for(p.ready.wait(), 2)
    return p


async def _post(c, content):
    r = await c.post(f"/hook/{HOOK_TOKEN}", json={"source": "TXNews1", "content": content})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _collect(stream, n, timeout=3.0):
    out = []

    async def take():
        async for ev in stream:
            if ev["type"] == "headline":
                out.append(ev)
                if len(out) >= n:
                    return
    await asyncio.wait_for(take(), timeout)
    return out


async def test_live_path_then_web_outage_then_recovery_with_one_ordered_stream(tmp_path):
    journal = jr.FileJournal(str(tmp_path / "journal"))
    reader = web_journal.FileJournalReader(str(tmp_path / "journal"))
    net = Switch(_web_app())
    rxc, f = _receiver(journal, net)
    p = await _boot_web(reader)
    subs = [asyncio.create_task(_collect(p.stream(0), 9)) for _ in range(3)]
    await asyncio.sleep(0.02)

    live = [await _post(rxc, f"SYNTHETIC live {i}") for i in range(3)]
    await asyncio.sleep(0.1)
    assert p.store.stats()["headlines"] == 3

    # ── web goes away (deploy dead window). The receiver keeps acknowledging. ──
    net.down = True
    rc.stop()
    pl.stop()
    during = [await _post(rxc, f"SYNTHETIC during outage {i}") for i in range(4)]
    await f.drain(timeout_s=2)
    assert all((tmp_path / "journal").rglob(f"{i}.json") for i in during)

    # ── web comes back: same /data file, boot recovery before live opens. ──
    net.down = False
    for t in subs:
        t.cancel()
    p = await _boot_web(reader)
    assert p.store.stats()["recovered"] == 4
    subs = [asyncio.create_task(_collect(p.stream(0), 9)) for _ in range(3)]
    after = [await _post(rxc, f"SYNTHETIC after {i}") for i in range(2)]
    streams = await asyncio.gather(*subs)

    expected = live + during + after
    for s in streams:
        assert [e["id"] for e in s] == expected            # nothing lost, receipt order
        assert [e["seq"] for e in s] == list(range(1, 10))  # seq continued across the restart
    await rxc.aclose()


async def test_receiver_restart_loses_and_duplicates_nothing(tmp_path):
    journal_dir = str(tmp_path / "journal")
    net = Switch(_web_app())
    p = await _boot_web(web_journal.FileJournalReader(journal_dir))
    rxc, f = _receiver(jr.FileJournal(journal_dir), net)
    first = [await _post(rxc, f"SYNTHETIC a{i}") for i in range(3)]
    await f.drain()
    await rxc.aclose()
    rxc, f = _receiver(jr.FileJournal(journal_dir), net)       # the restarted instance
    second = [await _post(rxc, f"SYNTHETIC b{i}") for i in range(2)]
    await f.drain()
    out = await rc.Reconciler(p, web_journal.FileJournalReader(journal_dir)).run_once()
    assert out["recovered"] == 0
    assert [h["event_id"] for h in p.store.recent()] == first + second
    await rxc.aclose()


async def test_a_sender_retry_is_one_headline_with_a_visible_count(tmp_path):
    net = Switch(_web_app())
    journal = jr.FileJournal(str(tmp_path / "journal"))
    p = await _boot_web(web_journal.FileJournalReader(str(tmp_path / "journal")))
    rxc, f = _receiver(journal, net)
    a = await _post(rxc, "SYNTHETIC: Example Corp halted")
    b = await _post(rxc, "SYNTHETIC: Example Corp halted")
    await f.drain()
    (h,) = p.store.recent()
    assert h["event_id"] == a and h["repeat_count"] == 1
    assert p.store.known(b)                                      # the retry is kept, not dropped
    assert len(list((tmp_path / "journal").rglob("*.json"))) == 2
    await rxc.aclose()


async def test_r2_shaped_journal_end_to_end_with_web_down():
    s3 = FakeS3()
    net = Switch(_web_app())
    net.down = True
    rxc, f = _receiver(jr.S3Journal(s3, "txn-journal"), net)
    ids = [await _post(rxc, f"SYNTHETIC r2 {i}") for i in range(5)]
    await f.drain()
    p = await _boot_web(web_journal.S3JournalReader(s3, "txn-journal"))
    assert [h["event_id"] for h in p.store.recent()] == ids
    await rxc.aclose()


async def test_r2_down_and_web_down_means_no_ack_and_nothing_visible():
    s3 = FakeS3()
    s3.fail_put = True
    net = Switch(_web_app())
    net.down = True
    p = await _boot_web(web_journal.S3JournalReader(s3, "b"))
    rxc, f = _receiver(jr.S3Journal(s3, "b"), net)
    sub = asyncio.create_task(_collect(p.stream(0), 1, timeout=0.8))
    r = await rxc.post(f"/hook/{HOOK_TOKEN}", json={"source": "TXNews1", "content": "SYNTHETIC x"})
    assert r.status_code == 503
    await f.drain()
    with pytest.raises(asyncio.TimeoutError):
        await sub                                                # nobody ever saw it
    assert p.store.stats()["headlines"] == 0
    await rxc.aclose()


async def test_every_visible_headline_is_durable_somewhere():
    """Visible => committed on web (FULL sync). R2 failing never makes a shown
    headline unacknowledged, so the sender has no reason to retry it."""
    s3 = FakeS3()
    s3.fail_put = True
    net = Switch(_web_app())
    p = await _boot_web(web_journal.S3JournalReader(s3, "b"))
    rxc, f = _receiver(jr.S3Journal(s3, "b"), net)
    seen = asyncio.create_task(_collect(p.stream(0), 1))
    r = await rxc.post(f"/hook/{HOOK_TOKEN}", json={"source": "TXNews1", "content": "SYNTHETIC y"})
    assert r.status_code == 200
    (ev,) = await seen
    assert p.store.known(ev["id"])
    assert p.store._conn().execute("PRAGMA synchronous").fetchone()[0] == 2   # FULL
    await rxc.aclose()


# ── parity: the two sides agree on the contract ──────────────────────────────

def test_record_and_key_parity_between_receiver_and_web(tmp_path):
    cfg = rx.Config({})
    r = rx.build_record("TXNews1", "SYNTHETIC parity", {"k": 1}, rx.delivery_meta({}, 1, None), cfg)
    v = records.validate(r)
    assert v["id"] == r["id"] and v["extra_keys"] == ["k"]
    assert jr.EVENT_ID_RE.pattern == records.EVENT_ID_RE.pattern
    assert jr.DEFAULT_PREFIX == web_journal.DEFAULT_PREFIX
    rnd = random.Random(7)
    for _ in range(200):
        ms = rnd.randrange(1_577_836_800_000, 4_102_444_800_000)
        assert jr.cursor_for_ms(ms) == web_journal.cursor_for_ms(ms)
    fj = jr.FileJournal(str(tmp_path))
    fj.put(r)
    reader = web_journal.FileJournalReader(str(tmp_path))
    assert list(reader.ids_after(web_journal.cursor_for_ms(r["received_at_ms"]))) == [r["id"]]
    s3 = FakeS3()
    jr.S3Journal(s3, "b").put(r)
    assert web_journal.S3JournalReader(s3, "b").get(r["id"]) == r
    assert rx.RECORD_VERSION == records.RECORD_VERSION


# ── latency (informational, in-process) ──────────────────────────────────────

async def test_local_latency_webhook_to_subscriber(tmp_path, capsys):
    """Arrival is timestamped by the SUBSCRIBER, independently of the ack, so the
    live path (push, which does not wait on storage) and the ack path (journal
    fsync) are measured separately."""
    net = Switch(_web_app())
    p = await _boot_web(web_journal.FileJournalReader(str(tmp_path / "j")))
    rxc, f = _receiver(jr.FileJournal(str(tmp_path / "j")), net)
    arrived: dict[str, float] = {}

    async def consume():
        async for ev in p.stream(p.store.last_seq()):
            arrived[ev["content"]] = time.perf_counter()
            if len(arrived) == 200:
                return
    task = asyncio.create_task(consume())
    await asyncio.sleep(0.02)
    sent, ack = {}, []
    for i in range(200):
        key = f"SYNTHETIC latency {i}"
        sent[key] = time.perf_counter()
        await _post(rxc, key)
        ack.append((time.perf_counter() - sent[key]) * 1000)
        await asyncio.sleep(0.002)
    await asyncio.wait_for(task, 5)
    await f.drain()
    deliver = [(arrived[k] - sent[k]) * 1000 for k in sent]

    def q(xs, pct):
        return statistics.quantiles(xs, n=100)[pct - 1]
    with capsys.disabled():
        print(f"\n[txn latency, in-process, n=200] webhook->subscriber p50={q(deliver, 50):.2f}ms "
              f"p95={q(deliver, 95):.2f}ms p99={q(deliver, 99):.2f}ms max={max(deliver):.2f}ms | "
              f"ack incl. journal fsync p50={q(ack, 50):.2f}ms p95={q(ack, 95):.2f}ms | "
              f"store commit last={p.last_ingest_latency_ms:.2f}ms")
    assert q(deliver, 95) < 250
    await rxc.aclose()
