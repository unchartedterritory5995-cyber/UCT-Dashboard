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
                 "unit": unit, "options_column": None}


def _enum(key, label, category, column, presets, options_column=None):
    """``options_column`` names the snapshot column whose DISTINCT values become
    this filter's preset list at ``meta()`` time — see ``_distinct_options``."""
    return key, {"label": label, "category": category, "type": "enum",
                 "column": column, "presets": presets, "allow_custom": False,
                 "unit": None, "options_column": options_column}


def _open_range(key, label, category, column, unit=None, factual=()):
    """A range control with no EDITORIAL preset thresholds — only ``Any``, the
    custom min/max the member types, and any FACTUAL presets passed in.

    🔴 WHY THESE SHIP BARE, when `pe_fwd` beside them offers "Under 20".
    A preset is an EDITORIAL CLAIM: shipping *"P/E: Cheap (under 15)"* under
    this masthead asserts that the firm considers 15 cheap. Nobody here has
    published that number, and E-8's grounding rule is that a threshold nobody
    at the firm publishes must not ship wearing the firm's name.

    ⭐ SO THE CONTROL SHIPS AND THE OPINION DOES NOT. `allow_custom` is what
    makes that a real control rather than a stub: `FilterPanel` renders
    `["Any", "Custom…"]` and "Custom…" reveals the min/max inputs, so a member
    can screen `current_ratio` between 1.5 and 3 on the day this lands. When
    the owner decides what "low P/E" means at this firm, the presets drop into
    the list beneath the same control and nothing else moves.

    ⭐ `factual` IS THE ONE EXCEPTION, AND IT IS NOT A LOOSENING OF THE RULE.
    E-8 forbids shipping the firm's OPINION unpublished. Some thresholds are not
    opinions — they are DEFINITIONS, true by arithmetic, and they read the same
    to every trader alive:

      dividend_yield > 0  is what "pays a dividend" MEANS
      debt_to_equity == 0 is what "debt-free" MEANS
      beta < 1            is what "less volatile than the market" MEANS

    Nobody has to publish those; disagreeing with one is disagreeing with the
    words. ⛔ THE TEST IS WHETHER A REASONABLE TRADER COULD PICK A DIFFERENT
    NUMBER. For "pays a dividend" there is no other number — the boundary is
    zero or the phrase is false. For "cheap P/E" there are a hundred, which is
    exactly why `pe_ttm` still ships bare and must keep doing so.

    ⚠️ `presets_deferred` STAYS TRUE on these. It means "no editorial threshold
    has been decided", which is still the case; `factual_presets` records which
    labels are exempt so the rails can tell a definition from an opinion instead
    of counting entries. Both are properties of the filter, never a list of keys
    retyped in a test.
    """
    presets = [{"label": "Any"}] + [dict(p) for p in factual]
    key, spec = _range(key, label, category, column, presets, unit)
    spec["presets_deferred"] = True
    spec["factual_presets"] = tuple(p["label"] for p in factual)
    return key, spec


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
          [{"label": "Any"}], options_column="sector"),
    # ⛔ THE OPTION LIST IS READ OFF THE ARTIFACT, never typed. Measured over the
    # universe on 2026-08-09 it is NYSE 1,926 · NASDAQ 1,711 · AMEX 95 · CBOE 5
    # · PNK 1 — and typing those five here would be a second authority over a
    # set the data already owns, wrong the first time FMP renames one or a
    # sixth venue appears. ⚠️ FMP labels NYSE **Arca** as `AMEX` (SPY), which is
    # its canonical short name and consistently applied, but is theirs not ours.
    _enum("exchange", "Exchange", "descriptive", "exchange",
          [{"label": "Any"}], options_column="exchange"),
    # Beta rides here rather than under "technical" because it arrives on FMP's
    # company PROFILE beside sector and exchange, and it describes the
    # instrument's character rather than today's setup. ⚠️ It genuinely ranges
    # (-43.73, 10.00) over this universe — there is no clamp, by design.
    # ⭐ "Less volatile than the market" is the DEFINITION of beta < 1 — the
    # market IS 1.0 by construction, so the boundary is not a number anyone
    # chose. `lt`, not `lte`: a beta of exactly 1.00 moves WITH the market, and
    # a control labelled "less volatile" that returns it is simply wrong.
    _open_range("beta", "Beta", "descriptive", "beta", factual=[
        {"label": "Less volatile than the market", "op": "lt", "max": 1},
    ]),
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
    # ── fundamental ──
    # 🔴 TEN CONTROLS LANDED HERE ON 2026-08-09 AND THEY ARE THE PRODUCT HALF OF
    # A FILL. `53b88b1d` populated eleven columns that had been NULL on all
    # 3,708 rows; every one of them was screenable by the AST/criterion door and
    # by NONE of them through this registry, which is the door the classic
    # screener UI is built out of. Data with no control is a column a member can
    # sort by and never search on.
    #
    # ⭐ THE TEN NEW ONES CARRY NO PRESET THRESHOLDS — see `_open_range`. The
    # ones ABOVE and BELOW them (`pe_fwd`, `peg`, `eps_growth`, `rev_growth`,
    # `op_margin`, `roe`) predate that rule and still carry "Under 20" /
    # "Over 25%"; those numbers have no published source at this firm either
    # and are flagged for the owner rather than quietly deleted, because they
    # are already shipping and removing them is itself a product change.
    #
    # ⚠️ `peg` / `op_margin` / `roe` changed PROVIDER in this same commit
    # (`enrich.ratings_fields` -> `fundamentals_bulk`). The filter keys, columns
    # and units are untouched: the member-facing contract is identical, only
    # the writer behind the column changed.
    # ⛔ Bounded below at zero for the same reason as `peg` below — a NEGATIVE
    # forward P/E means analysts expect a LOSS, and a bare `pe_fwd <= 20`
    # returns exactly those companies first. This sibling was not in the audit
    # sample; the derived rail
    # `test_a_cheap_valuation_preset_cannot_admit_a_negative_ratio` found it the
    # moment the rule existed, which is the argument for deriving the rule from
    # the labels instead of listing the keys that were reported.
    _range("pe_fwd", "Forward P/E", "fundamental", "pe_fwd",
           [{"label": "Any"},
            {"label": "Under 20", "op": "between", "min": 0, "max": 20},
            {"label": "Under 35", "op": "between", "min": 0, "max": 35}]),
    # 🔴 THE PRESETS ARE BOUNDED BELOW AT ZERO, AND THAT IS LOAD-BEARING.
    # PEG is P/E divided by growth, so a loss-making company (negative P/E) with
    # shrinking growth (negative denominator) produces a small POSITIVE PEG, and
    # a bare `peg <= 1` hands the member the most distressed names in the
    # universe under a label that says "cheap growth". Measured 2026-08-23 on a
    # 17-name sample: LCID returned at PEG 0.019 — the lowest in the sample —
    # on a P/E of -0.40 and a -264% net margin; ABVX at 0.346 on a P/E of
    # -21.08; and on an ascending PEG sort BABA at -0.482 SORTS FIRST. Four of
    # seventeen should never have been returned.
    # ⛔ Do not "simplify" these back to `lte`. The floor is the fix.
    _range("peg", "PEG", "fundamental", "peg",
           [{"label": "Any"},
            {"label": "Under 1", "op": "between", "min": 0, "max": 1},
            {"label": "Under 2", "op": "between", "min": 0, "max": 2}]),
    _range("eps_growth", "EPS Growth", "fundamental", "eps_growth",
           [{"label": "Any"}, {"label": "Positive", "op": "gte", "min": 0},
            {"label": "Over 25%", "op": "gte", "min": 25},
            {"label": "Over 50%", "op": "gte", "min": 50}], unit="%"),
    _range("rev_growth", "Revenue Growth", "fundamental", "rev_growth",
           [{"label": "Any"}, {"label": "Positive", "op": "gte", "min": 0},
            {"label": "Over 20%", "op": "gte", "min": 20}], unit="%"),
    # ── finviz parity (Wave 6 parity2): the growth trio ──
    # SIGNED percent, preset-free (E-8): nobody at this firm has published
    # what a "strong" five-year growth rate is, so the member types the
    # number. `eps_next_5y_growth` is an ANALYST ESTIMATE, and its label says
    # so. ⛔ EPS Q/Q / Sales Q/Q ship as NO new controls: `eps_growth` and
    # `rev_growth` directly above ARE those facts (latest quarter vs the
    # year-ago quarter) — see finviz_universe's `_C_IDS` adjudication.
    _open_range("eps_past_5y_growth", "EPS Growth Past 5Y", "fundamental",
                "eps_past_5y_growth", unit="%"),
    _open_range("eps_next_5y_growth", "EPS Growth Next 5Y (est)",
                "fundamental", "eps_next_5y_growth", unit="%"),
    _open_range("sales_past_5y_growth", "Sales Growth Past 5Y", "fundamental",
                "sales_past_5y_growth", unit="%"),
    _range("op_margin", "Operating Margin", "fundamental", "op_margin",
           [{"label": "Any"}, {"label": "Positive", "op": "gte", "min": 0},
            {"label": "Over 20%", "op": "gte", "min": 20}], unit="%"),
    _range("roe", "ROE", "fundamental", "roe",
           [{"label": "Any"}, {"label": "Over 15%", "op": "gte", "min": 15},
            {"label": "Over 25%", "op": "gte", "min": 25}], unit="%"),
    _range("uct_composite", "UCT Composite", "fundamental", "uct_composite",
           [{"label": "Any"}, {"label": "Over 80", "op": "gte", "min": 80},
            {"label": "Over 90", "op": "gte", "min": 90}]),
    # ── the ten filled by `fundamentals_bulk` on 2026-08-09, controls only ──
    _open_range("pe_ttm", "P/E (TTM)", "fundamental", "pe_ttm"),
    _open_range("ps", "P/S", "fundamental", "ps"),
    _open_range("pb", "P/B", "fundamental", "pb"),
    # ⭐ "Pays a dividend" is the DEFINITION of a yield above zero. ⚠️ `gt`, not
    # `gte`: 205 rows hold a corroborated 0.0, and `>= 0` would return every one
    # of them under a label that says they pay one. There is no epsilon to
    # choose here — an epsilon would BE an invented threshold.
    _open_range("dividend_yield", "Dividend Yield", "fundamental",
                "dividend_yield", unit="%", factual=[
                    {"label": "Pays a dividend", "op": "gt", "min": 0},
                ]),
    _open_range("gross_margin", "Gross Margin", "fundamental", "gross_margin",
                unit="%"),
    _open_range("net_margin", "Net Margin", "fundamental", "net_margin",
                unit="%"),
    _open_range("roa", "ROA", "fundamental", "roa", unit="%"),
    # ⚠️ RATIOS, NOT PERCENTS — AAPL's D/E is 0.78, not 78. The registry used to
    # claim otherwise for a column that had never held a value; see the module
    # docstring. A member typing `2` here means twice equity.
    # ⭐ "Debt-free" is the DEFINITION of D/E == 0, corroborated on 238 rows.
    # ⚠️ `eq`, NOT `lte 0`. D/E goes negative on negative equity, and a
    # company with negative equity is the opposite of debt-free — `<= 0` would
    # return exactly the distressed names the label promises to exclude.
    _open_range("debt_to_equity", "Debt / Equity", "fundamental",
                "debt_to_equity", factual=[
                    {"label": "Debt-free", "op": "eq", "value": 0},
                ]),
    # ⚠️ ~163 banks, insurers and BDCs have NO current ratio and are NULL rather
    # than 0 (FMP prints 0 for "undefined"; `fundamentals_bulk` refuses it). So
    # `current_ratio < 1` correctly returns no financials — which is a true
    # answer, and a better one than every financial in America.
    _open_range("current_ratio", "Current Ratio", "fundamental",
                "current_ratio"),
    # ── Wave 2 (fundamental) — bare like the ten above; no editorial presets ──
    _open_range("quick_ratio", "Quick Ratio", "fundamental", "quick_ratio"),
    _open_range("p_fcf", "P/FCF", "fundamental", "p_fcf"),
    _open_range("p_ocf", "P/OCF", "fundamental", "p_ocf"),
    _open_range("payout_ratio", "Payout Ratio", "fundamental", "payout_ratio",
                unit="%"),
    _open_range("roic", "ROIC", "fundamental", "roic", unit="%"),
    _open_range("lt_debt_to_capital", "LT Debt / Capital", "fundamental",
                "lt_debt_to_capital"),
    # ISO dates compare correctly as TEXT in SQLite, so a custom range works
    # server-side today; the old panel's number inputs can't type one — the
    # usable control is ipo_age_days below, and Wave 3's typed controls make
    # this one first-class. It exists because every bulk-written column must
    # carry a control (the registry rail).
    _open_range("ipo_date", "IPO Date", "descriptive", "ipo_date"),
    _open_range("ipo_age_days", "IPO Age (days)", "descriptive",
                "ipo_age_days"),
    _enum("country", "Country", "descriptive", "country",
          [{"label": "Any"}], options_column="country"),
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
           {"label": "Marubozu", "op": "eq", "value": "marubozu"},
           {"label": "Spinning Top", "op": "eq", "value": "spinning-top"}]),
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
    # ── performance (Wave 1 — all bare; return thresholds are the owner's) ──
    _open_range("chg_pct_1d", "Change Today", "performance", "chg_pct_1d", unit="%"),
    _open_range("chg_pct_1w", "Change 1W", "performance", "chg_pct_1w", unit="%"),
    _open_range("chg_pct_1m", "Change 1M", "performance", "chg_pct_1m", unit="%"),
    _open_range("chg_pct_3m", "Change 3M", "performance", "chg_pct_3m", unit="%"),
    _open_range("chg_pct_6m", "Change 6M", "performance", "chg_pct_6m", unit="%"),
    _open_range("chg_pct_1y", "Change 1Y", "performance", "chg_pct_1y", unit="%"),
    _open_range("chg_pct_ytd", "Change YTD", "performance", "chg_pct_ytd", unit="%"),
    _open_range("chg_from_open_pct", "Change from Open", "performance",
                "chg_from_open_pct", unit="%"),
    _open_range("dist_20d_high_pct", "Dist from 20D High", "performance",
                "dist_20d_high_pct", unit="%"),
    _open_range("dist_52w_low_pct", "Dist from 52W Low", "performance",
                "dist_52w_low_pct", unit="%"),
    _open_range("dist_ath_pct", "Dist from All-Time High", "performance",
                "dist_ath_pct", unit="%"),
    _bool("new_ath", "New All-Time High", "performance", "new_ath"),
    # ── momentum mechanics (Wave 1) ──
    # ⭐ preset thresholds below cite their published in-product source: the
    # live 7 AM scanner's gates and scoring rubric
    # (uct-intelligence scripts/scanner_candidates.py — READY>=70/WATCH>=55,
    #  vol_acc 1.1/0.85, close CV 2.5/4.0, avg body 0.30/0.40, N-week
    #  volume-low windows 20/15/10 bars). E-8: published, not invented here.
    _open_range("dollar_vol_30d", "Dollar Volume (30d)", "descriptive",
                "dollar_vol_30d", unit="$"),
    _open_range("pole_pct", "Prior Run (Pole %)", "momentum", "pole_pct", unit="%"),
    _range("vol_nweek_low", "Volume Dry-Up", "momentum", "vol_nweek_low",
           [{"label": "Any"},
            {"label": "4-week volume low", "op": "eq", "value": 20},
            {"label": "3-week low or drier", "op": "gte", "min": 15},
            {"label": "2-week low or drier", "op": "gte", "min": 10}]),
    _range("vol_updown_ratio", "Up/Down Volume", "momentum", "vol_updown_ratio",
           [{"label": "Any"},
            {"label": "Accumulating (>1.1)", "op": "gt", "min": 1.1},
            {"label": "Distributing (<0.85)", "op": "lt", "max": 0.85}], unit="×"),
    _range("close_cv_pct", "Close Tightness (CV)", "momentum", "close_cv_pct",
           [{"label": "Any"},
            {"label": "Clustered (<2.5%)", "op": "lt", "max": 2.5},
            {"label": "Tight band (<4%)", "op": "lt", "max": 4}], unit="%"),
    _range("avg_body_pct_5", "5-Bar Body Tightness", "momentum", "avg_body_pct_5",
           [{"label": "Any"},
            {"label": "Tight flag (<0.30)", "op": "lt", "max": 0.30},
            {"label": "Orderly (<0.40)", "op": "lt", "max": 0.40}]),
    _range("candle_score", "Setup Score", "momentum", "candle_score",
           [{"label": "Any"},
            {"label": "Ready-grade (70+)", "op": "gte", "min": 70},
            {"label": "Watch-grade (55+)", "op": "gte", "min": 55}]),
    _open_range("ema_touch_count", "EMA20 Touches (15 bars)", "momentum",
                "ema_touch_count"),
    _bool("ema20_rising", "EMA20 Rising", "momentum", "ema20_rising"),
    _bool("ema10_rising", "EMA10 Rising", "momentum", "ema10_rising"),
    _bool("ema_stack_intact", "EMA Stack Intact (10>20, rising)", "momentum",
          "ema_stack_intact"),
    _open_range("atr_ext_sma50", "ATR Extension vs 50SMA", "momentum",
                "atr_ext_sma50", unit="ATR"),
    _enum("rs_line_trend", "RS Line vs SPY", "momentum", "rs_line_trend",
          [{"label": "Any"},
           {"label": "Rising", "op": "eq", "value": "up"},
           {"label": "Flat", "op": "eq", "value": "flat"},
           {"label": "Falling", "op": "eq", "value": "down"}]),
    # ── technical: expose the dark columns (registry/UI only) ──
    # ⚠️ NOT bare "ATR %" — that label word-reduces to exactly the FUNCTION
    # name `atr` (the manifest's own indicator call), and the plain-language
    # door's stem index cannot arbitrate a tie between a filter's label and a
    # declared function's name (`tests/test_definition_concierge.py::
    # test_the_stem_index_REFUSES_to_ARBITRATE_a_TIE_and_REPORTS_it`). Worded
    # like the ownership-section's own "Float % of Shares" / "Short % of
    # Float" idiom — a ratio's label names its denominator.
    _open_range("atr_pct", "ATR % of Price", "technical", "atr_pct", unit="%"),
    _open_range("pct_vs_sma20", "SMA20 Distance", "technical", "pct_vs_sma20",
                unit="%"),
    _open_range("adr_pct_1w", "ADR % (5-day)", "technical", "adr_pct_1w",
                unit="%"),
    _range("consecutive_down", "Consecutive Down Days", "multi_candle",
           "consecutive_down",
           [{"label": "Any"}, {"label": "3+", "op": "gte", "min": 3}]),
    _open_range("inst_pct", "Institutional Ownership", "fundamental",
                "inst_pct", unit="%"),
    _open_range("rs_return", "RS Weighted Return", "technical", "rs_return",
                unit="%"),
    # Wave 6: lands WITH the manifest correction that excluded the lying
    # `yields:"num"` scalar (the column holds letter grades A-E). Options
    # derive from the grades the rows actually hold — same dynamic mechanism
    # as sector/exchange, never a typed A-E list.
    _enum("accdis", "Acc/Dis Grade", "fundamental", "accdis",
          [{"label": "Any"}], options_column="accdis"),
    _open_range("body_pct", "Last-Bar Body", "single_candle", "body_pct"),
    _open_range("upper_wick_pct", "Upper Wick", "single_candle",
                "upper_wick_pct"),
    _open_range("lower_wick_pct", "Lower Wick", "single_candle",
                "lower_wick_pct"),
    _open_range("pattern_conf_max", "Pattern Confidence", "pattern",
                "pattern_conf_max"),
    _enum("industry", "Industry", "descriptive", "industry",
          [{"label": "Any"}], options_column="industry"),
    # ── context (Wave 1) ──
    _enum("theme", "UCT Theme", "context", "theme",
          [{"label": "Any"}], options_column="theme"),
    _bool("in_uct20", "In UCT 20", "context", "in_uct20"),
    _bool("index_sp500", "S&P 500", "context", "index_sp500"),
    _bool("index_ndx", "Nasdaq 100", "context", "index_ndx"),
    _bool("index_dow", "Dow 30", "context", "index_dow"),
    _bool("index_r2k", "Russell 2000", "context", "index_r2k"),
    _bool("is_etf", "ETF", "context", "is_etf"),
    _bool("is_leveraged", "Leveraged/Inverse ETF", "context", "is_leveraged"),
    _bool("stage2", "Weinstein Stage 2", "context", "stage2"),
    _bool("stage4", "Weinstein Stage 4", "context", "stage4"),
    _bool("hvc_52w", "High-Volume Close (52W)", "context", "hvc_52w"),
    # ── ownership (Wave 2) ──
    _open_range("shares_outstanding", "Shares Outstanding", "ownership",
                "shares_outstanding"),
    _open_range("float_shares", "Float (Shares)", "ownership", "float_shares"),
    _open_range("float_pct", "Float % of Shares", "ownership", "float_pct",
                unit="%"),
    _open_range("short_float_pct", "Short % of Float", "ownership",
                "short_float_pct", unit="%"),
    _open_range("short_ratio", "Short Ratio (Days to Cover)", "ownership",
                "short_ratio"),
    _open_range("insider_own_pct", "Insider Ownership", "ownership",
                "insider_own_pct", unit="%"),
    _open_range("insider_cluster_days", "Insider Cluster Buy (days ago)",
                "ownership", "insider_cluster_days"),
    # inst_pct's existing filter keeps its key/category; only its writer moved.
    # ── finviz parity (Wave 6 T6) ──
    # The transactions pair is SIGNED percent (net selling is negative) and
    # ships preset-free: nobody at this firm has published what a "heavy"
    # insider-selling percentage is (E-8), so the member types the number.
    _open_range("insider_trans_pct", "Insider Transactions", "ownership",
                "insider_trans_pct", unit="%"),
    _open_range("inst_trans_pct", "Institutional Transactions", "ownership",
                "inst_trans_pct", unit="%"),
    # Optionable/Shortable are Yes/No facts about the instrument (Finviz's own
    # screener files them under Descriptive) — bool controls over the stored
    # 1/0, never a range over a flag. NULL is honest-absence: neither Yes nor
    # No returns a ticker the nightly pull never answered for.
    _bool("optionable", "Optionable", "descriptive", "optionable"),
    _bool("shortable", "Shortable", "descriptive", "shortable"),
    # ── events (Wave 2) ──
    _open_range("next_earnings_date", "Next Earnings Date", "events",
                "next_earnings_date"),
    _open_range("days_to_earnings", "Days to Earnings", "events",
                "days_to_earnings"),
    _enum("earnings_session", "Earnings Session", "events", "earnings_session",
          [{"label": "Any"},
           {"label": "Before the open", "op": "eq", "value": "bmo"},
           {"label": "After the close", "op": "eq", "value": "amc"},
           {"label": "Time TBD", "op": "eq", "value": "tbd"}]),
    _open_range("last_report_move_pct", "Last Report Move", "events",
                "last_report_move_pct", unit="%"),
    _open_range("implied_move_pct", "Implied Move (pre-report)", "events",
                "implied_move_pct", unit="%"),
    _enum("earnings_setup_grade", "Earnings Setup Grade", "events",
          "earnings_setup_grade", [{"label": "Any"}],
          options_column="earnings_setup_grade"),
    _enum("analyst_consensus", "Analyst Consensus", "events",
          "analyst_consensus", [{"label": "Any"}],
          options_column="analyst_consensus"),
    _open_range("pt_target", "Price Target", "events", "pt_target", unit="$"),
    _open_range("pt_upside_pct", "PT Upside", "events", "pt_upside_pct",
                unit="%"),
    _open_range("upgrades_30d", "Upgrades (30d)", "events", "upgrades_30d"),
    _open_range("downgrades_30d", "Downgrades (30d)", "events",
                "downgrades_30d"),
    _open_range("eps_next_y_growth", "EPS Growth Next FY (est)", "events",
                "eps_next_y_growth", unit="%"),
    # ── ratings components (fundamental) ──
    _open_range("blended_growth", "Blended Growth", "fundamental",
                "blended_growth", unit="%"),
    _open_range("sector_rs_pct", "Sector RS", "fundamental", "sector_rs_pct"),
    _open_range("rating_eps", "EPS Rating", "fundamental", "rating_eps"),
    _open_range("rating_growth", "Growth Rating", "fundamental",
                "rating_growth"),
    _open_range("rating_value", "Value Rating", "fundamental", "rating_value"),
    _open_range("rating_smr", "SMR Rating", "fundamental", "rating_smr"),
    _enum("sponsorship", "Sponsorship Grade", "fundamental", "sponsorship",
          [{"label": "Any"}], options_column="sponsorship"),
    # ── Wave 5: pattern engine (pattern) · dark pool + options flow (flow) ──
    # All twelve ship BARE (`_open_range`, "Any" + custom only): nobody at this
    # firm has published a threshold for engine confidence, block notional or
    # premium share, and E-8 says an unpublished threshold must not ship
    # wearing the firm's name. Every control is a range because the closed
    # table declares each column `yields:"num"` — the two-lane rail pairs them
    # the moment Stage B's manifest lands. `pattern_engine_ids` (comma-joined
    # TEXT list) deliberately has NO control here — the `patterns` precedent:
    # a list column is a display surface, not a scalar.
    _open_range("pattern_engine_conf", "Pattern Engine Confidence", "pattern",
                "pattern_engine_conf"),
    # Reader-encoded direction (ruling D4): +1 bullish · -1 bearish · 0 neutral.
    _open_range("pattern_engine_dir", "Pattern Engine Direction", "pattern",
                "pattern_engine_dir"),
    _open_range("pattern_entry_dist_pct", "Pattern Entry Distance", "pattern",
                "pattern_entry_dist_pct", unit="%"),
    _open_range("pattern_stop_dist_pct", "Pattern Stop Distance", "pattern",
                "pattern_stop_dist_pct", unit="%"),
    # SYNTHETIC expectancy (ruling D3): hit rate at an ASSUMED 2R-win/1R-loss,
    # joined regime-blind. The member-facing description (columnDefs.js) says
    # "assumed" in as many words; the rail on that word lives in
    # tests/test_screener_filters.py.
    _open_range("pattern_expectancy_r", "Pattern Expectancy", "pattern",
                "pattern_expectancy_r", unit="R"),
    # dp_*/opt_* join ONE new category (spec §2's fourth family). K5 both
    # halves: the key is used here AND the entry is appended to CATEGORIES
    # below — a filter whose category has no CATEGORIES entry renders in no
    # group and becomes a shipped control nobody can reach.
    _open_range("dp_notional_1d", "Dark Pool Block Notional (1d)", "flow",
                "dp_notional_1d", unit="$"),
    _open_range("dp_prints_1d", "Dark Pool Block Prints (1d)", "flow",
                "dp_prints_1d"),
    _open_range("dp_notional_5d", "Dark Pool Block Notional (5d)", "flow",
                "dp_notional_5d", unit="$"),
    _open_range("dp_level_dist_pct", "Dark Pool Level Distance", "flow",
                "dp_level_dist_pct", unit="%"),
    _open_range("opt_net_premium_1d", "Options Net Premium (1d)", "flow",
                "opt_net_premium_1d", unit="$"),
    # K3: the share is of CLASSIFIED premium only — blank-Side prints are
    # directionless by honesty and sit outside the denominator.
    _open_range("opt_bull_pct_1d", "Options Bullish Premium (1d)", "flow",
                "opt_bull_pct_1d", unit="%"),
    _open_range("opt_net_premium_5d", "Options Net Premium (5d)", "flow",
                "opt_net_premium_5d", unit="$"),
    # ── Wave 6: per-pattern engine flags (pattern) ──
    # ⭐ WHY A BOOL AND NOT A SEVENTH ENTRY ON THE `pattern` ENUM ABOVE. That
    # enum's presets are `contains` over `patterns` — the always-on HEURISTIC
    # column — and its "VCP"/"Flat Base" labels already name that instrument.
    # Adding the engine's answer there would put two authorities under one
    # label; these are separate controls whose labels SAY which engine
    # answered, and the columns beneath them are the engine's.
    #
    # Preset-free in the sense E-8 means: Yes/No over a stored 1/0 is what the
    # flag IS, not a threshold anybody chose (the `optionable`/`shortable`
    # precedent). `_bool` ships no editorial number and there is none to ship.
    #
    # ⚠️ A NULL flag is returned by NEITHER Yes NOR No, by construction — the
    # engine has no active detection for that symbol, and a control that
    # counted it as "No" would answer a question it has no data for.
    _bool("pattern_engine_vcp", "VCP (Pattern Engine)", "pattern",
          "pattern_engine_vcp"),
    _bool("pattern_engine_flat_base", "Flat Base (Pattern Engine)", "pattern",
          "pattern_engine_flat_base"),
])

