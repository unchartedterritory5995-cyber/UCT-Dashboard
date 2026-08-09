"""Regenerate themes_taxonomy.json from api/data/theme_lists.json.

Repoints the Theme Tracker (and the chart watermark's theme line) at the new curated,
liquidity-verified, globally-deduped theme set. Keeps the taxonomy STRUCTURE the seeder expects
(theme_db.seed_from_json): the same 12 sectors, each theme assigned to one sector, holdings
carried over. Bumps `version` so the DB reseeds on boot. Sub-themes/tiers/rationale aren't in
the flat source, so holdings are single-tier ('core') with no sub-theme — the tracker keeps
working, just without sub-groupings we don't have data for.

Run: python tools/build_theme_taxonomy.py   (no network needed)
"""
import os
import re
import json
import datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "api", "data", "theme_lists.json")
OUT = os.path.join(ROOT, "themes_taxonomy.json")
VERSION = "5.0.0"

# The 12 sectors (unchanged from the prior taxonomy).
SECTORS = [
    ("technology", "Technology"), ("innovation", "Innovation"), ("clean_energy", "Clean Energy"),
    ("traditional_energy", "Traditional Energy"), ("materials", "Materials"),
    ("defense_industrials", "Defense & Industrials"), ("financials", "Financials"),
    ("healthcare", "Healthcare"), ("consumer", "Consumer"),
    ("real_estate_utilities", "Real Estate & Utilities"), ("crypto", "Crypto"), ("global", "Global"),
]

# Each new theme → its sector.
SECTOR_OF = {}
for sid, names in {
    "technology": ["Chips: Logic, IP & EDA", "Semicap Equipment & Materials", "Foundry & OSAT",
                   "AI Servers & EMS", "Memory & Storage", "AI Interconnect Silicon",
                   "Optics, Lasers & Photonics", "AI Networking & Connectors",
                   "AI Neocloud & GPU Compute", "AI Pure Plays & Agents", "Cloud, Data & DevOps Infra",
                   "Cybersecurity", "Mega-cap Software Platforms", "Vertical & Application SAAS",
                   "Comms & Collab Software", "Internet, Media & Social", "Gaming & Adtech"],
    "innovation": ["Quantum Computing", "Robotics & Machine Perception", "Space", "Drones & EVTOL"],
    "consumer": ["E-Commerce & Marketplaces", "Cars", "Airlines & Cruises", "Hotels, Booking & Mobility",
                 "Betting & Entertainment", "Restaurants & Food Service", "Retail", "Food & Basic Needs",
                 "Homebuilders"],
    "defense_industrials": ["Aerospace & Defense", "Special Machinery & Industrials",
                            "AI Power & Data-center Electrical", "Datacenter & Electrical Contractors",
                            "Professional Services", "Transport & Logistics"],
    "clean_energy": ["Energy Storage", "Nuclear & Power Generation", "Solar", "Uranium"],
    "traditional_energy": ["Oil E&P & Majors", "Oil Services & Equipment", "Refiners & Midstream"],
    "materials": ["Critical Minerals & Rare Earths", "Industrial Metals & Coal", "Gold & Silver Miners",
                  "Chemicals", "Agriculture & Fertilizers"],
    "real_estate_utilities": ["Real Estate & Housing", "Utilities", "Telecom & Cable"],
    "healthcare": ["Big Pharma & Large Biotech", "Clinical-stage Biotech", "Life Science Tools & CRO",
                   "Medtech, Devices & Diagnostics", "Healthcare Services & Insurers", "GLP-1 & Obesity"],
    "crypto": ["Crypto & Bitcoin Miners"],
    "financials": ["Fintech Disruptors", "Banks, Networks & Asset Mgmt", "Insurance", "Regional Banks"],
}.items():
    for n in names:
        SECTOR_OF[n] = sid

