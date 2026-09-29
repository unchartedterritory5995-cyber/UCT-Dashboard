"""The ingest pipeline: fetch -> archive -> validate -> diff -> write -> derive -> publish -> state.

    run_fetch(store, specs, mode, now, http, adapter, ...) -> FetchOutcome
    backfill(store, specs, start=None, *, http, now, ...) -> list[FetchOutcome]

EVERY STEP IS IDEMPOTENT. Re-running a fetch that returns the same data writes
zero observation rows AND zero release rows (a release row is created only when
there is something to write under it).

ORDER (one call)
  1. record_acquisition (one 'call:' row per adapter call; one row per FetchResult)
  2. adapter.fetch through a DEFERRING http proxy: every GET is made with
     defer_validators=True and any commit_validators() the adapter makes is
     queued -- ETag/Last-Modified are committed ONLY after the whole call
     validated, so a payload that fails validation can never turn every future
     poll into a 304.
  3. optional raw archive (ECON_ARCHIVE=local -> ECON_ARCHIVE_DIR/<adapter>/<sha256>.bin);
     refused if the bytes contain a configured secret.
  4. validate.validate_fetch per (series, result). Any reason -> validation_event
     + VALIDATION_FAILED facts; NOTHING is written for that series; last good kept.
  5. diff against the stored latest vintages; classify every new/changed row
     into a RELEASE (see "Release keys") with an available_at (see "Time rules").
  6. store.write_observations; a StoreConflict (same release + period, different
     value = an intra-release correction) is written under '<release_key>#c<n>'
     at DETECTION time -- never an overwrite.
  7. derive.derive_and_write for every enabled derived series downstream of a
     changed series (transitively).
  8. publish hook (api.services.econ.publish.publish_series, guarded import);
     `series_ops.publish_pending_at` is stamped BEFORE the write and cleared
     after publish, so a crash in between is re-published on the next boot.
  9. currentness.refresh_state for every touched series.

RELEASE KEYS
  live, event matched   '<calendar_key>:<period_label>'          (bls:cpi:2026-09)
  live, no event        '<adapter>:<series>:<detected UTC date>'
  backfill / gap fill   'backfill:<series>:<run_id>'
  correction            '<key>#c<n>'

TIME RULES (available_at; never earlier than the scheduled time, never later
than the first sighting)
  live, event matched, seen within ON_TIME_TOLERANCE_S of the schedule
        -> scheduled_at (method 'scheduled'); a provider publication time at/after
           the schedule and <= first-seen wins ('source_timestamp')
  live, event matched, seen later  -> provider time if stated (>= schedule, <= first-seen)
                                      else first-seen ('detected')
  live, seen BEFORE the schedule   -> scheduled_at (the row is invisible to as-of
                                      reads until then: no future-release leakage)
  live, no event                   -> provider time if stated and <= first-seen, else first-seen
  backfill / gap fill              -> registry lag_rule (conservative late side),
                                      capped at first-seen, THEN raised to the matched
                                      event's schedule (the schedule wins: never earlier
                                      than scheduled); pit = backfill_class
  revision found by a history pull -> first-seen ('detected')
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable, Iterable, Optional

from . import calendar as cal
from . import currentness as cur
from . import secrets, timeutil, validate
from .adapters.base import SeriesSpec, as_specs
from .model import AvailableAtMethod as M, MalformedPayload, PitClass, ValidationFailed
from .store import StoreConflict

log = logging.getLogger(__name__)

ON_TIME_TOLERANCE_S = 180
GAPFILL_PREFIX = "backfill"


# ─────────────────────────────── helpers ─────────────────────────────────────

class StoreValidators:
    """HttpClient.validator_store backed by econ.db's http_validator table."""

    def __init__(self, store):
        self.store = store

    def get(self, key: str):
        v = self.store.get_validator(key)
        return (v["etag"], v["last_modified"]) if v else None

    def put(self, key: str, etag, last_modified) -> None:
        self.store.put_validator(key, etag, last_modified)


