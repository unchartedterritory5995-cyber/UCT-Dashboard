"""C-09 — does the member-priority gate actually win the race? 50+ races, randomised.

⛔ THE NON-VACUITY IS THE OLD BEHAVIOUR. With a plain `BoundedSemaphore` the warm cycle won 10 of 12
(D-04). If the gate's races were run WITHOUT a control reproducing that, a green result would only
prove the harness never created contention. Both are run here, same shape, same rounds.

⛔ AND THE RACE IS RIGGED AGAINST THE MEMBER ON PURPOSE. In every round the background waiter is
queued FIRST and is already parked when the member arrives — which is the real situation (the warm
cycle waits 25 s, so it is essentially always there first). A gate that only wins when the member
happens to arrive first would prove nothing.
"""
from __future__ import annotations

import pathlib
import random
import sys
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for p in (str(HERE), str(ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

ROUNDS = 60


def race(gate_factory, *, rounds: int = ROUNDS, seed: int = 11) -> dict:
    """One free slot, a background waiter already parked, a member arriving after. Who wins?"""
    rng = random.Random(seed)
    wins = {"member": 0, "background": 0, "nobody": 0}
    for _ in range(rounds):
        gate = gate_factory(1)
        gate.acquire()                      # the single slot is taken
        winner: list = []
        lock = threading.Lock()

        def _take(name, cls, wait):
            if _acquire(gate, cls, wait):
                with lock:
                    winner.append(name)
                gate.release()

        bg = threading.Thread(target=_take, args=("background", 1, 25.0), daemon=True)
        me = threading.Thread(target=_take, args=("member", 0, 2.0), daemon=True)
        bg.start()
        time.sleep(rng.uniform(0.010, 0.030))   # background is ALREADY waiting
        me.start()
        time.sleep(rng.uniform(0.010, 0.020))
        gate.release()                      # one slot becomes free
        bg.join(timeout=3.0)
        me.join(timeout=3.0)
        wins[winner[0] if winner else "nobody"] += 1
    return {"rounds": rounds, "wins": wins}


def _acquire(gate, cls, wait):
    try:
        return gate.acquire(timeout=wait, cls=cls)      # the gate
    except TypeError:
        return gate.acquire(timeout=wait)               # a plain BoundedSemaphore


def starvation_probe(*, load_s: float = 1.2, starve_s: float = 0.3, lanes: int = 6) -> dict:
    """SUSTAINED member load with one background waiter. Does background EVER get served?

    ⚰️ THE FIRST VERSION WAS FLAKY, AND A FLAKY CONTROL IS WORSE THAN NO CONTROL — it teaches people
    to re-run until green. It fired 40 one-shot members totalling ~200 ms of work against a 300 ms
    starvation bound: if they all finished first, background was served NORMALLY, `starvation_grants`
    stayed 0, and the case failed while the gate behaved correctly. It asserted a MECHANISM
    (the starvation path) using a setup that did not guarantee the mechanism was needed.

    ⭐ Now the load is driven by the CLOCK, not by a count: member lanes keep re-acquiring for
    `load_s`, which is four times `starve_s`. Background cannot be served on merit inside that
    window, so a grant to it can only have come from the fairness bound."""
    from api.services.render_gate import RenderGate, MEMBER, BACKGROUND
    gate = RenderGate(1, starve_s=starve_s)
    gate.acquire(cls=MEMBER)
    got: dict = {"background": False}

    def _bg():
        if gate.acquire(timeout=load_s + 3.0, cls=BACKGROUND):
            got["background"] = True
            gate.release()

    t = threading.Thread(target=_bg, daemon=True)
    t.start()
    time.sleep(0.05)                       # background is parked before any member arrives

    stop_at = time.monotonic() + load_s

    def _member_lane():
        while time.monotonic() < stop_at:
            if gate.acquire(timeout=0.5, cls=MEMBER):
                time.sleep(0.004)
                gate.release()

    lanes_t = [threading.Thread(target=_member_lane, daemon=True) for _ in range(lanes)]
    for th in lanes_t:
        th.start()
    gate.release()
    for th in lanes_t:
        th.join(timeout=load_s + 3.0)
    t.join(timeout=load_s + 4.0)
    return {"background_served": got["background"], "load_s": load_s, **gate.stats()}


def self_check(out=print) -> int:
    from selfcheck import Cases
    from api.services.render_gate import RenderGate, MEMBER, BACKGROUND
    cases = Cases("c09_gate_races")

    # ── the control: the OLD behaviour, reproduced ────────────────────────
    old = race(lambda n: threading.BoundedSemaphore(n))
    out(f"  plain BoundedSemaphore: {old}")
    # ⛔ NON-VACUITY. If the semaphore did NOT lose races, the gate's wins below would be
    # meaningless — the harness would simply not be creating contention.
    cases.add("CONTROL: a plain semaphore lets background win a substantial share "
              "(reproduces D-04's 10 of 12)",
              old["wins"]["background"] >= old["rounds"] * 0.5)

    # ── the gate ──────────────────────────────────────────────────────────
    new = race(lambda n: RenderGate(n))
    out(f"  RenderGate: {new}")
    cases.add(f"the member wins EVERY one of {new['rounds']} races for the last slot",
              new["wins"]["member"] == new["rounds"])
    cases.add("...and the race actually resolved every round (nobody = 0)",
              new["wins"]["nobody"] == 0)

    # ── fairness: background must not starve forever ──────────────────────
    st = starvation_probe()
    out(f"  starvation probe: {st}")
    cases.add("under sustained member load, background is STILL served once the bound elapses",
              st["background_served"] is True and st["starvation_grants"] >= 1)
    cases.add("...and members were served too — the bound did not invert the priority",
              st["grants"]["member"] >= 20)

    # ── the shape every existing call site relies on ──────────────────────
    g = RenderGate(2)
    cases.add("acquire(blocking=False) still works for the /chart fast path",
              g.acquire(blocking=False) is True)
    g2ok = g.acquire(blocking=False)
    cases.add("...and returns False when the pool is empty (non-vacuity)",
              g2ok is True and g.acquire(blocking=False) is False)
    g.release(); g.release()
    try:
        g.release()
        cases.add("an over-release raises, as BoundedSemaphore does", False)
    except ValueError:
        cases.add("an over-release raises, as BoundedSemaphore does", True)

    # ⛔ PRIORITY COMES FROM THE CLASS, NOT THE HEADER — asserted from source.
    import inspect
    src = inspect.getsource(RenderGate.acquire)
    cases.add("the gate reads a class argument, never an X-Render-Priority header",
              "cls" in src and "X-Render-Priority" not in src)
    cases.add("the fairness bound is a stated NUMBER, not a hope",
              isinstance(RenderGate(1)._starve_s, float))
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
