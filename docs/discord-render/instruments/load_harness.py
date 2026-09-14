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
import contextvars
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


def counting_edit_fn(stats: dict):
    """A delivery that goes nowhere and SAYS SO. Used by `--real` when no channel is given.

    ⛔ It still records what it was asked to send, because "the artifact was produced" is the half
    of S2 this mode CAN measure — everything up to the wire. What it cannot measure is the wire, and
    the totals line prints `delivery=none` so that is never mistaken for a delivery that worked."""
    def _edit(app_id, token, *, content="", png=None, filename=None, pngs=None, **kw):
        n = len(pngs) if pngs else (1 if png is not None else 0)
        stats["artifacts"] = stats.get("artifacts", 0) + n
        stats["edits"] = stats.get("edits", 0) + 1
        stats["bytes"] = stats.get("bytes", 0) + sum(
            len(b or b"") for b, _ in (pngs or ([(png, filename)] if png is not None else [])))
        return {"id": "noop", "attachments": [{"id": i} for i in range(n)]}
    return _edit


def renderer_health() -> dict:
    """chart-renderer's own `/health`. ⛔ Read BEFORE and AFTER a run, because `recycles` and
    `renders_total` are CUMULATIVE COUNTERS: the after-value alone says what the pod has done since
    it booted, not what this run did. A delta is the only attributable number."""
    try:
        from api.routers import discord_interactions as router
        return router._renderer_health() or {}
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}


def renderer_delta(before: dict, after: dict) -> dict:
    """What THIS run cost the renderer. `None` where either side could not be read — never 0,
    which would read as "nothing happened"."""
    out: dict = {}
    for key in ("renders_total", "recycles", "timeouts", "failures", "pool_hits", "pool_misses"):
        b, a = before.get(key), after.get(key)
        out[key] = (a - b) if isinstance(b, (int, float)) and isinstance(a, (int, float)) else None
    # a gauge, not a counter: the after-value is the reading that matters
    out["rss_mb_after"] = after.get("rss_mb")
    out["rss_mb_before"] = before.get("rss_mb")
    return out


def collect_real_metrics(rt, deliver_stats: dict, renderer_before: dict | None = None) -> dict:
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
    after = renderer_health()
    out["renderer"] = after
    # ⛔ C-09's measurement: the warm cycle shares this renderer with members, so the recycles and
    # timeouts THIS run caused are the attributable number — not the pod's lifetime totals.
    out["renderer_delta"] = renderer_delta(renderer_before or {}, after)
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
    # ⛔⛔ THE CHANNEL MUST BE ONE THE COMMAND IS ALLOWED IN, OR THE RUN MEASURES THE CHANNEL GATE.
    # ⚰️ 2026-09-14: this was the literal "2". Run locally with no env that is fine — the gate is
    # unrestricted when `CHART_FLOW_CHANNEL_ID` is unset. Run under `railway run --service web` it
    # inherits PRODUCTION's allowlist, "2" is not on it, and all 31 interactions came back as an
    # immediate channel nudge: `replies={"immediate": 31}`, zero jobs, S2 unmeasured.
    # ⭐ The harness reported INCONCLUSIVE rather than PASS ("S2 was not measured, which is not the
    # same as met"), which is the only reason this was caught rather than banked as a fast p99.
    return {"id": f"{9_000_000_000_000_000_000 + n}", "type": 2, "application_id": "harness-app",
            "token": f"harness-token-{n}", "guild_id": "1",
            "channel_id": os.environ.get("HARNESS_CHANNEL_ID", "2"),
            "member": {"user": {"id": f"member-{n % max(1, members)}"}},
            "data": {"name": "chart", "options": [{"name": "ticker", "value": ticker}]}}


# ── the load model (OI-37) ──────────────────────────────────────────────────

OPEN_LOOP, CLOSED_LOOP = "open_loop", "closed_loop"


def _closed_loop_inflight_probe(*, n: int, seconds: float, service_s: float,
                                release_early: bool = False) -> dict:
    """A5 — exercise the closed-loop accounting against a stub service of known duration.

    ⚠️ THIS IS A MINIATURE OF `drive_closed_loop`'s accounting, not the function itself: the real
    loop is bound to the V2 runtime and cannot run inside a sub-second self-check. It is stated
    here rather than hidden because a copy is a second authority — the guard against drift is that
    the REAL run reports the same three fields (`peak_inflight`, `mean_inflight`, `requested`), so a
    divergence shows up the first time a real run is read.

    `release_early=True` is the deliberately broken variant: it decrements the in-flight counter at
    dispatch instead of at completion, which is precisely what an open loop wearing a concurrency
    label looks like. If the control cannot tell that apart, it is measuring nothing."""
    inflight = 0
    peak = 0
    samples: list[int] = []

    async def _client():
        nonlocal inflight, peak
        end = time.perf_counter() + seconds
        while time.perf_counter() < end:
            inflight += 1
            peak = max(peak, inflight)
            samples.append(inflight)
            if release_early:
                inflight -= 1
                await asyncio.sleep(service_s)
            else:
                try:
                    await asyncio.sleep(service_s)
                finally:
                    inflight -= 1

    async def _go():
        await asyncio.gather(*[_client() for _ in range(n)])

    asyncio.run(_go())
    return {"peak": peak, "mean": round(sum(samples) / len(samples), 2) if samples else 0.0,
            "requested": n, "samples": len(samples)}


#: The renderer a run actually used. ⛔ NOT a guess from configuration: `house_enabled()` is the
#: same predicate the product uses to choose, so this label is what really drew the PNG.
RENDERER_PRODUCTION, RENDERER_FALLBACK, RENDERER_UNKNOWN = "chart-renderer", "fallback", "unknown"


def _renderer_identity() -> str:
    try:
        from api.services import discord_chart_house as _house
        return RENDERER_PRODUCTION if _house.house_enabled() else RENDERER_FALLBACK
    except Exception:  # noqa: BLE001
        # ⛔ UNKNOWN is not FALLBACK. A reader must be able to tell "we measured the fallback" from
        # "we could not tell what we measured"; collapsing them would let an unlabelled run pass as
        # a known-inferior one, which is the more flattering of the two.
        return RENDERER_UNKNOWN


