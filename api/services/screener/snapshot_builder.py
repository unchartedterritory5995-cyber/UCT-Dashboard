"""Nightly builder: one precomputed screener row per ticker.

``build_row`` is pure (takes already-column-keyed dicts) and unit-tested.
The ``_read_*`` wrappers reuse data we ALREADY store — NO yfinance:
  - bars     -> ``bars_sqlite.get_bars`` (tuples -> dicts); technicals/candles/patterns
  - ratings  -> ``research_ratings.db`` stored metrics -> ``enrich.ratings_fields``
                (eps/rev growth, peg, fwd P/E, margin, ROE, RS, accdis + computed
                 uct_composite / rs_rank via the same percentile path as the
                 research page)
  - meta     -> ``ticker_meta`` cache (name/sector/industry)
  - mkt cap  -> ``massive.get_market_cap`` (Massive ticker details)
"""
import datetime
import logging
import os
import time

from . import snapshot_db, candles, technicals, patterns, enrich

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


def _read_fundamentals(ticker, price=None):
    """Company name/sector/industry from the ticker_meta cache + market cap from
    Massive (shares*price fallback). No yfinance."""
    out = {}
    try:
        from api.services.ticker_meta import get_ticker_meta
        meta = get_ticker_meta(ticker) or {}
        if meta.get("name"):
            out["company"] = meta["name"]
        if meta.get("industry"):
            out["industry"] = meta["industry"]
        if meta.get("sector"):
            out["sector"] = meta["sector"]
    except Exception:
        pass
    try:
        from api.services.massive import get_market_cap
        mc = get_market_cap(ticker, price=price)
        if mc is not None:
            out["market_cap"] = mc
    except Exception:
        pass
    return out


def _read_ratings(ticker):
    """Reuse the nightly-stored ratings metrics (research_ratings.db) — no
    network. Returns column-keyed fundamentals + computed uct_composite/rs_rank."""
    try:
        from api.services.research import ratings_db
        metrics = ratings_db.get_ticker_metrics(ticker)
    except Exception:
        metrics = None
    if not metrics:
        return {}
    return enrich.ratings_fields(metrics, enrich.load_distributions())


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
            price = bars[-1].get("c")
            row = build_row(t, bars, _read_ratings(t), _read_fundamentals(t, price))
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
