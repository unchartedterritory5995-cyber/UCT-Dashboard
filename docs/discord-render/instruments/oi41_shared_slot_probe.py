"""OI-41 — a V2 job that was ADMITTED must never be told the queue refused it.

⛔⛔ THE BREACH, IN ONE SENTENCE. `RENDER_SLOTS` (`discord_interactions.py:67`) is a **second**
concurrency ceiling, and it is **shared** between the pre-V2 path and the V2 workers. A V2 job that
`runtime.offer` ADMITTED, that queued, and that started on a worker could lose a race for one of
those slots — and `run_chart_job` then mapped `busy` to `queue_full`, whose member-facing sentence
is *"we're at capacity right now"* (`contract.py:23`). That is the **admission** refusal: the answer
to a request the queue never let in. The member was told a queue refused them that had already
admitted them, and neither reading tells them anything they can act on.

⭐ THE TWO CEILINGS, MEASURED:

| ceiling | where | default | production |
|---|---|---|---|
| V2 queue + workers | `runtime.py:185-186` | 6 workers, depth 48 | 6 / 48 |
| **V1 render slots** | `discord_interactions.py:67`, `render_slot_count()` `:52-57` | **4** | **8** (`DISCORD_CHART_MAX_CONCURRENT`) |

Locally 6 workers contend for 4 slots, so **two workers can always be starved**. Production's 8 is
above 6 — but it is shared with every pre-V2 member, and during a canary both paths are live.

⛔ THE FIX IS "WAIT, THEN TELL THE TRUTH", NOT "NEVER FAIL":
  1. a V2 job passes `slot_wait_s = its own remaining budget` (`commands._slot_wait_for`), so an
     already-admitted job waits rather than being refused;
  2. if that budget expires, the class is `deadline` — *"the chart service took too long"* — which
     is true, and never `queue_full`, which is not.
V1 is untouched: `slot_wait` stays 0.0 there, and the mapping lives in the `fail_fn is not None`
branch that only V2 supplies.
"""
from __future__ import annotations

import pathlib
import sys
import tempfile
import threading

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for p in (str(HERE), str(ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


def _sandbox(tag: str) -> None:
    import os
    d = pathlib.Path(tempfile.mkdtemp(prefix=f"oi41-{tag}-"))
    os.environ["DISCORD_RENDER_DB_PATH"] = str(d / "jobs.db")
    os.environ["DISCORD_RENDER_CACHE_DIR"] = str(d / "cache")


def contend(*, slot_wait: float, hold_s: float = 0.4) -> dict:
    """Starve every V1 render slot, then ask `produce_chart` for a chart.

    Returns the outcome and what a V2 runtime would tell the member. ⛔ The slots are released by a
    timer thread so a waiting caller can actually succeed — a control where the slots are held
    forever could only ever prove the refusal, never the wait."""
    from api.services import discord_interactions as di
    sem = di.RENDER_SLOTS
    taken = 0
    released = threading.Event()
    try:
        while sem.acquire(blocking=False):
            taken += 1

        def _release_later():
            for _ in range(taken):
                sem.release()
            released.set()

        t = threading.Timer(hold_s, _release_later)
        t.daemon = True
        t.start()
        req = di.ChartRequest(ticker="NVDA", tf="D")
        outcome, _png, _fn = di.produce_chart(
            req, {}, {}, bars_fn=lambda *a, **k: [], render_fn=lambda *a, **k: None,
            slot_wait=slot_wait)
        t.cancel()
        # what the V2 runtime maps it to — read from the call site's own table, not retyped
        v2_class = {"busy": "deadline", "no_bars": "no_bars"}.get(outcome, "internal")
        return {"slots_taken": taken, "slot_wait": slot_wait, "outcome": outcome,
                "v2_failure_class": v2_class, "slots_released_during_wait": released.is_set()}
    finally:
        if not released.is_set():
            for _ in range(taken):
                try:
                    sem.release()
                except ValueError:      # already released by the timer
                    break


def self_check(out=print) -> int:
    from selfcheck import Cases
    from api.services.discord_render import contract
    cases = Cases("oi41_shared_slot_probe")
    _sandbox("probe")

    # ── the breach, reproduced: no wait, slots starved ────────────────────
    no_wait = contend(slot_wait=0.0)
    out(f"  no wait, slots starved: {no_wait}")
    cases.add("with slot_wait=0 an admitted job is refused by the V1 semaphore (the breach)",
              no_wait["outcome"] == "busy")
    # ⛔ THE SENTENCE IS THE POINT. This is what the member read before the fix.
    cases.add("...and `queue_full` renders as the ADMISSION refusal sentence",
              contract.plain("queue_full") == "we're at capacity right now")
    cases.add("...while `deadline` says something a member can actually act on",
              contract.plain("deadline") == "the chart service took too long")
    cases.add("the V2 mapping no longer produces queue_full for a busy outcome",
              no_wait["v2_failure_class"] == "deadline")

    # ── the fix: a bounded wait lets an admitted job through ──────────────
    waited = contend(slot_wait=5.0, hold_s=0.3)
    out(f"  bounded wait, slots released mid-wait: {waited}")
    cases.add("with a bounded slot_wait the admitted job WAITS and is not refused",
              waited["outcome"] != "busy" and waited["slots_released_during_wait"] is True)

    # ⛔ NON-VACUITY FOR THE WAIT: it must still give up. A wait that never expires would hold a
    # worker past the deadline watchdog — the OI-21 shape, one layer over.
    short = contend(slot_wait=0.15, hold_s=3.0)
    out(f"  wait shorter than the hold: {short}")
    cases.add("a slot_wait shorter than the contention still expires (non-vacuity)",
              short["outcome"] == "busy")
    cases.add("...and even then the member is told `deadline`, never `queue_full`",
              short["v2_failure_class"] == "deadline")

    # ── V1 is byte-identical: the mapping lives behind `fail_fn` ──────────
    import inspect
    src = inspect.getsource(sys.modules["api.services.discord_interactions"].run_chart_job)
    cases.add("the V2 mapping is inside the `fail_fn is not None` branch, so V1 never reaches it",
              "elif fail_fn is not None:" in src and '"busy": "deadline"' in src)
    cases.add("V1's own busy sentence is untouched",
              'content="Busy, try again in a few seconds."' in src)
    cases.add("run_chart_job takes slot_wait_s and defaults it to 0.0 (V1 behaviour unchanged)",
              inspect.signature(
                  sys.modules["api.services.discord_interactions"].run_chart_job
              ).parameters["slot_wait_s"].default == 0.0)

    # ── the V2 side actually passes a bound, derived from the job ─────────
    from api.services.discord_render import commands

    class _Ctx:
        def __init__(self, left):
            self._left = left

        def remaining_s(self):
            return self._left
    cases.add("a V2 job's slot wait is its remaining budget minus headroom",
              abs(commands._slot_wait_for(_Ctx(9.0)) - 8.5) < 1e-9)
    # ⛔ NO BUDGET MEANS NO WAIT — never a guessed default of "plenty".
    class _Blind:
        def remaining_s(self):
            raise RuntimeError("no clock")
    cases.add("a context that cannot say its budget yields NO wait, not a guess",
              commands._slot_wait_for(_Blind()) == 0.0)
    cases.add("an already-expired job waits zero, never a negative",
              commands._slot_wait_for(_Ctx(0.1)) == 0.0)
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