# ⚠️ `gt`/`lt`/`eq` JOINED "range" FOR THE FACTUAL PRESETS, and the strictness
# is the point in all three cases: `>= 0` returns the 205 zero-yield rows under
# "pays a dividend", `<= 0` returns negative-equity names under "debt-free", and
# `<= 1` returns a beta of exactly 1.00 under "less volatile than the market".
# An inclusive operator here would make each label state something untrue.
_VALID_OPS = {
    "range": {"gte", "lte", "between", "gt", "lt", "eq"},
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
    "performance": {"label": "Performance", "columns": [
        "ticker", "company", "chg_pct_1d", "chg_pct_1w", "chg_pct_1m",
        "chg_pct_3m", "chg_pct_6m", "chg_pct_1y", "chg_pct_ytd",
        "dist_52w_high_pct", "dist_ath_pct"]},
    "momentum": {"label": "Momentum", "columns": [
        "ticker", "company", "candle_score", "pct_vs_ema20", "close_cv_pct",
        "avg_body_pct_5", "pole_pct", "adr_pct", "vol_nweek_low",
        "vol_updown_ratio", "rs_line_trend", "chg_pct_1d"]},
    # ⭐ THE THREE VIEWS BELOW EXIST BECAUSE SOMEBODY OPENED THE SCREEN
    # (2026-08-23). Waves 5-6 shipped three whole data families — the pattern
    # engine, dark-pool/options positioning, and the ownership/short block —
    # each with its own filter category and, measured on prod, NOT ONE of them
    # visible in ANY of the eight views. A member could filter on dark-pool
    # notional and then have no way to SEE it short of hand-picking the column.
    # A filter category with no view behind it is a half-shipped family; these
    # close that. (Nothing rails "every filter category has a view" — the gap
    # was invisible to 400+ green tests and obvious in one screenshot.)
    "patterns": {"label": "Patterns", "columns": [
        "ticker", "company", "pattern_engine_ids", "pattern_engine_conf",
        "pattern_engine_dir", "pattern_expectancy_r", "pattern_entry_dist_pct",
        "pattern_stop_dist_pct", "pattern_engine_vcp",
        "pattern_engine_flat_base", "patterns", "pattern_conf_max",
        "candle_score"]},
    "flow": {"label": "Positioning & Flow", "columns": [
        "ticker", "company", "price", "chg_pct_1d", "dp_notional_1d",
        "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct",
        "opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d"]},
    "ownership": {"label": "Ownership & Short", "columns": [
        "ticker", "company", "shares_outstanding", "float_shares", "float_pct",
        "inst_pct", "inst_trans_pct", "insider_own_pct", "insider_trans_pct",
        "short_float_pct", "short_ratio", "optionable", "shortable"]},
    # …and measuring the gap found three MORE families in the same state —
    # `context`, `events` and `multi_candle` were filterable-but-unviewable
    # since Waves 1-2. Closing all six makes the invariant below TRUE, which is
    # what lets it become a rail instead of a wish.
    "events": {"label": "Events & Analysts", "columns": [
        "ticker", "company", "next_earnings_date", "days_to_earnings",
        "earnings_session", "implied_move_pct", "last_report_move_pct",
        "earnings_setup_grade", "analyst_consensus", "pt_upside_pct",
        "upgrades_30d", "downgrades_30d"]},
    "context": {"label": "Context", "columns": [
        "ticker", "company", "theme", "in_uct20", "index_sp500", "index_ndx",
        "index_r2k", "is_etf", "is_leveraged", "stage2", "stage4",
        "hvc_52w"]},
    "candles": {"label": "Candles", "columns": [
        "ticker", "company", "candle_type", "close_position", "body_pct",
        "upper_wick_pct", "lower_wick_pct", "tight_consolidation", "nr7",
        "inside_bar_run", "higher_lows_run", "pullback_depth_pct",
        "consecutive_up", "consecutive_down"]},
}

