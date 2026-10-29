"""Trade Exchange News on web -- store, duplicate policy, ordering, replay, recovery, route.

Synthetic headlines only.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import pathlib

import httpx
import pytest
from fastapi import FastAPI

from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import config, pipeline as pl, records
from api.services.trade_exchange_news import reconcile as rc
from api.services.trade_exchange_news.journal_reader import FileJournalReader, S3JournalReader
from api.services.trade_exchange_news.store import KNOWN, NEW, REPEAT, Store
from tests.support.txn_fakes import FakeS3, load_receiver

M = load_receiver()
rx, jr = M["txn_receiver"], M["txn_journal"]

REPO = pathlib.Path(__file__).resolve().parents[1]
INGEST_TOKEN = "ingest-" + "z" * 40
BASE_MS = 1_800_000_000_000


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_INGEST_TOKEN_SHA256", config.sha256_hex(INGEST_TOKEN))
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "txn.db"))
    monkeypatch.setenv("TXN_SOURCE_ALLOWLIST", "TXNews1,TXNews2")
    monkeypatch.setenv("TXN_HISTORY_MAX_AGE_HOURS", str(24 * 365 * 100))  # synthetic times
    monkeypatch.delenv("TXN_DEDUPE_WINDOW_S", raising=False)
    yield
    rc.stop()
    pl.stop()


def rec(content="SYNTHETIC headline", ms=None, source="TXNews1", **extra):
    cfg = rx.Config({"TXN_SOURCE_ALLOWLIST": "TXNews1,TXNews2"})
    r = rx.build_record(source, content, extra, rx.delivery_meta({}, 10, None), cfg,
                        now_ms=BASE_MS if ms is None else ms)
    return r


def new_pipeline(tmp_path=None) -> pl.Pipeline:
    return pl.start(asyncio.get_running_loop())


async def drain(stream, n, timeout=2.0):
    out = []
    async def _take():
        async for ev in stream:
            out.append(ev)
            if len(out) >= n:
                return
    await asyncio.wait_for(_take(), timeout)
    return out


# ── idempotency and the duplicate policy ─────────────────────────────────────

async def test_same_event_id_is_one_delivery():
    p = new_pipeline()
    r = rec()
    a = await p.submit(r, "push")
    b = await p.submit(r, "reconcile")
    assert (a["kind"], b["kind"]) == (NEW, KNOWN) and a["seq"] == b["seq"]
    assert p.store.stats()["deliveries"] == 1


async def test_a_repeat_inside_the_window_is_collapsed_visibly_never_dropped():
    p = new_pipeline()
    sub = p.hub.subscribe()
    a = await p.submit(rec("SYNTHETIC: Example Corp halts", BASE_MS), "push")
    b = await p.submit(rec("  synthetic:   EXAMPLE corp halts ", BASE_MS + 30_000), "push")
    await asyncio.sleep(0)
    assert (a["kind"], b["kind"]) == (NEW, REPEAT) and b["seq"] == a["seq"]
    assert b["headline"]["repeat_count"] == 1
    assert b["headline"]["content"] == "SYNTHETIC: Example Corp halts"     # the original
    events = [sub.queue.get_nowait() for _ in range(sub.queue.qsize())]
    assert [e["type"] for e in events] == ["headline", "repeat"]
    s = p.store.stats()
    assert s["deliveries"] == 2 and s["collapsed"] == 1 and s["headlines"] == 1


async def test_outside_the_window_or_another_source_is_a_new_headline():
    p = new_pipeline()
    a = await p.submit(rec("SYNTHETIC same words", BASE_MS), "push")
    b = await p.submit(rec("SYNTHETIC same words", BASE_MS + 61_000), "push")
    c = await p.submit(rec("SYNTHETIC same words", BASE_MS + 1_000, source="TXNews2"), "push")
    assert [x["kind"] for x in (a, b, c)] == [NEW, NEW, NEW]


async def test_window_zero_turns_collapsing_off(monkeypatch):
    monkeypatch.setenv("TXN_DEDUPE_WINDOW_S", "0")
    p = new_pipeline()
    kinds = [(await p.submit(rec("SYNTHETIC x", BASE_MS + i), "push"))["kind"] for i in range(3)]
    assert kinds == [NEW, NEW, NEW]


async def test_a_recovered_repeat_older_than_its_twin_still_collapses():
    p = new_pipeline()
    await p.submit(rec("SYNTHETIC twin", BASE_MS + 20_000), "push")
    late = await p.submit(rec("SYNTHETIC twin", BASE_MS), "reconcile")
    assert late["kind"] == REPEAT


def test_normalization_is_for_matching_only():
    assert records.normalize("Ｅｘａｍｐｌｅ　 CORP\n\nhalts ") == "example corp halts"
    assert records.dedupe_key("TXNews1", "A  b") == records.dedupe_key("TXNews1", "a b")
    assert records.dedupe_key("TXNews1", "a b") != records.dedupe_key("TXNews2", "a b")


@pytest.mark.parametrize("mutate", [
    lambda r: r.update(v=2), lambda r: r.update(id="bad"), lambda r: r.update(received_at_ms=5),
    lambda r: r.update(source="Imposter"), lambda r: r.update(content="  "),
    lambda r: r.update(content="x" * 9000), lambda r: r.update(received_at_ms=True),
])
async def test_invalid_records_are_refused_and_counted(mutate):
    p = new_pipeline()
    r = rec()
    mutate(r)
    with pytest.raises(records.RecordError):
        await p.submit(r, "push")
    assert p.counts["invalid"] == 1 and p.store.stats()["deliveries"] == 0


# ── retention ────────────────────────────────────────────────────────────────

def test_prune_bounds_by_age_and_count_and_never_reuses_seq(tmp_path):
    s = Store(str(tmp_path / "p.db"))
    for i in range(10):
        r = records.validate(rec(f"SYNTHETIC {i}", BASE_MS + i * 1000))
        s.ingest(r, via="push", dedupe_key=str(i), window_ms=0, tickers=[])
    out = s.prune(max_age_ms=5_500, max_items=3, now_ms=BASE_MS + 9_000)
    assert out["by_age"] == 4 and out["by_count"] == 3
    assert [h["seq"] for h in s.recent()] == [8, 9, 10]
    r = records.validate(rec("SYNTHETIC new", BASE_MS + 10_000))
    assert s.ingest(r, via="push", dedupe_key="n", window_ms=0, tickers=[])["seq"] == 11
    # The ledger is pruned by AGE only: count-pruned deliveries stay known, so
    # recovery can never resurrect a headline the count bound removed.
    assert s.stats()["deliveries"] == 7


# ── one ordered stream for every subscriber ──────────────────────────────────

async def test_every_subscriber_sees_the_same_order_under_concurrent_ingest():
    p = new_pipeline()
    streams = [p.stream(0) for _ in range(3)]
    tasks = [asyncio.create_task(drain(s, 60)) for s in streams]
    await asyncio.sleep(0.05)
    await asyncio.gather(*(p.submit(rec(f"SYNTHETIC {i}", BASE_MS + i * 100_000), "push")
                           for i in range(60)))
    results = await asyncio.gather(*tasks)
    seqs = [[e["seq"] for e in r] for r in results]
    assert seqs[0] == sorted(seqs[0]) and len(set(seqs[0])) == 60
    assert seqs[0] == seqs[1] == seqs[2]


async def test_replay_after_a_seq_then_live_with_no_gap_and_no_duplicate():
    p = new_pipeline()
    for i in range(5):
        await p.submit(rec(f"SYNTHETIC {i}", BASE_MS + i * 100_000), "push")
    s = p.stream(2)
    task = asyncio.create_task(drain(s, 6))
    await asyncio.sleep(0.02)
    for i in range(5, 8):
        await p.submit(rec(f"SYNTHETIC {i}", BASE_MS + i * 100_000), "push")
    got = [e["seq"] for e in await task]
    assert got == [3, 4, 5, 6, 7, 8]


async def test_a_slow_subscriber_is_resynced_from_the_store_never_shorted(monkeypatch):
    monkeypatch.setenv("TXN_SUBSCRIBER_QUEUE_MAX", "8")
    p = new_pipeline()
    agen = p.stream(0).__aiter__()
    # The first __anext__ subscribes and parks on the queue; it takes headline 1
    # and the generator then sits at its yield, reading nothing, while 39 more
    # arrive into a queue of 8.
    nxt = asyncio.create_task(agen.__anext__())
    await asyncio.sleep(0.02)
    for i in range(40):
        await p.submit(rec(f"SYNTHETIC {i}", BASE_MS + i * 100_000), "push")
    await asyncio.sleep(0.02)
    got = [await nxt]
    while len(got) < 40:
        got.append(await asyncio.wait_for(agen.__anext__(), 2))
    assert [e["seq"] for e in got] == list(range(1, 41))
    assert p.hub.resyncs >= 1
    await agen.aclose()


# ── the boot gate ────────────────────────────────────────────────────────────

async def test_live_pushes_wait_for_boot_recovery_then_proceed(monkeypatch):
    monkeypatch.setenv("TXN_BOOT_READY_WAIT_S", "2")
    p = new_pipeline()
    task = asyncio.create_task(p.submit_live(rec("SYNTHETIC live")))
    await asyncio.sleep(0.05)
    assert not task.done()
    p.ready.set()
    assert (await task)["kind"] == NEW


async def test_boot_gate_times_out_rather_than_holding_live_hostage(monkeypatch):
    monkeypatch.setenv("TXN_BOOT_READY_WAIT_S", "0.05")
    p = new_pipeline()
    assert (await p.submit_live(rec("SYNTHETIC live")))["kind"] == NEW
    assert p.counts["boot_wait_timeouts"] == 1


# ── recovery from the journal ────────────────────────────────────────────────

async def test_reconcile_recovers_what_web_missed_in_receipt_order(tmp_path):
    journal = jr.FileJournal(str(tmp_path / "j"))
    missed = [rec(f"SYNTHETIC missed {i}", BASE_MS + i * 100_000) for i in range(5)]
    for r in reversed(missed):          # written out of order on purpose
        journal.put(r)
    p = new_pipeline()
    r = rc.Reconciler(p, FileJournalReader(str(tmp_path / "j")))
    assert (await r.run_once())["recovered"] == 5
    assert [h["event_id"] for h in p.store.recent()] == [m["id"] for m in missed]
    assert (await r.run_once())["recovered"] == 0
    assert p.store.stats()["recovered"] == 5


async def test_reconcile_skips_known_ids_without_downloading_them():
    s3 = FakeS3()
    journal = jr.S3Journal(s3, "bkt")
    p = new_pipeline()
    for i in range(3):
        r = rec(f"SYNTHETIC {i}", BASE_MS + i * 100_000)
        journal.put(r)
        await p.submit(r, "push")       # web already has them
    s3.calls.clear()
    out = await rc.Reconciler(p, S3JournalReader(s3, "bkt")).run_once()
    assert out["recovered"] == 0 and "get" not in s3.calls


async def test_reconcile_overlap_covers_receiver_clock_skew():
    s3 = FakeS3()
    journal = jr.S3Journal(s3, "bkt")
    p = new_pipeline()
    newer = rec("SYNTHETIC newer", BASE_MS + 300_000)
    journal.put(newer)
    await p.submit(newer, "push")
    skewed = rec("SYNTHETIC skewed", BASE_MS + 299_000)   # the other instance, 1 s behind
    journal.put(skewed)
    out = await rc.Reconciler(p, S3JournalReader(s3, "bkt")).run_once()
    assert out["recovered"] == 1


async def test_reconcile_pages_through_more_than_one_list_page():
    s3 = FakeS3()
    journal = jr.S3Journal(s3, "bkt")
    for i in range(1003):
        journal.put(rec(f"SYNTHETIC {i}", BASE_MS + i * 70_000))
    p = new_pipeline()
    out = await rc.Reconciler(p, S3JournalReader(s3, "bkt")).run_once()
    assert out["recovered"] == 1003 and s3.calls.count("list") == 2


async def test_a_corrupt_journal_record_is_counted_and_skipped(tmp_path):
    journal = jr.FileJournal(str(tmp_path / "j"))
    bad = rec("SYNTHETIC bad")
    bad["source"] = "Imposter"
    journal.put(bad)
    journal.put(rec("SYNTHETIC good", BASE_MS + 1))
    p = new_pipeline()
    r = rc.Reconciler(p, FileJournalReader(str(tmp_path / "j")))
    assert (await r.run_once())["recovered"] == 1 and r.invalid == 1


async def test_no_journal_means_recovery_is_off_and_says_so():
    p = new_pipeline()
    assert (await rc.Reconciler(p, None).run_once()) == {"skipped": "no_journal"}


async def test_run_forever_opens_the_boot_gate_even_if_the_journal_is_down():
    class Down:
        kind = "s3"

        def ids_after(self, _c):
            raise ConnectionError("R2 down")

    p = new_pipeline()
    r = rc.start(p, Down())
    await asyncio.wait_for(p.ready.wait(), 1)
    assert r.last_error == "ConnectionError"
    rc.stop()
    await asyncio.sleep(0)


# ── the route ────────────────────────────────────────────────────────────────

def _web_app() -> FastAPI:
    app = FastAPI()
    app.include_router(route.router)
    return app


def _client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://web.test")


AUTH = {"Authorization": f"Bearer {INGEST_TOKEN}"}


async def test_ingest_route_is_dark_when_the_flag_is_off(monkeypatch):
    new_pipeline()
    monkeypatch.setenv("TXN_ENABLED", "")
    async with _client(_web_app()) as c:
        r = await c.post(route.INGEST_PATH, json=rec(), headers=AUTH)
    assert r.status_code == 404


@pytest.mark.parametrize("headers", [
    {}, {"Authorization": "Bearer wrong"}, {"Authorization": INGEST_TOKEN},
    {**AUTH, "cf-ray": "abc-IAD"},
])
async def test_ingest_refuses_anything_but_the_receivers_bearer(headers):
    p = new_pipeline()
    p.ready.set()
    async with _client(_web_app()) as c:
        r = await c.post(route.INGEST_PATH, json=rec(), headers=headers)
    assert r.status_code == 404 and p.store.stats()["deliveries"] == 0


async def test_ingest_fails_closed_when_no_digest_is_configured(monkeypatch):
    monkeypatch.setenv("TXN_INGEST_TOKEN_SHA256", "")
    new_pipeline().ready.set()
    async with _client(_web_app()) as c:
        assert (await c.post(route.INGEST_PATH, json=rec(), headers=AUTH)).status_code == 404


async def test_ingest_accepts_then_is_idempotent_and_validates():
    p = new_pipeline()
    p.ready.set()
    r = rec()
    async with _client(_web_app()) as c:
        a = await c.post(route.INGEST_PATH, json=r, headers=AUTH)
        b = await c.post(route.INGEST_PATH, json=r, headers=AUTH)
        bad = await c.post(route.INGEST_PATH, json={**r, "id": "nope"}, headers=AUTH)
        junk = await c.post(route.INGEST_PATH, content=b"{", headers=AUTH)
    assert a.json() == {"status": "new", "seq": 1} and b.json() == {"status": "known", "seq": 1}
    assert bad.status_code == 422 and junk.status_code == 400


async def test_ingest_before_the_pipeline_starts_is_503():
    async with _client(_web_app()) as c:
        r = await c.post(route.INGEST_PATH, json=rec(), headers=AUTH)
    assert r.status_code == 503


async def test_admin_status_carries_counts_never_content():
    p = new_pipeline()
    p.ready.set()
    await p.submit(rec("SYNTHETIC secret-sauce words"), "push")
    body = json.dumps(route.status({"role": "admin"}))
    assert "secret-sauce" not in body and '"headlines": 1' in body


def test_the_ALLOWED_OPEN_ingest_still_checks_its_bearer():
    """The pairing auth_surface_check.ALLOWED_OPEN demands of every entry."""
    from api import auth_surface_check as asc
    assert ("POST", route.INGEST_PATH) in asc.ALLOWED_OPEN
    assert "/api/trade-exchange-news" in asc.AUDITED_PREFIXES
    src = inspect.getsource(route.ingest)
    first = [ln.strip() for ln in src.splitlines() if ln.strip() and not ln.strip().startswith(("@", "async def", '"""'))][0]
    assert first == "if not _check_ingest_auth(request):"
    gate = inspect.getsource(route._check_ingest_auth)
    assert "hmac.compare_digest" in gate and "cf-ray" in gate and "if not hashes" in gate


