r"""The durable loop-stall record, and the one alert that actually reaches a human (R30/R34, OI-45).

⚰️⚰️ **WHY THIS EXISTS, AND WHY THE EXISTING ALERT WAS NEVER ENOUGH.** `observe._loop_alerts`
has fired at `max_ms >= LOOP_STALL_ALERT_MS` since it was written, is unit-tested, and is
mutation-covered. It has **never been able to fire in production**. Its only evaluator is
`observe.Observer`, built in `commands.start()`, which `api/main.py` calls only inside
`if _render_v2.enabled():` — and V2 is dark on every production pod. OI-43 moved
`loopwatch.start()` above that gate so the WATCHER runs; the READER stayed inside it. We fixed
the instrument and left its only consumer dark (OI-45).

⛔ **SO THIS EMITS ON A PATH THAT IS NOT V2-GATED**: `chart_health_alerts.emit`, the same path
the buzz digest catch-up and the bars watchdog already use. A rail asserts the emission happens
with `DISCORD_RENDER_V2_ENABLED` unset; re-gating it behind `_render_v2.enabled()` is a RED
mutation, because that is precisely the bug this closes.

⛔⛔ **SEVERITY MUST BE "critical" OR NOTHING IS PAGED.** `chart_health_alerts._should_page_discord`
begins `if severity != "critical" or not webhook_present or not enabled: return False`. Anything
lower lands in an in-memory deque that dies with the pod and reaches nobody — which would
reproduce OI-45 in a new place: recorded, not told. The rail asserts the SEVERITY STRING.

⛔⛔ **NOTHING IN-PROCESS SURVIVES HERE.** Measured 2026-09-15: `web` deployed TWENTY times in
one day; the longest pod life was ~45 minutes. A ring buffer, a counter or a cooldown held in
module state is erased ~20x/day, so it can neither carry a frequency nor suppress a repeat.
`chart_health_alerts`' own 30-minute Discord cooldown is exactly this — a fresh pod starts with
an empty `_discord_last` and pages immediately. The record AND the cooldown therefore live on
the volume. This is the `fundamentals_monitor` defect_state pattern, and the third instance of
this class in one programme.

⛔ **PATHS RESOLVE THROUGH THEIR OWN ENV VAR WITH A /data DEFAULT** — the `AUTH_DB_PATH` idiom
(`auth_db.py:10`). The repo-root `conftest` derives its sandbox pins by AST over `api/**` looking
for exactly that shape; a hardcoded `"/data/..."` literal lands in `unpinnable`, trips the shared-
root tripwire under pytest, and — worse — writes into the owner's live `C:\data` on a bare local
run.

⭐ **WHY THE WRITE IS INLINE ON THE LOOP.** Appending one short line costs tens of microseconds
and happens ~30 times a DAY (measured: 29.7 stalls >= 1 s/day). Handing it to the shared anyio
threadpool would add pressure to the exact resource C-02 is about, to avoid a cost three orders
of magnitude below the thing being measured. The page is fire-and-forget by contract in
`chart_health_alerts._page_discord`.
"""
from __future__ import annotations

import json
import os
import pathlib
import threading
import time

#: Where the durable record lives. Own env var, /data default — see the module docstring.
RECORD_PATH_ENV = "RENDER_STALL_RECORD_PATH"
DEFAULT_RECORD_PATH = "/data/discord-render/stall-record.jsonl"

#: The durable page-cooldown state. A SIBLING of the record, not mixed into it: the record is
#: append-only evidence and the cooldown is mutable state, and one file cannot be both.
COOLDOWN_SUFFIX = ".page-cooldown.json"

#: Keep the record bounded. At ~30 events/day this is ~9 weeks of history.
MAX_RECORDS = 2000
ALERT_KEY = "loop_stalled"

_lock = threading.RLock()
_lifetime_max_ms = 0.0
_lifetime_count = 0
_below_floor_count = 0          # >= alert threshold but under the uptime floor: counted, never paged
_last_error: str | None = None