def mark_void(path, *, reason: str, superseded_by: str) -> dict:
    """Mark a run artifact VOID in its own file — bytes written, sha256 reported.

    ⛔⛔ VOID IS RETENTION, NOT DELETION. The 30-arrivals-per-second run is still the only overload
    characterisation this programme has; deleting or moving it would destroy evidence to make a gate
    tidy. It is instead labelled so every gate row SKIPS it and SAYS how many it skipped.

    ⛔ Edited by tooling, never by hand: a JSON file a human edited is a file nobody can prove the
    provenance of, and this one exists precisely to be excluded from judgement."""
    import hashlib
    p = pathlib.Path(path)
    before = p.read_bytes()
    d = json.loads(before.decode("utf-8"))
    meta = d.setdefault("meta", {})
    meta["void"] = True
    meta["void_reason"] = reason
    meta["superseded_by"] = superseded_by
    out = (json.dumps(d, indent=2) + "\n").encode("utf-8")
    p.write_bytes(out)
    return {"path": str(p), "sha256_before": hashlib.sha256(before).hexdigest(),
            "sha256_after": hashlib.sha256(out).hexdigest(),
            "void_reason": reason, "superseded_by": superseded_by}


def read_labelled_artifact(path) -> dict:
    """Load a run artifact, REFUSING one that does not say which load model produced it.

    ⛔⛔ A4. Before OI-37 every artifact carried `rate` and nothing else, so a reader could not tell
    30-arrivals-per-second from 30-concurrent — and for a whole programme nobody did. An unlabelled
    artifact is not a weaker measurement, it is an ambiguous one, and the cheapest moment to refuse
    it is when it is read rather than when it is quoted in a flip decision."""
    d = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    meta = d.get("meta") or {}
    model = meta.get("model")
    if model not in (OPEN_LOOP, CLOSED_LOOP):
        raise ValueError(
            f"{pathlib.Path(path).name}: no load model recorded (meta.model={model!r}). "
            f"Pre-OI-37 artifacts are AMBIGUOUS — `rate` alone cannot distinguish "
            f"arrivals/second from concurrency. Re-run it; do not infer.")
    if model == CLOSED_LOOP and meta.get("concurrency") is None:
        raise ValueError(f"{pathlib.Path(path).name}: closed_loop without a concurrency")
    if model == OPEN_LOOP and meta.get("arrival_rate") is None:
        raise ValueError(f"{pathlib.Path(path).name}: open_loop without an arrival_rate")
    return d


def label_of(meta: dict) -> str:
    """The one-line description that must sit beside any number from this harness."""
    m = meta.get("model")
    if m == CLOSED_LOOP:
        return f"closed loop, concurrency={meta.get('concurrency')}, {meta.get('seconds')}s"
    if m == OPEN_LOOP:
        return f"open loop, arrival_rate={meta.get('arrival_rate')}/s, {meta.get('seconds')}s"
    return "UNLABELLED — model unknown"

#: A job is finished when the store says so. Mirrors `jobs_store.TERMINAL_STATES` — imported
#: rather than retyped so a new terminal state cannot leave a client waiting forever.
_CORR: "contextvars.ContextVar[str]" = contextvars.ContextVar("harness_client", default="")


async def _await_terminal(store, corr_id: str, deadline: float) -> str:
    """Block until this job reaches a terminal state, or the deadline passes.

    ⛔ THIS IS WHAT MAKES THE LOOP CLOSED. A virtual member who has asked for a chart is not
    available to ask for another until the chart arrives (or visibly fails). Returning at the ACK
    would model a member who fires and forgets, which is the open-loop model wearing a
    concurrency label — and at ~1 ms acks, 30 such clients would offer ~30,000 arrivals/second."""
    from api.services.discord_render.jobs_store import TERMINAL_STATES
    while time.perf_counter() < deadline:
        row = store.get(corr_id) if store is not None else None
        if row and str(row.get("state") or "") in TERMINAL_STATES:
            return str(row.get("state"))
        await asyncio.sleep(0.05)
    return "deadline"


# ══════════════════════════════════════════════════════════════════════════════
# B1 — THE THREE-WAY SPLIT. An honest refusal is not a failure, and it is not a success either.
#
# ⛔⛔ S5's FLOOR AND MEANING ARE NOT TOUCHED HERE. `success_rate` is still `delivered / counted`
# exactly as `observe._summary` computes it, and 99.5 % is still the floor. This is an ADDITIONAL
# receipt printed beside it, because the owner's question — "at fourteen times the design burst, is
# refusing 3.6 % a breach or the system working?" — cannot be answered by one number that folds a
# refusal and a timeout into the same bucket.
#
# ⛔ THE DENOMINATOR IS OFFERS, NOT JOB ROWS, AND THAT IS THE FINDING. In the 30-concurrent run the
# store held 360 job rows and the harness made 406 offers: **46 requests were refused before a job
# row ever existed** (the per-member throttle answers at the door). Those 46 are invisible to
# `success_rate` in BOTH directions — they are neither delivered nor counted — so a system that
# refused every single member at the door would report a success rate of 100 % over zero jobs.
# ⭐ That is why the split is computed over offers and why the arithmetic has to close.
# ══════════════════════════════════════════════════════════════════════════════

#: Failure classes that mean "we said no at the door, before doing any work". ⛔ Derived against
#: `contract.FAILURE_CLASSES` at call time so a class renamed upstream is a LOUD failure here rather
#: than a silent reclassification into `failed`.
ADMISSION_REFUSAL_CLASSES = frozenset({"queue_full"})


