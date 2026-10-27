"""Trade Exchange News receiver — process lifecycle on REAL sockets (Checkpoint D1).

What a Railway deploy does to the receiver, reproduced locally with the real
entrypoint pieces (``txn_serve.build_listener`` + uvicorn ``Server``):
  * startup: the dual-stack listener answers over IPv4 AND IPv6;
  * healthcheck: 200 only when configured; 503 (deploy fails, old one keeps
    serving) when the journal is not durable or storage is not permitted;
  * graceful shutdown (what uvicorn does on SIGTERM): an in-flight webhook
    finishes with its 2xx; new connections are refused;
  * the timeout chain: journal timeout < uvicorn graceful window < Railway
    drainingSeconds, so a shutdown never cuts a durable write short;
  * overlap: two receiver instances serving at once both deliver, and a sender
    retry that lands on the other instance is one headline on web, not two.

What this CANNOT show: how Railway's edge routes requests during overlap and
draining. That is measured on a staging deploy in D2 (tools/txn_deploy_probe.py).
Synthetic data only.
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from tests.support.txn_fakes import RECEIVER_DIR, FakeS3, load_receiver

M = load_receiver()
rx, jr, fw, appmod, serve = (M["txn_receiver"], M["txn_journal"], M["txn_forwarder"],
                             M["txn_app"], M["txn_serve"])

TOKEN = "txn_" + "L" * 43
BODY = {"source": "TXNews1", "content": "SYNTHETIC: lifecycle"}


def cfg(**over):
    env = {"TXN_RECEIVER_ENABLED": "1", "TXN_WEBHOOK_TOKEN_SHA256": rx.token_sha256(TOKEN),
           "TXN_STORAGE_PERMISSION_CONFIRMED": "1", "TXN_INGEST_TOKEN": "",
           "RAILWAY_ENVIRONMENT": "staging"}
    env.update(over)
    return rx.Config(env)


class Running:
    """A real uvicorn server on a real dual-stack socket, in a thread."""

    def __init__(self, app):
        self.sock = serve.build_listener(0)
        self.port = self.sock.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="warning",
                                                    timeout_graceful_shutdown=5))
        self.thread = threading.Thread(target=self.server.run, kwargs={"sockets": [self.sock]}, daemon=True)

    def __enter__(self):
        t0 = time.perf_counter()
        self.thread.start()
        while not self.server.started:
            assert time.perf_counter() - t0 < 10, "server never started"
            time.sleep(0.01)
        self.startup_s = time.perf_counter() - t0
        return self

    def stop(self):
        self.server.should_exit = True          # exactly what uvicorn's SIGTERM handler sets

    def __exit__(self, *exc):
        self.stop()
        self.thread.join(10)


def url(port, host="127.0.0.1", path="/health"):
    h = f"[{host}]" if ":" in host else host
    return f"http://{h}:{port}{path}"


def test_startup_is_fast_and_answers_on_both_ip_families():
    with Running(appmod.create_app(cfg(), jr.S3Journal(FakeS3(), "b"))) as srv:
        assert srv.startup_s < 5
        assert httpx.get(url(srv.port)).status_code == 200
        if socket.has_ipv6:
            assert httpx.get(url(srv.port, "::1")).status_code == 200
        # Railway probes with Host: healthcheck.railway.app — the receiver must not care.
        assert httpx.get(url(srv.port), headers={"host": "healthcheck.railway.app"}).status_code == 200


def test_a_misconfigured_deploy_fails_its_healthcheck_so_the_old_one_keeps_serving():
    for bad in (cfg(TXN_STORAGE_PERMISSION_CONFIRMED=""), cfg(TXN_WEBHOOK_TOKEN_SHA256="")):
        with Running(appmod.create_app(bad, jr.S3Journal(FakeS3(), "b"))) as srv:
            assert httpx.get(url(srv.port)).status_code == 503
    with Running(appmod.create_app(cfg(), jr.MemoryJournal())) as srv:      # not durable on Railway
        assert "journal_not_durable" in httpx.get(url(srv.port)).json()["problems"]


def test_graceful_shutdown_finishes_the_in_flight_webhook_then_refuses_new_ones():
    s3 = FakeS3()
    s3.put_delay_s = 1.5                       # a slow R2 write is in flight when SIGTERM lands
    srv = Running(appmod.create_app(cfg(), jr.S3Journal(s3, "b"))).__enter__()
    result = {}

    def send():
        result["r"] = httpx.post(url(srv.port, path=f"/hook/{TOKEN}"), json=BODY, timeout=10)

    t = threading.Thread(target=send)
    t.start()
    time.sleep(0.4)                            # the request is now waiting on the journal
    srv.stop()
    t.join(10)
    srv.thread.join(10)
    assert result["r"].status_code == 200      # finished, durable, acknowledged
    assert len(s3.objects) == 1
    # No new webhook is served: refused, or (Windows: the pre-bound socket lingers
    # until the process exits) never accepted. On Railway the process then exits.
    with pytest.raises((httpx.ConnectError, httpx.ConnectTimeout)):
        httpx.post(url(srv.port, path=f"/hook/{TOKEN}"), json=BODY, timeout=2)


def test_the_timeout_chain_never_cuts_a_durable_write_short():
    """journal timeout (TXN_JOURNAL_TIMEOUT_S) < uvicorn graceful window < Railway
    drainingSeconds — each layer gives the one inside it room to finish."""
    serve_src = (RECEIVER_DIR / "txn_serve.py").read_text(encoding="utf-8")
    graceful = int(serve_src.split("timeout_graceful_shutdown=", 1)[1].split(")", 1)[0].split(",")[0])
    rail = json.loads((RECEIVER_DIR / "railway.json").read_text(encoding="utf-8"))["deploy"]
    assert rx.Config({}).journal_timeout_s < graceful < int(rail["drainingSeconds"])
    assert int(rail["overlapSeconds"]) > 0
    assert "numReplicas" not in rail            # not a valid top-level deploy key (Railway config-as-code)


async def test_two_overlapping_instances_both_deliver_and_a_cross_instance_retry_is_one_headline(tmp_path, monkeypatch):
    """Old and new deployments serving at once during overlap."""
    from api.routers import trade_exchange_news as route
    from api.services.trade_exchange_news import config, pipeline as pl
    from api.services.trade_exchange_news import reconcile as rc
    from api.services.trade_exchange_news.journal_reader import S3JournalReader
    from fastapi import FastAPI

    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_INGEST_TOKEN_SHA256", config.sha256_hex("ingest-overlap"))
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "web.db"))
    web = FastAPI()
    web.include_router(route.router)
    p = pl.start(asyncio.get_running_loop())
    p.ready.set()
    s3 = FakeS3()

    def instance(name):
        c = cfg(TXN_INGEST_TOKEN="ingest-overlap", TXN_WEB_INGEST_URL="http://web" + route.INGEST_PATH,
                RAILWAY_REPLICA_ID=name)
        f = fw.Forwarder(c.web_ingest_url, c.ingest_token,
                         client=httpx.AsyncClient(transport=httpx.ASGITransport(app=web)))
        app = appmod.create_app(c, jr.S3Journal(s3, "b"), f)
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rx"), f

    old, f_old = instance("old")
    new, f_new = instance("new")
    try:
        ids = []
        for i in range(10):
            client = old if i % 2 else new
            r = await client.post(f"/hook/{TOKEN}", json={"source": "TXNews1", "content": f"SYNTHETIC overlap {i}"})
            assert r.status_code == 200
            ids.append(r.json()["id"])
        # The sender did not see the first answer and retries — on the OTHER instance.
        retry = await new.post(f"/hook/{TOKEN}", json={"source": "TXNews1", "content": "SYNTHETIC overlap 9"})
        assert retry.status_code == 200
        await f_old.drain()
        await f_new.drain()
        heads = p.store.recent(50)
        assert [h["event_id"] for h in heads] == ids
        assert heads[-1]["repeat_count"] == 1                    # one headline, counted twice
        assert {json.loads(v)["receiver"]["instance"] for v in s3.objects.values()} == {"old", "new"}
        assert len(s3.objects) == 11                             # every delivery journaled
    finally:
        await old.aclose()
        await new.aclose()
        rc.stop()
        pl.stop()
