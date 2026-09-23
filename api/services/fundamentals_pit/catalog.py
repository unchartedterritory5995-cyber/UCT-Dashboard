"""The V1 historical-fundamentals catalogue: what may be charted, and how.

ONE ENTRY = ONE DEFINITION. `id` is the canonical metric identity; where the
Screener already has a column for the SAME definition, `screener` names it so
the two lanes can be joined (and a rail can compare today's value across them).
`screener_definition_differs` is set when the Screener's provider value is the
same CONCEPT computed differently -- those two are never presented as one
number.

CAPABILITY GATE: an entry is chartable historically only if
`history.point_in_time` is True AND its `source` is a point-in-time source
('sec_xbrl' or 'uct_bars'). A snapshot-only metric (Forward P/E, PEG, analyst
estimates, ownership) is NOT in this catalogue as historical -- see DEFERRED --
and `assert_catalogue_truthful()` fails if one ever is.

Coverage = share of UCT's screener universe (3,665 tickers; 3,094 US-GAAP
filers built) with a CURRENT value (period >= 2025-06), measured 2026-09-22
over the SEC bulk archives.
"""
from __future__ import annotations

from dataclasses import dataclass, field

PIT_SOURCES = frozenset({"sec_xbrl", "uct_bars", "sec_xbrl+uct_bars"})


@dataclass(frozen=True)
class MetricDef:
    id: str
    name: str                        # member-facing
    category: str                    # Financials | Growth | Profitability | Valuation | Financial Health | Shares | Market
    source: str                      # sec_xbrl | uct_bars | sec_xbrl+uct_bars
    series: str                      # series.py / price_derived.py / beta.py metric id
    unit: str                        # usd | usd_per_share | ratio | percent | shares
    fmt: str                         # compact_usd | usd2 | pct1 | x2 | compact
    presentation: str                # step | line
    cadence: str                     # quarterly | daily
    methodology: str
    coverage: float | None           # measured, see module doc
    requires: tuple[str, ...] = ()   # production dependencies beyond SEC facts
    screener: str | None = None
    screener_definition_differs: bool = False
    history: dict = field(default_factory=lambda: {"point_in_time": True, "since": "2009 (XBRL)"})
    limitations: str = ""


_Q = "quarterly"
TTM_NOTE = ("TTM = the reported fiscal-year value at fiscal year-end; otherwise FY(prev) + "
            "YTD(current) - YTD(prior-year comparative), all as disclosed at the time.")
EFFECT = "Effective when the filing became public (acceptance, or 06:00 ET next business day if accepted after 17:30)."

