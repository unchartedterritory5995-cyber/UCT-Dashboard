"""Build the econ harness fixtures from the Phase 0 proof captures.

Run:  python app/src/econHarness/fixtures/build_fixtures.py [PROOFS_DIR]
      (default PROOFS_DIR = C:/Users/blake/uct-econ-phase0/proofs)

Every payload has the Member API shape of docs/economic-data/PHASE1-DESIGN.md
(`/api/econ/series/{symbol}`) plus a `_provenance` block saying exactly where each
number came from. AVAILABLE-AT for backfilled rows follows a conservative lag
RULE (`available_method: rule`) -- NOT a real release calendar -- and is labelled
so. Anything not from a proof file is marked TRANSCRIBED or SYNTHETIC.
"""
import datetime as dt
import json
import os
import random
import re
import sys
from zoneinfo import ZoneInfo

import xlrd

ET = ZoneInfo("America/New_York")
PROOFS = sys.argv[1] if len(sys.argv) > 1 else "C:/Users/blake/uct-econ-phase0/proofs"
OUT = os.path.dirname(os.path.abspath(__file__))


def et_unix(d, hh, mm):
    return int(dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).timestamp())


def iso(d):
    return d.isoformat()


def month_bounds(y, m):
    start = dt.date(y, m, 1)
    end = dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)
    return start, end


def next_bday(d):
    d = d + dt.timedelta(days=1)
    while d.weekday() >= 5:
        d += dt.timedelta(days=1)
    return d


def first_friday_after(d):
    x = d + dt.timedelta(days=1)
    while x.weekday() != 4:
        x += dt.timedelta(days=1)
    return x


def payload(meta, points, provenance):
    points.sort(key=lambda p: (p[0], p[3]))
    return {
        "id": f"ECON:{meta['symbol']}", "symbol": meta["symbol"], "view": "latest", "asof": None,
        "meta": meta,
        # fixtures are not live: no calendar knowledge -> NO_EXPECTATION (never CURRENT)
        "currentness": {"state": "NO_EXPECTATION", "latest_period": points[-1][3] if points else None,
                        "expected_period": None, "next_release": None},
        "columns": ["t", "v", "ps", "pe", "pit"],
        "points": points,
        "_provenance": provenance,
    }


def meta_row(symbol, name, short, freq, units, fmt, scale, style, agency, category, week_anchor=""):
    return {"symbol": symbol, "id": f"ECON:{symbol}", "name": name, "short_name": short, "description": name,
            "category": category, "subcategory": "", "frequency": freq, "week_anchor": week_anchor,
            "units": {"display": units, "fmt": fmt, "scale": scale}, "seasonal_adjustment": "SA",
            "presentation": {"style": style},
            "source": {"agency": agency, "dataset": "", "official_url": "", "attribution_key": agency.lower()},
            "aliases": [], "synonyms": [], "history_start": None}


def bls_series(fname, sid):
    d = json.load(open(os.path.join(PROOFS, fname)))
    for s in d["Results"]["series"]:
        if s["seriesID"] == sid:
            rows = []
            for x in s["data"]:
                v = None if x["value"] in ("-", "") else float(x["value"])
                rows.append((int(x["year"]), int(x["period"][1:]), v))
            return sorted(rows)
    raise KeyError(sid)


out = {}
catalog = []

# ── USCPI: BLS CUSR0000SA0 (SA), proofs/bls_v1_latest.json, 2024-01..2026-08 ──
m = meta_row("USCPI", "CPI-U All Items (SA)", "CPI", "M", "Index 1982-84=100", "num2", 1, "line", "BLS", "Inflation & Prices")
pts = []
for y, mo, v in bls_series("bls_v1_latest.json", "CUSR0000SA0"):
    ps, pe = month_bounds(y, mo)
    pts.append([et_unix(pe + dt.timedelta(days=15), 8, 30), v, iso(ps), iso(pe), "L"])
out["USCPI"] = payload(m, pts, {
    "values": "REAL - proofs/bls_v1_latest.json CUSR0000SA0 (BLS v1). Oct 2025 is BLS '-' (code X, appropriations lapse) -> v=null",
    "available_at": "RULE (design backfill rule): period_end + 15 days 08:30 ET - not the real BLS calendar"})
catalog.append(m)

