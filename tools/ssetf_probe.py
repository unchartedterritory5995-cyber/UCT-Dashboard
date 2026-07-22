"""Manual Finviz probe for the single-stock ETF pipeline (spec §3.1).

Usage (loads FINVIZ_API_KEY from .env or environment):
    python tools/ssetf_probe.py [--save-fixture]

Prints: header row vs EXPECTED_HEADERS, row count, ETF-industry row count,
numeric format samples for Average Volume/Price (incl. '-' blanks), parse
outcome counts + an explicit quarantine total with per-reason breakdown,
the parsed families for NBIS/TSLA/NVDA, and a fresh-listing/listing-lag spot
check (presence of known recently-launched funds + how many leveraged rows
carry blank volume/price — the §3.3 bars-backfill population).

--save-fixture writes tests/fixtures/finviz_etf_sample.csv: a generic ETF
sample PLUS every family-relevant ETF row (NBIS/TSLA/NVDA families, T-REX,
Corgi, crypto-named funds) PLUS the stock rows the parser needs to resolve
them (family underlyings + the real-world prefix-collision companies:
Longeveron/Long Table Growth, Bitcoin Infrastructure Acquisition, Apple
Hospitality, both Alphabet classes...). tests/test_ssetf_fixture.py rebuilds
its stock set from these rows, so the fixture must stay self-contained.
"""
import argparse, collections, csv, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from api.services import single_stock_etfs as ss
from api.services.ssetf_parser import parse_etf_name

# Fixture must contain these stock rows so family + collision parses replay
# from the fixture alone (see docstring).
_FIXTURE_STOCKS = {
    "NBIS", "TSLA", "NVDA", "MSFT", "AAPL", "APLE", "GOOG", "GOOGL",
    "LGVN", "LTGRU", "BIXI", "HSDT", "AVAT", "SVCC", "BULL", "SMCI",
}
_FIXTURE_ETF_NAME_RE = re.compile(
    r"NBIS|TSLA|Tesla|NVDA|NVIDIA|T-REX|T-Rex|Corgi|Bitcoin|Solana"
    r"|Avalanche|Stellar|GraniteShares|Tradr", re.I)

# Listing-lag spot check: recently-launched single-stock funds with launch
# context. Present in the export = Finviz has caught up; absent = the §3.5
# `add` override path would be needed for that fund today.
_RECENT_LAUNCHES = [
    ("NBIC", "Corgi NBIS 2x (Corgi suite, launched ~2026-07)"),
    ("FGRU", "T-REX 2X Long FIGR (Figure, IPO 2025-09)"),
    ("CCUP", "T-REX 2X Long CRCL (Circle, IPO 2025-06)"),
]


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
    quarantine_reasons = collections.Counter()
    families = collections.defaultdict(list)
    leveraged_blank_vol = 0
    for r in etf_rows:
        t = (r.get("Ticker") or "").strip().upper()
        res = parse_etf_name((r.get("Company") or ""), t, stock_set)
        outcomes[f"{res.status}:{res.reason}"] += 1
        if res.status == "quarantine":
            quarantine_reasons[res.reason] += 1
        if res.status == "parsed":
            families[res.underlying].append((t, res.direction, res.factor))
            if ss._num(r.get("Average Volume")) is None or ss._num(r.get("Price")) is None:
                leveraged_blank_vol += 1
    print(f"parse outcomes: {dict(outcomes)}")
    print(f"quarantine total: {sum(quarantine_reasons.values())} "
          f"(by reason: {dict(quarantine_reasons)})")
    for sym in ("NBIS", "TSLA", "NVDA"):
        print(f"family {sym}: {sorted(families.get(sym, []))}")
    print(f"total families: {len(families)}")

    print("listing-lag spot check:")
    by_ticker = {(r.get("Ticker") or "").strip().upper(): r for r in etf_rows}
    for t, why in _RECENT_LAUNCHES:
        r = by_ticker.get(t)
        if r is None:
            print(f"  {t}: ABSENT from export ({why}) -> would need an `add` override today")
        else:
            vol = ss._num(r.get("Average Volume"))
            print(f"  {t}: present ({why}) avg_vol={'blank' if vol is None else int(vol)}")
    print(f"parsed leveraged rows with blank volume/price (bars-backfill pop.): {leveraged_blank_vol}")

    if args.save_fixture:
        keep, seen = [], set()

        def _add(r):
            t = (r.get("Ticker") or "").strip().upper()
            if t and t not in seen:
                seen.add(t)
                keep.append(r)

        for r in etf_rows[:150]:                      # generic ETF sample
            _add(r)
        for r in etf_rows:                            # family/adversarial rows
            if _FIXTURE_ETF_NAME_RE.search(r.get("Company") or ""):
                _add(r)
        stock_rows = [r for r in rows
                      if (r.get("Industry") or "").strip() != "Exchange Traded Fund"]
        for r in stock_rows[:50]:                     # generic stock sample
            _add(r)
        for r in stock_rows:                          # required resolvers
            if (r.get("Ticker") or "").strip().upper() in _FIXTURE_STOCKS:
                _add(r)

        os.makedirs("tests/fixtures", exist_ok=True)
        with open("tests/fixtures/finviz_etf_sample.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=headers)
            w.writeheader()
            w.writerows(keep)
        print(f"fixture saved: tests/fixtures/finviz_etf_sample.csv ({len(keep)} rows)")


if __name__ == "__main__":
    main()
