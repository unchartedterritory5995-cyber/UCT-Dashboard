"""THE canonical registry for historical fundamentals (V1).

ONE ENTRY = ONE METRIC IDENTITY = ONE DEFINITION. The same id is what the
chart source names (`fund:<metric>`), what the series API serves, and what a
future formula / condition / alert will reference. Existing persisted ids are
NOT renamed: `screener` / `panel` record where today's SNAPSHOT of the same
concept lives (Screener column; Company Panel key), and `*_definition_differs`
says when that snapshot is computed differently (provider TTM vs SEC TTM, ending
vs average assets), so the two are never presented as one number.

CAPABILITY GATE: an entry is chartable historically only if its `source` is a
point-in-time source and `status == 'READY'`. Snapshot-only metrics live in
DEFERRED with the reason; `assert_catalogue_truthful()` fails if one ever
appears as historical.

PRICE-COMPOSED metrics (Market Cap, P/E, P/S, P/B, FCF Yield) are NOT stored:
the chart composes them per bar from its OWN split-adjusted close and the
as-of value of their `inputs` (fixed named composers -- not a formula language).
Every input is a READY SEC series; a security whose split ledger fails
verification has those inputs withheld, so the composed metric is withheld too.

Coverage = share of UCT's screener universe (3,665 tickers; 3,094 US-GAAP
filers) with a CURRENT value (period >= 2025-06), measured 2026-09-22.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

PIT_SOURCES = frozenset({"sec_xbrl", "uct_bars", "sec_xbrl+uct_bars"})
CATEGORIES = ("Financials", "Growth", "Profitability", "Valuation", "Financial Health",
              "Shares & Dividends", "Market")


@dataclass(frozen=True)
class MetricDef:
    id: str                          # canonical identity (never renamed once served)
    name: str                        # member-facing label
    category: str
    source: str                      # sec_xbrl | uct_bars | sec_xbrl+uct_bars
    unit: str                        # usd | usd_per_share | percent | ratio | shares
    fmt: str                         # compact_usd | usd2 | pct1 | x2 | num2 | compact
    presentation: str                # step | line
    cadence: str                     # quarterly | daily
    methodology: str
    coverage: float | None
    series: str | None = None        # stored series id (None when composed)
    compose: str | None = None       # named price composer (market_cap, pe, ps, pb, fcf_yield)
    inputs: tuple[str, ...] = ()     # stored series the composer reads
    subtitle: str = ""               # one-line method shown next to the label
    aliases: tuple[str, ...] = ()    # search synonyms
    provenance: str = "reported"     # reported | derived | mixed (per point: series_point.method)
    requires: tuple[str, ...] = ()   # 'split_ledger' -> withheld unless the ledger verifies
    screener: str | None = None
    screener_definition_differs: bool = False
    panel: str | None = None
    panel_definition_differs: bool = False
    status: str = "READY"
    formula_eligible: bool = False   # V1: chart-only; formulas/conditions/alerts later
    history_since: str = "2009 (XBRL); per company from its first XBRL filing"
    limitations: str = ""
    history: dict = field(default_factory=lambda: {"point_in_time": True})


_Q, _D = "quarterly", "daily"
TTM = ("TTM = the reported fiscal-year value at year-end; otherwise FY(prev) + YTD(current) "
       "- YTD(prior-year comparative), all as disclosed at the time.")
WHEN = ("Each value takes effect when its filing became public (acceptance time, or 06:00 ET the "
        "next business day for filings accepted after 17:30 ET) and holds until the next filing.")

V1: tuple[MetricDef, ...] = (
    # ── Financials ────────────────────────────────────────────────────────
    MetricDef("revenue_ttm", "Revenue (TTM)", "Financials", "sec_xbrl", "usd", "compact_usd", "step", _Q,
              f"Total revenue, trailing twelve months. {TTM} {WHEN}", 0.824, series="revenue_ttm",
              aliases=("sales", "revenue", "top line", "turnover"), provenance="mixed"),
    MetricDef("revenue_q", "Revenue (Quarterly)", "Financials", "sec_xbrl", "usd", "compact_usd", "step", _Q,
              f"Standalone fiscal-quarter revenue; Q4 = full year minus nine months. {WHEN}", 0.794,
              series="revenue_q", aliases=("sales", "quarterly revenue"), provenance="mixed"),
    MetricDef("net_income_ttm", "Net Income (TTM)", "Financials", "sec_xbrl", "usd", "compact_usd", "step", _Q,
              f"Net income attributable to the parent, trailing twelve months. {TTM} {WHEN}", 0.942,
              series="net_income_ttm", aliases=("earnings", "profit", "net profit", "bottom line"), provenance="mixed"),
    MetricDef("net_income_q", "Net Income (Quarterly)", "Financials", "sec_xbrl", "usd", "compact_usd", "step", _Q,
              f"Standalone fiscal-quarter net income; Q4 = full year minus nine months. {WHEN}", 0.922,
              series="net_income_q", aliases=("earnings", "quarterly profit"), provenance="mixed"),
    MetricDef("eps_ttm", "EPS (TTM)", "Financials", "sec_xbrl", "usd_per_share", "usd2", "step", _Q,
              f"GAAP diluted earnings per share, trailing twelve months, on today's share basis "
              f"(split-adjusted like the price chart). {TTM} {WHEN}", 0.870,
              series="eps_diluted_ttm", subtitle="Diluted · GAAP",
              aliases=("earnings per share", "eps", "diluted eps", "earnings"), provenance="mixed",
              requires=("split_ledger",), screener="eps_ttm", screener_definition_differs=True,
              limitations="Between fiscal year-ends the year-to-date roll can differ by $0.01-0.02 from a sum "
                          "of four separately reported quarters."),
    MetricDef("eps_q", "EPS (Quarterly)", "Financials", "sec_xbrl", "usd_per_share", "usd2", "step", _Q,
              "GAAP diluted EPS per fiscal quarter on today's share basis. Q1-Q3 as reported; Q4 = full-year "
              "EPS minus nine-month EPS (each point records REPORTED or DERIVED).", 0.854,
              series="eps_diluted_q", subtitle="Diluted · GAAP",
              aliases=("earnings per share", "quarterly eps", "earnings"), provenance="mixed",
              requires=("split_ledger",),
              limitations="EPS is not additive across periods: a derived Q4 can differ from the separately "
                          "reported Q4 by $0.01 (AAPL Q4 FY25 1.84 vs 1.85)."),
    MetricDef("operating_cash_flow_ttm", "Operating Cash Flow (TTM)", "Financials", "sec_xbrl", "usd",
              "compact_usd", "step", _Q, f"Net cash from operating activities, trailing twelve months. {TTM}",
              0.928, series="operating_cash_flow_ttm", aliases=("cash flow", "ocf", "cash from operations"),
              provenance="mixed"),
    MetricDef("fcf_ttm", "Free Cash Flow (TTM)", "Financials", "sec_xbrl", "usd", "compact_usd", "step", _Q,
              "Operating cash flow minus payments for property and equipment, per identical quarter, trailing "
              "twelve months.", 0.745, series="fcf_ttm", aliases=("fcf", "free cash flow", "cash flow"),
              provenance="derived",
              limitations="Unavailable where capex is tagged with a company-specific concept."),
    # ── Growth ────────────────────────────────────────────────────────────
    MetricDef("revenue_growth_ttm", "Revenue Growth (TTM)", "Growth", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Revenue TTM versus revenue TTM one fiscal year earlier, both as known at the time. Blank when "
              "the base is zero or negative.", 0.807, series="revenue_growth_ttm", subtitle="Year over year",
              aliases=("sales growth", "revenue growth", "top line growth"), provenance="derived",
              screener="rev_growth", screener_definition_differs=True,
              panel="revenue_growth_pct", panel_definition_differs=True),
    MetricDef("revenue_growth_q", "Revenue Growth (Quarterly)", "Growth", "sec_xbrl", "percent", "pct1", "step",
              _Q, "Quarterly revenue versus the same fiscal quarter a year earlier.", 0.784,
              series="revenue_growth_yoy_q", subtitle="Year over year", aliases=("sales growth", "quarterly growth"),
              provenance="derived"),
    MetricDef("eps_growth_ttm", "EPS Growth (TTM)", "Growth", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Diluted EPS TTM versus a year earlier, on one share basis. Blank when the base EPS is zero or "
              "negative.", 0.662, series="eps_growth_ttm", subtitle="Year over year",
              aliases=("earnings growth", "eps growth"), provenance="derived", requires=("split_ledger",),
              screener="eps_growth", screener_definition_differs=True,
              panel="earnings_growth_pct", panel_definition_differs=True),
    MetricDef("eps_growth_q", "EPS Growth (Quarterly)", "Growth", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Quarterly diluted EPS versus the same quarter a year earlier. Blank when the base is zero or "
              "negative.", 0.703, series="eps_growth_yoy_q", subtitle="Year over year",
              aliases=("earnings growth", "quarterly eps growth"), provenance="derived", requires=("split_ledger",)),
    # ── Profitability ─────────────────────────────────────────────────────
    MetricDef("gross_margin", "Gross Margin", "Profitability", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Gross profit TTM / revenue TTM over the same four quarters.", 0.368, series="gross_margin_ttm",
              subtitle="TTM", aliases=("gross margin", "gm"), provenance="derived",
              screener="gross_margin", panel="gross_margin_pct", panel_definition_differs=True,
              limitations="Only issuers that report gross profit; never synthesised from cost lines."),
    MetricDef("operating_margin", "Operating Margin", "Profitability", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Operating income TTM / revenue TTM.", 0.676, series="operating_margin_ttm", subtitle="TTM",
              aliases=("operating margin", "op margin", "ebit margin"), provenance="derived",
              screener="op_margin", panel="operating_margin_pct", panel_definition_differs=True,
              limitations="Banks report no operating income."),
    MetricDef("net_margin", "Net Margin", "Profitability", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Net income TTM / revenue TTM over the same four quarters.", 0.815, series="net_margin_ttm",
              subtitle="TTM", aliases=("net margin", "profit margin"), provenance="derived",
              screener="net_margin", panel="profit_margin_pct", panel_definition_differs=True),
    MetricDef("fcf_margin", "FCF Margin", "Profitability", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Free cash flow TTM / revenue TTM.", 0.679, series="fcf_margin_ttm", subtitle="TTM",
              aliases=("free cash flow margin",), provenance="derived"),
    MetricDef("roe", "Return on Equity", "Profitability", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Net income TTM / average of parent equity at the period end and one year earlier.", 0.929,
              series="roe_ttm", subtitle="TTM", aliases=("roe", "return on equity"), provenance="derived",
              screener="roe", panel="roe_pct", panel_definition_differs=True),
    MetricDef("roa", "Return on Assets", "Profitability", "sec_xbrl", "percent", "pct1", "step", _Q,
              "Net income TTM / average of total assets at the period end and one year earlier.", 0.936,
              series="roa_ttm", subtitle="TTM", aliases=("roa", "return on assets"), provenance="derived",
              screener="roa", screener_definition_differs=True, panel="roa_pct", panel_definition_differs=True),
    # ── Financial Health ──────────────────────────────────────────────────
    MetricDef("cash", "Cash & Equivalents", "Financial Health", "sec_xbrl", "usd", "compact_usd", "step", _Q,
              "Cash and cash equivalents at the period end.", 0.949, series="cash", aliases=("cash",)),
    MetricDef("total_assets", "Total Assets", "Financial Health", "sec_xbrl", "usd", "compact_usd", "step", _Q,
              "Total assets at the period end.", 0.961, series="assets", aliases=("assets",)),
    MetricDef("total_liabilities", "Total Liabilities", "Financial Health", "sec_xbrl", "usd", "compact_usd",
              "step", _Q, "Total liabilities at the period end (only where the issuer reports the total).",
              0.826, series="liabilities", aliases=("liabilities",)),
    MetricDef("shareholders_equity", "Shareholders' Equity", "Financial Health", "sec_xbrl", "usd",
              "compact_usd", "step", _Q, "Stockholders' equity attributable to the parent at the period end.",
              0.950, series="equity", aliases=("equity", "book value", "stockholders equity")),
    # ── Shares & Dividends ────────────────────────────────────────────────
    MetricDef("shares_outstanding", "Shares Outstanding", "Shares & Dividends", "sec_xbrl", "shares", "compact",
              "step", _Q, "Cover-page common shares outstanding as of its stated date, on today's share basis.",
              0.820, series="shares_outstanding", aliases=("shares", "share count", "float"),
              requires=("split_ledger",), panel="shares_outstanding", panel_definition_differs=True,
              limitations="Multi-class issuers report per-class counts only; unavailable for them."),
    # ── Valuation (composed per bar) ──────────────────────────────────────
    MetricDef("market_cap", "Market Cap", "Valuation", "sec_xbrl+uct_bars", "usd", "compact_usd", "line", _D,
              "Close x shares outstanding known at that close -- never today's share count.", 0.820,
              compose="market_cap", inputs=("shares_outstanding",), aliases=("market cap", "mkt cap", "size"),
              provenance="derived", requires=("split_ledger",), screener="market_cap",
              screener_definition_differs=True, panel="market_cap", panel_definition_differs=True),
    MetricDef("pe_ttm", "P/E (TTM)", "Valuation", "sec_xbrl+uct_bars", "ratio", "x2", "line", _D,
              "Close / diluted EPS TTM known at that close. Blank when EPS is zero or negative.", 0.870,
              compose="pe", inputs=("eps_diluted_ttm",), subtitle="Trailing",
              aliases=("pe", "p/e", "price to earnings", "trailing pe"), provenance="derived",
              requires=("split_ledger",), screener="pe_ttm", screener_definition_differs=True,
              panel="pe_trailing", panel_definition_differs=True),
    MetricDef("ps_ttm", "Price / Sales", "Valuation", "sec_xbrl+uct_bars", "ratio", "x2", "line", _D,
              "Market cap / revenue TTM known at that close. Blank when revenue is zero or negative.", 0.80,
              compose="ps", inputs=("shares_outstanding", "revenue_ttm"), subtitle="TTM",
              aliases=("ps", "p/s", "price to sales"), provenance="derived", requires=("split_ledger",),
              screener="ps", screener_definition_differs=True),
    MetricDef("pb", "Price / Book", "Valuation", "sec_xbrl+uct_bars", "ratio", "x2", "line", _D,
              "Market cap / shareholders' equity known at that close. Blank when equity is zero or negative.",
              0.80, compose="pb", inputs=("shares_outstanding", "equity"),
              aliases=("pb", "p/b", "price to book"), provenance="derived", requires=("split_ledger",),
              screener="pb", screener_definition_differs=True),
    MetricDef("fcf_yield", "FCF Yield", "Valuation", "sec_xbrl+uct_bars", "percent", "pct1", "line", _D,
              "Free cash flow TTM / market cap at that close.", 0.70, compose="fcf_yield",
              inputs=("shares_outstanding", "fcf_ttm"), subtitle="TTM",
              aliases=("free cash flow yield",), provenance="derived", requires=("split_ledger",),
              screener="fcf_yield", screener_definition_differs=True),
    # ── Market ────────────────────────────────────────────────────────────
    MetricDef("beta_1y_spy", "Beta", "Market", "uct_bars", "ratio", "num2", "line", _D,
              "OLS slope of 252 aligned daily price returns against SPY (at least 200), split-adjusted, not "
              "dividend-adjusted, recomputed each session from closes at or before it. Not necessarily equal "
              "to vendor betas (Yahoo uses 5Y monthly).", None, series="beta_1y_spy",
              subtitle="1Y daily · Benchmark: SPY", aliases=("beta", "volatility vs market", "market beta"),
              provenance="derived", screener="beta", screener_definition_differs=True,
              panel="beta", panel_definition_differs=True,
              history_since="the symbol's first 252 sessions of UCT daily bars"),
)

# Measured, and deliberately NOT historical. Each says why.
DEFERRED: dict[str, str] = {
    "forward_pe": "BLOCKED: needs point-in-time consensus estimates; only today's exist. Snapshot capture "
                  "framework is built but its sources are not cleared for retention (snapshot_archive.py).",
    "peg": "BLOCKED: depends on forward growth estimates (no history).",
    "eps_next_5y": "BLOCKED: analyst estimate, snapshot only.",
    "analyst_targets": "BLOCKED: snapshot only.",
    "inst_ownership": "DEFERRED: 13F history by filing date is a separate ingestion.",
    "insider_ownership": "DEFERRED: Forms 3/4/5 by filing date is a separate ingestion.",
    "enterprise_value": "AMBIGUOUS: total debt has no consistent tag across issuers.",
    "debt_to_equity": "AMBIGUOUS: same debt-definition problem.",
    "total_debt": "AMBIGUOUS: LongTermDebt includes the current portion for some issuers, not others.",
    "dividends_per_share": "DEFERRED (V1.1): declared vs paid tags differ in timing.",
    "dividend_yield": "DEFERRED (V1.1): after DPS.",
    "current_ratio": "DEFERRED (V1.1): AssetsCurrent / LiabilitiesCurrent not yet validated.",
    "eps_growth_5y": "DEFERRED (V1.1): needs five years of one consistent series.",
    "ifrs_filers": "NOT SUPPORTED in V1: 227 UCT tickers file IFRS (20-F/40-F); the concept map is US-GAAP.",
}

COMPOSERS = frozenset({"market_cap", "pe", "ps", "pb", "fcf_yield"})


def by_id() -> dict[str, MetricDef]:
    return {m.id: m for m in V1}


def stored_series_ids() -> set[str]:
    """Every stored series the API may be asked for (direct + composer inputs)."""
    return {m.series for m in V1 if m.series} | {i for m in V1 for i in m.inputs}


def payload() -> dict:
    """The catalogue as served to the client (member Fundamentals library)."""
    return {"version": 1, "categories": list(CATEGORIES),
            "metrics": [{k: v for k, v in asdict(m).items() if k not in ("history",)}
                        for m in V1 if m.status == "READY"],
            "deferred_count": len(DEFERRED)}


def assert_catalogue_truthful() -> None:
    from .metrics import METRICS
    ids = [m.id for m in V1]
    assert len(ids) == len(set(ids)), "duplicate metric id"
    for m in V1:
        assert m.category in CATEGORIES, f"{m.id}: unknown category"
        assert m.source in PIT_SOURCES, f"{m.id}: not a point-in-time source"
        assert m.history.get("point_in_time") is True, f"{m.id}: not point-in-time"
        assert m.id not in DEFERRED, f"{m.id} is both chartable and deferred"
        assert m.presentation in ("step", "line")
        assert (m.presentation == "step") == (m.cadence == "quarterly"), f"{m.id}: step iff quarterly"
        assert bool(m.series) != bool(m.compose), f"{m.id}: exactly one of series / compose"
        if m.compose:
            assert m.compose in COMPOSERS and m.inputs, f"{m.id}: unknown composer"
            assert all(i in METRICS for i in m.inputs), f"{m.id}: composer input not a stored series"
            assert "split_ledger" in m.requires, f"{m.id}: price composition needs the verified split ledger"
        elif m.source == "sec_xbrl":
            assert m.series in METRICS, f"{m.id}: series {m.series} is not derived"
