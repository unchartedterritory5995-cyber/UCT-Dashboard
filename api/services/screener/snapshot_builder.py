"""Nightly builder: one precomputed screener row per ticker.

``build_row`` is pure (takes already-column-keyed dicts) and unit-tested.
The ``_read_*`` wrappers reuse data we ALREADY store — NO yfinance:
  - bars     -> ``bars_sqlite.get_bars`` (tuples -> dicts); technicals/candles/patterns
  - ratings  -> ``research_ratings.db`` stored metrics -> ``enrich.ratings_fields``
                (eps/rev growth, peg, fwd P/E, margin, ROE, accdis + computed
                 uct_composite via the same percentile path as the research page)
  - RS       -> ``rs_ranking``'s warmed universe rankings (``rs_rank``/``rs_return``)
  - meta     -> ``ticker_meta`` cache (name/sector/industry)
  - mkt cap  -> ``massive.get_market_cap`` (Massive ticker details)

🔴 EVERY COLUMN THIS BUILDER CAN WRITE IS COUNTED, AND THE COUNTS ARE THE
RETURN VALUE. On 2026-08-09 the 03:05 build wrote 3,708 rows in which
``market_cap`` was NULL on **every single one** — not because the code was
wrong (it fills 15/15 when exercised) but because the process had no
``MASSIVE_API_KEY``, so ``_read_fundamentals``'s ``except Exception: pass``
swallowed the same ``RuntimeError`` 3,708 times and the build logged
``built=3708 skipped=0 errors=0``. A total provider outage and a healthy run
printed the SAME LINE. `run_build` now returns ``populated`` (per-column
non-null counts) and ``sources`` (per-reader failure counts) and logs any
column that came out 0/N by NAME. See ``tests/test_scalar_population_rail.py``.
"""
import datetime
import logging
import os
import time

from . import snapshot_db, candles, technicals, patterns, enrich

log = logging.getLogger(__name__)


def rs_fields(rs_row) -> dict:
    """``rs_ranking`` entry -> snapshot columns. ``{}`` when there is no entry.

    ⭐ THE ONE MAPPING between the RS authority and the screener's two RS
    columns, so "which field becomes which column" is stated once.

    ``rs_score`` -> ``rs_return`` is not a rename of convenience: it is the
    40%·3m + 20%·6m + 20%·1m + 20%·1w weighted return
    (``rs_ranking._compute_returns``), which is the same quantity
    ``research.ratings._weighted_rs_return`` computes and the same number
    ``rs_rank`` is the universe percentile OF. Writing both from one entry is
    what makes the rank and the return beside it consistent by construction.
    """
    if not rs_row:
        return {}
    out = {}
    rank = rs_row.get("rs_rank")
    if rank is not None:
        out["rs_rank"] = int(rank)
    score = rs_row.get("rs_score")
    if score is not None:
        out["rs_return"] = float(score)
    return out


def build_row(ticker, bars, ratings_row, fundamentals, rs_row=None) -> dict:
    """Merge all field groups into one snapshot row. Inputs are dicts whose
    keys are already snapshot COLUMNS (the readers do source-name mapping)."""
    row = {c: None for c in snapshot_db.COLUMNS}
    row["ticker"] = (ticker or "").upper()
    # ⚠️ ORDER IS AUTHORITY. Later sources win, so `rs_fields` is LAST and owns
    # `rs_rank`/`rs_return` outright. `enrich.ratings_fields` no longer emits
    # either (see its docstring) — this ordering is the belt to that braces, so
    # the day somebody re-adds them there the rank still comes from one place.
    for src in (fundamentals or {}, ratings_row or {}, rs_fields(rs_row)):
        for k, v in src.items():
            if k in row and v is not None:
                row[k] = v
    # ONE sanitize for all four bar consumers below. Each of them does bare
    # OHLC arithmetic, so a single null close (halt, thin tape, provider gap)
    # used to raise out of whichever ran first and lose the whole row — the
    # ticker's fundamentals and ratings included, which had nothing to do with
    # the bad bar. See technicals.usable_bars.
    bars = technicals.usable_bars(bars)
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


def _read_fundamentals(ticker, price=None, failures=None):
    """Company name/sector/industry from the ticker_meta cache + market cap from
    Massive (shares*price fallback). No yfinance.

    ⛔ THE `except` CLAUSES STILL SWALLOW — one bad ticker must never cost the
    build — BUT THEY NO LONGER SWALLOW SILENTLY. `failures` is an optional
    `{source: {outcome: count}}` out-dict; `run_build` passes one and reports it.

    🔴 AND IT COUNTS **MISSES**, NOT ONLY RAISES — which is the whole reason this
    works. The first cut of this census counted `except` arms only, and the
    negative control (`fix_empty_scalars_measure.py --no-key`) proved it could
    never fire: `massive.get_ticker_details` has its OWN `except: return {}`, so
    a missing `MASSIVE_API_KEY` reaches here as a polite `None`, not as an
    exception. A counter that cannot count the thing it exists for is worse than
    no counter. `{'massive_market_cap': {'none': 60}}` out of 60 tickers is a
    credential or plan problem; `{'none': 9}` out of 397 is nine odd symbols.
    """
    out = {}

    def _note(source, outcome):
        if failures is None:
            return
        key = outcome if isinstance(outcome, str) else type(outcome).__name__
        failures.setdefault(source, {})
        failures[source][key] = failures[source].get(key, 0) + 1

    try:
        from api.services.ticker_meta import get_ticker_meta
        meta = get_ticker_meta(ticker) or {}
        if meta.get("name"):
            out["company"] = meta["name"]
        if meta.get("industry"):
            out["industry"] = meta["industry"]
        if meta.get("sector"):
            out["sector"] = meta["sector"]
        else:
            _note("ticker_meta", "none")
    except Exception as e:
        _note("ticker_meta", e)
    try:
        from api.services.massive import get_market_cap
        mc = get_market_cap(ticker, price=price)
        if mc is not None:
            out["market_cap"] = mc
        else:
            _note("massive_market_cap", "none")
    except Exception as e:
        _note("massive_market_cap", e)
    return out