def admission_split(rt, *, offers: int, refused_before_job_observed: int | None = None,
                    slo_p99_ms: float = 8000.0, window_s: float = 3600.0) -> dict:
    """served_in_slo | served_late | refused_by_admission | failed | unresolved, over OFFERS.

    ⛔ A RECEIPT WHOSE ARITHMETIC DOES NOT CLOSE IS REFUSED, not published with a note. The five
    buckets must sum to `offers`; if they do not, the split says so and carries `closes: false`,
    because a breakdown that loses requests reads as a quieter system than the real one
    (`CoverageLine`, and the reason it has four counts instead of two)."""
    # ⛔ IMPORTED, NEVER RETYPED — the same rule `_await_terminal` follows. A terminal state added
    # upstream must reach this split the day it lands, or a whole class of resolved job silently
    # becomes `unresolved` and the receipt stops closing for a reason nobody can find.
    from api.services.discord_render.jobs_store import TERMINAL_STATES
    from api.services.discord_render import contract
    unknown = sorted(ADMISSION_REFUSAL_CLASSES - set(contract.FAILURE_CLASSES))
    rows = []
    try:
        rows = rt.store.recent(window_s, limit=50_000) or []
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}", "closes": False, "offers": offers}

    served_in_slo = served_late = refused_rows = failed = 0
    failed_classes: dict = {}
    for r in rows:
        state = str(r.get("state") or "")
        if state == "delivered":
            f = r.get("final_ms")
            if isinstance(f, (int, float)) and f <= slo_p99_ms:
                served_in_slo += 1
            else:
                # ⛔ A DELIVERED-BUT-LATE MEMBER IS NOT "SERVED IN SLO", and an UNMEASURED final is
                # not served in SLO either: a delivery nobody timed cannot be claimed as fast.
                served_late += 1
        elif state in TERMINAL_STATES:
            cls = str(r.get("failure_class") or "unclassified")
            if cls in ADMISSION_REFUSAL_CLASSES:
                refused_rows += 1
            else:
                failed += 1
                failed_classes[cls] = failed_classes.get(cls, 0) + 1
    # ⛔ DERIVED FROM THE STORE, NOT FROM A COUNTER THIS HARNESS KEPT. An offer that never became a
    # job row was refused at the door — the per-member throttle answers before any work starts — and
    # the sandbox store holds only this run's rows, so the subtraction is exact.
    job_rows = len(rows)
    refused_before_job = max(0, offers - job_rows)
    refused = refused_rows + refused_before_job
    accounted = served_in_slo + served_late + refused + failed
    unresolved = offers - accounted
    out = {
        "offers": offers, "job_rows": job_rows,
        "served_in_slo": served_in_slo, "served_late": served_late,
        "refused_by_admission": refused,
        "refused_before_job_row": refused_before_job, "refused_with_job_row": refused_rows,
        "failed": failed, "failed_by_class": failed_classes,
        "unresolved": unresolved,
        "closes": unresolved == 0 and offers > 0,
        "slo_p99_ms": slo_p99_ms,
        "admission_classes": sorted(ADMISSION_REFUSAL_CLASSES),
    }
    # ⭐ THE CROSS-CHECK, because two ways of counting the same thing is the only way to know either
    # is right. The closed loop OBSERVES a refusal directly (`handle` returned without registering a
    # corr_id); this function DERIVES it from the store. They must agree, and a disagreement is
    # published rather than resolved in favour of whichever is more flattering.
    if refused_before_job_observed is not None:
        out["refused_before_job_row_observed"] = refused_before_job_observed
        if refused_before_job_observed != refused_before_job:
            out["refused_before_job_row_mismatch"] = (
                f"observed {refused_before_job_observed}, derived {refused_before_job} — the two "
                f"counts disagree, so neither is evidence until the difference is explained")
            out["closes"] = False
    if unknown:
        out["admission_classes_unknown_to_contract"] = unknown
        out["closes"] = False
    return out


# ══════════════════════════════════════════════════════════════════════════════
# B2 — THE THREE LOADS THE CENSUS SUPPORTS, DERIVED AND NEVER RETYPED.
#
# ⛔ Every rate below is computed from `arrival_census` against the arrivals artifact at call time.
# A number typed here would be a second authority over a value the census already owns, and this
# programme has paid for that shape repeatedly.
# ══════════════════════════════════════════════════════════════════════════════

BURST_DESIGN, BURST_10S, BURST_60S = "design", "busiest10s", "busiest60s"
BURST_MODES = (BURST_DESIGN, BURST_10S, BURST_60S)

#: The headroom multiple the sizing derivation uses for the DESIGN burst. Mirrors
#: `arrival_census.cmd_analyze`'s default; overridable on the command line so the sensitivity is a
#: measurement rather than a belief.
DESIGN_BURST_MULTIPLE = 3.0


def burst_profile(mode: str, census_path, *, multiple: float = DESIGN_BURST_MULTIPLE) -> dict:
    """(arrival_rate, seconds, and the derivation) for one of the three real-traffic loads."""
    import arrival_census as census
    rows, meta = census.load_arrivals([str(census_path)])
    if not rows:
        raise SystemExit(f"{census_path}: no arrivals — a load derived from an empty census is a "
                         f"load derived from nothing")
    b10 = census.busiest_window(rows, 10.0)
    b60 = census.busiest_window(rows, 60.0)
    if mode == BURST_DESIGN:
        count, width, basis = multiple * b10["count"], 10.0, f"{multiple:g}x busiest 10 s"
    elif mode == BURST_10S:
        count, width, basis = float(b10["count"]), 10.0, "busiest 10 s, as observed"
    elif mode == BURST_60S:
        count, width, basis = float(b60["count"]), 60.0, "busiest 60 s, as observed"
    else:
        raise SystemExit(f"unknown burst mode {mode!r}; expected one of {BURST_MODES}")
    return {"mode": mode, "arrival_rate": round(count / width, 4), "window_s": width,
            "arrivals_in_window": count, "basis": basis, "multiple": multiple,
            "busiest_10s": b10["count"], "busiest_60s": b60["count"],
            "census": str(census_path), "census_arrivals": len(rows),
            "census_window": meta.get("window") if isinstance(meta, dict) else None}