class DeferringHttp:
    """Wraps the HttpClient handed to an adapter: validators are held back until
    the pipeline says the payload validated (`commit()`), whatever the adapter does."""

    def __init__(self, http):
        self._h = http
        self.pending: list = []

    def get(self, url, params=None, headers=None, conditional_key=None, defer_validators=True):
        resp = self._h.get(url, params=params, headers=headers, conditional_key=conditional_key,
                           defer_validators=True)
        if conditional_key and getattr(resp, "validators", None):
            self.pending.append((conditional_key, resp))
        return resp

    def commit_validators(self, conditional_key, resp) -> None:     # adapter's own call: deferred
        if conditional_key and getattr(resp, "validators", None) and \
                not any(k == conditional_key and r is resp for k, r in self.pending):
            self.pending.append((conditional_key, resp))

    def commit(self) -> int:
        n = 0
        for k, r in self.pending:
            self._h.commit_validators(k, r)
            n += 1
        self.pending.clear()
        return n

    def drop(self) -> None:
        self.pending.clear()

    def __getattr__(self, name):
        return getattr(self._h, name)


def _g(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _spec_key(spec) -> str:
    return (_g(spec, "release") or {}).get("calendar_key") or ""


def rule_available_at(spec, period_start: str, period_end: str) -> Optional[int]:
    """Registry lag_rule -> unix seconds (conservative late side). None if no rule."""
    lag = (_g(spec, "release") or {}).get("lag_rule") or {}
    kind, days, t = lag.get("kind"), lag.get("days"), lag.get("time_et") or "23:59"
    if kind == "period_end_plus_days":
        d = timeutil.as_date(period_end) + timedelta(days=int(days))
    elif kind == "period_start_plus_days":
        d = timeutil.as_date(period_start) + timedelta(days=int(days))
    elif kind == "business_days_after":
        d = timeutil.add_business_days(period_end, int(days))
    else:
        return None
    return timeutil.et_to_utc(d, t)


def live_available_at(scheduled_at: Optional[int], first_seen: int,
                      published_at: Optional[int]) -> tuple[int, str]:
    """(available_at, method) for a live sighting -- module doc 'Time rules'."""
    sp = published_at if (published_at is not None and published_at <= first_seen) else None
    if scheduled_at is None:
        return (sp, M.SOURCE_TIMESTAMP.value) if sp is not None else (first_seen, M.DETECTED.value)
    if sp is not None and sp >= scheduled_at:
        return sp, M.SOURCE_TIMESTAMP.value
    if first_seen <= scheduled_at + ON_TIME_TOLERANCE_S:
        return scheduled_at, M.SCHEDULED.value
    return max(first_seen, scheduled_at), M.DETECTED.value


def _has_secret(payload: bytes) -> bool:
    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload)
    try:
        values = secrets._secret_values()          # configured values only (param NAMES may be legit data)
    except Exception:  # noqa: BLE001
        return secrets.redact(text) != text
    for v in values:
        for f in secrets._value_forms(v):
            if f and f in text:
                return True
    return False


def archive_payload(adapter: str, payload: Optional[bytes], sha: Optional[str]) -> Optional[str]:
    """ECON_ARCHIVE=local -> write once under ECON_ARCHIVE_DIR; returns the ref or None."""
    mode = (os.environ.get("ECON_ARCHIVE") or "off").strip().lower()
    if mode != "local" or not payload or not sha:
        return None
    if _has_secret(payload):
        log.warning("econ.ingest: archive refused for %s: payload contains configured secret material", adapter)
        return None
    root = os.environ.get("ECON_ARCHIVE_DIR") or "./econ_archive"
    d = os.path.join(root, adapter)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{sha}.bin")
    if not os.path.exists(path):
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(payload)
        os.replace(tmp, path)
    return f"local:{adapter}/{sha}.bin"


# ─────────────────────────────── outcome ─────────────────────────────────────

@dataclass
class SeriesResult:
    symbol: str
    status: str = "pending"          # written|unchanged|not_modified|rejected|error|empty
    inserted: int = 0
    revised: int = 0
    release_keys: list = field(default_factory=list)
    reasons: list = field(default_factory=list)


@dataclass
class FetchOutcome:
    adapter: str
    mode: str
    now: int
    ok: bool = True
    error: Optional[str] = None
    error_kind: Optional[str] = None
    series: dict = field(default_factory=dict)
    acq_ids: list = field(default_factory=list)
    results: int = 0
    derived: dict = field(default_factory=dict)
    published: list = field(default_factory=list)
    validators_committed: int = 0
    elapsed_s: Optional[float] = None       # wall time of the call (backfill fills it)
    requests: Optional[int] = None          # HTTP attempts during the call (backfill fills it)

    @property
    def written(self) -> int:
        return sum(r.inserted + r.revised for r in self.series.values())

    @property
    def changed(self) -> list:
        return sorted(s for s, r in self.series.items() if r.inserted or r.revised)