V1: tuple[MetricDef, ...] = (
    # ── Financials ────────────────────────────────────────────────────────
    MetricDef("revenue_ttm", "Revenue (TTM)", "Financials", "sec_xbrl", "revenue_ttm", "usd", "compact_usd", "step", _Q,
              f"Total revenue, trailing twelve months. {TTM_NOTE} {EFFECT}", 0.824),
    MetricDef("revenue_q", "Revenue (Quarterly)", "Financials", "sec_xbrl", "revenue_q", "usd", "compact_usd", "step", _Q,
              f"Standalone fiscal-quarter revenue; Q4 = FY - 9M from the same tag and fiscal year. {EFFECT}", 0.794),
    MetricDef("net_income_ttm", "Net Income (TTM)", "Financials", "sec_xbrl", "net_income_ttm", "usd", "compact_usd", "step", _Q,
              f"Net income attributable to the parent, TTM. {TTM_NOTE} {EFFECT}", 0.942),
    MetricDef("net_income_q", "Net Income (Quarterly)", "Financials", "sec_xbrl", "net_income_q", "usd", "compact_usd", "step", _Q,
              f"Standalone fiscal-quarter net income; Q4 = FY - 9M. {EFFECT}", 0.922),
    MetricDef("eps_ttm", "EPS (TTM, Diluted)", "Financials", "sec_xbrl", "eps_diluted_ttm", "usd_per_share", "usd2", "step", _Q,
              f"GAAP diluted EPS, TTM, on today's share basis (split-adjusted like the price chart). {TTM_NOTE}", 0.870,
              requires=("split_ledger",), screener="eps_ttm", screener_definition_differs=True,
              limitations="Between fiscal year-ends the YTD roll can differ by $0.01-0.02 from a sum of four reported quarters."),
    MetricDef("eps_q", "EPS (Quarterly, Diluted)", "Financials", "sec_xbrl", "eps_diluted_q", "usd_per_share", "usd2", "step", _Q,
              "GAAP diluted EPS per fiscal quarter, today's share basis. Q4 = FY EPS - 9M EPS.", 0.854,
              requires=("split_ledger",),
              limitations="Derived Q4 EPS can differ from the reported Q4 figure by $0.01 (AAPL Q4 FY25: 1.84 vs 1.85; "
                          "JPM Q4 2025: 4.64 vs 4.63) -- EPS does not add across periods."),
    MetricDef("operating_cash_flow_ttm", "Operating Cash Flow (TTM)", "Financials", "sec_xbrl", "operating_cash_flow_ttm", "usd",
              "compact_usd", "step", _Q, f"Net cash from operating activities, TTM. {TTM_NOTE}", 0.928),
    MetricDef("fcf_ttm", "Free Cash Flow (TTM)", "Financials", "sec_xbrl", "fcf_ttm", "usd", "compact_usd", "step", _Q,
              "Operating cash flow - payments for PP&E, per identical quarter, TTM.", 0.745,
              limitations="Unavailable where capex is tagged with a company extension (NVDA FY2013-FY2023)."),
    # ── Growth ────────────────────────────────────────────────────────────
    MetricDef("revenue_growth_ttm", "Revenue Growth (TTM YoY)", "Growth", "sec_xbrl", "revenue_growth_ttm", "percent", "pct1", "step", _Q,
              "Revenue TTM vs Revenue TTM one fiscal year earlier, both as known at the time. Blank if the base <= 0.", 0.807,
              screener="rev_growth", screener_definition_differs=True),
    MetricDef("revenue_growth_q", "Revenue Growth (Quarterly YoY)", "Growth", "sec_xbrl", "revenue_growth_yoy_q", "percent", "pct1",
              "step", _Q, "Quarter vs the same fiscal quarter a year earlier.", 0.784),
    MetricDef("eps_growth_ttm", "EPS Growth (TTM YoY)", "Growth", "sec_xbrl", "eps_growth_ttm", "percent", "pct1", "step", _Q,
              "Diluted EPS TTM vs a year earlier, both on today's share basis. Blank when the base EPS <= 0.", 0.662,
              requires=("split_ledger",), screener="eps_growth", screener_definition_differs=True),
    MetricDef("eps_growth_q", "EPS Growth (Quarterly YoY)", "Growth", "sec_xbrl", "eps_growth_yoy_q", "percent", "pct1", "step", _Q,
              "Quarterly diluted EPS vs the same quarter a year earlier. Blank when the base <= 0.", 0.703,
              requires=("split_ledger",)),
    # ── Profitability ─────────────────────────────────────────────────────
    MetricDef("gross_margin", "Gross Margin (TTM)", "Profitability", "sec_xbrl", "gross_margin_ttm", "percent", "pct1", "step", _Q,
              "Gross profit TTM / revenue TTM over the same four quarters.", 0.368, screener="gross_margin",
              limitations="Only issuers that report gross profit; it is never synthesised from cost lines."),
    MetricDef("operating_margin", "Operating Margin (TTM)", "Profitability", "sec_xbrl", "operating_margin_ttm", "percent", "pct1",
              "step", _Q, "Operating income TTM / revenue TTM.", 0.676, screener="op_margin",
              limitations="Banks report no operating income."),
    MetricDef("net_margin", "Net Margin (TTM)", "Profitability", "sec_xbrl", "net_margin_ttm", "percent", "pct1", "step", _Q,
              "Net income TTM / revenue TTM over the same four quarters.", 0.815, screener="net_margin"),
    MetricDef("fcf_margin", "FCF Margin (TTM)", "Profitability", "sec_xbrl", "fcf_margin_ttm", "percent", "pct1", "step", _Q,
              "Free cash flow TTM / revenue TTM.", 0.679),
    MetricDef("roe", "Return on Equity (TTM)", "Profitability", "sec_xbrl", "roe_ttm", "percent", "pct1", "step", _Q,
              "Net income TTM / average of parent equity at the period end and one year earlier.", 0.929, screener="roe"),
    MetricDef("roa", "Return on Assets (TTM)", "Profitability", "sec_xbrl", "roa_ttm", "percent", "pct1", "step", _Q,
              "Net income TTM / average of total assets at the period end and one year earlier.", 0.936, screener="roa",
              screener_definition_differs=True),
    # ── Financial Health ──────────────────────────────────────────────────
    MetricDef("cash", "Cash & Equivalents", "Financial Health", "sec_xbrl", "cash", "usd", "compact_usd", "step", _Q,
              "Cash and cash equivalents at the period end.", 0.949),
    MetricDef("total_assets", "Total Assets", "Financial Health", "sec_xbrl", "assets", "usd", "compact_usd", "step", _Q,
              "Total assets at the period end.", 0.961),
    MetricDef("total_liabilities", "Total Liabilities", "Financial Health", "sec_xbrl", "liabilities", "usd", "compact_usd", "step", _Q,
              "Total liabilities at the period end (only where the issuer reports the total).", 0.826),
    MetricDef("shareholders_equity", "Shareholders' Equity", "Financial Health", "sec_xbrl", "equity", "usd", "compact_usd", "step", _Q,
              "Stockholders' equity attributable to the parent at the period end.", 0.950),
    # ── Shares ────────────────────────────────────────────────────────────
    MetricDef("shares_outstanding", "Shares Outstanding", "Shares", "sec_xbrl", "shares_outstanding", "shares", "compact", "step", _Q,
              "Cover-page common shares outstanding as of its stated date, today's share basis.", 0.820,
              requires=("split_ledger",)),
    # ── Valuation (daily: price x point-in-time fundamentals) ─────────────
    MetricDef("market_cap", "Market Cap", "Valuation", "sec_xbrl+uct_bars", "market_cap", "usd", "compact_usd", "line", "daily",
              "Close x shares outstanding known at that close. Never today's share count.", 0.820,
              requires=("split_ledger",), screener="market_cap", screener_definition_differs=True,
              limitations="Single-class share count; multi-class issuers report per-class counts dimensionally."),
    MetricDef("pe_ttm", "P/E (TTM)", "Valuation", "sec_xbrl+uct_bars", "pe_ttm", "ratio", "x2", "line", "daily",
              "Close / diluted EPS TTM known at that close. Blank when EPS <= 0.", 0.870,
              requires=("split_ledger",), screener="pe_ttm", screener_definition_differs=True),
    MetricDef("ps_ttm", "Price / Sales (TTM)", "Valuation", "sec_xbrl+uct_bars", "ps_ttm", "ratio", "x2", "line", "daily",
              "Market cap / revenue TTM known at that close.", 0.80, requires=("split_ledger",), screener="ps",
              screener_definition_differs=True),
    MetricDef("pb", "Price / Book", "Valuation", "sec_xbrl+uct_bars", "pb", "ratio", "x2", "line", "daily",
              "Market cap / shareholders' equity known at that close. Blank when equity <= 0.", 0.80,
              requires=("split_ledger",), screener="pb", screener_definition_differs=True),
    MetricDef("fcf_yield", "FCF Yield (TTM)", "Valuation", "sec_xbrl+uct_bars", "fcf_yield", "percent", "pct1", "line", "daily",
              "Free cash flow TTM / market cap at that close.", 0.70, requires=("split_ledger",), screener="fcf_yield",
              screener_definition_differs=True),
    # ── Market ────────────────────────────────────────────────────────────
    MetricDef("beta_1y", "Beta (1Y vs SPY)", "Market", "uct_bars", "beta_1y", "ratio", "x2", "line", "daily",
              "OLS slope of 252 aligned daily price returns vs SPY (min 200), split-adjusted, not dividend-adjusted.",
              None, screener="beta", screener_definition_differs=True,
              history={"point_in_time": True, "since": "first 252 sessions of the symbol's bars"}),
)

