"""The Wisdom Loop's single wiring point (docs/wisdom/CONTRACTS.md §2.1).

api/main.py calls exactly three things here — init_stores(), register_jobs()
and routers() — so the parallel build streams never edit main.py. Each package
contributes through its own jobs.py (JOBS), schema.py (MIGRATIONS) and
api/routers/wisdom_<pkg>.py (router / internal_router).

run_job() is the only place a Wisdom job runs, scheduled or on demand. The
master switch, the job's kill switch, the durable claim, the run row, the
heartbeat and the failure page all live here, so no single job can forget one.
"""
from __future__ import annotations

import importlib
import json
import logging
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Optional

log = logging.getLogger(__name__)

PACKAGES = ("core", "capture", "sources", "extract", "evals", "publish")

_BOOT_WALL = time.time()
_RUNNING_CLAIM_STALE_S = 6 * 3600
_FAILED_RETRY_AFTER_S = 30 * 60
_SCHEDULER_HEAD_START_S = 120
_LOG_LINES_MAX = 200
_RESULT_JSON_MAX = 200_000


@dataclass(frozen=True)
class JobSpec:
    job_id: str
    fn: Callable[["JobContext"], dict]
    trigger: dict
    enabled: Callable[[], bool]
    expected_every_s: int
    trading_days_only: bool = False
    due_key: Optional[Callable[[datetime], Optional[str]]] = None
    catch_up_grace_s: int = 0


@dataclass
class JobContext:
    job_id: str
    now_et: datetime
    due_key: Optional[str]
    force: bool
    dry_run: bool
    run_id: str
    lines: list = field(default_factory=list)

    def log(self, msg: str) -> None:
        if len(self.lines) < _LOG_LINES_MAX:
            self.lines.append(str(msg)[:500])
        log.info("[wisdom:%s] %s", self.job_id, msg)


# ── discovery ────────────────────────────────────────────────────────────────

def job_specs() -> list[JobSpec]:
    specs: list[JobSpec] = []
    seen: set[str] = set()
    for pkg in PACKAGES:
        mod_name = f"api.services.wisdom.{pkg}.jobs"
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            log.exception("[wisdom] cannot import %s; its jobs are not registered", mod_name)
            continue
        for spec in getattr(mod, "JOBS", []):
            if not isinstance(spec, JobSpec) or not spec.job_id.startswith("wisdom_"):
                log.error("[wisdom] %s: invalid job spec %r (ignored)", mod_name, spec)
                continue
            if spec.job_id in seen:
                log.error("[wisdom] duplicate job id %s in %s (second ignored)", spec.job_id, mod_name)
                continue
            seen.add(spec.job_id)
            specs.append(spec)
    return specs


def find_spec(job_id: str) -> Optional[JobSpec]:
    for spec in job_specs():
        if spec.job_id == job_id:
            return spec
    return None


def schema_migrations() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for pkg in PACKAGES:
        mod_name = f"api.services.wisdom.{pkg}.schema"
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            log.exception("[wisdom] cannot import %s; its migrations are not applied", mod_name)
            continue
        for name, sql in getattr(mod, "MIGRATIONS", []):
            if not str(name).startswith(f"{pkg}_"):
                log.error("[wisdom] migration %r in %s must start with %r (skipped)", name, mod_name, f"{pkg}_")
                continue
            out.append((str(name), sql))
    return out


def routers() -> list:
    out = []
    for pkg in PACKAGES:
        mod_name = f"api.routers.wisdom_{pkg}"
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            log.exception("[wisdom] cannot import %s; its routes are not mounted", mod_name)
            continue
        for attr in ("router", "internal_router"):
            router = getattr(mod, attr, None)
            if router is not None:
                out.append(router)
    return out


def init_stores() -> dict:
    """Idempotent DDL for wisdom.db. Called unconditionally at boot.

    The owner-private store initialises itself on first use, so nothing here
    imports it (the private-store import ban allows no registry import)."""
    from api.services.wisdom.core import store

    return {"applied": store.init_db()}


# ── scheduling ───────────────────────────────────────────────────────────────

def _build_trigger(spec: JobSpec):
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    from api.services.wisdom.core.timeutil import ET

    kwargs = dict(spec.trigger)
    kind = kwargs.pop("kind", None)
    if kind == "cron":
        return CronTrigger(timezone=ET, **kwargs), 3600
    if kind == "interval":
        return IntervalTrigger(timezone=ET, **kwargs), 60
    raise ValueError(f"{spec.job_id}: unknown trigger kind {kind!r}")