# ─────────────────────────────── classification ──────────────────────────────

@dataclass
class _Group:
    release_key: str
    calendar_key: Optional[str]
    kind: str
    scheduled_at: Optional[int]
    rows: list = field(default_factory=list)


def _match_new(spec, events, period_start: str):
    """The latest-scheduled NEW-kind event expecting `period_start`."""
    best = None
    for ev in events:
        exp = cal.expected_period(spec, ev)
        if exp and exp.kind == "new" and exp.period_start == period_start:
            best = ev if best is None or ev.scheduled_at >= best.scheduled_at else best
    return best


def _current_event(spec, events, now: int):
    """The event whose window contains `now` (incl. the pre-window probe), if any."""
    key, freq = _spec_key(spec), str(_g(spec, "frequency") or "").upper()
    cand = None
    for ev in events:
        if cal.expected_period(spec, ev) is None or ev.is_hole:
            continue
        if ev.scheduled_at - ON_TIME_TOLERANCE_S <= now < cur.window_end(ev, key, freq):
            cand = ev if cand is None or ev.scheduled_at >= cand.scheduled_at else cand
    return cand


def _classify(store, spec, accepted, *, purpose: str, now: int, events, published_at, adapter: str,
              run_id: str, acq_id: Optional[int]) -> list[_Group]:
    sym = spec.symbol
    key = _spec_key(spec)
    if not accepted:
        return []
    stored = {r.period_start: r for r in store.latest_rows(sym, start=min(o.period_start for o in accepted))}
    newest_stored = store.period_bounds(sym)["newest"]
    backfill_pit = str((_g(spec, "pit") or {}).get("backfill_class") or "L")
    groups: dict[str, _Group] = {}
    day = time.strftime("%Y-%m-%d", time.gmtime(now))

    def grp(rk, ck, kind, sched) -> _Group:
        if rk not in groups:
            groups[rk] = _Group(rk, ck, kind, sched)
        return groups[rk]

    def row(o, avail, method, pit):
        return (o.period_start, o.period_end, o.value, o.flag or "", int(avail), method, pit, acq_id, None)

    def rule_row(o):
        ra = rule_available_at(spec, o.period_start, o.period_end)
        if ra is None:
            raise ValidationFailed(sym, ["schema: no backfill lag_rule; cannot place history"])
        ra = min(ra, now)                          # never later than first sighting ...
        ev = _match_new(spec, events, o.period_start)
        if ev is not None:
            ra = max(ra, ev.scheduled_at)          # ... and never earlier than a known schedule (wins)
        return row(o, ra, M.RULE.value, backfill_pit)

    detected_key = f"{adapter}:{sym}:{day}"
    cur_ev = _current_event(spec, events, now) if purpose == "live" else None
    for o in accepted:
        prev = stored.get(o.period_start)
        is_new = prev is None
        if not is_new and validate._same(prev.value, o.value) and (prev.flag or "") == (o.flag or ""):
            continue
        per_row_pub = o.source_published_at if o.source_published_at is not None else published_at
        if purpose != "live":
            if is_new:
                grp(f"{GAPFILL_PREFIX}:{sym}:{run_id}", None, "backfill", None).rows.append(rule_row(o))
            else:
                grp(detected_key, None, "live", None).rows.append(
                    row(o, now, M.DETECTED.value, PitClass.TRUE_VINTAGE.value))
            continue
        if is_new:
            ev = _match_new(spec, events, o.period_start)
            if newest_stored is None and (ev is None or ev is not cur_ev):
                # first-ever data for this series: history, not a live capture
                grp(f"{GAPFILL_PREFIX}:{sym}:{run_id}", None, "backfill", None).rows.append(rule_row(o))
                continue
            if newest_stored is not None and o.period_start < newest_stored and ev is None:
                grp(f"{GAPFILL_PREFIX}:{sym}:{run_id}", None, "backfill", None).rows.append(rule_row(o))
                continue
            if ev is not None:
                s = ev.scheduled_at
                if now > cur.window_end(ev, key, str(_g(spec, "frequency") or "")):
                    avail, method = max(now, s), M.DETECTED.value      # late beyond its window
                else:
                    avail, method = live_available_at(s, now, per_row_pub)
                grp(f"{ev.calendar_key}:{ev.period_label}", ev.calendar_key, "live", s).rows.append(
                    row(o, avail, method, PitClass.TRUE_VINTAGE.value))
            else:
                avail, method = live_available_at(None, now, per_row_pub)
                grp(detected_key, None, "live", None).rows.append(row(o, avail, method, PitClass.TRUE_VINTAGE.value))
        else:
            if cur_ev is not None:
                s = cur_ev.scheduled_at
                avail, method = live_available_at(s, now, per_row_pub)
                grp(f"{cur_ev.calendar_key}:{cur_ev.period_label}", cur_ev.calendar_key, "live", s).rows.append(
                    row(o, avail, method, PitClass.TRUE_VINTAGE.value))
            else:
                avail, method = live_available_at(None, now, per_row_pub)
                grp(detected_key, None, "live", None).rows.append(row(o, avail, method, PitClass.TRUE_VINTAGE.value))
    # a new-period release also carries the revisions published with it
    out = list(groups.values())
    return out


