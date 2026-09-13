"""The V2 job runtime: bounded queue, dedicated workers, durable leases, a deadline.

Guarantee this module exists to make (SLOs S3 and S7, docs/discord-render/03-architecture.md):
**every job ends in an artifact or a user-visible message, and in a terminal row** —
whatever the handler does, including raising, returning nothing, or taking forever.

Why each part exists (failure classes from 01-failure-forensics.md):
  * dedicated workers, not Starlette BackgroundTasks on the anyio pool — C-02: the web pod's
    one event loop and one 64-thread pool saturated, and acks and page loads failed together;
  * a durable lease per job and resume on boot — C-01: web's median deployment served 8.4
    minutes and a restart killed every in-flight job after 5 s of grace;
  * a deadline watchdog — S3: at 15 s with nothing delivered the member is told, with an id
    and a Retry button, while the job keeps running and may still replace the message;
  * a tracked edit — C-11: the old jobs ignored the PATCH result, so a failed delivery
    reported "ok".
"""
from __future__ import annotations

import logging
import os
import queue
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from api.services.discord_render import contract, observe
from api.services.discord_render import delivery as delivery_mod
from api.services.discord_render.jobs_store import TOKEN_LIFETIME_S, JobsStore

log = logging.getLogger("discord_render")

INTERACTIVE, BACKGROUND = "interactive", "background"
COMPONENT_INTERACTION = 3


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(os.environ.get(name, ""))
        return v if lo <= v <= hi else default
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float(os.environ.get(name, ""))
        return v if lo <= v <= hi else default
    except (TypeError, ValueError):
        return default


@dataclass
class Job:
    corr_id: str
    command: str                     # chart | flow | buzz | controls | popup | multi
    app_id: str
    token: str
    args: dict
    label: str
    user_id: str = ""
    guild_id: str = ""
    channel_id: str = ""
    interaction_id: str = ""
    interaction_type: int = 2
    ephemeral: bool = False
    lane: str = INTERACTIVE
    created_at: float = field(default_factory=time.time)
    deadline_s: float = 15.0
    resumed: bool = False

    def row(self) -> dict:
        return {"corr_id": self.corr_id, "interaction_id": self.interaction_id, "created_at": self.created_at,
                "command": self.command, "kind": "component" if self.interaction_type == COMPONENT_INTERACTION else "slash",
                "lane": self.lane, "args_json": {"args": self.args, "label": self.label},
                "user_id": self.user_id, "guild_id": self.guild_id, "channel_id": self.channel_id,
                "app_id": self.app_id, "token": self.token, "ephemeral": int(self.ephemeral),
                "interaction_type": self.interaction_type, "state": "queued", "resumed": int(self.resumed)}

    @classmethod
    def from_row(cls, row: dict) -> "Job":
        import json
        payload = json.loads(row.get("args_json") or "{}")
        return cls(corr_id=row["corr_id"], command=row["command"], app_id=row["app_id"] or "", token=row["token"] or "",
                   args=payload.get("args") or {}, label=payload.get("label") or "Request",
                   user_id=row.get("user_id") or "", guild_id=row.get("guild_id") or "",
                   channel_id=row.get("channel_id") or "", interaction_id=row.get("interaction_id") or "",
                   interaction_type=int(row.get("interaction_type") or 2), ephemeral=bool(row.get("ephemeral")),
                   lane=row.get("lane") or INTERACTIVE, created_at=float(row["created_at"]), resumed=True)


class JobContext:
    """What a handler gets: a tracked edit, a failure reporter, and the job."""

    def __init__(self, runtime: "JobRuntime", job: Job):
        self.runtime = runtime
        self.job = job
        self.started = time.time()
        self.image_ok = False
        self.text_ok = False
        self.first_image_at: float | None = None
        self.final_image_at: float | None = None
        self.failure_class: str | None = None
        self.failure_detail = ""
        self.messaged = False
        self.last_delivery_failure: delivery_mod.DeliveryResult | None = None
        self.edit_calls = 0
        self._lock = threading.Lock()

    # The edit a job function receives in place of `di.edit_original`.
    def edit(self, app_id, token, **kw):
        # held_by, not owns: a stand-in heal edits 45 s / 120 s after this job's row is
        # terminal, and must still land; a job another pod reclaimed must not.
        if not self.runtime.store.held_by(self.job.corr_id, self.runtime.owner):
            # A newer pod reclaimed this job; its result is the one the member gets.
            observe.event("edit_skipped_not_owner", cid=self.job.corr_id, cmd=self.job.command)
            return False
        has_image = kw.get("png") is not None or bool(kw.get("pngs"))
        sent = self.runtime.edit_fn(app_id, token, **kw)
        with self._lock:
            self.edit_calls += 1
            if sent:
                now = time.time()
                if has_image:
                    self.image_ok = True
                    self.first_image_at = self.first_image_at or now
                    self.final_image_at = now
                else:
                    self.text_ok = True
            else:
                self.last_delivery_failure = self.runtime.last_edit_failure()
        return sent

    def fail(self, cls: str, detail: str = "") -> bool:
        """Report a failure the member must see. Sends the contract message now."""
        self.failure_class = contract.normalize_class(cls)
        self.failure_detail = str(detail or "")[:200]
        ok = self.runtime.send_failure(self.job, self.failure_class)
        self.messaged = self.messaged or ok
        return ok


