/**
 * flowCompute.js — the Options Flow compute layer.
 *
 * MOVED VERBATIM out of OptionsFlow.jsx on 2026-07-25. Nothing here was
 * rewritten: every function is byte-identical to what it was, with only an
 * `export` keyword added. It lives in its own module for one reason — it is
 * 100% pure (no React, no DOM, no window, no fetch), so it can run inside a Web
 * Worker and stop blocking the main thread for ~1.9s on every visit.
 *
 * ⚠️ THIS IS WHERE THE FLOW CLASSIFICATION LOGIC LIVES NOW.
 * Sweep/block detection, side + direction classification, grading, sector
 * resolution, the chart builders and processFlowData itself are all in this
 * file. Edit them HERE, not in OptionsFlow.jsx — they are no longer in that
 * file at all.
 *
 * Anything added here must stay pure: no `window`, no `document`, no `fetch`,
 * no React hooks. The worker has none of them, and a reference to one will only
 * fail at runtime, inside the worker, where it is easy to miss.
 */

// ─── Color Palette ─────────────────────────────────────────────────────────────
export const P = {
  bg:"#0e0f0d", cd:"#1a1c17", al:"#22251e", bd:"#2e3127", bl:"#3a3d32",
  bu:"#3cb868", be:"#e74c3c", ac:"#c9a84c", tx:"#a8a290", dm:"#706b5e",
  mt:"#a8a290", wh:"#e0dac8", ye:"#c9a84c", ma:"#c9a84c", sw:"#6ba3be",
  bk:"#6ba3be", uc:"#706b5e"
};

// ─── Grade System ──────────────────────────────────────────────────────────────
export function gradeCluster(c) {
  const hasSweep = c.hasSweep;
  const hasBlock = c.hasBlock;
  const oiExceeded = c.oiExceeded;
  const clean = c.clean;
  if (hasSweep && hasBlock && clean && oiExceeded) return "A+";
  if ((hasSweep && hasBlock && clean) || (hasSweep && oiExceeded && clean)) return "A";
  if (hasSweep && clean) return "B+";
  if (hasSweep && hasBlock) return "B";
  if ((hasSweep && !clean) || (hasBlock && oiExceeded)) return "C";
  return "D";
}

// Pattern detection — detects anomalous flow patterns on a cluster
export function detectPatterns(c) {
  const patterns = [];
  if ((c.ivs||[]).length >= 3) {
    const minIV = Math.min(...c.ivs), maxIV = Math.max(...c.ivs);
    const minSpot = (c.spots||[]).length>0 ? Math.min(...c.spots) : 0;
    const maxSpot = (c.spots||[]).length>0 ? Math.max(...c.spots) : 0;
    const spotRange = minSpot > 0 ? (maxSpot - minSpot) / minSpot : 0;
    const ivChange = minIV > 0 ? (maxIV - minIV) / minIV : 0;
    if (ivChange >= 0.5 && spotRange < 0.03) patterns.push({ type:"IV_SURGE", ivChange:Math.round(ivChange*100), spotRange:Math.round(spotRange*100) });
  }
  if ((c.sideTimes||[]).length >= 6) {
    const half = Math.floor(c.sideTimes.length / 2);
    const f = c.sideTimes.slice(0, half), s = c.sideTimes.slice(half);
    const ap1=f.filter(x=>x.si==="AA"||x.si==="A").reduce((a,x)=>a+x.prem,0), bp1=f.filter(x=>x.si==="BB"||x.si==="B").reduce((a,x)=>a+x.prem,0);
    const ap2=s.filter(x=>x.si==="AA"||x.si==="A").reduce((a,x)=>a+x.prem,0), bp2=s.filter(x=>x.si==="BB"||x.si==="B").reduce((a,x)=>a+x.prem,0);
    const t1=ap1+bp1, t2=ap2+bp2;
    if ((t1>0&&ap1/t1>0.7&&t2>0&&bp2/t2>0.7)||(t1>0&&bp1/t1>0.7&&t2>0&&ap2/t2>0.7))
      patterns.push({ type:"SIDE_FLIP", from:t1>0&&ap1/t1>0.7?"ASK":"BID", to:t1>0&&ap1/t1>0.7?"BID":"ASK" });
  }
  const hits = c.hits || c.H || 0;
  if (hits >= 20) patterns.push({ type:"HEAVY", hits });
  if ((c.prices||[]).length >= 4) {
    const fp = c.prices[0], lp = c.prices[c.prices.length-1];
    if (fp > 0 && lp / fp >= 1.8) patterns.push({ type:"PRICE_SURGE", pctChange:Math.round((lp/fp-1)*100) });
  }
  return patterns;
}

// ─── CSV Parser (fast-path: split on comma, fallback for quoted fields) ────────
export function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === "," && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, "")); current = ""; }
    else { current += line[i]; }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

export function parseCSV(text) {
  const lines = text.split("\n");
  // Find first non-empty line for headers
  let headerIdx = 0;
  while (headerIdx < lines.length && !lines[headerIdx].trim()) headerIdx++;
  if (headerIdx >= lines.length - 1) return [];
  const rawHeaders = parseCSVLine(lines[headerIdx].replace(/\r$/, ""));
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const ALIASES = {
    ticker:["symbol","ticker","sym","stock","underlying","name"],
    date:["createddate","date","tradedate","day"],
    time:["createdtime","time","tradetime"],
    expiry:["expirationdate","expiry","expiration","exp","expdate"],
    strike:["strike","strikeprice","k"],
    type:["type","details","tradetype","tradedetails","description","ordertype"],
    cp:["callput","cp","optiontype","callorput","putorcall"],
    spot:["spot","stockprice","underprice","underlyingprice","last","underlast","stocklast"],
    side:["side","aggressorside","aggressor","orderside"],
    volume:["volume","vol","qty","contracts","size","quantity"],
    oi:["oi","openinterest","openint","opint"],
    iv:["impliedvolatility","iv","impliedvol","implvol","ivol"],
    premium:["premium","prem","totalpremium","value","totalvalue","notional"],
    price:["price","contractprice","optionprice","lastprice","midprice","mid"],
    color:["color","signal","oicolor","oisignal","flag"],
    dte:["dte","daystoexpiry","daystoexp","dtex"],
    mktcap:["mktcap","marketcap","mcap"],
    sector:["sector"],
    uoa:["uoa"],
    stocketf:["stocketf","stocketf","assettype","type2"],
    er:["er","earnings","earningsdate"],
  };
  const colIdx = {};
  Object.entries(ALIASES).forEach(([field, aliases]) => {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx >= 0) { colIdx[field] = idx; break; }
    }
  });
  // Pre-flatten to array for tight inner loop
  const fieldPairs = Object.entries(colIdx); // [[field, idx], ...]
  const numFields = fieldPairs.length;
  const tickerIdx = colIdx.ticker;
  const result = [];
  for (let li = headerIdx + 1; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw || raw.length < 3) continue; // skip empty/whitespace lines
    // Fast path: no quotes → split on comma (covers 95%+ of flow data rows)
    const cols = raw.indexOf('"') === -1 ? raw.replace(/\r$/, "").split(",") : parseCSVLine(raw.replace(/\r$/, ""));
    // Quick reject: no ticker
    const tk = cols[tickerIdx];
    if (!tk || tk.length === 0) continue;
    const row = {};
    for (let f = 0; f < numFields; f++) {
      row[fieldPairs[f][0]] = (cols[fieldPairs[f][1]] || "").trim();
    }
    if (row.ticker.length > 0) result.push(row);
  }
  return result;
}

