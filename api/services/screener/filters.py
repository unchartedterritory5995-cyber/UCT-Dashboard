"""Filter registry + result views — single source of truth shared with the
frontend via ``meta()``. The API speaks filter ``key``s (never raw SQL column
names); ``column_for``/``is_valid_op`` gate every query.

Unit convention (matches the snapshot builder):
  - margins / growth / roe / roa / dividend_yield are stored as PERCENT numbers
    (e.g. 25.0 == 25%). Presets below are in percent.
  - pe/peg/ps/pb/beta/debt_to_equity/current_ratio are plain ratios.
    uct_composite/rs_rank are 0-99.

⚰️ THIS SAID *"debt_to_equity is the yfinance value (percent-ish, e.g. 47.5)"*
until 2026-08-09, describing a column that had never held a single value in
3,708 rows, sourced from a provider that never wrote it. It is now filled by
`fundamentals_bulk` from FMP's `debtToEquityRatioTTM`, whose native form is the
RATIO (AAPL 0.78, not 78) — which is also what the manifest sentence ("the
debt-to-equity ratio") says and what `columnDefs.js` renders it as, with
`num(1)` rather than a percent formatter. A unit note for an empty column is
free to be wrong, so it was; it is load-bearing the moment data arrives.
"""


def _range(key, label, category, column, presets, unit=None):
    return key, {"label": label, "category": category, "type": "range",
                 "column": column, "presets": presets, "allow_custom": True,
                 "unit": unit}


def _enum(key, label, category, column, presets):
    return key, {"label": label, "category": category, "type": "enum",
                 "column": column, "presets": presets, "allow_custom": False,
                 "unit": None}


def _bool(key, label, category, column):
    return key, {"label": label, "category": category, "type": "bool",
                 "column": column, "presets": [
                     {"label": "Any"},
                     {"label": "Yes", "op": "eq", "value": 1},
                     {"label": "No", "op": "eq", "value": 0}],
                 "allow_custom": False, "unit": None}