def test_main_mounts_the_router_and_starts_it_only_behind_the_flag():
    src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert "app.include_router(trade_exchange_news_router.router)" in src
    block = src.split("Trade Exchange News (Checkpoint B): the single-writer", 1)[1][:600]
    assert "if _txn_config.enabled():" in block


def test_ticker_extraction_delegates_to_the_one_resolver():
    from api.services.trade_exchange_news import categories
    assert "categories import tickers_for" in inspect.getsource(pl._tickers_for)
    assert "tr.resolve_tickers(" in inspect.getsource(categories.tickers_for)
    assert pl._tickers_for("SYNTHETIC: $ABCD jumps") == ["ABCD"]


# ── Checkpoint C reliability review: order, epoch, coverage gaps ─────────────

async def test_seq_is_contiguous_and_every_event_carries_the_epoch():
    p = new_pipeline()
    sub = p.hub.subscribe()
    for i in range(5):
        await p.submit(rec(f"SYNTHETIC {i}", BASE_MS + i * 100_000), "push")
    await p.submit(rec("SYNTHETIC 0", BASE_MS + 1), "push")          # a repeat: no seq
    await asyncio.sleep(0)
    evs = [sub.queue.get_nowait() for _ in range(sub.queue.qsize())]
    heads = [e for e in evs if e["type"] == "headline"]
    assert [e["seq"] for e in heads] == [1, 2, 3, 4, 5]
    assert {e["epoch"] for e in evs} == {p.store.epoch} and len(p.store.epoch) == 16


