"""Financial statements read straight from SEC EDGAR's XBRL company facts.

The licensed-first chain for statements (licensed-first pass 1, 2026-11-28):

    FMP  ->  SEC EDGAR (this module)  ->  Yahoo Finance (last)

EDGAR is public domain (licensing register T-83, class A; `provider_licensing_class`
("sec_edgar", "fundamentals")). Yahoo is class X (register T-73: no licence exists).
So where FMP holds no statements for a ticker, the figures the company itself filed
come before a Yahoo read. The callers: `financial_statements` (the FA panel, the
fiscal calendar, the Agent's `fundamentals` kind), `research/financials` (the
Financials tab grids) and `annual_financials` (the annual actuals widget).

WHAT IS READ. One document per company, `data.sec.gov/api/xbrl/companyfacts`, through
`fundamentals_pit.sec_client` (the repo's one fair-access EDGAR client: declared
User-Agent, one process-wide rate limiter). Only `us-gaap` facts in the units below
(USD, USD per share, shares), from periodic forms (10-K, 10-Q and their amendments).
A filer that reports in IFRS (most 20-F filers) or in another currency has nothing
here, and this module says `none` for it rather than guessing.

HOW A PERIOD IS BUILT (every value is a number the company filed; nothing is estimated):
  * a line item is a list of candidate tags, highest priority first; per period the
    first tag that reports it wins, and within a tag the LATEST filing's value wins
    (a restatement replaces the original);
  * annual = a reported duration of a fiscal-year length;
  * quarterly flows (revenue, income, cash flows) = `fundamentals_pit.quarters.
    standalone_quarters`: a reported 3-month figure, else the difference of two
    year-to-date figures with the same start (Q4 = FY - 9M), never across tags;
  * per-share figures and weighted share counts are NOT additive, so a quarter has
    them only when a 3-month figure was reported;
  * balance-sheet lines are instants at each period end;
  * cash paid out (capex, buybacks, dividends) is shown negative, the direction FMP
    shows it. That sign is the only transformation.

NEVER ON A MEMBER'S REQUEST THREAD (the house pattern, `api/services/scan_period.py`;
`sec_client`'s own rule): `snapshot()` reads what this module holds. With nothing
held it queues ONE background read on this module's single worker and answers
`pending`; a caller may wait a few seconds for it (`wait_s`). Answers are held in this
module, never in the shared cache.

States: ok (statements) | none (no SEC filer, or no us-gaap statements) |
pending (being read) | unavailable (SEC could not be read; asked again later).
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any, Optional

_log = logging.getLogger(__name__)

SOURCE = "SEC EDGAR"
SOURCE_KIND = "company-filed XBRL figures (10-K / 10-Q), read from SEC EDGAR company facts"

OK, NONE, PENDING, UNAVAILABLE = "ok", "none", "pending", "unavailable"

OK_TTL_S = 12 * 3600.0          # a held answer is fresh this long
NONE_TTL_S = 24 * 3600.0        # "no statements here" is asked again once a day
UNAVAILABLE_TTL_S = 900.0       # a failed read is asked again after 15 minutes
STALE_SERVE_S = 7 * 86400.0     # the last ok answer is served this long while it refreshes
KEEP = 256                      # companies held
MAX_QUEUED = 32                 # reads queued at once; more answers `pending` without queueing
SEC_TIMEOUT_S = 20.0
SEC_RETRIES = 1
ANNUAL_KEEP = 12
QUARTER_KEEP = 24

_PERIODIC_FORMS = frozenset({"10-K", "10-K/A", "10-Q", "10-Q/A", "10-KT", "10-KT/A", "10-QT", "10-QT/A"})

FLOW, PER_SHARE, INSTANT = "flow", "per_share", "instant"
_USD, _PER_SH, _SHARES = "USD", "USD/shares", "shares"

# (payload key, kind, unit, candidate us-gaap concepts in priority order, sign)
INCOME = [
    ("revenue", FLOW, _USD, ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                            "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
                            "RevenuesNetOfInterestExpense"), 1),
    ("cost_of_revenue", FLOW, _USD, ("CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"), 1),
    ("gross_profit", FLOW, _USD, ("GrossProfit",), 1),
    ("rnd", FLOW, _USD, ("ResearchAndDevelopmentExpense",), 1),
    ("sga", FLOW, _USD, ("SellingGeneralAndAdministrativeExpense",), 1),
    ("operating_expense", FLOW, _USD, ("OperatingExpenses",), 1),
    ("operating_income", FLOW, _USD, ("OperatingIncomeLoss",), 1),
    ("interest_expense", FLOW, _USD, ("InterestExpense",), 1),
    ("pretax_income", FLOW, _USD, (
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"), 1),
    ("tax", FLOW, _USD, ("IncomeTaxExpenseBenefit",), 1),
    ("net_income", FLOW, _USD, ("NetIncomeLoss", "ProfitLoss"), 1),
    ("eps_basic", PER_SHARE, _PER_SH, ("EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"), 1),
    ("eps_diluted", PER_SHARE, _PER_SH, ("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"), 1),
    ("shares_basic", PER_SHARE, _SHARES, ("WeightedAverageNumberOfSharesOutstandingBasic",), 1),
    ("shares_diluted", PER_SHARE, _SHARES, ("WeightedAverageNumberOfDilutedSharesOutstanding",), 1),
]
BALANCE = [
    ("cash", INSTANT, _USD, ("CashAndCashEquivalentsAtCarryingValue",
                             "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"), 1),
    ("receivables", INSTANT, _USD, ("AccountsReceivableNetCurrent",), 1),
    ("inventory", INSTANT, _USD, ("InventoryNet",), 1),
    ("current_assets", INSTANT, _USD, ("AssetsCurrent",), 1),
    ("goodwill", INSTANT, _USD, ("Goodwill",), 1),
    ("total_assets", INSTANT, _USD, ("Assets",), 1),
    ("payables", INSTANT, _USD, ("AccountsPayableCurrent",), 1),
    ("current_liabilities", INSTANT, _USD, ("LiabilitiesCurrent",), 1),
    ("long_term_debt", INSTANT, _USD, ("LongTermDebtNoncurrent", "LongTermDebt"), 1),
    ("total_liabilities", INSTANT, _USD, ("Liabilities",), 1),
    ("retained_earnings", INSTANT, _USD, ("RetainedEarningsAccumulatedDeficit",), 1),
    ("equity", INSTANT, _USD, ("StockholdersEquity",
                               "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"), 1),
]
CASHFLOW = [
    ("d_and_a", FLOW, _USD, ("DepreciationDepletionAndAmortization", "DepreciationAndAmortization"), 1),
    ("sbc", FLOW, _USD, ("ShareBasedCompensation",), 1),
    ("operating_cf", FLOW, _USD, ("NetCashProvidedByUsedInOperatingActivities",), 1),
    ("capex", FLOW, _USD, ("PaymentsToAcquirePropertyPlantAndEquipment",), -1),
    ("investing_cf", FLOW, _USD, ("NetCashProvidedByUsedInInvestingActivities",), 1),
    ("buybacks", FLOW, _USD, ("PaymentsForRepurchaseOfCommonStock",), -1),
    ("dividends_paid", FLOW, _USD, ("PaymentsOfDividendsCommonStock", "PaymentsOfDividends"), -1),
    ("financing_cf", FLOW, _USD, ("NetCashProvidedByUsedInFinancingActivities",), 1),
]
STATEMENTS = {"income": INCOME, "balance": BALANCE, "cashflow": CASHFLOW}
ALL_TAGS = frozenset(f"us-gaap:{c}" for spec in STATEMENTS.values() for _k, _kd, _u, cands, _s in spec for c in cands)


# ── pure: company facts -> statements ────────────────────────────────────────

def _latest_by_period(facts, tag: str, unit: str) -> tuple[dict, dict]:
    """({(start, end): value}, {end: value}) for one tag and unit: durations and
    instants, each period's value from the latest filing that reported it."""
    dur: dict = {}
    inst: dict = {}
    for f in facts:
        if f.tag != tag or f.unit != unit or f.form not in _PERIODIC_FORMS:
            continue
        if f.start is None:
            prev = inst.get(f.end)
            if prev is None or f.filed >= prev[0]:
                inst[f.end] = (f.filed, f.val)
        else:
            k = (f.start, f.end)
            prev = dur.get(k)
            if prev is None or f.filed >= prev[0]:
                dur[k] = (f.filed, f.val)
    return {k: v for k, (_d, v) in dur.items()}, {k: v for k, (_d, v) in inst.items()}


