"""
darkpool_aggregator.py — Server-side port of DarkPool.jsx parseCSVtoD.

Why this exists:
  60+ day dark pool windows are 200+ MB of raw CSV. Browser fetch().text()
  bumps into V8's max string length (~536 MB) and even when the string
  itself fits, parseCSVtoD on 3M+ rows in a single JS thread chokes the
  tab. Server-side aggregation compresses the wire payload to ~5 MB of
  JSON (40x reduction) and offloads the heavy CPU off the browser.

Output shape:
  Exactly matches what DarkPool.jsx's parseCSVtoD returns. The React UI
  components consume it unchanged — only the fetch+parse path in
  DarkPool.jsx changes (it now sets state directly from the JSON
  response, instead of running parseCSV + parseCSVtoD client-side).

Cache strategy:
  File-based on Railway's /data volume. Keyed by ('days_N', db_signature)
  where db_signature is (row_count, max_id) — changes on any insert or
  delete, so uploads automatically invalidate cache files. Auto
  pre-compute on upload fills the common windows in a background thread
  so the first end-user request lands on warm cache (sub-second).
"""

import os
import re
import json
import time
import math
import sqlite3
import threading
from datetime import date as date_t
from collections import defaultdict

from api.darkpool_db import DB_PATH, _resolve_dates


# ── JS-compatible rounding ──────────────────────────────────────────────
# JS Math.round() rounds halves away from zero (Math.round(0.5)===1).
# Python's round() uses banker's rounding (round(0.5)===0). For most
# prices the visible difference is rare, but we mirror JS exactly so the
# numbers in the cached JSON match what the old JS aggregator produced.

def js_round(x):
    if x is None:
        return None
    if x >= 0:
        return math.floor(x + 0.5)
    return -math.floor(-x + 0.5)

def js_round_n(x, n):
    """Round to n decimal places, JS-compatible."""
    if x is None:
        return None
    scale = 10 ** n
    if x >= 0:
        return math.floor(x * scale + 0.5) / scale
    return -math.floor(-x * scale + 0.5) / scale


# ── Ticker classification sets — must match DarkPool.jsx 1:1 ────────────

INDEXES = {"SPY","QQQ","IWM","DIA","MDY","RSP","OEF","ONEQ","TQQQ","SQQQ","SPXU","SPXS","UPRO","SH","PSQ","QID","UVXY","VXX","VIXY","SVXY","SOXS","SOXL","TNA","TZA","UDOW","SDOW","SPXL","ERX","ERY"}

SECTOR_ETFS = {"XLF","XLE","XLK","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GDX","GDXJ","KRE","KBE","XOP","OIH","XBI","IBB","ARKG","ARKK","ARKW","ARKQ","ARKF","ARKVV","SMH","SOXX","HACK","CIBR","FINX","CLOU","BOTZ","ROBO","WCLD","BUG","SKYY","AIQ","KBWB","KIE","IAI","IYF","PNQI","FDN","IPAY","EMQQ","KOMP","LOUP","DTEC","JETS","AIRR","MOO","SOIL","CROP","WEED","MSOS","POTX","MJ","BITO","BLOK","BITQ","IBIT","FBTC","GBTC","HODL","BTCO","EZBC","BTCW","DEFI","XME","PICK","SLX","REMX","LIT","BATT","DRIV","IDRV","KARS","VNQ","SCHH","ICF","REM","MORT","HOMZ","XHB","ITB","PKB","REZ","PHO","CGW","FIW","FWAT","RXL","BBH","PJP","XPH","SBIO","LABD","LABU","TAN","FAN","ICLN","QCLN","ACES","PBD","SMOG","IAT","KBWR","DPST","FAS","FAZ","SKF","UYG","CURE","RXD","MTUM","VLUE","QUAL","USMV","SIZE","IWF","IWD","IWB","IWR","IWS","VTV","VUG","VO","VB","VBR","VBK","MGC","MGK","MGV","ESGU","ESGD","ESGE","DSI","SDGA"}