async def drive_closed_loop(concurrency: int, seconds: float, *, members: int, symbols_mode: str,
                            tickers: list, real: bool, deliver_channel: str,
                            deliver_rate: float, drain_s: float, think_s: float = 1.0,
                            deliver_stats: dict | None = None) -> dict:
    """N virtual members, each issuing its next request only when its previous one RESOLVES.

    ⛔⛔ OI-37. The spec said "30 concurrent" and the harness drove 30 ARRIVALS PER SECOND — about
    fifteen times the offered load that was asked for. Under an open-loop model the queue is handed
    work at a rate nothing throttles, so `queue_full` is guaranteed at a high enough R and says
    nothing about whether the queue is sized correctly. Under a closed loop the offered load is
    bounded by N and by service time, which is the question admission control is actually about."""
    from api.services.discord_render import commands, symbols

    if symbols_mode == "stub":
        commands.symbols.resolve = lambda sym, **kw: symbols.Resolution(  # type: ignore[attr-defined]
            ok=True, symbol=sym.upper(), unknown=[], suggestions=())

    rt = commands.get_runtime()
    _dstats = deliver_stats if deliver_stats is not None else {}
    if deliver_channel:
        rt.edit_fn = channel_edit_fn(deliver_channel, rate=deliver_rate, stats=_dstats)
    elif real:
        rt.edit_fn = counting_edit_fn(_dstats)

    # ⭐ Capture each client's corr_id WITHOUT changing behaviour: `offer` is wrapped, and the
    # client identity travels in a ContextVar so interleaved awaits cannot cross the wires.
    corr_by_client: dict = {}
    _real_offer = rt.offer

    def _offer(job):
        who = _CORR.get()
        if who:
            corr_by_client[who] = getattr(job, "corr_id", None)
        return _real_offer(job)

    rt.offer = _offer

    samples: list[float] = []
    kinds: dict = {}
    queue_depth: list = []
    inflight = 0
    peak_inflight = 0
    inflight_samples: list[int] = []
    resolutions: dict = {}
    counter = {"n": 0}
    started = time.perf_counter()
    end_at = started + seconds

    async def client(idx: int) -> None:
        nonlocal inflight, peak_inflight
        who = f"c{idx}"
        _CORR.set(who)
        while time.perf_counter() < end_at:
            n = counter["n"]
            counter["n"] = n + 1
            inflight += 1
            peak_inflight = max(peak_inflight, inflight)
            inflight_samples.append(inflight)
            received = time.perf_counter()
            try:
                reply = await commands.handle(
                    interaction(n, members=members, ticker=tickers[n % len(tickers)]), received)
                samples.append((time.perf_counter() - received) * 1000.0)
                kinds[_kind_of(reply)] = kinds.get(_kind_of(reply), 0) + 1
                corr = corr_by_client.pop(who, None)
                if real and corr:
                    state = await _await_terminal(rt.store, corr, min(end_at + drain_s,
                                                                     time.perf_counter() + drain_s))
                    resolutions[state] = resolutions.get(state, 0) + 1
                else:
                    # ⛔⛔ A REFUSED MEMBER IS FREE, BUT NOT INSTANTLY — AND THE FIRST VERSION OF
                    # THIS LOOP GOT THAT WRONG. It resolved refusals with no delay, so 30 clients
                    # hammering the per-member throttle produced **521,654 attempts in 20 seconds**
                    # and six acks over 3 s. Those acks were MY spin, not the system: a real member
                    # told "slow down" does not retry twenty-six thousand times a second.
                    # ⭐ This is OI-37's own mistake in miniature — a load model that does not model
                    # the load — so the think time is explicit, parameterised and recorded in the
                    # artifact rather than tuned until the graph looks right.
                    resolutions["refused_at_admission"] = resolutions.get("refused_at_admission", 0) + 1
                    if think_s > 0:
                        await asyncio.sleep(think_s)
            finally:
                inflight -= 1
            if think_s > 0:
                # Between requests: a closed-loop client with no think time models a BOT,
                # not a member, and the offered load then depends on service time rather
                # than on member behaviour. OUTSIDE the finally, so the member is not
                # holding an in-flight slot while they are 'thinking'.
                await asyncio.sleep(think_s)

    async def gauge() -> None:
        while time.perf_counter() < end_at:
            queue_depth.append({"t": round(time.perf_counter() - started, 2),
                                "inflight": inflight, **(rt.depth() or {})})
            await asyncio.sleep(0.5)

    try:
        await asyncio.gather(gauge(), *[client(i) for i in range(concurrency)])
        if real:
            deadline = time.perf_counter() + drain_s
            while time.perf_counter() < deadline:
                d = rt.depth() or {}
                queue_depth.append({"t": round(time.perf_counter() - started, 2),
                                    "inflight": inflight, **d})
                if not (d.get("interactive") or d.get("active") or d.get("background")):
                    break
                await asyncio.sleep(1.0)
    finally:
        rt.offer = _real_offer
        try:
            commands.stop()
        except Exception:  # noqa: BLE001
            pass

    mean_inflight = (sum(inflight_samples) / len(inflight_samples)) if inflight_samples else 0.0
    return {"samples": samples, "kinds": kinds, "queue": rt.depth() if rt else {},
            "queue_depth": queue_depth, "runtime": rt,
            "elapsed_s": time.perf_counter() - started,
            "concurrency": {"requested": concurrency, "think_s": think_s,
                            "peak_inflight": peak_inflight,
                            "mean_inflight": round(mean_inflight, 2),
                            "resolutions": resolutions}}


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
    _dstats = deliver_stats if deliver_stats is not None else {}
    if deliver_channel:
        rt.edit_fn = channel_edit_fn(deliver_channel, rate=deliver_rate, stats=_dstats)
    elif real:
        # ⛔⛔ A `--real` RUN WITH NO CHANNEL MUST NOT REACH DISCORD AT ALL. The runtime's default
        # `edit_fn` PATCHes `/webhooks/{app}/{token}/messages/@original`, and this harness's tokens
        # are FABRICATED — so without this branch a 100-interaction burst fires a hundred invalid
        # bearer tokens at Discord's live API and measures their 401 handler. The ack-only mode was
        # safe only because its handler was stubbed and never delivered; `--real` runs the real one.
        rt.edit_fn = counting_edit_fn(_dstats)
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
    # ⛔ D-02 C1 — a SEALING collector, not a list. The evaluation loop used to sit in the middle of
    # the appends and fifteen cases were counted without ever being checked; `Cases` raises on an
    # append after the read, so that cannot come back quietly.
    from selfcheck import Cases
    cases = Cases("load_harness")

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

    # ── OI-37: the load model is declared, recorded, and actually held ──────────────────
    import tempfile as _tf
    _dir = pathlib.Path(_tf.mkdtemp(prefix="drender-label-"))

    def _write(meta):
        q = _dir / f"a{len(list(_dir.iterdir()))}.json"
        q.write_text(json.dumps({"meta": meta, "stats": {}}), encoding="utf-8")
        return q

    def _refuses(meta):
        try:
            read_labelled_artifact(_write(meta))
            return False
        except ValueError:
            return True

    cases.append(("a closed-loop artifact is accepted and labelled",
                  read_labelled_artifact(_write({"model": CLOSED_LOOP, "concurrency": 30,
                                                 "seconds": 60})) is not None))
    # ⛔ THE LOAD-BEARING ROW: a pre-OI-37 artifact carries `rate` and no model. It must be
    # REFUSED, not read hopefully — that ambiguity is the whole defect.
    cases.append(("a pre-OI-37 artifact (rate, no model) is REFUSED",
                  _refuses({"rate": 30.0, "seconds": 20})))
    cases.append(("closed_loop without a concurrency is REFUSED",
                  _refuses({"model": CLOSED_LOOP, "seconds": 60})))
    cases.append(("open_loop without an arrival_rate is REFUSED",
                  _refuses({"model": OPEN_LOOP, "seconds": 60})))
    # ⛔ non-vacuity for the three refusals: the reader must be able to ACCEPT something, or
    # "it refused" is just a function that always raises.
    cases.append(("the reader can still accept a valid open-loop artifact",
                  read_labelled_artifact(_write({"model": OPEN_LOOP, "arrival_rate": 1.0,
                                                 "seconds": 600})) is not None))
    cases.append(("the label names the model and its parameter",
                  label_of({"model": CLOSED_LOOP, "concurrency": 30, "seconds": 20})
                  == "closed loop, concurrency=30, 20s"
                  and "open loop" in label_of({"model": OPEN_LOOP, "arrival_rate": 30.0,
                                               "seconds": 20})))
    # ⛔ the two models must not render the same string — a label that cannot distinguish them
    # would satisfy every row above while leaving the reader exactly where OI-37 found them.
    cases.append(("the two models do not describe themselves identically",
                  label_of({"model": CLOSED_LOOP, "concurrency": 30, "seconds": 20})
                  != label_of({"model": OPEN_LOOP, "arrival_rate": 30.0, "seconds": 20})))

    # A5 — the in-flight accounting, exercised through the REAL client loop with a stub handler.
    _held = _closed_loop_inflight_probe(n=4, seconds=0.6, service_s=0.05)
    # ⛔ BOUNDED ON BOTH SIDES. `peak <= N` alone is satisfied by a blinded gauge reporting 0 —
    # measured: a mutation setting `peak = 0` left this row green. An upper bound cannot tell
    # "never exceeded N" from "never saw anything", which is this programme's oldest lesson.
    cases.append(("closed loop reaches EXACTLY N in flight, never more",
                  _held["peak"] == 4))
    cases.append(("closed loop actually HOLDS N in flight under saturation",
                  _held["mean"] >= 3.0))
    # ⛔ control for the control: a deliberately broken client that releases BEFORE completion
    # must break the mean, or the row above passes for a loop that never held anything.
    _broken = _closed_loop_inflight_probe(n=4, seconds=0.6, service_s=0.05, release_early=True)
    cases.append(("releasing before completion is CAUGHT by the mean",
                  _broken["mean"] < 3.0))

    # ⛔⛔ THE CLI CONTRACT IS PART OF THE MEASUREMENT, so it is checked here and not only by hand.
    # ⚰️ A mutation that deleted the "exactly one model" guard left this self-check GREEN, because
    # the guard lives in `main()` and nothing here had ever called it. A guard with no control is
    # the defect OI-37 exists to record, so it would have been the second instance in one file.
    # ⛔ ASSERT THE REASON, NOT THE EXIT CODE. `main()` returns INCONCLUSIVE for several unrelated
    # causes, so `== INCONCLUSIVE` alone passes whether or not the model guard exists — measured:
    # deleting the guard left these rows green. The verdict must name the thing under test.
    import contextlib as _ctx
    import io as _io

    def _main_says(argv: list) -> str:
        buf = _io.StringIO()
        with _ctx.redirect_stdout(buf):
            code = main(argv)
        return f"{code}|{buf.getvalue()}"

    _neither = _main_says(["--seconds", "1"])
    _both = _main_says(["--arrival-rate", "1", "--concurrency", "5", "--seconds", "1"])
    _old = _main_says(["--rate", "30", "--seconds", "1"])
    _zero = _main_says(["--concurrency", "0", "--seconds", "1"])
    cases.append(("no load model given is refused BY NAME",
                  _neither.startswith(f"{INCONCLUSIVE}|") and "neither load model" in _neither))
    cases.append(("both load models given is refused BY NAME",
                  _both.startswith(f"{INCONCLUSIVE}|") and "both load model" in _both))
    cases.append(("the removed --rate flag is refused BY NAME, not silently re-read",
                  _old.startswith(f"{INCONCLUSIVE}|") and "--rate is ambiguous" in _old))
    cases.append(("--concurrency 0 is refused BY NAME",
                  _zero.startswith(f"{INCONCLUSIVE}|") and "concurrency must be" in _zero))


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
    # ⛔⛔ THE PROPERTY THAT KEEPS A `--real` RUN OFF DISCORD'S LIVE API. Asserted from the
    # SOURCE of `drive`, because the alternative is running it — and running it is the thing this
    # case exists to make safe. The tokens this harness mints are fabricated; a hundred of them
    # against `/webhooks/{app}/{token}` would measure Discord's 401 handler.
    import inspect as _i
    _src = _i.getsource(drive)
    cases.append(("--real without a channel installs the no-op delivery",
                  "elif real:" in _src and "counting_edit_fn" in _src))
    cases.append(("--real WITH a channel installs the throttled real one",
                  "if deliver_channel:" in _src and "channel_edit_fn" in _src))
    # ⛔ A DELTA OVER AN UNREADABLE READING IS `None`, NEVER 0 — a zero would report "the run
    # caused no recycles" when what happened is that nobody could tell.
    _d = renderer_delta({"recycles": 2, "renders_total": 10}, {"recycles": 5, "renders_total": 40})
    cases.append(("a renderer delta subtracts the two ends",
                  _d["recycles"] == 3 and _d["renders_total"] == 30))
    _d2 = renderer_delta({}, {"recycles": 5})
    cases.append(("an unreadable BEFORE makes the delta None, not the after-value",
                  _d2["recycles"] is None))
    _d3 = renderer_delta({"recycles": 2}, {"error": "x"})
    cases.append(("an unreadable AFTER makes the delta None", _d3["recycles"] is None))
    _st = {}
    counting_edit_fn(_st)("app", "tok", content="x", png=b"12345", filename="a.png")
    cases.append(("the no-op delivery still records the artifact it was handed",
                  _st.get("artifacts") == 1 and _st.get("bytes") == 5))
    # ⛔ a hit rate of zero over zero lookups is NO MEASUREMENT, not a bad cache
    cases.append(("an empty cache reports `None`, never 0.0",
                  (collect_real_metrics(_NoRt(), {}).get("cache") or {}).get("hit_rate") is None))

    # ── B1 · the three-way split, and the arithmetic that has to close ─────
    class _Store:
        def __init__(self, rows):
            self._rows = rows

        def recent(self, *_a, **_kw):
            return list(self._rows)

    class _Rt:
        def __init__(self, rows):
            self.store = _Store(rows)

    def _row(state, *, final_ms=None, cls=None):
        return {"state": state, "final_ms": final_ms, "failure_class": cls}

    _rows = ([_row("delivered", final_ms=1200.0)] * 6
             + [_row("delivered", final_ms=12000.0)]
             + [_row("abandoned", cls="queue_full")] * 2
             + [_row("messaged", cls="deadline")])
    _sp = admission_split(_Rt(_rows), offers=12)          # 10 job rows + 2 refused at the door
    cases.append(("the split puts a fast delivery in served_in_slo", _sp["served_in_slo"] == 6))
    # ⛔ A DELIVERED-BUT-LATE MEMBER IS NOT SERVED IN SLO. Folding them together is how a p50 hides
    # the member who waited twelve seconds — the same defect `over_3s` exists to stop for S1.
    cases.append(("a delivered-but-late job is served_late, never served_in_slo",
                  _sp["served_late"] == 1))
    cases.append(("`queue_full` is an ADMISSION REFUSAL, not a failure",
                  _sp["refused_with_job_row"] == 2))
    cases.append(("a non-admission class is a FAILURE, not a refusal",
                  _sp["failed"] == 1 and _sp["failed_by_class"].get("deadline") == 1))
    # ⛔⛔ THE FINDING THIS SPLIT EXISTS FOR: an offer refused before any job row is invisible to
    # `success_rate` in BOTH directions. Measured on the 30-concurrent run: 406 offers, 360 job
    # rows, 46 refused at the door.
    cases.append(("an offer that never became a job row is counted as a refusal",
                  _sp["refused_before_job_row"] == 2 and _sp["refused_by_admission"] == 4))
    cases.append(("the arithmetic closes over OFFERS, not job rows",
                  _sp["closes"] is True and _sp["unresolved"] == 0))
    # ⛔ NON-VACUITY, AND IT CAUGHT ME. My first version of this control passed `offers=20` against
    # ten job rows and expected the receipt to stop closing. It closed: `refused_before_job` is
    # DERIVED as offers minus job rows, so extra offers are absorbed as door refusals and the sum is
    # correct by construction. A flag that cannot say no is not a check.
    # ⭐ What genuinely fails to close is a job row that is still IN FLIGHT when the run ended: it is
    # neither delivered nor terminal, so no bucket may claim it, and rounding it into "refused"
    # would report a member who is still waiting as a member who was told no.
    _inflight = _rows[:-1] + [_row("rendering")]
    _sp_open = admission_split(_Rt(_inflight), offers=12)
    cases.append(("a job still in flight leaves the receipt NOT closing",
                  _sp_open["closes"] is False and _sp_open["unresolved"] == 1))
    # ⭐ two ways of counting one thing, and a disagreement is PUBLISHED rather than resolved in
    # favour of whichever is more flattering.
    _sp_bad = admission_split(_Rt(_rows), offers=12, refused_before_job_observed=5)
    cases.append(("the observed/derived refusal counts are cross-checked",
                  "refused_before_job_row_mismatch" in _sp_bad and _sp_bad["closes"] is False))
    _sp_ok = admission_split(_Rt(_rows), offers=12, refused_before_job_observed=2)
    cases.append(("agreeing counts do NOT raise a mismatch (control)",
                  "refused_before_job_row_mismatch" not in _sp_ok and _sp_ok["closes"] is True))

    # ── B2 · the three loads, DERIVED from the census and never retyped ────
    _census = _repo_root() / "docs" / "discord-render" / "evidence" / "arrivals-30d.json"
    if _census.exists():
        _p = {m: burst_profile(m, _census) for m in BURST_MODES}
        cases.append(("the three burst modes derive three DIFFERENT rates",
                      len({_p[m]["arrival_rate"] for m in BURST_MODES}) == 3))
        cases.append(("the design burst is the multiple times the busiest 10 s",
                      abs(_p[BURST_DESIGN]["arrival_rate"]
                          - DESIGN_BURST_MULTIPLE * _p[BURST_10S]["arrival_rate"]) < 1e-9))
        # ⛔ CONTROL FOR THE MULTIPLE. A mutation replacing it with 1.0 must MOVE the design burst;
        # a headroom term nothing can distinguish from its absence is not a headroom term.
        _one = burst_profile(BURST_DESIGN, _census, multiple=1.0)
        cases.append(("multiple=1 collapses the design burst onto the observed busiest 10 s",
                      _one["arrival_rate"] == _p[BURST_10S]["arrival_rate"]
                      and _one["arrival_rate"] != _p[BURST_DESIGN]["arrival_rate"]))
        cases.append(("every burst profile carries its own derivation",
                      all(_p[m]["basis"] and _p[m]["census_arrivals"] > 0 for m in BURST_MODES)))
    else:
        cases.append(("the arrivals census is present so the burst modes can be derived", False))
    try:
        burst_profile("busiest3s", _census)
        cases.append(("an unknown burst mode is refused BY NAME", False))
    except SystemExit as e:
        cases.append(("an unknown burst mode is refused BY NAME", "busiest3s" in str(e)))

    # ⛔⛔ THE EVALUATION RUNS LAST, AFTER EVERY APPEND — AND NOW IT IS ENFORCED RATHER THAN
    # OBSERVED. ⚰️ It used to sit in the MIDDLE: fifteen cases were appended after it and were
    # therefore counted by `len(cases)` and never checked. `--self-check` printed
    # `cases=20 failed=0` while five were evaluated — the count rose, the checking did not, the
    # same shape as the flip gate rows that reported MET off file existence. "Keep the loop last"
    # was already true and stopped being true; `Cases` raises instead.
    return PASS if cases.report() == 0 else FAIL


