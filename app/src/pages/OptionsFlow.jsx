import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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

function TT({ rows, priceFn }) {
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:"1px solid "+P.bd }}>
          {["Ticker","Day","Side","Signal","Type","C/P","Strike","Exp","Premium","Entry",priceFn?"Now":null,priceFn?"P&L":null,"Vol","OI",priceFn?"ΔOI":null,"DTE"].filter(Boolean).map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
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
          return (
            <tr key={i} style={{ borderBottom:"1px solid "+P.bd+"10", background:(r.Si==="AA"||r.Si==="BB")?(P.ac+"08"):"transparent" }}>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
              <td style={{ padding:"5px 4px", color:P.dm, fontSize:9 }}>{r.Dt}</td>
              <td style={{ padding:"5px 4px" }}>
                {r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}
              </td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.Co==="YELLOW"?P.ye:r.Co==="MAGENTA"?P.ma:P.uc}>{r.Co}</Tag></td>
              <td style={{ padding:"5px 4px" }}><Tag c={tc(r.Ty)}>{r.Ty}</Tag></td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{fmt(r.P)}</td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>}
              <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.V)}</td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{csvOI>0?csvOI.toLocaleString():"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:dOIC }}>{dOI!==0?(dOI>0?"+":"")+dOI.toLocaleString():"—"}</td>}
              <td style={{ padding:"5px 4px", color:P.dm }}>{r.DTE}d</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CT({ rows, priceFn }) {
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:"1px solid "+P.bd }}>
          {["Ticker","C/P","Strike","Exp","Hits","Grade","Premium","Entry",priceFn?"Now":null,priceFn?"P&L":null,"OI",priceFn?"ΔOI":null,priceFn?"Δ":null,priceFn?"θ":null].filter(Boolean).map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
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
          return (
            <tr key={i} style={{ borderBottom:"1px solid "+P.bd+"10", background:r.H>=5?(P.ac+"08"):"transparent" }}>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
              <td style={{ padding:"5px 4px" }}>
                <span style={{ fontWeight:800, fontSize:13, color:r.H>=10?P.ac:r.H>=5?P.ye:P.dm }}>{r.H}x</span>
              </td>
              <td style={{ padding:"5px 4px" }}><Tag c={GRADE_COLORS[r.grade]||P.mt}>{r.grade||"—"}</Tag></td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.wh }}>{fmt(r.P)}</td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>}
              <td style={{ padding:"5px 4px", color:P.dm }}>{csvOI>0?csvOI.toLocaleString():"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:dOIC }}>{dOI!==0?(dOI>0?"+":"")+dOI.toLocaleString():"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontSize:9, color:P.dm }}>{px&&px.delta?px.delta.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontSize:9, color:px&&px.theta<0?P.be:P.dm }}>{px&&px.theta?px.theta.toFixed(2):"—"}</td>}
            </tr>
          );
        })}
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
              <div style={{ background:"#152038", border:"1px solid "+P.bl, borderRadius:6, padding:"10px 14px", fontSize:11, minWidth:220 }}>
                <div style={{ fontWeight:800, color:P.wh, marginBottom:6, fontSize:13 }}>{d.s}</div>
                <div style={{ display:"flex", justifyContent:"space-between", gap:16 }}>
                  <span style={{ color:P.bu }}>● Bull</span>
                  <span style={{ fontWeight:700, color:P.bu }}>{fmt(d.b)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", gap:16 }}>
                  <span style={{ color:P.be }}>● Bear</span>
                  <span style={{ fontWeight:700, color:P.be }}>{fmt(d.r)}</span>
                </div>
                <div style={{ borderTop:"1px solid "+P.bd, marginTop:4, paddingTop:4, display:"flex", justifyContent:"space-between", gap:16 }}>
                  <span style={{ color:P.dm }}>Net</span>
                  <span style={{ fontWeight:800, color:d.n>0?P.bu:P.be }}>{d.n>0?"+":""}{fmt(d.n)}</span>
                </div>
                {d.topTrades && d.topTrades.length > 0 && (
                  <div style={{ borderTop:"1px solid "+P.bd, marginTop:6, paddingTop:6 }}>
                    <div style={{ fontSize:9, color:P.mt, fontWeight:700, marginBottom:4, textTransform:"uppercase", letterSpacing:0.5 }}>Top Flow</div>
                    {d.topTrades.map((tr,j) => (
                      <div key={j} style={{ display:"flex", gap:4, alignItems:"center", padding:"2px 0", fontSize:10 }}>
                        <span style={{ color:tr.Ty==="SWP"?P.sw:P.bk, fontWeight:700, width:26 }}>{tr.Ty}</span>
                        <span style={{ color:tr.CP==="C"?P.bu:P.be, fontWeight:700 }}>{tr.CP}</span>
                        <span style={{ color:P.wh, fontWeight:600 }}>${tr.K}</span>
                        <span style={{ color:P.dm }}>{tr.E}</span>
                        <span style={{ marginLeft:"auto", fontWeight:700, color:P.wh }}>{fmt(tr.P)}</span>
                      </div>
                    ))}
                  </div>
                )}
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
  cc.forEach(t => {
    if (!t.Dt) return;
    if (!dayMap[t.Dt]) dayMap[t.Dt] = { d:t.Dt, b:0, r:0 };
    t.D === "BULL" ? (dayMap[t.Dt].b += t.P) : (dayMap[t.Dt].r += t.P);
  });
  const DAYS = Object.values(dayMap).sort((a,b) => {
    const [am,ad] = a.d.split("/").map(Number);
    const [bm,bd] = b.d.split("/").map(Number);
    return am!==bm ? am-bm : ad-bd;
  });
  const shortTerm = cc.filter(t => t.DTE >= 0 && t.DTE < 60);
  const longTerm  = cc.filter(t => t.DTE >= 60 && t.DTE < 180);
  const leaps     = cc.filter(t => t.DTE >= 180);
  const SB_SYM = netByTicker(shortTerm.filter(t=>t.D==="BULL"));
  const SR_SYM = netByTicker(shortTerm.filter(t=>t.D==="BEAR"));
  const LB_SYM = netByTicker(longTerm.filter(t=>t.D==="BULL"));
  const LR_SYM = netByTicker(longTerm.filter(t=>t.D==="BEAR"));
  const LEAPS_B = netByTicker(leaps.filter(t=>t.D==="BULL"));
  const LEAPS_R = netByTicker(leaps.filter(t=>t.D==="BEAR"));
  const SBL = topTradesFn(shortTerm.filter(t=>t.D==="BULL"));
  const SBR = topTradesFn(shortTerm.filter(t=>t.D==="BEAR"));
  const LBL = topTradesFn(longTerm.filter(t=>t.D==="BULL"));
  const LBR_T = topTradesFn(longTerm.filter(t=>t.D==="BEAR"));
  const LEAPS_BL_T = topTradesFn(leaps.filter(t=>t.D==="BULL"));
  const LEAPS_BR_T = topTradesFn(leaps.filter(t=>t.D==="BEAR"));
  const SBLC = consistencyTable(shortTerm.filter(t=>t.D==="BULL"));
  const SBRC = consistencyTable(shortTerm.filter(t=>t.D==="BEAR"));
  const LBLC = consistencyTable(longTerm.filter(t=>t.D==="BULL"));
  const LBRC = consistencyTable(longTerm.filter(t=>t.D==="BEAR"));
  const LEAPS_BLC = consistencyTable(leaps.filter(t=>t.D==="BULL"));
  const LEAPS_BRC = consistencyTable(leaps.filter(t=>t.D==="BEAR"));
  const leapsExpMap = {};
  leaps.forEach(t => {
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
    const trades = (consTrades[k]||[]).sort((a,b)=>b.P-a.P).slice(0,5);
    return { ...c, grade, score:(scoreMap[grade]||0)+c.hits*50+c.prem/1e5,
      side:c.hasAA?"AA":c.hasBB?"BB":"ASK", strike:"$"+c.K+c.cp, trades };
  }).filter(c => c.clean && c.DTE > 7)
  .sort((a,b)=>b.score-a.score).slice(0,6)
  .map(c => ({ sym:c.sym, strike:c.strike, exp:c.exp, hits:c.hits, prem:c.prem, side:c.side, dir:c.dir, grade:c.grade,
    trades:c.trades.map(t=>({ Ty:t.Ty, Si:t.Si, Co:t.Co, V:t.V, P:t.P, DTE:t.DTE })) }));
  const sectorMap = {};
  cc.forEach(t => {
    const sec = t.sector || "Unknown";
    if (!sectorMap[sec]) sectorMap[sec] = { name:sec, bull:0, bear:0, count:0, tickers:{} };
    sectorMap[sec].count++;
    t.D === "BULL" ? (sectorMap[sec].bull += t.P) : (sectorMap[sec].bear += t.P);
    if (!sectorMap[sec].tickers[t.S]) sectorMap[sec].tickers[t.S] = { s:t.S, p:0, bull:0, bear:0 };
    sectorMap[sec].tickers[t.S].p += t.P;
    t.D === "BULL" ? (sectorMap[sec].tickers[t.S].bull += t.P) : (sectorMap[sec].tickers[t.S].bear += t.P);
  });
  const SECTORS = Object.values(sectorMap).sort((a,b)=>(b.bull+b.bear)-(a.bull+a.bear)).slice(0,8)
    .map(s => ({ ...s, topTickers: Object.values(s.tickers).sort((a,b)=>b.p-a.p).slice(0,5) }));
  return {
    DAYS, CONV, SB_SYM, SR_SYM, LB_SYM, LR_SYM, LEAPS_B, LEAPS_R,
    SBL, SBR, LBL, LBR_T, LEAPS_BL_T, LEAPS_BR_T,
    SBLC, SBRC, LBLC, LBRC, LEAPS_BLC, LEAPS_BRC, LEAPS_EXPS, SECTORS,
    shortBullTotal:sum(shortTerm.filter(t=>t.D==="BULL")),
    shortBearTotal:sum(shortTerm.filter(t=>t.D==="BEAR")),
    longBullTotal:sum(longTerm.filter(t=>t.D==="BULL")),
    longBearTotal:sum(longTerm.filter(t=>t.D==="BEAR")),
    leapsBullTotal:sum(leaps.filter(t=>t.D==="BULL")),
    leapsBearTotal:sum(leaps.filter(t=>t.D==="BEAR")),
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
    const volume = parseInt(r.volume) || 0;
    const oi = parseInt(r.oi) || 0;
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
      time:(r.time||"").trim()
    };
  });

  // ML/ Volume Matching: when an ML/ trade has the same volume as a BLOCK/SWEEP
  // at the same ticker+strike+exp, it means the original position was closed/rolled
  // as part of a multi-leg. Remove the matching original trade too.
  const mlMatched = new Set();
  {
    const mlTrades = rawTrades.filter(t => t.isML && t.S && t.V > 0);
    const nonML = rawTrades.filter(t => !t.isML && t.Ty && t.S && t.V > 0);
    mlTrades.forEach(ml => {
      const match = nonML.find(t =>
        t.S === ml.S && t.K === ml.K && t.E === ml.E && t.CP === ml.CP && t.V === ml.V && !mlMatched.has(t)
      );
      if (match) mlMatched.add(match);
    });
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
      if (!clusterDirs[k]) clusterDirs[k] = { dirs: new Set(), askTimes:[], bbSweepTimes:[], hasBidSide:false, hasAskSide:false, hasSweep:false, dte:t.DTE };
      if (t.Si === "B" || t.Si === "BB") clusterDirs[k].hasBidSide = true;
      if (t.Si === "A" || t.Si === "AA") clusterDirs[k].hasAskSide = true;
      if (t.Ty === "SWP") clusterDirs[k].hasSweep = true;
      if (!t.D) return; // stop here for non-directional trades
      clusterDirs[k].dirs.add(t.D);
      if (t.Si === "A" || t.Si === "AA") clusterDirs[k].askTimes.push(t._idx);
      if (t.Si === "BB" && t.Ty === "SWP") clusterDirs[k].bbSweepTimes.push(t._idx);
    });

    Object.entries(clusterDirs).forEach(([k, c]) => {
      // DTE ≤ 3: dying weeklies with any bid-side = day trading/scalping noise
      if (c.dte >= 0 && c.dte <= 3 && c.hasBidSide) {
        dirtyClusterKeys.add(k);
        return;
      }
      // Block-only clusters (no sweep at this strike) = not directional
      // Blocks alone need sweep confirmation to be a real signal
      if (!c.hasSweep) {
        dirtyClusterKeys.add(k);
        return;
      }
      // Mixed sides: trades on BOTH bid-side (B/BB) AND ask-side (A/AA) = conflicting intent
      // Even if B trades have no computed direction, bid+ask on same strike = not clean
      if (c.hasBidSide && c.hasAskSide) {
        // Profit-taking exception: short DTE, asks came first then BB sweeps
        const isShortDTE = c.dte >= 0 && c.dte <= 14;
        if (isShortDTE && c.askTimes.length > 0 && c.bbSweepTimes.length > 0) {
          const minAsk = Math.min(...c.askTimes);
          const maxBBSweep = Math.max(...c.bbSweepTimes);
          if (minAsk > maxBBSweep) return; // profit-taking, not dirty
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
  filtered.forEach(t => {
    if (!tickerMap[t.S]) tickerMap[t.S] = { s:t.S, b:0, r:0, n:0, trades:[], consMap:{} };
    const tk = tickerMap[t.S];
    tk.n++; if (t.D==="BULL") tk.b+=t.P; else if (t.D==="BEAR") tk.r+=t.P;
    tk.trades.push(t);
    const ck = t.CP+"|"+t.K+"|"+t.E;
    if (!tk.consMap[ck]) tk.consMap[ck] = { S:t.S, CP:t.CP, K:t.K, E:t.E, H:0, P:0, V:0, D:t.D,
      hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true };
    tk.consMap[ck].H++; tk.consMap[ck].P+=t.P; tk.consMap[ck].V+=t.V;
    if (t.Ty==="SWP") tk.consMap[ck].hasSweep = true;
    if (t.Ty==="BLK") tk.consMap[ck].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") tk.consMap[ck].oiExceeded = true;
    if (t.D) tk.consMap[ck].dirs.add(t.D);
  });
  const TICKER_DB = Object.values(tickerMap)
    .sort((a,b)=>(b.b+b.r)-(a.b+a.r))
    .map(tk => ({
      s:tk.s, b:tk.b, r:tk.r, n:tk.n,
      t:tk.trades.sort((a,b)=>b.P-a.P).slice(0,10),
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
const TABS = ["Market Read","Performance","Search","Short Term","Long Term","LEAPS","OI Check"];

export default function OptionsFlowDashboard() {
  const [tab, setTab] = useState("Market Read");
  const [capFilter, setCapFilter] = useState("All"); // All | Mega | Large | Mid | Small
  const [perf, setPerf] = useState([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [oiSearch, setOiSearch] = useState("");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [hover, setHover] = useState(null);
  const [priceCache, setPriceCache] = useState({}); // key: "SYM|CP|STRIKE|EXP" -> { mark, bid, ask, last, delta, theta, iv }

  // ─── Dynamic CSV Loading ─────────────────────────────────────────────
  const [csvText, setCsvText] = useState(null);
  const [csvLoading, setCsvLoading] = useState(true);
  const [csvError, setCsvError] = useState(null);
  const [D, setD] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setCsvLoading(true);
    setCsvError(null);
    fetch("/flow-data.csv")
      .then(res => {
        if (!res.ok) throw new Error(`Server returned ${res.status} for /flow-data.csv`);
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) throw new Error("Got HTML instead of CSV — flow-data.csv not found. The SPA fallback returned index.html. Upload flow-data.csv to app/public/ and redeploy.");
        return res.text();
      })
      .then(text => {
        if (cancelled) return;
        const trimmed = text.trim();
        if (trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
          throw new Error("Got HTML instead of CSV — flow-data.csv not found on server.");
        }
        if (!trimmed.includes(",") || trimmed.length < 100) {
          throw new Error("File appears empty or invalid (no CSV data found).");
        }
        // Parse and process
        const rows = parseCSV(text);
        if (!rows || rows.length === 0) throw new Error("CSV parsed but contained 0 valid rows. Check file format.");
        const data = processFlowData(rows);
        if (!cancelled) { setD(data); setCsvLoading(false); }
      })
      .catch(err => { if (!cancelled) { setCsvError(err.message); setCsvLoading(false); } });
    return () => { cancelled = true; };
  }, []);


  // Cap-filtered view: recompute charts using only the selected cap band's clean_confirmed
  const FD = useMemo(() => {
    if (!D) return null;
    if (capFilter === "All") return D;
    const cc = filterByCap(D.clean_confirmed, capFilter);
    const charts = buildCharts(cc);
    return { ...D, ...charts };
  }, [D, capFilter]);

  useEffect(() => {
    if (D) setPerf(D.PERF_INIT.map(p => ({ ...p, now:0 })));
  }, [D]);

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
        <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
        <div style={{color:"#ff1744",fontSize:14,fontWeight:700,marginBottom:8}}>Failed to load flow data</div>
        <div style={{color:"#7b8fa3",fontSize:12,marginBottom:16}}>{csvError}</div>
        <div style={{color:"#4a5c73",fontSize:11}}>Make sure <code style={{color:"#ffab00"}}>flow-data.csv</code> is in <code style={{color:"#ffab00"}}>app/public/</code> and redeploy.</div>
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

  async function fetchPrices(contracts) {
    const items = contracts || perf;
    if (!items || items.length === 0) { setStatus("No contracts to fetch."); return; }
    setFetchLoading(true);
    setStatus("Fetching live prices from Schwab…");
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
      const resp = await fetch("/api/schwab/options-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unique.map(c => ({ symbol:c.symbol, strike:c.strike, expDate:c.expDate, cp:c.cp }))),
      });
      if (!resp.ok) { setStatus("Schwab API error: " + resp.status); setFetchLoading(false); return; }
      const data = await resp.json();
      const quotes = data.quotes || [];
      let successes = 0, failures = 0;
      quotes.forEach((q, i) => {
        const orig = unique[i];
        if (!orig) return;
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
      setStatus(`Done. ${successes} priced, ${failures} failed of ${unique.length} contracts.`);
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

  return (
    <div style={{ background:P.bg, color:P.tx, fontFamily:"'SF Mono','Fira Code',monospace", minHeight:"100vh", padding:"16px 20px" }}>
      <div style={{ maxWidth:1280, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:P.ac, boxShadow:"0 0 10px "+P.ac }} />
          <h1 style={{ fontSize:18, fontWeight:800, margin:0, color:P.wh }}>OPTIONS FLOW — MARKET READ</h1>
          <span style={{ marginLeft:"auto", fontSize:10, color:P.mt, background:P.al, padding:"3px 10px", borderRadius:4 }}>
            {D.dateRange} · {D.confirmedCount} confirmed of {D.totalTrades} trades
          </span>
        </div>

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
        <div style={{ fontSize:10, fontWeight:700, color:P.dm, letterSpacing:1.5, textTransform:"uppercase", marginBottom:6 }}>Top Flow</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:8, marginBottom:12 }}>
          {FD.CONV.map((t, i) => {
            const c = t.dir==="BULL" ? P.bu : P.be;
            const hk = "conv_"+i;
            const isHov = hover === hk;
            return (
              <div key={i} style={{ position:"relative" }}
                onMouseEnter={()=>setHover(hk)} onMouseLeave={()=>setHover(null)}>
                <div style={{ background:P.cd, border:"1px solid "+(isHov?P.ac:P.bd), borderRadius:8, padding:"10px 12px", borderTop:"2px solid "+c, cursor:"default", transition:"border-color 0.15s" }}>
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
                {isHov && t.trades && t.trades.length > 0 && (
                  <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, marginTop:4, minWidth:260,
                    background:"#152038", border:"1px solid "+P.bl, borderRadius:8, padding:"10px 12px", fontSize:10,
                    boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}>
                    <div style={{ fontWeight:700, color:P.ac, marginBottom:6 }}>{t.sym} {t.strike} — {t.trades.length} trades</div>
                    {t.trades.map((tr,j) => (
                      <div key={j} style={{ display:"flex", gap:6, alignItems:"center", padding:"3px 0", borderBottom:j<t.trades.length-1?("1px solid "+P.bd+"20"):"none" }}>
                        <Tag c={tr.Ty==="SWP"?P.sw:P.bk}>{tr.Ty}</Tag>
                        <Tag c={tr.Si==="AA"?P.ac:tr.Si==="BB"?P.be:tr.Si==="B"?P.sw:P.mt}>{tr.Si||"—"}</Tag>
                        <Tag c={tr.Co==="YELLOW"?P.ye:tr.Co==="MAGENTA"?P.ma:P.uc}>{tr.Co}</Tag>
                        <span style={{ color:P.dm, marginLeft:"auto" }}>{fK(tr.V)}</span>
                        <span style={{ fontWeight:700, color:P.wh }}>{fmt(tr.P)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

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
            <button key={t} onClick={()=>setTab(t)} style={{
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
            {/* Sector Breakdown */}
            {FD.SECTORS.length > 0 && (
              <Card title="Sector Flow" sub="Confirmed premium by sector">
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:6 }}>
                  {FD.SECTORS.map((s,i) => {
                    const total = s.bull + s.bear;
                    const bullPct = total > 0 ? s.bull / total * 100 : 50;
                    const hk = "sec_"+i;
                    const isHov = hover === hk;
                    return (
                      <div key={i} style={{ position:"relative" }}
                        onMouseEnter={()=>setHover(hk)} onMouseLeave={()=>setHover(null)}>
                        <div style={{ background:P.al, borderRadius:6, padding:"8px 10px", border:"1px solid "+(isHov?P.ac:P.bd), cursor:"default", transition:"border-color 0.15s" }}>
                          <div style={{ fontSize:10, fontWeight:700, color:P.wh, marginBottom:4 }}>{s.name}</div>
                          <div style={{ fontSize:12, fontWeight:800, color:P.ac }}>{fmt(total)}</div>
                          <div style={{ width:"100%", height:3, background:P.be, borderRadius:2, marginTop:4 }}>
                            <div style={{ width:bullPct+"%", height:"100%", background:P.bu, borderRadius:2 }} />
                          </div>
                          <div style={{ fontSize:8, color:P.dm, marginTop:2 }}>{s.count} trades</div>
                        </div>
                        {isHov && s.topTickers && s.topTickers.length > 0 && (
                          <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, marginTop:4, minWidth:180,
                            background:"#152038", border:"1px solid "+P.bl, borderRadius:8, padding:"10px 12px", fontSize:10,
                            boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}>
                            <div style={{ fontWeight:700, color:P.ac, marginBottom:6 }}>{s.name} — Top Flow</div>
                            {s.topTickers.map((tk,j) => {
                              const isBull = tk.bull >= tk.bear;
                              const sqColor = isBull ? P.bu : P.be;
                              return (
                              <div key={j} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:j<s.topTickers.length-1?("1px solid "+P.bd+"20"):"none" }}>
                                <span style={{ fontWeight:800, color:P.wh }}>{tk.s}</span>
                                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                                  <span style={{ fontWeight:700, color:P.ac }}>{fmt(tk.p)}</span>
                                  <span style={{ width:9, height:9, borderRadius:2, background:sqColor, display:"inline-block", flexShrink:0 }} title={isBull?"Bullish":"Bearish"} />
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
              <Card title="Short-Term Bullish" sub="0–59 DTE"><NC data={FD.SB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Short-Term Bearish" sub="0–59 DTE"><NC data={FD.SR_SYM} fill={P.be} dir="bear"/></Card>
              <Card title="Long-Term Bullish" sub="60+ DTE"><NC data={FD.LB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Long-Term Bearish" sub="60+ DTE"><NC data={FD.LR_SYM} fill={P.be} dir="bear"/></Card>
            </div>
            {/* UOA Section */}
            {D.UOA_TRADES.length > 0 && (
              <Card title="Unusual Options Activity" sub={D.UOA_TRADES.length+" UOA flagged"}>
                <TT rows={D.UOA_TRADES} />
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
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>Entry = median contract price. Live prices from Schwab API.</div>
                </div>
                <button onClick={()=>fetchPrices()} disabled={fetchLoading} style={{
                  padding:"8px 20px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                  fontSize:11, fontWeight:700, fontFamily:"inherit",
                  background:fetchLoading?P.bd:P.ac, color:fetchLoading?P.dm:P.bg, opacity:fetchLoading?0.6:1,
                }}>{fetchLoading?"Fetching…":"Refresh Prices"}</button>
              </div>
              {status && <span style={{ fontSize:9, color:P.dm }}>{status}</span>}
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
                        {["Ticker","C/P","Strike","Exp","Hits","Entry","Range","Now","P&L %","OI","ΔOI","Dir"].map(h=>(
                          <th key={h} style={{ padding:"5px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => {
                        const px = getPrice(r.sym, r.cp, r.strike, r.exp);
                        const curr = px ? (px.mark || px.last || 0) : r.now || 0;
                        const pnlPct = curr>0&&r.entry>0 ? (curr-r.entry)/r.entry*100 : 0;
                        const pnlColor = pnlPct>0?P.bu:pnlPct<0?P.be:P.dm;
                        const csvOI = r.spot > 0 ? 0 : 0; // perf items don't carry OI, use cache
                        const curOI = px ? px.oi : 0;
                        const dOI = curOI > 0 ? curOI : 0;
                        return (
                          <tr key={r.id} style={{ borderBottom:"1px solid "+P.bd+"10" }}>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{r.sym}</td>
                            <td style={{ padding:"5px 5px" }}><Tag c={r.cp==="C"?P.bu:P.be}>{r.cp}</Tag></td>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>${r.strike}</td>
                            <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{r.exp}</td>
                            <td style={{ padding:"5px 5px" }}><span style={{ fontWeight:800, color:r.hits>=10?P.ac:r.hits>=5?P.ye:P.dm }}>{r.hits}x</span></td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:P.ac }}>{r.entry>0?"$"+r.entry.toFixed(2):"—"}</td>
                            <td style={{ padding:"5px 5px", fontSize:9, color:P.mt }}>{r.lo&&r.lo!==r.hi?"$"+r.lo.toFixed(2)+"–$"+r.hi.toFixed(2):"—"}</td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:curr>0?P.wh:P.mt }}>{curr>0?"$"+curr.toFixed(2):"—"}</td>
                            <td style={{ padding:"5px 5px", fontWeight:700, color:pnlColor }}>{curr>0?(pnlPct>=0?"+":"")+pnlPct.toFixed(1)+"%":"—"}</td>
                            <td style={{ padding:"5px 5px", color:curOI>0?P.dm:P.mt }}>{curOI>0?curOI.toLocaleString():"—"}</td>
                            <td style={{ padding:"5px 5px", color:P.dm }}>{"—"}</td>
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
              <Card title="Bullish Bets" sub="0–59 DTE"><NC data={FD.SB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Bearish Bets" sub="0–59 DTE"><NC data={FD.SR_SYM} fill={P.be} dir="bear"/></Card>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
              <button onClick={()=>fetchPrices(collectContracts(FD.SBL,FD.SBR))} disabled={fetchLoading}
                style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                  fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                {fetchLoading?"Fetching…":"⚡ Fetch Live Prices"}
              </button>
              {status && <span style={{ fontSize:9, color:P.dm, marginLeft:8 }}>{status}</span>}
            </div>
            <Card title="Short-Term Bullish Trades" sub={fmt(FD.shortBullTotal)}><TT rows={FD.SBL} priceFn={getPrice}/></Card>
            <Card title="Short-Term Bearish Trades" sub={fmt(FD.shortBearTotal)}><TT rows={FD.SBR} priceFn={getPrice}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Consistency" sub="2+ hits"><CT rows={FD.SBLC} priceFn={getPrice}/></Card>
              <Card title="Bearish Consistency" sub="2+ hits"><CT rows={FD.SBRC} priceFn={getPrice}/></Card>
            </div>
          </div>
        )}

        {/* Long Term */}
        {tab==="Long Term" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Bets" sub="60+ DTE"><NC data={FD.LB_SYM} fill={P.bu} dir="bull"/></Card>
              <Card title="Bearish Bets" sub="60+ DTE"><NC data={FD.LR_SYM} fill={P.be} dir="bear"/></Card>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
              <button onClick={()=>fetchPrices(collectContracts(FD.LBL,FD.LBR_T))} disabled={fetchLoading}
                style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                  fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                {fetchLoading?"Fetching…":"⚡ Fetch Live Prices"}
              </button>
              {status && <span style={{ fontSize:9, color:P.dm, marginLeft:8 }}>{status}</span>}
            </div>
            <Card title="Long-Term Bullish Trades" sub={fmt(FD.longBullTotal)}><TT rows={FD.LBL} priceFn={getPrice}/></Card>
            <Card title="Long-Term Bearish Trades" sub={fmt(FD.longBearTotal)}><TT rows={FD.LBR_T} priceFn={getPrice}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bullish Consistency" sub="2+ hits"><CT rows={FD.LBLC} priceFn={getPrice}/></Card>
              <Card title="Bearish Consistency" sub="2+ hits"><CT rows={FD.LBRC} priceFn={getPrice}/></Card>
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
              <Card title="Bullish Bets" sub="180+ DTE"><NC data={FD.LEAPS_B} fill={P.bu} dir="bull"/></Card>
              <Card title="Bearish Bets" sub="180+ DTE"><NC data={FD.LEAPS_R} fill={P.be} dir="bear"/></Card>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
              <button onClick={()=>fetchPrices(collectContracts(FD.LEAPS_BL_T,FD.LEAPS_BR_T))} disabled={fetchLoading}
                style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                  fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                {fetchLoading?"Fetching…":"⚡ Fetch Live Prices"}
              </button>
              {status && <span style={{ fontSize:9, color:P.dm, marginLeft:8 }}>{status}</span>}
            </div>
            <Card title="LEAPS Bullish Trades"><TT rows={FD.LEAPS_BL_T} priceFn={getPrice}/></Card>
            <Card title="LEAPS Bearish Trades"><TT rows={FD.LEAPS_BR_T} priceFn={getPrice}/></Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Card title="Bull Consistency" sub="2+ hits"><CT rows={FD.LEAPS_BLC} priceFn={getPrice}/></Card>
              <Card title="Bear Consistency" sub="2+ hits"><CT rows={FD.LEAPS_BRC} priceFn={getPrice}/></Card>
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
                <button onClick={()=>{
                  const visible = oiSearch ? D.WATCH.filter(w=>w.S.includes(oiSearch)).sort((a,b)=>b.P-a.P).slice(0,10) : D.WATCH.slice(0,20);
                  fetchPrices(visible.map(w=>({sym:w.S,cp:w.CP,strike:w.K,exp:w.E})));
                }} disabled={fetchLoading}
                  style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                    fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                  {fetchLoading?"Fetching…":"⚡ Fetch Live OI"}
                </button>
                {status && <span style={{ fontSize:9, color:P.dm }}>{status}</span>}
              </div>
            </div>
            {(() => {
              const watchFiltered = oiSearch ? D.WATCH.filter(w=>w.S.includes(oiSearch)).sort((a,b)=>b.P-a.P).slice(0,10) : D.WATCH.slice(0,20);
              return (
            <Card title="OI Check" sub={watchFiltered.length+" contracts · sorted by Vol/OI"}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {["Ticker","C/P","Strike","Exp","Type","Hits","Premium","Entry","Vol","OI","ΔOI","Vol/OI","DTE"].map(h=>(
                      <th key={h} style={{ padding:"5px 4px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
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
                        <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
                        <td style={{ padding:"5px 4px" }}>
                          {r.hasSweep&&r.hasBlock?<Tag c={P.ac}>S+B</Tag>:r.hasSweep?<Tag c={P.sw}>SWP</Tag>:<Tag c={P.bk}>BLK</Tag>}
                        </td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:r.trades>=3?P.ac:r.trades>=2?P.ye:P.dm }}>{r.trades}x</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:P.wh }}>{fmt(r.P)}</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{r.price>0?"$"+r.price.toFixed(2):"—"}</td>
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

        <div style={{ marginTop:16, padding:"10px 0", borderTop:"1px solid "+P.bd, display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:9, color:P.mt }}>Options Flow Dashboard · {D.dateRange}</span>
          <span style={{ fontSize:9, color:P.mt }}>YELLOW/MAG = confirmed · WHITE = check OI · No ML/ · Grades: A+ to D</span>
        </div>
      </div>
    </div>
  );
}