BOND_ETFS = {"TLT","IEF","SHY","IEI","SHV","GOVT","TBT","TMF","TBF","TTT","UBT","PST","AGG","BND","SCHZ","IUSB","SPAB","BOND","LQD","VCIT","IGIB","SPSB","VCSH","IGSB","FLOT","SJNK","BSCN","BSCO","HYG","JNK","FALN","PHB","HYLB","USHY","SHYG","HYEM","BSJN","BSJO","BSJP","EMB","VWOB","PCY","LEMB","ELD","EBND","MUB","TFI","CMF","ITM","PZA","VTEB","MUNI","SUB","HYD","SHYD","TIP","SCHP","STIP","VTIP","RINF","WIP","BWX","BNDX","IGOV","ISHG","PICB","BIL","GBIL","SGOV","CLTL","VGSH","SCHO","FTSM","LQDH","HYGH","IGBH","TOTB","BNDW","PFFD","FPE","IPFF","PFF","PRFD","MINT","NEAR","ICSH","GSY","JPST","PULS","FLRN"}

INTL_EM_ETFS = {"EEM","EFA","VEA","VWO","IEMG","ACWI","ACWX","VXUS","VT","FXI","ASHR","MCHI","KWEB","CQQQ","CHIQ","HAO","GXC","KURE","PGJ","EWJ","DBJP","HEWJ","DXJ","EWZ","EWW","EWC","EWY","EWG","EWH","EWT","EWS","EWU","EWA","EWI","EWP","EWQ","EWD","EWN","EWK","EWL","EWO","EIS","INDA","INDY","PIN","EPI","SMIN","VGK","IEV","FEZ","HEDJ","EZU","EURL","RSX","ERUS","RUSL","RUSS","ENZL","EWM","ECH","EPHE","EIDO","TUR","EPOL","ARGT","EZA","AFK","FM","GAF","EMXC","XSOE","DFAE","DFEM","AVEM","GEM","GMF","SPEM","HEFA","DBEF","DEEF","HEEM"}

COMMODITY_ETFS = {"GLD","IAU","GLDM","BAR","SGOL","PHYS","AAAU","BGLD","SLV","SIVR","PSLV","DSLV","USLV","USO","UCO","SCO","DBO","OIL","OILU","OILD","UNG","BOIL","KOLD","GAZ","FCG","PDBC","DJP","USCI","COMB","COM","GSG","DBC","RJI","MLPA","DBA","WEAT","CORN","SOYB","CANE","NIB","JO","BAL","COW","TAGS","CPER","COPX","CULL","PALL","PPLT","GLTR","WOOD","NLR","URA","URNM","HURA","LNG","MLPX","AMLP","AMJ","AMJB","ENFR","TPVG","MLPQ"}

LARGE_CAP_KNOWN = {"AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","LLY","UNH","JPM","V","XOM","MA","PG","COST","HD","JNJ","MRK","CVX","ABBV","PEP","KO","BAC","WFC","NFLX","ORCL","CRM","AMD","INTC","MU","QCOM","NOW","ADBE","ACN","TXN","IBM","GS","MS","BLK","AMGN","GILD","REGN","VRTX","TMO","DHR","ABT","MDT","SYK","BMY","PFE","CI","ISRG","ELV","CVS","UNP","HON","RTX","LMT","NOC","BA","CAT","DE","GE","ETN","EMR","WM","RSG","ADP","PAYX","T","VZ","CMCSA","DIS","SBUX","MCD","BKNG","MAR","HLT","NKE","TGT","WMT","PYPL","UBER","ABNB","PLTR","DDOG","NET","CRWD","ZS","PANW","FTNT","SNOW","TEAM","WDAY","VEEV","TWLO","MDB","OKTA","DOCU","ZM","COIN","MSTR","HOOD","SOFI","NU","AFRM","SQ","SHOP","SPOT","PINS","SNAP","ROKU","TTD","RBLX","LYFT","DASH","RIVN","LCID","F","GM","STLA","NIO","LI","XPEV","ENPH","PLUG","NEE","FSLR","OXY","MPC","VLO","PSX","HES","DVN","COP","MRO","SLB","HAL","BKR","FCX","NEM","GOLD","WPM","UPS","FDX","DAL","UAL","AAL","LUV","CCL","NCLH","RCL","BX","KKR","APO","ARES","CME","ICE","CBOE","SPGI","MCO","USB","PNC","TFC","COF","DFS","SYF","AXP","SCHW","ALB","MP","TMUS","AMT","CCI","PSA","IRM","PLD","O","SPG","AWK","PCG","BRK.B","BRK.A","MKL","CAVA","CMG","TSCO","CHWY"}

CAT_ORDER = ["Indexes","Large Cap","Mid Cap","Small Cap","Sector ETFs","Bond ETFs","Intl/EM ETFs","Commodity ETFs"]

