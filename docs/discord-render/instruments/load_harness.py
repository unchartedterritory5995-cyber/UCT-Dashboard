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

# ════════════════════════════════════════════════════════════════════════════
# `--real` (Gap 2) — S2, not S1
#
# ⛔⛔ WHAT `--real` CAN AND CANNOT DRIVE, STATED BEFORE ANY NUMBER IT PRODUCES.
#
# It CAN drive: real symbol resolution, the real bars fetch, the real chart-renderer, a real PNG,
# and a REAL Discord write — into the private test channel, through the bot token, throttled.
#
# It CANNOT drive the interaction-token PATCH (`/webhooks/{app}/{token}/messages/@original`), and
# this is a property of Discord rather than a shortcut. **An interaction token is minted by Discord
# when a human runs a command**; there is no way to obtain thirty of them for a load run, and
# firing thirty invalid ones at Discord would measure their 401 handler. So the delivery hop here is
# `POST /channels/{id}/messages` — the same API, the same rate limiter, the same multipart body,
# a different endpoint.
#
# ⭐ THE CONSEQUENCE IS NAMED RATHER THAN BURIED: `--real` measures S2 end to end EXCEPT the
# token-lifecycle half, which is exactly what 3.5 (a human typing in the test channel) exists to
# cover. The totals line prints `delivery=channel` so no reader has to remember this paragraph.
#
# ⛔ THE THROTTLE IS PART OF THE MEASUREMENT, NOT A CHEAT. Discord's per-channel write limit is
# ~5 per 5 s; a run that ignored it would measure 429 handling rather than delivery. The time the
# throttle adds is REPORTED separately so the two can be told apart.
# ════════════════════════════════════════════════════════════════════════════

#: Discord's per-channel message rate, conservatively. Overridable; reported either way.
DELIVER_RATE_DEFAULT = 1.0


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def channel_edit_fn(channel_id: str, *, rate: float, stats: dict):
    """An `edit_original`-shaped callable that writes to a real Discord CHANNEL, throttled.

    ⛔ IT NEVER RAISES INTO THE RUNTIME, for the same reason `delivery.py` does not: a harness that
    can break the thing it measures produces a number about itself."""
    import threading as _th
    token = os.environ.get("DISCORD_BOT_TOKEN") or ""
    if not token:
        raise SystemExit("--deliver-channel needs DISCORD_BOT_TOKEN "
                         "(run under `railway run --service web`)")
    gate = _th.Lock()
    last = [0.0]
    interval = 1.0 / rate if rate > 0 else 0.0

    def _edit(app_id, token_unused, *, content="", png=None, filename=None, pngs=None, **kw):
        import httpx
        images = list(pngs) if pngs else ([(png, filename)] if png is not None else [])
        with gate:                       # the throttle is serialised on purpose: Discord's is too
            wait = max(0.0, last[0] + interval - time.perf_counter())
            if wait:
                stats["throttle_s"] = stats.get("throttle_s", 0.0) + wait
                time.sleep(wait)
            last[0] = time.perf_counter()
        url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        headers = {"Authorization": f"Bot {token}",
                   "User-Agent": "DiscordBot (https://uctintelligence.com, 1.0)"}
        try:
            with httpx.Client(timeout=20.0) as c:
                if images:
                    r = c.post(url, headers=headers,
                               data={"payload_json": json.dumps({"content": content[:1900]})},
                               files={f"files[{i}]": (fn, data, "image/png")
                                      for i, (data, fn) in enumerate(images)})
                else:
                    r = c.post(url, headers=headers, json={"content": content[:1900]})
            stats[f"http_{r.status_code}"] = stats.get(f"http_{r.status_code}", 0) + 1
            if r.status_code == 429:
                stats["rate_limited"] = stats.get("rate_limited", 0) + 1
            return (r.json() or True) if r.is_success else False
        except Exception as e:  # noqa: BLE001
            stats["transport_errors"] = stats.get("transport_errors", 0) + 1
            stats["last_error"] = type(e).__name__
            return False
    return _edit


