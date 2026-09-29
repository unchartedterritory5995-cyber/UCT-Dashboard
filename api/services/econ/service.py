"""The econ ingestion service: one long-running loop + a health/status HTTP port.

    svc = EconService(store, clock=..., sleep=...)   # everything injectable
    svc.boot()          # validate registry (REFUSES to start on any error), side tables,
                        # recovery (re-publish rows whose publish never ran), calendars,
                        # every enabled series' currentness
    svc.tick(now)       # calendars (every 6 h) -> scheduler jobs -> states -> status snapshot
    svc.run_forever()   # tick / sleep until the next due poll (<= 60 s) until stop()

CRASH SAFETY: the loop holds no state that matters -- the scheduler recomputes
due work from econ.db every tick (see scheduler.py). SIGTERM (econ_main wires it
to stop()) lets the CURRENT job finish, its lease is released in a finally, the
HTTP server stops and every lease this owner still holds is released.

HTTP (stdlib ThreadingHTTPServer on $PORT, daemon thread)
  GET /health, /api/health   200 {"ok": true, ...} while the loop heartbeat is fresh,
                             else 503 (Railway's healthcheckPath is /api/health)
  GET /status                the status SNAPSHOT (JSON). The handler never touches the
                             database (sqlite connections are per-thread, and a status
                             route that computes is the /market-indicators 87 s lesson):
                             the loop rebuilds the snapshot at most every STATUS_EVERY_S.
The status carries dates, states, counts, redacted errors and key-PRESENCE booleans.
Never a value, never a key.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import Counter, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

from . import calendar as cal
from . import currentness as cur
from . import ingest, licensing, secrets, timeutil
from .adapters.base import SeriesSpec
from .scheduler import Scheduler, daily_limit, default_owner, quota_used, reclaim_stale_leases

log = logging.getLogger(__name__)

SERVICE_VERSION = "econ-release-p1.1"
HEALTH_MAX_AGE_S = 180
STATUS_EVERY_S = 15
STATE_EVERY_S = 60
CALENDAR_EVERY_S = 6 * 3600


class RefuseToStart(RuntimeError):
    """The registry failed validation (or the store cannot be opened): the service does not run."""


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line; message and exception text pass through secrets.redact."""

    def format(self, record: logging.LogRecord) -> str:
        doc = {"ts": round(record.created, 3), "level": record.levelname, "logger": record.name,
               "msg": secrets.redact(record.getMessage())}
        if record.exc_info:
            doc["exc"] = secrets.redact(self.formatException(record.exc_info))
        elif record.exc_text:
            doc["exc"] = secrets.redact(record.exc_text)
        return json.dumps(doc, separators=(",", ":"))


def configure_logging(level: int = logging.INFO, stream=None) -> logging.Handler:
    secrets.install_logging_redaction()
    h = logging.StreamHandler(stream)
    h.setFormatter(JsonLogFormatter())
    h.addFilter(secrets.RedactingFilter())
    for name in secrets.ECON_LOGGERS:
        lg = logging.getLogger(name)
        lg.setLevel(level)
        lg.addHandler(h)
        lg.propagate = False
    return h