CAT_DESC = {
    "Indexes":        "Major U.S. broad-market index ETFs and leveraged derivatives",
    "Large Cap":      "S&P 500 and mega-cap individual equities",
    "Mid Cap":        "S&P 400 mid-cap and Russell 1000 individual equities",
    "Small Cap":      "Russell 2000 and smaller individual equities",
    "Sector ETFs":    "Sector, thematic, and factor-based domestic ETFs",
    "Bond ETFs":      "Fixed income ETFs across duration and credit spectrum",
    "Intl/EM ETFs":   "International developed and emerging market ETFs",
    "Commodity ETFs": "Commodity ETFs including gold, oil, and natural resources",
}


# ── Date helpers (output matches DarkPool.jsx exactly) ──────────────────

def parse_mdy(s):
    """Parse 'M/D/YYYY' → date object. Returns None on failure."""
    try:
        parts = s.strip().split("/")
        if len(parts) < 3:
            return None
        m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 100:
            y += 2000
        return date_t(y, m, d)
    except (ValueError, IndexError):
        return None

def fmt_date_key(d):
    """YYYY-MM-DD (matches JS toISOString().slice(0,10))"""
    return d.isoformat()

# Month abbreviations + non-zero-padded day to mirror JS toLocaleDateString.
# Using strftime("%b %-d") works on Linux but %-d isn't portable, so we
# build the label by hand to be safe in any environment.
_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

def fmt_label(d):
    """'Mon D' format (matches JS toLocaleDateString en-US short)."""
    return f"{_MONTHS[d.month-1]} {d.day}"

def fmt_short(d):
    """MM/DD with leading zeros (matches JS fmtShort)."""
    return f"{d.month:02d}/{d.day:02d}"

def fmt_n(n):
    """$1.2B / $345M / $12K — matches JS fmtN exactly."""
    if n >= 1_000_000_000:
        return f"${n/1e9:.1f}B"
    if n >= 1_000_000:
        return f"${n/1e6:.0f}M"
    return f"${n/1e3:.0f}K"


# ── Classification / percentile helpers ─────────────────────────────────

def classify_ticker(tk, total_notional, num_dates):
    """Mirror DarkPool.jsx classifyTicker()."""
    t = (tk or "").upper()
    if t in INDEXES:        return "Indexes"
    if t in SECTOR_ETFS:    return "Sector ETFs"
    if t in BOND_ETFS:      return "Bond ETFs"
    if t in INTL_EM_ETFS:   return "Intl/EM ETFs"
    if t in COMMODITY_ETFS: return "Commodity ETFs"
    avg_daily = total_notional / max(num_dates, 1)
    if t in LARGE_CAP_KNOWN or avg_daily >= 50_000_000:
        return "Large Cap"
    if avg_daily >= 5_000_000:
        return "Mid Cap"
    return "Small Cap"


def weighted_percentile(pairs, pct):
    """Mirror DarkPool.jsx weightedPercentile().
    pairs: list of (price, weight) tuples.
    Returns weighted percentile of prices, rounded to 2 decimals JS-style."""
    if not pairs:
        return None
    sp = sorted(pairs, key=lambda x: x[0])
    total_w = sum(w for _, w in sp)
    if total_w <= 0:
        return None
    target = (pct / 100.0) * total_w
    cum = 0.0
    for p, w in sp:
        cum += w
        if cum >= target:
            return js_round_n(p, 2)
    return js_round_n(sp[-1][0], 2)


# Pre-compiled regexes matching the inline match() calls in JS
_SPOT_RE   = re.compile(r"Spot:\s*\$([0-9.]+)")
_VOLUME_RE = re.compile(r"Volume:\s*(\d+)")
_AVGVOL_RE = re.compile(r"([0-9.]+)%\s*AvgVol")


# ── Main aggregator ────────────────────────────────────────────────────

