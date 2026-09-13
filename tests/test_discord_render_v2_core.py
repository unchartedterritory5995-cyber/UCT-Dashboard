"""V2 runtime core: ids, the failure contract, the durable jobs store, the runtime.

The guarantee under test (docs/discord-render/03-architecture.md, SLOs S3 + S7): every
job ends in an artifact or a user-visible message, and in a terminal row — whatever the
handler does. Each failure class from 01-failure-forensics.md that this layer closes has
a test named for it.
"""
from __future__ import annotations

import re
import threading
import time

import pytest

from api.services.discord_render import contract, ids
from api.services.discord_render.delivery import DeliveryResult
from api.services.discord_render.jobs_store import JobsStore
from api.services.discord_render.runtime import BACKGROUND, Job, JobRuntime


# ── fixtures ────────────────────────────────────────────────────────────────

class Clock:
    def __init__(self):
        self.t = time.time()

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s


class FakeDelivery:
    def __init__(self, ok=True):
        self.ok = ok
        self.calls = []

    def edit_text(self, app_id, token, *, content, components=None, client=None):
        self.calls.append(("edit_text", token, content, components))
        return DeliveryResult(self.ok, 200 if self.ok else 500)

    def followup(self, app_id, token, *, content, components=None, ephemeral=True, client=None):
        self.calls.append(("followup", token, content, components))
        return DeliveryResult(self.ok, 200 if self.ok else 500)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def store(tmp_path, clock):
    s = JobsStore(str(tmp_path / "jobs.db"), now=clock)
    yield s
    s.close()


def _job(cid="aaaaaaaa", **kw):
    base = dict(corr_id=cid, command="chart", app_id="APP", token="TOK-" + cid, args={"ticker": "NVDA"},
                label="/chart NVDA", user_id="u1", interaction_id="i-" + cid)
    base.update(kw)
    return Job(**base)


def _runtime(store, handlers, *, delivery=None, edit_ok=True, failure=None, **kw):
    edits = []

    def edit_fn(app_id, token, **k):
        edits.append(k)
        return {"id": "m"} if edit_ok else False

    rt = JobRuntime(store=store, handlers=handlers, edit_fn=edit_fn, delivery=delivery or FakeDelivery(),
                    last_edit_failure=(lambda: failure), owner="pod-A", **kw)
    rt.edits = edits
    return rt


# ── ids ─────────────────────────────────────────────────────────────────────

def test_corr_id_is_deterministic_per_interaction_and_short():
    a = ids.corr_id("1415926535897932384")
    assert a == ids.corr_id("1415926535897932384") and len(a) == 8 and ids.is_corr_id(a)
    assert a != ids.corr_id("1415926535897932385")


def test_corr_id_without_an_interaction_id_is_random_not_empty():
    x, y = ids.corr_id(None), ids.corr_id("")
    assert ids.is_corr_id(x) and ids.is_corr_id(y) and x != y


# ── contract ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("cls", sorted(contract.FAILURE_CLASSES))
def test_every_failure_message_has_the_owner_format_and_leaks_nothing(cls):
    text = contract.failure_content("/chart NVDA", cls, "7f3a9c21")
    assert re.fullmatch(r"/chart NVDA failed — .+ · id 7f3a9c21 · retry\?", text), text
    for forbidden in ("Traceback", "Exception", "Error:", "http", "token", "\n"):
        assert forbidden not in text, (cls, forbidden)


def test_an_unknown_class_reads_as_internal_rather_than_crashing():
    assert contract.failure_content("/flow X", "nope", "00000000") == \
        contract.failure_content("/flow X", "internal", "00000000")


def test_retry_button_round_trips_and_carries_no_emoji():
    comps = contract.failure_components("7f3a9c21")
    button = comps[0]["components"][0]
    assert "emoji" not in button                       # an invalid emoji rejects the whole tree
    assert len(button["custom_id"]) <= 100
    assert contract.parse_retry(button["custom_id"]) == "7f3a9c21"
    for junk in ("rt|nothex!!", "rt|7f3a9c2", "c2|NVDA|D", "", None, "rt|7f3a9c21|x"):
        assert contract.parse_retry(junk) is None


