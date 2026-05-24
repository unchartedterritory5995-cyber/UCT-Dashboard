import { useState, useMemo, useRef, useEffect } from "react";
import TickerPopup from "../components/TickerPopup";

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
function NotableActivityPanel({filterByCat}){
  const [sortKey,setSortKey]=useState("signals");
  const [sortDir,setSortDir]=useState("desc");

  const universe=(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) if(it.signals&&it.signals.length>0) map[it.t]=it;
    return filterByCat(Object.values(map));
  })();

  const filtered=useMemo(()=>{
    const acc={
      signals:x=>x.signals.length, bigPrintN:x=>x.bigPrintN, bigPrint:x=>x.bigPrint, t:x=>x.t,
      bpMove:x=>x.bigPrint>0?((x.last-x.bigPrint)/x.bigPrint*100):null,
      avgVol:x=>x.bigPrintPctAvgVol||0, last:x=>x.last||0, mktcap:x=>x.mktcap||0,
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
        textTransform:"uppercase",marginBottom:8}}>🔥 Notable Activity</div>

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
        return (
          <div key={it.t} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"5px 0",borderBottom:`1px solid ${C.bdr}22`}}>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                width:18,textAlign:"center",fontWeight:600}}>{i+1}</span>
              <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,
                fontSize:12,color:cc}}>{it.t}</span>
              <SignalBadges signals={it.signals} compact/>
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:10,
                color:C.tx3,minWidth:52,textAlign:"right"}}>{it.mktcap>0?fmt(it.mktcap).replace("$",""):"—"}</span>
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
        );
      })}
    </div>
  );
}

