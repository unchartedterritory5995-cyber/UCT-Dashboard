"""Track 4, unit F1a (2026-11-22): the financial figures a member's Pine script reads with `request.financial`,
served dark, as UCT data from SEC filings.

`request.financial(syminfo.tickerid, "<ID>", "<period>")` reads a company figure. UCT answers it from its own
point-in-time fundamentals store (api/services/fundamentals_pit, #2391), never from TradingView's figures, and a
value read from it is NEVER graded as TradingView's (Studio ruling 2026-11-14: our fundamentals can never grade
MATCH; they are UCT data, said so in the member's words). This module answers `GET /api/pine/financial/{ticker}`
(api/routers/pine_financial.py) for the chart's `request.financial` supply (F1b). Nothing in the engine reads it
until F1b.

WHAT IT SERVES: the (id, period) pairs `pineDataCatalog.json` maps under the `financial` family's `fields`, each
onto the stored series of the SAME definition (catalog.py). Today: TOTAL_REVENUE FQ / TTM, EARNINGS_PER_SHARE_DILUTED
FQ / TTM (GAAP, today's share basis), TOTAL_EQUITY FQ, TOTAL_SHARES_OUTSTANDING FQ and FREE_CASH_FLOW TTM. Any other
id or period is refused by the engine by name (`fieldsRefused`, `periods`); this route never serves one.

POINT IN TIME, per point (one per filing that changed the figure, as the store holds them):
  publicAt    the instant the filing became PUBLIC (unix seconds UTC: acceptance, or 06:00 ET on the filing date for
              a filing disseminated the next business day; filings.py). Never the fiscal period end.
  knownFrom   the session day of the first daily bar that may read it: the first exchange session whose regular
              close (13:00 ET on a half-day) is at or after `publicAt`. A filing public at 16:42 ET is known from the
              NEXT session. This is the store's own "known by the bar's close" rule (asof.py), taken at the
              exchange calendar's close, so a value can only land later than the store's chart, never earlier.
  v           the value (null for a GAP: the store's newest filed period is not derivable, the figure is UNKNOWN
              from this filing on, never the older value carried); `periodEnd`, `method` as the store records them.
  staleFrom   the first day the value is no longer in force: its fiscal period is older than the store's staleness
              cap (asof.MAX_PERIOD_AGE) there. A company that stops filing goes blank, not flat.
Per field: `knownFrom` = its first point's day (before it UCT holds nothing for the figure, so the engine WITHHOLDS
those bars by name, never `na`); `state` ok | missing (the company's filings do not yield it) | withheld (a
per-share or share-count figure while the company's split history is unverified).

THE LANE (E1's, the #2422 pattern): a request is never a store read. In-process copy (`_MEM`, bounded), then the
disk snapshot `<PINE_FINANCIAL_DIR>/<SYM>.json` (temp + os.replace), else `pending` (202) and ONE refresh queued
on a bounded background pool. A copy older than `TTL_S` is served and kicks a refresh. A failed store read keeps
the previous copy, marked `unavailable` with `staleSince`, never an empty answer in its place. The store read
itself (`fundamentals_pit.serving`, the published artifact) runs on the pool only.

LICENCE: the family is read and served only when `pine_data_catalog.family_refusal("financial")` passes it (SEC
EDGAR, class A, licensing register T-83). A refused family answers its guard and sentence; no store read is made.

STAGE: `PINE_FINANCIAL_SUPPLY_ENABLED` (docs/feature_flags.json): unset or `admins` -> signed-in ADMINS only (dark
for members); `all` -> every paid member; `off` or any unknown value -> nobody (404, fail closed).
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

log = logging.getLogger("pine_financial")

SCHEMA = "uct.pine-financial/v1"
FAMILY = "financial"
TTL_S = 12 * 3600
MEM_MAX = 512
FLAG = "PINE_FINANCIAL_SUPPLY_ENABLED"
STAGES = ("off", "admins", "all")
DEFAULT_STAGE = "admins"
#: How far `knownFrom` may walk forward looking for a session (a calendar gap longer than this is a broken calendar).
_SESSION_SEARCH_DAYS = 14


def stage() -> str:
    """off | admins | all. Unset is `admins` (dark for members); an unknown value is `off` (fail closed)."""
    v = (os.environ.get("PINE_FINANCIAL_SUPPLY_ENABLED") or "").strip().lower()
    if not v:
        return DEFAULT_STAGE
    if v in ("1", "true", "yes", "on"):
        return "all"
    return v if v in STAGES else "off"


def _dir() -> str:
    override = os.environ.get("PINE_FINANCIAL_DIR")
    if override:
        return override
    base = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "data"))
    return os.path.join(base, "pine_financial")


def _path(sym: str) -> str:
    # the history lake's encoding (tools/history_lake/FORMAT.md): case and reserved device names are safe
    enc = "s-" + "".join(ch if ("0" <= ch <= "9" or "A" <= ch <= "Z") else "_%02X" % b
                         for ch, b in ((chr(b), b) for b in sym.encode("utf-8")))
    return os.path.join(_dir(), enc + ".json")


# ── the map (pineDataCatalog.json, one authority for this route and the chart) ──────────────────────────────────
def field_map(catalog: Optional[dict] = None) -> dict[str, dict]:
    """`{"TOTAL_REVENUE:FQ": {"id", "period", "series", "unit"}, ...}` from the catalog's `financial.fields`."""
    from api.services import pine_data_catalog as cat
    fields = cat.families(catalog)[FAMILY].get("fields") or {}
    out: dict[str, dict] = {}
    for fid, spec in fields.items():
        if fid.startswith("_") or not isinstance(spec, dict):
            continue
        for period, series in (spec.get("periods") or {}).items():
            out[f"{fid}:{period}"] = {"id": fid, "period": period, "series": series, "unit": spec.get("unit")}
    return out


