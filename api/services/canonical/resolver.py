"""D2 CP3 (TERM-020 / FB-D2-01) — ``resolve(address) -> Resolution``.

SPEC-D2 §3, built. ``address_book.py`` said of itself *"NOT A RESOLVER. The
five-status resolve(address) -> Resolution in SPEC-D2 §3 is CP3 and needs its
own line."* This is that module. It turns an address into a value we HOLD,
with the value's as-of, its inputs and a typed provenance record — or into a
status that says precisely why it cannot.

⛔⛔ FIVE STATUSES, AND COLLAPSING ANY TWO IS THE DEFECT (SPEC §3.2):

  ``resolved``          we hold a value, and we can say when it is from
  ``empty``             the metric is declared, the entity resolves, the store
                        was read — and it holds nothing at or before the
                        requested instant (the series starts after it)
  ``not_computable``    we could not compute it: no rows, a NULL column, a
                        store we cannot read, a point-in-time question a
                        latest-only store cannot answer
  ``unknown_metric``    the address names nothing declared — a metric, a
                        timeframe or a query key the book does not know, or an
                        address that does not parse
  ``unresolved_entity`` S3 cannot resolve the alias and the store holds nothing
                        under it; or the alias is ambiguous; or the address
                        gives an entity to a market-wide store / none to an
                        entity-keyed one

⛔ THERE IS NO SIXTH STATUS. A malformed address is ``unknown_metric`` with a
detail saying so, because the thing that must never happen to it is being read
as a data gap (``not_computable``) — the collapse the spec names for exactly
that status.

⛔⛔ NO DEFAULTING. ``address_book.py``'s own rule is the acceptance criterion:
*"row_position() returning 0 for an unknown metric would resolve every bad
address to the OPEN price and every consumer would keep working, wrongly,
forever."* So: no default timeframe, no default metric, no nearest-row
fallback, no clamp. Anything that is not ``resolved`` carries ``value=None``,
and every non-``resolved`` return goes through ``_finish``, which enforces it.

⛔ NOTHING IS RESTATED FROM THE MANIFEST. Metric, store, column, as-of column,
authority and the timeframe vocabulary are all read from the book through
``address_book``'s accessors, and the bars column ordinal is
``address_book.row_position`` — CP2's accessor, not a typed ``[4]``. The only
store knowledge typed here is HOW to read each store (which existing public
reader to call); a rail asserts every store in the book either has a reader
here or a named reason it cannot be addressed.

⛔ NOTHING IS WRITTEN. The "typed provenance record per stored value" is built
at READ time from the store's own reader (``ProvenanceRecord`` — D1's shape,
reused, never a second one). No table, no file, no cache. Reversal plan: delete
this module, its test file, and its two named entries in
``tests/test_canonical_address_book.py``; there is no data to migrate or
restore.

⛔ ONE NAMED PRODUCT CALLER, AND THE NEXT ONE FAILS BY NAME. Until TERM-060
nothing in ``api/`` imported this module. TERM-060 added the claim checker
(``claims.py``, part of this module's own surface) and ONE caller of it, each
named with its approval line in ``tests/test_canonical_address_book.py``
(``_RESOLVER_SURFACE`` / ``_ALLOWED_RESOLVER_CALLERS``). Any other module that
imports either fails there by name until it has a line of its own.

⚠️ POINT-IN-TIME IS NOT MODELLED (SPEC §8.4). ``as_of=`` selects the newest
stored value keyed at or before the instant; the value is whatever the store
holds NOW for that key (a later revision included). A store that keeps only its
newest row cannot answer a question about an earlier instant, and says so.
"""
from __future__ import annotations

import math
import re
import threading
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time as dtime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import bars_sqlite, breadth_monitor
from api.services.canonical import address_book
from api.services.entity_master import api as entity_master_api
from api.services.provider_errors import ProvenanceRecord
from api.services.screener import snapshot_db

_ET = ZoneInfo("America/New_York")

# ── statuses (SPEC §3.2) ─────────────────────────────────────────────────────
RESOLVED = "resolved"
EMPTY = "empty"
NOT_COMPUTABLE = "not_computable"
UNKNOWN_METRIC = "unknown_metric"
UNRESOLVED_ENTITY = "unresolved_entity"
STATUSES = (RESOLVED, EMPTY, NOT_COMPUTABLE, UNKNOWN_METRIC, UNRESOLVED_ENTITY)

