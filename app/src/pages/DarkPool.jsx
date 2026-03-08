import React, { useState, useMemo, useEffect, useRef } from 'react';

// --- FALLBACK SAMPLE DATA ---
// Used only if data.csv cannot be found on the server.
const fallbackData = {
  D: {
    dates: ["2026-01-21","2026-01-22","2026-01-23"],
    dateLabels: ["01/21","01/22","01/23"],
    categories: [
      {
        name: "Indexes", desc: "Broad market barometers.", totalNotional: 364365889823, count: 2,
        items: [
          { t: "SPY", cat: "Indexes", n: 170501225805, lo: 685.49, hi: 692.08, last: 683.21, vwap: 688.04, c: 1251, pos: "below", pct: -0.33, u: true, prices: [null,688.33,689.16], w: [null,0.488,0.296], top5: ["01/22 @ $688.97  $1.04B","03/04 @ $685.49  $1.04B"] },
          { t: "QQQ", cat: "Indexes", n: 87787502905, lo: 605.96, hi: 621.03, last: 609.63, vwap: 613.34, c: 904, pos: "in", pct: 0, u: true, prices: [null,619.56,622.42], w: [null,0.261,0.243], top5: ["01/29 @ $625.91  $1.25B"] }
        ]
      }
    ],
    above: [
      { t: "PBF", cat: "Large Cap", n: 101923122, lo: 33.21, hi: 35.59, last: 45.66, vwap: 35.64, c: 9, pos: "above", pct: 28.29, u: false, prices: [null,null,null], w: [null,null,null], top5: ["02/11 @ $35.59  $19.9M"] }
    ],
    below: [
      { t: "SF", cat: "Mid Cap", n: 80180245, lo: 118.11, hi: 123.54, last: 75.57, vwap: 115.01, c: 5, pos: "below", pct: -36.02, u: true, prices: [null,null,null], w: [null,null,null], top5: ["02/03 @ $124.28  $26.5M"] }
    ],
    phantom: [],
    options: [],
    alpha: [],
    cancelled: []
  },
  SD: { f: [], c: [] }
};

const CA = {
  "Indexes": "#4e9fff",
  "Large Cap": "#a78bfa",
  "Mid Cap": "#ffb347",
  "Small Cap": "#ff5c72",
  "Sector ETFs": "#2dd4a0",
  "Bond ETFs": "#22d3ee",
  "Intl/EM ETFs": "#f472b6",
  "Commodity ETFs": "#fb923c"
};

const CI = {
  "Indexes": "📊",
  "Large Cap": "🏢",
  "Mid Cap": "🔸",
  "Small Cap": "💎",
  "Sector ETFs": "🏭",
  "Bond ETFs": "📉",
  "Intl/EM ETFs": "🌍",
  "Commodity ETFs": "⛏️"
};

function fmt(n) {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + n;
}

function fP(p) {
  return p != null && !isNaN(p) ? "$" + p.toFixed(2) : "—";
}

