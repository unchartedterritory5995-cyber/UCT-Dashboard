"""
Rich ticker search index (web-owned) — powers the /charts Symbol Search modal.

The old search matched ticker STRINGS against a bare 3,742-symbol list
(`cap_universe.json`) with no names/types, so "AAPL" returned only AAPL — never
the leveraged/inverse products whose NAME contains "AAPL" (AAPU = "Direxion Daily
AAPL Bull 2X"), because those aren't even in that list.

This builds a name-bearing index from Massive's /v3/reference/tickers feed (the
same feed `ticker_types` uses) — every US symbol with its name, asset type and
primary exchange, INCLUDING ETFs/ETNs and leveraged/inverse products — plus our
own extras ($IDX: themes, breadth pseudo-tickers, prebuilt ETFs). The search then
ranks across BOTH symbol and name, so "AAPL" surfaces AAPL first and then every
product that references it.

Design:
  • In-memory list of light dicts + a by-symbol map; substring scan over ~15K rows
    is sub-10ms, comfortably under the client's 150ms debounce.
  • Disk snapshot at <DATA_DIR>/ticker_search_index.json so restarts are instant.
  • Background build on startup (skipped if the snapshot is fresh) + a daily rebuild.
  • Best-effort everywhere — a build failure keeps the prior index (or the bare
    cap_universe fallback in the router); it never raises onto the request path.
"""
import json
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

_DATA_DIR = os.environ.get("DATA_DIR", "/data")
_SNAP_PATH = os.environ.get(
    "TICKER_SEARCH_INDEX_PATH", os.path.join(_DATA_DIR, "ticker_search_index.json")
)
_REFRESH_TTL = int(os.environ.get("TICKER_SEARCH_INDEX_TTL", str(26 * 3600)))  # 26h

# Massive/Polygon primary_exchange MIC → friendly label for the row's right side.
_MIC_TO_EXCHANGE = {
    "XNAS": "NASDAQ", "XNGS": "NASDAQ", "XNCM": "NASDAQ", "XNMS": "NASDAQ",
    "XNYS": "NYSE", "ARCX": "NYSE Arca", "XASE": "NYSE American", "AMEX": "NYSE American",
    "BATS": "CBOE", "BATO": "CBOE", "XCBO": "CBOE", "C2OX": "CBOE",
    "IEXG": "IEX", "OTCM": "OTC", "PSGM": "OTC", "OTCB": "OTC", "OOTC": "OTC",
}

# asset_type buckets used by the category chips. THEME/BREADTH/DELISTED are added
# by the extras merge + the router; STOCK/ETF/INDEX come from Massive's classifier.
_TYPE_LABEL = {
    "STOCK": "stock", "ETF": "etf", "INDEX": "index",
    "THEME": "theme", "BREADTH": "breadth", "OTHER": "stock",
}

# ── State ────────────────────────────────────────────────────────────────────
_LOCK = threading.RLock()
_INDEX: list[dict] = []       # [{sym, name, name_lc, type, exch}]
_BY_SYM: dict[str, dict] = {}
_BUILT_AT: float = 0.0
_BUILDING = False


def _friendly_exchange(mic: str) -> str:
    if not mic:
        return ""
    return _MIC_TO_EXCHANGE.get(mic.upper().strip(), mic.upper().strip())


def _priority(row: dict) -> int:
    """Tie-breaker within a match rank: prefer real equities/ETFs, then shorter
    symbols (usually the primary listing), then alphabetical."""
    t = row.get("type")
    tp = 0 if t in ("stock", "etf") else (1 if t == "index" else 2)
    return tp * 100 + len(row.get("sym", ""))


# ── Build ────────────────────────────────────────────────────────────────────
def _collect_rows() -> list[dict]:
    """Pull the reference universe from Massive + merge our own extras. Returns a
    deduped list of {sym, name, type, exch}. Best-effort; partial data is fine."""
    from api.services import massive
    from api import ticker_types

    out: dict[str, dict] = {}

    def _put(sym, name, asset_type, exch, *, overwrite_ok=True):
        sym = (sym or "").strip().upper()
        if not sym:
            return
        prev = out.get(sym)
        if prev is not None and not overwrite_ok:
            # keep the better-typed / named existing row
            if prev.get("name") and not name:
                return
        out[sym] = {
            "sym": sym,
            "name": (name or "").strip(),
            "type": _TYPE_LABEL.get(asset_type, "stock"),
            "exch": exch or (prev or {}).get("exch", ""),
        }

    # 1) Stocks + ETFs (market='stocks': CS/ETF/ETN/ADRC/…)
    try:
        for r in massive.list_reference_tickers(active=True, market="stocks"):
            sym = (r.get("ticker") or "").strip().upper()
            if not sym or sym.startswith("I:"):
                continue
            at = ticker_types.normalize_type((r.get("type") or ""), "stocks")
            _put(sym, r.get("name"), at, _friendly_exchange(r.get("primary_exchange")))
    except Exception as e:
        logger.warning("[ticker_search_index] stocks fetch failed: %s", e)

    # 2) Indices (market='indices' — the query itself is the classifier)
    try:
        for r in massive.list_reference_tickers(active=True, market="indices"):
            sym = (r.get("ticker") or "").strip().upper()
            if sym.startswith("I:"):
                sym = sym[2:]
            if not sym:
                continue
            _put(sym, r.get("name"), "INDEX", "Index")
    except Exception as e:
        logger.warning("[ticker_search_index] indices fetch failed: %s", e)

    # 3) cap_universe equities missing a reference row (keeps prefix search whole for
    #    any symbol we chart but Massive's active feed didn't return). Breadth
    #    pseudo-tickers + delisted names are merged by the ROUTER (proven paths).
    try:
        from api.services import cap_universe
        for sym in cap_universe.symbols():
            if sym not in out:
                _put(sym, "", "STOCK", "")
    except Exception as e:
        logger.warning("[ticker_search_index] cap_universe merge failed: %s", e)

    return list(out.values())