def aggregate(days=None, all_data=False):
    """
    Compute the dpData shape that DarkPool.jsx parseCSVtoD used to build
    client-side. Returns a dict ready for JSON serialization.

    The steps mirror the JS implementation in DarkPool.jsx in the same
    order, with line refs in comments for cross-checking when porting bug
    fixes between the two.
    """
    t0 = time.time()

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row

    try:
        if all_data or days is None:
            cursor = conn.execute(
                "SELECT date, ticker, price, notional, message, type, "
                "industry, sector, avg30day FROM darkpool_trades"
            )
        else:
            selected_dates = _resolve_dates(conn, days)
            if not selected_dates:
                return _empty_result()
            placeholders = ",".join(["?"] * len(selected_dates))
            cursor = conn.execute(
                f"SELECT date, ticker, price, notional, message, type, "
                f"industry, sector, avg30day FROM darkpool_trades "
                f"WHERE date IN ({placeholders})",
                selected_dates,
            )

        # ── Categorize rows (mirrors DarkPool.jsx 1499-1543) ──────────
        seen_dates = {}             # date_key -> date object
        trade_rows = []
        phantom_rows = []
        cancelled_rows = []
        options_list = []
        alpha_list = []
        uoa_tickers = set()

        for row in cursor:
            date_str = row["date"] or ""
            if not date_str:
                continue
            d = parse_mdy(date_str)
            if d is None:
                continue
            dk = fmt_date_key(d)
            if dk not in seen_dates:
                seen_dates[dk] = d

            tk = (row["ticker"] or "").strip()
            if not tk:
                continue
            rtype = (row["type"] or "").strip()
            msg   = (row["message"] or "").strip()
            price = row["price"]
            notional = row["notional"]

            if rtype == "AlphaGold":
                try:
                    alpha_list.append({
                        "ticker": tk,
                        "price": float(price) if price else 0,
                        "date": fmt_short(d),
                    })
                except (TypeError, ValueError):
                    pass
                continue

            if rtype == "Options":
                try:
                    options_list.append({
                        "ticker": tk,
                        "price": float(price) if price else 0,
                        "message": msg,
                        "date": fmt_short(d),
                    })
                except (TypeError, ValueError):
                    pass
                continue

            if rtype == "DarkPool":
                uoa_tickers.add(tk)
                continue

            if rtype != "Block":
                continue

            if msg.startswith("Cancelled"):
                try:
                    cancelled_rows.append({
                        "ticker": tk,
                        "price": float(price) if price else 0,
                        "notional": float(notional) if notional else 0,
                        "message": msg,
                        "date": fmt_short(d),
                    })
                except (TypeError, ValueError):
                    pass
                continue

            if msg.startswith("Phantom Print"):
                spot_m = _SPOT_RE.search(msg)
                vol_m  = _VOLUME_RE.search(msg)
                try:
                    phantom_rows.append({
                        "ticker": tk,
                        "date": fmt_short(d),
                        "dpPrice": float(price) if price else 0,
                        "spotPrice": float(spot_m.group(1)) if spot_m else 0,
                        "volume": vol_m.group(1) if vol_m else "0",
                    })
                except (TypeError, ValueError):
                    pass
                continue

            # Regular block trade
            try:
                p = float(price) if price else 0.0
                n = float(notional) if notional else 0.0
            except (TypeError, ValueError):
                continue
            if p <= 0 or n <= 0:
                continue
            avg30 = 0.0
            if row["avg30day"] is not None:
                try:
                    avg30 = float(row["avg30day"])
                except (TypeError, ValueError):
                    pass
            avgvol_m = _AVGVOL_RE.search(msg)
            pct_avg_vol = float(avgvol_m.group(1)) if avgvol_m else 0.0
            industry = (row["industry"] or "").strip()
            sector   = (row["sector"] or "").strip()
            trade_rows.append({
                "ticker": tk, "dateKey": dk, "price": p, "notional": n,
                "message": msg, "avg30": avg30, "pctAvgVol": pct_avg_vol,
                "industry": industry, "sector": sector,
            })
    finally:
        conn.close()

    # Sorted date list
    all_dates = sorted(seen_dates.values())
    num_dates = len(all_dates)
    if num_dates == 0:
        return _empty_result()
    sorted_date_keys = [fmt_date_key(d) for d in all_dates]

    # ── Per-ticker aggregation (mirrors 1546-1564) ────────────────────
    ticker_trades   = defaultdict(list)
    ticker_daily    = defaultdict(lambda: defaultdict(lambda: {"notional":0.0, "volNotional":0.0, "count":0}))
    ticker_avg30    = {}
    ticker_industry = {}
    ticker_sector   = {}

    for tr in trade_rows:
        tk = tr["ticker"]; dk = tr["dateKey"]; p = tr["price"]; n = tr["notional"]
        ticker_trades[tk].append({"p": p, "n": n, "dk": dk, "pctAvgVol": tr["pctAvgVol"]})
        if tr["avg30"] > 0:
            ticker_avg30[tk] = tr["avg30"]
        if tr["industry"] and tk not in ticker_industry:
            ticker_industry[tk] = tr["industry"]
        if tr["sector"] and tk not in ticker_sector:
            ticker_sector[tk] = tr["sector"]
        de = ticker_daily[tk][dk]
        de["notional"]    += n
        de["volNotional"] += p * n
        de["count"]       += 1

    # ── Build items (mirrors 1567-1619) ───────────────────────────────
    items_all = []
    for tk, trades in ticker_trades.items():
        all_prices  = [t["p"] for t in trades]
        all_weights = [t["n"] for t in trades]
        total_n = sum(all_weights)
        if total_n <= 0:
            continue
        vwap = js_round_n(sum(p*w for p,w in zip(all_prices, all_weights)) / total_n, 2)

        pairs = list(zip(all_prices, all_weights))
        lo = weighted_percentile(pairs, 25)
        hi = weighted_percentile(pairs, 75)
        if lo == hi and lo is not None:
            lo = js_round_n(lo * 0.995, 2)
            hi = js_round_n(hi * 1.005, 2)

        active_days = ticker_daily[tk]
        days_count  = len(active_days)
        last_day_key = max(active_days.keys())
        ld = active_days[last_day_key]
        last = js_round_n(ld["volNotional"] / ld["notional"], 2) if ld["notional"] > 0 else vwap

        if last > hi:
            pos = "above"
            pct = js_round_n((last - hi) / hi * 100, 2) if hi else 0
        elif last < lo:
            pos = "below"
            pct = js_round_n((last - lo) / lo * 100, 2) if lo else 0
        else:
            pos = "inside"
            mid = (lo + hi) / 2
            pct = js_round_n((last - mid) / mid * 100, 2) if mid else 0

        max_daily_n = max((v["notional"] for v in active_days.values()), default=0) or 1
        prices_arr = []
        w_arr = []
        for d in all_dates:
            dk = fmt_date_key(d)
            if dk in active_days:
                dd = active_days[dk]
                prices_arr.append(js_round_n(dd["volNotional"] / dd["notional"], 2) if dd["notional"] > 0 else None)
                w_arr.append(js_round_n(dd["notional"] / max_daily_n, 3))
            else:
                prices_arr.append(None)
                w_arr.append(None)

        sorted_trades = sorted(trades, key=lambda x: x["n"], reverse=True)
        top5 = []
        for t in sorted_trades[:5]:
            try:
                d_obj = date_t.fromisoformat(t["dk"])
                top5.append(f"{fmt_short(d_obj)} @ ${t['p']:.2f}  {fmt_n(t['n'])}")
            except (ValueError, KeyError):
                top5.append("")

        big = sorted_trades[0] if sorted_trades else None
        big_print   = big["p"] if big else None
        big_print_n = big["n"] if big else 0
        big_print_dk = big["dk"] if big else None
        if big_print_dk:
            try:
                big_print_date = fmt_short(date_t.fromisoformat(big_print_dk))
            except ValueError:
                big_print_date = big_print_dk
        else:
            big_print_date = None
        big_print_pct_avg_vol = big["pctAvgVol"] if big else 0

        cat = classify_ticker(tk, total_n, num_dates)
        avg30 = ticker_avg30.get(tk, 0)
        industry = ticker_industry.get(tk, "")
        sector   = ticker_sector.get(tk, "")
        acc_dist = None
        if big_print is not None and vwap and vwap > 0:
            acc_dist = "Acc" if big_print >= vwap else "Dist"

        items_all.append({
            "t": tk, "cat": cat, "n": js_round(total_n),
            "lo": lo, "hi": hi, "last": last, "vwap": vwap,
            "c": len(trades), "days": days_count,
            "pos": pos, "pct": pct,
            "u": tk in uoa_tickers,
            "prices": prices_arr, "w": w_arr,
            "top5": top5,
            "bigPrint": big_print, "bigPrintN": big_print_n,
            "bigPrintDk": big_print_dk, "bigPrintDate": big_print_date,
            "bigPrintPctAvgVol": big_print_pct_avg_vol,
            "avg30": avg30, "industry": industry, "sector": sector,
            "accDist": acc_dist,
            "mktcap": 0, "signals": [],
        })

    # ── Signal detection (mirrors 1621-1686) ──────────────────────────
    last2_set = set(sorted_date_keys[-2:])
    last20_set = set(sorted_date_keys[-20:])
    last_date_key = sorted_date_keys[-1]
    prior20_set = {dk for dk in sorted_date_keys[:max(0, len(sorted_date_keys)-2)] if dk in last20_set}

    for item in items_all:
        signals = []
        tk = item["t"]
        trades = ticker_trades.get(tk, [])
        active_days = ticker_daily.get(tk, {})
        active_date_keys = sorted(active_days.keys())

        daily_max = {}
        for tr in trades:
            dk = tr["dk"]; n = tr["n"]
            if dk not in daily_max or n > daily_max[dk]:
                daily_max[dk] = n

        recent_biggest = max((n for dk,n in daily_max.items() if dk in last2_set), default=0)

        # 1. YEARLY_RECORD
        all_prior_max = max((n for dk,n in daily_max.items() if dk not in last2_set), default=0)
        if (recent_biggest >= 50_000_000 and all_prior_max > 0
                and recent_biggest > all_prior_max and len(active_date_keys) >= 10):
            signals.append({
                "type": "YEARLY_RECORD", "icon": "👑", "label": "Yearly Record",
                "mult": js_round_n(recent_biggest / all_prior_max, 1),
            })

        # 2. MONTHLY_RECORD
        monthly20_max = max((n for dk,n in daily_max.items() if dk in prior20_set), default=0)
        already_yearly = any(s["type"] == "YEARLY_RECORD" for s in signals)
        if (recent_biggest >= 50_000_000 and monthly20_max > 0
                and recent_biggest > monthly20_max
                and not already_yearly and len(active_date_keys) >= 5):
            signals.append({
                "type": "MONTHLY_RECORD", "icon": "🏆", "label": "Monthly Record",
                "mult": js_round_n(recent_biggest / monthly20_max, 1),
            })

        # 3. NOTIONAL_SPIKE
        last_day_n = active_days.get(last_date_key, {}).get("notional", 0)
        prior_nots = [active_days[dk]["notional"] for dk in active_date_keys if dk != last_date_key]
        avg_prior = sum(prior_nots) / len(prior_nots) if len(prior_nots) >= 3 else 0
        if last_day_n >= 100_000_000 and avg_prior > 0 and last_day_n >= 3 * avg_prior:
            signals.append({
                "type": "NOTIONAL_SPIKE", "icon": "🔥", "label": "Volume Surge",
                "mult": js_round_n(last_day_n / avg_prior, 1),
            })

        # 4. RARE_FLOW
        recent_count = sum(1 for dk in active_date_keys if dk in last2_set)
        older_count  = sum(1 for dk in active_date_keys if dk not in last2_set)
        if (recent_count > 0 and older_count == 0
                and len(sorted_date_keys) >= 20 and item["bigPrintN"] >= 20_000_000):
            signals.append({"type": "RARE_FLOW", "icon": "🆕", "label": "New Flow"})

        # 5. SIZE_ESCALATION
        recent_daily_arr = [daily_max[dk] for dk in sorted_date_keys if dk in daily_max][-6:]
        if len(recent_daily_arr) >= 4:
            streak = 1
            for i in range(len(recent_daily_arr)-1, 0, -1):
                if recent_daily_arr[i] > recent_daily_arr[i-1] * 1.25:
                    streak += 1
                else:
                    break
            if streak >= 4:
                signals.append({
                    "type": "SIZE_ESCALATION", "icon": "⬆️", "label": "Escalating", "days": streak,
                })

        # 6. ZONE_BREAK_RECORD
        if item["pos"] != "inside" and any(s["type"] in ("YEARLY_RECORD","MONTHLY_RECORD") for s in signals):
            signals.append({"type": "ZONE_BREAK_RECORD", "icon": "💥", "label": "Zone Break"})

        item["signals"] = signals

    # ── Categories + above/below/unusual lists ────────────────────────
    cat_map = defaultdict(list)
    for item in items_all:
        cat_map[item["cat"]].append(item)

    categories = []
    for cat in CAT_ORDER:
        items = sorted(cat_map.get(cat, []), key=lambda x: x["n"], reverse=True)
        categories.append({
            "name": cat,
            "desc": CAT_DESC[cat],
            "totalNotional": sum(i["n"] for i in items),
            "count": len(items),
            "items": items,
        })

    above   = sorted([i for i in items_all if i["pos"]=="above"], key=lambda x: x["pct"], reverse=True)[:40]
    below   = sorted([i for i in items_all if i["pos"]=="below"], key=lambda x: x["pct"])[:40]
    unusual = sorted([i for i in items_all if i["u"]], key=lambda x: x["n"], reverse=True)[:30]

    # ── Phantom / Options / Alpha / Cancelled dedup ───────────────────
    seen_ph = set(); phantom_deduped = []
    for ph in phantom_rows:
        k = f"{ph['ticker']}|{ph['date']}|{ph['dpPrice']}"
        if k not in seen_ph:
            seen_ph.add(k); phantom_deduped.append(ph)
    phantom_deduped.sort(
        key=lambda p: abs(p["spotPrice"] - p["dpPrice"]) / max(p["dpPrice"], 0.01),
        reverse=True,
    )
    phantom = phantom_deduped[:15]

    seen_opts = set(); opts_deduped = []
    for o in reversed(options_list):
        k = f"{o['ticker']}|{o['message']}"
        if k not in seen_opts:
            seen_opts.add(k); opts_deduped.append(o)
    options = opts_deduped[:25]

    seen_alpha = set(); alpha_deduped = []
    for a in reversed(alpha_list):
        if a["ticker"] not in seen_alpha:
            seen_alpha.add(a["ticker"]); alpha_deduped.append(a)
    alpha = alpha_deduped[:10]

    cancelled_sorted = sorted(cancelled_rows, key=lambda c: c["notional"], reverse=True)
    seen_can = set(); cancelled_deduped = []
    for c in cancelled_sorted:
        k = f"{c['ticker']}|{c['date']}|{c['notional']}"
        if k not in seen_can:
            seen_can.add(k); cancelled_deduped.append(c)
    cancelled = cancelled_deduped[:15]

    # ── Themes by sector (mirrors 1745-1763) ──────────────────────────
    sector_agg = defaultdict(lambda: {"sector":"", "notional":0, "tickers":[], "prints":0})
    for item in items_all:
        sec = item["sector"] or "Other"
        sa = sector_agg[sec]
        sa["sector"]    = sec
        sa["notional"] += item["n"]
        sa["tickers"].append(item["t"])
        sa["prints"]   += item["c"]

    themes = []
    for sec, sa in sector_agg.items():
        if len(sa["tickers"]) < 2 or sec in ("Other", ""):
            continue
        sec_items = [i for i in items_all if i["sector"] == sec]
        acc_count = sum(1 for i in sec_items if i["accDist"] == "Acc")
        dist_count = sum(1 for i in sec_items if i["accDist"] == "Dist")
        bp_items = [i for i in sec_items if i["bigPrint"] and i["bigPrint"] > 0]
        if bp_items:
            avg_bp_move = sum((i["last"] - i["bigPrint"]) / i["bigPrint"] * 100 for i in bp_items) / len(bp_items)
        else:
            avg_bp_move = 0
        themes.append({
            "sector": sa["sector"],
            "notional": sa["notional"],
            "tickers": sa["tickers"],
            "prints": sa["prints"],
            "accCount": acc_count,
            "distCount": dist_count,
            "avgBpMove": js_round_n(avg_bp_move, 2),
            "tickerCount": len(sa["tickers"]),
        })
    themes.sort(key=lambda t: t["notional"], reverse=True)

    items_all.sort(key=lambda i: i["n"], reverse=True)

    # ── Meta ──────────────────────────────────────────────────────────
    total_notional = sum(tr["notional"] for tr in trade_rows)
    if len(all_dates) >= 2:
        date_range = f"{fmt_label(all_dates[0])} – {fmt_label(all_dates[-1])}, {all_dates[-1].year}"
    elif len(all_dates) == 1:
        date_range = f"{fmt_label(all_dates[0])}, {all_dates[0].year}"
    else:
        date_range = ""

    elapsed_ms = int((time.time() - t0) * 1000)
    print(f"[darkpool_agg] days={days} all={all_data} rows={len(trade_rows)} "
          f"tickers={len(items_all)} dates={num_dates} took={elapsed_ms}ms")

    return {
        "dates": sorted_date_keys,
        "dateLabels": [fmt_label(d) for d in all_dates],
        "meta": {
            "generatedAt": time.strftime("%m/%d/%Y, %I:%M:%S %p").lstrip("0").replace("/0","/"),
            "dateRange": date_range,
            "tradingDays": num_dates,
            "totalTrades": len(trade_rows),
            "totalTickers": len(ticker_trades),
            "totalNotional": js_round(total_notional),
        },
        "categories": categories,
        "above": above, "below": below, "unusual": unusual,
        "phantom": phantom, "options": options, "alpha": alpha, "cancelled": cancelled,
        "allItems": items_all,
        "themes": themes,
    }


