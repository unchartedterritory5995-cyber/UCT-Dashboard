"""Due-work computation from DB state, leases, quota and backoff.

NOTHING LIVES IN MEMORY. Every decision is recomputed from econ.db each tick
(calendar_event, observation, series_ops, provider_ops, provider_quota, lease),
so a restart at any moment resumes exactly: one minute before a release the
probe/burst schedule is recomputed from the event; mid-burst the next poll is
`last_attempt_at + interval`; after a write whose publish never ran, boot
recovery (ingest.republish_pending) re-publishes.

POLLING PROFILES (elapsed = now - scheduled_at of the series' current event)
  burst        T-2 min one probe; T..T+10 min every 20 s; T+10..T+60 every 2 min;
               then hourly to the end of the ET day; after that every 6 h until
               the period arrives or the next event takes over (DELAYED is a
               currentness verdict, not a reason to stop looking).
  daily        (H.15, NY Fed rates, RRP, DTS, Debt to the Penny) T-2 min probe;
               every 5 min for 30 min, every 15 min to T+2 h, hourly to end of day,
               then every 3 h.
  bls_keyless  BLS without a key has 25 queries/day: fixed offsets T+0, 1, 3, 7,
               15, 30, 60 min, every 2 h to end of day, then every 12 h. No probe.
  hole         an event with no known date (precision unknown): every 3 h.
All due series of one adapter are ONE job -> one adapter.fetch (the adapter
chunks by its own max_series_per_request): every BLS series due in the same
window shares one query.

LEASES: a job runs under lease 'ingest:<adapter>' (owner = host:pid:uuid, TTL).
After taking the lease the job RE-CHECKS which of its series are still due, so a
second instance that computed the same job a moment later finds nothing to do:
exactly one ingestion.

QUOTA: provider_quota(provider, ET day, used). BLS limit = 500/day with a key,
25/day keyless (ECON_BLS_DAILY_LIMIT overrides). A job that would exceed it is
not sent: its series get last_failure_kind='quota', blocked_until = next ET
midnight (-> SOURCE_UNAVAILABLE), and the provider backs off until then.

BACKOFF: after a failed call, provider_ops.backoff_until = now +
min(BACKOFF_CAP_S, BACKOFF_BASE_S * 2**(n-1)); cleared on the next success.

RECONCILE: once a week per series (no live window open, not within 6 h of any
other attempt on the series, BLS only when >= half the daily quota remains) a bounded history re-pull (RECONCILE_YEARS) catches
silent revisions; changed values become new vintages ('detected').
"""
from __future__ import annotations

import logging
import math
import os
import socket
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable, Optional

from . import calendar as cal
from . import currentness as cur
from . import ingest, licensing, secrets, timeutil
from .adapters.base import SeriesSpec

log = logging.getLogger(__name__)

LEASE_TTL_S = 600
BACKOFF_BASE_S = 30
BACKOFF_CAP_S = 900
BACKFILL_RETRY_S = 6 * 3600
RECONCILE_EVERY_S = 7 * 86400
RECONCILE_YEARS = 10
RECONCILE_YEARS_DAILY = 2
RECONCILE_QUIET_BEFORE_S = 1800
RECONCILE_RETRY_S = 6 * 3600        # and never within 6 h of ANY attempt (spacing + retry)
BLS_LIMIT_KEYED = 500
BLS_LIMIT_KEYLESS = 25


@dataclass(frozen=True)
class Profile:
    name: str
    probe_before_s: int = 120
    phases: tuple = ((600, 20), (3600, 120))    # (while elapsed < s, poll every s)
    tail_s: int = 3600                          # until the end of the event's ET day
    after_s: int = 6 * 3600                     # after that, until satisfied / superseded
    offsets: Optional[tuple] = None             # explicit poll offsets (quota-limited)


PROFILES = {
    "burst": Profile("burst"),
    "daily": Profile("daily", phases=((1800, 300), (7200, 900)), tail_s=3600, after_s=3 * 3600),
    "bls_keyless": Profile("bls_keyless", probe_before_s=0, phases=(), tail_s=7200, after_s=12 * 3600,
                           offsets=(0, 60, 180, 420, 900, 1800, 3600)),
    "hole": Profile("hole", probe_before_s=0, phases=(), tail_s=3 * 3600, after_s=3 * 3600),
}


def default_owner() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:12]}"


def _pid_alive(pid: int) -> Optional[bool]:
    """True/False on POSIX; None where liveness cannot be checked safely (Windows)."""
    if os.name != "posix":
        return None
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return None
    return True