def _days(s: date, e: date) -> int:
    return (e - s).days + 1


def build_statements(facts) -> dict:
    """{"annual": {stmt: {end: {key: val}}}, "quarterly": {...}} from parsed facts. Pure."""
    from api.services.fundamentals_pit.quarters import QUARTER_DAYS, YEAR_DAYS, standalone_quarters

    def within(n, rng):
        return rng[0] <= n <= rng[1]

    annual: dict = {s: {} for s in STATEMENTS}
    quarterly: dict = {s: {} for s in STATEMENTS}
    for stmt, spec in STATEMENTS.items():
        if stmt == "balance":
            continue
        for key, kind, unit, cands, sign in spec:
            for concept in cands:
                dur, _inst = _latest_by_period(facts, f"us-gaap:{concept}", unit)
                if not dur:
                    continue
                for (s, e), v in dur.items():
                    if within(_days(s, e), YEAR_DAYS):
                        annual[stmt].setdefault(e, {}).setdefault(key, sign * v)
                if kind == FLOW:
                    qs, _disc = standalone_quarters(dur)
                    for e, q in qs.items():
                        quarterly[stmt].setdefault(e, {}).setdefault(key, sign * q.val)
                else:
                    for (s, e), v in dur.items():
                        if within(_days(s, e), QUARTER_DAYS):
                            quarterly[stmt].setdefault(e, {}).setdefault(key, sign * v)
    # balance sheet: instants at every period end the flows describe
    for basis, out in (("annual", annual), ("quarterly", quarterly)):
        ends = set(out["income"]) | set(out["cashflow"])
        for key, _kind, unit, cands, sign in BALANCE:
            for concept in cands:
                _dur, inst = _latest_by_period(facts, f"us-gaap:{concept}", unit)
                for e in ends:
                    if e in inst:
                        out["balance"].setdefault(e, {}).setdefault(key, sign * inst[e])
    return {"annual": annual, "quarterly": quarterly}


