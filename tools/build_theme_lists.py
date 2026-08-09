"""Build the UCT thematic prebuilt watchlists → api/data/theme_lists.json.

Source: tools/theme_monsterlist.txt (a TradingView thematic export, ###SECTION,EXCHANGE:SYM,…).
Pipeline: parse sections (dropping EXCLUDE / TBD / PUMP AND DUMP) → resolve tickers to US symbols
(foreign-exchange names map to a liquid US ADR via ADR_MAP, else drop) → merge curated ADDITIONS
(themes the list is missing) → verify EVERY ticker against live Massive grouped-daily and keep
only names clearing the liquidity bar (avg dollar volume >= MIN_DVOL AND price >= MIN_PRICE) →
dedupe per theme, sort by dollar volume. Consumed by api/services/watchlist_prebuilt.

Run: railway run --service web -- python tools/build_theme_lists.py
"""
import os
import re
import json
import datetime
import urllib.request

KEY = os.environ.get("MASSIVE_API_KEY", "")
BASE = "https://api.massive.com"
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "theme_monsterlist.txt")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "data", "theme_lists.json")
CATEGORY = "UCT Theme Lists"

MIN_DVOL = 3_000_000     # avg daily dollar volume floor
MIN_PRICE = 1.0          # min share price
_DAYS = 5                # grouped-daily sessions to average liquidity over

_SKIP_SECTIONS = {"EXCLUDE", "TBD", "PUMP AND DUMP"}
_US_EXCH = {"NASDAQ", "NYSE", "AMEX", "CBOE", "BATS", "ARCA", "NYSEARCA"}

# Foreign-exchange listings → the LIQUID US ADR/dual-listing to use instead. Anything foreign not
# here is dropped (its only US ADR is too thin to trade). Verified US-liquid names only.
ADR_MAP = {
    "MIL:RACE": "RACE",       # Ferrari
    "MIL:STLAM": "STLA",      # Stellantis
    "XETR:DBK": "DB",         # Deutsche Bank
    "EURONEXT:SAN": "SNY",    # Sanofi
    "XETR:SAP": "SAP",        # SAP (also already US-listed in the source → dedupes)
    "NSE:INFY": "INFY",       # Infosys (also US-listed)
}

# Rename a source section on the way in (its members are unchanged).
SOURCE_RENAME = {
    # AI Agents ≈ AI Pure Plays (6 shared names); with global no-dup we keep ONE list and fold
    # the agentic angle into its name instead of shipping two thin, overlapping lists.
    "AI Pure Plays": "AI Pure Plays & Agents",
}

# Acronyms kept uppercase when title-casing theme names.
_ACR = {"AI", "IP", "EDA", "OSAT", "EMS", "GPU", "SAAS", "EVTOL", "CRO", "US", "IT", "ADR", "ETF",
        "GLP", "REIT", "OS"}
# Whole-name fixups applied after title-casing (mixed-case words the acronym pass can't produce).
_FIXUPS = [("E&p", "E&P"), ("Devops", "DevOps"), ("E-commerce", "E-Commerce"), ("E-Commerce", "E-Commerce")]

# Extra tickers appended to an EXISTING source theme (keyed by normalized theme name). Used to
# place names that had no home in the raw list — e.g. the China-only ADRs, redistributed into
# their sector themes now that there's no standalone China list.
EXTRA = {
    "Restaurants & Food Service": ["YUMC"],
    "Hotels, Booking & Mobility": ["TCOM", "ATAT"],
    "Real Estate & Housing": ["BEKE"],
    "Retail": ["MNSO"],
    "Internet, Media & Social": ["TME", "BILI"],
    "E-Commerce & Marketplaces": ["VIPS"],
    "Fintech Disruptors": ["QFIN"],
}