#: The value a store-we-hold carries in ``ProvenanceRecord.vendor``. SPEC §1.2
#: decision 4: an address WITHOUT ``provider=`` names *the value we hold*. None
#: of the addressed stores records an upstream vendor per value, so naming one
#: here would be fabrication; ``uct`` says whose store it is and nothing more.
HELD_VENDOR = "uct"

#: The one timeframe a store WITHOUT a ``tf`` key column can be addressed at:
#: those stores hold one row per date. Railed: it must be a code the book's own
#: timeframe axis declares, or it points nowhere.
DAILY_CODE = "D"

#: The ten figures a desk answer most often states (FB-D2-01's own first test,
#: C7-03 §4). A SELECTION, not a restatement: every name must exist in the book
#: (railed), and nothing about them — store, column, as-of — is typed here.
#: Chosen from what the Desk, the Wire and Compass state about a name and about
#: the tape: its last price and volume, the day's move, where it sits against
#: its 50-day and its 52-week high, its range, its size, its RS rank, and the
#: two market-wide numbers every regime read opens with.
DESK_FIGURES = (
    "ohlcv.c",
    "ohlcv.v",
    "chg_pct_1d",
    "pct_vs_sma50",
    "dist_52w_high_pct",
    "adr_pct",
    "market_cap",
    "rs_rank",
    "breadth_snapshot_numeric.pct_above_50sma",
    "breadth_snapshot_numeric.uct_exposure",
)

#: Stores the book declares that this resolver cannot address, each with the
#: reason. ⛔ A store in neither this map nor ``_READERS`` fails a rail by name.
UNADDRESSABLE_STORES = {
    "earnings_table": ("a derived JSON snapshot with a declared SHAPE and no flat "
                       "metrics entries (F-D2-1) — the book gives it no address"),
}

_SCHEME = "uct://"
_ADDRESS_RE = re.compile(
    r"^uct://"
    r"(?P<metric>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)"
    r"(?:@(?P<entity>[A-Za-z0-9][A-Za-z0-9.\-_:]*))?"
    r"(?:/(?P<tf>[A-Za-z0-9]+))?"
    r"(?:\?(?P<query>[^#]*))?$"
)
_QUERY_KEYS = ("as_of", "provider")


def format_address(metric: str, *, entity: Optional[str] = None, tf: Optional[str] = None,
                   as_of: Optional[str] = None) -> str:
    """TERM-060: the address for (metric, entity, timeframe, as_of), in the ONE
    grammar ``resolve`` parses. Additive; ``resolve`` does not use it.

    It builds, it does not validate — whether the metric is declared or the
    timeframe is on the axis is ``resolve``'s answer to give, with a status. The
    one refusal here is a string the grammar could not parse back into the same
    parts: that would be a pointer that silently names something else."""
    out = _SCHEME + str(metric)
    if entity:
        out += f"@{entity}"
    if tf:
        out += f"/{tf}"
    if as_of:
        out += f"?as_of={as_of}"
    parts = parse_address(out)
    if parts != {"metric": str(metric), "entity": entity or None, "tf": tf or None,
                 "as_of": as_of or None, "provider": None}:
        raise ValueError(f"{out!r} does not round-trip through the address grammar")
    return out


def parse_address(address: str) -> Optional[dict]:
    """TERM-060: the parts of an address, or None when the grammar does not
    parse it. The same ``_ADDRESS_RE`` ``resolve`` matches — never a second
    copy of the grammar. A repeated or unknown query key is None, as
    ``resolve`` refuses it."""
    m = _ADDRESS_RE.match(address.strip()) if isinstance(address, str) else None
    if not m:
        return None
    query: dict = {}
    for part in filter(None, (m.group("query") or "").split("&")):
        k, sep, v = part.partition("=")
        if not sep or k not in _QUERY_KEYS or k in query:
            return None
        query[k] = v
    return {"metric": m.group("metric"), "entity": m.group("entity"), "tf": m.group("tf"),
            "as_of": query.get("as_of"), "provider": query.get("provider")}


@dataclass(frozen=True)
class Resolution:
    """SPEC §3.1, plus ``address`` (the stable id) and ``inputs`` (what the
    value was read from) — the two halves of FB-D2-01's "stable id + as-of +
    inputs" that §3.1 leaves implicit.

    ``authority`` is ``None`` only when the metric is not declared: an unknown
    metric has no authority, and ``""`` would read as a declared blank."""
    status: str
    value: Any = None
    provenance: Optional[ProvenanceRecord] = None
    as_of: Optional[float] = None
    authority: Optional[str] = None
    detail: Optional[str] = None
    address: Optional[str] = None
    inputs: dict = field(default_factory=dict)