# ── USNFPCHG: month-over-month diff of BLS CES0000000001 (proofs/bls_v1.json) ──
m = meta_row("USNFPCHG", "Nonfarm Payrolls, monthly change", "NFP chg", "M", "Thousands of jobs", "k_persons", 1000, "histogram", "BLS", "Employment")
lv = bls_series("bls_v1.json", "CES0000000001")
pts = []
for (_y0, _m0, v0), (y, mo, v) in zip(lv, lv[1:]):
    ps, pe = month_bounds(y, mo)
    val = None if v is None or v0 is None else round(v - v0, 1)
    pts.append([et_unix(first_friday_after(pe), 8, 30), val, iso(ps), iso(pe), "L"])
out["USNFPCHG"] = payload(m, pts, {
    "values": "REAL-DERIVED - month-over-month difference of proofs/bls_v1.json CES0000000001 levels (thousands)",
    "available_at": "RULE: first Friday after period_end, 08:30 ET"})
catalog.append(m)

# ── Fed funds target range (IRREG step) ──
# (announce_date, (hh, mm) ET, effective_date, lower, upper)
FOMC = [
    ("2019-07-31", (14, 0), "2019-08-01", 2.00, 2.25), ("2019-09-18", (14, 0), "2019-09-19", 1.75, 2.00),
    ("2019-10-30", (14, 0), "2019-10-31", 1.50, 1.75), ("2020-03-03", (10, 0), "2020-03-04", 1.00, 1.25),
    ("2020-03-15", (17, 0), "2020-03-16", 0.00, 0.25), ("2022-03-16", (14, 0), "2022-03-17", 0.25, 0.50),
    ("2022-05-04", (14, 0), "2022-05-05", 0.75, 1.00), ("2022-06-15", (14, 0), "2022-06-16", 1.50, 1.75),
    ("2022-07-27", (14, 0), "2022-07-28", 2.25, 2.50), ("2022-09-21", (14, 0), "2022-09-22", 3.00, 3.25),
    ("2022-11-02", (14, 0), "2022-11-03", 3.75, 4.00), ("2022-12-14", (14, 0), "2022-12-15", 4.25, 4.50),
    ("2023-02-01", (14, 0), "2023-02-02", 4.50, 4.75), ("2023-03-22", (14, 0), "2023-03-23", 4.75, 5.00),
    ("2023-05-03", (14, 0), "2023-05-04", 5.00, 5.25), ("2023-07-26", (14, 0), "2023-07-27", 5.25, 5.50),
    ("2024-09-18", (14, 0), "2024-09-19", 4.75, 5.00), ("2024-11-07", (14, 0), "2024-11-08", 4.50, 4.75),
    ("2024-12-18", (14, 0), "2024-12-19", 4.25, 4.50), ("2025-09-17", (14, 0), "2025-09-18", 4.00, 4.25),
    ("2025-10-29", (14, 0), "2025-10-30", 3.75, 4.00), ("2025-12-10", (14, 0), "2025-12-11", 3.50, 3.75),
    # PROOF: nyfed_effr_aug.json (Aug 2026 = 3.50-3.75) and nyfed_rates_unsecured_effr_last_5.json
    # (3.75-4.00 from 2026-09-17; EFFR 3.63 -> 3.88 in fed_h15_RIFSPFF_sample.xml)
    ("2026-09-16", (14, 0), "2026-09-17", 3.75, 4.00),
]
for sym, upper, name in (("USFEDFUNDSU", True, "Fed Funds Target Range - Upper"),
                         ("USFEDFUNDSL", False, "Fed Funds Target Range - Lower")):
    m = meta_row(sym, name, "FF upper" if upper else "FF lower", "IRREG", "Percent", "pct2", 1, "step", "NYFED", "Rates")
    pts = []
    for ann, (hh, mm), eff, lo, up in FOMC:
        pts.append([et_unix(dt.date.fromisoformat(ann), hh, mm), up if upper else lo, eff, eff, "V"])
    out[sym] = payload(m, pts, {
        "values": "TRANSCRIBED - public FOMC decision record (agent-transcribed, NOT a proof file) 2019-2025; "
                  "the 2026-09-16 hike and the Aug-2026 3.50-3.75 level are from proofs (nyfed_*). "
                  "Assumes no 2026 change before September (consistent with the Aug-2026 proof).",
        "available_at": "FOMC statement time on the decision day (14:00 ET; intermeeting moves at their stated time)"})
    catalog.append(m)