def test_a_recreated_database_gets_a_new_epoch(tmp_path):
    a = Store(str(tmp_path / "a.db"))
    again = Store(str(tmp_path / "a.db"))
    fresh = Store(str(tmp_path / "b.db"))
    assert a.epoch == again.epoch and a.epoch != fresh.epoch


async def test_a_record_recovered_late_is_flagged_delayed_not_slotted_into_the_past():
    import time as _t
    now = int(_t.time() * 1000)
    p = new_pipeline()
    live = await p.submit(rec("SYNTHETIC live", now), "push")
    late = await p.submit(rec("SYNTHETIC missed", now - 120_000), "reconcile")
    assert late["seq"] > live["seq"]                         # commit order, not receipt order
    evs = p.store.after(0)
    assert [pl.headline_event(r)["delayed"] for r in evs] == [False, True]


async def test_concurrent_deliveries_from_two_receiver_clocks_get_one_total_order():
    p = new_pipeline()
    a = [rec(f"SYNTHETIC a{i}", BASE_MS + i * 1000) for i in range(20)]
    b = [rec(f"SYNTHETIC b{i}", BASE_MS - 5_000 + i * 1000) for i in range(20)]   # skewed clock
    streams = [p.stream(0) for _ in range(2)]
    tasks = [asyncio.create_task(drain(s, 40)) for s in streams]
    await asyncio.sleep(0.02)
    await asyncio.gather(*(p.submit(r, "push") for pair in zip(a, b) for r in pair))
    x, y = await asyncio.gather(*tasks)
    assert [e["id"] for e in x] == [e["id"] for e in y]
    assert [e["seq"] for e in x] == list(range(1, 41))