def _empty_result():
    return {
        "dates": [], "dateLabels": [],
        "meta": {"generatedAt": "", "dateRange": "", "tradingDays": 0,
                 "totalTrades": 0, "totalTickers": 0, "totalNotional": 0},
        "categories": [], "above": [], "below": [], "unusual": [],
        "phantom": [], "options": [], "alpha": [], "cancelled": [],
        "allItems": [], "themes": [],
    }


# ── File cache + auto-prebuild ──────────────────────────────────────────

CACHE_DIR = os.path.join(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "/data"), "darkpool_cache")
COMMON_WINDOWS = [1, 5, 20, 60, 90]  # plus "all"


def _cache_path(days):
    """Cache filename for a given days window. None means 'all'."""
    name = "all" if days is None else f"d{days}"
    return os.path.join(CACHE_DIR, f"agg_{name}.json")


def _db_signature():
    """Cheap fingerprint of current DB state. Changes on any insert/delete.

    (row_count, max_id) is sufficient: row_count alone could miss a same-
    count refresh (rare), but max(id) on AUTOINCREMENT will always move
    forward after any new insert. Together they're a tight check.
    """
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        row = conn.execute(
            "SELECT COUNT(*) as c, MAX(id) as m FROM darkpool_trades"
        ).fetchone()
        conn.close()
        return f"{row[0]}-{row[1] or 0}"
    except Exception:
        return None