def _read_ratings(ticker, failures=None):
    """Reuse the nightly-stored ratings metrics (research_ratings.db) — no
    network. Returns column-keyed fundamentals + computed uct_composite.

    ⚠️ AN EMPTY `research_ratings.db` LOOKS EXACTLY LIKE A UNIVERSE OF UNRATED
    TICKERS from inside this function — both are `{}` — so the MISS is counted
    (`{'ratings_db': {'no_metrics': N}}`) and left for `run_build` to report
    rather than guessed at here. `ratings_db.get_ticker_metrics` swallows its
    own errors and returns `None`, so counting only `except` arms would count
    nothing. Its only writer is `research.ratings_universe.nightly_job`,
    registered only under `RATINGS_PERCENTILE_ENABLED` (default `0`); on
    2026-08-09 the file was 0 bytes.
    """
    def _note(outcome):
        if failures is None:
            return
        key = outcome if isinstance(outcome, str) else type(outcome).__name__
        failures.setdefault("ratings_db", {})
        failures["ratings_db"][key] = failures["ratings_db"].get(key, 0) + 1

    try:
        from api.services.research import ratings_db
        metrics = ratings_db.get_ticker_metrics(ticker)
    except Exception as e:
        _note(e)
        metrics = None
    if not metrics:
        _note("no_metrics")
        return {}
    return enrich.ratings_fields(metrics, enrich.load_distributions())


def _read_rs_map():
    """``{TICKER: rs_row}`` from `rs_ranking`'s warmed cache. ``{}`` when cold.

    ⛔ ONE READ PER BUILD, AND NEVER A COMPUTE. See
    `rs_ranking.cached_rank_map` for why the ~17s full-universe rebuild belongs
    to the background warmer and not here.
    """
    try:
        from api.services import rs_ranking
        return rs_ranking.cached_rank_map()
    except Exception:
        log.warning("[screener] rs_ranking unavailable; rs_rank/rs_return "
                    "will be NULL for this build", exc_info=True)
        return {}


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
    """Build + upsert the snapshot, and REPORT WHAT ACTUALLY LANDED.

    Returns ``{built, skipped, errors, populated, empty_columns, sources}``:

      * ``populated`` — ``{column: non_null_rows}`` over the rows THIS run
        built. Counted off the rows themselves, never re-queried from the DB: a
        second count of the same thing is how two numbers start disagreeing.
      * ``empty_columns`` — the columns that came out 0/N, sorted. This is the
        one line an operator has to read.
      * ``sources`` — ``{reader: {ExceptionName: count}}`` from the readers.

    🔴 WHY: the 2026-08-09 03:05 build logged ``built=3708 skipped=0 errors=0``
    while writing NULL into ``market_cap`` on all 3,708 rows. Nothing in that
    line could have told anyone. ``errors`` counts rows LOST; it has never
    counted a column that silently came back empty on every row that survived.
    """
    snapshot_db.init_db()
    universe = _load_universe()
    cap = max_tickers or int(os.environ.get("SCREENER_SNAPSHOT_MAX_PER_RUN", "4000"))
    targets = _stalest(universe, cap)
    built = skipped = errors = 0
    batch = []
    # ⛔ DERIVED FROM THE SCHEMA, never a hand-listed set — a 66th column is
    # counted the day it lands, with nothing to remember to add here.
    populated = {c: 0 for c in snapshot_db.COLUMNS}
    sources: dict = {}
    rs_map = _read_rs_map()
    for t in targets:
        try:
            bars = _read_daily_bars(t)
            if not bars:
                skipped += 1
                continue
            price = bars[-1].get("c")
            rs_row = rs_map.get(t.upper())
            if not rs_row:
                # Counted like any other provider miss: an empty `rs_ranking`
                # cache and a symbol genuinely outside the ranked universe are
                # both "no rank", and only the RATIO tells them apart.
                sources.setdefault("rs_ranking", {})
                sources["rs_ranking"]["no_rank"] = \
                    sources["rs_ranking"].get("no_rank", 0) + 1
            row = build_row(t, bars,
                            _read_ratings(t, failures=sources),
                            _read_fundamentals(t, price, failures=sources),
                            rs_row)
            for col, val in row.items():
                if val is not None and col in populated:
                    populated[col] += 1
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

    empty_columns = sorted(c for c in snapshot_db.COLUMNS
                           if built and populated[c] == 0)
    log.info("[screener] build done built=%s skipped=%s errors=%s "
             "rs_map=%s empty_columns=%s",
             built, skipped, errors, len(rs_map),
             ",".join(empty_columns) or "none")
    if sources:
        # NAMED, never a count alone: "RuntimeError x3708 from massive_market_cap"
        # is a credential problem; "HTTPError x9" is a flaky provider.
        log.warning("[screener] reader failures: %s", sources)
    return {"built": built, "skipped": skipped, "errors": errors,
            "populated": populated, "empty_columns": empty_columns,
            "sources": sources}
