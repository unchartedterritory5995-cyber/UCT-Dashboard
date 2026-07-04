import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { BarChart, Bar, AreaChart, Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine } from "recharts";

// ── Inlined DarkPool component (artifact can't import local files) ────────────
// Stub TickerPopup — just renders children (full version lives in deployed site)
function TickerPopup({ children }) { return children; }

// Stub StockChart — admin file runs as a Claude artifact so it can't import
// the real ../components/StockChart. This iframe fallback uses TradingView's
// embed widget. Public file uses the real StockChart, so colors will differ
// slightly between the two until/unless admin is migrated to use the real one.
//
// NOTE: darkPoolBars prop is accepted but IGNORED — TradingView iframes are
// sandboxed and we can't draw custom overlays inside them. The toggle and
// fetch logic in OptionsFlow_admin still run for parity with the public file;
// the bars just never visually render here. Once admin migrates to the real
// StockChart, this stub becomes a passthrough and the overlay works.
function StockChart({ sym, tf, height, darkPoolBars }) {
  if (!sym) return null;
  const url = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(sym)}&interval=${tf||"D"}&hidesidetoolbar=0&symboledit=1&saveimage=0&toolbarbg=131722&theme=dark&style=1&timezone=America%2FNew_York&withdateranges=1&hideideas=1&locale=en`;
  return (
    <iframe key={sym+"|"+(tf||"D")} src={url}
      title={`Chart ${sym}`}
      style={{ width:"100%", height: typeof height === "number" ? height+"px" : (height||"100%"), border:"none", background:"#131722", display:"block" }}
      allow="encrypted-media"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
  );
}

// ─── Dark Pool overlay helpers ───────────────────────────────────────────────
// Mirror of public file. Same logic as DarkPool.jsx for cancellation filtering
// and zone clustering. Visually inert in admin until StockChart migrates off
// the iframe stub above, but kept here so file structure matches public.
function stripCancelledPrints(prints) {
  if (!prints || prints.length === 0) return [];
  const readNum = (...vals) => { for (const v of vals) if (v != null && v !== "") return Number(v); return 0; };
  const readStr = (...vals) => { for (const v of vals) if (v != null) return String(v); return ""; };
  const readPrice  = p => readNum(p?.price, p?.p);
  const readVolume = p => readNum(p?.volume, p?.v);
  const readMsg    = p => readStr(p?.message, p?.msg, p?.Message);
  const readDate   = p => readStr(p?.date, p?.Date).trim();
  const readTime   = p => readStr(p?.time, p?.timestamp, p?.Timestamp, p?.t).trim();
  const isCancelled = p => readMsg(p).startsWith("Cancelled");
  const parseClock = s => {
    const m = String(s).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!m) return 0;
    let h = parseInt(m[1]);
    const mins = parseInt(m[2]);
    const secs = parseInt(m[3] || "0");
    const ampm = (m[4] || "").toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 3600 + mins * 60 + secs;
  };
  const normalizeDate = d => {
    if (!d) return "";
    if (d.includes("-") && /^\d{4}-/.test(d)) return d;
    const parts = d.split("/");
    if (parts.length === 3) {
      const [m, day, y] = parts;
      return `${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    }
    return d;
  };
  const sortKey = e => e.date + ":" + String(e.clock).padStart(6, "0");
  const enriched = prints.map((p, i) => ({
    p, idx: i,
    cancel: isCancelled(p),
    price: readPrice(p), volume: readVolume(p),
    date: normalizeDate(readDate(p)),
    clock: parseClock(readTime(p)),
  }));
  const excluded = new Set();
  for (const cur of enriched) {
    if (!cur.cancel) continue;
    excluded.add(cur.idx);
    const curKey = sortKey(cur);
    let best = null, bestKey = "";
    for (const cand of enriched) {
      if (cand.idx === cur.idx || cand.cancel || excluded.has(cand.idx)) continue;
      if (cand.price !== cur.price || cand.volume !== cur.volume) continue;
      const candKey = sortKey(cand);
      if (candKey >= curKey) continue;
      if (!best || candKey > bestKey) { best = cand; bestKey = candKey; }
    }
    if (best) excluded.add(best.idx);
  }
  return prints.filter((_, i) => !excluded.has(i));
}

function clusterDarkPoolPrintsForOverlay(prints, { zonePct = 0.02 } = {}) {
  if (!prints || prints.length === 0) return [];
  const readPrice    = p => (p?.price ?? p?.p ?? 0);
  const readNotional = p => (p?.notional ?? p?.n ?? p?.premium ?? 0);
  const readVolume   = p => (p?.volume ?? p?.v ?? 0);
  const sorted = [...prints].sort((a, b) => readPrice(a) - readPrice(b));
  const zones = [];
  let current = null;
  for (const p of sorted) {
    const price = readPrice(p);
    const notional = readNotional(p);
    const volume = readVolume(p);
    if (price <= 0) continue;
    const ref = current?.price ?? price;
    const tol = ref * zonePct;
    if (current && Math.abs(price - ref) <= tol) {
      current._members.push(p);
      current.notional += notional;
      current.volume += volume;
      const wSum = current._members.reduce((s, x) => s + readPrice(x) * (readVolume(x) || 1), 0);
      const wDen = current._members.reduce((s, x) => s + (readVolume(x) || 1), 0);
      current.price = wDen > 0 ? wSum / wDen : price;
      current.priceLow = Math.min(current.priceLow, price);
      current.priceHigh = Math.max(current.priceHigh, price);
      if (p.time && (!current.time || String(p.time) > String(current.time))) current.time = p.time;
    } else {
      current = { ...p, price, notional, volume, priceLow: price, priceHigh: price, _members: [p] };
      zones.push(current);
    }
  }
  return zones.map(z => {
    if (z._members.length === 1) {
      const { _members, priceLow, priceHigh, ...single } = z;
      return single;
    }
    const { _members, ...out } = z;
    return { ...out, _isCluster: true, _clusterCount: _members.length };
  });
}

// ─── Flow Data loaded dynamically from /flow-data.csv ─────────────────────────
// API_BASE: points to production backend (admin runs as Claude artifact, not from deployed site)
const API_BASE = "https://uctintelligence.com";


// ─── Color Palette ─────────────────────────────────────────────────────────────
const P = {
  bg:"#0e0f0d", cd:"#1a1c17", al:"#22251e", bd:"#2e3127", bl:"#3a3d32",
  bu:"#3cb868", be:"#e74c3c", ac:"#c9a84c", tx:"#a8a290", dm:"#706b5e",
  mt:"#a8a290", wh:"#e0dac8", ye:"#c9a84c", ma:"#c9a84c", sw:"#6ba3be",
  bk:"#6ba3be", uc:"#706b5e"
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
  if (n >= 5e6) return "#3cb868";   // $5M+ = bright green
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
const GRADE_COLORS = { "A+":"#c9a84c", "A":"#ffab00", "B+":"#3cb868", "B":"#6ba3be", "C":"#78909c", "D":"#4a5c73" };
function detectPatterns(c) {
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
  const cols = ["Ticker","Day","Exp","Strike","C/P","Premium","Entry",priceFn?"Now":null,priceFn?"P&L":null,"Vol","OI",priceFn?"Live OI":null,priceFn?"ΔOI":null,"DTE"].filter(Boolean);
  const colCount = cols.length;
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:"1px solid "+P.bd }}>
          {cols.map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:"center", color:P.mt, fontSize:9, fontWeight:600, cursor:h==="ΔOI"?"help":"default" }} title={h==="ΔOI"?"Change in OI from CSV snapshot to live — shows if positions are growing or closing.":h==="Live OI"?"Current open interest fetched from broker":undefined}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const px = priceFn ? priceFn(r.S, r.CP, r.K, r.E) : null;
          const entry = r.price || (r.V > 0 ? r.P / r.V / 100 : 0);
          const now = px ? (px.mark || px.last || px.mid || 0) : 0;
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
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:premC(r.P) }}>{fmt(r.P)}</td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>}
              <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.V)}</td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{csvOI>0?csvOI.toLocaleString():"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:curOI>0?P.wh:csvOI>0?"#665d3a":P.dm }} title={curOI>0?undefined:csvOI>0?"BBS snapshot (live unavailable)":undefined}>{curOI>0?curOI.toLocaleString():csvOI>0?csvOI.toLocaleString():"—"}</td>}
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
  const cols = ["Ticker","Exp","Strike","C/P","OI",priceFn?"Live OI":null,priceFn?"ΔOI":null,priceFn?"Δ":null,priceFn?"θ":null,"Entry",priceFn?"Now":null,priceFn?"P&L":null,"Premium","Hits","Grade"].filter(Boolean);
  const colCount = cols.length;
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
      <thead>
        <tr style={{ borderBottom:"1px solid "+P.bd }}>
          {cols.map(h => (
            <th key={h} style={{ padding:"5px 4px", textAlign:"center", color:P.mt, fontSize:9, fontWeight:600, cursor:h==="ΔOI"?"help":"default" }} title={h==="ΔOI"?"Change in OI from CSV snapshot to live — shows if positions are growing or closing.":h==="Live OI"?"Current open interest fetched from broker":undefined}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const px = priceFn ? priceFn(r.S, r.CP, r.K, r.E) : null;
          const entry = r.entry || (r.V > 0 ? r.P / r.V / 100 : 0);
          const now = px ? (px.mark || px.last || px.mid || 0) : 0;
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
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{csvOI>0?csvOI.toLocaleString():"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:curOI>0?P.wh:csvOI>0?"#665d3a":P.dm }} title={curOI>0?undefined:csvOI>0?"BBS snapshot (live unavailable)":undefined}>{curOI>0?curOI.toLocaleString():csvOI>0?csvOI.toLocaleString():"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:dOIC }}>{dOI!==0?(dOI>0?"+":"")+dOI.toLocaleString():"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontSize:9, color:P.dm }}>{px&&px.delta?px.delta.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontSize:9, color:px&&px.theta<0?P.be:P.dm }}>{px&&px.theta?px.theta.toFixed(2):"—"}</td>}
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>}
              <td style={{ padding:"5px 4px", fontWeight:700, color:premC(r.P) }}>{fmt(r.P)}</td>
              <td style={{ padding:"5px 4px" }}>
                <span style={{ fontWeight:800, fontSize:13, color:r.H>=10?P.ac:r.H>=5?P.ye:P.dm }}>{r.H}x</span>
              </td>
              <td style={{ padding:"5px 4px" }}><Tag c={GRADE_COLORS[r.grade]||P.mt}>{r.grade||"—"}</Tag></td>
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

// ─── CSV Parser (fast-path: split on comma, fallback for quoted fields) ────────
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
  const lines = text.split("\n");
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
  const fieldPairs = Object.entries(colIdx);
  const numFields = fieldPairs.length;
  const tickerIdx = colIdx.ticker;
  const result = [];
  for (let li = headerIdx + 1; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw || raw.length < 3) continue;
    const cols = raw.indexOf('"') === -1 ? raw.replace(/\r$/, "").split(",") : parseCSVLine(raw.replace(/\r$/, ""));
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
  return "Mid-Small";
}
function filterByCap(trades, cap) {
  if (!cap || cap === "All") return trades;
  return trades.filter(t => capBand(t.mktcap) === cap);
}
function sum(arr) { return arr.reduce((a,t)=>a+t.P,0); }

// ─── ETF / Index Detection ────────────────────────────────────────────────────
// BBS CSV rows have stocketf === "ETF"/"INDEX" populated correctly. Massive
// live-worker rows come through without that field, so we fall back to this
// hardcoded set. Any change here also needs to be reflected in the backend
// stocketf tagging (long term fix: populate stocketf in the Massive processor).
const KNOWN_ETF_TICKERS = new Set([
  "SPY","QQQ","IWM","IWR","DIA","MDY","SMH","SOXL","SOXS","TQQQ","SQQQ",
  "TECL","TECS","LABU","LABD","FAS","FAZ","TZA","UPRO","SPXU","URTY","SRTY",
  "XBI","XLE","XLF","XLK","XLV","XLI","XLU","XLC","XLY","XLP","XLB","XLRE",
  "XLC","XSD","XPH","XRT","XHB","XME","XOP","XPP",
  "VIX","VXX","UVXY","SVXY","VIXY",
  "GLD","SLV","USO","UNG","GDX","GDXJ","SLX",
  "EEM","EFA","VEA","VWO","EWZ","FXI","INDA","EWJ","EWY","EWT",
  "AGG","BND","TLT","TMF","TMV","IEF","SHY","LQD","HYG","JNK",
  "JEPQ","QYLD","JEPI","SCHD","VIG","VYM","VOO","VTI","VT",
  "ARKK","ARKG","ARKW","ARKF","ARKQ",
  "DUST","NUGT","JDST","JNUG","GDXU","GDXD",
  "SPXL","SPXS","UVIX","SVIX","BITX","BITI","FBTC","IBIT","GBTC","ETHE",
  "KRE","KBE","AMLP","MLPX","REM","VNQ","IYR",
]);
function isETFSymbol(sym, stocketf) {
  const s = (stocketf||"").toUpperCase();
  if (s === "ETF" || s === "INDEX") return true;
  if (KNOWN_ETF_TICKERS.has((sym||"").toUpperCase())) return true;
  return false;
}

// ─── Theme Map ────────────────────────────────────────────────────────────────
// Tickers can belong to multiple themes. Themes aggregate flow across sectors.
const THEMES_DEF = {
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
const THEME_LOOKUP = {};
Object.entries(THEMES_DEF).forEach(([theme, tickers]) => {
  tickers.forEach(sym => {
    if (!THEME_LOOKUP[sym]) THEME_LOOKUP[sym] = [];
    if (!THEME_LOOKUP[sym].includes(theme)) THEME_LOOKUP[sym].push(theme);
  });
});
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
    if (!allCons[k]) allCons[k] = { sym:t.S, cp:t.CP, K:t.K, exp:t.E, DTE:t.DTE, hits:0, prem:0, vol:0, dir:t.D,
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
    const grade = gradeCluster(c);
    const scoreMap = {"A+":600,"A":500,"B+":400,"B":300,"C":200,"D":100};
    // Vol/OI ratio bonus — rewards unusually high activity relative to open interest
    const volOI = c.maxOI > 0 ? c.vol / c.maxOI : 0;
    const voiBonus = Math.min(volOI, 5) * 80; // caps at 5x = +400
    const k = c.sym+"|"+c.cp+"|"+c.K+"|"+c.exp;
    const trades = (consTrades[k]||[]).sort((a,b)=>b.P-a.P);
    return { ...c, grade, volOI, score:(scoreMap[grade]||0)+c.hits*20+c.prem/5e3+voiBonus + (c.hits<=1 && c.hasSweep && c.askPrem>c.bidPrem && c.oiExceeded && c.prem >= ((c.mktcap||0)>=500e9 ? 5e6 : 1e6) ? 250 : 0),
      side: c.askPrem >= c.bidPrem ? (c.hasAA ? "AA" : "ASK") : (c.hasBB ? "BB" : "BID"),
      strike:"$"+c.K+c.cp, trades, patterns:detectPatterns(c) };
  }).filter(c => {
    if (!c.clean || c.DTE <= 7) return false;
    if (c.exp) {
      const p = c.exp.split("/").map(Number);
      const y = p.length >= 3 ? (p[2] < 100 ? p[2] + 2000 : p[2]) : (new Date().getMonth()+1 > p[0] ? new Date().getFullYear()+1 : new Date().getFullYear());  // FIX: 2-digit years from formatExp ("5/21/27") need +2000, else JS Date treats as 1927 and LEAPS get marked "expired"
      const expDate = new Date(y, p[0]-1, p[1], 23, 59, 59);
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
      er:(r.er||"").toUpperCase().trim() === "T",
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
    if (isITM) return true;
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
      if (!clusterDirs[k]) clusterDirs[k] = { dirs: new Set(), askTimes:[], askIVs:[], bidTimes:[], bidIVs:[], bbSweepTimes:[], hasBidSide:false, hasAskSide:false, hasSweep:false, dte:t.DTE, askPrem:0, bidPrem:0 };
      if (t.Si === "B" || t.Si === "BB") { clusterDirs[k].hasBidSide = true; clusterDirs[k].bidTimes.push(t._idx); clusterDirs[k].bidPrem += t.P; if (t.IV > 0) clusterDirs[k].bidIVs.push(t.IV); }
      if (t.Si === "A" || t.Si === "AA") { clusterDirs[k].hasAskSide = true; clusterDirs[k].askTimes.push(t._idx); clusterDirs[k].askPrem += t.P; if (t.IV > 0) clusterDirs[k].askIVs.push(t.IV); }
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
        // Exception 4: Premium dominance — if one side is 85%+ of total premium, the minor side is noise
        const totalSidePrem = c.askPrem + c.bidPrem;
        if (totalSidePrem > 0) {
          if (c.askPrem / totalSidePrem >= 0.85 || c.bidPrem / totalSidePrem >= 0.85) return; // dominant side is the signal
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
    if (!t.OI || t.OI <= 0 || t.DTE <= 0) return;
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
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
  });
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

  // Ticker DB for Search (all filtered trades, confirmed + unconfirmed)
  const tickerMap = {};
  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i];
    if (!tickerMap[t.S]) tickerMap[t.S] = { s:t.S, b:0, r:0, n:0, topTrades:[], minTopP:0, consMap:{}, mktcap:0, er:false, uoa:false, sector:"" };
    const tk = tickerMap[t.S];
    tk.n++; if (t.D==="BULL") tk.b+=t.P; else if (t.D==="BEAR") tk.r+=t.P;
    if (t.mktcap > tk.mktcap) tk.mktcap = t.mktcap;
    if (t.er) tk.er = true;
    if (t.uoa) tk.uoa = true;
    if (t.sector && !tk.sector) tk.sector = t.sector;
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
      hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true, bullPrem:0, bearPrem:0 };
    tk.consMap[ck].H++; tk.consMap[ck].P+=t.P; tk.consMap[ck].V+=t.V;
    if (t.D === "BULL") tk.consMap[ck].bullPrem += t.P;
    if (t.D === "BEAR") tk.consMap[ck].bearPrem += t.P;
    if (t.Ty==="SWP") tk.consMap[ck].hasSweep = true;
    if (t.Ty==="BLK") tk.consMap[ck].hasBlock = true;
    if (t.Co==="YELLOW"||t.Co==="MAGENTA") tk.consMap[ck].oiExceeded = true;
    if (t.D) tk.consMap[ck].dirs.add(t.D);
  }
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
            return { ...rep, P: c.P, V: c.V };
          })
          .filter(x => x !== null)
          .sort((a, b) => b.P - a.P)
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

// ─── Main Component ────────────────────────────────────────────────────────────

// ── DarkPool component (inlined as IIFE to avoid naming conflicts) ──────────

// ── DarkPool component (inlined as IIFE to avoid naming conflicts) ──────────

// ── DarkPool component (inlined as IIFE to avoid naming conflicts) ──────────
const DarkPool = (() => {
// ── Built-in CSV parser (no external dependencies) ───────────────────────────
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
  const lines = text.split("\n");
  let headerIdx = 0;
  while (headerIdx < lines.length && !lines[headerIdx].trim()) headerIdx++;
  if (headerIdx >= lines.length - 1) return [];
  const headers = parseCSVLine(lines[headerIdx].replace(/\r$/, ""));
  const numHeaders = headers.length;
  const result = [];
  for (let li = headerIdx + 1; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw || raw.length < 3) continue;
    // Fast path: no quotes → split on comma (covers most dark pool rows)
    const cols = raw.indexOf('"') === -1 ? raw.replace(/\r$/, "").split(",") : parseCSVLine(raw.replace(/\r$/, ""));
    const row = {};
    let hasVal = false;
    for (let i = 0; i < numHeaders; i++) {
      const v = (cols[i] || "").trim();
      if (v) hasVal = true;
      row[headers[i]] = v;
    }
    if (hasVal) result.push(row);
  }
  return result;
}

// ── colours (matched to OptionsFlow dashboard palette) ─────────────────────
const C = {
  bg:"#0e0f0d", bg2:"#1a1c17", bg3:"#22251e", bg4:"#1a1c17", bgH:"#2a2d23",
  bdr:"#2e3127", bdr2:"#3a3d32",
  tx:"#e0dac8", tx2:"#a8a290", tx3:"#706b5e",
  blue:"#6ba3be", green:"#3cb868", red:"#e74c3c", amber:"#c9a84c",
  cyan:"#6ba3be", purple:"#a78bfa", pink:"#c97a8b", orange:"#c9844c",
};
const CAT_COLORS = {
  "Indexes":"#6ba3be","Large Cap":"#a78bfa","Mid Cap":"#c9a84c","Small Cap":"#e74c3c",
  "Sector ETFs":"#3cb868","Bond ETFs":"#6ba3be","Intl/EM ETFs":"#c97a8b","Commodity ETFs":"#c9844c"
};

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n){
  if(n>=1e9) return "$"+(n/1e9).toFixed(2)+"B";
  if(n>=1e6) return "$"+(n/1e6).toFixed(1)+"M";
  if(n>=1e3) return "$"+(n/1e3).toFixed(0)+"K";
  return "$"+n;
}
function fP(p){ return p!=null?"$"+p.toFixed(2):"—"; }
function zC(p,lo,hi){ return p>hi?C.green:p<lo?C.red:"#a8a290"; }
function pctFmt(p){ return p===0?"IN":(p>0?"+":"")+p.toFixed(2)+"%"; }

// Format large avg vol percentages readably (897112% → 8,971×)
function fmtAvgVol(pct) {
  if (pct >= 10000) return Math.round(pct/100).toLocaleString() + "×";
  if (pct >= 1000) return (pct/100).toFixed(1) + "×";
  if (pct >= 100) return Math.round(pct) + "%";
  return pct.toFixed(0) + "%";
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({it, w=140, h=36}){
  const P=4;
  const pts = it.prices.map((p,i)=>({p,w:it.w[i]})).filter(x=>x.p!=null);
  if(pts.length<2) return <span style={{color:C.tx3,fontSize:10}}>–</span>;
  const allP = pts.map(x=>x.p);
  const mn=Math.min(...allP), mx=Math.max(...allP);
  const rng=mx-mn||1;
  const y=p=>h-P-2-((p-mn)/rng)*(h-P*2-4);
  const x=i=>(P+(i/(pts.length-1||1))*(w-P*2));
  const lo=it.lo, hi=it.hi;
  const zoneY1=y(hi), zoneY2=y(lo);
  const polyline = pts.map((pt,i)=>x(i)+","+y(pt.p)).join(" ");
  const lastP=pts[pts.length-1].p;
  const lineColor=lastP>hi?C.green:lastP<lo?C.red:"#a8a290";

  // Big print level — clamp to visible range
  const bp = it.bigPrint;
  const bpInRange = bp!=null && bp>=mn && bp<=mx;
  const bpY = bp!=null ? Math.max(P, Math.min(h-P, y(bp))) : null;
  // Zone thickness scales with notional weight (bigger print = thicker zone)
  const bpThick = it.bigPrintN && it.n ? Math.max(2, Math.min(6, (it.bigPrintN/it.n)*20)) : 3;

  return (
    <svg width={w} height={h} style={{display:"block"}}>
      {/* DP zone band */}
      <rect x={P} y={zoneY1} width={w-P*2} height={Math.max(0,zoneY2-zoneY1)}
        fill="#6ba3be11" stroke="none"/>
      <line x1={P} y1={y(lo)} x2={w-P} y2={y(lo)} stroke="#6ba3be33" strokeWidth={0.5}/>
      <line x1={P} y1={y(hi)} x2={w-P} y2={y(hi)} stroke="#6ba3be33" strokeWidth={0.5}/>

      {/* Largest print level — amber zone */}
      {bpY!=null && (
        <>
          {/* Thick zone band */}
          <rect x={P} y={bpY - bpThick/2} width={w-P*2} height={bpThick}
            fill="#c9a84c33" stroke="none" rx={1}/>
          {/* Center line */}
          <line x1={P} y1={bpY} x2={w-P} y2={bpY}
            stroke="#c9a84c" strokeWidth={1.5} strokeDasharray="3,2" opacity={0.9}/>
          {/* Left anchor tick */}
          <line x1={P} y1={bpY-4} x2={P} y2={bpY+4}
            stroke="#c9a84c" strokeWidth={2} opacity={0.9}/>
        </>
      )}

      {/* Price line */}
      <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth={1.2}/>
      {pts.map((pt,i)=>{
        const wt=pt.w||0;
        const r=Math.max(1.2, wt*3.5);
        const clr=zC(pt.p,lo,hi);
        const a=(0.15+wt*0.65).toFixed(2);
        const fill=lastP>hi?`rgba(45,212,160,${a})`:lastP<lo?`rgba(255,92,114,${a})`:`rgba(200,212,228,${a})`;
        return <circle key={i} cx={x(i)} cy={y(pt.p)} r={r} fill={fill}/>;
      })}
    </svg>
  );
}

// ── Tooltip wrapper ───────────────────────────────────────────────────────────
function TickerCell({it, catColor}){
  const [show,setShow]=useState(false);
  return (
    <div style={{position:"relative",display:"inline-block"}}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      <span style={{color:catColor||C.tx,fontWeight:700,fontFamily:"'Instrument Sans', sans-serif",
        fontSize:13,cursor:"default"}}>
        ${it.t}
      </span>
      {it.u && <span style={{marginLeft:4,fontSize:9,color:C.amber,background:C.amber+"18",
        padding:"1px 4px",borderRadius:4,fontWeight:700}}>UOA</span>}
      {show && it.top5 && (
        <div style={{position:"absolute",left:0,top:"100%",zIndex:50,
          background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
          padding:"8px 10px",minWidth:220,boxShadow:"0 4px 20px #00000066",marginTop:2}}>
          <div style={{color:C.tx2,fontSize:10,fontWeight:700,marginBottom:6,
            borderBottom:`1px solid ${C.bdr}`,paddingBottom:4}}>
            ${it.t} Top Blocks ({it.c} total)
          </div>
          {it.top5.map((r,i)=>(
            <div key={i} style={{color:C.tx,fontSize:11,fontFamily:"'Instrument Sans', sans-serif",
              padding:"2px 0"}}>{r}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Zone display ──────────────────────────────────────────────────────────────
function ZoneCell({it}){
  const pos=it.pos;
  const color=pos==="above"?C.green:pos==="below"?C.red:"#a8a290";
  const pct=pos==="in"?"IN ZONE":(pos==="above"?"+":"")+it.pct.toFixed(2)+"%";
  return (
    <span style={{color,fontWeight:700,fontFamily:"'Instrument Sans', sans-serif",fontSize:13}}>
      {pct}
    </span>
  );
}


// ── Big Print cell (proper component to avoid hook-in-IIFE error) ─────────────
function BigPrintCell({it}){
  const [hover,setHover]=useState(false);
  const [pos,setPos]=useState({top:0,left:0});
  const ref=useRef(null);
  const tip = it.bigPrintN ? [
    it.bigPrintDate,
    fmt(it.bigPrintN),
    it.bigPrintPctAvgVol>0 ? it.bigPrintPctAvgVol.toFixed(1)+"% of avg vol" : it.avg30>0 ? ((it.bigPrintN/it.avg30)*100).toFixed(1)+"% of avg vol" : null
  ].filter(Boolean).join(" · ") : null;
  const handleEnter=()=>{
    if(ref.current){
      const r=ref.current.getBoundingClientRect();
      // Flip left if near right edge
      const left = r.right+220>window.innerWidth ? r.right-220 : r.left;
      setPos({top:r.bottom+6, left:Math.max(8,left)});
    }
    setHover(true);
  };
  return (
    <div ref={ref} style={{position:"relative",display:"inline-block"}}
      onMouseEnter={handleEnter} onMouseLeave={()=>setHover(false)}>
      <span style={{color:C.amber,fontWeight:700,cursor:"default"}}>
        {fP(it.bigPrint)}
        {tip && <span style={{fontSize:9,color:C.amber,opacity:0.5,marginLeft:3,
          verticalAlign:"middle",fontWeight:400}}>ⓘ</span>}
      </span>
      {hover && tip && (
        <div style={{position:"fixed",top:pos.top,left:pos.left,zIndex:9999,
          background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
          padding:"7px 11px",whiteSpace:"nowrap",boxShadow:"0 4px 20px #00000066",
          color:C.tx,fontSize:13,fontFamily:"'Instrument Sans', sans-serif",
          fontWeight:500,letterSpacing:"0.01em",pointerEvents:"none"}}>
          {tip}
        </div>
      )}
    </div>
  );
}

// ── Category pill ─────────────────────────────────────────────────────────────
function CatPill({cat}){
  const color=CAT_COLORS[cat]||C.tx2;
  return (
    <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,
      background:color+"18",color,fontWeight:600}}>
      {cat}
    </span>
  );
}

// ── Signal badges ────────────────────────────────────────────────────────────
const SIG_COLORS={
  YEARLY_RECORD:"#c9a84c", MONTHLY_RECORD:"#3cb868", NOTIONAL_SPIKE:"#e74c3c",
  RARE_FLOW:"#6ba3be", SIZE_ESCALATION:"#a78bfa", ZONE_BREAK_RECORD:"#c9a84c",
};
const SIG_SHORT={
  YEARLY_RECORD:"Yr Record", MONTHLY_RECORD:"Mo Record", NOTIONAL_SPIKE:"Vol Surge",
  RARE_FLOW:"New Flow", SIZE_ESCALATION:"Escalating", ZONE_BREAK_RECORD:"Zone Break",
};
function SignalBadges({signals,compact}){
  if(!signals||signals.length===0) return null;
  return (
    <span style={{display:"inline-flex",gap:3,flexWrap:"wrap"}}>
      {signals.map(s=>{
        const color=SIG_COLORS[s.type]||C.amber;
        const label=compact
          ? (SIG_SHORT[s.type]||s.label)+(s.mult?"·"+s.mult+"×":"")+(s.days?"·"+s.days+"d":"")
          : s.label+(s.mult?" "+s.mult+"×":"")+(s.days?" "+s.days+"d":"");
        return (
          <span key={s.type} style={{fontSize:compact?8:9,padding:compact?"1px 5px":"2px 7px",
            borderRadius:8,background:color+"18",color,fontWeight:700,whiteSpace:"nowrap",
            border:`1px solid ${color}33`,lineHeight:1.2}}>
            {label}
          </span>
        );
      })}
    </span>
  );
}

// ── Big Print cell (proper component so hooks are legal) ─────────────────────

// ── Flow table ────────────────────────────────────────────────────────────────
const TH = ({children,style={}}) => (
  <th style={{padding:"8px 10px",textAlign:"left",fontSize:11,
    color:"#706b5e",fontWeight:600,borderBottom:"1px solid #2e3127",
    position:"sticky",top:0,background:"#22251e",whiteSpace:"nowrap",...style}}>
    {children}
  </th>
);
const TD = ({children,style={}}) => (
  <td style={{padding:"7px 10px",borderBottom:"1px solid #2e312733",
    verticalAlign:"middle",...style}}>
    {children}
  </td>
);

// ── Module-level data ref (set when CSV loads) ─────────────────────────────
let D = null;

function FlowTable({items, showCat=true, showZone=false}){
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead>
          <tr>
            <TH>Ticker</TH>
            {showCat && <TH>Category</TH>}
            <TH>Last</TH>
            {showZone && <TH>DP Zone</TH>}
            <TH>Big Print</TH>
            <TH>% Move</TH>
            <TH>Notional</TH>
            <TH>Trades</TH>
            <TH>Days</TH>
            <TH>30-Day</TH>
          </tr>
        </thead>
        <tbody>
          {items.map(it=>{
            const cc=CAT_COLORS[it.cat]||C.tx;
            const bpPct = it.bigPrint>0 ? ((it.last-it.bigPrint)/it.bigPrint*100) : null;
            const bpMoveColor = bpPct==null ? C.tx3 : bpPct>0 ? C.green : bpPct<0 ? C.red : C.tx3;
            return (
              <tr key={it.t+it.cat} style={{background:"transparent"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.bgH}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <TD><TickerCell it={it} catColor={cc}/></TD>
                {showCat && <TD><CatPill cat={it.cat}/></TD>}
                <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:zC(it.last,it.lo,it.hi)}}>
                  {fP(it.last)}
                </TD>
                {showZone && (
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:C.tx2,fontSize:11}}>
                    {fP(it.lo)}<span style={{color:C.tx3,margin:"0 3px"}}>–</span>{fP(it.hi)}
                  </TD>
                )}
                <TD style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11}}>
                  <BigPrintCell it={it}/>
                </TD>
                <TD style={{fontFamily:"'Instrument Sans', sans-serif",fontWeight:700,
                  color:bpMoveColor}}>
                  {bpPct==null ? "—" : (bpPct>0?"+":"")+bpPct.toFixed(2)+"%"}
                </TD>
                <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:C.cyan,fontWeight:600}}>
                  {fmt(it.n)}
                </TD>
                <TD style={{color:C.tx2,fontFamily:"'Instrument Sans', sans-serif"}}>{it.c}</TD>
                <TD style={{color:C.tx3,fontFamily:"'Instrument Sans', sans-serif"}}>{it.days}</TD>
                <TD><Sparkline it={it}/></TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Overview stat card ────────────────────────────────────────────────────────
function StatCard({label, value, sub, color, icon}){
  return (
    <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:6,
      padding:"10px 14px"}}>
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
        {icon && <span style={{fontSize:10,opacity:0.7}}>{icon}</span>}
        <span style={{fontSize:9,color:C.tx3,textTransform:"uppercase",
          letterSpacing:"0.06em",fontWeight:700}}>{label}</span>
      </div>
      <div style={{fontSize:18,fontWeight:700,color:color||C.tx,fontFamily:"'Instrument Sans', sans-serif"}}>
        {value}
      </div>
      {sub && <div style={{fontSize:10,color:C.tx2,marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ── Zone Gauge — horizontal segmented bar ─────────────────────────────────────
function ZoneGauge({above,inside,below}){
  const total=above+inside+below||1;
  const pA=((above/total)*100).toFixed(1);
  const pI=((inside/total)*100).toFixed(1);
  const pB=((below/total)*100).toFixed(1);
  const seg=(count,pct,color,label,align)=>(
    <div style={{flex:count||0.01,display:"flex",flexDirection:"column",alignItems:align,gap:3,minWidth:0}}>
      <div style={{fontSize:10,color,fontWeight:700,fontFamily:"'Instrument Sans', sans-serif",whiteSpace:"nowrap"}}>
        {count} <span style={{fontWeight:400,color:C.tx3}}>({pct}%)</span>
      </div>
      <div style={{width:"100%",height:8,borderRadius:4,background:color,opacity:0.85,
        transition:"all 0.3s ease"}}/>
      <div style={{fontSize:9,color:C.tx3,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</div>
    </div>
  );
  return (
    <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"14px 18px"}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
        textTransform:"uppercase",marginBottom:10}}>Zone Positioning</div>
      <div style={{display:"flex",gap:3,alignItems:"flex-start"}}>
        {seg(above,pA,C.green,"Above","flex-start")}
        {seg(inside,pI,"#706b5e","Inside","center")}
        {seg(below,pB,C.red,"Below","flex-end")}
      </div>
    </div>
  );
}

// ── Category Notional Bars ────────────────────────────────────────────────────
function CategoryBars({categories,onJumpTo}){
  const maxN=Math.max(...categories.map(c=>c.totalNotional),1);
  return (
    <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
        textTransform:"uppercase",marginBottom:12}}>Notional by Category</div>
      {categories.filter(c=>c.count>0).map(c=>{
        const color=CAT_COLORS[c.name]||C.tx2;
        const pct=Math.max((c.totalNotional/maxN)*100,1);
        return (
          <div key={c.name} style={{marginBottom:8,cursor:onJumpTo?"pointer":"default"}}
            onClick={()=>onJumpTo&&onJumpTo(c.name)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
              <span style={{fontSize:11,fontWeight:600,color}}>{c.name}</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans', sans-serif"}}>{c.count} tickers</span>
                <span style={{fontSize:11,fontWeight:700,color:C.cyan,fontFamily:"'Instrument Sans', sans-serif",minWidth:64,textAlign:"right"}}>
                  {fmt(c.totalNotional)}
                </span>
              </div>
            </div>
            <div style={{width:"100%",height:6,background:C.bdr,borderRadius:3,overflow:"hidden"}}>
              <div style={{width:pct+"%",height:"100%",background:`linear-gradient(90deg, ${color}cc, ${color})`,
                borderRadius:3,transition:"width 0.4s ease"}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Top Biggest Prints panel (tabbed, sortable, %AvgVol) ─────────────────────
function BiggestPrintsPanel(){
  const [catTab,setCatTab]=useState("All");
  const [sortKey,setSortKey]=useState("bigPrintN");
  const [sortDir,setSortDir]=useState("desc");

  const PRINT_TABS=[
    {id:"All",label:"All"},
    {id:"Indexes",label:"Indexes"},
    {id:"ETFs",label:"ETFs"},
    {id:"Large Cap",label:"Large"},
    {id:"Mid Cap",label:"Mid"},
    {id:"Small Cap",label:"Small"},
  ];
  const ETF_CATS=new Set(["Sector ETFs","Bond ETFs","Intl/EM ETFs","Commodity ETFs"]);

  const universe=(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) if(it.bigPrintN>0) map[it.t]=it;
    return Object.values(map);
  })();

  const filtered=useMemo(()=>{
    let items=universe;
    if(catTab==="ETFs") items=items.filter(i=>ETF_CATS.has(i.cat));
    else if(catTab!=="All") items=items.filter(i=>i.cat===catTab);

    const acc={
      bigPrintN:x=>x.bigPrintN, bigPrint:x=>x.bigPrint, t:x=>x.t,
      bpMove:x=>x.bigPrint>0?((x.last-x.bigPrint)/x.bigPrint*100):null,
      avgVol:x=>x.bigPrintPctAvgVol||0,
    };
    const fn=acc[sortKey]||(x=>x[sortKey]);
    items=[...items].sort((a,b)=>{
      const va=fn(a),vb=fn(b);
      if(va==null&&vb==null) return 0; if(va==null) return 1; if(vb==null) return -1;
      if(typeof va==="string") return sortDir==="asc"?va.localeCompare(vb):vb.localeCompare(va);
      return sortDir==="asc"?va-vb:vb-va;
    });
    return items.slice(0,15);
  },[universe,catTab,sortKey,sortDir]);

  function toggleSort(key){
    if(sortKey===key) setSortDir(d=>d==="desc"?"asc":"desc");
    else { setSortKey(key); setSortDir("desc"); }
  }
  const hdr=(key,label,minW)=>{
    const active=sortKey===key;
    const arrow=active?(sortDir==="asc"?" ▲":" ▼"):"";
    return (
      <span onClick={()=>toggleSort(key)}
        style={{fontSize:9,color:active?C.blue:C.tx3,fontWeight:600,minWidth:minW,textAlign:"right",
          cursor:"pointer",userSelect:"none",transition:"color 0.15s"}}>
        {label}{arrow}
      </span>
    );
  };

  return (
    <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
        textTransform:"uppercase",marginBottom:8}}>Biggest Single Prints</div>

      {/* Category tabs */}
      <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
        {PRINT_TABS.map(t=>{
          const on=catTab===t.id;
          return (
            <button key={t.id} onClick={()=>setCatTab(t.id)}
              style={{padding:"3px 10px",borderRadius:12,fontSize:10,fontWeight:on?700:400,
                border:`1px solid ${on?C.blue+"88":C.bdr}`,
                background:on?C.blue+"18":"transparent",color:on?C.blue:C.tx3,
                cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap"}}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Column headers */}
      <div style={{display:"flex",justifyContent:"space-between",padding:"0 0 5px 0",
        borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,width:18,textAlign:"center"}}>#</span>
          {hdr("t","Ticker",50)}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {hdr("bigPrint","Print $",56)}
          {hdr("bigPrintN","Notional",60)}
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:38,textAlign:"right"}}>Date</span>
          {hdr("bpMove","% Move",48)}
          {hdr("avgVol","% AvgVol",52)}
        </div>
      </div>

      {/* Rows */}
      {filtered.map((it,i)=>{
        const bpPct=it.bigPrint>0?((it.last-it.bigPrint)/it.bigPrint*100):null;
        const bpColor=bpPct==null?C.tx3:bpPct>0?C.green:bpPct<0?C.red:C.tx3;
        const cc=CAT_COLORS[it.cat]||C.tx;
        const avgV=it.bigPrintPctAvgVol;
        const avgVColor=avgV>=50?C.pink:avgV>=20?C.amber:avgV>0?C.tx2:C.tx3;
        return (
          <div key={it.t} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"5px 0",borderBottom:`1px solid ${C.bdr}22`}}>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans', sans-serif",
                width:18,textAlign:"center",fontWeight:600}}>{i+1}</span>
              <span style={{fontFamily:"'Instrument Sans', sans-serif",fontWeight:700,
                fontSize:12,color:cc}}>{it.t}</span>
              <SignalBadges signals={it.signals} compact/>
              {it.accDist && <span style={{fontSize:9,padding:"2px 6px",borderRadius:6,fontWeight:700,
                background:it.accDist==="Acc"?C.green+"18":C.red+"18",
                color:it.accDist==="Acc"?C.green:C.red,
                border:`1px solid ${it.accDist==="Acc"?C.green:C.red}33`}}>{it.accDist}</span>}
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11,color:C.amber,
                fontWeight:600,minWidth:56,textAlign:"right"}}>{fP(it.bigPrint)}</span>
              <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11,color:C.cyan,
                fontWeight:700,minWidth:60,textAlign:"right"}}>{fmt(it.bigPrintN)}</span>
              <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:10,color:C.tx3,
                minWidth:38,textAlign:"right"}}>{it.bigPrintDate||"—"}</span>
              <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11,fontWeight:700,
                color:bpColor,minWidth:48,textAlign:"right"}}>
                {bpPct==null?"—":(bpPct>0?"+":"")+bpPct.toFixed(1)+"%"}
              </span>
              <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11,fontWeight:700,
                color:avgVColor,minWidth:52,textAlign:"right"}}>
                {avgV>0?fmtAvgVol(avgV):"—"}
              </span>
            </div>
          </div>
        );
      })}
      {filtered.length===0 && <div style={{fontSize:12,color:C.tx3,padding:8}}>No prints in this category</div>}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewPane({onJumpTo}){
  const sectionLabel = txt => (
    <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
      textTransform:"uppercase",marginBottom:10}}>{txt}</div>
  );

  // Compute zone counts across ALL tickers
  const {aboveN,insideN,belowN,allItems}=(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) map[it.t]=it;
    const items=Object.values(map);
    return {
      aboveN:items.filter(i=>i.pos==="above").length,
      insideN:items.filter(i=>i.pos==="inside").length,
      belowN:items.filter(i=>i.pos==="below").length,
      allItems:items,
    };
  })();

  // Net sentiment: bull/bear lean
  const netLean=aboveN-belowN;
  const leanColor=netLean>0?C.green:netLean<0?C.red:C.tx2;
  const leanLabel=netLean>0?"Bullish Lean":netLean<0?"Bearish Lean":"Neutral";

  function MiniRow({item, dir}){
    const color = dir==="above" ? C.green : C.red;
    const [bpHover,setBpHover]=useState(false);
    const bpPct = item.bigPrint>0 ? ((item.last-item.bigPrint)/item.bigPrint*100) : null;
    const bpMoveColor = bpPct==null ? C.tx3 : bpPct>0 ? C.green : bpPct<0 ? C.red : C.tx3;
    const tip = item.bigPrintN ? [
      item.bigPrintDate,
      fmt(item.bigPrintN),
      item.bigPrintPctAvgVol>0 ? item.bigPrintPctAvgVol.toFixed(1)+"% of avg vol" : null
    ].filter(Boolean).join(" · ") : null;
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"6px 0",borderBottom:`1px solid ${C.bdr}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontFamily:"'Instrument Sans', sans-serif",fontWeight:700,
            fontSize:12,color:C.tx,minWidth:52}}>{item.t}</span>
          <span style={{fontSize:10,color:C.tx3}}>
            Zone {fP(item.lo)}–{fP(item.hi)}
          </span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11,color:C.tx2}}>
            {fP(item.last)}
          </span>
          <div style={{position:"relative",display:"inline-block"}}
            onMouseEnter={()=>setBpHover(true)} onMouseLeave={()=>setBpHover(false)}>
            <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11,color:C.amber,
              fontWeight:700,minWidth:68,display:"inline-block",textAlign:"right",cursor:"default"}}>
              {fP(item.bigPrint)}
              {tip && <span style={{fontSize:9,color:C.amber,opacity:0.5,marginLeft:3,
                verticalAlign:"middle",fontWeight:400}}>ⓘ</span>}
            </span>
            {bpHover && tip && (
              <div style={{position:"absolute",right:0,top:"100%",zIndex:50,
                background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
                padding:"7px 11px",whiteSpace:"nowrap",boxShadow:"0 4px 20px #00000066",
                marginTop:4,color:C.tx,fontSize:13,fontFamily:"'Instrument Sans', sans-serif",
                fontWeight:500,letterSpacing:"0.01em"}}>
                {tip}
              </div>
            )}
          </div>
          <span style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:12,
            fontWeight:700,color:bpMoveColor,minWidth:60,textAlign:"right"}}>
            {bpPct==null ? "—" : (bpPct>0?"+":"")+bpPct.toFixed(2)+"%"}
          </span>
          <span style={{fontSize:10,color:C.tx3,minWidth:36,textAlign:"right"}}>
            {fmt(item.n)}
          </span>
        </div>
      </div>
    );
  }

  // ── Generate narrative summary ──────────────────────────────────────────────
  const narrative = (()=>{
    const days = D.meta.tradingDays;

    // Filter out names that ALWAYS print — indexes, mega-caps, popular ETFs
    const USUAL = new Set([
      "SPY","QQQ","IWM","DIA","VOO","IVV","VTI","RSP","MDY","TQQQ","SQQQ","UPRO","SPXL","SOXL","SOXS","TNA","TZA",
      "XLF","XLE","XLK","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GLD","SLV","TLT","HYG","LQD","AGG","BND","EEM","EFA","VEA","VWO",
      "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","JPM","V","MA","UNH","HD","PG","JNJ","XOM","CVX",
      "BAC","WFC","NFLX","ORCL","CRM","AMD","INTC","MU","QCOM","BRK.B","COST","LLY","MRK","ABBV","PEP","KO",
      "FNDX","FNDA","SCHG","SCHI","SCHM","SCHX","VUG","VTV","VO","VB","IEFA","IEMG","ACWI","VGT",
      "IWF","IWD","IWB","IWR","IWS","GOVT","MBB","VCIT","VCSH","VTIP","VGIT","VUSB","VCLT",
    ]);

    let parts = [];

    if(days >= 3){
      // Repeat: appeared on 70%+ of days, min 4 days
      const repeatThresh = Math.max(4, Math.ceil(days * 0.7));
      const repeats = allItems
        .filter(i => i.days >= repeatThresh && !USUAL.has(i.t))
        .sort((a,b) => b.days - a.days || b.bigPrintN - a.bigPrintN);
      if(repeats.length > 0){
        const top = repeats.slice(0,5);
        parts.push(`Repeat: ${top.map(t => `${t.t} (${t.days}/${days}d)`).join(", ")}${repeats.length>5?" +"+( repeats.length-5):""}.`);
      }
    }

    // Unusual mid/small cap — $30M+ print, cap at 3
    const unusual = allItems
      .filter(i => !USUAL.has(i.t) && (i.cat === "Mid Cap" || i.cat === "Small Cap") && i.bigPrintN >= 30_000_000)
      .sort((a,b) => b.bigPrintN - a.bigPrintN);
    if(unusual.length > 0){
      parts.push(`Unusual: ${unusual.slice(0,3).map(t => `${t.t} (${fmt(t.bigPrintN)}${t.bigPrintPctAvgVol>=30?" · "+fmtAvgVol(t.bigPrintPctAvgVol)+" vol":""})`).join(", ")}.`);
    }

    // Outsized prints — 50%+ avg vol, $50M+, cap at 3
    const highVol = allItems
      .filter(i => !USUAL.has(i.t) && i.bigPrintPctAvgVol >= 50 && i.bigPrintN >= 50_000_000)
      .sort((a,b) => b.bigPrintPctAvgVol - a.bigPrintPctAvgVol);
    if(highVol.length > 0){
      const notShown = highVol.filter(h => !unusual.slice(0,3).some(u => u.t === h.t));
      if(notShown.length > 0){
        parts.push(`Outsized: ${notShown.slice(0,3).map(t => `${t.t} (${fmtAvgVol(t.bigPrintPctAvgVol)} vol)`).join(", ")}.`);
      }
    }

    // Flagged — cap at 3
    const flaggedUnusual = allItems
      .filter(i => i.signals && i.signals.length > 0 && !USUAL.has(i.t))
      .sort((a,b) => b.signals.length - a.signals.length || b.bigPrintN - a.bigPrintN);
    if(flaggedUnusual.length > 0){
      parts.push(`Flagged: ${flaggedUnusual.slice(0,3).map(t => `${t.t} ${t.signals.map(s=>s.icon).join("")}`).join(", ")}${flaggedUnusual.length>3?" +"+(flaggedUnusual.length-3):""}.`);
    }

    // Zone lean
    const abovePct = Math.round((aboveN/(allItems.length||1))*100);
    const belowPct = Math.round((belowN/(allItems.length||1))*100);
    if(Math.abs(abovePct - belowPct) >= 5){
      parts.push(`Zone: ${belowPct > abovePct ? "bearish" : "bullish"} (${abovePct}%↑ ${belowPct}%↓).`);
    }

    return parts.length > 0 ? parts.join(" ") : null;
  })();

  // ── Structured Intelligence Data ─────────────────────────────────────────────
  const USUAL = new Set([
    "SPY","QQQ","IWM","DIA","VOO","IVV","VTI","RSP","MDY","TQQQ","SQQQ","UPRO","SPXL","SOXL","SOXS","TNA","TZA",
    "XLF","XLE","XLK","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GLD","SLV","TLT","HYG","LQD","AGG","BND","EEM","EFA","VEA","VWO",
    "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","JPM","V","MA","UNH","HD","PG","JNJ","XOM","CVX",
    "BAC","WFC","NFLX","ORCL","CRM","AMD","INTC","MU","QCOM","BRK.B","COST","LLY","MRK","ABBV","PEP","KO",
    "FNDX","FNDA","SCHG","SCHI","SCHM","SCHX","VUG","VTV","VO","VB","IEFA","IEMG","ACWI","VGT",
    "IWF","IWD","IWB","IWR","IWS","GOVT","MBB","VCIT","VCSH","VTIP","VGIT","VUSB","VCLT",
  ]);
  const days=D.meta.tradingDays;
  const repeatThresh=Math.max(4, Math.ceil(days * 0.7));
  const repeats=days>=3?allItems.filter(i=>i.days>=repeatThresh&&!USUAL.has(i.t)).sort((a,b)=>b.days-a.days||b.bigPrintN-a.bigPrintN):[];
  const unusualNames=allItems.filter(i=>!USUAL.has(i.t)&&(i.cat==="Mid Cap"||i.cat==="Small Cap")&&i.bigPrintN>=30_000_000).sort((a,b)=>b.bigPrintN-a.bigPrintN);
  const outsized=allItems.filter(i=>!USUAL.has(i.t)&&i.bigPrintPctAvgVol>=50&&i.bigPrintN>=50_000_000).sort((a,b)=>b.bigPrintPctAvgVol-a.bigPrintPctAvgVol);
  const flaggedAll=allItems.filter(i=>i.signals&&i.signals.length>0&&!USUAL.has(i.t)).sort((a,b)=>b.signals.length-a.signals.length||b.bigPrintN-a.bigPrintN);
  const abovePct=Math.round((aboveN/(allItems.length||1))*100);
  const belowPct=Math.round((belowN/(allItems.length||1))*100);
  const hasIntel=repeats.length>0||unusualNames.length>0||outsized.length>0||flaggedAll.length>0;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>

      {/* ── Intelligence Panel ────────────────────────────────────── */}
      {hasIntel && (
      <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
        {/* Title row with zone lean */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.amber,
            textTransform:"uppercase"}}>📋 Dark Pool Intelligence — {D.meta.dateRange||"Selected Period"}</div>
          {Math.abs(abovePct-belowPct)>=5 && (
            <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:12,
              background:(belowPct>abovePct?C.red:C.green)+"18",
              color:belowPct>abovePct?C.red:C.green,
              border:`1px solid ${belowPct>abovePct?C.red:C.green}33`}}>
              {belowPct>abovePct?"Bearish":"Bullish"} Lean · {abovePct}%↑ {belowPct}%↓
            </span>
          )}
        </div>

        {/* Two-column grid: Repeat Flow + Unusual/Outsized combined */}
        <div style={{display:"grid",gridTemplateColumns:repeats.length>0&&(unusualNames.length>0||outsized.length>0)?"1fr 1fr":"1fr",gap:12}}>

          {/* Repeat Flow */}
          {repeats.length>0 && (
            <div style={{background:C.bg3,borderRadius:6,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:C.tx3,
                textTransform:"uppercase",marginBottom:8}}>🔄 Repeat Flow</div>
              {repeats.slice(0,7).map(t=>{
                const pct = Math.round((t.days/days)*100);
                return (
                  <div key={t.t} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",
                    borderBottom:`1px solid ${C.bdr}22`}}>
                    <span style={{fontFamily:"'Instrument Sans',sans-serif",fontWeight:700,fontSize:12,
                      color:CAT_COLORS[t.cat]||C.tx,minWidth:50}}>{t.t}</span>
                    {/* Frequency bar */}
                    <div style={{flex:1,height:4,background:C.bdr,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:pct+"%",height:"100%",borderRadius:2,
                        background:pct>=90?C.green:pct>=70?C.amber:C.tx3,opacity:0.7}}/>
                    </div>
                    <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans',sans-serif",
                      minWidth:44,textAlign:"right"}}>{t.days}/{days}d</span>
                  </div>
                );
              })}
              {repeats.length>7 && <div style={{fontSize:10,color:C.tx3,marginTop:4}}>+{repeats.length-7} more</div>}
            </div>
          )}

          {/* Unusual + Outsized merged */}
          {(unusualNames.length>0||outsized.length>0) && (
            <div style={{background:C.bg3,borderRadius:6,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:C.tx3,
                textTransform:"uppercase",marginBottom:8}}>🔍 Unusual Activity</div>
              {/* Merge and dedupe unusual names + outsized prints, sort by notional */}
              {(()=>{
                const seen = new Set();
                const merged = [];
                for (const t of [...unusualNames, ...outsized]) {
                  if (!seen.has(t.t)) { seen.add(t.t); merged.push(t); }
                }
                merged.sort((a,b) => b.bigPrintN - a.bigPrintN);
                return merged.slice(0,7).map(t => {
                  const hasVol = t.bigPrintPctAvgVol >= 30;
                  return (
                    <div key={t.t} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                      padding:"4px 0",borderBottom:`1px solid ${C.bdr}22`}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontFamily:"'Instrument Sans',sans-serif",fontWeight:700,fontSize:12,
                          color:CAT_COLORS[t.cat]||C.tx}}>{t.t}</span>
                        {t.accDist && <span style={{fontSize:8,padding:"1px 5px",borderRadius:4,fontWeight:700,
                          background:t.accDist==="Acc"?C.green+"18":C.red+"18",
                          color:t.accDist==="Acc"?C.green:C.red}}>{t.accDist}</span>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:10,fontWeight:600,color:C.cyan,
                          fontFamily:"'Instrument Sans',sans-serif"}}>{fmt(t.bigPrintN)}</span>
                        {hasVol && <span style={{fontSize:9,padding:"1px 6px",borderRadius:8,
                          background:C.purple+"18",color:C.purple,fontWeight:600,
                          border:`1px solid ${C.purple}33`}}>
                          {fmtAvgVol(t.bigPrintPctAvgVol)} vol
                        </span>}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* Flagged tickers — compact grid */}
        {flaggedAll.length>0 && (
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.bdr}`}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:C.tx3,
              textTransform:"uppercase",marginBottom:6}}>⚡ Flagged ({flaggedAll.length})</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {flaggedAll.slice(0,8).map(t=>(
                <div key={t.t} style={{display:"flex",alignItems:"center",gap:4,
                  padding:"3px 8px",borderRadius:6,background:C.bg3,
                  border:`1px solid ${C.bdr}`}}>
                  <span style={{fontWeight:700,fontSize:11,color:CAT_COLORS[t.cat]||C.tx}}>{t.t}</span>
                  <SignalBadges signals={t.signals} compact/>
                </div>
              ))}
              {flaggedAll.length>8 && <span style={{fontSize:10,color:C.tx3,alignSelf:"center"}}>+{flaggedAll.length-8}</span>}
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Zone Gauge ────────────────────────────────────────────── */}
      <ZoneGauge above={aboveN} inside={insideN} below={belowN}/>

      {/* ── Notable Activity + Biggest Prints (side by side) ─────── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,alignItems:"start"}}>

        {/* Notable Activity */}
        <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:6,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.12em",color:C.amber,
            textTransform:"uppercase",marginBottom:10}}>🔥 Notable Activity</div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"0 0 5px 0",
            borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
            <span style={{fontSize:9,color:C.tx3,fontWeight:600}}>Ticker</span>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:30,textAlign:"right"}}>Date</span>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:52,textAlign:"right"}}>Print $</span>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:48,textAlign:"right"}}>Notional</span>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:40,textAlign:"right"}}>% Move</span>
            </div>
          </div>
          {(()=>{
            const flagged=allItems.filter(i=>i.signals&&i.signals.length>0)
              .sort((a,b)=>b.signals.length-a.signals.length||b.bigPrintN-a.bigPrintN);
            if(flagged.length===0) return <div style={{fontSize:12,color:C.tx3}}>No signals for this period</div>;
            return flagged.slice(0,15).map(it=>{
              const cc=CAT_COLORS[it.cat]||C.tx;
              const bpPct=it.bigPrint>0?((it.last-it.bigPrint)/it.bigPrint*100):null;
              const bpColor=bpPct==null?C.tx3:bpPct>0?C.green:bpPct<0?C.red:C.tx3;
              return (
                <div key={it.t} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"4px 0",borderBottom:`1px solid ${C.bdr}22`}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
                    <span style={{fontWeight:700,fontSize:11,color:cc,minWidth:42}}>{it.t}</span>
                    {it.accDist && <span style={{fontSize:9,padding:"2px 6px",borderRadius:6,fontWeight:700,
                      background:it.accDist==="Acc"?C.green+"18":C.red+"18",
                      color:it.accDist==="Acc"?C.green:C.red}}>{it.accDist==="Acc"?"↑ Acc":"↓ Dist"}</span>}
                    <SignalBadges signals={it.signals} compact/>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                    <span style={{fontSize:9,color:C.tx3}}>{it.bigPrintDate||""}</span>
                    <span style={{fontSize:10,color:C.amber,minWidth:52,textAlign:"right"}}>{fP(it.bigPrint)}</span>
                    <span style={{fontSize:10,color:C.cyan,fontWeight:700,minWidth:48,textAlign:"right"}}>{fmt(it.bigPrintN)}</span>
                    <span style={{fontSize:10,fontWeight:700,color:bpColor,minWidth:40,textAlign:"right"}}>
                      {bpPct==null?"—":(bpPct>0?"+":"")+bpPct.toFixed(1)+"%"}
                    </span>
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* Biggest Prints */}
        <BiggestPrintsPanel/>
      </div>

      {/* ── Sector Rotation + Print Tracker ──────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,alignItems:"start"}}>

        {/* Sector Themes */}
        <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:6,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
            textTransform:"uppercase",marginBottom:10}}>Sector Rotation — Dark Pool Flow</div>
          {(D.themes||[]).slice(0,8).map(th=>{
            const maxN=Math.max(...(D.themes||[]).slice(0,8).map(t=>t.notional),1);
            const pct=Math.max((th.notional/maxN)*100,2);
            const lean=th.accCount>th.distCount?"Acc":th.accCount<th.distCount?"Dist":"—";
            const leanColor=lean==="Acc"?C.green:lean==="Dist"?C.red:C.tx3;
            const moveColor=th.avgBpMove>0?C.green:th.avgBpMove<0?C.red:C.tx3;
            return (
              <div key={th.sector} style={{marginBottom:7}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                  <span style={{fontSize:11,fontWeight:600,color:C.tx}}>{th.sector}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:9,color:C.tx3}}>{th.tickerCount} tickers</span>
                    <span style={{fontSize:9,padding:"2px 6px",borderRadius:6,fontWeight:700,
                      background:leanColor+"18",color:leanColor,border:`1px solid ${leanColor}33`}}>{lean}</span>
                    <span style={{fontSize:10,fontWeight:700,color:moveColor,fontFamily:"'Instrument Sans', sans-serif",minWidth:40,textAlign:"right"}}>
                      {th.avgBpMove>0?"+":""}{th.avgBpMove.toFixed(1)}%
                    </span>
                    <span style={{fontSize:10,fontWeight:700,color:C.cyan,fontFamily:"'Instrument Sans', sans-serif",minWidth:52,textAlign:"right"}}>
                      {fmt(th.notional)}
                    </span>
                  </div>
                </div>
                <div style={{width:"100%",height:4,background:C.bdr,borderRadius:2,overflow:"hidden"}}>
                  <div style={{width:pct+"%",height:"100%",background:leanColor,borderRadius:2,opacity:0.7,transition:"width 0.4s"}}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* Post-Print Tracker */}
        <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:6,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
            textTransform:"uppercase",marginBottom:10}}>Print Tracker — Where Are They Now?</div>
          {(()=>{
            const tracked = (D.allItems||allItems)
              .filter(i=>i.bigPrint>0 && i.bigPrintN>=50_000_000 && i.bigPrintDate)
              .sort((a,b)=>b.bigPrintN-a.bigPrintN)
              .slice(0,10);
            return tracked.map(it=>{
              const move=((it.last-it.bigPrint)/it.bigPrint*100);
              const moveColor=move>0.5?C.green:move<-0.5?C.red:C.tx3;
              const arrow=move>0.5?"↑":move<-0.5?"↓":"→";
              const cc=CAT_COLORS[it.cat]||C.tx;
              return (
                <div key={it.t} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"5px 0",borderBottom:`1px solid ${C.bdr}22`}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontFamily:"'Instrument Sans', sans-serif",fontWeight:700,fontSize:12,color:cc}}>{it.t}</span>
                    {it.accDist && <span style={{fontSize:9,padding:"2px 6px",borderRadius:6,fontWeight:700,
                      background:it.accDist==="Acc"?C.green+"18":C.red+"18",
                      color:it.accDist==="Acc"?C.green:C.red}}>{it.accDist==="Acc"?"↑ Acc":"↓ Dist"}</span>}
                    {it.sector && <span style={{fontSize:9,color:C.tx3}}>{it.sector}</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:10,color:C.tx3}}>{it.bigPrintDate}</span>
                    <span style={{fontSize:10,color:C.amber,fontFamily:"'Instrument Sans', sans-serif"}}>{fP(it.bigPrint)}</span>
                    <span style={{fontSize:14,color:moveColor,fontWeight:800}}>{arrow}</span>
                    <span style={{fontSize:10,color:C.tx,fontFamily:"'Instrument Sans', sans-serif"}}>{fP(it.last)}</span>
                    <span style={{fontSize:11,fontWeight:700,color:moveColor,fontFamily:"'Instrument Sans', sans-serif",minWidth:48,textAlign:"right"}}>
                      {move>0?"+":""}{move.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            });
          })()}
        </div>

      </div>
    </div>
  );
}

// ── Above / Below tabs ───────────────────────────────────────────────────────
function AbovePane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.green,marginBottom:4}}>
          ▲ Trading Above Dark Pool Zone <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.above.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3,lineHeight:1.5}}>
          Closed <b style={{color:C.green}}>above</b> the 25th–75th percentile institutional execution range.
          Sorted by % distance above zone. Bullish momentum signal.
        </div>
      </div>
      <FlowTable items={[...D.above].sort((a,b)=>b.pct-a.pct)}/>
    </div>
  );
}

function BelowPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.red,marginBottom:4}}>
          ▼ Trading Below Dark Pool Zone <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.below.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3,lineHeight:1.5}}>
          Closed <b style={{color:C.red}}>below</b> the institutional execution range.
          Sorted by % distance below zone. Bearish pressure signal.
        </div>
      </div>
      <FlowTable items={[...D.below].sort((a,b)=>a.pct-b.pct)}/>
    </div>
  );
}

// ── Unusual Flow tab ─────────────────────────────────────────────────────────
function UnusualPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.amber,marginBottom:4}}>
          Unusual Flow Activity <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.unusual.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Tickers with UOA flag — unusual options/dark pool activity relative to historical norms.
        </div>
      </div>
      <FlowTable items={D.unusual}/>
    </div>
  );
}

// ── Phantom Prints tab ───────────────────────────────────────────────────────
function PhantomPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.purple,marginBottom:4}}>
          Phantom Prints <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.phantom.length} entries)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Dark pool prints where the execution price deviated significantly from the concurrent spot price.
          May indicate delayed reporting or unusual block structures.
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              <TH>Ticker</TH>
              <TH>Date</TH>
              <TH>DP Price</TH>
              <TH>Spot Price</TH>
              <TH>Deviation</TH>
              <TH>Volume</TH>
            </tr>
          </thead>
          <tbody>
            {D.phantom.map((p,i)=>{
              const dev=((p.dpPrice-p.spotPrice)/p.spotPrice*100);
              const devColor=dev>0?C.green:C.red;
              return (
                <tr key={i} style={{background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.bgH}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <TD><TickerPopup sym={p.ticker}><span style={{color:C.blue,fontWeight:700,fontFamily:"'Instrument Sans', sans-serif"}}>
                    ${p.ticker}</span></TickerPopup></TD>
                  <TD style={{color:C.tx2,fontFamily:"'Instrument Sans', sans-serif"}}>{p.date}</TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:C.tx}}>
                    {fP(p.dpPrice)}</TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:C.tx2}}>
                    {fP(p.spotPrice)}</TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:devColor,fontWeight:700}}>
                    {dev>0?"+":""}{dev.toFixed(2)}%</TD>
                  <TD style={{color:C.tx3,fontFamily:"'Instrument Sans', sans-serif"}}>
                    {p.volume||"—"}</TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Options Flow tab ─────────────────────────────────────────────────────────
function OptionsPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.pink,marginBottom:4}}>
          Options Flow <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.options.length} alerts)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Notable options activity flagged alongside dark pool data. Repeater, Roulette, Large, and Steady flow types.
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              <TH>Date</TH>
              <TH>Ticker</TH>
              <TH>Price</TH>
              <TH>Alert</TH>
              <TH>Direction</TH>
            </tr>
          </thead>
          <tbody>
            {D.options.map((o,i)=>{
              const isBull=o.message.includes("Bullish");
              const isBear=o.message.includes("Bearish");
              const dirColor=isBull?C.green:isBear?C.red:C.tx2;
              const dir=isBull?"BULL":isBear?"BEAR":"NEUTRAL";
              return (
                <tr key={i} style={{background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.bgH}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <TD style={{color:C.tx3,fontFamily:"'Instrument Sans', sans-serif"}}>{o.date}</TD>
                  <TD><TickerPopup sym={o.ticker}><span style={{color:C.pink,fontWeight:700,fontFamily:"'Instrument Sans', sans-serif"}}>
                    ${o.ticker}</span></TickerPopup></TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:C.tx2}}>{fP(o.price)}</TD>
                  <TD style={{color:C.tx,fontSize:11,maxWidth:380}}>{o.message}</TD>
                  <TD><span style={{color:dirColor,fontWeight:700,fontSize:11,
                    background:dirColor+"18",padding:"2px 8px",borderRadius:10}}>{dir}</span></TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Signals + Search tab ─────────────────────────────────────────────────────
// ── Search Modal ──────────────────────────────────────────────────────────────
// ── Search Results Table — shows ticker row + top 5 prints expanded ───────────
function SearchResultsTable({items}){
  if(!items||items.length===0) return null;
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead>
          <tr>
            <TH>Ticker</TH>
            <TH>Category</TH>
            <TH>Last</TH>
            <TH>DP Zone</TH>
            <TH>Big Print</TH>
            <TH>% Move</TH>
            <TH>Notional</TH>
            <TH>Trades</TH>
            <TH>Days</TH>
          </tr>
        </thead>
        <tbody>
          {items.map(it=>{
            const cc=CAT_COLORS[it.cat]||C.tx;
            const bpPct = it.bigPrint>0 ? ((it.last-it.bigPrint)/it.bigPrint*100) : null;
            const bpMoveColor = bpPct==null ? C.tx3 : bpPct>0 ? C.green : bpPct<0 ? C.red : C.tx3;
            return (
              <>
                {/* Main ticker row */}
                <tr key={it.t} style={{background:C.bgH}}>
                  <TD><TickerCell it={it} catColor={cc}/></TD>
                  <TD><CatPill cat={it.cat}/></TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:zC(it.last,it.lo,it.hi)}}>
                    {fP(it.last)}
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:C.tx2,fontSize:11}}>
                    {fP(it.lo)}<span style={{color:C.tx3,margin:"0 3px"}}>–</span>{fP(it.hi)}
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11}}>
                    <BigPrintCell it={it}/>
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",fontWeight:700,color:bpMoveColor}}>
                    {bpPct==null?"—":(bpPct>0?"+":"")+bpPct.toFixed(2)+"%"}
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans', sans-serif",color:C.cyan,fontWeight:600}}>
                    {fmt(it.n)}
                  </TD>
                  <TD style={{color:C.tx2,fontFamily:"'Instrument Sans', sans-serif"}}>{it.c}</TD>
                  <TD style={{color:C.tx3,fontFamily:"'Instrument Sans', sans-serif"}}>{it.days}</TD>
                </tr>
                {/* Top 5 individual prints */}
                {it.top5&&it.top5.map((row,i)=>(
                  <tr key={it.t+"-print-"+i} style={{background:"transparent"}}>
                    <TD style={{paddingLeft:24,color:C.tx3,fontSize:10,fontFamily:"'Instrument Sans', sans-serif"}}>
                      #{i+1}
                    </TD>
                    <TD colSpan={8} style={{fontFamily:"'Instrument Sans', sans-serif",fontSize:11,
                      color:i===0?C.amber:C.tx2,padding:"4px 8px",
                      borderBottom:i===it.top5.length-1?`1px solid ${C.bdr2}`:"none"}}>
                      {row}
                    </TD>
                  </tr>
                ))}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchModal({onClose}){
  const [query,setQuery]=useState("");
  const allItems = (()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) map[it.t]=it;
    for(const it of D.above) map[it.t]=it;
    for(const it of D.below) map[it.t]=it;
    for(const it of D.unusual) map[it.t]=it;
    return Object.values(map);
  })();
  const top5 = useMemo(()=>allItems.slice().sort((a,b)=>b.n-a.n).slice(0,20),[allItems]);
  const results = useMemo(()=>{
    if(!query||query.length<1) return [];
    const q=query.toUpperCase().replace(/\$|\s/g,"");
    return allItems.filter(it=>it.t.includes(q)).slice(0,10);
  },[query,allItems]);

  // Close on Escape
  useEffect(()=>{
    const handler=e=>{ if(e.key==="Escape") onClose(); };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[onClose]);

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"flex-start",
      justifyContent:"center",paddingTop:80}}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      {/* Backdrop */}
      <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.7)"}}/>
      {/* Modal */}
      <div style={{position:"relative",width:"90%",maxWidth:900,background:C.bg2,
        border:`1px solid ${C.bdr2}`,borderRadius:10,boxShadow:"0 8px 40px #000000aa",
        padding:"24px 28px",maxHeight:"80vh",overflowY:"auto"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
          <span style={{fontSize:16,fontWeight:700,color:C.tx}}>Ticker Search</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.tx2,
            fontSize:20,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>&times;</button>
        </div>
        {/* Input */}
        <input
          autoFocus
          value={query}
          onChange={e=>setQuery(e.target.value)}
          placeholder="Search any ticker (e.g. NVDA, SPY...)"
          style={{width:"100%",padding:"10px 16px",borderRadius:6,
            border:`1px solid ${C.bdr2}`,background:C.bg3,color:C.tx,fontSize:14,
            fontFamily:"'Instrument Sans', sans-serif",outline:"none",
            boxSizing:"border-box",marginBottom:16}}
        />
        {query.length>0 && (
          <div style={{color:C.tx3,fontSize:11,marginBottom:10}}>
            {results.length} result{results.length!==1?"s":""} for "{query.toUpperCase()}"
          </div>
        )}
        {results.length>0 && <SearchResultsTable items={results}/>}
        {query.length>0 && results.length===0 && (
          <div style={{color:C.tx3,fontSize:13}}>No tickers found.</div>
        )}
        {query.length===0 && (
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",color:C.tx3,
              textTransform:"uppercase",marginBottom:10}}>Top 20 by Notional</div>
            <FlowTable items={top5} showZone={true}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS=[
  {id:"overview",label:"Overview"},
  {id:"category",label:"By Category"},
  {id:"above",label:"▲ Above Zone"},
  {id:"below",label:"▼ Below Zone"},
  {id:"unusual",label:"Unusual Flow"},
  {id:"phantom",label:"Phantom Prints"},
  {id:"options",label:"Options Flow"},
];

// ── CSV Processing Engine ─────────────────────────────────────────────────────

const INDEXES = new Set(["SPY","QQQ","IWM","DIA","MDY","RSP","OEF","ONEQ","TQQQ","SQQQ","SPXU","SPXS","UPRO","SH","PSQ","QID","UVXY","VXX","VIXY","SVXY","SOXS","SOXL","TNA","TZA","UDOW","SDOW","SPXL","ERX","ERY"]);

const SECTOR_ETFS = new Set(["XLF","XLE","XLK","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GDX","GDXJ","KRE","KBE","XOP","OIH","XBI","IBB","ARKG","ARKK","ARKW","ARKQ","ARKF","ARKVV","SMH","SOXX","HACK","CIBR","FINX","CLOU","BOTZ","ROBO","WCLD","BUG","SKYY","AIQ","KBWB","KIE","IAI","IYF","PNQI","FDN","IPAY","EMQQ","KOMP","LOUP","DTEC","JETS","AIRR","MOO","SOIL","CROP","WEED","MSOS","POTX","MJ","BITO","BLOK","BITQ","IBIT","FBTC","GBTC","HODL","BTCO","EZBC","BTCW","DEFI","XME","PICK","SLX","REMX","LIT","BATT","DRIV","IDRV","KARS","VNQ","SCHH","ICF","REM","MORT","HOMZ","XHB","ITB","PKB","REZ","PHO","CGW","FIW","FWAT","RXL","BBH","PJP","XPH","SBIO","LABD","LABU","TAN","FAN","ICLN","QCLN","ACES","PBD","SMOG","IAT","KBWR","DPST","FAS","FAZ","SKF","UYG","CURE","RXD","MTUM","VLUE","QUAL","USMV","SIZE","IWF","IWD","IWB","IWR","IWS","VTV","VUG","VO","VB","VBR","VBK","MGC","MGK","MGV","ESGU","ESGD","ESGE","DSI","SDGA"]);

const BOND_ETFS = new Set(["TLT","IEF","SHY","IEI","SHV","GOVT","TBT","TMF","TBF","TTT","UBT","PST","AGG","BND","SCHZ","IUSB","SPAB","BOND","LQD","VCIT","IGIB","SPSB","VCSH","IGSB","FLOT","SJNK","BSCN","BSCO","HYG","JNK","FALN","PHB","HYLB","USHY","SHYG","HYEM","BSJN","BSJO","BSJP","EMB","VWOB","PCY","LEMB","ELD","EBND","MUB","TFI","CMF","ITM","PZA","VTEB","MUNI","SUB","HYD","SHYD","TIP","SCHP","STIP","VTIP","RINF","WIP","BWX","BNDX","IGOV","ISHG","PICB","BIL","GBIL","SGOV","CLTL","VGSH","SCHO","FTSM","LQDH","HYGH","IGBH","TOTB","BNDW","PFFD","FPE","IPFF","PFF","PRFD","MINT","NEAR","ICSH","GSY","JPST","PULS","FLRN"]);

const INTL_EM_ETFS = new Set(["EEM","EFA","VEA","VWO","IEMG","ACWI","ACWX","VXUS","VT","FXI","ASHR","MCHI","KWEB","CQQQ","CHIQ","HAO","GXC","KURE","PGJ","EWJ","DBJP","HEWJ","DXJ","EWZ","EWW","EWC","EWY","EWG","EWH","EWT","EWS","EWU","EWA","EWI","EWP","EWQ","EWD","EWN","EWK","EWL","EWO","EIS","INDA","INDY","PIN","EPI","SMIN","VGK","IEV","FEZ","HEDJ","EZU","EURL","RSX","ERUS","RUSL","RUSS","ENZL","EWM","ECH","EPHE","EIDO","TUR","EPOL","ARGT","EZA","AFK","FM","GAF","EMXC","XSOE","DFAE","DFEM","AVEM","GEM","GMF","SPEM","HEFA","DBEF","DEEF","HEEM"]);

const COMMODITY_ETFS = new Set(["GLD","IAU","GLDM","BAR","SGOL","PHYS","AAAU","BGLD","SLV","SIVR","PSLV","DSLV","USLV","USO","UCO","SCO","DBO","OIL","OILU","OILD","UNG","BOIL","KOLD","GAZ","FCG","PDBC","DJP","USCI","COMB","COM","GSG","DBC","RJI","MLPA","DBA","WEAT","CORN","SOYB","CANE","NIB","JO","BAL","COW","TAGS","CPER","COPX","CULL","PALL","PPLT","GLTR","WOOD","NLR","URA","URNM","HURA","LNG","MLPX","AMLP","AMJ","AMJB","ENFR","TPVG","MLPQ"]);

const LARGE_CAP_KNOWN = new Set(["AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","LLY","UNH","JPM","V","XOM","MA","PG","COST","HD","JNJ","MRK","CVX","ABBV","PEP","KO","BAC","WFC","NFLX","ORCL","CRM","AMD","INTC","MU","QCOM","NOW","ADBE","ACN","TXN","IBM","GS","MS","BLK","AMGN","GILD","REGN","VRTX","TMO","DHR","ABT","MDT","SYK","BMY","PFE","CI","ISRG","ELV","CVS","UNP","HON","RTX","LMT","NOC","BA","CAT","DE","GE","ETN","EMR","WM","RSG","ADP","PAYX","T","VZ","CMCSA","DIS","SBUX","MCD","BKNG","MAR","HLT","NKE","TGT","WMT","PYPL","UBER","ABNB","PLTR","DDOG","NET","CRWD","ZS","PANW","FTNT","SNOW","TEAM","WDAY","VEEV","TWLO","MDB","OKTA","DOCU","ZM","COIN","MSTR","HOOD","SOFI","NU","AFRM","SQ","SHOP","SPOT","PINS","SNAP","ROKU","TTD","RBLX","LYFT","DASH","RIVN","LCID","F","GM","STLA","NIO","LI","XPEV","ENPH","PLUG","NEE","FSLR","OXY","MPC","VLO","PSX","HES","DVN","COP","MRO","SLB","HAL","BKR","FCX","NEM","GOLD","WPM","UPS","FDX","DAL","UAL","AAL","LUV","CCL","NCLH","RCL","BX","KKR","APO","ARES","CME","ICE","CBOE","SPGI","MCO","USB","PNC","TFC","COF","DFS","SYF","AXP","SCHW","ALB","MP","TMUS","AMT","CCI","PSA","IRM","PLD","O","SPG","AWK","NEE","PCG","BRK.B","BRK.A","MKL","CAVA","CMG","TSCO","CHWY"]);

const CAT_ORDER = ["Indexes","Large Cap","Mid Cap","Small Cap","Sector ETFs","Bond ETFs","Intl/EM ETFs","Commodity ETFs"];
const CAT_DESC = {
  "Indexes":        "Major U.S. broad-market index ETFs and leveraged derivatives",
  "Large Cap":      "S&P 500 and mega-cap individual equities",
  "Mid Cap":        "S&P 400 mid-cap and Russell 1000 individual equities",
  "Small Cap":      "Russell 2000 and smaller individual equities",
  "Sector ETFs":    "Sector, thematic, and factor-based domestic ETFs",
  "Bond ETFs":      "Fixed income ETFs across duration and credit spectrum",
  "Intl/EM ETFs":   "International developed and emerging market ETFs",
  "Commodity ETFs": "Commodity ETFs including gold, oil, and natural resources",
};

function classifyTicker(tk, totalNotional, numDates){
  const t = tk.toUpperCase();
  if(INDEXES.has(t)) return "Indexes";
  if(SECTOR_ETFS.has(t)) return "Sector ETFs";
  if(BOND_ETFS.has(t)) return "Bond ETFs";
  if(INTL_EM_ETFS.has(t)) return "Intl/EM ETFs";
  if(COMMODITY_ETFS.has(t)) return "Commodity ETFs";
  const avgDaily = totalNotional / Math.max(numDates, 1);
  if(LARGE_CAP_KNOWN.has(t) || avgDaily >= 50_000_000) return "Large Cap";
  if(avgDaily >= 5_000_000) return "Mid Cap";
  return "Small Cap";
}

function weightedPercentile(prices, weights, pct){
  if(!prices.length) return null;
  const combined = prices.map((p,i)=>({p, w:weights[i]})).sort((a,b)=>a.p-b.p);
  const totalW = combined.reduce((s,x)=>s+x.w, 0);
  const target = (pct/100)*totalW;
  let cumsum = 0;
  for(const {p,w} of combined){
    cumsum += w;
    if(cumsum >= target) return Math.round(p*100)/100;
  }
  return Math.round(combined[combined.length-1].p*100)/100;
}

function fmtDateKey(d){ return d.toISOString().slice(0,10); }
function fmtLabel(d){ return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
function fmtShort(d){ return (d.getMonth()+1).toString().padStart(2,"0")+"/"+(d.getDate()).toString().padStart(2,"0"); }
function fmtN(n){ return n>=1e9?"$"+(n/1e9).toFixed(1)+"B":n>=1e6?"$"+(n/1e6).toFixed(0)+"M":"$"+(n/1e3).toFixed(0)+"K"; }

function parseCSVtoD(rows){
  // Parse & sort by date/time
  const parseDate = s => { const [m,d,y]=s.split("/"); return new Date(+y,+m-1,+d); };

  // Collect unique trading dates
  const seenDates = new Set();
  const allDatesMap = {};
  for(const r of rows){
    if(!r.Date) continue;
    try{ const d=parseDate(r.Date); const k=fmtDateKey(d); if(!seenDates.has(k)){seenDates.add(k);allDatesMap[k]=d;} }catch(e){}
  }
  const allDates = Object.keys(allDatesMap).sort().map(k=>allDatesMap[k]);
  const numDates = allDates.length;
  const dateIndex = {};
  allDates.forEach((d,i)=>{ dateIndex[fmtDateKey(d)]=i; });

  // Categorise rows
  const tradeRows=[], phantomRows=[], cancelledRows=[], optionsList=[], alphaList=[];
  const uoaTickers = new Set();

  for(const r of rows){
    const type = (r.Type||"").trim();
    const msg  = (r.Message||"").trim();
    const tk   = (r.Ticker||"").trim();
    if(!tk) continue;

    if(type==="AlphaGold"){
      try{ alphaList.push({ticker:tk, price:parseFloat(r.Price)||0, date:fmtShort(parseDate(r.Date))}); }catch(e){}
      continue;
    }
    if(type==="Options"){
      try{ optionsList.push({ticker:tk, price:parseFloat(r.Price)||0, message:msg, date:fmtShort(parseDate(r.Date))}); }catch(e){}
      continue;
    }
    if(type==="DarkPool"){ uoaTickers.add(tk); continue; }
    if(type!=="Block") continue;

    if(msg.startsWith("Cancelled")){
      try{ cancelledRows.push({ticker:tk, price:parseFloat(r.Price)||0, notional:parseFloat(r.Notional)||0, message:msg, date:fmtShort(parseDate(r.Date))}); }catch(e){}
      continue;
    }
    if(msg.startsWith("Phantom Print")){
      const spotM=msg.match(/Spot:\s*\$([0-9.]+)/);
      const volM=msg.match(/Volume:\s*(\d+)/);
      try{ phantomRows.push({ticker:tk, date:fmtShort(parseDate(r.Date)), dpPrice:parseFloat(r.Price)||0, spotPrice:spotM?parseFloat(spotM[1]):0, volume:volM?volM[1]:"0"}); }catch(e){}
      continue;
    }

    // Regular block trade
    try{
      const price=parseFloat(r.Price);
      const notional=parseFloat(r.Notional);
      if(!price||!notional||price<=0||notional<=0) continue;
      const d=parseDate(r.Date);
      const avg30=parseFloat(r.Avg30Day)||0;
      const avgVolM = msg.match(/([0-9.]+)%\s*AvgVol/);
      const pctAvgVol = avgVolM ? parseFloat(avgVolM[1]) : 0;
      const industry = (r.Industry||"").trim();
      const sector = (r.Sector||"").trim();
      tradeRows.push({ticker:tk, dateKey:fmtDateKey(d), price, notional, message:msg, avg30, pctAvgVol, industry, sector});
    }catch(e){}
  }

  // Aggregate per ticker
  const tickerTrades={};  // tk → [{price,notional,dateKey}]
  const tickerDaily={};   // tk → {dateKey → {notional,volNotional,count}}
  const tickerAvg30={};  // tk → avg 30-day volume (last seen value)
  const tickerIndustry={};// tk → industry (most common)
  const tickerSector={};  // tk → sector (most common)

  for(const tr of tradeRows){
    const {ticker:tk,dateKey:dk,price:p,notional:n,avg30,pctAvgVol,industry,sector}=tr;
    if(!tickerTrades[tk]) tickerTrades[tk]=[];
    tickerTrades[tk].push({p,n,dk,pctAvgVol});
    if(avg30>0) tickerAvg30[tk]=avg30;
    if(industry && !tickerIndustry[tk]) tickerIndustry[tk]=industry;
    if(sector && !tickerSector[tk]) tickerSector[tk]=sector;
    if(!tickerDaily[tk]) tickerDaily[tk]={};
    if(!tickerDaily[tk][dk]) tickerDaily[tk][dk]={notional:0,volNotional:0,count:0};
    tickerDaily[tk][dk].notional+=n;
    tickerDaily[tk][dk].volNotional+=p*n;
    tickerDaily[tk][dk].count+=1;
  }

  // Build items
  const itemsAll=[];
  for(const [tk,trades] of Object.entries(tickerTrades)){
    const allPrices=trades.map(t=>t.p);
    const allWeights=trades.map(t=>t.n);
    const totalN=allWeights.reduce((s,w)=>s+w,0);
    const vwap=Math.round((allPrices.reduce((s,p,i)=>s+p*allWeights[i],0)/totalN)*100)/100;

    let lo=weightedPercentile(allPrices,allWeights,25);
    let hi=weightedPercentile(allPrices,allWeights,75);
    if(lo===hi){ lo=Math.round(lo*0.995*100)/100; hi=Math.round(hi*1.005*100)/100; }

    const activeDays=tickerDaily[tk];
    const days=Object.keys(activeDays).length;
    const lastDayKey=Object.keys(activeDays).sort().at(-1);
    const ld=activeDays[lastDayKey];
    const last=ld.notional>0?Math.round(ld.volNotional/ld.notional*100)/100:vwap;

    let pos,pct;
    if(last>hi){ pos="above"; pct=Math.round((last-hi)/hi*100*100)/100; }
    else if(last<lo){ pos="below"; pct=Math.round((last-lo)/lo*100*100)/100; }
    else{ pos="inside"; const mid=(lo+hi)/2; pct=Math.round((last-mid)/mid*100*100)/100; }

    const maxDailyN=Math.max(...Object.values(activeDays).map(v=>v.notional),1);
    const pricesArr=[],wArr=[];
    for(const d of allDates){
      const dk=fmtDateKey(d);
      if(activeDays[dk]){
        const dd=activeDays[dk];
        pricesArr.push(Math.round(dd.volNotional/dd.notional*100)/100);
        wArr.push(Math.round(dd.notional/maxDailyN*1000)/1000);
      } else { pricesArr.push(null); wArr.push(null); }
    }

    const top5=[...trades].sort((a,b)=>b.n-a.n).slice(0,5).map(({p,n,dk})=>{
      try{ const d=new Date(dk+"T00:00:00"); return fmtShort(d)+" @ $"+p.toFixed(2)+"  "+fmtN(n); }catch(e){ return ""; }
    });

    // Largest single print by notional — the level to watch
    const sortedByN=[...trades].sort((a,b)=>b.n-a.n);
    const bigPrint = sortedByN[0] ? sortedByN[0].p : null;
    const bigPrintN = sortedByN[0] ? sortedByN[0].n : 0;
    const bigPrintDk = sortedByN[0] ? sortedByN[0].dk : null;
    const bigPrintDate = bigPrintDk ? (()=>{ try{ return fmtShort(new Date(bigPrintDk+"T00:00:00")); }catch(e){ return bigPrintDk; } })() : null;
    const bigPrintPctAvgVol = sortedByN[0] ? sortedByN[0].pctAvgVol : 0;

    const cat=classifyTicker(tk,totalN,numDates);
    const avg30=tickerAvg30[tk]||0;
    const industry=tickerIndustry[tk]||"";
    const sector=tickerSector[tk]||"";
    // Accumulation vs Distribution: big print above VWAP = Acc, below = Dist
    const accDist = bigPrint!=null && vwap>0 ? (bigPrint>=vwap?"Acc":"Dist") : null;
    itemsAll.push({t:tk,cat,n:Math.round(totalN),lo,hi,last,vwap,c:trades.length,days,pos,pct,u:uoaTickers.has(tk),prices:pricesArr,w:wArr,top5,bigPrint,bigPrintN,bigPrintDk,bigPrintDate,bigPrintPctAvgVol,avg30,industry,sector,accDist,signals:[]});
  }

  // ── Signal Detection (tight thresholds — only truly unusual prints) ─────────
  const sortedDateKeys = allDates.map(fmtDateKey);
  const last2Set = new Set(sortedDateKeys.slice(-2));
  const lastDateKey = sortedDateKeys[sortedDateKeys.length-1];

  for(const item of itemsAll){
    const signals=[];
    const tk=item.t;
    const trades=tickerTrades[tk]||[];
    const activeDays=tickerDaily[tk]||{};
    const activeDateKeys=Object.keys(activeDays).sort();

    // Daily max single print per day
    const dailyMax={};
    for(const tr of trades){ if(!dailyMax[tr.dk]||tr.n>dailyMax[tr.dk]) dailyMax[tr.dk]=tr.n; }

    // Recent biggest print (last 2 trading days) for this ticker
    const recentBiggest=Math.max(0,...Object.entries(dailyMax).filter(([dk])=>last2Set.has(dk)).map(([,n])=>n));

    // 1. YEARLY_RECORD — recent print is biggest this ticker has seen across ALL prior data
    const allPriorMax=Math.max(0,...Object.entries(dailyMax).filter(([dk])=>!last2Set.has(dk)).map(([,n])=>n));
    if(recentBiggest>=50_000_000 && allPriorMax>0 && recentBiggest>allPriorMax && activeDateKeys.length>=10){
      signals.push({type:"YEARLY_RECORD",icon:"👑",label:"Yearly Record",mult:+(recentBiggest/allPriorMax).toFixed(1)});
    }

    // 2. MONTHLY_RECORD — recent print is biggest in last 20 trading days (but not yearly record)
    const last20Set=new Set(sortedDateKeys.slice(-20));
    const prior20Set=new Set(sortedDateKeys.slice(0,Math.max(0,sortedDateKeys.length-2)).filter(dk=>last20Set.has(dk)));
    const monthly20Max=Math.max(0,...Object.entries(dailyMax).filter(([dk])=>prior20Set.has(dk)).map(([,n])=>n));
    if(recentBiggest>=50_000_000 && monthly20Max>0 && recentBiggest>monthly20Max
      && !signals.some(s=>s.type==="YEARLY_RECORD") && activeDateKeys.length>=5){
      signals.push({type:"MONTHLY_RECORD",icon:"🏆",label:"Monthly Record",mult:+(recentBiggest/monthly20Max).toFixed(1)});
    }

    // 3. NOTIONAL_SPIKE — last day's total notional ≥3× avg, min $100M last day
    const lastDayN=activeDays[lastDateKey]?.notional||0;
    const priorNots=activeDateKeys.filter(dk=>dk!==lastDateKey).map(dk=>activeDays[dk].notional);
    const avgPrior=priorNots.length>=3?priorNots.reduce((s,n)=>s+n,0)/priorNots.length:0;
    if(lastDayN>=100_000_000 && avgPrior>0 && lastDayN>=3*avgPrior){
      signals.push({type:"NOTIONAL_SPIKE",icon:"🔥",label:"Volume Surge",mult:+(lastDayN/avgPrior).toFixed(1)});
    }

    // 4. RARE_FLOW — only appeared in last 2 dates, dataset has 20+ dates
    const recentCount=activeDateKeys.filter(dk=>last2Set.has(dk)).length;
    const olderCount=activeDateKeys.filter(dk=>!last2Set.has(dk)).length;
    if(recentCount>0 && olderCount===0 && sortedDateKeys.length>=20 && item.bigPrintN>=20_000_000){
      signals.push({type:"RARE_FLOW",icon:"🆕",label:"New Flow"});
    }

    // 5. SIZE_ESCALATION — 4+ consecutive days, each ≥25% bigger than prior
    const recentDailyArr=sortedDateKeys.filter(dk=>dailyMax[dk]!=null).slice(-6).map(dk=>dailyMax[dk]);
    if(recentDailyArr.length>=4){
      let streak=1;
      for(let i=recentDailyArr.length-1;i>0;i--){
        if(recentDailyArr[i]>recentDailyArr[i-1]*1.25) streak++; else break;
      }
      if(streak>=4) signals.push({type:"SIZE_ESCALATION",icon:"⬆️",label:"Escalating",days:streak});
    }

    // 6. ZONE_BREAK_RECORD — outside zone + has record signal
    if(item.pos!=="inside" && signals.some(s=>s.type==="YEARLY_RECORD"||s.type==="MONTHLY_RECORD")){
      signals.push({type:"ZONE_BREAK_RECORD",icon:"💥",label:"Zone Break"});
    }

    item.signals=signals;
  }

  // Categories
  const catMap={};
  for(const item of itemsAll){
    if(!catMap[item.cat]) catMap[item.cat]=[];
    catMap[item.cat].push(item);
  }
  const categories=CAT_ORDER.map(cat=>{
    const items=(catMap[cat]||[]).sort((a,b)=>b.n-a.n);
    return {name:cat,desc:CAT_DESC[cat],totalNotional:items.reduce((s,i)=>s+i.n,0),count:items.length,items};
  });

  // Above/Below/Unusual
  const above=itemsAll.filter(i=>i.pos==="above").sort((a,b)=>b.pct-a.pct).slice(0,40);
  const below=itemsAll.filter(i=>i.pos==="below").sort((a,b)=>a.pct-b.pct).slice(0,40);
  const unusual=itemsAll.filter(i=>i.u).sort((a,b)=>b.n-a.n).slice(0,30);

  // Phantom dedup
  const seenPh=new Set();
  const phantomDeduped=[];
  for(const ph of phantomRows){
    const key=ph.ticker+"|"+ph.date+"|"+ph.dpPrice;
    if(!seenPh.has(key)){ seenPh.add(key); phantomDeduped.push(ph); }
  }
  phantomDeduped.sort((a,b)=>Math.abs(b.spotPrice-b.dpPrice)/Math.max(b.dpPrice,0.01)-Math.abs(a.spotPrice-a.dpPrice)/Math.max(a.dpPrice,0.01));
  const phantom=phantomDeduped.slice(0,15);

  // Options dedup (most recent first)
  const seenOpts=new Set();
  const optsDeduped=[];
  for(const o of [...optionsList].reverse()){
    const key=o.ticker+"|"+o.message;
    if(!seenOpts.has(key)){ seenOpts.add(key); optsDeduped.push(o); }
  }
  const options=optsDeduped.slice(0,25);

  // Alpha dedup
  const seenAlpha=new Set();
  const alphaDeduped=[];
  for(const a of [...alphaList].reverse()){
    if(!seenAlpha.has(a.ticker)){ seenAlpha.add(a.ticker); alphaDeduped.push(a); }
  }
  const alpha=alphaDeduped.slice(0,10);

  // Cancelled dedup
  const cancelledSorted=[...cancelledRows].sort((a,b)=>b.notional-a.notional);
  const seenCan=new Set();
  const cancelledDeduped=[];
  for(const c of cancelledSorted){
    const key=c.ticker+"|"+c.date+"|"+c.notional;
    if(!seenCan.has(key)){ seenCan.add(key); cancelledDeduped.push(c); }
  }
  const cancelled=cancelledDeduped.slice(0,15);

  // Meta
  const totalNotional=tradeRows.reduce((s,r)=>s+r.notional,0);
  const dateRange=allDates.length>=2?fmtLabel(allDates[0])+" – "+fmtLabel(allDates.at(-1))+", "+allDates.at(-1).getFullYear():"";

  // ── Thematic Clustering by Sector ──────────────────────────────────────────
  const sectorMap={};
  for(const item of itemsAll){
    const sec = item.sector || "Other";
    if(!sectorMap[sec]) sectorMap[sec]={sector:sec,notional:0,tickers:[],prints:0,avgMove:0};
    sectorMap[sec].notional+=item.n;
    sectorMap[sec].tickers.push(item.t);
    sectorMap[sec].prints+=item.c;
  }
  const themes=Object.values(sectorMap)
    .filter(s=>s.tickers.length>=2 && s.sector!=="Other" && s.sector!=="")
    .map(s=>{
      const items=itemsAll.filter(i=>i.sector===s.sector);
      const accCount=items.filter(i=>i.accDist==="Acc").length;
      const distCount=items.filter(i=>i.accDist==="Dist").length;
      const avgBpMove=items.filter(i=>i.bigPrint>0).reduce((sum,i)=>sum+((i.last-i.bigPrint)/i.bigPrint*100),0)/(items.filter(i=>i.bigPrint>0).length||1);
      return {...s,accCount,distCount,avgBpMove:Math.round(avgBpMove*100)/100,tickerCount:s.tickers.length};
    })
    .sort((a,b)=>b.notional-a.notional);

  return {
    dates:allDates.map(fmtDateKey),
    dateLabels:allDates.map(fmtLabel),
    meta:{
      generatedAt:new Date().toLocaleString(),
      dateRange,
      tradingDays:numDates,
      totalTrades:tradeRows.length,
      totalTickers:Object.keys(tickerTrades).length,
      totalNotional:Math.round(totalNotional),
    },
    categories, above, below, unusual, phantom, options, alpha, cancelled,
    allItems: itemsAll.sort((a,b)=>b.n-a.n),
    themes,
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────
const mdyToIso = (mdy) => {
  const p = mdy.split("/").map(Number);
  if (p.length < 3) return "";
  const y = p[2] < 100 ? p[2] + 2000 : p[2];
  return `${y}-${String(p[0]).padStart(2,"0")}-${String(p[1]).padStart(2,"0")}`;
};
const isoToDate = (iso) => { const p = iso.split("-").map(Number); return new Date(p[0], p[1]-1, p[2]); };
const mdyToDate = (mdy) => { const p = mdy.split("/").map(Number); const y = p.length>=3?(p[2]<100?p[2]+2000:p[2]):new Date().getFullYear(); return new Date(y, p[0]-1, p[1]||1); };
const fmtDatePill = (dateStr) => {
  const parts = dateStr.split("/").map(Number);
  const y = parts.length >= 3 ? (parts[2] < 100 ? parts[2] + 2000 : parts[2]) : new Date().getFullYear();
  const d = new Date(y, parts[0] - 1, parts[1] || 1);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return days[d.getDay()] + " " + parts[0] + "/" + (parts[1] || 1);
};

// ── App ───────────────────────────────────────────────────────────────────────
function DarkPool({embedded}){
  const [dpData,setDpData]=useState(null);
  const [loadErr,setLoadErr]=useState(null);
  const [loadStatus,setLoadStatus]=useState("Loading…");
  const [parsedRows,setParsedRows]=useState(null);

  // Date picker state (matches OptionsFlow pattern)
  const [dateFilter,setDateFilter]=useState("Last1");
  const [fetchDays,setFetchDays]=useState(1);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [showCal,setShowCal]=useState(false);
  const [calMonth,setCalMonth]=useState(new Date().getMonth());
  const [calYear,setCalYear]=useState(new Date().getFullYear());
  const [calStart,setCalStart]=useState(null);
  const calRef=useRef(null);
  const [csvLoading,setCsvLoading]=useState(true);

  const csvFile = fetchDays === 0
    ? (typeof API_BASE !== "undefined" ? API_BASE : "") + "/api/darkpool/data?all_data=true"
    : (typeof API_BASE !== "undefined" ? API_BASE : "") + `/api/darkpool/data?days=${fetchDays}`;

  // Extract unique dates from parsed rows
  const availableDates = useMemo(() => {
    if (!parsedRows || parsedRows.length === 0) return [];
    const dateSet = new Set();
    parsedRows.forEach(r => { if (r.Date) dateSet.add(r.Date.trim()); });
    return [...dateSet].sort((a, b) => {
      const pa = a.split("/").map(Number);
      const pb = b.split("/").map(Number);
      const ya = pa.length >= 3 ? (pa[2] < 100 ? pa[2] + 2000 : pa[2]) : new Date().getFullYear();
      const yb = pb.length >= 3 ? (pb[2] < 100 ? pb[2] + 2000 : pb[2]) : new Date().getFullYear();
      return new Date(ya, pa[0]-1, pa[1]||1) - new Date(yb, pb[0]-1, pb[1]||1);
    });
  }, [parsedRows]);

  const tradingDaysSet = useMemo(() => new Set(availableDates.map(d => mdyToIso(d))), [availableDates]);

  // Close calendar on click outside
  useEffect(() => {
    if (!showCal) return;
    const handler = (e) => { if (calRef.current && !calRef.current.contains(e.target)) setShowCal(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCal]);

  // Process data whenever parsedRows or dateFilter changes
  useEffect(() => {
    if (!parsedRows || parsedRows.length === 0) return;
    // Skip processing if a fetch is in-flight that will replace parsedRows.
    // Eliminates 1-4s wasted intermediate parseCSVtoD runs when user expands
    // the range. When the fetch completes, loadedFetchDays catches up to
    // fetchDays and processing fires once with fresh data.
    if (loadedFetchDays !== fetchDays) return;
    let filtered;
    if (dateFrom && dateTo) {
      const from = isoToDate(dateFrom);
      const to = isoToDate(dateTo);
      to.setHours(23,59,59);
      filtered = parsedRows.filter(r => {
        if (!r.Date) return false;
        const d = mdyToDate(r.Date.trim());
        return d >= from && d <= to;
      });
    } else if (dateFilter === "All") {
      filtered = parsedRows;
    } else if (dateFilter.startsWith("Last")) {
      const n = parseInt(dateFilter.replace("Last",""))||1;
      const recentDates = new Set(availableDates.slice(-n));
      filtered = parsedRows.filter(r => r.Date && recentDates.has(r.Date.trim()));
    } else {
      filtered = parsedRows.filter(r => r.Date && r.Date.trim() === dateFilter);
    }
    if (filtered.length === 0) { setDpData(null); return; }
    try {
      const d = parseCSVtoD(filtered);
      setDpData(d);
    } catch(err) {
      setLoadErr("Processing error: "+err.message);
    }
  }, [parsedRows, dateFilter, dateFrom, dateTo, loadedFetchDays, fetchDays]);

  // Fetch data from API
  useEffect(() => {
    // Capture fetchDays at fetch initiation so we can record what range this
    // fetch represents — see processing useEffect for the perf-fix rationale.
    const fetchDaysAtStart = fetchDays;
    let cancelled = false;
    setCsvLoading(true);
    setLoadErr(null);
    setLoadStatus("Fetching dark pool data…");

    function tryFetch(url) {
      return fetch(url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now())
        .then(r => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(text => {
          const trimmed = text.trim();
          if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) throw new Error("HTML");
          return text;
        });
    }

    // Try API first, fall back to static CSV
    tryFetch(csvFile)
      .catch(() => {
        setLoadStatus("API unavailable — loading static CSV…");
        return tryFetch((typeof API_BASE !== "undefined" ? API_BASE : "") + "/Darkpool-data.csv");
      })
      .then(text => {
        if (cancelled) return;
        setLoadStatus("Parsing…");
        setTimeout(() => {
          if (cancelled) return;
          try {
            const rows = parseCSV(text);
            if (!rows || rows.length === 0) throw new Error("No data returned");
            setParsedRows(rows);
            setLoadedFetchDays(fetchDaysAtStart);
            setCsvLoading(false);
          } catch(err) {
            if (!cancelled) { setLoadErr(err.message); setCsvLoading(false); setLoadedFetchDays(fetchDaysAtStart); }
          }
        }, 0);
      })
      .catch(e => { if (!cancelled) { setLoadErr("Could not load data from API or static CSV"); setCsvLoading(false); setLoadedFetchDays(fetchDaysAtStart); } });
    return () => { cancelled = true; };
  }, [csvFile]);




  const [tab,setTab]=useState("overview");
  const [catJump,setCatJump]=useState(null);
  const [showSearch,setShowSearch]=useState(false);

  function handleJumpTo(name){
    setCatJump(name);
    setTab("category");
  }

  if(loadErr) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:embedded?"40vh":"60vh",background:embedded?"transparent":C.bg,color:C.red,fontFamily:"'Instrument Sans', sans-serif",
      flexDirection:"column",gap:12,padding:20}}>
      <div style={{fontSize:20,fontWeight:700}}>⚠ Failed to load data</div>
      <div style={{fontSize:13,color:C.tx2}}>Attempted: <code style={{color:C.blue}}>{csvFile}</code></div>
      <div style={{fontSize:12,color:C.red,background:C.bg2,border:`1px solid ${C.red}44`,
        borderRadius:8,padding:"8px 16px",maxWidth:480,textAlign:"center"}}>
        {loadErr}
      </div>
      <div style={{fontSize:11,color:C.tx3}}>Check that darkpool_router is mounted and DB has data.</div>
    </div>
  );

  if(!dpData) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:embedded?"40vh":"100vh",background:embedded?"transparent":C.bg,color:C.blue,fontFamily:"'Instrument Sans', sans-serif",
      flexDirection:"column",gap:16}}>
      <div style={{width:40,height:40,border:`3px solid ${C.bdr}`,
        borderTop:`3px solid ${C.amber}`,borderRadius:"50%",
        animation:"spin 0.8s linear infinite"}}/>
      <div style={{fontSize:14,color:C.tx2}}>{loadStatus}</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  D = dpData;

  // Find index tickers by name (not array position)
  const spyItem = D.categories.find(c=>c.name==="Indexes")?.items.find(i=>i.t==="SPY");
  const qqqItem = D.categories.find(c=>c.name==="Indexes")?.items.find(i=>i.t==="QQQ");
  const iwmItem = D.categories.find(c=>c.name==="Indexes")?.items.find(i=>i.t==="IWM");

  return (
    <div style={{background:embedded?"transparent":C.bg,minHeight:embedded?"auto":"100vh",color:C.tx,
      fontFamily:"'Instrument Sans', system-ui, sans-serif",fontSize:13}}>
      {!embedded && <style>{`
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.bdr2};border-radius:3px}
        input:focus{border-color:${C.amber} !important}
      `}</style>}

      {/* Header */}
      <div style={{background:C.bg2,borderBottom:`1px solid ${C.bdr}`,padding:"12px 20px"}}>
        <div style={{maxWidth:1400,margin:"0 auto"}}>
        {/* Title row */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:C.green,
            boxShadow:`0 0 6px ${C.green}`,display:"inline-block",flexShrink:0}}/>
          <span style={{fontSize:18,fontWeight:800,color:C.tx,letterSpacing:"0.02em",
            fontFamily:"'Instrument Sans', system-ui, sans-serif"}}>DARK POOL SCANNER</span>
          <span style={{fontSize:11,color:C.tx3,marginLeft:4}}>
            · {D.meta?.tradingDays??""} trading days · {(D.meta?.totalTrades??0).toLocaleString()} block trades · {(D.meta?.totalTickers??0).toLocaleString()} tickers ·{" "}
            <span style={{color:C.cyan}}>{D.meta?.totalNotional?(D.meta.totalNotional>=1e12?`$${(D.meta.totalNotional/1e12).toFixed(2)}T`:`$${(D.meta.totalNotional/1e9).toFixed(0)}B`):"$0"} flow</span>
          </span>
        </div>
        {/* Zone cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:10}}>
          {[
            {label:`SPY ${D.meta?.tradingDays??30}-DAY ZONE`,item:spyItem},
            {label:`QQQ ${D.meta?.tradingDays??30}-DAY ZONE`,item:qqqItem},
            {label:`IWM ${D.meta?.tradingDays??30}-DAY ZONE`,item:iwmItem},
          ].filter(x=>x.item).map(({label,item})=>{
            const c=zC(item.last,item.lo,item.hi);
            return (
              <div key={label} style={{background:C.bg,border:`1px solid ${C.bdr}`,
                borderRadius:6,padding:"8px 14px"}}>
                <div style={{fontSize:9,color:C.tx3,fontWeight:700,letterSpacing:"0.05em",
                  textTransform:"uppercase",marginBottom:2}}>{label}</div>
                <div style={{fontSize:20,fontWeight:800,color:c,
                  fontFamily:"'Instrument Sans', sans-serif",lineHeight:1}}>{fP(item.last)}</div>
                <div style={{fontSize:10,color:C.tx3,marginTop:3}}>
                  Zone {fP(item.lo)} – {fP(item.hi)}
                </div>
              </div>
            );
          })}
          {/* Period card */}
          <div style={{background:C.bg,border:`1px solid ${C.bdr}`,borderRadius:6,
            padding:"8px 14px"}}>
            <div style={{fontSize:9,color:C.tx3,fontWeight:700,letterSpacing:"0.05em",
              textTransform:"uppercase",marginBottom:2}}>PERIOD</div>
            <div style={{fontSize:20,fontWeight:800,color:C.amber,
              fontFamily:"'Instrument Sans', sans-serif",lineHeight:1}}>{D.meta?.tradingDays??""} <span style={{fontSize:12}}>days</span></div>
            <div style={{fontSize:10,color:C.tx3,marginTop:3}}>{D.meta?.totalNotional?(D.meta.totalNotional>=1e12?`$${(D.meta.totalNotional/1e12).toFixed(2)}T`:`$${(D.meta.totalNotional/1e9).toFixed(0)}B`):"$0"} flow</div>
          </div>
        </div>
        </div>
      </div>

      {/* ── Date Picker Bar ──────────────────────────────────────── */}
      {availableDates.length > 0 && (
        <div style={{ display:"flex", justifyContent:"center", padding:"8px 20px", background:C.bg3, borderBottom:`1px solid ${C.bdr}` }}>
          <div style={{ maxWidth:1400, width:"100%", display:"flex", justifyContent:"center" }}>
          <div style={{ display:"flex", gap:4, alignItems:"center", background:C.bg2, borderRadius:6, padding:4, border:`1px solid ${C.bdr}`, flexWrap:"wrap", justifyContent:"center", position:"relative" }}>
            {[
              { key:"Last1", label:"1d", days:1 },
              { key:"Last5", label:"5d", days:5 },
              { key:"Last20", label:"20d", days:20 },
              { key:"Last60", label:"60d", days:60 },
              { key:"Last90", label:"90d", days:90 },
              { key:"All", label:"All", days:0 },
            ].map(({key, label, days}) => {
              const filterKey = days === 0 ? "All" : "Last" + days;
              const isActive = !dateFrom && !dateTo && dateFilter === filterKey;
              const needsFetch = days === 0 ? fetchDays !== 0 : days > fetchDays && fetchDays !== 0;
              return (
                <button key={key} onClick={()=>{
                  if (needsFetch) setFetchDays(days);
                  setDateFilter(filterKey);
                  setDateFrom(""); setDateTo(""); setShowCal(false); setCalStart(null);
                }} style={{
                  padding:"5px 12px", borderRadius:4, border:"none", cursor:"pointer",
                  fontSize:10, fontWeight:700, fontFamily:"inherit",
                  background:isActive?C.bg3:"transparent",
                  color:isActive?(key==="All"?C.amber:C.tx):C.tx2,
                  transition:"all 0.15s"
                }}>
                  {label}
                </button>
              );
            })}
            <span style={{ width:1, height:16, background:C.bdr }}/>
            <button onClick={()=>{
              if (!showCal) {
                const last = availableDates[availableDates.length-1];
                if (last) { const d = mdyToDate(last); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }
              }
              setShowCal(!showCal); setCalStart(null);
            }} style={{
              padding:"5px 12px", borderRadius:4, border:`1px solid ${dateFrom&&dateTo?C.amber:C.bdr}`,
              cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit",
              background:dateFrom&&dateTo?C.amber+"22":showCal?C.bg3:"transparent",
              color:dateFrom&&dateTo?C.amber:showCal?C.tx:C.tx2, transition:"all 0.15s"
            }}>
              {dateFrom && dateTo
                ? `${dateFrom.slice(5).replace("-","/")} → ${dateTo.slice(5).replace("-","/")}`
                : "📅 Dates"}
            </button>
            {dateFrom && dateTo && (
              <button onClick={()=>{ setDateFrom(""); setDateTo(""); setDateFilter("Last1"); setShowCal(false); setCalStart(null); }}
                style={{ background:"transparent", border:"none", color:C.tx3, cursor:"pointer", fontSize:12, fontFamily:"inherit", padding:"2px 4px" }}>✕</button>
            )}
            <span style={{ fontSize:9, color:C.tx3 }}>
              {csvLoading ? "Loading..." : dateFrom && dateTo
                ? (() => { const n = availableDates.filter(d => { const iso = mdyToIso(d); return iso >= dateFrom && iso <= dateTo; }).length; return n + " trading day" + (n!==1?"s":""); })()
                : (() => { const n = dateFilter.startsWith("Last") ? Math.min(parseInt(dateFilter.replace("Last",""))||1, availableDates.length) : availableDates.length; return n + " trading day" + (n!==1?"s":""); })()}
            </span>

            {/* Calendar dropdown */}
            {showCal && (
              <div ref={calRef} style={{
                position:"absolute", top:"100%", right:0, marginTop:6, zIndex:999,
                background:C.bg2, border:`1px solid ${C.bdr2}`, borderRadius:10, padding:14,
                boxShadow:"0 8px 32px rgba(0,0,0,0.6)", minWidth:290
              }}>
                <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
                  {[
                    { label:"Today", fn:()=>{ const d=availableDates[availableDates.length-1]; if(d){const iso=mdyToIso(d); setDateFrom(iso); setDateTo(iso); if(fetchDays!==0)setFetchDays(0); setShowCal(false);} }},
                    { label:"This Week", fn:()=>{ const last=availableDates[availableDates.length-1]; if(!last)return; const ld=mdyToDate(last); const mon=new Date(ld); mon.setDate(ld.getDate()-(ld.getDay()||7)+1); setDateFrom(mon.toISOString().slice(0,10)); setDateTo(mdyToIso(last)); if(fetchDays!==0)setFetchDays(0); setShowCal(false); }},
                    { label:"Last Week", fn:()=>{ const now=new Date(); const mon=new Date(now); mon.setDate(now.getDate()-(now.getDay()||7)+1-7); const fri=new Date(mon); fri.setDate(mon.getDate()+4); setDateFrom(mon.toISOString().slice(0,10)); setDateTo(fri.toISOString().slice(0,10)); if(fetchDays!==0)setFetchDays(0); setShowCal(false); }},
                    { label:"This Month", fn:()=>{ const now=new Date(); const f=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`; const last=availableDates[availableDates.length-1]; setDateFrom(f); setDateTo(last?mdyToIso(last):now.toISOString().slice(0,10)); if(fetchDays!==0)setFetchDays(0); setShowCal(false); }},
                    { label:"Last Month", fn:()=>{ const now=new Date(); const pm=new Date(now.getFullYear(), now.getMonth()-1, 1); const f=`${pm.getFullYear()}-${String(pm.getMonth()+1).padStart(2,"0")}-01`; const lm=new Date(pm.getFullYear(), pm.getMonth()+1, 0); const t=`${lm.getFullYear()}-${String(lm.getMonth()+1).padStart(2,"0")}-${String(lm.getDate()).padStart(2,"0")}`; setDateFrom(f); setDateTo(t); if(fetchDays!==0)setFetchDays(0); setShowCal(false); }},
                  ].map(p => (
                    <button key={p.label} onClick={p.fn} style={{
                      padding:"4px 10px", borderRadius:4, border:`1px solid ${C.bdr}`,
                      background:"transparent", color:C.tx2, fontSize:9, fontWeight:700,
                      cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s"
                    }}
                      onMouseEnter={e=>{e.target.style.background=C.bg3; e.target.style.color=C.tx;}}
                      onMouseLeave={e=>{e.target.style.background="transparent"; e.target.style.color=C.tx2;}}
                    >{p.label}</button>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <button onClick={()=>{ if(calMonth===0){setCalMonth(11);setCalYear(calYear-1);}else setCalMonth(calMonth-1); }}
                    style={{ background:"transparent", border:"none", color:C.tx2, cursor:"pointer", fontSize:14, fontFamily:"inherit", padding:"2px 8px" }}>◀</button>
                  <span style={{ fontSize:12, fontWeight:700, color:C.tx }}>
                    {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][calMonth]} {calYear}
                  </span>
                  <button onClick={()=>{ if(calMonth===11){setCalMonth(0);setCalYear(calYear+1);}else setCalMonth(calMonth+1); }}
                    style={{ background:"transparent", border:"none", color:C.tx2, cursor:"pointer", fontSize:14, fontFamily:"inherit", padding:"2px 8px" }}>▶</button>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, marginBottom:4 }}>
                  {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
                    <div key={d} style={{ textAlign:"center", fontSize:8, fontWeight:700, color:C.tx3, padding:2 }}>{d}</div>
                  ))}
                </div>
                {(()=>{
                  const firstDay = new Date(calYear, calMonth, 1).getDay();
                  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
                  const cells = [];
                  for (let i=0; i<firstDay; i++) cells.push(null);
                  for (let d=1; d<=daysInMonth; d++) cells.push(d);
                  while (cells.length%7!==0) cells.push(null);
                  return (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1 }}>
                      {cells.map((day, i) => {
                        if (!day) return <div key={i} style={{ padding:4 }}/>;
                        const iso = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                        const isTrading = tradingDaysSet.has(iso);
                        const isWeekend = new Date(calYear, calMonth, day).getDay()%6===0;
                        const isStart = dateFrom===iso;
                        const isEnd = dateTo===iso;
                        const inRange = dateFrom && dateTo && iso>=dateFrom && iso<=dateTo;
                        return (
                          <button key={i} onClick={()=>{
                            if (!calStart) {
                              setCalStart(iso); setDateFrom(iso); setDateTo("");
                            } else {
                              let from=calStart, to=iso;
                              if (iso < calStart) { from=iso; to=calStart; }
                              setDateFrom(from); setDateTo(to); setCalStart(null);
                              if (fetchDays!==0) setFetchDays(0);
                              setShowCal(false);
                            }
                          }} style={{
                            padding:0, borderRadius:4, border:"none", cursor:"pointer",
                            fontSize:10, fontWeight:isTrading?700:400, fontFamily:"inherit",
                            background: isStart||isEnd ? C.amber : inRange ? C.amber+"33" : "transparent",
                            color: isStart||isEnd ? C.bg : inRange ? C.amber : isTrading ? C.tx : isWeekend ? C.bdr : C.tx3+"88",
                            minWidth:32, minHeight:32, display:"flex", alignItems:"center", justifyContent:"center",
                            position:"relative", transition:"background 0.1s"
                          }}
                            onMouseEnter={e=>{ if(!inRange&&!isStart&&!isEnd) e.target.style.background=C.bg3; }}
                            onMouseLeave={e=>{ if(!inRange&&!isStart&&!isEnd) e.target.style.background="transparent"; }}
                          >
                            {day}
                            {isTrading && <span style={{ position:"absolute", bottom:2, left:"50%", transform:"translateX(-50%)", width:3, height:3, borderRadius:"50%", background:isStart||isEnd?C.bg:C.amber }}/>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                <div style={{ marginTop:8, fontSize:9, color:C.tx3, textAlign:"left", paddingLeft:12 }}>
                  {calStart && !dateTo ? "Click end date" : "Click to start selection"}
                  {" · "}<span style={{ color:C.amber }}>●</span> trading day
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{background:C.bg3,borderBottom:`1px solid ${C.bdr}`,padding:"0 20px"}}>
        <div style={{maxWidth:1400,margin:"0 auto",display:"flex",overflowX:"auto",gap:2,alignItems:"center"}}>
        {TABS.map(t=>{
          const on=t.id===tab;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:"10px 14px",background:"transparent",border:"none",
                borderBottom:on?`2px solid ${C.amber}`:"2px solid transparent",
                color:on?C.amber:C.tx2,fontWeight:on?700:400,fontSize:12,
                cursor:"pointer",whiteSpace:"nowrap",transition:"color 0.15s",
                fontFamily:"'Instrument Sans', system-ui, sans-serif"}}>
              {t.label}
            </button>
          );
        })}
        {/* Search button */}
        <button onClick={()=>setShowSearch(true)}
          style={{marginLeft:"auto",padding:"6px 14px",background:C.blue+"22",
            border:`1px solid ${C.blue}55`,borderRadius:6,color:C.blue,
            fontWeight:600,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",
            fontFamily:"'Instrument Sans', system-ui, sans-serif",transition:"all 0.15s",
            flexShrink:0}}>
          🔍 Search
        </button>
        </div>
      </div>

      {/* Content */}
      <div style={{padding:"14px 20px",maxWidth:1400,margin:"0 auto"}}>
        {tab==="overview" && <OverviewPane onJumpTo={handleJumpTo}/>}
        {tab==="category" && <CategoryPaneWrapper jump={catJump} onJumpDone={()=>setCatJump(null)}/>}
        {tab==="above"    && <AbovePane/>}
        {tab==="below"    && <BelowPane/>}
        {tab==="unusual"  && <UnusualPane/>}
        {tab==="phantom"  && <PhantomPane/>}
        {tab==="options"  && <OptionsPane/>}
      </div>

      {showSearch && <SearchModal onClose={()=>setShowSearch(false)}/>}
    </div>
  );
}

// Wrapper to handle jump-to-category
function CategoryPaneWrapper({jump,onJumpDone}){
  const [active,setActive]=useState(jump||D.categories[0].name);
  // If a new jump arrives, switch to it
  useMemo(()=>{ if(jump){ setActive(jump); onJumpDone(); } },[jump]);
  const cat=D.categories.find(c=>c.name===active)||D.categories[0];
  const color=CAT_COLORS[active]||C.tx;
  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
        {D.categories.map(c=>{
          const cc=CAT_COLORS[c.name]||C.tx;
          const isOn=c.name===active;
          return (
            <button key={c.name} onClick={()=>setActive(c.name)}
              style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${cc}${isOn?"":"33"}`,
                background:isOn?cc+"22":"transparent",color:isOn?cc:C.tx2,
                fontWeight:isOn?700:400,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
              {c.name}
            </button>
          );
        })}
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color,marginBottom:4}}>{cat.name}</div>
        <div style={{fontSize:12,color:C.tx2}}>{cat.desc}</div>
        <div style={{fontSize:12,color:C.tx3,marginTop:2}}>
          Total: <span style={{color:C.cyan,fontWeight:700}}>{fmt(cat.totalNotional)}</span>
          {" · "}{cat.count} tickers
        </div>
      </div>
      <FlowTable items={cat.items} showCat={false}/>
    </div>
  );
}
return DarkPool;
})();



const TABS = ["Market Read","Top Flow","Leaderboard","Search","OI Check","Tracker","Watchlist"];

export default function OptionsFlowDashboard() {
  const [dataMode, setDataMode] = useState("stocks"); // "stocks" | "index"
  const [tab, setTab] = useState("Market Read");
  const [top5Filter, setTop5Filter] = useState("Both");
  const [top5Detail, setTop5Detail] = useState(null);

  // ─── TradingView Chart modal (Market Read → Top 10 Flow Picks) ──────
  // Click "📈 Chart" on an expanded row to open the underlying ticker in a
  // TradingView widget. Daily / Weekly / Monthly only (per design call).
  const [chartModal, setChartModal] = useState(null);     // { sym: "NVDA" } | null
  const [chartInterval, setChartInterval] = useState("D"); // "D" | "W" | "M"
  const [chartModalSearch, setChartModalSearch] = useState("");
  // Dark pool overlay toggle — global setting persisted to localStorage so it
  // survives reloads. Parity with public file (no actual rendering yet since
  // admin uses a TradingView iframe stub for StockChart).
  const [showDarkPool, setShowDarkPool] = useState(() => {
    try {
      const saved = localStorage.getItem("uct_show_darkpool");
      return saved === null ? true : saved === "true";
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("uct_show_darkpool", String(showDarkPool)); } catch {}
  }, [showDarkPool]);
  const useDarkPoolBars = (sym, enabled) => {
    const [raw, setRaw] = useState(null);
    useEffect(() => {
      if (!enabled || !sym) { setRaw(null); return; }
      let cancelled = false;
      fetch(`${API_BASE}/api/darkpool/ticker-detail?sym=${encodeURIComponent(sym)}&days=180&limit=100`)
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (!cancelled) setRaw(j?.prints || j || []); })
        .catch(() => { if (!cancelled) setRaw([]); });
      return () => { cancelled = true; };
    }, [sym, enabled]);
    return useMemo(() => {
      if (!enabled || !raw) return [];
      const active = stripCancelledPrints(raw);
      return clusterDarkPoolPrintsForOverlay(active);
    }, [raw, enabled]);
  };
  const chartModalDarkPoolBars = useDarkPoolBars(chartModal?.sym, showDarkPool && !!chartModal);
  const [capFilter, setCapFilter] = useState("All"); // All | Mega | Large | Mid | Small
  // Flow Intelligence — exclude top-N concentration outliers from bull% calc.
  // 0 = include everything (default), 1 = drop top bull + top bear ticker,
  // 3 = drop top 3 each side. Lets the user see whether the headline bull/bear
  // bias is broad-based or carried by a handful of mega-trades.
  const [flowExcludeTop, setFlowExcludeTop] = useState(0); // 0 | 1 | 3


  const [cpFilter, setCpFilter] = useState("All"); // All | Calls | Puts
  const [convCpFilter, setConvCpFilter] = useState("All"); // independent C/P for CONV cards
  const [perf, setPerf] = useState([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchDte, setSearchDte] = useState("All");
  const [searchGroup, setSearchGroup] = useState(null); // {type:"theme"|"sector", name:"Semiconductors", tickers:["NVDA","AMD",...]}
  const [batchTickers, setBatchTickers] = useState("");
  const [batchResults, setBatchResults] = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchDetail, setBatchDetail] = useState(null);
  const [batchSort, setBatchSort] = useState("net");
  const [batchSortDir, setBatchSortDir] = useState("desc");
  const [convictionDte, setConvictionDte] = useState("All");
  const [convictionSort, setConvictionSort] = useState("net");
  const [convictionPct, setConvictionPct] = useState("All");
  const [convictionActivity, setConvictionActivity] = useState("All");
  const [convictionExpanded, setConvictionExpanded] = useState(null);
  const [oiSearch, setOiSearch] = useState("");
  const [oiSort, setOiSort] = useState({col:"doi", dir:"desc", col2:"premium", dir2:"desc"});
  const [leaderDte, setLeaderDte] = useState("All");
  const [selectedLeaderTicker, setSelectedLeaderTicker] = useState(null);
  const [sectorView, setSectorView] = useState("sectors"); // "sectors" | "themes"
  // ─── Leaders State ──────────────────────────────────────────────────
  const [leaders, setLeaders] = useState(() => {
    try { const saved = localStorage.getItem("uct_leaders"); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  const [leadersInput, setLeadersInput] = useState("");
  const saveLeaders = (list) => { setLeaders(list); try { localStorage.setItem("uct_leaders", JSON.stringify(list)); } catch {} };
  const addLeader = () => {
    const syms = leadersInput.toUpperCase().split(",").map(s=>s.trim()).filter(s=>s && !leaders.includes(s));
    if (syms.length) saveLeaders([...leaders, ...syms]);
    setLeadersInput("");
  };
  const removeLeader = (sym) => saveLeaders(leaders.filter(s=>s!==sym));
  const autoPopulateLeaders = () => {
    if (!D || !D.clean_confirmed) return;
    // Score by TOTAL clean institutional flow (bull + bear)
    const cc = capFilter==="All" ? (D.clean_confirmed||[]) : (D.clean_confirmed||[]).filter(t => capBand(t.mktcap)===capFilter);
    const tkMap = {};
    cc.forEach(t => {
      if (!t.S || t.S.length > 5) return;
      if (!tkMap[t.S]) tkMap[t.S] = { sym:t.S, bull:0, bear:0, n:0, mktcap:t.mktcap||0, uoa:false };
      if (t.D==="BULL") tkMap[t.S].bull += t.P;
      if (t.D==="BEAR") tkMap[t.S].bear += t.P;
      tkMap[t.S].n++;
      if (t.uoa) tkMap[t.S].uoa = true;
      if (t.mktcap > tkMap[t.S].mktcap) tkMap[t.S].mktcap = t.mktcap;
    });
    const scored = Object.values(tkMap).filter(tk => tk.bull + tk.bear > 0).map(tk => {
      const total = tk.bull + tk.bear;
      const cap = tk.mktcap || 1;
      const capMultiplier = cap >= 200e9 ? 1 : cap >= 10e9 ? 2.5 : 6;
      const adjTotal = total * capMultiplier;
      const tradeDensity = Math.min(tk.n / 10, 3);
      const uoaBonus = tk.uoa ? 1.3 : 1;
      const score = adjTotal * tradeDensity * uoaBonus;
      return { sym: tk.sym, score };
    }).sort((a, b) => b.score - a.score);
    const top25 = scored.slice(0, 25).map(t => t.sym);
    saveLeaders(top25);
  };
  const [leaderYtd, setLeaderYtd] = useState({});
  const [leaderOff52, setLeaderOff52] = useState({});
  const [leaderOI, setLeaderOI] = useState({});
  const [leaderSort, setLeaderSort] = useState({col:"net", dir:"desc"});
  const [leaderYtdLoading, setLeaderYtdLoading] = useState(false);
  const fetchLeaderYtd = async () => {
    if (!leaders.length) return;
    setLeaderYtdLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/schwab/ytd-performance?symbols=${leaders.join(",")}`);
      if (resp.ok) {
        const data = await resp.json();
        setLeaderYtd(data.ytd || {});
        setLeaderOff52(data.off52 || {});
        // Also fetch OI changes
        try {
          const oiResp = await fetch(`${API_BASE}/api/schwab/oi-change-batch?symbols=${leaders.join(",")}`);
          if (oiResp.ok) { const oiData = await oiResp.json(); setLeaderOI(oiData.oi_changes || {}); }
        } catch {}
      }
    } catch {}
    setLeaderYtdLoading(false);
  };
  const [tfDteFilter, setTfDteFilter] = useState("All");
  // Top Flow column sort. Default "score" = current behavior (conviction-ranked).
  // # column always shows score-rank regardless of active sort.
  const [tfSort, setTfSort] = useState({ col: "score", dir: "desc" });
  const [gexTicker, setGexTicker] = useState("SPY");
  const [gexInput, setGexInput] = useState("SPY");
  const [gexData, setGexData] = useState(null);
  const [gexLoading, setGexLoading] = useState(false);
  const [gexDte, setGexDte] = useState("all");
  const [showGexSummary, setShowGexSummary] = useState(false);
  const [showGexChart, setShowGexChart] = useState(false);
  const [gexChartRange, setGexChartRange] = useState("3mo");
  const [ideaGex, setIdeaGex] = useState(null); // { sym, data, loading } for Ideas popup
  const [ideaGexRange, setIdeaGexRange] = useState("3mo");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [selectedConv, setSelectedConv] = useState(null); // clicked Top Flow card index
  const [selectedItem, setSelectedItem] = useState(null); // {sym,cp,K,exp} clicked from any table/chart
  // Dark pool bars for renderDetailPanel — parity with public, no-op in admin
  // until StockChart migrates off the iframe stub.
  const selectedDetailDarkPoolBars = useDarkPoolBars(selectedItem?.sym, showDarkPool && !!selectedItem);
  const [priceCache, setPriceCache] = useState({}); // key: "SYM|CP|STRIKE|EXP" -> { mark, bid, ask, last, delta, theta, iv }
  const [earningsCache, setEarningsCache] = useState({});
  const [marketIndices, setMarketIndices] = useState(null);
  const [marketNarrative, setMarketNarrative] = useState(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  // ─── Contract History (Polygon backfill + daily tracker) ─────────────
  const [contractHistory, setContractHistory] = useState({});
  const fetchingRef = useRef(new Set());
  const backfilledRef = useRef(new Set());
  const convPanelRef = useRef(null);
  const gexChartRef = useRef(null);
  const gexChartObjRef = useRef(null);
  const ideaGexModalRef = useRef(null);
  const ideaGexDragRef = useRef({ dragging:false, startX:0, startY:0, offX:0, offY:0 });
  const prevNetDeltaRef = useRef(null);

  // ─── Admin: Drag-and-Drop CSV Upload ──────────────────────────────────
  const [csvText, setCsvText] = useState(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvError, setCsvError] = useState(null);
  const [dbStatus, setDbStatus] = useState(null); // {type:"ok"|"error", msg:string}

  // Upload CSV to backend DB for persistence
  async function uploadToDb(text) {
    const source = dataMode === "index" ? "indexes" : "stocks";
    setDbStatus({ type: "loading", msg: "Saving to database..." });
    try {
      const resp = await fetch(`${API_BASE}/api/flow/upload?source=${source}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        setDbStatus({ type: "error", msg: `DB error (${resp.status}): ${errText.slice(0, 200)}` });
        return;
      }
      const data = await resp.json();
      if (data.status === "ok") {
        setDbStatus({ type: "ok", msg: `DB: +${data.inserted.toLocaleString()} new rows, ${data.skipped.toLocaleString()} duplicates skipped${data.pruned ? `, ${data.pruned} expired pruned` : ""}` });
      } else {
        setDbStatus({ type: "error", msg: "DB error: " + (data.message || "unknown") });
      }
    } catch (e) {
      setDbStatus({ type: "error", msg: "DB upload failed: " + e.message });
    }
  }
  const [parsedRows, setParsedRows] = useState(null);
  const [dateFilter, setDateFilter] = useState("All");
  const [D, setD] = useState(null);

  const [dragOver, setDragOver] = useState(false);

  // Extract unique dates from parsed rows
  const availableDates = useMemo(() => {
    if (!parsedRows || parsedRows.length === 0) return [];
    const dateSet = new Set();
    parsedRows.forEach(r => { if (r.date) dateSet.add(r.date.trim()); });
    return [...dateSet].sort((a, b) => {
      const pa = a.split("/").map(Number);
      const pb = b.split("/").map(Number);
      const ya = pa.length >= 3 ? (pa[2] < 100 ? pa[2] + 2000 : pa[2]) : new Date().getFullYear();
      const yb = pb.length >= 3 ? (pb[2] < 100 ? pb[2] + 2000 : pb[2]) : new Date().getFullYear();
      const da = new Date(ya, pa[0] - 1, pa[1] || 1);
      const db = new Date(yb, pb[0] - 1, pb[1] || 1);
      return da - db;
    });
  }, [parsedRows]);

  const fmtDatePill = (dateStr) => {
    const parts = dateStr.split("/").map(Number);
    const y = parts.length >= 3 ? (parts[2] < 100 ? parts[2] + 2000 : parts[2]) : new Date().getFullYear();
    const d = new Date(y, parts[0] - 1, parts[1] || 1);
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return days[d.getDay()] + " " + parts[0] + "/" + (parts[1] || 1);
  };

  // Auto-set to latest date when CSV has many dates
  useEffect(() => {
    if (availableDates.length > 5 && dateFilter === "All") {
      setDateFilter(availableDates[availableDates.length - 1]);
    }
  }, [availableDates]);

  // Process data whenever parsedRows or dateFilter changes.
  // No fetch guard here — this component uses local CSV uploads, not fetches.
  useEffect(() => {
    if (!parsedRows || parsedRows.length === 0) return;
    let filtered;
    if (dateFilter === "All") {
      filtered = parsedRows;
    } else if (dateFilter.startsWith("Last")) {
      const n = parseInt(dateFilter.replace("Last",""))||3;
      const recentDates = new Set(availableDates.slice(-n));
      filtered = parsedRows.filter(r => r.date && recentDates.has(r.date.trim()));
    } else {
      filtered = parsedRows.filter(r => r.date && r.date.trim() === dateFilter);
    }
    if (filtered.length === 0) { setD(null); return; }
    try {
      const data = processFlowData(filtered);
      setD(data);
    } catch(err) {
      console.error("processFlowData error:", err);
      setCsvError(err.message);
    }
  }, [parsedRows, dateFilter]);

  function switchMode(m) {
    if (dataMode === m) return;
    // Only reset flow data when switching between stocks ↔ index (csvFile changes)
    const wasFlow = dataMode === "stocks" || dataMode === "index";
    const toFlow = m === "stocks" || m === "index";
    if (wasFlow && toFlow) {
      setD(null); setCsvText(null); setCsvError(null); setParsedRows(null); setDateFilter("All");
      setSelectedConv(null); setSelectedItem(null); setSelectedTicker(null);
      setSearch(""); setOiSearch(""); setCapFilter("All"); setTab("Market Read");
    }
    setDataMode(m);
  }

  function handleCSV(text) {
    setCsvLoading(true);
    setCsvError(null);
    const trimmed = text.trim();
    if (trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
      setCsvError("Got HTML instead of CSV."); setCsvLoading(false); return;
    }
    if (!trimmed.includes(",") || trimmed.length < 100) {
      setCsvError("File appears empty or invalid (no CSV data found)."); setCsvLoading(false); return;
    }
    setTimeout(() => {
      try {
        const rows = parseCSV(text);
        if (!rows || rows.length === 0) throw new Error("CSV parsed but contained 0 valid rows. Check file format.");
        setCsvText(text);
        setParsedRows(rows);
        setDateFilter("All");
        // Persist to DB in background
        uploadToDb(text);
      } catch(err) {
        setCsvError(err.message);
      }
      setCsvLoading(false);
    }, 0);
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleCSV(ev.target.result);
    reader.readAsText(file);
  }
  function onFileInput(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleCSV(ev.target.result);
    reader.readAsText(file);
  }


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

  // Auto-scroll to Top Flow detail panel when opened
  useEffect(() => {
    if (selectedConv !== null && convPanelRef.current) {
      setTimeout(() => convPanelRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
    }
  }, [selectedConv]);

  // ─── Top Flow Tracker ───────────────────────────────────────────────
  const [topFlowPicks, setTopFlowPicks] = useState({ active:[], archived:[] });
  const [trackerDateFilter, setTrackerDateFilter] = useState("All");
  const [trackerCpFilter, setTrackerCpFilter] = useState("All"); // "All" | "Calls" | "Puts"
  const [trackerSort, setTrackerSort] = useState("recent");
  const [trkSort, setTrkSort] = useState({col:"added", dir:"desc", col2:"premium", dir2:"desc"});

  // ─── Watchlist State ─────────────────────────────────────────────────
  const [wlBull, setWlBull] = useState([]);
  const [wlBear, setWlBear] = useState([]);
  const [wlDteFilter, setWlDteFilter] = useState("All");
  const [wlViewFilter, setWlViewFilter] = useState("both"); // "both" | "bull" | "bear"
  const [wlDate, setWlDate] = useState(new Date().toISOString().slice(0,10));
  const [wlDates, setWlDates] = useState([]);
  const [wlEditing, setWlEditing] = useState(null);
  const [wlLoaded, setWlLoaded] = useState(false);
  const [wlCapPref, setWlCapPref] = useState("No Mega");
  const [wlAddBull, setWlAddBull] = useState("");
  const [wlAddBear, setWlAddBear] = useState("");
  const [wlRemoving, setWlRemoving] = useState(null);
  const [wlRemoveReason, setWlRemoveReason] = useState("");
  const [wlRemoved, setWlRemoved] = useState([]);
  const [wlOILoading, setWlOILoading] = useState(false);
  const wlRef = useRef(null);
  const screenshotWatchlist = async () => {
    if (!wlRef.current) return;
    let h2c = window.html2canvas;
    if (!h2c) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      document.head.appendChild(s);
      await new Promise(r => { s.onload = r; s.onerror = () => r(); });
      h2c = window.html2canvas;
    }
    if (!h2c) { alert("Could not load screenshot library"); return; }
    const canvas = await h2c(wlRef.current, { backgroundColor:P.bg, scale:2, useCORS:true });
    try {
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("📸 Copied to clipboard!");
      setTimeout(() => setStatus(""), 2000);
    } catch(e) {
      // Fallback to download if clipboard fails
      const link = document.createElement("a");
      const side = wlViewFilter === "both" ? "Full" : wlViewFilter === "bull" ? "Bull" : "Bear";
      link.download = `UCT_Watchlist_${side}_${wlDate}.png`;
      link.href = canvas.toDataURL();
      link.click();
    }
  };

  const wlFetchOI = async () => {
    const all = [...wlBull, ...wlBear];
    if (!all.length) return;
    setWlOILoading(true);
    const contracts = all.map(i=>({sym:i.sym, cp:i.cp, strike:i.strike, exp:i.exp}));
    try {
      await fetchPrices(contracts);
      const updateList = (list) => list.map(item => {
        const px = getPrice(item.sym, item.cp, item.strike, item.exp);
        if (!px) return item;
        const liveOI = px.oi || px.openInterest || 0;
        const delta = liveOI > 0 && item.oi > 0 ? liveOI - item.oi : 0;
        return { ...item, liveOI, liveOIDelta: delta };
      });
      setWlBull(prev => updateList(prev));
      setWlBear(prev => updateList(prev));
    } catch(e) { console.error("WL OI fetch error:", e); }
    setWlOILoading(false);
  };

  // Build cap lookup from raw trade data — FD.clean_confirmed has mktcap on each trade
  const capLookup = useMemo(() => {
    if (!D || !D.clean_confirmed) return {};
    const map = {};
    D.clean_confirmed.forEach(t => {
      const sym = (t.S || t.sym || "").toUpperCase();
      const mc = t.mktcap || 0;
      if (sym && mc > 0 && (!map[sym] || mc > map[sym])) map[sym] = mc;
    });
    return map;
  }, [D]);

  const wlCapCheck = (c) => {
    const cap = capBand(c.mktcap);
    if (cap !== "Unknown") return cap;
    const lookup = capLookup[(c.sym||"").toUpperCase()];
    if (lookup) return capBand(lookup);
    return "Unknown";
  };

  const autoScore = (c) => {
    let s = 0;
    // Grade: 0.5–2.5
    const g = c.grade||"";
    s += g==="A+"?2.5:g==="A"?2:g==="B+"?1.5:g==="B"?1:g==="C"?0.5:0.5;
    // Hits (repetition): 0.5–2.5
    const h = c.hits||0;
    const v = c.volOI||0;
    const p = c.prem||0;
    const cap = wlCapCheck(c);
    const isMega = cap === "Mega";
    if (h <= 1) {
      // Single trade — score by conviction signals (premium + V/OI) instead of repetition.
      // Whale tier added so a $5M+ (non-mega) / $10M+ (mega) single SWEEP at ASK gets
      // max conviction credit even if V/OI is low. Previously a massive single trade
      // capped at +1.5 (v<5, p>=$500K branch), undervaluing the size of the bet.
      if (isMega ? p >= 10e6 : p >= 5e6) s += 2.5;   // whale single trade
      else if (v >= 15) s += 2.5;
      else if (v >= 5 && (isMega ? p >= 2e6 : p >= 250e3)) s += 2;
      else if (v >= 5) s += 1.5;
      else if (isMega ? p >= 5e6 : p >= 500e3) s += 1.5;
      else s += 0.5;
    } else {
      let hitsScore = h>=10?2.5:h>=5?2:h>=3?1.5:h>=2?1:0.5;
      // Mirror the h<=1 massive-premium bonus into the multi-hit branch.
      // A multi-trade cluster with huge aggregate premium (e.g. COIN $220C
      // 5/21/27 H=2 $7.76M) deserves at least the same credit a single
      // trade of that size would get, regardless of repetition count.
      if (isMega ? p >= 5e6 : p >= 2e6) hitsScore = Math.max(hitsScore, 2);
      s += hitsScore;
    }
    // Cap-relative premium: extended tiers for whale sizes.
    // Previously maxed at $2M (non-mega) / $10M (mega), so a $5.3M trade scored
    // the same as a $2.1M trade despite being 2.5x larger. New tiers:
    //   non-mega: 0.5 / 1 / 1.5 / 1.75 / 2 / 2.5 / 3      ← was max 2
    //   mega:     0.5 / 1 / 1.5 / 2 / 2.5                 ← was max 2
    // $1.5M tier added (non-mega) so weekly sweeps in the $1.5-$2M range
    // (e.g. BE 250 CALL 6/12 $1.94M SWEEP) don't fall into the same bucket
    // as $500K trades.
    if (isMega) {
      s += p>=20e6?2.5:p>=10e6?2:p>=5e6?1.5:p>=1e6?1:0.5;
    } else {
      s += p>=10e6?3:p>=5e6?2.5:p>=2e6?2:p>=1.5e6?1.75:p>=500e3?1.5:p>=100e3?1:0.5;
    }
    // V/OI ratio: 0.5–2.5 (refined tiers — 8× is genuinely outsized)
    s += v>=15?2.5:v>=8?2:v>=5?1.5:v>=3?1.2:v>=2?1:0.5;
    // Side (urgency): 0.5–1.5. ASK/BID (single-side trade, not AA double-aggressor)
    // now gets 0.75 instead of the lowest tier — a clean SWEEP at ASK is still
    // directional even without the "AA" extreme-aggressor flag.
    const sd = c.side||"";
    s += sd==="AA"?1.5:sd==="BB"?1:(sd==="ASK"||sd==="BID")?0.75:0.5;
    // UOA flag: +1 when true
    if (c.uoa) s += 1;
    // LEAPS bonus: +0.5 for DTE > 180 (long-dated conviction)
    if ((c.DTE||0) > 180) s += 0.5;
    // ── Whale single-trade bonus ─────────────────────────────────────────
    // A single sweep with $5M+ premium (non-mega) or $10M+ (mega) signals
    // institutional positioning of a kind that the V/OI-weighted scorer was
    // systematically missing. The user flagged BE PUT $240 7/17 — a single
    // $5.3M SWEEP at ASK that languished at #16 in the bear watchlist
    // despite being 4x larger than the entries ranked above it. Mini-whale
    // tier lowered from $2M to $1.5M (non-mega) so weekly sweeps in the
    // $1.5-$2M range get explicit recognition. Stacks on top of the
    // cap-relative premium tier above so genuine size compounds.
    if (h <= 1) {
      if (isMega ? p >= 10e6 : p >= 5e6) s += 1.5;
      else if (isMega ? p >= 5e6 : p >= 1.5e6) s += 0.75;
    }
    // ── Sustained-accumulation bonus ─────────────────────────────────────
    // High hit count on real premium signals committed buying that the
    // multi-hit tier alone (capped at h>=10 → 2.5) doesn't fully capture.
    // SERV's 56 ASK sweeps totaling $1.1M is qualitatively different from
    // a 10-hit cluster at the same premium — the conviction is sustained
    // through the session, not a one-time burst. Top 10 Flow Picks already
    // rewards this pattern; this brings autoScore in line.
    if (h >= 50 && p >= 1e6) s += 1.5;
    else if (h >= 30 && p >= 750e3) s += 1.0;
    else if (h >= 20 && p >= 500e3) s += 0.5;
    // Cap-relative premium multiplier — premium dominance principle.
    // Sub-notable premium gets penalized regardless of how impressive V/OI,
    // side urgency, or single-trade conviction looks. A $137K trade with
    // V/OI 76x on a Large cap shouldn't outscore a $1M trade with V/OI 5x.
    // Notability floors (per Ravi's read):
    //   Mega:      $1M+ notable | $500K-$1M borderline (0.7x) | <$500K heavy (0.4x)
    //   Large:     $750K+ notable | $400K-$750K borderline | <$400K heavy
    //   Mid-Small: $500K+ notable | $250K-$500K borderline | <$250K heavy
    let premMult = 1;
    if (isMega) {
      if (p < 500e3) premMult = 0.4;
      else if (p < 1e6) premMult = 0.7;
    } else if (cap === "Large") {
      if (p < 400e3) premMult = 0.4;
      else if (p < 750e3) premMult = 0.7;
    } else if (cap === "Mid-Small") {
      if (p < 250e3) premMult = 0.4;
      else if (p < 500e3) premMult = 0.7;
    }
    s = s * premMult;
    // Normalize to 10 max (raw max ~14, but most realistic combinations
    // stay under 12.5 — kept divisor at 1.25 so existing watchlist scores
    // look familiar; only whale-size + high-grade combos can now legitimately
    // approach 100%.)
    return Math.min(10, Math.round(s / 1.25 * 10) / 10);
  };



  // Helper: extract first/latest date and spot from CONV trades
  const _extractDateSpot = (c, dateMap) => {
    // Try 1: this CONV item's own trades
    const trades = (c.trades||[]).filter(t=>t.Dt);
    if (trades.length) {
      const parsed = trades.map(t => {
        const p = (t.Dt||"").split("/").map(Number);
        const y = p.length>=3 ? (p[2]<100?p[2]+2000:p[2]) : 2026;
        return { dt: new Date(y, p[0]-1, p[1]||1), raw: t.Dt, spot: t.Spot||0 };
      }).sort((a,b)=>a.dt-b.dt);
      return { firstDate: parsed[0].raw, entrySpot: parsed[0].spot, latestSpot: parsed[parsed.length-1].spot };
    }
    // Try 2: dateMap from clean_confirmed + all_directional + CONV
    if (dateMap && dateMap[c.sym]) {
      return { firstDate: dateMap[c.sym].dt, entrySpot: dateMap[c.sym].spot, latestSpot: dateMap[c.sym].latestSpot || 0 };
    }
    // Try 3: scan ALL CONV items for this ticker
    if (FD && FD.CONV) {
      for (const conv of FD.CONV) {
        if (conv.sym !== c.sym) continue;
        const ct = (conv.trades||[]).filter(t=>t.Dt);
        if (ct.length) {
          const parsed = ct.map(t => {
            const p = (t.Dt||"").split("/").map(Number);
            const y = p.length>=3 ? (p[2]<100?p[2]+2000:p[2]) : 2026;
            return { dt: new Date(y, p[0]-1, p[1]||1), raw: t.Dt, spot: t.Spot||0 };
          }).sort((a,b)=>a.dt-b.dt);
          return { firstDate: parsed[0].raw, entrySpot: parsed[0].spot, latestSpot: parsed[parsed.length-1].spot };
        }
      }
    }
    return { firstDate:"", entrySpot:0, latestSpot:0 };
  };

  // Build ticker → earliest date map from multiple sources
  const _buildDateMap = () => {
    const map = {};
    const _addTrade = (sym, dt, spot) => {
      if (!dt || !sym) return;
      const p = dt.split("/").map(Number);
      if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) return;
      const y = p.length>=3 ? (p[2]<100?p[2]+2000:p[2]) : 2026;
      const d = new Date(y, p[0]-1, p[1]||1);
      if (isNaN(d.getTime())) return;
      if (!map[sym]) {
        map[sym] = { dt, date: d, spot: spot||0, latestSpot: spot||0, latestDate: d };
      } else {
        if (d < map[sym].date) { map[sym].dt = dt; map[sym].date = d; map[sym].spot = spot||0; }
        if (d > map[sym].latestDate) { map[sym].latestSpot = spot||0; map[sym].latestDate = d; }
      }
    };
    if (D && D.clean_confirmed) {
      D.clean_confirmed.forEach(t => _addTrade(t.S, t.Dt, t.Spot));
    }
    if (D && D.all_directional) {
      D.all_directional.forEach(t => _addTrade(t.S, t.Dt, t.Spot));
    }
    if (FD && FD.CONV) {
      FD.CONV.forEach(c => {
        (c.trades||[]).forEach(t => _addTrade(c.sym, t.Dt, t.Spot));
      });
    }
    return map;
  };

  const wlPopulate = () => {
    if (!FD || !FD.CONV) return;
    const dateMap = _buildDateMap();
    const dedup = (list) => {
      const seen = new Set();
      return list.map(c => {
        const _pick = topFlowPicks.active.find(p=>p.sym===c.sym&&p.cp===c.cp&&parseFloat(p.strike)===parseFloat(c.K)&&p.exp===c.exp);
        const _oiH = _pick ? (_pick.history||[]).filter(h=>(h.oi||0)>0) : [];
        const _curOI = _oiH.length>0 ? _oiH[_oiH.length-1].oi : 0;
        const _peakOI = _oiH.length>0 ? Math.max(..._oiH.map(h=>h.oi)) : 0;
        const _isExitRaw = _peakOI>=100 && _curOI>0 && (_peakOI-_curOI)/_peakOI*100>=30;
        // Override exit penalty when cluster shows fresh accumulation —
        // V/OI >= 0.3 means today's volume is meaningful vs current OI,
        // which indicates new entry flow rather than position unwinding.
        // (Without this, big new sweeps on contracts with prior OI history
        //  get unfairly penalized and drop out of the top-20 watchlist.)
        const _hasAccum = c.vol > 0 && (c.maxOI||0) > 0 && (c.vol / c.maxOI) >= 0.3;
        const _isExit = _isExitRaw && !_hasAccum;
        // Use autoScore for ranking so the premium multiplier (and any other
        // autoScore refinements) actually decides which 20 make the cut.
        // Previously this used c.score (CONV cluster score) which is blind
        // to autoScore tuning — that's why sub-notable premium picks like
        // STM $69 / KO $90 / WULF $25.5 with $134-218K were making the top
        // 20 despite scoring 20-28% on autoScore, while $1M+ legit flow sat
        // in Scanner Suggestions waiting to be promoted.
        const _autoS = autoScore(c);
        return { ...c, _isExit, _rankScore: _isExit ? _autoS * 0.4 : _autoS };
      }).sort((a,b)=>b._rankScore-a._rankScore).filter(c => { if (seen.has(c.sym)) return false; seen.add(c.sym); return true; });
    };
    // 2026-07-04: exclude ETFs/INDEXes when in Stocks tab (and vice versa).
    // Watchlist should reflect the same universe as the tab -- SPY/QQQ/SMH
    // belong on the Indexes tab. Two-layer detection via module-scope
    // isETFSymbol(): stocketf metadata + KNOWN_ETF_TICKERS ticker fallback.
    const isStock = (c) => !isETFSymbol(c.sym, c.stocketf);
    const wlTabFilter = dataMode === "stocks" ? isStock : ((c) => !isStock(c));
    const bulls = dedup(FD.CONV.filter(c=>c.dir==="BULL" && wlTabFilter(c))).slice(0,20).map(c=>{
      const ds = _extractDateSpot(c, dateMap);
      return {
        sym:c.sym, score:autoScore(c), autoScore:autoScore(c), tier:"WATCH",
        strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
        dir:c.dir||"BULL", hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"",
        cap:wlCapCheck(c), oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[],
        firstDate:ds.firstDate, entrySpot:ds.entrySpot, latestSpot:ds.latestSpot,
        // Raw clustering score (the one that actually wins the dedup ranking) —
        // surfaced in the UI so you can see why a contract beat another contract
        // on the same ticker. convScore = pre-penalty, rankScore = post-EXIT penalty.
        convScore: c.score||0, rankScore: c._rankScore||c.score||0, isExit: !!c._isExit
      };
    });
    const bears = dedup(FD.CONV.filter(c=>c.dir==="BEAR" && wlTabFilter(c))).slice(0,20).map(c=>{
      const ds = _extractDateSpot(c, dateMap);
      return {
        sym:c.sym, score:autoScore(c), autoScore:autoScore(c), tier:"WATCH",
        strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
        dir:c.dir||"BEAR", hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"",
        cap:wlCapCheck(c), oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[],
        firstDate:ds.firstDate, entrySpot:ds.entrySpot, latestSpot:ds.latestSpot,
        convScore: c.score||0, rankScore: c._rankScore||c.score||0, isExit: !!c._isExit
      };
    });
    setWlBull(bulls);
    setWlBear(bears);

    // ── Cross-direction fill ────────────────────────────────────────────
    // After the primary bull/bear lists are built from FD.CONV, look for
    // tickers that have meaningful flow in BOTH directions but only ended
    // up in one list. This happens commonly when one direction's clusters
    // get filtered out of CONV by the DTE<=7 or non-clean checks at the
    // preSort filter (e.g. BE had bullish 06/12/26 CALLs at 4-DTE — short
    // enough to be excluded, but real flow worth surfacing).
    //
    // IMPORTANT — what counts as a "clean" cross-direction signal:
    //   BULL fallback → CALL contracts bought aggressively at the ASK
    //   BEAR fallback → PUT  contracts bought aggressively at the ASK
    // Selling puts is technically a bullish position, and selling calls
    // is technically bearish, but showing "PUT in the bull list" or
    // "CALL in the bear list" is visually wrong and broke trust in the
    // first iteration of this fill (META PUT $585 appearing in bulls
    // because of put-selling flow). Restricting to BTO of the matching
    // option type produces visually unambiguous picks the user can
    // triage at a glance.
    setTimeout(() => {
      if (!FD.all_directional) {
        console.warn("[wlPopulate] No FD.all_directional — fallback pass skipped entirely");
        return;
      }
      console.log("[wlPopulate] Fallback pass start. FD.all_directional length:", FD.all_directional.length,
        "| existing bulls:", bulls.length, "| existing bears:", bears.length);
      // Lowered from $500K → $100K both — the previous bar was too high for
      // mid-cap names with real but smaller bullish/bearish opposite-side
      // flow (e.g. BE had ~$3M of bullish CALL action but spread across
      // multiple short-DTE strikes, none individually hit $500K). The
      // user wants to triage manually so a lower bar is correct.
      const MIN_CONTRACT_PREMIUM = 100_000;
      const MIN_TOTAL_DIRECTIONAL = 100_000;

      const flowBy = {};
      for (const t of FD.all_directional) {
        // BUG FIX: trade objects use UPPERCASE field names (t.CP, t.E) per
        // line 797 in processFlowData. This loop was checking t.cp and t.exp
        // (lowercase) — both always undefined, so EVERY trade got skipped
        // and flowBy was always empty. This is why neither the existing
        // cross-direction buildFallback nor any subsequent fallback layer
        // ever actually fired, despite appearing wired up correctly.
        if (!t.S || !t.D || !t.P || !t.CP) continue;
        if (!flowBy[t.S]) flowBy[t.S] = { BULL: null, BEAR: null, mktcap: t.mktcap || 0 };
        // Keep ticker-level mktcap up to date — take max non-zero across trades
        // in case some rows have it and others don't (CSV import edge cases).
        if (t.mktcap && t.mktcap > flowBy[t.S].mktcap) flowBy[t.S].mktcap = t.mktcap;
        if (!flowBy[t.S][t.D]) flowBy[t.S][t.D] = { totalPrem: 0, contracts: {} };
        flowBy[t.S][t.D].totalPrem += t.P;
        const cKey = t.CP + "|" + t.K + "|" + t.E;
        if (!flowBy[t.S][t.D].contracts[cKey]) {
          flowBy[t.S][t.D].contracts[cKey] = {
            cp: t.CP, K: t.K, exp: t.E, hits: 0,
            askPrem: 0, bidPrem: 0,
            vol: 0, maxOI: 0, hasSweep: false,
          };
        }
        const cc = flowBy[t.S][t.D].contracts[cKey];
        cc.hits++;
        cc.vol += (t.V || 0);
        if ((t.OI || 0) > cc.maxOI) cc.maxOI = t.OI;
        if (t.Ty === "SWP") cc.hasSweep = true;
        if (t.Si === "A" || t.Si === "AA") cc.askPrem += t.P;
        if (t.Si === "B" || t.Si === "BB") cc.bidPrem += t.P;
      }
      const flowBySyms = Object.keys(flowBy);
      console.log("[wlPopulate] flowBy built:", flowBySyms.length, "tickers");
      // Targeted SERV diagnostic — quick sanity check that the build worked
      if (flowBy.SERV) {
        const bullData = flowBy.SERV.BULL;
        const bearData = flowBy.SERV.BEAR;
        console.log("[wlPopulate] SERV in flowBy:",
          "BULL=", bullData ? `$${Math.round(bullData.totalPrem/1000)}K (${Object.keys(bullData.contracts).length} contracts)` : "none",
          "BEAR=", bearData ? `$${Math.round(bearData.totalPrem/1000)}K (${Object.keys(bearData.contracts).length} contracts)` : "none",
          "mktcap=", flowBy.SERV.mktcap);
      } else {
        console.log("[wlPopulate] SERV NOT in flowBy — no directional trades for SERV in FD.all_directional today");
      }

      // Diagnostic helper — emits a `[wlPopulate diag] {sym}: ...` line
      // explaining what was found and why a fallback was or wasn't built.
      // Helps debug "I expected X to appear but it didn't" cases without
      // needing to instrument the code per-investigation.
      const buildFallback = (sym, dir, log = false) => {
        const sideData = flowBy[sym]?.[dir];
        if (!sideData) {
          if (log) console.log(`[wlPopulate diag] ${sym} ${dir}: no flow data with t.D=${dir}`);
          return null;
        }
        if (sideData.totalPrem < MIN_TOTAL_DIRECTIONAL) {
          if (log) console.log(`[wlPopulate diag] ${sym} ${dir}: total $${Math.round(sideData.totalPrem/1000)}K < threshold $${MIN_TOTAL_DIRECTIONAL/1000}K`);
          return null;
        }
        const cleanCp = dir === "BULL" ? "C" : "P";
        const cleanCpName = dir === "BULL" ? "call" : "put";
        const allContracts = Object.values(sideData.contracts);
        // Block-only clusters = institutional repositioning, not directional. Skip.
        const withSweep = allContracts.filter(c => c.hasSweep);
        const cpMatching = withSweep.filter(c => c.cp === cleanCp);
        const askDominant = cpMatching.filter(c => c.askPrem > c.bidPrem);
        const qualifying = askDominant.filter(c => c.askPrem >= MIN_CONTRACT_PREMIUM);
        if (log) {
          console.log(`[wlPopulate diag] ${sym} ${dir}: total $${Math.round(sideData.totalPrem/1000)}K, ` +
            `contracts=${allContracts.length} (sweep=${withSweep.length}), ${cleanCpName}=${cpMatching.length}, ` +
            `ask-dominant=${askDominant.length}, qualifying(>=$${MIN_CONTRACT_PREMIUM/1000}K)=${qualifying.length}`);
          if (cpMatching.length > 0 && qualifying.length === 0) {
            const top = cpMatching.sort((a,b)=>b.askPrem-a.askPrem)[0];
            console.log(`[wlPopulate diag]   ${sym} top ${cleanCpName}: ${top.cp} ${top.K} ${top.exp} ` +
              `askPrem=$${Math.round(top.askPrem/1000)}K bidPrem=$${Math.round(top.bidPrem/1000)}K`);
          }
        }
        if (qualifying.length === 0) return null;
        const top = qualifying.sort((a, b) => b.askPrem - a.askPrem)[0];
        // Real mktcap from flow data so autoScore's cap-relative tiers fire.
        // Previously this was 0 → wlCapCheck returned "Unknown" → all
        // cap-relative scoring silently broke for fallback picks.
        const mc = flowBy[sym].mktcap || 0;
        // Promote grade for visibly clean+sized fallback contracts so
        // they don't all uniformly score "C" (0.5). A SWEEP at ASK with
        // $1M+ premium is at least B territory.
        let grade = "C";
        if (top.askPrem >= 1e6) grade = "B";
        if (top.askPrem >= 3e6) grade = "B+";
        const volOIRatio = top.maxOI > 0 ? top.vol / top.maxOI : 0;
        const pseudoCluster = {
          sym, cp: top.cp, K: top.K, exp: top.exp,
          hits: top.hits, prem: top.askPrem,
          side: "ASK", askPrem: top.askPrem, bidPrem: top.bidPrem,
          dir, grade, vol: top.vol, maxOI: top.maxOI, volOI: volOIRatio,
          mktcap: mc, er: false, dominantOverride: false,
        };
        const score = autoScore(pseudoCluster);
        return {
          sym, score, autoScore: score, tier: "WATCH",
          strike: top.K || "", exp: top.exp || "", cp: top.cp || "",
          grade, dir, hits: top.hits, prem: top.askPrem,
          side: "ASK", er: false,
          notes: "Cross-direction fill — " + sym + " has both bull & bear flow; this is the strongest CLEAN " +
                 dir.toLowerCase() + " signal (BTO " + cleanCpName + " at ASK)",
          cap: wlCapCheck({ sym, prem: top.askPrem, mktcap: mc }) || "Mid-Small",
          oi: top.maxOI || 0, volume: top.vol || 0, volOI: volOIRatio,
          liveOI: 0, liveOIDelta: 0, actionLog: [],
          firstDate: "", entrySpot: 0, latestSpot: 0,
          convScore: 0, rankScore: 0, isExit: false,
          _isFallback: true,
        };
      };

      const bullSyms = new Set(bulls.map(b => b.sym));
      const bearSyms = new Set(bears.map(b => b.sym));
      const fallbackBulls = [];
      const fallbackBears = [];

      // 2026-07-04: same ETF/INDEX filter as initial cut - fallback picks
      // should honor the current tab. Uses module-scope isETFSymbol()
      // which checks both stocketf CSV metadata and KNOWN_ETF_TICKERS.
      const _symIsStock = (sym) => !isETFSymbol(sym, flowBy[sym]?.stocketf);
      const _fallbackTabFilter = dataMode === "stocks" ? _symIsStock : ((s) => !_symIsStock(s));

      bears.forEach(b => {
        if (bullSyms.has(b.sym)) return;
        if (!_fallbackTabFilter(b.sym)) return;
        const fb = buildFallback(b.sym, "BULL", true);  // log per ticker
        if (fb) fallbackBulls.push(fb);
      });
      bulls.forEach(b => {
        if (bearSyms.has(b.sym)) return;
        if (!_fallbackTabFilter(b.sym)) return;
        const fb = buildFallback(b.sym, "BEAR", true);
        if (fb) fallbackBears.push(fb);
      });

      // ─── Pass 3: Heavy ASK-dominant DIRTY cluster fallback ──────────────
      // The existing cross-direction buildFallback only fires for tickers
      // already on the OPPOSITE list (e.g. ticker on bear list → check for
      // a clean BULL fallback). It misses tickers that have NEITHER a clean
      // bull NOR clean bear CONV cluster — typically because the cluster is
      // ≥80% ASK but has enough bid-side noise to fail the dirty/clean
      // classifier (whose profit-taking exception only fires for DTE ≤ 14).
      //
      // SERV/BTDR pattern: 60+ ASK sweeps on the same strike, ~13% bid noise,
      // DTE ~37 → CONV flags dirty → never reaches FD.CONV → invisible to
      // both watchlist and Scanner Suggestions. Top 10 still surfaces it via
      // raw D.all_directional, which is the Top 10 ⊄ Watchlist divergence
      // that's been showing up across multiple sessions.
      //
      // Higher thresholds than cross-direction fallback (cap-relative
      // notable floors, 80% ASK dominance) keep this selective so it only
      // promotes genuinely high-conviction dirty clusters.
      const buildDirtyDominantFallback = (sym, dir, log = false) => {
        const sideData = flowBy[sym]?.[dir];
        if (!sideData) return null;
        const mc = flowBy[sym].mktcap || 0;
        const capName = capBand(mc);
        const minTotalFlow = capName === "Mega" ? 1e6 : capName === "Large" ? 750e3 : 500e3;
        if (sideData.totalPrem < minTotalFlow) {
          if (log) console.log(`[wlPopulate dirty-dom] ${sym} ${dir}: total $${Math.round(sideData.totalPrem/1000)}K < ${capName} floor $${minTotalFlow/1000}K`);
          return null;
        }
        const cleanCp = dir === "BULL" ? "C" : "P";
        const cleanCpName = dir === "BULL" ? "call" : "put";
        const allContracts = Object.values(sideData.contracts);
        // Block-only clusters = institutional repositioning, not directional. Skip.
        const withSweep = allContracts.filter(c => c.hasSweep);
        const cpMatching = withSweep.filter(c => c.cp === cleanCp);
        // Heavily ASK-dominant: ≥80% of cluster premium on ASK + at least $250K ASK
        const dominant = cpMatching.filter(c => {
          const tot = c.askPrem + c.bidPrem;
          if (tot <= 0) return false;
          return c.askPrem / tot >= 0.80 && c.askPrem >= 250e3;
        });
        if (log) {
          console.log(`[wlPopulate dirty-dom] ${sym} ${dir}: contracts=${allContracts.length} (sweep=${withSweep.length}), ` +
            `${cleanCpName}=${cpMatching.length}, dominant(≥80% ASK, $250K+)=${dominant.length}`);
        }
        if (dominant.length === 0) return null;
        const top = dominant.sort((a, b) => b.askPrem - a.askPrem)[0];
        // Grade promotion — heavy dominance + size = real conviction.
        // Hits matter: 50+ consistent ASK prints on $1M+ is A+ territory even
        // though autoScore would otherwise see this as a generic multi-hit
        // cluster. Top 10 explicitly rewards "sustained accumulation"; we
        // mirror that intuition here.
        let grade = "C";
        if (top.askPrem >= 250e3) grade = "B";
        if (top.askPrem >= 1e6) grade = "B+";
        if (top.askPrem >= 3e6) grade = "A";
        if (top.askPrem >= 5e6) grade = "A+";
        // Multi-hit consistency overrides the premium-only ladder
        if (top.hits >= 10 && top.askPrem >= 500e3) grade = "B+";
        if (top.hits >= 20 && top.askPrem >= 750e3) grade = "A";
        if (top.hits >= 50 && top.askPrem >= 1e6) grade = "A+";
        const volOIRatio = top.maxOI > 0 ? top.vol / top.maxOI : 0;
        const pseudoCluster = {
          sym, cp: top.cp, K: top.K, exp: top.exp,
          hits: top.hits, prem: top.askPrem,
          side: "ASK", askPrem: top.askPrem, bidPrem: top.bidPrem,
          dir, grade, vol: top.vol, maxOI: top.maxOI, volOI: volOIRatio,
          mktcap: mc, er: false, dominantOverride: true,
        };
        const score = autoScore(pseudoCluster);
        const purity = Math.round(top.askPrem / (top.askPrem + top.bidPrem) * 100);
        return {
          sym, score, autoScore: score, tier: "WATCH",
          strike: top.K || "", exp: top.exp || "", cp: top.cp || "",
          grade, dir, hits: top.hits, prem: top.askPrem,
          side: "ASK", er: false,
          notes: `Heavy ASK-dominant — ${purity}% ASK on ${top.hits} trades (not in CONV: mixed sides)`,
          cap: wlCapCheck({ sym, prem: top.askPrem, mktcap: mc }) || "Mid-Small",
          oi: top.maxOI || 0, volume: top.vol || 0, volOI: volOIRatio,
          liveOI: 0, liveOIDelta: 0, actionLog: [],
          firstDate: "", entrySpot: 0, latestSpot: 0,
          convScore: 0, rankScore: 0, isExit: false,
          _isFallback: true, _isDirtyDominant: true,
        };
      };

      const crossFallbackBullSyms = new Set(fallbackBulls.map(f => f.sym));
      const crossFallbackBearSyms = new Set(fallbackBears.map(f => f.sym));
      Object.keys(flowBy).forEach(sym => {
        // Skip if already on either watchlist OR already picked up via cross-direction fallback
        if (bullSyms.has(sym) || bearSyms.has(sym)) return;
        if (crossFallbackBullSyms.has(sym) || crossFallbackBearSyms.has(sym)) return;
        if (!_fallbackTabFilter(sym)) return;
        const bullTotal = flowBy[sym].BULL?.totalPrem || 0;
        const bearTotal = flowBy[sym].BEAR?.totalPrem || 0;
        // Try the dominant direction (whichever has more flow)
        if (bullTotal >= bearTotal && bullTotal > 0) {
          const fb = buildDirtyDominantFallback(sym, "BULL", true);
          if (fb) fallbackBulls.push(fb);
        } else if (bearTotal > 0) {
          const fb = buildDirtyDominantFallback(sym, "BEAR", true);
          if (fb) fallbackBears.push(fb);
        }
      });

      console.log("[wlPopulate] Fallback pass complete. Cross-direction added:",
        fallbackBulls.filter(f=>!f._isDirtyDominant).length, "bull /",
        fallbackBears.filter(f=>!f._isDirtyDominant).length, "bear.",
        "Dirty-dominant added:",
        fallbackBulls.filter(f=>f._isDirtyDominant).length, "bull /",
        fallbackBears.filter(f=>f._isDirtyDominant).length, "bear.");
      if (fallbackBulls.length > 0) {
        // Merge with existing bulls, re-sort by score, truncate to 20 — so the
        // watchlist stays at quality top-20 regardless of how many fallbacks
        // each pass surfaces. Without this, the list balloons (88 tickers
        // observed when cross-direction + dirty-dominant both fire heavily).
        setWlBull(prev => {
          const merged = [...prev, ...fallbackBulls];
          // Dedup by sym (in case a fallback duplicates a CONV pick)
          const seen = new Set();
          const unique = merged.filter(x => { if (seen.has(x.sym)) return false; seen.add(x.sym); return true; });
          return unique.sort((a,b)=>(b.score||0)-(a.score||0)).slice(0, 20);
        });
        console.log("[wlPopulate] Added " + fallbackBulls.length +
          " BULL fallback candidate(s) (CALL@ASK):", fallbackBulls.map(x => x.sym + (x._isDirtyDominant?"*":"")).join(", "),
          "  (* = dirty-dominant; list re-sorted + truncated to top 20)");
      }
      if (fallbackBears.length > 0) {
        setWlBear(prev => {
          const merged = [...prev, ...fallbackBears];
          const seen = new Set();
          const unique = merged.filter(x => { if (seen.has(x.sym)) return false; seen.add(x.sym); return true; });
          return unique.sort((a,b)=>(b.score||0)-(a.score||0)).slice(0, 20);
        });
        console.log("[wlPopulate] Added " + fallbackBears.length +
          " BEAR fallback candidate(s) (PUT@ASK):", fallbackBears.map(x => x.sym + (x._isDirtyDominant?"*":"")).join(", "),
          "  (* = dirty-dominant; list re-sorted + truncated to top 20)");
      }
    }, 0);
  };

  const wlPopulateUnusual = () => {
    if (!FD || !FD.CONV) return;
    const unusual = [];
    (FD.CONV||[]).forEach(c => { (c.patterns||[]).forEach(p => { unusual.push({ ...c, anomaly:p.type, source:"pattern" }); }); });
    (FD.CONV||[]).forEach(c => { if (c.volOI >= 10 && c.maxOI > 0 && c.maxOI < 500) unusual.push({ ...c, anomaly:"VOL_OI_EXTREME", source:"voloi" }); });
    (FD.CONV||[]).forEach(c => {
      const cap = capBand(c.mktcap);
      const thresh = cap==="Mid-Small"?500e3:0;
      if (thresh > 0 && c.prem >= thresh) unusual.push({ ...c, anomaly:"SIZE_VS_CAP", source:"sizecap" });
    });
    const seen = new Set();
    const deduped = unusual.filter(u => { const k = u.sym+"|"+u.cp+"|"+u.K+"|"+u.exp; if (seen.has(k)) return false; seen.add(k); return true; });
    const sorted = deduped.sort((a,b) => b.prem - a.prem);
    const tickerSeen = new Set();
    const uniqueTicker = (list) => list.filter(c => { if (tickerSeen.has(c.sym+"|"+c.dir)) return false; tickerSeen.add(c.sym+"|"+c.dir); return true; });
    const bulls = uniqueTicker(sorted.filter(c=>c.dir==="BULL")).slice(0,20).map(c=>({
      sym:c.sym, score:autoScore(c), autoScore:autoScore(c), tier:"WATCH",
      strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
      dir:"BULL", hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"[UOA]",
      cap:wlCapCheck(c), oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[],
      // Raw clustering score (unusual path doesn't apply EXIT penalty — sorted by premium)
      convScore: c.score||0, rankScore: c.score||0, isExit: false
    }));
    const bears = uniqueTicker(sorted.filter(c=>c.dir==="BEAR")).slice(0,20).map(c=>({
      sym:c.sym, score:autoScore(c), autoScore:autoScore(c), tier:"WATCH",
      strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
      dir:"BEAR", hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"[UOA]",
      cap:wlCapCheck(c), oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[],
      convScore: c.score||0, rankScore: c.score||0, isExit: false
    }));
    setWlBull(bulls);
    setWlBear(bears);
  };

  const wlAddTicker = (side) => {
    const input = side==="bull"?wlAddBull.trim().toUpperCase():wlAddBear.trim().toUpperCase();
    if (!input) return;
    const setInput = side==="bull"?setWlAddBull:setWlAddBear;
    const setList = side==="bull"?setWlBull:setWlBear;
    const list = side==="bull"?wlBull:wlBear;
    if (list.some(i=>i.sym===input)) { setInput(""); return; }
    const match = FD?.CONV?.find(c=>c.sym===input);
    const item = match ? {
      sym:input, score:autoScore(match), autoScore:autoScore(match), tier:"WATCH",
      strike:match.K||match.strike||"", exp:match.exp||"", cp:match.cp||"",
      grade:match.grade||"", dir:side==="bull"?"BULL":"BEAR",
      hits:match.hits||0, prem:match.prem||0, side:match.side||"", er:match.er||false, notes:"",
      cap:wlCapCheck(match), oi:match.maxOI||0, volume:match.vol||0, volOI:match.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[]
    } : {
      sym:input, score:5, autoScore:0, tier:"WATCH",
      strike:"", exp:"", cp:side==="bull"?"C":"P",
      grade:"", dir:side==="bull"?"BULL":"BEAR",
      hits:0, prem:0, side:"", er:false, notes:"", cap:"",
      oi:0, volume:0, volOI:0, liveOI:0, liveOIDelta:0, actionLog:[]
    };
    setList([...list, item]);
    setInput("");
  };

  const wlSave = () => {
    fetch(API_BASE+"/api/watchlist/save",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({date:wlDate,bull:wlBull,bear:wlBear,removed:wlRemoved})
    }).then(r=>r.json()).then(()=>{
      fetch(API_BASE+"/api/watchlist/dates").then(r=>r.json()).then(d=>setWlDates(d));
    }).catch(()=>{});
    // NOTE: removed previous push of watchlist top 10 bull/bear to /api/top-flow/save.
    // Watchlist saves are now decoupled from Tracker — Tracker is fed only from
    // the cap-weighted Top 10 Flow Picks via the manual "💾 Save Top 10" button
    // in Market Read.
  };

  // ─── Discord Push (admin only) ──────────────────────────────────────
  const [discordPushing, setDiscordPushing] = useState(false);
  const [discordLabel, setDiscordLabel] = useState("WATCHLIST");
  const [discordCount, setDiscordCount] = useState(10);
  const [discordPayload, setDiscordPayload] = useState("");

  const _buildUnusualMidSmall = () => {
    if (!FD || !FD.CONV) return { bull: [], bear: [] };
    const dateMap = _buildDateMap();
    const unusual = [];
    (FD.CONV||[]).forEach(c => { (c.patterns||[]).forEach(p => { unusual.push({ ...c, anomaly:p.type, source:"pattern" }); }); });
    (FD.CONV||[]).forEach(c => { if (c.volOI >= 10 && c.maxOI > 0 && c.maxOI < 500) unusual.push({ ...c, anomaly:"VOL_OI_EXTREME", source:"voloi" }); });
    (FD.CONV||[]).forEach(c => {
      const cap = capBand(c.mktcap);
      if (cap==="Mid-Small" && c.prem >= 500e3) unusual.push({ ...c, anomaly:"SIZE_VS_CAP", source:"sizecap" });
    });
    const seen = new Set();
    const deduped = unusual.filter(u => { const k = u.sym+"|"+u.cp+"|"+u.K+"|"+u.exp; if (seen.has(k)) return false; seen.add(k); return true; });
    const sorted = deduped.sort((a,b) => b.prem - a.prem);
    const msOnly = sorted.filter(c => capBand(c.mktcap)==="Mid-Small");
    // Exclude tickers already in the main watchlist
    const wlSyms = new Set([...wlBull.map(i=>i.sym), ...wlBear.map(i=>i.sym)]);
    const msNew = msOnly.filter(c => !wlSyms.has(c.sym));
    const tickerSeen = new Set();
    const unique = (list) => list.filter(c => { const k = c.sym+"|"+c.dir; if (tickerSeen.has(k)) return false; tickerSeen.add(k); return true; });
    const mapItem = (c, dir) => {
      const ds = _extractDateSpot(c, dateMap);
      return {
        sym:c.sym, score:autoScore(c), autoScore:autoScore(c), tier:"WATCH",
        strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
        dir, hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"[UOA]",
        cap:wlCapCheck(c), oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, uoa:true,
        firstDate:ds.firstDate, entrySpot:ds.entrySpot, latestSpot:ds.latestSpot
      };
    };
    return {
      bull: unique(msNew.filter(c=>c.dir==="BULL")).slice(0,discordCount).map(c=>mapItem(c,"BULL")),
      bear: unique(msNew.filter(c=>c.dir==="BEAR")).slice(0,discordCount).map(c=>mapItem(c,"BEAR")),
    };
  };

  const wlPushDiscord = async (mode) => {
    setDiscordPushing(true);
    if (!wlBull.length && !wlBear.length) {
      setStatus("⚠️ No items to push"); setTimeout(()=>setStatus(""),2000); setDiscordPushing(false); return;
    }
    let overallBull = 0, overallBear = 0, tickerCount = 0;
    if (D && D.clean_confirmed) {
      const tkSet = new Set();
      D.clean_confirmed.forEach(t => {
        if (t.D === "BULL") overallBull += t.P;
        if (t.D === "BEAR") overallBear += t.P;
        if (t.S) tkSet.add(t.S);
      });
      tickerCount = tkSet.size;
    }
    const today = new Date();
    const _addStatus = (items) => items.map(item => {
      let age = "", status = "";
      if (item.firstDate) {
        const p = item.firstDate.split("/").map(Number);
        const y = p.length >= 3 ? (p[2] < 100 ? p[2] + 2000 : p[2]) : today.getFullYear();
        const fd = new Date(y, p[0]-1, p[1]||1);
        const diffMs = today - fd;
        const diffDays = Math.max(0, Math.round(diffMs / 86400000));
        age = diffDays <= 1 ? "1d" : diffDays + "d";
        if (diffDays <= 2) { status = "NEW"; }
        else if (item.entrySpot > 0 && item.latestSpot > 0) {
          const movePct = ((item.latestSpot - item.entrySpot) / item.entrySpot * 100);
          const sign = movePct >= 0 ? "+" : "";
          status = sign + Math.round(movePct) + "%";
        }
      }
      return { ...item, age, status };
    });
    const payload = {
          bull:_addStatus(wlBull), bear:_addStatus(wlBear),
          unusualBull:[], unusualBear:[],
          overallBull, overallBear, tickerCount,
          label:discordLabel, limit:discordCount,
          dateRange: FD ? FD.dateRange : ""
        };
    setDiscordPayload(JSON.stringify(payload));
    setStatus(`📋 Payload ready — copy from box below, paste in discord-push.html`);
    setDiscordPushing(false);
    setTimeout(()=>setStatus(""),4000);
  };

  const wlLoad = (day) => {
    fetch(API_BASE+"/api/watchlist/load/"+day).then(r=>r.json()).then(d=>{
      setWlBull(d.bull||[]); setWlBear(d.bear||[]); setWlRemoved(d.removed||[]); setWlDate(day); setWlLoaded(true);
    }).catch(()=>{});
  };

  useEffect(()=>{
    fetch(API_BASE+"/api/watchlist/dates").then(r=>r.ok?r.json():[]).then(d=>setWlDates(d)).catch(()=>{});
  },[]);
  const [showArchived, setShowArchived] = useState(false);

  // Fetch history after initial render (deferred)
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(API_BASE+"/api/top-flow/history").then(r=>r.ok?r.json():null).then(data=>{
        if (data) setTopFlowPicks(data);
      }).catch(()=>{});
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // NOTE: Auto-save of "top 20 per CSV date from D.CONV" was REMOVED. It
  // pulled from the broader confirmed-cluster list (D.CONV), which mixed in
  // weak picks and watchlist-bear noise — caused 700+ active contracts of
  // mostly losing far-OTM puts. The Tracker is now fed exclusively from
  // the cap-weighted "Top 10 Flow Picks" via the manual "💾 Save Top 10"
  // button in Market Read. One click per trading day (or per backfill date).

  // Auto-load market data (deferred — non-critical)
  useEffect(() => { const t = setTimeout(fetchMarketData, 800); return () => clearTimeout(t); }, []);
  useEffect(() => { if (dataMode === "gex" && gexTicker) fetchGex(gexTicker, gexDte); }, [dataMode, gexTicker, gexDte]);
  // Lightweight Charts for GEX tab
  useEffect(() => {
    if (!showGexChart || !gexTicker || !gexData || gexData.error) {
      // Cleanup if hidden
      if (gexChartObjRef.current) { gexChartObjRef.current.remove(); gexChartObjRef.current = null; }
      return;
    }
    // Load library from CDN if needed
    const LWC_URL = "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js";
    const loadAndRender = () => {
      if (!gexChartRef.current) return;
      if (gexChartObjRef.current) { gexChartObjRef.current.remove(); gexChartObjRef.current = null; }
      const LWC = window.LightweightCharts;
      if (!LWC) return;
      const el = gexChartRef.current;
      el.innerHTML = "";
      const chart = LWC.createChart(el, {
        width: el.clientWidth, height: 500,
        layout: { background: { color: "#0d1117" }, textColor: "#7b8fa3", fontSize: 10 },
        grid: { vertLines: { color: "#1a254033" }, horzLines: { color: "#1a254033" } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: "#1a2540" },
        timeScale: { borderColor: "#1a2540", timeVisible: true, secondsVisible: false,
          tickMarkFormatter: (time, tickMarkType) => {
            const d = new Date(time * 1000);
            const h = parseInt(d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
            const m = parseInt(d.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' }));
            if (h <= 10 && m <= 30) return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
            return d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
          }
        },
        localization: {
          timeFormatter: (time) => {
            const d = new Date(time * 1000);
            return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
          }
        },
      });
      gexChartObjRef.current = chart;
      const series = chart.addCandlestickSeries({
        upColor: "#0a8f55", downColor: "#c43030", borderUpColor: "#0a8f55", borderDownColor: "#c43030",
        wickUpColor: "#0a8f55", wickDownColor: "#c43030",
      });
      // Fetch OHLC data
      fetch(`${API_BASE}/api/schwab/chart-ohlc?sym=${encodeURIComponent(gexTicker)}&range=${gexChartRange}`)
        .then(r=>r.ok?r.json():null).then(d=>{
          if (!d || !d.candles || d.candles.length === 0) return;
          series.setData(d.candles);
          chart.timeScale().fitContent();
          // Draw GEX price lines
          const cw = gexData.callWall;
          const pw = gexData.putWall;
          const zg = gexData.zeroGamma;
          const sp = gexData.spot || 0;
          const fmtG = v => { const abs=Math.abs(v); if(abs>=1e9) return "$"+(abs/1e9).toFixed(1)+"B"; if(abs>=1e6) return "$"+(abs/1e6).toFixed(1)+"M"; if(abs>=1e3) return "$"+(abs/1e3).toFixed(0)+"K"; return "$"+abs.toFixed(0); };
          const wallMax = Math.max(cw?.gex||0, Math.abs(pw?.gex||0));
          const getLineWeight = (gexVal) => {
            const ratio = wallMax > 0 ? Math.abs(gexVal) / wallMax : 0;
            if (ratio > 0.8) return { lw:4, ls:0 };  // wall-level
            if (ratio > 0.5) return { lw:3, ls:0 };  // major
            if (ratio > 0.25) return { lw:2, ls:0 }; // solid secondary
            return { lw:1, ls:2 };                    // minor dashed
          };

          // Call wall + Put wall
          if (cw && pw && cw.strike === pw.strike) {
            // Same strike — combined pin/gravity zone
            const combined = cw.gex + Math.abs(pw.gex);
            const proximity = Math.abs(cw.strike - sp) / sp;
            const aboveSpot = cw.strike > sp;
            let label, color;
            if (proximity < 0.003) {
              label = "Pin "+fmtG(combined); color = "#c9a84c"; // purple — price right at pin
            } else if (aboveSpot && proximity < 0.02) {
              label = "Resistance "+fmtG(combined); color = "#c43030"; // metallic silver — contested level, pulling up
            } else if (aboveSpot) {
              label = "Resistance "+fmtG(combined); color = "#c43030"; // red — distant resistance
            } else if (proximity < 0.02) {
              label = "Support ↑ "+fmtG(combined); color = "#00BCD4"; // metallic silver — contested level, pulling down
            } else {
              label = "Support ↑ "+fmtG(combined); color = "#00BCD4"; // cyan — distant support
            }
            series.createPriceLine({ price:cw.strike, color, lineWidth:4, lineStyle:0, axisLabelVisible:true, title:label });
          } else {
            // Different strikes — draw separately
            if (cw) {
              const aboveSpot = cw.strike > sp;
              const cwProx = Math.abs(cw.strike - sp) / sp;
              let label, color;
              if (aboveSpot) {
                label = "Ceiling "+fmtG(cw.gex); color = "#c43030"; // red ceiling
              } else if (cwProx < 0.02) {
                label = "Support ↑ "+fmtG(cw.gex); color = "#00BCD4"; // metallic silver — contested, could be support or pull
              } else {
                label = "Support ↑ "+fmtG(cw.gex); color = "#00BCD4"; // cyan — cleared, now support
              }
              series.createPriceLine({ price:cw.strike, color, lineWidth:4, lineStyle:0, axisLabelVisible:true, title:label });
            }
            if (pw) {
              const belowSpot = pw.strike < sp;
              const pwProx = Math.abs(pw.strike - sp) / sp;
              let label, color;
              if (belowSpot) {
                label = "Bounce "+fmtG(Math.abs(pw.gex)); color = "#0a8f55"; // green bounce
              } else if (pwProx < 0.02) {
                label = "Resistance "+fmtG(Math.abs(pw.gex)); color = "#c43030"; // metallic silver — contested, could be resistance or pull
              } else {
                label = "Resistance "+fmtG(Math.abs(pw.gex)); color = "#c43030"; // red — broken floor now resistance
              }
              series.createPriceLine({ price:pw.strike, color, lineWidth:4, lineStyle:0, axisLabelVisible:true, title:label });
            }
          }
          // Danger line
          if (zg) series.createPriceLine({ price:zg, color:"#ffab00", lineWidth:1, lineStyle:2, axisLabelVisible:true, title:"Danger Line" });

          // Secondary levels — thickness/style scales with $ value
          const usedStrikes = new Set([cw?.strike, pw?.strike].filter(Boolean));

          // Above spot — all resistance = red
          const aboveCandidates = [...(gexData.strikes||[])].filter(s=>s.strike>sp&&!usedStrikes.has(s.strike)).map(s=>{
            const callVal = s.callGex > 0 ? s.callGex : 0;
            const putVal = s.putGex < 0 ? Math.abs(s.putGex) : 0;
            const best = callVal >= putVal ? { val:callVal, type:"call" } : { val:putVal, type:"put" };
            return { strike:s.strike, gex:best.val, type:best.type };
          }).filter(s=>s.gex>0).sort((a,b)=>b.gex-a.gex).slice(0,3);
          aboveCandidates.forEach(s => {
            usedStrikes.add(s.strike);
            const {lw,ls,op} = getLineWeight(s.gex);
            const label = s.type === "call" ? "Ceiling "+fmtG(s.gex) : "Weak Spot "+fmtG(s.gex);
            series.createPriceLine({ price:s.strike, color:"#c43030"+op, lineWidth:lw, lineStyle:ls, axisLabelVisible:true, title:label });
          });

          // Below spot — all support = green/cyan
          const belowCandidates = [...(gexData.strikes||[])].filter(s=>s.strike<sp&&!usedStrikes.has(s.strike)).map(s=>{
            const callVal = s.callGex > 0 ? s.callGex : 0;
            const putVal = s.putGex < 0 ? Math.abs(s.putGex) : 0;
            const best = callVal >= putVal ? { val:callVal, type:"call" } : { val:putVal, type:"put" };
            return { strike:s.strike, gex:best.val, type:best.type };
          }).filter(s=>s.gex>0).sort((a,b)=>b.gex-a.gex).slice(0,3);
          belowCandidates.forEach(s => {
            const {lw,ls,op} = getLineWeight(s.gex);
            const baseColor = s.type === "call" ? "#00BCD4" : "#0a8f55";
            const label = s.type === "call" ? "Support ↑ "+fmtG(s.gex) : "Bounce "+fmtG(s.gex);
            series.createPriceLine({ price:s.strike, color:baseColor+op, lineWidth:lw, lineStyle:ls, axisLabelVisible:true, title:label });
          });
        }).catch(()=>{});
      // Resize observer
      const ro = new ResizeObserver(() => { if (el.clientWidth > 0) chart.applyOptions({ width: el.clientWidth }); });
      ro.observe(el);
      return () => { ro.disconnect(); };
    };
    if (window.LightweightCharts) { loadAndRender(); }
    else {
      const script = document.createElement("script");
      script.src = LWC_URL;
      script.onload = loadAndRender;
      document.head.appendChild(script);
    }
    return () => { if (gexChartObjRef.current) { gexChartObjRef.current.remove(); gexChartObjRef.current = null; } };
  }, [showGexChart, gexTicker, gexChartRange, gexData]);

  // ─── Shared detail panel renderer ─────────────────────────────────────────
  function renderDetailPanel(sym, cp, K, exp, onClose) {
    if (!sym || !cp || !K || !exp) return null;
    // Render as fixed modal overlay — appears centered over page
    const modal = (content) => (
      <div onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}
        style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.75)",
          display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"40px 16px", overflowY:"auto" }}>
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
    const curPrice = px ? (px.mark || px.last || px.mid || 0) : 0;
    // Auto-fetch live price if not in cache yet
    if (!px) {
      fetch(API_BASE+"/api/schwab/options-quotes", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify([{symbol:sym, cp, strike:parseFloat(K), expDate:expToISO(exp)}]),
      }).then(r=>r.ok?r.json():null).then(data=>{
        const q=data?.quotes?.[0];
        if(q&&!q.error&&!q.expired){
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
      <div style={{ background:P.cd, border:"1px solid "+P.bl, borderRadius:12, overflow:"hidden",
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
            <div ref={el=>{
              if (!el || el._tvInit) return;
              el._tvInit = true;
              const buildChart = () => {
                const LWC = window.LightweightCharts;
                if (!LWC) return;
                el.innerHTML = "";
                const chart = LWC.createChart(el, {
                  width:el.clientWidth, height:320,
                  layout:{background:{color:"#0d1117"},textColor:"#7b8fa3",fontSize:9},
                  grid:{vertLines:{color:"#1a254022"},horzLines:{color:"#1a254022"}},
                  crosshair:{mode:0}, rightPriceScale:{borderColor:"#1a2540"},
                  timeScale:{borderColor:"#1a2540",timeVisible:true,secondsVisible:false,
                    tickMarkFormatter:(t)=>{const d=new Date(t*1000);const h=parseInt(d.toLocaleString("en-US",{timeZone:"America/New_York",hour:"numeric",hour12:false}));const m=parseInt(d.toLocaleString("en-US",{timeZone:"America/New_York",minute:"numeric"}));if(h<=10&&m<=30)return d.toLocaleString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric"});return d.toLocaleString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit",hour12:true});}},
                  localization:{timeFormatter:t=>{const d=new Date(t*1000);return d.toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});}},
                });
                const s = chart.addCandlestickSeries({upColor:"#0a8f55",downColor:"#c43030",borderUpColor:"#0a8f55",borderDownColor:"#c43030",wickUpColor:"#0a8f55",wickDownColor:"#c43030"});
                fetch(`${API_BASE}/api/schwab/chart-ohlc?sym=${encodeURIComponent(sym)}&range=${chartRange}`).then(r=>r.ok?r.json():null).then(d=>{
                  if(d?.candles?.length){s.setData(d.candles);chart.timeScale().fitContent();}
                }).catch(()=>{});
                const ro=new ResizeObserver(()=>{if(el.clientWidth>0)chart.applyOptions({width:el.clientWidth});});
                ro.observe(el);
                el._tvCleanup=()=>{ro.disconnect();chart.remove();};
              };
              if (window.LightweightCharts) { buildChart(); }
              else {
                el.innerHTML="<div style='color:#555;padding:20px;font-size:11px'>Loading chart...</div>";
                const sc=document.createElement("script");
                sc.src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js";
                sc.onload=buildChart;
                document.head.appendChild(sc);
              }
            }} style={{ width:"100%", height:320 }} />
            <div style={{ position:"absolute", top:8, right:8, display:"flex", gap:4, zIndex:2 }}>
              {[["5m","5m"],["15m","15m"],["1D","1D"],["1mo","1M"],["3mo","3M"],["6mo","6M"],["1y","1Y"]].map(([val,label])=>(
                <button key={val} onClick={e=>{e.stopPropagation();setChartRange(val);}}
                  style={{ padding:"2px 7px", borderRadius:4, border:"1px solid "+(chartRange===val?P.ac:P.bd+"80"),
                    background:chartRange===val?P.ac+"22":"rgba(6,9,15,0.75)", color:chartRange===val?P.ac:P.dm,
                    fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", height:320 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, fontSize:9, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:6, flexShrink:0 }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:8, height:8, borderRadius:2, background:"#ff6d00", display:"inline-block", flexShrink:0 }}>{""}</span> Vol</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:8, height:8, borderRadius:2, background:"#6ba3be", display:"inline-block", flexShrink:0 }}>{""}</span> OI</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ width:14, height:3, borderRadius:2, background:"#c9a84c", display:"inline-block", flexShrink:0 }}>{""}</span> Contract Price</span>
            </div>
            <div style={{ width:"100%", flex:1, minHeight:0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trimmed} margin={{ top:4, right:4, left:-8, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2540" />
                  <XAxis dataKey="day" tick={{ fontSize:9, fill:"#7b8fa3" }}
                    interval={trimmed.length>15?"preserveStartEnd":trimmed.length>10?1:0}
                    angle={-45} textAnchor="end" height={32}
                    tickFormatter={v=>v==="Now"?"Now":v.split("/").slice(0,2).join("/")} />
                  <YAxis yAxisId="price" orientation="left" tick={{ fontSize:9, fill:"#c9a84c" }}
                    tickFormatter={v=>"$"+v.toFixed(1)} width={36} domain={[dm=>Math.max(0,dm*0.8),dm=>dm*1.1]} />
                  <YAxis yAxisId="voloi" orientation="right" tick={{ fontSize:9, fill:"#7b8fa3" }}
                    tickFormatter={v=>fK(v)} width={42} />
                  <Tooltip contentStyle={{ background:P.cd, border:"1px solid "+P.bl+"", borderRadius:6, fontSize:9, padding:"6px 10px" }}
                    formatter={(val,name)=>{ if(name==="price") return ["$"+val.toFixed(2),"Price"]; if(name==="vol") return [fK(val),"Volume"]; return [val.toLocaleString(),"OI"]; }}
                    labelFormatter={v=>v==="Now"?"Live":v.split("/").slice(0,2).join("/")} />
                  <Bar yAxisId="voloi" dataKey="vol" fill="#ff6d00" opacity={0.8} radius={[1,1,0,0]} barSize={trimmed.length>15?4:6} />
                  <Bar yAxisId="voloi" dataKey="oi" fill="#6ba3be" opacity={0.7} radius={[1,1,0,0]} barSize={trimmed.length>15?4:6} />
                  <Line yAxisId="price" dataKey="price" type="monotone" stroke="#c9a84c" strokeWidth={2} strokeOpacity={0.5}
                    dot={{ r:4, fill:"#c9a84c", stroke:"#1a1c17", strokeWidth:1.5 }} connectNulls />
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
          const tk = D ? FD.TICKER_DB.find(t=>t.s===sym) : null;
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
                  <thead><tr style={{ borderBottom:"1px solid "+P.bd, position:"sticky", top:0, background:P.cd }}>
                    {["Day","Time","Type","Side","Color","Vol","OI","Premium","Price"].map(h=>(
                      <th key={h} style={{ padding:"3px 6px", textAlign:h==="Premium"||h==="Price"||h==="Vol"||h==="OI"?"right":"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
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
          const tk = D ? FD.TICKER_DB.find(t=>t.s===sym) : null;
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
                    {["Exp","Strike","C/P","Type","Side","Color","Vol","Premium"].map(h=>(
                      <th key={h} style={{ padding:"3px 6px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
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

  // ─── Loading / Error / Upload States (AFTER all hooks) ──────────────
  if (csvLoading) return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,border:"3px solid #1a2540",borderTop:"3px solid #3cb868",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{color:"#7b8fa3",fontSize:13}}>Processing flow data...</div>
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      </div>
    </div>
  );
  if (!D && dataMode !== "gex" && dataMode !== "darkpool") return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}
      onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop}>
      <div style={{textAlign:"center",maxWidth:460}}>
        {/* Mode toggle */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}>
          <div style={{ display:"flex", background:"#111a2e", borderRadius:8, padding:3, border:"1px solid #1a2540" }}>
            {[["stocks","Stocks"],["index","Indexes / ETF's"],["darkpool","Dark Pool"],["gex","GEX"]].map(([m,label])=>(
              <button key={m} onClick={()=>switchMode(m)} style={{
                padding:"8px 28px", borderRadius:6, border:(m==="gex"||m==="darkpool")?`1px solid ${m==="darkpool"?"#6ba3be55":"#c9a84c55"}`:"none", cursor:"pointer",
                fontSize:14, fontWeight:800, fontFamily:"inherit", letterSpacing:0.5,
                background:dataMode===m?(m==="gex"?"#c9a84c33":m==="darkpool"?"#6ba3be33":"#0d1321"):"transparent",
                color:dataMode===m?(m==="gex"?"#c9a84c":m==="darkpool"?"#6ba3be":"#f0f4f8"):(m==="gex"?"#c9a84c":m==="darkpool"?"#6ba3be":"#4a5c73"),
                boxShadow:dataMode===m?"0 2px 8px rgba(0,0,0,0.3)":"none",
                transition:"all 0.15s"
              }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{fontSize:32,marginBottom:12}}>📂</div>
        <div style={{color:"#ffab00",fontSize:16,fontWeight:700,marginBottom:8}}>{dataMode==="index"?"Indexes / ETF's Flow":"Options Flow"} — Admin Upload</div>
        <div style={{color:"#7b8fa3",fontSize:12,marginBottom:20}}>Drag & drop your <strong style={{color:"#ffab00"}}>{dataMode==="index"?"Indexes-data.csv":"flow-data.csv"}</strong> export here, or click to select.</div>
        <div style={{
          border:"2px dashed "+(dragOver?"#3cb868":P.bd), borderRadius:12, padding:"40px 20px",
          background:dragOver?"#3cb86810":"#0d1321", transition:"all 0.2s", cursor:"pointer", marginBottom:12
        }} onClick={()=>document.getElementById("csv-admin-input").click()}>
          <div style={{fontSize:36,marginBottom:8}}>{dragOver?"📥":"📄"}</div>
          <div style={{color:dragOver?"#3cb868":"#c8d6e5",fontSize:13,fontWeight:600}}>{dragOver?"Drop CSV here":"Click or drag CSV file"}</div>
          <input id="csv-admin-input" type="file" accept=".csv" style={{display:"none"}} onChange={onFileInput}/>
        </div>
        {csvError && (
          <div style={{marginTop:12}}>
            <div style={{color:"#e74c3c",fontSize:12,fontWeight:700,marginBottom:4}}>Error</div>
            <div style={{color:"#7b8fa3",fontSize:11}}>{csvError}</div>
          </div>
        )}
      </div>
    </div>
  );

  const shortDir = FD ? (FD.shortBullTotal >= FD.shortBearTotal ? "BULL" : "BEAR") : "BULL";
  const longDir = FD ? (FD.longBullTotal >= FD.longBearTotal ? "BULL" : "BEAR") : "BULL";
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
      // Schwab batch quotes — dynamic batch size based on total contracts
      const BATCH_SIZE = unique.length > 50 ? 20 : unique.length > 20 ? 10 : 5;
      const BATCH_DELAY = unique.length > 50 ? 400 : 800;
      let successes = 0, failures = 0, expired = 0;
      for (let b = 0; b < unique.length; b += BATCH_SIZE) {
        const batch = unique.slice(b, b + BATCH_SIZE);
        setStatus(`Fetching batch ${Math.floor(b/BATCH_SIZE)+1}/${Math.ceil(unique.length/BATCH_SIZE)} (${b+batch.length}/${unique.length} contracts)…`);
        try {
          let resp = await fetch(API_BASE+"/api/schwab/options-quotes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch.map(c => ({ symbol:c.symbol, strike:c.strike, expDate:c.expDate, cp:c.cp }))),
          });
          if (!resp.ok) { failures += batch.length; continue; }
          const data = await resp.json();
          const quotes = data.quotes || [];
          quotes.forEach((q, i) => {
            const orig = batch[i];
            if (!orig) return;
            if (q.expired) { expired++; return; }
            if (q.error) { failures++; return; }
            const key = orig.symbol+"|"+orig.cp+"|"+orig.strike+"|"+orig._exp;
            newCache[key] = {
              mark: q.mark||0, bid: q.bid||0, ask: q.ask||0, last: q.last||0,
              mid: (q.mark||0) > 0 ? 0 : ((q.bid||0)+(q.ask||0))/2,
              delta: q.delta||0, theta: q.theta||0, iv: q.iv||0,
              oi: q.openInterest||0, vol: q.volume||0, spot: q.underlyingPrice||0,
            };
            if (updated) {
              const match = updated.find(u => u.sym===orig.symbol && u.cp===orig.cp && parseFloat(u.strike)===orig.strike && u.exp===orig._exp);
              if (match) match.now = q.mark || q.last || 0;
            }
            successes++;
          });
          setPriceCache({...newCache});
        } catch(e) { failures += batch.length; }
        if (b + BATCH_SIZE < unique.length) await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
      if (updated) setPerf(updated);
      setStatus(`Done. ${successes} priced` + (expired > 0 ? `, ${expired} expired` : ``) + (failures > 0 ? `, ${failures} failed` : ``) + ` of ${unique.length} contracts.`);
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

  // ─── Fetch contract history + live quote on hover ───────────────────
  async function fetchContractHistory(sym, cp, strike, exp, force = false) {
    const k = `${sym}|${cp}|${parseFloat(strike)}|${exp}`;

    // 1. Fetch history from Schwab backfill + tracker
    if ((contractHistory[k] == null || force) && !fetchingRef.current.has(k)) {
      fetchingRef.current.add(k);
      try {
        await fetch(`${API_BASE}/api/schwab/backfill-contract?sym=${encodeURIComponent(sym)}&cp=${encodeURIComponent(cp)}&strike=${parseFloat(strike)}&exp=${encodeURIComponent(exp)}`).catch(() => {});
        const params = new URLSearchParams({ sym, cp, strike: String(parseFloat(strike)), exp });
        const resp = await fetch(`${API_BASE}/api/schwab/contract-history?${params}`);
        if (resp.ok) {
          const data = await resp.json();
          setContractHistory(prev => ({ ...prev, [k]: data.history || [] }));
        } else {
          setContractHistory(prev => ({ ...prev, [k]: [] }));
        }
      } catch(e) {
        setContractHistory(prev => ({ ...prev, [k]: [] }));
      } finally {
        fetchingRef.current.delete(k);
      }
    }

    // 2. Auto-fetch live quote if not already cached
    const priceCacheKey = `${sym}|${cp}|${parseFloat(strike)}|${exp}`;
    if (!priceCache[priceCacheKey]) {
      try {
        const resp = await fetch(API_BASE+"/api/schwab/options-quotes", {
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

  async function fetchGex(ticker, dte) {
    if (!ticker) return;
    setGexLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/gex/data?ticker=${encodeURIComponent(ticker)}&dte=${dte}`);
      if (resp.ok) {
        const data = await resp.json();
        data.fetchedAt = new Date().toLocaleString("en-US", { timeZone:"America/New_York", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
        setGexData(data);
      } else {
        setGexData({ error: `API error: ${resp.status}` });
      }
    } catch(e) {
      setGexData({ error: e.message });
    }
    setGexLoading(false);
  }

  async function fetchIdeaGex(sym) {
    setIdeaGex({ sym, data:null, loading:true });
    try {
      const resp = await fetch(`${API_BASE}/api/gex/data?ticker=${encodeURIComponent(sym)}&dte=month`);
      if (resp.ok) {
        const data = await resp.json();
        data.fetchedAt = new Date().toLocaleString("en-US", { timeZone:"America/New_York", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
        setIdeaGex({ sym, data, loading:false });
      } else {
        setIdeaGex({ sym, data:{ error:"API error: "+resp.status }, loading:false });
      }
    } catch(e) {
      setIdeaGex({ sym, data:{ error:e.message }, loading:false });
    }
  }

  async function fetchMarketData() {
    // Fetch index quotes
    try {
      const resp = await fetch(API_BASE+"/api/schwab/market-summary");
      if (resp.ok) {
        const data = await resp.json();
        setMarketIndices(data.indices || []);
      }
    } catch(e) { console.warn("Market indices error:", e); }
    // Fetch AI narrative
    setNarrativeLoading(true);
    try {
      const resp = await fetch(API_BASE+"/api/schwab/market-narrative");
      if (resp.ok) {
        const data = await resp.json();
        setMarketNarrative(data.narrative || null);
      }
    } catch(e) { console.warn("Narrative error:", e); }
    setNarrativeLoading(false);
  }


  return (
    <div style={{ background:P.bg, color:P.tx, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", minHeight:"100vh", padding:"16px 20px", zoom:1.18 }}>
      <div style={{ maxWidth:1280, margin:"0 auto" }}>

        {/* Data Mode Toggle */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}>
          <div style={{ display:"flex", background:P.al, borderRadius:8, padding:3, border:"1px solid "+P.bd }}>
            {[["stocks","Stocks"],["index","Indexes / ETF's"],["darkpool","Dark Pool"],["gex","GEX"]].map(([m,label])=>(
              <button key={m} onClick={()=>switchMode(m)} style={{
                padding:"8px 28px", borderRadius:6, border:(m==="gex"||m==="darkpool")?(dataMode===m?"1px solid "+(m==="darkpool"?"#6ba3be":"#c9a84c"):"1px solid "+(m==="darkpool"?"#6ba3be55":"#c9a84c55")):"none", cursor:"pointer",
                fontSize:14, fontWeight:800, fontFamily:"inherit", letterSpacing:0.5,
                background:dataMode===m?(m==="gex"?"#c9a84c33":m==="darkpool"?"#6ba3be33":P.cd):"transparent", color:dataMode===m?(m==="gex"?"#c9a84c":m==="darkpool"?"#6ba3be":P.wh):(m==="gex"?"#c9a84c":m==="darkpool"?"#6ba3be":P.mt),
                boxShadow:dataMode===m?("0 2px 8px rgba(0,0,0,0.3)"):"none",
                transition:"all 0.15s"
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Date Filter — pills for ≤5 dates, dropdown for more */}
        {dataMode !== "gex" && dataMode !== "darkpool" && availableDates.length > 1 && (
          <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
            {availableDates.length <= 5 ? (
              <div style={{ display:"flex", gap:2, background:P.al, borderRadius:6, padding:2, border:"1px solid "+P.bd, flexWrap:"wrap", justifyContent:"center" }}>
                <button onClick={()=>setDateFilter("All")} style={{
                  padding:"5px 14px", borderRadius:4, border:"none", cursor:"pointer",
                  fontSize:10, fontWeight:700, fontFamily:"inherit",
                  background:dateFilter==="All"?P.cd:"transparent", color:dateFilter==="All"?P.ac:P.mt
                }}>All · {availableDates.length}d</button>
                {availableDates.map(d=>(
                  <button key={d} onClick={()=>setDateFilter(d)} style={{
                    padding:"5px 12px", borderRadius:4, border:"none", cursor:"pointer",
                    fontSize:10, fontWeight:600, fontFamily:"inherit",
                    background:dateFilter===d?P.cd:"transparent", color:dateFilter===d?P.wh:P.mt
                  }}>{fmtDatePill(d)}</button>
                ))}
              </div>
            ) : (
              <div style={{ display:"flex", gap:6, alignItems:"center", background:P.al, borderRadius:6, padding:4, border:"1px solid "+P.bd }}>
                {["Last3","Last5"].map(v=>{
                  const n = parseInt(v.replace("Last",""));
                  const label = "Last "+n+"d";
                  return (
                    <button key={v} onClick={()=>setDateFilter(v)} style={{
                      padding:"5px 12px", borderRadius:4, border:"none", cursor:"pointer",
                      fontSize:10, fontWeight:700, fontFamily:"inherit",
                      background:dateFilter===v?P.cd:"transparent", color:dateFilter===v?P.ac:P.mt
                    }}>{label}</button>
                  );
                })}
                <button onClick={()=>setDateFilter("All")} style={{
                  padding:"5px 12px", borderRadius:4, border:"none", cursor:"pointer",
                  fontSize:10, fontWeight:700, fontFamily:"inherit",
                  background:dateFilter==="All"?P.cd:"transparent", color:dateFilter==="All"?P.ac:P.mt
                }}>All {availableDates.length}d</button>
                <span style={{ width:1, height:16, background:P.bd }}/>
                <select value={dateFilter.startsWith("Last")||dateFilter==="All"?"":dateFilter}
                  onChange={e=>e.target.value&&setDateFilter(e.target.value)}
                  style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:4, color:P.wh, fontSize:10, padding:"5px 8px", fontFamily:"inherit", fontWeight:600, minWidth:120 }}>
                  <option value="">Select date...</option>
                  {[...availableDates].reverse().map(d=>(
                    <option key={d} value={d}>{fmtDatePill(d)}</option>
                  ))}
                </select>
                <span style={{ fontSize:9, color:P.dm }}>{availableDates.length} trading days</span>
              </div>
            )}
          </div>
        )}

        {dataMode==="gex" && (()=>{
          const fmtGex = v => {
            if (v === null || v === undefined || isNaN(v)) return "—";
            const abs = Math.abs(v);
            const sign = v < 0 ? "-" : "";
            if (abs >= 1e9) return sign + "$" + (abs/1e9).toFixed(2) + "B";
            if (abs >= 1e6) return sign + "$" + (abs/1e6).toFixed(1) + "M";
            if (abs >= 1e3) return sign + "$" + (abs/1e3).toFixed(0) + "K";
            return sign + "$" + abs.toFixed(0);
          };
          const quickTickers = ["SPY","QQQ","IWM","SPX","NDX","DIA"];
          // Filter strikes to within ±12% of spot for readability
          const spot = gexData?.spot || 0;
          const visibleStrikes = gexData?.strikes ?
            gexData.strikes.filter(s => spot > 0 ? Math.abs(s.strike - spot) / spot <= 0.12 : true)
              .map(s => ({ ...s, label: "$"+s.strike })) : [];
          const hasError = gexData?.error;
          return (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                <div style={{ width:3, background:"#c9a84c", borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#c9a84c", marginBottom:5 }}>Gamma Exposure (GEX)</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>Shows where big options activity creates price levels. Ceiling = price struggles above. Floor = price bounces here. Danger line = below this, drops get faster.</div>
                </div>
              </div>
            </Card>

            {/* Search + Quick Tickers + DTE */}
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
              <div style={{ display:"flex", gap:6, flex:"1 1 300px" }}>
                <input type="text" value={gexInput}
                  onChange={e=>setGexInput(e.target.value.toUpperCase())}
                  onKeyDown={e=>{ if(e.key==="Enter") setGexTicker(gexInput.trim()); }}
                  placeholder="Enter ticker (SPY, NVDA, etc)"
                  style={{ flex:1, padding:"8px 14px", borderRadius:6, fontSize:12, fontWeight:600, background:P.al, border:"1px solid "+P.bl, color:P.wh, fontFamily:"inherit", outline:"none", letterSpacing:1 }} />
                <button onClick={()=>setGexTicker(gexInput.trim())}
                  style={{ padding:"8px 18px", borderRadius:6, border:"none", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"inherit", background:"#c9a84c", color:P.bg }}>
                  Load
                </button>
              </div>
              <div style={{ display:"flex", gap:4 }}>
                {quickTickers.map(t=>(
                  <button key={t} onClick={()=>{ setGexInput(t); setGexTicker(t); }}
                    style={{ padding:"6px 12px", borderRadius:4, border:"1px solid "+P.bl, background:gexTicker===t?("#c9a84c22"):P.al, color:gexTicker===t?"#c9a84c":P.mt, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                    {t}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", gap:2, background:P.al, borderRadius:5, padding:2 }}>
                {[["0dte","0DTE"],["1dte","1DTE"],["2dte","2DTE"],["3dte","3DTE"],["week","Week"],["month","Month"],["all","All"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setGexDte(v)} style={{
                    padding:"5px 14px", borderRadius:4, border:"none", cursor:"pointer",
                    fontSize:10, fontWeight:600, fontFamily:"inherit",
                    background:gexDte===v?P.cd:"transparent", color:gexDte===v?P.wh:P.mt
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {gexLoading && <Card><div style={{ textAlign:"center", padding:"40px 0", color:P.dm, fontSize:12 }}>Loading gamma data for {gexTicker}…</div></Card>}

            {!gexLoading && hasError && (
              <Card>
                <div style={{ textAlign:"center", padding:"30px 0", color:P.be, fontSize:12 }}>
                  <div style={{ marginBottom:6, fontWeight:700 }}>Unable to load GEX data</div>
                  <div style={{ color:P.dm, fontSize:11 }}>{gexData.error}</div>
                </div>
              </Card>
            )}

            {!gexLoading && !hasError && gexData && (
              <>
                {/* Key Level Cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:8 }}>
                  <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:8, padding:14, borderLeft:"3px solid "+P.wh }}>
                    <div style={{ fontSize:9, color:P.dm, marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Spot</div>
                    <div style={{ fontSize:18, fontWeight:900, color:P.wh }}>${gexData.spot?.toFixed(2)}</div>
                    <div style={{ fontSize:9, color:P.dm, marginTop:3 }}>{gexData.ticker}</div>
                  </div>
                  <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:8, padding:14, borderLeft:"3px solid "+P.ac }}>
                    <div style={{ fontSize:9, color:P.dm, marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Danger Line</div>
                    <div style={{ fontSize:18, fontWeight:900, color:P.ac }}>{gexData.zeroGamma ? "$"+gexData.zeroGamma.toFixed(2) : "—"}</div>
                    <div style={{ fontSize:9, color:P.dm, marginTop:3 }}>
                      {gexData.zeroGamma && gexData.spot ? ((gexData.spot - gexData.zeroGamma)/gexData.zeroGamma*100).toFixed(2)+"% above" : ""}
                    </div>
                  </div>
                  <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:8, padding:14, borderLeft:"3px solid "+P.bu }}>
                    <div style={{ fontSize:9, color:P.dm, marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Ceiling</div>
                    <div style={{ fontSize:18, fontWeight:900, color:P.bu }}>{gexData.callWall ? "$"+gexData.callWall.strike : "—"}</div>
                    <div style={{ fontSize:9, color:P.dm, marginTop:3 }}>{gexData.callWall ? fmtGex(gexData.callWall.gex) : ""} ceiling</div>
                  </div>
                  <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:8, padding:14, borderLeft:"3px solid "+P.be }}>
                    <div style={{ fontSize:9, color:P.dm, marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Floor</div>
                    <div style={{ fontSize:18, fontWeight:900, color:P.be }}>{gexData.putWall ? "$"+gexData.putWall.strike : "—"}</div>
                    <div style={{ fontSize:9, color:P.dm, marginTop:3 }}>{gexData.putWall ? fmtGex(gexData.putWall.gex) : ""} floor</div>
                  </div>
                  <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:8, padding:14, borderLeft:"3px solid #c9a84c" }}>
                    <div style={{ fontSize:9, color:P.dm, marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Total GEX</div>
                    <div style={{ fontSize:18, fontWeight:900, color:gexData.totalGex>0?P.bu:P.be }}>{fmtGex(gexData.totalGex)}</div>
                    <div style={{ fontSize:9, color:P.dm, marginTop:3 }}>{gexData.zeroGamma && gexData.spot < gexData.zeroGamma ? "⚠️ Below danger line" : gexData.totalGex > 0 ? "Safety net ON" : "Safety net OFF"}</div>
                  </div>
                </div>

                {/* GEX Bar Chart */}
                <Card title={"GEX by Strike — "+gexData.ticker} sub={visibleStrikes.length+" strikes · ±12% of spot"}>
                  <div style={{ height:Math.max(400, visibleStrikes.length*18) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={visibleStrikes} layout="vertical" margin={{ top:4, right:20, left:20, bottom:4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2540" />
                        <XAxis type="number" tick={{ fontSize:10, fill:"#7b8fa3" }}
                          tickFormatter={v=>fmtGex(v)} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize:10, fill:"#7b8fa3" }}
                          width={60} reversed />
                        <Tooltip contentStyle={{ background:P.cd, border:"1px solid "+P.bl+"", borderRadius:6, fontSize:11 }}
                          formatter={(val, name) => [fmtGex(val), name === "callGex" ? "Call GEX" : name === "putGex" ? "Put GEX" : "Net GEX"]} />
                        <ReferenceLine x={0} stroke="#7b8fa3" strokeWidth={1} />
                        {gexData.zeroGamma && <ReferenceLine y={"$"+Math.round(gexData.zeroGamma)} stroke={P.ac} strokeDasharray="3 3" label={{ value:"0γ", position:"right", fill:P.ac, fontSize:10 }} />}
                        {gexData.spot && <ReferenceLine y={"$"+Math.round(gexData.spot)} stroke={P.wh} strokeWidth={2} label={{ value:"Spot", position:"right", fill:P.wh, fontSize:10, fontWeight:700 }} />}
                        <Bar dataKey="callGex" fill={P.bu} opacity={0.85} />
                        <Bar dataKey="putGex" fill={P.be} opacity={0.85} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>


                {/* Action Buttons */}
                <div style={{ display:"flex", justifyContent:"center", gap:10, marginTop:4 }}>
                  <button onClick={()=>setShowGexChart(!showGexChart)} style={{
                    padding:"10px 28px", borderRadius:6, border:"1px solid "+P.ac, cursor:"pointer",
                    fontSize:12, fontWeight:700, fontFamily:"inherit", letterSpacing:0.5,
                    background:showGexChart?P.ac+"22":"transparent", color:P.ac
                  }}>
                    {showGexChart ? "✕ Hide Chart" : "📈 Chart with Levels"}
                  </button>
                  <button onClick={()=>setShowGexSummary(!showGexSummary)} style={{
                    padding:"10px 28px", borderRadius:6, border:"1px solid #c9a84c", cursor:"pointer",
                    fontSize:12, fontWeight:700, fontFamily:"inherit", letterSpacing:0.5,
                    background:showGexSummary?"#c9a84c22":"transparent", color:"#c9a84c"
                  }}>
                    {showGexSummary ? "✕ Hide Summary" : "🔮 Generate Summary"}
                  </button>
                </div>

                {/* GEX Chart with Levels */}
                {showGexChart && gexData && !gexData.error && (
                  <div style={{ background:P.cd, borderRadius:10, padding:12, border:"1px solid "+P.bd, marginTop:4 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:P.ac, textTransform:"uppercase", letterSpacing:1 }}>{gexData.ticker} Chart with GEX Levels</span>
                      <div style={{ display:"flex", gap:4 }}>
                        {[["5min","5m"],["10min","10m"],["15min","15m"],["30min","30m"],["65min","65m"],["1d","1D"],["5d","5D"],["1mo","1M"],["3mo","3M"],["6mo","6M"],["1y","1Y"]].map(([val,label])=>(
                          <button key={val} onClick={()=>setGexChartRange(val)}
                            style={{ padding:"3px 8px", borderRadius:4, border:"1px solid "+(gexChartRange===val?P.ac:P.bd+"80"),
                              background:gexChartRange===val?P.ac+"22":"transparent", color:gexChartRange===val?P.ac:P.dm,
                              fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div ref={gexChartRef} style={{ width:"100%", height:500, borderRadius:6, overflow:"hidden" }} />
                  </div>
                )}

                {/* GEX Summary Panel */}
                {showGexSummary && gexData && (()=>{
                  const sp = gexData.spot;
                  const cw = gexData.callWall;
                  const pw = gexData.putWall;
                  const zg = gexData.zeroGamma;
                  const tg = gexData.totalGex;
                  if (!sp || !cw || !pw) return null;
                  const cwStrike = cw.strike, pwStrike = pw.strike, cwGex = cw.gex, pwGex = Math.abs(pw.gex);
                  const SG = "#0a8f55", SR = "#c43030"; // darker bar fills for summary
                  const isIntraday = gexDte === "0dte" || gexDte === "1dte";
                  const timeframe = isIntraday ? "today" : "this week";

                  // Net delta tracking — store all readings for daily trend sparkline
                  const nd = gexData.netDelta;
                  const today = new Date().toLocaleDateString("en-US");
                  const ndRef = prevNetDeltaRef.current || {};
                  let ndChange = null, ndImproving = null, ndReadings = [];
                  if (nd != null) {
                    if (ndRef.date !== today) {
                      // New day — reset
                      prevNetDeltaRef.current = { date: today, baseline: nd, readings: [nd] };
                      ndReadings = [nd];
                    } else {
                      // Same day — append if value changed meaningfully (>0.5% shift)
                      const prev = ndRef.readings || [];
                      const lastVal = prev.length > 0 ? prev[prev.length - 1] : null;
                      const threshold = Math.abs(ndRef.baseline || 1) * 0.005;
                      if (lastVal === null || Math.abs(nd - lastVal) > threshold || prev.length === 0) {
                        ndRef.readings = [...prev, nd];
                      }
                      ndReadings = ndRef.readings || prev;
                      ndChange = nd - ndRef.baseline;
                      ndImproving = ndChange > 0;
                    }
                  }

                  const cwAboveSpot = cwStrike > sp;
                  const pwBelowSpot = pwStrike < sp;
                  const cwLabel = cwAboveSpot ? "ceiling" : ((sp - cwStrike) / sp < 0.02 ? "decision point" : "major support below");
                  const pwLabel = pwBelowSpot ? "floor" : "resistance above";
                  const wallsInverted = !cwAboveSpot || !pwBelowSpot;
                  const spotBetweenWalls = cwStrike === pwStrike || (sp >= Math.min(cwStrike,pwStrike) && sp <= Math.max(cwStrike,pwStrike));
                  const wallSpread = Math.abs(cwStrike - pwStrike);
                  const pinSetup = (cwStrike === pwStrike) || (spotBetweenWalls && wallSpread <= Math.max(sp * 0.003, 5));
                  const squeezeSetup = !pinSetup && spotBetweenWalls && wallSpread <= sp * 0.01;

                  const cwRatio = pwGex > 0 ? (cwGex / pwGex).toFixed(1) : "∞";
                  const cwDominant = cwGex > pwGex * 1.5;
                  const pwDominant = pwGex > cwGex * 1.5;
                  const cwPct = Math.round(cwGex / (cwGex + pwGex) * 100);
                  const pwPct = 100 - cwPct;

                  const isPositive = tg > 0 && (!zg || sp >= zg); // positive GEX AND above danger line
                  const belowDangerLine = zg && sp < zg;
                  const zgDist = zg ? ((sp - zg) / zg * 100).toFixed(1) : null;

                  // Pre-compute strike helpers (needed by verdict, setup text, trade ideas)
                  const sortedStrikes = [...(gexData.strikes||[])].filter(s => sp > 0 ? (Math.abs(s.strike - sp) / sp <= 0.08 || s.strike === cwStrike || s.strike === pwStrike) : true);
                  const topCalls = sortedStrikes.filter(s => s.callGex > 0 && s.strike !== cwStrike && s.strike !== pwStrike).sort((a,b) => b.callGex - a.callGex).slice(0, 3);
                  const topPuts = sortedStrikes.filter(s => s.putGex < 0 && s.strike !== cwStrike && s.strike !== pwStrike && !topCalls.find(c => c.strike === s.strike)).sort((a,b) => a.putGex - b.putGex).slice(0, 2);
                  const callsAboveSpot = topCalls.filter(s => s.strike > sp);
                  // For swing targets, skip levels within 1.5% of spot — too close to be a real target
                  const minTargetDist = isIntraday ? 0 : sp * 0.015;
                  const swingCallsAbove = callsAboveSpot.filter(s => s.strike - sp >= minTargetDist);
                  const firstResAbove = swingCallsAbove.length > 0 ? swingCallsAbove.sort((a,b)=>a.strike-b.strike)[0] : (callsAboveSpot.length > 0 ? callsAboveSpot.sort((a,b)=>a.strike-b.strike)[0] : null);
                  const pinHighStrike = Math.max(cwStrike, pwStrike);
                  const callsAbovePin = topCalls.filter(s => s.strike > pinHighStrike);
                  const swingCallsAbovePin = callsAbovePin.filter(s => s.strike - pinHighStrike >= minTargetDist);
                  const firstResAbovePin = swingCallsAbovePin.length > 0 ? swingCallsAbovePin.sort((a,b)=>a.strike-b.strike)[0] : (callsAbovePin.length > 0 ? callsAbovePin.sort((a,b)=>a.strike-b.strike)[0] : null);
                  const putsBelowSpot = topPuts.filter(s => s.strike < sp);
                  const swingPutsBelow = putsBelowSpot.filter(s => sp - s.strike >= minTargetDist);
                  const firstSupBelow = swingPutsBelow.length > 0 ? swingPutsBelow.sort((a,b)=>b.strike-a.strike)[0] : (putsBelowSpot.length > 0 ? putsBelowSpot.sort((a,b)=>b.strike-a.strike)[0] : null);
                  const clearAirAbove = !firstResAbove || (firstResAbove.strike - sp) / sp > 0.005;

                  let verdictText, verdictIcon, verdictBg, verdictColor;
                  if (pinSetup) {
                    if (cwStrike === pwStrike) {
                      if (sp > cwStrike + cwStrike * 0.003) {
                        verdictText = "Price above the $" + cwStrike + " pin — " + fmtGex(cwGex + pwGex) + " is now support below. Pullbacks toward $" + cwStrike + " are buying opportunities.";
                        verdictIcon = "↗"; verdictBg = P.bu+"22"; verdictColor = P.bu;
                      } else if (sp < cwStrike - cwStrike * 0.003) {
                        verdictText = fmtGex(cwGex + pwGex) + " at $" + cwStrike + " pulling price back up. Expect recovery toward $" + cwStrike + (isIntraday?".":" this week.");
                        verdictIcon = "⇡"; verdictBg = P.bu+"22"; verdictColor = P.bu;
                      } else {
                        verdictText = "Ceiling and floor at the same price ($" + cwStrike + ") — " + fmtGex(cwGex + pwGex) + " combined. Price is stuck here. Every push up or down gets pulled back.";
                        verdictIcon = "📌"; verdictBg = P.ac+"22"; verdictColor = P.ac;
                      }
                    } else {
                      verdictText = "Price squeezed between two key levels pulling inward. " + fmtGex(cwGex + pwGex) + " combined traps price in a tight $" + Math.min(cwStrike,pwStrike) + "–$" + Math.max(cwStrike,pwStrike) + " range.";
                      verdictIcon = "📌"; verdictBg = P.ac+"22"; verdictColor = P.ac;
                    }
                  } else if (squeezeSetup) {
                    const lo = Math.min(cwStrike,pwStrike), hi = Math.max(cwStrike,pwStrike);
                    verdictText = "Price squeezed between $" + lo + " floor and $" + hi + " ceiling. " + fmtGex(cwGex + pwGex) + " combined traps price in a $" + wallSpread + " range." + (isIntraday?" Fade the edges.":" Swing the edges this week.");
                    verdictIcon = "↔"; verdictBg = P.ac+"22"; verdictColor = P.ac;
                  } else if (cwDominant && cwAboveSpot) {
                    verdictText = isIntraday ? "Strong ceiling at $" + cwStrike + " — price drifts up but gets rejected there. Buy dips near support, don't chase into the ceiling." : "Strong ceiling at $" + cwStrike + " this week. Buy weekly pullbacks toward support, take profits near the ceiling.";
                    verdictIcon = "↗"; verdictBg = P.bu+"22"; verdictColor = P.bu;
                  } else if (cwDominant && !cwAboveSpot) {
                    const cwProxVerdict = (sp - cwStrike) / sp;
                    if (cwProxVerdict < 0.02) {
                      verdictText = isIntraday ? "Decision point at $" + cwStrike + " — " + fmtGex(cwGex) + " below. Hold above = wall absorbed, next target $" + (firstResAbove ? firstResAbove.strike : cwStrike + Math.round(sp*0.005)) + ". Lose it = quick slide." : "Decision point at $" + cwStrike + " this week. A close above absorbs the wall" + (firstResAbove ? " — target $" + firstResAbove.strike : "") + ". A close below confirms the pull.";
                      verdictIcon = "⚡"; verdictBg = P.ac+"22"; verdictColor = P.ac;
                    } else {
                      // Price well above the call wall — wall is acting as major support
                      verdictText = isIntraday ? "$" + cwStrike + " (" + fmtGex(cwGex) + ") cleared and acting as support below. " + (firstResAbove ? "Next target $" + firstResAbove.strike + "." : "Room to run above.") : "$" + cwStrike + " (" + fmtGex(cwGex) + ") is now major support — price cleared the wall with room above. " + (firstResAbove ? "Swing target $" + firstResAbove.strike + "." : "Buy dips toward $" + cwStrike + ".");
                      verdictIcon = "↗"; verdictBg = P.bu+"22"; verdictColor = P.bu;
                    }
                  } else if (pwDominant && pwBelowSpot) {
                    verdictText = isIntraday ? "Strong floor at $" + pwStrike + " with a weak ceiling above — price wants to go up. Breakout potential." : "Strong weekly floor at $" + pwStrike + ". Buy dips toward it — breakout potential above $" + cwStrike + ".";
                    verdictIcon = "↗"; verdictBg = P.bu+"22"; verdictColor = P.bu;
                  } else if (pwDominant && !pwBelowSpot) {
                    verdictText = isIntraday ? "Gravity pulling price UP toward $" + pwStrike + " — " + fmtGex(pwGex) + " lifting price. Bullish pull." : "$" + pwStrike + " pulling price UP this week — " + fmtGex(pwGex) + " wants price higher. Bullish weekly bias.";
                    verdictIcon = "⇡"; verdictBg = P.bu+"22"; verdictColor = P.bu;
                  } else {
                    verdictText = isIntraday ? "Price bouncing between floor ($" + Math.min(pwStrike,cwStrike) + ") and ceiling ($" + Math.max(pwStrike,cwStrike) + "). Expect choppy back-and-forth." : "Choppy week between $" + Math.min(pwStrike,cwStrike) + " and $" + Math.max(pwStrike,cwStrike) + ". Swing the range — sell premium or fade the edges.";
                    verdictIcon = "↔"; verdictBg = P.ac+"22"; verdictColor = P.ac;
                  }

                  // Build key levels
                  const allLevels = [];

                  topCalls.forEach(s => {
                    const isCW = s.strike === cwStrike;
                    const isMagnet = isCW && !cwAboveSpot;
                    allLevels.push({ strike:s.strike, fillPct:Math.min(95, Math.round(s.callGex/(cwGex||1)*95)),
                      dir:isMagnet?"●":(s.strike>sp?"▲":"●"), dirColor:isMagnet?"#00BCD4":P.bu,
                      label:isCW ? fmtGex(cwGex)+" · "+cwLabel : (s.strike>sp?"ceiling zone":"bounce zone"),
                      tag:isCW?(isMagnet?"support ↑":"ceiling"):(s.strike>sp?"ceiling":"bounce"),
                      tagBg:isCW?(isMagnet?"#00BCD422":"#00BCD422"):(s.strike>sp?"#00BCD422":P.bu+"22"),
                      tagColor:isCW?(isMagnet?"#00BCD4":"#00BCD4"):(s.strike>sp?"#00BCD4":P.bu),
                      fillColor:SG, fillText:"#0d1117", isCW, showMagnet:false, magnetColor:P.be,
                      border:isCW?"1px solid "+P.bu:"none" });
                  });
                  topPuts.forEach(s => {
                    const isPW = s.strike === pwStrike;
                    const isMagnet = isPW && !pwBelowSpot;
                    allLevels.push({ strike:s.strike, fillPct:Math.min(55, Math.round(Math.abs(s.putGex)/(pwGex||1)*55)),
                      dir:isMagnet?"●":"▼", dirColor:isMagnet?"#c43030":P.be,
                      label:isPW ? fmtGex(pwGex)+" · "+pwLabel : "weak spot",
                      tag:isPW?(isMagnet?"resistance":"floor"):"caution",
                      tagBg:isPW?(isMagnet?"#c4303022":P.be+"22"):P.be+"22",
                      tagColor:isPW?(isMagnet?"#c43030":P.be):P.be,
                      fillColor:SR, fillText:"#fff", isPW, showMagnet:false, magnetColor:P.bu,
                      border:isPW?"1px solid "+P.be:"none" });
                  });
                  // Always ensure call wall appears
                  if (!allLevels.find(l => l.strike === cwStrike)) {
                    const isMagnet = !cwAboveSpot;
                    allLevels.push({ strike:cwStrike, fillPct:95,
                      dir:isMagnet?"●":"▲", dirColor:isMagnet?"#00BCD4":P.bu,
                      label:fmtGex(cwGex)+" · "+cwLabel,
                      tag:isMagnet?"support ↑":"ceiling", tagBg:isMagnet?"#00BCD422":"#00BCD422", tagColor:isMagnet?"#00BCD4":"#00BCD4",
                      fillColor:SG, fillText:"#0d1117", isCW:true, showMagnet:false, magnetColor:P.be,
                      border:"1px solid "+P.bu });
                  }
                  // Always ensure put wall appears
                  if (cwStrike === pwStrike) {
                    // Same strike — add combined entry showing both roles
                    const cwEntry = allLevels.find(l => l.strike === cwStrike);
                    if (cwEntry) {
                      const pwMagnetHere = !pwBelowSpot;
                      cwEntry.label = fmtGex(cwGex+pwGex) + " ceiling + floor" + (pwMagnetHere ? " · resistance" : "");
                      cwEntry.tag = !cwAboveSpot ? "support ↑" : pwMagnetHere ? "resistance" : "ceiling + floor";
                      cwEntry.tagBg = pwMagnetHere ? "#c9a84c22" : "#00BCD422";
                      cwEntry.tagColor = pwMagnetHere ? "#c9a84c" : "#00BCD4";
                      if (pwMagnetHere && !cwEntry.showMagnet) cwEntry.magnetColor = P.bu;
                      cwEntry.showMagnet = pwMagnetHere;
                      cwEntry.isPW = true;
                      cwEntry.border = "1px solid #c9a84c";
                      cwEntry.fillPct = 95;
                    }
                  } else if (!allLevels.find(l => l.strike === pwStrike)) {
                    const isMagnet = !pwBelowSpot;
                    allLevels.push({ strike:pwStrike, fillPct:55,
                      dir:isMagnet?"●":"▼", dirColor:isMagnet?"#c43030":P.be,
                      label:fmtGex(pwGex)+" · "+pwLabel,
                      tag:isMagnet?"gravity ↑":"floor", tagBg:isMagnet?P.bu+"22":P.be+"22", tagColor:isMagnet?P.bu:P.be,
                      fillColor:SR, fillText:"#fff", isPW:true, showMagnet:isMagnet, magnetColor:P.bu,
                      border:"1px solid "+P.be });
                  }
                  if (zg) {
                    allLevels.push({ strike:zg, fillPct:100, dir:"⚡", dirColor:P.ac,
                      label:"", tag:"danger line", tagBg:P.ac+"22", tagColor:P.ac,
                      fillColor:P.ac, fillText:P.bg, isZero:true, border:"1px dashed "+P.ac });
                  }
                  allLevels.sort((a,b) => b.strike - a.strike);

                  let setupTitle, setupText;
                  if (pinSetup) {
                    const pinStrikeSetup = cwStrike === pwStrike ? cwStrike : Math.round((cwStrike+pwStrike)/2);
                    const spotAbovePin = sp > pinStrikeSetup;
                    const spotBelowPin = sp < pinStrikeSetup;
                    if (cwStrike === pwStrike) {
                      if (spotAbovePin) {
                        setupTitle = "What to expect — $" + cwStrike + " is support";
                        setupText = "Price pushed above the $" + cwStrike + " pin (" + fmtGex(cwGex+pwGex) + "). It's now support below — pullbacks toward $" + cwStrike + " are buying opportunities." + (isIntraday?"":((firstResAbovePin ? " If it holds, swing target $" + firstResAbovePin.strike + "." : "") + " " + (isPositive?"Safety net active — dips are cushioned.":"No safety net — be quick on exits if $"+cwStrike+" breaks.")));
                      } else if (spotBelowPin) {
                        setupTitle = "What to expect — recovering toward $" + cwStrike;
                        setupText = fmtGex(cwGex+pwGex) + " of support at $" + cwStrike + " catches pullbacks." + (isIntraday?" Expect a bounce back to the pin.":" Expect price to recover toward $" + cwStrike + " this week.") + (isPositive?" Safety net active — dips are limited.":" No safety net — recovery may be choppy.") + (firstResAbovePin && !isIntraday ? " If price reclaims $" + cwStrike + ", it becomes support — swing target $" + firstResAbovePin.strike + "." : "");
                      } else {
                        setupTitle = "What to expect — price stuck at $" + cwStrike;
                        setupText = "Ceiling and floor sit at the same price ($" + cwStrike + ") with " + fmtGex(cwGex+pwGex) + " behind it. Price wants to stay here — every move away gets pulled back. " + (isPositive?(isIntraday?"Dips bounce, rallies fade.":"Expect price to orbit $"+cwStrike+" this week. Dips bounce, rallies fade."):"Moves can be sharp but snap back to $" + cwStrike + ".");
                      }
                    } else {
                      const lo = Math.min(cwStrike,pwStrike), hi = Math.max(cwStrike,pwStrike);
                      setupTitle = "What to expect — price pinned at $" + lo + "–$" + hi;
                      setupText = "Ceiling at $" + hi + " caps rallies, floor at $" + lo + " cushions dips. " + fmtGex(cwGex+pwGex) + " combined gamma pins price in a tight $" + wallSpread + " range." + (isIntraday?" Dealers fight every move in both directions.":" This range should hold for the week — trade the edges.");
                    }
                  } else if (squeezeSetup) {
                    const lo = Math.min(cwStrike,pwStrike), hi = Math.max(cwStrike,pwStrike);
                    setupTitle = "What to expect — price stuck at $" + lo + "–$" + hi;
                    setupText = "Price is caught between two key levels. The ceiling above at $" + hi + " caps rallies, the floor below at $" + lo + " cushions dips. " + fmtGex(cwGex+pwGex) + " total is squeezing price into a tight $" + wallSpread + " range." + (isIntraday?"":" Use daily closes outside this range as your signal — anything inside is noise.");
                  } else if (cwDominant && cwAboveSpot) {
                    setupTitle = "What to expect — grinding up toward $" + cwStrike;
                    setupText = "Price at $" + sp.toFixed(0) + " heading toward the $" + cwStrike + " ceiling (" + fmtGex(cwGex) + "). " + (isPositive?(isIntraday?"Safety net is ON — dips tend to bounce back. Orderly grind higher.":"Safety net is ON — weekly pullbacks should find buyers. Buy dips, target $"+cwStrike+"."):(isIntraday?"Safety net is OFF — expect bigger swings both ways. Be careful with size.":"Safety net is OFF — wider swings this week. Size down and use daily closes for entries."));
                  } else if (cwDominant && !cwAboveSpot) {
                    const cwProxSetup = (sp - cwStrike) / sp;
                    if (cwProxSetup < 0.02 && firstResAbove) {
                      setupTitle = "What to expect — decision point at $" + cwStrike;
                      setupText = "Price sitting just above the $" + cwStrike + " support zone (" + fmtGex(cwGex) + "). Two outcomes: " + (isIntraday?"hold above $"+cwStrike+" and the wall gets absorbed — next target $"+firstResAbove.strike+". Lose $"+cwStrike+" and support breaks — expect a drop.":"a daily close above $"+cwStrike+" absorbs the wall — swing target $"+firstResAbove.strike+". A close below means support is lost.");
                    } else {
                      // Price well above the wall — wall is support below
                      setupTitle = "What to expect — $" + cwStrike + " is support";
                      setupText = "Price cleared the $" + cwStrike + " wall (" + fmtGex(cwGex) + ") and has room above. " + fmtGex(cwGex) + " now acts as major support — pullbacks toward $" + cwStrike + " are buying opportunities." + (firstResAbove ? (isIntraday?" Next target $" + firstResAbove.strike + ".":" Swing target $" + firstResAbove.strike + ".") : "") + " " + (isPositive?(isIntraday?"Safety net is ON — dips tend to hold.":"Safety net ON — weekly dips find buyers."):(isIntraday?"Safety net OFF — be quick if $"+cwStrike+" breaks.":"Safety net OFF — tight stops below $"+cwStrike+"."));
                    }
                  } else if (pwDominant && pwBelowSpot) {
                    setupTitle = "What to expect — strong bounce zone at $" + pwStrike;
                    setupText = "Very strong floor at $" + pwStrike + " — " + (pwGex/cwGex).toFixed(1) + "x stronger than the ceiling." + (isIntraday?" Price has a big safety net below and room to run above $"+cwStrike+".":" Weekly dips toward $"+pwStrike+" are buying opportunities. Swing target above $"+cwStrike+".");
                  } else if (pwDominant && !pwBelowSpot) {
                    setupTitle = "What to expect — resistance at $" + pwStrike;
                    setupText = "The biggest support level ($" + pwStrike + ") is above current price — it's pulling price UP. " + fmtGex(pwGex) + (isIntraday?" wants price higher than where it is now.":" wants price higher. Look for swing entries on dips — bullish weekly bias.");
                  } else {
                    setupTitle = "What to expect — choppy between $" + Math.min(pwStrike,cwStrike) + "–$" + Math.max(pwStrike,cwStrike);
                    setupText = "Floor and ceiling are about the same strength. Price will bounce between them. " + (isPositive?(isIntraday?"Safety net is ON — moves are contained.":"Safety net is ON — weekly range likely holds. Sell premium or swing the edges."):(isIntraday?"Safety net is OFF — swings can be sharp.":"Safety net is OFF — wider weekly swings. Tighter stops, smaller size."));
                  }

                  // Pattern-based trade ideas
                  const trades = [];
                  const zgNearSpot = zg && Math.abs(sp - zg) / sp < 0.005; // within 0.5%
                  const zgBelowClose = zg && (zg - sp) / sp > -0.01 && zg < sp; // zg just below spot (<1%)
                  const cwMagnet = !cwAboveSpot; // call wall below spot = magnet down
                  const pwMagnet = !pwBelowSpot; // put wall above spot = magnet up

                  if (pinSetup) {
                    // Pin setup trades
                    const pinStrike = cwStrike === pwStrike ? cwStrike : Math.round((cwStrike+pwStrike)/2);
                    const pinRange = cwStrike === pwStrike ? Math.round(sp*0.005) : wallSpread;
                    const pinAboveSpot = pinStrike > sp;
                    const pinBelowSpot = pinStrike < sp;
                    if (isIntraday) {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"Price wants to stay at $"+pinStrike+" — sell premium here (iron fly). Profit if price stays between $"+(pinStrike-pinRange*2)+"–$"+(pinStrike+pinRange*2)+"." });
                      if (pinAboveSpot) {
                        trades.push({ i:"B", bg:P.bu+"33", c:P.bu, t:"Buy dips near $"+sp.toFixed(0)+" — support at $"+pinStrike+" catches pullbacks. Target $"+pinStrike+"." });
                      }
                      if (pinBelowSpot && firstResAbovePin) {
                        trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"If price holds above $"+pinStrike+", pin becomes support. Next target $"+firstResAbovePin.strike+"." });
                      }
                      if (pinBelowSpot) {
                        trades.push({ i:"●", bg:P.bu+"33", c:P.bu, t:"$"+pinStrike+" is support below. Buy dips toward it — "+fmtGex(cwGex+pwGex)+" catches any pullback." });
                      }
                      trades.push({ i:"F", bg:P.ac+"33", c:P.ac, t:"Price keeps snapping back to $"+pinStrike+". Sell rallies above $"+(pinStrike+pinRange*3)+" and buy dips below $"+(pinStrike-pinRange*3)+"." });
                    } else {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"$"+pinStrike+" is the pin strike this week — sell weekly premium around it. Iron fly or short straddle with defined risk." });
                      if (pinAboveSpot) {
                        trades.push({ i:"B", bg:P.bu+"33", c:P.bu, t:"Price below the $"+pinStrike+" pin — support catches pullbacks. Buy dips this week targeting $"+pinStrike+". "+fmtGex(cwGex+pwGex)+" wants price there." });
                      }
                      if (pinBelowSpot && firstResAbovePin) {
                        trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"If price closes above $"+pinStrike+" for 2+ days, the pin becomes support. Swing long toward $"+firstResAbovePin.strike+"." });
                      }
                      if (pinBelowSpot) {
                        trades.push({ i:"●", bg:P.bu+"33", c:P.bu, t:"$"+pinStrike+" is weekly support below — "+fmtGex(cwGex+pwGex)+" catches pullbacks. Buy dips toward it." });
                      }
                      trades.push({ i:"F", bg:P.ac+"33", c:P.ac, t:"Use $"+(pinStrike+pinRange*3)+" and $"+(pinStrike-pinRange*3)+" as swing fade levels. Enter on daily closes outside the range, target a snap back to $"+pinStrike+"." });
                    }
                  } else if (squeezeSetup) {
                    // Squeeze setup trades
                    const lo = Math.min(cwStrike,pwStrike), hi = Math.max(cwStrike,pwStrike);
                    const mid = Math.round((lo+hi)/2);
                    if (isIntraday) {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"Price wants to stay at $"+mid+" — sell premium here (iron fly). Profit if price stays between $"+(lo-Math.round(wallSpread))+"–$"+(hi+Math.round(wallSpread))+"." });
                      trades.push({ i:"F", bg:P.ac+"33", c:P.ac, t:"Price keeps snapping back to $"+mid+". Sell rallies above $"+(hi+Math.round(wallSpread*0.5))+" and buy dips below $"+(lo-Math.round(wallSpread*0.5))+"." });
                    } else {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"$"+lo+"–$"+hi+" is the weekly range. Sell weekly premium — iron condor with wings outside $"+(lo-Math.round(wallSpread))+" and $"+(hi+Math.round(wallSpread))+"." });
                      trades.push({ i:"F", bg:P.ac+"33", c:P.ac, t:"Swing entries: buy daily closes near $"+lo+", take profits near $"+hi+". Fade daily closes above $"+hi+" back toward $"+mid+"." });
                    }
                  } else {
                    // Directional trades
                    if (cwAboveSpot) {
                      const cwDistPct = (cwStrike - sp) / sp;
                      if (isIntraday) {
                        trades.push({ i:"B", bg:P.bu+"33", c:P.bu, t:"Buy dips toward $"+(sp-(sp-(pwBelowSpot?pwStrike:sp*0.97))*0.3).toFixed(0)+". "+(isPositive?fmtGex(tg)+" safety net active — dips tend to bounce.":"No safety net — use smaller size and wider stops.")+" Stop below $"+(pwBelowSpot?pwStrike:(sp*0.97).toFixed(0))+"." });
                        trades.push({ i:"T", bg:P.ac+"33", c:P.ac, t:"Target $"+cwStrike+" ("+fmtGex(cwGex)+" ceiling)."+(firstResAbove && firstResAbove.strike < cwStrike ? " First test at $"+firstResAbove.strike+"." : "") });
                        if (cwDistPct < 0.005 && firstResAbovePin) {
                          trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"If price pushes above $"+cwStrike+" and holds, "+fmtGex(cwGex)+" becomes support. Next target $"+firstResAbovePin.strike+"." });
                        }
                      } else {
                        trades.push({ i:"B", bg:P.bu+"33", c:P.bu, t:"Swing long entry on a daily close above $"+sp.toFixed(0)+" or a dip toward $"+(pwBelowSpot?pwStrike:(sp*0.97).toFixed(0))+". "+(isPositive?"Safety net is on — weekly dips tend to find buyers.":"No safety net — size down and use wider stops.")+" Stop on a daily close below $"+(pwBelowSpot?pwStrike:(sp*0.97).toFixed(0))+"." });
                        trades.push({ i:"T", bg:P.ac+"33", c:P.ac, t:"Swing target $"+cwStrike+" ("+fmtGex(cwGex)+" ceiling)."+(firstResAbove && firstResAbove.strike < cwStrike ? " Watch for resistance at $"+firstResAbove.strike+" first." : "")+" Take partial profits there." });
                        if (cwDistPct < 0.01 && firstResAbovePin) {
                          trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"If price closes above $"+cwStrike+", "+fmtGex(cwGex)+" becomes support below. Swing target $"+firstResAbovePin.strike+"." });
                        }
                      }
                    } else {
                      // Call wall below — behavior depends on proximity
                      const cwProximity = (sp - cwStrike) / sp;
                      if (cwProximity < 0.02) {
                        // Close to wall — decision point: lead with bullish (price IS above), then risk
                        if (isIntraday) {
                          if (firstResAbove) trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"If price holds above $"+cwStrike+" and consolidates, the wall gets absorbed — next target $"+firstResAbove.strike+"." });
                          trades.push({ i:"●", bg:P.bu+"33", c:P.bu, t:"$"+cwStrike+" ("+fmtGex(cwGex)+") is support while price holds above. Buy dips toward it." });
                          trades.push({ i:"!", bg:P.be+"33", c:P.be, t:"Risk: a break below $"+cwStrike+" flips this level to resistance. Don't hold longs below it." });
                        } else {
                          if (firstResAbove) trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"If price closes above $"+cwStrike+" for 2+ days, the wall is absorbed. Swing long toward $"+firstResAbove.strike+"." });
                          trades.push({ i:"●", bg:P.bu+"33", c:P.bu, t:"$"+cwStrike+" ("+fmtGex(cwGex)+") is support while price holds above. Buy dips toward it this week." });
                          trades.push({ i:"!", bg:P.be+"33", c:P.be, t:"Risk: a daily close below $"+cwStrike+" confirms the break. Avoid longs below it — level flips to resistance." });
                        }
                      } else {
                        // Price cleared the wall — now acts as support
                        if (isIntraday) {
                          trades.push({ i:"●", bg:P.bu+"33", c:P.bu, t:"$"+cwStrike+" ("+fmtGex(cwGex)+") is now major support below — pullbacks toward it are buying opportunities." });
                          if (firstResAbove) trades.push({ i:"T", bg:P.ac+"33", c:P.ac, t:"Next target $"+firstResAbove.strike+". Ride the breakout, protect below $"+cwStrike+"." });
                        } else {
                          trades.push({ i:"●", bg:P.bu+"33", c:P.bu, t:"$"+cwStrike+" ("+fmtGex(cwGex)+") is now weekly support — buy dips toward it. "+fmtGex(cwGex)+" catches pullbacks." });
                          if (firstResAbove) trades.push({ i:"T", bg:P.ac+"33", c:P.ac, t:"Swing target $"+firstResAbove.strike+". Take partial profits there. Stop on a daily close below $"+cwStrike+"." });
                        }
                      }
                    }
                    if (pwMagnet) {
                      trades.push({ i:"↑", bg:P.bu+"33", c:P.bu, t:"Floor at $"+pwStrike+" is above current price — pulling price UP. "+fmtGex(pwGex)+" wants price at $"+pwStrike+"." });
                    }
                  }

                  // Zero gamma proximity warning
                  if (zgNearSpot) {
                    trades.push({ i:"⚡", bg:P.ac+"33", c:P.ac, t:"Danger line right here — price at $"+sp.toFixed(0)+", danger line at $"+zg.toFixed(0)+". "+(sp > zg ? "Below $"+zg.toFixed(0)+" the safety net breaks and drops get faster." : "Above $"+zg.toFixed(0)+" the safety net turns back on.")+(isIntraday?"":" Watch for a daily close below — that confirms the regime flip.")+" Smaller positions." });
                  } else if (zgBelowClose) {
                    trades.push({ i:"⚡", bg:P.ac+"33", c:P.ac, t:"Danger line at $"+zg.toFixed(0)+" is only "+(Math.abs((sp-zg)/sp)*100).toFixed(1)+"% away. "+(isIntraday?"One bad move and the safety net breaks — drops would get faster after that.":"A daily close below $"+zg.toFixed(0)+" flips the regime — expect faster drops and wider swings after that.") });
                  }

                  // Clear air / breakout potential
                  if (clearAirAbove && cwAboveSpot) {
                    const intermediateRes = firstResAbove && firstResAbove.strike < cwStrike ? firstResAbove : null;
                    if (isIntraday) {
                      trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"Not much blocking price above $"+sp.toFixed(0)+""+(intermediateRes ? " — if $"+intermediateRes.strike+" breaks" : "")+", could run quickly toward $"+cwStrike+"." });
                    } else {
                      trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"Thin resistance above $"+sp.toFixed(0)+""+(intermediateRes ? " — a daily close above $"+intermediateRes.strike+" opens the path" : "")+". Swing target $"+cwStrike+" this week." });
                    }
                  }

                  // Premium selling on positive GEX
                  if (isPositive && !pinSetup && !squeezeSetup) {
                    if (isIntraday) {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"Sell puts below $"+(pwBelowSpot?pwStrike:(sp*0.96).toFixed(0))+" — the "+fmtGex(tg)+" safety net means big drops are unlikely. High probability they expire worthless." });
                    } else {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"Sell weekly puts below $"+(pwBelowSpot?pwStrike:(sp*0.96).toFixed(0))+" — "+fmtGex(tg)+" safety net makes big weekly drops unlikely. Let time decay work for you." });
                    }
                  }

                  // Danger zone
                  const dangerLevel = pwBelowSpot ? pwStrike : Math.round(sp * 0.97);
                  const cwCloseBelow = cwMagnet && (sp - cwStrike) / sp < 0.02;
                  trades.push({ i:"!", bg:P.be+"33", c:P.be, t:"Danger: "+(isIntraday?"below":"a daily close below")+" $"+dangerLevel+" "+(isIntraday?"the floor breaks.":"means the floor is gone.")+(zg && !zgNearSpot ? " Below $"+zg.toFixed(0)+" the safety net breaks too — drops snowball." : "")+(cwCloseBelow && !pinSetup && !squeezeSetup ? " Broken support at $"+cwStrike+" would speed up the drop." : "") });

                  const gaugeMin = zg ? Math.min(zg, pwStrike) - (sp*0.005) : pwStrike - (sp*0.01);
                  const gaugeMax = Math.max(cwStrike, sp) + (sp*0.01);
                  const gPct = v => Math.max(0, Math.min(100, ((v-gaugeMin)/(gaugeMax-gaugeMin))*100));

                  return (
                  <div style={{ background:P.cd, borderRadius:10, padding:16, border:"1px solid "+P.bd, marginTop:4 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:"#c9a84c", letterSpacing:1.5, textTransform:"uppercase" }}>GEX Summary</span>
                      <span style={{ fontSize:11, color:P.dm }}>{gexData.ticker} · {gexDte==="0dte"?"0DTE":gexDte==="1dte"?"1DTE":gexDte==="2dte"?"2DTE":gexDte==="3dte"?"3DTE":gexDte==="week"?"Weekly":gexDte==="month"?"Monthly":"All"}{gexData.fetchedAt ? " · "+gexData.fetchedAt+" ET" : ""}</span>
                    </div>
                    <div style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:4, background:belowDangerLine?P.ac+"22":isPositive?P.bu+"22":P.be+"22", color:belowDangerLine?P.ac:isPositive?P.bu:P.be, display:"inline-block", marginBottom:10 }}>
                      {belowDangerLine?"⚠️ Below danger line — drops accelerate":isPositive?"Safety net ON — dips tend to bounce":"Safety net OFF — moves get wild"}{zgDist && !belowDangerLine?" · "+Math.abs(zgDist)+"% "+(parseFloat(zgDist)>=0?"above":"below")+" danger line":""}
                    </div>

                    {/* Quick Read — auto-generated narrative */}
                    {(()=>{
                      const parts = [];
                      const spStr = "$"+sp.toFixed(0);
                      const cwStr = "$"+cwStrike;
                      const pwStr = "$"+pwStrike;
                      const dist = Math.abs(sp - cwStrike);
                      const distPw = Math.abs(sp - (pwBelowSpot ? pwStrike : 0));
                      const safetyStr = isPositive ? (isIntraday ? fmtGex(tg)+" safety net means dips bounce." : fmtGex(tg)+" safety net supports weekly dips.") : (isIntraday ? "No safety net — moves can snowball." : "No safety net — expect wider weekly swings.");

                      if (pinSetup) {
                        if (Math.abs(sp - cwStrike) <= sp * 0.003) {
                          parts.push("Price sitting right at the "+cwStr+" pin ("+fmtGex(cwGex+pwGex)+" combined). Everything pulls back to this strike.");
                          parts.push(isPositive ? (isIntraday ? "Dips bounce, rallies fade. Classic pin action." : "This week expect price to orbit "+cwStr+". Dips bounce, rallies fade.") : "Pin is active but no safety net — expect sharp whipsaws around "+cwStr+".");
                          if (firstResAbovePin && !isIntraday) parts.push("If price breaks and holds above "+cwStr+", it becomes support — swing target $"+firstResAbovePin.strike+".");
                        } else if (sp > cwStrike) {
                          parts.push("Price pushed above the "+cwStr+" pin ("+fmtGex(cwGex+pwGex)+" combined) — "+cwStr+" is now support below.");
                          if (isIntraday) {
                            parts.push(fmtGex(cwGex+pwGex)+" catches any pullback to "+cwStr+". "+safetyStr+(firstResAbovePin ? " Next resistance at $"+firstResAbovePin.strike+"." : ""));
                          } else {
                            parts.push("Buy dips toward "+cwStr+" this week — "+fmtGex(cwGex+pwGex)+" acts as a floor."+(firstResAbovePin ? " If it holds, swing target $"+firstResAbovePin.strike+"." : "")+" "+safetyStr);
                          }
                        } else {
                          parts.push("Price dipped below the "+cwStr+" pin ("+fmtGex(cwGex+pwGex)+" combined) and is $"+dist.toFixed(0)+" below.");
                          if (isIntraday) {
                            parts.push("Gravity pulling up toward "+cwStr+". "+(isPositive ? "Safety net active — expect a bounce back to the pin." : "No safety net — could break further before snapping back."));
                          } else {
                            parts.push("Gravity pulling up toward "+cwStr+". "+(isPositive ? "Safety net active — expect price to recover toward the pin this week." : "No safety net — could break further before snapping back."));
                            parts.push("If price reclaims "+cwStr+", it becomes support"+(firstResAbovePin ? " — swing target $"+firstResAbovePin.strike+"." : "."));
                          }
                        }
                      } else if (squeezeSetup) {
                        const lo = Math.min(cwStrike,pwStrike), hi = Math.max(cwStrike,pwStrike);
                        const midpoint = Math.round((lo + hi) / 2);
                        parts.push("Price squeezed between $"+lo+" floor and $"+hi+" ceiling — "+fmtGex(cwGex+pwGex)+" combined traps price in a $"+wallSpread+" range.");
                        parts.push(isIntraday ? "Fade rallies near $"+hi+", buy dips near $"+lo+". "+safetyStr : "This week's range: $"+lo+"–$"+hi+". Swing entries near the edges, take profits in the middle. "+safetyStr);
                      } else if (cwAboveSpot && pwBelowSpot) {
                        // Normal: CW above, PW below
                        const cwDist = ((cwStrike - sp) / sp * 100).toFixed(1);
                        const pwDist = ((sp - pwStrike) / sp * 100).toFixed(1);
                        if (cwDominant) {
                          parts.push("Price at "+spStr+" grinding toward the "+cwStr+" ceiling ("+fmtGex(cwGex)+"), just "+cwDist+"% away.");
                          if (isIntraday) {
                            parts.push(cwDist < 1 ? "Testing the ceiling now — either breaks through or gets rejected." : "Floor at "+pwStr+" ("+fmtGex(pwGex)+") catches any dips.");
                          } else {
                            parts.push(cwDist < 1 ? "Testing the ceiling — a daily close above "+cwStr+" this week confirms the breakout." : "Floor at "+pwStr+" ("+fmtGex(pwGex)+") supports any weekly pullbacks.");
                          }
                          parts.push(safetyStr);
                        } else if (pwDominant) {
                          parts.push("Strong floor at "+pwStr+" ("+fmtGex(pwGex)+") with a weak ceiling above at "+cwStr+".");
                          parts.push(isIntraday ? "Price has room to run. "+safetyStr : "Room to run this week — buy pullbacks toward "+pwStr+". "+safetyStr);
                        } else {
                          parts.push("Price at "+spStr+" bouncing between the "+cwStr+" ceiling and "+pwStr+" floor.");
                          parts.push(isIntraday ? "Both about the same strength — choppy range. "+safetyStr : "Expect a choppy week in this range. Swing the edges. "+safetyStr);
                        }
                      } else if (!cwAboveSpot) {
                        // CW below = magnet pulling down
                        const cwProxQR = (sp - cwStrike) / sp;
                        if (cwProxQR < 0.02) {
                          parts.push("Spot just above the massive "+cwStr+" level ("+fmtGex(cwGex)+") — now acting as support below.");
                          if (isIntraday) {
                            parts.push(firstResAbove ? "If "+cwStr+" holds as support, next target is $"+firstResAbove.strike+". If it breaks below, expect a quick slide." : "Watch if "+cwStr+" holds — break below opens the downside.");
                          } else {
                            parts.push(firstResAbove ? "A daily close above "+cwStr+" this week absorbs the wall — swing target $"+firstResAbove.strike+". A close below confirms the pull." : "Watch for daily closes relative to "+cwStr+" — that's the decision point this week.");
                          }
                        } else {
                          // Price well above — wall is support
                          parts.push(cwStr+" ("+fmtGex(cwGex)+") is now major support below — price cleared the wall and has room above.");
                          parts.push((firstResAbove ? "Next resistance at $"+firstResAbove.strike+"." : "Room to run higher.")+" "+(isPositive ? (isIntraday?"Pullbacks toward "+cwStr+" are buying opportunities.":"Buy dips toward "+cwStr+" this week — safety net supports.") : "Safety net off — protect below "+cwStr+"."));
                        }
                      } else if (!pwBelowSpot) {
                        // PW above = magnet pulling up
                        parts.push("Floor at "+pwStr+" is above current price — pulling price UP.");
                        parts.push(fmtGex(pwGex)+" wants price at "+pwStr+"."+(isIntraday?" Bullish pull.":" Bullish weekly bias — look for entries on dips."));
                      }

                      // Danger line proximity add-on
                      if (zgNearSpot) {
                        parts.push("⚠️ Danger line at $"+(zg?.toFixed(0)||"—")+" is RIGHT HERE — one bad candle flips the safety net off.");
                      } else if (zgBelowClose) {
                        parts.push("Danger line at $"+(zg?.toFixed(0)||"—")+" is close — thin cushion before the safety net breaks.");
                      }

                      return parts.length > 0 ? (
                        <div style={{ background:P.al, borderRadius:6, padding:"10px 14px", marginBottom:10, lineHeight:1.6 }}>
                          <div style={{ fontSize:10, fontWeight:700, color:"#c9a84c", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Quick Read</div>
                          <div style={{ fontSize:12, color:P.wh }}>{parts.join(" ")}</div>
                        </div>
                      ) : null;
                    })()}

                    <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:10, marginBottom:10, alignItems:"center" }}>
                      <div style={{ display:"flex", gap:6 }}>
                        {[["Spot","$"+sp.toFixed(0),P.wh],["Danger Line","$"+(zg?zg.toFixed(0):"—"),P.ac],["GEX",fmtGex(tg),tg>0?P.bu:P.be]].map(([l,v,c])=>(
                          <div key={l} style={{ background:P.al, borderRadius:6, padding:"8px 12px", textAlign:"center" }}>
                            <div style={{ fontSize:9, color:P.dm, textTransform:"uppercase" }}>{l}</div>
                            <div style={{ fontSize:16, fontWeight:800, color:c }}>{v}</div>
                          </div>
                        ))}
                        {nd != null && (
                          <div style={{ background:P.al, borderRadius:6, padding:"8px 12px", textAlign:"center", minWidth:90 }}>
                            <div style={{ fontSize:9, color:P.dm, textTransform:"uppercase" }}>Net Delta</div>
                            <div style={{ fontSize:16, fontWeight:800, color:nd>0?P.bu:nd<0?P.be:P.dm }}>
                              {nd > 0 ? "+" : ""}{Math.abs(nd) > 999999 ? (nd/1e6).toFixed(1)+"M" : Math.abs(nd) > 999 ? (nd/1e3).toFixed(0)+"K" : nd.toFixed(0)}
                              {ndChange !== null && <span style={{ fontSize:11, marginLeft:3, color:ndImproving?P.bu:P.be }}>{ndImproving?"▲":"▼"}</span>}
                            </div>
                            {ndReadings.length > 1 && (()=>{
                              const r = ndReadings;
                              const mn = Math.min(...r), mx = Math.max(...r);
                              const range = mx - mn || 1;
                              const w = 70, h = 18;
                              const pts = r.map((v,i) => [i/(r.length-1)*w, h - ((v-mn)/range)*h]);
                              const pathD = pts.map((p,i) => (i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
                              const trendColor = r[r.length-1] >= r[0] ? P.bu : P.be;
                              return (
                                <svg width={w} height={h} style={{ display:"block", margin:"3px auto 0" }}>
                                  <path d={pathD} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2" fill={trendColor} />
                                </svg>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                      <div style={{ position:"relative", padding:"0 4px" }}>
                        <div style={{ position:"relative", height:20, borderRadius:10, background:"linear-gradient(90deg, "+P.be+"33 0%, "+P.be+"33 20%, #1a2035 20%, #1a2035 40%, "+P.bu+"33 40%)" }}>
                          {zg&&<div style={{ position:"absolute",top:0,height:"100%",width:2,left:gPct(zg)+"%",background:P.ac,opacity:0.6,borderRadius:1 }}><span style={{ position:"absolute",top:24,transform:"translateX(-50%)",fontSize:8,color:P.dm,whiteSpace:"nowrap" }}>${zg.toFixed(0)}</span></div>}
                          <div style={{ position:"absolute",top:0,height:"100%",width:2,left:gPct(pwStrike)+"%",background:P.be,opacity:0.4,borderRadius:1 }}><span style={{ position:"absolute",top:24,transform:"translateX(-50%)",fontSize:8,color:P.dm,whiteSpace:"nowrap" }}>${pwStrike}</span></div>
                          <div style={{ position:"absolute",top:0,height:"100%",width:2,left:gPct(cwStrike)+"%",background:P.bu,opacity:0.5,borderRadius:1 }}><span style={{ position:"absolute",top:24,transform:"translateX(-50%)",fontSize:8,color:P.dm,whiteSpace:"nowrap" }}>${cwStrike}</span></div>
                          <div style={{ position:"absolute",top:-2,width:4,height:24,left:gPct(sp)+"%",background:"#00BCD4",borderRadius:2,zIndex:3 }}><span style={{ position:"absolute",top:-14,transform:"translateX(-50%)",fontSize:9,fontWeight:700,color:"#00BCD4",whiteSpace:"nowrap" }}>${sp.toFixed(0)}</span></div>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, marginTop:14 }}><span style={{ color:P.be }}>Danger</span><span style={{ color:P.bu }}>Safe</span></div>
                      </div>
                    </div>
                    <div style={{ background:P.al, borderRadius:6, padding:"10px 12px", marginBottom:10 }}>
                      <div style={{ fontSize:10, color:P.dm, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>Ceiling vs floor{wallsInverted?" — spot between both":""}</div>
                      <div style={{ display:"flex", height:28, borderRadius:4, overflow:"hidden", marginBottom:5 }}>
                        <div style={{ width:cwPct+"%", background:SG, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#e1f5ee" }}>Ceiling ${cwStrike} — {fmtGex(cwGex)}</div>
                        <div style={{ width:pwPct+"%", background:SR, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff" }}>{fmtGex(pwGex)}</div>
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:5 }}>
                        <span style={{ color:P.bu }}>Call {cwRatio}x · {cwLabel}</span>
                        <span style={{ color:P.be }}>Put ${pwStrike} · {pwLabel}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 10px", borderRadius:4, fontSize:11, fontWeight:700, background:verdictBg, color:verdictColor }}><span style={{ fontSize:14 }}>{verdictIcon}</span><span>{verdictText}</span></div>
                    </div>
                    <div style={{ height:1, background:P.bd, margin:"8px 0" }} />
                    <div style={{ fontSize:14, fontWeight:700, color:P.wh, marginBottom:4 }}>{setupTitle}</div>
                    <p style={{ fontSize:12, color:P.dm, lineHeight:1.5, margin:"0 0 8px" }}>{setupText}</p>
                    <div style={{ fontSize:13, fontWeight:800, color:P.wh, textTransform:"uppercase", letterSpacing:1.5, marginBottom:5 }}>Game Plan</div>
                    {trades.map((t,ti) => (
                      <div key={ti} style={{ display:"flex", gap:7, alignItems:"flex-start", marginBottom:5, fontSize:12, color:P.dm, lineHeight:1.45 }}>
                        <div style={{ flexShrink:0, width:22, height:22, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, marginTop:1, background:t.bg, color:t.c }}>{t.i}</div>
                        <div>{t.t}</div>
                      </div>
                    ))}
                    <div style={{ height:1, background:P.bd, margin:"8px 0" }} />
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#555" }}>
                      <span>Safety net breaks: ${zg?zg.toFixed(0):"—"}{zgDist?" ("+Math.abs(zgDist)+"% "+(parseFloat(zgDist)>=0?"above":"below")+")":""}</span>
                      <span>{gexData.fetchedAt ? "Fetched: "+gexData.fetchedAt+" ET" : ""}</span>
                      <span>UCT Intelligence</span>
                    </div>
                  </div>
                  );
                })()}
              </>
            )}
          </div>
          );
        })()}

        {dataMode === "darkpool" && <DarkPool embedded />}

        {dataMode !== "gex" && dataMode !== "darkpool" && D && (<>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:P.ac, boxShadow:"0 0 10px "+P.ac }} />
          <h1 style={{ fontSize:18, fontWeight:800, margin:0, color:P.wh }}>{dataMode==="index"?"INDEX FLOW":"OPTIONS FLOW"} — ADMIN</h1>
          <span style={{ marginLeft:"auto", fontSize:10, color:P.mt, background:P.al, padding:"3px 10px", borderRadius:4 }}>
            {D.dateRange} · {D.confirmedCount} confirmed of {D.totalTrades} trades
          </span>
          <button onClick={()=>document.getElementById("csv-reupload").click()}
            style={{ marginLeft:8, padding:"3px 10px", borderRadius:4, border:"1px solid "+P.bl, background:"transparent",
              color:P.ac, fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            ↑ Re-upload CSV
          </button>
          <input id="csv-reupload" type="file" accept=".csv" style={{display:"none"}} onChange={onFileInput}/>
          {dbStatus && (
            <span style={{ fontSize:9, fontWeight:600, padding:"3px 10px", borderRadius:4, marginLeft:6,
              background: dbStatus.type==="ok"?P.bu+"22":dbStatus.type==="error"?P.be+"22":P.al,
              color: dbStatus.type==="ok"?P.bu:dbStatus.type==="error"?P.be:P.ye }}>
              {dbStatus.msg}
            </span>
          )}
        </div>

        {/* ── Market Pulse — compact ticker strip ────────────────────────── */}
        {tab==="Market Read" && (
          <div style={{ marginBottom:12 }}>
            {/* Ticker Strip */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:0, position:"relative", background:P.cd, border:"1px solid "+P.bd, borderRadius:marketNarrative&&!narrativeLoading?"10px 10px 0 0":10, padding:"8px 14px", flexWrap:"wrap" }}>
              {marketIndices ? marketIndices.map((idx,i) => {
                const up = idx.pct >= 0;
                const c = up ? P.bu : P.be;
                const short = {"S&P 500":"SPY","NASDAQ":"QQQ","DOW 30":"DIA","Russell 2000":"IWM","VIX":"VIX"}[idx.name]||idx.name;
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:6, padding:"0 14px", borderRight:i<marketIndices.length-1?("1px solid "+P.bd):undefined }}>
                    <span style={{ fontSize:10, fontWeight:700, color:P.dm }}>{short}</span>
                    <span style={{ fontSize:11, fontWeight:800, color:P.wh, fontVariantNumeric:"tabular-nums" }}>${idx.price>0?idx.price.toLocaleString(undefined,{minimumFractionDigits:2}):"—"}</span>
                    <span style={{ fontSize:10, fontWeight:700, color:c, fontVariantNumeric:"tabular-nums" }}>{idx.pct>0?"+":""}{idx.pct}%</span>
                  </div>
                );
              }) : (
                <div style={{ display:"flex", alignItems:"center", gap:8, width:"100%" }}>
                  <span style={{ fontSize:10, color:P.dm }}>Market data loads automatically</span>
                  <button onClick={fetchMarketData} style={{ padding:"3px 10px", borderRadius:4, border:"1px solid "+P.bl, background:P.al, color:P.ac, fontSize:9, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                    Load Now
                  </button>
                </div>
              )}
              {marketIndices && (
                <button onClick={fetchMarketData} title="Refresh" style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", padding:"2px 8px", borderRadius:3, border:"1px solid "+P.bl, background:"transparent", color:P.dm, fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>↻</button>
              )}
            </div>
            {/* AI Narrative */}
            {narrativeLoading && (
              <div style={{ background:P.cd, border:"1px solid "+P.bd, borderTop:"none", borderRadius:"0 0 10px 10px", padding:"8px 14px", fontSize:10, color:P.dm }}>
                <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:P.ac, marginRight:6, animation:"pulse 1.5s infinite" }}/>
                Generating market summary…
                <style>{"@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}"}</style>
              </div>
            )}
            {marketNarrative && !narrativeLoading && (
              <div style={{ background:P.cd, border:"1px solid "+P.bd, borderTop:"none", borderRadius:"0 0 10px 10px", padding:"10px 14px" }}>
                <div style={{ fontSize:11, color:P.tx, lineHeight:1.8 }}>{marketNarrative}</div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:"flex", gap:1, marginBottom:14, background:P.al, borderRadius:6, padding:2, width:"fit-content", flexWrap:"wrap" }}>
          {TABS.map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{
              padding:"6px 14px", borderRadius:5, border:tab===t?("2px solid "+(t==="Leaderboard"?"#c9a84c":t==="Watchlist"?P.ac:t==="Leaders"?"#6ba3be":P.ac)):(t==="Watchlist"?"1px solid "+P.ac+"55":t==="Leaderboard"?"1px solid #c9a84c55":t==="Leaders"?"1px solid #6ba3be55":"1px solid transparent"), cursor:"pointer",
              fontSize:11, fontWeight:tab===t?800:(t==="Watchlist"||t==="Leaderboard"||t==="Leaders")?800:600, fontFamily:"inherit",
              background:tab===t?(t==="Watchlist"?P.ac+"33":t==="Leaderboard"?"#c9a84c33":t==="Leaders"?"#6ba3be33":P.ac+"22"):"transparent",
              color:tab===t?(t==="Watchlist"?P.ac:t==="Leaderboard"?"#c9a84c":t==="Leaders"?"#6ba3be":P.wh):(t==="Watchlist"?P.ac:t==="Leaderboard"?"#c9a84c":t==="Leaders"?"#6ba3be":P.mt)
            }}>{t}</button>
          ))}
        </div>

        {/* Global Cap Filter */}
        {FD && (()=>{
          const caps = ["All","Mega","Large","Mid-Small"];
          const capColors = { Mega:"#c9a84c", Large:"#6ba3be", "Mid-Small":"#a8a290", All:P.wh };
          const capDescriptions = {
            Mega:  "$500B+ · SPY-weight movers",
            Large: "$10B–$500B · institutional conviction plays",
            "Mid-Small": "Under $10B · directional bets, high-conviction small name flow",
          };
          const capThresh = {
            Mega: t=>capBand(t.mktcap)==="Mega", Large: t=>capBand(t.mktcap)==="Large",
            "Mid-Small": t=>capBand(t.mktcap)==="Mid-Small"
          };
          return (
            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <span style={{ fontSize:10, fontWeight:700, color:P.mt, letterSpacing:"0.08em", textTransform:"uppercase" }}>Cap Filter</span>
                {caps.map(c => {
                  const active = capFilter === c;
                  const clr = capColors[c] || P.wh;
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

        {/* Market Read */}
        {tab==="Market Read" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Flow Intelligence Summary */}
            {FD && D.clean_confirmed && (()=>{
              // 2026-07-04: honor the Stocks tab by excluding ETFs/indexes
              // (and vice versa on the Indexes tab). Matches Watchlist behavior.
              const _tabOk = (t) => {
                const isEtf = isETFSymbol(t.S, t.stocketf);
                return dataMode === "stocks" ? !isEtf : isEtf;
              };
              const base = (D.clean_confirmed||[]).filter(_tabOk);
              const cc = capFilter==="All" ? base : base.filter(t => capBand(t.mktcap)===capFilter);
              if (!cc.length) return null;
              // Per-ticker aggregation (always over the full set, exclusion is applied below)
              let rawTotalBull=0, rawTotalBear=0;
              const tkMap = {};
              cc.forEach(t => {
                if (t.D==="BULL") rawTotalBull+=t.P; if (t.D==="BEAR") rawTotalBear+=t.P;
                if (!tkMap[t.S]) tkMap[t.S] = { sym:t.S, bull:0, bear:0, n:0, mktcap:t.mktcap||0 };
                const tk = tkMap[t.S];
                if (t.D==="BULL") tk.bull+=t.P; if (t.D==="BEAR") tk.bear+=t.P; tk.n++;
              });
              const allTk = Object.values(tkMap);
              const bullCount = allTk.filter(t=>t.bull>t.bear).length;
              const bearCount = allTk.filter(t=>t.bear>t.bull).length;
              // Sort tickers by their dominant flow to identify concentration outliers
              const bullSorted = allTk.filter(t=>t.bull>t.bear).sort((a,b)=>(b.bull-b.bear)-(a.bull-a.bear));
              const bearSorted = allTk.filter(t=>t.bear>t.bull).sort((a,b)=>(b.bear-b.bull)-(a.bear-a.bull));
              // Concentration metrics — % of total flow held by top 1 / top 3 names
              const top1BullPrem = bullSorted.slice(0,1).reduce((a,t)=>a+(t.bull-t.bear),0);
              const top3BullPrem = bullSorted.slice(0,3).reduce((a,t)=>a+(t.bull-t.bear),0);
              const top1BearPrem = bearSorted.slice(0,1).reduce((a,t)=>a+(t.bear-t.bull),0);
              const top3BearPrem = bearSorted.slice(0,3).reduce((a,t)=>a+(t.bear-t.bull),0);
              const top1BullPct = rawTotalBull>0 ? Math.round(top1BullPrem/rawTotalBull*100) : 0;
              const top3BullPct = rawTotalBull>0 ? Math.round(top3BullPrem/rawTotalBull*100) : 0;
              const top1BearPct = rawTotalBear>0 ? Math.round(top1BearPrem/rawTotalBear*100) : 0;
              const top3BearPct = rawTotalBear>0 ? Math.round(top3BearPrem/rawTotalBear*100) : 0;
              // Apply exclusion based on toggle — strip top N bull AND top N bear tickers
              // and recompute totals/top-names. This shows whether bias survives without the outliers.
              const excludedSyms = new Set();
              if (flowExcludeTop > 0) {
                bullSorted.slice(0, flowExcludeTop).forEach(t => excludedSyms.add(t.sym));
                bearSorted.slice(0, flowExcludeTop).forEach(t => excludedSyms.add(t.sym));
              }
              const ccFiltered = excludedSyms.size > 0 ? cc.filter(t => !excludedSyms.has(t.S)) : cc;
              let totalBull=0, totalBear=0;
              ccFiltered.forEach(t => { if (t.D==="BULL") totalBull+=t.P; if (t.D==="BEAR") totalBear+=t.P; });
              const totalPrem = totalBull + totalBear;
              const bullPct = totalPrem > 0 ? Math.round(totalBull/totalPrem*100) : 50;
              const netDir = totalBull >= totalBear ? "BULLISH" : "BEARISH";
              const netC = totalBull >= totalBear ? P.bu : P.be;
              const topBull = (excludedSyms.size > 0 ? bullSorted.filter(t=>!excludedSyms.has(t.sym)) : bullSorted).slice(0,3);
              const topBear = (excludedSyms.size > 0 ? bearSorted.filter(t=>!excludedSyms.has(t.sym)) : bearSorted).slice(0,3);
              // High-concentration warning: top 3 dominate one side
              const concentrationWarn = top3BullPct >= 50 || top3BearPct >= 50;
              const capLabel = capFilter==="All" ? "All Caps" : capFilter;
              const allDates = [...new Set(cc.map(t=>t.Dt).filter(Boolean))];
              const latestDate = allDates.length > 0 ? allDates.sort((a,b)=>{
                const pa=a.split("/").map(Number), pb=b.split("/").map(Number);
                const ya=pa.length>=3?(pa[2]<100?pa[2]+2000:pa[2]):2026, yb=pb.length>=3?(pb[2]<100?pb[2]+2000:pb[2]):2026;
                return new Date(yb,pb[0]-1,pb[1]||1) - new Date(ya,pa[0]-1,pa[1]||1);
              })[0] : null;
              const todayTrades = latestDate ? cc.filter(t=>t.Dt===latestDate) : [];
              const todayPrem = todayTrades.reduce((a,t)=>a+t.P,0);
              const todayCount = todayTrades.length;
              const avgDailyPrem = allDates.length > 1 ? (rawTotalBull + rawTotalBear) / allDates.length : 0;
              const avgDailyCount = allDates.length > 1 ? cc.length / allDates.length : 0;
              const velRatio = avgDailyPrem > 0 ? todayPrem / avgDailyPrem : 0;
              const velLabel = velRatio >= 1.5 ? "elevated" : velRatio >= 0.8 ? "normal" : "quiet";
              const velC = velRatio >= 1.5 ? P.ac : velRatio >= 0.8 ? P.wh : P.dm;
              const erTickers = [...new Set(cc.filter(t=>t.er).map(t=>t.S))];
              const erTop = erTickers.slice(0,5);
              return (
                <Card>
                  <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                    <div style={{ width:3, background:`linear-gradient(180deg, ${P.bu}, ${P.ac}, ${P.bu})`, borderRadius:2, alignSelf:"stretch", flexShrink:0, opacity:0.3 }} />
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:P.dm, letterSpacing:1.5, textTransform:"uppercase", marginBottom:6 }}>Flow Intelligence</div>
                      <div style={{ display:"flex", gap:16 }}>
                        <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, color:P.wh, lineHeight:1.8 }}>
                        <span>Net flow is </span>
                        <span style={{ fontWeight:900, color:netC }}>{netDir}</span>
                        <span> with </span>
                        <span style={{ fontWeight:800, color:P.bu }}>{fmt(totalBull)}</span>
                        <span> bull vs </span>
                        <span style={{ fontWeight:800, color:P.be }}>{fmt(totalBear)}</span>
                        <span> bear across </span>
                        <span style={{ fontWeight:700, color:P.wh }}>{allTk.length}</span>
                        <span> tickers ({bullCount} bullish, {bearCount} bearish).</span>
                      </div>
                      <div style={{ fontSize:12, color:P.wh, lineHeight:1.8 }}>
                        {topBull.length > 0 && <>
                          <span>Top bullish names: </span>
                          {topBull.map((t,i) => <span key={t.sym}>
                            <span style={{ fontWeight:800, color:P.bu }}>{t.sym}</span>
                            <span style={{ color:P.dm }}> ({fmt(t.bull-t.bear)})</span>
                            {i < topBull.length-1 && ", "}
                          </span>)}
                          <span>. </span>
                        </>}
                        {topBear.length > 0 && <>
                          <span>Top bearish: </span>
                          {topBear.map((t,i) => <span key={t.sym}>
                            <span style={{ fontWeight:800, color:P.be }}>{t.sym}</span>
                            <span style={{ color:P.dm }}> ({fmt(t.bear-t.bull)})</span>
                            {i < topBear.length-1 && ", "}
                          </span>)}
                          <span>.</span>
                        </>}
                      </div>
                      {latestDate && avgDailyPrem > 0 && (
                        <div style={{ fontSize:11, color:P.mt, lineHeight:1.8, marginTop:4 }}>
                          <span style={{ fontWeight:700, color:P.dm, letterSpacing:0.5 }}>FLOW VELOCITY: </span>
                          <span>Latest session </span>
                          <span style={{ fontWeight:800, color:velC }}>{fmt(todayPrem)}</span>
                          <span> across </span>
                          <span style={{ fontWeight:700, color:P.wh }}>{todayCount}</span>
                          <span> trades vs {allDates.length}d avg </span>
                          <span style={{ fontWeight:700, color:P.wh }}>{fmt(avgDailyPrem)}</span>
                          <span> / </span>
                          <span style={{ fontWeight:700, color:P.wh }}>{Math.round(avgDailyCount)}</span>
                          <span> trades — </span>
                          <span style={{ fontWeight:800, color:velC }}>{velLabel}</span>
                          <span>.</span>
                        </div>
                      )}
                      {erTop.length > 0 && (
                        <div style={{ fontSize:11, color:P.mt, lineHeight:1.8, marginTop:2 }}>
                          <span style={{ fontWeight:700, color:P.dm, letterSpacing:0.5 }}>EARNINGS FLOW: </span>
                          <span>{erTickers.length} ticker{erTickers.length>1?"s":""} with upcoming earnings have active flow: </span>
                          {erTop.map((sym,i) => <span key={sym}>
                            <span style={{ fontWeight:800, color:P.ac }}>{sym}</span>
                            {i < erTop.length-1 && ", "}
                          </span>)}
                          {erTickers.length > 5 && <span style={{ color:P.dm }}> +{erTickers.length-5} more</span>}
                          <span>.</span>
                        </div>
                      )}
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0, width:"26%", gap:6 }}>
                          {/* Plain-English narrative: describes whether flow is narrow */}
                          {/* (single-bet skewed) or broad (many tickers contributing). */}
                          <div style={{ fontSize:10, color:concentrationWarn?P.ac:P.mt, lineHeight:1.45, textAlign:"center", maxWidth:"100%" }}>
                            {(() => {
                              const bullNarrow = top3BullPct >= 50;
                              const bearNarrow = top3BearPct >= 50;
                              if (bullNarrow && bearNarrow) {
                                return <><span style={{ fontWeight:800 }}>⚠ Narrow on both sides</span> — top 3 names carry {top3BullPct}% of bull and {top3BearPct}% of bear flow.</>;
                              }
                              if (bullNarrow) {
                                return <><span style={{ fontWeight:800 }}>⚠ Narrow bull flow</span> — 3 names carry {top3BullPct}% of bull premium. Bear flow is broad ({top3BearPct}%).</>;
                              }
                              if (bearNarrow) {
                                return <><span style={{ fontWeight:800 }}>⚠ Narrow bear flow</span> — 3 names carry {top3BearPct}% of bear premium. Bull flow is broad ({top3BullPct}%).</>;
                              }
                              return <>Broad flow — top 3 carry {top3BullPct}% of bull, {top3BearPct}% of bear.</>;
                            })()}
                          </div>
                          {/* The big Bull Flow % — the anchor */}
                          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginTop:4 }}>
                            <div style={{ fontSize:32, fontWeight:900, color:netC, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>{bullPct}%</div>
                            <div style={{ fontSize:7, fontWeight:600, color:P.dm, letterSpacing:1, textTransform:"uppercase", marginTop:4 }}>Bull Flow</div>
                          </div>
                          {/* Recheck toggle: subtle, sits below the 65% as a "what if" tool */}
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:4, marginTop:4 }}>
                            <span style={{ fontSize:9, color:P.dm, fontStyle:"italic" }}>recheck without:</span>
                            {[
                              { val:0, lbl:"none" },
                              { val:1, lbl:"top 1" },
                              { val:3, lbl:"top 3" },
                            ].map(opt => {
                              const active = flowExcludeTop===opt.val;
                              return (
                                <button key={opt.val} onClick={()=>setFlowExcludeTop(opt.val)}
                                  style={{ padding:"1px 6px", borderRadius:3, border:"1px solid "+(active?P.ac:P.bd),
                                    background:active?P.ac+"22":"transparent",
                                    color:active?P.ac:P.mt, fontSize:9, fontWeight:700, fontFamily:"inherit",
                                    cursor:"pointer", letterSpacing:0.3 }}>
                                  {opt.lbl}
                                </button>
                              );
                            })}
                          </div>
                          {excludedSyms.size > 0 && (
                            <div style={{ fontSize:8, color:P.ac, textAlign:"center", maxWidth:"100%", lineHeight:1.4 }}>
                              now excluding: {[...excludedSyms].join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Timeframe Outlook */}
                      {(()=>{
                        const tfRanges = [
                          { key:"week", label:"THIS WEEK", sub:"0–7 DTE", min:0, max:7 },
                          { key:"biweek", label:"1–2 WEEKS", sub:"7–14 DTE", min:7, max:14 },
                          { key:"monthly", label:"MONTHLY", sub:"14–60 DTE", min:14, max:60 },
                          { key:"longterm", label:"LONG TERM", sub:"60+ DTE", min:60, max:9999 },
                        ];
                        return (
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, marginTop:10 }}>
                            {tfRanges.map(tf => {
                              const tfTrades = cc.filter(t=>t.DTE>=tf.min&&t.DTE<tf.max);
                              let tfBull=0, tfBear=0, askCount=0, sweepCount=0;
                              const tfContracts = {};
                              const tfTickers = new Set();
                              tfTrades.forEach(t => {
                                if(t.D==="BULL") tfBull+=t.P; if(t.D==="BEAR") tfBear+=t.P;
                                tfTickers.add(t.S);
                                const ck=t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
                                if(!tfContracts[ck]) tfContracts[ck]={sym:t.S,cp:t.CP,K:t.K,exp:t.E,prem:0};
                                tfContracts[ck].prem+=t.P;
                                if(t.Si==="A"||t.Si==="AA") askCount++;
                                if(t.Ty==="SWP") sweepCount++;
                              });
                              const tfTotal = tfBull+tfBear;
                              const bullPct = tfTotal>0 ? Math.round(tfBull/tfTotal*100) : 50;
                              // Mixed when neither side commands a clear majority
                              const isMixed = tfTotal > 0 && bullPct >= 45 && bullPct <= 55;
                              const tfDir = isMixed ? "MIXED" : (tfBull>=tfBear ? "BULL" : "BEAR");
                              const tfDirC = isMixed ? P.dm : (tfDir==="BULL" ? P.bu : P.be);
                              const dirPct = isMixed ? 50 : (tfDir==="BULL" ? bullPct : 100-bullPct);
                              const askPct = tfTrades.length > 0 ? Math.round(askCount/tfTrades.length*100) : 0;
                              const top3 = Object.values(tfContracts).sort((a,b)=>b.prem-a.prem).slice(0,3);
                              // Intensity: HIGH = strong conviction + ASK aggression + sweeps; MED = directional only
                              let intensity = "low";
                              if (!isMixed && dirPct >= 70 && askPct >= 60 && sweepCount >= 5) intensity = "high";
                              else if (!isMixed && dirPct >= 55 && askPct >= 50) intensity = "med";
                              // Dot color: always the direction color (green=bull, red=bear). Intensity is
                              // communicated through the box-shadow glow, not by switching colors.
                              const intC = intensity === "low" ? P.dm : tfDirC;
                              const intGlow = intensity === "high" ? `0 0 8px ${tfDirC}, 0 0 2px ${tfDirC}` : intensity === "med" ? `0 0 4px ${tfDirC}` : "none";
                              return (
                                <div key={tf.key} style={{ background:P.al, borderRadius:6, padding:"10px 11px", borderLeft:"3px solid "+(tfTotal>0?tfDirC:P.bd), display:"flex", flexDirection:"column", gap:6, minHeight:200 }}>
                                  {/* Header: label + intensity dot */}
                                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                                    <div>
                                      <div style={{ fontSize:8, color:P.dm, fontWeight:600, letterSpacing:1, textTransform:"uppercase" }}>{tf.label}</div>
                                      <div style={{ fontSize:7, color:P.dm }}>{tf.sub}</div>
                                    </div>
                                    {tfTotal > 0 && <div title={`Intensity: ${intensity}`} style={{ width:8, height:8, borderRadius:4, background:intC, boxShadow:intGlow, marginTop:4, flexShrink:0 }}/>}
                                  </div>
                                  {tfTotal > 0 ? <>
                                    {/* Direction + conviction % */}
                                    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
                                      <div style={{ fontSize:15, fontWeight:900, color:tfDirC, lineHeight:1 }}>
                                        {!isMixed && (tfDir==="BULL" ? "▲ " : "▼ ")}{tfDir}
                                      </div>
                                      <div style={{ fontSize:13, fontWeight:800, color:tfDirC, fontVariantNumeric:"tabular-nums" }}>{dirPct}%</div>
                                    </div>
                                    {/* Bull/bear split bar */}
                                    <div style={{ height:5, background:P.bd, borderRadius:2, overflow:"hidden", display:"flex" }}>
                                      <div style={{ width:`${bullPct}%`, background:P.bu }}/>
                                      <div style={{ width:`${100-bullPct}%`, background:P.be }}/>
                                    </div>
                                    {/* Premium breakdown */}
                                    <div style={{ fontSize:9, color:P.dm }}>
                                      <span style={{ color:P.bu, fontWeight:600 }}>{fmt(tfBull)}</span>
                                      {" bull · "}
                                      <span style={{ color:P.be, fontWeight:600 }}>{fmt(tfBear)}</span>
                                      {" bear"}
                                    </div>
                                    {/* Breadth + aggression */}
                                    <div style={{ fontSize:9, color:P.dm, lineHeight:1.5 }}>
                                      <div>{tfTrades.length} trades · {tfTickers.size} tickers</div>
                                      <div>{askPct}% ASK · {sweepCount} sweeps</div>
                                    </div>
                                    {/* Divider */}
                                    <div style={{ height:1, background:P.bd, margin:"2px 0" }}/>
                                    {/* Top 3 contracts */}
                                    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                                      {top3.map((c, i) => (
                                        <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", fontSize:9, gap:6 }}>
                                          <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                            <span style={{ color:c.cp==="C"?P.bu:P.be, fontWeight:700 }}>{c.sym}</span>
                                            <span style={{ color:P.dm }}> {c.cp} ${c.K} {c.exp}</span>
                                          </div>
                                          <span style={{ color:P.mt, fontWeight:600, fontVariantNumeric:"tabular-nums", flexShrink:0 }}>{fmt(c.prem)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </> : (
                                    <div style={{ fontSize:11, color:P.dm, marginTop:8 }}>No flow</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </Card>
              );
            })()}
            {/* Sector / Theme Breakdown */}
            {FD.SECTORS.length > 0 && (
              <Card>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
                  <div style={{ display:"flex", gap:2, background:P.al, borderRadius:5, padding:2 }}>
                    {[["sectors","Sectors"],["themes","Themes"]].map(([v,label])=>(
                      <button key={v} onClick={()=>{setSectorView(v);setSelectedItem(null);}} style={{
                        padding:"4px 12px", borderRadius:4, border:"none", cursor:"pointer",
                        fontSize:11, fontWeight:700, fontFamily:"inherit", textTransform:"uppercase", letterSpacing:1.5,
                        background:sectorView===v?P.ac+"22":"transparent",
                        color:sectorView===v?P.ac:P.dm,
                      }}>{label}</button>
                    ))}
                  </div>
                  <span style={{ fontSize:10, color:P.mt }}>
                    {sectorView==="themes"?"Confirmed premium by investment theme":"Confirmed premium by "+(FD.sectorTickerMode?"ticker":"sector")}
                  </span>
                </div>
                {sectorView==="sectors" && (
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
                              background:P.cd, border:"1px solid "+P.bl, borderRadius:8, padding:"10px 12px", fontSize:10,
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
                        {/* Sector mode dropdown — top tickers, with inline drill-down on click */}
                        {!FD.sectorTickerMode && selectedItem&&selectedItem._secKey===hk && s.topTickers && s.topTickers.length > 0 && (
                          <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, marginTop:4, minWidth:280, maxWidth:420,
                            background:P.cd, border:"1px solid "+P.bl, borderRadius:8, padding:"10px 12px", fontSize:10,
                            boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}
                            onClick={e=>e.stopPropagation()}>
                            {!selectedItem._drilldownTicker ? (
                              // Top tickers list (clickable)
                              <>
                                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                                  <div style={{ fontWeight:700, color:P.ac }}>{s.name} — Top Flow</div>
                                  <button onClick={e=>{e.stopPropagation();setSelectedItem(null);}}
                                    style={{ background:"none", border:"none", color:P.dm, fontSize:14, cursor:"pointer", padding:"0 2px" }}>×</button>
                                </div>
                                {s.topTickers.map((tk,j) => {
                                  const tkBull = tk.bull >= tk.bear;
                                  const sqColor = tkBull ? P.bu : P.be;
                                  return (
                                    <div key={j}
                                      onClick={e=>{e.stopPropagation(); setSelectedItem({_secKey:hk, _drilldownTicker:tk.s});}}
                                      style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 6px", borderBottom:j<s.topTickers.length-1?("1px solid "+P.bd+"20"):"none", cursor:"pointer", borderRadius:3, transition:"background 0.1s" }}
                                      onMouseEnter={e=>{e.currentTarget.style.background=P.al;}}
                                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                                      <span style={{ fontWeight:800, color:P.wh }}>{tk.s}</span>
                                      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                                        <span style={{ fontWeight:700, color:P.ac }}>{fmt(tk.p)}</span>
                                        <span style={{ width:9, height:9, borderRadius:2, background:sqColor, display:"inline-block", flexShrink:0 }} title={tkBull?"Bullish":"Bearish"} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            ) : (
                              // Inline ticker drilldown — clusters + top trades for the clicked ticker
                              (()=>{
                                const tk = D.TICKER_DB.find(t=>t.s===selectedItem._drilldownTicker);
                                if (!tk) return (
                                  <div style={{ padding:"6px 4px" }}>
                                    <button onClick={e=>{e.stopPropagation();setSelectedItem({_secKey:hk});}}
                                      style={{ background:"none", border:"none", color:P.dm, fontSize:10, cursor:"pointer", padding:0 }}>← Back</button>
                                    <div style={{ marginTop:6, color:P.dm }}>No data for {selectedItem._drilldownTicker}.</div>
                                  </div>
                                );
                                const tkClusters = (tk.c||[]).slice(0,4);
                                const tkTopTrades = (tk.t||[]).slice(0,6);
                                const tkBull = (tk.b||0) >= (tk.r||0);
                                return (
                                  <>
                                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, gap:8 }}>
                                      <button onClick={e=>{e.stopPropagation();setSelectedItem({_secKey:hk});}}
                                        title={`Back to ${s.name} top tickers`}
                                        style={{ background:"none", border:"none", color:P.dm, fontSize:11, cursor:"pointer", padding:0, fontWeight:700 }}>← Back</button>
                                      <span style={{ fontWeight:800, color:P.ac, fontSize:13, flex:1, textAlign:"center" }}>
                                        {tk.s} <span style={{ fontSize:9, color:tkBull?P.bu:P.be, marginLeft:4 }}>{tkBull?"BULL":"BEAR"}</span>
                                      </span>
                                      <button onClick={e=>{e.stopPropagation(); setChartModal({sym:tk.s}); setChartInterval("D");}}
                                        title={`Open ${tk.s} chart in TradingView`}
                                        style={{ background:P.bg, border:"1px solid "+P.bl, color:P.ac, fontSize:9, fontWeight:700, cursor:"pointer", padding:"2px 8px", borderRadius:3, fontFamily:"inherit" }}>
                                        📈 Chart
                                      </button>
                                    </div>
                                    <div style={{ display:"flex", gap:10, fontSize:9, marginBottom:8, paddingBottom:6, borderBottom:"1px solid "+P.bd+"20" }}>
                                      <span style={{ color:P.bu, fontWeight:700 }}>BULL {fmt(tk.b||0)}</span>
                                      <span style={{ color:P.be, fontWeight:700 }}>BEAR {fmt(tk.r||0)}</span>
                                      <span style={{ color:P.dm, marginLeft:"auto" }}>{tk.n||0} trades</span>
                                    </div>
                                    {tkClusters.length>0 && (
                                      <>
                                        <div style={{ fontSize:8, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:4, textTransform:"uppercase" }}>Consistency (2+ hits)</div>
                                        {tkClusters.map((cl,ci)=>{
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
                                    {tkTopTrades.length>0 && (
                                      <>
                                        <div style={{ fontSize:8, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:4, marginTop:tkClusters.length>0?8:0, textTransform:"uppercase" }}>Top Trades</div>
                                        {tkTopTrades.map((tr,ti)=>{
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
                                      <button onClick={e=>{e.stopPropagation(); setSearch(tk.s); setSelectedTicker(tk); setTab("Search"); setSelectedItem(null);}}
                                        style={{ padding:"4px 14px", borderRadius:4, border:"1px solid "+P.bl, background:P.cd, color:P.ac, fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                        View Full {tk.s} Flow →
                                      </button>
                                    </div>
                                  </>
                                );
                              })()
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
                {/* Theme Flow view */}
                {sectorView==="themes" && (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:6 }}>
                  {(FD.THEMES||[]).length > 0 ? (FD.THEMES||[]).map((th,i) => {
                    const total = th.bull + th.bear;
                    const bullPct = total > 0 ? th.bull / total * 100 : 50;
                    const isBull = th.bull >= th.bear;
                    const dirC = isBull ? P.bu : P.be;
                    const hk = "thm_"+i;
                    return (
                      <div key={i} style={{ position:"relative" }}
                        onClick={()=>setSelectedItem(prev=>prev&&prev._secKey===hk?null:{_secKey:hk})}>
                        <div style={{ background:P.al, borderRadius:6, padding:"8px 10px", border:"1px solid "+((selectedItem&&selectedItem._secKey===hk)?P.ac:P.bd), cursor:"pointer", transition:"border-color 0.15s",
                          borderLeft:"3px solid "+dirC }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                            <span style={{ fontSize:10, fontWeight:800, color:P.wh }}>{th.name}</span>
                            <span style={{ width:8, height:8, borderRadius:2, background:dirC, display:"inline-block" }} title={isBull?"Bullish":"Bearish"} />
                          </div>
                          <div style={{ fontSize:12, fontWeight:800, color:P.ac }}>{fmt(total)}</div>
                          <div style={{ display:"flex", gap:8, fontSize:9, marginTop:3 }}>
                            <span style={{ color:P.bu, fontWeight:700 }}>B {fmt(th.bull)}</span>
                            <span style={{ color:P.be, fontWeight:700 }}>R {fmt(th.bear)}</span>
                          </div>
                          <div style={{ width:"100%", height:3, background:P.be, borderRadius:2, marginTop:4 }}>
                            <div style={{ width:bullPct+"%", height:"100%", background:P.bu, borderRadius:2 }} />
                          </div>
                          <div style={{ fontSize:8, color:P.dm, marginTop:2 }}>{th.count} trades · {Object.keys(th.tickers).length} tickers</div>
                        </div>
                        {/* Theme ticker dropdown — with inline drill-down on click */}
                        {selectedItem&&selectedItem._secKey===hk && th.topTickers && th.topTickers.length > 0 && (
                          <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, marginTop:4, minWidth:280, maxWidth:420,
                            background:P.cd, border:"1px solid "+P.bl, borderRadius:8, padding:"10px 12px", fontSize:10,
                            boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}
                            onClick={e=>e.stopPropagation()}>
                            {!selectedItem._drilldownTicker ? (
                              // Top tickers list (clickable for drill-down)
                              <>
                                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                                  <span style={{ fontWeight:800, color:P.ac, fontSize:11 }}>{th.name}</span>
                                  <button onClick={e=>{e.stopPropagation();setSelectedItem(null);}}
                                    style={{ background:"none", border:"none", color:P.dm, fontSize:14, cursor:"pointer", padding:"0 2px" }}>×</button>
                                </div>
                                {th.topTickers.map((tk,j) => {
                                  const tkTotal = tk.bull + tk.bear;
                                  const tkBull = tk.bull >= tk.bear;
                                  const sqColor = tkBull ? P.bu : P.be;
                                  return (
                                    <div key={j}
                                      onClick={e=>{e.stopPropagation(); setSelectedItem({_secKey:hk, _drilldownTicker:tk.s});}}
                                      style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 6px", borderBottom:j<th.topTickers.length-1?("1px solid "+P.bd+"20"):"none", cursor:"pointer", borderRadius:3, transition:"background 0.1s" }}
                                      onMouseEnter={e=>{e.currentTarget.style.background=P.al;}}
                                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                        <span style={{ width:6, height:6, borderRadius:1, background:sqColor, display:"inline-block", flexShrink:0 }} />
                                        <span style={{ fontWeight:800, color:P.wh }}>{tk.s}</span>
                                      </div>
                                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                        <span style={{ fontSize:9, color:P.bu, fontWeight:700 }}>{fmt(tk.bull)}</span>
                                        <span style={{ fontSize:9, color:P.be, fontWeight:700 }}>{fmt(tk.bear)}</span>
                                        <span style={{ fontWeight:700, color:P.ac, fontSize:9 }}>{fmt(tkTotal)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            ) : (
                              // Inline ticker drilldown
                              (()=>{
                                const tk = D.TICKER_DB.find(t=>t.s===selectedItem._drilldownTicker);
                                if (!tk) return (
                                  <div style={{ padding:"6px 4px" }}>
                                    <button onClick={e=>{e.stopPropagation();setSelectedItem({_secKey:hk});}}
                                      style={{ background:"none", border:"none", color:P.dm, fontSize:10, cursor:"pointer", padding:0 }}>← Back</button>
                                    <div style={{ marginTop:6, color:P.dm }}>No data for {selectedItem._drilldownTicker}.</div>
                                  </div>
                                );
                                const tkClusters = (tk.c||[]).slice(0,4);
                                const tkTopTrades = (tk.t||[]).slice(0,6);
                                const tkBull = (tk.b||0) >= (tk.r||0);
                                return (
                                  <>
                                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, gap:8 }}>
                                      <button onClick={e=>{e.stopPropagation();setSelectedItem({_secKey:hk});}}
                                        title={`Back to ${th.name} tickers`}
                                        style={{ background:"none", border:"none", color:P.dm, fontSize:11, cursor:"pointer", padding:0, fontWeight:700 }}>← Back</button>
                                      <span style={{ fontWeight:800, color:P.ac, fontSize:13, flex:1, textAlign:"center" }}>
                                        {tk.s} <span style={{ fontSize:9, color:tkBull?P.bu:P.be, marginLeft:4 }}>{tkBull?"BULL":"BEAR"}</span>
                                      </span>
                                      <button onClick={e=>{e.stopPropagation(); setChartModal({sym:tk.s}); setChartInterval("D");}}
                                        title={`Open ${tk.s} chart in TradingView`}
                                        style={{ background:P.bg, border:"1px solid "+P.bl, color:P.ac, fontSize:9, fontWeight:700, cursor:"pointer", padding:"2px 8px", borderRadius:3, fontFamily:"inherit" }}>
                                        📈 Chart
                                      </button>
                                    </div>
                                    <div style={{ display:"flex", gap:10, fontSize:9, marginBottom:8, paddingBottom:6, borderBottom:"1px solid "+P.bd+"20" }}>
                                      <span style={{ color:P.bu, fontWeight:700 }}>BULL {fmt(tk.b||0)}</span>
                                      <span style={{ color:P.be, fontWeight:700 }}>BEAR {fmt(tk.r||0)}</span>
                                      <span style={{ color:P.dm, marginLeft:"auto" }}>{tk.n||0} trades</span>
                                    </div>
                                    {tkClusters.length>0 && (
                                      <>
                                        <div style={{ fontSize:8, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:4, textTransform:"uppercase" }}>Consistency (2+ hits)</div>
                                        {tkClusters.map((cl,ci)=>{
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
                                    {tkTopTrades.length>0 && (
                                      <>
                                        <div style={{ fontSize:8, fontWeight:700, color:P.mt, letterSpacing:1, marginBottom:4, marginTop:tkClusters.length>0?8:0, textTransform:"uppercase" }}>Top Trades</div>
                                        {tkTopTrades.map((tr,ti)=>{
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
                                      <button onClick={e=>{e.stopPropagation(); setSearch(tk.s); setSelectedTicker(tk); setTab("Search"); setSelectedItem(null);}}
                                        style={{ padding:"4px 14px", borderRadius:4, border:"1px solid "+P.bl, background:P.cd, color:P.ac, fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                        View Full {tk.s} Flow →
                                      </button>
                                    </div>
                                  </>
                                );
                              })()
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }) : <div style={{ gridColumn:"1/-1", textAlign:"center", padding:16, color:P.dm, fontSize:11 }}>No themed tickers found in current flow data</div>}
                </div>
                )}
              </Card>
            )}

            {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}

            {/* TOP 10 FLOW PICKS */}
            {D && D.all_directional && (()=>{
              const ad = capFilter==="All" ? (D.all_directional||[]) : (D.all_directional||[]).filter(t=>capBand(t.mktcap)===capFilter);
              if (!ad.length) return null;
              // Pre-build TOTAL premium per (ticker,contract) from broader trade list
              // (includes B-side MAGENTA call buys etc. that don't get a direction
              // assigned per the strict A/AA-only rule, but are real flow on the strike).
              // Used for DISPLAY ONLY — scoring/exit detection still use the directional
              // subset to avoid misclassifying ambiguous flow as conviction.
              const allTrades = capFilter==="All" ? (D.all_trades||[]) : (D.all_trades||[]).filter(t=>capBand(t.mktcap)===capFilter);
              const contractTotals = {};
              for (const t of allTrades) {
                const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
                if (!contractTotals[k]) contractTotals[k] = {hits:0, prem:0};
                contractTotals[k].hits++;
                contractTotals[k].prem += (t.P||0);
              }
              const _now = new Date();
              const _parseDt = (dt) => { if(!dt) return null; const p=dt.split("/").map(Number); return p.length>=2?new Date(_now.getFullYear(),p[0]-1,p[1]):null; };
              const tkMap = {};
              ad.forEach(t => {
                if (!tkMap[t.S]) tkMap[t.S]={sym:t.S,bull:0,bear:0,n:0,swp:0,blk:0,swpAsk:0,swpBid:0,confirmed:0,band:capBand(t.mktcap),
                  contracts:{},hasER:!!t.er,minDTE:999,mktcap:t.mktcap||0,sector:t.sector||"",lastDate:null,hasUOA:false};
                const tk=tkMap[t.S];
                if(t.D==="BULL") tk.bull+=t.P; if(t.D==="BEAR") tk.bear+=t.P;
                tk.n++;
                if(t.Ty==="SWP") {
                  tk.swp++;
                  if(t.Si==="A"||t.Si==="AA") tk.swpAsk++;
                  else if(t.Si==="B"||t.Si==="BB") tk.swpBid++;
                } else if(t.Ty==="BLK") tk.blk++;
                if(t.confirmed) tk.confirmed++;
                if(t.uoa) tk.hasUOA=true;
                if(t.DTE!=null && t.DTE<tk.minDTE) tk.minDTE=t.DTE;
                const tDate=_parseDt(t.Dt);
                if(tDate&&(!tk.lastDate||tDate>tk.lastDate)) tk.lastDate=tDate;
                const ck=t.CP+"|"+t.K+"|"+t.E;
                if(!tk.contracts[ck]) tk.contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,vol:0,oi:0,lastOI:0,askPrem:0,bidPrem:0,prices:[],lastDate:null,spot:0};
                const c=tk.contracts[ck]; c.hits++; c.prem+=t.P; c.vol+=(t.V||0);
                if(t.OI>c.oi) c.oi=t.OI;
                if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
                if(t.price>0) c.prices.push(t.price);
                if(tDate&&(!c.lastDate||tDate>=c.lastDate)){ c.lastDate=tDate; c.lastOI=t.OI||c.lastOI; if(t.Spot>0) c.spot=t.Spot; }
              });
              const candidates = [];
              Object.values(tkMap).forEach(tk => {
                const total=tk.bull+tk.bear;
                if(total===0) return;
                const net=Math.abs(tk.bull-tk.bear);
                const purity=Math.max(tk.bull,tk.bear)/total*100;
                const dir=tk.bull>=tk.bear?"BULL":"BEAR";
                const hasBoth=tk.swp>0&&tk.blk>0;
                const swpRatio=tk.swp/(tk.swp+tk.blk);
                if(purity<70) return;
                // Trade-count hard gate removed — premium > count.
                // Cap-band premium gates below ($250K Mid-Small / $1M Large / $10M Mega)
                // already filter out noise. A single $1M ASK sweep shouldn't fail just
                // because it's not a 3-hit cluster. The +20% confirmed≥3 modifier below
                // still rewards multi-hit consistency without making it a hard cutoff.
                if(tk.swp<1) return;
                if(tk.hasER&&tk.minDTE<=14) return;
                let score=0;
                if(tk.band==="Mega"){ if(net<10e6) return; score=net/10e6; }
                else if(tk.band==="Large"){ if(net<1e6) return; score=net/1e6*1.5; }
                else { if(net<250e3) return; score=net/250e3*2.0; }
                if(hasBoth) score*=1.3;
                if(purity>=90) score*=1.2;
                if(tk.confirmed>=3) score*=1.2;
                if(swpRatio<0.3) score*=0.3;
                else if(swpRatio<0.5) score*=0.6;
                const topC=Object.values(tk.contracts).sort((a,b)=>b.prem-a.prem)[0];
                const volOI=topC&&topC.oi>0?topC.vol/topC.oi:0;
                if(volOI>2) score*=1.15;
                const topDTE = topC ? (topC.exp ? Math.round((new Date(topC.exp)-new Date())/(86400000)) : 999) : 0;
                if((tk.band==="Large"||tk.band==="Mega") && topDTE>180) score*=0.2;
                else if(tk.band==="Mid-Small" && topDTE>180) score*=0.8;
                // Exit detection — penalize closing flow, not age
                const daysSince = tk.lastDate ? Math.max(0,Math.round((_now-tk.lastDate)/86400000)) : 30;
                const lastDateStr = tk.lastDate ? `${tk.lastDate.getMonth()+1}/${tk.lastDate.getDate()}` : "—";
                const freshLabel = daysSince<=1?"Today":daysSince<=2?"Yesterday":lastDateStr;
                // Bid-side exit ratio on top contract: high bid% = closing trades
                const exitRatio = topC&&topC.prem>0 ? topC.bidPrem/topC.prem : 0;
                // OI retention: lastOI vs maxOI — declining OI = positions closed
                const oiRetention = topC&&topC.oi>0&&topC.lastOI>0 ? topC.lastOI/topC.oi : 1;
                let posStatus = "ACTIVE";
                if(exitRatio>0.5 || oiRetention<0.5) { score*=0.3; posStatus="CLOSED"; }
                else if(exitRatio>0.3 || oiRetention<0.7) { score*=0.6; posStatus="FADING"; }
                else if(exitRatio<0.1 && oiRetention>=0.9) { score*=1.1; posStatus="ACTIVE"; }
                // Stale with no exit data still gets slight discount
                if(daysSince>=14 && posStatus==="ACTIVE") posStatus="HOLDING";
                const entry = topC&&topC.prices.length>0 ? topC.prices.reduce((a,b)=>a+b,0)/topC.prices.length : 0;
                // Look up TOTAL premium/hits for the top contract from the broader
                // trade list. Falls back to directional-only if no entry (shouldn't happen).
                let topCDisplayPrem = topC ? topC.prem : 0;
                let topCDisplayHits = topC ? topC.hits : 0;
                if (topC) {
                  const k = tk.sym+"|"+topC.cp+"|"+topC.K+"|"+topC.exp;
                  const totals = contractTotals[k];
                  if (totals) {
                    topCDisplayPrem = totals.prem;
                    topCDisplayHits = totals.hits;
                  }
                }
                candidates.push({...tk,net,purity,dir,score,hasBoth,topC,volOI,entry,daysSince,freshLabel,posStatus,exitRatio,oiRetention,topCDisplayPrem,topCDisplayHits});
              });
              candidates.sort((a,b)=>b.score-a.score);
              // Apply call/put filter: Calls = BULL picks, Puts = BEAR picks
              const filtered = top5Filter==="Both" ? candidates
                : top5Filter==="Calls" ? candidates.filter(c=>c.dir==="BULL")
                : top5Filter==="Puts" ? candidates.filter(c=>c.dir==="BEAR")
                : candidates.filter(c=>c.hasUOA || c.volOI>=3 || (c.mktcap>0 && c.mktcap<10e9 && c.net>=c.mktcap*0.001));
              const picks=[]; let megaC=0; const sectorC={};
              for(const c of filtered){
                if(picks.length>=10) break;
                if(c.band==="Mega"){ if(megaC>=3) continue; megaC++; }
                if(c.sector){ sectorC[c.sector]=(sectorC[c.sector]||0)+1; if(sectorC[c.sector]>3) continue; }
                picks.push(c);
              }
              if(!picks.length) return null;
              const allContracts=picks.filter(p=>p.topC).map(p=>({sym:p.sym,cp:p.topC.cp,strike:p.topC.K,exp:p.topC.exp}));
              return (
                <Card>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ fontSize:14, fontWeight:900, color:P.ac, letterSpacing:1 }}>TOP 10 FLOW PICKS</div>
                      <div style={{ display:"flex", gap:2, background:P.bg, borderRadius:5, padding:2 }}>
                        {["Both","Calls","Puts","Unusual"].map(f=>(
                          <button key={f} onClick={()=>setTop5Filter(f)} style={{
                            padding:"3px 10px", borderRadius:4, border:"none", cursor:"pointer",
                            fontSize:9, fontWeight:700, fontFamily:"inherit",
                            background:top5Filter===f?(f==="Unusual"?"#ff980022":P.ac+"22"):"transparent",
                            color:top5Filter===f?(f==="Unusual"?"#ff9800":P.ac):P.dm
                          }}>{f}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:9, color:P.dm }}>Cap-weighted · sweep required</span>
                      <button onClick={()=>fetchPrices(allContracts)} disabled={fetchLoading}
                        style={{ padding:"3px 10px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                          fontSize:9, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                        {fetchLoading?"Fetching…":"⚡ Fetch Live P/L"}
                      </button>
                    </div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {/* Column headers — shown once above the picks list */}
                    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 12px", fontSize:7, color:P.dm, letterSpacing:0.5, fontWeight:700 }}>
                      <span style={{ width:16, flexShrink:0 }} />
                      <span style={{ width:50, flexShrink:0 }} />
                      {/* Spacer matching dir Tag width so columns align */}
                      {(top5Filter==="Both" || top5Filter==="Unusual") && <span style={{ display:"inline-block", padding:"2px 7px", fontSize:9, visibility:"hidden", whiteSpace:"nowrap" }}>BULL</span>}
                      <div title="Net premium = |bull premium − bear premium|. % below = conviction (purity of one-sided flow)." style={{ width:70, textAlign:"right", flexShrink:0, cursor:"help" }}>NET</div>
                      <div style={{ width:1, flexShrink:0 }} />
                      <div style={{ width:150, textAlign:"center", flexShrink:0 }}>TOP CONTRACT</div>
                      <div style={{ width:1, flexShrink:0 }} />
                      <div style={{ width:50, textAlign:"center", flexShrink:0 }}>GRADE</div>
                      <div style={{ width:1, flexShrink:0 }} />
                      <div style={{ width:130, flexShrink:0 }} />
                      <div style={{ width:1, flexShrink:0 }} />
                      <div style={{ width:80, textAlign:"center", flexShrink:0 }}>OPEN INTEREST</div>
                      <div style={{ width:1, flexShrink:0 }} />
                      <div style={{ width:140, flexShrink:0 }} />
                    </div>
                    {picks.map((p,i) => {
                      const dirC=p.dir==="BULL"?P.bu:P.be;
                      const tc=p.topC;
                      const tcSide=tc?(tc.askPrem>=tc.bidPrem?"ask":"bid"):"ask";
                      let tcC=P.dm;
                      if(tc){ if(tc.cp==="C") tcC=tcSide==="ask"?P.bu:"#ff9800"; else tcC=tcSide==="ask"?P.be:"#29b6f6"; }
                      const grade=p.purity>=95&&p.hasBoth&&p.confirmed>=3?"A+":p.purity>=85&&p.hasBoth?"A":p.purity>=75&&p.confirmed>=2?"B+":"B";
                      const gradeC=grade==="A+"?P.ac:grade==="A"?P.bu:grade==="B+"?P.ye:P.dm;
                      const px = tc ? getPrice(p.sym,tc.cp,tc.K,tc.exp) : null;
                      const now = px ? (px.mark||px.last||px.mid||0) : 0;
                      const entry = p.entry||0;
                      const pnl = (now>0&&entry>0) ? (now-entry)/entry*100 : null;
                      // Compute live OI delta ONCE — shared between posNote and OI column
                      // so the two columns can't contradict each other (e.g. OI column says
                      // PARTIAL EXIT while posNote says "minimal exits").
                      const liveOIPx = tc ? getPrice(p.sym, tc.cp, tc.K, tc.exp) : null;
                      const liveOI = liveOIPx ? (liveOIPx.oi || 0) : 0;
                      const tradeOI = tc ? (tc.lastOI || 0) : 0;
                      const haveOIData = liveOI > 0 && tradeOI > 0;
                      const oiPct = haveOIData ? (liveOI - tradeOI) / tradeOI : null;
                      const oiDelta = haveOIData ? liveOI - tradeOI : 0;
                      // Auto-generate notes
                      const notes = [];
                      // NEW: whale single-trade lead — large premium concentrated in ≤2 prints
                      if(p.topCDisplayHits<=2 && p.topCDisplayPrem>=2e6) {
                        notes.push({t:`Whale: ${fmt(p.topCDisplayPrem)} in ${p.topCDisplayHits===1?"single sweep":"two prints"}`,w:12});
                      }
                      // NEW: fresh strike — no prior OI means the flow is brand-new positioning
                      if(tc && tc.oi < 100 && p.topCDisplayPrem >= 500e3) {
                        notes.push({t:"Fresh strike — no prior interest",w:11});
                      }
                      // Use broader hit count for notes (matches what user sees in Search/BBS)
                      if(p.topCDisplayHits>=5) notes.push({t:`${p.topCDisplayHits} hits — sustained accumulation`,w:10});
                      else if(p.topCDisplayHits>=3) notes.push({t:`${p.topCDisplayHits}x same strike — concentrated`,w:6});
                      // Top contract dominates ticker flow
                      if(p.net>0 && p.topCDisplayPrem>=p.net*0.7) notes.push({t:`${fmt(p.topCDisplayPrem)} of ${fmt(p.net)} on one strike`,w:9});
                      if(p.hasBoth) {
                        const askSwpPct = p.swp>0 ? Math.round(p.swpAsk/p.swp*100) : 0;
                        notes.push({t:`Sweeps + blocks (${askSwpPct}% ask-side sweeps)`,w:8});
                      }
                      else if(p.swp>0&&p.blk===0) {
                        const askSwpPct = Math.round(p.swpAsk/p.swp*100);
                        notes.push({t:`All sweeps (${askSwpPct}% ask-side) — urgency signal`,w:7});
                      }
                      const askPct=tc&&tc.prem>0?(tc.askPrem/tc.prem*100):50;
                      if(askPct>=90) notes.push({t:"All ask-side — aggressive buyers",w:7});
                      if(p.volOI>=10) notes.push({t:`Vol ${Math.round(p.volOI)}x OI — brand new positions`,w:9});
                      else if(p.volOI>=3) notes.push({t:`Vol ${p.volOI.toFixed(1)}x OI — fresh positions`,w:7});
                      if(p.minDTE>180) notes.push({t:"LEAPS — long-term conviction play",w:8});
                      if(p.mktcap>0&&p.mktcap<5e9&&p.net>=1e6) notes.push({t:`${fmt(p.net)} on a $${(p.mktcap/1e9).toFixed(1)}B name`,w:9});
                      // Purity tiers — tells you how much counter-flow chews the directional read
                      if(p.purity>=95) notes.push({t:`${Math.round(p.purity)}% one-way — minimal hedging`,w:6});
                      else if(p.purity>=80) notes.push({t:`${Math.round(p.purity)}% directional — modest hedging`,w:5});
                      else if(p.purity>=60) notes.push({t:`${Math.round(p.purity)}% lean — meaningful hedging`,w:4});
                      if(p.confirmed>=5) notes.push({t:`${p.confirmed} confirmed trades — sustained`,w:7});
                      else if(p.confirmed>=3) notes.push({t:`${p.confirmed} confirmed — repeat interest`,w:5});
                      notes.sort((a,b)=>b.w-a.w);
                      const topNotes = notes.slice(0,2).map(n=>n.t);
                      // Position activity note — prefer LIVE OI delta over bid-side ratio
                      // when we have it (authoritative). bid-side ratio is fallback only.
                      // This keeps posNote and the OI column in agreement.
                      let posNote = "";
                      const bidPct = tc&&tc.prem>0 ? tc.bidPrem/tc.prem*100 : 0;
                      if (haveOIData) {
                        // Live OI is the source of truth
                        if (oiPct >= 0.20) posNote = `📈 Adding — OI +${oiDelta.toLocaleString()}`;
                        else if (oiPct >= 0.05) posNote = "📈 Accumulating";
                        else if (oiPct > -0.10) {
                          // Flat OI — distinguish by bid-side activity within the flat band
                          if (bidPct >= 30) posNote = `⚠️ Partial exits — ${Math.round(bidPct)}% bid`;
                          else if (p.daysSince<=2 && tc && tc.hits<=3) posNote = "🆕 New entry";
                          else if (p.daysSince<=3 && tc && tc.hits>=5 && bidPct<15) posNote = "🔥 Active — OI pending";
                          else posNote = "✅ Holding";
                        }
                        else if (oiPct > -0.30) posNote = `⚠️ Fading — ${oiDelta.toLocaleString()}`;
                        else if (oiPct > -0.70) posNote = `🔻 Partial exits — ${oiDelta.toLocaleString()}`;
                        else posNote = `🔻 Mostly exited — ${oiDelta.toLocaleString()}`;
                      } else {
                        // No live OI data — fall back to bid-side ratio
                        if (bidPct >= 50) posNote = `🔻 Heavy exits — ${Math.round(bidPct)}% closing`;
                        else if (bidPct >= 30) posNote = `⚠️ Partial exits — ${Math.round(bidPct)}% bid`;
                        else if (bidPct >= 15) posNote = `⚠️ Partial exits — ${Math.round(bidPct)}% bid`;
                        else if (p.daysSince<=2 && tc && tc.hits<=3) posNote = "🆕 New entry";
                        else if (p.daysSince<=3 && tc && tc.hits>=5) posNote = "🔥 Active — OI pending";
                        else if (p.daysSince>=7) posNote = "💤 Holding";
                        else posNote = "✅ Holding";
                      }
                      // Freshness + last OI
                      const freshC = p.daysSince<=1?P.bu:p.daysSince<=3?P.ac:p.daysSince>=7?P.be:P.dm;
                      const lastOI = tc?tc.lastOI:0;
                      return (
                        <div key={p.sym}>
                        <div onClick={()=>setTop5Detail(top5Detail===p.sym?null:p.sym)} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:P.al, borderRadius:8, borderLeft:"3px solid "+dirC, cursor:"pointer" }}>
                          <span style={{ fontSize:16, fontWeight:900, color:P.dm+"88", width:16, textAlign:"center", flexShrink:0 }}>{i+1}</span>
                          <span style={{ fontSize:14, fontWeight:900, color:P.wh, width:50, flexShrink:0 }}>{p.sym}</span>
                          {(top5Filter==="Both" || top5Filter==="Unusual") && <Tag c={dirC}>{p.dir}</Tag>}
                          <div style={{ width:70, textAlign:"right", flexShrink:0 }}>
                            <div style={{ fontSize:13, fontWeight:900, color:dirC }}>{fmt(p.net)}</div>
                            <div style={{ fontSize:8, color:P.dm }}>{Math.round(p.purity)}%</div>
                          </div>
                          <div style={{ height:16, width:1, background:P.bd, flexShrink:0 }}/>
                          <div style={{ fontSize:9, color:P.mt, width:150, flexShrink:0, textAlign:"center" }}>
                            {tc && (()=>{
                              // Moneyness: prefer live spot from price fetch, fall back to last-trade spot
                              const spotForMoney = (liveOIPx && liveOIPx.spot) || tc.spot || 0;
                              let mny = null;
                              if (spotForMoney > 0 && tc.K > 0) {
                                const pctOff = (tc.K - spotForMoney) / spotForMoney * 100;
                                const isATM = Math.abs(pctOff) <= 1;
                                const isITM = tc.cp==="C" ? tc.K < spotForMoney : tc.K > spotForMoney;
                                const label = isATM ? "ATM" : isITM ? "ITM" : "OTM";
                                const mC = isATM ? P.ye : isITM ? P.bu : P.dm;
                                const absPct = Math.abs(pctOff).toFixed(0);
                                mny = { label, color:mC, pct: isATM ? "" : (isITM ? "" : "+"+absPct+"%") };
                              }
                              return (<div>
                                <span style={{ color:tcC, fontWeight:800 }}>{tc.cp==="C"?"C":"P"}</span>
                                <span style={{ color:P.wh, fontWeight:700, marginLeft:3 }}>${tc.K}</span>
                                <span style={{ color:P.ac, marginLeft:3 }}>{tc.exp}</span>
                                <span style={{ color:p.topCDisplayHits>=10?P.ac:p.topCDisplayHits>=5?P.ye:P.dm, fontWeight:800, marginLeft:4 }}>{p.topCDisplayHits}x</span>
                                <div style={{ fontSize:8, color:P.ye, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                                  <span>{fmt(p.topCDisplayPrem)}</span>
                                  {mny && <span style={{ fontSize:7, fontWeight:700, color:mny.color, padding:"0 4px", borderRadius:2, background:mny.color+"18", letterSpacing:0.3 }}>{mny.label}{mny.pct?" "+mny.pct:""}</span>}
                                </div>
                              </div>);
                            })()}
                          </div>
                          <div style={{ height:16, width:1, background:P.bd, flexShrink:0 }}/>
                          <div style={{ width:50, display:"flex", justifyContent:"center", flexShrink:0 }}>
                            <span style={{ fontSize:12, fontWeight:900, color:gradeC, padding:"2px 8px", borderRadius:4, background:gradeC+"18", border:"1px solid "+gradeC+"44", flexShrink:0 }}>{grade}</span>
                          </div>
                          <div style={{ height:16, width:1, background:P.bd, flexShrink:0 }}/>
                          <div style={{ fontSize:9, width:130, flexShrink:0 }}>
                            {entry>0 ? (<span>
                              <span style={{ color:P.dm }}>${entry.toFixed(2)}</span>
                              {pnl!==null ? (<span>
                                <span style={{ color:P.dm, marginLeft:2 }}>→</span>
                                <span style={{ color:P.wh, fontWeight:700, marginLeft:2 }}>${now.toFixed(2)}</span>
                                <span style={{ color:pnl>=0?P.bu:P.be, fontWeight:800, marginLeft:3 }}>{pnl>=0?"+":""}{pnl.toFixed(1)}%</span>
                              </span>) : null}
                            </span>) : <span style={{ color:P.dm+"55" }}>—</span>}
                          </div>
                          <div style={{ height:16, width:1, background:P.bd, flexShrink:0 }}/>
                          <div style={{ width:80, flexShrink:0, fontSize:8, textAlign:"center" }}>
                            {(()=>{
                              // Option 3: each state surfaces the info that matters for it.
                              //   ADDING / GROWING → show absolute new-contracts (+N), real positioning grew
                              //   IN POSITION / FLAT → just the label (the OI numbers above tell size)
                              //   FADING / EXITED → show absolute closed-contracts (-N), magnitude of unwind
                              const px = tc ? getPrice(p.sym, tc.cp, tc.K, tc.exp) : null;
                              const liveOI = px ? (px.oi || 0) : 0;
                              const tradeOI = lastOI || 0;
                              if (!liveOI || !tradeOI) {
                                return tradeOI > 0
                                  ? <div style={{ color:P.wh, fontWeight:700 }}>{tradeOI.toLocaleString()}</div>
                                  : <span style={{ color:P.dm+"55" }}>—</span>;
                              }
                              const delta = liveOI - tradeOI;
                              const pct = delta / tradeOI;
                              let vColor, vLabel, vSuffix;
                              if (pct >= 0.20) { vColor = P.bu; vLabel = "ADDING"; vSuffix = " +" + delta.toLocaleString(); }
                              else if (pct >= 0.05) { vColor = P.bu+"CC"; vLabel = "GROWING"; vSuffix = " +" + delta.toLocaleString(); }
                              else if (pct > -0.10) {
                                if (liveOI >= 1000) { vColor = P.ac; vLabel = "IN POSITION"; vSuffix = ""; }
                                else { vColor = P.dm; vLabel = "FLAT"; vSuffix = ""; }
                              }
                              else if (pct > -0.30) { vColor = P.be+"99"; vLabel = "FADING"; vSuffix = " " + delta.toLocaleString(); }
                              else if (pct > -0.70) { vColor = P.be+"CC"; vLabel = "PARTIAL EXIT"; vSuffix = " " + delta.toLocaleString(); }
                              else { vColor = P.be; vLabel = "EXITED"; vSuffix = " " + delta.toLocaleString(); }
                              return (
                                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
                                  <div style={{ color:P.dm }}>{tradeOI.toLocaleString()}→{liveOI.toLocaleString()}</div>
                                  <div style={{ fontWeight:800, color:vColor }}>{vLabel}{vSuffix}</div>
                                </div>
                              );
                            })()}
                          </div>
                          <div style={{ height:16, width:1, background:P.bd, flexShrink:0 }}/>
                          <div style={{ width:140, flexShrink:0, fontSize:9, color:P.ac, fontWeight:600, textAlign:"center" }}>
                            {posNote || <span style={{ color:P.dm+"55" }}>—</span>}
                          </div>
                          <div style={{ flex:1, fontSize:10, color:P.dm, lineHeight:1.5, paddingLeft:12 }}>
                            {topNotes.map((n,ni)=><div key={ni} style={{ color:P.mt }}>{n}</div>)}
                          </div>
                          <span style={{ fontSize:9, color:P.dm+"66", flexShrink:0 }}>{top5Detail===p.sym?"▲":"▼"}</span>
                        </div>
                        {/* Expandable trade detail */}
                        {top5Detail===p.sym && (()=>{
                          const trades = ad.filter(t=>t.S===p.sym).sort((a,b)=>(b.P||0)-(a.P||0)).slice(0,5);
                          if(!trades.length) return null;
                          return (
                            <div style={{ background:P.bg, border:"1px solid "+P.bd, borderRadius:6, padding:10, marginTop:2, marginBottom:4, marginLeft:24 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                                <button onClick={e=>{e.stopPropagation(); setChartModal({sym:p.sym}); setChartInterval("D");}}
                                  title={`Open ${p.sym} chart`}
                                  style={{ padding:"3px 10px", borderRadius:4, border:"1px solid "+P.bl, background:P.cd, color:P.ac, fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                  📈 Chart
                                </button>
                                <div style={{ fontSize:9, fontWeight:700, color:P.ac }}>TOP {trades.length} TRADES BY PREMIUM</div>
                              </div>
                              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
                                <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                                  {["Date","Time","Type","Side","C/P","Strike","Exp","DTE","Vol","OI","Premium","Color"].map(h=>(
                                    <th key={h} style={{ padding:"3px 6px", textAlign:"center", color:P.dm, fontSize:8, fontWeight:600 }}>{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody>
                                  {trades.map((t,ti)=>{
                                    const sideC=t.Si==="A"||t.Si==="AA"?P.bu:t.Si==="B"||t.Si==="BB"?P.be:P.dm;
                                    const cpC=t.CP==="C"?P.bu:P.be;
                                    const coC=t.Co==="YELLOW"?P.ye:t.Co==="MAGENTA"?"#e040fb":P.dm;
                                    return (
                                      <tr key={ti} style={{ borderBottom:"1px solid "+P.bd+"22" }}>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.wh }}>{t.Dt||"—"}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.dm }}>{t.time||"—"}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:t.Ty==="SWP"?P.ac:P.mt, fontWeight:700 }}>{t.Ty}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:sideC, fontWeight:700 }}>{t.Si}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:cpC, fontWeight:700 }}>{t.CP==="C"?"CALL":"PUT"}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.wh, fontWeight:700 }}>${t.K}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.ac }}>{t.E}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.dm }}>{t.DTE}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.wh }}>{(t.V||0).toLocaleString()}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.dm }}>{(t.OI||0).toLocaleString()}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:P.wh, fontWeight:800 }}>{fmt(t.P)}</td>
                                        <td style={{ padding:"3px 6px", textAlign:"center", color:coC, fontWeight:700 }}>{t.Co}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })()}

            {/* ─── Chart Modal (uses StockChart — same colors as renderDetailPanel) ─── */}
            {chartModal && chartModal.sym && (() => {
              const sym = chartModal.sym;
              const tk = D && D.TICKER_DB ? D.TICKER_DB.find(t => t.s === sym) : null;
              const tkBull = tk ? ((tk.b||0) >= (tk.r||0)) : true;
              const dirC = tkBull ? P.bu : P.be;
              return (
                <div onClick={e => { if (e.target === e.currentTarget) setChartModal(null); }}
                  style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.8)",
                    display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
                  <div onClick={e => e.stopPropagation()}
                    style={{ width:"min(1100px, 96vw)", height:"min(720px, 92vh)",
                      background:P.cd, borderRadius:12, overflow:"hidden",
                      display:"flex", flexDirection:"column",
                      boxShadow:"0 24px 80px rgba(0,0,0,0.9)", border:"1px solid "+P.bl }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                      padding:"10px 14px", borderBottom:"1px solid "+P.bd, background:P.cd, flexShrink:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:16, fontWeight:900, color:P.wh }}>{sym}</span>
                        {tk && (
                          <>
                            <Tag c={dirC}>{tkBull ? "BULL" : "BEAR"}</Tag>
                            <span style={{ fontSize:11, fontWeight:900, color:P.ac, background:P.ac+"18", padding:"2px 8px", borderRadius:4 }}>
                              {fmt((tk.b||0)+(tk.r||0))}
                            </span>
                            <span style={{ fontSize:10, color:P.dm }}>{tk.n||0} trades</span>
                          </>
                        )}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <input type="text" value={chartModalSearch}
                          onChange={e => setChartModalSearch(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                          onKeyDown={e => {
                            if (e.key === "Enter" && chartModalSearch.trim()) {
                              setChartModal({ sym: chartModalSearch.trim() });
                              setChartModalSearch("");
                            } else if (e.key === "Escape") {
                              setChartModalSearch("");
                            }
                          }}
                          placeholder="Switch ticker…"
                          autoComplete="off" spellCheck={false}
                          style={{ background:P.bg, border:"1px solid "+P.bd, color:P.wh,
                            padding:"4px 10px", borderRadius:5, fontSize:11, fontWeight:700,
                            fontFamily:"inherit", width:120, letterSpacing:1, outline:"none" }} />
                        <button onClick={() => setChartModal(null)}
                          style={{ background:"none", border:"none", color:P.dm, fontSize:18, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>×</button>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:3, padding:"4px 6px", borderBottom:"1px solid "+P.bd, flexShrink:0, alignItems:"center" }}>
                      {[['1','1m'],['5','5m'],['15','15m'],['30','30m'],['60','1h'],['D','D'],['W','W'],['M','M']].map(([val,label]) => (
                        <button key={val} onClick={() => setChartInterval(val)}
                          style={{ padding:"2px 7px", borderRadius:3, border:"1px solid "+(chartInterval===val?P.ac:P.bd+"80"),
                            background:chartInterval===val?P.ac+"22":"transparent", color:chartInterval===val?P.ac:P.dm,
                            fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                          {label}
                        </button>
                      ))}
                      {/* Dark Pool toggle — applies globally (persists in localStorage).
                          Visually inert in admin's iframe-based StockChart; here for parity. */}
                      <button onClick={() => setShowDarkPool(v => !v)}
                        title={showDarkPool ? "Hide dark pool zones (no-op in admin until StockChart migrates)" : "Show dark pool zones"}
                        style={{ marginLeft:"auto", padding:"2px 8px", borderRadius:3,
                          border:"1px solid "+(showDarkPool?"#c9a84c":P.bd+"80"),
                          background:showDarkPool?"#c9a84c22":"transparent",
                          color:showDarkPool?"#c9a84c":P.dm,
                          fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                          display:"flex", alignItems:"center", gap:4 }}>
                        <span style={{ width:6, height:6, borderRadius:"50%",
                          background:showDarkPool?"#c9a84c":"transparent",
                          border:"1px solid "+(showDarkPool?"#c9a84c":P.dm), display:"inline-block" }} />
                        Dark Pools
                      </button>
                    </div>
                    <div style={{ flex:1, minHeight:0 }}>
                      <StockChart
                        sym={sym}
                        tf={chartInterval}
                        height="100%"
                        liveUpdates={true}
                        showDrawingTools={true}
                        showVolume={true}
                        onTfChange={setChartInterval}
                        darkPoolBars={chartModalDarkPoolBars}
                        hideReplay
                        hidePatterns
                        hideCompare
                        hideCountdown
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}


        {/* Leaderboard */}
        {tab==="Leaderboard" && FD && (()=>{
          // 2026-07-04: honor the Stocks tab by excluding ETFs/indexes
          // (and vice versa on the Indexes tab). Matches Watchlist behavior.
          const _tabOk = (t) => {
            const isEtf = isETFSymbol(t.S, t.stocketf);
            return dataMode === "stocks" ? !isEtf : isEtf;
          };
          const base = (D.clean_confirmed||[]).filter(_tabOk);
          const cc = capFilter==="All" ? base : base.filter(t => capBand(t.mktcap)===capFilter);
          const [convDte, setConvDte] = [convictionDte, setConvictionDte];
          const [cSort, setCSort] = [convictionSort, setConvictionSort];
          const [cPct, setCPct] = [convictionPct, setConvictionPct];
          const [cAct, setCAct] = [convictionActivity, setConvictionActivity];
          const [cExp, setCExp] = [convictionExpanded, setConvictionExpanded];
          const dteF = t => convDte==="All" ? true : convDte==="ST" ? t.DTE>=0&&t.DTE<60 : convDte==="LT" ? t.DTE>=60&&t.DTE<180 : t.DTE>=180;
          const filtered = cc.filter(dteF);
          // Get latest 2 trading dates for "New" badge
          const allDates = [...new Set(cc.map(t=>t.Dt).filter(Boolean))].sort((a,b)=>{
            const pa=a.split("/").map(Number), pb=b.split("/").map(Number);
            const ya=pa.length>=3?(pa[2]<100?pa[2]+2000:pa[2]):2026, yb=pb.length>=3?(pb[2]<100?pb[2]+2000:pb[2]):2026;
            return new Date(ya,pa[0]-1,pa[1]||1) - new Date(yb,pb[0]-1,pb[1]||1);
          });
          const recentDates = new Set(allDates.slice(-2));
          // Get dates for momentum: last 5 trading days vs prior
          const last5Dates = new Set(allDates.slice(-5));
          const priorDates = new Set(allDates.slice(0, -5));
          const tkMap = {};
          filtered.forEach(t => {
            if (!tkMap[t.S]) tkMap[t.S] = { sym:t.S, bull:0, bear:0, n:0, mktcap:t.mktcap||0, contracts:{}, recentPrem:0, priorPrem:0, recentPrem:0, priorPrem:0, er:false, sector:t.sector||"", uoa:false, dates:new Set() };
            const tk = tkMap[t.S];
            if (t.D==="BULL") tk.bull += t.P;
            if (t.D==="BEAR") tk.bear += t.P;
            tk.n++;
            if (t.er) tk.er = true;
            if (t.uoa) tk.uoa = true;
            tk.dates.add(t.Dt);
            // Momentum: split premium by recent vs prior
            if (last5Dates.has(t.Dt)) tk.recentPrem += t.P;
            if (priorDates.has(t.Dt)) tk.priorPrem += t.P;
            // Track first appearance
            const ck = t.CP+"|"+t.K+"|"+t.E;
            if (!tk.contracts[ck]) tk.contracts[ck] = { cp:t.CP, K:t.K, exp:t.E, hits:0, prem:0, dir:t.D, hasSweep:false, hasBlock:false, askPrem:0, bidPrem:0, maxOI:0, vol:0, volOI:0, dates:new Set() };
            const c = tk.contracts[ck]; c.hits++; c.prem += t.P; c.vol += t.V;
            if (t.Dt) c.dates.add(t.Dt);
            if (t.Ty==="SWP") c.hasSweep = true;
            if (t.Ty==="BLK") c.hasBlock = true;
            if (t.Si==="A"||t.Si==="AA") c.askPrem += t.P;
            if (t.Si==="B"||t.Si==="BB") c.bidPrem += t.P;
            if (t.OI > c.maxOI) c.maxOI = t.OI;
          });
          // Build broader contract totals from D.all_trades — used to overlay
          // displayPrem/displayHits so the "Top Contract" column reflects TOTAL flow
          // on the strike (matching Search Top Trades), while the directional values
          // (used for sort/score) stay strict.
          const lbBroader = {};
          (D.all_trades || []).forEach(t => {
            if (capFilter !== "All" && capBand(t.mktcap) !== capFilter) return;
            if (!dteF(t)) return;
            const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
            if (!lbBroader[k]) lbBroader[k] = {prem:0, hits:0};
            lbBroader[k].prem += t.P || 0;
            lbBroader[k].hits++;
          });
          Object.values(tkMap).forEach(tk => {
            const sorted = Object.values(tk.contracts).sort((a,b) => b.prem - a.prem);
            // Overlay broader prem/hits onto each contract entry (for display only)
            sorted.forEach(c => {
              const bk = tk.sym+"|"+c.cp+"|"+c.K+"|"+c.exp;
              const b = lbBroader[bk];
              c.displayPrem = b ? b.prem : c.prem;
              c.displayHits = b ? b.hits : c.hits;
            });
            tk.topContracts = sorted.slice(0,3);
            tk.topContract = sorted[0] || null;
            tk.contractCount = Object.keys(tk.contracts).length;
            // Compute vol/OI for top contract
            sorted.forEach(c => { c.volOI = c.maxOI > 0 ? c.vol / c.maxOI : 0; });
            // Bull %
            const total = tk.bull + tk.bear;
            tk.bullPct = total > 0 ? Math.round(tk.bull / total * 100) : 50;
            // Is new? (first appeared in last 2 trading days)
            const sortedDates = [...tk.dates].sort((a,b)=>{
              const pa=a.split("/").map(Number), pb=b.split("/").map(Number);
              const ya=pa.length>=3?(pa[2]<100?pa[2]+2000:pa[2]):2026, yb=pb.length>=3?(pb[2]<100?pb[2]+2000:pb[2]):2026;
              return new Date(ya,pa[0]-1,pa[1]||1) - new Date(yb,pb[0]-1,pb[1]||1);
            });
            tk.isNew = sortedDates.length > 0 && recentDates.has(sortedDates[0]);
            // Days active
            tk.daysActive = tk.dates.size;
            // Momentum: accelerating, steady, fading
            if (tk.priorPrem > 0) {
              const ratio = tk.recentPrem / tk.priorPrem;
              tk.momentum = ratio >= 1.5 ? "accel" : ratio >= 0.5 ? "steady" : "fading";
            } else {
              tk.momentum = tk.recentPrem > 0 ? "accel" : "steady";
            }
          });
          let allTickers = Object.values(tkMap);
          // Conviction % filter
          if (cPct === "90bull") allTickers = allTickers.filter(t => t.bullPct >= 90);
          else if (cPct === "80bull") allTickers = allTickers.filter(t => t.bullPct >= 80);
          else if (cPct === "90bear") allTickers = allTickers.filter(t => t.bullPct <= 10);
          else if (cPct === "80bear") allTickers = allTickers.filter(t => t.bullPct <= 20);
          // Activity filter
          if (cAct === "new") allTickers = allTickers.filter(t => t.isNew);
          else if (cAct === "uoa") allTickers = allTickers.filter(t => t.uoa);
          // Sort function
          const sortFn = (list, dir) => {
            return [...list].sort((a,b) => {
              if (cSort==="net") return dir==="bull" ? (b.bull-b.bear)-(a.bull-a.bear) : (b.bear-b.bull)-(a.bear-a.bull);
              if (cSort==="bull") return b.bull - a.bull;
              if (cSort==="bear") return b.bear - a.bear;
              if (cSort==="trades") return b.n - a.n;
              if (cSort==="contracts") return b.contractCount - a.contractCount;
              if (cSort==="bullpct") return dir==="bull" ? b.bullPct - a.bullPct : a.bullPct - b.bullPct;
              if (cSort==="momentum") { const mo={"accel":3,"steady":2,"fading":1}; return (mo[b.momentum]||0)-(mo[a.momentum]||0); }
              if (cSort==="days") return b.daysActive - a.daysActive;
              return 0;
            });
          };
          const bulls = sortFn(allTickers.filter(t => t.bull > t.bear), "bull");
          const bears = sortFn(allTickers.filter(t => t.bear > t.bull), "bear");
          const stN = cc.filter(t=>t.DTE>=0&&t.DTE<60).length;
          const ltN = cc.filter(t=>t.DTE>=60&&t.DTE<180).length;
          const leN = cc.filter(t=>t.DTE>=180).length;
          const momIcon = m => m==="accel"?"🟢":m==="fading"?"🔴":"🟡";
          const renderRow = (tk, idx, side) => {
            const total = tk.bull + tk.bear;
            const net = tk.bull - tk.bear;
            const dir = net > 0 ? "BULL" : "BEAR";
            const dirC = dir==="BULL" ? P.bu : P.be;
            const cap = capBand(tk.mktcap);
            const tc_ = tk.topContract;
            const tcSide = tc_ ? (tc_.askPrem >= tc_.bidPrem ? "ask" : "bid") : "ask";
            let tcC = P.dm;
            if (tc_) { if (tc_.cp==="C") tcC = tcSide==="ask" ? P.bu : "#ff9800"; else tcC = tcSide==="ask" ? P.be : "#29b6f6"; }
            const isExp = cExp === tk.sym;
            const displayPct = side==="bear" ? (100-tk.bullPct) : tk.bullPct;
            const pctColor = displayPct>=80 ? (side==="bear"?P.be:P.bu) : displayPct<=20 ? (side==="bear"?P.bu:P.be) : P.dm;
            return (
              <Fragment key={tk.sym}>
              <tr style={{ borderBottom:"1px solid "+P.bd+"15", cursor:"pointer", background:isExp?P.ac+"0a":idx<5?dirC+"06":"transparent" }}
                onClick={()=>{ setCExp(isExp ? null : tk.sym); }}>
                <td style={{ padding:"6px 5px", fontWeight:900, color:P.wh, fontSize:13 }}>
                  {tk.sym}
                  
                  {tk.er && <span style={{ fontSize:6, fontWeight:800, marginLeft:3, padding:"1px 4px", borderRadius:2, background:"#ff9800"+"22", color:"#ff9800" }}>ER</span>}
                  {tk.isNew && <span style={{ fontSize:6, fontWeight:800, marginLeft:3, padding:"1px 4px", borderRadius:2, background:P.ac+"22", color:P.ac }}>NEW</span>}
                </td>
                <td style={{ padding:"6px 5px", fontWeight:800, color:P.bu }}>{fmt(tk.bull)}</td>
                <td style={{ padding:"6px 5px", fontWeight:800, color:P.be }}>{fmt(tk.bear)}</td>
                <td style={{ padding:"6px 5px", width:60 }}>
                  <div style={{ display:"flex", height:4, borderRadius:2, overflow:"hidden", background:P.bd }}>
                    <div style={{ width:tk.bullPct+"%", background:P.bu }}/><div style={{ width:(100-tk.bullPct)+"%", background:P.be }}/>
                  </div>
                </td>
                <td style={{ padding:"6px 5px", fontWeight:800, fontSize:10, color:pctColor }}>{displayPct}%</td>
                <td style={{ padding:"6px 5px", fontWeight:900, color:dirC, fontSize:12 }}>{fmt(Math.abs(net))}</td>
                <td style={{ padding:"6px 5px", fontSize:9 }}>
                  {tc_ && (<span>
                    <span style={{ color:tcC, fontWeight:800 }}>{tc_.cp==="C"?"C":"P"}</span>
                    {tcSide==="bid" && <span style={{ fontSize:7, color:tcC, fontWeight:800, marginLeft:2, padding:"1px 4px", borderRadius:3, background:tcC+"22", border:"1px solid "+tcC+"44" }}>BB</span>}
                    <span style={{ color:P.wh, fontWeight:700, marginLeft:3 }}>${tc_.K}</span>
                    <span style={{ color:P.ac, marginLeft:3 }}>{tc_.exp}</span>
                    <span style={{ color:(tc_.displayHits||tc_.hits)>=10?P.ac:(tc_.displayHits||tc_.hits)>=5?P.ye:P.dm, fontWeight:800, marginLeft:4 }}>{tc_.displayHits||tc_.hits}x</span>
                    {(tc_.displayPrem||tc_.prem)>=1e6 && <span style={{ color:P.ye, marginLeft:3, fontSize:8 }}>{fmt(tc_.displayPrem||tc_.prem)}</span>}
                  </span>)}
                </td>
              </tr>
              {isExp && tk.topContracts.length > 0 && (
                <tr><td colSpan={7} style={{ padding:"4px 20px 8px", background:"#060e1e" }}>
                  <div style={{ fontSize:8, color:P.dm, fontWeight:700, marginBottom:4, letterSpacing:1 }}>TOP {Math.min(3,tk.topContracts.length)} CONTRACTS</div>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    {tk.topContracts.map((c,i) => {
                      const cSide = c.askPrem >= c.bidPrem ? "ask" : "bid";
                      const cC = c.cp==="C" ? (cSide==="ask"?P.bu:"#ff9800") : (cSide==="ask"?P.be:"#29b6f6");
                      return (
                        <div key={i} style={{ padding:"4px 10px", borderRadius:4, background:P.al, border:"1px solid "+P.bd, fontSize:9, cursor:"pointer" }}
                          title={c.dates && c.dates.size > 0 ? "Flow dates: " + [...c.dates].join(", ") : ""}
                          onClick={e=>{ e.stopPropagation(); setTab("Search"); setSearch(tk.sym); setSelectedTicker(D.TICKER_DB.find(t=>t.s===tk.sym)||null); setSearchDte("All"); }}>
                          <span style={{ color:cC, fontWeight:800 }}>{c.cp==="C"?"C":"P"}</span>
                          {cSide==="bid" && <span style={{ fontSize:6, color:cC, fontWeight:700, marginLeft:2 }}>BB</span>}
                          <span style={{ color:P.wh, fontWeight:700, marginLeft:4 }}>${c.K}</span>
                          <span style={{ color:P.ac, marginLeft:4 }}>{c.exp}</span>
                          <span style={{ color:(c.displayHits||c.hits)>=10?P.ac:(c.displayHits||c.hits)>=5?P.ye:P.dm, fontWeight:800, marginLeft:6 }}>{c.displayHits||c.hits}x</span>
                          <span style={{ color:premC(c.displayPrem||c.prem), fontWeight:700, marginLeft:6 }}>{fmt(c.displayPrem||c.prem)}</span>
                          {c.volOI>=3 && <span style={{ color:P.ye, marginLeft:4, fontSize:8 }}>{c.volOI.toFixed(1)}x V/OI</span>}
                        </div>
                      );
                    })}
                  </div>
                </td></tr>
              )}
              </Fragment>
            );
          };
          const sortHdr = (label, key, extraStyle) => (
            <th key={label} onClick={()=>setConvictionSort(key)} style={{
              padding:"4px 5px", textAlign:"left", color:cSort===key?"#c9a84c":P.mt, fontSize:8, fontWeight:700,
              cursor:"pointer", userSelect:"none", transition:"color 0.15s", ...extraStyle
            }}>{label}{cSort===key?" ▼":""}</th>
          );
          return (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {/* Filter rows */}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                {/* DTE */}
                {[{k:"All",l:"All",c:filtered.length},{k:"ST",l:"0–59d",c:stN},{k:"LT",l:"60–179d",c:ltN},{k:"LEAPS",l:"180+d",c:leN}].map(d=>{
                  const active=convDte===d.k;
                  return <button key={d.k} onClick={()=>setConvictionDte(d.k)} style={{ padding:"4px 10px", borderRadius:16, border:"1.5px solid "+(active?"#c9a84c":P.bd), cursor:"pointer", fontSize:9, fontWeight:700, fontFamily:"inherit", background:active?"#c9a84c22":"transparent", color:active?"#c9a84c":P.mt }}>{d.l} <span style={{ fontSize:7, opacity:0.7 }}>{d.c}</span></button>;
                })}
                <span style={{ width:1, height:16, background:P.bd }}/>
                {/* Activity */}
                {[{k:"new",l:"🆕 New"},{k:"uoa",l:"UOA"}].map(d=>{
                  const active=cAct===d.k;
                  return <button key={d.k} onClick={()=>setConvictionActivity(cAct===d.k?"All":d.k)} style={{ padding:"4px 10px", borderRadius:16, border:"1.5px solid "+(active?P.ye:P.bd), cursor:"pointer", fontSize:9, fontWeight:700, fontFamily:"inherit", background:active?P.ye+"22":"transparent", color:active?P.ye:P.mt }}>{d.l}</button>;
                })}
              </div>
              {/* Flow Pulse — bull/bear bar + narrative summary */}
              {(() => {
                if (!bulls.length && !bears.length) return null;
                const tb = bulls.slice(0, 20);
                const tbr = bears.slice(0, 20);

                // Find top contract by total premium across each side's top 20
                const findTopContract = (list) => {
                  let topC = null, topPrem = 0;
                  list.forEach(tk => {
                    const tc = tk.topContract;
                    if (!tc) return;
                    const prem = (tc.askPrem||0) + (tc.bidPrem||0);
                    if (prem > topPrem) { topPrem = prem; topC = { ...tc, sym: tk.sym, _prem: prem }; }
                  });
                  return topC;
                };
                const topBullC = findTopContract(tb);
                const topBearC = findTopContract(tbr);

                // Standouts: multi-strike institutional accumulation (4+ clean contracts), top 3
                const standouts = (list) => [...list]
                  .filter(t => (t.contractCount||0) >= 4)
                  .sort((a,b) => (b.contractCount||0) - (a.contractCount||0))
                  .slice(0, 3);

                // Small-Cap Heat: mid-small caps (<$10B) with $1M+ net premium on their side.
                // Not the same as UOA — surfaces SIZE mismatches (small names with institutional flow).
                const smallCapHeat = (list, dirField) => list.filter(t => {
                  if ((t.mktcap||0) >= 10e9) return false;
                  const np = dirField === "bull" ? (t.bull||0)-(t.bear||0) : (t.bear||0)-(t.bull||0);
                  return np >= 1e6;
                }).slice(0, 3);

                const bullStand = standouts(tb);
                const bearStand = standouts(tbr);
                const bullHeat  = smallCapHeat(tb, "bull");
                const bearHeat  = smallCapHeat(tbr, "bear");

                // Totals
                const totalBull = tb.reduce((s,t) => s + ((t.bull||0)-(t.bear||0)), 0);
                const totalBear = tbr.reduce((s,t) => s + ((t.bear||0)-(t.bull||0)), 0);
                const grandTotal = totalBull + totalBear;
                const bullPct = grandTotal > 0 ? Math.round(totalBull/grandTotal*100) : 50;
                const bearPct = 100 - bullPct;

                const fmtContract = (c) => c ? `${c.sym} ${c.CP||c.cp} $${c.K||c.k} ${c.exp||c.E}` : "";

                // Build per-side narrative parts
                const buildParts = (topC, stands, heat, color) => {
                  const parts = [];
                  if (topC) parts.push(
                    <span>led by <span style={{color, fontWeight:700}}>{fmtContract(topC)}</span>{" "}
                      <span style={{color:P.dm}}>(${(topC._prem/1e6).toFixed(1)}M)</span>
                    </span>
                  );
                  if (stands.length) parts.push(
                    <span><span style={{color:P.wh, fontWeight:600}}>Standouts:</span>{" "}
                      {stands.map((t,i) => (
                        <span key={t.sym}>
                          {i > 0 && ", "}
                          <span style={{color}}>{t.sym}</span> <span style={{color:P.dm}}>({t.contractCount})</span>
                        </span>
                      ))}
                    </span>
                  );
                  if (heat.length) parts.push(
                    <span><span style={{color:P.wh, fontWeight:600}}>Small-cap heat:</span>{" "}
                      {heat.map((t,i) => (
                        <span key={t.sym}>
                          {i > 0 && ", "}<span style={{color}}>{t.sym}</span>
                        </span>
                      ))}
                    </span>
                  );
                  return parts;
                };
                const bullParts = buildParts(topBullC, bullStand, bullHeat, P.bu);
                const bearParts = buildParts(topBearC, bearStand, bearHeat, P.be);

                return (
                  <Card>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: P.ac, letterSpacing: 1 }}>FLOW PULSE</div>
                      <div style={{ fontSize: 9, color: P.dm }}>Top {tb.length} bull · Top {tbr.length} bear</div>
                    </div>
                    {/* Bull/bear ratio bar with premiums */}
                    {grandTotal > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: P.bu, fontVariantNumeric:"tabular-nums" }}>
                            ▲ ${(totalBull/1e6).toFixed(1)}M <span style={{ fontSize:10, color:P.dm }}>({bullPct}%)</span>
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: P.be, fontVariantNumeric:"tabular-nums" }}>
                            <span style={{ fontSize:10, color:P.dm }}>({bearPct}%)</span> ${(totalBear/1e6).toFixed(1)}M ▼
                          </span>
                        </div>
                        <div style={{ height:8, background:P.bd, borderRadius:4, overflow:"hidden", display:"flex" }}>
                          <div style={{ width:`${bullPct}%`, background:P.bu }}/>
                          <div style={{ width:`${bearPct}%`, background:P.be }}/>
                        </div>
                      </div>
                    )}
                    {/* Narrative summary — bull side + bear side */}
                    <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:12, color:P.mt, lineHeight:1.55 }}>
                      {bullParts.length > 0 && (
                        <div>
                          <span style={{ color:P.bu, fontWeight:800 }}>▲ Bull</span>
                          <span style={{ color:P.dm }}>: </span>
                          {bullParts.map((p, i) => (
                            <span key={i}>{i > 0 && <span style={{color:P.dm}}>. </span>}{p}</span>
                          ))}
                          <span style={{color:P.dm}}>.</span>
                        </div>
                      )}
                      {bearParts.length > 0 && (
                        <div>
                          <span style={{ color:P.be, fontWeight:800 }}>▼ Bear</span>
                          <span style={{ color:P.dm }}>: </span>
                          {bearParts.map((p, i) => (
                            <span key={i}>{i > 0 && <span style={{color:P.dm}}>. </span>}{p}</span>
                          ))}
                          <span style={{color:P.dm}}>.</span>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })()}

                            {/* Two-column leaderboard */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Card>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:P.bu, letterSpacing:1 }}>▲ TOP BULLISH</div>
                    <span style={{ fontSize:9, color:P.dm }}>{bulls.length} tickers</span>
                  </div>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                      <th style={{ padding:"4px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600, width:80 }}>Ticker</th>
                      {sortHdr("Bull","bull")}
                      {sortHdr("Bear","bear")}
                      <th style={{ padding:"4px 5px", width:60 }}/>
                      {sortHdr("Bull%","bullpct")}
                      {sortHdr("Net","net")}
                      <th style={{ padding:"4px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>Top Contract</th>
                      
                      
                      
                      
                    </tr></thead>
                    <tbody>{bulls.slice(0,25).map((tk,i)=>renderRow(tk,i,"bull"))}</tbody>
                  </table>
                  {bulls.length>25 && <div style={{ textAlign:"center", marginTop:6 }}><button onClick={()=>{}} style={{ fontSize:9, color:P.dm, background:"transparent", border:"1px solid "+P.bd, borderRadius:4, padding:"3px 12px", cursor:"pointer", fontFamily:"inherit" }}>Show all {bulls.length}</button></div>}
                </Card>
                <Card>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:P.be, letterSpacing:1 }}>▼ TOP BEARISH</div>
                    <span style={{ fontSize:9, color:P.dm }}>{bears.length} tickers</span>
                  </div>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                      <th style={{ padding:"4px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600, width:80 }}>Ticker</th>
                      {sortHdr("Bull","bull")}
                      {sortHdr("Bear","bear")}
                      <th style={{ padding:"4px 5px", width:60 }}/>
                      {sortHdr("Bear%","bullpct")}
                      {sortHdr("Net","net")}
                      <th style={{ padding:"4px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>Top Contract</th>
                      
                      
                      
                      
                    </tr></thead>
                    <tbody>{bears.slice(0,25).map((tk,i)=>renderRow(tk,i,"bear"))}</tbody>
                  </table>
                  {bears.length>25 && <div style={{ textAlign:"center", marginTop:6 }}><button onClick={()=>{}} style={{ fontSize:9, color:P.dm, background:"transparent", border:"1px solid "+P.bd, borderRadius:4, padding:"3px 12px", cursor:"pointer", fontFamily:"inherit" }}>Show all {bears.length}</button></div>}
                </Card>
              </div>
            </div>
          );
        })()}

        {/* Top Flow — Master List */}
        {tab==="Top Flow" && (()=>{
          // 2026-07-04: honor the Stocks tab by excluding ETFs/indexes
          // (and vice versa on the Indexes tab). Matches Watchlist behavior.
          const _tabOk = (t) => {
            const isEtf = isETFSymbol(t.S, t.stocketf);
            return dataMode === "stocks" ? !isEtf : isEtf;
          };
          const tfClusters = {};
          (D.clean_confirmed||[]).forEach(t => {
            if (!_tabOk(t)) return;
            const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
            if (!tfClusters[k]) tfClusters[k] = { sym:t.S, cp:t.CP, K:t.K, exp:t.E, DTE:t.DTE, hits:0, prem:0, dir:t.D,
              hasAA:false, hasBB:false, hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true,
              mktcap:t.mktcap||0, sector:t.sector||"", prices:[], volumes:0, maxOI:0,
              bullPrem:0, bearPrem:0, askPrem:0, bidPrem:0, dominantOverride:false, er:t.er||false,
              ivs:[], spots:[], sideTimes:[], vol:0 };
            const c = tfClusters[k];
            c.hits++; c.prem += t.P; c.volumes += t.V; c.vol += t.V;
            if (t.D === "BULL") c.bullPrem += t.P;
            if (t.D === "BEAR") c.bearPrem += t.P;
            if (t.OI > c.maxOI) c.maxOI = t.OI;
            if (t.price > 0) c.prices.push(t.price);
            if (t.Si==="AA") c.hasAA = true;
            if (t.Si==="BB") c.hasBB = true;
            if (t.Si==="A"||t.Si==="AA") c.askPrem += t.P;
            if (t.Si==="B"||t.Si==="BB") c.bidPrem += t.P;
            if (t.Ty==="SWP") c.hasSweep = true;
            if (t.Ty==="BLK") c.hasBlock = true;
            if (t.Co==="YELLOW"||t.Co==="MAGENTA") c.oiExceeded = true;
            if (t.D) c.dirs.add(t.D);
            if (t.mktcap > c.mktcap) c.mktcap = t.mktcap;
            if (t.IV > 0) c.ivs.push(t.IV);
            if (t.Spot > 0) c.spots.push(t.Spot);
            c.sideTimes.push({ si:t.Si, time:t.time||"", prem:t.P });
          });
          // Build broader contract totals from D.all_trades — overlay display values
          // onto each cluster so Premium / Hits columns reflect TOTAL flow on the strike
          // (matching Search Top Trades). c.prem/c.hits stay directional for scoring.
          const tfBroader = {};
          (D.all_trades || []).forEach(t => {
            const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
            if (!tfBroader[k]) tfBroader[k] = {prem:0, hits:0};
            tfBroader[k].prem += t.P || 0;
            tfBroader[k].hits++;
          });
          Object.values(tfClusters).forEach(c => {
            const bk = c.sym+"|"+c.cp+"|"+c.K+"|"+c.exp;
            const b = tfBroader[bk];
            c.displayPrem = b ? b.prem : c.prem;
            c.displayHits = b ? b.hits : c.hits;
          });
          const allFlow = Object.values(tfClusters).filter(c=>c.dir).map(c => {
            c.clean = c.dirs.size <= 1;
            // 80% dominant direction override
            if (!c.clean) {
              const totalDir = c.bullPrem + c.bearPrem;
              if (totalDir > 0) {
                if (c.bullPrem / totalDir >= 0.8) { c.clean = true; c.dir = "BULL"; c.dominantOverride = true; }
                else if (c.bearPrem / totalDir >= 0.8) { c.clean = true; c.dir = "BEAR"; c.dominantOverride = true; }
              }
            }
            const grade = gradeCluster(c);
            const scoreMap = {"A+":600,"A":500,"B+":400,"B":300,"C":200,"D":100};
            const sp = [...c.prices].sort((a,b)=>a-b);
            const entry = sp.length>0 ? sp[Math.floor(sp.length/2)] : 0;
            const cap = capBand(c.mktcap);
            const dteBand = c.DTE < 60 ? "ST" : c.DTE < 180 ? "LT" : "LEAPS";
            // Vol/OI ratio bonus
            const volOI = c.maxOI > 0 ? c.volumes / c.maxOI : 0;
            const voiBonus = Math.min(volOI, 5) * 80;
            return { ...c, grade, entry, cap, dteBand,
              score:(scoreMap[grade]||0)+c.hits*20+c.prem/5e3+voiBonus + (c.hits<=1 && c.hasSweep && c.askPrem>c.bidPrem && c.oiExceeded && c.prem >= ((c.mktcap||0)>=500e9 ? 5e6 : 1e6) ? 250 : 0),
              side: c.askPrem >= c.bidPrem ? (c.hasAA ? "AA" : "ASK") : (c.hasBB ? "BB" : "BID"),
              patterns:detectPatterns(c) };
          }).filter(c => c.clean && c.DTE > 7);

          let filtered = allFlow;
          if (capFilter !== "All") filtered = filtered.filter(c => c.cap === capFilter);
          if (tfDteFilter !== "All") {
            if (tfDteFilter === "ST") filtered = filtered.filter(c => c.dteBand === "ST");
            else if (tfDteFilter === "LT") filtered = filtered.filter(c => c.dteBand === "LT");
            else if (tfDteFilter === "LEAPS") filtered = filtered.filter(c => c.dteBand === "LEAPS");
          }
          if (cpFilter !== "All") filtered = filtered.filter(c => c.dir===(cpFilter==="Calls"?"BULL":"BEAR"));
          const scoreRanked = filtered.sort((a,b)=>b.score-a.score).slice(0,20);
          const enriched = scoreRanked.map((r, scoreIdx) => {
            const px = getPrice(r.sym, r.cp, r.K, r.exp);
            const now = px ? (px.mark || px.last || px.mid || 0) : 0;
            const pnl = now > 0 && r.entry > 0 ? (now - r.entry) / r.entry * 100 : 0;
            const pick = topFlowPicks.active.find(p=>p.sym===r.sym&&p.cp===r.cp&&parseFloat(p.strike)===parseFloat(r.K)&&p.exp===r.exp);
            const hist = pick ? (pick.history||[]) : [];
            const allPx = [...hist.map(h=>h.price), now].filter(v=>v>0);
            const peakPrice = allPx.length>0 ? Math.max(...allPx) : 0;
            const peakPnl = peakPrice>0 && r.entry>0 ? (peakPrice-r.entry)/r.entry*100 : 0;
            const peakRetrace = peakPnl>0 && pnl<peakPnl;
            const _oiH = hist.filter(h=>(h.oi||0)>0);
            const _curOI = _oiH.length>0 ? _oiH[_oiH.length-1].oi : 0;
            const _peakOI = _oiH.length>0 ? Math.max(..._oiH.map(h=>h.oi)) : 0;
            const _isExit = _peakOI>=100 && _curOI>0 && (_peakOI-_curOI)/_peakOI*100>=30;
            return { ...r, _now: now, _pnl: pnl, _peakPnl: peakPnl, _peakRetrace: peakRetrace, _isExit, _rank: scoreIdx + 1 };
          });
          const getSortVal = (r, col) => {
            switch (col) {
              case "Ticker":  return r.sym;
              case "Exp":     return r.DTE;
              case "Strike":  return Number(r.K);
              case "C/P":     return r.cp;
              case "Side":    return ({AA:0, ASK:1, BB:2, BID:3})[r.side] ?? 9;
              case "Dir":     return r.dir;
              case "Grade":   return ({"A+":0,"A":1,"B+":2,"B":3,"C":4,"D":5})[r.grade] ?? 9;
              case "Hits":    return r.displayHits || r.hits;
              case "Premium": return r.displayPrem || r.prem;
              case "Entry":   return r.entry || 0;
              case "Now":     return r._now;
              case "P&L":     return r._pnl;
              case "Peak":    return r._peakPnl;
              case "Cap":     return ({"Mega":0,"Large":1,"Mid-Small":2})[r.cap] ?? 9;
              case "DTE":     return r.DTE;
              default:        return r.score;
            }
          };
          const ranked = tfSort.col === "score"
            ? enriched
            : [...enriched].sort((a, b) => {
                const va = getSortVal(a, tfSort.col), vb = getSortVal(b, tfSort.col);
                const cmp = typeof va === "string" ? va.localeCompare(vb) : (va - vb);
                return tfSort.dir === "asc" ? cmp : -cmp;
              });

          return (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                <div style={{ width:3, background:P.ac, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:P.ac, marginBottom:5 }}>Top Flow — Master List</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>All confirmed clean flow ranked by conviction score across all timeframes. Grade + Hits + Premium weighted. Click any row for full detail.</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <button onClick={()=>fetchPrices(ranked.map(c=>({sym:c.sym,cp:c.cp,strike:c.K,exp:c.exp})))} disabled={fetchLoading}
                    style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                      fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                    {fetchLoading?"Fetching…":"⚡ Fetch Live Prices"}
                  </button>
                  {status && <span style={{ fontSize:9, color:P.dm }}>{status}</span>}
                </div>
              </div>
            </Card>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
              <div style={{ display:"flex", gap:2, background:P.al, borderRadius:5, padding:2 }}>
                {[["All","All DTE"],["ST","0–59d"],["LT","60–179d"],["LEAPS","180+d"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setTfDteFilter(v)} style={{
                    padding:"4px 12px", borderRadius:4, border:"none", cursor:"pointer",
                    fontSize:10, fontWeight:600, fontFamily:"inherit",
                    background:tfDteFilter===v?P.cd:"transparent", color:tfDteFilter===v?P.wh:P.mt
                  }}>{label}</button>
                ))}
              </div>
              <div style={{ display:"flex", gap:2, background:P.al, borderRadius:5, padding:2 }}>
                {["All","Calls","Puts"].map(f=>(
                  <button key={f} onClick={()=>setCpFilter(f)} style={{
                    padding:"4px 12px", borderRadius:4, border:"none", cursor:"pointer",
                    fontSize:10, fontWeight:600, fontFamily:"inherit",
                    background:cpFilter===f?P.cd:"transparent", color:cpFilter===f?(f==="Calls"?P.bu:f==="Puts"?P.be:P.wh):P.mt
                  }}>{f}</button>
                ))}
              </div>
              <span style={{ fontSize:10, color:P.dm, alignSelf:"center" }}>{ranked.length} contracts</span>
            </div>
            <Card>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {["#","Ticker","Exp","Strike","C/P","Side","Dir","Grade","Hits","Premium","Entry","Now","P&L","Peak","Cap","DTE"].map(h => {
                      const isSortable = h !== "#";
                      const isActive = tfSort.col === h;
                      const onClick = isSortable ? () => setTfSort(prev =>
                        prev.col === h
                          ? { col: h, dir: prev.dir === "asc" ? "desc" : "asc" }
                          : { col: h, dir: "desc" }
                      ) : undefined;
                      return (
                        <th key={h} onClick={onClick}
                          style={{ padding:"5px 5px", textAlign:"left",
                            color: isActive ? P.ac : P.mt,
                            fontSize:9, fontWeight:600,
                            cursor: isSortable ? "pointer" : (h==="Peak" ? "help" : "default"),
                            userSelect:"none" }}
                          title={h==="Peak" ? "Highest % gain from entry at any point — the best exit you could have had." : (isSortable ? `Sort by ${h}` : undefined)}>
                          {h}{isActive ? (tfSort.dir === "asc" ? " ↑" : " ↓") : ""}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, i) => {
                    const now = r._now;
                    const pnl = r._pnl;
                    const pnlC = pnl > 0 ? P.bu : pnl < 0 ? P.be : P.dm;
                    const dirC = r.dir==="BULL" ? P.bu : P.be;
                    const dteBandC = r.dteBand==="ST"?"#ff6d00":r.dteBand==="LT"?"#6ba3be":"#c9a84c";
                    const peakPnl = r._peakPnl;
                    const peakRetrace = r._peakRetrace;
                    const _isExit = r._isExit;
                    return (
                      <tr key={i} onClick={()=>{ fetchContractHistory(r.sym,r.cp,r.K,r.exp); setSelectedItem(prev=>prev&&prev.sym===r.sym&&prev.cp===r.cp&&String(prev.K)===String(r.K)&&prev.exp===r.exp?null:{sym:r.sym,cp:r.cp,K:r.K,exp:r.exp}); }}
                        style={{ borderBottom:"1px solid "+P.bd+"10", cursor:"pointer", background:r._rank<=3?(P.ac+"06"):"transparent" }}
                        onMouseEnter={e=>e.currentTarget.style.background=P.ac+"08"}
                        onMouseLeave={e=>e.currentTarget.style.background=r._rank<=3?(P.ac+"06"):"transparent"}>
                        <td style={{ padding:"5px 5px", fontWeight:800, color:r._rank<=3?P.ac:P.dm, fontSize:12 }}>{r._rank}</td>
                        <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{r.sym}{r.er && <span style={{ fontSize:7, fontWeight:800, marginLeft:3, padding:"0px 4px", borderRadius:2, background:"#ff6d0033", color:"#ff6d00", verticalAlign:"super" }}>ER</span>}{_isExit && <span style={{ fontSize:7, fontWeight:800, marginLeft:3, padding:"0px 4px", borderRadius:2, background:"#e74c3c33", color:"#e74c3c", verticalAlign:"super" }}>EXIT</span>}{(r.patterns||[]).map((p,pi)=><span key={pi} style={{ fontSize:6, fontWeight:800, marginLeft:3, padding:"0px 4px", borderRadius:2, verticalAlign:"super", background:p.type==="IV_SURGE"?"#c9a84c22":p.type==="SIDE_FLIP"?"#ff980022":p.type==="HEAVY"?"#3cb86822":"#29b6f622", color:p.type==="IV_SURGE"?"#c9a84c":p.type==="SIDE_FLIP"?"#ff9800":p.type==="HEAVY"?"#3cb868":"#29b6f6" }}>{p.type==="IV_SURGE"?"IV↑":p.type==="SIDE_FLIP"?"FLIP":p.type==="HEAVY"?"HEAVY":"PX↑"}</span>)}</td>
                        <td style={{ padding:"5px 5px", fontWeight:700, color:P.wh }}>{r.exp}</td>
                        <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>${r.K}</td>
                        <td style={{ padding:"5px 5px" }}><Tag c={r.cp==="C"?P.bu:P.be}>{r.cp}</Tag></td>
                        <td style={{ padding:"5px 5px" }}>{r.side==="AA"?<Tag c={P.ac}>AA</Tag>:r.side==="BB"?<Tag c={P.be}>BB</Tag>:<Tag c={P.mt}>ASK</Tag>}</td>
                        <td style={{ padding:"5px 5px" }}><Tag c={dirC}>{r.dir}</Tag></td>
                        <td style={{ padding:"5px 5px" }}><Tag c={GRADE_COLORS[r.grade]||P.mt}>{r.grade}</Tag></td>
                        <td style={{ padding:"5px 5px" }}><span style={{ fontWeight:800, fontSize:13, color:(r.displayHits||r.hits)>=10?P.ac:(r.displayHits||r.hits)>=5?P.ye:P.dm }}>{r.displayHits||r.hits}x</span></td>
                        <td style={{ padding:"5px 5px", fontWeight:700, color:premC(r.displayPrem||r.prem) }}>{fmt(r.displayPrem||r.prem)}</td>
                        <td style={{ padding:"5px 5px", fontWeight:700, color:P.ac }}>{r.entry>0?"$"+r.entry.toFixed(2):"—"}</td>
                        <td style={{ padding:"5px 5px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>
                        <td style={{ padding:"5px 5px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>
                        <td style={{ padding:"5px 5px", fontWeight:700, color:peakPnl>0?(peakRetrace?"#FFB300":P.bu):P.dm, fontSize:peakRetrace?9:10 }}>{peakPnl>0?"↑"+(peakPnl>=0?"+":"")+peakPnl.toFixed(1)+"%":"—"}</td>
                        <td style={{ padding:"5px 5px" }}><span style={{ fontSize:8, color:P.dm, fontWeight:600 }}>{r.cap}</span></td>
                        <td style={{ padding:"5px 5px" }}><span style={{ fontSize:8, fontWeight:700, color:dteBandC, background:dteBandC+"15", padding:"1px 5px", borderRadius:3 }}>{r.dteBand} {r.DTE}d</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
          </div>
          );
        })()}

        {/* Leaders */}
        {tab==="Leaders" && FD && (()=>{
          const fmt = (n) => { const a=Math.abs(n); return a>=1e6?"$"+(a/1e6).toFixed(1)+"M":a>=1e3?"$"+(a/1e3).toFixed(0)+"K":"$"+a.toFixed(0); };
          // Build leader flow data from clean_confirmed (same source as Alpha tab)
          const cc = capFilter==="All" ? (D.clean_confirmed||[]) : (D.clean_confirmed||[]).filter(t => capBand(t.mktcap)===capFilter);
          // Recency weighting: recent flow counts more for trend detection
          const allDatesL = [...new Set(cc.map(t=>t.Dt).filter(Boolean))].sort((a,b)=>{
            const pa=a.split("/").map(Number), pb=b.split("/").map(Number);
            const ya=pa.length>=3?(pa[2]<100?pa[2]+2000:pa[2]):2026, yb=pb.length>=3?(pb[2]<100?pb[2]+2000:pb[2]):2026;
            return new Date(ya,pa[0]-1,pa[1]||1) - new Date(yb,pb[0]-1,pb[1]||1);
          });
          const last2d = new Set(allDatesL.slice(-2));
          const last5d = new Set(allDatesL.slice(-5));
          const last10d = new Set(allDatesL.slice(-10));
          const recW = (dt) => last2d.has(dt)?2.0:last5d.has(dt)?1.5:last10d.has(dt)?1.2:1.0;
          const ccByTicker = {};
          cc.forEach(t => {
            if (!ccByTicker[t.S]) ccByTicker[t.S] = { bull:0, bear:0, wBull:0, wBear:0, n:0, er:false, r5Bull:0, r5Bear:0 };
            const w = recW(t.Dt);
            if (t.D==="BULL") { ccByTicker[t.S].bull += t.P; ccByTicker[t.S].wBull += t.P * w; }
            if (t.D==="BEAR") { ccByTicker[t.S].bear += t.P; ccByTicker[t.S].wBear += t.P * w; }
            ccByTicker[t.S].n++;
            if (t.er) ccByTicker[t.S].er = true;
            if (last5d.has(t.Dt)) { if (t.D==="BULL") ccByTicker[t.S].r5Bull += t.P; if (t.D==="BEAR") ccByTicker[t.S].r5Bear += t.P; }
          });
          const leaderData = leaders.map(sym => {
            const agg = ccByTicker[sym];
            if (!agg || (agg.bull + agg.bear) <= 0) {
              // Fall back to TICKER_DB for top contract display even if no clean flow
              const tk = FD.TICKER_DB.find(t=>t.s===sym);
              const topC = tk ? ((tk.c||[]).length>0 ? tk.c[0] : (tk.t||[]).length>0 ? tk.t[0] : null) : null;
              return { sym, found:!!tk, bull:0, bear:0, net:0, trades:0, cap:tk?capBand(tk.mktcap):"", er:agg?.er||tk?.er||false,
                topContract:topC ? { cp:topC.CP||topC.cp, K:topC.K||topC.strike, exp:topC.E||topC.exp,
                  hits:topC.H||topC.hits||1, prem:topC.P||topC.prem||0 } : null };
            }
            const bull = agg.bull, bear = agg.bear, net = bull - bear;
            const wNet = agg.wBull - agg.wBear;
            // Trend: last 5 days bull% vs overall bull% (positive = getting more bullish, negative = getting more bearish)
            const overallBullPct = (bull+bear)>0 ? bull/(bull+bear) : 0.5;
            const r5Total = agg.r5Bull + agg.r5Bear;
            const r5BullPct = r5Total > 0 ? agg.r5Bull / r5Total : 0.5;
            const trend = Math.round((r5BullPct - overallBullPct) * 100);
            const tk = FD.TICKER_DB.find(t=>t.s===sym);
            const topC = tk ? ((tk.c||[]).length>0 ? tk.c[0] : (tk.t||[]).length>0 ? tk.t[0] : null) : null;
            return { sym, found:true, bull, bear, net, wNet, trades:agg.n, cap:tk?capBand(tk.mktcap):"", er:agg.er, trend,
              topContract:topC ? { cp:topC.CP||topC.cp, K:topC.K||topC.strike, exp:topC.E||topC.exp,
                hits:topC.H||topC.hits||1, prem:topC.P||topC.prem||0 } : null };
          }).sort((a,b) => {
            const {col, dir} = leaderSort;
            const m = dir === "asc" ? 1 : -1;
            if (col === "sym") return m * a.sym.localeCompare(b.sym);
            if (col === "bull") return m * (a.bull - b.bull);
            if (col === "bear") return m * (a.bear - b.bear);
            if (col === "net") return m * (a.net - b.net);
            if (col === "ytd") return m * ((parseFloat(leaderYtd[a.sym])||0) - (parseFloat(leaderYtd[b.sym])||0));
            if (col === "off52") return m * ((parseFloat(leaderOff52[a.sym])||0) - (parseFloat(leaderOff52[b.sym])||0));
            if (col === "trend") return m * ((a.trend||0) - (b.trend||0));
            if (col === "oi") return m * ((leaderOI[a.sym]?.net||0) - (leaderOI[b.sym]?.net||0));
            return 0;
          });
          const totalBull = leaderData.reduce((a,d)=>a+d.bull,0);
          const totalBear = leaderData.reduce((a,d)=>a+d.bear,0);
          const bullPct = (totalBull+totalBear)>0 ? Math.round(totalBull/(totalBull+totalBear)*100) : 50;
          return (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:3, height:28, background:P.ac, borderRadius:2 }}/>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:P.ac }}>Market Leaders</div>
                    <div style={{ fontSize:10, color:P.dm }}>Track institutional flow on the names driving this market. {leaders.length} leaders tracked.</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <button onClick={fetchLeaderYtd} disabled={leaderYtdLoading}
                    style={{ padding:"5px 12px", borderRadius:4, border:"1px solid "+P.bl, background:"transparent", color:leaderYtdLoading?P.dm:P.mt, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:leaderYtdLoading?"wait":"pointer" }}>
                    {leaderYtdLoading?"Loading…":"📈 Fetch Data"}
                  </button>
                  <button onClick={autoPopulateLeaders}
                    style={{ padding:"5px 12px", borderRadius:4, border:"1px solid #6ba3be55", background:"#6ba3be11", color:"#6ba3be", fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                    ⚡ Auto-Fill Top 25{capFilter !== "All" ? " ("+capFilter+")" : ""}
                  </button>
                </div>
              </div>
            </Card>
            {/* Summary bar */}
            {leaders.length > 0 && (
            <Card>
              <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:8 }}>
                <div>
                  <span style={{ fontSize:10, color:P.dm }}>Leaders Net Flow</span>
                  <div style={{ fontSize:18, fontWeight:900, color:totalBull>=totalBear?P.bu:P.be }}>{fmt(Math.abs(totalBull-totalBear))}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:P.dm, marginBottom:2 }}>
                    <span style={{ color:P.bu }}>Bull {fmt(totalBull)}</span>
                    <span style={{ fontSize:16, fontWeight:800, color:bullPct>=50?P.bu:P.be }}>{bullPct}%</span>
                    <span style={{ color:P.be }}>Bear {fmt(totalBear)}</span>
                  </div>
                  <div style={{ width:"100%", height:6, background:P.be, borderRadius:3 }}>
                    <div style={{ width:bullPct+"%", height:"100%", background:P.bu, borderRadius:3 }}/>
                  </div>
                </div>
              </div>
            </Card>
            )}
            {/* Leader rows */}
            {leaders.length > 0 ? (
            <Card>
              <div>
                {(()=>{
                const sortHdrL = (label, col, align) => {
                  const active = leaderSort.col === col;
                  const arrow = active ? (leaderSort.dir === "asc" ? " ▲" : " ▼") : "";
                  return <th style={{ padding:"5px 14px", textAlign:align||"center", color:active?P.ac:P.mt, fontSize:9, fontWeight:600, cursor:"pointer", userSelect:"none" }}
                    onClick={()=>setLeaderSort(prev=>({col, dir:prev.col===col&&prev.dir==="asc"?"desc":"asc"}))}>{label}{arrow}</th>;
                };
                return (
                <table style={{ borderCollapse:"collapse", fontSize:12, margin:"0 auto", width:"85%" }}>
                  <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {sortHdrL("Ticker","sym","left")}
                    {sortHdrL("Bull","bull")}
                    {sortHdrL("Bear","bear")}
                    <th style={{ padding:"4px 12px", width:100, textAlign:"center", color:P.mt, fontSize:9, fontWeight:600 }}>Split</th>
                    {sortHdrL("Net","net")}
                    {sortHdrL("YTD%","ytd")}
                    {sortHdrL("Off High","off52")}
                    {sortHdrL("Trend","trend")}
                    {sortHdrL("ΔOI","oi")}
                    <th style={{ padding:"5px 14px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>Top Contract</th>
                  </tr></thead>
                  <tbody>
                  {leaderData.map((d,i) => {
                    const isBull = d.net >= 0;
                    const total = d.bull + d.bear;
                    const bPct = total > 0 ? Math.round(d.bull / total * 100) : 50;
                    const cap = d.cap && d.cap !== "Unknown" ? d.cap : "";
                    return (
                      <tr key={d.sym} style={{ borderBottom:"1px solid "+P.bd+"15", cursor:"pointer" }}
                        onClick={()=>{ setSearch(d.sym); setSelectedTicker(FD.TICKER_DB.find(t=>t.s===d.sym)||null); setTab("Search"); }}>
                        <td style={{ padding:"8px 14px", fontWeight:900, color:P.wh, fontSize:13 }}>
                          {d.sym}
                          
                          {d.er && <span style={{ fontSize:6, fontWeight:800, marginLeft:3, padding:"1px 4px", borderRadius:2, background:"#ff980022", color:"#ff9800" }}>ER</span>}
                        </td>
                        <td style={{ padding:"8px 14px", fontWeight:800, color:P.bu, textAlign:"center" }}>{d.found&&d.bull>0?fmt(d.bull):"—"}</td>
                        <td style={{ padding:"8px 14px", fontWeight:800, color:P.be, textAlign:"center" }}>{d.found&&d.bear>0?fmt(d.bear):"—"}</td>
                        <td style={{ padding:"8px 12px", width:100 }}>
                          <div style={{ display:"flex", height:4, borderRadius:2, overflow:"hidden", background:P.bd }}>
                            <div style={{ width:bPct+"%", background:total>0?P.bu:"transparent" }}/><div style={{ width:(100-bPct)+"%", background:total>0?P.be:"transparent" }}/>
                          </div>
                        </td>
                        <td style={{ padding:"8px 14px", fontWeight:900, color:isBull?P.bu:P.be, fontSize:13, textAlign:"center" }}>{d.found&&total>0?fmt(Math.abs(d.net)):"—"}</td>
                        <td style={{ padding:"8px 14px", fontSize:11, fontWeight:700, textAlign:"center", color:leaderYtd[d.sym]?(parseFloat(leaderYtd[d.sym])>=0?P.bu:P.be):P.dm }}>{leaderYtd[d.sym]?leaderYtd[d.sym]+"%":"—"}</td>
                        <td style={{ padding:"8px 14px", fontSize:11, fontWeight:700, textAlign:"center", color:leaderOff52[d.sym]?(parseFloat(leaderOff52[d.sym])>=(-5)?P.bu:parseFloat(leaderOff52[d.sym])>=(-15)?P.ye:P.be):P.dm }}>{leaderOff52[d.sym]?leaderOff52[d.sym]+"%":"—"}</td>
                        <td style={{ padding:"8px 14px", fontSize:11, fontWeight:700, textAlign:"center", color:d.trend>5?P.bu:d.trend<(-5)?P.be:P.dm }}>{d.trend!==0&&d.found?(d.trend>0?"↑":"↓")+Math.abs(d.trend)+"%":"—"}</td>
                        <td style={{ padding:"8px 14px", fontSize:10, fontWeight:700, textAlign:"center", color:leaderOI[d.sym]?(leaderOI[d.sym].net>0?P.bu:leaderOI[d.sym].net<0?P.be:P.dm):P.dm }}>{leaderOI[d.sym]?(leaderOI[d.sym].net>0?"+":"")+leaderOI[d.sym].net.toLocaleString():"—"}</td>
                        <td style={{ padding:"8px 14px", fontSize:10 }}>
                          {d.topContract ? (
                            <span>
                              <span style={{ color:d.topContract.cp==="C"?P.bu:P.be, fontWeight:800 }}>{d.topContract.cp}</span>
                              <span style={{ color:P.wh, fontWeight:700, marginLeft:3 }}>${d.topContract.K}</span>
                              <span style={{ color:P.ac, marginLeft:3 }}>{d.topContract.exp}</span>
                              {d.topContract.hits>1 && <span style={{ color:d.topContract.hits>=10?P.ac:P.dm, fontWeight:800, marginLeft:4 }}>{d.topContract.hits}x</span>}
                              <span style={{ color:P.ac, marginLeft:3 }}>{fmt(d.topContract.prem)}</span>
                            </span>
                          ) : <span style={{ color:P.mt }}>no flow</span>}
                        </td>

                      </tr>
                    );
                  })}
                  </tbody>
                </table>
                ); })()}
              </div>
            </Card>
            ) : (
              <Card><div style={{ textAlign:"center", padding:24, color:P.dm, fontSize:11 }}>
                Click "⚡ Auto-Fill Top 25" to populate leaders from flow data.
              </div></Card>
            )}
          </div>
          );
        })()}

        {/* Search */}
        {tab==="Search" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ position:"relative" }}>
              <input type="text" value={search}
                onChange={e=>{ const v=e.target.value.toUpperCase(); setSearch(v); setSelectedTicker(D.TICKER_DB.find(t=>t.s===v)||null); setSearchDte("All"); setSearchGroup(null); }}
                placeholder="Search ticker, theme, or sector..."
                style={{ width:"100%", padding:"10px 40px 10px 16px", borderRadius:8, fontSize:13, fontWeight:600, background:P.al, border:"1px solid "+P.bl, color:P.wh, fontFamily:"inherit", outline:"none", letterSpacing:1 }}
              />
              <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", zIndex:10 }}>
                <div style={{ position:"relative", display:"inline-block" }}
                  onMouseEnter={e=>e.currentTarget.querySelector('[data-tip]').style.display='block'}
                  onMouseLeave={e=>e.currentTarget.querySelector('[data-tip]').style.display='none'}>
                  <span style={{ fontSize:14, color:P.dm, cursor:"help", userSelect:"none" }}>ⓘ</span>
                  <div data-tip="1" style={{ display:"none", position:"absolute", right:0, top:"100%", marginTop:8, width:320, background:P.cd, border:"1px solid "+P.bl, borderRadius:8, padding:12, zIndex:30, boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}>
                    <div style={{ fontSize:9, fontWeight:800, color:P.ac, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Available Themes</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:10 }}>
                      {Object.keys(THEMES_DEF).map(t=>(
                        <button key={t} onClick={()=>{ setSearch(t); setSelectedTicker(null); setSearchGroup({type:"theme",name:t,tickers:THEMES_DEF[t]}); }}
                          style={{ padding:"3px 8px", borderRadius:4, border:"1px solid "+P.bl, background:P.al, color:P.wh, fontSize:9, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                          {t} <span style={{ color:P.dm, fontSize:7 }}>{THEMES_DEF[t].length}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:9, fontWeight:800, color:"#6ba3be", textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>Sectors</div>
                    <div style={{ fontSize:8, color:P.dm, lineHeight:1.6 }}>
                      Also searchable: Information Technology, Financials, Energy, Consumer Discretionary, Healthcare, Industrials, and more from the flow data.
                    </div>
                  </div>
                </div>
              </div>
              {search && search.length >= 1 && !selectedTicker && !searchGroup && (()=>{
                const q = search.toLowerCase();
                // Uppercased query for ticker matching — D.ALL_SYMS stores
                // tickers in canonical upper case ("BE", "AAPL"). Before this
                // fix the filter used raw `search`, so typing "be" (lower
                // case — the natural way most people type) failed to match
                // "BE" via startsWith and the ticker was silently absent
                // from suggestions. Theme/sector matchers below correctly
                // used `q` (lower) against lower-cased haystacks; ticker
                // path was the odd one out.
                const qUpper = search.toUpperCase();
                // Match tickers
                const tickerMatches = D.ALL_SYMS.filter(s=>s.startsWith(qUpper)).slice(0,8);
                // Match themes
                const themeMatches = Object.keys(THEMES_DEF).filter(t=>t.toLowerCase().includes(q)).slice(0,4);
                // Match sectors (unique from TICKER_DB)
                const allSectors = [...new Set(D.TICKER_DB.map(t=>t.sector).filter(s=>s&&s!=="None"&&s!=="Unknown"))];
                const sectorMatches = allSectors.filter(s=>s.toLowerCase().includes(q)).slice(0,4);
                const hasResults = tickerMatches.length > 0 || themeMatches.length > 0 || sectorMatches.length > 0;
                if (!hasResults) return null;
                return (
                  <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:20, background:P.cd, border:"1px solid "+P.bl, borderRadius:8, marginTop:4, padding:8, maxHeight:300, overflowY:"auto" }}>
                    {tickerMatches.length > 0 && (<>
                      <div style={{ fontSize:8, fontWeight:700, color:P.dm, textTransform:"uppercase", letterSpacing:1, padding:"4px 6px" }}>Tickers</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8 }}>
                        {tickerMatches.map(s=>(
                          <button key={s} onClick={()=>{ setSearch(s); setSelectedTicker(D.TICKER_DB.find(t=>t.s===s)||null); setSearchGroup(null); }}
                            style={{ padding:"4px 10px", borderRadius:4, border:"1px solid "+P.bl, background:P.al, color:D.TICKER_DB.find(t=>t.s===s)?P.wh:P.mt, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </>)}
                    {themeMatches.length > 0 && (<>
                      <div style={{ fontSize:8, fontWeight:700, color:P.dm, textTransform:"uppercase", letterSpacing:1, padding:"4px 6px" }}>Themes</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:8 }}>
                        {themeMatches.map(t=>(
                          <button key={t} onClick={()=>{ setSearch(t); setSelectedTicker(null); setSearchGroup({type:"theme",name:t,tickers:THEMES_DEF[t]}); }}
                            style={{ padding:"6px 10px", borderRadius:4, border:"none", background:P.al, color:P.ac, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", textAlign:"left" }}>
                            📁 {t} <span style={{ color:P.dm, fontWeight:400, fontSize:9 }}>({THEMES_DEF[t].length} tickers)</span>
                          </button>
                        ))}
                      </div>
                    </>)}
                    {sectorMatches.length > 0 && (<>
                      <div style={{ fontSize:8, fontWeight:700, color:P.dm, textTransform:"uppercase", letterSpacing:1, padding:"4px 6px" }}>Sectors</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                        {sectorMatches.map(s=>{
                          const sectorTickers = D.TICKER_DB.filter(t=>t.sector===s).map(t=>t.s);
                          return (
                            <button key={s} onClick={()=>{ setSearch(s); setSelectedTicker(null); setSearchGroup({type:"sector",name:s,tickers:sectorTickers}); }}
                              style={{ padding:"6px 10px", borderRadius:4, border:"none", background:P.al, color:"#6ba3be", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", textAlign:"left" }}>
                              🏢 {s} <span style={{ color:P.dm, fontWeight:400, fontSize:9 }}>({sectorTickers.length} tickers)</span>
                            </button>
                          );
                        })}
                      </div>
                    </>)}
                  </div>
                );
              })()}
              </div>
            </Card>
            {/* Theme/Sector Group View */}
            {searchGroup && D && (()=>{
              const cc = capFilter==="All" ? (D.clean_confirmed||[]) : (D.clean_confirmed||[]).filter(t => capBand(t.mktcap)===capFilter);
              const groupTickers = new Set(searchGroup.tickers);
              const groupTrades = cc.filter(t => groupTickers.has(t.S));
              const tkMap = {};
              groupTrades.forEach(t => {
                if (!tkMap[t.S]) tkMap[t.S] = { sym:t.S, bull:0, bear:0, n:0, er:false, contracts:{} };
                if (t.D==="BULL") tkMap[t.S].bull += t.P;
                if (t.D==="BEAR") tkMap[t.S].bear += t.P;
                tkMap[t.S].n++;
                if (t.er) tkMap[t.S].er = true;
                const ck=t.CP+"|"+t.K+"|"+t.E;
                if(!tkMap[t.S].contracts[ck]) tkMap[t.S].contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,askPrem:0,bidPrem:0,DTE:t.DTE};
                const c=tkMap[t.S].contracts[ck]; c.hits++; c.prem+=t.P;
                if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
              });
              Object.values(tkMap).forEach(tk=>{
                const sorted=Object.values(tk.contracts).sort((a,b)=>b.prem-a.prem);
                tk.topContract=sorted[0]||null;
                tk.dir=tk.bull>=tk.bear?"BULL":"BEAR";
              });
              const rows = Object.values(tkMap).filter(t=>t.bull+t.bear>0);
              const totalBull = rows.reduce((a,t)=>a+t.bull,0);
              const totalBear = rows.reduce((a,t)=>a+t.bear,0);
              const totalNet = totalBull - totalBear;
              const bullPct = (totalBull+totalBear)>0 ? Math.round(totalBull/(totalBull+totalBear)*100) : 50;
              const fmt = (n) => { const a=Math.abs(n); return a>=1e6?"$"+(a/1e6).toFixed(1)+"M":a>=1e3?"$"+(a/1e3).toFixed(0)+"K":"$"+a.toFixed(0); };
              const isBullGroup = totalBull >= totalBear;
              return (<>
                <Card>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div>
                      <span style={{ fontSize:10, fontWeight:800, color:searchGroup.type==="theme"?P.ac:"#6ba3be", textTransform:"uppercase", letterSpacing:1 }}>
                        {searchGroup.type==="theme"?"📁":"🏢"} {searchGroup.name}
                      </span>
                      <span style={{ fontSize:9, color:P.dm, marginLeft:8 }}>{rows.length} tickers with flow · {searchGroup.tickers.length} in group</span>
                    </div>
                    <button onClick={()=>{ setSearchGroup(null); setSearch(""); }}
                      style={{ background:"none", border:"1px solid "+P.bl, borderRadius:4, color:P.dm, fontSize:9, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit" }}>✕ Clear</button>
                  </div>
                  {/* Summary bar */}
                  <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:12 }}>
                    <div>
                      <div style={{ fontSize:8, color:P.dm, fontWeight:600 }}>Group Net Flow</div>
                      <div style={{ fontSize:16, fontWeight:900, color:isBullGroup?P.bu:P.be }}>{fmt(Math.abs(totalNet))}</div>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:P.dm, marginBottom:2 }}>
                        <span style={{ color:P.bu }}>Bull {fmt(totalBull)}</span>
                        <span style={{ color:P.bu, fontSize:12, fontWeight:800 }}>{bullPct}%</span>
                        <span style={{ color:P.be }}>Bear {fmt(totalBear)}</span>
                      </div>
                      <div style={{ height:6, borderRadius:3, background:P.be, overflow:"hidden" }}>
                        <div style={{ width:bullPct+"%", height:"100%", borderRadius:3, background:P.bu }} />
                      </div>
                    </div>
                  </div>
                  {/* Ticker table */}
                  {(()=>{
                    const [gsCol, gsDir] = (searchGroup._sort||"net|desc").split("|");
                    const setGS = (col) => { const nd = gsCol===col&&gsDir==="desc"?"asc":"desc"; setSearchGroup({...searchGroup, _sort:col+"|"+nd}); };
                    const gsHdr = (label, col, align) => {
                      const active = gsCol===col;
                      const arrow = active ? (gsDir==="asc"?" ▲":" ▼") : "";
                      return <th style={{ padding:"4px 8px", textAlign:align||"center", color:active?P.ac:P.mt, fontSize:8, fontWeight:600, cursor:"pointer", userSelect:"none" }}
                        onClick={()=>setGS(col)}>{label}{arrow}</th>;
                    };
                    const m = gsDir==="asc"?1:-1;
                    const sorted = [...rows].sort((a,b)=>{
                      if (gsCol==="sym") return m*a.sym.localeCompare(b.sym);
                      if (gsCol==="bull") return m*(a.bull-b.bull);
                      if (gsCol==="bear") return m*(a.bear-b.bear);
                      if (gsCol==="net") return m*((a.bull-a.bear)-(b.bull-b.bear));
                      return 0;
                    });
                    return (
                  <table style={{ width:"90%", margin:"0 auto", borderCollapse:"collapse", fontSize:11, tableLayout:"fixed" }}>
                    <colgroup>
                      <col style={{ width:"11%" }}/><col style={{ width:"8%" }}/><col style={{ width:"13%" }}/><col style={{ width:"13%" }}/>
                      <col style={{ width:"11%" }}/><col style={{ width:"15%" }}/><col style={{ width:"29%" }}/>
                    </colgroup>
                    <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                      {gsHdr("Ticker","sym","center")}
                      <th style={{ padding:"4px 5px", textAlign:"center", color:P.mt, fontSize:8, fontWeight:600 }}>Bet</th>
                      {gsHdr("Bull","bull")}
                      {gsHdr("Bear","bear")}
                      <th style={{ padding:"4px 5px", textAlign:"center", color:P.mt, fontSize:8, fontWeight:600 }}>Split</th>
                      {gsHdr("Net","net")}
                      <th style={{ padding:"4px 5px", textAlign:"center", color:P.mt, fontSize:8, fontWeight:600 }}>Top Contract</th>
                    </tr></thead>
                    <tbody>
                    {sorted.map((r,i) => {
                      const total = r.bull+r.bear;
                      const bPct = total>0?Math.round(r.bull/total*100):50;
                      const net = r.bull - r.bear;
                      const dirC = r.dir==="BULL"?P.bu:P.be;
                      const tc = r.topContract;
                      const tcSide = tc?(tc.askPrem>=tc.bidPrem?"ask":"bid"):"ask";
                      let tcC = P.dm;
                      if(tc){ if(tc.cp==="C") tcC=tcSide==="ask"?P.bu:"#ff9800"; else tcC=tcSide==="ask"?P.be:"#29b6f6"; }
                      return (
                        <tr key={r.sym} style={{ borderBottom:"1px solid "+P.bd+"44", cursor:"pointer" }}
                          onClick={()=>{ setSearch(r.sym); setSelectedTicker(D.TICKER_DB.find(t=>t.s===r.sym)||null); setSearchGroup(null); }}>
                          <td style={{ padding:"6px 5px", textAlign:"center" }}>
                            <span style={{ fontWeight:900, color:P.wh, fontSize:12 }}>{r.sym}</span>
                            {r.er && <span style={{ fontSize:6, fontWeight:800, marginLeft:3, padding:"1px 4px", borderRadius:2, background:"#ff980022", color:"#ff9800" }}>ER</span>}
                          </td>
                          <td style={{ padding:"6px 5px", textAlign:"center" }}><Tag c={dirC}>{r.dir}</Tag></td>
                          <td style={{ padding:"6px 5px", fontWeight:800, color:P.bu, textAlign:"center" }}>{r.bull>0?fmt(r.bull):"—"}</td>
                          <td style={{ padding:"6px 5px", fontWeight:800, color:P.be, textAlign:"center" }}>{r.bear>0?fmt(r.bear):"—"}</td>
                          <td style={{ padding:"6px 5px" }}>
                            <div style={{ display:"flex", height:6, borderRadius:3, overflow:"hidden", background:P.be }}>
                              <div style={{ width:bPct+"%", background:P.bu, borderRadius:3 }} />
                            </div>
                          </td>
                          <td style={{ padding:"6px 5px", fontWeight:900, color:dirC, textAlign:"center" }}>{fmt(Math.abs(net))}</td>
                          <td style={{ padding:"6px 5px", fontSize:9, textAlign:"center" }}>
                            {tc && (<span>
                              <span style={{ color:tcC, fontWeight:800 }}>{tc.cp==="C"?"C":"P"}</span>
                              {tcSide==="bid" && <span style={{ fontSize:7, color:tcC, fontWeight:800, marginLeft:2, padding:"1px 4px", borderRadius:3, background:tcC+"22", border:"1px solid "+tcC+"44" }}>BB</span>}
                              <span style={{ color:P.wh, fontWeight:700, marginLeft:3 }}>${tc.K}</span>
                              <span style={{ color:P.ac, marginLeft:3 }}>{tc.exp}</span>
                              <span style={{ color:tc.hits>=10?P.ac:tc.hits>=5?P.ye:P.dm, fontWeight:800, marginLeft:4 }}>{tc.hits}x</span>
                              {tc.prem>=1e6 && <span style={{ color:P.ye, marginLeft:3, fontSize:8 }}>{fmt(tc.prem)}</span>}
                            </span>)}
                          </td>
                        </tr>
                      );
                    })}
                    </tbody>
                  </table>
                    ); })()}
                </Card>
              </>);
            })()}
            {/* Batch Search */}
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button onClick={()=>setBatchMode(!batchMode)} style={{ padding:"5px 14px", borderRadius:16, border:"1.5px solid "+(batchMode?"#c9a84c":"#c9a84c55"), cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", background:batchMode?"#c9a84c22":"transparent", color:batchMode?"#c9a84c":"#c9a84c" }}>
                📋 Batch Search
              </button>
              {batchMode && <span style={{ fontSize:9, color:P.dm }}>Paste tickers or upload a CSV watchlist to scan flow</span>}
            </div>
            {batchMode && (
              <Card>
                <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                  <textarea value={batchTickers} onChange={e=>setBatchTickers(e.target.value.toUpperCase())}
                    placeholder="Paste tickers: AAPL, TSLA, NVDA, META..."
                    rows={2}
                    style={{ flex:1, padding:"8px 12px", borderRadius:6, fontSize:11, fontWeight:600, background:P.al, border:"1px solid "+P.bl, color:P.wh, fontFamily:"inherit", outline:"none", resize:"vertical" }}
                  />
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    <button onClick={()=>{
                      const tickers = batchTickers.split(/[,\s\n]+/).map(s=>s.trim()).filter(Boolean);
                      if (!tickers.length || !D.all_directional) return;
                      const cc = capFilter==="All" ? D.all_directional : (D.all_directional||[]).filter(t=>capBand(t.mktcap)===capFilter);
                      const results = tickers.map(sym => {
                        const trades = cc.filter(t=>t.S===sym);
                        if (!trades.length) return { sym, found:false };
                        let bull=0,bear=0,n=0,contracts={},hasSwp=false,hasBlk=false;
                        trades.forEach(t => {
                          if(t.D==="BULL") bull+=t.P; if(t.D==="BEAR") bear+=t.P; n++;
                          if(t.Ty==="SWP") hasSwp=true; if(t.Ty==="BLK") hasBlk=true;
                          const ck=t.CP+"|"+t.K+"|"+t.E;
                          if(!contracts[ck]) contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,DTE:t.DTE,askPrem:0,bidPrem:0,prices:[]};
                          const c=contracts[ck]; c.hits++; c.prem+=t.P;
                          if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
                          if(t.price>0) c.prices.push(t.price);
                        });
                        const total=bull+bear; const bullPct=total>0?Math.round(bull/total*100):50;
                        const sorted=Object.values(contracts).sort((a,b)=>b.prem-a.prem);
                        sorted.forEach(c=>{ c.entry = c.prices.length>0 ? c.prices.sort((a,b)=>a-b)[Math.floor(c.prices.length/2)] : 0; });
                        const top=sorted[0]||null;
                        return { sym, found:true, bull, bear, n, bullPct, dir:bull>=bear?"BULL":"BEAR", net:bull-bear, topContract:top, contractCount:sorted.length, hasSwp, hasBlk, mktcap:trades[0]?.mktcap||0 };
                      });
                      setBatchResults(results);
                    }} style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", background:P.ac, color:P.bg }}>
                      Scan Flow
                    </button>
                    <label style={{ padding:"6px 12px", borderRadius:6, border:"1px solid "+P.bd, cursor:"pointer", fontSize:9, fontWeight:700, fontFamily:"inherit", background:"transparent", color:P.mt, textAlign:"center" }}>
                      Upload CSV
                      <input type="file" accept=".csv,.txt" style={{ display:"none" }} onChange={e=>{
                        const file = e.target.files[0]; if(!file) return;
                        const reader = new FileReader();
                        reader.onload = ev => {
                          const text = ev.target.result;
                          const lines = text.split("\n").filter(l=>l.trim());
                          if(!lines.length) return;
                          const headers = lines[0].split(",").map(h=>h.trim().toLowerCase());
                          const tickerCol = headers.findIndex(h=>["symbol","ticker","sym","stock","name"].includes(h));
                          if(tickerCol===-1){ setBatchTickers(lines.slice(1).map(l=>l.split(",")[0].trim().toUpperCase().replace(/"/g,"")).filter(Boolean).join(", ")); return; }
                          const tickers = lines.slice(1).map(l=>{
                            const cols=l.split(","); return (cols[tickerCol]||"").trim().toUpperCase().replace(/"/g,"");
                          }).filter(Boolean);
                          setBatchTickers([...new Set(tickers)].join(", "));
                        };
                        reader.readAsText(file);
                        e.target.value = "";
                      }}/>
                    </label>
                  </div>
                </div>
                {batchResults && (
                  <div style={{ marginTop:10 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:P.ac, marginBottom:6 }}>
                      {batchResults.filter(r=>r.found).length} of {batchResults.length} tickers found in flow data
                    </div>
                    {(()=>{
                      const found = batchResults.filter(r=>r.found && r.net !== 0);
                      if (found.length < 2) return null;
                      const scored = found.map(r => {
                        let sc = 0;
                        const convPct = r.dir==="BULL" ? r.bullPct : (100-r.bullPct);
                        sc += convPct >= 95 ? 25 : convPct >= 90 ? 20 : convPct >= 80 ? 15 : convPct >= 70 ? 10 : 5;
                        sc += r.hasSwp && r.hasBlk ? 25 : r.hasSwp ? 15 : 5;
                        sc += Math.abs(r.net) >= 50e6 ? 15 : Math.abs(r.net) >= 20e6 ? 12 : Math.abs(r.net) >= 5e6 ? 9 : Math.abs(r.net) >= 1e6 ? 6 : 3;
                        const tc = r.topContract;
                        if (tc) {
                          sc += tc.hits >= 10 ? 10 : tc.hits >= 5 ? 7 : tc.hits >= 3 ? 4 : 2;
                          if (tc.DTE >= 7 && tc.DTE <= 30) sc += 15;
                          else if (tc.DTE >= 3 && tc.DTE <= 45) sc += 10;
                          else sc += 5;
                        }
                        const reasons = [];
                        if (convPct >= 90) reasons.push(Math.round(convPct)+"% "+r.dir.toLowerCase());
                        if (r.hasSwp && r.hasBlk) reasons.push("sweep+block");
                        else if (r.hasSwp) reasons.push("sweep");
                        if (tc && tc.hits >= 5) reasons.push(tc.hits+"x repeat");
                        if (tc && tc.DTE <= 14) reasons.push(tc.DTE+"d exp");
                        if (r.n >= 50) reasons.push(r.n+" trades");
                        return { ...r, sc, reasons: reasons.join(", ") };
                      });
                      const topBull = scored.filter(r=>r.dir==="BULL").sort((a,b)=>b.sc-a.sc).slice(0,5);
                      const topBear = scored.filter(r=>r.dir==="BEAR").sort((a,b)=>b.sc-a.sc).slice(0,5);
                      if (!topBull.length && !topBear.length) return null;
                      const renderIdea = (r, i, side) => {
                        const dirC = side==="bull"?P.bu:P.be;
                        const tc = r.topContract;
                        const tcSide = tc?(tc.askPrem>=tc.bidPrem?"ask":"bid"):"ask";
                        let tcC = P.dm;
                        if(tc){ if(tc.cp==="C") tcC=tcSide==="ask"?P.bu:"#ff9800"; else tcC=tcSide==="ask"?P.be:"#29b6f6"; }
                        return (
                          <div key={r.sym} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderBottom:"1px solid "+P.bd+"15", cursor:"pointer" }}
                            onClick={()=>{
                                const cc = capFilter==="All" ? (D.all_directional||[]) : (D.all_directional||[]).filter(t=>capBand(t.mktcap)===capFilter);
                                const trades = cc.filter(t=>t.S===r.sym);
                                const contracts = {};
                                trades.forEach(t => {
                                  const ck=t.CP+"|"+t.K+"|"+t.E;
                                  if(!contracts[ck]) contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,vol:0,DTE:t.DTE,askPrem:0,bidPrem:0,maxOI:0,hasSweep:false,hasBlock:false,prices:[]};
                                  const c=contracts[ck]; c.hits++; c.prem+=t.P; c.vol+=t.V;
                                  if(t.Ty==="SWP") c.hasSweep=true; if(t.Ty==="BLK") c.hasBlock=true;
                                  if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
                                  if(t.OI>c.maxOI) c.maxOI=t.OI;
                                  if(t.price>0) c.prices.push(t.price);
                                });
                                Object.values(contracts).forEach(c=>{ c.entry=c.prices.length>0?c.prices.reduce((a,b)=>a+b,0)/c.prices.length:0; c.volOI=c.maxOI>0?c.vol/c.maxOI:0; });
                                setBatchDetail({sym:r.sym, bull:r.bull, bear:r.bear, bullPct:r.bullPct, dir:r.dir, net:r.net, n:r.n,
                                  contracts:Object.values(contracts).sort((a,b)=>b.prem-a.prem), mktcap:r.mktcap});
                              }}>
                            <span style={{ fontSize:10, color:dirC, fontWeight:900, width:16 }}>{i+1}</span>
                            <span style={{ fontWeight:900, color:P.wh, fontSize:13, minWidth:50 }}>{r.sym}</span>
                            <span style={{ fontWeight:800, color:dirC, fontSize:11 }}>{fmt(Math.abs(r.net))}</span>
                            <span style={{ fontWeight:800, color:r.bullPct>=80?P.bu:r.bullPct<=20?P.be:P.dm, fontSize:10 }}>{r.dir==="BULL"?r.bullPct:(100-r.bullPct)}%</span>
                            {tc && <span style={{ fontSize:9 }}>
                              <span style={{ color:tcC, fontWeight:800 }}>{tc.cp==="C"?"C":"P"}</span>
                              {tcSide==="bid" && <span style={{ fontSize:7, color:tcC, fontWeight:800, marginLeft:2, padding:"1px 3px", borderRadius:3, background:tcC+"22" }}>BB</span>}
                              <span style={{ color:P.wh, marginLeft:3 }}>${tc.K}</span>
                              <span style={{ color:P.ac, marginLeft:3 }}>{tc.exp}</span>
                              <span style={{ color:tc.hits>=10?P.ac:tc.hits>=5?P.ye:P.dm, fontWeight:800, marginLeft:3 }}>{tc.hits}x</span>
                            </span>}
                            {(()=>{
                              const px = tc ? getPrice(r.sym, tc.cp, tc.K, tc.exp) : null;
                              const now = px ? (px.mark||px.last||px.mid||0) : 0;
                              if (now <= 0) return null;
                              const entry = tc.entry || 0;
                              const pnl = now > 0 && entry > 0 ? (now-entry)/entry*100 : 0;
                              return <span style={{ marginLeft:"auto", fontSize:9 }}>
                                {entry > 0 && <span style={{ color:P.dm }}>${entry.toFixed(2)} → </span>}
                                <span style={{ color:P.wh, fontWeight:700 }}>${now.toFixed(2)}</span>
                                {entry > 0 && <span style={{ color:pnl>0?P.bu:pnl<0?P.be:P.dm, fontWeight:800, marginLeft:4 }}>{pnl>=0?"+":""}{pnl.toFixed(1)}%</span>}
                              </span>;
                            })()}
                          </div>
                        );
                      };
                      return (
                        <div style={{ marginBottom:12, padding:"10px 12px", borderRadius:8, background:P.al, border:"1px solid "+P.bd }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                            <div style={{ fontSize:11, fontWeight:800, color:"#c9a84c", letterSpacing:0.5 }}>⚡ TOP IDEAS FROM YOUR WATCHLIST</div>
                            <button onClick={()=>{
                              const allContracts = [];
                              [...topBull,...topBear].forEach(r => {
                                if(r.topContract) allContracts.push({sym:r.sym, cp:r.topContract.cp, strike:r.topContract.K, exp:r.topContract.exp});
                              });
                              if(allContracts.length) fetchPrices(allContracts);
                            }} disabled={fetchLoading}
                              style={{ padding:"5px 12px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                                fontSize:9, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.ac, color:fetchLoading?P.dm:P.bg }}>
                              {fetchLoading?"Fetching…":"⚡ Fetch Live OI & Prices"}
                            </button>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                            {topBull.length > 0 && <div>
                              <div style={{ fontSize:9, fontWeight:800, color:P.bu, letterSpacing:1, marginBottom:4 }}>▲ BULL ({topBull.length})</div>
                              {topBull.map((r,i)=>renderIdea(r,i,"bull"))}
                            </div>}
                            {topBear.length > 0 && <div>
                              <div style={{ fontSize:9, fontWeight:800, color:P.be, letterSpacing:1, marginBottom:4 }}>▼ BEAR ({topBear.length})</div>
                              {topBear.map((r,i)=>renderIdea(r,i,"bear"))}
                            </div>}
                          </div>
                        </div>
                      );
                    })()}
                    <table style={{ width:"90%", margin:"0 auto", borderCollapse:"collapse", fontSize:10, tableLayout:"fixed" }}>
                      <colgroup>
                        <col style={{ width:"11%" }}/><col style={{ width:"8%" }}/><col style={{ width:"13%" }}/><col style={{ width:"13%" }}/>
                        <col style={{ width:"11%" }}/><col style={{ width:"15%" }}/><col style={{ width:"29%" }}/>
                      </colgroup>
                      <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                        {[["Ticker","ticker"],["Bet",""],["Bull","bull"],["Bear","bear"],["Split",""],["Net","net"],["Top Contract",""]].map(([h,sk])=>{
                          const sortable = !!sk;
                          const active = batchSort===sk;
                          const arrow = active ? (batchSortDir==="desc"?" ▼":" ▲") : "";
                          return <th key={h||sk||Math.random()} onClick={sortable?()=>{
                            if(batchSort===sk) setBatchSortDir(d=>d==="desc"?"asc":"desc");
                            else { setBatchSort(sk); setBatchSortDir(sk==="ticker"?"asc":"desc"); }
                          }:undefined}
                            style={{ padding:"4px 5px", textAlign:"center", color:active?P.ac:P.mt, fontSize:9, fontWeight:active?800:600,
                              cursor:sortable?"pointer":"default", userSelect:"none" }}>
                            {h}{arrow}
                          </th>;
                        })}
                      </tr></thead>
                      <tbody>
                        {(()=>{
                          const found = batchResults.filter(r=>r.found);
                          const notFound = batchResults.filter(r=>!r.found);
                          const dir = batchSortDir==="desc"?1:-1;
                          if(batchSort==="net") found.sort((a,b)=>((b.net||0)-(a.net||0))*dir);
                          else if(batchSort==="bull") found.sort((a,b)=>((b.bull||0)-(a.bull||0))*dir);
                          else if(batchSort==="bear") found.sort((a,b)=>((b.bear||0)-(a.bear||0))*dir);
                          else if(batchSort==="ticker") found.sort((a,b)=>a.sym.localeCompare(b.sym)*dir);
                          notFound.sort((a,b)=>a.sym.localeCompare(b.sym));
                          return [...found,...notFound].map(r => {
                          if (!r.found) return (
                            <tr key={r.sym} style={{ borderBottom:"1px solid "+P.bd+"10", opacity:0.4 }}>
                              <td style={{ padding:"5px", fontWeight:800, color:P.wh, textAlign:"center" }}>{r.sym}</td>
                              <td colSpan={6} style={{ padding:"5px", color:P.dm, fontSize:9 }}>No flow found</td>
                            </tr>
                          );
                          const dirC = r.dir==="BULL"?P.bu:P.be;
                          const tc = r.topContract;
                          const tcSide = tc?(tc.askPrem>=tc.bidPrem?"ask":"bid"):"ask";
                          let tcC = P.dm;
                          if(tc){ if(tc.cp==="C") tcC=tcSide==="ask"?P.bu:"#ff9800"; else tcC=tcSide==="ask"?P.be:"#29b6f6"; }
                          return (
                            <tr key={r.sym} style={{ borderBottom:"1px solid "+P.bd+"15", cursor:"pointer" }}
                              onClick={()=>{
                                const cc = capFilter==="All" ? (D.all_directional||[]) : (D.all_directional||[]).filter(t=>capBand(t.mktcap)===capFilter);
                                const trades = cc.filter(t=>t.S===r.sym);
                                const contracts = {};
                                trades.forEach(t => {
                                  const ck=t.CP+"|"+t.K+"|"+t.E;
                                  if(!contracts[ck]) contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,vol:0,DTE:t.DTE,askPrem:0,bidPrem:0,maxOI:0,hasSweep:false,hasBlock:false,prices:[]};
                                  const c=contracts[ck]; c.hits++; c.prem+=t.P; c.vol+=t.V;
                                  if(t.Ty==="SWP") c.hasSweep=true; if(t.Ty==="BLK") c.hasBlock=true;
                                  if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
                                  if(t.OI>c.maxOI) c.maxOI=t.OI;
                                  if(t.price>0) c.prices.push(t.price);
                                });
                                Object.values(contracts).forEach(c=>{ c.entry=c.prices.length>0?c.prices.reduce((a,b)=>a+b,0)/c.prices.length:0; c.volOI=c.maxOI>0?c.vol/c.maxOI:0; });
                                setBatchDetail({sym:r.sym, bull:r.bull, bear:r.bear, bullPct:r.bullPct, dir:r.dir, net:r.net, n:r.n,
                                  contracts:Object.values(contracts).sort((a,b)=>b.prem-a.prem), mktcap:r.mktcap});
                              }}>
                              <td style={{ padding:"5px", textAlign:"center" }}>
                                <span style={{ fontWeight:900, color:P.wh, fontSize:11 }}>{r.sym}</span>
                              </td>
                              <td style={{ padding:"5px", textAlign:"center" }}><Tag c={dirC}>{r.dir}</Tag></td>
                              <td style={{ padding:"5px", fontWeight:800, color:P.bu, textAlign:"center" }}>{fmt(r.bull)}</td>
                              <td style={{ padding:"5px", fontWeight:800, color:P.be, textAlign:"center" }}>{fmt(r.bear)}</td>
                              <td style={{ padding:"5px" }}>
                                <div style={{ display:"flex", height:4, borderRadius:2, overflow:"hidden", background:P.bd }}>
                                  <div style={{ width:r.bullPct+"%", background:P.bu }}/><div style={{ width:(100-r.bullPct)+"%", background:P.be }}/>
                                </div>
                              </td>
                              <td style={{ padding:"5px", fontWeight:900, color:dirC, textAlign:"center" }}>{fmt(Math.abs(r.net))}</td>
                              <td style={{ padding:"5px", fontSize:9, textAlign:"center" }}>
                                {tc && (<span>
                                  <span style={{ color:tcC, fontWeight:800 }}>{tc.cp==="C"?"C":"P"}</span>
                                  {tcSide==="bid" && <span style={{ fontSize:7, color:tcC, fontWeight:800, marginLeft:2, padding:"1px 4px", borderRadius:3, background:tcC+"22", border:"1px solid "+tcC+"44" }}>BB</span>}
                                  <span style={{ color:P.wh, fontWeight:700, marginLeft:3 }}>${tc.K}</span>
                                  <span style={{ color:P.ac, marginLeft:3 }}>{tc.exp}</span>
                                  <span style={{ color:tc.hits>=10?P.ac:tc.hits>=5?P.ye:P.dm, fontWeight:800, marginLeft:4 }}>{tc.hits}x</span>
                                  {tc.prem>=1e6 && <span style={{ color:P.ye, marginLeft:3, fontSize:8 }}>{fmt(tc.prem)}</span>}
                                </span>)}
                              </td>
                            </tr>
                          );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
            {/* Batch Detail Popup */}
            {batchDetail && (
              <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.7)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}
                onClick={()=>setBatchDetail(null)}>
                <div style={{ background:P.bg, border:"1px solid "+P.bd, borderRadius:12, padding:20, maxWidth:900, width:"90%", maxHeight:"80vh", overflow:"auto" }}
                  onClick={e=>e.stopPropagation()}>
                  {(()=>{
                    const d = batchDetail;
                    const dirC = d.dir==="BULL"?P.bu:P.be;
                    return (<>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{ fontSize:20, fontWeight:900, color:P.wh }}>{d.sym}</span>
                          <span style={{ fontSize:8, color:P.dm }}>{capBand(d.mktcap)}</span>
                          <Tag c={dirC}>{d.dir}</Tag>
                          <span style={{ fontWeight:800, color:dirC, fontSize:14 }}>{fmt(Math.abs(d.net))}</span>
                          <span style={{ fontWeight:800, color:d.bullPct>=80?P.bu:d.bullPct<=20?P.be:P.dm, fontSize:11 }}>{d.bullPct}% bull</span>
                        </div>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <button onClick={()=>{ fetchPrices(d.contracts.map(c=>({sym:d.sym,cp:c.cp,strike:c.K,exp:c.exp}))); }} disabled={fetchLoading}
                            style={{ padding:"6px 14px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.ac, color:fetchLoading?P.dm:P.bg }}>
                            {fetchLoading?"Fetching…":"⚡ Fetch Live OI & Prices"}</button>
                          <button onClick={()=>{ setSearch(d.sym); setSelectedTicker(FD.TICKER_DB.find(t=>t.s===d.sym)||null); setSearchDte("All"); setBatchMode(false); setBatchResults(null); setBatchDetail(null); }}
                            style={{ padding:"6px 14px", borderRadius:6, border:"1px solid "+P.bd, cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", background:"transparent", color:P.mt }}>Open in Search →</button>
                          <button onClick={()=>setBatchDetail(null)} style={{ padding:"4px 10px", borderRadius:6, border:"none", cursor:"pointer", fontSize:14, fontWeight:700, fontFamily:"inherit", background:"transparent", color:P.dm }}>✕</button>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:16, marginBottom:12, fontSize:10 }}>
                        <span>Bull: <strong style={{ color:P.bu }}>{fmt(d.bull)}</strong></span>
                        <span>Bear: <strong style={{ color:P.be }}>{fmt(d.bear)}</strong></span>
                        <span>Trades: <strong style={{ color:P.wh }}>{d.n}</strong></span>
                        <span>Contracts: <strong style={{ color:P.wh }}>{d.contracts.length}</strong></span>
                        {status && <span style={{ color:P.dm }}>{status}</span>}
                      </div>
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                        <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                          {["C/P","Strike","Exp","DTE","Hits","Vol","OI","Vol/OI","Entry","Now","P&L","Premium","Side"].map(h=>(
                            <th key={h} style={{ padding:"4px 5px", textAlign:"left", color:P.mt, fontSize:9, fontWeight:600 }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {d.contracts.slice(0,15).map((c,i) => {
                            const px = getPrice(d.sym, c.cp, c.K, c.exp);
                            const now = px ? (px.mark || px.last || px.mid || 0) : 0;
                            const entry = c.entry || 0;
                            const pnl = now > 0 && entry > 0 ? (now - entry) / entry * 100 : 0;
                            const pnlC = pnl > 0 ? P.bu : pnl < 0 ? P.be : P.dm;
                            const cSide = c.askPrem >= c.bidPrem ? "ASK" : "BID";
                            const sideC = cSide==="ASK" ? P.mt : "#ff9800";
                            const curOI = px ? px.oi : 0;
                            return (
                              <tr key={i} style={{ borderBottom:"1px solid "+P.bd+"10" }}>
                                <td style={{ padding:"4px 5px" }}><Tag c={c.cp==="C"?P.bu:P.be}>{c.cp}</Tag></td>
                                <td style={{ padding:"4px 5px", fontWeight:700, color:P.wh }}>${c.K}</td>
                                <td style={{ padding:"4px 5px", color:P.wh }}>{c.exp}</td>
                                <td style={{ padding:"4px 5px", color:c.DTE<=7?P.be:c.DTE<=30?P.ye:P.dm }}>{c.DTE}d</td>
                                <td style={{ padding:"4px 5px", fontWeight:700, color:c.hits>=10?P.ac:c.hits>=5?P.ye:P.dm }}>{c.hits}x</td>
                                <td style={{ padding:"4px 5px", color:P.dm }}>{c.vol.toLocaleString()}</td>
                                <td style={{ padding:"4px 5px", color:P.dm }}>{curOI>0?curOI.toLocaleString():c.maxOI.toLocaleString()}</td>
                                <td style={{ padding:"4px 5px", fontWeight:700, color:c.volOI>=10?P.ac:c.volOI>=3?P.ye:P.dm }}>{c.volOI>0?c.volOI.toFixed(1)+"x":"—"}</td>
                                <td style={{ padding:"4px 5px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
                                <td style={{ padding:"4px 5px", fontWeight:700, color:now>0?P.wh:P.dm }}>{now>0?"$"+now.toFixed(2):"—"}</td>
                                <td style={{ padding:"4px 5px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>
                                <td style={{ padding:"4px 5px", fontWeight:700, color:premC(c.prem) }}>{fmt(c.prem)}</td>
                                <td style={{ padding:"4px 5px", fontSize:9, color:sideC, fontWeight:700 }}>{cSide}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>);
                  })()}
                </div>
              </div>
            )}
            {selectedTicker && (() => {
              // Re-resolve against current D each render to avoid stale snapshot.
              // selectedTicker is captured at setSelectedTicker time; if
              // dateFilter or cap changes after, D regenerates but selectedTicker
              // still holds the old TICKER_DB entry — which makes tk.n / tk.t /
              // tk.c reflect a different date window than ccAll / BULL / BEAR.
              const tk = (D && D.TICKER_DB || []).find(t => t.s === selectedTicker.s) || selectedTicker;
              const dteF = t => searchDte==="All" ? true : searchDte==="ST" ? t.DTE>=0&&t.DTE<60 : searchDte==="LT" ? t.DTE>=60&&t.DTE<180 : t.DTE>=180;
              const ccAll = (D.all_directional||[]).filter(t => t.S===tk.s);
              const ccTrades = ccAll.filter(dteF);
              let ccB=0, ccR=0;
              ccTrades.forEach(t => { if(t.D==="BULL") ccB+=t.P; else if(t.D==="BEAR") ccR+=t.P; });
              const net = ccB - ccR;
              const total = ccB + ccR;
              const dir = total===0?"NEUTRAL":net>0?"BULL":"BEAR";
              const dirC = dir==="BULL"?P.bu:dir==="BEAR"?P.be:P.dm;
              // DTE counts for pills
              const stN = ccAll.filter(t=>t.DTE>=0&&t.DTE<60).length;
              const ltN = ccAll.filter(t=>t.DTE>=60&&t.DTE<180).length;
              const leN = ccAll.filter(t=>t.DTE>=180).length;
              return (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    {[
                      {k:"All", label:"All", count:ccAll.length},
                      {k:"ST", label:"0–59d", count:stN},
                      {k:"LT", label:"60–179d", count:ltN},
                      {k:"LEAPS", label:"180+d", count:leN},
                    ].map(d => {
                      const active = searchDte===d.k;
                      return (
                        <button key={d.k} onClick={()=>setSearchDte(d.k)} style={{
                          padding:"4px 12px", borderRadius:16, border:"1.5px solid "+(active?P.ac:P.bd),
                          cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit",
                          background:active?P.ac+"22":"transparent", color:active?P.ac:P.mt,
                          display:"flex", alignItems:"center", gap:5, transition:"all 0.15s"
                        }}>
                          <span>{d.label}</span>
                          <span style={{ fontSize:8, opacity:0.7 }}>{d.count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16, borderTop:"3px solid "+dirC }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Net Direction{searchDte!=="All"?" ("+({ST:"0–59d",LT:"60–179d",LEAPS:"180+d"})[searchDte]+")":""}</div>
                      <div style={{ fontSize:28, fontWeight:900, color:dirC }}>{dir}</div>
                      <div style={{ fontSize:10, color:P.dm, marginTop:4 }}>{ccTrades.length} directional trades</div>
                    </div>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bullish Flow</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.bu }}>{fmt(ccB)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:(total>0?(ccB/total*100):0)+"%", height:"100%", background:P.bu, borderRadius:2 }} />
                      </div>
                    </div>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bearish Flow</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.be }}>{fmt(ccR)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:(total>0?(ccR/total*100):0)+"%", height:"100%", background:P.be, borderRadius:2 }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <button onClick={()=>{
                      const contracts = [];
                      (tk.t||[]).forEach(r => contracts.push({sym:r.S,cp:r.CP,strike:r.K,exp:r.E}));
                      (tk.c||[]).forEach(r => contracts.push({sym:r.S,cp:r.CP,strike:r.K,exp:r.E}));
                      fetchPrices(contracts);
                    }} disabled={fetchLoading}
                      style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                        fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                      {fetchLoading?"Fetching…":"⚡ Fetch Live OI & Prices"}
                    </button>
                    <span style={{ fontSize:9, color:P.dm }}>Updates Now, P&L, OI, ΔOI, Greeks across both tables</span>
                    {status && <span style={{ fontSize:9, color:P.dm }}>{status}</span>}
                  </div>
                  {/* panelFn omitted — modal version handles expanded view, prevents double-layer */}
                  <Card title={tk.s+" — Top 10 Trades by Premium"} sub={tk.n+" total"}><TT rows={tk.t} priceFn={getPrice} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }}/></Card>
                  {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
                </>
              );
            })()}
          </div>
        )}

                {/* OI Check */}
        {tab==="OI Check" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14 }}>
                <div style={{ width:3, background:P.uc, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:P.uc, marginBottom:5 }}>OI Check — Flow Confirmed</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>Track open interest changes on flow contracts. Fetch Live OI to compare current OI vs when flow first appeared. ΔOI up = positions grew, ΔOI down = exits.</div>
                </div>
              </div>
            </Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <input type="text" value={oiSearch}
                  onChange={e=>setOiSearch(e.target.value.toUpperCase())}
                  placeholder="Search ticker…"
                  style={{ width:140, padding:"6px 12px", borderRadius:6, fontSize:11, fontWeight:600, background:P.al, border:"1px solid "+P.bl, color:P.wh, fontFamily:"inherit", outline:"none", letterSpacing:1 }}
                />
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <button onClick={()=>{
                  // 2026-07-04: honor the Stocks tab. watchMap doesn't carry
                  // stocketf, so fall back to ticker-symbol check only.
                  const _tabOk = (w) => {
                    const isEtf = isETFSymbol(w.S, "");
                    return dataMode === "stocks" ? !isEtf : isEtf;
                  };
                  const visible = oiSearch ? D.WATCH.filter(w=>(w.S||"").includes(oiSearch)&&w.OI>=5).filter(_tabOk).sort((a,b)=>b.P-a.P).slice(0,40)
                : D.WATCH.filter(w=>w.OI>=5&&(capFilter==="All"||w.cap===capFilter)).filter(_tabOk).slice(0,100);
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
              // 2026-07-04: honor the Stocks tab. watchMap doesn't carry
              // stocketf, so fall back to ticker-symbol check only.
              const _tabOk = (w) => {
                const isEtf = isETFSymbol(w.S, "");
                return dataMode === "stocks" ? !isEtf : isEtf;
              };
              const watchAll = oiSearch ? D.WATCH.filter(w=>(w.S||"").includes(oiSearch)&&w.OI>=5).filter(_tabOk).sort((a,b)=>b.P-a.P).slice(0,40)
                : D.WATCH.filter(w=>w.OI>=5&&(capFilter==="All"||w.cap===capFilter)).filter(_tabOk).slice(0,100);
              const enriched = watchAll.map(r => {
                const px = getPrice(r.S, r.CP, r.K, r.E);
                const curOI = px ? (px.oi||0) : 0;
                const liveDOI = curOI > 0 && r.firstOI > 0 ? curOI - r.firstOI : (curOI > 0 && r.OI > 0 ? curOI - r.OI : 0);
                const bestDOI = liveDOI !== 0 ? liveDOI : (r.csvDOI || 0);
                const bestLastOI = curOI > 0 ? curOI : r.lastOI || 0;
                const baseOI = r.firstOI > 0 ? r.firstOI : r.OI;
                const pctDOI = baseOI > 0 && bestDOI !== 0 ? Math.round(bestDOI / baseOI * 100) : 0;
                return { ...r, curOI, dOI: bestDOI, displayLastOI: bestLastOI, pctDOI };
              });
              const getVal = (r, key) => {
                if (key==="sym") return r.S||"";
                if (key==="exp") return new Date(r.E||0).getTime();
                if (key==="strike") return parseFloat(r.K)||0;
                if (key==="entry") return r.price||0;
                if (key==="premium") return r.P||0;
                if (key==="vol") return r.V||0;
                if (key==="firstOI") return r.firstOI||0;
                if (key==="lastOI") return r.lastOI||0;
                if (key==="doi") return r.dOI||0;
                if (key==="pctDOI") return r.pctDOI||0;
                if (key==="lastOI") return r.displayLastOI||r.lastOI||0;
                if (key==="volOI") return r.volOI||0;
                if (key==="flowDate") {
                  const d = r.firstDate||"";
                  if (!d) return 0;
                  const p = d.split("/").map(Number);
                  const y = p.length>=3?(p[2]<100?p[2]+2000:p[2]):new Date().getFullYear();
                  return new Date(y, p[0]-1, p[1]||1).getTime();
                }
                if (key==="dte") return r.DTE||0;
                if (key==="hits") return r.trades||0;
                return 0;
              };
              const sorted = [...enriched].sort((a,b) => {
                const d1 = oiSort.dir === "asc" ? 1 : -1;
                const d2 = oiSort.dir2 === "asc" ? 1 : -1;
                const av1 = getVal(a, oiSort.col), bv1 = getVal(b, oiSort.col);
                const cmp1 = oiSort.col==="sym" ? av1.localeCompare(bv1)*d1 : (av1-bv1)*d1;
                if (cmp1 !== 0) return cmp1;
                const av2 = getVal(a, oiSort.col2), bv2 = getVal(b, oiSort.col2);
                return oiSort.col2==="sym" ? av2.localeCompare(bv2)*d2 : (av2-bv2)*d2;
              });
              const toggleSort = (col) => setOiSort(prev => {
                if (prev.col===col) return {...prev, dir:prev.dir==="desc"?"asc":"desc"};
                return {col, dir:"desc", col2:prev.col, dir2:prev.dir};
              });
              const sortIcon = (col) => {
                if (oiSort.col===col) return oiSort.dir==="desc"?" ▼":" ▲";
                if (oiSort.col2===col) return oiSort.dir2==="desc"?" ▽":" △";
                return "";
              };
              const cols = [
                {key:"sym",label:"Ticker"},{key:"exp",label:"Exp"},{key:"strike",label:"Strike"},{key:"cp",label:"C/P"},
                {key:"entry",label:"Entry"},{key:"premium",label:"Premium"},{key:"flow",label:"Flow"},{key:"hits",label:"Hits"},
                {key:"vol",label:"Vol"},{key:"firstOI",label:"First OI"},{key:"lastOI",label:"Last OI"},{key:"doi",label:"ΔOI"},{key:"pctDOI",label:"%ΔOI"},{key:"flowDate",label:"Date"},{key:"dte",label:"DTE"}
              ];
              return (
            <Card title="OI Check" sub={Math.min(40,sorted.length)+" of "+sorted.length+" contracts · "+oiSort.col+(oiSort.col2?" → "+oiSort.col2:"")}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {cols.map(c=>(
                      <th key={c.key} onClick={()=>c.key!=="cp"&&c.key!=="flow"&&toggleSort(c.key)}
                        style={{ padding:"5px 4px", textAlign:c.key==="flow"?"center":"left", color:oiSort.col===c.key?P.ac:oiSort.col2===c.key?P.ye:P.mt, fontSize:9, fontWeight:600,
                          cursor:c.key!=="cp"&&c.key!=="flow"?"pointer":"default", userSelect:"none" }}
                        title={c.key==="doi"?"OI change from first day seen to last day in CSV":c.key==="firstOI"?"OI on first day this contract appeared":c.key==="lastOI"?"OI on most recent day":undefined}>
                        {c.label}{sortIcon(c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0,40).map((r,i)=>{
                    const dOI = r.dOI || 0;
                    const dOIC = dOI > 0 ? P.bu : dOI < 0 ? P.be : P.dm;
                    return (
                      <tr key={i} style={{ borderBottom:"1px solid "+P.bd+"10", background:dOI>1000?(P.bu+"08"):dOI<-100?(P.be+"08"):"transparent" }}>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
                        <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{r.price>0?"$"+r.price.toFixed(2):"—"}</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:premC(r.P) }}>{fmt(r.P)}</td>
                        <td style={{ padding:"5px 4px" }}>
                          <span style={{ display:"flex", gap:2, alignItems:"center", justifyContent:"center" }}>
                            {r.hasSweep&&r.hasBlock?<Tag c={P.ac}>S+B</Tag>:r.hasSweep?<Tag c={P.sw}>SWP</Tag>:<Tag c={P.bk}>BLK</Tag>}
                          </span>
                        </td>
                        <td style={{ padding:"5px 4px", fontWeight:700, color:r.trades>=5?P.ac:r.trades>=3?P.ye:P.dm }}>{r.trades}x</td>
                        <td style={{ padding:"5px 4px", color:P.dm }}>{r.V.toLocaleString()}</td>
                        <td style={{ padding:"5px 4px", color:P.dm }}>{r.firstOI>0?r.firstOI.toLocaleString():"—"}</td>
                        <td style={{ padding:"5px 4px", color:P.wh, fontWeight:700 }}>{(r.displayLastOI||r.lastOI)>0?(r.displayLastOI||r.lastOI).toLocaleString():"—"}{r.curOI>0&&<span style={{ fontSize:7, color:P.ac, marginLeft:2 }}>live</span>}</td>
                        <td style={{ padding:"5px 4px", fontWeight:800, color:dOIC }}>{dOI!==0?(dOI>0?"+":"")+dOI.toLocaleString():"—"}</td>
                        <td style={{ padding:"5px 4px", fontWeight:700, fontSize:10, color:r.pctDOI>=500?"#3cb868":r.pctDOI>=100?P.bu:r.pctDOI>=50?P.ye:r.pctDOI>0?P.dm:r.pctDOI<0?P.be:P.mt }}>{r.pctDOI!==0?(r.pctDOI>0?"+":"")+r.pctDOI.toLocaleString()+"%":"—"}</td>
                        <td style={{ padding:"5px 4px", color:P.dm, fontSize:9 }}>{r.firstDate||"—"}</td>
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
        {tab==="Tracker" && (() => {
          const trackerDates = [...new Set((topFlowPicks.active||[]).map(p=>p.dateSaved).filter(Boolean))].sort().reverse();
          // 2026-07-04: honor the Stocks tab. Tracker picks came from Watchlist
          // originally and don't carry stocketf, so fall back to symbol check.
          const _tabOk = (p) => {
            const isEtf = isETFSymbol(p.sym, p.stocketf||"");
            return dataMode === "stocks" ? !isEtf : isEtf;
          };
          const afterTab  = (list) => list.filter(_tabOk);
          const afterDateFilter = (list) => trackerDateFilter === "All" ? list : list.filter(p => p.dateSaved === trackerDateFilter);
          const afterCap = (list) => capFilter === "All" ? list : list.filter(p => (p.cap||"Unknown") === capFilter);
          const afterCp  = (list) => trackerCpFilter === "All" ? list : list.filter(p => p.cp === (trackerCpFilter === "Calls" ? "C" : "P"));
          const filteredActive = afterCp(afterCap(afterDateFilter(afterTab(topFlowPicks.active))));
          const filteredArchived = afterCp(afterCap(afterDateFilter(afterTab(topFlowPicks.archived))));
          const calcPnl = (p) => { const px=getPrice(p.sym,p.cp,p.strike,p.exp); const now=px?(px.mark||px.last||0):(p.history&&p.history.length>0?p.history[p.history.length-1].price:0); return now>0&&p.entry>0?(now-p.entry)/p.entry*100:0; };
          const calcPeak = (p) => { const px=getPrice(p.sym,p.cp,p.strike,p.exp); const now=px?(px.mark||px.last||0):0; const hist=p.history||[]; const allPx=[...hist.map(h=>h.price),now,p.finalPrice||0].filter(v=>v>0); const peak=allPx.length>0?Math.max(...allPx):0; return peak>0&&p.entry>0?(peak-p.entry)/p.entry*100:0; };
          const calcNow = (p) => { const px=getPrice(p.sym,p.cp,p.strike,p.exp); return px?(px.mark||px.last||0):(p.history&&p.history.length>0?p.history[p.history.length-1].price:0); };
          const trkGetVal = (p, key) => {
            if (key==="ticker") return p.sym||"";
            if (key==="exp") return p.exp||"";
            if (key==="strike") return parseFloat(p.strike)||0;
            if (key==="grade") return ({"A+":6,"A":5,"B+":4,"B":3,"C":2,"D":1})[p.grade]||0;
            if (key==="entry") return p.entry||0;
            if (key==="now") return calcNow(p);
            if (key==="pnl") return calcPnl(p);
            if (key==="peak") return calcPeak(p);
            if (key==="oi") {
              const csv = D?.WATCH?.find(w=>w.S===p.sym&&w.CP===p.cp&&String(w.K)===String(p.strike)&&w.E===p.exp);
              if (csv) return csv.lastOI||csv.OI||0;
              const h=(p.history||[]).filter(h=>(h.oi||0)>0); return h.length>0?h[h.length-1].oi:0;
            }
            if (key==="doi") {
              const csv = D?.WATCH?.find(w=>w.S===p.sym&&w.CP===p.cp&&String(w.K)===String(p.strike)&&w.E===p.exp);
              if (csv && csv.daysTracked>1) return csv.csvDOI||0;
              const h=(p.history||[]).filter(h=>(h.oi||0)>0); return h.length>1?h[h.length-1].oi-h[h.length-2].oi:0;
            }
            if (key==="days") return p.dateSaved?Math.round((Date.now()-new Date(p.dateSaved).getTime())/86400000):0;
            if (key==="added") return new Date(p.dateSaved||0).getTime();
            if (key==="premium") return p.prem||0;
            return 0;
          };
          const sortFn = (a,b) => {
            const d1 = trkSort.dir==="asc"?1:-1;
            const av1=trkGetVal(a,trkSort.col), bv1=trkGetVal(b,trkSort.col);
            const cmp1 = trkSort.col==="ticker"?av1.localeCompare(bv1)*d1:(av1-bv1)*d1;
            if (cmp1!==0) return cmp1;
            const d2 = trkSort.dir2==="asc"?1:-1;
            const av2=trkGetVal(a,trkSort.col2), bv2=trkGetVal(b,trkSort.col2);
            return trkSort.col2==="ticker"?av2.localeCompare(bv2)*d2:(av2-bv2)*d2;
          };
          const trkToggle = (col) => setTrkSort(prev => prev.col===col?{...prev,dir:prev.dir==="desc"?"asc":"desc"}:{col,dir:"desc",col2:prev.col,dir2:prev.dir});
          const trkIcon = (col) => trkSort.col===col?(trkSort.dir==="desc"?" ▼":" ▲"):trkSort.col2===col?(trkSort.dir2==="desc"?" ▽":" △"):"";
          const trkColor = (col) => trkSort.col===col?P.ac:trkSort.col2===col?P.ye:P.mt;
          const sortedActive = [...filteredActive].sort(sortFn);
          const sortedArchived = [...filteredArchived].sort(sortFn);
          const smartCap = (list) => {
            if (trkSort.col === "pnl" || trkSort.col === "peak") {
              const top = list.slice(0, 25);
              const bot = list.length > 25 ? list.slice(-Math.min(25, list.length - 25)) : [];
              return { items: [...top, ...bot], split: bot.length > 0 ? top.length : -1 };
            }
            return { items: list.slice(0, 50), split: -1 };
          };
          const activeResult = smartCap(sortedActive);
          const archivedResult = smartCap(sortedArchived);
          const cappedActive = activeResult.items;
          const cappedArchived = archivedResult.items;
          return (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Card>
              <div style={{ display:"flex", gap:14 }}>
                <div style={{ width:3, background:P.ac, borderRadius:2, alignSelf:"stretch", flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:P.ac, marginBottom:5 }}>Top Flow Tracker</div>
                  <div style={{ fontSize:11, color:P.dm, lineHeight:1.7 }}>Tracks performance of Top Flow conviction picks over time. Picks are auto-saved when new flow data loads. Daily snapshots at 4:30 PM ET update prices. Expired contracts auto-archive.</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:4, marginTop:10, flexWrap:"wrap", alignItems:"center" }}>
                <button onClick={()=>setTrackerDateFilter("All")}
                  style={{ padding:"4px 12px", borderRadius:5, border:"1px solid "+(trackerDateFilter==="All"?P.ac:P.bd),
                    background:trackerDateFilter==="All"?P.ac+"18":"transparent", color:trackerDateFilter==="All"?P.ac:P.dm,
                    fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>All</button>
                {trackerDates.length > 0 && (
                  <select value={trackerDateFilter==="All"?"":trackerDateFilter}
                    onChange={e=>e.target.value?setTrackerDateFilter(e.target.value):setTrackerDateFilter("All")}
                    style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:5, color:P.wh, fontSize:10, padding:"5px 14px", fontFamily:"inherit", fontWeight:600 }}>
                    <option value="">Select date...</option>
                    {trackerDates.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                )}
                <span style={{ fontSize:9, color:P.dm, marginLeft:8 }}>{filteredActive.length} active contracts</span>
              </div>
            </Card>
            {cappedActive.length > 0 ? (
              <Card title="Active Picks" sub={cappedActive.length+(cappedActive.length<filteredActive.length?" of "+filteredActive.length:"")+" contracts"}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <div style={{ display:"flex", gap:4 }}>
                    {["All","Calls","Puts"].map(v => {
                      const active = trackerCpFilter === v;
                      const accentC = v === "Calls" ? P.bu : v === "Puts" ? P.be : P.ac;
                      return (
                        <button key={v} onClick={() => setTrackerCpFilter(v)}
                          style={{ padding:"4px 12px", borderRadius:5,
                            border:"1px solid "+(active ? accentC : P.bd),
                            background: active ? accentC+"18" : "transparent",
                            color: active ? accentC : P.dm,
                            fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                          {v}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display:"flex", alignItems:"center" }}>
                    <button onClick={()=>{
                      const contracts = cappedActive.map(p=>({sym:p.sym,cp:p.cp,strike:p.strike,exp:p.exp}));
                      fetchPrices(contracts).then(()=>{
                        fetch(API_BASE+"/api/top-flow/snapshot",{method:"POST"}).then(()=>fetch(API_BASE+"/api/top-flow/history").then(r=>r.ok?r.json():null).then(d=>{if(d)setTopFlowPicks(d);})).catch(()=>{});
                      });
                    }} disabled={fetchLoading}
                      style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                        fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                      {fetchLoading?"Fetching…":"⚡ Fetch Live Prices"}
                    </button>
                    {status && <span style={{ fontSize:9, color:P.dm, marginLeft:8 }}>{status}</span>}
                  </div>
                </div>
                <table style={{ width:"90%", margin:"0 auto", borderCollapse:"collapse", fontSize:10, tableLayout:"fixed" }}>
                  <colgroup>
                    <col style={{ width:"8%" }}/>
                    <col style={{ width:"7%" }}/>
                    <col style={{ width:"8%" }}/>
                    <col style={{ width:"5%" }}/>
                    <col style={{ width:"9%" }}/>
                    <col style={{ width:"7%" }}/>
                    <col style={{ width:"10%" }}/>
                    <col style={{ width:"10%" }}/>
                    <col style={{ width:"9%" }}/>
                    <col style={{ width:"9%" }}/>
                    <col style={{ width:"5%" }}/>
                    <col style={{ width:"13%" }}/>
                  </colgroup>
                  <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                    {[{label:"Ticker",key:"ticker"},{label:"Exp",key:"exp"},{label:"Strike",key:"strike"},{label:"C/P",key:""},{label:"Live OI",key:"oi"},{label:"Grade",key:"grade"},{label:"Entry",key:"entry"},{label:"Now",key:"now"},{label:"P&L",key:"pnl"},{label:"Peak",key:"peak"},{label:"Trend",key:""},{label:"Added",key:"added"}].map(h=>(
                      <th key={h.label} onClick={()=>h.key&&trkToggle(h.key)}
                        style={{ padding:"5px 5px", textAlign:"center", color:h.key?trkColor(h.key):P.mt, fontSize:9, fontWeight:600, cursor:h.key?"pointer":"default", userSelect:"none" }}
                        title={h.label==="Peak"?"Highest % gain from entry":undefined}>{h.label}{h.key?trkIcon(h.key):""}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {cappedActive.map((p,i)=>{
                      const px = getPrice(p.sym, p.cp, p.strike, p.exp);
                      const now = px ? (px.mark||px.last||0) : (p.history&&p.history.length>0 ? p.history[p.history.length-1].price : 0);
                      const pnl = now>0 && p.entry>0 ? (now-p.entry)/p.entry*100 : 0;
                      const pnlC = pnl>0?P.bu:pnl<0?P.be:P.dm;
                      const days = p.dateSaved ? Math.max(1, Math.round((Date.now()-new Date(p.dateSaved).getTime())/86400000)) : 0;
                      const hist = p.history||[];
                      const allPx = [...hist.map(h=>h.price), now].filter(v=>v>0);
                      const peakPrice = allPx.length>0 ? Math.max(...allPx) : 0;
                      const peakPnl = peakPrice>0 && p.entry>0 ? (peakPrice-p.entry)/p.entry*100 : 0;
                      const peakRetrace = peakPnl>0 && pnl<peakPnl;
                      const trend = hist.length>=2 ? (hist[hist.length-1].price > hist[hist.length-2].price ? "↑" : hist[hist.length-1].price < hist[hist.length-2].price ? "↓" : "→") : "—";
                      const trendC = trend==="↑"?P.bu:trend==="↓"?P.be:P.dm;
                      const dirC = p.dir==="BULL"?P.bu:p.dir==="BEAR"?P.be:P.dm;
                      const showSep = activeResult.split > 0 && i === activeResult.split;
                      const csvMatch = D?.WATCH?.find(w=>w.S===p.sym&&w.CP===p.cp&&String(w.K)===String(p.strike)&&w.E===p.exp);
                      const oiHist = hist.filter(h=>(h.oi||0)>0);
                      let curOI, prevOI, deltaOI;
                      if (csvMatch && csvMatch.daysTracked > 1) {
                        curOI = csvMatch.lastOI||0;
                        prevOI = csvMatch.firstOI||0;
                        deltaOI = csvMatch.csvDOI||0;
                      } else if (oiHist.length > 0) {
                        curOI = oiHist[oiHist.length-1].oi;
                        prevOI = oiHist.length>1 ? oiHist[oiHist.length-2].oi : 0;
                        deltaOI = curOI>0 && prevOI>0 ? curOI-prevOI : 0;
                      } else if (csvMatch) {
                        curOI = csvMatch.lastOI||csvMatch.OI||0;
                        prevOI = 0;
                        deltaOI = 0;
                      } else {
                        curOI = 0; prevOI = 0; deltaOI = 0;
                      }
                      const peakOI = Math.max(curOI, prevOI, ...(oiHist.map(h=>h.oi)||[0]));
                      const oiDropPct = peakOI>0 && curOI>0 ? (peakOI-curOI)/peakOI*100 : 0;
                      const isExit = oiDropPct >= 30 && peakOI >= 100;
                      return (
                        <Fragment key={p.id||i}>
                        {showSep && <tr><td colSpan={12} style={{ padding:"6px 0", textAlign:"center" }}><div style={{ display:"flex", alignItems:"center", gap:8 }}><div style={{ flex:1, height:1, background:P.be+"40" }}/><span style={{ fontSize:8, fontWeight:700, color:P.be, letterSpacing:1 }}>▼ BOTTOM {cappedActive.length - activeResult.split}</span><div style={{ flex:1, height:1, background:P.be+"40" }}/></div></td></tr>}
                        <tr onClick={()=>{ fetchContractHistory(p.sym,p.cp,p.strike,p.exp); setSelectedItem({sym:p.sym,cp:p.cp,K:p.strike,exp:p.exp}); }}
                          style={{ borderBottom:"1px solid "+P.bd+"10", cursor:"pointer" }}
                          onMouseEnter={e=>e.currentTarget.style.background=P.ac+"08"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>{p.sym}{isExit && <span style={{ fontSize:7, fontWeight:800, marginLeft:3, padding:"1px 4px", borderRadius:2, background:"#e74c3c33", color:"#e74c3c", verticalAlign:"super" }}>EXIT</span>}</td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:P.wh }}>{p.exp}</td>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:P.wh }}>${p.strike}</td>
                          <td style={{ padding:"5px 5px" }}><Tag c={p.cp==="C"?P.bu:P.be}>{p.cp}</Tag></td>
                          <td style={{ padding:"5px 5px", fontSize:10, color:curOI>0?P.dm:P.mt }}>{curOI>0?curOI.toLocaleString():"—"}</td>
                          <td style={{ padding:"5px 5px" }}><Tag c={GRADE_COLORS[p.grade]||P.mt}>{p.grade}</Tag></td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:P.ac }}>{p.entry>0?"$"+p.entry.toFixed(2):"—"}</td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>
                          <td style={{ padding:"5px 5px", fontWeight:800, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>
                          <td style={{ padding:"5px 5px", fontWeight:700, color:peakPnl>0?(peakRetrace?"#FFB300":P.bu):P.dm, fontSize:peakRetrace?9:10 }}>{peakPrice>0?"↑"+(peakPnl>=0?"+":"")+peakPnl.toFixed(1)+"%":"—"}</td>
                          <td style={{ padding:"5px 5px", fontSize:14, fontWeight:800, color:trendC }}>{trend}</td>
                          <td style={{ padding:"5px 5px", color:P.dm, fontSize:9 }}>{p.dateSaved||"—"}</td>
                        </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            ) : (
              <Card><div style={{ textAlign:"center", padding:"20px 0", color:P.dm, fontSize:12 }}>No active picks yet. Upload flow data — Top Flow picks will be tracked automatically.</div></Card>
            )}
            {selectedItem && renderDetailPanel(selectedItem.sym, selectedItem.cp, selectedItem.K, selectedItem.exp, ()=>setSelectedItem(null))}
          </div>
          );
        })()}

        {/* Watchlist */}
        {tab==="Watchlist" && (() => {
          const TIERS = ["FULL","HALF","PAPER MAX","PAPER","WATCH","POST-ER","DQ"];
          const tierC = (t) => t==="FULL"?"#3cb868":t==="HALF"?"#ff9800":t==="PAPER MAX"?"#c9a84c":t==="PAPER"?"#29b6f6":t==="WATCH"?"#78909c":t==="POST-ER"?"#ff6d00":"#616161";
          const scoreC = (s) => s>=9?P.bu:s>=7?"#ff9800":s>=5?P.ye:P.be;

          const REMOVE_REASONS = ["Dirty flow","Arb/Hedge","Deep ITM/OTM","Low conviction","Already moved","Bad R/R","Mega cap noise","Other"];

          const renderItem = (item, idx, side) => {
            const key = side+"-"+idx;
            const isEditing = wlEditing===key;
            const isRemoving = wlRemoving===key;
            const setList = side==="bull"?setWlBull:setWlBear;
            const list = side==="bull"?wlBull:wlBear;
            const update = (field,val) => {
              const n=[...list]; const old=n[idx][field]; n[idx]={...n[idx],[field]:val};
              if ((field==="tier"||field==="score") && old!==val) {
                const log = n[idx].actionLog||[];
                log.push({action:field==="tier"?"tier_change":"score_override", from:old, to:val, at:new Date().toISOString()});
                n[idx].actionLog = log;
              }
              if (field==="notes" && val && !old) {
                const log = n[idx].actionLog||[];
                log.push({action:"notes_added", at:new Date().toISOString()});
                n[idx].actionLog = log;
              }
              setList(n);
            };
            const confirmRemove = (reason) => {
              const log = item.actionLog||[];
              log.push({action:"removed", reason, at:new Date().toISOString()});
              setWlRemoved(prev=>[...prev,{...item, actionLog:log, removeReason:reason, removedAt:new Date().toISOString()}]);
              const n=[...list]; n.splice(idx,1); setList(n);
              setWlRemoving(null); setWlRemoveReason(""); setWlEditing(null);
            };

            return (
              <div key={key} style={{ display:"flex", flexDirection:"column", gap:0 }}>
              <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 10px",
                background:isEditing?P.ac+"08":(isRemoving?P.be+"08":P.cd), borderRadius:isRemoving?"6px 6px 0 0":6, border:"1px solid "+(isRemoving?P.be+"40":isEditing?P.ac+"40":P.bd),
                borderBottom:isRemoving?"none":undefined,
                cursor:"pointer", transition:"all 0.15s" }}
                onClick={()=>{if(!isRemoving){setWlEditing(isEditing?null:key); setWlRemoving(null);}}}>
                {/* Quick remove ✗ */}
                <button onClick={e=>{e.stopPropagation(); const n=[...list]; n.splice(idx,1); setList(n);}}
                  style={{ background:"transparent", border:"none", color:P.dm, fontSize:12, cursor:"pointer", padding:"2px 4px", lineHeight:1, flexShrink:0, opacity:0.5 }}
                  onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.5}
                  title="Remove ticker">✕</button>
                <div style={{ width:120, flexShrink:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <span style={{ fontSize:14, fontWeight:900, color:P.wh }}>{item.sym}</span>
                    {item.cap && item.cap!=="Unknown" && <span style={{ fontSize:7, fontWeight:700, color:P.dm, background:P.al, padding:"1px 4px", borderRadius:2 }}>{item.cap}</span>}
                    {item.er && <span style={{ fontSize:7, fontWeight:800, padding:"1px 4px", borderRadius:2, background:"#ff6d0033", color:"#ff6d00" }}>ER</span>}
                    {(()=>{ const _pick = topFlowPicks.active.find(p=>p.sym===item.sym&&p.cp===item.cp&&parseFloat(p.strike)===parseFloat(item.strike)&&p.exp===item.exp);
                      const _oiH = _pick ? (_pick.history||[]).filter(h=>(h.oi||0)>0) : [];
                      const _curOI = _oiH.length>0 ? _oiH[_oiH.length-1].oi : 0;
                      const _peakOI = _oiH.length>0 ? Math.max(..._oiH.map(h=>h.oi)) : 0;
                      const _isExit = _peakOI>=100 && _curOI>0 && (_peakOI-_curOI)/_peakOI*100>=30;
                      return _isExit ? <span style={{ fontSize:7, fontWeight:800, padding:"1px 4px", borderRadius:2, background:"#e74c3c33", color:"#e74c3c" }}>EXIT</span> : null;
                    })()}
                    {(()=>{ const conv = FD?.CONV?.find(c=>c.sym===item.sym&&c.cp===item.cp&&String(c.K)===String(item.strike)&&c.exp===item.exp);
                      return (conv?.patterns||[]).map((p,pi)=><span key={pi} style={{ fontSize:6, fontWeight:800, marginLeft:2, padding:"1px 4px", borderRadius:2,
                        background:p.type==="IV_SURGE"?"#c9a84c22":p.type==="SIDE_FLIP"?"#ff980022":p.type==="HEAVY"?"#3cb86822":"#29b6f622",
                        color:p.type==="IV_SURGE"?"#c9a84c":p.type==="SIDE_FLIP"?"#ff9800":p.type==="HEAVY"?"#3cb868":"#29b6f6"
                      }}>{p.type==="IV_SURGE"?"IV↑":p.type==="SIDE_FLIP"?"FLIP":p.type==="HEAVY"?"HEAVY":"PX↑"}</span>);
                    })()}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:2 }}>
                    {isEditing ? (
                      <input type="number" step="0.5" min="0" max="10" value={item.score}
                        onChange={e=>update("score",parseFloat(e.target.value)||0)}
                        onClick={e=>e.stopPropagation()}
                        style={{ width:40, background:P.al, border:"1px solid "+P.bd, borderRadius:3, color:P.wh, fontSize:11, padding:"1px 4px", fontFamily:"inherit" }}/>
                    ) : (
                      <span style={{ fontSize:12, fontWeight:800, color:scoreC(item.score) }}>{Math.round(item.score*10)}%</span>
                    )}
                    {item.convScore > 0 && (
                      <span style={{ fontSize:9, color:item.isExit?P.be:P.dm, marginLeft:4, fontWeight:600, cursor:"help" }}
                        title={item.isExit
                          ? `Raw clustering score: ${Math.round(item.convScore).toLocaleString()} → ${Math.round(item.rankScore).toLocaleString()} (EXIT penalty ×0.4 applied). This is what the dedup uses for ranking — higher = beats other contracts on this ticker.`
                          : `Raw clustering score (used for dedup ranking): ${Math.round(item.convScore).toLocaleString()}. Combines grade base + hits×20 + premium/5000 + V/OI bonus + single-sweep & ticker-heat bonuses.`}>
                        [{Math.round(item.rankScore || item.convScore).toLocaleString()}]
                      </span>
                    )}
                    {(()=>{ const conv = FD?.CONV?.find(c=>c.sym===item.sym&&c.cp===item.cp&&String(c.K)===String(item.strike)&&c.exp===item.exp);
                      const bP = conv?.bullPrem||0, brP = conv?.bearPrem||0, tot = bP+brP;
                      if (tot<=0) return null;
                      return <div style={{ width:"100%", display:"flex", height:3, borderRadius:2, overflow:"hidden", background:P.al, marginTop:3 }}>
                        {bP>0&&<div style={{ width:Math.round(bP/tot*100)+"%", background:P.bu }}/>}
                        {brP>0&&<div style={{ width:Math.round(brP/tot*100)+"%", background:P.be }}/>}
                      </div>;
                    })()}
                  </div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:item.cp==="C"?P.bu:P.be }}>
                    {item.cp==="C"?"CALL":"PUT"} ${item.strike} {item.exp}{item.side&&<span style={{ fontSize:8, fontWeight:800, marginLeft:5, padding:"1px 5px", borderRadius:3, background:item.side==="AA"?P.ac+"22":item.side==="BB"?P.be+"22":P.mt+"22", color:item.side==="AA"?P.ac:item.side==="BB"?P.be:P.mt }}>{item.side}</span>}
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:3, fontSize:9 }}>
                    {item.oi>0 && <span style={{ color:P.dm }}>OI: <span style={{ color:P.wh, fontWeight:700 }}>{item.oi.toLocaleString()}</span></span>}
                    {item.volume>0 && <span style={{ color:P.dm }}>Vol: <span style={{ color:P.wh, fontWeight:700 }}>{item.volume.toLocaleString()}</span></span>}
                    {item.volOI>0 && <span style={{ color:item.volOI>=3?P.bu:item.volOI>=1?P.ye:P.dm, fontWeight:700 }}>{item.volOI.toFixed(1)}x</span>}
                    {item.liveOI>0 && <span style={{ color:P.ac }}>Live OI: <span style={{ fontWeight:700 }}>{item.liveOI.toLocaleString()}</span></span>}
                  </div>
                  {isEditing ? (
                    <textarea value={item.notes||""} onChange={e=>{update("notes",e.target.value); e.stopPropagation();}}
                      onClick={e=>e.stopPropagation()}
                      placeholder="Trade notes, DP checks, GSA status..."
                      style={{ width:"100%", minHeight:40, marginTop:4, background:P.al, border:"1px solid "+P.bd, borderRadius:4, color:P.wh, fontSize:10, padding:"4px 6px", fontFamily:"inherit", resize:"vertical" }}/>
                  ) : item.notes ? (
                    <div style={{ fontSize:10, color:P.dm, marginTop:2, lineHeight:1.4 }}>{item.notes}</div>
                  ) : null}
                  {isEditing && (item.actionLog||[]).length>0 && (
                    <div style={{ marginTop:4, padding:"4px 6px", background:P.al, borderRadius:4, maxHeight:80, overflowY:"auto" }}>
                      <div style={{ fontSize:8, fontWeight:700, color:P.mt, marginBottom:2 }}>ACTION LOG</div>
                      {(item.actionLog||[]).slice(-5).reverse().map((a,ai)=>(
                        <div key={ai} style={{ fontSize:8, color:P.dm, lineHeight:1.5 }}>
                          {a.action==="tier_change" && <span><span style={{ color:P.ye }}>TIER</span> {a.from} → <span style={{ fontWeight:700, color:P.wh }}>{a.to}</span></span>}
                          {a.action==="score_override" && <span><span style={{ color:P.ac }}>SCORE</span> {Math.round(a.from*10)}% → <span style={{ fontWeight:700, color:P.wh }}>{Math.round(a.to*10)}%</span></span>}
                          {a.action==="notes_added" && <span style={{ color:P.dm }}>Notes added</span>}
                          {a.action==="removed" && <span><span style={{ color:P.be }}>REMOVED</span> — {a.reason}</span>}
                          <span style={{ color:P.mt, marginLeft:6 }}>{new Date(a.at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2, minWidth:50 }}>
                  <Tag c={GRADE_COLORS[item.grade]||P.mt}>{item.grade}</Tag>
                  <span style={{ fontSize:11 }}><span style={{ color:item.hits>=10?P.ac:item.hits>=5?P.ye:P.dm, fontWeight:700 }}>{item.hits}x</span> · <span style={{ color:premC(item.prem), fontWeight:800 }}>{fmt(item.prem)}</span></span>
                  {isEditing && !isRemoving && (
                    <button onClick={e=>{e.stopPropagation(); setWlRemoving(key); setWlRemoveReason("");}}
                      style={{ fontSize:8, color:P.be, background:"transparent", border:"1px solid "+P.be+"40", borderRadius:3, padding:"1px 6px", cursor:"pointer", fontFamily:"inherit", fontWeight:700, marginTop:2 }}>✕ Remove</button>
                  )}
                </div>
                {/* P&L Column */}
                {(()=>{
                  const px = getPrice(item.sym, item.cp, item.strike, item.exp);
                  if (!px) return null;
                  const now = px.mark || px.last || 0;
                  if (now <= 0) return null;
                  const conv = FD?.CONV?.find(c=>c.sym===item.sym&&c.cp===item.cp&&String(c.K)===String(item.strike)&&c.exp===item.exp);
                  const entry = conv ? (conv.vol > 0 ? conv.prem / conv.vol / 100 : 0) : 0;
                  if (entry <= 0) return (
                    <div style={{ borderLeft:"1px solid "+P.bd, paddingLeft:10, minWidth:75, textAlign:"right" }}>
                      <div style={{ fontSize:14, fontWeight:900, color:P.wh }}>${now.toFixed(2)}</div>
                    </div>
                  );
                  const pnl = ((now - entry) / entry) * 100;
                  const pnlC = pnl >= 0 ? P.bu : P.be;
                  const arrow = pnl >= 0 ? "▲" : "▼";
                  return (
                    <div style={{ borderLeft:"1px solid "+P.bd, paddingLeft:10, minWidth:75, textAlign:"right" }}>
                      <div style={{ fontSize:13, fontWeight:900, color:pnlC }}><span style={{ fontSize:11 }}>{arrow}</span> {pnl>=0?"+":""}{pnl.toFixed(1)}%</div>
                      <div style={{ fontSize:9, color:P.dm, marginTop:2 }}>${entry.toFixed(2)} → <span style={{ color:P.wh, fontWeight:700 }}>${now.toFixed(2)}</span></div>
                    </div>
                  );
                })()}
              </div>
              {isRemoving && (
                <div style={{ padding:"8px 10px", background:P.be+"06", border:"1px solid "+P.be+"40", borderTop:"none", borderRadius:"0 0 6px 6px" }}
                  onClick={e=>e.stopPropagation()}>
                  <div style={{ fontSize:10, fontWeight:700, color:P.be, marginBottom:6 }}>Why are you removing {item.sym}?</div>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:6 }}>
                    {REMOVE_REASONS.map(r=>(
                      <button key={r} onClick={()=>confirmRemove(r)}
                        style={{ padding:"3px 10px", borderRadius:4, border:"1px solid "+P.be+"30", background:P.al, color:P.dm, fontSize:9, fontWeight:600, fontFamily:"inherit", cursor:"pointer" }}
                        onMouseEnter={e=>{e.currentTarget.style.background=P.be+"22";e.currentTarget.style.color=P.be;}}
                        onMouseLeave={e=>{e.currentTarget.style.background=P.al;e.currentTarget.style.color=P.dm;}}>{r}</button>
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:4 }}>
                    <input value={wlRemoveReason} onChange={e=>setWlRemoveReason(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&wlRemoveReason.trim()&&confirmRemove(wlRemoveReason.trim())}
                      placeholder="Or type a custom reason..."
                      style={{ flex:1, background:P.al, border:"1px solid "+P.bd, borderRadius:4, color:P.wh, fontSize:10, padding:"5px 14px", fontFamily:"inherit" }}/>
                    <button onClick={()=>{setWlRemoving(null); setWlRemoveReason("");}}
                      style={{ padding:"4px 10px", borderRadius:4, border:"1px solid "+P.bd, background:"transparent", color:P.dm, fontSize:9, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>Cancel</button>
                  </div>
                </div>
              )}
              </div>
            );
          };

          return (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Header */}
            <Card>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:3, height:28, background:P.ac, borderRadius:2 }}/>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:P.ac }}>Final Watchlist — {wlDate}</div>
                    <div style={{ fontSize:10, color:P.dm }}>Auto-scored from flow data. Click any row to edit score, tier, and notes.</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                  {wlDates.length>0 && (
                    <select value={wlDate} onChange={e=>wlLoad(e.target.value)}
                      style={{ background:P.al, border:"1px solid "+P.bd, borderRadius:5, color:P.wh, fontSize:10, padding:"5px 14px", fontFamily:"inherit" }}>
                      <option value={new Date().toISOString().slice(0,10)}>Today</option>
                      {wlDates.map(d=><option key={d} value={d}>{d}</option>)}
                    </select>
                  )}
                  <button onClick={wlPopulate}
                    style={{ padding:"5px 14px", borderRadius:5, border:"1px solid "+P.ac+"60", background:"transparent", color:P.ac, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                    ⟳ Auto-Fill from Scanner
                  </button>
                  <button onClick={wlPopulateUnusual}
                    style={{ padding:"5px 14px", borderRadius:5, border:"1px solid #c9a84c60", background:"transparent", color:"#c9a84c", fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                    ⟳ Fill from Unusual
                  </button>
                  <button onClick={wlSave}
                    style={{ padding:"5px 14px", borderRadius:5, border:"none", background:P.sw, color:P.bg, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                    💾 Save Watchlist
                  </button>
                  <button onClick={()=>{setWlBull([]);setWlBear([]);setWlRemoved([]);}}
                    style={{ padding:"5px 14px", borderRadius:5, border:"1px solid "+P.be+"40", background:"transparent", color:P.be, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                    🗑 Clear All
                  </button>
                  <div style={{ display:"flex", alignItems:"center", gap:2 }}>
                    <select value={discordLabel} onChange={e=>setDiscordLabel(e.target.value)}
                      style={{ background:P.al, border:"1px solid #5865F222", borderRadius:"5px 0 0 5px", color:P.wh, fontSize:9, padding:"5px 6px", fontFamily:"inherit" }}>
                      {["WATCHLIST","UNUSUAL","MORNING","MIDDAY","CLOSING","WEEKLY","MONTHLY"].map(l=><option key={l} value={l}>{l}</option>)}
                    </select>
                    <select value={discordCount} onChange={e=>setDiscordCount(Number(e.target.value))}
                      style={{ background:P.al, border:"1px solid #5865F222", color:P.wh, fontSize:9, padding:"5px 4px", fontFamily:"inherit" }}>
                      {[5,10,15,20,25].map(n=><option key={n} value={n}>Top {n}</option>)}
                      <option value={99}>All</option>
                    </select>
                    <button onClick={()=>wlPushDiscord("watchlist")} disabled={discordPushing}
                      style={{ padding:"5px 10px", border:"none", background:discordPushing?"#5865F266":"#5865F2", color:"#fff",
                        fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:discordPushing?"not-allowed":"pointer", whiteSpace:"nowrap" }}>
                      {discordPushing ? "…" : "📤 Watchlist"}
                    </button>
                    <button onClick={()=>wlPushDiscord("unusual")} disabled={discordPushing}
                      style={{ padding:"5px 10px", borderRadius:"0 5px 5px 0", border:"none", background:discordPushing?"#c9a84c66":"#c9a84c", color:P.bg,
                        fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:discordPushing?"not-allowed":"pointer", whiteSpace:"nowrap" }}>
                      {discordPushing ? "…" : "⚡ Unusual"}
                    </button>
                  </div>
                  <button onClick={wlFetchOI} disabled={wlOILoading}
                    style={{ padding:"5px 14px", borderRadius:5, border:"1px solid "+(wlOILoading?P.bd:P.ac), background:"transparent",
                      color:wlOILoading?P.dm:P.ac, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:wlOILoading?"not-allowed":"pointer" }}>
                    {wlOILoading?"Fetching…":"📊 Fetch Live OI"}
                  </button>
                  <button onClick={screenshotWatchlist}
                    style={{ padding:"5px 14px", borderRadius:5, border:"1px solid "+P.bl, background:"transparent", color:P.dm, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                    📸 Screenshot
                  </button>
                </div>
                {discordPayload && (
                  <div style={{ marginTop:8, position:"relative" }}>
                    <div style={{ fontSize:9, color:P.ac, marginBottom:3, fontWeight:700 }}>📋 PAYLOAD — Select All (Ctrl+A) → Copy (Ctrl+C) → Paste in discord-push.html</div>
                    <textarea readOnly value={discordPayload} onFocus={e=>e.target.select()}
                      style={{ width:"100%", height:60, background:P.bg, color:P.dm, border:"1px solid "+P.ac, borderRadius:6, padding:8, fontSize:9, fontFamily:"monospace", resize:"none", boxSizing:"border-box" }}/>
                    <button onClick={()=>setDiscordPayload("")} style={{ position:"absolute", top:0, right:0, background:"none", border:"none", color:P.dm, cursor:"pointer", fontSize:10 }}>✕</button>
                  </div>
                )}
              </div>
            </Card>
            {/* DTE + View Filter Bar */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              {[
                {k:"All", label:"All"},
                {k:"1-2W", label:"1–2 Wks"},
                {k:"ST", label:"0–59d"},
                {k:"LT", label:"60–179d"},
                {k:"LEAPS", label:"180+d"},
              ].map(d => {
                const active = wlDteFilter===d.k;
                return (
                  <button key={d.k} onClick={()=>setWlDteFilter(d.k)} style={{
                    padding:"4px 12px", borderRadius:16, border:"1.5px solid "+(active?P.ac:P.bd),
                    cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit",
                    background:active?P.ac+"22":"transparent", color:active?P.ac:P.mt,
                    transition:"all 0.15s"
                  }}>{d.label}</button>
                );
              })}
              </div>
              <div style={{ display:"flex", gap:2, background:P.al, borderRadius:5, padding:2 }}>
                {[["both","Both"],["bull","Bull"],["bear","Bear"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setWlViewFilter(v)} style={{
                    padding:"4px 10px", borderRadius:4, border:"none", cursor:"pointer",
                    fontSize:10, fontWeight:700, fontFamily:"inherit",
                    background:wlViewFilter===v?(v==="bull"?P.bu:v==="bear"?P.be:P.ac)+"22":"transparent",
                    color:wlViewFilter===v?(v==="bull"?P.bu:v==="bear"?P.be:P.ac):P.dm,
                  }}>{label}</button>
                ))}
              </div>
            </div>
            {/* Two-column layout */}
            <div ref={wlRef}>
            {(()=>{
              const getDTE = (item) => {
                if (!item.exp) return -1;
                const parts = item.exp.split("/").map(Number);
                if (parts.length < 2) return -1;
                const y = parts.length >= 3 ? (parts[2] < 100 ? parts[2]+2000 : parts[2]) : new Date().getFullYear();
                const expDate = new Date(y, parts[0]-1, parts[1]);
                return Math.max(0, Math.round((expDate - new Date()) / 86400000));
              };
              const dteOk = (item) => {
                if (wlDteFilter === "All") return true;
                const dte = getDTE(item);
                if (dte < 0) return true;
                if (wlDteFilter === "1-2W") return dte >= 5 && dte <= 14;
                if (wlDteFilter === "ST") return dte < 60;
                if (wlDteFilter === "LT") return dte >= 60 && dte < 180;
                return dte >= 180;
              };
              const filtBull = wlBull.filter(dteOk);
              const filtBear = wlBear.filter(dteOk);
              // Sort indices by score for rendering
              const sortedBullIdx = filtBull.map((_,i)=>i).sort((a,b)=>(filtBull[b].score||0)-(filtBull[a].score||0));
              const sortedBearIdx = filtBear.map((_,i)=>i).sort((a,b)=>(filtBear[b].score||0)-(filtBear[a].score||0));
              // For solo view: split items across 2 columns
              const splitHalf = (sorted) => {
                const mid = Math.ceil(sorted.length / 2); return [sorted.slice(0, mid), sorted.slice(mid)];
              };
              const renderCol = (indices, list, origList, side) => (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {indices.length>0 ? indices.map(i=>renderItem(list[i], origList.indexOf(list[i]), side)) : (
                    <div style={{ textAlign:"center", padding:20, color:P.dm, fontSize:11 }}>No picks in this range.</div>
                  )}
                </div>
              );
              return (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {wlViewFilter==="both" ? (
                <>
                {/* Bull */}
                <Card>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:P.bu, letterSpacing:1 }}>▲ BULL WATCHLIST</div>
                    <span style={{ fontSize:9, color:P.dm }}>{filtBull.length} tickers</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {filtBull.length>0 ? sortedBullIdx.map(i=>renderItem(filtBull[i], wlBull.indexOf(filtBull[i]),"bull")) : (
                      <div style={{ textAlign:"center", padding:20, color:P.dm, fontSize:11 }}>{wlBull.length>0?"No bull picks in this DTE range.":"No bull picks. Click \"Auto-Fill from Scanner\" to populate."}</div>
                    )}
                    <div style={{ display:"flex", gap:4, marginTop:4 }}>
                      <input value={wlAddBull} onChange={e=>setWlAddBull(e.target.value.toUpperCase())}
                        onKeyDown={e=>e.key==="Enter"&&wlAddTicker("bull")}
                        placeholder="Add ticker..."
                        style={{ flex:1, background:P.al, border:"1px solid "+P.bd, borderRadius:4, color:P.wh, fontSize:10, padding:"5px 8px", fontFamily:"inherit" }}/>
                      <button onClick={()=>wlAddTicker("bull")}
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.bu+"22", color:P.bu, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>+ Add</button>
                    </div>
                  </div>
                </Card>
                {/* Bear */}
                <Card>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:P.be, letterSpacing:1 }}>▼ BEAR WATCHLIST</div>
                    <span style={{ fontSize:9, color:P.dm }}>{filtBear.length} tickers</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {filtBear.length>0 ? sortedBearIdx.map(i=>renderItem(filtBear[i], wlBear.indexOf(filtBear[i]),"bear")) : (
                      <div style={{ textAlign:"center", padding:20, color:P.dm, fontSize:11 }}>{wlBear.length>0?"No bear picks in this DTE range.":"No bear picks. Click \"Auto-Fill from Scanner\" to populate."}</div>
                    )}
                    <div style={{ display:"flex", gap:4, marginTop:4 }}>
                      <input value={wlAddBear} onChange={e=>setWlAddBear(e.target.value.toUpperCase())}
                        onKeyDown={e=>e.key==="Enter"&&wlAddTicker("bear")}
                        placeholder="Add ticker..."
                        style={{ flex:1, background:P.al, border:"1px solid "+P.bd, borderRadius:4, color:P.wh, fontSize:10, padding:"5px 8px", fontFamily:"inherit" }}/>
                      <button onClick={()=>wlAddTicker("bear")}
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.be+"22", color:P.be, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>+ Add</button>
                    </div>
                  </div>
                </Card>
                </>
              ) : wlViewFilter==="bull" ? (
                <>
                {(()=>{ const [left,right] = splitHalf(sortedBullIdx); return (<>
                  <Card>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:P.bu, letterSpacing:1 }}>▲ BULL WATCHLIST</div>
                      <span style={{ fontSize:9, color:P.dm }}>{filtBull.length} tickers</span>
                    </div>
                    {renderCol(left, filtBull, wlBull, "bull")}
                  </Card>
                  <Card>
                    <div style={{ marginBottom:8, height:19 }}/>
                    {renderCol(right, filtBull, wlBull, "bull")}
                    <div style={{ display:"flex", gap:4, marginTop:4 }}>
                      <input value={wlAddBull} onChange={e=>setWlAddBull(e.target.value.toUpperCase())}
                        onKeyDown={e=>e.key==="Enter"&&wlAddTicker("bull")}
                        placeholder="Add ticker..."
                        style={{ flex:1, background:P.al, border:"1px solid "+P.bd, borderRadius:4, color:P.wh, fontSize:10, padding:"5px 8px", fontFamily:"inherit" }}/>
                      <button onClick={()=>wlAddTicker("bull")}
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.bu+"22", color:P.bu, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>+ Add</button>
                    </div>
                  </Card>
                </>); })()}
                </>
              ) : (
                <>
                {(()=>{ const [left,right] = splitHalf(sortedBearIdx); return (<>
                  <Card>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:P.be, letterSpacing:1 }}>▼ BEAR WATCHLIST</div>
                      <span style={{ fontSize:9, color:P.dm }}>{filtBear.length} tickers</span>
                    </div>
                    {renderCol(left, filtBear, wlBear, "bear")}
                  </Card>
                  <Card>
                    <div style={{ marginBottom:8, height:19 }}/>
                    {renderCol(right, filtBear, wlBear, "bear")}
                    <div style={{ display:"flex", gap:4, marginTop:4 }}>
                      <input value={wlAddBear} onChange={e=>setWlAddBear(e.target.value.toUpperCase())}
                        onKeyDown={e=>e.key==="Enter"&&wlAddTicker("bear")}
                        placeholder="Add ticker..."
                        style={{ flex:1, background:P.al, border:"1px solid "+P.bd, borderRadius:4, color:P.wh, fontSize:10, padding:"5px 8px", fontFamily:"inherit" }}/>
                      <button onClick={()=>wlAddTicker("bear")}
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.be+"22", color:P.be, fontSize:10, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>+ Add</button>
                    </div>
                  </Card>
                </>); })()}
                </>
              )}
            </div>
              );
            })()}
            </div>
            {/* Scanner Suggestions — overflow picks not yet on watchlist,
                PLUS cross-direction picks for tickers already on the
                opposite-side watchlist. So BE (which lives in bear watchlist)
                can still appear in bull suggestions if it has bullish CALL
                flow that didn't survive the FD.CONV filters. */}
            {FD && FD.CONV && (() => {
              // Direction-aware dedup keys — a ticker on bear watchlist
              // doesn't block its bull-side suggestion (different contract
              // anyway). Same-direction same-contract is still deduped.
              const existingBullSyms = new Set(wlBull.map(i=>i.sym+"|"+i.exp+"|"+i.strike));
              const existingBearSyms = new Set(wlBear.map(i=>i.sym+"|"+i.exp+"|"+i.strike));
              // Track which tickers are already in each list (by symbol only)
              // so we don't double-count when surfacing cross-direction.
              const bullListSyms = new Set(wlBull.map(i=>i.sym));
              const bearListSyms = new Set(wlBear.map(i=>i.sym));
              const dteOkSugg = (c) => {
                if (wlDteFilter === "All") return true;
                const dte = c.DTE || 0;
                if (wlDteFilter === "1-2W") return dte >= 5 && dte <= 14;
                if (wlDteFilter === "ST") return dte < 60;
                if (wlDteFilter === "LT") return dte >= 60 && dte < 180;
                return dte >= 180;
              };
              // 2026-07-04: same ETF/INDEX filter as watchlist bulls/bears -
              // scanner suggestions should honor the current tab.
              const _isStockSugg = (c) => !isETFSymbol(c.sym, c.stocketf);
              const _tabFilterSugg = dataMode === "stocks" ? _isStockSugg : ((c) => !_isStockSugg(c));
              const overflow = FD.CONV.filter(c => {
                if (!dteOkSugg(c)) return false;
                if (!_tabFilterSugg(c)) return false;
                const k = c.sym+"|"+c.exp+"|"+(c.K||c.strike);
                if (c.dir === "BULL" && existingBullSyms.has(k)) return false;
                if (c.dir === "BEAR" && existingBearSyms.has(k)) return false;
                return true;
              })
                .map(c=>({...c, _score:autoScore(c), _cap:wlCapCheck(c)}))
                .sort((a,b)=>b._score-a._score);
              const bullSugg = overflow.filter(c=>c.dir==="BULL").slice(0,15);
              const bearSugg = overflow.filter(c=>c.dir==="BEAR").slice(0,15);

              // ── Cross-direction suggestion fill ──────────────────────
              // For each ticker on bear watchlist that isn't on bull list,
              // try to surface a clean bull pick. Same the other way.
              // Bypasses FD.CONV's DTE>7/clean filters by reading raw
              // FD.all_directional. Marked with _isCrossDir so the row
              // can render a small ⚡ flag to flag manual review.
              const crossPicks = { BULL: [], BEAR: [] };
              if (FD.all_directional) {
                const MIN_C = 100_000;
                const flowBy = {};
                for (const t of FD.all_directional) {
                  // Same field-name fix as wlPopulate flowBy build —
                  // trade objects use UPPERCASE CP and E, not cp/exp.
                  if (!t.S || !t.D || !t.P || !t.CP) continue;
                  if (!flowBy[t.S]) flowBy[t.S] = {};
                  if (!flowBy[t.S][t.D]) flowBy[t.S][t.D] = { totalPrem: 0, contracts: {} };
                  flowBy[t.S][t.D].totalPrem += t.P;
                  const cKey = t.CP + "|" + t.K + "|" + t.E;
                  if (!flowBy[t.S][t.D].contracts[cKey]) {
                    flowBy[t.S][t.D].contracts[cKey] = { cp: t.CP, K: t.K, exp: t.E, hits: 0, askPrem: 0, bidPrem: 0 };
                  }
                  const cc = flowBy[t.S][t.D].contracts[cKey];
                  cc.hits++;
                  if (t.Si === "A" || t.Si === "AA") cc.askPrem += t.P;
                  if (t.Si === "B" || t.Si === "BB") cc.bidPrem += t.P;
                }
                const buildCross = (sym, dir) => {
                  const sideData = flowBy[sym]?.[dir];
                  if (!sideData || sideData.totalPrem < MIN_C) return null;
                  const cleanCp = dir === "BULL" ? "C" : "P";
                  const matching = Object.values(sideData.contracts)
                    .filter(c => c.cp === cleanCp && c.askPrem > c.bidPrem && c.askPrem >= MIN_C)
                    .sort((a,b) => b.askPrem - a.askPrem);
                  if (matching.length === 0) return null;
                  const top = matching[0];
                  const pseudo = { sym, cp: top.cp, K: top.K, exp: top.exp, hits: top.hits,
                    prem: top.askPrem, side: "ASK", askPrem: top.askPrem, bidPrem: top.bidPrem,
                    dir, grade: "C", vol: top.hits, maxOI: 0, volOI: 0, mktcap: 0, er: false };
                  return { ...pseudo, _score: autoScore(pseudo), _cap: wlCapCheck(pseudo),
                    _isCrossDir: true, strike: top.K };
                };
                // Bear watchlist tickers missing from bull → try bull pick
                bearListSyms.forEach(sym => {
                  if (bullListSyms.has(sym)) return;
                  // Skip if same ticker is already in regular bull suggestions
                  if (bullSugg.some(s => s.sym === sym)) return;
                  const p = buildCross(sym, "BULL");
                  if (p) crossPicks.BULL.push(p);
                });
                bullListSyms.forEach(sym => {
                  if (bearListSyms.has(sym)) return;
                  if (bearSugg.some(s => s.sym === sym)) return;
                  const p = buildCross(sym, "BEAR");
                  if (p) crossPicks.BEAR.push(p);
                });
              }
              // Append cross-direction picks at the END so the high-conviction
              // overflow stays on top. Cap each list at 15 total.
              const bullAll = [...bullSugg, ...crossPicks.BULL].slice(0, 15);
              const bearAll = [...bearSugg, ...crossPicks.BEAR].slice(0, 15);

              if (!bullAll.length && !bearAll.length) return null;

              const addFromSugg = (c, side) => {
                const item = {
                  sym:c.sym, score:c._score, autoScore:c._score, tier:"WATCH",
                  strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
                  dir:side==="bull"?"BULL":"BEAR", hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"",
                  cap:c._cap, oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[]
                };
                if (side==="bull") setWlBull(prev=>[...prev,item]);
                else setWlBear(prev=>[...prev,item]);
              };

              const renderSuggRow = (c, side) => (
                <div key={c.sym+c.exp+(c.K||c.strike)} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 14px", background:P.al, borderRadius:4 }}>
                  <button onClick={()=>addFromSugg(c,side)}
                    style={{ padding:"2px 8px", borderRadius:3, border:"none", background:side==="bull"?P.bu+"22":P.be+"22", color:side==="bull"?P.bu:P.be, fontSize:10, fontWeight:800, fontFamily:"inherit", cursor:"pointer" }}>+</button>
                  <span style={{ fontSize:12, fontWeight:800, color:P.wh, minWidth:50 }}>{c.sym}</span>
                  {c._isCrossDir && (
                    <span style={{ fontSize:9, color:"#c9a84c", fontWeight:700, cursor:"help" }}
                      title={"Cross-direction pick. " + c.sym + " is on the opposite-side watchlist " +
                        "but also has clean " + (side==="bull"?"bullish CALL":"bearish PUT") + " flow " +
                        "at ASK. Surfaced for manual triage — didn't qualify for FD.CONV due to DTE<=7 " +
                        "or non-clean direction split."}>⚡</span>
                  )}
                  {c._cap && c._cap!=="Unknown" && <span style={{ fontSize:7, fontWeight:700, color:P.dm, background:P.cd, padding:"1px 4px", borderRadius:2 }}>{c._cap}</span>}
                  <span style={{ fontSize:10, fontWeight:800, color:c._score>=7?P.bu:c._score>=5?"#ff9800":P.ye }}>{Math.round(c._score*10)}%</span>
                  {(c.score||0) > 0 && (
                    <span style={{ fontSize:8, color:P.dm, fontWeight:600, cursor:"help" }}
                      title={`Raw clustering score (dedup ranker): ${Math.round(c.score).toLocaleString()}. Compare to watchlist items' raw scores to see why this didn't make the top-20.`}>
                      [{Math.round(c.score).toLocaleString()}]
                    </span>
                  )}
                  <span style={{ fontSize:10, color:c.cp==="C"?P.bu:P.be }}>{c.cp==="C"?"C":"P"} ${c.K||c.strike} {c.exp}</span>
                  <Tag c={GRADE_COLORS[c.grade]||P.mt}>{c.grade}</Tag>
                  <span style={{ fontSize:9, color:P.dm }}>{c.hits}x · {fmt(c.prem)}</span>
                  <span style={{ fontSize:9, color:P.dm, marginLeft:"auto" }}>{c.side}</span>
                </div>
              );

              return (
                <Card>
                  <div style={{ fontSize:11, fontWeight:800, color:P.ac, letterSpacing:1, marginBottom:8 }}>📋 SCANNER SUGGESTIONS — not yet on watchlist</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div>
                      <div style={{ fontSize:10, fontWeight:700, color:P.bu, marginBottom:4 }}>
                        ▲ Bull ({bullAll.length})
                        {crossPicks.BULL.length > 0 && <span style={{ color:P.dm, fontWeight:400, marginLeft:4 }}>· {crossPicks.BULL.length} cross-dir</span>}
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        {bullAll.map(c=>renderSuggRow(c,"bull"))}
                        {!bullAll.length && <div style={{ fontSize:10, color:P.dm, padding:8 }}>No more bull suggestions</div>}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:10, fontWeight:700, color:P.be, marginBottom:4 }}>
                        ▼ Bear ({bearAll.length})
                        {crossPicks.BEAR.length > 0 && <span style={{ color:P.dm, fontWeight:400, marginLeft:4 }}>· {crossPicks.BEAR.length} cross-dir</span>}
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        {bearAll.map(c=>renderSuggRow(c,"bear"))}
                        {!bearAll.length && <div style={{ fontSize:10, color:P.dm, padding:8 }}>No more bear suggestions</div>}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })()}
            {/* Removed Log */}
            {wlRemoved.length>0 && (
              <Card>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:P.be, letterSpacing:1 }}>✕ REMOVED ({wlRemoved.length})</div>
                  <span style={{ fontSize:9, color:P.dm }}>Saved with watchlist for pattern analysis</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  {wlRemoved.map((r,i)=>(
                    <div key={i} style={{ display:"flex", gap:8, alignItems:"center", padding:"5px 14px", background:P.al, borderRadius:4, opacity:0.7 }}>
                      <span style={{ fontSize:11, fontWeight:800, color:P.dm, minWidth:50 }}>{r.sym}</span>
                      <span style={{ fontSize:9, color:r.cp==="C"?P.bu:P.be }}>{r.cp==="C"?"C":"P"} ${r.strike} {r.exp}</span>
                      <span style={{ fontSize:9, fontWeight:700, color:P.be, background:P.be+"15", padding:"1px 6px", borderRadius:3 }}>{r.removeReason}</span>
                      <span style={{ fontSize:8, color:P.dm, marginLeft:"auto" }}>{r.grade} · {r.hits}x · {fmt(r.prem)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
          );
        })()}

        <div style={{ marginTop:16, padding:"10px 0", borderTop:"1px solid "+P.bd, display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:9, color:P.mt }}>Options Flow Dashboard · {D.dateRange}</span>
        </div>
        </>)}
      </div>
    </div>
  );
}
