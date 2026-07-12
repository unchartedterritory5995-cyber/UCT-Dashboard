import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { BarChart, Bar, AreaChart, Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine } from "recharts";
import StockChart from "../components/StockChart";
import DarkPool from "./DarkPool";
import "./OptionsFlow.mobile.css";  // phone layer — rides on .of-mroot, @media ≤640 only

// ─── Dark Pool overlay helpers ───────────────────────────────────────────────
// Mirror of the logic in DarkPool.jsx so the chart modal can fetch + filter
// + cluster dark pool prints without depending on DarkPool's internal state.
// Keeping these inline rather than exporting from DarkPool.jsx avoids cross-
// component coupling — the chart modal needs its own copy regardless.

// Filter "Cancelled" prints AND the original print they reference, so the
// chart only shows trades that actually settled (matches DarkPool's logic).
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

// Cluster prints within 2% of each other into single zones. See DarkPool.jsx
// for the rationale and full algorithm doc.
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

// ─── Flow Data loaded dynamically from /api/flow/data (SQLite DB) ─────────────


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
// Pattern detection — detects anomalous flow patterns on a cluster
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

function TT({ rows, priceFn, onRowClick, panelFn, fadeOnStale }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const cols = ["Ticker","Day","Exp","Strike","C/P","Dir","Premium","Entry",priceFn?"Now":null,priceFn?"P&L":null,"Vol","OI",priceFn?"Live OI":null,priceFn?"Status":null,"DTE"].filter(Boolean);
  const colCount = cols.length;
  // Today's market date (ET). OI settles overnight, so a trade whose entry is
  // TODAY has no settled OI to compare against yet — its exit status only firms
  // up after tomorrow's OI print. Those rows show PENDING instead of a firm
  // BUILDING/TRIMMED/CLOSED (which could misread on unsettled intraday OI).
  const _nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const _todayStr = (_nowET.getMonth()+1) + "/" + _nowET.getDate() + "/" + _nowET.getFullYear();
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
          // Premium shown is the row's DIRECTIONAL premium (bull dollars on a
          // BULL row, bear on a BEAR row); "—" rows and any row lacking the
          // split fall back to the contract total. Entry price stays computed
          // from the full contract (r.P/r.V) — it's an average price, not a
          // directional dollar figure.
          const dispP = (r.dirPrem != null) ? r.dirPrem : r.P;
          // Net direction (from the bull/bear premium split — see tk.t build)
          // for the Dir tag; falls back to the rep trade's side if absent.
          const dispD = (r.dispD !== undefined) ? r.dispD : r.D;
          const now = px ? (px.mark || px.last || px.mid || 0) : 0;
          const pnl = now > 0 && entry > 0 ? (now - entry) / entry * 100 : 0;
          const pnlC = pnl > 0 ? P.bu : pnl < 0 ? P.be : P.dm;
          const csvOI = r.OI || 0;
          const curOI = px ? px.oi : 0;
          const dOI = curOI > 0 && csvOI > 0 ? curOI - csvOI : 0;
          const dOIC = dOI > 0 ? P.bu : dOI < 0 ? P.be : P.dm;
          const rowKey = r.S+"|"+r.CP+"|"+r.K+"|"+r.E+"|"+i;
          const isExpanded = expandedKey === rowKey;
          // fadeOnStale: subtle fade for rows where live OI is below the
          // snapshot OI — net closing activity since the trade printed. Used
          // by the Search tab to visually de-emphasize stale conviction.
          const isStale = fadeOnStale && dOI < 0;
          // Peak-aware position status. Peak = max OI observed for this contract
          // (entry snapshots + live), so a build-then-cut reads TRIMMED/REDUCED
          // instead of "HELD/BUILDING" off the entry baseline alone — the latter
          // is blind to a position that ballooned then got distributed. PENDING
          // still guards today's entries (OI settles overnight). Bands match the
          // OI Check tab.
          const _baseOI = Math.max(csvOI||0, r.maxOI||0);
          const _peakOI = Math.max(_baseOI, curOI||0);
          const _nowOI = curOI > 0 ? curOI : (csvOI||0);
          // Require a HISTORICAL baseline (entry snapshot or a flow-day peak),
          // not just the live value. A contract with no entry OI (Massive-sourced
          // rows carry no OI field) would otherwise have peak==live==now and
          // falsely read BUILDING — no baseline means we can't judge, so "—".
          const _retention = (priceFn && curOI > 0 && _baseOI > 0) ? _nowOI / _peakOI : null;
          let posLabel = null, posColor = P.dm, posTitle = "";
          const _entryIsToday = (r.Dt || "").trim() === _todayStr;
          if (_entryIsToday && _retention != null) {
            posLabel = "PENDING"; posColor = P.mt;
            posTitle = "Entry is today — OI settles overnight; status confirms after tomorrow's OI print.";
          } else if (_retention != null) {
            const _carried = Math.round(_retention * 100);
            const _pk = _peakOI.toLocaleString();
            if (_retention >= 0.90 && _nowOI >= _peakOI) { posLabel = "BUILDING"; posColor = P.bu; posTitle = "At/near peak OI ("+_pk+") — still on"; }
            else if (_retention >= 0.90) { posLabel = "HELD"; posColor = "#5b9bd5"; posTitle = _carried+"% of peak OI ("+_pk+") still open — held"; }
            else if (_retention >= 0.50) { posLabel = "TRIMMED"; posColor = "#c9a84c"; posTitle = _carried+"% of peak OI ("+_pk+") carried over — partial exit"; }
            else if (_retention >= 0.15) { posLabel = "REDUCED"; posColor = "#e06c3c"; posTitle = _carried+"% of peak OI ("+_pk+") carried over — mostly closed"; }
            else { posLabel = "CLOSED"; posColor = P.be; posTitle = "Down to ~"+_carried+"% of peak OI ("+_pk+") — closed"; }
          }
          return (
            <Fragment key={i}>
            <tr onClick={()=>{ if(onRowClick) onRowClick(r); setExpandedKey(isExpanded ? null : rowKey); }} style={{ borderBottom:"1px solid "+P.bd+"10", background:isExpanded?(P.ac+"12"):(r.Si==="AA"||r.Si==="BB")?(P.ac+"08"):"transparent", textAlign:"center", cursor:"pointer", opacity:isStale?0.55:1 }} title={isStale?"Live OI is below snapshot OI — net closing activity":undefined}>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.S}</td>
              <td style={{ padding:"5px 4px", color:P.dm, fontSize:9 }}>{r.Dt}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>{r.E}</td>
              <td style={{ padding:"5px 4px", fontWeight:800, color:P.wh }}>${r.K}</td>
              <td style={{ padding:"5px 4px" }}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td>
              {/* Dir — direction of the contract's dominant (largest) trade.
                  Makes explicit which rows feed the header's directional
                  Bull/Bear totals: a "—" row is non-directional and is NOT
                  counted in those totals, even though its premium shows here. */}
              <td style={{ padding:"5px 4px" }} title={dispD==="BULL"?"Net bullish — bull premium exceeds bear on this contract; its bull dollars are in Bullish Flow":dispD==="BEAR"?"Net bearish — bear premium exceeds bull; its bear dollars are in Bearish Flow":"Balanced / undirected — bull and bear premium roughly equal on this contract"}>
                {dispD==="BULL" ? <Tag c={P.bu}>BULL</Tag> : dispD==="BEAR" ? <Tag c={P.be}>BEAR</Tag> : <span style={{ color:P.mt, fontWeight:700 }}>—</span>}
              </td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:premC(dispP) }}>{fmt(dispP)}</td>
              <td style={{ padding:"5px 4px", fontWeight:700, color:P.ac }}>{entry>0?"$"+entry.toFixed(2):"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:now>0?P.wh:P.mt }}>{now>0?"$"+now.toFixed(2):"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:pnlC }}>{now>0?(pnl>=0?"+":"")+pnl.toFixed(1)+"%":"—"}</td>}
              <td style={{ padding:"5px 4px", color:P.dm }}>{fK(r.V)}</td>
              <td style={{ padding:"5px 4px", color:P.dm }}>{csvOI>0?csvOI.toLocaleString():"—"}</td>
              {priceFn && <td style={{ padding:"5px 4px", fontWeight:700, color:curOI>0?P.wh:csvOI>0?"#665d3a":P.dm }} title={curOI>0?undefined:csvOI>0?"BBS snapshot (live unavailable)":undefined}>{curOI>0?curOI.toLocaleString():csvOI>0?csvOI.toLocaleString():"—"}</td>}
              {priceFn && <td style={{ padding:"5px 4px" }} title={posTitle}>
                {posLabel
                  ? <span style={{ fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:4, background:posColor+"22", color:posColor, letterSpacing:0.3, whiteSpace:"nowrap" }}>{posLabel}</span>
                  : <span style={{ color:P.mt }}>—</span>}
              </td>}
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
            <tr onClick={()=>{ if(onRowClick) onRowClick(r); setExpandedKey(isExpanded ? null : rowKey); }} style={{ borderBottom:"1px solid "+P.bd+"10", background:isExpanded?(P.ac+"12"):r.H>=5?(P.ac+"08"):"transparent", textAlign:"center", cursor:"pointer" }}>
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
// Tickers frequently misclassified as ETF/INDEX by external data providers
// (Massive's ticker_types, etc.) that ARE regular equities. Whitelisted here
// so they never get filtered from the Stocks tab regardless of upstream tags.
// SPCX: SpaceX-tracking company, trades as regular stock. Add tickers here
// as we discover them being incorrectly dropped from the watchlist.
const STOCK_OVERRIDE_TICKERS = new Set([
  "SPCX",
]);

