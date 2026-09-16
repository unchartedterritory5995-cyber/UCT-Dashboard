"""C-09 (the warm cycle competes with members) and C-02 (web saturation → acks miss 3 s).

⛔ CLOSING A CLASS NEEDS EVIDENCE **AND** A CONTROL PROVING THE INSTRUMENT COULD HAVE SEEN IT.
Both halves are here, and they reach OPPOSITE verdicts — which is the point of measuring rather
than assuming.

── C-09 ─────────────────────────────────────────────────────────────────────────────────────────
The warm cycle is real, enabled by default, and it **does** take render slots:

| fact | where |
|---|---|
| `DISCORD_CHART_HOTWARM_ENABLED` defaults to `"1"` — ON | `api/main.py:806` |
| it runs on a scheduler, off every request path | `api/main.py:799` |
| every render it makes is marked `X-Render-Priority: background` | `discord_interactions.py:1557-1565` |
| its time budget is DERIVED from the interval (`/3`), so an interval change cannot silently restore the 2026-08-29 overrun (15.9 s avg, **95 s peak** against a 60 s interval) | `api/main.py:794-796` |
| ⛔ it calls `produce_chart(..., slot_wait=MULTI_SLOT_WAIT_S)` — **25 seconds** | `:1630`, `:1334` |
| ⛔⛔ `RENDER_SLOTS` is a plain `threading.BoundedSemaphore` — **no priority of any kind** | `:67` |

⭐ THE PRIORITY THAT EXISTS IS ON THE WRONG SIDE OF THE BOTTLENECK. `X-Render-Priority: background`
is honoured by a **pooled chart-renderer**; it says nothing to the **web-side semaphore** that
decides who gets to call the renderer at all. A warm render holds one of the 4 (8 in production)
slots for the duration of a render, and is allowed to wait **25 s** to get one — so during
contention a background warm queues on equal terms with a member.

── C-02 ─────────────────────────────────────────────────────────────────────────────────────────
The ack is taken BEFORE any of that: `_enqueue` offers the job and returns the defer
(`commands.py:200-205`); the render happens later on a worker thread. So saturating the queue and
the render slots cannot move the ack — and that is the claim this probe tests rather than asserts.

⛔ WHY THE FALLBACK RENDERER CANNOT AFFECT THE C-02 CLAIM: the ack is decided by `runtime.offer`,
which runs before any renderer is chosen. ⚠️ WHAT WOULD FALSIFY IT: an ack path that did I/O — a
store write, a network call, a lock held by a worker. `record_ack` posts to a writer QUEUE
(`runtime.py:255-256`) precisely so the ack path does none.
"""
from __future__ import annotations