def _next_correction_key(store, release_key: str) -> str:
    n = store.conn.execute("SELECT COUNT(*) FROM release WHERE release_key LIKE ? ESCAPE '\\'",
                           (release_key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "#c%",)
                           ).fetchone()[0]
    return f"{release_key}#c{int(n) + 1}"


def _write_group(store, sym: str, g: _Group, acq_id: Optional[int], now: int, res: SeriesResult) -> None:
    rid = store.upsert_release(g.release_key, g.calendar_key, g.kind, g.scheduled_at, acq_id)
    try:
        st = store.write_observations(sym, rid, g.rows, now=now)
        res.release_keys.append(g.release_key)
    except StoreConflict:
        ck = _next_correction_key(store, g.release_key)
        rows = [(ps, pe, v, f, max(now, a), M.DETECTED.value, pit, acq, inp)
                for (ps, pe, v, f, a, _m, pit, acq, inp) in g.rows]
        rid = store.upsert_release(ck, g.calendar_key, g.kind, g.scheduled_at, acq_id)
        st = store.write_observations(sym, rid, rows, now=now)
        res.release_keys.append(ck)
    res.inserted += st.inserted
    res.revised += st.revised


# ─────────────────────────────── derive + publish ────────────────────────────

def _registry_entries(entries):
    if entries is not None:
        return list(entries)
    from . import registry
    return registry.load_registry()


def downstream_derived(changed: Iterable[str], entries) -> list[dict]:
    """Enabled derived entries whose inputs (transitively) include a changed symbol,
    in dependency order."""
    derived = [e for e in entries if e.get("derivation") and e.get("status") == "enabled"]
    todo, out, seen = set(changed), [], set()
    progress = True
    while progress:
        progress = False
        for e in derived:
            if e["symbol"] in seen:
                continue
            if set(e["derivation"].get("inputs") or []) & todo:
                out.append(e)
                seen.add(e["symbol"])
                todo.add(e["symbol"])
                progress = True
    return out


def default_publisher() -> Optional[Callable]:
    try:
        from . import publish
    except ImportError:
        return None
    fn = getattr(publish, "publish_series", None)
    if fn is None:
        return None

    def _pub(store, symbol, now=None):
        return fn(store, symbol, now=now)
    return _pub


def publish_symbols(store, symbols: Iterable[str], now: int, publisher=None) -> list:
    """Publish + clear publish_pending_at on success. A failing publish stays pending."""
    publisher = default_publisher() if publisher is None else publisher
    done = []
    for sym in symbols:
        if publisher is None:
            break
        try:
            publisher(store, sym, now=now)
        except Exception as e:  # noqa: BLE001 -- publishing never fails an ingest
            log.warning("econ.ingest: publish %s failed: %s", sym, secrets.safe_exc(e))
            continue
        cur.update_series_ops(store, sym, now, publish_pending_at=None)
        done.append(sym)
    return done


def republish_pending(store, now: int, publisher=None) -> list:
    """Boot recovery: re-publish every series whose rows were written but whose
    publish was never confirmed (crash between write and publish). Idempotent."""
    cur.ensure_ops_schema(store)
    pend = [r[0] for r in store.conn.execute(
        "SELECT series_id FROM series_ops WHERE publish_pending_at IS NOT NULL ORDER BY series_id")]
    return publish_symbols(store, pend, now, publisher)