# ── observability: status counts ─────────────────────────────────────────────
#: In-process, reset on deploy, never persisted. It exists so "we could not
#: compute it" and "it is zero" are countable as different things (TERM-020
#: observability). Every return passes ``_finish``, which is the only writer.
_counts_lock = threading.Lock()
_counts: Counter = Counter()


def status_counts() -> dict:
    """Resolutions returned by this process, per status — all five keys always
    present, so a 0 is a count and not a status nobody tracked."""
    with _counts_lock:
        return {s: int(_counts.get(s, 0)) for s in STATUSES}


def reset_status_counts() -> None:
    with _counts_lock:
        _counts.clear()


def _finish(res: Resolution) -> Resolution:
    """The ONE exit. Enforces the two contracts no caller may break:

    * anything that is not ``resolved`` carries NO value and NO provenance —
      a miss that returns something plausible is the named failure;
    * ``resolved`` and ``empty`` both carry an as-of (SPEC §3.3: "an `empty`
      with no as-of is indistinguishable from a read that never happened").
      One that cannot say WHEN it looked is downgraded to ``not_computable``.
    """
    if res.status not in STATUSES:                       # pragma: no cover — programming error
        res = Resolution(status=NOT_COMPUTABLE, detail=f"internal: unknown status {res.status!r}",
                         address=res.address, inputs=res.inputs)
    if res.status in (RESOLVED, EMPTY) and res.as_of is None:
        res = Resolution(status=NOT_COMPUTABLE, authority=res.authority,
                         detail=f"a {res.status} read that cannot say when it looked is not one",
                         address=res.address, inputs=res.inputs)
    if res.status != RESOLVED and (res.value is not None or res.provenance is not None):
        res = Resolution(status=res.status, as_of=res.as_of, authority=res.authority,
                         detail=res.detail, address=res.address, inputs=res.inputs)
    with _counts_lock:
        _counts[res.status] += 1
    return res


# ── time ─────────────────────────────────────────────────────────────────────

def _date_to_epoch(d: date) -> float:
    """A date-grain as-of, expressed as the instant that date begins in New
    York. The grain travels with it in ``inputs['grain']`` so no consumer reads
    the instant as a time of day."""
    return datetime.combine(d, dtime(0, 0), tzinfo=_ET).timestamp()


def _parse_date_text(raw: Any) -> Optional[date]:
    """``YYYYMMDD`` (bars keys, screener ``bars_asof``) or ``YYYY-MM-DD``
    (breadth ``date``). Anything else is None — never guessed."""
    s = str(raw).strip() if raw is not None else ""
    try:
        if re.fullmatch(r"\d{8}", s):
            return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            return date.fromisoformat(s)
    except ValueError:
        return None
    return None


def _parse_instant(raw: str) -> Optional[tuple[float, date]]:
    """``as_of=`` → (epoch, ET date). Accepts a date (``2026-09-25``, meaning
    "as of the END of that ET day"), an ISO datetime (naive = ET), or epoch
    seconds. None when it does not parse — the caller refuses; it never
    substitutes "now"."""
    s = (raw or "").strip()
    if not s:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        try:
            d = date.fromisoformat(s)
        except ValueError:
            return None
        end = datetime.combine(d, dtime(23, 59, 59), tzinfo=_ET)
        return end.timestamp(), d
    if re.fullmatch(r"\d{9,11}(?:\.\d+)?", s):
        ts = float(s)
        return ts, datetime.fromtimestamp(ts, tz=_ET).date()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_ET)
    return dt.timestamp(), dt.astimezone(_ET).date()