def _g(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


class EconService:
    def __init__(self, store, *, entries=None, http=None, adapter_for: Optional[Callable] = None,
                 clock: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep,
                 owner: Optional[str] = None, publisher=None, publish: bool = True, feeds: bool = True,
                 calendar_payloads: Optional[dict] = None, calendar_http=None,
                 registry_validator: Optional[Callable[[], list]] = None, max_sleep: int = 60):
        self.store = store
        self._entries = entries
        self.clock = clock
        self.sleep = sleep
        self.owner = owner or default_owner()
        if http is None:
            from .http import HttpClient
            http = HttpClient(validator_store=ingest.StoreValidators(store), clock=clock, sleep=sleep)
        self.http = http
        self.calendar_http = calendar_http if calendar_http is not None else http
        self.publisher = publisher
        self.publish = publish
        self.feeds = feeds
        self.calendar_payloads = calendar_payloads
        self.registry_validator = registry_validator
        self.max_sleep = max_sleep
        self.scheduler = Scheduler(store, entries=entries, http=http, adapter_for=adapter_for, owner=self.owner,
                                   publisher=publisher, publish=publish)
        self._stop = threading.Event()
        self.started_at: Optional[int] = None
        self.heartbeat_at: Optional[int] = None
        self.ticks = 0
        self.booted = False
        self._last_cal = self._last_state = self._last_status = None
        self.calendar_summary: dict = {}
        self.recent_jobs: deque = deque(maxlen=50)
        self._snapshot: dict = {"service": {"version": SERVICE_VERSION, "booted": False}}
        self._snapshot_lock = threading.Lock()
        self._server: Optional[ThreadingHTTPServer] = None

    # ---------------------------------------------------------------- registry
    def entries(self) -> list:
        return self.scheduler.entries()

    def enabled_all(self) -> list[SeriesSpec]:
        return [SeriesSpec(e) for e in self.entries()
                if e.get("status") == "enabled" and licensing.production_eligible(e)[0]]

    # ---------------------------------------------------------------- lifecycle
    def boot(self) -> None:
        if self.registry_validator is not None:
            errs = list(self.registry_validator())
        else:
            from . import registry
            errs = registry.validate_registry(self._entries)
        if errs:
            raise RefuseToStart(f"registry validation failed ({len(errs)} error(s)); first: {errs[0]}")
        now = int(self.clock())
        cur.ensure_ops_schema(self.store)
        self.started_at = now
        freed = reclaim_stale_leases(self.store, self.owner)
        if freed:
            log.warning("econ.service: reclaimed %d stale lease(s) of a dead previous process: %s", len(freed), freed)
        republished = ingest.republish_pending(self.store, now, self.publisher) if self.publish else []
        if republished:
            log.info("econ.service: recovery re-published %d series", len(republished))
        self._refresh_calendars(now)
        self._refresh_states(now)
        self._publish_meta(now, catalog=True)
        self.heartbeat_at = now
        self.booted = True
        self._build_status(now)
        log.info("econ.service: booted %s owner=%s enabled=%d", SERVICE_VERSION, self.owner,
                 len(self.enabled_all()))

    def stop(self) -> None:
        self._stop.set()

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    def shutdown(self) -> None:
        self._stop.set()
        if self._server is not None:
            try:
                self._server.shutdown()
                self._server.server_close()
            except Exception:  # noqa: BLE001
                pass
            self._server = None
        try:
            for (name,) in self.store.conn.execute("SELECT name FROM lease WHERE owner=?", (self.owner,)).fetchall():
                self.store.release_lease(name, self.owner)
        except Exception as e:  # noqa: BLE001
            log.warning("econ.service: lease release on shutdown failed: %s", secrets.safe_exc(e))
        log.info("econ.service: stopped")

    # ---------------------------------------------------------------- loop
    def _refresh_calendars(self, now: int) -> None:
        try:
            self.calendar_summary = cal.refresh(self.store, now, http=self.calendar_http if self.feeds else None,
                                                feeds=self.feeds, payloads=self.calendar_payloads)
        except Exception as e:  # noqa: BLE001
            self.calendar_summary = {"error": secrets.safe_exc(e)}
            log.error("econ.service: calendar refresh failed: %s", self.calendar_summary["error"])
        self._last_cal = now

    def _refresh_states(self, now: int) -> None:
        for sp in self.enabled_all():
            try:
                cur.refresh_state(self.store, sp, now, lookup=self.scheduler.lookup)
            except Exception as e:  # noqa: BLE001
                log.warning("econ.service: state %s failed: %s", sp.symbol, secrets.safe_exc(e))
        self._last_state = now

    def _publish_meta(self, now: int, catalog: bool = False) -> None:
        if not self.publish:
            return
        try:
            from . import publish as pub
        except ImportError:
            return
        try:
            if catalog:
                pub.publish_catalog()
            pub.publish_status(self.store, now=now, heartbeat={"version": SERVICE_VERSION,
                                                               "heartbeat_at": self.heartbeat_at or now})
        except Exception as e:  # noqa: BLE001
            log.warning("econ.service: status publish failed: %s", secrets.safe_exc(e))

    def tick(self, now: Optional[int] = None) -> list:
        now = int(self.clock()) if now is None else int(now)
        if not self.booted:
            self.boot()
        self.heartbeat_at = now
        self.ticks += 1
        if self._last_cal is None or now - self._last_cal >= CALENDAR_EVERY_S:
            self._refresh_calendars(now)
        results = self.scheduler.tick(now, should_stop=self._stop.is_set)
        for r in results:
            o = r.outcome
            if isinstance(o, str) or o is None:
                written, err = 0, o
            else:
                written, err = o.written, o.error
            self.recent_jobs.append({"at": now, "adapter": r.job.adapter, "purpose": r.job.purpose,
                                     "symbols": len(r.job.symbols), "status": r.status, "written": written,
                                     "error": secrets.redact(err) if err else None})
        if results or self._last_state is None or now - self._last_state >= STATE_EVERY_S:
            self._refresh_states(now)
        if results or self._last_status is None or now - self._last_status >= STATUS_EVERY_S:
            self._build_status(now)
            self._publish_meta(now)
        return results

    def run_forever(self, max_ticks: Optional[int] = None) -> None:
        if not self.booted:
            self.boot()
        n = 0
        while not self._stop.is_set():
            self.tick()
            n += 1
            if max_ticks is not None and n >= max_ticks:
                break
            wake = self.scheduler.next_wake(int(self.clock()), max_sleep=self.max_sleep)
            while not self._stop.is_set() and self.clock() < wake:
                self.sleep(min(5.0, max(0.05, wake - self.clock())))
        self.shutdown()

    # ---------------------------------------------------------------- status
    def health(self, now: Optional[float] = None) -> tuple[int, dict]:
        now = self.clock() if now is None else now
        age = None if self.heartbeat_at is None else int(now - self.heartbeat_at)
        ok = self.booted and age is not None and age <= HEALTH_MAX_AGE_S and not self._stop.is_set()
        return (200 if ok else 503), {"ok": ok, "version": SERVICE_VERSION, "heartbeat_age_s": age,
                                      "stopping": self._stop.is_set()}

    def status(self) -> dict:
        with self._snapshot_lock:
            return json.loads(json.dumps(self._snapshot))

    def _build_status(self, now: int) -> dict:
        snap = build_status(self.store, now, entries=self.entries(), started_at=self.started_at,
                            heartbeat_at=self.heartbeat_at, owner=self.owner, ticks=self.ticks,
                            recent_jobs=list(self.recent_jobs), calendar_summary=self.calendar_summary)
        with self._snapshot_lock:
            self._snapshot = snap
        self._last_status = now
        return snap

    def serve_http(self, port: int, host: str = "0.0.0.0") -> ThreadingHTTPServer:
        svc = self

        class Handler(BaseHTTPRequestHandler):
            def _send(self, code: int, doc: dict) -> None:
                body = secrets.redact(json.dumps(doc, separators=(",", ":"), default=str)).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):  # noqa: N802
                path = self.path.split("?", 1)[0].rstrip("/") or "/"
                if path in ("/health", "/api/health", "/"):
                    code, doc = svc.health()
                    self._send(code, doc)
                elif path in ("/status", "/api/econ/service-status"):
                    self._send(200, svc.status())
                else:
                    self._send(404, {"error": "not found"})

            def log_message(self, fmt, *args):  # quiet: no per-request access log
                return

        self._server = ThreadingHTTPServer((host, int(port)), Handler)
        self._server.daemon_threads = True
        t = threading.Thread(target=self._server.serve_forever, name="econ-status-http", daemon=True)
        t.start()
        return self._server