# ─────────────────────────────── the pipeline ────────────────────────────────

# A provider that says its quota is spent (BLS keyless: REQUEST_NOT_PROCESSED "daily threshold") is
# blocked for QUOTA_PROBE_S, capped at the adapter's `not_before`. Not "until the next ET midnight":
# observed 2026-09-29 00:11 ET, BLS v1 still refused after the ET day rolled over (4 queries in), so
# the provider's reset time is unknown; a 3 h probe costs at most ~8 refused queries a day.
QUOTA_PROBE_S = 3 * 3600


def _classify_error(e: BaseException) -> str:
    if isinstance(e, (MalformedPayload, ValidationFailed)):
        return "validation"
    if getattr(e, "reason", None) == "quota":
        return "quota"
    return "source"


def quota_block_until(e: BaseException, now: int) -> int:
    nb = getattr(e, "not_before", None)
    until = now + QUOTA_PROBE_S
    return min(int(nb), until) if isinstance(nb, (int, float)) and nb > now else until


def run_fetch(store, specs, mode: str, now: int, http, adapter, *, start: Optional[date] = None,
              end: Optional[date] = None, purpose: Optional[str] = None, run_id: Optional[str] = None,
              entries=None, publisher=None, publish: bool = True, lookup=None,
              events_for: Optional[Callable] = None) -> FetchOutcome:
    """One adapter call for `specs` + everything downstream. mode: 'latest'|'history'.
    purpose: 'live' (default for latest) | 'backfill' (default for history) | 'reconcile'."""
    now = int(now)
    cur.ensure_ops_schema(store)
    specs = [s for s in as_specs(specs) if not s.derivation]
    purpose = purpose or ("live" if mode == "latest" else "backfill")
    run_id = run_id or f"{purpose}-{now}"
    out = FetchOutcome(adapter=getattr(adapter, "name", "?"), mode=mode, now=now)
    if not specs:
        return out
    syms = [s.symbol for s in specs]
    for s in syms:
        out.series[s] = SeriesResult(s)
    call_acq = store.record_acquisition(out.adapter, f"call:{out.adapter}:{mode}:{','.join(sorted(syms))}"[:900],
                                        started_at=now)
    out.acq_ids.append(call_acq)
    dh = DeferringHttp(http) if http is not None else None
    try:
        results = adapter.fetch(specs, mode=mode, start=start, end=end, http=dh)
    except Exception as e:  # noqa: BLE001 -- every failure is recorded, redacted, and survivable
        msg = secrets.safe_exc(e)
        kind = _classify_error(e)
        store.finish_acquisition(call_acq, outcome="error", error=msg, finished_at=now)
        out.ok, out.error, out.error_kind = False, msg, kind
        for s in syms:
            out.series[s].status = "error"
            out.series[s].reasons = [msg]
            if kind == "validation":
                store.add_validation_event(s, "reject", [f"schema: provider payload refused ({type(e).__name__})"],
                                           acq_id=call_acq, at=now)
            cur.note_failure(store, s, now, kind, msg,
                             blocked_until=quota_block_until(e, now) if kind == "quota" else None)
        cur.update_provider_ops(store, out.adapter, now, consecutive_failures=int(
            cur.provider_ops(store, out.adapter).get("consecutive_failures") or 0) + 1,
            last_error=msg[:500], last_error_at=now,
            **({"backoff_until": quota_block_until(e, now)} if kind == "quota" else {}))
        if dh:
            dh.drop()
        _refresh_states(store, specs, now, entries, lookup, events_for)
        return out
    results = list(results or [])
    out.results = len(results)
    store.finish_acquisition(call_acq, outcome="ok", http_status=results[0].http_status if results else None,
                             finished_at=now)
    cur.update_provider_ops(store, out.adapter, now, consecutive_failures=0, last_success_at=now)

    by_sym = {s.symbol: s for s in specs}
    per_result_acq = []
    rejected_any = False
    accepted_by_sym: dict[str, list] = {}
    pub_by_sym: dict[str, Optional[int]] = {}
    seen_sym: set = set()
    for r in results:
        acq = store.record_acquisition(out.adapter, secrets.redact(r.request_key)[:900], started_at=now)
        out.acq_ids.append(acq)
        ref = archive_payload(out.adapter, r.raw_payload, r.payload_sha256)
        covered = sorted({o.series_id for o in r.observations} & set(syms)) or (syms if r.not_modified else [])
        outcome = "not_modified" if r.not_modified else "ok"
        if r.not_modified:
            for s in covered:
                seen_sym.add(s)
                if out.series[s].status == "pending":
                    out.series[s].status = "not_modified"
        else:
            extra = {o.series_id for o in r.observations} - set(syms)
            targets = covered or []
            if extra:
                targets = sorted(set(targets) | set(syms))
            for s in targets:
                seen_sym.add(s)
                acc, reasons = validate.validate_fetch(by_sym[s], r, store, now=now, mode=mode,
                                                       start=start.isoformat() if start else None,
                                                       end=end.isoformat() if end else None, requested_ids=syms)
                if reasons:
                    rejected_any = True
                    outcome = "rejected"
                    store.add_validation_event(s, validate.severity(reasons), reasons, acq_id=acq, at=now)
                    out.series[s].status = "rejected"
                    out.series[s].reasons = reasons
                    accepted_by_sym.pop(s, None)
                    continue
                if out.series[s].status == "rejected":
                    continue
                accepted_by_sym.setdefault(s, []).extend(acc)
                if r.source_published_at is not None:
                    pub_by_sym[s] = max(pub_by_sym.get(s) or 0, int(r.source_published_at))
        store.finish_acquisition(acq, outcome=outcome, http_status=r.http_status, payload_sha256=r.payload_sha256,
                                 payload_bytes=r.payload_bytes, source_published_at=r.source_published_at,
                                 archive_ref=ref, finished_at=now)
        per_result_acq.append(acq)

    if dh is not None:
        # a rejected payload OR a requested series the payload did not carry must
        # not arm a conditional GET: the next poll would be a 304 and never recover
        if rejected_any or (set(syms) - seen_sym):
            dh.drop()
        else:
            out.validators_committed = dh.commit()

    acq_for_rows = per_result_acq[0] if per_result_acq else call_acq
    touched: list[str] = []
    for s in syms:
        res = out.series[s]
        spec = by_sym[s]
        if res.status == "rejected":
            cur.note_failure(store, s, now, "validation", "; ".join(res.reasons)[:500])
            continue
        if s not in seen_sym:
            res.status = "empty"
            cur.note_failure(store, s, now, "empty", "provider returned no observations for this series")
            continue
        acc = accepted_by_sym.get(s, [])
        uniq = {}
        for o in acc:
            uniq[o.period_start] = o
        acc = [uniq[p] for p in sorted(uniq)]
        evs = (events_for(spec) if events_for else cal.load_events(store, _spec_key(spec), now)) \
            if _spec_key(spec) else []
        try:
            groups = _classify(store, spec, acc, purpose=purpose, now=now, events=evs,
                               published_at=pub_by_sym.get(s), adapter=out.adapter, run_id=run_id,
                               acq_id=acq_for_rows)
        except ValidationFailed as e:
            res.status, res.reasons = "rejected", list(e.reasons)
            store.add_validation_event(s, "reject", e.reasons, acq_id=acq_for_rows, at=now)
            cur.note_failure(store, s, now, "validation", "; ".join(e.reasons))
            continue
        if any(g.rows for g in groups):
            cur.update_series_ops(store, s, now, publish_pending_at=now)
            for g in groups:
                if g.rows:
                    _write_group(store, s, g, acq_for_rows, now, res)
        if res.inserted or res.revised:
            res.status = "written"
            touched.append(s)
        elif res.status == "pending":
            res.status = "unchanged"
        cur.note_success(store, s, now, published_at=pub_by_sym.get(s))
        if purpose == "reconcile":
            cur.update_series_ops(store, s, now, last_reconcile_at=now)
        elif purpose == "backfill":
            cur.update_series_ops(store, s, now, last_backfill_at=now)

    ents = _registry_entries(entries)
    derived_specs = downstream_derived(touched, ents) if touched else []
    for d in derived_specs:
        cur.update_series_ops(store, d["symbol"], now, publish_pending_at=now)
        try:
            n = _derive(store, d)
        except Exception as e:  # noqa: BLE001 -- a derivation bug never loses the parent write
            log.warning("econ.ingest: derive %s failed: %s", d["symbol"], secrets.safe_exc(e))
            continue
        out.derived[d["symbol"]] = n
    if publish:
        pend = touched + [d["symbol"] for d in derived_specs]
        out.published = publish_symbols(store, pend, now, publisher)
    _refresh_states(store, list(specs) + [SeriesSpec(d) for d in derived_specs], now, ents, lookup, events_for)
    return out