def rows_of(built: dict, basis: str, stmt: str) -> list[dict]:
    """One statement's periods, newest first: [{"period_end": iso, "values": {key: val|None}}].
    Every key of the statement is present; a line the company did not report is None."""
    keep = ANNUAL_KEEP if basis == "annual" else QUARTER_KEEP
    keys = [k for k, *_ in STATEMENTS[stmt]]
    by_end = (built.get(basis) or {}).get(stmt) or {}
    out = []
    for e in sorted(by_end, reverse=True)[:keep]:
        vals = by_end[e]
        out.append({"period_end": e.isoformat(), "values": {k: vals.get(k) for k in keys}})
    return out


def _answer_from_doc(doc: dict, cik: int) -> dict:
    from api.services.fundamentals_pit.facts import parse_companyfacts
    facts = parse_companyfacts(doc or {}, tags=set(ALL_TAGS))
    built = build_statements(facts)
    stmts = {basis: {stmt: rows_of(built, basis, stmt) for stmt in STATEMENTS}
             for basis in ("annual", "quarterly")}
    if not any(stmts[b][s] for b in stmts for s in STATEMENTS):
        return {"state": NONE, "cik": cik, "reason": "no us-gaap statements in USD"}
    return {"state": OK, "cik": cik, "source": SOURCE, "source_kind": SOURCE_KIND,
            "currency": "USD", "fetched_at": time.time(), **stmts}


# ── the reads (each small, so a test can stand in for it) ────────────────────

def _resolve_cik(sym: str) -> Optional[int]:
    from api.services import edgar
    raw = edgar.resolve_cik(sym)
    try:
        return int(raw) if raw else None
    except (TypeError, ValueError):
        return None


def _companyfacts(cik: int) -> dict:
    from api.services.fundamentals_pit import sec_client
    return sec_client.companyfacts(cik, retries=SEC_RETRIES, timeout=SEC_TIMEOUT_S)