def register_jobs(scheduler) -> list[str]:
    registered: list[str] = []
    for spec in job_specs():
        try:
            trigger, grace = _build_trigger(spec)
            scheduler.add_job(
                run_job,
                trigger=trigger,
                args=[spec.job_id],
                id=spec.job_id,
                name=spec.job_id,
                max_instances=1,
                replace_existing=True,
                coalesce=True,
                misfire_grace_time=grace,
            )
            registered.append(spec.job_id)
        except Exception:
            log.exception("[wisdom] could not register %s", spec.job_id)
    return registered


# ── running ──────────────────────────────────────────────────────────────────

def run_job(job_id: str, *, force: bool = False, dry_run: bool = False,
            now: Optional[datetime] = None) -> dict:
    """Run one job. Never raises (it runs on a shared scheduler thread)."""
    try:
        return _run_job(job_id, force=force, dry_run=dry_run, now=now)
    except Exception as exc:
        log.exception("[wisdom] run_job(%s) failed inside the registry", job_id)
        return {"job_id": job_id, "status": "failed", "error": f"registry: {type(exc).__name__}: {exc}"}


def _run_job(job_id: str, *, force: bool, dry_run: bool, now: Optional[datetime]) -> dict:
    from api.services.wisdom.core import flags, timeutil

    spec = find_spec(job_id)
    if spec is None:
        return {"job_id": job_id, "status": "unknown_job"}
    now = timeutil.to_et(now) if now is not None else timeutil.now_et()
    due_key = spec.due_key(now) if spec.due_key else None

    skip: Optional[str] = None
    if not force and not flags.ingest_enabled():
        skip = "master switch WISDOM_INGEST_ENABLED is off"
    elif not force and not spec.enabled():
        skip = "job kill switch is off"
    elif spec.trading_days_only and not force and not timeutil.is_trading_day(now.date()):
        skip = "not a trading day"

    return run_tracked(job_id, spec.fn, due_key=due_key, now=now, force=force, dry_run=dry_run,
                       skip=skip)


def run_tracked(job_id: str, fn: Callable[["JobContext"], dict], *, due_key: Optional[str] = None,
                now: Optional[datetime] = None, force: bool = False, dry_run: bool = False,
                skip: Optional[str] = None) -> dict:
    """Run ONE callable under this module's bookkeeping: the durable claim, the run row, the
    heartbeat and the failure page. `_run_job` is exactly this plus a JobSpec's gates.

    ⛔⛔ IT IS PUBLIC BECAUSE SOME WORK IS EVENT-TRIGGERED, NOT SCHEDULED (R70). Same-night
    scoring fires when a night's LAST extraction pass is reaped — there is no cron slot for "the
    batch finished" — and it still has to be claimed once per night, recorded in wisdom_job_runs
    where a morning check can read it, and paged when it fails. A second recorder beside this one
    would be the guard-repeated defect one artifact along: two places writing job history, free to
    drift, neither mutation-provable against the other.

    ⚠️ `due_key` IS THE SLOT AND IT IS THE CALLER'S TO NAME. A JobSpec derives it from `now`; the
    rider cannot — the reap that completes a night runs hours after the night's stamp was minted,
    so the slot is the NIGHT, which lives in the run ids, not on the clock.

    ⛔ It does NOT check any flag. Gates belong to whoever owns the work: `_run_job` applies the
    master switch and the spec's kill switch, and the reap rider inherits the reap job's own
    `WISDOM_EXTRACT_ENABLED` gate. Re-reading a flag here would be a second copy of a guard.

    A raise from `fn` is caught, recorded as a failed run and paged. An infrastructure failure
    (the store itself) propagates — `run_job` is the wrapper that turns that into a dict.
    """
    from api.services.wisdom.core import heartbeat, ids, store, timeutil

    now = timeutil.to_et(now) if now is not None else timeutil.now_et()
    run_id = ids.sha24(job_id, now.isoformat(), time.time_ns(), threading.get_ident())
    started = timeutil.iso_et(timeutil.now_et())

    claimed = False
    if skip is None and due_key is not None and not dry_run:
        skip = claim_slot(job_id, due_key, started)
        claimed = skip is None

    if skip is not None:
        if not dry_run:
            with store.write() as conn:
                heartbeat.beat(conn, job_id, "skipped", error=skip)
        return {"job_id": job_id, "status": "skipped", "reason": skip, "due_key": due_key}

    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_job_runs(run_id, job_id, due_key, started_at, status, forced, dry_run) "
            "VALUES (?, ?, ?, ?, 'running', ?, ?)",
            (run_id, job_id, due_key, started, int(force), int(dry_run)),
        )

    ctx = JobContext(job_id=job_id, now_et=now, due_key=due_key, force=force, dry_run=dry_run, run_id=run_id)
    status, result, error = "ok", {}, None
    try:
        out = fn(ctx)
        result = dict(out) if isinstance(out, dict) else {"result": out}
    except Exception as exc:
        status = "failed"
        error = f"{type(exc).__name__}: {exc}"[:2000]
        log.error("[wisdom] job %s failed: %s\n%s", job_id, error, traceback.format_exc())
    if ctx.lines:
        result.setdefault("log", ctx.lines)

    finished = timeutil.iso_et(timeutil.now_et())
    with store.write() as conn:
        conn.execute(
            "UPDATE wisdom_job_runs SET finished_at = ?, status = ?, result_json = ?, error = ? WHERE run_id = ?",
            (finished, status, _dumps(result), error, run_id),
        )
        if claimed:
            finish_slot(conn, job_id, due_key, status, finished)
        if not dry_run:
            heartbeat.beat(conn, job_id, status, error=error)
    if status == "failed":
        _page(f"wisdom_job_failed:{job_id}", f"Wisdom job {job_id} failed: {error}",
              {"run_id": run_id, "due_key": due_key})
    return {"job_id": job_id, "run_id": run_id, "status": status, "due_key": due_key,
            "result": result, "error": error}


