"""Economic data -- the WIRE FORMAT and its published artifacts.

ONE builder for the member payload (`build_series_payload`), used by BOTH the
publisher (service side, writes artifacts) and the `db` serving mode (dev/tests),
so the artifact a member reads in production and the payload a test asserts are
the same function's output.

WIRE FORMAT (docs/economic-data/PHASE1-DESIGN.md "Member API"; the frontend
reader is app/src/components/chart/engine/economicSeries.js):

    {"id": "ECON:USCPI", "symbol": "USCPI", "view": "latest"|"asof", "asof": null|int,
     "meta": {...catalog row...},
     "currentness": {"state", "latest_period", "expected_period", "next_release"}
                    (an ?asof= view: {"state": null, "historical": true}),
     "columns": ["t", "v", "ps", "pe", "pit"],
     "points": [[t_first_available_unix, v|null, "YYYY-MM-DD", "YYYY-MM-DD", "V|U|L|X"], ...]}

PLACEMENT (owner ruling #5/#6): a point sits at its period's FIRST availability
(`LatestRow.first_available_at`) and carries its LATEST(-as-of) value. Never at
period_end, never at the latest revision's time. Sorted by (t, pe).

META IS A WHITELIST (`meta_for`). Registry entries carry licensing internals,
adapter params and catalog provenance (incl. FRED equivalents); none of it may
reach a member. Every key in the payload is named below -- adding one is an
edit here AND in tests/econ/test_serving.py's whitelist.

ARTIFACTS (content-addressed: ETag = sha256 of the canonical JSON, first 32 hex):
    econ/v1/series/<SYMBOL>.json.gz     latest view (the payload above), gzip
    econ/v1/vintages/<SYMBOL>.json.gz   EVERY stored vintage, compact, gzip -- lets
                                        the web answer ?asof= without the DB
    econ/v1/catalog.json                servable member series + attribution notices
    econ/v1/status.json                 dates/states only, NEVER values (heartbeat)

TARGETS: a local directory (`ECON_ARTIFACT_DIR`) and/or R2 through
`api.services.data_sync.put_bytes` -- R2 only when `ECON_PUBLISH_R2=1` AND
data_sync has credentials. Idempotent: a target whose current object already
has the same content hash is not rewritten (checked against an in-process memo,
then the object itself, so a restart does not re-upload everything).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import threading
import time
from datetime import date
from typing import Any, Iterable, Optional

from . import licensing
from . import registry as R
from .model import Currentness, Role, SeriesStatus, canonical_id

ARTIFACT_FORMAT = 1
PREFIX = "econ/v1"
CATALOG_KEY = f"{PREFIX}/catalog.json"
STATUS_KEY = f"{PREFIX}/status.json"
COLUMNS = ["t", "v", "ps", "pe", "pit"]
VINTAGE_COLUMNS = ["ps", "pe", "t", "v", "pit", "r"]

# Notice fields a member may see (attributions.json also carries terms quotes and
# internal notes; the chart needs the notice, not the lawyering).
_NOTICE_FIELDS = ("agency", "text", "notice_required", "access_date_required", "derived_rule", "source_url")
# series_state fields that may leave the service (status + currentness).
_STATUS_FIELDS = ("state", "latest_period", "expected_period", "last_success_at")


class PublishFailed(RuntimeError):
    """A target refused a write (data_sync.put_bytes returned False). Raised so the
    ingest pipeline leaves the symbol publish-pending and retries."""


class NotServable(LookupError):
    """The symbol is not an enabled, production-eligible MEMBER series."""


def series_key(symbol: str) -> str:
    return f"{PREFIX}/series/{symbol}.json.gz"


def vintages_key(symbol: str) -> str:
    return f"{PREFIX}/vintages/{symbol}.json.gz"


# ─────────────────────────────────────────────────────────────── servability

def servable(entry: Optional[dict]) -> tuple[bool, str]:
    """May a member read this entry? enabled + member + production_eligible.

    Disabled / unverified / excluded / support-only / RED / FRED -> refused. The
    registry rails already forbid most of these combinations; this is re-checked
    at publish AND at serve time (belt and braces), because a hand edit that the
    rails missed must fail closed at the member door, not leak partial data."""
    if not entry:
        return False, "unknown symbol"
    if entry.get("status") != SeriesStatus.ENABLED.value:
        return False, f"status {entry.get('status')}"
    if entry.get("role") != Role.MEMBER.value:
        return False, f"role {entry.get('role')}"
    if not (entry.get("source") or {}).get("verified"):
        return False, "source not verified"
    ok, why = licensing.production_eligible(entry)
    return (True, "ok") if ok else (False, why)


def resolve(symbol: str) -> Optional[dict]:
    """'USCPI' | 'ECON:USCPI' | 'econ:USCPI' -> the registry entry IF servable, else None."""
    if not isinstance(symbol, str) or not symbol.strip() or len(symbol) > 64:
        return None
    s = symbol.strip()
    if ":" in s:
        from .model import parse_canonical
        sym = parse_canonical(s)
        if not sym:
            return None
    else:
        from .model import SYMBOL_RE_MATCH
        sym = s.upper()
        if not SYMBOL_RE_MATCH(sym):
            return None
    e = R.get(sym)
    return e if servable(e)[0] else None


# ─────────────────────────────────────────────────────────────── meta (whitelist)

def attribution_keys(entry: dict) -> list[str]:
    lic = entry.get("licensing") or {}
    keys = []
    for k in [lic.get("attribution_key")] + list(lic.get("attribution_keys") or []):
        if k and k not in keys:
            keys.append(k)
    return keys


def notices(keys: Iterable[str]) -> dict:
    """{key: {agency, text, notice_required, ...}} -- public notice text only."""
    allk = R.load_attributions()
    out = {}
    for k in keys:
        n = allk.get(k)
        if isinstance(n, dict):
            out[k] = {f: n[f] for f in _NOTICE_FIELDS if f in n}
    return out


def meta_for(entry: dict) -> dict:
    """The catalog row / series meta. WHITELIST -- see module docstring."""
    src = entry.get("source") or {}
    lic = entry.get("licensing") or {}
    units = entry.get("units") or {}
    der = entry.get("derivation")
    keys = attribution_keys(entry)
    m = {
        "symbol": entry["symbol"],
        "id": canonical_id(entry["symbol"]),
        "name": entry["name"],
        "short_name": entry["short_name"],
        "description": entry["description"],
        "category": entry["category"],
        "subcategory": entry["subcategory"],
        "frequency": entry["frequency"],
        "week_anchor": entry["week_anchor"],
        "units": {"display": units.get("display"), "fmt": units.get("fmt"), "scale": units.get("scale")},
        "seasonal_adjustment": entry["seasonal_adjustment"],
        "presentation": {"style": (entry.get("presentation") or {}).get("style")},
        "source": {
            "agency": src.get("agency"),
            "dataset": src.get("dataset"),
            "provider_series_id": src.get("provider_series_id") or None,
            "official_url": src.get("official_url") or None,
            "attribution_key": keys[0] if keys else None,
            "line": lic.get("source_line") or None,
        },
        # a UCT calculation must SAY so (BLS/BEA/Census terms: derived values may
        # not be presented as the agency's own) -- op + input symbols, nothing else
        "derivation": ({"op": der.get("op"), "inputs": list(der.get("inputs") or [])}
                       if isinstance(der, dict) else None),
        "aliases": list(entry.get("aliases") or []),
        "synonyms": list(entry.get("synonyms") or []),
        "history_start": entry.get("history_start"),
    }
    if len(keys) > 1:
        m["source"]["attribution_keys"] = keys
    # days a value stays current, measured from its AVAILABILITY `t` (null = unlimited);
    # registry frequency default or `presentation.max_age_days` -- see registry.max_age_days
    m["max_age_days"] = R.max_age_days(entry)
    return m


def catalog_payload(entries: Optional[Iterable[dict]] = None) -> dict:
    rows = [meta_for(e) for e in (R.load_registry() if entries is None else entries) if servable(e)[0]]
    rows.sort(key=lambda r: r["symbol"])
    keys: list[str] = []
    for r in rows:
        for k in r["source"].get("attribution_keys") or [r["source"]["attribution_key"]]:
            if k and k not in keys:
                keys.append(k)
    return {"v": ARTIFACT_FORMAT, "series": rows, "attributions": notices(sorted(keys))}


# ─────────────────────────────────────────────────────────────── currentness

def _today_et(now: Optional[float]) -> str:
    from .timeutil import et_date
    return et_date(time.time() if now is None else now).isoformat()


def _release_view(ev: dict) -> dict:
    """A hole (precision 'unknown') has no real date -- its sched_date is only the
    earliest day it could appear -- so it is published with date/time null."""
    prec = ev.get("precision")
    if prec == "unknown":
        return {"date": None, "time": None, "tz": ev.get("tz"), "precision": "unknown"}
    return {"date": ev["sched_date"], "time": ev.get("sched_time"), "tz": ev.get("tz"), "precision": prec}


def _is_future(ev: dict, now: float) -> bool:
    from .calendar import Event
    try:
        return Event.from_row(ev).scheduled_at > now
    except Exception:  # noqa: BLE001
        return False


def next_release(store, entry: dict, now: Optional[float] = None, state: Optional[dict] = None) -> Optional[dict]:
    """The first FUTURE event of the series' calendar.

    Prefers `series_state.next_event_id` (currentness.py's first event with
    scheduled_at > now on the series' frequency grid). Falls back to the calendar
    only when that pointer is missing or stale, and then skips events that have
    already passed: `store.next_event(key, today)` is date-granular and would hand
    back a daily 09:00 event at 15:00 ET."""
    key = ((entry.get("release") or {}).get("calendar_key"))
    if not key:
        return None
    now = time.time() if now is None else now
    try:
        if state is None:
            state = store.get_state(entry["symbol"])
        eid = (state or {}).get("next_event_id")
        if eid is not None:
            ev = store.get_event(int(eid))
            if ev and ev.get("superseded_at") is None and ev.get("calendar_key") == key and _is_future(ev, now):
                return _release_view(ev)
        for ev in store.events(key, start=_today_et(now)):
            if _is_future(ev, now):
                return _release_view(ev)
    except Exception:  # noqa: BLE001 -- a calendar read must never break a payload
        return None
    return None


def currentness(store, entry: dict, now: Optional[float] = None) -> dict:
    """From `series_state` (owned by currentness.py) + the next calendar event.

    No state row -> UNINITIALIZED when nothing is stored, else NO_EXPECTATION: this
    layer never INFERS currentness, and may never claim CURRENT on its own."""
    sym = entry["symbol"]
    st = None
    try:
        st = store.get_state(sym)
    except Exception:  # noqa: BLE001
        st = None
    if st:
        state = st.get("state") or Currentness.NO_EXPECTATION.value
        latest_period, expected_period = st.get("latest_period"), st.get("expected_period")
    else:
        newest = store.period_bounds(sym).get("newest")
        state = (Currentness.NO_EXPECTATION if newest else Currentness.UNINITIALIZED).value
        latest_period, expected_period = newest, None
    if state not in {c.value for c in Currentness}:
        state = Currentness.NO_EXPECTATION.value
    return {"state": state, "latest_period": latest_period, "expected_period": expected_period,
            "next_release": next_release(store, entry, now, state=st or {})}


def historical_currentness() -> dict:
    """The currentness block of an AS-OF payload. `series_state` describes NOW; an
    `?asof=T` answer is history, so it carries no state, periods or next release
    (measured 2026-09-29: the FHFA view one second before the July release still said
    CURRENT with latest_period 2026-07). The frontend pins as-of to historical too."""
    return {"state": None, "historical": True}


# ─────────────────────────────────────────────────────────────── points

def _valid_iso(d: Optional[str]) -> Optional[str]:
    if d is None:
        return None
    date.fromisoformat(d)          # raises ValueError on garbage -- callers validate first
    return d


def points_from_store(store, symbol: str, asof: Optional[int] = None, start: Optional[str] = None,
                      end: Optional[str] = None) -> list[list]:
    rows = store.latest_rows(symbol, asof=asof, start=start, end=end)
    pts = [[int(r.first_available_at), r.value, r.period_start, r.period_end, r.pit_class] for r in rows]
    pts.sort(key=lambda p: (p[0], p[3]))
    return pts


def points_from_vintages(rows: list[list], asof: Optional[int] = None, start: Optional[str] = None,
                         end: Optional[str] = None) -> list[list]:
    """The SAME answer as `points_from_store`, computed from a vintages artifact.

    rows = [[ps, pe, t, v, pit, release_id], ...]. Per period: the vintages visible
    at asof; value/pit/pe from the max (t, release_id); t = min visible t.
    tests/econ/test_publish.py proves parity with the store on a revised series."""
    best: dict[str, list] = {}
    first: dict[str, int] = {}
    for ps, pe, t, v, pit, rid in rows:
        if asof is not None and t > asof:
            continue
        if start is not None and ps < start:
            continue
        if end is not None and ps > end:
            continue
        if ps not in first or t < first[ps]:
            first[ps] = t
        b = best.get(ps)
        if b is None or (t, rid) > (b[2], b[5]):
            best[ps] = [ps, pe, t, v, pit, rid]
    pts = [[int(first[ps]), b[3], ps, b[1], b[4]] for ps, b in best.items()]
    pts.sort(key=lambda p: (p[0], p[3]))
    return pts


def build_series_payload(store, symbol: str, asof: Optional[int] = None, start: Optional[str] = None,
                         end: Optional[str] = None, *, now: Optional[float] = None) -> dict:
    """THE wire payload. Raises NotServable for anything a member may not read."""
    entry = resolve(symbol)
    if entry is None:
        raise NotServable(symbol)
    sym = entry["symbol"]
    _valid_iso(start), _valid_iso(end)
    return {
        "id": canonical_id(sym),
        "symbol": sym,
        "view": "asof" if asof is not None else "latest",
        "asof": int(asof) if asof is not None else None,
        "meta": meta_for(entry),
        "currentness": historical_currentness() if asof is not None else currentness(store, entry, now),
        "columns": list(COLUMNS),
        "points": points_from_store(store, sym, asof=asof, start=start, end=end),
    }


def build_vintages_payload(store, symbol: str) -> dict:
    entry = resolve(symbol)
    if entry is None:
        raise NotServable(symbol)
    sym = entry["symbol"]
    rows = [[o.period_start, o.period_end, int(o.available_at), o.value, o.pit_class, int(o.release_id)]
            for o in store.vintages(sym)]
    return {"v": ARTIFACT_FORMAT, "symbol": sym, "columns": list(VINTAGE_COLUMNS), "rows": rows}


def status_payload(store, *, now: Optional[float] = None, entries: Optional[Iterable[dict]] = None,
                   heartbeat: Optional[dict] = None) -> dict:
    """Dates and states ONLY. Never a value -- this is the unauthenticated surface."""
    now = time.time() if now is None else now
    out = []
    for e in (R.load_registry() if entries is None else entries):
        if not servable(e)[0]:
            continue
        cur = currentness(store, e, now)
        st = None
        try:
            st = store.get_state(e["symbol"])
        except Exception:  # noqa: BLE001
            pass
        out.append({"symbol": e["symbol"], "state": cur["state"], "latest_period": cur["latest_period"],
                    "expected_period": cur["expected_period"], "next_release": cur["next_release"],
                    "last_success_at": (st or {}).get("last_success_at")})
    out.sort(key=lambda r: r["symbol"])
    succ = [r["last_success_at"] for r in out if isinstance(r["last_success_at"], int)]
    hb = {"published_at": int(now), "last_success_at": max(succ) if succ else None}
    if heartbeat:
        hb.update({k: v for k, v in heartbeat.items() if isinstance(v, (int, float, str, bool)) or v is None})
    return {"v": ARTIFACT_FORMAT, "service": hb, "series": out}


# ─────────────────────────────────────────────────────────────── encoding

def canonical_json(doc: Any) -> bytes:
    return json.dumps(doc, separators=(",", ":"), sort_keys=True, allow_nan=False).encode()


def etag_of(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()[:32]


def encode(doc: dict, *, gz: bool) -> tuple[bytes, str]:
    """(object bytes, content etag). The etag is of the JSON, so the gzip wrapper
    (deterministic: mtime=0) never changes it."""
    body = canonical_json(doc)
    return (gzip.compress(body, compresslevel=9, mtime=0) if gz else body), etag_of(body)


def decode(data: Optional[bytes]) -> Optional[dict]:
    if not data:
        return None
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return json.loads(data)


# ─────────────────────────────────────────────────────────────── targets

_memo: dict[tuple[str, str], str] = {}
_memo_lock = threading.Lock()


def artifact_dir() -> Optional[str]:
    return os.environ.get("ECON_ARTIFACT_DIR") or None


def r2_enabled() -> bool:
    if os.environ.get("ECON_PUBLISH_R2", "0") != "1":
        return False
    try:
        from api.services import data_sync
        return bool(data_sync.credentials_ok())
    except Exception:  # noqa: BLE001
        return False


def _local_path(root: str, key: str) -> str:
    return os.path.join(root, *key.split("/"))


def _read_local(root: str, key: str) -> Optional[bytes]:
    p = _local_path(root, key)
    if not os.path.exists(p):
        return None
    with open(p, "rb") as f:
        return f.read()


def _put_local(root: str, key: str, body: bytes) -> None:
    path = _local_path(root, key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, path)


def _targets(local_root: Optional[str], r2: Optional[bool]) -> list[tuple[str, Any, Any]]:
    """[(name, reader(key)->bytes|None, writer(key, bytes, ctype)->bool)]."""
    out = []
    root = local_root if local_root is not None else artifact_dir()
    if root:
        out.append(("local:" + os.path.abspath(root), lambda k: _read_local(root, k),
                    lambda k, b, ct: (_put_local(root, k, b), True)[1]))
    if (r2_enabled() if r2 is None else r2):
        from api.services import data_sync
        out.append(("r2", data_sync.get_bytes, data_sync.put_bytes))
    return out


def _existing_etag(read, key: str) -> Optional[str]:
    try:
        doc = decode(read(key))
    except Exception:  # noqa: BLE001 -- unreadable = rewrite it
        return None
    return etag_of(canonical_json(doc)) if doc is not None else None


def _publish_doc(key: str, doc: dict, *, gz: bool, local_root: Optional[str], r2: Optional[bool],
                 force: bool = False) -> dict:
    data, etag = encode(doc, gz=gz)
    ctype = "application/gzip" if gz else "application/json"
    written, skipped, failed = [], [], []
    for name, read, write in _targets(local_root, r2):
        mk = (name, key)
        if not force:
            with _memo_lock:
                same = _memo.get(mk) == etag
            if not same:
                same = _existing_etag(read, key) == etag
            if same:
                with _memo_lock:
                    _memo[mk] = etag
                skipped.append(name)
                continue
        ok = write(key, data, ctype)
        if ok:
            with _memo_lock:
                _memo[mk] = etag
            written.append(name)
        else:
            failed.append(name)
    return {"key": key, "etag": etag, "bytes": len(data), "written": written, "unchanged": skipped,
            "failed": failed}


def clear_memo() -> None:
    with _memo_lock:
        _memo.clear()


def publish_series(store, symbol: str, *, local_root: Optional[str] = None, r2: Optional[bool] = None,
                   now: Optional[float] = None) -> dict:
    """Publish one series' latest-view payload + its vintages artifact (each only if
    its content changed). A non-servable symbol publishes NOTHING."""
    entry = resolve(symbol)
    if entry is None:
        return {"symbol": symbol, "published": False, "reason": servable(R.get(symbol))[1]}
    sym = entry["symbol"]
    payload = build_series_payload(store, sym, now=now)
    if not payload["points"]:
        # nothing validated yet: publish nothing, so the member door answers 404
        # (NO_DATA) rather than a 200 that looks like an empty series
        return {"symbol": sym, "published": False, "reason": "no data"}
    series = _publish_doc(series_key(sym), payload, gz=True, local_root=local_root, r2=r2)
    vint = _publish_doc(vintages_key(sym), build_vintages_payload(store, sym), gz=True,
                        local_root=local_root, r2=r2)
    failed = series["failed"] + vint["failed"]
    if failed:
        # a caller (ingest.publish_symbols) keeps the symbol pending on an exception
        raise PublishFailed(f"{sym}: artifact write failed on {sorted(set(failed))}")
    return {"symbol": sym, "published": bool(series["written"] or vint["written"]),
            "series": series, "vintages": vint}


def publish_catalog(*, local_root: Optional[str] = None, r2: Optional[bool] = None) -> dict:
    return _publish_doc(CATALOG_KEY, catalog_payload(), gz=False, local_root=local_root, r2=r2)


def publish_status(store, *, local_root: Optional[str] = None, r2: Optional[bool] = None,
                   now: Optional[float] = None, heartbeat: Optional[dict] = None) -> dict:
    """The status snapshot IS a heartbeat (`service.published_at`), so it is always
    rewritten -- it is ~100 bytes per series."""
    return _publish_doc(STATUS_KEY, status_payload(store, now=now, heartbeat=heartbeat), gz=False,
                        local_root=local_root, r2=r2, force=True)


def publish_all(store, *, local_root: Optional[str] = None, r2: Optional[bool] = None,
                now: Optional[float] = None, heartbeat: Optional[dict] = None) -> dict:
    """Every servable series + catalog + status. For the service's publish step."""
    res = {"series": {}}
    for e in R.load_registry():
        if servable(e)[0]:
            res["series"][e["symbol"]] = publish_series(store, e["symbol"], local_root=local_root, r2=r2, now=now)
    res["catalog"] = publish_catalog(local_root=local_root, r2=r2)
    res["status"] = publish_status(store, local_root=local_root, r2=r2, now=now, heartbeat=heartbeat)
    return res
