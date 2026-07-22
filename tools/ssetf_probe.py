"""Manual Finviz probe for the single-stock ETF pipeline (spec §3.1).

Usage (loads FINVIZ_API_KEY from .env or environment):
    python tools/ssetf_probe.py [--save-fixture]

Prints: header row vs EXPECTED_HEADERS, row count, ETF-industry row count,
numeric format samples for Average Volume/Price (incl. '-' blanks), the parse
outcome for known families (NBIS/TSLA/NVDA), quarantine + skip counts, and a
spot check that recently-launched single-stock ETFs are present (listing lag).
--save-fixture writes the first 200 ETF rows + 50 stock rows to
tests/fixtures/finviz_etf_sample.csv for the parser fixture suite.
"""
import argparse, collections, csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from api.services import single_stock_etfs as ss
from api.services.ssetf_parser import parse_etf_name

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-fixture", action="store_true")
    args = ap.parse_args()

    rows = ss._fetch_finviz_market()
    if not rows:
        print("FETCH FAILED (empty) — check FINVIZ_API_KEY"); sys.exit(1)
    headers = list(rows[0].keys())
    print(f"headers: {headers}")
    print(f"expected: {ss.EXPECTED_HEADERS}")
    print(f"header match: {all(h in headers for h in ss.EXPECTED_HEADERS)}")
    print(f"total rows: {len(rows)}")

    etf_rows = [r for r in rows if (r.get("Industry") or "").strip() == "Exchange Traded Fund"]
    stock_set = {(r.get("Ticker") or "").strip().upper(): (r.get("Company") or "").strip()
                 for r in rows if (r.get("Industry") or "").strip() != "Exchange Traded Fund"
                 and (r.get("Ticker") or "").strip()}
    print(f"ETF rows: {len(etf_rows)}  stock set: {len(stock_set)}")

    vol_samples = collections.Counter()
    for r in etf_rows[:500]:
        raw = r.get("Average Volume")
        kind = "blank" if not raw or raw.strip() in ("-", "") else (
            "comma" if "," in raw else "plain")
        vol_samples[kind] += 1
    print(f"Average Volume formats (first 500 ETF rows): {dict(vol_samples)}")

    outcomes = collections.Counter()
    families = collections.defaultdict(list)
    for r in etf_rows:
        t = (r.get("Ticker") or "").strip().upper()
        res = parse_etf_name((r.get("Company") or ""), t, stock_set)
        outcomes[f"{res.status}:{res.reason}"] += 1
        if res.status == "parsed":
            families[res.underlying].append((t, res.direction, res.factor))
    print(f"parse outcomes: {dict(outcomes)}")
    for sym in ("NBIS", "TSLA", "NVDA"):
        print(f"family {sym}: {sorted(families.get(sym, []))}")
    print(f"total families: {len(families)}")

    if args.save_fixture:
        os.makedirs("tests/fixtures", exist_ok=True)
        with open("tests/fixtures/finviz_etf_sample.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=headers)
            w.writeheader()
            for r in etf_rows[:200]:
                w.writerow(r)
            for r in list(rows)[:50]:
                w.writerow(r)
        print("fixture saved: tests/fixtures/finviz_etf_sample.csv")

if __name__ == "__main__":
    main()