def build_status(store, now: int, *, entries, started_at=None, heartbeat_at=None, owner=None, ticks=0,
                 recent_jobs=(), calendar_summary=None) -> dict:
    """The status snapshot (dates/states/counts/redacted errors; never values or keys)."""
    from . import adapters
    cur.ensure_ops_schema(store)
    ents = list(entries)
    enabled = [e for e in ents if e.get("status") == "enabled" and licensing.production_eligible(e)[0]]
    states = {r["series_id"]: r for r in store.all_states()}
    counts = Counter(states[e["symbol"]]["state"] for e in enabled if e["symbol"] in states)
    # next expected releases: group enabled series by (calendar_key, event)
    nxt: dict = {}
    today = timeutil.et_date(now).isoformat()
    keys = sorted({(e.get("release") or {}).get("calendar_key") for e in enabled} - {None, ""})
    cal_rows = []
    for k in keys:
        evs = [ev for ev in cal.load_events(store, k, now, back_days=30, fwd_days=400) if ev.scheduled_at > now
               or (not ev.has_time and ev.sched_date >= today)]
        c = cal.coverage(store, k) or {}
        prov, src = cal.KNOWN_CALENDARS.get(k, ("unknown", None))
        cal_rows.append({"calendar_key": k, "provider": prov, "source": src.value if src else None,
                         "coverage_end": c.get("coverage_end"),
                         "next_event": evs[0].public() if evs else None})
        if evs:
            syms = sorted(e["symbol"] for e in enabled if (e.get("release") or {}).get("calendar_key") == k)
            nxt[k] = {"calendar_key": k, **evs[0].public(), "symbols": syms}
    top = sorted(nxt.values(), key=lambda r: (r["date"], r["time"] or "99:99"))[:10]
    last_acq = {}
    for adapter, at in store.conn.execute(
            "SELECT adapter, MAX(COALESCE(finished_at, started_at)) FROM acquisition WHERE outcome IN"
            " ('ok','not_modified') AND request_key NOT LIKE 'call:%' GROUP BY adapter"):
        last_acq[adapter] = at
    delayed = [{"symbol": s, "state": r["state"], "expected_period": r["expected_period"],
                "reason": secrets.redact(r["reason"] or "")[:300]}
               for s, r in sorted(states.items()) if r["state"] in ("DELAYED", "SOURCE_UNAVAILABLE", "UNCONFIRMED")]
    vfail = [{"series_id": v["series_id"], "at": v["at"], "severity": v["severity"],
              "reasons": [secrets.redact(x) for x in v["reasons"]][:5]} for v in store.validation_events(limit=20)]
    providers = {}
    for r in store._dicts("SELECT * FROM provider_ops ORDER BY provider"):
        providers[r["provider"]] = {"consecutive_failures": r["consecutive_failures"],
                                    "last_error": secrets.redact(r["last_error"] or "") or None,
                                    "last_error_at": r["last_error_at"], "last_success_at": r["last_success_at"],
                                    "backoff_until": r["backoff_until"],
                                    "last_acquisition_at": last_acq.get(r["provider"])}
    for a, at in last_acq.items():
        providers.setdefault(a, {"last_acquisition_at": at})
    retry = [{"symbol": r["series_id"], "consecutive_failures": r["consecutive_failures"],
              "last_failure_kind": r["last_failure_kind"], "last_failure_at": r["last_failure_at"],
              "blocked_until": r["blocked_until"]}
             for r in store._dicts("SELECT * FROM series_ops WHERE consecutive_failures > 0 OR blocked_until IS NOT NULL"
                                   " ORDER BY series_id")]
    quota = {}
    lim = daily_limit("bls")
    quota["bls"] = {"day": today, "used": quota_used(store, "bls", now), "limit": lim}
    return {
        "service": {"version": SERVICE_VERSION, "booted": started_at is not None, "owner": owner,
                    "started_at": started_at, "uptime_s": (now - started_at) if started_at else None,
                    "heartbeat_at": heartbeat_at, "ticks": ticks, "generated_at": now},
        "registry": {"total": len(ents), "enabled": len(enabled), "cohort": sum(1 for e in ents if e.get("cohort")),
                     "enabled_cohort": sum(1 for e in enabled if e.get("cohort"))},
        "enabled_series": len(enabled),
        "states": dict(sorted(counts.items())),
        "next_releases": top,
        "last_success_by_provider": last_acq,
        "delayed": delayed,
        "validation_failures": vfail,
        "providers": providers,
        "retry": retry,
        "quota": quota,
        "keys_configured": secrets.configured(),
        "calendars": cal_rows,
        "calendar_refresh": {k: {kk: (secrets.redact(vv) if isinstance(vv, str) else vv) for kk, vv in v.items()}
                             for k, v in (calendar_summary or {}).items() if isinstance(v, dict)},
        "recent_jobs": list(recent_jobs)[-20:],
        "adapter_import_errors": adapters.import_errors(),
    }
