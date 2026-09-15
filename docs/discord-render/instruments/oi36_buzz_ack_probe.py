"""OI-36 — `/buzz` answered "The application did not respond". Why the ack could miss 3 s.

⚰️ THE OBSERVATION (smoke 3.5, row 8, 2026-09-14 19:10 ET). The board **rendered correctly** —
`chart-renderer render path=/r/buzz status=200 ms=10738 bytes=346078` — and the member saw
`The application did not respond.` Discord's initial-ack deadline is **3 s**.

⛔ THE SMOKE INDEX WAS RIGHT TO REFUSE A MECHANISM FROM n=1, and this probe does not supply one
either. What it supplies is a **structural defect that exists independently of that observation**:

    V1's `/buzz` does real work BEFORE it defers.
    V2's `/buzz` defers BEFORE it does any work.

`api/routers/discord_interactions.py` — the pre-V2 path — runs
`await run_in_threadpool(build_board_text…)` and only then returns `{"type": 5}`. That await is
bounded by the **shared anyio thread limiter** (64 tokens, `api/main.py:2847`), which every one of
the **ten** `background.add_task(...)` render jobs on this router also draws from, because they are
plain `def` functions and Starlette runs sync background tasks in that pool. So the ack is bounded
by pool availability, not by its own ~8.5 ms of SQLite.

`api/services/discord_render/commands.py:409-414` — the V2 path — calls `_enqueue`, which offers the
job and returns the defer with no work in between. C-02's V2 half measured that at **p50 0.0023 ms
with every render slot starved and the queue loaded**.

⭐ THIS REFINES THE SMOKE INDEX RATHER THAN CONTRADICTING IT. It recorded `shadow outcome=agree` and
concluded "V2 would have done the same thing" — true **of the board**, which is what the shadow
compares. It says nothing about ack ORDERING, and the ordering is where the 3 s went missing.

⚠️ STILL NOT ESTABLISHED, and deliberately not claimed: that pool exhaustion is what cost THAT ack.
n = 1, and 64 tokens is a lot of headroom. What is established is that the ordering defect is real,
reachable, and of the C-02 family.
"""
from __future__ import annotations

import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for p in (str(HERE), str(ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


def source_order() -> dict:
    """Where the defer sits relative to the work, in BOTH paths. Read from source, not guessed."""
    import inspect
    from api.routers import discord_interactions as router
    from api.services.discord_render import commands

    # ⛔ SLICE FROM THE MARKER, ALWAYS — never from a function picked by name. My first version did
    # `getsource(router.interactions) if hasattr(...)`, which found A function containing
    # `run_in_threadpool` but NOT the buzz branch, so `v1_defer_at` came back -1 and the case failed
    # for a reason that had nothing to do with the product. The marker is the thing under test.
    mod = inspect.getsource(router)
    start = mod.index("if itype == 2 and name == di.BUZZ_COMMAND")
    end = mod.find("\n    if itype ==", start + 10)
    v1 = mod[start:end if end > start else start + 4000]
    work = v1.find("run_in_threadpool")
    defer = v1.find('return {"type": 5, "data": {"flags": di.EPHEMERAL}}')
    v2 = inspect.getsource(commands.handle)
    b = v2.index("di.BUZZ_COMMAND")
    v2_tail = v2[b:b + 500]
    return {"v1_work_at": work, "v1_defer_at": defer,
            "v1_defers_after_work": 0 <= work < defer,
            "v2_enqueues": "_enqueue(" in v2_tail,
            "v2_prework": "run_in_threadpool" in v2_tail}


def threadpool_pressure(occupied: int, *, total: int = 8) -> float:
    """ms for one `run_in_threadpool` call while `occupied` of `total` tokens are held.

    ⛔ A SMALL POOL ON PURPOSE. Production runs 64 tokens; reproducing exhaustion at 64 would need 64
    blocked threads and prove nothing extra. What is under test is the SHAPE — an ack that awaits a
    pooled slot is bounded by the pool — and the shape does not depend on the constant."""
    import anyio
    from starlette.concurrency import run_in_threadpool

    async def _go():
        limiter = anyio.to_thread.current_default_thread_limiter()
        limiter.total_tokens = total
        release = anyio.Event()

        async def _hog():
            await run_in_threadpool(lambda: _block(release_flag))

        release_flag = {"go": False}

        def _block(flag):
            while not flag["go"]:
                time.sleep(0.005)

        async with anyio.create_task_group() as tg:
            for _ in range(occupied):
                tg.start_soon(_hog)
            await anyio.sleep(0.15)              # let the hogs actually take their tokens
            t0 = time.perf_counter()
            with anyio.move_on_after(2.0):
                await run_in_threadpool(lambda: None)
            took = (time.perf_counter() - t0) * 1000.0
            release_flag["go"] = True
            release.set()
        return took
    return anyio.run(_go)


def self_check(out=print) -> int:
    from selfcheck import Cases
    cases = Cases("oi36_buzz_ack_probe")

    o = source_order()
    out(f"  source order: {o}")
    # ⛔ THE DEFECT, READ OFF THE SOURCE.
    cases.add("V1 /buzz does work BEFORE it defers", o["v1_defers_after_work"] is True)
    cases.add("V2 /buzz defers via _enqueue with no pre-work",
              o["v2_enqueues"] is True and o["v2_prework"] is False)

    # ⛔ THE POOL IS SHARED — the ack's await and the render jobs draw on one limiter.
    import inspect
    from api.routers import discord_interactions as router
    src = inspect.getsource(router)
    cases.add("this router dispatches sync render jobs as background tasks (same pool)",
              src.count("background.add_task") >= 10)
    from api.services.discord_interactions import run_chart_job
    cases.add("...and those jobs are plain `def`, so Starlette runs them in the threadpool",
              not inspect.iscoroutinefunction(run_chart_job))

    # ── the measurement: an awaited pooled call IS bounded by the pool ────
    free = threadpool_pressure(occupied=0, total=8)
    starved = threadpool_pressure(occupied=8, total=8)
    out(f"  run_in_threadpool: pool free {free:.2f} ms · pool exhausted {starved:.2f} ms")
    cases.add("with the pool free the call is immediate (non-vacuity)", free < 50.0)
    # ⛔ THE SHAPE: an ack that awaits a pooled slot waits for the pool, not for its own work.
    cases.add("with the pool exhausted the SAME call blocks for orders of magnitude longer",
              starved > free * 20 and starved > 200.0)
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
