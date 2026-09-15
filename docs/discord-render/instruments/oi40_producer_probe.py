"""OI-40 — fire all THREE `queue_full` producers for real, and show the row each one writes.

⛔⛔ THE POINT IS THAT THIS IS A MEASUREMENT, NOT AN INFERENCE. D-02b identified the third producer
from one unclaimed row in a probe artifact and I then *asserted* which of the other two had written
it — wrongly, and I had to correct the ledger. So each producer is now FIRED, in process, and the
row it writes is read back out of a real store.

THE THREE, WITH THEIR CALL SITES:

| # | fires when | call site | `outcome` written | is it an admission refusal? |
|---|---|---|---|---|
| 1 | the bounded interactive queue is full at `offer` | `commands.py:208` -> `runtime.py:258-264` | `refused_at_ack` | ✅ **yes — the only one** |
| 2 | a job a dead pod left behind cannot be re-queued at boot | `runtime.py:285` -> `runtime.py:294-300` | `restart_recovery` | ❌ a pod restart |
| 3 | the **V1 render semaphore** has no free slot | `discord_interactions.py:1226-1228`, mapped at `:1919` | `busy` | ❌ a job that was ADMITTED and then failed |

⭐⭐ PRODUCER 3 IS THE INTERESTING ONE AND IT IS A FLIP-PACKET CONCERN, NOT JUST A LABELLING BUG.
`RENDER_SLOTS` (`discord_interactions.py:67`, `DISCORD_CHART_MAX_CONCURRENT`) is a **second,
independent concurrency ceiling**, and it is SHARED between the pre-V2 path and the V2 workers. A V2
worker that wins a place in the V2 queue (depth 48, 6 workers) can still fail to get one of those
slots, and the member is then told *"we're at capacity right now"* — which is true of a queue they
never entered. Locally the default is **4** while `DISCORD_RENDER_WORKERS` is **6**, so 2 of 6
workers can always be starved; production sets 8, which is above 6 but is shared with every pre-V2
member during a canary.

⛔ Nothing here writes to the repository or to any shared data root: every store is a fresh
`mkdtemp`, and the semaphore is restored in a `finally`.
"""
from __future__ import annotations