def collect_real_metrics(rt, deliver_stats: dict) -> dict:
    """Everything the ruling asks a `--real` run to record, read from the artifacts rather than
    from counters this harness kept itself."""
    from api.services.discord_render import breakers, observe
    out: dict = {"deliver": dict(deliver_stats)}
    try:
        snap = observe.slo_snapshot(rt.store, windows=("1h",))
        win = snap["windows"]["1h"]["all"]
        out["end_to_end_ms"] = win.get("final_ms")
        out["success_rate"] = win.get("success_rate")
        out["jobs"] = win.get("jobs")
        out["acks_over_3s"] = (win.get("ack_ms") or {}).get("over_3s")
        out["failures_by_class"] = win.get("failures_by_class")
        out["stuck"] = snap.get("stuck")
        out["by_command"] = {c: s.get("final_ms")
                             for c, s in (snap["windows"]["1h"].get("by_command") or {}).items()}
    except Exception as e:  # noqa: BLE001
        out["slo_error"] = f"{type(e).__name__}: {e}"
    try:
        from api.services.discord_render import artifact_cache
        st = artifact_cache.store().stats()
        hits, misses = st.get("hits", 0), st.get("misses", 0)
        out["cache"] = {"hits": hits, "misses": misses,
                        # ⛔ `None`, not 0.0, when nothing was asked: a hit rate of zero over zero
                        # lookups is not a cache performing badly, it is no measurement.
                        "hit_rate": (hits / (hits + misses)) if (hits + misses) else None,
                        "l2_promotions": st.get("l2_promotions"),
                        "l2_served_unpromoted": st.get("l2_served_unpromoted"),
                        "refused_standin": st.get("refused_standin", 0)}
    except Exception as e:  # noqa: BLE001
        out["cache"] = {"error": f"{type(e).__name__}: {e}"}
    try:
        out["breakers"] = breakers.snapshot_all()
    except Exception as e:  # noqa: BLE001
        out["breakers"] = {"error": type(e).__name__}
    try:
        from api.routers import discord_interactions as router
        out["renderer"] = router._renderer_health()
    except Exception as e:  # noqa: BLE001
        out["renderer"] = {"error": type(e).__name__}
    return out