def reclaim_stale_leases(store, owner: str) -> list[str]:
    """Boot recovery: release leases left by a DEAD previous process on THIS host.

    Owner ids are 'host:pid:uuid'. A lease whose host is ours is stale when its
    pid is OUR pid (a container restart reuses pid 1 -- that process is gone) or
    the pid is provably not alive. Leases of other hosts are never touched; they
    expire by TTL. This is what lets a service restarted one minute before a
    release catch it even though the crashed process died holding a lease."""
    try:
        host, pid, _ = owner.split(":", 2)
    except ValueError:
        return []
    freed = []
    for name, other in store.conn.execute("SELECT name, owner FROM lease").fetchall():
        if other == owner:
            continue
        try:
            ohost, opid, _ = other.split(":", 2)
            opid_i = int(opid)
        except ValueError:
            continue
        if ohost != host:
            continue
        if opid == pid or _pid_alive(opid_i) is False:
            if store.release_lease(name, other):
                freed.append(name)
    return freed


def _g(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def bls_keyed() -> bool:
    return secrets.provider_key("bls") is not None


def daily_limit(provider: str) -> Optional[int]:
    if provider != "bls":
        return None
    env = (os.environ.get("ECON_BLS_DAILY_LIMIT") or "").strip()
    if env.isdigit():
        return int(env)
    return BLS_LIMIT_KEYED if bls_keyed() else BLS_LIMIT_KEYLESS


def quota_used(store, provider: str, now: int) -> int:
    cur.ensure_ops_schema(store)
    r = store.conn.execute("SELECT used FROM provider_quota WHERE provider=? AND day=?",
                           (provider, timeutil.et_date(now).isoformat())).fetchone()
    return int(r[0]) if r else 0


def quota_add(store, provider: str, now: int, n: int) -> None:
    cur.ensure_ops_schema(store)
    store.conn.execute(
        "INSERT INTO provider_quota(provider, day, used) VALUES (?,?,?) ON CONFLICT(provider, day)"
        " DO UPDATE SET used=used+excluded.used", (provider, timeutil.et_date(now).isoformat(), int(n)))


def next_et_midnight(now: int) -> int:
    return timeutil.et_to_utc(timeutil.et_date(now) + timedelta(days=1), "00:00")


def profile_for(spec) -> Profile:
    key = (_g(spec, "release") or {}).get("calendar_key") or ""
    if _g(spec, "source", {}).get("adapter") == "bls" and not bls_keyed() and daily_limit("bls") <= 50:
        return PROFILES["bls_keyless"]
    if cur.is_daily(key, _g(spec, "frequency")):
        return PROFILES["daily"]
    return PROFILES["burst"]


def _interval(profile: Profile, elapsed: int, event_day_end: int, at: int) -> int:
    for until, every in profile.phases:
        if elapsed < until:
            return every
    return profile.tail_s if at < event_day_end else profile.after_s


def next_poll_at(profile: Profile, event: Optional[cal.Event], satisfied: bool, nxt: Optional[cal.Event],
                 last_attempt: Optional[int]) -> Optional[int]:
    """Absolute time the series is next due (<= now means due now), or None."""
    la = last_attempt if last_attempt is not None else -1
    cands = []
    if event is not None and not satisfied:
        p = PROFILES["hole"] if event.is_hole else profile
        s = event.scheduled_at
        day_end = timeutil.et_to_utc(timeutil.as_date(event.sched_date) + timedelta(days=1), "00:00")
        if la < s:
            cands.append(s)
        elif p.offsets:
            later = [s + o for o in p.offsets if s + o > la]
            cands.append(min(later) if later else la + (p.tail_s if la < day_end else p.after_s))
        else:
            cands.append(la + _interval(p, la - s, day_end, la))
    if nxt is not None and not nxt.is_hole:
        if la < nxt.scheduled_at:
            cands.append(nxt.scheduled_at)            # the first poll AT the scheduled time
        if profile.probe_before_s:
            probe = nxt.scheduled_at - profile.probe_before_s
            if la < probe:
                cands.append(probe)                   # one probe T-2 min
    return min(cands) if cands else None


# ─────────────────────────────── jobs ────────────────────────────────────────

@dataclass
class Job:
    adapter: str
    mode: str                          # latest | history
    purpose: str                       # live | backfill | reconcile
    symbols: list
    start: Optional[date] = None
    reason: str = ""

    @property
    def lease_name(self) -> str:
        return f"ingest:{self.adapter}"


@dataclass
class JobResult:
    job: Job
    status: str                        # ran | leased_elsewhere | not_due | quota_exhausted | backoff
    outcome: Any = None
    requests: int = 0


@dataclass
class SeriesPlan:
    symbol: str
    adapter: str
    due_at: Optional[int]
    mode: str = "latest"
    purpose: str = "live"
    reason: str = ""
    event: Optional[cal.Event] = None
    start: Optional[date] = None


class Scheduler:
    def __init__(self, store, *, entries=None, http=None, adapter_for: Optional[Callable] = None,
                 owner: Optional[str] = None, lease_ttl: int = LEASE_TTL_S, publisher=None, publish: bool = True):
        self.store = store
        self._entries = entries
        self.http = http
        self.owner = owner or default_owner()
        self.lease_ttl = lease_ttl
        self.publisher = publisher
        self.publish = publish
        if adapter_for is None:
            from .adapters import get_adapter
            adapter_for = get_adapter
        self.adapter_for = adapter_for
        cur.ensure_ops_schema(store)

    # ---------------------------------------------------------------- registry view
    def entries(self) -> list:
        if self._entries is not None:
            return list(self._entries)
        from . import registry
        return registry.load_registry()

    def enabled_specs(self) -> list[SeriesSpec]:
        out = []
        for e in self.entries():
            if e.get("status") == "enabled" and licensing.production_eligible(e)[0]:
                out.append(SeriesSpec(e))
        return out

    def lookup(self, symbol):
        for e in self.entries():
            if e.get("symbol") == symbol:
                return e
        return None

    # ---------------------------------------------------------------- planning
    def plan(self, spec: SeriesSpec, now: int, events_cache: Optional[dict] = None) -> Optional[SeriesPlan]:
        if spec.derivation:
            return None
        sym, adapter = spec.symbol, spec.adapter
        ops = cur.series_ops(self.store, sym)
        if ops.get("blocked_until") and int(ops["blocked_until"]) > now:
            return SeriesPlan(sym, adapter, int(ops["blocked_until"]), reason="blocked (quota)")
        facts = cur.gather_facts(self.store, spec, now)
        la = facts.last_attempt_at
        if facts.latest_period is None:
            due = now if la is None else la + BACKFILL_RETRY_S
            return SeriesPlan(sym, adapter, due, "history", "backfill", "no data yet")
        key = (spec.release or {}).get("calendar_key") or ""
        if events_cache is not None and key in events_cache:
            evs = events_cache[key]
        else:
            evs = cal.load_events(self.store, key, now, back_days=120, fwd_days=120) if key else []
            if events_cache is not None:
                events_cache[key] = evs
        rel = [(ev, cal.expected_period(spec, ev)) for ev in evs]
        rel = [(ev, x) for ev, x in rel if x is not None]
        past = [(ev, x) for ev, x in rel if ev.scheduled_at <= now]
        fut = [(ev, x) for ev, x in rel if ev.scheduled_at > now]
        E = past[-1] if past else None
        N = fut[0][0] if fut else None
        sat = True
        if E is not None:
            sat, _ = cur.event_satisfied(E[1], E[0], facts)
        prof = profile_for(spec)
        due = next_poll_at(prof, E[0] if E else None, sat, N, la)
        live = None
        if due is not None:
            reason = "window" if (E is not None and not sat) else "probe"
            live = SeriesPlan(sym, adapter, due, "latest", "live", reason, E[0] if E else N)
            if due <= now or not sat:
                return live
        # quiet (current event satisfied, nothing due now): weekly reconcile
        last_rec = ops.get("last_reconcile_at") or ops.get("last_backfill_at") or facts.last_success_at or 0
        years = RECONCILE_YEARS_DAILY if cur.is_daily(key, spec.frequency) else RECONCILE_YEARS
        start = date(timeutil.et_date(now).year - years, 1, 1)
        rec_due = max(int(last_rec) + RECONCILE_EVERY_S, int(la or 0) + RECONCILE_RETRY_S)
        rec = SeriesPlan(sym, adapter, rec_due, "history", "reconcile", "weekly reconcile", start=start)
        if live is not None and (rec.due_at > now or live.due_at - now < RECONCILE_QUIET_BEFORE_S):
            return live                   # never start a reconcile shortly before a probe/release
        return rec

    def due(self, now: int) -> list[Job]:
        cache: dict = {}
        by: dict = {}
        live_adapters = set()
        plans = [p for p in (self.plan(s, now, cache) for s in self.enabled_specs()) if p is not None]
        for p in plans:
            if p.due_at is None or p.due_at > now or p.reason.startswith("blocked"):
                continue
            if p.purpose == "live":
                live_adapters.add(p.adapter)
            by.setdefault((p.adapter, p.mode, p.purpose, p.start), []).append(p)
        jobs = []
        for (adapter, mode, purpose, start), ps in sorted(by.items(), key=lambda kv: (kv[0][0], kv[0][2])):
            if cur.provider_ops(self.store, adapter).get("backoff_until") and \
                    int(cur.provider_ops(self.store, adapter)["backoff_until"]) > now:
                continue
            if purpose == "reconcile":
                if adapter in live_adapters:
                    continue                                   # never compete with a live window
                lim = daily_limit(adapter)
                if lim is not None and quota_used(self.store, adapter, now) > lim // 2:
                    continue
                ps = ps[:1]                                    # spread reconciles: one series per tick
            jobs.append(Job(adapter, mode, purpose, sorted(p.symbol for p in ps), start,
                            ",".join(sorted({p.reason for p in ps}))))
        return jobs

    def next_wake(self, now: int, *, max_sleep: int = 60, min_sleep: int = 1) -> int:
        cache: dict = {}
        best = now + max_sleep
        for s in self.enabled_specs():
            p = self.plan(s, now, cache)
            if p is not None and p.due_at is not None and p.purpose == "live":
                best = min(best, max(p.due_at, now + min_sleep))
        return best

    # ---------------------------------------------------------------- running
    def _estimate_requests(self, adapter, n: int, job: Job, now: int) -> int:
        per = getattr(getattr(adapter, "limits", None), "series_per_query", None) or \
            getattr(adapter, "max_series_per_request", 1) or 1
        reqs = math.ceil(n / max(1, int(per)))
        if job.mode == "history":
            span = getattr(getattr(adapter, "limits", None), "years_per_query", None) or 20
            years = (timeutil.et_date(now).year - job.start.year + 1) if job.start else 40
            reqs *= max(1, math.ceil(max(1, years) / max(1, int(span))))
        return max(1, reqs)

    def _http_count(self, host_hint: Optional[str]) -> int:
        stats = getattr(self.http, "stats", None)
        if not callable(stats):
            return 0
        s = stats()
        if host_hint:
            return sum((s.get("by_host") or {}).get(host_hint, {}).values())
        return int(s.get("total") or 0)

    def run_job(self, job: Job, now: int) -> JobResult:
        if not self.store.acquire_lease(job.lease_name, self.owner, self.lease_ttl, now=now):
            return JobResult(job, "leased_elsewhere")
        try:
            # re-check under the lease: another instance may have just run it
            specs = {s.symbol: s for s in self.enabled_specs()}
            cache: dict = {}
            still = []
            for sym in job.symbols:
                sp = specs.get(sym)
                p = self.plan(sp, now, cache) if sp is not None else None
                if p is not None and p.due_at is not None and p.due_at <= now and p.purpose == job.purpose:
                    still.append(sp)
            if not still:
                return JobResult(job, "not_due")
            adapter = self.adapter_for(job.adapter)
            lim = daily_limit(job.adapter)
            est = self._estimate_requests(adapter, len(still), job, now)
            if lim is not None and quota_used(self.store, job.adapter, now) + est > lim:
                until = next_et_midnight(now)
                for sp in still:
                    cur.note_failure(self.store, sp.symbol, now, "quota",
                                     f"{job.adapter} daily quota exhausted ({lim}/day); retry after next ET midnight",
                                     blocked_until=until)
                    cur.refresh_state(self.store, sp, now)
                cur.update_provider_ops(self.store, job.adapter, now, backoff_until=until,
                                        last_error=f"daily quota exhausted ({lim}/day)", last_error_at=now)
                return JobResult(job, "quota_exhausted")
            for sp in still:
                cur.note_attempt(self.store, sp.symbol, now)
            host = "api.bls.gov" if job.adapter == "bls" else None
            before = self._http_count(host)
            outcome = ingest.run_fetch(self.store, still, job.mode, now, self.http, adapter, start=job.start,
                                       purpose=job.purpose, entries=self.entries(), publisher=self.publisher,
                                       publish=self.publish, lookup=self.lookup)
            used = max(self._http_count(host) - before, est if lim is not None else 0)
            if lim is not None:
                quota_add(self.store, job.adapter, now, used)
            if outcome.ok:
                cur.update_provider_ops(self.store, job.adapter, now, backoff_until=None)
            else:
                n = int(cur.provider_ops(self.store, job.adapter).get("consecutive_failures") or 1)
                cur.update_provider_ops(self.store, job.adapter, now,
                                        backoff_until=now + min(BACKOFF_CAP_S, BACKOFF_BASE_S * 2 ** (n - 1)))
            return JobResult(job, "ran", outcome, used)
        finally:
            self.store.release_lease(job.lease_name, self.owner)

    def tick(self, now: int, should_stop: Optional[Callable[[], bool]] = None) -> list[JobResult]:
        out = []
        for job in self.due(now):
            if should_stop and should_stop():
                break
            try:
                out.append(self.run_job(job, now))
            except Exception as e:  # noqa: BLE001 -- one bad job never stops the loop
                log.error("econ.scheduler: job %s/%s failed: %s", job.adapter, job.purpose, secrets.safe_exc(e))
                out.append(JobResult(job, "error", secrets.safe_exc(e)))
        return out