# Notable themes the source is missing (curated; still liquidity-verified like everything else).
ADDITIONS = {
    "GLP-1 & Obesity": ("Obesity / GLP-1 drug developers and beneficiaries.",
                        ["LLY", "NVO", "VKTX", "AMGN", "HIMS", "TERN", "RYTM", "ALT"]),
    "Homebuilders": ("US homebuilders.",
                     ["DHI", "LEN", "PHM", "TOL", "KBH", "NVR", "MTH", "TPH", "GRBK", "MHO",
                      "LGIH", "CVCO", "CCS"]),
    "Uranium": ("Uranium miners and fuel-cycle names.",
                ["CCJ", "UEC", "NXE", "DNN", "UUUU", "LEU", "URG", "UROY", "EU", "ASPI"]),
    "Insurance": ("Property/casualty, life and specialty insurers.",
                  ["PGR", "ALL", "TRV", "CB", "AIG", "MET", "PRU", "HIG", "CINF", "ACGL", "AFL",
                   "WRB", "MKL", "AIZ", "KNSL"]),
    "Transport & Logistics": ("Freight, parcel, trucking, rail and logistics.",
                              ["UPS", "FDX", "ODFL", "XPO", "CHRW", "JBHT", "KNX", "SAIA", "LSTR",
                               "ARCB", "GXO", "RXO", "WERN", "HUBG", "CSX", "UNP", "NSC"]),
    "Agriculture & Fertilizers": ("Crop inputs, fertilizers, ag equipment and food producers.",
                                  ["CTVA", "NTR", "CF", "MOS", "ADM", "BG", "AGCO", "IPI", "DAR",
                                   "SMG", "FMC", "UAN", "ANDE", "CALM", "LW"]),
    "Utilities": ("Regulated electric and gas utilities.",
                  ["NEE", "DUK", "SO", "D", "AEP", "EXC", "XEL", "ED", "WEC", "ES", "PEG", "SRE",
                   "EIX", "PPL", "FE", "AEE", "CMS", "DTE", "ETR", "CNP", "NI", "LNT", "EVRG", "ATO"]),
    "Regional Banks": ("US regional and mid-cap banks.",
                       ["USB", "PNC", "TFC", "MTB", "FITB", "CFG", "KEY", "HBAN", "RF", "CMA",
                        "ZION", "WAL", "EWBC", "SNV", "CFR", "PB", "WBS", "CADE", "ONB", "COLB",
                        "BOKF", "WTFC", "PNFP", "FNB", "ASB", "CBSH", "FHN", "VLY"]),
    # 'AI Agents' folded into the renamed 'AI Pure Plays & Agents' (see SOURCE_RENAME) — a
    # standalone list overlapped it 6/9 and would gut both under the no-duplicate rule.
    # Cannabis intentionally omitted: only TLRY/ACB/CRON clear the $3M/day bar — every US MSO
    # (GTBIF/CURLF/TCNNF/VRNO) trades OTC and too thin, so the list would misrepresent the sector.
}


def norm_name(s):
    parts = re.split(r'(\s+)', s.strip())
    out = []
    for p in parts:
        if p.isspace() or not p:
            out.append(p)
            continue
        core = p.strip(":,&")
        if core.upper() in _ACR:
            out.append(p.upper())
        else:
            out.append(p[:1].upper() + p[1:].lower())
    name = ''.join(out)
    for a, b in _FIXUPS:
        name = name.replace(a, b)
    return name


def parse_monsterlist(path):
    raw = open(path, encoding="utf-8").read().strip()
    tokens = [t.strip() for t in raw.split(',')]
    tick = re.compile(r'^[A-Z0-9]{2,10}:.+')
    out = []
    cur = None
    ticks = None
    name_parts = []
    in_name = False
    for tok in tokens:
        if tok.startswith('###'):
            if cur is not None:
                out.append((cur, ticks))
            name_parts = [tok[3:]]
            in_name = True
            ticks = []
            cur = None
        elif tick.match(tok):
            if in_name:
                cur = ', '.join(p for p in name_parts if p).strip()
                in_name = False
            ticks.append(tok)
        else:
            if in_name:
                name_parts.append(tok)
    if cur is not None:
        out.append((cur, ticks))
    return [(nm, tk) for nm, tk in out if nm not in _SKIP_SECTIONS]