CATEGORIES = [
    {"key": "descriptive", "label": "Descriptive"},
    {"key": "fundamental", "label": "Fundamental"},
    {"key": "performance", "label": "Performance"},
    {"key": "technical", "label": "Technical"},
    {"key": "momentum", "label": "Momentum"},
    {"key": "single_candle", "label": "Single Candle"},
    {"key": "multi_candle", "label": "Multi-Candle"},
    {"key": "pattern", "label": "Patterns"},
    {"key": "ownership", "label": "Ownership & Insiders"},
    {"key": "events", "label": "Events & Analysts"},
    {"key": "context", "label": "Context"},
    # Wave 5's fourth family (spec §2): dark-pool block aggregates + the
    # flow-worker's options-premium aggregate. APPENDED so every existing
    # category keeps its position; `pattern_engine_*` joined the existing
    # "pattern" category instead of minting a second pattern group (K5).
    {"key": "flow", "label": "Positioning & Flow"},
]


def column_for(key):
    f = FILTERS.get(key)
    return f["column"] if f else None


def is_valid_op(key, op):
    f = FILTERS.get(key)
    if not f:
        return False
    return op in _VALID_OPS.get(f["type"], set())


def _distinct_options(column):
    """``[{Any}, {label/op/value} …]`` from the DISTINCT values a column holds.

    ⛔ THE COLUMN NAME COMES FROM THE FILTER DEFINITION, and it is validated
    against the schema before it reaches the SQL — the registry is the only
    thing that may name a column, never the client.

    ⚰️ THIS WAS `_sector_options()`, and `meta()` chose it with
    `if key == "sector"`. That is a second authority over which filters have
    dynamic options: the fact lived in `meta()`'s body rather than in the
    filter, so `exchange` — an enum over an artifact column, needing exactly
    the same treatment — would have silently rendered a bare "Any" and looked
    like a shipped control that matches nothing. The marker now rides on the
    filter, where the rest of that filter's truth already lives.
    """
    from api.services.screener import snapshot_db
    if column not in snapshot_db.COLUMNS:
        return [{"label": "Any"}]
    try:
        with snapshot_db.connect() as conn:
            rows = conn.execute(
                f'SELECT DISTINCT "{column}" AS v FROM screener_rows '
                f'WHERE "{column}" IS NOT NULL AND "{column}" != \'\' '
                f'ORDER BY "{column}"').fetchall()
        return [{"label": "Any"}] + \
            [{"label": r["v"], "op": "eq", "value": r["v"]} for r in rows]
    except Exception:
        return [{"label": "Any"}]