def read_company(sym: str) -> dict:
    """One company's answer. Network; runs on this module's worker only. Never raises."""
    try:
        cik = _resolve_cik(sym)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[edgar-statements] %s cik lookup failed (%s)", sym, type(exc).__name__)
        return {"state": UNAVAILABLE, "reason": "cik lookup failed"}
    if cik is None:
        return {"state": NONE, "reason": "no SEC filer for this symbol"}
    try:
        doc = _companyfacts(cik)
    except Exception as exc:  # noqa: BLE001
        if getattr(exc, "status", None) == 404:
            return {"state": NONE, "cik": cik, "reason": "no XBRL company facts"}
        _log.warning("[edgar-statements] %s company facts failed (%s, status=%s)", sym,
                     type(exc).__name__, getattr(exc, "status", None))
        return {"state": UNAVAILABLE, "cik": cik, "reason": "SEC could not be read"}
    try:
        return _answer_from_doc(doc, cik)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[edgar-statements] %s parse failed (%s)", sym, type(exc).__name__)
        return {"state": UNAVAILABLE, "cik": cik, "reason": "company facts could not be read"}


# ── held answers + the one worker ────────────────────────────────────────────

_lock = threading.Lock()
_held: dict[str, tuple[float, float, dict]] = {}      # sym -> (fresh until, servable until, answer)
_inflight: dict[str, threading.Event] = {}
_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="edgar-stmts")


def _ttl(answer: dict) -> float:
    return {OK: OK_TTL_S, NONE: NONE_TTL_S}.get(answer.get("state"), UNAVAILABLE_TTL_S)


def _remember(sym: str, answer: dict) -> None:
    now = time.time()
    with _lock:
        prev = _held.get(sym)
        if answer.get("state") == UNAVAILABLE and prev and prev[2].get("state") == OK and prev[1] > now:
            # a failed refresh never replaces the last good statements
            _held[sym] = (now + UNAVAILABLE_TTL_S, prev[1], prev[2])
        else:
            servable = now + (STALE_SERVE_S if answer.get("state") == OK else _ttl(answer))
            _held[sym] = (now + _ttl(answer), servable, answer)
        while len(_held) > KEEP:
            _held.pop(min(_held, key=lambda k: _held[k][0]), None)


def _run(sym: str, done: threading.Event) -> None:
    try:
        _remember(sym, read_company(sym))
    except Exception as exc:  # noqa: BLE001 -- never leave a read "pending" for ever
        _log.warning("[edgar-statements] %s read failed (%s)", sym, type(exc).__name__)
        _remember(sym, {"state": UNAVAILABLE, "reason": "read failed"})
    finally:
        with _lock:
            _inflight.pop(sym, None)
        done.set()


def _schedule(sym: str) -> Optional[threading.Event]:
    with _lock:
        ev = _inflight.get(sym)
        if ev is not None:
            return ev
        if len(_inflight) >= MAX_QUEUED:
            return None
        ev = _inflight[sym] = threading.Event()
    _POOL.submit(_run, sym, ev)
    return ev


def _clean(ticker: Any) -> str:
    return str(ticker or "").strip().upper()


def snapshot(ticker: Any, *, wait_s: float = 0.0) -> dict:
    """What this module holds for one company. NEVER reads SEC on the caller's
    thread: a miss (or an expired answer) queues one background read; the caller
    may wait up to `wait_s` for it. A stale ok answer is served marked `stale`
    while it refreshes."""
    sym = _clean(ticker)
    if not sym:
        return {"state": NONE, "reason": "no symbol"}
    now = time.time()
    with _lock:
        hit = _held.get(sym)
    if hit is not None and hit[0] > now:
        return hit[2]
    stale = hit[2] if hit is not None and hit[1] > now and hit[2].get("state") == OK else None
    ev = _schedule(sym)
    if stale is not None:
        return {**stale, "stale": True}
    if ev is not None and wait_s > 0:
        ev.wait(wait_s)
        with _lock:
            hit = _held.get(sym)
        if hit is not None and hit[0] > time.time():
            return hit[2]
    return {"state": PENDING}


def reset_for_tests() -> None:
    with _lock:
        _held.clear()
        _inflight.clear()