def _iso_utc(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── the book's timeframe axis ────────────────────────────────────────────────

def timeframe_codes() -> dict:
    """code -> label, read from the book (which derived it from the bars
    store's own ``_BARS_STORE_TF_KEYS``)."""
    axes = address_book.book().get("axes") or {}
    return dict(((axes.get("timeframe") or {}).get("code_to_label")) or {})


def normalize_timeframe(raw: str) -> Optional[str]:
    """The CODE for a code or a label, else None. ⛔ CASE-SENSITIVE: ``1m`` is a
    minute and ``1M`` is a month (same trap ``indicator_axis`` documents)."""
    codes = timeframe_codes()
    if raw in codes:
        return raw
    for code, label in codes.items():
        if raw == label:
            return code
    return None


# ── store readers ────────────────────────────────────────────────────────────
#
# Each reader answers ONE question for one (entity, timeframe, as_of) and never
# raises past `resolve` (which catches). It returns a dict:
#
#   found      a row/bar was read            value, as_of_raw, as_of_date|as_of_epoch
#   series     the entity has ANY data here  (distinguishes empty from not_computable)
#   latest_only_newer   a latest-only store whose row is newer than the ask
#   activity   the existing public reader actually called (provenance)

def _read_bars(metric: dict, entity: str, tf: str, ask: Optional[tuple]) -> dict:
    pos = address_book.row_position(metric["_name"])
    if pos is None:
        return {"error": "the bars store declares no row projection containing this column"}
    last = bars_sqlite.get_last_ts(entity, tf)
    if last is None:
        return {"series": False, "activity": "bars_sqlite.get_last_ts"}
    date_keyed = int(last) < 100_000_000       # YYYYMMDD vs unix seconds — read off the KEY itself
    if ask is None:
        rows = bars_sqlite.get_bars(entity, tf, 1)
        activity = "bars_sqlite.get_bars"
    else:
        ask_epoch, ask_date = ask
        to_key = int(ask_date.strftime("%Y%m%d")) if date_keyed else int(ask_epoch)
        rows = bars_sqlite.get_bars_before(entity, tf, 1, to_key)
        activity = "bars_sqlite.get_bars_before"
    if not rows:
        return {"series": True, "found": False, "activity": activity}
    row = rows[-1]
    ts = row[0]
    out = {"series": True, "found": True, "value": row[pos], "as_of_raw": ts,
           "activity": activity, "row_position": pos}
    if date_keyed:
        d = _parse_date_text(ts)
        out["as_of_date"] = d
        out["grain"] = "date"
        out["as_of_epoch"] = _date_to_epoch(d) if d else None
    else:
        out["grain"] = "instant"
        out["as_of_epoch"] = float(ts)
    if ask is not None and out.get("as_of_epoch") is not None:
        # ⛔ BELT AND BRACES: the store query is `ts <= to_key`, and this makes
        # the contract local — a reader that ever returned a later row would
        # otherwise answer a point-in-time question with the future.
        if (date_keyed and out["as_of_date"] > ask[1]) or (
                not date_keyed and out["as_of_epoch"] > ask[0]):
            return {"series": True, "found": False, "activity": activity}
    return out


def _read_screener(metric: dict, entity: str, tf: str, ask: Optional[tuple]) -> dict:
    col = metric["column"]
    asof_col = metric.get("as_of_column")
    cols = [c for c in (col, asof_col) if c]
    rows = snapshot_db.get_projected([entity], cols)
    row = rows.get(entity.upper())
    activity = "snapshot_db.get_projected"
    if row is None:
        return {"series": False, "activity": activity}
    d = _parse_date_text(row.get(asof_col)) if asof_col else None
    out = {"series": True, "found": True, "value": row.get(col),
           "as_of_raw": row.get(asof_col) if asof_col else None,
           "as_of_date": d, "as_of_epoch": _date_to_epoch(d) if d else None,
           "grain": metric.get("grain") or "date", "activity": activity}
    if ask is not None and d is not None and d > ask[1]:
        # The nightly snapshot keeps ONE row per ticker. A row newer than the
        # asked instant means the store cannot say what it held then.
        return {"series": True, "found": False, "latest_only_newer": True,
                "as_of_raw": out["as_of_raw"], "activity": activity}
    return out


def _read_breadth(metric: dict, entity: Optional[str], tf: str, ask: Optional[tuple]) -> dict:
    key = metric["column"]
    activity = "breadth_monitor.get_history"
    if ask is None:
        hist = breadth_monitor.get_history(1)
    else:
        hist = breadth_monitor.get_history(1, end=ask[1].isoformat(), anchor="le")
    if not hist:
        # ⛔ get_history returns [] on an error AND on an empty store; the two
        # cannot be told apart from here, so neither is reported as `empty`.
        return {"series": False, "activity": activity}
    row = hist[0]
    d = _parse_date_text(row.get("date"))
    if ask is not None and d is not None and d > ask[1]:
        # ⛔⛔ get_history's `le` anchor CLAMPS a date before the oldest session
        # to the earliest stored row. That row is from AFTER the asked instant,
        # and serving it would be the plausible-value-for-a-miss failure.
        return {"series": True, "found": False, "activity": activity}
    return {"series": True, "found": True, "value": row.get(key),
            "as_of_raw": row.get("date"), "as_of_date": d,
            "as_of_epoch": _date_to_epoch(d) if d else None, "grain": "date",
            "activity": activity}


#: store id -> (entity-keyed?, timeframe-keyed?, reader). HOW each store is
#: read; WHAT is in it comes from the book.
_READERS = {
    "bars_sqlite": (True, True, _read_bars),
    "screener_rows": (True, False, _read_screener),
    "breadth_snapshot_numeric": (False, False, _read_breadth),
}


def reader_for(store_id: str):
    return _READERS.get(store_id)


# ── resolve ──────────────────────────────────────────────────────────────────

def _usable(value: Any, yields: Optional[str]) -> bool:
    if value is None:
        return False
    if yields == "num":
        if isinstance(value, bool):
            return False
        try:
            return math.isfinite(float(value))
        except (TypeError, ValueError):
            return False
    if yields == "bool":
        return value in (0, 1, True, False)
    return True


def _coerce(value: Any, yields: Optional[str]) -> Any:
    if yields == "bool":
        return bool(value)
    if yields == "num" and isinstance(value, str):
        return float(value)
    return value


def resolve(address: str) -> Resolution:
    """Resolve one address. Never raises; every return passes ``_finish``."""
    try:
        return _finish(_resolve(address))
    except Exception as exc:                              # noqa: BLE001 — a read path never raises
        return _finish(Resolution(status=NOT_COMPUTABLE, address=None,
                                  detail=f"the read failed: {type(exc).__name__}: {exc}"))


def _resolve(address: str) -> Resolution:
    raw = (address or "").strip() if isinstance(address, str) else ""
    m = _ADDRESS_RE.match(raw)
    if not m:
        return Resolution(status=UNKNOWN_METRIC,
                          detail=f"not a uct:// address this grammar parses: {address!r}")
    name = m.group("metric")
    decl = address_book.metric(name)
    if decl is None:
        return Resolution(status=UNKNOWN_METRIC, detail=f"no declared metric {name!r} in the book")
    authority = decl.get("authority")
    store_id = decl.get("store")
    if address_book.store(store_id) is None:
        return Resolution(status=NOT_COMPUTABLE, authority=authority,
                          detail=f"metric {name!r} names store {store_id!r}, which the book does not declare")
    spec = reader_for(store_id)
    if spec is None:
        why = UNADDRESSABLE_STORES.get(store_id, "no reader for this store")
        return Resolution(status=NOT_COMPUTABLE, authority=authority,
                          detail=f"store {store_id!r} cannot be resolved: {why}")
    entity_keyed, tf_keyed, reader = spec

    # ── query ────────────────────────────────────────────────────────────
    query: dict = {}
    for part in filter(None, (m.group("query") or "").split("&")):
        k, sep, v = part.partition("=")
        if not sep or k not in _QUERY_KEYS or k in query:
            return Resolution(status=UNKNOWN_METRIC, authority=authority,
                              detail=f"query key {k!r} is not in the grammar (as_of, provider — once each)")
        query[k] = v
    ask = None
    if "as_of" in query:
        ask = _parse_instant(query["as_of"])
        if ask is None:
            return Resolution(status=UNKNOWN_METRIC, authority=authority,
                              detail=f"as_of={query['as_of']!r} is not an instant")
    if "provider" in query:
        return Resolution(status=NOT_COMPUTABLE, authority=authority,
                          detail=("provider-qualified addresses are not computable: no addressed "
                                  "store records the vendor per value (SPEC §1.2 decision 4)"))

    # ── timeframe ────────────────────────────────────────────────────────
    tf_raw = m.group("tf")
    if tf_keyed:
        if tf_raw is None:
            return Resolution(status=UNKNOWN_METRIC, authority=authority,
                              detail=f"store {store_id!r} is keyed on timeframe and the address names none")
        tf = normalize_timeframe(tf_raw)
        if tf is None:
            return Resolution(status=UNKNOWN_METRIC, authority=authority,
                              detail=f"timeframe {tf_raw!r} is not on the book's timeframe axis")
    else:
        tf = DAILY_CODE
        if tf_raw is not None and normalize_timeframe(tf_raw) != DAILY_CODE:
            return Resolution(status=UNKNOWN_METRIC, authority=authority,
                              detail=f"store {store_id!r} holds one row per date; timeframe {tf_raw!r} names nothing in it")

    # ── entity ───────────────────────────────────────────────────────────
    alias = m.group("entity")
    entity_id = None
    entity_status = None
    symbol = None
    if entity_keyed:
        if not alias:
            return Resolution(status=UNRESOLVED_ENTITY, authority=authority,
                              detail=f"store {store_id!r} is keyed on an entity and the address names none")
        symbol = alias.strip().upper()
        em = entity_master_api.resolve(symbol, as_of=ask[1].isoformat() if ask else None)
        entity_status = em.status
        if em.status == "ambiguous":
            return Resolution(status=UNRESOLVED_ENTITY, authority=authority,
                              detail=f"alias {symbol!r} is ambiguous in Entity Master ({len(em.candidates)} candidates)",
                              inputs={"entity_alias": symbol, "entity_status": em.status})
        if em.status == "resolved" and em.entity is not None:
            entity_id = em.entity.entity_id
    elif alias:
        return Resolution(status=UNRESOLVED_ENTITY, authority=authority,
                          detail=f"store {store_id!r} is market-wide; it is not keyed on an entity ({alias!r})")

    canonical_entity = entity_id or symbol
    stable = _SCHEME + name + (f"@{canonical_entity}" if canonical_entity else "") + f"/{tf}"
    if ask is not None:
        stable += f"?as_of={_iso_utc(ask[0])}"
    inputs = {
        "store": store_id,
        "column": decl.get("column"),
        "as_of_column": decl.get("as_of_column"),
        "timeframe": tf,
        "entity_alias": symbol,
        "entity_id": entity_id,
        "entity_status": entity_status,
        "as_of_requested": ask[0] if ask else None,
    }

    # ── read ─────────────────────────────────────────────────────────────
    got = reader(dict(decl, _name=name), symbol, tf, ask)
    inputs["read_by"] = got.get("activity")
    if "error" in got:
        return Resolution(status=NOT_COMPUTABLE, authority=authority, detail=got["error"],
                          address=stable, inputs=inputs)
    if not got.get("series"):
        if entity_keyed and entity_status != "resolved":
            return Resolution(status=UNRESOLVED_ENTITY, authority=authority, address=stable, inputs=inputs,
                              detail=f"Entity Master does not know {symbol!r} and {store_id!r} holds nothing under it")
        return Resolution(status=NOT_COMPUTABLE, authority=authority, address=stable, inputs=inputs,
                          detail=f"{store_id!r} holds no rows for this address")
    if not got.get("found"):
        if got.get("latest_only_newer"):
            inputs["as_of_value"] = got.get("as_of_raw")
            return Resolution(status=NOT_COMPUTABLE, authority=authority, address=stable, inputs=inputs,
                              detail=(f"{store_id!r} keeps only its newest row, which is dated after the "
                                      "requested instant — it cannot say what it held then"))
        return Resolution(status=EMPTY, authority=authority, address=stable, inputs=inputs,
                          as_of=ask[0] if ask else None,
                          detail=f"{store_id!r} holds this series, but nothing at or before the requested instant")

    inputs["as_of_value"] = got.get("as_of_raw")
    inputs["grain"] = got.get("grain")
    if "row_position" in got:
        inputs["row_position"] = got["row_position"]
    as_of = got.get("as_of_epoch")
    if as_of is None:
        return Resolution(status=NOT_COMPUTABLE, authority=authority, address=stable, inputs=inputs,
                          detail=f"the row carries no readable as-of ({got.get('as_of_raw')!r})")
    value = got.get("value")
    yields = decl.get("yields")
    if not _usable(value, yields):
        return Resolution(status=NOT_COMPUTABLE, authority=authority, address=stable, inputs=inputs,
                          detail=f"the stored value is NULL or not a {yields} ({value!r})")
    prov = ProvenanceRecord(vendor=HELD_VENDOR, source_activity=got.get("activity") or store_id,
                            source_observed_at=as_of)
    return Resolution(status=RESOLVED, value=_coerce(value, yields), provenance=prov, as_of=as_of,
                      authority=authority, address=stable, inputs=inputs,
                      detail=None if entity_status in (None, "resolved") else
                      f"Entity Master has no record of {symbol!r}; resolved by its symbol alias")