def test_command_labels_name_what_failed():
    assert contract.command_label("chart", {"tickers": ["NVDA", "AMD"]}) == "/chart NVDA AMD"
    assert contract.command_label("flow", {"ticker": "DPRO", "days": "30"}) == "/flow DPRO · 30 days"
    assert contract.command_label("flow", {"ticker": "DPRO", "days": "1"}) == "/flow DPRO · today"
    assert contract.command_label("controls", {}) == "Chart update"


# ── store ───────────────────────────────────────────────────────────────────

def test_insert_is_idempotent_and_never_overwrites(store):
    j = _job()
    assert store.insert(j.row()) is True
    assert store.insert({**j.row(), "token": "OTHER"}) is False
    assert store.get(j.corr_id)["token"] == j.token


def test_claim_is_a_compare_and_set_on_a_live_lease(store, clock):
    j = _job()
    store.insert(j.row())
    assert store.claim(j.corr_id, "pod-A", 20) is True
    assert store.claim(j.corr_id, "pod-B", 20) is False          # A's lease is live
    clock.advance(21)
    assert store.claim(j.corr_id, "pod-B", 20) is True           # lapsed: B may take it
    assert store.owns(j.corr_id, "pod-B") and not store.owns(j.corr_id, "pod-A")


def test_finish_nulls_the_token_and_only_the_lease_holder_may_finish(store):
    j = _job()
    store.insert(j.row())
    store.claim(j.corr_id, "pod-A", 20)
    assert store.finish(j.corr_id, "delivered", owner="pod-B") is False
    assert store.finish(j.corr_id, "delivered", owner="pod-A", final_ms=1234.0) is True
    row = store.get(j.corr_id)
    assert row["token"] is None and row["state"] == "delivered" and row["final_ms"] == 1234.0
    assert store.finish(j.corr_id, "messaged") is False          # terminal stays terminal


def test_release_all_makes_a_running_job_resumable_immediately(store):
    j = _job()
    store.insert(j.row())
    store.claim(j.corr_id, "pod-A", 20)
    assert store.resumable(600) == []                             # live lease: not yet
    assert store.release_all("pod-A") == 1
    assert [r["corr_id"] for r in store.resumable(600)] == [j.corr_id]


def test_resumable_excludes_terminal_old_and_tokenless_rows(store, clock):
    fresh, old, done = _job("11111111"), _job("22222222"), _job("33333333")
    store.insert(old.row())
    clock.advance(1000)
    store.insert({**fresh.row(), "created_at": clock()})
    store.insert({**done.row(), "created_at": clock()})
    store.claim(done.corr_id, "x", 1)
    store.finish(done.corr_id, "delivered")
    got = {r["corr_id"] for r in store.resumable(810)}
    assert got == {fresh.corr_id}
    assert {r["corr_id"] for r in store.expired_unfinished(810)} == {old.corr_id}


def test_purge_nulls_tokens_at_16_minutes_and_deletes_rows_at_30_days(store, clock):
    j = _job()
    store.insert({**j.row(), "created_at": clock()})
    clock.advance(16 * 60 + 1)
    assert store.purge()["tokens_nulled"] == 1 and store.get(j.corr_id)["token"] is None
    clock.advance(30 * 24 * 3600)
    assert store.purge()["rows_deleted"] == 1 and store.get(j.corr_id) is None


def test_alert_cooldown_is_durable_across_store_instances(tmp_path, clock):
    path = str(tmp_path / "a.db")
    assert JobsStore(path, now=clock).alert_due("k", 1800) is True
    assert JobsStore(path, now=clock).alert_due("k", 1800) is False   # a new pod still remembers
    clock.advance(1801)
    assert JobsStore(path, now=clock).alert_due("k", 1800) is True


# ── runtime: the terminal-state guarantee ───────────────────────────────────

def test_a_delivered_image_is_recorded_with_its_timing(store):
    def handler(ctx):
        ctx.edit("APP", ctx.job.token, content="NVDA · Daily", png=b"PNG", filename="x.png")
        return "ok"
    rt = _runtime(store, {"chart": handler})
    out = rt.run_job(_job(created_at=time.time()))
    assert out["state"] == "delivered" and out["quality"] == "image" and out["first_image_ms"] >= 0
    assert store.get("aaaaaaaa")["token"] is None