def _my_scans_entry(user_id):
    """The per-user category content, or None (absence is honest: no
    scannable definitions == no category, never an empty shell).

    Gated by scan_definition.assert_scannable so a plain indicator (a
    non-boolean tree the sweep refuses nightly) NEVER appears — listed
    unscannable, it would read "first sweep tonight" forever. The stored
    ast_hash IS the def_hash (no re-hash); coverage is ONE batched read
    (meta() runs per request on the shared loop — no N+1).

    Lazy imports keep filters.py's module-load import graph clean of user
    stores; the tests monkeypatch those modules' attrs directly, which works
    through a lazy import because Python caches the module object.
    """
    from api.services import user_definitions as ud
    from api.services import scan_definition
    from api.services.screener import scan_store
    try:
        rows = ud.list_for_user(user_id) or []
    except Exception:
        return None
    scannable = []
    for row in rows:
        definition = row.get("definition") or {}
        try:
            scan_definition.assert_scannable(definition)
        except Exception:
            continue
        name = str(((definition.get("meta") or {}).get("name"))
                   or row.get("def_id") or "Untitled scan")
        scannable.append((str(row.get("ast_hash")), name))
    if not scannable:
        return None
    # FilterControl re-finds presets by LABEL — duplicates must diverge.
    # EVERY member of a duplicated name gets the short-hash suffix (suffixing
    # only the second would leave the first ambiguous in the select).
    counts = {}
    for _, name in scannable:
        counts[name] = counts.get(name, 0) + 1
    labeled = [(h, f"{name} · {h[7:13]}" if counts[name] > 1 else name)
               for h, name in scannable]
    try:
        latest = scan_store.latest_coverage_for(
            [h for h, _ in labeled], scan_store.SCAN_JOIN_TF)
    except Exception:
        # Same honest-absence contract as the definitions read above: an
        # unreadable coverage store must cost the member ONE category, never
        # the whole meta payload — and rendering "first sweep tonight" off a
        # failed read would claim a fact we do not hold.
        return None
    return {
        "key": "scan", "label": "My Scans", "category": "my_scans",
        "type": "enum", "allow_custom": False, "unit": None,
        "presets": [{"label": "Any"}] + [
            {"label": name, "op": "in", "value": h} for h, name in labeled],
        "scans": [{"def_hash": h, "name": name, "latest": latest.get(h)}
                  for h, name in labeled],
    }