def resolve(tok):
    """EXCHANGE:SYM → US symbol, or None to drop."""
    ex, sym = tok.split(':', 1)
    if ex in _US_EXCH:
        return sym.replace('.', '.').strip()  # keep BRK.B / MOG.A dot form
    return ADR_MAP.get(tok)  # foreign → mapped ADR or None


def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def liquidity():
    """{TICKER: (avg_dollar_vol, latest_price)} across the last _DAYS grouped sessions."""
    days = []
    d = datetime.date.today()
    for _ in range(_DAYS + 8):
        if len(days) >= _DAYS:
            break
        data = get(f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{d.isoformat()}?adjusted=true&apiKey={KEY}")
        if data.get("results"):
            days.append((d.isoformat(), data["results"]))
        d -= datetime.timedelta(days=1)
    dv = {}
    px = {}
    latest = days[0][1] if days else []
    for r in latest:
        t = (r.get("T") or "").upper()
        if t and r.get("c"):
            px[t] = r["c"]
    acc = {}
    for _d, rows in days:
        for r in rows:
            t, c, v = (r.get("T") or "").upper(), r.get("c"), r.get("v")
            if t and c and v:
                acc.setdefault(t, []).append(c * v)
    for t, vals in acc.items():
        dv[t] = sum(vals) / len(vals)
    print(f"liquidity over {len(days)} sessions ({days[-1][0] if days else '?'}..{days[0][0] if days else '?'})")
    return dv, px


def main():
    if not KEY:
        raise SystemExit("MASSIVE_API_KEY not set")
    sections = parse_monsterlist(SRC)

    # Build themes: source sections first, then ADDITIONS. is_add marks the curated additions,
    # which WIN any cross-theme overlap (they're the specific homes — China, Uranium, GLP-1…).
    themes = []  # [name, desc, syms, is_add]
    for raw_name, toks in sections:
        nm = SOURCE_RENAME.get(norm_name(raw_name), norm_name(raw_name))
        syms = [s.upper() for s in (resolve(tk) for tk in toks) if s]
        syms += [s.upper() for s in EXTRA.get(nm, [])]
        themes.append([nm, None, syms, False])
    for name, (desc, syms) in ADDITIONS.items():
        themes.append([name, desc, [s.upper() for s in syms], True])

    dv, px = liquidity()

    def liquid(s):
        return dv.get(s, 0) >= MIN_DVOL and px.get(s, 0) >= MIN_PRICE

    # 1) per-theme liquid set (dedup within a theme).
    for th in themes:
        seen, kept = set(), []
        for s in th[2]:
            if s not in seen:
                seen.add(s)
                if liquid(s):
                    kept.append(s)
        th[2] = kept

    # 2) GLOBAL dedup — every ticker lands in exactly ONE theme. Claim order = additions first
    #    (in their listed order), then source sections (in source order); first claim wins.
    claim_order = sorted(range(len(themes)), key=lambda i: (0 if themes[i][3] else 1, i))
    claimed = set()
    for i in claim_order:
        themes[i][2] = [s for s in themes[i][2] if s not in claimed]
        claimed.update(themes[i][2])

    # 3) sort each theme by $vol, drop any that fell below 3 names after dedup.
    out = []
    print(f"\n{'THEME':40s} kept")
    for name, desc, kept, _is_add in themes:
        kept.sort(key=lambda s: dv.get(s, 0), reverse=True)
        if len(kept) < 3:
            print(f"  ! {name}: only {len(kept)} after dedup {kept} — SKIPPED")
            continue
        out.append({"name": name, "desc": desc or f"{name} theme.", "category": CATEGORY, "tickers": kept})
        print(f"{name[:40]:40s} {len(kept):4d}")

    json.dump(out, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    tot = sum(len(t["tickers"]) for t in out)
    print(f"\nwrote {len(out)} themes / {tot} tickers (all unique across themes) -> {OUT}")


if __name__ == "__main__":
    main()
