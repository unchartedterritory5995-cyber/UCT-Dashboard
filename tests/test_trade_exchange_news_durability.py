"""Checkpoint D1 durability audit — acknowledged headlines vs both stores.

The defect this file exists for: the receiver may acknowledge a headline that only
WEB holds (R2 failing at that moment); its retry was in memory and died with a
receiver restart, so the R2 copy could be lost for good. The fix makes web's
ledger the durable owner of that repair. Synthetic data only.

THE GUARANTEE TESTED (and no stronger one is claimed):
  * an acknowledged headline is held by AT LEAST ONE durable store at all times;
  * once R2 accepts writes, it is held by BOTH, whatever restarted in between;
  * replay order (seq) is unaffected by repair.
NOT guaranteed: a headline held only by web is lost if web's volume is destroyed
before R2 recovers.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import sqlite3

import httpx
import pytest
from fastapi import FastAPI

from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import config, journal_reader as web_journal
from api.services.trade_exchange_news import pipeline as pl, reconcile as rc
from api.services.trade_exchange_news.store import Store
from tests.support.txn_fakes import FakeS3, load_receiver

M = load_receiver()
rx, jr, fw, appmod = M["txn_receiver"], M["txn_journal"], M["txn_forwarder"], M["txn_app"]

HOOK_TOKEN = "txn_" + "D" * 43
INGEST_TOKEN = "ingest-" + "d" * 40
BUCKET = "txn-journal"


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_INGEST_TOKEN_SHA256", config.sha256_hex(INGEST_TOKEN))
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "web.db"))
    monkeypatch.setenv("TXN_BOOT_READY_WAIT_S", "1")
    monkeypatch.setattr(rc, "REPAIR_GRACE_MS", 0)
    # The receiver's in-memory retry must NOT be what saves the day here.
    monkeypatch.setattr(appmod, "REJOURNAL_DELAYS_S", (3600.0,))
    yield
    rc.stop()
    pl.stop()


class Net(httpx.AsyncBaseTransport):
    def __init__(self, app):
        self.inner = httpx.ASGITransport(app=app)
        self.down = False

    async def handle_async_request(self, request):
        if self.down:
            raise httpx.ConnectError("web unreachable")
        return await self.inner.handle_async_request(request)


def web_app() -> FastAPI:
    app = FastAPI()
    app.include_router(route.router)
    return app


def receiver(journal, net):
    cfg = rx.Config({"TXN_RECEIVER_ENABLED": "1", "TXN_WEBHOOK_TOKEN_SHA256": rx.token_sha256(HOOK_TOKEN),
                     "TXN_INGEST_TOKEN": INGEST_TOKEN, "TXN_STORAGE_PERMISSION_CONFIRMED": "1",
                     "TXN_WEB_INGEST_URL": "http://web.internal" + route.INGEST_PATH,
                     "TXN_RATE_BURST": "10000", "TXN_JOURNAL_TIMEOUT_S": "1"})
    f = fw.Forwarder(cfg.web_ingest_url, cfg.ingest_token, client=httpx.AsyncClient(transport=net))
    app = appmod.create_app(cfg, journal, f)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rx"), f, app


async def boot_web(s3) -> tuple[pl.Pipeline, rc.Reconciler]:
    p = pl.start(asyncio.get_running_loop())
    r = rc.Reconciler(p, web_journal.S3JournalReader(s3, BUCKET))
    await r.run_once()
    p.ready.set()
    return p, r


def stop_web():
    rc.stop()
    pl.stop()


async def post(c, content):
    return await c.post(f"/hook/{HOOK_TOKEN}", json={"source": "TXNews1", "content": content})


def r2_ids(s3):
    return {k.rsplit("/", 1)[1][:-5] for (_b, k) in s3.objects}


# ── the defect, reproduced and closed ────────────────────────────────────────

async def test_web_only_ack_survives_a_receiver_restart_and_is_repaired_into_r2():
    s3 = FakeS3()
    net = Net(web_app())
    p, r = await boot_web(s3)
    rxc, f, _ = receiver(jr.S3Journal(s3, BUCKET), net)
    s3.fail_put = True                                         # R2 down
    resp = await post(rxc, "SYNTHETIC: acked while R2 is down")
    assert resp.status_code == 200
    eid = resp.json()["id"]
    await f.drain()
    await rxc.aclose()                                         # the receiver restarts: its retry is gone
    assert eid not in r2_ids(s3) and p.store.known(eid)
    assert p.store.journal_backlog()["count"] == 1

    s3.fail_put = False                                        # R2 recovers
    out = await r.repair_once()
    assert out["repaired"] == 1 and out["backlog"]["count"] == 0
    assert eid in r2_ids(s3)
    # Byte-identical to what the receiver itself would have written.
    (key,) = [k for (_b, k) in s3.objects if eid in k]
    stored = json.loads(s3.objects[(BUCKET, key)])
    assert jr.encode(stored) == s3.objects[(BUCKET, key)]
    assert stored["id"] == eid and stored["content"] == "SYNTHETIC: acked while R2 is down"


async def test_the_repair_backlog_survives_a_web_restart():
    s3 = FakeS3()
    s3.fail_put = True
    net = Net(web_app())
    p, r = await boot_web(s3)
    rxc, f, _ = receiver(jr.S3Journal(s3, BUCKET), net)
    eid = (await post(rxc, "SYNTHETIC: before the web restart")).json()["id"]
    await f.drain()
    await r.repair_once()                                      # R2 still down: fails, backlog kept
    assert p.store.journal_backlog()["count"] == 1 and r.last_repair_error
    stop_web()                                                 # web deploys
    s3.fail_put = False
    p, r = await boot_web(s3)                                  # same /data file
    assert p.store.journal_backlog()["count"] == 1
    await r.repair_once()
    assert eid in r2_ids(s3) and p.store.journal_backlog()["count"] == 0
    await rxc.aclose()


async def test_a_long_r2_outage_is_reported_never_silent(caplog, monkeypatch):
    monkeypatch.setattr(rc, "REPAIR_WARN_MS", 0)
    s3 = FakeS3()
    s3.fail_put = True
    net = Net(web_app())
    p, r = await boot_web(s3)
    rxc, f, _ = receiver(jr.S3Journal(s3, BUCKET), net)
    await post(rxc, "SYNTHETIC: r2 outage")
    await f.drain()
    caplog.set_level(logging.WARNING)
    await asyncio.sleep(0.01)
    out = await r.repair_once()
    assert out["error"] == "ConnectionError"
    assert any("held by web only" in m for m in caplog.messages)
    snap = r.snapshot()["journal_repair"]
    assert snap["backlog"]["count"] == 1 and snap["last_error"] == "ConnectionError"
    await rxc.aclose()


async def test_parallel_repair_keeps_only_the_failed_puts_in_the_backlog():
    """D2: repair PUTs run in parallel; one failing PUT must not lose or block the rest."""
    s3 = FakeS3()
    s3.fail_put = True
    net = Net(web_app())
    p, r = await boot_web(s3)
    rxc, f, _ = receiver(jr.S3Journal(s3, BUCKET), net)
    ids = [(await post(rxc, f"SYNTHETIC: parallel repair {n}")).json()["id"] for n in range(20)]
    await f.drain()
    s3.fail_put = False
    real_put, poisoned = s3.put_object, ids[7]

    def put_object(**kw):
        if poisoned in kw["Key"]:
            raise ConnectionError("one PUT fails")
        return real_put(**kw)

    s3.put_object = put_object
    out = await r.repair_once()
    assert out["repaired"] == 19 and out["error"] == "ConnectionError"
    assert out["backlog"]["count"] == 1 and r.last_repair_error == "ConnectionError"
    assert r2_ids(s3) == set(ids) - {poisoned}
    s3.put_object = real_put
    out = await r.repair_once()
    assert out["repaired"] == 1 and out["backlog"]["count"] == 0 and r.last_repair_error is None
    assert r2_ids(s3) == set(ids)
    await rxc.aclose()


async def test_records_the_receiver_did_journal_are_confirmed_without_a_rewrite():
    s3 = FakeS3()
    net = Net(web_app())
    p, r = await boot_web(s3)
    rxc, f, _ = receiver(jr.S3Journal(s3, BUCKET), net)
    for i in range(3):
        assert (await post(rxc, f"SYNTHETIC: normal {i}")).status_code == 200
    await f.drain()
    await r.run_once()                                         # the cycle's LIST
    puts_before = s3.calls.count("put")
    lists_before = s3.calls.count("list")
    out = await r.repair_once()
    assert s3.calls.count("list") == lists_before              # steady state: the cycle's LIST is reused
    assert out == {**out, "confirmed": 3, "repaired": 0}
    assert s3.calls.count("put") == puts_before                # nothing rewritten
    assert p.store.journal_backlog()["count"] == 0
    await rxc.aclose()


async def test_recovered_records_are_journaled_by_definition_and_fresh_ones_wait_out_the_grace(monkeypatch):
    s3 = FakeS3()
    journal = jr.S3Journal(s3, BUCKET)
    rec = rx.build_record("TXNews1", "SYNTHETIC: from the journal", {}, rx.delivery_meta({}, 1, None),
                          rx.Config({}))
    journal.put(rec)
    p, r = await boot_web(s3)                                  # boot recovery ingests it
    assert p.store.journal_backlog()["count"] == 0
    monkeypatch.setattr(rc, "REPAIR_GRACE_MS", 60_000)
    s3.fail_put = True
    net = Net(web_app())
    rxc, f, _ = receiver(journal, net)
    await post(rxc, "SYNTHETIC: fresh")
    await f.drain()
    puts = s3.calls.count("put")
    out = await r.repair_once()
    assert out["repaired"] == 0 and s3.calls.count("put") == puts   # inside the grace: untouched
    await rxc.aclose()


async def test_an_old_store_without_the_new_columns_migrates(tmp_path):
    path = str(tmp_path / "old.db")
    c = sqlite3.connect(path)
    c.executescript("""CREATE TABLE deliveries (event_id TEXT PRIMARY KEY, headline_seq INTEGER NOT NULL,
        received_at_ms INTEGER NOT NULL, kind TEXT NOT NULL, via TEXT NOT NULL, ingested_at_ms INTEGER NOT NULL,
        header_names TEXT NOT NULL DEFAULT '[]', extra_keys TEXT NOT NULL DEFAULT '[]');
        INSERT INTO deliveries VALUES ('01AAAAAAAAAAAAAAAAAAAAAAAA', 1, 1, 'headline', 'push', 1, '[]', '[]');""")
    c.commit()
    c.close()
    s = Store(path)
    assert s.journal_backlog()["count"] == 1                   # pre-D1 rows: unconfirmed, repairable
    assert s.unjournaled()[0][2] is None                       # ...but no body: confirm-only, never rewritten


# ── the invariant, under random faults ───────────────────────────────────────

@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
async def test_an_acknowledged_headline_is_never_in_neither_store(seed):
    """Random R2 outages, web outages, web restarts and receiver restarts while
    headlines arrive. After EVERY step: each 2xx-acked id is in web's store or
    R2. At the end (everything healthy, one recovery + repair cycle): each is in
    BOTH, exactly once in the feed, in a contiguous seq order."""
    rnd = random.Random(seed)
    s3 = FakeS3()
    net = Net(web_app())
    p, r = await boot_web(s3)
    rxc, f, _ = receiver(jr.S3Journal(s3, BUCKET), net)
    acked: list[str] = []

    def held(eid):
        return eid in r2_ids(s3) or (pl.get() is not None and pl.get().store.known(eid))

    for step in range(40):
        roll = rnd.random()
        if roll < 0.15:
            s3.fail_put = not s3.fail_put
        elif roll < 0.25:
            net.down = not net.down
        elif roll < 0.30:
            stop_web()
            p, r = await boot_web(s3)
        elif roll < 0.35:
            await f.drain()
            await rxc.aclose()
            rxc, f, _ = receiver(jr.S3Journal(s3, BUCKET), net)
        resp = await post(rxc, f"SYNTHETIC fault-run {seed}/{step}")
        if resp.status_code == 200:
            acked.append(resp.json()["id"])
        else:
            assert resp.status_code == 503                     # never acked without a store
        await f.drain()
        if rnd.random() < 0.3:
            await r.run_once()
            await r.repair_once()
        for eid in acked:
            assert held(eid), f"step {step}: acked {eid} is in neither store"

    s3.fail_put = False
    net.down = False
    await r.run_once()
    await r.repair_once()
    ids = r2_ids(s3)
    store = pl.get().store
    for eid in acked:
        assert eid in ids and store.known(eid)
    seqs = [h["seq"] for h in store.after(0, 10_000)]
    assert seqs == list(range(1, len(seqs) + 1))
    assert store.journal_backlog()["count"] == 0
    await rxc.aclose()