def meta(user_id=None) -> dict:
    """The whole panel payload.

    ⭐ `distribution` RIDES BESIDE EACH RANGE CONTROL, AND IS NOT A PRESET.
    Most of these controls ship with no presets and must keep doing so (E-8: a
    threshold nobody at the firm publishes must not ship wearing the firm's
    name) — the share is measured off `FILTERS`, never typed here; see
    `distribution.py`'s module docstring for the one-line recipe and its rail.
    What a bare box could never tell a member is *what the data looks
    like*, and that is a measurement, not an opinion — so each range control
    carries the universe's p5/p25/p50/p75/p95 for its column, WITH the coverage
    that produced them, refused outright below a stated floor.

    ⛔ `presets_deferred` STAYS TRUE and `presets` are UNTOUCHED by this. See
    `api/services/screener/distribution.py`'s module docstring for why a band is
    structurally incapable of being rendered as a preset (it carries none of the
    five keys a preset carries), and `tests/test_screener_filters.py::
    test_a_measured_band_is_not_an_editorial_preset` for the rail.

    ⚠️ Only `type == "range"` controls get one, and only over a column the live
    table declares INTEGER/REAL. `ipo_date` and `next_earnings_date` are range
    controls over TEXT columns — a "typical range" of an earnings date is not a
    thing — and they are excluded by that gate rather than by name. Those two
    are the ONLY range controls that carry no `distribution` key at all:
    everything else gets one, and a column this pod's table has not been ALTERed
    to hold yet arrives REFUSED as `column_absent` rather than dropping out of
    the payload, where "not migrated" and "not applicable" look identical.

    ⛔⛔ AND NO COUNT OF ANY OF THAT HERE. How many range controls exist, how
    many carry an entry and how many emit numbers is a measurement of tonight's
    snapshot. A copy of it lived in this docstring and another in
    `distribution.MIN_COVERAGE`'s comment — two hand-typed authorities over one
    value, which is this repo's most repeated defect and which duly went stale
    in the commit that moved one of them. The recipe for taking the measurement
    is beside `MIN_COVERAGE`; read it there and run it.
    """
    from api.services.screener import distribution  # noqa: PLC0415 — lazy, as above

    dist = distribution.distributions()
    bands = dist.get("columns") or {}
    out_filters = []
    for key, f in FILTERS.items():
        presets = (_distinct_options(f["options_column"])
                   if f.get("options_column") else f["presets"])
        entry = {"key": key, "label": f["label"],
                 "category": f["category"], "type": f["type"],
                 "presets": presets, "allow_custom": f["allow_custom"],
                 "unit": f["unit"]}
        if f["type"] == "range":
            band = bands.get(f["column"])
            if band is not None:
                entry["distribution"] = band
        out_filters.append(entry)
    categories = CATEGORIES
    if user_id is not None:
        entry = _my_scans_entry(user_id)
        if entry is not None:
            out_filters.append(entry)
            categories = CATEGORIES + [{"key": "my_scans", "label": "My Scans"}]
    return {"filters": out_filters,
            "views": [{"key": k, **v} for k, v in VIEWS.items()],
            "categories": categories,
            # The floors, the wording and the vintage the bands were measured
            # on — stated ONCE, beside them, so no surface has to guess at any
            # of the three. `None` when the snapshot could not be read.
            "distribution_basis": dist.get("basis")}
