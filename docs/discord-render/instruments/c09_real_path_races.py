"""C-09 (4.3) — the races, driven through the REAL production functions.

⛔⛔ WHY THIS FILE EXISTS BESIDE `c09_gate_races.py`, AND WHY THAT ONE IS NO LONGER C-09
EVIDENCE. The D-05 races built their contenders by hand: two threads calling
`gate.acquire(cls=MEMBER)` and `gate.acquire(cls=BACKGROUND)` directly. They prove the GATE
orders classes correctly — a real and useful unit test, kept and relabelled as exactly
that — and they are structurally incapable of noticing that `produce_chart` never passed a
class, or that the warm cycle was labelled MEMBER. **Every one of them stayed green while
`RenderGate` was imported by no production file at all.**

⭐ THE CONTENDERS HERE ARE THE PRODUCT:
  - the MEMBER is `discord_interactions.produce_chart(..., cls=MEMBER)` — the function every
    `/chart`, `/charts` and V2 job actually calls;
  - the BACKGROUND is `discord_interactions.warm_hot_charts(...)` — the warm cycle's REAL
    entry point, which chooses its own class internally. Nothing here tells it to be
    BACKGROUND; if the call site inside it were relabelled, this race would flip, and
    that is the mutation that proves the path is real.

⛔ THE WINNER IS OBSERVED AT THE SLOT, NOT AT THE FINISH. `produce_chart` calls `bars_fn`
as the first thing it does AFTER acquiring, so the first contender into its own `bars_fn`
is the one that got the slot. Timing the returns would measure render duration instead.
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

ROUNDS = 50


class ClasslessValve:
    """The OLD behaviour: a bounded valve that ACCEPTS a class and ignores it.

    ⛔ The control cannot be a bare `threading.BoundedSemaphore` any more — `produce_chart`
    now passes `cls=` unconditionally, so a plain semaphore raises `TypeError` and the
    'control' would fail for a reason that has nothing to do with priority. This is what
    the code did before C-09: the argument exists and changes nothing."""

    def __init__(self, size: int):
        self._sem = threading.BoundedSemaphore(size)
        self._size = size

    @property
    def size(self) -> int:
        return self._size

    _initial_value = property(lambda self: self._size)

    def acquire(self, blocking: bool = True, timeout=None, *, cls=None, **_kw) -> bool:
        if timeout is not None and blocking:
            return self._sem.acquire(timeout=timeout)
        return self._sem.acquire(blocking=blocking)

    def release(self) -> None:
        self._sem.release()


def _png() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"0" * 32


def race(valve_factory, *, rounds: int = ROUNDS, seed: int = 7) -> dict:
    """One free slot. The warm cycle is already queued; a member arrives after."""
    from api.services import discord_interactions as di
    from api.services import discord_chart_hotset as hotset
    from api.services import discord_chart_cache as png_cache
    from api.services import discord_chart_prefs as prefs_mod
    from api.services.render_gate import MEMBER

    rng = random.Random(seed)
    original = di.RENDER_SLOTS
    wins = {"member": 0, "background": 0, "nobody": 0}
    try:
        for _ in range(rounds):
            valve = valve_factory(1)
            di.RENDER_SLOTS = valve
            hotset.clear_for_tests()
            # ⛔⛔ CLEARING THE PNG CACHE IS LOAD-BEARING, AND LEAVING IT OUT COST A FALSE
            # RESULT THE CONTROL CAUGHT. The warm cycle renders through
            # `png_cache.single_flight`; the member calls `produce_chart` directly. So
            # round 1 populates the cache under the shared key, and from round 2 the warm
            # cycle's single_flight returns the CACHED chart and never reaches the valve at
            # all — it stops being a contender. The first run measured member 49 /
            # background 1 against a CLASS-BLIND valve: a 49-of-50 "win" over an opponent
            # that had gone home. ⭐ The gate scored 50/50 in the same run, and without the
            # control that would have shipped as C-09 evidence.
            png_cache.clear()

            req = di.ChartRequest("NVDA", "D")
            prefs = dict(prefs_mod.DEFAULTS)
            options = prefs_mod.render_options(prefs, "D")
            key = f"NVDA:D:{prefs_mod.style_signature(prefs)}"
            hotset.seed(key, req, prefs, 3600)

            first: list = []
            lock = threading.Lock()

            def _bars_for(name):
                def _bars(_t, _tf, _n):
                    with lock:
                        if not first:
                            first.append(name)
                    time.sleep(0.004)
                    return [{"t": "2026-09-15", "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}]
                return _bars

            valve.acquire(cls=MEMBER)          # the single slot is taken

            def _warm():
                # ⛔ THE REAL WARM ENTRY. It picks its own class; nothing here supplies one.
                try:
                    di.warm_hot_charts(bars_fn=_bars_for("background"),
                                       render_fn=lambda *a, **k: _png(), limit=1)
                except Exception:                                   # noqa: BLE001
                    pass

            def _member():
                try:
                    di.produce_chart(req, options, prefs, bars_fn=_bars_for("member"),
                                     render_fn=lambda *a, **k: _png(),
                                     slot_wait=2.0, cls=MEMBER)
                except Exception:                                   # noqa: BLE001
                    pass

            wt = threading.Thread(target=_warm, daemon=True)
            mt = threading.Thread(target=_member, daemon=True)
            wt.start()
            time.sleep(rng.uniform(0.020, 0.040))    # the warm cycle is ALREADY waiting
            mt.start()
            time.sleep(rng.uniform(0.010, 0.020))
            valve.release()                          # one slot frees
            mt.join(timeout=5.0)
            wt.join(timeout=5.0)
            wins[first[0] if first else "nobody"] += 1
    finally:
        di.RENDER_SLOTS = original
        hotset.clear_for_tests()
    return {"rounds": rounds, "wins": wins}


def self_check(out=print) -> int:
    from selfcheck import Cases
    from api.services.render_gate import RenderGate
    cases = Cases("c09_real_path_races")

    control = race(ClasslessValve)
    out(f"  classless valve (the OLD behaviour): {control}")
    # ⛔ NON-VACUITY. If the warm cycle did NOT win a substantial share here, the harness is
    # not creating contention and the gate's wins below would mean nothing.
    cases.add("CONTROL: with a class-blind valve the warm cycle takes a large share",
              control["wins"]["background"] >= control["rounds"] * 0.4)

    gated = race(RenderGate)
    out(f"  RenderGate (wired): {gated}")
    cases.add(f"the member wins EVERY one of {gated['rounds']} real-path races",
              gated["wins"]["member"] == gated["rounds"])
    cases.add("...and every round resolved (nobody = 0)", gated["wins"]["nobody"] == 0)

    # ⛔ The contenders must really be the production functions, asserted from source so a
    # future refactor that quietly re-hand-builds them fails here.
    import inspect
    src = inspect.getsource(race)
    cases.add("the BACKGROUND contender calls warm_hot_charts, the real warm entry",
              "di.warm_hot_charts(" in src)
    cases.add("the MEMBER contender calls produce_chart, the real render function",
              "di.produce_chart(" in src)
    cases.add("neither contender calls acquire() directly (that is the unit test's job)",
              ".acquire(cls=" not in src.split("valve.acquire(cls=MEMBER)")[-1])
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
