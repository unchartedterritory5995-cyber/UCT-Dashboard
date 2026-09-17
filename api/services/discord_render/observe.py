"""Observability for the V2 path: structured events, SLOs from the durable jobs table,
the render-health payload, and alert rules. Step 2.2 of docs/discord-render/03-architecture.md.

Three rules this module exists to keep:

1. **Metrics come from the jobs table, never from process memory.** `web` served a median of
   8.4 minutes per deployment over 2026-08-30..09-13; an in-memory counter on that pod
   resets before it can say anything, and reads as health straight through an outage.
2. **Every event line carries the word `drender`.** Railway's log search cannot match a
   bracketed prefix (`"[flow]"` returns nothing — measured), so the searchable token is a
   bare word, and `tools/railway_env_logs.py --filter drender` finds every V2 event.
3. **No token, webhook path or query string is ever logged.** The chart-renderer logged the
   render token in plaintext on every page-load timeout for two weeks (C-13). Values are
   scrubbed here, at the one place events are written.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from contextlib import contextmanager

from api.services.discord_render import contract

log = logging.getLogger("discord_render")

EVENT_TOKEN = "drender"
WINDOWS = {"1h": 3600, "24h": 86400, "7d": 7 * 86400}          # what health reports
ALERT_WINDOWS = {"5m": 300, "30m": 1800, "1h": 3600}           # what the alert rules read (03 §3.9)
STUCK_AFTER_S = 60
RENDERER_MISSES_TO_ALERT = 2
#: One blocked second is a third of the whole 3 s acknowledgement budget (§3.9, C-02).
LOOP_STALL_ALERT_MS = 1000.0
#: R34 tier 1 — a stall this large pages at ANY uptime.
#: ⛔ NOT a backstop above the boot range. The largest stall measured to date, 80,249 ms,
#: occurred on a SETTLED pod, and a 20,446 ms one on 2026-09-15 at uptime 670-893 s — both
#: BELOW the tier-2 floor. Tier 1 is the working path for that class.
#:
#: ⭐⭐ R51 (owner ruling, D-15, 2026-09-17): THIS IS THE DISCORD ACK BUDGET, 3,000 ms.
#: Discord closes an interaction at 3 s, so ANY block at or past 3 s is a CERTAIN
#: member-visible failure — not a risk of one — and pages regardless of uptime. It was
#: 5,000 ms, and the gap was measured: a 3,572.1 ms block at uptime 281 s on 2026-09-17
#: scored tier=null, paged nobody, and would have killed an ack. A threshold above the
#: budget cannot page for the failure it exists to catch.
#:
#: ⛔⛔ R35 STILL STANDS, AND THIS DOES NOT BEND IT. R35 forbids RAISING a threshold to
#: quiet a symptom; this LOWERS one to hear more. The two directions are not symmetric:
#: lowering costs noise and buys signal, raising buys silence and costs the defect. Raising
#: this number remains permitted only in a directive that cites the fix which removed the
#: cause (OI-44 / R52).
LOOP_STALL_PAGE_ALWAYS_MS = 3000.0
#: R34 tier 2 — below this uptime, a >= LOOP_STALL_ALERT_MS stall is recorded and counted but
#: never paged. Q6's startup verdict, operationalised: the last >= 1 s startup-class event
#: observed on a settled pod was at minute 12.9.
LOOP_STALL_PAGE_UPTIME_FLOOR_S = 900.0
#: Per-key page cooldown. ⛔ Held on the VOLUME, not in memory: `chart_health_alerts`' own
#: `_discord_last` is per-process and this pod restarts ~20x/day, so an in-memory cooldown
#: cannot suppress anything across pods.
LOOP_STALL_PAGE_COOLDOWN_S = 1800.0
LOOP_NOISE_MS = 50.0

_SECRETISH = re.compile(r"(token=[^&\s]+|/webhooks/\d+/[A-Za-z0-9_\-.]+|[?&][A-Za-z_]+=[^&\s]*)")
_FIELDS = ("cid", "cmd", "sym", "tf", "hop", "ms", "outcome", "cls", "attempt", "status", "detail", "lane", "state", "key")
ALERT_WEBHOOK_ENV = "DISCORD_RENDER_ALERT_WEBHOOK"


def scrub(value):
    """Strip anything shaped like a credential or a query string from a logged value."""
    if isinstance(value, str):
        return _SECRETISH.sub("[redacted]", value)[:300]
    return value


def event(evt: str, **fields) -> dict:
    """Emit one structured event line and return the dict (tests read the return)."""
    payload = {"t": EVENT_TOKEN, "evt": evt}
    for k in _FIELDS:
        v = fields.get(k)
        if v is not None:
            payload[k] = round(v, 1) if isinstance(v, float) else scrub(v)
    log.info("%s %s", EVENT_TOKEN, json.dumps(payload, separators=(",", ":"), default=str))
    return payload


@contextmanager
def hop(cid: str, name: str, **fields):
    """Time one hop and emit `evt=hop` with its ms, even when the hop raises."""
    started = time.perf_counter()
    status = "ok"
    try:
        yield
    except Exception:
        status = "error"
        raise
    finally:
        event("hop", cid=cid, hop=name, ms=(time.perf_counter() - started) * 1000.0, status=status, **fields)


def scrub_text(text: str) -> str:
    """`scrub` for long text (a traceback): every credential-shaped span removed, nothing cut."""
    return _SECRETISH.sub("[redacted]", str(text or ""))


def exception(evt: str, **fields) -> dict:
    """Log the exception being handled as an event plus its SCRUBBED traceback.

    ⛔ Never `log.exception` on this path. An httpx error's traceback carries the request URL,
    and for a Discord edit that URL is `/webhooks/<app>/<interaction token>/messages/@original`
    — `log.exception` would write a live 15-minute bearer credential to the logs, which is the
    renderer-token leak (C-13) in a new place."""
    import sys
    import traceback
    exc = sys.exc_info()[1]
    payload = event(evt, detail=f"{type(exc).__name__}: {scrub_text(exc)}"[:300] if exc else None, status="error", **fields)
    tb = scrub_text("".join(traceback.format_exc()))
    log.error("%s traceback cid=%s\n%s", EVENT_TOKEN, fields.get("cid"), tb)
    return payload


# ── SLOs from the jobs table ────────────────────────────────────────────────

def pct(values, p: float):
    """Nearest-rank percentile (rank = ceil(p/100 * n)); None for no samples.
    ⛔ Not round(): Python rounds half to even, which made the median of two samples the
    max in the first version of the bench."""
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return None
    rank = max(1, min(len(xs), math.ceil((p / 100.0) * len(xs))))
    return xs[rank - 1]


def _summary(rows: list[dict]) -> dict:
    terminal = [r for r in rows if r.get("state") in ("delivered", "messaged", "abandoned", "superseded")]
    user_errors = [r for r in terminal if r.get("failure_class") in contract.USER_ERROR_CLASSES]
    counted = [r for r in terminal if r not in user_errors]
    delivered = [r for r in counted if r.get("state") == "delivered"]
    failures = [r for r in counted if r.get("state") != "delivered"]
    by_class: dict = {}
    for r in failures:
        k = r.get("failure_class") or "unclassified"
        by_class[k] = by_class.get(k, 0) + 1
    acks = [r.get("ack_ms") for r in rows]
    finals = [r.get("final_ms") for r in delivered]
    return {
        "jobs": len(rows), "terminal": len(terminal), "user_errors": len(user_errors),
        "delivered": len(delivered),
        "success_rate": round(len(delivered) / len(counted), 4) if counted else None,
        "image_rate": round(sum(1 for r in delivered if r.get("quality") == "image") / len(delivered), 4) if delivered else None,
        "ack_ms": {"p50": pct(acks, 50), "p95": pct(acks, 95), "p99": pct(acks, 99),
                   "over_3s": sum(1 for a in acks if a is not None and a > 3000)},
        "final_ms": {"p50": pct(finals, 50), "p95": pct(finals, 95), "p99": pct(finals, 99),
                     "over_15s": sum(1 for f in finals if f is not None and f > 15000)},
        "resumed": sum(1 for r in rows if r.get("resumed")),
        "failures_by_class": by_class,
    }


def slo_snapshot(store, now: float | None = None, windows: tuple[str, ...] | None = None) -> dict:
    """Per-command SLO summary for 5 min / 30 min / 1 h / 24 h / 7 d (or just `windows`), plus
    the most recent failures by id. The observer asks for the alert windows only: it runs every
    minute."""
    now = now or time.time()
    spans = {**ALERT_WINDOWS, **WINDOWS}
    wanted = {label: spans[label] for label in (windows or tuple(spans))}
    rows = store.recent(max(wanted.values()), limit=50_000)
    out: dict = {"windows": {}}
    for label, seconds in wanted.items():
        in_window = [r for r in rows if r.get("created_at", 0) >= now - seconds]
        commands: dict = {}
        for r in in_window:
            commands.setdefault(r.get("command") or "?", []).append(r)
        out["windows"][label] = {"all": _summary(in_window), "by_command": {c: _summary(rs) for c, rs in sorted(commands.items())}}
    recent_failures = [r for r in rows if r.get("state") in ("messaged", "abandoned")
                       and r.get("failure_class") not in contract.USER_ERROR_CLASSES]
    out["last_failures"] = [{"cid": r["corr_id"], "command": r.get("command"), "class": r.get("failure_class"),
                             "at": r.get("created_at"), "detail": scrub(r.get("detail") or "")}
                            for r in sorted(recent_failures, key=lambda r: r.get("created_at", 0), reverse=True)[:10]]
    out["stuck"] = len(store.stuck(STUCK_AFTER_S))
    return out


# ── alert rules (03 §3.9) ───────────────────────────────────────────────────

def _loop_alerts(loop: dict | None) -> list[tuple[str, str]]:
    """The ONE event loop being blocked (C-02, step 2.4b P2.9).

    ⛔ A STALL IS INVISIBLE TO EVERY OTHER RULE HERE. They all read the durable jobs table, and a
    loop blocked before the ack means there is no job row to read — the outage that produced
    C-02's 37x co-occurrence would leave this file silent.

    ⛔ THE THRESHOLD IS THE MAXIMUM, NOT A PERCENTILE OF A PERCENTILE. Discord closes the request
    at 3 s; one stall past ~1 s has already eaten a third of the whole acknowledgement budget,
    whatever the rest of the window looked like."""
    if not loop or not loop.get("samples"):
        return []                          # a probe that did not run reports nothing, not "fine"
    worst = loop.get("max_ms") or 0
    if worst < LOOP_STALL_ALERT_MS:
        return []
    return [("loop_stalled",
             f"The event loop was blocked for {worst:.0f} ms (worst of {loop['samples']} probes); "
             f"{loop.get('stalls') or 0} reading(s) over {int(LOOP_NOISE_MS)} ms. Discord closes an "
             "interaction at 3,000 ms, and the renderer's page load fails in the same window (C-02).")]


def _breaker_alerts(snapshot: dict | None) -> list[tuple[str, str]]:
    """One alert per OPEN dependency breaker (§3.8, step 2.4b P2.4).

    ⛔ ONE KEY PER DEPENDENCY. A single "a breaker is open" key would let a long renderer
    outage silence the first alert about flow-worker going down — two different outages, two
    different people to wake, and the durable cooldown is per key.

    ⛔ `half_open` IS NOT AN ALERT. It means the cooldown elapsed and the next caller gets the
    probe — the system recovering, exactly as designed. Paging on recovery is how a channel
    gets muted, and then it is quiet on the day it matters.

    ⛔ AND THERE IS DELIBERATELY NO "RECOVERED" PUSH. Breaker state is per-process and this
    pod's median deployment served 8.4 minutes (C-01), so a recovery computed from in-memory
    previous state would simply never fire across a restart — the rotating-sample suppression
    defect CLAUDE.md records, which produced pages nobody could act on. The alert repeats on
    its durable cooldown while the breaker stays open, and SILENCE is the recovery signal. The
    message says so, because otherwise silence reads as "the alerting broke"."""
    out = []
    for name, b in sorted((snapshot or {}).items()):
        if (b or {}).get("state") != "open":
            continue
        held = b.get("opened_for_s")
        out.append((f"breaker_open:{name}",
                    f"{name} breaker OPEN"
                    + (f" for {held:.0f}s" if isinstance(held, (int, float)) else "")
                    + f" after {b.get('recent_failures', 0)} failure(s) in the last"
                      f" {b.get('recent_calls', 0)} call(s); trip #{b.get('trips', 0)}."
                    f" {b.get('short_circuits', 0)} request(s) refused without waiting."
                    " This repeats while it stays open — silence means it closed."))
    return out


def evaluate_alerts(snapshot: dict, *, renderer_misses: int = 0,
                    breakers: dict | None = None) -> list[tuple[str, str]]:
    """(alert_key, message) for every rule breached right now (03-architecture §3.9). Pure:
    sending and the durable cooldown are the caller's (`Observer`, `JobsStore.alert_due`).

    Each rule reads the spec's window, not one hour for everything: five failures in five
    minutes diluted into an hour read as noise, and an hour's p95 still carries a slow spell
    50 minutes after it ended. `renderer_misses` counts CONSECUTIVE not-ready probes — one miss
    is a blip, two are an outage."""
    alerts = []
    w = snapshot["windows"]
    five, half, hour = w["5m"]["all"], w["30m"]["all"], w["1h"]["all"]
    if half["jobs"] >= 10 and (half["final_ms"]["p95"] or 0) > 8000:
        alerts.append(("slo_final_p95", f"Delivery p95 {half['final_ms']['p95']:.0f} ms over the last 30 minutes (SLO 5,000 ms, alert at 8,000)."))
    counted = hour["terminal"] - hour["user_errors"]
    if counted >= 20 and hour["success_rate"] is not None and hour["success_rate"] < 0.995:
        alerts.append(("slo_success", f"Success {hour['success_rate'] * 100:.1f}% over the last hour across {counted} jobs (SLO 99.5%)."))
    if hour["ack_ms"]["over_3s"]:
        alerts.append(("ack_over_3s", f"{hour['ack_ms']['over_3s']} acknowledgement(s) over 3 s in the last hour — Discord will have failed them."))
    if snapshot.get("stuck"):
        alerts.append(("stuck_jobs", f"{snapshot['stuck']} job(s) still not terminal after {STUCK_AFTER_S} s."))
    if renderer_misses >= RENDERER_MISSES_TO_ALERT:
        alerts.append(("renderer_not_ready", f"chart-renderer not ready on {renderer_misses} consecutive probes."))
    alerts += _breaker_alerts(breakers)
    alerts += _loop_alerts(snapshot.get("loop"))
    burst = sum(five["failures_by_class"].values())
    if burst >= 5:
        classes = ", ".join(f"{k}×{v}" for k, v in sorted(five["failures_by_class"].items(), key=lambda kv: -kv[1]))
        alerts.append(("failure_burst", f"{burst} failures in the last 5 minutes: {classes}."))
    return alerts


def _live_loop() -> dict:
    """The loop-stall reading this process holds."""
    try:
        from api.services.discord_render import loopwatch
        return loopwatch.snapshot()
    except Exception:  # noqa: BLE001 — observability must never be the thing that breaks
        return {}


def _live_token_slots() -> dict:
    """Which render-token slot senders are presenting (R29) — the evidence OI-13 step 6 waits on.

    ⛔ Slot names and counts only. Never a value, a length, or a hash of one (C-13)."""
    try:
        from api.services.discord_render import token_slots
        return token_slots.snapshot()
    except Exception:  # noqa: BLE001
        return {}


def _live_stall_record() -> dict:
    """The DURABLE stall record (R30), beside the trailing window — never instead of it.

    ⛔ The window answers "is the loop stalling right now"; the record answers "how often, how
    big, and when" across a pod's whole life and across pods, which the window structurally
    cannot (it forgets everything older than ~5 min, and this pod restarts ~20x/day)."""
    try:
        from api.services.discord_render import stall_record
        return stall_record.snapshot()
    except Exception:  # noqa: BLE001
        return {}


def _live_breakers() -> dict:
    """The breakers this process holds. ⭐ ONE source for both the push and the pull, so an
    operator reading /renderhealth cannot see something the alert disagrees with."""
    try:
        from api.services.discord_render import breakers as breakers_mod
        return breakers_mod.snapshot_all()
    except Exception:  # noqa: BLE001 — observability must never be the thing that breaks
        return {}


def health_payload(runtime, store, *, renderer: dict | None = None, now: float | None = None,
                   renderer_misses: int | None = None, breakers: dict | None = None) -> dict:
    """What `/renderhealth` and GET /api/discord/render-health print. `renderer_misses` is the
    observer's consecutive count when there is one; a lone reading counts as one miss at most,
    so `alerts` here is exactly what the observer would page on."""
    snap = slo_snapshot(store, now=now)
    snap["loop"] = _live_loop()
    snap["stall_record"] = _live_stall_record()
    snap["token_slots"] = _live_token_slots()
    if renderer_misses is None:
        renderer_misses = 1 if renderer is not None and renderer.get("ready") is False else 0
    # ⛔⛔ THE CANARY SCOPE, READ OUT OF THE RUNNING PROCESS (A3).
    # `railway variables --kv` shows what a service is CONFIGURED with, which is not evidence the
    # running process has it — this project has measured a pod returning None for a variable `--kv`
    # reported as set. `/renderhealth` runs INSIDE the process, so the list it prints is the list
    # actually in force, and it is the only read that can settle "is the canary still admin-only?"
    # ⚠️ An EMPTY tuple is not "off". Unset means V2 answers in EVERY channel, so the payload says
    # `"all"` in that case rather than `[]`, which a reader would misread as "narrowed to nothing".
    from api.services.discord_render import commands as _cmds
    _chans = _cmds.v2_channels()
    return {
        "commit": (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12],
        "owner": getattr(runtime, "owner", None),
        "v2_enabled": _cmds.enabled(),
        "v2_channels": list(_chans) if _chans else "all",
        "queue": runtime.depth() if runtime is not None else None,
        "renderer": renderer,
        "slo": snap,
        # ⛔⛔ MIRRORED FROM `snap`, NEVER RECOMPUTED — one reading, two views. `evaluate_alerts`
        # consumes the copy inside `slo`; every human and every instrument reads the TOP level,
        # because that is where the no-jobs-database branch of `render_health` puts them.
        # ⚰️ Until 2026-09-17 the two branches disagreed about the SHAPE, and that is what made
        # OI-47 hard to see rather than merely wrong: on a production pod (no jobs database)
        # `d.get("loop")` answers, and `d.get("stall_record")` answers nothing; the day V2 is
        # enabled and a jobs database exists, `d.get("loop")` would START answering None and
        # every poller reading the top level would go quietly blind — a LATENT failure armed to
        # fire on exactly the deploy nobody wants surprises on.
        "loop": snap["loop"],
        "stall_record": snap["stall_record"],
        "token_slots": snap["token_slots"],
        "breakers": breakers if breakers is not None else _live_breakers(),
        "alerts": [k for k, _ in evaluate_alerts(
            snap, renderer_misses=renderer_misses,
            breakers=breakers if breakers is not None else _live_breakers())],
    }


def _secs(ms) -> str:
    return "—" if ms is None else f"{ms / 1000.0:.1f}s"


def _window_line(label: str, s: dict) -> str:
    if not s or not s.get("jobs"):
        return f"{label}: no jobs"
    rate = "—" if s["success_rate"] is None else f"{s['success_rate'] * 100:.1f}%"
    f = s["final_ms"]
    return (f"{label}: {s['jobs']} jobs · success {rate} · delivered p50 {_secs(f['p50'])} p95 {_secs(f['p95'])} "
            f"p99 {_secs(f['p99'])} · acks over 3s {s['ack_ms']['over_3s']} · resumed {s['resumed']}")


def format_health_text(payload: dict) -> str:
    """The /renderhealth reply: plain text inside Discord's 2,000-character limit."""
    q = payload.get("queue")
    r = payload.get("renderer")
    if r is None:
        renderer = "not configured"
    elif r.get("ready") is None:
        renderer = r.get("note") or "unknown"
    elif r.get("ready"):
        renderer = "ready"
    else:
        renderer = f"NOT READY ({r.get('error') or r.get('status') or 'no answer'})"
    slo = payload.get("slo") or {}
    win = slo.get("windows") or {}
    # ⭐ The scope line is SECOND, right under the commit, because it is the line an operator needs
    # before they trust anything else on the screen: every number below is about whichever channels
    # this says. "all" is spelled out rather than shown as an empty list.
    chans = payload.get("v2_channels")
    scope = ("every channel" if chans == "all" or not chans
             else " ".join(f"<#{c}>" for c in chans))
    lines = [f"Render V2 · commit {payload.get('commit') or '?'} · {payload.get('owner') or 'runtime not started'}",
             f"Scope: V2 {'ON' if payload.get('v2_enabled') else 'OFF'} · {scope}",
             (f"Queue: {q.get('interactive', 0)} waiting · {q.get('active', 0)} active of {q.get('workers', 0)} workers"
              f" · background {q.get('background', 0)}") if q else "Queue: runtime not started",
             f"Renderer: {renderer}"]
    lines += [_window_line(label, win[label]["all"]) for label in WINDOWS if label in win]
    classes = ((win.get("1h") or {}).get("all") or {}).get("failures_by_class") or {}
    lines.append("Failures (1h): " + (", ".join(f"{k}×{v}" for k, v in sorted(classes.items(), key=lambda kv: -kv[1]))
                                       or "none"))
    lines.append(f"Stuck: {slo.get('stuck', 0)} · Alerts: {', '.join(payload.get('alerts') or []) or 'none'}")
    fails = slo.get("last_failures") or []
    if fails:
        lines.append("Recent failures: " + " · ".join(f"{f['cid']} {f.get('command')} {f.get('class')}" for f in fails[:5]))
    return "\n".join(lines)[:1900]