// ── Top Biggest Prints panel (tabbed, sortable, %AvgVol) ─────────────────────
function BiggestPrintsPanel({filterByCat}){
  const [sortKey,setSortKey]=useState("bigPrintN");
  const [sortDir,setSortDir]=useState("desc");

  const universe=(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) if(it.bigPrintN>0) map[it.t]=it;
    return filterByCat(Object.values(map));
  })();

  const filtered=useMemo(()=>{
    const acc={
      bigPrintN:x=>x.bigPrintN, bigPrint:x=>x.bigPrint, t:x=>x.t,
      bpMove:x=>x.bigPrint>0?((x.last-x.bigPrint)/x.bigPrint*100):null,
      avgVol:x=>x.bigPrintPctAvgVol||0, last:x=>x.last||0, mktcap:x=>x.mktcap||0,
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
        return (
          <div key={it.t} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"5px 0",borderBottom:`1px solid ${C.bdr}22`}}>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                width:18,textAlign:"center",fontWeight:600}}>{i+1}</span>
              <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,
                fontSize:12,color:cc}}>{it.t}</span>
              <SignalBadges signals={it.signals} compact/>

            </div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontSize:10,
                color:C.tx3,minWidth:52,textAlign:"right"}}>{it.mktcap>0?fmt(it.mktcap).replace("$",""):"—"}</span>
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
        );
      })}
      {filtered.length===0 && <div style={{fontSize:12,color:C.tx3,padding:8}}>No prints in this category</div>}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewPane({onJumpTo, filterByCat}){
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
                    <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,fontSize:12,
                      color:CAT_COLORS[t.cat]||C.tx,minWidth:50}}>{t.t}</span>
                    {/* Frequency bar */}
                    <div style={{flex:1,height:4,background:C.bdr,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:pct+"%",height:"100%",borderRadius:2,
                        background:pct>=90?C.green:pct>=70?C.amber:C.tx3,opacity:0.7}}/>
                    </div>
                    <span style={{fontSize:10,color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
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
                        <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",fontWeight:700,fontSize:12,
                          color:CAT_COLORS[t.cat]||C.tx}}>{t.t}</span>

                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:10,fontWeight:600,color:C.cyan,
                          fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{fmt(t.bigPrintN)}</span>
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

        {/* Flagged tickers — clean table */}
        {flaggedAll.length>0 && (
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.bdr}`}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:C.tx3,
              textTransform:"uppercase",marginBottom:8}}>⚡ Flagged ({flaggedAll.length})</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
              {flaggedAll.slice(0,12).map(t=>{
                const topSignal = t.signals[0];
                const color = topSignal ? ({"YEARLY_RECORD":"#c9a84c","MONTHLY_RECORD":"#3cb868","NOTIONAL_SPIKE":"#e74c3c","RARE_FLOW":"#6ba3be","SIZE_ESCALATION":"#a78bfa","ZONE_BREAK_RECORD":"#c9a84c"}[topSignal.type]||C.amber) : C.tx3;
                return (
                  <div key={t.t} style={{display:"flex",alignItems:"center",gap:8,
                    padding:"4px 0",borderBottom:`1px solid ${C.bdr}22`}}>
                    <span style={{fontWeight:700,fontSize:11,color:CAT_COLORS[t.cat]||C.tx,
                      minWidth:42}}>{t.t}</span>
                    <div style={{display:"flex",gap:3,flex:1,overflow:"hidden"}}>
                      {t.signals.slice(0,2).map(s=>{
                        const sc = {"YEARLY_RECORD":"#c9a84c","MONTHLY_RECORD":"#3cb868","NOTIONAL_SPIKE":"#e74c3c","RARE_FLOW":"#6ba3be","SIZE_ESCALATION":"#a78bfa","ZONE_BREAK_RECORD":"#c9a84c"}[s.type]||C.amber;
                        const short = {"YEARLY_RECORD":"Yr Record","MONTHLY_RECORD":"Mo Record","NOTIONAL_SPIKE":"Vol Surge","RARE_FLOW":"New Flow","SIZE_ESCALATION":"Escalating","ZONE_BREAK_RECORD":"Zone Break"}[s.type]||s.label;
                        return (
                          <span key={s.type} style={{fontSize:8,padding:"1px 5px",borderRadius:6,
                            background:sc+"15",color:sc,fontWeight:600,whiteSpace:"nowrap",
                            border:`1px solid ${sc}25`}}>
                            {short}{s.mult?"·"+s.mult+"×":""}{s.days?"·"+s.days+"d":""}
                          </span>
                        );
                      })}
                      {t.signals.length>2 && <span style={{fontSize:8,color:C.tx3}}>+{t.signals.length-2}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {flaggedAll.length>12 && <div style={{fontSize:10,color:C.tx3,marginTop:4}}>+{flaggedAll.length-12} more</div>}
          </div>
        )}
      </div>
      )}

      {/* ── Notable Activity + Biggest Prints (side by side) ─────── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>

        {/* Notable Activity */}
        <NotableActivityPanel filterByCat={filterByCat}/>

        {/* Biggest Prints */}
        <BiggestPrintsPanel filterByCat={filterByCat}/>
      </div>

      {/* ── Sector Flow + Notable Prints ──────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>

        {/* Sector Flow — weighted by notional, no Miscellaneous */}
        <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
            textTransform:"uppercase",marginBottom:10}}>Sector Flow</div>
          {(()=>{
            // Rebuild sector data from filtered allItems (respects global filter)
            const secMap={};
            for(const item of allItems){
              const sec=item.sector||"";
              if(!sec||sec==="Miscellaneous"||sec==="Other"||sec==="None") continue;
              if(!secMap[sec]) secMap[sec]={sector:sec,notional:0,tickers:[],weightedMove:0,weightedN:0,count:0};
              secMap[sec].notional+=item.n;
              secMap[sec].tickers.push({t:item.t,n:item.n});
              secMap[sec].count++;
              if(item.bigPrint>0){
                const move=(item.last-item.bigPrint)/item.bigPrint*100;
                secMap[sec].weightedMove+=move*item.bigPrintN;
                secMap[sec].weightedN+=item.bigPrintN;
              }
            }
            const sectors=Object.values(secMap)
              .filter(s=>s.count>=2)
              .map(s=>({
                ...s,
                avgMove:s.weightedN>0?s.weightedMove/s.weightedN:0,
                topTickers:s.tickers.sort((a,b)=>b.n-a.n).slice(0,3).map(t=>t.t),
              }))
              .sort((a,b)=>b.notional-a.notional)
              .slice(0,8);
            const maxN=Math.max(...sectors.map(s=>s.notional),1);
            if(sectors.length===0) return <div style={{fontSize:12,color:C.tx3}}>No sector data available</div>;
            return sectors.map(s=>{
              const pct=Math.max((s.notional/maxN)*100,2);
              const moveColor=s.avgMove>0.3?C.green:s.avgMove<-0.3?C.red:C.tx3;
              return (
                <div key={s.sector} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                      <span style={{fontSize:11,fontWeight:600,color:C.tx}}>{s.sector}</span>
                      <span style={{fontSize:8,color:C.tx3}}>{s.topTickers.join(" · ")}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                      <span style={{fontSize:9,color:C.tx3}}>{s.count}</span>
                      <span style={{fontSize:10,fontWeight:700,color:moveColor,
                        fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",minWidth:40,textAlign:"right"}}>
                        {s.avgMove>0?"+":""}{s.avgMove.toFixed(1)}%
                      </span>
                      <span style={{fontSize:10,fontWeight:700,color:C.cyan,
                        fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",minWidth:52,textAlign:"right"}}>
                        {fmt(s.notional)}
                      </span>
                    </div>
                  </div>
                  <div style={{width:"100%",height:4,background:C.bdr,borderRadius:2,overflow:"hidden"}}>
                    <div style={{width:pct+"%",height:"100%",background:moveColor,borderRadius:2,opacity:0.7,transition:"width 0.4s"}}/>
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* Notable Prints — non-obvious names, sorted by recency */}
        <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
            textTransform:"uppercase",marginBottom:10}}>Notable Prints — Post-Print Moves</div>

          {/* Column headers */}
          <div style={{display:"flex",justifyContent:"space-between",padding:"0 0 5px 0",
            borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
            <span style={{fontSize:9,color:C.tx3,fontWeight:600}}>Ticker</span>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:32,textAlign:"right"}}>Date</span>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:52,textAlign:"right"}}>Print $</span>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:52,textAlign:"right"}}>Last</span>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:44,textAlign:"right"}}>Move</span>
              <span style={{fontSize:9,color:C.tx3,fontWeight:600,minWidth:48,textAlign:"right"}}>Notional</span>
            </div>
          </div>

          {(()=>{
            const tracked = allItems
              .filter(i=>i.bigPrint>0 && i.bigPrintN>=20_000_000 && i.bigPrintDk && !USUAL.has(i.t))
              .sort((a,b)=>{
                // Sort by recency (most recent print first)
                if(a.bigPrintDk && b.bigPrintDk) return b.bigPrintDk.localeCompare(a.bigPrintDk);
                return b.bigPrintN-a.bigPrintN;
              })
              .slice(0,12);
            if(tracked.length===0) return <div style={{fontSize:12,color:C.tx3,padding:8}}>No notable prints for this period</div>;
            return tracked.map(it=>{
              const move=((it.last-it.bigPrint)/it.bigPrint*100);
              const moveColor=move>0.5?C.green:move<-0.5?C.red:C.tx3;
              const cc=CAT_COLORS[it.cat]||C.tx;
              return (
                <div key={it.t} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"5px 0",borderBottom:`1px solid ${C.bdr}22`}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
                    <span style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                      fontWeight:700,fontSize:12,color:cc}}>{it.t}</span>
                    {it.mktcap>0 && <span style={{fontSize:8,color:C.tx3}}>{fmt(it.mktcap).replace("$","")}</span>}
                    {it.signals&&it.signals.length>0 && <SignalBadges signals={it.signals.slice(0,1)} compact/>}
                    {it.sector && it.sector!=="Miscellaneous" && it.sector!=="Other" &&
                      <span style={{fontSize:8,color:C.tx3}}>{it.sector}</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <span style={{fontSize:10,color:C.tx3,
                      fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                      minWidth:32,textAlign:"right"}}>{it.bigPrintDate}</span>
                    <span style={{fontSize:10,color:C.amber,
                      fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                      minWidth:52,textAlign:"right"}}>{fP(it.bigPrint)}</span>
                    <span style={{fontSize:10,color:C.tx,fontWeight:600,
                      fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                      minWidth:52,textAlign:"right"}}>{fP(it.last)}</span>
                    <span style={{fontSize:11,fontWeight:700,color:moveColor,
                      fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                      minWidth:44,textAlign:"right"}}>
                      {move>0?"+":""}{move.toFixed(1)}%
                    </span>
                    <span style={{fontSize:10,fontWeight:600,color:C.cyan,
                      fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                      minWidth:48,textAlign:"right"}}>{fmt(it.bigPrintN)}</span>
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
function AbovePane({filterByCat}){
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
      <FlowTable items={items}/>
    </div>
  );
}

function BelowPane({filterByCat}){
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
      <FlowTable items={items}/>
    </div>
  );
}

// ── Unusual Flow tab ─────────────────────────────────────────────────────────
function UnusualPane({filterByCat}){
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
      <FlowTable items={items}/>
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
                  <TD><TickerPopup sym={p.ticker}><span style={{color:C.blue,fontWeight:700,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
                    ${p.ticker}</span></TickerPopup></TD>
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
                  <TD style={{color:C.tx3,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>{o.date}</TD>
                  <TD><TickerPopup sym={o.ticker}><span style={{color:C.pink,fontWeight:700,fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>
                    ${o.ticker}</span></TickerPopup></TD>
                  <TD style={{fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",color:C.tx2}}>{fP(o.price)}</TD>
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
                {/* Top 5 individual prints */}
                {it.top5&&it.top5.map((row,i)=>(
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
            fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif",outline:"none",
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
      const floatShares = parseFloat(r.Float)||0;
      tradeRows.push({ticker:tk, dateKey:fmtDateKey(d), price, notional, message:msg, avg30, pctAvgVol, industry, sector, floatShares});
    }catch(e){}
  }

  // Aggregate per ticker
  const tickerTrades={};  // tk → [{price,notional,dateKey}]
  const tickerDaily={};   // tk → {dateKey → {notional,volNotional,count}}
  const tickerAvg30={};  // tk → avg 30-day volume (last seen value)
  const tickerIndustry={};// tk → industry (most common)
  const tickerSector={};  // tk → sector (most common)
  const tickerFloat={};   // tk → float shares (last seen value)

  for(const tr of tradeRows){
    const {ticker:tk,dateKey:dk,price:p,notional:n,avg30,pctAvgVol,industry,sector,floatShares}=tr;
    if(!tickerTrades[tk]) tickerTrades[tk]=[];
    tickerTrades[tk].push({p,n,dk,pctAvgVol});
    if(avg30>0) tickerAvg30[tk]=avg30;
    if(floatShares>0) tickerFloat[tk]=floatShares;
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
    const floatShares=tickerFloat[tk]||0;
    const mktcap=floatShares>0&&last>0?last*floatShares:0;
    // Accumulation vs Distribution: big print above VWAP = Acc, below = Dist
    const accDist = bigPrint!=null && vwap>0 ? (bigPrint>=vwap?"Acc":"Dist") : null;
    itemsAll.push({t:tk,cat,n:Math.round(totalN),lo,hi,last,vwap,c:trades.length,days,pos,pct,u:uoaTickers.has(tk),prices:pricesArr,w:wArr,top5,bigPrint,bigPrintN,bigPrintDk,bigPrintDate,bigPrintPctAvgVol,avg30,industry,sector,accDist,mktcap,signals:[]});
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
export default function DarkPool({embedded}){
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
    ? "/api/darkpool/data?all_data=true"
    : `/api/darkpool/data?days=${fetchDays}`;

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

  // Fetch data from API
  useEffect(() => {
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
        return tryFetch("/Darkpool-data.csv");
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
            setCsvLoading(false);
          } catch(err) {
            if (!cancelled) { setLoadErr(err.message); setCsvLoading(false); }
          }
        }, 0);
      })
      .catch(e => { if (!cancelled) { setLoadErr("Could not load data from API or static CSV"); setCsvLoading(false); } });
    return () => { cancelled = true; };
  }, [csvFile]);




  const [tab,setTab]=useState("overview");
  const [catJump,setCatJump]=useState(null);
  const [showSearch,setShowSearch]=useState(false);
  const [globalCat,setGlobalCat]=useState("All");

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

      {/* Header */}
      <div style={{background:C.bg2,borderBottom:`1px solid ${C.bdr}`,padding:"12px 20px"}}>
        <div style={{maxWidth:1400,margin:"0 auto"}}>
        {/* Title row */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:C.green,
            boxShadow:`0 0 6px ${C.green}`,display:"inline-block",flexShrink:0}}/>
          <span style={{fontSize:18,fontWeight:800,color:C.tx,letterSpacing:"0.02em",
            fontFamily:"'Instrument Sans','SF Pro Display',system-ui,sans-serif"}}>DARK POOL SCANNER</span>
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

      {/* Global Category Filter */}
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
          🔍 Search
        </button>
        </div>
      </div>

      {/* Content */}
      <div style={{padding:"14px 20px",maxWidth:1400,margin:"0 auto"}}>
        {tab==="overview" && <OverviewPane onJumpTo={handleJumpTo} filterByCat={filterByCat}/>}
        {tab==="category" && <CategoryPaneWrapper jump={catJump} onJumpDone={()=>setCatJump(null)}/>}
        {tab==="above"    && <AbovePane filterByCat={filterByCat}/>}
        {tab==="below"    && <BelowPane filterByCat={filterByCat}/>}
        {tab==="unusual"  && <UnusualPane filterByCat={filterByCat}/>}
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
