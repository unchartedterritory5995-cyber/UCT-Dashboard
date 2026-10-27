"""Trade Exchange News member surface: /recent + /stream (admin-only, dark).

Synthetic headlines only. The SSE generator is driven directly (an in-process
ASGI transport would buffer an endless body), with a request stand-in whose
disconnect we control.
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from api.middleware import auth_middleware
from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import config, pipeline as pl
from api.services.trade_exchange_news import reconcile as rc
from tests.support.txn_fakes import load_receiver

rx = load_receiver()["txn_receiver"]
BASE_MS = 1_800_000_000_000
ADMIN = {"id": "admin-1", "role": "admin", "email": "a@test"}
MEMBER = {"id": "member-1", "role": "user", "email": "m@test"}


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "txn.db"))
    monkeypatch.setenv("TXN_HISTORY_MAX_AGE_HOURS", str(24 * 365 * 100))
    monkeypatch.setattr(route, "HEARTBEAT_S", 0.05)
    route._streams.clear()
    yield
    rc.stop()
    pl.stop()
    route._streams.clear()


def rec(content, i=0):
    cfg = rx.Config({})
    return rx.build_record("TXNews1", content, {}, rx.delivery_meta({}, 1, None), cfg,
                           now_ms=BASE_MS + i * 100_000)


class FakeRequest:
    def __init__(self, headers=None):
        self.headers = headers or {}
        self.gone = False

    async def is_disconnected(self):
        return self.gone


def parse(chunk: str) -> tuple[str | None, str, dict]:
    eid, ev, data = None, "message", {}
    for line in chunk.strip().split("\n"):
        k, _, v = line.partition(": ")
        if k == "id":
            eid = v
        elif k == "event":
            ev = v
        elif k == "data":
            data = json.loads(v)
    return eid, ev, data


async def take(resp, n, timeout=2.0, skip_heartbeats=True):
    out = []
    it = resp.body_iterator.__aiter__()

    async def go():
        while len(out) < n:
            frame = parse(await it.__anext__())
            if skip_heartbeats and frame[1] == "heartbeat":
                continue
            out.append(frame)
    await asyncio.wait_for(go(), timeout)
    return out, it


async def open_stream(admin=ADMIN, headers=None, **q):
    req = FakeRequest(headers)
    resp = await route.stream(req, after=q.get("after"), epoch=q.get("epoch", ""),
                              last_event_id=q.get("last_event_id", ""), admin=admin)
    return req, resp


def _app(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[auth_middleware.get_current_user] = lambda: user
    return app


async def _get(user, path):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app(user)),
                                 base_url="http://web.test") as c:
        return await c.get(path)


# ── authorization ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", [route.RECENT_PATH, route.STREAM_PATH])
async def test_signed_out_and_non_admin_members_get_nothing(path):
    pl.start(asyncio.get_running_loop())
    anon = await _get(None, path)
    member = await _get(MEMBER, path)
    assert anon.status_code == 401 and member.status_code == 403
    assert "SYNTHETIC" not in anon.text + member.text


async def test_routes_are_dark_when_the_flag_is_off(monkeypatch):
    pl.start(asyncio.get_running_loop())
    monkeypatch.setenv("TXN_ENABLED", "")
    assert (await _get(ADMIN, route.RECENT_PATH)).status_code == 404


async def test_admin_recent_returns_bounded_history_with_epoch_and_provenance():
    p = pl.start(asyncio.get_running_loop())
    for i in range(7):
        await p.submit(rec(f"SYNTHETIC {i}", i), "push")
    r = await _get(ADMIN, route.RECENT_PATH + "?limit=3")
    body = r.json()
    assert r.status_code == 200 and [x["seq"] for x in body["items"]] == [5, 6, 7]
    assert body["epoch"] == p.store.epoch and body["tickers_provisional"] is True
    older = (await _get(ADMIN, route.RECENT_PATH + "?limit=3&before=5")).json()
    assert [x["seq"] for x in older["items"]] == [2, 3, 4]
    assert (await _get(ADMIN, route.RECENT_PATH + "?limit=9999")).status_code == 422


# ── the stream ───────────────────────────────────────────────────────────────

async def test_hello_then_replay_after_cursor_then_live_with_event_ids():
    p = pl.start(asyncio.get_running_loop())
    for i in range(4):
        await p.submit(rec(f"SYNTHETIC {i}", i), "push")
    req, resp = await open_stream(after=2, epoch=p.store.epoch)
    assert resp.media_type == "text/event-stream"
    frames, it = await take(resp, 3)
    (_, hello, h), (id3, e3, d3), (id4, _, _) = frames
    assert hello == "hello" and h["reset"] is False and h["cursor"] == 2
    assert (e3, d3["seq"], id3, id4) == ("headline", 3, f"{p.store.epoch}:3", f"{p.store.epoch}:4")
    await p.submit(rec("SYNTHETIC live", 9), "push")
    (live,), _ = await take(type("R", (), {"body_iterator": it})(), 1)
    assert live[2]["seq"] == 5 and live[2]["content"] == "SYNTHETIC live"
    req.gone = True
    await it.aclose()


async def test_last_event_id_header_wins_over_the_query():
    p = pl.start(asyncio.get_running_loop())
    for i in range(5):
        await p.submit(rec(f"SYNTHETIC {i}", i), "push")
    _, resp = await open_stream(headers={"last-event-id": f"{p.store.epoch}:3"}, after=0,
                                epoch=p.store.epoch)
    frames, it = await take(resp, 3)
    assert [f[2]["seq"] for f in frames[1:]] == [4, 5]
    await it.aclose()


async def test_a_foreign_epoch_is_reset_not_misread_as_caught_up():
    p = pl.start(asyncio.get_running_loop())
    for i in range(3):
        await p.submit(rec(f"SYNTHETIC {i}", i), "push")
    _, resp = await open_stream(after=1, epoch="deadbeefdeadbeef")
    (hello,), it = await take(resp, 1)
    assert hello[2]["reset"] is True and hello[2]["cursor"] == 3       # client reloads /recent
    await it.aclose()


async def test_a_cursor_older_than_retained_history_is_flagged_truncated(monkeypatch):
    monkeypatch.setenv("TXN_HISTORY_MAX_ITEMS", "2")
    p = pl.start(asyncio.get_running_loop())
    for i in range(5):
        await p.submit(rec(f"SYNTHETIC {i}", i), "push")
    await p.prune()
    _, resp = await open_stream(after=1, epoch=p.store.epoch)
    frames, it = await take(resp, 3)
    assert frames[0][2]["truncated"] is True and [f[2]["seq"] for f in frames[1:]] == [4, 5]
    await it.aclose()


async def test_many_admins_and_widgets_receive_one_identical_ordered_stream():
    p = pl.start(asyncio.get_running_loop())
    opened = [await open_stream(admin={**ADMIN, "id": f"a{i % 3}"}, after=0, epoch=p.store.epoch)
              for i in range(9)]
    tasks = [asyncio.create_task(take(resp, 21)) for _, resp in opened]
    await asyncio.sleep(0.05)
    await asyncio.gather(*(p.submit(rec(f"SYNTHETIC {i}", i), "push") for i in range(20)))
    results = await asyncio.gather(*tasks)
    seqs = [[f[2]["seq"] for f in frames[1:]] for frames, _ in results]
    assert all(s == list(range(1, 21)) for s in seqs)
    assert sum(route._streams.values()) == 9
    for _, it in results:
        await it.aclose()
    assert route._streams == {}                                  # cleanup on close


async def test_per_user_and_global_caps_answer_503(monkeypatch):
    pl.start(asyncio.get_running_loop())
    monkeypatch.setattr(route, "MAX_STREAMS_PER_USER", 1)
    _, first = await open_stream()
    _, second = await open_stream()
    assert second.status_code == 503 and json.loads(second.body)["reason"] == "at_capacity"
    await first.body_iterator.aclose()


async def test_heartbeats_flow_while_quiet_and_a_disconnect_ends_the_stream():
    pl.start(asyncio.get_running_loop())
    req, resp = await open_stream()
    frames, it = await take(resp, 3, skip_heartbeats=False)
    assert [f[1] for f in frames] == ["hello", "heartbeat", "heartbeat"]
    req.gone = True
    with pytest.raises(StopAsyncIteration):
        for _ in range(5):
            await asyncio.wait_for(it.__anext__(), 1)
    assert route._streams == {}


async def test_repeat_events_reach_the_stream_without_an_id():
    p = pl.start(asyncio.get_running_loop())
    _, resp = await open_stream()
    task = asyncio.create_task(take(resp, 3))
    await asyncio.sleep(0.02)
    await p.submit(rec("SYNTHETIC twin", 0), "push")
    await p.submit(rec("SYNTHETIC twin", 0), "push")
    frames, it = await task
    assert [f[1] for f in frames] == ["hello", "headline", "repeat"]
    assert frames[2][0] is None and frames[2][2]["repeat_count"] == 1
    await it.aclose()


async def test_stream_and_recent_503_before_the_pipeline_starts():
    _, resp = await open_stream()
    assert resp.status_code == 503
    assert (await _get(ADMIN, route.RECENT_PATH)).status_code == 503


async def test_pipeline_does_not_start_without_storage_permission(monkeypatch):
    monkeypatch.delenv("TXN_STORAGE_PERMISSION_CONFIRMED", raising=False)
    await route.start_background()
    assert pl.get() is None
    monkeypatch.setenv("TXN_STORAGE_PERMISSION_CONFIRMED", "1")
    await route.start_background()
    assert pl.get() is not None
    rc.stop()
    await asyncio.sleep(0)


def test_the_stream_path_is_gzip_exempt():
    from api.main import _is_gzip_exempt
    assert _is_gzip_exempt(route.STREAM_PATH)
    assert config.FLAG == "TXN_ENABLED"