// --- LIVE CSV TO JSON AGGREGATOR ---
// This function parses your raw CSV and mathematically converts it into 
// the structured dashboard format (calculating 25th-75th percentile zones, VWAP, sparkline data, etc).
function buildDashboardDataFromCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return fallbackData;

  const headers = lines[0].split(',').map(h => h.trim());
  
  const D = {
    dates: [], dateLabels: [], categories: [], above: [], below: [],
    phantom: [], options: [], alpha: [], cancelled: []
  };

  const dateSet = new Set();
  const tickerMap = {};

  for (let i = 1; i < lines.length; i++) {
    // Basic CSV row split handling quotes
    const row = [];
    let inQuote = false;
    let current = '';
    for (let char of lines[i]) {
        if (char === '"') inQuote = !inQuote;
        else if (char === ',' && !inQuote) { row.push(current); current = ''; }
        else current += char;
    }
    row.push(current);

    const obj = {};
    headers.forEach((h, idx) => { obj[h] = row[idx] ? row[idx].trim() : null; });
    
    const tkr = obj.Ticker;
    if (!tkr) continue;
    
    const date = obj.Date ? obj.Date.split(' ')[0] : null;
    if (date) dateSet.add(date);
    
    if (!tickerMap[tkr]) tickerMap[tkr] = { t: tkr, prints: [], u: false, n: 0, c: 0 };
    
    const price = parseFloat(obj.Price);
    const notional = parseFloat(obj.Notional);
    const msg = obj.Message || "";
    
    if (msg.toLowerCase().includes("cancel")) {
        D.cancelled.push({ ticker: tkr, date, price, notional, message: msg });
        continue;
    }
    if (msg.includes("CALL") || msg.includes("PUT")) {
        D.options.push({ ticker: tkr, date, price, message: msg });
    }
    if (msg.toLowerCase().includes("unusual")) {
        tickerMap[tkr].u = true;
    }
    if (msg.toLowerCase().includes("alpha")) {
        D.alpha.push({ ticker: tkr, date, price });
    }
    
    // Only aggregate valid block prints
    if (!isNaN(price) && !isNaN(notional) && notional > 0) {
        tickerMap[tkr].prints.push({ date, price, notional, msg });
        tickerMap[tkr].n += notional;
        tickerMap[tkr].c += 1;
    }
  }

  D.dates = Array.from(dateSet).sort((a,b) => new Date(a) - new Date(b));
  D.dateLabels = D.dates.map(d => {
     const parts = d.split('/');
     if (parts.length >= 2) return `${parts[0].padStart(2,'0')}/${parts[1].padStart(2,'0')}`;
     return d;
  });

  const processedTickers = [];
  const indexETFs = ['SPY', 'QQQ', 'IWM', 'DIA', 'MDY', 'RSP', 'VTI', 'VOO', 'IVV', 'TQQQ', 'SQQQ', 'IJR', 'VXUS', 'VUG'];

  Object.values(tickerMap).forEach(tkr => {
      if (tkr.prints.length === 0) return;
      
      // Calculate Top 5 prints
      const sortedPrints = [...tkr.prints].sort((a,b) => b.notional - a.notional);
      tkr.top5 = sortedPrints.slice(0,5).map(p => `${p.date} @ $${p.price.toFixed(2)}  ${fmt(p.notional)}`);
      
      // Calculate 25th - 75th Percentile Zone
      const prices = tkr.prints.map(p => p.price).sort((a,b) => a - b);
      tkr.lo = prices[Math.floor(prices.length * 0.25)] || prices[0];
      tkr.hi = prices[Math.floor(prices.length * 0.75)] || prices[prices.length-1];
      
      let totalVal = 0;
      let lastDate = "01/01/1900";
      let lastPrice = prices[0];
      
      const dailyNotional = {};
      const dailyVwap = {};
      
      tkr.prints.forEach(p => {
         totalVal += (p.price * p.notional);
         if (new Date(p.date) >= new Date(lastDate)) {
             lastDate = p.date;
             lastPrice = p.price;
         }
         if (!dailyNotional[p.date]) { dailyNotional[p.date] = 0; dailyVwap[p.date] = 0; }
         dailyNotional[p.date] += p.notional;
         dailyVwap[p.date] += (p.price * p.notional);
      });
      
      tkr.vwap = totalVal / tkr.n;
      tkr.last = lastPrice;
      
      // Determine Position Status vs Zone
      if (tkr.last > tkr.hi) {
          tkr.pos = "above";
          tkr.pct = parseFloat((((tkr.last - tkr.hi) / tkr.hi) * 100).toFixed(2));
      } else if (tkr.last < tkr.lo) {
          tkr.pos = "below";
          tkr.pct = parseFloat((((tkr.last - tkr.lo) / tkr.lo) * 100).toFixed(2));
      } else {
          tkr.pos = "in";
          tkr.pct = 0;
      }

      // Generate Sparkline Array Data
      tkr.prices = [];
      tkr.w = [];
      const maxN = Math.max(...Object.values(dailyNotional), 1);
      
      D.dates.forEach(d => {
          if (dailyNotional[d]) {
              tkr.prices.push(dailyVwap[d] / dailyNotional[d]);
              tkr.w.push(parseFloat((dailyNotional[d] / maxN).toFixed(3)));
          } else {
              tkr.prices.push(null);
              tkr.w.push(null);
          }
      });

      // Auto Categorize
      if (indexETFs.includes(tkr.t)) tkr.cat = "Indexes";
      else if (tkr.n > 1000000000) tkr.cat = "Large Cap";
      else if (tkr.n > 100000000) tkr.cat = "Mid Cap";
      else tkr.cat = "Small Cap";

      delete tkr.prints; // Remove raw prints to save memory
      processedTickers.push(tkr);
  });

  const catMap = {};
  processedTickers.forEach(t => {
      if (!catMap[t.cat]) catMap[t.cat] = { name: t.cat, desc: "Auto-categorized from CSV", totalNotional: 0, count: 0, items: [] };
      catMap[t.cat].totalNotional += t.n;
      catMap[t.cat].count += 1;
      catMap[t.cat].items.push(t);
  });

  D.categories = Object.values(catMap).sort((a,b) => b.totalNotional - a.totalNotional);
  D.categories.forEach(c => c.items.sort((a,b) => b.n - a.n));

  D.above = processedTickers.filter(t => t.pos === 'above').sort((a,b) => b.pct - a.pct);
  D.below = processedTickers.filter(t => t.pos === 'below').sort((a,b) => a.pct - b.pct);

  D.options.sort((a,b) => new Date(b.date) - new Date(a.date));
  D.cancelled.sort((a,b) => b.notional - a.notional);

  return { D, SD: { f: processedTickers, c: processedTickers } };
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap');
:root{--bg:#000000;--bg2:#111111;--bg3:#1a1a1a;--bg4:#0a0a0a;--bgH:#222222;--bdr:#333333;--bdr2:#444444;--tx:#ffffff;--tx2:#cccccc;--tx3:#888888;--blue:#3b82f6;--green:#00e676;--red:#ff1744;--amber:#ffb300;--cyan:#00e5ff;--purple:#d500f9;--pink:#f50057;--orange:#ff9100;--zF:rgba(59,130,246,.12);--zS:rgba(59,130,246,.3)}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--tx);font-family:'Outfit',sans-serif;min-height:100vh}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--bdr2);border-radius:3px}.mono{font-family:'JetBrains Mono',monospace}
.app-wrapper{background:var(--bg);color:var(--tx);min-height:100vh;font-family:'Outfit',sans-serif;overflow-x:hidden}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.fade{animation:fadeUp .35s ease-out both}
.hdr{padding:20px 28px 16px;background:linear-gradient(180deg,#111111,#000000);border-bottom:1px solid var(--bdr)}.hdr-in{max-width:1520px;margin:0 auto;display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:14px}.brand{display:flex;align-items:center;gap:10px}.brand-dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green);animation:pulse 2s infinite}.brand h1{font-size:22px;font-weight:800;letter-spacing:-.03em;color:#fff}.brand-sub{font-size:11px;color:var(--tx3);font-family:'JetBrains Mono',monospace;margin-top:2px}.hstats{display:flex;gap:10px;flex-wrap:wrap}.hs{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:8px 14px;min-width:132px;transition:border-color .2s}.hs:hover{border-color:var(--blue)}.hs-l{font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.07em;font-weight:700}.hs-v{font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace;margin-top:1px}.hs-s{font-size:10px;color:var(--tx2);margin-top:1px}
.tabs{border-bottom:1px solid var(--bdr);display:flex;overflow-x:auto;max-width:1520px;margin:0 auto;padding:0 28px}.tab{padding:12px 18px;font-size:12px;font-weight:600;color:var(--tx3);background:0;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;transition:all .2s;font-family:'Outfit',sans-serif}.tab:hover{color:var(--tx2)}.tab.on{color:#fff;border-bottom-color:var(--blue)}
.wrap{max-width:1520px;margin:0 auto;padding:20px 28px 60px}.pane{display:none}.pane.on{display:block}
.stabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px}.stab{padding:7px 15px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid var(--bdr);background:0;color:var(--tx3);cursor:pointer;white-space:nowrap;transition:all .2s;font-family:'Outfit',sans-serif}.stab.on{color:var(--tx);border-color:var(--blue);background:var(--zF)}
.legend{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 14px;font-size:11px;color:var(--tx2);background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;margin-bottom:16px}.legend .sw{display:inline-block;vertical-align:middle;margin-right:4px}
.tw{background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;overflow:hidden}table{width:100%;border-collapse:collapse}th{padding:10px 14px;font-size:10px;color:var(--tx3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;text-align:left;border-bottom:1px solid var(--bdr);background:var(--bg2);position:sticky;top:0;z-index:2}td{padding:9px 14px;border-bottom:1px solid var(--bdr);vertical-align:middle}tbody tr{transition:background .15s}tbody tr:nth-child(even){background:var(--bg4)}tbody tr:hover{background:var(--bgH)}
.tkw{position:relative;display:inline-block}.tkn{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;cursor:default;display:inline-flex;align-items:center;gap:5px;padding:2px 0;border-bottom:1px dashed var(--zS)}.tkn .du{width:6px;height:6px;border-radius:50%;background:var(--red);box-shadow:0 0 5px var(--red);flex-shrink:0}.tt{display:none;position:absolute;left:0;top:calc(100% + 6px);z-index:100;background:var(--bg3);border:1px solid var(--bdr2);border-radius:10px;padding:10px 12px;min-width:270px;box-shadow:0 10px 36px rgba(0,0,0,.5)}.tkw:hover .tt{display:block}.tt-h{font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px;font-family:'JetBrains Mono',monospace;border-bottom:1px solid var(--bdr);padding-bottom:5px}.tt-r{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--tx2)}.tt-r:not(:last-child){border-bottom:1px solid var(--bdr)}
.notional{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12px;color:var(--cyan)}.zone{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--tx2)}.zsep{color:var(--tx3);margin:0 3px}.cp{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:14px}.cp-a{color:var(--green)}.cp-i{color:var(--tx)}.cp-b{color:var(--red)}.spw{width:240px;height:54px}.spw svg{width:100%;height:100%}
.ph-card{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:16px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;transition:border-color .2s}.ph-card:hover{border-color:var(--bdr2)}.ph-diff{padding:4px 12px;border-radius:8px;font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace}
.op-row{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;transition:border-color .2s}.op-row:hover{border-color:var(--bdr2)}.badge{font-size:10px;padding:3px 10px;border-radius:10px;font-weight:700}.b-bull{background:rgba(0,230,118,.1);color:var(--green)}.b-bear{background:rgba(255,23,68,.1);color:var(--red)}.b-alert{background:rgba(255,179,0,.1);color:var(--amber)}
.ag{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.ag-c{background:linear-gradient(135deg,rgba(255,179,0,.08),rgba(255,179,0,.02));border:1px solid rgba(255,179,0,.2);border-radius:10px;padding:16px;text-align:center;transition:transform .2s}.ag-c:hover{transform:scale(1.03)}
.ib{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:14px;font-size:12px;color:var(--tx2);line-height:1.7}.ib-r{border-color:rgba(255,23,68,.2)}.ig{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}.ig-c{padding:12px;background:var(--bg3);border-radius:8px}.ig-t{font-weight:700;margin-bottom:4px;font-size:13px}
@media(max-width:900px){.hdr{padding:14px}.wrap{padding:14px}th,td{padding:7px 8px}.spw{width:160px;height:44px}}
@media print{body{background:#fff;color:#1e293b}.tw,.hs,.ph-card,.op-row,.ib{background:#f8fafc;border-color:#e2e8f0}.tt{display:none!important}}
.search-bar{position:relative;max-width:340px}
.search-input{width:100%;padding:9px 14px 9px 36px;font-size:13px;font-family:'Outfit',sans-serif;background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;color:var(--tx);outline:none;transition:border-color .2s}
.search-input:focus{border-color:var(--blue)}
.search-input::placeholder{color:var(--tx3)}
.search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--tx3);font-size:14px;pointer-events:none}
.sr-count{font-size:12px;color:var(--tx3);margin-bottom:10px}
.sr-empty{font-size:13px;color:var(--tx3);padding:20px;text-align:center}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--bg);
  color: var(--tx);
  font-family: 'JetBrains Mono', monospace;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--bdr2);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
`;

// --- COMPONENTS ---

const Tooltip = ({ it }) => {
  if (!it.top5 || !it.top5.length) return null;
  return (
    <div className="tt">
      <div className="tt-h">${it.t} Largest Blocks ({it.c} total)</div>
      {it.top5.map((t, i) => (
        <div key={i} className="tt-r">{t}</div>
      ))}
    </div>
  );
};

const Sparkline = ({ it, dateLabels }) => {
  if (!it || !it.prices || !it.prices.length) return <div className="spw"></div>;
  const W = 240, H = 54, P = 6, ww = it.w || [];
  const pts = [];
  for (let i = 0; i < it.prices.length; i++) {
    if (it.prices[i] != null) pts.push({ i, p: it.prices[i], w: ww[i] != null ? ww[i] : 0 });
  }
  if (!pts.length) return <div className="spw"></div>;

  const lo = it.lo, hi = it.hi, allP = pts.map(p => p.p);
  let mn = Math.min(lo, ...allP) - (hi - lo) * 0.12;
  let mx = Math.max(hi, ...allP) + (hi - lo) * 0.12;
  if (mn >= mx) { mn = lo - 1; mx = hi + 1; }
  const rng = mx - mn || 1, ts = it.prices.length;

  const y = (p) => H - P - 2 - ((p - mn) / rng) * (H - P * 2 - 4);
  const x = (i) => P + (i / (ts - 1 || 1)) * (W - P * 2);

  const zt = y(hi), zb = y(lo), zh = Math.max(zb - zt, 1), vy = y(it.vwap);

  return (
    <div className="spw">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect x={P} y={zt.toFixed(1)} width={W - P * 2} height={zh.toFixed(1)} rx="2" fill="var(--zF)" stroke="var(--zS)" strokeWidth=".5" />
        <line x1={P} y1={vy.toFixed(1)} x2={W - P} y2={vy.toFixed(1)} stroke="var(--zS)" strokeWidth="1" strokeDasharray="3,3" />
        {pts.length === 1 && (
          <circle cx={x(pts[0].i).toFixed(1)} cy={y(pts[0].p).toFixed(1)} r={(3 + pts[0].w * 4).toFixed(1)} fill="#ffffff" opacity="0.85" />
        )}
        {pts.length > 1 && pts.slice(0, -1).map((pt, j) => {
          const avg = (pt.p + pts[j + 1].p) / 2;
          const col = avg > hi ? "var(--green)" : avg < lo ? "var(--red)" : "var(--tx2)";
          const sw = 1.5 + (pt.w + pts[j + 1].w) / 2 * 1.5;
          return (
            <line key={`l-${j}`} x1={x(pt.i).toFixed(1)} y1={y(pt.p).toFixed(1)} x2={x(pts[j + 1].i).toFixed(1)} y2={y(pts[j + 1].p).toFixed(1)} stroke={col} strokeWidth={sw.toFixed(1)} strokeLinecap="round" />
          );
        })}
        {pts.length > 1 && pts.map((pt, j) => {
          const isLast = j === pts.length - 1;
          const r = 2 + pt.w * 4 + (isLast ? 1 : 0);
          const gr = r + 3 + pt.w * 3;
          return (
            <g key={`c-${j}`}>
              {pt.w > 0.4 && <circle cx={x(pt.i).toFixed(1)} cy={y(pt.p).toFixed(1)} r={gr.toFixed(1)} fill={`rgba(255,255,255,${(0.1 + pt.w * 0.2).toFixed(2)})`} />}
              {isLast && <circle cx={x(pt.i).toFixed(1)} cy={y(pt.p).toFixed(1)} r={(r + 2).toFixed(1)} fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />}
              <circle cx={x(pt.i).toFixed(1)} cy={y(pt.p).toFixed(1)} r={r.toFixed(1)} fill="#ffffff" stroke={isLast ? "var(--bg)" : undefined} strokeWidth={isLast ? "1.5" : undefined} opacity={isLast ? undefined : "0.85"} />
            </g>
          );
        })}
        {dateLabels && dateLabels.length >= 2 && (
          <>
            <text x={P} y={H} fontSize="8" fill="var(--tx3)" fontFamily="JetBrains Mono,monospace">{dateLabels[0]}</text>
            <text x={W - P} y={H} fontSize="8" fill="var(--tx3)" fontFamily="JetBrains Mono,monospace" textAnchor="end">{dateLabels[dateLabels.length - 1]}</text>
          </>
        )}
      </svg>
    </div>
  );
};

const TickerTable = ({ items, type = "standard", dateLabels }) => {
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            <th style={type === 'standard' ? { width: '110px' } : undefined}>Ticker</th>
            <th style={type === 'standard' ? { width: '110px' } : undefined}>Category</th>
            
            {type === 'search' && <th>Position</th>}
            {type === 'search' && <th>Prints</th>}
            
            {(type === 'above' || type === 'below') && <th>{type === 'above' ? '% Above' : '% Below'}</th>}

            {type !== 'search' && <th>Total Notional</th>}
            {type !== 'search' && <th style={type === 'standard' ? { width: '170px' } : undefined}>Dark Pool Zone</th>}
            
            <th style={type === 'standard' ? { width: '100px' } : undefined}>Close</th>
            <th>{type === 'search' ? 'Price Action' : '30-Day Price Action'}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            const ac = CA[it.cat] || "#4e9fff";
            const pc = it.pos === "above" ? "cp-a" : it.pos === "below" ? "cp-b" : "cp-i";
            return (
              <tr key={`${it.t}-${idx}`}>
                <td>
                  <div className="tkw">
                    <span className="tkn" style={{ color: ac }}>
                      ${it.t}{it.u && <span className="du"></span>}
                    </span>
                    <Tooltip it={it} />
                  </div>
                </td>
                <td>
                  <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '10px', background: `${ac}15`, color: ac, fontWeight: 600 }}>{it.cat}</span>
                </td>

                {type === 'search' && (
                  <td>
                    {it.pos === 'above' ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>+{it.pct}% ▲</span> :
                     it.pos === 'below' ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{it.pct}% ▼</span> :
                     <span style={{ color: 'var(--tx2)' }}>In Zone</span>}
                  </td>
                )}
                {type === 'search' && <td className="mono" style={{ color: 'var(--tx2)' }}>{it.c}</td>}

                {(type === 'above' || type === 'below') && (
                  <td>
                    <span className="mono" style={{ color: type === 'above' ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontSize: '13px' }}>
                      {type === 'above' ? `+${it.pct}%` : `${it.pct}%`}
                    </span>
                  </td>
                )}

                {type !== 'search' && <td><span className="notional">{fmt(it.n)}</span></td>}
                {type !== 'search' && <td className="zone">${it.lo.toFixed(2)}<span className="zsep">—</span>${it.hi.toFixed(2)}</td>}

                <td><span className={`cp ${pc}`}>${it.last.toFixed(2)}</span></td>
                
                <td>
                  {it.prices ? <Sparkline it={it} dateLabels={dateLabels} /> : <span style={{ fontSize: '10px', color: 'var(--tx3)' }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};


const App = () => {
  const [appData, setAppData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const [error, setError] = useState(null);
  
  const [activeTab, setActiveTab] = useState("overview");
  const [activeCategory, setActiveCategory] = useState(null);
  const searchInputRef = useRef(null);

  // 1. Fetch CSV or JSON from the public directory
  useEffect(() => {
    // Safely check for process.env
    const isProcessDefined = typeof process !== 'undefined' && process.env;
    const publicUrl = isProcessDefined ? process.env.PUBLIC_URL : '';
    
    const loadData = async () => {
      try {
        // We will try fetching the CSV first, since that is what you uploaded.
        // If it fails, we fall back to data.json
        let res = await fetch(`${publicUrl}/data.csv`);
        
        if (!res.ok) {
           res = await fetch(`${publicUrl}/data.json`);
        }
        
        if (!res.ok) {
           throw new Error("Could not find data.csv or data.json in the public folder.");
        }

        const text = await res.text();
        
        let parsedData;
        if (text.trim().startsWith('{')) {
            // It's a JSON file
            parsedData = JSON.parse(text);
        } else if (text.includes('Ticker') && text.includes('Price')) {
            // It's a CSV file! Let's aggregate it live.
            parsedData = buildDashboardDataFromCSV(text);
        } else {
            throw new Error("File format not recognized (Not valid JSON or CSV).");
        }

        setAppData(parsedData);
        if (parsedData.D && parsedData.D.categories && parsedData.D.categories.length > 0) {
            setActiveCategory(parsedData.D.categories[0].name);
        }
        setLoading(false);
        setError(null);
        setUsingFallback(false);

      } catch (err) {
        console.error(err);
        setAppData(fallbackData);
        if (fallbackData.D && fallbackData.D.categories && fallbackData.D.categories.length > 0) {
            setActiveCategory(fallbackData.D.categories[0].name);
        }
        setUsingFallback(true);
        setError(err.message);
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // 2. Compute search index
  const allSearch = useMemo(() => {
    if (!appData || !appData.SD) return [];
    const { SD } = appData;
    return [...(SD.f || []), ...(SD.c || []).map(c => ({ ...c, prices: null, w: null }))];
  }, [appData]);

  // 3. Handle search focus
  useEffect(() => {
    if (activeTab === 'search' && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [activeTab]);

  // Render loading state
  if (loading) {
    return (
      <div className="loading-container">
        <style dangerouslySetInnerHTML={{ __html: styles }} />
        <div className="loading-spinner"></div>
        <div>Loading Dark Pool Data...</div>
      </div>
    );
  }

  const { D } = appData;

  const tabDefs = [
    { id: "overview", label: "Overview" },
    { id: "category", label: "By Category" },
    { id: "search", label: "🔍 Search" },
    { id: "above", label: "▲ Above Zone" },
    { id: "below", label: "▼ Below Zone" },
    { id: "unusual", label: "Unusual Flow" },
    { id: "phantom", label: "Phantom Prints" },
    { id: "options", label: "Options Flow" },
    { id: "signals", label: "Signals" }
  ];

  return (
    <div className="app-wrapper">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      
      {usingFallback && (
        <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--bdr)', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ color: 'var(--amber)', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
            ⚠️ Using Fallback Sample Data
          </div>
          <div style={{ color: 'var(--tx2)', fontSize: '13px', textAlign: 'center', maxWidth: '800px' }}>
            {error} <br/> 
            To view live data, place your CSV export file in your <code>public/</code> folder and name it exactly <code>data.csv</code>.
          </div>
        </div>
      )}

      <div className="hdr">
        <div className="hdr-in">
          <div>
            <div className="brand"><div className="brand-dot"></div><h1>DARK POOL SCANNER</h1></div>
            <div className="brand-sub">
              {D.dateLabels?.[0] ? `${D.dateLabels[0]} – ${D.dateLabels[D.dateLabels.length - 1]}` : 'Waiting for data'} &middot; 
              {D.categories?.reduce((a,c) => a + c.items.reduce((b, i)=> b+i.c, 0), 0) || 0} block trades &middot; 
              {D.categories?.reduce((a,c) => a + c.count, 0) || 0} tickers &middot; 
              {fmt(D.categories?.reduce((a,c) => a + c.totalNotional, 0) || 0)} total flow
            </div>
          </div>
          <div className="hstats">
            <div className="hs"><div className="hs-l">SPY 30-Day Zone</div><div className="hs-v" style={{ color: 'var(--red)' }}>$683.21</div><div className="hs-s">Zone $685.49 – $692.08</div></div>
            <div className="hs"><div className="hs-l">QQQ 30-Day Zone</div><div className="hs-v" style={{ color: 'var(--tx)' }}>$609.63</div><div className="hs-s">Zone $605.96 – $621.03</div></div>
            <div className="hs"><div className="hs-l">IWM 30-Day Zone</div><div className="hs-v" style={{ color: 'var(--red)' }}>$258.96</div><div className="hs-s">Zone $260.48 – $264.71</div></div>
            <div className="hs"><div className="hs-l">Period</div><div className="hs-v" style={{ color: 'var(--amber)' }}>30 days</div><div className="hs-s">{fmt(D.categories?.reduce((a,c) => a + c.totalNotional, 0) || 0)} flow</div></div>
          </div>
        </div>
      </div>
      
      <div className="tabs">
        {tabDefs.map(t => (
          <button 
            key={t.id} 
            className={`tab ${t.id === activeTab ? "on" : ""}`} 
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="wrap">
        {activeTab === 'overview' && <OverviewPane setTab={setActiveTab} setCategory={setActiveCategory} D={D} />}
        {activeTab === 'category' && <CategoryPane activeCategory={activeCategory} setCategory={setActiveCategory} D={D} />}
        {activeTab === 'above' && <AboveBelowPane type="above" D={D} />}
        {activeTab === 'below' && <AboveBelowPane type="below" D={D} />}
        {activeTab === 'search' && <SearchPane searchInputRef={searchInputRef} allSearch={allSearch} D={D} />}
        {activeTab === 'unusual' && <UnusualPane allSearch={allSearch} D={D} />}
        {activeTab === 'phantom' && <PhantomPane D={D} />}
        {activeTab === 'options' && <OptionsPane D={D} />}
        {activeTab === 'signals' && <SignalsPane D={D} />}
      </div>
    </div>
  );
};

// -- PANE COMPONENTS --

const OverviewPane = ({ setTab, setCategory, D }) => {
  const total = D.categories?.reduce((acc, c) => acc + c.totalNotional, 0) || 1;
  
  return (
    <div className="pane on">
      <div className="legend">
        <b style={{ color: 'var(--tx)' }}>30-Day Chart:</b>
        <span>Zone = where 50% of DP notional executed (25th–75th pctl by $)</span>
        <span style={{ color: 'var(--green)' }}>● Above</span>
        <span style={{ color: 'var(--tx)' }}>● In Zone</span>
        <span style={{ color: 'var(--red)' }}>● Below</span>
        <span>Dot size = notional weight</span>
        <span>Hover ticker → top 5 prints</span>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {(D.categories || []).map((c, i) => {
          const ac = CA[c.name] || "#4e9fff";
          const pct = ((c.totalNotional / total) * 100).toFixed(1);
          const uC = c.items?.filter(it => it.u).length || 0;
          
          return (
            <div key={c.name} className="fade" style={{ animationDelay: `${i * 0.06}s`, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: '10px', padding: '16px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => { setTab('category'); setCategory(c.name); }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: ac }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>{CI[c.name] || ""} {c.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '2px' }}>{c.count} tickers</div>
                </div>
                {uC > 0 && <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(255,23,68,.1)', color: 'var(--red)', fontWeight: 600 }}>{uC} unusual</span>}
              </div>
              <div className="mono" style={{ fontSize: '20px', fontWeight: 800, color: ac }}>{fmt(c.totalNotional)}</div>
              <div style={{ marginTop: '8px', height: '4px', background: 'var(--bdr2)', borderRadius: '2px' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: ac, borderRadius: '2px' }}></div>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '4px' }}>{pct}% of total flow</div>
            </div>
          );
        })}
      </div>

      <div className="ib">
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--tx)', marginBottom: '10px' }}>30-Day Flow Summary</div>
        <div className="ig">
          <div className="ig-c"><div className="ig-t" style={{ color: 'var(--blue)' }}>Index Trend</div>SPY now <b style={{ color: 'var(--red)' }}>below</b> its core DP zone ($685–$692), trading at $683. QQQ $610 — inside zone ($606–$620). IWM $259 — <b style={{ color: 'var(--red)' }}>below</b> zone ($262–$264). Two of three indexes below institutional execution range.</div>
          <div className="ig-c"><div className="ig-t" style={{ color: 'var(--amber)' }}>Mega-Cap Flow</div>MSFT ~$52B across 30 days. NVDA ~$40B. AAPL ~$30B. The top 5 mega-caps account for ~$200B+ in dark pool execution. Look for big dots to see where heaviest days clustered.</div>
          <div className="ig-c"><div className="ig-t" style={{ color: 'var(--red)' }}>Energy / Geopolitical Shift</div>Energy flow surged in the final week: XLE, FENY, LNG, commodity ETFs spiking. Iran/Strait of Hormuz tensions driving heavy commodity positioning. 30-day sparklines show the pivot clearly.</div>
          <div className="ig-c"><div className="ig-t" style={{ color: 'var(--green)' }}>Bond / Fixed Income</div>HYG $30B+, LQD $24B+ over 30 days. Sustained institutional fixed income positioning suggesting flight-to-quality as equity DP zones trend lower.</div>
        </div>
      </div>
    </div>
  );
};

const CategoryPane = ({ activeCategory, setCategory, D }) => {
  const cat = D.categories?.find(c => c.name === activeCategory) || D.categories?.[0] || { items: [], count: 0, totalNotional: 0 };
  return (
    <div className="pane on">
      <div className="legend">
        <b style={{ color: 'var(--tx)' }}>30-Day Chart:</b>
        <span>Zone=IQR</span>
        <span style={{ color: 'var(--green)' }}>● Above</span>
        <span style={{ color: 'var(--tx)' }}>● In</span>
        <span style={{ color: 'var(--red)' }}>● Below</span>
        <span>Dot=notional wt</span>
        <span>Hover → top 5</span>
      </div>
      <div className="stabs">
        {(D.categories || []).map(c => {
          const ac = CA[c.name] || "#4e9fff";
          const on = c.name === activeCategory;
          return (
            <button 
              key={c.name} 
              className={`stab ${on ? 'on' : ''}`} 
              style={on ? { borderColor: ac, background: `${ac}12` } : {}} 
              onClick={() => setCategory(c.name)}
            >
              {CI[c.name] || ""} {c.name}
            </button>
          );
        })}
      </div>
      <div style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--tx2)' }}>
        {cat.count} tickers &middot; {fmt(cat.totalNotional)} total
      </div>
      <TickerTable items={cat.items} type="standard" dateLabels={D.dateLabels} />
    </div>
  );
};

const AboveBelowPane = ({ type, D }) => {
  const isAbove = type === 'above';
  const items = isAbove ? (D.above || []) : (D.below || []);

  return (
    <div className="pane on">
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: isAbove ? 'var(--green)' : 'var(--red)', marginBottom: '6px' }}>
          {isAbove ? '▲ Trading Above Dark Pool Zone' : '▼ Trading Below Dark Pool Zone'}
          <span className="mono" style={{ fontSize: '13px', fontWeight: 400, color: 'var(--tx2)' }}> ({items.length} tickers)</span>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--tx3)', lineHeight: 1.5 }}>
          Closed <b style={{ color: isAbove ? 'var(--green)' : 'var(--red)' }}>{isAbove ? 'above' : 'below'}</b> the 25th–75th percentile institutional execution range. 
          Sorted by % distance {isAbove ? 'above' : 'below'} zone. {isAbove ? 'Bullish momentum signal.' : 'Watch for support or further breakdown.'}
        </div>
      </div>
      <TickerTable items={items} type={type} dateLabels={D.dateLabels} />
    </div>
  );
};

const UnusualPane = ({ allSearch, D }) => {
  const unusualItems = useMemo(() => {
    return allSearch.filter(it => it.u).sort((a, b) => b.n - a.n).slice(0, 40);
  }, [allSearch]);

  return (
    <div className="pane on">
      <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--tx3)' }}>
        Tickers flagged as “Unusual Dark Pool Activity” over 30 days — sorted by total notional.
      </div>
      <TickerTable items={unusualItems} type="standard" dateLabels={D.dateLabels} />
    </div>
  );
};

const PhantomPane = ({ D }) => {
  const items = D.phantom || [];
  return (
    <div className="pane on">
      <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--tx3)' }}>
        Recent phantom prints — DP reference prices significantly different from spot.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.length === 0 && <div style={{color: 'var(--tx3)'}}>No phantom prints logged.</div>}
        {items.map((p, i) => {
          if (!p.spotPrice) return null;
          const diff = ((p.spotPrice - p.dpPrice) / p.dpPrice * 100).toFixed(2);
          const up = p.spotPrice > p.dpPrice;
          return (
            <div key={i} className="ph-card">
              <div style={{ fontSize: '10px', color: 'var(--tx3)', minWidth: '40px' }}>{p.date || ""}</div>
              <div style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'JetBrains Mono,monospace', minWidth: '56px' }}>{p.ticker}</div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--tx3)', textTransform: 'uppercase', fontWeight: 700 }}>DP Price</div>
                <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', color: 'var(--blue)' }}>{fP(p.dpPrice)}</div>
              </div>
              <div style={{ fontSize: '20px', color: 'var(--tx3)' }}>→</div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--tx3)', textTransform: 'uppercase', fontWeight: 700 }}>Spot</div>
                <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'JetBrains Mono,monospace' }}>{fP(p.spotPrice)}</div>
              </div>
              <div className="ph-diff" style={{ background: up ? 'rgba(0,230,118,.1)' : 'rgba(255,23,68,.1)', color: up ? 'var(--green)' : 'var(--red)' }}>
                {up ? '+' : ''}{diff}%
              </div>
              <div style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--tx3)' }}>Vol: {p.volume || "—"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const OptionsPane = ({ D }) => {
  const items = D.options || [];
  return (
    <div className="pane on">
      <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--tx3)' }}>
        Recent options flow alongside dark pool activity.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {items.length === 0 && <div style={{color: 'var(--tx3)'}}>No options flow logged in CSV.</div>}
        {items.map((o, i) => {
          const bull = o.message.indexOf("CALL") >= 0 || o.message.indexOf("Bullish") >= 0;
          const bear = o.message.indexOf("PUT") >= 0 || o.message.indexOf("Bearish") >= 0;
          return (
            <div key={i} className="op-row">
              <span style={{ fontSize: '10px', color: 'var(--tx3)', minWidth: '36px' }}>{o.date || ""}</span>
              <span className="mono" style={{ fontSize: '14px', fontWeight: 800, minWidth: '52px' }}>{o.ticker}</span>
              <span className="mono" style={{ fontSize: '12px', color: 'var(--tx2)' }}>{fP(o.price)}</span>
              <span className={`badge ${bull ? 'b-bull' : bear ? 'b-bear' : 'b-alert'}`}>
                {bull ? 'BULLISH' : bear ? 'BEARISH' : 'ALERT'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--tx3)', flex: 1 }}>{o.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SignalsPane = ({ D }) => {
  return (
    <div className="pane on">
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--amber)', marginBottom: '10px' }}>⚡ Alpha Gold Alerts</div>
      <div className="ag">
        {(D.alpha || []).length === 0 && <div style={{color: 'var(--tx3)', fontSize: '12px'}}>No alpha alerts found.</div>}
        {(D.alpha || []).map((a, i) => (
          <div key={i} className="ag-c">
            <div className="mono" style={{ fontSize: '20px', fontWeight: 800, color: 'var(--amber)' }}>{a.ticker}</div>
            <div className="mono" style={{ fontSize: '14px', color: 'var(--tx)', marginTop: '3px' }}>{fP(a.price)}</div>
            <div style={{ fontSize: '10px', color: 'var(--tx3)', marginTop: '2px' }}>{a.date || ""}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--red)', marginBottom: '10px', marginTop: '20px' }}>✕ Cancelled Blocks</div>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Ticker</th>
              <th>Price</th>
              <th>Notional</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {(D.cancelled || []).length === 0 && <tr><td colSpan="5" style={{color: 'var(--tx3)', textAlign:'center'}}>No cancelled blocks logged.</td></tr>}
            {(D.cancelled || []).map((c, i) => (
              <tr key={i}>
                <td style={{ color: 'var(--tx3)', fontSize: '11px' }}>{c.date || ""}</td>
                <td className="mono" style={{ fontWeight: 700 }}>{c.ticker}</td>
                <td className="mono" style={{ color: 'var(--tx2)' }}>{fP(c.price)}</td>
                <td style={{ color: 'var(--red)', fontWeight: 600, fontFamily: 'JetBrains Mono,monospace' }}>{fmt(c.notional)}</td>
                <td style={{ color: 'var(--tx3)', fontSize: '11px' }}>{c.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SearchPane = ({ searchInputRef, allSearch, D }) => {
  const [query, setQuery] = useState("");
  
  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return null;
    
    const exact = [];
    const prefix = [];
    const includes = [];
    
    allSearch.forEach(it => {
      if (it.t === q) exact.push(it);
      else if (it.t.startsWith(q)) prefix.push(it);
      else if (it.t.includes(q)) includes.push(it);
    });
    
    return [...exact, ...prefix, ...includes].slice(0, 30);
  }, [query, allSearch]);

  return (
    <div className="pane on">
      <div style={{ marginBottom: '16px' }}>
        <div className="search-bar">
          <span className="search-icon">🔍</span>
          <input 
            type="text" 
            className="search-input" 
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker (e.g. AAPL, SPY, XLE...)" 
            autoComplete="off" 
          />
        </div>
      </div>
      
      {results === null ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--tx3)' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
          <div style={{ fontSize: '14px' }}>Type a ticker symbol to search</div>
        </div>
      ) : results.length === 0 ? (
        <div className="sr-empty">No tickers found matching "{query}"</div>
      ) : (
        <div>
          <div className="sr-count">
            {results.length}{results.length >= 30 ? '+' : ''} results for "{query}"
          </div>
          <TickerTable items={results} type="search" dateLabels={D.dateLabels} />
        </div>
      )}
    </div>
  );
};

export default App;