def _thresholds() -> tuple[float, float, float, float]:
    """(alert_ms, page_always_ms, page_floor_s, cooldown_s) — ONE authority, imported never copied.

    ⛔ N2: `LOOP_STALL_ALERT_MS` keeps its home in `observe`. A second literal here is the
    second-authority-over-one-value defect this repo has paid for repeatedly, and it would also
    silently break `mutation_harness_adapters`, which mutates the constant at its real home."""
    from api.services.discord_render import observe
    return (observe.LOOP_STALL_ALERT_MS,
            observe.LOOP_STALL_PAGE_ALWAYS_MS,
            observe.LOOP_STALL_PAGE_UPTIME_FLOOR_S,
            observe.LOOP_STALL_PAGE_COOLDOWN_S)


def record_path() -> pathlib.Path:
    """⛔⛔ THE `.get()` DEFAULT MUST BE AN INLINE LITERAL, NOT A NAME.

    `conftest.shared_data_root_census` derives its sandbox pins by AST, and derivation (A) is
    "the literal IS the `.get()` default". Written as `os.environ.get(RECORD_PATH_ENV,
    DEFAULT_RECORD_PATH)` — with both as module constants — the census cannot see it, the var
    lands in `unpinnable`, and the shared-root tripwire fires: three existing loopwatch tests
    went red with `os.mkdir -> c:\\data\\discord-render`, i.e. this module trying to write into
    the owner's LIVE data root from a unit test. Measured here, 2026-09-17, on the first run.

    ⭐ The tripwire caught it because a redirect alone hides the next offender — which is
    exactly why it exists beside the pins rather than instead of them."""
    return pathlib.Path(os.environ.get("RENDER_STALL_RECORD_PATH",
                                       "/data/discord-render/stall-record.jsonl"))


def cooldown_path() -> pathlib.Path:
    p = record_path()
    return p.with_name(p.name + COOLDOWN_SUFFIX)


def _read_cooldown() -> float:
    try:
        return float(json.loads(cooldown_path().read_text(encoding="utf-8")).get(ALERT_KEY, 0.0))
    except Exception:  # noqa: BLE001 — never-paged-before and unreadable are the same decision: page
        return 0.0


def _write_cooldown(now: float) -> None:
    try:
        p = cooldown_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(json.dumps({ALERT_KEY: now}), encoding="utf-8")
        os.replace(tmp, p)          # atomic: a torn cooldown file would page on every stall
    except Exception as e:  # noqa: BLE001
        global _last_error
        _last_error = f"cooldown_write: {e!r}"[:160]


def page_decision(overshoot_ms: float, uptime_s: float, *, last_page_at: float, now: float) -> dict:
    """PURE. The R34 two-tier rule, testable without a filesystem, a clock or a network.

    TIER 1  — `>= LOOP_STALL_PAGE_ALWAYS_MS` pages at ANY uptime.
              ⛔ Not a backstop above the boot range: the largest stall ever measured here,
              20,446 ms on 2026-09-15, occurred at uptime 670-893 s, BELOW the floor. Tier 1 is
              the working path for that class.
    TIER 2  — `>= LOOP_STALL_ALERT_MS` pages only past `LOOP_STALL_PAGE_UPTIME_FLOOR_S`.
    BELOW   — >= the alert threshold but under the floor and under tier 1: recorded and counted,
              never paged. That count is the per-boot cost evidence.
    """
    alert_ms, always_ms, floor_s, cooldown_s = _thresholds()
    if overshoot_ms < alert_ms:
        return {"record": False, "page": False, "tier": None, "reason": "below alert threshold"}
    if overshoot_ms >= always_ms:
        tier, want = 1, True
    elif uptime_s >= floor_s:
        tier, want = 2, True
    else:
        return {"record": True, "page": False, "tier": None, "reason": "below uptime floor"}
    if want and (now - last_page_at) < cooldown_s:
        return {"record": True, "page": False, "tier": tier,
                "reason": f"cooldown {cooldown_s:.0f}s (last {now - last_page_at:.0f}s ago)"}
    return {"record": True, "page": True, "tier": tier, "reason": f"tier {tier}"}


