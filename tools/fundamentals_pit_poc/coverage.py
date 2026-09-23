import sys, collections, re
from load import load
from api.services.fundamentals_pit.concepts import PRIMITIVES
HINT = {"capex": r"PaymentsToAcquire.*(PropertyPlant|ProductiveAssets|Equipment)", "revenue": r"^(Revenue|Revenues|SalesRevenue|InterestAndDividendIncomeOperating|NoninterestIncome)",
        "gross_profit": r"GrossProfit", "operating_income": r"OperatingIncomeLoss", "liabilities": r"^Liabilities$", "long_term_debt": r"^(LongTermDebt|DebtCurrent|ShortTermBorrowings|LongTermDebtNoncurrent|DebtInstrumentCarryingAmount)",
        "cash": r"^Cash", "dividends_per_share": r"DividendsPerShare"}
tickers = sys.argv[1:]
for t in tickers:
    doc, sub, fl, fx = load(t)
    by = collections.defaultdict(list)
    for f in fx:
        by[f.tag].append(f)
    print(f"== {t}")
    for pid, p in PRIMITIVES.items():
        row = []
        for tag in p.tags:
            fs = [f for f in by.get(tag, []) if f.unit == p.unit]
            if fs:
                ends = sorted(f.end for f in fs)
                row.append(f"{tag.split(':')[1][:38]}[{ends[0].year}-{ends[-1].year}:{len({(f.start,f.end) for f in fs})}]")
        extra = ""
        if pid in HINT:
            alts = sorted({tg.split(':')[1] for tg in by if re.search(HINT[pid], tg.split(':')[1]) and tg not in p.tags})
            extra = "  alt: " + ",".join(a[:45] for a in alts[:6]) if alts else ""
        print(f"  {pid:22s} " + (" ; ".join(row) if row else "— NONE —") + extra)