def test_C11_a_handler_that_raises_still_tells_the_member(store):
    d = FakeDelivery()
    rt = _runtime(store, {"chart": lambda ctx: 1 / 0}, delivery=d)
    out = rt.run_job(_job())
    assert out["state"] == "messaged" and out["failure_class"] == "internal"
    assert d.calls and d.calls[0][0] == "edit_text" and "id aaaaaaaa" in d.calls[0][2]


def test_C11_a_handler_that_returns_without_replying_is_not_silent(store):
    d = FakeDelivery()
    rt = _runtime(store, {"chart": lambda ctx: "ok"}, delivery=d)
    assert rt.run_job(_job())["state"] == "messaged"
    assert len(d.calls) == 1


def test_C02_a_dead_token_is_recorded_as_ack_late_and_not_retried_into_the_void(store):
    d = FakeDelivery()

    def handler(ctx):
        ctx.edit("APP", ctx.job.token, content="x", png=b"PNG", filename="x.png")
    rt = _runtime(store, {"chart": handler}, delivery=d, edit_ok=False,
                  failure=DeliveryResult(False, 404, 10015, "Unknown Webhook"))
    out = rt.run_job(_job())
    assert out["state"] == "abandoned" and out["failure_class"] == "ack_late"
    assert d.calls == []                                   # a 10015 token cannot carry a message either
    assert out["discord_status"] == "404:10015"


def test_a_control_click_failure_goes_to_a_private_followup_not_over_the_chart(store):
    d = FakeDelivery()
    rt = _runtime(store, {"controls": lambda ctx: ctx.fail("renderer_unavailable")}, delivery=d)
    out = rt.run_job(_job(command="controls", interaction_type=3, label="Chart update"))
    assert out["state"] == "messaged"
    assert [c[0] for c in d.calls] == ["followup"]


def test_S3_the_deadline_message_is_sent_once_and_the_job_keeps_running(store):
    d = FakeDelivery()
    rt = _runtime(store, {}, delivery=d)
    job = _job(created_at=time.time() - 16)
    store.insert(job.row())
    store.claim(job.corr_id, "pod-A", 20)
    from api.services.discord_render.runtime import JobContext
    ctx = JobContext(rt, job)
    rt._active[job.corr_id] = ctx
    assert rt.tick(time.time())["deadlines"] == 1
    assert rt.tick(time.time())["deadlines"] == 0          # never twice
    assert ctx.messaged and "took too long" in d.calls[0][2]
    # …and the late image still lands and the row says delivered
    ctx.edit("APP", job.token, content="NVDA · Daily", png=b"PNG", filename="x.png")
    rt._active.pop(job.corr_id)
    assert rt._finalize(job, ctx, "ok", 0.0)["state"] == "delivered"


def test_background_jobs_never_message_a_member_on_deadline(store):
    d = FakeDelivery()
    rt = _runtime(store, {}, delivery=d)
    from api.services.discord_render.runtime import JobContext
    ctx = JobContext(rt, _job(lane=BACKGROUND, created_at=time.time() - 60))
    assert rt.check_deadline(ctx, time.time()) is False and d.calls == []


def test_the_heartbeat_follows_elapsed_time_not_a_modulo_of_the_clock(store):
    rt = _runtime(store, {}, heartbeat_s=5.0)
    job = _job()
    store.insert(job.row())
    store.claim(job.corr_id, "pod-A", 20)
    from api.services.discord_render.runtime import JobContext
    rt._active[job.corr_id] = JobContext(rt, job)
    # ⛔ Every beat point is chosen so int(t) % 5 != 0. The first draft used t0 = 1_000_000.3,
    # whose beat points landed ON multiples of 5 — so the modulo bug this rail names would
    # have passed it. A fixture that cannot distinguish the bug from the fix is not a rail;
    # the mutation harness is what proves this one can fail.
    t0 = 1_000_001.3
    assert int(t0) % 5 and int(t0 + 5.1) % 5 and int(t0 + 10.4) % 5
    assert rt.tick(t0)["beats"] == 1
    assert rt.tick(t0 + 2.2)["beats"] == 0
    assert rt.tick(t0 + 5.1)["beats"] == 1                 # a modulo cadence skips this beat
    assert rt.tick(t0 + 10.4)["beats"] == 1