# ── USEFFR daily: NY Fed EFFR, Aug-Sep 2026 ──
m = meta_row("USEFFR", "Effective Federal Funds Rate", "EFFR", "D", "Percent", "pct2", 1, "line", "NYFED", "Rates")
rows = {}
for f in ("nyfed_effr_aug.json", "nyfed_rates_unsecured_effr_last_5.json"):
    for r in json.load(open(os.path.join(PROOFS, f)))["refRates"]:
        rows[r["effectiveDate"]] = r["percentRate"]
xml = open(os.path.join(PROOFS, "fed_h15_RIFSPFF_sample.xml"), encoding="utf-8").read()
for v, d in re.findall(r'OBS_VALUE="([-0-9.]+)" TIME_PERIOD="(2026-[0-9-]+)"', xml):
    if float(v) > -9000:
        rows.setdefault(d, float(v))
pts = []
for d, v in sorted(rows.items()):
    pts.append([et_unix(next_bday(dt.date.fromisoformat(d)), 9, 0), v, d, d, "V"])
out["USEFFR"] = payload(m, pts, {
    "values": "REAL - proofs/nyfed_effr_aug.json + nyfed_rates_unsecured_effr_last_5.json + fed_h15_RIFSPFF_sample.xml (2026 rows)",
    "available_at": "RULE: next business day 09:00 ET (NY Fed publication; holidays ignored)"})
catalog.append(m)

# ── USCRUDEINV weekly: EIA WCESTUS1 (thousand bbl), 1982-2026 ──
m = meta_row("USCRUDEINV", "U.S. Crude Oil Stocks ex SPR", "Crude stocks", "W", "Thousand barrels", "mbbl", 1000, "line", "EIA", "Energy", "FRI")
sh = xlrd.open_workbook(os.path.join(PROOFS, "eia_WCESTUS1w.xls")).sheet_by_name("Data 1")
pts = []
for r in range(3, sh.nrows):
    serial, v = sh.row_values(r)[:2]
    if not isinstance(serial, float) or v in ("", None):
        continue
    pe = dt.date(1899, 12, 30) + dt.timedelta(days=int(serial))
    pts.append([et_unix(pe + dt.timedelta(days=5), 10, 30), float(v), iso(pe - dt.timedelta(days=6)), iso(pe), "L"])
out["USCRUDEINV"] = payload(m, pts, {
    "values": "REAL - proofs/eia_WCESTUS1w.xls 'Data 1' (weekly ending stocks ex SPR, thousand barrels)",
    "available_at": "RULE: week-ending Friday + 5 days (Wednesday) 10:30 ET - holiday shifts ignored"})
catalog.append(m)

# ── USICSA weekly: DOL initial claims SA, 2026 ──
m = meta_row("USICSA", "Initial Jobless Claims (SA)", "Init claims", "W", "Number of claims", "k_persons", 1, "line", "DOL", "Employment", "SAT")
xml = open(os.path.join(PROOFS, "dol_claims_2026.xml"), encoding="utf-8").read()
pts = []
for wk, body in re.findall(r"<weekEnded>([^<]+)</weekEnded>\s*<InitialClaims>(.*?)</InitialClaims>", xml, re.S):
    sa = re.search(r"<SA>([^<]*)</SA>", body).group(1).replace(",", "").strip()
    if not re.fullmatch(r"[0-9.]+", sa or ""):
        continue
    mo, dd, yy = map(int, wk.split("/"))
    pe = dt.date(yy, mo, dd)
    pts.append([et_unix(pe + dt.timedelta(days=5), 8, 30), float(sa), iso(pe - dt.timedelta(days=6)), iso(pe), "L"])
out["USICSA"] = payload(m, pts, {
    "values": "REAL - proofs/dol_claims_2026.xml InitialClaims/SA",
    "available_at": "RULE: week-ending Saturday + 5 days (Thursday) 08:30 ET"})
catalog.append(m)

# ── USRGDPQA quarterly: SAAR growth computed from BEA A191RX levels ──
m = meta_row("USRGDPQA", "Real GDP, % change annualized", "GDP q/q ann.", "Q", "Percent, annualized", "pct1", 1, "histogram", "BEA", "Output")
lv = []
for line in open(os.path.join(PROOFS, "bea_nipaq_sample.txt"), encoding="utf-8"):
    mm = re.match(r'A191RX,(\d{4})Q(\d),"([0-9,]+)"', line.strip())
    if mm:
        lv.append((int(mm.group(1)), int(mm.group(2)), float(mm.group(3).replace(",", ""))))