def build_index() -> int:
    """(Re)build the in-memory index + write the disk snapshot. Returns row count.
    Serialized — concurrent callers coalesce onto the first build."""
    global _INDEX, _BY_SYM, _BUILT_AT, _BUILDING
    with _LOCK:
        if _BUILDING:
            return len(_INDEX)
        _BUILDING = True
    try:
        rows = _collect_rows()
        if not rows:
            logger.warning("[ticker_search_index] build produced 0 rows — keeping prior")
            return len(_INDEX)
        for r in rows:
            r["name_lc"] = r["name"].lower()
        rows.sort(key=lambda r: r["sym"])
        by_sym = {r["sym"]: r for r in rows}
        with _LOCK:
            _INDEX = rows
            _BY_SYM = by_sym
            _BUILT_AT = time.time()
        try:
            tmp = _SNAP_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"built_at": _BUILT_AT,
                           "rows": [{"s": r["sym"], "n": r["name"], "t": r["type"],
                                     "e": r["exch"]} for r in rows]},
                          fh, separators=(",", ":"))
            os.replace(tmp, _SNAP_PATH)
        except Exception as e:
            logger.warning("[ticker_search_index] snapshot write failed: %s", e)
        logger.info("[ticker_search_index] built %d rows", len(rows))
        return len(rows)
    finally:
        with _LOCK:
            _BUILDING = False


def _load_snapshot() -> bool:
    global _INDEX, _BY_SYM, _BUILT_AT
    try:
        with open(_SNAP_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        rows = [{"sym": r["s"], "name": r["n"], "name_lc": (r["n"] or "").lower(),
                 "type": r["t"], "exch": r["e"]} for r in (data.get("rows") or [])]
        if not rows:
            return False
        with _LOCK:
            _INDEX = rows
            _BY_SYM = {r["sym"]: r for r in rows}
            _BUILT_AT = float(data.get("built_at") or 0.0)
        logger.info("[ticker_search_index] loaded %d rows from snapshot", len(rows))
        return True
    except FileNotFoundError:
        return False
    except Exception as e:
        logger.warning("[ticker_search_index] snapshot load failed: %s", e)
        return False


def start_background_build() -> None:
    """Load the disk snapshot instantly, then (re)build in a daemon thread if it's
    missing or stale. Also arms a daily refresh loop. Call once at web startup."""
    fresh = _load_snapshot() and (time.time() - _BUILT_AT) < _REFRESH_TTL

    def _loop():
        if not fresh:
            try:
                build_index()
            except Exception:
                logger.exception("[ticker_search_index] initial build failed")
        while True:
            time.sleep(_REFRESH_TTL)
            try:
                build_index()
            except Exception:
                logger.exception("[ticker_search_index] periodic rebuild failed")

    threading.Thread(target=_loop, name="ticker-search-index", daemon=True).start()


def ready() -> bool:
    return bool(_INDEX)


def status() -> dict:
    return {"rows": len(_INDEX), "built_at": _BUILT_AT, "building": _BUILDING,
            "snapshot": _SNAP_PATH}


# ── Search ───────────────────────────────────────────────────────────────────
def search(q: str, limit: int = 25, types: set | None = None) -> list[dict]:
    """Rank rows across BOTH symbol and name. Buckets (best first):
       0 exact symbol · 1 symbol prefix · 2 symbol contains · 3 name word-prefix
       · 4 name contains. `types` (a set of 'stock'/'etf'/'index'/…) filters chips.
    Returns light row dicts {ticker, name, type, exchange}."""
    q = (q or "").strip()
    if not q:
        return []
    ql = q.lower()
    qu = q.upper()
    with _LOCK:
        idx = _INDEX
    scored: list[tuple[int, int, dict]] = []
    for r in idx:
        if types and r["type"] not in types:
            continue
        sym = r["sym"]
        rank = None
        if sym == qu:
            rank = 0
        elif sym.startswith(qu):
            rank = 1
        elif qu in sym:
            rank = 2
        else:
            nlc = r["name_lc"]
            if nlc:
                if nlc.startswith(ql) or (" " + ql) in nlc:
                    rank = 3
                elif ql in nlc:
                    rank = 4
        if rank is not None:
            scored.append((rank, _priority(r), r))
    scored.sort(key=lambda t: (t[0], t[1], t[2]["sym"]))
    out = []
    for _rank, _pri, r in scored[:limit]:
        out.append({"ticker": r["sym"], "name": r["name"] or None,
                    "type": r["type"], "exchange": r["exch"] or None})
    return out