# ── alert delivery + the slow loop ──────────────────────────────────────────

def post_webhook(url: str, content: str, timeout_s: float = 5.0) -> bool:
    """POST one plain message. Never raises. Never logs the URL: a webhook URL is a credential."""
    try:
        import httpx
        r = httpx.post(url, json={"content": content[:2000], "allowed_mentions": {"parse": []}}, timeout=timeout_s)
        if not r.is_success:
            event("alert_send_refused", status=str(r.status_code))
        return bool(r.is_success)
    except Exception as e:  # noqa: BLE001
        event("alert_send_error", detail=type(e).__name__)
        return False


class Observer:
    """The slow loop beside the 1 s watchdog: alert rules every `interval_s`, the durable
    cooldown, the jobs-table purge, and a cached renderer reading for /renderhealth.

    Its own thread because the renderer probe is an HTTP call with a 2 s budget, and the
    watchdog's deadline check must never wait behind it.

    ⛔ An alert is recorded as sent only AFTER Discord accepted it: recording first would turn
    one failed POST into a 30-minute silence about the breach in progress. With no webhook
    configured the alert is still a log event under the same cooldown — a blank
    DISCORD_RENDER_ALERT_WEBHOOK is quiet in Discord, not in the logs."""

    def __init__(self, store, *, renderer_fn=None, post_fn=post_webhook, webhook_fn=None,
                 interval_s: float = 60.0, cooldown_s: float = 1800.0, purge_every_s: float = 3600.0,
                 commit: str = ""):
        self.store = store
        self.renderer_fn = renderer_fn
        self.post_fn = post_fn
        self.webhook_fn = webhook_fn or (lambda: (os.environ.get(ALERT_WEBHOOK_ENV) or "").strip())
        self.interval_s = interval_s
        self.cooldown_s = cooldown_s
        self.purge_every_s = purge_every_s
        self.commit = commit
        self.renderer: dict | None = None
        self.renderer_at: float | None = None
        self.renderer_misses = 0
        self._last_purge = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def run_once(self, now: float | None = None) -> dict:
        now = now or time.time()
        out: dict = {"breached": [], "sent": [], "logged": [], "failed": [], "purged": None}
        if self.renderer_fn is not None:
            try:
                self.renderer = self.renderer_fn()
            except Exception as e:  # noqa: BLE001 — a crashed probe is a renderer we could not reach
                self.renderer = {"reachable": False, "ready": False, "error": type(e).__name__}
            self.renderer_at = now
            missed = self.renderer is not None and self.renderer.get("ready") is False
            self.renderer_misses = self.renderer_misses + 1 if missed else 0
        webhook = self.webhook_fn()
        snap = slo_snapshot(self.store, now=now, windows=tuple(ALERT_WINDOWS))
        snap["loop"] = _live_loop()
        snap["stall_record"] = _live_stall_record()
        snap["token_slots"] = _live_token_slots()
        for key, msg in evaluate_alerts(snap, renderer_misses=self.renderer_misses,
                                        breakers=_live_breakers()):
            out["breached"].append(key)
            if not self.store.alert_due(key, self.cooldown_s, record=False):
                continue
            if not webhook:
                self.store.record_alert(key)
                event("alert", key=key, detail=msg, outcome="logged_only")
                out["logged"].append(key)
            elif self.post_fn(webhook, f"Discord render alert · {key} — {msg} · commit {self.commit or '?'}"
                                       " · GET /api/discord/render-health"):
                self.store.record_alert(key)
                event("alert", key=key, detail=msg, outcome="sent")
                out["sent"].append(key)
            else:
                event("alert", key=key, detail=msg, outcome="send_failed")
                out["failed"].append(key)
        if now - self._last_purge >= self.purge_every_s:
            out["purged"] = self.store.purge()
            self._last_purge = now
            event("purge", outcome=f"tokens_nulled={out['purged']['tokens_nulled']} rows_deleted={out['purged']['rows_deleted']}")
        return out

    def start(self) -> "Observer":
        if self._thread is None:
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="drender-observer", daemon=True)
            self._thread.start()
        return self

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self.run_once()
            except Exception:  # noqa: BLE001 — the loop must outlive one bad pass
                exception("observer_error")

    def stop(self) -> None:
        self._stop.set()
        self._thread = None