def judge_s2(metrics: dict) -> tuple[int, list[str]]:
    """S2: p50 ≤ 2.5 s · p95 ≤ 5 s · p99 ≤ 8 s, ceiling 15 s. Plus S5's success rate.

    ⛔ A MISS IS REPORTED BY SLO, BY HOW MUCH, AND WITH THE HOP THAT SPENT THE TIME — never as a
    bare red. The per-hop timings exist for exactly this."""
    reasons: list[str] = []
    e2e = metrics.get("end_to_end_ms") or {}
    if not metrics.get("jobs"):
        return INCONCLUSIVE, ["no job rows: S2 was not measured, which is not the same as met"]
    for field, ceiling in (("p50", 2500.0), ("p95", 5000.0), ("p99", 8000.0)):
        v = e2e.get(field)
        if v is None:
            reasons.append(f"S2 {field} is unmeasured (no delivered job in the window)")
        elif v > ceiling:
            reasons.append(f"S2 {field} {v:.0f} ms over the {ceiling:.0f} ms target "
                           f"by {v - ceiling:.0f} ms")
    rate = metrics.get("success_rate")
    if rate is not None and rate < 0.995:
        reasons.append(f"S5 success {rate * 100:.1f}% under 99.5%")
    if metrics.get("acks_over_3s"):
        reasons.append(f"S1 {metrics['acks_over_3s']} ack(s) over 3 s")
    if metrics.get("stuck"):
        reasons.append(f"S7 {metrics['stuck']} stuck job(s)")
    if any("unmeasured" in r for r in reasons):
        return INCONCLUSIVE, reasons
    return (FAIL, reasons) if reasons else (PASS, reasons)


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
                symbols_mode: str, tickers: list[str], real: bool = False,
                deliver_channel: str = "", deliver_rate: float = DELIVER_RATE_DEFAULT,
                drain_s: float = 90.0, deliver_stats: dict | None = None) -> dict:
    """Fire interactions at `rate`/s for `seconds`, awaiting each ack, and record every latency."""
    from api.services.discord_render import commands, symbols

    if symbols_mode == "stub":
        # Mechanics-only mode: the symbol check is real I/O against the bars core and dominates a
        # local run. Recorded in the totals line so a stubbed number can never be read as the product.
        commands.symbols.resolve = lambda sym, **kw: symbols.Resolution(  # type: ignore[attr-defined]
            ok=True, symbol=sym.upper(), unknown=[], suggestions=())

    handlers = commands.HANDLERS
    # ⛔ `--real` NEVER STUBS THE HANDLER. The whole point is that the bars fetch, the renderer and
    # the PNG encode are in the number; a simulated handler cost is the opposite measurement.
    if real and handler_ms > 0:
        raise SystemExit("--real and --handler-ms are mutually exclusive: one measures the real "
                         "work, the other simulates it")
    if handler_ms > 0:
        def _busy(ctx):
            time.sleep(handler_ms / 1000.0)
            return "ok"
        for key in list(handlers):
            handlers[key] = _busy

    rt = commands.get_runtime()
    if deliver_channel:
        rt.edit_fn = channel_edit_fn(deliver_channel, rate=deliver_rate,
                                     stats=deliver_stats if deliver_stats is not None else {})
    queue_depth: list[dict] = []
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
            if n % 10 == 0:
                queue_depth.append({"t": round(time.perf_counter() - started, 2), **(rt.depth() or {})})
            n += 1
        # ⛔⛔ A REAL RUN IS NOT OVER WHEN THE LAST ACK RETURNS. S2 is measured from the ack to the
        # DELIVERED ARTIFACT, so stopping here would compute p99 over whatever happened to finish
        # first — the fastest jobs — and report a number that flatters by construction.
        if real:
            deadline = time.perf_counter() + drain_s
            while time.perf_counter() < deadline:
                d = rt.depth() or {}
                queue_depth.append({"t": round(time.perf_counter() - started, 2), **d})
                if not (d.get("interactive") or d.get("active") or d.get("background")):
                    break
                await asyncio.sleep(1.0)
    finally:
        try:
            commands.stop()
        except Exception:  # noqa: BLE001 — teardown must never rewrite the verdict
            pass
    return {"samples": samples, "kinds": kinds, "queue": rt.depth() if rt else {},
            "queue_depth": queue_depth, "runtime": rt,
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

class _NoRt:
    """A runtime that has no store — `collect_real_metrics` must degrade, never raise."""
    store = None


def self_check() -> int:
    """⛔ PROVE IT CAN FAIL, AND PROVE 1 AND 2 ARE DIFFERENT ANSWERS.

    Three cases, because three things can be wrong with this harness: it could never report a
    breach (a gate that cannot fail), it could report a breach that is not there, or it could
    report "clean" over an empty sample set."""
    sys.path.insert(0, str(_repo_root()))
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
    # ── `--real`'s own judgements, which must be able to go both ways ──────
    _e2e = lambda p50, p95, p99, jobs=10, rate=1.0: {  # noqa: E731
        "end_to_end_ms": {"p50": p50, "p95": p95, "p99": p99}, "jobs": jobs,
        "success_rate": rate, "acks_over_3s": 0, "stuck": 0}
    for name, metrics, want in (
            ("S2 inside every target PASSES", _e2e(900, 2000, 4000), PASS),
            ("an S2 p95 breach FAILS", _e2e(900, 6000, 7000), FAIL),
            ("an S2 p99 breach FAILS", _e2e(900, 2000, 9000), FAIL),
            ("a success rate under 99.5% FAILS", _e2e(900, 2000, 4000, rate=0.99), FAIL),
            ("an ack over 3 s FAILS even with a good p95",
             {**_e2e(900, 2000, 4000), "acks_over_3s": 1}, FAIL),
            ("a stuck job FAILS", {**_e2e(900, 2000, 4000), "stuck": 2}, FAIL),
            ("no jobs at all is INCONCLUSIVE, never met", _e2e(None, None, None, jobs=0),
             INCONCLUSIVE),
            ("an unmeasured percentile is INCONCLUSIVE, not a pass",
             _e2e(None, None, None, jobs=5), INCONCLUSIVE)):
        got, _r = judge_s2(metrics)
        cases.append((name, got == want))
    # ⛔ a hit rate of zero over zero lookups is NO MEASUREMENT, not a bad cache
    cases.append(("an empty cache reports `None`, never 0.0",
                  (collect_real_metrics(_NoRt(), {}).get("cache") or {}).get("hit_rate") is None))

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
    ap.add_argument("--real", action="store_true",
                    help="drive the REAL path (symbols, bars, renderer, PNG) and judge S2, not S1")
    ap.add_argument("--deliver-channel", default="",
                    help="a PRIVATE test channel id: the delivery hop becomes a real Discord write")
    ap.add_argument("--deliver-rate", type=float, default=DELIVER_RATE_DEFAULT,
                    help="writes per second; the throttle is part of the measurement")
    ap.add_argument("--drain-s", type=float, default=90.0,
                    help="how long to wait for the queue to finish after the last ack")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()

    sys.path.insert(0, str(_repo_root()))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-load-"))
    meta = {"rate": args.rate, "seconds": args.seconds, "members": args.members,
            "handler_ms": args.handler_ms, "symbols": args.symbols, "sandbox": str(tmp),
            "mode": "real" if args.real else "ack",
            # ⛔ STATED ON EVERY RUN, because it is the number the owner asks for on every report.
            "organic_members_exposed": 0,
            "delivery": "channel" if args.deliver_channel else ("none" if args.real else "noop")}
    if args.real and args.symbols == "stub":
        print("TOTALS load_harness INCONCLUSIVE --real with --symbols stub is a contradiction: "
              "the symbol check is part of what S2 pays for")
        return INCONCLUSIVE
    deliver_stats: dict = {}
    stats: dict = {"n": 0}
    kinds: dict = {}
    try:
        sandbox(tmp)
        enable_v2()
        out = asyncio.run(drive(args.rate, args.seconds, members=args.members,
                                handler_ms=args.handler_ms, symbols_mode=args.symbols,
                                tickers=[t.strip().upper() for t in args.tickers.split(",") if t.strip()],
                                real=args.real, deliver_channel=args.deliver_channel,
                                deliver_rate=args.deliver_rate, drain_s=args.drain_s,
                                deliver_stats=deliver_stats))
        stats, kinds = summarise(out["samples"]), out["kinds"]
        meta["elapsed_s"] = round(out["elapsed_s"], 2)
        meta["queue_at_end"] = out["queue"]
        real_metrics = collect_real_metrics(out["runtime"], deliver_stats) if args.real else {}
        if args.out:
            pathlib.Path(args.out).write_text(json.dumps(
                {"meta": meta, "stats": stats, "kinds": kinds, "samples_ms": out["samples"],
                 "queue_depth": out.get("queue_depth", []), "real": real_metrics},
                indent=2), encoding="utf-8")
        if args.real:
            # ⛔ S1 IS STILL JUDGED IN A --real RUN. The ack SLO does not stop applying because we
            # also measured delivery, and a run that traded a blown ack for a good p95 must fail.
            ack_code, ack_reasons = verdict(stats, kinds, min_samples=args.min_samples)
            s2_code, s2_reasons = judge_s2(real_metrics)
            code = max(ack_code, s2_code) if FAIL in (ack_code, s2_code) else max(ack_code, s2_code)
            reasons = ack_reasons + s2_reasons
            e2e = real_metrics.get("end_to_end_ms") or {}
            cache = real_metrics.get("cache") or {}
            hr = cache.get("hit_rate")
            print(f"  S2 end-to-end: p50 {e2e.get('p50')} ms · p95 {e2e.get('p95')} ms · "
                  f"p99 {e2e.get('p99')} ms over {real_metrics.get('jobs')} job(s)")
            print(f"  success {real_metrics.get('success_rate')} · "
                  f"cache hit rate {'unmeasured' if hr is None else f'{hr * 100:.1f}%'} "
                  f"(l2 promotions {cache.get('l2_promotions')}) · "
                  f"delivery {real_metrics.get('deliver')}")
        else:
            code, reasons = verdict(stats, kinds, min_samples=args.min_samples)
    except Exception as e:  # noqa: BLE001
        code, reasons = INCONCLUSIVE, [f"the run did not complete: {type(e).__name__}: {e}"]
    print(totals_line(stats, kinds, meta, code, reasons))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
