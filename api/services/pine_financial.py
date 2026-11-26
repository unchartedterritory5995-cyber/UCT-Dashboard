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


# ── e99 FY: THE FISCAL-YEAR VIEW (served, never stored) ─────────────────────────────────────────────────────────────
# The V5 methodology is FROZEN (`fundamentals_pit/v5_prod.METHODOLOGY_FILES`), so no stored FY series exists. The FY
# figures are READ from series the store already publishes: at a fiscal-year end the store's TTM is the 10-K's reported
# fiscal-year value (`metrics.ttm`, method `fiscal_year`, effective when that 10-K became public), a balance-sheet figure
# at a fiscal-year end is the 10-K's, and the share count is the 10-K's cover-page count. A catalog FY entry names such a
# view: `<stored series>@fy` (coordinator ruling, option B, 2026-11-26).
# ⛔ THE NAMED LIMITATION (railed, never a bug to "fix" by drift): a TTM point is emitted only while the TTM still
# describes that fiscal year, so a restatement of a fiscal year filed AFTER the next 10-Q is not seen: the view keeps the
# value as the 10-K first reported it until the next 10-K. Measured on AAPL FY2009: the 10-K/A (2010-01-25 16:25 ET,
# 42,905M) landed two minutes after the Q1 FY10 10-Q, and the view keeps 36,537M. A stored FY series (option A, kept on
# its own branch) would show the restated value; it is revisited only if TradingView restates FY in place.
FY_VIEW = "@fy"
FY_COVER_DAYS = 120


def fy_limitation(catalog: Optional[dict] = None) -> str:
    """The named limitation, in the member's words: the catalog's `financial.periods.FY.limitation` (one authority for this
    route and the chart's note, `pineFinancial.FINANCIAL_FY_SOURCE_NOTE`)."""
    from api.services import pine_data_catalog as cat
    return str(((cat.families(catalog)[FAMILY].get("periods") or {}).get("FY") or {}).get("limitation") or "")


def fy_base(series: Optional[str]) -> Optional[str]:
    """The stored series a fiscal-year view reads (`revenue_ttm@fy` -> `revenue_ttm`), or None for a stored series."""
    return series[: -len(FY_VIEW)] if isinstance(series, str) and series.endswith(FY_VIEW) else None


def _row_parts(r) -> Optional[tuple]:
    if not isinstance(r, (list, tuple)) or len(r) < 4 or _num(r[0]) is None:
        return None
    pe = _period_end(r[2])
    return (float(r[0]), r[1], pe, r[3], r) if pe else None


def fiscal_year_ends(metrics: dict) -> dict:
    """{fiscal-year end (ISO): the first instant it was known}, from every published TTM series' `fiscal_year` points."""
    out: dict = {}
    for name, rows in (metrics or {}).items():
        if not name.endswith("_ttm"):
            continue
        for r in rows or []:
            p = _row_parts(r)
            if p and p[3] == "fiscal_year" and (p[2] not in out or p[0] < out[p[2]]):
                out[p[2]] = p[0]
    return out


def fy_view_rows(metrics: dict, series: str) -> list:
    """The store-shaped points (`[t_eff, v, period_end, method]`, ascending) of a fiscal-year view, as option A's stored
    FY series would hold them but for the named limitation: one point per fiscal year from the filing that made it known;
    a fiscal year that becomes known WITHOUT this figure closes the previous one with a GAP (once); never a step back to
    an older fiscal year."""
    base = fy_base(series)
    rows = [p for p in (_row_parts(r) for r in (metrics or {}).get(base) or []) if p]
    ends = fiscal_year_ends(metrics)
    own = []
    if base.endswith("_ttm"):
        own = [(t, v, pe, "fiscal_year") for t, v, pe, m, _r in rows if m == "fiscal_year"]
    elif base == "shares_outstanding":
        for fe in ends:
            e = date.fromisoformat(fe)
            near = sorted((p for p in rows if p[3] != "gap" and e <= date.fromisoformat(p[2]) <= e + timedelta(days=FY_COVER_DAYS)),
                          key=lambda p: (p[2], p[0]))
            if near:
                own.append((near[0][0], near[0][1], fe, "fiscal_year_cover"))
    else:
        own = [(t, v, pe, "fiscal_year_instant") for t, v, pe, m, _r in rows if pe in ends and m != "gap"]
    events = sorted([(t, 0, None, fe, "end") for fe, t in ends.items()] + [(t, 1, v, pe, m) for t, v, pe, m in own])
    out: list = []
    for t, _k, v, pe, m in events:
        if m == "end":
            # a newer fiscal year is known; if this figure for it is not known at that instant, the previous is closed
            last = out[-1] if out else None
            if last is not None and pe > last[2] and not any(o[2] == pe and o[0] <= t for o in own):
                if not (last[3] == "gap" and last[2] == pe):
                    out.append([t, None, pe, "gap"])
            continue
        if out and pe < out[-1][2]:
            continue
        if out and out[-1][2] == pe and out[-1][1] == v:
            continue
        out.append([t, v, pe, m])
    return out


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


def points_of(rows: list, series: Optional[str] = None) -> list[dict]:
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
        # ⭐ e99 FY — a fiscal-year view ages by its own cap (`asof.MAX_FY_PERIOD_AGE`), never the quarterly one
        cap = asof.MAX_FY_PERIOD_AGE if fy_base(series) else asof.MAX_PERIOD_AGE
        stale = (date.fromisoformat(period_end) + cap + timedelta(days=1)).isoformat()
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
        stored = fy_base(spec["series"]) or spec["series"]
        if withheld and stored in _split_sensitive():
            out[key] = {**block, "state": "withheld", "points": [], "knownFrom": None,
                        "why": "the company's split history could not be verified, so per-share and share-count "
                               "figures are withheld"}
            continue
        # ⭐ e99 FY — a fiscal-year VIEW is read from the stored series it names (`fy_view_rows`), with its limitation
        rows = fy_view_rows(metrics, spec["series"]) if fy_base(spec["series"]) else (metrics.get(spec["series"]) or [])
        pts = points_of(rows, spec["series"])
        first = next((p for p in pts if p["v"] is not None), None)
        if first is None:
            out[key] = {**block, "state": "missing", "points": [], "knownFrom": None,
                        "why": "the company's filings do not yield this figure"}
            continue
        # ⛔ a leading GAP is not a value: the field is known from its first VALUE
        pts = pts[pts.index(first):]
        out[key] = {**block, "state": "ok", "points": pts, "knownFrom": first["knownFrom"],
                    **({"limitation": fy_limitation(catalog)} if fy_base(spec["series"]) else {})}
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
