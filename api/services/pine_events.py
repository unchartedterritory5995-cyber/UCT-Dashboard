"""Track 4, unit E1 (2026-11-22): the corporate events a member's Pine script reads, served dark.

`request.earnings`, `request.dividends` and `request.splits` read the chart's own symbol's events. This module
holds them per symbol and answers `GET /api/pine/events/{ticker}` (api/routers/pine_events.py) for the event
supply E2 builds. Nothing in the engine reads it yet: E1 serves no chart value, it exists so that production's
own fetch can be measured against TradingView before E2 places a single event
(`tools/vendor_harness/event_grade.py`, coordinator ruling 2026-11-22: "measure through E1 deployed DARK").

WHAT IT HOLDS, per family (the placements these feed are witnessed in
docs/pine/evidence/2026-11-22-t4-e0-event-placement/EVIDENCE.md):
  earnings   every REPORTED quarter: report date, actual EPS, estimated EPS, as the vendor gives them. A
             scheduled report with no actual yet is not an event (TradingView places a report only once it
             exists). The vendor's share basis is recorded unmeasured; event_grade.py measures it.
  dividends  every cash dividend: ex-date and the amount AS DECLARED (TradingView's `dividends.gross` is as
             declared, never split-adjusted), with the vendor's type (regular / special) and currency.
  splits     every split: execution date, numerator = the new shares, denominator = the old (TradingView's
             orientation: NVDA 2024-06-10 is 10 / 1, GE 2021-08-02 is 1 / 8).

`knownFrom` (per family): the first held event's date. Before it our record proves nothing, so E2 withholds
those bars by name, never reads them as `na` (the #2429 rule, and the coordinator's ruling 8 for splits: the
history lake's own split list starts 2003-09-10, so AAPL's 1987 and 2000 splits are absent from it, and a bar
before our first held split must never be computed as if no split happened). A family the vendor answered with
NO events has `knownFrom: null` and `state: "empty"`: E2 refuses it until a coverage rule is witnessed (W-E3).

THE LANE (the #2422 pattern, index_bars.py). A request is never a vendor call:
  1. the in-process copy (`_MEM`, bounded), then
  2. the disk snapshot `<PINE_EVENTS_DIR>/<SYM>.json`, written temp + os.replace (never a torn file);
  3. a symbol with no copy answers `pending` and kicks ONE refresh onto a bounded background pool
     (`_POOL`, 2 workers, deduplicated by symbol); a copy older than `TTL_S` is served as it stands and kicks a
     refresh. A family whose vendor read fails keeps its previous copy and says so (`state: "unavailable"`,
     `staleSince`), never an empty list in its place.

LICENCE. A family is fetched and served only when `pine_data_catalog.family_refusal` passes it (class A or LA,
no hold). Earnings, dividends and splits are LA (member display only, licensing register T-35/T-36, T-07): the
values are for the member's own chart, never an alert message, an export, a share or a model prompt (catalog rule
O2). A refused family is answered with its guard and sentence and no vendor call is made for it. No sentence here
names a vendor (register T-46).

STAGE. `PINE_EVENTS_SUPPLY_ENABLED` (docs/feature_flags.json): unset or `admins` -> signed-in ADMINS only (dark
for members; this is how production's fetch is graded); `all` -> every paid member; `off` -> nobody (404).
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
from typing import Any, Callable, Optional

log = logging.getLogger("pine_events")

SCHEMA = "uct.pine-events/v1"
FAMILIES = ("earnings", "dividends", "splits")
TTL_S = 12 * 3600
MEM_MAX = 512
FLAG = "PINE_EVENTS_SUPPLY_ENABLED"
STAGES = ("off", "admins", "all")
DEFAULT_STAGE = "admins"


def stage() -> str:
    """off | admins | all. Unset is `admins` (dark for members); an unknown value is `off` (fail closed)."""
    v = (os.environ.get("PINE_EVENTS_SUPPLY_ENABLED") or "").strip().lower()
    if not v:
        return DEFAULT_STAGE
    if v in ("1", "true", "yes", "on"):
        return "all"
    return v if v in STAGES else "off"


def _dir() -> str:
    override = os.environ.get("PINE_EVENTS_DIR")
    if override:
        return override
    base = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "data"))
    return os.path.join(base, "pine_events")


def _path(sym: str) -> str:
    # the history lake's encoding (tools/history_lake/FORMAT.md): case and reserved device names are safe
    enc = "s-" + "".join(ch if ("0" <= ch <= "9" or "A" <= ch <= "Z") else "_%02X" % b
                         for ch, b in ((chr(b), b) for b in sym.encode("utf-8")))
    return os.path.join(_dir(), enc + ".json")


# ── the vendor reads (each returns a family block; none ever runs on a request thread) ─────────────────────────
def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _fetch_earnings(sym: str) -> dict:
    from api.services import fmp_client
    from api.services.provider_errors import ProviderNotFound
    try:
        raw = fmp_client.get_earnings(sym, limit=1000, timeout=20).value
    except ProviderNotFound:
        raw = []
    rows = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict) or not r.get("date"):
            continue
        actual = _num(r.get("epsActual"))
        if actual is None:
            continue        # a scheduled report with no actual yet is not an event
        rows.append({"date": str(r["date"])[:10], "actual": actual, "estimate": _num(r.get("epsEstimated"))})
    return {"rows": _dedupe(rows, "date"), "basis": "vendor (share basis measured by event_grade.py)"}


def _fetch_dividends(sym: str) -> dict:
    from api.services import reference_corp_actions as rca
    rows = []
    for r in rca.fetch_ticker_dividends(sym):
        amt = _num(r.get("cash_amount"))
        if amt is None:
            continue
        rows.append({"exDate": r["ex_dividend_date"], "gross": amt, "type": r.get("dividend_type"),
                     "currency": r.get("currency"), "frequency": r.get("frequency")})
    return {"rows": sorted(rows, key=lambda x: x["exDate"]), "basis": "as declared"}


def _fetch_splits(sym: str) -> dict:
    from api.services import reference_corp_actions as rca
    rows = []
    for r in rca.fetch_ticker_splits(sym):
        num, den = _num(r.get("split_to")), _num(r.get("split_from"))
        if not num or not den:
            continue
        rows.append({"date": r["execution_date"], "numerator": num, "denominator": den})
    return {"rows": _dedupe(sorted(rows, key=lambda x: x["date"]), "date"),
            "orientation": "numerator = new shares, denominator = old"}


def _dedupe(rows: list, key: str) -> list:
    seen, out = set(), []
    for r in sorted(rows, key=lambda x: x[key]):
        if r[key] in seen:
            continue
        seen.add(r[key])
        out.append(r)
    return out


FETCHERS: dict[str, Callable[[str], dict]] = {
    "earnings": _fetch_earnings, "dividends": _fetch_dividends, "splits": _fetch_splits}
DATE_KEY = {"earnings": "date", "dividends": "exDate", "splits": "date"}


def _refusal(family: str) -> Optional[dict]:
    from api.services import pine_data_catalog as cat
    r = cat.family_refusal(family)
    return {"guard": r[0], "sentence": r[1]} if r else None


def _disclosure(family: str) -> str:
    from api.services import pine_data_catalog as cat
    return cat.disclosure(family)


def build_family(family: str, sym: str, previous: Optional[dict], now: float) -> dict:
    """One family's block, from the vendor, or the previous copy kept and marked when the vendor fails."""
    refused = _refusal(family)
    if refused:
        return {"state": "refused", "refusal": refused, "rows": [], "knownFrom": None}
    try:
        got = FETCHERS[family](sym)
    except Exception as e:  # noqa: BLE001 - any vendor failure keeps the copy we have, by name
        log.warning("pine_events refresh FAILED %s %s: %s", sym, family, type(e).__name__)
        if previous and previous.get("rows"):
            kept = dict(previous)
            kept["state"] = "unavailable"
            kept["staleSince"] = previous.get("fetchedAt")
            kept["error"] = type(e).__name__
            return kept
        return {"state": "unavailable", "rows": [], "knownFrom": None, "error": type(e).__name__}
    rows = got.pop("rows")
    return {"state": "ok" if rows else "empty", "rows": rows,
            "knownFrom": rows[0][DATE_KEY[family]] if rows else None,
            "fetchedAt": now, "disclosure": _disclosure(family), **got}


def refresh(sym: str, now: Optional[float] = None) -> dict:
    """Fetch every family for `sym` and write the snapshot atomically. Runs on the background pool only."""
    now = time.time() if now is None else now
    prev = _read_disk(sym) or {}
    doc = {"schema": SCHEMA, "symbol": sym, "refreshedAt": now,
           "families": {f: build_family(f, sym, (prev.get("families") or {}).get(f), now) for f in FAMILIES}}
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
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".pine-events-", suffix=".tmp")
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
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pine-events-refresh")
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
            log.exception("pine_events refresh crashed for %s", sym)
        finally:
            with _INFLIGHT_LOCK:
                _INFLIGHT.discard(sym)

    _POOL.submit(run)
    return True


def read(sym: str, now: Optional[float] = None) -> dict:
    """What a request answers. Never a vendor call: a copy as it stands (a stale one kicks a refresh), or
    `pending` with a refresh kicked."""
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
                "sentence": f"UCT is gathering {sym}'s earnings, dividends and splits; ask again in a few seconds."}
    age = now - float(doc.get("refreshedAt") or 0)
    if age > TTL_S:
        kick(sym)
    return {**doc, "state": "ready", "ageS": int(age), "refreshing": age > TTL_S}