FILTERS = dict([
    # ── descriptive ──
    _enum("sector", "Sector", "descriptive", "sector",
          [{"label": "Any"}]),  # options injected dynamically by meta()
    _range("market_cap", "Market Cap", "descriptive", "market_cap",
           [{"label": "Any"},
            {"label": "Mega (>$200B)", "op": "gte", "min": 2e11},
            {"label": "Large (>$10B)", "op": "gte", "min": 1e10},
            {"label": "Mid+ (>$2B)", "op": "gte", "min": 2e9},
            {"label": "Small+ (>$300M)", "op": "gte", "min": 3e8}], unit="$"),
    _range("price", "Price", "descriptive", "price",
           [{"label": "Any"},
            {"label": "Over $10", "op": "gte", "min": 10},
            {"label": "Over $50", "op": "gte", "min": 50},
            {"label": "Under $20", "op": "lte", "max": 20}], unit="$"),
    _range("avg_volume_30d", "Avg Volume (30d)", "descriptive", "avg_volume_30d",
           [{"label": "Any"},
            {"label": "Over 1M", "op": "gte", "min": 1e6},
            {"label": "Over 5M", "op": "gte", "min": 5e6}]),
    # ── fundamental ── (sourced from the nightly research_ratings.db gather)
    _range("pe_fwd", "Forward P/E", "fundamental", "pe_fwd",
           [{"label": "Any"}, {"label": "Under 20", "op": "lte", "max": 20},
            {"label": "Under 35", "op": "lte", "max": 35}]),
    _range("peg", "PEG", "fundamental", "peg",
           [{"label": "Any"}, {"label": "Under 1", "op": "lte", "max": 1},
            {"label": "Under 2", "op": "lte", "max": 2}]),
    _range("eps_growth", "EPS Growth", "fundamental", "eps_growth",
           [{"label": "Any"}, {"label": "Positive", "op": "gte", "min": 0},
            {"label": "Over 25%", "op": "gte", "min": 25},
            {"label": "Over 50%", "op": "gte", "min": 50}], unit="%"),
    _range("rev_growth", "Revenue Growth", "fundamental", "rev_growth",
           [{"label": "Any"}, {"label": "Positive", "op": "gte", "min": 0},
            {"label": "Over 20%", "op": "gte", "min": 20}], unit="%"),
    _range("op_margin", "Operating Margin", "fundamental", "op_margin",
           [{"label": "Any"}, {"label": "Positive", "op": "gte", "min": 0},
            {"label": "Over 20%", "op": "gte", "min": 20}], unit="%"),
    _range("roe", "ROE", "fundamental", "roe",
           [{"label": "Any"}, {"label": "Over 15%", "op": "gte", "min": 15},
            {"label": "Over 25%", "op": "gte", "min": 25}], unit="%"),
    _range("uct_composite", "UCT Composite", "fundamental", "uct_composite",
           [{"label": "Any"}, {"label": "Over 80", "op": "gte", "min": 80},
            {"label": "Over 90", "op": "gte", "min": 90}]),
    # ── technical ──
    _range("rs_rank", "RS Rank", "technical", "rs_rank",
           [{"label": "Any"}, {"label": "Over 70", "op": "gte", "min": 70},
            {"label": "Over 80", "op": "gte", "min": 80},
            {"label": "Over 90", "op": "gte", "min": 90}]),
    _bool("above_50sma", "Above 50 SMA", "technical", "above_50sma"),
    _enum("ma_stack", "MA Stack", "technical", "ma_stack",
          [{"label": "Any"},
           {"label": "Full bull", "op": "eq", "value": "full-bull"},
           {"label": "Partial", "op": "eq", "value": "partial"},
           {"label": "Bear", "op": "eq", "value": "bear"}]),
    _range("rsi14", "RSI (14)", "technical", "rsi14",
           [{"label": "Any"}, {"label": "Oversold (<30)", "op": "lte", "max": 30},
            {"label": "40–60", "op": "between", "min": 40, "max": 60},
            {"label": "Overbought (>70)", "op": "gte", "min": 70}]),
    _range("vol_ratio", "Volume Ratio", "technical", "vol_ratio",
           [{"label": "Any"}, {"label": "Over 1.5×", "op": "gte", "min": 1.5},
            {"label": "Over 2×", "op": "gte", "min": 2}], unit="×"),
    _range("adr_pct", "ADR %", "technical", "adr_pct",
           [{"label": "Any"}, {"label": "Over 4%", "op": "gte", "min": 4},
            {"label": "Over 8%", "op": "gte", "min": 8}], unit="%"),
    _range("gap_pct", "Gap %", "technical", "gap_pct",
           [{"label": "Any"}, {"label": "Up >3%", "op": "gte", "min": 3},
            {"label": "Down >3%", "op": "lte", "max": -3}], unit="%"),
    _range("dist_52w_high_pct", "Dist from 52W High", "technical", "dist_52w_high_pct",
           [{"label": "Any"}, {"label": "Within 5%", "op": "gte", "min": -5}], unit="%"),
    _bool("new_52w_high", "New 52W High", "technical", "new_52w_high"),
    _range("pct_vs_ema20", "EMA20 Distance", "technical", "pct_vs_ema20",
           [{"label": "Any"},
            {"label": "Within 2%", "op": "between", "min": -2, "max": 2}], unit="%"),
    # ── single candle ──
    _enum("candle_type", "Candle Type", "single_candle", "candle_type",
          [{"label": "Any"},
           {"label": "Hammer", "op": "eq", "value": "hammer"},
           {"label": "Doji", "op": "eq", "value": "doji"},
           {"label": "Bullish Engulfing", "op": "eq", "value": "bullish-engulfing"},
           {"label": "Bearish Engulfing", "op": "eq", "value": "bearish-engulfing"},
           {"label": "Shooting Star", "op": "eq", "value": "shooting-star"},
           {"label": "Marubozu", "op": "eq", "value": "marubozu"}]),
    _bool("wide_bar", "Wide Bar (>1.5 ATR)", "single_candle", "wide_bar"),
    _bool("narrow_bar", "Narrow Bar (<0.5 ATR)", "single_candle", "narrow_bar"),
    _range("close_position", "Close Position in Range", "single_candle", "close_position",
           [{"label": "Any"},
            {"label": "Top third (>0.66)", "op": "gte", "min": 0.66},
            {"label": "Bottom third (<0.33)", "op": "lte", "max": 0.33}]),
    # ── multi candle ──
    _bool("tight_consolidation", "Tight Consolidation", "multi_candle", "tight_consolidation"),
    _bool("nr7", "NR7 (narrowest of 7)", "multi_candle", "nr7"),
    _range("inside_bar_run", "Inside-Bar Run", "multi_candle", "inside_bar_run",
           [{"label": "Any"}, {"label": "2+", "op": "gte", "min": 2}]),
    _range("higher_lows_run", "Higher-Lows Run", "multi_candle", "higher_lows_run",
           [{"label": "Any"}, {"label": "3+", "op": "gte", "min": 3}]),
    _range("pullback_depth_pct", "Pullback Depth", "multi_candle", "pullback_depth_pct",
           [{"label": "Any"}, {"label": "Shallow (<10%)", "op": "lte", "max": 10},
            {"label": "Deep (>20%)", "op": "gte", "min": 20}], unit="%"),
    _range("consecutive_up", "Consecutive Up Days", "multi_candle", "consecutive_up",
           [{"label": "Any"}, {"label": "3+", "op": "gte", "min": 3}]),
    # ── pattern ──
    _enum("pattern", "Chart Pattern", "pattern", "patterns",
          [{"label": "Any"},
           {"label": "VCP", "op": "contains", "value": "vcp"},
           {"label": "Flat Base", "op": "contains", "value": "flat_base"},
           {"label": "Bull Flag", "op": "contains", "value": "bull_flag"},
           {"label": "52W Breakout", "op": "contains", "value": "breakout_52w"},
           {"label": "Golden Cross", "op": "contains", "value": "golden_cross"},
           {"label": "Death Cross", "op": "contains", "value": "death_cross"}]),
])