def _rc_with(p, reader):
    return rc.Reconciler(p, reader)


async def test_first_boot_records_no_gap(tmp_path):
    p = new_pipeline()
    r = _rc_with(p, FileJournalReader(str(tmp_path)))
    r.boot_assess()
    assert r.coverage()["complete"] is True


async def test_an_outage_longer_than_retention_is_reported_as_a_gap(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_HISTORY_MAX_AGE_HOURS", "168")
    monkeypatch.setenv("TXN_JOURNAL_RETENTION_HOURS", "192")
    import time as _t
    now = int(_t.time() * 1000)
    p = new_pipeline()
    p.store.set_state("alive_ms", str(now - 9 * 24 * 3600 * 1000))     # down 9 days
    r = _rc_with(p, FileJournalReader(str(tmp_path)))
    r.boot_assess(now)
    cov = r.coverage(now)
    assert cov["complete"] is False
    (g,) = cov["gaps"]
    assert g["reason"] == "outage_exceeded_retention"
    assert g["to_ms"] == now - 168 * 3600 * 1000          # recoverable floor = min(history, journal)


async def test_a_short_outage_inside_retention_is_complete(tmp_path):
    import time as _t
    now = int(_t.time() * 1000)
    p = new_pipeline()
    p.store.set_state("alive_ms", str(now - 120_000))
    r = _rc_with(p, FileJournalReader(str(tmp_path)))
    r.boot_assess(now)
    assert r.coverage(now)["complete"] is True


async def test_no_journal_means_the_downtime_window_is_a_gap():
    import time as _t
    now = int(_t.time() * 1000)
    p = new_pipeline()
    p.store.set_state("alive_ms", str(now - 60_000))
    r = _rc_with(p, None)
    r.boot_assess(now)
    assert [g["reason"] for g in r.coverage(now)["gaps"]] == ["no_journal"]


async def test_an_unreachable_journal_is_a_gap_until_a_scan_succeeds(tmp_path):
    class Flaky:
        kind = "s3"
        down = True

        def ids_after(self, cursor):
            if self.down:
                raise ConnectionError("R2 down")
            return iter(())

        def get(self, eid):
            raise AssertionError

    p = new_pipeline()
    p.store.set_state("alive_ms", str(int(__import__("time").time() * 1000) - 30_000))
    reader = Flaky()
    r = _rc_with(p, reader)
    await r.run_once()
    assert [g["reason"] for g in r.coverage()["gaps"]] == ["journal_unreachable"]
    reader.down = False
    await r.run_once()
    assert r.coverage()["complete"] is True


async def test_a_long_outage_backlog_is_fetched_in_parallel_but_ingested_in_order(tmp_path):
    import time as _t
    journal = jr.FileJournal(str(tmp_path / "j"))
    base = int(_t.time() * 1000) - 3600_000
    recs = [rec(f"SYNTHETIC backlog {i}", base + i * 1000) for i in range(300)]
    for r_ in recs:
        journal.put(r_)
    p = new_pipeline()
    r = _rc_with(p, FileJournalReader(str(tmp_path / "j")))
    assert (await r.run_once())["recovered"] == 300
    assert [h["event_id"] for h in p.store.after(0, 1000)] == [x["id"] for x in recs]


async def test_synthetic_only_web_refuses_a_non_synthetic_record_on_every_path(monkeypatch):
    """Staging (D2) stores synthetic records only: the push route AND recovery both go
    through records.validate, so neither can hold real content."""
    monkeypatch.setenv("TXN_SYNTHETIC_ONLY", "1")
    assert config.storage_allowed()
    p = new_pipeline()
    p.ready.set()
    async with _client(_web_app()) as c:
        ok = await c.post(route.INGEST_PATH, json=rec(), headers=AUTH)
        real = await c.post(route.INGEST_PATH, json=rec("Example Corp beats estimates"), headers=AUTH)
    assert ok.status_code == 200 and real.status_code == 422
    with pytest.raises(pl.records.RecordError):
        await p.submit(rec("Example Corp beats estimates"), via="reconcile")
    assert p.store.stats()["deliveries"] == 1
