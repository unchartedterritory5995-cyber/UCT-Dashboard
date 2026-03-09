import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ─── Color Palette ─────────────────────────────────────────────────────────────
const P = {
  bg:"#06090f", cd:"#0d1321", al:"#111a2e", bd:"#1a2540", bl:"#243352",
  bu:"#00e676", be:"#ff1744", ac:"#ffab00", tx:"#c8d6e5", dm:"#7b8fa3",
  mt:"#4a5c73", wh:"#f0f4f8", ye:"#ffd600", ma:"#e040fb", sw:"#00b0ff",
  bk:"#b388ff", uc:"#78909c"
};

// ─── Formatting ────────────────────────────────────────────────────────────────
function fmt(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + n;
}
function fK(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}
function tc(t) { return t === "SWP" ? P.sw : P.bk; }

// ─── UI Components ─────────────────────────────────────────────────────────────
function Tag({ c, children }) {
  return (
    <span style={{
      display:"inline-block", padding:"2px 7px", borderRadius:3,
      fontSize:9, fontWeight:700, letterSpacing:0.4, whiteSpace:"nowrap",
      color:c, backgroundColor:`${c}15`, border:`1px solid ${c}30`
    }}>{children}</span>
  );
}

function Card({ children, title, sub }) {
  return (
    <div style={{
      background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10,
      padding:"14px 16px", display:"flex", flexDirection:"column", gap:8, minWidth:0
    }}>
      {title && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
          <span style={{ fontSize:11, fontWeight:700, color:P.dm, textTransform:"uppercase", letterSpacing:1.5 }}>{title}</span>
          {sub && <span style={{ fontSize:10, color:P.mt }}>{sub}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

function TT({ rows }) {
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:`1px solid ${P.bd}` }}>
          {["Ticker","Day","Side","Signal","Type","C/P","Strike","Exp","Vol","Premium","DTE"].map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom:`1px solid ${P.bd}10`, background:(r.Si==="AA"||r.Si==="BB")?`${P.ac}08`:"transparent" }}>
            <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
            <td style={{ padding:"5px 4px", color:P.dm, fontSize:9 }}>{r.Dt}</td>
            <td style={{ padding:"5px 4px" }}>
              {r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}
            </td>
            <td style={{ padding:"5px 4px" }}><Tag c={r.Co==="YELLOW"?P.ye:P.ma}>{r.Co}</Tag></td>
            <td style={{ padding:"5px 4px" }}><Tag c={tc(r.Ty)}>{r.Ty}</Tag></td>
            <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
            <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
            <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
            <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.V)}</td>
            <td style={{ padding:"5px 4px", fontWeight:700, color:P.wh }}>{fmt(r.P)}</td>
            <td style={{ padding:"5px 4px", color:P.dm }}>{r.DTE}d</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CT({ rows }) {
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:`1px solid ${P.bd}` }}>
          {["Ticker","C/P","Strike","Exp","Hits","Vol","Premium"].map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom:`1px solid ${P.bd}10`, background:r.H>=5?`${P.ac}08`:"transparent" }}>
            <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
            <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
            <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
            <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
            <td style={{ padding:"5px 4px" }}>
              <span style={{ fontWeight:800, fontSize:13, color:r.H>=10?P.ac:r.H>=5?P.ye:P.dm }}>{r.H}x</span>
            </td>
            <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.V)}</td>
            <td style={{ padding:"5px 4px", fontWeight:700, color:P.wh }}>{fmt(r.P)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NC({ data, fill, dir }) {
  const neg = dir === "bear";
  const cd = data.map(d => ({ ...d, v: neg ? -Math.abs(d.n) : d.n }));
  return (
    <div style={{ height:220 }}>
      <ResponsiveContainer>
        <BarChart data={cd} layout="vertical" margin={{ top:0, right:8, left:5, bottom:0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={P.bd} horizontal={false} />
          <XAxis type="number" tick={{ fill:P.mt, fontSize:8 }} tickFormatter={v => fmt(Math.abs(v))} />
          <YAxis dataKey="s" type="category" tick={{ fill:P.tx, fontSize:11, fontWeight:700 }} width={60} interval={0} tickLine={false} axisLine={false} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload || !payload.length) return null;
            const d = payload[0].payload;
            return (
              <div style={{ background:"#152038", border:`1px solid ${P.bl}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                <div style={{ fontWeight:700, marginBottom:3 }}>{d.s}</div>
                <div style={{ color:P.bu }}>Bull: {fmt(d.b)}</div>
                <div style={{ color:P.be }}>Bear: {fmt(d.r)}</div>
                <div style={{ color:d.n>0?P.bu:P.be, fontWeight:700 }}>Net: {fmt(d.n)}</div>
              </div>
            );
          }} />
          <Bar dataKey="v" fill={fill} radius={neg?[4,0,0,4]:[0,4,4,0]} barSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── CSV Parser ────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === "," && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += line[i];
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));

  // Flexible column mapping — handles UCT BlackBox export + common variants
  const ALIASES = {
    ticker:  ["symbol","ticker","sym","stock","underlying","name"],
    date:    ["createddate","date","tradedate","day"],
    time:    ["createdtime","time","tradetime"],
    expiry:  ["expirationdate","expiry","expiration","exp","expdate"],
    strike:  ["strike","strikeprice","k"],
    type:    ["type","details","tradetype","tradedetails","description","ordertype"],
    cp:      ["callput","cp","optiontype","callorput","putorcall"],
    spot:    ["spot","stockprice","underprice","underlyingprice","last","underlast","stocklast"],
    side:    ["side","aggressorside","aggressor","orderside"],
    volume:  ["volume","vol","qty","contracts","size","quantity"],
    oi:      ["oi","openinterest","openint","opint"],
    iv:      ["impliedvolatility","iv","impliedvol","implvol","ivol"],
    premium: ["premium","prem","totalpremium","value","totalvalue","notional"],
    price:   ["price","contractprice","optionprice","lastprice","midprice","mid"],
    color:   ["color","signal","oicolor","oisignal","flag"],
    dte:     ["dte","daystoexpiry","daystoexp","dtex"],
  };

  const colIdx = {};
  Object.entries(ALIASES).forEach(([field, aliases]) => {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx >= 0) { colIdx[field] = idx; break; }
    }
  });

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row = {};
    Object.entries(colIdx).forEach(([field, idx]) => {
      row[field] = (cols[idx] || "").trim();
    });
    return row;
  }).filter(r => r.ticker && r.ticker.length > 0);
}

// ─── Date Utilities ────────────────────────────────────────────────────────────
function parseExpiry(str) {
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

function computeDTE(expiry) {
  if (!expiry) return -1;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((expiry - today) / 86400000);
}

function formatExp(expiry) {
  if (!expiry) return "";
  const m = expiry.getMonth() + 1;
  const d = expiry.getDate();
  const y = expiry.getFullYear();
  const cy = new Date().getFullYear();
  if (y === cy) return `${m}/${d}`;
  return `${m}/${d}/${String(y).slice(2)}`;
}

// ─── Data Processing ───────────────────────────────────────────────────────────
function processFlowData(rows) {
  // 1. Parse raw rows into trade objects
  const rawTrades = rows.map(r => {
    // Type: "SWEEP"→SWP, "BLOCK"→BLK, "ML/"→skip
    const typeRaw = (r.type || "").toUpperCase().trim();
    const isML = typeRaw === "ML/" || typeRaw.startsWith("ML/");
    const isSWP = typeRaw === "SWEEP" || typeRaw.includes("SWP");
    const isBLK = typeRaw === "BLOCK" || typeRaw.includes("BLK");

    // CallPut: "CALL"→C, "PUT"→P
    const cpRaw = (r.cp || "").toUpperCase().trim();
    const cp = cpRaw === "CALL" ? "C" : cpRaw === "PUT" ? "P" : cpRaw.replace(/[^CP]/g,"").slice(0,1);

    const strike  = parseFloat(r.strike) || 0;
    const spot    = parseFloat(r.spot) || 0;
    const volume  = parseInt(r.volume) || 0;
    const oi      = parseInt(r.oi) || 0;
    const premium = parseFloat((r.premium||"").replace(/[$,]/g,"")) || 0;
    const price   = parseFloat((r.price||"").replace(/[$,]/g,"")) || 0;
    const iv      = parseFloat(r.iv) || 0;

    // Side: already AA/BB/A/B in this CSV
    const sr = (r.side||"").toUpperCase().trim();
    let side = sr;
    if (sr.includes("ABOVE") || sr==="AA") side = "AA";
    else if (sr.includes("BELOW") || sr==="BB") side = "BB";
    else if (sr==="A" || sr.includes("ASK")) side = "A";
    else if (sr==="B" || sr.includes("BID")) side = "B";

    // Color: WHITE/YELLOW/MAGENTA/ORANGE/#FF0000
    const cr = (r.color||"").toUpperCase().trim();
    let color = "WHITE";
    if (cr === "YELLOW" || cr === "Y") color = "YELLOW";
    else if (cr === "MAGENTA" || cr === "ORANGE" || cr === "#FF0000" || cr === "M") color = "MAGENTA";

    // Use pre-computed DTE from CSV if available
    const expiry = parseExpiry(r.expiry);
    const dteParsed = parseInt(r.dte);
    const dte = !isNaN(dteParsed) && dteParsed >= 0 ? dteParsed : (expiry ? computeDTE(expiry) : -1);
    const expStr = expiry ? formatExp(expiry) : (r.expiry||"");

    let dt = "";
    const dateRaw = r.date||"";
    if (dateRaw) {
      const dp = dateRaw.split("/");
      dt = dp.length >= 2 ? `${parseInt(dp[0])}/${parseInt(dp[1])}` : dateRaw.slice(0,5);
    }

    // Direction:
    // YELLOW/MAGENTA = confirmed opening
    // Calls (any side) = BULL
    // Puts AA/A/BID = BEAR  |  Puts BB = BULL (writing puts)
    const confirmed = color === "YELLOW" || color === "MAGENTA";
    let direction = null;
    if (confirmed && cp) {
      direction = (cp === "C") ? "BULL" : (side === "BB" ? "BULL" : "BEAR");
    }

    return {
      S: (r.ticker||"").toUpperCase().trim(),
      Ty: isSWP ? "SWP" : isBLK ? "BLK" : null,
      CP: cp, K: strike, V: volume, P: premium, price,
      E: expStr, expiry, Si: side, Co: color, DTE: dte, Dt: dt,
      D: direction, OI: oi, IV: iv, Spot: spot, isML, confirmed,
    };
  });

  // 2. Filter out ML/, unknown type, expired, invalid rows
  const filtered = rawTrades.filter(t =>
    !t.isML && t.S && t.Ty && t.CP && t.DTE >= 0 && t.V > 0 && t.P > 0
  );

  const confirmed = filtered.filter(t => t.confirmed && t.D);
  const unconfirmed = filtered.filter(t => !t.confirmed);

  // 3. Daily flow
  const dayMap = {};
  confirmed.forEach(t => {
    if (!t.Dt) return;
    if (!dayMap[t.Dt]) dayMap[t.Dt] = { d: t.Dt, b:0, r:0 };
    t.D === "BULL" ? (dayMap[t.Dt].b += t.P) : (dayMap[t.Dt].r += t.P);
  });
  const DAYS = Object.values(dayMap).sort((a, b) => {
    const [am,ad] = a.d.split("/").map(Number);
    const [bm,bd] = b.d.split("/").map(Number);
    return am!==bm ? am-bm : ad-bd;
  });

  // 4. Segment by DTE
  const shortTerm = confirmed.filter(t => t.DTE >= 0  && t.DTE < 15);
  const longTerm  = confirmed.filter(t => t.DTE >= 15 && t.DTE < 180);
  const leaps     = confirmed.filter(t => t.DTE >= 180);

  // 5. Helpers
  function netByTicker(trades, n=8) {
    const m = {};
    trades.forEach(t => {
      if (!m[t.S]) m[t.S] = { s:t.S, b:0, r:0 };
      t.D==="BULL" ? (m[t.S].b+=t.P) : (m[t.S].r+=t.P);
    });
    return Object.values(m)
      .map(d => ({ ...d, n: d.b-d.r }))
      .sort((a,b) => Math.abs(b.n)-Math.abs(a.n))
      .slice(0, n);
  }

  function topTrades(trades, n=8) {
    return [...trades]
      .sort((a,b) => ((b.Si==="AA"||b.Si==="BB"?1000:0)+(b.Ty==="SWP"?100:0)+b.P/1e6) -
                     ((a.Si==="AA"||a.Si==="BB"?1000:0)+(a.Ty==="SWP"?100:0)+a.P/1e6))
      .slice(0, n);
  }

  function consistencyTable(trades, n=6) {
    const m = {};
    trades.forEach(t => {
      const k = `${t.S}|${t.CP}|${t.K}|${t.E}`;
      if (!m[k]) m[k] = { S:t.S, CP:t.CP, K:t.K, E:t.E, H:0, P:0, V:0, D:t.D };
      m[k].H++; m[k].P+=t.P; m[k].V+=t.V;
    });
    return Object.values(m).filter(c=>c.H>=2).sort((a,b)=>b.H-a.H||b.P-a.P).slice(0,n);
  }

  const SB_SYM = netByTicker(shortTerm.filter(t=>t.D==="BULL"));
  const SR_SYM = netByTicker(shortTerm.filter(t=>t.D==="BEAR"));
  const LB_SYM = netByTicker(longTerm.filter(t=>t.D==="BULL"));
  const LR_SYM = netByTicker(longTerm.filter(t=>t.D==="BEAR"));
  const LEAPS_B = netByTicker(leaps.filter(t=>t.D==="BULL"));
  const LEAPS_R = netByTicker(leaps.filter(t=>t.D==="BEAR"));

  const SBL       = topTrades(shortTerm.filter(t=>t.D==="BULL"));
  const SBR       = topTrades(shortTerm.filter(t=>t.D==="BEAR"));
  const LBL       = topTrades(longTerm.filter(t=>t.D==="BULL"));
  const LBR_T     = topTrades(longTerm.filter(t=>t.D==="BEAR"));
  const LEAPS_BL_T= topTrades(leaps.filter(t=>t.D==="BULL"));
  const LEAPS_BR_T= topTrades(leaps.filter(t=>t.D==="BEAR"));

  const SBLC    = consistencyTable(shortTerm.filter(t=>t.D==="BULL"));
  const SBRC    = consistencyTable(shortTerm.filter(t=>t.D==="BEAR"));
  const LBLC    = consistencyTable(longTerm.filter(t=>t.D==="BULL"));
  const LBRC    = consistencyTable(longTerm.filter(t=>t.D==="BEAR"));
  const LEAPS_BLC = consistencyTable(leaps.filter(t=>t.D==="BULL"));
  const LEAPS_BRC = consistencyTable(leaps.filter(t=>t.D==="BEAR"));

  // 6. LEAPS by expiration
  const leapsExpMap = {};
  leaps.forEach(t => {
    if (!leapsExpMap[t.E]) leapsExpMap[t.E] = { exp:t.E, p:0, n:0, dte:t.DTE, syms:{} };
    leapsExpMap[t.E].p += t.P;
    leapsExpMap[t.E].n++;
    leapsExpMap[t.E].syms[t.S] = (leapsExpMap[t.E].syms[t.S]||0) + t.P;
  });
  const LEAPS_EXPS = Object.values(leapsExpMap)
    .sort((a,b)=>b.p-a.p).slice(0,6)
    .map(e => ({
      exp:e.exp, p:e.p, n:e.n, dte:`${e.dte}d`,
      names: Object.entries(e.syms).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([s,p])=>`${s} $${(p/1e6).toFixed(1)}M`).join(", ")
    }));

  // 7. Conviction strikes (AA/BB + consistency + sweep)
  const allCons = {};
  confirmed.forEach(t => {
    const k = `${t.S}|${t.CP}|${t.K}|${t.E}`;
    if (!allCons[k]) allCons[k] = { sym:t.S, cp:t.CP, K:t.K, exp:t.E, hits:0, prem:0, dir:t.D, hasAA:false, hasBB:false };
    allCons[k].hits++;
    allCons[k].prem += t.P;
    if (t.Si==="AA") allCons[k].hasAA = true;
    if (t.Si==="BB") allCons[k].hasBB = true;
  });
  const CONV = Object.values(allCons)
    .filter(c => c.dir)
    .map(c => ({ ...c, score:(c.hasAA||c.hasBB?1000:0)+c.hits*200+c.prem/1e5, side:c.hasAA?"AA":c.hasBB?"BB":"ASK", strike:`$${c.K}${c.cp}` }))
    .sort((a,b)=>b.score-a.score).slice(0,6)
    .map(c => ({ sym:c.sym, strike:c.strike, exp:c.exp, hits:c.hits, prem:c.prem, side:c.side, dir:c.dir }));

  // 8. OI Watchlist
  const WATCH = [...unconfirmed].sort((a,b)=>b.P-a.P).slice(0,10)
    .map(t => ({ S:t.S, CP:t.CP, K:t.K, E:t.E, V:t.V, OI:t.OI, P:t.P, Si:t.Si, Ty:t.Ty }));

  // 9. Performance tracker — build from top consistency groups per category
  function buildPerfItems(cat, trades, maxItems=4) {
    const groups = {};
    trades.forEach(t => {
      const k = `${t.S}|${t.CP}|${t.K}|${t.E}`;
      if (!groups[k]) groups[k] = { sym:t.S, cp:t.CP, strike:t.K, exp:t.E, dir:t.D, prices:[], spots:[], totalP:0, hits:0 };
      groups[k].hits++;
      groups[k].totalP += t.P;
      if (t.price > 0) groups[k].prices.push(t.price);
      if (t.Spot > 0) groups[k].spots.push(t.Spot);
    });
    return Object.values(groups)
      .sort((a,b)=>b.hits-a.hits||b.totalP-a.totalP).slice(0,maxItems)
      .map((g,i) => {
        const sp = [...g.prices].sort((a,b)=>a-b);
        const entry = sp.length>0 ? parseFloat(sp[Math.floor(sp.length/2)].toFixed(2)) : 0;
        return {
          id:`${cat.toLowerCase().replace(/\s/g,"")}_${i}`,
          cat, sym:g.sym, cp:g.cp, strike:g.strike, exp:g.exp,
          entry, lo:sp[0]?parseFloat(sp[0].toFixed(2)):0, hi:sp[sp.length-1]?parseFloat(sp[sp.length-1].toFixed(2)):0,
          spot:g.spots.length>0?g.spots[g.spots.length-1]:0,
          hits:g.hits, dir:g.dir, now:0,
        };
      });
  }

  // Conviction perf = top items from the conviction strikes
  const convSyms = new Set(CONV.map(c=>c.sym));
  const PERF_INIT = [
    ...buildPerfItems("Conviction", confirmed.filter(t=>convSyms.has(t.S)), 6),
    ...buildPerfItems("Short Bull", shortTerm.filter(t=>t.D==="BULL"), 3),
    ...buildPerfItems("Short Bear", shortTerm.filter(t=>t.D==="BEAR"), 3),
    ...buildPerfItems("Long Bull",  longTerm.filter(t=>t.D==="BULL"),  3),
    ...buildPerfItems("Long Bear",  longTerm.filter(t=>t.D==="BEAR"),  3),
    ...buildPerfItems("LEAPS Bull", leaps.filter(t=>t.D==="BULL"), 4),
    ...buildPerfItems("LEAPS Bear", leaps.filter(t=>t.D==="BEAR"), 4),
  ];

  // 10. Ticker DB for Search (top 60 by total premium)
  const tickerMap = {};
  confirmed.forEach(t => {
    if (!tickerMap[t.S]) tickerMap[t.S] = { s:t.S, b:0, r:0, n:0, trades:[], consMap:{} };
    const tk = tickerMap[t.S];
    tk.n++;
    t.D==="BULL" ? (tk.b+=t.P) : (tk.r+=t.P);
    tk.trades.push(t);
    const ck = `${t.CP}|${t.K}|${t.E}`;
    if (!tk.consMap[ck]) tk.consMap[ck] = { S:t.S, CP:t.CP, K:t.K, E:t.E, H:0, P:0, V:0, D:t.D };
    tk.consMap[ck].H++; tk.consMap[ck].P+=t.P; tk.consMap[ck].V+=t.V;
  });
  const TICKER_DB = Object.values(tickerMap)
    .sort((a,b)=>(b.b+b.r)-(a.b+a.r)).slice(0,60)
    .map(tk => ({
      s:tk.s, b:tk.b, r:tk.r, n:tk.n,
      t: tk.trades.sort((a,b)=>b.P-a.P).slice(0,8),
      c: Object.values(tk.consMap).filter(c=>c.H>=2).sort((a,b)=>b.H-a.H||b.P-a.P).slice(0,6),
    }));

  const ALL_SYMS = [...new Set(filtered.map(t=>t.S))].sort();

  const dates = [...new Set(filtered.map(t=>t.Dt).filter(Boolean))].sort((a,b) => {
    const [am,ad]=a.split("/").map(Number), [bm,bd]=b.split("/").map(Number);
    return am!==bm?am-bm:ad-bd;
  });
  const dateRange = dates.length>1 ? `${dates[0]} – ${dates[dates.length-1]}` : (dates[0]||"Current");

  const sum = (arr, key="P") => arr.reduce((s,t)=>s+t[key],0);
  return {
    DAYS, CONV, SB_SYM, SR_SYM, LB_SYM, LR_SYM, LEAPS_B, LEAPS_R,
    SBL, SBR, LBL, LBR_T, LEAPS_BL_T, LEAPS_BR_T,
    SBLC, SBRC, LBLC, LBRC, LEAPS_BLC, LEAPS_BRC,
    LEAPS_EXPS, TICKER_DB, ALL_SYMS, WATCH, PERF_INIT,
    dateRange, totalTrades: filtered.length,
    totalPremium: sum(filtered),
    shortBullTotal: sum(shortTerm.filter(t=>t.D==="BULL")),
    shortBearTotal: sum(shortTerm.filter(t=>t.D==="BEAR")),
    longBullTotal:  sum(longTerm.filter(t=>t.D==="BULL")),
    longBearTotal:  sum(longTerm.filter(t=>t.D==="BEAR")),
    leapsBullTotal: sum(leaps.filter(t=>t.D==="BULL")),
    leapsBearTotal: sum(leaps.filter(t=>t.D==="BEAR")),
  };
}

// ─── Loading / Error Screens ───────────────────────────────────────────────────
function UploadScreen({ onFile, onRetry, error }) {
  const [dragging, setDragging] = useState(false);

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => onFile(e.target.result, file.name);
    reader.readAsText(file);
  }

  return (
    <div style={{ background:P.bg, color:P.tx, fontFamily:"'SF Mono','Fira Code',monospace", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:20, padding:40 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:6, height:6, borderRadius:"50%", background:P.ac, boxShadow:`0 0 10px ${P.ac}` }} />
        <h1 style={{ fontSize:18, fontWeight:800, margin:0, color:P.wh }}>OPTIONS FLOW DASHBOARD</h1>
      </div>

      {error && (
        <div style={{ background:`${P.be}15`, border:`1px solid ${P.be}40`, borderRadius:8, padding:"10px 18px", maxWidth:420, fontSize:11, color:P.be, textAlign:"center", lineHeight:1.7 }}>
          <strong>Auto-load failed:</strong> {error}<br/>
          <span style={{ color:P.dm }}>Upload your CSV manually below, or retry.</span>
        </div>
      )}

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        style={{
          width:420, padding:"40px 32px",
          border:`2px dashed ${dragging ? P.ac : P.bd}`,
          borderRadius:12, textAlign:"center",
          background: dragging ? `${P.ac}08` : P.cd,
          transition:"all 0.15s", cursor:"pointer",
        }}
        onClick={() => document.getElementById("csv-upload").click()}
      >
        <div style={{ fontSize:32, marginBottom:12 }}>📂</div>
        <div style={{ fontSize:14, fontWeight:700, color:P.wh, marginBottom:8 }}>Drop your flow-data.csv here</div>
        <div style={{ fontSize:11, color:P.dm }}>or click to browse</div>
        <input id="csv-upload" type="file" accept=".csv" style={{ display:"none" }}
          onChange={e => handleFile(e.target.files[0])} />
      </div>

      <div style={{ display:"flex", gap:10 }}>
        {onRetry && (
          <button onClick={onRetry} style={{ padding:"8px 20px", borderRadius:6, border:`1px solid ${P.bd}`, background:P.al, color:P.dm, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            ↻ Retry GitHub
          </button>
        )}
      </div>

      <div style={{ fontSize:10, color:P.mt, background:P.al, padding:"12px 20px", borderRadius:6, maxWidth:420, lineHeight:1.9 }}>
        <strong style={{ color:P.wh }}>Normal flow:</strong> push <code style={{color:P.ac}}>flow-data.csv</code> to GitHub → dashboard auto-updates for all users.<br/>
        <strong style={{ color:P.wh }}>Manual fallback:</strong> drop any CSV above to load it directly.
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ background:P.bg, color:P.tx, fontFamily:"'SF Mono','Fira Code',monospace", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
      <div style={{ width:8, height:8, borderRadius:"50%", background:P.ac, boxShadow:`0 0 20px ${P.ac}` }} />
      <div style={{ fontSize:13, color:P.dm }}>Parsing flow data…</div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
const TABS = ["Market Read","Performance","Search","Short Term","Long Term","LEAPS","OI Watchlist"];

// ── GitHub raw URL — update this if your repo changes ──────────────────────────
const GITHUB_CSV_URL =
  "https://raw.githubusercontent.com/unchartedterritory5995-cyber/UCT-Dashboard/master/app/public/flow-data.csv";

export default function OptionsFlow() {
  const [flowData, setFlowData]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState(null);
  const [tab, setTab]                 = useState("Market Read");
  const [perf, setPerf]               = useState([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [status, setStatus]           = useState("");
  const [search, setSearch]           = useState("");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [fileName, setFileName]       = useState("flow-data.csv");

  // Parse CSV text and update state
  function loadCSVText(text, name) {
    setFileName(name || "flow-data.csv");
    try {
      const rows = parseCSV(text);
      if (rows.length === 0) throw new Error("No data rows found — check column headers.");
      const data = processFlowData(rows);
      setFlowData(data);
      setPerf(data.PERF_INIT.map(p => ({ ...p, now:0 })));
      setLoadError(null);
    } catch(err) {
      setLoadError(err.message);
    }
    setLoading(false);
  }

  // Auto-fetch from GitHub on mount — cache-busted so users always get the latest file
  useEffect(() => {
    setLoading(true);
    fetch(GITHUB_CSV_URL + "?t=" + Date.now())
      .then(r => {
        if (!r.ok) throw new Error(`Could not fetch CSV (HTTP ${r.status})`);
        return r.text();
      })
      .then(text => loadCSVText(text, "flow-data.csv"))
      .catch(err => {
        setLoadError(err.message);
        setLoading(false);
      });
  }, []);

  // Manual reload from GitHub
  function reloadFromGitHub() {
    setLoading(true);
    setLoadError(null);
    fetch(GITHUB_CSV_URL + "?t=" + Date.now())
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => loadCSVText(text, "flow-data.csv"))
      .catch(err => { setLoadError(err.message); setLoading(false); });
  }

  async function fetchPrices() {
    setFetchLoading(true);
    setStatus("Fetching contract prices…");
    const tickers = {};
    perf.forEach(p => {
      if (!tickers[p.sym]) tickers[p.sym] = [];
      tickers[p.sym].push(p);
    });
    const batches = [];
    let batch = [];
    Object.entries(tickers).forEach(([,contracts]) => {
      batch.push(...contracts);
      if (batch.length >= 6) { batches.push([...batch]); batch = []; }
    });
    if (batch.length > 0) batches.push(batch);

    const updated = [...perf];
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      setStatus(`Fetching batch ${i+1}/${batches.length} (${b.map(c=>c.sym).join(", ")})…`);
      const contractList = b.map(c=>`${c.sym} ${c.cp==="C"?"CALL":"PUT"} $${c.strike} exp ${c.exp}`).join("\n");
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:1000,
            tools:[{ type:"web_search_20250305", name:"web_search" }],
            messages:[{ role:"user", content:`Find the latest closing price for these option contracts. Return ONLY a JSON array, no markdown. Each element: {"sym":"TICKER","cp":"C or P","strike":NUMBER,"price":NUMBER}\n\n${contractList}` }]
          })
        });
        const data = await resp.json();
        const text = (data.content||[]).filter(c=>c.type==="text").map(c=>c.text).join("");
        try {
          const clean = text.replace(/```json|```/g,"").trim();
          const js = clean.substring(clean.indexOf("["), clean.lastIndexOf("]")+1);
          const prices = JSON.parse(js);
          prices.forEach(p => {
            const match = updated.find(u=>u.sym===p.sym&&u.cp===p.cp&&u.strike===p.strike&&p.price>0);
            if (match) match.now = p.price;
          });
        } catch(e) {}
      } catch(e) {}
      if (i < batches.length-1) await new Promise(r=>setTimeout(r,1500));
    }
    setPerf(updated);
    setFetchLoading(false);
    setStatus(`Done. ${updated.filter(u=>u.now>0).length}/${updated.length} contracts priced.`);
  }

  if (loading) return <LoadingScreen />;
  if (loadError && !flowData) return (
    <UploadScreen
      error={loadError}
      onFile={(text, name) => loadCSVText(text, name)}
      onRetry={reloadFromGitHub}
    />
  );

  const D = flowData;
  const shortDir = D.shortBullTotal >= D.shortBearTotal ? "BULL" : "BEAR";
  const longDir  = D.longBullTotal  >= D.longBearTotal  ? "BULL" : "BEAR";
  const shortC   = shortDir==="BULL" ? P.bu : P.be;
  const longC    = longDir==="BULL"  ? P.bu : P.be;

  return (
    <div style={{ background:P.bg, color:P.tx, fontFamily:"'SF Mono','Fira Code',monospace", minHeight:"100vh", padding:"16px 20px", zoom:1.25 }}>
      <div style={{ maxWidth:1400, margin:"0 auto" }}>

        {/* ── Header ── */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:P.ac, boxShadow:`0 0 10px ${P.ac}` }} />
          <h1 style={{ fontSize:18, fontWeight:800, margin:0, color:P.wh }}>OPTIONS FLOW — MARKET READ</h1>
          <span style={{ marginLeft:"auto", fontSize:10, color:P.mt, background:P.al, padding:"3px 10px", borderRadius:4 }}>
            {D.dateRange} · {fileName}
          </span>
          <button onClick={reloadFromGitHub} title="Re-fetch latest CSV from GitHub"
            style={{ padding:"4px 12px", borderRadius:4, border:`1px solid ${P.bd}`, background:P.al, color:P.dm, fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>
            ↻ Refresh
          </button>
          <label title="Load a local CSV file" style={{ padding:"4px 12px", borderRadius:4, border:`1px solid ${P.ac}`, background:"transparent", color:P.ac, fontSize:10, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>
            ↑ Upload CSV
            <input type="file" accept=".csv" style={{ display:"none" }}
              onChange={e => { if(e.target.files[0]) { const f=e.target.files[0]; const r=new FileReader(); r.onload=ev=>loadCSVText(ev.target.result,f.name); r.readAsText(f); } }}
            />
          </label>
        </div>
        <p style={{ fontSize:10, color:P.mt, margin:"0 0 12px 16px" }}>
          {fK(D.totalTrades)} live trades · {fmt(D.totalPremium)} confirmed · YELLOW/MAG only · ML/ excluded
        </p>

        {/* ── Short/Long Banners ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
          <div style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10, padding:20, borderLeft:`4px solid ${shortC}` }}>
            <div style={{ fontSize:11, color:shortC, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Short-Term Outlook</div>
            <div style={{ fontSize:36, fontWeight:900, color:shortC, marginBottom:8 }}>{shortDir}</div>
            <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>
              0–14 DTE: Bull {fmt(D.shortBullTotal)} vs Bear {fmt(D.shortBearTotal)}.{" "}
              {D.CONV.filter(c=>c.dir==="BULL").slice(0,1).map(c=>`${c.sym} ${c.strike} hit ${c.hits}x.`)}
            </div>
          </div>
          <div style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10, padding:20, borderLeft:`4px solid ${longC}` }}>
            <div style={{ fontSize:11, color:longC, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Long-Term Outlook</div>
            <div style={{ fontSize:36, fontWeight:900, color:longC, marginBottom:8 }}>{longDir}</div>
            <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>
              15+ DTE: Bull {fmt(D.longBullTotal)} vs Bear {fmt(D.longBearTotal)}.{" "}
              {D.CONV.filter(c=>c.dir==="BEAR").slice(0,1).map(c=>`${c.sym} ${c.strike} hit ${c.hits}x.`)}
            </div>
          </div>
        </div>

        {/* ── Conviction Strikes ── */}
        <div style={{ fontSize:10, fontWeight:700, color:P.dm, letterSpacing:1.5, textTransform:"uppercase", marginBottom:6 }}>Top Conviction Strikes</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:12 }}>
          {D.CONV.map((t, i) => {
            const c = t.dir==="BULL" ? P.bu : P.be;
            return (
              <div key={i} style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:8, padding:"10px 12px", borderTop:`2px solid ${c}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                  <span style={{ fontSize:14, fontWeight:900, color:P.wh }}>{t.sym}</span>
                  {t.side==="AA"?<Tag c={P.ac}>AA</Tag>:t.side==="BB"?<Tag c={P.be}>BB</Tag>:<Tag c={P.mt}>ASK</Tag>}
                </div>
                <div style={{ fontSize:13, fontWeight:800, color:c }}>{t.strike} <span style={{ fontSize:11, fontWeight:700, color:P.wh }}>{t.exp}</span></div>
                <div style={{ fontSize:10, color:P.dm, marginTop:4 }}><span style={{ color:P.ac, fontWeight:700 }}>{t.hits}x</span> · {fmt(t.prem)}</div>
                <div style={{ marginTop:4 }}><Tag c={c}>{t.dir}</Tag></div>
              </div>
            );
          })}
        </div>

        {/* ── Tabs ── */}
        <div style={{ display:"flex", gap:1, marginBottom:14, background:P.al, borderRadius:6, padding:2, width:"fit-content", flexWrap:"wrap" }}>
          {TABS.map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{
              padding:"6px 16px", borderRadius:5, border:"none", cursor:"pointer",
              fontSize:11, fontWeight:600, fontFamily:"inherit",
              background:tab===t?P.cd:"transparent", color:tab===t?P.wh:P.mt
            }}>{t}</button>
          ))}
        </div>

        {/* ── Market Read ── */}
        {tab==="Market Read" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card title="Confirmed Daily Flow" sub="Bull vs Bear">
              <div style={{ height:200 }}>
                <ResponsiveContainer>
                  <BarChart data={D.DAYS} margin={{ top:5, right:8, left:0, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={P.bd} />
                    <XAxis dataKey="d" tick={{ fill:P.tx, fontSize:10, fontWeight:600 }} tickLine={false} />
                    <YAxis tick={{ fill:P.mt, fontSize:9 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={52} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active||!payload||!payload.length) return null;
                      return (
                        <div style={{ background:"#152038", border:`1px solid ${P.bl}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                          <div style={{ color:P.dm, fontWeight:600, marginBottom:4 }}>{label}</div>
                          {payload.map((p,i)=>(
                            <div key={i} style={{ color:p.color, display:"flex", gap:8, justifyContent:"space-between" }}>
                              <span>{p.name}</span><span style={{ fontWeight:700 }}>{fmt(Math.abs(p.value))}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }} />
                    <Bar dataKey="b" name="Bullish" fill={P.bu} radius={[3,3,0,0]} barSize={20} />
                    <Bar dataKey="r" name="Bearish" fill={P.be} radius={[3,3,0,0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Short-Term Bullish" sub="0–14 DTE"><NC data={D.SB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Short-Term Bearish" sub="0–14 DTE"><NC data={D.SR_SYM} fill={P.be} dir="bear"/></Card>
              <Card title="Long-Term Bullish" sub="15+ DTE"><NC data={D.LB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Long-Term Bearish" sub="15+ DTE"><NC data={D.LR_SYM} fill={P.be} dir="bear"/></Card>
            </div>
          </div>
        )}

        {/* ── Performance ── */}
        {tab==="Performance" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                <div style={{ width:3, background:P.ac, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:P.ac, marginBottom:5 }}>Contract Performance Tracker</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>Entry = median contract price from CSV. Range = low–high across all hits. Type current price to track P&L.</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                  <button onClick={fetchPrices} disabled={fetchLoading} style={{
                    padding:"8px 20px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                    fontSize:11, fontWeight:700, fontFamily:"inherit",
                    background:fetchLoading?P.bd:P.ac, color:fetchLoading?P.dm:P.bg, opacity:fetchLoading?0.6:1,
                  }}>{fetchLoading?"Fetching…":"Refresh Prices"}</button>
                  {status && <span style={{ fontSize:9, color:fetchLoading?P.ac:P.dm }}>{status}</span>}
                </div>
              </div>
            </Card>
            {["Conviction","Short Bull","Short Bear","Long Bull","Long Bear","LEAPS Bull","LEAPS Bear"].map(cat => {
              const items = perf.filter(p=>p.cat===cat);
              if (items.length===0) return null;
              const catColor = cat.includes("Bull")?P.bu:cat.includes("Bear")?P.be:P.ac;
              const filled = items.filter(r=>r.now>0);
              const avgPnl = filled.length>0 ? filled.reduce((s,r)=>s+((r.now-r.entry)/r.entry*100),0)/filled.length : 0;
              const winners = filled.filter(r=>r.now>r.entry).length;
              return (
                <Card key={cat} title={cat} sub={`${items.length} contracts`}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${P.bd}` }}>
                        {["Ticker","C/P","Strike","Exp","Hits","Entry","Range","Now","P&L","P&L %","Dir"].map(h=>(
                          <th key={h} style={{ padding:"5px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => {
                        const curr = r.now||0;
                        const pnl = curr>0 ? curr-r.entry : 0;
                        const pnlPct = curr>0&&r.entry>0 ? (curr-r.entry)/r.entry*100 : 0;
                        const pnlColor = pnl>0?P.bu:pnl<0?P.be:P.dm;
                        return (
                          <tr key={r.id} style={{ borderBottom:`1px solid ${P.bd}10` }}>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{r.sym}</td>
                            <td style={{ padding:"5px 5px" }}><Tag c={r.cp==="C"?P.bu:P.be}>{r.cp}</Tag></td>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>${r.strike}</td>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{r.exp}</td>
                            <td style={{ padding:"5px 5px" }}><span style={{ fontWeight:800, color:r.hits>=10?P.ac:r.hits>=5?P.ye:P.dm }}>{r.hits}x</span></td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:P.wh }}>{r.entry>0?`$${r.entry.toFixed(2)}`:"—"}</td>
                            <td style={{ padding:"5px 5px", fontSize:9, color:P.mt }}>{r.lo&&r.lo!==r.hi?`$${r.lo.toFixed(2)}–$${r.hi.toFixed(2)}`:"—"}</td>
                            <td style={{ padding:"5px 5px" }}>
                              <input type="number" step="0.01" value={curr||""} placeholder="—"
                                onChange={e=>{ const v=parseFloat(e.target.value)||0; setPerf(prev=>prev.map(p=>p.id===r.id?{...p,now:v}:p)); }}
                                style={{ width:70, padding:"3px 6px", borderRadius:4, fontSize:10, fontWeight:700, background:P.al, border:`1px solid ${P.bl}`, color:P.wh, fontFamily:"inherit", outline:"none" }}
                              />
                            </td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:pnlColor }}>{curr>0?`${pnl>=0?"+":""}$${pnl.toFixed(2)}`:"—"}</td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:pnlColor }}>{curr>0?`${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%`:"—"}</td>
                            <td style={{ padding:"5px 5px" }}><Tag c={r.dir==="BULL"?P.bu:P.be}>{r.dir}</Tag></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filled.length>0 && (
                    <div style={{ display:"flex", gap:16, fontSize:10, marginTop:4, color:P.dm }}>
                      <span>Win rate: <strong style={{ color:winners/filled.length>=0.5?P.bu:P.be }}>{winners}/{filled.length}</strong></span>
                      <span>Avg P&L: <strong style={{ color:avgPnl>=0?P.bu:P.be }}>{avgPnl>=0?"+":""}{avgPnl.toFixed(1)}%</strong></span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* ── Search ── */}
        {tab==="Search" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <input type="text" value={search}
                onChange={e=>{ const v=e.target.value.toUpperCase(); setSearch(v); setSelectedTicker(D.TICKER_DB.find(t=>t.s===v)||null); }}
                placeholder="Enter ticker symbol (e.g. TSLA, NVDA, AMZN)"
                style={{ width:"100%", padding:"10px 16px", borderRadius:8, fontSize:13, fontWeight:600, background:P.al, border:`1px solid ${P.bl}`, color:P.wh, fontFamily:"inherit", outline:"none", letterSpacing:1 }}
              />
              {search && D.ALL_SYMS.filter(s=>s.startsWith(search)&&s!==search).length>0 && !selectedTicker && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:4 }}>
                  {D.ALL_SYMS.filter(s=>s.startsWith(search)).slice(0,12).map(s=>(
                    <button key={s} onClick={()=>{ setSearch(s); setSelectedTicker(D.TICKER_DB.find(t=>t.s===s)||null); }}
                      style={{ padding:"3px 10px", borderRadius:4, border:`1px solid ${P.bl}`, background:P.cd, color:D.TICKER_DB.find(t=>t.s===s)?P.wh:P.mt, fontSize:10, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </Card>
            {selectedTicker && (() => {
              const tk = selectedTicker;
              const net = tk.b - tk.r;
              const dir = net>0?"BULL":"BEAR";
              const dirC = dir==="BULL"?P.bu:P.be;
              return (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <div style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10, padding:16, borderTop:`3px solid ${dirC}` }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Net Direction</div>
                      <div style={{ fontSize:28, fontWeight:900, color:dirC }}>{dir}</div>
                      <div style={{ fontSize:10, color:P.dm, marginTop:4 }}>{tk.n} confirmed trades</div>
                    </div>
                    <div style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bullish Flow</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.bu }}>{fmt(tk.b)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:`${tk.b/(tk.b+tk.r)*100}%`, height:"100%", background:P.bu, borderRadius:2 }} />
                      </div>
                    </div>
                    <div style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bearish Flow</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.be }}>{fmt(tk.r)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:`${tk.r/(tk.b+tk.r)*100}%`, height:"100%", background:P.be, borderRadius:2 }} />
                      </div>
                    </div>
                  </div>
                  <Card title={`${tk.s} — Top Confirmed Trades`} sub={`${tk.n} total`}><TT rows={tk.t} /></Card>
                  {tk.c.length>0 && <Card title={`${tk.s} — Consistency (2+ hits)`}><CT rows={tk.c} /></Card>}
                </>
              );
            })()}
          </div>
        )}

        {/* ── Short Term ── */}
        {tab==="Short Term" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Bets" sub="0–14 DTE"><NC data={D.SB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Bearish Bets" sub="0–14 DTE"><NC data={D.SR_SYM} fill={P.be} dir="bear"/></Card>
            </div>
            <Card title="Short-Term Bullish Trades" sub={fmt(D.shortBullTotal)}><TT rows={D.SBL}/></Card>
            <Card title="Short-Term Bearish Trades" sub={fmt(D.shortBearTotal)}><TT rows={D.SBR}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Consistency" sub="2+ hits"><CT rows={D.SBLC}/></Card>
              <Card title="Bearish Consistency" sub="2+ hits"><CT rows={D.SBRC}/></Card>
            </div>
          </div>
        )}

        {/* ── Long Term ── */}
        {tab==="Long Term" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Bets" sub="15+ DTE"><NC data={D.LB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Bearish Bets" sub="15+ DTE"><NC data={D.LR_SYM} fill={P.be} dir="bear"/></Card>
            </div>
            <Card title="Long-Term Bullish Trades" sub={fmt(D.longBullTotal)}><TT rows={D.LBL}/></Card>
            <Card title="Long-Term Bearish Trades" sub={fmt(D.longBearTotal)}><TT rows={D.LBR_T}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Consistency" sub="2+ hits"><CT rows={D.LBLC}/></Card>
              <Card title="Bearish Consistency" sub="2+ hits"><CT rows={D.LBRC}/></Card>
            </div>
          </div>
        )}

        {/* ── LEAPS ── */}
        {tab==="LEAPS" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10, padding:20, borderLeft:`4px solid ${P.bu}` }}>
                <div style={{ fontSize:11, color:P.bu, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>LEAPS Bull Side</div>
                <div style={{ fontSize:24, fontWeight:900, color:P.bu, marginBottom:4 }}>{fmt(D.leapsBullTotal)}</div>
                <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>{D.LEAPS_BLC.slice(0,2).map(c=>`${c.S} $${c.K}${c.CP} ${c.E} hit ${c.H}x`).join(". ")}</div>
              </div>
              <div style={{ background:P.cd, border:`1px solid ${P.bd}`, borderRadius:10, padding:20, borderLeft:`4px solid ${P.be}` }}>
                <div style={{ fontSize:11, color:P.be, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>LEAPS Bear Side</div>
                <div style={{ fontSize:24, fontWeight:900, color:P.be, marginBottom:4 }}>{fmt(D.leapsBearTotal)}</div>
                <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>{D.LEAPS_BRC.slice(0,2).map(c=>`${c.S} $${c.K}${c.CP} ${c.E} hit ${c.H}x`).join(". ")}</div>
              </div>
            </div>
            {D.LEAPS_EXPS.length>0 && (
              <Card title="LEAPS by Expiration" sub="180+ DTE">
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  {D.LEAPS_EXPS.map((e,i)=>(
                    <div key={i} style={{ background:P.al, borderRadius:8, padding:"10px 12px", border:`1px solid ${P.bd}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
                        <span style={{ fontSize:13, fontWeight:800, color:P.wh }}>{e.exp}</span>
                        <span style={{ fontSize:9, color:P.mt }}>{e.dte}</span>
                      </div>
                      <div style={{ fontSize:14, fontWeight:800, color:P.ac, marginBottom:4 }}>{fmt(e.p)}</div>
                      <div style={{ fontSize:9, color:P.dm }}>{e.n} trades · {e.names}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Bets" sub="180+ DTE"><NC data={D.LEAPS_B} fill={P.bu} dir="bull"/></Card>
              <Card title="Bearish Bets" sub="180+ DTE"><NC data={D.LEAPS_R} fill={P.be} dir="bear"/></Card>
            </div>
            <Card title="LEAPS Bullish Trades"><TT rows={D.LEAPS_BL_T}/></Card>
            <Card title="LEAPS Bearish Trades"><TT rows={D.LEAPS_BR_T}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bull Consistency" sub="2+ hits"><CT rows={D.LEAPS_BLC}/></Card>
              <Card title="Bear Consistency" sub="2+ hits"><CT rows={D.LEAPS_BRC}/></Card>
            </div>
          </div>
        )}

        {/* ── OI Watchlist ── */}
        {tab==="OI Watchlist" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14 }}>
                <div style={{ width:3, background:P.uc, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:P.uc, marginBottom:5 }}>OI Check Needed</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>WHITE trades — volume didn't exceed OI. Could be opening or closing. Verify next-day OI to confirm direction.</div>
                </div>
              </div>
            </Card>
            <Card title="OI Watchlist" sub="Top unconfirmed by premium">
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${P.bd}` }}>
                    {["Ticker","C/P","Strike","Exp","Type","Side","Vol","OI","Premium","Vol/OI"].map(h=>(
                      <th key={h} style={{ padding:"5px 4px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {D.WATCH.map((r,i)=>{
                    const pct = r.OI>0?Math.round(r.V/r.OI*100):999;
                    return (
                      <tr key={i} style={{ borderBottom:`1px solid ${P.bd}10` }}>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
                        <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
                        <td style={{ padding:"5px 4px" }}><Tag c={tc(r.Ty)}>{r.Ty}</Tag></td>
                        <td style={{ padding:"5px 4px" }}>
                          {r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}
                        </td>
                        <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.V)}</td>
                        <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.OI)}</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:P.wh }}>{fmt(r.P)}</td>
                        <td style={{ padding:"5px 4px", fontWeight:600, color:pct>=80?P.ac:pct>=50?P.ye:P.dm }}>{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        <div style={{ marginTop:16, padding:"10px 0", borderTop:`1px solid ${P.bd}`, display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:9, color:P.mt }}>Options Flow Dashboard · {D.dateRange} · {fileName}</span>
          <span style={{ fontSize:9, color:P.mt }}>YELLOW/MAG = confirmed · WHITE = check OI · No ML/</span>
        </div>
      </div>
    </div>
  );
}