// ─── Date Utilities ────────────────────────────────────────────────────────────
export function parseExpiry(str) {
  if (!str) return null;
  const s = str.trim().replace(/"/g, "");
  const parts = s.split("/");
  if (parts.length === 3) {
    let year = parseInt(parts[2]);
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(parts[0]) - 1, parseInt(parts[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  if (parts.length === 2) {
    const today = new Date();
    let d = new Date(today.getFullYear(), parseInt(parts[0]) - 1, parseInt(parts[1]));
    if (d < today) d = new Date(today.getFullYear() + 1, parseInt(parts[0]) - 1, parseInt(parts[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function computeDTE(expiry) {
  if (!expiry) return -1;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((expiry - today) / 86400000);
}

export function formatExp(expiry) {
  if (!expiry) return "";
  const m = expiry.getMonth() + 1;
  const d = expiry.getDate();
  const y = expiry.getFullYear();
  const cy = new Date().getFullYear();
  if (y === cy) return m+"/"+d;
  return m+"/"+d+"/"+String(y).slice(2);
}

// ─── Mega Cap Filter ───────────────────────────────────────────────────────────
export function isMegaCap(mktcap) { return mktcap >= 500e9; }

export function premiumFilter(premium, mktcap) {
  if (!isMegaCap(mktcap)) return true; // any size for non-mega
  return premium >= 100000; // $100K+ for mega caps
}

// ─── Cap Band Helpers ──────────────────────────────────────────────────────────
export function capBand(mktcap) {
  if (!mktcap || mktcap <= 0) return "Unknown";
  if (mktcap >= 500e9) return "Mega";
  if (mktcap >= 10e9)  return "Large";
  return "Mid-Small";
}

export function sum(arr) { return arr.reduce((a,t)=>a+t.P,0); }

// ─── Theme Map ────────────────────────────────────────────────────────────────
// Tickers can belong to multiple themes. Themes aggregate flow across sectors.
export const THEMES_DEF = {
  "Semiconductors": ["NVDA","AMD","INTC","AVGO","QCOM","MU","MRVL","TSM","ASML","LRCX","AMAT","KLAC","ON","MCHP","TXN","ARM","SMCI","ADI","NXPI","SWKS","GFS","MPWR","WOLF","CRUS","ALGM","ACLS","RMBS","SYNA","CDNS","SNPS","CRDO","AMKR"],
  "Software": ["CRM","PLTR","AI","SNOW","DDOG","MDB","PATH","SOUN","BBAI","NOW","ORCL","IBM","ADBE","WDAY","HUBS","DOCN","ESTC","GTLB","CFLT","APP","GRAB","DUOL"],
  "AI Infra": ["CRWV","NBIS","IREN","CIFR","WULF","CORZ","VRT","EQIX","DLR","DELL","HPE","ANET"],
  "Crypto": ["MSTR","COIN","RIOT","MARA","CLSK","BITF","HUT","IBIT","BITO","GBTC","ETHE","BTBT","SQ","HOOD"],
  "Nuclear": ["VST","CEG","NRG","TLN","OKLO","SMR","NNE","GEV","POWL","ETN","BN","BWXT","LEU","UEC","CCJ","DNN"],
  "China": ["BABA","JD","PDD","NIO","LI","XPEV","BIDU","KWEB","FXI","BILI","TME","FUTU","TCOM","WB","TAL","YMM","VNET","MNSO","ZTO","TIGR","HUYA","IQ","QFIN","FINV"],
  "EV": ["TSLA","RIVN","LCID","CHPT","QS","BLNK","GOEV","PTRA","WKHS","FFIE","VFS","PSNY","F","GM"],
  "Defense": ["LMT","RTX","NOC","GD","BA","LHX","HII","KTOS","RKLB","LDOS","BAH","MRCY","AVAV","TDG","AXON","RCAT"],
  "Biotech": ["MRNA","PFE","ABBV","BMY","GILD","AMGN","BIIB","REGN","VRTX","LLY","NVO","AZN","MRK","JNJ","SGEN","ALNY","CRSP","NTLA","BEAM","EDIT","EXAS","DXCM","ISRG","ILMN","VKTX","ALT","GPCR","TERN","VTYX","ROCL","ZEAL"],
  "Cybersecurity": ["CRWD","PANW","ZS","FTNT","S","NET","CYBR","TENB","QLYS","RPD","VRNS","SAIL","OKTA","RBRK"],
  "Financials": ["JPM","GS","BAC","WFC","MS","C","USB","PNC","SCHW","COF","AXP","V","MA","PYPL","BLK","ICE","CME","SPGI","MCO","FIS","FISV","GPN","UPST","SOFI","AFRM","NU","TOST"],
  "Energy": ["XOM","CVX","OXY","COP","SLB","HAL","DVN","EOG","MPC","VLO","PSX","FANG","MRO","APA","HES","BKR","AR","EQT","RRC","CTRA"],
  "Metal Miners": ["NEM","GOLD","AEM","FNV","WPM","AG","PAAS","HL","CDE","SSRM","RGLD","KGC","BTG","AGI","MAG","SVM","EXK","FSM","GFI","AU","HMY"],
  "Solar": ["ENPH","SEDG","FSLR","RUN","NOVA","MAXN","ARRY","CSIQ","JKS","SPWR","TAN","SHLS","GNRC"],
  "Quantum": ["IONQ","RGTI","QUBT","ARQQ","QBTS"],
  "Retail": ["WMT","TGT","COST","HD","LOW","DG","DLTR","LULU","NKE","TJX","ROST","FIVE","BBY","M","KSS","BURL","GPS","ANF","AEO"],
  "Airlines": ["UAL","DAL","AAL","LUV","JBLU","ALK","SAVE","HA","SKYW","ALGT"],
  "Homebuilders": ["DHI","LEN","NVR","PHM","TOL","KBH","TMHC","MTH","MHO","CCS","GRBK","LGIH","MDC","TPH","BZH"],
};
// Reverse lookup: ticker → [theme1, theme2, ...]
export const THEME_LOOKUP = {};
Object.entries(THEMES_DEF).forEach(([theme, tickers]) => {
  tickers.forEach(sym => {
    if (!THEME_LOOKUP[sym]) THEME_LOOKUP[sym] = [];
    if (!THEME_LOOKUP[sym].includes(theme)) THEME_LOOKUP[sym].push(theme);
  });
});

// ─── Sector resolution ────────────────────────────────────────────────────────
// Massive backfill rows come through with an empty Sector column, which
// aggregates every ticker into "Unknown" on the Market Read sectors panel.
// BBS CSV uploads DO populate the field. To close the gap we derive a sector
// client-side when the CSV value is missing:
//   1) Trade's own t.sector (BBS-supplied). Preferred.
//   2) THEME_TO_SECTOR lookup — resolve first theme this ticker belongs to
//      via THEME_LOOKUP, map to a GICS sector.
//   3) TICKER_SECTOR_FALLBACK — hardcoded overrides for mega-caps and other
//      liquid names that aren't in any theme.
//   4) "Unknown" if none of the above match.
//
// Ordering: 3 overrides 2 (the fallback map wins over theme resolution) so
// we can pin the correct sector for ambiguous tickers like HOOD (in Crypto
// theme but sector is Financials).
export const THEME_TO_SECTOR = {
  "Semiconductors": "Information Technology",
  "Software": "Information Technology",
  "AI Infra": "Information Technology",
  "Cybersecurity": "Information Technology",
  "Quantum": "Information Technology",
  "Crypto": "Financials",
  "Nuclear": "Utilities",
  "China": "Consumer Discretionary",
  "EV": "Consumer Discretionary",
  "Defense": "Industrials",
  "Biotech": "Health Care",
  "Financials": "Financials",
  "Energy": "Energy",
  "Metal Miners": "Materials",
  "Solar": "Utilities",
  "Retail": "Consumer Discretionary",
  "Airlines": "Industrials",
  "Homebuilders": "Consumer Discretionary",
};

export const TICKER_SECTOR_FALLBACK = {
  // Mega-cap tech not in any theme
  "AAPL": "Information Technology",
  "MSFT": "Information Technology",
  "GOOGL": "Communication Services",
  "GOOG": "Communication Services",
  "META": "Communication Services",
  "AMZN": "Consumer Discretionary",
  "NFLX": "Communication Services",
  "DIS": "Communication Services",
  "TMUS": "Communication Services",
  "T": "Communication Services",
  "VZ": "Communication Services",
  "CMCSA": "Communication Services",
  "WBD": "Communication Services",
  "PARA": "Communication Services",
  "SPOT": "Communication Services",
  "RBLX": "Communication Services",
  "PINS": "Communication Services",
  "SNAP": "Communication Services",
  "ROKU": "Communication Services",
  "TTD": "Communication Services",
  // Semis / memory / IT not in Semiconductors theme
  "DRAM": "Information Technology",
  "SNDK": "Information Technology",
  "STX": "Information Technology",
  "WDC": "Information Technology",
  "DELL": "Information Technology",
  "HPE": "Information Technology",
  "HPQ": "Information Technology",
  "IBM": "Information Technology",
  "ACN": "Information Technology",
  "NOW": "Information Technology",
  // Financials not in theme
  "BRK.B": "Financials",
  "BRK.A": "Financials",
  "BX": "Financials",
  "KKR": "Financials",
  "APO": "Financials",
  "ARES": "Financials",
  "CBOE": "Financials",
  "DFS": "Financials",
  "SYF": "Financials",
  "TFC": "Financials",
  "MET": "Financials",
  "PRU": "Financials",
  "AIG": "Financials",
  "ALL": "Financials",
  "TRV": "Financials",
  "CB": "Financials",
  "PGR": "Financials",
  // Health Care not in Biotech theme
  "UNH": "Health Care",
  "ELV": "Health Care",
  "CVS": "Health Care",
  "CI": "Health Care",
  "HUM": "Health Care",
  "CNC": "Health Care",
  "TMO": "Health Care",
  "DHR": "Health Care",
  "ABT": "Health Care",
  "MDT": "Health Care",
  "SYK": "Health Care",
  "BSX": "Health Care",
  "EW": "Health Care",
  "ZTS": "Health Care",
  "IDXX": "Health Care",
  // Industrials
  "SPCX": "Industrials",
  "CAT": "Industrials",
  "DE": "Industrials",
  "GE": "Industrials",
  "EMR": "Industrials",
  "HON": "Industrials",
  "MMM": "Industrials",
  "UPS": "Industrials",
  "FDX": "Industrials",
  "UNP": "Industrials",
  "CSX": "Industrials",
  "NSC": "Industrials",
  "WM": "Industrials",
  "RSG": "Industrials",
  "ADP": "Industrials",
  "PAYX": "Industrials",
  "URI": "Industrials",
  // Consumer Discretionary
  "MCD": "Consumer Discretionary",
  "SBUX": "Consumer Discretionary",
  "CMG": "Consumer Discretionary",
  "CAVA": "Consumer Discretionary",
  "BKNG": "Consumer Discretionary",
  "MAR": "Consumer Discretionary",
  "HLT": "Consumer Discretionary",
  "ABNB": "Consumer Discretionary",
  "UBER": "Consumer Discretionary",
  "LYFT": "Consumer Discretionary",
  "DASH": "Consumer Discretionary",
  "CCL": "Consumer Discretionary",
  "NCLH": "Consumer Discretionary",
  "RCL": "Consumer Discretionary",
  "TSCO": "Consumer Discretionary",
  "CHWY": "Consumer Discretionary",
  "SHOP": "Consumer Discretionary",
  // Consumer Staples
  "WMT": "Consumer Staples",
  "COST": "Consumer Staples",
  "PG": "Consumer Staples",
  "KO": "Consumer Staples",
  "PEP": "Consumer Staples",
  "MDLZ": "Consumer Staples",
  "MO": "Consumer Staples",
  "PM": "Consumer Staples",
  "CL": "Consumer Staples",
  "KMB": "Consumer Staples",
  "GIS": "Consumer Staples",
  "K": "Consumer Staples",
  // Real Estate
  "AMT": "Real Estate",
  "CCI": "Real Estate",
  "PSA": "Real Estate",
  "IRM": "Real Estate",
  "PLD": "Real Estate",
  "O": "Real Estate",
  "SPG": "Real Estate",
  "EQIX": "Real Estate",
  "DLR": "Real Estate",
  "VNQ": "Real Estate",
  // Utilities
  "NEE": "Utilities",
  "DUK": "Utilities",
  "SO": "Utilities",
  "AEP": "Utilities",
  "SRE": "Utilities",
  "EXC": "Utilities",
  "PCG": "Utilities",
  "AWK": "Utilities",
  "D": "Utilities",
  "BE": "Industrials",
  // Additional flow-heavy names outside themes
  "POET": "Information Technology",
  "AXTI": "Information Technology",
  "TER": "Information Technology",
  "COHR": "Information Technology",
  "ANET": "Information Technology",
  "PACS": "Health Care",
  "BMNR": "Financials",
  "SMCI": "Information Technology",
  "AVGO": "Information Technology",
  "QCOM": "Information Technology",
  "MRVL": "Information Technology",
  "TSM": "Information Technology",
  "MPWR": "Information Technology",
};

// Prebuilt ticker→sector map: theme resolution first, hardcoded fallback last (wins).
export const _TICKER_SECTOR_MAP = (() => {
  const m = {};
  for (const [sym, themes] of Object.entries(THEME_LOOKUP)) {
    for (const th of themes) {
      const sec = THEME_TO_SECTOR[th];
      if (sec) { m[sym] = sec; break; }  // first mapped theme wins
    }
  }
  for (const [sym, sec] of Object.entries(TICKER_SECTOR_FALLBACK)) m[sym] = sec;
  return m;
})();

export function resolveSector(sym, csvSector) {
  const s = (csvSector||"").trim();
  if (s && s !== "Unknown" && s !== "None") return s;
  return _TICKER_SECTOR_MAP[(sym||"").toUpperCase()] || "Unknown";
}

export function netByTicker(trades, n=8) {
  const m = {};
  trades.forEach(t => {
    if (!m[t.S]) m[t.S] = { s:t.S, b:0, r:0, trades:[] };
    t.D==="BULL" ? (m[t.S].b+=t.P) : (m[t.S].r+=t.P);
    m[t.S].trades.push(t);
  });
  return Object.values(m).map(d => ({
    ...d, n:d.b-d.r,
    topTrades: d.trades.sort((a,b)=>b.P-a.P).slice(0,4).map(t=>({
      Ty:t.Ty, Si:t.Si, Co:t.Co, CP:t.CP, K:t.K, E:t.E, V:t.V, P:t.P
    }))
  })).sort((a,b) => Math.abs(b.n)-Math.abs(a.n)).slice(0,n);
}

export function topTradesFn(trades, n=10) {
  return [...trades]
    .sort((a,b) => ((b.Si==="AA"||b.Si==="BB"?1000:0)+(b.Ty==="SWP"?100:0)+b.P/1e6) -
                   ((a.Si==="AA"||a.Si==="BB"?1000:0)+(a.Ty==="SWP"?100:0)+a.P/1e6))
    .slice(0,n);
}

export function consistencyTable(trades, n=8) {
  const m = {};
  trades.forEach(t => {
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!m[k]) m[k] = { S:t.S, CP:t.CP, K:t.K, E:t.E, H:0, P:0, V:0, D:t.D,
      hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true, prices:[], maxOI:0,
      bullPrem:0, bearPrem:0, dominantOverride:false };
    m[k].H++; m[k].P+=t.P; m[k].V+=t.V;
    if (t.D === "BULL") m[k].bullPrem += t.P;
    if (t.D === "BEAR") m[k].bearPrem += t.P;
    if (t.price > 0) m[k].prices.push(t.price);
    if (t.OI > m[k].maxOI) m[k].maxOI = t.OI;
    if (t.Ty==="SWP") m[k].hasSweep = true;
    if (t.Ty==="BLK") m[k].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") m[k].oiExceeded = true;
    if (t.D) m[k].dirs.add(t.D);
  });
  return Object.values(m).filter(c=>c.H>=2).map(c => {
    c.clean = c.dirs.size <= 1;
    // 80% dominant direction override — if one side has 80%+ of premium, treat as clean
    if (!c.clean) {
      const totalDir = c.bullPrem + c.bearPrem;
      if (totalDir > 0) {
        if (c.bullPrem / totalDir >= 0.8) { c.clean = true; c.D = "BULL"; c.dominantOverride = true; }
        else if (c.bearPrem / totalDir >= 0.8) { c.clean = true; c.D = "BEAR"; c.dominantOverride = true; }
      }
    }
    // Derived oiExceeded — YELLOW/MAGENTA is BBS's flag that day volume pushed
    // past OI. Massive rows come through as WHITE by default so we derive:
    //   (1) Direct: vol > maxOI when OI enrichment populated maxOI (post-fetch)
    //   (2) Pattern: when maxOI=0 (Massive, un-enriched), credit oiExceeded
    //       if the cluster shows the unmistakable institutional signature
    //       — SWEEP + BLOCK + clean + directional + $2M+ premium. That's
    //       definitionally what the flag signals on BBS-sourced data.
    //       Example: SPCX 165c 12/17/27 (5 whale sweeps + 2 blocks, $9.8M,
    //       clean BULL) — impossible to have this pattern without vol>OI.
    if (!c.oiExceeded) {
      if (c.maxOI > 0 && c.V > c.maxOI) c.oiExceeded = true;
      // Pattern rule gated on DTE >= 3 to avoid 0-2 DTE dealer hedging noise
      // (TSLA/QQQ/SPY 0DTE puts show SWEEP+BLOCK+clean+$5M+ patterns that
      // aren't directional positioning, they're expiration-day mechanics).
      else if (c.maxOI === 0 && (c.DTE || 0) >= 3 && c.hasSweep && c.hasBlock && c.clean && c.D && c.P >= 2e6) c.oiExceeded = true;
    }
    c.grade = gradeCluster(c);
    // Median entry price from individual trades
    const sp = [...c.prices].sort((a,b)=>a-b);
    c.entry = sp.length>0 ? sp[Math.floor(sp.length/2)] : (c.V>0 ? c.P/c.V/100 : 0);
    return c;
  }).sort((a,b) => {
    const go = {"A+":6,"A":5,"B+":4,"B":3,"C":2,"D":1};
    return (go[b.grade]||0)-(go[a.grade]||0) || b.H-a.H || b.P-a.P;
  }).slice(0,n);
}

// Recomputes all chart data from a clean_confirmed slice (used by cap filter)
export function buildCharts(cc) {
  const dayMap = {};
  // Pre-split all trades in one pass into 6 buckets + day map
  const sb=[], sbr=[], lb=[], lbr=[], lpb=[], lpr=[], leapsAll=[];
  let etfCount = 0;
  for (let i = 0; i < cc.length; i++) {
    const t = cc[i];
    if (t.stocketf === "ETF" || t.stocketf === "INDEX") etfCount++;
    if (t.Dt) {
      if (!dayMap[t.Dt]) dayMap[t.Dt] = { d:t.Dt, b:0, r:0 };
      t.D === "BULL" ? (dayMap[t.Dt].b += t.P) : (dayMap[t.Dt].r += t.P);
    }
    const dte = t.DTE;
    if (dte >= 0 && dte < 60) {
      t.D === "BULL" ? sb.push(t) : t.D === "BEAR" ? sbr.push(t) : 0;
    } else if (dte >= 60 && dte < 180) {
      t.D === "BULL" ? lb.push(t) : t.D === "BEAR" ? lbr.push(t) : 0;
    } else if (dte >= 180) {
      leapsAll.push(t);
      t.D === "BULL" ? lpb.push(t) : t.D === "BEAR" ? lpr.push(t) : 0;
    }
  }
  const DAYS = Object.values(dayMap).sort((a,b) => {
    const [am,ad] = a.d.split("/").map(Number);
    const [bm,bd] = b.d.split("/").map(Number);
    return am!==bm ? am-bm : ad-bd;
  });
  const SB_SYM = netByTicker(sb);
  const SR_SYM = netByTicker(sbr);
  const LB_SYM = netByTicker(lb);
  const LR_SYM = netByTicker(lbr);
  const LEAPS_B = netByTicker(lpb);
  const LEAPS_R = netByTicker(lpr);
  const SBL = topTradesFn(sb);
  const SBR = topTradesFn(sbr);
  const LBL = topTradesFn(lb);
  const LBR_T = topTradesFn(lbr);
  const LEAPS_BL_T = topTradesFn(lpb);
  const LEAPS_BR_T = topTradesFn(lpr);
  const SBLC = consistencyTable(sb);
  const SBRC = consistencyTable(sbr);
  const LBLC = consistencyTable(lb);
  const LBRC = consistencyTable(lbr);
  const LEAPS_BLC = consistencyTable(lpb);
  const LEAPS_BRC = consistencyTable(lpr);
  const leapsExpMap = {};
  leapsAll.forEach(t => {
    if (!leapsExpMap[t.E]) leapsExpMap[t.E] = { exp:t.E, p:0, n:0, dte:t.DTE, syms:{} };
    leapsExpMap[t.E].p += t.P; leapsExpMap[t.E].n++;
    leapsExpMap[t.E].syms[t.S] = (leapsExpMap[t.E].syms[t.S]||0) + t.P;
  });
  const LEAPS_EXPS = Object.values(leapsExpMap).sort((a,b)=>b.p-a.p).slice(0,6)
    .map(e => ({ exp:e.exp, p:e.p, n:e.n, dte:e.dte+"d",
      names: Object.entries(e.syms).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([s,p])=>s+" $"+(p/1e6).toFixed(1)+"M").join(", ") }));
  const allCons = {}; const consTrades = {};
  cc.forEach(t => {
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!allCons[k]) allCons[k] = { sym:t.S, cp:t.CP, K:t.K, exp:t.E, DTE:t.DTE, stocketf:t.stocketf, hits:0, prem:0, vol:0, dir:t.D,
      hasAA:false, hasBB:false, hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true,
      bullPrem:0, bearPrem:0, askPrem:0, bidPrem:0, dominantOverride:false, maxOI:0, er:t.er||false,
      uoa:false, mktcap:t.mktcap||0, ivs:[], spots:[], prices:[], sideTimes:[] };
    if (!consTrades[k]) consTrades[k] = [];
    consTrades[k].push(t);
    allCons[k].hits++; allCons[k].prem += t.P; allCons[k].vol += t.V;
    if (t.D === "BULL") allCons[k].bullPrem += t.P;
    if (t.D === "BEAR") allCons[k].bearPrem += t.P;
    if (t.Si==="AA") allCons[k].hasAA = true;
    if (t.Si==="BB") allCons[k].hasBB = true;
    if (t.Si==="A"||t.Si==="AA") allCons[k].askPrem += t.P;
    if (t.Si==="B"||t.Si==="BB") allCons[k].bidPrem += t.P;
    if (t.Ty==="SWP") allCons[k].hasSweep = true;
    if (t.Ty==="BLK") allCons[k].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") allCons[k].oiExceeded = true;
    if (t.D) allCons[k].dirs.add(t.D);
    if (t.uoa) allCons[k].uoa = true;
    if (t.mktcap > allCons[k].mktcap) allCons[k].mktcap = t.mktcap;
    if (t.OI > allCons[k].maxOI) allCons[k].maxOI = t.OI;
    // Track IV, spot, price, and side with time for pattern detection
    if (t.IV > 0) allCons[k].ivs.push(t.IV);
    if (t.Spot > 0) allCons[k].spots.push(t.Spot);
    if (t.price > 0) allCons[k].prices.push(t.price);
    allCons[k].sideTimes.push({ si:t.Si, time:t.time||"", prem:t.P });
  });

  // ── Derived oiExceeded pass ────────────────────────────────────────────────
  // Set oiExceeded from cluster-level vol vs maxOI on any cluster where the
  // Color-based signal wasn't already set. YELLOW/MAGENTA is BBS's flag that
  // day volume pushed past OI — Massive-sourced rows come through as WHITE
  // by default, so we compute the same condition ourselves once maxOI has
  // been enriched (on-demand OI fetch runs at ~95% populated rate). Runs
  // BEFORE the B-side conviction override below so its oiExceeded check
  // benefits from the derived signal too.
  Object.values(allCons).forEach(c => {
    if (!c.oiExceeded && c.maxOI > 0 && c.vol > c.maxOI) c.oiExceeded = true;
  });

  // ── B-side conviction override ─────────────────────────────────────────────
  // Fix: if first trade had D=null but later trades have direction, inherit it
  // Also: B-side-only confirmed clusters with high premium + sweep = directional
  Object.values(allCons).forEach(c => {
    // Fix 1: inherit direction from dirs if c.dir is null but dirs has entries
    if (!c.dir && c.dirs.size === 1) {
      c.dir = [...c.dirs][0];
    }
    // Fix 2: B-side conviction — confirmed B-side calls/puts with sweep + substantial premium
    // B-side buying calls = bullish intent when confirmed by YELLOW/MAGENTA + high premium
    if (!c.dir && c.oiExceeded && c.hasSweep && c.prem >= 200000 && c.bidPrem > 0 && c.askPrem === 0) {
      if (c.cp === "C") { c.dir = "BULL"; c.dirs.add("BULL"); }
      else if (c.cp === "P") { c.dir = "BEAR"; c.dirs.add("BEAR"); }
    }
  });

  const preSort = Object.values(allCons).filter(c=>c.dir).map(c => {
    c.clean = c.dirs.size <= 1;
    // 80% dominant direction override — if one side has 80%+ of premium, treat as clean
    if (!c.clean) {
      const totalDir = c.bullPrem + c.bearPrem;
      if (totalDir > 0) {
        if (c.bullPrem / totalDir >= 0.8) { c.clean = true; c.dir = "BULL"; c.dominantOverride = true; }
        else if (c.bearPrem / totalDir >= 0.8) { c.clean = true; c.dir = "BEAR"; c.dominantOverride = true; }
      }
    }
    // ── Pattern-based oiExceeded (Massive maxOI=0 rescue) ──────────────────
    // When maxOI is 0 (Massive-sourced, un-enriched), credit oiExceeded if
    // the cluster shows the institutional signature: SWEEP + BLOCK + clean
    // + direction + $2M+ premium AND DTE >= 3. The DTE floor excludes 0-2
    // DTE dealer hedging (TSLA/QQQ/SPY 0DTE puts with SWEEP+BLOCK patterns
    // are mechanical expiration-day activity, not directional positioning).
    if (!c.oiExceeded && c.maxOI === 0 && (c.DTE || 0) >= 3 && c.hasSweep && c.hasBlock &&
        c.clean && c.dir && c.prem >= 2e6) {
      c.oiExceeded = true;
    }
    const grade = gradeCluster(c);
    const scoreMap = {"A+":600,"A":500,"B+":400,"B":300,"C":200,"D":100};
    // Vol/OI ratio bonus — rewards unusually high activity relative to open interest
    // 3x+ vol/OI on a mid-cap is far more significant than 0.5x on a mega-cap
    const volOI = c.maxOI > 0 ? c.vol / c.maxOI : 0;
    const voiBonus = Math.min(volOI, 5) * 80; // caps at 5x = +400
    const k = c.sym+"|"+c.cp+"|"+c.K+"|"+c.exp;
    const trades = (consTrades[k]||[]).sort((a,b)=>b.P-a.P);
    // ── Time concentration ────────────────────────────────────────────────
    // Max # of ASK-side SWEEP prints in any 10-minute window on this contract.
    // Signals institutional urgency: SPCX-style 5 whale sweeps in ~8 min
    // is qualitatively different from BE-style 20 sweeps spread over 90 min.
    // Feeds into autoScore's time-concentration bonus downstream.
    let _timeConc = 0;
    {
      const parseT = (ts) => {
        const m = (ts||"").match(/(\d+):(\d+):(\d+)\s*(AM|PM)?/i);
        if (!m) return -1;
        let h = parseInt(m[1]);
        const pm = (m[4]||"").toUpperCase() === "PM";
        if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0;
        return h*3600 + parseInt(m[2])*60 + parseInt(m[3]);
      };
      const askTs = trades
        .filter(t => t.Ty === "SWP" && (t.Si === "A" || t.Si === "AA"))
        .map(t => parseT(t.time))
        .filter(ts => ts >= 0)
        .sort((a,b) => a - b);
      if (askTs.length >= 3) {
        let l = 0, best = 1;
        for (let r = 0; r < askTs.length; r++) {
          while (askTs[r] - askTs[l] > 600) l++;
          if (r - l + 1 > best) best = r - l + 1;
        }
        _timeConc = best;
      }
    }
    return { ...c, grade, volOI, _timeConc, score:(scoreMap[grade]||0)+c.hits*20+c.prem/5e3+voiBonus + (c.hits<=1 && c.hasSweep && c.askPrem>c.bidPrem && c.oiExceeded && c.prem >= ((c.mktcap||0)>=500e9 ? 5e6 : 1e6) ? 250 : 0),
      side: c.askPrem >= c.bidPrem ? (c.hasAA ? "AA" : "ASK") : (c.hasBB ? "BB" : "BID"),
      strike:"$"+c.K+c.cp, trades, patterns:detectPatterns(c) };
  }).filter(c => {
    if (!c.clean) return false;
    // DTE filter: remove dying weeklies UNLESS premium is substantial ($500K+)
    if (c.DTE <= 7 && c.prem < 500000) return false;
    // Re-check expiry against today — parse c.exp "M/D" or "M/D/YYYY" at render time
    // so expired contracts disappear even if DTE in CSV was still positive
    if (c.exp) {
      const p = c.exp.split("/").map(Number);
      const y = p.length >= 3 ? (p[2] < 100 ? p[2] + 2000 : p[2]) : (new Date().getMonth()+1 > p[0] ? new Date().getFullYear()+1 : new Date().getFullYear());  // FIX: 2-digit years from formatExp ("5/21/27") need +2000, else JS Date treats as 1927 and LEAPS get marked "expired"
      const expDate = new Date(y, p[0]-1, p[1], 23, 59, 59); // end of expiry day
      if (expDate < new Date()) return false;
    }
    return true;
  });
  // Ticker-level aggregation — boost scores when multiple clean contracts exist on same ticker
  const tickerHeat = {};
  preSort.forEach(c => {
    if (!tickerHeat[c.sym]) tickerHeat[c.sym] = { contracts:0, totalPrem:0, strikes:new Set(), exps:new Set(), dirs:new Set(), grades:[] };
    const th = tickerHeat[c.sym];
    th.contracts++;
    th.totalPrem += c.prem;
    th.strikes.add(c.K);
    th.exps.add(c.exp);
    th.dirs.add(c.dir);
    th.grades.push(c.grade);
  });
  // Apply ticker heat bonus
  const CONV = preSort.map(c => {
    const th = tickerHeat[c.sym];
    let heatBonus = 0;
    if (th.contracts >= 2) heatBonus += Math.min(th.contracts, 6) * 50; // +50-300 for multi-contract
    if (th.exps.size >= 2) heatBonus += th.exps.size * 40; // +80-200 for multi-expiry (urgency)
    if (th.strikes.size >= 2) heatBonus += th.strikes.size * 20; // +40-120 for strike spread
    if (th.totalPrem >= 5e6) heatBonus += 200; // $5M+ aggregate = institutional
    else if (th.totalPrem >= 2e6) heatBonus += 100;
    else if (th.totalPrem >= 1e6) heatBonus += 50;
    // Only boost if direction is consistent (all bull or all bear)
    if (th.dirs.size > 1) heatBonus = Math.floor(heatBonus * 0.3); // mixed direction = reduce bonus
    return { ...c, score: c.score + heatBonus, tickerHeat: th.contracts >= 2 ? { contracts:th.contracts, totalPrem:th.totalPrem, strikes:th.strikes.size, exps:th.exps.size } : null };
  })
  .sort((a,b)=>b.score-a.score)
  .map(c => ({ sym:c.sym, cp:c.cp, K:c.K, strike:c.strike, exp:c.exp, DTE:c.DTE, hits:c.hits, prem:c.prem, side:c.side, dir:c.dir, grade:c.grade, score:c.score||0, dominantOverride:c.dominantOverride||false, volOI:c.volOI||0, er:c.er||false, mktcap:c.mktcap||0, maxOI:c.maxOI||0, vol:c.vol||0, bullPrem:c.bullPrem||0, bearPrem:c.bearPrem||0, tickerHeat:c.tickerHeat, uoa:c.uoa||false,
    trades:c.trades.map(t=>({ Ty:t.Ty, Si:t.Si, Co:t.Co, V:t.V, P:t.P, DTE:t.DTE, OI:t.OI||0, IV:t.IV||0, time:t.time||"", Dt:t.Dt||"", price:t.price||0, Spot:t.Spot||0 })), patterns:c.patterns||[] }));
  const sectorMap = {};
  const tickerFlowMap = {};
  cc.forEach(t => {
    const sec = resolveSector(t.S, t.sector);
    if (!sectorMap[sec]) sectorMap[sec] = { name:sec, bull:0, bear:0, count:0, tickers:{} };
    sectorMap[sec].count++;
    t.D === "BULL" ? (sectorMap[sec].bull += t.P) : (sectorMap[sec].bear += t.P);
    if (!sectorMap[sec].tickers[t.S]) sectorMap[sec].tickers[t.S] = { s:t.S, p:0, bull:0, bear:0 };
    sectorMap[sec].tickers[t.S].p += t.P;
    t.D === "BULL" ? (sectorMap[sec].tickers[t.S].bull += t.P) : (sectorMap[sec].tickers[t.S].bear += t.P);
    // Also build per-ticker map for fallback
    if (!tickerFlowMap[t.S]) tickerFlowMap[t.S] = { name:t.S, bull:0, bear:0, count:0, tickers:{}, stocketf:t.stocketf };
    tickerFlowMap[t.S].count++;
    t.D === "BULL" ? (tickerFlowMap[t.S].bull += t.P) : (tickerFlowMap[t.S].bear += t.P);
    tickerFlowMap[t.S].tickers[t.S] = tickerFlowMap[t.S].tickers[t.S] || { s:t.S, p:0, bull:0, bear:0 };
    tickerFlowMap[t.S].tickers[t.S].p += t.P;
    t.D === "BULL" ? (tickerFlowMap[t.S].tickers[t.S].bull += t.P) : (tickerFlowMap[t.S].tickers[t.S].bear += t.P);
  });
  // If fewer than 3 meaningful sectors (e.g. all ETFs/indexes = "None"), show individual tickers
  const meaningfulSectors = Object.keys(sectorMap).filter(s => s !== "None" && s !== "Unknown" && s !== "");
  const useTickers = meaningfulSectors.length < 3;
  // Detect if majority of trades are ETFs/indexes
  const isETFData = etfCount > cc.length * 0.5;
  // When in ETF mode, exclude non-ETF/INDEX tickers (e.g. AAL misclassified by BBS)
  const etfFiltered = isETFData
    ? Object.values(tickerFlowMap).filter(t => t.stocketf === "ETF" || t.stocketf === "INDEX")
    : Object.values(tickerFlowMap);
  const SECTORS = useTickers
    ? etfFiltered.sort((a,b)=>(b.bull+b.bear)-(a.bull+a.bear)).slice(0,16)
        .map(s => ({ ...s, topTickers: Object.values(s.tickers).sort((a,b)=>b.p-a.p).slice(0,5) }))
    : Object.values(sectorMap).sort((a,b)=>(b.bull+b.bear)-(a.bull+a.bear)).slice(0,8)
        .map(s => ({ ...s, topTickers: Object.values(s.tickers).sort((a,b)=>b.p-a.p).slice(0,5) }));
  // ── Theme aggregation ──
  const themeMap = {};
  cc.forEach(t => {
    const themes = THEME_LOOKUP[t.S];
    if (!themes) return;
    themes.forEach(th => {
      if (!themeMap[th]) themeMap[th] = { name:th, bull:0, bear:0, count:0, tickers:{} };
      themeMap[th].count++;
      t.D === "BULL" ? (themeMap[th].bull += t.P) : (themeMap[th].bear += t.P);
      if (!themeMap[th].tickers[t.S]) themeMap[th].tickers[t.S] = { s:t.S, p:0, bull:0, bear:0 };
      themeMap[th].tickers[t.S].p += t.P;
      t.D === "BULL" ? (themeMap[th].tickers[t.S].bull += t.P) : (themeMap[th].tickers[t.S].bear += t.P);
    });
  });
  const THEMES = Object.values(themeMap)
    .filter(th => th.count >= 2)
    .sort((a,b) => (b.bull+b.bear) - (a.bull+a.bear))
    .map(th => ({ ...th, topTickers: Object.values(th.tickers).sort((a,b)=>b.p-a.p).slice(0,5) }));
  return {
    DAYS, CONV, SB_SYM, SR_SYM, LB_SYM, LR_SYM, LEAPS_B, LEAPS_R,
    SBL, SBR, LBL, LBR_T, LEAPS_BL_T, LEAPS_BR_T,
    SBLC, SBRC, LBLC, LBRC, LEAPS_BLC, LEAPS_BRC, LEAPS_EXPS, SECTORS, THEMES,
    sectorTickerMode: useTickers, sectorIsETF: isETFData,
    shortBullTotal:sum(sb),
    shortBearTotal:sum(sbr),
    longBullTotal:sum(lb),
    longBearTotal:sum(lbr),
    leapsBullTotal:sum(lpb),
    leapsBearTotal:sum(lpr),
  };
}

// ─── Data Processing ───────────────────────────────────────────────────────────
export function processFlowData(rows, erSoonSet) {
  const rawTrades = rows.map(r => {
    const typeRaw = (r.type || "").toUpperCase().trim();
    const isML = typeRaw === "ML/" || typeRaw.startsWith("ML/");
    const isSWP = typeRaw === "SWEEP" || typeRaw.includes("SWP");
    const isBLK = typeRaw === "BLOCK" || typeRaw.includes("BLK");
    const cpRaw = (r.cp || "").toUpperCase().trim();
    const cp = cpRaw === "CALL" ? "C" : cpRaw === "PUT" ? "P" : cpRaw.replace(/[^CP]/g,"").slice(0,1);
    const strike = parseFloat(r.strike) || 0;
    const spot = parseFloat(r.spot) || 0;
    const volume = parseInt((r.volume||"").replace(/,/g,"")) || 0;
    const oi = parseInt((r.oi||"").replace(/,/g,"")) || 0;
    const premium = parseFloat((r.premium||"").replace(/[$,]/g,"")) || 0;
    const price = parseFloat((r.price||"").replace(/[$,]/g,"")) || 0;
    const iv = parseFloat(r.iv) || 0;
    const mktcap = parseFloat(r.mktcap) || 0;
    const sector = (r.sector || "").trim();
    const uoa = (r.uoa || "").toUpperCase().trim() === "T";
    const sr = (r.side||"").toUpperCase().trim();
    let side = sr;
    if (sr.includes("ABOVE") || sr==="AA") side = "AA";
    else if (sr.includes("BELOW") || sr==="BB") side = "BB";
    else if (sr==="A" || sr.includes("ASK")) side = "A";
    else if (sr==="B" || sr.includes("BID")) side = "B";
    const cr = (r.color||"").toUpperCase().trim();
    let color = "WHITE";
    if (cr === "YELLOW" || cr === "Y") color = "YELLOW";
    else if (cr === "MAGENTA" || cr === "PURPLE" || cr === "M") color = "MAGENTA";
    else if (cr === "ORANGE") color = "ORANGE";
    else if (cr === "RED" || cr === "#FF0000") color = "RED";
    else if (cr === "ARB") color = "ARB";
    const expiry = parseExpiry(r.expiry);
    const dteParsed = parseInt(r.dte);
    const dte = !isNaN(dteParsed) && dteParsed >= 0 ? dteParsed : (expiry ? computeDTE(expiry) : -1);
    const expStr = expiry ? formatExp(expiry) : (r.expiry||"");
    let dt = "";
    const dateRaw = r.date||"";
    if (dateRaw) {
      const dp = dateRaw.split("/");
      dt = dp.length >= 2 ? parseInt(dp[0])+"/"+parseInt(dp[1]) : dateRaw.slice(0,5);
    }
    // Deep ITM/OTM detection for arb filtering
    // Blocks: 10%+ ITM = arb (e.g. MSFT 480p with spot 405 = 18.5% ITM, clearly arb)
    // Sweeps: 20%+ from spot (urgency still noteworthy at 10-19%)
    const pctFromSpot = spot > 0 ? Math.abs(strike - spot) / spot * 100 : 0;
    const typeRawForDeep = (r.type || "").toUpperCase().trim();
    const isBlock = typeRawForDeep === "BLOCK" || typeRawForDeep.includes("BLK");
    const isDeep = isBlock ? pctFromSpot >= 10 : pctFromSpot >= 20;
    // Direction logic per flow rules
    let confirmed = color === "YELLOW" || color === "MAGENTA";
    let direction = null;
    // "Primarily look for Ask/Above Ask for directional bets"
    // B trades = ambiguous (closing, repositioning, hedging) - never directional
    // BB Blocks = repositioning/institutional - never directional
    // BB Sweeps only = urgently selling (known institutional signal) - directional
    if (cp) {
      if (cp === "C") {
        if (side === "AA" || side === "A") direction = "BULL";
        else if (side === "BB" && isSWP) direction = "BEAR"; // BB sweep call = selling calls = bearish
        // B Call / BB Block Call = ambiguous/repositioning, no direction
      } else {
        if (side === "AA" || side === "A") direction = "BEAR";
        else if (side === "BB" && isSWP) direction = "BULL"; // BB sweep put = selling puts = bullish
        // B Put / BB Block Put = ambiguous/repositioning, no direction
      }
      // Lottery ticket filter: way OTM + short DTE = noise, not conviction
      // Uses live DTE (from expiry date vs today), not historical CSV DTE
      // Only mega/large caps — small caps are volatile, keep all their flow
      const liveDte = expiry ? computeDTE(expiry) : dte;
      if (direction && spot > 0 && liveDte >= 0 && liveDte <= 7 && mktcap >= 10e9) {
        const isOTM = (cp === "C" && strike > spot) || (cp === "P" && strike < spot);
        if (isOTM) {
          const otmPct = Math.abs(strike - spot) / spot * 100;
          const otmLimit = mktcap >= 200e9 ? 10 : 15;
          if (otmPct >= otmLimit) { direction = null; confirmed = false; }
        }
      }
    }
    return {
      S:(r.ticker||"").toUpperCase().trim(), Ty:isSWP?"SWP":isBLK?"BLK":null,
      CP:cp, K:strike, V:volume, P:premium, price,
      E:expStr, expiry, Si:side, Co:color, DTE:dte, Dt:dt,
      D:direction, OI:oi, IV:iv, Spot:spot, isML, confirmed,
      mktcap, sector, uoa, isDeep, pctFromSpot,
      er:(erSoonSet instanceof Set)
        ? erSoonSet.has((r.ticker||"").toUpperCase().trim())
        : ((r.er||"").toUpperCase().trim() === "T"),
      stocketf:(r.stocketf||"").toUpperCase().trim(),
      time:(r.time||"").trim()
    };
  });

  // Fix BBS misclassifications — these are stocks, not ETFs/indexes
  const ETF_BLACKLIST = new Set(["AAL"]);
  // Fix BBS misclassifications — these are ETFs, not stocks
  const STOCK_BLACKLIST = new Set(["DRAM"]);
  rawTrades.forEach(t => {
    if (ETF_BLACKLIST.has(t.S)) t.stocketf = "STOCK";
    if (STOCK_BLACKLIST.has(t.S)) t.stocketf = "ETF";
  });

  // ML/ Volume Matching: when an ML/ trade has the same volume as a BLOCK/SWEEP
  // at the same ticker+strike+exp, it means the original position was closed/rolled
  // as part of a multi-leg. Remove the matching original trade too.
  const mlMatched = new Set();
  {
    const mlTrades = rawTrades.filter(t => t.isML && t.S && t.V > 0);
    if (mlTrades.length > 0) {
      // Build hash map for O(1) lookup instead of O(n) .find()
      const nonMLMap = {};
      rawTrades.forEach((t, idx) => {
        if (t.isML || !t.Ty || !t.S || t.V <= 0) return;
        const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E + "|" + t.V;
        if (!nonMLMap[k]) nonMLMap[k] = [];
        nonMLMap[k].push({ trade: t, idx });
      });
      mlTrades.forEach(ml => {
        const k = ml.S + "|" + ml.CP + "|" + ml.K + "|" + ml.E + "|" + ml.V;
        const candidates = nonMLMap[k];
        if (candidates) {
          const match = candidates.find(c => !mlMatched.has(c.trade));
          if (match) mlMatched.add(match.trade);
        }
      });
    }
  }

  // ── Cancel-pair filter ─────────────────────────────────────────────────────
  // BlackBoxStocks marks canceled orders with Color=RED. Each red entry
  // CANCELS a previously-recorded real trade with the same composite key
  // (same ticker, CP, strike, exp, type, side, premium) — they are NOT
  // standalone phantom entries. To compute accurate aggregations, we must
  // exclude BOTH the original AND the red marker.
  //
  // Example QRVO 6/22:
  //   11:21:50 CALL $115 $5M MAGENTA (original real fill)
  //   11:26:28 CALL $115 $5M RED     (cancellation of that $5M)
  // Without this filter, the Top Bullish aggregation would count the $5M
  // twice (or once, depending on whether the red is filtered). With this
  // filter, both rows are excluded — net effect: no $5M trade occurred.
  //
  // Empirically (June 2026 sample): 54 cancel pairs matched, 81 orphan
  // reds with no prior match (excluded as just the red row). Matching
  // is always same-day in practice.
  const canceledTrades = new Set();
  {
    // Parse "H:MM:SS AM/PM" → seconds since midnight for correct time sort.
    // localeCompare on raw strings would put "12:00 PM" before "9:00 AM"
    // (because "1" < "9" lexically), so we need real time parsing.
    const parseTimeToSec = (t) => {
      if (!t) return 0;
      const m = t.match(/(\d+):(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return 0;
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      const sec = parseInt(m[3]);
      const ampm = m[4].toUpperCase();
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return h * 3600 + min * 60 + sec;
    };

    // Group by (date, composite key). Same-day matching only — cancellations
    // happen within minutes/hours of the original, never cross-day in
    // observed data.
    const groups = {};
    rawTrades.forEach(t => {
      const key = `${t.Dt}|${t.S}|${t.CP}|${t.K}|${t.E}|${t.Ty}|${t.Si}|${t.P}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    Object.values(groups).forEach(trades => {
      // Time-sort within group. After sort, iterate; pop most recent
      // non-red original whenever a red appears.
      trades.sort((a, b) => parseTimeToSec(a.time) - parseTimeToSec(b.time));
      const originalStack = [];
      trades.forEach(t => {
        if (t.Co === "RED") {
          if (originalStack.length > 0) {
            canceledTrades.add(originalStack.pop()); // matched original
          }
          canceledTrades.add(t); // always exclude the red marker
        } else {
          originalStack.push(t);
        }
      });
    });
  }

  // ── Massive ML/ rescue: isolation + same-day flow-shape direction ─────────
  // Massive uses ML/ as a catch-all for multi-print aggregation it can't
  // cleanly classify — including legitimate multi-exchange sweeps. Example:
  // SMCI 31c 8/21 at 1:53:37 — BBS shows 3 AA sweeps V=3035+3581+2876=9492
  // for $2.5M; Massive delivers a single ML/ V=9492 with empty side. The
  // default !t.isML filter correctly drops real multi-leg spreads but
  // silently kills these misclassified sweeps. Rescue them via two rules:
  //   (B) Isolation: an ML/ with NO sibling ML/ on the same ticker+CP at
  //       a DIFFERENT (strike, exp) within 5s isn't a real spread. Real
  //       spreads emit multiple near-simultaneous ML/ rows across legs.
  //   (C) Direction from same-day flow shape: for rescued ML/, examine
  //       non-ML SWEEP activity on the same (ticker, cp, strike, exp)
  //       with side classified. If ASK premium >= 70% of total, mark
  //       synthetic Si="A" and derive direction from CP; otherwise leave
  //       empty (won't drive direction but counts toward premium heat).
  // Rescued ML/ becomes Ty="SWP" so it flows through the existing whale
  // rescue and CONV pipeline. Guarded: only ML/ with meaningful premium
  // (>= $100K) is considered — micro ML/ prints stay filtered as noise.
  {
    const _parseTs = (ts) => {
      if (!ts) return -1;
      const m = ts.match(/(\d+):(\d+):(\d+)\s*(AM|PM)?/i);
      if (!m) return -1;
      let h = parseInt(m[1]);
      const mm = parseInt(m[2]);
      const ss = parseInt(m[3]);
      const pm = (m[4] || "").toUpperCase() === "PM";
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
      return h * 3600 + mm * 60 + ss;
    };
    // Same-day flow shape from non-ML SWEEP trades with classified side.
    const flowShape = {};
    rawTrades.forEach(t => {
      if (t.isML || t.Ty !== "SWP" || !t.S || !t.CP) return;
      const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;
      if (!flowShape[k]) flowShape[k] = { ask: 0, bid: 0 };
      if (t.Si === "A" || t.Si === "AA") flowShape[k].ask += t.P;
      else if (t.Si === "B" || t.Si === "BB") flowShape[k].bid += t.P;
    });
    // ML/ index by ticker+CP for sibling detection.
    const mlIndex = {};
    rawTrades.forEach(t => {
      if (!t.isML || !t.S || !t.CP) return;
      const k = t.S + "|" + t.CP;
      if (!mlIndex[k]) mlIndex[k] = [];
      mlIndex[k].push({ trade: t, ts: _parseTs(t.time), strike: t.K, exp: t.E });
    });
    let _rescued = 0, _rescuedWithDir = 0;
    rawTrades.forEach(t => {
      if (!t.isML || !t.S || !t.CP) return;
      if (t.V <= 0 || t.P < 100000) return;
      if (mlMatched.has(t)) return;  // already paired with a leg — treat as real spread
      // Skip BBS-sourced ML/ rows. BBS's ML/ label means "leg of a multi-leg
      // spread" — each leg emitted as its own row with real side classification.
      // Isolated BBS ML/ (single-leg events, ~19% of BBS ML/) are orphan legs
      // whose siblings didn't cluster within 5s, NOT directional signals.
      // Massive uses ML/ as a catch-all for multi-print aggregations, which
      // IS what our rescue was designed for. Discriminate by OI: Massive rows
      // ingest with OI=0 (enrichment happens later); BBS populates OI upstream.
      if ((t.OI || 0) > 0) return;
      const myTs = _parseTs(t.time);
      if (myTs < 0) return;  // unparseable time — safest to leave filtered
      const symCP = t.S + "|" + t.CP;
      const siblings = (mlIndex[symCP] || []).filter(o =>
        o.trade !== t &&
        (o.strike !== t.K || o.exp !== t.E) &&
        o.ts >= 0 &&
        Math.abs(o.ts - myTs) <= 5
      );
      if (siblings.length > 0) return;  // real multi-leg spread — leave filtered
      // Isolated ML/ — rescue as synthetic SWEEP.
      t.isML = false;
      t.Ty = "SWP";
      _rescued++;
      // Direction attribution from same-day flow shape (Option C).
      // Base gate: DTE >= 14. Short-dated Massive ML/ can't be reliably
      // attributed via flow shape because Massive doesn't classify BID
      // sweeps — the shape reads 100% ASK trivially. On short-DTE names
      // (dealer/day-trader window) that false-positive gets attributed
      // BULL when it's often just churn (verified against AAPL 305c 7/6).
      // Exception: allow attribution on short-DTE ML/ if it's a clean
      // isolated whale event — single ML/ on this specific contract same
      // day AND premium >= $2M. The AAPL 305c pattern (7 ML/ scattered
      // through the day) fails this check; a NBIS-style single $2M+
      // whale hitting one strike passes. "Size + clean" per user note.
      const shape = flowShape[t.S + "|" + t.CP + "|" + t.K + "|" + t.E];
      const sameContractML = (mlIndex[symCP] || []).filter(o =>
        o.strike === t.K && o.exp === t.E
      );
      // Clean-whale exception: allow short-DTE attribution when the ML/ is
      // a genuinely isolated large event on the contract (single ML/ same
      // day, premium >= $2M). DTE >= 3 floor excludes 0-2 DTE where the
      // pattern is dominated by expiration-day mechanics (block cleanup,
      // synthetic position close, spread legs) rather than directional
      // positioning — verified MU $1120 PUT 7/2 DTE=0 $3.1M correctly
      // stays direction-less under this rule.
      const isCleanWhale = t.P >= 2e6 && sameContractML.length === 1 && (t.DTE || 0) >= 3;
      if (shape && ((t.DTE || 0) >= 14 || isCleanWhale)) {
        const total = shape.ask + shape.bid;
        if (total > 0 && shape.ask / total >= 0.7) {
          t.Si = "A";
          t.D = t.CP === "C" ? "BULL" : "BEAR";
          t._rescueDerived = true; // marker: direction inferred from flow shape, not clean-classified
          _rescuedWithDir++;
        }
      }
    });
    if (_rescued > 0) console.log("[ML/ rescue] rescued " + _rescued +
      " isolated ML/ trades (" + _rescuedWithDir + " with derived direction from 70%+ ASK flow shape)");
  }

  // Filter: remove ML/, RED + matching originals (cancel pairs), invalid,
  // and ML/-matched trades. The canceledTrades Set built above contains
  // both the red markers AND their matched originals.
  let filtered = rawTrades.filter(t =>
    !t.isML && t.S && t.Ty && t.CP && t.DTE >= 0 && t.V > 0 && t.P > 0 && !canceledTrades.has(t) && !mlMatched.has(t)
  );

  // ── Same-timestamp multi-strike spread filter ────────────────────────────────
  // When multiple DIFFERENT strikes on the same ticker+CP arrive at the exact same
  // second, it's a multi-leg spread/institutional repositioning (like the MSFT
  // 460/465/470/475/480/485/490/495/500/505/510/515p all hitting at 2:13:50).
  // Filter out ALL trades in that timestamp group — same logic as ML/, just
  // structured as individual BLOCK fills instead of a labeled multi-leg.
  {
    const tsKey = {}; // "TICKER|CP|TIME" -> Set of strikes seen
    filtered.forEach(t => {
      const k = t.S + "|" + t.CP + "|" + t.time;
      if (!tsKey[k]) tsKey[k] = new Set();
      tsKey[k].add(t.K);
    });
    const spreadKeys = new Set(
      Object.entries(tsKey)
        .filter(([, strikes]) => strikes.size >= 3) // 3+ different strikes same second = spread
        .map(([k]) => k)
    );
    if (spreadKeys.size > 0) {
      filtered = filtered.filter(t => {
        const k = t.S + "|" + t.CP + "|" + t.time;
        return !spreadKeys.has(k);
      });
    }
  }

  // Remove ORANGE (dark pool / delayed) from primary analysis but keep for reference
  const darkPool = filtered.filter(t => t.Co === "ORANGE");
  filtered = filtered.filter(t => t.Co !== "ORANGE");

  // Remove ARB (backend cluster_filter flagged these as structured arbitrage
  // noise — 4+ same-second multi-contract clusters on same ticker, e.g. LULU
  // 5-strike PUT block at 15:46:16 = $54M of position management not signal).
  // The backend tags them so we don't need to re-detect client-side; just
  // exclude from all aggregation, leaderboards, sectors, and conviction scoring.
  filtered = filtered.filter(t => t.Co !== "ARB");

  // Arb filter: deep ITM/OTM detection
  // Deep ITM = always arb/rebalancing (e.g. MU $210P when spot $413), filter ALL
  // Deep OTM blocks alone = arb, but Sweep+Block at same deep OTM strike = noteworthy, keep
  const deepOTMBlockKeys = new Set();
  const deepOTMSweepKeys = new Set();
  filtered.forEach(t => {
    // Use consistent 10% threshold for cluster detection (not isDeep which differs by type)
    if (t.pctFromSpot < 10) return;
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    const isITM = (t.CP === "C" && t.K < t.Spot) || (t.CP === "P" && t.K > t.Spot);
    if (!isITM) { // deep OTM
      if (t.Ty === "BLK") deepOTMBlockKeys.add(k);
      if (t.Ty === "SWP") deepOTMSweepKeys.add(k);
    }
  });
  filtered = filtered.filter(t => {
    if (!t.isDeep) return true;
    const isITM = (t.CP === "C" && t.K < t.Spot) || (t.CP === "P" && t.K > t.Spot);
    // Deep ITM blocks = arb/rebalancing, filter. Deep ITM sweeps = urgency, keep.
    if (isITM && t.Ty === "BLK") return false;
    if (isITM) {
      // Additional guard: very deep ITM sweeps (intrinsic > 50% of spot) are
      // synthetic rolls / position transfers, not directional urgency. AXTI
      // $130p at spot $55 = intrinsic $75 (136% of spot) with trade prices
      // at $74.50 = essentially zero extrinsic = synthetic short roll, not
      // a bear signal. Any option this deep ITM has ~delta 1.0 and functions
      // as underlying stock, no directional information content.
      const intrinsic = t.CP === "C" ? (t.Spot - t.K) : (t.K - t.Spot);
      if (t.Spot > 0 && intrinsic > t.Spot * 0.5) return false;
      return true;
    }
    // Deep OTM: keep if both sweep and block exist at same strike
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (deepOTMBlockKeys.has(k) && deepOTMSweepKeys.has(k)) return true;
    // Otherwise filter out deep OTM blocks (arb)
    if (t.Ty === "BLK") return false;
    return true;
  });

  // Heavy-block non-directional rule (user 7/25):
  // A large BLOCK is negotiated/facilitated size (single large trade at one
  // exchange per the BBS spec) and is usually a dark-pool hedge leg, not a
  // directional bet — so the BLOCK PRINT ITSELF never counts toward the bull/
  // bear lean. Any SWEEPS at the same strike are real urgency and DO still
  // count on their own (they're separate prints with their own t.D). This
  // deliberately does NOT rescue the block when a sweep shares the strike: a
  // small sweep shouldn't launder a $30M+ facilitation block into "conviction."
  // The block stays in `filtered` so it still shows as SIZE (consMap sums P/V
  // unconditionally); only its DIRECTION is stripped.
  const HEAVY_BLOCK_PREMIUM = 10e6; // $10M; tune here
  filtered.forEach(t => {
    if (t.D && t.Ty === "BLK" && t.P >= HEAVY_BLOCK_PREMIUM) { t.D = null; t.heavyBlock = true; }
  });

  // Mega cap premium filter
  filtered = filtered.filter(t => premiumFilter(t.P, t.mktcap));

  // ── Confirmed-trade rescue for Massive-sourced whales ──────────────────────
  // BBS uses Color=YELLOW/MAGENTA to signal vol>OI, which drives t.confirmed
  // and gates the entire clean_confirmed → allCons → CONV → watchlist path.
  // Massive rows come through as Color=WHITE by default (Massive doesn't
  // publish Color info), so genuine institutional whales like SNDK $2730
  // 6/17/27 ($5.6M single SWEEP at ASK) get filtered out here BEFORE they
  // ever reach clustering — no downstream scoring or oiExceeded derivation
  // can help. Rescue two well-defined patterns:
  //   (a) Whale premium ($1M+) SWEEP at ASK — legit whale regardless of
  //       data source. BBS would surface these under any Color scheme.
  //   (b) Massive-sourced (identified by OI==0, since Massive rows come in
  //       without OI enrichment) SWEEP at ASK with $500K+ premium — the
  //       BBS pattern that lost its Color info in the Massive pipeline.
  // Guardrails: SWEEP + ASK-side only (no BLOCK, no BID-side), premium
  // floors, and t.D must be set (direction inferred).
  const _isRescuableWhale = (t) => {
    if (!t.D) return false;
    if (t.Ty !== "SWP") return false;
    if (t.Si !== "A" && t.Si !== "AA") return false;
    if (t.P >= 1e6) return true;
    if ((t.OI||0) === 0 && t.P >= 500e3) return true;
    return false;
  };

  // ── Sibling BLOCK rescue ──────────────────────────────────────────────────
  // Empty-side BLOCKs on Massive contracts get filtered because t.D is null,
  // but they're often part of the same institutional flow as a rescued whale
  // SWEEP on the same contract. Losing them drops `hasBlock=false` on the
  // cluster, which prevents grade A+ upgrade even when the pattern is clearly
  // institutional. Example: SPCX 165c 12/17/27 has 5 whale SWEEPs (rescued)
  // + 2 empty-side BLOCKs (would be dropped). Without the blocks, cluster
  // grade caps at B+ instead of A+, autoScore ~70% instead of ~78%.
  //
  // Rescue rule: if a BLOCK has empty side, premium >= $500K, OI=0 (Massive
  // signature), AND same contract has a rescued whale SWEEP — inherit the
  // whale's direction. Defensible because institutional flow typically
  // executes SWEEP + BLOCK on the same strike within the same window.
  const _rescuedContractDir = {};
  // Track total premium and whale-ASK premium per contract for the
  // dominance gate below. When ASK-classified whale sweeps don't dominate
  // a contract's flow, sibling BLOCKs are likely BID-side (BBS shows BID;
  // Massive shows empty) and rescuing them would flip mixed flow to
  // spuriously one-sided. Example: BE 9/18 $370c has ~$4M AA sweeps + ~$18M
  // B-side blocks per BBS. Massive shows the same as $4M SWEEP-A + $18M
  // empty-side blocks. Without the gate, we rescue all $18M as BULL —
  // completely inverting the actual net-BEAR flow.
  const _contractPrem = {};
  filtered.forEach(t => {
    if (!t.S || !t.CP) return;
    const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;
    if (!_contractPrem[k]) _contractPrem[k] = { total: 0, whaleAsk: 0 };
    _contractPrem[k].total += t.P;
    if (_isRescuableWhale(t)) _contractPrem[k].whaleAsk += t.P;
  });
  filtered.forEach(t => {
    if (!_isRescuableWhale(t)) return;
    const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;
    if (!_rescuedContractDir[k]) _rescuedContractDir[k] = t.D;
  });
  // Mark and set direction on eligible BLOCKs. Uses a marker (_rescuedBlock)
  // because the check runs both before assignment (identifying eligible
  // BLOCKs) and after (letting them through confirmed_trades) — needs a
  // stable flag independent of t.D mutation.
  filtered.forEach(t => {
    if (t.Ty !== "BLK") return;
    if (t.D) return;
    if (t.P < 500e3) return;
    if ((t.OI||0) !== 0) return;
    const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;
    const dir = _rescuedContractDir[k];
    if (!dir) return;
    // Dominance gate: only rescue if whale ASK sweeps represent >= 60% of
    // total premium on this contract. Under 60% suggests significant
    // non-ASK flow (either BID blocks or BID sweeps in the empty-side
    // pool) — mixed flow that shouldn't get one-directional attribution.
    // SPCX 165 12/17/27 passes: $8.58M whaleAsk / $9.79M total = 87%.
    // BE 9/18 $370c fails: $4.35M whaleAsk / ~$25M+ total ≈ 15%.
    const cp = _contractPrem[k];
    if (!cp || cp.total <= 0 || cp.whaleAsk / cp.total < 0.6) return;
    t.D = dir;
    t._rescuedBlock = true;
    t._rescueDerived = true; // marker: direction inherited from whale, not clean-classified
  });

  const confirmed_trades = filtered.filter(t => (t.confirmed && t.D) || _isRescuableWhale(t) || t._rescuedBlock);
  const unconfirmed = filtered.filter(t => !t.confirmed);
  // Also include Ask/Above Ask WHITE trades in directional analysis (they have direction but need OI check)
  const directional = filtered.filter(t => t.D);

  // ── Dirty cluster detection ──────────────────────────────────────────────────
  // Build a set of cluster keys where trades hit BOTH ask-side and bid-side
  // in an interleaved/mixed pattern (not the profit-taking pattern).
  // These trades should NOT count toward bar charts, daily flow, or Top Flow.
  // With updated direction rules (B=no direction, BB blocks=no direction),
  // only A/AA vs BB-sweep conflicts remain as "dirty".
  // Profit-taking exception: A/AA first → BB sweep later on short DTE (≤14d) = OK.
  const dirtyClusterKeys = new Set();
  {
    const clusterDirs = {};
    // Build cluster metadata in a single pass (assign _idx + cluster grouping)
    for (let i = 0; i < filtered.length; i++) {
      const t = filtered[i];
      t._idx = i;
      const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;
      if (!clusterDirs[k]) clusterDirs[k] = { dirs: new Set(), askTimes:[], askIVs:[], bidTimes:[], bidIVs:[], bbSweepTimes:[], hasBidSide:false, hasAskSide:false, hasSweep:false, dte:t.DTE, askPrem:0, bidPrem:0 };
      if (t.Si === "B" || t.Si === "BB") { clusterDirs[k].hasBidSide = true; clusterDirs[k].bidTimes.push(i); clusterDirs[k].bidPrem += t.P; if (t.IV > 0) clusterDirs[k].bidIVs.push(t.IV); }
      if (t.Si === "A" || t.Si === "AA") { clusterDirs[k].hasAskSide = true; clusterDirs[k].askTimes.push(i); clusterDirs[k].askPrem += t.P; if (t.IV > 0) clusterDirs[k].askIVs.push(t.IV); }
      if (t.Ty === "SWP") clusterDirs[k].hasSweep = true;
      if (!t.D) continue;
      clusterDirs[k].dirs.add(t.D);
      if (t.Si === "BB" && t.Ty === "SWP") clusterDirs[k].bbSweepTimes.push(i);
    }

    Object.entries(clusterDirs).forEach(([k, c]) => {
      // DTE <= 3: dying weeklies with any bid-side = day trading/scalping noise
      if (c.dte >= 0 && c.dte <= 3 && c.hasBidSide) {
        dirtyClusterKeys.add(k);
        return;
      }
      // Block-only clusters (no sweep at this strike) = usually noise.
      // EXCEPTION: institutional BLOCKs with significant premium ($500K+
      // on the ask side, with no opposing bid-side trades) are conviction
      // signals. A small mid-cap stock often won't get a sweep but still
      // surfaces real positioning via a single large block.
      // For Massive ingestion (which captures broader flow than BBS),
      // this exception recovers many otherwise-lost institutional trades.
      if (!c.hasSweep) {
        const bigAskBlock = c.askPrem >= 500000 && !c.hasBidSide;
        if (!bigAskBlock) {
          dirtyClusterKeys.add(k);
          return;
        }
      }
      // Mixed sides: trades on BOTH bid-side (B/BB) AND ask-side (A/AA)
      if (c.hasBidSide && c.hasAskSide) {
        // Exception 1: Profit-taking — ask first → BB sweep later on short DTE
        const isShortDTE = c.dte >= 0 && c.dte <= 14;
        if (isShortDTE && c.askTimes.length > 0 && c.bbSweepTimes.length > 0) {
          const minAsk = Math.min(...c.askTimes);
          const maxBBSweep = Math.max(...c.bbSweepTimes);
          if (minAsk > maxBBSweep) return; // profit-taking, not dirty
        }
        // Exception 2: Escalation — bid first → ask later with rising IV
        // (newest-first CSV: higher _idx = earlier in time)
        // The ask trade is the real signal, bid was closing/hedging
        if (c.bidTimes.length > 0 && c.askTimes.length > 0) {
          const earliestBid = Math.max(...c.bidTimes); // highest idx = earliest in time
          const latestAsk = Math.min(...c.askTimes);    // lowest idx = most recent
          if (earliestBid > latestAsk) { // bid came before ask
            const bidIV = c.bidIVs.length > 0 ? Math.max(...c.bidIVs) : 0;
            const askIV = c.askIVs.length > 0 ? Math.max(...c.askIVs) : 0;
            if (askIV > 0 && askIV >= bidIV) return; // IV rising = escalation, not dirty
          }
        }
        // Exception 3: De-escalation — ask first → bid later with falling IV = profit-taking
        // When ask-side trades build a position, then bid-side comes later at lower IV,
        // the bid-side is closing/profit-taking, not an opposing directional bet.
        if (c.askTimes.length > 0 && c.bidTimes.length > 0) {
          const earliestAsk = Math.max(...c.askTimes); // highest idx = earliest in time
          const latestBid = Math.min(...c.bidTimes);    // lowest idx = most recent
          if (earliestAsk > latestBid) { // some ask came before some bid chronologically
            const peakAskIV = c.askIVs.length > 0 ? Math.max(...c.askIVs) : 0;
            const lateBidIV = c.bidIVs.length > 0 ? Math.min(...c.bidIVs) : 0;
            if (peakAskIV > 0 && lateBidIV > 0 && lateBidIV < peakAskIV) return; // IV falling = de-escalation, not dirty
          }
        }
        // Exception 4: Premium dominance -- if one side is 70%+ of total
        // premium, the minor side is noise. Lowered from 85% to 70% to
        // accommodate Massive ingestion which captures more bid-side noise
        // alongside dominant ask-side conviction (e.g., 4 ask sweeps at $1M+
        // each plus one $1M profit-taker on the bid side = still bullish).
        const totalSidePrem = c.askPrem + c.bidPrem;
        if (totalSidePrem > 0) {
          if (c.askPrem / totalSidePrem >= 0.70 || c.bidPrem / totalSidePrem >= 0.70) return; // dominant side is the signal
        }
        dirtyClusterKeys.add(k);
        return;
      }
      if (c.dirs.size <= 1) return; // all same direction = clean
      // Mixed directions: check profit-taking exception
      const isShortDTE = c.dte >= 0 && c.dte <= 14;
      if (isShortDTE && c.askTimes.length > 0 && c.bbSweepTimes.length > 0) {
        const minAsk = Math.min(...c.askTimes);
        const maxBBSweep = Math.max(...c.bbSweepTimes);
        if (minAsk > maxBBSweep) return; // profit-taking, not dirty
      }
      dirtyClusterKeys.add(k);
    });
  }
  // Clean confirmed trades = only those NOT in dirty clusters
  const clean_confirmed = confirmed_trades.filter(t => {
    const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;
    return !dirtyClusterKeys.has(k);
  });

  const charts = buildCharts(clean_confirmed);
  const { DAYS, CONV, SB_SYM, SR_SYM, LB_SYM, LR_SYM, LEAPS_B, LEAPS_R,
    SBL, SBR, LBL, LBR_T, LEAPS_BL_T, LEAPS_BR_T,
    SBLC, SBRC, LBLC, LBRC, LEAPS_BLC, LEAPS_BRC, LEAPS_EXPS, SECTORS,
    shortBullTotal, shortBearTotal, longBullTotal, longBearTotal,
    leapsBullTotal, leapsBearTotal } = charts;




  // ── MERGED PASS: UOA cluster OI + WatchMap + TickerDB ────────────────────────
  // Previously three separate filtered.forEach loops; merged for ~30% speedup on large datasets
  const uoaClusterOI = {}; // track if any yellow/magenta exists per cluster
  const watchMap = {};
  const tickerMap = {};
  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i];
    const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;

    // ── UOA cluster OI ──
    if (!uoaClusterOI[k]) uoaClusterOI[k] = false;
    if (t.Co === "YELLOW" || t.Co === "MAGENTA") uoaClusterOI[k] = true;

    // ── WatchMap (OI Watchlist) ──
    if (t.OI > 0 && t.DTE > 0) {
      if (!watchMap[k]) watchMap[k] = { S:t.S, CP:t.CP, K:t.K, E:t.E, V:0, OI:t.OI, P:0, Si:t.Si, Ty:t.Ty, trades:0,
        hasSweep:false, hasBlock:false, price:0, DTE:t.DTE, dailyOI:{}, dailyVol:{}, mktcap:0 };
      watchMap[k].V += t.V;
      watchMap[k].P += t.P;
      watchMap[k].trades++;
      if (t.price > 0 && watchMap[k].price === 0) watchMap[k].price = t.price;
      if (t.OI > watchMap[k].OI) watchMap[k].OI = t.OI;
      if (t.mktcap > watchMap[k].mktcap) watchMap[k].mktcap = t.mktcap;
      if (t.Ty === "SWP") watchMap[k].hasSweep = true;
      if (t.Ty === "BLK") watchMap[k].hasBlock = true;
      const dt = (t.Dt||"").trim();
      if (dt) {
        if (!watchMap[k].dailyOI[dt] || t.OI > watchMap[k].dailyOI[dt]) watchMap[k].dailyOI[dt] = t.OI;
        watchMap[k].dailyVol[dt] = (watchMap[k].dailyVol[dt]||0) + t.V;
      }
    }

    // ── TickerDB ──
    if (!tickerMap[t.S]) tickerMap[t.S] = { s:t.S, b:0, r:0, n:0, topTrades:[], minTopP:0, consMap:{}, mktcap:0, er:false, uoa:false, sector:"" };
    const tk = tickerMap[t.S];
    tk.n++; if (t.D==="BULL") tk.b+=t.P; else if (t.D==="BEAR") tk.r+=t.P;
    if (t.mktcap > tk.mktcap) tk.mktcap = t.mktcap;
    if (t.er) tk.er = true;
    if (t.uoa) tk.uoa = true;
    if (!tk.sector) {
      const _resolved = resolveSector(t.S, t.sector);
      if (_resolved !== "Unknown") tk.sector = _resolved;
    }
    // Keep running top 10 by premium (avoid sorting huge arrays)
    if (tk.topTrades.length < 10) {
      tk.topTrades.push(t);
      if (tk.topTrades.length === 10) {
        let mp = tk.topTrades[0].P;
        for (let j = 1; j < 10; j++) if (tk.topTrades[j].P < mp) mp = tk.topTrades[j].P;
        tk.minTopP = mp;
      }
    } else if (t.P > tk.minTopP) {
      const minIdx = tk.topTrades.findIndex(x=>x.P===tk.minTopP);
      if (minIdx >= 0) tk.topTrades[minIdx] = t;
      let mp = tk.topTrades[0].P;
      for (let j = 1; j < 10; j++) if (tk.topTrades[j].P < mp) mp = tk.topTrades[j].P;
      tk.minTopP = mp;
    }
    const ck = t.CP+"|"+t.K+"|"+t.E;
    if (!tk.consMap[ck]) tk.consMap[ck] = { S:t.S, CP:t.CP, K:t.K, E:t.E, H:0, P:0, V:0, D:t.D,
      hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true, bullPrem:0, bearPrem:0, maxOI:0 };
    tk.consMap[ck].H++; tk.consMap[ck].P+=t.P; tk.consMap[ck].V+=t.V;
    if ((t.OI||0) > tk.consMap[ck].maxOI) tk.consMap[ck].maxOI = t.OI||0;
    if (t.D === "BULL") tk.consMap[ck].bullPrem += t.P;
    if (t.D === "BEAR") tk.consMap[ck].bearPrem += t.P;
    if (t.Ty==="SWP") tk.consMap[ck].hasSweep = true;
    if (t.Ty==="BLK") tk.consMap[ck].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") tk.consMap[ck].oiExceeded = true;
    if (t.D) tk.consMap[ck].dirs.add(t.D);
  }

  // UOA (unusual options activity) — uses pre-built uoaClusterOI from merged pass
  const UOA_TRADES = filtered.filter(t => {
    if (!t.uoa) return false;
    if (t.Co === "WHITE" && t.Ty === "BLK" && (t.Si === "B" || t.Si === "BB")) return false;
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!uoaClusterOI[k]) return false;
    return true;
  }).sort((a,b)=>b.P-a.P).slice(0,10);

  // OI Watchlist — uses pre-built watchMap from merged pass
  const WATCH = Object.values(watchMap)
    .map(w => {
      const dates = Object.keys(w.dailyOI).sort((a,b) => {
        const pa=a.split("/").map(Number), pb=b.split("/").map(Number);
        const ya=pa.length>=3?(pa[2]<100?pa[2]+2000:pa[2]):new Date().getFullYear();
        const yb=pb.length>=3?(pb[2]<100?pb[2]+2000:pb[2]):new Date().getFullYear();
        return new Date(ya,pa[0]-1,pa[1]||1) - new Date(yb,pb[0]-1,pb[1]||1);
      });
      const firstOI = dates.length>0 ? w.dailyOI[dates[0]] : 0;
      const lastOI = dates.length>0 ? w.dailyOI[dates[dates.length-1]] : 0;
      const csvDOI = dates.length>1 ? lastOI - firstOI : 0;
      const firstDate = dates[0]||"";
      const lastDate = dates[dates.length-1]||"";
      const daysTracked = dates.length;
      return { ...w, volOI: w.OI > 0 ? w.V / w.OI : 0, csvDOI, firstOI, lastOI, firstDate, lastDate, daysTracked, dailyOI:w.dailyOI, dailyVol:w.dailyVol, cap:capBand(w.mktcap) };
    })
    .sort((a,b) => b.volOI - a.volOI);

  // Performance tracker (needs DTE segments from charts)
  const { shortTerm:_st, longTerm:_lt, leaps:_lp } = (() => {
    const cc = clean_confirmed;
    return {
      shortTerm: cc.filter(t => t.DTE >= 0 && t.DTE < 60),
      longTerm:  cc.filter(t => t.DTE >= 60 && t.DTE < 180),
      leaps:     cc.filter(t => t.DTE >= 180),
    };
  })();
  function buildPerfItems(cat, trades, maxItems=4) {
    const groups = {};
    trades.forEach(t => {
      const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
      if (!groups[k]) groups[k] = { sym:t.S, cp:t.CP, strike:t.K, exp:t.E, dir:t.D, prices:[], spots:[], totalP:0, hits:0 };
      groups[k].hits++; groups[k].totalP += t.P;
      if (t.price > 0) groups[k].prices.push(t.price);
      if (t.Spot > 0) groups[k].spots.push(t.Spot);
    });
    return Object.values(groups).sort((a,b)=>b.hits-a.hits||b.totalP-a.totalP).slice(0,maxItems)
      .map((g,i) => {
        const sp = [...g.prices].sort((a,b)=>a-b);
        const entry = sp.length>0 ? parseFloat(sp[Math.floor(sp.length/2)].toFixed(2)) : 0;
        return {
          id:cat.toLowerCase().replace(/\s/g,"")+"_"+i,
          cat, sym:g.sym, cp:g.cp, strike:g.strike, exp:g.exp,
          entry, lo:sp[0]?parseFloat(sp[0].toFixed(2)):0, hi:sp[sp.length-1]?parseFloat(sp[sp.length-1].toFixed(2)):0,
          spot:g.spots.length>0?g.spots[g.spots.length-1]:0, hits:g.hits, dir:g.dir, now:0,
        };
      });
  }
  const convSyms = new Set(CONV.map(c=>c.sym));
  const PERF_INIT = [
    ...buildPerfItems("Leaderboard", clean_confirmed.filter(t=>convSyms.has(t.S)), 6),
    ...buildPerfItems("Short Bull", _st.filter(t=>t.D==="BULL"), 3),
    ...buildPerfItems("Short Bear", _st.filter(t=>t.D==="BEAR"), 3),
    ...buildPerfItems("Long Bull", _lt.filter(t=>t.D==="BULL"), 3),
    ...buildPerfItems("Long Bear", _lt.filter(t=>t.D==="BEAR"), 3),
    ...buildPerfItems("LEAPS Bull", _lp.filter(t=>t.D==="BULL"), 4),
    ...buildPerfItems("LEAPS Bear", _lp.filter(t=>t.D==="BEAR"), 4),
  ];

  // Ticker DB — uses pre-built tickerMap from merged pass
  const TICKER_DB = Object.values(tickerMap)
    .sort((a,b)=>(b.b+b.r)-(a.b+a.r))
    .map(tk => ({
      s:tk.s, b:tk.b, r:tk.r, n:tk.n, mktcap:tk.mktcap, er:tk.er, uoa:tk.uoa, sector:tk.sector||"",
      t:(()=>{
        // Aggregate premium per CONTRACT, not per single trade. The previous
        // implementation dedupped a top-10 cache of individual trades and kept
        // only the biggest one per contract — which made a strike like CRWV
        // 6/18 $117C appear as "$635K" (one sweep) when the contract actually
        // had 20+ trades totaling several million.
        //
        // consMap already sums P and V across all trades per (CP|K|E).
        // We use the biggest tracked trade as the display representative for
        // the row (so time, side, type, color tags render correctly), then
        // override P and V with the consMap totals.
        const repByContract = {};
        for (const tr of tk.topTrades) {
          const k = tr.CP + "|" + tr.K + "|" + tr.E;
          if (!repByContract[k] || tr.P > repByContract[k].P) repByContract[k] = tr;
        }
        return Object.values(tk.consMap)
          .map(c => {
            const k = c.CP + "|" + c.K + "|" + c.E;
            const rep = repByContract[k];
            if (!rep) return null; // contract whose biggest single trade fell below per-ticker top-10 cutoff
            // Direction from NET premium (bull vs bear dollars on the contract),
            // not the single largest trade's side — so a contract whose biggest
            // print was side-ambiguous still reads BULL/BEAR when its net flow is
            // directional. Only genuinely balanced contracts stay "—". dirPrem
            // (shown in the Premium column) tracks the same net side.
            const netD = c.bullPrem > c.bearPrem ? "BULL" : c.bearPrem > c.bullPrem ? "BEAR" : null;
            const dirPrem = netD === "BULL" ? c.bullPrem : netD === "BEAR" ? c.bearPrem : c.P;
            return { ...rep, P: c.P, V: c.V, bullPrem: c.bullPrem, bearPrem: c.bearPrem, dirPrem, dispD: netD, maxOI: c.maxOI };
          })
          .filter(x => x !== null)
          .sort((a, b) => b.dirPrem - a.dirPrem)
          .slice(0, 10);
      })(),
      c:Object.values(tk.consMap).filter(c=>c.H>=2).map(c => {
        c.clean = c.dirs.size <= 1;
        // 80% dominant direction override
        if (!c.clean && c.bullPrem !== undefined) {
          const totalDir = (c.bullPrem||0) + (c.bearPrem||0);
          if (totalDir > 0) {
            if ((c.bullPrem||0) / totalDir >= 0.8) { c.clean = true; c.D = "BULL"; }
            else if ((c.bearPrem||0) / totalDir >= 0.8) { c.clean = true; c.D = "BEAR"; }
          }
        }
        c.grade = gradeCluster(c);
        return c;
      }).sort((a,b)=>b.H-a.H||b.P-a.P).slice(0,8),
    }));

  const ALL_SYMS = [...new Set(filtered.map(t=>t.S))].sort();
  const dates = [...new Set(filtered.map(t=>t.Dt).filter(Boolean))].sort((a,b) => {
    const [am,ad]=a.split("/").map(Number), [bm,bd]=b.split("/").map(Number);
    return am!==bm?am-bm:ad-bd;
  });
  const dateRange = dates.length>1 ? dates[0]+" – "+dates[dates.length-1] : (dates[0]||"Current");
  return {
    ...charts,
    clean_confirmed,
    all_directional: filtered.filter(t => t.D), // all trades with direction for Ideas tab
    all_trades: filtered, // full filtered list — used where displays need TOTAL contract premium (incl. B-side undirected trades) not just directional flow
    TICKER_DB, ALL_SYMS, WATCH, PERF_INIT,
    UOA_TRADES, darkPool,
    dateRange, totalTrades:filtered.length,
    totalPremium:sum(filtered),
    confirmedCount:confirmed_trades.length,
  };
}