def _refusal() -> Optional[dict]:
    from api.services import pine_data_catalog as cat
    r = cat.family_refusal(FAMILY)
    return {"guard": r[0], "sentence": r[1]} if r else None


def _disclosure() -> str:
    from api.services import pine_data_catalog as cat
    return cat.disclosure(FAMILY)


# ── point in time ───────────────────────────────────────────────────────────────────────────────────────────────
def _session_close_utc(d: date) -> Optional[datetime]:
    """The regular close of session `d` in UTC (the exchange calendar's, 13:00 ET on a half-day), or None when `d`
    is not a session. Outside the calendar's coverage it degrades to weekday + 16:00 ET (session_calendar's own
    convention: no guess about holidays)."""
    from api.services import session_calendar as sc
    from api.services.fundamentals_pit import asof
    if not sc.covers(d):
        return asof.close_utc(d) if d.weekday() < 5 else None
    ct = sc.close_time(d)               # None on a day that is not a session
    return ct.astimezone(timezone.utc) if ct is not None else None


def known_from(public_at: float) -> Optional[str]:
    """The session day (ISO) of the first daily bar whose close is at or after the instant `public_at` (unix
    seconds UTC). None when no session follows within `_SESSION_SEARCH_DAYS` (never a guess)."""
    from api.services.fundamentals_pit.filings import ET
    t = datetime.fromtimestamp(float(public_at), tz=timezone.utc)
    d = t.astimezone(ET).date()
    for _ in range(_SESSION_SEARCH_DAYS):
        close = _session_close_utc(d)
        if close is not None and close >= t:
            return d.isoformat()
        d += timedelta(days=1)
    return None