def test_C01_a_superseded_worker_does_not_post_over_the_pod_that_reclaimed_it(store, clock):
    rt = _runtime(store, {})
    job = _job()
    store.insert(job.row())
    store.claim(job.corr_id, "pod-A", 20)
    clock.advance(21)
    assert store.claim(job.corr_id, "pod-B", 20)
    from api.services.discord_render.runtime import JobContext
    ctx = JobContext(rt, job)
    assert ctx.edit("APP", job.token, content="late", png=b"PNG", filename="x.png") is False
    assert rt.edits == []


def test_offer_refuses_when_full_and_when_a_member_has_too_many_in_flight(store):
    rt = _runtime(store, {"chart": lambda ctx: None}, queue_max=2, per_user_max=2)
    assert rt.offer(_job("00000001", user_id="u1"))[0] == "queued"
    assert rt.offer(_job("00000002", user_id="u1"))[0] == "queued"
    assert rt.offer(_job("00000003", user_id="u1"))[0] == "user_busy"
    assert rt.offer(_job("00000004", user_id="u2"))[0] == "full"


def test_C01_resume_reruns_a_young_job_a_dead_pod_left_behind(store, clock):
    delivered = []

    def handler(ctx):
        ctx.edit("APP", ctx.job.token, content="NVDA · Daily", png=b"PNG", filename="x.png")
        delivered.append(ctx.job.corr_id)
    job = _job(created_at=clock())
    store.insert(job.row())
    store.claim(job.corr_id, "dead-pod", 20)               # died mid-render
    clock.advance(25)                                       # its lease lapsed
    rt = _runtime(store, {"chart": handler})
    assert rt.resume_pending() == {"resumed": 1, "abandoned": 0}
    resumed = rt._inter.get_nowait()
    assert resumed.resumed and resumed.token == job.token
    assert rt.run_job(resumed)["state"] == "delivered" and delivered == [job.corr_id]
    assert store.get(job.corr_id)["resumed"] == 1


def test_C01_resume_leaves_a_job_alone_while_its_owner_still_holds_the_lease(store, clock):
    job = _job(created_at=clock())
    store.insert(job.row())
    store.claim(job.corr_id, "old-pod-still-draining", 20)
    rt = _runtime(store, {"chart": lambda ctx: None})
    assert rt.resume_pending() == {"resumed": 0, "abandoned": 0}


def test_C01_a_job_too_old_to_resume_is_closed_out_and_told_when_its_token_still_works(store, clock):
    d = FakeDelivery()
    job = _job(created_at=time.time() - 14 * 60)            # past the resume window, inside the token life
    store.insert({**job.row(), "created_at": job.created_at})
    clock.t = time.time()
    rt = _runtime(store, {}, delivery=d)
    assert rt.resume_pending()["abandoned"] == 1
    row = store.get(job.corr_id)
    assert row["state"] == "messaged" and row["failure_class"] == "restarted" and row["token"] is None
    assert "restarted" in d.calls[0][2]


def test_threaded_runtime_drains_every_job_to_a_terminal_row_and_releases_on_stop(store):
    seen = []
    lock = threading.Lock()

    def handler(ctx):
        time.sleep(0.02)
        ctx.edit("APP", ctx.job.token, content="x", png=b"PNG", filename="x.png")
        with lock:
            seen.append(ctx.job.corr_id)
    rt = _runtime(store, {"chart": handler}, workers=3, queue_max=20).start()
    try:
        cids = [f"{i:08x}" for i in range(8)]
        for i, cid in enumerate(cids):
            assert rt.offer(_job(cid, user_id=f"u{i}"))[0] == "queued"
        deadline = time.time() + 10
        while time.time() < deadline and len(seen) < len(cids):
            time.sleep(0.02)
        time.sleep(0.1)
        assert sorted(seen) == sorted(cids)
        assert all(store.get(c)["state"] == "delivered" for c in cids)
    finally:
        rt.stop()