def get_aggregated(days=None, all_data=False):
    """Return aggregated dict — from cache when DB signature matches,
    otherwise compute fresh and write back to cache."""
    cache_key_days = None if all_data else days
    cache_file = _cache_path(cache_key_days)
    sig = _db_signature()

    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("_sig") == sig:
                return cached["payload"]
        except Exception as e:
            print(f"[darkpool_agg] cache read failed {cache_file}: {e}")

    result = aggregate(days=days, all_data=all_data)
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = cache_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"_sig": sig, "payload": result}, f)
        os.replace(tmp, cache_file)
    except Exception as e:
        print(f"[darkpool_agg] cache write failed {cache_file}: {e}")
    return result


def invalidate_cache():
    """Delete every cache file. Call after upload/prune so the next
    request rebuilds against fresh data."""
    if not os.path.exists(CACHE_DIR):
        return 0
    n = 0
    for fname in os.listdir(CACHE_DIR):
        try:
            os.remove(os.path.join(CACHE_DIR, fname))
            n += 1
        except Exception:
            pass
    print(f"[darkpool_agg] invalidated {n} cache files")
    return n


_prebuild_lock = threading.Lock()
_prebuild_in_progress = False


def prebuild_all_windows():
    """Pre-compute aggregations for COMMON_WINDOWS + all.
    Idempotent: if a prebuild is already running, skips (no point queueing)."""
    global _prebuild_in_progress
    with _prebuild_lock:
        if _prebuild_in_progress:
            print("[darkpool_agg] prebuild already in progress — skip")
            return
        _prebuild_in_progress = True
    try:
        # Invalidate first so the fresh aggregates land in cache slots
        invalidate_cache()
        print(f"[darkpool_agg] prebuild start: {COMMON_WINDOWS} + all")
        for n in COMMON_WINDOWS:
            try:
                get_aggregated(days=n)
            except Exception as e:
                print(f"[darkpool_agg] prebuild d{n} FAILED: {e}")
        try:
            get_aggregated(all_data=True)
        except Exception as e:
            print(f"[darkpool_agg] prebuild all FAILED: {e}")
        print("[darkpool_agg] prebuild complete")
    finally:
        with _prebuild_lock:
            _prebuild_in_progress = False


def prebuild_all_windows_background():
    """Kick off prebuild in a daemon thread — returns immediately so the
    upload handler can respond to the admin without waiting."""
    threading.Thread(
        target=prebuild_all_windows,
        daemon=True,
        name="darkpool-prebuild",
    ).start()