def _period_end(raw: Any) -> Optional[str]:
    """The store writes a period end as ISO (V4 artifacts) or YYYYMMDD (V5): ISO either way, None when unreadable."""
    try:
        if isinstance(raw, int) and not isinstance(raw, bool):
            return date(raw // 10000, raw // 100 % 100, raw % 100).isoformat()
        if isinstance(raw, str) and raw:
            return date.fromisoformat(raw[:10]).isoformat()
    except ValueError:
        return None
    return None


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def points_of(rows: list) -> list[dict]:
    """The store's points (`[t_eff, v, period_end, method]`, ascending) as this route serves them. A row whose
    instant or period cannot be read is dropped (never placed on a guessed bar)."""
    from api.services.fundamentals_pit import asof
    out = []
    for r in rows or []:
        if not isinstance(r, (list, tuple)) or len(r) < 4:
            continue
        t_eff, v, pe, method = r[0], r[1], r[2], r[3]
        if _num(t_eff) is None:
            continue
        period_end = _period_end(pe)
        kf = known_from(float(t_eff))
        if period_end is None or kf is None:
            continue
        gap = method == "gap" or _num(v) is None
        stale = (date.fromisoformat(period_end) + asof.MAX_PERIOD_AGE + timedelta(days=1)).isoformat()
        out.append({"publicAt": int(float(t_eff)), "knownFrom": kf, "v": None if gap else _num(v),
                    "periodEnd": period_end, "method": "gap" if gap else str(method),
                    "staleFrom": None if gap else stale})
    out.sort(key=lambda p: p["publicAt"])
    return out


# ── the store read (the background pool only) ───────────────────────────────────────────────────────────────────
def _read_store(sym: str) -> dict:
    """`{"company": {...} | None, "metrics": {...}, "source": {...}}` for `sym` from the published artifact."""
    from api.services.fundamentals_pit import serving
    source = serving.current_source()
    cik = source.cik_for(sym)
    art = source.artifact_for(cik) if cik is not None else None
    src = {"store": "fundamentals_pit", "derivationVersion": source.version, "serving": source.tag()}
    if art is None:
        return {"company": None, "metrics": {}, "source": src}
    company = {"cik": art.get("cik"), "name": art.get("name"), "builtAt": art.get("built_at"),
               "splitStatus": art.get("split_status"),
               "withheldSplitSensitive": bool(art.get("withheld_split_sensitive", False))}
    return {"company": company, "metrics": art.get("metrics") or {}, "source": src}


def _split_sensitive() -> frozenset:
    from api.services.fundamentals_pit.split_ledger import SPLIT_SENSITIVE_METRICS
    return SPLIT_SENSITIVE_METRICS


def build_fields(store: dict, catalog: Optional[dict] = None) -> dict:
    """Every mapped field's block from one store read."""
    company = store.get("company")
    metrics = store.get("metrics") or {}
    withheld = bool(company and company.get("withheldSplitSensitive"))
    out = {}
    for key, spec in field_map(catalog).items():
        block = {"id": spec["id"], "period": spec["period"], "series": spec["series"], "unit": spec["unit"]}
        if company is None:
            out[key] = {**block, "state": "none", "points": [], "knownFrom": None}
            continue
        if withheld and spec["series"] in _split_sensitive():
            out[key] = {**block, "state": "withheld", "points": [], "knownFrom": None,
                        "why": "the company's split history could not be verified, so per-share and share-count "
                               "figures are withheld"}
            continue
        pts = points_of(metrics.get(spec["series"]) or [])
        first = next((p for p in pts if p["v"] is not None), None)
        if first is None:
            out[key] = {**block, "state": "missing", "points": [], "knownFrom": None,
                        "why": "the company's filings do not yield this figure"}
            continue
        # ⛔ a leading GAP is not a value: the field is known from its first VALUE
        pts = pts[pts.index(first):]
        out[key] = {**block, "state": "ok", "points": pts, "knownFrom": first["knownFrom"]}
    return out


def refresh(sym: str, now: Optional[float] = None) -> dict:
    """Read `sym` from the store and write the snapshot atomically. Runs on the background pool only."""
    now = time.time() if now is None else now
    prev = _read_disk(sym)
    refused = _refusal()
    doc: dict = {"schema": SCHEMA, "symbol": sym, "family": FAMILY, "refreshedAt": now}
    if refused:
        doc.update({"familyState": "refused", "refusal": refused, "fields": {}})
    else:
        try:
            store = _read_store(sym)
        except Exception as e:  # noqa: BLE001 - any store failure keeps the copy we have, by name
            log.warning("pine_financial refresh FAILED %s: %s", sym, type(e).__name__)
            if prev and prev.get("familyState") in ("ok", "none", "unavailable") and prev.get("fields"):
                kept = dict(prev)
                kept["familyState"] = "unavailable"
                kept["staleSince"] = prev.get("staleSince") or prev.get("refreshedAt")
                kept["error"] = type(e).__name__
                kept["refreshedAt"] = now
                _write_atomic(_path(sym), kept)
                _remember(sym, kept)
                return kept
            doc.update({"familyState": "unavailable", "fields": {}, "error": type(e).__name__})
            _write_atomic(_path(sym), doc)
            _remember(sym, doc)
            return doc
        doc.update({"familyState": "ok" if store.get("company") else "none", "company": store.get("company"),
                    "source": store.get("source"), "disclosure": _disclosure(), "fields": build_fields(store)})
    _write_atomic(_path(sym), doc)
    _remember(sym, doc)
    return doc


# ── storage ─────────────────────────────────────────────────────────────────────────────────────────────────────
_MEM: "OrderedDict[str, dict]" = OrderedDict()
_MEM_LOCK = threading.Lock()


def _remember(sym: str, doc: dict) -> None:
    with _MEM_LOCK:
        _MEM[sym] = doc
        _MEM.move_to_end(sym)
        while len(_MEM) > MEM_MAX:
            _MEM.popitem(last=False)


def _read_disk(sym: str) -> Optional[dict]:
    try:
        with open(_path(sym), encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and doc.get("schema") == SCHEMA else None


def _write_atomic(path: str, doc: dict) -> None:
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".pine-financial-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"), sort_keys=True)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


