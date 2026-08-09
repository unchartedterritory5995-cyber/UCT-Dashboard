"""Registry of DELISTED tickers — dead companies (bankruptcy, merger, take-private)
that no longer trade but whose historical charts we want fully accessible, exactly like
a live ticker.

Source-agnostic by design. Two data sources feed ONE registry:
  1. Massive/Polygon already retains delisted daily OHLCV back to ~2003 (YHOO, TWTR, LEH,
     …) — those chart through the EXISTING /api/bars path with no new data at all; the
     registry just marks them delisted so the frontend freezes the live paths.
  2. Pre-2003 dead names (Enron, WorldCom, …) that the provider floor doesn't cover come
     from imported CSVs (Stooq/Kaggle/etc.) written into bars.db under the same key; they
     get a registry entry too.

The registry itself is metadata only (name / sector / industry / delisting date), seeded
from api/data/delisted_tickers.json and extendable at runtime via a durable /data overlay
file so a CSV-import run can append without editing the shipped seed. The bars come from
wherever they already live (Massive or bars.db) — this module never fetches prices.

Kept deliberately OUT of cap_universe.json / the live warmers: a dead ticker must never be
pulled into live-price / streaming / freshness / reconciliation loops (it has no live feed;
chasing one blanks the chart). Discovery is via ticker-search merge + this registry only.
"""
import json
import os
import threading
from typing import Optional

_SEED_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "delisted_tickers.json")
# Durable runtime overlay (CSV imports append here; survives redeploys). Merged over the seed.
_OVERLAY_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "delisted_tickers_overlay.json")

# Lower clamp for the historical fetch when an entry doesn't specify first_date.
# The provider floors ~2003 anyway, so a wide default just means "everything available".
_DEFAULT_FIRST_DATE = "1990-01-01"

_lock = threading.Lock()
_by_ticker: dict = {}
_loaded = False


def _norm(sym: str) -> str:
    return (sym or "").strip().upper()


def _coerce(entry: dict) -> Optional[dict]:
    """Validate + normalize one raw record. Returns None if it has no ticker.

    `ticker` is the KEY / app symbol — DISTINCT for a reused ticker (e.g. Bear Stearns
    is 'BSC-OLD' because 'BSC' is now a live ETN), so is_delisted('BSC') stays False and
    the live ETN is never mislabeled. `provider_symbol` is what we actually fetch from the
    provider (the bare 'BSC'), and [first_date, last_date] clamp the fetch to this entity's
    trading life so a reused symbol's two eras can never combine into one chart."""
    t = _norm(entry.get("ticker"))
    if not t:
        return None
    delisted_date = entry.get("delisted_date") or None
    return {
        "ticker": t,
        "provider_symbol": _norm(entry.get("provider_symbol")) or t,
        "name": entry.get("name") or None,
        "sector": entry.get("sector") or None,
        "industry": entry.get("industry") or None,
        "delisted_date": delisted_date,                        # ISO YYYY-MM-DD
        "first_date": entry.get("first_date") or _DEFAULT_FIRST_DATE,
        "last_date": entry.get("last_date") or delisted_date,  # upper clamp = delisting date
        "reason": entry.get("reason") or None,
        "source": entry.get("source") or "massive",            # massive | csv | ...
    }


def _read_file(path: str) -> list:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        out: dict = {}
        # Seed first, then overlay wins on conflict (runtime imports / corrections).
        for rec in _read_file(_SEED_PATH) + _read_file(_OVERLAY_PATH):
            c = _coerce(rec) if isinstance(rec, dict) else None
            if c:
                out[c["ticker"]] = c
        _by_ticker = out
        globals()["_by_ticker"] = out
        _loaded = True


def is_delisted(sym: str) -> bool:
    _ensure_loaded()
    return _norm(sym) in _by_ticker


def get(sym: str) -> Optional[dict]:
    """Metadata dict for a delisted ticker, or None if it isn't one."""
    _ensure_loaded()
    return _by_ticker.get(_norm(sym))


def all_entries() -> list:
    """Every registry entry, ticker-sorted."""
    _ensure_loaded()
    return [_by_ticker[t] for t in sorted(_by_ticker)]


def tickers() -> set:
    _ensure_loaded()
    return set(_by_ticker)


def search(q: str, limit: int = 20) -> list:
    """Delisted matches for an autocomplete query — exact > prefix > substring over the
    ticker, plus a substring match on the company name. Each result carries `delisted: True`
    and the delisting date so the dropdown can label it."""
    _ensure_loaded()
    qq = _norm(q)
    if not qq:
        return []
    exact, prefix, sub = [], [], []
    for t, rec in _by_ticker.items():
        name_up = (rec.get("name") or "").upper()
        prov = (rec.get("provider_symbol") or "").upper()
        # Match the KEY, the PROVIDER symbol (so "BSC" finds the "BSC-OLD" Bear Stearns
        # entry), or the company name.
        if t == qq or prov == qq:
            exact.append(rec)
        elif t.startswith(qq) or prov.startswith(qq):
            prefix.append(rec)
        elif qq in t or qq in prov or qq in name_up:
            sub.append(rec)
    merged = exact + prefix + sub
    return merged[:limit]


def add_entry(entry: dict, persist: bool = True) -> Optional[dict]:
    """Insert/update one delisted record (used by CSV import). When persist=True the
    durable overlay file is rewritten so the addition survives a redeploy."""
    c = _coerce(entry)
    if not c:
        return None
    _ensure_loaded()
    with _lock:
        _by_ticker[c["ticker"]] = c
        if persist:
            try:
                os.makedirs(os.path.dirname(_OVERLAY_PATH), exist_ok=True)
                # Persist only the non-seed (overlay) additions so the seed stays canonical.
                seed_tickers = {_norm(r.get("ticker")) for r in _read_file(_SEED_PATH) if isinstance(r, dict)}
                overlay = [rec for tk, rec in _by_ticker.items() if tk not in seed_tickers]
                tmp = _OVERLAY_PATH + ".tmp"
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump(overlay, fh, indent=2)
                os.replace(tmp, _OVERLAY_PATH)
            except Exception:
                pass
    return c


def reload() -> int:
    """Force a re-read of seed + overlay (after a bulk import). Returns entry count."""
    global _loaded
    with _lock:
        _loaded = False
    _ensure_loaded()
    return len(_by_ticker)
