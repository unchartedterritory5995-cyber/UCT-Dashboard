"""One-shot importer: Phase 0 `econ_catalog.csv` -> `api/services/econ/registry/series.json`.

Kept for PROVENANCE, not as a build step. From Phase 1 on, `series.json` is the
hand-edited source of truth; re-running this OVERWRITES hand edits. Run it only
to reproduce the original import (e.g. to diff what a hand edit changed):

    python tools/econ/import_catalog.py [path/to/econ_catalog.csv] [--out path]

Every judgement the importer makes is a named table below (verification
overrides, lag rules per release family, unit formats), so a reviewer can audit
the mapping without reading the parser.

STATUS RULES (Phase 1 contract + owner brief 2026-09-28)
  RED                                   -> excluded
  cohort (41 COHORT rows + derivation parents USCORECPINSA, USGDP)
      verified + GREEN                  -> enabled
      otherwise                         -> unverified   (USICSA: disabled, open item A)
  everything else: verified -> disabled, else unverified
  "verified" = the catalog notes carry a live-verification phrase and no identity
  '?' (a '?' only on a start date / FRED cross-reference does not count), or a
  Phase 0 proof file settles the '?' (VERIFY_OVERRIDES). Derived rows are
  verified iff every input is verified and the op is computable by derive.py.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_CSV = Path(r"C:\Users\blake\uct-econ-phase0\econ_catalog.csv")
DEFAULT_OUT = REPO / "api" / "services" / "econ" / "registry" / "series.json"

COHORT_PARENTS = {"USCORECPINSA", "USGDP"}   # derivation parents of cohort series

# Phrases the Phase 0 catalog agent wrote when it verified an ID live.
VERIFY_PHRASES = (
    "ID verified via BLS API", "verified via DBnomics BEA mirror", "EITS code verified",
    "DDP mnemonic + start verified", "Endpoint verified live", "Endpoint+field verified live",
    "Endpoint + row verified live", "Series ID verified via EIA dnav",
)

# catalog_notes.md "Unverified provider IDs" -- identity is NOT established.
CATALOG_UNVERIFIED = {
    "USICSA", "USCCSA", "USRGDPYOY", "USGDPDEF", "USLTVEHSAL", "USCURACCT", "USRETAILMV",
    "USGOODSBAL", "USDEPOSITS", "USINDPRO", "USMONBASE", "USDOLLARIDX", "USIORB", "USONRRPRATE",
    "USPPIFDNSA", "USMTSINT", "USNATGASSTOR", "USFHFAHPI", "USMORT30",
    "USMEDCPI", "USTRIMCPI", "USCLEVINF1Y", "USCLEVINF10Y", "USTRIMPCE", "USSTICKYCPI",
    "USWAGETRK", "USGDPNOW", "USPHILLYFED", "USRICHFED", "USDALLASFED", "USKCFED", "USEMPIRE",
    "USSCEINF1Y", "USSCEINF3Y", "USGSCPI", "USCFNAI", "USNFCI", "USTIC",
}
# catalog_notes.md: rows whose '?' is ONLY on a start date / FRED cross-reference.
QMARK_NOT_IDENTITY = {
    "USCPIFOODHOME", "USCPIRENT", "USCPISVCXSH", "USCPIAUTOINS", "USCPIAIRFARE", "USPPICORE",
    "USPPICORE2", "USPTECON", "USHLTHNFP", "USGASINV", "USREFUTIL",
    # same shape, read from the notes column ("Start approx?", "FRED eq '?'", "... in current vintage?")
    "USIMPPRICE", "USEXPPRICE", "USECIPRIV", "USRPCE",
    # '?' is about the pre-2008 single-target splice, not the NY Fed record fields
    "USFEDFUNDSU",
}
PH0 = r"C:\Users\blake\uct-econ-phase0"
# A Phase 0 proof file settles an identity '?'. (verified, evidence, params patch)
VERIFY_OVERRIDES = {
    "USINDPRO": (True, PH0 + r"\proofs\fed_g17_head.csv 'Unique Identifier: G17/IP_MARKET_GROUPS/IP.B50001.S' "
                 "+ proofs\\proof_log.txt 'G17 pkg ...: IP.B50001.S total IP 1919-01 ... 2026-08 103.0682'. "
                 "Catalog dataset prefix IP_MAJOR_INDUSTRY_GROUPS was WRONG; corrected to IP_MARKET_GROUPS.",
                 {"dataset": "IP_MARKET_GROUPS"}),
    "USFHFAHPI": (True, PH0 + r"\proofs\proof_log.txt FHFA: 'hpi_master.csv ... US purchase-only monthly 1991-01 "
                  "100.00 ... 2026-06 NSA 452.26 / SA 442.53'; column names index_nsa/index_sa in "
                  "proofs\\fhfa_hpi_master_sample.csv header.", None),
    "USICSA": (True, PH0 + r"\proofs.md cross-check: DOL r539cy SA initial claims wk 08/29 207,000 == ICSA. "
               "Keyless XML lags ~3 weeks: CURRENT-WEEK SOURCE UNRESOLVED (Phase 1 open item A).", None),
}
STATUS_NOTES = {
    "USICSA": "disabled: current-week source unresolved (Phase 1 open item A) -- DOL keyless XML lags ~3 weeks.",
    "USEMPIRE": "unverified: ESMS column mnemonic 'GACDISA?' not confirmed; the adapter agent confirms it.",
    "USUNRATEYTH": "disabled: catalog EXCLUDE is a product call (low-value variant), not a licensing exclusion.",
    "USMORT30": "week anchor THU is not in model.WeekAnchor; left blank until the enum grows one.",
}
QA_TWINS = {"USPCEPIMOMA", "USCOREPCEMOMA"}   # agency-published QA twins: ingested, never searched

# ------------------------------------------------------------------ frequency

def parse_frequency(raw: str, sym: str, derivation: str) -> tuple[str, str]:
    s = raw.strip()
    if s.startswith("D"):
        return "D", ""
    if s.lower().startswith("irregular"):
        return "IRREG", ""
    if s.startswith("M"):
        return "M", ""
    if s.startswith("Q"):
        return "Q", ""
    if s.startswith("A"):
        return "A", ""
    if s.startswith("W"):
        low = s.lower()
        if "saturday" in low:
            return "W", "SAT"
        if "fri" in low:
            return "W", "FRI"
        if "wed" in low:
            return "W", "WED"
        if "monday" in low:
            return "W", "MON"
        if "thursday" in low:
            return "W", ""          # THU not in model.WeekAnchor (see STATUS_NOTES)
        # plain 'W': anchor by family
        if sym == "USICSA4W":
            return "W", "SAT"
        if sym == "USNETLIQ":
            return "W", "WED"
        return "W", "FRI"           # EIA WPSR / NGS weeks end Friday; Chicago NFCI weeks end Friday
    raise ValueError(f"{sym}: unparseable frequency {raw!r}")

# ------------------------------------------------------------------ units

BLS_INDEX_NUM3 = ("CPI", "PPI", "MXP", "ECI")

def parse_units(raw: str, row: dict, derived_pct: bool) -> dict:
    u = raw.strip()
    low = u.lower()
    cat = row["category"]
    ds = row["source_dataset"]

    def mk(display, fmt, scale):
        return {"raw": u, "display": display, "fmt": fmt, "scale": scale}

    if low == "percentage points":
        return mk("pp", "pp2", 1)
    if low.startswith("percent") or low == "percent yoy":
        if derived_pct:
            return mk("%", "pct1", 1)
        if cat == "Rates & Fed" or cat == "Credit & Banking" and "Percent" == u:
            return mk("%", "pct2", 1)
        return mk("%", "pct1", 1)
    if low.startswith("index"):
        if "(0 =" in low:
            return mk("index", "num2", 1)
        if any(ds.startswith(p) for p in BLS_INDEX_NUM3) or ds == "NIPA":
            return mk("index", "num3", 1)
        if "1991" in low:                      # FHFA HPI publishes 2 decimals
            return mk("index", "num2", 1)
        return mk("index", "num1", 1)
    if low == "diffusion index":
        return mk("index", "num1", 1)
    if low.startswith("millions usd") or low.startswith("millions of usd"):
        return mk("USD", "usd_compact", 1_000_000)
    if low.startswith("billions") and "usd" in low:
        return mk("USD", "usd_compact", 1_000_000_000)
    if low in ("usd", "usd (convert to billions)"):
        return mk("USD", "usd_compact", 1)
    if low in ("thousands of jobs", "thousands of persons", "thousands"):
        return mk("persons", "k_persons", 1_000)
    if low == "thousand barrels":
        return mk("bbl", "mbbl", 1_000)
    if low == "thousand barrels/day":
        return mk("bbl/d", "num0", 1_000)
    if low == "billion cubic feet":
        return mk("Bcf", "bcf", 1_000_000_000)
    if low == "usd per gallon":
        return mk("USD/gal", "usd3", 1)
    if low == "usd per barrel":
        return mk("USD/bbl", "num2", 1)
    if low == "usd per hour":
        return mk("USD/hr", "num2", 1)
    if low == "thousands of units, saar":
        return mk("units", "num0", 1_000)
    if low in ("millions of units, saar", "millions, saar"):
        return mk("units", "num2", 1_000_000)
    if low in ("number of claims", "number"):
        return mk("count", "num0", 1)
    if low in ("hours", "months"):
        return mk(low, "num1", 1)
    if low in ("ratio", "std deviations"):
        return mk("ratio" if low == "ratio" else "std dev", "num2", 1)
    raise ValueError(f"{row['uct_symbol']}: unmapped units {raw!r}")


def parse_sa(raw: str, units_raw: str) -> str:
    s = raw.strip()
    if s == "SA":
        return "SAAR" if ("SAAR" in units_raw or "annualized" in units_raw.lower()) else "SA"
    if s.startswith("NSA-based"):
        return "NSA-based"
    if s.startswith("SA-based"):
        return "SA-based"
    if s.startswith("NSA"):
        return "NSA"
    if s == "derived":
        return "SA-based"          # USPPIYOY/USPPIMOM/USCOREPPIYOY: SA parents except NSA-based YoY (below)
    return "mixed"                 # 'varies', 'mixed (...)'

# ------------------------------------------------------------------ derivation

SUPPORTED_OPS = {"yoy_pct", "mom_pct", "pct_change", "diff", "spread", "ratio_pct", "sub", "sma", "sum"}
SUPPORTED_TRANSFORMS = {"eop_q"}
_CALL = re.compile(r"^\s*([a-z_]+)\((.*)\)\s*$")


def _split_args(s: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def parse_derivation(raw: str, freq: str) -> tuple[dict | None, list[str]]:
    """-> (structured derivation, problems). Problems make the row unverified."""
    raw = raw.strip()
    if not raw:
        return None, []
    m = _CALL.match(raw)
    if not m:
        return {"op": "unknown", "inputs": [], "params": {"raw": raw}, "version": 1}, [f"unparseable derivation {raw!r}"]
    op, argstr = m.group(1), m.group(2)
    inputs, transforms, nums, problems = [], {}, [], []
    for a in _split_args(argstr):
        mm = _CALL.match(a)
        if mm:
            tr, inner = mm.group(1), mm.group(2).strip()
            inputs.append(inner)
            transforms[inner] = tr
            if tr not in SUPPORTED_TRANSFORMS:
                problems.append(f"input transform {tr}() is not implemented by derive.py")
        elif re.fullmatch(r"\d+", a):
            nums.append(int(a))
        else:
            inputs.append(a)
    params: dict = {}
    if op == "ratio":
        op = "ratio_pct"
    if transforms:
        params["transforms"] = transforms
    if op in ("sma", "sum", "pct_change"):
        if nums:
            params["n"] = nums[0]
    elif op == "diff":
        params["n"] = 1
    elif nums:
        params["args"] = nums
    if op not in SUPPORTED_OPS:
        problems.append(f"op {op}() is not implemented by derive.py")
    d = {"op": op, "inputs": inputs, "params": params, "version": 1}
    return d, problems

# ------------------------------------------------------------------ sources

def _clean(s: str) -> str:
    return s.replace("?", "").strip()


def source_for(row: dict) -> tuple[str, str, dict, str]:
    """-> (agency, adapter, params, official_url)."""
    sym, auth, ds, pid = row["uct_symbol"], row["authoritative_source"], row["source_dataset"], row["provider_series_id"]
    sa = row["seasonal_adjustment"].strip()
    if row["redistribution_status"].startswith("RED"):
        return auth, "proprietary", {}, ""
    if ds == "derived":
        return auth, "derived", {}, ""
    if auth == "BLS":
        return ("U.S. Bureau of Labor Statistics", "bls", {"series_id": pid},
                f"https://data.bls.gov/timeseries/{pid}")
    if auth.startswith("U.S. Dept of Labor"):
        measure = "initial" if "initial" in pid else "continued"
        return ("U.S. Department of Labor, ETA", "dol",
                {"report": "r539cy", "level": "us", "measure": measure, "seasonal": "SA"},
                "https://oui.doleta.gov/unemploy/claims.asp")
    if auth == "BEA":
        if ds == "NIPA" and pid.startswith("NIPA"):
            m = re.match(r"NIPA (T\w+) L(\d+) \(([A-Z0-9]+)\??\)", pid)
            if not m:
                raise ValueError(f"{sym}: BEA id {pid!r}")
            return ("U.S. Bureau of Economic Analysis", "bea",
                    {"dataset": "NIPA", "table": m.group(1), "line": int(m.group(2)),
                     "series_code": m.group(3), "frequency": row["frequency"][0]},
                    "https://apps.bea.gov/iTable/?reqid=19")
        if ds == "ITA":
            return ("U.S. Bureau of Economic Analysis", "bea",
                    {"dataset": "ITA", "indicator": "BalCurrAcct", "area": "AllCountries", "frequency": "QSA"},
                    "https://apps.bea.gov/iTable/?reqid=62")
        return ("U.S. Bureau of Economic Analysis", "bea", {"dataset": "supplemental", "file": _clean(pid)},
                "https://www.bea.gov/")
    if auth == "U.S. Census Bureau":
        prog, cat, dt = _clean(pid).split("/")
        return ("U.S. Census Bureau", "census",
                {"program": prog, "category": cat, "data_type": dt, "seasonal": "SA" if sa == "SA" else "NSA"},
                "https://www.census.gov/economic-indicators/")
    if auth == "Federal Reserve Board":
        if sym == "USIORB":
            return ("Board of Governors of the Federal Reserve System", "fed_policy",
                    {"page": "https://www.federalreserve.gov/monetarypolicy/reserve-balances.htm"},
                    "https://www.federalreserve.gov/monetarypolicy/reserve-balances.htm")
        parts = pid.split("/")
        rel = parts[0]
        dataset = parts[1] if len(parts) == 3 and parts[1] != "..." else None
        series = parts[-1]
        p = {"release": rel, "dataset": dataset, "series": series}
        if sym.startswith("UST") and "TIPS" not in sym:
            p["alt"] = {"adapter": "treasury_curve", "note": "authority for CMT is the Treasury par yield curve; H.15 lags 1 business day"}
        rel_page = {"H15": "h15", "H41": "h41", "H6": "h6", "H8": "h8", "G19": "g19", "G17": "g17", "H10": "h10"}[rel]
        return ("Board of Governors of the Federal Reserve System", "fed_ddp", p,
                f"https://www.federalreserve.gov/releases/{rel_page}/")
    if auth == "Federal Reserve Bank of New York":
        if pid.startswith("/api/"):
            path, _, field = pid.partition(" (")
            return ("Federal Reserve Bank of New York", "nyfed",
                    {"path": path.strip(), "field": field.rstrip(")").strip()},
                    "https://www.newyorkfed.org/markets/reference-rates")
        if sym == "USEMPIRE":
            return ("Federal Reserve Bank of New York", "nyfed_esms",
                    {"file": "ESMS SA diffusion file", "column": "GACDISA", "column_verified": False},
                    "https://www.newyorkfed.org/survey/empire/empiresurvey_overview")
        if "reverserepo results" in pid:
            return ("Federal Reserve Bank of New York", "nyfed",
                    {"path": "/api/rp/reverserepo/all/results/search.json", "field": "awardRate", "field_verified": False},
                    "https://www.newyorkfed.org/markets/desk-operations/reverse-repo")
        return ("Federal Reserve Bank of New York", "regional_fed_file",
                {"bank": "nyfed", "file": _clean(pid)}, "https://www.newyorkfed.org/")
    if auth.startswith("U.S. Treasury (TIC)"):
        return ("U.S. Department of the Treasury", "treasury_tic", {"file": "mfh.txt", "row": "Grand Total"},
                "https://home.treasury.gov/data/treasury-international-capital-tic-system")
    if auth.startswith("U.S. Treasury, Bureau of the Fiscal Service"):
        ep, _, rest = pid.partition(" : ")
        p: dict = {"endpoint": ep.strip()}
        if sym == "USTGA":
            p.update(field="open_today_bal",
                     filter={"account_type": "Treasury General Account (TGA) Closing Balance"},
                     note="Closing Balance row carries its value in open_today_bal; pre-Oct-2022 labels differ")
        elif ep.strip().endswith("mts_table_1"):
            field = rest.split(" ")[0]
            p.update(field=field, filter={"record_type_cd": "MTH"}, row_key="classification_desc")
        elif ep.strip().endswith("mts_table_5"):
            p.update(field="current_month_gross_outly_amt",
                     filter={"classification_desc": "Interest on Treasury Debt Securities (Gross)"}, field_verified=False)
        else:
            p.update(field=rest.strip())
        slug = {"debt_to_penny": "debt-to-the-penny", "operating_cash_balance": "daily-treasury-statement"}
        tail = ep.strip().split("/")[-1]
        return ("U.S. Treasury, Bureau of the Fiscal Service", "fiscaldata", p,
                f"https://fiscaldata.treasury.gov/datasets/{slug.get(tail, 'monthly-treasury-statement')}/")
    if auth == "EIA":
        return ("U.S. Energy Information Administration", "eia", {"series_id": _clean(pid)},
                "https://www.eia.gov/petroleum/supply/weekly/" if pid.startswith("PET") else
                "https://ir.eia.gov/ngs/ngs.html")
    if auth == "Federal Housing Finance Agency":
        return ("Federal Housing Finance Agency", "fhfa",
                {"file": "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv",
                 "filter": {"hpi_type": "traditional", "hpi_flavor": "purchase-only", "frequency": "monthly",
                            "level": "USA or Census Division", "place_id": "USA"},
                 "column": "index_sa"},
                "https://www.fhfa.gov/data/hpi")
    if auth == "Freddie Mac":
        return ("Freddie Mac", "freddie", {"file": "https://www.freddiemac.com/pmms/docs/PMMS_history.csv", "column": "pmms30"},
                "https://www.freddiemac.com/pmms")
    if auth.startswith("Federal Reserve Bank of"):
        bank = {"Cleveland": "cleveland", "Dallas": "dallas", "Atlanta": "atlanta", "Philadelphia": "philly",
                "Richmond": "richmond", "Kansas City": "kc", "Chicago": "chicago"}[auth.replace("Federal Reserve Bank of ", "")]
        return (auth, "regional_fed_file", {"bank": bank, "file": _clean(pid), "column_verified": False}, "")
    raise ValueError(f"{sym}: no source mapping for {auth!r}")

# ------------------------------------------------------------------ licensing

ATTRIBUTION_BY_ADAPTER_AGENCY = {
    "bls": "bls", "bea": "bea", "census": "census", "fed_ddp": "fed_board", "fed_policy": "fed_board",
    "nyfed": "nyfed", "nyfed_esms": "nyfed", "fiscaldata": "fiscaldata", "eia": "eia", "dol": "dol",
    "fhfa": "fhfa", "treasury_tic": "treasury", "treasury_curve": "treasury", "freddie": "freddie",
}
NOTICE_REQUIRED_KEYS = {"bls", "bea", "census", "fhfa", "nyfed", "nyfed_sce", "eia", "cleveland"}


def licensing_for(row: dict, adapter: str, params: dict, parents: list[dict]) -> dict:
    rs = row["redistribution_status"]
    cls = "RED" if rs.startswith("RED") else "YELLOW" if rs.startswith("YELLOW") else "GREEN"
    clearance = {"GREEN": "cleared", "YELLOW": "permission_pending", "RED": "blocked"}[cls]
    if adapter == "derived":
        keys = []
        # notice-required parents first: attribution_key is the one a single-line
        # source note must carry; attribution_keys lists every contributor.
        for p in sorted(parents, key=lambda p: not p["licensing"]["notice_required"]):
            k = p["licensing"]["attribution_key"]
            if k and k not in keys:
                keys.append(k)
        key = keys[0] if keys else None
        notice = any(p["licensing"]["notice_required"] for p in parents)
        out = {"class": cls, "clearance": clearance, "attribution_key": key, "notice_required": notice,
               "approval_ref": None, "source_line": row["attribution"], "redistribution_note": rs}
        if len(keys) > 1:
            out["attribution_keys"] = keys
        return out
    if adapter == "proprietary":
        key = None
    elif adapter == "regional_fed_file":
        key = params["bank"] if params["bank"] != "nyfed" else ("nyfed_sce" if "SCE" in row["provider_series_id"] else "nyfed")
    else:
        key = ATTRIBUTION_BY_ADAPTER_AGENCY[adapter]
    return {"class": cls, "clearance": clearance, "attribution_key": key,
            "notice_required": key in NOTICE_REQUIRED_KEYS, "approval_ref": None,
            "source_line": row["attribution"], "redistribution_note": rs}

# ------------------------------------------------------------------ release / lag rules
# lag_rule = the CONSERVATIVE (late-side) backfill availability rule. Late is safe;
# early is a PIT violation. kinds:
#   period_end_plus_days     available = period_end + days, at time_et
#   period_start_plus_days   survey released inside its own month (ESMS)
#   business_days_after      available = period_end + N business days, at time_et
#   derived                  available = max(input available_at) (derive.py)
#   unknown                  no rule -> backfill must not claim PIT (class X/L only)
# Lapse-in-appropriations delays (e.g. Oct-2013, Oct/Nov-2025) exceed every
# calendar rule below; store/backfill must prefer an archived release calendar
# over the rule wherever one exists.

def _r(kind, days, time_et, basis):
    return {"kind": kind, "days": days, "time_et": time_et, "basis": basis}

LAG_RULES = {
    "bls:cpi": _r("period_end_plus_days", 25, "08:30", "CPI ~10th-15th of next month; 1980s releases ran to the ~25th"),
    "bls:ppi": _r("period_end_plus_days", 25, "08:30", "PPI ~day after CPI"),
    "bls:mxp": _r("period_end_plus_days", 25, "08:30", "import/export prices mid-month"),
    "bls:eci": _r("period_end_plus_days", 35, "08:30", "ECI ~last business day of month after quarter"),
    "bls:prod": _r("period_end_plus_days", 40, "08:30", "Productivity prelim ~5 weeks after quarter"),
    "bls:empsit": _r("period_end_plus_days", 12, "08:30", "Employment Situation usually 1st Friday; occasionally the 2nd week"),
    "bls:jolts": _r("period_end_plus_days", 45, "10:00", "JOLTS ~5-6 weeks after reference month"),
    "dol:claims": _r("period_end_plus_days", 6, "08:30", "Thursday after week ending Saturday (Wed/Fri on holidays)"),
    "dol:claims_continued": _r("period_end_plus_days", 13, "08:30", "continued claims carry a 1-week extra lag"),
    "bea:gdp": _r("period_end_plus_days", 32, "08:30", "GDP advance ~30 days after quarter end"),
    "bea:gdp_second": _r("period_end_plus_days", 62, "08:30", "second estimate ~60 days after quarter (GDI)"),
    "bea:gdp_third": _r("period_end_plus_days", 92, "08:30", "third estimate ~90 days (corporate profits Q4)"),
    "bea:pio": _r("period_end_plus_days", 35, "08:30", "Personal Income & Outlays ~last week of next month"),
    "bea:ita": _r("period_end_plus_days", 85, "08:30", "current account ~80 days after quarter"),
    "bea:vehicles": _r("period_end_plus_days", 10, None, "supplemental xlsx early month; time not fixed"),
    "census:marts": _r("period_end_plus_days", 20, "08:30", "advance retail ~15th"),
    "census:resconst": _r("period_end_plus_days", 22, "08:30", "New Residential Construction ~12th business day"),
    "census:ressales": _r("period_end_plus_days", 28, "10:00", "New Residential Sales ~17th business day"),
    "census:vip": _r("period_end_plus_days", 35, "10:00", "construction spending 1st business day, ~2-month lag"),
    "census:m3adv": _r("period_end_plus_days", 30, "08:30", "advance durable goods ~4th week"),
    "census:m3": _r("period_end_plus_days", 40, "10:00", "full M3 factory orders ~1 week after advance"),
    "census:mtis": _r("period_end_plus_days", 50, "10:00", "business inventories mid-month, 2-month lag"),
    "census:mwts": _r("period_end_plus_days", 45, "10:00", "full wholesale ~2nd week of 2nd month"),
    "census:ft900": _r("period_end_plus_days", 42, "08:30", "FT-900 ~5 weeks after reference month"),
    "fed:h15": _r("business_days_after", 1, "16:15", "H.15 daily update next business day ~16:15"),
    "fed:h41": _r("period_end_plus_days", 2, "16:30", "Thursday 16:30 for Wednesday level (Friday on holidays)"),
    "fed:h8": _r("period_end_plus_days", 5, "16:15", "Friday for week ending Wednesday; holiday weeks slip to Monday"),
    "fed:h6": _r("period_end_plus_days", 30, "13:00", "H.6 ~4th Tuesday of next month"),
    "fed:g19": _r("period_end_plus_days", 42, "15:00", "G.19 ~5th business day, 2-month lag"),
    "fed:g17": _r("period_end_plus_days", 20, "09:15", "G.17 mid-month"),
    "fed:h10": _r("period_end_plus_days", 10, "16:15", "H.10 weekly (Monday), daily data"),
    "fed:policy": _r("period_end_plus_days", 0, "14:00", "administered rate: announced at/before the FOMC decision; effective-date placement is late-safe"),
    "nyfed:effr": _r("business_days_after", 1, "11:00", "EFFR/target published next business day ~09:00 (11:00 = late bound)"),
    "nyfed:sofr": _r("business_days_after", 1, "10:00", "SOFR next business day ~08:00 (10:00 = late bound)"),
    "nyfed:obfr": _r("business_days_after", 1, "11:00", "OBFR next business day ~09:00"),
    "nyfed:rrp": _r("period_end_plus_days", 0, "14:00", "ON RRP results same day ~13:15 (op window 12:45-13:15)"),
    "nyfed:esms": _r("period_start_plus_days", 17, "08:30", "Empire survey released ~15th of the SAME month"),
    "nyfed:sce": _r("period_end_plus_days", 20, "11:00", "SCE ~2nd week of next month (time unverified)"),
    "nyfed:gscpi": _r("period_end_plus_days", 10, None, "GSCPI ~4th business day of next month"),
    "treasury:tic": _r("period_end_plus_days", 50, "16:00", "TIC ~18th, 2-month lag"),
    "fiscal:dtp": _r("business_days_after", 1, "17:00", "Debt to the Penny next business day ~15:00-16:00"),
    "fiscal:dts": _r("business_days_after", 1, "17:00", "Daily Treasury Statement next business day ~16:00"),
    "fiscal:mts": _r("period_end_plus_days", 15, "14:00", "MTS 8th business day"),
    "eia:wpsr": _r("period_end_plus_days", 6, "11:00", "WPSR Wednesday 10:30 for week ending Friday; Thursday 11:00 after holidays"),
    "eia:ngs": _r("period_end_plus_days", 7, "10:30", "natural gas storage Thursday 10:30 for week ending Friday"),
    "eia:gasdiesel": _r("period_end_plus_days", 1, "17:00", "Monday survey released Monday ~17:00 (Tuesday on holidays)"),
    "eia:spot": _r("period_end_plus_days", 10, None, "daily spot prices with ~1-week lag"),
    "fhfa:hpi_monthly": _r("period_end_plus_days", 62, "09:00", "FHFA monthly HPI last Tuesday, 2-month lag"),
    "freddie:pmms": _r("period_end_plus_days", 1, "12:00", "PMMS Thursday 12:00"),
}
REGIONAL_LAG = _r("unknown", None, None, "regional file; release rule not established in Phase 0")


def calendar_key_for(row: dict, adapter: str, params: dict) -> str:
    sym, ds = row["uct_symbol"], row["source_dataset"]
    if adapter == "bls":
        for k, v in (("CPI", "bls:cpi"), ("PPI", "bls:ppi"), ("MXP", "bls:mxp"), ("ECI", "bls:eci"),
                     ("Productivity", "bls:prod"), ("Employment Situation", "bls:empsit"), ("JOLTS", "bls:jolts")):
            if ds.startswith(k):
                return v
    if adapter == "dol":
        return "dol:claims"
    if adapter == "bea":
        if params.get("dataset") == "ITA":
            return "bea:ita"
        if params.get("dataset") == "supplemental":
            return "bea:vehicles"
        return "bea:gdp" if params["frequency"] == "Q" else "bea:pio"
    if adapter == "census":
        prog = params["program"]
        if prog == "m3":
            return "census:m3" if sym == "USFACTORD" else "census:m3adv"
        return {"marts": "census:marts", "resconst": "census:resconst", "ressales": "census:ressales",
                "vip": "census:vip", "mtis": "census:mtis", "mwts": "census:mwts", "ftd": "census:ft900"}[prog]
    if adapter == "fed_ddp":
        return "fed:" + params["release"].lower()
    if adapter == "fed_policy":
        return "fed:policy"
    if adapter == "nyfed":
        path = params["path"]
        if "effr" in path:
            return "nyfed:effr"
        if "sofr" in path:
            return "nyfed:sofr"
        if "obfr" in path:
            return "nyfed:obfr"
        return "nyfed:rrp"
    if adapter == "nyfed_esms":
        return "nyfed:esms"
    if adapter == "regional_fed_file":
        if params["bank"] == "nyfed":
            return "nyfed:gscpi" if "GSCPI" in row["provider_series_id"] else "nyfed:sce"
        return f"{params['bank']}:{re.sub(r'[^a-z0-9]+', '_', ds.lower()).strip('_')[:24]}"
    if adapter == "treasury_tic":
        return "treasury:tic"
    if adapter == "fiscaldata":
        ep = params["endpoint"]
        return "fiscal:dtp" if "debt_to_penny" in ep else "fiscal:dts" if "dts" in ep else "fiscal:mts"
    if adapter == "eia":
        sid = params["series_id"]
        if sid.startswith("NG."):
            return "eia:ngs"
        if "EMM_" in sid or "EMD_" in sid:
            return "eia:gasdiesel"
        if sid.endswith(".D"):
            return "eia:spot"
        return "eia:wpsr"
    if adapter == "fhfa":
        return "fhfa:hpi_monthly"
    if adapter == "freddie":
        return "freddie:pmms"
    if adapter == "proprietary":
        return "proprietary:" + re.sub(r"[^a-z0-9]+", "_", row["authoritative_source"].lower()).strip("_")[:32]
    raise ValueError(f"{sym}: no calendar key for adapter {adapter}")


LAG_OVERRIDES = {"USCCSA": "dol:claims_continued", "USGDI": "bea:gdp_second", "USCORPPROF": "bea:gdp_third"}


def parse_time(raw: str) -> tuple[str | None, str, str]:
    """-> (typical_time_et | None, precision_hint, note). Never invents a time."""
    s = raw.strip()
    note = s
    s2 = s.replace("(+compute)", "").strip()
    if not s2 or "?" in s2 or "varies" in s2:
        return None, "unknown", note
    if s2.startswith("~"):
        return None, "rule", note
    m = re.match(r"^(\d{2}:\d{2})\b(.*)$", s2)
    if not m:
        return None, "unknown", note
    rest = m.group(2).strip()
    if rest and "FOMC" not in rest and "GDP day" not in rest:
        return None, "rule", note
    return m.group(1), "exact", note if rest or "(+compute)" in s else ""

# ------------------------------------------------------------------ text helpers

def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def short_name(name: str) -> str:
    """Drop a trailing parenthetical qualifier ('(SA)', '(DTS)', ...). Never truncates mid-word."""
    s = re.sub(r"\s*\([^()]*\)\s*$", "", name).strip()
    return s or name


def describe(row: dict, deriv: dict | None, agency: str) -> str:
    name = row["name"]
    if deriv:
        return (f"{name}. UCT calculation: {deriv['op']}({', '.join(deriv['inputs'])}) "
                f"from {row['authoritative_source'].replace('UCT-derived from ', '')} data.")
    return f"{name}. Source: {agency}, {row['source_dataset']}."

# ------------------------------------------------------------------ main build

def build(rows: list[dict]) -> list[dict]:
    by_sym = {r["uct_symbol"]: r for r in rows}
    order = [r["uct_symbol"] for r in rows]
    out: dict[str, dict] = {}

    def verified_base(r: dict) -> tuple[bool, str]:
        sym = r["uct_symbol"]
        if sym in VERIFY_OVERRIDES:
            v, ev, _ = VERIFY_OVERRIDES[sym]
            return v, ev
        if r["redistribution_status"].startswith("RED"):
            return False, "proprietary; not ingested"
        if sym in CATALOG_UNVERIFIED:
            return False, "catalog_notes.md lists this provider id as unverified"
        notes = r["notes"]
        has_q = "?" in notes or "?" in r["provider_series_id"]
        if has_q and sym not in QMARK_NOT_IDENTITY:
            return False, "catalog notes/provider id carry an identity '?'"
        phrase = next((p for p in VERIFY_PHRASES if p in notes), None)
        if not phrase:
            return False, "no live-verification evidence in the catalog"
        return True, f"Phase 0 catalog (2026-09-28): '{phrase}'"

    def build_one(sym: str, stack=()) -> dict:
        if sym in out:
            return out[sym]
        if sym in stack:
            raise ValueError(f"derivation cycle through {sym}")
        r = by_sym[sym]
        freq, anchor = parse_frequency(r["frequency"], sym, r["derivation"])
        deriv, dproblems = parse_derivation(r["derivation"], freq)
        parents = []
        if deriv:
            for inp in deriv["inputs"]:
                if inp not in by_sym:
                    dproblems.append(f"derivation input {inp} not in catalog")
                else:
                    parents.append(build_one(inp, stack + (sym,)))
        agency, adapter, params, url = source_for(r)
        if deriv:
            agency = "UCT (derived from " + r["authoritative_source"].replace("UCT-derived from ", "") + ")"
        if sym in VERIFY_OVERRIDES and VERIFY_OVERRIDES[sym][2]:
            params.update(VERIFY_OVERRIDES[sym][2])
        if deriv:
            verified = not dproblems and all(p["source"]["verified"] for p in parents)
            evidence = ("all inputs verified: " + ", ".join(deriv["inputs"])) if verified else \
                "; ".join(dproblems or ["input(s) unverified: " + ", ".join(
                    p["symbol"] for p in parents if not p["source"]["verified"])])
        else:
            verified, evidence = verified_base(r)
        derived_pct = bool(deriv) and deriv["op"] in ("yoy_pct", "mom_pct", "pct_change")
        units = parse_units(r["units"], r, derived_pct or r["units"].strip() == "Percent" and sym.endswith(("YOY", "MOM")))
        if sym == "USDEBTGDP" and deriv:
            # USDEBT is in USD (scale 1), USGDP in billions USD SAAR (scale 1e9): 100 * a / (b * 1e9)
            deriv["params"]["scale"] = 100.0 / 1e9
            deriv["params"]["scale_note"] = "100 * USD / (billions USD * 1e9) -> percent of GDP"
        lic = licensing_for(r, adapter, params, parents)
        cls = lic["class"]
        cohort = r["recommended_v1"] == "COHORT" or sym in COHORT_PARENTS
        if cls == "RED":
            status = "excluded"
        elif cohort:
            status = "enabled" if (verified and cls == "GREEN") else "unverified"
        else:
            status = "disabled" if verified else "unverified"
        if sym == "USICSA":
            status = "disabled"
        if cohort and status == "enabled" and deriv:
            status = "enabled" if all(p["status"] == "enabled" for p in parents) else "unverified"
        rev = r["revision_type"].strip()
        if deriv:
            # the parent at the derived series' own frequency sets the release
            # (USDEBTGDP publishes on GDP day, not on a Debt-to-the-Penny day)
            same = [p for p in parents if p["frequency"] == freq]
            calendar_key = (same or parents)[0]["release"]["calendar_key"] if parents else "derived"
            lag = _r("derived", None, None, "available_at = max(input available_at)")
        else:
            calendar_key = calendar_key_for(r, adapter, params)
            lag = LAG_RULES.get(LAG_OVERRIDES.get(sym, calendar_key))
            if lag is None:
                lag = REGIONAL_LAG if adapter in ("regional_fed_file", "nyfed_esms", "freddie", "treasury_tic") \
                    else _r("unknown", None, None, "no rule")
            lag = dict(lag)
        t, prec, tnote = parse_time(r["typical_release_time_et"])
        syns = []
        for a in r["search_aliases"].split("|"):
            a = _norm(a)
            if a and a not in syns:
                syns.append(a)
        aliases = [sym.lower()]
        pid_alias = params.get("series_id") or params.get("series_code") or params.get("series")
        if pid_alias and adapter in ("bls", "bea", "fed_ddp", "eia"):
            pa = pid_alias.lower()
            if pa not in aliases:
                aliases.append(pa)
        syns = [s for s in syns if s not in aliases]
        notes = []
        if sym in STATUS_NOTES:
            notes.append(STATUS_NOTES[sym])
        if dproblems:
            notes.append("derivation: " + "; ".join(dproblems))
        if sym == "USMTSDEF":
            notes.append("sign convention: FiscalData reports the deficit as a positive amount in some rows -- validate.py must pin the sign")
        entry = {
            "symbol": sym,
            "name": r["name"],
            "short_name": short_name(r["name"]),
            "description": describe(r, deriv, agency),
            "category": r["category"],
            "subcategory": r["subcategory"],
            "country": "US",
            "role": "support" if sym in QA_TWINS else "member",
            "status": status,
            "cohort": cohort,
            "source": {
                "agency": agency,
                "dataset": r["source_dataset"],
                "provider_series_id": r["provider_series_id"],
                "adapter": adapter,
                "params": params,
                "official_url": url,
                "verified": bool(verified),
                "verified_evidence": evidence,
            },
            "frequency": freq,
            "week_anchor": anchor,
            "units": units,
            "seasonal_adjustment": parse_sa(r["seasonal_adjustment"], r["units"]),
            "history_start": r["historical_start"],
            "release": {
                "calendar_key": calendar_key,
                "cadence": r["release_cadence"],
                "typical_time_et": t,
                "typical_time_note": tnote,
                "precision_hint": prec,
                "lag_rule": lag,
            },
            "revision": {"type": rev},
            "pit": {"backfill_class": "U" if rev == "none" else "L", "catalog_note": r["pit_possible"]},
            "derivation": deriv,
            "licensing": lic,
            "aliases": aliases,
            "synonyms": syns,
            "presentation": {"style": r["default_presentation"].strip()},
            "notes": notes,
            "catalog_row": {k: r[k] for k in ("recommended_v1", "fred_equivalent", "acquisition_method",
                                              "estimated_cost", "notes", "derivation", "frequency",
                                              "seasonal_adjustment", "typical_release_time_et")},
        }
        if r["uct_symbol"] in ("USPPIYOY",):
            entry["seasonal_adjustment"] = "NSA-based"
        out[sym] = entry
        return entry

    for sym in order:
        build_one(sym)
    # a short name must still tell twins apart (USCPI vs USCPINSA): where
    # dropping the parenthetical makes two short names equal, keep full names.
    from collections import Counter
    counts = Counter(e["short_name"] for e in out.values())
    for e in out.values():
        if counts[e["short_name"]] > 1:
            e["short_name"] = e["name"]
    return [out[s] for s in order]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("csv", nargs="?", default=str(DEFAULT_CSV))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    a = ap.parse_args(argv)
    with open(a.csv, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    entries = build(rows)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(entries, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    from collections import Counter
    print(f"wrote {len(entries)} entries -> {a.out}")
    print("status:", dict(Counter(e["status"] for e in entries)))
    print("cohort:", sum(e["cohort"] for e in entries))
    return 0


if __name__ == "__main__":
    sys.exit(main())