def _append(entry: dict) -> None:
    try:
        p = record_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(entry) + "\n")
        # Bound it. Cheap because it only runs when the file has grown past the cap.
        try:
            lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
            if len(lines) > MAX_RECORDS:
                p.write_text("\n".join(lines[-MAX_RECORDS:]) + "\n", encoding="utf-8", newline="\n")
        except Exception:  # noqa: BLE001 — rotation failing must never lose the append
            pass
    except Exception as e:  # noqa: BLE001
        global _last_error
        _last_error = f"append: {e!r}"[:160]


def note(overshoot_ms: float, *, uptime_s: float, commit: str = "", now: float | None = None) -> dict:
    """Called from `LoopWatch.record` for EVERY sample. Never raises into the event loop."""
    global _lifetime_max_ms, _lifetime_count, _below_floor_count
    out = {"recorded": False, "paged": False, "tier": None}
    try:
        now = time.time() if now is None else now
        alert_ms, _, _, _ = _thresholds()
        with _lock:
            if overshoot_ms > _lifetime_max_ms:
                _lifetime_max_ms = overshoot_ms
            if overshoot_ms < alert_ms:
                return out
            _lifetime_count += 1
        d = page_decision(overshoot_ms, uptime_s, last_page_at=_read_cooldown(), now=now)
        if not d["record"]:
            return out
        if d["tier"] is None:
            with _lock:
                _below_floor_count += 1
        _append({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                 "ms": round(overshoot_ms, 1), "uptime_s": round(uptime_s, 1),
                 "tier": d["tier"], "paged": bool(d["page"]), "commit": commit,
                 "pid": os.getpid()})
        out["recorded"] = True
        out["tier"] = d["tier"]
        if d["page"]:
            from api.services import chart_health_alerts
            msg = (f"The event loop was blocked for {overshoot_ms:.0f} ms at uptime "
                   f"{uptime_s:.0f}s (tier {d['tier']}). Discord closes an interaction at 3,000 ms "
                   f"and the renderer's page load fails in the same window (C-02).")
            # ⛔ "critical" is load-bearing — anything lower is recorded and never paged.
            emitted = chart_health_alerts.emit(ALERT_KEY, "critical", msg,
                                               {"ms": round(overshoot_ms, 1),
                                                "uptime_s": round(uptime_s, 1),
                                                "tier": d["tier"], "commit": commit})
            _write_cooldown(now)
            out["paged"] = bool(emitted)
    except Exception as e:  # noqa: BLE001 — observability must never be what breaks the loop
        global _last_error
        _last_error = f"note: {e!r}"[:160]
    return out


def snapshot() -> dict:
    """What the health payload carries beside the trailing window."""
    with _lock:
        out = {"lifetime_max_ms": round(_lifetime_max_ms, 1) if _lifetime_max_ms else 0.0,
               "lifetime_count": _lifetime_count,
               "below_floor_count": _below_floor_count,
               "path": str(record_path()),
               "last_error": _last_error}
    try:
        lines = record_path().read_text(encoding="utf-8", errors="replace").splitlines()
        out["recent"] = [json.loads(x) for x in lines[-50:] if x.strip().startswith("{")]
        out["total_recorded"] = len(lines)
    except FileNotFoundError:
        out["recent"], out["total_recorded"] = [], 0
    except Exception as e:  # noqa: BLE001
        out["recent"], out["total_recorded"] = [], None
        out["read_error"] = repr(e)[:120]
    return out


def _reset_for_tests() -> None:
    global _lifetime_max_ms, _lifetime_count, _below_floor_count, _last_error
    with _lock:
        _lifetime_max_ms, _lifetime_count, _below_floor_count, _last_error = 0.0, 0, 0, None