# Canonical ETF proxy per theme (label only; performance is computed from holdings). Unmapped = none.
ETF_OF = {
    "Chips: Logic, IP & EDA": ("SOXX", "iShares Semiconductor ETF"),
    "Semicap Equipment & Materials": ("SMH", "VanEck Semiconductor ETF"),
    "Cybersecurity": ("CIBR", "First Trust NASDAQ Cybersecurity ETF"),
    "Cloud, Data & DevOps Infra": ("SKYY", "First Trust Cloud Computing ETF"),
    "Internet, Media & Social": ("FDN", "First Trust Dow Jones Internet ETF"),
    "Gaming & Adtech": ("ESPO", "VanEck Video Gaming and eSports ETF"),
    "Robotics & Machine Perception": ("BOTZ", "Global X Robotics & AI ETF"),
    "Quantum Computing": ("QTUM", "Defiance Quantum ETF"),
    "Space": ("ARKX", "ARK Space Exploration & Innovation ETF"),
    "Aerospace & Defense": ("ITA", "iShares U.S. Aerospace & Defense ETF"),
    "Solar": ("TAN", "Invesco Solar ETF"),
    "Nuclear & Power Generation": ("NLR", "VanEck Uranium and Nuclear ETF"),
    "Uranium": ("URA", "Global X Uranium ETF"),
    "Energy Storage": ("BATT", "Amplify Lithium & Battery Technology ETF"),
    "Critical Minerals & Rare Earths": ("REMX", "VanEck Rare Earth/Strategic Metals ETF"),
    "Industrial Metals & Coal": ("XME", "SPDR S&P Metals & Mining ETF"),
    "Gold & Silver Miners": ("GDX", "VanEck Gold Miners ETF"),
    "Agriculture & Fertilizers": ("MOO", "VanEck Agribusiness ETF"),
    "Oil E&P & Majors": ("XOP", "SPDR S&P Oil & Gas E&P ETF"),
    "Oil Services & Equipment": ("OIH", "VanEck Oil Services ETF"),
    "Real Estate & Housing": ("VNQ", "Vanguard Real Estate ETF"),
    "Homebuilders": ("XHB", "SPDR S&P Homebuilders ETF"),
    "Retail": ("XRT", "SPDR S&P Retail ETF"),
    "Airlines & Cruises": ("JETS", "U.S. Global Jets ETF"),
    "Transport & Logistics": ("IYT", "iShares U.S. Transportation ETF"),
    "Utilities": ("XLU", "Utilities Select Sector SPDR Fund"),
    "Regional Banks": ("KRE", "SPDR S&P Regional Banking ETF"),
    "Fintech Disruptors": ("FINX", "Global X FinTech ETF"),
    "Big Pharma & Large Biotech": ("IBB", "iShares Biotechnology ETF"),
    "Clinical-stage Biotech": ("XBI", "SPDR S&P Biotech ETF"),
    "Medtech, Devices & Diagnostics": ("IHI", "iShares U.S. Medical Devices ETF"),
    "Crypto & Bitcoin Miners": ("WGMI", "CoinShares Valkyrie Bitcoin Miners ETF"),
}


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return re.sub(r"_+", "_", s)


def main():
    lists = json.load(open(SRC, encoding="utf-8"))
    missing = [l["name"] for l in lists if l["name"] not in SECTOR_OF]
    if missing:
        raise SystemExit(f"themes with no sector mapping: {missing}")

    themes = []
    for i, l in enumerate(lists):
        name = l["name"]
        etf = ETF_OF.get(name, (None, None))
        themes.append({
            "id": slug(name),
            "name": name,
            "sector_id": SECTOR_OF[name],
            "etf_ticker": etf[0],
            "etf_name": etf[1],
            "display_order": i + 1,
            "sub_themes": [],
            "holdings": [{"sym": s, "tier": "core", "sub_theme_id": None, "rationale": ""}
                         for s in l["tickers"]],
        })

    out = {
        "version": VERSION,
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "sectors": [{"id": sid, "name": nm, "display_order": i + 1}
                    for i, (sid, nm) in enumerate(SECTORS)],
        "themes": themes,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    holds = sum(len(t["holdings"]) for t in themes)
    print(f"wrote v{VERSION}: {len(themes)} themes / {holds} holdings across "
          f"{len(set(SECTOR_OF.values()))} sectors -> {OUT}")
    from collections import Counter
    for sid, n in Counter(SECTOR_OF.values()).most_common():
        print(f"  {sid:22s} {n}")


if __name__ == "__main__":
    main()