# ── the background lane ─────────────────────────────────────────────────────────────────────────────────────────
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pine-financial-refresh")
_INFLIGHT: set = set()
_INFLIGHT_LOCK = threading.Lock()


def kick(sym: str) -> bool:
    """Queue one refresh of `sym` unless one is already queued or running. True when this call queued it."""
    with _INFLIGHT_LOCK:
        if sym in _INFLIGHT:
            return False
        _INFLIGHT.add(sym)

    def run():
        try:
            refresh(sym)
        except Exception:  # noqa: BLE001 - logged; the next read kicks again
            log.exception("pine_financial refresh crashed for %s", sym)
        finally:
            with _INFLIGHT_LOCK:
                _INFLIGHT.discard(sym)

    _POOL.submit(run)
    return True


def read(sym: str, now: Optional[float] = None) -> dict:
    """What a request answers. Never a store read: a copy as it stands (a stale one kicks a refresh), or `pending`
    with a refresh kicked."""
    now = time.time() if now is None else now
    with _MEM_LOCK:
        doc = _MEM.get(sym)
    if doc is None:
        doc = _read_disk(sym)
        if doc is not None:
            _remember(sym, doc)
    if doc is None:
        kick(sym)
        return {"schema": SCHEMA, "symbol": sym, "state": "pending",
                "sentence": f"UCT is gathering {sym}'s figures from company filings; ask again in a few seconds."}
    age = now - float(doc.get("refreshedAt") or 0)
    # ⛔ a copy kept over a failed read is retried on every read past the error window, not only past the TTL
    due = age > TTL_S or (doc.get("familyState") == "unavailable" and age > 60)
    if due:
        kick(sym)
    return {**doc, "state": "ready", "ageS": int(age), "refreshing": due}