class JobRuntime:
    def __init__(self, *, store: JobsStore, handlers: dict[str, Callable[[JobContext], object]],
                 edit_fn: Callable, last_edit_failure: Callable[[], object] | None = None,
                 delivery=delivery_mod, workers: int | None = None, queue_max: int | None = None,
                 bg_max: int | None = None, per_user_max: int | None = None, lease_s: float = 20.0,
                 heartbeat_s: float = 5.0, owner: str | None = None, resume_max_age_s: float = 13.5 * 60,
                 commit: str = "", on_terminal: Callable[[Job, dict], None] | None = None):
        self.store = store
        self.handlers = handlers
        self.edit_fn = edit_fn
        self.last_edit_failure = last_edit_failure or (lambda: None)
        self.delivery = delivery
        self.workers = workers or _int_env("DISCORD_RENDER_WORKERS", 6, 1, 32)
        self.queue_max = queue_max or _int_env("DISCORD_RENDER_QUEUE_MAX", 48, 1, 1000)
        self.bg_max = bg_max if bg_max is not None else _int_env("DISCORD_RENDER_BG_MAX", 2, 0, 16)
        self.per_user_max = per_user_max or _int_env("DISCORD_RENDER_PER_USER_MAX", 2, 1, 16)
        self.lease_s = lease_s
        self.heartbeat_s = heartbeat_s
        self.resume_max_age_s = resume_max_age_s
        self.owner = owner or f"{socket.gethostname()}:{os.getpid()}:{int(time.time())}"
        self.commit = commit
        self.on_terminal = on_terminal
        self._inter: "queue.Queue[Job]" = queue.Queue(maxsize=self.queue_max)
        self._bg: "queue.Queue[Job]" = queue.Queue(maxsize=max(1, self.queue_max))
        self._writer: "queue.SimpleQueue" = queue.SimpleQueue()
        self._cv = threading.Condition()
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._active: dict[str, JobContext] = {}
        self._active_lock = threading.Lock()
        self._inflight: dict[str, int] = {}
        self._bg_running = 0
        self._deadline_sent: set[str] = set()
        self._last_beat = 0.0
        self.started = False

    # ── lifecycle ───────────────────────────────────────────────────────────
    def start(self) -> "JobRuntime":
        if self.started:
            return self
        self.started = True
        self._stop.clear()
        specs = [("drender-writer", self._writer_loop), ("drender-watch", self._watch_loop)]
        specs += [(f"drender-worker-{i}", self._worker_loop) for i in range(self.workers)]
        for name, target in specs:
            t = threading.Thread(target=target, name=name, daemon=True)
            t.start()
            self._threads.append(t)
        return self

    def stop(self, timeout: float = 2.0) -> int:
        """Stop taking work and hand every held lease back (next pod resumes at once)."""
        self._stop.set()
        with self._cv:
            self._cv.notify_all()
        self._writer.put(None)
        for t in self._threads:
            t.join(timeout=timeout / max(1, len(self._threads)))
        released = self.store.release_all(self.owner)
        self.started = False
        return released

    # ── the ack path: O(1), no I/O ──────────────────────────────────────────
    def offer(self, job: Job) -> tuple[str, int | None]:
        """("queued", position) | ("full", None) | ("user_busy", None). Never blocks."""
        if job.lane == INTERACTIVE and job.user_id and not job.resumed:
            with self._active_lock:
                if self._inflight.get(job.user_id, 0) >= self.per_user_max:
                    return ("user_busy", None)
        q = self._inter if job.lane == INTERACTIVE else self._bg
        try:
            q.put_nowait(job)
        except queue.Full:
            return ("full", None)
        with self._active_lock:
            if job.user_id:
                self._inflight[job.user_id] = self._inflight.get(job.user_id, 0) + 1
        self._writer.put(("insert", job.row()))
        with self._cv:
            self._cv.notify()
        return ("queued", q.qsize())

    def record_ack(self, corr_id: str, ack_ms: float) -> None:
        self._writer.put(("update", corr_id, {"ack_ms": round(ack_ms, 1)}))

    def record_refused(self, job: Job, cls: str) -> None:
        """A job refused at the ack (queue full) still gets a TERMINAL row: it is a failure
        the SLO must count, and its Retry button needs the stored args to re-run. Written
        by the writer thread — the ack path does no I/O. No token is kept: the refusal was
        the reply."""
        row = {**job.row(), "state": "messaged", "token": None, "failure_class": cls, "outcome": "refused_at_ack"}
        self._writer.put(("insert", row))

    def depth(self) -> dict:
        with self._active_lock:
            active = len(self._active)
        return {"interactive": self._inter.qsize(), "background": self._bg.qsize(), "active": active,
                "workers": self.workers, "bg_running": self._bg_running}

    # ── restart recovery ────────────────────────────────────────────────────
    def resume_pending(self) -> dict:
        """Boot: re-run young jobs a dead pod left behind; close out the ones too old to answer."""
        resumed, abandoned = 0, 0
        for row in self.store.resumable(self.resume_max_age_s):
            job = Job.from_row(row)
            self.store.update(job.corr_id, resumed=1)
            q = self._inter if job.lane == INTERACTIVE else self._bg
            try:
                q.put_nowait(job)
                resumed += 1
                observe.event("resumed", cid=job.corr_id, cmd=job.command, ms=(time.time() - job.created_at) * 1000.0)
            except queue.Full:
                self._finish_unanswerable(row, "queue_full")
                abandoned += 1
        for row in self.store.expired_unfinished(self.resume_max_age_s):
            self._finish_unanswerable(row, "restarted")
            abandoned += 1
        with self._cv:
            self._cv.notify_all()
        return {"resumed": resumed, "abandoned": abandoned}

    def _finish_unanswerable(self, row: dict, cls: str) -> None:
        job = Job.from_row(row)
        told = False
        if row.get("token") and time.time() - job.created_at < TOKEN_LIFETIME_S - 5:
            told = self.send_failure(job, cls)
        self.store.finish(job.corr_id, "messaged" if told else "abandoned", failure_class=cls,
                          outcome="restart_recovery", detail="told" if told else "token too old to answer")

    # ── delivery of the contract message ────────────────────────────────────
    def send_failure(self, job: Job, cls: str) -> bool:
        content = contract.failure_content(job.label, cls, job.corr_id)
        comps = contract.failure_components(job.corr_id)
        if job.interaction_type == COMPONENT_INTERACTION:
            # ⛔ Never PATCH @original under a control click: that message IS the chart the
            # member is looking at. Tell them privately instead.
            res = self.delivery.followup(job.app_id, job.token, content=content, components=comps, ephemeral=True)
        else:
            res = self.delivery.edit_text(job.app_id, job.token, content=content, components=comps)
        observe.event("failure_message", cid=job.corr_id, cmd=job.command, cls=cls,
                      outcome="sent" if res.ok else "refused", status=f"{res.status}:{res.code}")
        return bool(res.ok)

    # ── threads ─────────────────────────────────────────────────────────────
    def _writer_loop(self) -> None:
        while True:
            item = self._writer.get()
            if item is None:
                return
            try:
                if item[0] == "insert":
                    self.store.insert(item[1])
                elif item[0] == "update":
                    self.store.update(item[1], **item[2])
            except Exception:  # noqa: BLE001
                observe.exception("writer_error")

    def _next_job(self) -> Job | None:
        with self._cv:
            while not self._stop.is_set():
                try:
                    return self._inter.get_nowait()
                except queue.Empty:
                    pass
                if self._bg_running < self.bg_max:
                    try:
                        job = self._bg.get_nowait()
                        self._bg_running += 1
                        return job
                    except queue.Empty:
                        pass
                self._cv.wait(timeout=0.25)
        return None

    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            job = self._next_job()
            if job is None:
                return
            try:
                self.run_job(job)
            finally:
                with self._cv:
                    if job.lane == BACKGROUND:
                        self._bg_running = max(0, self._bg_running - 1)
                    self._cv.notify()

    def _watch_loop(self) -> None:
        while not self._stop.wait(min(1.0, self.heartbeat_s)):
            self.tick(time.time())

    def tick(self, now: float) -> dict:
        """One watchdog pass: renew leases on the heartbeat cadence, enforce deadlines.

        ⛔ The cadence is measured from the LAST beat, not from `now % interval`: a modulo
        on a ~1 s wait can skip every multiple for many seconds, the 20 s lease lapses on a
        job that is still running, and another pod resumes it — a double render and a
        double post. Driven with explicit times by the tests."""
        with self._active_lock:
            items = list(self._active.items())
        beat = now - self._last_beat >= self.heartbeat_s
        beats = deadlines = 0
        for cid, ctx in items:
            if beat and self.store.heartbeat(cid, self.owner, self.lease_s):
                beats += 1
            if self.check_deadline(ctx, now):
                deadlines += 1
        if beat:
            self._last_beat = now
        return {"beats": beats, "deadlines": deadlines}

    def check_deadline(self, ctx: JobContext, now: float) -> bool:
        """Send the honest message once when a job passes its deadline with nothing delivered."""
        job = ctx.job
        if ctx.image_ok or ctx.messaged or job.corr_id in self._deadline_sent or job.lane == BACKGROUND:
            return False
        if now - job.created_at < job.deadline_s:
            return False
        self._deadline_sent.add(job.corr_id)
        ctx.messaged = self.send_failure(job, "deadline") or ctx.messaged
        ctx.failure_class = ctx.failure_class or "deadline"
        return True

    # ── one job, start to terminal row ──────────────────────────────────────
    def run_job(self, job: Job) -> dict:
        self.store.insert(job.row())                     # idempotent: the writer may have beaten us
        if not self.store.claim(job.corr_id, self.owner, self.lease_s):
            self._release_user(job)
            return {"state": "not_claimed"}
        ctx = JobContext(self, job)
        queue_ms = (ctx.started - job.created_at) * 1000.0
        with self._active_lock:
            self._active[job.corr_id] = ctx
        handler = self.handlers.get(job.command)
        outcome = None
        try:
            if handler is None:
                ctx.fail("internal", f"no handler for {job.command}")
            else:
                outcome = handler(ctx)
        except Exception as e:  # noqa: BLE001 — a handler may raise; the member must still hear back
            observe.exception("handler_crash", cid=job.corr_id, cmd=job.command)
            ctx.failure_class = ctx.failure_class or "internal"
            ctx.failure_detail = type(e).__name__
        finally:
            with self._active_lock:
                self._active.pop(job.corr_id, None)
        return self._finalize(job, ctx, outcome, queue_ms)

    def _finalize(self, job: Job, ctx: JobContext, outcome, queue_ms: float) -> dict:
        fields = {"queue_ms": round(queue_ms, 1), "outcome": str(outcome)[:60] if outcome is not None else None,
                  "failure_class": ctx.failure_class, "detail": ctx.failure_detail or None}
        if ctx.first_image_at:
            fields["first_image_ms"] = round((ctx.first_image_at - job.created_at) * 1000.0, 1)
            fields["final_ms"] = round((ctx.final_image_at - job.created_at) * 1000.0, 1)
        failure = ctx.last_delivery_failure
        if failure is not None:
            fields["discord_status"] = f"{failure.status}:{failure.code}" if hasattr(failure, "status") else str(failure)[:40]
        if ctx.image_ok:
            state, fields["quality"] = "delivered", "image"
            fields["failure_class"] = None if ctx.failure_class == "deadline" else ctx.failure_class
        elif ctx.text_ok and not ctx.failure_class:
            state, fields["quality"] = "delivered", "text"
        elif ctx.messaged:
            state = "messaged"
        else:
            # Nothing reached the member and nothing said so. Say so now, if Discord will take it.
            cls = ctx.failure_class or ("ack_late" if (failure is not None and getattr(failure, "token_dead", False)) else "internal")
            fields["failure_class"] = cls
            told = False if cls == "ack_late" else self.send_failure(job, cls)
            state = "messaged" if told else "abandoned"
        self.store.finish(job.corr_id, state, owner=self.owner, **fields)
        self._release_user(job)
        self._deadline_sent.discard(job.corr_id)
        summary = {"state": state, **fields}
        observe.event("job_done", cid=job.corr_id, cmd=job.command, state=state, cls=fields.get("failure_class"),
                      ms=fields.get("final_ms"), lane=job.lane, detail=fields.get("detail"),
                      status=fields.get("discord_status"), outcome=fields.get("outcome"))
        if self.on_terminal:
            try:
                self.on_terminal(job, summary)
            except Exception:  # noqa: BLE001
                observe.exception("on_terminal_error", cid=job.corr_id, cmd=job.command)
        return summary

    def _release_user(self, job: Job) -> None:
        if not job.user_id:
            return
        with self._active_lock:
            n = self._inflight.get(job.user_id, 0) - 1
            if n > 0:
                self._inflight[job.user_id] = n
            else:
                self._inflight.pop(job.user_id, None)
