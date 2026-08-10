import { useState, useMemo, useRef, useEffect, Fragment, lazy, Suspense } from "react";
import TickerPopup from "../components/TickerPopup";
import UIcon from "../components/ui/UIcon";

// The SAME chart the /charts workspace renders — identity row, session
// toggle, market clock, timeframe bar, market-cap/earnings/UCT-rating meta,
// settings gear and drawing tools. Lazy, so none of it lands in the eager
// entry chunk.
const ChartPane = lazy(() => import("../components/chart/pane/ChartPane"));

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

// ── Dark Pool Print Clustering ───────────────────────────────────────────────
// Combines prints at the same/close price into a single zone. Today's SERV
// has three prints all at exactly $6.98 ($4.2M AVGPRC + $4.3M BLOCK + $4.8M
// BLOCK = $13.4M total) — the chart was rendering three separate horizontal
// bars when traders mentally read them as one $13.4M zone.
//
// Clustering algorithm: sort by price ascending, walk through the list, and
// merge a print into the current zone if its price is within `zonePct` of the
// zone's volume-weighted average price. The VW average lets the zone "follow"
// where the size actually went (so a 1M-share print at $6.98 + a 100-share
// print at $7.05 keeps the zone near $6.98, not the midpoint).
//
// `zonePct` of 0.02 = 2% — wide enough to cover normal intraday wiggle on the
// same level, tight enough that genuinely distinct levels stay separate. On
// a $7 stock that's $0.14, on a $400 stock that's $8.
function clusterDarkPoolPrints(prints, { zonePct = 0.02 } = {}) {
  if (!prints || prints.length === 0) return [];
  // Defensively read fields — backend may use either short or long names
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
      // Merge into current zone
      current._members.push(p);
      current.notional = (current.notional || 0) + notional;
      current.volume = (current.volume || 0) + volume;
      // Volume-weighted avg price (fall back to count weighting if no volume)
      const wSum = current._members.reduce((s, x) => s + readPrice(x) * (readVolume(x) || 1), 0);
      const wDen = current._members.reduce((s, x) => s + (readVolume(x) || 1), 0);
      current.price = wDen > 0 ? wSum / wDen : price;
      current.priceLow = Math.min(current.priceLow, price);
      current.priceHigh = Math.max(current.priceHigh, price);
      // Keep the latest timestamp visible if present
      if (p.time && (!current.time || String(p.time) > String(current.time))) current.time = p.time;
      if (p.timestamp && (!current.timestamp || String(p.timestamp) > String(current.timestamp))) current.timestamp = p.timestamp;
    } else {
      // Start a new zone. Spread the source print first so unknown fields
      // (color, sector, message, etc.) pass through to the chart unchanged
      // for single-member zones — only multi-print zones get the aggregated
      // shape. Identifier fields then get overwritten with cluster values.
      current = {
        ...p,
        price, notional, volume,
        priceLow: price, priceHigh: price,
        _members: [p],
      };
      zones.push(current);
    }
  }

  // For multi-print zones, synthesize a message that reflects the aggregate.
  // Single-member zones keep their original message untouched.
  return zones.map(z => {
    if (z._members.length === 1) {
      const { _members, priceLow, priceHigh, ...single } = z;
      return single;
    }
    const count = z._members.length;
    const dollarsLabel = z.notional >= 1e9 ? "$" + (z.notional/1e9).toFixed(2) + "B"
                       : z.notional >= 1e6 ? "$" + (z.notional/1e6).toFixed(1) + "M"
                       : z.notional >= 1e3 ? "$" + (z.notional/1e3).toFixed(0) + "K"
                       : "$" + Math.round(z.notional);
    const { _members, ...out } = z;
    return {
      ...out,
      message: `DARK ZONE  ${dollarsLabel} · ${count} prints clustered`,
      _isCluster: true,
      _clusterCount: count,
    };
  });
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
      <span style={{color:catColor||C.tx,fontWeight:700,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
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
            <div key={i} style={{color:C.tx,fontSize:11,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
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
    <span style={{color,fontWeight:700,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:13}}>
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
          color:C.tx,fontSize:13,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
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

function FlowTable({items, showCat=true, showZone=false, mktcapData = {}}){
  // Track which ticker (if any) is expanded to show the dark-pool chart.
  // One expansion at a time keeps the table layout readable.
  const [expandedTicker, setExpandedTicker] = useState(null);
  // Column count for the colSpan on the expanded row
  const colCount = 8 + (showCat ? 1 : 0) + (showZone ? 1 : 0);
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
            const isExpanded = expandedTicker === it.t;
            return (
              <Fragment key={it.t+it.cat}>
                <tr style={{background:isExpanded ? C.bg3 : "transparent", cursor:"pointer"}}
                  onClick={() => setExpandedTicker(isExpanded ? null : it.t)}
                  onMouseEnter={e=>{if(!isExpanded) e.currentTarget.style.background=C.bgH;}}
                  onMouseLeave={e=>{if(!isExpanded) e.currentTarget.style.background="transparent";}}
                  title={isExpanded ? "Click to hide chart" : "Click to show dark pool chart"}>
                  <TD>
                    <span style={{display:"inline-flex", alignItems:"center", gap:6}}>
                      <span style={{color:C.tx3, fontSize:10, width:10, display:"inline-block"}}>{isExpanded ? "▼" : "▶"}</span>
                      <TickerCell it={it} catColor={cc}/>
                    </span>
                  </TD>
                  {showCat && <TD><CatPill cat={it.cat}/></TD>}
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:zC(it.last,it.lo,it.hi)}}>
                    {fP(it.last)}
                  </TD>
                  {showZone && (
                    <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.tx2,fontSize:11}}>
                      {fP(it.lo)}<span style={{color:C.tx3,margin:"0 3px"}}>–</span>{fP(it.hi)}
                    </TD>
                  )}
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11}}>
                    <BigPrintCell it={it}/>
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,
                    color:bpMoveColor}}>
                    {bpPct==null ? "—" : (bpPct>0?"+":"")+bpPct.toFixed(2)+"%"}
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.cyan,fontWeight:600}}>
                    {fmt(it.n)}
                  </TD>
                  <TD style={{color:C.tx2,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{it.c}</TD>
                  <TD style={{color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{it.days}</TD>
                  <TD><Sparkline it={it}/></TD>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={colCount} style={{padding:"4px 8px 12px", background:C.bg2}}>
                      <PatternTickerRow
                        it={it}
                        sig={null}
                        mktcap={mktcapData?.[it.t] || 0}
                        noCollapsedRow={true}/>
                    </td>
                  </tr>
                )}
              </Fragment>
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
      <div style={{fontSize:18,fontWeight:700,color:color||C.tx,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
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
      <div style={{fontSize:10,color,fontWeight:700,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",whiteSpace:"nowrap"}}>
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
                <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{c.count} tickers</span>
                <span style={{fontSize:11,fontWeight:700,color:C.cyan,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",minWidth:64,textAlign:"right"}}>
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

// ── Compact cap badge for inline use ─────────────────────────────────────────
const CAT_SHORT={"Indexes":"IDX","Large Cap":"LG","Mid Cap":"MD","Small Cap":"SM",
  "Sector ETFs":"ETF","Bond ETFs":"ETF","Intl/EM ETFs":"EM","Commodity ETFs":"CMD"};
function CatBadge({cat}){
  const color=CAT_COLORS[cat]||C.tx3;
  return (
    <span style={{fontSize:8,padding:"1px 4px",borderRadius:4,
      background:color+"15",color,fontWeight:700,letterSpacing:"0.03em"}}>
      {CAT_SHORT[cat]||cat}
    </span>
  );
}

// ── Notable Activity panel (sortable, cap badges) ────────────────────────────
function NotableActivityPanel({filterByCat, mktcapData, fetchMktCap, mktcapLoading}){
  const [sortKey,setSortKey]=useState("signals");
  const [sortDir,setSortDir]=useState("desc");
  const [hov,setHov]=useState(null);
  // Track which ticker (if any) is expanded to show the per-ticker dark
  // pool chart inline. Same pattern as FlowTable / PhantomPane / OptionsPane.
  const [expandedTicker,setExpandedTicker]=useState(null);

  const universe=(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) if(it.signals&&it.signals.length>0) map[it.t]=it;
    return filterByCat(Object.values(map));
  })();

  const filtered=useMemo(()=>{
    const acc={
      signals:x=>x.signals.length, bigPrintN:x=>x.bigPrintN, bigPrint:x=>x.bigPrint, t:x=>x.t,
      bpMove:x=>x.bigPrint>0?((x.last-x.bigPrint)/x.bigPrint*100):null,
      avgVol:x=>x.bigPrintPctAvgVol||0, last:x=>x.last||0, mktcap:x=>mktcapData[x.t]||0,
    };
    const fn=acc[sortKey]||(x=>x[sortKey]);
    return [...universe].sort((a,b)=>{
      const va=fn(a),vb=fn(b);
      if(va==null&&vb==null) return 0; if(va==null) return 1; if(vb==null) return -1;
      if(typeof va==="string") return sortDir==="asc"?va.localeCompare(vb):vb.localeCompare(va);
      return sortDir==="asc"?va-vb:vb-va;
    }).slice(0,15);
  },[universe,sortKey,sortDir]);

  function toggleSort(key){
    if(sortKey===key) setSortDir(d=>d==="desc"?"asc":"desc");
    else { setSortKey(key); setSortDir("desc"); }
  }
  const hdr=(key,label,minW)=>{
    const active=sortKey===key;
    const arrow=active?(sortDir==="asc"?" ▲":" ▼"):"";
    return (
      <span onClick={()=>toggleSort(key)}
        style={{fontSize:9,color:active?C.amber:C.tx3,fontWeight:600,minWidth:minW,textAlign:"right",
          cursor:"pointer",userSelect:"none",transition:"color 0.15s"}}>
        {label}{arrow}
      </span>
    );
  };

  return (
    <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.amber,
        textTransform:"uppercase",marginBottom:8}}><UIcon name="bolt" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Notable Activity</div>

      {/* Sortable column headers */}
      <div style={{display:"flex",justifyContent:"space-between",padding:"0 0 5px 0",
        borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,width:18,textAlign:"center"}}>#</span>
          {hdr("t","Ticker",50)}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {hdr("mktcap","Mkt Cap",52)}
          {hdr("bigPrint","Print $",56)}
          {hdr("bigPrintN","Notional",60)}
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:38,textAlign:"right"}}>Date</span>
          {hdr("last","Last",52)}
          {hdr("bpMove","% Move",48)}
          {hdr("avgVol","% AvgVol",52)}
        </div>
      </div>

      {/* Rows */}
      {filtered.length===0 && <div style={{fontSize:12,color:C.tx3,padding:8}}>No signals for this period</div>}
      {filtered.map((it,i)=>{
        const cc=CAT_COLORS[it.cat]||C.tx;
        const bpPct=it.bigPrint>0?((it.last-it.bigPrint)/it.bigPrint*100):null;
        const bpColor=bpPct==null?C.tx3:bpPct>0?C.green:bpPct<0?C.red:C.tx3;
        const avgV=it.bigPrintPctAvgVol;
        const avgVColor=avgV>=50?C.pink:avgV>=20?C.amber:avgV>0?C.tx2:C.tx3;
        const isExpanded = expandedTicker === it.t;
        return (
          <Fragment key={it.t}>
            <div onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
              onClick={()=>setExpandedTicker(isExpanded ? null : it.t)}
              title={isExpanded ? "Click to hide chart" : "Click to show dark pool chart"}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"5px 0",borderBottom:`1px solid ${C.bdr}22`,
              background:isExpanded ? C.bg3 : (hov===i?C.bg3+"80":"transparent"),
              transition:"background 0.15s",cursor:"pointer"}}>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                  width:18,textAlign:"center",fontWeight:600}}>{isExpanded ? "▼" : (i+1)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,
                  fontSize:12,color:cc}}>{it.t}</span>
                {hov===i ? <SignalBadges signals={it.signals} compact/>
                  : <span style={{fontSize:8,color:C.amber,fontWeight:700,opacity:0.6}}>{it.signals.length}s</span>}
              </div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:10,
                  color:C.tx3,minWidth:52,textAlign:"right"}}>{(mktcapData[it.t]||0)>0?fmt(mktcapData[it.t]).replace("$",""):"—"}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,color:C.amber,
                  fontWeight:600,minWidth:56,textAlign:"right"}}>{fP(it.bigPrint)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,color:C.cyan,
                  fontWeight:700,minWidth:60,textAlign:"right"}}>{fmt(it.bigPrintN)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:10,color:C.tx3,
                  minWidth:38,textAlign:"right"}}>{it.bigPrintDate||"—"}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,
                  color:C.tx,fontWeight:600,minWidth:52,textAlign:"right"}}>{fP(it.last)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,fontWeight:700,
                  color:bpColor,minWidth:48,textAlign:"right"}}>
                  {bpPct==null?"—":(bpPct>0?"+":"")+bpPct.toFixed(1)+"%"}
                </span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,fontWeight:700,
                  color:avgVColor,minWidth:52,textAlign:"right"}}>
                  {avgV>0?fmtAvgVol(avgV):"—"}
                </span>
              </div>
            </div>
            {isExpanded && (
              <div style={{padding:"4px 0 12px", background:C.bg3+"40"}}>
                <PatternTickerRow
                  it={it}
                  sig={null}
                  mktcap={mktcapData?.[it.t] || 0}
                  noCollapsedRow={true}/>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Top Biggest Prints panel (tabbed, sortable, %AvgVol) ─────────────────────
function BiggestPrintsPanel({filterByCat, mktcapData, fetchMktCap, mktcapLoading}){
  const [sortKey,setSortKey]=useState("bigPrintN");
  const [sortDir,setSortDir]=useState("desc");
  const [hov,setHov]=useState(null);
  const [expandedTicker,setExpandedTicker]=useState(null);

  const universe=(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) if(it.bigPrintN>0) map[it.t]=it;
    return filterByCat(Object.values(map));
  })();

  const filtered=useMemo(()=>{
    const acc={
      bigPrintN:x=>x.bigPrintN, bigPrint:x=>x.bigPrint, t:x=>x.t,
      bpMove:x=>x.bigPrint>0?((x.last-x.bigPrint)/x.bigPrint*100):null,
      avgVol:x=>x.bigPrintPctAvgVol||0, last:x=>x.last||0, mktcap:x=>mktcapData[x.t]||0,
    };
    const fn=acc[sortKey]||(x=>x[sortKey]);
    let items=[...universe].sort((a,b)=>{
      const va=fn(a),vb=fn(b);
      if(va==null&&vb==null) return 0; if(va==null) return 1; if(vb==null) return -1;
      if(typeof va==="string") return sortDir==="asc"?va.localeCompare(vb):vb.localeCompare(va);
      return sortDir==="asc"?va-vb:vb-va;
    });
    return items.slice(0,15);
  },[universe,sortKey,sortDir]);

  const maxBigN = Math.max(1, ...filtered.map(x=>x.bigPrintN||0));

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

      {/* Column headers */}
      <div style={{display:"flex",justifyContent:"space-between",padding:"0 0 5px 0",
        borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,width:18,textAlign:"center"}}>#</span>
          {hdr("t","Ticker",50)}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {hdr("mktcap","Mkt Cap",52)}
          {hdr("bigPrint","Print $",56)}
          {hdr("bigPrintN","Notional",60)}
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:38,textAlign:"right"}}>Date</span>
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:52,textAlign:"right"}}>Last</span>
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
        const isExpanded = expandedTicker === it.t;
        return (
          <Fragment key={it.t}>
            <div onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
              onClick={()=>setExpandedTicker(isExpanded ? null : it.t)}
              title={isExpanded ? "Click to hide chart" : "Click to show dark pool chart"}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"5px 0",borderBottom:`1px solid ${C.bdr}22`,
              background:isExpanded ? C.bg3 : (hov===i?C.bg3+"80":"transparent"),
              transition:"background 0.15s",cursor:"pointer"}}>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                  width:18,textAlign:"center",fontWeight:600}}>{isExpanded ? "▼" : (i+1)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,
                  fontSize:12,color:cc}}>{it.t}</span>
                {hov===i && it.signals&&it.signals.length>0 ? <SignalBadges signals={it.signals} compact/>
                  : it.signals&&it.signals.length>0 ? <span style={{fontSize:8,color:C.amber,fontWeight:700,opacity:0.6}}>{it.signals.length}s</span> : null}

              </div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:10,
                  color:C.tx3,minWidth:52,textAlign:"right"}}>{(mktcapData[it.t]||0)>0?fmt(mktcapData[it.t]).replace("$",""):"—"}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,color:C.amber,
                  fontWeight:600,minWidth:56,textAlign:"right"}}>{fP(it.bigPrint)}</span>
                <span style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-end",gap:2,minWidth:60}}>
                  <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,color:C.cyan,
                    fontWeight:700}}>{fmt(it.bigPrintN)}</span>
                  <span style={{width:"100%",height:3,background:C.bdr,borderRadius:2,overflow:"hidden"}}>
                    <span style={{display:"block",height:"100%",borderRadius:2,background:C.cyan,
                      width:`${Math.max(4,Math.round((it.bigPrintN||0)/maxBigN*100))}%`}}/>
                  </span>
                </span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:10,color:C.tx3,
                  minWidth:38,textAlign:"right"}}>{it.bigPrintDate||"—"}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,
                  color:C.tx,fontWeight:600,minWidth:52,textAlign:"right"}}>{fP(it.last)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,fontWeight:700,
                  color:bpColor,minWidth:48,textAlign:"right"}}>
                  {bpPct==null?"—":(bpPct>0?"+":"")+bpPct.toFixed(1)+"%"}
                </span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,fontWeight:700,
                  color:avgVColor,minWidth:52,textAlign:"right"}}>
                  {avgV>0?fmtAvgVol(avgV):"—"}
                </span>
              </div>
            </div>
            {isExpanded && (
              <div style={{padding:"4px 0 12px", background:C.bg3+"40"}}>
                <PatternTickerRow
                  it={it}
                  sig={null}
                  mktcap={mktcapData?.[it.t] || 0}
                  noCollapsedRow={true}/>
              </div>
            )}
          </Fragment>
        );
      })}
      {filtered.length===0 && <div style={{fontSize:12,color:C.tx3,padding:8}}>No prints in this category</div>}
    </div>
  );
}