def claim_slot(job_id: str, due_key: str, now_iso: str) -> Optional[str]:
    """Durable claim so two pods (deploy overlap) never both do one slot's work.

    Returns None when this caller now OWNS the slot, or the sentence saying why it does not.

    ⛔⛔ THIS ROW IS THE IDEMPOTENCE GUARD, and it is the only one. A caller may pre-filter slots
    it can already see are done — that is an optimisation and must be provable as one — but the
    INSERT ... ON CONFLICT below is what makes a second attempt a no-op, including a second
    attempt in another process that never saw the first.
    """
    from api.services.wisdom.core import store

    with store.write() as conn:
        row = conn.execute(
            "SELECT status, claimed_at FROM wisdom_job_claims WHERE job_id = ? AND due_key = ?",
            (job_id, due_key),
        ).fetchone()
        if row is not None:
            if row["status"] == "ok":
                return f"already done for {due_key}"
            if row["status"] == "running" and not _older_than(row["claimed_at"], _RUNNING_CLAIM_STALE_S):
                return f"already running for {due_key}"
        conn.execute(
            "INSERT INTO wisdom_job_claims(job_id, due_key, claimed_at, finished_at, status) "
            "VALUES (?, ?, ?, NULL, 'running') "
            "ON CONFLICT(job_id, due_key) DO UPDATE SET claimed_at = excluded.claimed_at, "
            "finished_at = NULL, status = 'running'",
            (job_id, due_key, now_iso),
        )
    return None


def finish_slot(conn, job_id: str, due_key: str, status: str, finished_at: str) -> None:
    """Close a claim this caller took. ⛔ Written here so the claim's two statements have ONE
    owner — a second UPDATE elsewhere is how a slot comes to be left 'running' forever."""
    conn.execute(
        "UPDATE wisdom_job_claims SET finished_at = ?, status = ? WHERE job_id = ? AND due_key = ?",
        (finished_at, status, job_id, due_key),
    )


# ── catch-up and watchdog (run by core/jobs.py) ─────────────────────────────

