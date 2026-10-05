"""Generator for the FA/EE depth fixtures in this directory.

⛔ PROVENANCE, SAID PLAINLY: these are SHAPE fixtures, not recordings. No FMP key
is available on the box that built them, so the statement rows carry FMP's
`/stable/*-statement` FIELD NAMES with deterministic made-up VALUES. The one
RECORDED FMP payload in this repo for this endpoint family is
`tests/fixtures/broker_estimates/fmp_analyst_estimates_quarter_AAPL.json`
(captured live by lane cov-05-07-09); the annual analyst-estimates file below
copies that recording's exact field set so the two can never drift in shape.

Re-run (writes the JSON beside this file):  python tests/fixtures/fmp_depth/_generate.py
"""
import json
import os

OUT = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(OUT, "..", "broker_estimates", "fmp_analyst_estimates_quarter_AAPL.json")

Q_DATES = ["2026-06-27", "2026-03-28", "2025-12-27", "2025-09-27", "2025-06-28",
           "2025-03-29", "2024-12-28", "2024-09-28"]           # newest first, as FMP sends
Q_PERIODS = ["Q3", "Q2", "Q1", "Q4", "Q3", "Q2", "Q1", "Q4"]
Q_FY = [2026, 2026, 2026, 2025, 2025, 2025, 2025, 2024]
A_DATES = ["2025-09-27", "2024-09-28", "2023-09-30"]


def income(d, p, fy, i):
    rev = 100e9 - i * 2e9
    ni = rev * 0.46 - 19e9
    return {"date": d, "symbol": "AAPL", "reportedCurrency": "USD", "fiscalYear": str(fy),
            "period": p, "revenue": rev, "costOfRevenue": rev * 0.54, "grossProfit": rev * 0.46,
            "researchAndDevelopmentExpenses": 8e9, "sellingGeneralAndAdministrativeExpenses": 7e9,
            "operatingExpenses": 15e9, "costAndExpenses": rev * 0.54 + 15e9,
            "operatingIncome": rev * 0.46 - 15e9, "ebitda": rev * 0.46 - 12e9,
            "interestExpense": 0, "incomeBeforeTax": rev * 0.46 - 14.5e9,
            "incomeTaxExpense": 4.5e9, "netIncome": ni,
            "eps": round(ni / 15e9, 2), "epsDiluted": round(ni / 15.1e9, 2),
            "weightedAverageShsOut": 15e9, "weightedAverageShsOutDil": 15.1e9}


def balance(d, p, fy, i):
    return {"date": d, "symbol": "AAPL", "fiscalYear": str(fy), "period": p,
            "cashAndCashEquivalents": 30e9 + i * 1e9, "shortTermInvestments": 20e9,
            "netReceivables": 60e9, "inventory": 7e9, "totalCurrentAssets": 150e9,
            "propertyPlantEquipmentNet": 45e9, "goodwill": 0, "totalAssets": 340e9,
            "accountPayables": 65e9, "totalCurrentLiabilities": 160e9, "longTermDebt": 85e9,
            "totalDebt": 100e9, "netDebt": 70e9 - i * 1e9, "totalLiabilities": 270e9,
            "totalStockholdersEquity": 70e9, "totalEquity": 70e9}


def cash(d, p, fy, i):
    return {"date": d, "symbol": "AAPL", "fiscalYear": str(fy), "period": p,
            "depreciationAndAmortization": 3e9, "stockBasedCompensation": 3e9,
            "operatingCashFlow": 30e9 - i * 1e9, "capitalExpenditure": -3e9,
            "freeCashFlow": 27e9 - i * 1e9, "acquisitionsNet": 0,
            "commonDividendsPaid": -4e9, "commonStockRepurchased": -25e9}


def dump(name, rows):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(rows, f, indent=1)
        f.write("\n")


def main():
    for kind, fn in (("income", income), ("balance", balance), ("cash", cash)):
        dump(f"{kind}_quarter_AAPL.json",
             [fn(d, p, fy, i) for i, (d, p, fy) in enumerate(zip(Q_DATES, Q_PERIODS, Q_FY))])
        dump(f"{kind}_annual_AAPL.json",
             [fn(d, "FY", int(d[:4]), i) for i, d in enumerate(A_DATES)])
    with open(REC, encoding="utf-8") as f:
        fields = list(json.load(f)[0].keys())
    ann = []
    for k, y in enumerate([2030, 2029, 2028, 2027, 2026, 2025, 2024]):
        eps = 9.0 + (y - 2024) * 0.8
        rev = 400e9 + (y - 2024) * 25e9
        row = {"symbol": "AAPL", "date": f"{y}-09-27",
               "revenueLow": rev * 0.95, "revenueHigh": rev * 1.05, "revenueAvg": rev,
               "ebitdaLow": rev * 0.33, "ebitdaHigh": rev * 0.37, "ebitdaAvg": rev * 0.35,
               "ebitLow": rev * 0.30, "ebitHigh": rev * 0.33, "ebitAvg": rev * 0.31,
               "netIncomeLow": rev * 0.24, "netIncomeHigh": rev * 0.27, "netIncomeAvg": rev * 0.255,
               "sgaExpenseLow": 26e9, "sgaExpenseHigh": 28e9, "sgaExpenseAvg": 27e9,
               "epsAvg": round(eps, 4), "epsHigh": round(eps * 1.08, 4), "epsLow": round(eps * 0.93, 4),
               "numAnalystsRevenue": max(3, 30 - k * 4), "numAnalystsEps": max(3, 32 - k * 4)}
        assert set(row) == set(fields), set(row) ^ set(fields)
        ann.append({k2: row[k2] for k2 in fields})
    dump("analyst_estimates_annual_AAPL.json", ann)


if __name__ == "__main__":
    main()