// ── Pattern Ticker Row ───────────────────────────────────────────────────────
// Expandable row used in Patterns Detected groups. Collapsed: compact summary
// (cap, mkt cap, total $, mult, days seen, latest print, move %, mini spark).
// Expanded: lazy-fetches /ticker-detail (dark pool prints) and renders them
// as priceLines on the shared <StockChart> component (TradingView Lightweight
// Charts, same component GEX uses for gamma walls). chartTf controls candle
// aggregation that StockChart fetches itself.
// ohlcRange = the range we fetch for the overlay's price-axis calculation
// (StockChart fetches its own OHLC internally for display).
const TF_MAP = {
  "1W":  {days: 7,    chartTf: "D", ohlcRange: "3mo", limit: 40},
  "1M":  {days: 30,   chartTf: "D", ohlcRange: "3mo", limit: 40},
  "3M":  {days: 90,   chartTf: "D", ohlcRange: "6mo", limit: 60},
  "6M":  {days: 180,  chartTf: "W", ohlcRange: "1y",  limit: 80},
  "1Y":  {days: 365,  chartTf: "W", ohlcRange: "1y",  limit: 100},
  "All": {days: 1825, chartTf: "M", ohlcRange: "5y",  limit: 100},
};

// Plain-English signal labels + tooltips. Lifted to module scope so both
// PatternTickerRow (badges in notable variant) and OverviewPane (group
// headers in Patterns Detected) can read from the same source.
const SIG_META = {
  MONTHLY_RECORD:    {color:"#3cb868", short:"Monthly High",  groupLabel:"Biggest of the Month",       groupTip:"These stocks just had their biggest dark pool print in 30 days", tagTip:"Biggest print on this stock in 30 days"},
  YEARLY_RECORD:     {color:"#c9a84c", short:"Yearly High",   groupLabel:"Biggest of the Year",        groupTip:"These stocks just had their biggest dark pool print in 12 months", tagTip:"Biggest print on this stock in 12 months"},
  NOTIONAL_SPIKE:    {color:"#e74c3c", short:"Heavy Volume",  groupLabel:"Heavier Than Usual Volume",  groupTip:"Print size was many times the stock's normal daily average", tagTip:"Print was much bigger than this stock's normal average"},
  ZONE_BREAK_RECORD: {color:"#c9a84c", short:"New Range",     groupLabel:"Broke Out of Trading Range", groupTip:"Print is at a price level outside the recent trading range", tagTip:"Print sits outside the recent trading range — fresh territory"},
  SIZE_ESCALATION:   {color:"#a78bfa", short:"Growing Daily", groupLabel:"Building Up Over Days",      groupTip:"Print sizes are getting bigger each day in a row — possible accumulation", tagTip:"Print sizes are getting bigger each day in a row"},
  RARE_FLOW:         {color:"#6ba3be", short:"First Seen",    groupLabel:"First Time Seen",            groupTip:"These stocks haven't appeared in dark pool prints recently — fresh interest", tagTip:"Hasn't shown up in dark pool prints recently"},
};

// Renders a signal as a colored badge with hover tooltip (browser title attr).
function renderSignalTag(s, idx) {
  const m = SIG_META[s.type]; if (!m) return null;
  const suffix = s.mult ? ` · ${s.mult}×` : (s.days ? ` · ${s.days}d` : "");
  return (
    <span key={idx} title={m.tagTip}
      style={{fontSize:10, padding:"2px 8px", borderRadius:10,
        background:m.color+"22", color:m.color, fontWeight:700,
        border:`1px solid ${m.color}55`, cursor:"help", whiteSpace:"nowrap"}}>
      {m.short}{suffix}
    </span>
  );
}