def catch_up(now: Optional[datetime] = None) -> dict:
    """Run cron slots the in-memory scheduler never fired (a deploy across the
    slot), within each job's catch_up_grace_s. The durable claim makes this safe
    to overlap with the scheduler's own fire."""
    from apscheduler.triggers.cron import CronTrigger

    from api.services.wisdom.core import flags, store, timeutil

    now = timeutil.to_et(now) if now is not None else timeutil.now_et()
    if not flags.ingest_enabled():
        return {"ran": [], "considered": 0, "reason": "master switch off"}
    ran, considered = [], 0
    for spec in job_specs():
        if spec.catch_up_grace_s <= 0 or spec.due_key is None or spec.trigger.get("kind") != "cron":
            continue
        if not spec.enabled():
            continue
        considered += 1
        kwargs = {k: v for k, v in spec.trigger.items() if k != "kind"}
        trigger = CronTrigger(timezone=timeutil.ET, **kwargs)
        fire = trigger.get_next_fire_time(None, now - timedelta(seconds=spec.catch_up_grace_s))
        last_due = None
        while fire is not None and fire <= now:
            last_due = fire
            fire = trigger.get_next_fire_time(fire, fire + timedelta(seconds=1))
        if last_due is None or (now - last_due).total_seconds() < _SCHEDULER_HEAD_START_S:
            continue
        key = spec.due_key(last_due)
        if key is None:
            continue
        with store.read() as conn:
            row = conn.execute(
                "SELECT status, claimed_at, finished_at FROM wisdom_job_claims WHERE job_id = ? AND due_key = ?",
                (spec.job_id, key),
            ).fetchone()
        if row is not None:
            if row["status"] == "ok":
                continue
            if row["status"] == "running" and not _older_than(row["claimed_at"], _RUNNING_CLAIM_STALE_S):
                continue
            if row["status"] == "failed" and not _older_than(row["finished_at"], _FAILED_RETRY_AFTER_S):
                continue
        out = run_job(spec.job_id, now=last_due)
        ran.append({"job_id": spec.job_id, "due_key": key, "status": out.get("status")})
    return {"ran": ran, "considered": considered}


def watchdog(now: Optional[datetime] = None) -> dict:
    """Page once per episode when an ENABLED job has not succeeded for two of
    its expected periods (non-trading days excluded for trading-day jobs)."""
    from api.services.wisdom.core import flags, heartbeat, store, timeutil

    now = timeutil.to_et(now) if now is not None else timeutil.now_et()
    if not flags.ingest_enabled():
        return {"checked": 0, "overdue": [], "paged": [], "reason": "master switch off"}
    with store.read() as conn:
        beats = {r["job_id"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_job_heartbeats")}
    boot = timeutil.to_et(datetime.fromtimestamp(_BOOT_WALL, tz=timeutil.ET))
    checked, overdue, paged = 0, [], []
    for spec in job_specs():
        if spec.job_id == "wisdom_core_watchdog" or not spec.enabled():
            continue
        checked += 1
        hb = beats.get(spec.job_id) or {}
        last_ok = timeutil.parse_iso(hb.get("last_ok_at"))
        reference = max(last_ok, boot) if last_ok else boot
        allowed = 2 * spec.expected_every_s
        if spec.trading_days_only:
            allowed += 86400 * timeutil.non_trading_days_between(reference.date(), now.date())
        age = (now - reference).total_seconds()
        if age <= allowed:
            continue
        overdue.append(spec.job_id)
        if hb.get("alerted_at"):
            continue
        _page(
            f"wisdom_job_missed:{spec.job_id}",
            f"Wisdom job {spec.job_id} has not succeeded for {int(age // 60)} min "
            f"(allowed {int(allowed // 60)} min)",
            {"last_ok_at": hb.get("last_ok_at"), "last_status": hb.get("last_status")},
        )
        with store.write() as conn:
            heartbeat.mark_alerted(conn, spec.job_id, timeutil.iso_et(now))
        paged.append(spec.job_id)
    return {"checked": checked, "overdue": overdue, "paged": paged}


# ── helpers ──────────────────────────────────────────────────────────────────

def _older_than(iso_value: Optional[str], seconds: int) -> bool:
    from api.services.wisdom.core import timeutil

    parsed = timeutil.parse_iso(iso_value)
    if parsed is None:
        return True
    return (timeutil.now_et() - parsed).total_seconds() > seconds


def _page(key: str, message: str, metadata: dict) -> None:
    try:
        from api.services import chart_health_alerts

        chart_health_alerts.emit(key, "critical", message, metadata)
    except Exception:
        log.exception("[wisdom] could not page %s", key)


def _dumps(value: dict) -> str:
    text = json.dumps(value, default=str, ensure_ascii=False)
    if len(text) > _RESULT_JSON_MAX:
        text = json.dumps({"truncated": True, "head": text[:_RESULT_JSON_MAX]}, ensure_ascii=False)
    return text
