"""What does the P2.1 adapter layer COST, per call? (2.4b P2.10, "bench three ways")

Three ways, against an upstream stubbed to a fixed cost, so the only variable is the layer:

  1. **raw**      — the function called directly, as the pre-V2 path calls it
  2. **adapters** — through `bindings.bars_fn`, the V2 default
  3. **switch 0** — `DISCORD_RENDER_V2_ADAPTERS_ENABLED=0`, which must give back the raw function

⛔ THIS IS NOT THE END-TO-END BENCH AND DOES NOT REPLACE IT. `tools/discord_render_bench.py` runs
inside the web pod against the real renderer and the real bars store; that is what `02-baseline.md`
is made of and what the flip is judged against. This isolates ONE question that the end-to-end bench
cannot answer cleanly, because its variance is dominated by the network: *how much does wrapping a
call in a pool submit, a breaker and a `Result` add?* Everything here is in-process and stubbed.

⛔ AND IT MEASURES THE MEDIAN **AND THE MAXIMUM**. A layer that is free 99 % of the time and costs
40 ms once per thousand calls has spent a member's whole queue-wait budget, and a mean hides that.

⭐ WHY "SWITCH 0" IS A CASE AND NOT AN ASSUMPTION: the kill switch is only a rollback if it really
gives back the old path. Benching it proves the claim with a number instead of a comment — if case 3
does not match case 1 within noise, the rollback is not a rollback.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

#: A fixed, tiny upstream cost, so the layer is the only thing that varies between cases.
UPSTREAM_MS = 1.0
BARS = [{"t": "2026-09-11", "o": 1, "h": 2, "l": 0, "c": 1, "v": 10}] * 200


def _upstream(*_a, **_k):
    time.sleep(UPSTREAM_MS / 1000.0)
    return list(BARS)


class _Ctx:
    """The slice of JobContext the bindings touch. `remaining_s` is generous so the budget floor
    never trips — this is measuring overhead, not the deadline logic."""

    def __init__(self):
        from api.services.discord_render.runtime import Job
        self.job = Job(corr_id="bench0001", command="chart", app_id="a", token="t",
                       args={}, label="bench")

    def remaining_s(self, now=None):
        return 14.0


def _time(fn, n: int) -> dict:
    samples = []
    for _ in range(n):
        t0 = time.perf_counter()
        out = fn()
        samples.append((time.perf_counter() - t0) * 1000.0)
        if not out:
            return {"error": "the call returned nothing — the bench measured a failure path"}
    s = sorted(samples)
    return {"n": n,
            "p50_ms": round(statistics.median(s), 3),
            "p95_ms": round(s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))], 3),
            "max_ms": round(s[-1], 3),
            "min_ms": round(s[0], 3)}


def _pin_stub():
    """Make the adapter's OWN default lookup find the stub.

    ⚰️⚰️ THE FIRST VERSION OF THIS BENCH DID NOT DO THIS, AND EVERY NUMBER IT PRINTED WAS A LIE.
    `bindings.bars_fn` calls `bars.fetch(...)` with no `fetch_fn`, and the adapter then does
    `from api.routers.discord_interactions import fetch_bars` — so the "adapters" case never touched
    the stub. It ran the REAL bars path against the owner's live 3 GB store, and the result was
    `adapters` measuring FASTER than `raw`, which is impossible for a wrapper and was the tell.

    ⛔ The lesson is not "remember to stub". It is that a bench whose cases do not provably call the
    SAME upstream is comparing two different programs, and a number from it is worse than no number
    because it looks like evidence. `run()` now refuses to start unless this pin is verified live."""
    import api.routers.discord_interactions as router
    original = router.fetch_bars
    router.fetch_bars = _upstream
    return router, original


def run(n: int = 200) -> dict:
    from api.services.discord_render.adapters import _call, bars, bindings, switch

    out: dict = {"upstream_ms": UPSTREAM_MS, "cases": {}}
    router, original = _pin_stub()
    try:
        # ⛔ THE GUARD, VERIFIED LIVE AND NOT ASSUMED: prove the adapter reaches the stub before any
        # timing is taken. A bench that silently benched the real upstream is what this refuses.
        probe = bars.fetch(bars.BarsRequest("NVDA", "D", 200, remaining_s=14.0))
        if not (probe.ok and probe.data == BARS):
            return {"error": "REFUSING TO BENCH: the adapter did not reach the stub — every case "
                             "would be measuring a different program",
                    "probe": probe.as_event()}
        out["stub_verified"] = True

        out["cases"]["raw"] = _time(lambda: _upstream("NVDA", "D", 200), n)

        os.environ.pop(switch.ENV, None)
        _call.reset_for_tests()
        ctx = _Ctx()
        fn = bindings.bars_fn(ctx)
        assert fn.__module__ == bindings.__name__, "case 2 did not get the adapter binding"
        out["cases"]["adapters"] = _time(lambda: fn("NVDA", "D", 200), n)

        os.environ[switch.ENV] = "0"
        off = bindings.bars_fn(_Ctx())
        out["switch_off_returns_raw"] = off is _upstream or off.__name__ in ("fetch_bars", "_upstream")
        out["cases"]["switch_0"] = _time(lambda: off("NVDA", "D", 200), n)
        os.environ.pop(switch.ENV, None)
    finally:
        router.fetch_bars = original

    raw, ad = out["cases"]["raw"], out["cases"]["adapters"]
    if "p50_ms" in raw and "p50_ms" in ad:
        out["overhead_p50_ms"] = round(ad["p50_ms"] - raw["p50_ms"], 3)
        out["overhead_max_ms"] = round(ad["max_ms"] - raw["max_ms"], 3)
    return out


def self_check() -> int:
    """⛔ PROVE THE BENCH CAN SEE A COST, or a small number means nothing. A deliberately slowed
    layer must show up; if it does not, the harness is measuring something else."""
    baseline = _time(lambda: _upstream(), 20)
    slowed = _time(lambda: (time.sleep(0.004), _upstream())[1], 20)
    saw_it = slowed["p50_ms"] - baseline["p50_ms"] > 2.0
    print(f"self-check: baseline p50 {baseline['p50_ms']} ms, +4 ms injected -> {slowed['p50_ms']} ms")
    print("SELF-CHECK " + ("PASS — the bench can see a 4 ms layer" if saw_it else "FAIL — a real cost was invisible"))
    return 0 if saw_it else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    print(json.dumps(run(args.n), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
