"""Metric PRIMITIVES -> ordered XBRL tag candidates (tag normalisation).

Issuers do not share one tag per concept, and change tags over time (ASC 606
moved most revenue from `SalesRevenueNet` to
`RevenueFromContractWithCustomerExcludingAssessedTax` around 2018). Resolution
is PER PERIOD:

  * Standalone quarters are derived inside ONE tag POOL. Two candidate tags
    share a pool only when this issuer co-reports them for at least one period
    and they agree on every such period (metrics._equivalent_pools); otherwise
    quarters.py never subtracts across them.
  * For each period the candidate DISCLOSED MOST RECENTLY wins; a tie (the same
    filing reports both) goes to the order below. Recency first because a
    restatement can arrive under a new tag -- SMCI's restated FY2015 revenue is
    tagged `Revenues`, the original `SalesRevenueNet`; MSFT restated FY2016
    revenue for ASC 606 under `RevenueFromContract...`. Priority second, so a
    filing reporting `Revenues` (total) and `RevenueFromContract...` (which can
    exclude lease or interest income) resolves to the TOTAL.
  * Two candidates reporting exact negatives of each other for one period is a
    tagging error (CELH 2018 Q1 operating cash flow); the priority tag wins.
  * Candidates must share SCOPE. Component tags are not candidates.

KINDS decide the arithmetic that is legal:
  FLOW            additive duration (revenue, net income, cash flows) -> TTM sums
  PER_SHARE       non-additive duration (EPS) -> TTM sums documented as an
                  approximation; share-basis converted through splits.py
  INSTANT         balance-sheet level at a date (assets, equity, cash)
  SHARES_INSTANT  a share COUNT at a date (dei cover page), split-converted by
                  its own instant, not by the filing date
"""
from __future__ import annotations

from dataclasses import dataclass

FLOW, PER_SHARE, INSTANT, SHARES_INSTANT = "flow", "per_share", "instant", "shares_instant"


@dataclass(frozen=True)
class Primitive:
    id: str
    kind: str
    unit: str
    tags: tuple[str, ...]            # candidates, highest priority first
    note: str = ""


def _g(*names: str) -> tuple[str, ...]:
    return tuple(n if ":" in n else f"us-gaap:{n}" for n in names)


PRIMITIVES: dict[str, Primitive] = {p.id: p for p in (
    Primitive("revenue", FLOW, "USD", _g(
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "RevenuesNetOfInterestExpense",
    ), "Total revenue; banks report net revenue (net of interest expense). "
       "COMPONENT tags are excluded on purpose: PLUG's SalesRevenueGoodsNet is "
       "product sales only (2.2M of 15.2M in Q1 2017)."),
    Primitive("gross_profit", FLOW, "USD", _g("GrossProfit"),
              "Absent for banks and many service issuers -- NOT synthesised."),
    Primitive("operating_income", FLOW, "USD", _g("OperatingIncomeLoss"),
              "Absent for banks -- NOT synthesised."),
    Primitive("net_income", FLOW, "USD", _g(
        "NetIncomeLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
        "ProfitLoss",
    ), "Attributable to the parent; ProfitLoss (incl. NCI) is a last resort."),
    Primitive("eps_diluted", PER_SHARE, "USD/shares", _g(
        "EarningsPerShareDiluted",
        "EarningsPerShareBasicAndDiluted",
    ), "GAAP diluted EPS as reported."),
    Primitive("shares_diluted_wavg", PER_SHARE, "shares", _g(
        "WeightedAverageNumberOfDilutedSharesOutstanding",
    ), "Weighted-average diluted shares (a per-period average, not additive)."),
    Primitive("operating_cash_flow", FLOW, "USD", _g(
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    )),
    Primitive("capex", FLOW, "USD", _g(
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ), "Cash paid for PP&E, reported positive."),
    Primitive("cash", INSTANT, "USD", _g(
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ), "`Cash` alone is excluded: narrower than cash + equivalents (AAPL FY2009 "
       "Cash 1.14B vs 5.26B)."),
    Primitive("assets", INSTANT, "USD", _g("Assets")),
    Primitive("liabilities", INSTANT, "USD", _g("Liabilities"),
              "Several issuers never tag total liabilities -- NOT synthesised."),
    Primitive("equity", INSTANT, "USD", _g(
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ), "Parent shareholders' equity."),
    Primitive("long_term_debt", INSTANT, "USD", _g(
        "LongTermDebt",
        "LongTermDebtNoncurrent",
    ), "Definitions vary by issuer (current portion in or out) -- see AMBIGUOUS."),
    Primitive("dividends_per_share", PER_SHARE, "USD/shares", _g(
        "CommonStockDividendsPerShareDeclared",
        "CommonStockDividendsPerShareCashPaid",
    )),
    Primitive("shares_outstanding", SHARES_INSTANT, "shares", _g(
        "dei:EntityCommonStockSharesOutstanding",
    ), "Cover-page count 'as of the latest practicable date'. companyfacts holds "
       "only the NON-dimensional count, so multi-class issuers (per-class counts "
       "are dimensional) have none -- market cap is unavailable for them."),
)}
