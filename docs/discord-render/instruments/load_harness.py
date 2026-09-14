"""Step 3.1 — the ack path under load. S1: p99 <= 1,000 ms, ZERO acks over 3,000 ms.

⚠️ BUILT NOW, RUN LATER, OUTSIDE RTH. Lane A schedules it. `--self-check` is the only thing that
should be run today, and it takes under a second.

    python -u docs/discord-render/instruments/load_harness.py --self-check
    python -u docs/discord-render/instruments/load_harness.py --rate 8 --seconds 120 --handler-ms 1500

What it measures: `api.services.discord_render.commands.handle(interaction, received)` — the whole
V2 acknowledgement decision, exactly what a Discord interaction pays for before the defer is
returned. The render itself is deliberately NOT in this number: S1 is the acknowledgement SLO, and
what failed the members in C-02 was the ack missing 3 s, not the chart being slow.

⛔ THE MAXIMUM IS REPORTED, NOT ONLY THE PERCENTILES. One member who waited four seconds has been
failed completely — Discord closed their interaction and the reply can never land (that is the 23
`10015 Unknown Webhook` finals in `01-failure-forensics.md` §C). A p95 hides that member behind
nineteen who were fine, which is precisely the shape of report that let this run for a fortnight.
`over_3s` is therefore a verdict on its own: any value above zero is a FAIL whatever the
percentiles say.

⛔ EXIT CODES ARE THREE, NOT TWO. 0 pass · 1 a measured failure · 2 could-not-measure. Collapsing 1
and 2 is the defect this rule exists to prevent: a harness that produced no samples and a harness
that measured a breach must never look the same to whoever reads the exit code.

⛔ AND A RUN WITH NO TOTALS LINE IS NOT A RUN. The totals line is printed on every path, including
the failure paths, before the exit code is chosen.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import statistics
import sys
import tempfile
import time

PASS, FAIL, INCONCLUSIVE = 0, 1, 2

#: S1 (03 §1). Both are asserted; the ceiling is not a percentile.
P99_TARGET_MS = 1000.0
HARD_CEILING_MS = 3000.0

#: Anything that would otherwise resolve into the shared data root. `C:\data` and `/data` are real
#: on the dev box, so an instrument that "just runs" writes into the owner's live files.
SANDBOXED_ENV = ("DISCORD_RENDER_DB_PATH", "DISCORD_RENDER_CACHE_DIR")
SHARED_ROOTS = ("/data", "c:\\data", "c:/data")


# ── setup ───────────────────────────────────────────────────────────────────

def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def sandbox(tmp: pathlib.Path) -> dict:
    """Pin every path this instrument can write to inside `tmp`, and REFUSE to run if one still
    lands in the shared root. A sandbox that is only believed is not a sandbox."""
    tmp.mkdir(parents=True, exist_ok=True)
    pinned = {}
    for name in SANDBOXED_ENV:
        value = str(tmp / name.lower())
        os.environ[name] = value
        pinned[name] = value
    for name, value in pinned.items():
        low = str(pathlib.Path(value).resolve()).lower().replace("\\", "/")
        if any(low.startswith(root.replace("\\", "/")) for root in SHARED_ROOTS):
            raise SystemExit(f"refusing to run: {name} resolves into the shared data root ({value})")
    return pinned


def enable_v2() -> None:
    os.environ["DISCORD_RENDER_V2_ENABLED"] = "1"
    os.environ.setdefault("DISCORD_CHART_APP_ID", "harness-app")
    os.environ.pop("DISCORD_CHART_CHANNEL_ID", None)     # no channel gate in a bench
    os.environ.pop("DISCORD_CHART_GUILDS", None)


def interaction(n: int, *, members: int, ticker: str = "NVDA") -> dict:
    """A `/chart <ticker>` application-command interaction, as Discord sends it.

    ⚠️ The member id ROTATES. `discord_interactions.user_rate_check` is 12/60 per member, so a
    single-member load run stops measuring the ack path after twelve interactions and starts
    measuring the rate limiter — a harness that produces a beautiful flat p99 by refusing the load
    it was asked to apply."""
    return {"id": f"{9_000_000_000_000_000_000 + n}", "type": 2, "application_id": "harness-app",
            "token": f"harness-token-{n}", "guild_id": "1", "channel_id": "2",
            "member": {"user": {"id": f"member-{n % max(1, members)}"}},
            "data": {"name": "chart", "options": [{"name": "ticker", "value": ticker}]}}


# ── the run ─────────────────────────────────────────────────────────────────

async def drive(rate: float, seconds: float, *, members: int, handler_ms: float,
                symbols_mode: str, tickers: list[str]) -> dict:
    """Fire interactions at `rate`/s for `seconds`, awaiting each ack, and record every latency."""
    from api.services.discord_render import commands, symbols

    if symbols_mode == "stub":
        # Mechanics-only mode: the symbol check is real I/O against the bars core and dominates a
        # local run. Recorded in the totals line so a stubbed number can never be read as the product.
        commands.symbols.resolve = lambda sym, **kw: symbols.Resolution(  # type: ignore[attr-defined]
            ok=True, symbol=sym.upper(), unknown=[], suggestions=())

    handlers = commands.HANDLERS
    if handler_ms > 0:
        def _busy(ctx):
            time.sleep(handler_ms / 1000.0)
            return "ok"
        for key in list(handlers):
            handlers[key] = _busy

    rt = commands.get_runtime()
    samples: list[float] = []
    kinds: dict[str, int] = {}
    started = time.perf_counter()
    interval = 1.0 / rate if rate > 0 else 0.0
    n = 0
    try:
        while time.perf_counter() - started < seconds:
            target = started + n * interval
            now = time.perf_counter()
            if target > now:
                await asyncio.sleep(target - now)
            received = time.perf_counter()
            reply = await commands.handle(interaction(n, members=members,
                                                      ticker=tickers[n % len(tickers)]), received)
            samples.append((time.perf_counter() - received) * 1000.0)
            kinds[_kind_of(reply)] = kinds.get(_kind_of(reply), 0) + 1
            n += 1
    finally:
        try:
            commands.stop()
        except Exception:  # noqa: BLE001 — teardown must never rewrite the verdict
            pass
    return {"samples": samples, "kinds": kinds, "queue": rt.depth() if rt else {},
            "elapsed_s": time.perf_counter() - started}


def _kind_of(reply) -> str:
    if reply is None:
        return "fell_through_to_v1"
    t = reply.get("type")
    if t == 5:
        return "deferred"
    if t == 4:
        return "immediate"
    if t == 6:
        return "update"
    return f"type_{t}"


def summarise(samples: list[float]) -> dict:
    if not samples:
        return {"n": 0}
    ordered = sorted(samples)

    def pct(p: float) -> float:
        idx = min(len(ordered) - 1, max(0, int(round(p / 100.0 * (len(ordered) - 1)))))
        return ordered[idx]

    return {"n": len(ordered), "p50": pct(50), "p95": pct(95), "p99": pct(99),
            "max": ordered[-1], "mean": statistics.fmean(ordered),
            "over_1s": sum(1 for s in ordered if s > P99_TARGET_MS),
            "over_3s": sum(1 for s in ordered if s > HARD_CEILING_MS)}


def verdict(stats: dict, kinds: dict, *, min_samples: int) -> tuple[int, list[str]]:
    """(exit code, reasons). ⛔ INCONCLUSIVE is decided FIRST and separately: an empty result is a
    failed invocation until proven otherwise, and must never be rendered as a clean pass."""
    if stats.get("n", 0) < min_samples:
        return INCONCLUSIVE, [f"only {stats.get('n', 0)} samples (need {min_samples}) — nothing was measured"]
    answered = sum(v for k, v in kinds.items() if k != "fell_through_to_v1")
    if answered == 0:
        return INCONCLUSIVE, ["every interaction fell through to the pre-V2 path — V2 never ran, "
                              "so this run says nothing about the V2 ack budget"]
    reasons = []
    if stats["over_3s"]:
        reasons.append(f"{stats['over_3s']} ack(s) over {HARD_CEILING_MS:.0f} ms — Discord closed "
                       "those interactions and the reply can never land (S1 hard ceiling)")
    if stats["max"] > HARD_CEILING_MS:
        reasons.append(f"max ack {stats['max']:.0f} ms")
    if stats["p99"] > P99_TARGET_MS:
        reasons.append(f"p99 {stats['p99']:.0f} ms over the {P99_TARGET_MS:.0f} ms target")
    return (FAIL if reasons else PASS), reasons


def totals_line(stats: dict, kinds: dict, meta: dict, code: int, reasons: list[str]) -> str:
    label = {PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE"}[code]
    if not stats.get("n"):
        body = "samples=0"
    else:
        body = (f"samples={stats['n']} p50={stats['p50']:.0f}ms p95={stats['p95']:.0f}ms "
                f"p99={stats['p99']:.0f}ms max={stats['max']:.0f}ms "
                f"over_1s={stats['over_1s']} over_3s={stats['over_3s']}")
    return (f"TOTALS load_harness {label} {body} "
            f"rate={meta.get('rate')}/s seconds={meta.get('seconds')} members={meta.get('members')} "
            f"handler_ms={meta.get('handler_ms')} symbols={meta.get('symbols')} "
            f"replies={json.dumps(kinds, sort_keys=True)}"
            + (f" reasons={' | '.join(reasons)}" if reasons else ""))


# ── self-check ──────────────────────────────────────────────────────────────

def self_check() -> int:
    """⛔ PROVE IT CAN FAIL, AND PROVE 1 AND 2 ARE DIFFERENT ANSWERS.

    Three cases, because three things can be wrong with this harness: it could never report a
    breach (a gate that cannot fail), it could report a breach that is not there, or it could
    report "clean" over an empty sample set."""
    cases = []

    slow = {"n": 50, "p50": 40.0, "p95": 900.0, "p99": 4200.0, "max": 4200.0,
            "mean": 100.0, "over_1s": 3, "over_3s": 1}
    code, reasons = verdict(slow, {"deferred": 50}, min_samples=10)
    cases.append(("a 4.2 s ack is a measured FAIL", code == FAIL and any("3000" in r for r in reasons)))

    clean = {"n": 50, "p50": 18.0, "p95": 120.0, "p99": 320.0, "max": 480.0,
             "mean": 30.0, "over_1s": 0, "over_3s": 0}
    code, _ = verdict(clean, {"deferred": 50}, min_samples=10)
    cases.append(("a healthy run is a PASS", code == PASS))

    code, reasons = verdict({"n": 0}, {}, min_samples=10)
    cases.append(("no samples is INCONCLUSIVE, never a pass",
                  code == INCONCLUSIVE and code != FAIL and "nothing was measured" in reasons[0]))

    code, reasons = verdict(clean, {"fell_through_to_v1": 50}, min_samples=10)
    cases.append(("perfect numbers from a path that never ran V2 is INCONCLUSIVE", code == INCONCLUSIVE))

    # …and the summariser itself: percentiles over a known set, and the maximum surviving them.
    stats = summarise([10.0] * 99 + [5000.0])
    cases.append(("one four-second member is not hidden by 99 fast ones",
                  stats["max"] == 5000.0 and stats["over_3s"] == 1 and stats["p50"] == 10.0))

    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    failed = [n for n, ok in cases if not ok]
    print(f"TOTALS load_harness --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={len(failed)}"
          + (f" reasons={'; '.join(failed)}" if failed else ""))
    return PASS if not failed else FAIL


# ── entry ───────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rate", type=float, default=4.0, help="interactions per second")
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--members", type=int, default=40, help="distinct member ids to rotate through")
    ap.add_argument("--handler-ms", type=float, default=0.0,
                    help="simulated worker cost per job, to put the queue under real pressure")
    ap.add_argument("--symbols", choices=("real", "stub"), default="real",
                    help="'stub' skips the symbol check: mechanics only, and the totals line says so")
    ap.add_argument("--tickers", default="NVDA,AMD,SPY,AAPL,TSLA")
    ap.add_argument("--min-samples", type=int, default=20)
    ap.add_argument("--out", default="", help="write the full sample set as JSON")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()

    sys.path.insert(0, str(_repo_root()))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-load-"))
    meta = {"rate": args.rate, "seconds": args.seconds, "members": args.members,
            "handler_ms": args.handler_ms, "symbols": args.symbols, "sandbox": str(tmp)}
    stats: dict = {"n": 0}
    kinds: dict = {}
    try:
        sandbox(tmp)
        enable_v2()
        out = asyncio.run(drive(args.rate, args.seconds, members=args.members,
                                handler_ms=args.handler_ms, symbols_mode=args.symbols,
                                tickers=[t.strip().upper() for t in args.tickers.split(",") if t.strip()]))
        stats, kinds = summarise(out["samples"]), out["kinds"]
        meta["elapsed_s"] = round(out["elapsed_s"], 2)
        meta["queue_at_end"] = out["queue"]
        if args.out:
            pathlib.Path(args.out).write_text(json.dumps(
                {"meta": meta, "stats": stats, "kinds": kinds, "samples_ms": out["samples"]},
                indent=2), encoding="utf-8")
        code, reasons = verdict(stats, kinds, min_samples=args.min_samples)
    except Exception as e:  # noqa: BLE001
        code, reasons = INCONCLUSIVE, [f"the run did not complete: {type(e).__name__}: {e}"]
    print(totals_line(stats, kinds, meta, code, reasons))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