_VALID_OPS = {
    "range": {"gte", "lte", "between"},
    "enum": {"eq", "in", "contains"},
    "bool": {"eq"},
}

VIEWS = {
    "overview": {"label": "Overview", "columns": [
        "ticker", "company", "sector", "market_cap", "price", "chg_pct_1d",
        "vol_ratio", "rs_rank", "patterns"]},
    "valuation": {"label": "Valuation", "columns": [
        "ticker", "company", "market_cap", "pe_fwd", "peg", "price",
        "uct_composite"]},
    "financial": {"label": "Financial", "columns": [
        "ticker", "eps_growth", "rev_growth", "op_margin", "roe",
        "rs_return", "accdis"]},
    "technical": {"label": "Technical", "columns": [
        "ticker", "rsi14", "pct_vs_sma50", "pct_vs_sma200", "adr_pct",
        "dist_52w_high_pct", "vol_ratio", "gap_pct", "pct_vs_ema20",
        "candle_type"]},
    "uct_ratings": {"label": "UCT Ratings", "columns": [
        "ticker", "uct_composite", "rs_rank", "rs_return", "accdis",
        "eps_growth", "op_margin", "roe"]},
    "charts": {"label": "Charts", "columns": [
        "ticker", "company", "chg_pct_1d", "price"]},
}

CATEGORIES = [
    {"key": "descriptive", "label": "Descriptive"},
    {"key": "fundamental", "label": "Fundamental"},
    {"key": "technical", "label": "Technical"},
    {"key": "single_candle", "label": "Single Candle"},
    {"key": "multi_candle", "label": "Multi-Candle"},
    {"key": "pattern", "label": "Patterns"},
]


def column_for(key):
    f = FILTERS.get(key)
    return f["column"] if f else None


def is_valid_op(key, op):
    f = FILTERS.get(key)
    if not f:
        return False
    return op in _VALID_OPS.get(f["type"], set())


def _sector_options():
    try:
        from api.services.screener import snapshot_db
        with snapshot_db.connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT sector FROM screener_rows "
                "WHERE sector IS NOT NULL AND sector != '' ORDER BY sector").fetchall()
        return [{"label": "Any"}] + \
            [{"label": r["sector"], "op": "eq", "value": r["sector"]} for r in rows]
    except Exception:
        return [{"label": "Any"}]


def meta() -> dict:
    out_filters = []
    for key, f in FILTERS.items():
        presets = _sector_options() if key == "sector" else f["presets"]
        out_filters.append({"key": key, "label": f["label"],
                            "category": f["category"], "type": f["type"],
                            "presets": presets, "allow_custom": f["allow_custom"],
                            "unit": f["unit"]})
    return {"filters": out_filters,
            "views": [{"key": k, **v} for k, v in VIEWS.items()],
            "categories": CATEGORIES}
