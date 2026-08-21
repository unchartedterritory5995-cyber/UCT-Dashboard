"""Context joins — classification columns from stores the pod already holds.

ONE read per build per source, NEVER a per-ticker network call. Each reader's
key set is disjoint from every other snapshot source and is registered in
tests/test_screener_fundamentals_bulk.py::_source_key_sets (the rail RUNS
sources and diffs their key sets — Task 9 registers these).

The honesty rule every reader shares: a DEAD OR EMPTY source returns {}, so
its columns stay None (not-computable) on every row; a HEALTHY source answers
for the whole target list, so a ticker absent from its lists is a real False.
Collapsing those two states is how a snapshot lies (the 2026-08-09
all-NULL-market_cap lesson, in bool form).

⚠️ Every reader below emits DICT LITERALS keyed by the exact snapshot column
names (never a dynamically-built mapping) — the scalar-population rail
derives writers by AST over ``d["col"] = v`` and ``{"col": v}`` shapes, and a
mapping built from a runtime dict/comprehension is an invisible collector.
"""


def _note(failures, source, outcome):
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def read_breadth_flags(targets, failures=None):
    """Weinstein stage + HVC flags off the LATEST breadth snapshot.

    Derived from the breadth store, never recomputed from bars.db — the
    collector's price basis is dividend-adjusted (spec §2.1). At 03:00 ET the
    latest snapshot is the prior session's 4:15 PM ET write: the right basis
    for a nightly artifact. get_universe_stocks() re-decodes the whole day
    blob per call — call it exactly once.
    """
    try:
        from api.services import breadth_monitor
        data = breadth_monitor.get_universe_stocks() or {}
    except Exception as e:
        _note(failures, "breadth_flags", e)
        return {}
    stocks = data.get("stocks") or []
    if not stocks:
        _note(failures, "breadth_flags", "empty")
        return {}
    listed = {}
    for s in stocks:
        t = (s.get("ticker") or "").upper()
        if t:
            tags = set(s.get("tags") or ())
            listed[t] = {"stage2": "s2" in tags, "stage4": "s4" in tags,
                         "hvc_52w": "hvc" in tags}
    absent = {"stage2": False, "stage4": False, "hvc_52w": False}
    return {t.upper(): listed.get(t.upper(), dict(absent)) for t in targets}


def read_uct20(targets, failures=None):
    """Leadership-20 membership. Rank is the LIST INDEX (no rank field —
    LeadershipTile renders #{i+1}); the ticker key is polymorphic across
    pushes, so coalesce ticker/sym/symbol like every other consumer."""
    try:
        from api.services import engine
        lead = engine.get_leadership() or []
    except Exception as e:
        _note(failures, "uct20", e)
        return {}
    syms = set()
    for it in lead:
        if isinstance(it, dict):
            s = (it.get("ticker") or it.get("sym") or it.get("symbol") or "")
            if s:
                syms.add(str(s).upper())
    if not syms:
        # an unpushed wire and a genuinely empty list are indistinguishable
        # here — both mean "cannot answer", never "nobody is in the 20"
        _note(failures, "uct20", "empty")
        return {}
    return {t.upper(): {"in_uct20": t.upper() in syms} for t in targets}


def read_index_flags(targets, failures=None):
    """S&P 500 / Nasdaq 100 / Dow / Russell 2000 membership from the prebuilt
    lists (committed baseline + the refresh overlay + delisted subtraction) —
    watchlist_prebuilt._load_lists() is the one-call bulk read; a failed FMP
    refresh keeps the prior overlay, so this never goes empty on a bad night.
    """
    name_to_col = {"s&p 500": "index_sp500", "nasdaq 100": "index_ndx",
                   "dow 30": "index_dow", "russell 2000": "index_r2k"}
    try:
        from api.services import watchlist_prebuilt
        lists = watchlist_prebuilt._load_lists() or []
    except Exception as e:
        _note(failures, "index_lists", e)
        return {}
    member_sets = {}
    for row in lists:
        col = name_to_col.get(str(row.get("name", "")).lower())
        if col:
            member_sets[col] = {str(t).upper() for t in (row.get("tickers") or ())}
    if len(member_sets) < len(name_to_col):
        _note(failures, "index_lists",
              f"missing:{len(name_to_col) - len(member_sets)}")
    if not member_sets:
        return {}
    # Dict LITERAL with fixed column names — never build this mapping from
    # `member_sets` dynamically (see the module docstring: the AST writer
    # rail can only see constant keys).
    out = {}
    for t in targets:
        tu = t.upper()
        out[tu] = {
            "index_sp500": tu in member_sets.get("index_sp500", ()),
            "index_ndx": tu in member_sets.get("index_ndx", ()),
            "index_dow": tu in member_sets.get("index_dow", ()),
            "index_r2k": tu in member_sets.get("index_r2k", ()),
        }
    return out


def read_etf_flags(targets, failures=None):
    """is_etf from the industry map (Finviz whole-market classification);
    is_leveraged from the single-stock/leveraged ETF family table. Each
    sub-source stands alone: one dead leg drops only its own column.
    Direct table read on ssetf — lookup() has a self-heal side effect and a
    per-symbol cache; 3,700 calls is the wrong shape."""
    cols = {}
    try:
        from api.services import industry_map
        etfs = {str(t).upper() for t in
                (industry_map.tickers_in_industry("Exchange Traded Fund") or ())}
        if etfs:
            cols["is_etf"] = etfs
        else:
            _note(failures, "industry_map_etf", "empty")
    except Exception as e:
        _note(failures, "industry_map_etf", e)
    try:
        from api.services import single_stock_etfs
        with single_stock_etfs._connect() as conn:
            lev = {str(r[0]).upper() for r in
                   conn.execute("SELECT etf_ticker FROM etfs")}
        if lev:
            cols["is_leveraged"] = lev
        else:
            _note(failures, "ssetf", "empty")
    except Exception as e:
        _note(failures, "ssetf", e)
    if not cols:
        return {}
    return {t.upper(): {col: t.upper() in tks for col, tks in cols.items()}
            for t in targets}