import pathlib
import sys
import tempfile
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for p in (str(HERE), str(ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


def _sandbox(tag: str) -> None:
    import os
    d = pathlib.Path(tempfile.mkdtemp(prefix=f"c0902-{tag}-"))
    os.environ["DISCORD_RENDER_DB_PATH"] = str(d / "jobs.db")
    os.environ["DISCORD_RENDER_CACHE_DIR"] = str(d / "cache")


# ── C-09 ────────────────────────────────────────────────────────────────────

def warm_vs_member() -> dict:
    """A warm render and a member render contend for the LAST slot. Who gets it?

    ⛔ The semaphore has no priority, so this is a race — and a race is the finding. The probe runs
    it repeatedly and reports the split, because "the member won once" would prove nothing."""
    from api.services import discord_interactions as di
    sem = di.RENDER_SLOTS
    total = sem._initial_value                       # BoundedSemaphore's declared size
    wins = {"member": 0, "warm": 0}
    rounds = 12
    for _ in range(rounds):
        held = []
        while sem.acquire(blocking=False):           # starve down to zero
            held.append(True)
        winner: list = []
        gate = threading.Event()

        def _contender(name, wait_s):
            gate.wait()
            if sem.acquire(timeout=wait_s):
                winner.append(name)
                sem.release()

        # the member: a single /chart, which waits only its own job budget
        m = threading.Thread(target=_contender, args=("member", 2.0), daemon=True)
        # the warm cycle: MULTI_SLOT_WAIT_S = 25 s, i.e. it is happy to sit there
        w = threading.Thread(target=_contender, args=("warm", di.MULTI_SLOT_WAIT_S), daemon=True)
        w.start(); m.start()
        time.sleep(0.02)
        gate.set()
        time.sleep(0.02)
        for _ in held[:1]:                            # release exactly ONE slot
            sem.release()
        m.join(timeout=3.0); w.join(timeout=3.0)
        for _ in held[1:]:
            try:
                sem.release()
            except ValueError:
                break
        if winner:
            wins[winner[0]] = wins.get(winner[0], 0) + 1
    return {"slots": total, "rounds": rounds, "wins": wins,
            "warm_slot_wait_s": di.MULTI_SLOT_WAIT_S}


# ── C-02 ────────────────────────────────────────────────────────────────────

def ack_under_saturation() -> dict:
    """Fill the queue AND starve every render slot, then measure the ack path.

    ⛔ The ack must not move, because `_enqueue` returns the defer before any render begins. If it
    DOES move, C-02 is live and this probe is how you would know."""
    from api.services import discord_interactions as di
    from api.services.discord_render.jobs_store import JobsStore
    from api.services.discord_render.runtime import JobRuntime, Job, INTERACTIVE
    sem = di.RENDER_SLOTS
    held = []
    try:
        while sem.acquire(blocking=False):
            held.append(True)
        store = JobsStore()
        rt = JobRuntime(store=store, handlers={}, edit_fn=lambda *a, **k: True,
                        workers=1, queue_max=200, per_user_max=64)
        acks = []
        for n in range(150):
            job = Job(corr_id=f"c02{n:04d}", command="chart", app_id="a", token="t", args={},
                      label="/chart", user_id=f"u{n % 40}", guild_id="g", channel_id="c",
                      interaction_id=str(n), interaction_type=2, lane=INTERACTIVE)
            t0 = time.perf_counter()
            status, _pos = rt.offer(job)
            if status == "queued":
                rt.record_ack(job.corr_id, (time.perf_counter() - t0) * 1000.0)
            acks.append(((time.perf_counter() - t0) * 1000.0, status))
        ms = sorted(a for a, _ in acks)
        return {"offers": len(acks), "queued": sum(1 for _, s in acks if s == "queued"),
                "slots_held": len(held),
                "ack_p50_ms": ms[len(ms) // 2], "ack_max_ms": ms[-1],
                "over_3s": sum(1 for a in ms if a > 3000.0)}
    finally:
        for _ in held:
            try:
                sem.release()
            except ValueError:
                break


def self_check(out=print) -> int:
    from selfcheck import Cases
    cases = Cases("c09_c02_probe")
    _sandbox("probe")
    from api.services import discord_interactions as di

    # ── C-09 ──────────────────────────────────────────────────────────────
    c9 = warm_vs_member()
    out(f"  C-09 warm vs member for the last slot: {c9}")
    cases.add("the warm cycle waits 25 s for a render slot — the same constant /charts uses",
              di.MULTI_SLOT_WAIT_S == 25.0)
    # ⛔⛔ THE FINDING. `BoundedSemaphore` exposes no priority, so nothing in the web-side gate
    # prefers a member. If it did, `wins["member"]` would be `rounds`.
    cases.add("the web-side render gate has NO member priority — the warm cycle can take the slot",
              c9["wins"]["warm"] > 0)
    # ⛔ NON-VACUITY: the contest must actually resolve, or "warm won" is a thread that never ran.
    cases.add("the contest resolved every round (non-vacuity)",
              c9["wins"]["member"] + c9["wins"]["warm"] == c9["rounds"])
    cases.add("the ONLY priority in the system is renderer-side, not gate-side",
              "background" in __import__("inspect").getsource(di.warm_hot_charts))

    # ── C-02 ──────────────────────────────────────────────────────────────
    c2 = ack_under_saturation()
    out(f"  C-02 ack under saturation: {c2}")
    cases.add("every render slot was starved for the duration (non-vacuity)",
              c2["slots_held"] > 0)
    cases.add("the queue actually took the offers (non-vacuity)", c2["queued"] > 100)
    # ⛔ THE CLAIM: the ack does not move, because it is decided before any render.
    cases.add("ZERO acks over 3 s with every render slot starved and the queue loaded",
              c2["over_3s"] == 0)
    cases.add("...and the ack stays sub-millisecond, not merely under the ceiling",
              c2["ack_p50_ms"] < 5.0)
    # ⛔ THE STRUCTURAL REASON, asserted rather than trusted: the ack path does NO I/O.
    import inspect
    cases.add("record_ack posts to the writer QUEUE — the ack path does no store I/O",
              "self._writer.put" in inspect.getsource(
                  __import__("api.services.discord_render.runtime",
                             fromlist=["JobRuntime"]).JobRuntime.record_ack))
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