def _derive(store, entry) -> int:
    from . import derive
    return derive.derive_and_write(store, entry, calendar_key=(entry.get("release") or {}).get("calendar_key"))


def _refresh_states(store, specs, now, entries, lookup, events_for) -> None:
    for sp in specs:
        try:
            evs = events_for(sp) if events_for else None
            cur.refresh_state(store, sp, now, events=evs, lookup=lookup)
        except Exception as e:  # noqa: BLE001
            log.warning("econ.ingest: state refresh %s failed: %s", _g(sp, "symbol"), secrets.safe_exc(e))


def _http_total(http, host: Optional[str] = None) -> int:
    stats = getattr(http, "stats", None)
    if not callable(stats):
        return 0
    st_ = stats()
    if host:
        return sum((st_.get("by_host") or {}).get(host, {}).values())
    return int(st_.get("total") or 0)


def backfill_refusal(spec) -> Optional[str]:
    """Why a backfill must NOT ingest this entry (None = allowed). Only enabled,
    production-eligible series are ever written as production data: an
    unverified / disabled / excluded / RED / FRED entry is refused here even when
    named explicitly on the command line."""
    raw = spec.raw if hasattr(spec, "raw") else spec
    status = raw.get("status")
    if status != "enabled":
        return f"status {status or 'missing'} (only enabled series are ingested)"
    from .licensing import production_eligible
    ok, why = production_eligible(raw)
    return None if ok else why