function isETFSymbol(sym, stocketf) {
  const upper = (sym||"").toUpperCase();
  if (STOCK_OVERRIDE_TICKERS.has(upper)) return false;
  const s = (stocketf||"").toUpperCase();
  if (s === "ETF" || s === "INDEX") return true;
  if (KNOWN_ETF_TICKERS.has(upper)) return true;
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
const THEME_TO_SECTOR = {
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
const TICKER_SECTOR_FALLBACK = {
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
const _TICKER_SECTOR_MAP = (() => {
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

function resolveSector(sym, csvSector) {
  const s = (csvSector||"").trim();
  if (s && s !== "Unknown" && s !== "None") return s;
  return _TICKER_SECTOR_MAP[(sym||"").toUpperCase()] || "Unknown";
}

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
      er:(r.er||"").toUpperCase().trim() === "T",
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

// ─── Main Component ────────────────────────────────────────────────────────────
const TABS = ["Market Read","Top Flow","Leaderboard","Search","OI Check","Tracker","Watchlist"];

export default function OptionsFlowDashboard() {
  const [dataMode, setDataMode] = useState("stocks"); // "stocks" | "index"
  const [tab, setTab] = useState("Market Read");
  // ─── Remote ETF/INDEX ticker list ─────────────────────────────────────────
  // Fetched once from /api/ticker-types/etf-index-symbols on mount. Merges
  // with module-scope KNOWN_ETF_TICKERS to form the effective ETF universe
  // used by all tab filters. Empty initial value means first render falls
  // back to the ~90 hardcoded tickers; once fetch resolves (~200ms), memos
  // that depend on `isETF` recompute and the full ~18k list takes effect.
  // If the fetch fails, we silently keep the hardcoded fallback.
  const [remoteETFSet, setRemoteETFSet] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ticker-types/etf-index-symbols")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data || !Array.isArray(data.symbols)) return;
        const s = new Set();
        for (const sym of data.symbols) s.add(String(sym||"").toUpperCase());
        setRemoteETFSet(s);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Effective ETF check — hardcoded fallback set UNION remote-fetched set.
  // Component-scope so it closes over remoteETFSet and forces memos that
  // depend on it to recompute when the fetch resolves.
  const isETF = useCallback((sym, stocketf) => {
    const upper = (sym||"").toUpperCase();
    // Whitelist wins over ALL other classifications, including Massive's
    // ticker_types remote data and the trade's own stocketf column. Some
    // stocks get misclassified as ETF/INDEX by external data providers
    // (SPCX is a known example — SpaceX-tracking company that trades like
    // a regular equity but was tagged ETF upstream). Without this override,
    // legitimate stock flow gets filtered off the Stocks tab and never
    // reaches scoring or watchlist.
    if (STOCK_OVERRIDE_TICKERS.has(upper)) return false;
    const st = (stocketf||"").toUpperCase();
    if (st === "ETF" || st === "INDEX") return true;
    if (KNOWN_ETF_TICKERS.has(upper)) return true;
    if (remoteETFSet && remoteETFSet.has(upper)) return true;
    return false;
  }, [remoteETFSet]);
  const [top5Filter, setTop5Filter] = useState("Both"); // Both|Calls|Puts
  const [top5Detail, setTop5Detail] = useState(null); // expanded pick sym

  // ─── TradingView Chart modal (Market Read → Top 10 Flow Picks) ──────
  // Click "📈 Chart" on an expanded row to open the underlying ticker in a
  // TradingView widget. Daily / Weekly / Monthly only (per design call).
  const [chartModal, setChartModal] = useState(null);     // { sym: "NVDA" } | null
  const [chartInterval, setChartInterval] = useState("D"); // "D" | "W" | "M"
  // Local search input inside the chart modal — lets the user pivot to a
  // different ticker without closing the modal. Submit on Enter.
  const [chartModalSearch, setChartModalSearch] = useState("");
  // Dark pool overlay toggle — global setting persisted to localStorage so it
  // survives reloads. Applies to the main chart modal (which all ticker-click
  // entry points across tabs feed into). Default ON since dark pool zones are
  // useful context for most trade decisions.
  const [showDarkPool, setShowDarkPool] = useState(() => {
    try {
      const saved = localStorage.getItem("uct_show_darkpool");
      return saved === null ? true : saved === "true";
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("uct_show_darkpool", String(showDarkPool)); } catch {}
  }, [showDarkPool]);
  // Fetches + filters + clusters dark pool prints for the active sym. Returns
  // a stable bars array suitable for the StockChart's darkPoolBars prop, or
  // an empty array when disabled or no data.
  const useDarkPoolBars = (sym, enabled) => {
    const [raw, setRaw] = useState(null);
    useEffect(() => {
      if (!enabled || !sym) { setRaw(null); return; }
      let cancelled = false;
      fetch(`/api/darkpool/ticker-detail?sym=${encodeURIComponent(sym)}&days=180&limit=100`)
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
  // ─── OI-Confirmation state for Search ─────────────────────────────────────
  // Toggle to filter Search bull/bear totals to only trades on contracts
  // whose OI grew in the days after the trade — separating real position
  // adds from same-day churn. Backed by /api/oi/confirmation-map which
  // reads contract_oi_snapshots table.
  const [oiConfirmedOnly, setOiConfirmedOnly] = useState(false);
  const [oiConfirmWindow, setOiConfirmWindow] = useState(5); // days after trade
  const [oiConfirmMap, setOiConfirmMap] = useState({}); // key = "sym|cp|K|exp"
  const [oiConfirmLoading, setOiConfirmLoading] = useState(false);
  const [oiConfirmError, setOiConfirmError] = useState(null);
  const [oiConfirmMeta, setOiConfirmMeta] = useState(null); // { total, confirmed_count, no_snapshots_count }
  const [searchGroup, setSearchGroup] = useState(null);
  const [batchTickers, setBatchTickers] = useState("");
  const [batchResults, setBatchResults] = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchDetail, setBatchDetail] = useState(null); // {sym, trades, contracts, ...}
  const [batchSort, setBatchSort] = useState("net"); // net|bull|bear|bullpct|pnl|ticker|oi
  const [batchSortDir, setBatchSortDir] = useState("desc");
  const [convictionDte, setConvictionDte] = useState("All");
  const [convictionSort, setConvictionSort] = useState("net");
  const [convictionPct, setConvictionPct] = useState("All"); // All, 90bull, 80bull, 90bear, 80bear
  const [convictionActivity, setConvictionActivity] = useState("All"); // All, new, uoa
  const [convictionExpanded, setConvictionExpanded] = useState(null); // expanded ticker // net, bull, bear, trades
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
    if (!FD || !FD.TICKER_DB) return;
    const scored = FD.TICKER_DB.filter(tk => {
      if (tk.b + tk.r <= 0 || tk.s.length > 5) return false;
      if (capFilter !== "All" && capBand(tk.mktcap) !== capFilter) return false;
      return true;
    }).map(tk => {
      const total = tk.b + tk.r;
      const cap = tk.mktcap || 1;
      const capMultiplier = cap >= 200e9 ? 1 : cap >= 10e9 ? 2.5 : 6;
      const adjTotal = total * capMultiplier;
      const tradeDensity = Math.min(tk.n / 10, 3);
      const uoaBonus = tk.uoa ? 1.3 : 1;
      const score = adjTotal * tradeDensity * uoaBonus;
      return { sym: tk.s, score, total, bull: tk.b, bear: tk.r };
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
      const resp = await fetch(`/api/schwab/ytd-performance?symbols=${leaders.join(",")}`);
      if (resp.ok) {
        const data = await resp.json();
        setLeaderYtd(data.ytd || {});
        setLeaderOff52(data.off52 || {});
        // Also fetch OI changes
        try {
          const oiResp = await fetch(`/api/schwab/oi-change-batch?symbols=${leaders.join(",")}`);
          if (oiResp.ok) { const oiData = await oiResp.json(); setLeaderOI(oiData.oi_changes || {}); }
        } catch {}
      }
    } catch {}
    setLeaderYtdLoading(false);
  };
  const [tfDteFilter, setTfDteFilter] = useState("All");
  // Top Flow column sort. Default "score" = current behavior (conviction-ranked).
  // # column always shows score-rank regardless of active sort so the "Top 20"
  // curation stays intuitive — sorting by another column re-orders the rows
  // but each one keeps its #N badge from the score ranking.
  const [tfSort, setTfSort] = useState({ col: "score", dir: "desc" });
  const [gexTicker, setGexTicker] = useState("SPY");
  const [gexInput, setGexInput] = useState("SPY");
  const [gexData, setGexData] = useState(null);
  const [gexLoading, setGexLoading] = useState(false);
  const [gexDte, setGexDte] = useState("all");
  const [showGexSummary, setShowGexSummary] = useState(false);
  const [showGexChart, setShowGexChart] = useState(false);
  const [gexChartTf, setGexChartTf] = useState('D');
  const [ideaGex, setIdeaGex] = useState(null); // { sym, data, loading } for Ideas popup
  const [ideaGexRange, setIdeaGexRange] = useState("3mo");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [selectedConv, setSelectedConv] = useState(null); // clicked Top Flow card index
  const [selectedItem, setSelectedItem] = useState(null); // {sym,cp,K,exp} clicked from any table/chart
  // Dark pool bars for the contract detail panel (renderDetailPanel below) —
  // opens when you click a ticker/contract in Top Flow, Search, or any other
  // tab. Separate fetch from chartModal since they can be open simultaneously
  // for different tickers.
  const selectedDetailDarkPoolBars = useDarkPoolBars(selectedItem?.sym, showDarkPool && !!selectedItem);
  const [contractChartTf, setContractChartTf] = useState('D');
  useEffect(() => { setContractChartTf('D'); }, [selectedItem?.sym, selectedItem?.cp, selectedItem?.K, selectedItem?.exp]);
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
  const ideaGexModalRef = useRef(null);
  const ideaGexDragRef = useRef({ dragging:false, startX:0, startY:0, offX:0, offY:0 });
  const prevNetDeltaRef = useRef(null);

  // ─── Dynamic CSV Loading ─────────────────────────────────────────────
  const [csvText, setCsvText] = useState(null);
  const [csvLoading, setCsvLoading] = useState(true);
  const [csvError, setCsvError] = useState(null);
  const [parsedRows, setParsedRows] = useState(null);
  // Tracks which fetchDays value the current parsedRows represents. Used to
  // skip the processing effect when a new fetch is in flight that will deliver
  // different data — avoids 1-4s of wasted processFlowData on every range
  // expansion (Last5 → Last20, Last60 → All, etc).
  const [loadedFetchDays, setLoadedFetchDays] = useState(null);
  const [dateFilter, setDateFilter] = useState("Last1");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fetchDays, setFetchDays] = useState(1);
  const [showCal, setShowCal] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calStart, setCalStart] = useState(null); // temp start during selection
  const calRef = useRef(null);
  const [D, setD] = useState(null);

  const [dataVersion, setDataVersion] = useState(null);

// Fetch DB version on mount + when tab regains focus (so a fresh upload in
  // another tab is picked up immediately). Version is the row count; when it
  // changes, the csvFile URL changes, useEffect re-runs, fresh data arrives.
  //
  // Auto-refresh: also poll every 60s during market hours. The version probe
  // is cheap (~50ms, returns a single number); only triggers a full CSV
  // refetch when the DB actually has new rows, so no wasted bandwidth when
  // nothing's changing. Skipped when tab is hidden (saves CPU + bandwidth)
  // and outside 9:30 AM – 4:15 PM ET weekdays (data doesn't change overnight).
  useEffect(() => {
    const fetchVer = () => {
      fetch("/api/flow/version", { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && d.version != null) setDataVersion(String(d.version)); })
        .catch(() => {});
    };
    fetchVer();
    const onFocus = () => fetchVer();
    window.addEventListener("focus", onFocus);

    // Periodic polling during market hours, visible tabs only
    const intervalId = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Market hours gate: 9:30 AM – 4:15 PM ET, Mon-Fri.
      // Add a 15-min after-close grace window so late prints still surface.
      const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = nowET.getDay();
      if (day === 0 || day === 6) return;  // Sat/Sun
      const mins = nowET.getHours() * 60 + nowET.getMinutes();
      if (mins < 9 * 60 + 30 || mins > 16 * 60 + 15) return;  // outside window
      fetchVer();
    }, 60_000);

    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(intervalId);
    };
  }, []);

  // Cache-busting version param — fetched from /api/flow/version on mount &
  // on tab focus. When new data is uploaded, version bumps and Cloudflare
  // sees a new URL, busting the stale cache entry.
  // Full-range URL is version-STABLE: on a data bump we splice in ONLY today's
  // trades (see the delta-merge effect below) rather than reloading the whole
  // range. So the base range can be Cloudflare-cached and a version bump never
  // triggers a full refetch — which is what reloaded 100k+ trades on every bump
  // and crashed 60-day tabs with Out-of-Memory. dataVersion still drives the
  // delta below, so it's not orphaned.
  const csvFile = dataMode === "index"
    ? (fetchDays === 0 ? "/api/flow/indexes-data?all_data=true" : `/api/flow/indexes-data?days=${fetchDays}`)
    : (fetchDays === 0 ? "/api/flow/data?all_data=true" : `/api/flow/data?days=${fetchDays}`);

  // Extract unique dates from parsed rows
  const availableDates = useMemo(() => {
    if (!parsedRows || parsedRows.length === 0) return [];
    const dateSet = new Set();
    parsedRows.forEach(r => { if (r.date) dateSet.add(r.date.trim()); });
    // Sort dates chronologically
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

  // Format date for pill label: "Mon 4/21"
  const fmtDatePill = (dateStr) => {
    const parts = dateStr.split("/").map(Number);
    const y = parts.length >= 3 ? (parts[2] < 100 ? parts[2] + 2000 : parts[2]) : new Date().getFullYear();
    const d = new Date(y, parts[0] - 1, parts[1] || 1);
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return days[d.getDay()] + " " + parts[0] + "/" + (parts[1] || 1);
  };

  // Convert M/D/YYYY → YYYY-MM-DD for date input
  const mdyToIso = (mdy) => {
    const p = mdy.split("/").map(Number);
    if (p.length < 3) return "";
    const y = p[2] < 100 ? p[2] + 2000 : p[2];
    return `${y}-${String(p[0]).padStart(2,"0")}-${String(p[1]).padStart(2,"0")}`;
  };
  // Convert YYYY-MM-DD → Date object for comparison
  const isoToDate = (iso) => { const p = iso.split("-").map(Number); return new Date(p[0], p[1]-1, p[2]); };
  // Convert M/D/YYYY → Date object for comparison
  const mdyToDate = (mdy) => { const p = mdy.split("/").map(Number); const y = p.length>=3?(p[2]<100?p[2]+2000:p[2]):new Date().getFullYear(); return new Date(y, p[0]-1, p[1]||1); };

  // Date range boundaries from available dates
  const dateInputMin = availableDates.length > 0 ? mdyToIso(availableDates[0]) : "";
  const dateInputMax = availableDates.length > 0 ? mdyToIso(availableDates[availableDates.length-1]) : "";

  // Close calendar on click outside
  useEffect(() => {
    if (!showCal) return;
    const handler = (e) => { if (calRef.current && !calRef.current.contains(e.target)) setShowCal(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCal]);

  // Set of available trading dates as ISO for calendar dot indicators
  const tradingDaysSet = useMemo(() => new Set(availableDates.map(d => mdyToIso(d))), [availableDates]);

  // Auto-set dateFilter when data loads
  useEffect(() => {
    if (availableDates.length > 0 && dateFilter !== "All" && !dateFilter.startsWith("Last") && !availableDates.includes(dateFilter)) {
      setDateFilter("All");
    }
  }, [availableDates]);

  // Process data whenever parsedRows or dateFilter or date range changes
  useEffect(() => {
    if (!parsedRows || parsedRows.length === 0) return;
    // Skip processing if a fetch is in-flight that will replace parsedRows.
    // This is the key perf fix — eliminates wasted intermediate processFlowData
    // runs when user expands the range (e.g. Last5 → Last20 → Last60 → All).
    // When the fetch completes, loadedFetchDays catches up to fetchDays and
    // processing fires once with the fresh data.
    if (loadedFetchDays !== fetchDays) return;
    const t2 = performance.now();
    let filtered;
    if (dateFrom && dateTo) {
      // Date range mode
      const from = isoToDate(dateFrom);
      const to = isoToDate(dateTo);
      to.setHours(23,59,59); // include end date fully
      filtered = parsedRows.filter(r => {
        if (!r.date) return false;
        const d = mdyToDate(r.date.trim());
        return d >= from && d <= to;
      });
    } else if (dateFilter === "All") {
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
      const label = dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFilter;
      console.log(`[perf] processFlowData (${label}): ${(performance.now()-t2).toFixed(0)}ms (${filtered.length} rows)`);
      setD(data);
    } catch(err) {
      console.error("processFlowData error:", err);
      setCsvError(err.message);
    }
  }, [parsedRows, dateFilter, dateFrom, dateTo, loadedFetchDays, fetchDays]);

  useEffect(() => {
    // Fetch on mount and whenever csvFile changes (range/mode). csvFile is now
    // version-STABLE (today's freshness comes from the delta-merge effect), so
    // there's no version in the URL to wait for — fetch immediately. (Previously
    // this waited for dataVersion because the version lived in csvFile; keeping
    // that guard after making csvFile version-stable stalled the initial load.)

    // Capture fetchDays at fetch initiation so we know what range this fetch
    // represents — even if user clicks a different range mid-fetch.
    const fetchDaysAtStart = fetchDays;
    let cancelled = false;
    setCsvLoading(true);
    setCsvError(null);
    setSelectedConv(null);
    setSelectedItem(null);
    setSelectedTicker(null);
    setSearch("");
    setOiSearch("");
    setCapFilter("All");
    // 7/9: Preserve current tab across data refetches. This effect fires
    // whenever csvFile changes, which includes background dataVersion bumps
    // (e.g. after gap-fill or nightly rebuild). Resetting the tab bounced
    // users off Watchlist mid-workflow. Tab reset now only happens on
    // explicit user actions (range change, mode change) via the reset
    // handlers that own those actions.
    const t0 = performance.now();

    fetch(csvFile)  // versioned via &v= from /api/flow/version — see useEffect above; CF can cache safely
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
              if (!cancelled) { setParsedRows(rows); setLoadedFetchDays(fetchDaysAtStart); setCsvLoading(false); }
            } catch(err) {
              if (!cancelled) { setCsvError(err.message); setCsvLoading(false); setLoadedFetchDays(fetchDaysAtStart); }
            }
          }, 0);
        })
        .catch(err => { if (!cancelled) { setCsvError(err.message); setCsvLoading(false); setLoadedFetchDays(fetchDaysAtStart); } });
    return () => { cancelled = true; };
  }, [csvFile]);

  // ─── Incremental live update (today-delta merge) ─────────────────────────
  // When the DB version bumps during the session, refetch ONLY today's trades
  // (days=1, a few thousand rows) and splice them into the loaded dataset —
  // replacing the existing rows for today's date(s). Keeps every range (incl.
  // 60d/All) live during the trading day WITHOUT reloading the whole range,
  // which reloaded 100k+ trades on each bump and OOM-crashed the tab (and made
  // a screenshot's focus-refetch fatal). The base range URL is version-stable
  // and Cloudflare-cached; today's freshness comes from this small delta.
  const _lastMergedVer = useRef(null);
  useEffect(() => {
    if (dataVersion == null) return;
    if (_lastMergedVer.current === dataVersion) return;
    if (dataMode === "gex" || dataMode === "darkpool") return;  // non-flow views
    let cancelled = false;
    const url = dataMode === "index"
      ? `/api/flow/indexes-data?days=1&v=${dataVersion}`
      : `/api/flow/data?days=1&v=${dataVersion}`;
    fetch(url, { cache: "no-store" })
      .then(r => r.ok ? r.text() : null)
      .then(text => {
        if (cancelled || !text || text.trim().startsWith("<")) return;
        const todayRows = parseCSV(text);
        if (!todayRows || !todayRows.length) return;
        const todayDates = new Set(
          todayRows.map(r => (r.date || "").trim()).filter(Boolean)
        );
        if (!todayDates.size) return;
        setParsedRows(prev => {
          if (!prev || !prev.length) return prev;  // base not loaded yet — skip
          _lastMergedVer.current = dataVersion;
          const base = prev.filter(r => !todayDates.has((r.date || "").trim()));
          return base.concat(todayRows);
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dataVersion, dataMode]);


  // Cap-filtered view: recompute charts using only the selected cap band's
  // clean_confirmed. Also honors the current tab (Stocks vs Indexes) so that
  // SECTORS/THEMES/SBLC-etc bins on Market Read exclude the wrong universe.
  const FD = useMemo(() => {
    if (!D) return null;
    const needsTabFilter = dataMode === "stocks" || dataMode === "index";
    if (capFilter === "All" && !needsTabFilter) return D;
    let cc = D.clean_confirmed;
    if (needsTabFilter) {
      cc = cc.filter(t => {
        const isEtf = isETF(t.S, t.stocketf);
        return dataMode === "stocks" ? !isEtf : isEtf;
      });
    }
    if (capFilter !== "All") cc = filterByCap(cc, capFilter);
    const charts = buildCharts(cc);
    return { ...D, ...charts };
  }, [D, capFilter, dataMode, isETF]);

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
  const [wlViewFilter, setWlViewFilter] = useState("both");
  const [wlDate, setWlDate] = useState(new Date().toISOString().slice(0,10));
  const [wlDates, setWlDates] = useState([]);
  const [wlEditing, setWlEditing] = useState(null);
  const [wlLoaded, setWlLoaded] = useState(false);
  const [wlCapPref, setWlCapPref] = useState("No Mega"); // All | No Mega | Mid+Small
  const [wlAddBull, setWlAddBull] = useState("");
  const [wlAddBear, setWlAddBear] = useState("");
  const [wlRemoving, setWlRemoving] = useState(null);
  const [wlRemoveReason, setWlRemoveReason] = useState("");
  const [wlRemoved, setWlRemoved] = useState([]);
  const [wlOILoading, setWlOILoading] = useState(false);
  const wlRef = useRef(null);
  const wlBullRef = useRef(null);
  const wlBearRef = useRef(null);
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

  const screenshotPushDiscord = async () => {
    setDiscordImgPushing(true);
    try {
      let h2c = window.html2canvas;
      if (!h2c) {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        document.head.appendChild(s);
        await new Promise(r => { s.onload = r; s.onerror = () => r(); });
        h2c = window.html2canvas;
      }
      if (!h2c) { setStatus("❌ Could not load screenshot library"); setDiscordImgPushing(false); return; }

      const dateRange = FD ? FD.dateRange || "" : "";
      const results = [];

      // Capture Bull
      const bullEl = wlBullRef.current;
      if (bullEl) {
        const canvas = await h2c(bullEl, { backgroundColor: P.bg, scale: 2, useCORS: true });
        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        if (blob) {
          const fd = new FormData();
          fd.append("file", blob, `UCT_Bull_Watchlist_${wlDate}.png`);
          fd.append("label", `${discordLabel} — BULL`);
          fd.append("date_range", dateRange);
          const resp = await fetch("/api/discord/push-image", { method: "POST", body: fd });
          const data = await resp.json();
          results.push({ side: "Bull", ok: data.ok, kb: data.size_kb, error: data.error });
        }
      }

      // Small delay to avoid Discord rate limit
      await new Promise(r => setTimeout(r, 600));

      // Capture Bear
      const bearEl = wlBearRef.current;
      if (bearEl) {
        const canvas = await h2c(bearEl, { backgroundColor: P.bg, scale: 2, useCORS: true });
        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        if (blob) {
          const fd = new FormData();
          fd.append("file", blob, `UCT_Bear_Watchlist_${wlDate}.png`);
          fd.append("label", `${discordLabel} — BEAR`);
          fd.append("date_range", dateRange);
          const resp = await fetch("/api/discord/push-image", { method: "POST", body: fd });
          const data = await resp.json();
          results.push({ side: "Bear", ok: data.ok, kb: data.size_kb, error: data.error });
        }
      }

      if (!results.length) {
        setStatus("⚠️ No watchlist sections to capture");
      } else {
        const ok = results.filter(r => r.ok);
        const fail = results.filter(r => !r.ok);
        if (ok.length && !fail.length) {
          const totalKB = ok.reduce((s, r) => s + (r.kb || 0), 0);
          setStatus(`📸 ${ok.map(r => r.side).join(" + ")} pushed to Discord (${totalKB}KB)`);
        } else if (fail.length) {
          setStatus(`❌ Failed: ${fail.map(r => r.side + ": " + r.error).join(", ")}`);
        }
      }
    } catch (e) {
      setStatus(`❌ Discord screenshot error: ${e.message}`);
    }
    setDiscordImgPushing(false);
    setTimeout(() => setStatus(""), 4000);
  };

  const wlFetchOI = async () => {
    const all = [...wlBull, ...wlBear];
    if (!all.length) return;
    setWlOILoading(true);
    const contracts = all.map(i=>({sym:i.sym, cp:i.cp, strike:i.strike, exp:i.exp}));
    try {
      await fetchPrices(contracts);
      // After prices fetched, update liveOI from priceMap
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
    // ── Time-concentration bonus ─────────────────────────────────────────
    // Multiple ASK sweeps bunched into a short window signal institutional
    // urgency — different from hits-count alone. SPCX 165c 12/17/27 pattern
    // (5 whale sweeps in 8 min on a LEAPS strike) is qualitatively distinct
    // from BE-style flow spread over 90 min at similar hit count. Precomputed
    // at cluster-build time as _timeConc = max # of ASK SWEEPs in any 10-min
    // window on this contract. DTE >= 3 gate — 0-2 DTE clusters showing this
    // pattern are dealer hedging, not directional (TSLA/SPY 0DTE puts).
    if ((c.DTE || 0) >= 3) {
      if ((c._timeConc||0) >= 5) s += 1.0;
      else if ((c._timeConc||0) >= 3) s += 0.5;
    }
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
    // Try 2: dateMap from clean_confirmed
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

  // Build ticker → earliest date map from clean_confirmed (always has Dt)
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
    // Source 1: clean_confirmed
    if (D && D.clean_confirmed) {
      D.clean_confirmed.forEach(t => _addTrade(t.S, t.Dt, t.Spot));
    }
    // Source 2: all_directional (broader — includes non-confirmed)
    if (D && D.all_directional) {
      D.all_directional.forEach(t => _addTrade(t.S, t.Dt, t.Spot));
    }
    // Source 3: CONV trades (in case sources 1-2 miss some)
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
    // Deduplicate by ticker — take highest-scoring contract per ticker
    // Also apply EXIT penalty so watchlist matches Top Flow ranking
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
    // 2026-07-03: exclude ETFs/INDEXes when in Stocks tab. Watchlist should
    // reflect the same universe as the tab -- SPY/QQQ/SMH etc. belong on the
    // Indexes tab.
    //
    // Two-layer detection via component-scope isETF():
    //  1. stocketf === "ETF" or "INDEX" (from BBS CSV metadata)
    //  2. Ticker in KNOWN_ETF_TICKERS (fallback for Massive rows where
    //     stocketf is empty because the live worker doesn't populate it)
    const isStock = (c) => !isETF(c.sym, c.stocketf);
    const wlTabFilter = dataMode === "stocks" ? isStock : ((c) => !isStock(c));
    // 7/9: Respect CAP FILTER when auto-populating Watchlist. Previously
    // wlPopulate picked top 20 conviction picks across ALL caps and just
    // labeled each with its cap band — so clicking Mid-Small then Auto-Fill
    // still filled with AAPL/META/etc. Uses wlCapCheck which falls back to
    // capLookup for tickers with mktcap=0 (gap-fill rows).
    const capFilterOk = c => capFilter === "All" || wlCapCheck(c) === capFilter;
    const bulls = dedup(FD.CONV.filter(c=>c.dir==="BULL" && wlTabFilter(c) && capFilterOk(c))).slice(0,20).map(c=>{
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
    const bears = dedup(FD.CONV.filter(c=>c.dir==="BEAR" && wlTabFilter(c) && capFilterOk(c))).slice(0,20).map(c=>{
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

    // ── Fallback fill — cross-direction + heavy ASK-dominant ─────────────
    // After the primary bull/bear lists are built from FD.CONV, two more
    // passes find picks that didn't make CONV but are real signals:
    //   1. Cross-direction — for tickers already on the OPPOSITE list,
    //      surface their strongest CLEAN ASK position in the other direction
    //      (BTO call at ASK for bull list; BTO put at ASK for bear list).
    //      Catches cases like BE where bullish CALL flow exists but got
    //      filtered out of CONV by DTE<=7 or cluster-cleanliness rules.
    //   2. Dirty-dominant — for tickers on NEITHER list, surface heavily
    //      ASK-dominant clusters that CONV flagged dirty due to bid-side
    //      noise but where 80%+ of premium is ASK side. Catches the SERV
    //      pattern: 60+ ASK sweeps with ~13% bid-side noise on DTE > 14.
    setTimeout(() => {
      if (!FD.all_directional) {
        console.warn("[wlPopulate] No FD.all_directional — fallback pass skipped entirely");
        return;
      }
      console.log("[wlPopulate] Fallback pass start. FD.all_directional length:", FD.all_directional.length,
        "| existing bulls:", bulls.length, "| existing bears:", bears.length);
      const MIN_CONTRACT_PREMIUM = 100_000;
      const MIN_TOTAL_DIRECTIONAL = 100_000;

      // Build flowBy: per-ticker, per-direction, per-contract aggregate.
      // CRITICAL: trade objects use UPPERCASE field names (t.CP, t.E) per
      // processFlowData — earlier iterations used t.cp/t.exp (lowercase)
      // which made flowBy always empty and silently broke every fallback.
      // The single-letter "C"/"P" filter downstream matches t.CP's format.
      const flowBy = {};
      for (const t of FD.all_directional) {
        if (!t.S || !t.D || !t.P || !t.CP) continue;
        if (!flowBy[t.S]) flowBy[t.S] = { BULL: null, BEAR: null, mktcap: t.mktcap || 0, stocketf: t.stocketf };
        if (t.mktcap && t.mktcap > flowBy[t.S].mktcap) flowBy[t.S].mktcap = t.mktcap;
        if (!flowBy[t.S].stocketf && t.stocketf) flowBy[t.S].stocketf = t.stocketf;
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
      console.log("[wlPopulate] flowBy built:", Object.keys(flowBy).length, "tickers");

      // Cross-direction fallback: opposite-direction clean ASK signal
      const buildFallback = (sym, dir) => {
        const sideData = flowBy[sym]?.[dir];
        if (!sideData) return null;
        if (sideData.totalPrem < MIN_TOTAL_DIRECTIONAL) return null;
        const cleanCp = dir === "BULL" ? "C" : "P";
        const allContracts = Object.values(sideData.contracts);
        // Block-only clusters = institutional repositioning, not directional. Skip.
        const withSweep = allContracts.filter(c => c.hasSweep);
        const cpMatching = withSweep.filter(c => c.cp === cleanCp);
        const askDominant = cpMatching.filter(c => c.askPrem > c.bidPrem);
        const qualifying = askDominant.filter(c => c.askPrem >= MIN_CONTRACT_PREMIUM);
        if (qualifying.length === 0) return null;
        const top = qualifying.sort((a, b) => b.askPrem - a.askPrem)[0];
        const mc = flowBy[sym].mktcap || 0;
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
          notes: "",
          cap: wlCapCheck({ sym, prem: top.askPrem, mktcap: mc }) || "Mid-Small",
          oi: top.maxOI || 0, volume: top.vol || 0, volOI: volOIRatio,
          liveOI: 0, liveOIDelta: 0, actionLog: [],
          firstDate: "", entrySpot: 0, latestSpot: 0,
          convScore: 0, rankScore: 0, isExit: false,
          _isFallback: true,
        };
      };

      // Dirty-dominant fallback: heavy ASK-dominant for tickers on NEITHER list
      const buildDirtyDominantFallback = (sym, dir) => {
        const sideData = flowBy[sym]?.[dir];
        if (!sideData) return null;
        const mc = flowBy[sym].mktcap || 0;
        const capName = capBand(mc);
        const minTotalFlow = capName === "Mega" ? 1e6 : capName === "Large" ? 750e3 : 500e3;
        if (sideData.totalPrem < minTotalFlow) return null;
        const cleanCp = dir === "BULL" ? "C" : "P";
        const allContracts = Object.values(sideData.contracts);
        // Block-only clusters = institutional repositioning, not directional. Skip.
        const withSweep = allContracts.filter(c => c.hasSweep);
        const cpMatching = withSweep.filter(c => c.cp === cleanCp);
        const dominant = cpMatching.filter(c => {
          const tot = c.askPrem + c.bidPrem;
          if (tot <= 0) return false;
          return c.askPrem / tot >= 0.80 && c.askPrem >= 250e3;
        });
        if (dominant.length === 0) return null;
        const top = dominant.sort((a, b) => b.askPrem - a.askPrem)[0];
        let grade = "C";
        if (top.askPrem >= 250e3) grade = "B";
        if (top.askPrem >= 1e6) grade = "B+";
        if (top.askPrem >= 3e6) grade = "A";
        if (top.askPrem >= 5e6) grade = "A+";
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
          notes: "",
          cap: wlCapCheck({ sym, prem: top.askPrem, mktcap: mc }) || "Mid-Small",
          oi: top.maxOI || 0, volume: top.vol || 0, volOI: volOIRatio,
          liveOI: 0, liveOIDelta: 0, actionLog: [],
          firstDate: "", entrySpot: 0, latestSpot: 0,
          convScore: 0, rankScore: 0, isExit: false,
          _isFallback: true, _isDirtyDominant: true,
        };
      };

      const bullSyms = new Set(bulls.map(b => b.sym));
      const bearSyms = new Set(bears.map(b => b.sym));
      const fallbackBulls = [];
      const fallbackBears = [];

      // 2026-07-03: same ETF/INDEX filter as initial cut - fallback picks
      // should honor the current tab. Uses component-scope isETF()
      // which checks both stocketf CSV metadata and KNOWN_ETF_TICKERS.
      const _symIsStock = (sym) => !isETF(sym, flowBy[sym]?.stocketf);
      const _fallbackTabFilter = dataMode === "stocks" ? _symIsStock : ((s) => !_symIsStock(s));
      // 7/9: Same capFilter check for the fallback passes. Without this, the
      // fallback silently adds Mega/Large tickers back into a Mid-Small
      // watchlist after the primary pass filtered them out. Uses wlCapCheck
      // (falls back to capLookup for tickers with mktcap=0).
      const _fallbackCapFilter = (sym) => {
        if (capFilter === "All") return true;
        const mc = flowBy[sym]?.mktcap || 0;
        return wlCapCheck({ sym, mktcap: mc }) === capFilter;
      };

      // Pass 1+2: cross-direction
      bears.forEach(b => {
        if (bullSyms.has(b.sym)) return;
        if (!_fallbackTabFilter(b.sym)) return;
        if (!_fallbackCapFilter(b.sym)) return;
        const fb = buildFallback(b.sym, "BULL");
        if (fb) fallbackBulls.push(fb);
      });
      bulls.forEach(b => {
        if (bearSyms.has(b.sym)) return;
        if (!_fallbackTabFilter(b.sym)) return;
        if (!_fallbackCapFilter(b.sym)) return;
        const fb = buildFallback(b.sym, "BEAR");
        if (fb) fallbackBears.push(fb);
      });

      // Pass 3: dirty-dominant — tickers on NEITHER list with heavy ASK conviction
      const crossFallbackBullSyms = new Set(fallbackBulls.map(f => f.sym));
      const crossFallbackBearSyms = new Set(fallbackBears.map(f => f.sym));
      Object.keys(flowBy).forEach(sym => {
        if (bullSyms.has(sym) || bearSyms.has(sym)) return;
        if (crossFallbackBullSyms.has(sym) || crossFallbackBearSyms.has(sym)) return;
        if (!_fallbackTabFilter(sym)) return;
        if (!_fallbackCapFilter(sym)) return;
        const bullTotal = flowBy[sym].BULL?.totalPrem || 0;
        const bearTotal = flowBy[sym].BEAR?.totalPrem || 0;
        if (bullTotal >= bearTotal && bullTotal > 0) {
          const fb = buildDirtyDominantFallback(sym, "BULL");
          if (fb) fallbackBulls.push(fb);
        } else if (bearTotal > 0) {
          const fb = buildDirtyDominantFallback(sym, "BEAR");
          if (fb) fallbackBears.push(fb);
        }
      });

      console.log("[wlPopulate] Fallback pass complete. Cross-direction:",
        fallbackBulls.filter(f=>!f._isDirtyDominant).length, "bull /",
        fallbackBears.filter(f=>!f._isDirtyDominant).length, "bear. Dirty-dominant:",
        fallbackBulls.filter(f=>f._isDirtyDominant).length, "bull /",
        fallbackBears.filter(f=>f._isDirtyDominant).length, "bear.");

      // Merge with existing, dedup by sym, sort by score, truncate to 20
      if (fallbackBulls.length > 0) {
        setWlBull(prev => {
          const merged = [...prev, ...fallbackBulls];
          const seen = new Set();
          const unique = merged.filter(x => { if (seen.has(x.sym)) return false; seen.add(x.sym); return true; });
          return unique.sort((a,b)=>(b.score||0)-(a.score||0)).slice(0, 20);
        });
      }
      if (fallbackBears.length > 0) {
        setWlBear(prev => {
          const merged = [...prev, ...fallbackBears];
          const seen = new Set();
          const unique = merged.filter(x => { if (seen.has(x.sym)) return false; seen.add(x.sym); return true; });
          return unique.sort((a,b)=>(b.score||0)-(a.score||0)).slice(0, 20);
        });
      }
    }, 0);
  };

  const wlPopulateUnusual = () => {
    if (!FD || !FD.CONV) return;
    const dateMap = _buildDateMap();
    // Build unusual items same way as Unusual tab
    const unusual = [];
    (FD.CONV||[]).forEach(c => { (c.patterns||[]).forEach(p => { unusual.push({ ...c, anomaly:p.type, source:"pattern" }); }); });
    (FD.CONV||[]).forEach(c => { if (c.volOI >= 10 && c.maxOI > 0 && c.maxOI < 500) unusual.push({ ...c, anomaly:"VOL_OI_EXTREME", source:"voloi" }); });
    (FD.CONV||[]).forEach(c => {
      const cap = capBand(c.mktcap);
      const thresh = cap==="Mid-Small"?500e3:0;
      if (thresh > 0 && c.prem >= thresh) unusual.push({ ...c, anomaly:"SIZE_VS_CAP", source:"sizecap" });
    });
    // Dedup by contract
    const seen = new Set();
    const deduped = unusual.filter(u => { const k = u.sym+"|"+u.cp+"|"+u.K+"|"+u.exp; if (seen.has(k)) return false; seen.add(k); return true; });
    // Dedup by ticker — highest premium per ticker
    const sorted = deduped.sort((a,b) => b.prem - a.prem);
    const tickerSeen = new Set();
    const uniqueTicker = (list) => list.filter(c => { if (tickerSeen.has(c.sym+"|"+c.dir)) return false; tickerSeen.add(c.sym+"|"+c.dir); return true; });
    const bulls = uniqueTicker(sorted.filter(c=>c.dir==="BULL")).slice(0,20).map(c=>{
      const ds = _extractDateSpot(c, dateMap);
      return {
        sym:c.sym, score:autoScore(c), autoScore:autoScore(c), tier:"WATCH",
        strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
        dir:"BULL", hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"[UOA]",
        cap:wlCapCheck(c), oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[],
        firstDate:ds.firstDate, entrySpot:ds.entrySpot, latestSpot:ds.latestSpot,
        // Raw clustering score (unusual path doesn't apply EXIT penalty — sorted by premium)
        convScore: c.score||0, rankScore: c.score||0, isExit: false
      };
    });
    const bears = uniqueTicker(sorted.filter(c=>c.dir==="BEAR")).slice(0,20).map(c=>{
      const ds = _extractDateSpot(c, dateMap);
      return {
        sym:c.sym, score:autoScore(c), autoScore:autoScore(c), tier:"WATCH",
        strike:c.K||c.strike||"", exp:c.exp||"", cp:c.cp||"", grade:c.grade||"",
        dir:"BEAR", hits:c.hits||0, prem:c.prem||0, side:c.side||"", er:c.er||false, notes:"[UOA]",
        cap:wlCapCheck(c), oi:c.maxOI||0, volume:c.vol||0, volOI:c.volOI||0, liveOI:0, liveOIDelta:0, actionLog:[],
        firstDate:ds.firstDate, entrySpot:ds.entrySpot, latestSpot:ds.latestSpot,
        convScore: c.score||0, rankScore: c.score||0, isExit: false
      };
    });
    setWlBull(bulls);
    setWlBear(bears);
  };

  const wlAddTicker = (side) => {
    const input = side==="bull"?wlAddBull.trim().toUpperCase():wlAddBear.trim().toUpperCase();
    if (!input) return;
    const setInput = side==="bull"?setWlAddBull:setWlAddBear;
    const setList = side==="bull"?setWlBull:setWlBear;
    const list = side==="bull"?wlBull:wlBear;
    // Check if already exists
    if (list.some(i=>i.sym===input)) { setInput(""); return; }
    // Try to find in CONV data for auto-population
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
    fetch("/api/watchlist/save",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({date:wlDate,bull:wlBull,bear:wlBear,removed:wlRemoved})
    }).then(r=>r.json()).then(()=>{
      fetch("/api/watchlist/dates").then(r=>r.json()).then(d=>setWlDates(d));
    }).catch(()=>{});
    // NOTE: removed previous push of watchlist top 10 bull/bear to /api/top-flow/save.
    // Watchlist saves are now decoupled from Tracker — Tracker is fed only from
    // the cap-weighted Top 10 Flow Picks via the manual "💾 Save Top 10" button
    // in Market Read.
  };

  // ─── Discord Push ───────────────────────────────────────────────────
  const [discordPushing, setDiscordPushing] = useState(false);
  const [discordImgPushing, setDiscordImgPushing] = useState(false);
  const [discordLabel, setDiscordLabel] = useState("WATCHLIST");
  const [discordCount, setDiscordCount] = useState(10);

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
    try {
      const resp = await fetch("/api/discord/push",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          bull:_addStatus(wlBull), bear:_addStatus(wlBear),
          unusualBull:[], unusualBear:[],
          overallBull, overallBear, tickerCount,
          label:discordLabel, limit:discordCount,
          dateRange: FD ? FD.dateRange : ""
        })
      });
      const data = await resp.json();
      if (data.ok) {
        setStatus(`✅ Pushed to Discord — ${data.messages_sent} message(s)`);
        // Push hand-picked watchlist top 10 bull + top 10 bear to Tracker.
        // Discord push is the curation commit moment — those are the picks
        // worth tracking. This is intentional (not auto-saved on every CSV
        // load — only when user explicitly pushes to Discord).
        const todayISO = new Date().toISOString().split("T")[0];
        const toTracker = (items, dir) => items.slice(0,10).map(item => {
          // ENTRY = volume-weighted avg CONTRACT price across the cluster's trades.
          //
          // Previously this stored item.entrySpot (the underlying STOCK price),
          // which made the Tracker show massive negative P/L on every row:
          // calcPnl reads `now` from getPrice() — the live OPTIONS contract
          // mark (~$12.50) — and divided by entry that was the spot
          // (~$590). Result: (12.50 - 590) / 590 = -97% on every single
          // position regardless of how the contract was actually performing.
          //
          // Premium $ / (volume × 100) recovers the volume-weighted contract
          // price the trades actually executed at — the correct comparison
          // basis for option P/L. This matches the formula already used in
          // the trade-row P/L table at ~line 138 (r.P / r.V / 100).
          const vol = item.volume || 0;
          const prem = item.prem || 0;
          const entryContractPx = vol > 0 ? prem / (vol * 100) : 0;
          return {
            sym: item.sym, cp: item.cp||"C", strike: parseFloat(item.strike)||0,
            exp: item.exp||"", entry: entryContractPx,
            grade: item.grade||"B", dir, hits: item.hits||1,
            prem: item.prem||0, cap: item.cap||capBand(item.mktcap||0),
            dateSaved: todayISO,
            entrySpot: item.entrySpot||0, // kept for stock-move reference
          };
        });
        const trackerPicks = [...toTracker(wlBull,"BULL"), ...toTracker(wlBear,"BEAR")];
        if (trackerPicks.length > 0) {
          fetch("/api/top-flow/save",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify(trackerPicks)
          }).then(r=>r.ok?r.json():null).then(()=>{
            fetch("/api/top-flow/history").then(r=>r.ok?r.json():null).then(d=>{ if(d) setTopFlowPicks(d); });
          }).catch(()=>{});
        }
      } else {
        setStatus(`❌ Discord push failed: ${data.error||"unknown error"}`);
      }
    } catch(e) { setStatus(`❌ Discord push error: ${e.message}`); }
    setDiscordPushing(false);
    setTimeout(()=>setStatus(""),4000);
  };

  const wlLoad = (day) => {
    fetch("/api/watchlist/load/"+day).then(r=>r.json()).then(d=>{
      setWlBull(d.bull||[]); setWlBear(d.bear||[]); setWlRemoved(d.removed||[]); setWlDate(day); setWlLoaded(true);
    }).catch(()=>{});
  };

  useEffect(()=>{
    fetch("/api/watchlist/dates").then(r=>r.ok?r.json():[]).then(d=>setWlDates(d)).catch(()=>{});
  },[]);
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

  // NOTE: Auto-save of "top 20 per CSV date from D.CONV" was REMOVED. It
  // pulled from the broader confirmed-cluster list (D.CONV), which mixed in
  // weak picks and watchlist-bear noise — caused 700+ active contracts of
  // mostly losing far-OTM puts. The Tracker is now fed exclusively from
  // the cap-weighted "Top 10 Flow Picks" via the manual "💾 Save Top 10"
  // button in Market Read. One click per trading day (or per backfill date).

  // Auto-load market data (deferred — non-critical)
  useEffect(() => { const t = setTimeout(fetchMarketData, 800); return () => clearTimeout(t); }, []);
  useEffect(() => { if (dataMode === "gex" && gexTicker) fetchGex(gexTicker, gexDte); }, [dataMode, gexTicker, gexDte]);

  // GEX horizontal price lines — derived from gexData. Passed as `priceLines`
  // prop to the StockChart that renders the "AMD Chart with GEX Levels" panel.
  const gexPriceLines = useMemo(() => {
    if (!gexData || gexData.error) return [];
    const cw = gexData.callWall;
    const pw = gexData.putWall;
    const zg = gexData.zeroGamma;
    const sp = gexData.spot || 0;
    const fmtG = v => { const abs=Math.abs(v); if(abs>=1e9) return "$"+(abs/1e9).toFixed(1)+"B"; if(abs>=1e6) return "$"+(abs/1e6).toFixed(1)+"M"; if(abs>=1e3) return "$"+(abs/1e3).toFixed(0)+"K"; return "$"+abs.toFixed(0); };
    const wallMax = Math.max(cw?.gex||0, Math.abs(pw?.gex||0));
    const getLineWeight = (gexVal) => {
      const ratio = wallMax > 0 ? Math.abs(gexVal) / wallMax : 0;
      if (ratio > 0.8) return { lw:4, ls:0, op:"" };
      if (ratio > 0.5) return { lw:3, ls:0, op:"CC" };
      if (ratio > 0.25) return { lw:2, ls:0, op:"80" };
      return { lw:1, ls:2, op:"59" };
    };
    const lines = [];
    if (cw && pw && cw.strike === pw.strike) {
      const combined = cw.gex + Math.abs(pw.gex);
      const proximity = sp > 0 ? Math.abs(cw.strike - sp) / sp : 0;
      const aboveSpot = cw.strike > sp;
      let title, color;
      if (proximity < 0.003) { title = "Pin "+fmtG(combined); color = "#c9a84c"; }
      else if (aboveSpot) { title = "Resistance "+fmtG(combined); color = "#c43030"; }
      else { title = "Support ↑ "+fmtG(combined); color = "#00BCD4"; }
      lines.push({ price:cw.strike, color, lineWidth:4, lineStyle:0, title });
    } else {
      if (cw) {
        const aboveSpot = cw.strike > sp;
        let title, color;
        if (aboveSpot) { title = "Ceiling "+fmtG(cw.gex); color = "#c43030"; }
        else { title = "Support ↑ "+fmtG(cw.gex); color = "#00BCD4"; }
        lines.push({ price:cw.strike, color, lineWidth:4, lineStyle:0, title });
      }
      if (pw) {
        const belowSpot = pw.strike < sp;
        let title, color;
        if (belowSpot) { title = "Bounce "+fmtG(Math.abs(pw.gex)); color = "#0a8f55"; }
        else { title = "Resistance "+fmtG(Math.abs(pw.gex)); color = "#c43030"; }
        lines.push({ price:pw.strike, color, lineWidth:4, lineStyle:0, title });
      }
    }
    if (zg) lines.push({ price:zg, color:"#ffab00", lineWidth:1, lineStyle:2, title:"Danger Line" });
    const usedStrikes = new Set([cw?.strike, pw?.strike].filter(Boolean));
    // Secondary above/below levels: keep the LINES (visible, color-coded so
    // user still sees support/resistance positions), but suppress the right-
    // axis $-value LABELS. Each axis label triggers LWC overlap-avoidance
    // layout work per redraw; with 6 secondary labels stacked near spot,
    // that compounded into visible crosshair lag. Walls + Danger Line keep
    // their labels (those carry the most important $ values).
    const aboveCandidates = [...(gexData.strikes||[])].filter(s=>s.strike>sp&&!usedStrikes.has(s.strike)).map(s=>{
      const callVal = s.callGex > 0 ? s.callGex : 0;
      const putVal = s.putGex < 0 ? Math.abs(s.putGex) : 0;
      const best = callVal >= putVal ? { val:callVal, type:"call" } : { val:putVal, type:"put" };
      return { strike:s.strike, gex:best.val, type:best.type };
    }).filter(s=>s.gex>0).sort((a,b)=>b.gex-a.gex).slice(0,3);
    aboveCandidates.forEach(s => {
      usedStrikes.add(s.strike);
      const {lw,ls,op} = getLineWeight(s.gex);
      const title = s.type === "call" ? "Ceiling "+fmtG(s.gex) : "Weak Spot "+fmtG(s.gex);
      lines.push({ price:s.strike, color:"#c43030"+op, lineWidth:lw, lineStyle:ls, title, axisLabelVisible:false });
    });
    const belowCandidates = [...(gexData.strikes||[])].filter(s=>s.strike<sp&&!usedStrikes.has(s.strike)).map(s=>{
      const callVal = s.callGex > 0 ? s.callGex : 0;
      const putVal = s.putGex < 0 ? Math.abs(s.putGex) : 0;
      const best = callVal >= putVal ? { val:callVal, type:"call" } : { val:putVal, type:"put" };
      return { strike:s.strike, gex:best.val, type:best.type };
    }).filter(s=>s.gex>0).sort((a,b)=>b.gex-a.gex).slice(0,3);
    belowCandidates.forEach(s => {
      const {lw,ls,op} = getLineWeight(s.gex);
      const baseColor = s.type === "call" ? "#00BCD4" : "#0a8f55";
      const title = s.type === "call" ? "Support ↑ "+fmtG(s.gex) : "Bounce "+fmtG(s.gex);
      lines.push({ price:s.strike, color:baseColor+op, lineWidth:lw, lineStyle:ls, title, axisLabelVisible:false });
    });
    return lines;
  }, [gexData]);

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
      fetch("/api/schwab/options-quotes", {
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
          <div style={{ borderRight:"1px solid "+P.bd, display:"flex", flexDirection:"column", height:320 }}>
            <div style={{ display:"flex", gap:3, padding:"4px 6px", borderBottom:"1px solid "+P.bd, flexShrink:0, alignItems:"center" }}>
              {[['1','1m'],['5','5m'],['15','15m'],['30','30m'],['60','1h'],['D','D'],['W','W'],['M','M']].map(([val,label])=>(
                <button key={val} onClick={()=>setContractChartTf(val)}
                  style={{ padding:"2px 7px", borderRadius:3, border:"1px solid "+(contractChartTf===val?P.ac:P.bd+"80"),
                    background:contractChartTf===val?P.ac+"22":"transparent", color:contractChartTf===val?P.ac:P.dm,
                    fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                  {label}
                </button>
              ))}
              {/* Dark Pool toggle — same global setting as the chart modal */}
              <button onClick={() => setShowDarkPool(v => !v)}
                title={showDarkPool ? "Hide dark pool zones on chart" : "Show dark pool zones on chart"}
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
                tf={contractChartTf}
                height="100%"
                liveUpdates={true}
                showDrawingTools={true}
                onTfChange={setContractChartTf}
                darkPoolBars={selectedDetailDarkPoolBars}
                hideReplay
                hidePatterns
                hideCompare
                hideCountdown
              />
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
                          style={{ borderBottom:"1px solid "+P.bd+"10", textAlign:"center", cursor:"pointer" }}
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
  if (csvLoading && !D) return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,border:"3px solid #1a2540",borderTop:"3px solid #3cb868",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{color:"#7b8fa3",fontSize:13}}>Loading flow data...</div>
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      </div>
    </div>
  );
  if (csvError && dataMode !== "gex" && dataMode !== "darkpool") return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{textAlign:"center",maxWidth:400}}>
        <div style={{ display:"flex", justifyContent:"center", gap:4, marginBottom:20 }}>
          {[["stocks","Stocks"],["index","Indexes / ETF's"],["liveflow","Live Flow"],["darkpool","Dark Pool"],["gex","GEX"]].map(([m,label])=>(
            <button key={m} onClick={()=>{
              if (m === "liveflow") { window.open("/live-flow", "_blank", "noopener,noreferrer"); return; }
              if(dataMode!==m) {
                const wasFlow = dataMode === "stocks" || dataMode === "index";
                const toFlow = m === "stocks" || m === "index";
                if (wasFlow && toFlow) { setFetchDays(1); setDateFilter('Last1'); setDateFrom(''); setDateTo(''); setD(null); setParsedRows(null); setLoadedFetchDays(null); }
                setDataMode(m);
              }
            }} style={{
              padding:"8px 28px", borderRadius:5, border:"none", cursor:"pointer",
              fontSize:14, fontWeight:800, fontFamily:"inherit",
              background:dataMode===m?"#1a2540":"transparent", color:dataMode===m?"#f0f4f8":"#4a5c73"
            }}>{label}</button>
          ))}
        </div>
        <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
        <div style={{color:"#e74c3c",fontSize:14,fontWeight:700,marginBottom:8}}>Failed to load {dataMode==="index"?"index":"flow"} data</div>
        <div style={{color:"#7b8fa3",fontSize:12,marginBottom:16}}>{csvError}</div>
        <div style={{color:"#4a5c73",fontSize:11}}>No flow data in database. Upload CSV via the admin page to get started.</div>
        <button onClick={()=>window.location.reload()} style={{marginTop:16,background:"#1a2540",color:"#c8d6e5",border:"1px solid "+P.bl+"",borderRadius:6,padding:"8px 20px",fontSize:12,cursor:"pointer"}}>Retry</button>
      </div>
    </div>
  );
  if ((!D || !FD) && dataMode !== "gex" && dataMode !== "darkpool") return (
    <div style={{background:"#06090f",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,border:"3px solid #1a2540",borderTop:"3px solid #3cb868",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{color:"#7b8fa3",fontSize:13}}>Processing flow data...</div>
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
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
          let resp = await fetch("/api/schwab/options-quotes", {
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
          // Update cache progressively so UI shows results as they come in
          setPriceCache({...newCache});
        } catch(e) { failures += batch.length; }
        // Delay between batches to avoid rate limiting
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
  // ─── OI Confirmation fetch ────────────────────────────────────────────────
  // Given the current ticker + trades in Search, build a per-contract list
  // (with earliest trade date per contract), POST to the backend, cache
  // the confirmation map for use in filtering totals.
  async function fetchOIConfirmations(ticker, allDirectionalForTicker) {
    if (!ticker || !allDirectionalForTicker || allDirectionalForTicker.length === 0) {
      setOiConfirmMap({});
      setOiConfirmMeta(null);
      return;
    }
    // Format Date → "M/D/YYYY" (4-digit year required to match the storage
    // format the backend expects, e.g. "SPCX|C|165.0|12/17/2027").
    const fmtDate = (v) => {
      if (!v) return "";
      if (v instanceof Date) return (v.getMonth()+1)+"/"+v.getDate()+"/"+v.getFullYear();
      return String(v);
    };
    // Reconstruct full date "M/D/YYYY" from "M/D" (stripped by t.Dt). Assume
    // current year unless the month is later than the current month (implies
    // trade happened in the previous calendar year — e.g. viewing Dec data
    // during Jan).
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const fmtTradeDate = (md) => {
      if (!md) return "";
      const s = String(md).trim();
      const parts = s.split("/");
      if (parts.length === 3) {
        // Already has year (2 or 4 digit) — normalize to 4-digit
        let y = parseInt(parts[2]);
        if (isNaN(y)) return s;
        if (y < 100) y += 2000;
        return parts[0]+"/"+parts[1]+"/"+y;
      }
      if (parts.length !== 2) return s;
      const m = parseInt(parts[0]);
      if (isNaN(m)) return s;
      const yr = m > currentMonth + 1 ? currentYear - 1 : currentYear;
      return parts[0]+"/"+parts[1]+"/"+yr;
    };
    // Group by contract, keep earliest trade date per contract
    const byContract = {};
    allDirectionalForTicker.forEach(t => {
      const k = `${t.S}|${t.CP}|${t.K}|${t.E}`;
      const dt = fmtTradeDate(t.Dt).trim();
      // Use t.expiry (Date object) NOT t.E (short string like "7/17" without
      // year). t.E is the display string built by formatExp which drops year
      // when it matches current year — breaks OI lookup against stored
      // "M/D/YYYY" keys.
      const expStr = fmtDate(t.expiry);
      if (!byContract[k]) {
        byContract[k] = { sym: t.S, cp: t.CP, strike: t.K, expiry: expStr, first_trade_date: dt };
      } else if (dt) {
        // Keep the earliest date (US format M/D/YYYY)
        const cur = byContract[k].first_trade_date;
        if (!cur) { byContract[k].first_trade_date = dt; return; }
        const parse = (s) => { const p = s.split("/"); if (p.length < 3) return null;
          let y = parseInt(p[2]); if (y < 100) y += 2000;
          return new Date(y, parseInt(p[0]) - 1, parseInt(p[1])).getTime();
        };
        const a = parse(cur), b = parse(dt);
        if (a && b && b < a) byContract[k].first_trade_date = dt;
      }
    });
    const contracts = Object.values(byContract).filter(c => c.first_trade_date);
    if (contracts.length === 0) {
      setOiConfirmMap({});
      setOiConfirmMeta(null);
      return;
    }
    setOiConfirmLoading(true);
    setOiConfirmError(null);
    try {
      const resp = await fetch("/api/oi/confirmation-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contracts,
          window_days: oiConfirmWindow,
          threshold_pct: 10,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Backend ${resp.status}: ${errText.slice(0, 150)}`);
      }
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "Unknown backend error");
      setOiConfirmMap(data.confirmations || {});
      setOiConfirmMeta({
        total: data.total || 0,
        confirmed: data.confirmed_count || 0,
        no_snapshots: data.no_snapshots_count || 0,
        window_days: data.window_days || oiConfirmWindow,
      });
    } catch (e) {
      setOiConfirmError(e.message || String(e));
      setOiConfirmMap({});
      setOiConfirmMeta(null);
    }
    setOiConfirmLoading(false);
  }

  async function fetchContractHistory(sym, cp, strike, exp, force = false) {
    const k = `${sym}|${cp}|${parseFloat(strike)}|${exp}`;

    // 1. Fetch history from Schwab backfill + tracker
    if ((contractHistory[k] == null || force) && !fetchingRef.current.has(k)) {
      fetchingRef.current.add(k);
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

  async function fetchGex(ticker, dte) {
    if (!ticker) return;
    setGexLoading(true);
    try {
      const resp = await fetch(`/api/gex/data?ticker=${encodeURIComponent(ticker)}&dte=${dte}`);
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
      const resp = await fetch(`/api/gex/data?ticker=${encodeURIComponent(sym)}&dte=month`);
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
    <div className="of-mroot" style={{ background:P.bg, color:P.tx, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", minHeight:"100vh", padding:"16px 20px", zoom:1.18 }}>
      <div style={{ maxWidth:1280, margin:"0 auto" }}>

        {/* Data Mode Toggle */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}>
          <div style={{ display:"flex", background:P.al, borderRadius:8, padding:3, border:"1px solid "+P.bd }}>
            {[["stocks","Stocks"],["index","Indexes / ETF's"],["liveflow","Live Flow"],["darkpool","Dark Pool"],["gex","GEX"]].map(([m,label])=>{
              // Live Flow navigates to a separate page; other modes switch dataMode in place.
              const isLive = m === "liveflow";
              const accent = m==="gex" ? "#c9a84c" : m==="darkpool" ? "#6ba3be" : isLive ? "#3cb868" : null;
              const hasAccent = accent !== null;
              return (
                <button key={m} onClick={()=>{
                  if (isLive) { window.open("/live-flow", "_blank", "noopener,noreferrer"); return; }
                  if(dataMode!==m) {
                    // Only reset flow data when switching between stocks ↔ index (csvFile changes)
                    // Switching to/from darkpool or gex preserves cached parsedRows+D for instant return
                    const wasFlow = dataMode === "stocks" || dataMode === "index";
                    const toFlow = m === "stocks" || m === "index";
                    if (wasFlow && toFlow) { setFetchDays(1); setDateFilter('Last1'); setDateFrom(''); setDateTo(''); setD(null); setParsedRows(null); setLoadedFetchDays(null); }
                    setDataMode(m);
                  }
                }} style={{
                  padding:"8px 28px", borderRadius:6,
                  border: hasAccent ? "1px solid "+(dataMode===m ? accent : accent+"55") : "none",
                  cursor:"pointer",
                  fontSize:14, fontWeight:800, fontFamily:"inherit", letterSpacing:0.5,
                  background: dataMode===m ? (hasAccent ? accent+"33" : P.cd) : "transparent",
                  color: dataMode===m ? (hasAccent ? accent : P.wh) : (hasAccent ? accent : P.mt),
                  boxShadow: dataMode===m ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
                  transition:"all 0.15s"
                }}>{label}</button>
              );
            })}
          </div>
        </div>

        {/* Date Filter — rolling windows + presets + calendar */}
        {dataMode !== "gex" && dataMode !== "darkpool" && availableDates.length > 0 && (
          <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
            <div className="of-chiprow-wrap" style={{ display:"flex", gap:4, alignItems:"center", background:P.al, borderRadius:6, padding:4, border:"1px solid "+P.bd, flexWrap:"wrap", justifyContent:"center", position:"relative" }}>
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
                    background:isActive?P.cd:"transparent",
                    color:isActive?(key==="All"?P.ac:P.wh):P.mt,
                    transition:"all 0.15s"
                  }}>
                    {label}
                  </button>
                );
              })}
              <span style={{ width:1, height:16, background:P.bd }}/>
              <button onClick={()=>{
                if (!showCal) {
                  const last = availableDates[availableDates.length-1];
                  if (last) { const d = mdyToDate(last); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }
                }
                setShowCal(!showCal); setCalStart(null);
              }} style={{
                padding:"5px 12px", borderRadius:4, border:"1px solid "+(dateFrom&&dateTo?P.ac:P.bd),
                cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit",
                background:dateFrom&&dateTo?P.ac+"22":showCal?P.cd:"transparent",
                color:dateFrom&&dateTo?P.ac:showCal?P.wh:P.mt, transition:"all 0.15s"
              }}>
                {dateFrom && dateTo
                  ? `${dateFrom.slice(5).replace("-","/")} → ${dateTo.slice(5).replace("-","/")}`
                  : "📅 Dates"}
              </button>
              {dateFrom && dateTo && (
                <button onClick={()=>{ setDateFrom(""); setDateTo(""); setDateFilter("Last1"); setShowCal(false); setCalStart(null); }}
                  style={{ background:"transparent", border:"none", color:P.dm, cursor:"pointer", fontSize:12, fontFamily:"inherit", padding:"2px 4px" }}>✕</button>
              )}
              <span style={{ fontSize:9, color:P.dm }}>
                {csvLoading ? "Loading..." : dateFrom && dateTo
                  ? (() => { const n = availableDates.filter(d => { const iso = mdyToIso(d); return iso >= dateFrom && iso <= dateTo; }).length; return n + " trading day" + (n!==1?"s":""); })()
                  : (() => { const n = dateFilter.startsWith("Last") ? Math.min(parseInt(dateFilter.replace("Last",""))||1, availableDates.length) : availableDates.length; return n + " trading day" + (n!==1?"s":""); })()}
              </span>

              {showCal && (
                <div ref={calRef} style={{
                  position:"absolute", top:"100%", right:0, marginTop:6, zIndex:999,
                  background:P.cd, border:"1px solid "+P.bl, borderRadius:10, padding:14,
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
                        padding:"4px 10px", borderRadius:4, border:"1px solid "+P.bd,
                        background:"transparent", color:P.mt, fontSize:9, fontWeight:700,
                        cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s"
                      }}
                        onMouseEnter={e=>{e.target.style.background=P.al; e.target.style.color=P.wh;}}
                        onMouseLeave={e=>{e.target.style.background="transparent"; e.target.style.color=P.mt;}}
                      >{p.label}</button>
                    ))}
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <button onClick={()=>{ if(calMonth===0){setCalMonth(11);setCalYear(calYear-1);}else setCalMonth(calMonth-1); }}
                      style={{ background:"transparent", border:"none", color:P.mt, cursor:"pointer", fontSize:14, fontFamily:"inherit", padding:"2px 8px" }}>◀</button>
                    <span style={{ fontSize:12, fontWeight:700, color:P.wh }}>
                      {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][calMonth]} {calYear}
                    </span>
                    <button onClick={()=>{ if(calMonth===11){setCalMonth(0);setCalYear(calYear+1);}else setCalMonth(calMonth+1); }}
                      style={{ background:"transparent", border:"none", color:P.mt, cursor:"pointer", fontSize:14, fontFamily:"inherit", padding:"2px 8px" }}>▶</button>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, marginBottom:4 }}>
                    {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
                      <div key={d} style={{ textAlign:"center", fontSize:8, fontWeight:700, color:P.dm, padding:2 }}>{d}</div>
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
                              background: isStart||isEnd ? P.ac : inRange ? P.ac+"33" : "transparent",
                              color: isStart||isEnd ? P.bg : inRange ? P.ac : isTrading ? P.wh : isWeekend ? P.bd : P.dm+"88",
                              minWidth:32, minHeight:32, display:"flex", alignItems:"center", justifyContent:"center",
                              position:"relative", transition:"background 0.1s"
                            }}
                              onMouseEnter={e=>{ if(!inRange&&!isStart&&!isEnd) e.target.style.background=P.al; }}
                              onMouseLeave={e=>{ if(!inRange&&!isStart&&!isEnd) e.target.style.background="transparent"; }}
                            >
                              {day}
                              {isTrading && <span style={{ position:"absolute", bottom:2, left:"50%", transform:"translateX(-50%)", width:3, height:3, borderRadius:"50%", background:isStart||isEnd?P.bg:P.ac }}/>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                  <div style={{ marginTop:8, fontSize:9, color:P.dm, textAlign:"left", paddingLeft:12 }}>
                    {calStart && !dateTo ? "Click end date" : "Click to start selection"}
                    {" · "}<span style={{ color:P.ac }}>●</span> trading day
                  </div>
                </div>
              )}
            </div>
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
                        {[['1','1min'],['5','5min'],['15','15min'],['30','30min'],['60','1hr'],['D','Daily'],['W','Weekly'],['M','Monthly']].map(([val,label])=>(
                          <button key={val} onClick={()=>setGexChartTf(val)}
                            style={{ padding:"3px 8px", borderRadius:4, border:"1px solid "+(gexChartTf===val?P.ac:P.bd+"80"),
                              background:gexChartTf===val?P.ac+"22":"transparent", color:gexChartTf===val?P.ac:P.dm,
                              fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ width:"100%", height:500, borderRadius:6, overflow:"hidden" }}>
                      <StockChart
                        sym={gexData.ticker}
                        tf={gexChartTf}
                        height={500}
                        liveUpdates={true}
                        showDrawingTools={true}
                        priceLines={gexPriceLines}
                        onTfChange={setGexChartTf}
                        hideReplay
                        hidePatterns
                        hideCompare
                        hideCountdown
                      />
                    </div>
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

                  // Thin zone detection — gaps where price can accelerate
                  const allStrikesAbove = [...(gexData.strikes||[])].filter(s => s.strike > sp && (s.callGex > 0 || Math.abs(s.putGex) > 0)).sort((a,b)=>a.strike-b.strike);
                  const allStrikesBelow = [...(gexData.strikes||[])].filter(s => s.strike < sp && (s.callGex > 0 || Math.abs(s.putGex) > 0)).sort((a,b)=>b.strike-a.strike);
                  // Thin above: gap between ceiling (or first res) and the next level above it
                  const ceilingStrike = cwAboveSpot ? cwStrike : (firstResAbove ? firstResAbove.strike : null);
                  const levelAboveCeiling = ceilingStrike ? allStrikesAbove.find(s => s.strike > ceilingStrike) : null;
                  const thinAbove = ceilingStrike && (!levelAboveCeiling || (levelAboveCeiling.strike - ceilingStrike) / sp > 0.015);
                  // Thin below: gap between floor (or first support) and the next level below it
                  const floorStrike = pwBelowSpot ? pwStrike : (firstSupBelow ? firstSupBelow.strike : null);
                  const levelBelowFloor = floorStrike ? allStrikesBelow.find(s => s.strike < floorStrike) : null;
                  const thinBelow = floorStrike && (!levelBelowFloor || (floorStrike - levelBelowFloor.strike) / sp > 0.015);

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
                  const cwMagnet = !cwAboveSpot; // call wall below spot = support
                  const pwMagnet = !pwBelowSpot; // put wall above spot = resistance

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
                      if (thinAbove) trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"Thin air above the pin — if price breaks above $"+(pinStrike+pinRange*3)+", it can run fast. Join the breakout, don't fade it." });
                      if (thinBelow) trades.push({ i:"!", bg:P.be+"33", c:P.be, t:"Thin air below — if $"+(pinStrike-pinRange*3)+" breaks, price can slice through quickly. Protect downside." });
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
                      if (thinAbove) trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"Thin resistance above the pin — a daily close above $"+(pinStrike+pinRange*3)+" can run fast. Join the breakout." });
                      if (thinBelow) trades.push({ i:"!", bg:P.be+"33", c:P.be, t:"Thin support below — a daily close below $"+(pinStrike-pinRange*3)+" means fast downside. Cut longs." });
                    }
                  } else if (squeezeSetup) {
                    // Squeeze setup trades
                    const lo = Math.min(cwStrike,pwStrike), hi = Math.max(cwStrike,pwStrike);
                    const mid = Math.round((lo+hi)/2);
                    if (isIntraday) {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"Price wants to stay at $"+mid+" — sell premium here (iron fly). Profit if price stays between $"+(lo-Math.round(wallSpread))+"–$"+(hi+Math.round(wallSpread))+"." });
                      trades.push({ i:"F", bg:P.ac+"33", c:P.ac, t:"Price keeps snapping back to $"+mid+". Sell rallies above $"+(hi+Math.round(wallSpread*0.5))+" and buy dips below $"+(lo-Math.round(wallSpread*0.5))+"." });
                      if (thinAbove) trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"Thin air above $"+hi+" — if price breaks the ceiling, it can run fast. Don't fade a breakout above $"+(hi+Math.round(wallSpread))+"." });
                      if (thinBelow) trades.push({ i:"!", bg:P.be+"33", c:P.be, t:"Thin air below $"+lo+" — if the floor breaks, price can slice through quickly. Tighten stops." });
                    } else {
                      trades.push({ i:"S", bg:"#00BCD433", c:"#00BCD4", t:"$"+lo+"–$"+hi+" is the weekly range. Sell weekly premium — iron condor with wings outside $"+(lo-Math.round(wallSpread))+" and $"+(hi+Math.round(wallSpread))+"." });
                      trades.push({ i:"F", bg:P.ac+"33", c:P.ac, t:"Swing entries: buy daily closes near $"+lo+", take profits near $"+hi+". Fade daily closes above $"+hi+" back toward $"+mid+"." });
                      if (thinAbove) trades.push({ i:"↗", bg:P.bu+"33", c:P.bu, t:"Thin resistance above $"+hi+" — a daily close above it can run fast. Don't fade, join the move." });
                      if (thinBelow) trades.push({ i:"!", bg:P.be+"33", c:P.be, t:"Thin support below $"+lo+" — a daily close below it means fast downside. Cut longs." });
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
                  if (thinBelow && !pinSetup && !squeezeSetup) {
                    trades.push({ i:"⚠", bg:P.be+"33", c:P.be, t:(isIntraday?"Thin air below $"+(firstSupBelow?firstSupBelow.strike:dangerLevel)+" — if support breaks, price can slice through fast. No cushion to slow the drop.":"Thin support below $"+(firstSupBelow?firstSupBelow.strike:dangerLevel)+" — a break means fast downside with nothing to catch it.") });
                  }
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
                        // CW below = support
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
                        // PW above = resistance
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
          <h1 style={{ fontSize:18, fontWeight:800, margin:0, color:P.wh }}>{dataMode==="index"?"INDEX FLOW":"OPTIONS FLOW"} — MARKET READ</h1>
          <span style={{ marginLeft:"auto", fontSize:10, color:P.mt, background:P.al, padding:"3px 10px", borderRadius:4 }}>
            {D.dateRange} · {D.confirmedCount} confirmed of {D.totalTrades} trades
          </span>
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
                <button className="of-refresh" onClick={fetchMarketData} title="Refresh" style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", padding:"2px 8px", borderRadius:3, border:"1px solid "+P.bl, background:"transparent", color:P.dm, fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>↻</button>
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
        <div className="of-tabs" style={{ display:"flex", gap:1, marginBottom:14, background:P.al, borderRadius:6, padding:2, width:"fit-content", flexWrap:"wrap" }}>
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
          // Classify through wlCapCheck (the same per-ticker resolver the
          // Leaderboard uses) rather than a raw per-trade capBand. Gap-fill
          // rows carry mktcap=0 → capBand "Unknown", so a strict per-trade
          // check dropped a mega/large ticker's gap-fill prints out of EVERY
          // sub-bucket — that's why Mega+Large+Mid-Small didn't sum to All
          // (premium orphaned in Unknown). wlCapCheck falls back to capLookup
          // to recover the ticker's true band, so the buckets reconcile and
          // the classification matches the Leaderboard's.
          const capThresh = {
            Mega: t=>wlCapCheck({sym:t.S||t.sym, mktcap:t.mktcap})==="Mega",
            Large: t=>wlCapCheck({sym:t.S||t.sym, mktcap:t.mktcap})==="Large",
            "Mid-Small": t=>wlCapCheck({sym:t.S||t.sym, mktcap:t.mktcap})==="Mid-Small"
          };
          return (
            <div style={{ marginBottom:10 }}>
              <div className="of-chiprow-wrap" style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
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
                const isEtf = isETF(t.S, t.stocketf);
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
                // 7/9: If ticker was first seen with mktcap=0 (gap-fill row),
                // upgrade to the real mktcap when a later row provides it.
                // Prevents AAPL/META etc. from getting stuck as Unknown when
                // even one row is missing mktcap data.
                else if (!tkMap[t.S].mktcap && t.mktcap) tkMap[t.S].mktcap = t.mktcap;
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
              // Flow velocity: today vs average
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
              // Earnings callout
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
{/* Flow Velocity */}
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
                      {/* Earnings Callout */}
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
                          <div className="of-chiprow-wrap" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:4, marginTop:4 }}>
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
                  <div className="of-chiprow-seg" style={{ display:"flex", gap:2, background:P.al, borderRadius:5, padding:2 }}>
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
                                    {/* Bull/Bear summary */}
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
              // 2026-07-04: honor the Stocks tab by excluding ETFs/indexes
              // (and vice versa on the Indexes tab). Matches Watchlist behavior.
              const _tabOk = (t) => {
                const isEtf = isETF(t.S, t.stocketf);
                return dataMode === "stocks" ? !isEtf : isEtf;
              };
              const baseAd = (D.all_directional||[]).filter(_tabOk);
              const ad = capFilter==="All" ? baseAd : baseAd.filter(t=>capBand(t.mktcap)===capFilter);
              if (!ad.length) return null;
              // Pre-build TOTAL premium per (ticker,contract) from broader trade list
              // (includes B-side MAGENTA call buys etc. that don't get a direction
              // assigned per the strict A/AA-only rule, but are real flow on the strike).
              // Used for DISPLAY ONLY — scoring/exit detection still use the directional
              // subset to avoid misclassifying ambiguous flow as conviction.
              const baseAllTrades = (D.all_trades||[]).filter(_tabOk);
              const allTrades = capFilter==="All" ? baseAllTrades : baseAllTrades.filter(t=>capBand(t.mktcap)===capFilter);
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
                // 7/9: Upgrade mktcap + band when a real value shows up. Prevents
                // gap-fill rows (mktcap=0 → Unknown) from locking a ticker's cap
                // band. See matching fix at line 6410 for full explanation.
                else if (!tkMap[t.S].mktcap && t.mktcap) {
                  tkMap[t.S].mktcap = t.mktcap;
                  tkMap[t.S].band = capBand(t.mktcap);
                }
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
                      <div className="of-chiprow-seg" style={{ display:"flex", gap:2, background:P.bg, borderRadius:5, padding:2 }}>
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
                    {/* Header — same row layout as renderDetailPanel */}
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
                        {/* Switch-ticker input — type a symbol and press Enter to load
                            that chart in place. No close-and-reopen needed. */}
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
                    {/* Timeframe row — matches renderDetailPanel pattern */}
                    <div style={{ display:"flex", gap:3, padding:"4px 6px", borderBottom:"1px solid "+P.bd, flexShrink:0, alignItems:"center" }}>
                      {[['1','1m'],['5','5m'],['15','15m'],['30','30m'],['60','1h'],['D','D'],['W','W'],['M','M']].map(([val,label]) => (
                        <button key={val} onClick={() => setChartInterval(val)}
                          style={{ padding:"2px 7px", borderRadius:3, border:"1px solid "+(chartInterval===val?P.ac:P.bd+"80"),
                            background:chartInterval===val?P.ac+"22":"transparent", color:chartInterval===val?P.ac:P.dm,
                            fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                          {label}
                        </button>
                      ))}
                      {/* Dark Pool toggle — applies globally (persists in localStorage). */}
                      <button onClick={() => setShowDarkPool(v => !v)}
                        title={showDarkPool ? "Hide dark pool zones on chart" : "Show dark pool zones on chart"}
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
          // Use all_directional (not clean_confirmed) so Bull/Bear totals match
          // the Search tab. clean_confirmed is the strict methodology — only
          // YELLOW/MAGENTA confirmed clusters — which excludes "dirty-dominant"
          // trades (80%+ one direction, some opposing). Search was updated to
          // use all_directional so the header doesn't read $0 for all-WHITE
          // tickers like SERV. Standardizing Leaderboard here closes the gap
          // between Search and Leaderboard (previously FRMI showed $3.0M bull
          // here but $14.3M on Search for the same time window).
          //
          // Mid-Small filter also includes "Unknown" mktcap tickers. capBand
          // returns "Unknown" when mktcap is missing/0 in our data — almost
          // always small/mid-cap names (mega and large are universally tracked
          // in market data feeds). Without this, high-flow names like KEEL
          // silently vanish from every cap filter except "All" just because
          // their mktcap field is null. The fallback lookup at wlCapCheck
          // (line 1891) handles individual ticker resolution; this filter
          // handles bulk leaderboard inclusion.
          // Resolve each ticker's TRUE cap band from the MAX non-zero mktcap
          // seen across ALL its directional trades — NOT the per-trade value.
          // Gap-fill rows carry mktcap=0 (→ capBand "Unknown"), so a per-trade
          // check let a mega/large ticker's gap-fill prints slip through the
          // Mid-Small filter (Unknown is admitted to Mid-Small). That put
          // MU/NVDA/AAPL on the Mid-Small leaderboard with ONLY their gap-fill
          // premium counted — wrong roster AND wrong totals. Build the resolver
          // from the UNFILTERED all_directional so it isn't biased by the cap
          // filter itself; fall back to capLookup (clean_confirmed) then the
          // trade's own mktcap before conceding "Unknown".
          const lbCapByTicker = {};
          (D.all_directional || []).forEach(t => {
            const s = (t.S || "").toUpperCase();
            const mc = t.mktcap || 0;
            if (s && mc > 0 && (!lbCapByTicker[s] || mc > lbCapByTicker[s])) lbCapByTicker[s] = mc;
          });
          const lbBandOf = (t) => {
            const s = (t.S || "").toUpperCase();
            const mc = lbCapByTicker[s] || t.mktcap || 0;
            let cap = capBand(mc);
            if (cap === "Unknown") { const lk = capLookup[s]; if (lk) cap = capBand(lk); }
            return cap;
          };
          const matchesLBCap = (t) => {
            if (capFilter === "All") return true;
            const cap = lbBandOf(t);
            if (cap === capFilter) return true;
            // Only genuinely-unknown tickers (no mktcap ANYWHERE) fall into
            // Mid-Small — real megas/larges are always resolved above.
            return capFilter === "Mid-Small" && cap === "Unknown";
          };
          // 2026-07-04: honor the Stocks tab by excluding ETFs/indexes
          // (and vice versa on the Indexes tab). Matches Watchlist behavior.
          const _tabOk = (t) => {
            const isEtf = isETF(t.S, t.stocketf);
            return dataMode === "stocks" ? !isEtf : isEtf;
          };
          const cc = (D.all_directional||[]).filter(_tabOk).filter(matchesLBCap);
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
            if (!tkMap[t.S]) tkMap[t.S] = { sym:t.S, bull:0, bear:0, n:0, mktcap:t.mktcap||0, contracts:{}, recentPrem:0, priorPrem:0, er:false, sector:t.sector||"", uoa:false, dates:new Set() };
            // 7/9: Upgrade mktcap when a real value shows up. Same fix as
            // line 5168 — prevents gap-fill rows (mktcap=0 by design) from
            // locking a ticker into "Unknown" band. This is the exact source
            // of "Mid-Small filter includes AAPL/META" bug seen on 7/9 after
            // 7/8 OPRA CSV gap-fill: AAPL rows from gap-fill had mktcap=0,
            // and if seen first, AAPL entered tkMap as Unknown → matchesLBCap
            // let it through the Mid-Small filter.
            else if (!tkMap[t.S].mktcap && t.mktcap) tkMap[t.S].mktcap = t.mktcap;
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
          // Build broader contract totals from D.all_directional — same source
          // as the Bull/Bear totals above so the Top Contract premium is always
          // ≤ the ticker's total directional flow. Previously this used
          // D.all_trades which included NEUT/dirty clusters, producing the
          // mathematically impossible state where AXTI's Top Contract ($25.4M)
          // exceeded its Bull total ($7.8M). Same dataset across columns = same
          // denominator = no more surprises.
          const lbBroader = {};
          (D.all_directional || []).forEach(t => {
            // Use the same matchesLBCap helper as the bull/bear totals above
            // so the Top Contract column's data source matches exactly.
            // Without this, Unknown-mktcap tickers (like KEEL) would have
            // their bull/bear shown but their Top Contract premium missing.
            if (!matchesLBCap(t)) return;
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

            // ΔOI computation: liveOI − baselineOI (maxOI seen during the
            // window). Positive = position growing (new contracts opened net),
            // negative = position fading (closed net). Returns null when Live
            // OI hasn't been fetched yet — the badge is silently omitted in
            // that case, no UI noise. User triggers Live OI fetch via the
            // "⚡ Fetch Live P/L" button on Search/expand panels; once cached,
            // it's available everywhere via getPrice().
            const computeDeltaOI = (c) => {
              const px = getPrice(tk.sym, c.cp, c.K, c.exp);
              const liveOI = px ? (px.oi || 0) : 0;
              const baseOI = c.maxOI || 0;
              if (liveOI === 0 || baseOI === 0) return null;
              return liveOI - baseOI;
            };
            // Format ΔOI with sign + abbreviation (e.g., "+6.5k", "-2.3k", "+120")
            const fmtDelta = (d) => {
              const sign = d > 0 ? "+" : "";
              if (Math.abs(d) >= 1000) return sign + (d/1000).toFixed(1) + "k";
              return sign + d.toLocaleString();
            };
            // Color: meaningful growth (>100) green, meaningful decay (<-100)
            // red. Smaller values are noise (rolling activity) and shown gray
            // so subscribers focus on real position changes.
            const deltaColor = (d) => d > 100 ? P.bu : d < -100 ? P.be : P.dm;

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
                    {/* ΔOI badge — shows position growth/decay since the trade
                        window. Only renders when Live OI has been fetched
                        (getPrice returns a valid oi). Positive = position
                        building, negative = profit-taking / closing. */}
                    {(()=>{ const d = computeDeltaOI(tc_); return d !== null ? (
                      <span style={{ color:deltaColor(d), fontSize:8, marginLeft:4, fontWeight:700, padding:"1px 4px", borderRadius:3, background:deltaColor(d)+"15", border:"1px solid "+deltaColor(d)+"33" }}
                            title={d > 0 ? "Open interest grew by " + d.toLocaleString() + " contracts since these trades — position is being built" : d < 0 ? "Open interest fell by " + Math.abs(d).toLocaleString() + " contracts — position is being closed (profit-taking or fading)" : "Open interest unchanged"}>
                        ΔOI {fmtDelta(d)}
                      </span>
                    ) : null; })()}
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
                      const cDelta = computeDeltaOI(c);
                      return (
                        <div key={i} style={{ padding:"4px 10px", borderRadius:4, background:P.al, border:"1px solid "+P.bd, fontSize:9, textAlign:"center", cursor:"pointer" }}
                          title={c.dates && c.dates.size > 0 ? "Flow dates: " + [...c.dates].join(", ") : ""}
                          onClick={e=>{ e.stopPropagation(); setTab("Search"); setSearch(tk.sym); setSelectedTicker(D.TICKER_DB.find(t=>t.s===tk.sym)||null); setSearchDte("All"); }}>
                          <span style={{ color:cC, fontWeight:800 }}>{c.cp==="C"?"C":"P"}</span>
                          {cSide==="bid" && <span style={{ fontSize:6, color:cC, fontWeight:700, marginLeft:2 }}>BB</span>}
                          <span style={{ color:P.wh, fontWeight:700, marginLeft:4 }}>${c.K}</span>
                          <span style={{ color:P.ac, marginLeft:4 }}>{c.exp}</span>
                          <span style={{ color:(c.displayHits||c.hits)>=10?P.ac:(c.displayHits||c.hits)>=5?P.ye:P.dm, fontWeight:800, marginLeft:6 }}>{c.displayHits||c.hits}x</span>
                          <span style={{ color:premC(c.displayPrem||c.prem), fontWeight:700, marginLeft:6 }}>{fmt(c.displayPrem||c.prem)}</span>
                          {c.volOI>=3 && <span style={{ color:P.ye, marginLeft:4, fontSize:8 }}>{c.volOI.toFixed(1)}x V/OI</span>}
                          {/* ΔOI badge — same logic as the inline column above,
                              but only renders when Live OI is cached. Subtle
                              styling here since chip is already information-
                              dense; user can hover for the explanatory tooltip. */}
                          {cDelta !== null && (
                            <span style={{ color:deltaColor(cDelta), fontSize:8, marginLeft:6, fontWeight:700 }}
                                  title={cDelta > 0 ? "OI grew by " + cDelta.toLocaleString() + " — position building" : cDelta < 0 ? "OI fell by " + Math.abs(cDelta).toLocaleString() + " — position fading" : "OI unchanged"}>
                              ΔOI {fmtDelta(cDelta)}
                            </span>
                          )}
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
                      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                        {/* Fetch button — batches a Schwab call for every top
                            contract on both bull and bear tables (top 25 each,
                            deduped). Once cached, ΔOI badges populate on every
                            row showing whether positions are still being built
                            or are fading. Without this, ΔOI only shows for
                            contracts the user already fetched on Search. */}
                        {(() => {
                          // Collect top-3 contracts from all visible rows so
                          // expanded panels also benefit. Dedup by ticker+CP+
                          // strike+exp since tickers may appear in both lists
                          // (rare but possible with split direction). Top 3
                          // gives ~150 contracts max which fits in ~8 batches.
                          const seen = new Set();
                          const contracts = [];
                          [...bulls.slice(0, 25), ...bears.slice(0, 25)].forEach(tk => {
                            (tk.topContracts || []).slice(0, 3).forEach(c => {
                              const k = tk.sym + "|" + c.cp + "|" + c.K + "|" + c.exp;
                              if (!seen.has(k)) {
                                seen.add(k);
                                contracts.push({ sym: tk.sym, cp: c.cp, strike: c.K, exp: c.exp });
                              }
                            });
                          });
                          // Disabled when zero contracts (no data loaded yet)
                          // or already fetching. Label includes count so user
                          // knows the scope before clicking — important since
                          // a full fetch takes ~5-10 seconds.
                          return (
                            <button
                              onClick={() => fetchPrices(contracts)}
                              disabled={fetchLoading || contracts.length === 0}
                              style={{
                                padding:"4px 12px", borderRadius:6,
                                border: "1px solid " + (fetchLoading ? P.bd : P.sw),
                                cursor: fetchLoading || !contracts.length ? "not-allowed" : "pointer",
                                fontSize:9, fontWeight:700, fontFamily:"inherit",
                                background: fetchLoading ? P.bd : P.sw + "22",
                                color: fetchLoading ? P.dm : P.sw,
                                letterSpacing: 0.5,
                              }}
                              title="Fetch live OI + prices from Schwab for every Top Contract on this leaderboard. Once complete, ΔOI badges show whether each position is being built (green) or faded (red)."
                            >
                              {fetchLoading ? "Fetching…" : `⚡ Fetch Live OI (${contracts.length})`}
                            </button>
                          );
                        })()}
                        <div style={{ fontSize: 9, color: P.dm }}>Top {tb.length} bull · Top {tbr.length} bear</div>
                      </div>
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
            const isEtf = isETF(t.S, t.stocketf);
            return dataMode === "stocks" ? !isEtf : isEtf;
          };
          // Build clusters from ALL clean confirmed trades (tab-filtered)
          const tfClusters = {};
          (D.clean_confirmed||[]).forEach(t => {
            if (!_tabOk(t)) return;
            const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
            if (!tfClusters[k]) tfClusters[k] = { sym:t.S, cp:t.CP, K:t.K, exp:t.E, DTE:t.DTE, hits:0, prem:0, dir:t.D,
              hasAA:false, hasBB:false, hasSweep:false, hasBlock:false, oiExceeded:false, dirs:new Set(), clean:true,
              mktcap:t.mktcap||0, sector:t.sector||"", prices:[], volumes:0, maxOI:0,
              bullPrem:0, bearPrem:0, askPrem:0, bidPrem:0, dominantOverride:false, er:t.er||false,
              ivs:[], spots:[], sideTimes:[], vol:0,
              cleanHits:0, cleanPrem:0, cleanAskPrem:0 };
            const c = tfClusters[k];
            c.hits++; c.prem += t.P; c.volumes += t.V; c.vol += t.V;
            // Clean accumulators exclude rescue-derived direction so the score
            // formula reflects raw classified signal, not empty-side attribution.
            // Prevents cases like NBIS 7/17 $180p (BBS: 2 rows $470K) from ranking
            // at 143x $21.4M A+ HEAVY because rescue attribution counted every
            // empty-side put print as bearish. Grade/hasSweep/hasBlock/oiExceeded
            // still respect the rescued signals — the pattern signature is real,
            // just the volume magnitude shouldn't be inflated.
            if (!t._rescueDerived) {
              c.cleanHits++; c.cleanPrem += t.P;
              if (t.Si==="A"||t.Si==="AA") c.cleanAskPrem += t.P;
            }
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
              // Score reflects clean classified signal (cleanHits + cleanPrem),
              // NOT rescue-inflated totals. Grade/side/patterns still use the
              // full pattern including rescues so the pattern signature stays
              // accurate; only ranking magnitude is de-inflated.
              score:(scoreMap[grade]||0)+c.cleanHits*20+c.cleanPrem/5e3+voiBonus + (c.cleanHits<=1 && c.hasSweep && c.cleanAskPrem>c.bidPrem && c.oiExceeded && c.cleanPrem >= ((c.mktcap||0)>=500e9 ? 5e6 : 1e6) ? 250 : 0),
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
          // Score-rank cutoff: top 20 by conviction, then user can re-sort within.
          // Pre-compute display values (now, pnl, peak) once up front so sort and
          // render both use the same numbers (avoids inconsistency between sort
          // key and visible value).
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
          // Sort key extractor — works on the enriched objects so every column
          // can sort even when values are derived (P&L, Peak, etc.)
          const getSortVal = (r, col) => {
            switch (col) {
              case "Ticker":  return r.sym;
              case "Exp":     return r.DTE;            // DTE gives chronological order matching the exp display
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
            {/* Filters */}
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
            {/* Table */}
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
                          : { col: h, dir: "desc" }  // first click defaults to descending
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
                    const peakPrice = peakPnl !== 0 ? 1 : 0; // sentinel — peakPnl is the source of truth now
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
                onChange={e=>{ const v=e.target.value.toUpperCase(); setSearch(v); setSelectedTicker(D.TICKER_DB.find(t=>t.s===v)||null); setSearchDte("All"); setSearchGroup(null); setOiConfirmMap({}); setOiConfirmMeta(null); setOiConfirmedOnly(false); setOiConfirmError(null); }}
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
                // tickers in canonical upper case ("BE", "AAPL"). Before
                // this fix the filter used raw `search`, so typing "be"
                // (the natural way most people type) failed to match "BE"
                // via startsWith and short tickers were silently absent
                // from suggestions. Theme/sector matchers below correctly
                // used `q` (lower) against lower-cased haystacks; ticker
                // path was the odd one out.
                const qUpper = search.toUpperCase();
                const tickerMatches = D.ALL_SYMS.filter(s=>s.startsWith(qUpper)).slice(0,8);
                const themeMatches = Object.keys(THEMES_DEF).filter(t=>t.toLowerCase().includes(q)).slice(0,4);
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
                          if(!contracts[ck]) contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,DTE:t.DTE,askPrem:0,bidPrem:0,prices:[],maxOI:0};
                          const c=contracts[ck]; c.hits++; c.prem+=t.P;
                          if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
                          if(t.price>0) c.prices.push(t.price);
                          if(t.OI>c.maxOI) c.maxOI=t.OI;
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
                    {/* Top Ideas from batch */}
                    {(()=>{
                      const found = batchResults.filter(r=>r.found && r.net !== 0);
                      if (found.length < 2) return null;
                      // Score each
                      const scored = found.map(r => {
                        let sc = 0;
                        const absNet = Math.abs(r.net);
                        const convPct = r.dir==="BULL" ? r.bullPct : (100-r.bullPct);
                        sc += convPct >= 95 ? 25 : convPct >= 90 ? 20 : convPct >= 80 ? 15 : convPct >= 70 ? 10 : 5;
                        sc += r.hasSwp && r.hasBlk ? 25 : r.hasSwp ? 15 : 5;
                        sc += absNet >= 50e6 ? 15 : absNet >= 20e6 ? 12 : absNet >= 5e6 ? 9 : absNet >= 1e6 ? 6 : 3;
                        const tc = r.topContract;
                        if (tc) {
                          sc += tc.hits >= 10 ? 10 : tc.hits >= 5 ? 7 : tc.hits >= 3 ? 4 : 2;
                          if (tc.DTE >= 7 && tc.DTE <= 30) sc += 15;
                          else if (tc.DTE >= 3 && tc.DTE <= 45) sc += 10;
                          else sc += 5;
                        }
                        // Build reason
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
                          <div key={r.sym} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderBottom:"1px solid "+P.bd+"15", textAlign:"center", cursor:"pointer" }}
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
                    {/* Fetch Live OI & P/L for every visible top contract */}
                    {batchResults.filter(r=>r.found && r.topContract).length > 0 && (
                      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:6 }}>
                        <button onClick={()=>{
                          const all = [];
                          batchResults.forEach(r => {
                            if (r.found && r.topContract) all.push({ sym:r.sym, cp:r.topContract.cp, strike:r.topContract.K, exp:r.topContract.exp });
                          });
                          if (all.length) fetchPrices(all);
                        }} disabled={fetchLoading}
                          title="Fetch live OI and P/L for every Top Contract in this batch."
                          style={{ padding:"5px 12px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                            fontSize:9, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.ac, color:fetchLoading?P.dm:P.bg }}>
                          {fetchLoading?"Fetching…":"⚡ Fetch Live OI & P/L (all rows)"}
                        </button>
                      </div>
                    )}
                    <table style={{ width:"90%", margin:"0 auto", borderCollapse:"collapse", fontSize:10, tableLayout:"fixed" }}>
                      <colgroup>
                        <col style={{ width:"9%" }}/><col style={{ width:"7%" }}/><col style={{ width:"11%" }}/><col style={{ width:"11%" }}/>
                        <col style={{ width:"9%" }}/><col style={{ width:"12%" }}/><col style={{ width:"22%" }}/><col style={{ width:"9%" }}/><col style={{ width:"10%" }}/>
                      </colgroup>
                      <thead><tr style={{ borderBottom:"1px solid "+P.bd }}>
                        {[["Ticker","ticker"],["Bet",""],["Bull","bull"],["Bear","bear"],["Split",""],["Net","net"],["Top Contract",""],["Live OI",""],["P/L%",""]].map(([h,sk])=>{
                          const sortable = !!sk;
                          const active = batchSort===sk;
                          const arrow = active ? (batchSortDir==="desc"?" ▼":" ▲") : "";
                          return <th key={h||sk||Math.random()} onClick={sortable?()=>{
                            if(batchSort===sk) setBatchSortDir(d=>d==="desc"?"asc":"desc");
                            else { setBatchSort(sk); setBatchSortDir(sk==="ticker"?"asc":"desc"); }
                          }:undefined}
                            style={{ padding:"4px 5px", textAlign:"center", color:active?P.ac:P.mt, fontSize:9, fontWeight:active?800:600,
                              cursor:sortable?"pointer":"default", userSelect:"none" }}
                            title={h==="Live OI"?"Current OI from Schwab vs the max OI seen in the flow window. Green=position growing, red=fading. Click ⚡ Fetch above to populate.":h==="P/L%"?"Median entry from flow trades → current mark. Click ⚡ Fetch above to populate.":undefined}>
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
                              <td colSpan={8} style={{ padding:"5px", color:P.dm, fontSize:9 }}>No flow found</td>
                            </tr>
                          );
                          const dirC = r.dir==="BULL"?P.bu:P.be;
                          const tc = r.topContract;
                          const tcSide = tc?(tc.askPrem>=tc.bidPrem?"ask":"bid"):"ask";
                          let tcC = P.dm;
                          if(tc){ if(tc.cp==="C") tcC=tcSide==="ask"?P.bu:"#ff9800"; else tcC=tcSide==="ask"?P.be:"#29b6f6"; }
                          // Live OI + P/L computation. Both depend on priceCache being
                          // populated via the ⚡ Fetch button above. Until then, cells show "—".
                          const px = tc ? getPrice(r.sym, tc.cp, tc.K, tc.exp) : null;
                          const liveOI = px ? (px.oi || 0) : 0;
                          const baseOI = tc ? (tc.maxOI || 0) : 0;
                          const oiDelta = (liveOI > 0 && baseOI > 0) ? liveOI - baseOI : null;
                          const now = px ? (px.mark || px.last || px.mid || 0) : 0;
                          const entry = tc ? (tc.entry || 0) : 0;
                          const pnl = (now > 0 && entry > 0) ? (now-entry)/entry*100 : null;
                          const fmtDeltaOI = (d) => {
                            const sign = d > 0 ? "+" : "";
                            if (Math.abs(d) >= 1000) return sign + (d/1000).toFixed(1) + "k";
                            return sign + d.toLocaleString();
                          };
                          const deltaColor = (d) => d > 100 ? P.bu : d < -100 ? P.be : P.dm;
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
                              {/* Live OI cell — current OI with delta vs flow-window max. */}
                              <td style={{ padding:"5px", textAlign:"center", fontSize:9, fontFamily:"ui-monospace,monospace" }}
                                  onClick={e=>e.stopPropagation()}>
                                {liveOI > 0 ? (
                                  <span>
                                    <span style={{ color:P.wh, fontWeight:700 }}>{liveOI.toLocaleString()}</span>
                                    {oiDelta !== null && (
                                      <span style={{ color:deltaColor(oiDelta), fontWeight:800, marginLeft:4, fontSize:8 }}
                                            title={`Was ${baseOI.toLocaleString()} during flow window`}>
                                        {fmtDeltaOI(oiDelta)}
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ color:P.dm }}>—</span>
                                )}
                              </td>
                              {/* P/L% cell — median entry from flow trades vs current mark. */}
                              <td style={{ padding:"5px", textAlign:"center", fontSize:9, fontFamily:"ui-monospace,monospace" }}
                                  onClick={e=>e.stopPropagation()}>
                                {pnl !== null ? (
                                  <span style={{ color:pnl>0?P.bu:pnl<0?P.be:P.dm, fontWeight:800 }}
                                        title={`Entry $${entry.toFixed(2)} → Now $${now.toFixed(2)}`}>
                                    {pnl>=0?"+":""}{pnl.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span style={{ color:P.dm }}>—</span>
                                )}
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
                <div style={{ background:P.bg, border:"1px solid "+P.bd, borderRadius:12, padding:20, maxWidth:960, width:"90%", maxHeight:"80vh", overflow:"auto" }}
                  onClick={e=>e.stopPropagation()}>
                  {(()=>{
                    const d = batchDetail;
                    const dirC = d.dir==="BULL"?P.bu:P.be;
                    return (
                      <>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <span style={{ fontSize:20, fontWeight:900, color:P.wh }}>{d.sym}</span>
                            <span style={{ fontSize:8, color:P.dm }}>{capBand(d.mktcap)}</span>
                            <Tag c={dirC}>{d.dir}</Tag>
                            <span style={{ fontWeight:800, color:dirC, fontSize:14 }}>{fmt(Math.abs(d.net))}</span>
                            <span style={{ fontWeight:800, color:d.bullPct>=80?P.bu:d.bullPct<=20?P.be:P.dm, fontSize:11 }}>{d.bullPct}% bull</span>
                          </div>
                          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                            <button onClick={()=>{
                              fetchPrices(d.contracts.map(c=>({sym:d.sym,cp:c.cp,strike:c.K,exp:c.exp})));
                            }} disabled={fetchLoading}
                              style={{ padding:"6px 14px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                                fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.ac, color:fetchLoading?P.dm:P.bg }}>
                              {fetchLoading?"Fetching…":"⚡ Fetch Live OI & Prices"}
                            </button>
                            <button onClick={()=>{ setSearch(d.sym); setSelectedTicker(FD.TICKER_DB.find(t=>t.s===d.sym)||null); setSearchDte("All"); setBatchMode(false); setBatchResults(null); setBatchDetail(null); }}
                              style={{ padding:"6px 14px", borderRadius:6, border:"1px solid "+P.bd, cursor:"pointer",
                                fontSize:10, fontWeight:700, fontFamily:"inherit", background:"transparent", color:P.mt }}>
                              Open in Search →
                            </button>
                            <button onClick={()=>setBatchDetail(null)}
                              style={{ padding:"4px 10px", borderRadius:6, border:"none", cursor:"pointer", fontSize:14, fontWeight:700, fontFamily:"inherit", background:"transparent", color:P.dm }}>✕</button>
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
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
            {selectedTicker && (() => {
              // Re-resolve against current D each render to avoid stale snapshot.
              // selectedTicker is captured at setSelectedTicker time (line 5048); if
              // dateFilter or cap changes after, D regenerates but selectedTicker
              // still holds the old TICKER_DB entry — which makes tk.n / tk.t /
              // tk.c reflect a different date window than ccAll / BULL / BEAR.
              const tk = (D && D.TICKER_DB || []).find(t => t.s === selectedTicker.s) || selectedTicker;
              // DTE filter for summary cards
              const dteF = t => searchDte==="All" ? true : searchDte==="ST" ? t.DTE>=0&&t.DTE<60 : searchDte==="LT" ? t.DTE>=60&&t.DTE<180 : t.DTE>=180;
              // Source changed from D.clean_confirmed → D.all_directional so the
              // Search header reflects the same directional flow the watchlist
              // surfaces via the dirty-dominant fallback. clean_confirmed is
              // empty for all-WHITE-color tickers like SERV (60+ ASK sweeps,
              // no YELLOW/MAGENTA confirmation) which made the header read $0
              // even when the table below clearly showed $1.3M of directional
              // flow. all_directional includes any trade with t.D assigned —
              // catches the dirty-dominant pattern without losing precision
              // (B-side ambiguous trades still don't get direction so they're
              // excluded automatically).
              // Also exclude trades where direction was derived by our rescue
              // rules (ML/ isolation attribution, sibling BLOCK inheritance) —
              // Search should show BBS-comparable clean directional flow. The
              // rescues stay active in the watchlist scoring pipeline where
              // they help; here they'd inflate the totals ~3x because Massive
              // lacks BID-side classification (so rescue attribution is
              // trivially one-directional per CP).
              const ccAll = (D.all_directional||[]).filter(t => t.S===tk.s && !t._rescueDerived);
              const ccTrades = ccAll.filter(dteF);
              // Raw totals — clean-classified directional flow only.
              let ccB=0, ccR=0;
              ccTrades.forEach(t => { if(t.D==="BULL") ccB+=t.P; else if(t.D==="BEAR") ccR+=t.P; });
              // Confirmed-only totals — same trades but restricted to contracts
              // whose OI actually grew in the days after the trade (real adds
              // vs same-day churn). Populated by fetchOIConfirmations. If a
              // contract has no snapshot data yet (weekends / no data / new
              // contract), treat as unconfirmed (excluded) so the confirmed
              // number is strictly a subset of raw.
              let ccBConf=0, ccRConf=0;
              // Rebuild lookup key using same format sent to backend
              // (M/D/YYYY expiry, not the short "M/D" from t.E). Otherwise the
              // server returns confirmations keyed like "SPCX|C|165|12/17/2027"
              // but we'd look up "SPCX|C|165|12/17" locally and miss every match.
              const _fmtExpFull = (v) => {
                if (!v) return "";
                if (v instanceof Date) return (v.getMonth()+1)+"/"+v.getDate()+"/"+v.getFullYear();
                return String(v);
              };
              ccTrades.forEach(t => {
                const k = `${t.S}|${t.CP}|${t.K}|${_fmtExpFull(t.expiry)}`;
                const conf = oiConfirmMap[k];
                if (!conf || !conf.confirmed) return;
                if (t.D === "BULL") ccBConf += t.P;
                else if (t.D === "BEAR") ccRConf += t.P;
              });
              // Top-line totals are computed AFTER the still-open block below,
              // so the "Still open only" toggle can use the live-OI still-open
              // premium instead of the fixed-window OI confirmation.

              // ─── STILL-OPEN computation ────────────────────────────────
              // Per-contract attribution of "how much of this period's
              // directional flow is still open today, vs already closed out".
              // Groups trades by contract, computes ΔOI = liveOI - earliestOI,
              // derives an openFraction = clamp(0,1, ΔOI / V_total). Apply
              // uniformly to all trades on that contract. This is the best we
              // can do without per-trade time-stamped OI history: we know how
              // much NET position-building happened on the contract, not which
              // specific trades stayed open vs closed.
              //
              // openFraction = 0 → all positions closed since
              // openFraction = 1 → all volume net-added to OI (full retention)
              // computable = at least one contract had usable live OI data
              //
              // We track BOTH total bull/bear premium AND priced bull/bear
              // premium separately. The % displayed alongside "Still open"
              // uses the PRICED subset as denominator — otherwise the %
              // gets dragged down by unpriced contracts (which contribute
              // to total but not to the still-open numerator), which would
              // mislead users into thinking more positions closed than
              // actually did.
              let ccBOpen = 0, ccROpen = 0;
              let pricedBullPrem = 0, pricedBearPrem = 0;
              let openContractsPriced = 0, openContractsTotal = 0;
              {
                const byCt = {};
                ccTrades.forEach(t => {
                  const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
                  if (!byCt[k]) byCt[k] = { trades:[], V_total:0, minOI:Infinity };
                  byCt[k].trades.push(t);
                  byCt[k].V_total += (t.V||0);
                  if ((t.OI||0) > 0) byCt[k].minOI = Math.min(byCt[k].minOI, t.OI);
                });
                Object.entries(byCt).forEach(([k, g]) => {
                  openContractsTotal++;
                  const [s, cp, kK, e] = k.split("|");
                  const px = getPrice(s, cp, parseFloat(kK), e);
                  // Need live OI + a baseline OI + nonzero volume to attribute.
                  if (!px || !px.oi || g.minOI === Infinity || g.V_total <= 0) return;
                  openContractsPriced++;
                  // Accumulate this contract's premium into the "priced"
                  // bucket so we can compute an honest % later.
                  g.trades.forEach(t => {
                    if (t.D==="BULL") pricedBullPrem += (t.P||0);
                    else if (t.D==="BEAR") pricedBearPrem += (t.P||0);
                  });
                  const deltaOI = px.oi - g.minOI;
                  const openFrac = Math.max(0, Math.min(1, deltaOI / g.V_total));
                  g.trades.forEach(t => {
                    if (t.D==="BULL") ccBOpen += (t.P||0) * openFrac;
                    else if (t.D==="BEAR") ccROpen += (t.P||0) * openFrac;
                  });
                });
              }
              const stillOpenComputable = openContractsPriced > 0;
              const totalOpen = ccBOpen + ccROpen;
              const netOpen = ccBOpen - ccROpen;
              const dirOpen = totalOpen===0?"NEUTRAL":netOpen>0?"BULL":"BEAR";

              // Top-line totals. When "Still open only" is toggled AND live OI
              // is available, use the still-open premium (ccBOpen/ccROpen) — the
              // range-independent measure that matches the per-row Status column.
              // Falls back to raw when live OI isn't fetched yet. This replaces
              // the old fixed-window OI confirmation, which under-confirmed slow
              // builders over long ranges and falsely flipped the direction.
              const _useOpen = oiConfirmedOnly && stillOpenComputable;
              const ccBDisplay = _useOpen ? Math.round(ccBOpen) : ccB;
              const ccRDisplay = _useOpen ? Math.round(ccROpen) : ccR;
              const net = ccBDisplay - ccRDisplay;
              const total = ccBDisplay + ccRDisplay;
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
                    {/* OI-Confirmation controls — filter Search totals to
                        contracts whose OI grew in the days after the trade.
                        Reveals real institutional adds vs same-day churn.
                        Load button only enabled until data is fetched, then
                        toggle switches display. */}
                    <div style={{ marginLeft:12, display:"flex", gap:6, alignItems:"center", borderLeft:"1px solid "+P.bd, paddingLeft:12 }}>
                      <button
                        onClick={()=> setOiConfirmedOnly(v=>!v)}
                        disabled={!stillOpenComputable}
                        style={{
                          padding:"4px 12px", borderRadius:16, border:"1.5px solid "+(oiConfirmedOnly?P.bu:P.bd),
                          cursor:!stillOpenComputable?"not-allowed":"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit",
                          background:oiConfirmedOnly?P.bu+"22":"transparent",
                          color:oiConfirmedOnly?P.bu:(stillOpenComputable?P.mt:"#555"),
                          opacity:stillOpenComputable?1:0.6,
                        }}
                        title={stillOpenComputable ? "Filter bull/bear totals to still-open flow (Live OI \u2265 entry) — excludes closed/exited positions. Range-independent, matches the Status column." : "Fetch Live OI & Prices first (blue button), then this filters to still-open flow"}
                      >
                        {oiConfirmedOnly ? "\u2713 Still open only" : (stillOpenComputable ? "Still open only" : "Still open only \u00b7 fetch OI")}
                      </button>
                      {oiConfirmError && (
                        <span style={{ fontSize:9, color:P.be }} title={oiConfirmError}>err</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16, borderTop:"3px solid "+dirC }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Net Direction{searchDte!=="All"?" ("+({ST:"0–59d",LT:"60–179d",LEAPS:"180+d"})[searchDte]+")":""}</div>
                      <div style={{ fontSize:28, fontWeight:900, color:dirC }}>{dir}</div>
                      <div style={{ fontSize:10, color:P.dm, marginTop:4 }}>{ccTrades.length} directional trades</div>
                      {/* Still-open net direction — shows if the net read
                          flips once you account for closures. */}
                      {stillOpenComputable && (
                        <div style={{ fontSize:9, color:P.dm, marginTop:6, paddingTop:6, borderTop:"1px dashed "+P.bd }}>
                          Still open:{" "}
                          <span style={{ color:dirOpen==="BULL"?P.bu:dirOpen==="BEAR"?P.be:P.dm, fontWeight:700 }}>
                            {dirOpen}
                          </span>
                          {dirOpen !== dir && total > 0 && (
                            <span style={{ marginLeft:4, color:P.ac, fontWeight:700 }} title="Net direction flips once closures are accounted for">⚠ flipped</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bullish Flow{oiConfirmedOnly?" (Still Open)":""}</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.bu }}>{fmt(ccBDisplay)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:(total>0?(ccBDisplay/total*100):0)+"%", height:"100%", background:P.bu, borderRadius:2 }} />
                      </div>
                      {/* When confirmed toggle is OFF but we have confirmation
                          data, show what's confirmed as subtitle. When ON, show
                          the raw baseline instead. Lets the user compare at a
                          glance without toggling back and forth. */}
                      {oiConfirmMeta && (
                        <div style={{ fontSize:9, color:P.dm, marginTop:6 }}>
                          {oiConfirmedOnly ? (
                            <>Raw: <span style={{ color:P.bu, fontWeight:700 }}>{fmt(ccB)}</span></>
                          ) : (
                            <>Confirmed: <span style={{ color:P.bu, fontWeight:700 }}>{fmt(ccBConf)}</span>
                              {ccB>0 && <span style={{ marginLeft:4 }}>({Math.round(ccBConf/ccB*100)}%)</span>}</>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize:9, color:P.dm, marginTop:6 }}>
                        Still open:{" "}
                        {stillOpenComputable ? (
                          <>
                            <span style={{ color:P.bu, fontWeight:700 }}>{fmt(ccBOpen)}</span>
                            <span style={{ marginLeft:4 }}>
                              ({pricedBullPrem > 0 ? Math.round(ccBOpen/pricedBullPrem*100) : 0}% of priced
                              {openContractsPriced < openContractsTotal && `, ${openContractsTotal - openContractsPriced} missing OI`})
                            </span>
                          </>
                        ) : (
                          <span style={{ fontStyle:"italic" }}>Fetch Live OI to compute</span>
                        )}
                      </div>
                    </div>
                    <div style={{ background:P.cd, border:"1px solid "+P.bd, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:11, color:P.dm, marginBottom:4 }}>Bearish Flow{oiConfirmedOnly?" (Still Open)":""}</div>
                      <div style={{ fontSize:22, fontWeight:800, color:P.be }}>{fmt(ccRDisplay)}</div>
                      <div style={{ width:"100%", height:4, background:P.al, borderRadius:2, marginTop:8 }}>
                        <div style={{ width:(total>0?(ccRDisplay/total*100):0)+"%", height:"100%", background:P.be, borderRadius:2 }} />
                      </div>
                      {oiConfirmMeta && (
                        <div style={{ fontSize:9, color:P.dm, marginTop:6 }}>
                          {oiConfirmedOnly ? (
                            <>Raw: <span style={{ color:P.be, fontWeight:700 }}>{fmt(ccR)}</span></>
                          ) : (
                            <>Confirmed: <span style={{ color:P.be, fontWeight:700 }}>{fmt(ccRConf)}</span>
                              {ccR>0 && <span style={{ marginLeft:4 }}>({Math.round(ccRConf/ccR*100)}%)</span>}</>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize:9, color:P.dm, marginTop:6 }}>
                        Still open:{" "}
                        {stillOpenComputable ? (
                          <>
                            <span style={{ color:P.be, fontWeight:700 }}>{fmt(ccROpen)}</span>
                            <span style={{ marginLeft:4 }}>
                              ({pricedBearPrem > 0 ? Math.round(ccROpen/pricedBearPrem*100) : 0}% of priced
                              {openContractsPriced < openContractsTotal && `, ${openContractsTotal - openContractsPriced} missing OI`})
                            </span>
                          </>
                        ) : (
                          <span style={{ fontStyle:"italic" }}>Fetch Live OI to compute</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <button onClick={()=>{
                      // Send ALL unique directional contracts for the ticker to
                      // Schwab, not just the top-10 visible + consolidated.
                      // Without this, "Still open" % was capped by tiny coverage
                      // (e.g., 14/106 contracts). Schwab batches dynamically so
                      // 100+ contracts still completes in a few seconds.
                      const seen = new Set();
                      const contracts = [];
                      const pushUnique = (S, CP, K, E) => {
                        const key = S+"|"+CP+"|"+K+"|"+E;
                        if (seen.has(key)) return;
                        seen.add(key);
                        contracts.push({sym:S, cp:CP, strike:K, exp:E});
                      };
                      // ccAll = all directional trades for this ticker
                      // (unfiltered by DTE; user might switch DTE later and
                      // we want priced data ready regardless)
                      ccAll.forEach(r => pushUnique(r.S, r.CP, r.K, r.E));
                      // Also price the trades actually SHOWN in the Top-Trades
                      // table (tk.t). It's ranked by premium across ALL trades,
                      // so it includes non-directional / rescue-derived prints
                      // that ccAll (directional-only) excludes. Without this they
                      // render Now / Live OI / ΔOI as "—" even though the status
                      // reads "N priced of N" (N = the directional contract count).
                      (tk.t||[]).forEach(r => pushUnique(r.S, r.CP, r.K, r.E));
                      // Also include consolidated rows in case any aren't
                      // covered by trade-level data
                      (tk.c||[]).forEach(r => pushUnique(r.S, r.CP, r.K, r.E));
                      fetchPrices(contracts);
                    }} disabled={fetchLoading}
                      style={{ padding:"6px 16px", borderRadius:6, border:"none", cursor:fetchLoading?"not-allowed":"pointer",
                        fontSize:10, fontWeight:700, fontFamily:"inherit", background:fetchLoading?P.bd:P.sw, color:fetchLoading?P.dm:P.bg }}>
                      {fetchLoading?"Fetching…":"⚡ Fetch Live OI & Prices"}
                    </button>
                    <span style={{ fontSize:9, color:P.dm }}>Updates Now, P&L, OI, ΔOI, Greeks across both tables</span>
                    {status && <span style={{ fontSize:9, color:P.dm }}>{status}</span>}
                  </div>
                  {/* Top Trades table — panelFn intentionally omitted. The
                      outer modal-version of renderDetailPanel (just below)
                      handles the expanded view. Passing panelFn made TT also
                      render an inline copy, creating a double-layer panel
                      that required two clicks to close. */}
                  <Card title={tk.s+" — Top Trades by Premium"} sub={tk.n+" total"}><TT rows={tk.t} priceFn={getPrice} fadeOnStale={true} onRowClick={r=>{ fetchContractHistory(r.S,r.CP,r.K,r.E); setSelectedItem(prev=>prev&&prev.sym===r.S&&prev.cp===r.CP&&String(prev.K)===String(r.K)&&prev.exp===r.E?null:{sym:r.S,cp:r.CP,K:r.K,exp:r.E}); }}/></Card>
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
                    const isEtf = isETF(w.S, "");
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
                const isEtf = isETF(w.S, "");
                return dataMode === "stocks" ? !isEtf : isEtf;
              };
              const watchAll = oiSearch ? D.WATCH.filter(w=>(w.S||"").includes(oiSearch)&&w.OI>=5).filter(_tabOk).sort((a,b)=>b.P-a.P).slice(0,40)
                : D.WATCH.filter(w=>w.OI>=5&&(capFilter==="All"||w.cap===capFilter)).filter(_tabOk).slice(0,100);
              // Enrich with live OI data
              const enriched = watchAll.map(r => {
                const px = getPrice(r.S, r.CP, r.K, r.E);
                const curOI = px ? (px.oi||0) : 0;
                const liveFetched = curOI > 0;
                const baseOI = r.firstOI > 0 ? r.firstOI : (r.OI || 0);
                // Gate on whether live OI was FETCHED, not on the delta being
                // non-zero. A genuinely flat position (curOI === baseOI) must
                // report 0 — not silently revert to the CSV delta. Fall back to
                // csvDOI only when live wasn't fetched or there's no baseline.
                const liveDOI = (liveFetched && baseOI > 0) ? curOI - baseOI : 0;
                const bestDOI = (liveFetched && baseOI > 0) ? liveDOI : (r.csvDOI || 0);
                const bestLastOI = curOI > 0 ? curOI : r.lastOI || 0;
                const pctDOI = baseOI > 0 && bestDOI !== 0 ? Math.round(bestDOI / baseOI * 100) : 0;
                // NEW: OI grew 10x+ off the first-seen base — the contract was
                // essentially fresh when flow appeared, so the raw %ΔOI is off a
                // tiny base and unreadable. Tag it instead of showing +9,772%.
                const isNewOI = pctDOI >= 1000;
                // ── Peak-aware retention (NOW vs the position's PEAK OI) ──
                // A two-point First→Last ΔOI is blind to build-then-cut: RIOT
                // went 51 → ~20,849 → 7,546 (built big, then shed ~64%), yet
                // First→Last still reads +7,495 "NEW". Comparing NOW vs PEAK
                // surfaces the unwind. Peak = max OI across flow-day snapshots +
                // live; it's approximate when flow didn't coincide with the true
                // peak, but strictly better than a blind two-point delta.
                const dailyVals = r.dailyOI ? Object.values(r.dailyOI).filter(v => v > 0) : [];
                const peakOI = Math.max(baseOI || 0, bestLastOI || 0, curOI || 0, ...(dailyVals.length ? dailyVals : [0]));
                const nowOI = curOI > 0 ? curOI : (bestLastOI || 0);
                const retention = peakOI > 0 ? nowOI / peakOI : 1;
                const carriedPct = Math.round(retention * 100);
                // State band from % of peak still open. NEW only fires when the
                // position is still ~intact at its peak — a build that's been cut
                // (RIOT, 36%) reads REDUCED, not NEW.
                let oiState, oiStateColor;
                if (peakOI <= 0) { oiState = "—"; oiStateColor = P.mt; }
                else if (retention < 0.15) { oiState = "CLOSED"; oiStateColor = P.be; }
                else if (retention < 0.50) { oiState = "REDUCED"; oiStateColor = "#e06c3c"; }
                else if (retention < 0.90) { oiState = "TRIMMED"; oiStateColor = "#c9a84c"; }
                else if (isNewOI) { oiState = "NEW"; oiStateColor = "#3cb868"; }
                else if (nowOI >= peakOI) { oiState = "BUILDING"; oiStateColor = P.bu; }
                else { oiState = "HELD"; oiStateColor = "#5b9bd5"; }
                return { ...r, curOI, dOI: bestDOI, displayLastOI: bestLastOI, pctDOI, isNewOI, peakOI, nowOI, carriedPct, retention, oiState, oiStateColor };
              });
              // Sort
              const getVal = (r, key) => {
                if (key==="sym") return r.S||"";
                if (key==="exp") return new Date(r.E||0).getTime();
                if (key==="strike") return parseFloat(r.K)||0;
                if (key==="entry") return r.price||0;
                if (key==="premium") return r.P||0;
                if (key==="vol") return r.V||0;
                if (key==="firstOI") return r.firstOI||0;
                if (key==="doi") return r.dOI||0;
                if (key==="pctDOI") return r.pctDOI||0;
                if (key==="retention") return r.retention||0;
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
                {key:"vol",label:"Vol"},{key:"firstOI",label:"First OI"},{key:"lastOI",label:"Last OI"},{key:"doi",label:"ΔOI"},{key:"retention",label:"State"},{key:"flowDate",label:"Date"},{key:"dte",label:"DTE"}
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
                        <td style={{ padding:"5px 4px" }}
                          title={r.peakOI>0?"First seen "+(r.firstOI||0).toLocaleString()+" · peak "+r.peakOI.toLocaleString()+" · now "+(r.nowOI||0).toLocaleString()+" = "+r.carriedPct+"% carried over ("+(100-r.carriedPct)+"% closed from peak). Peak = max OI on flow days + live, so it can understate if flow missed the true peak day.":undefined}>
                          {r.oiState && r.oiState!=="—" ? (
                            <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                              <span style={{ fontSize:8, fontWeight:800, padding:"1px 5px", borderRadius:3, background:r.oiStateColor+"22", color:r.oiStateColor, letterSpacing:0.3, whiteSpace:"nowrap" }}>{r.oiState}</span>
                              {(r.oiState==="TRIMMED"||r.oiState==="REDUCED"||r.oiState==="CLOSED") && <span style={{ fontSize:9, color:r.oiStateColor, fontWeight:700 }}>{r.carriedPct}%</span>}
                            </span>
                          ) : <span style={{ color:P.mt }}>—</span>}
                        </td>
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
            const isEtf = isETF(p.sym, p.stocketf||"");
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
                    fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>All</button>
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
                  {/* C/P filter — All / Calls / Puts. Direction-colored for fast visual scan. */}
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
                        fetch("/api/top-flow/snapshot",{method:"POST"}).then(()=>fetch("/api/top-flow/history").then(r=>r.ok?r.json():null).then(d=>{if(d)setTopFlowPicks(d);})).catch(()=>{});
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
                      // OI: prefer CSV cross-reference, fallback to snapshot history
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
                          style={{ borderBottom:"1px solid "+P.bd+"10", textAlign:"center", cursor:"pointer" }}
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
                {/* Strike/Exp */}
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
                {/* Meta + Remove */}
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
              {/* Removal reason prompt */}
              {isRemoving && (
                <div style={{ padding:"8px 10px", background:P.be+"06", border:"1px solid "+P.be+"40", borderTop:"none", borderRadius:"0 0 6px 6px" }}
                  onClick={e=>e.stopPropagation()}>
                  <div style={{ fontSize:10, fontWeight:700, color:P.be, marginBottom:6 }}>Why are you removing {item.sym}?</div>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:6 }}>
                    {REMOVE_REASONS.map(r=>(
                      <button key={r} onClick={()=>confirmRemove(r)}
                        style={{ padding:"3px 10px", borderRadius:4, border:"1px solid "+P.be+"30", background:P.al, color:P.dm, fontSize:9, fontWeight:600, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}
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
                      style={{ padding:"4px 10px", borderRadius:4, border:"1px solid "+P.bd, background:"transparent", color:P.dm, fontSize:9, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>Cancel</button>
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
                    style={{ padding:"5px 14px", borderRadius:5, border:"1px solid "+P.ac+"60", background:"transparent", color:P.ac, fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>
                    ⟳ Auto-Fill from Scanner
                  </button>
                  <button onClick={wlPopulateUnusual}
                    style={{ padding:"5px 14px", borderRadius:5, border:"1px solid #c9a84c60", background:"transparent", color:"#c9a84c", fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>
                    ⟳ Fill from Unusual
                  </button>
                  <button onClick={wlSave}
                    style={{ padding:"5px 14px", borderRadius:5, border:"none", background:P.sw, color:P.bg, fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>
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
                </div>
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
              // Compute DTE and filter
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
              const sortedBullIdx = filtBull.map((_,i)=>i).sort((a,b)=>(filtBull[b].score||0)-(filtBull[a].score||0));
              const sortedBearIdx = filtBear.map((_,i)=>i).sort((a,b)=>(filtBear[b].score||0)-(filtBear[a].score||0));
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
                <div ref={wlBullRef}>
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
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.bu+"22", color:P.bu, fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>+ Add</button>
                    </div>
                  </div>
                </Card>
                </div>
                <div ref={wlBearRef}>
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
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.be+"22", color:P.be, fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>+ Add</button>
                    </div>
                  </div>
                </Card>
                </div>
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
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.bu+"22", color:P.bu, fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>+ Add</button>
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
                        style={{ padding:"5px 12px", borderRadius:4, border:"none", background:P.be+"22", color:P.be, fontSize:10, fontWeight:700, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>+ Add</button>
                    </div>
                  </Card>
                </>); })()}
                </>
              )}
            </div>
              );
            })()}
            </div>
            {/* Scanner Suggestions — overflow picks not yet on watchlist */}
            {FD && FD.CONV && (() => {
              const existingSyms = new Set([...wlBull.map(i=>i.sym+"|"+i.exp+"|"+i.strike), ...wlBear.map(i=>i.sym+"|"+i.exp+"|"+i.strike)]);
              const dteOkSugg = (c) => {
                if (wlDteFilter === "All") return true;
                const dte = c.DTE || 0;
                if (wlDteFilter === "1-2W") return dte >= 5 && dte <= 14;
                if (wlDteFilter === "ST") return dte < 60;
                if (wlDteFilter === "LT") return dte >= 60 && dte < 180;
                return dte >= 180;
              };
              // 2026-07-03: same ETF/INDEX filter as bulls/bears above -
              // scanner suggestions should honor the current tab. Uses
              // component-scope isETF().
              const _isStockSugg = (c) => !isETF(c.sym, c.stocketf);
              const _tabFilterSugg = dataMode === "stocks" ? _isStockSugg : ((c) => !_isStockSugg(c));
              const overflow = FD.CONV.filter(c=>!existingSyms.has(c.sym+"|"+c.exp+"|"+(c.K||c.strike)) && dteOkSugg(c) && _tabFilterSugg(c))
                .map(c=>({...c, _score:autoScore(c), _cap:wlCapCheck(c)}))
                .sort((a,b)=>b._score-a._score);
              const bullSugg = overflow.filter(c=>c.dir==="BULL").slice(0,15);
              const bearSugg = overflow.filter(c=>c.dir==="BEAR").slice(0,15);
              if (!bullSugg.length && !bearSugg.length) return null;

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
                    style={{ padding:"2px 8px", borderRadius:3, border:"none", background:side==="bull"?P.bu+"22":P.be+"22", color:side==="bull"?P.bu:P.be, fontSize:10, fontWeight:800, fontFamily:"inherit", textAlign:"center", cursor:"pointer" }}>+</button>
                  <span style={{ fontSize:12, fontWeight:800, color:P.wh, minWidth:50 }}>{c.sym}</span>
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
                      <div style={{ fontSize:10, fontWeight:700, color:P.bu, marginBottom:4 }}>▲ Bull ({bullSugg.length})</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        {bullSugg.map(c=>renderSuggRow(c,"bull"))}
                        {!bullSugg.length && <div style={{ fontSize:10, color:P.dm, padding:8 }}>No more bull suggestions</div>}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:10, fontWeight:700, color:P.be, marginBottom:4 }}>▼ Bear ({bearSugg.length})</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        {bearSugg.map(c=>renderSuggRow(c,"bear"))}
                        {!bearSugg.length && <div style={{ fontSize:10, color:P.dm, padding:8 }}>No more bear suggestions</div>}
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
