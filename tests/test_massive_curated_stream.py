"""Curated-stream broadcaster: pub/sub fan-out + bounded drop-oldest + cap.

The DELIVERY layer of the curated SSE (api/massive_curated_stream.py) — the part
that is pure in-process pub/sub and independent of flow.db / the classifier. It
mirrors api/massive_stream.py's proven contract: every subscriber's queue gets
every broadcast, a slow/stuck client's queue is bounded (drop-oldest so RSS can't
grow), and the subscriber cap sheds new clients to polling instead of unbounded
fan-out. asyncio.Queue.put_nowait/get_nowait are synchronous, so no event loop
is needed here.
"""
import asyncio

import pytest

from api import massive_curated_stream as mcs


@pytest.fixture(autouse=True)
def _clean_subscribers():
    # isolate each test — the module keeps a process-global subscriber set
    saved_max = mcs.MAX_SUBSCRIBERS
    saved_qmax = mcs._QUEUE_MAX
    mcs._subscribers.clear()
    yield
    mcs._subscribers.clear()
    mcs.MAX_SUBSCRIBERS = saved_max
    mcs._QUEUE_MAX = saved_qmax


def test_broadcast_fans_out_to_every_subscriber():
    q1 = mcs.subscribe()
    q2 = mcs.subscribe()
    assert mcs.subscriber_count() == 2
    payload = [{"id": 1, "ticker": "NBIS"}]
    mcs._broadcast(payload)
    assert q1.get_nowait() is payload
    assert q2.get_nowait() is payload


def test_broadcast_empty_is_a_noop():
    q = mcs.subscribe()
    mcs._broadcast([])
    assert q.empty()


def test_slow_client_queue_is_bounded_drop_oldest():
    mcs._QUEUE_MAX = 2
    q = mcs.subscribe()
    assert q.maxsize == 2
    mcs._broadcast([{"id": 1}])
    mcs._broadcast([{"id": 2}])
    mcs._broadcast([{"id": 3}])  # queue full → oldest ({id:1}) dropped
    assert q.qsize() == 2
    first = q.get_nowait()
    second = q.get_nowait()
    ids = {first[0]["id"], second[0]["id"]}
    assert ids == {2, 3}  # newest retained, oldest evicted


def test_subscriber_cap_sheds_new_clients_to_polling():
    mcs.MAX_SUBSCRIBERS = 1
    assert mcs.subscribe() is not None
    assert mcs.subscribe() is None  # over cap → caller falls back to polling
    assert mcs.subscriber_count() == 1


def test_unsubscribe_removes_the_queue():
    q = mcs.subscribe()
    assert mcs.subscriber_count() == 1
    mcs.unsubscribe(q)
    assert mcs.subscriber_count() == 0
    mcs.unsubscribe(q)  # idempotent — discard, never raises


def test_stats_shape():
    s = mcs.stats()
    for k in ("enabled", "started", "subscribers", "last_id", "day",
              "tracked_contracts", "broadcasts_total", "alerts_streamed_total"):
        assert k in s