def backfill(store, specs, start: Optional[date] = None, *, http, now: int, adapter_for=None,
             end: Optional[date] = None,
             run_id: Optional[str] = None, entries=None, publisher=None, publish: bool = True,
             lease_wait_s: float = 120, sleep: Callable[[float], None] = time.sleep,
             clock: Callable[[], float] = time.time) -> list[FetchOutcome]:
    """Full history for `specs` (derived specs are recomputed from their inputs).
    One 'backfill:<series>:<run_id>' release per series; re-running writes nothing new.
    Non-production entries are refused (see `backfill_refusal`); BLS requests are
    charged to `provider_quota` so a running service sees the day's true usage."""
    from .adapters import get_adapter
    adapter_for = adapter_for or get_adapter
    run_id = run_id or f"run{int(now)}"
    groups: dict[str, list] = {}
    for s in as_specs(specs):
        why = backfill_refusal(s)
        if why:
            log.warning("econ.backfill: refusing %s: %s", s.symbol, why)
            continue
        if s.derivation:
            continue
        groups.setdefault(s.adapter, []).append(s)
    outs = []
    from .scheduler import default_owner
    owner = f"backfill:{default_owner()}"
    for name, group in sorted(groups.items()):
        # a provider that refused for quota (or is backing off) is not asked again by a backfill
        bo = cur.provider_ops(store, name).get("backoff_until")
        if bo and int(bo) > clock():
            outs.append(FetchOutcome(adapter=name, mode="history", now=now, ok=False, error_kind="backoff",
                                     error=f"provider {name} backing off until {int(bo)}; not sent"))
            continue
        # the same lease the service's scheduler takes, so a backfill never races a live job
        lease = f"ingest:{name}"
        deadline = clock() + lease_wait_s
        while not store.acquire_lease(lease, owner, 1800, now=int(clock())):
            if clock() >= deadline:
                break
            sleep(2)
        if store.lease_holder(lease, now=int(clock())) != owner:
            outs.append(FetchOutcome(adapter=name, mode="history", now=now, ok=False, error_kind="lease",
                                     error=f"lease {lease} held by another process; not sent"))
            continue
        host = "api.bls.gov" if name == "bls" else None
        t0, n0, b0 = time.perf_counter(), _http_total(http), _http_total(http, host)
        try:
            o = run_fetch(store, group, "history", now, http, adapter_for(name), start=start, end=end,
                          purpose="backfill", run_id=run_id, entries=entries, publisher=publisher,
                          publish=publish)
        finally:
            store.release_lease(lease, owner)
        o.elapsed_s = round(time.perf_counter() - t0, 3)
        o.requests = _http_total(http) - n0
        if host and http is not None:
            used = _http_total(http, host) - b0
            if used:
                from .scheduler import quota_add
                quota_add(store, name, now, used)
        outs.append(o)
    return outs