function PatternTickerRow({it, sig, mktcap, onJumpTo, variant="pattern", noCollapsedRow=false}){
  // When noCollapsedRow is true (search modal use case), start in expanded
  // state — caller is responsible for mount/unmount to toggle visibility.
  const [expanded, setExpanded] = useState(noCollapsedRow);
  // `timeframe` = how far back to fetch dark pool prints (data window).
  // Drives the `/ticker-detail?days=N` request below.
  const [timeframe, setTimeframe] = useState("3M");
  // `chartTf` = candle aggregation (independent of the dark pool window).
  // Originally these were coupled — picking "3M" gave you Daily candles and
  // there was no way to view intraday. Now decoupled: the dark pool window
  // and candle TF can be set independently. Defaults to the old TF_MAP
  // mapping so behavior is unchanged out of the box; the useEffect below
  // resets it to that smart default whenever the user picks a new window,
  // so e.g. clicking "1Y" snaps candles to Weekly automatically. User can
  // then override with the second button row.
  const [chartTf, setChartTf] = useState(TF_MAP["3M"].chartTf);
  useEffect(() => {
    const next = TF_MAP[timeframe]?.chartTf;
    if (next) setChartTf(next);
  }, [timeframe]);

  const [prints, setPrints] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Strip cancelled prints AND the original prints they reference. A
  // "Cancelled" notice means the original print never settled — the trade
  // gets re-entered as a new print moments later. We exclude BOTH the cancel
  // notice AND the prior matching print so the cluster only counts the
  // re-entry (the trade that actually filled). PLTR 6/10 example: $300M at
  // $130.21 printed at 4:00:07 PM (original), cancelled at 4:46:38 PM, then
  // re-entered at 4:47:54 PM as AVGPRC — only the re-entry counts.
  //
  // Matching rule: same ticker (already filtered), same volume, same price,
  // earliest occurrence at a timestamp strictly BEFORE the cancel.
  // Same-time-different-day prints get disambiguated by combining date+time
  // into a single sortable key so a 10AM cancel today can't accidentally
  // void a 9AM "original" from last week.
  const activePrints = useMemo(() => {
    if (!prints || prints.length === 0) return [];
    const readNum = (...vals) => { for (const v of vals) if (v != null && v !== "") return Number(v); return 0; };
    const readStr = (...vals) => { for (const v of vals) if (v != null) return String(v); return ""; };
    const readPrice  = p => readNum(p?.price, p?.p);
    const readVolume = p => readNum(p?.volume, p?.v);
    const readMsg    = p => readStr(p?.message, p?.msg, p?.Message);
    const readDate   = p => readStr(p?.date, p?.Date).trim();
    const readTime   = p => readStr(p?.time, p?.timestamp, p?.Timestamp, p?.t).trim();
    const isCancelled = p => readMsg(p).startsWith("Cancelled");
    // Convert "4:46:38 PM" → 16*3600+46*60+38 seconds; missing → 0.
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
    // "6/10/2026" → "2026-06-10" so string compare gives chronological order
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
      excluded.add(cur.idx); // always drop the cancel notice itself
      // Find the most recent matching original BEFORE the cancel timestamp
      const curKey = sortKey(cur);
      let best = null;
      let bestKey = "";
      for (const cand of enriched) {
        if (cand.idx === cur.idx) continue;
        if (cand.cancel) continue;
        if (excluded.has(cand.idx)) continue;
        if (cand.price !== cur.price) continue;
        if (cand.volume !== cur.volume) continue;
        const candKey = sortKey(cand);
        if (candKey >= curKey) continue;          // must be strictly before
        if (!best || candKey > bestKey) { best = cand; bestKey = candKey; }
      }
      if (best) excluded.add(best.idx);
    }
    return prints.filter((_, i) => !excluded.has(i));
  }, [prints]);
  const cancelledCount = (prints?.length || 0) - activePrints.length;
  // Clustered prints — merges multiple prints at the same/close price into
  // single zones so the chart shows aggregated $ rather than 3 lines on top
  // of each other.
  const clusteredPrints = useMemo(() => clusterDarkPoolPrints(activePrints), [activePrints]);

  // Lazy market-cap fallback. The parent's mktcapData store is only
  // populated when the user hits the "Fetch Mkt Cap" button on the Overview
  // tab — which means rows expanded from Above/Below/Unusual/Phantom/Options/
  // Category tabs almost always render with mktcap=0 → "—" or just the cat
  // pill. Here we lazily hit /api/schwab/mktcap-batch with just this row's
  // symbol when the row is opened and we don't already have a value. Cheap
  // (single-symbol query), one-shot per ticker per expansion, and the
  // result lives only in this row's local state so other rows are unaffected.
  // If the prop later updates (parent fetches a bulk batch), the prop wins
  // automatically via the `effectiveMktcap` selector below.
  //
  // Three load states are tracked so the header can show a loading hint
  // (so it's obvious whether the fetch even fired) and an error fallback
  // (with a console line for debugging response-shape mismatches).
  const [fetchedMktcap, setFetchedMktcap] = useState(0);
  const [mktcapLoading, setMktcapLoading] = useState(false);
  const [mktcapErr, setMktcapErr] = useState(null);
  const effectiveMktcap = mktcap > 0 ? mktcap : fetchedMktcap;

  useEffect(() => {
    if (!expanded) return;
    if (mktcap > 0) return;                // parent already has it
    if (fetchedMktcap > 0) return;         // already fetched once for this row
    let cancelled = false;
    setMktcapLoading(true);
    setMktcapErr(null);
    const base = typeof API_BASE !== "undefined" ? API_BASE : "";
    const url = `${base}/api/schwab/mktcap-batch?symbols=${encodeURIComponent(it.t)}`;
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        // Accept several shapes defensively: {mktcap: {SYM: N}} (what the
        // parent's bulk-fetch code reads), {SYM: N}, or {result: {SYM: N}}.
        // If the backend ever changes shape, console will tell us which one
        // we actually got rather than the row silently going stale.
        const v =
          (data?.mktcap?.[it.t] ?? data?.[it.t] ?? data?.result?.[it.t] ?? 0);
        if (typeof v === "number" && v > 0) {
          setFetchedMktcap(v);
        } else {
          console.warn(`[PatternTickerRow] mktcap missing for ${it.t} — response:`, data);
          setMktcapErr("no value");
        }
        setMktcapLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        console.warn(`[PatternTickerRow] mktcap fetch failed for ${it.t}:`, e?.message || e);
        setMktcapErr(e?.message || "fetch failed");
        setMktcapLoading(false);
      });
    return () => { cancelled = true; };
  }, [expanded, it.t, mktcap]);

  // Lazy-fetch prints on expand or timeframe change. StockChart now renders
  // bars natively via its darkPoolBars prop (pixel-perfect alignment via
  // priceToCoordinate), so we no longer need OHLC for our own overlay calc.
  // visible chart, but we need a parallel fetch here so we can compute Y
  // positions for the print bars without needing access to the chart's
  // internal price scale. Path 1: accept slight misalignment if the user
  // zooms; bars are positioned from data range we computed here, not from
  // StockChart's actual rendered scale.
  useEffect(() => {
    if (!expanded) return;
    const tf = TF_MAP[timeframe];
    if (!tf) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/darkpool/ticker-detail?sym=${encodeURIComponent(it.t)}&days=${tf.days}&limit=${tf.limit}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("prints fetch failed")))
      .then(detail => {
        if (cancelled) return;
        setPrints(Array.isArray(detail?.prints) ? detail.prints : []);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e?.message || "fetch error");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [expanded, timeframe, it.t]);

  // Derived values for collapsed row
  const latestPrintPrice = it.bigPrint;
  const movePct = (latestPrintPrice && it.last) ? ((it.last - latestPrintPrice) / latestPrintPrice * 100) : null;
  const moveColor = movePct == null ? C.tx3 : movePct > 0 ? C.green : movePct < 0 ? C.red : C.tx3;
  const sigMult = sig?.mult;
  const sigDays = sig?.days;

  // Mini sparkline (collapsed row) — close-only line with print level marker
  const renderMiniSpark = () => {
    if (!it.prices || it.prices.length < 2) return <span style={{color:C.tx3, fontSize:10}}>—</span>;
    const w = 100, h = 22, P = 2;
    const pts = it.prices.map((p,i) => ({p, i})).filter(x => x.p != null);
    if (pts.length < 2) return <span style={{color:C.tx3, fontSize:10}}>—</span>;
    const allP = [...pts.map(x => x.p), latestPrintPrice].filter(p => p != null);
    const mn = Math.min(...allP), mx = Math.max(...allP);
    const rng = mx - mn || 1;
    const y = p => h - P - ((p - mn) / rng) * (h - P * 2);
    const x = i => P + (i / (it.prices.length - 1 || 1)) * (w - P * 2);
    const linePts = pts.map(x_ => `${x(x_.i)},${y(x_.p)}`).join(" ");
    const lastP = pts[pts.length - 1].p;
    const lastX = x(pts[pts.length - 1].i);
    const lastY = y(lastP);
    const lineColor = latestPrintPrice ? (lastP > latestPrintPrice ? C.green : C.red) : C.cyan;
    const printY = latestPrintPrice ? y(latestPrintPrice) : null;
    return (
      <svg width={w} height={h} style={{display:"block"}} xmlns="http://www.w3.org/2000/svg">
        {printY != null && <line x1={P} y1={printY} x2={w-P} y2={printY} stroke={C.amber} strokeWidth="1" strokeDasharray="2,2" opacity="0.7"/>}
        <polyline points={linePts} fill="none" stroke={lineColor} strokeWidth="1.4"/>
        <circle cx={lastX} cy={lastY} r="2" fill={lineColor}/>
      </svg>
    );
  };

  return (
    <div style={{borderBottom:`1px solid ${C.bdr}33`}}>
      {/* Collapsed row — hidden when noCollapsedRow=true (caller controls expansion) */}
      {!noCollapsedRow && (variant === "notable" ? (
        // Notable Stocks variant — wider ticker name, signal badges, $ and move
        <div onClick={() => setExpanded(!expanded)}
          style={{display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"9px 6px", cursor:"pointer", gap:10,
            background: expanded ? C.bg3 : "transparent", borderRadius:4}}
          onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = C.bgH; }}
          onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}>
          <div style={{display:"flex", alignItems:"center", gap:12, minWidth:0, flex:1}}>
            <span style={{color:CAT_COLORS[it.cat]||C.tx, fontWeight:700, fontSize:14, minWidth:54,
              fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{it.t}</span>
            <div style={{display:"flex", gap:5, flexWrap:"wrap"}}>
              {(it.signals || []).slice(0,3).map(renderSignalTag)}
            </div>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:18, flexShrink:0}}>
            <span style={{fontSize:12, color:C.cyan, fontWeight:600, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
              {it.bigPrintN ? fmt(it.bigPrintN) : "—"}
            </span>
            <span style={{fontSize:12, fontWeight:700, color:moveColor, minWidth:54, textAlign:"right",
              fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
              {movePct == null ? "—" : (movePct > 0 ? "+" : "") + movePct.toFixed(2) + "%"}
            </span>
            <span style={{color:C.tx3, fontSize:11, width:14, textAlign:"center"}}>{expanded ? "▼" : "▶"}</span>
          </div>
        </div>
      ) : (
        // Pattern variant — full grid with all columns
        <div onClick={() => setExpanded(!expanded)}
          style={{display:"grid", gridTemplateColumns:"56px 44px 60px 72px 44px 64px 76px 60px 1fr 20px",
            gap:8, alignItems:"center", padding:"8px 6px", cursor:"pointer",
            background: expanded ? C.bg3 : "transparent",
            borderRadius:4}}
          onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = C.bgH; }}
          onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}>
          <span style={{color: CAT_COLORS[it.cat] || C.tx, fontWeight:700, fontSize:12,
            fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{it.t}</span>
          <span style={{fontSize:8, padding:"1px 5px", borderRadius:6,
            background:(CAT_COLORS[it.cat]||C.tx3)+"22", color:CAT_COLORS[it.cat]||C.tx3,
            fontWeight:700, textAlign:"center", letterSpacing:"0.03em"}}>
            {CAT_SHORT[it.cat] || ""}
          </span>
          <span style={{fontSize:10, color:C.tx2, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
            {effectiveMktcap > 0 ? fmt(effectiveMktcap) : "—"}
          </span>
          <span style={{fontSize:10, color:C.cyan, fontWeight:600, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
            {it.n ? fmt(it.n) : "—"}
          </span>
          <span style={{fontSize:10, color:C.tx2, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
            {sigMult ? `${sigMult}×` : sigDays ? `${sigDays}d` : "—"}
          </span>
          <span style={{fontSize:10, color:C.purple, fontWeight:600, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
            {it.days ? `${it.days}d` : "—"}
          </span>
          <span style={{fontSize:10, color:C.amber, fontWeight:600, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
            {latestPrintPrice ? `$${latestPrintPrice.toFixed(2)}` : "—"}
          </span>
          <span style={{fontSize:10, color:moveColor, fontWeight:700, fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
            {movePct == null ? "—" : (movePct > 0 ? "+" : "") + movePct.toFixed(2) + "%"}
          </span>
          <div>{renderMiniSpark()}</div>
          <span style={{color:C.tx3, fontSize:11, textAlign:"center"}}>{expanded ? "▼" : "▶"}</span>
        </div>
      ))}

      {/* Expanded view — TradingView-style StockChart with dark pool prints overlaid */}
      {expanded && (
        <div style={{background:C.bg3, borderRadius:6, padding:"12px 14px", margin:"4px 0 8px", border:`1px solid ${C.bdr}`}}>
          {/* Header row with metadata + timeframe selector */}
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:10}}>
            <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap"}}>
              <span style={{color:CAT_COLORS[it.cat]||C.tx, fontWeight:700, fontSize:15}}>{it.t}</span>
              {/* Market cap (or category fallback when mkt cap data hasn't loaded).
                  Color-coded by cap tier — same palette as the ticker — so the
                  size context is preserved without printing the category twice.
                  Three states: (1) loaded → "$144B mkt cap", (2) loading →
                  "loading mkt cap…", (3) failed/missing → cat pill ("Large Cap"). */}
              {effectiveMktcap > 0 ? (
                <span style={{fontSize:9, padding:"2px 6px", borderRadius:8,
                  background:(CAT_COLORS[it.cat]||C.tx3)+"22", color:CAT_COLORS[it.cat]||C.tx3,
                  fontWeight:700}}>{fmt(effectiveMktcap)} mkt cap</span>
              ) : mktcapLoading ? (
                <span style={{fontSize:9, padding:"2px 6px", borderRadius:8,
                  background:C.bg3, color:C.tx3,
                  fontWeight:600, fontStyle:"italic"}}>loading mkt cap…</span>
              ) : (
                <span style={{fontSize:9, padding:"2px 6px", borderRadius:8,
                  background:(CAT_COLORS[it.cat]||C.tx3)+"22", color:CAT_COLORS[it.cat]||C.tx3,
                  fontWeight:700}}
                  title={mktcapErr ? `Mkt cap fetch: ${mktcapErr}` : undefined}>{it.cat || "—"}</span>
              )}
              {/* Total dark pool premium — sum of $ notional of all prints in
                  the current per-ticker window. Renamed from "Total flow"
                  because dark pool prints don't reveal direction or intent,
                  so "flow" is misleading; "premium" matches options-style
                  terminology people already use for $ notional. */}
              <span style={{color:C.tx3, fontSize:10}}>·</span>
              <span style={{color:C.tx3, fontSize:10}}>Total dark pool premium</span>
              <span style={{color:C.cyan, fontWeight:600, fontSize:10}}>{it.n ? fmt(it.n) : "—"}</span>
              {it.n > 0 && effectiveMktcap > 0 && (
                <span style={{color:C.amber, fontWeight:600, fontSize:10,
                  padding:"1px 6px", borderRadius:6,
                  background:C.amber + "15", border:`1px solid ${C.amber}33`}}
                  title="Total dark pool $ notional as a percentage of the stock's market cap. Higher = bigger relative size vs the company.">
                  {(it.n / effectiveMktcap * 100).toFixed(2)}% of mkt cap
                </span>
              )}
              {prints && <>
                <span style={{color:C.tx3, fontSize:10}}>·</span>
                {/* Explicit timeframe label so "in 3M" stops looking like a $
                    amount. TF_MAP keys map to plain-English suffixes. */}
                <span style={{color:C.amber, fontWeight:600, fontSize:10}}>
                  {activePrints.length} dark pool {activePrints.length === 1 ? "print" : "prints"}
                  {clusteredPrints.length < activePrints.length && (
                    <span style={{color:C.tx3, fontWeight:400}}> ({clusteredPrints.length} {clusteredPrints.length === 1 ? "zone" : "zones"})</span>
                  )}
                  {cancelledCount > 0 && (
                    <span style={{color:C.red, fontWeight:400}} title="Cancelled prints excluded along with their original — the trade never settled, only the re-entry counts"> · {cancelledCount} voided</span>
                  )} · {
                    timeframe === "1W"  ? "past week" :
                    timeframe === "1M"  ? "past month" :
                    timeframe === "3M"  ? "past 3 months" :
                    timeframe === "6M"  ? "past 6 months" :
                    timeframe === "1Y"  ? "past year" :
                    timeframe === "All" ? "all history" : timeframe
                  }
                </span>
              </>}
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end"}}>
              {/* Row 1 — dark pool window (how many days of prints to fetch).
                  Amber styling matches the rest of the dark pool theming. */}
              <div style={{display:"flex", gap:3, alignItems:"center"}}>
                <span style={{fontSize:8, color:C.tx3, marginRight:4, letterSpacing:"0.05em",
                  fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>PRINTS</span>
                {Object.keys(TF_MAP).map(tf => {
                  const active = tf === timeframe;
                  return (
                    <button key={tf} onClick={() => setTimeframe(tf)}
                      style={{padding:"3px 9px", borderRadius:4, fontSize:9, fontWeight:700, fontFamily:"inherit", cursor:"pointer",
                        border:`1px solid ${active ? C.amber : C.bdr2}`,
                        background: active ? C.amber+"22" : "transparent",
                        color: active ? C.amber : C.tx2}}>{tf}</button>
                  );
                })}
              </div>
              {/* Row 2 — candle timeframe (chart aggregation) used to live here
                  as its own button row. Retired: ChartPane (below) renders the
                  canonical timeframe bar now. `chartTf`/`setChartTf` stay —
                  the dark-pool-window effect above still resets chartTf to a
                  smart default, and ChartPane's onTfChange keeps it in sync
                  with whatever the user picks on the canonical bar. */}
            </div>
          </div>

          {loading && <div style={{textAlign:"center", padding:"40px 0", color:C.tx3, fontSize:12}}>Loading dark pool prints…</div>}
          {error && <div style={{textAlign:"center", padding:"40px 0", color:C.red, fontSize:12}}>Failed to load prints: {error}</div>}

          {/* The SAME chart the /charts workspace renders — identity row,
              session toggle, market clock, timeframe bar, market-cap/earnings/
              UCT-rating meta, settings gear and drawing tools. Dark pool bars
              still render natively inside StockChart via the darkPoolBars prop
              (now routed through stockChartProps) — uses
              series.priceToCoordinate() for pixel-perfect alignment that
              follows zoom/pan. `onSymbolChange` is deliberately omitted: this
              is a contextual chart for the row the user expanded, so the
              identity row renders a static label, not a search box. */}
          <div style={{position:"relative", width:"100%", borderRadius:6, overflow:"hidden"}}>
            <Suspense fallback={<div style={{height:480, display:"flex", alignItems:"center", justifyContent:"center", color:C.tx3, fontSize:12}}>Loading chart…</div>}>
              <ChartPane
                sym={it.t}
                tf={chartTf}
                onTfChange={setChartTf}
                stored={null}
                stockChartProps={{
                  height: 480,
                  liveUpdates: true,
                  showDrawingTools: true,
                  showVolume: true,
                  darkPoolBars: clusteredPrints,
                  priceFormat: { type: 'price', precision: 0, minMove: 1 },
                  hideReplay: true,
                  hidePatterns: true,
                  hideCompare: true,
                  hideCountdown: true,
                }}
              />
            </Suspense>
          </div>

          <div style={{display:"flex", alignItems:"center", gap:14, marginTop:8, fontSize:9, color:C.tx3, flexWrap:"wrap"}}>
            <span><span style={{display:"inline-block", width:14, height:6, background:C.amber, verticalAlign:"middle", marginRight:4}}></span>Top 3 prints labeled (top 5 in gold, biggest brightest)</span>
            <span><span style={{display:"inline-block", width:14, height:5, background:"#9c9588", verticalAlign:"middle", marginRight:4, opacity:0.6}}></span>Smaller prints (hover to see $ amount)</span>
            <span>·</span>
            <span>Bars follow chart zoom/pan</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dark Pool by Sector ──────────────────────────────────────────────────────
// Aggregates dark pool prints by sector, weighted by notional. Click a sector
// to expand inline showing every ticker in it (via FlowTable, which itself
// supports click-to-expand-chart on each row).
function SectorDarkPoolPanel({allItems, mktcapData, onJumpTo}){
  const [expandedSector, setExpandedSector] = useState(null);

  // Rebuild sector data from filtered allItems (respects global cap filter).
  // Store the FULL item objects (not just ticker/notional) so the expanded
  // view can hand them straight to FlowTable.
  const sectors = useMemo(() => {
    const secMap = {};
    for (const item of allItems) {
      const sec = item.sector || "";
      if (!sec || sec === "Miscellaneous" || sec === "Other" || sec === "None") continue;
      if (!secMap[sec]) secMap[sec] = { sector: sec, notional: 0, tickers: [], weightedMove: 0, weightedN: 0, count: 0 };
      secMap[sec].notional += item.n;
      secMap[sec].tickers.push(item);     // full item, not just {t, n}
      secMap[sec].count++;
      if (item.bigPrint > 0) {
        const move = (item.last - item.bigPrint) / item.bigPrint * 100;
        secMap[sec].weightedMove += move * item.bigPrintN;
        secMap[sec].weightedN += item.bigPrintN;
      }
    }
    return Object.values(secMap)
      .filter(s => s.count >= 2)
      .map(s => ({
        ...s,
        avgMove: s.weightedN > 0 ? s.weightedMove / s.weightedN : 0,
        topTickers: [...s.tickers].sort((a, b) => b.n - a.n).slice(0, 3).map(t => t.t),
        sortedTickers: [...s.tickers].sort((a, b) => b.n - a.n),
      }))
      .sort((a, b) => b.notional - a.notional)
      .slice(0, 8);
  }, [allItems]);

  const maxN = useMemo(() => Math.max(...sectors.map(s => s.notional), 1), [sectors]);

  return (
    <div style={{background:C.bg2, border:`1px solid ${C.bdr}`, borderRadius:8, padding:"16px 18px"}}>
      <div style={{fontSize:10, fontWeight:700, letterSpacing:"0.12em", color:C.tx3,
        textTransform:"uppercase", marginBottom:10}}>Dark Pool by Sector</div>
      {sectors.length === 0 && <div style={{fontSize:12, color:C.tx3}}>No sector data available</div>}
      {sectors.map(s => {
        const pct = Math.max((s.notional / maxN) * 100, 2);
        const moveColor = s.avgMove > 0.3 ? C.green : s.avgMove < -0.3 ? C.red : C.tx3;
        const isExpanded = expandedSector === s.sector;
        return (
          <div key={s.sector} style={{marginBottom: isExpanded ? 14 : 8}}>
            <div onClick={() => setExpandedSector(isExpanded ? null : s.sector)}
              title={isExpanded ? "Click to hide tickers" : "Click to expand tickers in this sector"}
              style={{cursor:"pointer", padding: isExpanded ? "4px 6px" : "0",
                margin: isExpanded ? "0 -6px" : "0",
                background: isExpanded ? C.bg3 : "transparent",
                borderRadius: 4, transition:"background 0.15s"}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2}}>
                <div style={{display:"flex", alignItems:"center", gap:6, minWidth:0}}>
                  <span style={{fontSize:10, color:C.tx3, width:10, display:"inline-block"}}>{isExpanded ? "▼" : "▶"}</span>
                  <span style={{fontSize:11, fontWeight:600, color:C.tx}}>{s.sector}</span>
                  <span style={{fontSize:8, color:C.tx3}}>{s.topTickers.join(" · ")}</span>
                </div>
                <div style={{display:"flex", alignItems:"center", gap:8, flexShrink:0}}>
                  <span style={{fontSize:9, color:C.tx3}}>{s.count}</span>
                  <span style={{fontSize:10, fontWeight:700, color:moveColor,
                    fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", minWidth:40, textAlign:"right"}}>
                    {s.avgMove > 0 ? "+" : ""}{s.avgMove.toFixed(1)}%
                  </span>
                  <span style={{fontSize:10, fontWeight:700, color:C.cyan,
                    fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", minWidth:52, textAlign:"right"}}>
                    {fmt(s.notional)}
                  </span>
                </div>
              </div>
              <div style={{width:"100%", height:4, background:C.bdr, borderRadius:2, overflow:"hidden"}}>
                <div style={{width:pct+"%", height:"100%", background:moveColor, borderRadius:2, opacity:0.7, transition:"width 0.4s"}}/>
              </div>
            </div>
            {isExpanded && (
              <div style={{marginTop:8, padding:"8px 10px", background:C.bg3+"40",
                borderLeft:`2px solid ${C.amber}`, borderRadius:4}}>
                <div style={{fontSize:9, color:C.tx3, marginBottom:6, letterSpacing:"0.05em"}}>
                  All {s.tickers.length} tickers in {s.sector} · sorted by notional · click any to see chart
                </div>
                <FlowTable items={s.sortedTickers} showCat={true} mktcapData={mktcapData}/>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Notable Prints — Post-Print Moves ────────────────────────────────────────
// Tracks recent individual big prints (bigPrintN ≥ $20M, excluding the USUAL
// mega-cap/ETF set), sorted by recency. The "% Move" column is the post-print
// performance: how far the price has moved since that dark pool print landed.
// Click any row to expand the chart inline.
function NotablePrintsPanel({allItems, mktcapData, USUAL}){
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [hov, setHov] = useState(null);

  const tracked = useMemo(() => {
    return allItems
      .filter(i => i.bigPrint > 0 && i.bigPrintN >= 20_000_000 && i.bigPrintDk && !USUAL.has(i.t))
      .sort((a, b) => {
        if (a.bigPrintDk && b.bigPrintDk) return b.bigPrintDk.localeCompare(a.bigPrintDk);
        return b.bigPrintN - a.bigPrintN;
      })
      .slice(0, 12);
  }, [allItems, USUAL]);

  return (
    <div style={{background:C.bg2, border:`1px solid ${C.bdr}`, borderRadius:8, padding:"16px 18px"}}>
      <div style={{fontSize:10, fontWeight:700, letterSpacing:"0.12em", color:C.tx3,
        textTransform:"uppercase", marginBottom:10}}>Notable Prints — Post-Print Moves</div>

      {/* Column headers — mirrors Notable Activity / Biggest Prints panels */}
      <div style={{display:"flex", justifyContent:"space-between", padding:"0 0 5px 0",
        borderBottom:`1px solid ${C.bdr2}`, marginBottom:2}}>
        <div style={{display:"flex", gap:6, alignItems:"center"}}>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, width:18, textAlign:"center"}}>#</span>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:50}}>Ticker</span>
        </div>
        <div style={{display:"flex", gap:10, alignItems:"center"}}>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:52, textAlign:"right"}}>Mkt Cap</span>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:56, textAlign:"right"}}>Print $</span>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:60, textAlign:"right"}}>Notional</span>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:38, textAlign:"right"}}>Date</span>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:52, textAlign:"right"}}>Last</span>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:48, textAlign:"right"}}>% Move</span>
          <span style={{fontSize:9, color:C.tx3, fontWeight:600, minWidth:52, textAlign:"right"}}>% AvgVol</span>
        </div>
      </div>

      {tracked.length === 0 && <div style={{fontSize:12, color:C.tx3, padding:8}}>No notable prints for this period</div>}
      {tracked.map((it, i) => {
        const move = ((it.last - it.bigPrint) / it.bigPrint * 100);
        const moveColor = move > 0.5 ? C.green : move < -0.5 ? C.red : C.tx3;
        const cc = CAT_COLORS[it.cat] || C.tx;
        const avgV = it.bigPrintPctAvgVol;
        const avgVColor = avgV >= 50 ? C.pink : avgV >= 20 ? C.amber : avgV > 0 ? C.tx2 : C.tx3;
        const isExpanded = expandedTicker === it.t;
        return (
          <Fragment key={it.t}>
            <div onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
              onClick={() => setExpandedTicker(isExpanded ? null : it.t)}
              title={isExpanded ? "Click to hide chart" : "Click to show dark pool chart"}
              style={{display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"5px 0", borderBottom:`1px solid ${C.bdr}22`,
                background: isExpanded ? C.bg3 : (hov === i ? C.bg3+"80" : "transparent"),
                transition:"background 0.15s", cursor:"pointer"}}>
              <div style={{display:"flex", gap:5, alignItems:"center"}}>
                <span style={{fontSize:10, color:C.tx3,
                  fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                  width:18, textAlign:"center", fontWeight:600}}>{isExpanded ? "▼" : (i + 1)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                  fontWeight:700, fontSize:12, color:cc}}>{it.t}</span>
                {it.signals && it.signals.length > 0 && <SignalBadges signals={it.signals.slice(0, 1)} compact/>}
              </div>
              <div style={{display:"flex", gap:10, alignItems:"center"}}>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", fontSize:10,
                  color:C.tx3, minWidth:52, textAlign:"right"}}>
                  {(mktcapData[it.t] || 0) > 0 ? fmt(mktcapData[it.t]).replace("$", "") : "—"}
                </span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", fontSize:11, color:C.amber,
                  fontWeight:600, minWidth:56, textAlign:"right"}}>{fP(it.bigPrint)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", fontSize:11, color:C.cyan,
                  fontWeight:700, minWidth:60, textAlign:"right"}}>{fmt(it.bigPrintN)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", fontSize:10, color:C.tx3,
                  minWidth:38, textAlign:"right"}}>{it.bigPrintDate || "—"}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", fontSize:11,
                  color:C.tx, fontWeight:600, minWidth:52, textAlign:"right"}}>{fP(it.last)}</span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", fontSize:11, fontWeight:700,
                  color:moveColor, minWidth:48, textAlign:"right"}}>
                  {move > 0 ? "+" : ""}{move.toFixed(1)}%
                </span>
                <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif", fontSize:11, fontWeight:700,
                  color:avgVColor, minWidth:52, textAlign:"right"}}>
                  {avgV > 0 ? fmtAvgVol(avgV) : "—"}
                </span>
              </div>
            </div>
            {isExpanded && (
              <div style={{padding:"4px 0 12px", background:C.bg3+"40"}}>
                <PatternTickerRow
                  it={it}
                  sig={null}
                  mktcap={mktcapData?.[it.t] || 0}
                  noCollapsedRow={true}/>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewPane({onJumpTo, filterByCat, mktcapData, fetchMktCap, mktcapLoading}){
  // Track which signal-group accordions are expanded in the Signals By Type panel.
  const [expandedSignals, setExpandedSignals] = useState(new Set());
  const toggleSignal = (type) => setExpandedSignals(prev => {
    const next = new Set(prev);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  const sectionLabel = txt => (
    <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
      textTransform:"uppercase",marginBottom:10}}>{txt}</div>
  );

  // Compute zone counts across ALL tickers
  const {aboveN,insideN,belowN,allItems}=(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) map[it.t]=it;
    const items=filterByCat(Object.values(map));
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
          <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,
            fontSize:12,color:C.tx,minWidth:52}}>{item.t}</span>
          <span style={{fontSize:10,color:C.tx3}}>
            Zone {fP(item.lo)}–{fP(item.hi)}
          </span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,color:C.tx2}}>
            {fP(item.last)}
          </span>
          <div style={{position:"relative",display:"inline-block"}}
            onMouseEnter={()=>setBpHover(true)} onMouseLeave={()=>setBpHover(false)}>
            <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,color:C.amber,
              fontWeight:700,minWidth:68,display:"inline-block",textAlign:"right",cursor:"default"}}>
              {fP(item.bigPrint)}
              {tip && <span style={{fontSize:9,color:C.amber,opacity:0.5,marginLeft:3,
                verticalAlign:"middle",fontWeight:400}}>ⓘ</span>}
            </span>
            {bpHover && tip && (
              <div style={{position:"absolute",right:0,top:"100%",zIndex:50,
                background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
                padding:"7px 11px",whiteSpace:"nowrap",boxShadow:"0 4px 20px #00000066",
                marginTop:4,color:C.tx,fontSize:13,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                fontWeight:500,letterSpacing:"0.01em"}}>
                {tip}
              </div>
            )}
          </div>
          <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:12,
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

      {/* ── Intelligence Panel v2 — newbie-friendly: plain English narrative, ─ */}
      {/* renamed signal labels with hover tooltips, expanded ETF filter. ────── */}
      {(()=>{
        // Expanded filter: bonds, treasuries, money-market, index/sector ETFs, mega caps
        const USUAL_EXPANDED = new Set([
          // Index/sector ETFs (anything passive that always has flow)
          "SPY","QQQ","IWM","DIA","VOO","IVV","VTI","RSP","MDY","TQQQ","SQQQ","UPRO","SPXL","SOXL","SOXS","TNA","TZA",
          "XLF","XLE","XLK","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GLD","SLV","TLT","HYG","LQD","AGG","BND",
          "EEM","EFA","VEA","VWO","FNDX","FNDA","SCHG","SCHI","SCHM","SCHX","VUG","VTV","VO","VB","IEFA","IEMG","ACWI","VGT",
          "IWF","IWD","IWB","IWR","IWS","IWP","IJH","IJR","SPYM","SPYG","SPYV","SPMD","SPSM","IGV","IGE","IGM","ITB","ITA",
          // Mega caps (always have flow)
          "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","JPM","V","MA","UNH","HD","PG","JNJ","XOM","CVX",
          "BAC","WFC","NFLX","ORCL","CRM","AMD","INTC","MU","QCOM","BRK.B","COST","LLY","MRK","ABBV","PEP","KO",
          // Bond / treasury / money-market ETFs (the noise floor)
          "IEF","BIL","JPST","IQMM","BSV","PULS","MAGS","VONV","SPIB","USFR","SGOV","STIP","TIP","BIV","TLH","GOVZ","EDV","VGLT",
          "GOVT","MBB","VCIT","VCSH","VTIP","VGIT","VUSB","VCLT","SHY","BNDX","VWOB","EMB","JNK","SPHY","FALN","BKLN","SJNK","SRLN",
          "SUB","MUB","TFI","BSCS","BSCT","NEAR","ICSH","JIVI","MINT","SHV","FLOT","GBIL","BILS",
        ]);
        const isJunk = (it) => USUAL_EXPANDED.has(it.t) || isFundSecurity(it) ||
          it.cat === "Bond ETFs" || it.cat === "Commodity ETFs" || it.cat === "Intl/EM ETFs" || it.cat === "Sector ETFs";

        // Compute regime: what % of notional is "junk" (passive/bonds)
        const totalNotional = allItems.reduce((s,i) => s + (i.bigPrintN || 0), 0);
        const junkNotional = allItems.filter(isJunk).reduce((s,i) => s + (i.bigPrintN || 0), 0);
        const junkPct = totalNotional > 0 ? Math.round(junkNotional / totalNotional * 100) : 0;
        // Plain-English narrative — describes WHERE dark pool prints landed,
        // not WHY. Dark pool prints don't reveal direction or intent (buy vs
        // sell, opening vs closing), so we avoid "flow", "buying", "risk-on/off",
        // or any directional/conviction framing. We describe the split between
        // individual-stock prints and passive (bond/index/sector ETF) prints,
        // which is a structural observation, not a sentiment read.
        const narrativeText =
          junkPct >= 70 ? `Most dark pool prints today landed in bonds, treasuries, and broad index ETFs (${junkPct}% of total premium). Heavy passive activity — most of the notional is sitting in baskets, not single names.` :
          junkPct >= 50 ? `Dark pool prints split between passive ETFs and individual stocks (${junkPct}% in bonds/index ETFs). Mixed makeup — neither single names nor baskets dominate.` :
          junkPct <= 25 ? `Most dark pool prints today landed in individual stocks (only ${junkPct}% in bonds/index ETFs). Heavy single-name activity — institutions are printing in specific tickers, not just baskets.` :
          `Dark pool prints today are spread fairly evenly between individual stocks and broad/passive ETFs (${junkPct}% in bonds/index ETFs).`;
        // Color now reflects only the structural skew, not bullish/bearish —
        // amber stays neutral, dimming gray for the balanced default.
        const narrativeColor = junkPct >= 70 ? C.amber : junkPct >= 50 ? C.amber : junkPct <= 25 ? C.tx : C.tx2;

        // Notable stocks: tradeable equity caps only, with at least one signal, not in junk filter
        const notableStocks = allItems
          .filter(i => ["Large Cap","Mid Cap","Small Cap"].includes(i.cat))
          .filter(i => !USUAL_EXPANDED.has(i.t))
          // classifyTicker only knows the curated ETF sets, so funds the tape
          // has never seen (SCMB, FLJP) fall through to a cap bucket and land in
          // a list whose own caption promises bonds/index ETFs are filtered out.
          .filter(i => !isFundSecurity(i))
          .filter(i => (i.signals || []).length > 0)
          .sort((a,b) => ((b.signals||[]).length - (a.signals||[]).length) || ((b.bigPrintN||0) - (a.bigPrintN||0)))
          .slice(0, 10);

        // Group signals by pattern type
        const signalGroups = {
          YEARLY_RECORD: [], MONTHLY_RECORD: [], NOTIONAL_SPIKE: [],
          ZONE_BREAK_RECORD: [], SIZE_ESCALATION: [], RARE_FLOW: [],
        };
        allItems.forEach(it => {
          (it.signals || []).forEach(s => {
            if (signalGroups[s.type]) signalGroups[s.type].push({...it, _sig: s});
          });
        });
        Object.keys(signalGroups).forEach(k => {
          signalGroups[k].sort((a,b) => (b._sig.mult || 0) - (a._sig.mult || 0) || (b.bigPrintN || 0) - (a.bigPrintN || 0));
        });

        const totalSignalCount = Object.values(signalGroups).reduce((s,arr) => s + arr.length, 0);
        const hasAnySignal = totalSignalCount > 0;

        return (
          <>
            {/* 1. Headline — plain English explanation of today's flow regime */}
            <div style={{background:C.bg2, border:`1px solid ${C.bdr}`, borderRadius:8, padding:"14px 18px"}}>
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4}}>
                <div style={{fontSize:13, fontWeight:700, color:C.amber}}><UIcon name="copy" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />What's Happening Today</div>
                <div style={{fontSize:9, color:C.tx3}}>{D.meta.dateRange || "Selected Period"}</div>
              </div>
              <div style={{fontSize:10, color:C.tx3, marginBottom:10, fontStyle:"italic"}}>
                A plain-English read on where institutional money is moving
              </div>
              <div style={{fontSize:13, color:narrativeColor, lineHeight:1.5, fontWeight:600}}>
                {narrativeText}
              </div>
              {notableStocks.length > 0 && (
                <div style={{fontSize:12, color:C.tx2, lineHeight:1.6, marginTop:8}}>
                  <span style={{color:C.tx3}}>A few individual stocks did show unusual activity worth watching: </span>
                  {notableStocks.slice(0,5).map((t,i,a) => (
                    <span key={t.t}>
                      <span style={{color:C.amber, fontWeight:700, cursor:"pointer"}} onClick={()=>onJumpTo(t.t)}>{t.t}</span>
                      {i < a.length - 1 && <span style={{color:C.tx3}}>, </span>}
                    </span>
                  ))}
                  {notableStocks.length > 5 && <span style={{color:C.tx3}}> +{notableStocks.length - 5} more below</span>}
                </div>
              )}
            </div>

            {/* 1b. Standouts strip — today's big-and-unusual names as cards, up top */}
            {notableStocks.length > 0 && (() => {
              // Rank by the dollars on the card, not by % of average volume.
              // %AvgVol favours whatever barely trades — a $54M print in a
              // sleepy name scores 234% while AMGN's $448M scores 46% and never
              // shows. Dollars first keeps the hero row on the real size, and
              // leaves the SIZE badge (%AvgVol ≥ 20) meaning something again.
              const standouts = [...notableStocks]
                .sort((a,b) => ((b.bigPrintN||0) - (a.bigPrintN||0)) || ((b.bigPrintPctAvgVol||0) - (a.bigPrintPctAvgVol||0)))
                .slice(0,4);
              return (
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:2}}>
                  {standouts.map(s => {
                    const av = s.bigPrintPctAvgVol||0;
                    const avColor = av>=50?C.pink:av>=20?C.amber:av>0?C.tx2:C.tx3;
                    return (
                      <div key={s.t} onClick={()=>onJumpTo&&onJumpTo(s.t)}
                        style={{background:C.bg2, border:`1px solid ${C.bdr}`, borderLeft:`3px solid ${C.amber}`,
                          borderRadius:"0 8px 8px 0", padding:"11px 13px", cursor:"pointer"}}>
                        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
                          <span style={{fontWeight:700, fontSize:14, color:CAT_COLORS[s.cat]||C.tx,
                            fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{s.t}</span>
                          {av>=20 && <span style={{fontSize:8, fontWeight:700, color:C.bg, background:C.amber,
                            borderRadius:4, padding:"1px 5px", letterSpacing:"0.04em"}}>SIZE</span>}
                        </div>
                        <div style={{fontSize:19, fontWeight:700, color:C.tx,
                          fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{s.bigPrintN?fmt(s.bigPrintN):"—"}</div>
                        <div style={{fontSize:10, color:C.tx3, marginTop:2,
                          fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
                          {s.bigPrint?`@ $${s.bigPrint.toFixed(2)}`:""}
                          {av>0 ? <span> · <span style={{color:avColor}}>{av.toFixed(0)}% avg</span></span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* 2. Notable Stocks — tradeable equities with signals, plain-English tags */}
            {notableStocks.length > 0 && (
              <div style={{background:C.bg2, border:`1px solid ${C.bdr}`, borderRadius:8, padding:"14px 18px"}}>
                <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2}}>
                  <div style={{fontSize:13, fontWeight:700, color:C.tx}}><UIcon name="patterns" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Notable Stocks ({notableStocks.length})</div>
                  <div style={{fontSize:9, color:C.tx3, fontStyle:"italic"}}>
                    bonds · treasuries · index ETFs filtered out
                  </div>
                </div>
                <div style={{fontSize:10, color:C.tx3, marginBottom:12, fontStyle:"italic"}}>
                  Individual stocks where big institutional buyers were active. The colored tags show what kind of unusual activity. Hover any tag to learn what it means.
                </div>
                {/* Column header strip */}
                <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", padding:"4px 0", marginBottom:4, borderBottom:`1px solid ${C.bdr}`}}>
                  <div style={{fontSize:9, color:C.tx3, letterSpacing:"0.08em", textTransform:"uppercase"}}>Stock</div>
                  <div style={{display:"flex", gap:18, alignItems:"center", fontSize:9, color:C.tx3, letterSpacing:"0.08em", textTransform:"uppercase"}}>
                    <span>Big $ Amount</span>
                    <span style={{minWidth:54, textAlign:"right"}}>Since Print</span>
                  </div>
                </div>
                {notableStocks.map((t) => (
                  <PatternTickerRow key={t.t}
                    it={t}
                    sig={null}
                    variant="notable"
                    mktcap={mktcapData?.[t.t] || 0}
                    onJumpTo={onJumpTo}/>
                ))}
              </div>
            )}

            {/* 3. Patterns Detected — collapsible groups with plain-English labels */}
            {hasAnySignal && (
              <div style={{background:C.bg2, border:`1px solid ${C.bdr}`, borderRadius:8, padding:"14px 18px"}}>
                <div style={{fontSize:13, fontWeight:700, color:C.tx, marginBottom:2}}>
                  <UIcon name="breadth" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Patterns Detected ({totalSignalCount} total)
                </div>
                <div style={{fontSize:10, color:C.tx3, marginBottom:6, fontStyle:"italic"}}>
                  Each pattern below describes a different way today's flow stood out. Click any group to see which stocks show that pattern.
                </div>
                {Object.keys(SIG_META).map(key => {
                  const items = signalGroups[key] || [];
                  const meta = SIG_META[key];
                  const expanded = expandedSignals.has(key);
                  const disabled = items.length === 0;
                  return (
                    <div key={key} style={{borderBottom:`1px solid ${C.bdr}44`}}>
                      <button onClick={() => !disabled && toggleSignal(key)}
                        disabled={disabled}
                        style={{
                          width:"100%", padding:"8px 4px", textAlign:"left",
                          background:"transparent", border:"none", cursor:disabled ? "default" : "pointer",
                          fontFamily:"inherit",
                          display:"flex", alignItems:"center", gap:8
                        }}>
                        <span style={{fontSize:12, fontWeight:700, color: disabled ? C.tx3 : (expanded ? meta.color : C.tx)}}>
                          {disabled ? "·" : (expanded ? "▼" : "▶")} {meta.groupLabel}
                        </span>
                        <span style={{fontSize:11, color:C.tx3}}>({items.length})</span>
                        <span title={meta.groupTip} style={{color:C.tx3, fontSize:11, cursor:"help", marginLeft:2}}>ⓘ</span>
                      </button>
                      {expanded && items.length > 0 && (
                        <div style={{paddingLeft:6, paddingBottom:10}}>
                          {/* Column header strip — matches PatternTickerRow grid columns */}
                          <div style={{display:"grid", gridTemplateColumns:"56px 44px 60px 72px 44px 64px 76px 60px 1fr 20px",
                            gap:8, alignItems:"center", padding:"4px 6px",
                            fontSize:8, color:C.tx3, letterSpacing:"0.08em", textTransform:"uppercase",
                            borderBottom:`1px solid ${C.bdr}`}}>
                            <span>Ticker</span>
                            <span>Cap</span>
                            <span>Mkt Cap</span>
                            <span>Total $</span>
                            <span>Mult</span>
                            <span>Days Seen</span>
                            <span>Print $</span>
                            <span>Move</span>
                            <span>Price vs Print</span>
                            <span></span>
                          </div>
                          {items.slice(0, 30).map((it,i) => (
                            <PatternTickerRow key={it.t+"_"+i}
                              it={it}
                              sig={it._sig}
                              mktcap={mktcapData?.[it.t] || 0}
                              onJumpTo={onJumpTo}/>
                          ))}
                          {items.length > 30 && <div style={{fontSize:10, color:C.tx3, marginTop:6, paddingLeft:6}}>+{items.length - 30} more</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Notable Activity + Biggest Prints (side by side) ─────── */}
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:4}}>
        <button onClick={()=>{
          const tickers = allItems.slice(0,50).map(i=>i.t);
          fetchMktCap(tickers);
        }}
          disabled={mktcapLoading}
          style={{padding:"4px 12px",borderRadius:4,border:`1px solid ${C.bdr2}`,
            background:mktcapLoading?C.bg3:"transparent",color:mktcapLoading?C.tx3:C.cyan,
            fontSize:9,fontWeight:600,cursor:mktcapLoading?"wait":"pointer",
            fontFamily:"inherit",transition:"all 0.15s"}}>
          {mktcapLoading?"Fetching…":"Fetch Mkt Cap"}
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>

        {/* Notable Activity */}
        <NotableActivityPanel filterByCat={filterByCat} mktcapData={mktcapData} fetchMktCap={fetchMktCap} mktcapLoading={mktcapLoading}/>

        {/* Biggest Prints */}
        <BiggestPrintsPanel filterByCat={filterByCat} mktcapData={mktcapData} fetchMktCap={fetchMktCap} mktcapLoading={mktcapLoading}/>
      </div>

      {/* ── Dark Pool by Sector + Notable Prints ──────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>

        {/* Dark Pool by Sector — weighted by notional, no Miscellaneous,
            click sector to expand showing all tickers in that sector */}
        <SectorDarkPoolPanel allItems={allItems} mktcapData={mktcapData} onJumpTo={onJumpTo}/>

        {/* Notable Prints — recent biggest prints, sorted by recency, with
            click-to-expand chart per row. */}
        <NotablePrintsPanel allItems={allItems} mktcapData={mktcapData} USUAL={USUAL}/>

      </div>
    </div>
  );
}

// ── Above / Below tabs ───────────────────────────────────────────────────────
function AbovePane({filterByCat, mktcapData}){
  const items=filterByCat([...D.above]).sort((a,b)=>b.pct-a.pct);
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.green,marginBottom:4}}>
          ▲ Trading Above Dark Pool Zone <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({items.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3,lineHeight:1.5}}>
          Closed <b style={{color:C.green}}>above</b> the 25th–75th percentile institutional execution range.
          Sorted by % distance above zone. Bullish momentum signal.
        </div>
      </div>
      <FlowTable items={items} mktcapData={mktcapData}/>
    </div>
  );
}

function BelowPane({filterByCat, mktcapData}){
  const items=filterByCat([...D.below]).sort((a,b)=>a.pct-b.pct);
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.red,marginBottom:4}}>
          ▼ Trading Below Dark Pool Zone <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({items.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3,lineHeight:1.5}}>
          Closed <b style={{color:C.red}}>below</b> the institutional execution range.
          Sorted by % distance below zone. Bearish pressure signal.
        </div>
      </div>
      <FlowTable items={items} mktcapData={mktcapData}/>
    </div>
  );
}

// ── Unusual Flow tab ─────────────────────────────────────────────────────────
function UnusualPane({filterByCat, mktcapData}){
  const items=filterByCat(D.unusual);
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.amber,marginBottom:4}}>
          Unusual Flow Activity <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({items.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Tickers with UOA flag — unusual options/dark pool activity relative to historical norms.
        </div>
      </div>
      <FlowTable items={items} mktcapData={mktcapData}/>
    </div>
  );
}

// ── Phantom Prints tab ───────────────────────────────────────────────────────
function PhantomPane({mktcapData = {}}){
  // Track which row is expanded to show the dark-pool chart
  const [expandedKey, setExpandedKey] = useState(null);
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
              const key = `${p.ticker}-${p.date}-${i}`;
              const isExpanded = expandedKey === key;
              return (
                <Fragment key={key}>
                  <tr style={{background:isExpanded?C.bg3:"transparent", cursor:"pointer"}}
                    onClick={()=>setExpandedKey(isExpanded ? null : key)}
                    onMouseEnter={e=>{if(!isExpanded) e.currentTarget.style.background=C.bgH;}}
                    onMouseLeave={e=>{if(!isExpanded) e.currentTarget.style.background="transparent";}}
                    title={isExpanded ? "Click to hide chart" : "Click to show dark pool chart"}>
                    <TD>
                      <span style={{display:"inline-flex", alignItems:"center", gap:6}}>
                        <span style={{color:C.tx3, fontSize:10, width:10, display:"inline-block"}}>{isExpanded ? "▼" : "▶"}</span>
                        <span style={{color:C.blue,fontWeight:700,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>${p.ticker}</span>
                      </span>
                    </TD>
                    <TD style={{color:C.tx2,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{p.date}</TD>
                    <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.tx}}>
                      {fP(p.dpPrice)}</TD>
                    <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.tx2}}>
                      {fP(p.spotPrice)}</TD>
                    <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:devColor,fontWeight:700}}>
                      {dev>0?"+":""}{dev.toFixed(2)}%</TD>
                    <TD style={{color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
                      {p.volume||"—"}</TD>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} style={{padding:"4px 8px 12px", background:C.bg2}}>
                        <PatternTickerRow
                          it={{ t: p.ticker, cat: undefined }}
                          sig={null}
                          mktcap={mktcapData?.[p.ticker] || 0}
                          noCollapsedRow={true}/>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Options Flow tab ─────────────────────────────────────────────────────────
function OptionsPane({mktcapData = {}}){
  const [expandedKey, setExpandedKey] = useState(null);
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.amber,marginBottom:4}}>
          <UIcon name="star-fill" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Alpha Gold <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.alpha.length} signals)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Highest-conviction options signals from the source feed — top 10 most recent, deduped by ticker.
        </div>
      </div>
      {D.alpha.length === 0 ? (
        <div style={{padding:24,textAlign:"center",color:C.tx3,fontSize:13,
          background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8}}>
          No Alpha Gold signals in this period.
        </div>
      ) : (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr>
                <TH>Date</TH>
                <TH>Ticker</TH>
                <TH>Price</TH>
              </tr>
            </thead>
            <tbody>
              {D.alpha.map((a,i)=>{
                // Each row keyed by date+ticker+i since the same ticker can
                // appear multiple times across dates.
                const key = `${a.ticker}-${a.date}-${i}`;
                const isExpanded = expandedKey === key;
                return (
                  <Fragment key={key}>
                    <tr style={{background:isExpanded?C.bg3:"transparent", cursor:"pointer"}}
                      onClick={()=>setExpandedKey(isExpanded ? null : key)}
                      onMouseEnter={e=>{if(!isExpanded) e.currentTarget.style.background=C.bgH;}}
                      onMouseLeave={e=>{if(!isExpanded) e.currentTarget.style.background="transparent";}}
                      title={isExpanded ? "Click to hide chart" : "Click to show dark pool chart"}>
                      <TD style={{color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{a.date}</TD>
                      <TD>
                        <span style={{display:"inline-flex", alignItems:"center", gap:6}}>
                          <span style={{color:C.tx3, fontSize:10, width:10, display:"inline-block"}}>{isExpanded ? "▼" : "▶"}</span>
                          <span style={{color:C.amber,fontWeight:700,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>${a.ticker}</span>
                        </span>
                      </TD>
                      <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.tx2}}>{fP(a.price)}</TD>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={3} style={{padding:"4px 8px 12px", background:C.bg2}}>
                          <PatternTickerRow
                            it={{ t: a.ticker, cat: undefined }}
                            sig={null}
                            mktcap={mktcapData?.[a.ticker] || 0}
                            noCollapsedRow={true}/>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Signals + Search tab ─────────────────────────────────────────────────────
// ── Search Modal ──────────────────────────────────────────────────────────────
// ── Search Results Table — shows ticker row + top 5 prints expanded ───────────
function SearchResultsTable({items, mktcapData = {}}){
  if(!items||items.length===0) return null;
  // Track which ticker (if any) is expanded to show the dark-pool chart
  const [expandedTicker, setExpandedTicker] = useState(null);
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
            const isExpanded = expandedTicker === it.t;
            return (
              <Fragment key={it.t}>
                {/* Main ticker row — click to toggle the chart view */}
                <tr style={{background: isExpanded ? C.bg3 : C.bgH, cursor:"pointer"}}
                  onClick={() => setExpandedTicker(isExpanded ? null : it.t)}
                  title={isExpanded ? "Click to hide chart" : "Click to show dark pool chart"}>
                  <TD>
                    <span style={{display:"inline-flex", alignItems:"center", gap:6}}>
                      <span style={{color:C.tx3, fontSize:10, width:10, display:"inline-block"}}>{isExpanded ? "▼" : "▶"}</span>
                      <TickerCell it={it} catColor={cc}/>
                    </span>
                  </TD>
                  <TD><CatPill cat={it.cat}/></TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:zC(it.last,it.lo,it.hi)}}>
                    {fP(it.last)}
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.tx2,fontSize:11}}>
                    {fP(it.lo)}<span style={{color:C.tx3,margin:"0 3px"}}>–</span>{fP(it.hi)}
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11}}>
                    <BigPrintCell it={it}/>
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,color:bpMoveColor}}>
                    {bpPct==null?"—":(bpPct>0?"+":"")+bpPct.toFixed(2)+"%"}
                  </TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.cyan,fontWeight:600}}>
                    {fmt(it.n)}
                  </TD>
                  <TD style={{color:C.tx2,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{it.c}</TD>
                  <TD style={{color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{it.days}</TD>
                </tr>
                {/* Expanded view: dark pool chart with overlay bars */}
                {isExpanded && (
                  <tr>
                    <td colSpan={9} style={{padding:"4px 8px 12px", background:C.bg2}}>
                      <PatternTickerRow
                        it={it}
                        sig={null}
                        mktcap={mktcapData?.[it.t] || 0}
                        noCollapsedRow={true}/>
                    </td>
                  </tr>
                )}
                {/* Top 5 individual prints — only when collapsed */}
                {!isExpanded && it.top5 && it.top5.map((row,i)=>(
                  <tr key={it.t+"-print-"+i} style={{background:"transparent"}}>
                    <TD style={{paddingLeft:24,color:C.tx3,fontSize:10,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
                      #{i+1}
                    </TD>
                    <TD colSpan={8} style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:11,
                      color:i===0?C.amber:C.tx2,padding:"4px 8px",
                      borderBottom:i===it.top5.length-1?`1px solid ${C.bdr2}`:"none"}}>
                      {row}
                    </TD>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchModal({onClose, mktcapData = {}}){
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
      justifyContent:"center",paddingTop:40}}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      {/* Backdrop */}
      <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.7)"}}
        onClick={onClose}/>
      {/* Modal — padding stripped from the wrapper and pushed down into the
          inner sections so the header below can stick to the modal's true
          top edge (sticky inside a padded container would stick INSIDE the
          padding, leaving an awkward gap above the header).
          maxWidth bumped from 900 → 1400 because the per-ticker chart now
          has TWO timeframe button rows (PRINTS + CANDLES) plus a left-side
          ticker info bar — at 900px wide the right-side price axis was
          getting clipped off the visible area, forcing users to horizontal-
          scroll inside the modal to see the prices on the chart. 1400 fits
          everything comfortably on standard laptop screens (1440+) and
          still leaves a backdrop margin on smaller screens via 95% width.
          maxHeight: 92vh (was 85) + the outer paddingTop: 40 (was 80) gives
          the chart + legend room to fully render without the user needing
          to scroll inside the modal. Important because the chart intercepts
          wheel events for zoom — if cursor lands on the chart, wheel-scroll
          doesn't bubble up to the modal's scroll container, so users get
          stuck unable to see the legend below. The simplest fix is making
          sure scroll isn't needed in the common case. */}
      <div style={{position:"relative",width:"95%",maxWidth:1400,background:C.bg2,
        border:`1px solid ${C.bdr2}`,borderRadius:10,boxShadow:"0 8px 40px #000000aa",
        maxHeight:"92vh",overflowY:"auto",overflowX:"hidden"}}>
        {/* Sticky header — `position: sticky; top: 0` keeps the title row and
            (more importantly) the close button visible while the user scrolls
            through results. Background matches the modal so scrolled content
            doesn't show through. Border-bottom gives a subtle separation cue
            once the user starts scrolling. */}
        <div style={{position:"sticky",top:0,zIndex:10,background:C.bg2,
          padding:"20px 28px 14px",borderBottom:`1px solid ${C.bdr}`,
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <span style={{fontSize:16,fontWeight:700,color:C.tx}}>Ticker Search</span>
            <span style={{fontSize:10,color:C.tx3}}>Esc, click outside, or × to close</span>
          </div>
          <button onClick={onClose}
            title="Close (or press Esc, or click outside the modal)"
            style={{background:C.bg3,border:`1px solid ${C.bdr2}`,color:C.tx,
              fontSize:18,cursor:"pointer",lineHeight:1,
              width:32,height:32,borderRadius:"50%",
              display:"flex",alignItems:"center",justifyContent:"center",
              transition:"background 0.15s, border-color 0.15s"}}
            onMouseEnter={e=>{ e.currentTarget.style.background=C.amber+"22"; e.currentTarget.style.borderColor=C.amber; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=C.bg3; e.currentTarget.style.borderColor=C.bdr2; }}>
            &times;
          </button>
        </div>
        {/* Body — padding restored here so content has breathing room. */}
        <div style={{padding:"18px 28px 24px"}}>
        {/* Input */}
        <input
          autoFocus
          value={query}
          onChange={e=>setQuery(e.target.value)}
          placeholder="Search any ticker (e.g. NVDA, SPY...)"
          style={{width:"100%",padding:"10px 16px",borderRadius:6,
            border:`1px solid ${C.bdr2}`,background:C.bg3,color:C.tx,fontSize:14,
            fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",outline:"none",
            boxSizing:"border-box",marginBottom:16}}
        />
        {query.length>0 && (
          <div style={{color:C.tx3,fontSize:11,marginBottom:10}}>
            {results.length} result{results.length!==1?"s":""} for "{query.toUpperCase()}"
          </div>
        )}
        {results.length>0 && <SearchResultsTable items={results} mktcapData={mktcapData}/>}
        {query.length>0 && results.length===0 && (
          <div style={{color:C.tx3,fontSize:13}}>No tickers found.</div>
        )}
        {query.length===0 && (
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",color:C.tx3,
              textTransform:"uppercase",marginBottom:10}}>Top 20 by Notional</div>
            <FlowTable items={top5} showZone={true} mktcapData={mktcapData}/>
          </div>
        )}
        </div>{/* /body padding wrapper */}
      </div>
    </div>
  );
}

// ── Records pane (per-ticker biggest-ever dark-pool prints) ───────────────────
// Reads /api/darkpool/records (all-time biggest print per ticker, tracked by the
// records engine). Browse/sort/search + filter by market-cap band. Market caps
// come from the shared mktcapData store (flow-DB-backed /api/schwab/mktcap-batch,
// the same source the other panels use); we fetch caps for the loaded records so
// the cap bands classify end-to-end.
const _RECORDS_LIMIT = 750;   // leaderboard depth we cap-classify + browse
// Tight left-packed table (no edge-to-edge space-between gulf): rank · ticker ·
// mkt cap · record(bar) · price · date.
const _RECORDS_GRID = "30px 150px 92px 176px 92px 88px";
const _RECORDS_GRID_W = 760;
const _CAP_BANDS = [
  {id:"All",   label:"All",       color:C.amber},
  {id:"Mega",  label:"Mega ≥$200B",color:C.pink},
  {id:"Large", label:"Large ≥$10B",color:C.purple},
  {id:"Mid",   label:"Mid ≥$2B",   color:C.amber},
  {id:"Small", label:"Small <$2B", color:C.red},
  {id:"ETF",   label:"ETF / Index",color:C.blue},
];
function capBandOf(t, mc, etfSet){
  if(etfSet.has(t)) return "ETF";
  if(!mc || mc<=0) return null;          // cap unknown — only under "All"
  if(mc>=200e9) return "Mega";
  if(mc>=10e9)  return "Large";
  if(mc>=2e9)   return "Mid";
  return "Small";
}
function RecordsPane({mktcapData={}, fetchMktCap}){
  const [rows,setRows]=useState(null);
  const [err,setErr]=useState(null);
  const [q,setQ]=useState("");
  const [sortKey,setSortKey]=useState("notional");
  const [sortDir,setSortDir]=useState("desc");
  const [limit,setLimit]=useState(100);
  const [cap,setCap]=useState("All");

  useEffect(()=>{
    let alive=true;
    fetch(`/api/darkpool/records?limit=${_RECORDS_LIMIT}&sort=notional`)
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(d=>{ if(alive) setRows(d.records||[]); })
      .catch(e=>{ if(alive) setErr(e.message); });
    return ()=>{ alive=false; };
  },[]);

  // Pull market caps for the loaded record tickers into the shared store
  // (fetchMktCap dedups against what the page already fetched for aggregated data).
  useEffect(()=>{
    if(!rows || !fetchMktCap) return;
    const want=rows.map(r=>r.ticker).filter(Boolean);
    if(want.length) fetchMktCap(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[rows]);

  // Union of every hardcoded ETF/index list (+ broad-market/factor funds) — the
  // authoritative-enough client-side "is this a fund" signal (an ETF's reported
  // market cap is its AUM, so it would otherwise mis-band as Mega/Large).
  const etfSet=useMemo(()=>new Set([
    ...INDEXES,...SECTOR_ETFS,...BOND_ETFS,...INTL_EM_ETFS,...COMMODITY_ETFS,...BROAD_ETFS
  ]),[]);

  function toggleSort(key){
    if(sortKey===key) setSortDir(d=>d==="desc"?"asc":"desc");
    else { setSortKey(key); setSortDir(key==="ticker"?"asc":"desc"); }
  }

  // Band counts (over the whole loaded set, ignoring search) for the pill labels.
  const bandCounts=useMemo(()=>{
    const c={All:0,Mega:0,Large:0,Mid:0,Small:0,ETF:0};
    if(rows) for(const r of rows){ c.All++; const b=capBandOf(r.ticker,mktcapData[r.ticker],etfSet); if(b) c[b]++; }
    return c;
  },[rows,mktcapData,etfSet]);

  const view=useMemo(()=>{
    if(!rows) return [];
    const needle=q.trim().toUpperCase();
    let items=needle?rows.filter(r=>(r.ticker||"").includes(needle)):rows;
    if(cap!=="All") items=items.filter(r=>capBandOf(r.ticker,mktcapData[r.ticker],etfSet)===cap);
    const acc={ notional:x=>x.notional||0, price:x=>x.price||0, ticker:x=>x.ticker||"",
      mktcap:x=>mktcapData[x.ticker]||0,
      date:x=>{ const p=(x.date||"").split("/"); return p.length===3?`${p[2]}${p[0]}${p[1]}`:""; } };
    const fn=acc[sortKey]||(x=>x[sortKey]);
    items=[...items].sort((a,b)=>{
      const va=fn(a),vb=fn(b);
      if(typeof va==="string") return sortDir==="asc"?va.localeCompare(vb):vb.localeCompare(va);
      return sortDir==="asc"?va-vb:vb-va;
    });
    return items;
  },[rows,q,cap,sortKey,sortDir,mktcapData,etfSet]);

  const shown=view.slice(0,limit);
  const maxN=Math.max(1,...shown.map(r=>r.notional||0));

  const gh=(key,label,align="right")=>{
    const active=sortKey===key;
    const arrow=active?(sortDir==="asc"?" ▲":" ▼"):"";
    return (
      <span onClick={()=>toggleSort(key)}
        style={{fontSize:9,color:active?C.blue:C.tx3,fontWeight:600,textAlign:align,
          cursor:"pointer",userSelect:"none",transition:"color 0.15s"}}>{label}{arrow}</span>
    );
  };

  if(err) return <div style={{fontSize:13,color:C.red,padding:16}}>Failed to load records: {err}</div>;
  if(!rows) return <div style={{fontSize:13,color:C.tx3,padding:16}}>Loading records…</div>;

  return (
    <div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:C.amber,marginBottom:2}}>All-Time Dark Pool Records</div>
        <div style={{fontSize:12,color:C.tx2}}>
          The single biggest dark-pool print on record for each ticker · top <span style={{color:C.cyan,fontWeight:700}}>{rows.length.toLocaleString()}</span> by size
        </div>
      </div>

      {/* Controls: search + market-cap band filter */}
      <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",marginBottom:12}}>
        <input value={q} onChange={e=>{setQ(e.target.value);setLimit(100);}}
          placeholder="Search ticker…"
          style={{flex:"0 0 240px",padding:"7px 12px",
            background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,color:C.tx,
            fontSize:12,fontFamily:"inherit",outline:"none"}}/>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
          {_CAP_BANDS.map(b=>{
            const on=cap===b.id;
            const n=bandCounts[b.id];
            return (
              <button key={b.id} onClick={()=>{setCap(b.id);setLimit(100);}}
                title={`${b.label}${b.id!=="All"?` · ${n} names`:""}`}
                style={{padding:"5px 12px",borderRadius:20,cursor:"pointer",fontFamily:"inherit",
                  border:`1px solid ${b.color}${on?"":"33"}`,
                  background:on?b.color+"22":"transparent",color:on?b.color:C.tx2,
                  fontWeight:on?700:500,fontSize:11,transition:"all 0.15s"}}>
                {b.label}{b.id!=="All" && <span style={{opacity:0.6,marginLeft:5}}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"14px 18px",maxWidth:_RECORDS_GRID_W}}>
        {/* Column headers */}
        <div style={{display:"grid",gridTemplateColumns:_RECORDS_GRID,columnGap:18,alignItems:"center",
          padding:"0 0 5px 0",borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
          <span style={{fontSize:9,color:C.tx3,fontWeight:600,textAlign:"center"}}>#</span>
          {gh("ticker","Ticker","left")}
          {gh("mktcap","Mkt Cap")}
          {gh("notional","Record")}
          {gh("price","Price")}
          {gh("date","Date")}
        </div>

        {/* Rows */}
        {shown.map((r,i)=>{
          const mc=mktcapData[r.ticker]||0;
          const band=capBandOf(r.ticker,mc,etfSet);
          const bandColor=(_CAP_BANDS.find(b=>b.id===band)||{}).color||C.tx3;
          return (
          <div key={r.ticker}
            style={{display:"grid",gridTemplateColumns:_RECORDS_GRID,columnGap:18,alignItems:"center",
              padding:"6px 0",borderBottom:`1px solid ${C.bdr}22`}}>
            <span style={{fontSize:10,color:C.tx3,textAlign:"center",fontWeight:600}}>{i+1}</span>
            <span style={{display:"flex",gap:6,alignItems:"center",minWidth:0}}>
              <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                fontWeight:700,fontSize:12,color:C.amber}}>{r.ticker}</span>
              {band && <span style={{fontSize:8,fontWeight:700,color:bandColor,opacity:0.85,
                border:`1px solid ${bandColor}44`,borderRadius:3,padding:"0 4px"}}>{band}</span>}
            </span>
            <span style={{fontSize:10,color:C.tx3,textAlign:"right"}}>{mc>0?fmt(mc).replace("$",""):"—"}</span>
            <span style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
              <span style={{fontSize:12,color:C.cyan,fontWeight:700}}>{fmt(r.notional)}</span>
              <span style={{width:"100%",height:3,background:C.bdr,borderRadius:2,overflow:"hidden"}}>
                <span style={{display:"block",height:"100%",borderRadius:2,background:C.cyan,
                  width:`${Math.max(4,Math.round((r.notional||0)/maxN*100))}%`}}/>
              </span>
            </span>
            <span style={{fontSize:11,color:C.tx,fontWeight:600,textAlign:"right"}}>{fP(r.price)}</span>
            <span style={{fontSize:10,color:C.tx3,textAlign:"right"}}>{r.date||"—"}</span>
          </div>
          );
        })}
        {shown.length===0 && <div style={{fontSize:12,color:C.tx3,padding:8}}>No records match this filter.</div>}
        {view.length>shown.length && (
          <div style={{textAlign:"center",paddingTop:10}}>
            <button onClick={()=>setLimit(l=>l+100)}
              style={{padding:"6px 16px",background:C.bg3,border:`1px solid ${C.bdr2}`,borderRadius:6,
                color:C.tx2,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              Show more ({view.length-shown.length} more)
            </button>
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
  {id:"records",label:"★ Records"},
];

// ── CSV Processing Engine ─────────────────────────────────────────────────────

const INDEXES = new Set(["SPY","QQQ","IWM","DIA","MDY","RSP","OEF","ONEQ","TQQQ","SQQQ","SPXU","SPXS","UPRO","SH","PSQ","QID","UVXY","VXX","VIXY","SVXY","SOXS","SOXL","TNA","TZA","UDOW","SDOW","SPXL","ERX","ERY"]);

const SECTOR_ETFS = new Set(["XLF","XLE","XLK","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GDX","GDXJ","KRE","KBE","XOP","OIH","XBI","IBB","ARKG","ARKK","ARKW","ARKQ","ARKF","ARKVV","SMH","SOXX","HACK","CIBR","FINX","CLOU","BOTZ","ROBO","WCLD","BUG","SKYY","AIQ","KBWB","KIE","IAI","IYF","PNQI","FDN","IPAY","EMQQ","KOMP","LOUP","DTEC","JETS","AIRR","MOO","SOIL","CROP","WEED","MSOS","POTX","MJ","BITO","BLOK","BITQ","IBIT","FBTC","GBTC","HODL","BTCO","EZBC","BTCW","DEFI","XME","PICK","SLX","REMX","LIT","BATT","DRIV","IDRV","KARS","VNQ","SCHH","ICF","REM","MORT","HOMZ","XHB","ITB","PKB","REZ","PHO","CGW","FIW","FWAT","RXL","BBH","PJP","XPH","SBIO","LABD","LABU","TAN","FAN","ICLN","QCLN","ACES","PBD","SMOG","IAT","KBWR","DPST","FAS","FAZ","SKF","UYG","CURE","RXD","MTUM","VLUE","QUAL","USMV","SIZE","IWF","IWD","IWB","IWR","IWS","VTV","VUG","VO","VB","VBR","VBK","MGC","MGK","MGV","ESGU","ESGD","ESGE","DSI","SDGA"]);

const BOND_ETFS = new Set(["TLT","IEF","SHY","IEI","SHV","GOVT","TBT","TMF","TBF","TTT","UBT","PST","AGG","BND","SCHZ","IUSB","SPAB","BOND","LQD","VCIT","IGIB","SPSB","VCSH","IGSB","FLOT","SJNK","BSCN","BSCO","HYG","JNK","FALN","PHB","HYLB","USHY","SHYG","HYEM","BSJN","BSJO","BSJP","EMB","VWOB","PCY","LEMB","ELD","EBND","MUB","TFI","CMF","ITM","PZA","VTEB","MUNI","SUB","HYD","SHYD","TIP","SCHP","STIP","VTIP","RINF","WIP","BWX","BNDX","IGOV","ISHG","PICB","BIL","GBIL","SGOV","CLTL","VGSH","SCHO","FTSM","LQDH","HYGH","IGBH","TOTB","BNDW","PFFD","FPE","IPFF","PFF","PRFD","MINT","NEAR","ICSH","GSY","JPST","PULS","FLRN"]);

const INTL_EM_ETFS = new Set(["EEM","EFA","VEA","VWO","IEMG","ACWI","ACWX","VXUS","VT","FXI","ASHR","MCHI","KWEB","CQQQ","CHIQ","HAO","GXC","KURE","PGJ","EWJ","DBJP","HEWJ","DXJ","EWZ","EWW","EWC","EWY","EWG","EWH","EWT","EWS","EWU","EWA","EWI","EWP","EWQ","EWD","EWN","EWK","EWL","EWO","EIS","INDA","INDY","PIN","EPI","SMIN","VGK","IEV","FEZ","HEDJ","EZU","EURL","RSX","ERUS","RUSL","RUSS","ENZL","EWM","ECH","EPHE","EIDO","TUR","EPOL","ARGT","EZA","AFK","FM","GAF","EMXC","XSOE","DFAE","DFEM","AVEM","GEM","GMF","SPEM","HEFA","DBEF","DEEF","HEEM"]);

const COMMODITY_ETFS = new Set(["GLD","IAU","GLDM","BAR","SGOL","PHYS","AAAU","BGLD","SLV","SIVR","PSLV","DSLV","USLV","USO","UCO","SCO","DBO","OIL","OILU","OILD","UNG","BOIL","KOLD","GAZ","FCG","PDBC","DJP","USCI","COMB","COM","GSG","DBC","RJI","MLPA","DBA","WEAT","CORN","SOYB","CANE","NIB","JO","BAL","COW","TAGS","CPER","COPX","CULL","PALL","PPLT","GLTR","WOOD","NLR","URA","URNM","HURA","LNG","MLPX","AMLP","AMJ","AMJB","ENFR","TPVG","MLPQ"]);

// Broad-market / factor / allocation funds NOT in the sets above — they carry
// huge notional (their "market cap" is AUM) so without this they mis-band as
// Mega/Large. Used only by the Records cap-band classifier.
const BROAD_ETFS = new Set(["IVV","VOO","VTI","SPLG","SPTM","SPYM","ITOT","SCHB","SCHX","SCHG","SCHD","SCHV","SCHA","SCHM","VV","VUG","VTV","MGC","MGK","MGV","VONE","VONG","VONV","VTHR","IWB","IWF","IWD","IWR","IWS","IWP","IWN","IWO","IJH","IJR","IJK","IJJ","IJS","IJT","VO","VOE","VOT","VB","VBK","VBR","IUSB","IUSG","IUSV","IUSC","EFV","EFG","IEFA","IEMG","VEA","VWO","VXUS","VT","ACWI","BND","BNDX","VCIT","VCSH","VGSH","VGIT","VGLT","VTEB","MUB","QUAL","MTUM","USMV","VLUE","SIZE","VIG","VYM","DGRO","SDY","NOBL","DVY","HDV","SPHD","SPYG","SPYV","SPYD","VOOG","VOOV","IVW","IVE","OEF","RSP","QQQM","QQEW","NDX","DGRW","SCHH","VNQ","USRT","FNDX","FNDA","FNDF","DFAC","DFAU","DFAX","DFAI","DFAE","AVUV","AVUS","AVDE","AVEM","CALF","MOAT","COWZ","JEPI","JEPQ","DIVO","SCHF","SCHE","SCHC","GSLC","SUSA","ESGU","ESGV","VSGX"]);

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

// The feed's SecurityType column is the only reliable ETF-vs-stock tell we get.
// The curated ETF sets above are hand-maintained and always trail the tape (SCMB,
// FLJP et al. were never in them), and sector/industry can NOT stand in — real
// equities like CCL and FER ship with a blank sector, so a blank-sector rule
// would quietly drop actual stocks. Anything the provider calls a fund is a fund.
const FUND_SECURITY_TYPES = new Set([
  "etf", "etf/fund", "fund", "open-end mutual fund",
  "closed-end fund", "structured products", "unit investment trust",
]);
// Older cached aggregations predate the securityType field. Missing ⇒ unknown ⇒
// treat as NOT a fund, so a stale payload degrades to the previous behaviour
// rather than blanking a section.
function isFundSecurity(it){
  const st = ((it && it.securityType) || "").trim().toLowerCase();
  return st ? FUND_SECURITY_TYPES.has(st) : false;
}

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
      const securityType = (r.SecurityType||"").trim();
      tradeRows.push({ticker:tk, dateKey:fmtDateKey(d), price, notional, message:msg, avg30, pctAvgVol, industry, sector, securityType});
    }catch(e){}
  }

  // Aggregate per ticker
  const tickerTrades={};  // tk → [{price,notional,dateKey}]
  const tickerDaily={};   // tk → {dateKey → {notional,volNotional,count}}
  const tickerAvg30={};  // tk → avg 30-day volume (last seen value)
  const tickerIndustry={};// tk → industry (most common)
  const tickerSector={};  // tk → sector (most common)
  const tickerSecType={}; // tk → SecurityType (first seen)

  for(const tr of tradeRows){
    const {ticker:tk,dateKey:dk,price:p,notional:n,avg30,pctAvgVol,industry,sector,securityType}=tr;
    if(!tickerTrades[tk]) tickerTrades[tk]=[];
    tickerTrades[tk].push({p,n,dk,pctAvgVol});
    if(avg30>0) tickerAvg30[tk]=avg30;
    if(industry && !tickerIndustry[tk]) tickerIndustry[tk]=industry;
    if(sector && !tickerSector[tk]) tickerSector[tk]=sector;
    if(securityType && !tickerSecType[tk]) tickerSecType[tk]=securityType;
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
    const securityType=tickerSecType[tk]||"";
    // Accumulation vs Distribution: big print above VWAP = Acc, below = Dist
    const accDist = bigPrint!=null && vwap>0 ? (bigPrint>=vwap?"Acc":"Dist") : null;
    itemsAll.push({t:tk,cat,n:Math.round(totalN),lo,hi,last,vwap,c:trades.length,days,pos,pct,u:uoaTickers.has(tk),prices:pricesArr,w:wArr,top5,bigPrint,bigPrintN,bigPrintDk,bigPrintDate,bigPrintPctAvgVol,avg30,industry,sector,securityType,accDist,mktcap:0,signals:[]});
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
// ── Live "Today" strip (intraday preview) ────────────────────────────────────
// Reads /api/darkpool/today — the ephemeral preview populated by the intraday
// poller (darkpool_intraday_ingest) every few minutes. Renders NOTHING until
// there's data (pre-open, or the poller is disabled), so the historical page is
// unchanged otherwise. Independent of the main dpData load: its own 60s poll,
// paused while the tab is hidden.
function DarkPoolTodayStrip(){
  const [data,setData]=useState(null);
  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      if(typeof document!=="undefined" && document.visibilityState==="hidden") return;
      try{
        const r=await fetch("/api/darkpool/today");
        if(!r.ok) return;
        const j=await r.json();
        if(!cancelled) setData(j);
      }catch{ /* transient — keep last good */ }
    };
    load();
    const id=setInterval(load,60000);
    const onVis=()=>{ if(document.visibilityState==="visible") load(); };
    document.addEventListener("visibilitychange",onVis);
    return ()=>{ cancelled=true; clearInterval(id); document.removeEventListener("visibilitychange",onVis); };
  },[]);

  const stats=data?.stats;
  const items=data?.payload?.allItems||[];
  if(!stats || !stats.total_rows) return null;  // nothing live yet → render nothing

  const top=[...items].filter(i=>i.bigPrintN>0)
    .sort((a,b)=>b.bigPrintN-a.bigPrintN).slice(0,8);

  return (
    <div style={{maxWidth:1400,margin:"0 auto",padding:"10px 20px 0"}}>
      <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,
        borderLeft:`3px solid ${C.green}`,borderRadius:6,padding:"9px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:C.green,
            boxShadow:`0 0 6px ${C.green}`,display:"inline-block",flexShrink:0}}/>
          <span style={{fontSize:12,fontWeight:800,color:C.tx,letterSpacing:"0.04em"}}>
            LIVE · TODAY SO FAR
          </span>
          <span style={{fontSize:11,color:C.tx3}}>
            {stats.date?`${stats.date} · `:""}
            {(stats.total_rows||0).toLocaleString()} prints
            {" · "}<span style={{color:C.cyan}}>{fmt(stats.total_notional||0)} premium</span>
            {" · "}{(stats.tickers||0).toLocaleString()} tickers
            {stats.last_timestamp?` · last ${stats.last_timestamp}`:""}
          </span>
          <span style={{fontSize:10,color:C.tx3,marginLeft:"auto"}}
            title="Intraday preview, refreshed every few minutes. The authoritative session is folded in after the close.">
            preview · updates every ~3 min
          </span>
        </div>
        {top.length>0 && (
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
            {top.map(it=>(
              <span key={it.t} style={{display:"inline-flex",alignItems:"baseline",gap:5,
                background:C.bg,border:`1px solid ${C.bdr}`,borderRadius:5,
                padding:"3px 8px",fontSize:11}}>
                <span style={{fontWeight:800,color:CAT_COLORS[it.cat]||C.tx}}>{it.t}</span>
                <span style={{color:C.cyan,fontWeight:600}}>{fmt(it.bigPrintN)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DarkPool({embedded}){
  const [dpData,setDpData]=useState(null);
  const [loadErr,setLoadErr]=useState(null);
  const [loadStatus,setLoadStatus]=useState("Loading…");
  const [parsedRows,setParsedRows]=useState(null);

  // Date picker state (matches OptionsFlow pattern)
  const [dateFilter,setDateFilter]=useState("Last90");
  const [fetchDays,setFetchDays]=useState(90);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [showCal,setShowCal]=useState(false);
  const [calMonth,setCalMonth]=useState(new Date().getMonth());
  const [calYear,setCalYear]=useState(new Date().getFullYear());
  const [calStart,setCalStart]=useState(null);
  const calRef=useRef(null);
  const [csvLoading,setCsvLoading]=useState(true);

  const csvFile = fetchDays === 0
    ? "/api/darkpool/data?all_data=true"
    : `/api/darkpool/data?days=${fetchDays}`;

  // Available trading dates — sourced from the aggregated response's `dates`
  // field (ISO yyyy-mm-dd, sorted oldest → newest). The legacy code derived
  // these from parsedRows, but we no longer load raw rows. We convert ISO
  // back to M/D/YYYY here to keep the rest of the date-picker UI unchanged.
  const availableDates = useMemo(() => {
    if (!dpData || !Array.isArray(dpData.dates)) return [];
    return dpData.dates.map(iso => {
      const [y, m, d] = iso.split("-");
      if (!y || !m || !d) return iso;
      return `${parseInt(m,10)}/${parseInt(d,10)}/${y}`;
    });
  }, [dpData]);

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
  }, [parsedRows, dateFilter, dateFrom, dateTo]);

  // ── Fetch aggregated dark pool data ─────────────────────────────────────
  // Switched from the raw CSV endpoint (/api/darkpool/data) to the
  // pre-aggregated JSON endpoint (/api/darkpool/aggregated). 90d of raw CSV
  // is ~2.25M rows / ~270MB decompressed — large enough to OOM Chrome on a
  // typical 4GB tab heap. The aggregated endpoint returns the same dpData
  // shape that parseCSVtoD used to produce client-side (categories, above,
  // below, unusual, phantom, options, alpha, themes, allItems, meta, dates)
  // — pre-computed server-side, file-cached on /data, sub-second after first
  // hit. The backend's own comment confirms this contract.
  //
  // Falls back to the legacy CSV path only if /aggregated 404s (older backend
  // builds). Static CSV fallback removed — it was only a backup for the API
  // being down, and a stale static file is worse than a clean error.
  const prewarmedRef = useRef(false);  // page-mount pre-warm only fires once
  useEffect(() => {
    let cancelled = false;
    let retryTimer;
    setCsvLoading(true);
    setLoadErr(null);
    // More informative copy than "Fetching aggregated data…" — the first
    // load on a cold cache really does take 5-15s (backend builds the
    // aggregation across millions of rows), so set expectations.
    setLoadStatus(`Loading ${fetchDays === 0 ? "all" : fetchDays} day window…`);
    const loadStart = performance.now();
    // Switch to a long-load hint after 4s so the user knows we haven't hung.
    const slowHintTimer = setTimeout(() => {
      if (!cancelled) setLoadStatus("Building aggregation… first load is slow, subsequent are instant");
    }, 4000);

    const aggBase = fetchDays === 0
      ? "/api/darkpool/aggregated?all_data=true"
      : `/api/darkpool/aggregated?days=${fetchDays}`;

    // The endpoint is NON-BLOCKING: a cold window returns {status:"computing"}
    // immediately (the heavy build runs server-side in the background, so no more
    // 100s/524 hang) — we poll until the real payload lands. A fresh _t per
    // attempt busts the CF/browser cache so a stale "computing" is never reused.
    const attempt = () => {
      fetch(aggBase + "&_t=" + Date.now())
        .then(r => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(data => {
          if (cancelled) return;
          if (data && data.status === "computing") {
            setLoadStatus("Building aggregation… first load is slow, subsequent are instant");
            retryTimer = setTimeout(attempt, 3000);
            return;
          }
          clearTimeout(slowHintTimer);
          // Validate shape — aggregated response must have allItems + categories.
          // Backend returns an _empty_result() shell (all arrays empty) when the
          // DB has no data; we treat that as "no data" and fall back if possible.
          const hasData = data && Array.isArray(data.allItems) && data.allItems.length > 0;
          if (!hasData) {
            if (fetchDays > 1) {
              // Auto-fallback to 1d so the page still renders something useful.
              // The state change re-runs this effect with the new URL.
              setLoadStatus("No data for this range — loading 1d…");
              setDateFilter("Last1");
              setFetchDays(1);
              return;
            }
            throw new Error("No data returned");
          }
          // Aggregated response IS the dpData shape — use directly, skip
          // parseCSVtoD entirely. Also keep parsedRows null so the in-memory
          // date-filter effect below stays a no-op.
          setDpData(data);
          setParsedRows(null);
          setCsvLoading(false);
          const elapsed = Math.round(performance.now() - loadStart);
          console.log(`[DarkPool] window=${fetchDays} loaded in ${elapsed}ms`);

          // Background pre-warm: after the primary load succeeds, fire off a
          // /prebuild on the backend so every other date window (1d / 5d /
          // 20d / 60d / 90d / all) gets cached. The backend has a lock so
          // concurrent requests are idempotent; this is harmless if it's
          // already warm. Once per page session — toggling date ranges later
          // shouldn't keep re-warming.
          if (!prewarmedRef.current) {
            prewarmedRef.current = true;
            // Fire-and-forget. Tiny delay so it doesn't fight the mktcap
            // batch requests for backend CPU.
            setTimeout(() => {
              fetch("/api/darkpool/prebuild", { method: "POST" })
                .then(() => console.log("[DarkPool] background prewarm kicked off"))
                .catch(() => { /* silent — best effort */ });
            }, 500);
          }
        })
        .catch(e => {
          if (cancelled) return;
          clearTimeout(slowHintTimer);
          setLoadErr(e?.message || "Could not load aggregated data");
          setCsvLoading(false);
        });
    };
    attempt();

    return () => { cancelled = true; clearTimeout(slowHintTimer); clearTimeout(retryTimer); };
  }, [fetchDays]);




  const [tab,setTab]=useState("overview");
  const [catJump,setCatJump]=useState(null);
  const [showSearch,setShowSearch]=useState(false);
  const [globalCat,setGlobalCat]=useState("All");
  const [mktcapData,setMktcapData]=useState({}); // {AAPL: 2940000000000, ...}
  const [mktcapLoading,setMktcapLoading]=useState(false);

  // Tickers we've already attempted to fetch this session — kept in a ref
  // (not state) so updating it doesn't trigger renders. Stops repeat
  // fetches when the user toggles date ranges back and forth and dpData
  // re-loads with overlapping ticker sets.
  const mktcapAttemptedRef = useRef(new Set());

  // Batched market-cap fetch — splits into chunks of 50 (backend's cap on
  // /api/schwab/mktcap-batch) and runs them in parallel. Each response is
  // merged into the central mktcapData store so every consumer (Notable
  // Activity, Biggest Prints, FlowTable, PatternTickerRow header) sees
  // the value immediately.
  async function fetchMktCap(tickers) {
    if (!tickers || tickers.length === 0) return;
    setMktcapLoading(true);
    try {
      const base = typeof API_BASE !== "undefined" ? API_BASE : "";
      // Mark attempted up front so the auto-fetch effect doesn't re-queue
      // these symbols while requests are still in flight.
      tickers.forEach(t => mktcapAttemptedRef.current.add(t));
      // Chunk by 50 (matches schwab_router's per-request cap)
      const batches = [];
      for (let i = 0; i < tickers.length; i += 50) {
        batches.push(tickers.slice(i, i + 50));
      }
      const responses = await Promise.all(
        batches.map(batch =>
          fetch(`${base}/api/schwab/mktcap-batch?symbols=${batch.join(",")}`)
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
        )
      );
      const merged = {};
      for (const data of responses) {
        if (data?.mktcap) Object.assign(merged, data.mktcap);
      }
      if (Object.keys(merged).length > 0) {
        setMktcapData(prev => ({ ...prev, ...merged }));
      }
    } catch (e) {
      console.warn("[DarkPool] mktcap fetch failed:", e);
    }
    setMktcapLoading(false);
  }

  // Auto-fetch market caps for every ticker in the current dpData payload
  // the moment it loads. Was previously gated behind a manual "Fetch Mkt
  // Cap" button on Overview — easy to miss, and broke the Notable Activity
  // / Biggest Prints panels which assumed the data would be there.
  // Skip tickers we already have or have already requested.
  useEffect(() => {
    if (!dpData || !Array.isArray(dpData.allItems)) return;
    const wanted = dpData.allItems
      .map(i => i.t)
      .filter(t => t && !mktcapAttemptedRef.current.has(t) && !mktcapData[t]);
    if (wanted.length > 0) {
      fetchMktCap(wanted);
    }
    // mktcapData intentionally omitted from deps — the ref handles
    // dedup, and listing it here would cause infinite re-fetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpData]);


  // Global category filter helper
  const ETF_CATS_SET=new Set(["Sector ETFs","Bond ETFs","Intl/EM ETFs","Commodity ETFs"]);
  const filterByCat=(items)=>{
    if(globalCat==="All") return items;
    if(globalCat==="ETFs") return items.filter(i=>ETF_CATS_SET.has(i.cat));
    return items.filter(i=>i.cat===globalCat);
  };

  function handleJumpTo(name){
    setCatJump(name);
    setTab("category");
  }

  if(loadErr) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:embedded?"40vh":"60vh",background:embedded?"transparent":C.bg,color:C.red,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
      flexDirection:"column",gap:12,padding:20}}>
      <div style={{fontSize:20,fontWeight:700}}><UIcon name="warning" size={20} style={{ verticalAlign: '-3px', marginRight: 6 }} />Failed to load data</div>
      <div style={{fontSize:13,color:C.tx2}}>Attempted: <code style={{color:C.blue}}>{fetchDays === 0 ? "/api/darkpool/aggregated?all_data=true" : `/api/darkpool/aggregated?days=${fetchDays}`}</code></div>
      <div style={{fontSize:12,color:C.red,background:C.bg2,border:`1px solid ${C.red}44`,
        borderRadius:8,padding:"8px 16px",maxWidth:480,textAlign:"center"}}>
        {loadErr}
      </div>
      <div style={{fontSize:11,color:C.tx3}}>Check that darkpool_router is mounted and DB has data.</div>
    </div>
  );

  if(!dpData) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:embedded?"40vh":"100vh",background:embedded?"transparent":C.bg,color:C.blue,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
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
      fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:13}}>
      {!embedded && <style>{`
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.bdr2};border-radius:3px}
        input:focus{border-color:${C.amber} !important}
      `}</style>}

      {/* Intraday live preview — renders null until the poller has today's data */}
      {!embedded && <DarkPoolTodayStrip/>}

      {/* Header */}
      <div style={{background:C.bg2,borderBottom:`1px solid ${C.bdr}`,padding:"12px 20px"}}>
        <div style={{maxWidth:1400,margin:"0 auto"}}>
        {/* Title row */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:C.green,
            boxShadow:`0 0 6px ${C.green}`,display:"inline-block",flexShrink:0}}/>
          <span style={{fontSize:18,fontWeight:800,color:C.tx,letterSpacing:"0.02em",
            fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>DARK POOL SCANNER</span>
          {/* Date range — moved to the front of the meta line so the user
              knows immediately what window the rest of the page reflects.
              The bullet-separated metrics below remain for context. */}
          {D.meta?.dateRange && (
            <span style={{fontSize:11,fontWeight:600,color:C.amber,
              fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
              marginLeft:4}}>
              {D.meta.dateRange}
            </span>
          )}
          <span style={{fontSize:11,color:C.tx3}}>
            · {D.meta?.tradingDays??""} trading {(D.meta?.tradingDays??0) === 1 ? "day" : "days"}
            · {(D.meta?.totalTrades??0).toLocaleString()} block trades
            · {(D.meta?.totalTickers??0).toLocaleString()} tickers
            ·{" "}
            <span style={{color:C.cyan}} title="Total dark pool $ notional across all tickers in this window">
              {D.meta?.totalNotional?(D.meta.totalNotional>=1e12?`$${(D.meta.totalNotional/1e12).toFixed(2)}T`:`$${(D.meta.totalNotional/1e9).toFixed(0)}B`):"$0"} premium
            </span>
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
                  fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",lineHeight:1}}>{fP(item.last)}</div>
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
              fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",lineHeight:1}}>{D.meta?.tradingDays??""} <span style={{fontSize:12}}>days</span></div>
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
              // Was an optimization: skip the refetch when the new range fit
              // inside the already-loaded parsedRows (in-memory date filter).
              // That code path is gone — we now fetch a pre-aggregated payload
              // per window, so every button click MUST trigger a refetch to
              // get the right aggregation. The fetch effect dedups on
              // [fetchDays] so re-clicking the same button is still a no-op.
              return (
                <button key={key} onClick={()=>{
                  setFetchDays(days);
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
                : <><UIcon name="calendar" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />Dates</>}
            </button>
            {dateFrom && dateTo && (
              <button onClick={()=>{ setDateFrom(""); setDateTo(""); setDateFilter("Last1"); setShowCal(false); setCalStart(null); }}
                style={{ background:"transparent", border:"none", color:C.tx3, cursor:"pointer", fontSize:12, fontFamily:"inherit", padding:"2px 4px" }}><UIcon name="x" size={12} /></button>
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

      {/* Global Category Filter — hidden on Records (it has its own cap-band
          filter with real market caps, so two rows would double up). */}
      {tab!=="records" && (
      <div style={{display:"flex",justifyContent:"center",padding:"8px 20px",background:C.bg2,borderBottom:`1px solid ${C.bdr}`}}>
        <div style={{display:"flex",gap:4,alignItems:"center",background:C.bg3,borderRadius:6,padding:3,border:`1px solid ${C.bdr}`}}>
          {[
            {id:"All",label:"All"},
            {id:"Indexes",label:"Indexes"},
            {id:"ETFs",label:"ETFs"},
            {id:"Large Cap",label:"Large Cap"},
            {id:"Mid Cap",label:"Mid Cap"},
            {id:"Small Cap",label:"Small Cap"},
          ].map(f=>{
            const on=globalCat===f.id;
            return (
              <button key={f.id} onClick={()=>setGlobalCat(f.id)} style={{
                padding:"5px 14px",borderRadius:4,border:"none",cursor:"pointer",
                fontSize:10,fontWeight:on?700:500,fontFamily:"inherit",
                background:on?C.bg2:"transparent",
                color:on?(f.id==="All"?C.amber:C.tx):C.tx3,
                transition:"all 0.15s"
              }}>{f.label}</button>
            );
          })}
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
                fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
              {t.label}
            </button>
          );
        })}
        {/* Search button */}
        <button onClick={()=>setShowSearch(true)}
          style={{marginLeft:"auto",padding:"6px 14px",background:C.blue+"22",
            border:`1px solid ${C.blue}55`,borderRadius:6,color:C.blue,
            fontWeight:600,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",
            fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",transition:"all 0.15s",
            flexShrink:0}}>
          <UIcon name="search" size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Search
        </button>
        </div>
      </div>

      {/* Content */}
      <div style={{padding:"14px 20px",maxWidth:1400,margin:"0 auto"}}>
        {tab==="overview" && <OverviewPane onJumpTo={handleJumpTo} filterByCat={filterByCat} mktcapData={mktcapData} fetchMktCap={fetchMktCap} mktcapLoading={mktcapLoading}/>}
        {tab==="category" && <CategoryPaneWrapper jump={catJump} onJumpDone={()=>setCatJump(null)} mktcapData={mktcapData}/>}
        {tab==="above"    && <AbovePane filterByCat={filterByCat} mktcapData={mktcapData}/>}
        {tab==="below"    && <BelowPane filterByCat={filterByCat} mktcapData={mktcapData}/>}
        {tab==="records"  && <RecordsPane mktcapData={mktcapData} fetchMktCap={fetchMktCap}/>}
      </div>

      {showSearch && <SearchModal onClose={()=>setShowSearch(false)} mktcapData={mktcapData}/>}
    </div>
  );
}

// Wrapper to handle jump-to-category
function CategoryPaneWrapper({jump,onJumpDone,mktcapData}){
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
      <FlowTable items={cat.items} showCat={false} mktcapData={mktcapData}/>
    </div>
  );
}
