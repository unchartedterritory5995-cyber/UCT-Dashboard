import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { BarChart, Bar, AreaChart, Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ─── Flow Data loaded dynamically from /flow-data.csv ─────────────────────────


// ─── Color Palette ─────────────────────────────────────────────────────────────
const P = {
  bg:"#06090f", cd:"#0d1321", al:"#111a2e", bd:"#1a2540", bl:"#243352",
  bu:"#00e676", be:"#ff1744", ac:"#ffab00", tx:"#c8d6e5", dm:"#7b8fa3",
  mt:"#4a5c73", wh:"#f0f4f8", ye:"#ffd600", ma:"#e040fb", sw:"#00b0ff",
  bk:"#b388ff", uc:"#78909c"
};

// ─── Formatting ────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null || isNaN(n)) return "$0";
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
function premC(n) {
  if (n >= 5e6) return "#00e676";   // $5M+ = bright green
  if (n >= 1e6) return "#66ff99";   // $1M+ = green
  if (n >= 500e3) return "#ffab00"; // $500K+ = gold
  if (n >= 100e3) return "#f0f4f8"; // $100K+ = white
  return "#4a5c73";                 // under $100K = dim
}

// ─── Grade System ──────────────────────────────────────────────────────────────
function gradeCluster(c) {
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
const GRADE_COLORS = { "A+":"#ffd600", "A":"#ffab00", "B+":"#00e676", "B":"#00b0ff", "C":"#78909c", "D":"#4a5c73" };

// ─── UI Components ─────────────────────────────────────────────────────────────
const TIPS = {
  "AA": "Above Ask — Bought aggressively above the ask price. Maximum urgency.",
  "BB": "Below Bid — Sold below the bid. If Sweep: urgent directional. If Block: repositioning/institutional.",
  "A": "At Ask — Bought at the asking price. Directional but not desperate.",
  "BID": "At Bid — Sold at the bid. Could be closing or hedging, ambiguous.",
  "SWP": "Sweep — Order split across multiple exchanges for fast fill. Shows urgency.",
  "BLK": "Block — Single large fill at one exchange. Needs Sweep confirmation to be strong.",
  "YELLOW": "OI Exceeded — Volume exceeded open interest in a single trade. Notable activity.",
  "MAGENTA": "OI Exceeded (Multiple) — Volume exceeded OI across multiple trades. Strongest signal.",
  "WHITE": "Standard — Volume did not exceed open interest. Check next-day OI to confirm.",
};
function Tag({ c, children }) {
  const tip = TIPS[children] || null;
  return (
    <span title={tip} style={{
      display:"inline-block", padding:"2px 7px", borderRadius:3,
      fontSize:9, fontWeight:700, letterSpacing:0.4, whiteSpace:"nowrap",
      color:c, backgroundColor:c+"15", border:"1px solid "+c+"30",
      cursor: tip ? "help" : "default"
    }}>{children}</span>
  );
}

function Card({ children, title, sub }) {
  return (
    <div style={{
      background:P.cd, border:"1px solid "+P.bd, borderRadius:10,
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

function TT({ rows, priceFn, onRowClick, panelFn }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const colCount = ["Ticker","Day","Strike","C/P","Exp","Entry",priceFn?"Now":null,priceFn?"P&L":null,"Premium","Flow","Vol","OI",priceFn?"ΔOI":null,"DTE"].filter(Boolean).length;
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:"1px solid "+P.bd }}>
          {["Ticker","Day","Strike","C/P","Exp","Entry",priceFn?"Now":null,priceFn?"P&L":null,"Premium","Flow","Vol","OI",priceFn?"ΔOI":null,"DTE"].filter(Boolean).map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:h==="Flow"?"center":"left", color:P.mt, fontSize:9, fontWeight:600, cursor:h==="ΔOI"?"help":"default" }} title={h==="ΔOI"?"Change in total open interest across all market participants — not just the trades shown. ΔOI > Vol means more traders are piling in on this strike.":undefined}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const px = priceFn ? priceFn(r.S, r.CP, r.K, r.E) : null;
          const entry = r.price || (r.V > 0 ? r.P / r.V / 100 : 0);
          const now = px ? px.mark : 0;
          const pnl = now > 0 && entry > 0 ? (now - entry) / entry * 100 : 0;
          const pnlC = pnl > 0 ? P.bu : pnl < 0 ? P.be : P.dm;
          const csvOI = r.OI || 0;
          const curOI = px ? px.oi : 0;
          const dOI = curOI > 0 && csvOI > 0 ? curOI - csvOI : 0;
          const dOIC = dOI > 0 ? P.bu : dOI < 0 ? P.be : P.dm;
          const rowKey = r.S+"|"+r.CP+"|"+r.K+"|"+r.E+"|"+i;
          const isExpanded = expandedKey === rowKey;
          return (
            <Fragment key={i}>
            <tr onClick={()=>{ if(onRowClick) onRowClick(r); setExpandedKey(isExpanded ? null : rowKey); }} style={{ borderBottom:"1px solid "+P.bd+"10", background:isExpanded?(P.ac+"12"):(r.Si==="AA"||r.Si==="BB")?(P.ac+"08"):"transparent", cursor:"pointer" }}>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
              <td style={{ padding:"5px 4px", color:P.dm, fontSize:9 }}>{r.Dt}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>}
              <td style={{ padding:"5px 4px", fontWeight:700, color:premC(r.P) }}>{fmt(r.P)}</td>
              <td style={{ padding:"5px 4px" }}>
                <span style={{ display:"flex", gap:2, flexWrap:"wrap", justifyContent:"center" }}>
                  <Tag c={tc(r.Ty)}>{r.Ty}</Tag>
                  {r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}
                  <Tag c={r.Co==="YELLOW"?P.ye:r.Co==="MAGENTA"?P.ma:P.uc}>{r.Co}</Tag>
                </span>
              </td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.V)}</td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{csvOI>0?csvOI.toLocaleString():"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:dOIC }}>{dOI!==0?(dOI>0?"+":"")+dOI.toLocaleString():"—"}</td>}
              <td style={{ padding:"5px 4px", color:P.dm }}>{r.DTE}d</td>
            </tr>
            {isExpanded && onRowClick && (
              <tr><td colSpan={colCount} style={{ padding:0, background:"#060e1e" }}>
                {panelFn ? panelFn(r.S, r.CP, r.K, r.E, ()=>setExpandedKey(null)) : null}
              </td></tr>
            )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function CT({ rows, priceFn, onRowClick, panelFn }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const colCount = ["Ticker","Strike","C/P","Exp","Entry",priceFn?"Now":null,priceFn?"P&L":null,"Premium","Hits","Grade","OI",priceFn?"ΔOI":null,priceFn?"Δ":null,priceFn?"θ":null].filter(Boolean).length;
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:"1px solid "+P.bd }}>
          {["Ticker","Strike","C/P","Exp","Entry",priceFn?"Now":null,priceFn?"P&L":null,"Premium","Hits","Grade","OI",priceFn?"ΔOI":null,priceFn?"Δ":null,priceFn?"θ":null].filter(Boolean).map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:h==="Flow"?"center":"left", color:P.mt, fontSize:9, fontWeight:600, cursor:h==="ΔOI"?"help":"default" }} title={h==="ΔOI"?"Change in total open interest across all market participants — not just the trades shown. ΔOI > Vol means more traders are piling in on this strike.":undefined}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const px = priceFn ? priceFn(r.S, r.CP, r.K, r.E) : null;
          const entry = r.entry || (r.V > 0 ? r.P / r.V / 100 : 0);
          const now = px ? px.mark : 0;
          const pnl = now > 0 && entry > 0 ? (now - entry) / entry * 100 : 0;
          const pnlC = pnl > 0 ? P.bu : pnl < 0 ? P.be : P.dm;
          const csvOI = r.maxOI || 0;
          const curOI = px ? px.oi : 0;
          const dOI = curOI > 0 && csvOI > 0 ? curOI - csvOI : 0;
          const dOIC = dOI > 0 ? P.bu : dOI < 0 ? P.be : P.dm;
          const rowKey = r.S+"|"+r.CP+"|"+r.K+"|"+r.E+"|"+i;
          const isExpanded = expandedKey === rowKey;
          return (
            <Fragment key={i}>
            <tr onClick={()=>{ if(onRowClick) onRowClick(r); setExpandedKey(isExpanded ? null : rowKey); }} style={{ borderBottom:"1px solid "+P.bd+"10", background:isExpanded?(P.ac+"12"):r.H>=5?(P.ac+"08"):"transparent", cursor:"pointer" }}>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>}
              <td style={{ padding:"5px 4px", fontWeight:700, color:premC(r.P) }}>{fmt(r.P)}</td>
              <td style={{ padding:"5px 4px" }}>
                <span style={{ fontWeight:800, fontSize:13, color:r.H>=10?P.ac:r.H>=5?P.ye:P.dm }}>{r.H}x</span>
              </td>
              <td style={{ padding:"5px 4px" }}><Tag c={GRADE_COLORS[r.grade]||P.mt}>{r.grade||"—"}</Tag></td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{csvOI>0?csvOI.toLocaleString():"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:dOIC }}>{dOI!==0?(dOI>0?"+":"")+dOI.toLocaleString():"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontSize:9, color:P.dm }}>{px&&px.delta?px.delta.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontSize:9, color:px&&px.theta<0?P.be:P.dm }}>{px&&px.theta?px.theta.toFixed(2):"—"}</td>}
            </tr>
            {isExpanded && onRowClick && (
              <tr><td colSpan={colCount} style={{ padding:0, background:"#060e1e" }}>
                {panelFn ? panelFn(r.S, r.CP, r.K, r.E, ()=>setExpandedKey(null)) : null}
              </td></tr>
            )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function NC({ data, fill, dir, onBarClick }) {
  const neg = dir === "bear";
  const cd = data.map(d => ({ ...d, v: neg ? -Math.abs(d.n) : d.n }));
  return (
    <div style={{ height:220 }}>
      <ResponsiveContainer>
        <BarChart data={cd} layout="vertical" margin={{ top:0, right:8, left:5, bottom:0 }}
          onClick={onBarClick ? (e) => { if (e && e.activePayload && e.activePayload[0]) { onBarClick(e.activePayload[0].payload); } } : undefined}>
          <CartesianGrid strokeDasharray="3 3" stroke={P.bd} horizontal={false} />
          <XAxis type="number" tick={{ fill:P.mt, fontSize:8 }} tickFormatter={v => fmt(Math.abs(v))} />
          <YAxis dataKey="s" type="category" tick={{ fill:P.tx, fontSize:11, fontWeight:700 }} width={60} interval={0} tickLine={false} axisLine={false} />

          <Bar dataKey="v" fill={fill} radius={neg?[4,0,0,4]:[0,4,4,0]} barSize={14} cursor={onBarClick?"pointer":"default"} />
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
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === "," && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, "")); current = ""; }
    else { current += line[i]; }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const rawHeaders = parseCSVLine(lines[0]);
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
    Object.entries(colIdx).forEach(([field, idx]) => { row[field] = (cols[idx] || "").trim(); });
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
  if (y === cy) return m+"/"+d;
  return m+"/"+d+"/"+String(y).slice(2);
}
// Convert display exp (e.g. "3/20" or "12/18/26") to YYYY-MM-DD for Schwab API
function expToISO(expStr) {
  if (!expStr) return "";
  const parts = expStr.split("/");
  if (parts.length < 2) return "";
  const m = parseInt(parts[0]);
  const d = parseInt(parts[1]);
  let y;
  if (parts.length === 3) {
    y = parseInt(parts[2]);
    if (y < 100) y += 2000;
  } else {
    y = new Date().getFullYear();
    const test = new Date(y, m - 1, d);
    if (test < new Date()) y++;
  }
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

// ─── Mega Cap Filter ───────────────────────────────────────────────────────────
function isMegaCap(mktcap) { return mktcap >= 500e9; }
function premiumFilter(premium, mktcap) {
  if (!isMegaCap(mktcap)) return true; // any size for non-mega
  return premium >= 100000; // $100K+ for mega caps
}

// ─── Cap Band Helpers ──────────────────────────────────────────────────────────
function capBand(mktcap) {
  if (!mktcap || mktcap <= 0) return "Unknown";
  if (mktcap >= 500e9) return "Mega";
  if (mktcap >= 10e9)  return "Large";
  if (mktcap >= 2e9)   return "Mid";
  return "Small";
}
function filterByCap(trades, cap) {
  if (!cap || cap === "All") return trades;
  return trades.filter(t => capBand(t.mktcap) === cap);
}
function sum(arr) { return arr.reduce((a,t)=>a+t.P,0); }
function netByTicker(trades, n=8) {
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
function topTradesFn(trades, n=10) {
  return [...trades]
    .sort((a,b) => ((b.Si==="AA"||b.Si==="BB"?1000:0)+(b.Ty==="SWP"?100:0)+b.P/1e6) -
                   ((a.Si==="AA"||a.Si==="BB"?1000:0)+(a.Ty==="SWP"?100:0)+a.P/1e6))
    .slice(0,n);
}
function consistencyTable(trades, n=8) {
  const m = {};
  trades.forEach(t => {
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!m[k]) m[k] = { S:t.S, CP:t.CP, K:t.K, E:t.E, H:0, P:0, V:0, D:t.D,
      hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true, prices:[], maxOI:0 };
    m[k].H++; m[k].P+=t.P; m[k].V+=t.V;
    if (t.price > 0) m[k].prices.push(t.price);
    if (t.OI > m[k].maxOI) m[k].maxOI = t.OI;
    if (t.Ty==="SWP") m[k].hasSweep = true;
    if (t.Ty==="BLK") m[k].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") m[k].oiExceeded = true;
    if (t.D) m[k].dirs.add(t.D);
  });
  return Object.values(m).filter(c=>c.H>=2).map(c => {
    c.clean = c.dirs.size <= 1;
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
function buildCharts(cc) {
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
    if (!allCons[k]) allCons[k] = { sym:t.S, cp:t.CP, K:t.K, exp:t.E, DTE:t.DTE, hits:0, prem:0, dir:t.D,
      hasAA:false, hasBB:false, hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true };
    if (!consTrades[k]) consTrades[k] = [];
    consTrades[k].push(t);
    allCons[k].hits++; allCons[k].prem += t.P;
    if (t.Si==="AA") allCons[k].hasAA = true;
    if (t.Si==="BB") allCons[k].hasBB = true;
    if (t.Ty==="SWP") allCons[k].hasSweep = true;
    if (t.Ty==="BLK") allCons[k].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") allCons[k].oiExceeded = true;
    if (t.D) allCons[k].dirs.add(t.D);
  });
  const CONV = Object.values(allCons).filter(c=>c.dir).map(c => {
    c.clean = c.dirs.size <= 1;
    const grade = gradeCluster(c);
    const scoreMap = {"A+":600,"A":500,"B+":400,"B":300,"C":200,"D":100};
    const k = c.sym+"|"+c.cp+"|"+c.K+"|"+c.exp;
    const trades = (consTrades[k]||[]).sort((a,b)=>b.P-a.P);
    return { ...c, grade, score:(scoreMap[grade]||0)+c.hits*50+c.prem/1e5,
      side:c.hasAA?"AA":c.hasBB?"BB":"ASK", strike:"$"+c.K+c.cp, trades };
  }).filter(c => {
    if (!c.clean || c.DTE <= 7) return false;
    // Re-check expiry against today — parse c.exp "M/D" or "M/D/YYYY" at render time
    // so expired contracts disappear even if DTE in CSV was still positive
    if (c.exp) {
      const p = c.exp.split("/").map(Number);
      const y = p.length >= 3 ? p[2] : (new Date().getMonth()+1 > p[0] ? new Date().getFullYear()+1 : new Date().getFullYear());
      const expDate = new Date(y, p[0]-1, p[1], 23, 59, 59); // end of expiry day
      if (expDate < new Date()) return false;
    }
    return true;
  })
  .sort((a,b)=>b.score-a.score).slice(0,6)
  .map(c => ({ sym:c.sym, cp:c.cp, K:c.K, strike:c.strike, exp:c.exp, hits:c.hits, prem:c.prem, side:c.side, dir:c.dir, grade:c.grade,
    trades:c.trades.map(t=>({ Ty:t.Ty, Si:t.Si, Co:t.Co, V:t.V, P:t.P, DTE:t.DTE, OI:t.OI||0, IV:t.IV||0, time:t.time||"", Dt:t.Dt||"" })) }));
  const sectorMap = {};
  const tickerFlowMap = {};
  cc.forEach(t => {
    const sec = t.sector || "Unknown";
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
  return {
    DAYS, CONV, SB_SYM, SR_SYM, LB_SYM, LR_SYM, LEAPS_B, LEAPS_R,
    SBL, SBR, LBL, LBR_T, LEAPS_BL_T, LEAPS_BR_T,
    SBLC, SBRC, LBLC, LBRC, LEAPS_BLC, LEAPS_BRC, LEAPS_EXPS, SECTORS,
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
function processFlowData(rows) {
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
    const confirmed = color === "YELLOW" || color === "MAGENTA";
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
    }
    return {
      S:(r.ticker||"").toUpperCase().trim(), Ty:isSWP?"SWP":isBLK?"BLK":null,
      CP:cp, K:strike, V:volume, P:premium, price,
      E:expStr, expiry, Si:side, Co:color, DTE:dte, Dt:dt,
      D:direction, OI:oi, IV:iv, Spot:spot, isML, confirmed,
      mktcap, sector, uoa, isDeep, pctFromSpot,
      stocketf:(r.stocketf||"").toUpperCase().trim(),
      time:(r.time||"").trim()
    };
  });

  // Fix BBS misclassifications — these are stocks, not ETFs/indexes
  const ETF_BLACKLIST = new Set(["AAL"]);
  rawTrades.forEach(t => { if (ETF_BLACKLIST.has(t.S)) t.stocketf = "STOCK"; });

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

  // Filter: remove ML/, RED/canceled, invalid, and ML/-matched trades
  let filtered = rawTrades.filter(t =>
    !t.isML && t.S && t.Ty && t.CP && t.DTE >= 0 && t.V > 0 && t.P > 0 && t.Co !== "RED" && !mlMatched.has(t)
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

  // Arb filter: deep ITM/OTM detection
  // Deep ITM = always arb/rebalancing (e.g. MU $210P when spot $413), filter ALL
  // Deep OTM blocks alone = arb, but Sweep+Block at same deep OTM strike = noteworthy, keep
  const deepOTMBlockKeys = new Set();
  const deepOTMSweepKeys = new Set();
  filtered.forEach(t => {
    if (!t.isDeep) return;
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
    // Deep ITM = always arb, filter everything
    if (isITM) return false;
    // Deep OTM: keep if both sweep and block exist at same strike
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (deepOTMBlockKeys.has(k) && deepOTMSweepKeys.has(k)) return true;
    // Otherwise filter out deep OTM blocks (arb)
    if (t.Ty === "BLK") return false;
    return true;
  });

  // Mega cap premium filter
  filtered = filtered.filter(t => premiumFilter(t.P, t.mktcap));

  const confirmed_trades = filtered.filter(t => t.confirmed && t.D);
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
    // Index trades for time ordering (CSV is newest-first, so idx 0 = most recent)
    filtered.forEach((t, i) => { t._idx = i; });

    // Build cluster metadata from ALL filtered trades (need bid-side presence for DTE≤3 rule)
    filtered.forEach(t => {
      const k = t.S + "|" + t.CP + "|" + t.K + "|" + t.E;
      if (!clusterDirs[k]) clusterDirs[k] = { dirs: new Set(), askTimes:[], askIVs:[], bidTimes:[], bidIVs:[], bbSweepTimes:[], hasBidSide:false, hasAskSide:false, hasSweep:false, dte:t.DTE };
      if (t.Si === "B" || t.Si === "BB") { clusterDirs[k].hasBidSide = true; clusterDirs[k].bidTimes.push(t._idx); if (t.IV > 0) clusterDirs[k].bidIVs.push(t.IV); }
      if (t.Si === "A" || t.Si === "AA") { clusterDirs[k].hasAskSide = true; clusterDirs[k].askTimes.push(t._idx); if (t.IV > 0) clusterDirs[k].askIVs.push(t.IV); }
      if (t.Ty === "SWP") clusterDirs[k].hasSweep = true;
      if (!t.D) return; // stop here for non-directional trades
      clusterDirs[k].dirs.add(t.D);
      if (t.Si === "BB" && t.Ty === "SWP") clusterDirs[k].bbSweepTimes.push(t._idx);
    });

    Object.entries(clusterDirs).forEach(([k, c]) => {
      // DTE ≤ 3: dying weeklies with any bid-side = day trading/scalping noise
      if (c.dte >= 0 && c.dte <= 3 && c.hasBidSide) {
        dirtyClusterKeys.add(k);
        return;
      }
      // Block-only clusters (no sweep at this strike) = not directional
      if (!c.hasSweep) {
        dirtyClusterKeys.add(k);
        return;
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




  // UOA (unusual options activity)
  // Only include UOA trades where the cluster has confirmed OI activity (yellow/magenta)
  // All-white clusters = volume never exceeded OI = not confirmed, exclude from UOA
  // White blocks on Bid/BB = always exclude (ambiguous regardless)
  const uoaClusterOI = {}; // track if any yellow/magenta exists per cluster
  filtered.forEach(t => {
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!uoaClusterOI[k]) uoaClusterOI[k] = false;
    if (t.Co === "YELLOW" || t.Co === "MAGENTA") uoaClusterOI[k] = true;
  });
  const UOA_TRADES = filtered.filter(t => {
    if (!t.uoa) return false;
    // White blocks on bid side = always ambiguous, exclude
    if (t.Co === "WHITE" && t.Ty === "BLK" && (t.Si === "B" || t.Si === "BB")) return false;
    // All-white cluster (no yellow/magenta anywhere at this strike) = not confirmed, exclude
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!uoaClusterOI[k]) return false;
    return true;
  }).sort((a,b)=>b.P-a.P).slice(0,10);

  // OI Watchlist — cluster ALL trades by strike, rank by Vol/OI ratio
  const watchMap = {};
  filtered.forEach(t => {
    if (!t.OI || t.OI <= 0) return; // skip if no OI data
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!watchMap[k]) watchMap[k] = { S:t.S, CP:t.CP, K:t.K, E:t.E, V:0, OI:t.OI, P:0, Si:t.Si, Ty:t.Ty, trades:0,
      hasSweep:false, hasBlock:false, price:0, DTE:t.DTE };
    watchMap[k].V += t.V;
    watchMap[k].P += t.P;
    watchMap[k].trades++;
    if (t.price > 0 && watchMap[k].price === 0) watchMap[k].price = t.price;
    if (t.OI > watchMap[k].OI) watchMap[k].OI = t.OI;
    if (t.Ty === "SWP") watchMap[k].hasSweep = true;
    if (t.Ty === "BLK") watchMap[k].hasBlock = true;
  });
  const WATCH = Object.values(watchMap)
    .map(w => ({ ...w, volOI: w.OI > 0 ? w.V / w.OI : 0 }))
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
    ...buildPerfItems("Conviction", clean_confirmed.filter(t=>convSyms.has(t.S)), 6),
    ...buildPerfItems("Short Bull", _st.filter(t=>t.D==="BULL"), 3),
    ...buildPerfItems("Short Bear", _st.filter(t=>t.D==="BEAR"), 3),
    ...buildPerfItems("Long Bull", _lt.filter(t=>t.D==="BULL"), 3),
    ...buildPerfItems("Long Bear", _lt.filter(t=>t.D==="BEAR"), 3),
    ...buildPerfItems("LEAPS Bull", _lp.filter(t=>t.D==="BULL"), 4),
    ...buildPerfItems("LEAPS Bear", _lp.filter(t=>t.D==="BEAR"), 4),
  ];

  // Ticker DB for Search (all filtered trades, confirmed + unconfirmed)
  const tickerMap = {};
  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i];
    if (!tickerMap[t.S]) tickerMap[t.S] = { s:t.S, b:0, r:0, n:0, topTrades:[], minTopP:0, consMap:{} };
    const tk = tickerMap[t.S];
    tk.n++; if (t.D==="BULL") tk.b+=t.P; else if (t.D==="BEAR") tk.r+=t.P;
    // Keep running top 10 by premium (avoid sorting huge arrays)
    if (tk.topTrades.length < 10) {
      tk.topTrades.push(t);
      if (tk.topTrades.length === 10) tk.minTopP = Math.min(...tk.topTrades.map(x=>x.P));
    } else if (t.P > tk.minTopP) {
      const minIdx = tk.topTrades.findIndex(x=>x.P===tk.minTopP);
      if (minIdx >= 0) tk.topTrades[minIdx] = t;
      tk.minTopP = Math.min(...tk.topTrades.map(x=>x.P));
    }
    const ck = t.CP+"|"+t.K+"|"+t.E;
    if (!tk.consMap[ck]) tk.consMap[ck] = { S:t.S, CP:t.CP, K:t.K, E:t.E, H:0, P:0, V:0, D:t.D,
      hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true };
    tk.consMap[ck].H++; tk.consMap[ck].P+=t.P; tk.consMap[ck].V+=t.V;
    if (t.Ty==="SWP") tk.consMap[ck].hasSweep = true;
    if (t.Ty==="BLK") tk.consMap[ck].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") tk.consMap[ck].oiExceeded = true;
    if (t.D) tk.consMap[ck].dirs.add(t.D);
  }
  const TICKER_DB = Object.values(tickerMap)
    .sort((a,b)=>(b.b+b.r)-(a.b+a.r))
    .map(tk => ({
      s:tk.s, b:tk.b, r:tk.r, n:tk.n,
      t:tk.topTrades.sort((a,b)=>b.P-a.P),
      c:Object.values(tk.consMap).filter(c=>c.H>=2).map(c => {
        c.clean = c.dirs.size <= 1;
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
    TICKER_DB, ALL_SYMS, WATCH, PERF_INIT,
    UOA_TRADES, darkPool,
    dateRange, totalTrades:filtered.length,
    totalPremium:sum(filtered),
    confirmedCount:confirmed_trades.length,
  };
}

// ─── Main Component ────────────────────────────────────────────────────────────
const TABS = ["Market Read","Performance","Search","Short Term","Long Term","LEAPS","OI Check","Tracker"];

export default function OptionsFlowDashboard() {
  const [dataMode, setDataMode] = useState("stocks"); // "stocks" | "index"
  const [tab, setTab] = useState("Market Read");
  const [capFilter, setCapFilter] = useState("All"); // All | Mega | Large | Mid | Small
  const [perf, setPerf] = useState([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [status, setStatus] = useState("");
  const pricesFetchedRef = useRef(false);
  const [search, setSearch] = useState("");
  const [oiSearch, setOiSearch] = useState("");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [selectedConv, setSelectedConv] = useState(null); // clicked Top Flow card index
  const [selectedItem, setSelectedItem] = useState(null); // {sym,cp,K,exp} clicked from any table/chart
  const [priceCache, setPriceCache] = useState({}); // key: "SYM|CP|STRIKE|EXP" -> { mark, bid, ask, last, delta, theta, iv }
  const [marketIndices, setMarketIndices] = useState(null);
  const [marketNarrative, setMarketNarrative] = useState(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  // ─── Contract History (Polygon backfill + daily tracker) ─────────────
  const [contractHistory, setContractHistory] = useState({});
  const fetchingRef = useRef(new Set());
  const backfilledRef = useRef(new Set());
  const convPanelRef = useRef(null);

  // ─── Dynamic CSV Loading ─────────────────────────────────────────────
  const [csvText, setCsvText] = useState(null);
  const [csvLoading, setCsvLoading] = useState(true);
  const [csvError, setCsvError] = useState(null);
  const [D, setD] = useState(null);

  const csvFile = dataMode === "index" ? "/Indexes-data.csv" : "/flow-data.csv";

  useEffect(() => {
    let cancelled = false;
    setCsvLoading(true);
    setCsvError(null);
    setD(null);
    setSelectedConv(null);
    setSelectedItem(null);
    setSelectedTicker(null);
    setSearch("");
    setOiSearch("");
    setCapFilter("All");
    setTab("Market Read");
    const t0 = performance.now();

    fetch(csvFile)
        .then(res => {
          console.log(`[perf] CSV fetch: ${(performance.now()-t0).toFixed(0)}ms`);
          if (!res.ok) throw new Error(`Server returned ${res.status} for ${csvFile}`);
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("text/html")) throw new Error(`Got HTML instead of CSV — ${csvFile} not found.`);
          return res.text();
        })
        .then(text => {
          if (cancelled) return;
          console.log(`[perf] Downloaded: ${(performance.now()-t0).toFixed(0)}ms (${(text.length/1024).toFixed(0)}KB)`);
          const trimmed = text.trim();
          if (trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
            throw new Error(`Got HTML instead of CSV — ${csvFile} not found on server.`);
          }
          if (!trimmed.includes(",") || trimmed.length < 50) {
            throw new Error("File appears empty or invalid (no CSV data found).");
          }
          setTimeout(() => {
            if (cancelled) return;
            try {
              const t1 = performance.now();
              const rows = parseCSV(text);
              console.log(`[perf] CSV parsed: ${(performance.now()-t1).toFixed(0)}ms (${rows.length} rows)`);
              if (!rows || rows.length === 0) throw new Error("CSV parsed but contained 0 valid rows. Check file format.");
              const t2 = performance.now();
              const data = processFlowData(rows);
              console.log(`[perf] processFlowData: ${(performance.now()-t2).toFixed(0)}ms`);
              console.log(`[perf] Total: ${(performance.now()-t0).toFixed(0)}ms`);
              if (!cancelled) { setD(data); setCsvLoading(false); }
            } catch(err) {
              if (!cancelled) { setCsvError(err.message); setCsvLoading(false); }
            }
          }, 0);
        })
        .catch(err => { if (!cancelled) { setCsvError(err.message); setCsvLoading(false); } });
    return () => { cancelled = true; };
  }, [csvFile]);


  // Cap-filtered view: recompute charts using only the selected cap band's clean_confirmed
  const FD = useMemo(() => {
    if (!D) return null;
    if (capFilter === "All") return D;
    const cc = filterByCap(D.clean_confirmed, capFilter);
    const charts = buildCharts(cc);
    return { ...D, ...charts };
  }, [D, capFilter]);

  useEffect(() => {
    if (D) {
      const perfInit = D.PERF_INIT.map(p => ({ ...p, now:0 }));
      setPerf(perfInit);
      pricesFetchedRef.current = false;
      // Auto-fetch prices for all visible contracts after data loads
      setTimeout(() => {
        const allContracts = [];
        // Conviction picks
        if (D.CONV) D.CONV.forEach(t => allContracts.push({ sym:t.sym, cp:t.cp, strike:t.K, exp:t.exp }));
        // Perf items
        perfInit.forEach(p => allContracts.push({ sym:p.sym, cp:p.cp, strike:p.strike, exp:p.exp }));
        if (allContracts.length > 0) fetchPrices(allContracts);
      }, 600);
    }
  }, [D]);

  // Auto-scroll to Top Flow detail panel when opened
  useEffect(() => {
    if (selectedConv !== null && convPanelRef.current) {
      setTimeout(() => convPanelRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
    }
  }, [selectedConv]);

  // ─── Top Flow Tracker ───────────────────────────────────────────────
  const [topFlowPicks, setTopFlowPicks] = useState({ active:[], archived:[] });
  const [showArchived, setShowArchived] = useState(false);

  // Fetch history after initial render (deferred)
  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/top-flow/history").then(r=>r.ok?r.json():null).then(data=>{
        if (data) setTopFlowPicks(data);
      }).catch(()=>{});
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // Auto-save Top Flow picks when CSV loads — also populate locally as fallback
  useEffect(() => {
    if (!D || !D.CONV || D.CONV.length === 0) return;
    const today = new Date().toISOString().slice(0,10);
    const picks = D.CONV.map(c => {
      const trades = c.trades || [];
      const prices = trades.filter(t=>t.V>0).map(t=>t.P/t.V/100).filter(p=>p>0);
      const sorted = [...prices].sort((a,b)=>a-b);
      const entry = sorted.length > 0 ? sorted[Math.floor(sorted.length/2)] : 0;
      return { sym:c.sym, cp:c.cp, strike:parseFloat(c.K), exp:c.exp, entry:Math.round(entry*100)/100, grade:c.grade, dir:c.dir, hits:c.hits, prem:c.prem };
    });
    // Populate locally immediately so tracker shows even without backend
    const localPicks = picks.map(p => ({
      id: `${p.sym}|${p.cp}|${p.strike}|${p.exp}`,
      ...p, dateSaved: today, history: []
    }));
    setTopFlowPicks(prev => {
      const existingMap = {};
      prev.active.forEach(a => { existingMap[a.id] = a; });
      const merged = localPicks.map(lp => existingMap[lp.id] ? { ...existingMap[lp.id], grade:lp.grade, hits:lp.hits, prem:lp.prem, dir:lp.dir } : lp);
      return { ...prev, active: merged };
    });
    // Also try to save to backend (deferred — non-critical)
    setTimeout(() => {
      fetch("/api/top-flow/save", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(picks) })
        .then(r=>r.ok?r.json():null)
        .then(()=>{
          fetch("/api/top-flow/history").then(r=>r.ok?r.json():null).then(data=>{ if(data) setTopFlowPicks(data); }).catch(()=>{});
        })
        .catch(()=>{});
    }, 1000);
  }, [D]);

  // Auto-load market data (deferred — non-critical)
  useEffect(() => { const t = setTimeout(fetchMarketData, 800); return () => clearTimeout(t); }, []);

  // ─── Shared detail panel renderer ─────────────────────────────────────────
  function renderDetailPanel(sym, cp, K, exp, onClose) {
    if (!sym || !cp || !K || !exp) return null;
    // Render as fixed modal overlay — appears centered over page
    const modal = (content) => (
      <div onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}
        style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.75)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
        <div style={{ width:"min(900px,96vw)", maxHeight:"90vh", overflowY:"auto",
          borderRadius:14, boxShadow:"0 24px 80px rgba(0,0,0,0.9)" }}
          onClick={e=>e.stopPropagation()}>
          {content}
        </div>
      </div>
    );
    const c = cp === "C" ? P.bu : P.be;
    const px = getPrice(sym, cp, K, exp);
    const curOI = px ? px.oi : 0;
    const curPrice = px ? (px.mark || px.last || 0) : 0;
    // Auto-fetch live price if not in cache yet
    if (!px) {
      fetch("/api/uw/options-quotes", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify([{symbol:sym, cp, strike:parseFloat(K), expDate:expToISO(exp)}]),
      }).then(r=>r.ok?r.json():null).then(data=>{
        const q=data?.quotes?.[0];
        if(q&&!q.error){
          setPriceCache(prev=>({...prev,[sym+"|"+cp+"|"+parseFloat(K)+"|"+exp]:{
            mark:q.mark||0,bid:q.bid||0,ask:q.ask||0,last:q.last||0,
            delta:q.delta||0,theta:q.theta||0,iv:q.iv||0,
            oi:q.openInterest||0,vol:q.volume||0,spot:q.underlyingPrice||0,
          }}));
        }
      }).catch(()=>{});
    }
    // Find all trades for this contract across all flow data
    const allTrades = D ? (D.clean_confirmed || []).filter(t =>
      t.S === sym && t.CP === cp && Math.abs(t.K - K) < 0.01 && t.E === exp
    ) : [];
    const byDay = {};
    allTrades.forEach(tr => {
      const day = tr.Dt ? tr.Dt+"/2026" : "—";
      if (!byDay[day]) byDay[day] = { trades:[], vol:0, maxOI:0, prem:0, prices:[] };
      byDay[day].trades.push(tr);
      byDay[day].vol += tr.V;
      byDay[day].prem += tr.P;
      if (tr.OI > byDay[day].maxOI) byDay[day].maxOI = tr.OI;
      const ep = tr.V > 0 ? tr.P / tr.V / 100 : 0;
      if (ep > 0) byDay[day].prices.push(ep);
    });
    const _toDate = s => { const p=s.split('/').map(Number); const y=p.length>=3?p[2]:2026; return new Date(y,p[0]-1,p[1]); };
    const _mdSort = (a,b) => _toDate(a)-_toDate(b);
    const flowDays = Object.keys(byDay).sort(_mdSort);
    const histKey = `${sym}|${cp}|${parseFloat(K)}|${exp}`;
    const trackerHistory = contractHistory[histKey] || [];
    const trackerByDay = {};
    trackerHistory.forEach(h => {
      const parts = h.date.split("/");
      const key = parts.length >= 3 ? h.date : parts.length >= 2 ? h.date+"/2026" : h.date;
      const dt = new Date(parseInt(parts.length>=3?parts[2]:2026), parseInt(parts[0])-1, parseInt(parts[1]));
      trackerByDay[key] = dt.getDay()===0||dt.getDay()===6 ? {...h,volume:0} : h;
    });
    const allDays = [];
    if (flowDays.length > 0) {
      const first = _toDate(flowDays[0]);
      const today = new Date();
      const d = new Date(first);
      while (d <= today) {
        if (d.getDay()!==0&&d.getDay()!==6) allDays.push((d.getMonth()+1)+"/"+d.getDate()+"/"+(d.getFullYear()));
        d.setDate(d.getDate()+1);
      }
    }
    const allKnownDays = new Set([...(allDays.length>0?allDays:flowDays), ...Object.keys(trackerByDay)]);
    const days = [...allKnownDays].filter(s => {
      const p=s.split("/").map(Number); const y=p.length>=3?p[2]:2026;
      const dow=new Date(y,p[0]-1,p[1]).getDay(); return dow!==0&&dow!==6;
    }).sort(_mdSort);
    const chartData = [];
    let lastOI=0, lastPrice=0;
    days.forEach(day => {
      const fd=byDay[day], snap=trackerByDay[day];
      if (fd) {
        if (fd.maxOI>0) lastOI=fd.maxOI;
        if (snap&&snap.oi>0) lastOI=snap.oi;
        const dp=fd.prices.length>0?fd.prices.reduce((a,b)=>a+b,0)/fd.prices.length:0;
        if (dp>0) lastPrice=dp;
        if (snap&&snap.price>0) lastPrice=snap.price;
        chartData.push({day,vol:snap?(snap.volume||fd.vol):fd.vol,oi:lastOI,price:lastPrice,prem:fd.prem,trades:fd.trades.length,hasFlow:true});
      } else if (snap) {
        if (snap.oi>0) lastOI=snap.oi;
        if (snap.price>0) lastPrice=snap.price;
        chartData.push({day,vol:snap.volume||0,oi:lastOI,price:lastPrice,prem:0,trades:0,hasFlow:false,isTracked:true});
      } else {
        chartData.push({day,vol:0,oi:lastOI,price:lastPrice,prem:0,trades:0,hasFlow:false});
      }
    });
    if (curOI>0||curPrice>0) chartData.push({day:"Now",vol:0,oi:curOI>0?curOI:lastOI,price:curPrice>0?curPrice:lastPrice,prem:0,trades:0,hasFlow:false,isLive:true});
    // Trim to last 2 weeks (10 trading days) + live
    const liveEntry = chartData.filter(d=>d.isLive);
    const nonLiveAll = chartData.filter(d=>!d.isLive);
    const trimmed = nonLiveAll.slice(-10).concat(liveEntry);
    const chartKey = `item_${sym}_${cp}_${K}_${exp}`;
    const chartRange = (window._chartRange||{})[chartKey] || "3mo";
    const setChartRange = v => { if(!window._chartRange) window._chartRange={}; window._chartRange[chartKey]=v; setSelectedItem(null); setTimeout(()=>setSelectedItem({sym,cp,K,exp}),10); };
    const dir = cp==="C"?"BULL":"BEAR";
    const totalPrem = allTrades.reduce((s,t)=>s+t.P,0);

    return modal(
      <div style={{ background:"#0d1525", border:"1px solid "+P.bl, borderRadius:12, overflow:"hidden",
        boxShadow:"0 8px 32px rgba(0,0,0,0.6)", borderTop:"2px solid "+c }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", borderBottom:"1px solid "+P.bd }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:16, fontWeight:900, color:P.wh }}>{sym}</span>
            <span style={{ fontSize:14, fontWeight:800, color:c }}>${K}{cp}</span>
            <span style={{ fontSize:13, fontWeight:700, color:P.wh }}>{exp}</span>
            <Tag c={c}>{dir}</Tag>
            {allTrades.length > 0 && <span style={{ fontSize:11, fontWeight:900, color:P.ac, background:P.ac+"18", padding:"2px 8px", borderRadius:4 }}>{fmt(totalPrem)}</span>}
            {allTrades.length > 0 && <span style={{ fontSize:10, color:P.dm }}>{allTrades.length} trades</span>}
            <span style={{ fontSize:11, fontWeight:900,
              color:curPrice>0?P.wh:P.dm,
              background:curPrice>0?(P.wh+"12"):(P.dm+"18"),
              padding:"2px 8px", borderRadius:4 }}>
              {curPrice>0 ? "$"+curPrice.toFixed(2) : fetchLoading ? "…" : "— fetch price"}
            </span>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:P.dm, fontSize:18, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0 }}>
          <div style={{ borderRight:"1px solid "+P.bd, position:"relative" }}>
            <img src={`/api/schwab/chart-proxy?sym=${encodeURIComponent(sym)}&range=${chartRange}&v=${Math.floor(Date.now()/900000)}`}
              alt={sym+" chart"} style={{ width:"100%", height:200, objectFit:"fill", display:"block", opacity:0.92 }}
              onError={e=>{e.target.parentElement.style.display="none"}} />
            <div style={{ position:"absolute", top:8, right:8, display:"flex", gap:4 }}>
              {[["1mo","1M"],["3mo","3M"],["6mo","6M"],["1y","1Y"]].map(([val,label])=>(
                <button key={val} onClick={e=>{e.stopPropagation();setChartRange(val);}}
                  style={{ padding:"2px 7px", borderRadius:4, border:"1px solid "+(chartRange===val?P.ac:P.bd+"80"),
                    background:chartRange===val?P.ac+"22":"rgba(6,9,15,0.75)", color:chartRange===val?P.ac:P.dm,
                    fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding:"12px 14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, fontSize:9, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:6 }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:8, height:8, borderRadius:2, background:"#ff6d00", display:"inline-block", flexShrink:0 }}>{""}</span> Vol</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:8, height:8, borderRadius:2, background:"#00b0ff", display:"inline-block", flexShrink:0 }}>{""}</span> OI</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:14, height:3, borderRadius:2, background:"#d4a5ff", display:"inline-block", flexShrink:0 }}>{""}</span> Contract Price</span>
            </div>
            <div style={{ width:"100%", height:160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trimmed} margin={{ top:4, right:4, left:-8, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2540" />
                  <XAxis dataKey="day" tick={{ fontSize:6, fill:"#4a5c73" }}
                    interval={trimmed.length>15?"preserveStartEnd":trimmed.length>10?1:0}
                    angle={-45} textAnchor="end" height={28}
                    tickFormatter={v=>v==="Now"?"Now":v.split("/").slice(0,2).join("/")} />
                  <YAxis yAxisId="price" orientation="left" tick={{ fontSize:7, fill:"#d4a5ff" }}
                    tickFormatter={v=>"$"+v.toFixed(1)} width={32} domain={[dm=>Math.max(0,dm*0.8),dm=>dm*1.1]} />
                  <YAxis yAxisId="voloi" orientation="right" tick={{ fontSize:7, fill:"#4a5c73" }}
                    tickFormatter={v=>fK(v)} width={38} />
                  <Tooltip contentStyle={{ background:"#0d1525", border:"1px solid #243352", borderRadius:6, fontSize:9, padding:"6px 10px" }}
                    formatter={(val,name)=>{ if(name==="price") return ["$"+val.toFixed(2),"Price"]; if(name==="vol") return [fK(val),"Volume"]; return [val.toLocaleString(),"OI"]; }}
                    labelFormatter={v=>v==="Now"?"Live":v.split("/").slice(0,2).join("/")} />
                  <Bar yAxisId="voloi" dataKey="vol" fill="#ff6d00" opacity={0.8} radius={[1,1,0,0]} barSize={trimmed.length>15?4:6} />
                  <Bar yAxisId="voloi" dataKey="oi" fill="#00b0ff" opacity={0.7} radius={[1,1,0,0]} barSize={trimmed.length>15?4:6} />
                  <Line yAxisId="price" dataKey="price" type="monotone" stroke="#d4a5ff" strokeWidth={2} strokeOpacity={0.5}
                    dot={{ r:4, fill:"#d4a5ff", stroke:"#0d1525", strokeWidth:1.5 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        {(()=>{
          const nonLive=chartData.filter(d=>!d.isLive);
          const lastOI2=nonLive.length>0?nonLive[nonLive.length-1].oi:0;
          const liveD=curOI>0&&lastOI2>0?curOI-lastOI2:0;
          const csvD=nonLive.length>1&&nonLive[0].oi>0&&lastOI2>0?lastOI2-nonLive[0].oi:0;
          const delta=liveD||csvD;
          if (!delta) return null;
          const label=delta>0?"ADDING":"EXITING"; const col=delta>0?P.bu:P.be;
          return (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12,
              padding:"8px 16px", borderTop:"1px solid "+P.bd, background:col+"08" }}>
              <span style={{ fontSize:11, fontWeight:900, color:col }}>{label}</span>
              <span style={{ fontSize:13, fontWeight:800, color:col }}>{delta>0?"+":""}{Math.abs(delta).toLocaleString()} OI</span>
              <span style={{ fontSize:8, color:P.dm }}>{curOI>0?"live data":"csv data"}</span>
            </div>
          );
        })()}
        {/* ── Strike Flow Detail ─────────────────────────────── */}
        {(()=>{
          const strikeTrades = D ? (D.clean_confirmed||[]).filter(tr => tr.S===sym && tr.CP===cp && Math.abs(tr.K-K)<0.01 && tr.E===exp).sort((a,b)=>{
            const da = a.Dt||"", db = b.Dt||"";
            if (da!==db) { const [am,ad]=(da||"0/0").split("/").map(Number); const [bm,bd]=(db||"0/0").split("/").map(Number); return bm!==am?bm-am:bd-ad; }
            return (b.time||"").localeCompare(a.time||"");
          }) : [];
          if (strikeTrades.length===0) return null;
          const tk = D ? D.TICKER_DB.find(t=>t.s===sym) : null;
          const clusterInfo = tk ? tk.c.find(c => c.CP===cp && Math.abs(c.K-K)<0.01 && c.E===exp) : null;
          return (
            <div style={{ borderTop:"1px solid "+P.bd, padding:"10px 16px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ fontSize:9, fontWeight:700, color:P.mt, letterSpacing:1.5, textTransform:"uppercase" }}>
                  Flow for {sym} ${K}{cp} {exp}
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  {clusterInfo && <Tag c={GRADE_COLORS[clusterInfo.grade]||P.mt}>{clusterInfo.grade}</Tag>}
                  {clusterInfo && clusterInfo.clean && <span style={{ fontSize:7, color:P.bu, fontWeight:700 }}>CLEAN</span>}
                  {clusterInfo && !clusterInfo.clean && <span style={{ fontSize:7, color:P.be, fontWeight:700 }}>MIXED</span>}
                  <span style={{ fontSize:9, color:P.dm }}>{strikeTrades.length} trade{strikeTrades.length>1?"s":""}</span>
                </div>
              </div>
              <div style={{ maxHeight:180, overflowY:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
                  <thead><tr style={{ borderBottom:"1px solid "+P.bd, position:"sticky", top:0, background:"#0d1525" }}>
                    {["Day","Time","Type","Side","Color","Vol","OI","Premium","Price"].map(h=>(
                      <th key={h} style={{ padding:"3px 6px", textAlign:h==="Premium"||h==="Price"||h==="Vol"||h==="OI"?"right":"left", color:P.mt, fontSize:8, fontWeight:600 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {strikeTrades.map((tr,i)=>(
                      <tr key={i} style={{ borderBottom:"1px solid "+P.bd+"10",
                        background:(tr.Si==="AA"||tr.Si==="BB")?(P.ac+"06"):"transparent" }}>
                        <td style={{ padding:"3px 6px", color:P.dm, fontSize:8 }}>{tr.Dt||"—"}</td>
                        <td style={{ padding:"3px 6px", color:P.dm, fontSize:8 }}>{tr.time||"—"}</td>
                        <td style={{ padding:"3px 6px" }}><Tag c={tc(tr.Ty)}>{tr.Ty}</Tag></td>
                        <td style={{ padding:"3px 6px" }}>{tr.Si==="AA"?<Tag c={P.ac}>AA</Tag>:tr.Si==="BB"?<Tag c={P.be}>BB</Tag>:tr.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}</td>
                        <td style={{ padding:"3px 6px" }}><Tag c={tr.Co==="YELLOW"?P.ye:tr.Co==="MAGENTA"?P.ma:P.uc}>{tr.Co}</Tag></td>
                        <td style={{ padding:"3px 6px", textAlign:"right", color:P.dm }}>{fK(tr.V)}</td>
                        <td style={{ padding:"3px 6px", textAlign:"right", color:P.dm }}>{tr.OI>0?tr.OI.toLocaleString():"—"}</td>
                        <td style={{ padding:"3px 6px", textAlign:"right", fontWeight:700, color:premC(tr.P) }}>{fmt(tr.P)}</td>
                        <td style={{ padding:"3px 6px", textAlign:"right", fontWeight:600, color:P.ac }}>{tr.price>0?"$"+tr.price.toFixed(2):"—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
        {/* ── Ticker Top Flow ────────────────────────────────── */}
        {(()=>{
          const tk = D ? D.TICKER_DB.find(t=>t.s===sym) : null;
          if (!tk) return null;
          // Other clusters for this ticker (exclude current contract)
          const otherClusters = (tk.c||[]).filter(c => !(c.CP===cp && Math.abs(c.K-K)<0.01 && c.E===exp));
          // Top trades for this ticker (exclude current contract)
          const otherTrades = (tk.t||[]).filter(t => !(t.CP===cp && Math.abs(t.K-K)<0.01 && t.E===exp)).slice(0,6);
          if (otherClusters.length===0 && otherTrades.length===0) return null;
          return (
            <div style={{ borderTop:"1px solid "+P.bd, padding:"10px 16px" }}>
              <div style={{ fontSize:9, fontWeight:700, color:P.mt, letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
                Other Flow for {sym}
              </div>
              {otherClusters.length>0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:otherTrades.length>0?10:0 }}>
                  {otherClusters.map((cl,i)=>{
                    const clC = cl.D==="BULL"?P.bu:cl.D==="BEAR"?P.be:P.dm;
                    const gc = GRADE_COLORS[cl.grade]||P.mt;
                    return (
                      <div key={i} onClick={e=>{e.stopPropagation(); fetchContractHistory(cl.S,cl.CP,cl.K,cl.E); setSelectedItem({sym:cl.S,cp:cl.CP,K:cl.K,exp:cl.E}); if(onClose) onClose();}}
                        style={{ background:P.al, border:"1px solid "+P.bd, borderRadius:6, padding:"6px 10px", cursor:"pointer",
                          borderLeft:"3px solid "+clC, minWidth:120, transition:"border-color 0.15s" }}
                        onMouseEnter={e=>e.currentTarget.style.borderColor=P.ac}
                        onMouseLeave={e=>e.currentTarget.style.borderColor=P.bd}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:2 }}>
                          <span style={{ fontSize:11, fontWeight:800, color:clC }}>${cl.K}{cl.CP}</span>
                          <Tag c={gc}>{cl.grade}</Tag>
                        </div>
                        <div style={{ fontSize:10, fontWeight:700, color:P.wh }}>{cl.E}</div>
                        <div style={{ display:"flex", gap:6, alignItems:"center", marginTop:3 }}>
                          <span style={{ fontSize:9, fontWeight:800, color:cl.H>=5?P.ac:cl.H>=3?P.ye:P.dm }}>{cl.H}x</span>
                          <span style={{ fontSize:9, fontWeight:700, color:premC(cl.P) }}>{fmt(cl.P)}</span>
                          {cl.clean && <span style={{ fontSize:7, color:P.bu, fontWeight:700 }}>CLEAN</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {otherTrades.length>0 && (
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
                  <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {["Strike","C/P","Exp","Type","Side","Color","Vol","Premium"].map(h=>(
                      <th key={h} style={{ padding:"3px 6px", textAlign:"left", color:P.mt, fontSize:8, fontWeight:600 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {otherTrades.map((tr,i)=>{
                      const trC = tr.CP==="C"?P.bu:P.be;
                      return (
                        <tr key={i} onClick={e=>{e.stopPropagation(); fetchContractHistory(tr.S,tr.CP,tr.K,tr.E); setSelectedItem({sym:tr.S,cp:tr.CP,K:tr.K,exp:tr.E}); if(onClose) onClose();}}
                          style={{ borderBottom:"1px solid "+P.bd+"10", cursor:"pointer" }}
                          onMouseEnter={e=>e.currentTarget.style.background=P.ac+"08"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <td style={{ padding:"3px 6px", fontWeight:800, color:P.wh }}>${tr.K}</td>
                          <td style={{ padding:"3px 6px" }}><Tag c={trC}>{tr.CP}</Tag></td>
                          <td style={{ padding:"3px 6px", fontWeight:700, color:P.wh }}>{tr.E}</td>
                          <td style={{ padding:"3px 6px" }}><Tag c={tc(tr.Ty)}>{tr.Ty}</Tag></td>
                          <td style={{ padding:"3px 6px" }}>{tr.Si==="AA"?<Tag c={P.ac}>AA</Tag>:tr.Si==="BB"?<Tag c={P.be}>BB</Tag>:tr.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}</td>
                          <td style={{ padding:"3px 6px" }}><Tag c={tr.Co==="YELLOW"?P.ye:tr.Co==="MAGENTA"?P.ma:P.uc}>{tr.Co}</Tag></td>
                          <td style={{ padding:"3px 6px", color:P.dm }}>{fK(tr.V)}</td>
                          <td style={{ padding:"3px 6px", fontWeight:700, color:premC(tr.P) }}>{fmt(tr.P)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // ─── Loading / Error / Empty States (AFTER all hooks) ──────────────────
  if (csvLoading) return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,border:"3px solid #1a2540",borderTop:"3px solid #00e676",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{color:"#7b8fa3",fontSize:13}}>Loading flow data...</div>
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      </div>
    </div>
  );
  if (csvError) return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{textAlign:"center",maxWidth:400}}>
        <div style={{ display:"flex", justifyContent:"center", gap:4, marginBottom:20 }}>
          {[["stocks","Stocks"],["index","Indexes / ETF's"]].map(([m,label])=>(
            <button key={m} onClick={()=>{ if(dataMode!==m) setDataMode(m); }} style={{
              padding:"8px 28px", borderRadius:5, border:"none", cursor:"pointer",
              fontSize:14, fontWeight:800, fontFamily:"inherit",
              background:dataMode===m?"#1a2540":"transparent", color:dataMode===m?"#f0f4f8":"#4a5c73"
            }}>{label}</button>
          ))}
        </div>
        <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
        <div style={{color:"#ff1744",fontSize:14,fontWeight:700,marginBottom:8}}>Failed to load {dataMode==="index"?"index":"flow"} data</div>
        <div style={{color:"#7b8fa3",fontSize:12,marginBottom:16}}>{csvError}</div>
        <div style={{color:"#4a5c73",fontSize:11}}>Make sure <code style={{color:"#ffab00"}}>{dataMode==="index"?"Indexes-data.csv":"flow-data.csv"}</code> is in <code style={{color:"#ffab00"}}>app/public/</code> and redeploy.</div>
        <button onClick={()=>window.location.reload()} style={{marginTop:16,background:"#1a2540",color:"#c8d6e5",border:"1px solid #243352",borderRadius:6,padding:"8px 20px",fontSize:12,cursor:"pointer"}}>Retry</button>
      </div>
    </div>
  );
  if (!D || !FD) return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,border:"3px solid #1a2540",borderTop:"3px solid #00e676",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{color:"#7b8fa3",fontSize:13}}>Processing flow data...</div>
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      </div>
    </div>
  );

  const shortDir = FD.shortBullTotal >= FD.shortBearTotal ? "BULL" : "BEAR";
  const longDir = FD.longBullTotal >= FD.longBearTotal ? "BULL" : "BEAR";
  const shortC = shortDir==="BULL" ? P.bu : P.be;
  const longC = longDir==="BULL" ? P.bu : P.be;

  // ─── Tab switch with auto-fetch ──────────────────────────────────────
  function handleTabSwitch(newTab) {
    setTab(newTab);
    if (!FD) return;
    // Auto-fetch prices for the tab's contracts if not already fetched
    const tabContracts = [];
    if (newTab === "Performance") {
      perf.forEach(p => tabContracts.push({ sym:p.sym, cp:p.cp, strike:p.strike, exp:p.exp }));
    } else if (newTab === "Short Term") {
      [FD.SBL, FD.SBR].forEach(list => { if(list) list.forEach(t => tabContracts.push({ sym:t.S, cp:t.CP, strike:t.K, exp:t.E })); });
    } else if (newTab === "Long Term") {
      [FD.LBL, FD.LBR_T].forEach(list => { if(list) list.forEach(t => tabContracts.push({ sym:t.S, cp:t.CP, strike:t.K, exp:t.E })); });
    } else if (newTab === "LEAPS") {
      [FD.LEAPS_BL_T, FD.LEAPS_BR_T].forEach(list => { if(list) list.forEach(t => tabContracts.push({ sym:t.S, cp:t.CP, strike:t.K, exp:t.E })); });
    } else if (newTab === "Tracker") {
      topFlowPicks.active.forEach(p => tabContracts.push({ sym:p.sym, cp:p.cp, strike:p.strike, exp:p.exp }));
    } else if (newTab === "OI Check") {
      (FD.WATCH||[]).slice(0,20).forEach(w => tabContracts.push({ sym:w.S, cp:w.CP, strike:w.K, exp:w.E }));
    }
    if (tabContracts.length > 0) {
      setTimeout(() => fetchPrices(tabContracts), 200);
    }
  }

  async function fetchPrices(contracts) {
    const items = contracts || perf;
    if (!items || items.length === 0) { setStatus("No contracts to fetch."); return; }
    setFetchLoading(true);
    setStatus("Fetching live prices…");
    const newCache = { ...priceCache };
    const updated = contracts ? null : [...perf];
    // Deduplicate
    const seen = new Set();
    const unique = [];
    items.forEach(c => {
      const sym = c.sym||c.S, cp = c.cp||c.CP, strike = parseFloat(c.strike||c.K), exp = c.exp||c.E;
      const key = sym+"|"+cp+"|"+strike+"|"+exp;
      if (sym && exp && !seen.has(key)) { seen.add(key); unique.push({ symbol:sym, cp, strike, expDate:expToISO(exp), _exp:exp }); }
    });
    setStatus(`Fetching ${unique.length} contracts across ${new Set(unique.map(c=>c.symbol)).size} tickers…`);
    try {
      // Try UW first
      let resp = await fetch("/api/uw/options-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unique.map(c => ({ symbol:c.symbol, strike:c.strike, expDate:c.expDate, cp:c.cp }))),
      });
      // Fallback to Schwab if UW fails
      if (!resp.ok) {
        resp = await fetch("/api/schwab/options-quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(unique.map(c => ({ symbol:c.symbol, strike:c.strike, expDate:c.expDate, cp:c.cp }))),
        });
      }
      if (!resp.ok) { setStatus("API error: " + resp.status); setFetchLoading(false); return; }
      const data = await resp.json();
      const quotes = data.quotes || [];
      let successes = 0, failures = 0, expired = 0;
      quotes.forEach((q, i) => {
        const orig = unique[i];
        if (!orig) return;
        if (q.expired) { expired++; return; }
        if (q.error) { failures++; return; }
        const key = orig.symbol+"|"+orig.cp+"|"+orig.strike+"|"+orig._exp;
        newCache[key] = {
          mark: q.mark||0, bid: q.bid||0, ask: q.ask||0, last: q.last||0,
          delta: q.delta||0, theta: q.theta||0, iv: q.iv||0,
          oi: q.openInterest||0, vol: q.volume||0, spot: q.underlyingPrice||0,
        };
        if (updated) {
          const match = updated.find(u => u.sym===orig.symbol && u.cp===orig.cp && parseFloat(u.strike)===orig.strike && u.exp===orig._exp);
          if (match) match.now = q.mark || q.last || 0;
        }
        successes++;
      });
      setPriceCache(newCache);
      if (updated) setPerf(updated);
      pricesFetchedRef.current = true;
      setStatus(`${successes} priced` + (expired > 0 ? `, ${expired} expired` : ``) + (failures > 0 ? `, ${failures} failed` : ``));
    } catch(e) {
      setStatus("Fetch error: " + e.message);
    }
    setFetchLoading(false);
  }
  function collectContracts(...tradeLists) {
    const all = [];
    tradeLists.forEach(list => {
      if (!list) return;
      list.forEach(t => {
        all.push({ sym:t.S||t.sym, cp:t.CP||t.cp, strike:t.K||t.strike, exp:t.E||t.exp });
      });
    });
    return all;
  }
  function getPrice(sym, cp, strike, exp) {
    const k = sym+"|"+cp+"|"+parseFloat(strike)+"|"+exp;
    return priceCache[k] || null;
  }

  // ─── Fetch Polygon backfill + tracker history on hover ───────────────
  async function fetchContractHistory(sym, cp, strike, exp, force = false) {
    const k = `${sym}|${cp}|${parseFloat(strike)}|${exp}`;

    // 1. Fetch history from Unusual Whales API (replaces Schwab backfill + history)
    if ((contractHistory[k] == null || force) && !fetchingRef.current.has(k)) {
      fetchingRef.current.add(k);
      try {
        const params = new URLSearchParams({ sym, cp, strike: String(parseFloat(strike)), exp });
        const resp = await fetch(`/api/uw/contract-history?${params}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setContractHistory(prev => ({ ...prev, [k]: data.history || [] }));
      } catch (e) {
        // Fallback to Schwab if UW fails
        try {
          await fetch(`/api/schwab/backfill-contract?sym=${encodeURIComponent(sym)}&cp=${encodeURIComponent(cp)}&strike=${parseFloat(strike)}&exp=${encodeURIComponent(exp)}`).catch(() => {});
          const params = new URLSearchParams({ sym, cp, strike: String(parseFloat(strike)), exp });
          const resp = await fetch(`/api/schwab/contract-history?${params}`);
          if (resp.ok) {
            const data = await resp.json();
            setContractHistory(prev => ({ ...prev, [k]: data.history || [] }));
          } else {
            setContractHistory(prev => ({ ...prev, [k]: [] }));
          }
        } catch(e2) {
          setContractHistory(prev => ({ ...prev, [k]: [] }));
        }
      } finally {
        fetchingRef.current.delete(k);
      }
    }

    // 2. Auto-fetch live quote if not already cached (try UW first, fallback Schwab)
    const priceCacheKey = `${sym}|${cp}|${parseFloat(strike)}|${exp}`;
    if (!priceCache[priceCacheKey]) {
      try {
        const resp = await fetch("/api/uw/options-quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ symbol: sym, cp, strike: parseFloat(strike), expDate: expToISO(exp) }]),
        });
        if (resp.ok) {
          const data = await resp.json();
          const q = data.quotes?.[0];
          if (q && !q.error) {
            setPriceCache(prev => ({
              ...prev,
              [priceCacheKey]: {
                mark: q.mark||0, bid: q.bid||0, ask: q.ask||0, last: q.last||0,
                delta: q.delta||0, theta: q.theta||0, iv: q.iv||0,
                oi: q.openInterest||0, vol: q.volume||0, spot: q.underlyingPrice||0,
              },
            }));
            return;
          }
        }
      } catch(e) {}
      // Fallback to Schwab for live quotes
      try {
        const resp = await fetch("/api/schwab/options-quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ symbol: sym, cp, strike: parseFloat(strike), expDate: expToISO(exp) }]),
        });
        if (resp.ok) {
          const data = await resp.json();
          const q = data.quotes?.[0];
          if (q && !q.error && !q.expired) {
            setPriceCache(prev => ({
              ...prev,
              [priceCacheKey]: {
                mark: q.mark||0, bid: q.bid||0, ask: q.ask||0, last: q.last||0,
                delta: q.delta||0, theta: q.theta||0, iv: q.iv||0,
                oi: q.openInterest||0, vol: q.volume||0, spot: q.underlyingPrice||0,
              },
            }));
          }
        }
      } catch(e) {}
    }
  }

  async function fetchMarketData() {
    // Fetch index quotes
    try {
      const resp = await fetch("/api/schwab/market-summary");
      if (resp.ok) {
        const data = await resp.json();
        setMarketIndices(data.indices || []);
      }
    } catch(e) { console.warn("Market indices error:", e); }
    // Fetch AI narrative
    setNarrativeLoading(true);
    try {
      const resp = await fetch("/api/schwab/market-narrative");
      if (resp.ok) {
        const data = await resp.json();
        setMarketNarrative(data.narrative || null);
      }
    } catch(e) { console.warn("Narrative error:", e); }
    setNarrativeLoading(false);
  }


  return (
    <div style={{ background:P.bg, color:P.tx, fontFamily:"'SF Mono','Fira Code',monospace", minHeight:"100vh", padding:"16px 20px", zoom:1.18 }}>
      <div style={{ maxWidth:1280, margin:"0 auto" }}>

        {/* Data Mode Toggle */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}>
          <div style={{ display:"flex", background:P.al, borderRadius:8, padding:3, border:"1px solid "+P.bd }}>
            {[["stocks","Stocks"],["index","Indexes / ETF's"]].map(([m,label])=>(
              <button key={m} onClick={()=>{ if(dataMode!==m) setDataMode(m); }} style={{
                padding:"8px 28px", borderRadius:6, border:"none", cursor:"pointer",
                fontSize:14, fontWeight:800, fontFamily:"inherit", letterSpacing:0.5,
                background:dataMode===m?P.cd:"transparent", color:dataMode===m?P.wh:P.mt,
                boxShadow:dataMode===m?("0 2px 8px rgba(0,0,0,0.3)"):"none",
                transition:"all 0.15s"
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:P.ac, boxShadow:"0 0 10px "+P.ac }} />
          <h1 style={{ fontSize:18, fontWeight:800, margin:0, color:P.wh }}>{dataMode==="index"?"INDEX FLOW":"OPTIONS FLOW"} — MARKET READ</h1>
          <span style={{ marginLeft:"auto", fontSize:10, color:P.mt, background:P.al, padding:"3px 10px", borderRadius:4 }}>
            {D.dateRange} · {D.confirmedCount} confirmed of {D.totalTrades} trades
          </span>
        </div>

        {/* ── Market Pulse ─────────────────────────────────────────────── */}
        {tab==="Market Read" && (
          <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:"16px 20px", marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:P.uc, letterSpacing:1.5, textTransform:"uppercase" }}>Market Pulse</div>
              {marketIndices && (
                <button onClick={fetchMarketData} title="Refresh" style={{ padding:"4px 10px", borderRadius:4, border:"1px solid "+P.bl, background:"transparent", color:P.dm, fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>↻ Refresh</button>
              )}
            </div>
            {/* Index Cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:8, marginBottom:marketNarrative||narrativeLoading?12:0 }}>
              {marketIndices ? marketIndices.map((idx,i) => {
                const isVix = idx.name.includes("VIX");
                const up = isVix ? idx.pct < 0 : idx.pct >= 0;
                const c = up ? P.bu : P.be;
                return (
                  <div key={i} style={{ background:P.al, borderRadius:6, padding:"10px 12px", borderLeft:"3px solid "+c }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                      <span style={{ fontSize:9, color:P.dm, fontWeight:600 }}>{idx.name}</span>
                      <span style={{ fontSize:9, fontWeight:700, color:c, background:c+"15", padding:"1px 5px", borderRadius:3 }}>
                        {idx.pct>0?"+":""}{idx.pct}%
                      </span>
                    </div>
                    <div style={{ fontSize:16, fontWeight:900, color:P.wh, lineHeight:1 }}>{idx.price>0?idx.price.toLocaleString(undefined,{minimumFractionDigits:2}):"—"}</div>
                    <div style={{ fontSize:10, fontWeight:600, color:c, marginTop:3 }}>
                      {idx.change>0?"+":""}{idx.change}
                    </div>
                  </div>
                );
              }) : (
                <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"12px 0" }}>
                  <div style={{ fontSize:10, color:P.dm, marginBottom:6 }}>Market data loads automatically</div>
                  <button onClick={fetchMarketData} style={{ padding:"6px 16px", borderRadius:4, border:"1px solid "+P.bl, background:P.al, color:P.ac, fontSize:10, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                    Load Now
                  </button>
                </div>
              )}
            </div>
            {/* AI Narrative */}
            {narrativeLoading && (
              <div style={{ fontSize:10, color:P.dm, padding:"8px 0 0" }}>
                <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:P.ac, marginRight:6, animation:"pulse 1.5s infinite" }}/>
                Generating market summary…
                <style>{"@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}"}</style>
              </div>
            )}
            {marketNarrative && !narrativeLoading && (
              <div style={{ borderTop:"1px solid "+P.bd, paddingTop:10 }}>
                <div style={{ fontSize:11, color:P.tx, lineHeight:1.8 }}>{marketNarrative}</div>
              </div>
            )}
          </div>
        )}

        {/* Short/Long Banners */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
          {(() => {
            const shortTop3 = (shortDir==="BULL" ? FD.SBLC : FD.SBRC).slice(0,3);
            return (
              <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:20, borderLeft:"4px solid "+shortC, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:11, color:shortC, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Short-Term Outlook</div>
                  <div style={{ fontSize:36, fontWeight:900, color:shortC, marginBottom:4 }}>{shortDir}</div>
                  <div style={{ fontSize:11, color:P.dm }}>0–59 DTE: Bull {fmt(FD.shortBullTotal)} vs Bear {fmt(FD.shortBearTotal)}</div>
                </div>
                {shortTop3.length > 0 && (
                  <div style={{ textAlign:"right", minWidth:120 }}>
                    {shortTop3.map((c,i) => (
                      <div key={i} style={{ fontSize:11, color:i===0?P.wh:P.dm, fontWeight:i===0?700:400, lineHeight:1.8 }}>
                        <span style={{ color:shortC, fontWeight:700 }}>{c.S}</span>{" "}
                        <span style={{ color:P.dm }}>${c.K}{c.CP} {c.E}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {(() => {
            const longTop3 = (longDir==="BULL" ? FD.LBLC : FD.LBRC).slice(0,3);
            return (
              <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:20, borderLeft:"4px solid "+longC, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:11, color:longC, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Long-Term Outlook</div>
                  <div style={{ fontSize:36, fontWeight:900, color:longC, marginBottom:4 }}>{longDir}</div>
                  <div style={{ fontSize:11, color:P.dm }}>60+ DTE: Bull {fmt(FD.longBullTotal)} vs Bear {fmt(FD.longBearTotal)}</div>
                </div>
                {longTop3.length > 0 && (
                  <div style={{ textAlign:"right", minWidth:120 }}>
                    {longTop3.map((c,i) => (
                      <div key={i} style={{ fontSize:11, color:i===0?P.wh:P.dm, fontWeight:i===0?700:400, lineHeight:1.8 }}>
                        <span style={{ color:longC, fontWeight:700 }}>{c.S}</span>{" "}
                        <span style={{ color:P.dm }}>${c.K}{c.CP} {c.E}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Conviction Strikes */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:10, fontWeight:700, color:P.dm, letterSpacing:1.5, textTransform:"uppercase" }}>Top Flow</div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {fetchLoading && <span style={{ fontSize:9, color:P.ac, fontWeight:600 }}>● Fetching…</span>}
            {!fetchLoading && status && <span style={{ fontSize:9, color:P.dm }}>{status}</span>}
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:8, marginBottom:12 }}>
          {FD.CONV.map((t, i) => {
            const c = t.dir==="BULL" ? P.bu : P.be;
            const hk = "conv_"+i;
            return (
              <div key={i} style={{ position:"relative" }}
                onClick={()=>{ const next = selectedConv===i ? null : i; setSelectedConv(next); if(next!==null) fetchContractHistory(t.sym, t.cp, t.K, t.exp); }}>
                <div style={{ background:P.cd, border:"1px solid "+(selectedConv===i?P.ac:P.bd), borderRadius:8, padding:"10px 12px", borderTop:"2px solid "+c, cursor:"pointer", transition:"border-color 0.15s" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <span style={{ fontSize:14, fontWeight:900, color:P.wh }}>{t.sym}</span>
                    <Tag c={GRADE_COLORS[t.grade]||P.mt}>{t.grade}</Tag>
                  </div>
                  <div style={{ fontSize:13, fontWeight:800, color:c }}>{t.strike} <span style={{ fontSize:11, fontWeight:700, color:P.wh }}>{t.exp}</span></div>
                  <div style={{ fontSize:10, color:P.dm, marginTop:4 }}>
                    <span style={{ color:P.ac, fontWeight:700 }}>{t.hits}x</span> · {fmt(t.prem)} ·{" "}
                    {t.side==="AA"?<Tag c={P.ac}>AA</Tag>:t.side==="BB"?<Tag c={P.be}>BB</Tag>:<Tag c={P.mt}>ASK</Tag>}
                  </div>
                  <div style={{ marginTop:4 }}><Tag c={c}>{t.dir}</Tag></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Selected Top Flow Detail Panel ─────────────────────────── */}
        {selectedConv !== null && FD.CONV[selectedConv] && (() => {
          const t = FD.CONV[selectedConv];
          const c = t.dir==="BULL" ? P.bu : P.be;
          const px = getPrice(t.sym, t.cp, t.K, t.exp);
          const curOI = px ? px.oi : 0;
          const curPrice = px ? (px.mark || px.last || 0) : 0;

          // Build byDay from trades
          const byDay = {};
          t.trades.forEach(tr => {
            const day = tr.Dt ? tr.Dt+"/2026" : "—";
            if (!byDay[day]) byDay[day] = { trades:[], vol:0, maxOI:0, prem:0, prices:[] };
            byDay[day].trades.push(tr);
            byDay[day].vol += tr.V;
            byDay[day].prem += tr.P;
            if (tr.OI > byDay[day].maxOI) byDay[day].maxOI = tr.OI;
            const ep = tr.V > 0 ? tr.P / tr.V / 100 : 0;
            if (ep > 0) byDay[day].prices.push(ep);
          });
          const _toDate = s => { const p=s.split('/').map(Number); const y=p.length>=3?p[2]:2026; return new Date(y,p[0]-1,p[1]); };
          const _mdSort = (a,b) => _toDate(a)-_toDate(b);
          const flowDays = Object.keys(byDay).sort(_mdSort);
          const histKey = `${t.sym}|${t.cp}|${parseFloat(t.K)}|${t.exp}`;
          const trackerHistory = contractHistory[histKey] || [];
          const trackerByDay = {};
          trackerHistory.forEach(h => {
            const parts = h.date.split("/");
            const key = parts.length >= 3 ? h.date : parts.length >= 2 ? h.date+"/2026" : h.date;
            const dt = new Date(parseInt(parts.length>=3?parts[2]:2026), parseInt(parts[0])-1, parseInt(parts[1]));
            trackerByDay[key] = dt.getDay()===0||dt.getDay()===6 ? {...h,volume:0} : h;
          });
          const allDays = [];
          if (flowDays.length > 0) {
            const first = _toDate(flowDays[0]);
            const today = new Date();
            if (first) {
              const d = new Date(first);
              while (d <= today) {
                if (d.getDay()!==0 && d.getDay()!==6) allDays.push((d.getMonth()+1)+"/"+d.getDate()+"/"+(d.getFullYear()));
                d.setDate(d.getDate()+1);
              }
            }
          }
          const allKnownDays = new Set([...(allDays.length>0?allDays:flowDays), ...Object.keys(trackerByDay)]);
          const days = [...allKnownDays].filter(s => {
            const p=s.split("/").map(Number); const y=p.length>=3?p[2]:2026;
            const dow=new Date(y,p[0]-1,p[1]).getDay(); return dow!==0&&dow!==6;
          }).sort(_mdSort);
          const chartData = [];
          let lastOI=0, lastPrice=0;
          days.forEach(day => {
            const fd=byDay[day], snap=trackerByDay[day];
            if (fd) {
              if (fd.maxOI>0) lastOI=fd.maxOI;
              if (snap&&snap.oi>0) lastOI=snap.oi;
              const dp=fd.prices.length>0?fd.prices.reduce((a,b)=>a+b,0)/fd.prices.length:0;
              if (dp>0) lastPrice=dp;
              if (snap&&snap.price>0) lastPrice=snap.price;
              const vol=snap?(snap.volume||fd.vol):fd.vol;
              chartData.push({day,vol,oi:lastOI,price:lastPrice,prem:fd.prem,trades:fd.trades.length,hasFlow:true});
            } else if (snap) {
              if (snap.oi>0) lastOI=snap.oi;
              if (snap.price>0) lastPrice=snap.price;
              chartData.push({day,vol:snap.volume||0,oi:lastOI,price:lastPrice,prem:0,trades:0,hasFlow:false,isTracked:true});
            } else {
              chartData.push({day,vol:0,oi:lastOI,price:lastPrice,prem:0,trades:0,hasFlow:false});
            }
          });
          if (curOI>0||curPrice>0) {
            chartData.push({day:"Now",vol:0,oi:curOI>0?curOI:lastOI,price:curPrice>0?curPrice:lastPrice,prem:0,trades:0,hasFlow:false,isLive:true});
          }
          // Trim to last 2 weeks (10 trading days) + live
          const liveEntry2 = chartData.filter(d=>d.isLive);
          const nonLiveAll2 = chartData.filter(d=>!d.isLive);
          const trimmed = nonLiveAll2.slice(-10).concat(liveEntry2);
          const chartKey = `chart_${t.sym}`;
          const chartRange = (window._chartRange||{})[chartKey] || "3mo";
          const setChartRange = v => { if(!window._chartRange) window._chartRange={}; window._chartRange[chartKey]=v; setSelectedConv(null); setTimeout(()=>setSelectedConv(selectedConv),10); };

          return (
            <div ref={convPanelRef} style={{ background:"#0d1525", border:"1px solid "+P.bl, borderRadius:12, marginBottom:12, overflow:"hidden",
              boxShadow:"0 8px 32px rgba(0,0,0,0.6)", borderTop:"2px solid "+c }}>

              {/* Panel Header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", borderBottom:"1px solid "+P.bd }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:16, fontWeight:900, color:P.wh }}>{t.sym}</span>
                  <span style={{ fontSize:14, fontWeight:800, color:c }}>{t.strike}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:P.wh }}>{t.exp}</span>
                  <Tag c={GRADE_COLORS[t.grade]||P.mt}>{t.grade}</Tag>
                  <Tag c={c}>{t.dir}</Tag>
                  <span style={{ fontSize:11, fontWeight:900, color:P.ac, background:P.ac+"18", padding:"2px 8px", borderRadius:4 }}>{fmt(t.prem)}</span>
                  <span style={{ fontSize:10, color:P.dm }}>{t.trades.length} trades</span>
                  {(()=>{ const px=getPrice(t.sym,t.cp,t.K,t.exp); const cp2=px?(px.mark||px.last||0):0;
                    if(!px){ fetch("/api/uw/options-quotes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify([{symbol:t.sym,cp:t.cp,strike:parseFloat(t.K),expDate:expToISO(t.exp)}])}).then(r=>r.ok?r.json():null).then(data=>{const q=data?.quotes?.[0];if(q&&!q.error){setPriceCache(prev=>({...prev,[t.sym+"|"+t.cp+"|"+parseFloat(t.K)+"|"+t.exp]:{mark:q.mark||0,bid:q.bid||0,ask:q.ask||0,last:q.last||0,delta:q.delta||0,theta:q.theta||0,iv:q.iv||0,oi:q.openInterest||0,vol:q.volume||0,spot:q.underlyingPrice||0}}));}}).catch(()=>{});}
                    return <span style={{ fontSize:11, fontWeight:900, color:cp2>0?P.wh:P.dm, background:cp2>0?(P.wh+"12"):(P.dm+"18"), padding:"2px 8px", borderRadius:4 }}>{cp2>0?"$"+cp2.toFixed(2):fetchLoading?"…":"— fetch price"}</span>;
                  })()}
                </div>
                <button onClick={()=>setSelectedConv(null)}
                  style={{ background:"none", border:"none", color:P.dm, fontSize:18, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>×</button>
              </div>

              {/* Two column layout: chart left, OI chart right */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0 }}>

                {/* Left: Stock price chart */}
                <div style={{ borderRight:"1px solid "+P.bd, position:"relative" }}>
                  <img src={`/api/schwab/chart-proxy?sym=${encodeURIComponent(t.sym)}&range=${chartRange}&v=${Math.floor(Date.now()/900000)}`}
                    alt={t.sym+" chart"}
                    style={{ width:"100%", height:200, objectFit:"fill", display:"block", opacity:0.92 }}
                    onError={e=>{e.target.parentElement.style.display="none"}} />
                  <div style={{ position:"absolute", top:8, right:8, display:"flex", gap:4 }}>
                    {[["1mo","1M"],["3mo","3M"],["6mo","6M"],["1y","1Y"]].map(([val,label])=>(
                      <button key={val} onClick={e=>{e.stopPropagation();setChartRange(val);}}
                        style={{ padding:"2px 7px", borderRadius:4, border:"1px solid "+(chartRange===val?P.ac:P.bd+"80"),
                          background:chartRange===val?P.ac+"22":"rgba(6,9,15,0.75)", color:chartRange===val?P.ac:P.dm,
                          fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: Vol/OI/Price chart */}
                <div style={{ padding:"12px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, fontSize:9, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:6 }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:8, height:8, borderRadius:2, background:"#ff6d00", display:"inline-block", flexShrink:0 }}>{""}</span> Vol</span>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:8, height:8, borderRadius:2, background:"#00b0ff", display:"inline-block", flexShrink:0 }}>{""}</span> OI</span>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:14, height:3, borderRadius:2, background:"#d4a5ff", display:"inline-block", flexShrink:0 }}>{""}</span> Contract Price</span>
                  </div>
                  <div style={{ width:"100%", height:160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={trimmed} margin={{ top:4, right:4, left:-8, bottom:0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2540" />
                        <XAxis dataKey="day" tick={{ fontSize:6, fill:"#4a5c73" }}
                          interval={trimmed.length>15?"preserveStartEnd":trimmed.length>10?1:0}
                          angle={-45} textAnchor="end" height={28}
                          tickFormatter={v=>v==="Now"?"Now":v.split("/").slice(0,2).join("/")} />
                        <YAxis yAxisId="price" orientation="left" tick={{ fontSize:7, fill:"#d4a5ff" }}
                          tickFormatter={v=>"$"+v.toFixed(1)} width={32}
                          domain={[dm=>Math.max(0,dm*0.8),dm=>dm*1.1]} />
                        <YAxis yAxisId="voloi" orientation="right" tick={{ fontSize:7, fill:"#4a5c73" }}
                          tickFormatter={v=>fK(v)} width={38} />
                        <Tooltip contentStyle={{ background:"#0d1525", border:"1px solid #243352", borderRadius:6, fontSize:9, padding:"6px 10px" }}
                          formatter={(val,name) => {
                            if (name==="price") return ["$"+val.toFixed(2),"Contract Price"];
                            if (name==="vol") return [fK(val),"Volume"];
                            return [val.toLocaleString(),"Open Interest"];
                          }}
                          labelStyle={{ color:"#f0f4f8", fontWeight:700, marginBottom:2 }}
                          labelFormatter={v=>v==="Now"?"Live":v.split("/").slice(0,2).join("/")} />
                        <Bar yAxisId="voloi" dataKey="vol" fill="#ff6d00" opacity={0.8} radius={[1,1,0,0]} barSize={trimmed.length>15?4:6} />
                        <Bar yAxisId="voloi" dataKey="oi" fill="#00b0ff" opacity={0.7} radius={[1,1,0,0]} barSize={trimmed.length>15?4:6} />
                        <Line yAxisId="price" dataKey="price" type="monotone" stroke="#d4a5ff" strokeWidth={2} strokeOpacity={0.5}
                          dot={{ r:4, fill:"#d4a5ff", stroke:"#0d1525", strokeWidth:1.5 }} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  {curPrice>0 && <div style={{ fontSize:9, color:"#d4a5ff", fontWeight:700, marginTop:2, textAlign:"right" }}>Now: ${curPrice.toFixed(2)}</div>}
                </div>
              </div>

              {/* Verdict */}
              {(()=>{
                const nonLive=chartData.filter(d=>!d.isLive);
                const lastOI2=nonLive.length>0?nonLive[nonLive.length-1].oi:0;
                const firstOI2=nonLive.length>0?nonLive[0].oi:0;
                const liveD=curOI>0&&lastOI2>0?curOI-lastOI2:0;
                const csvD=nonLive.length>1&&firstOI2>0&&lastOI2>0?lastOI2-firstOI2:0;
                const delta=liveD||csvD;
                if (!delta) return null;
                const label=delta>0?"ADDING":"EXITING";
                const col=delta>0?P.bu:P.be;
                return (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12,
                    padding:"8px 16px", borderTop:"1px solid "+P.bd, background:col+"08" }}>
                    <span style={{ fontSize:11, fontWeight:900, color:col }}>{label}</span>
                    <span style={{ fontSize:13, fontWeight:800, color:col }}>{delta>0?"+":""}{Math.abs(delta).toLocaleString()} OI</span>
                    <span style={{ fontSize:8, color:P.dm }}>{curOI>0?"live data":"csv data"}</span>
                  </div>
                );
              })()}
              {/* ── Strike Flow Detail ─────────────────────────────── */}
              {(()=>{
                const strikeTrades = (t.trades||[]).slice().sort((a,b)=>{
                  const da = a.Dt||"", db = b.Dt||"";
                  if (da!==db) { const [am,ad]=(da||"0/0").split("/").map(Number); const [bm,bd]=(db||"0/0").split("/").map(Number); return bm!==am?bm-am:bd-ad; }
                  return (b.time||"").localeCompare(a.time||"");
                });
                if (strikeTrades.length===0) return null;
                return (
                  <div style={{ borderTop:"1px solid "+P.bd, padding:"10px 16px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div style={{ fontSize:9, fontWeight:700, color:P.mt, letterSpacing:1.5, textTransform:"uppercase" }}>
                        Flow for {t.sym} ${t.K}{t.cp} {t.exp}
                      </div>
                      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                        <Tag c={GRADE_COLORS[t.grade]||P.mt}>{t.grade}</Tag>
                        {t.dir && <span style={{ fontSize:7, color:t.dir==="BULL"?P.bu:P.be, fontWeight:700 }}>{strikeTrades.every(tr=>{const s=tr.Si; return s==="A"||s==="AA"||(s==="BB"&&tr.Ty==="SWP");})?"CLEAN":"MIXED"}</span>}
                        <span style={{ fontSize:9, color:P.dm }}>{strikeTrades.length} trade{strikeTrades.length>1?"s":""}</span>
                      </div>
                    </div>
                    <div style={{ maxHeight:180, overflowY:"auto" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
                        <thead><tr style={{ borderBottom:"1px solid "+P.bd, position:"sticky", top:0, background:"#0d1525" }}>
                          {["Day","Time","Type","Side","Color","Vol","OI","Premium","Price"].map(h=>(
                            <th key={h} style={{ padding:"3px 6px", textAlign:h==="Premium"||h==="Price"||h==="Vol"||h==="OI"?"right":"left", color:P.mt, fontSize:8, fontWeight:600 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {strikeTrades.map((tr,i)=>{
                            const trPrice = tr.price > 0 ? tr.price : (tr.V > 0 ? tr.P / tr.V / 100 : 0);
                            return (
                            <tr key={i} style={{ borderBottom:"1px solid "+P.bd+"10",
                              background:(tr.Si==="AA"||tr.Si==="BB")?(P.ac+"06"):"transparent" }}>
                              <td style={{ padding:"3px 6px", color:P.dm, fontSize:8 }}>{tr.Dt||"—"}</td>
                              <td style={{ padding:"3px 6px", color:P.dm, fontSize:8 }}>{tr.time||"—"}</td>
                              <td style={{ padding:"3px 6px" }}><Tag c={tc(tr.Ty)}>{tr.Ty}</Tag></td>
                              <td style={{ padding:"3px 6px" }}>{tr.Si==="AA"?<Tag c={P.ac}>AA</Tag>:tr.Si==="BB"?<Tag c={P.be}>BB</Tag>:tr.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}</td>
                              <td style={{ padding:"3px 6px" }}><Tag c={tr.Co==="YELLOW"?P.ye:tr.Co==="MAGENTA"?P.ma:P.uc}>{tr.Co}</Tag></td>
                              <td style={{ padding:"3px 6px", textAlign:"right", color:P.dm }}>{fK(tr.V)}</td>
                              <td style={{ padding:"3px 6px", textAlign:"right", color:P.dm }}>{tr.OI>0?tr.OI.toLocaleString():"—"}</td>
                              <td style={{ padding:"3px 6px", textAlign:"right", fontWeight:700, color:premC(tr.P) }}>{fmt(tr.P)}</td>
                              <td style={{ padding:"3px 6px", textAlign:"right", fontWeight:600, color:P.ac }}>{trPrice>0?"$"+trPrice.toFixed(2):"—"}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
              {/* ── Ticker Top Flow ────────────────────────────────── */}
              {(()=>{
                const tk = D ? D.TICKER_DB.find(x=>x.s===t.sym) : null;
                if (!tk) return null;
                const otherClusters = (tk.c||[]).filter(c => !(c.CP===t.cp && Math.abs(c.K-t.K)<0.01 && c.E===t.exp));
                const otherTrades = (tk.t||[]).filter(tr => !(tr.CP===t.cp && Math.abs(tr.K-t.K)<0.01 && tr.E===t.exp)).slice(0,6);
                if (otherClusters.length===0 && otherTrades.length===0) return null;
                return (
                  <div style={{ borderTop:"1px solid "+P.bd, padding:"10px 16px" }}>
                    <div style={{ fontSize:9, fontWeight:700, color:P.mt, letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
                      Other Flow for {t.sym}
                    </div>
                    {otherClusters.length>0 && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:otherTrades.length>0?10:0 }}>
                        {otherClusters.map((cl,ci)=>{
                          const clC = cl.D==="BULL"?P.bu:cl.D==="BEAR"?P.be:P.dm;
                          const gc = GRADE_COLORS[cl.grade]||P.mt;
                          return (
                            <div key={ci} onClick={e=>{e.stopPropagation(); fetchContractHistory(cl.S,cl.CP,cl.K,cl.E); setSelectedItem({sym:cl.S,cp:cl.CP,K:cl.K,exp:cl.E}); setSelectedConv(null);}}
                              style={{ background:P.al, border:"1px solid "+P.bd, borderRadius:6, padding:"6px 10px", cursor:"pointer",
                                borderLeft:"3px solid "+clC, minWidth:120, transition:"border-color 0.15s" }}
                              onMouseEnter={e=>e.currentTarget.style.borderColor=P.ac}
                              onMouseLeave={e=>e.currentTarget.style.borderColor=P.bd}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:2 }}>
                                <span style={{ fontSize:11, fontWeight:800, color:clC }}>${cl.K}{cl.CP}</span>
                                <Tag c={gc}>{cl.grade}</Tag>
                              </div>
                              <div style={{ fontSize:10, fontWeight:700, color:P.wh }}>{cl.E}</div>
                              <div style={{ display:"flex", gap:6, alignItems:"center", marginTop:3 }}>
                                <span style={{ fontSize:9, fontWeight:800, color:cl.H>=5?P.ac:cl.H>=3?P.ye:P.dm }}>{cl.H}x</span>
                                <span style={{ fontSize:9, fontWeight:700, color:premC(cl.P) }}>{fmt(cl.P)}</span>
                                {cl.clean && <span style={{ fontSize:7, color:P.bu, fontWeight:700 }}>CLEAN</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {otherTrades.length>0 && (
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
                        <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                          {["Strike","C/P","Exp","Type","Side","Color","Vol","Premium"].map(h=>(
                            <th key={h} style={{ padding:"3px 6px", textAlign:"left", color:P.mt, fontSize:8, fontWeight:600 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {otherTrades.map((tr,ti)=>{
                            const trC = tr.CP==="C"?P.bu:P.be;
                            return (
                              <tr key={ti} onClick={e=>{e.stopPropagation(); fetchContractHistory(tr.S,tr.CP,tr.K,tr.E); setSelectedItem({sym:tr.S,cp:tr.CP,K:tr.K,exp:tr.E}); setSelectedConv(null);}}
                                style={{ borderBottom:"1px solid "+P.bd+"10", cursor:"pointer" }}
                                onMouseEnter={e=>e.currentTarget.style.background=P.ac+"08"}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                <td style={{ padding:"3px 6px", fontWeight:800, color:P.wh }}>${tr.K}</td>
                                <td style={{ padding:"3px 6px" }}><Tag c={trC}>{tr.CP}</Tag></td>
                                <td style={{ padding:"3px 6px", fontWeight:700, color:P.wh }}>{tr.E}</td>
                                <td style={{ padding:"3px 6px" }}><Tag c={tc(tr.Ty)}>{tr.Ty}</Tag></td>
                                <td style={{ padding:"3px 6px" }}>{tr.Si==="AA"?<Tag c={P.ac}>AA</Tag>:tr.Si==="BB"?<Tag c={P.be}>BB</Tag>:tr.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}</td>
                                <td style={{ padding:"3px 6px" }}><Tag c={tr.Co==="YELLOW"?P.ye:tr.Co==="MAGENTA"?P.ma:P.uc}>{tr.Co}</Tag></td>
                                <td style={{ padding:"3px 6px", color:P.dm }}>{fK(tr.V)}</td>
                                <td style={{ padding:"3px 6px", fontWeight:700, color:premC(tr.P) }}>{fmt(tr.P)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* Cap Band Filter */}
        {(() => {
          const caps = ["All","Mega","Large","Mid","Small"];
          const capColors = { Mega:"#7c3aed", Large:"#0ea5e9", Mid:"#10b981", Small:"#f59e0b" };
          const capThresh = {
            Mega: t => t.mktcap >= 500e9,
            Large: t => t.mktcap >= 10e9 && t.mktcap < 500e9,
            Mid:   t => t.mktcap >= 2e9  && t.mktcap < 10e9,
            Small: t => t.mktcap > 0     && t.mktcap < 2e9,
          };
          const capDescriptions = {
            Mega:  "$500B+ · heaviest flow but noisy — mostly hedges & index arb",
            Large: "$10B–$500B · institutional conviction plays",
            Mid:   "$2B–$10B · directional bets, less noise",
            Small: "Under $2B · high-risk, high-conviction small name flow",
          };
          return (
            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <span style={{ fontSize:10, fontWeight:700, color:P.mt, letterSpacing:"0.08em", textTransform:"uppercase" }}>Cap Filter</span>
                {caps.map(c => {
                  const active = capFilter === c;
                  const clr = capColors[c] || P.cd;
                  const count = c === "All"
                    ? D.clean_confirmed.length
                    : D.clean_confirmed.filter(capThresh[c]).length;
                  const prem = c === "All"
                    ? D.clean_confirmed.reduce((a,t)=>a+t.P,0)
                    : D.clean_confirmed.filter(capThresh[c]).reduce((a,t)=>a+t.P,0);
                  return (
                    <button key={c} onClick={()=>setCapFilter(c)} title={capDescriptions[c]||"All cap sizes"} style={{
                      padding:"5px 12px", borderRadius:20, border:`1.5px solid ${active?clr:P.bd}`,
                      cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"inherit",
                      background:active?clr+"22":"transparent",
                      color:active?clr:P.mt, transition:"all 0.15s",
                      display:"flex", alignItems:"center", gap:6
                    }}>
                      <span>{c}</span>
                      <span style={{ fontSize:9, fontWeight:600, opacity:0.75 }}>
                        {count} · ${(prem/1e6).toFixed(0)}M
                      </span>
                    </button>
                  );
                })}
                {capFilter !== "All" && (
                  <span style={{ fontSize:10, color:P.mt, fontStyle:"italic" }}>
                    {capDescriptions[capFilter]}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Tabs */}
        <div style={{ display:"flex", gap:1, marginBottom:14, background:P.al, borderRadius:6, padding:2, width:"fit-content", flexWrap:"wrap" }}>
          {TABS.map(t => (
            <button key={t} onClick={()=>handleTabSwitch(t)} style={{
              padding:"6px 14px", borderRadius:5, border:"none", cursor:"pointer",
              fontSize:11, fontWeight:600, fontFamily:"inherit",
              background:tab===t?P.cd:"transparent", color:tab===t?P.wh:P.mt
            }}>{t}</button>
          ))}
        </div>

        {/* Market Read */}
        {tab==="Market Read" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card title="Daily Flow" sub="Bull vs Bear · confirmed flow">
              <div style={{ height:220 }}>
                <ResponsiveContainer>
                  <AreaChart data={FD.DAYS} margin={{ top:5, right:8, left:0, bottom:0 }}>
                    <defs>
                      <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={P.bu} stopOpacity={0.4}/>
                        <stop offset="100%" stopColor={P.bu} stopOpacity={0.05}/>
                      </linearGradient>
                      <linearGradient id="bearGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={P.be} stopOpacity={0.4}/>
                        <stop offset="100%" stopColor={P.be} stopOpacity={0.05}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={P.bd} vertical={false} />
                    <XAxis dataKey="d" tick={{ fill:P.tx, fontSize:10, fontWeight:600 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill:P.mt, fontSize:9 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={56} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active||!payload||!payload.length) return null;
                      const bull = payload.find(p=>p.dataKey==="b")?.value||0;
                      const bear = payload.find(p=>p.dataKey==="r")?.value||0;
                      const net = bull - bear;
                      return (
                        <div style={{ background:"#152038", border:"1px solid "+P.bl, borderRadius:6, padding:"10px 14px", fontSize:11 }}>
                          <div style={{ color:P.dm, fontWeight:600, marginBottom:6 }}>{label}</div>
                          <div style={{ display:"flex", justifyContent:"space-between", gap:20 }}>
                            <span style={{ color:P.bu }}>● Bull</span>
                            <span style={{ fontWeight:700, color:P.bu }}>{fmt(bull)}</span>
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between", gap:20 }}>
                            <span style={{ color:P.be }}>● Bear</span>
                            <span style={{ fontWeight:700, color:P.be }}>{fmt(bear)}</span>
                          </div>
                          <div style={{ borderTop:"1px solid "+P.bd, marginTop:4, paddingTop:4, display:"flex", justifyContent:"space-between", gap:20 }}>
                            <span style={{ color:P.dm }}>Net</span>
                            <span style={{ fontWeight:800, color:net>=0?P.bu:P.be }}>{net>=0?"+":""}{fmt(net)}</span>
                          </div>
                        </div>
                      );
                    }} />
                    <Area type="monotone" dataKey="b" name="Bullish" stroke={P.bu} strokeWidth={2} fill="url(#bullGrad)" dot={{ r:3, fill:P.bu, strokeWidth:0 }} activeDot={{ r:5, fill:P.bu }} />
                    <Area type="monotone" dataKey="r" name="Bearish" stroke={P.be} strokeWidth={2} fill="url(#bearGrad)" dot={{ r:3, fill:P.be, strokeWidth:0 }} activeDot={{ r:5, fill:P.be }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            {/* Sector / Ticker Breakdown */}
            {FD.SECTORS.length > 0 && (
              <Card title={FD.sectorTickerMode?(FD.sectorIsETF?"ETF Flow":"Ticker Flow"):"Sector Flow"} sub={FD.sectorTickerMode?"Confirmed premium by ticker":"Confirmed premium by sector"}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:6 }}>
                  {FD.SECTORS.map((s,i) => {
                    const total = s.bull + s.bear;
                    const bullPct = total > 0 ? s.bull / total * 100 : 50;
                    const isBull = s.bull >= s.bear;
                    const dirC = isBull ? P.bu : P.be;
                    const hk = "sec_"+i;
                            return (
                      <div key={i} style={{ position:"relative" }}
                        onClick={()=>setSelectedItem(prev=>prev&&prev._secKey===hk?null:{_secKey:hk})}>
                        <div style={{ background:P.al, borderRadius:6, padding:"8px 10px", border:"1px solid "+((selectedItem&&selectedItem._secKey===hk)?P.ac:P.bd), cursor:"pointer", transition:"border-color 0.15s",
                          borderLeft:FD.sectorTickerMode?("3px solid "+dirC):undefined }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                            <span style={{ fontSize:FD.sectorTickerMode?12:10, fontWeight:FD.sectorTickerMode?800:700, color:P.wh }}>{s.name}</span>
                            {FD.sectorTickerMode && <span style={{ width:8, height:8, borderRadius:2, background:dirC, display:"inline-block" }} title={isBull?"Bullish":"Bearish"} />}
                          </div>
                          <div style={{ fontSize:12, fontWeight:800, color:P.ac }}>{fmt(total)}</div>
                          {FD.sectorTickerMode && total > 0 && (
                            <div style={{ display:"flex", gap:8, fontSize:9, marginTop:3 }}>
                              <span style={{ color:P.bu, fontWeight:700 }}>B {fmt(s.bull)}</span>
                              <span style={{ color:P.be, fontWeight:700 }}>R {fmt(s.bear)}</span>
                            </div>
                          )}
                          <div style={{ width:"100%", height:3, background:P.be, borderRadius:2, marginTop:4 }}>
                            <div style={{ width:bullPct+"%", height:"100%", background:P.bu, borderRadius:2 }} />
                          </div>
                          <div style={{ fontSize:8, color:P.dm, marginTop:2 }}>{s.count} trades</div>
                        </div>
                        {/* Ticker mode dropdown */}
                        {FD.sectorTickerMode && selectedItem&&selectedItem._secKey===hk && (()=>{
                          const tk = D.TICKER_DB.find(t=>t.s===s.name);
                          if (!tk) return null;
                          const topTrades = (tk.t||[]).slice(0,6);
                          const clusters = (tk.c||[]).slice(0,4);
                          return (
                            <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, marginTop:4, minWidth:280, maxWidth:400,
                              background:"#152038", border:"1px solid "+P.bl, borderRadius:8, padding:"10px 12px", fontSize:10,
                              boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}
                              onClick={e=>e.stopPropagation()}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                                <span style={{ fontWeight:800, color:P.ac, fontSize:12 }}>{s.name}</span>
                                <button onClick={e=>{e.stopPropagation();setSelectedItem(null);}}
                                  style={{ background:"none", border:"none", color:P.dm, fontSize:14, cursor:"pointer", padding:"0 2px" }}>×</button>
                              </div>
                              {clusters.length>0 && (
                                <>
                                <div style={{ fontSize:8, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:4, textTransform:"uppercase" }}>Consistency (2+ hits)</div>
                                {clusters.map((cl,ci)=>{
                                  const clC = cl.D==="BULL"?P.bu:cl.D==="BEAR"?P.be:P.dm;
                                  return (
                                    <div key={ci} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:"1px solid "+P.bd+"20" }}>
                                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                        <span style={{ fontWeight:800, color:clC }}>${cl.K}{cl.CP}</span>
                                        <span style={{ color:P.wh, fontSize:9 }}>{cl.E}</span>
                                        <Tag c={GRADE_COLORS[cl.grade]||P.mt}>{cl.grade}</Tag>
                                      </div>
                                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                        <span style={{ fontWeight:800, color:cl.H>=5?P.ac:cl.H>=3?P.ye:P.dm, fontSize:9 }}>{cl.H}x</span>
                                        <span style={{ fontWeight:700, color:clC, fontSize:9 }}>{fmt(cl.P)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                                </>
                              )}
                              {topTrades.length>0 && (
                                <>
                                <div style={{ fontSize:8, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:4, marginTop:clusters.length>0?8:0, textTransform:"uppercase" }}>Top Trades</div>
                                {topTrades.map((tr,ti)=>{
                                  const trDirC = tr.D==="BULL"?P.bu:tr.D==="BEAR"?P.be:P.dm;
                                  return (
                                  <div key={ti} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"2px 0", borderBottom:"1px solid "+P.bd+"12" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                                      <span style={{ fontWeight:800, color:P.wh, fontSize:9 }}>${tr.K}{tr.CP}</span>
                                      <span style={{ color:P.dm, fontSize:8 }}>{tr.E}</span>
                                      <Tag c={tc(tr.Ty)}>{tr.Ty}</Tag>
                                      {tr.Si==="AA"?<Tag c={P.ac}>AA</Tag>:tr.Si==="BB"?<Tag c={P.be}>BB</Tag>:null}
                                    </div>
                                    <span style={{ fontWeight:700, color:trDirC, fontSize:9 }}>{fmt(tr.P)}</span>
                                  </div>
                                  );
                                })}
                                </>
                              )}
                              <div style={{ marginTop:8, textAlign:"center" }}>
                                <button onClick={e=>{e.stopPropagation(); setSearch(s.name); setSelectedTicker(tk); setTab("Search"); setSelectedItem(null);}}
                                  style={{ padding:"4px 14px", borderRadius:4, border:"1px solid "+P.bl, background:P.cd, color:P.ac, fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                  View Full {s.name} Flow →
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                        {/* Sector mode dropdown */}
                        {!FD.sectorTickerMode && selectedItem&&selectedItem._secKey===hk && s.topTickers && s.topTickers.length > 0 && (
                          <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, marginTop:4, minWidth:180,
                            background:"#152038", border:"1px solid "+P.bl, borderRadius:8, padding:"10px 12px", fontSize:10,
                            boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}>
                            <div style={{ fontWeight:700, color:P.ac, marginBottom:6 }}>{s.name} — Top Flow</div>
                            {s.topTickers.map((tk,j) => {
                              const tkBull = tk.bull >= tk.bear;
                              const sqColor = tkBull ? P.bu : P.be;
                              return (
                              <div key={j} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:j<s.topTickers.length-1?("1px solid "+P.bd+"20"):"none" }}>
                                <span style={{ fontWeight:800, color:P.wh }}>{tk.s}</span>
                                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                                  <span style={{ fontWeight:700, color:P.ac }}>{fmt(tk.p)}</span>
                                  <span style={{ width:9, height:9, borderRadius:2, background:sqColor, display:"inline-block", flexShrink:0 }} title={tkBull?"Bullish":"Bearish"} />
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Short-Term Bullish" sub="0–59 DTE"><NC data={FD.SB_SYM} fill={P.bu} dir="bull" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
              <Card title="Short-Term Bearish" sub="0–59 DTE"><NC data={FD.SR_SYM} fill={P.be} dir="bear" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
              <Card title="Long-Term Bullish" sub="60+ DTE"><NC data={FD.LB_SYM} fill={P.bu} dir="bull" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
              <Card title="Long-Term Bearish" sub="60+ DTE"><NC data={FD.LR_SYM} fill={P.be} dir="bear" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
            </div>
            {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
            {/* UOA Section */}
            {D.UOA_TRADES.length > 0 && (
              <Card title="Unusual Options Activity" sub={D.UOA_TRADES.length+" UOA flagged"}>
                <TT rows={D.UOA_TRADES} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/>
              </Card>
            )}
          </div>
        )}

        {/* Performance */}
        {tab==="Performance" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                <div style={{ width:3, background:P.ac, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:P.ac, marginBottom:5 }}>Contract Performance Tracker</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>Entry = median contract price. Live prices auto-fetch from UW API.</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {fetchLoading && <span style={{ fontSize:10, color:P.ac, fontWeight:600 }}>● Fetching…</span>}
                  {!fetchLoading && status && <span style={{ fontSize:10, color:P.dm }}>{status}</span>}
                </div>
              </div>
            </Card>
            {["Conviction","Short Bull","Short Bear","Long Bull","Long Bear","LEAPS Bull","LEAPS Bear"].map(cat => {
              const items = perf.filter(p=>p.cat===cat);
              if (items.length===0) return null;
              const filled = items.filter(r => {
                const px = getPrice(r.sym, r.cp, r.strike, r.exp);
                return (px && px.mark > 0) || r.now > 0;
              });
              const avgPnl = filled.length>0 ? filled.reduce((s,r) => {
                const px = getPrice(r.sym, r.cp, r.strike, r.exp);
                const curr = px ? (px.mark || px.last || 0) : r.now || 0;
                return s + (curr > 0 && r.entry > 0 ? (curr-r.entry)/r.entry*100 : 0);
              },0)/filled.length : 0;
              const winners = filled.filter(r => {
                const px = getPrice(r.sym, r.cp, r.strike, r.exp);
                const curr = px ? (px.mark || px.last || 0) : r.now || 0;
                return curr > r.entry;
              }).length;
              return (
                <Card key={cat} title={cat} sub={items.length+" contracts"}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ borderBottom:"1px solid "+P.bd }}>
                        {["Ticker","Strike","C/P","Exp","Entry","Range","Now","P&L","Hits","Dir","OI","ΔOI"].map(h=>(
                          <th key={h} style={{ padding:"5px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600, cursor:h==="ΔOI"?"help":"default" }} title={h==="ΔOI"?"Change in total open interest across all market participants — not just the trades shown. ΔOI > Vol means more traders are piling in on this strike.":undefined}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => {
                        const px = getPrice(r.sym, r.cp, r.strike, r.exp);
                        const curr = px ? (px.mark || px.last || 0) : r.now || 0;
                        const pnlPct = curr>0&&r.entry>0 ? (curr-r.entry)/r.entry*100 : 0;
                        const pnlColor = pnlPct>0?P.bu:pnlPct<0?P.be:P.dm;
                        const curOI = px ? px.oi : 0;
                        return (
                          <tr key={r.id} onClick={()=>{ fetchContractHistory(r.sym,r.cp,r.strike,r.exp); setSelectedItem(prev=>prev&&prev.sym===r.sym&&prev.cp===r.cp&&String(prev.K)===String(r.strike)&&prev.exp===r.exp?null:{sym:r.sym,cp:r.cp,K:r.strike,exp:r.exp}); }} style={{ borderBottom:"1px solid "+P.bd+"10", cursor:"pointer" }}>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{r.sym}</td>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>${r.strike}</td>
                            <td style={{ padding:"5px 5px" }}><Tag c={r.cp==="C"?P.bu:P.be}>{r.cp}</Tag></td>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{r.exp}</td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:P.ac }}>{r.entry>0?"$"+r.entry.toFixed(2):"—"}</td>
                            <td style={{ padding:"5px 5px", fontSize:9, color:P.mt }}>{r.lo&&r.lo!==r.hi?"$"+r.lo.toFixed(2)+"–$"+r.hi.toFixed(2):"—"}</td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:curr>0?P.wh:P.mt }}>{curr>0?"$"+curr.toFixed(2):"—"}</td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:pnlColor }}>{curr>0?(pnlPct>=0?"+":"")+pnlPct.toFixed(1)+"%":"—"}</td>
                            <td style={{ padding:"5px 5px" }}><span style={{ fontWeight:800, color:r.hits>=10?P.ac:r.hits>=5?P.ye:P.dm }}>{r.hits}x</span></td>
                            <td style={{ padding:"5px 5px" }}><Tag c={r.dir==="BULL"?P.bu:P.be}>{r.dir}</Tag></td>
                            <td style={{ padding:"5px 5px", color:curOI>0?P.dm:P.mt }}>{curOI>0?curOI.toLocaleString():"—"}</td>
                            <td style={{ padding:"5px 5px", color:P.dm }}>{"—"}</td>
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
          {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
          </div>
        )}

        {/* Search */}
        {tab==="Search" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <input type="text" value={search}
                onChange={e=>{ const v=e.target.value.toUpperCase(); setSearch(v); setSelectedTicker(D.TICKER_DB.find(t=>t.s===v)||null); }}
                placeholder="Enter ticker symbol (e.g. TSLA, MU, AAPL)"
                style={{ width:"100%", padding:"10px 16px", borderRadius:8, fontSize:13, fontWeight:600, background:P.al, border:"1px solid "+P.bl, color:P.wh, fontFamily:"inherit", outline:"none", letterSpacing:1 }}
              />
              {search && D.ALL_SYMS.filter(s=>s.startsWith(search)&&s!==search).length>0 && !selectedTicker && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:4 }}>
                  {D.ALL_SYMS.filter(s=>s.startsWith(search)).slice(0,12).map(s=>(
                    <button key={s} onClick={()=>{ setSearch(s); setSelectedTicker(D.TICKER_DB.find(t=>t.s===s)||null); }}
                      style={{ padding:"3px 10px", borderRadius:4, border:"1px solid "+P.bl, background:P.cd, color:D.TICKER_DB.find(t=>t.s===s)?P.wh:P.mt, fontSize:10, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </Card>
            {selectedTicker && (() => {
              const tk = selectedTicker;
              const net = tk.b - tk.r;
              const total = tk.b + tk.r;
              const dir = total===0?"NEUTRAL":net>0?"BULL":"BEAR";
              const dirC = dir==="BULL"?P.bu:dir==="BEAR"?P.be:P.dm;
              return (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16, borderTop:"3px solid "+dirC }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Net Direction</div>
                      <div style={{ fontSize:28, fontWeight:900, color:dirC }}>{dir}</div>
                      <div style={{ fontSize:10, color:P.dm, marginTop:4 }}>{tk.n} trades</div>
                    </div>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bullish Flow</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.bu }}>{fmt(tk.b)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:(total>0?(tk.b/total*100):0)+"%", height:"100%", background:P.bu, borderRadius:2 }} />
                      </div>
                    </div>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bearish Flow</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.be }}>{fmt(tk.r)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:(total>0?(tk.r/total*100):0)+"%", height:"100%", background:P.be, borderRadius:2 }} />
                      </div>
                    </div>
                  </div>
                  <Card title={tk.s+" — Top 10 Trades by Premium"} sub={tk.n+" total"}><TT rows={tk.t} /></Card>
                  {tk.c.length>0 && <Card title={tk.s+" — Top Consistency (2+ hits)"}><CT rows={tk.c.slice(0,5)} /></Card>}
                </>
              );
            })()}
          </div>
        )}

        {/* Short Term */}
        {tab==="Short Term" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Bets" sub="0–59 DTE"><NC data={FD.SB_SYM} fill={P.bu} dir="bull" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
              <Card title="Bearish Bets" sub="0–59 DTE"><NC data={FD.SR_SYM} fill={P.be} dir="bear" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
            </div>
            {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
            <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
              {fetchLoading && <span style={{ fontSize:10, color:P.sw, fontWeight:600 }}>● Fetching…</span>}
              {!fetchLoading && status && <span style={{ fontSize:10, color:P.dm }}>{status}</span>}
            </div>
            <Card title="Short-Term Bullish Trades" sub={fmt(FD.shortBullTotal)}><TT rows={FD.SBL} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            <Card title="Short-Term Bearish Trades" sub={fmt(FD.shortBearTotal)}><TT rows={FD.SBR} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Consistency" sub="2+ hits"><CT rows={FD.SBLC} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
              <Card title="Bearish Consistency" sub="2+ hits"><CT rows={FD.SBRC} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            </div>
          </div>
        )}

        {/* Long Term */}
        {tab==="Long Term" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Bets" sub="60+ DTE"><NC data={FD.LB_SYM} fill={P.bu} dir="bull" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
              <Card title="Bearish Bets" sub="60+ DTE"><NC data={FD.LR_SYM} fill={P.be} dir="bear" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
              {fetchLoading && <span style={{ fontSize:10, color:P.sw, fontWeight:600 }}>● Fetching…</span>}
              {!fetchLoading && status && <span style={{ fontSize:10, color:P.dm }}>{status}</span>}
            </div>
            <Card title="Long-Term Bullish Trades" sub={fmt(FD.longBullTotal)}><TT rows={FD.LBL} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            <Card title="Long-Term Bearish Trades" sub={fmt(FD.longBearTotal)}><TT rows={FD.LBR_T} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Consistency" sub="2+ hits"><CT rows={FD.LBLC} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
              <Card title="Bearish Consistency" sub="2+ hits"><CT rows={FD.LBRC} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            </div>
          </div>
        )}

        {/* LEAPS */}
        {tab==="LEAPS" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:20, borderLeft:"4px solid "+P.bu }}>
                <div style={{ fontSize:11, color:P.bu, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>LEAPS Bull Side</div>
                <div style={{ fontSize:24, fontWeight:900, color:P.bu, marginBottom:4 }}>{fmt(FD.leapsBullTotal)}</div>
                <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>{FD.LEAPS_BLC.slice(0,2).map(c=>c.S+" $"+c.K+c.CP+" "+c.E+" hit "+c.H+"x").join(". ")}</div>
              </div>
              <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:20, borderLeft:"4px solid "+P.be }}>
                <div style={{ fontSize:11, color:P.be, fontWeight:700, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>LEAPS Bear Side</div>
                <div style={{ fontSize:24, fontWeight:900, color:P.be, marginBottom:4 }}>{fmt(FD.leapsBearTotal)}</div>
                <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>{FD.LEAPS_BRC.slice(0,2).map(c=>c.S+" $"+c.K+c.CP+" "+c.E+" hit "+c.H+"x").join(". ")}</div>
              </div>
            </div>
            {FD.LEAPS_EXPS.length>0 && (
              <Card title="LEAPS by Expiration" sub="180+ DTE">
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  {FD.LEAPS_EXPS.map((e,i)=>(
                    <div key={i} style={{ background:P.al, borderRadius:8, padding:"10px 12px", border:"1px solid "+P.bd }}>
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
              <Card title="Bullish Bets" sub="180+ DTE"><NC data={FD.LEAPS_B} fill={P.bu} dir="bull" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
              <Card title="Bearish Bets" sub="180+ DTE"><NC data={FD.LEAPS_R} fill={P.be} dir="bear" onBarClick={d=>{ const tr=d.topTrades&&d.topTrades[0]; if(tr){ fetchContractHistory(d.s,tr.CP,tr.K,tr.E); setSelectedItem(prev=>prev&&prev.sym===d.s&&prev.cp===tr.CP&&String(prev.K)===String(tr.K)&&prev.exp===tr.E?null:{sym:d.s,cp:tr.CP,K:tr.K,exp:tr.E}); } }}/></Card>
            </div>
            {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
            <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
              {fetchLoading && <span style={{ fontSize:10, color:P.sw, fontWeight:600 }}>● Fetching…</span>}
              {!fetchLoading && status && <span style={{ fontSize:10, color:P.dm }}>{status}</span>}
            </div>
            <Card title="LEAPS Bullish Trades"><TT rows={FD.LEAPS_BL_T} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            <Card title="LEAPS Bearish Trades"><TT rows={FD.LEAPS_BR_T} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bull Consistency" sub="2+ hits"><CT rows={FD.LEAPS_BLC} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
              <Card title="Bear Consistency" sub="2+ hits"><CT rows={FD.LEAPS_BRC} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }} panelFn={renderDetailPanel}/></Card>
            </div>
          </div>
        )}

                {/* OI Check */}
        {tab==="OI Check" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14 }}>
                <div style={{ width:3, background:P.uc, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:P.uc, marginBottom:5 }}>OI Check — Ranked by Vol/OI</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>All trades ranked by volume relative to open interest. Higher Vol/OI = more unusual. Fetch prices to compare next-day OI: ΔOI up = new positions, ΔOI down = exits.</div>
                </div>
              </div>
            </Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
              <input type="text" value={oiSearch}
                onChange={e=>setOiSearch(e.target.value.toUpperCase())}
                placeholder="Search ticker…"
                style={{ width:180, padding:"6px 12px", borderRadius:6, fontSize:11, fontWeight:600, background:P.al, border:"1px solid "+P.bl, color:P.wh, fontFamily:"inherit", outline:"none", letterSpacing:1 }}
              />
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {fetchLoading && <span style={{ fontSize:10, color:P.sw, fontWeight:600 }}>● Fetching…</span>}
                {!fetchLoading && status && <span style={{ fontSize:10, color:P.dm }}>{status}</span>}
              </div>
            </div>
            {(() => {
              const watchFiltered = oiSearch ? D.WATCH.filter(w=>w.S.includes(oiSearch)).sort((a,b)=>b.P-a.P).slice(0,10) : D.WATCH.slice(0,20);
              return (
            <Card title="OI Check" sub={watchFiltered.length+" contracts · sorted by Vol/OI"}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {["Ticker","Strike","C/P","Exp","Entry","Premium","Flow","Vol","OI","ΔOI","Vol/OI","DTE"].map(h=>(
                      <th key={h} style={{ padding:"5px 4px", textAlign:h==="Flow"?"center":"left", color:P.mt, fontSize:9, fontWeight:600, cursor:h==="ΔOI"?"help":"default" }} title={h==="ΔOI"?"Change in total open interest across all market participants — not just the trades shown. ΔOI > Vol means more traders are piling in on this strike.":undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {watchFiltered.map((r,i)=>{
                    const pct = r.volOI;
                    const px = getPrice(r.S, r.CP, r.K, r.E);
                    const curOI = px ? px.oi : 0;
                    const dOI = curOI > 0 && r.OI > 0 ? curOI - r.OI : 0;
                    const dOIC = dOI > 0 ? P.bu : dOI < 0 ? P.be : P.dm;
                    return (
                      <tr key={i} style={{ borderBottom:"1px solid "+P.bd+"10", background:pct>=1?(P.ac+"08"):pct>=0.5?(P.ye+"08"):"transparent" }}>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
                        <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{r.price>0?"$"+r.price.toFixed(2):"—"}</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:premC(r.P) }}>{fmt(r.P)}</td>
                        <td style={{ padding:"5px 4px" }}>
                          <span style={{ display:"flex", gap:2, alignItems:"center", justifyContent:"center" }}>
                            {r.hasSweep&&r.hasBlock?<Tag c={P.ac}>S+B</Tag>:r.hasSweep?<Tag c={P.sw}>SWP</Tag>:<Tag c={P.bk}>BLK</Tag>}
                            <span style={{ fontWeight:700, fontSize:9, color:r.trades>=3?P.ac:r.trades>=2?P.ye:P.dm }}>{r.trades}x</span>
                          </span>
                        </td>
                        <td style={{ padding:"5px 4px", color:P.dm }}>{r.V.toLocaleString()}</td>
                        <td style={{ padding:"5px 4px", color:P.dm }}>{r.OI.toLocaleString()}</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:dOIC }}>{dOI!==0?(dOI>0?"+":"")+dOI.toLocaleString():"—"}</td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:pct>=1?P.ac:pct>=0.5?P.ye:pct>=0.25?P.wh:P.dm }}>{(pct*100).toFixed(0)}%</td>
                        <td style={{ padding:"5px 4px", color:P.dm }}>{r.DTE}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
              );
            })()}
          </div>
        )}

        {/* Tracker */}
        {tab==="Tracker" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14 }}>
                <div style={{ width:3, background:P.ac, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:P.ac, marginBottom:5 }}>Top Flow Tracker</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>Tracks performance of Top Flow conviction picks over time. Picks are auto-saved when new flow data loads. Daily snapshots at 4:30 PM ET update prices. Expired contracts auto-archive.</div>
                </div>
              </div>
            </Card>
            {topFlowPicks.active.length > 0 ? (
              <Card title="Active Picks" sub={topFlowPicks.active.length+" contracts"}>
                <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:6 }}>
                  {fetchLoading && <span style={{ fontSize:10, color:P.sw, fontWeight:600 }}>● Fetching…</span>}
                  {!fetchLoading && status && <span style={{ fontSize:10, color:P.dm }}>{status}</span>}
                </div>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                  <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {["Ticker","Strike","C/P","Exp","Grade","Dir","Entry","Now","P&L","Days","Trend","Added"].map(h=>(
                      <th key={h} style={{ padding:"5px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {topFlowPicks.active.map((p,i)=>{
                      const px = getPrice(p.sym, p.cp, p.strike, p.exp);
                      const now = px ? (px.mark||px.last||0) : (p.history&&p.history.length>0 ? p.history[p.history.length-1].price : 0);
                      const pnl = now>0 && p.entry>0 ? (now-p.entry)/p.entry*100 : 0;
                      const pnlC = pnl>0?P.bu:pnl<0?P.be:P.dm;
                      const days = p.dateSaved ? Math.max(1, Math.round((Date.now()-new Date(p.dateSaved).getTime())/86400000)) : 0;
                      const hist = p.history||[];
                      const trend = hist.length>=2 ? (hist[hist.length-1].price > hist[hist.length-2].price ? "↑" : hist[hist.length-1].price < hist[hist.length-2].price ? "↓" : "→") : "—";
                      const trendC = trend==="↑"?P.bu:trend==="↓"?P.be:P.dm;
                      const dirC = p.dir==="BULL"?P.bu:p.dir==="BEAR"?P.be:P.dm;
                      return (
                        <tr key={p.id||i} onClick={()=>{ fetchContractHistory(p.sym,p.cp,p.strike,p.exp); setSelectedItem({sym:p.sym,cp:p.cp,K:p.strike,exp:p.exp}); }}
                          style={{ borderBottom:"1px solid "+P.bd+"10", cursor:"pointer" }}
                          onMouseEnter={e=>e.currentTarget.style.background=P.ac+"08"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{p.sym}</td>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>${p.strike}</td>
                          <td style={{ padding:"5px 5px" }}><Tag c={p.cp==="C"?P.bu:P.be}>{p.cp}</Tag></td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:P.wh }}>{p.exp}</td>
                          <td style={{ padding:"5px 5px" }}><Tag c={GRADE_COLORS[p.grade]||P.mt}>{p.grade}</Tag></td>
                          <td style={{ padding:"5px 5px" }}><Tag c={dirC}>{p.dir}</Tag></td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:P.ac }}>{p.entry>0?"$"+p.entry.toFixed(2):"—"}</td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>
                          <td style={{ padding:"5px 5px", color:P.dm }}>{days}d</td>
                          <td style={{ padding:"5px 5px", fontSize:14, fontWeight:800, color:trendC }}>{trend}</td>
                          <td style={{ padding:"5px 5px", color:P.dm, fontSize:9 }}>{p.dateSaved||"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            ) : (
              <Card><div style={{ textAlign:"center", padding:"20px 0", color:P.dm, fontSize:12 }}>No active picks yet. Upload flow data — Top Flow picks will be tracked automatically.</div></Card>
            )}
            {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
            {topFlowPicks.archived.length > 0 && (
              <Card title="Archived Picks" sub={topFlowPicks.archived.length+" expired"}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                  <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {["Ticker","Strike","C/P","Exp","Grade","Dir","Entry","Final","P&L","Saved"].map(h=>(
                      <th key={h} style={{ padding:"5px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {topFlowPicks.archived.slice().reverse().map((p,i)=>{
                      const pnlC = p.finalPnl>0?P.bu:p.finalPnl<0?P.be:P.dm;
                      const dirC = p.dir==="BULL"?P.bu:p.dir==="BEAR"?P.be:P.dm;
                      return (
                        <tr key={p.id||i} style={{ borderBottom:"1px solid "+P.bd+"10", opacity:0.7 }}>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{p.sym}</td>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>${p.strike}</td>
                          <td style={{ padding:"5px 5px" }}><Tag c={p.cp==="C"?P.bu:P.be}>{p.cp}</Tag></td>
                          <td style={{ padding:"5px 5px", color:P.dm }}>{p.exp}</td>
                          <td style={{ padding:"5px 5px" }}><Tag c={GRADE_COLORS[p.grade]||P.mt}>{p.grade}</Tag></td>
                          <td style={{ padding:"5px 5px" }}><Tag c={dirC}>{p.dir}</Tag></td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:P.ac }}>{p.entry>0?"$"+p.entry.toFixed(2):"—"}</td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:P.wh }}>{p.finalPrice>0?"$"+p.finalPrice.toFixed(2):"—"}</td>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:pnlC }}>{p.finalPnl?(p.finalPnl>0?"+":"")+p.finalPnl.toFixed(1)+"%":"—"}</td>
                          <td style={{ padding:"5px 5px", color:P.dm, fontSize:9 }}>{p.dateSaved||"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}

        <div style={{ marginTop:16, padding:"10px 0", borderTop:"1px solid "+P.bd, display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:9, color:P.mt }}>Options Flow Dashboard · {D.dateRange}</span>
          <span style={{ fontSize:9, color:P.mt }}>YELLOW/MAG = confirmed · WHITE = check OI · No ML/ · Grades: A+ to D</span>
        </div>
      </div>
    </div>
  );
}