# Measured, and deliberately NOT historical. Each says why.
DEFERRED: dict[str, str] = {
    "forward_pe": "BLOCKED: needs point-in-time consensus estimates; UCT holds only today's. Start snapshot capture.",
    "peg": "BLOCKED: depends on forward growth estimates (no history).",
    "eps_next_5y": "BLOCKED: analyst estimate, snapshot only.",
    "analyst_targets": "BLOCKED: snapshot only.",
    "inst_ownership": "SOURCE EXISTS, NOT INGESTED: 13F history by filing date (future project).",
    "insider_ownership": "SOURCE EXISTS, NOT INGESTED: Forms 3/4/5 by filing date.",
    "enterprise_value": "AMBIGUOUS: total debt has no consistent tag (LongTermDebt includes the current portion "
                        "for some issuers, not others -- 64/64 MSFT periods disagree between the two tags).",
    "debt_to_equity": "AMBIGUOUS: same debt-definition problem.",
    "dividends_per_share": "DERIVABLE, V1.1: declared vs paid tags differ in timing; only 41% of the universe pays.",
    "dividend_yield": "DERIVABLE, V1.1: after DPS.",
    "current_ratio": "DERIVABLE, V1.1: AssetsCurrent / LiabilitiesCurrent not yet validated.",
    "eps_growth_5y": "DERIVABLE, V1.1: needs 5 years of the same series.",
    "ifrs_filers": "NOT SUPPORTED in V1: 227 UCT tickers file IFRS (20-F/40-F); the concept map is US-GAAP.",
}


def assert_catalogue_truthful() -> None:
    ids = [m.id for m in V1]
    assert len(ids) == len(set(ids)), "duplicate metric id"
    for m in V1:
        assert m.source in PIT_SOURCES, f"{m.id}: not a point-in-time source"
        assert m.history.get("point_in_time") is True, f"{m.id}: not point-in-time"
        assert m.id not in DEFERRED, f"{m.id} is both chartable and deferred"
        assert m.presentation in ("step", "line")
        assert (m.presentation == "step") == (m.cadence == "quarterly"), f"{m.id}: step iff quarterly"
