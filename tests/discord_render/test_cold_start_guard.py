"""R63(c) AMENDED — `api.services.discord_render.cold_start_guard`.

⛔ THE LOAD-BEARING TEST IN THIS FILE IS `test_get_async_does_not_block_the_event_loop`.
Everything else proves the registry is correct; that one proves the property the whole
redesign exists for — that awaiting a not-yet-warm resource costs the REQUESTS that need
it and nothing else. A mechanism that is correct but blocks the loop while waiting is the
outage shape wearing an `await` keyword.
"""
import asyncio
import threading
import time

import pytest

from api.services.discord_render import cold_start_guard as g


@pytest.fixture(autouse=True)
def _clean():
    g._reset_for_tests()
    yield
    g._reset_for_tests()


# ─────────────────────────────────────────────────────────── the registry, plainly

def test_register_then_preload_then_get_async_returns_the_value():
    g.register("x", lambda: 42)
    g.start_boot_preload()
    assert asyncio.run(g.get_async("x")) == 42


def test_start_boot_preload_PROACTIVELY_invokes_the_loader_with_no_reader_asking():
    """⚰⚰ THE TEST ABOVE DOES NOT PROVE THIS, AND A MUTATION CAUGHT IT. `get_async`/`get_sync`
    self-heal by submitting an unstarted loader themselves — a deliberate, correct property
    (preload is a head start, not a precondition for correctness). That same property means a
    test which only checks "a reader eventually gets the right value" is satisfied identically
    whether `start_boot_preload` did anything at all or was a complete no-op — mutating it to
    `return 0` left every other test green.

    This test removes the reader from the picture entirely: nobody ever calls get_async or
    get_sync. If `start_boot_preload` is not proactively invoking the loader, the event below
    is never set and this test times out red."""
    fired = threading.Event()

    def loader():
        fired.set()
        return "v"

    g.register("x", loader)
    g.start_boot_preload()
    assert fired.wait(timeout=2.0), (
        "start_boot_preload did not invoke the loader — only a subsequent reader's self-heal "
        "would ever warm this resource, which defeats the whole point of preloading")


def test_get_sync_blocks_only_the_calling_thread_and_returns_the_value():
    g.register("x", lambda: "warm")
    g.start_boot_preload()
    assert g.get_sync("x") == "warm"


def test_an_unregistered_name_raises_KeyError_not_a_silent_None():
    with pytest.raises(KeyError):
        asyncio.run(g.get_async("never-declared"))
    with pytest.raises(KeyError):
        g.get_sync("never-declared")


def test_registering_the_same_name_twice_with_the_SAME_loader_is_a_noop():
    def loader():
        return 1
    g.register("x", loader)
    g.register("x", loader)          # must not raise
    g.start_boot_preload()
    assert g.get_sync("x") == 1


def test_registering_the_same_name_with_a_DIFFERENT_loader_raises():
    """⛔ Two authorities over one resource. Silently picking one (first-wins or last-wins)
    would let a second module quietly shadow the first module's data with no error anywhere —
    the exact defect class this repo's memory calls out repeatedly."""
    g.register("x", lambda: 1)
    with pytest.raises(ValueError):
        g.register("x", lambda: 2)


def test_a_resource_asked_for_before_preload_ever_ran_self_heals():
    """⛔ NON-VACUITY for the self-heal path. Preload is a head start, not a precondition for
    correctness — a resource must still resolve even if start_boot_preload was never called at
    all (a worker process shape that never boots the render package's warm path, a test, a
    race at very early boot)."""
    g.register("x", lambda: "healed")
    assert g.get_sync("x") == "healed"        # start_boot_preload() never called


def test_a_raising_loader_re_raises_to_every_reader_and_does_not_corrupt_other_resources():
    def boom():
        raise RuntimeError("provider down")
    g.register("bad", boom)
    g.register("good", lambda: "fine")
    g.start_boot_preload()
    with pytest.raises(RuntimeError):
        g.get_sync("bad")
    with pytest.raises(RuntimeError):
        asyncio.run(g.get_async("bad"))
    assert g.get_sync("good") == "fine", "one loader raising took the whole preload down with it"


def test_a_loader_runs_EXACTLY_ONCE_even_under_concurrent_readers():
    calls = {"n": 0}
    ready = threading.Event()

    def loader():
        calls["n"] += 1
        ready.wait(2.0)
        return "v"

    g.register("x", loader)
    fut1 = g._ensure_submitted("x")            # the boot-thread path
    fut2 = g._ensure_submitted("x")             # a racing reader before boot preload "started"
    ready.set()
    assert fut1 is fut2, "two callers before preload produced two loads of one resource"
    assert fut1.result(timeout=2.0) == "v"
    assert calls["n"] == 1


def test_registered_names_reports_what_the_guard_knows_about():
    g.register("a", lambda: 1)
    g.register("b", lambda: 2)
    assert set(g.registered_names()) == {"a", "b"}


def test_is_warm_is_false_before_preload_and_true_after():
    g.register("x", lambda: 1)
    assert g.is_warm("x") is False
    g.start_boot_preload()
    g.get_sync("x")
    assert g.is_warm("x") is True


# ───────────────────────────────────── THE PROPERTY THE REDESIGN EXISTS FOR

@pytest.mark.asyncio
async def test_get_async_does_not_block_the_event_loop():
    """⭐ THE ONE THAT MATTERS. A slow loader (0.3s, on the preload executor's own thread) must
    cost only the coroutine that awaits it — every OTHER scheduled coroutine keeps running on
    the loop while the wait is in progress. This is the entire argument against a barrier: a
    barrier makes every request pay a slow resource's cost; this design makes only the
    requests that need it pay, and nothing else stalls.

    ⛔ Proven by a ticking counter task run CONCURRENTLY with the slow get_async. If get_async
    ever blocks the loop (e.g. a `fut.result()` called directly instead of `await
    asyncio.wrap_future(fut)`), the ticker cannot advance until get_async returns — so a
    post-hoc read of the ticker's value at that moment would be 0 instead of several."""
    SLOW_SECONDS = 0.3

    def slow_loader():
        time.sleep(SLOW_SECONDS)
        return "warm"

    g.register("slow", slow_loader)
    g.start_boot_preload()

    ticks = {"n": 0}

    async def ticker():
        while True:
            await asyncio.sleep(0.02)
            ticks["n"] += 1

    ticker_task = asyncio.create_task(ticker())
    result = await g.get_async("slow")
    ticker_task.cancel()

    assert result == "warm"
    # 0.3s / 0.02s ~= 15 ticks possible; require a strong majority to be robust to scheduler
    # jitter without being satisfiable by a single lucky tick.
    assert ticks["n"] >= 8, (
        f"only {ticks['n']} loop ticks ran during a {SLOW_SECONDS}s wait — "
        "get_async blocked the event loop instead of yielding on it")


@pytest.mark.asyncio
async def test_a_resource_already_warm_returns_immediately_with_no_extra_wait():
    """⛔ NON-VACUITY for the fast path: the whole point of preloading is that MOST requests
    pay nothing. If `get_async` always awaited even on an already-done future, the fast path
    would carry a needless (if small) scheduling cost on every call, forever."""
    g.register("x", lambda: "v")
    g.start_boot_preload()
    g.get_sync("x")                      # force it warm before the timed section
    assert g.is_warm("x")

    t0 = time.monotonic()
    result = await g.get_async("x")
    elapsed = time.monotonic() - t0
    assert result == "v"
    assert elapsed < 0.05, f"an already-warm read took {elapsed*1000:.1f} ms — not the fast path"
