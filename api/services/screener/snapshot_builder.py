"""Nightly builder: one precomputed screener row per ticker.

``build_row`` is pure (takes already-column-keyed dicts) and unit-tested.
The ``_read_*`` wrappers adapt existing services to snapshot column names:
  - bars        -> ``bars_sqlite.get_bars`` (tuples -> dicts)
  - fundamentals-> ``fundamentals.get_fundamentals`` (``*_pct`` percent units)
  - ratings     -> ``research.ratings.get_ratings`` (composite + components.rs)
"""
import datetime
import logging
import os
import time

from . import snapshot_db, candles, technicals, patterns

log = logging.getLogger(__name__)


def build_row(ticker, bars, ratings_row, fundamentals) -> dict:
    """Merge all field groups into one snapshot row. Inputs are dicts whose
    keys are already snapshot COLUMNS (the readers do source-name mapping)."""
    row = {c: None for c in snapshot_db.COLUMNS}
    row["ticker"] = (ticker or "").upper()
    for src in (fundamentals or {}, ratings_row or {}):
        for k, v in src.items():
            if k in row and v is not None:
                row[k] = v
    if bars:
        row.update(technicals.compute_technicals(bars))
        row.update(candles.single_candle(bars))
        row.update(candles.multi_candle(bars))
        keys, conf = patterns.detect_patterns(bars)
        row["patterns"] = keys or None
        row["pattern_conf_max"] = conf or None
        if row.get("avg_volume_30d") is None:
            vols = [b.get("v") or 0 for b in bars[-30:]]
            if vols:
                row["avg_volume_30d"] = sum(vols) / len(vols)
        last_t = bars[-1].get("t")
        row["bars_asof"] = str(last_t) if last_t is not None else None
    row["snapshot_date"] = datetime.date.today().isoformat()
    row["built_at"] = int(time.time())
    return row


# ── source readers (network/disk; thin; monkeypatchable) ──────────────────────

def _read_daily_bars(ticker):
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(ticker, "D", 400) or []
    out = []
    for r in rows:
        try:
            out.append({"t": r[0], "o": r[1], "h": r[2], "l": r[3],
                        "c": r[4], "v": r[5]})
        except Exception:
            continue
    return out


_FUND_MAP = {
    "company": "name", "sector": "sector", "industry": "industry",
    "market_cap": "market_cap", "pe_ttm": "pe_trailing", "pe_fwd": "pe_forward",
    "peg": "peg", "ps": "ps", "pb": "pb",
    "eps_growth": "earnings_growth_pct", "rev_growth": "revenue_growth_pct",
    "op_margin": "operating_margin_pct", "gross_margin": "gross_margin_pct",
    "net_margin": "profit_margin_pct", "roe": "roe_pct", "roa": "roa_pct",
    "debt_to_equity": "debt_to_equity", "current_ratio": "current_ratio",
    "beta": "beta", "dividend_yield": "dividend_yield_pct",
    "inst_pct": "held_pct_institutions",
}


_CAP_SUFFIX = {"T": 1e12, "B": 1e9, "M": 1e6, "K": 1e3}


def _parse_cap(v):
    """get_fundamentals returns market_cap pre-formatted (e.g. '$4.38T'); the
    screener needs a number for range filtering. Parse $/commas/suffix."""
    if v is None or isinstance(v, (int, float)):
        return v
    s = str(v).strip().upper().replace("$", "").replace(",", "")
    if not s:
        return None
    mult = 1.0
    if s and s[-1] in _CAP_SUFFIX:
        mult = _CAP_SUFFIX[s[-1]]
        s = s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return None


def _read_fundamentals(ticker):
    out = {}
    try:
        from api.services.fundamentals import get_fundamentals
        f = get_fundamentals(ticker) or {}
    except Exception:
        return out
    for col, src in _FUND_MAP.items():
        v = f.get(src)
        if v is None:
            continue
        out[col] = _parse_cap(v) if col == "market_cap" else v
    return out


def _read_ratings(ticker):
    out = {}
    try:
        from api.services.research.ratings import get_ratings
        r = get_ratings(ticker) or {}
    except Exception:
        return out
    if r.get("composite") is not None:
        out["uct_composite"] = r["composite"]
    comp = r.get("components") or {}
    rs = comp.get("rs")
    if isinstance(rs, (int, float)):
        out["rs_rank"] = int(rs)
    if comp.get("accdis") is not None:
        out["accdis"] = comp["accdis"]
    return out


# ── orchestration ─────────────────────────────────────────────────────────────

def _load_universe():
    import json
    for p in ("api/data/cap_universe.json",
              os.path.join(os.path.dirname(__file__), "..", "..", "data",
                           "cap_universe.json")):
        if os.path.exists(p):
            with open(p) as fh:
                data = json.load(fh)
            # file is a flat list of ticker strings
            return [t for t in data if isinstance(t, str)]
    return []


def _stalest(tickers, limit):
    """Order tickers by stalest built_at (never-built first), capped to limit."""
    try:
        with snapshot_db.connect() as conn:
            built = {r["ticker"]: r["built_at"] for r in
                     conn.execute("SELECT ticker, built_at FROM screener_rows")}
    except Exception:
        built = {}
    ordered = sorted(
        tickers,
        key=lambda t: (built.get(t.upper()) is not None, built.get(t.upper()) or 0))
    return ordered[:limit] if limit else ordered


def run_build(max_tickers=None) -> dict:
    snapshot_db.init_db()
    universe = _load_universe()
    cap = max_tickers or int(os.environ.get("SCREENER_SNAPSHOT_MAX_PER_RUN", "4000"))
    targets = _stalest(universe, cap)
    built = skipped = errors = 0
    batch = []
    for t in targets:
        try:
            bars = _read_daily_bars(t)
            if not bars:
                skipped += 1
                continue
            row = build_row(t, bars, _read_ratings(t), _read_fundamentals(t))
            batch.append(row)
            built += 1
            if len(batch) >= 200:
                snapshot_db.upsert_rows(batch)
                batch = []
        except Exception as e:
            errors += 1
            log.warning("[screener] build %s failed: %s", t, e)
    if batch:
        snapshot_db.upsert_rows(batch)
    log.info("[screener] build done built=%s skipped=%s errors=%s",
             built, skipped, errors)
    return {"built": built, "skipped": skipped, "errors": errors}