# ── entry ───────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # ⛔⛔ OI-37. `--rate` is GONE, not aliased. It meant arrivals per second, the spec
    # said "30 concurrent", and the two were read as the same thing for a whole
    # programme — 30/s is about fifteen times 30-concurrent for this service. A silent
    # alias would preserve exactly the ambiguity that produced the wrong measurement, so
    # the old flag now ERRORS and names its two replacements.
    ap.add_argument("--rate", type=float, default=None,
                    help=argparse.SUPPRESS)
    ap.add_argument("--arrival-rate", type=float, default=None,
                    help="OPEN LOOP: interactions per second, scheduled on a clock "
                         "regardless of whether earlier ones finished")
    ap.add_argument("--think-time", type=float, default=1.0,
                    help="CLOSED LOOP: seconds a virtual member waits before its next "
                         "request. 0 models a bot, not a member — and a refused client "
                         "with no think time hot-spins the throttle (measured: 521,654 "
                         "attempts in 20 s)")
    ap.add_argument("--concurrency", type=int, default=None,
                    help="CLOSED LOOP: N virtual members held in flight; each issues its "
                         "next request only when its previous one resolves")
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
    ap.add_argument("--allow-fallback-renderer", action="store_true",
                    help="measure the mplfinance fallback ON PURPOSE. Without this, --real refuses "
                         "to run when CHART_RENDERER_URL is unset or unreachable (OI-39)")
    ap.add_argument("--deliver-rate", type=float, default=DELIVER_RATE_DEFAULT,
                    help="writes per second; the throttle is part of the measurement")
    ap.add_argument("--drain-s", type=float, default=90.0,
                    help="how long to wait for the queue to finish after the last ack")
    ap.add_argument("--burst", choices=BURST_MODES, default="",
                    help="derive --arrival-rate from the arrival census instead of typing one: "
                         "design (3x the busiest 10 s) | busiest10s | busiest60s")
    ap.add_argument("--census", default="docs/discord-render/evidence/arrivals-30d.json",
                    help="the arrivals artifact --burst derives from")
    ap.add_argument("--burst-multiple", type=float, default=DESIGN_BURST_MULTIPLE,
                    help="headroom multiple for --burst design (sensitivity is a measurement)")
    ap.add_argument("--mark-void", default="",
                    help="mark a run artifact VOID in place (retained, never judged)")
    ap.add_argument("--void-reason", default="")
    ap.add_argument("--superseded-by", default="")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()
    if args.mark_void:
        if not args.void_reason or not args.superseded_by:
            print("TOTALS load_harness INCONCLUSIVE --mark-void needs --void-reason and "
                  "--superseded-by: a void with no reason is indistinguishable from a "
                  "mistake, and the next reader cannot tell which")
            return INCONCLUSIVE
        res = mark_void(args.mark_void, reason=args.void_reason,
                        superseded_by=args.superseded_by)
        print(f"VOIDED {res['path']}")
        print(f"  sha256 {res['sha256_before'][:16]} -> {res['sha256_after'][:16]}")
        print(f"  reason: {res['void_reason']}")
        print(f"  superseded_by: {res['superseded_by']}")
        print("TOTALS load_harness --mark-void PASS 1 artifact marked void (RETAINED)")
        return PASS

    # ⛔⛔ OI-37 — THE LOAD MODEL IS DECLARED, NEVER DEFAULTED.
    # The spec said "30 concurrent"; the harness drove 30 arrivals per second; nobody noticed for a
    # whole programme because one flag called `--rate` could be read as either. There is now no
    # default and no alias: a run must say which question it is asking, or it does not run.
    burst = None
    if args.burst:
        # ⛔ --burst SETS THE OPEN-LOOP RATE AND SAYS SO IN THE ARTIFACT. It is not a second load
        # model: it is a derivation of `--arrival-rate` from twenty days of real arrivals, so the
        # number in the artifact carries its own provenance instead of a reader having to trust
        # that somebody typed 0.6 for the right reason.
        if args.arrival_rate is not None or args.concurrency is not None:
            print("TOTALS load_harness INCONCLUSIVE --burst derives the arrival rate; passing it "
                  "beside --arrival-rate or --concurrency puts two authorities on one number")
            return INCONCLUSIVE
        burst = burst_profile(args.burst, args.census, multiple=args.burst_multiple)
        args.arrival_rate = burst["arrival_rate"]
    if args.rate is not None:
        print("TOTALS load_harness INCONCLUSIVE --rate is ambiguous and has been REMOVED (OI-37). "
              "It meant arrivals/second, and the spec it was used against said 'concurrent'. "
              "Use --arrival-rate R (open loop) or --concurrency N (closed loop).")
        return INCONCLUSIVE
    if (args.arrival_rate is None) == (args.concurrency is None):
        which = "both" if args.arrival_rate is not None else "neither"
        print(f"TOTALS load_harness INCONCLUSIVE {which} load model given. Pass exactly one of "
              f"--arrival-rate R (open loop: arrivals on a clock, independent of completion) or "
              f"--concurrency N (closed loop: N in flight, next request on resolution). "
              f"There is no default — a number whose model is unstated is not a measurement.")
        return INCONCLUSIVE
    model = CLOSED_LOOP if args.concurrency is not None else OPEN_LOOP
    if args.concurrency is not None and args.concurrency < 1:
        print("TOTALS load_harness INCONCLUSIVE --concurrency must be >= 1")
        return INCONCLUSIVE

    sys.path.insert(0, str(_repo_root()))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-load-"))
    meta = {"model": model, "arrival_rate": args.arrival_rate, "think_time_s": args.think_time,
            "concurrency": args.concurrency,
            # ⛔ `rate` is kept in the artifact ONLY so an old reader does not silently
            # read None; `model` is the field that says what the number means.
            "rate": args.arrival_rate, "seconds": args.seconds, "members": args.members,
            "handler_ms": args.handler_ms, "symbols": args.symbols, "sandbox": str(tmp),
            "mode": "real" if args.real else "ack",
            # ⛔⛔ IN-BAND LABELS, so a GATE NEVER HAS TO GUESS FROM A FILENAME (D-02 Part A).
            # The S2 row used to select evidence with glob("*real*.json") and exclude it with
            # `"chaos" not in p.name` — filename matching is the file-existence class wearing a
            # different hat, and it both missed a valid run and judged a void one.
            "kind": "load",
            # ⭐ RENDERER IDENTITY IS FIRST CLASS (OI-39). `house_enabled()` is exactly
            # bool(CHART_RENDERER_URL); with it unset the run draws mplfinance PNGs in-process and
            # every latency is about a renderer production does not use.
            "renderer": _renderer_identity(),
            # ⛔ A void artifact is RETAINED (it is the overload characterisation) and NEVER judged.
            "void": False, "void_reason": None, "superseded_by": None,
            # ⛔ STATED ON EVERY RUN, because it is the number the owner asks for on every report.
            "organic_members_exposed": 0,
            # ⛔ THE DERIVATION TRAVELS WITH THE NUMBER (B2). `arrival_rate: 0.6` on its own is a
            # number somebody typed; with `burst` beside it, the next reader can re-derive it.
            "burst": burst,
            "delivery": "channel" if args.deliver_channel else ("none" if args.real else "noop")}
    if args.real and args.symbols == "stub":
        print("TOTALS load_harness INCONCLUSIVE --real with --symbols stub is a contradiction: "
              "the symbol check is part of what S2 pays for")
        return INCONCLUSIVE
    if args.real and not args.allow_fallback_renderer:
        # ⛔⛔ OI-39. `house_enabled()` is exactly `bool(CHART_RENDERER_URL)`, and production renders
        # a house chart by screenshotting /r/chart on chart-renderer. With that variable unset the
        # whole run silently draws mplfinance PNGs in-process instead — a real pipeline producing
        # real bytes, measuring a DIFFERENT renderer. On 2026-09-14 that produced a full set of S2
        # figures that had to be withdrawn.
        # ⛔ Refusing is the only honest answer: a number about the wrong renderer is worse than no
        # number, because it looks like the one that was asked for.
        try:
            from api.services import discord_chart_house as _house
            _house_on = _house.house_enabled()
        except Exception as e:  # noqa: BLE001
            print(f"TOTALS load_harness INCONCLUSIVE could not determine the renderer: "
                  f"{type(e).__name__}")
            return INCONCLUSIVE
        if not _house_on:
            print("TOTALS load_harness INCONCLUSIVE --real without CHART_RENDERER_URL measures the "
                  "mplfinance FALLBACK renderer, not production's chart-renderer. That also leaves "
                  "house_fn unwired, so the artifact cache is unreachable and reports 0/0. "
                  "Pass --allow-fallback-renderer only if the fallback IS what you meant to measure.")
            return INCONCLUSIVE
        # ⚠️ And the variable being SET is not the same as the renderer being REACHABLE:
        # chart-renderer is private-network only, so from an operator's PC the name does not
        # resolve and every render fails with getaddrinfo. Say so before burning the run.
        import socket
        from urllib.parse import urlparse
        _host = urlparse(os.environ.get("CHART_RENDERER_URL", "")).hostname or ""
        try:
            socket.getaddrinfo(_host, None)
        except Exception:  # noqa: BLE001
            print(f"TOTALS load_harness INCONCLUSIVE CHART_RENDERER_URL names {_host!r}, which does "
                  f"not resolve from here — chart-renderer is private-network only. Every render "
                  f"would fail with getaddrinfo. Run this inside the private network, or measure S2 "
                  f"from the canary instead.")
            return INCONCLUSIVE
    deliver_stats: dict = {}
    # read BEFORE the sandbox is torn down and before any load — a cumulative counter
    # needs both ends to say anything about this run
    rend_before: dict = {}
    stats: dict = {"n": 0}
    kinds: dict = {}
    try:
        sandbox(tmp)
        enable_v2()
        rend_before = renderer_health() if args.real else {}
        _tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
        if model == CLOSED_LOOP:
            out = asyncio.run(drive_closed_loop(
                args.concurrency, args.seconds, members=args.members, symbols_mode=args.symbols,
                tickers=_tickers, real=args.real, deliver_channel=args.deliver_channel,
                deliver_rate=args.deliver_rate, drain_s=args.drain_s,
                think_s=args.think_time, deliver_stats=deliver_stats))
        else:
            out = asyncio.run(drive(args.arrival_rate, args.seconds, members=args.members,
                                    handler_ms=args.handler_ms, symbols_mode=args.symbols,
                                    tickers=_tickers,
                                    real=args.real, deliver_channel=args.deliver_channel,
                                    deliver_rate=args.deliver_rate, drain_s=args.drain_s,
                                    deliver_stats=deliver_stats))
        stats, kinds = summarise(out["samples"]), out["kinds"]
        meta["elapsed_s"] = round(out["elapsed_s"], 2)
        meta["queue_at_end"] = out["queue"]
        # ⛔ A4: the artifact records WHICH MODEL produced it, in band. An artifact that
        # does not say is rejected by `read_labelled_artifact` rather than read hopefully.
        if out.get("concurrency"):
            meta["concurrency_observed"] = out["concurrency"]
        real_metrics = (collect_real_metrics(out["runtime"], deliver_stats, rend_before)
                        if args.real else {})
        if args.real and out.get("runtime") is not None:
            # ⛔ B1 — PRINTED BESIDE S5, NEVER INSTEAD OF IT. `success_rate` keeps its definition and
            # its 99.5 % floor; this says what the failures WERE, over offers rather than job rows.
            real_metrics["admission_split"] = admission_split(
                out["runtime"], offers=len(out["samples"]),
                refused_before_job_observed=(out.get("concurrency") or {})
                .get("resolutions", {}).get("refused_at_admission") if out.get("concurrency")
                else None)
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
            sp = real_metrics.get("admission_split") or {}
            if sp:
                print(f"  B1 over {sp.get('offers')} offer(s): served_in_slo "
                      f"{sp.get('served_in_slo')} · served_late {sp.get('served_late')} · "
                      f"refused_by_admission {sp.get('refused_by_admission')} "
                      f"({sp.get('refused_before_job_row')} before any job row) · "
                      f"failed {sp.get('failed')} {sp.get('failed_by_class')} · "
                      f"{'ARITHMETIC CLOSES' if sp.get('closes') else 'DOES NOT CLOSE'}"
                      + (f" — {sp['refused_before_job_row_mismatch']}"
                         if sp.get("refused_before_job_row_mismatch") else "")
                      + (f" — unresolved {sp.get('unresolved')}" if sp.get("unresolved") else ""))
        else:
            code, reasons = verdict(stats, kinds, min_samples=args.min_samples)
    except Exception as e:  # noqa: BLE001
        code, reasons = INCONCLUSIVE, [f"the run did not complete: {type(e).__name__}: {e}"]
    print(totals_line(stats, kinds, meta, code, reasons))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