pts = []
for (_y0, _q0, v0), (y, q, v) in zip(lv, lv[1:]):
    ps = dt.date(y, 3 * q - 2, 1)
    _, pe = month_bounds(y, 3 * q)
    pts.append([et_unix(pe + dt.timedelta(days=30), 8, 30), round(((v / v0) ** 4 - 1) * 100, 1), iso(ps), iso(pe), "L"])
out["USRGDPQA"] = payload(m, pts, {
    "values": "REAL-DERIVED - annualized q/q growth computed from proofs/bea_nipaq_sample.txt A191RX levels "
              "(BEA's published A191RL may differ by rounding)",
    "available_at": "RULE: quarter end + 30 days 08:30 ET (advance-estimate lag) - not the BEA calendar"})
catalog.append(m)

# ── SYNTHETIC host bars (SPY-like) - NOT market data ──
rnd = random.Random(20260928)
day = dt.date(2024, 1, 2)
px = 470.0
daily = []
while day <= dt.date(2026, 9, 25):
    if day.weekday() < 5:
        o = px
        c = max(1.0, o * (1 + rnd.gauss(0.0004, 0.009)))
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.004)))
        low = min(o, c) * (1 - abs(rnd.gauss(0, 0.004)))
        daily.append({"t": iso(day), "o": round(o, 2), "h": round(h, 2), "l": round(low, 2), "c": round(c, 2),
                      "v": rnd.randint(40, 120) * 1_000_000})
        px = c
    day += dt.timedelta(days=1)
weekly = []
for bar in daily:
    d = dt.date.fromisoformat(bar["t"])
    wk = iso(d - dt.timedelta(days=d.weekday()))
    if weekly and weekly[-1]["t"] == wk:
        w = weekly[-1]
        w["h"] = max(w["h"], bar["h"]); w["l"] = min(w["l"], bar["l"]); w["c"] = bar["c"]; w["v"] += bar["v"]
    else:
        weekly.append({**bar, "t": wk})
intraday = []
px = daily[-1]["c"]
d = dt.date(2026, 9, 10)
while d <= dt.date(2026, 9, 17):
    if d.weekday() < 5:
        t0 = et_unix(d, 4, 0)
        for k in range(16 * 12):          # 04:00 -> 20:00 ET, 5-minute bars
            o = px
            c = max(1.0, o * (1 + rnd.gauss(0, 0.0012)))
            intraday.append({"t": t0 + k * 300, "o": round(o, 2), "h": round(max(o, c) * 1.0005, 2),
                             "l": round(min(o, c) * 0.9995, 2), "c": round(c, 2), "v": rnd.randint(50, 900) * 1000})
            px = c
    d += dt.timedelta(days=1)
host = {"_provenance": "SYNTHETIC - seeded random walk (seed 20260928), NOT market data. Weekdays only, NO holiday "
                       "calendar. Weekly bars keyed by Monday; 5m bars are bar-START unix seconds, 04:00-20:00 ET.",
        "symbol": "SYNTH_SPY", "D": daily, "W": weekly, "5": intraday}

for sym, body in out.items():
    with open(os.path.join(OUT, f"{sym}.json"), "w") as fh:
        json.dump(body, fh, separators=(",", ":"))
with open(os.path.join(OUT, "catalog.json"), "w") as fh:
    json.dump({"series": catalog, "attributions": {
        "bls": "Source: U.S. Bureau of Labor Statistics", "bea": "Source: U.S. Bureau of Economic Analysis",
        "eia": "Source: U.S. Energy Information Administration", "dol": "Source: U.S. Department of Labor",
        "nyfed": "Source: Federal Reserve Bank of New York"}}, fh, indent=1)
with open(os.path.join(OUT, "host_SYNTH_SPY.json"), "w") as fh:
    json.dump(host, fh, separators=(",", ":"))
for sym, body in out.items():
    p = body["points"]
    print(sym, len(p), p[0][2], p[-1][3], sum(1 for x in p if x[1] is None), "nulls")
print("host", len(daily), len(weekly), len(intraday))