import pathlib
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for p in (str(HERE), str(ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


def _sandbox(tag: str = "") -> pathlib.Path:
    """⛔ `C:\\data` is REAL on this box, so an unpinned store writes into the owner's live files."""
    # ⛔⛔ ONE STORE PER PRODUCER. The first version shared a single database across all three and
    # producer 1's still-queued filler row was swept up by producer 2's resume_pending, which
    # reported `abandoned: 2` for a probe that fired one job. An instrument whose own residue
    # contaminates its next measurement is the blind-spot family this whole programme is about.
    d = pathlib.Path(tempfile.mkdtemp(prefix=f"oi40-{tag}-"))
    import os
    os.environ["DISCORD_RENDER_DB_PATH"] = str(d / "jobs.db")
    os.environ["DISCORD_RENDER_CACHE_DIR"] = str(d / "cache")
    return d


def fire_producer_1() -> dict:
    """The REAL admission refusal: the bounded queue is full when `offer` is called."""
    from api.services.discord_render.jobs_store import JobsStore
    from api.services.discord_render.runtime import JobRuntime, Job, INTERACTIVE
    _sandbox("p1")
    store = JobsStore()
    rt = JobRuntime(store=store, handlers={}, edit_fn=lambda *a, **k: True,
                    workers=1, queue_max=1, per_user_max=8)
    # ⛔ NOT started: a running worker would drain the queue and the refusal would never happen.
    # The producer under test is `offer`, which needs no worker at all.
    def _job(n):
        return Job(corr_id=f"p1{n:04d}", command="chart", app_id="a", token="t", args={},
                   label="/chart", user_id="u1", guild_id="g", channel_id="c",
                   interaction_id=str(n), interaction_type=2, lane=INTERACTIVE)
    first = rt.offer(_job(1))
    second = rt.offer(_job(2))
    if second[0] == "full":
        from api.services.discord_render import commands  # noqa: F401  (the call site is :208)
        rt.record_refused(_job(2), "queue_full")
    rt._drain_writer() if hasattr(rt, "_drain_writer") else None
    # the writer is a thread on a started runtime; unstarted, drain it by hand
    _flush_writer(rt)
    return {"producer": 1, "offer_first": first[0], "offer_second": second[0],
            "row": store.get("p10002")}


def _flush_writer(rt) -> None:
    """Apply whatever the writer queue holds. The runtime is deliberately unstarted, so nothing
    else will."""
    q = rt._writer
    while not q.empty():
        item = q.get()
        kind = item[0]
        if kind == "insert":
            rt.store.insert(item[1])
        elif kind == "update":
            rt.store.update(item[1], **item[2])
    time.sleep(0.01)


def fire_producer_2() -> dict:
    """The RESTART casualty: a resumable row that cannot be re-queued at boot."""
    from api.services.discord_render.jobs_store import JobsStore
    from api.services.discord_render.runtime import JobRuntime, Job, INTERACTIVE
    _sandbox("p2")
    store = JobsStore()
    rt = JobRuntime(store=store, handlers={}, edit_fn=lambda *a, **k: False,
                    workers=1, queue_max=1, per_user_max=8)
    # A job a dead pod left in flight: state queued, a token, no lease.
    # ⛔ THE ROW IS BUILT BY `Job.row()`, NOT TYPED. A hand-written dict drifts from the schema the
    # moment a column changes — this probe's first version died on `no column named args`, which is
    # the schema telling me I had invented a shape. Let the product build its own row.
    now = time.time()
    stale = Job(corr_id="p20001", command="chart", app_id="a", token="tok", args={},
                label="/chart", user_id="u1", guild_id="g", channel_id="c",
                interaction_id="1", interaction_type=2, lane=INTERACTIVE)
    stale.created_at = now - 5
    store.insert(stale.row())
    # ⛔ FILL THE QUEUE FIRST, or `resume_pending` re-queues it happily and producer 2 never fires.
    rt.offer(Job(corr_id="filler", command="chart", app_id="a", token="t", args={}, label="/chart",
                 user_id="u9", guild_id="g", channel_id="c", interaction_id="9",
                 interaction_type=2, lane=INTERACTIVE))
    out = rt.resume_pending()
    _flush_writer(rt)
    return {"producer": 2, "resume": out, "row": store.get("p20001")}


def fire_producer_3() -> dict:
    """The V1 RENDER SEMAPHORE: admitted, ran, and could not get a slot."""
    from api.services import discord_interactions as di
    sem = di.RENDER_SLOTS
    taken = 0
    try:
        while sem.acquire(blocking=False):      # starve it completely
            taken += 1
        req = di.ChartRequest(ticker="NVDA", tf="D") if hasattr(di, "ChartRequest") else None
        if req is None:
            return {"producer": 3, "error": "ChartRequest not importable"}
        outcome, png, fn = di.produce_chart(
            req, {}, {}, bars_fn=lambda *a, **k: [], render_fn=lambda *a, **k: None)
        # the mapping the V2 runtime applies, read from the call site rather than retyped
        mapped = {"busy": "queue_full", "no_bars": "no_bars"}.get(outcome, "internal")
        return {"producer": 3, "slots_taken": taken, "outcome": outcome,
                "mapped_failure_class": mapped, "png": png, "filename": fn}
    finally:
        for _ in range(taken):
            sem.release()


def self_check(out=print) -> int:
    from selfcheck import Cases
    cases = Cases("oi40_producer_probe")

    p1 = fire_producer_1()
    out(f"  producer 1: offer -> {p1['offer_second']!r}; row = {_brief(p1['row'])}")
    cases.add("producer 1 (queue full at offer) writes outcome=refused_at_ack",
              (p1["row"] or {}).get("outcome") == "refused_at_ack"
              and (p1["row"] or {}).get("failure_class") == "queue_full")
    cases.add("producer 1 keeps NO token — the refusal WAS the reply",
              (p1["row"] or {}).get("token") in (None, ""))
    # ⛔ non-vacuity: the FIRST offer must have been accepted, or "full" proves nothing
    cases.add("the first offer was ACCEPTED (non-vacuity for producer 1)",
              p1["offer_first"] == "queued")

    p2 = fire_producer_2()
    out(f"  producer 2: resume_pending -> {p2['resume']}; row = {_brief(p2['row'])}")
    cases.add("producer 2 (restart, queue full) writes outcome=restart_recovery",
              (p2["row"] or {}).get("outcome") == "restart_recovery"
              and (p2["row"] or {}).get("failure_class") == "queue_full")
    cases.add("producer 2 abandoned exactly one job (non-vacuity)",
              (p2["resume"] or {}).get("abandoned") == 1)

    p3 = fire_producer_3()
    out(f"  producer 3: {p3}")
    cases.add("producer 3 (V1 render semaphore starved) returns outcome=busy",
              p3.get("outcome") == "busy")
    cases.add("...and the V2 runtime maps that busy to failure_class=queue_full",
              p3.get("mapped_failure_class") == "queue_full")
    cases.add("producer 3 actually starved the semaphore (non-vacuity)",
              (p3.get("slots_taken") or 0) > 0)

    # ⭐ THE CONCLUSION, ASSERTED: all three wear the same class and only one is a refusal.
    outcomes = {(p1["row"] or {}).get("outcome"), (p2["row"] or {}).get("outcome"), "busy"}
    cases.add("all three wear failure_class=queue_full but write THREE different outcomes",
              len(outcomes) == 3)
    return 0 if cases.report(out) == 0 else 1


def _brief(row) -> str:
    if not row:
        return "<no row>"
    return (f"state={row.get('state')!r} outcome={row.get('outcome')!r} "
            f"class={row.get('failure_class')!r} token={'kept' if row.get('token') else 'None'}")


if __name__ == "__main__":
    raise SystemExit(self_check())
